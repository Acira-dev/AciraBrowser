'use strict';
// Chromium's lazy event dispatch (13.8, Calendly: the first press of its toolbar button was lost).
//
// An extension whose background is a service worker is not running all the time: Chromium keeps the names of the events its worker registered a listener for (extensions/browser/
// event_router.cc: AddLazyEventListenerImpl writes them to ExtensionPrefs as kRegisteredServiceWorkerEvents, they survive restarts and are cleared when the extension is updated;
// OnExtensionLoaded loads them back as lazy listeners with LoadUnfilteredLazyListeners), and an event for one of them is not dropped: EventRouter::DispatchEventImpl finds the lazy listener,
// ServiceWorkerTaskQueue::AddPendingTask (extensions/browser/service_worker/service_worker_task_queue.cc) holds the event and starts the worker, and the pending tasks run once the renderer
// reports the worker's context started (RendererDidStartServiceWorkerContext), and EventRouter::DispatchPendingEvent sends the event to the listeners it registered. A worker that failed to
// start gets the event dropped (DispatchPendingEvent: "the context failed to start, so there won't be any registered listener").
//
// The engine under Acira (electron-chrome-extensions' ExtensionRouter) knows only the listeners registered in THIS run: sendEvent finds none and returns without a word until the worker's
// first run has called addListener. A press of Calendly's toolbar button 0.9 s after the app started (the worker is up but its module graph has not finished: listening=[] at the click in 2 of 7
// cold launches) did nothing, and a second press worked. This module is the missing half, on the same two points the engine has: the router's addListener (what the worker registered is
// recorded, per profile, in <user data>/extension-registered-events/<profile>.json, reset when the extension's version changes) and its sendEvent (an event sent to ONE extension that has no
// live listener yet, but registered one in an earlier run, is held, the worker is started, and the event goes out when the listener is registered, in the order it was sent).
// Differences from Chromium: the hold is bounded (256 events per extension and event, 1.5 s after the worker started and still no registration, 20 s in all: Chromium waits for the worker's
// start-up failure instead); an event sent to every extension (broadcastEvent) is not held (Acira's own broadcasts already go to the extensions that listen); and the held events go out
// 250 ms after the listener was registered, not at the registration: a listener is registered in the middle of the worker's script and the extension sets up its state afterwards
// (Calendly's store: pressed at the very moment of the registration, 3 presses in 10 still did nothing; 80 ms later every press worked). Chromium's event reaches the worker through a
// mojo message and the worker thread's task queue, after the script's first run; Electron reports the worker as running at the registration itself, so the wait is explicit here.
const fs = require('node:fs'), path = require('node:path');

const MAX_QUEUED = 256;
const GRACE_MS = 1500;
const SETTLE_MS = 250;
const ABSOLUTE_MS = 20000;
const WRITE_DELAY_MS = 400;

const safeName = value => String(value || 'default').replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 120) || 'default';

/**
 * deps: getExtension(id) -> {id, manifest} | null, deliver(id, name, args) (the engine's own send), startWorker(scope) -> Promise (the engine's startWorkerForScope),
 *       userData + storeKey + persist (the record on disk; persist false keeps it in memory), live(id, name) -> is a listener of this extension registered now, log, setTimer / clearTimer.
 */
