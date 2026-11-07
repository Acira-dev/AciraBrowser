'use strict';
// Electron runner for tests/google-sign-in-fedcm.test.cjs. Starts the engine the way Acira does (the real engine-features module, before ready) or, for the
// control, without it, loads a page from a local address (a secure context, as FedCM needs) and reports what that page sees of the FedCM API: whether
// window.IdentityCredential exists (what Google Identity Services checks before it chooses FedCM over its own sign-in window) and what an
// identity request does. Usage: electron run.cjs <on|off>
const path = require('node:path'), fs = require('node:fs'), os = require('node:os'), http = require('node:http');
const { app, BrowserWindow } = require('electron');
for (const event of ['uncaughtException', 'unhandledRejection']) process.on(event, error => { process.stdout.write('ERROR ' + (error && error.stack || error) + '\n'); app.exit(1); });
const mode = process.argv[process.argv.findIndex(arg => arg.endsWith('run.cjs')) + 1];
app.commandLine.appendSwitch('use-mock-keychain'); // never the macOS Keychain from a test
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'acira-fedcm-')));
if (mode === 'on') require(path.join(__dirname, '..', '..', '..', 'desktop', 'browser-services', 'engine-features.cjs')).configureEngineFeatures({ app });
app.on('window-all-closed', () => { });
const server = http.createServer((_req, res) => { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end('<!doctype html><title>fedcm</title><p>probe'); });
app.whenReady().then(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  await win.loadURL(`http://127.0.0.1:${server.address().port}/`);
  const seen = await win.webContents.executeJavaScript(`(async () => {
    const out = { secure: window.isSecureContext, identityCredential: typeof window.IdentityCredential, inWindow: 'IdentityCredential' in window };
    // What the Sign in with Google button asks when the API is there; where it is not, the page never gets this far.
    try { await navigator.credentials.get({ identity: { providers: [{ configURL: 'https://accounts.example.test/fedcm.json', clientId: 'x' }], mode: 'active' } }); out.request = 'resolved'; }
    catch (error) { out.request = error.name; }
    return out;
  })()`);
  process.stdout.write('RESULT ' + JSON.stringify({ mode, seen, switches: app.commandLine.getSwitchValue('disable-features').split(',').filter(name => name === 'FedCm') }) + '\n');
  server.close(); app.exit(0);
});
