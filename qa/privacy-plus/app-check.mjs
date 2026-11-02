// Stream J: anti-tracking features working in the real isolated app.  node qa/privacy-plus/app-check.mjs   (cwd = worktree root)
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {startApp, httpFixture, sleep, poll} from '../d-harness.mjs';
const root = '.qa-profiles/j-privacy-plus'; await fs.rm(root, {recursive: true, force: true}); await fs.mkdir(root, {recursive: true});
const report = [];
const PAGE = `<!doctype html><title>pending</title><body><canvas id=c width=200 height=50></canvas>
<script async src="https://sst.overnightprints.com/collect.js"></script><img src="https://static.example.invalid/none.gif">
<script>const c=document.getElementById('c'),x=c.getContext('2d');x.fillStyle='#d8a';x.fillRect(0,0,200,50);x.fillStyle='#124';x.font='18px sans-serif';x.fillText('Acira 123',10,30);
let h=2166136261;const s=c.toDataURL();for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)>>>0;}
setTimeout(()=>{document.title='fp '+h.toString(16)+' hw '+navigator.hardwareConcurrency},1500);</script>`;
const server = await httpFixture((req, res) => { res.setHeader('content-type', 'text/html'); res.end(PAGE); });
const app = await startApp({root});
try {
  const open = async url => { await app.act({type: 'tab.new', url}); const tab = await poll(async () => (await app.state()).tabs.at(-1), t => t.url.startsWith(url.slice(0, 18)) && !t.loading, 'tab settled', 20000); await sleep(3500); return (await app.state()).tabs.find(t => t.id === tab.id); };
  const status = () => app.svc({type: 'antitracking.status'}).then(r => r.antiTracking);
  // defaults and honest rows
  let st = await status(); assert.deepEqual(st.settings, {cnameUncloaking: true, skipTrackingRedirects: true, stripTrackingParams: true, deAmp: true, fingerprint: 'standard', phishingLists: true, pageWarnings: true, passkeys: false}); report.push('defaults: hidden-tracker blocking on, tracking redirects on, fingerprint standard');
  const protection = (await app.svc({type: 'protection.status'})).protection; const row = id => protection.rows.find(r => r.id === id);
  assert.equal(row('cname-uncloaking').state, 'on'); assert.equal(row('fingerprint').state, 'on'); assert.equal(row('phishing-malware').state, 'on'); assert.match(row('phishing-malware').detail, /phishing/); // the public lists are on for everyone now (no key); the Google key stays optional below report.push('protection rows: ' + ['cname-uncloaking', 'tracking-redirects', 'fingerprint', 'phishing-malware'].map(id => id + '=' + row(id).state).join(', '));
  // CNAME uncloaking: a cloaked first-party-looking host (live DNS) is blocked after the normal check passes it
  let tab = await open(`http://127.0.0.1:${server.port}/`); let priv = (await app.svc({type: 'privacy.status', tabId: tab.id})).privacy;
  const cloaked = priv.details.find(d => d.hostname === 'sst.overnightprints.com');
  console.log('details', JSON.stringify(priv.details));
  assert.ok(cloaked, 'cloaked host is recorded as blocked'); assert.ok(cloaked.cname, 'record carries the canonical host'); report.push(`CNAME uncloaking: sst.overnightprints.com -> ${cloaked.cname} blocked (blocked count ${priv.blocked})`);
  const fingerprintOn = tab.title; assert.match(fingerprintOn, /^fp [0-9a-f]+ hw \d+$/); report.push('fingerprint standard page reads: ' + fingerprintOn);
  // switching it off applies to the next tab
  await app.svc({type: 'antitracking.set', patch: {cnameUncloaking: false, fingerprint: 'off'}});
  tab = await open(`http://127.0.0.1:${server.port}/?second`); priv = (await app.svc({type: 'privacy.status', tabId: tab.id})).privacy;
  assert.ok(!priv.details.some(d => d.hostname === 'sst.overnightprints.com'), 'no uncloaking when switched off'); assert.notEqual(tab.title, fingerprintOn); report.push('switched off: cloaked host passes, canvas differs: ' + tab.title);
  await app.svc({type: 'antitracking.set', patch: {cnameUncloaking: true, fingerprint: 'standard'}});
  // tracking redirect skipped before any request to the redirector
  await app.act({type: 'tab.new', url: 'https://go.skimresources.com/?url=https%3A%2F%2Fexample.org%2Fdestination'});
  const hopped = await poll(async () => (await app.state()).tabs.at(-1), t => t.url.startsWith('https://example.org/'), 'debounced navigation', 25000); report.push('tracking redirect skipped: ' + hopped.url);
  // Safe Browsing stays off and honest without a key
  const sb = (await app.svc({type: 'safebrowsing.status'})).safeBrowsing; assert.equal(sb.state, 'off-no-key'); assert.equal(sb.hasKey, false);
  await assert.rejects(app.svc({type: 'safebrowsing.set-key', key: 'not a key'}), /does not look like/); report.push('Safe Browsing: off without a key; a malformed key is refused with a readable message');
  await assert.rejects(app.svc({type: 'antitracking.set', patch: {fingerprint: 'maximum'}}), /off, standard or strict/); report.push('invalid setting rejected');
  console.log(report.map(r => ' - ' + r).join('\n'));
  await app.close(); process.exit(0);
} catch (error) { console.error('FAILED', error.message); try { await app.close(); } catch {} process.exit(1); }
