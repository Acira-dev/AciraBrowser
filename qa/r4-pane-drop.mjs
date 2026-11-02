// R4-40 / R4-41 real-app QA: a tab dragged from the strip over an open split drops straight onto a pane (middle = replace, edge = open beside);
// the layout island sits in the middle of the page area and steps aside from the pointer.
//   node qa/r4-pane-drop.mjs [tag]     (cwd = worktree root; one native slot, one Electron, closed in finally)
// Real input: sendInputEvent into the chrome view. Evidence: C:/ae/r4/split-arrange/evidence/<tag>/
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const root = process.cwd(), tag = process.argv[2] || 'drop';
const OUT = path.join('C:/ae/r4/split-arrange/evidence', tag); await fs.mkdir(OUT, { recursive: true });
const PROFILES = 'C:/ae/r4/split-arrange/profiles';
const results = [];
const log = (...a) => console.log('[qa]', ...a);
const check = (ok, label) => { results.push({ ok, label }); log(ok ? 'PASS' : 'FAIL', label); };

async function slot() {
  for (let i = 0; i < 60; i++) {
    for (const n of [1, 2, 3]) { const f = `C:/ae/slot-${n}.lock`; try { const h = await fs.open(f, 'wx'); await h.write(`split-arrange drop ${new Date().toISOString()}`); await h.close(); return f; } catch {} }
    await sleep(30000);
  }
  throw Error('no slot');
}
async function launch() {
  const req = createRequire(path.join(root, 'package.json'));
  const { _electron } = req('playwright'); const electronExe = req('electron');
  const profile = path.join(PROFILES, 'pd-' + Date.now());
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

const pages = { one: ['YouTube', '#f6e3e3'], two: ['Stack Overflow', '#f8ecdc'], three: ['Google Translate', '#e1ecfb'], four: ['Wikipedia', '#e9eee3'], five: ['MDN', '#ece6f6'] };
const server = http.createServer((req, res) => { const k = req.url.slice(1) || 'one', [title, bg] = pages[k] || ['Page', '#fff']; res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(`<!doctype html><title>${title}</title><body style="margin:0;background:${bg};font:600 28px system-ui;color:#222;display:grid;place-items:center;height:100vh">${title}`); });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

let app, ui, lock, pointer = { x: 0, y: 0 };
const uiPage = async () => { for (let i = 0; i < 300; i++) { for (const p of app.context().pages()) { try { if (p.url() === 'acira-browser-ui://ui/index.html') return p; } catch {} } await sleep(100); } throw Error('ui page not found'); };
const act = a => ui.evaluate(a => window.acira.dispatch(a), a);
const state = () => ui.evaluate(() => window.acira.getSnapshot());
const split = async () => (await state()).windowUi.split;
const focusWin = () => app.evaluate(({ BaseWindow }) => { for (const w of BaseWindow.getAllWindows()) if (w.isVisible()) { w.show(); w.focus(); } });
const input = event => app.evaluate(({ webContents }, event) => { const w = webContents.getAllWebContents().find(x => x.getURL() === 'acira-browser-ui://ui/index.html'); w.sendInputEvent(event); }, event);
const mouse = (type, x, y) => input({ type, x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1, ...(type === 'mouseMove' ? { modifiers: ['leftButtonDown'] } : {}) });
const key = async k => { await input({ type: 'keyDown', keyCode: k }); await input({ type: 'keyUp', keyCode: k }); };
async function glide(x, y, steps = 12, wait = 16) { const from = pointer; for (let i = 1; i <= steps; i++) { await mouse('mouseMove', from.x + (x - from.x) * i / steps, from.y + (y - from.y) * i / steps); await sleep(wait); } pointer = { x, y }; }
const box = (sel, nth = 0) => ui.evaluate(([sel, nth]) => { const r = [...document.querySelectorAll(sel)].filter(e => !e.hasAttribute('data-motion-ghost'))[nth]?.getBoundingClientRect(); return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null; }, [sel, nth]);
const count = sel => ui.evaluate(sel => document.querySelectorAll(sel).length, sel);
const waitFor = async (fn, label, ms = 6000) => { const end = Date.now() + ms; let v; do { v = await fn(); if (v) return v; await sleep(60); } while (Date.now() < end); throw Error('timeout ' + label); };
const zoneInfo = () => ui.evaluate(() => { const z = document.querySelector('.split-pane-zone'); if (!z) return null; const r = z.getBoundingClientRect(), a = document.querySelector('.page-area').getBoundingClientRect(); return { kind: z.dataset.kind, label: z.textContent, x: r.x - a.x, y: r.y - a.y, w: r.width, h: r.height }; });
const cardInfo = () => ui.evaluate(() => { const c = document.querySelector('.split-picker-card'); if (!c) return null; const r = c.getBoundingClientRect(), a = document.querySelector('.page-area').getBoundingClientRect(); return { x: r.x - a.x, y: r.y - a.y, w: r.width, h: r.height, areaW: a.width, areaH: a.height, left: r.x, top: r.y, right: r.right, bottom: r.bottom }; });

async function shot(name) {
  await sleep(250);
  const b64 = await app.evaluate(async ({ BaseWindow, desktopCapturer }) => { const w = BaseWindow.getAllWindows()[0], [cw, ch] = w.getSize(); const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: cw, height: ch } }); const s = sources.find(x => x.id === w.getMediaSourceId()); return s ? s.thumbnail.toPNG().toString('base64') : ''; });
  if (b64) await fs.writeFile(path.join(OUT, name + '.png'), Buffer.from(b64, 'base64'));
  log('shot', name, b64 ? 'ok' : 'EMPTY');
}
async function strip(label, fire, frames = 40) {
  const dir = path.join(OUT, label); await fs.mkdir(dir, { recursive: true });
  const got = await app.evaluate(async ({ webContents }, [fire, frames]) => {
    const uiwc = webContents.getAllWebContents().find(w => w.getURL() === 'acira-browser-ui://ui/index.html');
    const t0 = Date.now(); new Function('uiwc', fire)(uiwc); const jobs = [];
    for (let i = 0; i < frames; i++) { const wait = t0 + i * 16.7 - Date.now(); if (wait > 0) await new Promise(r => setTimeout(r, wait)); const at = Date.now() - t0; jobs.push(uiwc.capturePage().then(img => ({ t: at, png: img.resize({ width: 640 }).toPNG().toString('base64') })).catch(() => ({ t: at, png: '' }))); }
    return Promise.all(jobs);
  }, [fire, frames]);
  for (const [i, f] of got.entries()) if (f.png) await fs.writeFile(path.join(dir, `f${String(i).padStart(2, '0')}-${f.t}ms.png`), Buffer.from(f.png, 'base64'));
  log('strip', label, got.length);
}
/** Press a strip tab that is not in the split and carry it over the page. */
async function pickUp(tabId, toX, toY) {
  const t = await box(`.browser-tab[data-tab-id="${tabId}"]`); if (!t) throw Error('no tab ' + tabId);
  const x = t.x + Math.min(40, t.w / 2), y = t.y + t.h / 2; pointer = { x, y };
  await mouse('mouseMove', x, y); await sleep(60); await mouse('mouseDown', x, y); await sleep(40);
  await glide(x + 12, y + 30, 3); await glide(toX, toY, 14);
}
const paneBox = i => box('.page-pane', i);
const edgeOf = (b, edge) => edge === 'left' ? { x: b.x + 14, y: b.y + b.h / 2 + 40 } : edge === 'right' ? { x: b.x + b.w - 14, y: b.y + b.h / 2 + 40 } : edge === 'top' ? { x: b.x + b.w / 2, y: b.y + 40 } : edge === 'bottom' ? { x: b.x + b.w / 2, y: b.y + b.h - 14 } : { x: b.x + b.w / 2, y: b.y + b.h / 2 + 90 };

