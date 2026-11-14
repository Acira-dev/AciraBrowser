'use strict';
// Persistent dynamic content scripts: chrome.scripting.registerContentScripts with persistAcrossSessions, which is true unless the extension says
// otherwise (Chromium, extensions/browser/api/scripting/scripting_api.cc: `script.persist_across_sessions.value_or(true)`).
//
// Chromium keeps every persistent script in a state store, under the key "dynamic_scripts" (extensions/browser/scripting_constants.h) of the
// "Extension Scripts" store (extensions/browser/state_store.cc, BackendType::SCRIPTS). ExtensionUserScriptLoader writes it after every register,
// update and unregister (extension_user_script_loader.cc, DynamicScriptsStorageHelper::SetDynamicScripts: ALL persistent scripts, in one value) and
// reads it back when the extension loads (AddScriptsForExtensionLoad -> GetDynamicScripts), adding the saved scripts together with the manifest ones
// before any page may need them (chrome/browser/extensions/user_script_listener.cc delays navigations that match until then). StateStore removes an
// extension's keys when it is installed or UPDATED and when it is uninstalled (StateStore::OnExtensionWillBeInstalled / OnExtensionUninstalled).
//
// This Electron (44.9.3) has no such store: `state_store_` is null there, so SetDynamicScripts returns at once, GetDynamicScripts answers an empty
// list, and a script an extension registered for good was gone after the next start (getRegisteredContentScripts() answered [], and DeArrow,
// SponsorBlock and every extension that registers once at install never ran again on a page open at launch). Measured: 5 of 5 restarts.
//
// Here the same store is a file per extension, <profile folder>/Extension Scripts/<id>.json, written by the main process from what the
// extension's own context reports after each call (scripting-renderer.cjs), and read back through the same calls Chromium's loader makes: when the
// extension loads, its service worker is started, its preload registers the saved scripts natively (the same chrome.scripting call), and the
// page load waits for it when the page's address matches a saved script (holdFor below: Chromium's UserScriptListener::ShouldDelayRequest, which delays only
// the requests that match; a page that matches nothing starts at once).
const fs = require('node:fs');
const path = require('node:path');
const {originsCoverUrl} = require('../../extension-permission-table.cjs');

const FOLDER = 'Extension Scripts';
const KEY = 'dynamic_scripts';
const ID = /^[a-p]{32}$/;
const MAX_SCRIPTS = 1000;
const MAX_BYTES = 2 * 1024 * 1024;
const WAIT_MS = 3000;
/** The members of scripting.RegisteredContentScript (extensions/common/api/scripting.idl); anything else is dropped. */
const STRING_LISTS = ['matches', 'excludeMatches', 'js', 'css'];
const BOOLEANS = ['allFrames', 'matchOriginAsFallback'];

const text = (value, limit = 4096) => typeof value === 'string' && value.length > 0 && value.length <= limit;
/** One saved script, cleaned: a plain object of the API's own members, or null. A script is only saved while it persists (persistAcrossSessions is true). */
function clean(script) {
  if (!script || typeof script !== 'object' || Array.isArray(script) || !text(script.id, 256)) return null;
  const out = {id: script.id};
  for (const name of STRING_LISTS) {
    if (script[name] === undefined) continue;
    if (!Array.isArray(script[name]) || script[name].length > 1000 || !script[name].every(item => text(item))) return null;
    out[name] = script[name].slice();
  }
  for (const name of BOOLEANS) if (typeof script[name] === 'boolean') out[name] = script[name];
  if (script.runAt !== undefined) { if (!['document_start', 'document_end', 'document_idle'].includes(script.runAt)) return null; out.runAt = script.runAt; }
  if (script.world !== undefined) { if (!['ISOLATED', 'MAIN'].includes(script.world)) return null; out.world = script.world; }
  if (!Array.isArray(out.matches) || !out.matches.length) return null;
  out.persistAcrossSessions = true;
  return out;
}
function cleanList(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set(), out = [];
  for (const script of list.slice(0, MAX_SCRIPTS)) {
    const item = clean(script);
    if (item && !seen.has(item.id)) { seen.add(item.id); out.push(item); }
  }
  return out;
}

/** The store of one profile's session: a file per extension, kept in memory after the first read (a worker asks at every start). */
function createStore({session, fileSystem = fs, writeFile} = {}) {
  const write = writeFile || ((file, data) => require('../../../atomic-file.cjs').writeFileAtomic(file, data));
  const cache = new Map();
  const root = () => { const base = session && session.storagePath; return typeof base === 'string' && base ? path.join(base, FOLDER) : null; };
  const fileOf = id => { const folder = root(); return folder && ID.test(id) ? path.join(folder, id + '.json') : null; };
  function read(id) {
    if (cache.has(id)) return cache.get(id).map(script => ({...script}));
    const file = fileOf(id);
    let list = [];
    if (file) {
      try {
        const info = fileSystem.statSync(file);
        if (info.size <= MAX_BYTES) list = cleanList(JSON.parse(fileSystem.readFileSync(file, 'utf8').replace(/^﻿/, ''))[KEY]);
      } catch { list = []; }
    }
    cache.set(id, list);
    return list.map(script => ({...script}));
  }
  function save(id, scripts) {
    const list = cleanList(scripts);
    if (Buffer.byteLength(JSON.stringify(list)) > MAX_BYTES) throw new Error('The registered content scripts are too large to keep.');
    cache.set(id, list);
    const file = fileOf(id);
    if (!file) return list.length;   // a private session has no folder: its scripts live as long as the session
    if (!list.length) { try { fileSystem.rmSync(file, {force: true}); } catch { /* nothing left to remove */ } return 0; }
    fileSystem.mkdirSync(path.dirname(file), {recursive: true});
    write(file, JSON.stringify({version: 1, [KEY]: list}));
    return list.length;
  }
  function clear(id) {
    cache.delete(id);
    const file = fileOf(id);
    if (file) try { fileSystem.rmSync(file, {force: true}); } catch { /* it stays until the next clear */ }
  }
  return {read, save, clear, fileOf};
}

