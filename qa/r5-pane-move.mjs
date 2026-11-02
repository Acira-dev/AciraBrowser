// Pane moves in a split, real app (real input through sendInputEvent on the interface view; the OS cursor never moves):
//   every pane of a 3- and 4-pane split dragged by its ribbon onto every other pane's left / right / top / bottom band and middle. For each drop the
//   highlight on screen (the landing box, the swap target or nothing) is read just before the release, and after the release the dragged pane must sit
//   exactly where the highlight said (a move: the landing box; a swap: the target's old cell, the target in the dragged pane's old cell; nothing: no change).
//   Also logs every zone change along the way (flicker = a zone that comes back within three moves) and takes shots of the side / top / middle highlights
//   and of the layout card brought up by dragging past the top of the page.
//   node qa/r5-pane-move.mjs [tag]   (cwd = worktree root; one native slot, one Electron app, closed in finally; 4 tabs; bounded loops)
//   LAYOUTS=three-columns,grid  limits the layouts; LIMIT=n stops after n drops.
// Evidence: C:/ae/r5/panes/evidence/<tag>/ (results.json, drops.json, PNGs)
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const root = process.cwd(), tag = process.argv[2] || 'run';
const OUT = path.join('C:/ae/r5/panes/evidence', tag); await fs.mkdir(OUT, { recursive: true });
const PROFILES = 'C:/ae/r5/panes/profiles';
const results = [], drops = [];
const log = (...a) => console.log('[qa]', ...a);
const check = (ok, label) => { results.push({ ok: !!ok, label }); log(ok ? 'PASS' : 'FAIL', label); };

