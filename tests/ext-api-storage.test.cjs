'use strict';
// chrome.storage (P3): sync is its own persisted area with Chrome's quotas and errors, managed is Chrome's empty read-only store,
// storage.onChanged reports the right areaName, storage.local stays the native area. Runs the real patched preload in a VM
// (tests/fixtures/ext-api/world.cjs) over a fake native storage that behaves like Chromium's (callbacks, promises, change events).
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const extApi = require('../desktop/browser-services/ext-api/index.cjs');
const {createStorageCore} = require('../desktop/browser-services/ext-api/storage/sync-core.cjs');
const {extensionWorld, plain, ID} = require('./fixtures/ext-api/world.cjs');

const packages = () => extApi.loadPackages({fresh: true}).filter(p => p.name === 'storage');
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

/** Chromium's storage.local as the preload sees it: callback and promise forms, change events on storage.onChanged. */
function fakeNative({world} = {}) {
  const data = new Map(), listeners = new Set(), session = new Map();
  const bytes = (key, value) => Buffer.byteLength(key) + Buffer.byteLength(JSON.stringify(value));
  const fire = (changes, area = 'local') => { if (Object.keys(changes).length) for (const listener of [...listeners]) listener(changes, area); };
  const answer = (callback, value) => { if (typeof callback === 'function') { queueMicrotask(() => callback(value)); return undefined; } return Promise.resolve(value); };
  const split = args => (typeof args[args.length - 1] === 'function' ? [args.slice(0, -1), args[args.length - 1]] : [args, undefined]);
  const makeArea = (data, areaName) => {
  const names = keys => (keys == null ? [...data.keys()] : typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys));
  return {
    QUOTA_BYTES: 10485760,
    get(...rest) {
      const [[keys], callback] = split(rest), out = {};
      for (const key of names(keys)) { if (data.has(key)) out[key] = JSON.parse(JSON.stringify(data.get(key))); else if (keys && typeof keys === 'object' && !Array.isArray(keys)) out[key] = keys[key]; }
      return answer(callback, out);
    },
    getKeys(...rest) { const [, callback] = split(rest); return answer(callback, [...data.keys()]); },
    getBytesInUse(...rest) { const [[keys], callback] = split(rest); let total = 0; for (const key of names(keys)) if (data.has(key)) total += bytes(key, data.get(key)); return answer(callback, total); },
    set(...rest) {
      const [[items], callback] = split(rest), changes = {};
      for (const key of Object.keys(items)) {
        const value = JSON.parse(JSON.stringify(items[key])), old = data.get(key);
        if (JSON.stringify(old) === JSON.stringify(value)) continue;
        changes[key] = old === undefined ? {newValue: value} : {oldValue: old, newValue: value};
        data.set(key, value);
      }
      fire(changes, areaName); return answer(callback, undefined);
    },
    remove(...rest) {
      const [[keys], callback] = split(rest), changes = {};
      for (const key of names(keys)) if (data.has(key)) { changes[key] = {oldValue: data.get(key)}; data.delete(key); }
      fire(changes, areaName); return answer(callback, undefined);
    },
    clear(...rest) {
      const [, callback] = split(rest), changes = {};
      for (const [key, value] of data) changes[key] = {oldValue: value};
      data.clear(); fire(changes, areaName); return answer(callback, undefined);
    },
    setAccessLevel(...rest) { return answer(split(rest)[1], undefined); }
  };
  };
  const local = makeArea(data, 'local');
  const root = {addListener: listener => listeners.add(listener), removeListener: listener => listeners.delete(listener), hasListener: listener => listeners.has(listener)};
  return {storage: {local, session: makeArea(session, 'session'), onChanged: root}, data, listeners, fire, session};
}

const setup = (manifest = {}, options = {}) => {
  const native = fakeNative();
  const world = extensionWorld({manifest_version: 3, permissions: ['storage'], ...manifest}, {packages: packages(), native: {storage: native.storage}, browser: {runtime: {id: ID}}, ...options});
  return {...native, world, storage: world.chrome.storage};
};

