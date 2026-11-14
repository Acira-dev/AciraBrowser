'use strict';
// chrome.downloads, main process (package P7; contract: docs/launch/EXTENSION_WORK_PACKAGES.md).
// An extension's download is a download of Acira: it goes through the same manager (browser-services/download-engine.cjs), shows in the
// Downloads page, uses the profile's cookies, and everything the person downloads is visible to downloads.search / onChanged, as in Chrome.
// Private, Tor and secured downloads are never visible here (their records are filtered out, and the manager never reports them).
//
// The manager is reached through one hook, downloads/host.cjs (connected by main.cjs); pure logic is in downloads/item.cjs.
const fs = require('node:fs');
const path = require('node:path');
const host = require('./downloads/host.cjs');
const items = require('./downloads/item.cjs');
const {createIdStore} = require('./downloads/ids.cjs');
const determine = require('./downloads/determine.cjs');
const {ERRORS} = items;
const EVENT_DETERMINING = 'downloads.onDeterminingFilename';

const stores = new Map();
/** One id store per profile folder: every profile's package in this process shares it (ids are unique across profiles). */
function idStoreFor(userData) {
  const file = userData ? path.join(userData, 'extension-download-ids.json') : null, key = file || ':memory:';
  if (!stores.has(key)) stores.set(key, createIdStore({file}));
  return stores.get(key);
}

/** The extensions of a profile in the order they were added (Acira's registry keeps that order), oldest first: onDeterminingFilename's "installed last wins". */
function installOrder(userData, profileId) {
  try {
    const entries = JSON.parse(fs.readFileSync(path.join(userData, 'extensions.json'), 'utf8')).entries;
    return (Array.isArray(entries) ? entries : []).filter(entry => entry && entry.profileId === profileId).map(entry => String(entry.id));
  } catch { return []; }
}

const visible = (record, profileId) => !!record && !record.private && record.browserProfileId === profileId && !String(record.browserProfileId || '').startsWith('private-');

