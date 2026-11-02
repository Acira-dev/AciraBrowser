// Stream L: "Manage profiles" lands Settings on Profiles. The panel lives in the overlay renderer and hands the target over through
// localStorage (same origin); this sets that target the way the panel does, opens Settings, and reads the section heading.
import path from 'node:path';
import { createRequire } from 'node:module';
import { launchPreparedNative } from './prepared-native.mjs';
const data = path.resolve('.qa-profiles/l-manage-' + Date.now());
const app = await launchPreparedNative({
  executablePath: createRequire(import.meta.url)('electron'),
  args: [path.resolve('desktop/main.cjs')],
  env: { ...process.env, ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: data, LOCALAPPDATA: path.resolve('.qa-profiles/import-fixture'), ACIRA_BROWSER_TEST_HIDDEN: '1' },
});
const wait = ms => new Promise(r => setTimeout(r, ms));
let exitCode = 1;
try {
  let ui = null;
  for (let i = 0; i < 300 && !ui; i++) { ui = app.windows().find(p => p.url() === 'acira-browser-ui://ui/index.html'); if (!ui) await wait(100); }
  try { await ui.getByRole('button', { name: 'Skip setup', exact: true }).click({ timeout: 8000 }); } catch {}
  await app.evaluate(({ BaseWindow }) => { const w = BaseWindow.getAllWindows()[0]; w.setBounds({ x: -3000, y: 20, width: 1440, height: 900 }); w.showInactive(); });
  await ui.evaluate(() => { localStorage.setItem('acira-settings-target', JSON.stringify({ section: 'Profiles', at: Date.now() })); window.acira.dispatch({ type: 'tab.new', url: 'acira://settings' }); });
  let heading = '';
  for (let i = 0; i < 20 && !/Profiles/.test(heading); i++) { await wait(300); heading = await ui.evaluate(() => document.querySelector('[aria-current=page],.settings-nav [aria-selected=true],.settings-nav .active')?.textContent || ''); }
  const ok = /Profiles/.test(heading);
  console.log((ok ? 'PASS' : 'FAIL') + ' Settings opens on the Profiles section — selected: ' + heading);
  exitCode = ok ? 0 : 1;
} catch (error) { console.log('ABORTED: ' + String(error.message).slice(0, 300)); }
finally { await app.close().catch(() => {}); }
process.exit(exitCode);
