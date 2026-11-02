// Windows 10 / Windows 11 behaviour on one Windows 11 machine. ACIRA_WINDOWS_BUILD (honoured only with a test profile) makes the app believe it runs on
// another build, so the real window code takes the real fallback path; APPDATA and LOCALAPPDATA live under a folder with a space and a non-ASCII letter
// (the "C:\Users\Jöhn Doe" case; the profile itself must sit in .qa-profiles for the prepared-native rig). Takes one native slot (C:\ae\slot-N.lock, flag wx) and releases it in finally. Prints PASS/FAIL per build.
//   node qa/windows-compat-smoke.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { launchPreparedNative } from './prepared-native.mjs';

const wait = ms => new Promise(r => setTimeout(r, ms));
const root = process.env.COMPAT_ROOT || 'C:\\ae\\r3\\compat\\Jöhn Doe';
const cases = [
  { name: 'Windows 10 22H2 (19045)', build: '19045', acrylic: false },
  { name: 'Windows 10 1809 (17763)', build: '17763', acrylic: false },
  { name: 'Windows 11 21H2 (22000)', build: '22000', acrylic: false },
  { name: 'Windows 11 24H2 (26100)', build: '26100', acrylic: true },
];

async function takeSlot() {
  fs.mkdirSync('C:\\ae', { recursive: true });
  for (let attempt = 0; attempt < 40; attempt++) {
    for (const n of [1, 2, 3]) {
      const file = `C:\\ae\\slot-${n}.lock`;
      try { fs.writeFileSync(file, `windows-compat ${new Date().toISOString()}\n`, { flag: 'wx' }); return file; } catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    await wait(30000);
  }
  throw new Error('no native slot free after 20 minutes');
}

async function probe(testCase, index) {
  const home = path.join(root, `run-${index}`);
  fs.mkdirSync(path.join(home, 'AppData', 'Roaming'), { recursive: true });
  fs.mkdirSync(path.join(home, 'AppData', 'Local'), { recursive: true });
  const app = await launchPreparedNative({
    executablePath: createRequire(import.meta.url)('electron'),
    args: [path.resolve('desktop/main.cjs'), '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
    env: { ...process.env, ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: path.resolve('.qa-profiles', `windows-compat-${index}-${Date.now()}`), APPDATA: path.join(home, 'AppData', 'Roaming'), LOCALAPPDATA: path.join(home, 'AppData', 'Local'), ACIRA_BROWSER_TEST_HIDDEN: '1', ACIRA_WINDOWS_BUILD: testCase.build },
  });
  const errors = [], watchdog = setTimeout(() => app.process().kill(), 75000); // bounded: a launch that never reaches the UI page cannot hold the slot
  app.process().stderr?.on('data', chunk => { const text = String(chunk); if (/ReferenceError|TypeError|Uncaught|A JavaScript error/.test(text)) errors.push(text.trim().slice(0, 300)); });
  try {
    let ui;
    for (let i = 0; i < 300 && !ui; i++) { ui = app.windows().find(p => p.url() === 'acira-browser-ui://ui/index.html'); if (!ui) await wait(100); }
    if (!ui) throw Error('UI page not found');
    try { await ui.getByRole('button', { name: 'Skip setup', exact: true }).click({ timeout: 8000 }); } catch {}
    let material = null;
    for (let i = 0; i < 50 && material !== 'acrylic'; i++) { material = await ui.evaluate(() => document.documentElement.dataset.material || null); if (material !== 'acrylic') await wait(100); }
    const frame = await app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().map(w => w.getBackgroundColor()));
    await wait(3000);
    const tabs = await ui.evaluate(() => window.acira.getSnapshot().then(s => s.tabs.length));
    const transparentFrame = frame.some(color => /^#0{6}(0{2})?$/i.test(color)); // acrylic windows are created with #00000000; the solid fallback paints --frame
    const ok = tabs >= 1 && errors.length === 0 && (testCase.acrylic ? material === 'acrylic' && transparentFrame : (material === null || material === 'none') && !transparentFrame);
    console.log(`${ok ? 'PASS' : 'FAIL'} ${testCase.name}: data-material=${material}, window background ${frame.join(',')}, tabs ${tabs}, main errors ${errors.length}`);
    for (const e of errors) console.log('  ' + e);
    return ok;
  } finally {
    clearTimeout(watchdog);
    await app.close().catch(() => {});
  }
}

let slot = null, failed = false;
try {
  slot = await takeSlot();
  for (const [index, testCase] of cases.entries()) {
    try { if (!(await probe(testCase, index))) failed = true; } catch (error) { failed = true; console.log(`FAIL ${testCase.name}: ${error.message}`); }
  }
} finally {
  if (slot) fs.rmSync(slot, { force: true });
}
process.exit(failed ? 1 : 0);
