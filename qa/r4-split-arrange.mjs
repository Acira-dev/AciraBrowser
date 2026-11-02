// R4-29 real-app QA: dragging a pane ribbon in a 3-pane and a 4-pane split brings up the layout picker; a release on a cell rearranges.
//   node qa/r4-split-arrange.mjs [tag]     (cwd = worktree root; takes one native slot, one Electron, closed in finally)
// Real input: sendInputEvent into the chrome view (pointer events with capture, as a person's mouse produces). Evidence: C:/ae/r4/split-arrange/evidence/<tag>/
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const root = process.cwd(), tag = process.argv[2] || 'run';
const OUT = path.join('C:/ae/r4/split-arrange/evidence', tag); await fs.mkdir(OUT, { recursive: true });
const PROFILES = 'C:/ae/r4/split-arrange/profiles';
const results = [];
const log = (...a) => console.log('[qa]', ...a);
const check = (ok, label) => { results.push({ ok, label }); log(ok ? 'PASS' : 'FAIL', label); };

async function slot() {
  for (let i = 0; i < 40; i++) {
    for (const n of [1, 2, 3]) { const f = `C:/ae/slot-${n}.lock`; try { const h = await fs.open(f, 'wx'); await h.write(`split-arrange ${new Date().toISOString()}`); await h.close(); return f; } catch {} }
    await sleep(30000);
  }
  throw Error('no slot');
}
async function launch() {
  const req = createRequire(path.join(root, 'package.json'));
  const { _electron } = req('playwright'); const electronExe = req('electron');
  const profile = path.join(PROFILES, 'sa-' + Date.now());
  const roaming = path.join(profile, 'fixture-roaming'), local = path.join(profile, 'fixture-local');
  await fs.mkdir(roaming, { recursive: true }); await fs.mkdir(local, { recursive: true });
  const env = { ...process.env, ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: profile, APPDATA: roaming, LOCALAPPDATA: local };
  delete env.ELECTRON_RUN_AS_NODE; delete env.ACIRA_DEV; delete env.ACIRA_BROWSER_TEST_HIDDEN;
  const nonce = randomUUID(), marker = path.join(profile, 'native-key-' + nonce + '.json');
  const child = spawn(electronExe, [path.join(root, 'qa/prepare-native-profile.cjs')], { env: { ...env, ACIRA_PREPARE_PROFILE: profile, ACIRA_PREPARE_NONCE: nonce }, windowsHide: true, stdio: 'ignore', cwd: root });
  const until = Date.now() + 25000; let result;
  while (Date.now() < until) { try { result = JSON.parse(await fs.readFile(marker, 'utf8')); if (result.nonce === nonce) break; } catch {} await sleep(50); }
  if (!result?.ready) { try { child.kill(); } catch {} throw Error(result?.error || 'native key prep failed'); }
  while (Date.now() < until) { try { process.kill(result.pid, 0); } catch { break; } await sleep(50); }
  await fs.unlink(marker).catch(() => {});
  return _electron.launch({ executablePath: electronExe, cwd: root, timeout: 40000, env, args: [path.join(root, 'desktop/main.cjs'), '--disable-features=CalculateNativeWinOcclusion', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
}

const pages = { one: ['YouTube', '#f6e3e3'], two: ['Stack Overflow', '#f8ecdc'], three: ['Google Translate', '#e1ecfb'], four: ['Wikipedia', '#e9eee3'] };
const server = http.createServer((req, res) => { const k = req.url.slice(1) || 'one', [title, bg] = pages[k] || ['Page', '#fff']; res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(`<!doctype html><title>${title}</title><body style="margin:0;background:${bg};font:600 28px system-ui;color:#222;display:grid;place-items:center;height:100vh">${title}`); });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

let app, ui, lock;
const uiPage = async () => { for (let i = 0; i < 300; i++) { for (const p of app.context().pages()) { try { if (p.url() === 'acira-browser-ui://ui/index.html') return p; } catch {} } await sleep(100); } throw Error('ui page not found'); };
const act = a => ui.evaluate(a => window.acira.dispatch(a), a);
const state = () => ui.evaluate(() => window.acira.getSnapshot());
const split = async () => (await state()).windowUi.split;
const focusWin = () => app.evaluate(({ BaseWindow }) => { for (const w of BaseWindow.getAllWindows()) if (w.isVisible()) { w.show(); w.focus(); } });
const input = (event) => app.evaluate(({ webContents }, event) => { const w = webContents.getAllWebContents().find(x => x.getURL() === 'acira-browser-ui://ui/index.html'); w.sendInputEvent(event); }, event);
let zoom = 1;   // the interface scale: chrome-view CSS pixels times the zoom factor are the DIPs sendInputEvent takes
const mouse = (type, x, y) => input({ type, x: Math.round(x * zoom), y: Math.round(y * zoom), button: 'left', clickCount: 1, ...(type === 'mouseMove' ? { modifiers: ['leftButtonDown'] } : {}) });
const key = async k => { await input({ type: 'keyDown', keyCode: k }); await input({ type: 'keyUp', keyCode: k }); };
let pointer = { x: 0, y: 0 };
async function glide(x, y, steps = 10, wait = 16) { const from = pointer; for (let i = 1; i <= steps; i++) { await mouse('mouseMove', from.x + (x - from.x) * i / steps, from.y + (y - from.y) * i / steps); await sleep(wait); } pointer = { x, y }; }
const box = (sel, nth = 0) => ui.evaluate(([sel, nth]) => { const r = [...document.querySelectorAll(sel)].filter(e => !e.hasAttribute('data-motion-ghost'))[nth]?.getBoundingClientRect(); return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null; }, [sel, nth]);
const count = sel => ui.evaluate(sel => document.querySelectorAll(sel).length, sel);
/** Every cell of the picker's thumbnails: { thumb, cell, x, y, w, h } in chrome-view coordinates. */
const pickerCells = () => ui.evaluate(() => [...document.querySelectorAll('.split-picker-thumb')].flatMap((t, thumb) => [...t.querySelectorAll('.split-picker-cell')].map((c, cell) => { const r = c.getBoundingClientRect(); return { thumb, cell, x: r.x, y: r.y, w: r.width, h: r.height }; })));
const lit = () => ui.evaluate(() => { const t = [...document.querySelectorAll('.split-picker-thumb')]; const hit = t.flatMap((th, thumb) => [...th.querySelectorAll('.split-picker-cell')].map((c, cell) => c.hasAttribute('data-hover') ? { thumb, cell } : null)).filter(Boolean); return hit; });

async function shot(name) {
  await sleep(250);
  const b64 = await app.evaluate(async ({ BaseWindow, desktopCapturer }) => { const w = BaseWindow.getAllWindows()[0], [cw, ch] = w.getSize(); const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: cw, height: ch } }); const s = sources.find(x => x.id === w.getMediaSourceId()); return s ? s.thumbnail.toPNG().toString('base64') : ''; });
  if (b64) await fs.writeFile(path.join(OUT, name + '.png'), Buffer.from(b64, 'base64'));
  log('shot', name, b64 ? 'ok' : 'EMPTY');
}
/** 60Hz capturePage frames of the chrome view (its stills and morph layer hold the pages while they glide), starting at the release. */
async function strip(label, fire, frames = 44) {
  const dir = path.join(OUT, label); await fs.mkdir(dir, { recursive: true });
  const { got, views } = await app.evaluate(async ({ webContents, BaseWindow }, [fire, frames]) => {
    const uiwc = webContents.getAllWebContents().find(w => w.getURL() === 'acira-browser-ui://ui/index.html'), win = BaseWindow.getAllWindows()[0];
    // How many website views are visible, sampled every 3ms from the release: a count that rises after it fell is a flash of the old pages.
    const views = [], count = () => { let n = 0; for (const v of win.contentView.children) { try { if (/127\.0\.0\.1/.test(v.webContents.getURL()) && v.getVisible()) n++; } catch {} } return n; };
    const t0 = Date.now(); const sampler = setInterval(() => { const n = count(), last = views.at(-1); if (!last || last[1] !== n) views.push([Date.now() - t0, n]); }, 3);
    new Function('uiwc', fire)(uiwc); const jobs = [];
    for (let i = 0; i < frames; i++) { const wait = t0 + i * 16.7 - Date.now(); if (wait > 0) await new Promise(r => setTimeout(r, wait)); const at = Date.now() - t0; jobs.push(uiwc.capturePage().then(img => ({ t: at, png: img.resize({ width: 640 }).toPNG().toString('base64') })).catch(() => ({ t: at, png: '' }))); }
    const got = await Promise.all(jobs); clearInterval(sampler); return { got, views };
  }, [fire, frames]);
  for (const [i, f] of got.entries()) if (f.png) await fs.writeFile(path.join(dir, `f${String(i).padStart(2, '0')}-${f.t}ms.png`), Buffer.from(f.png, 'base64'));
  log('strip', label, got.length, 'website views visible [ms, n]:', JSON.stringify(views));
  return views;
}

