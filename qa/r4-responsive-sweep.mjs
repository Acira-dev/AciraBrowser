// R4-39 responsive sweep: drives the real app through window sizes x display scale x interface scale x tab layout x window view
// (pairwise, not the full product) and runs DOM + native-view geometry checks on every surface.
//   node qa/r4-responsive-sweep.mjs [--display 100|125|150|all] [--tag name] [--rows N] [--from N] [--only main,popups,pages,toast,setup]
//                                   [--plan] [--budget 150] [--theme dark|light|mix] [--out C:/ae/r4/responsive]
// cwd = worktree root. One Electron per display scale (--force-device-scale-factor), one native slot (C:/ae/slot-N.lock) held only for
// that launch, closed in finally; <= 8 tabs; every loop is capped. Needs a visible window (the machine's screen shows it briefly).
// Output (--out/evidence/<tag>/): states.json (every state), summary.json (findings grouped by signature + smallest repro),
// <display>-<n>-<surface>-....json + .png for each failing state, ref/*.png one reference screenshot per surface and display.
// Scanners: qa/r4-responsive-scan.js (overlap, off-screen, caption, toolbar fit, scrollbars, ellipsis, under-page),
// qa/m-edge-scan.js (text within 8px of a box edge), qa/m-clip-scan.js (clipped text).
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { MIN, SIZES, SCALES, TABS, VIEWS, POPUPS, PAGES, clampSizes, planFor as planForTheme } from './r4-responsive-plan.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const argv = process.argv.slice(2), flag = (n, d) => { const i = argv.indexOf('--' + n); return i < 0 ? d : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true); };
const root = process.cwd(), OUTROOT = flag('out', 'C:/ae/r4/responsive'), TAG = flag('tag', 'run');
const OUT = path.join(OUTROOT, 'evidence', TAG), PROFILES = path.join(OUTROOT, 'profiles');
const only = String(flag('only', 'main,popups,pages,toast,setup')).split(','), wants = k => only.includes(k);
const BUDGET = Number(flag('budget', 150)), MAXROWS = Number(flag('rows', 9999)), FROM = Number(flag('from', 0));
const displays = String(flag('display', 'all')) === 'all' ? [100, 125, 150] : String(flag('display')).split(',').map(Number);
const THEME = String(flag('theme', 'mix'));
const log = (...a) => console.log('[r4]', ...a);

// ---- plan (qa/r4-responsive-plan.mjs; tests/r4-responsive-plan.test.mjs proves its coverage) ---------------------------------
// --where scale=150,tabs=sidebar,view=seamless,w=900 re-runs only the planned rows that match (to verify a fix quickly)
const WHERE = String(flag('where', '')).split(',').filter(Boolean).map(p => p.split('='));
const matches = r => WHERE.every(([k, v]) => String(k === 'w' ? r.size[1] : k === 'h' ? r.size[2] : r[k]) === v);
const planFor = display => planForTheme(display, THEME).filter(matches);
if (flag('plan', false)) { let total = 0; for (const d of displays) { const p = planFor(d); total += p.length; console.log(`display ${d}%: ${p.length} rows`); for (const r of p) console.log('  ', r.n, r.size[0], r.size[1] + 'x' + r.size[2], r.scale + '%', r.tabs, r.view, r.theme, r.popup, r.page, r.toast ? 'toast' : ''); } console.log('total rows', total); process.exit(0); }