async function slot() {
  for (let i = 0; i < 40; i++) {
    for (const n of [1, 2, 3]) { const f = `C:/ae/slot-${n}.lock`; try { const h = await fs.open(f, 'wx'); await h.write(`r5-pane-move ${new Date().toISOString()}`); await h.close(); return f; } catch {} }
    await sleep(30000);
  }
  throw Error('no slot');
}
async function launch() {
  const req = createRequire(path.join(root, 'package.json'));
  const { _electron } = req('playwright'); const electronExe = req('electron');
  const profile = path.join(PROFILES, 'pm-' + Date.now());
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

const pages = { one: ['Alpha', '#f6e3e3'], two: ['Bravo', '#f8ecdc'], three: ['Charlie', '#e1ecfb'], four: ['Delta', '#e9eee3'] };
const server = http.createServer((req, res) => { const k = req.url.slice(1) || 'one', [title, bg] = pages[k] || ['Page', '#fff']; res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(`<!doctype html><title>${title}</title><body style="margin:0;background:${bg};font:600 28px system-ui;color:#222;display:grid;place-items:center;height:100vh">${title}`); });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

const UI = 'acira-browser-ui://ui/index.html';
let app, ui, lock, pointer = { x: 0, y: 0 };
const uiPage = async () => { for (let i = 0; i < 300; i++) { const p = app.context().pages().find(p => { try { return p.url() === UI; } catch { return false; } }); if (p) return p; await sleep(100); } throw Error('ui page not found'); };
const act = a => ui.evaluate(a => window.acira.dispatch(a), a);
const state = () => ui.evaluate(() => window.acira.getSnapshot());
const split = async () => (await state()).windowUi.split;
const focusWin = () => app.evaluate(({ BaseWindow }) => { for (const w of BaseWindow.getAllWindows()) if (w.isVisible()) { w.show(); w.focus(); } });
const input = event => app.evaluate(({ webContents }, event) => { webContents.getAllWebContents().find(x => x.getURL() === 'acira-browser-ui://ui/index.html')?.sendInputEvent(event); }, event);
const mouse = (type, x, y) => input({ type, x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1, ...(type === 'mouseMove' ? { modifiers: ['leftButtonDown'] } : {}) });
const key = async k => { await input({ type: 'keyDown', keyCode: k }); await input({ type: 'keyUp', keyCode: k }); };
const box = sel => ui.evaluate(sel => { const r = document.querySelector(sel)?.getBoundingClientRect(); return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null; }, sel);
const waitFor = async (fn, label, ms = 6000) => { const end = Date.now() + ms; let v; do { v = await fn(); if (v) return v; await sleep(50); } while (Date.now() < end); throw Error('timeout ' + label); };
/** The panes on screen (viewport coordinates) by tab id, and their ribbons. */
const paneBoxes = () => ui.evaluate(() => Object.fromEntries([...document.querySelectorAll('.page-area .split-pages [data-pane]')].map(n => { const r = n.getBoundingClientRect(), l = n.querySelector('.split-label')?.getBoundingClientRect(); return [n.dataset.pane, { x: r.x, y: r.y, w: r.width, h: r.height, ribbon: l ? { x: l.x, y: l.y, w: l.width, h: l.height } : null }]; })));
/** What the highlight says right now: the landing box of a move (viewport coordinates), the swap target's box, or nothing; plus the layout card. */
const highlight = () => ui.evaluate(() => {
  const live = sel => [...document.querySelectorAll(sel)].filter(n => getComputedStyle(n).opacity !== '0' && !n.closest('[data-motion-ghost]'));
  const z = live('.split-pane-zone').at(-1), over = live('.split-drag-zone[data-over]').at(-1), card = live('.split-picker-card').at(-1);
  const rect = n => { const r = n.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
  return { move: z ? { kind: z.dataset.kind, label: z.textContent, ...rect(z) } : null, swap: over ? { pane: over.dataset.pane || null, ...rect(over) } : null, card: Boolean(card), probe: globalThis.__aciraPaneDragProbe?.at(-1) ?? null };
});
async function glide(x, y, steps = 14, wait = 14, sample = null) { const from = pointer; for (let i = 1; i <= steps; i++) { await mouse('mouseMove', from.x + (x - from.x) * i / steps, from.y + (y - from.y) * i / steps); await sleep(wait); if (sample) sample.push(await zoneKey()); } pointer = { x, y }; }
const zoneKey = () => ui.evaluate(() => { const p = globalThis.__aciraPaneDragProbe?.at(-1); if (p) return p.key; const z = document.querySelector('.split-pane-zone'), o = document.querySelector('.split-drag-zone[data-over]'); return z ? 'm:' + z.textContent : o ? 's:' + Math.round(o.getBoundingClientRect().x) : ''; });
const near = (a, b, tol = 4) => a && b && Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol && Math.abs(a.w - b.w) <= tol && Math.abs(a.h - b.h) <= tol;
const sameBox = (a, b) => near(a, b, 4);
/** A point well inside the named band of a box (a tenth of the way in), on the middle of the other axis; the middle for 'centre'. */
const aim = (b, where) => where === 'left' ? { x: b.x + b.w * .1, y: b.y + b.h * .55 } : where === 'right' ? { x: b.x + b.w * .9, y: b.y + b.h * .55 } : where === 'top' ? { x: b.x + b.w * .5, y: b.y + Math.max(b.h * .1, 34) } : where === 'bottom' ? { x: b.x + b.w * .5, y: b.y + b.h * .9 } : { x: b.x + b.w * .5, y: b.y + b.h * .55 };
const flickers = keys => { let n = 0; for (let i = 2; i < keys.length; i++) for (let k = Math.max(0, i - 3); k < i - 1; k++) if (keys[i] && keys[i] === keys[k] && keys[i - 1] !== keys[i]) { n++; break; } return n; };

async function pressRibbon(b) {
  const x = b.ribbon.x + Math.min(70, b.ribbon.w / 3), y = b.ribbon.y + b.ribbon.h / 2; pointer = { x, y };
  if (process.env.DEBUG) log('press', Math.round(x), Math.round(y), await ui.evaluate(([x, y]) => { const n = document.elementFromPoint(x, y); return n ? `${n.tagName}.${n.className}` : 'none'; }, [x, y]));
  await mouse('mouseMove', x, y); await sleep(40); await mouse('mouseDown', x, y); await sleep(30);
  await glide(x + 6, y + 16, 3, 14);
}
const LIMIT = Number(process.env.LIMIT || 1e9);
let shotsWanted = new Set(['side', 'top', 'centre']);
async function shot(name) {
  await sleep(250);
  const b64 = await app.evaluate(async ({ BaseWindow, desktopCapturer }) => { const w = BaseWindow.getAllWindows().find(x => x.isVisible()) || BaseWindow.getAllWindows()[0], [cw, ch] = w.getSize(); const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: cw, height: ch } }); const s = sources.find(x => x.id === w.getMediaSourceId()); return s ? s.thumbnail.toPNG().toString('base64') : null; });
  if (b64) await fs.writeFile(path.join(OUT, name + '.png'), Buffer.from(b64, 'base64'));
  log('shot', name, b64 ? 'ok' : 'EMPTY');
}

