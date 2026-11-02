// The sidebar media card's volume slider, in the real app (founder, 27 Oct). A local page plays a looping generated WAV (an
// 18.5 kHz tone at -48 dBFS: Chromium hears it, people near the machine do not); no network. Proves: card -> slider -> card
// (dark + light, 100% + 150%), a per-frame strip of the morph both ways, the element's volume following the slider (read in the
// page), 0 muting the tab (snapshot + webContents), the glyph unmuting back to the level, keys, the sidebar closing.
//   node qa/v-volume-slider.mjs        (one native slot; D_VISIBLE=1 is set here: layout needs a shown window)
// Synthetic input only (Playwright's CDP mouse/keyboard on the interface page); the OS cursor is never moved.
import fs from 'node:fs/promises';
import path from 'node:path';
import {startApp,httpFixture,sleep,poll} from './d-harness.mjs';

const EVIDENCE = process.env.V_EVIDENCE || 'C:/ae/r5/volume/evidence';
await fs.mkdir(EVIDENCE, {recursive: true});
process.env.D_VISIBLE = '1';

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

/** A 2 s mono 16-bit WAV: an 18.5 kHz sine at amplitude 0.004 (-48 dBFS), looped by the page. */
function toneWav() {
  const rate = 44100, seconds = 2, n = rate * seconds, data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) data.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 18500 * i / rate) * 0.004 * 32767), i * 2);
  const head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(36 + data.length, 4); head.write('WAVE', 8); head.write('fmt ', 12); head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22); head.writeUInt32LE(rate, 24); head.writeUInt32LE(rate * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34);
  head.write('data', 36); head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}
const WAV = toneWav();
const PAGE = `<!doctype html><meta charset=utf-8><title>Bet You Didn't Need This (Tone)</title><body style="font:14px system-ui;padding:24px">
<p>Volume slider fixture.</p><audio id=a src="/tone.wav" loop autoplay></audio></body>`;

const rows = [];
const check = (ok, label, detail = '') => { rows.push({ok: !!ok, label, detail: String(detail)}); console.log(ok ? 'PASS' : 'FAIL', label, detail ? '- ' + String(detail).slice(0, 220) : ''); };

