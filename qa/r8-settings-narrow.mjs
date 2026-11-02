// R8 settings-narrow, real app: Settings fits the PANE it is in (a split pane, a small window, 150% interface size), not the window. The page
// is constrained to 360 / 480 / 640 css px wide inside a full-size window (what a split pane looks like to it), every section is opened with its
// folds open, and a scan lists anything clipped, overlapping or past the pane's edge. Languages en/de/ar, light and dark.
//   node qa/native-slot.mjs r8-narrow -- node qa/r8-settings-narrow.mjs
//   R8_WIDTHS=360,480 R8_LANGS=en,de R8_THEMES=light R8_SCALES=100 R8_SHOTS=<dir> to narrow a run; R8_CAPTURE=1 writes window PNGs.
// Evidence: scan.json (+ PNGs) under C:\ae\r8\settings-narrow.
import fs from 'node:fs/promises';
import path from 'node:path';
import {startApp, sleep, poll} from './d-harness.mjs';
process.env.D_VISIBLE ??= '1';
const OUT = process.env.R8_SHOTS || 'C:/ae/r8/settings-narrow';
const list = (name, fallback) => (process.env[name] || fallback).split(',').map(s => s.trim()).filter(Boolean);
const WIDTHS = list('R8_WIDTHS', '360,480,640').map(Number), LANGS = list('R8_LANGS', 'en,de,ar'), THEMES = list('R8_THEMES', 'light,dark'), SCALES = list('R8_SCALES', '100,150').map(Number);
const ONLY = process.env.R8_PAGES ? new RegExp(process.env.R8_PAGES, 'i') : null, CAPTURE = Boolean(process.env.R8_CAPTURE);
const root = '.qa-profiles/r8-settings-narrow';
await fs.rm(root, {recursive: true, force: true}); await fs.mkdir(OUT, {recursive: true});
let app;
const act = a => app.ui.evaluate(a => window.acira.dispatch(a), a);
async function shotOnce(name) {
  const b64 = await app.main(async ({BaseWindow, desktopCapturer, screen}) => {
    const win = BaseWindow.getAllWindows()[0]; win.setAlwaysOnTop(true); win.focus(); await new Promise(r => setTimeout(r, 300));
    const b = win.getBounds(), f = screen.getDisplayMatching(b).scaleFactor, id = win.getMediaSourceId();
    const sources = await desktopCapturer.getSources({types: ['window'], thumbnailSize: {width: Math.round(b.width * f), height: Math.round(b.height * f)}});
    const hit = sources.find(s => s.id === id); win.setAlwaysOnTop(false);
    return hit ? hit.thumbnail.toPNG().toString('base64') : null;
  });
  if (!b64) return false; await fs.writeFile(path.join(OUT, name + '.png'), Buffer.from(b64, 'base64')); return true;
}
async function shot(name) { for (let i = 0; i < 3; i++) { if (await shotOnce(name)) return; await sleep(600); } console.log('no capture for', name); }
const constrain = width => app.ui.evaluate(width => {
  let s = document.getElementById('r8-pane'); if (!s) { s = document.createElement('style'); s.id = 'r8-pane'; document.head.append(s); }
  s.textContent = width ? `.browser-settings{width:${width}px!important;max-width:${width}px!important;flex:none!important;margin-inline-end:auto}` : '';
}, width);
const openFolds = () => app.ui.evaluate(() => { document.querySelectorAll('.bs-main details').forEach(d => { d.open = true; }); });
const scan = () => app.ui.evaluate(() => {
  const root = document.querySelector('.browser-settings'), main = document.querySelector('.bs-main'), rr = root.getBoundingClientRect();
  const issues = [], label = el => (el.getAttribute('aria-label') || el.textContent || el.className || el.tagName).toString().replace(/\s+/g, ' ').trim().slice(0, 48);
  const tag = el => `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.split(/\s+/).filter(Boolean).slice(0, 2).join('.') : ''}`;
  const shown = el => { const r = el.getBoundingClientRect(), cs = getComputedStyle(el); return r.width > 0.5 && r.height > 0.5 && cs.visibility !== 'hidden' && cs.display !== 'none' && !el.closest('[hidden],.st-sr-only,.sr-only'); };
  const all = [...root.querySelectorAll('*')].filter(shown).filter(el => !el.closest('svg') || el.tagName === 'svg');
  // 1. anything sticking out of the pane (clipped by its edge) or a horizontal scroll bar on the page column
  const hscroll = main.scrollWidth - main.clientWidth;
  if (hscroll > 1) issues.push({kind: 'hscroll', what: `.bs-main scrolls sideways by ${hscroll}px`});
  for (const el of all) {
    const r = el.getBoundingClientRect(); if (el.closest('.st-results')) continue;
    if (r.right > rr.right + 1 || r.left < rr.left - 1) issues.push({kind: 'outside-pane', what: tag(el), text: label(el), left: Math.round(r.left - rr.left), right: Math.round(r.right - rr.left), pane: Math.round(rr.width)});
  }
  if (hscroll > 1) { const edge = main.getBoundingClientRect().left + main.clientWidth; for (const el of all) { const r = el.getBoundingClientRect(); if (main.contains(el) && r.right > edge + 1 && !el.closest('.st-results,.st-select-list') && ![...el.children].some(c => c.getBoundingClientRect().right > edge + 1)) issues.push({kind: 'beyond-main', what: tag(el), text: label(el), over: Math.round(r.right - edge)}); } }
  // 2. text cut by its own box (overflow hidden / ellipsis) other than the deliberate one-line ellipsis on nav labels and select values
  for (const el of all) {
    const cs = getComputedStyle(el); if (!(cs.overflowX === 'hidden' || cs.overflowX === 'clip' || cs.textOverflow === 'ellipsis')) continue;
    if (cs.webkitLineClamp !== 'none' && cs.webkitLineClamp) continue; // a deliberate N-line title with an ellipsis
    if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0 && (el.textContent || '').trim()) issues.push({kind: cs.textOverflow === 'ellipsis' ? 'ellipsis' : 'text-clipped', what: tag(el), text: label(el), scroll: el.scrollWidth, client: el.clientWidth});
    else if (el.scrollHeight > el.clientHeight + 2 && (cs.overflowY === 'hidden' || cs.overflowY === 'clip') && (el.textContent || '').trim() && !el.matches('details,.bs-sidebar,.bs-sidebar nav,.bs-main,.browser-settings,.st-fold-details')) issues.push({kind: 'text-clipped-v', what: tag(el), text: label(el), scroll: el.scrollHeight, client: el.clientHeight});
  }
  // 3. controls and copy overlapping each other (neither contains the other)
  const parts = all.filter(el => el.matches('button,input,select,textarea,summary,[role=switch],[role=radio],.st-title,.st-copy>p,.st-select-trigger,.st-range,.menu-preview,.menu-customize-row,.toolbar-customize-row,.cc-card,.st-control,.st-fold-copy,.st-note,.st-lede,h1,h2,h3,label,.bs-back') && !el.closest('.st-results,.st-select-list'));
  for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
    const a = parts[i], b = parts[j]; if (a.contains(b) || b.contains(a)) continue;
    if ((a.closest('nav') && b.matches('.bs-back')) || (b.closest('nav') && a.matches('.bs-back'))) continue; // a nav row scrolled under the column's own edge, above the pinned Back
    const x = a.getBoundingClientRect(), y = b.getBoundingClientRect();
    const w = Math.min(x.right, y.right) - Math.max(x.left, y.left), h = Math.min(x.bottom, y.bottom) - Math.max(x.top, y.top);
    if (w > 3 && h > 7) { // a 6px overlap is the note tucked under its group's title row, by design
      if (a.closest('.toolbar-customize-row') === b.closest('.toolbar-customize-row') && a.closest('.toolbar-customize-row') && !a.closest('label') !== !b.closest('label')) { /* a row's own label/check pair is checked by the row's width test below */ }
      issues.push({kind: 'overlap', what: `${tag(a)} "${label(a)}" x ${tag(b)} "${label(b)}"`, w: Math.round(w), h: Math.round(h)});
    }
  }
  // 4. a Customize menu row whose label has no room, and the preview card sitting over its rows
  for (const row of root.querySelectorAll('.menu-customize-row .toolbar-customize-check')) { const r = row.getBoundingClientRect(); if (shown(row) && r.width < 60) issues.push({kind: 'no-room', what: 'menu row label', width: Math.round(r.width), text: label(row)}); }
  // 5. Back to browser reachable and the nav rail does not clip
  const back = root.querySelector('.bs-back'), br = back?.getBoundingClientRect();
  const backOk = Boolean(back && br.width > 8 && br.height > 8 && br.top >= 0 && br.bottom <= innerHeight && br.right <= rr.right);
  const hit = back && document.elementFromPoint(br.left + br.width / 2, br.top + br.height / 2);
  if (!backOk || !(hit && (hit === back || back.contains(hit)))) issues.push({kind: 'back-unreachable', what: back ? JSON.stringify({w: br.width, h: br.height, top: br.top}) : 'missing', hit: hit && tag(hit)});
  const sb = root.querySelector('.bs-sidebar')?.getBoundingClientRect();
  return {pane: Math.round(rr.width), sidebar: sb && Math.round(sb.width), main: Math.round(main.clientWidth), issues};
});
async function cleanup() {
  if (!app) return; const child = (() => { try { return app.app.process(); } catch { return null; } })();
  try { await Promise.race([app.close(), sleep(12000)]); } catch {}
  try { if (child && child.exitCode === null) { child.kill(); await sleep(800); } } catch {}
}
const report = [];
try {
  app = await startApp({root});
  await app.main(({BaseWindow}) => { const w = BaseWindow.getAllWindows()[0]; w.unmaximize(); w.setBounds({x: 40, y: 20, width: 1280, height: 900}); });
  await act({type: 'settings.update', patch: {appearance: 'light', interfaceScale: 100, animationSpeed: 'fast', language: 'en'}});
  await act({type: 'tab.new', url: 'acira://settings'}); await sleep(1800);
  for (const lang of LANGS) for (const scale of SCALES) for (const theme of THEMES) {
    if (lang !== LANGS[0] && theme !== THEMES[0] && scale !== SCALES[0]) continue; // the full cross is light/100 for every language, then dark and 150% in the first language
    await act({type: 'settings.update', patch: {language: lang, appearance: theme, interfaceScale: scale}}); await sleep(1500);
    await constrain(null);
    const pages = await app.ui.evaluate(() => [...document.querySelectorAll('.bs-sidebar nav button')].map(b => b.getAttribute('aria-label')).filter(Boolean));
    for (const width of WIDTHS) {
      await constrain(width); await sleep(400);
      for (const page of pages) {
        if (ONLY && !ONLY.test(page)) continue;
        await app.ui.locator(`.bs-sidebar nav button[aria-label="${page}"]`).click(); await sleep(350);
        await openFolds(); await sleep(700);
        const result = await scan(), tag = `${lang}-${theme}-${scale}-w${width}-${page.replace(/\W+/g, '_')}`;
        const real = result.issues.filter(i => i.kind !== 'ellipsis');
        report.push({tag, lang, theme, scale, width, page, ...result, issueCount: real.length});
        console.log(tag, `pane ${result.pane} side ${result.sidebar} main ${result.main}`, real.length ? `${real.length} issue(s)` : 'clean', result.issues.length - real.length ? `(+${result.issues.length - real.length} ellipsis)` : '');
        for (const i of real.slice(0, 6)) console.log('   ', JSON.stringify(i));
        if (CAPTURE) await shot(tag);
        if (CAPTURE && page === 'Appearance') { // the Customize menu rows and its preview, where the preview used to sit on top of the rows
          await app.ui.evaluate(() => document.querySelector('[data-setting="menu-customize"]')?.scrollIntoView({block: 'start'})); await sleep(500); await shot(tag + '-menu');
          await app.ui.evaluate(() => { document.querySelector('.bs-main').scrollTop = 0; }); await sleep(200);
        }
      }
    }
  }
  await constrain(null);
  await fs.writeFile(path.join(OUT, 'scan.json'), JSON.stringify(report, null, 2));
  const bad = report.filter(r => r.issueCount);
  console.log(`scan done: ${report.length} states, ${bad.length} with issues`);
  if (bad.length) process.exitCode = 1;
} finally { await cleanup(); }