async function arrange(layout, order) {
  const now = await split();
  if (!now || now.tabIds.length !== order.length) { await act({ type: 'split.close' }); await sleep(400); await act({ type: 'tab.select', id: order[0] }); await act({ type: 'split.open', tabIds: order, layout }); }
  else if (now.layout !== layout || now.tabIds.join() !== order.join()) await act({ type: 'split.arrange', layout, order });
  await waitFor(async () => { const s = await split(); return s && s.layout === layout && s.tabIds.join() === order.join(); }, 'arranged ' + layout);
  await waitFor(async () => Object.keys(await paneBoxes()).length === order.length, 'pane boxes');
  await sleep(650);
}

async function oneDrop(layout, order, from, to, where, names) {
  await arrange(layout, order);
  const before = await paneBoxes(), target = before[to];
  await ui.evaluate(() => { globalThis.__aciraPaneDragProbe = []; });
  await pressRibbon(before[from]);
  const p = aim(target, where), path = [];
  await glide(p.x, p.y, 14, 14, path);
  await sleep(320);
  const seen = await highlight();
  const caseName = `${layout} ${names[from]}→${names[to]}.${where}`;
  if (where === 'centre' && shotsWanted.has('centre') && seen.swap) { shotsWanted.delete('centre'); await shot(`highlight-centre-swap ${layout} ${names[from]}-${names[to]}`.replace(/ /g, '_')); }
  if ((where === 'left' || where === 'right') && shotsWanted.has('side') && seen.move) { shotsWanted.delete('side'); await shot(`highlight-side-${where} ${layout} ${names[from]}-${names[to]}`.replace(/ /g, '_')); }
  if (where === 'top' && shotsWanted.has('top') && seen.move) { shotsWanted.delete('top'); await shot(`highlight-top ${layout} ${names[from]}-${names[to]}`.replace(/ /g, '_')); }
  await mouse('mouseUp', pointer.x, pointer.y);
  await sleep(900);
  const after = await split(), boxes = await paneBoxes();
  await waitFor(async () => Object.keys(await paneBoxes()).length === order.length, 'pane boxes after');
  let shown = 'none', ok;
  const unchanged = after.layout === layout && after.tabIds.join() === order.join();
  if (seen.move) { shown = `move ${seen.move.label}`; ok = sameBox(boxes[from], seen.move) && !unchanged; }
  else if (seen.swap) { const swapped = seen.swap.pane || Object.entries(before).find(([, b]) => near(b, seen.swap, 12))?.[0]; shown = `swap ${names[swapped] ?? '?'}`; ok = Boolean(swapped) && sameBox(boxes[from], before[swapped]) && sameBox(boxes[swapped], before[from]); }
  else ok = unchanged;
  const silentSwap = where !== 'centre' && Boolean(seen.swap), wrongRegion = where === 'centre' ? !seen.swap : Boolean(seen.swap);
  const row = { case: caseName, shown, result: `${after.layout} ${after.tabIds.map(id => names[id]).join('')}`, ok, silentSwap, wrongRegion, flickers: flickers(path), path: [...new Set(path)].join(' > ') };
  drops.push(row); log(ok ? 'ok ' : 'MISMATCH', caseName, '| shown', shown, '| result', row.result, row.flickers ? `| flicker ${row.flickers}` : '');
  return row;
}

async function cardScenario(order) {
  await arrange('three-columns', order.slice(0, 3));
  const before = await paneBoxes(), area = await box('.page-area');
  await ui.evaluate(() => { globalThis.__aciraPaneDragProbe = []; });
  await pressRibbon(before[order[2]]);
  await glide(area.x + area.w / 2, area.y + area.h / 2, 10);
  await sleep(300); const mid = await highlight();
  check(!mid.card || process.env.BEFORE, `the layout card stays away while the pointer is on the panes (card ${mid.card})`);
  await glide(area.x + area.w / 2, area.y - 12, 10); await sleep(350);
  const up = await highlight();
  check(up.card, 'dragging past the top of the page brings the layout card down');
  await shot('card-summoned-past-top');
  await glide(area.x + area.w / 2, area.y + area.h * .7, 10); await sleep(350);
  const down = await highlight();
  check(!down.card || process.env.BEFORE, `moving back down onto the panes puts the card away (card ${down.card})`);
  await key('Escape'); await sleep(300);
  await mouse('mouseUp', pointer.x, pointer.y); await sleep(700);
  const now = await split();
  check(now.layout === 'three-columns' && now.tabIds.join() === order.slice(0, 3).join(), 'Esc then release: nothing changed');
}

