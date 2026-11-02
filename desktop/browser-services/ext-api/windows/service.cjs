'use strict';
// chrome.windows for Acira (main-process half), written against Chromium 152.0.7977.167:
//   chrome/browser/extensions/api/tabs/tabs_api.cc (WindowsGet/GetCurrent/GetLastFocused/GetAll/Create/Update/Remove),
//   windows_util.cc (GetControllerFromWindowID), window_controller_list.cc (CurrentWindowForFunctionWithFilter),
//   browser_extension_window_controller.cc (the Window object), windows_event_router.cc (onFocusChanged / WINDOW_ID_NONE),
//   tabs_constants.h + extension_tab_util.h (every error string below).
//
// The service never touches Electron: it works on a `host` (desktop/browser-services/ext-api/windows/host.cjs, built in main.cjs for
// one profile) that lists the windows an extension of this profile may see, and on plain window objects with the BaseWindow methods.
// What is never listed, so never reachable by id: private windows, Tor windows, installed web-app windows, windows of other profiles.
// (Secured-workspace tabs live in ordinary windows but are never handed to the extension engine, so `populate` never shows them.)

const NONE = -1;      // chrome.windows.WINDOW_ID_NONE
const CURRENT = -2;   // chrome.windows.WINDOW_ID_CURRENT

const ERR = Object.freeze({
  noCurrent: 'No current window',
  noLastFocused: 'No last-focused window',
  notFound: id => `No window with id: ${id}.`,
  tabNotFound: id => `No tab with id: ${id}.`,
  invalidState: 'Invalid value for state',
  invalidType: 'Invalid value for type',
  invalidBounds: 'Invalid value for bounds. Bounds must be at least 50% within visible screen space.',
  incognitoDisabled: 'Incognito mode is disabled.',
  notAllowed: 'Browser windows not allowed.',
  invalidUrl: url => `Invalid url: "${url}".`,
  javascriptUrl: 'JavaScript URLs are not allowed in API based extension navigations. Use chrome.scripting.executeScript instead.',
  ordinaryOnly: 'Extension windows require ordinary web destinations.',
  notImplemented: 'Not implemented.',
  lockedFullscreen: 'Cannot lock window to fullscreen or close a locked fullscreen window without lockWindowFullscreenPrivate manifest permission'
});

const alive = window => !!window && !(typeof window.isDestroyed === 'function' && window.isDestroyed());
const ask = (window, name, fallback) => { try { return typeof window[name] === 'function' ? window[name]() : fallback; } catch { return fallback; } };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Chrome's Window.state (browser_extension_window_controller.cc: minimized, then fullscreen, then maximized). */
function stateOf(window) {
  if (ask(window, 'isMinimized', false)) return 'minimized';
  if (ask(window, 'isFullScreen', false)) return 'fullscreen';
  if (ask(window, 'isMaximized', false)) return 'maximized';
  return 'normal';
}

/** Outer bounds; a minimized window reports the bounds it comes back to (Electron's own getBounds is off screen then). */
function boundsOf(window) {
  const minimized = ask(window, 'isMinimized', false);
  const rect = (minimized && typeof window.getNormalBounds === 'function' ? ask(window, 'getNormalBounds', null) : null) || ask(window, 'getBounds', null) || {};
  const int = value => (Number.isFinite(value) ? Math.round(value) : 0);
  return {left: int(rect.x), top: int(rect.y), width: int(rect.width), height: int(rect.height)};
}

/** The Window object, in Chrome's property order. `tabs` is added by the caller when populate is asked for. */
function windowValue(entry) {
  const window = entry.window, bounds = boundsOf(window);
  return {
    id: window.id, type: entry.kind, focused: ask(window, 'isFocused', false), incognito: false,
    alwaysOnTop: ask(window, 'isAlwaysOnTop', false), state: stateOf(window),
    left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height
  };
}

/** queryOptions.windowTypes -> a Set, or null (no filter: Chromium's kNoWindowFilter, also for an empty list). */
function typeFilter(options) {
  const types = options && Array.isArray(options.windowTypes) ? options.windowTypes.filter(type => typeof type === 'string') : [];
  return types.length ? new Set(types) : null;
}
const matches = (entry, filter) => !filter || filter.has(entry.kind);

