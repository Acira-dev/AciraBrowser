'use strict';
// Connects chrome.downloads to Acira's real downloads manager. main.cjs calls connectAppHost() once the manager exists; this file is the only
// code that knows about windows ("controllers"), their download records and the manager's API.
//   engine       createDownloads(...) of browser-services/download-engine.cjs
//   controllers  the Set of window controllers (state, commitAction, record, toast, window, pages, profileId, privateMode, closing)
const fs = require('node:fs');
const hostModule = require('./host.cjs');

const privateId = id => String(id || '').startsWith('private-');

function createAppHost({engine, controllers, shell, preferences, app, getSession}) {
  /** A window that can carry the profile's download records: an ordinary (not private) window, preferably of that profile. */
  const controllerFor = profileId => {
    const open = [...controllers].filter(c => !c.privateMode && !c.closing && c.state);
    return open.find(c => c.profileId === profileId) || open[0] || null;
  };
  const allRecords = c => (c ? c.state.downloads : []);
  /** Any page of the profile (the engine resumes an interrupted download through a page's session). */
  const pageFor = profileId => {
    for (const c of controllers) {
      if (c.privateMode || c.closing || !c.pages) continue;
      for (const [id, entry] of c.pages) {
        const tab = c.state.tabs.find(item => item.id === id);
        const contents = entry && entry.view && entry.view.webContents;
        if (tab && tab.browserProfileId === profileId && !entry.privateTab && contents && !contents.isDestroyed()) return contents;
      }
    }
    return null;
  };

  const host = {
    records(profileId) {
      const c = controllerFor(profileId);
      return c ? engine.reconcile(allRecords(c), profileId).filter(record => !record.private) : [];
    },
    async start(profileId, session, request) {
      if (privateId(profileId)) throw new Error('NETWORK_INVALID_REQUEST');
      const c = controllerFor(profileId);
      if (!c) throw new Error('NETWORK_FAILED');
      const owner = {controller: c, window: c.window, profileId, record: c.record, toast: c.toast};
      const headers = {};
      for (const header of request.headers || []) headers[header.name] = headers[header.name] ? `${headers[header.name]}, ${header.value}` : header.value;
      return engine.startExtension({session: session || (getSession && getSession(profileId)), url: request.url, headers, owner, request});
    },
    async command(profileId, recordId, action) {
      const c = controllerFor(profileId);
      if (!c) throw new Error('Download is outside this profile.');
      await engine.command(recordId, action, profileId, allRecords(c), {webContents: pageFor(profileId) || undefined, owner: {window: c.window}});
    },
    async erase(profileId, recordIds) {
      const c = controllerFor(profileId);
      if (!c) return;
      const mine = new Set(allRecords(c).filter(record => record.browserProfileId === profileId && !record.private).map(record => record.id));
      const ids = recordIds.filter(id => mine.has(id));
      // A transfer that is still running is cancelled first, so its last update does not write the record back.
      for (const id of ids) {
        const record = allRecords(c).find(item => item.id === id);
        if (record && ['Downloading', 'Paused'].includes(record.status)) { try { await engine.command(id, 'cancel', profileId, allRecords(c), {}); } catch { /* already finished */ } }
      }
      for (let spin = 0; spin < 40 && ids.some(id => ['Downloading', 'Paused'].includes(allRecords(c).find(item => item.id === id)?.status)); spin++) await new Promise(resolve => setTimeout(resolve, 25));
      c.commitAction({type: 'downloads.erase', ids});
    },
    async removeFile(profileId, recordId) {
      const c = controllerFor(profileId);
      const record = c && allRecords(c).find(item => item.id === recordId && item.browserProfileId === profileId && !item.private);
      if (!record || !record.path) throw new Error('Download is outside this profile.');
      await fs.promises.unlink(record.path);
    },
    showDefaultFolder() { const folder = preferences ? preferences.get().folder : app.getPath('downloads'); if (folder) void shell.openPath(folder); },
    exists: file => fs.existsSync(file)
  };
  return host;
}

/** Called from main.cjs: builds the host, connects it to the package and forwards the manager's events. */
function connectAppHost(options) {
  const host = createAppHost(options);
  const disconnect = hostModule.connect(host);
  const unobserve = options.engine.observe(event => hostModule.emit(event));
  return () => { unobserve(); disconnect(); };
}

module.exports = {createAppHost, connectAppHost};
