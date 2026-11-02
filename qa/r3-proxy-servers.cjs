'use strict';
// Round 3 (network): small real proxy servers for end-to-end checks. Loopback only, no external host is ever contacted.
//  - startOrigin: a web server whose pages echo the address the connection came from, so "through the proxy" is visible:
//    the proxies open their upstream connection FROM 127.0.0.2, a direct connection arrives from 127.0.0.1.
//  - startHttpProxy: forward proxy + CONNECT tunnel, optional Basic sign-in (407), logs what it was asked.
//  - startSocks5: SOCKS5 with no sign-in or with username/password (RFC 1929), logs whether the client sent a NAME or an address
//    (a name means the browser did not resolve it locally).
//  - startUdpSink: counts datagrams (a STUN-like listener) to see whether WebRTC sends anything around a proxy.
//  - startPacServer: serves a proxy auto-config script.
// Names such as echo.acira.test only exist in the proxy's own table, never in system DNS.
const net = require('node:net'), http = require('node:http'), dgram = require('node:dgram');

const SOURCE_IP = '127.0.0.2';
const listen = (server, host = '127.0.0.1', port = 0) => new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, () => resolve(server.address().port)); });
const bare = address => String(address || '').replace(/^::ffff:/, '');

async function startOrigin() {
  const hits = [], sockets = new Set();
  const server = http.createServer((req, res) => {
    const ip = bare(req.socket.remoteAddress);
    hits.push({ ip, host: req.headers.host, path: req.url });
    const body = JSON.stringify({ ip, host: req.headers.host, path: req.url });
    if (req.url.startsWith('/json')) { res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); return res.end(body); }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(`<!doctype html><title>ip ${ip}</title><body><pre id="ip">${ip}</pre><pre id="host">${req.headers.host}</pre></body>`);
  });
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  const port = await listen(server);
  return { port, hits, close: () => new Promise(resolve => { for (const socket of sockets) socket.destroy(); server.close(resolve); }) };
}

const basic = (user, pass) => 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');

/** names: { 'echo.acira.test': port } maps a name the browser asks the proxy for to a loopback origin port. */
async function startHttpProxy({ names = {}, auth = null, sourceIp = SOURCE_IP, port: wanted = 0 } = {}) {
  const log = [], sockets = new Set();
  const allowed = req => !auth || req.headers['proxy-authorization'] === basic(auth.user, auth.pass);
  const server = http.createServer((req, res) => {
    let target; try { target = new URL(req.url); } catch { res.writeHead(400).end(); return; }
    const entry = { kind: 'http', host: target.hostname, port: Number(target.port || 80), path: target.pathname + target.search, auth: Boolean(req.headers['proxy-authorization']) };
    if (!allowed(req)) { entry.status = 407; log.push(entry); res.writeHead(407, { 'Proxy-Authenticate': 'Basic realm="acira-test"', 'content-type': 'text/plain', connection: 'close' }); return res.end('proxy sign-in needed'); }
    const origin = names[target.hostname];
    if (!origin) { entry.status = 502; log.push(entry); res.writeHead(502).end('unknown name'); return; }
    entry.status = 200; log.push(entry);
    const headers = { ...req.headers, host: target.host }; delete headers['proxy-authorization']; delete headers['proxy-connection'];
    const up = http.request({ host: '127.0.0.1', port: origin, path: entry.path, method: req.method, headers, localAddress: sourceIp }, upstream => { res.writeHead(upstream.statusCode, upstream.headers); upstream.pipe(res); });
    up.on('error', () => res.destroy()); req.pipe(up);
  });
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => {}); });
  server.on('connect', (req, socket, head) => {
    const [host, portText] = req.url.split(':'), entry = { kind: 'connect', host, port: Number(portText), auth: Boolean(req.headers['proxy-authorization']) };
    if (!allowed(req)) { entry.status = 407; log.push(entry); socket.end('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="acira-test"\r\nConnection: close\r\n\r\n'); return; }
    const origin = names[host];
    if (!origin) { entry.status = 502; log.push(entry); socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'); return; }
    entry.status = 200; log.push(entry);
    const up = net.connect({ host: '127.0.0.1', port: origin, localAddress: sourceIp }, () => { socket.write('HTTP/1.1 200 Connection Established\r\n\r\n'); if (head?.length) up.write(head); up.pipe(socket); socket.pipe(up); });
    up.on('error', () => socket.destroy()); socket.on('error', () => up.destroy()); socket.on('close', () => up.destroy());
  });
  const port = await listen(server, "127.0.0.1", wanted);
  return { port, log, close: () => new Promise(resolve => { for (const socket of sockets) socket.destroy(); server.close(resolve); }) };
}

