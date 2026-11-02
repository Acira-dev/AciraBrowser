// Sidebar ↔ toolbar colour match on real composited pixels (founder P0, 27 Oct: "the sidebar and the toolbar don't match
// colors"). Launches one isolated Acira, maximized on the display with the asked scale, applies each case live (appearance,
// finish, glass, sidebar, window view), keeps the window ACTIVE (focused, so Windows keeps the acrylic) or makes it inactive
// with a tiny helper window, captures the SCREEN (desktopCapturer screen source: what DWM really composited, acrylic included)
// and compares the sidebar and the toolbar at the same height with CIEDE2000.
//   node qa/colour-frame-match.mjs <label> [100|150] [founder|matrix]
// Env: COLOUR_OUT (default C:/ae/r5/colour/evidence). Takes a native slot (C:\ae\slot-N.lock, wx) and frees it in finally.
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {startApp, sleep} from './d-harness.mjs';
const FFMPEG = process.env.FFMPEG || 'C:/Users/you/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-8.1.2-full_build/bin/ffmpeg.exe';
const CAPTURE = process.env.COLOUR_CAPTURE || 'wgc';

const T0 = Date.now();
const label = process.argv[2] || 'run', scale = Number(process.argv[3] || 100), mode = process.argv[4] || 'founder';
const OUT = path.join(process.env.COLOUR_OUT || 'C:/ae/r5/colour/evidence', `${label}-${scale}`); await fs.mkdir(OUT, {recursive: true});

const finishes = {
  Burgundy: {colorPreset: 'Burgundy', accentColor: '#4d1821', browserTint: '#4d1821'},
  Porcelain: {colorPreset: 'Porcelain', accentColor: '#1769c2', browserTint: '#f8fbff'},
  Silver: {colorPreset: 'Silver', accentColor: '#3d6e9c', browserTint: '#f7f7f7'},
};
const founder = {appearance: 'dark', finish: 'Burgundy', glass: 64, sidebar: true, view: 'full', active: true};
const cases = [];
if (mode === 'founder') cases.push(founder, {...founder, active: false});
else if (mode === 'states') for (const view of ['full', 'compact', 'seamless']) cases.push({...founder, view}, {...founder, view, sidebar: false}, {...founder, view, sidebar: false, peek: true});
// matrix: the sidebar docked open or peeking from the left edge (closed has no sidebar to compare; 'states' records it). COLOUR_LITE=1:
// glass 64 and an active window only (the 150% pass).
else { const lite = !!process.env.COLOUR_LITE; for (const appearance of ['dark', 'light']) for (const finish of Object.keys(finishes)) for (const glass of lite ? [64] : [64, 100]) for (const view of ['full', 'compact', 'seamless']) for (const peek of [false, true]) for (const active of lite ? [true] : [true, false]) cases.push({appearance, finish, glass, sidebar: !peek, peek, view, active}); }

// CIEDE2000 between two sRGB triplets.
const lab = ([r, g, b]) => {
  const lin = c => { c /= 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; };
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const f = t => t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116;
  const x = f((R * .4124 + G * .3576 + B * .1805) / .95047), y = f(R * .2126 + G * .7152 + B * .0722), z = f((R * .0193 + G * .1192 + B * .9505) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
};
export function deltaE2000(c1, c2) {
  const [L1, a1, b1] = lab(c1), [L2, a2, b2] = lab(c2), rad = Math.PI / 180;
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2), Cm = (C1 + C2) / 2, G = .5 * (1 - Math.sqrt(Cm ** 7 / (Cm ** 7 + 25 ** 7)));
  const ap1 = a1 * (1 + G), ap2 = a2 * (1 + G), Cp1 = Math.hypot(ap1, b1), Cp2 = Math.hypot(ap2, b2);
  const h = (b, a) => { const v = Math.atan2(b, a) / rad; return v < 0 ? v + 360 : v; };
  const hp1 = h(b1, ap1), hp2 = h(b2, ap2), dL = L2 - L1, dC = Cp2 - Cp1;
  let dh = hp2 - hp1; if (Cp1 * Cp2 === 0) dh = 0; else if (dh > 180) dh -= 360; else if (dh < -180) dh += 360;
  const dH = 2 * Math.sqrt(Cp1 * Cp2) * Math.sin(dh / 2 * rad), Lm = (L1 + L2) / 2, Cpm = (Cp1 + Cp2) / 2;
  let hm = hp1 + hp2; if (Cp1 * Cp2 !== 0) hm = Math.abs(hp1 - hp2) > 180 ? (hp1 + hp2 + (hp1 + hp2 < 360 ? 360 : -360)) / 2 : (hp1 + hp2) / 2;
  const T = 1 - .17 * Math.cos((hm - 30) * rad) + .24 * Math.cos(2 * hm * rad) + .32 * Math.cos((3 * hm + 6) * rad) - .2 * Math.cos((4 * hm - 63) * rad);
  const SL = 1 + .015 * (Lm - 50) ** 2 / Math.sqrt(20 + (Lm - 50) ** 2), SC = 1 + .045 * Cpm, SH = 1 + .015 * Cpm * T;
  const RT = -2 * Math.sqrt(Cpm ** 7 / (Cpm ** 7 + 25 ** 7)) * Math.sin(60 * Math.exp(-(((hm - 275) / 25) ** 2)) * rad);
  return Math.sqrt((dL / SL) ** 2 + (dC / SC) ** 2 + (dH / SH) ** 2 + RT * (dC / SC) * (dH / SH));
}

