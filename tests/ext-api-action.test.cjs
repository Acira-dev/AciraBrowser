'use strict';
// chrome.action (ext-api/action*.cjs): icons from imageData and path dictionaries, badge and text colours, enable/disable, per-tab values that end
// on navigation, the pin state, openPopup, the toolbar button's menu, and the extension page/worker side.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {EventEmitter} = require('node:events');
const extApi = require('../desktop/browser-services/ext-api/index.cjs');
const action = require('../desktop/browser-services/ext-api/action.cjs');
const {parseColor, toCss} = require('../desktop/browser-services/ext-api/action/color.cjs');
const icon = require('../desktop/browser-services/ext-api/action/icon.cjs');
const bridge = require('../desktop/browser-services/ext-api/surfaces/bridge.cjs');
const {host, manifestExtension, ID} = require('./fixtures/ext-api-p8/host.cjs');
const {extensionWorld, plain} = require('./fixtures/ext-api/world.cjs');

/** The engine's BrowserActionAPI, as far as the package touches it. */
function fakeEngine() {
  const actionMap = new Map();
  return {
    actionMap, updates: 0,
    getAction(id) { let a = actionMap.get(id); if (!a) { a = {tabs: {}}; actionMap.set(id, a); } return a; },
    onUpdate() { this.updates++; },
    getPopupUrl(id, tabId) {
      const a = this.getAction(id), value = a.tabs[tabId]?.popup !== undefined ? a.tabs[tabId].popup : a.popup;
      return value ? new URL(value, `chrome-extension://${id}`).href : undefined;
    },
    openPopup() { this.opened = (this.opened || 0) + 1; },
    removeActions(id) { actionMap.delete(id); }
  };
}
function actionHost(options = {}) {
  const engine = fakeEngine(), runtime = new EventEmitter();
  const tabs = new Set(), store = Object.assign(new EventEmitter(), {tabs, getTabById: id => [...tabs].find(wc => wc.id === id) || null});
  const h = host({packages: ['action', 'context-menus'], runtimeExtras: {api: {browserAction: engine}}, store, ...options,
    seed: ({router, runtime: r}) => {
      Object.assign(r, {on: runtime.on.bind(runtime), removeListener: runtime.removeListener.bind(runtime), emit: runtime.emit.bind(runtime)});
      router.handlers.set('browserAction.getState', {callback: () => ({activeTabId: 1, actions: [...engine.actionMap.entries()].map(([id, a]) => { const {icon: _icon, tabs: own, ...rest} = a; return {id, tabs: own, ...rest}; })}), allowRemote: true, extensionContext: false});
      router.handlers.set('browserAction.activate', {callback: (event, details) => { h.activated.push(details); return 'engine'; }, allowRemote: true, extensionContext: false});
    }});
  h.activated = [];
  h.engine = engine; h.store = store; h.tabs = tabs; h.engineEvents = runtime;
  return h;
}
const pixel = (width, height, fill = [10, 20, 30, 255]) => ({width, height, data: Uint8ClampedArray.from({length: width * height * 4}, (_, i) => fill[i % 4])});

test('colours: arrays, hex, rgb(), hsl() and CSS names', () => {
  assert.deepEqual(parseColor([1, 2, 3, 255]), [1, 2, 3, 255]);
  assert.equal(parseColor([1, 2, 3]), null);
  assert.equal(parseColor([1, 2, 3, 256]), null);
  assert.deepEqual(parseColor('red'), [255, 0, 0, 255]);
  assert.deepEqual(parseColor('RebeccaPurple'), [102, 51, 153, 255]);
  assert.deepEqual(parseColor('#0f0'), [0, 255, 0, 255]);
  assert.deepEqual(parseColor('#11223344'), [17, 34, 51, 68]);
  assert.deepEqual(parseColor('rgba(255, 0, 0, 0.5)'), [255, 0, 0, 128]);
  assert.deepEqual(parseColor('hsl(120, 100%, 50%)'), [0, 255, 0, 255]);
  assert.deepEqual(parseColor('transparent'), [0, 0, 0, 0]);
  assert.equal(parseColor('nonsense'), null);
  assert.equal(parseColor(5), null);
  assert.equal(toCss([217, 0, 0, 255]), 'rgba(217, 0, 0, 1)');
});

