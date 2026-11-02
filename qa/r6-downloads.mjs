// Round 6, downloads lane: real downloads in an isolated profile, then the sidebar button, the popup and the Downloads page, light and dark at 100% and 150%.
//   node qa/native-slot.mjs r6-downloads -- node qa/r6-downloads.mjs [out-dir] [--only light:100] [--reduced]
// A local server streams slow files (Range supported, so pause/resume work); every capture is the composited window (desktopCapturer), never the screen.
import fs from 'node:fs/promises';
import path from 'node:path';
import {startApp, httpFixture, sleep, poll} from './d-harness.mjs';

const arg = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const out = path.resolve(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'qa/artifacts/r6-downloads'); await fs.mkdir(out, {recursive: true});
const only = arg('--only'), reducedMotion = process.argv.includes('--reduced');
const root = '.qa-profiles/r6-downloads'; await fs.rm(root, {recursive: true, force: true});
const MB = 1024 * 1024;

const fx = await httpFixture((req, res) => {
  const url = new URL(req.url, 'http://x'), m = /^\/f\/(.+)$/.exec(url.pathname);
  if (!m) { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><title>Source</title><body style="font:16px system-ui;padding:40px">Downloads source</body>'); return; }
  const name = decodeURIComponent(m[1]), total = Math.round(Number(url.searchParams.get('mb') || 3) * MB), kbps = Number(url.searchParams.get('kbps') || 4000);
  const range = /bytes=(\d+)-/.exec(req.headers.range || ''), start = range ? Number(range[1]) : 0, chunk = 64 * 1024, gap = Math.max(8, Math.round(chunk / (kbps * 1000 / 1000) / 1.024));
  res.statusCode = range ? 206 : 200; res.setHeader('content-type', 'application/octet-stream'); res.setHeader('content-disposition', `attachment; filename="${name}"`);
  res.setHeader('accept-ranges', 'bytes'); res.setHeader('etag', '"r6"'); res.setHeader('content-length', String(total - start)); if (range) res.setHeader('content-range', `bytes ${start}-${total - 1}/${total}`);
  let sent = start; const timer = setInterval(() => { if (res.destroyed) return clearInterval(timer); const n = Math.min(chunk, total - sent); res.write(Buffer.alloc(n, 7)); sent += n; if (sent >= total) { clearInterval(timer); res.end(); } }, gap);
  req.on('close', () => clearInterval(timer));
});
const base = `http://127.0.0.1:${fx.port}`, report = {shots: [], notes: []};
const app = await startApp({root, env: {ACIRA_BROWSER_TEST_HIDDEN: '0', ACIRA_BROWSER_TEST_DOWNLOAD_DIR: path.resolve(root, 'saved')}});
const downloads = async () => (await app.svc({type: 'downloads.list'})).downloads;
const find = async name => (await downloads()).find(d => d.name === name);
const grab = async (name, crops = []) => {
  const result = await app.main(async ({BaseWindow, desktopCapturer, screen}) => {
    const w = BaseWindow.fromId(globalThis.__qaTargetWindow), b = w.getBounds(), f = screen.getDisplayMatching(b).scaleFactor;
    const sources = await desktopCapturer.getSources({types: ['window'], thumbnailSize: {width: Math.round(b.width * f), height: Math.round(b.height * f)}});
    const image = sources.find(s => s.id === w.getMediaSourceId()).thumbnail, size = image.getSize();
    return {full: image.toPNG().toString('base64'), size, f, b, content: w.getContentBounds()};
  });
  await fs.writeFile(path.join(out, name + '.png'), Buffer.from(result.full, 'base64'));
  report.shots.push({name, size: result.size, scale: result.f});
  return result;
};
const cropOf = async (name, rects) => { // rects in window DIPs -> crops via a second pass in main (nativeImage), so the detail stays at device pixels
  const result = await app.main(async ({BaseWindow, desktopCapturer, screen, nativeImage}, args) => {
    const w = BaseWindow.fromId(globalThis.__qaTargetWindow), b = w.getBounds(), f = screen.getDisplayMatching(b).scaleFactor;
    const sources = await desktopCapturer.getSources({types: ['window'], thumbnailSize: {width: Math.round(b.width * f), height: Math.round(b.height * f)}});
    const image = sources.find(s => s.id === w.getMediaSourceId()).thumbnail, size = image.getSize(), sx = size.width / b.width, sy = size.height / b.height;
    return args.rects.map(r => image.crop({x: Math.max(0, Math.round(r.x * sx)), y: Math.max(0, Math.round(r.y * sy)), width: Math.min(size.width, Math.round(r.width * sx)), height: Math.min(size.height, Math.round(r.height * sy))}).toPNG().toString('base64'));
  }, {rects});
  await Promise.all(result.map((png, i) => fs.writeFile(path.join(out, `${name}${rects.length > 1 ? '-' + i : ''}.png`), Buffer.from(png, 'base64'))));
};
// The page's CSS pixels become window DIPs through the interface size (zoom), so a crop at 150% still lands on its element.
let Z = 1;
const rectOf = (page, selector, pad = 6) => page.evaluate(([s, p, z]) => { const el = document.querySelector(s); if (!el) return null; const r = el.getBoundingClientRect(); return {x: Math.max(0, (r.x - p) * z), y: Math.max(0, (r.y - p) * z), width: (r.width + p * 2) * z, height: (r.height + p * 2) * z}; }, [selector, pad, Z]);
const overlay = () => app.context.pages().find(p => p.url().includes('view=overlay'));

try {
  await app.main(({BaseWindow, dialog}) => {
    const w = BaseWindow.getAllWindows()[0]; globalThis.__qaTargetWindow = w.id; w.setBounds({x: 40, y: 30, width: 1360, height: 860}); w.showInactive();
    dialog.showMessageBox = async () => ({response: 1, checkboxChecked: false});
  });
  await app.act({type: 'tab.new', url: base + '/'}); await app.waitWeb(base + '/'); await sleep(400);
  // Popup height for 0, 3 and (below) 5+ rows, as the panel really lays out (popup.ts estimates it; tests/popup-heights.json holds the measured numbers).
  const popupHeight = async () => { await app.ui.locator('.sb-foot-icons .sb-foot-icon').nth(1).click(); await poll(() => overlay()?.evaluate(() => !!document.querySelector('.popup-content-downloads .download-panel')), Boolean, 'popup open', 8000); await sleep(1000); const h = await overlay().evaluate(() => document.querySelector('.popup-content-downloads').getBoundingClientRect().height); await app.ui.keyboard.press('Escape'); await sleep(500); return h; };
  await app.act({type: 'settings.update', patch: {appearance: 'light', interfaceScale: 100, verticalTabs: true}}); await app.act({type: 'ui.update', patch: {workspaceOpen: true, webWorkspaceOpen: true}}); await sleep(900);
  report.heights = {rows0: await popupHeight()};
  // The same panel opened from the Acira menu's Downloads row carries a back header.
  try { await app.ui.locator('[aria-label="Acira menu"]').filter({visible: true}).first().click(); await poll(() => overlay()?.evaluate(() => !!document.querySelector('.popup-content-menu')), Boolean, 'menu open', 8000); await sleep(600); await overlay().locator('.menu-row, .acira-menu-row', {hasText: 'Downloads'}).first().click(); await poll(() => overlay()?.evaluate(() => !!document.querySelector('.popup-content-downloads .download-panel')), Boolean, 'submenu open', 8000); await sleep(900); report.heights.rows0menu = await overlay().evaluate(() => document.querySelector('.popup-content-downloads').getBoundingClientRect().height); await app.ui.keyboard.press('Escape'); await sleep(500); } catch (error) { report.heights.rows0menu = String(error).slice(0, 160); }
  // Finished files first (small and fast), oldest at the bottom of the list.
  for (const name of ['Annual-report-2026.pdf', 'Moodboard-final.png', 'notes.txt']) { await app.act({type: 'tab.new', background: true, url: `${base}/f/${encodeURIComponent(name)}?mb=1.4&kbps=9000`}); await poll(() => find(name), d => d?.status === 'Ready', name + ' ready', 20000); await sleep(300); }
  report.heights.rows3 = await popupHeight();
  const variants = [['light', 100], ['dark', 100], ['light', 150], ['dark', 150]].filter(([a, s]) => !only || only === `${a}:${s}`);
  if (only === 'heights') variants.length = 0;
  for (const [appearance, scale] of variants) {
    const tag = `${appearance}-${scale}${reducedMotion ? '-reduced' : ''}`; Z = scale / 100;
    await app.act({type: 'settings.update', patch: {appearance, interfaceScale: scale, verticalTabs: true, reducedMotion}});
    await app.act({type: 'ui.update', patch: {workspaceOpen: true, webWorkspaceOpen: true}}); await sleep(900);
    // Idle: no matrix is mounted, so the footer button is the plain glyph and no canvas of ours exists.
    report.notes.push({tag, idleCanvases: await app.ui.evaluate(() => document.querySelectorAll('.sb-foot-icons canvas, .toolbar canvas.dot-matrix').length)});
    await cropOf(`footer-idle-${tag}`, [await rectOf(app.ui, '.sb-foot', 4)]);
    // Two real downloads, one with a very long name, and a third that is paused part-way.
    const long = 'Quarterly-report-final-v3-with-a-really-long-descriptive-file-name.pdf', dmg = 'AciraBrowser-0.1-Beta-mac-arm64.dmg', held = 'Holiday-photos-raw.zip';
    await app.act({type: 'tab.new', background: true, url: `${base}/f/${encodeURIComponent(dmg)}?mb=120&kbps=1800`}); await poll(() => find(dmg), d => d?.status === 'Downloading' && d.receivedBytes > 0, dmg + ' live', 20000);
    await app.act({type: 'tab.new', background: true, url: `${base}/f/${encodeURIComponent(long)}?mb=60&kbps=1100`}); await poll(() => find(long), d => d?.status === 'Downloading' && d.receivedBytes > 0, long + ' live', 20000);
    await app.act({type: 'tab.new', background: true, url: `${base}/f/${encodeURIComponent(held)}?mb=40&kbps=900`}); const h = await poll(() => find(held), d => d?.status === 'Downloading' && d.receivedBytes > 2 * MB, held + ' live', 20000);
    await app.svc({type: 'downloads.command', id: h.id, command: 'pause'}); await sleep(3500);
    await grab(`full-footer-run-${tag}`); await cropOf(`footer-run-${tag}`, [await rectOf(app.ui, '.sb-foot', 4)]);
    report.notes.push({tag, runCanvases: await app.ui.evaluate(() => document.querySelectorAll('.sb-foot-icons canvas').length)});
    // The popup from the footer button.
    await app.ui.locator('.sb-foot-icons .sb-foot-icon').nth(1).click(); await poll(() => overlay()?.evaluate(() => !!document.querySelector('.popup-content-downloads .download-panel')), Boolean, 'popup open', 8000); await sleep(1100);
    await grab(`full-popup-run-${tag}`);
    const popup = await overlay().evaluate(z => { const el = document.querySelector('.popup-content-downloads'), r = el.getBoundingClientRect(), panel = el.querySelector('.download-panel'), scroll = el.querySelector('.popup-scroll'); return {x: r.x * z, y: r.y * z, width: r.width * z, height: r.height * z, cssHeight: r.height, panel: panel.getBoundingClientRect().height, scrollH: scroll?.scrollHeight, clientH: scroll?.clientHeight, rows: el.querySelectorAll('.dl-panel-item').length, canvases: el.querySelectorAll('canvas').length}; }, Z);
    report.notes.push({tag, popup}); await cropOf(`popup-run-${tag}`, [{x: Math.max(0, popup.x - 16), y: Math.max(0, popup.y - 16), width: popup.width + 32, height: popup.height + 32}]);
    await overlay().evaluate(() => { const row = document.querySelector('.dl-panel-item:not([data-live])'); row?.dispatchEvent(new PointerEvent('pointerover', {bubbles: true})); });
    await app.ui.keyboard.press('Escape'); await sleep(500);
    // The Downloads page.
    await app.act({type: 'tab.new', url: 'acira://downloads'}); await sleep(1400);
    await grab(`full-page-run-${tag}`); await cropOf(`page-run-${tag}`, [await rectOf(app.ui, '.lib-inner, .lib', 0)]);
    const finishedIcon = app.ui.locator('.lib-row.dl[data-settled] .dl-lead').first(); await finishedIcon.hover(); await sleep(900);
    await cropOf(`page-hover-${tag}`, [await rectOf(app.ui, '.lib-row.dl[data-settled]', 24)]);
    // Back to a page so the sidebar shows; finish what runs, then watch the button settle to its glyph.
    await app.act({type: 'tab.select', id: (await app.state()).tabs.find(t => t.url.startsWith(base))?.id});
    for (const name of [dmg, long, held]) { const d = await find(name); if (d) { await app.svc({type: 'downloads.command', id: d.id, command: 'cancel'}).catch(() => {}); await sleep(150); await app.act({type: 'downloads.remove', id: d.id}); } }
    await poll(() => app.ui.evaluate(() => document.querySelectorAll('.sb-foot-icons canvas').length), n => n === 0, 'button back to its glyph (no canvas left)', 8000);
    report.notes.push({tag, settledCanvases: 0});
    // A download that finishes: the button holds a check for a moment, then goes back to its plain glyph (no canvas left, no frames).
    const quick = 'Quick-finish.zip'; await app.act({type: 'tab.new', background: true, url: `${base}/f/${encodeURIComponent(quick)}?mb=5&kbps=3500`}); await poll(() => find(quick), d => d?.status === 'Ready', 'quick ready', 20000); await sleep(600);
    await cropOf(`footer-done-${tag}`, [await rectOf(app.ui, '.sb-foot', 4)]); report.notes.push({tag, doneCanvases: await app.ui.evaluate(() => document.querySelectorAll('.sb-foot-icons canvas').length)});
    await poll(() => app.ui.evaluate(() => document.querySelectorAll('.sb-foot-icons canvas').length), n => n === 0, 'check gives way to the glyph', 6000); await app.act({type: 'downloads.remove', id: (await find(quick)).id});
  }
  // The toolbar's own Downloads button (hidden by default): the same matrix at 18px, and the same popup below it.
  if (!only || only === 'toolbar') {
    Z = 1;
    await app.act({type: 'settings.update', patch: {appearance: 'light', interfaceScale: 100, verticalTabs: false, reducedMotion}}); await sleep(700);
    await app.ui.evaluate(async () => { const st = await window.acira.getSnapshot(), id = st.tabs.find(t => t.id === st.activeTabId)?.browserProfileId || ''; localStorage.setItem('acira-toolbar-items:' + id, JSON.stringify([{id: 'downloads', visible: true}])); window.dispatchEvent(new Event('acira-toolbar-items')); });
    await sleep(600); const tb = '[data-toolbar-item="downloads"]';
    const name = 'Toolbar-download-sample.iso'; await app.act({type: 'tab.new', background: true, url: `${base}/f/${encodeURIComponent(name)}?mb=90&kbps=1500`}); const live = await poll(() => find(name), d => d?.status === 'Downloading' && d.receivedBytes > 6 * MB, 'toolbar download live', 20000);
    await sleep(1500); await cropOf('toolbar-run', [await rectOf(app.ui, tb, 14)]); await cropOf('toolbar-strip', [{x: 0, y: 0, width: 1360, height: 110}]);
    await app.ui.locator(tb).click(); await poll(() => overlay()?.evaluate(() => !!document.querySelector('.popup-content-downloads .download-panel')), Boolean, 'toolbar popup', 8000); await sleep(1100);
    const rect = await overlay().evaluate(() => { const r = document.querySelector('.popup-content-downloads').getBoundingClientRect(); return {x: r.x, y: r.y, width: r.width, height: r.height}; });
    await cropOf('toolbar-popup', [{x: Math.max(0, rect.x - 16), y: Math.max(0, rect.y - 60), width: rect.width + 32, height: rect.height + 80}]); report.heights.toolbarPopup = rect.height; await app.ui.keyboard.press('Escape'); await sleep(400);
    await app.svc({type: 'downloads.command', id: live.id, command: 'cancel'}).catch(() => {}); await sleep(200); await app.act({type: 'downloads.remove', id: live.id});
  }
  await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 1)); console.log(JSON.stringify(report, null, 1));
} finally { await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 1)).catch(() => {}); await app.close(); await fx.close(); }