test('the package loads and builds chrome.storage: local and session native, sync / managed / onChanged Acira\'s', () => {
  const {storage, world} = setup();
  assert.deepEqual(Object.keys(storage).sort(), ['AccessLevel', 'local', 'managed', 'onChanged', 'session', 'sync']);
  assert.equal(storage.sync.QUOTA_BYTES, 102400);
  assert.equal(storage.sync.QUOTA_BYTES_PER_ITEM, 8192);
  assert.equal(storage.sync.MAX_ITEMS, 512);
  assert.equal(storage.sync.MAX_WRITE_OPERATIONS_PER_HOUR, 1800);
  assert.equal(storage.sync.MAX_WRITE_OPERATIONS_PER_MINUTE, 120);
  assert.equal(storage.local.QUOTA_BYTES, 10485760, 'the native local constants stay');
  assert.notEqual(storage.sync, storage.local);
  assert.equal(world.browser.storage.sync, storage.sync, 'browser.storage mirrors chrome.storage');
  for (const name of ['get', 'getKeys', 'getBytesInUse', 'set', 'remove', 'clear', 'setAccessLevel'])
    assert.equal(typeof storage.sync[name], 'function', name);
});

test('sync is its own area: round trip, defaults, remove, clear, getBytesInUse, and local never sees it', async () => {
  const {storage, data} = setup();
  await storage.sync.set({a: 1, nested: {b: [1, 2, {c: 'x'}]}});
  assert.deepEqual(plain(await storage.sync.get('a')), {a: 1});
  assert.deepEqual(plain(await storage.sync.get(['a', 'zzz'])), {a: 1});
  assert.deepEqual(plain(await storage.sync.get({a: 9, d: 'default'})), {a: 1, d: 'default'});
  assert.deepEqual(plain(await storage.sync.get(null)), {a: 1, nested: {b: [1, 2, {c: 'x'}]}});
  assert.deepEqual(plain(await storage.sync.get()), plain(await storage.sync.get(null)));
  assert.deepEqual(plain(await storage.sync.getKeys()), ['a', 'nested']);
  // key bytes + JSON bytes, as Chromium counts: "a"=1 + "1"=1; "nested" = 6 + {"b":[1,2,{"c":"x"}]} = 21
  assert.equal(await storage.sync.getBytesInUse('a'), 2);
  assert.equal(await storage.sync.getBytesInUse(['a', 'nested', 'missing']), 2 + 6 + JSON.stringify({b: [1, 2, {c: 'x'}]}).length);
  assert.equal(await storage.sync.getBytesInUse(null), 2 + 6 + 21);
  // local does not see sync data; local data does not show in sync
  assert.deepEqual(plain(await storage.local.get(null)), {});
  assert.deepEqual(plain(await storage.local.getKeys()), []);
  assert.equal(await storage.local.getBytesInUse(null), 0);
  await storage.local.set({l: 'local value'});
  assert.deepEqual(plain(await storage.local.get(null)), {l: 'local value'});
  assert.deepEqual(plain(await storage.sync.get(null)), {a: 1, nested: {b: [1, 2, {c: 'x'}]}});
  assert.equal(await storage.local.getBytesInUse(null), 1 + '"local value"'.length);
  assert.deepEqual(plain(await storage.local.get('l')), {l: 'local value'});
  assert.ok(data.has('__acira_sync__'), 'persisted in the extension\'s own store under one reserved key');
  // clearing local leaves sync; clearing sync leaves local
  await storage.local.clear();
  assert.deepEqual(plain(await storage.local.get(null)), {});
  assert.deepEqual(plain(await storage.sync.getKeys()), ['a', 'nested']);
  await storage.local.set({l2: true});
  await storage.sync.remove('a');
  assert.deepEqual(plain(await storage.sync.get(null)), {nested: {b: [1, 2, {c: 'x'}]}});
  await storage.sync.remove(['nested', 'not there']);
  await storage.sync.clear();
  assert.deepEqual(plain(await storage.sync.get(null)), {});
  assert.deepEqual(plain(await storage.local.get(null)), {l2: true});
  assert.equal(data.has('__acira_sync__'), false, 'an empty sync area leaves nothing behind');
});

test('callback forms and lastError behave like Chrome\'s bindings', async () => {
  const {storage, world} = setup();
  const seen = [];
  const done = new Promise(resolve => storage.sync.set({k: 'v'}, () => { seen.push(['set', world.chrome.runtime.lastError]); storage.sync.get('k', result => { seen.push(['get', plain(result)]); resolve(); }); }));
  await done;
  assert.deepEqual(seen, [['set', undefined], ['get', {k: 'v'}]]);
  const failed = await new Promise(resolve => {
    let returned = 'unset';
    returned = storage.sync.set({big: 'x'.repeat(9000)}, (...args) => resolve({args, error: world.chrome.runtime.lastError && world.chrome.runtime.lastError.message, returned}));
  });
  assert.deepEqual(failed.args, [], 'a failed call runs the callback without arguments');
  assert.equal(failed.error, 'QUOTA_BYTES_PER_ITEM quota exceeded');
  assert.equal(world.chrome.runtime.lastError, undefined, 'lastError is only set during the callback');
});