/** Press on pane `index`'s ribbon title and drag past the threshold; returns the pointer and the ribbon box. */
async function pressRibbon(index) {
  const r = await box('.page-pane .split-label', index); if (!r) throw Error('no ribbon ' + index);
  const x = r.x + 60, y = r.y + r.h / 2; pointer = { x, y };
  await mouse('mouseMove', x, y); await sleep(60); await mouse('mouseDown', x, y); await sleep(40);
  return { x, y, r };
}
const waitFor = async (fn, label, ms = 6000) => { const end = Date.now() + ms; let v; do { v = await fn(); if (v) return v; await sleep(60); } while (Date.now() < end); throw Error('timeout ' + label); };
const idsIn = async () => (await split())?.tabIds;
const title = async id => (await state()).tabs.find(t => t.id === id)?.title;

async function scenarioThree(theme) {
  log('--- three panes,', theme);
  await act({ type: 'settings.update', patch: { appearance: theme } }); await sleep(600);
  const s0 = await state(); const [a, b, c] = s0.tabs.slice(0, 3).map(t => t.id);
  await act({ type: 'tab.select', id: a });
  await act({ type: 'split.open', tabIds: [a, b, c], layout: 'three-columns' });
  await waitFor(async () => (await count('.page-pane .split-label')) === 3, 'three ribbons'); await sleep(900);
  await focusWin(); await shot(`three-${theme}-rest`);

  // Below the threshold nothing appears; past it the picker comes up at once.
  const p = await pressRibbon(0);
  await glide(p.x + 3, p.y + 1, 2); await sleep(120);
  check((await count('.split-picker-card')) === 0, `${theme}: 3px of travel is still a click (no picker)`);
  await glide(p.x + 16, p.y + 14, 4); await sleep(160);
  check((await count('.split-picker-card')) === 1, `${theme}: past 5px the layout picker is up`);
  await waitFor(async () => (await count('.split-drag-layer .split-picker-still')) === 3, 'three stills');
  await sleep(500);
  const thumbs = await count('.split-picker-thumb'), cells = await pickerCells();
  check(thumbs === 6 && cells.length === 18, `${theme}: six layouts, eighteen slots (thumbs ${thumbs}, cells ${cells.length})`);
  check((await ui.evaluate(() => document.querySelector('.split-picker-title')?.textContent)) === 'Drop on a spot to split', `${theme}: the card says "Drop on a spot to split"`);
  check((await count('.split-drag-zone')) === 3, `${theme}: the swap zones are still there under the card`);
  const middle = await box('.page-pane', 1); await glide(middle.x + middle.w / 2, middle.y + middle.h / 2 + 180, 8); await sleep(250);
  await shot(`three-${theme}-picker`);
  // Over another pane: today's swap target lights.
  check((await count('.split-drag-zone[data-over]')) === 1, `${theme}: over a pane, that pane is the swap target`);
  // Over a picker cell: the cell lights, no pane is a target.
  const target = cells.find(x => x.thumb === 4 && x.cell === 2);           // left-one-right-two (the fifth layout), bottom-right slot (slot 2)
  await glide(target.x + target.w / 2, target.y + target.h / 2, 14); await sleep(420);
  const l = await lit();
  check(l.length === 1 && l[0].thumb === 4 && l[0].cell === 2, `${theme}: hovering the cell lights exactly that cell ${JSON.stringify(l)}`);
  check((await count('.split-drag-zone[data-over]')) === 0, `${theme}: no pane is a swap target over the card`);
  check((await count('.split-picker-preview .split-picker-pane')) === 3, `${theme}: the preview shows the result across the page`);
  check((await count('.split-picker-highlight')) === 1, `${theme}: one highlight on the hovered cell`);
  await shot(`three-${theme}-hover-cell`);
  // Release: rearranges; the pages glide.
  check(await ui.evaluate(() => [...document.querySelectorAll('.split-drag-zone')].every(z => parseFloat(getComputedStyle(z).opacity) < .05)), `${theme}: over a cell the pane zones step aside (nothing shows through the preview's gaps)`);
  await strip(`three-${theme}-release`, `uiwc.sendInputEvent({type:'mouseUp',x:${Math.round(pointer.x * zoom)},y:${Math.round(pointer.y * zoom)},button:'left',clickCount:1});`);
  await sleep(500);
  const after = await split();
  check(after?.layout === 'left-one-right-two' && JSON.stringify(after.tabIds) === JSON.stringify([b, c, a]), `${theme}: release on slot 2 of "one left, two right" gives layout ${after?.layout} order [${(after?.tabIds || []).map(x => x === a ? 'a' : x === b ? 'b' : 'c')}] (want left-one-right-two, [b,c,a])`);
  check((await count('.split-picker-card')) === 0 && (await count('.split-drag-layer')) === 0, `${theme}: picker and zones are gone after the release`);
  await sleep(900); await shot(`three-${theme}-after`);

  // Dropping outside the picker keeps today's behaviour: on another pane it swaps.
  const before = await idsIn(); const p2 = await pressRibbon(0);
  await glide(p2.x + 20, p2.y + 20, 3); await waitFor(async () => (await count('.split-picker-card')) === 1, 'picker 2');
  const rightPane = await box('.page-pane', 1); await glide(rightPane.x + rightPane.w / 2, rightPane.y + rightPane.h / 2 + 60, 10); await sleep(300);
  await mouse('mouseUp', pointer.x, pointer.y); await sleep(900);
  const swapped = await idsIn();
  check(swapped[0] === before[1] && swapped[1] === before[0] && swapped[2] === before[2], `${theme}: released on another pane (not the card) it swaps those two`);
  // Escape cancels.
  const keep = await split(); const p3 = await pressRibbon(1);
  await glide(p3.x + 20, p3.y + 20, 3); await waitFor(async () => (await count('.split-picker-card')) === 1, 'picker 3');
  const cells3 = await pickerCells(); const c3 = cells3.find(x => x.thumb === 0 && x.cell === 0); await glide(c3.x + 5, c3.y + 5, 8); await sleep(200);
  await key('Escape'); await sleep(500);
  check((await count('.split-picker-card')) === 0, `${theme}: Esc closes the picker`);
  await mouse('mouseUp', pointer.x, pointer.y); await sleep(500);
  const kept = await split();
  check(JSON.stringify(kept.tabIds) === JSON.stringify(keep.tabIds) && kept.layout === keep.layout, `${theme}: Esc leaves the split exactly as it was`);
  // Release off every pane and off the card: nothing.
  const p4 = await pressRibbon(2); await glide(p4.x + 20, p4.y + 20, 3); await waitFor(async () => (await count('.split-picker-card')) === 1, 'picker 4');
  const gap = await box('.page-area'); await glide(gap.x + gap.w - 3, gap.y + gap.h - 3, 10); await sleep(250); await mouse('mouseUp', pointer.x, pointer.y); await sleep(500);
  const still = await split(); check(JSON.stringify(still.tabIds) === JSON.stringify(keep.tabIds) && still.layout === keep.layout, `${theme}: a release in a corner of the page changes nothing`);
  // Back to three columns for the next scenario.
  await act({ type: 'split.layout', layout: 'three-columns' }); await sleep(700);
  return { a, b, c };
}

