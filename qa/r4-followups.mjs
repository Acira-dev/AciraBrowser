// Round 4 follow-ups real-app QA (real input through sendInputEvent, dark 100%):
//   B. a pane dragged by its ribbon uses the same in-place drop zones as a tab drag (middle = swap, edge = move beside), Esc cancels;
//   A. workspaces: tab search across workspaces (command bar, tab viewer), Ctrl+Alt+PageDown/PageUp, a second window never opens an empty twin,
//      a private window says once that it has no workspaces.
//   node qa/r4-followups.mjs [tag]     (cwd = worktree root; one native slot, one Electron app, closed in finally; ≤ 6 tabs; bounded waits)
// Evidence: C:/ae/r4/followups/evidence/<tag>/
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const root = process.cwd(), tag = process.argv[2] || 'run';
const OUT = path.join('C:/ae/r4/followups/evidence', tag); await fs.mkdir(OUT, { recursive: true });
const PROFILES = 'C:/ae/r4/followups/profiles';
const results = [];
const log = (...a) => console.log('[qa]', ...a);
const check = (ok, label) => { results.push({ ok: !!ok, label }); log(ok ? 'PASS' : 'FAIL', label); };

async function slot() {
  for (let i = 0; i < 40; i++) {
    for (const n of [1, 2, 3]) { const f = `C:/ae/slot-${n}.lock`; try { const h = await fs.open(f, 'wx'); await h.write(`followups ${new Date().toISOString()}`); await h.close(); return f; } catch {} }
    await sleep(30000);
  }
  throw Error('no slot');
}
async function launch() {
  const req = createRequire(path.join(root, 'package.json'));
  const { _electron } = req('playwright'); const electronExe = req('electron');
  const profile = path.join(PROFILES, 'fu-' + Date.now());
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

const pages = { one: ['YouTube', '#f6e3e3'], two: ['Stack Overflow', '#f8ecdc'], three: ['Google Translate', '#e1ecfb'], four: ['Wikipedia', '#e9eee3'], five: ['MDN Web Docs', '#ece6f6'] };
const server = http.createServer((req, res) => { const k = req.url.slice(1) || 'one', [title, bg] = pages[k] || ['Page', '#fff']; res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(`<!doctype html><title>${title}</title><body style="margin:0;background:${bg};font:600 28px system-ui;color:#222;display:grid;place-items:center;height:100vh">${title}`); });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

const UI = 'acira-browser-ui://ui/index.html';
let app, ui, lock, pointer = { x: 0, y: 0 };
const uiPages = () => app.context().pages().filter(p => { try { return p.url() === UI; } catch { return false; } });
const idOf = p => p.evaluate(() => window.acira.getSnapshot().then(s => s.windowId)).catch(() => null);
const uiPage = async () => { for (let i = 0; i < 300; i++) { const p = uiPages()[0]; if (p) return p; await sleep(100); } throw Error('ui page not found'); };
const overlayPage = () => app.context().pages().find(p => { try { return p.url().includes('view=overlay'); } catch { return false; } });
const act = (a, p = ui) => p.evaluate(a => window.acira.dispatch(a), a);
const state = (p = ui) => p.evaluate(() => window.acira.getSnapshot());
const split = async () => (await state()).windowUi.split;
const focusWin = () => app.evaluate(({ BaseWindow }) => { for (const w of BaseWindow.getAllWindows()) if (w.isVisible()) { w.show(); w.focus(); } });
/** Send an input event to the UI view of the window whose id is `windowId` (the first window when omitted). */
const input = (event, windowId) => app.evaluate(async ({ webContents }, [event, windowId]) => {
  const all = webContents.getAllWebContents().filter(x => x.getURL() === 'acira-browser-ui://ui/index.html');
  let target = all[0];
  if (windowId) for (const w of all) { const id = await w.executeJavaScript('window.acira.getSnapshot().then(s => s.windowId)').catch(() => null); if (id === windowId) { target = w; break; } }
  target.sendInputEvent(event);
}, [event, windowId]);
const mouse = (type, x, y) => input({ type, x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1, ...(type === 'mouseMove' ? { modifiers: ['leftButtonDown'] } : {}) });
const key = async (k, modifiers = [], windowId) => { await input({ type: 'keyDown', keyCode: k, modifiers }, windowId); await input({ type: 'keyUp', keyCode: k, modifiers }, windowId); };
async function glide(x, y, steps = 12, wait = 16) { const from = pointer; for (let i = 1; i <= steps; i++) { await mouse('mouseMove', from.x + (x - from.x) * i / steps, from.y + (y - from.y) * i / steps); await sleep(wait); } pointer = { x, y }; }
const box = (sel, nth = 0) => ui.evaluate(([sel, nth]) => { const r = [...document.querySelectorAll(sel)].filter(e => !e.hasAttribute('data-motion-ghost'))[nth]?.getBoundingClientRect(); return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null; }, [sel, nth]);
const count = sel => ui.evaluate(sel => document.querySelectorAll(sel).length, sel);
const waitFor = async (fn, label, ms = 6000) => { const end = Date.now() + ms; let v; do { v = await fn(); if (v) return v; await sleep(60); } while (Date.now() < end); throw Error('timeout ' + label); };
const zoneInfo = () => ui.evaluate(() => { const z = document.querySelector('.split-pane-zone'); if (!z) return null; const r = z.getBoundingClientRect(), a = document.querySelector('.page-area').getBoundingClientRect(); return { kind: z.dataset.kind, label: z.textContent, x: r.x - a.x, y: r.y - a.y, w: r.width, h: r.height }; });
async function shot(name) {
  await sleep(300);
  const b64 = await app.evaluate(async ({ BaseWindow, desktopCapturer }) => { const w = BaseWindow.getAllWindows().find(x => x.isVisible()) || BaseWindow.getAllWindows()[0], [cw, ch] = w.getSize(); const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: cw, height: ch } }); const s = sources.find(x => x.id === w.getMediaSourceId()); return s ? s.thumbnail.toPNG().toString('base64') : ''; });
  if (b64) await fs.writeFile(path.join(OUT, name + '.png'), Buffer.from(b64, 'base64'));
  log('shot', name, b64 ? 'ok' : 'EMPTY');
}