test('arguments are checked with Chromium\'s errors', () => {
  const {storage} = setup();
  assert.throws(() => storage.sync.get(5), /Error in invocation of storage\.get\(optional \[string\|array\|object\] keys, optional function callback\)/);
  assert.throws(() => storage.sync.set('nope'), /Error in invocation of storage\.set\(object items, optional function callback\)/);
  assert.throws(() => storage.sync.remove(), /Error in invocation of storage\.remove/);
  assert.throws(() => storage.managed.set(7), /Error in invocation of storage\.set/);
});

test('sync quotas: per item, total, number of items, with Chromium\'s messages; exact limits pass', async () => {
  const {storage} = setup();
  // an item of exactly 8192 bytes (key + JSON text) is fine, one more is not
  const exact = 'x'.repeat(8192 - 1 - 2);
  await storage.sync.set({a: exact});
  assert.equal(await storage.sync.getBytesInUse('a'), 8192);
  await assert.rejects(storage.sync.set({a: exact + 'y'}), /^Error: QUOTA_BYTES_PER_ITEM quota exceeded$/);
  assert.equal((await storage.sync.get('a')).a, exact, 'a refused write changes nothing');
  // total: 12 items of 8192 fill 98304; the 13th (8192) goes over 102400
  await storage.sync.clear();
  for (let i = 0; i < 12; i++) await storage.sync.set({['k' + String(i).padStart(2, '0')]: 'x'.repeat(8192 - 3 - 2)});
  assert.equal(await storage.sync.getBytesInUse(null), 12 * 8192);
  await assert.rejects(storage.sync.set({k12: 'x'.repeat(8192 - 3 - 2)}), /^Error: QUOTA_BYTES quota exceeded$/);
  // a multi-key set is checked as a whole
  await storage.sync.clear();
  await assert.rejects(storage.sync.set({a: 'ok', b: 'y'.repeat(9000)}), /QUOTA_BYTES_PER_ITEM/);
  assert.deepEqual(plain(await storage.sync.get(null)), {}, 'all or nothing');
  // number of items: 512 fit, the 513th does not (and an existing key can still be rewritten)
  const many = {};
  for (let i = 0; i < 512; i++) many['i' + i] = 1;
  await storage.sync.set(many);
  assert.equal((await storage.sync.getKeys()).length, 512);
  await assert.rejects(storage.sync.set({extra: 1}), /^Error: MAX_ITEMS quota exceeded$/);
  await storage.sync.set({i0: 2});
  assert.equal((await storage.sync.get('i0')).i0, 2);
  await storage.sync.remove('i1');
  await storage.sync.set({extra: 1});
  // the local area has no such limits
  await storage.local.set({big: 'z'.repeat(50000)});
  assert.equal((await storage.local.get('big')).big.length, 50000);
});

test('values are stored as JSON: undefined is dropped, functions and dates become what Chromium makes of them', async () => {
  const {storage} = setup();
  await storage.sync.set({u: undefined, n: null, t: true, s: 'é€😀', arr: [undefined, 1]});
  assert.deepEqual(plain(await storage.sync.get(null)), {n: null, t: true, s: 'é€😀', arr: [null, 1]});
  // UTF-8 bytes: key 's' 1 + '"é€😀"' = 2 + 2 + 3 + 4
  assert.equal(await storage.sync.getBytesInUse('s'), 1 + 2 + 2 + 3 + 4);
  await storage.sync.set(JSON.parse('{"__proto__": "own key"}'));
  assert.equal(Object.prototype.hasOwnProperty.call(await storage.sync.get(null), '__proto__'), true);
  assert.ok(JSON.stringify(await storage.sync.get(null)).includes('"__proto__":"own key"'), 'a "__proto__" key is data, not a prototype');
});

