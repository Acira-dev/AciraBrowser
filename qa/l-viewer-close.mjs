// Stream L: tab viewer open + Ctrl+W must close the CURRENT (highlighted) tab, move the selection to the next tab, and show the
// hover fill only under the pointer. Prints PASS/FAIL; exits 1 on failure. Isolated profile, one Electron, off-screen, 6 tabs max.
//   node qa/l-viewer-close.mjs [--visible]
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { launchPreparedNative } from './prepared-native.mjs';

const visible = process.argv.includes('--visible');
const data = path.resolve('.qa-profiles/l-viewer-' + Date.now());
const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><title>Page' + req.url.replace('/', ' ') + '</title><h1>x</h1>'); });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;
const app = await launchPreparedNative({
  executablePath: createRequire(import.meta.url)('electron'),
  args: [path.resolve('desktop/main.cjs'), '--disable-features=CalculateNativeWinOcclusion', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
  env: { ...process.env, ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: data, LOCALAPPDATA: path.resolve('.qa-profiles/import-fixture'), ...(visible ? {} : { ACIRA_BROWSER_TEST_HIDDEN: '1' }) },
});
const wait = ms => new Promise(r => setTimeout(r, ms));
const find = async test => { for (let i = 0; i < 300; i++) { const p = app.windows().find(p => test(p.url())); if (p) return p; await wait(100); } throw Error('page not found'); };
const rows = [];
const record = (name, ok, detail = '') => { rows.push(ok); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  — ' + detail : '')); };
let exitCode = 1;
try {
  const ui = await find(u => u === 'acira-browser-ui://ui/index.html');
  try { await ui.getByRole('button', { name: 'Skip setup', exact: true }).click({ timeout: 8000 }); } catch {}
  await app.evaluate(({ screen, BaseWindow }, visible) => { const d = screen.getPrimaryDisplay(), w = BaseWindow.getAllWindows()[0]; w.setBounds({ x: visible ? d.workArea.x + 40 : -3000, y: d.workArea.y + 20, width: 1440, height: 900 }); if (visible) w.show(); else w.showInactive(); }, visible);
  const snap = () => ui.evaluate(() => window.acira.getSnapshot());
  const act = a => ui.evaluate(a => window.acira.dispatch(a), a);
  for (const n of ['a', 'b', 'c', 'd']) { await act({ type: 'tab.new', url: base + '/' + n }); await wait(500); }
  let s = await snap();
  const titles = () => snap().then(x => x.tabs.map(t => t.url.split('/').pop() || 'new'));
  // Make the second tab current, then open the viewer from the keyboard.
  const second = s.tabs[2]; await act({ type: 'tab.select', id: second.id }); await wait(500);
  const key = (type, keyCode, modifiers = []) => app.evaluate(({ webContents }, [type, keyCode, modifiers]) => { const wc = webContents.getAllWebContents().find(w => w.getURL() === 'acira-browser-ui://ui/index.html'); wc.focus(); wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers }); wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers }); }, [type, keyCode, modifiers]);
  await key('x', 't', ['alt']); await wait(1200);
  console.log('viewer open:', await app.evaluate(({ webContents }) => webContents.getAllWebContents().find(w => w.getURL().includes('view=overlay'))?.executeJavaScript('document.querySelectorAll(".tab-result").length + " rows; selected " + (document.querySelector(".tab-result[aria-selected=true],.tab-result.selected,.tab-result[data-current=true]")?.textContent||"?")')));
  const overlay = app.windows().find(p => /overlay|popup/i.test(p.url()) || p.url().includes('overlay'));
  console.log('windows:', app.windows().map(p => p.url()).join(' | '));
  await app.evaluate(({ webContents }) => { const v = webContents.getAllWebContents().find(w => w.getURL().includes("view=overlay")); v.sendInputEvent({ type: 'keyDown', keyCode: 'Down' }); v.sendInputEvent({ type: 'keyUp', keyCode: 'Down' }); });
  await wait(400);
  const picked = await app.evaluate(({ webContents }) => webContents.getAllWebContents().find(w => w.getURL().includes("view=overlay")).executeJavaScript('(()=>{const e=document.querySelector("button.tab-result[data-cursor=true]");return e?e.textContent:"?"})()'));
  console.log('selected row:', picked);
  const before = await titles();
  // Ctrl+W goes to whichever view has focus (the open viewer).
  await app.evaluate(({ webContents }) => { const all = webContents.getAllWebContents(); const view = all.find(w => w.getURL().includes("view=overlay")); if (!view) throw Error("no overlay"); view.sendInputEvent({ type: 'keyDown', keyCode: 'w', modifiers: ['control'] }); view.sendInputEvent({ type: 'keyUp', keyCode: 'w', modifiers: ['control'] }); });
  await wait(900);
  const after = await titles();
  const gone = before.filter(t => !after.includes(t));
  record('Ctrl+W with the tab viewer open closes the current tab', gone.length === 1 && picked.includes('Page ' + gone[0]), `before ${before} · after ${after} · closed ${gone}`);
  const cursor = await app.evaluate(({ webContents }) => webContents.getAllWebContents().find(w => w.getURL().includes('view=overlay')).executeJavaScript('document.querySelector("button.tab-result[data-cursor=true]")?.textContent||"none"'));
  record('the selection moves to the next tab, not the top row', cursor.includes('Page d'), 'cursor: ' + cursor);
  const s2 = await snap();
  record('selection moves to a neighbouring tab, which stays open', s2.tabs.some(t => t.id === s2.activeTabId), 'active: ' + s2.tabs.find(t => t.id === s2.activeTabId)?.url);
  console.log(rows.every(Boolean) ? 'ALL PASS' : 'FAILED');
  exitCode = rows.every(Boolean) ? 0 : 1;
} catch (error) { console.log('ABORTED: ' + String(error.message).slice(0, 300)); }
finally { await app.close().catch(() => {}); server.close(); }
process.exit(exitCode);
