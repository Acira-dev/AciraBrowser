// Update UX proof in the real app (isolated profile, native slot, a stand-in updater: no installer ever runs).
//   node qa/update-ux-proof.mjs [--shots]      PASS/FAIL lines + .qa-profiles/update-ux-proof/results.json (+ screenshots with --shots)
// Per language (en, de) and interface scale (100%, 150%), in light and dark:
//   A  the stub finds 99.0.0 -> the Update pill appears (text, tooltip), the Acira menu tops with "Restart to update", the click runs session-flush THEN
//      quitAndInstall (read from the stub's log) and the app is still alive;
//   B  a restart one version later (updater.json seeded as "downloaded 99.0.0 with notes, last ran 0.0.1"; ACIRA_UPDATE_TEST_VERSION=99.0.0) -> the toast
//      "Acira updated to 99.0.0" appears, its What's new action opens the notes dialog, Close closes it;
//   C  (en 100% only) a third launch on the same version shows nothing.
// Every surface gets a clip/overlap scan (text wider than its box, outside the window, overlapping a neighbour); 0 hits expected.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { launchPreparedNative } from './prepared-native.mjs';
import { withSlot } from './native-slot.mjs';

const require = createRequire(import.meta.url);
const electron = require('electron');
const shots = process.argv.includes('--shots');
// The notes dialog is an Acira window: in hidden-window mode (ACIRA_BROWSER_TEST_HIDDEN) the app falls back to a native box, so every run shows its windows.
const visible = true;
const out = path.resolve('.qa-profiles/update-ux-proof');
fs.mkdirSync(out, { recursive: true });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const catalog = code => JSON.parse(fs.readFileSync(path.resolve(`src/i18n/${code}.json`), 'utf8'));
const fill = (text, version) => text.replaceAll('{version}', version);
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: Boolean(ok), detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' - ' + detail : ''}`); };

/** Clip/overlap scan, run inside a page: text wider than its box, anything outside the window, siblings that overlap. */
const SCAN = (rootSelector) => {
  const root = document.querySelector(rootSelector) || document.body, hits = [];
  const label = el => `${el.tagName.toLowerCase()}.${String(el.className || '').toString().split(' ')[0]}:${(el.textContent || '').trim().slice(0, 30)}`;
  const all = [root, ...root.querySelectorAll('*')];
  for (const el of all) {
    const style = getComputedStyle(el); if (style.display === 'none' || style.visibility === 'hidden') continue;
    const rect = el.getBoundingClientRect(); if (!rect.width || !rect.height) continue;
    if (rect.right > innerWidth + 1 || rect.left < -1 || rect.bottom > innerHeight + 1) hits.push('outside window: ' + label(el));
    const hasText = [...el.childNodes].some(node => node.nodeType === 3 && node.textContent.trim());
    if (hasText && el.scrollWidth > el.clientWidth + 1 && style.overflow !== 'visible' && style.textOverflow !== 'ellipsis') hits.push('text clipped: ' + label(el));
    if (hasText && el.scrollWidth > el.clientWidth + 1 && style.textOverflow === 'ellipsis') hits.push('text ellipsized: ' + label(el));
  }
  const kids = [...root.children].filter(k => { const s = getComputedStyle(k), r = k.getBoundingClientRect(); return s.display !== 'none' && s.position !== 'absolute' && r.width && r.height; });
  for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) {
    const a = kids[i].getBoundingClientRect(), b = kids[j].getBoundingClientRect();
    if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1.5) hits.push('overlap: ' + label(kids[i]) + ' x ' + label(kids[j]));
  }
  return hits;
};

async function launch(profile, { lang, scale, env = {}, hidden = true }) {
  const args = [path.resolve('desktop/main.cjs'), '--disable-features=CalculateNativeWinOcclusion', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', `--lang=${lang}`, ...(scale > 1 ? [`--force-device-scale-factor=${scale}`] : [])];
  const app = await launchPreparedNative({ executablePath: electron, args, env: { ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: profile, ACIRA_UPDATE_TEST: '1', ACIRA_UPDATE_STUB: '1', ACIRA_UPDATE_STUB_VERSION: '99.0.0', ...(hidden ? { ACIRA_BROWSER_TEST_HIDDEN: '1' } : {}), ...env } });
  let ui;
  for (let i = 0; i < 300 && !ui; i++) { ui = app.windows().find(page => page.url() === 'acira-browser-ui://ui/index.html'); if (!ui) await wait(100); }
  if (!ui) throw new Error('UI page not found');
  try { await ui.getByRole('button', { name: catalog(lang)['setup.skipSetup'], exact: true }).click({ timeout: 6000 }); } catch { /* no setup shown */ }
  return { app, ui };
}
async function pageWithText(app, text, ms = 12000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    for (const page of app.windows()) { try { if (await page.evaluate(expected => document.body.innerText.includes(expected), text)) return page; } catch { /* page closing */ } }
    await wait(200);
  }
  return null;
}
// the app's own appearance setting (what Settings > Appearance writes), not the OS theme
const theme = async (ui, mode) => { await ui.evaluate(patch => window.acira.dispatch({ type: 'settings.update', patch }), { appearance: mode, verticalTabs: false }); await wait(700); };
async function pageWith(app, probe, ms = 12000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    for (const page of app.windows()) { try { if (await page.evaluate(probe)) return page; } catch { /* page closing */ } }
    await wait(150);
  }
  return null;
}
const stubLog = profile => { try { return JSON.parse(fs.readFileSync(path.join(profile, 'update-stub-log.json'), 'utf8')).map(row => typeof row.event === 'string' ? row.event : Object.keys(row.event)[0]); } catch { return []; } };
const seedBump = profile => fs.writeFileSync(path.join(profile, 'updater.json'), JSON.stringify({ autoDownload: true, channel: 'stable', lastRunVersion: '0.0.1', pending: { version: '99.0.0', notes: 'A calmer, faster start-up.\n• Update notices that stay out of your way.' } }));

async function sessionA(tag, profile, combo) {
  const text = catalog(combo.lang), tip = fill(text['update.pillTip'], '99.0.0');
  const { app, ui } = await launch(profile, { ...combo, hidden: !visible && !combo.shots });
  try {
    await ui.waitForSelector('[data-update-pill]', { timeout: 20000 });
    const pill = await ui.evaluate(() => { const b = document.querySelector('[data-update-pill]'); return { text: b.textContent.trim(), title: b.title, label: b.getAttribute('aria-label') }; });
    check(`${tag} pill appears with the localised text and tooltip`, pill.text === text['update.pill'] && pill.title === tip && pill.label === tip, JSON.stringify(pill));
    for (const mode of ['light', 'dark']) {
      await theme(ui, mode); await wait(500);
      const hits = await ui.evaluate(SCAN, '.toolbar-actions');
      check(`${tag} ${mode}: toolbar with the pill has 0 clip/overlap hits`, hits.length === 0, hits.join(' | '));
      if (combo.shots) await ui.screenshot({ path: path.join(out, `${tag}-${mode}-toolbar.png`), clip: { x: 0, y: 0, width: (await ui.evaluate(() => innerWidth)), height: 120 } });
    }
    // the Acira menu: tops with the Restart row (reopened per theme: a theme change dismisses the popup)
    const openMenu = async () => { await ui.locator('.toolbar-menu-control').first().click(); return pageWith(app, () => [...document.querySelectorAll('.menu-row[title*="99.0.0"]')].some(el => { const r = el.getBoundingClientRect(); return r.width > 40 && r.height > 10 && document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('.menu-row') === el; }), 12000); };
    for (const mode of ['light', 'dark']) {
      await theme(ui, mode); await wait(600);
      const menu = await openMenu();
      check(`${tag} ${mode}: the Acira menu opens with "Restart to update" as its first row`, menu && await menu.evaluate((expected) => document.querySelector('.menu-row')?.textContent.trim().startsWith(expected), text['update.restartRow']));
      if (!menu) continue;
      await wait(350);
      const hits = await menu.evaluate(SCAN, '.menu-row[title*="99.0.0"]');
      const rowsClip = await menu.evaluate(() => [...document.querySelectorAll('.menu-row')].filter(r => r.scrollWidth > r.clientWidth + 1).map(r => r.textContent.trim().slice(0, 30)));
      const popupFits = await menu.evaluate(() => { const rows = [...document.querySelectorAll('.menu-row')], last = rows.at(-1)?.getBoundingClientRect(); return Boolean(last) && last.bottom <= innerHeight + 1 && last.top >= 0; });
      check(`${tag} ${mode}: menu row has 0 clip hits, no row clipped, popup fits`, hits.length === 0 && rowsClip.length === 0 && popupFits, JSON.stringify({ hits, rowsClip, popupFits }));
      if (combo.shots) await menu.screenshot({ path: path.join(out, `${tag}-${mode}-menu.png`) });
      await menu.keyboard.press('Escape').catch(() => {}); await wait(500);
    }
    const menu = await openMenu();
    if (menu) { await menu.locator('.menu-row[title*="99.0.0"]:visible').first().click(); } else await ui.locator('[data-update-pill]').click();
    for (let i = 0; i < 40 && !stubLog(profile).includes('quitAndInstall'); i++) await wait(150);
    const log = stubLog(profile);
    check(`${tag} Restart saves the session first, then calls quitAndInstall (stubbed)`, log.join() === 'session-flushed,quitAndInstall', log.join());
    const again = await ui.evaluate(() => window.acira.service({ type: 'update.install' }).then(result => result.update?.installing === true, error => 'ERR ' + error.message)).catch(error => 'ERR ' + error.message);
    check(`${tag} a second click while installing is answered and does nothing more (the service reply crosses IPC)`, again === true && stubLog(profile).filter(row => row === 'quitAndInstall').length === 1, String(again));
    const alive = await ui.evaluate(() => true).catch(() => false);
    check(`${tag} the stand-in never quits or installs (app still running)`, alive);
  } finally { await app.close().catch(() => {}); }
}

async function sessionB(tag, profile, combo, mode) {
  const text = catalog(combo.lang), toastText = fill(text['update.updatedTo'], '99.0.0');
  seedBump(profile);
  const { app, ui } = await launch(profile, { ...combo, env: { ACIRA_UPDATE_TEST_VERSION: '99.0.0' }, hidden: !visible && !combo.shots });
  try {
    await theme(ui, mode); await wait(300);
    const toast = await pageWithText(app, toastText, 20000);
    check(`${tag} ${mode}: first launch on the new version shows "${toastText}"`, Boolean(toast));
    if (!toast) return;
    await toast.evaluate((expected) => {
      const el = [...document.querySelectorAll('*')].find(node => node.children.length === 0 && node.textContent.includes(expected) && !node.closest('.sr-only')); if (!el) return;
      let card = el; for (let i = 0; i < 6 && card.parentElement; i++) { card = card.parentElement; if (/toast/i.test(String(card.className))) break; }
      card.setAttribute('data-scan-root', '1');
    }, toastText);
    const scan = await toast.evaluate(SCAN, '[data-scan-root]').catch(error => ['scan failed ' + error.message]);
    const hits = [];
    check(`${tag} ${mode}: toast has 0 clip/overlap hits`, scan.length === 0 && hits.length === 0, scan.concat(hits).join(' | '));
    if (combo.shots) await toast.screenshot({ path: path.join(out, `${tag}-${mode}-toast.png`) }).catch(() => ui.screenshot({ path: path.join(out, `${tag}-${mode}-toast.png`) }));
    // What's new
    const clicked = await toast.evaluate((label) => { const el = [...document.querySelectorAll('button,[role=button],a,span,div')].find(node => node.children.length === 0 && node.textContent.trim() === label && !node.closest('.sr-only')); if (!el) return false; (el.closest('button,[role=button]') || el).click(); return true; }, text['update.whatsNew']);
    check(`${tag} ${mode}: the toast carries the What's new action`, clicked);
    const sheet = await pageWithText(app, 'calmer, faster start-up', 10000);
    check(`${tag} ${mode}: What's new opens the release notes`, Boolean(sheet));
    if (sheet) {
      const sheetHits = await sheet.evaluate(SCAN, 'body');
      const short = await sheet.evaluate(() => document.body.scrollHeight <= innerHeight + 1);
      check(`${tag} ${mode}: notes dialog has 0 clip hits and fits`, sheetHits.length === 0 && short, sheetHits.join(' | '));
      if (combo.shots) await sheet.screenshot({ path: path.join(out, `${tag}-${mode}-sheet.png`) });
      await sheet.getByRole('button', { name: text['update.close'], exact: true }).click({ timeout: 5000 }).catch(() => {});
    }
  } finally { await app.close().catch(() => {}); }
}