/** Press the ribbon of pane `nth` and carry it to (toX, toY). */
async function pickUpPane(nth, toX, toY) {
  const r = await box('.page-pane .split-label', nth); if (!r) throw Error('no ribbon ' + nth);
  const x = r.x + 60, y = r.y + r.h / 2; pointer = { x, y };
  await mouse('mouseMove', x, y); await sleep(60); await mouse('mouseDown', x, y); await sleep(40);
  await glide(x + 8, y + 30, 3); await glide(toX, toY, 14);
}
const idsShort = (ids, names) => (ids || []).map(id => names[id] || '?').join('');
const spot = (b, where) => where === 'top' ? { x: b.x + b.w / 2, y: b.y + 40 } : where === 'bottom' ? { x: b.x + b.w / 2, y: b.y + b.h - 14 } : where === 'left' ? { x: b.x + 14, y: b.y + b.h * .3 } : where === 'right' ? { x: b.x + b.w - 14, y: b.y + b.h * .3 } : { x: b.x + b.w / 2, y: b.y + b.h / 2 + 90 };

async function paneDragScenario() {
  log('--- B. pane ribbon drag uses the tab drop zones');
  const s0 = await state(); const [a, b, c] = s0.tabs.slice(0, 3).map(t => t.id); const names = { [a]: 'a', [b]: 'b', [c]: 'c' };
  await act({ type: 'tab.select', id: a }); await act({ type: 'split.open', tabIds: [a, b, c], layout: 'three-columns' });
  await waitFor(async () => (await count('.page-pane .split-label')) === 3, 'three ribbons'); await sleep(1200); await focusWin();
  const area = await box('.page-area');
  // 1. Pane C (third ribbon) over the top edge of pane A: "Move above", the box is the top-left cell.
  let pa = await box('.page-pane', 0), m = spot(pa, 'top');
  await pickUpPane(2, m.x, m.y); await waitFor(async () => (await count('.split-pane-zone')) === 1, 'move zone'); await sleep(500);
  let z = await zoneInfo();
  check(z?.kind === 'move' && z.label === 'Move above' && Math.abs(z.x) <= 14 && z.w > (area.w / 2 - 20) && z.w < (area.w / 2) && z.h < area.h * .55, `pane over the top edge of another: in-place zone "${z?.label}" kind ${z?.kind} ${JSON.stringify(z && { x: Math.round(z.x), y: Math.round(z.y), w: Math.round(z.w), h: Math.round(z.h) })}`);
  await shot('b-edge-top-move-zone');
  // 2. Esc calls the drag off: no zone, release changes nothing.
  await key('Escape'); await sleep(500);
  check((await count('.split-pane-zone')) === 0 && (await count('.split-drag-layer')) === 0, 'Esc clears the zones');
  await mouse('mouseUp', pointer.x, pointer.y); await sleep(900);
  let now = await split(); check(now.layout === 'three-columns' && idsShort(now.tabIds, names) === 'abc', `after Esc the split is as it was (${now.layout} ${idsShort(now.tabIds, names)})`);
  // 3. The same drag, released: the layout with that shape, C top-left, A under it, B on the right.
  pa = await box('.page-pane', 0); m = spot(pa, 'top'); await pickUpPane(2, m.x, m.y); await waitFor(async () => (await zoneInfo())?.kind === 'move', 'zone again'); await sleep(300);
  await mouse('mouseUp', pointer.x, pointer.y); await sleep(1400); now = await split();
  check(now.layout === 'left-two-right-one' && idsShort(now.tabIds, names) === 'cab', `released on the top edge: ${now.layout} ${idsShort(now.tabIds, names)}`);
  await shot('b-after-move');
  // 4. Panes are now C (top left), A (bottom left), B (right). B over the middle of C: the two swap places.
  const pc = await box('.page-pane', 0); m = spot(pc, 'centre');
  const nthB = (await ui.evaluate(() => [...document.querySelectorAll('.page-pane')].map(n => n.dataset.pane))).indexOf(b);
  await pickUpPane(nthB, m.x, m.y); await waitFor(async () => (await count('.split-drag-zone[data-over]')) === 1, 'swap highlight'); await sleep(300);
  check((await count('.split-pane-zone')) === 0, 'over the middle of a pane: the swap highlight, no edge zone');
  await shot('b-middle-swap-zone');
  await mouse('mouseUp', pointer.x, pointer.y); await sleep(1400); now = await split();
  check(idsShort(now.tabIds, names) === 'bac' || idsShort(now.tabIds, names) === 'bca' || now.tabIds[0] === b, `released on the middle: B and C swapped places (${idsShort(now.tabIds, names)})`);
  await act({ type: 'split.close' }); await sleep(700);
}