async function scenarioFour(theme) {
  log('--- four panes,', theme);
  const s0 = await state(); const [a, b, c, d] = s0.tabs.slice(0, 4).map(t => t.id);
  await act({ type: 'split.add', tabId: d, layout: 'grid' });
  await waitFor(async () => (await split())?.layout === 'grid', 'grid'); await sleep(1000); await focusWin();
  const order0 = await idsIn();
  const p = await pressRibbon(3); await glide(p.x + 10, p.y + 18, 4);
  await waitFor(async () => (await count('.split-picker-card')) === 1, 'picker 4 panes');
  await waitFor(async () => (await count('.split-drag-layer .split-picker-still')) === 4, 'four stills'); await sleep(500);
  const cells = await pickerCells();
  check((await count('.split-picker-thumb')) === 6 && cells.length === 24, `${theme}: four panes offer six layouts with four slots each (cells ${cells.length})`);
  const target = cells.find(x => x.cell === 0); await glide(target.x + target.w / 2, target.y + target.h / 2, 12); await sleep(420);
  const l = await lit(); check(l.length === 1 && l[0].cell === 0, `${theme}: hovering slot 0 lights it ${JSON.stringify(l)}`);
  await shot(`four-${theme}-hover`);
  await strip(`four-${theme}-release`, `uiwc.sendInputEvent({type:'mouseUp',x:${Math.round(pointer.x * zoom)},y:${Math.round(pointer.y * zoom)},button:'left',clickCount:1});`);
  await sleep(600);
  const after = await split();
  check(after.layout === 'grid' && after.tabIds[0] === order0[3] && JSON.stringify(after.tabIds.slice(1)) === JSON.stringify(order0.slice(0, 3)), `${theme}: pane 4 dropped on slot 1 of the grid moves to the front, the others follow`);
  await sleep(800); await shot(`four-${theme}-after`);
  await act({ type: 'split.remove', tabId: d }); await sleep(900);
}

