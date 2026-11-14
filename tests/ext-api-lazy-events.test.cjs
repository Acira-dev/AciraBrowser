'use strict';
// 13.8 (Calendly: the first press of its toolbar button was lost when it came before the extension's worker had registered its listener). Chromium never drops an event for a worker
// extension that registered a listener in an earlier run: it keeps the event names ("lazy listeners"), holds the event, starts the worker and sends it when the worker's first run has
// registered its listeners (extensions/browser/event_router.cc, extensions/browser/service_worker/service_worker_task_queue.cc). The engine under Acira knows only this run's listeners and
// dropped the event without a word. ext-api/events/lazy.cjs is the missing half; ext-api/index.cjs installEventGate puts it on the router's addListener / removeListener / sendEvent.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const extApi = require('../desktop/browser-services/ext-api/index.cjs');
// (loaded this way so that on the sources without the module the tests still run and fail on what they check, not all at once on the require)
let lazyModule = null;
try { lazyModule = require('../desktop/browser-services/ext-api/events/lazy.cjs'); } catch { /* 13.7 */ }
const {createLazyEvents, MAX_QUEUED, GRACE_MS, ABSOLUTE_MS, SETTLE_MS} = lazyModule || {createLazyEvents: null, MAX_QUEUED: 256, GRACE_MS: 1500, ABSOLUTE_MS: 20000, SETTLE_MS: 250};

const CALENDLY = 'abcdefghijklmnopabcdefghijklmnoa', PAGEEXT = 'abcdefghijklmnopabcdefghijklmnob';
const CLICK = 'browserAction.onClicked';
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'acira-lazy-'));
const worker = id => ({type: 'service-worker', extensionId: id});

/** The engine's ExtensionRouter reduced to what the gate touches (electron-chrome-extensions dist/cjs/index.js): sendEvent drops an event nobody listens to. */
function engineRouter() {
  const sent = [];
  return {
    listeners: new Map(), sent,
    addListener(listener, extensionId, eventName) {
      if (!this.listeners.has(eventName)) this.listeners.set(eventName, []);
      const list = this.listeners.get(eventName);
      if (!list.some(item => item.extensionId === extensionId && item.type === listener.type)) list.push(listener);
    },
    removeListener(listener, extensionId, eventName) {
      const list = this.listeners.get(eventName) || [], at = list.findIndex(item => item.extensionId === extensionId && item.type === listener.type);
      if (at >= 0) list.splice(at, 1);
      if (!list.length) this.listeners.delete(eventName);
    },
    sendEvent(target, eventName, ...args) {
      for (const listener of this.listeners.get(eventName) || []) { if (target && target !== listener.extensionId) continue; sent.push({to: listener.extensionId, name: eventName, args}); }
    },
    broadcastEvent(eventName, ...args) { this.sendEvent(undefined, eventName, ...args); }
  };
}
function rig({userData = tmp(), version = '5.0.0.0', startWorker, background = {service_worker: 'sw.js', type: 'module'}} = {}) {
  const extensions = {
    [CALENDLY]: {id: CALENDLY, manifest: {manifest_version: 3, name: 'Calendly', version, permissions: ['activeTab', 'storage'], background}},
    [PAGEEXT]: {id: PAGEEXT, manifest: {manifest_version: 2, name: 'Page', version: '1', permissions: [], background: {page: 'bg.html'}}}
  };
  const router = engineRouter(), started = [];
  const session = {serviceWorkers: {startWorkerForScope: startWorker || (async scope => { started.push(scope); return {}; })}};
  const logs = [];
  const make = () => extApi.installPackages({router, session, userData, storeKey: 'profile-one', getExtension: id => extensions[id] || null, permissions: {has: () => true, hasOrigin: () => true}, log: (...a) => logs.push(a.join(' '))}, {packages: []});
  return {router, session, started, logs, userData, extensions, install: make, installed: make()};
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test('a press before the worker registered its listener is held, the worker is started, and the event goes out once the listener exists and has settled (13.7 dropped it)', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const r = rig();
  r.router.addListener(worker(CALENDLY), CALENDLY, CLICK); r.router.listeners.clear();   // an earlier run registered onClicked (recorded); this run has not yet
  r.router.sendEvent(CALENDLY, CLICK, {id: 5, url: 'https://a.example/'});
  assert.deepEqual(r.router.sent, [], 'no listener yet: nothing sent, nothing lost');
  await flush();
  assert.deepEqual(r.started, ['chrome-extension://' + CALENDLY + '/'], 'the worker was started for it');
  r.router.sendEvent(CALENDLY, CLICK, {id: 5, url: 'https://a.example/', second: true});
  r.router.addListener(worker(CALENDLY), CALENDLY, CLICK);        // the worker's first run reaches addListener
  assert.deepEqual(r.router.sent, [], 'registered, but the extension sets its state up after registering: wait');
  r.router.sendEvent(CALENDLY, CLICK, {id: 5, third: true});        // a press while waiting goes behind the first two, not ahead of them
  t.mock.timers.tick(SETTLE_MS - 1);
  assert.deepEqual(r.router.sent, []);
  t.mock.timers.tick(1);
  assert.deepEqual(r.router.sent.map(entry => [entry.to, entry.name, entry.args[0].second ? 'second' : entry.args[0].third ? 'third' : 'first']), [[CALENDLY, CLICK, 'first'], [CALENDLY, CLICK, 'second'], [CALENDLY, CLICK, 'third']], 'every press, in the order they were made, to the extension that asked');
  r.router.sendEvent(CALENDLY, CLICK, {id: 5, later: true});
  assert.equal(r.router.sent.length, 4, 'afterwards events go straight through again');
});

