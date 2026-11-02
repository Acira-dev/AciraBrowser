'use strict';
// chrome.windows (ext-api package P2): Chromium 152's behaviour and error strings through the real renderer bindings (the patched engine
// preload in a vm) and the real main-side package on a fake router, with fake windows, a fake host and a fake engine store.
const test = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const extApi = require('../desktop/browser-services/ext-api/index.cjs');
const service = require('../desktop/browser-services/ext-api/windows/service.cjs');
const {createWindowsHost} = require('../desktop/browser-services/ext-api/windows/host.cjs');
const {extensionWorld, plain, ID} = require('./fixtures/ext-api/world.cjs');

const {ERR} = service;
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const SCREEN = [{x: 0, y: 0, width: 1920, height: 1080}];

class FakeWindow extends EventEmitter {
  constructor(id, bounds = {x: 100, y: 80, width: 1000, height: 700}) {
    super();
    Object.assign(this, {id, bounds: {...bounds}, normal: {...bounds}, focusedNow: false, minimized: false, maximized: false, fullscreen: false, onTop: false, destroyed: false, flashed: null});
  }
  isDestroyed() { return this.destroyed; }
  isFocused() { return this.focusedNow; }
  isMinimized() { return this.minimized; }
  isMaximized() { return this.maximized; }
  isFullScreen() { return this.fullscreen; }
  isAlwaysOnTop() { return this.onTop; }
  getBounds() { return this.minimized ? {x: -32000, y: -32000, width: 160, height: 28} : {...this.bounds}; }
  getNormalBounds() { return {...this.normal}; }
  setBounds(rect) { this.bounds = {...rect}; this.normal = {...rect}; this.emit('resize'); }
  minimize() { this.minimized = true; this.focusedNow = false; this.emit('minimize'); }
  maximize() { this.maximized = true; this.emit('maximize'); }
  unmaximize() { this.maximized = false; this.emit('unmaximize'); }
  restore() { this.minimized = false; this.emit('restore'); }
  setFullScreen(on) { this.fullscreen = on; }
  focus() { if (!this.focusedNow) { this.focusedNow = true; this.emit('focus'); } }
  blur() { if (this.focusedNow) { this.focusedNow = false; this.emit('blur'); } }
  flashFrame(on) { this.flashed = on; }
  close() { this.destroyed = true; this.focusedNow = false; this.emit('closed'); }
}

/** Everything one test needs: the package installed on a fake router, the page-side `chrome` wired to it, and the knobs. */
function setup({windows = [], tabs = {}, tabIds = [], tabUrls = {}} = {}) {
  const handlers = new Map(), sent = [], listeners = new Map(), removedTabs = [];
  const store = Object.assign(new EventEmitter(), {windows: new Set(), tabToWindow: new Map(), lastFocusedWindowId: undefined, tabs: new Set(), impl: {},
    getTabById: id => (tabIds.includes(id) ? {id, getURL: () => tabUrls[id] || 'https://example.com/moved'} : null), removeTab: tab => removedTabs.push(tab.id)});
  const router = {handlers, listeners,
    handle(name, callback) { handlers.set(name, {callback, extensionContext: true}); },
    sendEvent: (id, name, ...args) => sent.push([id, name, ...args]), broadcastEvent: (name, ...args) => sent.push(['*', name, ...args])};
  handlers.set('tabs.query', {callback: (event, info) => tabs[info.windowId] || [], extensionContext: true});
  const listed = windows.map(window => ({window, kind: window.kind || 'normal'}));
  const created = [];
  const host = {
    windows: () => listed.filter(item => !item.window.destroyed),
    windowOf: contents => (contents && contents.window) || null,
    displays: () => SCREEN,
    defaultBounds: () => ({x: 510, y: 180, width: 900, height: 720}),
    async create(spec) {
      const window = new FakeWindow(100 + created.length, spec.bounds || {x: 510, y: 180, width: 900, height: 720});
      window.kind = spec.kind;
      listed.push({window, kind: spec.kind});
      created.push({spec, window});
      store.windows.add(window); store.emit('window-added', window);
      if (spec.state === 'minimized') window.minimize(); else if (spec.state === 'maximized') window.maximize(); else if (spec.state === 'fullscreen') window.setFullScreen(true);
      if (spec.focused) window.focus();
      tabs[window.id] = [{id: 900 + window.id, index: 0, windowId: window.id, url: spec.urls[0] || 'about:blank'}];
      return window;
    },
    close: window => window.close()
  };
  store.impl.windows = host;
  for (const window of windows) store.windows.add(window);
  // The service's debounce timers are real (80 ms); `settle` waits them out.
  const settle = () => new Promise(resolve => setTimeout(resolve, 130));
  const all = extApi.loadPackages({fresh: true}), pkg = all.filter(p => p.name === 'windows');
  const base = {session: {}, runtime: {ctx: {router, store}}, router, userData: '', storeKey: 'p', getWindow: () => null, getExtension: () => null, emit() {}, permissions: null, log() {}};
  const installed = extApi.installPackages(base, {packages: pkg, log: error => { throw new Error(String(error)); }});
  return {handlers, sent, listeners, store, host, router, created, listed, installed, settle, packages: pkg, removedTabs,
    listen(...names) { for (const name of names) listeners.set(name, [{extensionId: ID, type: 'service-worker'}]); }};
}
const swEvent = extra => ({type: 'service-worker', extension: {id: ID, manifest: {manifest_version: 3}}, ...extra});
// A handler answers {__acira_error} for a failure (the page turns it into a rejection / lastError); the tests read it as a rejection.
const unwrap = result => { if (result && typeof result === 'object' && typeof result.__acira_error === 'string') throw new Error(result.__acira_error); return result; };
const callAs = async (ctx, event, name, ...args) => unwrap(await ctx.handlers.get(name).callback(event, ...args));
const call = (ctx, name, ...args) => callAs(ctx, swEvent(), name, ...args);

