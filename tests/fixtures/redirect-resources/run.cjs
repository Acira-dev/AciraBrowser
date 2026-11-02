'use strict';
// Electron runner for tests/redirect-resources.test.cjs: one page (with a CSP that names the ad hosts only), its ad script, pixel, fetch and frame answered
// by the real engine's $redirect rules. Session "data" gets the engine's data: answer as is (the old behaviour), session "stand-in" the acira-resource one.
const http = require('node:http'), path = require('node:path'), os = require('node:os'), fs = require('node:fs');
const { app, BrowserWindow, session, protocol } = require('electron');
const { ElectronBlocker } = require('@ghostery/adblocker-electron');
const { createRedirectResources, PRIVILEGES } = require('../../../desktop/browser-services/redirect-resources.cjs');
app.setPath('userData', path.join(os.tmpdir(), 'acira-redirect-resources-' + process.pid));
app.on('window-all-closed', () => { });
process.on('uncaughtException', error => { process.stdout.write('ERROR ' + (error && error.stack || error) + '\n'); app.exit(1); });
protocol.registerSchemesAsPrivileged([PRIVILEGES]);
const resources = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'resources', 'filters', 'resources.json'), 'utf8');
const blocker = ElectronBlocker.parse(['||ads.example^$script,redirect=googletagservices_gpt.js', '||pixel.example^$image,redirect=1x1.gif', '||beacon.example^$xhr,redirect=noop.json', '||frames.example^$subdocument,redirect=noop.html'].join('\n'), { loadNetworkFilters: true, loadCosmeticFilters: false });
blocker.updateResources(resources, 'bundled');
const page = `<!doctype html><meta http-equiv="Content-Security-Policy" content="script-src 'self' 'unsafe-inline' https://ads.example; img-src https://pixel.example; frame-src https://frames.example; connect-src https://beacon.example">
<script>window.R = {};</script>
<script src="https://ads.example/tag/js/gpt.js"></script>
<script>R.googletag = typeof googletag; try { googletag.cmd.push(() => { R.cmdPush = 'ran'; }); } catch (error) { R.cmdPush = 'threw'; } R.display = typeof (window.googletag && googletag.pubads && googletag.pubads().display);</script>
<img src="https://pixel.example/p.gif" onload="R.img = 'load ' + this.naturalWidth" onerror="R.img = 'error'">
<iframe src="https://frames.example/ad.html"></iframe>
<script>fetch('https://beacon.example/b', { credentials: 'include' }).then(r => r.text().then(t => { R.fetch = r.status + ' ' + t; })).catch(() => { R.fetch = 'error'; });</script>`;
const server = http.createServer((req, res) => { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(page); });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function visit(name, base, translate) {
  const ses = session.fromPartition('redirect-' + name + '-' + process.pid), standIns = createRedirectResources();
  standIns.attach(ses); standIns.attach(ses);
  ses.webRequest.onBeforeRequest((details, callback) => { let result = {}; blocker.onBeforeRequest(details, patch => { result = patch; }); callback(translate ? standIns.translate(result) : result); });
  const win = new BrowserWindow({ show: false, webPreferences: { session: ses, sandbox: true, contextIsolation: true } }), wc = win.webContents, errors = [];
  wc.on('did-fail-load', (_event, code, description) => errors.push(description));
  wc.on('console-message', (...args) => { const message = typeof args[0] === 'object' && args[0] && 'message' in args[0] ? args[0].message : args[2]; errors.push(String(message)); });
  await wc.loadURL(base + '/'); await sleep(1200);
  const result = JSON.parse(await wc.executeJavaScript('JSON.stringify(R)'));
  result.frame = (wc.mainFrame.frames[0]?.url || '').split(':')[0];
  result.unsafeRedirect = errors.some(text => /UNSAFE_REDIRECT/.test(text));
  win.destroy();
  return result;
}
app.whenReady().then(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const base = `http://127.0.0.1:${server.address().port}`;
  const result = { data: await visit('data', base, false), standIn: await visit('stand-in', base, true) };
  process.stdout.write('RESULT ' + JSON.stringify(result) + '\n');
  server.close(); try { fs.rmSync(app.getPath('userData'), { recursive: true, force: true }); } catch { } app.exit(0);
});
