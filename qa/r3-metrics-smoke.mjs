// Round 3 (network) R3-11: the real app builds the schema 2 usage message from real state. No endpoint is configured, so nothing is sent.
// Checks: facts follow Settings, feature counters count only while on, "See what's sent" (metrics.status) is the exact payload, nothing is counted while off.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {startApp, sleep} from './d-harness.mjs';
const ROOT = '.qa-profiles/r3-metrics-smoke'; await fs.rm(ROOT, {recursive: true, force: true});
async function takeSlot(name) { for (let i = 0; i < 40; i++) { for (const n of [1, 2, 3]) { try { const h = await fs.open(`C:/ae/slot-${n}.lock`, 'wx'); await h.write(`${name} ${new Date().toISOString()}`); await h.close(); return n; } catch (e) { if (e.code !== 'EEXIST') throw e; } } await sleep(30000); } throw new Error('no slot'); }
const slot = await takeSlot('network-r3-11'); let app; const out = {};
try {
  app = await startApp({root: ROOT});
  const status = async () => (await app.svc({type: 'metrics.status'})).metrics;
  let m = await status(); out.off = m.payload;
  assert.equal(m.enabled, false); assert.equal(m.payload.schema, 2); assert.equal(m.payload.torTabs, '0');
  await app.act({type: 'tab.new', url: 'acira://new', privacy: 'private'}); // counted nowhere: usage is off
  assert.equal((await status()).payload.privateTabs, '0', 'nothing counted while off');
  await app.svc({type: 'metrics.set', enabled: true});
  await app.act({type: 'settings.update', patch: {appearance: 'dark', verticalTabs: true}});
  await app.act({type: 'tab.new', url: 'acira://new', privacy: 'private'}); await app.act({type: 'tab.new', url: 'acira://new', privacy: 'private'});
  await sleep(500);
  m = await status(); out.on = m.payload; out.file = await fs.readFile(ROOT + '/metrics.json', 'utf8').catch(e => String(e)); out.tabs = (await app.state()).tabs.map(t => [t.url, t.privacy]);
  assert.equal(m.enabled, true); assert.equal(m.payload.theme, 'dark'); assert.equal(m.payload.tabLayout, 'sidebar'); assert.equal(m.payload.privateTabs, '2-5'); assert.equal(m.payload.torTabs, '0');
  assert.equal(m.payload.uiLanguage.length >= 2, true); assert.ok(['on', 'off', 'unknown'].includes(m.payload.vpn)); assert.ok(m.payload.profiles === '1');
  assert.doesNotMatch(JSON.stringify(m.payload), /https?:|[A-Z]:\\|@/);
  await app.svc({type: 'metrics.set', enabled: false});
  m = await status(); assert.equal(m.payload.privateTabs, '0', 'turning it off deletes the counts'); assert.equal(m.payload.installId, '00000000-0000-4000-8000-000000000000');
  console.log(JSON.stringify({ok: true, on: out.on}, null, 1));
} catch (error) { console.log('FAILED', error.message.slice(0, 200), '|FILE', out.file, '|TABS', JSON.stringify(out.tabs)); process.exitCode = 1; }
finally { try { await app?.close(); } catch {} await fs.rm(`C:/ae/slot-${slot}.lock`, {force: true}); }
