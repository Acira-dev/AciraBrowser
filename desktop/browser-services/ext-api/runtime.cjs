'use strict';
// chrome.runtime, main side (P3). What Chromium's own runtime already does in Electron stays native and is not touched here: getURL,
// getManifest, getPlatformInfo, sendMessage / connect (also to other extensions and from web pages through externally_connectable, which
// reach onMessageExternal / onConnectExternal: verified in the real app), onMessage, lastError, id, reload.
// This file adds what Electron lacks:
//  - onInstalled: Electron never dispatches it (Chromium's install flow is not used), so an extension's install code (context menus, defaults,
//    welcome page) never ran. Acira follows the engine's extension-loaded / -unloaded events with a per-profile record of the versions it has seen
//    and sends Chrome's details ('install', 'update' with previousVersion, 'chrome_update'), held until the extension's worker has registered its
//    listener in the first run of its script (runtime-renderer.cjs feeds chrome.runtime.onInstalled from it); onStartup the same way, once per
//    profile start. onSuspend / onSuspendCanceled are never sent: Acira never unloads a background page or worker on a timer for the extension to
//    be told about (Chrome sends them only to event pages it is about to unload);
//  - setUninstallURL: the URL is kept per extension (the engine never opens it) and opened in a new tab when the user removes the extension;
//  - openOptionsPage: Chrome's error when there is no options page, and an options tab that is already open is brought forward.
const fs = require('node:fs');
const path = require('node:path');

const NO_OPTIONS = 'Could not create an options page.';
const internals = {
  /** Acira's version, for 'chrome_update' (replaced in tests). */
  browserVersion() { try { return String(require('electron').app.getVersion()); } catch { return ''; } },
  /** Web contents showing one of this extension's pages (replaced in tests). The window's own selectTab refuses a page of another profile. */
  webContents(_session, extensionId) {
    try { return require('electron').webContents.getAllWebContents().filter(wc => !wc.isDestroyed() && wc.getURL().startsWith(`chrome-extension://${extensionId}/`)); } catch { return []; }
  }
};

const sameDocument = (a, b) => { try { const x = new URL(a), y = new URL(b); x.hash = ''; y.hash = ''; return x.href === y.href; } catch { return false; } };
const webURL = value => { try { const url = new URL(String(value)); return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null; } catch { return null; } };

/** The per-profile file of uninstall URLs: {extensionId: url}. */
function uninstallStore(file) {
  const read = () => { try { const data = JSON.parse(fs.readFileSync(file, 'utf8')); return data && typeof data === 'object' && !Array.isArray(data) ? data : {}; } catch { return {}; } };
  const write = data => { try { fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, JSON.stringify(data)); } catch { /* keep going: the URL is a courtesy */ } };
  return {
    get: id => { const url = read()[id]; return typeof url === 'string' ? url : ''; },
    set(id, url) { const data = read(); if (url) data[id] = url; else delete data[id]; write(data); },
    take(id) { const data = read(), url = typeof data[id] === 'string' ? data[id] : ''; if (id in data) { delete data[id]; write(data); } return url; }
  };
}

/**
 * The versions this profile has seen, {browser, extensions: {id: {version}}}, in <userData>/extension-install-state/<profile>.json. The first time
 * (no file), extensions already installed (the registry file extensions.json) are recorded as they are, so updating Acira does not announce an
 * install for every extension a person already has.
 */
function installRecord({file, registryFile, profileId, browser}) {
  let state = null;
  try { const parsed = JSON.parse(fs.readFileSync(file, 'utf8')); if (parsed && typeof parsed === 'object' && parsed.extensions && typeof parsed.extensions === 'object') state = parsed; } catch { /* first run */ }
  const first = !state;
  const changedBrowser = !first && !!browser && state.browser !== browser;
  if (first) {
    state = {browser, extensions: {}};
    try {
      const registry = JSON.parse(fs.readFileSync(registryFile, 'utf8'));
      for (const entry of Array.isArray(registry.entries) ? registry.entries : []) {
        if (!entry || entry.profileId !== profileId || !/^[a-p]{32}$/.test(String(entry.id)) || typeof entry.path !== 'string') continue;
        let version = '';
        try { version = String(JSON.parse(fs.readFileSync(path.join(entry.path, 'manifest.json'), 'utf8').replace(/^﻿/, '')).version || ''); } catch { /* unknown */ }
        state.extensions[entry.id] = {version};
      }
    } catch { /* no registry yet */ }
  }
  const save = () => { try { fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, JSON.stringify(state)); } catch { /* the record is a courtesy */ } };
  if (first || changedBrowser) { state.browser = browser; save(); }
  return {state, changedBrowser, save};
}

