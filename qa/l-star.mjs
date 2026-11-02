// Stream L: the bookmark star in the address field toggles the bookmark, takes the filled accent state, and offers Undo on removal.
//   node qa/l-star.mjs [--visible]   isolated profile, one Electron, off-screen, 2 tabs.
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { launchPreparedNative } from './prepared-native.mjs';
const visible = process.argv.includes('--visible');
const data = path.resolve('.qa-profiles/l-star-' + Date.now());
const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><title>Star page</title><h1>x</h1>'); });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port + '/p';
const app = await launchPreparedNative({
  executablePath: createRequire(import.meta.url)('electron'),
  args: [path.resolve('desktop/main.cjs'), '--disable-features=CalculateNativeWinOcclusion', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
  env: { ...process.env, ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: data, LOCALAPPDATA: path.resolve('.qa-profiles/import-fixture'), ...(visible ? {} : { ACIRA_BROWSER_TEST_HIDDEN: '1' }) },
});
const wait = ms => new Promise(r => setTimeout(r, ms));
const rows = [];
const record = (name, ok, detail = '') => { rows.push(ok); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  — ' + detail : '')); };
let exitCode = 1;
try {
  let ui = null;
  for (let i = 0; i < 300 && !ui; i++) { ui = app.windows().find(p => p.url() === 'acira-browser-ui://ui/index.html'); if (!ui) await wait(100); }
  try { await ui.getByRole('button', { name: 'Skip setup', exact: true }).click({ timeout: 8000 }); } catch {}
  await app.evaluate(({ screen, BaseWindow }, visible) => { const d = screen.getPrimaryDisplay(), w = BaseWindow.getAllWindows()[0]; w.setBounds({ x: visible ? d.workArea.x + 40 : -3000, y: d.workArea.y + 20, width: 1440, height: 900 }); if (visible) w.show(); else w.showInactive(); }, visible);
  const snap = () => ui.evaluate(() => window.acira.getSnapshot());
  const act = a => ui.evaluate(a => window.acira.dispatch(a), a);
  await act({ type: 'tab.new', url: base }); await wait(1500);
  const star = ui.locator('button.address-star');
  const saved = async () => (await snap()).bookmarkNodes.filter(b => b.url === base).length;
  const look = () => star.evaluate(e => { const i = e.querySelector('.toolbar-icon') || e.querySelector('svg'); const c = getComputedStyle(i); return { cls: e.className, pressed: e.getAttribute('aria-pressed'), fill: c.fill, color: getComputedStyle(e).color, box: e.getBoundingClientRect().width + 'x' + e.getBoundingClientRect().height }; });
  const before = await look();
  await star.click({ timeout: 5000 }); await wait(700);
  const afterAdd = await look(), s1 = await snap();
  record('click on the star saves the page', (await saved()) === 1, 'toast: ' + s1.toast?.text);
  record('the star takes the filled accent state', afterAdd.pressed === 'true' && afterAdd.fill !== before.fill && afterAdd.fill !== 'none', `${before.fill} -> ${afterAdd.fill}; colour ${afterAdd.color}`);
  await star.click({ timeout: 5000 }); await wait(700);
  const afterRemove = await look(), s2 = await snap();
  record('second click removes it and offers Undo', (await saved()) === 0 && s2.toast?.action?.label === 'Undo', `toast ${s2.toast?.text} · ${s2.toast?.action?.label}`);
  record('the star returns to its empty state', afterRemove.pressed === 'false' && afterRemove.fill === before.fill, afterRemove.fill);
  await act(s2.toast.action.command); await wait(500);
  record('Undo puts the bookmark back and the star fills again', (await saved()) === 1 && (await look()).pressed === 'true');
  console.log(rows.every(Boolean) ? 'ALL PASS' : 'FAILED'); exitCode = rows.every(Boolean) ? 0 : 1;
} catch (error) { console.log('ABORTED: ' + String(error.message).slice(0, 300)); }
finally { await app.close().catch(() => {}); server.close(); }
process.exit(exitCode);