async function takeSlot(name) {
  for (let i = 0; i < 40; i++) {
    for (const n of [1, 2, 3]) {
      try { const h = await fs.open(`C:/ae/slot-${n}.lock`, 'wx'); await h.write(`${name} ${new Date().toISOString()}`); await h.close(); return () => fs.rm(`C:/ae/slot-${n}.lock`, {force: true}); }
      catch (e) { if (e.code !== 'EEXIST') throw e; }
    }
    await sleep(30000);
  }
  throw new Error('no native slot free');
}

// COLOUR_ONLY=<regex>: run only the cases whose name matches (keeps one run under the slot's 10 minutes).
const caseName = c => `${c.appearance}-${c.finish}-g${c.glass}-${c.view}-${c.sidebar ? 'open' : c.peek ? 'peek' : 'closed'}-${c.active ? 'active' : 'inactive'}`;
if (process.env.COLOUR_ONLY) { const only = new RegExp(process.env.COLOUR_ONLY); for (let i = cases.length - 1; i >= 0; i--) if (!only.test(caseName(cases[i]))) cases.splice(i, 1); }
const release = await takeSlot(`colour-frame-match ${label} ${scale}`);
let app; const rows = [];
try {
  app = await startApp({root: `.qa-profiles/colour-${label}-${scale}`, env: {ACIRA_BROWSER_TEST_HIDDEN: '0'}});
  try { const done = app.ui.getByRole('button', {name: 'Done'}); if (await done.count()) await done.first().click({timeout: 2000}); } catch {}
  const placed = await app.main(({BaseWindow, screen}, want) => {
    const w = BaseWindow.getAllWindows()[0], displays = screen.getAllDisplays();
    const d = displays.find(x => Math.round(x.scaleFactor * 100) === want) || screen.getPrimaryDisplay();
    w.unmaximize(); w.setBounds({...d.workArea, width: 1200, height: 800}); w.setBounds({...d.workArea, width: 1200, height: 800}); w.maximize(); w.show(); w.focus();
    return {displays: displays.map(x => ({id: x.id, bounds: x.bounds, scale: x.scaleFactor})), used: d.id, scale: d.scaleFactor};
  }, scale);
  console.log('displays', JSON.stringify(placed));
  await app.act({type: 'settings.update', patch: {style: 'acira', verticalTabs: true, sidebarWidth: 240, interfaceScale: 100}});
  await app.act({type: 'tab.new'}); await sleep(800);
  const hwnd = await app.main(({BaseWindow}) => String(BaseWindow.getAllWindows()[0].getNativeWindowHandle().readBigUInt64LE(0)));
  for (const c of cases) {
    const name = caseName(c);
    await app.act({type: 'settings.update', patch: {appearance: c.appearance, ...finishes[c.finish], glassOpacity: c.glass, windowView: c.view}});
    await app.act({type: 'ui.update', patch: {workspaceOpen: c.sidebar, webWorkspaceOpen: c.sidebar}});
    // The left-edge peek is main's (edge-reveal.cjs, 'chrome-edge'); send its event as the pointer would, no real cursor.
    await sleep(500);
    await app.main(({webContents}, side) => { const ui = webContents.getAllWebContents().find(w => w.getURL() === 'acira-browser-ui://ui/index.html'); ui.send('acira:browser-event', {type: 'chrome-edge', top: false, side, pinned: {top: false, side: false}}); }, !!c.peek);
    await app.main(({BaseWindow, BrowserWindow}, active) => {
      const w = BaseWindow.getAllWindows().find(x => !x.__colourHelper);
      globalThis.__colourHelper?.destroy?.(); globalThis.__colourHelper = null;
      if (active) { w.focus(); w.moveTop(); return; }
      const b = w.getBounds(), h = new BrowserWindow({x: b.x + b.width - 260, y: b.y + b.height - 140, width: 240, height: 120, frame: false, skipTaskbar: true, backgroundColor: '#808080', show: false});
      h.__colourHelper = true; globalThis.__colourHelper = h; h.show(); h.focus();
    }, c.active);
    await sleep(1300);
    const dom = await app.ui.evaluate(() => {
      const r = el => { if (!el) return null; const b = el.getBoundingClientRect(); return b.width && b.height ? {x: b.left, y: b.top, w: b.width, h: b.height} : null; };
      const rail = document.querySelector('.app > .ed-rail.is-expanded'), tb = document.querySelector('.browser-shell > .browser-toolbar.acira-persistent-toolbar');
      const chain = el => { const out = []; for (let e = el; e && e !== document.documentElement; e = e.parentElement) { const s = getComputedStyle(e); out.push(`${e.tagName.toLowerCase()}.${[...e.classList].slice(0, 3).join('.')} bg=${s.backgroundColor} img=${s.backgroundImage.slice(0, 90)}`); } return out; };
      return {dpr: devicePixelRatio, rail: r(rail), railClass: rail?.className, toolbar: r(tb), page: r(document.querySelector('.page-area')), active: document.documentElement.dataset.windowActive, material: document.documentElement.dataset.material,
        toolbarChain: chain(tb), railChain: rail ? chain(rail).slice(0, 2) : []};
    });
    let wgc = null;
    if (CAPTURE === 'wgc') { wgc = path.join(OUT, name + '.wgc.png'); execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `gfxcapture=hwnd=${hwnd}:capture_cursor=0:max_framerate=30`, '-vf', 'hwdownload,format=bgra', '-frames:v', '1', '-update', '1', wgc], {timeout: 20000}); }
    const shot = await app.main(async ({BaseWindow, desktopCapturer, screen}, dom) => {
      const w = BaseWindow.getAllWindows().find(x => !x.__colourHelper), cb = w.getContentBounds(), d = screen.getDisplayMatching(cb), sf = d.scaleFactor;
      let img, ox, oy, k;
      if (dom.wgc) {
        // Windows Graphics Capture of the window itself (occlusion-proof; DWM's composition of the window incl. its backdrop).
        img = process.mainModule.require('electron').nativeImage.createFromPath(dom.wgc); k = sf;
        const size = img.getSize(), wb = w.getBounds(); ox = Math.round((size.width - cb.width * sf) / 2); oy = Math.round((size.height - cb.height * sf) / 2);
        if (wb.width === cb.width && wb.height === cb.height) { ox = Math.max(0, ox); oy = Math.max(0, oy); }
      } else {
        w.setAlwaysOnTop(true, 'screen-saver'); w.moveTop(); await new Promise(r => setTimeout(r, 400));
        const sources = await desktopCapturer.getSources({types: ['screen'], thumbnailSize: {width: Math.round(d.size.width * sf), height: Math.round(d.size.height * sf)}});
        w.setAlwaysOnTop(false);
        const src = sources.find(s => String(s.display_id) === String(d.id)) || sources[0];
        img = src.thumbnail; k = img.getSize().width / d.bounds.width; ox = Math.round((cb.x - d.bounds.x) * k); oy = Math.round((cb.y - d.bounds.y) * k);
      }
      const size = img.getSize(), px = dom.dpr * (k / sf);
      const win = {x: Math.max(0, ox), y: Math.max(0, oy), width: Math.min(size.width - Math.max(0, ox), Math.round(cb.width * k)), height: Math.min(size.height - Math.max(0, oy), Math.round(cb.height * k))};
      const crop = img.crop(win), bmp = crop.toBitmap(), cw = crop.getSize().width, ch = crop.getSize().height;
      const median = (x0, y0, x1, y1) => {
        const R = [], G = [], B = [], A = [];
        for (let y = Math.max(0, Math.round(y0)); y < Math.min(ch, Math.round(y1)); y++) for (let x = Math.max(0, Math.round(x0)); x < Math.min(cw, Math.round(x1)); x++) { const i = (y * cw + x) * 4; B.push(bmp[i]); G.push(bmp[i + 1]); R.push(bmp[i + 2]); A.push(bmp[i + 3]); }
        const m = a => a.length ? a.sort((p, q) => p - q)[a.length >> 1] : null; return R.length ? [m(R), m(G), m(B), m(A)] : null;
      };
      const out = {};
      const tb = dom.toolbar, rail = dom.rail;
      // Same height for both: a band 3–6 css px under the toolbar's top edge (above every control), and the toolbar's mid line
      // in the gaps (median ignores the sparse icons).
      // 8–11 px under the top (inside a floating sidebar card's 6 px margin too) and 5–8 px above the toolbar's bottom, 12 px in from
      // the sides (clear of a floating card's corners).
      if (tb) { out.toolbarTop = median((tb.x + 12) * px, (tb.y + 8) * px, (tb.x + Math.min(tb.w, 220)) * px, (tb.y + 11) * px); out.toolbarBottom = median((tb.x + 12) * px, (tb.y + tb.h - 8) * px, (tb.x + Math.min(tb.w, 220)) * px, (tb.y + tb.h - 5) * px); }
      if (rail && tb) { out.sidebarTop = median((rail.x + 12) * px, (tb.y + 8) * px, (rail.x + rail.w - 12) * px, (tb.y + 11) * px); out.sidebarBottom = median((rail.x + 12) * px, (tb.y + tb.h - 8) * px, (rail.x + rail.w - 12) * px, (tb.y + tb.h - 5) * px); }
      const fs = process.mainModule.require('fs');
      fs.writeFileSync(dom.file, crop.toPNG());
      const jx = rail ? Math.max(0, (rail.x + rail.w - 140) * px) : 0, jy = 0, jw = Math.min(cw - jx, 520 * px), jh = Math.min(ch, ((tb ? tb.y + tb.h : 60) + 40) * px);
      fs.writeFileSync(dom.file.replace(/\.png$/, '.junction.png'), crop.crop({x: Math.round(jx), y: jy, width: Math.round(jw), height: Math.round(jh)}).toPNG());
      return {samples: out, sf, k, px, size, win};
    }, {...dom, wgc, file: path.join(OUT, name + '.png')});
    if (wgc) await fs.rm(wgc, {force: true});
    const s = shot.samples, dTop = s.sidebarTop && s.toolbarTop ? deltaE2000(s.sidebarTop, s.toolbarTop) : null, dBottom = s.sidebarBottom && s.toolbarBottom ? deltaE2000(s.sidebarBottom, s.toolbarBottom) : null;
    const row = {name, ...c, windowActive: dom.active, material: dom.material, sidebarTop: s.sidebarTop, toolbarTop: s.toolbarTop, sidebarBottom: s.sidebarBottom, toolbarBottom: s.toolbarBottom, dE: dTop == null ? null : +Math.max(dTop, dBottom ?? 0).toFixed(2)};
    rows.push(row); await fs.writeFile(path.join(OUT, 'results.json'), JSON.stringify(rows, null, 1));
    if (c === cases[0]) console.log('capture', CAPTURE, JSON.stringify({size: shot.size, win: shot.win, px: shot.px}));
    console.log(`${name}: dE ${row.dE ?? 'n/a (no sidebar)'}  sidebar ${JSON.stringify(s.sidebarTop)} toolbar ${JSON.stringify(s.toolbarTop)}  [active=${dom.active}]`);
    if (mode !== 'matrix' && process.env.COLOUR_CHAIN) console.log('toolbar chain:\n  ' + dom.toolbarChain.join('\n  ') + '\nrail: ' + dom.railChain.join(' | ') + '\nrail class: ' + dom.railClass);
  }
} finally {
  try { await app?.main(() => { globalThis.__colourHelper?.destroy?.(); }); } catch {}
  await app?.close(); await release();
}
await fs.writeFile(path.join(OUT, 'results.json'), JSON.stringify(rows, null, 1));
const measured = rows.filter(r => r.dE != null), worst = measured.reduce((a, b) => b.dE > a.dE ? b : a, {dE: 0});
console.log(`${Math.round((Date.now() - T0) / 1000)} s; ${measured.length} cases with both surfaces; worst dE ${worst.dE} (${worst.name || '-'}); over 2: ${measured.filter(r => r.dE > 2).length}`);