try {
  lock = await slot(); log('slot', lock);
  app = await launch();
  ui = await uiPage(); await ui.waitForLoadState('domcontentloaded');
  await app.evaluate(({ BaseWindow }) => { for (const w of BaseWindow.getAllWindows()) if (w.isVisible()) { w.setContentSize(1640, 960); w.setPosition(30, 20); } });
  await focusWin();
  const skip = ui.getByRole('button', { name: 'Skip setup' }); await skip.first().waitFor({ timeout: 20000 }).catch(() => {}); if (await skip.count()) await skip.first().click({ timeout: 5000 }).catch(() => {});
  await sleep(1800); ui = await uiPage();
  const done = ui.getByRole('button', { name: /^Done$/ }); if (await done.count()) { await done.first().click().catch(() => {}); await sleep(700); }
  await focusWin();
  await act({ type: 'settings.update', patch: { appearance: 'dark', verticalTabs: false, interfaceScale: 100 } }); await sleep(1000);
  const first = (await state()).activeTabId; await act({ type: 'tab.navigate', tabId: first, url: base + 'one' });
  for (const n of ['two', 'three', 'four']) await act({ type: 'tab.new', url: base + n, background: true });
  await waitFor(async () => (await state()).tabs.length === 4, 'four tabs'); await sleep(1200);
  for (const tab of (await state()).tabs) { await act({ type: 'tab.select', id: tab.id }); await sleep(900); }
  await act({ type: 'tab.select', id: first }); await sleep(600);
  const ids = (await state()).tabs.map(t => t.id), names = Object.fromEntries(ids.map((id, i) => [id, 'ABCD'[i]]));
  const area = await box('.page-area'); log('page area', JSON.stringify(area));
  const wanted = (process.env.LAYOUTS || 'three-columns,left-one-right-two,grid,four-columns').split(',');
  let count = 0;
  for (const layout of wanted) {
    const n = ['three-columns', 'three-rows', 'top-two-bottom-one', 'top-one-bottom-two', 'left-one-right-two', 'left-two-right-one'].includes(layout) ? 3 : 4, order = ids.slice(0, n);
    for (const from of order) for (const to of order) if (from !== to) for (const where of ['left', 'right', 'top', 'bottom', 'centre']) {
      if (count++ >= LIMIT) break;
      try { await oneDrop(layout, order, from, to, where, names); } catch (error) { drops.push({ case: `${layout} ${names[from]}→${names[to]}.${where}`, ok: false, error: String(error) }); log('ERROR', String(error)); await key('Escape').catch(() => {}); await mouse('mouseUp', pointer.x, pointer.y).catch(() => {}); await sleep(600); }
    }
  }
  await cardScenario(ids).catch(error => check(false, 'card scenario: ' + error));
  const bad = drops.filter(d => !d.ok), silent = drops.filter(d => d.silentSwap), wrong = drops.filter(d => d.wrongRegion), flick = drops.reduce((s, d) => s + (d.flickers || 0), 0);
  check(drops.length >= 60, `${drops.length} drops`);
  check(bad.length === 0, `drop = highlight every time (${drops.length - bad.length}/${drops.length}; mismatches ${bad.length})`);
  check(silent.length === 0, `no edge lights as a swap (${silent.length})`);
  check(wrong.length === 0, `the middle swaps and only the middle (${wrong.length} off)`);
  check(flick === 0, `no zone flicker along the drag paths (${flick})`);
} catch (error) {
  check(false, 'script error: ' + (error?.stack || error));
} finally {
  try { await app?.close(); } catch {}
  try { server.close(); } catch {}
  if (lock) await fs.unlink(lock).catch(() => {});
  await fs.writeFile(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1));
  await fs.writeFile(path.join(OUT, 'drops.json'), JSON.stringify(drops, null, 1));
  const failed = results.filter(r => !r.ok); log(`${results.length - failed.length}/${results.length} passed`); for (const f of failed) log('  FAILED:', f.label);
  process.exit(failed.length ? 1 : 0);
}
