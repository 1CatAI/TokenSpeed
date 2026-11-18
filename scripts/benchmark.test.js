'use strict';
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { setTimeout: sleep } = require('node:timers/promises');
const { test } = require('node:test');
const { normalizeConfig, runBenchmark } = require('../lib/bench');
const { streamRequest } = require('../lib/client');

async function withUpstream(handler, check) {
  const server = http.createServer(async (req, res) => {
    const parts = [];
    for await (const part of req) parts.push(part);
    const request = JSON.parse(Buffer.concat(parts));
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const send = (event) => res.write(`data: ${typeof event === 'string' ? event : JSON.stringify(event)}\n\n`);
    try {
      await handler(request, send);
    } catch (error) {
      res.destroy(error);
    } finally {
      res.end();
    }
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    await check(`http://127.0.0.1:${server.address().port}/v1`);
  } finally {
    server.close();
    server.closeAllConnections?.();
    await once(server, 'close');
  }
}

function openAIChunk(send, count) {
  send({
    choices: [{ delta: { content: 'some text' } }],
    usage: count == null ? null : { completion_tokens: count },
  });
}

function openAIFinish(send, usage) {
  send({ choices: [{ delta: {}, finish_reason: 'stop' }] });
  if (usage) send({ choices: [], usage });
  send('[DONE]');
}

async function run(baseUrl, config = {}, onEvent) {
  const ctl = { id: 'fixture', master: new AbortController() };
  let summary;
  await runBenchmark({ baseUrl, model: 'fixture', concurrency: 2, contextTokens: 1000, ...config }, (ev) => {
    if (ev.type === 'done') summary = ev.summary;
    onEvent?.(ev, ctl);
  }, ctl);
  return summary;
}

test('uses a fixed peak window and one shared batch duration with staggered streams', async () => {
  await withUpstream(async (req, send) => {
    const system = req.messages[0].content;
    if (req.max_tokens === 1) {
      openAIChunk(send, 1);
      openAIFinish(send, { completion_tokens: 1, prompt_tokens: system.includes('<material>') ? 1500 : system.length });
    } else if (!system.includes('<material>')) {
      openAIChunk(send, 4);
      for (const [delay, count] of [[500, 7], [350, 11], [650, 16], [760, 22]]) {
        await sleep(delay);
        openAIChunk(send, count);
      }
      await sleep(400);
      openAIFinish(send, { completion_tokens: 22, prompt_tokens: 100 });
    } else {
      const slow = system.includes('前端移植题库');
      await sleep(slow ? 170 : 20);
      openAIChunk(send, 5);
      await sleep(slow ? 120 : 70);
      openAIChunk(send, 25);
      openAIFinish(send, { completion_tokens: 25, prompt_tokens: 1600, prompt_tokens_details: { cached_tokens: slow ? 0 : 800 } });
    }
  }, async (baseUrl) => {
    const s = await run(baseUrl);
    assert.equal(s.prefill.totalTokens, 3000);
    assert.equal(s.prefill.throughput, 3000 / (s.prefill.wallMs / 1000));
    assert.equal(s.prefill.cachedTokens, null);
    assert.equal(s.single.peak, 9);
    assert.equal(s.single.tokens, 22);
    assert.ok(Math.abs(s.single.speed - 18 / (s.single.chunkGap.avg * 4 / 1000)) < 1e-9);
    assert.equal(s.single.e2eSpeed, 22 / (s.single.wallMs / 1000));
    assert.ok(s.single.wallMs - s.single.chunkGap.avg * 4 >= 350);
    assert.equal(s.decode.totalTokens, 50);
    assert.equal(s.decode.throughput, 50 / (s.decode.windowMs / 1000));
    assert.ok(s.decode.throughput < s.decode.lanes.reduce((sum, lane) => sum + lane.speed, 0));
    assert.equal(s.decode.cacheHitRate, 0.25);
  });
});

test('missing and final-only usage produce different available metrics', async () => {
  await withUpstream(async (req, send) => {
    openAIChunk(send);
    if (req.max_tokens > 1) {
      await sleep(20);
      openAIChunk(send);
      openAIFinish(send, { completion_tokens: 32, prompt_tokens: 1000 });
    } else {
      openAIFinish(send);
    }
  }, async (baseUrl) => {
    const s = await run(baseUrl);
    assert.equal(s.prefill.ok, 2);
    assert.equal(s.prefill.throughput, null);
    assert.equal(s.prefill.totalTokens, null);
    assert.equal(s.single.peak, null);
    assert.equal(s.single.speed, null);
    assert.ok(s.single.e2eSpeed > 0);
    assert.equal(s.decode.totalTokens, 64);
    assert.ok(s.decode.throughput > 0);
    assert.equal(s.decode.avgSpeed, null);
    assert.equal(s.decode.cacheHitRate, null);
  });
});

test('empty and truncated streams cannot be reported as a latency sample', async () => {
  await withUpstream((_, send) => openAIFinish(send, { prompt_tokens: 20, completion_tokens: 1 }), async (baseUrl) => {
    await assert.rejects(run(baseUrl), /未收到文本或推理输出/);
  });
  await withUpstream((_, send) => openAIChunk(send, 1), async (baseUrl) => {
    await assert.rejects(run(baseUrl), /缺少结束事件/);
  });
});

test('a last partial counter is not used as final request usage', async () => {
  await withUpstream(async (_, send) => {
    openAIChunk(send, 2);
    await sleep(30);
    openAIChunk(send, 9);
    openAIFinish(send);
  }, async (baseUrl) => {
    const r = await streamRequest(normalizeConfig({ baseUrl, model: 'fixture' }), { system: 'test', user: 'test', maxTokens: 16 });
    assert.equal(r.ok, true);
    assert.deepEqual(r.marks.map((mark) => mark[1]), [2, 9]);
    assert.equal(r.completionTokens, null);
  });
});

test('an interrupted generation stage cannot publish a batch throughput', async () => {
  await withUpstream(async (req, send) => {
    openAIChunk(send, 1);
    if (req.max_tokens > 1) await sleep(200);
    openAIFinish(send, { completion_tokens: 1, prompt_tokens: 20 });
  }, async (baseUrl) => {
    const s = await run(baseUrl, { runPrefill: false, runSingle: false }, (ev, ctl) => {
      if (ev.type === 'tick' && ev.phase === 'decode' && ev.lanes.some((lane) => lane.c > 0)) ctl.stopDecode();
    });
    assert.equal(s.decode.byUser, true);
    assert.equal(s.decode.totalTokens, null);
    assert.equal(s.decode.throughput, null);
  });
});

test('Anthropic cache input is included once, with cumulative message_delta usage', async () => {
  await withUpstream((_, send) => {
    send({ type: 'message_start', message: { usage: { input_tokens: 10, cache_creation_input_tokens: 15, cache_read_input_tokens: 25 } } });
    send({ type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'thought' } });
    send({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 11, input_tokens: 12 } });
    send({ type: 'message_stop' });
  }, async (baseUrl) => {
    const r = await streamRequest(normalizeConfig({ baseUrl, model: 'fixture', format: 'anthropic' }), { system: 'test', user: 'test', maxTokens: 10 });
    assert.equal(r.ok, true);
    assert.equal(r.promptTokens, 52);
    assert.equal(r.cachedTokens, 25);
    assert.equal(r.completionTokens, 11);
    assert.equal(r.marks[0][1], null);
  });
});

test('extra parameters cannot change the workload being measured', () => {
  const config = { baseUrl: 'http://127.0.0.1:12345', model: 'fixture' };
  assert.throws(() => normalizeConfig({ ...config, extraBody: '{"max_tokens":1000}' }), /不能覆盖测速字段/);
  assert.throws(() => normalizeConfig({ ...config, extraBody: '{"n":2}' }), /不能覆盖测速字段/);
  assert.deepEqual(normalizeConfig({ ...config, extraBody: '{"enable_thinking":false}' }).extraBody, { enable_thinking: false });
});
