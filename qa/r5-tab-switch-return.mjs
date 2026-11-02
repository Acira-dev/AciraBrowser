// R5 (founder: "when I switch between tabs the page is completely empty, though YouTube is open and playing; it only appears after I
// open and close the sidebar"). The coordinator's probe (qa/r5-tab-switch-blank.mjs) never caught it with settled switches. This one
// widens it: a website, the new tab page and a second website, in the founder's setup (dark Burgundy, glass, sidebar tabs with the
// sidebar closed, Full view), maximized on the primary monitor when R5_MAX=1, switched in the ways a person switches quickly:
//   return   website -> new tab page -> the same website, the second switch G ms after the first (Ctrl+Tab tapped twice)
//   ctrltab  the same through real Ctrl+Tab key presses (synthetic input to the page, never the real cursor or keyboard)
//   newclose website -> Ctrl+T -> Ctrl+W G ms later (a new tab opened and closed at once)
//   pageup   website -> Ctrl+PageDown to the new tab page -> Ctrl+PageUp back, G ms apart
//   ctrlnum  Ctrl+2 to the new tab page, Ctrl+1 back, G ms apart
//   sidebar  open the sidebar, pick the new tab page, pick the website G ms later, close the sidebar
//   settled  the coordinator's order with long gaps (web / new tab / web), as a regression check
//   safety   the safety net alone: the active view hidden, squashed or put under the interface directly, then a restore/focus (R5_GAPS=0,1,2)
// After each trial the website's own colour must be in the middle of the page area, and its native view shown with the page's bounds.
// Usage (repo root): node qa/r5-tab-switch-return.mjs [tag]   env R5_MAX=1, R5_MODES=return,ctrltab,..., R5_GAPS=20,40,60,90,130, R5_REPS=2
// One native slot (C:\ae\slot-N.lock, wx), isolated profile, evidence under C:\ae\r5\stale\<tag>. Logs main's [views] lines (ACIRA_QA_VIEW_LOG=1).
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { launchPreparedNative } from './prepared-native.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const tag = process.argv[2] || 'run';
const MODES = (process.env.R5_MODES || 'return,ctrltab,newclose,pageup,settled').split(',').filter(Boolean);
const GAPS = (process.env.R5_GAPS || '20,40,60,90,130').split(',').map(Number).filter(n => n >= 0);
const REPS = Math.max(1, Math.min(4, Number(process.env.R5_REPS || 2)));
const ROOT = path.join('C:/ae/r5/stale', tag), OUT = path.join(ROOT, 'evidence'); await fs.mkdir(OUT, { recursive: true });
const log = (...a) => console.log(`[return ${tag}]`, ...a);

async function takeSlot() {
  for (let i = 0; i < 40; i++) {
    for (const n of [1, 2, 3]) { const f = `C:/ae/slot-${n}.lock`; try { const h = await fs.open(f, 'wx'); await h.writeFile(`r5-return ${new Date().toISOString()}\n`); await h.close(); return f; } catch {} }
    log('all slots busy, waiting 30s'); await sleep(30000);
  }
  throw Error('no slot');
}

