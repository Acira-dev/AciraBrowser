'use strict';
// chrome.runtime.reload() waits for this context's own storage.sync writes (at most 2 seconds). HubSpot Sales 3.4 answers a 401 by writing
// storage.sync {'sales-extension-401-reload': now} and calling chrome.runtime.reload() at once; its 2 hour guard reads that mark. In Chrome the
// write is not lost. Here storage.sync is a read, then a write, so the write was only issued after the read answered, the reload ended the worker
// first, the mark never reached the profile's storage and the extension reloaded itself about every 2 seconds (90 times in 150 s), so its popup
// closed again within a second and never showed its own screen. Runs the real patched preload in a VM (tests/fixtures/ext-api/world.cjs).
const test = require('node:test');
const assert = require('node:assert/strict');
const extApi = require('../desktop/browser-services/ext-api/index.cjs');
const {extensionWorld, ID} = require('./fixtures/ext-api/world.cjs');

const packages = () => extApi.loadPackages({fresh: true}).filter(p => p.name === 'storage' || p.name === 'runtime');
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)); };
const MARK = 'sales-extension-401-reload';

/** The browser side: storage.local as Chromium answers it (callbacks, in order), and runtime.reload(), which ends the worker: after it
 *  nothing the old worker has not yet sent reaches the browser (a call issued later is dropped, as when its process is gone). */
function browserSide({hangReads = false} = {}) {
  const state = {data: new Map(), alive: true, reloads: [], hangReads};
  const answer = (callback, value) => { if (typeof callback === 'function') queueMicrotask(() => state.alive && callback(value)); };
  const split = args => (typeof args[args.length - 1] === 'function' ? [args.slice(0, -1), args[args.length - 1]] : [args, undefined]);
  const area = {
    get(...rest) {
      const [[keys], callback] = split(rest);
      if (!state.alive || state.hangReads) return;
      const out = {};
      for (const key of typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : keys == null ? [...state.data.keys()] : Object.keys(keys)) if (state.data.has(key)) out[key] = JSON.parse(JSON.stringify(state.data.get(key)));
      answer(callback, out);
    },
    set(...rest) {
      const [[items], callback] = split(rest);
      if (!state.alive) return;   // the worker is gone: this call never arrives
      for (const key of Object.keys(items)) state.data.set(key, JSON.parse(JSON.stringify(items[key])));
      answer(callback, undefined);
    },
    remove(...rest) { const [[keys], callback] = split(rest); if (!state.alive) return; for (const key of [].concat(keys)) state.data.delete(key); answer(callback, undefined); },
    clear(...rest) { const [, callback] = split(rest); if (!state.alive) return; state.data.clear(); answer(callback, undefined); }
  };
  const listeners = new Set();
  const storage = {local: area, session: {...area, get: area.get}, onChanged: {addListener: l => listeners.add(l), removeListener: l => listeners.delete(l), hasListener: l => listeners.has(l)}};
  const runtime = {id: ID, getManifest: () => ({manifest_version: 3, permissions: ['storage']}), reload: (...args) => { state.reloads.push({args, stored: JSON.stringify([...state.data])}); state.alive = false; }};
  return {state, storage, runtime};
}

/** A service worker of the extension, started over the browser side (a restart makes a new one over the same data). */
function worker(side) {
  side.state.alive = true;
  return extensionWorld({manifest_version: 3, name: 'Fixture', version: '1', permissions: ['storage']}, {packages: packages(), native: {storage: side.storage, runtime: side.runtime}, browser: {runtime: {id: ID}}}).chrome;
}

/** HubSpot Sales' guard, as its worker runs it on a 401: read the mark; without it write the mark and reload at once. */
async function onUnauthorized(chrome) {
  const found = await chrome.storage.sync.get(MARK);
  if (typeof found[MARK] === 'number') return 'cooldown';
  chrome.storage.sync.set({[MARK]: Date.now()});   // not awaited, as in HubSpot Sales
  chrome.runtime.reload();
  return 'reloaded';
}

