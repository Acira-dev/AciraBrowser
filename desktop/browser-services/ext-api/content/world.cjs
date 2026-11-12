'use strict';
// The chrome.* a script injected after a click can use (GitHub #5: Colorway's eyedropper did nothing in Acira).
//
// chrome.scripting.executeScript on a tab the person just used an activeTab extension on runs in an isolated world made here (surfaces/active-tab.cjs, ext-api/scripting.cjs):
// Chromium's own call refuses an extension with no host permissions, and Acira cannot give it Chromium's activeTab. That world has no `chrome` object, so a script that starts with
// chrome.runtime.id, chrome.runtime.getURL, chrome.storage or chrome.runtime.sendMessage (Colorway's inject.js: all four) threw on its first line and nothing appeared.
//
// This file gives that world the part of chrome.* a content script uses, and answers it:
//   in the page   a small shim (contentShim) defines chrome.runtime (id, getURL, getManifest, sendMessage, lastError), chrome.storage (local, sync, session: get, set, remove, clear),
//                 chrome.i18n (getMessage, getUILanguage) and chrome.extension.getURL. A call becomes a console.debug line that carries a secret only this world and this process know
//                 (a page's own scripts cannot read the isolated world, nor hear its console).
//   here          the line is heard on the tab's console-message, the call is checked (the tab's grant is still live, the operation is one of the few allowed, the sizes) and made by the
//                 extension's relay page (content/relay.cjs: a real page of the extension, with its permissions); the answer is handed back into the isolated world.
// Not here: chrome.runtime.connect and the events (onMessage and the rest are inert: a message sent to the tab with chrome.tabs.sendMessage does not reach this world), and the
// messages' sender has no tab. Only packages Acira unpacked get it (the relay page is a file in the package); a folder the person loaded keeps the world as it was.
const crypto = require('node:crypto'), fs = require('node:fs'), path = require('node:path');
const relay = require('./relay.cjs');

const PREFIX = '\u0001acira-cw:';
const MAX_REQUEST = 4 * 1024 * 1024, MAX_REPLY = 16 * 1024 * 1024, MAX_MANIFEST = 100 * 1024, MAX_MESSAGES = 256 * 1024;
const AREAS = new Set(['local', 'sync', 'session']), METHODS = new Set(['get', 'set', 'remove', 'clear']);

/** Runs in the isolated world (embedded as text): chrome.* over the console channel. Everything it needs comes in as arguments. */
function contentShim(id, manifest, messages, token, flags) {
  var root = self;
  if (root.__acira_cw === token) return;
  root.__acira_cw = token;
  var pending = Object.create(null), seq = 0, lastError;
  function send(operation, payload) {
    return new Promise(function (resolve, reject) {
      var n = ++seq;
      pending[n] = {resolve: resolve, reject: reject};
      console.debug('\u0001acira-cw:' + token + ':' + JSON.stringify({n: n, o: operation, p: payload}));
    });
  }
  root.__acira_cw_reply = function (n, answer) {
    var item = pending[n];
    if (!item) return;
    delete pending[n];
    if (answer && answer.error) item.reject(new Error(answer.error)); else item.resolve(answer ? answer.value : undefined);
  };
  function answer(promise, callback) {
    if (typeof callback !== 'function') return promise;
    promise.then(function (value) { callback(value); }, function (error) {
      lastError = {message: String((error && error.message) || error)};
      try { callback(); } finally { lastError = undefined; }
    });
    return undefined;
  }
  function split(list) {
    var args = Array.prototype.slice.call(list), callback = typeof args[args.length - 1] === 'function' ? args.pop() : undefined;
    return {args: args, callback: callback};
  }
  function inert() { return {addListener: function () {}, removeListener: function () {}, hasListener: function () { return false; }, hasListeners: function () { return false; }}; }
  function area(name) {
    function call(method) { return function () { var parts = split(arguments); return answer(send('s', {area: name, method: method, args: parts.args}), parts.callback); }; }
    return {get: call('get'), set: call('set'), remove: call('remove'), clear: call('clear'), onChanged: inert()};
  }
  var runtime = {
    id: id,
    getURL: function (file) { return 'chrome-extension://' + id + '/' + String(file === undefined ? '' : file).replace(/^\/+/, ''); },
    getManifest: function () { return JSON.parse(JSON.stringify(manifest)); },
    sendMessage: function () {
      var parts = split(arguments), args = parts.args, message = args.length >= 2 && typeof args[0] === 'string' ? args[1] : args[0];
      if (args.length >= 2 && typeof args[0] === 'string' && args[0] !== id) return answer(Promise.reject(new Error('Could not establish connection. Receiving end does not exist.')), parts.callback);
      return answer(send('m', {args: [message]}), parts.callback);
    },
    connect: function () { throw new Error('chrome.runtime.connect is not available to a script injected after a click in Acira.'); },
    onMessage: inert(), onConnect: inert(), onInstalled: inert(), onStartup: inert()
  };
  Object.defineProperty(runtime, 'lastError', {get: function () { return lastError; }, enumerable: true});
  var i18n = {
    getMessage: function (name, substitutions) {
      var entry = messages && messages[name];
      if (!entry || typeof entry.message !== 'string') return '';
      var list = substitutions === undefined ? [] : [].concat(substitutions);
      return entry.message.replace(/\$([1-9])/g, function (whole, number) { var value = list[Number(number) - 1]; return value === undefined ? '' : String(value); });
    },
    getUILanguage: function () { return (typeof navigator !== 'undefined' && navigator.language) || 'en'; }
  };
  var made = {runtime: runtime, i18n: i18n, extension: {getURL: runtime.getURL}};
  if (flags && flags.storage) made.storage = {local: area('local'), sync: area('sync'), session: area('session'), onChanged: inert()};
  var target = root.chrome || (root.chrome = {});
  for (var key in made) if (!target[key]) target[key] = made[key];
}

