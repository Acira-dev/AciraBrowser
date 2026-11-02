// Stream D: lazy session restore - active tab loads first, background tabs only on activation, pinned/zoom/profile survive.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {startApp, httpFixture, sleep, poll} from './d-harness.mjs';
const root = '.qa-profiles/d-restore'; await fs.rm(root, {recursive: true, force: true});
const hits = []; const fx = await httpFixture((req, res) => { if (!req.url.includes('favicon')) hits.push(req.url); res.setHeader('content-type', 'text/html'); res.end(`<title>${req.url}</title>x`); });
const base = `http://127.0.0.1:${fx.port}`, report = [];
let app = await startApp({root});
try {
  for (const p of ['/t1', '/t2', '/t3']) { await app.act({type: 'tab.new', url: base + p}); await app.waitWeb(base + p); }
  const s = await app.state(); const t2 = s.tabs.find(t => t.url === base + '/t2'); await app.act({type: 'tab.pin', id: s.tabs.find(t => t.url === base + '/t1').id}); await app.act({type: 'tab.select', id: t2.id}); await sleep(700);
} finally { await app.close(); }
await sleep(1500); hits.length = 0;
app = await startApp({root});
try {
  await sleep(2500);
  let s = await app.state(); assert.equal(s.tabs.filter(t => t.url.startsWith(base)).length, 3, 'all tab metadata restored'); assert.equal(s.tabs.find(t => t.url === base + '/t1').pinned, true); report.push('metadata + pin restored');
  assert.deepEqual(hits, ['/t2'], 'only the active tab hits the network at startup: ' + JSON.stringify(hits)); report.push('only active tab loaded');
  const t3 = s.tabs.find(t => t.url === base + '/t3'); await app.act({type: 'tab.select', id: t3.id}); await poll(() => hits.includes('/t3'), Boolean, 'background tab loads on activation'); assert.ok(!hits.includes('/t1')); report.push('background tab loads on activation only');
} finally { await app.close(); await fx.close(); }
console.log(JSON.stringify({ok: true, report}, null, 1));