/** WindowShowState of a WindowState value (tabs_internal::ConvertToWindowShowState: locked-fullscreen is a fullscreen). */
const showState = state => (state === 'locked-fullscreen' ? 'fullscreen' : state === 'minimized' || state === 'maximized' || state === 'fullscreen' || state === 'normal' ? state : 'default');

/** IsValidStateForWindowsCreateFunction: a minimized window is not focused and a maximized / fullscreen one is, and neither has bounds. */
function createStateValid(data) {
  const hasBounds = ['left', 'top', 'width', 'height'].some(key => data[key] !== undefined && data[key] !== null);
  switch (data.state) {
    case 'minimized': return !(data.focused === true) && !hasBounds;
    case 'maximized': case 'fullscreen': case 'locked-fullscreen': return !(data.focused === false) && !hasBounds;
    default: return true;
  }
}

const area = rect => Math.max(0, rect.width) * Math.max(0, rect.height);
function intersect(a, b) {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y), right = Math.min(a.x + a.width, b.x + b.width), bottom = Math.min(a.y + a.height, b.y + b.height);
  return right > x && bottom > y ? {x, y, width: right - x, height: bottom - y} : {x, y, width: 0, height: 0};
}
/** tabs_internal::WindowBoundsIntersectDisplays: at least half of the rectangle is on some display. */
function intersectsDisplays(rect, displays) {
  if (!Number.isSafeInteger(area(rect))) return false;
  let sum = 0;
  for (const display of displays) sum += area(intersect(rect, display));
  return sum >= Math.floor(area(rect) / 2);
}
/** gfx::Rect::AdjustToFit. */
function adjustToFit(rect, container) {
  const axis = (destOrigin, destSize, origin, size) => {
    const length = Math.min(destSize, size);
    return [origin < destOrigin ? destOrigin : Math.min(destOrigin + destSize, origin + length) - length, length];
  };
  const [x, width] = axis(container.x, container.width, rect.x, rect.width), [y, height] = axis(container.y, container.height, rect.y, rect.height);
  return {x, y, width, height};
}
/** The display GetDisplayMatching picks: the most overlap, else the first (primary). */
function displayMatching(rect, displays) {
  let best = displays[0], most = -1;
  for (const display of displays) { const overlap = area(intersect(rect, display)); if (overlap > most) { most = overlap; best = display; } }
  return best;
}

/** SetWindowBounds (windows.create): defaults, then the given fields; size without position is moved onto its display; checked against the displays. */
function createBounds(data, defaults, displays) {
  const given = key => data[key] !== undefined && data[key] !== null;
  const hasPosition = given('left') || given('top'), hasSize = given('width') || given('height');
  let rect = {x: given('left') ? data.left : defaults.x, y: given('top') ? data.top : defaults.y, width: given('width') ? data.width : defaults.width, height: given('height') ? data.height : defaults.height};
  if (!hasPosition && !hasSize) return null;
  if (!hasPosition && hasSize && displays.length) rect = adjustToFit(rect, displayMatching(rect, displays));
  if (displays.length && !intersectsDisplays(rect, displays)) throw new Error(ERR.invalidBounds);
  return rect;
}

/** ExtensionTabUtil::PrepareURLForNavigation, reduced to what Acira opens: http(s) and the extension's own pages. */
function prepareUrl(raw, extensionId) {
  let url = null;
  try { url = new URL(raw); } catch { /* relative: resolved against the extension, as ResolvePossiblyRelativeURL does */ }
  if (!url) { try { url = new URL(raw, `chrome-extension://${extensionId}/`); } catch { throw new Error(ERR.invalidUrl(raw)); } }
  if (url.protocol === 'javascript:') throw new Error(ERR.javascriptUrl);
  if (url.protocol === 'http:' || url.protocol === 'https:') return url.href;
  if (url.protocol === 'chrome-extension:' && url.hostname === extensionId && !url.username && !url.password) return url.href;
  throw new Error(ERR.ordinaryOnly);
}

/**
 * @param host    {windows(), windowOf(webContents), displays(), defaultBounds(kind), create(spec), close(window)} or null
 * @param store   the engine's tab/window store (EventEmitter: 'window-added'; tabs, windows, tabToWindow, getTabById, lastFocusedWindowId) or null
 * @param tabsOf  async (event, window) -> the Tab objects of that window (the live tabs.query handler: the same scrubbing as chrome.tabs)
 * @param send    (eventName, ...args) -> deliver to every extension that listens
 */