const controllers = new WeakMap();

/** Installs the store and the restore on one profile's session; called from ext-api/scripting.cjs. Returns {forget(id), dispose()}. */
function install(api, {startWorker, waitMs = WAIT_MS, fileSystem, writeFile} = {}) {
  const session = api.session;
  const store = createStore({session, fileSystem, writeFile});
  const waits = new Map();     // extension id -> {promise, finish}
  const restored = new Set();  // ids whose worker has put the saved scripts in since the extension loaded
  const start = startWorker || (scope => session.serviceWorkers.startWorkerForScope(scope));

  function finish(id) {
    restored.add(id);
    const entry = waits.get(id);
    if (entry) entry.finish();
  }
  /** Starts the extension's worker so its preload registers the saved scripts; resolves when it says so, or after waitMs (a worker that cannot start must not hold the browser). */
  function begin(extension) {
    const id = extension && extension.id;
    if (!id || !ID.test(id)) return Promise.resolve();
    if (restored.has(id)) return Promise.resolve();
    if (waits.has(id)) return waits.get(id).promise;
    const worker = extension.manifest && extension.manifest.background && extension.manifest.background.service_worker;
    if (!worker || !store.read(id).length || !api.available(id, 'scripting', {isWorker: true})) return Promise.resolve();
    let done;
    const promise = new Promise(resolve => { done = resolve; });
    // the URL patterns of the saved scripts (UserScriptListener::CollectURLPatterns): only a page that matches one of them waits
    const patterns = [...new Set(store.read(id).flatMap(script => script.matches))];
    const entry = {promise, patterns, finish: () => { clearTimeout(entry.timer); waits.delete(id); done(); }};
    entry.timer = setTimeout(entry.finish, waitMs);
    entry.timer.unref?.();
    waits.set(id, entry);
    const scope = `chrome-extension://${id}/`;
    (async () => {
      // right after a load the engine may not accept the worker yet: a few tries inside the wait
      for (let attempt = 0; attempt < 4 && waits.get(id) === entry; attempt++) {
        try { await start(scope); return; } catch { await new Promise(resolve => setTimeout(resolve, 120 * (attempt + 1)).unref?.()); }
      }
    })();
    return promise;
  }
  function abandon(id) {
    restored.delete(id);
    const entry = waits.get(id);
    if (entry) entry.finish();
    restored.delete(id);
  }

  api.handle('scripting.persist.get', event => store.read(event.extension.id));
  api.handle('scripting.persist.set', (event, list) => { store.save(event.extension.id, list); });
  api.handle('scripting.persist.restored', event => { finish(event.extension.id); });

  const onLoaded = (_event, extension) => { void begin(extension); };
  const onUnloaded = (_event, extension) => { if (extension && extension.id) abandon(extension.id); };
  try { session?.extensions?.on?.('extension-loaded', onLoaded); session?.extensions?.on?.('extension-unloaded', onUnloaded); } catch { /* an engine without extension events: the manager asks for the wait itself */ }

  /** Chromium's UserScriptListener::ShouldDelayRequest: resolves once every extension whose saved scripts match this address has put them in (at once when none waits). */
  function holdFor(url) {
    const pending = [];
    try { for (const entry of waits.values()) if (originsCoverUrl(entry.patterns, url)) pending.push(entry.promise); } catch { return Promise.resolve(); }
    return pending.length ? Promise.all(pending).then(() => undefined) : Promise.resolve();
  }
  const controller = {store, begin, whenRestored: begin, finish, holdFor};
  controllers.set(session, controller);
  return {
    /** The extension was removed: Chromium's StateStore drops its keys (OnExtensionUninstalled). */
    forget(id) { store.clear(id); abandon(id); },
    dispose() {
      try { session?.extensions?.removeListener?.('extension-loaded', onLoaded); session?.extensions?.removeListener?.('extension-unloaded', onUnloaded); } catch { /* gone with the session */ }
      for (const id of [...waits.keys()]) abandon(id);
      if (controllers.get(session) === controller) controllers.delete(session);
    }
  };
}

/** For the extension manager: resolves once the saved scripts of this extension are registered in the engine (immediately when it has none, no worker, or no scripting permission). */
function whenRestored(session, extension) {
  const controller = session && controllers.get(session);
  return controller ? controller.begin(extension) : Promise.resolve();
}
/** For a page load (main.cjs loadPage): resolves when no extension still has saved scripts to put in for this address. Never rejects. */
function holdFor(session, url) {
  const controller = session && controllers.get(session);
  return controller ? controller.holdFor(url) : Promise.resolve();
}
/** The extension was updated: Chromium's StateStore drops its keys at the install of a new version (OnExtensionWillBeInstalled), the new version registers again. */
function clear(session, id) {
  const controller = session && controllers.get(session);
  if (controller) controller.store.clear(id);
}

module.exports = {install, createStore, whenRestored, holdFor, clear, clean, cleanList, FOLDER, KEY, WAIT_MS};
