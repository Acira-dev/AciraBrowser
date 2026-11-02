// Design lab for the share picker and the sharing pill (public/share.html, share.js). The real page runs in Chromium with a stub of its
// bridge (window.aciraShare) and synthetic sources: generated pictures (16:9, 4:3, tall), long window names and tab titles, never a real
// screen. Matrix: light/dark × 100/150% × en/de/fr/ru × 1/3/12 sources; every group (Entire screen, Window, Acira tab) is scanned with
// qa/m-clip-scan.js plus a vertical check (text cut by its box or overlapping the next line). Pictures and contact sheets go to
// C:\ae\r4\media-capture\lab\. Usage (cwd = repo): node qa/share-picker-lab.mjs
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
import shareUi from '../desktop/share-ui.cjs';

const OUT = 'C:\\ae\\r4\\media-capture\\lab';
await fs.mkdir(OUT, {recursive: true});
const root = path.resolve('public');
const types = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.woff2': 'font/woff2', '.png': 'image/png'};
const server = await new Promise(resolve => { const s = http.createServer(async (req, res) => {
  const file = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!file.startsWith(root)) { res.statusCode = 403; return res.end(); }
  try { res.setHeader('content-type', types[path.extname(file)] || 'application/octet-stream'); res.end(await fs.readFile(file)); } catch { res.statusCode = 404; res.end(); }
}); s.listen(0, '127.0.0.1', () => resolve(s)); });
const base = `http://127.0.0.1:${server.address().port}`;
const scanner = await fs.readFile(path.resolve('qa/m-clip-scan.js'), 'utf8');
// Vertical safety: a line's glyph box must sit inside its element and its clipping ancestor (scrolling lists excepted), and two lines of
// one card must not overlap.
const vertical = `(() => { const hits = [];
  for (const el of document.querySelectorAll('h1,p,span,button,label,small')) {
    const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden' || el.closest('[hidden]')) continue;
    if (![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
    const r = el.getBoundingClientRect(), range = document.createRange(); range.selectNodeContents(el); const t = range.getBoundingClientRect();
    if (!r.height || !t.height) continue;
    const fs = parseFloat(cs.fontSize), lh = cs.lineHeight === 'normal' ? fs * 1.2 : parseFloat(cs.lineHeight);
    if (cs.overflowY !== 'visible' && lh < fs * 1.3) hits.push('line-height too tight for a clipped box: ' + el.className + ' ' + lh + '/' + fs);
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { const ps = getComputedStyle(p); if (ps.overflowY === 'auto' || ps.overflowY === 'scroll') break; if (ps.overflow !== 'visible') { const pr = p.getBoundingClientRect(); if (t.top < pr.top - 0.5 || t.bottom > pr.bottom + 0.5) hits.push('text cut vertically by ' + p.className + ': ' + el.textContent.slice(0, 30)); break; } }
  }
  for (const meta of document.querySelectorAll('.meta')) { const a = meta.querySelector('.name'), b = meta.querySelector('.sub'); if (a && b && a.getBoundingClientRect().bottom > b.getBoundingClientRect().top + 0.5) hits.push('name overlaps subtitle: ' + a.textContent.slice(0, 30)); }
  for (const b of document.querySelectorAll('footer button, .seg button, #pill button')) { if (b.scrollWidth > b.clientWidth + 1 && getComputedStyle(b).textOverflow !== 'ellipsis') hits.push('button text cut: ' + b.textContent); }
  return hits; })()`;

