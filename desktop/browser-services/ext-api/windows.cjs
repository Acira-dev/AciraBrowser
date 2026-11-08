'use strict';
// chrome.windows (package P2, main process). Behaviour and error strings: ext-api/windows/service.cjs; the Electron side (which windows an
// extension may see, how a popup window is made): ext-api/windows/host.cjs, handed over as `windows` by extensionBrowser() in main.cjs.
const {createWindowsService} = require('./windows/service.cjs');
const {trace} = require('../ext-trace.cjs');

const GUARDED = Symbol.for('acira.windows.engine-events-silenced');

module.exports = {
  namespaces: ['windows'],
  install(api) {
    const store = api.store();
    const host = (store && store.impl && store.impl.windows) || null;
    const router = api.runtime && api.runtime.ctx && api.runtime.ctx.router;

    // The engine announces windows.onCreated / onRemoved / onFocusChanged / onBoundsChanged itself (its own window ids and a focus event that
    // never says "no window"). The service sends the real ones with api.emit, so the engine's copies are dropped: one event, not two.
    if (router && typeof router.broadcastEvent === 'function' && !router[GUARDED]) {
      const original = router.broadcastEvent;
      router.broadcastEvent = function broadcastEvent(name, ...args) {
        if (typeof name === 'string' && name.startsWith('windows.')) return undefined;
        return original.call(this, name, ...args);
      };
      Object.defineProperty(router, GUARDED, {value: original, configurable: true});
    }

    // Tabs of a window come from the live tabs.query handler (the engine's, or the tabs package's), so a window lists the tabs chrome.tabs would.
    const tabsOf = async (event, window) => {
      const query = api.handler('tabs.query');
      if (!query) return [];
      const tabs = await query(event, {windowId: window.id});
      return Array.isArray(tabs) ? tabs : [];
    };
    const send = (name, ...args) => { for (const id of api.listening(name)) api.emit(id, name, ...args); };
    const service = createWindowsService({host, store, tabsOf, send, log: (...args) => api.log(...args)});

    // The renderer passes the arguments as the schema lines them up: an omitted optional one is null.
    api.handle('windows.get', (event, windowId, queryOptions) => service.api.get(event, windowId, queryOptions));
    api.handle('windows.getCurrent', (event, queryOptions) => service.api.getCurrent(event, queryOptions));
    api.handle('windows.getLastFocused', (event, queryOptions) => service.api.getLastFocused(event, queryOptions));
    api.handle('windows.getAll', (event, queryOptions) => service.api.getAll(event, queryOptions));
    // The trace (ext-trace.cjs) says what an extension asked for and what it got: a pop-out that "opens nothing" shows here as an error text, or as a window that exists but is not shown.
    api.handle('windows.create', async (event, createData) => {
      const data = createData && typeof createData === 'object' ? createData : {};
      const id = event && event.extension && event.extension.id;
      let pages = [];
      try { pages = (Array.isArray(data.url) ? data.url : data.url ? [data.url] : []).map(String); } catch { pages = []; }
      trace('windows.create', id, {type: data.type, focused: data.focused, state: data.state, left: data.left, top: data.top, width: data.width, height: data.height}, pages, 'displays', host && typeof host.displays === 'function' ? host.displays() : null);
      try {
        const made = await service.api.create(event, createData);
        trace('windows.create ok', id, {id: made.id, type: made.type, focused: made.focused, state: made.state, left: made.left, top: made.top, width: made.width, height: made.height});
        return made;
      } catch (error) { trace('windows.create refused', id, error && error.message); throw error; }
    });
    api.handle('windows.update', (event, windowId, updateInfo) => service.api.update(event, windowId, updateInfo));
    api.handle('windows.remove', (event, windowId) => service.api.remove(event, windowId));
    service.start();

    return {
      forget() {},
      dispose() {
        service.dispose();
        if (router && router[GUARDED]) { router.broadcastEvent = router[GUARDED]; delete router[GUARDED]; }
      }
    };
  }
};
