// R3-44 row "Split view: open and unsplit". Real app, isolated profile, one instance, 4 tabs, closed in finally.   node qa/r3-proof/split-unsplit.mjs
// Opens two tabs side by side (both pages on screen, neither reloaded), changes the layout, renames the split, then Unsplit: both tabs are ordinary tabs again,
// the same pages (same JS state, so no reload) with their history; Close split closes the pair as one undoable batch and Undo brings them back.
import fs from 'node:fs';
import path from 'node:path';
import {startApp, httpFixture, poll} from '../d-harness.mjs';
import {probe, withSlot, sleep, captureWindow} from './lib.mjs';

const P = probe('split-unsplit');
const root = path.resolve('.qa-profiles/r3-proof-split');
fs.rmSync(root, {recursive: true, force: true}); fs.mkdirSync(root, {recursive: true});
const COLORS = {a: '#dfe9d8', b: '#e6dccb', c: '#d6dde8'};
const site = await httpFixture((req, res) => { const key = req.url.split('?')[0].slice(1) || 'a'; res.setHeader('content-type', 'text/html'); res.end(`<!doctype html><title>Pane ${key}</title><body style="margin:0;background:${COLORS[key] || '#eee'};font:48px system-ui;display:grid;place-items:center;height:100vh">Pane ${key.toUpperCase()}`); });
const base = `http://127.0.0.1:${site.port}`;