const catalogs = Object.fromEntries(await Promise.all(['en', 'de', 'fr', 'ru'].map(async lang => [lang, JSON.parse(await fs.readFile(path.resolve(`src/i18n/${lang}.json`), 'utf8'))])));
const tm = (lang, id, params = {}) => String(catalogs[lang][id] ?? catalogs.en[id]).replace(/\{(\w+)\}/g, (_, k) => params[k] ?? '');
const WINDOW_NAMES = ['Quarterly planning — final review (copy 3).docx — Word', 'Inbox (1,204) — work@example.com — Mail', 'Notes', 'Terminal — npm run build — 120×40', 'Phone Link', 'Figma — Acira share picker — v12 (final, really final)', 'Calculator', 'Пример окна с очень длинным названием — Документ', 'Spotify Premium', 'Fenêtre de démonstration — Présentation trimestrielle', 'Settings', 'Visual Studio Code — share-ui.cjs — Acira'];
const TAB_TITLES = [['Weekly sync — Google Meet', 'meet.example'], ['A very long article title that keeps going well past the width of any card in the picker', 'news.example.co.uk'], ['Docs', 'docs.example'], ['Pull request #4182: Let extensions record tabs and screens', 'git.example'], ['Untitled', 'localhost'], ['Ваш календарь на неделю', 'calendar.example'], ['Tableau de bord — Ventes', 'dash.example.fr'], ['Discord | #general', 'discord.example'], ['YouTube', 'video.example'], ['Kanban', 'board.example'], ['Mail', 'mail.example'], ['Map of Lisbon', 'maps.example']];
const payload = (lang, count, dark) => {
  const screens = Array.from({length: Math.min(count, 3)}, (_, i) => ({key: `screen:${i}:0`, group: 'screen', label: count === 1 ? 'Entire screen' : `Screen ${i + 1}`, detail: '', ratio: '16:9'}));
  const windows = Array.from({length: count}, (_, i) => ({key: `window:${i}:0`, group: 'window', label: WINDOW_NAMES[i % WINDOW_NAMES.length], detail: '', ratio: ['16:9', '4:3', '9:16'][i % 3]}));
  const tabs = Array.from({length: count}, (_, i) => ({key: `tab:${i}`, group: 'tab', label: TAB_TITLES[i % TAB_TITLES.length][0], detail: TAB_TITLES[i % TAB_TITLES.length][1], ratio: '16:10'}));
  return {mode: 'picker', dark, groups: ['screen', 'window', 'tab'], audio: {screen: true, window: false, tab: true}, items: [...screens, ...windows, ...tabs],
    text: {title: tm(lang, 'main.shareChooseTitle'), detail: tm(lang, 'main.shareChooseDetail', {name: 'Acira capture probe'}), screen: tm(lang, 'main.shareScreens'), window: tm(lang, 'main.shareWindows'), tab: tm(lang, 'main.shareTabs'), audio: tm(lang, 'main.shareAudio'), cancel: tm(lang, 'main.cancel'), share: tm(lang, 'main.share'), empty: tm(lang, 'main.shareNothing')}};
};
const STUB = () => {
  window.__share = {};
  window.aciraShare = {onInit: cb => { window.__share.init = cb; }, onThumbs: cb => { window.__share.thumbs = cb; }, ready: size => { window.__share.ready = size; }, respond: a => { window.__share.answer = a; }, stop: () => { window.__share.stopped = true; }};
  // Generated pictures: a gradient with a frame, in the source's own shape.
  window.__picture = (ratio, hue) => { const [w, h] = ratio.split(':').map(Number), c = document.createElement('canvas'); c.width = 320; c.height = Math.round(320 * h / w); if (c.height > 400) { c.height = 400; c.width = Math.round(400 * w / h); } const x = c.getContext('2d'), g = x.createLinearGradient(0, 0, c.width, c.height); g.addColorStop(0, `hsl(${hue} 60% 55%)`); g.addColorStop(1, `hsl(${hue + 60} 60% 35%)`); x.fillStyle = g; x.fillRect(0, 0, c.width, c.height); x.fillStyle = 'rgb(255 255 255 / .85)'; x.fillRect(12, 12, c.width - 24, 18); return c.toDataURL('image/png'); };
};