test('icon: raw RGBA becomes a PNG data URL per size, strings pass, and the errors are Chromium\'s', () => {
  icon.setImageEncoder(image => `data:image/png;base64,${image.width}x${image.height}`);
  try {
    assert.deepEqual(icon.normalizeIcon({imageData: pixel(16, 16)}), {imageData: {16: 'data:image/png;base64,16x16'}});
    assert.deepEqual(icon.normalizeIcon({imageData: {16: pixel(16, 16), 32: pixel(32, 32)}}), {imageData: {16: 'data:image/png;base64,16x16', 32: 'data:image/png;base64,32x32'}});
    assert.deepEqual(icon.normalizeIcon({imageData: 'data:image/png;base64,AAAA'}), {imageData: 'data:image/png;base64,AAAA'});
    assert.throws(() => icon.normalizeIcon({}), {message: 'Either the path or imageData property must be specified.'});
    assert.throws(() => icon.normalizeIcon({imageData: {width: 4, height: 4, data: new Uint8Array(3)}}), /icon image data is invalid/);
    assert.throws(() => icon.normalizeIcon({imageData: pixel(2000, 1)}), /icon image data is invalid/);
    assert.throws(() => icon.normalizeIcon({imageData: 'javascript:alert(1)'}), /icon image data is invalid/);
    assert.throws(() => icon.normalizeIcon({imageData: {abc: pixel(2, 2)}}), /icon image data is invalid/);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-icon-'));
    try {
      fs.mkdirSync(path.join(dir, 'icons'));
      fs.writeFileSync(path.join(dir, 'icons', 'a.png'), 'x');
      const extension = {path: dir};
      assert.deepEqual(icon.normalizeIcon({path: 'icons/a.png'}, {extension}), {path: 'icons/a.png'});
      assert.deepEqual(icon.normalizeIcon({path: {16: 'icons/a.png', 32: '/icons/a.png'}}, {extension}), {path: {16: 'icons/a.png', 32: '/icons/a.png'}});
      assert.throws(() => icon.normalizeIcon({path: 'icons/missing.png'}, {extension}), {message: "Could not load action icon 'icons/missing.png'."});
      assert.throws(() => icon.normalizeIcon({path: '../escape.png'}, {extension}), /Could not load action icon/);
      assert.throws(() => icon.normalizeIcon({path: {big: 'icons/a.png'}}, {extension}), /Could not load action icon/);
    } finally { fs.rmSync(dir, {recursive: true, force: true}); }
  } finally { icon.setImageEncoder(null); }
  const bitmap = icon.toBitmap({width: 1, height: 1, data: Uint8Array.from([200, 100, 50, 128])});
  assert.deepEqual([...bitmap], [25, 50, 100, 128], 'premultiplied BGRA');
});

test('values: title, popup, badge text and colours, globally and per tab, with Chromium\'s defaults and errors', async () => {
  const h = actionHost();
  const call = (name, ...args) => h.call(`action.${name}`, null, ...args);
  assert.equal(await call('getBadgeText', {}), '');
  await call('setBadgeText', {text: '12'});
  await call('setBadgeText', {text: '3', tabId: 7});
  assert.equal(await call('getBadgeText', {}), '12');
  assert.equal(await call('getBadgeText', {tabId: 7}), '3');
  assert.equal(await call('getBadgeText', {tabId: 8}), '12', 'a tab without its own value sees the global one');
  await call('setBadgeBackgroundColor', {color: 'red'});
  assert.deepEqual(await call('getBadgeBackgroundColor', {}), [255, 0, 0, 255]);
  assert.deepEqual(await call('getBadgeBackgroundColor', {tabId: 7}), [255, 0, 0, 255]);
  assert.deepEqual(await call('setBadgeBackgroundColor', {color: 'no such colour'}), {__acira_error: 'The color specification could not be parsed.'});
  assert.deepEqual(await call('getBadgeTextColor', {}), [255, 255, 255, 255], 'white until set');
  await call('setBadgeTextColor', {color: [0, 0, 0, 255], tabId: 7});
  assert.deepEqual(await call('getBadgeTextColor', {tabId: 7}), [0, 0, 0, 255]);
  assert.deepEqual(await call('getBadgeTextColor', {}), [255, 255, 255, 255]);
  await call('setTitle', {title: 'Hello'});
  assert.equal(await call('getTitle', {}), 'Hello');
  await call('setPopup', {popup: 'popup.html'});
  assert.equal(await call('getPopup', {}), `chrome-extension://${ID}/popup.html`);
  await call('setPopup', {popup: ''});
  assert.equal(await call('getPopup', {}), '');
  assert.ok(h.engine.updates > 0, 'the toolbar is told');
  // the engine's MV2 route reaches the same state
  await h.call('browserAction.setBadgeText', null, {text: 'v2'});
  assert.equal(await call('getBadgeText', {}), 'v2');
});

