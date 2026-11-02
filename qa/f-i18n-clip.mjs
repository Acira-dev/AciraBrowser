// Stream F languages check: my Settings sections (Profiles incl. the editor and the remove confirm, Import & export, Privacy's
// cleanup, Passwords) in German and French at 150% interface size, scanned with M's clipping scanner, plus a screenshot of each.
//   node qa/f-i18n-clip.mjs [--lang=de,fr] [--scale=150]   one isolated instance, closed in finally.
import path from 'node:path';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { launchPreparedNative } from './prepared-native.mjs';
const arg = (name, fallback) => (process.argv.find(item => item.startsWith('--' + name + '=')) || '').slice(name.length + 3) || fallback;
const langs = arg('lang', 'de,fr').split(','), scale = Number(arg('scale', '150'));
const data = path.resolve('.qa-profiles/f-i18n-' + Date.now()), out = path.resolve('qa/artifacts/f-i18n-clip-' + Date.now());
await fs.mkdir(out, { recursive: true });
const scan = await fs.readFile(path.resolve('qa/m-clip-scan.js'), 'utf8');
const wait = ms => new Promise(r => setTimeout(r, ms));
const app = await launchPreparedNative({
  executablePath: createRequire(import.meta.url)('electron'),
  args: [path.resolve('desktop/main.cjs'), '--disable-features=CalculateNativeWinOcclusion', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
  env: { ...process.env, ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: data, LOCALAPPDATA: path.resolve('.qa-profiles/import-fixture'), ACIRA_BROWSER_TEST_HIDDEN: '1' },
});
let exitCode = 1;
try {
  let ui = null;
  for (let i = 0; i < 300 && !ui; i++) { ui = app.windows().find(p => p.url() === 'acira-browser-ui://ui/index.html'); if (!ui) await wait(100); }
  try { await ui.getByRole('button', { name: 'Skip setup', exact: true }).click({ timeout: 6000 }); } catch {}
  await app.evaluate(({ BaseWindow }) => { const w = BaseWindow.getAllWindows()[0]; w.setBounds({ x: -3000, y: 20, width: 1440, height: 900 }); w.showInactive(); });
  const act = a => ui.evaluate(a => window.acira.dispatch(a), a);
  await act({ type: 'browser.profile.create', name: 'Work' }); await wait(500);
  await act({ type: 'tab.new', url: 'acira://settings' }); await wait(1500);
  for (const lang of langs) {
    await act({ type: 'settings.update', patch: { language: lang, interfaceScale: scale } }); await wait(1500);
    for (const section of ['Profiles', 'Import & export', 'Privacy', 'Passwords']) {
      await ui.evaluate(name => { localStorage.setItem('acira-settings-target', JSON.stringify({ section: name, at: Date.now() })); window.dispatchEvent(new StorageEvent('storage', { key: 'acira-settings-target', newValue: '1' })); }, section);
      await wait(1200);
      if (section === 'Profiles') {
        // Open the editor and the remove confirmation of the second profile so their long German text is scanned too.
        const edit = ui.locator('.pm-item').nth(1).locator('.pm-control button').last();
        await edit.click({ timeout: 3000 }).catch(() => {}); await wait(500);
        await ui.locator('.pm-remove').click({ timeout: 3000 }).catch(() => {}); await wait(500);
      }
      const hits = await ui.evaluate(scan);
      console.log(`[${lang} @${scale}%] ${section}: ${hits.split('\n').slice(0, 8).join(' | ')}`);
      const shot = await ui.screenshot().catch(() => null); if (shot) await fs.writeFile(path.join(out, `${lang}-${section.replace(/\W+/g, '')}.png`), shot);
    }
  }
  exitCode = 0;
} catch (error) { console.log('ABORTED: ' + String(error.message).slice(0, 300)); }
finally { await app.close().catch(() => {}); }
console.log(out);
process.exit(exitCode);
