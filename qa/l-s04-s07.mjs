// Stream L: M's QA report S04 (History "Delete day" did nothing on a real click) and S07 (a data: address gives raw validation text).
//   node qa/l-s04-s07.mjs   isolated profile, one Electron, off-screen, 4 tabs max.
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { launchPreparedNative } from './prepared-native.mjs';
const data = path.resolve('.qa-profiles/l-s04-' + Date.now());
const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><title>Visit ' + req.url + '</title><h1>x</h1>'); });
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
  const snap = () => ui.evaluate(() => window.acira.getSnapshot());
  const act = a => ui.evaluate(a => window.acira.dispatch(a), a);
  for (const n of ['one', 'two', 'three']) { await act({ type: 'tab.new', url: base + '/' + n }); await wait(900); }
  const visits = async () => (await snap()).browsingHistory.length;
  const n0 = await visits();
  await act({ type: 'tab.new', url: 'acira://history' }); await wait(2500);
  const del = ui.locator('button[aria-label^="Delete"][aria-label$="from history"]').first();
  await del.click({ timeout: 8000, force: true }); await wait(400);
  const armedLabel = await ui.locator('button[data-armed]').first().innerText({ timeout: 2000 }).catch(() => 'not armed');
  record('S04: the first click arms the button and says what will go', /Delete \d+ visits?\?/.test(armedLabel), armedLabel);
  const paint = await ui.locator('button[data-armed]').first().evaluate(e => { const c = getComputedStyle(e); return c.backgroundColor + ' / ' + c.color; });
  record('S04: the armed button is a solid red fill with white text', (m => !!m && +m[1] > 180 && +m[2] < 90 && +m[3] < 90)(paint.match(/^rgb\((\d+), (\d+), (\d+)\)/)) && paint.endsWith('rgb(255, 255, 255)'), paint);
  await ui.locator('button[data-armed]').first().click({ timeout: 3000 }); await wait(600);
  const n1 = await visits();
  record('S04: the second click deletes the day', n0 >= 3 && n1 === 0, `visits ${n0} -> ${n1}`);
  const notice = await ui.locator('.lib-undo').innerText({ timeout: 2000 }).catch(() => '');
  record('S04: an Undo notice follows', /Undo/.test(notice), notice.replace(/\s+/g, ' '));
  // S07
  let rejected = '';
  try { await act({ type: 'tab.new', url: 'data:text/html,<h1>hi</h1>' }); } catch (e) { rejected = String(e.message); }
  await wait(600);
  const s = await snap();
  record('S07: a data: address is handled with a plain message', !rejected && /can.t open that kind of address/i.test(s.toast?.text || ''), `thrown: ${rejected.slice(0, 120) || 'none'}; toast: ${s.toast?.text ?? 'none'}`);
  console.log(rows.every(Boolean) ? 'ALL PASS' : 'FAILED'); exitCode = rows.every(Boolean) ? 0 : 1;
} catch (error) { console.log('ABORTED: ' + String(error.message).slice(0, 300)); }
finally { await app.close().catch(() => {}); server.close(); }
process.exit(exitCode);