/** The page side wired to the main side of `ctx` (what chrome.windows does in a service worker). */
function worldOf(ctx, extra = {}) {
  return extensionWorld({manifest_version: 3, permissions: []}, {packages: ctx.packages, browser: {runtime: {id: ID}},
    answer: (name, args) => ctx.handlers.get(name).callback(swEvent(), ...args), ...extra});
}

test('the package claims exactly windows, with both halves', () => {
  const [pkg] = extApi.loadPackages({fresh: true}).filter(p => p.name === 'windows');
  assert.deepEqual(pkg.namespaces, ['windows']);
  assert.ok(pkg.install && pkg.renderer);
});

// ------------------------------------------------------------------------------------------------------------ the Window object
test('the Window object: Chromium\'s fields in its order, bounds of a minimized window are the ones it comes back to', async () => {
  const a = new FakeWindow(1), b = new FakeWindow(2, {x: 5, y: 6, width: 700, height: 500});
  b.minimized = true; b.onTop = true; a.focusedNow = true;
  const ctx = setup({windows: [a, b]});
  const first = await call(ctx, 'windows.get', 1, null);
  assert.deepEqual(Object.keys(first), ['id', 'type', 'focused', 'incognito', 'alwaysOnTop', 'state', 'left', 'top', 'width', 'height']);
  assert.deepEqual(first, {id: 1, type: 'normal', focused: true, incognito: false, alwaysOnTop: false, state: 'normal', left: 100, top: 80, width: 1000, height: 700});
  assert.deepEqual(await call(ctx, 'windows.get', 2, null), {id: 2, type: 'normal', focused: false, incognito: false, alwaysOnTop: true, state: 'minimized', left: 5, top: 6, width: 700, height: 500});
  a.fullscreen = true; assert.equal((await call(ctx, 'windows.get', 1, null)).state, 'fullscreen');
  a.fullscreen = false; a.maximized = true; assert.equal((await call(ctx, 'windows.get', 1, null)).state, 'maximized');
});

