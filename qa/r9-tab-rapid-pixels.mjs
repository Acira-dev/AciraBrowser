// Rapid tab add/close in the sidebar judged on real window pixels (Windows Graphics Capture of the focused-look window).
//   node qa/native-slot.mjs r9-pixels -- node qa/r9-tab-rapid-pixels.mjs [outDir]
// RP_TABS=3|23  RP_MODE=dock|compact|seamless  RP_CASE=add-key|add-click|close-click|close-key|close-mid  RP_APP=<main.cjs of another checkout>
// Output: <out>/<case>.mkv, <case>.png (contact sheet of the sidebar, one tile per distinct frame) and a per-frame motion line.
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn, spawnSync} from 'node:child_process';
import {startApp, httpFixture, sleep} from './d-harness.mjs';
const FFMPEG = process.env.FFMPEG || 'C:/Users/you/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-8.1.2-full_build/bin/ffmpeg.exe';
const OUT = path.resolve(process.argv[2] || 'C:/ae/r9/tab-rapid'); await fs.mkdir(OUT, {recursive: true});
const TABS = Number(process.env.RP_TABS || 23), MODE = process.env.RP_MODE || 'dock', LABEL = process.env.RP_LABEL || 'now';
const CASES = (process.env.RP_CASE || 'add-key,add-click,close-click,close-key,close-mid').split(',');
const log = (...a) => console.log('[tab-rapid]', ...a);
const fx = await httpFixture((q, r) => { r.setHeader('content-type', 'text/html'); r.end(`<!doctype html><title>Page ${q.url.slice(1)} with a longer tab title</title><body style="font:16px system-ui;margin:40px">${'<p>Lorem ipsum dolor sit amet. '.repeat(80)}`); });
const root = '.qa-profiles/r9-pixels'; await fs.rm(root, {recursive: true, force: true});
const app = await startApp({root, ...(process.env.RP_APP ? {main: process.env.RP_APP} : {}), env: {}});
const watchdog = setTimeout(() => { log('watchdog'); void app.close(); }, 8 * 60_000); watchdog.unref();
try {
  const display = await app.main(({screen}) => { const d = screen.getPrimaryDisplay(); return {x: d.workArea.x, y: d.workArea.y, w: d.workArea.width, h: d.workArea.height, scale: d.scaleFactor}; });
  const bounds = {x: display.x + 40, y: display.y + 20, width: Math.min(1280, display.w - 60), height: Math.min(860, display.h - 40)};
  await app.main(({BaseWindow}, b) => { const w = BaseWindow.getAllWindows()[0]; w.setBounds(b); w.setBounds(b); if (!w.isVisible()) w.showInactive(); }, bounds);
  const compact = MODE !== 'dock';
  await app.act({type: 'settings.update', patch: {style: 'acira', appearance: 'dark', sidebarWidth: 240, bookmarksBar: false, verticalTabs: true, reducedMotion: false, animationSpeed: 'premium', ...(compact ? {windowView: MODE} : {})}});
  if (compact) { await sleep(900); await app.ui.evaluate(() => [...document.querySelectorAll('.sidebar-toggle-control')].find(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.left >= 0 && r.left < innerWidth; })?.click()); await sleep(900); }
  const hwnd = await app.main(({BaseWindow}) => String(BaseWindow.getAllWindows()[0].getNativeWindowHandle().readBigUInt64LE(0)));
  await app.ui.evaluate(() => { const d = document.documentElement.dataset; d.windowActive = 'true'; d.desktopMaterial = d.material === 'acrylic' && d.systemTransparency !== 'off' ? 'ready' : 'unavailable'; });
  const reset = async () => { // exactly TABS tabs, the first one open
    let s = await app.state(); for (const t of s.tabs.slice(1)) await app.act({type: 'tab.close', id: t.id}); await sleep(400);
    for (let i = 1; i < TABS; i++) { await app.act({type: 'tab.new', url: `http://127.0.0.1:${fx.port}/t${i}`, background: true}); await sleep(60); }
    s = await app.state(); await app.act({type: 'tab.select', id: s.tabs[0].id}); await sleep(1500);
  };
  const keys = (k, n, gap) => app.main(async ({webContents}, [k, n, gap]) => {
    const wc = webContents.getAllWebContents().find(w => w.getURL().startsWith('acira-browser-ui://ui/index.html') && !w.getURL().includes('view='));
    for (let i = 0; i < n; i++) { for (const type of ['rawKeyDown', 'char', 'keyUp']) wc.sendInputEvent({type, keyCode: k, modifiers: ['control']}); await new Promise(r => setTimeout(r, gap)); }
  }, [k, n, gap]);
  const mouse = (steps) => app.main(async ({webContents}, steps) => {
    const wc = webContents.getAllWebContents().find(w => w.getURL().startsWith('acira-browser-ui://ui/index.html') && !w.getURL().includes('view='));
    for (const s of steps) { if (s.wait) { await new Promise(r => setTimeout(r, s.wait)); continue; } wc.sendInputEvent({type: s.type, x: s.x, y: s.y, button: s.button || 'left', clickCount: 1}); }
  }, steps);
  const rect = sel => app.ui.evaluate(sel => { const n = document.querySelector(sel); if (!n) return null; const r = n.getBoundingClientRect(); return {x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), w: r.width, h: r.height, left: r.left, right: r.right}; }, sel);
  const clicks = (x, y, n, gap, button = 'left') => { const out = [{type: 'mouseMove', x, y}, {wait: 50}]; for (let i = 0; i < n; i++) out.push({type: 'mouseDown', x, y, button}, {type: 'mouseUp', x, y, button}, {wait: gap}); return out; };
  let sidebar = null; for (let i = 0; i < 60 && !(sidebar?.w > 100); i++) { await sleep(150); sidebar = await app.ui.evaluate(() => { const r = document.querySelector('.acira-sidebar')?.getBoundingClientRect(); return r ? {x: r.x, y: r.y, w: r.width, h: r.height} : null; }); }
  log('mode', MODE, 'sidebar', JSON.stringify(sidebar));
  for (const name of CASES) {
    await reset();
    const file = path.join(OUT, `${LABEL}-${MODE}-${TABS}-${name}.mkv`), s = display.scale;
    const rec = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `gfxcapture=hwnd=${hwnd}:capture_cursor=1:max_framerate=240`, '-vf', 'hwdownload,format=bgra,format=yuv420p', '-fps_mode', 'passthrough', '-c:v', 'h264_nvenc', '-preset', 'p1', '-tune', 'ull', '-rc', 'constqp', '-qp', '16', '-t', '3.2', file], {stdio: ['pipe', 'ignore', 'pipe']});
    let exited = false; rec.on('exit', () => { exited = true; }); rec.stderr.on('data', d => log('ffmpeg', String(d).slice(0, 200)));
    await sleep(1000);
    if (name === 'add-key') await keys('T', 8, 45);
    else if (name === 'add-click') { const r = await rect('.acira-sidebar .sb-new-tab'); await mouse(clicks(r.x, r.y, 8, 45)); }
    else if (name === 'close-click') { const row = await rect('.acira-sidebar [data-zone=tabs] .sb-tab:nth-child(2)') || await rect('.acira-sidebar [data-zone=tabs] .sb-tab'); const close = await rect('.acira-sidebar [data-zone=tabs] .sb-tab .sb-tab-close'); await mouse(clicks(close.x, close.y, 8, 90)); }
    else if (name === 'close-key') { await keys('W', 8, 45); }
    else if (name === 'close-mid') { const r = await rect('.acira-sidebar [data-zone=tabs] .sb-tab'); await mouse(clicks(r.x - 20, r.y, 8, 90, 'middle')); }
    for (let i = 0; i < 60 && !exited; i++) await sleep(50);
    // The capture only delivers frames when the window changes: after the burst it stalls, so end it the polite way (q) to finalize the file.
    if (!exited) { try { rec.stdin.write('q'); } catch {} for (let i = 0; i < 60 && !exited; i++) await sleep(50); }
    if (!exited) spawn('taskkill', ['/PID', String(rec.pid), '/T', '/F'], {stdio: 'ignore'});
    // Contact sheet of the sidebar: every distinct frame after the first change, 12 per row.
    const crop = `crop=${Math.round((sidebar.w + 12) * s)}:${Math.round(Math.min(sidebar.h, 520) * s)}:${Math.round(Math.max(0, sidebar.x - 4) * s)}:${Math.round(sidebar.y * s)}`;
    const sheet = file.replace(/\.mkv$/, '.png');
    const r = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-i', file, '-vf', `${crop},mpdecimate=hi=64*40:lo=64*12:frac=0.15,scale=iw/2:ih/2,tile=14x4`, '-frames:v', '1', sheet], {encoding: 'utf8'});
    const probe = spawnSync(FFMPEG, ['-hide_banner', '-i', file, '-vf', 'showinfo', '-f', 'null', '-'], {encoding: 'utf8'}); const n = (probe.stderr.match(/n:\s*\d+/g) || []).length;
    log(name, 'frames', n, 'sheet', sheet, r.stderr.slice(0, 200));
    const st = await app.state(); log(name, 'tabs now', st.tabs.length);
  }
} finally { clearTimeout(watchdog); await app.close(); await fx.close(); }
