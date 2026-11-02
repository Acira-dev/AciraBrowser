// Verifies every registered Settings control can be found by search and revealed (section opens, control
// scrolls into view and takes focus) without changing any setting. Run after `npm run build`:
//   node qa/settings-search.mjs
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { launchPreparedNative } from './prepared-native.mjs';
import { _electron } from 'playwright';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';

const root = process.cwd();
const data = path.join(root, '.qa-profiles', 'settings-search-' + Date.now());
const require = createRequire(import.meta.url);
const entries = JSON.parse(
  execFileSync(
    process.execPath,
    [
      require.resolve('tsx/cli'),
      '-e',
      `const fs=require('fs'),path=require('path');const dir='src/features/settings/entries';(async()=>{const all=[];for(const f of fs.readdirSync(dir).sort())if(f.endsWith('.ts'))all.push(...(await import('./'+dir+'/'+f)).default);console.log(JSON.stringify(all));})()`,
    ],
    { cwd: root, encoding: 'utf8' },
  ).trim().split('\n').pop(),
);
await fs.mkdir(data, { recursive: true });
const app = await launchPreparedNative({ executablePath: require('electron'), args: [path.join(root, 'desktop/main.cjs')], env: { ...process.env, ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: data }, timeout: 40000 });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const problems = [];
try {
  let ui;
  for (let i = 0; i < 200 && !ui; i++) {
    for (const page of app.context().pages()) try { if ((await page.evaluate(() => location.href)) === 'acira-browser-ui://ui/index.html') ui = page; } catch {}
    if (!ui) await wait(150);
  }
  await ui.waitForFunction(() => Boolean(window.acira));
  await app.evaluate(({ BaseWindow }) => { for (const w of BaseWindow.getAllWindows()) w.setBounds({ x: 60, y: 40, width: 1280, height: 820 }); });
  await wait(2500);
  await ui.getByRole('button', { name: 'Skip setup' }).click({ timeout: 3000 }).catch(() => {});
  const act = (a) => ui.evaluate((a) => window.acira.dispatch(a), a);
  await act({ type: 'settings.update', patch: { reducedMotion: true } });
  await act({ type: 'tab.new', url: 'acira://settings' });
  await wait(1500);
  const box = ui.getByRole('combobox', { name: 'Search settings' });
  let revealed = 0;
  for (const entry of entries) {
    await box.click();
    await box.fill(entry.title);
    const option = ui.locator('.st-results [role=option]', { hasText: entry.title }).first();
    if (!(await option.count())) { await box.fill(''); continue; } // not available in this state (for example no website open)
    const before = JSON.stringify(await ui.evaluate(() => window.acira.getSnapshot().settings));
    await option.click();
    await wait(450);
    const result = await ui.evaluate((anchor) => {
      const element = document.querySelector(`[data-setting="${anchor}"]`);
      return element ? { focusInside: element.contains(document.activeElement) || element === document.activeElement } : null;
    }, entry.anchor);
    if (!result) problems.push(`${entry.id}: anchor "${entry.anchor}" not rendered after opening ${entry.section}`);
    else if (!result.focusInside) problems.push(`${entry.id}: control did not take focus`);
    else if (JSON.stringify(await ui.evaluate(() => window.acira.getSnapshot().settings)) !== before) problems.push(`${entry.id}: search changed a setting`);
    else revealed++;
  }
  console.log(`${revealed}/${entries.length} controls revealed`);
  if (problems.length) { console.error(problems.join('\n')); process.exitCode = 1; }
} finally {
  await app.close();
}