test('write rate limits: 120 per minute, with Chromium\'s message; reads and refused writes do not use the budget wrongly', async () => {
  const {storage} = setup();
  for (let i = 0; i < 120; i++) await storage.sync.set({['n' + (i % 3)]: i});
  await assert.rejects(storage.sync.set({x: 1}), /^Error: This request exceeds the MAX_WRITE_OPERATIONS_PER_MINUTE quota\.$/);
  await assert.rejects(storage.sync.remove('x'), /MAX_WRITE_OPERATIONS_PER_MINUTE/);
  await assert.rejects(storage.sync.clear(), /MAX_WRITE_OPERATIONS_PER_MINUTE/);
  assert.equal((await storage.sync.get('n0')).n0, 117, 'reads still work');
  await storage.local.set({fine: 1}); // the local area has no write limit
  // the limiter itself: windows reset (the hour limit is separate)
  const core = createStorageCore();
  let clock = 0;
  const limit = core.makeLimiter(() => clock);
  for (let i = 0; i < 120; i++) limit();
  assert.throws(limit, /MAX_WRITE_OPERATIONS_PER_MINUTE/);
  clock = 60000; for (let i = 0; i < 120; i++) limit();
  assert.throws(limit, /MAX_WRITE_OPERATIONS_PER_MINUTE/);
  const hourly = core.makeLimiter(() => clock);
  clock = 0;
  for (let minute = 0; minute < 15; minute++) { clock = minute * 60000; for (let i = 0; i < 120; i++) hourly(); }
  assert.throws(() => { clock = 15 * 60000; hourly(); }, /MAX_WRITE_OPERATIONS_PER_HOUR/);
  clock = 3600000; hourly();
});

test('storage.onChanged: areaName local / sync / session, oldValue / newValue, nothing for an unchanged value, area events', async () => {
  const {storage, fire} = setup({}, {worker: false});
  const root = [], syncOnly = [], localOnly = [];
  storage.onChanged.addListener((changes, areaName) => root.push([plain(changes), areaName]));
  storage.sync.onChanged.addListener(changes => syncOnly.push(plain(changes)));
  storage.local.onChanged.addListener(changes => localOnly.push(plain(changes)));
  await storage.sync.set({a: 1, b: 'two'});
  await storage.sync.set({a: 2, b: 'two'});       // only a changed
  await storage.sync.set({a: 2});                 // nothing changed: no event
  await storage.sync.remove(['b', 'missing']);
  await storage.local.set({l: 1});
  await storage.local.set({l: 1});                // unchanged
  await storage.local.remove('l');
  await storage.sync.clear();
  await storage.sync.clear();                     // nothing to clear
  fire({s: {newValue: 'only in session'}}, 'session'); // the native session area is passed through
  await tick();
  assert.deepEqual(root, [
    [{a: {newValue: 1}, b: {newValue: 'two'}}, 'sync'],
    [{a: {oldValue: 1, newValue: 2}}, 'sync'],
    [{b: {oldValue: 'two'}}, 'sync'],
    [{l: {newValue: 1}}, 'local'],
    [{l: {oldValue: 1}}, 'local'],
    [{a: {oldValue: 2}}, 'sync'],
    [{s: {newValue: 'only in session'}}, 'session']
  ]);
  assert.deepEqual(syncOnly, [{a: {newValue: 1}, b: {newValue: 'two'}}, {a: {oldValue: 1, newValue: 2}}, {b: {oldValue: 'two'}}, {a: {oldValue: 2}}]);
  assert.deepEqual(localOnly, [{l: {newValue: 1}}, {l: {oldValue: 1}}], 'the reserved key never shows as a local change');
});

test('events: a sync write from another context reaches this one (same native store), listeners can be removed, the native listener goes with the last one', async () => {
  const {storage, listeners, data} = setup({}, {worker: false});
  const heard = [];
  const listener = (changes, areaName) => heard.push([areaName, plain(changes)]);
  assert.equal(listeners.size, 0, 'nothing is subscribed until a listener exists');
  storage.onChanged.addListener(listener);
  storage.onChanged.addListener(listener);
  assert.equal(listeners.size, 1);
  assert.equal(storage.onChanged.hasListener(listener), true);
  // another page of the extension (or a content script) writes the reserved key into the shared native store
  const other = setup();
  await other.storage.sync.set({fromOther: 1});
  const written = other.data.get('__acira_sync__');
  data.set('__acira_sync__', written);
  setup().fire; // (no-op: different fake)
  for (const l of listeners) l({__acira_sync__: {newValue: written}}, 'local');
  assert.deepEqual(heard, [['sync', {fromOther: {newValue: 1}}]]);
  storage.onChanged.removeListener(listener);
  assert.equal(listeners.size, 0);
  assert.equal(storage.onChanged.hasListeners(), false);
});