/** The native website views sit exactly on their panes (window coordinates, 100% scale). */
async function fit(label) {
  await sleep(1000);
  const panes = await ui.evaluate(() => [...document.querySelectorAll('.page-pane')].map(n => { const r = n.getBoundingClientRect(), h = n.querySelector('.split-label')?.offsetHeight || 0; return { x: Math.round(r.left), y: Math.round(r.top + h), w: Math.round(r.width), h: Math.round(r.height - h) }; }));
  const views = await app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows()[0].contentView.children.map(v => { try { return /127\.0\.0\.1/.test(v.webContents.getURL()) && v.getVisible() ? v.getBounds() : null; } catch { return null; } }).filter(Boolean));
  const ok = panes.length === views.length && panes.every(p => views.some(v => Math.abs(v.x - p.x) <= 2 && Math.abs(v.y - p.y) <= 2 && Math.abs(v.width - p.w) <= 2 && Math.abs(v.height - p.h) <= 2));
  check(ok, `${label}: ${views.length} website views sit on their ${panes.length} panes${ok ? '' : ' ' + JSON.stringify({ panes, views })}`);
}
/** A real drag of a split handle (a divider or a junction) by (dx, dy). */
async function dragHandle(selector, nth, dx, dy) {
  const h = await box(selector, nth); if (!h) throw Error('no handle ' + selector);
  const x = h.x + h.w / 2, y = h.y + h.h / 2; pointer = { x, y };
  await mouse('mouseMove', x, y); await sleep(50); await mouse('mouseDown', x, y); await glide(x + dx, y + dy, 8, 16); await mouse('mouseUp', x + dx, y + dy); await sleep(450);
}
/** The six three-pane and six four-pane layouts in the picker, three of the new ones chosen by the real drag, the rest through the menu action; native views on their panes and the dividers resizing. */
async function scenarioNew(theme) {
  log('--- new layouts,', theme);
  await act({ type: 'settings.update', patch: { appearance: theme } }); await sleep(600);
  const s0 = await state(); const [a, b, c, d] = s0.tabs.slice(0, 4).map(t => t.id);
  await act({ type: 'tab.select', id: a }); await act({ type: 'split.open', tabIds: [a, b, c], layout: 'three-columns' });
  await waitFor(async () => (await count('.page-pane .split-label')) === 3, 'three ribbons'); await sleep(900); await focusWin();
  // Three panes: the picker lists all six layouts.
  let p = await pressRibbon(0); await glide(p.x + 16, p.y + 14, 4);
  await waitFor(async () => (await count('.split-picker-card')) === 1, 'picker'); await waitFor(async () => (await count('.split-drag-layer .split-picker-still')) === 3, 'stills'); await sleep(500);
  let cells = await pickerCells();
  if (!cells.length) log('debug picker gone', JSON.stringify(await ui.evaluate(() => ({ card: document.querySelectorAll('.split-picker-card').length, layer: document.querySelectorAll('.split-drag-layer').length, zones: document.querySelectorAll('.split-drag-zone').length, thumbs: document.querySelectorAll('.split-picker-thumb').length, labels: document.querySelectorAll('.split-label').length, errs: window.__errs || null }))));
  check((await count('.split-picker-thumb')) === 6 && cells.length === 18, `${theme}: three panes offer six layouts (cells ${cells.length})`);
  const mid = await box('.page-pane', 1); await glide(mid.x + mid.w / 2, mid.y + mid.h / 2 + 200, 8); await sleep(300);
  await shot(`new-three-${theme}-picker`);
  let target = cells.find(x => x.thumb === 5 && x.cell === 1);           // "Two left, one right": the bottom-left slot
  await glide(target.x + target.w / 2, target.y + target.h / 2, 14); await sleep(450);
  let l = await lit(); check(l.length === 1 && l[0].thumb === 5 && l[0].cell === 1, `${theme}: hovering the second slot of "Two left, one right" lights it ${JSON.stringify(l)}`);
  check((await ui.evaluate(() => document.querySelector('.split-picker-title')?.textContent)) === 'Two left, one right', `${theme}: the card names the layout`);
  await shot(`new-three-${theme}-hover`);
  await mouse('mouseUp', pointer.x, pointer.y); await sleep(1300);
  let now = await split();
  check(now.layout === 'left-two-right-one' && JSON.stringify(now.tabIds) === JSON.stringify([b, a, c]), `${theme}: released: ${now.layout}, order a moved to slot 1 [${now.tabIds.map(x => x === a ? 'a' : x === b ? 'b' : 'c')}]`);
  await fit(`${theme}: two left, one right`); await shot(`new-three-${theme}-left-two-right-one`);
  // Real drag of its divider between the two on the left, then the junction.
  const rows0 = now.rows.slice(); await dragHandle('.split-handle[data-kind=row]', 0, 0, 70); now = await split();
  check(now.rows[0] > rows0[0] + .05 && now.layout === 'left-two-right-one' && now.cols[0] === .5, `${theme}: dragging the left divider down resizes only the stacked panes (rows ${rows0} to ${now.rows}, cols ${now.cols})`);
  await dragHandle('.split-handle[data-kind=corner]', 0, -100, 0); now = await split();
  check(now.cols[0] < .45, `${theme}: dragging the junction moves the column edge (cols ${now.cols})`); await fit(`${theme}: after the divider drags`);
  for (const layout of ['three-rows', 'top-one-bottom-two']) { await act({ type: 'split.layout', layout }); await fit(`${theme}: ${layout}`); if (layout === 'three-rows') await shot(`new-three-${theme}-three-rows`); }
  const shelf = await split(); const h2 = await count('.split-handle[data-kind=row]'), v2 = await count('.split-handle[data-kind=col]');
  check(shelf.layout === 'top-one-bottom-two' && h2 === 1 && v2 === 1, `${theme}: one on top, two below has one row divider and one column divider (${h2}, ${v2})`);
  await shot(`new-three-${theme}-top-one-bottom-two`);

  // Four panes: six layouts.
  await act({ type: 'split.add', tabId: d }); await waitFor(async () => (await split())?.layout === 'grid', 'grid'); await sleep(1100);
  p = await pressRibbon(3); await glide(p.x + 14, p.y + 16, 4);
  await waitFor(async () => (await count('.split-picker-card')) === 1, 'picker 4'); await waitFor(async () => (await count('.split-drag-layer .split-picker-still')) === 4, 'stills 4'); await sleep(500);
  cells = await pickerCells();
  check((await count('.split-picker-thumb')) === 6 && cells.length === 24, `${theme}: four panes offer six layouts (cells ${cells.length})`);
  const q = await box('.page-pane', 1); await glide(q.x + q.w / 2, q.y + q.h / 2 + 150, 8); await sleep(300);
  await shot(`new-four-${theme}-picker`);
  target = cells.find(x => x.thumb === 3 && x.cell === 0);                 // "One left, three right": the tall pane on the left
  await glide(target.x + target.w / 2, target.y + target.h / 2, 14); await sleep(450);
  l = await lit(); check(l.length === 1 && l[0].thumb === 3 && l[0].cell === 0, `${theme}: hovering the tall slot of "One left, three right" lights it ${JSON.stringify(l)}`);
  await shot(`new-four-${theme}-hover`);
  await mouse('mouseUp', pointer.x, pointer.y); await sleep(1300);
  now = await split();
  check(now.layout === 'left-one-right-three' && now.tabIds[0] === d, `${theme}: released: ${now.layout} with the dragged pane as the tall one`);
  await fit(`${theme}: one left, three right`); await shot(`new-four-${theme}-left-one-right-three`);
  const r0 = now.rows.slice(); await dragHandle('.split-handle[data-kind=row]', 0, 0, 60); now = await split();
  check(now.rows[0] > r0[0] + .04 && Math.abs(now.rows[2] - r0[2]) < .002, `${theme}: the first divider of the stack moves, the third pane keeps its share (rows ${r0} to ${now.rows})`);
  for (const layout of ['four-columns', 'four-rows', 'left-three-right-one', 'top-one-bottom-three']) { await act({ type: 'split.layout', layout }); await fit(`${theme}: ${layout}`); if (layout === 'four-columns' || layout === 'top-one-bottom-three') await shot(`new-four-${theme}-${layout}`); }
  await act({ type: 'split.remove', tabId: d }); await sleep(900); await act({ type: 'split.layout', layout: 'three-columns' }); await sleep(900);
}

