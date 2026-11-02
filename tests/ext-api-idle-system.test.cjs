'use strict';
// P9 essentials: chrome.idle (queryState, setDetectionInterval, onStateChanged) and chrome.system.display (getInfo, onDisplayChanged).
const test = require('node:test'), assert = require('node:assert/strict');
const path = require('node:path'), os = require('node:os');
const {extensionWorld, plain, ID} = require('./fixtures/ext-api/world.cjs');
const extApi = require('../desktop/browser-services/ext-api/index.cjs');
const idlePackage = require('../desktop/browser-services/ext-api/idle.cjs');
const systemPackage = require('../desktop/browser-services/ext-api/system.cjs');
const {installExtensionApis} = require('../desktop/browser-services/extension-apis.cjs');

const mine = names => extApi.loadPackages({fresh: true}).filter(pkg => names.includes(pkg.name));

function fakeRuntime() {
  const handlers = new Map(), sent = [];
  const router = {handlers, listeners: new Map(), handle(name, callback) { handlers.set(name, {callback, extensionContext: true}); },
    sendEvent: (id, name, ...args) => sent.push([id, name, ...args]), broadcastEvent: (name, ...args) => sent.push(['*', name, ...args])};
  const session = {extensions: {getExtension: () => null, on() {}}, serviceWorkers: {getAllRunning: () => ({})}};
  return {runtime: {ctx: {router}}, router, handlers, sent, session};
}

// ------------------------------------------------------------------------------------------------ idle

test('idle (renderer): Chromium\'s schema, the 15 second minimum, IdleState, and nothing without the permission', async () => {
  const none = extensionWorld({manifest_version: 3, permissions: ['storage']}, {packages: mine(['idle'])});
  assert.equal(none.chrome.idle, undefined, 'chrome.idle needs the idle permission');
  const world = extensionWorld({manifest_version: 3, permissions: ['idle']}, {packages: mine(['idle']), browser: {runtime: {id: ID}},
    answer: (name, args) => (name === 'idle.queryState' ? (args[0] >= 60 ? 'active' : 'idle') : undefined)});
  const {chrome} = world;
  assert.deepEqual(plain(chrome.idle.IdleState), {ACTIVE: 'active', IDLE: 'idle', LOCKED: 'locked'});
  assert.equal(await chrome.idle.queryState(60), 'active');
  assert.equal(await chrome.idle.queryState(30), 'idle');
  assert.throws(() => chrome.idle.queryState(5), {message: /Error at parameter 'detectionIntervalInSeconds': Value must be at least 15/});
  assert.throws(() => chrome.idle.setDetectionInterval(14), {message: /Error at parameter 'intervalInSeconds': Value must be at least 15/});
  assert.throws(() => chrome.idle.queryState('x'), {message: /No matching signature/});
  assert.equal(await chrome.idle.setDetectionInterval(30), undefined);
  assert.equal(chrome.idle.getAutoLockDelay, undefined, 'ChromeOS-only in Chromium 152');
  assert.equal(world.browser.idle, chrome.idle, 'browser.idle is the same object');
  // callback form: queryState gives its answer to the callback
  assert.equal(await new Promise(resolve => chrome.idle.queryState(60, resolve)), 'active');
  // onStateChanged: Chromium's event object, fed by the main process
  const heard = [];
  chrome.idle.onStateChanged.addListener(state => heard.push(state));
  assert.equal(chrome.idle.onStateChanged.hasListeners(), true);
  world.emit('idle.onStateChanged', 'idle'); world.emit('idle.onStateChanged', 'locked');
  assert.deepEqual(heard, ['idle', 'locked']);
  assert.ok(world.calls.some(call => call.channel === 'crx-add-listener' && call.args.includes('idle.onStateChanged')), 'the main process is told to deliver it');
});

test('idle (main): a change of state is reported once, per extension, with its own interval; idle browsers do not poll fast', () => {
  const asked = [], emitted = [], timers = [];
  let state = 'active', listeners = [];
  const idle = idlePackage.createIdle({
    source: () => ({getSystemIdleState: seconds => { asked.push(seconds); return state; }}),
    listening: () => listeners, emit: (id, value) => emitted.push([id, value]),
    setTimer: (fn, ms) => { const timer = {fn, ms, unref() {}}; timers.push(timer); return timer; }, clearTimer() {}
  });
  assert.equal(idle.queryState(60), 'active');
  assert.equal(idle.queryState(3), 'active');
  assert.deepEqual(asked, [60, 15], 'never below 15 seconds');
  idle.start();
  assert.equal(timers.at(-1).ms, 5000, 'nobody listens: a slow look to notice a first listener');
  listeners = [ID];
  timers.at(-1).fn();
  assert.equal(timers.at(-1).ms, 1000, 'somebody listens: once a second');
  assert.deepEqual(emitted, [], 'the first look only records the state');
  state = 'idle'; timers.at(-1).fn();
  assert.deepEqual(emitted, [[ID, 'idle']]);
  timers.at(-1).fn();
  assert.equal(emitted.length, 1, 'no repeat while the state holds');
  state = 'locked'; timers.at(-1).fn();
  state = 'unknown'; timers.at(-1).fn();
  assert.deepEqual(emitted.map(entry => entry[1]), ['idle', 'locked', 'active'], 'an unknown answer counts as active');
  idle.setDetectionInterval(ID, 90);
  assert.equal(idle.interval(ID), 90); asked.length = 0; timers.at(-1).fn();
  assert.deepEqual(asked, [90]);
  listeners = []; timers.at(-1).fn();
  assert.equal(timers.at(-1).ms, 5000, 'the listener went: slow again');
  idle.stop();
});