test('managed: Chrome\'s read-only policy store; an extension without storage.managed_schema gets Chrome\'s error', async () => {
  const bare = setup();
  for (const [name, args] of [['get', [null]], ['getKeys', []], ['getBytesInUse', [null]], ['set', [{a: 1}]], ['remove', ['a']], ['clear', []]])
    await assert.rejects(bare.storage.managed[name](...args), /^Error: Managed storage manifest not found$/, name);
  const withSchema = setup({storage: {managed_schema: 'schema.json'}});
  const managed = withSchema.storage.managed;
  assert.deepEqual(plain(await managed.get(null)), {});
  assert.deepEqual(plain(await managed.get(['a'])), {});
  assert.deepEqual(plain(await managed.get({a: 1, b: 'x'})), {a: 1, b: 'x'});
  assert.deepEqual(plain(await managed.getKeys()), []);
  assert.equal(await managed.getBytesInUse(null), 0);
  for (const [name, args] of [['set', [{a: 1}]], ['remove', ['a']], ['clear', []]])
    await assert.rejects(managed[name](...args), /^Error: This is a read-only store\.$/, name);
  withSchema.storage.local.set({a: 'local'});
  assert.deepEqual(plain(await managed.get(null)), {}, 'managed no longer aliases local');
  const seen = await new Promise(resolve => managed.set({a: 1}, (...args) => resolve({args, error: withSchema.world.chrome.runtime.lastError && withSchema.world.chrome.runtime.lastError.message})));
  assert.deepEqual(seen, {args: [], error: 'This is a read-only store.'});
});

test('storage.local stays the native area: promise and callback forms, native constants, values', async () => {
  const {storage} = setup();
  await storage.local.set({x: 1, y: [1, 2]});
  assert.deepEqual(plain(await storage.local.get(['x', 'y'])), {x: 1, y: [1, 2]});
  assert.deepEqual(plain(await new Promise(resolve => storage.local.get(null, resolve))), {x: 1, y: [1, 2]});
  assert.deepEqual(plain(await new Promise(resolve => storage.local.get(resolve))), {x: 1, y: [1, 2]});
  assert.equal(await new Promise(resolve => storage.local.getBytesInUse(null, resolve)), 1 + 1 + 1 + 5);
  await new Promise(resolve => storage.local.clear(resolve));
  assert.deepEqual(plain(await storage.local.get(null)), {});
  await storage.local.remove('never');
  assert.deepEqual(plain(await storage.local.getKeys()), []);
});

test('a worker and a page both get it; an extension without the storage permission has no chrome.storage', () => {
  for (const worker of [true, false]) assert.equal(typeof setup({}, {worker}).storage.sync.get, 'function');
  const none = extensionWorld({manifest_version: 3, permissions: []}, {packages: packages(), native: {storage: fakeNative().storage}});
  assert.equal(none.chrome.storage, undefined);
});

test('the content-script shim: same reserved key, Chrome\'s quotas, local hidden, sync changes on storage.onChanged', async () => {
  const native = fakeNative();
  const chrome = {storage: native.storage, runtime: {}};
  const context = vm.createContext({chrome, self: null, console, Promise, Proxy, Reflect, queueMicrotask, Object, JSON, Array, Error});
  context.self = context;
  const {SHIM_SOURCE} = require('../desktop/browser-services/extension-shims.cjs');
  vm.runInContext(SHIM_SOURCE, context);
  const storage = context.chrome.storage;
  assert.equal(storage.sync.__acira, true);
  const heard = [];
  storage.onChanged.addListener((changes, areaName) => heard.push([plain(changes), areaName]));
  await storage.sync.set({fromCs: 1});
  await storage.local.set({l: 1});
  assert.deepEqual(plain(await storage.sync.get(null)), {fromCs: 1});
  assert.deepEqual(plain(await storage.local.get(null)), {l: 1});
  assert.deepEqual(heard, [[{fromCs: {newValue: 1}}, 'sync'], [{l: {newValue: 1}}, 'local']]);
  await assert.rejects(storage.sync.set({huge: 'x'.repeat(9000)}), /QUOTA_BYTES_PER_ITEM quota exceeded/);
  await storage.local.clear();
  assert.deepEqual(plain(await storage.sync.get(null)), {fromCs: 1}, 'clearing local keeps sync');
  // a page of the same extension reads what the content script wrote
  const page = setup();
  page.data.set('__acira_sync__', native.data.get('__acira_sync__'));
  assert.deepEqual(plain(await page.storage.sync.get(null)), {fromCs: 1});
  assert.equal(storage.sync.QUOTA_BYTES, 102400);
});