test('only what a worker registered in an earlier run is held: an event nobody listened for, a page-based extension and a broadcast are never held', async () => {
  const r = rig();
  r.router.sendEvent(CALENDLY, CLICK, {id: 1});
  await flush();
  assert.deepEqual(r.started, [], 'a worker that never registered onClicked: nothing is held and nothing is started');
  r.router.addListener(worker(CALENDLY), CALENDLY, 'contextMenus.onClicked');
  r.router.listeners.clear();
  r.router.sendEvent(CALENDLY, CLICK, {id: 2});
  await flush();
  assert.deepEqual(r.started, [], 'it registered another event, not this one');
  r.router.addListener({type: 'frame', extensionId: PAGEEXT, host: {}}, PAGEEXT, CLICK);
  r.router.listeners.clear();
  r.router.sendEvent(PAGEEXT, CLICK, {id: 3});
  await flush();
  assert.deepEqual(r.started, [], 'an extension page registering a listener is not a worker');
  r.router.addListener(worker(CALENDLY), CALENDLY, CLICK); r.router.listeners.clear();
  r.router.broadcastEvent(CLICK, {id: 4});
  await flush();
  assert.deepEqual(r.started, [], 'an event for every extension is not held');
  assert.deepEqual(r.router.sent, []);
});

test('a listener that is registered when the event comes gets it at once, as before', () => {
  const r = rig();
  r.router.addListener(worker(CALENDLY), CALENDLY, CLICK);
  r.router.sendEvent(CALENDLY, CLICK, {id: 9});
  assert.equal(r.router.sent.length, 1);
  assert.deepEqual(r.started, []);
});

test('what the worker registered is kept for the next run (a record per profile) and starts a new router off with it; an update of the extension clears it; removing it forgets it', async () => {
  const first = rig();
  first.router.addListener(worker(CALENDLY), CALENDLY, CLICK);
  first.router.addListener(worker(CALENDLY), CALENDLY, 'contextMenus.onClicked');
  first.installed.dispose();   // writes the record
  const file = path.join(first.userData, 'extension-registered-events', 'profile-one.json');
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).extensions[CALENDLY], {v: '5.0.0.0', events: [CLICK, 'contextMenus.onClicked']});
  // the next run: a router with nothing registered yet
  const next = rig({userData: first.userData});
  next.router.sendEvent(CALENDLY, CLICK, {id: 1});
  await flush();
  assert.equal(next.started.length, 1, 'held and started because the earlier run registered it');
  next.router.addListener(worker(CALENDLY), CALENDLY, CLICK);
  await new Promise(resolve => setTimeout(resolve, SETTLE_MS + 60));
  assert.equal(next.router.sent.length, 1);
  // updated extension: its worker registers again before anything is held
  const updated = rig({userData: first.userData, version: '5.0.1.0'});
  updated.router.sendEvent(CALENDLY, CLICK, {id: 2});
  await flush();
  assert.deepEqual(updated.started, [], 'a new version has no recorded events');
  // removed
  const gone = rig({userData: first.userData});
  gone.installed.forget(CALENDLY);
  gone.router.sendEvent(CALENDLY, CLICK, {id: 3});
  await flush();
  assert.deepEqual(gone.started, [], 'a removed extension is forgotten');
  next.installed.dispose(); updated.installed.dispose(); gone.installed.dispose();
});