const workspaceTabs = (s, id) => s.tabs.filter(t => (t.workspaceId || s.workspaces[0].id) === id);
async function workspaceScenario() {
  log('--- A. workspaces');
  let s = await state(); const tabsA = s.tabs.slice(0, 5);
  // Main keeps YouTube + Stack Overflow; Work gets MDN (a page), Wikipedia stays in Main.
  await act({ type: 'workspace.create', name: 'Work' }); await sleep(700);
  await act({ type: 'tab.new', url: base + 'five' }); await sleep(1500);
  s = await state(); const main = s.workspaces[0].id, work = s.workspaces[1].id;
  check(s.activeWorkspaceId === work && s.tabs.some(t => t.url.endsWith('/five') && t.workspaceId === work), 'Work holds the MDN page');
  // 1. Command bar (Ctrl+Shift+K): "stack" finds the Stack Overflow tab that lives in Main, in a section named for Main.
  await key('K', ['control', 'shift']); let o = await waitFor(() => overlayPage(), 'palette overlay', 6000);
  await waitFor(async () => (await o.locator('.popup-search input').count()) === 1, 'palette input'); await o.locator('.popup-search input').fill('stack'); await sleep(700);
  const sections = await o.locator('.palette-section').allInnerTexts(); const rows = await o.locator('.palette-row .palette-title').allInnerTexts();
  check(sections.includes('In Main') && rows.some(r => /Stack Overflow/.test(r)), `command bar: sections ${JSON.stringify(sections)}, rows ${JSON.stringify(rows)}`);
  await shot('a-command-bar-other-workspace');
  await o.keyboard.press('Enter'); await sleep(1500);
  s = await state(); check(s.activeWorkspaceId === main && s.tabs.find(t => t.id === s.activeTabId)?.url.endsWith('/two'), `choosing it switches to Main and opens the tab (${s.workspaces.find(w => w.id === s.activeWorkspaceId)?.name || 'Main'})`);
  await shot('a-after-pick-from-command-bar');
  // 2. Tab viewer (Alt+T): "mdn" finds the page in Work.
  await key('T', ['alt']); o = await waitFor(() => overlayPage(), 'tab viewer overlay', 6000);
  await waitFor(async () => (await o.locator('.popup-search input').count()) === 1, 'viewer input'); await o.locator('.popup-search input').fill('mdn'); await sleep(700);
  const heads = await o.locator('.tab-result-group-head').allInnerTexts();
  check(heads.includes('In Work') && (await o.locator('.tab-result-group .tab-result').count()) === 1, `tab viewer: groups ${JSON.stringify(heads)}`);
  await shot('a-tab-viewer-other-workspace');
  await o.locator('.tab-result-group .tab-result').first().click(); await sleep(1500);
  s = await state(); check(s.activeWorkspaceId === work && s.tabs.find(t => t.id === s.activeTabId)?.url.endsWith('/five'), 'choosing it in the viewer switches to Work');
  // 3. Next / previous workspace from the keyboard (Ctrl+Alt+PageDown / PageUp), wrapping.
  await act({ type: 'workspace.create', name: 'Study' }); await sleep(900); s = await state(); const study = s.workspaces[2].id;
  await focusWin();
  await key('PageUp', ['control', 'alt']); await sleep(900); s = await state(); check(s.activeWorkspaceId === work, 'Ctrl+Alt+PageUp: Study → Work');
  await key('PageDown', ['control', 'alt']); await sleep(900); s = await state(); check(s.activeWorkspaceId === study, 'Ctrl+Alt+PageDown: Work → Study');
  await key('PageDown', ['control', 'alt']); await sleep(900); s = await state(); check(s.activeWorkspaceId === main, 'Ctrl+Alt+PageDown wraps: Study → Main');
  await key('PageUp', ['control', 'alt']); await sleep(900); s = await state(); check(s.activeWorkspaceId === study, 'Ctrl+Alt+PageUp wraps: Main → Study');
  // Tooltip on the sidebar title line shows the keys.
  const tip = await ui.evaluate(() => document.querySelector('.sb-ws-title-main')?.getAttribute('title') || document.querySelector('.ws-chip')?.getAttribute('title') || '');
  check(/Next workspace · Ctrl\s*\+?\s*Alt\s*\+?\s*PgDn/i.test(tip) && /Previous workspace/.test(tip), `tooltip shows the keys: ${JSON.stringify(tip)}`);
  await act({ type: 'workspace.select', id: main }); await sleep(900);
  await shot('a-sidebar-three-workspaces');
  // Shortcuts are in the registry (Settings › Shortcuts lists and edits them).
  const listed = await ui.evaluate(() => window.acira.native?.({ type: 'shortcuts.list' }).then(r => r.shortcuts.commands.filter(c => /workspace/.test(c.id)).map(c => [c.id, c.display?.[0]])).catch(() => null)).catch(() => null);
  log('registry', JSON.stringify(listed));
  check(Array.isArray(listed) && listed.some(([id, d]) => id === 'next-workspace' && /PageDown|PgDn/.test(d || '')) && listed.some(([id]) => id === 'prev-workspace'), 'the registry lists both commands with their keys');
}