test('get / getCurrent / getLastFocused / getAll: ids, WINDOW_ID_CURRENT, type filters, populate, exact errors', async () => {
  const a = new FakeWindow(1), b = new FakeWindow(2), pop = new FakeWindow(3);
  pop.kind = 'popup';
  const tabs = {1: [{id: 11, index: 1, windowId: 1}, {id: 10, index: 0, windowId: 1}], 2: [], 3: [{id: 30, index: 0, windowId: 3}]};
  const ctx = setup({windows: [a, b, pop], tabs});
  assert.equal((await call(ctx, 'windows.get', 1, {populate: true})).tabs.map(t => t.id).join(), '10,11', 'tabs come back in strip order');
  assert.equal((await call(ctx, 'windows.get', 1, null)).tabs, undefined, 'no tabs unless populate');
  assert.deepEqual((await call(ctx, 'windows.getAll', null)).map(w => [w.id, w.type]), [[1, 'normal'], [2, 'normal'], [3, 'popup']], 'every window the extension may see, in creation order');
  assert.deepEqual((await call(ctx, 'windows.getAll', {windowTypes: ['popup']})).map(w => w.id), [3]);
  assert.deepEqual((await call(ctx, 'windows.getAll', {windowTypes: []})).map(w => w.id), [1, 2, 3], 'an empty list is no filter (Chromium: filter 0)');
  assert.equal((await call(ctx, 'windows.getAll', {populate: true})).find(w => w.id === 3).tabs[0].id, 30);
  await assert.rejects(call(ctx, 'windows.get', 99, null), {message: 'No window with id: 99.'});
  await assert.rejects(call(ctx, 'windows.get', -1, null), {message: 'No window with id: -1.'}, 'WINDOW_ID_NONE is not a window');
  await assert.rejects(call(ctx, 'windows.get', 3, {windowTypes: ['normal']}), {message: 'No window with id: 3.'}, 'a window the filter excludes is not found');
  // current window: the caller's own window first, whatever the filter says; else the focused one; else the one created last
  const frame = swEvent({type: 'frame', sender: {window: a}});
  assert.equal((await callAs(ctx, frame, 'windows.getCurrent', null)).id, 1);
  assert.equal((await callAs(ctx, frame, 'windows.get', CURRENT, null)).id, 1);
  assert.equal((await callAs(ctx, frame, 'windows.getCurrent', {windowTypes: ['popup']})).id, 1, 'the caller\'s window is not filtered');
  assert.equal((await call(ctx, 'windows.getCurrent', null)).id, 3, 'a service worker with nothing focused: the window created last');
  assert.equal((await call(ctx, 'windows.getCurrent', {windowTypes: ['normal']})).id, 2);
  b.focusedNow = true;
  assert.equal((await call(ctx, 'windows.getCurrent', null)).id, 2, 'a service worker: the focused window');
  b.focusedNow = false;
  // last focused: ordered by when windows were active
  a.focus(); await tick(); b.focus(); a.blur(); b.blur();
  assert.equal((await call(ctx, 'windows.getLastFocused', null)).id, 2);
  a.focus();
  assert.equal((await call(ctx, 'windows.getLastFocused', null)).id, 1);
  assert.equal((await call(ctx, 'windows.getLastFocused', {windowTypes: ['popup']})).id, 3, 'filtered: the most recent of that type');
  a.blur();
  await assert.rejects(call(setup(), 'windows.getLastFocused', null), {message: 'No last-focused window'});
  await assert.rejects(call(setup(), 'windows.getCurrent', null), {message: 'No current window'});
  assert.deepEqual(await call(setup(), 'windows.getAll', null), []);
});
const CURRENT = -2;

test('private, Tor, web-app, closing and other-profile windows are never listed and never reachable by id', async () => {
  // the real host over fake controllers: this is the line between "ordinary" and everything else
  const session = {name: 'profile'}, other = {name: 'other'};
  const win = id => new FakeWindow(id);
  const controllers = {
    ordinary: {window: win(1), auxiliaries: new Map(), privateMode: false, webApp: null, closing: false},
    privateTab: {window: win(2), auxiliaries: new Map(), privateMode: true, webApp: null, closing: false},
    app: {window: win(3), auxiliaries: new Map(), privateMode: false, webApp: {id: 'x'}, closing: false},
    closing: {window: win(4), auxiliaries: new Map(), privateMode: false, webApp: null, closing: true}
  };
  const aux = (id, s) => Object.assign(new FakeWindow(id), {webContents: {session: s}});
  controllers.ordinary.auxiliaries.set('extension-10', aux(10, session));
  controllers.ordinary.auxiliaries.set('extension-11', aux(11, other));         // another session: not this profile's
  controllers.ordinary.auxiliaries.set('popup-12', aux(12, session));           // a web pop-up: not an extension window
  // `available` is main.cjs's rule (!privateMode, !closing, same profile); the host adds its own web-app and session rules on top
  const available = () => Object.values(controllers).filter(c => !c.privateMode && !c.closing);
  const host = createWindowsHost({electron: {}, available, destination: () => null, createWindow: () => null, attach() {}, sessionOf: () => session});
  assert.deepEqual(host.windows().map(item => [item.window.id, item.kind]), [[1, 'normal'], [10, 'popup']]);
  const ctx = setup();
  ctx.store.impl.windows = host;
  // a service built straight on that host
  const svc = service.createWindowsService({host, store: ctx.store});
  const event = swEvent();
  assert.deepEqual((await svc.api.getAll(event, null)).map(w => w.id), [1, 10]);
  for (const id of [2, 3, 4, 11, 12]) await assert.rejects(svc.api.get(event, id, null), {message: `No window with id: ${id}.`});
  await assert.rejects(svc.api.update(event, 2, {focused: true}), {message: 'No window with id: 2.'});
  await assert.rejects(svc.api.remove(event, 2), {message: 'No window with id: 2.'});
  assert.equal(controllers.privateTab.window.destroyed, false);
});

test('a store without a windows list (or no store, no host) lists nothing and logs nothing', async () => {
  const logged = [];
  for (const options of [{store: {}}, {store: null}, {}]) {
    const svc = service.createWindowsService({...options, log: (...args) => logged.push(args)});
    assert.deepEqual(await svc.api.getAll(swEvent(), null), []);
    await assert.rejects(svc.api.getCurrent(swEvent(), null), {message: 'No current window'});
  }
  assert.deepEqual(logged, []);
});

