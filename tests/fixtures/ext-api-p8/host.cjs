'use strict';
// A fake engine host for the P8 packages (action, commands, context menus, notifications): the real package loader on a fake router.
//   const h = host({packages: ['context-menus'], extensions: [{id, name, manifest}]});
//   await h.call('contextMenus.create', h.ext(), {id: 'a', title: 'A'});   h.sent -> events the main side emitted
const extApi = require('../../../desktop/browser-services/ext-api/index.cjs');

const ID = 'abcdefghijklmnopabcdefghijklmnop';
const ID2 = 'ponmlkjihgfedcbaponmlkjihgfedcba';

function manifestExtension(id, manifest, name = 'Test extension', extra = {}) {
  return {id, name, manifest, path: extra.path || '', version: manifest.version || '1.0', ...extra};
}

function host({packages = [], extensions, userData = null, storeKey = 'profile-1', tabs = {}, permissions = null, getWindow = () => null, runtimeExtras = {}, seed = null, store = {}} = {}) {
  const handlers = new Map(), sent = [], broadcast = [];
  const loaded = new Map((extensions || [manifestExtension(ID, {manifest_version: 3, name: 'Test', version: '1', permissions: ['contextMenus', 'notifications'], action: {}, background: {service_worker: 'sw.js'}})]).map(e => [e.id, e]));
  const listeners = new Map();
  const sessionExtensions = {
    getExtension: id => loaded.get(id) || null,
    getAllExtensions: () => [...loaded.values()],
    on(name, fn) { if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(fn); },
    addListener(name, fn) { this.on(name, fn); },
    fire(name, extension) { for (const fn of listeners.get(name) || []) fn({}, extension); }
  };
  const router = {
    handlers, listeners: new Map(),
    handle(name, callback) { handlers.set(name, {callback, extensionContext: true}); },
    sendEvent: (id, name, ...args) => sent.push([id, name, ...args]),
    broadcastEvent: (name, ...args) => broadcast.push([name, ...args])
  };
  const tabDetailsCache = new Map(Object.entries(tabs).map(([id, tab]) => [Number(id), tab]));
  const runtime = {ctx: {router, store: Object.assign(store, {tabDetailsCache, getActiveTabOfCurrentWindow: store.getActiveTabOfCurrentWindow || (() => null)})}, api: {browserAction: null}, ...runtimeExtras};
  const session = {extensions: sessionExtensions};
  if (seed) seed({router, runtime, session, handlers});
  const table = permissions || {has: () => true};
  const base = {session, runtime, router, userData, storeKey, getExtension: id => loaded.get(id) || null, permissions: table, getWindow, log: () => {}, t: id => id};
  const chosen = extApi.loadPackages({fresh: true}).filter(p => packages.includes(p.name));
  const installed = extApi.installPackages(base, {packages: chosen, log: (...args) => { throw new Error(args.join(' ')); }});
  const ext = (id = ID) => loaded.get(id);
  return {
    handlers, sent, broadcast, runtime, session, sessionExtensions, installed, ext, loaded,
    event: (id = ID, type = 'service-worker') => ({type, extension: loaded.get(id), sender: null}),
    call: (name, extension, ...args) => handlers.get(name).callback({type: 'service-worker', extension: extension || loaded.get(ID), sender: null}, ...args),
    dispose: () => installed.dispose()
  };
}

module.exports = {host, manifestExtension, ID, ID2};