async function scenario(theme) {
  log('--- drop on panes,', theme);
  await act({ type: 'settings.update', patch: { appearance: theme } }); await sleep(600);
  const s0 = await state(); const [a, b, c, d, e] = s0.tabs.slice(0, 5).map(t => t.id);
  await act({ type: 'tab.select', id: a }); await act({ type: 'split.open', tabIds: [a, b], layout: 'columns' });
  await waitFor(async () => (await count('.page-pane .split-label')) === 2, 'two ribbons'); await sleep(1000); await focusWin();
  // 1. Over the middle of the left pane: replace, a glass box over that pane.
  let left = await paneBox(0); let m = edgeOf(left, 'centre');
  await pickUp(c, m.x, m.y); await waitFor(async () => (await count('.split-pane-zone')) === 1, 'zone'); await sleep(450);
  let z = await zoneInfo(), area = await box('.page-area');
  check(z?.kind === 'replace' && Math.abs(z.x - (left.x - area.x)) <= 2 && Math.abs(z.w - left.w) <= 2 && Math.abs(z.h - left.h) <= 2, `${theme}: over the middle of a pane the zone is that pane, "replace" (${JSON.stringify(z)})`);
  check(z?.label === 'Replace this pane', `${theme}: it says what a release does`);
  let card = await cardInfo();
  check(card && Math.abs(card.x + card.w / 2 - card.areaW / 2) <= 2 && Math.abs(card.y + card.h / 2 - card.areaH / 2) <= 2, `${theme}: the island is centred over the page area (${JSON.stringify(card && { x: card.x, y: card.y, w: card.w, h: card.h, aw: card.areaW, ah: card.areaH })})`);
  await shot(`drop-${theme}-replace`);
  // 2. The right edge of the right pane: opens beside it, as the third column.
  let right = await paneBox(1); m = edgeOf(right, 'right'); await glide(m.x, m.y, 14); await sleep(500);
  z = await zoneInfo();
  check(z?.kind === 'insert' && z.label === 'Open on the right' && Math.abs(z.x - (area.w - 12) * 2 / 3 - 6) <= 8 && Math.abs(z.w - (area.w - 12) / 3) <= 3, `${theme}: the right edge shows the new third column (${JSON.stringify(z)})`);
  await shot(`drop-${theme}-insert-right`);
  // 3. Esc cancels: the zone goes and a release changes nothing.
  await key('Escape'); await sleep(500);
  check((await count('.split-pane-zone')) === 0 && (await count('.split-picker-card')) === 0, `${theme}: Esc clears the zone and the island`);
  await mouse('mouseUp', pointer.x, pointer.y); await sleep(900);
  let now = await split(); check(JSON.stringify(now.tabIds) === JSON.stringify([a, b]) && now.layout === 'columns', `${theme}: after Esc the split is as it was`);
  // 4. The pointer enters in the middle: the island steps off it.
  const t2 =await box(`.browser-tab[data-tab-id="${c}"]`); const center = await box('.page-area');
  pointer = { x: t2.x + 40, y: t2.y + t2.h / 2 }; await mouse('mouseMove', pointer.x, pointer.y); await sleep(60); await mouse('mouseDown', pointer.x, pointer.y); await sleep(40); await glide(pointer.x + 10, pointer.y + 30, 3);
  await glide(center.x + center.w / 2, center.y + center.h / 2 - 20, 1, 0); await waitFor(async () => (await count('.split-picker-card')) === 1, 'island at the middle'); await sleep(500);
  card = await cardInfo(); const px = pointer.x, py = pointer.y;
  check(card && !(px >= card.left - 30 && px <= card.right + 30 && py >= card.top - 30 && py <= card.bottom + 30), `${theme}: the pointer arrived in the middle and the card is clear of it (card ${card && Math.round(card.top)}..${card && Math.round(card.bottom)}, pointer y ${Math.round(py)})`);
  await shot(`drop-${theme}-island-dodges`);
  await key('Escape'); await sleep(400); await mouse('mouseUp', pointer.x, pointer.y); await sleep(800);
  // 5. Release on the right edge: three columns, the tab in the third.
  await pickUp(c, 700, 500); right = await paneBox(1); m = edgeOf(right, 'right'); await glide(m.x, m.y, 12); await waitFor(async () => (await zoneInfo())?.label === 'Open on the right', 'zone right'); await sleep(250);
  await strip(`drop-${theme}-insert`, `uiwc.sendInputEvent({type:'mouseUp',x:${Math.round(pointer.x)},y:${Math.round(pointer.y)},button:'left',clickCount:1});`);
  await sleep(700); now = await split();
  check(now?.layout === 'three-columns' && JSON.stringify(now.tabIds) === JSON.stringify([a, b, c]), `${theme}: released on the right edge: ${now?.layout} [${(now?.tabIds || []).map(x => x === a ? 'a' : x === b ? 'b' : x === c ? 'c' : '?')}]`);
  await sleep(900); await shot(`drop-${theme}-after-insert`);
  // 6. The middle of the middle pane: replace; the replaced tab stays open.
  await pickUp(d, 800, 500); let mid = await paneBox(1); m = edgeOf(mid, 'centre'); await glide(m.x, m.y, 12); await waitFor(async () => (await zoneInfo())?.kind === 'replace', 'zone replace'); await sleep(250);
  await strip(`drop-${theme}-replace-release`, `uiwc.sendInputEvent({type:'mouseUp',x:${Math.round(pointer.x)},y:${Math.round(pointer.y)},button:'left',clickCount:1});`);
  await sleep(700); now = await split(); const st = await state();
  check(JSON.stringify(now?.tabIds) === JSON.stringify([a, d, c]) && now.layout === 'three-columns' && st.tabs.some(t => t.id === b), `${theme}: released on the middle of a pane: it is replaced and its tab (${b === a ? '' : 'b'}) is still open`);
  await sleep(900); await shot(`drop-${theme}-after-replace`);
  // 7. Four panes: add b on the right edge of the third column, then only replace is offered.
  await pickUp(b, 900, 500); let third = await paneBox(2); m = edgeOf(third, 'right'); await glide(m.x, m.y, 12); await waitFor(async () => (await zoneInfo())?.label === 'Open on the right', 'zone four'); await sleep(250);
  await mouse('mouseUp', pointer.x, pointer.y); await sleep(1500); now = await split();
  check(now?.layout === 'four-columns' && now.tabIds.length === 4, `${theme}: a fourth pane opens as four columns`);
  await pickUp(e, 900, 500); const last = await paneBox(3); m = edgeOf(last, 'right'); await glide(m.x, m.y, 12); await waitFor(async () => (await count('.split-pane-zone')) === 1, 'zone full'); await sleep(450);
  z = await zoneInfo(); const lastRel = { x: last.x - area.x, w: last.w };
  check(z?.kind === 'replace' && z.label === 'Replace this pane' && Math.abs(z.w - lastRel.w) <= 2, `${theme}: with four panes an edge offers only replace (${JSON.stringify(z)})`);
  await shot(`drop-${theme}-four-replace-only`);
  await key('Escape'); await sleep(400); await mouse('mouseUp', pointer.x, pointer.y); await sleep(900);
  await act({ type: 'split.remove', tabId: b }); await sleep(700); await act({ type: 'split.remove', tabId: c }); await sleep(900);
  await act({ type: 'split.layout', layout: 'columns' }); await sleep(700);
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
  for (const n of ['two', 'three', 'four', 'five']) await act({ type: 'tab.new', url: base + n, background: true });
  await waitFor(async () => (await state()).tabs.length === 5, 'five tabs'); await sleep(3000);
  for (const theme of (process.env.THEMES || 'dark').split(',')) await scenario(theme);
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
