'use strict';
// Electron runner for tests/ad-slot-leftovers.test.cjs. Serves weather.html as weather.com (mapped to this computer) and loads it with the app's real
// scriptlet-preload.cjs, whose document-start request for Acira's own ad-card styles is answered here with the rule (or nothing, for the control), three loads
// each. Reports which cards have a box, the first content's position, the frames in which an empty card had a box, and the layout shifts.
// Usage: electron run.cjs <css file>
const path = require('node:path'), fs = require('node:fs'), os = require('node:os'), http = require('node:http');
const { app, BrowserWindow, ipcMain } = require('electron');
for (const event of ['uncaughtException', 'unhandledRejection']) process.on(event, error => { process.stdout.write('ERROR ' + (error && error.stack || error) + '\n'); app.exit(1); });
const args = process.argv.slice(process.argv.findIndex(arg => arg.endsWith('run.cjs')) + 1), css = fs.readFileSync(args[0], 'utf8');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'acira-adslot-')));
app.commandLine.appendSwitch('host-resolver-rules', 'MAP weather.com 127.0.0.1');
app.on('window-all-closed', () => { });
const preload = path.join(__dirname, '..', '..', '..', 'desktop', 'browser-services', 'scriptlet-preload.cjs');
ipcMain.on('acira:scriptlets', event => { event.returnValue = []; });
ipcMain.on('acira:ad-slot-styles', event => { event.returnValue = event.sender.__withRule ? css : ''; });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const page = fs.readFileSync(path.join(__dirname, 'weather.html'));
const server = http.createServer((req, res) => { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(page); });
app.whenReady().then(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const out = { rule: [], control: [] };
  for (const withRule of [true, false]) for (let load = 0; load < 3; load++) {
    const win = new BrowserWindow({ show: false, width: 1200, height: 900, webPreferences: { preload, sandbox: true, contextIsolation: true, backgroundThrottling: false } });
    win.webContents.__withRule = withRule;
    // Electron's loadURL promise can reject this page although it finished loading (it holds srcdoc frames); the page's own state is what counts.
    const loaded = new Promise(resolve => win.webContents.once('did-finish-load', resolve));
    win.loadURL(`http://weather.com:${server.address().port}/?load=${load}`).catch(() => { }); await loaded; await sleep(2200);
    const before = await win.webContents.executeJavaScript(`(${measure})()`);
    // An ad that arrives late puts its frame in the slot: that card shows again.
    await win.webContents.executeJavaScript(`document.getElementById('WX_Bot300AdX2').innerHTML='<iframe title="ad" style="width:300px;height:250px;border:0" srcdoc="late ad"></iframe>';0`); await sleep(200);
    const after = await win.webContents.executeJavaScript(`(${measure})()`);
    out[withRule ? 'rule' : 'control'].push({ before, after });
    win.destroy();
  }
  process.stdout.write('RESULT ' + JSON.stringify(out) + '\n'); server.close(); app.exit(0);
});
function measure() {
  const box = id => { const r = document.getElementById(id).getBoundingClientRect(); return { top: Math.round(r.top), height: Math.round(r.height) }; };
  return { host: location.hostname, cards: Object.fromEntries(['top', 'swapped', 'filled', 'late', 'noslot', 'news'].map(id => [id, box(id).height > 0])), forecast: box('forecast'), footer: box('footer'), frames: window.__frames.length, framesWithEmptyCard: window.__frames.filter(n => n > 0).length, shifts: window.__shifts.reduce((a, b) => a + b, 0) };
}
