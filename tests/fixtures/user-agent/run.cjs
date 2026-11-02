'use strict';
// Electron runner for tests/user-agent.test.cjs. Applies the app's real user-agent module before ready (as main.cjs does), then loads a local page in
// several kinds of session (default, persistent profile, private/in-memory, peek) and records everything a site could read: navigator.userAgent,
// appVersion, userAgentData brands and high-entropy values (page and worker), plus every header the local server received, including the client
// hints sent after Accept-CH. Usage: electron run.cjs
const http = require('node:http'), path = require('node:path'), os = require('node:os');
const { app, BrowserWindow, session } = require('electron');
const { applyChromeUserAgent } = require('../../../desktop/browser-services/user-agent.cjs');
app.setPath('userData', path.join(os.tmpdir(), 'acira-ua-' + process.pid));
app.on('window-all-closed', () => { });
process.on('uncaughtException', error => { process.stdout.write('ERROR ' + (error && error.stack || error) + '\n'); app.exit(1); });
const fallback = applyChromeUserAgent(app);
const HINTS = ['Sec-CH-UA-Full-Version-List', 'Sec-CH-UA-Platform-Version', 'Sec-CH-UA-Arch', 'Sec-CH-UA-Bitness', 'Sec-CH-UA-Model', 'Sec-CH-UA-Wow64', 'Sec-CH-UA-Form-Factors'];
const requests = [];
// What a worker can read. Dedicated workers, service workers and pages are all compared against the same expectations.
const WORKER_REPORT = `function () { return { ua: navigator.userAgent, languages: [...navigator.languages], language: navigator.language, brands: navigator.userAgentData ? navigator.userAgentData.brands : null }; }`;
const WORKER_BODY = `self.postMessage((${WORKER_REPORT})())`;
// Production wiring: language preference only; native Client Hints and UAData.
// UA_FIXTURE_NATIVE=1 measures the engine without the language preference.
const { scriptFor, addNativeHints } = require('../../../desktop/browser-services/chrome-identity.cjs');
const wired = new WeakSet(), PAGE_LANGUAGES = ['en-US'];
if (process.env.UA_FIXTURE_NATIVE !== '1') require('electron').ipcMain.on('acira:chrome-identity', event => { event.returnValue = /^https?:/.test(event.senderFrame?.url || '') ? scriptFor(PAGE_LANGUAGES, { topUrl: event.sender.getURL(), frameUrl: event.senderFrame.url }) : ''; });
function wire(ses) {
  if (wired.has(ses) || process.env.UA_FIXTURE_NATIVE === '1') return; wired.add(ses);
  ses.webRequest.onBeforeSendHeaders((details, done) => { const { requestHeaders } = addNativeHints(details); done(requestHeaders ? { requestHeaders } : {}); });
  ses.registerPreloadScript({ type: 'frame', filePath: path.join(__dirname, '..', '..', '..', 'desktop', 'browser-services', 'chrome-identity-preload.cjs') });
}
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  requests.push({ path: url.pathname, label: url.searchParams.get('s') || '', headers: req.headers });
  res.setHeader('Accept-CH', HINTS.join(', '));
  if (url.pathname === '/worker.js') { res.setHeader('content-type', 'text/javascript'); res.end(WORKER_BODY); return; }
  if (url.pathname === '/sw.js') { res.setHeader('content-type', 'text/javascript'); res.end(`self.addEventListener('message', event => event.source.postMessage((${WORKER_REPORT})()));`); return; }
  if (url.pathname === '/frame') { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end('<!doctype html><title>frame</title>'); return; }
  if (url.pathname === '/echo') { res.setHeader('content-type', 'application/json'); res.end('{}'); return; }
  res.setHeader('content-type', 'text/html; charset=utf-8'); res.end('<!doctype html><title>ua</title><body>ua');
});
const PROBE = `(async () => {
  const data = navigator.userAgentData;
  const high = data ? await data.getHighEntropyValues(['architecture', 'bitness', 'model', 'platformVersion', 'uaFullVersion', 'fullVersionList', 'wow64', 'formFactors']).catch(error => ({ error: String(error) })) : null;
  const worker = await new Promise(resolve => { try { const w = new Worker('/worker.js?s=' + encodeURIComponent(location.search.slice(3))); w.onmessage = event => resolve(event.data); w.onerror = () => resolve(null); setTimeout(() => resolve(null), 3000); } catch { resolve(null); } });
  await fetch('/echo' + location.search).catch(() => null);
  const frameInfo = await new Promise(resolve => { const f = document.createElement('iframe'); f.src = '/frame'; f.onload = () => { const n = f.contentWindow.navigator; resolve({ ua: n.userAgent, languages: [...n.languages], brands: n.userAgentData ? n.userAgentData.brands : null }); }; document.body.appendChild(f); setTimeout(() => resolve(null), 3000); });
  const serviceWorker = await (async () => { try { const reg = await navigator.serviceWorker.register('/sw.js'); await navigator.serviceWorker.ready; const answer = new Promise(resolve => { navigator.serviceWorker.onmessage = event => resolve(event.data); setTimeout(() => resolve(null), 3000); }); (reg.active || reg.waiting || reg.installing).postMessage('probe'); const data = await answer; await reg.unregister(); return data; } catch (error) { return { error: String(error) }; } })();
  return { languages: [...navigator.languages], language: navigator.language, chromeObject: typeof window.chrome, chromeKeys: window.chrome ? Object.keys(window.chrome) : null, webdriver: navigator.webdriver, frameInfo, serviceWorker, json: data ? data.toJSON() : null, ua: navigator.userAgent, appVersion: navigator.appVersion, product: navigator.product, vendor: navigator.vendor, brands: data ? data.brands : null, mobile: data ? data.mobile : null, platform: data ? data.platform : null, high, worker, hasProcess: typeof process !== 'undefined', hasRequire: typeof require !== 'undefined' };
})()`;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
app.whenReady().then(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port, out = [];
  const kinds = [
    ['default', () => ({ session: session.defaultSession })],
    ['profile', () => ({ session: session.fromPartition('persist:acira-browser-personal') })],
    ['profile-2', () => ({ session: session.fromPartition('persist:acira-profile-two') })],
    ['private', () => ({ session: session.fromPartition('acira-private-' + process.pid) })],
    ['peek', () => ({ partition: 'persist:acira-browser-personal' })]
  ];
  for (const [label, make] of kinds) {
    const prefs = make(); wire(prefs.session || session.fromPartition(prefs.partition));
    const win = new BrowserWindow({ show: false, width: 800, height: 600, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegrationInSubFrames: process.env.UA_FIXTURE_SUBFRAMES === '1', ...prefs } });
    const ses = win.webContents.session;
    await win.loadURL(`${base}/?s=${label}`); await sleep(150);
    const page = await win.webContents.executeJavaScript(PROBE);
    // A second same-origin navigation carries the high-entropy hints requested by Accept-CH.
    await win.loadURL(`${base}/?s=${label}-second`); await sleep(150);
    const second = await win.webContents.executeJavaScript(PROBE);
    // A popup opened by the page shares the session and must introduce itself the same way.
    const popupUa = await new Promise(resolve => {
      win.webContents.setWindowOpenHandler(() => ({ action: 'allow', overrideBrowserWindowOptions: { show: false } }));
      win.webContents.once('did-create-window', async child => { await sleep(300); resolve({ ua: await child.webContents.executeJavaScript('navigator.userAgent').catch(() => null), sameSession: child.webContents.session === ses, wcUa: child.webContents.getUserAgent() }); child.destroy(); });
      win.webContents.executeJavaScript(`window.open('${base}/?s=${label}-popup'); 0`);
      setTimeout(() => resolve(null), 5000);
    });
    const mainFetch = await ses.fetch(`${base}/echo?s=${label}-main`).then(r => r.status).catch(error => String(error));
    out.push({ label, sessionUa: ses.getUserAgent(), wcUa: win.webContents.getUserAgent(), page, second, popup: popupUa, mainFetch });
    win.destroy();
  }
  process.stdout.write('RESULT ' + JSON.stringify({ fallback, appUserAgentFallback: app.userAgentFallback, chrome: process.versions.chrome, electron: process.versions.electron, sessions: out, requests }) + '\n');
  server.close(); app.exit(0);
});