test('a reload made right after storage.sync.set() waits for the write: the mark is stored, then the extension reloads once', async () => {
  const side = browserSide(), chrome = worker(side);
  chrome.storage.sync.set({mark: 123});
  chrome.runtime.reload();
  assert.equal(side.state.reloads.length, 0, 'not yet: the write is still in flight');
  await settle();
  assert.equal(side.state.reloads.length, 1, 'and then it reloads, once');
  const stored = new Map(JSON.parse(side.state.reloads[0].stored));
  assert.deepEqual(stored.get('__acira_sync__'), {mark: 123}, 'the write had reached the browser when it reloaded');
  const next = worker(side);   // the extension's next start sees it
  assert.deepEqual(JSON.parse(JSON.stringify(await next.storage.sync.get('mark'))), {mark: 123});
});

test('HubSpot Sales\' guard holds across restarts: one reload, then the 2 hour cooldown (13.6 reloaded at every start)', async () => {
  const side = browserSide(), results = [];
  for (let start = 0; start < 5; start++) { const chrome = worker(side); results.push(await onUnauthorized(chrome)); await settle(); }
  assert.deepEqual(results, ['reloaded', 'cooldown', 'cooldown', 'cooldown', 'cooldown']);
  assert.equal(side.state.reloads.length, 1);
  assert.equal(typeof new Map(JSON.parse(side.state.reloads[0].stored)).get('__acira_sync__')[MARK], 'number');
});

test('with nothing in flight reload is the native call in the same turn, with no delay; also once a write has finished', async () => {
  const side = browserSide(), chrome = worker(side);
  chrome.runtime.reload();
  assert.equal(side.state.reloads.length, 1, 'immediately');
  assert.deepEqual(side.state.reloads[0].args, []);
  const again = worker(side);
  await again.storage.sync.set({done: 1}); await settle();
  again.runtime.reload();
  assert.equal(side.state.reloads.length, 2, 'immediately, the write is already in');
});

test('remove() and clear() on storage.sync are waited for too', async () => {
  for (const act of [chrome => chrome.storage.sync.remove('mark'), chrome => chrome.storage.sync.clear()]) {
    const side = browserSide(), first = worker(side);
    await first.storage.sync.set({mark: 1}); await settle();
    const chrome = worker(side);
    act(chrome); chrome.runtime.reload();
    assert.equal(side.state.reloads.length, 0, 'waiting');
    await settle();
    assert.equal(side.state.reloads.length, 1);
    assert.equal(new Map(JSON.parse(side.state.reloads[0].stored)).has('__acira_sync__'), false, 'the removal was in when it reloaded');
  }
});

test('a write that fails does not hold the reload back', async () => {
  const side = browserSide(), chrome = worker(side);
  const failed = chrome.storage.sync.set({big: 'x'.repeat(9000)}).then(() => 'resolved', error => error.message);   // over QUOTA_BYTES_PER_ITEM
  chrome.runtime.reload();
  assert.equal(side.state.reloads.length, 0);
  await settle();
  assert.match(await failed, /QUOTA_BYTES_PER_ITEM/);
  assert.equal(side.state.reloads.length, 1);
});

test('the wait is capped at 2 seconds: a write that never finishes cannot keep the extension from reloading', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});   // the world captures setTimeout when it is made
  const side = browserSide({hangReads: true}), chrome = worker(side);
  chrome.storage.sync.set({mark: 1});
  chrome.runtime.reload();
  await settle();
  assert.equal(side.state.reloads.length, 0, 'waiting');
  t.mock.timers.tick(1999); await settle();
  assert.equal(side.state.reloads.length, 0, 'still waiting at 1999 ms');
  t.mock.timers.tick(1); await settle();
  assert.equal(side.state.reloads.length, 1, 'reloads at 2000 ms');
  t.mock.timers.tick(5000); await settle();
  assert.equal(side.state.reloads.length, 1, 'only once');
});

test('a reload that settles before the cap reloads once, not twice (the cap timer does not fire a second reload)', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const side = browserSide(), chrome = worker(side);
  chrome.storage.sync.set({mark: 1});
  chrome.runtime.reload();
  await settle();
  assert.equal(side.state.reloads.length, 1);
  t.mock.timers.tick(10000); await settle();
  assert.equal(side.state.reloads.length, 1);
});

test('arguments are not Chromium\'s: they go to the native call at once so Chromium refuses them itself', async () => {
  const side = browserSide(), chrome = worker(side);
  chrome.storage.sync.set({mark: 1});
  chrome.runtime.reload('x');
  assert.equal(side.state.reloads.length, 1);
  assert.deepEqual(side.state.reloads[0].args, ['x']);
});
