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
// Messages TO the world (Inspecta: its worker opens the panel with chrome.tabs.sendMessage(tab, TOGGLE_APP) and the injected bundle answers from chrome.runtime.onMessage): this world is
//   one more receiving context of the extension in the tab. Chromium's own tabs.sendMessage reaches the contexts it knows (declared content scripts, in every frame); this world is one only
//   Acira knows, so the extension's tabs.sendMessage (ext-api/tabs-renderer.cjs, only for an extension that holds activeTab) also asks the main process to deliver here (deliver() below ->
//   __acira_cw_deliver in the world) and joins the two outcomes the way Chromium joins the receivers of one channel. The receiving half is a port of Chromium's
//   extensions/renderer/api/messaging/ (native_renderer_messaging_service.cc DispatchOnConnectToScriptContext, one_time_message_handler.cc, messaging_util.cc) and of
//   extensions/renderer/bindings/event_emitter.cc (how the listeners of one event run); the frame targeting and the closing of the channel are those of
//   extensions/browser/api/messaging/ (message_service.cc OpenChannelToTabImpl / CreateReceiverForTab, extension_message_port.cc). Chromium is BSD-3-Clause licensed.
// Not here: chrome.runtime.connect and onConnect / onInstalled / onStartup / storage.onChanged (inert), and the messages' sender has no tab. Only packages Acira unpacked get it (the relay page is a file in the package); a folder the person loaded keeps the world as it was.
const crypto = require('node:crypto'), fs = require('node:fs'), path = require('node:path');
const relay = require('./relay.cjs');