/** The manifest a content script may read: all of it unless it is large. */
function manifestFor(extension) {
  const manifest = extension.manifest || {};
  try {
    const text = JSON.stringify(manifest);
    if (text.length <= MAX_MANIFEST) return JSON.parse(text);
  } catch { /* fall through */ }
  return {name: manifest.name, version: manifest.version, manifest_version: manifest.manifest_version};
}

/** _locales/<default_locale>/messages.json (or en) of the package; {} when there is none. */
function messagesFor(extension) {
  const manifest = extension.manifest || {};
  if (!extension.path || typeof manifest.default_locale !== 'string' || !/^[A-Za-z0-9_-]+$/.test(manifest.default_locale)) return {};
  for (const locale of [manifest.default_locale, 'en']) {
    try {
      const file = path.join(extension.path, '_locales', locale, 'messages.json');
      const text = fs.readFileSync(file, 'utf8');
      if (text.length > MAX_MESSAGES) return {};
      const parsed = JSON.parse(text.replace(/^﻿/, ''));
      if (parsed && typeof parsed === 'object') return parsed;
    } catch { /* the next one */ }
  }
  return {};
}

/**
 * deps: session (the profile's), userData, relays (content-relay createRelays), activeTab (surfaces/active-tab.cjs), hasPermission(extension, name).
 * prepare(extension, wc, world) -> the text to run in the isolated world before the extension's code, or null when this extension or page cannot have it.
 */
function createContentWorld({session, userData, relays, activeTab, hasPermission = () => false}) {
  const states = new WeakMap();   // wc -> Map(token -> state)
  const listening = new WeakSet();

  function answerInto(state, n, answer) {
    const {wc} = state;
    if (!wc || (typeof wc.isDestroyed === 'function' && wc.isDestroyed())) return Promise.resolve();
    let text;
    try { text = JSON.stringify(answer); } catch { text = JSON.stringify({error: 'The answer cannot be sent.'}); }
    if (typeof text !== 'string' || text.length > MAX_REPLY) text = JSON.stringify({error: 'The answer is too large.'});
    const code = 'globalThis.__acira_cw_reply&&globalThis.__acira_cw_reply(' + n + ',' + text + ')';
    return Promise.resolve(wc.executeJavaScriptInIsolatedWorld(state.world, [{code}])).catch(() => undefined);
  }

  async function serve(state, request) {
    const {extension, wc} = state;
    let granted = false;
    try { granted = !!activeTab.has(session, extension.id, wc.id, wc.getURL()); } catch { granted = false; }
    if (!granted) return {error: 'The extension no longer has access to this page.'};
    const relayPage = relays.relayFor(session, extension);
    if (request.o === 'm') {
      const args = request.p && Array.isArray(request.p.args) ? request.p.args : null;
      if (!args || args.length !== 1) return {error: 'Invalid message.'};
      return relayPage.call('message', {args});
    }
    if (request.o === 's') {
      const p = request.p;
      if (!p || !AREAS.has(p.area) || !METHODS.has(p.method) || !Array.isArray(p.args) || p.args.length > 2) return {error: 'Invalid storage request.'};
      if (!hasPermission(extension, 'storage')) return {error: 'The extension has no storage permission.'};
      return relayPage.call('storage', {area: p.area, method: p.method, args: p.args});
    }
    return {error: 'Unknown operation.'};
  }

  function heard(wc) {
    return (...args) => {
      const event = args[0], text = event && typeof event === 'object' && 'message' in event ? event.message : args[2];
      if (typeof text !== 'string' || !text.startsWith(PREFIX)) return;
      const rest = text.slice(PREFIX.length), cut = rest.indexOf(':');
      if (cut < 1) return;
      const map = states.get(wc), state = map && map.get(rest.slice(0, cut));
      if (!state) return;
      if (event && typeof event === 'object' && event.frame && wc.mainFrame && event.frame !== wc.mainFrame) return;
      const json = rest.slice(cut + 1);
      if (json.length > MAX_REQUEST) return;
      let request;
      try { request = JSON.parse(json); } catch { return; }
      if (!request || typeof request !== 'object' || !Number.isInteger(request.n)) return;
      serve(state, request).then(answer => answerInto(state, request.n, answer), error => answerInto(state, request.n, {error: String((error && error.message) || error)}));
    };
  }

  return {
    prepare(extension, wc, world) {
      if (!extension || !wc || !relay.ensureFiles(extension.path, userData)) return null;
      let map = states.get(wc);
      if (!map) { map = new Map(); states.set(wc, map); }
      let state = [...map.values()].find(item => item.extension.id === extension.id && item.world === world);
      if (!state) {
        state = {token: crypto.randomBytes(18).toString('hex'), extension, wc, world};
        map.set(state.token, state);
      }
      if (!listening.has(wc)) { listening.add(wc); wc.on('console-message', heard(wc)); }
      const flags = {storage: !!hasPermission(extension, 'storage')};
      return '(' + contentShim.toString() + ')(' + [JSON.stringify(extension.id), JSON.stringify(manifestFor(extension)), JSON.stringify(messagesFor(extension)), JSON.stringify(state.token), JSON.stringify(flags)].join(',') + ')';
    }
  };
}

module.exports = {createContentWorld, contentShim, PREFIX, MAX_REQUEST};
