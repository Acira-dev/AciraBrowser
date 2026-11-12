'use strict';
// chrome.storage.sync, managed and the guard around storage.local, shared by the package for extension pages and service workers
// (ext-api/storage-renderer.cjs) and by the content-script shim (extension-shims.cjs).
//
// Where sync lives. Electron has no sync backend: Chromium answers "'sync' is not available in this instance of Chrome" and the engine used
// to point storage.sync at storage.local (one shared set of keys, local quotas, areaName "sync" never reported). Now sync is its own area
// with Chrome's quotas and errors. Its data is ONE reserved key inside the extension's own native local store (KEY below), so every context
// that can read storage.local (pages, workers AND content scripts, which cannot reach Acira's main process) sees the same sync data, it
// persists and is removed with the extension, and native onChanged reaches every context. The guard hides that key from storage.local
// (get(null), getKeys, getBytesInUse(null), clear, onChanged), so the two areas behave as separate stores. There is no cross-device sync.
//
// Everything is inside createStorageCore(): the function is copied as text into the preload and into the shim, so it must not use anything
// outside itself except the page's own globals (navigator.locks, console, JSON, Promise, Object, ...).
function createStorageCore() {
  const KEY = '__acira_sync__';
  // storage.json (Chromium 152) sync constants; the quotas are enforced exactly as Chromium's settings_storage_quota_enforcer.cc does.
  const LIMITS = {
    QUOTA_BYTES: 102400, QUOTA_BYTES_PER_ITEM: 8192, MAX_ITEMS: 512,
    MAX_WRITE_OPERATIONS_PER_HOUR: 1800, MAX_WRITE_OPERATIONS_PER_MINUTE: 120, MAX_SUSTAINED_WRITE_OPERATIONS_PER_MINUTE: 1000000
  };
  const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const isThenable = value => !!value && typeof value.then === 'function';
  const put = (object, key, value) => { Object.defineProperty(object, key, {value, enumerable: true, configurable: true, writable: true}); return object; };
  const utf8 = text => {
    let bytes = 0;
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (code < 0x80) bytes += 1;
      else if (code < 0x800) bytes += 2;
      else if (code >= 0xd800 && code < 0xdc00 && i + 1 < text.length && (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00) { bytes += 4; i++; }
      else bytes += 3;
    }
    return bytes;
  };
  // Chromium measures an item as the key's bytes plus the bytes of the value's JSON text.
  const itemBytes = (key, value) => utf8(key) + utf8(JSON.stringify(value));
  const copy = value => { if (value === undefined) return undefined; const text = JSON.stringify(value); return text === undefined ? undefined : JSON.parse(text); };
  const same = (a, b) => {
    if (a === b) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
    const ka = Object.keys(a), kb = Object.keys(b);
    return ka.length === kb.length && ka.every(key => has(b, key) && same(a[key], b[key]));
  };
  const table = raw => (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {});
  const clone = stored => { const out = Object.create(null); for (const key of Object.keys(stored)) out[key] = stored[key]; return out; };
  const listOf = keys => (typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : []);
  const popCallback = args => (typeof args[args.length - 1] === 'function' ? args.pop() : null);

  /** storage.<area>.get(keys): null / undefined = everything, a string or array = those keys, an object = those keys with defaults. */
  const pick = (stored, keys) => {
    const out = {};
    if (keys === null || keys === undefined) { for (const key of Object.keys(stored)) put(out, key, copy(stored[key])); return out; }
    if (typeof keys === 'string' || Array.isArray(keys)) { for (const key of listOf(keys)) if (has(stored, key)) put(out, key, copy(stored[key])); return out; }
    for (const key of Object.keys(keys)) { const value = copy(has(stored, key) ? stored[key] : keys[key]); if (value !== undefined) put(out, key, value); }
    return out;
  };
  const bytesIn = (stored, keys) => {
    let total = 0;
    for (const key of (keys === null || keys === undefined ? Object.keys(stored) : listOf(keys))) if (has(stored, key)) total += itemBytes(key, stored[key]);
    return total;
  };
  const changeOf = (before, after) => { const out = {}; if (before !== undefined) out.oldValue = before; if (after !== undefined) out.newValue = after; return out; };
  /** {key: {oldValue?, newValue?}} between two stored tables (a value that is equal is no change, as in Chromium's ValueStore). */
  const diff = (before, after) => {
    const out = {};
    for (const key of Object.keys(before)) { if (!has(after, key)) put(out, key, changeOf(copy(before[key]))); else if (!same(before[key], after[key])) put(out, key, changeOf(copy(before[key]), copy(after[key]))); }
    for (const key of Object.keys(after)) if (!has(before, key)) put(out, key, changeOf(undefined, copy(after[key])));
    return out;
  };
  const quotaError = name => new Error(name + ' quota exceeded');
  /** The table after set(items) and the changes; throws Chromium's quota errors (per item, then total, then number of items). */
  const applySet = (stored, items) => {
    const next = clone(stored);
    for (const key of Object.keys(items)) {
      const value = copy(items[key]);
      if (value === undefined) continue; // an undefined value is dropped when the call crosses into the browser
      if (itemBytes(key, value) > LIMITS.QUOTA_BYTES_PER_ITEM) throw quotaError('QUOTA_BYTES_PER_ITEM');
      next[key] = value;
    }
    if (bytesIn(next) > LIMITS.QUOTA_BYTES) throw quotaError('QUOTA_BYTES');
    if (Object.keys(next).length > LIMITS.MAX_ITEMS) throw quotaError('MAX_ITEMS');
    return {next, before: stored, changes: diff(stored, next)};
  };
  const applyRemove = (stored, keys) => {
    const next = clone(stored);
    for (const key of listOf(keys)) delete next[key];
    return {next, before: stored, changes: diff(stored, next)};
  };
  // A stable text for a set of changes (key order does not matter): two contexts that heard the same change make the same text.
  const canon = value => {
    if (value === null || typeof value !== 'object') return String(JSON.stringify(value));
    if (Array.isArray(value)) return '[' + value.map(canon).join(',') + ']';
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canon(value[key])).join(',') + '}';
  };
  /** Chromium's write limits for sync (QuotaLimitHeuristic): fixed windows, one token per set / remove / clear, charged before the call runs. */
  const makeLimiter = (now = () => Date.now()) => {
    const windows = [['MAX_WRITE_OPERATIONS_PER_MINUTE', LIMITS.MAX_WRITE_OPERATIONS_PER_MINUTE, 60000], ['MAX_WRITE_OPERATIONS_PER_HOUR', LIMITS.MAX_WRITE_OPERATIONS_PER_HOUR, 3600000]]
      .map(([name, max, ms]) => ({name, max, ms, start: -Infinity, count: 0}));
    return () => {
      const at = now();
      for (const w of windows) if (at - w.start >= w.ms) { w.start = at; w.count = 0; }
      for (const w of windows) if (w.count >= w.max) throw new Error('This request exceeds the ' + w.name + ' quota.');
      for (const w of windows) w.count += 1;
    };
  };

  /** A promise over a native storage.local call (callback form, which every manifest version supports). */
  const makeCall = (local, lastError) => (name, ...args) => new Promise((resolve, reject) => {
    try { local[name](...args, result => { const error = lastError(); if (error) reject(new Error(error.message)); else resolve(result); }); }
    catch (error) { reject(error); }
  });

  /** The sync area: async get / getKeys / getBytesInUse / set / remove / clear over the reserved key. io: {call, lock?, now?}. */
  const createArea = io => {
    const lock = io.lock || (run => run());
    const limit = makeLimiter(io.now);
    const read = () => io.call('get', KEY).then(result => table(result && has(result, KEY) ? result[KEY] : undefined));
    // io.notify(changes, 'local'): a context that Chromium gives no storage.onChanged for its own writes (a service worker) is told what it changed.
    const write = (next, before) => {
      const job = Object.keys(next).length ? io.call('set', put({}, KEY, JSON.parse(JSON.stringify(next)))) : io.call('remove', KEY);
      if (!io.notify) return job;
      return job.then(result => {
        io.notify(put({}, KEY, changeOf(Object.keys(before).length ? copy(before) : undefined, Object.keys(next).length ? copy(next) : undefined)), 'local');
        return result;
      });
    };
    const writing = plan => {
      try { limit(); } catch (error) { return Promise.reject(error); }
      const job = Promise.resolve(lock(() => read().then(stored => plan(stored))));
      if (io.track) io.track(job);   // the write is issued after the read answers: a context that reloads itself right after set() must wait for it (runtime-renderer.cjs)
      return job;
    };
    const save = done => (Object.keys(done.changes).length ? write(done.next, done.before) : undefined);
    return {
      get: keys => read().then(stored => pick(stored, keys)),
      getKeys: () => read().then(stored => Object.keys(stored)),
      getBytesInUse: keys => read().then(stored => bytesIn(stored, keys)),
      set: items => writing(stored => save(applySet(stored, table(items)))),
      remove: keys => writing(stored => save(applyRemove(stored, keys))),
      clear: () => writing(stored => (Object.keys(stored).length ? write(Object.create(null), stored) : undefined))
    };
  };

  /**
   * Writes through a native area (local, session) that say what they changed: env.notify(changes, areaName). A service worker is given no
   * storage.onChanged by Chromium, not even for its own writes, so its wrapper reads the old values of the keys first (the call itself is made
   * exactly as the caller made it; Chromium's argument errors come from env.validate first). `hidden` is a key the caller must not see (sync's).
   */
  const trackWrites = (area, areaName, env, hidden) => {
    const call = makeCall(area, env.lastError);
    const visible = key => key !== hidden;
    const finish = (job, callback) => {
      const settled = job.then(() => undefined);
      if (env.track) env.track(settled);   // runtime.reload() waits for a write that is still in flight (runtime-renderer.cjs)
      if (!callback) return settled;
      settled.then(() => env.withLastError(undefined, () => callback()), error => env.withLastError(String(error && error.message || error), () => callback()));
      return undefined;
    };
    const oldValues = keys => (keys.length ? call('get', keys) : Promise.resolve({})).then(found => found || {});
    return {
      set(...args) {
        if (env.validate) env.validate('set', args);
        const callback = popCallback(args), items = args[0];
        if (!items || typeof items !== 'object' || Array.isArray(items)) return callback ? area.set(items, callback) : area.set(items);
        const keys = Object.keys(items).filter(visible);
        return finish(oldValues(keys).then(before => call('set', items).then(() => {
          const changes = {};
          for (const key of keys) {
            const value = copy(items[key]);
            if (value === undefined) continue;
            if (!has(before, key)) put(changes, key, changeOf(undefined, value));
            else if (!same(before[key], value)) put(changes, key, changeOf(copy(before[key]), value));
          }
          if (Object.keys(changes).length) env.notify(changes, areaName);
        })), callback);
      },
      remove(...args) {
        if (env.validate) env.validate('remove', args);
        const callback = popCallback(args), names = args[0];
        if (typeof names !== 'string' && !Array.isArray(names)) return callback ? area.remove(names, callback) : area.remove(names);
        const keys = listOf(names).filter(visible);
        return finish(oldValues(keys).then(before => call('remove', names).then(() => {
          const changes = {};
          for (const key of keys) if (has(before, key)) put(changes, key, changeOf(copy(before[key])));
          if (Object.keys(changes).length) env.notify(changes, areaName);
        })), callback);
      },
      clear(...args) {
        if (env.validate) env.validate('clear', args);
        const callback = popCallback(args);
        return finish(call('get', null).then(all => {
          all = all || {};
          const keys = Object.keys(all).filter(visible);
          const wiped = hidden !== undefined && has(all, hidden) ? (keys.length ? call('remove', keys) : undefined) : call('clear');
          return Promise.resolve(wiped).then(() => {
            const changes = {};
            for (const key of keys) put(changes, key, changeOf(copy(all[key])));
            if (keys.length) env.notify(changes, areaName);
          });
        }), callback);
      }
    };
  };

  /**
   * storage.local without the reserved key: get(null), getKeys, getBytesInUse(null) and clear() act on local data only, so clearing local
   * data never wipes sync data. Same call forms as Chromium (callback or promise); argument checks stay Chromium's own (the native call).
   */
  const guardLocal = (local, env) => {
    const wrap = (name, after) => function (...args) {
      const callback = popCallback(args);
      if (callback) {
        return local[name](...args, function (result) {
          if (env.lastError()) return callback.apply(this, arguments);
          let value;
          try { value = after(result, args); } catch (error) { value = result; }
          if (isThenable(value)) value.then(v => callback(v), () => callback(result)); else callback(value);
        });
      }
      const promise = local[name](...args);
      return isThenable(promise) ? promise.then(result => after(result, args)) : promise;
    };
    const out = {
      get: wrap('get', result => { if (result && typeof result === 'object') delete result[KEY]; return result; }),
      getBytesInUse: wrap('getBytesInUse', (result, args) => (typeof result !== 'number' || (args[0] !== null && args[0] !== undefined) ? result : env.call('getBytesInUse', KEY).then(own => result - (own || 0)))),
      clear(...args) {
        const callback = popCallback(args);
        const job = env.call('get', KEY).then(found => {
          if (!found || !has(found, KEY)) return env.call('clear');
          return env.call('get', null).then(all => { const keys = Object.keys(all || {}).filter(key => key !== KEY); return keys.length ? env.call('remove', keys) : undefined; });
        }).then(() => undefined);
        if (env.track) env.track(job);
        if (!callback) return job;
        job.then(() => env.withLastError(undefined, () => callback()), error => env.withLastError(String(error && error.message || error), () => callback()));
        return undefined;
      }
    };
    if (typeof local.getKeys === 'function') out.getKeys = wrap('getKeys', result => (Array.isArray(result) ? result.filter(key => key !== KEY) : result));
    if (env.notify) { const tracked = trackWrites(local, 'local', env, KEY); out.set = tracked.set; out.remove = tracked.remove; out.clear = tracked.clear; }
    return out;
  };

  /** A small event object (addListener / removeListener / hasListener(s), plus dispatch) for the content-script shim. */
  const simpleEvent = (label, hooks = {}) => {
    const listeners = [];
    const event = {
      addListener(listener) { if (typeof listener !== 'function' || listeners.includes(listener)) return; listeners.push(listener); if (hooks.add) hooks.add(listener); },
      removeListener(listener) { const at = listeners.indexOf(listener); if (at < 0) return; listeners.splice(at, 1); if (hooks.remove) hooks.remove(listener); },
      hasListener(listener) { return listeners.includes(listener); },
      hasListeners() { return listeners.length > 0; }
    };
    Object.defineProperty(event, 'dispatch', {configurable: true, value(...args) { for (const listener of listeners.slice()) { try { listener(...args); } catch (error) { try { console.error(error); } catch (e) { /* no console */ } } } }});
    return event;
  };

  /**
   * storage.onChanged and the area events from the ONE native storage.onChanged ('local' and 'session'): a change of the reserved key
   * becomes a 'sync' change (key by key, from the old and new table); local changes never show the reserved key. 'managed' never fires.
   * makeEvent(label, {add, remove}) builds the event object (Chromium's createEvent in the preload, simpleEvent in the shim).
   */
  const createEvents = ({makeEvent, nativeRoot, source, onFirst, onLast}) => {
    const events = {}, names = ['root', 'local', 'sync', 'managed', 'session'];
    let attached = false, active = false;
    const anyListeners = () => names.some(name => events[name].hasListeners());
    // A context that is told the same change by several sources (a service worker: its own write, the main process' relay of what a page heard, what
    // content scripts heard) delivers it once: the same change from a different source within 750 ms is dropped. Sources that are Chromium itself
    // (source undefined: extension pages, content scripts) never repeat.
    const recent = [];
    const novel = (key, from) => {
      const at = Date.now();
      while (recent.length && at - recent[0].at > 750) recent.shift();
      const repeated = recent.some(entry => entry.key === key && entry.from !== from);
      recent.push({key, from, at});
      return !repeated;
    };
    const deliver = (changes, areaName) => {
      events.root.dispatch(changes, areaName);
      if (events[areaName] && areaName !== 'root') events[areaName].dispatch(changes);
    };
    const relay = (changes, areaName, from) => {
      if (from !== undefined) { let key = null; try { key = areaName + '|' + canon(changes); } catch (e) { key = null; } if (key !== null && !novel(key, from)) return; }
      if (areaName === 'local' && changes && typeof changes === 'object' && has(changes, KEY)) {
        const own = changes[KEY] || {}, rest = {};
        for (const key of Object.keys(changes)) if (key !== KEY) put(rest, key, changes[key]);
        if (Object.keys(rest).length) deliver(rest, 'local');
        const synced = diff(table(own.oldValue), table(own.newValue));
        if (Object.keys(synced).length) deliver(synced, 'sync');
        return;
      }
      deliver(changes, areaName);
    };
    const fromNative = (changes, areaName) => relay(changes, areaName, source);
    const hooks = {
      add() {
        if (active) return;
        active = true;
        if (nativeRoot && typeof nativeRoot.addListener === 'function') { nativeRoot.addListener(fromNative); attached = true; }
        if (onFirst) onFirst();
      },
      remove() {
        if (!active || anyListeners()) return;
        active = false;
        if (attached) { nativeRoot.removeListener(fromNative); attached = false; }
        if (onLast) onLast();
      }
    };
    events.root = makeEvent('storage.onChanged', hooks);
    events.local = makeEvent('storage.local.onChanged', hooks);
    events.sync = makeEvent('storage.sync.onChanged', hooks);
    events.managed = makeEvent('storage.managed.onChanged', hooks);
    events.session = makeEvent('storage.session.onChanged', hooks);
    /** A change another channel brought (the worker's own write, a message from a content script): feed(changes, areaName, from). Ignored while nobody listens. */
    events.feed = (changes, areaName, from) => { if (active) relay(changes, areaName, from === undefined ? 'feed' : from); };
    return events;
  };

  /** The service worker's listener for what content scripts heard (see installContentScript): feed(changes, area, from); listening() says whether anyone listens. */
  const inbox = (feed, listening) => {
    const listener = (message, sender, sendResponse) => {
      const found = message && typeof message === 'object' ? message.__acira_storage : null;
      if (!found) return false;
      if (typeof found.area === 'string' && found.changes && typeof found.changes === 'object' && !Array.isArray(found.changes))
        feed(found.changes, found.area, 'cs:' + (sender && sender.tab ? sender.tab.id : '') + ':' + (sender ? sender.frameId : ''));
      try { sendResponse({listening: !!listening()}); } catch (e) { /* the sender went away */ }
      return false;
    };
    listener.__acira = true; // the runtime package passes these messages to no other listener of the extension
    return listener;
  };

  /**
   * The content-script side (extension-shims.cjs): points chrome.storage.sync at the same reserved key, hides it from storage.local and
   * reports sync changes on storage.onChanged. Returns true when installed.
   */
  const installContentScript = chrome => {
    const storage = chrome && chrome.storage;
    if (!storage || !storage.local || (storage.sync && storage.sync.__acira)) return false;
    const local = storage.local;
    const lastError = () => { try { return chrome.runtime.lastError; } catch (e) { return undefined; } };
    const call = makeCall(local, lastError);
    const area = createArea({call});
    // chrome.runtime.lastError during a callback: the native accessor is put back afterwards; when it cannot be replaced the error is logged.
    const withLastError = (message, run) => {
      if (!message) return run();
      let original, installed = false;
      const runtime = chrome.runtime;
      try { original = Object.getOwnPropertyDescriptor(runtime, 'lastError'); Object.defineProperty(runtime, 'lastError', {configurable: true, enumerable: true, get: () => ({message})}); installed = true; } catch (e) { installed = false; }
      try { return run(); }
      finally {
        if (installed) { try { if (original) Object.defineProperty(runtime, 'lastError', original); else delete runtime.lastError; } catch (e) { /* keep */ } }
        else { try { console.error('Unchecked runtime.lastError: ' + message); } catch (e) { /* no console */ } }
      }
    };
    const dual = run => function (...args) {
      const callback = popCallback(args);
      let job;
      try { job = Promise.resolve(run(...args)); } catch (error) { job = Promise.reject(error); }
      if (!callback) return job;
      job.then(value => withLastError(undefined, () => callback(value)), error => withLastError(String(error && error.message || error), () => callback()));
      return undefined;
    };
    const events = createEvents({makeEvent: simpleEvent, nativeRoot: storage.onChanged});
    // Chromium gives a service worker no storage.onChanged. This context hears every change natively (its own writes and everyone's) and passes it
    // on to the worker with a message that only Acira's storage package answers (the extension's own onMessage listeners never see it, see
    // runtime-renderer.cjs). One tab per change is enough for the worker (it drops repeats); the worker's answer says whether anyone listens.
    let manifest = {};
    try { manifest = chrome.runtime.getManifest() || {}; } catch (e) { manifest = {}; }
    const topFrame = typeof window === 'undefined' || window === window.top;
    const nativeChanged = storage.onChanged;
    if (topFrame && manifest.background && manifest.background.service_worker && nativeChanged && typeof nativeChanged.addListener === 'function' && typeof chrome.runtime.sendMessage === 'function') {
      let quietUntil = 0;
      nativeChanged.addListener((changes, areaName) => {
        if (Date.now() < quietUntil) return;
        try {
          chrome.runtime.sendMessage({__acira_storage: {area: areaName, changes}}, reply => {
            if (lastError()) quietUntil = Date.now() + 5000;                       // no worker to answer (reading lastError marks it checked)
            else if (reply && reply.listening === false) quietUntil = Date.now() + 30000;
          });
        } catch (e) { quietUntil = Date.now() + 5000; }
      });
    }
    const sync = {
      get: dual(keys => area.get(keys)), getKeys: dual(() => area.getKeys()), getBytesInUse: dual(keys => area.getBytesInUse(keys)),
      set: dual(items => area.set(items)), remove: dual(keys => area.remove(keys)), clear: dual(() => area.clear()),
      setAccessLevel: dual(() => Promise.resolve()), onChanged: events.sync
    };
    for (const name of Object.keys(LIMITS)) sync[name] = LIMITS[name];
    Object.defineProperty(sync, '__acira', {value: true});
    const guarded = guardLocal(local, {call, lastError, withLastError});
    guarded.onChanged = events.local;
    const define = (object, key, value) => { try { Object.defineProperty(object, key, {value, configurable: true, writable: true, enumerable: true}); return true; } catch (e) { return false; } };
    define(storage, 'sync', sync);
    const proxy = new Proxy(local, {get(target, key) { if (has(guarded, key)) return guarded[key]; const value = target[key]; return typeof value === 'function' ? value.bind(target) : value; }});
    define(storage, 'local', proxy);
    define(storage, 'onChanged', events.root);
    return true;
  };

  return {KEY, LIMITS, pick, bytesIn, diff, canon, applySet, applyRemove, makeLimiter, makeCall, createArea, guardLocal, trackWrites, createEvents, inbox, simpleEvent, installContentScript, itemBytes, utf8};
}

module.exports = {createStorageCore};
