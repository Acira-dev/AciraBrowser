// Stream L: preferences survive a restart. Launch 1 changes native settings, window layout and the sidebar's own preferences through
// the real controls; launch 2 on the same profile folder reads them back. One Electron at a time, closed in finally.
//   node qa/l-restart-prefs.mjs
import path from 'node:path';
import { createRequire } from 'node:module';
import { launchPreparedNative } from './prepared-native.mjs';
const data = path.resolve('.qa-profiles/l-restart-' + Date.now());
const wait = ms => new Promise(r => setTimeout(r, ms));
async function launch() {
  const app = await launchPreparedNative({
    executablePath: createRequire(import.meta.url)('electron'),
    args: [path.resolve('desktop/main.cjs'), '--disable-features=CalculateNativeWinOcclusion', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
    env: { ...process.env, ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: data, LOCALAPPDATA: path.resolve('.qa-profiles/import-fixture'), ACIRA_BROWSER_TEST_HIDDEN: '1' },
  });
  let ui = null;
  for (let i = 0; i < 300 && !ui; i++) { ui = app.windows().find(p => p.url() === 'acira-browser-ui://ui/index.html'); if (!ui) await wait(100); }
  if (!ui) throw Error('no ui');
  try { await ui.getByRole('button', { name: 'Skip setup', exact: true }).click({ timeout: 6000 }); } catch {}
  await app.evaluate(({ BaseWindow }) => { const w = BaseWindow.getAllWindows()[0]; w.setBounds({ x: -3000, y: 20, width: 1440, height: 900 }); w.showInactive(); });
  return { app, ui, snap: () => ui.evaluate(() => window.acira.getSnapshot()), act: a => ui.evaluate(a => window.acira.dispatch(a), a) };
}
const rows = [];
const record = (name, ok, detail = '') => { rows.push(ok); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  — ' + detail : '')); };
const PATCH = { tabViewerDensity: 'compact', bookmarksBar: true, verticalTabs: true, sidebarWidth: 301, compactTabTitles: false, showHome: false, showTabOverview: false, addressSuggestions: false, reducedMotion: true, bookmarksOnNewTabOnly: true, interfaceScale: 110 };
let exitCode = 1, first = null, second = null;
const railKeys = ui => ui.evaluate(() => Object.fromEntries(Object.keys(localStorage).filter(k => /^acira-/.test(k)).map(k => [k, localStorage.getItem(k)])));
try {
  first = await launch();
  await first.act({ type: 'settings.update', patch: PATCH }); await wait(600);
  await first.act({ type: 'ui.update', patch: { workspaceOpen: false } }); await wait(400);
  // A sidebar section folded with a real click on its header (stored by the sidebar itself).
  const toggle = first.ui.locator('.sb-zone-toggle').first();
  const hadToggle = await toggle.count();
  if (hadToggle) { await toggle.click({ timeout: 4000 }); await wait(500); }
  const before = await railKeys(first.ui), s1 = await first.snap();
  console.log('launch 1 stored keys:', Object.keys(before).join(', '));
  record('launch 1 took the settings', Object.entries(PATCH).every(([k, v]) => s1.settings[k] === v), JSON.stringify(Object.entries(PATCH).filter(([k, v]) => s1.settings[k] !== v)));
  await wait(1500);
  await first.app.close(); first = null; await wait(1500);
  second = await launch(); await wait(1500);
  const s2 = await second.snap(), after = await railKeys(second.ui);
  record('sidebar open/closed survives restart: workspaceOpen', s2.windowUi.workspaceOpen === false, 'false -> ' + s2.windowUi.workspaceOpen);
  for (const [k, v] of Object.entries(PATCH)) record('setting survives restart: ' + k, s2.settings[k] === v, `${JSON.stringify(v)} -> ${JSON.stringify(s2.settings[k])}`);
  for (const k of Object.keys(before)) if (/rail-prefs|toolbar|chrome|new-tab|study|sidebar/.test(k)) record('stored preference survives restart: ' + k, after[k] === before[k], String(before[k]).slice(0, 60) + ' -> ' + String(after[k]).slice(0, 60));
  console.log(rows.every(Boolean) ? 'ALL PASS' : 'FAILED'); exitCode = rows.every(Boolean) ? 0 : 1;
} catch (error) { console.log('ABORTED: ' + String(error.message).slice(0, 300)); }
finally { await first?.app.close().catch(() => {}); await second?.app.close().catch(() => {}); }
process.exit(exitCode);
