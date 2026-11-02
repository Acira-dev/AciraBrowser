'use strict';
// Electron runner for tests/extension-remove.test.cjs: a real profile session, a real unpacked extension that keeps data in chrome.storage.local,
// localStorage and IndexedDB, removed and added again. The control copy (another folder, so another id) is removed the old way: removeExtension only.
const path = require('node:path'), os = require('node:os'), fs = require('node:fs');
const { app, session, BrowserWindow } = require('electron');
const { clearStorageAreas, deleteExtensionData } = require('../../../desktop/browser-services/extension-data.cjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-extension-data-'));
app.setPath('userData', path.join(root, 'user-data'));
app.on('window-all-closed', () => { });
process.on('uncaughtException', error => { process.stdout.write('ERROR ' + (error && error.stack || error) + '\n'); app.exit(1); });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const WRITE = `new Promise(done => chrome.storage.local.set({vault: 'secret'}, () => { localStorage.setItem('ls', 'kept'); const open = indexedDB.open('db', 1); open.onupgradeneeded = () => open.result.createObjectStore('s'); open.onsuccess = () => { const tx = open.result.transaction('s', 'readwrite'); tx.objectStore('s').put('kept', 'k'); tx.oncomplete = () => { open.result.close(); done('written'); }; }; }))`;
const READ = `new Promise(done => chrome.storage.local.get(null, stored => { const open = indexedDB.open('db', 1); open.onupgradeneeded = () => open.result.createObjectStore('s'); open.onsuccess = () => { const get = open.result.transaction('s').objectStore('s').get('k'); get.onsuccess = () => { open.result.close(); done({storage: stored, localStorage: localStorage.getItem('ls'), indexedDB: get.result || null}); }; }; }))`;
async function inExtension(ses, id, script) { const win = new BrowserWindow({ show: false, webPreferences: { session: ses } }); try { await win.loadURL(`chrome-extension://${id}/manifest.json`); return await win.webContents.executeJavaScript(script); } finally { win.destroy(); } }
async function cycle(ses, folder, remove) {
  const { id } = await ses.extensions.loadExtension(folder); await sleep(500);
  await inExtension(ses, id, WRITE);
  const removed = await remove(id);
  const settings = path.join(ses.storagePath, 'Local Extension Settings', id), folderAfterRemove = fs.existsSync(settings);
  await ses.extensions.loadExtension(folder); await sleep(500);
  const afterReinstall = await inExtension(ses, id, READ);
  ses.extensions.removeExtension(id);
  return { removed, folderAfterRemove, afterReinstall };
}
app.whenReady().then(async () => {
  const ses = session.fromPartition('persist:extension-data');
  const control = path.join(root, 'control'); fs.cpSync(path.join(__dirname, 'probe'), control, { recursive: true });
  // Garbage collection while the hidden page loads (Electron started with --js-flags=--expose-gc): a view nothing refers to is collected with its page.
  const underCollection = async (work) => { const timer = global.gc ? setInterval(() => global.gc(), 1) : null; try { return await work(); } finally { if (timer) clearInterval(timer); } };
  const probe = await ses.extensions.loadExtension(path.join(__dirname, 'probe')); await sleep(300);
  const clears = []; for (let i = 0; i < 5; i++) clears.push(await underCollection(() => clearStorageAreas(ses, probe.id)));
  ses.extensions.removeExtension(probe.id); await sleep(300);
  const result = {
    gc: typeof global.gc === 'function', clears,
    control: await cycle(ses, control, async id => { ses.extensions.removeExtension(id); await sleep(500); return null; }),
    fixed: await cycle(ses, path.join(__dirname, 'probe'), async id => { const cleared = await underCollection(() => clearStorageAreas(ses, id)); ses.extensions.removeExtension(id); await sleep(500); return { cleared, failed: await deleteExtensionData(ses, id) }; })
  };
  process.stdout.write('RESULT ' + JSON.stringify({ ...result, root }) + '\n');
  app.exit(0);
});
