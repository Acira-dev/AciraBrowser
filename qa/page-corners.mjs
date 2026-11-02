// Page corners on real composited pixels (R7): the design is
//   sidebar closed (or no sidebar)  -> the page is SQUARE under the raised toolbar (all four corners square, flush to the window)
//   sidebar open                    -> the toolbar sits on the frame and the page is a 4-corner ROUNDED card
// A WebContentsView has one radius for all four corners, so every state is measured, not assumed. One isolated Acira, shown
// INACTIVE (never focused, no OS cursor) on a chosen display, a solid magenta local page in the tab, and Windows Graphics Capture
// of that one window (ffmpeg gfxcapture=hwnd: the composited window incl. native clips, nothing else on screen). Per state and
// corner it measures the notch profile (how many px of the page are missing at each of the first rows next to the corner) and
// writes an 10x contact sheet of the four corners plus a downscaled window shot.
//   node qa/page-corners.mjs [outDir]
// Env: PC_DISPLAY=<index in screen.getAllDisplays()> (default: the first non-primary one), PC_ONLY=<regex on state name>,
//      PC_SCALES=100,150 (interface scale), PC_THEME=dark|light, PC_LANG=en|de.
// State name = <tabs>-<sidebar>-<view>-<scale>[-<theme>]. Exit 1 when a state differs from the design.
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {startApp, sleep, httpFixture} from './d-harness.mjs';
import {withSlot} from './native-slot.mjs';

const FFMPEG = process.env.FFMPEG || 'C:/Users/you/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-8.1.2-full_build/bin/ffmpeg.exe';
const OUT = path.resolve(process.argv[2] || 'C:/ae/r7/page-corners'); await fs.mkdir(OUT, {recursive: true});
const ONLY = process.env.PC_ONLY ? new RegExp(process.env.PC_ONLY) : null;
const SCALES = (process.env.PC_SCALES || '100,150').split(',').map(Number), THEME = process.env.PC_THEME || 'dark', LANG = process.env.PC_LANG || 'en';
const log = (...a) => console.log('[page-corners]', ...a);

// tabs: h = horizontal strip, v = vertical (sidebar column); sidebar: open | closed | none (horizontal has none)
const states = [];
for (const scale of SCALES) for (const view of ['full', 'compact', 'seamless']) {
  states.push({tabs: 'h', sidebar: 'none', view, scale});
  states.push({tabs: 'v', sidebar: 'closed', view, scale});
  states.push({tabs: 'v', sidebar: 'open', view, scale});
}
// Other things that sit around the page: the bookmarks bar, a split view (two panes: the outer corners of the pair are measured).
for (const scale of SCALES) for (const extra of ['bm', 'split']) for (const [tabs, sidebar] of [['h', 'none'], ['v', 'closed'], ['v', 'open']]) states.push({tabs, sidebar, view: 'full', scale, extra});
const nameOf = s => `${s.tabs}-${s.sidebar}-${s.view}${s.extra ? '+' + s.extra : ''}-${s.scale}-${THEME}${LANG === 'en' ? '' : '-' + LANG}`;
// What the design asks of a state: the page's four corners all square, or all four rounded (radius in CSS px, 0 = square).
const wants = s => s.view === 'seamless' ? 'round' : s.sidebar === 'open' ? 'round' : 'square';

