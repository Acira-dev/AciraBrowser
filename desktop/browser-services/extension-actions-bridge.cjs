'use strict';
// The toolbar's button list (electron-chrome-extensions' <browser-action-list>) listens for the engine's action updates through the bridge the library exposes to the page
// (window.browserAction.addEventListener / removeEventListener). With context isolation the page's function crosses the bridge as a NEW proxy at every call, so the proxy
// that removeEventListener is given is never the one addEventListener was given: nothing was ever removed. Every <browser-action-list> that was connected (and every toolbar or
// sidebar copy that was rebuilt: a tab switch, a change of the pinned extensions) left a listener on the preload's `process` for "-actions-update", and a detached copy of the
// list with it: the interface printed "MaxListenersExceededWarning: 11 -actions-update listeners", its memory grew, and every update of the toolbar ran every dead copy's handler.
// (Measured in a bare Electron with the library's own preload: 12 connects and removes of the element left 12 listeners; a plain function added and removed through the bridge
// the same.)
//
// A listener is removed by a handle the page keeps, not by the function. The preload side exposes the library's bridge under a private name with `listen(name, listener)` ->
// handle and `unlisten(handle)`, and a small script runs in the page's own world and puts an adapter in place of window.browserAction: its addEventListener / removeEventListener
// keep the page's function against its handle (in the page's world, where the function is the same object both times) and call listen / unlisten. The library's elements and
// the interface's own code (BrowserExtensionActions.tsx) use window.browserAction as they always did and need no change. Anything the adapter cannot do leaves the library's
// own bridge in place (the old behaviour), never no toolbar.
const PRIVATE = '__aciraBrowserActionBridge';

/**
 * Runs in the page's own world (serialized: it must not use anything from this file). Puts window.browserAction, with listeners that can be removed, over the private bridge.
 * Every other member of the bridge is passed through as it is.
 */
function pageAdapter(privateName) {
  const raw = globalThis[privateName];
  const handles = new Map();   // event name -> Map(listener -> handle)
  const adapter = {};
  for (const key of Object.keys(raw)) {
    if (key === 'listen' || key === 'unlisten' || key === 'count') continue;
    adapter[key] = (...args) => raw[key](...args);
  }
  adapter.addEventListener = (name, listener) => {
    if (typeof listener !== 'function') return;
    let byListener = handles.get(name);
    if (!byListener) handles.set(name, byListener = new Map());
    if (byListener.has(listener)) return;
    byListener.set(listener, raw.listen(name, listener));
  };
  adapter.removeEventListener = (name, listener) => {
    const byListener = handles.get(name), handle = byListener && byListener.get(listener);
    if (handle === undefined) return;
    byListener.delete(listener);
    raw.unlisten(handle);
  };
  Object.defineProperty(globalThis, 'browserAction', {value: adapter, enumerable: true, configurable: true, writable: false});
}

/**
 * The library's bridge with listeners that have handles. `emitter` is the object the library emits "-actions-<name>" on (the preload's `process`).
 */
function bridgeWithHandles(api, emitter) {
  const listeners = new Map();   // handle -> {event, listener}: the very function object that was added, so it can be removed
  let next = 0;
  return {
    ...api,
    listen(name, listener) {
      if (typeof name !== 'string' || typeof listener !== 'function') return 0;
      const event = `-actions-${name}`, handle = ++next;
      listeners.set(handle, {event, listener});
      emitter.addListener(event, listener);
      return handle;
    },
    unlisten(handle) {
      const held = listeners.get(handle);
      if (!held) return;
      listeners.delete(handle);
      emitter.removeListener(held.event, held.listener);
    },
    /** How many listeners the page has on the bridge right now (a number: what a check of the interface reads to see that rebuilding the toolbar leaves none behind). */
    count() { return listeners.size; },
  };
}

/**
 * Calls `inject` (the library's injectBrowserAction) with window.browserAction replaced by the adapter above. The library exposes its bridge with
 * contextBridge.exposeInMainWorld('browserAction', ...) and then runs its elements in the page's world: the call is intercepted for that one key, only while `inject` runs.
 * Without context isolation the library's own bridge is used as it is (the page's functions are the same objects there).
 * deps: {contextBridge, webFrame}; emitter: the preload's `process`.
 */
function injectWithRemovableListeners(inject, {contextBridge, webFrame} = require('electron'), emitter = process) {
  if (!emitter.contextIsolated || !contextBridge || typeof contextBridge.exposeInMainWorld !== 'function') return inject();
  const original = contextBridge.exposeInMainWorld;
  const runInPage = func => {
    if (typeof contextBridge.executeInMainWorld === 'function') contextBridge.executeInMainWorld({func, args: [PRIVATE]});
    else webFrame.executeJavaScript(`(${func})(${JSON.stringify(PRIVATE)});`);
  };
  contextBridge.exposeInMainWorld = function exposeInMainWorld(key, api, ...rest) {
    if (key !== 'browserAction' || !api || typeof api !== 'object') return original.call(this, key, api, ...rest);
    try {
      original.call(this, PRIVATE, bridgeWithHandles(api, emitter));
      runInPage(pageAdapter);
    } catch (error) {
      // the adapter could not be put in place: the library's own bridge, as it was
      try { console.error('browser actions: listeners that can be removed are not available:', error && error.message); } catch { /* no console */ }
      return original.call(this, key, api, ...rest);
    }
    return undefined;
  };
  try { return inject(); } finally { contextBridge.exposeInMainWorld = original; }
}

module.exports = {injectWithRemovableListeners, bridgeWithHandles, pageAdapter, PRIVATE};
