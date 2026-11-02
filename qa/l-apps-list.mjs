// Stream L: Settings › Apps › Install lists every open site (one row per site) with Install, unavailable ones faded with a reason.
//   node qa/l-apps-list.mjs   isolated profile, one Electron, off-screen, 6 tabs max.
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { launchPreparedNative } from './prepared-native.mjs';
const data = path.resolve('.qa-profiles/l-apps-' + Date.now());
const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><title>Site ' + req.url + '</title><h1>x</h1>'); });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;
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
  let ui = null;
  for (let i = 0; i < 300 && !ui; i++) { ui = app.windows().find(p => p.url() === 'acira-browser-ui://ui/index.html'); if (!ui) await wait(100); }
  try { await ui.getByRole('button', { name: 'Skip setup', exact: true }).click({ timeout: 6000 }); } catch {}
  await app.evaluate(({ BaseWindow }) => { const w = BaseWindow.getAllWindows()[0]; w.setBounds({ x: -3000, y: 20, width: 1440, height: 900 }); w.showInactive(); });
  const act = a => ui.evaluate(a => window.acira.dispatch(a), a);
  for (const u of [base + '/a', base + '/a2', 'acira://history']) { await act({ type: 'tab.new', url: u }); await wait(900); }
  await ui.evaluate(() => { localStorage.setItem('acira-settings-target', JSON.stringify({ section: 'Web apps', at: Date.now() })); window.acira.dispatch({ type: 'tab.new', url: 'acira://settings' }); });
  await wait(2000);
  const list = await ui.evaluate(() => [...document.querySelectorAll('[data-setting^="web-app-site-"]')].map(r => ({ title: r.querySelector('.st-title')?.textContent, detail: r.querySelector('p')?.textContent, unavailable: r.hasAttribute('data-unavailable'), button: r.querySelector('button')?.textContent, disabled: r.querySelector('button')?.disabled, icon: !!r.querySelector('.wa-icon') })));
  console.log(JSON.stringify(list));
  record('every open site is listed once (two tabs on one site = one row; Settings and blank tabs left out)', list.length === 2, list.map(r => r.title).join(' | '));
  const site = list.find(r => !r.unavailable), page = list.find(r => r.unavailable);
  record('a website row has icon/title/domain and an enabled Install', !!site && site.icon && site.button === 'Install' && !site.disabled && /127\.0\.0\.1/.test(site.detail), JSON.stringify(site));
  record('an Acira page is faded with a reason and cannot be installed', !!page && page.disabled && /can’t be installed/.test(page.detail), JSON.stringify(page));
  console.log(rows.every(Boolean) ? 'ALL PASS' : 'FAILED'); exitCode = rows.every(Boolean) ? 0 : 1;
} catch (error) { console.log('ABORTED: ' + String(error.message).slice(0, 300)); }
finally { await app.close().catch(() => {}); server.close(); }
process.exit(exitCode);