test('icons: setIcon keeps imageData (all sizes) or path dictionaries, per tab or global, and tells the toolbar which one changed', async () => {
  icon.setImageEncoder(image => `data:image/png;base64,${image.width}`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-icon-'));
  try {
    fs.writeFileSync(path.join(dir, 'a.png'), 'x');
    const h = actionHost({extensions: [manifestExtension(ID, {manifest_version: 3, name: 'T', version: '1', action: {}}, 'T', {path: dir})]});
    const call = (name, ...args) => h.call(`action.${name}`, null, ...args);
    await call('setIcon', {imageData: {16: pixel(16, 16), 32: pixel(32, 32)}});
    const global = h.engine.getAction(ID);
    assert.deepEqual(global.icon, {imageData: {16: 'data:image/png;base64,16', 32: 'data:image/png;base64,32'}});
    const first = global.iconModified;
    await call('setIcon', {path: {16: 'a.png'}, tabId: 4});
    assert.deepEqual(global.tabs[4].icon, {path: {16: 'a.png'}});
    assert.ok(global.tabs[4].iconModified > first, 'every change gets a newer stamp so the toolbar fetches the icon again');
    assert.deepEqual(await call('setIcon', {}), {__acira_error: 'Either the path or imageData property must be specified.'});
    assert.deepEqual(await call('setIcon', {path: 'nope.png'}), {__acira_error: "Could not load action icon 'nope.png'."});
    await h.call('browserAction.setIcon', null, {imageData: 'data:image/png;base64,AAAA'});   // Manifest V2: the page sends a data URL
    assert.equal(global.icon.imageData, 'data:image/png;base64,AAAA');
  } finally { icon.setImageEncoder(null); fs.rmSync(dir, {recursive: true, force: true}); }
});

test('per-tab values are kept under the tab\'s page id: a tab woken from sleep keeps its stable extension id (2000000002) but the toolbar knows it as its page (5)', async () => {
  const h = actionHost();
  // the tabs package: extension tab id -> the id of the tab's current page (null while the tab has none)
  h.handlers.set('acira.tabs.pageId', {callback: (_event, tabId) => (tabId === 2000000002 ? 5 : tabId === 2000000003 ? null : tabId), allowRemote: false, extensionContext: false});
  const call = (name, ...args) => h.call(`action.${name}`, null, ...args);
  await call('setBadgeText', {text: 'LOCK'});
  await call('setBadgeText', {text: '2', tabId: 2000000002});
  assert.equal(await call('getBadgeText', {tabId: 2000000002}), '2', 'the extension reads back what it set under its own id');
  assert.equal(h.engine.getAction(ID).tabs[5].text, '2', 'the toolbar button of that tab (page 5) shows it');
  assert.equal(h.engine.getAction(ID).tabs[2000000002], undefined, 'nothing is left under the id the toolbar never asks for');
  await call('setIcon', {path: 'icon.png', tabId: 2000000002});
  await call('disable', 2000000002);
  assert.equal(h.engine.getAction(ID).tabs[5].enabled, false);
  assert.equal(await call('isEnabled', 2000000002), false);
  assert.equal(await call('getBadgeText', {tabId: 9}), 'LOCK', 'an ordinary tab keeps its id and still falls back to the global value');
  await call('setBadgeText', {text: 'x', tabId: 2000000003});
  assert.equal(h.engine.getAction(ID).tabs[2000000003].text, 'x', 'a tab with no page yet keeps the id as given');
});

test('enable and disable: per tab or for the extension; a disabled button ignores clicks; right-click still works', async () => {
  const h = actionHost();
  const call = (name, ...args) => h.call(`action.${name}`, null, ...args);
  assert.equal(await call('isEnabled'), true);
  await call('disable');
  assert.equal(await call('isEnabled'), false);
  await call('enable', 7);
  assert.equal(await call('isEnabled', 7), true, 'a tab\'s own value wins');
  assert.equal(await call('isEnabled', 8), false);
  const activate = h.handlers.get('browserAction.activate').callback;
  const event = {type: 'frame', sender: {id: 99}};
  assert.equal(activate(event, {eventType: 'click', extensionId: ID, tabId: 8}), undefined, 'disabled: nothing happens');
  assert.equal(activate(event, {eventType: 'click', extensionId: ID, tabId: 7}), 'engine', 'enabled: the engine opens the popup or fires onClicked');
  assert.equal(h.activated.length, 1);
  await call('enable');
  assert.equal(await call('isEnabled', 8), true);
});

test('a click while one of Acira\'s own pages is in front (the button reaches the extension through a website tab behind it): a popup opens, anything else hears about that page, the website gets no grant', async () => {
  const activeTab = require('../desktop/browser-services/ext-api/surfaces/active-tab.cjs');
  const page = {id: 7, isDestroyed: () => false, getURL: () => 'https://a.test/'};
  const front = {id: 2000000003, windowId: 1, active: true, url: 'chrome://settings/'};
  const setup = ({inFront, model = true}) => {
    const h = actionHost();
    h.tabs.add(page);
    if (model) {
      h.store.impl = {tabModel: {}};
      // Like the real handlers, these refuse a caller that is no extension.
      h.handlers.set('tabs.get', {callback: event => !event.extension ? {__acira_error: 'ACCESS_DENIED'} : inFront === undefined ? {__acira_error: 'unknown tab'} : {id: 7, active: inFront}, extensionContext: false});
      h.handlers.set('tabs.query', {callback: event => !event.extension ? {__acira_error: 'ACCESS_DENIED'} : [front], extensionContext: false});
    }
    h.clicks = () => h.sent.filter(entry => entry[1] === 'browserAction.onClicked');
    h.click = () => h.handlers.get('browserAction.activate').callback({type: 'frame', sender: {id: 99}}, {eventType: 'click', extensionId: ID, tabId: 7});
    return h;
  };
  // A website in front: the engine acts on it, and the click is the grant.
  let h = setup({inFront: true});
  assert.equal(h.click(), 'engine');
  assert.equal(activeTab.has(h.session, ID, 7, 'https://a.test/'), true);
  assert.equal(h.clicks().length, 0, 'onClicked is the engine\'s to fire');
  // One of Acira's own pages in front, an action without a popup: onClicked with that page, not the website behind it, and no grant.
  h = setup({inFront: false});
  assert.equal(h.click(), undefined);
  assert.deepEqual(h.clicks(), [[ID, 'browserAction.onClicked', front]]);
  assert.equal(h.activated.length, 0, 'the engine is not asked: it would fire onClicked for the website');
  assert.equal(activeTab.has(h.session, ID, 7, 'https://a.test/'), false);
  // The same with a popup: it opens as ever (a chrome:// page has popups in Chrome), still no grant for the website behind.
  h = setup({inFront: false});
  h.engine.getAction(ID).popup = 'popup.html';
  assert.equal(h.click(), 'engine');
  assert.equal(h.clicks().length, 0);
  assert.equal(activeTab.has(h.session, ID, 7, 'https://a.test/'), false);
  // The tab list cannot say which tab is in front (an unknown tab), or there is none (a private session that runs extensions): as before.
  h = setup({inFront: undefined});
  assert.equal(h.click(), 'engine');
  assert.equal(activeTab.has(h.session, ID, 7, 'https://a.test/'), true);
  h = setup({inFront: false, model: false});
  assert.equal(h.click(), 'engine');
  assert.equal(activeTab.has(h.session, ID, 7, 'https://a.test/'), true);
  assert.equal(h.clicks().length, 0);
});

test('13.7: a click that names no website tab (-1: only the New Tab page or Settings is open, as the extensions menu\'s Open row sends it) reaches an extension without a popup as onClicked with that page, address included; a popup still opens; a website in front or no tab list is the engine\'s as before', () => {
  // What tabs.query tells an extension WITHOUT the tabs permission (no url), and the window the tab list keeps for it.
  const described = {id: 2000000003, windowId: 1, active: true};
  const setup = ({kind = 'internal', address = 'acira://new', model = true, tabs = true} = {}) => {
    const h = actionHost();
    if (model) {
      h.store.impl = {tabModel: {windows: () => [{id: 1, state: {tabs: [{id: 'tab-a', url: address, contentKind: kind}], activeTabId: 'tab-a'}}]}};
      // Like the real handlers, this refuses a caller that is no extension.
      h.handlers.set('tabs.query', {callback: event => (!event.extension ? {__acira_error: 'ACCESS_DENIED'} : tabs ? [described] : []), extensionContext: false});
    }
    h.clicks = () => h.sent.filter(entry => entry[1] === 'browserAction.onClicked');
    h.click = tabId => h.handlers.get('browserAction.activate').callback({type: 'frame', sender: {id: 99}}, {eventType: 'click', extensionId: ID, tabId});
    return h;
  };
  // The New Tab page alone, an action without a popup: the extension is told about that page, with the chrome:// address Chrome gives it (Tabrr: onClicked -> chrome.tabs.create({}); Colorway reads tab.url);
  // the engine, which would throw "Unable to get active tab", is not asked.
  let h = setup();
  assert.equal(h.click(-1), undefined);
  assert.deepEqual(h.clicks(), [[ID, 'browserAction.onClicked', {...described, url: 'chrome://newtab/'}]]);
  assert.equal(h.activated.length, 0);
  // Settings and the other pages: the same rule as the tab list's (acira://settings is chrome://settings/).
  h = setup({address: 'acira://settings'});
  assert.equal(h.click(-1), undefined);
  assert.equal(h.clicks()[0][2].url, 'chrome://settings/');
  // The same for a tab id that no longer names a page.
  h = setup();
  assert.equal(h.click(99), undefined);
  assert.equal(h.clicks().length, 1);
  // An action WITH a popup: the engine's click (installPopupFrames opens the popup from the window in use), no onClicked.
  h = setup();
  h.engine.getAction(ID).popup = 'popup.html';
  assert.equal(h.click(-1), 'engine');
  assert.equal(h.clicks().length, 0);
  // A website in front of the window (the interface's -1 is stale), or an empty window: the engine answers as before.
  h = setup({kind: 'web', address: 'https://a.test/'});
  assert.equal(h.click(-1), 'engine');
  assert.equal(h.clicks().length, 0);
  h = setup({tabs: false});
  assert.equal(h.click(-1), 'engine');
  // No tab list (a private session that runs extensions): as before.
  h = setup({model: false});
  assert.equal(h.click(-1), 'engine');
  assert.equal(h.clicks().length, 0);
});

test('the toolbar\'s state: a tab\'s own values win over the global ones, every known tab has its entry', () => {
  const h = actionHost();
  h.tabs.add({id: 5, isDestroyed: () => false, on() {}});
  h.tabs.add({id: 6, isDestroyed: () => false, on() {}});
  const a = h.engine.getAction(ID);
  Object.assign(a, {title: 'Global', text: 'G', color: 'rgba(1, 1, 1, 1)', popup: 'p.html', iconModified: 5, enabled: true});
  a.tabs[5] = {text: 'T5', iconModified: 9};
  const state = h.handlers.get('browserAction.getState').callback({type: 'frame'});
  const mine = state.actions.find(x => x.id === ID);
  assert.equal(mine.title, undefined, 'a global value at the top would hide the tab\'s own in the engine\'s button');
  assert.equal(mine.popup, 'p.html');
  assert.equal(mine.iconModified, 9, 'the newest stamp, so any change reaches the picture');
  assert.deepEqual(mine.tabs[5], {title: 'Global', text: 'T5', color: 'rgba(1, 1, 1, 1)', enabled: true, iconModified: 9});
  assert.deepEqual(mine.tabs[6], {title: 'Global', text: 'G', color: 'rgba(1, 1, 1, 1)', enabled: true});
});

test('a tab\'s own values end when the tab navigates (Chromium clears them), the global ones stay', async () => {
  const h = actionHost();
  const wc = Object.assign(new EventEmitter(), {id: 12, isDestroyed: () => false});
  h.store.emit('tab-added', wc);
  await h.call('action.setBadgeText', null, {text: 'per tab', tabId: 12});
  await h.call('action.setBadgeText', null, {text: 'global'});
  assert.equal(await h.call('action.getBadgeText', null, {tabId: 12}), 'per tab');
  wc.emit('did-navigate');
  assert.equal(await h.call('action.getBadgeText', null, {tabId: 12}), 'global');
});

test('pin state: getUserSettings follows the browser, onUserSettingsChanged fires when it changes', async () => {
  const h = actionHost();
  bridge.setProfileInfo({pinned: (profileId, extensionId) => (profileId === 'profile-1' && extensionId === ID ? false : null)});
  try {
    assert.deepEqual(await h.call('action.getUserSettings', null), {isOnToolbar: false});
    bridge.pinChanged('profile-1', ID, true);
    bridge.pinChanged('other-profile', ID, true);
    assert.deepEqual(h.sent, [[ID, 'action.onUserSettingsChanged', {isOnToolbar: true}]]);
  } finally { bridge.setProfileInfo(null); }
  assert.deepEqual(await h.call('action.getUserSettings', null), {isOnToolbar: true}, 'until the browser says otherwise the button is on the toolbar');
});

test('the button\'s menu: the extension\'s action items, then Options and Unpin; the browser UI shows it, else the engine does', async () => {
  const h = actionHost({extensions: [manifestExtension(ID, {manifest_version: 3, name: 'T', version: '1', action: {}, options_page: 'options.html', permissions: ['contextMenus'], background: {service_worker: 'sw.js'}}, 'Tool')]});
  await h.call('contextMenus.create', null, {id: 'act', title: 'Pause', contexts: ['action']});
  await h.call('contextMenus.create', null, {id: 'page', title: 'Not here', contexts: ['page']});
  const activate = h.handlers.get('browserAction.activate').callback;
  let asked = null;
  const take = request => { asked = request; request.handled = true; };
  bridge.hub.on('menu', take);
  try {
    const result = activate({type: 'frame', sender: {id: 3}}, {eventType: 'contextmenu', extensionId: ID, tabId: 1, anchorRect: {x: 10, y: 5, width: 30, height: 30}});
    assert.equal(result, undefined, 'the engine\'s native menu is not shown');
    assert.deepEqual(asked.templates.map(t => t.id || t.type), [`ext:${ID}:sact`, 'separator', 'ext-action:options', 'ext-action:unpin']);
    assert.equal(asked.templates[0].label, 'Pause');
    assert.equal(asked.templates[2].enabled, true);
    assert.deepEqual(asked.anchor, {x: 10, y: 5, width: 30, height: 30});
    asked.templates[0].click();
    assert.equal(h.sent.at(-1)[1], 'contextMenus.onClicked');
    assert.equal(h.sent.at(-1)[2].menuItemId, 'act');
    const opened = [];
    const unpin = e => opened.push(['unpin', e.extensionId]);
    h.store.createTab = details => { opened.push(['url', details.url, details.windowId]); return Promise.resolve(); };
    bridge.hub.on('unpin', unpin);
    asked.templates[2].click(); asked.templates[3].click();
    bridge.hub.off('unpin', unpin);
    assert.deepEqual(opened, [['url', `chrome-extension://${ID}/options.html`, -2], ['unpin', ID]], 'Options names the current window: the engine\'s last focused window may be an extension window the host refuses');
  } finally { bridge.hub.off('menu', take); }
  // nobody shows it: the engine's own menu
  assert.equal(activate({type: 'frame'}, {eventType: 'contextmenu', extensionId: ID, tabId: 1, anchorRect: {x: 0, y: 0, width: 1, height: 1}}), 'engine');
});

test('openPopup: needs a popup, resolves when the popup is up, falls back to the engine', async () => {
  const h = actionHost();
  const open = (options) => h.call('action.openPopup', null, options);
  assert.deepEqual(await open(), {__acira_error: 'Failed to show popup either because there is an existing popup or another error occurred.'}, 'no popup');
  await h.call('action.setPopup', null, {popup: 'popup.html'});
  h.store.getActiveTabOfCurrentWindow = () => ({id: 1});
  const shown = e => { e.handled = true; setImmediate(() => h.engineEvents.emit('browser-action-popup-created', {extensionId: ID})); };
  bridge.hub.on('open-popup', shown);
  try { assert.equal(await open(), undefined); } finally { bridge.hub.off('open-popup', shown); }
  const fallback = open();
  setImmediate(() => h.engineEvents.emit('browser-action-popup-created', {extensionId: ID}));
  assert.equal(await fallback, undefined);
  assert.equal(h.engine.opened, 1, 'the engine\'s own anchor is the fallback');
});

function world(manifest, options = {}) {
  const packages = extApi.loadPackages({fresh: true}).filter(p => p.name === 'action');
  return extensionWorld({name: 'x', version: '1', action: {}, ...manifest}, {packages, ...options});
}

test('extension side: setIcon sends raw pixels, the other members call through, Chromium\'s checks run first, events arrive', async () => {
  const calls = [];
  const w = world({manifest_version: 3}, {worker: true, answer: (name, args) => { calls.push([name, args]); return name === 'action.isEnabled' ? true : name === 'action.getUserSettings' ? {isOnToolbar: true} : undefined; }});
  const {chrome} = w;
  class ImageData { constructor(width, height) { this.width = width; this.height = height; this.data = new Uint8ClampedArray(width * height * 4); } }
  w.context.ImageData = ImageData;
  await chrome.action.setIcon({imageData: new ImageData(2, 2), tabId: 3});
  await chrome.action.setIcon({imageData: {16: new ImageData(1, 1), 32: new ImageData(2, 2)}});
  const sent = calls.filter(c => c[0] === 'action.setIcon').map(c => c[1][0]);
  assert.equal(sent[0].tabId, 3);
  assert.deepEqual([sent[0].imageData.width, sent[0].imageData.height, sent[0].imageData.data.length], [2, 2, 16]);
  assert.equal(sent[0].imageData instanceof ImageData, false, 'a plain object, not ImageData');
  assert.deepEqual(Object.keys(sent[1].imageData), ['16', '32']);
  await chrome.action.setBadgeTextColor({color: 'white'});
  await chrome.action.enable(3);
  await chrome.action.disable();
  assert.equal(await chrome.action.isEnabled(), true);
  assert.deepEqual(plain(await chrome.action.getUserSettings()), {isOnToolbar: true});
  await chrome.action.openPopup();
  assert.deepEqual(calls.map(c => c[0]).slice(2), ['action.setBadgeTextColor', 'action.enable', 'action.disable', 'action.isEnabled', 'action.getUserSettings', 'action.openPopup']);
  assert.deepEqual(plain(calls.find(c => c[0] === 'action.enable')[1]), [3]);
  assert.throws(() => chrome.action.setBadgeText({text: 5}), /Error in invocation of action\.setBadgeText/);
  assert.throws(() => chrome.action.enable('x'), /Error in invocation of action\.enable/);
  let clicks = 0, changes = [];
  chrome.action.onClicked.addListener(tab => { clicks += tab.id; });
  chrome.action.onUserSettingsChanged.addListener(change => changes.push(change.isOnToolbar));
  w.emit('browserAction.onClicked', {id: 9});
  w.emit('action.onUserSettingsChanged', {isOnToolbar: false});
  assert.equal(clicks, 9);
  assert.deepEqual(changes, [false]);
});

test('extension side: icon paths are resolved against the caller (a worker in a folder says ../icons/x.png) and an own address in full becomes a root path', async () => {
  const calls = [];
  const w = world({manifest_version: 3}, {worker: true, answer: (name, args) => { calls.push([name, args]); return undefined; }});
  w.context.location.href = `chrome-extension://${ID}/background/index.js`;
  await w.chrome.action.setIcon({path: {19: '../icons/dr_19.png', 38: '/icons/dr_38.png'}});
  await w.chrome.action.setIcon({path: `chrome-extension://${ID}/images/icon_grey16.png`, tabId: 2});
  await w.chrome.action.setIcon({path: 'sibling.png'});
  await w.chrome.action.setIcon({path: 'https://elsewhere.test/x.png'});
  assert.deepEqual(plain(calls.map(c => c[1][0].path)), [{19: 'icons/dr_19.png', 38: 'icons/dr_38.png'}, 'images/icon_grey16.png', 'background/sibling.png', 'https://elsewhere.test/x.png']);
});

test('extension side: an extension without an action key has no chrome.action (Chromium\'s gate)', () => {
  const packages = extApi.loadPackages({fresh: true}).filter(p => p.name === 'action');
  const w = extensionWorld({manifest_version: 3, name: 'x', version: '1'}, {packages, worker: true});
  assert.equal(w.chrome.action, undefined);
});
