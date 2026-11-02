// Regression: Acira must close, and its process must exit, after a page opened a tab with window.open() / a target=_blank link
// (the 29 Oct "can't be closed" report: the window stayed open after Google sign-in, which opens a tab).
//   node qa/native-slot.mjs close-after-open -- node qa/close-after-window-open.mjs [window|quit|keys] [opener|link|both|none]
// "window": BaseWindow.close() (the title-bar X); "quit": app.quit(); "keys": Alt+F4-style close through the window's own shortcut path.
// Prints PASS/FAIL with how long the process took to exit. Isolated profile under .qa-profiles, hidden windows, no credentials.
import http from 'node:http';
import path from 'node:path';
import {createRequire} from 'node:module';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const how = process.argv[2] || 'window', what = process.argv[3] || 'both';
const PAGE = `<!doctype html><meta charset=utf-8><title>cases</title><a id="link" target="_blank" href="/t?c=link">link</a><button id="wo">open</button><button id="wo2">open2</button>
<script>document.getElementById('wo').onclick=()=>{window.__w=window.open('/t?c=wo')};document.getElementById('wo2').onclick=()=>{window.__w2=window.open('/t?c=wo2','_blank')}</script>`;
const server = http.createServer((req, res) => { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(new URL(req.url, 'http://x').pathname === '/t' ? '<!doctype html><title>t</title>t' : PAGE); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = 'http://127.0.0.1:' + server.address().port;

const {withSlot} = await import('./native-slot.mjs'), {launchPreparedNative} = await import('./prepared-native.mjs');
let code = 1;
await withSlot('close-after-window-open', async () => {
  const data = path.resolve('.qa-profiles/close-open-' + how + '-' + what + '-' + Date.now());
  const app = await launchPreparedNative({executablePath: createRequire(import.meta.url)('electron'), args: [path.resolve('desktop/main.cjs'), '--disable-features=CalculateNativeWinOcclusion', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'], env: {...process.env, ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: data, ACIRA_BROWSER_TEST_HIDDEN: '1'}});
  const child = app.process();
  child.stderr?.on('data', chunk => { for (const line of String(chunk).split(/\r?\n/)) if (/\[dbg\]|TypeError|ReferenceError|Uncaught|has been destroyed/.test(line)) console.log('   [main]', line.slice(0, 300)); });
  let exited = false, exitAt = 0; child.once('exit', () => { exited = true; exitAt = Date.now(); });
  try {
    let ui; for (let i = 0; i < 300 && !ui; i++) { ui = app.windows().find(p => p.url() === 'acira-browser-ui://ui/index.html'); if (!ui) await wait(100); }
    if (!ui) throw Error('UI page not found');
    try { await ui.getByRole('button', {name: 'Skip setup', exact: true}).click({timeout: 8000}); } catch { /* past setup */ }
    const tabs = async () => ui.evaluate(async () => (await window.acira.getSnapshot()).tabs.map(t => t.url));
    if (what !== 'none') {
      await ui.evaluate(u => window.acira.dispatch({type: 'tab.new', url: u}), base + '/');
      let page; for (let i = 0; i < 300 && !page; i++) { page = app.windows().find(p => p.url().startsWith(base + '/')); if (!page) await wait(100); }
      if (!page) throw Error('page not found');
      await wait(500);
      if (what === 'opener' || what === 'both') { await page.click('#wo'); await wait(1500); await page.click('#wo2'); await wait(1500); }
      if (what === 'link' || what === 'both') { await page.click('#link'); await wait(1500); }
    }
    // Electron closes the windows a page opened when that page's render view goes away (a cross-site navigation, e.g. sign-in finishing on another site):
    // the tabs opened through window.open must survive it. Walk the opener to another site and see what is left of them.
    if (process.env.OPENER_NAVIGATES === '1') {
      const openerTab = await ui.evaluate(async b => (await window.acira.getSnapshot()).tabs.find(t => t.url.startsWith(b + '/'))?.id, base);
      await ui.evaluate(([id, u]) => window.acira.dispatch({type: 'tab.navigate', tabId: id, url: u}), [openerTab, base.replace('127.0.0.1', 'localhost') + '/t?c=moved']);
      await wait(2500);
      const left = await app.evaluate(({webContents}) => webContents.getAllWebContents().filter(c => /\/t\?c=(wo|wo2|link)/.test(c.getURL()) || c.isDestroyed()).map(c => c.isDestroyed() ? 'destroyed' : c.getURL().replace(/^.*\/t/, '/t')));
      console.log('window.open tabs after the opener moved:', JSON.stringify(left), '| expected 3 live (wo, wo2, link)');
    }
    // Split view with a tab a page opened in it (the founder used split view too)
    if (process.env.SPLIT === '1') {
      const ids = await ui.evaluate(async b => { const s = await window.acira.getSnapshot(); return [s.tabs.find(t => t.url.startsWith(b + '/'))?.id, s.tabs.find(t => t.url.includes('/t?c=wo2'))?.id]; }, base);
      await ui.evaluate(tabIds => window.acira.dispatch({type: 'split.open', tabIds}), ids);
      await wait(1000);
      console.log('split open:', await ui.evaluate(async () => JSON.stringify((await window.acira.getSnapshot()).windowUi.split?.tabIds?.length || 0)));
    }
    // A page that opened a tab can close it again (window.close(), as sign-in pages do when they finish): the tab must go from the strip too.
    if (process.env.SCRIPT_CLOSES === '1') {
      const child = app.windows().find(p => p.url().includes('/t?c=wo2'));
      await child?.evaluate(() => window.close()).catch(() => {});
      await wait(2000);
      const after = await tabs();
      console.log('after the page closed its own tab, strip has:', after.map(u => u.replace(base, '')).join(' '), '| contents left:', await app.evaluate(({webContents}) => webContents.getAllWebContents().map(c => c.getURL().replace(/^.*\/t/, '/t')).filter(u => u.startsWith('/t'))));
    }
    const urls = await tabs();
    console.log('tabs before close:', urls.length, urls.map(u => u.replace(base, '')).join(' '));
    const started = Date.now();
    if (how === 'quit') await app.evaluate(({app: electronApp}) => { electronApp.quit(); }).catch(() => {});
    else if (how === 'keys') await app.evaluate(({BaseWindow}) => { const main = BaseWindow.getAllWindows().find(w => w.contentView.children.length > 1); main?.close(); }).catch(() => {});
    else await app.evaluate(({BaseWindow}) => { const main = BaseWindow.getAllWindows().find(w => w.contentView.children.length > 1); main?.close(); }).catch(() => {});
    for (let i = 0; i < 160 && !exited; i++) {
      await wait(100);
      // the "close Acira?" box of the last window: answer it the way a person would (Quit) so only a stuck close can fail this test
      if (i === 10 && !exited) await app.evaluate(({BaseWindow}) => BaseWindow.getAllWindows().map(w => w.getTitle())).then(titles => console.log('windows still open after 1 s:', JSON.stringify(titles))).catch(() => {});
    }
    const took = exited ? exitAt - started : null;
    console.log(exited ? `PASS process exited ${took} ms after ${how} close (${what})` : `FAIL process still running 16 s after ${how} close (${what})`);
    if (!exited) {
      const info = await app.evaluate(({BaseWindow, webContents}) => ({windows: BaseWindow.getAllWindows().map(w => ({title: w.getTitle(), destroyed: w.isDestroyed(), views: w.contentView.children.length})), contents: webContents.getAllWebContents().map(c => (c.getURL() || '').slice(0, 60) + (c.isDestroyed() ? ' (destroyed)' : ''))})).catch(error => 'evaluate failed ' + error.message);
      console.log(JSON.stringify(info));
    }
    code = exited ? 0 : 1;
  } catch (error) { console.log('ERROR', error.stack || error); }
  finally { if (!exited) await app.close().catch(() => {}); await new Promise(resolve => server.close(resolve)); }
});
process.exit(code);
