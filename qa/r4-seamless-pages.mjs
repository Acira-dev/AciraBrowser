// R4-54 (seamless-2): the Seamless left-edge and top-edge reveal on every page kind, with the REAL OS cursor (the controller reads
// screen.getCursorScreenPoint, so synthetic input proves nothing). Web page, Settings, new tab, History, a split, Peek.
// For each: rest -> cursor to the left edge -> sidebar floats (page bounds unchanged, no reflow) -> click on the page hides it ->
// cursor to the top edge -> toolbar floats -> leave hides. Shots + 60Hz strips (desktopCapturer of the real window).
// Usage (worktree root): node qa/r4-seamless-pages.mjs <theme dark|light> <scale 100|150> [tag]
// One native slot (C:\ae\slot-N.lock, wx), isolated profile under .qa-profiles, evidence under C:\ae\r4\seamless2\evidence.
import fs from 'node:fs/promises';
import fss from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { launchPreparedNative } from './prepared-native.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const theme = process.argv[2] || 'dark', scale = Number(process.argv[3] || 100), tag = process.argv[4] || `${theme}-${scale}`;
const OUT = path.join(process.env.R4_EVIDENCE || 'C:/ae/r4/seamless2/evidence', tag); await fs.mkdir(OUT, { recursive: true });
const results = [];
// S2_MAX=1 maximizes the window (founder's setup); S2_EDGE_X sets where the side push stops (DIPs from the content's left edge; negative = past it, onto a monitor on the left).
const EDGE_X = Number(process.env.S2_EDGE_X ?? 3);
// S2_BACK_X: after the push, the pointer comes back to here (a flick that overshoots onto the left monitor and returns).
const BACK_X = process.env.S2_BACK_X ? Number(process.env.S2_BACK_X) : null;
const log = (...a) => console.log(`[s2 ${tag}]`, ...a);
const check = (ok, label, extra = '') => { results.push({ ok: !!ok, label, extra }); log(ok ? 'PASS' : 'FAIL', label, extra); };

async function takeSlot() {
  for (let i = 0; i < 40; i++) {
    for (const n of [1, 2, 3]) { const f = `C:/ae/slot-${n}.lock`; try { const h = await fs.open(f, 'wx'); await h.writeFile(`seamless2 ${new Date().toISOString()}\n`); await h.close(); return f; } catch {} }
    log('all slots busy, waiting 30s'); await sleep(30000);
  }
  throw Error('no slot');
}

// The real cursor: one PowerShell (per-monitor DPI aware) that takes "x y" lines in physical screen pixels.
function cursorMover() {
  const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class Cur { [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y); [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr v);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, UIntPtr e); }