/** 150% interface scale: the picker's hit-testing and cells in zoomed CSS pixels. */
async function scenarioScale() {
  log('--- three panes, 150% interface');
  // At 150% a three-pane split needs a wider window than 1500px (the app closes a split that would leave panes unreadable).
  await app.evaluate(({ BaseWindow }) => { for (const w of BaseWindow.getAllWindows()) if (w.isVisible()) { w.setContentSize(1900, 1000); w.setPosition(0, 0); } });
  await act({ type: 'settings.update', patch: { appearance: 'dark', interfaceScale: 150 } }); await sleep(1800);
  zoom = await app.evaluate(({ webContents }) => webContents.getAllWebContents().find(w => w.getURL() === 'acira-browser-ui://ui/index.html').getZoomFactor());
  log('zoom factor', zoom);
  const s0 = await state(); const [a, b, c] = s0.tabs.slice(0, 3).map(t => t.id);
  await act({ type: 'tab.select', id: a }); await act({ type: 'split.open', tabIds: [a, b, c], layout: 'three-columns' });
  try { await waitFor(async () => (await count('.page-pane .split-label')) === 3, 'three ribbons 150'); }
  catch (error) { log('150% state', JSON.stringify((await split()) || null), 'labels', await count('.split-label'), 'panes', await count('.page-pane'), 'toast', await ui.evaluate(() => document.querySelector('[role=status]')?.textContent || ''), 'area', JSON.stringify(await box('.page-area'))); await shot('three-150-fail'); throw error; }
  await sleep(1100); await focusWin();
  await shot('three-150-rest');
  const p = await pressRibbon(0); await glide(p.x + 18, p.y + 14, 4);
  await waitFor(async () => (await count('.split-picker-card')) === 1, 'picker 150'); await waitFor(async () => (await count('.split-drag-layer .split-picker-still')) === 3, 'stills 150'); await sleep(500);
  const cells = await pickerCells(), target = cells.find(x => x.thumb === 2 && x.cell === 0);
  await glide(target.x + target.w / 2, target.y + target.h / 2, 14); await sleep(450);
  const l = await lit(); check(l.length === 1 && l[0].thumb === 2 && l[0].cell === 0, `150%: hovering "two on top, one below" slot 0 lights it ${JSON.stringify(l)}`);
  await shot('three-150-hover-cell');
  await mouse('mouseUp', pointer.x, pointer.y); await sleep(1200);
  const after = await split(); check(after.layout === 'top-two-bottom-one' && after.tabIds[0] === a, `150%: release gives ${after.layout} with the dragged pane first`);
  await shot('three-150-after');
  await act({ type: 'settings.update', patch: { interfaceScale: 100 } }); zoom = 1; await sleep(800);
}

