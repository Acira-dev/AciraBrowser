// Coordinator: the app must still be alive and answering after 35 s (25 Oct: a main-process ReferenceError fired by a
// 20 s timer froze every launch behind Electron's error dialog; unit tests never run that long). Prints PASS/FAIL.
//   node qa/coord-uptime-smoke.mjs                          source tree
//   D_APP_EXE=<AciraBrowser.exe> node qa/coord-uptime-smoke.mjs   an installed or packaged build
import path from 'node:path';
import { createRequire } from 'node:module';
import { launchPreparedNative } from './prepared-native.mjs';

const data = path.resolve('.qa-profiles/coord-uptime-' + Date.now());
const packaged = process.env.D_APP_EXE ? path.resolve(process.env.D_APP_EXE) : null;
const app = await launchPreparedNative({
  executablePath: packaged || createRequire(import.meta.url)('electron'),
  args: [...(packaged ? [] : [path.resolve('desktop/main.cjs')]), '--disable-features=CalculateNativeWinOcclusion', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
  env: { ...process.env, ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: data, ACIRA_BROWSER_TEST_HIDDEN: '1' },
});
const wait = ms => new Promise(r => setTimeout(r, ms));
const errors = [];
app.process().stderr?.on('data', chunk => { const text = String(chunk); if (/ReferenceError|TypeError|Uncaught|A JavaScript error/.test(text)) errors.push(text.trim().slice(0, 300)); });
let exitCode = 1;
try {
  let ui;
  for (let i = 0; i < 300 && !ui; i++) { ui = app.windows().find(p => p.url() === 'acira-browser-ui://ui/index.html'); if (!ui) await wait(100); }
  if (!ui) throw Error('UI page not found');
  try { await ui.getByRole('button', { name: 'Skip setup', exact: true }).click({ timeout: 8000 }); } catch {}
  await wait(35000);
  const tabs = await ui.evaluate(() => window.acira.getSnapshot().then(s => s.tabs.length));
  const dialogs = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(w => w.isModal?.()).length);
  const ok = tabs >= 1 && errors.length === 0 && dialogs === 0;
  console.log((ok ? 'PASS' : 'FAIL') + ` alive after 35 s — tabs ${tabs}, main errors ${errors.length}, modal windows ${dialogs}`);
  for (const e of errors) console.log('  ' + e);
  exitCode = ok ? 0 : 1;
} catch (error) {
  console.log('FAIL ' + error.message);
} finally {
  await app.close().catch(() => {});
}
process.exit(exitCode);
