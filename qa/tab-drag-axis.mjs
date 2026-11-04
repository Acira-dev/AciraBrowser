// The top tab strip's drag, with real mouse events (webContents.sendInputEvent mouseDown / mouseMove(leftButtonDown) / mouseUp on the UI view).
// Sideways reorders with deliberate vertical wobble at slow and fast speeds, at 3, 8 and 20 tabs: the tab must land in the slot it was taken to,
// and the drag must never switch to the vertical mode (the carried chip, the split picker, a torn-off window). Then clean vertical drags: they still do
// today's vertical action (chip, picker, split on a cell, a new window).
//   ACIRA_BROWSER_TEST_DATA=/tmp/acira-qa/tab-drag-axis/<run> node qa/tab-drag-axis.mjs [--tabs=3,8,20] [--label=after] [--out=file.json] [--quick] [--sections=side,vertical] [--view=full] [--sidebar]
// Safety: every launch uses a throwaway profile under /tmp/acira-qa/tab-drag-axis/, and the run aborts unless app.getPath('userData') is there.
// Every Electron launch passes --use-mock-keychain: the real macOS Keychain is never read, so no password prompt can appear.
// The window sits off-screen and is never activated (it still renders; the Mac may be locked).
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { _electron } from 'playwright';

const REPO = process.cwd(), req = createRequire(REPO + '/package.json');
const SAFE = '/tmp/acira-qa/tab-drag-axis/';
const ROOT = path.resolve(process.env.ACIRA_BROWSER_TEST_DATA || '');
if (!(ROOT + '/').startsWith(SAFE)) throw new Error(`ACIRA_BROWSER_TEST_DATA must be a throwaway folder under ${SAFE} (got "${process.env.ACIRA_BROWSER_TEST_DATA || ''}")`);
const arg = (name, fallback) => (process.argv.find(a => a.startsWith(`--${name}=`)) || '').slice(name.length + 3) || fallback;
const COUNTS = arg('tabs', '3,8,20').split(',').map(Number), LABEL = arg('label', 'run'), OUT = arg('out', path.join(ROOT, `${LABEL}.json`));
const QUICK = process.argv.includes('--quick'), SECTIONS = arg('sections', 'side,vertical,regress').split(','), VIEW = arg('view', 'full'), SIDEBAR = process.argv.includes('--sidebar');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(`[tab-drag-axis ${LABEL}]`, ...a);