test('host.windowOf: a page belongs to the window whose view tree holds it, an engine popup to its parent window', () => {
  const parent = new FakeWindow(7), contents = {name: 'tab'}, popup = {name: 'popup'};
  parent.contentView = {children: [{webContents: null, children: [{webContents: contents, children: []}]}]};
  const electron = {BaseWindow: {getAllWindows: () => [parent]},
    BrowserWindow: {fromWebContents: wc => (wc === popup ? {getParentWindow: () => parent} : null)}};
  const host = createWindowsHost({electron, available: () => [], destination: () => null, createWindow: () => null, attach() {}, sessionOf: () => ({})});
  assert.equal(host.windowOf(contents), parent);
  assert.equal(host.windowOf(popup), parent);
  assert.equal(host.windowOf({name: 'elsewhere'}), null);
  assert.equal(host.windowOf(null), null);
});

test('host.create: the extension\'s own page opens in a standalone window for popup AND normal type; web addresses in a normal type use an Acira window', async () => {
  const session = {name: 'profile'}, made = [], attached = [], spawned = [];
  class FakeBrowserWindow extends FakeWindow {
    constructor(options) {
      super(50 + made.length, {x: options.x, y: options.y, width: options.width, height: options.height});
      this.options = options; this.loaded = null; this.menu = 'unset';
      const handlers = {};
      this.webContents = {session, on(name, fn) { handlers[name] = fn; }, setWindowOpenHandler(fn) { this.openHandler = fn; }, async loadURL(url) { this.loadedUrl = url; }};
      made.push(this);
    }
    setMenu(menu) { this.menu = menu; }
    show() { this.shown = 'show'; }
    showInactive() { this.shown = 'inactive'; }
  }
  const owner = {webApp: null, auxiliaries: new Map(), ready: Promise.resolve(true)};
  const area = {x: 0, y: 0, width: 1920, height: 1080};
  const screen = {getPrimaryDisplay: () => ({workArea: area, bounds: area}), getDisplayMatching: () => ({workArea: area, bounds: area}), getAllDisplays: () => [{bounds: area}]};
  const host = createWindowsHost({electron: {BrowserWindow: FakeBrowserWindow, screen}, available: () => [owner], destination: () => owner,
    createWindow: options => { spawned.push(options); return {ready: Promise.resolve(true), window: new FakeWindow(70), extensionCreateTab: async () => {}, show() {}}; },
    attach: (contents, window) => attached.push([contents, window]), sessionOf: () => session, ordinary: url => /^https?:/.test(url), icon: 'icon.png', title: 'Acira', hidden: () => false});
  const own = `chrome-extension://${ID}/ui/index.html`;
  for (const kind of ['popup', 'normal']) {
    const window = await host.create({extensionId: ID, urls: [own], kind, bounds: null, state: 'default', focused: true});
    assert.equal(window.webContents.loadedUrl, own, `${kind}: the page is loaded`);
    assert.equal(window.shown, 'show', `${kind}: focused: true shows and focuses`);
    assert.equal(window.menu, null, 'no menu bar');
    assert.equal(window.options.webPreferences.session, session);
    assert.equal(window.options.webPreferences.sandbox, true);
    assert.deepEqual(host.windows().filter(item => item.window === window).map(item => item.kind), ['popup'], `${kind}: listed as an extension window`);
    assert.equal(attached.at(-1)[0], window.webContents, 'handed to the extension engine');
    // its own pop-ups stay inside the extension's origin
    const open = window.webContents.openHandler;
    assert.equal(open({url: `chrome-extension://${ID}/ui/other.html`}).action, 'allow');
    assert.equal(open({url: 'chrome-extension://bcdefghijklmnopabcdefghijklmnopa/x.html'}).action, 'deny');
    assert.equal(open({url: 'https://example.com/'}).action, 'allow');
    assert.equal(open({url: 'file:///C:/x'}).action, 'deny');
  }
  assert.equal(spawned.length, 0, 'an extension page never goes through an Acira window');
  const quiet = await host.create({extensionId: ID, urls: [own], kind: 'popup', bounds: {x: 5, y: 6, width: 300, height: 400}, state: 'default', focused: false});
  assert.equal(quiet.shown, 'inactive');
  assert.deepEqual([quiet.options.x, quiet.options.y, quiet.options.width, quiet.options.height], [5, 6, 300, 400]);
  await host.create({extensionId: ID, urls: ['https://example.com/'], kind: 'normal', bounds: null, state: 'default', focused: true});
  assert.deepEqual(spawned, [{initialURL: 'https://example.com/'}], 'a web address in a normal window is an Acira window');
});

