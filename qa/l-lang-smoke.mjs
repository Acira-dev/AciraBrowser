// Stream L: smoke in a non-English language: the app runs in each shipped language with no page errors, the pages open, the UI says it is in that language.
//   node qa/l-lang-smoke.mjs [--locales=de,ja]   one Electron per language, closed in finally, off-screen, 8 tabs max.
import path from 'node:path';
import { createRequire } from 'node:module';
import { launchPreparedNative } from './prepared-native.mjs';
const locales = ((process.argv.find(a => a.startsWith('--locales=')) || '').split('=')[1] || 'es,fr,de,pt-BR,it,ja,zh-CN').split(',');
const wait = ms => new Promise(r => setTimeout(r, ms));
let bad = 0;
for (const locale of locales) {
  const data = path.resolve('.qa-profiles/l-smoke-' + locale + '-' + Date.now());
  const app = await launchPreparedNative({
    executablePath: createRequire(import.meta.url)('electron'),
    args: [path.resolve('desktop/main.cjs'), '--disable-features=CalculateNativeWinOcclusion', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
    env: { ...process.env, ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: data, LOCALAPPDATA: path.resolve('.qa-profiles/import-fixture'), ACIRA_BROWSER_TEST_HIDDEN: '1' },
  });
  const errors = [];
  try {
    const pick = async test => { for (let i = 0; i < 100; i++) { const p = app.windows().find(p => test(p.url())); if (p) return p; await wait(100); } return null; };
    let ui = await pick(u => u === 'acira-browser-ui://ui/index.html');
    await app.evaluate(({ BaseWindow }) => { const w = BaseWindow.getAllWindows()[0]; w.setBounds({ x: -3000, y: 20, width: 1440, height: 900 }); w.showInactive(); });
    await ui.evaluate(a => window.acira.dispatch(a), { type: 'settings.update', patch: { language: locale } }); await wait(3000);
    ui = await pick(u => u === 'acira-browser-ui://ui/index.html');
    ui.on('pageerror', e => errors.push(e.message)); ui.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    try { await ui.getByRole('button', { name: /Skip|Einrichtung|Passer|Ignorer|Salta|Omitir|Pular|スキップ|跳过/ }).first().click({ timeout: 6000 }); } catch {}
    for (const page of ['acira://settings', 'acira://history', 'acira://bookmarks', 'acira://downloads', 'acira://rewind', 'acira://routines']) { await ui.evaluate(a => window.acira.dispatch(a), { type: 'tab.new', url: page }); await wait(1200); }
    const lang = await ui.evaluate(() => document.documentElement.lang), tabs = (await ui.evaluate(() => window.acira.getSnapshot())).tabs.length;
    const ok = lang === locale && errors.length === 0 && tabs >= 6;
    if (!ok) bad++;
    console.log((ok ? 'PASS ' : 'FAIL ') + locale + ` — lang ${lang}, tabs ${tabs}, errors ${errors.length}${errors[0] ? ': ' + errors[0].slice(0, 120) : ''}`);
  } catch (error) { bad++; console.log('FAIL ' + locale + ' — ' + String(error.message).slice(0, 160)); }
  finally { await app.close().catch(() => {}); }
}
process.exit(bad ? 1 : 0);
