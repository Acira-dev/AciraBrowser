'use strict';
// Real Electron runner for tests/extension-password-manager.test.cjs. The MV3 fixture in ./ext does what a password manager does with the browser
// (Bitwarden is the model): the popup unlocks through storage.session, the worker repaints a per-tab toolbar badge from that state, a content script
// asks the worker, the popup's ports reach the worker, and "make default password manager" asks for the optional privacy permission and holds the three
// privacy.services settings off. Nothing signs in anywhere. Prints one line: RESULT <json>.
const {app, BrowserWindow, session} = require('electron'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const root = path.resolve(__dirname, '..', '..', '..');
const data = fs.mkdtempSync(path.join(process.env.ACIRA_TEST_TMP || os.tmpdir(), 'acira-pw-manager-'));
app.setPath('userData', path.join(data, 'user-data')); app.setName('Acira password manager fixture');
const {createExtensionManager} = require(path.join(root, 'desktop', 'extensions.cjs'));
const folder = path.join(data, 'unpacked'); fs.cpSync(path.join(__dirname, 'ext'), folder, {recursive: true});
const profiles = [{id: 'A', name: 'Fixture', partition: 'persist:pw-manager-fixture'}];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const out = {steps: {}};
const timer = setTimeout(() => { console.log('RESULT ' + JSON.stringify({...out, error: 'timed out'})); app.exit(3); }, 100000);

app.whenReady().then(async () => {
  const server = http.createServer((_q, r) => { r.setHeader('content-type', 'text/html'); r.end('<!doctype html><title>pw fixture</title><body><input id="user" autocomplete="username"><input id="pass" type="password">'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  let page = null, popup = null;
  try {
    const partition = profiles[0].partition;
    page = new BrowserWindow({show: false, webPreferences: {partition, sandbox: true, contextIsolation: true, nodeIntegration: false}});
    const manager = createExtensionManager({
      getSession: name => session.fromPartition(name), getProfiles: () => profiles, getWindow: () => page, registryPath: path.join(data, 'extensions.json'),
      dialog: {showOpenDialog: async () => ({filePaths: [folder]}), showMessageBox: async () => ({response: 1})},   // review dialogs and the permission prompt: "Add" / "Allow"
      browser: {createTab: async () => [page.webContents, page], selectTab: () => {}, removeTab: () => {}}
    });
    manager.attachTab(page.webContents, page); manager.selectTab(page.webContents);
    const loaded = await manager.command({type: 'load', profileId: 'A'});
    if (loaded.error) throw new Error('load: ' + loaded.error);
    const id = loaded.extensions[0].id; out.id = id;
    const run = (wc, code) => wc.executeJavaScript(code, true);
    const until = async (read, accept, ms = 8000) => { const end = Date.now() + ms; let value; do { try { value = await read(); if (accept(value)) return value; } catch (error) { value = {error: String(error && error.message || error)}; } await sleep(100); } while (Date.now() < end); return value; };
    const asked = () => run(page.webContents, `(async () => { document.dispatchEvent(new CustomEvent('pw-ask')); await new Promise(r => setTimeout(r, 400)); const d = document.documentElement.dataset; return {worker: d.pwWorker || null, session: d.pwSession || null}; })()`);

    await page.webContents.loadURL(url);
    out.steps.locked = await until(asked, value => value.worker === 'locked');

    popup = new BrowserWindow({show: false, webPreferences: {partition, sandbox: true, contextIsolation: true, nodeIntegration: false}});
    await popup.loadURL(`chrome-extension://${id}/popup.html`);
    const badge = () => run(popup.webContents, `(async () => { const tab = (await chrome.tabs.query({})).find(t => t.url.startsWith('http://127.0.0.1')); return {tab: tab && tab.id, badge: tab ? await chrome.action.getBadgeText({tabId: tab.id}) : null}; })()`);
    out.steps.lockedBadge = await until(badge, value => value.badge === 'LOCK');

    // The popup unlocks by writing storage.session only (Bitwarden's popup writes the user key there); the worker, the badge and the page must follow.
    await run(popup.webContents, 'pw.unlock(false)');
    out.steps.unlockedWorker = await until(() => run(popup.webContents, 'pw.worker().then(w => ({unlocked: w.unlocked, events: w.events.map(e => e.what + (e.why ? ":" + e.why : ""))}))'), value => value.unlocked === true);
    out.steps.unlockedBadge = await until(badge, value => value.badge === '2');
    out.steps.unlockedPage = await until(asked, value => value.worker === 'unlocked' && value.session === 'unlocked');

    await run(popup.webContents, 'pw.lock(false)');
    out.steps.relockedBadge = await until(badge, value => value.badge === 'LOCK');
    out.steps.relockedPage = await until(asked, value => value.worker === 'locked' && value.session === 'locked');

    // A message and a port from the popup: the worker sees an internal sender (origin set, top frame) for both.
    out.steps.who = await run(popup.webContents, 'pw.whoAmI()');
    out.steps.port = await run(popup.webContents, 'pw.port()');
    out.steps.workerPorts = (await run(popup.webContents, 'pw.worker()')).ports.map(entry => ({name: entry.name, internal: entry.internal, origin: entry.sender && entry.sender.origin}));

    // "Make default password manager": the optional privacy permission, then the three services off; all three must read back as held by the extension.
    out.steps.privacy = await run(popup.webContents, 'pw.makeDefault()');
  } catch (error) { out.error = String(error && error.stack || error); }
  finally { clearTimeout(timer); console.log('RESULT ' + JSON.stringify(out)); server.close(); for (const w of [page, popup]) try { w && w.destroy(); } catch {} setTimeout(() => app.exit(0), 200); }
});
