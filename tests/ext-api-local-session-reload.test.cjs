'use strict';
// A service worker writes storage.local or storage.session and calls chrome.runtime.reload() at once. In Chrome the write is not lost: the two calls
// reach the browser in order. Here a worker's local / session write is a read of the old values first (to report what changed) and the write after it
// (trackWrites in ext-api/storage/sync-core.cjs), so the reload ended the worker before the write was issued and the data never reached the profile.
// storage.sync had the same shape and is covered by ext-api-reload-waits-for-storage.test.cjs; runtime.reload() now waits (2 seconds at most) for
// every write of this context that is still in flight. Runs the real patched preload in a VM (tests/fixtures/ext-api/world.cjs).
const test = require('node:test');
const assert = require('node:assert/strict');
const extApi = require('../desktop/browser-services/ext-api/index.cjs');
const {extensionWorld, ID} = require('./fixtures/ext-api/world.cjs');

const packages = () => extApi.loadPackages({fresh: true}).filter(p => p.name === 'storage' || p.name === 'runtime');
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)); };

/** The browser side as Chromium answers it: calls in order; after runtime.reload() the old worker's later calls never arrive. */
function browserSide() {
  const state = {areas: {local: new Map(), session: new Map()}, alive: true, reloads: []};
  const answer = (callback, value) => { if (typeof callback === 'function') queueMicrotask(() => state.alive && callback(value)); };
  const split = args => (typeof args[args.length - 1] === 'function' ? [args.slice(0, -1), args[args.length - 1]] : [args, undefined]);
  const make = data => ({
    get(...rest) {
      const [[keys], callback] = split(rest);
      if (!state.alive) return;
      const out = {};
      for (const key of typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : keys == null ? [...data.keys()] : Object.keys(keys)) if (data.has(key)) out[key] = JSON.parse(JSON.stringify(data.get(key)));
      answer(callback, out);
    },
    set(...rest) { const [[items], callback] = split(rest); if (!state.alive) return; for (const key of Object.keys(items)) data.set(key, JSON.parse(JSON.stringify(items[key]))); answer(callback, undefined); },
    remove(...rest) { const [[keys], callback] = split(rest); if (!state.alive) return; for (const key of [].concat(keys)) data.delete(key); answer(callback, undefined); },
    clear(...rest) { const [, callback] = split(rest); if (!state.alive) return; data.clear(); answer(callback, undefined); }
  });
  const listeners = new Set();
  const storage = {local: make(state.areas.local), session: make(state.areas.session), onChanged: {addListener: l => listeners.add(l), removeListener: l => listeners.delete(l), hasListener: l => listeners.has(l)}};
  const runtime = {id: ID, getManifest: () => ({manifest_version: 3, permissions: ['storage']}), reload: (...args) => { state.reloads.push({args, local: JSON.stringify([...state.areas.local]), session: JSON.stringify([...state.areas.session])}); state.alive = false; }};
  return {state, storage, runtime};
}

function worker(side) {
  side.state.alive = true;
  return extensionWorld({manifest_version: 3, name: 'Fixture', version: '1', permissions: ['storage']}, {packages: packages(), native: {storage: side.storage, runtime: side.runtime}, browser: {runtime: {id: ID}}}).chrome;
}

const seed = (side, area, entries) => { for (const [k, v] of Object.entries(entries)) side.state.areas[area].set(k, v); };
const stored = (side, area, at = 0) => new Map(JSON.parse(side.state.reloads[at][area]));

test('control: the browser side keeps a native write made right before reload (this is Chrome\'s behaviour)', async () => {
  const side = browserSide(); worker(side);
  side.storage.local.set({a: 1}); side.runtime.reload();
  assert.deepEqual([...stored(side, 'local')], [['a', 1]]);
});

for (const area of ['local', 'session']) {
  test(`storage.${area}.set() then runtime.reload(): the write is in the browser's storage when it reloads`, async () => {
    const side = browserSide(), chrome = worker(side);
    chrome.storage[area].set({mark: 123});
    chrome.runtime.reload();
    await settle();
    assert.equal(side.state.reloads.length, 1);
    assert.deepEqual(stored(side, area).get('mark'), 123, `the ${area} write was lost`);
  });

  test(`storage.${area}.remove() then runtime.reload()`, async () => {
    const side = browserSide(); seed(side, area, {mark: 1, other: 2});
    const chrome = worker(side);
    chrome.storage[area].remove('mark');
    chrome.runtime.reload();
    await settle();
    assert.equal(stored(side, area).has('mark'), false, `the ${area} removal was lost`);
    assert.equal(stored(side, area).get('other'), 2);
  });

  test(`storage.${area}.clear() then runtime.reload()`, async () => {
    const side = browserSide(); seed(side, area, {mark: 1, other: 2});
    const chrome = worker(side);
    chrome.storage[area].clear();
    chrome.runtime.reload();
    await settle();
    assert.equal(stored(side, area).size, 0, `the ${area} clear was lost`);
  });

  test(`storage.${area}.set(items, callback) then runtime.reload()`, async () => {
    const side = browserSide(), chrome = worker(side);
    chrome.storage[area].set({mark: 5}, () => undefined);
    chrome.runtime.reload();
    await settle();
    assert.equal(stored(side, area).get('mark'), 5, `the ${area} write was lost`);
  });
}

test('with nothing in flight reload is still the native call in the same turn (local)', async () => {
  const side = browserSide(), chrome = worker(side);
  await chrome.storage.local.set({done: 1}); await settle();
  chrome.runtime.reload();
  assert.equal(side.state.reloads.length, 1, 'immediately');
});

test('an extension page: storage.local.clear() then runtime.reload() waits for the clear (set and remove are the native calls there)', async () => {
  const side = browserSide(); seed(side, 'local', {mark: 1, other: 2});
  const chrome = extensionWorld({manifest_version: 3, name: 'Fixture', version: '1', permissions: ['storage']}, {worker: false, packages: packages(), native: {storage: side.storage, runtime: side.runtime}, browser: {runtime: {id: ID}}}).chrome;
  chrome.storage.local.clear();
  chrome.runtime.reload();
  assert.equal(side.state.reloads.length, 0, 'waiting for the clear');
  await settle();
  assert.equal(side.state.reloads.length, 1);
  assert.equal(stored(side, 'local').size, 0, 'the local clear was lost');
});
