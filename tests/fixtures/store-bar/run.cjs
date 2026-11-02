'use strict';
// Electron runner for tests/extension-store-bar.test.cjs: injects the real store-bar-preload.cjs (ipcRenderer and the page address stubbed) into a local
// page titled like a store page and reports what the bar shows in each situation. Usage: electron run.cjs
const http = require('node:http'), fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', path.join(os.tmpdir(), 'acira-store-bar-' + process.pid));
app.on('window-all-closed', () => { });
process.on('uncaughtException', error => { process.stdout.write('ERROR ' + (error && error.stack || error) + '\n'); app.exit(1); });
const ID = 'nngceckbapebfimnlniiiahkandclblb', OTHER = 'ghmbeldphafepmbegfdlkpapadhbakde';
const source = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'desktop', 'browser-services', 'store-bar-preload.cjs'), 'utf8')
  .replace("const {ipcRenderer}=require('electron');", 'const ipcRenderer=globalThis.__fakeIpc;').replace('const pageAddress=()=>location.href;', 'const pageAddress=()=>globalThis.__fakeAddress;');
if (source.includes("require('electron')") || source.includes('location.href')) throw new Error('preload stubs did not apply');
const detail = id => `https://chromewebstore.google.com/detail/bitwarden-password-manager/${id}`;
const server = http.createServer((req, res) => { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end('<!doctype html><title>Bitwarden Password Manager - Chrome Web Store</title><body><h1>Store</h1>'); });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const READ = `(() => { const host = document.getElementById('acira-store-bar'); if (!host) return {visible: false}; const root = host.shadowRoot, button = root.querySelector('button');
  return {visible: true, name: root.querySelector('.name').textContent, note: root.querySelector('.note').textContent, button: button.textContent, disabled: button.disabled, error: root.querySelector('.note').classList.contains('error')}; })()`;
const CLICK = `document.getElementById('acira-store-bar').shadowRoot.querySelector('button').click()`;
async function scenario(port, {address = detail(ID), status, install, steps}) {
  const win = new BrowserWindow({ show: false, width: 1100, height: 700, webPreferences: { sandbox: false, contextIsolation: false } });
  await win.loadURL(`http://127.0.0.1:${port}/`); const wc = win.webContents;
  await wc.executeJavaScript(`globalThis.__log = []; globalThis.__fakeAddress = ${JSON.stringify(address)}; globalThis.__status = ${JSON.stringify(status)}; globalThis.__install = ${JSON.stringify(install || {ok: true, installed: true})};
    globalThis.__fakeIpc = { invoke: (channel, args) => { globalThis.__log.push({channel, args}); if (channel === 'acira:store-status') return Promise.resolve(Array.isArray(globalThis.__status) ? (globalThis.__status.length > 1 ? globalThis.__status.shift() : globalThis.__status[0]) : globalThis.__status); return new Promise(resolve => setTimeout(() => resolve(globalThis.__install), 350)); } }; 0`);
  await wc.executeJavaScript(source + ';0'); await sleep(600);
  const out = await steps(wc); win.destroy(); return out;
}
app.whenReady().then(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const port = server.address().port, result = {};
  const available = {available: true, installed: false, enabled: false, compat: null};
  await scenario(port, {status: available, steps: async wc => {
    result.initial = await wc.executeJavaScript(READ); await wc.executeJavaScript(CLICK); result.adding = await wc.executeJavaScript(READ); await sleep(700); result.added = await wc.executeJavaScript(READ);
    result.invoked = await wc.executeJavaScript('globalThis.__log');
    await wc.executeJavaScript(`globalThis.__fakeAddress = 'https://chromewebstore.google.com/search/vault'`); await sleep(1300); result.navigatedAway = (await wc.executeJavaScript(READ)).visible === false;
    await wc.executeJavaScript(`globalThis.__fakeAddress = ${JSON.stringify(detail(OTHER))}`); await sleep(1500); result.navigatedBack = await wc.executeJavaScript(READ);
  }});
  await scenario(port, {status: available, install: {ok: false, cancelled: true}, steps: async wc => { await wc.executeJavaScript(CLICK); await sleep(700); result.cancelled = await wc.executeJavaScript(READ); }});
  await scenario(port, {status: available, install: {ok: false, error: 'Extension store returned HTTP404.'}, steps: async wc => { await wc.executeJavaScript(CLICK); await sleep(700); result.failed = await wc.executeJavaScript(READ); }});
  await scenario(port, {status: {...available, compat: {status: 'limited', note: 'No desktop unlock.'}}, steps: async wc => { result.compat = await wc.executeJavaScript(READ); }});
  await scenario(port, {status: {...available, installed: true, enabled: true}, steps: async wc => { result.alreadyInstalled = await wc.executeJavaScript(READ); }});
  await scenario(port, {status: {available: false, reason: 'Extensions are off in private windows.'}, steps: async wc => { result.hiddenWhenUnavailable = (await wc.executeJavaScript(READ)).visible === false; }});
  await scenario(port, {address: 'https://chromewebstore.google.com/', status: available, steps: async wc => { result.hiddenOffDetail = (await wc.executeJavaScript(READ)).visible === false; }});
  await scenario(port, {status: available, steps: async wc => { await wc.executeJavaScript(`document.documentElement.replaceChildren(document.head, document.body)`); await sleep(1100); result.reattached = (await wc.executeJavaScript(READ)).visible === true; await wc.executeJavaScript(`document.getElementById('acira-store-bar').remove()`); await sleep(1100); result.reattachedAfterRemove = (await wc.executeJavaScript(READ)).visible === true; }});
  await scenario(port, {status: [{available: false, retry: true, reason: 'Extensions are still starting.'}, available], steps: async wc => { result.startingHidden = (await wc.executeJavaScript(READ)).visible === false; await sleep(2600); result.startingThenShown = await wc.executeJavaScript(READ); result.statusCalls = (await wc.executeJavaScript('globalThis.__log')).filter(entry => entry.channel === 'acira:store-status').length; }});
  process.stdout.write('RESULT ' + JSON.stringify(result) + '\n'); server.close(); app.exit(0);
});
