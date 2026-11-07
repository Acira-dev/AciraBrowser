'use strict';
// Electron runner for tests/private-extension-electron.test.cjs: the real engine. An extension of an ordinary profile, allowed in private, runs inside a temporary
// private session (a session kept in a folder), with its settings copied in one way; a memory-only private session beside it gets nothing; the folder goes away.
const path = require('node:path'), os = require('node:os'), fs = require('node:fs'), http = require('node:http');
const { app, session, BrowserWindow } = require('electron');
const root = process.env.ACIRA_PRIVATE_SWEEP_ROOT || fs.mkdtempSync(path.join(process.env.ACIRA_TEST_TMP || os.tmpdir(), 'acira-private-electron-'));
if (!path.basename(root).startsWith('acira-private-electron-')) throw Error('Use only the owned private-extension fixture');
app.setPath('userData', path.join(root, 'user-data'));
app.on('window-all-closed', () => { });
process.on('uncaughtException', error => { process.stdout.write('ERROR ' + (error && error.stack || error) + '\n'); app.exit(1); });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const sessions = require('../../../desktop/browser-services/private-extension-sessions.cjs');
const { createExtensionManager } = require('../../../desktop/browser-services/extension-manager.cjs');

async function inExtension(ses, id, script) {
  const win = new BrowserWindow({ show: false, webPreferences: { session: ses } });
  try { await win.loadURL(`chrome-extension://${id}/manifest.json`); return await win.webContents.executeJavaScript(script); } finally { win.destroy(); }
}
async function pageAttributes(ses, url) {
  const win = new BrowserWindow({ show: false, webPreferences: { session: ses, sandbox: true, contextIsolation: true } });
  try {
    await win.loadURL(url);
    for (let i = 0; i < 60; i++) {
      const values = await win.webContents.executeJavaScript(`({ran: document.documentElement.getAttribute('data-pe'), setting: document.documentElement.getAttribute('data-setting'), sw: document.documentElement.getAttribute('data-sw')})`);
      if (values.sw || (values.ran === null && i > 12)) return values;
      await sleep(250);
    }
    return await win.webContents.executeJavaScript(`({ran: document.documentElement.getAttribute('data-pe'), setting: document.documentElement.getAttribute('data-setting'), sw: document.documentElement.getAttribute('data-sw')})`);
  } finally { win.destroy(); }
}

app.whenReady().then(async () => {
  if (process.env.ACIRA_PRIVATE_SWEEP_ROOT) {
    const removed = sessions.sweep(app.getPath('userData'));
    const remaining = fs.readdirSync(path.join(app.getPath('userData'), 'Partitions')).filter(name => name.startsWith(sessions.PREFIX));
    process.stdout.write('SWEEP ' + JSON.stringify({ removed, remaining }) + '\n'); app.exit(0); return;
  }
  const server = http.createServer((request, response) => { response.setHeader('content-type', 'text/html'); response.end('<!doctype html><title>t</title><p>page</p>'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/`, result = {};
  const packageFolder = path.join(root, 'package'); fs.cpSync(path.join(__dirname, 'ext'), packageFolder, { recursive: true });
  const ordinary = session.fromPartition('persist:acira-ordinary');
  const extension = await ordinary.extensions.loadExtension(packageFolder, { allowFileAccess: false }); await sleep(500);
  const id = extension.id;
  fs.writeFileSync(path.join(root, 'extensions.json'), JSON.stringify({ version: 2, entries: [{ id, profileId: 'profile-personal', path: packageFolder, name: 'Private probe', version: '1.0', permissions: ['storage', 'http://127.0.0.1/*'], enabled: true, source: 'Local folder', allowPrivate: true }] }));
  await inExtension(ordinary, id, "new Promise(done => chrome.storage.local.set({setting: 'from-ordinary'}, () => done(true)))");
  const manager = createExtensionManager({ getSession: partition => session.fromPartition(partition), getProfiles: () => [{ id: 'profile-personal', name: 'Personal', partition: 'persist:acira-ordinary' }], getWindow: () => null, dialog: { showMessageBox: async () => ({ response: 1 }) }, registryPath: path.join(root, 'extensions.json'), browser: {} });
  result.wanted = manager.privateWanted('profile-personal');

  const partition = sessions.newPartition('tab'), priv = sessions.create(partition);
  result.persistent = [priv.isPersistent(), sessions.persistent(priv), sessions.isTemporary(priv)];
  const profile = { id: 'private-tab-test', name: 'Private tab', partition, private: true, extensionsFrom: 'profile-personal' };
  const folder = sessions.folderOf(priv); result.folderUnderPartitions = path.dirname(folder) === path.join(app.getPath('userData'), 'Partitions');
  result.attached = await manager.attachPrivate({ session: priv, profile, sourceProfileId: 'profile-personal', implementation: {}, runtimeDir: path.join(folder, 'acira-runtime'), settingsFrom: ordinary.storagePath });
  result.inPrivate = await pageAttributes(priv, url);
  const memory = session.fromPartition('acira-private-tab-control');
  result.inMemoryPrivate = await pageAttributes(memory, url);
  result.memoryLoadError = await memory.extensions.loadExtension(packageFolder).then(() => null, error => String(error.message || error));
  await inExtension(priv, id, "new Promise(done => chrome.storage.local.set({privateOnly: 'yes'}, () => done(true)))");
  result.ordinaryAfter = await inExtension(ordinary, id, "new Promise(done => chrome.storage.local.get(null, values => done(values)))");
  result.privateStorage = await inExtension(priv, id, "new Promise(done => chrome.storage.local.get(null, values => done(values)))");
  result.runtimeFilesInFolder = fs.existsSync(path.join(folder, 'acira-runtime', 'extension-install-state'));
  result.detached = manager.detachPrivate(priv); await sleep(300);
  result.loadedAfterDetach = priv.extensions.getAllExtensions().length;
  result.removed = sessions.removeFolder(app.getPath('userData'), priv); result.folderAfter = fs.existsSync(folder);
  result.ordinaryStillThere = ordinary.extensions.getAllExtensions().length;
  server.close();
  process.stdout.write('RESULT ' + JSON.stringify({ ...result, root }) + '\n');
  app.exit(0);
});