async function sessionC(profile, combo) {
  const { app } = await launch(profile, { ...combo, env: { ACIRA_UPDATE_TEST_VERSION: '99.0.0' } });
  try {
    const toastText = fill(catalog(combo.lang)['update.updatedTo'], '99.0.0');
    await wait(9000);
    let seen = false;
    for (const p of app.windows()) { try { if (await p.evaluate(expected => document.body.innerText.includes(expected), toastText)) seen = true; } catch {} }
    check('C the same version again shows no note (once per version)', !seen);
  } finally { await app.close().catch(() => {}); }
}

await withSlot('update-ux-proof', async () => {
  const stamp = Date.now();
  const combos = [
    { tag: 'en-100', lang: 'en', scale: 1, shots: shots },
    { tag: 'de-100', lang: 'de', scale: 1, shots: false },
    { tag: 'en-150', lang: 'en', scale: 1.5, shots: false },
    { tag: 'de-150', lang: 'de', scale: 1.5, shots: shots },
  ];
  const only = process.argv.find(arg => arg.startsWith('--only='))?.slice(7);
  for (const combo of combos.filter(item => !only || item.tag === only)) {
    const profile = path.resolve(`.qa-profiles/update-ux-${combo.tag}-${stamp}`);
    fs.mkdirSync(profile, { recursive: true });
    try {
      await sessionA(combo.tag, profile, combo);
      for (const mode of ['light', 'dark']) await sessionB(combo.tag, profile, combo, mode);
      if (combo.tag === 'en-100') await sessionC(profile, combo);
    } catch (error) { check(`${combo.tag} ran to the end`, false, error.message); }
  }
});
fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 1));
const failed = results.filter(r => !r.ok).length;
console.log(`${failed ? 'FAIL' : 'PASS'}: ${results.length - failed}/${results.length} checks`);
process.exit(failed ? 1 : 0);
