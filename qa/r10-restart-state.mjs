// Round 10: what the person sets up before closing the browser is what comes back: pinned tab, tab group, split, workspace, per-site zoom,
// window view, window size, and the closed-tab list (Reopen closed tab). Two launches on one profile; compares snapshot parts.
//   node qa/native-slot.mjs r10-restart -- node qa/r10-restart-state.mjs
import fs from 'node:fs/promises';
import {startApp, httpFixture, sleep, poll} from './d-harness.mjs';
const root = '.qa-profiles/r10-restart'; await fs.rm(root, {recursive: true, force: true});
const fx = await httpFixture((req, res) => { res.setHeader('content-type', 'text/html'); res.end(`<title>${req.url}</title>x`); });
const base = `http://127.0.0.1:${fx.port}`; const out = (k, v) => console.log(k.padEnd(30), typeof v === 'string' ? v : JSON.stringify(v));
const pick = async app => { const s = await app.state(); const bounds = await app.main(({BaseWindow}) => BaseWindow.getAllWindows()[0].getBounds()); return {
  tabs: s.tabs.filter(t => t.url.startsWith(base)).map(t => ({u: t.url.replace(base, ''), pinned: !!t.pinned, g: t.groupId ? 'g' : '', zoom: t.zoom})), active: s.tabs.find(t => t.id === s.activeTabId)?.url.replace(base, ''),
  groups: (s.tabGroups || []).map(g => ({name: g.name, color: g.color, collapsed: !!g.collapsed})), workspaces: (s.workspaces || []).map(w => w.name), activeWorkspace: s.workspaces?.find(w => w.id === s.activeWorkspaceId)?.name,
  split: s.windowUi.split?.tabIds?.map(id => s.tabs.find(t => t.id === id)?.url.replace(base, '')), view: s.windowUi.view ?? null, originZooms: s.originZooms, size: [bounds.width, bounds.height], closedBatches: (s.recentlyClosed || s.closedTabs || []).length, keys: Object.keys(s).filter(k => /closed|rewind|undo/i.test(k)),
}; };
const A = async a => { try { await app.act(a); return 'ok'; } catch (e) { out('ACT FAIL ' + a.type, String(e.message).slice(-80)); return 'fail'; } };
/** The active tab as the profile database holds it after the first launch closed (a copy, so the WAL is read too). */
async function persistedActive() {
  const {DatabaseSync} = await import('node:sqlite'); const copy = root + '/peek.sqlite'; for (const ext of ['', '-wal', '-shm']) await fs.copyFile(root + '/browser.sqlite' + ext, copy + ext).catch(() => {});
  const db = new DatabaseSync(copy); const found = [];
  for (const {name} of db.prepare("select name from sqlite_master where type='table'").all()) for (const row of db.prepare('select * from ' + name).all()) for (const v of Object.values(row)) { const m = typeof v === 'string' && /"activeTabId":"([^"]+)"/.exec(v); if (m) { const tabs = JSON.parse(v).tabs || []; found.push({table: name, active: tabs.find(t => t.id === m[1])?.url?.replace(base, '')}); } }
  db.close(); return found;
}
let app = await startApp({root}), before, after;
try {
  for (const p of ['/t1', '/t2', '/t3', '/t4', '/t5']) { await A({type: 'tab.new', url: base + p}); await app.waitWeb(base + p); }
  let s = await app.state(); const id = p => s.tabs.find(t => t.url === base + p).id;
  await A({type: 'tab.pin', id: id('/t1')});
  await A({type: 'tab.group.create', tabId: id('/t2'), name: 'Work', color: 'blue'}); s = await app.state();
  await A({type: 'tab.close', id: id('/t5')}); await sleep(700); // goes to the closed-tab list
  await A({type: 'tab.select', id: id('/t3')}); await sleep(500);
  await app.cmd({type: 'zoom', tabId: id('/t3'), zoom: 150}); await sleep(500); await A({type: 'ui.update', patch: {view: 'compact'}}); await sleep(500);
  if (!process.env.NO_WS) { await A({type: 'workspace.create', name: 'Reading'}); await sleep(500); s = await app.state();
  await A({type: 'workspace.select', id: s.workspaces.find(w => w.name !== 'Reading')?.id}); await sleep(400); }
  s = await app.state(); if (!process.env.NO_SPLIT) { await A({type: 'split.open', tabIds: [id('/t3'), id('/t4')].filter(Boolean)}); await sleep(500); }
  await app.main(({BaseWindow}) => { const w = BaseWindow.getAllWindows()[0]; w.setBounds({x: 120, y: 90, width: 1111, height: 777}); }); await sleep(1200);
  before = await pick(app); out('before', before);
} finally { await app.close(); }
await sleep(2000);
out('persisted active', await persistedActive());
app = await startApp({root});
try {
  const line = []; for (let i = 0; i < 8; i++) { const st = await app.state(); line.push(st.tabs.find(t => t.id === st.activeTabId)?.url.replace(base, '')); await sleep(350); } out('active over first 3s', line);
  after = await pick(app); out('after', after);
  const same = k => JSON.stringify(before[k]) === JSON.stringify(after[k]);
  for (const k of Object.keys(before)) if (!same(k)) out('DIFF ' + k, {before: before[k], after: after[k]});
  out('reopen closed tab', await A({type: 'tab.restore'}).then(() => 'ok', e => String(e.message).slice(0, 80)));
  await sleep(800); out('tabs after reopen', (await pick(app)).tabs.map(t => t.u));
} catch (e) { console.log('FAILED', String(e.stack || e.message).slice(0, 400)); } finally { await Promise.race([app.close(), sleep(5000)]); await fx.close(); process.exit(0); }
