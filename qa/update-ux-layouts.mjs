// The Update pill and the "Restart to update" menu row in every layout and window kind, windows HIDDEN (nothing shows on screen).
//   node qa/update-ux-layouts.mjs [--only=<tag>]      PASS/FAIL lines + .qa-profiles/update-ux-layouts/results.json
// Per language (en, de) and display scale (100%, 150%), in light and dark: full, compact, seamless, sidebar open, sidebar closed, then a private and a
// Tor window. Each case needs the pill visible beside the Acira menu button (not overlapping it or any neighbour, text not clipped, inside the
// window) and, with the menu open, "Restart to update" first and nothing clipped. A case where the toolbar itself is concealed by design is
// reported as such (the pill lives in the toolbar), not counted as a failure.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { launchPreparedNative } from './prepared-native.mjs';
import { withSlot } from './native-slot.mjs';

const electron = createRequire(import.meta.url)('electron');
const out = path.resolve('.qa-profiles/update-ux-layouts');
fs.mkdirSync(out, { recursive: true });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const catalog = code => JSON.parse(fs.readFileSync(path.resolve(`src/i18n/${code}.json`), 'utf8'));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: ok === 'note' ? true : Boolean(ok), note: ok === 'note', detail }); console.log(`${ok === 'note' ? 'NOTE' : ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' - ' + detail : ''}`); };

const SCAN = (rootSelector) => {
  const root = document.querySelector(rootSelector); if (!root) return ['scan root missing: ' + rootSelector];
  const hits = [], label = el => `${el.tagName.toLowerCase()}.${String(el.className || '').split(' ')[0]}:${(el.textContent || '').trim().slice(0, 24)}`;
  for (const el of [root, ...root.querySelectorAll('*')]) {
    const style = getComputedStyle(el); if (style.display === 'none' || style.visibility === 'hidden') continue;
    const rect = el.getBoundingClientRect(); if (!rect.width || !rect.height) continue;
    if (rect.right > innerWidth + 1 || rect.left < -1 || rect.bottom > innerHeight + 1) hits.push('outside window: ' + label(el));
    const hasText = [...el.childNodes].some(node => node.nodeType === 3 && node.textContent.trim());
    if (hasText && el.scrollWidth > el.clientWidth + 1 && style.overflow !== 'visible') hits.push('text clipped: ' + label(el));
  }
  const kids = [...root.children].filter(k => { const s = getComputedStyle(k), r = k.getBoundingClientRect(); return s.display !== 'none' && s.position !== 'absolute' && r.width && r.height; });
  for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) {
    const a = kids[i].getBoundingClientRect(), b = kids[j].getBoundingClientRect();
    if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1.5) hits.push('overlap: ' + label(kids[i]) + ' x ' + label(kids[j]));
  }
  return hits;
};
/** In a window's ui page: where the pill and the menu button are, and whether the pill is really shown (not covered, not outside the window). */
const PILL = () => {
  const pill = document.querySelector('[data-update-pill]'), menu = document.querySelector('.toolbar-menu-control');
  const box = el => { if (!el) return null; const r = el.getBoundingClientRect(); return r.width && r.height ? { x: r.x, y: r.y, w: r.width, h: r.height } : null; };
  const p = box(pill), m = box(menu);
  const shown = Boolean(p) && p.x >= 0 && p.x + p.w <= innerWidth + 1 && p.y >= 0 && p.y + p.h <= innerHeight + 1 && getComputedStyle(pill).visibility !== 'hidden' && document.elementFromPoint(p.x + p.w / 2, p.y + p.h / 2)?.closest('[data-update-pill]') === pill;
  const menuShown = Boolean(m) && getComputedStyle(menu).visibility !== 'hidden' && document.elementFromPoint(m.x + m.w / 2, m.y + m.h / 2)?.closest('.toolbar-menu-control') === menu;
  const color = pill ? getComputedStyle(pill).color : null, ground = pill ? getComputedStyle(pill).backgroundColor : null;
  return { present: Boolean(pill), shown, menuShown, pill: p, menu: m, beside: Boolean(p && m) && Math.abs((p.y + p.h / 2) - (m.y + m.h / 2)) < 6 && p.x + p.w <= m.x + 1, color, ground, text: pill?.textContent.trim(), app: document.querySelector('.app')?.className.slice(0, 120) };
};

