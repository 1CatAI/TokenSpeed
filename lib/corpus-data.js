'use strict';
const fs = require('fs');
const path = require('path');

const read = (name) => fs.readFileSync(path.join(__dirname, '..', 'data', name), 'utf8').trim().split('\n').map((line) => JSON.parse(line));

module.exports = { humanEval: read('HumanEval.jsonl'), mbpp: read('mbpp.jsonl') };
