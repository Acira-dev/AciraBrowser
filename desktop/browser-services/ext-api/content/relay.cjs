'use strict';
// The relay behind the content world of an activeTab extension (ext-api/content/world.cjs).
//
// A script an extension injects with chrome.scripting.executeScript after a click on its toolbar button runs in an isolated world Acira makes (Chromium
// refuses its own call without host permissions, and its injected world has no chrome.* for such an extension). That world has no chrome object at all, so
// a script that reads chrome.runtime.id or asks its service worker for a screenshot died on its first line (GitHub #5, Colorway). The script's chrome.runtime
// and chrome.storage calls therefore travel here: a hidden page of the extension itself (acira-relay.html, a few lines in the extension's own folder, loaded
// as chrome-extension://<id>/acira-relay.html) makes the real call, from a real extension context with the extension's own permissions, and hands the answer
// back. chrome.runtime.sendMessage from that page reaches the extension's service worker like any other extension page's message does.
//
// Only packages Acira unpacked itself (Chrome Web Store installs and updates, in <user data>/extension-packages) get the two files, as extension-shims.cjs does;
// a folder the person loaded is never written to, and its scripts stay as they were. One hidden page per extension and profile, closed after IDLE_MS without a call,
// when the extension is turned off, removed or reloaded, and at quit.
const fs = require('node:fs'), path = require('node:path');

const PAGE = 'acira-relay.html', SCRIPT = 'acira-relay.js';
const IDLE_MS = 45000, CALL_MS = 30000, LOAD_MS = 15000;

const PAGE_SOURCE = '<!doctype html><meta charset="utf-8"><title>Acira relay</title><script src="' + SCRIPT + '"></script>\n';
// What the page does: the two calls, each answered with {value} or {error}. Runs as an extension page: chrome is its own.
const SCRIPT_SOURCE = `// Added by Acira: the page that answers a click-injected script's chrome.runtime / chrome.storage calls for its extension (ext-api/content/relay.cjs).
(function () {
  function answer(resolve) {
    return function (value) {
      var error = chrome.runtime.lastError;
      resolve(error ? {error: String(error.message || error)} : {value: value === undefined ? null : value});
    };
  }
  window.__acira_relay = function (operation, payload) {
    return new Promise(function (resolve) {
      try {
        if (operation === 'message') chrome.runtime.sendMessage.apply(chrome.runtime, payload.args.concat([answer(resolve)]));
        else if (operation === 'storage') { var area = chrome.storage[payload.area]; area[payload.method].apply(area, payload.args.concat([answer(resolve)])); }
        else resolve({error: 'Unknown operation.'});
      } catch (error) { resolve({error: String((error && error.message) || error)}); }
    });
  };
})();
`;

/** A private window's extensions run from <userData>/Partitions/<partition>/acira-runtime, but their folders are the profile's own (<userData>/extension-packages). */
function profileUserData(userData) {
  const at = userData.search(/[\\/]Partitions[\\/]/);
  return at > 0 ? userData.slice(0, at) : userData;
}

/** Is this folder one Acira unpacked (under <userData>/extension-packages)? */
function isAciraPackage(folder, userData) {
  if (typeof folder !== 'string' || !folder || typeof userData !== 'string' || !userData) return false;
  const root = path.resolve(profileUserData(userData), 'extension-packages') + path.sep, full = path.resolve(folder);
  return full.startsWith(root) && full.length > root.length;
}

/** Puts the two files into an Acira-unpacked package (idempotent); false for a folder Acira did not unpack or when it cannot write. */
function ensureFiles(folder, userData) {
  if (!isAciraPackage(folder, userData)) return false;
  try {
    for (const [name, text] of [[PAGE, PAGE_SOURCE], [SCRIPT, SCRIPT_SOURCE]]) {
      const file = path.join(folder, name);
      let current = null;
      try { current = fs.readFileSync(file, 'utf8'); } catch { /* not there yet */ }
      if (current !== text) fs.writeFileSync(file, text);
    }
    return true;
  } catch { return false; }
}

/**
 * deps: electron ({WebContentsView}), setTimer / clearTimer (tests). relayFor(session, extension) -> {call(operation, payload) -> {value} | {error}}.
 * The hidden page is made on the first call and loaded from the extension's own origin.
 */
function createRelays({electron, userData, setTimer = setTimeout, clearTimer = clearTimeout} = {}) {
  const live = new Map();   // session -> Map(extension id -> {view, ready, timer})
  function close(entry) {
    clearTimer(entry.timer);
    try { if (entry.view && entry.view.webContents && !entry.view.webContents.isDestroyed()) entry.view.webContents.close(); } catch { /* gone */ }
  }
  function forget(session, id) {
    const map = live.get(session), entry = map && map.get(id);
    if (!entry) return;
    map.delete(id); close(entry);
  }
  function open(session, extension) {
    const {WebContentsView} = electron || require('electron');
    const view = new WebContentsView({webPreferences: {session, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, backgroundThrottling: false}});
    const contents = view.webContents, id = extension.id, entry = {view, ready: null, timer: null};
    try { contents.setAudioMuted(true); } catch { /* optional */ }
    contents.setWindowOpenHandler(() => ({action: 'deny'}));
    contents.on('will-navigate', event => { if (event && typeof event.preventDefault === 'function') event.preventDefault(); });
    contents.on('destroyed', () => { const map = live.get(session); if (map && map.get(id) === entry) map.delete(id); });
    const limit = (promise, ms, what) => new Promise((resolve, reject) => {
      const timer = setTimer(() => reject(new Error(what)), ms);
      promise.then(value => { clearTimer(timer); resolve(value); }, error => { clearTimer(timer); reject(error); });
    });
    entry.ready = limit(contents.loadURL('chrome-extension://' + id + '/' + PAGE), LOAD_MS, 'The extension\'s relay page did not load.');
    entry.limit = limit;
    return entry;
  }
  function entryFor(session, extension) {
    let map = live.get(session);
    if (!map) { map = new Map(); live.set(session, map); }
    let entry = map.get(extension.id);
    if (entry && entry.view.webContents.isDestroyed()) { map.delete(extension.id); entry = null; }
    if (!entry) { entry = open(session, extension); map.set(extension.id, entry); }
    return entry;
  }
  return {
    relayFor(session, extension) {
      return {
        async call(operation, payload) {
          let entry;
          try {
            entry = entryFor(session, extension);
            await entry.ready;
          } catch (error) { forget(session, extension.id); return {error: String((error && error.message) || error)}; }
          clearTimer(entry.timer);
          entry.timer = setTimer(() => forget(session, extension.id), IDLE_MS);
          if (entry.timer && typeof entry.timer.unref === 'function') entry.timer.unref();
          try {
            const code = 'window.__acira_relay(' + JSON.stringify(operation) + ',' + JSON.stringify(payload) + ')';
            const answer = await entry.limit(entry.view.webContents.executeJavaScript(code), CALL_MS, 'The extension did not answer.');
            return answer && typeof answer === 'object' ? answer : {value: null};
          } catch (error) { return {error: String((error && error.message) || error)}; }
        }
      };
    },
    /** The extension was turned off, removed or reloaded: its relay page goes. */
    forget,
    closeAll() { for (const [session, map] of [...live]) for (const id of [...map.keys()]) forget(session, id); },
    count: () => [...live.values()].reduce((sum, map) => sum + map.size, 0)
  };
}

module.exports = {PAGE, SCRIPT, PAGE_SOURCE, SCRIPT_SOURCE, IDLE_MS, CALL_MS, isAciraPackage, ensureFiles, createRelays};
