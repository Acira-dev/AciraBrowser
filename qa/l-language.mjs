// Stream L: the interface language. German is chosen through the real setting; the Languages row, a reducer toast and its Undo
// label come out in German, "Same as Windows" goes back, and the choice survives a restart.
//   node qa/l-language.mjs   isolated profile, two launches in turn (closed in finally), off-screen.
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { launchPreparedNative } from './prepared-native.mjs';
const data = path.resolve('.qa-profiles/l-lang-' + Date.now());
const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><title>Seite</title><h1>x</h1>'); });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port + '/p';
const wait = ms => new Promise(r => setTimeout(r, ms));
async function launch() {
  const app = await launchPreparedNative({
    executablePath: createRequire(import.meta.url)('electron'),
    args: [path.resolve('desktop/main.cjs'), '--disable-features=CalculateNativeWinOcclusion', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
    env: { ...process.env, ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: data, LOCALAPPDATA: path.resolve('.qa-profiles/import-fixture'), ACIRA_BROWSER_TEST_HIDDEN: '1' },
  });
  let ui = null;
  for (let i = 0; i < 300 && !ui; i++) { ui = app.windows().find(p => p.url() === 'acira-browser-ui://ui/index.html'); if (!ui) await wait(100); }
  try { await ui.getByRole('button', { name: 'Skip setup', exact: true }).click({ timeout: 6000 }); } catch {}
  await app.evaluate(({ BaseWindow }) => { const w = BaseWindow.getAllWindows()[0]; w.setBounds({ x: -3000, y: 20, width: 1440, height: 900 }); w.showInactive(); });
  return { app, ui, snap: () => ui.evaluate(() => window.acira.getSnapshot()), act: a => ui.evaluate(a => window.acira.dispatch(a), a) };
}
const rows = [];
const record = (name, ok, detail = '') => { rows.push(ok); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  — ' + detail : '')); };
let exitCode = 1, one = null, two = null;
const section = ui => ui.evaluate(() => ({ lang: document.documentElement.lang, row: document.querySelector('[data-setting="interface-language"] .st-title')?.textContent, select: document.querySelector('[data-setting="interface-language"] select, [data-setting="interface-language"] button[aria-haspopup]')?.textContent }));
try {
  one = await launch();
  await one.act({ type: 'tab.new', url: base }); await wait(1200);
  await one.act({ type: 'settings.update', patch: { language: 'de' } }); await wait(1200);
  await one.ui.evaluate(() => { localStorage.setItem('acira-settings-target', JSON.stringify({ section: 'Languages', at: Date.now() })); window.acira.dispatch({ type: 'tab.new', url: 'acira://settings' }); });
  await wait(2000);
  let seen = await section(one.ui);
  record('the page language follows the setting', seen.lang === 'de', JSON.stringify(seen));
  record('the Languages row is in German', seen.row === 'Sprache', seen.row);
  const nav = await one.ui.evaluate(() => [...document.querySelectorAll('.bs-sidebar nav>button')].map(b => b.getAttribute('aria-label')));
  record('Settings sections are in German', nav.includes('Datenschutz') && nav.includes('Einstellungen') === false && nav.includes('Suche'), nav.join(', '));
  await one.act({ type: 'bookmark.toggle', url: base }); await wait(500);
  const s1 = await one.snap();
  record('a reducer toast carries its catalog id', s1.toast?.i18n?.id === 'toast.bookmarkAdded' && s1.toast.text === 'Bookmark added', JSON.stringify(s1.toast?.i18n));
  await wait(1500);
  await one.app.close(); one = null; await wait(1500);
  two = await launch(); await wait(2000);
  const s2 = await two.snap();
  record('the choice survives a restart', s2.settings.language === 'de', String(s2.settings.language));
  record('and is applied before the first paint', (await section(two.ui)).lang === 'de', (await section(two.ui)).lang);
  await two.act({ type: 'settings.update', patch: { language: 'system' } }); await wait(1200);
  record('"Same as Windows" returns to the system language', (await section(two.ui)).lang !== 'de', (await section(two.ui)).lang);
  console.log(rows.every(Boolean) ? 'ALL PASS' : 'FAILED'); exitCode = rows.every(Boolean) ? 0 : 1;
} catch (error) { console.log('ABORTED: ' + String(error.message).slice(0, 300)); }
finally { await one?.app.close().catch(() => {}); await two?.app.close().catch(() => {}); server.close(); }
process.exit(exitCode);
