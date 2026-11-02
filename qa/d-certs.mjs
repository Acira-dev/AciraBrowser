// Stream D: deliberate certificate Continue is scoped to exact origin + certificate + tab + profile + session, bounded, revocable.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {startApp, httpsFixture, sleep, poll} from './d-harness.mjs';
const root = '.qa-profiles/d-certs'; await fs.rm(root, {recursive: true, force: true}); await fs.mkdir(root, {recursive: true});
const hits = {};
const mk = name => httpsFixture(root, (req, res) => { hits[name] = (hits[name] || 0) + 1; res.setHeader('content-type', 'text/html'); res.end(`<title>secure ${name}</title><h1>${name}</h1>`); });
const a = await mk('a'), b = await mk('b'), report = [];
const app = await startApp({root});
try {
  const status = tabId => app.svc({type: 'certificates.status', tabId}).then(r => r.certificate);
  const open = async url => { await app.act({type: 'tab.new', url}); const t = await poll(async () => (await app.state()).tabs.at(-1), x => x.url.startsWith(url.slice(0, 20)) && (x.error || !x.loading), 'tab settled', 15000); await sleep(400); return (await app.state()).tabs.at(-1); };
  const A = `https://127.0.0.1:${a.port}/`; let tab = await open(A);
  assert.match(tab.error, /CERT_AUTHORITY_INVALID/); let st = await status(tab.id); assert.equal(st.failure.canContinue, true); assert.equal(st.failure.host, '127.0.0.1'); assert.equal(st.failure.port, a.port); assert.ok(st.failure.fingerprint); assert.equal(hits.a || 0, 0); report.push('untrusted cert blocks and exposes host/port/fingerprint without loading the site');
  // A stale / forged ticket never continues.
  await assert.rejects(app.svc({type: 'certificates.continue', tabId: tab.id, ticketId: 'forged'}), /changed or expired|warning/i); report.push('forged ticket rejected');
  const cont = await app.svc({type: 'certificates.continue', tabId: tab.id, ticketId: st.failure.ticketId}); assert.ok(cont.certificate.exception);
  await poll(async () => (await app.state()).tabs.find(t => t.id === tab.id).title, t => t === 'secure a', 'loads after Continue', 15000); assert.equal(hits.a, 1); report.push('Continue loads the exact destination');
  const ttl = cont.certificate.exception.expiresAt - Date.now(); assert.ok(ttl > 0 && ttl <= 10 * 60 * 1000, 'ttl ' + ttl); report.push(`exception lifetime bounded (${Math.round(ttl / 1000)}s)`);
  // Same tab, other port: not covered.
  const other = await open(`https://127.0.0.1:${b.port}/`); assert.match(other.error, /CERT_/); assert.equal(hits.b || 0, 0); report.push('other port stays blocked');
  // New tab to the same origin: exception is per tab.
  const same = await open(A); assert.match(same.error || '', /CERT_|BLOCKED_BY_CLIENT/); assert.equal(hits.a, 1, 'another tab must never reach the excepted origin'); report.push('exception is tab scoped (other tab cannot reach the origin)');
  // Other profile: same URL blocked, status has its own ticket.
  await app.act({type: 'browser.profile.create', name: 'B'}); const B = (await app.state()).browserProfiles.find(p => p.name === 'B');
  await app.act({type: 'tab.new', url: A, browserProfileId: B.id}); await sleep(2500); const bt = (await app.state()).tabs.at(-1); assert.match(bt.error || '', /CERT_/); report.push('other profile blocked');
  // Revoke: the original tab loses its exception and the page is blocked again.
  await app.act({type: 'tab.select', id: tab.id}); await sleep(400); const rv = await app.svc({type: 'certificates.revoke', tabId: tab.id}); assert.equal(rv.certificate.exception, null);
  await poll(async () => (await app.state()).tabs.find(t => t.id === tab.id).error, e => /CERT_/.test(e || ''), 'blocked after revoke', 15000); report.push('revoke restores the warning');
} finally { await app.close(); await a.close(); await b.close(); }
// localhost with a localhost certificate is eligible too.
const lh = await httpsFixture(root, (req, res) => { res.setHeader('content-type', 'text/html'); res.end('<title>secure lh</title>'); });
const app2 = await startApp({root});
try {
  await app2.act({type: 'tab.new', url: `https://localhost:${lh.port}/`}); await sleep(2500); const t = (await app2.state()).tabs.at(-1);
  const st = (await app2.svc({type: 'certificates.status', tabId: t.id})).certificate; assert.equal(st.failure?.canContinue, true); report.push('https://localhost can be continued deliberately');
} finally { await app2.close(); await lh.close(); }
console.log(JSON.stringify({ok: true, report}, null, 1));
