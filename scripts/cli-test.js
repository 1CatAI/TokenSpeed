'use strict';
// 命令行冒烟测试：node scripts/cli-test.js [baseUrl] [model] [apiKey]
const base = process.argv[2] || 'http://127.0.0.1:18000/v1';
const model = process.argv[3] || 'mock-coder';
const key = process.argv[4] || 'demo';
const port = process.env.PORT || 5173;

(async () => {
  const res = await fetch(`http://127.0.0.1:${port}/api/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ baseUrl: base, model, apiKey: key, maxTokens: Number(process.env.MAX || 512) }),
  });
  const dec = new TextDecoder();
  let buf = '';
  let ticks = 0;
  for await (const c of res.body) {
    buf += dec.decode(c, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const ev = JSON.parse(buf.slice(0, i));
      buf = buf.slice(i + 1);
      if (ev.type === 'tick') {
        ticks++;
        continue;
      }
      if (ev.type === 'prefill_start') ev.lanes = `[${ev.lanes.length} lanes]`;
      if (ev.type === 'done') ev.summary = '[...]';
      console.log(JSON.stringify(ev).slice(0, 300));
    }
  }
  console.log('ticks:', ticks);
})();
