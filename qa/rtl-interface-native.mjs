// Requires the coordinator's global native/build lease. One disposable instance.
// D_APP_EXE selects a packaged Windows executable, as in d-harness.mjs.
// Run after the current UI/native catalog build: --tone=light|dark --scale=100|150.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { launchPreparedNative } from './prepared-native.mjs';
import { resolveRtlTarget } from './rtl-target.mjs';
import { finaleEnded } from './d-harness.mjs';

const arg = (name, fallback) => process.argv.find(value => value.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;
const tone = arg('tone', 'light'), scale = Number(arg('scale', '100'));
assert.ok(['light', 'dark'].includes(tone));
assert.ok([100, 150].includes(scale));
const target = await resolveRtlTarget();
const stamp = Date.now(), data = path.resolve(`.qa-profiles/rtl-interface-${stamp}`);
const out = path.resolve(`qa/artifacts/rtl-interface-${tone}-${scale}-${stamp}`);
const reportPath = path.join(out, 'report.json');
await fs.mkdir(out, { recursive: true });
const report = { target: target.metadata, tone, scale, checks: [], captures: [], passed: false };
let app;
let reportSha256;
const check = (name, condition) => { report.checks.push({ name, passed: Boolean(condition) }); assert.ok(condition, name); };
try {
  app = await launchPreparedNative({
    executablePath: target.executablePath,
    args: target.args,
    env: { ...process.env, ACIRA_DEV: '0', ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: data, ACIRA_BROWSER_TEST_HIDDEN: '1' },
    colorScheme: tone,
  });
  report.runtime = await app.evaluate(({ app }) => ({ executablePath: process.execPath, appPath: app.getAppPath(), version: app.getVersion(), packaged: app.isPackaged }));
  const runtimeExecutable = await fs.realpath(report.runtime.executablePath);
  check('runtime executable matches selected target', runtimeExecutable.toLowerCase() === target.metadata.executable.path.toLowerCase());
  check('runtime package mode matches selected target', report.runtime.packaged === (target.metadata.kind === 'packaged'));
  if (target.metadata.kind === 'packaged') {
    check('runtime archive matches selected target', (await fs.realpath(report.runtime.appPath)).toLowerCase() === target.metadata.appArchive.path.toLowerCase());
  }
  let ui;
  for (let attempt = 0; attempt < 100 && !ui; attempt++) {
    ui = app.windows().find(page => page.url() === 'acira-browser-ui://ui/index.html');
    if (!ui) await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ui, 'main UI available');
  await app.evaluate(({ BaseWindow }) => {
    const window = BaseWindow.getAllWindows()[0];
    window.setBounds({ x: -3000, y: 20, width: 1440, height: 900 });
    window.showInactive();
  });
  const capture = async name => {
    await fs.writeFile(path.join(out, `${name}.png`), await ui.screenshot());
    report.captures.push(`${name}.png`);
  };
  const act = action => ui.evaluate(value => window.acira.dispatch(value), action);
  // Setup draws an invisible, inert rehearsal copy of the welcome for about a second (R4 GPU warm-up): a second `.fr-w-lang-button`. Wait for it to go.
  await ui.locator('.fr-w-lang-button').first().waitFor({ timeout: 15000 });
  await ui.locator('.fr-rehearsal').waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
  await act({ type: 'settings.update', patch: { language: 'ar', interfaceScale: scale, appearance: tone } });
  await ui.waitForFunction(() => document.documentElement.lang === 'ar' && document.documentElement.dir === 'rtl');
  await ui.locator('.fr-w-lang-button').first().click();
  const picker = await ui.locator('.fr-w-lang-list').evaluate(element => {
    const box = element.getBoundingClientRect();
    return { direction: getComputedStyle(element).direction, left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: innerWidth, height: innerHeight };
  });
  check('welcome language picker reads RTL', picker.direction === 'rtl');
  check('welcome language picker fits viewport', picker.left >= 0 && picker.top >= 0 && picker.right <= picker.width + 1 && picker.bottom <= picker.height + 1);
  await capture('welcome-language');
  await ui.keyboard.press('Escape');
  await ui.getByRole('button', { name: 'تجاوز الإعداد', exact: true }).click();
  await ui.locator('.nt-page').waitFor({ timeout: 15000 });
  await finaleEnded(ui); // the browser arrives in a finale after setup; a click during it only skips it
  check('New Tab reads RTL', await ui.locator('.nt-page').evaluate(element => getComputedStyle(element).direction === 'rtl'));
  check('physical frame remains LTR', await ui.locator('.app').first().evaluate(element => getComputedStyle(element).direction === 'ltr'));
  await capture('new-tab');
  await act({ type: 'tab.new', url: 'acira://settings' });
  await ui.locator('.browser-settings').waitFor();
  check('settings reads RTL', await ui.locator('.browser-settings').evaluate(element => getComputedStyle(element).direction === 'rtl'));
  await capture('settings');
  await ui.locator('.toolbar-menu-control:visible').first().click();
  let popup;
  for (let attempt = 0; attempt < 50 && !popup; attempt++) {
    for (const page of app.windows()) if (await page.locator('.browser-popup').count()) { popup = page; break; }
    if (!popup) await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(popup, 'native popup available');
  await popup.waitForFunction(() => document.documentElement.lang === 'ar' && document.documentElement.dir === 'rtl');
  check('native menu reads RTL', await popup.locator('.browser-popup').evaluate(element => getComputedStyle(element).direction === 'rtl'));
  await popup.keyboard.press('Tab');
  check('native menu accepts keyboard focus', await popup.evaluate(() => document.activeElement !== document.body));
  await fs.writeFile(path.join(out, 'menu.png'), await popup.screenshot());
  report.captures.push('menu.png');
  await popup.keyboard.press('Escape');
  await act({ type: 'settings.update', patch: { language: 'en' } });
  await ui.waitForFunction(() => document.documentElement.lang === 'en' && document.documentElement.dir === 'ltr');
  check('switching back to English restores LTR', true);
  await capture('english-restored');
  report.passed = true;
} catch (error) {
  report.error = String(error?.stack || error);
  process.exitCode = 1;
} finally {
  if (app) {
    try { await app.close(); }
    catch (error) { report.closeError = String(error?.stack || error); report.passed = false; process.exitCode = 1; }
  }
  const reportJson = JSON.stringify(report, null, 2);
  await fs.writeFile(reportPath, reportJson);
  reportSha256 = createHash('sha256').update(reportJson).digest('hex');
}
console.log(JSON.stringify({ out, reportPath, reportSha256, target: report.target, passed: report.passed, checks: report.checks, error: report.error }));