function createLazyEvents({getExtension, deliver, startWorker, live, userData, storeKey, persist = true, log = () => {}, setTimer = setTimeout, clearTimer = clearTimeout}) {
  const file = persist && userData ? path.join(userData, 'extension-registered-events', safeName(storeKey) + '.json') : null;
  let data = null, writeTimer = null;
  const waiting = new Map();   // "<id>\0<event>" -> {items: [args], timers: [], started}
  const keyOf = (id, name) => id + '\u0000' + name;

  const load = () => {
    if (data) return data;
    data = {};
    if (!file) return data;
    try {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (saved && typeof saved === 'object' && saved.extensions && typeof saved.extensions === 'object') {
        for (const [id, record] of Object.entries(saved.extensions)) {
          if (record && typeof record.v === 'string' && Array.isArray(record.events)) data[id] = {v: record.v, events: record.events.filter(name => typeof name === 'string')};
        }
      }
    } catch { /* no record yet */ }
    return data;
  };
  const save = () => {
    if (!file || writeTimer) return;
    writeTimer = setTimer(() => { writeTimer = null; flushToDisk(); }, WRITE_DELAY_MS);
    if (writeTimer && typeof writeTimer.unref === 'function') writeTimer.unref();
  };
  const flushToDisk = () => {
    if (!file || !data) return;
    try {
      fs.mkdirSync(path.dirname(file), {recursive: true});
      fs.writeFileSync(file + '.tmp', JSON.stringify({version: 1, extensions: data}));
      fs.renameSync(file + '.tmp', file);
    } catch { /* the record is a courtesy: the next run just has less to go on */ }
  };

  const versionOf = extension => String((extension && extension.manifest && extension.manifest.version) || '');
  const usesWorker = extension => !!(extension && extension.manifest && extension.manifest.background && typeof extension.manifest.background.service_worker === 'string' && extension.manifest.background.service_worker);
  const recordFor = extension => {
    const all = load(), version = versionOf(extension);
    // ExtensionPrefs: the registered events of an extension are cleared when it is updated.
    if (!all[extension.id] || all[extension.id].v !== version) all[extension.id] = {v: version, events: []};
    return all[extension.id];
  };

  const dropped = (key, why) => {
    const slot = waiting.get(key);
    if (!slot) return;
    waiting.delete(key);
    for (const timer of slot.timers) clearTimer(timer);
    log(`[lazy-events] ${key.replace('\u0000', ' ')}: ${slot.items.length} event(s) dropped (${why})`);
  };

  // The held events go out SETTLE_MS after the worker registered the listener (see the header), in the order they were sent. Events for the same extension and event that come in the
  // meantime (a second press) wait behind them: the slot stays until it has sent.
  function ready(id, name, key, slot) {
    if (waiting.get(key) !== slot || !slot.registered || slot.settling) return;
    slot.settling = true;
    for (const timer of slot.timers) clearTimer(timer);
    slot.timers = [];
    const timer = setTimer(() => {
      if (waiting.get(key) !== slot) return;
      waiting.delete(key);
      for (const args of slot.items) { try { deliver(id, name, args); } catch { /* one event failing does not stop the next */ } }
    }, SETTLE_MS);
    if (timer && typeof timer.unref === 'function') timer.unref();
    slot.timers.push(timer);
  }
  function start(id, name, key, slot) {
    const unref = timer => { if (timer && typeof timer.unref === 'function') timer.unref(); return timer; };
    slot.timers.push(unref(setTimer(() => dropped(key, 'the worker did not register the listener in time'), ABSOLUTE_MS)));
    // Waking the worker is for one that stopped; one that is being (re)registered at start-up answers "Failed to start service worker" and registers its listeners a moment later,
    // so a failure here ends nothing: the wait goes on until the listener is registered (or the 20 s are over).
    Promise.resolve().then(() => startWorker(`chrome-extension://${id}/`)).then(() => {
      if (waiting.get(key) !== slot || slot.registered) return;
      slot.timers.push(unref(setTimer(() => dropped(key, 'the worker started and registered no such listener'), GRACE_MS)));
    }, error => log(`[lazy-events] ${id} ${name}: the worker could not be started now (${String(error && error.message || error)}); waiting for its listener`));
  }

  return {
    /** An event for one extension has no live listener: true when it was held (the caller sends nothing), false to go on as before. */
    hold(id, name, args) {
      try {
        if (typeof id !== 'string' || !id || typeof name !== 'string' || typeof startWorker !== 'function') return false;
        const extension = getExtension(id);
        if (!usesWorker(extension)) return false;
        const key = keyOf(id, name);
        const waitingSlot = waiting.get(key);
        // A slot exists: events before it are still waiting (or settling), so this one goes behind them whether a listener is live by now or not.
        if (waitingSlot) { if (waitingSlot.items.length < MAX_QUEUED) waitingSlot.items.push(args); return true; }
        const record = load()[id];
        if (!record || record.v !== versionOf(extension) || !record.events.includes(name)) return false;
        if (live(id, name)) return false;
        const slot = {items: [args], timers: [], registered: false, settling: false};
        waiting.set(key, slot);
        start(id, name, key, slot);
        return true;
      } catch { return false; }
    },
    /** The worker of this extension registered a listener for this event. */
    registered(id, name) {
      try {
        const extension = getExtension(id);
        if (usesWorker(extension)) {
          const record = recordFor(extension);
          if (!record.events.includes(name)) { record.events.push(name); save(); }
        }
        const key = keyOf(id, name), slot = waiting.get(key);
        if (!slot) return;
        slot.registered = true;
        ready(id, name, key, slot);
      } catch { /* never throw from the router's listener registration */ }
    },
    /** The worker removed its last listener for this event: it no longer wakes for it. */
    unregistered(id, name) {
      try {
        const record = load()[id];
        if (!record) return;
        const at = record.events.indexOf(name);
        if (at >= 0) { record.events.splice(at, 1); save(); }
      } catch { /* nothing */ }
    },
    /** The extension was removed. */
    forget(id) {
      try {
        const all = load();
        if (all[id]) { delete all[id]; save(); }
        for (const key of [...waiting.keys()]) if (key.startsWith(id + '\u0000')) dropped(key, 'the extension was removed');
      } catch { /* nothing */ }
    },
    /** Test and shutdown helpers. */
    registeredEvents: id => (load()[id] ? load()[id].events.slice() : []),
    held: () => [...waiting.entries()].map(([key, slot]) => [key.replace('\u0000', ' '), slot.items.length]),
    dispose() {
      for (const key of [...waiting.keys()]) dropped(key, 'shutting down');
      if (writeTimer) { clearTimer(writeTimer); writeTimer = null; flushToDisk(); }
    }
  };
}

module.exports = {createLazyEvents, MAX_QUEUED, GRACE_MS, ABSOLUTE_MS, SETTLE_MS};