const PREFIX = '\u0001acira-cw:';
const MAX_REQUEST = 4 * 1024 * 1024, MAX_REPLY = 16 * 1024 * 1024, MAX_MANIFEST = 100 * 1024, MAX_MESSAGES = 256 * 1024;
// mojom::kMaxMessageBytes: a one-time message (and its reply) may be up to 64 MiB (messaging_util.cc MessageFromV8).
const MAX_MESSAGE_BYTES = 64 * 1024 * 1024;
// extension_message_port.cc: the text the sender gets when the channel closes while a listener has said it will answer later (returned true / a promise).
const CLOSED_WHILE_PENDING = 'A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received';
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
  var messageListeners = [];
  function listened(list) {
    return {
      addListener: function (fn) { if (typeof fn === 'function' && list.indexOf(fn) < 0) list.push(fn); },
      removeListener: function (fn) { var at = list.indexOf(fn); if (at >= 0) list.splice(at, 1); },
      hasListener: function (fn) { return list.indexOf(fn) >= 0; },
      hasListeners: function () { return list.length > 0; }
    };
  }
  // OneTimeMessageHandler::GetErrorMessageFromValue: only a native Error carries a message to the sender: V8's text for an uncaught one ("Uncaught Error: boom").
  function errorText(value, fallback) {
    var text;
    try { if (Object.prototype.toString.call(value) !== '[object Error]') return fallback; text = 'Uncaught ' + String(value); } catch (error) { return fallback; }
    return text === 'Uncaught ' ? fallback : text;
  }
  // messaging_util.cc MessageFromV8 (JSON format): undefined is sent as null, a value JSON cannot make a text of is an error, and 64 MiB is the limit.
  function encode(value, limit) {
    var text;
    if (value === undefined) value = null;
    try { text = JSON.stringify(value); } catch (error) { return {error: 'Could not serialize message.'}; }
    if (typeof text !== 'string' || text === 'undefined') return {error: 'Could not serialize message.'};
    if (text.length > limit) return {error: 'Message exceeded maximum allowed size of 64MiB.'};
    return {json: text};
  }
  function isPromise(value) {
    try { return value instanceof Promise || (Object.prototype.toString.call(value) === '[object Promise]' && typeof value.then === 'function'); } catch (error) { return false; }
  }
  // One one-time message arrives (the main process runs this with the message and the sender as JSON texts). The answer is one JSON text:
  //   {created: false}                 no runtime.onMessage listener here: this context is not a receiver (DispatchOnConnectToScriptContext: "no listeners: the port won't be used")
  //   {created: true, t: 'reply', v}   the first sendResponse (v: its JSON text, undefined sent as null)
  //   {created: true, t: 'error', e}   the channel closed with an error: a listener threw, a promise it returned rejected, the reply could not be serialized
  //   {created: true, t: 'closed'}     every listener ran, none answered or will: this context's port closes, the channel stays for other receivers
  // A listener that returns true or a promise keeps it open, until sendResponse / the promise settles, or the page goes away (the main process ends it then).
  root.__acira_cw_deliver = function (json, senderJson, limit) {
    return new Promise(function (resolve) {
      var listeners = messageListeners.slice();   // EventEmitter::DispatchSync: the listeners as they stand when the event fires
      if (!listeners.length) { resolve(JSON.stringify({created: false})); return; }
      var message, sender, open = true;           // open: the receiver is still on the channel (OneTimeMessageContextData::receivers holds the port)
      try { message = JSON.parse(json); sender = JSON.parse(senderJson); } catch (error) { resolve(JSON.stringify({created: false})); return; }
      function end(result) { open = false; result.created = true; resolve(JSON.stringify(result)); }
      function fail(text) { if (open) end({t: 'error', e: text}); }
      // OnOneTimeMessageResponse: only the first answer counts (the receiver is erased); one that cannot be serialized closes the channel with that error and throws in the listener.
      function respond(value) {
        if (!open) return;
        var made = encode(value, limit);
        if (made.error) { fail(made.error); throw new TypeError(made.error); }
        end({t: 'reply', v: made.json});
      }
      var results = [];
      for (var i = 0; i < listeners.length; i++) {
        var result;
        try { result = listeners[i](message, sender, respond); }
        catch (error) {
          // OnListenerThrowsError: the first throw closes the channel with the error's text; later listeners still run (their answers are ignored).
          fail(errorText(error, "Error message from listener couldn't be parsed or was empty."));
          try { console.error('Error in event handler: ' + String(error)); } catch (ignored) {}
          continue;
        }
        if (result !== undefined) results.push(result);
      }
      if (!open) return;
      // OnEventFired / CheckAndHandleAsyncListenerReply: true or a promise from any listener means "I will answer later" (a promise settles into the answer or the error).
      var later = false;
      for (var j = 0; j < results.length; j++) {
        if (results[j] === true) later = true;
        if (isPromise(results[j])) {
          later = true;
          results[j].then(respond, function (reason) { fail(errorText(reason, "A runtime.onMessage listener's promise rejected without an Error")); });
        }
      }
      if (!later) end({t: 'closed'});
    });
  };
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
    onMessage: listened(messageListeners), onConnect: inert(), onInstalled: inert(), onStartup: inert()
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

  // ---- messages to the world
  const inflight = new WeakMap();   // wc -> Set of functions that end the deliveries still waiting for an answer
  const tracked = new WeakSet();
  const destroyed = wc => { try { return typeof wc.isDestroyed === 'function' && wc.isDestroyed(); } catch { return true; } };

  /** The documentId Acira gives a frame (ext-api/scripting.cjs executeScript results): "<process id>:<routing id>". */
  const documentIdOf = frame => (frame && frame.processId !== undefined ? `${frame.processId}:${frame.routingId}` : '');

  /**
   * message_service.cc CreateReceiverForTab: a frameId of -1 (any negative one: messaging_util.cc ParseMessageOptions) with no documentId is every frame of the tab, a frameId alone is that
   * frame (0 is the main frame), a documentId alone is that document, and when both are given they must find the same frame. This world lives in the main frame only.
   */
  function reachesMainFrame(wc, frameId, documentId) {
    const hasDocument = typeof documentId === 'string' && documentId !== '';
    const frame = Number.isInteger(frameId) ? (frameId < 0 ? -1 : frameId) : -1;
    // ExtensionApiFrameIdMap::GetRenderFrameHostById: 0 is the main frame, and so is the frame tree node id of the main frame (any frame of the tab is found by its node id).
    const isMain = id => id === 0 || (wc.mainFrame && Number.isInteger(wc.mainFrame.frameTreeNodeId) && id === wc.mainFrame.frameTreeNodeId);
    if (frame === -1 && !hasDocument) return true;
    if (hasDocument) return documentId === documentIdOf(wc.mainFrame) && (frame === -1 || isMain(frame));
    return isMain(frame);
  }

  function endDeliveries(wc) {
    const set = inflight.get(wc);
    if (!set) return;
    inflight.delete(wc);
    for (const end of [...set]) end();
  }

  /**
   * One one-time message from the extension (details: {json, url, frameId, documentId}; json is the message as Chromium serializes it) to this extension's world in `wc`.
   *   {delivered: false}                         this world is not a receiver: no world, no live grant, a frame it is not in, no onMessage listener
   *   {delivered: true, t: 'reply', v}           the first sendResponse (v: JSON text)
   *   {delivered: true, t: 'closed'}             the listeners ran and none answered (Chromium: the port closes, no error)
   *   {delivered: true, t: 'error', e}           the channel closed with an error (a listener threw, a returned promise rejected, the page went away while a listener had said it would answer)
   * Never throws. A listener that said it will answer later keeps this open until it does or the page navigates, closes or crashes (extension_message_port.cc: UnregisterFrame closes the channel).
   */
  async function deliver(extension, wc, details) {
    const none = {delivered: false};
    try {
      const map = wc && states.get(wc), state = map && [...map.values()].find(item => item.extension.id === extension.id);
      if (!state || destroyed(wc)) return none;
      let granted = false;
      try { granted = !!activeTab.has(session, extension.id, wc.id, wc.getURL()); } catch { granted = false; }
      if (!granted) return none;
      const info = details && typeof details === 'object' ? details : {};
      if (typeof info.json !== 'string' || info.json.length > MAX_MESSAGE_BYTES || !reachesMainFrame(wc, info.frameId, info.documentId)) return none;
      const origin = `chrome-extension://${extension.id}`;
      const sender = {id: extension.id, url: typeof info.url === 'string' && info.url.startsWith(origin + '/') ? info.url : origin + '/', origin};
      const code = 'globalThis.__acira_cw_deliver?globalThis.__acira_cw_deliver(' + JSON.stringify(info.json) + ',' + JSON.stringify(JSON.stringify(sender)) + ',' + MAX_MESSAGE_BYTES + '):JSON.stringify({created:false})';
      let set = inflight.get(wc);
      if (!set) { set = new Set(); inflight.set(wc, set); }
      const text = await new Promise(resolve => {
        const end = () => resolve(JSON.stringify({created: true, t: 'error', e: CLOSED_WHILE_PENDING}));
        set.add(end);
        Promise.resolve().then(() => wc.executeJavaScriptInIsolatedWorld(state.world, [{code}])).then(resolve, () => resolve(null)).finally(() => set.delete(end));
      });
      if (typeof text !== 'string') return none;
      let answer;
      try { answer = JSON.parse(text); } catch { return none; }
      if (!answer || answer.created !== true) return none;
      if (answer.t === 'reply' && typeof answer.v === 'string') return {delivered: true, t: 'reply', v: answer.v};
      if (answer.t === 'error' && typeof answer.e === 'string') return {delivered: true, t: 'error', e: answer.e};
      if (answer.t === 'closed') return {delivered: true, t: 'closed'};
      return none;
    } catch { return none; }
  }

  return {
    deliver,
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
      if (!tracked.has(wc)) { tracked.add(wc); for (const name of ['did-navigate', 'render-process-gone', 'destroyed']) wc.on(name, () => endDeliveries(wc)); }
      const flags = {storage: !!hasPermission(extension, 'storage')};
      return '(' + contentShim.toString() + ')(' + [JSON.stringify(extension.id), JSON.stringify(manifestFor(extension)), JSON.stringify(messagesFor(extension)), JSON.stringify(state.token), JSON.stringify(flags)].join(',') + ')';
    }
  };
}

module.exports = {createContentWorld, contentShim, PREFIX, MAX_REQUEST, MAX_MESSAGE_BYTES, CLOSED_WHILE_PENDING};
