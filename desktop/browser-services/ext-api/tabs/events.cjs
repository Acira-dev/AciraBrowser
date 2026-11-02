'use strict';
// chrome.tabs.on* events, derived from Acira's tab model instead of the engine's per-webContents guesses.
//
// The engine (electron-chrome-extensions) fires onCreated / onUpdated / onRemoved / onActivated from webContents events with a Tab it
// builds without Acira's order, pins, groups or windows, the same Tab for every extension. This module compares the tab list of one moment
// with the next (state changes come from the tab-model hook, the engine store's tab-added / tab-removed) and sends each extension the
// events Chrome would, with a Tab scrubbed for that extension (no url / title / favIconUrl without the "tabs" permission or host access).
const EVENTS = ['onCreated', 'onUpdated', 'onMoved', 'onActivated', 'onHighlighted', 'onDetached', 'onAttached', 'onRemoved', 'onZoomChange'];
const DEBOUNCE_MS = 30;

/**
 * Indexes of the heaviest increasing run of `values` (the tabs that did not move). `weights` (default 1 each) settles a tie: when a tab
 * passes another, either one "moved"; a tab whose pin or group just changed is the one that did (weigh it less).
 */
function stationary(values, weights = values.map(() => 1)) {
  const n = values.length, best = weights.slice(), from = new Array(n).fill(-1);
  let end = -1, length = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < i; j++) if (values[j] < values[i] && best[j] + weights[i] > best[i]) { best[i] = best[j] + weights[i]; from[i] = j; }
    if (best[i] > length) { length = best[i]; end = i; }
  }
  const keep = new Set();
  for (let i = end; i >= 0; i = from[i]) keep.add(i);
  return keep;
}

