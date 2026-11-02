// Round 8 bookmark-morph: drag a sidebar tab over Bookmarks (hover light-up), drop it (split into two, each half the icon, each icon
// flies home and opens), in light and dark. Records the UI page with a CDP screencast and saves the frames and a contact sheet.
//   node qa/native-slot.mjs r8-bm -- node qa/r8-bookmark-morph.mjs <outDir> [light|dark ...] [--speed=fast|premium] [--reduced]
// Checks: the bookmark is saved, the tab stays open, nothing of the animation is left behind.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
import {startApp, sleep, poll} from './d-harness.mjs';

const args = process.argv.slice(2), out = path.resolve(args.find(a => !a.startsWith('--') && a !== 'light' && a !== 'dark') || '.qa-profiles/r8-shots');
const modes = args.filter(a => a === 'light' || a === 'dark'); if (!modes.length) modes.push('light', 'dark');
const speed = (args.find(a => a.startsWith('--speed=')) || '--speed=fast').slice(8), reduced = args.includes('--reduced');
await fs.mkdir(out, {recursive: true});

const icon = (c, l) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" rx="7" fill="${c}"/><text x="16" y="22" font-size="18" font-family="Arial" font-weight="700" text-anchor="middle" fill="#fff">${l}</text></svg>`)}`;
const sites = {a: ['Alpha Atlas Notes', '#e5484d'], b: ['Beta Library Index', '#3e63dd'], c: ['Gamma Research Board', '#30a46c'], d: ['Delta Planning Sheet', '#f76b15']};
const server = http.createServer((req, res) => { const k = req.url.slice(1, 2), s = sites[k]; res.writeHead(200, {'Content-Type': 'text/html'}); res.end(`<!doctype html><title>${s?.[0] || 'x'}</title><link rel="icon" href="${icon(s?.[1] || '#888', (s?.[0] || 'x')[0])}"><body style="font:16px sans-serif;padding:40px">${s?.[0]}`); });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;

