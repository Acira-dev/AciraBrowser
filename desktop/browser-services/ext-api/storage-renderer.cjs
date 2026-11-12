'use strict';
// chrome.storage for extension pages and service workers (P3). local and session stay Chromium's native areas (local is wrapped only to
// hide the reserved sync key); sync is its own persisted area with Chrome's quotas and errors; managed is Chrome's read-only policy store
// (empty: Acira has no enterprise policy); storage.onChanged reports areaName 'local' | 'sync' | 'session' correctly.
// The design and the sync-core are explained in ext-api/storage/sync-core.cjs. Content scripts get the same behaviour from extension-shims.cjs.
const {createStorageCore} = require('./storage/sync-core.cjs');

function storageRenderer(acira, core) {
  return {
    storage: {
      factory: base => {
        const local = base && base.local;
        if (!local || typeof local.get !== 'function') return base;
        const manifest = acira.manifest || {};
        const lastError = () => { const chrome = acira.chrome(); return chrome && chrome.runtime && chrome.runtime.lastError; };
        const call = core.makeCall(local, lastError);
        // Pages and workers of one extension share one lock (navigator.locks, extension origin) so two read-modify-writes cannot interleave.
        const lock = run => (typeof navigator !== 'undefined' && navigator.locks && typeof navigator.locks.request === 'function' ? navigator.locks.request('acira-sync:' + acira.extensionId, run) : run());
        // Chromium's storage.onChanged reaches extension pages and content scripts but never a service worker in Electron (measured), not even for
        // the worker's own writes. So a worker is told by three channels, each change delivered once (core.createEvents drops a repeat from another
        // source): its own writes (reported by the wrappers below), the main process' relay of what an extension page heard (ext-api/storage.cjs),
        // and messages from content scripts that heard it (the shim; the inbox below). Pages and content scripts use Chromium's event.
        const worker = !!acira.isWorker;
        let feed = null, listening = false;
        const notify = worker ? (changes, areaName) => { if (feed) feed(changes, areaName, 'self'); } : undefined;
        const validate = worker ? (name, args) => {
          const type = acira.bindings.lookupType('storage.StorageArea'), list = type && type.functions;
          const spec = Array.isArray(list) ? list.find(item => item.name === name) : list && list[name];
          if (spec) acira.bindings.parseWith('storage.' + name, acira.bindings.signatureFor(spec), args);   // Chromium's own TypeError, synchronously
        } : undefined;
        // A write (sync, and local / session in a worker: each is a read, then a write) is listed while it is in flight; runtime.reload() (runtime-renderer.cjs) waits for the list before it reloads this extension.
        const track = job => { const writes = acira.pendingWrites; if (!writes) return; writes.add(job); const done = () => writes.delete(job); job.then(done, done); };
        const area = core.createArea({call, lock, notify, track});
        const nativeRoot = worker ? acira.event('storage.relay') : base.onChanged;
        if (!worker && manifest.background && manifest.background.service_worker && base.onChanged && typeof base.onChanged.addListener === 'function')
          base.onChanged.addListener((changes, areaName) => { acira.call('storage.forward')(areaName, changes).catch(() => undefined); });
        const inbox = worker ? core.inbox((changes, areaName, from) => { if (feed) feed(changes, areaName, from); }, () => listening) : null;
        const runtimeEvent = () => { const chrome = acira.chrome(); return chrome && chrome.runtime && chrome.runtime.onMessage; };
        const events = core.createEvents({
          makeEvent: (label, hooks) => acira.bindings.createEvent(label, hooks), nativeRoot, source: worker ? 'relay' : undefined,
          onFirst: worker ? () => { listening = true; try { runtimeEvent().addListener(inbox); } catch (error) { /* no messaging */ } } : undefined,
          onLast: worker ? () => { listening = false; try { runtimeEvent().removeListener(inbox); } catch (error) { /* gone */ } } : undefined
        });
        feed = events.feed;
        const none = () => Promise.resolve();

        const sync = acira.buildType('storage.StorageArea', {
          functions: {
            get: keys => area.get(keys), getKeys: () => area.getKeys(), getBytesInUse: keys => area.getBytesInUse(keys),
            set: items => area.set(items), remove: keys => area.remove(keys), clear: () => area.clear(), setAccessLevel: none
          },
          events: {onChanged: events.sync}
        });
        for (const name of Object.keys(core.LIMITS)) sync[name] = core.LIMITS[name];

        // Chrome: an extension without storage.managed_schema gets an error from every managed call; with one, the store is empty and read-only.
        const schema = !!(manifest.storage && manifest.storage.managed_schema);
        const missing = () => Promise.reject(new Error('Managed storage manifest not found'));
        const readOnly = () => (schema ? Promise.reject(new Error('This is a read-only store.')) : missing());
        const managed = acira.buildType('storage.StorageArea', {
          functions: {
            get: keys => (schema ? Promise.resolve(core.pick({}, keys)) : missing()),
            getKeys: () => (schema ? Promise.resolve([]) : missing()),
            getBytesInUse: () => (schema ? Promise.resolve(0) : missing()),
            set: readOnly, remove: readOnly, clear: readOnly, setAccessLevel: () => (schema ? Promise.resolve() : missing())
          },
          events: {onChanged: events.managed}
        });

        const guarded = core.guardLocal(local, {call, lastError, withLastError: acira.withLastError, notify, validate, track});
        guarded.onChanged = events.local;
        const overrides = {local: acira.extend(local, guarded), sync, managed, onChanged: events.root};
        if (worker && base.session && typeof base.session.set === 'function') {
          const tracked = core.trackWrites(base.session, 'session', {lastError, withLastError: acira.withLastError, notify, validate, track});
          overrides.session = acira.extend(base.session, {set: tracked.set, remove: tracked.remove, clear: tracked.clear, onChanged: events.session});
        }
        return acira.extend(base, overrides);
      }
    }
  };
}

// The renderer function is copied into the preload as text: it gets the core's source and runs it there.
const renderer = new Function('acira', `return (${storageRenderer.toString()})(acira, (${createStorageCore.toString()})());`);

module.exports = {namespaces: ['storage'], renderer, storageRenderer};
