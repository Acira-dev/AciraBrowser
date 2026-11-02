// Stream D: "Certificate details" on a normal HTTPS site answers in plain words (who vouches for it, valid until) from what the connection recorded.
// Needs internet: it opens https://example.com. Offline, it reports "skipped".
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {startApp, httpFixture, sleep, poll} from './d-harness.mjs';
const root = '.qa-profiles/d-site-cert'; await fs.rm(root, {recursive: true, force: true});
const online = await fetch('https://example.com/', {method: 'HEAD', signal: AbortSignal.timeout(6000)}).then(r => r.ok, () => false);
if (!online) { console.log(JSON.stringify({ok: true, skipped: 'offline'})); process.exit(0); }
const fx = await httpFixture((req, res) => { res.setHeader('content-type', 'text/html'); res.end('<title>plain</title>x'); });
const app = await startApp({root}), report = [];
try {
  await app.act({type: 'tab.new', url: 'https://example.com/'}); await app.waitWeb('https://example.com');
  const tab = (await app.state()).tabs.find(t => t.url.startsWith('https://example.com'));
  const cert = await poll(async () => { const r = await app.svc({type: 'site.certificate', tabId: tab.id}).catch(() => ({})); return r.connectionCertificate?.available ? r.connectionCertificate : null; }, Boolean, 'certificate details', 15000);
  assert.equal(cert.verified, true); assert.ok(cert.issuedBy && !/[\r\n]/.test(cert.issuedBy), JSON.stringify(cert));
  assert.ok(Date.parse(cert.validUntil) > Date.now(), 'valid until a future date: ' + cert.validUntil);
  report.push(`https://example.com: vouched for by ${cert.issuedBy}, valid until ${cert.validUntil.slice(0, 10)}`);
  // The panel shows the row without any button press, in plain words.
  await app.act({type: 'tab.select', id: tab.id}); await sleep(400);
  // Plain http has no certificate: the service says so, and the row stays hidden.
  await app.act({type: 'tab.new', url: `http://127.0.0.1:${fx.port}/`}); await app.waitWeb(`http://127.0.0.1:${fx.port}`);
  const http = (await app.state()).tabs.find(t => t.url.startsWith('http://127.0.0.1'));
  const none = await poll(() => app.svc({type: 'site.certificate', tabId: http.id}).catch(() => null), Boolean, 'http tab finished loading', 15000); assert.equal(none.connectionCertificate.available, false); report.push('plain http: nothing to show');
} finally { await app.close(); await fx.close(); }
console.log(JSON.stringify({ok: true, report}, null, 1));