const results = [];
const check = (name, ok, detail = '') => { results.push({name, ok, detail}); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  - ' + detail : '')); };
await fs.rm(path.resolve('.qa-profiles/r8-bm'), {recursive: true, force: true});
const h = await startApp({root: '.qa-profiles/r8-bm'});
let code = 1;
try {
  const {ui, act, state, app} = h;
  await act({type: 'settings.update', patch: {verticalTabs: true, animationSpeed: speed, reducedMotion: reduced, sidebarWidth: 280}}); await sleep(900);
  for (const k of ['a', 'b', 'c', 'd']) { await act({type: 'tab.new', url: `${base}/${k}`}); await sleep(450); }
  await sleep(900);
  const wc = (fn, arg) => app.evaluate(({webContents}, [src, arg]) => { const w = webContents.getAllWebContents().find(x => x.getURL() === 'acira-browser-ui://ui/index.html'); return new Function('w', 'arg', 'return (' + src + ')(w,arg)')(w, arg); }, [fn.toString(), arg]);
  const send = (type, x, y, extra = {}) => wc((w, a) => w.sendInputEvent(a), {type, x: Math.round(x), y: Math.round(y), ...extra});
  const rect = sel => ui.evaluate(s => { const e = [...document.querySelectorAll(s)].find(e => e.offsetParent && e.getBoundingClientRect().height); if (!e) return null; const b = e.getBoundingClientRect(); return {x: b.x, y: b.y, w: b.width, h: b.height}; }, sel);
  const frames = [];
  const cdp = await ui.context().newCDPSession(ui);
  cdp.on('Page.screencastFrame', ev => { frames.push({t: ev.metadata.timestamp, data: ev.data}); cdp.send('Page.screencastFrameAck', {sessionId: ev.sessionId}).catch(() => {}); });
  const sheet = await chromium.launch({executablePath: process.env.PW_CHROMIUM || 'C:/Users/you/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe'});
  const makeSheet = async (name, list, crop) => {
    const cells = list.map(f => `<div style="width:${crop.w}px;height:${crop.h}px;overflow:hidden;position:relative;border:1px solid #888"><img style="position:absolute;left:${-crop.x}px;top:${-crop.y}px" src="data:image/jpeg;base64,${f.data}"></div>`).join('');
    const page = await sheet.newPage({viewport: {width: (crop.w + 8) * Math.min(list.length, 8), height: (crop.h + 8) * Math.ceil(list.length / 8)}});
    await page.setContent(`<body style="margin:0;background:#777"><div style="display:flex;flex-wrap:wrap;gap:6px;padding:2px">${cells}</div>`); await sleep(200);
    await page.screenshot({path: path.join(out, name + '.png')}); await page.close();
  };
  const leftovers = () => ui.evaluate(() => ({faces: document.querySelectorAll('.sidebar-split-face').length, previews: document.querySelectorAll('.sidebar-tab-drag-preview,.sidebar-tab-drag-gap').length, source: document.querySelectorAll('[data-sidebar-drag-source]').length, arriving: document.querySelectorAll('[data-bookmark-arriving]').length, landing: document.querySelectorAll('.sb-bookmark-landing').length, lit: document.querySelectorAll('.sb-zone[data-dropping]').length, canvas: [...document.querySelectorAll('canvas.liquid-layer')].filter(c => c.style.visibility === 'visible').length}));

  let pass = 0;
  for (const mode of modes) {
    pass++;
    await act({type: 'settings.update', patch: {appearance: mode}}); await sleep(pass === 1 ? 3000 : 1200);
    const want = pass === 1 ? 'c' : 'd', snap0 = await state(), tab = snap0.tabs.find(t => t.url.endsWith('/' + want));
    check(`${mode}: fixture tab exists`, Boolean(tab));
    const row = await rect(`.sb-tab[data-tab-id="${tab.id}"]`), head = await rect('.acira-sidebar [data-zone=bookmarks] .sb-zone-head');
    if (!row || !head) { check(`${mode}: rows found`, false, JSON.stringify({row, head})); continue; }
    const sidebar = await rect('.acira-sidebar'), full = await ui.evaluate(() => ({w: innerWidth, h: innerHeight}));
    const crop = {x: Math.max(0, sidebar.x), y: Math.max(0, Math.min(row.y - 40, head.y - 120)), w: Math.round(sidebar.w + 16), h: 0}; crop.h = Math.round(Math.min(full.h - crop.y, head.y + 230 - crop.y));
    const x0 = row.x + 60, y0 = row.y + row.h / 2, tx = head.x + 90;
    await wc(w => w.focus()); await sleep(600); await send('mouseMove', x0, y0); await sleep(40); await send('mouseDown', x0, y0, {button: 'left', clickCount: 1}); await sleep(120);
    const bookmarkY = head.y + head.h / 2;
    const steps = Math.max(8, Math.ceil(Math.hypot(tx - x0, bookmarkY - y0) / 10));
    for (let i = 1; i <= steps; i++) { await send('mouseMove', x0 + (tx - x0) * i / steps, y0 + (bookmarkY - y0) * i / steps, {modifiers: ['leftButtonDown']}); await sleep(16); }
    await sleep(700);
    // Hover: the section lit, in two stills (before the lift is not needed: this is during).
    // Sample the lit state for a second: it must hold, not flicker as the section opens under the pointer.
    const samples = await ui.evaluate(async () => { const out = []; for (let i = 0; i < 40; i++) { const z = document.querySelector('.acira-sidebar [data-zone=bookmarks]'); out.push(z?.hasAttribute('data-dropping') ? 1 : 0); await new Promise(r => setTimeout(r, 25)); } return out.join(''); });
    const lit = await ui.evaluate(() => { const z = document.querySelector('.acira-sidebar [data-zone=bookmarks]'); const s = z && getComputedStyle(z, '::before'); return {on: z?.hasAttribute('data-dropping'), opacity: s?.opacity}; });
    check(`${mode}: Bookmarks lights up and holds while a tab is over it`, !samples.includes('0') && lit.on === true, samples + ' ' + JSON.stringify(lit));
    await ui.screenshot({path: path.join(out, `${mode}-hover.png`), clip: {x: crop.x, y: crop.y, width: crop.w, height: crop.h}});
    frames.length = 0; await cdp.send('Page.startScreencast', {format: 'jpeg', quality: 92, everyNthFrame: 1}); await sleep(120);
    const before = (await state());
    await send('mouseUp', tx, bookmarkY, {button: 'left', clickCount: 1});
    await sleep(reduced ? 600 : speed === 'premium' ? 2600 : 2000);
    await cdp.send('Page.stopScreencast'); await sleep(100);
    const after = await state(), saved = after.bookmarkNodes.filter(n => n.url && n.url.endsWith('/' + want)).length;
    check(`${mode}: bookmark saved`, saved === 1, `nodes ${before.bookmarkNodes.length} -> ${after.bookmarkNodes.length}`);
    check(`${mode}: tab stays open`, after.tabs.length === before.tabs.length && after.tabs.some(t => t.id === tab.id), `tabs ${before.tabs.length} -> ${after.tabs.length}`);
    const left = await leftovers(); check(`${mode}: nothing left behind`, !left.faces && !left.previews && !left.source && !left.arriving && !left.landing && !left.lit && !left.canvas, JSON.stringify(left));
    const times = frames.map(f => f.t), dur = frames.length > 1 ? ((times.at(-1) - times[0]) * 1000) | 0 : 0;
    console.log(`${mode}: ${frames.length} frames over ${dur} ms`);
    await fs.mkdir(path.join(out, `${mode}-frames`), {recursive: true});
    for (const [i, f] of frames.entries()) await fs.writeFile(path.join(out, `${mode}-frames`, `f${String(i).padStart(3, '0')}.jpg`), Buffer.from(f.data, 'base64'));
    // The strip: frames that differ, at most 40, in order.
    const keep = frames.length <= 40 ? frames : Array.from({length: 40}, (_, i) => frames[Math.round(i * (frames.length - 1) / 39)]);
    await makeSheet(`${mode}-drop-strip`, keep, crop);
    // The last frames at the saved row: the glass leaves and the real row takes over; icon and title must not move.
    await makeSheet(`${mode}-tail`, frames.slice(-8), {x: crop.x, y: crop.y + crop.h - 110, w: crop.w, h: 110});
    await ui.screenshot({path: path.join(out, `${mode}-after.png`), clip: {x: crop.x, y: crop.y, width: crop.w, height: crop.h}});
  }
  await sheet.close();
  code = results.every(r => r.ok) ? 0 : 1;
} catch (error) { console.error('rig error', error); } finally { await h.close(); server.close(); }
process.exit(code);
