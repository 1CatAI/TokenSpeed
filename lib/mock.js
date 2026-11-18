'use strict';
// 内置演示服务（OpenAI 兼容），挂载在 /demo/v1，没有 API Key 也能体验完整流程。
const crypto = require('crypto');
const D = require('./dataset');

const PREFILL_TPS = Number(process.env.DEMO_PREFILL_TPS) || 60000; // 聚合 prefill 吞吐
const DECODE_TPS = Number(process.env.DEMO_DECODE_TPS) || 72; // 单路 decode 速度
const CHUNK = Math.max(1, Number(process.env.DEMO_CHUNK) || 1); // 每个数据块打包几个 token，模拟部分中转服务
const MTP = process.env.DEMO_MTP === '1'; // 每块随机 1~5 个 token，模拟 MTP / 投机解码
const NO_CONT = process.env.DEMO_NO_CONT === '1'; // 模拟不支持 continuous_usage_stats 的服务
const cache = new Set();
let prefillCursor = 0;
let active = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 粗略模拟分词：英文单词、最多 3 位数字、1~2 个汉字、单个符号各算一个 token
const TOKEN_RE = /\s*(?:[A-Za-z_]+|\d{1,3}|[\u4e00-\u9fff]{1,2}|[^\sA-Za-z_\d\u4e00-\u9fff])/g;
const tokenize = (s) => s.match(TOKEN_RE) || [];
const countTokens = (s) => tokenize(s).length;
const SAMPLE = tokenize(D.ITEMS.slice(0, 240).join('\n'));

// 模拟 MTP：越好猜的内容（代码、JSON）一次接受的 token 越多，速度越快
const BOOST = [
  [/JSON/, 1.18],
  [/Python/, 1.12],
  [/TypeScript/, 1.08],
  [/翻译/, 0.98],
  [/推导/, 0.9],
  [/English/, 0.84],
  [/深度报道/, 0.8],
  [/客服/, 0.81],
];

// 输出内容直接取自资料正文，演示时每路看起来像在写对应领域的内容
function pieces(sys) {
  const m = /<material>\n([\s\S]*)\n<\/material>/.exec(sys || '');
  if (!m) return SAMPLE;
  return tokenize(m[1].slice(0, 6000));
}

function handle(req, res) {
  if (req.url.endsWith('/models')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ data: [{ id: 'demo-coder' }] }));
  }
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', async () => {
    let j = {};
    try {
      j = JSON.parse(body || '{}');
    } catch (_) {}
    const so = j.stream_options || {};
    if (NO_CONT && so.continuous_usage_stats) {
      res.writeHead(400, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: { message: 'Unrecognized request argument: stream_options.continuous_usage_stats' } }));
    }
    const msgs = j.messages || [];
    const sys = msgs.find((m) => m.role === 'system');
    const user = (msgs.find((m) => m.role === 'user') || {}).content || '';
    const all = msgs.map((m) => m.content).join('\n');
    const promptTokens = countTokens(all) + 12;
    const key = sys ? crypto.createHash('md5').update(sys.content).digest('hex') : '';
    const sysTok = sys ? countTokens(sys.content) : 0;
    const cached = key && cache.has(key) ? Math.floor(sysTok / 16) * 16 : 0;
    const now = Date.now();
    prefillCursor = Math.max(prefillCursor, now) + ((promptTokens - cached) / PREFILL_TPS) * 1000;
    let aborted = false;
    res.on('close', () => (aborted = true));
    await sleep(prefillCursor - now + 30 + Math.random() * 20);
    if (aborted) return;
    if (key) {
      cache.add(key);
      if (cache.size > 500) cache.clear();
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
    const max = Math.min(j.max_tokens || 256, 8192);
    const target = max <= 1 ? 1 : Math.round(max * (0.8 + Math.random() * 0.2));
    const boost = (BOOST.find(([re]) => re.test(user)) || [0, 1])[1];
    const words = pieces(sys && sys.content);
    active++;
    let off = Math.floor(Math.random() * words.length);
    let k = 0;
    while (k < target && !aborted) {
      const n = Math.min(target - k, MTP ? 1 + Math.floor(Math.random() * 5) : CHUNK);
      const speed = DECODE_TPS * boost * (1 - Math.min(0.35, (active - 1) * 0.025)) * (0.85 + Math.random() * 0.3);
      let content = '';
      for (let m = 0; m < n; m++) content += words[off++ % words.length];
      k += n;
      const chunk = { choices: [{ index: 0, delta: { content } }] };
      if (so.continuous_usage_stats) chunk.usage = { prompt_tokens: promptTokens, completion_tokens: k };
      send(chunk);
      // MTP：一步出 n 个 token，步频大致不变
      if (k < target) await sleep(((MTP ? 2.6 : n) * 1000) / speed);
    }
    active--;
    if (aborted) return;
    send({ choices: [{ index: 0, delta: {}, finish_reason: target >= max ? 'length' : 'stop' }] });
    send({
      choices: [],
      usage: { prompt_tokens: promptTokens, completion_tokens: target, prompt_tokens_details: { cached_tokens: cached } },
    });
    res.end('data: [DONE]\n\n');
  });
}

module.exports = { handle };