function tone() {
  const rate = 22050, n = rate, data = Buffer.alloc(44 + n * 2);
  data.write('RIFF', 0); data.writeUInt32LE(36 + n * 2, 4); data.write('WAVEfmt ', 8); data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(rate, 24); data.writeUInt32LE(rate * 2, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) data.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 440 * i / rate) * 3000), 44 + i * 2);
  return data;
}
const wav = tone();
const page = (title, bg, audio = false) => `<!doctype html><title>${title}</title><body style="margin:0;font:16px system-ui;background:${bg}"><div style="padding:24px 32px"><h1>${title}</h1>${audio ? '<audio src="/tone.wav" autoplay loop></audio>' : ''}${Array.from({ length: 30 }, (_, i) => `<p>Line ${i + 1}</p>`).join('')}</div>`;
const COLORS = { music: [0xd8, 0xf0, 0xd8], two: [0xe3, 0xed, 0xf7] };
const server = http.createServer((req, res) => {
  if (req.url === '/tone.wav') { res.setHeader('content-type', 'audio/wav'); return res.end(wav); }
  res.setHeader('content-type', 'text/html'); res.end(req.url.slice(1) === 'music' ? page('Music', '#d8f0d8', true) : page('Website Two', '#e3edf7'));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

let app, lock;
const results = [], viewLines = [];
try {
  lock = await takeSlot(); log('slot', lock);
  const dirs = { data: path.resolve(`.qa-profiles/r5-return-${tag}-${Date.now()}`), appdata: path.join(ROOT, `appdata-${Date.now()}`), local: path.join(ROOT, `local-${Date.now()}`) };
  for (const d of Object.values(dirs)) await fs.mkdir(d, { recursive: true });
  app = await launchPreparedNative({
    executablePath: createRequire(import.meta.url)('electron'),
    args: [path.resolve(process.env.R5_MAIN || 'desktop/main.cjs')],
    env: { ...process.env, ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: dirs.data, APPDATA: dirs.appdata, LOCALAPPDATA: dirs.local, ACIRA_BROWSER_TEST_HIDDEN: '', ACIRA_QA_VIEW_LOG: '1' },
    timeout: 60000,
  });
  app.process().stdout?.on('data', chunk => { for (const line of String(chunk).split(/\r?\n/)) if (line.includes('[views]')) viewLines.push(`${Date.now()} ${line}`); });
  const pickUi = async () => { for (let i = 0; i < 300; i++) { for (const p of app.windows()) { try { if (p.url() === 'acira-browser-ui://ui/index.html') return p; } catch {} } await sleep(100); } throw Error('ui page not found'); };
  let ui = await pickUi();
  // Shown without taking focus, so nothing the founder types lands in it.
  await app.evaluate(({ BaseWindow, screen }, max) => {
    const w = BaseWindow.getAllWindows().sort((a, b) => b.getBounds().width - a.getBounds().width)[0];
    if (max) { const d = screen.getPrimaryDisplay().workArea; w.setBounds({ x: d.x + 40, y: d.y + 40, width: 1280, height: 820 }); w.showInactive(); w.maximize(); }
    else { w.setBounds({ x: 80, y: 60, width: 1280, height: 820 }); w.showInactive(); }
  }, process.env.R5_MAX === '1');
  try { await ui.getByRole('button', { name: 'Skip setup', exact: true }).click({ timeout: 15000 }); } catch {}
  await sleep(1200); ui = await pickUi();
  try { await ui.getByRole('button', { name: 'Done', exact: true }).click({ timeout: 2500 }); } catch {}
  const act = a => ui.evaluate(a => window.acira.dispatch(a), a);
  const snap = () => ui.evaluate(() => window.acira.getSnapshot());
  await act({ type: 'settings.update', patch: { style: 'acira', appearance: 'dark', colorPreset: 'Burgundy', accentColor: '#4d1821', browserTint: '#4d1821', glassOpacity: 64, reducedTransparency: false, verticalTabs: true, windowView: 'full', reducedMotion: false } });
  await act({ type: 'ui.update', patch: { workspaceOpen: false, webWorkspaceOpen: false } });
  await sleep(800);
  const first = (await snap()).tabs.map(t => t.id);
  await act({ type: 'tab.new', url: base + 'music' }); await sleep(2000);
  const musicId = (await snap()).activeTabId;
  await act({ type: 'tab.new', url: 'acira://new' }); await sleep(1500);
  const newId = (await snap()).activeTabId;
  for (const id of first) if (id !== musicId && id !== newId) await act({ type: 'tab.close', id });
  await sleep(600);
  await act({ type: 'tab.select', id: musicId }); await sleep(1200);
  log('tabs', JSON.stringify((await snap()).tabs.map(t => [t.id === musicId ? 'music' : t.id === newId ? 'newtab' : t.id, t.url.slice(0, 40)])));

  const frame = () => app.evaluate(async ({ BaseWindow, desktopCapturer }, musicUrl) => {
    const w = BaseWindow.getAllWindows().find(x => x.isVisible()), [cw, ch] = w.getContentSize();
    const kids = w.contentView.children;
    const views = kids.map((v, i) => ({ i, b: v.getBounds(), vis: v.getVisible(), url: v.webContents?.getURL?.().slice(0, 50) || '' }));
    const music = views.find(v => v.url.startsWith(musicUrl));
    const src = (await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: cw, height: ch } })).find(x => x.id === w.getMediaSourceId());
    if (!src) return { views, music };
    const img = src.thumbnail, size = img.getSize(), bmp = img.toBitmap();
    const at = (x, y) => { const i = (Math.round(y) * size.width + Math.round(x)) * 4; return [bmp[i + 2], bmp[i + 1], bmp[i]]; };
    const mid = music ? at((music.b.x + music.b.width * 0.6) * size.width / cw, (music.b.y + music.b.height * 0.55) * size.height / ch) : at(size.width * 0.6, size.height * 0.55);
    return { png: img.toPNG().toString('base64'), mid, views, music };
  }, base + 'music');
  const near = (a, b) => a && b && Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) < 30;
  // Synthetic keys straight to the page's renderer (main's before-input-event sees them as typed), never the OS keyboard.
  const key = (keyCode, modifiers) => app.evaluate(({ webContents }, { keyCode, modifiers, musicUrl }) => {
    const wc = webContents.getAllWebContents().find(c => !c.isDestroyed() && c.getURL().startsWith(musicUrl)) || webContents.getFocusedWebContents();
    const target = webContents.getFocusedWebContents() || wc;
    target.sendInputEvent({ type: 'keyDown', keyCode, modifiers }); target.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
    return target.getURL().slice(0, 40);
  }, { keyCode, modifiers, musicUrl: base + 'music' });

  // record: the window itself at 60 Hz (Windows Graphics Capture through ffmpeg's gfxcapture: occlusion-proof, never the screen), over
  // settled switches, quick returns and Ctrl+Tab taps. Each frame's page-area sample is the website, the new tab page, the plain page-area
  // background (an empty page) or a blend (the dissolve). Passing: no run of empty frames longer than one frame.
  async function record() {
    const FFMPEG = 'C:/Users/you/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-8.1.2-full_build/bin/ffmpeg.exe';
    const { spawn } = await import('node:child_process');
    const W = 96, H = 54, grid = [];
    for (let gx = 0.35; gx <= 0.91; gx += 0.08) for (let gy = 0.3; gy <= 0.86; gy += 0.08) grid.push([gx, gy]);
    const sampleAt = async () => app.evaluate(async ({ BaseWindow, desktopCapturer }, grid) => {
      const w = BaseWindow.getAllWindows().find(x => x.isVisible()), [cw, ch] = w.getSize();
      const src = (await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: cw, height: ch } })).find(x => x.id === w.getMediaSourceId());
      const img = src.thumbnail, size = img.getSize(), bmp = img.toBitmap();
      return grid.map(([fx, fy]) => { const i = (Math.round(fy * size.height) * size.width + Math.round(fx * size.width)) * 4; return [bmp[i + 2], bmp[i + 1], bmp[i]]; });
    }, grid);
    const dist = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
    const atMusic = await sampleAt();
    await act({ type: 'tab.select', id: newId }); await sleep(1500);
    const atNew = await sampleAt();
    await act({ type: 'tab.select', id: musicId }); await sleep(1200);
    const BG = [43, 24, 26];
    let pick = -1, best = -1;
    grid.forEach((_, i) => { if (dist(atMusic[i], COLORS.music) < 30) { const score = Math.min(dist(atNew[i], BG), dist(atNew[i], COLORS.music)); if (score > best) { best = score; pick = i; } } });
    if (pick < 0) { log('record: no sample point shows the website'); return; }
    const [fx, fy] = grid[pick], ntp = atNew[pick];
    log('record sample', grid[pick].map(v => v.toFixed(2)).join(','), 'website', JSON.stringify(atMusic[pick]), 'new tab', JSON.stringify(ntp), 'distance new tab to empty', best);
    const hwnd = await app.evaluate(({ BaseWindow }) => { const b = BaseWindow.getAllWindows().find(x => x.isVisible()).getNativeWindowHandle(); return b.length >= 8 ? String(b.readBigUInt64LE(0)) : String(b.readUInt32LE(0)); });
    const mp4 = path.join(OUT, 'switches-60hz.mp4');
    const ff = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `gfxcapture=hwnd=${hwnd}:capture_cursor=0:max_framerate=60`, '-filter_complex', `[0:v]hwdownload,format=bgra,fps=60,split=2[a][b];[a]scale=${W}:${H}:flags=area,format=rgb24[s];[b]format=yuv420p[v]`, '-map', '[s]', '-f', 'rawvideo', 'pipe:1', '-map', '[v]', '-c:v', 'libx264', '-preset', 'ultrafast', '-y', mp4], { stdio: ['pipe', 'pipe', 'pipe'] });
    const frames = [], marks = []; let pending = Buffer.alloc(0), t0 = 0;
    ff.stdout.on('data', chunk => { if (!t0) t0 = Date.now(); pending = Buffer.concat([pending, chunk]); while (pending.length >= W * H * 3) { const f = pending.subarray(0, W * H * 3); pending = pending.subarray(W * H * 3); const x = Math.round(fx * (W - 1)), y = Math.round(fy * (H - 1)), i = (y * W + x) * 3; frames.push([f[i], f[i + 1], f[i + 2]]); } });
    let ffErr = ''; ff.stderr.on('data', c => { ffErr += c; });
    try {
      // Windows Graphics Capture delivers a frame only when the window changes, so a still window gives none yet: give the capture time to start.
      await sleep(1500);
      if (ffErr) throw Error('gfxcapture: ' + ffErr.slice(0, 200));
      const mark = label => marks.push({ label, frame: frames.length });
      for (let r = 0; r < 3; r++) { mark('to new tab'); await act({ type: 'tab.select', id: newId }); await sleep(600); mark('to website'); await act({ type: 'tab.select', id: musicId }); await sleep(600); }
      for (const gap of [20, 40, 70]) { mark(`quick return ${gap}ms`); await act({ type: 'tab.select', id: newId }); await sleep(gap); await act({ type: 'tab.select', id: musicId }); await sleep(800); }
      for (const gap of [30, 60]) { mark(`ctrl+tab x2 ${gap}ms`); await key('Tab', ['control']); await sleep(gap); await key('Tab', ['control']); await sleep(800); }
      mark('end'); await sleep(300);
    } finally { try { ff.stdin.write('q'); } catch {} await new Promise(r => { ff.on('exit', r); setTimeout(() => { try { ff.kill(); } catch {} r(); }, 4000); }); }
    const cls = frames.map(c => dist(c, COLORS.music) < 36 ? 'W' : dist(c, ntp) < 24 ? 'N' : dist(c, BG) < 18 ? '_' : '~');
    let longest = 0, run = 0; for (const c of cls) { run = c === '_' ? run + 1 : 0; longest = Math.max(longest, run); }
    // The end state of every return must be the website.
    const ends = marks.slice(0, -1).map((m, i) => ({ label: m.label, last: cls[Math.max(m.frame, marks[i + 1].frame - 2)] }));
    const strip = marks.slice(0, -1).map((m, i) => `${m.label.padEnd(20)} ${cls.slice(m.frame, marks[i + 1].frame).join('')}`).join('\n');
    await fs.writeFile(path.join(OUT, 'switches-60hz-strip.txt'), `W website  N new tab page  _ empty page area  ~ blend (dissolve)\n${strip}\n`);
    const wrongEnds = ends.filter(e => e.label.startsWith('to website') || e.label.startsWith('quick') || e.label.startsWith('ctrl')).filter(e => e.last !== 'W');
    log(`record: ${frames.length} frames, longest empty run ${longest} frame(s), returns not ending on the website ${wrongEnds.length}`, wrongEnds.length ? JSON.stringify(wrongEnds) : '');
    log('strip written', path.join(OUT, 'switches-60hz-strip.txt'), 'video', mp4);
    results.push({ mode: 'record', frames: frames.length, longestEmpty: longest, wrongEnds, ok: longest <= 1 && !wrongEnds.length });
  }

  let blanks = 0, n = 0;
  const check = async (mode, gap, rep) => {
    await sleep(700);
    const s = await snap(), f = await frame(); n++;
    const active = s.activeTabId === musicId;
    const ok = !active || (f.music?.vis && near(f.mid, COLORS.music));
    results.push({ mode, gap, rep, active, ok, vis: f.music?.vis, bounds: f.music?.b, mid: f.mid });
    if (!ok) {
      blanks++;
      log('BLANK', mode, 'gap', gap, 'rep', rep, 'music view', JSON.stringify(f.music), 'mid', JSON.stringify(f.mid));
      if (f.png) await fs.writeFile(path.join(OUT, `blank-${blanks}-${mode}-${gap}.png`), Buffer.from(f.png, 'base64'));
      await sleep(1500); const later = await frame(); log('  1.5 s later', later.music?.vis && near(later.mid, COLORS.music) ? 'shown' : 'still blank', JSON.stringify(later.music));
    }
    if (!active) log('note', mode, gap, 'ended on', s.activeTabId === newId ? 'newtab' : s.activeTabId);
    // Back to the website, settled, for the next trial.
    if (s.activeTabId !== musicId) await act({ type: 'tab.select', id: musicId });
    await sleep(900);
  };
  if (MODES.includes('record')) { try { await record(); } catch (error) { log('record failed', error.message); results.push({ mode: 'record', ok: false, error: error.message }); } }
  for (const mode of MODES.filter(m => m !== 'record')) {
    for (const gap of mode === 'settled' ? [700, 250, 1200] : GAPS) {
      for (let rep = 0; rep < REPS; rep++) {
        if (mode === 'return') { await act({ type: 'tab.select', id: newId }); await sleep(gap); await act({ type: 'tab.select', id: musicId }); }
        else if (mode === 'ctrltab') { await key('Tab', ['control']); await sleep(gap); await key('Tab', ['control']); }
        else if (mode === 'pageup') { await key('PageDown', ['control']); await sleep(gap); await key('PageUp', ['control']); }
        else if (mode === 'safety') {
          // The safety net, alone: the active page's view is broken directly (hidden, squashed to nothing, or put under the interface),
          // then the window reports a restore or focus. Main must put it right by itself within ~300 ms.
          const how = ['hidden', 'zero bounds', 'under interface'][gap % 3];
          await app.evaluate(({ BaseWindow }, { how, musicUrl }) => {
            const w = BaseWindow.getAllWindows().find(x => x.isVisible()), kids = w.contentView.children;
            const page = kids.find(v => v.webContents?.getURL?.().startsWith(musicUrl)), ui = kids.find(v => v.webContents?.getURL?.() === 'acira-browser-ui://ui/index.html');
            if (how === 'hidden') page.setVisible(false); else if (how === 'zero bounds') page.setBounds({ x: 0, y: 0, width: 0, height: 0 }); else w.contentView.addChildView(ui, kids.indexOf(page) + 1);
            w.emit(how === 'hidden' ? 'restore' : 'focus');
          }, { how, musicUrl: base + 'music' });
        }
        else if (mode === 'ctrlnum') { await key('2', ['control']); await sleep(gap); await key('1', ['control']); }
        else if (mode === 'sidebar') { await act({ type: 'ui.update', patch: { workspaceOpen: true } }); await sleep(400); await act({ type: 'tab.select', id: newId }); await sleep(gap); await act({ type: 'tab.select', id: musicId }); await sleep(250); await act({ type: 'ui.update', patch: { workspaceOpen: false } }); }
        else if (mode === 'newclose') {
          await act({ type: 'tab.new' }); await sleep(gap);
          const s = await snap(); if (s.activeTabId !== musicId && s.activeTabId !== newId) await act({ type: 'tab.close', id: s.activeTabId });
        } else if (mode === 'settled') { await act({ type: 'tab.select', id: newId }); await sleep(gap); await act({ type: 'tab.select', id: musicId }); }
        await check(mode, gap, rep);
      }
    }
  }
  log(`trials ${n}, blank ${blanks}`);
  const byMode = {}; for (const r of results) { const k = r.mode; byMode[k] ||= { trials: 0, blank: 0 }; byMode[k].trials++; if (!r.ok) byMode[k].blank++; }
  log('by mode', JSON.stringify(byMode));
  await fs.writeFile(path.join(ROOT, 'results.json'), JSON.stringify({ results, byMode }, null, 1));
  await fs.writeFile(path.join(ROOT, 'views.log'), viewLines.join('\n'));
} finally {
  try { await app?.close(); } catch {}
  server.close();
  if (lock) { try { await fs.unlink(lock); log('released', lock); } catch {} }
}
