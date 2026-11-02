'use strict';
// A fake Acira tab model (windows with ordered tab lists, pages, a reducer for the actions chrome.tabs uses) behind the real tabs package,
// reachable from the real patched preload: renderer world -> invoke -> router handler -> package -> fake model.
const path = require('node:path');
const {extensionWorld, ID} = require('../ext-api/world.cjs');
const extApi = require('../../../desktop/browser-services/ext-api/index.cjs');

const SESSION = {name: 'session'};
let wcId = 100;

function createRig({manifest = {manifest_version: 3, permissions: ['tabs']}, permissions, worker = true, extra = {}, native = {}} = {}) {
  const extension = {id: ID, manifest};
  const handlers = new Map(), listeners = new Map(), sent = [], dispatched = [], loads = [], commands = [], handoffs = new Set(), owners = new Map();
  const hookListeners = new Set();
  const storeListeners = new Map();
  const router = {
    handlers, listeners,
    handle(name, callback) { handlers.set(name, {callback, extensionContext: true}); },
    sendEvent: (id, name, ...args) => sent.push({id, name, args}),
    broadcastEvent(name, ...args) { sent.push({id: '*', name, args}); }
  };
  const makeWc = (url, title = '') => {
    const wc = {id: ++wcId, session: SESSION, url, title, destroyed: false, reloads: [], muted: false,
      isDestroyed() { return this.destroyed; }, getURL() { return this.url; }, getTitle() { return this.title; }, isLoading() { return false; },
      isCurrentlyAudible() { return false; }, reload() { this.reloads.push('reload'); }, reloadIgnoringCache() { this.reloads.push('bypass'); },
      setAudioMuted(value) { this.muted = value; }, async loadURL(next) { loads.push([this.id, next]); this.url = next; },
      lang: 'en-GB', async executeJavaScript() { return this.lang; }};
    return wc;
  };
  const windows = [];
  let tabSeq = 0;
  const addTab = (window, {url = 'https://example.com/', title = 'Example', pinned = false, group = '', privacy, page = true, ...rest} = {}) => {
    const tab = {id: `tab-${++tabSeq}`, title, url, contentKind: 'web', browserProfileId: 'p', profileId: 'p', pinned, group, privacy, favicon: '', loading: false, ...rest};
    if (pinned) window.state.tabs.splice(window.state.tabs.filter(t => t.pinned).length, 0, tab); else window.state.tabs.push(tab);
    if (page) {
      const wc = makeWc(url, title);
      window.pages.set(tab.id, {view: {webContents: wc}});
      if (!privacy) { store.tabs.add(wc); store.tabToWindow.set(wc, window.win); }
    }
    return tab;
  };
  const addWindow = ({focused = false} = {}) => {
    const win = {id: windows.length + 1, destroyed: false, isDestroyed() { return this.destroyed; }};
    const window = {
      id: win.id, win, profileId: 'p', focused, pages: new Map(), state: {tabs: [], activeTabId: '', tabGroups: [], activeWorkspaceId: ''},
      dispatch(action) { dispatched.push(action); reduce(window, action); notify(); },
      command(action) { commands.push(action); const tab = window.state.tabs.find(t => t.id === action.tabId); if (action.type === 'zoom' && tab) { tab.zoom = action.zoom; notify(); } },
      bounds: () => ({x: 10, y: 20, width: 1000, height: 700}), pageBounds: () => ({x: 0, y: 80, width: 1000, height: 600}), maximized: () => false
    };
    windows.push(window);
    return window;
  };
  const notify = () => { for (const listener of hookListeners) listener(); };
  function reduce(window, action) {
    const tabs = window.state.tabs, at = id => tabs.findIndex(t => t.id === id);
    switch (action.type) {
      case 'tab.select': window.state.activeTabId = action.id; break;
      case 'tab.pin': { const i = at(action.id), [tab] = tabs.splice(i, 1); tab.pinned = !tab.pinned; tabs.splice(tabs.filter(t => t.pinned).length, 0, tab); break; }
      case 'tab.reorder': { const from = at(action.from), to = at(action.to); if (from >= 0 && to >= 0 && tabs[from].pinned === tabs[to].pinned) { const [tab] = tabs.splice(from, 1); tabs.splice(to, 0, tab); } break; }
      case 'tab.mute': tabs[at(action.id)].muted = action.muted; break;
      case 'tab.close': { const i = at(action.id); if (i < 0) break; const [tab] = tabs.splice(i, 1); const entry = window.pages.get(tab.id); if (entry) { store.tabs.delete(entry.view.webContents); entry.view.webContents.destroyed = true; window.pages.delete(tab.id); } if (window.state.activeTabId === tab.id) window.state.activeTabId = tabs[0]?.id || ''; break; }
      case 'tab.navigate': { const tab = tabs[at(action.tabId)]; tab.url = action.url; tab.loading = true; const page = window.pages.get(tab.id); if (page) page.view.webContents.url = action.url; break; }
      case 'tab.new': {
        const tab = addTab(window, {url: action.url || 'acira://newtab', title: '', page: !!action.url, contentKind: action.url ? 'web' : 'internal'});
        if (!action.background) window.state.activeTabId = tab.id;
        break;
      }
      default: throw new Error(`unexpected action ${action.type}`);
    }
  }
  const store = {
    tabs: new Set(), tabToWindow: new WeakMap(), lastFocusedWindowId: 1, tabDetailsCache: new Map(),
    on(name, fn) { if (!storeListeners.has(name)) storeListeners.set(name, new Set()); storeListeners.get(name).add(fn); },
    off(name, fn) { storeListeners.get(name)?.delete(fn); },
    emit(name) { for (const fn of storeListeners.get(name) || []) fn(); },
    setActiveTab() {},
    async createTab(details) {
      const window = windows.find(w => w.id === details.windowId) || windows[0];
      if (details.url.startsWith('chrome-extension:')) {
        const wc = makeWc(details.url), win = {id: 500 + wc.id, isDestroyed: () => false};
        store.tabs.add(wc); store.tabToWindow.set(wc, win); store.emit('tab-added'); return wc;
      }
      window.dispatch({type: 'tab.new', url: details.url, background: details.active === false});
      const tab = window.state.tabs[window.state.tabs.length - 1];
      store.emit('tab-added');
      return window.pages.get(tab.id).view.webContents;
    },
    removeTab(wc) {
      store.tabs.delete(wc);
      for (const window of windows) for (const [id, entry] of window.pages) if (entry.view.webContents === wc) {
        window.pages.delete(id); window.state.tabs.splice(window.state.tabs.findIndex(t => t.id === id), 1);
        if (window.state.activeTabId === id) window.state.activeTabId = window.state.tabs[0]?.id || '';
      }
      store.emit('tab-removed'); notify();
    },
    impl: {tabModel: {windows: () => windows.filter(w => !w.win.destroyed), onChange: fn => { hookListeners.add(fn); return () => hookListeners.delete(fn); }, onHandoff: fn => { handoffs.add(fn); return () => handoffs.delete(fn); }, ownerOf: wc => (owners.has(wc) ? owners.get(wc) : null)}}
  };
  const table = permissions || {
    has: (ext, name) => (ext.manifest.permissions || []).includes(name),
    hasOrigin: (ext, url) => (ext.manifest.host_permissions || []).some(p => p === '<all_urls>' || url.startsWith(p.replace(/\*$/, '')))
  };
  const base = {session: SESSION, runtime: {ctx: {router, store}}, router, userData: require('node:os').tmpdir(), storeKey: 'p',
    getWindow: () => windows[0]?.win || null, getExtension: id => (id === ID ? extension : null), permissions: table, log() {}};
  const packages = extApi.loadPackages({fresh: true}).filter(pkg => pkg.name === 'tabs');
  const installed = extApi.installPackages(base, {packages, ...extra});
  const event = (overrides = {}) => ({type: 'service-worker', extension, ...overrides});
  const call = (name, ...args) => handlers.get(name).callback(event(), ...args);
  const world = extensionWorld(manifest, {
    packages, worker, native, browser: {runtime: {id: ID}},
    answer: (name, args) => (handlers.has(name) ? handlers.get(name).callback(event(), ...args) : undefined),
    grants: {[ID]: {permissions: [], origins: []}}
  });
  // Listening: the renderer subscribes through the engine's router in production; the rig lets a test declare who listens.
  const listen = (...names) => { for (const name of names) listeners.set(`tabs.${name}`, [{extensionId: ID}]); };
  return {extension, popup: (window) => { const wc = makeWc('chrome-extension://' + ID + '/popup.html', 'Popup'); owners.set(wc, window.id); return wc; }, handlers, sent, dispatched, commands, handoff: (acira, url, windowId) => { for (const fn of handoffs) fn(acira, url, windowId); }, windows, store, addWindow, addTab, makeWc, call, event, world, listen, loads, installed, notify, router, base,
    flush: () => new Promise(resolve => setTimeout(resolve, 80)), ID};
}

module.exports = {createRig, ID, SESSION};