// ---- native slot + launch (same shape as qa/r4-split-arrange.mjs) -------------------------------------------------------
async function slot() {
  // Poll every 10-30s (jittered so this never runs in lock-step with the other agents' 30s polls); give up after ~20 minutes.
  const until = Date.now() + 20 * 60 * 1000;
  while (Date.now() < until) { for (const n of [1, 2, 3]) { const f = `C:/ae/slot-${n}.lock`; try { const h = await fs.open(f, 'wx'); await h.write(`r4-responsive ${new Date().toISOString()}`); await h.close(); return f; } catch {} } await sleep(10000 + Math.random() * 20000); }
  throw Error('no native slot within 20 minutes');
}
async function launch(display) {
  const req = createRequire(path.join(root, 'package.json')), { _electron } = req('playwright'), electronExe = req('electron');
  const profile = path.join(PROFILES, `rs-${display}-${Date.now()}`), roaming = path.join(profile, 'fixture-roaming'), local = path.join(profile, 'fixture-local');
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
  // D_APP_EXE=<AciraBrowser.exe> runs the sweep against an installed/packaged build (its app is inside the exe's resources, so no main path is passed).
  const packaged = process.env.D_APP_EXE ? path.resolve(process.env.D_APP_EXE) : null;
  return _electron.launch({ executablePath: packaged || electronExe, cwd: root, timeout: 40000, env, args: ['--force-device-scale-factor=' + (display / 100), ...(packaged ? [] : [path.join(root, 'desktop/main.cjs')]), '--disable-features=CalculateNativeWinOcclusion', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
}

// ---- fixtures -----------------------------------------------------------------------------------------------------------
const longTitle = 'Northwind Research Group - Client Accounts and Quarterly Reviews';
const titles = { one: longTitle, two: 'Docs', three: 'A very long page title that has to be shortened by the tab', four: 'Mail', five: 'Maps' };
const server = http.createServer((req, res) => { const k = req.url.slice(1) || 'one'; res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(`<!doctype html><title>${titles[k] || k}</title><body style="margin:0;background:#e8edf3;font:600 22px system-ui;color:#223;display:grid;place-items:center;height:100vh">${titles[k] || k}`); });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

// ---- scanners ------------------------------------------------------------------------------------------------------------
const [edgeSrc, clipSrc, scanSrc] = await Promise.all(['m-edge-scan.js', 'm-clip-scan.js', 'r4-responsive-scan.js'].map(f => fs.readFile(path.join(root, 'qa', f), 'utf8')));
const CHROME = 'acira-browser-ui://ui/index.html';
// The pages run under a strict CSP (no eval): the three scanner sources are inlined into the executed script, never eval'd.

let app, lock;
const evalIn = (match, code, exact = false) => app.evaluate(async ({ webContents }, [match, code, exact]) => {
  const wc = webContents.getAllWebContents().find(w => { try { const u = w.getURL(); return !w.isDestroyed() && (exact ? u === match : u.includes(match)); } catch { return false; } });
  if (!wc) return { __missing: true };
  try { return await wc.executeJavaScript(code, true); } catch (e) { return { __error: String(e).slice(0, 300) }; }
}, [match, code, exact]);
const chrome = code => evalIn(CHROME, code, true);
const overlay = code => evalIn('view=overlay', code);
const act = a => chrome(`window.acira.dispatch(${JSON.stringify(a)})`);
const state = () => chrome('window.acira.getSnapshot()');
const winInfo = () => app.evaluate(({ BaseWindow, screen, webContents }) => {
  const win = BaseWindow.getAllWindows().find(w => w.isVisible()) || BaseWindow.getAllWindows()[0]; if (!win) return null;
  const c = win.getContentBounds(), b = win.getBounds(), d = screen.getDisplayMatching(b);
  const views = win.contentView.children.map((v, i) => { let url = '', vis = true; try { url = v.webContents.getURL(); } catch {} try { vis = v.getVisible(); } catch {} const bb = v.getBounds(); return { i, url: url.slice(0, 70), x: bb.x, y: bb.y, w: bb.width, h: bb.height, visible: vis }; });
  const wc = webContents.getAllWebContents().find(w => { try { return w.getURL() === 'acira-browser-ui://ui/index.html'; } catch { return false; } });
  return { content: [c.width, c.height], bounds: [b.x, b.y, b.width, b.height], maximized: win.isMaximized(), display: { size: [d.size.width, d.size.height], work: [d.workArea.width, d.workArea.height], scale: d.scaleFactor }, views, zoom: wc ? wc.getZoomFactor() : 1 };
});
const focusWin = () => app.evaluate(({ BaseWindow }) => { for (const w of BaseWindow.getAllWindows()) if (w.isVisible()) { w.setAlwaysOnTop(true, 'screen-saver'); w.show(); w.moveTop(); w.focus(); } });
const setSize = async (w, h, maximize = false) => { await app.evaluate(({ BaseWindow }, [w, h, maximize]) => { for (const win of BaseWindow.getAllWindows()) if (win.isVisible()) { if (win.isMaximized()) win.unmaximize(); if (maximize) win.maximize(); else { win.setContentSize(w, h); win.setPosition(0, 0); } } }, [w, h, maximize]); };

async function settle(scale) {
  for (let i = 0; i < 30; i++) {
    const info = await winInfo(), css = await chrome('[innerWidth, innerHeight]');
    if (Array.isArray(css) && info && Math.abs(css[0] * info.zoom - info.content[0]) <= 2.5 && Math.abs(info.zoom - scale / 100) < 0.011) break;
    await sleep(70);
  }
  await sleep(420);
}
async function shot(file) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await focusWin(); await sleep(150 + attempt * 250);
    const b64 = await app.evaluate(async ({ BaseWindow, desktopCapturer, screen }) => {
      const win = BaseWindow.getAllWindows().filter(w => w.isVisible() && !w.isMinimized()).sort((a, b) => b.getBounds().width * b.getBounds().height - a.getBounds().width * a.getBounds().height)[0]; if (!win) return '';
      const b = win.getBounds(), s = screen.getDisplayMatching(b).scaleFactor, k = Math.min(1, 2200 / (b.width * s));
      const src = (await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: Math.round(b.width * s * k), height: Math.round(b.height * s * k) } })).find(x => x.id === win.getMediaSourceId());
      return src && !src.thumbnail.isEmpty() ? src.thumbnail.toPNG().toString('base64') : '';
    });
    if (b64) { await fs.writeFile(file, Buffer.from(b64, 'base64')); return true; }
  }
  return false;
}