test('service worker: storage.onChanged comes from the main process relay (Chromium never delivers it to a worker); pages forward what they hear', async () => {
  const worker = setup({}, {worker: true});
  const heard = [];
  worker.storage.onChanged.addListener((changes, areaName) => heard.push([plain(changes), areaName]));
  const syncHeard = [];
  worker.storage.sync.onChanged.addListener(changes => syncHeard.push(plain(changes)));
  assert.equal(worker.listeners.size, 0, 'a worker does not subscribe to the native event');
  worker.world.emit('storage.relay', {a: {newValue: 1}}, 'local');
  worker.world.emit('storage.relay', {__acira_sync__: {oldValue: {x: 1}, newValue: {x: 2, y: 3}}}, 'local');
  worker.world.emit('storage.relay', {s: {newValue: 's'}}, 'session');
  assert.deepEqual(heard, [[{a: {newValue: 1}}, 'local'], [{x: {oldValue: 1, newValue: 2}, y: {newValue: 3}}, 'sync'], [{s: {newValue: 's'}}, 'session']]);
  assert.deepEqual(syncHeard, [{x: {oldValue: 1, newValue: 2}, y: {newValue: 3}}]);
  assert.ok(worker.world.calls.some(call => call.name === 'storage.forward') === false, 'a worker forwards nothing');
  // a page of an extension with a service worker forwards every change it hears (the reserved sync key included, raw)
  const page = setup({background: {service_worker: 'sw.js'}}, {worker: false});
  page.fire({k: {newValue: 1}}, 'local');
  page.fire({__acira_sync__: {newValue: {z: 1}}}, 'local');
  await tick();
  assert.deepEqual(page.world.calls.filter(call => call.name === 'storage.forward').map(call => plain(call.args)), [['local', {k: {newValue: 1}}], ['local', {__acira_sync__: {newValue: {z: 1}}}]]);
  // pages of an extension without a service worker have nobody to forward to
  const plainPage = setup({}, {worker: false});
  plainPage.fire({k: {newValue: 1}}, 'local');
  await tick();
  assert.equal(plainPage.world.calls.some(call => call.name === 'storage.forward'), false);
});

test('main side: the relay goes to workers that listen, and a change two pages both forward is delivered once', () => {
  const sent = [], listening = new Set([ID]);
  const handlers = new Map();
  const api = {handle: (name, fn) => handlers.set(name, fn), listening: () => [...listening], emit: (id, name, ...args) => sent.push([id, name, ...args])};
  const pkg = require('../desktop/browser-services/ext-api/storage.cjs');
  const result = pkg.install(api);
  const forward = handlers.get('storage.forward');
  const from = id => ({extension: {id: ID}, sender: {id}});
  forward(from(1), 'local', {a: {newValue: 1}});
  forward(from(2), 'local', {a: {newValue: 1}});            // the same change from a second page: dropped
  forward(from(2), 'local', {b: {newValue: 2}});            // another change
  forward(from(1), 'sync', {a: {newValue: 1}});             // same key, other area
  listening.clear();
  forward(from(1), 'local', {c: {newValue: 3}});            // nobody listens: nothing is sent
  forward(from(1), 'local', 'not changes');
  assert.deepEqual(sent, [[ID, 'storage.relay', {a: {newValue: 1}}, 'local'], [ID, 'storage.relay', {b: {newValue: 2}}, 'local'], [ID, 'storage.relay', {a: {newValue: 1}}, 'sync']]);
  result.forget(ID);
});

test('a Manifest V2 extension (background page): sync area, quotas, native events on the page, callbacks', async () => {
  const mv2 = setup({manifest_version: 2, background: {scripts: ['bg.js']}}, {worker: false});
  const heard = [];
  mv2.storage.onChanged.addListener((changes, areaName) => heard.push([areaName, Object.keys(changes)]));
  await new Promise(resolve => mv2.storage.sync.set({a: 1}, resolve));
  const got = await new Promise(resolve => mv2.storage.sync.get('a', resolve));
  assert.deepEqual(plain(got), {a: 1});
  await assert.rejects(mv2.storage.sync.set({big: 'x'.repeat(9000)}), /QUOTA_BYTES_PER_ITEM/);
  await tick();
  assert.deepEqual(heard, [['sync', ['a']]]);
  assert.equal(mv2.world.calls.some(call => call.name === 'storage.forward'), false, 'no service worker, nothing to forward to');
});

// ------------------------------------------------------------------------------------------------ a service worker with no extension page open