module.exports = {
  namespaces: ['runtime'],
  internals,
  uninstallStore,
  installRecord,
  install(api) {
    const file = path.join(api.userData || '.', 'extension-uninstall-urls', `${String(api.storeKey || 'default').replace(/[^\w.-]/g, '_')}.json`);
    const urls = uninstallStore(file);

    // The renderer validated the URL with Chromium's own setUninstallURL first; this only keeps it (an empty string clears it).
    api.handle('runtime.setUninstallURL', (event, url) => {
      const text = typeof url === 'string' ? url : '';
      if (text && !webURL(text)) throw new Error(`Invalid URL: "${text}".`);
      urls.set(event.extension.id, text ? webURL(text) : '');
    });

    api.handle('runtime.openOptionsPage', async event => {
      const extension = event.extension, manifest = extension.manifest || {};
      const page = (manifest.options_ui && manifest.options_ui.page) || manifest.options_page;
      if (typeof page !== 'string' || !page) throw new Error(NO_OPTIONS);
      let url;
      try { url = new URL(page.replace(/^\/+/, ''), `chrome-extension://${extension.id}/`).href; } catch { throw new Error(NO_OPTIONS); }
      if (!url.startsWith(`chrome-extension://${extension.id}/`)) throw new Error(NO_OPTIONS);
      const store = api.store();
      if (!store || typeof store.createTab !== 'function') throw new Error(NO_OPTIONS);
      // The engine's store wraps the host's tab functions: createTab is on it, selectTab is the host's (store.impl.selectTab).
      const select = store.impl && typeof store.impl.selectTab === 'function' ? store.impl.selectTab.bind(store.impl) : typeof store.selectTab === 'function' ? store.selectTab.bind(store) : null;
      for (const open of select ? internals.webContents(api.session, extension.id) : []) {
        let same = false;
        try { same = sameDocument(open.getURL(), url); } catch { same = false; }
        if (same) { try { select(open); return; } catch { /* not a tab of this profile: look on, then open one */ } }
      }
      await store.createTab({url, active: true});
    });

    // sender.tab. Electron builds it for messages from content scripts with the right id but windowId 0 and index 0. The renderer side
    // (runtime-renderer.cjs) keeps a table of tabs and answers a listener's sender from it synchronously; the tabs are the ones tabs.get gives
    // (P1's tab model, already scrubbed for what this extension may see). Snapshot on request, then only what changed, while a context listens.
    const known = new Map(); // extension id -> Map(tab id -> JSON of the tab last sent)
    const tabsFor = extension => {
      const get = api.handler('tabs.get'), store = api.store(), out = [];
      if (!get || !store) return out;
      for (const wc of store.tabs || []) {
        try {
          if (wc.isDestroyed() || wc.session !== api.session) continue;
          const tab = get({type: 'service-worker', sender: null, extension}, wc.id);
          if (tab && typeof tab === 'object' && !tab.__acira_error && typeof tab.id === 'number') out.push(tab);
        } catch { /* a page going away */ }
      }
      return out;
    };
    let timer = null, offs = [], watching = false;
    const push = () => {
      timer = null;
      for (const id of api.listening('runtime.tabs')) {
        const extension = api.getExtension(id), before = known.get(id) || new Map();
        if (!extension) continue;
        const now = new Map(), changed = [];
        for (const tab of tabsFor(extension)) {
          const text = JSON.stringify(tab);
          now.set(tab.id, text);
          if (before.get(tab.id) !== text) changed.push(tab);
        }
        const removed = [...before.keys()].filter(tabId => !now.has(tabId));
        known.set(id, now);
        if (changed.length || removed.length) api.emit(id, 'runtime.tabs', {tabs: changed, removed});
      }
    };
    const schedule = () => { if (!timer) { timer = setTimeout(push, 60); timer.unref?.(); } };
    const watch = () => {
      if (watching) return;
      watching = true;
      const store = api.store(), hook = store && store.impl && store.impl.tabModel;
      try { if (hook && typeof hook.onChange === 'function') offs.push(hook.onChange(schedule)); } catch { /* no tab model */ }
      for (const name of ['tab-added', 'tab-removed']) try { if (store && typeof store.on === 'function') { store.on(name, schedule); offs.push(() => (store.off || store.removeListener).call(store, name, schedule)); } } catch { /* no events */ }
    };
    api.handle('runtime.tabs', event => {
      watch();
      const list = tabsFor(event.extension);
      known.set(event.extension.id, new Map(list.map(tab => [tab.id, JSON.stringify(tab)])));
      return list;
    });

    // runtime.onInstalled: reason 'install' the first time this profile loads an extension, 'update' (previousVersion) when its version changed or it
    // was reloaded, 'chrome_update' once per extension on the first run of a new Acira version. Sent when the extension has a listener registered
    // after the load (its worker's first run of the script, however late the worker starts); until then the details wait for the registration.
    const record = installRecord({
      file: path.join(api.userData || '.', 'extension-install-state', `${String(api.storeKey || 'default').replace(/[^\w.-]/g, '_')}.json`),
      registryFile: path.join(api.userData || '.', 'extensions.json'), profileId: api.storeKey, browser: internals.browserVersion()
    });
    // runtime.onStartup: once per extension when this profile starts (its first load in this run, of an extension the profile already had, within
    // two minutes of the profile's runtime being made); not on install, not on a reload, not on enabling later, never on a worker restart.
    // Electron dispatches neither this nor onInstalled; both wait the same way for the listener the worker registers in its first run.
    const startedAt = Date.now(), unloadedAt = new Map(), everUnloaded = new Set(), seenThisRun = new Set(), registeredAt = new Map(), waiting = new Map();
    const ANNOUNCED = new Set(['runtime.onInstalled', 'runtime.onStartup']);
    const slot = (id, name) => `${name}|${id}`;
    const flush = (id, name) => {
      const timeout = setTimeout(() => {   // the listener's own side has to be ready for the event too
        const held = waiting.get(slot(id, name));
        if (!held) return;
        waiting.delete(slot(id, name));
        if (Date.now() - held.at < 120000) api.emit(id, name, ...held.args);
      }, 40);
      timeout.unref?.();
    };
    /** Send now when a listener registered after `since`, else hold the event for the next registration. */
    const announce = (id, name, args, since) => {
      if (registeredAt.has(slot(id, name)) && registeredAt.get(slot(id, name)) > since) api.emit(id, name, ...args);
      else waiting.set(slot(id, name), {args, at: Date.now()});
    };
    const router = api.runtime && api.runtime.ctx && api.runtime.ctx.router;
    let watchedRouter = null;
    if (router && typeof router.addListener === 'function') {
      const original = router.addListener;
      const wrapped = function (listener, extensionId, eventName) {
        const result = original.call(this, listener, extensionId, eventName);
        if (ANNOUNCED.has(eventName)) { registeredAt.set(slot(extensionId, eventName), Date.now()); if (waiting.has(slot(extensionId, eventName))) flush(extensionId, eventName); }
        return result;
      };
      router.addListener = wrapped;
      watchedRouter = () => { if (router.addListener === wrapped) router.addListener = original; };
    }
    const emitter = api.session && (api.session.extensions || api.session);
    const onLoaded = (_event, extension) => {
      const id = extension && extension.id;
      if (!id) return;
      const version = String(extension.manifest && extension.manifest.version || '');
      const before = record.state.extensions[id], since = unloadedAt.get(id) || 0;
      unloadedAt.delete(id);
      const first = !seenThisRun.has(id);
      let details = null;
      if (!before) details = {reason: 'install'};
      else if (before.version && before.version !== version) details = {reason: 'update', previousVersion: before.version};
      else if (since && Date.now() - since < 30000) details = {reason: 'update', previousVersion: before.version || version};   // a reload
      else if (record.changedBrowser && first) details = {reason: 'chrome_update'};
      const startup = !!before && first && !everUnloaded.has(id) && Date.now() - startedAt < 120000;
      seenThisRun.add(id);
      record.state.extensions[id] = {version};
      record.save();
      if (details) announce(id, 'runtime.onInstalled', [details], since);
      if (startup) announce(id, 'runtime.onStartup', [], 0);
    };
    const onUnloaded = (_event, extension) => { if (extension && extension.id) { unloadedAt.set(extension.id, Date.now()); everUnloaded.add(extension.id); } };
    try { if (emitter && typeof emitter.on === 'function') { emitter.on('extension-loaded', onLoaded); emitter.on('extension-unloaded', onUnloaded); } } catch { /* no events */ }

    return {
      dispose() {
        if (timer) clearTimeout(timer);
        for (const off of offs) { try { off(); } catch { /* gone */ } }
        offs = []; watching = false;
        try { if (emitter && typeof emitter.removeListener === 'function') { emitter.removeListener('extension-loaded', onLoaded); emitter.removeListener('extension-unloaded', onUnloaded); } } catch { /* gone */ }
        if (watchedRouter) watchedRouter();
      },
      /** The user removed the extension: Chrome opens its uninstall page in a new tab. */
      forget(extensionId) {
        known.delete(extensionId);
        for (const name of ANNOUNCED) waiting.delete(slot(extensionId, name));
        if (record.state.extensions[extensionId]) { delete record.state.extensions[extensionId]; record.save(); }
        const url = urls.take(extensionId);
        const store = api.store();
        if (!url || !store || typeof store.createTab !== 'function') return;
        Promise.resolve(store.createTab({url, active: true})).catch(error => api.log('uninstall page was not opened:', error && error.message));
      }
    };
  }
};