await withSlot('proof-split', async () => {
  const app = await startApp({root});
  try {
    await app.main(({BaseWindow}) => { const win = BaseWindow.getAllWindows()[0]; win.setBounds({x: 40, y: 40, width: 1500, height: 900}); });
    await app.act({type: 'settings.update', patch: {language: 'en', onboardingComplete: true, appearance: 'light'}});
    const ui = async () => (await app.state());
    const homeId = (await ui()).tabs[0].id;
    await app.act({type: 'tab.navigate', tabId: homeId, url: `${base}/a`});
    await app.act({type: 'tab.new', url: `${base}/b`});
    await app.act({type: 'tab.new', url: `${base}/c`});
    let s = await poll(ui, v => v.tabs.length === 3 && v.tabs.every(t => !t.loading && /Pane/.test(t.title || '')), 'three tabs loaded', 25000);
    const [A, B, C] = s.tabs.map(t => t.id);
    // A page-side marker per page: still there after every step means the page was never reloaded.
    for (const [id, key] of [[A, 'a'], [B, 'b'], [C, 'c']]) { await app.act({type: 'tab.select', id}); const page = await app.waitWeb(u => u.endsWith('/' + key), 'page ' + key); await page.evaluate(k => { window.__marker = 'alive-' + k + '-' + Math.random().toString(36).slice(2); }, key); }
    const markers = async () => Object.fromEntries(await Promise.all(['a', 'b', 'c'].map(async key => { const page = app.web(u => u.endsWith('/' + key)); return [key, page ? await page.evaluate(() => window.__marker || null).catch(() => 'error') : 'closed']; })));
    const before = await markers();
    await app.act({type: 'tab.select', id: A});

    // 1. Open.
    await app.act({type: 'split.open', tabIds: [A, B]});
    s = await poll(ui, v => v.windowUi.split?.tabIds?.length === 2, 'split open', 8000);
    const group = s.windowUi.splitGroups?.[0];
    P.check('Split opens two tabs as one group', JSON.stringify(s.windowUi.split.tabIds) === JSON.stringify([A, B]) && s.windowUi.splitGroups?.length === 1 && group?.id === s.windowUi.split.groupId, JSON.stringify({split: s.windowUi.split.tabIds, layout: s.windowUi.split.layout, groups: s.windowUi.splitGroups?.length}));
    await sleep(900);
    const layout = await app.ui.evaluate(() => window.acira.getBrowserLayout());
    fs.writeFileSync(P.shot('layout-split.json'), JSON.stringify(layout, null, 2));
    const views = (layout.views || []).filter(v => (v.visible !== false) && (v.bounds?.width ?? v.width ?? 0) > 50);
    const boxes = views.map(v => v.bounds || {x: v.x, y: v.y, width: v.width, height: v.height});
    const sideBySide = boxes.length >= 2 && boxes.some((p, i) => boxes.some((q, j) => i < j && (Math.abs(p.x - q.x) > 100 || Math.abs(p.y - q.y) > 100)));
    const shot1 = await captureWindow(app, P.shot('split-open.png'));
    P.check('both pages are on screen at once, in their own panes', sideBySide, `${boxes.length} visible web views: ${JSON.stringify(boxes.map(b => [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]))}`, shot1);
    // 2. Layout + rename.
    await app.act({type: 'split.layout', layout: 'rows'});
    s = await ui();
    P.check('the layout changes (side by side -> stacked)', s.windowUi.split?.layout === 'rows', `layout ${s.windowUi.split?.layout}`);
    await app.act({type: 'split.rename', groupId: group.id, name: 'Compare A and B'});
    s = await ui();
    P.check('the split can be renamed', s.windowUi.splitGroups?.find(g => g.id === group.id)?.name === 'Compare A and B', JSON.stringify(s.windowUi.splitGroups?.map(g => g.name)));
    const duringSplit = await markers();
    P.check('opening and changing the split never reloaded either page', before.a === duringSplit.a && before.b === duringSplit.b && before.a !== null, JSON.stringify({before: before, during: duringSplit}));

    // 3. Unsplit.
    await app.act({type: 'split.unsplit', groupId: group.id});
    s = await poll(ui, v => !v.windowUi.split && !(v.windowUi.splitGroups || []).length, 'unsplit', 8000);
    const after = await markers();
    P.check('Unsplit ends the split and keeps both tabs as ordinary tabs', s.windowUi.split === null && s.tabs.some(t => t.id === A) && s.tabs.some(t => t.id === B) && !s.windowUi.splitGroups?.length, `tabs ${s.tabs.map(t => t.title).join(' | ')}`);
    P.check('both pages are the same live pages (no reload, JS state kept)', after.a === before.a && after.b === before.b, JSON.stringify({before, after}));
    const visibleViews = async () => { const l = await app.ui.evaluate(() => window.acira.getBrowserLayout()); return {l, shown: (l.views || []).filter(v => (v.visible !== false) && (v.bounds?.width ?? v.width ?? 0) > 50)}; };
    let after2 = await visibleViews();
    for (let i = 0; i < 16 && after2.shown.length !== 1; i++) { await sleep(250); after2 = await visibleViews(); }
    fs.writeFileSync(P.shot('layout-unsplit.json'), JSON.stringify(after2.l, null, 2));
    const shot2 = await captureWindow(app, P.shot('split-unsplit.png'));
    P.check('after Unsplit only the selected tab fills the page area', after2.shown.length === 1, `${after2.shown.length} visible web view(s) of ${(after2.l.views || []).length} listed`, shot2);
    // history still reaches both: select B, it is its own tab with its page.
    await app.act({type: 'tab.select', id: B}); s = await ui();
    P.check('each former pane can be opened on its own', s.activeTabId === B && s.tabs.find(t => t.id === B)?.url === `${base}/b` && s.tabs.find(t => t.id === A)?.url === `${base}/a`, `A ${s.tabs.find(t => t.id === A)?.url} B ${s.tabs.find(t => t.id === B)?.url}`);

    // 4. Close split closes the pair as one undoable batch.
    await app.act({type: 'split.open', tabIds: [A, B]});
    s = await poll(ui, v => v.windowUi.splitGroups?.length === 1, 'split again', 8000);
    await app.act({type: 'split.close', groupId: s.windowUi.splitGroups[0].id});
    s = await poll(ui, v => !v.tabs.some(t => t.id === A) && !v.tabs.some(t => t.id === B), 'pair closed', 8000);
    P.check('Close split closes both of its tabs and the third tab stays', s.tabs.length === 1 && s.tabs[0].id === C && !s.windowUi.splitGroups?.length, `tabs left: ${s.tabs.map(t => t.title).join(' | ')}`);
    await app.act({type: 'tab.restore'}); await sleep(1200);
    s = await ui();
    P.check('one Undo brings the pair back', s.tabs.length >= 3 && s.tabs.filter(t => [`${base}/a`, `${base}/b`].includes(t.url)).length === 2, `tabs: ${s.tabs.map(t => t.url.replace(base, '')).join(' ')}`);
  } finally {
    await app.close();
  }
});
await site.close();
P.finish();
process.exit(P.checks.every(c => c.ok) && P.checks.length ? 0 : 1);
