// Stream L: every drag and drop in the real app, with real input. Prints a pass/fail table; exits 1 if anything fails.
//   node qa/l-drag-drop.mjs        isolated profile under .qa-profiles, one Electron instance, closed in finally.
// Pointer drags (tabs) use webContents.sendInputEvent mouseDown / moves / mouseUp; HTML5 drags (favourites, bookmarks, links,
// text, files) use a real mouse press inside the source view and Chromium's own drag pipeline (qa/l-dnd-lib.js).
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { launchPreparedNative } from './prepared-native.mjs';

// Off-screen and not activated by default (nothing on the founder's screen, no stolen focus; it still renders, which pointer drags need); --visible puts it on screen.
const visible = process.argv.includes('--visible');
const data = path.resolve('.qa-profiles/l-dnd-' + Date.now());
const pages = {
  '/links.html': '<h1>Links</h1><p><a id="a" href="/target-a.html">Link A</a></p><p><a id="b" href="/target-b.html">Link B</a></p><p id="t">Some text to drag</p>',
  '/drop.html': '<h1>Drop</h1><div id="zone" style="position:fixed;left:200px;top:200px;width:300px;height:150px;border:2px dashed #888">Drop files here</div><script>const z=document.getElementById("zone");z.ondragover=e=>e.preventDefault();z.ondrop=e=>{e.preventDefault();const f=e.dataTransfer.files[0];z.textContent="name "+(f&&f.name);f&&f.text().then(t=>{z.textContent+=" text "+t.trim()})}</script>',
  '/plain.html': '<h1>No drop handler</h1>',
};
const server = http.createServer((req, res) => { const path = req.url.split('?')[0]; if (path === '/dl.bin') { res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="dl.bin"', 'Content-Length': 2048 }); res.end(Buffer.alloc(2048, 7)); return; } res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(`<!doctype html><title>${path}</title><body style="font:16px system-ui;margin:40px">${pages[path] || '<h1>' + path + '</h1>'}`); });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;
const dropFile = path.join(data, 'drop-test.txt');
await fs.mkdir(data, { recursive: true }); await fs.writeFile(dropFile, 'Acira drop test\n');
const LIB = await fs.readFile(path.resolve('qa/l-dnd-lib.js'), 'utf8');

const app = await launchPreparedNative({
  executablePath: createRequire(import.meta.url)('electron'), // Off-screen windows must keep rendering at full rate (Windows would otherwise treat them as hidden and pointer drags turn flaky).
  args: [path.resolve('desktop/main.cjs'), '--disable-features=CalculateNativeWinOcclusion', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
  env: { ...process.env, ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: data, LOCALAPPDATA: path.resolve('.qa-profiles/import-fixture'), ACIRA_BROWSER_TEST_DOWNLOAD_DIR: path.join(data, 'downloads'), ...(visible ? {} : { ACIRA_BROWSER_TEST_HIDDEN: '1' }) }, timeout: 40000,
});
const wait = ms => new Promise(r => setTimeout(r, ms));
const find = async test => { for (let i = 0; i < 300; i++) { const p = app.windows().find(p => test(p.url())); if (p) return p; await wait(100); } throw Error('page not found'); };
const ui = await find(u => u === 'acira-browser-ui://ui/index.html');
const errors = [];
ui.on('pageerror', e => errors.push('pageerror: ' + e.message));
try { await ui.getByRole('button', { name: 'Skip setup', exact: true }).click({ timeout: 8000 }); } catch {}
await app.evaluate(({ screen, BaseWindow }, visible) => { const d = screen.getPrimaryDisplay(), w = BaseWindow.getAllWindows()[0]; /* off-screen and not activated: it still renders (pointer drags need that) but never shows or takes focus */ w.setBounds({ x: visible ? d.workArea.x + 40 : -3000, y: d.workArea.y + 20, width: 1400, height: 860 }); if (visible) w.focus(); else w.showInactive(); }, visible);
const dnd = (name, ...args) => app.evaluate(({ webContents }, [src, name, args]) => { globalThis.__dndLib ||= new Function('return (' + src + ')')()({ webContents }); return globalThis.__dndLib[name](...args); }, [LIB, name, args]);
const snap = async () => (lastSnap = await ui.evaluate(() => window.acira.getSnapshot()));
const act = a => ui.evaluate(a => window.acira.dispatch(a), a);
const windows = () => app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().length);
const centre = (selector, nth = 0) => ui.evaluate(([s, n]) => { const e = [...document.querySelectorAll(s)].filter(e => e.offsetParent)[n]; if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.x + b.width / 2), Math.round(b.y + b.height / 2), Math.round(b.width), Math.round(b.height)]; }, [selector, nth]);
const pageCentre = async (part, selector) => (await app.evaluate(({ webContents }, [part, selector]) => webContents.getAllWebContents().find(w => w.getURL().includes(part))?.executeJavaScript(`(()=>{const b=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return [Math.round(b.x+10),Math.round(b.y+b.height/2)]})()`), [part, selector]));
// An intercepted drag leaves its source page mid-gesture, so the page is reloaded before every link drag.
const showLinks = async () => { await act({ type: 'tab.select', id: (await snap()).tabs.find(t => t.url.includes('/links.html')).id }); await wait(700); await app.evaluate(({ webContents }) => webContents.getAllWebContents().find(w => w.getURL().includes('/links.html'))?.reload()); await wait(1200); };
let lastSnap = null; const ids2sync = part => lastSnap.tabs.find(t => t.url.includes(part)).id;
const order = async () => (await snap()).tabs.map(t => t.id);
const short = id => id.slice(4, 10);

const rows = [];
const record = (name, ok, detail = '') => { rows.push({ name, ok, detail }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  — ' + detail : '')); };
async function check(name, fn) { try { const r = await fn(); record(name, r.ok, r.detail); } catch (e) { record(name, false, 'threw: ' + String(e.message).slice(0, 160)); } }
const MAX_TABS = 14;
const openTab = async url => { const before = (await snap()).tabs.length; if (before >= MAX_TABS) throw Error('tab cap'); await act({ type: 'tab.new', url }); await wait(300); if ((await snap()).tabs.length !== before + 1) throw Error('tab.new did not add a tab; aborting'); };
const stripTabs = () => ui.evaluate(() => [...document.querySelectorAll('.tab-strip-viewport .browser-tab')].filter(e => e.offsetParent).map(e => { const b = e.getBoundingClientRect(); return { id: e.dataset.tabId, x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) }; }));
const sidebarTabs = () => ui.evaluate(() => [...document.querySelectorAll('.sb-tab[data-tab-id]')].filter(e => e.offsetParent).map(e => { const b = e.getBoundingClientRect(); return { id: e.dataset.tabId, x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) }; }));
const appLabels = () => ui.evaluate(() => [...document.querySelectorAll('.sb-app[data-app-id]')].map(a => (a.getAttribute('aria-label') || a.textContent).trim().slice(0, 24)));

let exitCode = 1;
try {
  // ---- Fixture (at most 8 tabs): links, drop zone, plain page, three more.
  await act({ type: 'tab.navigate', url: base + '/links.html' }); await wait(500);
  for (const p of ['/drop.html', '/plain.html', '/t1', '/t2', '/t3', '/t4']) await openTab(base + p);
  await act({ type: 'settings.update', patch: { verticalTabs: false } }); await wait(900);
  let ids = await order();

  // ---- Tabs in the top strip
  await check('strip: reorder a tab', async () => {
    const t = await stripTabs(), moving = t[0], before = await order();
    await dnd('pdrag', [[moving.x, moving.y], [t[1].x, 18], [t[3].x, 18], [t[3].x + 40, 18]]);
    const after = await order();
    return { ok: after.indexOf(moving.id) > before.indexOf(moving.id), detail: `${short(moving.id)} index ${before.indexOf(moving.id)} -> ${after.indexOf(moving.id)}` };
  });
  await act({ type: 'tab.group.create', tabId: (await order())[2], name: 'DnD' }); await wait(300);
  let s = await snap(); await act({ type: 'tab.group.assign', tabIds: [(await order())[3]], groupId: s.tabGroups[0].id }); await wait(500);
  await check('strip: drag a tab into a group', async () => {
    const t = await stripTabs(), s0 = await snap(), member = s0.tabs.find(x => x.group), outsider = s0.tabs.filter(x => !x.group && !x.pinned).at(-1), mt = t.find(x => x.id === member.id), ot = t.find(x => x.id === outsider.id);
    await dnd('pdrag', [[ot.x, ot.y], [(ot.x + mt.x) / 2, 20], [mt.x + 20, 18], [mt.x + 24, 18]]);
    const joined = (await snap()).tabs.find(x => x.id === outsider.id);
    return { ok: !!joined.group, detail: `group of ${short(outsider.id)}: ${JSON.stringify(joined.group)}` };
  });
  await check('strip: drag a tab out of its group', async () => {
    const s0 = await snap(), member = s0.tabs.filter(x => x.group)[0], t = await stripTabs(), mt = t.find(x => x.id === member.id), last = t.at(-1);
    await dnd('pdrag', [[mt.x, mt.y], [mt.x + 60, 18], [last.x + 120, 18], [last.x + 200, 18]]);
    const left = (await snap()).tabs.find(x => x.id === member.id);
    return { ok: !left.group, detail: `group of ${short(member.id)}: ${JSON.stringify(left.group)}` };
  });
  await check('strip: drag a tab onto the page, drop it on the picker\'s right-hand zone to split', async () => {
    // Round 2 (B): the page brings up the Snap-style picker; its first layout (side by side) has the right-hand zone at
    // this offset from the centred card (src/ui/splitDrop.ts pickerGeometry: 124px thumbnails, 14px padding, 30px header).
    const t = await stripTabs(), from = t.at(-1);
    const area = await ui.evaluate(() => { const b = document.querySelector('.page-area').getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
    const cardX = Math.round((area.w - 288) / 2), cardY = Math.round(Math.min(140, Math.max(20, area.h * .14)));
    const zone = [Math.round(area.x + cardX + 14 + 92), Math.round(area.y + cardY + 30 + 39)];
    await dnd('pdrag', [[from.x, from.y], [from.x, 120], [Math.round(area.x + area.w / 2), Math.round(area.y + area.h / 2)], zone], { hold: 900 });
    const split = (await snap()).windowUi.split; if (split) await act({ type: 'split.close' });
    return { ok: !!split, detail: split ? 'split opened' : 'no split' };
  });
  await check('strip: drag a tab out of the window to a new window', async () => {
    const t = await stripTabs(), from = t[1], n0 = await windows(), tabs0 = (await snap()).tabs.length;
    const known = await app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().map(w => w.id));
    const bottom = await ui.evaluate(() => innerHeight); // the window may be bigger than asked off-screen: go clearly past its real edge
    await dnd('pdrag', [[from.x, from.y], [from.x, 150], [from.x, bottom - 100], [from.x, bottom + 140]], { hold: 300 });
    await wait(1200);
    const n1 = await windows(), tabs1 = (await snap()).tabs.length;
    // The new window comes up in front; close it so the next checks keep talking to the first window.
    await app.evaluate(({ BaseWindow }, known) => { for (const w of BaseWindow.getAllWindows()) if (!known.includes(w.id)) w.destroy(); }, known); await wait(800);
    return { ok: n1 === n0 + 1, detail: `windows ${n0} -> ${n1}, tabs ${tabs0} -> ${tabs1}` };
  });
  // What the strip sends when a tab is let go outside the window: tab.move-window with the screen point. Driven through the same action.
  const windowIds = () => app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().map(w => w.id));
  const closeNewWindows = async known => { await app.evaluate(({ BaseWindow }, known) => { for (const w of BaseWindow.getAllWindows()) if (!known.includes(w.id)) w.destroy(); }, known); await wait(600); };
  await check('strip: a tab let go at a screen point opens a new window under it', async () => {
    await openTab(base + '/mv1');
    const known = await windowIds(), s0 = await snap(), moving = s0.tabs.find(t => t.url.endsWith('/mv1')), point = { x: 500, y: 300 };
    await act({ type: 'tab.move-window', id: moving.id, at: point }); await wait(2500);
    const fresh = await app.evaluate(({ BaseWindow, screen }, [known, point]) => BaseWindow.getAllWindows().filter(w => !known.includes(w.id)).map(w => ({ b: w.getBounds(), area: screen.getDisplayNearestPoint(point).workArea })), [known, point]);
    await closeNewWindows(known);
    const b = fresh[0]?.b, area = fresh[0]?.area;
    // Under the pointer (the strip row), with its title row on the screen.
    const under = !!b && point.x >= b.x && point.x <= b.x + b.width && point.y >= b.y && point.y <= b.y + 60;
    const onScreen = !!b && b.x >= area.x && b.y >= area.y && b.x < area.x + area.width - 100 && b.y < area.y + area.height - 60; // the title row is on this screen; the body may hang past an edge, as in Chrome
    return { ok: under && onScreen, detail: b ? `new window at ${b.x},${b.y} ${b.width}x${b.height}; the point was ${point.x},${point.y}` : 'no new window' };
  });
  await check('strip: a tab let go over another window of the same profile joins it', async () => {
    const known = await windowIds();
    await ui.evaluate(() => window.acira.openWindow('normal'));
    let other = null;
    for (let i = 0; i < 100 && !other; i++) { other = app.windows().find(p => p !== ui && p.url() === 'acira-browser-ui://ui/index.html') || null; if (!other) await wait(100); }
    if (!other) return { ok: false, detail: 'the second window did not open' };
    await wait(1500);
    await app.evaluate(({ BaseWindow }, known) => { const w = BaseWindow.getAllWindows().find(w => !known.includes(w.id)); w.setBounds({ x: 300, y: 200, width: 800, height: 500 }); }, known);
    await openTab(base + '/mv2');
    const s0 = await snap(), moving = s0.tabs.find(t => t.url.endsWith('/mv2'));
    const otherBefore = (await other.evaluate(() => window.acira.getSnapshot())).tabs.length;
    await act({ type: 'tab.move-window', id: moving.id, at: { x: 700, y: 230 } }); await wait(2500);
    const s1 = await snap(), otherAfter = (await other.evaluate(() => window.acira.getSnapshot())).tabs;
    const windowsAfter = await windowIds();
    await closeNewWindows(known);
    return { ok: !s1.tabs.some(t => t.id === moving.id) && otherAfter.some(t => t.url === moving.url) && windowsAfter.length === known.length + 1, detail: `this window ${s0.tabs.length} -> ${s1.tabs.length} tabs; the other ${otherBefore} -> ${otherAfter.length}; windows ${known.length} -> ${windowsAfter.length}` };
  });

  // ---- Sidebar
  await act({ type: 'settings.update', patch: { verticalTabs: true } }); await wait(1400);
  await check('sidebar: reorder a tab', async () => {
    const t = await sidebarTabs(), moving = t.at(-1), before = await order();
    await dnd('pdrag', [[moving.x, moving.y], [moving.x, moving.y - 25], [t[1].x, t[1].y - 4], [t[1].x, t[1].y - 8]]);
    const after = await order();
    return { ok: after.indexOf(moving.id) < before.indexOf(moving.id), detail: `${short(moving.id)} index ${before.indexOf(moving.id)} -> ${after.indexOf(moving.id)}` };
  });
  await check('sidebar: drag a tab into a group', async () => {
    const s0 = await snap(); if (!s0.tabGroups.length) { await act({ type: 'tab.group.create', tabId: (await order())[1], name: 'DnD' }); await wait(400); }
    const s1 = await snap(), member = s1.tabs.find(x => x.group), outsider = s1.tabs.filter(x => !x.group && !x.pinned).at(-1), t = await sidebarTabs(), mt = t.find(x => x.id === member.id), ot = t.find(x => x.id === outsider.id);
    await dnd('pdrag', [[ot.x, ot.y], [ot.x, ot.y - 30], [mt.x, mt.y + 4], [mt.x, mt.y + 2]]);
    const joined = (await snap()).tabs.find(x => x.id === outsider.id);
    return { ok: !!joined.group, detail: `group of ${short(outsider.id)}: ${JSON.stringify(joined.group)}` };
  });
  await check('sidebar: drag a tab out of its group', async () => {
    const s0 = await snap(), member = s0.tabs.filter(x => x.group)[0], t = await sidebarTabs(), mt = t.find(x => x.id === member.id), last = t.at(-1);
    await dnd('pdrag', [[mt.x, mt.y], [mt.x, mt.y + 30], [last.x, last.y + 6], [last.x, last.y + 12]]);
    const left = (await snap()).tabs.find(x => x.id === member.id);
    return { ok: !left.group, detail: `group of ${short(member.id)}: ${JSON.stringify(left.group)}` };
  });
  await check('sidebar: drag a tab to Favourites', async () => {
    const n0 = (await appLabels()).length, target = await centre('.sb-apps'), tab = (await sidebarTabs()).at(-2);
    await dnd('pdrag', [[tab.x, tab.y], [tab.x, 150], [tab.x, 60], [target[0] + 20, target[1]]], { hold: 400 });
    const n1 = (await appLabels()).length;
    return { ok: n1 === n0 + 1, detail: `favourites ${n0} -> ${n1}` };
  });
  await check('sidebar: drag a second tab to Favourites, then reorder Favourites', async () => {
    const tab = (await sidebarTabs()).at(-3), target = await centre('.sb-apps');
    await dnd('pdrag', [[tab.x, tab.y], [tab.x, 150], [tab.x, 60], [target[0] + 40, target[1]]], { hold: 400 });
    const l0 = await appLabels(); if (l0.length < 2) return { ok: false, detail: 'only ' + l0.length + ' favourites to reorder' };
    const second = await centre('.sb-app[data-app-id]', 1), first = await centre('.sb-app[data-app-id]', 0);
    await dnd('html5', 'ui', [second[0], second[1]], [first[0] - 14, first[1]]);
    const l1 = await appLabels();
    return { ok: l1[0] === l0[1] && l1[1] === l0[0], detail: `${JSON.stringify(l0)} -> ${JSON.stringify(l1)}` };
  });
  await check('sidebar: drop a link from a page on Favourites', async () => {
    await showLinks();
    const n0 = (await appLabels()).length, link = await pageCentre('/links.html', '#a'), target = await centre('.sb-apps');
    const r = await dnd('html5', '/links.html', link, [target[0] + 100, target[1]], 'ui');
    const n1 = (await appLabels()).length;
    return { ok: n1 === n0 + 1, detail: `favourites ${n0} -> ${n1}${r.error ? ' (' + r.error + ')' : ''}` };
  });
  await check('sidebar: drop a link on a tab in the list (opens in that tab)', async () => {
    await showLinks();
    const link = await pageCentre('/links.html', '#b'), target = (await sidebarTabs()).find(x => x.id === ids2sync('/t2')), before = (await snap()).tabs.find(x => x.id === target.id);
    const rr = await dnd('html5', '/links.html', link, [target.x, target.y], 'ui'); await wait(800);
    const after = (await snap()).tabs.find(x => x.id === target.id);
    return { ok: after.url.endsWith('/target-b.html'), detail: `${before.url.slice(-14)} -> ${after.url.slice(-14)}${rr.error ? ' (' + rr.error + ')' : ''}` };
  });
  await check('sidebar: drop a link in empty space of the list (opens a new tab)', async () => {
    await showLinks();
    const link = await pageCentre('/links.html', '#a'), list = await centre('.sb-tabs'), n0 = (await snap()).tabs.length;
    await dnd('html5', '/links.html', link, [list[0], 640], 'ui'); await wait(800);
    const n1 = (await snap()).tabs.length;
    return { ok: n1 === n0 + 1, detail: `tabs ${n0} -> ${n1}` };
  });

  // ---- Top strip again: links, text, files
  await act({ type: 'settings.update', patch: { verticalTabs: false } }); await wait(1400);
  await act({ type: 'tab.select', id: (await order())[0] }); await wait(900);
  await check('strip: drop a link on a tab (opens in that tab)', async () => {
    await showLinks();
    const link = await pageCentre('/links.html', '#b'), t = await stripTabs(), target = t.find(x => x.id === ids2sync('/t3')), before = (await snap()).tabs.find(x => x.id === target.id);
    await dnd('html5', '/links.html', link, [target.x, target.y], 'ui'); await wait(800);
    const after = (await snap()).tabs.find(x => x.id === target.id);
    return { ok: after.url.endsWith('/target-b.html'), detail: `${before.url.slice(-14)} -> ${after.url.slice(-14)}` };
  });
  await check('strip: drop a link on the new-tab button (opens a new tab)', async () => {
    await showLinks();
    const link = await pageCentre('/links.html', '#a'), plus = await centre('.tab-strip-add'), n0 = (await snap()).tabs.length;
    await dnd('html5', '/links.html', link, [plus[0], plus[1]], 'ui'); await wait(800);
    const n1 = (await snap()).tabs.length;
    return { ok: n1 === n0 + 1, detail: `tabs ${n0} -> ${n1}` };
  });
  await showLinks();
  await check('address bar: drop text', async () => {
    const field = await centre('.address-bar input, input[aria-label*="ddress"]');
    await dnd('drop', 'ui', [field[0], field[1]], { items: [{ mimeType: 'text/plain', data: 'glass recycling' }], mask: -1 });
    const value = await ui.evaluate(() => document.querySelector('.address-bar input, input[aria-label*="ddress"]')?.value);
    return { ok: value === 'glass recycling', detail: JSON.stringify(value) };
  });
  await check('address bar: drop a link', async () => {
    const field = await centre('.address-bar input, input[aria-label*="ddress"]');
    await dnd('drop', 'ui', [field[0], field[1]], { items: [{ mimeType: 'text/uri-list', data: base + '/dropped-link' }, { mimeType: 'text/plain', data: base + '/dropped-link' }], mask: -1 });
    const value = await ui.evaluate(() => document.querySelector('.address-bar input, input[aria-label*="ddress"]')?.value);
    return { ok: /dropped-link/.test(value || ''), detail: JSON.stringify(value) };
  });
  const winFile = dropFile;
  await check('page: drop a file on a page drop zone (upload)', async () => {
    const dz = (await ids2('/drop.html')); await act({ type: 'tab.select', id: dz }); await wait(900);
    await dnd('drop', '/drop.html', [350, 275], { items: [], files: [winFile], mask: -1 });
    const text = await app.evaluate(({ webContents }) => webContents.getAllWebContents().find(w => w.getURL().includes('/drop.html'))?.executeJavaScript('document.getElementById("zone").textContent'));
    return { ok: /text Acira drop test/.test(text || ''), detail: JSON.stringify(text) };
  });
  async function ids2(part) { return (await snap()).tabs.find(t => t.url.includes(part)).id; }
  // ---- Files dropped on Acira open like in Chrome. A real OS drop of a file on a page is not something this harness can send (a drag
  // delivered through DevTools does not make Chromium navigate), so the navigation Chromium starts for a drop is reproduced the way
  // Electron reports it: will-navigate to a file: address with no initiating frame. A navigation started by a page has an initiator.
  const fileDir = path.join(data, 'files'); await fs.mkdir(fileDir, { recursive: true });
  const sample = { note: path.join(fileDir, 'note.txt'), secret: path.join(fileDir, 'secret.txt'), reader: path.join(fileDir, 'reader.html'), tool: path.join(fileDir, 'tool.exe'), pdf: path.join(fileDir, 'tiny.pdf') };
  await fs.writeFile(sample.note, 'Hello from a dropped note\n'); await fs.writeFile(sample.secret, 'do not read me\n');
  await fs.writeFile(sample.reader, '<!doctype html><title>reading</title><script>fetch("secret.txt").then(r => r.text()).then(() => { document.title = "READ"; }, () => { document.title = "BLOCKED"; });</script>');
  await fs.writeFile(sample.tool, 'MZ'); await fs.writeFile(sample.pdf, '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]>>endobj\ntrailer<</Root 1 0 R/Size 4>>\n%%EOF\n');
  const fileAddress = file => pathToFileURL(file).href;
  /** What Electron reports when Chromium navigates a view to a dropped file (browser-started: no initiator), or a page does it (initiator set). */
  const navigateTo = (target, address, byPage = false) => app.evaluate(({ webContents }, [target, address, byPage]) => { const wc = webContents.getAllWebContents().find(w => target === 'ui' ? w.getURL() === 'acira-browser-ui://ui/index.html' : w.getURL().includes(target)); if (!wc) return 'no view'; let prevented = false; wc.emit('will-navigate', { preventDefault() { prevented = true; }, initiator: byPage ? { url: 'about:blank' } : null }, address); return prevented ? 'prevented' : 'allowed'; }, [target, address, byPage]);
  const fileTab = async name => { for (let i = 0; i < 20; i++) { await wait(300); const t = (await snap()).tabs.find(x => x.url.startsWith('file:') && decodeURIComponent(x.url).endsWith('/' + name)); if (t) return t; } return null; };
  const fileView = (name, ready = false) => app.evaluate(({ webContents }, [name, ready]) => webContents.getAllWebContents().some(w => w.getURL().startsWith('file:') && decodeURIComponent(w.getURL()).endsWith('/' + name) && (!ready || !w.isLoading())), [name, ready]);
  await showLinks();
  await check('files: a dropped text file opens in a new tab', async () => {
    const n0 = (await snap()).tabs.length, url = fileAddress(sample.note);
    const r = await navigateTo('/links.html', url), tab = await fileTab('note.txt');
    await wait(1500);
    const loaded = await fileView('note.txt');
    return { ok: r === 'prevented' && !!tab && tab.contentKind === 'web' && tab.title === 'note.txt' && loaded && (await snap()).tabs.length === n0 + 1, detail: `${r}; tab ${tab ? tab.title + ' (' + tab.contentKind + ')' : 'none'}; page loaded: ${loaded}` };
  });
  await check('files: a dropped PDF opens in the built-in viewer', async () => {
    const url = fileAddress(sample.pdf);
    await showLinks(); const r = await navigateTo('/links.html', url), tab = await fileTab('tiny.pdf');
    await wait(2500);
    const s1 = await snap(), now = s1.tabs.find(t => t.url.startsWith('file:') && decodeURIComponent(t.url).endsWith('/tiny.pdf'));
    const loaded = await fileView('tiny.pdf', true);
    return { ok: r === 'prevented' && !!now && !now.error && loaded, detail: `${r}; error: ${now?.error || 'none'}; loaded: ${loaded}` };
  });
  await check('files: a dropped web page cannot read other files', async () => {
    const url = fileAddress(sample.reader);
    await showLinks(); await navigateTo('/links.html', url); await fileTab('reader.html'); await wait(2500);
    const title = await app.evaluate(({ webContents }) => webContents.getAllWebContents().find(w => w.getURL().startsWith('file:') && decodeURIComponent(w.getURL()).endsWith('/reader.html'))?.getTitle());
    return { ok: title === 'BLOCKED', detail: `the page reports: ${title}` };
  });
  await check('files: a kind that could run on the computer is refused out loud', async () => {
    const n0 = (await snap()).tabs.length;
    await showLinks(); const r = await navigateTo('/links.html', fileAddress(sample.tool)); await wait(800);
    const s1 = await snap();
    return { ok: r === 'prevented' && s1.tabs.length === n0 && /kind of file/.test(s1.toast?.text || ''), detail: `${r}; tabs ${n0} -> ${s1.tabs.length}; message: ${s1.toast?.text}` };
  });
  await check('files: a navigation started by a page never opens a file', async () => {
    const n0 = (await snap()).tabs.length;
    await showLinks(); const r = await navigateTo('/links.html', fileAddress(sample.note) + '?by-page', true); await wait(800);
    const s1 = await snap();
    return { ok: r === 'prevented' && s1.tabs.length === n0 && /from this page/.test(s1.toast?.text || ''), detail: `${r}; tabs ${n0} -> ${s1.tabs.length}; message: ${s1.toast?.text}` };
  });
  await check('files: a network or relative file address is refused', async () => {
    const n0 = (await snap()).tabs.length;
    await showLinks(); const a = await navigateTo('/links.html', 'file://attacker.example/share/x.txt'); await wait(500); const m1 = (await snap()).toast?.text;
    const s1 = await snap();
    return { ok: a === 'prevented' && s1.tabs.length === n0 && /can.t open that address/.test(m1 || ''), detail: `${a}; tabs ${n0} -> ${s1.tabs.length}; message: ${m1}` };
  });
  await check('files: a file dropped on the browser view itself (tab strip, sidebar, address bar) opens too', async () => {
    const url = fileAddress(sample.note) + '#ui';
    const before = (await snap()).tabs.length, r = await navigateTo('ui', url); await wait(1200);
    const s1 = await snap();
    return { ok: r === 'prevented' && s1.tabs.length === before + 1 && s1.tabs.some(t => t.url.endsWith('note.txt#ui') || t.url.includes('note.txt')), detail: `${r}; tabs ${before} -> ${s1.tabs.length}` };
  });

  // ---- Bookmarks
  for (const u of [base + '/links.html', base + '/drop.html', base + '/plain.html']) await act({ type: 'bookmark.toggle', url: u });
  await act({ type: 'bookmark.folder', title: 'Drop folder', parentId: null });
  await act({ type: 'settings.update', patch: { bookmarksBar: true, bookmarksOnNewTabOnly: false } }); await wait(1000);
  await act({ type: 'tab.select', id: (await order())[0] }); await wait(900);
  const bmUrls = async () => (await snap()).bookmarkNodes.filter(n => n.url).sort((a, b) => a.position - b.position).map(n => n.url.replace(base, ''));
  await check('bookmarks bar: reorder bookmarks', async () => {
    const b0 = await bmUrls(), second = await centre('.bookmarks-bar button', 1), first = await centre('.bookmarks-bar button', 0);
    if (!second) return { ok: false, detail: 'bar has fewer than two items' };
    const r = await dnd('html5', 'ui', [second[0], second[1]], [first[0] - first[2] / 2 + 4, first[1]]);
    const b1 = await bmUrls();
    return { ok: JSON.stringify(b0) !== JSON.stringify(b1), detail: r.error ? r.error : `${b0.join(' ')} -> ${b1.join(' ')}` };
  });
  await check('bookmarks bar: drag a tab onto the bar (bookmarks it)', async () => {
    const n0 = (await snap()).bookmarkNodes.filter(n => n.url).length, t = (await stripTabs()).find(x => x.id === ids[4]) || (await stripTabs())[4], bar = await centre('.bookmarks-bar');
    await dnd('pdrag', [[t.x, t.y], [t.x, 50], [bar[0], bar[1] - 10], [bar[0], bar[1]]], { hold: 400 });
    const n1 = (await snap()).bookmarkNodes.filter(n => n.url).length;
    return { ok: n1 === n0 + 1, detail: `bookmarks ${n0} -> ${n1}` };
  });
  await check('bookmarks bar: drop a link from a page on the bar', async () => {
    await showLinks();
    const n0 = (await snap()).bookmarkNodes.filter(n => n.url).length, link = await pageCentre('/links.html', '#a'), bar = await centre('.bookmarks-bar');
    await dnd('html5', '/links.html', link, [bar[0] + 200, bar[1]], 'ui');
    const n1 = (await snap()).bookmarkNodes.filter(n => n.url).length;
    return { ok: n1 === n0 + 1, detail: `bookmarks ${n0} -> ${n1}` };
  });
  await act({ type: 'tab.new', url: 'acira://bookmarks' }); await wait(1500);
  await check('Bookmarks page: reorder bookmarks', async () => {
    const b0 = await bmUrls(), rows2 = await ui.evaluate(() => [...document.querySelectorAll('main [draggable=true]')].map(e => { const b = e.getBoundingClientRect(); return [Math.round(b.x + 40), Math.round(b.y + b.height / 2)]; }));
    if (rows2.length < 3) return { ok: false, detail: 'rows: ' + rows2.length };
    await dnd('html5', 'ui', rows2[2], [rows2[0][0], rows2[0][1] - 8]);
    const b1 = await bmUrls();
    return { ok: JSON.stringify(b0) !== JSON.stringify(b1), detail: `${b0.join(' ')} -> ${b1.join(' ')}` };
  });
  await check('Bookmarks page: drop a bookmark into a folder', async () => {
    const rows2 = await ui.evaluate(() => [...document.querySelectorAll('main [draggable=true]')].map(e => { const b = e.getBoundingClientRect(); return { t: e.textContent.trim().slice(0, 20), x: Math.round(b.x + 40), y: Math.round(b.y + b.height / 2) }; }));
    const folder = rows2.find(r => /Drop folder/.test(r.t)), item = rows2[0];
    if (!folder) return { ok: false, detail: 'no folder row' };
    await dnd('html5', 'ui', [item.x, item.y], [folder.x, folder.y]);
    const s1 = await snap(), f = s1.bookmarkNodes.find(n => n.title === 'Drop folder');
    return { ok: s1.bookmarkNodes.some(n => n.url && n.parentId === f.id), detail: `children: ${s1.bookmarkNodes.filter(n => n.parentId === f.id).length}` };
  });
  await check('Bookmarks page: drop a link from a page', async () => {
    const n0 = (await snap()).bookmarkNodes.filter(n => n.url).length;
    const at = await ui.evaluate(() => { const l = document.querySelector('.bm-layout')?.getBoundingClientRect(); return l && [Math.round(l.x + l.width * .6), Math.round(l.y + 60)]; }) || [600, 360];
    const under = await ui.evaluate(([x, y]) => (document.elementFromPoint(x, y)?.closest('[data-folder],.bm-node,.bm-row,[draggable]')?.className || document.elementFromPoint(x, y)?.className || '').toString().slice(0, 40), at);
    await dnd('drop', 'ui', at, { items: [{ mimeType: 'text/uri-list', data: base + '/from-drag' }, { mimeType: 'text/plain', data: base + '/from-drag' }], mask: -1 });
    const s2 = await snap(), n1 = s2.bookmarkNodes.filter(n => n.url).length;
    return { ok: n1 === n0 + 1, detail: `bookmarks ${n0} -> ${n1}; dropped at ${at} over '${under}'; last message: ${s2.toast?.text || 'none'}` };
  });

  // ---- Downloads dragged out to Explorer
  await check('Downloads: drag a finished download out to Explorer', async () => {
    // A real drag out of the row; the native file drag (startDrag) is recorded instead of entering Windows' drag loop.
    await act({ type: 'tab.new', url: base + '/dl.bin' });
    let ready = null;
    for (let i = 0; i < 20 && !ready; i++) { await wait(500); ready = (await ui.evaluate(() => window.acira.service({ type: 'downloads.list' }))).downloads.find(d => d.name === 'dl.bin' && d.status === 'Ready'); }
    if (!ready) return { ok: false, detail: 'the test download never finished' };
    await act({ type: 'tab.new', url: 'acira://downloads' }); await wait(1500);
    await app.evaluate(({ webContents }) => { globalThis.__dragged = null; for (const wc of webContents.getAllWebContents()) if (wc.getURL() === 'acira-browser-ui://ui/index.html') wc.startDrag = item => { globalThis.__dragged = item; }; });
    const row = await centre('.lib-row.dl');
    if (!row) return { ok: false, detail: 'no download row on the page' };
    await dnd('html5', 'ui', [row[0], row[1]], [row[0] + 60, row[1] + 50]);
    const dragged = await app.evaluate(() => globalThis.__dragged && { file: globalThis.__dragged.file, icon: !globalThis.__dragged.icon.isEmpty() });
    return { ok: !!dragged && /dl.bin$/.test(dragged.file) && dragged.icon, detail: dragged ? 'native file drag started for ' + dragged.file.split(/[\\/]/).pop() : 'no native drag started' };
  });

  const failed = rows.filter(r => !r.ok);
  if (errors.length) console.log('\npage errors:\n  ' + errors.slice(0, 5).join('\n  '));
  console.log(`\n${rows.length - failed.length}/${rows.length} drag and drop checks pass`);
  exitCode = failed.length ? 1 : 0;
} finally {
  await Promise.race([app.close(), wait(8000)]).catch(() => {});
  try { app.process().kill(); } catch {}
  server.close();
  if (!process.argv.includes('--keep')) await fs.rm(data, { recursive: true, force: true }).catch(() => {});
}
process.exit(exitCode);
