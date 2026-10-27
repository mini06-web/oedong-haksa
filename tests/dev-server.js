/* 로컬 미리보기: 정적 파일 + 가짜 GAS(/gas, gas/Code.gs 를 메모리 시트로 실행)
 * node tests/dev-server.js [포트]   → http://localhost:8766/  (비밀번호 test-pw)
 * localhost 와 127.0.0.1 은 브라우저 저장소가 따로라 '집'과 '학교' 두 기기처럼 시험할 수 있다.
 */
'use strict';
var http = require('http'), fs = require('fs'), path = require('path'), url = require('url');
var gas = require('./mock-gas').createGas();
var root = path.join(__dirname, '..'), port = +process.argv[2] || 8766;
var TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json' };

http.createServer(function (req, res) {
  var u = url.parse(req.url, true);
  if (u.pathname === '/gas') {
    var send = function (o) { res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify(o)); };
    if (req.method === 'GET') return setTimeout(function () { send(gas.get(u.query)); }, 150);
    var body = ''; req.on('data', function (c) { body += c; });
    return req.on('end', function () { setTimeout(function () { send(gas.post(body)); }, 250); });
  }
  if (u.pathname === '/config.js') {
    res.writeHead(200, { 'Content-Type': TYPES['.js'] });
    return res.end("window.HAKSA_CONFIG = { gasUrl: location.origin + '/gas' };");
  }
  var f = path.join(root, decodeURIComponent(u.pathname === '/' ? '/index.html' : u.pathname));
  if (f.indexOf(root) !== 0) { res.writeHead(403); return res.end(); }
  fs.readFile(f, function (err, data) {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
}).listen(port, function () { console.log('http://localhost:' + port + '/  (가짜 GAS 비밀번호: test-pw)'); });