// ------------------------------------------------------------------------------------------------------------------- create
test('create: urls resolve like Chromium (relative to the extension), unsafe ones are refused with Chromium\'s messages', async () => {
  const ctx = setup({windows: [new FakeWindow(1)]});
  const make = data => call(ctx, 'windows.create', data);
  const win = await make({url: 'popup.html?x=1', type: 'popup', width: 380, height: 600});
  assert.equal(ctx.created[0].spec.urls[0], `chrome-extension://${ID}/popup.html?x=1`);
  assert.equal(win.tabs[0].url, `chrome-extension://${ID}/popup.html?x=1`);
  // the extension's own page, as a popup (Chrono's standalone manager) and as a normal window: both are opened; another extension's page is not
  await make({url: `chrome-extension://${ID}/ui/index.html`, type: 'popup', focused: true});
  assert.deepEqual([ctx.created.at(-1).spec.kind, ctx.created.at(-1).spec.urls], ['popup', [`chrome-extension://${ID}/ui/index.html`]]);
  await make({url: `chrome-extension://${ID}/ui/index.html`});
  assert.deepEqual([ctx.created.at(-1).spec.kind, ctx.created.at(-1).spec.urls], ['normal', [`chrome-extension://${ID}/ui/index.html`]]);
  ctx.created.length = 1;   // keep the indexes below
  await make({url: ['https://example.com/a', 'http://example.org/']});
  assert.deepEqual(ctx.created[1].spec.urls, ['https://example.com/a', 'http://example.org/']);
  await assert.rejects(make({url: 'javascript:alert(1)'}), {message: ERR.javascriptUrl});
  await assert.rejects(make({url: 'ftp://example.com/'}), {message: 'Extension windows require ordinary web destinations.'});
  await assert.rejects(make({url: 'chrome-extension://bcdefghijklmnopabcdefghijklmnopa/x.html'}), {message: 'Extension windows require ordinary web destinations.'}, 'another extension\'s page');
  await assert.rejects(make({url: 'http://'}), {message: 'Invalid url: "http://".'});
  assert.equal(ctx.created.length, 2, 'a refused call opens nothing');
});

test('create: type, state, focus, bounds validation with Chromium\'s exact errors, and what a valid call asks the host for', async () => {
  const ctx = setup({windows: [new FakeWindow(1)], tabIds: [5]});
  const make = data => call(ctx, 'windows.create', data);
  await assert.rejects(make({incognito: true}), {message: 'Incognito mode is disabled.'});
  await assert.rejects(make({type: 'devtools'}), {message: 'Invalid value for type'});
  await assert.rejects(make({state: 'minimized', focused: true}), {message: 'Invalid value for state'});
  await assert.rejects(make({state: 'maximized', focused: false}), {message: 'Invalid value for state'});
  await assert.rejects(make({state: 'maximized', width: 500}), {message: 'Invalid value for state'});
  await assert.rejects(make({state: 'fullscreen', left: 0}), {message: 'Invalid value for state'});
  await assert.rejects(make({state: 'locked-fullscreen'}), {message: ERR.lockedFullscreen});
  await assert.rejects(make({left: 5000, top: 5000, width: 400, height: 300}), {message: 'Invalid value for bounds. Bounds must be at least 50% within visible screen space.'});
  await assert.rejects(make({tabId: 404}), {message: 'No tab with id: 404.'});
  assert.equal(ctx.created.length, 0);
  // no arguments: a normal window, focused, host's own default placement
  await call(ctx, 'windows.create', null);
  assert.deepEqual(ctx.created[0].spec, {extensionId: ID, urls: [], kind: 'normal', bounds: null, state: 'default', focused: true, setSelfAsOpener: false});
  await make({type: 'popup', left: 10, top: 20, width: 300, height: 400, focused: false});
  assert.deepEqual([ctx.created[1].spec.kind, ctx.created[1].spec.bounds, ctx.created[1].spec.focused], ['popup', {x: 10, y: 20, width: 300, height: 400}, false]);
  await make({type: 'panel'});
  assert.equal(ctx.created[2].spec.kind, 'popup', 'panel is a popup, as in Chromium');
  await make({state: 'minimized'});
  assert.deepEqual([ctx.created[3].spec.state, ctx.created[3].spec.focused], ['minimized', false], 'minimized defaults to unfocused');
  await make({state: 'locked-fullscreen'}).catch(() => {});
  // a size without a position is moved onto the display (gfx::Rect::AdjustToFit); half off screen is still refused
  await make({type: 'popup', width: 3000, height: 2000, left: undefined});
  assert.deepEqual(ctx.created[4].spec.bounds, {x: 0, y: 0, width: 1920, height: 1080});
  await make({left: -300, top: 0, width: 600, height: 400});
  assert.deepEqual(ctx.created[5].spec.bounds, {x: -300, y: 0, width: 600, height: 400}, 'exactly half on a display is allowed');
  await assert.rejects(make({left: -301, top: 0, width: 600, height: 400}), {message: /Invalid value for bounds/});
});