test('a worker that removes its last listener no longer wakes for the event', async () => {
  const r = rig();
  r.router.addListener(worker(CALENDLY), CALENDLY, CLICK);
  r.router.removeListener(worker(CALENDLY), CALENDLY, CLICK);
  r.router.sendEvent(CALENDLY, CLICK, {id: 1});
  await flush();
  assert.deepEqual(r.started, []);
  assert.deepEqual(r.installed.packages, []);
});

test('the wait ends and goes on: a worker that cannot be started at this moment (it is being registered at start-up) still gets the press when it registers; one that starts and registers nothing, and one that never answers, drop the held events', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const failing = rig({startWorker: async () => { throw new Error('Failed to start service worker.'); }});
  failing.router.addListener(worker(CALENDLY), CALENDLY, CLICK); failing.router.listeners.clear();
  failing.router.sendEvent(CALENDLY, CLICK, {id: 1});
  await flush();
  assert.match(failing.logs.join('\n'), /could not be started now \(Failed to start service worker\.\); waiting for its listener/);
  assert.deepEqual(failing.router.sent, []);
  failing.router.addListener(worker(CALENDLY), CALENDLY, CLICK);   // the worker registered 140 ms later (run 10 of the cold launches)
  t.mock.timers.tick(SETTLE_MS);
  assert.equal(failing.router.sent.length, 1, 'the press that came first is not lost');

  const silent = rig();
  silent.router.addListener(worker(CALENDLY), CALENDLY, CLICK); silent.router.listeners.clear();
  silent.router.sendEvent(CALENDLY, CLICK, {id: 2});
  await flush();
  t.mock.timers.tick(GRACE_MS + 1);
  assert.match(silent.logs.join('\n'), /dropped \(the worker started and registered no such listener\)/);
  silent.router.addListener(worker(CALENDLY), CALENDLY, CLICK);
  t.mock.timers.tick(SETTLE_MS);
  assert.deepEqual(silent.router.sent, [], 'a stale press is not sent when the listener appears much later');

  let release;
  const hung = rig({startWorker: () => new Promise(resolve => { release = resolve; })});
  hung.router.addListener(worker(CALENDLY), CALENDLY, CLICK); hung.router.listeners.clear();
  hung.router.sendEvent(CALENDLY, CLICK, {id: 3});
  await flush();
  t.mock.timers.tick(ABSOLUTE_MS + 1);
  assert.match(hung.logs.join('\n'), /dropped \(the worker did not register the listener in time\)/);
  release({});
});

test('what is held is bounded and in order; installing again (a private session, a second router) does not share the queue', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const r = rig();
  r.router.addListener(worker(CALENDLY), CALENDLY, CLICK); r.router.listeners.clear();
  for (let i = 0; i < MAX_QUEUED + 20; i++) r.router.sendEvent(CALENDLY, CLICK, {n: i});
  await flush();
  r.router.addListener(worker(CALENDLY), CALENDLY, CLICK);
  t.mock.timers.tick(SETTLE_MS);
  assert.equal(r.router.sent.length, MAX_QUEUED);
  assert.deepEqual(r.router.sent.slice(0, 3).map(entry => entry.args[0].n), [0, 1, 2], 'the first ones, in order');
  const other = rig();
  assert.deepEqual(other.router.sent, []);
});

test('createLazyEvents on its own: a record that cannot be read or written leaves everything working; a private session keeps its record in memory only', () => {
  assert.ok(createLazyEvents, 'the module exists');
  const dir = tmp();
  fs.mkdirSync(path.join(dir, 'extension-registered-events'), {recursive: true});
  fs.writeFileSync(path.join(dir, 'extension-registered-events', 'p.json'), '{not json');
  const sent = [], lazy = createLazyEvents({getExtension: id => ({id, manifest: {version: '1', background: {service_worker: 'sw.js'}}}), deliver: (...a) => sent.push(a), startWorker: async () => ({}), live: () => false, userData: dir, storeKey: 'p'});
  assert.deepEqual(lazy.registeredEvents(CALENDLY), [], 'a garbled record is an empty one');
  lazy.registered(CALENDLY, CLICK);
  assert.deepEqual(lazy.registeredEvents(CALENDLY), [CLICK]);
  lazy.dispose();
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'extension-registered-events', 'p.json'), 'utf8')).extensions[CALENDLY].events, [CLICK]);
  const priv = createLazyEvents({getExtension: id => ({id, manifest: {version: '1', background: {service_worker: 'sw.js'}}}), deliver() {}, startWorker: async () => ({}), live: () => false, userData: dir, storeKey: 'private-one', persist: false});
  priv.registered(CALENDLY, CLICK);
  priv.dispose();
  assert.equal(fs.existsSync(path.join(dir, 'extension-registered-events', 'private-one.json')), false, 'nothing of a private session is written');
});
