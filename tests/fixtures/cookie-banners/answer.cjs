'use strict';
// Electron runner for tests/cookie-banner-answer.test.cjs: the app's real answering preload (autoconsent-preload.cjs, built from autoconsent-preload-entry.cjs) with
// DuckDuckGo's real rules handed out as optional-filtering.cjs does (autoconsent-rules.cjs), in hidden windows against page.html. Usage: electron answer.cjs '<cases json>'
const http = require('node:http'), fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { app, BrowserWindow, ipcMain, session } = require('electron');
const { createAutoconsentRules } = require('../../../desktop/browser-services/autoconsent-rules.cjs');
app.commandLine.appendSwitch('use-mock-keychain');
app.setPath('userData', path.join(os.tmpdir(), 'acira-cookie-answer-' + process.pid));
app.on('window-all-closed', () => { });
process.on('uncaughtException', error => { process.stdout.write('ERROR ' + (error && error.stack || error) + '\n'); app.exit(1); });
const cases = JSON.parse(process.argv[process.argv.length - 1]);
const preload = path.join(__dirname, '..', '..', '..', 'desktop', 'browser-services', 'autoconsent-preload.cjs');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const rules = createAutoconsentRules(), events = new Map();
ipcMain.on('acira:autoconsent-setup', event => { const main = event.senderFrame === event.sender.mainFrame, list = rules.rulesFor(event.senderFrame.url, main); event.returnValue = list ? { config: rules.config(), rules: list } : null; });
ipcMain.on('acira:autoconsent-event', (event, message) => { const list = events.get(event.sender.id) || []; list.push(message.type + (message.cmp ? ':' + message.cmp : '') + (message.type === 'optOutResult' ? ':' + message.result : '')); events.set(event.sender.id, list); });
// 13.5: the page-start preloads ask main one question per frame (desktop/browser-services/frame-boot.cjs); a harness that loads them must answer it (an unanswered synchronous message fails the page load).
require('../../../desktop/browser-services/frame-boot.cjs').install(ipcMain);
const server = http.createServer((req, res) => { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(fs.readFileSync(path.join(__dirname, 'page.html'))); });
const MEASURE = `(() => { const banner = document.getElementById('onetrust-banner-sdk'); return { clicked: window.__clicked || [], banner: !!banner && banner.getClientRects().length > 0 && getComputedStyle(banner).opacity !== '0' }; })()`;
app.whenReady().then(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const out = await Promise.all(cases.map(async (spec, index) => {
    const ses = session.fromPartition('answer-' + index + '-' + process.pid); ses.registerPreloadScript({ type: 'frame', filePath: preload });
    const win = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { session: ses, sandbox: true, contextIsolation: true, backgroundThrottling: false, nodeIntegrationInSubFrames: true } });
    const started = Date.now(); await win.webContents.loadURL(`http://127.0.0.1:${port}/page.html?case=${spec.case}`);
    const record = { name: spec.name || spec.case, steps: {} };
    for (const step of spec.steps) { await sleep(Math.max(0, step.at - (Date.now() - started))); record.steps[step.name] = await win.webContents.executeJavaScript(MEASURE); }
    record.events = events.get(win.webContents.id) || [];
    win.destroy();
    return record;
  }));
  process.stdout.write('RESULT ' + JSON.stringify(out) + '\n');
  server.close(); app.exit(0);
});