test('create answers the new window with its tabs, and tells listeners once (windows.onCreated), before the call returns', async () => {
  const ctx = setup({windows: [new FakeWindow(1)]});
  ctx.listen('windows.onCreated');
  const value = await call(ctx, 'windows.create', {url: 'https://example.com/', type: 'popup', width: 400, height: 500, left: 30, top: 40, focused: false});
  assert.equal(value.type, 'popup');
  assert.deepEqual([value.left, value.top, value.width, value.height, value.incognito, value.state], [30, 40, 400, 500, false, 'normal']);
  assert.equal(value.tabs.length, 1);
  const created = ctx.sent.filter(entry => entry[1] === 'windows.onCreated');
  assert.equal(created.length, 1, 'one event, not the engine\'s and ours');
  assert.equal(created[0][2].id, value.id);
  assert.equal(created[0][2].tabs, undefined, 'the event carries no tabs');
});

test('create with tabId: the tab\'s address opens in the new window and the old tab closes (a normal window or an empty popup only)', async () => {
  const ctx = setup({windows: [new FakeWindow(1)], tabIds: [5, 6, 7], tabUrls: {5: 'https://example.com/five', 6: 'acira://newtab', 7: 'https://example.com/seven'}});
  const make = data => call(ctx, 'windows.create', data);
  const moved = await make({tabId: 5, left: 10, top: 20, width: 600, height: 400});
  assert.deepEqual(ctx.created[0].spec.urls, ['https://example.com/five']);
  assert.equal(ctx.created[0].spec.kind, 'normal');
  assert.equal(moved.tabs[0].url, 'https://example.com/five');
  assert.deepEqual(ctx.removedTabs, [5], 'the old tab is closed');
  await make({tabId: 6});
  assert.deepEqual(ctx.created[1].spec.urls, [], 'an internal page: the new window starts on its own start page');
  assert.deepEqual(ctx.removedTabs, [5, 6]);
  await make({tabId: 7, type: 'popup'});
  assert.deepEqual(ctx.created[2].spec.urls, ['https://example.com/seven'], 'an empty popup takes the tab');
  await make({tabId: 7, type: 'popup', url: 'https://example.org/'});
  assert.deepEqual(ctx.created[3].spec.urls, ['https://example.org/'], 'a popup that has its own addresses leaves the tab where it is');
  assert.deepEqual(ctx.removedTabs, [5, 6, 7], 'and the tab stays open');
  await assert.rejects(make({tabId: 404}), {message: 'No tab with id: 404.'});
  assert.equal(ctx.created.length, 4, 'an unknown tab opens no window');
});

// ------------------------------------------------------------------------------------------------------------------- update
test('update: state, bounds, focus, attention; validation before any change; the answer is the window as it became', async () => {
  const w = new FakeWindow(1);
  const ctx = setup({windows: [w]});
  const update = (info, id = 1) => call(ctx, 'windows.update', id, info);
  assert.equal((await update({state: 'maximized'})).state, 'maximized');
  assert.equal((await update({state: 'minimized'})).state, 'minimized');
  assert.equal((await update({state: 'normal'})).state, 'normal');
  assert.equal(w.minimized || w.maximized, false);
  assert.equal((await update({state: 'fullscreen'})).state, 'fullscreen');
  assert.equal((await update({state: 'normal'})).state, 'normal', 'leaving fullscreen');
  assert.equal(w.fullscreen, false);
  const moved = await update({left: 20, top: 30, width: 640, height: 480});
  assert.deepEqual([moved.left, moved.top, moved.width, moved.height], [20, 30, 640, 480]);
  assert.deepEqual((await update({width: 800})).width, 800);
  assert.equal((await update({width: 800})).left, 20, 'fields not given stay');
  assert.equal(moved.tabs, undefined);
  // validation
  const before = JSON.stringify(w.bounds);
  await assert.rejects(update({left: 9000, top: 9000}), {message: 'Invalid value for bounds. Bounds must be at least 50% within visible screen space.'});
  await assert.rejects(update({state: 'maximized', width: 700}), {message: 'Invalid value for state'});
  await assert.rejects(update({state: 'minimized', focused: true}), {message: 'Invalid value for state'});
  await assert.rejects(update({state: 'maximized', focused: false}), {message: 'Invalid value for state'});
  await assert.rejects(update({state: 'fullscreen', focused: false}), {message: 'Invalid value for state'});
  assert.equal(JSON.stringify(w.bounds), before, 'a refused update changes nothing');
  assert.equal(w.maximized, false);
  await assert.rejects(update({focused: true}, 77), {message: 'No window with id: 77.'});
  // focus and attention
  w.focusedNow = false;
  assert.equal((await update({focused: true})).focused, true);
  assert.equal((await update({focused: false})).focused, false);
  await update({drawAttention: true}); assert.equal(w.flashed, true);
  await update({drawAttention: false}); assert.equal(w.flashed, false);
  // WINDOW_ID_CURRENT is the caller's window
  const frame = swEvent({type: 'frame', sender: {window: w}});
  assert.equal((await callAs(ctx, frame, 'windows.update', CURRENT, {width: 900})).width, 900);
  // a minimized window is resized by its restored bounds
  w.minimize();
  const restored = await update({height: 500});
  assert.equal(restored.height, 500);
  assert.equal(restored.width, 900, 'the width it comes back with, not Windows\' minimized stub');
});