/** auth: null for the "no authentication" method, or { user, pass } to demand RFC 1929 username/password. */
async function startSocks5({ names = {}, auth = null, sourceIp = SOURCE_IP, port: wanted = 0 } = {}) {
  const log = [], sockets = new Set();
  const server = net.createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => {});
    let stage = 'greeting', buffer = Buffer.alloc(0), up = null;
    const entry = { offered: [], method: null, login: null, atyp: null, host: null, port: null };
    log.push(entry); const fail = () => { socket.destroy(); };
    socket.on('data', chunk => {
      if (up) return; // tunnelling: the pipe below owns the data
      buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        if (stage === 'greeting') {
          if (buffer.length < 2) return; const count = buffer[1]; if (buffer.length < 2 + count) return;
          if (buffer[0] !== 5) return fail();
          entry.offered = [...buffer.subarray(2, 2 + count)]; buffer = buffer.subarray(2 + count);
          const want = auth ? 2 : 0;
          if (!entry.offered.includes(want)) { entry.method = 255; socket.write(Buffer.from([5, 255])); return fail(); }
          entry.method = want; socket.write(Buffer.from([5, want])); stage = auth ? 'login' : 'request';
        } else if (stage === 'login') {
          if (buffer.length < 2) return; const ulen = buffer[1]; if (buffer.length < 3 + ulen) return; const plen = buffer[2 + ulen]; if (buffer.length < 3 + ulen + plen) return;
          const user = buffer.subarray(2, 2 + ulen).toString(), pass = buffer.subarray(3 + ulen, 3 + ulen + plen).toString(); buffer = buffer.subarray(3 + ulen + plen);
          entry.login = user === auth.user && pass === auth.pass; socket.write(Buffer.from([1, entry.login ? 0 : 1])); if (!entry.login) return fail(); stage = 'request';
        } else if (stage === 'request') {
          if (buffer.length < 5) return; const atyp = buffer[3]; let host, offset;
          if (atyp === 3) { const len = buffer[4]; if (buffer.length < 5 + len + 2) return; host = buffer.subarray(5, 5 + len).toString(); offset = 5 + len; }
          else if (atyp === 1) { if (buffer.length < 10) return; host = [...buffer.subarray(4, 8)].join('.'); offset = 8; }
          else { if (buffer.length < 22) return; host = 'ipv6'; offset = 20; }
          const port = buffer.readUInt16BE(offset); entry.atyp = atyp; entry.host = host; entry.port = port;
          const origin = names[host];
          if (buffer[1] !== 1 || !origin) { socket.write(Buffer.from([5, 4, 0, 1, 0, 0, 0, 0, 0, 0])); return socket.end(); }
          up = net.connect({ host: '127.0.0.1', port: origin, localAddress: sourceIp }, () => { socket.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0])); up.pipe(socket); socket.pipe(up); });
          up.on('error', () => socket.destroy()); socket.on('close', () => up.destroy()); return;
        }
      }
    });
  });
  const port = await listen(server, "127.0.0.1", wanted);
  return { port, log, close: () => new Promise(resolve => { for (const socket of sockets) socket.destroy(); server.close(resolve); }) };
}

async function startUdpSink() {
  const log = [], socket = dgram.createSocket('udp4');
  socket.on('message', (message, remote) => log.push({ from: remote.address, size: message.length, stun: message.length >= 20 && message.readUInt32BE(4) === 0x2112a442 }));
  await new Promise((resolve, reject) => { socket.once('error', reject); socket.bind(0, '127.0.0.1', resolve); });
  return { port: socket.address().port, log, close: () => new Promise(resolve => socket.close(resolve)) };
}

async function startPacServer(script) {
  const requests = []; let body = script;
  const server = http.createServer((req, res) => { requests.push(req.url); res.writeHead(200, { 'content-type': 'application/x-ns-proxy-autoconfig', 'cache-control': 'no-store' }); res.end(typeof body === 'function' ? body() : body); });
  const port = await listen(server);
  return { port, requests, url: `http://127.0.0.1:${port}/proxy.pac`, set: next => { body = next; }, close: () => new Promise(resolve => { server.closeAllConnections?.(); server.close(resolve); }) };
}

module.exports = { SOURCE_IP, startOrigin, startHttpProxy, startSocks5, startUdpSink, startPacServer, basic };