// ---- measuring ------------------------------------------------------------------------------------------------------------
const rectIn = (a, b) => a.x >= b.x - 1 && a.y >= b.y - 1 && a.x + a.w <= b.x + b.w + 1 && a.y + a.h <= b.y + b.h + 1;
const inter = (a, b) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
const interY = (a, b) => Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
function nativeFindings(info, surface) {
  const f = [], W = info.content[0], H = info.content[1], win = { x: 0, y: 0, w: W, h: H };
  const vis = info.views.filter(v => v.visible && v.w > 0 && v.h > 0), pages = vis.filter(v => /^https?:/.test(v.url));
  for (const v of vis) if (!rectIn(v, win)) f.push({ cat: v.url.includes('view=overlay') ? 'popupOutside' : 'viewOutside', sev: 'error', sig: (v.url.includes('view=overlay') ? 'popupOutside:' : 'viewOutside:') + surface + ':' + v.url.slice(0, 40), text: `${v.url.slice(0, 50)} at ${v.x},${v.y} ${v.w}x${v.h} leaves the ${W}x${H} window`, native: [v.x, v.y, v.w, v.h] });
  for (let i = 0; i < pages.length; i++) for (let j = i + 1; j < pages.length; j++) if (inter(pages[i], pages[j]) > 2 && interY(pages[i], pages[j]) > 2) f.push({ cat: 'paneOverlap', sev: 'error', sig: 'paneOverlap:split', text: `page views ${i} and ${j} overlap by ${Math.round(inter(pages[i], pages[j]))}x${Math.round(interY(pages[i], pages[j]))} DIP`, native: [pages[i].x, pages[i].y, pages[i].w, pages[i].h, pages[j].x, pages[j].y, pages[j].w, pages[j].h] });
  return f;
}
async function scanView(match, info, surface, exact) {
  const pageViews = info.views.filter(v => v.visible && /^https?:/.test(v.url)).map(v => [v.x, v.y, v.w, v.h]);
  const chromeView = info.views.find(v => v.url === CHROME), origin = chromeView ? [chromeView.x, chromeView.y] : [0, 0];
  const isChrome = exact;
  const code = `(() => {
    ${scanSrc};
    ${edgeSrc};
    const zoom = ${info.zoom}; const cap = (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--caption-width')) || 0) / zoom;
    // The caption buttons are at most 32 DIP tall and never taller than the chrome row that carries them (the host sets the overlay to the
    // row's height: compactRowHeight x interface scale in Focus/Compact, 32 CSS px = 25.6 DIP at 80%; real pixels, R4 leftovers probe: the
    // close button paints 25 rows tall there, not 32). So the strip is min(32 DIP, the row's bottom edge); the old fixed 32 DIP flagged a
    // page ribbon that starts under the 26 DIP strip.
    const rowBottom = (document.querySelector('.browser-shell')?.getBoundingClientRect().bottom) || 0, captionH = rowBottom > 4 ? Math.min(32 / zoom, rowBottom) : 32 / zoom;
    const r = window.__resp.scan({ zoom, origin: ${JSON.stringify(origin)}, pageViews: ${JSON.stringify(isChrome ? pageViews : [])}, captionCss: ${isChrome ? 'cap' : 0}, captionH: ${isChrome ? 'captionH' : 0}, skipDocScroll: ${!isChrome} });
    let edge = [], clip = '';
    try { edge = window.__edge.static().slice(0, 40); } catch (e) { edge = [{ problem: 'edge scan failed ' + e }]; }
    try { clip = ${clipSrc}; } catch (e) { clip = 'clip scan failed ' + e; }
    return { ...r, edge, clip };
  })()`;
  const res = await evalIn(match, code, exact);
  if (!res || res.__missing || res.__error) { const msg = res?.__error || 'view not found'; if (!scanErrors.has(msg)) { scanErrors.add(msg); log('scan problem in', match, msg); } return { missing: true, error: msg, findings: [{ cat: 'harness', sev: 'warn', sig: 'harness:scan:' + match + ':' + msg.slice(0, 60), text: 'scan did not run: ' + msg }] }; }
  const findings = [...res.findings];
  // text within 8px of a painted edge (warn), text crossing the box (error)
  const seenE = new Set();
  for (const e of res.edge) { if (!e.problem) continue; const sig = 'edge:' + e.box + '|' + e.what.slice(0, 24) + '|' + e.problem.replace(/[\d.]+/g, '#'); if (seenE.has(sig)) continue; seenE.add(sig); findings.push({ cat: 'edge', sev: /crosses/.test(e.problem) ? 'error' : 'warn', sig, text: `${e.what} in ${e.box}: ${e.problem}`, box: e.boxRect }); }
  // m-clip-scan false positives: visually-hidden text (1-4px wide boxes: live regions, sr-only labels) and tab titles (ellipsis on the parent)
  if (typeof res.clip === 'string') for (const line of res.clip.split('\n').slice(1)) { if (!line || line === 'no hits' || /cw=[0-4]( |$)/.test(line) || /tab-title|sb-title|tab-label|nt-credit/.test(line)) continue; const sev = /clipped-no-ellipsis|crosses/.test(line) ? 'error' : 'warn'; findings.push({ cat: 'clip', sev, sig: 'clip:' + line.replace(/[\d.]+/g, '#').slice(0, 110), text: line.slice(0, 200) }); }
  return { vw: res.vw, vh: res.vh, controls: res.controls, counts: res.counts, ellipsisDeliberate: typeof res.clip === 'string' ? (res.clip.match(/ellipsis\(deliberate\)=(\d+)/) || [])[1] : null, findings };
}

