// Founder 27 Oct: a toast's status glyph turns into a close × on hover (macOS Notification Center). Real-app evidence in ONE
// isolated Electron (a native slot lock, try/finally, watchdog): the interface toast slot and the overlay toast layer over a
// website, light + dark, at rest (check) and hovered (×), the timer pausing under the pointer and resuming with its grace,
// the × and Esc dismissing that toast, and with --strip a 60 Hz recording of the cross-fade + dismiss (Windows Graphics
// Capture of this app's own window only; synthetic CDP input, the real mouse never moves).
//   node qa/toast-hover-capture.mjs [--scale=1|1.5] [--strip] [--out=C:/ae/r3/toast-hover/evidence]
import fs from 'node:fs/promises';
import fss from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { launchPreparedNative } from './prepared-native.mjs';

const arg = (name, fallback) => process.argv.find(item => item.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const scale = Number(arg('scale', '1')), strip = process.argv.includes('--strip'), tag = `${Math.round(scale * 100)}`;
const out = path.resolve(arg('out', 'C:/ae/r3/toast-hover/evidence'));
const FFMPEG = 'C:/Users/you/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-8.1.2-full_build/bin/ffmpeg.exe';
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const log = (...parts) => console.log(new Date().toISOString().slice(11, 23), ...parts);
await fs.mkdir(out, { recursive: true });

async function takeSlot() {
  for (let round = 0; round < 40; round++) {
    for (const n of [1, 2, 3]) {
      const file = `C:/ae/slot-${n}.lock`;
      try { const fd = fss.openSync(file, 'wx'); fss.writeSync(fd, `toast-hover ${new Date().toISOString()}`); fss.closeSync(fd); return file; } catch { /* taken */ }
    }
    await wait(30_000);
  }
  throw Error('no native slot free');
}

const server = http.createServer((_, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end('<!doctype html><title>Field notes</title><body style="margin:0;font:17px/1.6 Georgia,serif;background:#f6f3ec;color:#2a2722"><main style="max-width:620px;margin:72px auto;padding:0 24px"><h1 style="font-weight:500">Field notes</h1><p>Morning light on the ridge, a long walk down to the river, and the quiet hour before the town wakes.</p><p>Notes from a slow week: what was seen, what was kept, and what can wait.</p></main>'); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const site = `http://127.0.0.1:${server.address().port}/`;

const results = [], check = (name, pass, detail = '') => { results.push({ name, pass, detail }); log(pass ? 'PASS' : 'FAIL', name, detail); };
let lock, app, ffmpeg;
const watchdog = setTimeout(() => { log('watchdog: closing'); try { ffmpeg?.kill(); } catch {} app?.close().catch(() => {}); if (lock) try { fss.unlinkSync(lock); } catch {} process.exit(2); }, 9 * 60_000);
try {
  lock = await takeSlot(); log('slot', lock);
  const data = path.resolve(`.qa-profiles/toast-hover-${tag}-${Date.now()}`);
  app = await launchPreparedNative({
    executablePath: createRequire(import.meta.url)('electron'),
    args: [path.resolve('desktop/main.cjs'), `--force-device-scale-factor=${scale}`, '--disable-features=CalculateNativeWinOcclusion', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
    env: { ...process.env, ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: data },
  });
  let ui;
  for (let i = 0; i < 300 && !ui; i++) { ui = app.windows().find(page => page.url() === 'acira-browser-ui://ui/index.html'); if (!ui) await wait(100); }
  if (!ui) throw Error('UI page not found');
  try { await ui.getByRole('button', { name: 'Skip setup', exact: true }).click({ timeout: 10_000 }); } catch {}
  await wait(800);
  try { await ui.getByRole('button', { name: 'Done', exact: true }).click({ timeout: 2500 }); } catch {}
  await app.evaluate(({ BaseWindow }, size) => { const win = BaseWindow.getAllWindows()[0]; win.setBounds({ x: 80, y: 60, width: size.w, height: size.h }); }, { w: 1100, h: 720 });
  await wait(600);

  const dispatch = command => ui.evaluate(value => window.acira.dispatch(value), command);
  const snapshot = () => ui.evaluate(() => window.acira.getSnapshot());
  const shot = async (name, crop) => {
    const png = await app.evaluate(async ({ desktopCapturer, BaseWindow }, { factor, crop }) => {
      const win = BaseWindow.getAllWindows()[0], [w, h] = win.getSize();
      const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: Math.round(w * factor), height: Math.round(h * factor) } });
      const source = sources.find(item => item.id === win.getMediaSourceId()); if (!source) return null;
      const image = crop ? source.thumbnail.crop({ x: Math.round(crop.x * factor), y: Math.round(crop.y * factor), width: Math.round(crop.width * factor), height: Math.round(crop.height * factor) }) : source.thumbnail;
      return image.toPNG().toString('base64');
    }, { factor: scale, crop });
    if (!png) { check(`capture ${name}`, false, 'no window source'); return; }
    const file = path.join(out, `${name}-${tag}.png`); await fs.writeFile(file, Buffer.from(png, 'base64')); log('shot', file);
  };
  const lead = async (page, selector) => page.evaluate(sel => {
    const card = document.querySelector(sel); if (!card) return null;
    const glyph = card.querySelector('.t-lead > .t-glyph'), close = card.querySelector('.t-close');
    const box = node => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
    return { glyph: Number(getComputedStyle(glyph).opacity), close: Number(getComputedStyle(close).opacity), label: close.getAttribute('aria-label'), glyphBox: box(glyph), closeBox: box(close), card: box(card), closeBg: getComputedStyle(close).backgroundColor, swap: getComputedStyle(close).transitionDuration };
  }, selector);
  const around = (box, pad = 28) => ({ x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad), width: box.width + pad * 2, height: box.height + pad * 2 });
  const park = page => page.mouse.move(4, 300);

  await dispatch({ type: 'tab.new', url: 'acira://history' }); await wait(1200);
  for (const theme of ['light', 'dark']) {
    await dispatch({ type: 'settings.update', patch: { appearance: theme } }); await wait(700);
    // ── Interface slot: rest → hover (×) → pointer on × → paused past its 4 s → leaves after the grace.
    const card = '.page-toast-slot .t-toast';
    await park(ui);
    await dispatch({ type: 'toast', text: 'Link copied' });
    await ui.locator(card).first().waitFor({ timeout: 4000 }); await wait(700);
    const rest = await lead(ui, card);
    check(`${theme} interface at rest shows the check, × hidden`, rest && rest.glyph === 1 && rest.close === 0, JSON.stringify(rest && { glyph: rest.glyph, close: rest.close }));
    check(`${theme} × sits in the glyph spot (same centre)`, rest && Math.abs(rest.glyphBox.x + 8 - (rest.closeBox.x + rest.closeBox.width / 2)) < .6 && Math.abs(rest.glyphBox.y + 8 - (rest.closeBox.y + rest.closeBox.height / 2)) < .6, JSON.stringify(rest && { glyph: rest.glyphBox, close: rest.closeBox }));
    check(`${theme} × has an accessible name`, rest?.label === 'Dismiss', rest?.label);
    await shot(`interface-${theme}-rest`, around(rest.card));
    const hoverAt = Date.now();
    await ui.locator(card).first().hover({ position: { x: Math.round(rest.card.width * .6), y: Math.round(rest.card.height / 2) } }); await wait(350);
    const hovered = await lead(ui, card);
    check(`${theme} interface hovered shows the ×`, hovered && hovered.glyph === 0 && hovered.close === 1, JSON.stringify(hovered && { glyph: hovered.glyph, close: hovered.close }));
    await shot(`interface-${theme}-hover`, around(rest.card));
    await ui.locator(`${card} .t-close`).first().hover(); await wait(250);
    const onX = await lead(ui, card);
    check(`${theme} soft background under the pointer`, onX && onX.closeBg !== 'rgba(0, 0, 0, 0)', onX?.closeBg);
    await shot(`interface-${theme}-hover-x`, around(rest.card));
    await wait(Math.max(0, 4600 - (Date.now() - hoverAt)));
    check(`${theme} hover holds the toast past its 4 s`, await ui.locator(card).count() === 1);
    await park(ui); const leftAt = Date.now(); await wait(1000);
    check(`${theme} still there 1 s after the pointer leaves (grace)`, await ui.locator(card).count() === 1);
    let goneAfter = 0; for (let i = 0; i < 60; i++) { if (!(await ui.locator(card).count())) { goneAfter = Date.now() - leftAt; break; } await wait(100); }
    check(`${theme} resumes and leaves on its own after the release`, goneAfter > 1400 && goneAfter < 5200, `${goneAfter} ms after leave`);

    // ── Click the × → that toast leaves with its exit.
    await dispatch({ type: 'toast', text: 'Saved to Reading list' });
    await ui.locator(card).first().waitFor(); await wait(500);
    await ui.locator(card).first().hover(); await wait(250);
    await ui.locator(`${card} .t-close`).first().click(); const clickAt = Date.now();
    let clickGone = 0; for (let i = 0; i < 30; i++) { if (!(await ui.locator(card).count())) { clickGone = Date.now() - clickAt; break; } await wait(50); }
    check(`${theme} the × dismisses its toast`, clickGone > 0 && clickGone < 1200, `${clickGone} ms`);
    await park(ui);

    // ── An action toast (Undo) keeps its action beside the ×.
    await dispatch({ type: 'tab.new', url: 'acira://bookmarks' }); await wait(900);
    const opened = (await snapshot()).activeTabId; await dispatch({ type: 'tab.close', id: opened });
    await ui.locator(card).first().waitFor({ timeout: 4000 }); await wait(700);
    const action = await lead(ui, card);
    await ui.locator(card).first().hover({ position: { x: Math.round(action.card.width * .45), y: Math.round(action.card.height / 2) } }); await wait(350);
    const actionHover = await lead(ui, card), undo = await ui.locator(`${card} .toast-action`).count();
    check(`${theme} action toast keeps Undo while the × shows`, undo === 1 && actionHover.close === 1, `undo ${undo}`);
    await shot(`interface-${theme}-action-hover`, around(action.card));
    // ── Keyboard: focus reaches the × (ring), Esc dismisses that toast.
    await park(ui); await ui.keyboard.press('Shift');
    await ui.locator(`${card} .t-close`).first().focus(); await wait(300);
    const focused = await ui.evaluate(() => ({ visible: document.activeElement?.matches(':focus-visible'), cls: document.activeElement?.className }));
    check(`${theme} keyboard focus on the × shows it with a ring`, focused.cls === 't-close' && (await lead(ui, card)).close === 1, JSON.stringify(focused));
    await shot(`interface-${theme}-focus`, around(action.card));
    await ui.keyboard.press('Escape');
    let escGone = 0; const escAt = Date.now(); for (let i = 0; i < 30; i++) { if (!(await ui.locator(card).count())) { escGone = Date.now() - escAt; break; } await wait(50); }
    check(`${theme} Esc dismisses the focused toast`, escGone > 0, `${escGone} ms`);
    await ui.evaluate(() => document.querySelector('.address-bar input')?.focus());

    // ── Over a website: the overlay toast layer, hover → ×, click → the same toast leaves (main forwards its id).
    await dispatch({ type: 'tab.new', url: site }); await wait(2200);
    await dispatch({ type: 'toast', text: 'Link copied' });
    let overlay;
    for (let i = 0; i < 40 && !overlay; i++) { for (const page of app.context().pages()) { if (page.url().includes('view=overlay') && await page.locator('.t-toast').count().catch(() => 0)) overlay = page; } if (!overlay) await wait(100); }
    check(`${theme} toast over a website draws in the overlay layer`, !!overlay);
    if (overlay) {
      await wait(600);
      const oRest = await lead(overlay, '.t-toast');
      const offset = await app.evaluate(({ BaseWindow, webContents }) => {
        const win = BaseWindow.getAllWindows()[0], walk = (view, x, y) => { for (const child of view.children || []) { const b = child.getBounds(), nx = x + b.x, ny = y + b.y; if (child.webContents?.getURL().includes('view=overlay')) return { x: nx, y: ny }; const found = walk(child, nx, ny); if (found) return found; } return null; };
        return walk(win.contentView, 0, 0) || { x: 0, y: 0 };
      });
      const oCrop = around({ ...oRest.card, x: oRest.card.x + offset.x, y: oRest.card.y + offset.y });
      check(`${theme} overlay at rest shows the check`, oRest.glyph === 1 && oRest.close === 0);
      await shot(`overlay-${theme}-rest`, oCrop);
      await overlay.locator('.t-toast').first().hover({ position: { x: Math.round(oRest.card.width * .6), y: Math.round(oRest.card.height / 2) } }); await wait(350);
      const oHover = await lead(overlay, '.t-toast');
      check(`${theme} overlay hovered shows the ×`, oHover.glyph === 0 && oHover.close === 1);
      await shot(`overlay-${theme}-hover`, oCrop);
      await overlay.locator('.t-close').first().click(); const oAt = Date.now();
      let oGone = 0; for (let i = 0; i < 40; i++) { if (!(await overlay.locator('.t-toast').count().catch(() => 0))) { oGone = Date.now() - oAt; break; } await wait(50); }
      check(`${theme} overlay × dismisses that toast (forwarded to the interface's list)`, oGone > 0 && oGone < 1500, `${oGone} ms`);
      await overlay.mouse.move(2, 2).catch(() => {});
    }
    const web = (await snapshot()).activeTabId; await dispatch({ type: 'tab.close', id: web }); await wait(900);
    // Closing the website raised "Tab closed · Undo"; clear the slot from its × before the next theme.
    await ui.locator(card).first().waitFor({ timeout: 2000 }).catch(() => {});
    await ui.evaluate(() => { for (const button of document.querySelectorAll('.page-toast-slot .t-close')) button.click(); });
    await wait(900);
  }

  // ── Reduced motion: the glyph and × swap at once.
  await dispatch({ type: 'settings.update', patch: { reducedMotion: true } }); await wait(500);
  await dispatch({ type: 'toast', text: 'Link copied' }); await ui.locator('.page-toast-slot .t-toast').first().waitFor(); await wait(400);
  const reduced = await lead(ui, '.page-toast-slot .t-toast');
  check('reduced motion swaps at once (no opacity transition)', reduced && !/[1-9]/.test(reduced.swap.split(',').slice(0, 2).join(',')), reduced?.swap);
  await ui.locator('.page-toast-slot .t-close').first().click({ force: true }); await wait(400);
  await dispatch({ type: 'settings.update', patch: { reducedMotion: false } }); await wait(500);

  if (strip) {
    // ── Motion strip: a capturePage burst of this app's interface view (its own window only; ~60 Hz) while the pointer
    //    arrives (glyph → × cross-fade) and the × is clicked (the toast's exit). Frames are kept in time order with their time.
    // (ffmpeg gfxcapture of the window produced no frames here: WGC sends none while the window is not repainting.)
    for (const theme of ['dark', 'light']) {
      await dispatch({ type: 'settings.update', patch: { appearance: theme } }); await wait(700); await park(ui);
      await dispatch({ type: 'toast', text: 'Link copied' });
      const card = ui.locator('.page-toast-slot .t-toast').first(); await card.waitFor(); await wait(800);
      const box = (await lead(ui, '.page-toast-slot .t-toast')).card;
      const pad = 20, rect = { x: Math.round(box.x - pad), y: Math.round(box.y - pad), width: Math.round(box.width + pad * 2), height: Math.round(box.height + pad * 2) };
      const burst = app.evaluate(async ({ webContents }, { rect, ms }) => {
        const view = webContents.getAllWebContents().find(item => item.getURL() === 'acira-browser-ui://ui/index.html');
        const frames = [], start = performance.now();
        while (performance.now() - start < ms && frames.length < 400) { const at = performance.now() - start, image = await view.capturePage(rect); frames.push({ at: Math.round(at), png: image.toPNG().toString('base64') }); }
        return frames;
      }, { rect, ms: 2000 });
      await wait(350);
      await card.hover({ position: { x: Math.round(box.width * .6), y: Math.round(box.height / 2) } }); await wait(650);
      await ui.locator('.page-toast-slot .t-close').first().click();
      const shots = await burst;
      const frames = path.join(out, `strip-${theme}-${tag}-frames`); await fs.rm(frames, { recursive: true, force: true }); await fs.mkdir(frames);
      const bytes = shots.map(item => Buffer.from(item.png, 'base64'));
      await Promise.all(bytes.map((buffer, i) => fs.writeFile(path.join(frames, `f${String(i + 1).padStart(4, '0')}.png`), buffer)));
      const changed = bytes.map((buffer, i) => i > 0 && !buffer.equals(bytes[i - 1])), first = changed.indexOf(true), last = changed.lastIndexOf(true);
      const steps = shots.slice(1).map((item, i) => item.at - shots[i].at).sort((a, b) => a - b), median = steps[Math.floor(steps.length / 2)];
      check(`${theme} motion strip caught the cross-fade and the dismiss`, first > 0 && last > first, `${shots.length} frames, median ${median} ms/frame, changes ${first}–${last}`);
      if (first > 0) {
        const from = Math.max(1, first - 1), to = Math.min(shots.length, last + 3), count = to - from + 1, cols = 8, rows = Math.ceil(count / cols);
        execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-start_number', String(from), '-i', path.join(frames, 'f%04d.png'), '-frames:v', '1', '-vf', `tile=${cols}x${rows}:padding=6:margin=6:color=0x808080`, path.join(out, `strip-${theme}-${tag}.png`)]);
        await fs.writeFile(path.join(out, `strip-${theme}-${tag}.json`), JSON.stringify({ medianMsPerFrame: median, from, to, at: shots.slice(from - 1, to).map(item => item.at), changed: changed.map((value, i) => value ? i + 1 : 0).filter(Boolean) }, null, 1));
      }
    }
  }
} catch (error) {
  check('run', false, error.stack || String(error));
} finally {
  clearTimeout(watchdog);
  try { ffmpeg?.kill(); } catch {}
  await app?.close().catch(() => {});
  server.close();
  if (lock) try { fss.unlinkSync(lock); } catch {}
}
await fs.writeFile(path.join(out, `report-${tag}.json`), JSON.stringify(results, null, 1));
const failed = results.filter(item => !item.pass);
console.log(failed.length ? `FAIL ${failed.length}/${results.length}` : `PASS ${results.length}/${results.length}`);
process.exit(failed.length ? 1 : 0);
