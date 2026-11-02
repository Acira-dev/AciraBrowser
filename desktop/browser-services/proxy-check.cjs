'use strict';
// "Test" for a proxy the person is about to use. Connects to the proxy itself and nothing else: a SOCKS5 greeting, or an HTTP CONNECT to a closed local port, whose
// reply proves the proxy speaks that protocol. No website is contacted, nothing is saved, nothing is sent through it.
// The SOCKS5 greeting offers "no sign-in" and "username/password" (never sends either): a proxy that needs a sign-in answers with method 2,
// which is how the person is told Acira's engine cannot use it. Offering only "no sign-in" made strict proxies answer "no acceptable method"
// (255), which read as a generic refusal (found by qa/r3-network-proxy.mjs, S5).
const net = require('node:net'), { proxyChoice } = require('./proxy-settings.cjs'), { t } = require('./tx.cjs');
/** SOCKS5 is asked twice at most (R4-09: found against Tor's real SocksPort). First "no sign-in" alone: a proxy that accepts it answers 0 and is open, even
 * when it would have preferred a username (Tor chooses method 2 whenever it is offered, to isolate streams, yet accepts 0). Only a proxy that refuses it
 * (255) is asked again with both methods, which is how a proxy that really wants a login says so (2) instead of a bare refusal. */
async function checkProxy(input, options = {}) {
  const first = await probe(input, options, [0]);
  return first.refusedNoAuth ? probe(input, options, [0, 2]) : first;
}
function probe(input, { timeoutMs = 5000 } = {}, methods = [0, 2]) {
  let server;
  try { server = proxyChoice({ mode: 'fixed_servers', server: input, bypassHosts: [] }).server; } catch (error) { return Promise.resolve({ ok: false, message: String(error.message || error) }); }
  const where = `${server.host}:${server.port}`;
  return new Promise(resolve => {
    let done = false, buffer = Buffer.alloc(0);
    const socket = net.connect({ host: server.host.replace(/^\[|\]$/g, ''), port: server.port });
    const finish = (ok, message, extra) => { if (done) return; done = true; clearTimeout(timer); socket.destroy(); resolve({ ok, message, ...extra }); };
    const timer = setTimeout(() => finish(false, t('proxyTest.timeout', { where, seconds: Math.max(1, Math.round(timeoutMs / 1000)) })), timeoutMs);
    socket.on('error', error => finish(false, error.code === 'ECONNREFUSED' ? t('proxyTest.refused', { where }) : error.code === 'ENOTFOUND' || error.code === 'EAI_AGAIN' ? t('proxyTest.notFound', { host: server.host }) : t('proxyTest.connectFailed', { where, reason: error.code || error.message })));
    socket.on('close', () => finish(false, t('proxyTest.closed', { where, kind: server.scheme === 'socks5' ? 'SOCKS5' : 'HTTP' })));
    socket.on('connect', () => { socket.write(server.scheme === 'socks5' ? Buffer.from([5, methods.length, ...methods]) : 'CONNECT 127.0.0.1:9 HTTP/1.1\r\nHost: 127.0.0.1:9\r\n\r\n'); });
    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      if (server.scheme === 'socks5') {
        if (buffer.length < 2) return;
        if (buffer[0] !== 5) return finish(false, t('proxyTest.socksNot', { where }));
        if (buffer[1] === 0) return finish(true, t('proxyTest.socksOpen', { where }));
        if (buffer[1] === 255 && methods.length === 1) return finish(false, t('proxyTest.socksRefused', { where }), { refusedNoAuth: true });
        if (buffer[1] === 2) return finish(false, t('proxyTest.socksLogin', { where }));
        return finish(false, t('proxyTest.socksRefused', { where }));
      }
      const line = buffer.toString('latin1').split('\r\n')[0], match = /^HTTP\/1\.[01] (\d{3})/.exec(line);
      if (match) return finish(true, match[1] === '407' ? t('proxyTest.http407', { where }) : t('proxyTest.httpOk', { where }));
      if (buffer.length > 64 || buffer.includes(10)) finish(false, t('proxyTest.httpNot', { where }));
    });
  });
}
module.exports = { checkProxy };