const states = [], scanErrors = new Set();
let stateN = 0, shots = 0;
const refDone = new Set();
async function record(row, surface, extra = {}, extraFindings = [], viewMatch = { match: CHROME, exact: true }) {
  let info = await winInfo(); for (let i = 0; i < 6 && (!info || !info.content[0]); i++) { await sleep(400); info = await winInfo(); } // the window is momentarily hidden between setup steps
  if (!info || !info.content[0]) { log('no window'); return; }
  const scanned = await scanView(viewMatch.match, info, surface, viewMatch.exact);
  const findings = [...scanned.findings, ...nativeFindings(info, surface), ...extraFindings].filter(f => f.sev !== 'info');
  const errors = findings.filter(f => f.sev === 'error').length, warns = findings.filter(f => f.sev === 'warn').length;
  const s = { id: ++stateN, display: row.display, surface, label: row.size?.[0], req: row.size ? [row.size[1], row.size[2]] : null, actual: info.content, maximized: info.maximized, scale: row.scale, tabs: row.tabs, view: row.view, theme: row.theme, zoom: info.zoom, css: [scanned.vw, scanned.vh], controls: scanned.controls, errors, warns, ellipsisDeliberate: scanned.ellipsisDeliberate, ...extra, findings };
  states.push(s);
  const name = `${row.display}-${String(s.id).padStart(3, '0')}-${surface.replace(/[^a-z0-9-]/gi, '_')}-${info.content[0]}x${info.content[1]}-${row.scale}-${row.tabs}-${row.view}-${row.theme}`;
  const refKey = row.display + '|' + surface;
  if ((errors || warns) && shots < 60) { await fs.writeFile(path.join(OUT, name + '.json'), JSON.stringify(s, null, 1)); if (errors && await shot(path.join(OUT, name + '.png'))) shots++; }
  else if (!refDone.has(refKey)) { refDone.add(refKey); await fs.mkdir(path.join(OUT, 'ref'), { recursive: true }); await shot(path.join(OUT, 'ref', name + '.png')); }
  if (!refDone.has(refKey)) { refDone.add(refKey); }
  return s;
}