const runtimeFake = manifest => {
  const listeners = [];
  return {listeners, runtime: {id: ID, getManifest: () => manifest, connect() {}, sendMessage() {}, getURL: path => path, onMessage: {addListener: fn => listeners.push(fn), removeListener: fn => { const at = listeners.indexOf(fn); if (at >= 0) listeners.splice(at, 1); }, hasListener: fn => listeners.includes(fn)}}};
};
const workerWorld = (manifest = {}) => {
  const native = fakeNative(), full = {manifest_version: 3, permissions: ['storage'], background: {service_worker: 'sw.js'}, ...manifest}, rt = runtimeFake(full);
  const world = extensionWorld(full, {packages: packages(), native: {storage: native.storage, runtime: rt.runtime}, browser: {runtime: {id: ID}}, worker: true});
  return {...native, rt, world, storage: world.chrome.storage};
};

test('service worker, no page open: its own writes reach its listeners on every area, once, with the right areaName and old values', async () => {
  const {storage, world} = workerWorld();
  const root = [], localArea = [], syncArea = [], sessionArea = [];
  storage.onChanged.addListener((changes, areaName) => root.push([areaName, plain(changes)]));
  storage.local.onChanged.addListener(changes => localArea.push(plain(changes)));
  storage.sync.onChanged.addListener(changes => syncArea.push(plain(changes)));
  storage.session.onChanged.addListener(changes => sessionArea.push(plain(changes)));
  await storage.local.set({a: 1, b: 'x'});
  await storage.local.set({a: 1});                         // unchanged: nothing
  await storage.local.set({a: 2});
  await storage.local.remove(['b', 'missing']);
  await new Promise(resolve => storage.local.set({cb: true}, resolve));   // callback form
  await storage.local.clear();
  await storage.sync.set({s: 1});
  await storage.sync.set({s: 1, t: [1]});
  await storage.sync.remove('s');
  await storage.sync.clear();
  await storage.session.set({k: 'v'});
  await storage.session.remove('k');
  await storage.session.set({k1: 1, k2: 2});
  await storage.session.clear();
  assert.deepEqual(root, [
    ['local', {a: {newValue: 1}, b: {newValue: 'x'}}],
    ['local', {a: {oldValue: 1, newValue: 2}}],
    ['local', {b: {oldValue: 'x'}}],
    ['local', {cb: {newValue: true}}],
    ['local', {a: {oldValue: 2}, cb: {oldValue: true}}],
    ['sync', {s: {newValue: 1}}],
    ['sync', {t: {newValue: [1]}}],
    ['sync', {s: {oldValue: 1}}],
    ['sync', {t: {oldValue: [1]}}],
    ['session', {k: {newValue: 'v'}}],
    ['session', {k: {oldValue: 'v'}}],
    ['session', {k1: {newValue: 1}, k2: {newValue: 2}}],
    ['session', {k1: {oldValue: 1}, k2: {oldValue: 2}}]
  ]);
  assert.equal(localArea.length, 5);
  assert.equal(syncArea.length, 4);
  assert.equal(sessionArea.length, 4);
  // the same change told again by the main process' relay (a page heard it) or by a content script is not delivered twice
  await storage.local.set({e: 1});
  const before = root.length;
  world.emit('storage.relay', {e: {newValue: 1}}, 'local');
  await storage.sync.set({q: 1});
  world.emit('storage.relay', {__acira_sync__: {newValue: {q: 1}}}, 'local');
  await storage.session.set({r: 1});
  world.emit('storage.relay', {r: {newValue: 1}}, 'session');
  assert.equal(root.length, before + 2, 'sync q and session r once each; the repeats of e, q and r from the relay were dropped');
  // a change nobody here made, told by the relay, is delivered
  world.emit('storage.relay', {e: {oldValue: 1, newValue: 2}}, 'local');
  assert.deepEqual(root.at(-1), ['local', {e: {oldValue: 1, newValue: 2}}]);
  // Chromium's argument errors stay synchronous
  assert.throws(() => storage.local.set(5), /Error in invocation of storage\.set\(object items, optional function callback\)/);
  assert.throws(() => storage.session.remove(), /Error in invocation of storage\.remove/);
  assert.throws(() => storage.local.clear('x'), /Error in invocation of storage\.clear/);
});