const results = [], shots = [];
// The Playwright build pinned here may lack its own browser; the cached chromium-1223 headless shell is used (env LAB_CHROME overrides).
const browser = await chromium.launch({headless: true, executablePath: process.env.LAB_CHROME || path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium_headless_shell-1223', 'chrome-headless-shell-win64', 'chrome-headless-shell.exe')});
try {
  for (const dark of [false, true]) for (const scale of [1, 1.5]) for (const lang of ['en', 'de', 'fr', 'ru']) for (const count of [1, 3, 12]) {
    const tag = `${dark ? 'dark' : 'light'}-${scale * 100}-${lang}-${count}`;
    const context = await browser.newContext({viewport: {width: 680, height: 700}, deviceScaleFactor: scale, colorScheme: dark ? 'dark' : 'light'});
    const page = await context.newPage(); await page.addInitScript(STUB);
    await page.goto(base + '/share.html'); await page.waitForFunction(() => window.__share.init);
    const data = payload(lang, count, dark);
    await page.evaluate(p => { p.items.forEach((item, i) => { item.thumb = window.__picture(item.ratio, i * 47 % 360); }); window.__share.init(p); }, data);
    await page.waitForFunction(() => window.__share.ready); const size = await page.evaluate(() => window.__share.ready);
    await page.setViewportSize({width: 680, height: size.height}); await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(250);
    const hits = [];
    for (const group of ['screen', 'window', 'tab']) {
      await page.click(`.seg [data-group="${group}"]`); await page.waitForTimeout(220);
      const scan = await page.evaluate(scanner), more = await page.evaluate(vertical);
      if (!/no hits/.test(scan)) hits.push(`${group}: ${scan}`);
      for (const m of more) hits.push(`${group}: ${m}`);
      if (group === (count === 1 ? 'screen' : 'window') || (group === 'tab' && count === 3)) {
        if (group === 'tab') await page.keyboard.press('Tab'); // a focus ring in the shot
        const file = path.join(OUT, `picker-${tag}-${group}.png`); await page.screenshot({path: file}); shots.push(file);
      }
    }
    if (count === 12) { await page.click('.seg [data-group="window"]'); await page.$eval('#items', el => { el.scrollTop = el.scrollHeight; el.dispatchEvent(new Event('scroll')); }); await page.waitForTimeout(150); const file = path.join(OUT, `picker-${tag}-window-end.png`); await page.screenshot({path: file}); shots.push(file); }
    results.push({tag, height: size.height, hits});
    await context.close();
  }
  // The pill, at its longest: the longest name each language makes.
  for (const dark of [false, true]) for (const scale of [1, 1.5]) for (const lang of ['en', 'de', 'fr', 'ru']) for (const [kind, who, more] of [['screen', 'meet.example', ''], ['tab', 'Acira capture probe with a long extension name', '+1']]) {
    const tag = `${dark ? 'dark' : 'light'}-${scale * 100}-${lang}-${kind}`;
    const context = await browser.newContext({viewport: {width: 760, height: 120}, deviceScaleFactor: scale, colorScheme: dark ? 'dark' : 'light'});
    const page = await context.newPage(); await page.addInitScript(STUB);
    await page.goto(base + '/share.html?pill'); await page.waitForFunction(() => window.__share.init);
    await page.evaluate(p => window.__share.init(p), {mode: 'pill', dark, text: {...shareUi.pillParts((id, params) => tm(lang, id, params), {screen: 'main.sharingScreen', tab: 'main.sharingTab'}[kind], who), stop: tm(lang, 'main.stopSharing'), more}});
    await page.waitForFunction(() => window.__share.ready); const size = await page.evaluate(() => window.__share.ready);
    await page.setViewportSize({width: Math.min(720, size.width), height: size.height}); await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(400);
    const scan = await page.evaluate(scanner), more2 = await page.evaluate(vertical), hits = [];
    if (!/no hits/.test(scan)) hits.push(scan); hits.push(...more2);
    const fits = await page.evaluate(() => { const r = document.getElementById('pill').getBoundingClientRect(); return r.right <= innerWidth && r.bottom <= innerHeight; });
    if (!fits) hits.push('pill does not fit its window');
    const file = path.join(OUT, `pill-${tag}.png`); await page.screenshot({path: file, omitBackground: true}); shots.push(file);
    results.push({tag: 'pill-' + tag, width: size.width, hits});
    await context.close();
  }
  // Contact sheets so every picture is looked at: one per theme × scale for the picker, one for all pills.
  const sheet = async (name, files, width) => {
    const page = await browser.newPage({viewport: {width, height: 400}});
    await page.setContent(`<body style="margin:0;padding:12px;background:#777;font:12px system-ui;display:flex;flex-wrap:wrap;gap:12px;align-items:flex-start">${files.map(f => `<figure style="margin:0"><img style="display:block;width:${f.includes('pill-') ? 'auto' : '340px'};max-width:${f.includes('pill-') ? '480px' : '340px'}" src="data:image/png;base64,${''}"><figcaption style="color:#fff">${path.basename(f, '.png')}</figcaption></figure>`).join('')}</body>`);
    const images = await Promise.all(files.map(f => fs.readFile(f).then(b => b.toString('base64'))));
    await page.evaluate(list => { document.querySelectorAll('img').forEach((img, i) => { img.src = 'data:image/png;base64,' + list[i]; }); }, images);
    await page.evaluate(() => Promise.all([...document.images].map(i => i.decode())));
    await page.screenshot({path: path.join(OUT, `sheet-${name}.png`), fullPage: true}); await page.close();
  };
  for (const dark of ['light', 'dark']) for (const scale of [100, 150]) await sheet(`picker-${dark}-${scale}`, shots.filter(f => path.basename(f).startsWith(`picker-${dark}-${scale}-`)), 1460);
  await sheet('pills', shots.filter(f => path.basename(f).startsWith('pill-')), 1460);
} finally { await browser.close(); server.close(); }
await fs.writeFile(path.join(OUT, 'scan-results.json'), JSON.stringify(results, null, 2));
const bad = results.filter(r => r.hits.length);
console.log(`combinations ${results.length}, with hits ${bad.length}, screenshots ${shots.length}`);
for (const r of bad.slice(0, 20)) console.log(r.tag, JSON.stringify(r.hits).slice(0, 400));
