// Founder notes after the live preview (real app; synthetic input through sendInputEvent on the interface view, the OS cursor never moves):
//   1. chip: a tab that is still loading (a page whose response never ends), dragged out of the strip onto the page: the carried chip shows something
//      (favicon, stored icon or the live loading dots) — never an empty plate.
//   4. card: the same drag onto a cell of the "Drop on a spot" card: the cell is accent-filled within a frame of becoming the target (60 Hz crop strip).
//   2. ribbon: a split with the loading page: its ribbon runs the loading line along its bottom edge, the other ribbon has none (60 Hz crop strip).
//   3. card shape: sidebar open (pages are rounded cards), a three-pane split: own-window capture (native pages included) of every pane's top corners —
//      the ribbon's top corners rounded, the seam's outline straight (the page's corner notch shows the ribbon, not the gap).
//   node qa/r5-pane-card-chip.mjs <tag> [dark|light] [1|1.5]
// Evidence: C:/ae/r6/panepreview/evidence/<tag>/
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const root = process.cwd(), tag = process.argv[2] || 'run', THEME = process.argv[3] || 'dark', DSF = Number(process.argv[4] || 1);
const OUT = path.join('C:/ae/r6/panepreview/evidence', tag); await fs.mkdir(OUT, { recursive: true });
const PROFILES = 'C:/ae/r6/panepreview/profiles';
const results = [], log = (...a) => console.log('[qa]', ...a);
const check = (ok, label, extra) => { results.push({ ok: !!ok, label, ...(extra ? { extra } : {}) }); log(ok ? 'PASS' : 'FAIL', label); };
async function slot() { for (let i = 0; i < 40; i++) { for (const n of [1, 2, 3]) { const f = `C:/ae/slot-${n}.lock`; try { const h = await fs.open(f, 'wx'); await h.write(`r5-pane-card-chip ${tag} ${new Date().toISOString()}`); await h.close(); return f; } catch {} } await sleep(30000); } throw Error('no slot'); }
async function launch() {
  const req = createRequire(path.join(root, 'package.json')), { _electron } = req('playwright'), electronExe = req('electron');
  const profile = path.join(PROFILES, 'pc-' + Date.now()), roaming = path.join(profile, 'fixture-roaming'), local = path.join(profile, 'fixture-local');
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
  const args = [path.join(root, 'desktop/main.cjs'), '--disable-features=CalculateNativeWinOcclusion', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'];
  if (DSF !== 1) args.push(`--force-device-scale-factor=${DSF}`);
  return _electron.launch({ executablePath: electronExe, cwd: root, timeout: 40000, env, args });
}
const pages = { one: ['Alpha', '#f6e3e3'], two: ['Bravo', '#f8ecdc'], three: ['Charlie', '#e1ecfb'] }, held = [];
// /slow answers its headers and the start of a page, then never finishes: the tab keeps loading (no favicon, nothing stored).
const server = http.createServer((req, res) => {
  const k = req.url.slice(1) || 'one';
  if (k === 'slow') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.write('<!doctype html><title>Slow</title><body style="margin:0;background:#eef3ea;font:600 28px system-ui;display:grid;place-items:center;height:100vh">Still loading'); held.push(res); return; }
  if (k === 'favicon.ico') { res.writeHead(404); res.end(); return; }
  const [title, bg] = pages[k] || ['Page', '#fff']; res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(`<!doctype html><title>${title}</title><body style="margin:0;background:${bg};font:600 28px system-ui;color:#222;display:grid;place-items:center;height:100vh">${title}`);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`, UI = 'acira-browser-ui://ui/index.html';
let app, ui, lock, pointer = { x: 0, y: 0 };
const uiPage = async () => { for (let i = 0; i < 300; i++) { const p = app.context().pages().find(p => { try { return p.url() === UI; } catch { return false; } }); if (p) return p; await sleep(100); } throw Error('ui page not found'); };
const act = a => ui.evaluate(a => window.acira.dispatch(a), a);
const state = () => ui.evaluate(() => window.acira.getSnapshot());
const input = event => app.evaluate(({ webContents }, event) => { webContents.getAllWebContents().find(x => x.getURL() === 'acira-browser-ui://ui/index.html')?.sendInputEvent(event); }, event);
const mouse = (type, x, y) => input({ type, x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1, ...(type === 'mouseMove' ? { modifiers: ['leftButtonDown'] } : {}) });
const key = async k => { await input({ type: 'keyDown', keyCode: k }); await input({ type: 'keyUp', keyCode: k }); };
const box = sel => ui.evaluate(sel => { const r = document.querySelector(sel)?.getBoundingClientRect(); return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null; }, sel);
const waitFor = async (fn, label, ms = 8000) => { const end = Date.now() + ms; let v; do { v = await fn(); if (v) return v; await sleep(60); } while (Date.now() < end); throw Error('timeout ' + label); };
async function glide(x, y, steps = 14, wait = 16) { const from = pointer; for (let i = 1; i <= steps; i++) { await mouse('mouseMove', from.x + (x - from.x) * i / steps, from.y + (y - from.y) * i / steps); await sleep(wait); } pointer = { x, y }; }
/** A 60 Hz strip of one region of the interface view (capturePage, two in flight), with Date.now() stamps; stop() writes the frames. */
async function stripStart(rect) {
  await app.evaluate(({ webContents }, rect) => {
    const wc = webContents.getAllWebContents().find(x => x.getURL() === 'acira-browser-ui://ui/index.html'); globalThis.__strip = []; globalThis.__on = true;
    const worker = async () => { while (globalThis.__on && globalThis.__strip.length < 300) { try { const img = await wc.capturePage({ x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.w), height: Math.round(rect.h) }); globalThis.__strip.push({ t: Date.now(), img }); } catch { break; } } };
    void worker(); setTimeout(() => void worker(), 8);
  }, rect);
}
async function stripStop(name, accent, cellIn) {
  const frames = await app.evaluate(async ({}, [accent, cellIn]) => {
    globalThis.__on = false; await new Promise(r => setTimeout(r, 60));
    return globalThis.__strip.sort((a, b) => a.t - b.t).map(f => {
      let avg = null;
      if (cellIn) { const size = f.img.getSize(), k = size.width / cellIn.viewW, crop = f.img.crop({ x: Math.round(cellIn.x * k), y: Math.round(cellIn.y * k), width: Math.max(1, Math.round(cellIn.w * k)), height: Math.max(1, Math.round(cellIn.h * k)) }), bmp = crop.toBitmap(); let r = 0, g = 0, b = 0, n = 0; for (let i = 0; i < bmp.length; i += 4) { b += bmp[i]; g += bmp[i + 1]; r += bmp[i + 2]; n++; } avg = [r / n, g / n, b / n]; }
      return { t: f.t, jpg: f.img.toJPEG(88).toString('base64'), avg };
    });
  }, [accent, cellIn]);
  const dir = path.join(OUT, 'strip-' + name); await fs.mkdir(dir, { recursive: true });
  const t0 = frames[0]?.t ?? 0;
  for (let i = 0; i < frames.length; i++) await fs.writeFile(path.join(dir, `f${String(i).padStart(3, '0')}-${frames[i].t - t0}ms.jpg`), Buffer.from(frames[i].jpg, 'base64'));
  const gaps = frames.slice(1).map((f, i) => f.t - frames[i].t).sort((a, b) => a - b);
  log(`strip ${name}: ${frames.length} frames, median gap ${gaps[gaps.length >> 1] ?? '-'} ms`);
  return frames.map(f => ({ t: f.t, avg: f.avg }));
}
async function windowShot() {
  return app.evaluate(async ({ BaseWindow, desktopCapturer }) => { const w = BaseWindow.getAllWindows().find(x => x.isVisible()) || BaseWindow.getAllWindows()[0], [cw, ch] = w.getContentSize(); const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: cw * 2, height: ch * 2 } }); const s = sources.find(x => x.id === w.getMediaSourceId()); if (!s) return null; const size = s.thumbnail.getSize(); return { png: s.thumbnail.toPNG().toString('base64'), w: size.width, h: size.height, cw, ch, bmp: s.thumbnail.toBitmap().toString('base64') }; });
}
const px = (shot, x, y) => { const k = shot.w / shot.cw, X = Math.round(x * k), Y = Math.round(y * k), buf = Buffer.from(shot.bmp, 'base64'), i = (Y * shot.w + X) * 4; return [buf[i + 2], buf[i + 1], buf[i]]; };
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

try {
  lock = await slot(); log('slot', lock);
  app = await launch(); ui = await uiPage(); await ui.waitForLoadState('domcontentloaded');
  const W = DSF === 1 ? 1640 : 1240, H = DSF === 1 ? 960 : 720;
  await app.evaluate(({ BaseWindow }, [w, h]) => { for (const win of BaseWindow.getAllWindows()) if (win.isVisible()) { win.setContentSize(w, h); win.setPosition(30, 20); } }, [W, H]);
  const skip = ui.getByRole('button', { name: 'Skip setup' }); await skip.first().waitFor({ timeout: 20000 }).catch(() => {}); if (await skip.count()) await skip.first().click({ timeout: 5000 }).catch(() => {});
  await sleep(1800); ui = await uiPage();
  const done = ui.getByRole('button', { name: /^Done$/ }); if (await done.count()) { await done.first().click().catch(() => {}); await sleep(700); }
  await act({ type: 'settings.update', patch: { appearance: THEME, verticalTabs: false, interfaceScale: 100 } }); await sleep(900);
  const first = (await state()).activeTabId; await act({ type: 'tab.navigate', tabId: first, url: base + 'one' });
  for (const n of ['two', 'three']) await act({ type: 'tab.new', url: base + n, background: true });
  await act({ type: 'tab.new', url: base + 'slow', background: true });
  await waitFor(async () => (await state()).tabs.length === 4, 'four tabs'); await sleep(1500);
  const tabs = (await state()).tabs, slow = tabs.find(t => t.url.includes('/slow')), [one, two, three] = tabs.filter(t => t !== slow).map(t => t.id);
  check(slow?.loading === true, `the slow tab is still loading (loading ${slow?.loading})`);
  const accent = await ui.evaluate(() => { const p = document.createElement('span'); p.className = 'split-picker-highlight'; document.querySelector('.app').append(p); const c = getComputedStyle(p).backgroundColor; p.remove(); const srgb = c.startsWith('color('), m = c.replace(/^color\(srgb/, '').match(/[\d.]+/g).map(Number); return m.slice(0, 3).map(v => srgb ? Math.round(v * 255) : v); });

  // ---- 1 + 4: the loading tab dragged out of the strip, then onto a cell of the layout card.
  const tabBox = await waitFor(() => box(`.browser-tab[data-tab-id="${slow.id}"], .acira-compact-tab[data-tab-id="${slow.id}"]`), 'slow tab in the strip');
  const area = await box('.page-area');
  pointer = { x: tabBox.x + tabBox.w / 2, y: tabBox.y + tabBox.h / 2 };
  await input({ type: 'mouseMove', x: Math.round(pointer.x), y: Math.round(pointer.y) }); await sleep(60); await mouse('mouseDown', pointer.x, pointer.y); await sleep(60);
  await glide(pointer.x, pointer.y + 40, 6, 20); await glide(area.x + area.w * .3, area.y + area.h * .6, 18, 18); await sleep(450);
  const chip = await ui.evaluate(() => { const n = [...document.querySelectorAll('.tab-drag-preview')].at(-1); if (!n) return null; const r = n.getBoundingClientRect(), loader = n.querySelector('.chip-icon-loader canvas'), img = n.querySelector('img'), svg = n.querySelector('svg'), blankCanvas = [...n.querySelectorAll('canvas')].some(c => !c.closest('.chip-icon-loader'));
    let lit = 0; if (loader) { const d = loader.getContext('2d')?.getImageData(0, 0, loader.width, loader.height).data; if (d) for (let i = 3; i < d.length; i += 4) if (d[i] > 40) lit++; }
    return { x: r.x, y: r.y, w: r.width, h: r.height, kind: loader ? 'loader' : img ? 'picture' : svg ? 'glyph' : 'none', lit, blankCanvas, chipP: n.style.getPropertyValue('--chip-p') }; });
  log('chip', JSON.stringify(chip));
  check(chip && chip.kind !== 'none' && !chip.blankCanvas && (chip.kind !== 'loader' || chip.lit > 0), `the loading tab's chip shows something (${chip?.kind}, ${chip?.lit} lit dots, blank canvas ${chip?.blankCanvas})`);
  if (chip) { const b64 = await app.evaluate(async ({ webContents }, r) => { const wc = webContents.getAllWebContents().find(x => x.getURL() === 'acira-browser-ui://ui/index.html'); return (await wc.capturePage({ x: Math.max(0, Math.round(r.x - 60)), y: Math.max(0, Math.round(r.y - 60)), width: 160, height: 160 })).toPNG().toString('base64'); }, chip); await fs.writeFile(path.join(OUT, 'chip-loading-tab.png'), Buffer.from(b64, 'base64')); }
  // The card: rise into it, then onto its first cell.
  const card = await waitFor(() => box('.split-picker-card'), 'layout card', 5000).catch(() => null);
  if (card) {
    const cellBox = await box('.split-picker-card .split-picker-cell'), viewW = await ui.evaluate(() => innerWidth);
    await stripStart({ x: card.x - 20, y: card.y - 20, w: card.w + 40, h: card.h + 60 });
    const inCrop = { x: cellBox.x - (card.x - 20) + cellBox.w * .3, y: cellBox.y - (card.y - 20) + cellBox.h * .3, w: cellBox.w * .4, h: cellBox.h * .4, viewW: card.w + 40 };
    await ui.evaluate(() => { globalThis.__hoverAt = 0; const tick = () => { if (!globalThis.__hoverAt && document.querySelector('.split-picker-cell[data-hover]')) globalThis.__hoverAt = Date.now(); if (!globalThis.__hoverAt) requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
    await glide(cellBox.x - 30, cellBox.y + cellBox.h + 40, 10, 18); await glide(cellBox.x + cellBox.w / 2, cellBox.y + cellBox.h / 2, 12, 18); await sleep(500);
    const hoverAt = await ui.evaluate(() => globalThis.__hoverAt);
    const frames = await stripStop('card-cell', accent, inCrop);
    // capturePage returns the last composited frame: the first frame after the target changed that differs from the one before it is the first new picture.
    const before = [...frames].reverse().find(f => f.t <= hoverAt), after = frames.filter(f => f.t > hoverAt), firstAfter = after.find(f => before && f.avg && dist(f.avg, before.avg) > 4), settled = after.at(-1);
    // The light highlight is the accent at 88% over the card: compare with the accent loosely and with the settled lit cell closely.
    const near = f => f && f.avg && dist(f.avg, accent) < 60 && (!settled?.avg || dist(f.avg, settled.avg) < 40);
    await fs.writeFile(path.join(OUT, 'card-cell-timeline.json'), JSON.stringify({ hoverAt: hoverAt - (frames[0]?.t ?? 0), frames: frames.map(f => ({ t: f.t - (frames[0]?.t ?? 0), avg: f.avg?.map(Math.round) })) }));
    check(hoverAt > 0 && near(firstAfter) && near(settled) && firstAfter.t - hoverAt < 120, `the targeted cell goes straight to the accent fill, no partial frames (first new frame +${firstAfter ? firstAfter.t - hoverAt : '?'} ms: rgb ${firstAfter?.avg?.map(v => Math.round(v)).join(',')} vs accent ${accent.join(',')}; settled ${settled?.avg?.map(v => Math.round(v)).join(',')})`);
  } else check(false, 'the layout card came down');
  await key('Escape'); await sleep(300); await mouse('mouseUp', pointer.x, pointer.y); await sleep(600);

  // ---- 2: the loading pane's ribbon.
  await act({ type: 'tab.select', id: one }); await act({ type: 'split.open', tabIds: [one, slow.id], layout: 'columns' });
  await waitFor(async () => (await ui.evaluate(() => document.querySelectorAll('.split-pages [data-pane]').length)) === 2, 'split of two'); await sleep(900);
  const ribbons = await ui.evaluate(() => [...document.querySelectorAll('.split-pages [data-pane]')].map(n => { const l = n.querySelector('.split-label'), c = l?.querySelector('.navigation-progress'), r = l.getBoundingClientRect(); return { pane: n.dataset.pane, active: c?.dataset.active ?? null, x: r.x, y: r.y, w: r.width, h: r.height }; }));
  const slowRibbon = ribbons.find(r => r.pane === slow.id), otherRibbon = ribbons.find(r => r.pane !== slow.id);
  check(slowRibbon?.active === 'true' && otherRibbon?.active !== 'true', `only the loading pane's ribbon runs the loading line (loading ${slowRibbon?.active}, other ${otherRibbon?.active})`);
  await stripStart({ x: slowRibbon.x, y: slowRibbon.y, w: slowRibbon.w, h: slowRibbon.h + 10 }); await sleep(1400); await stripStop('ribbon-loading');
  for (const res of held.splice(0)) { try { res.end('</body>'); } catch {} }
  await sleep(1600);
  const stopped = await ui.evaluate(id => document.querySelector(`.split-pages [data-pane="${id}"] .navigation-progress`)?.dataset.active ?? null, slow.id);
  check(stopped !== 'true', `the line goes when the page stops loading (${stopped})`);

  // ---- 3: one card per pane (sidebar open: pages are rounded cards).
  await act({ type: 'settings.update', patch: { verticalTabs: true } }); await act({ type: 'ui.update', patch: { workspaceOpen: true, webWorkspaceOpen: true } }).catch(() => {});
  await act({ type: 'split.open', tabIds: [one, two, three], layout: 'three-columns' }); await sleep(2200);
  const geo = await ui.evaluate(() => { const pages = document.querySelector('.split-pages'), r = parseFloat(getComputedStyle(pages).getPropertyValue('--pane-radius')) || 0; return { radius: r, panes: [...document.querySelectorAll('.split-pages [data-pane]')].map(n => { const b = n.getBoundingClientRect(), l = n.querySelector('.split-label'), lb = l.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, ribbonBottom: lb.bottom, ribbonRadius: parseFloat(getComputedStyle(l).borderTopLeftRadius) || 0, ribbonBottomRadius: parseFloat(getComputedStyle(l).borderBottomLeftRadius) || 0 }; }) }; });
  check(geo.radius > 0 && geo.panes.every(p => Math.abs(p.ribbonRadius - geo.radius) < .5 && p.ribbonBottomRadius === 0), `ribbons: top corners ${geo.panes.map(p => p.ribbonRadius).join('/')} px = the page radius ${geo.radius} px, bottoms square`);
  const shot = await windowShot();
  if (shot) {
    await fs.writeFile(path.join(OUT, 'window-panes.png'), Buffer.from(shot.png, 'base64'));
    const rows = geo.panes.map(p => { const seam = px(shot, p.x + 1.5, p.ribbonBottom + 1.5), ribbon = px(shot, p.x + 1.5, p.ribbonBottom - 6), gap = px(shot, p.x - 3, p.ribbonBottom + 1.5); return { seam, ribbon, gap, toRibbon: Math.round(dist(seam, ribbon)), toGap: Math.round(dist(seam, gap)) }; });
    log('seam corners', JSON.stringify(rows.map(r => ({ toRibbon: r.toRibbon, toGap: r.toGap }))));
    check(rows.every(r => r.toRibbon <= r.toGap), `every pane's top-left seam corner shows the ribbon, not the gap (ribbon Δ ${rows.map(r => r.toRibbon).join('/')}, gap Δ ${rows.map(r => r.toGap).join('/')})`);
    // Crops of each pane's top corners and bottom-left corner, at window resolution.
    const crops = await app.evaluate(async ({ nativeImage }, [png, panes, cw, w]) => { const img = nativeImage.createFromBuffer(Buffer.from(png, 'base64')), k = w / cw; return panes.flatMap(p => [[p.x - 12, p.ribbonBottom - 30], [p.x + p.w - 48, p.ribbonBottom - 30], [p.x - 12, p.y + p.h - 48]].map(([x, y]) => img.crop({ x: Math.max(0, Math.round(x * k)), y: Math.max(0, Math.round(y * k)), width: Math.round(60 * k), height: Math.round(60 * k) }).resize({ width: 240 }).toPNG().toString('base64'))); }, [shot.png, geo.panes, shot.cw, shot.w]);
    for (let i = 0; i < crops.length; i++) await fs.writeFile(path.join(OUT, `corner-${['tl', 'tr', 'bl'][i % 3]}-pane${Math.floor(i / 3) + 1}.png`), Buffer.from(crops[i], 'base64'));
  } else check(false, 'own-window capture');
} catch (error) {
  check(false, 'script error: ' + (error?.stack || error));
} finally {
  for (const res of held) { try { res.end(); } catch {} }
  try { await app?.close(); } catch {}
  try { server.close(); } catch {}
  if (lock) await fs.unlink(lock).catch(() => {});
  await fs.writeFile(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1));
  const failed = results.filter(r => !r.ok); log(`${results.length - failed.length}/${results.length} passed`); for (const f of failed) log('  FAILED:', f.label);
  process.exit(failed.length ? 1 : 0);
}
