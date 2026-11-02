// Stream L: the already-open overlay (menus, popups) follows a language change. Opens the main menu in English, switches to German,
// reopens it and reads the overlay's language and rows.   node qa/l-overlay-lang.mjs   isolated profile, one Electron, off-screen.
import path from 'node:path';
import { createRequire } from 'node:module';
import { launchPreparedNative } from './prepared-native.mjs';
const data = path.resolve('.qa-profiles/l-ovl-' + Date.now());
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
  try { await ui.getByRole('button', { name: 'Skip setup', exact: true }).click({ timeout: 6000 }); } catch {}
  await app.evaluate(({ BaseWindow }) => { const w = BaseWindow.getAllWindows()[0]; w.setBounds({ x: -3000, y: 20, width: 1440, height: 900 }); w.showInactive(); });
  const key = async (k, mods = []) => app.evaluate(({ webContents }, [k, mods]) => { const v = webContents.getAllWebContents().find(w => w.getURL() === 'acira-browser-ui://ui/index.html'); v.focus(); v.sendInputEvent({ type: 'keyDown', keyCode: k, modifiers: mods }); v.sendInputEvent({ type: 'keyUp', keyCode: k, modifiers: mods }); }, [k, mods]);
  const overlayText = async () => { const o = await pick(u => u.includes('view=overlay')); return o ? await o.evaluate(async () => ({ lang: document.documentElement.lang, setting: (await window.acira.getSnapshot()).settings.language, cached: localStorage.getItem('acira-locale'), rows: [...document.querySelectorAll('.menu-row span, .acira-menu-title')].slice(0, 4).map(e => e.textContent) })) : null; };
  await key('f', ['alt']); await wait(1500);
  const before = await overlayText();
  record('the overlay starts in English', !!before && before.lang === 'en', JSON.stringify(before));
  await key('Escape'); await wait(500);
  await ui.evaluate(a => window.acira.dispatch(a), { type: 'settings.update', patch: { language: 'de' } }); await wait(3000);
  await key('f', ['alt']); await wait(2000);
  const after = await overlayText();
  record('the already-open overlay now speaks German', after && after.lang === 'de' && after.rows.includes('Neuer Tab'), JSON.stringify(after));
  console.log(rows.every(Boolean) ? 'ALL PASS' : 'FAILED'); exitCode = rows.every(Boolean) ? 0 : 1;
} catch (error) { console.log('ABORTED: ' + String(error.message).slice(0, 300)); }
finally { await app.close().catch(() => {}); }
process.exit(exitCode);