// ---- surfaces --------------------------------------------------------------------------------------------------------------
let fix = null;
async function configure(row) {
  await act({ type: 'settings.update', patch: { appearance: row.theme, interfaceScale: row.scale, verticalTabs: row.tabs === 'sidebar', windowView: row.view, reducedMotion: true } });
  await act({ type: 'ui.update', patch: { workspaceOpen: row.tabs === 'sidebar', webWorkspaceOpen: row.tabs === 'sidebar', view: row.view === 'full' ? null : row.view } });
  await act({ type: 'tab.select', id: fix.split[0] });
  await setSize(row.size[1], row.size[2]);
  const s = await state(); const tabId = s.activeTabId;
  const pin = (zone, on) => chrome(`window.acira.browserCommand({ type: 'edge', tabId: ${JSON.stringify(tabId)}, pin: { zone: ${JSON.stringify(zone)}, on: ${on} } })`);
  await pin('top', row.view === 'seamless'); await pin('side', row.view === 'seamless' && row.tabs === 'sidebar');
  await settle(row.scale);
  if (row.view === 'seamless') await sleep(500);
}
const layout = () => chrome('window.acira.getBrowserLayout()');
/** Centre (CSS px) of the first visible element matching `sel` (and `re` on its text), or null. */
const rectOf = (match, exact, sel, re) => evalIn(match, `(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find(n => n.checkVisibility && n.checkVisibility() && n.getBoundingClientRect().width > 0 && ${re ? `new RegExp(${JSON.stringify(re)}, 'i').test((n.textContent || '').trim())` : 'true'}); if (!e) return null; const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`, exact);
/** A real (trusted) pointer click at a CSS-px point of a view: sendInputEvent takes DIPs, so scale by that view's zoom. */
const realClick = (match, exact, pt) => app.evaluate(async ({ webContents }, [match, exact, pt]) => {
  const wc = webContents.getAllWebContents().find(w => { try { const u = w.getURL(); return !w.isDestroyed() && (exact ? u === match : u.includes(match)); } catch { return false; } }); if (!wc) return false;
  const z = wc.getZoomFactor(), x = Math.round(pt[0] * z), y = Math.round(pt[1] * z), wait = ms => new Promise(r => setTimeout(r, ms));
  wc.sendInputEvent({ type: 'mouseMove', x, y }); await wait(40); wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 }); await wait(40); wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 }); await wait(40); return true;
}, [match, exact, pt]);
async function closePopup() {
  for (let i = 0; i < 3; i++) { const l = await layout(); const o = l && l.overlay; if (!o) return; await chrome(`window.acira.closeOverlay(${JSON.stringify(o.id)})`); await sleep(220); }
}
async function openPopup(kind) {
  const trigger = { menu: '[aria-label="Acira menu"]', profile: '.toolbar-optional-profile, .sb-foot-profile, [aria-label$="Switch profile"]', protection: '[data-protection-trigger]', 'more-tools': '[aria-label="Acira menu"]' }[kind];
  const pt = await rectOf(CHROME, true, trigger), clicked = Array.isArray(pt) && await realClick(CHROME, true, pt);
  let via = clicked ? 'trigger' : 'command';
  if (!clicked) { const s = await state(); await chrome(`window.acira.browserCommand({ type: 'ui', tabId: ${JSON.stringify(s.activeTabId)}, action: 'open', kind: ${JSON.stringify(kind === 'more-tools' ? 'menu' : kind)}, anchor: { x: innerWidth - 120, y: 36, width: 28, height: 28 } })`); }
  const want = kind === 'more-tools' ? 'menu' : kind;
  let l = null; for (let i = 0; i < 24; i++) { l = await layout(); if (l?.overlay?.kind === want) break; await sleep(100); }
  if (l?.overlay?.kind !== want) return { opened: false, via, got: l?.overlay?.kind || 'none' };
  await sleep(420);
  if (kind === 'more-tools') {
    await overlay(`(() => { const r = [...document.querySelectorAll('.menu-row')].find(n => /More tools/i.test(n.textContent)); if (r) r.scrollIntoView({ block: 'center' }); return !!r; })()`); await sleep(150); // a short window scrolls the menu: bring the row into view like a person would
    const rowPt = await rectOf('view=overlay', false, '.menu-row', 'More tools');
    if (!Array.isArray(rowPt) || !(await realClick('view=overlay', false, rowPt))) return { opened: false, via, got: 'no More tools row' };
    for (let i = 0; i < 24; i++) { l = await layout(); if (l?.overlay?.kind === 'more-tools') break; await sleep(100); }
    if (l?.overlay?.kind !== 'more-tools') return { opened: false, via, got: l?.overlay?.kind || 'none' };
    await sleep(420);
  }
  return { opened: true, via, kind: l.overlay.kind, bounds: l.overlay.bounds };
}
const OVERLAY = { match: 'view=overlay', exact: false };
const popupExtra = async (surface) => {
  const r = await overlay(`(() => { const p = document.querySelector('.browser-popup') || document.querySelector('.sheet-popup'); if (!p) return null; const b = p.getBoundingClientRect(); return { rect: [b.x, b.y, b.width, b.height].map(Math.round), vw: innerWidth, vh: innerHeight, scrollH: p.scrollHeight, clientH: p.clientHeight }; })()`);
  return r && !r.__missing && !r.__error ? { popup: r } : {};
};
async function surfacePopup(row) {
  const o = await openPopup(row.popup);
  if (!o.opened) { states.push({ id: ++stateN, display: row.display, surface: 'popup:' + row.popup, label: row.size[0], actual: null, scale: row.scale, tabs: row.tabs, view: row.view, theme: row.theme, errors: 0, warns: 1, findings: [{ cat: 'popupOpen', sev: 'warn', sig: 'popupOpen:' + row.popup + ':' + row.view + ':' + row.tabs, text: `popup ${row.popup} did not open (${o.via}: ${o.got})` }] }); await closePopup(); return; }
  // the popup lives in the overlay view: scan that, with the native bounds checks against the window
  const s = await record(row, 'popup:' + row.popup, { via: o.via, ...(await popupExtra()) }, [], OVERLAY);
  await closePopup();
  return s;
}
async function surfaceToast(row) {
  await closePopup();
  await act({ type: 'toast', text: 'Closed 3 tabs. Press Undo to bring them all back, or keep browsing.', tone: 'info' });
  let l = null; for (let i = 0; i < 20; i++) { l = await layout(); if (l?.overlay) break; await sleep(100); }
  await sleep(380);
  const s = await record(row, 'toast', { overlayKind: l?.overlay?.kind || 'none' }, [], OVERLAY.match && l?.overlay ? OVERLAY : { match: CHROME, exact: true });
  const st = await state(); await chrome(`window.acira.browserCommand({ type: 'ui', tabId: ${JSON.stringify(st.activeTabId)}, action: 'toast-dismiss' })`).catch(() => {}); await closePopup();
  return s;
}
async function selectTab(id, ms = 650) { await act({ type: 'tab.select', id }); await sleep(ms); }
async function surfacePage(row) {
  const p = row.page; let tab = p.startsWith('newtab') ? fix.newtab : p.startsWith('settings') ? fix.settings : fix.history;
  if (p.startsWith('newtab')) { const prof = (await state()).activeBrowserProfileId; await chrome(`localStorage.setItem('acira-new-tab:' + ${JSON.stringify(prof)}, JSON.stringify({ artStyle: ${JSON.stringify(p === 'newtab-full' ? 'full' : 'framed')} }))`); await selectTab(fix.split[0], 150); }
  await selectTab(tab, p.startsWith('newtab') ? 900 : 700);
  let extra = {};
  if (p.startsWith('settings')) {
    const want = p === 'settings-privacy' ? '^Privacy' : '^Appearance';
    const pt = await rectOf(CHROME, true, '.page-area button,.page-area [role=tab],.page-area a', want);
    extra.section = Array.isArray(pt) && await realClick(CHROME, true, pt) ? want : 'no section button';
    await sleep(600);
    // Settings collapses its nav to an icon rail by container width: record what it measured so a mismatch is visible in states.json
    extra.settingsNav = await chrome(`(() => { const b = document.querySelector('.browser-settings'), s = document.querySelector('.bs-sidebar'), m = document.querySelector('.bs-main'); return b && s ? { container: Math.round(b.getBoundingClientRect().width), sidebar: Math.round(s.getBoundingClientRect().width), main: m ? Math.round(m.getBoundingClientRect().width) : null, vw: innerWidth } : null; })()`);
  }
  const s = await record(row, p, extra);
  await selectTab(fix.split[0], 150);
  return s;
}