test('service worker: a content script\'s message brings its change; the answer says whether anyone listens; a repeat from another tab or the relay is dropped', async () => {
  const {storage, rt, world} = workerWorld();
  assert.equal(rt.listeners.length, 0, 'no listener, no inbox');
  const heard = [];
  const listener = (changes, areaName) => heard.push([areaName, plain(changes)]);
  storage.onChanged.addListener(listener);
  assert.equal(rt.listeners.length, 1, 'the inbox is the worker\'s onMessage listener');
  assert.equal(rt.listeners[0].__acira, true);
  const inbox = rt.listeners[0], replies = [];
  const send = (message, sender) => inbox(message, sender, reply => replies.push(plain(reply)));
  const changes = {x: {newValue: 1}};
  assert.equal(send({__acira_storage: {area: 'local', changes}}, {tab: {id: 7}, frameId: 0}), false);
  assert.deepEqual(heard, [['local', changes]]);
  assert.deepEqual(replies, [{listening: true}]);
  send({__acira_storage: {area: 'local', changes: {x: {newValue: 1}}}}, {tab: {id: 8}, frameId: 0});   // a second tab heard the same
  world.emit('storage.relay', {x: {newValue: 1}}, 'local');                                           // a page heard it too
  assert.equal(heard.length, 1);
  assert.equal(replies.length, 2);
  send({__acira_storage: {area: 'local', changes: {x: {oldValue: 1, newValue: 2}}}}, {tab: {id: 7}, frameId: 0});   // a later, different change
  assert.equal(heard.length, 2);
  assert.equal(send({hello: 'not ours'}, {tab: {id: 7}}), false);
  assert.equal(send(null, {}), false);
  assert.equal(replies.length, 3, 'only its own messages are answered');
  send({__acira_storage: {area: 'local', changes: 'nope'}}, {});
  assert.equal(heard.length, 2, 'a malformed message is ignored (still answered)');
  storage.onChanged.removeListener(listener);
  assert.equal(rt.listeners.length, 0, 'no listener left, no inbox');
});

test('content-script shim: tells the worker what it hears, once per change, and goes quiet when the worker has no listener or does not answer', async () => {
  const native = fakeNative();
  const sent = [];
  let reply = {listening: true}, failure = null;
  const chrome = {
    storage: native.storage,
    runtime: {get lastError() { return failure; }, getManifest: () => ({background: {service_worker: 'sw.js'}}), sendMessage(message, callback) { sent.push(plain(message)); callback(reply); }}
  };
  const context = vm.createContext({chrome, self: null, console, Promise, Proxy, Reflect, queueMicrotask, Object, JSON, Array, Error, Date});
  context.self = context;
  const {SHIM_SOURCE} = require('../desktop/browser-services/extension-shims.cjs');
  vm.runInContext(SHIM_SOURCE, context);
  native.fire({k: {newValue: 1}}, 'local');
  assert.deepEqual(sent, [{__acira_storage: {area: 'local', changes: {k: {newValue: 1}}}}]);
  native.fire({__acira_sync__: {newValue: {a: 1}}}, 'local');
  assert.equal(sent.length, 2, 'the sync table travels raw, the worker splits it');
  reply = {listening: false};
  native.fire({k: {oldValue: 1, newValue: 2}}, 'local');
  assert.equal(sent.length, 3);
  native.fire({k: {oldValue: 2, newValue: 3}}, 'local');
  assert.equal(sent.length, 3, 'the worker said nobody listens: quiet for a while');
  // no service worker in the manifest, or a frame that is not the top one: nothing is sent
  for (const [manifest, win] of [[{}, undefined], [{background: {service_worker: 'sw.js'}}, {top: {}}]]) {
    const other = fakeNative(), log = [];
    const cs = vm.createContext({chrome: {storage: other.storage, runtime: {lastError: null, getManifest: () => manifest, sendMessage: (m, cb) => { log.push(m); cb({listening: true}); }}}, window: win, self: null, console, Promise, Proxy, Reflect, queueMicrotask, Object, JSON, Array, Error, Date});
    cs.self = cs;
    vm.runInContext(SHIM_SOURCE, cs);
    other.fire({z: {newValue: 1}}, 'local');
    assert.equal(log.length, 0);
  }
  // a worker that cannot answer (asleep without a listener): quiet for a few seconds too
  failure = {message: 'Could not establish connection. Receiving end does not exist.'};
  reply = undefined;
  const fresh = fakeNative(), log2 = [];
  const cs2 = vm.createContext({chrome: {storage: fresh.storage, runtime: {get lastError() { return failure; }, getManifest: () => ({background: {service_worker: 'sw.js'}}), sendMessage: (m, cb) => { log2.push(m); cb(undefined); }}}, self: null, console, Promise, Proxy, Reflect, queueMicrotask, Object, JSON, Array, Error, Date});
  cs2.self = cs2;
  vm.runInContext(SHIM_SOURCE, cs2);
  fresh.fire({z: {newValue: 1}}, 'local');
  fresh.fire({z: {newValue: 2}}, 'local');
  assert.equal(log2.length, 1);
});