const release = await takeSlot('volume-slider');
const fixture = await httpFixture((req, res) => {
  if (req.url === '/tone.wav') { res.writeHead(200, {'content-type': 'audio/wav', 'content-length': WAV.length, 'accept-ranges': 'none'}); res.end(WAV); return; }
  res.writeHead(200, {'content-type': 'text/html; charset=utf-8'}); res.end(PAGE);
});
const origin = `http://127.0.0.1:${fixture.port}`;
let h;
try {
  h = await startApp({root: `.qa-profiles/volume-${Date.now()}`, args: ['--autoplay-policy=no-user-gesture-required', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--disable-features=CalculateNativeWinOcclusion']});
  const {ui} = h;
  await h.main(({BaseWindow}) => { const w = BaseWindow.getAllWindows()[0]; w.setBounds({x: 60, y: 60, width: 1100, height: 720}); });
  try { const done = ui.getByRole('button', {name: 'Done', exact: true}); await done.click({timeout: 2500}); } catch {}
  const setLook = async (appearance, interfaceScale) => {
    await h.act({type: 'settings.update', patch: {appearance, interfaceScale, verticalTabs: true, animationSpeed: 'premium', reducedMotion: false}});
    await h.act({type: 'ui.update', patch: {workspaceOpen: true, webWorkspaceOpen: true}});
    await sleep(900);
  };
  await setLook('dark', 100);
  const before = (await h.state()).tabs.length;
  await h.act({type: 'tab.new', url: origin + '/'});
  const tabId = await poll(async () => { const s = await h.state(); return s.tabs.length === before + 1 ? s.tabs.find(t => t.url.startsWith(origin))?.id : null; }, Boolean, 'fixture tab', 15000);
  // Autoplay normally starts it; if a policy held it, start it the way the sidebar's Play does (a user gesture from main).
  const pageJs = (code, gesture = false) => h.main(async ({webContents}, {origin, code, gesture}) => {
    const wc = webContents.getAllWebContents().find(w => w.getURL().startsWith(origin)); return wc ? wc.executeJavaScript(code, gesture) : null;
  }, {origin, code, gesture});
  await sleep(1200);
  if ((await h.state()).tabs.find(t => t.id === tabId)?.media !== 'playing') await pageJs("document.getElementById('a').play().then(()=>1,()=>0)", true);
  await poll(async () => (await h.state()).tabs.find(t => t.id === tabId)?.media, v => v === 'playing', 'media playing', 15000);
  await poll(() => ui.evaluate(id => Boolean(document.querySelector(`.sb-media-row[data-media-tab="${id}"]`)), tabId), Boolean, 'media card', 8000);
  check(true, 'the card appears for the playing tab');

  const rowBox = () => ui.evaluate(id => { const r = document.querySelector(`.sb-media-row[data-media-tab="${id}"]`).getBoundingClientRect(); return {x: r.x, y: r.y, width: r.width, height: r.height, iw: innerWidth}; }, tabId);
  const centre = sel => ui.evaluate(({id, sel}) => { const r = document.querySelector(`.sb-media-row[data-media-tab="${id}"] ${sel}`).getBoundingClientRect(); return {x: r.x + r.width / 2, y: r.y + r.height / 2, left: r.left, width: r.width}; }, {id: tabId, sel});
  const isOpen = () => ui.evaluate(id => document.querySelector(`.sb-media-row[data-media-tab="${id}"]`)?.hasAttribute('data-volume'), tabId);
  const sliderNow = () => ui.evaluate(id => Number(document.querySelector(`.sb-media-row[data-media-tab="${id}"] [role=slider]`)?.getAttribute('aria-valuenow')), tabId);
  const elementVolume = () => pageJs("document.getElementById('a').volume");
  const tabMuted = async () => ({snapshot: !!(await h.state()).tabs.find(t => t.id === tabId)?.muted, native: await h.main(({webContents}, origin) => webContents.getAllWebContents().find(w => w.getURL().startsWith(origin))?.isAudioMuted(), origin)});

  /** The sidebar's bottom (the media card with some of the list above and the workspace row below), from the real composited UI. */
  const shot = async name => {
    const box = await rowBox();
    const png = await h.main(async ({webContents}, box) => {
      const wc = webContents.getAllWebContents().find(w => w.getURL() === 'acira-browser-ui://ui/index.html');
      const image = await wc.capturePage(), ratio = image.getSize().width / box.iw, pad = 18;
      const rect = {x: Math.max(0, Math.round((box.x - 8) * ratio)), y: Math.max(0, Math.round((box.y - pad - 30) * ratio)), width: Math.round((box.width + 16) * ratio), height: Math.round((box.height + pad * 2 + 70) * ratio)}, size = image.getSize();
      rect.width = Math.min(rect.width, size.width - rect.x); rect.height = Math.min(rect.height, size.height - rect.y);
      return image.crop(rect).toPNG().toString('base64');
    }, box);
    const file = path.join(EVIDENCE, name + '.png'); await fs.writeFile(file, Buffer.from(png, 'base64')); return file;
  };
  /** Every composited frame of the row while `during()` runs (beginFrameSubscription: one callback per frame the UI paints). */
  const strip = async (name, during, ms = 1100) => {
    const box = await rowBox();
    const burst = h.main(async ({webContents}, {box, ms}) => {
      const wc = webContents.getAllWebContents().find(w => w.getURL() === 'acira-browser-ui://ui/index.html'), frames = [], t0 = Date.now();
      wc.invalidate?.();
      await new Promise(resolve => { wc.beginFrameSubscription(false, image => { if (frames.length < 72) frames.push({t: Date.now() - t0, image}); }); setTimeout(resolve, ms); });
      wc.endFrameSubscription();
      return frames.map(f => { const ratio = f.image.getSize().width / box.iw; return {t: f.t, png: f.image.crop({x: Math.round((box.x - 4) * ratio), y: Math.round((box.y - 4) * ratio), width: Math.round((box.width + 8) * ratio), height: Math.round((box.height + 8) * ratio)}).toPNG().toString('base64')}; });
    }, {box, ms});
    await sleep(80); await during();
    const frames = await burst;
    const sheet = await ui.evaluate(async ({frames}) => {
      const load = src => new Promise(resolve => { const i = new Image(); i.onload = () => resolve(i); i.src = src; });
      const images = await Promise.all(frames.map(f => load('data:image/png;base64,' + f.png)));
      if (!images.length) return null;
      const w = images[0].width, hgt = images[0].height, cols = 4, rows = Math.ceil(images.length / cols), ch = hgt + 18;
      const c = document.createElement('canvas'); c.width = cols * (w + 6); c.height = rows * ch; const g = c.getContext('2d');
      g.fillStyle = '#202020'; g.fillRect(0, 0, c.width, c.height); g.font = '12px sans-serif';
      images.forEach((img, i) => { const x = (i % cols) * (w + 6), y = Math.floor(i / cols) * ch; g.drawImage(img, x, y + 18); g.fillStyle = '#fff'; g.fillText(`${i + 1} · ${frames[i].t} ms`, x + 4, y + 13); });
      return c.toDataURL('image/png').split(',')[1];
    }, {frames});
    const file = path.join(EVIDENCE, name + '.png'); if (sheet) await fs.writeFile(file, Buffer.from(sheet, 'base64'));
    const gaps = frames.slice(1).map((f, i) => f.t - frames[i].t), busy = gaps.filter(g => g < 40);
    return {file, count: frames.length, median: busy.length ? busy.sort((a, b) => a - b)[Math.floor(busy.length / 2)] : null};
  };

  const openSlider = async () => { const s = await centre('.sb-media-speaker'); await ui.mouse.click(s.x, s.y); await poll(isOpen, Boolean, 'slider open', 3000); };
  const waitClosed = async (timeout = 5000) => poll(async () => !(await isOpen()) && !(await ui.evaluate(id => document.querySelector(`.sb-media-row[data-media-tab="${id}"]`)?.hasAttribute('data-volume-closing'), tabId)), Boolean, 'card back', timeout);
  const railAt = async fraction => { const r = await centre('.sb-media-vol-rail'); return {x: r.left + 6 + (r.width - 12) * fraction, y: r.y}; };

  // 1. Dark, 100%: the full journey with the checks.
  check(/card/.test(await shot('dark-100-1-card')), 'dark 100%: card captured');
  const t0 = Date.now(); await openSlider();
  await sleep(700); await shot('dark-100-2-slider');
  check(await ui.evaluate(() => document.activeElement?.getAttribute('role') === 'slider'), 'opening moves focus to the slider');
  let p = await railAt(.3); await ui.mouse.move(p.x, p.y); await ui.mouse.down();
  p = await railAt(.8); await ui.mouse.move(p.x, p.y, {steps: 6});
  p = await railAt(.42); await ui.mouse.move(p.x, p.y, {steps: 6});
  await sleep(250);
  let now = await sliderNow(), volume = await elementVolume();
  check(Math.abs(now - 42) <= 1 && Math.abs(volume * 100 - now) < .6, 'dragging sets the slider and the page element follows', `slider ${now}, element.volume ${volume}`);
  await sleep(1500); check(await isOpen(), 'held: still open after 1.5 s');
  await ui.mouse.up(); const released = Date.now();
  await shot('dark-100-3-slider-held');
  await sleep(900); check(await isOpen(), 'let go: still the slider 0.9 s later');
  await waitClosed(3000); const back = Date.now() - released;
  check(back >= 1150 && back < 2300, 'let go: back to the card after the 1.2 s wait (+ morph)', `${back} ms`);
  await sleep(300); await shot('dark-100-4-card-again');
  check(Math.abs((await elementVolume()) - .42) < .006, 'the level stays on the page after the card returns', await elementVolume());

  // Keys and wheel restart the wait and move the level; Esc returns at once.
  await openSlider(); await ui.keyboard.press('ArrowRight'); await sleep(120);
  now = await sliderNow(); volume = await elementVolume();
  check(now === 47 && Math.abs(volume - .47) < .006, 'ArrowRight: +5', `slider ${now}, element ${volume}`);
  const wheelAt = await centre('.sb-media-vol-track'); await ui.mouse.move(wheelAt.x, wheelAt.y); await ui.mouse.wheel(0, -100); await sleep(200);
  check(await sliderNow() === 52, 'wheel up one notch: +5', await sliderNow());
  await ui.keyboard.press('Escape'); await sleep(60);
  check(!(await isOpen()), 'Esc returns to the card at once');
  await waitClosed(2000);

  // 0 mutes the tab (snapshot and webContents), the glyph unmutes back to the level from before.
  await openSlider(); p = await railAt(.6); await ui.mouse.move(p.x, p.y); await ui.mouse.down();
  p = await railAt(-0.2); await ui.mouse.move(p.x, p.y, {steps: 5}); await sleep(400);
  let m = await tabMuted(); now = await sliderNow();
  check(now === 0 && m.snapshot && m.native, 'dragging to 0 mutes the tab', `slider ${now}, muted ${JSON.stringify(m)}`);
  await shot('dark-100-5-slider-muted');
  await ui.mouse.up(); await sleep(150);
  const glyph = await centre('.sb-media-vol-glyph'); await ui.mouse.click(glyph.x, glyph.y); await sleep(500);
  m = await tabMuted(); now = await sliderNow(); volume = await elementVolume();
  check(!m.snapshot && !m.native && now === 52 && Math.abs(volume - .52) < .006, 'the glyph unmutes back to the level from before the gesture (52)', `slider ${now}, element ${volume}, muted ${JSON.stringify(m)}`);
  await waitClosed(4000);

  // The sidebar closing returns at once: reopened, it shows the card.
  await openSlider();
  await h.act({type: 'ui.update', patch: {workspaceOpen: false, webWorkspaceOpen: false}}); await sleep(500);
  await h.act({type: 'ui.update', patch: {workspaceOpen: true, webWorkspaceOpen: true}}); await sleep(700);
  check(!(await isOpen()), 'the sidebar closing returns to the card (reopened: card)');

  // A navigation in the tab keeps the level: the next page plays at it.
  await pageJs("location.href='/next'"); await sleep(1500);
  await pageJs("document.getElementById('a').play().then(()=>1,()=>0)", true); await sleep(500);
  check(Math.abs((await elementVolume()) - .52) < .006, 'after a navigation in the tab the new page plays at the level', await elementVolume());

  // 2. The morph, every frame, both ways (Premium).
  await poll(() => ui.evaluate(id => Boolean(document.querySelector(`.sb-media-row[data-media-tab="${id}"]`)), tabId), Boolean, 'card after navigation', 8000);
  const sp = await centre('.sb-media-speaker');
  const opening = await strip('strip-open-premium', () => ui.mouse.click(sp.x, sp.y), 900);
  check(opening.count >= 12, 'open morph strip', `${opening.count} frames, median gap ${opening.median} ms, ${opening.file}`);
  p = await railAt(.5); await ui.mouse.move(p.x, p.y); await ui.mouse.down(); await sleep(60); await ui.mouse.up();
  await sleep(1050);
  const closing = await strip('strip-close-premium', async () => {}, 1000);
  check(closing.count >= 8, 'close morph strip', `${closing.count} frames, median gap ${closing.median} ms, ${closing.file}`);
  await waitClosed(3000);

  // Frame pacing of the morph itself, with no capture running: requestAnimationFrame intervals in the interface page.
  const pacing = async action => {
    const rec = ui.evaluate(() => new Promise(resolve => { const t = [], s = performance.now(); const f = now => { t.push(now); if (now - s < 900) requestAnimationFrame(f); else resolve(t); }; requestAnimationFrame(f); }));
    await sleep(60); await action(); const t = await rec;
    const d = t.slice(1).map((x, i) => x - t[i]).sort((a, b) => a - b);
    return {frames: d.length, p50: +d[Math.floor(d.length / 2)].toFixed(1), p95: +d[Math.floor(d.length * .95)].toFixed(1), long: d.filter(x => x > 25).length};
  };
  const sp2 = await centre('.sb-media-speaker');
  const openPace = await pacing(() => ui.mouse.click(sp2.x, sp2.y));
  check(openPace.p50 < 20 && openPace.long <= 2, 'open morph runs at display rate (rAF intervals)', JSON.stringify(openPace));
  await ui.keyboard.press('Escape');
  const closePace = await pacing(async () => {});
  check(closePace.p50 < 20 && closePace.long <= 2, 'close morph runs at display rate (rAF intervals)', JSON.stringify(closePace));
  await waitClosed(3000);

  // Reduced motion: no animation on the row; the swap is instant.
  await h.act({type: 'settings.update', patch: {reducedMotion: true}}); await sleep(400);
  await openSlider();
  const anims = await ui.evaluate(id => document.querySelector(`.sb-media-row[data-media-tab="${id}"]`).getAnimations({subtree: true}).filter(a => a.constructor === Animation && a.playState === 'running').length, tabId);
  check(anims === 0, 'reduced motion: the morph swaps at once', `${anims} running animations`);
  await ui.keyboard.press('Escape'); await h.act({type: 'settings.update', patch: {reducedMotion: false}}); await sleep(400);

  // 3. The other looks: card -> slider -> card.
  for (const [appearance, scale] of [['light', 100], ['dark', 150], ['light', 150]]) {
    await setLook(appearance, scale); await sleep(600);
    const tag = `${appearance}-${scale}`;
    await shot(`${tag}-1-card`);
    await openSlider(); await sleep(750); await shot(`${tag}-2-slider`);
    await ui.keyboard.press('Escape'); await waitClosed(2500); await sleep(300); await shot(`${tag}-3-card-again`);
    check(true, `${tag}: card -> slider -> card captured`);
  }
  console.log(`done in ${Math.round((Date.now() - t0) / 1000)} s`);
} catch (error) {
  check(false, 'run', error.stack || error.message);
} finally {
  try { await h?.close(); } catch {}
  try { h?.app.process().kill(); } catch {}
  await fixture.close().catch(() => {});
  // V_SMOKE=1: the coordinator's 35 s uptime smoke in the same slot, after this app has closed.
  if (process.env.V_SMOKE) { const {spawnSync} = await import('node:child_process'); const smoke = spawnSync(process.execPath, ['qa/coord-uptime-smoke.mjs'], {encoding: 'utf8', timeout: 180000}); const line = (smoke.stdout || '').trim().split('\n').pop() || String(smoke.error || ''); check(/^PASS/.test(line), 'coord-uptime-smoke', line); }
  await release();
}
await fs.writeFile(path.join(EVIDENCE, 'results.json'), JSON.stringify(rows, null, 2));
const failed = rows.filter(r => !r.ok).length;
console.log(failed ? `FAIL ${failed} of ${rows.length}` : `PASS ${rows.length} checks`);
process.exit(failed ? 1 : 0);
