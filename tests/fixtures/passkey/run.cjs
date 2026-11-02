'use strict';
// Electron runner for tests/passkey-guard.test.cjs: applies the guard script from desktop/browser-services/passkey-guard-preload.cjs to a page whose
// navigator.credentials.get/create are replaced by stubs first (so no Windows passkey dialog can appear), then calls them with and without user activation,
// with the "Passkeys and security keys" choice on (window.__passkeysAllowed, standing in for the main process's answer) and then switched off.
// PublicKeyCredential.isConditionalMediationAvailable is Chromium's own: it is read before and after the guard (it never shows any window).
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { app, BrowserWindow, session } = require('electron');
app.setPath('userData', path.join(os.tmpdir(), 'acira-passkey-' + process.pid));
app.on('window-all-closed', () => { });
process.on('uncaughtException', error => { process.stdout.write('ERROR ' + (error && error.stack || error) + '\n'); app.exit(1); });
process.on('unhandledRejection', error => { process.stdout.write('ERROR ' + (error && error.stack || error) + '\n'); app.exit(1); });
// Credentials exist only in secure contexts; http://127.0.0.1 is one.
const server = require('node:http').createServer((req, res) => { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><title>t</title>' + (req.url === '/native' ? '<iframe src="/frame"></iframe>' : '<p>x</p>')); });
const source = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'desktop', 'browser-services', 'passkey-guard-preload.cjs'), 'utf8');
const match = /const guard = (function \(allowed, mac\) \{[\s\S]*?\n\});\r?\n/.exec(source);
if (!match) { process.stdout.write('ERROR guard script not found in the preload\n'); app.exit(1); }
const guard = match[1];
const STUB = `(async () => { window.__calls = []; const proto = CredentialsContainer.prototype;
  const create = function create(options) { window.__calls.push('create'); return Promise.resolve('CREATED'); };
  const get = function get(options) { window.__calls.push('get'); return Promise.resolve('GOT'); };
  Object.defineProperty(proto, 'create', { value: create, writable: true, configurable: true, enumerable: true });
  Object.defineProperty(proto, 'get', { value: get, writable: true, configurable: true, enumerable: true });
  return { conditionalBefore: await PublicKeyCredential.isConditionalMediationAvailable() };
})()`;
const KEY = `{ challenge: new Uint8Array(1), rp: { name: 'x' }, user: { id: new Uint8Array(1), name: 'a', displayName: 'a' }, pubKeyCredParams: [] }`;
const CALLS = `(async () => {
  const out = {};
  const attempt = async (label, run) => { try { out[label] = String(await run()); } catch (error) { out[label] = error.name + ': ' + error.message; } };
  out.activeAtStart = navigator.userActivation.isActive;
  out.uvpaa = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  out.capabilities = PublicKeyCredential.getClientCapabilities ? await PublicKeyCredential.getClientCapabilities() : null;
  out.conditionalAvailable = await PublicKeyCredential.isConditionalMediationAvailable();
  const controller = new AbortController();
  const pending = navigator.credentials.get({ mediation: 'conditional', publicKey: { challenge: new Uint8Array(1) }, signal: controller.signal }).then(String, error => error.name);
  await new Promise(resolve => setTimeout(resolve, 150));
  controller.abort(); out.conditionalGet = await pending;
  await attempt('conditionalCreate', () => navigator.credentials.create({ mediation: 'conditional', publicKey: ${KEY} }));
  await attempt('password', () => navigator.credentials.create({ password: { id: 'a', password: 'b' } }));
  await attempt('noOptions', () => navigator.credentials.create(undefined));
  await attempt('passwordGet', () => navigator.credentials.get({ password: true }));
  const started = performance.now();
  await attempt('publicKey', () => navigator.credentials.get({ publicKey: { challenge: new Uint8Array(1) } }));
  out.publicKeyMs = performance.now() - started;
  await attempt('publicKeyCreate', () => navigator.credentials.create({ publicKey: ${KEY} }));
  out.calls = window.__calls.slice();
  out.name = CredentialsContainer.prototype.get.name; out.createName = CredentialsContainer.prototype.create.name;
  out.text = Function.prototype.toString.call(CredentialsContainer.prototype.get);
  return out;
})()`;
// macOS: the registered guard above the QA stub (passkey-test-stub-preload.cjs records the engine's calls). No stub, no request: then
// nothing here may reach a real authenticator.
const MAC_CALLS = `async () => {
  if (!Array.isArray(window.__passkeyStubCalls)) return null;
  const out = {}, key = window.PublicKeyCredential, id = new Uint8Array(16);
  const attempt = async (label, run) => { const started = performance.now(); try { out[label] = String(await run()); } catch (error) { out[label] = error.name + ': ' + error.message; } out[label + 'Ms'] = Math.round(performance.now() - started); };
  out.uvpaa = await key.isUserVerifyingPlatformAuthenticatorAvailable();
  out.capabilities = await key.getClientCapabilities();
  const passkey = { challenge: new Uint8Array(32), timeout: 300000, userVerification: 'preferred', allowCredentials: [{ type: 'public-key', id, transports: ['internal', 'hybrid'] }] };
  await attempt('passkey', () => navigator.credentials.get({ publicKey: passkey }));
  await attempt('discoverable', () => navigator.credentials.get({ publicKey: { challenge: new Uint8Array(32) } }));
  await attempt('create', () => navigator.credentials.create({ publicKey: ${KEY} }));
  await attempt('securityKey', () => navigator.credentials.get({ publicKey: { ...passkey, allowCredentials: [{ type: 'public-key', id, transports: ['usb', 'nfc'] }] } }));
  await attempt('createSecurityKey', () => navigator.credentials.create({ publicKey: { ...${KEY}, authenticatorSelection: { authenticatorAttachment: 'cross-platform' } } }));
  await attempt('password', () => navigator.credentials.get({ password: true }));
  out.calls = window.__passkeyStubCalls.slice();
  return out;
}`;
const NATIVE_PROBE = `(async () => {
  const before = window.__nativePasskeyBaseline;
  const key = window.PublicKeyCredential;
  return {
    platform: before.platform,
    sandboxed: before.sandboxed,
    unchanged: {
      get: CredentialsContainer.prototype.get === before.get,
      create: CredentialsContainer.prototype.create === before.create,
      conditional: key.isConditionalMediationAvailable === before.conditional,
      capabilities: key.getClientCapabilities === before.capabilities
    },
    conditionalBefore: await before.conditionalBefore,
    conditionalAvailable: await key.isConditionalMediationAvailable(),
    engine: before.capabilities ? await before.capabilities.call(key) : null,
    mac: before.platform === 'darwin' ? await (${MAC_CALLS})() : undefined
  };
})()`;
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 800, height: 600, webPreferences: { sandbox: true, contextIsolation: true } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  await win.loadURL(`http://127.0.0.1:${server.address().port}/`);
  const before = await win.webContents.executeJavaScript(STUB);
  await win.webContents.executeJavaScript('(' + guard + ')(() => window.__passkeysAllowed !== false)');
  const without = await win.webContents.executeJavaScript(CALLS);
  // A click or key press gives the page transient activation; executeJavaScript with userGesture=true is the same state.
  await win.webContents.executeJavaScript('window.__calls = []');
  const withGesture = await win.webContents.executeJavaScript(CALLS, true);
  // The person turns the choice off while the page is open: the very next request is refused, a click or not.
  await win.webContents.executeJavaScript('window.__passkeysAllowed = false; window.__calls = []');
  const off = await win.webContents.executeJavaScript(CALLS, true);
  const native = {};
  if (process.platform !== 'win32') {
    const ses = session.fromPartition('passkey-native-' + process.pid);
    ses.registerPreloadScript({type: 'frame', filePath: path.join(__dirname, 'native-preload.cjs')});
    // The order content-blocking.cjs uses in test profiles: the QA stub below the guard. The stub only records on a Mac run.
    if (process.platform === 'darwin') ses.registerPreloadScript({type: 'frame', filePath: path.join(__dirname, '..', '..', '..', 'desktop', 'browser-services', 'passkey-test-stub-preload.cjs')});
    ses.registerPreloadScript({type: 'frame', filePath: path.join(__dirname, '..', '..', '..', 'desktop', 'browser-services', 'passkey-guard-preload.cjs')});
    const page = new BrowserWindow({show: false, webPreferences: {session: ses, sandbox: true, contextIsolation: true, nodeIntegrationInSubFrames: true}});
    await page.loadURL(`http://127.0.0.1:${server.address().port}/native`);
    native.page = await page.webContents.executeJavaScript(NATIVE_PROBE);
    const frame = page.webContents.mainFrame.frames.find(frame => frame.url.endsWith('/frame'));
    if (!frame) throw Error('native iframe did not load');
    native.frame = await frame.executeJavaScript(NATIVE_PROBE);
    page.webContents.setWindowOpenHandler(() => ({action: 'allow', overrideBrowserWindowOptions: {show: false}}));
    const popupReady = new Promise(resolve => page.webContents.once('did-create-window', popup => {
      popup.webContents.once('did-finish-load', () => resolve(popup));
    }));
    await page.webContents.executeJavaScript(`window.open('/popup', 'passkey-native-popup'); void 0;`, true);
    const popup = await popupReady;
    native.popup = await popup.webContents.executeJavaScript(NATIVE_PROBE);
  }
  process.stdout.write('RESULT ' + JSON.stringify({ before, without, withGesture, off, native }) + '\n');
  app.exit(0);
});