try {
  lock = await slot(); log('slot', lock);
  app = await launch();
  ui = await uiPage(); await ui.waitForLoadState('domcontentloaded');
  await app.evaluate(({ BaseWindow }) => { for (const w of BaseWindow.getAllWindows()) if (w.isVisible()) { w.setContentSize(1500, 900); w.setPosition(40, 20); } });
  await focusWin();
  const skip = ui.getByRole('button', { name: 'Skip setup' }); await skip.first().waitFor({ timeout: 20000 }).catch(() => {}); if (await skip.count()) await skip.first().click({ timeout: 5000 }).catch(() => {});
  await sleep(1800); ui = await uiPage();
  const done = ui.getByRole('button', { name: /^Done$/ }); if (await done.count()) { await done.first().click().catch(() => {}); await sleep(700); }
  await focusWin();
  const first = (await state()).activeTabId; await act({ type: 'tab.navigate', tabId: first, url: base + 'one' });
  for (const n of ['two', 'three', 'four']) await act({ type: 'tab.new', url: base + n, background: true });
  await waitFor(async () => (await state()).tabs.length === 4, 'four tabs'); await sleep(3000);   // a cold window is still settling for the first seconds: a drag begun too early can be dropped
  const only = process.env.ONLY;
  if (!only || only === 'old') for (const theme of ['dark', 'light']) { await scenarioThree(theme); await scenarioFour(theme); }
  if (!only || only === 'new') for (const theme of ['dark', 'light']) await scenarioNew(theme);
  if (!only || only === 'scale') await scenarioScale();
} catch (error) {
  check(false, 'script error: ' + (error?.stack || error));
} finally {
  try { await app?.close(); } catch {}
  try { server.close(); } catch {}
  if (lock) await fs.unlink(lock).catch(() => {});
  await fs.writeFile(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1));
  const failed = results.filter(r => !r.ok); log(`${results.length - failed.length}/${results.length} passed`); for (const f of failed) log('  FAILED:', f.label);
  process.exit(failed.length ? 1 : 0);
}