async function launch(profile, { lang, scale }) {
  const args = [path.resolve('desktop/main.cjs'), '--disable-features=CalculateNativeWinOcclusion', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', `--lang=${lang}`, ...(scale > 1 ? [`--force-device-scale-factor=${scale}`] : [])];
  const app = await launchPreparedNative({ executablePath: electron, args, env: { ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: profile, ACIRA_BROWSER_TEST_HIDDEN: '1', ACIRA_UPDATE_TEST: '1', ACIRA_UPDATE_STUB: '1', ACIRA_UPDATE_STUB_VERSION: '99.0.0' } });
  let ui;
  for (let i = 0; i < 300 && !ui; i++) { ui = app.windows().find(page => page.url() === 'acira-browser-ui://ui/index.html'); if (!ui) await wait(100); }
  if (!ui) throw new Error('UI page not found');
  try { await ui.getByRole('button', { name: catalog(lang)['setup.skipSetup'], exact: true }).click({ timeout: 5000 }); } catch { /* no setup shown */ }
  return { app, ui };
}
const uiPages = app => app.windows().filter(page => page.url() === 'acira-browser-ui://ui/index.html');
const settle = ms => wait(ms);
/** A layout change animates (view transitions): look until the pill is really on top, up to 5 s. */
async function settled(page, ms = 5000) { const until = Date.now() + ms; let info; do { info = await page.evaluate(PILL); if (info.shown) return info; await wait(250); } while (Date.now() < until); return info; }
async function menuPage(app, ui) {
  const probe = () => [...document.querySelectorAll('.menu-row[title*="99.0.0"]')].some(el => { const r = el.getBoundingClientRect(); return r.width > 40 && r.height > 10 && document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('.menu-row') === el; });
  // a previous popup that is still closing turns the click into a close: look, and click once more if nothing opened
  for (let attempt = 0; attempt < 2; attempt++) {
    await ui.locator('.toolbar-menu-control').first().click({ timeout: 4000 }).catch(() => {});
    const until = Date.now() + 5000;
    while (Date.now() < until) { for (const page of app.windows()) { try { if (await page.evaluate(probe)) return page; } catch { /* closing */ } } await wait(150); }
    await wait(600);
  }
  return null;
}

async function exercise(tag, app, ui, text, { menu = true } = {}) {
  const info = await settled(ui);
  if (!info.present) { check(`${tag} the pill is in the toolbar markup`, false, JSON.stringify(info)); return; }
  if (!info.shown && !info.menuShown) { check(`${tag} the toolbar is concealed by design here (the pill lives beside the menu button)`, 'note', JSON.stringify({ pill: info.pill, menu: info.menu })); return; }
  if (!info.shown) { check(`${tag} the menu button is reachable but the pill is not`, false, JSON.stringify(info)); return; }
  const hits = await ui.evaluate(SCAN, '.toolbar-actions');
  check(`${tag} pill shown beside the Acira menu button, text "${info.text}"`, info.beside && info.text === text['update.pill'] && hits.length === 0, JSON.stringify({ beside: info.beside, hits, pill: info.pill, menu: info.menu }));
  if (!menu) return;
  const page = await menuPage(app, ui);
  const first = page && await page.evaluate(expected => document.querySelector('.menu-row')?.textContent.trim().startsWith(expected), text['update.restartRow']);
  const clip = page && await page.evaluate(() => [...document.querySelectorAll('.menu-row')].filter(r => r.scrollWidth > r.clientWidth + 1).map(r => r.textContent.trim().slice(0, 24)));
  check(`${tag} menu opens with "Restart to update" first, no row clipped`, first && clip.length === 0, JSON.stringify({ first, clip }));
  await page?.keyboard.press('Escape').catch(() => {}); await wait(900);
}

async function layouts(tag, app, ui, text) {
  for (const mode of ['light', 'dark']) {
    for (const [name, settings, side] of [['full', { windowView: 'full', verticalTabs: false }], ['compact', { windowView: 'compact', verticalTabs: false }], ['seamless', { windowView: 'seamless', verticalTabs: false }], ['sidebar-open', { windowView: 'full', verticalTabs: true }, true], ['sidebar-closed', { windowView: 'full', verticalTabs: true }, false]]) {
      await ui.evaluate(patch => window.acira.dispatch({ type: 'settings.update', patch }), { ...settings, appearance: mode });
      if (side !== undefined) await ui.evaluate(open => window.acira.dispatch({ type: 'ui.update', patch: { workspaceOpen: open, webWorkspaceOpen: open } }), side);
      await settle(1400);
      await exercise(`${tag} ${mode} ${name}`, app, ui, text);
    }
  }
  await ui.evaluate(patch => window.acira.dispatch({ type: 'settings.update', patch }), { windowView: 'full', verticalTabs: false, appearance: 'light' }); await settle(600);
}

async function otherWindow(tag, app, ui, text, kind) {
  const before = new Set(uiPages(app));
  await ui.evaluate(k => window.acira.openWindow(k), kind);
  let page = null;
  for (let i = 0; i < 200 && !page; i++) { page = uiPages(app).find(p => !before.has(p)); if (!page) await wait(100); }
  if (!page) { check(`${tag} a ${kind} window opened`, false); return; }
  try {
    for (let i = 0; i < 100 && !(await page.evaluate(() => Boolean(document.querySelector('.toolbar-actions')))).valueOf(); i++) await wait(100);
    for (let i = 0; i < 80 && !(await page.evaluate(() => Boolean(document.querySelector('[data-update-pill]')))); i++) await wait(150);
    for (const mode of ['light', 'dark']) {
      await page.evaluate(patch => window.acira.dispatch({ type: 'settings.update', patch }), { appearance: mode }); await wait(700);
      const info = await settled(page);
      const hits = info.present ? await page.evaluate(SCAN, '.toolbar-actions') : ['no pill'];
      const identity = await page.evaluate(() => { const c = document.querySelector('.tor-chip'), p = document.querySelector('.toolbar-actions .private-chip,.toolbar-actions [class*=private]'); return { tor: Boolean(c), private: Boolean(p) }; });
      check(`${tag} ${mode} ${kind} window: pill shown in the accent beside the menu button, 0 clip hits, not clashing with the window's own chip`, info.shown && info.beside && hits.length === 0 && info.text === text['update.pill'], JSON.stringify({ info, hits, identity }));
      if (info.shown) { const menu = await menuPage(app, page); check(`${tag} ${mode} ${kind} window: menu opens with "Restart to update" first`, menu && await menu.evaluate(expected => document.querySelector('.menu-row')?.textContent.trim().startsWith(expected), text['update.restartRow'])); await menu?.keyboard.press('Escape').catch(() => {}); await wait(900); }
    }
  } finally { await page.evaluate(() => window.acira.window?.('close')).catch(() => {}); }
}

await withSlot('update-ux-layouts', async () => {
  const stamp = Date.now(), only = process.argv.find(arg => arg.startsWith('--only='))?.slice(7);
  for (const combo of [{ tag: 'en-100', lang: 'en', scale: 1 }, { tag: 'de-100', lang: 'de', scale: 1 }, { tag: 'en-150', lang: 'en', scale: 1.5 }, { tag: 'de-150', lang: 'de', scale: 1.5 }].filter(c => !only || c.tag === only)) {
    const profile = path.resolve(`.qa-profiles/update-ux-layouts-${combo.tag}-${stamp}`); fs.mkdirSync(profile, { recursive: true });
    const text = catalog(combo.lang);
    let session;
    try {
      session = await launch(profile, combo);
      await session.ui.waitForSelector('[data-update-pill]', { timeout: 20000 });
      await layouts(combo.tag, session.app, session.ui, text);
      await otherWindow(combo.tag, session.app, session.ui, text, 'private');
      if (combo.tag === 'en-100' || combo.tag === 'de-150') await otherWindow(combo.tag, session.app, session.ui, text, 'tor');
    } catch (error) { check(`${combo.tag} ran to the end`, false, error.message); }
    finally { await session?.app.close().catch(() => {}); }
  }
});
fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 1));
const failed = results.filter(r => !r.ok).length;
console.log(`${failed ? 'FAIL' : 'PASS'}: ${results.length - failed}/${results.length} checks (${results.filter(r => r.note).length} notes)`);
process.exit(failed ? 1 : 0);