// ---- setup (fresh profile, before the fixture) -------------------------------------------------------------------------------
async function setupPhase(display) {
  const sizes = clampSizes([['min', 900, 600], ['1280x720', 1280, 720], ...SIZES[display].slice(display === 100 ? 3 : 0, display === 100 ? 4 : 1)]);
  const rowFor = (size, scale) => ({ display, size, scale, tabs: '-', view: 'setup', theme: 'dark' });
  for (const step of ['welcome', 'step1']) {
    for (const [size, scale] of [...sizes.map(s => [s, 100]), [sizes[0], 150]]) {
      await act({ type: 'settings.update', patch: { interfaceScale: scale, reducedMotion: true } }).catch(() => {});
      await setSize(size[1], size[2]); await settle(scale); await sleep(500);
      const buttons = await chrome(`[...document.querySelectorAll('button')].filter(b => b.checkVisibility && b.checkVisibility()).map(b => (b.textContent || b.getAttribute('aria-label') || '').trim().slice(0, 24))`);
      await record(rowFor(size, scale), 'setup:' + step, { buttons });
    }
    if (step === 'welcome') {
      await setSize(sizes[1][1], sizes[1][2]); await act({ type: 'settings.update', patch: { interfaceScale: 100 } }); await settle(100);
      const r = await chrome(`(() => { const b = [...document.querySelectorAll('button')].find(n => n.checkVisibility && n.checkVisibility() && /^(get started|continue|begin|start|next|let.s go)/i.test((n.textContent || '').trim())); if (!b) return 'no primary button'; b.click(); return (b.textContent || '').trim(); })()`);
      log('setup advance:', r); await sleep(1800);
    }
  }
}

