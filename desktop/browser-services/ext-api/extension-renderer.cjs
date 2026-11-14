'use strict';
// chrome.extension for extension pages and service workers (P3): the three members the engine stubbed, now with Chromium's argument checks,
// promise / callback forms and availability (getViews does not exist in a service worker). The rest (getBackgroundPage, getURL,
// inIncognitoContext, lastError, ...) stays what the engine and Chromium provide.
//   isAllowedFileSchemeAccess  the extension's "Allow access to file URLs" switch (Settings › Extensions, off by default): Chromium's util::AllowFileAccess, extension-file-access.cjs
//   isAllowedIncognitoAccess   false in an ordinary profile; true inside a private session that runs the extension (Settings › Extensions › Allow in private tabs).
//                              Tor windows and secured workspaces run no extension at all
//   getViews                   an extension page lists itself when no filter is given; other pages and the worker are not reachable from a
//                              page (a stub: [] with a filter)
function extensionRenderer(acira) {
  // file: URLs for this extension's own pages and worker, only while its "Allow access to file URLs" switch is on (acira.fileAccess). Electron gives an extension page no file URL
  // loader even with the engine's allowFileAccess flag, so fetch() and XMLHttpRequest of a file: address ask the main process for the bytes ('acira.file.read', ext-api/extension.cjs)
  // and answer from them: fetch with a Response (200, or 206 for a Range), XMLHttpRequest the way Chrome answers a file: address (readyState 4, status 0, the response in the page's
  // responseType). Any other address, and every extension whose switch is off, reaches the browser's own fetch and XMLHttpRequest untouched. A renderer function is written into the
  // preload as source text, so this lives inside it. Chromium: the renderer registers file: as supporting the fetch API for extensions (extensions/renderer/dispatcher.cc) and the
  // browser grants the extension's process the file scheme (extension_util.cc InitializeFileSchemeAccessForExtension): Electron exposes neither.
  function installFileRequests(acira) {
    if (!acira || acira.fileAccess !== true || typeof acira.call !== 'function') return {};
    const root = typeof globalThis !== 'undefined' ? globalThis : self;
    const MARK = Symbol.for('acira.file-requests');
    if (root[MARK]) return {};
    try { Object.defineProperty(root, MARK, { value: true, configurable: true }); } catch { /* frozen global: the same world is not patched twice anyway */ }
    const read = acira.call('acira.file.read');
    const here = () => { try { return root.location && root.location.href; } catch { return undefined; } };
    /** The absolute file: address an argument names (a string, a URL, a Request), or null for any other address. */
    const fileAddressOf = input => {
      try {
        const text = typeof input === 'string' ? input : input && typeof input.href === 'string' ? input.href : input && typeof input.url === 'string' ? input.url : String(input);
        const url = new URL(text, here());
        return url.protocol === 'file:' ? url.href : null;
      } catch { return null; }
    };
    const abortOf = signal => (signal && signal.reason !== undefined ? signal.reason : new DOMException('The user aborted a request.', 'AbortError'));
    const headerLines = reply => {
      const lines = { 'content-type': reply.type, 'content-length': String(reply.bytes.length), 'last-modified': new Date(reply.modified).toUTCString() };
      if (reply.status === 206) lines['content-range'] = 'bytes ' + reply.start + '-' + reply.end + '/' + reply.size;
      if (reply.status === 416) lines['content-range'] = 'bytes */' + reply.size;
      return lines;
    };

    const realFetch = root.fetch;
    if (typeof realFetch === 'function') {
      root.fetch = function fetch(input, init) {
        const address = fileAddressOf(input);
        if (!address) return realFetch.apply(root, arguments);
        return (async () => {
          const request = new Request(input, init), method = request.method.toUpperCase();
          if (method !== 'GET' && method !== 'HEAD') throw new TypeError('Failed to fetch');
          if (request.signal && request.signal.aborted) throw abortOf(request.signal);
          let reply;
          try { reply = await read(address, request.headers.get('range') || undefined); } catch { throw new TypeError('Failed to fetch'); }
          if (request.signal && request.signal.aborted) throw abortOf(request.signal);
          const response = new Response(method === 'HEAD' || reply.status === 416 ? null : reply.bytes, { status: reply.status, headers: new Headers(headerLines(reply)) });
          Object.defineProperty(response, 'url', { value: address });
          return response;
        })();
      };
    }

    const XHR = root.XMLHttpRequest;
    if (typeof XHR === 'function') {
      const proto = XHR.prototype;
      const real = { open: proto.open, send: proto.send, abort: proto.abort, setRequestHeader: proto.setRequestHeader, getResponseHeader: proto.getResponseHeader, getAllResponseHeaders: proto.getAllResponseHeaders, overrideMimeType: proto.overrideMimeType };
      const mine = new WeakMap();   // an XMLHttpRequest opened on a file: address -> what it is doing
      const OWN = ['readyState', 'status', 'statusText', 'responseURL', 'response', 'responseText', 'responseXML'];
      const fire = (xhr, type, loaded, total) => {
        let event;
        try { event = new ProgressEvent(type, { lengthComputable: total !== undefined, loaded: loaded || 0, total: total || 0 }); } catch { event = new Event(type); }
        xhr.dispatchEvent(event);
      };
      const invalid = text => new DOMException(text, 'InvalidStateError');
      const textOf = state => (state.text === undefined ? (state.text = new TextDecoder('utf-8').decode(state.reply.bytes)) : state.text);
      const bodyOf = (xhr, state) => {
        const type = xhr.responseType;
        if (state.readyState !== 4 || state.error) return type === '' || type === 'text' ? '' : null;
        if (type === 'arraybuffer') return state.reply.bytes.buffer.slice(state.reply.bytes.byteOffset, state.reply.bytes.byteOffset + state.reply.bytes.byteLength);
        if (type === 'blob') return new Blob([state.reply.bytes], { type: state.reply.type });
        if (type === 'json') { try { return JSON.parse(textOf(state)); } catch { return null; } }
        if (type === 'document') return null;
        return textOf(state);
      };
      const define = (xhr, state) => {
        const get = (name, getter) => Object.defineProperty(xhr, name, { configurable: true, enumerable: true, get: getter });
        const answered = () => state.readyState >= 2 && !state.error;
        get('readyState', () => state.readyState);
        get('status', () => 0);   // a file: answer carries no HTTP status: Chrome's XMLHttpRequest says 0
        get('statusText', () => '');
        get('responseURL', () => (answered() ? state.url : ''));
        get('response', () => bodyOf(xhr, state));
        get('responseText', () => {
          const type = xhr.responseType;
          if (type !== '' && type !== 'text') throw invalid("Failed to read the 'responseText' property from 'XMLHttpRequest': The value is only accessible if the object's 'responseType' is '' or 'text' (was '" + type + "').");
          return bodyOf(xhr, state);
        });
        get('responseXML', () => null);
      };
      const release = xhr => { mine.delete(xhr); for (const name of OWN) try { delete xhr[name]; } catch { /* not ours */ } };

      proto.open = function open(method, url, async) {
        const address = arguments.length >= 2 ? fileAddressOf(url) : null;
        if (!address) { if (mine.has(this)) release(this); return real.open.apply(this, arguments); }
        if (async === false) throw new DOMException("Synchronous XMLHttpRequest of a file: address is not supported.", 'NotSupportedError');
        const state = { method: String(method).toUpperCase(), url: address, headers: {}, readyState: 1, sent: false, aborted: false, error: false, reply: null, text: undefined };
        mine.set(this, state); define(this, state);
        fire(this, 'readystatechange');
      };
      proto.setRequestHeader = function setRequestHeader(name, value) {
        const state = mine.get(this);
        if (!state) return real.setRequestHeader.apply(this, arguments);
        if (state.readyState !== 1 || state.sent) throw invalid("Failed to execute 'setRequestHeader' on 'XMLHttpRequest': The object's state must be OPENED.");
        const key = String(name).toLowerCase();
        state.headers[key] = key in state.headers ? state.headers[key] + ', ' + value : String(value);
      };
      proto.send = function send() {
        const state = mine.get(this);
        if (!state) return real.send.apply(this, arguments);
        if (state.readyState !== 1 || state.sent) throw invalid("Failed to execute 'send' on 'XMLHttpRequest': The object's state must be OPENED.");
        state.sent = true;
        const xhr = this;
        const fail = () => { if (state.aborted) return; state.error = true; state.readyState = 4; fire(xhr, 'readystatechange'); fire(xhr, 'error'); fire(xhr, 'loadend'); };
        fire(xhr, 'loadstart');
        if (state.method !== 'GET' && state.method !== 'HEAD') { Promise.resolve().then(fail); return; }
        read(state.url, state.headers.range).then(reply => {
          if (state.aborted) return;
          state.reply = reply;
          const size = reply.bytes.length;
          state.readyState = 2; fire(xhr, 'readystatechange');
          state.readyState = 3; fire(xhr, 'readystatechange'); fire(xhr, 'progress', size, size);
          state.readyState = 4; fire(xhr, 'readystatechange'); fire(xhr, 'load', size, size); fire(xhr, 'loadend', size, size);
        }, fail);
      };
      proto.abort = function abort() {
        const state = mine.get(this);
        if (!state) return real.abort.apply(this, arguments);
        if (state.sent && state.readyState !== 4 && !state.aborted) {
          state.aborted = true; state.readyState = 4; state.error = true;
          fire(this, 'readystatechange'); fire(this, 'abort'); fire(this, 'loadend');
        }
        state.readyState = 0;
      };
      proto.getResponseHeader = function getResponseHeader(name) {
        const state = mine.get(this);
        if (!state) return real.getResponseHeader.apply(this, arguments);
        if (state.readyState < 2 || state.error) return null;
        const value = headerLines(state.reply)[String(name).toLowerCase()];
        return value === undefined ? null : value;
      };
      proto.getAllResponseHeaders = function getAllResponseHeaders() {
        const state = mine.get(this);
        if (!state) return real.getAllResponseHeaders.apply(this, arguments);
        if (state.readyState < 2 || state.error) return '';
        const lines = headerLines(state.reply);
        return Object.keys(lines).map(name => name + ': ' + lines[name] + '\r\n').join('');
      };
      proto.overrideMimeType = function overrideMimeType() { return mine.has(this) ? undefined : real.overrideMimeType.apply(this, arguments); };
    }
    return {};
  }
  installFileRequests(acira);
  return {
    extension: {
      factory: base => {
        if (!base || typeof base !== 'object') return base;
        const built = acira.build('extension', {
          functions: {
            isAllowedFileSchemeAccess: () => Promise.resolve(acira.fileAccess === true),
            isAllowedIncognitoAccess: () => Promise.resolve(acira.incognito === true),
            getViews: fetchProperties => {
              const filtered = !!fetchProperties && (fetchProperties.type !== undefined || fetchProperties.windowId !== undefined || fetchProperties.tabId !== undefined);
              return !filtered && typeof window !== 'undefined' ? [window] : [];
            }
          }
        });
        const overrides = {};
        for (const name of ['isAllowedFileSchemeAccess', 'isAllowedIncognitoAccess']) if (typeof built[name] === 'function') overrides[name] = built[name];
        // In a service worker Chromium has no extension.getViews; the engine's stub must not show.
        if (typeof built.getViews === 'function') overrides.getViews = built.getViews; else if (acira.isWorker) overrides.getViews = undefined;
        if (acira.incognito === true) overrides.inIncognitoContext = true;
        return acira.extend(base, overrides);
      }
    }
  };
}

module.exports = {namespaces: ['extension'], renderer: extensionRenderer};
