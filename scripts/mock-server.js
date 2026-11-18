'use strict';
// 独立运行的演示服务：node scripts/mock-server.js → http://127.0.0.1:18000/v1
const http = require('http');
const { handle } = require('../lib/mock');
const PORT = Number(process.env.MOCK_PORT) || 18000;
http.createServer(handle).listen(PORT, '127.0.0.1', () => console.log(`demo LLM → http://127.0.0.1:${PORT}/v1  (model: demo-coder)`));
