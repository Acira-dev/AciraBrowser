'use strict';
// Electron runner for tests/frame-boot-real.test.cjs: the app's real page-start preloads (chrome-identity, farbling, scriptlets, page-risk, autoconsent) in a real window with two cross-site
// iframes, answered by stand-in handlers that return scripts setting a flag. Reports, per frame, how many synchronous questions it asked the main process and which flags the page has.
const path = require('node:path'), fs = require('node:fs'), os = require('node:os'), http = require('node:http');
const {app, BrowserWindow, ipcMain, session} = require('electron');
for (const event of ['uncaughtException', 'unhandledRejection']) process.on(event, error => { process.stdout.write('ERROR ' + (error && error.stack || error) + '\n'); app.exit(1); });
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'acira-frameboot-')));
app.on('window-all-closed', () => { });
const services = path.join(__dirname, '..', '..', '..', 'desktop', 'browser-services');
const answers = {
  'acira:chrome-identity': event => { event.returnValue = /^https?:/.test(event.senderFrame?.url || '') ? 'window.__ident=1' : ''; },
  'acira:farbling': event => { event.returnValue = /^https?:/.test(event.senderFrame?.url || '') ? 'window.__farble=1' : ''; },
  'acira:scriptlets': event => { event.returnValue = ['window.__scriptlet=1']; },
  'acira:page-risk-config': event => { event.returnValue = {enabled: true}; },
  'acira:page-risk-script': event => { event.returnValue = 'window.__risk=1'; },
  'acira:autoconsent-setup': event => { event.returnValue = null; },
};
for (const [channel, handler] of Object.entries(answers)) ipcMain.on(channel, handler);
// The 13.5 boot handler when this tree has it (a tree without it simply keeps asking one question per preload).
try { require(path.join(services, 'frame-boot.cjs')).install(ipcMain); } catch { /* no frame-boot in this tree */ }
const reports = [];
ipcMain.on('fixture:syncs', (event, report) => { reports.push(report); });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const server = http.createServer((req, res) => {
  res.setHeader('content-type', 'text/html; charset=utf-8');
  const port = server.address().port;
  if (req.url.startsWith('/top')) res.end(`<!doctype html><title>top</title><p>top<iframe src="http://localhost:${port}/frame"></iframe><iframe src="http://127.0.0.1:${port}/frame2"></iframe>`);
  else res.end('<!doctype html><title>f</title><p>frame');
});
app.whenReady().then(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const ses = session.fromPartition('frameboot');
  ses.registerPreloadScript({type: 'frame', filePath: path.join(__dirname, 'count-preload.cjs')});
  const files = ['scriptlet-preload.cjs', 'farbling-preload.cjs', 'page-risk-preload.cjs', 'chrome-identity-preload.cjs', 'autoconsent-preload.cjs'];
  for (const file of files) if (fs.existsSync(path.join(services, file))) ses.registerPreloadScript({type: 'frame', filePath: path.join(services, file)});
  const win = new BrowserWindow({show: false, width: 900, height: 700, webPreferences: {session: ses, sandbox: true, contextIsolation: true, nodeIntegrationInSubFrames: true, backgroundThrottling: false}});
  const loaded = new Promise(resolve => win.webContents.once('did-finish-load', resolve));
  win.loadURL(`http://127.0.0.1:${server.address().port}/top`).catch(() => { }); await loaded; await sleep(2500);
  const flags = 'JSON.stringify({ident:window.__ident===1,farble:window.__farble===1,scriptlet:window.__scriptlet===1,risk:window.__risk===1})';
  const frames = [win.webContents.mainFrame, ...win.webContents.mainFrame.frames];
  const out = [];
  for (const frame of frames) { let result = null; try { result = JSON.parse(await frame.executeJavaScript(flags)); } catch { /* a frame that went away */ } out.push({url: frame.url, main: frame === win.webContents.mainFrame, flags: result}); }
  process.stdout.write('RESULT ' + JSON.stringify({frames: out, syncs: reports.map(report => ({main: report.main, href: report.href, names: report.names}))}) + '\n');
  server.close(); app.exit(0);
});
