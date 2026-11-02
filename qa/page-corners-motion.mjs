// Page corners while the sidebar opens and closes (R7): a Windows Graphics Capture recording of the one test window (ffmpeg
// gfxcapture=hwnd, 60 fps) while the sidebar is opened, then closed; every frame is measured the way qa/page-corners.mjs does it
// (the solid magenta page's bounding box and the notch profile of its four corners). The page's corners must follow the design in
// every frame, not only at rest: square corners stay square, a card's four corners stay four.
//   node qa/page-corners-motion.mjs [outDir]       env PC_DISPLAY, PC_SCALE=100|150, PC_VIEW=full|compact|seamless, PC_FRAMES=<n frames to keep as 8x sheets>
// Prints, per transition, one row per distinct frame: time, page box, notch tl/tr/bl/br (px) and the extent (rows) of each corner.
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {startApp, sleep, httpFixture} from './d-harness.mjs';
import {withSlot} from './native-slot.mjs';

const FFMPEG = process.env.FFMPEG || 'C:/Users/you/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-8.1.2-full_build/bin/ffmpeg.exe';
const OUT = path.resolve(process.argv[2] || 'C:/ae/r7/page-corners-motion'); await fs.mkdir(OUT, {recursive: true});
const SCALE = Number(process.env.PC_SCALE || 150), VIEW = process.env.PC_VIEW || 'full';
const log = (...a) => console.log('[corners-motion]', ...a);

await withSlot('page-corners-motion', async () => {
  const page = await httpFixture((q, r) => { r.setHeader('content-type', 'text/html'); r.end('<!doctype html><title>corners</title><body style="margin:0;background:#ff00ff"></body>'); });
  let app;
  const watchdog = setTimeout(() => { log('watchdog: closing'); void app?.close().catch(() => {}); }, 8 * 60_000); watchdog.unref();
  try {
    app = await startApp({root: `.qa-profiles/page-corners-motion-${Date.now()}`});
    const display = await app.main(({screen}, want) => { const all = screen.getAllDisplays(), primary = screen.getPrimaryDisplay(); const d = (want !== '' && all[Number(want)]) || all.find(x => x.id !== primary.id) || primary; return {x: d.workArea.x, y: d.workArea.y, scale: d.scaleFactor}; }, process.env.PC_DISPLAY ?? '');
    const bounds = {x: display.x + 60, y: display.y + 40, width: 1200, height: 800};
    await app.main(({BaseWindow}, b) => { const w = BaseWindow.getAllWindows()[0]; w.setBounds(b); w.setBounds(b); if (!w.isVisible()) w.showInactive(); }, bounds);
    await app.act({type: 'settings.update', patch: {style: 'acira', appearance: 'dark', sidebarWidth: 240, bookmarksBar: false, interfaceScale: SCALE, verticalTabs: true, windowView: VIEW}});
    await app.act({type: 'ui.update', patch: {workspaceOpen: false, webWorkspaceOpen: false}});
    await app.act({type: 'tab.new', url: `http://127.0.0.1:${page.port}/`}); await sleep(1500);
    const hwnd = await app.main(({BaseWindow}) => String(BaseWindow.getAllWindows()[0].getNativeWindowHandle().readBigUInt64LE(0)));
    for (const step of ['open', 'close']) {
      const dir = path.join(OUT, `${VIEW}-${SCALE}-${step}`); await fs.rm(dir, {recursive: true, force: true}); await fs.mkdir(dir, {recursive: true});
      const rec = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `gfxcapture=hwnd=${hwnd}:capture_cursor=0:max_framerate=60`, '-vf', 'hwdownload,format=bgra', '-t', '1.6', '-vsync', '0', path.join(dir, 'f%03d.png')], {stdio: 'ignore'});
      await sleep(900);
      await app.act({type: 'ui.update', patch: {workspaceOpen: step === 'open', webWorkspaceOpen: step === 'open'}});
      await new Promise(r => rec.on('exit', r)); await sleep(300);
      const files = (await fs.readdir(dir)).filter(f => f.endsWith('.png')).sort();
      const rows = await app.main(async ({}, a) => {
        const {nativeImage} = process.mainModule.require('electron'), fsx = process.mainModule.require('node:fs'), out = [];
        let prev = '';
        for (const [n, f] of a.files.entries()) {
          const img = nativeImage.createFromPath(a.dir + '/' + f), {width: W, height: H} = img.getSize(), bmp = img.toBitmap();
          const mag = (x, y) => { const i = (y * W + x) * 4; return bmp[i + 2] > 200 && bmp[i] > 200 && bmp[i + 1] < 70; };
          let minX = W, minY = H, maxX = -1, maxY = -1;
          for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) if (mag(x, y)) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
          if (maxX < 0) { out.push(`${f} no page`); continue; }
          const R = 30, prof = (cx, cy, dx, dy) => { const p = []; for (let i = 0; i < R; i++) { const y = cy + dy * i; if (y < 0 || y >= H) break; let k = 0; while (k < R * 2 && !mag(cx + dx * k, y)) k++; p.push(k); } return p; };
          const c = {tl: prof(minX, minY, 1, 1), tr: prof(maxX, minY, -1, 1), bl: prof(minX, maxY, 1, -1), br: prof(maxX, maxY, -1, -1)};
          const ext = p => p.filter(v => v > 0).length;
          const row = `${f} box ${minX},${minY}-${maxX},${maxY} notch ${c.tl[0]}/${c.tr[0]}/${c.bl[0]}/${c.br[0]} extent ${ext(c.tl)}/${ext(c.tr)}/${ext(c.bl)}/${ext(c.br)}`;
          const key = row.slice(row.indexOf(' box'));
          if (key !== prev) out.push(row); prev = key;
        }
        return out;
      }, {dir, files});
      log(step, files.length, 'frames, distinct:'); for (const r of rows) log('  ' + r);
    }
  } finally { clearTimeout(watchdog); try { await app?.close(); } catch {} await page.close(); }
});
