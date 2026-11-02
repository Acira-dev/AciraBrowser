// Stream L: Acira's own pages show German titles in the tab strip, the sidebar, the tab viewer and the window title, while the stored titles stay English.
//   node qa/l-titles-de.mjs   isolated profile, one Electron, off-screen.
import path from 'node:path';
import { createRequire } from 'node:module';
import { launchPreparedNative } from './prepared-native.mjs';
const data = path.resolve('.qa-profiles/l-titles-' + Date.now());
const app = await launchPreparedNative({
  executablePath: createRequire(import.meta.url)('electron'),
  args: [path.resolve('desktop/main.cjs'), '--disable-features=CalculateNativeWinOcclusion', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
  env: { ...process.env, ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: data, LOCALAPPDATA: path.resolve('.qa-profiles/import-fixture'), ACIRA_BROWSER_TEST_HIDDEN: '1' },
});
const wait = ms => new Promise(r => setTimeout(r, ms));
const rows = [];
const record = (name, ok, detail = '') => { rows.push(ok); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  — ' + detail : '')); };
let exitCode = 1;
try {
  const pick = async test => { for (let i = 0; i < 100; i++) { const p = app.windows().find(p => test(p.url())); if (p) return p; await wait(100); } return null; };
  let ui = await pick(u => u === 'acira-browser-ui://ui/index.html');
  await app.evaluate(({ BaseWindow }) => { const w = BaseWindow.getAllWindows()[0]; w.setBounds({ x: -3000, y: 20, width: 1440, height: 900 }); w.showInactive(); });
  await ui.evaluate(a => window.acira.dispatch(a), { type: 'settings.update', patch: { language: 'de' } }); await wait(3000);
  ui = await pick(u => u === 'acira-browser-ui://ui/index.html');
  try { await ui.getByRole('button', { name: /Einrichtung|Überspringen|Skip/ }).first().click({ timeout: 6000 }); } catch {}
  const act = a => ui.evaluate(a => window.acira.dispatch(a), a);
  for (const page of ['acira://settings', 'acira://history', 'acira://bookmarks', 'acira://downloads', 'acira://rewind', 'acira://routines']) { await act({ type: 'tab.new', url: page }); await wait(900); }
  await wait(800);
  const snap = await ui.evaluate(() => window.acira.getSnapshot());
  record('stored titles stay English', snap.tabs.some(t => t.title === 'Settings') && snap.tabs.some(t => t.title === 'History'), snap.tabs.map(t => t.title).join(', '));
  const strip = await ui.evaluate(() => [...document.querySelectorAll('.browser-tab, .tab-strip-viewport [role=tab]')].map(e => e.textContent.trim()).filter(Boolean));
  record('the strip shows German titles', strip.includes('Einstellungen') && strip.includes('Verlauf') && !strip.includes('Settings'), strip.join(' | '));
  await act({ type: 'settings.update', patch: { verticalTabs: true } }); await wait(1500);
  const side = await ui.evaluate(() => [...document.querySelectorAll('.sb-tab')].map(e => e.textContent.trim()).filter(Boolean));
  record('the sidebar shows German titles', side.includes('Einstellungen') && !side.includes('Settings'), side.join(' | '));
  await app.evaluate(({ webContents }) => { const v = webContents.getAllWebContents().find(w => w.getURL() === 'acira-browser-ui://ui/index.html'); v.focus(); v.sendInputEvent({ type: 'keyDown', keyCode: 't', modifiers: ['alt'] }); v.sendInputEvent({ type: 'keyUp', keyCode: 't', modifiers: ['alt'] }); });
  await wait(1800);
  const overlay = await pick(u => u.includes('view=overlay'));
  const viewer = overlay ? await overlay.evaluate(() => [...document.querySelectorAll('.tab-result strong')].map(e => e.textContent.trim())) : [];
  record('the tab viewer shows German titles', viewer.includes('Einstellungen') && !viewer.includes('Settings'), viewer.join(' | '));
  const windowTitle = await app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows()[0].getTitle());
  const documentTitle = await ui.evaluate(() => document.title);
  record('the window title is not an English page title', !/Settings|Downloads|History|Bookmarks/.test(windowTitle) && !/Settings|Downloads|History|Bookmarks/.test(documentTitle), `window "${windowTitle}", document "${documentTitle}"`);
  console.log(rows.every(Boolean) ? 'ALL PASS' : 'FAILED'); exitCode = rows.every(Boolean) ? 0 : 1;
} catch (error) { console.log('ABORTED: ' + String(error.message).slice(0, 300)); }
finally { await app.close().catch(() => {}); }
process.exit(exitCode);