function createTabEvents({api, model}) {
  let previous = null, timer = null, disposed = false;
  const offs = [];

  const snapshot = () => {
    const records = model.records(), tabs = new Map(), windows = new Map();
    for (const record of records) {
      tabs.set(record.id, record);
      if (!windows.has(record.windowId)) windows.set(record.windowId, {ids: [], active: null});
      const entry = windows.get(record.windowId);
      entry.ids.push(record.id);
      if (record.active) entry.active = record.id;
    }
    const live = new Set([...model.windows().map(w => w.id), ...windows.keys()]);
    return {tabs, windows, live};
  };

  const listening = name => api.listening(`tabs.${name}`);
  const anyListener = () => EVENTS.some(name => listening(name).length > 0);

  /** Sends `tabs.<name>` to each listening extension with arguments built for that extension (null skips it). */
  function deliver(name, build) {
    for (const id of listening(name)) {
      const extension = api.getExtension?.(id);
      if (!extension) continue;
      let args;
      try { args = build(extension); } catch (error) { api.log?.(`tabs.${name}`, error && error.message); continue; }
      if (args) api.emit(id, `tabs.${name}`, ...args);
    }
  }

  const FIELDS = [
    ['url', r => r.url, 'url'], ['title', r => r.title, 'title'], ['favIconUrl', r => r.favicon, 'favIconUrl'],
    ['status', r => r.status, null], ['discarded', r => r.discarded, null], ['audible', r => r.audible, null], ['pinned', r => r.pinned, null],
    ['groupId', r => r.groupId, null], ['frozen', r => r.frozen, null],
    ['muted', r => r.muted, null]
  ];
  const SENSITIVE = new Set(['url', 'title', 'favIconUrl']);

  function compare(before, after) {
    const change = {};
    for (const [key, read] of FIELDS) {
      const a = read(before), b = read(after);
      if (a === b) continue;
      if (key === 'muted') change.mutedInfo = null;       // filled per extension (reason depends on who muted)
      else change[key] = b;
    }
    return change;
  }

  function sync() {
    if (disposed) return;
    const next = snapshot(), before = previous;
    previous = next;
    if (!before || !anyListener()) return;

    // 1. closed tabs (Chrome: onRemoved, then the new active tab's onActivated)
    for (const [id, old] of before.tabs) {
      if (next.tabs.has(id)) continue;
      deliver('onRemoved', () => [id, {windowId: old.windowId, isWindowClosing: !next.live.has(old.windowId)}]);
    }
    // 2. new tabs
    for (const [id, record] of next.tabs) {
      if (before.tabs.has(id)) continue;
      deliver('onCreated', extension => [model.chromeTab(record, extension)]);
    }
    // 3. tabs that changed window or position
    const survivors = [...next.tabs.keys()].filter(id => before.tabs.has(id));
    for (const id of survivors) {
      const old = before.tabs.get(id), now = next.tabs.get(id);
      if (old.windowId === now.windowId) continue;
      deliver('onDetached', () => [id, {oldWindowId: old.windowId, oldPosition: old.index}]);
      deliver('onAttached', () => [id, {newWindowId: now.windowId, newPosition: now.index}]);
    }
    for (const [windowId, entry] of next.windows) {
      const was = before.windows.get(windowId);
      if (!was) continue;
      const kept = entry.ids.filter(id => before.tabs.has(id) && before.tabs.get(id).windowId === windowId);
      const still = stationary(kept.map(id => was.ids.indexOf(id)), kept.map(id => (before.tabs.get(id).pinned !== next.tabs.get(id).pinned || before.tabs.get(id).groupId !== next.tabs.get(id).groupId ? 0.5 : 1)));
      kept.forEach((id, at) => {
        if (still.has(at)) return;
        const fromIndex = before.tabs.get(id).index, toIndex = next.tabs.get(id).index;
        if (fromIndex !== toIndex) deliver('onMoved', () => [id, {windowId, fromIndex, toIndex}]);
      });
    }
    // 4. changed properties
    for (const id of survivors) {
      const old = before.tabs.get(id), now = next.tabs.get(id), change = compare(old, now);
      if (!Object.keys(change).length) continue;
      deliver('onUpdated', extension => {
        const info = {...change};
        if ('mutedInfo' in info) info.mutedInfo = model.chromeTab(now, extension).mutedInfo;
        if (!model.canSee(extension, now)) for (const key of SENSITIVE) delete info[key];
        return Object.keys(info).length ? [id, info, model.chromeTab(now, extension)] : null;
      });
    }
    // 5. zoom
    for (const id of survivors) {
      const old = before.tabs.get(id), now = next.tabs.get(id);
      if (old.zoom === now.zoom || !old.zoom || !now.zoom) continue;
      deliver('onZoomChange', () => [{tabId: id, oldZoomFactor: old.zoom / 100, newZoomFactor: now.zoom / 100, zoomSettings: {mode: 'automatic', scope: 'per-origin', defaultZoomFactor: 1}}]);
    }
    // 6. the active tab of each window
    for (const [windowId, entry] of next.windows) {
      const was = before.windows.get(windowId);
      if (entry.active == null || (was && was.active === entry.active)) continue;
      deliver('onActivated', () => [{tabId: entry.active, windowId}]);
      deliver('onHighlighted', () => [{windowId, tabIds: [entry.active]}]);
    }
  }

  function schedule() {
    if (disposed || timer) return;
    timer = setTimeout(() => { timer = null; try { sync(); } catch (error) { api.log?.('tabs events', error && error.message); } }, DEBOUNCE_MS);
    timer.unref?.();
  }

  // Start: baseline now, then follow the model.
  try { previous = snapshot(); } catch { previous = null; }
  const hook = api.store()?.impl?.tabModel;
  if (hook && typeof hook.onChange === 'function') offs.push(hook.onChange(schedule));
  const store = api.store();
  if (store && typeof store.on === 'function') {
    for (const name of ['tab-added', 'tab-removed']) { store.on(name, schedule); offs.push(() => store.off?.(name, schedule) ?? store.removeListener?.(name, schedule)); }
  }

  return {
    schedule, sync,
    dispose() { disposed = true; if (timer) clearTimeout(timer); for (const off of offs) { try { if (typeof off === 'function') off(); } catch { /* gone */ } } }
  };
}

module.exports = {createTabEvents, stationary, EVENTS};