const results = [];
await withSlot('page-corners', async () => {
  const page = await httpFixture((q, r) => { r.setHeader('content-type', 'text/html'); r.end('<!doctype html><title>corners</title><body style="margin:0;background:#ff00ff"></body>'); });
  let app;
  const watchdog = setTimeout(() => { log('watchdog: closing'); void app?.close().catch(() => {}); }, 12 * 60_000); watchdog.unref();
  try {
    app = await startApp({root: `.qa-profiles/page-corners-${Date.now()}`});
    const display = await app.main(({screen}, want) => {
      const all = screen.getAllDisplays(), primary = screen.getPrimaryDisplay();
      const d = (want !== '' && all[Number(want)]) || all.find(x => x.id !== primary.id) || primary;
      return {x: d.workArea.x, y: d.workArea.y, w: d.workArea.width, h: d.workArea.height, scale: d.scaleFactor, count: all.length};
    }, process.env.PC_DISPLAY ?? '');
    log('display', JSON.stringify(display));
    const bounds = {x: display.x + 60, y: display.y + 40, width: 1200, height: 800};
    await app.main(({BaseWindow}, b) => { const w = BaseWindow.getAllWindows()[0]; w.setBounds(b); w.setBounds(b); if (!w.isVisible()) w.showInactive(); }, bounds);
    await app.act({type: 'settings.update', patch: {style: 'acira', appearance: THEME, language: LANG === 'en' ? 'en' : LANG, sidebarWidth: 240, bookmarksBar: false}});
    await app.act({type: 'tab.new', url: `http://127.0.0.1:${page.port}/`}); await sleep(1200);
    const hwnd = await app.main(({BaseWindow}) => String(BaseWindow.getAllWindows()[0].getNativeWindowHandle().readBigUInt64LE(0)));
    for (const s of states) {
      const name = nameOf(s);
      if (ONLY && !ONLY.test(name)) continue;
      await app.act({type: 'settings.update', patch: {interfaceScale: s.scale, verticalTabs: s.tabs === 'v', windowView: s.view, bookmarksBar: s.extra === 'bm'}});
      if (s.extra === 'split') {
        const web = (await app.state()).tabs.filter(t => /^http:\/\/127\.0\.0\.1/.test(t.url)).map(t => t.id);
        if (web.length < 2) { await app.act({type: 'tab.new', url: `http://127.0.0.1:${page.port}/`}); await sleep(900); }
        const ids = (await app.state()).tabs.filter(t => /^http:\/\/127\.0\.0\.1/.test(t.url)).map(t => t.id).slice(0, 2);
        await app.act({type: 'split.open', tabIds: ids});
      }
      await app.act({type: 'ui.update', patch: {workspaceOpen: s.sidebar === 'open', webWorkspaceOpen: s.sidebar === 'open'}});
      await app.main(({BaseWindow}, b) => { const w = BaseWindow.getAllWindows()[0]; w.setBounds(b); }, bounds);
      await sleep(1800);
      const file = path.join(OUT, name + '.wgc.png');
      // WGC of the window (ffmpeg gfxcapture) when it answers; a window that is not changing can stay silent, then desktopCapturer's window
      // source (the same window only, by its media source id) does the same job.
      try { execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `gfxcapture=hwnd=${hwnd}:capture_cursor=0:max_framerate=30`, '-vf', 'hwdownload,format=bgra', '-frames:v', '1', '-update', '1', file], {timeout: 12000}); }
      catch {
        log('wgc silent, desktopCapturer window source for', name);
        const saved = await app.main(async ({BaseWindow, desktopCapturer, screen}, a) => {
          const w = BaseWindow.getAllWindows()[0], b = w.getBounds(), sf = screen.getDisplayMatching(b).scaleFactor;
          const sources = await desktopCapturer.getSources({types: ['window'], thumbnailSize: {width: Math.round(b.width * sf), height: Math.round(b.height * sf)}});
          const mine = sources.find(x => x.id === w.getMediaSourceId());
          if (!mine || mine.thumbnail.isEmpty()) return false;
          process.mainModule.require('node:fs').writeFileSync(a.file, mine.thumbnail.toPNG()); return true;
        }, {file});
        if (!saved) throw new Error('no window capture for ' + name);
      }
      const m = await app.main(async ({}, a) => {
        const {nativeImage} = process.mainModule.require('electron'), fsx = process.mainModule.require('node:fs');
        const img = nativeImage.createFromPath(a.file), {width: W, height: H} = img.getSize(), bmp = img.toBitmap();
        const magenta = (x, y) => { const i = (y * W + x) * 4, b = bmp[i], g = bmp[i + 1], r = bmp[i + 2]; return r > 200 && b > 200 && g < 70; };
        let minX = W, minY = H, maxX = -1, maxY = -1;
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (magenta(x, y)) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
        if (maxX < 0) return {error: 'no page pixels', W, H};
        // A corner's notch profile: for each of the first R rows (columns) from the corner, how far in the first page pixel is.
        const R = 30, corner = (cx, cy, dx, dy) => { const out = []; for (let i = 0; i < R; i++) { let n = 0; const y = cy + dy * i; if (y < 0 || y >= H) break; while (n < R * 2 && !magenta(cx + dx * n, y)) n++; out.push(n); } return out; };
        const corners = {tl: corner(minX, minY, 1, 1), tr: corner(maxX, minY, -1, 1), bl: corner(minX, maxY, 1, -1), br: corner(maxX, maxY, -1, -1)};
        // Contact sheet: 40x40 px around each corner (outside + inside), 10x nearest.
        const Z = 10, S = 40;
        const pts = {tl: [minX - 12, minY - 12], tr: [maxX - 27, minY - 12], bl: [minX - 12, maxY - 27], br: [maxX - 27, maxY - 27]};
        const SW = S * Z * 4, SH = S * Z;
        const tiles = Object.values(pts);
        const sheetBuf = Buffer.alloc(SW * SH * 4);
        tiles.forEach(([ox, oy], t) => { for (let y = 0; y < S * Z; y++) for (let x = 0; x < S * Z; x++) { const sx = Math.min(W - 1, Math.max(0, ox + Math.floor(x / Z))), sy = Math.min(H - 1, Math.max(0, oy + Math.floor(y / Z))), si = (sy * W + sx) * 4, di = (y * SW + t * S * Z + x) * 4; sheetBuf[di] = bmp[si]; sheetBuf[di + 1] = bmp[si + 1]; sheetBuf[di + 2] = bmp[si + 2]; sheetBuf[di + 3] = 255; } });
        fsx.writeFileSync(a.corners, nativeImage.createFromBitmap(sheetBuf, {width: SW, height: SH}).toPNG());
        const small = img.resize({width: Math.round(W / 2)});
        fsx.writeFileSync(a.shot, small.toPNG());
        // The colour just outside each top corner (the toolbar or the frame) and the colour of the page's own frame margin.
        const px = (x, y) => { x = Math.max(0, Math.min(W - 1, x)); y = Math.max(0, Math.min(H - 1, y)); const i = (y * W + x) * 4; return [bmp[i + 2], bmp[i + 1], bmp[i]]; };
        return {W, H, rect: {minX, minY, maxX, maxY}, corners, around: {above: px(minX + 40, minY - 3), left: px(minX - 3, minY + 40), tlOuter: px(minX, minY - 2), trOuter: px(maxX, minY - 2)}};
      }, {file, corners: path.join(OUT, name + '.corners.png'), shot: path.join(OUT, name + '.png')});
      await fs.rm(file, {force: true});
      if (s.extra === 'split') await app.act({type: 'split.close'});
      if (m.error) { results.push({name, pass: false, error: m.error}); log('FAIL', name, m.error); continue; }
      const depth = p => p[0], want = wants(s);
      const radius = {tl: depth(m.corners.tl), tr: depth(m.corners.tr), bl: depth(m.corners.bl), br: depth(m.corners.br)};
      const expectRound = Math.round(8 * s.scale / 100 * display.scale);
      const okAt = d => want === 'square' ? d <= 1 : Math.abs(d - expectRound) <= Math.max(3, expectRound * .35);
      const bad = Object.entries(radius).filter(([, d]) => !okAt(d)).map(([c, d]) => `${c}=${d}px`);
      const pass = !bad.length; results.push({name, want, radius, expectRound, rect: m.rect, pass, bad});
      log(pass ? 'PASS' : 'DIFF', name, `want ${want}${want === 'round' ? ' ~' + expectRound + 'px' : ''}`, 'notch tl/tr/bl/br', Object.values(radius).join('/'), 'page', JSON.stringify(m.rect), pass ? '' : 'off: ' + bad.join(' '));
    }
  } finally {
    clearTimeout(watchdog); try { await app?.close(); } catch {} await page.close();
  }
});
await fs.writeFile(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1));
const off = results.filter(r => !r.pass);
log(`${results.length - off.length}/${results.length} match the design; evidence ${OUT}`);
process.exit(off.length ? 1 : 0);