// ------------------------------------------------------------------------------------------------------------------- remove
test('remove closes the window; an unknown one is an error; windows.onRemoved arrives once with the id', async () => {
  const a = new FakeWindow(1), b = new FakeWindow(2);
  const ctx = setup({windows: [a, b]});
  ctx.listen('windows.onRemoved');
  assert.equal(await call(ctx, 'windows.remove', 2), undefined);
  assert.equal(b.destroyed, true);
  assert.deepEqual(ctx.sent.filter(entry => entry[1] === 'windows.onRemoved'), [[ID, 'windows.onRemoved', 2]]);
  await assert.rejects(call(ctx, 'windows.remove', 2), {message: 'No window with id: 2.'});
  a.close();                               // closed by the person, not by the API: the same event
  assert.deepEqual(ctx.sent.filter(entry => entry[1] === 'windows.onRemoved').map(entry => entry[2]), [2, 1]);
});

// ------------------------------------------------------------------------------------------------------------------- events
test('windows.onFocusChanged: the window id, WINDOW_ID_NONE when focus leaves every window, no repeats', async () => {
  const a = new FakeWindow(1), b = new FakeWindow(2);
  const ctx = setup({windows: [a, b]});
  ctx.listen('windows.onFocusChanged');
  const focusEvents = () => ctx.sent.filter(entry => entry[1] === 'windows.onFocusChanged').map(entry => entry[2]);
  a.focus();
  assert.deepEqual(focusEvents(), [1]);
  a.focus(); assert.deepEqual(focusEvents(), [1], 'no repeat');
  a.blur(); b.focus(); await ctx.settle();   // switching windows: blur then focus, no NONE in between
  assert.deepEqual(focusEvents(), [1, 2]);
  assert.equal(ctx.store.lastFocusedWindowId, 2, 'the engine\'s notion of the focused window follows');
  b.blur(); await ctx.settle();              // another application took the focus
  assert.deepEqual(focusEvents(), [1, 2, -1]);
  a.focus();
  assert.deepEqual(focusEvents(), [1, 2, -1, 1]);
  assert.equal(ctx.store.lastFocusedWindowId, 1, 'NONE never becomes the last focused window');
});

test('windows.onBoundsChanged follows resizes and moves (one event per burst); the engine\'s own window events are dropped', async () => {
  const a = new FakeWindow(1);
  const ctx = setup({windows: [a]});
  ctx.listen('windows.onBoundsChanged');
  a.setBounds({x: 1, y: 2, width: 800, height: 600}); a.emit('move'); a.emit('resize');
  await ctx.settle();
  const events = ctx.sent.filter(entry => entry[1] === 'windows.onBoundsChanged');
  assert.equal(events.length, 1);
  assert.deepEqual([events[0][2].id, events[0][2].left, events[0][2].width, events[0][2].tabs], [1, 1, 800, undefined]);
  // the engine announces windows itself through router.broadcastEvent; that is silenced for windows.* only
  const before = ctx.sent.length;
  ctx.router.broadcastEvent('windows.onCreated', {id: 5});
  ctx.router.broadcastEvent('windows.onFocusChanged', 5);
  ctx.router.broadcastEvent('tabs.onCreated', {id: 6});
  assert.deepEqual(ctx.sent.slice(before), [['*', 'tabs.onCreated', {id: 6}]]);
  ctx.installed.dispose();
  ctx.router.broadcastEvent('windows.onCreated', {id: 5});
  assert.equal(ctx.sent.at(-1)[1], 'windows.onCreated', 'disposing the package restores the router');
});

test('windows.onCreated: a window the engine is handed later is announced once; those that existed (or an API call saw first) are not', async () => {
  const a = new FakeWindow(1);
  const ctx = setup({windows: [a]});
  ctx.listen('windows.onCreated');
  ctx.store.emit('window-added', a);                       // the first page of an existing window reaches the engine
  assert.equal(ctx.sent.filter(entry => entry[1] === 'windows.onCreated').length, 0, 'existing windows are not new');
  const b = new FakeWindow(2);
  ctx.listed.push({window: b, kind: 'normal'});
  ctx.store.emit('window-added', b);
  ctx.store.emit('window-added', b);
  const created = ctx.sent.filter(entry => entry[1] === 'windows.onCreated');
  assert.deepEqual(created.map(entry => entry[2].id), [2]);
  // a window that is not listed for extensions (private, web app) is never announced
  ctx.store.emit('window-added', new FakeWindow(3));
  assert.equal(ctx.sent.filter(entry => entry[1] === 'windows.onCreated').length, 1);
  // no listener: nothing is sent
  const quiet = setup({windows: []});
  quiet.listed.push({window: new FakeWindow(9), kind: 'normal'});
  quiet.store.emit('window-added', quiet.listed[0].window);
  assert.deepEqual(quiet.sent, []);
});

