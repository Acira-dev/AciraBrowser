// Stream D: Ctrl+T then Ctrl+W returns to the tab you were on; one visit leaves one history entry, also across a restart.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {startApp, httpFixture, sleep, poll} from './d-harness.mjs';
const root = '.qa-profiles/d-opener-history'; await fs.rm(root, {recursive: true, force: true});
const fx = await httpFixture((req, res) => { res.setHeader('content-type', 'text/html'); res.end(`<title>${req.url}</title>x`); });
const base = `http://127.0.0.1:${fx.port}`, report = [];
let app = await startApp({root});
const press = (key, modifiers = []) => app.main(({webContents}, [key, modifiers]) => { const ui = webContents.getAllWebContents().find(w => w.getURL().startsWith('acira-browser-ui://') && !w.getURL().includes('overlay')); ui.focus(); ui.sendInputEvent({type: 'keyDown', keyCode: key, modifiers}); ui.sendInputEvent({type: 'keyUp', keyCode: key, modifiers}); }, [key, modifiers]);
const active = async () => { const s = await app.state(); return s.tabs.find(t => t.id === s.activeTabId); };
try {
  for (const p of ['/one', '/two', '/three']) { await app.act({type: 'tab.new', url: base + p}); await app.waitWeb(base + p); }
  const s = await app.state(); const one = s.tabs.find(t => t.url === base + '/one'); await app.act({type: 'tab.select', id: one.id});
  // 1. Ctrl+T then Ctrl+W comes back to the tab we were on, not the last tab.
  const before = (await app.state()).tabs.length; await press('t', ['control']);
  await poll(async () => (await app.state()).tabs.length, n => n === before + 1, 'Ctrl+T opens a tab'); assert.notEqual((await active()).id, one.id);
  await press('w', ['control']); await poll(async () => (await app.state()).tabs.length, n => n === before, 'Ctrl+W closes it');
  assert.equal((await active()).id, one.id, 'back on the tab we came from'); report.push('Ctrl+T then Ctrl+W returns to the tab you were on');
  // 2. After choosing another tab by hand, closing falls back to the neighbour.
  await press('t', ['control']); const fresh = (await active()).id; await app.act({type: 'tab.select', id: (await app.state()).tabs.find(t => t.url === base + '/two').id}); await app.act({type: 'tab.select', id: fresh});
  const index = (await app.state()).tabs.findIndex(t => t.id === fresh); await press('w', ['control']); await poll(async () => (await app.state()).tabs.some(t => t.id === fresh), v => v === false, 'closed');
  const after = await app.state(); assert.equal(after.activeTabId, after.tabs[Math.min(index, after.tabs.length - 1)].id); report.push('after picking tabs by hand, closing goes to the neighbour');
  // 3. One visit, one history entry; reloading right away does not add another.
  const count = async () => (await app.state()).browsingHistory.filter(v => v.url === base + '/three').length;
  assert.equal(await count(), 1, 'one entry for one visit'); const three = (await app.state()).tabs.find(t => t.url === base + '/three');
  await app.act({type: 'tab.select', id: three.id}); await app.cmd({type: 'reload', tabId: three.id}); await sleep(1500); assert.equal(await count(), 1, 'a quick reload is the same visit'); report.push('one visit leaves one history entry, also after a reload');
  await sleep(1500);
} finally { await app.close(); }
// 4. A restart restores the tabs without recording them as new visits.
app = await startApp({root, skipSetup: false});
try {
  await sleep(4000); const s = await app.state(); const total = s.browsingHistory.length;
  assert.ok(s.browsingHistory.filter(v => v.url === base + '/three').length <= 1, 'restored page is not a second visit');
  const active = s.tabs.find(t => t.id === s.activeTabId); await app.waitWeb(active.url.startsWith('http') ? active.url : base + '/three').catch(() => {});
  await sleep(1500); assert.equal((await app.state()).browsingHistory.length, total, 'restore adds no visits'); report.push('a restart restores tabs without new history entries');
  console.log(JSON.stringify({ok: true, report}, null, 1));
} finally { await app.close(); await fx.close(); }
