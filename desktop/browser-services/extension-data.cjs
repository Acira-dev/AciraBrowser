'use strict';
// What removing an extension deletes, as Chrome's uninstall does: its chrome.storage areas, the storage of its chrome-extension:// origin (IndexedDB,
// localStorage, caches, its service worker) and the folders that hold them. Electron's removeExtension only unloads it: a removed extension's data stayed
// on disk and came back when it was added again (probe, 2 Nov: chrome.storage, localStorage and IndexedDB all survived a remove and reinstall), so the
// "Remove" prompt's "its data goes with it" was not true. chrome.storage is emptied from the extension's own page while it is still loaded, because the
// engine keeps its database open and would serve the old values to a reinstall until Acira restarts; deleting the folder alone only works after that.
const fs = require('node:fs'), path = require('node:path');
const STORAGE_FOLDERS = ['Local Extension Settings', 'Sync Extension Settings', 'Managed Extension Settings'];
/** The extension origin's own storage. Not cookies: those are the websites' (the profile's site data is never touched). */
const ORIGIN_STORAGES = ['localstorage', 'indexdb', 'cachestorage', 'serviceworkers', 'filesystem', 'websql', 'shadercache'];
const CLEAR_AREAS = "Promise.all(['local','sync','session'].filter(area=>globalThis.chrome?.storage?.[area]?.clear).map(area=>new Promise(done=>chrome.storage[area].clear(()=>done(area)))))";

/** A hidden view of the profile's session. The view is returned, not only its page: a WebContentsView nothing refers to is garbage-collected and takes its
 *  page with it, and the load then fails at random (ERR_FAILED, "Object has been destroyed"; seen in the app 2 of 3 times). */
function hiddenPage(session) {
  const { WebContentsView } = require('electron');
  return new WebContentsView({ webPreferences: { session, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, spellcheck: false } });
}
const alive = new Set();
const within = (promise, ms) => Promise.race([promise, new Promise(resolve => setTimeout(() => resolve(null), ms).unref?.())]);

/** Empties a loaded extension's chrome.storage areas from a hidden page of its own (its manifest, so none of its code runs). Never throws; false when it could not.
 *  `createPage(session)` returns a view (anything with `webContents`); it is kept referenced until the page is closed. */
async function clearStorageAreas(session, id, { createPage = hiddenPage, timeoutMs = 4000 } = {}) {
  if (!/^[a-p]{32}$/.test(id)) return false;
  let view, page;
  try {
    view = createPage(session); alive.add(view); page = view.webContents;
    const done = await within(page.loadURL(`chrome-extension://${id}/manifest.json`).then(() => page.executeJavaScript(CLEAR_AREAS, true)), timeoutMs);
    return Array.isArray(done);
  } catch { return false; } finally { alive.delete(view); try { if (page && !page.isDestroyed()) (page.close || page.destroy).call(page); } catch { /* already gone */ } }
}

/** After the extension is unloaded: its origin's storage and its chrome.storage folders in this profile's session, nothing else. Never throws; returns what
 *  failed (the manager keeps it and tries again at the next start). */
async function deleteExtensionData(session, id, { io = fs } = {}) {
  const failed = [];
  if (!/^[a-p]{32}$/.test(id)) return ['identity'];
  try { await session.clearStorageData({ origin: `chrome-extension://${id}`, storages: ORIGIN_STORAGES }); } catch { failed.push('origin'); }
  const root = session.storagePath;
  if (typeof root === 'string' && root) for (const folder of STORAGE_FOLDERS) {
    const target = path.join(root, folder, id);
    try { if (path.dirname(path.dirname(target)) === root) io.rmSync(target, { recursive: true, force: true }); } catch { failed.push(folder); }
  }
  return failed;
}
module.exports = { clearStorageAreas, deleteExtensionData, STORAGE_FOLDERS, ORIGIN_STORAGES };