"@
[Cur]::SetProcessDpiAwarenessContext([IntPtr](-4)) | Out-Null
[Console]::Out.WriteLine('ready'); [Console]::Out.Flush()
while ($true) { $l = [Console]::In.ReadLine(); if ($l -eq $null -or $l -eq 'q') { break }; $p = $l.Split(' ');
  if ($p[0] -eq 'c') { [Cur]::mouse_event(2,0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 30; [Cur]::mouse_event(4,0,0,0,[UIntPtr]::Zero) } else { [Cur]::SetCursorPos([int]$p[0], [int]$p[1]) | Out-Null }
  [Console]::Out.WriteLine('ok'); [Console]::Out.Flush() }
`], { stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true });
  let buffer = '', waiters = [];
  ps.stdout.on('data', d => { buffer += d; let i; while ((i = buffer.indexOf('\n')) >= 0) { buffer = buffer.slice(i + 1); waiters.shift()?.(); } });
  const ready = new Promise(r => waiters.push(r));
  const send = line => new Promise(r => { waiters.push(r); ps.stdin.write(line + '\n'); });
  return { ready, move: (x, y) => send(`${Math.round(x)} ${Math.round(y)}`), click: () => send('c'), close: () => { try { ps.stdin.write('q\n'); } catch {} setTimeout(() => { try { ps.kill(); } catch {} }, 500); } };
}

const pageHtml = (title, bg) => `<!doctype html><title>${title}</title><body style="margin:0;font:16px system-ui;background:${bg}"><div style="padding:24px 32px"><h1>${title}</h1>${Array.from({ length: 40 }, (_, i) => `<p>Line ${i + 1}: The page under a floating sidebar never moves. Lorem ipsum dolor sit amet.</p>`).join('')}</div><script>let n=0;addEventListener('pointerdown',()=>{document.title='${title} clicked '+(++n)});addEventListener('resize',()=>{window.__resizes=(window.__resizes||0)+1})</script>`;
const server = http.createServer((req, res) => { const k = req.url.slice(1) || 'one'; const map = { one: ['Website One', '#f3efe6'], two: ['Website Two', '#e3edf7'], three: ['Peeked Page', '#e9f3e3'] }; const [t, bg] = map[k] || ['Page', '#fff']; res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(pageHtml(t, bg)); });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

let app, ui, lock, mover;
const watchdog = setTimeout(() => { log('watchdog: closing'); try { void app?.close(); } catch {} }, 9 * 60_000); watchdog.unref();
const trace = [];
try {
  lock = await takeSlot(); log('slot', lock);
  mover = cursorMover(); await mover.ready;
  const profile = path.resolve(process.env.S2_PROFILE || `.qa-profiles/seamless2-${tag}-${Date.now()}`); // S2_PROFILE: a copy of a real test profile
  app = await launchPreparedNative({
    executablePath: createRequire(import.meta.url)('electron'),
    args: [path.resolve('desktop/main.cjs'), '--disable-features=CalculateNativeWinOcclusion', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
    env: { ...process.env, ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: profile, ACIRA_EDGE_TRACE: process.env.ACIRA_EDGE_TRACE || '1', ACIRA_BROWSER_TEST_HIDDEN: '' },
    timeout: 60000,
  });
  app.process().stdout?.on('data', d => { for (const line of String(d).split('\n')) if (line.includes('[edge')) trace.push(line.trim()); });
  const pickUi = async () => { for (let i = 0; i < 300; i++) { for (const p of app.windows()) { try { if (p.url() === 'acira-browser-ui://ui/index.html') return p; } catch {} } await sleep(100); } throw Error('ui page not found'); };
  ui = await pickUi();
  const act = a => ui.evaluate(a => window.acira.dispatch(a), a);
  const cmd = c => ui.evaluate(c => window.acira.browserCommand(c), c);
  const snap = () => ui.evaluate(() => window.acira.getSnapshot());
  await app.evaluate(({ BaseWindow }, max) => { const w = BaseWindow.getAllWindows().sort((a, b) => b.getBounds().width - a.getBounds().width)[0]; w.setBounds({ x: 80, y: 60, width: 1280, height: 820 }); if (max) w.maximize(); w.show(); w.focus(); w.setAlwaysOnTop(true, 'floating'); }, !!process.env.S2_MAX);
  if (process.env.S2_SETUP === 'finish') { // the founder's path: setup all the way through its finale, then Make it yours
    await ui.locator('.setup-dialog').waitFor({ timeout: 20000 });
    for (let i = 0; i < 14; i++) { const start = ui.getByRole('button', { name: 'Start browsing' }); if (await start.count() && await start.first().isVisible()) { await start.first().click(); break; }
      let clicked = false; const end = Date.now() + 9000; while (!clicked && Date.now() < end) { for (const name of ['Get started', 'Continue', 'Next', 'Not now', 'Skip']) { const b = ui.getByRole('button', { name, exact: true }); if (await b.count() && await b.first().isVisible() && await b.first().isEnabled()) { await b.first().click(); clicked = true; break; } } if (!clicked) await sleep(200); }
      if (!clicked) break; await sleep(700); }
    await sleep(2500); log('after setup: yours host', await ui.locator('.fr-yours-host').count());
  } else try { await ui.getByRole('button', { name: 'Skip setup', exact: true }).click({ timeout: 15000 }); } catch {}
  await sleep(1200); ui = await pickUi();
  try { await ui.getByRole('button', { name: 'Done', exact: true }).click({ timeout: 2500 }); } catch {}
  await act({ type: 'settings.update', patch: { appearance: theme, interfaceScale: scale, verticalTabs: true, windowView: 'seamless', reducedMotion: false } });
  await act({ type: 'ui.update', patch: { workspaceOpen: false, webWorkspaceOpen: false } });
  await sleep(1200);
  const bounds = () => app.evaluate(({ BaseWindow, screen }) => { const w = BaseWindow.getAllWindows().find(x => x.isVisible()); const b = w.getContentBounds(); return { ...b, sf: screen.getDisplayMatching(b).scaleFactor }; });
  const toScreen = (b, x, y) => app.evaluate(({ screen }, p) => screen.dipToScreenPoint(p), { x: Math.round(b.x + x), y: Math.round(b.y + y) });
  const moveTo = async (x, y) => { const b = await bounds(); const p = await toScreen(b, x, y); await mover.move(p.x, p.y); };
  const glideTo = async (from, to, steps = 8) => { for (let i = 1; i <= steps; i++) { await moveTo(from.x + (to.x - from.x) * i / steps, from.y + (to.y - from.y) * i / steps); await sleep(12); } };
  const focusWin = () => app.evaluate(({ BaseWindow }) => { const w = BaseWindow.getAllWindows().find(x => x.isVisible()); w.focus(); });
  const dom = () => ui.evaluate(() => { const side = document.querySelector('.acira-sidebar.is-expanded'), r = side?.getBoundingClientRect(), shell = document.querySelector('.browser-shell'), area = document.querySelector('.page-area')?.getBoundingClientRect();
    return { side: !!side, peek: !!document.querySelector('.acira-sidebar.is-peek'), sideW: r ? Math.round(r.width) : 0, sideX: r ? Math.round(r.x) : null, float: document.documentElement.hasAttribute('data-edge-float'), top: shell?.getAttribute('data-seamless'), area: area ? { x: Math.round(area.x), y: Math.round(area.y), w: Math.round(area.width), h: Math.round(area.height) } : null, url: window.__lastUrl }; });
  const nativeBounds = () => app.evaluate(({ BaseWindow }) => { const w = BaseWindow.getAllWindows().find(x => x.isVisible()); return w.contentView.children.map(v => ({ b: v.getBounds(), vis: v.getVisible(), url: v.webContents?.getURL?.().slice(0, 60) })); });
  const shotWin = async name => { await sleep(80); const b64 = await app.evaluate(async ({ BaseWindow, desktopCapturer }) => { const w = BaseWindow.getAllWindows().find(x => x.isVisible()), [cw, ch] = w.getSize(); const s = (await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: cw, height: ch } })).find(x => x.id === w.getMediaSourceId()); return s ? s.thumbnail.toPNG().toString('base64') : ''; }); if (b64) await fs.writeFile(path.join(OUT, name + '.png'), Buffer.from(b64, 'base64')); return path.join(OUT, name + '.png'); };
  // A 60Hz strip of the real window (desktopCapturer frames at the window's size, cropped), while `fire` runs.
  const strip = async (name, fire, crop) => {
    // capturePage of the interface view: real composited pixels of the sidebar, toolbar and interface pages at ~60Hz (a website's native view is not in it; its bounds are checked separately).
    const burst = app.evaluate(async ({ webContents }, crop) => { const wc = webContents.getAllWebContents().find(w => w.getURL() === 'acira-browser-ui://ui/index.html'), frames = [], t0 = Date.now();
      while (frames.length < 56 && Date.now() - t0 < 1200) { const image = await wc.capturePage({ x: crop.x, y: crop.y, width: crop.w, height: crop.h }); frames.push({ t: Date.now() - t0, png: image.toPNG().toString('base64') }); }
      return frames; }, crop);
    await sleep(60); await fire();
    const frames = await burst;
    const sheet = await ui.evaluate(async ({ frames, crop }) => { const load = src => new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = src; }); const imgs = await Promise.all(frames.map(f => load('data:image/png;base64,' + f.png)));
      const cols = 6, cw = crop.w, ch = crop.h + 18, c = document.createElement('canvas'); c.width = cols * cw; c.height = Math.ceil(imgs.length / cols) * ch; const g = c.getContext('2d'); g.fillStyle = '#222'; g.fillRect(0, 0, c.width, c.height); g.font = '13px sans-serif';
      imgs.forEach((img, i) => { const x = (i % cols) * cw, y = Math.floor(i / cols) * ch; g.drawImage(img, 0, 0, img.width, img.height, x, y + 18, crop.w, crop.h); g.fillStyle = '#fff'; g.fillText(frames[i].t + ' ms', x + 4, y + 13); });
      return c.toDataURL('image/png').split(',')[1]; }, { frames, crop });
    await fs.writeFile(path.join(OUT, name + '.png'), Buffer.from(sheet, 'base64'));
    return frames.map(f => f.t);
  };

  // Tabs for every page kind.
  await act({ type: 'tab.new', url: base + 'one' }); await sleep(1500);
  let s = await snap(); const webId = s.activeTabId;
  await act({ type: 'tab.new', url: base + 'two' }); await sleep(1200);
  s = await snap(); const web2Id = s.activeTabId;
  const kinds = [
    { name: 'web', go: async () => { await act({ type: 'tab.select', id: webId }); } },
    { name: 'settings', go: async () => { await act({ type: 'tab.new', url: 'acira://settings' }); } },
    { name: 'newtab', go: async () => { await act({ type: 'tab.new', url: 'acira://new' }); await sleep(300); await ui.evaluate(() => document.activeElement?.blur?.()); await ui.keyboard.press('Escape'); } },
    { name: 'history', go: async () => { await act({ type: 'tab.new', url: 'acira://history' }); } },
    { name: 'split', go: async () => { await act({ type: 'tab.select', id: webId }); await act({ type: 'split.open', tabIds: [webId, web2Id] }); } },
    { name: 'peek', go: async () => { await act({ type: 'split.close' }); await act({ type: 'tab.select', id: webId }); await sleep(400); await ui.evaluate(r => window.acira.peek(r), { type: 'peek.open', url: base + 'three', tabId: webId }); } },
    { name: 'web-again', go: async () => { await ui.evaluate(() => window.acira.peek({ type: 'peek.close' })).catch(() => {}); await act({ type: 'tab.select', id: webId }); } },
  ];
  const only = process.env.S2_ONLY ? process.env.S2_ONLY.split(',') : null;
  for (const kind of kinds) {
    if (only && !only.includes(kind.name)) continue;
    log('---', kind.name);
    await focusWin(); await kind.go(); await sleep(1300);
    let b = await bounds(); const mid = { x: b.width * 0.55, y: b.height * 0.5 };
    await moveTo(mid.x, mid.y); await sleep(700);
    const rest = await dom(), restNative = await nativeBounds();
    await shotWin(`${kind.name}-1-rest`);
    check(!rest.side && rest.top === 'hidden', `${kind.name}: rest has nothing but the page`, JSON.stringify(rest));
    // Side: arrive at the left edge for real.
    const sideY = b.height * 0.45;
    const sideTimes = await strip(`${kind.name}-strip-side-reveal`, async () => { await glideTo({ x: 160, y: sideY }, { x: EDGE_X, y: sideY }, 6); for (let i = 0; i < 8; i++) { await moveTo(BACK_X ?? EDGE_X, sideY); await sleep(40); } }, { x: 0, y: 0, w: 420, h: Math.min(520, b.height) });
    await sleep(500);
    if (!(await dom()).side) { log('retry side reveal (focus or cursor taken by another window?)'); await focusWin(); await moveTo(160, sideY); await sleep(500); await glideTo({ x: 160, y: sideY }, { x: 3, y: sideY }, 6); for (let i = 0; i < 8; i++) { await moveTo(3, sideY); await sleep(40); } await sleep(500); }
    const shown = await dom(), shownNative = await nativeBounds();
    if (process.env.S2_DEBUG) log('css', JSON.stringify(await ui.evaluate(() => { const pick = (sel, keys) => { const el = document.querySelector(sel); if (!el) return null; const c = getComputedStyle(el); return Object.fromEntries(keys.map(k => [k, c[k]])); }; return { app: pick('.app', ['display', 'flexDirection', 'gridTemplateColumns']), rail: pick('.ed-rail', ['position', 'width', 'flex', 'zIndex', 'margin', 'order']), root: pick('.browser-root', ['flex', 'width', 'position']), shell: pick('.browser-shell', ['position', 'height', 'zIndex']), body: pick('.browser-body', ['position']), area: pick('.page-area', ['margin', 'position', 'visibility']), content: pick('.page-area > *', ['position']) }; })));
    if (process.env.S2_DEBUG) log('windows', JSON.stringify(await app.evaluate(({ BaseWindow, BrowserWindow }) => ({ all: BaseWindow.getAllWindows().map(w => ({ t: w.getTitle(), b: w.getBounds(), f: w.isFocused(), v: w.isVisible() })), focused: BrowserWindow.getFocusedWindow()?.getTitle() || null }))));
    await shotWin(`${kind.name}-2-side-shown`);
    check(shown.side && shown.peek, `${kind.name}: left edge reveals the sidebar`, JSON.stringify(shown));
    check(shown.float, `${kind.name}: sidebar floats (Tier A)`, JSON.stringify({ float: shown.float }));
    check(JSON.stringify(rest.area) === JSON.stringify(shown.area), `${kind.name}: page area did not move or resize`, JSON.stringify({ rest: rest.area, shown: shown.area }));
    const key = v => v.url || ''; const moved = restNative.filter(v => v.vis && /^http/.test(key(v)) && shownNative.some(n => key(n) === key(v) && JSON.stringify(n.b) !== JSON.stringify(v.b)));
    check(moved.length === 0, `${kind.name}: native page bounds unchanged`, JSON.stringify(moved.map(m => m.b)));
    // Onto the sidebar (to pick a tab): it must stay.
    await moveTo(110, sideY); await sleep(700);
    const onIt = await dom(); check(onIt.side, kind.name + ': stays while the pointer is on it', JSON.stringify(onIt));
    // A click on the page hides it (move onto the page, click for real).
    await strip(`${kind.name}-strip-side-hide`, async () => { await moveTo(b.width * 0.6, b.height * 0.55); await mover.click(); }, { x: 0, y: 0, w: 420, h: Math.min(520, b.height) });
    await sleep(900);
    const after = await dom();
    check(!after.side, `${kind.name}: click on the page hides the sidebar`, JSON.stringify(after));
    // Top: arrive at the top edge.
    await moveTo(b.width * 0.4, 160); await sleep(500);
    await strip(`${kind.name}-strip-top-reveal`, async () => { await glideTo({ x: b.width * 0.4, y: 120 }, { x: b.width * 0.4, y: 2 }, 6); for (let i = 0; i < 8; i++) { await moveTo(b.width * 0.4, 2); await sleep(40); } }, { x: 0, y: 0, w: Math.min(900, b.width), h: 160 });
    await sleep(500);
    const top = await dom();
    await shotWin(`${kind.name}-3-top-shown`);
    check(top.top === 'shown', `${kind.name}: top edge reveals the toolbar`, JSON.stringify(top));
    check(JSON.stringify(rest.area) === JSON.stringify(top.area), `${kind.name}: page area unchanged under the toolbar`, JSON.stringify({ rest: rest.area, top: top.area }));
    // The hide starts after the grace (300ms + 400ms minimum visible): the strip starts at the leave and covers the slide-up.
    await strip(`${kind.name}-strip-top-hide`, async () => { await moveTo(b.width * 0.5, b.height * 0.7); await sleep(280); }, { x: 0, y: 0, w: Math.min(900, b.width), h: 160 });
    await sleep(900);
    const gone = await dom();
    check(gone.top === 'hidden' && !gone.side, `${kind.name}: leaving hides the toolbar`, JSON.stringify(gone));
  }
  const s2 = await snap(); check(s2.tabs.length < 30, 'tab cap', String(s2.tabs.length));
} catch (error) {
  check(false, 'run', String(error?.stack || error).slice(0, 600));
} finally {
  clearTimeout(watchdog);
  try { await fs.writeFile(path.join(OUT, 'trace.txt'), trace.join('\n')); } catch {}
  try { await fs.writeFile(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2)); } catch {}
  try { await app?.close(); } catch {}
  try { mover?.close(); } catch {}
  server.close();
  if (lock) { try { fss.unlinkSync(lock); } catch {} log('released', lock); }
  const failed = results.filter(r => !r.ok).length;
  log(`${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
}