function createWindowsService({host = null, store = null, tabsOf = async () => [], send = () => {}, timers = {setTimeout, clearTimeout}, log = () => {}} = {}) {
  const tracked = new Map();       // window -> {off(), id, kind, announced}
  const activation = new Map();    // window -> sequence (bigger = more recently active)
  let sequence = 0, focusedId = NONE, noneTimer = null, disposed = false;

  /** Every window an extension of this profile may see, in creation order: [{window, kind: 'normal' | 'popup'}]. */
  function entries() {
    const out = [], seen = new Set();
    let listed = [];
    try { listed = host && typeof host.windows === 'function' ? host.windows() : (store && store.windows ? [...store.windows].map(window => ({window, kind: 'normal'})) : []); } catch (error) { log('windows()', error); }
    for (const item of listed) {
      if (!item || !alive(item.window) || seen.has(item.window) || typeof item.window.id !== 'number') continue;
      seen.add(item.window);
      out.push({window: item.window, kind: item.kind === 'popup' ? 'popup' : 'normal'});
    }
    return out.sort((a, b) => a.window.id - b.window.id);
  }
  const entryOf = window => entries().find(entry => entry.window === window) || null;

  async function describe(event, entry, populate) {
    const value = windowValue(entry);
    if (populate) {
      let tabs = [];
      try { tabs = await tabsOf(event, entry.window); } catch (error) { log('tabs', error); }
      value.tabs = (Array.isArray(tabs) ? tabs : []).filter(Boolean).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    }
    return value;
  }

  /** The window that holds the code asking: the tab's window, else the window an engine popup belongs to. */
  function containing(event, list) {
    const sender = event && event.sender;
    if (!sender) return null;
    let window = null;
    try { window = store && store.tabToWindow && typeof store.tabToWindow.get === 'function' ? store.tabToWindow.get(sender) : null; } catch { window = null; }
    if (!window && host && typeof host.windowOf === 'function') { try { window = host.windowOf(sender); } catch { window = null; } }
    return window ? list.find(entry => entry.window === window) || null : null;
  }

  /** GetControllerFromWindowID. */
  function resolve(event, windowId, filter) {
    const list = entries();
    if (windowId === CURRENT) {
      const own = containing(event, list);
      if (own) return own;                                   // the window of the caller, whatever the type filter says
      const usable = list.filter(entry => matches(entry, filter));
      const focused = usable.find(entry => ask(entry.window, 'isFocused', false));
      const last = focused || usable[usable.length - 1];     // else the window created last
      if (!last) throw new Error(ERR.noCurrent);
      return last;
    }
    const found = list.find(entry => entry.window.id === windowId);
    if (!found || !matches(found, filter)) throw new Error(ERR.notFound(windowId));
    return found;
  }

  const api = {
    async get(event, windowId, options) { sync(); return describe(event, resolve(event, windowId, typeFilter(options)), !!(options && options.populate)); },
    async getCurrent(event, options) { sync(); return describe(event, resolve(event, CURRENT, typeFilter(options)), !!(options && options.populate)); },
    async getLastFocused(event, options) {
      sync();
      const filter = typeFilter(options);
      const usable = entries().filter(entry => matches(entry, filter));
      const focused = usable.find(entry => ask(entry.window, 'isFocused', false));
      const byActivity = [...usable].sort((a, b) => (activation.get(b.window) || 0) - (activation.get(a.window) || 0) || b.window.id - a.window.id);
      const found = focused || byActivity[0];
      if (!found) throw new Error(ERR.noLastFocused);
      return describe(event, found, !!(options && options.populate));
    },
    async getAll(event, options) {
      sync();
      const filter = typeFilter(options), populate = !!(options && options.populate);
      return Promise.all(entries().filter(entry => matches(entry, filter)).map(entry => describe(event, entry, populate)));
    },

    async create(event, createData) {
      sync();
      const data = createData && typeof createData === 'object' ? createData : {};
      const extensionId = event && event.extension && event.extension.id;
      const urls = [];
      if (data.url !== undefined && data.url !== null) for (const raw of Array.isArray(data.url) ? data.url : [data.url]) urls.push(prepareUrl(raw, extensionId));
      if (data.incognito === true) throw new Error(ERR.incognitoDisabled);
      if (!createStateValid(data)) throw new Error(ERR.invalidState);
      let moving = null;
      if (data.tabId !== undefined && data.tabId !== null) {
        moving = store && typeof store.getTabById === 'function' ? store.getTabById(data.tabId) : null;
        if (!moving) throw new Error(ERR.tabNotFound(data.tabId));
      }
      if (data.state === 'locked-fullscreen') throw new Error(ERR.lockedFullscreen);
      let kind;
      switch (data.type) {
        case undefined: case null: case 'normal': kind = 'normal'; break;
        case 'popup': case 'panel': kind = 'popup'; break;
        default: throw new Error(ERR.invalidType);
      }
      // tabId: the tab moves into the new window only for a tabbed window or an empty popup (Chromium). Acira moves a tab between windows the
      // way its own "Move to new window" does: the address opens in the new window and the old tab closes (the page is loaded again).
      if (moving && (kind === 'normal' || urls.length === 0)) {
        let address = null;
        try { address = prepareUrl(String(moving.getURL()), extensionId); } catch { address = null; }   // an internal page opens as the new window's start page
        if (address) urls.push(address);
      } else moving = null;
      if (!host || typeof host.create !== 'function') throw new Error(ERR.notAllowed);
      const displays = typeof host.displays === 'function' ? host.displays() : [];
      const bounds = createBounds(data, host.defaultBounds ? host.defaultBounds(kind) : {x: 0, y: 0, width: 900, height: 720}, displays);
      const focused = data.focused === undefined || data.focused === null ? data.state !== 'minimized' : data.focused;
      const window = await host.create({extensionId, urls, kind, bounds, state: showState(data.state), focused, setSelfAsOpener: data.setSelfAsOpener === true});
      if (!alive(window)) throw new Error(ERR.notAllowed);
      const entry = entryOf(window) || {window, kind};
      if (urls.length) for (let i = 0; i < 30; i++) { if ((await tabsOf(event, window).catch(() => [])).length) break; await sleep(50); }
      if (moving) { try { store.removeTab(moving); } catch (error) { log('removeTab', error); } }
      return describe(event, entry, true);
    },

    async update(event, windowId, info) {
      sync();
      const entry = resolve(event, windowId, null), window = entry.window, update = info && typeof info === 'object' ? info : {};
      const current = (ask(window, 'isMinimized', false) ? ask(window, 'getNormalBounds', null) : null) || ask(window, 'getBounds', null) || {x: 0, y: 0, width: 0, height: 0};
      const given = key => update[key] !== undefined && update[key] !== null;
      const wantsBounds = ['left', 'top', 'width', 'height'].some(given);
      const next = {x: given('left') ? update.left : current.x, y: given('top') ? update.top : current.y,
        width: given('width') ? update.width : current.width, height: given('height') ? update.height : current.height};
      const displays = host && typeof host.displays === 'function' ? host.displays() : [];
      if (wantsBounds && displays.length && !intersectsDisplays(next, displays)) throw new Error(ERR.invalidBounds);
      const wanted = showState(update.state);
      if (wantsBounds && (wanted === 'minimized' || wanted === 'maximized' || wanted === 'fullscreen')) throw new Error(ERR.invalidState);
      if (given('focused')) {
        if (update.focused && wanted === 'minimized') throw new Error(ERR.invalidState);
        if (!update.focused && (wanted === 'maximized' || wanted === 'fullscreen')) throw new Error(ERR.invalidState);
      }
      // Valid: apply (UpdateWindowState).
      if (wanted !== 'fullscreen' && wanted !== 'default' && ask(window, 'isFullScreen', false)) window.setFullScreen(false);
      if (wanted === 'minimized') window.minimize();
      else if (wanted === 'maximized') window.maximize();
      else if (wanted === 'fullscreen') {
        if (ask(window, 'isMinimized', false)) window.restore();
        else if (ask(window, 'isMaximized', false)) window.unmaximize();
        window.setFullScreen(true);
      } else if (wanted === 'normal') {
        if (ask(window, 'isMinimized', false)) window.restore();
        if (ask(window, 'isMaximized', false)) window.unmaximize();
      }
      if (wantsBounds) window.setBounds({x: Math.round(next.x), y: Math.round(next.y), width: Math.round(next.width), height: Math.round(next.height)});
      if (given('focused')) {
        if (update.focused) { if (ask(window, 'isMinimized', false)) window.restore(); window.focus(); }
        else if (typeof window.blur === 'function') window.blur();
      }
      if (given('drawAttention') && typeof window.flashFrame === 'function') window.flashFrame(!!update.drawAttention);
      // The OS applies a state change a moment later: answer with what the window became, as Chrome does.
      if (wanted !== 'default') for (let i = 0; i < 20 && stateOf(window) !== (wanted === 'normal' ? 'normal' : wanted); i++) await sleep(15);
      return describe(event, entryOf(window) || entry, false);
    },

    async remove(event, windowId) {
      sync();
      const entry = resolve(event, windowId, null);
      if (host && typeof host.close === 'function') host.close(entry.window); else entry.window.close();
      return undefined;
    }
  };

  // ---------------------------------------------------------------------------------------------------------- events
  function setFocused(id) {
    if (focusedId === id) return;
    focusedId = id;
    if (store && id !== NONE) { try { store.lastFocusedWindowId = id; } catch { /* a frozen store */ } }
    send('windows.onFocusChanged', id);
  }
  function maybeNone() {
    timers.clearTimeout(noneTimer);
    noneTimer = timers.setTimeout(() => {
      noneTimer = null;
      if (disposed) return;
      if (!entries().some(entry => ask(entry.window, 'isFocused', false))) setFocused(NONE);
    }, 80);
    if (noneTimer && typeof noneTimer.unref === 'function') noneTimer.unref();
  }
  function track(entry) {
    const window = entry.window;
    if (tracked.has(window)) return tracked.get(window);
    const record = {id: window.id, kind: entry.kind, created: false, boundsTimer: null, off() {}};
    const onFocus = () => { activation.set(window, ++sequence); if (entryOf(window)) setFocused(window.id); };
    const onBlur = () => maybeNone();
    const onBounds = () => {
      timers.clearTimeout(record.boundsTimer);
      record.boundsTimer = timers.setTimeout(() => {
        record.boundsTimer = null;
        const now = entryOf(window);
        if (now && !disposed) send('windows.onBoundsChanged', windowValue(now));
      }, 80);
      if (record.boundsTimer && typeof record.boundsTimer.unref === 'function') record.boundsTimer.unref();
    };
    const onClosed = () => {
      record.off();
      tracked.delete(window);
      timers.clearTimeout(record.boundsTimer);
      if (!disposed) {
        send('windows.onRemoved', record.id);
        if (focusedId === record.id) maybeNone();
      }
    };
    const handlers = [['focus', onFocus], ['blur', onBlur], ['resize', onBounds], ['move', onBounds], ['closed', onClosed]];   // 'resize' / 'move' fire for every change; Windows' 'resized' / 'moved' only end a drag
    for (const [name, fn] of handlers) { try { window.on(name, fn); } catch { /* not an emitter */ } }
    record.off = () => { for (const [name, fn] of handlers) { try { window.removeListener(name, fn); } catch { /* gone */ } } };
    tracked.set(window, record);
    if (ask(window, 'isFocused', false)) { activation.set(window, ++sequence); focusedId = window.id; }
    return record;
  }
  /** Starts watching every listed window not watched yet; what an API call first sees is taken as already there (no windows.onCreated). */
  function sync() { for (const entry of entries()) track(entry).created = true; }
  /** Windows the extension engine has just been handed (its first page attached): known from now on; the first sight is windows.onCreated. */
  function added(window) {
    if (disposed) return;
    const entry = entryOf(window);
    if (!entry) return;
    const record = track(entry);
    if (record.created) return;
    record.created = true;
    send('windows.onCreated', windowValue(entry));
  }
  function start() {
    sync();  // the baseline: windows that exist now were not just created
    if (store && typeof store.on === 'function') store.on('window-added', added);
  }
  function dispose() {
    disposed = true;
    timers.clearTimeout(noneTimer);
    if (store && typeof store.removeListener === 'function') store.removeListener('window-added', added);
    for (const record of tracked.values()) { record.off(); timers.clearTimeout(record.boundsTimer); }
    tracked.clear();
  }

  return {api, start, dispose, entries, track, added, NONE, CURRENT};
}

module.exports = {createWindowsService, ERR, NONE, CURRENT, windowValue, stateOf, boundsOf, typeFilter, createStateValid, createBounds, intersectsDisplays, adjustToFit, prepareUrl, showState};
