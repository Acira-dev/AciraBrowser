// Round 6 · updates: the whole update flow against a LOCAL feed, in an isolated profile (LOCALAPPDATA/APPDATA redirected by d-harness; the stand-in
// updater, so no real updater cache and no installer is touched). Real bytes: a local server streams a 40 MB file and holds at 42% while it is captured.
//   node qa/native-slot.mjs r6-updates -- node qa/r6-updates-proof.mjs [--scale=1.5] [--lang=de] [--out=<dir>]
// Captures (desktopCapturer of the window, so the overlay popup is in them): downloading dot, tooltip, ready popup, Read more, Later and pill, both themes.
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import {startApp, sleep, poll} from './d-harness.mjs';

const arg = (name, fallback) => { const hit = process.argv.find(item => item.startsWith('--' + name + '=')); return hit ? hit.slice(name.length + 3) : fallback; };
const scale = arg('scale', ''), lang = arg('lang', 'en'), out = path.resolve(arg('out', `qa/artifacts/r6-updates-${scale ? 'x' + scale + '-' : ''}${lang}-${Date.now()}`));
await fs.mkdir(out, {recursive: true});
process.env.D_VISIBLE = '1'; // screenshots need a shown window (never a hidden one)

const SIZE = 40_000_000, HOLD = 0.42, VERSION = '9.9.9';
// The file's real SHA-512: Acira checks the whole download against it before electron-updater (here its stand-in) may take it.
const SHA512 = createHash('sha512').update(Buffer.alloc(SIZE, 1)).digest('base64');
const NOTES = '## What we fixed\n- Windows now updates from the public update feed.\n- Smoother tab dragging and a calmer new tab page.\n- Downloads keep going when you close the panel.\n\n## What we pushed\n- A quieter update indicator while Acira downloads.\n- One question when the update is ready: Install now or Later.\n- Long notes scroll inside the popup, so it never changes size when you read them, however much we have to say about this release and how many lines it takes.';
let gate = null, release = () => {}, held = true;
const hold = new Promise(resolve => { release = resolve; });
const server = http.createServer(async (req, res) => {
  if (req.url.endsWith('latest.yml')) { res.setHeader('content-type', 'text/yaml'); return res.end(JSON.stringify({version: VERSION, releaseNotes: NOTES, files: [{url: 'Setup.bin', size: SIZE, sha512: SHA512}]})); }
  res.writeHead(200, {'content-length': SIZE}); const chunk = Buffer.alloc(262144, 1); let sent = 0;
  while (sent < SIZE) {
    if (held && sent >= SIZE * HOLD) await hold;
    const next = Math.min(chunk.length, SIZE - sent); if (!res.write(chunk.subarray(0, next))) await new Promise(resolve => res.once('drain', resolve)); sent += next;
    if (held) await sleep(40); // about 6 MB a second until the hold
  }
  res.end();
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const feed = `http://127.0.0.1:${server.address().port}/`;

const app = await startApp({root: `.qa-profiles/r6-updates-${Date.now()}`, args: scale ? ['--force-device-scale-factor=' + scale] : [], env: {ACIRA_UPDATE_TEST: '1', ACIRA_UPDATE_STUB: '1', ACIRA_UPDATE_FEED: feed}});
const results = {checks: []}, check = (name, ok, detail) => { results.checks.push({name, ok: Boolean(ok), detail}); console.log(ok ? 'ok  ' : 'FAIL', name, detail ?? ''); };
const scanner = await fs.readFile(path.resolve('qa/m-clip-scan.js'), 'utf8');
const overlayPage = () => app.context.pages().find(page => { try { return page.url().includes('view=overlay'); } catch { return false; } });
const capture = () => app.main(async ({BaseWindow, desktopCapturer, screen}) => {
  const win = BaseWindow.getAllWindows().filter(w => w.isVisible() && !w.isMinimized()).sort((a, b) => b.getBounds().width * b.getBounds().height - a.getBounds().width * a.getBounds().height)[0];
  if (!win) return '';
  const bounds = win.getBounds(), factor = screen.getDisplayMatching(bounds).scaleFactor;
  const sources = await desktopCapturer.getSources({types: ['window'], thumbnailSize: {width: Math.round(bounds.width * factor), height: Math.round(bounds.height * factor)}});
  const source = sources.find(item => item.id === win.getMediaSourceId());
  return source && !source.thumbnail.isEmpty() ? source.thumbnail.toPNG().toString('base64') : '';
});
// A crop of the toolbar's right end, magnified (nearest dots stay crisp), from the same composited pixels.
const crop = async (name, source, rect, zoom = 4) => {
  const cssWidth = await app.ui.evaluate(() => innerWidth);
  await app.main(({nativeImage}, [dir, from, to, box, factor, width]) => {
    const fs = process.mainModule.require('node:fs'), path = process.mainModule.require('node:path'), image = nativeImage.createFromBuffer(fs.readFileSync(path.join(dir, from + '.png'))), s = image.getSize().width / width;
    const part = image.crop({x: Math.round(box.x * s), y: Math.round(box.y * s), width: Math.round(box.width * s), height: Math.round(box.height * s)}).resize({width: Math.round(box.width * s * factor), quality: 'good'});
    fs.writeFileSync(path.join(dir, to + '.png'), part.toPNG());
  }, [out, source, name, rect, zoom, cssWidth]);
};
const shot = async name => { let b64 = ''; for (let i = 0; i < 12 && !b64; i++) { if (i) await sleep(300); b64 = await capture(); } await fs.writeFile(path.join(out, name + '.png'), b64 ? Buffer.from(b64, 'base64') : await app.ui.screenshot()); console.log('shot', name, b64 ? '' : '(page only)'); };
const setTheme = async appearance => { await app.act({type: 'settings.update', patch: {appearance}}); await sleep(900); };
const update = () => app.svc({type: 'update.status'}).then(r => r.update);
// Frame callbacks the chrome page asks for in a window of time: the dot matrix loop is the only thing in this page that keeps asking while it animates.
await app.ui.evaluate(() => { window.__frames = 0; const raf = window.requestAnimationFrame.bind(window); window.requestAnimationFrame = callback => raf(time => { window.__frames++; callback(time); }); });
const frames = async ms => { const before = await app.ui.evaluate(() => window.__frames); await sleep(ms); return (await app.ui.evaluate(() => window.__frames) - before) / (ms / 1000); };
const pill = () => app.ui.evaluate(() => { const node = document.querySelector('.update-pill'); if (!node) return null; const r = node.getBoundingClientRect(); return {phase: node.dataset.phase, width: r.width, height: r.height, x: r.x, y: r.y, tip: node.dataset.tip, label: node.getAttribute('aria-label')}; });

try {
  if (lang !== 'en') { await app.act({type: 'settings.update', patch: {language: lang}}); await sleep(900); }
  const first = await update(); // the check runs 1.5 s after start, so this may already be a download; before one there must be nothing on the toolbar
  if (!['downloading', 'ready'].includes(first.status)) check('nothing shows while there is no update', (await pill()) === null, first.status);
  // 1. Downloading: wait for the real partial percent
  const state = await poll(async () => { const u = await update(); return u.status === 'downloading' && u.progress >= 40 ? u : null; }, Boolean, 'downloading to 42%', 40000);
  check('download is real and automatic (on by default)', state.autoDownload === true && state.progress >= 40 && state.progress <= 43 && state.total === SIZE, JSON.stringify({progress: state.progress, transferred: state.transferred, total: state.total, speed: state.speed}));
  await sleep(600);
  const dot = await poll(pill, Boolean, 'download dot');
  check('the dot is a 24px indicator with the real details in its tip', dot.phase === 'downloading' && dot.width <= 26 && /\n\d+ ?% · [\d.,]+ MB \S+ 40 MB/.test(dot.tip), JSON.stringify(dot));
  check('the dot is the existing dot matrix (a canvas) with no line', await app.ui.evaluate(() => !!document.querySelector('.update-pill canvas.dot-matrix[data-preset="progress"]') && !document.querySelector('.update-pill progress, .update-pill [style*="scaleX"]')));
  const busy = await frames(1500);
  check('downloading: the dots animate (about 30 frames a second, not every display frame)', busy > 15 && busy < 45, busy.toFixed(1) + '/s');
  for (const theme of ['light', 'dark']) {
    await setTheme(theme);
    await app.ui.hover('.update-pill', {force: true}); await sleep(1100);
    await shot(`1-downloading-tooltip-${theme}`);
    const at = await pill(); await crop(`1c-downloading-tooltip-${theme}`, `1-downloading-tooltip-${theme}`, {x: at.x - 260, y: 28, width: 330, height: 100}, 3);
    check(`tooltip shows ${theme}`, await app.ui.evaluate(() => !!document.querySelector('.t-tip[role=tooltip]')) );
    await app.ui.mouse.move(5, 300); await sleep(300);
    await shot(`1-downloading-${theme}`);
    await crop(`1d-dot-${theme}`, `1-downloading-${theme}`, {x: at.x - 40, y: 28, width: 120, height: 36}, 8);
  }
  // CPU: the matrix loop stops with the dot. (Measured after ready, below.)
  // 2. Ready: release the hold; main asks once; the popup opens by itself
  await setTheme('light'); held = false; release();
  await poll(async () => (await update()).status === 'ready', Boolean, 'ready', 40000);
  const popup = await poll(async () => { const page = overlayPage(); return page && await page.evaluate(() => !!document.querySelector('.update-popover')) ? page : null; }, Boolean, 'popup opens by itself', 15000);
  await sleep(900);
  const ready = await update();
  check('ready: the one question was claimed once', ready.status === 'ready' && ready.prompt === false, JSON.stringify({status: ready.status, prompt: ready.prompt, notes: ready.notes.slice(0, 40)}));
  const body = await popup.evaluate(() => { const box = document.querySelector('.update-popover').getBoundingClientRect(); return {w: box.width, h: box.height, popup: document.querySelector('.browser-popup')?.offsetHeight, content: document.querySelector('.popup-body-content')?.scrollHeight, title: document.querySelector('#update-pop-title')?.textContent, text: document.querySelector('.update-pop-note')?.textContent, buttons: [...document.querySelectorAll('.update-pop-actions button')].map(b => b.textContent)}; });
  check('popup has Read more, Later, Install now', body.buttons.join('|') === ['Read more', 'Later', 'Install now'].join('|') || lang !== 'en', JSON.stringify(body));
  await shot('2-ready-popup-light');
  check('popup clip scan (ask view, light)', /no hits/.test(await popup.evaluate(scanner)), await popup.evaluate(scanner));
  await popup.click('text=' + body.buttons[0]); await sleep(500);
  const notes = await popup.evaluate(() => ({view: document.querySelector('.update-popover').dataset.view, text: document.querySelector('.update-pop-notes')?.textContent, h: document.querySelector('.update-popover').getBoundingClientRect().height, html: document.querySelector('.update-pop-notes')?.innerHTML}));
  check('Read more shows the feed notes as plain text inside the popup, capped height', notes.view === 'notes' && /What we fixed/.test(notes.text) && !/<(?!br)/.test(notes.html.replace(/&lt;|&gt;/g, '')) && notes.h <= 44 + 186 + 44 + 4, JSON.stringify({view: notes.view, h: notes.h, was: body.h}));
  await shot('3-read-more-light');
  check('popup clip scan (notes view, light)', /no hits/.test(await popup.evaluate(scanner)), await popup.evaluate(scanner));
  // 3. Later: closes, leaves the pill, never asks again
  await popup.click('.update-pop-actions button:nth-child(3)'); await sleep(700);
  check('Later closes the popup and leaves the pill', !(await overlayPage()?.evaluate(() => !!document.querySelector('.update-popover')).catch(() => false)) && (await pill())?.phase === 'ready', JSON.stringify(await pill()));
  await shot('4-later-pill-light');
  { const at = await pill(); await crop('4c-pill-light', '4-later-pill-light', {x: at.x - 30, y: 28, width: at.width + 70, height: 36}, 8); }
  await app.cmd({type: 'ui', tabId: (await app.state()).activeTabId, action: 'noop'}).catch(() => {});
  await sleep(1500);
  const idle = await frames(2000);
  check('ready (pill waiting after Later): no idle CPU, no frame callbacks', idle < 2, idle.toFixed(2) + '/s');
  check('not asked again (no nag)', !(await overlayPage()?.evaluate(() => !!document.querySelector('.update-popover')).catch(() => false)));
  // 4. The way back, dark
  await setTheme('dark');
  await app.ui.click('.update-pill'); await sleep(900);
  const again = await poll(async () => { const page = overlayPage(); return page && await page.evaluate(() => !!document.querySelector('.update-popover')) ? page : null; }, Boolean, 'popup from the pill', 8000);
  await shot('5-ready-popup-dark');
  check('popup clip scan (ask view, dark)', /no hits/.test(await again.evaluate(scanner)), await again.evaluate(scanner));
  await again.click('text=' + body.buttons[0]); await sleep(500);
  await shot('6-read-more-dark');
  check('popup clip scan (notes view, dark)', /no hits/.test(await again.evaluate(scanner)), await again.evaluate(scanner));
  // 5. Install now: the session is flushed, then quitAndInstall (stand-in logs it); tabs are still there
  const tabs = (await app.state()).tabs.length;
  await again.click('.update-pop-actions button:nth-child(4)'); await sleep(1500);
  const log = JSON.parse(await fs.readFile(path.join(app.root, 'fixture-roaming', 'update-stub-log.json'), 'utf8').catch(() => 'null') ?? 'null') || JSON.parse(await app.main(() => { const fs = process.mainModule.require('node:fs'), path = process.mainModule.require('node:path'), {app} = process.mainModule.require('electron'); try { return fs.readFileSync(path.join(app.getPath('userData'), 'update-stub-log.json'), 'utf8'); } catch { return 'null'; } })) || [];
  check('Install now: session flushed first, then quitAndInstall', log.map(row => typeof row.event === 'string' ? row.event : Object.keys(row.event)[0]).join(',') === 'session-flushed,quitAndInstall', JSON.stringify(log));
  check('tabs are still open', (await app.state()).tabs.length === tabs, String(tabs));
  await fs.writeFile(path.join(out, 'results.json'), JSON.stringify(results, null, 2));
  if (results.checks.some(item => !item.ok)) process.exitCode = 1;
} catch (error) { console.error('RIG ERROR', error); process.exitCode = 1; await shot('error').catch(() => {}); }
finally { release(); await app.close(); server.close(); console.log('out', out); }
