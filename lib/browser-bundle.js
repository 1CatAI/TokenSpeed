'use strict';
const fs = require('fs');
const path = require('path');
const { gzipSync } = require('zlib');
const corpus = require('./corpus-data');

// Share the Node benchmark and dataset with the browser using the same module code.
// Module names and sources are fixed at build time. The response never contains user input.
function buildBrowserBundle() {
  const licenses = ['../LICENSE', '../data/LICENSE-HumanEval']
    .map((file) => fs.readFileSync(path.join(__dirname, file), 'utf8').trim()).join('\n\n');
  const notice = `${licenses}\n\nMBPP dataset by Google Research (Austin et al., 2021), included unchanged.
Source: https://github.com/google-research/google-research/blob/master/mbpp/mbpp.jsonl
License: https://creativecommons.org/licenses/by/4.0/`;
  const modules = ['client', 'dataset', 'bench'].map((name) => [
    './' + name,
    fs.readFileSync(path.join(__dirname, name + '.js'), 'utf8'),
  ]);
  const factories = modules.map(([name, source]) =>
    `${JSON.stringify(name)}: function(require, module) {\n${source}\n}`);
  const script = `${notice.split('\n').map((line) => '// ' + line).join('\n')}
(() => {
  'use strict';
  const modules = {${factories.join(',\n')}};
  const loaded = new Map([
    ['./corpus-data', ${JSON.stringify(corpus)}],
    ['crypto', { randomBytes(length) {
      const bytes = crypto.getRandomValues(new Uint8Array(length));
      return { toString: () => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('') };
    } }],
  ]);
  function load(name) {
    if (loaded.has(name)) return loaded.get(name);
    const module = { exports: {} };
    modules[name](load, module);
    loaded.set(name, module.exports);
    return module.exports;
  }
  const { runBenchmark } = load('./bench');
  const { listModels } = load('./client');
  globalThis.TokenSpeedDirect = {
    runBenchmark: (cfg, emit, ctl) => runBenchmark({ ...cfg, browserDirect: true }, emit, ctl),
    listModels: (cfg) => listModels({ ...cfg, browserDirect: true }),
  };
})();\n`;
  return { plain: Buffer.from(script), gzip: gzipSync(script) };
}

module.exports = { buildBrowserBundle };