test('idle (main): the package\'s handlers replace Acira\'s older ones, check the permission, and the older 5 second timer stands down', async () => {
  const {runtime, handlers, session, sent, router} = fakeRuntime();
  const older = installExtensionApis(runtime, {session, userData: os.tmpdir(), extApiDir: path.join(os.tmpdir(), 'no-such-ext-api')});
  const olderQuery = handlers.get('idle.queryState').callback;
  older.dispose?.();
  const apis = installExtensionApis(runtime, {session, userData: os.tmpdir()});
  assert.notEqual(handlers.get('idle.queryState').callback, olderQuery, 'the package\'s handler is the one installed last');
  const event = {type: 'service-worker', extension: {id: ID, manifest: {manifest_version: 3, permissions: ['idle']}}};
  assert.equal(await handlers.get('idle.setDetectionInterval').callback(event, 30), undefined);
  assert.deepEqual(await handlers.get('idle.queryState').callback({type: 'frame', extension: {id: ID, manifest: {permissions: []}}}, 60), {__acira_error: 'Access to extension API denied.'});
  apis.dispose?.();
});

// ------------------------------------------------------------------------------------------------ system.display

const displays = [
  {id: 2, label: 'Side', bounds: {x: 1920, y: 0, width: 1280, height: 1024}, workArea: {x: 1920, y: 0, width: 1280, height: 984}, scaleFactor: 1, rotation: 90, internal: false, touchSupport: 'unavailable', accelerometerSupport: 'unavailable'},
  {id: 1, label: 'Built-in', bounds: {x: 0, y: 0, width: 1920, height: 1080}, workArea: {x: 0, y: 0, width: 1920, height: 1040}, scaleFactor: 1.5, rotation: 0, internal: true, touchSupport: 'available', accelerometerSupport: 'unknown'}
];

test('system.display (main): Chrome\'s DisplayUnitInfo from Electron\'s displays, the primary first', () => {
  const list = systemPackage.listDisplays({getPrimaryDisplay: () => displays[1], getAllDisplays: () => displays});
  assert.deepEqual(list.map(d => [d.id, d.isPrimary, d.isInternal, d.name, d.dpiX, d.rotation, d.hasTouchSupport]),
    [['1', true, true, 'Built-in', 144, 0, true], ['2', false, false, 'Side', 96, 90, false]]);
  assert.deepEqual(list[0].bounds, {left: 0, top: 0, width: 1920, height: 1080});
  assert.deepEqual(list[0].workArea, {left: 0, top: 0, width: 1920, height: 1040});
  assert.deepEqual(list[0].overscan, {top: 0, left: 0, right: 0, bottom: 0});
  for (const key of ['id', 'name', 'mirroringSourceId', 'mirroringDestinationIds', 'isPrimary', 'isInternal', 'isEnabled', 'activeState', 'isUnified', 'dpiX', 'dpiY', 'rotation', 'bounds', 'overscan', 'workArea', 'modes', 'hasTouchSupport', 'availableDisplayZoomFactors', 'displayZoomFactor'])
    assert.ok(key in list[0], `DisplayUnitInfo.${key}`);
});

test('system.display (renderer): getInfo and onDisplayChanged, gated by the system.display permission', async () => {
  const none = extensionWorld({manifest_version: 3, permissions: ['system.cpu']}, {packages: mine(['system'])});
  assert.equal(none.chrome.system?.display, undefined);
  const world = extensionWorld({manifest_version: 3, permissions: ['system.display']}, {packages: mine(['system']),
    answer: name => (name === 'system.display.getInfo' ? [{id: '1', isPrimary: true}] : undefined)});
  const {chrome} = world;
  assert.deepEqual(plain(await chrome.system.display.getInfo()), [{id: '1', isPrimary: true}]);
  assert.deepEqual(plain(await chrome.system.display.getInfo({singleUnified: true})), [{id: '1', isPrimary: true}]);
  assert.throws(() => chrome.system.display.getInfo({wrong: 1}), {message: /Unexpected property: 'wrong'/});
  assert.equal(await new Promise(resolve => chrome.system.display.getInfo(list => resolve(list.length))), 1);
  let changes = 0;
  chrome.system.display.onDisplayChanged.addListener(() => { changes++; });
  world.emit('system.display.onDisplayChanged');
  assert.equal(changes, 1);
});

test('system.display (main): the package\'s handlers are installed behind the permission check', async () => {
  const {runtime, handlers, session} = fakeRuntime();
  const apis = installExtensionApis(runtime, {session, userData: os.tmpdir(), extApiDir: path.join(__dirname, '..', 'desktop', 'browser-services', 'ext-api')});
  const asked = await handlers.get('system.display.getInfo').callback({type: 'frame', extension: {id: ID, manifest: {manifest_version: 3, permissions: []}}});
  assert.deepEqual(asked, {__acira_error: 'Access to extension API denied.'});
  apis.dispose?.();
});