/** Leave setup: Skip setup where it exists, else Continue / Done through the steps (capped), then wait for the finale to end. */
async function finishSetup() {
  // the welcome scene is a lazy chunk that mounts after the browser shell: give it up to 8s before deciding there is no setup to leave
  for (let i = 0; i < 32; i++) { if ((await chrome(`!!document.querySelector('.fr-w, .fr-stage, .fr-finale-veil')`)) === true) break; await sleep(250); }
  const gone = async () => (await chrome(`!document.querySelector('.fr-stage, .fr-finale-veil, .fr-finale-mark, .fr-ghost, .fr-w')`)) === true; // .fr-w = the welcome scene (before Get started)
  for (let i = 0; i < 14; i++) {
    if (await gone()) break;
    const r = await chrome(`(() => { const vis = n => n.checkVisibility && n.checkVisibility(), bs = [...document.querySelectorAll('button')].filter(vis), t = n => ((n.textContent || '') + ' ' + (n.getAttribute('aria-label') || '')).trim();
      const skip = bs.find(n => /skip setup/i.test(t(n))); if (skip) { skip.click(); return 'skip'; }
      const done = bs.find(n => /^done$/i.test((n.textContent || '').trim())); if (done) { done.click(); return 'done'; }
      const next = bs.find(n => /^(continue|next|finish|get started|not now|start browsing|skip)/i.test((n.textContent || '').trim())); if (next) { next.click(); return 'continue:' + (next.textContent || '').trim().slice(0, 20); }
      return 'none: ' + bs.map(t).join(' | ').slice(0, 160); })()`);
    log('setup finish step', i, r); await sleep(r === 'skip' ? 2600 : 1100);
  }
  for (let i = 0; i < 16 && !(await gone()); i++) await sleep(500);
  await sleep(700);
}