// ------------------------------------------------------------------------------------------------------ the page side (bindings)
test('page side: every member, constants, Chromium\'s argument errors, promise and callback forms, lastError', async () => {
  const ctx = setup({windows: [new FakeWindow(1)]});
  const {chrome, browser} = worldOf(ctx);
  for (const member of ['get', 'getCurrent', 'getLastFocused', 'getAll', 'create', 'update', 'remove']) assert.equal(typeof chrome.windows[member], 'function', member);
  for (const member of ['onCreated', 'onRemoved', 'onFocusChanged', 'onBoundsChanged']) assert.equal(typeof chrome.windows[member].addListener, 'function', member);
  assert.equal(chrome.windows.WINDOW_ID_NONE, -1);
  assert.equal(chrome.windows.WINDOW_ID_CURRENT, -2);
  assert.equal(chrome.windows.WindowType.POPUP, 'popup');
  assert.equal(chrome.windows.WindowState.MAXIMIZED, 'maximized');
  assert.equal(chrome.windows.CreateType.PANEL, 'panel');
  assert.equal(typeof browser.windows.create, 'function', 'browser.windows too');
  assert.throws(() => chrome.windows.get('1'), {message: 'Error in invocation of windows.get(integer windowId, optional windows.QueryOptions queryOptions, optional function callback): No matching signature.'});
  assert.throws(() => chrome.windows.get(-3), /Error at parameter 'windowId': Value must be at least -2\./);
  assert.throws(() => chrome.windows.remove(-2), /Error at parameter 'windowId': Value must be at least 0\./, 'WINDOW_ID_CURRENT is not accepted by remove');
  assert.throws(() => chrome.windows.update(1), {name: 'TypeError'}, 'updateInfo is required');
  assert.throws(() => chrome.windows.create({type: 'bogus'}), /Error at parameter 'createData': Error at property 'type': Value must be one of normal, panel, popup\./);
  assert.throws(() => chrome.windows.create({width: -1}), /Error at property 'width': Value must be at least 0\./);
  assert.throws(() => chrome.windows.getAll({bogus: 1}), /Unexpected property: 'bogus'\./);
  // promise form, optional arguments omitted (the main side gets null for them)
  const current = plain(await chrome.windows.getCurrent());
  assert.equal(current.id, 1);
  assert.equal(plain(await chrome.windows.getAll()).length, 1);
  assert.equal(plain(await browser.windows.getLastFocused({populate: true})).id, 1);
  await assert.rejects(chrome.windows.get(404), {message: 'No window with id: 404.'});
  // callback form: the value, or no arguments with lastError
  const viaCallback = await new Promise(resolve => chrome.windows.get(1, window => resolve(plain(window))));
  assert.equal(viaCallback.id, 1);
  const failed = await new Promise(resolve => chrome.windows.get(404, (...args) => resolve({args, error: chrome.runtime.lastError && chrome.runtime.lastError.message})));
  assert.deepEqual(failed, {args: [], error: 'No window with id: 404.'});
  assert.equal((await chrome.windows.create({type: 'popup', url: 'https://example.com/'}) || {}).type, 'popup');
});

test('page side: event filters by window type (windowTypes), the type of an id comes from the windows this context saw', async () => {
  const ctx = setup({windows: [new FakeWindow(1)]});
  const world = worldOf(ctx), {chrome} = world;
  const heard = {all: [], popups: [], removed: [], removedPopups: [], focus: []};
  chrome.windows.onCreated.addListener(w => heard.all.push(w.id));
  chrome.windows.onCreated.addListener(w => heard.popups.push(w.id), {windowTypes: ['popup']});
  chrome.windows.onRemoved.addListener(id => heard.removed.push(id));
  chrome.windows.onRemoved.addListener(id => heard.removedPopups.push(id), {windowTypes: ['popup']});
  chrome.windows.onFocusChanged.addListener(id => heard.focus.push(id), {windowTypes: ['normal']});
  world.emit('windows.onCreated', {id: 5, type: 'normal'});
  world.emit('windows.onCreated', {id: 6, type: 'popup'});
  assert.deepEqual([heard.all, heard.popups], [[5, 6], [6]]);
  world.emit('windows.onRemoved', 6); world.emit('windows.onRemoved', 5);
  assert.deepEqual([heard.removed, heard.removedPopups], [[6, 5], [6]], 'the ids were learnt from onCreated');
  world.emit('windows.onFocusChanged', 6); world.emit('windows.onFocusChanged', 5); world.emit('windows.onFocusChanged', -1);
  assert.deepEqual(heard.focus, [5, -1], 'the popup is filtered out; WINDOW_ID_NONE counts as normal (Chromium)');
});