const pages = http.createServer((q, r) => { r.setHeader('content-type', 'text/html'); r.end(`<!doctype html><title>Page ${q.url.slice(1)}</title><body style="margin:0;font:20px system-ui;background:#f4f4f4"><h1>${q.url}</h1>`); });
await new Promise(r => pages.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${pages.address().port}`;

/** A first start of a profile quits at once to commit its key (qa/prepared-native.mjs does this for .qa-profiles; the same step for a /tmp one). */
async function prepare(dir) {
  const nonce = randomUUID(), marker = path.join(dir, `native-key-${nonce}.json`);
  const env = { ...process.env, ACIRA_PREPARE_PROFILE: dir, ACIRA_PREPARE_NONCE: nonce, HOME: path.join(dir, 'home'), APPDATA: path.join(dir, 'fixture-roaming'), LOCALAPPDATA: path.join(dir, 'fixture-local') };
  delete env.ELECTRON_RUN_AS_NODE;
  await fs.mkdir(env.HOME, { recursive: true });
  const child = spawn(req('electron'), ['--use-mock-keychain', path.resolve(REPO, 'qa/prepare-native-profile.cjs')], { env, stdio: 'ignore' });
  let result; for (let i = 0; i < 800 && !result; i++) { try { const r = JSON.parse(await fs.readFile(marker, 'utf8')); if (r.nonce === nonce) result = r; } catch {} await sleep(30); }
  if (!result?.ready) throw new Error(result?.error || 'key preparation did not finish');
  for (let i = 0; i < 800; i++) { try { process.kill(result.pid, 0); } catch { break; } await sleep(30); }
  await fs.unlink(marker).catch(() => {}); child.kill();
  return env;
}

// Runs INSIDE the Electron main process: replays a list of {type, x, y, wait} as real input on the UI view.
const DRIVER = ({ webContents }, events) => (async () => {
  const wc = webContents.getAllWebContents().find(w => w.getURL() === 'acira-browser-ui://ui/index.html');
  const pause = ms => new Promise(r => setTimeout(r, ms));
  wc.focus();
  for (const e of events) {
    if (e.type === 'move') wc.sendInputEvent({ type: 'mouseMove', x: Math.round(e.x), y: Math.round(e.y), modifiers: e.down ? ['leftButtonDown'] : [] });
    else if (e.type === 'down') wc.sendInputEvent({ type: 'mouseDown', x: Math.round(e.x), y: Math.round(e.y), button: e.button || 'left', clickCount: e.count || 1 });
    else if (e.type === 'up') wc.sendInputEvent({ type: 'mouseUp', x: Math.round(e.x), y: Math.round(e.y), button: e.button || 'left', clickCount: e.count || 1 });
    if (e.wait) await pause(e.wait);
  }
  return 'done';
})();

let current = null;
async function boot(n, tag, tweak = () => {}, windowUi = {}, settings = {}) {
  await shutdown();
  const dir = path.join(ROOT, tag);
  await fs.rm(dir, { recursive: true, force: true }); await fs.mkdir(dir, { recursive: true });
  const { BrowserDatabase } = req(REPO + '/desktop/database.cjs'), { createInitialState, makeTab } = req(REPO + '/desktop/runtime.cjs'), s0 = createInitialState();
  s0.tabs = Array.from({ length: n }, (_, i) => makeTab(`t${i + 1}`, '', `${BASE}/p${i + 1}`, s0.activeBrowserProfileId)); s0.activeTabId = 't1';
  Object.assign(s0.settings, { onboardingComplete: true, askBeforeClosing: false, reducedMotion: false, animationSpeed: 'premium', appearance: 'light', verticalTabs: false, bookmarksBar: false });
  Object.assign(s0.settings, settings); Object.assign(s0.windowUi, { view: VIEW, workspaceOpen: SIDEBAR, webWorkspaceOpen: SIDEBAR, ...windowUi }); tweak(s0);
  const db = new BrowserDatabase(path.join(dir, 'browser.sqlite')); db.saveWindow('main', s0); db.close();
  const env = await prepare(dir);
  const app = await _electron.launch({ executablePath: req('electron'), args: ['--use-mock-keychain', path.resolve(REPO, 'desktop/main.cjs'), '--disable-features=CalculateNativeWinOcclusion', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'], env: { ...env, ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: dir, ACIRA_BROWSER_TEST_HIDDEN: '1' }, timeout: 90000 });
  const userData = await app.evaluate(({ app }) => app.getPath('userData'));
  if (!(userData + '/').startsWith(SAFE)) { await app.close().catch(() => {}); throw new Error(`ABORT: userData is ${userData}, not under ${SAFE}`); }
  let ui; for (let i = 0; i < 300 && !ui; i++) { ui = app.context().pages().find(p => { try { return p.url() === 'acira-browser-ui://ui/index.html'; } catch { return false; } }); await sleep(100); }
  if (!ui) throw new Error('UI page not found');
  await app.evaluate(({ screen, BaseWindow }) => { const d = screen.getPrimaryDisplay(), w = BaseWindow.getAllWindows()[0]; w.setBounds({ x: -3000, y: d.workArea.y + 20, width: 1400, height: 860 }); w.showInactive(); });
  for (let i = 0; i < 150; i++) { if (await ui.evaluate(n => document.querySelectorAll('.tabs-strip [data-drag-key]').length === n, n).catch(() => false)) break; await sleep(100); }
  await sleep(1500);
  await ui.evaluate(() => {
    if (window.__ax) return;
    const rec = window.__ax = { on: false, reset() { Object.assign(rec, { chip: 0, picker: false, top: [Infinity, -Infinity], samples: 0, previewSeen: false }); } };
    rec.reset();
    const sample = () => {
      if (!rec.on) return;
      const pv = document.querySelector('.tab-drag-preview');
      if (pv) { rec.previewSeen = true; rec.chip = Math.max(rec.chip, parseFloat(pv.style.getPropertyValue('--chip-p') || '0') || 0); const r = pv.getBoundingClientRect(); rec.top = [Math.min(rec.top[0], r.top), Math.max(rec.top[1], r.top)]; }
      if (document.querySelector('.split-picker-layer')) rec.picker = true;
      rec.samples++;
    };
    setInterval(sample, 4);
  });
  current = { app, ui, n, dir };
  return current;
}
async function shutdown() { if (!current) return; const { app } = current; current = null; await app.close().catch(() => {}); }

const snap = () => current.ui.evaluate(() => window.acira.getSnapshot());
const windowCount = () => current.app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().length);
const geometry = () => current.ui.evaluate(() => {
  const viewport = document.querySelector('.tab-strip-viewport').getBoundingClientRect();
  const tabs = [...document.querySelectorAll('.tabs-strip [data-drag-key]')].filter(e => !e.hasAttribute('inert')).map(e => { const b = e.getBoundingClientRect(); return { id: e.dataset.dragKey, x: b.left, y: b.top, w: b.width, h: b.height, cx: b.left + b.width / 2, cy: b.top + b.height / 2 }; })
    .filter(t => t.cx > viewport.left + 8 && t.cx < viewport.right - 8).sort((a, b) => a.x - b.x);
  const page = document.querySelector('.page-area').getBoundingClientRect();
  return { strip: { top: viewport.top, bottom: viewport.bottom, left: viewport.left, right: viewport.right }, tabs, page: { x: page.x, y: page.y, w: page.width, h: page.height }, innerH: innerHeight, innerW: innerWidth };
});
const order = async () => (await snap()).tabs.map(t => t.id);
const closeExtraWindows = async known => { await current.app.evaluate(({ BaseWindow }, known) => { for (const w of BaseWindow.getAllWindows()) if (!known.includes(w.id)) w.destroy(); }, known); await sleep(500); };
const windowIds = () => current.app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().map(w => w.id));

/** The pointer path: down at (x0,y0), then moves toward x1 in `px` steps every `ms`, y following `wobble(t)` (t 0..1), then a last rest before the button comes up. */
function path_(x0, y0, x1, speed, wobble, rest = 140) {
  const dist = Math.abs(x1 - x0), steps = Math.max(2, Math.ceil(dist / speed.px)), events = [{ type: 'move', x: x0, y: y0, wait: 40 }, { type: 'down', x: x0, y: y0, wait: 90 }];
  let x = x0, y = y0;
  for (let i = 1; i <= steps; i++) { const t = i / steps; x = x0 + (x1 - x0) * t; y = y0 + wobble(t, x - x0); events.push({ type: 'move', x, y, down: true, wait: speed.ms }); }
  events.push({ type: 'move', x, y, down: true, wait: rest }, { type: 'up', x, y, wait: 0 });
  return events;
}
const ramp = t => Math.min(1, t / .12);                                   // the wobble builds over the first 12% of the path (a hand starts sideways)
const SPEEDS = { slow: { px: 3, ms: 24 }, fast: { px: 30, ms: 7 } };
const WOBBLES = {
  none: () => () => 0,
  'sine10 p0': () => t => ramp(t) * 10 * Math.sin(2 * Math.PI * 2.5 * t),
  'sine10 p90': () => t => ramp(t) * 10 * Math.sin(2 * Math.PI * 2.5 * t + Math.PI / 2),
  'sine25 p0': () => t => ramp(t) * 25 * Math.sin(2 * Math.PI * 2.5 * t),
  'sine25 p90': () => t => ramp(t) * 25 * Math.sin(2 * Math.PI * 2.5 * t + Math.PI / 2),
  'sine25 p180': () => t => ramp(t) * 25 * Math.sin(2 * Math.PI * 2.5 * t + Math.PI),
  'sine25 p270': () => t => ramp(t) * 25 * Math.sin(2 * Math.PI * 2.5 * t + 3 * Math.PI / 2),
  'drift +25': () => t => 25 * Math.min(1, t / .3),
  'drift -25': () => t => -25 * Math.min(1, t / .3),
  'sine20 released at +20': () => t => ramp(t) * 20 * Math.sin(2 * Math.PI * 1.75 * t),
  'straight, then +25 at the very end': () => t => (t > .9 ? 25 : 0),
  'straight, then -25 at the very end': () => t => (t > .9 ? -25 : 0),
  'slanted start (dy = .6 dx) to +30': () => (t, dx) => Math.min(30, Math.abs(dx) * .6),
  'slanted start (dy = .6 dx) to -30': () => (t, dx) => -Math.min(30, Math.abs(dx) * .6),
};
const SIDE_CASES = QUICK ? ['none', 'sine25 p0', 'drift +25', 'straight, then +25 at the very end'] : Object.keys(WOBBLES);

/** One sideways reorder: the tab at slot `from` is taken to the middle of slot `to`. Returns what happened. */
async function sideTrial(n, speedName, wobbleName, from, to) {
  const { ui, app } = current, g = await geometry(), A = g.tabs[from], B = g.tabs[to], before = await order(), known = await windowIds();
  if (!A || !B) return { error: `slot ${from}/${to} not visible (${g.tabs.length} tabs on show)` };
  await ui.evaluate(() => { window.__ax.reset(); window.__ax.on = true; });
  await app.evaluate(DRIVER, path_(A.cx, A.cy, B.cx, SPEEDS[speedName], WOBBLES[wobbleName]()));
  await sleep(700);
  const ax = await ui.evaluate(() => { window.__ax.on = false; return { chip: window.__ax.chip, picker: window.__ax.picker, top: window.__ax.top, previewSeen: window.__ax.previewSeen }; });
  const after = await order(), windows = (await windowIds()).length, id = before[before.indexOf(A.id) >= 0 ? before.indexOf(A.id) : 0];
  const g2 = await geometry();
  const result = { n, speed: speedName, wobble: wobbleName, from, to, id: A.id, finalSlot: g2.tabs.findIndex(t => t.id === A.id), expectedSlot: to, ok: g2.tabs.findIndex(t => t.id === A.id) === to,
    chip: +ax.chip.toFixed(2), picker: ax.picker, torn: windows > known.length, tabsLeft: after.length, driftPx: ax.previewSeen ? Math.round(Math.max(Math.abs(ax.top[0] - A.y), Math.abs(ax.top[1] - A.y))) : null };
  if (windows > known.length) await closeExtraWindows(known);
  result.flipped = result.chip > .02 || result.picker || result.torn;
  result.pass = result.ok && !result.flipped;
  return result;
}

const rows = [];
try {
  if (SECTIONS.includes('side')) for (const n of COUNTS) {
    await boot(n, `side-n${n}-${randomUUID().slice(0, 6)}`);
    const g0 = await geometry(), lo = n <= 3 ? 0 : n <= 8 ? 1 : 3, hi = n <= 3 ? Math.min(2, g0.tabs.length - 1) : n <= 8 ? 5 : 9;
    log(`n=${n}: strip ${JSON.stringify(g0.strip)}, ${g0.tabs.length} tabs on show, tab ${Math.round(g0.tabs[0].w)}x${Math.round(g0.tabs[0].h)}, row centre y=${Math.round(g0.tabs[0].cy)}, slots ${lo}<->${hi}`);
    let k = 0;
    for (const speedName of Object.keys(SPEEDS)) for (const wobbleName of SIDE_CASES) {
      const forward = k++ % 2 === 0, row = await sideTrial(n, speedName, wobbleName, forward ? lo : hi, forward ? hi : lo);
      rows.push({ section: 'side', ...row }); log(row.error ? `ERROR ${row.error}` : `${row.pass ? 'PASS' : 'FAIL'}  n=${n} ${speedName.padEnd(4)} ${wobbleName.padEnd(36)} slot ${row.from}->${row.to} landed ${row.finalSlot}  chip=${row.chip} picker=${row.picker} torn=${row.torn} drift=${row.driftPx}px`);
      if (row.torn || (row.tabsLeft ?? n) !== n) { log('  (a tab left the window: fresh profile)'); await boot(n, `side-n${n}-${randomUUID().slice(0, 6)}`); }
    }
  }
  if (SECTIONS.includes('vertical')) {
    await boot(8, `vertical-${randomUUID().slice(0, 6)}`);
    const vertical = async (name, script, check) => {
      const g = await geometry(), A = g.tabs[2], known = await windowIds(), before = await order();
      await current.ui.evaluate(() => { window.__ax.reset(); window.__ax.on = true; });
      const mid = { x: g.page.x + g.page.w / 2, y: g.page.y + g.page.h / 2 }, corner = { x: g.page.x + g.page.w - 40, y: g.page.y + g.page.h - 40 };
      const run = events => current.app.evaluate(DRIVER, events);
      const cells = () => current.ui.evaluate(() => [...document.querySelectorAll('.split-picker-cell')].map(e => { const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }));
      await script({ A, g, mid, corner, run, cells });
      await sleep(900);
      const ax = await current.ui.evaluate(() => { window.__ax.on = false; return { chip: window.__ax.chip, picker: window.__ax.picker }; }), s = await snap(), windows = (await windowIds()).length;
      const row = { section: 'vertical', name, chip: +ax.chip.toFixed(2), picker: ax.picker, split: !!s.windowUi.split, torn: windows > known.length, tabs: s.tabs.length, orderChanged: before.join() !== s.tabs.map(t => t.id).join() };
      row.pass = check(row); rows.push(row); log(`${row.pass ? 'PASS' : 'FAIL'}  vertical: ${name.padEnd(62)} chip=${row.chip} picker=${row.picker} split=${row.split} torn=${row.torn} orderChanged=${row.orderChanged}`);
      if (row.split) { await current.ui.evaluate(() => window.acira.dispatch({ type: 'split.close' })); await sleep(500); }
      if (windows > known.length) { await closeExtraWindows(known); await boot(8, `vertical-${randomUUID().slice(0, 6)}`); }
    };
    const to = (A, p, step = 12, ms = 14) => { const ev = [], n = Math.max(2, Math.ceil(Math.hypot(p.x - A.x, p.y - A.y) / step)); for (let i = 1; i <= n; i++) ev.push({ type: 'move', x: A.x + (p.x - A.x) * i / n, y: A.y + (p.y - A.y) * i / n, down: true, wait: ms }); return ev; };
    const press = A => [{ type: 'move', x: A.cx, y: A.cy, wait: 40 }, { type: 'down', x: A.cx, y: A.cy, wait: 90 }];
    const at = A => ({ x: A.cx, y: A.cy });
    await vertical('straight down onto the page, held, released off the card', async ({ A, mid, corner, run }) => run([...press(A), ...to(at(A), mid), { type: 'move', ...mid, down: true, wait: 500 }, ...to(mid, corner), { type: 'move', ...corner, down: true, wait: 300 }, { type: 'up', ...corner }]), r => r.chip > .9 && r.picker && !r.split && !r.torn && !r.orderChanged);
    await vertical('straight down onto the page, released on a picker cell', async ({ A, mid, run, cells }) => { await run([...press(A), ...to(at(A), mid), { type: 'move', ...mid, down: true, wait: 800 }]); let c; for (let i = 0; i < 40 && !c; i++) { c = (await cells())[1]; if (!c) await sleep(100); } if (!c) { await run([{ type: 'up', ...mid }]); return; } await run([...to(mid, c), { type: 'move', ...c, down: true, wait: 400 }, { type: 'up', ...c }]); }, r => r.split);
    await vertical('slanted down (dy 4x dx) onto the page, released off the card', async ({ A, mid, corner, run }) => { const slant = { x: A.cx + (mid.y - A.cy) / 4, y: mid.y }; await run([...press(A), ...to(at(A), slant), { type: 'move', ...slant, down: true, wait: 500 }, ...to(slant, corner), { type: 'move', ...corner, down: true, wait: 300 }, { type: 'up', ...corner }]); }, r => r.chip > .9 && r.picker && !r.split && !r.torn && !r.orderChanged);
    await vertical('straight down out of the window bottom (tear off)', async ({ A, g, run }) => { const out = { x: A.cx, y: g.innerH + 140 }; await run([...press(A), ...to(at(A), out), { type: 'move', ...out, down: true, wait: 300 }, { type: 'up', ...out }]); }, r => r.torn);
    await vertical('down 60px (chip forms), back up, then sideways 3 slots', async ({ A, g, run }) => { const B = g.tabs[5], low = { x: A.cx, y: A.cy + 60 }, back = at(A), far = { x: B.cx, y: A.cy }; await run([...press(A), ...to(back, low), { type: 'move', ...low, down: true, wait: 250 }, ...to(low, back), { type: 'move', ...back, down: true, wait: 250 }, ...to(back, far, 3, 24), { type: 'move', ...far, down: true, wait: 200 }, { type: 'up', ...far }]); }, r => r.orderChanged && !r.split && !r.torn);
  }

  if (SECTIONS.includes('regress')) {
    // Everything that worked before must still work: clicks, middle click, the close button, the mute button, pinned tabs, groups, the reorder-by-position fix, split chips, the sidebar's own drag.
    const check = (name, pass, detail = '') => { rows.push({ section: 'regress', name, pass: !!pass, detail }); log(`${pass ? 'PASS' : 'FAIL'}  regress: ${name.padEnd(70)} ${detail}`); };
    const act = a => current.ui.evaluate(a => window.acira.dispatch(a), a);
    const drive = events => current.app.evaluate(DRIVER, events);
    const tap = (x, y, button = 'left', counts = [1]) => counts.flatMap(count => [{ type: 'move', x, y, wait: 30 }, { type: 'down', x, y, button, count, wait: 50 }, { type: 'up', x, y, button, count, wait: 60 }]);
    const centre = async (selector) => current.ui.evaluate(sel => { const e = [...document.querySelectorAll(sel)].find(e => e.getBoundingClientRect().width > 0); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width, h: b.height }; }, selector);
    const tabAt = async id => centre(`.tabs-strip [data-drag-key="${id}"]`);
    const dragTo = async (from, to, wobble = () => 0, speed = SPEEDS.slow) => { const a = await tabAt(from), b = typeof to === 'string' ? await tabAt(to) : { x: to.x }; await drive(path_(a.x, a.y, b.x, speed, wobble)); await sleep(700); };
    const ids = async () => (await snap()).tabs.map(t => t.id);
    const live = async () => (await geometry()).tabs.map(t => t.id);
    const seed = s => { s.tabs[2].muted = true; };

    await boot(8, `regress-${randomUUID().slice(0, 6)}`, seed);
    let t = await tabAt('t5'); await drive(tap(t.x, t.y)); await sleep(500);
    check('a click selects the tab', (await snap()).activeTabId === 't5', `active ${(await snap()).activeTabId}`);
    t = await tabAt('t4'); await drive(tap(t.x, t.y, 'left', [1, 2])); await sleep(500);
    check('a double click on a tab selects it and reorders nothing', (await snap()).activeTabId === 't4' && (await ids()).join() === 't1,t2,t3,t4,t5,t6,t7,t8', `active ${(await snap()).activeTabId}`);
    const mute = await centre('.tabs-strip [data-drag-key="t3"] .tab-audio.is-muted');
    check('a muted tab shows its speaker-off button', !!mute, mute ? 'present' : 'missing');
    check('a muted tab shows its muted badge/indicator markup', await current.ui.evaluate(() => !!document.querySelector('.tabs-strip [data-drag-key="t3"][data-sound="muted"]')), 'data-sound=muted');
    if (mute) { await drive(tap(mute.x, mute.y)); await sleep(500); check('the mute button unmutes without starting a drag', (await snap()).tabs.find(x => x.id === 't3').muted === false && (await ids()).join() === 't1,t2,t3,t4,t5,t6,t7,t8', 'muted -> false'); }
    t = await tabAt('t6'); await drive(tap(t.x, t.y, 'middle')); await sleep(600);
    check('a middle click closes the tab', !(await ids()).includes('t6'), `${(await ids()).length} tabs`);
    await current.ui.evaluate(() => 0);
    t = await centre('.tabs-strip [data-drag-key="t7"]'); await drive([{ type: 'move', x: t.x, y: t.y, wait: 200 }]);
    const close = await centre('.tabs-strip [data-drag-key="t7"] .tab-close'); if (close) { await drive(tap(close.x, close.y)); await sleep(600); }
    check('the close button closes the tab', !(await ids()).includes('t7'), `${(await ids()).length} tabs`);

    // The reorder-by-position fix (93568688): a flick, and a stop just past / just short of the neighbour's middle.
    await boot(8, `regress-${randomUUID().slice(0, 6)}`);
    let g = await geometry(), w = g.tabs[0].w;
    await dragTo('t2', { x: (await tabAt('t2')).x + w * .62 }, () => 0, SPEEDS.slow); check('a slow stop past the neighbour\'s middle swaps (position, not speed)', (await live()).slice(0, 3).join() === 't1,t3,t2', (await live()).slice(0, 3).join());
    await dragTo('t2', { x: (await tabAt('t2')).x + w * .3 }, () => 0, SPEEDS.slow); check('a stop short of the middle does not swap', (await live()).slice(0, 4).join() === 't1,t3,t2,t4', (await live()).slice(0, 4).join());
    await dragTo('t1', 't5', () => 0, SPEEDS.fast); check('a flick across four tabs lands on the fifth slot', (await live()).indexOf('t1') === 4, `slot ${(await live()).indexOf('t1')}`);
    await dragTo('t1', 't2', () => 0, SPEEDS.slow);
    const base = await ids(); await dragTo(base[2], { x: (await tabAt(base[2])).x }, () => 0, SPEEDS.slow);
    check('a drag released where it started changes nothing', (await ids()).join() === base.join(), 'order kept');
    const before = await live();
    await dragTo(before[1], { x: (await geometry()).strip.right + 60 }, t => 25 * Math.min(1, t / .3), SPEEDS.slow);
    check('past the end of the strip with the hand 25px low: placed at the end, not cancelled', (await live()).at(-1) === before[1], `slot ${(await live()).indexOf(before[1])} of ${before.length}`);
    const known = await windowIds(), edge = await tabAt((await live())[2]);
    await drive(path_(edge.x, edge.y, -60, SPEEDS.fast, () => 0)); await sleep(1200);
    check('leaving the window sideways still tears the tab off', (await windowIds()).length === known.length + 1, `windows ${known.length} -> ${(await windowIds()).length}`);
    await closeExtraWindows(known);

    // Pinned tabs and groups keep their partitions, also with the hand drifting.
    await boot(8, `regress-${randomUUID().slice(0, 6)}`);
    await act({ type: 'tab.pin', id: 't1' }); await act({ type: 'tab.pin', id: 't2' }); await sleep(800);
    await dragTo('t1', 't2', t => 22 * Math.sin(2 * Math.PI * 2 * t) * Math.min(1, t / .12)); check('a pinned tab reorders among the pinned, hand drifting', (await live()).slice(0, 2).join() === 't2,t1', (await live()).slice(0, 3).join());
    await dragTo('t6', 't1', t => 22 * Math.sin(2 * Math.PI * 2 * t) * Math.min(1, t / .12)); const afterPins = await live();
    check('an unpinned tab dragged over the pinned ones stays after them', afterPins.indexOf('t6') >= 2 && afterPins.slice(0, 2).join() === 't2,t1', afterPins.slice(0, 4).join());
    await act({ type: 'tab.group.create', tabId: 't4', name: 'Research', color: 'blue' }); const gid = (await snap()).tabGroups[0].id; await act({ type: 'tab.group.assign', tabIds: ['t5'], groupId: gid }); await sleep(900);
    const inGroup = async id => (await snap()).tabs.find(x => x.id === id).group;
    await dragTo('t7', 't4', t => 20 * Math.sin(2 * Math.PI * 2 * t) * Math.min(1, t / .12)); check('a tab dragged onto a group member joins the group, hand drifting', !!(await inGroup('t7')), `group of t7: ${JSON.stringify(await inGroup('t7'))}`);
    const members = (await snap()).tabs.filter(x => x.group).map(x => x.id), lastMember = (await live()).filter(id => members.includes(id)).at(-1), firstMember = (await live()).find(id => members.includes(id));
    const o = await ids(); await dragTo(lastMember, firstMember, t => 20 * Math.sin(2 * Math.PI * 2 * t) * Math.min(1, t / .12));
    check('a group member reorders inside its group and stays in it, hand drifting', !!(await inGroup(lastMember)) && (await ids()).join() !== o.join(), `group kept ${JSON.stringify(await inGroup(lastMember))}`);
    const beyond = (await geometry()).tabs.at(-1).cx; const member = (await live()).filter(id => members.includes(id))[0];
    await dragTo(member, { x: beyond + 30 }, () => 0, SPEEDS.slow); await sleep(300);
    check('a group member dragged past the group\'s end leaves the group', !(await inGroup(member)), `group of ${member}: ${JSON.stringify(await inGroup(member))}`);

    // A split group chip in the strip takes a dropped tab (R3-79).
    await boot(8, `regress-${randomUUID().slice(0, 6)}`);
    await act({ type: 'tab.select', id: 't2' }); await act({ type: 'split.open', tabIds: ['t2', 't3'] }); await sleep(1200);
    const sg = (await snap()).windowUi.splitGroups?.[0];
    if (!sg) check('a split group exists for the drop test', false, 'split.open did not make a group');
    else { const member = await tabAt('t3'); await dragTo('t6', { x: member.x }, t => 20 * Math.sin(2 * Math.PI * 2 * t) * Math.min(1, t / .12)); const now = (await snap()).windowUi.splitGroups?.[0];
      check('a tab dropped on a split group in the strip joins it, hand drifting', now?.tabIds.includes('t6'), `split tabs ${JSON.stringify(now?.tabIds)}`); }

    // The sidebar's own drag is not part of this change (vertical tabs, sidebar open).
    await boot(8, `regress-${randomUUID().slice(0, 6)}`, () => {}, { workspaceOpen: true, webWorkspaceOpen: true }, { verticalTabs: true });
    await sleep(1500);
    const rowsAt = async () => current.ui.evaluate(() => [...document.querySelectorAll('.sb-tab[data-tab-id]:not(.sb-flip-ghost)')].map(e => { const b = e.getBoundingClientRect(); return { id: e.dataset.tabId, x: b.x + b.width / 2, y: b.y + b.height / 2, h: b.height }; }).sort((a, b) => a.y - b.y));
    const r0 = await rowsAt(); const sbBefore = await ids();
    if (r0.length >= 5) { const a = r0[1], b = r0[4]; await drive(path_(a.x, a.y, b.x, SPEEDS.slow, () => 0).slice(0, 2).concat(Array.from({ length: 24 }, (_, i) => ({ type: 'move', x: a.x + 6, y: a.y + (b.y - a.y) * (i + 1) / 24, down: true, wait: 24 })), [{ type: 'move', x: a.x + 6, y: b.y, down: true, wait: 200 }, { type: 'up', x: a.x + 6, y: b.y }])); await sleep(900);
      const sbAfter = await ids(); check('a sidebar row dragged down three rows reorders', sbAfter.indexOf(r0[1].id) > sbBefore.indexOf(r0[1].id), `${r0[1].id}: ${sbBefore.indexOf(r0[1].id)} -> ${sbAfter.indexOf(r0[1].id)}`); }
    else check('the sidebar lists its rows', false, `${r0.length} rows`);
  }

  if (SECTIONS.includes('shots')) {
    // Mid-drag stills of the strip with the hand drifting away from it (the tab is held there, the button still down), for a before/after look.
    const dir = arg('shots', path.join(ROOT, 'shots')); await fs.mkdir(dir, { recursive: true });
    await boot(8, `shots-${randomUUID().slice(0, 6)}`);
    for (const [name, dy] of [['sideways-hand-40px-low', 40], ['sideways-hand-30px-high', -30], ['sideways-hand-20px-low', 20]]) {
      const g = await geometry(), A = g.tabs[1], B = g.tabs[4], events = path_(A.cx, A.cy, (A.cx + B.cx) / 2 + 20, SPEEDS.slow, t => dy * Math.min(1, t / .25), 400);
      const last = events.at(-2); await current.app.evaluate(DRIVER, events.slice(0, -1)); await sleep(500);
      await current.ui.screenshot({ path: path.join(dir, `${LABEL}-${name}.png`), clip: { x: 0, y: 0, width: 1400, height: 110 } });
      await current.app.evaluate(DRIVER, [{ type: 'up', x: last.x, y: last.y }]); await sleep(900);
      rows.push({ section: 'shots', name, pass: true }); log(`still ${LABEL}-${name}.png`);
    }
  }
} finally {
  await shutdown(); pages.close();
  const failed = rows.filter(r => r.pass === false || r.error);
  await fs.mkdir(path.dirname(OUT), { recursive: true }); await fs.writeFile(OUT, JSON.stringify({ label: LABEL, rows }, null, 1));
  log(`${rows.length} trials, ${failed.length} failed -> ${OUT}`);
  const summary = {}; for (const r of rows.filter(r => r.section === 'side')) { const k = `${r.n} tabs, ${r.speed}`; (summary[k] ||= { trials: 0, pass: 0 }); summary[k].trials++; if (r.pass) summary[k].pass++; }
  console.table(summary);
}