module.exports = {
  namespaces: ['downloads'],
  install(api) {
    const profileId = api.storeKey;
    const ids = idStoreFor(api.userData);
    const records = () => { const current = host.current(); return (current ? current.records(profileId) : []).filter(record => visible(record, profileId)); };
    const exists = file => { const current = host.current(); return typeof current?.exists === 'function' ? current.exists(file) : fs.existsSync(file); };
    const itemOf = record => items.toItem(record, ids.idFor(record.id), {exists});
    const allItems = () => records().map(itemOf);
    const needHost = () => { const current = host.current(); if (!current) throw new Error(ERRORS.generic); return current; };
    /** The visible record named by an integer id, or Chromium's "Invalid downloadId". */
    const recordOf = id => { const recordId = ids.recordFor(id), record = recordId && records().find(item => item.id === recordId); if (!record) throw new Error(ERRORS.invalidId); return record; };
    const extensionOf = event => ({id: event.extension.id, name: event.extension.name || event.extension.manifest?.name || ''});

    api.handle('downloads.download', async (event, options) => {
      const request = items.normalizeDownloadOptions(options);
      if (request.method === 'POST') throw new Error('Acira cannot start POST downloads from an extension yet.');
      const recordId = await needHost().start(profileId, api.session, {...request, extension: extensionOf(event)});
      return ids.idFor(recordId);
    });
    api.handle('downloads.search', (event, query) => items.search(allItems(), query || {}));

    api.handle('downloads.pause', async (event, id) => {
      const record = recordOf(id), item = itemOf(record);
      if (item.state !== 'in_progress') throw new Error(ERRORS.notInProgress);
      if (!item.paused) await needHost().command(profileId, record.id, 'pause');
    });
    api.handle('downloads.resume', async (event, id) => {
      const record = recordOf(id), item = itemOf(record);
      if (!item.paused && !item.canResume) throw new Error(ERRORS.notResumable);
      await needHost().command(profileId, record.id, 'resume');
    });
    api.handle('downloads.cancel', async (event, id) => {
      const record = recordOf(id);
      if (itemOf(record).state === 'in_progress') await needHost().command(profileId, record.id, 'cancel');
    });
    api.handle('downloads.open', async (event, id) => {
      if (!api.permissions?.has(event.extension, 'downloads.open')) throw new Error(ERRORS.openPermission);
      const record = recordOf(id), item = itemOf(record);
      if (item.state !== 'complete') throw new Error(ERRORS.notComplete);
      if (!item.exists) throw new Error(ERRORS.fileAlreadyDeleted);
      await needHost().command(profileId, record.id, 'open');
    });
    api.handle('downloads.show', async (event, id) => {
      const record = recordOf(id);
      await needHost().command(profileId, record.id, 'show');
    });
    api.handle('downloads.showDefaultFolder', () => { needHost().showDefaultFolder(); });
    // Acira has no download shelf or bubble of its own to hide or show for an extension: the option is accepted (with Chromium's permission rule).
    api.handle('downloads.setUiOptions', (event) => {
      if (!api.permissions?.has(event.extension, 'downloads.ui')) throw new Error('downloads.setUiOptions requires the "downloads.ui" permission');
    });
    api.handle('downloads.erase', async (event, query) => {
      const found = items.search(allItems(), query || {}), byId = new Map(records().map(record => [ids.idFor(record.id), record]));
      const doomed = found.map(item => byId.get(item.id)).filter(Boolean);
      if (doomed.length) await needHost().erase(profileId, doomed.map(record => record.id));
      for (const record of doomed) { const id = ids.idFor(record.id); api.broadcast('downloads.onErased', id); ids.forget(record.id); told.delete(record.id); }
      return found.map(item => item.id);
    });
    api.handle('downloads.removeFile', async (event, id) => {
      const record = recordOf(id), item = itemOf(record);
      if (item.state !== 'complete') throw new Error(ERRORS.notComplete);
      if (!item.exists) throw new Error(ERRORS.fileAlreadyDeleted);
      try { await needHost().removeFile(profileId, record.id); } catch { throw new Error(ERRORS.fileNotRemoved); }
      // Chromium reports the file going away: exists true -> false.
      const delta = items.deltaOf(item, {...item, exists: false});
      if (delta && api.listening('downloads.onChanged').length) api.broadcast('downloads.onChanged', delta);
    });

    // chrome.downloads.onDeterminingFilename: the manager asks before it names a file (host.determiner), the extension answers with suggest().
    const determiner = determine.createDeterminer({
      listening: () => api.listening(EVENT_DETERMINING),
      send: (extensionId, payload) => api.emit(extensionId, EVENT_DETERMINING, payload),
      order: () => installOrder(api.userData, api.sourceProfileId || profileId)
    });
    api.handle('downloads.determineFilename', (event, key, suggestion) => { determiner.answer(event.extension.id, key, suggestion); });
    const unloaded = (_event, extension) => determiner.forget(extension && extension.id);
    try { api.session?.extensions?.on?.('extension-unloaded', unloaded); } catch { /* an engine without extension events: the time limit covers it */ }
    // The item an extension is asked about carries the file's BASE name, not its whole path: Chromium's ChromeDownloadManagerDelegate::NotifyExtensions
    // passes virtual_path.BaseName() to ExtensionDownloadsEventRouter::OnDeterminingFilename (13.7 sent the absolute path, so an extension that
    // answers with item.filename, or puts a folder in front of it, got "Invalid filename" back and its answer was dropped).
    const unsetDeterminer = host.setDeterminer(profileId, {listening: determiner.listening, determine: record => determiner.determine({...itemOf(record), filename: path.basename(String(record.path || ''))})});

    // Events from the manager. The change is applied to the Downloads page's records after this runs, so records() is still "before".
    const listening = () => ({created: api.listening('downloads.onCreated').length > 0, changed: api.listening('downloads.onChanged').length > 0});
    // What the extensions were last told about a download that is still running: the next change is measured against that, so a state the manager
    // only holds for itself (paused while the file's name is chosen) never shows up as a change the extension did not see coming.
    const told = new Map();
    const off = host.on(event => {
      const record = event.record;
      if (!record || event.profileId !== profileId || !visible({...record, browserProfileId: event.profileId}, profileId)) return;
      const wanted = listening();
      if (event.type === 'created') {
        const item = itemOf(record);
        if (wanted.created) { api.broadcast('downloads.onCreated', item); if (item.state === 'in_progress') told.set(record.id, item); } else ids.idFor(record.id);
      } else if (event.type === 'changed') {
        if (!wanted.changed) { told.delete(record.id); return; }
        const page = records().find(item => item.id === record.id);
        const before = told.get(record.id) || (page ? itemOf(page) : null);
        if (!before) return;
        const after = itemOf({...(page || {}), ...record});
        if (after.state === 'in_progress') told.set(record.id, after); else told.delete(record.id);
        const delta = items.deltaOf(before, after);
        if (delta) api.broadcast('downloads.onChanged', delta);
      }
    });
    return {dispose() { off(); unsetDeterminer(); determiner.dispose(); try { api.session?.extensions?.removeListener?.('extension-unloaded', unloaded); } catch { /* gone with the session */ } ids.flush(); }};
  }
};