async function windowsScenario() {
  log('--- A. second window and private window');
  let s = await state(); const main = s.workspaces[0].id, work = s.workspaces[1].id, id1 = s.windowId;
  await act({ type: 'workspace.select', id: main }); await sleep(800);
  // Window 1 shows Main and holds MDN in Work. Open window 2 (Ctrl+N).
  await key('N', ['control']); const p2 = await waitFor(async () => { for (const p of uiPages()) { const id = await idOf(p); if (id && id !== id1) return p; } return null; }, 'second window', 15000);
  const id2 = await idOf(p2); await sleep(2500);
  let s2 = await state(p2);
  check(s2.workspaceWindows?.[work] === 1, `window 2's switcher marks Work as living in window 1 (${JSON.stringify(s2.workspaceWindows)})`);
  const before2 = s2.tabs.length;
  const t0 = Date.now(); await act({ type: 'workspace.select', id: work }, p2);
  await waitFor(async () => (await state()).activeWorkspaceId === work, 'window 1 switches', 8000).catch(() => {}); log('window 1 switched after', Date.now() - t0, 'ms', JSON.stringify((globalThis.__noise || []).slice(-8))); await sleep(800);
  s = await state(); s2 = await state(p2);
  log('after choosing: window 1 workspace', s.workspaces.find(w => w.id === s.activeWorkspaceId)?.name || 'Main', 'window 2 workspace', s2.workspaces.find(w => w.id === s2.activeWorkspaceId)?.name || 'Main');
  check(s.activeWorkspaceId === work, 'choosing Work in window 2 switched window 1 to Work');
  check(s2.tabs.length === before2 && !s2.tabs.some(t => t.workspaceId === work) && s2.activeWorkspaceId !== work, `window 2 did not open an empty Work (tabs ${before2} → ${s2.tabs.length}, workspace stays ${s2.activeWorkspaceId === main ? 'Main' : s2.activeWorkspaceId})`);
  await shot('a-two-windows-after-choosing-work');
  // Close window 2 through its own state (a normal close).
  await act({ type: 'tab.close', id: s2.activeTabId }, p2).catch(() => {}); await sleep(800);
  // Private window (Ctrl+Shift+N) → Alt+2 says once that private windows have no workspaces.
  const known = new Set([id1, id2]);
  await focusWin(); await key('N', ['control', 'shift'], id1);
  const p3 = await waitFor(async () => { for (const p of uiPages()) { const id = await idOf(p); if (id && !known.has(id)) return p; } return null; }, 'private window', 15000);
  const id3 = await idOf(p3); await sleep(2500);
  let s3 = await state(p3);
  await key('2', ['alt'], id3); await sleep(900); s3 = await state(p3);
  const first = s3.toast;
  check(first?.text === "Private windows don't use workspaces." && first.tone === 'info', `private window: Alt+2 says "${first?.text}"`);
  const png = await app.evaluate(async ({ webContents }, id) => { for (const w of webContents.getAllWebContents().filter(x => x.getURL() === 'acira-browser-ui://ui/index.html')) { const wid = await w.executeJavaScript('window.acira.getSnapshot().then(s => s.windowId)').catch(() => null); if (wid === id) return (await w.capturePage()).toPNG().toString('base64'); } return ''; }, id3);
  if (png) await fs.writeFile(path.join(OUT, 'a-private-window-note.png'), Buffer.from(png, 'base64'));
  await sleep(300); await key('3', ['alt'], id3); await sleep(600); s3 = await state(p3);
  check(s3.toast?.id === first?.id && s3.toast?.at === first?.at, 'pressing it again does not repeat the note (once per window)');
  await key('PageDown', ['control', 'alt'], id3); await sleep(500); s3 = await state(p3);
  check(s3.toast?.id === first?.id, 'the next/previous keys stay quiet too after the first note');
}