// ---- main flow per display ---------------------------------------------------------------------------------------------------
async function runDisplay(display) {
  const t0 = Date.now(), rows = planFor(display).slice(FROM, FROM + MAXROWS);
  lock = await slot(); log(`display ${display}%: slot ${lock}, ${rows.length} rows`);
  try {
    app = await launch(display);
    let ui; for (let i = 0; i < 300 && !ui; i++) { ui = (await evalIn(CHROME, 'document.readyState', true)) === 'complete'; await sleep(100); }
    await app.evaluate(({ BaseWindow }) => { for (const w of BaseWindow.getAllWindows()) if (w.isVisible()) { w.setContentSize(1280, 800); w.setPosition(0, 0); } });
    await focusWin();
    const first = await winInfo(); log('display', JSON.stringify(first?.display), 'zoom', first?.zoom);
    if (wants('setup')) { await sleep(2500); try { await setupPhase(display); } catch (e) { log('setup phase failed', String(e).slice(0, 200)); } }
    await finishSetup();
    await act({ type: 'settings.update', patch: { reducedMotion: true, interfaceScale: 100 } }); await setSize(1400, 900); await settle(100);
    // fixture: 8 tabs (split of 2, a group of 2, new tab, Settings, History)
    const s0 = await state(), t0id = s0.activeTabId;
    await act({ type: 'tab.navigate', tabId: t0id, url: base + 'one' });
    for (const [url, bg] of [[base + 'two', true], [base + 'three', true], [base + 'four', true], ['acira://new', true], ['acira://settings', true], ['acira://history', true], [base + 'five', true]]) {
      const before = (await state()).tabs.length; await act({ type: 'tab.new', url, background: bg }); await sleep(350);
      const after = (await state()).tabs.length; if (after !== before + 1) throw Error('tab.new did not add exactly one tab (' + before + ' -> ' + after + ')');
    }
    await sleep(900);
    const st = await state(), byUrl = u => st.tabs.find(t => t.url === u || t.url.startsWith(u));
    fix = { split: [t0id, byUrl(base + 'two').id], group: [byUrl(base + 'three').id, byUrl(base + 'four').id], newtab: byUrl('acira://new').id, settings: byUrl('acira://settings').id, history: byUrl('acira://history').id };
    if (st.tabs.length > 30) throw Error('too many tabs');
    await act({ type: 'tab.select', id: t0id });
    await act({ type: 'split.open', tabIds: fix.split, layout: 'columns' }); await sleep(600);
    await act({ type: 'tab.group.create', tabId: fix.group[0], name: 'Work', color: 'blue' }); await sleep(300);
    const gid = (await state()).tabGroups?.[0]?.id; if (gid) await act({ type: 'tab.group.assign', tabIds: fix.group, groupId: gid });
    const check = await state(); log('fixture:', check.tabs.length, 'tabs, split', JSON.stringify(check.windowUi.split?.tabIds?.length), 'groups', check.tabGroups?.length);
    // native maximize, once
    await act({ type: 'settings.update', patch: { interfaceScale: 100, windowView: 'full', verticalTabs: true, appearance: 'dark' } }); await act({ type: 'ui.update', patch: { workspaceOpen: true, webWorkspaceOpen: true, view: null } });
    await setSize(0, 0, true); await settle(100); await sleep(500);
    await record({ display, size: ['native maximized', 0, 0], scale: 100, tabs: 'sidebar', view: 'full', theme: 'dark' }, 'main');
    await setSize(1400, 900);
    for (const row of rows) {
      if (Date.now() - t0 > 9.4 * 60 * 1000) { log(`slot time cap reached at row ${row.n}; resume with --from ${row.n}`); break; }
      try {
        await configure(row);
        if (wants('main')) await record(row, 'main');
        if (wants('popups')) await surfacePopup(row);
        if (wants('pages')) await surfacePage(row);
        if (wants('toast') && row.toast) await surfaceToast(row);
        await closePopup();
      } catch (e) { log(`row ${row.n} failed: ${String(e).slice(0, 200)}`); states.push({ id: ++stateN, display, surface: 'harness', label: row.size[0], errors: 0, warns: 0, harnessError: String(e).slice(0, 300), findings: [] }); await closePopup().catch(() => {}); }
      if (row.n % 10 === 9) log(`row ${row.n + 1}/${rows.length} done, ${states.length} states, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    }
  } finally {
    try { await app?.close(); } catch {}
    try { app?.process()?.kill(); } catch {}
    app = null; if (lock) await fs.unlink(lock).catch(() => {}); lock = null;
  }
}

function summarize() {
  const groups = new Map();
  for (const s of states) for (const f of s.findings || []) {
    const k = s.surface.split(':')[0] + '|' + f.sig; const g = groups.get(k) || { surface: s.surface, cat: f.cat, sev: f.sev, sig: f.sig, text: f.text, count: 0, smallest: null, states: [] };
    g.count++; if (f.sev === 'error') g.sev = 'error'; g.states.push(s.id);
    const area = (s.css?.[0] || 1e9) * (s.css?.[1] || 1e9); if (!g.smallest || area < g.smallest.area) g.smallest = { area, id: s.id, window: s.actual, scale: s.scale, tabs: s.tabs, view: s.view, theme: s.theme, display: s.display, css: s.css };
    groups.set(k, g);
  }
  return [...groups.values()].sort((a, b) => (a.sev === b.sev ? 0 : a.sev === 'error' ? -1 : 1) || b.count - a.count);
}

try {
  await fs.mkdir(OUT, { recursive: true });
  for (const d of displays) {
    try { await runDisplay(d); } catch (e) { log(`display ${d} aborted:`, String(e?.stack || e).slice(0, 400)); }
    await fs.writeFile(path.join(OUT, 'states.json'), JSON.stringify(states, null, 1));
  }
} finally {
  try { server.close(); } catch {}
  const summary = summarize();
  await fs.writeFile(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 1));
  const bySurface = {}; for (const g of summary) { const k = g.surface.split(':')[0]; (bySurface[k] ||= { error: 0, warn: 0 })[g.sev === 'error' ? 'error' : 'warn']++; }
  log(`states run: ${states.length}; failing (errors): ${states.filter(s => s.errors).length}; warn-only: ${states.filter(s => !s.errors && s.warns).length}; signatures: ${summary.length}`);
  log('signatures by surface', JSON.stringify(bySurface));
  for (const g of summary.filter(g => g.sev === 'error').slice(0, 40)) log('ERR', g.surface, `x${g.count}`, g.text.slice(0, 150), '| smallest', JSON.stringify(g.smallest && { w: g.smallest.window, scale: g.smallest.scale, tabs: g.smallest.tabs, view: g.smallest.view }));
  if (lock) await fs.unlink(lock).catch(() => {});
}