try {
  lock = await slot(); log('slot', lock);
  app = await launch();
  const noise = []; for (const stream of [app.process().stdout, app.process().stderr]) stream?.on('data', d => { for (const line of String(d).split('\n')) if (/error|exception|undefined|not defined|DBG/i.test(line) && !/GPU|gpu|DevTools|autofill|dbus/i.test(line)) noise.push(line.slice(0, 300)); });
  globalThis.__noise = noise;
  ui = await uiPage(); await ui.waitForLoadState('domcontentloaded');
  await app.evaluate(({ BaseWindow }) => { for (const w of BaseWindow.getAllWindows()) if (w.isVisible()) { w.setContentSize(1500, 900); w.setPosition(40, 20); } });
  await focusWin();
  const skip = ui.getByRole('button', { name: 'Skip setup' }); await skip.first().waitFor({ timeout: 20000 }).catch(() => {}); if (await skip.count()) await skip.first().click({ timeout: 5000 }).catch(() => {});
  await sleep(1800); ui = await uiPage();
  const done = ui.getByRole('button', { name: /^Done$/ }); if (await done.count()) { await done.first().click().catch(() => {}); await sleep(700); }
  await focusWin();
  await act({ type: 'settings.update', patch: { appearance: 'dark', verticalTabs: true, interfaceScale: 100 } }); await sleep(1000);
  const first = (await state()).activeTabId; await act({ type: 'tab.navigate', tabId: first, url: base + 'one' });
  for (const n of ['two', 'three']) await act({ type: 'tab.new', url: base + n, background: true });
  await waitFor(async () => (await state()).tabs.length === 3, 'three tabs'); await sleep(1500);
  // Background tabs load when first shown: visit each so they all have their titles (the search matches titles).
  for (const tab of (await state()).tabs) { await act({ type: 'tab.select', id: tab.id }); await sleep(1300); }
  await act({ type: 'tab.select', id: first }); await sleep(800);
  await waitFor(async () => (await state()).tabs.every(t => !/^http/.test(t.title || 'x')), 'titles loaded', 8000).catch(() => {});
  const only = process.env.ONLY || 'all';
  if (only === 'all' || only === 'b') await paneDragScenario();
  if (only === 'w') { await act({ type: 'workspace.create', name: 'Work' }); await sleep(700); await act({ type: 'tab.new', url: base + 'five' }); await sleep(1500); await act({ type: 'workspace.create', name: 'Study' }); await sleep(700); await windowsScenario(); }
  if (only === 'all' || only === 'a') { await workspaceScenario(); await windowsScenario(); }
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
