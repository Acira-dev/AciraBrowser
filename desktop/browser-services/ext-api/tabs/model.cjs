'use strict';
// chrome.tabs on Acira's real tab model (package P1; contract docs/launch/EXTENSION_WORK_PACKAGES.md).
//
// Two sources are joined here:
//   - Acira's window state through ONE hook, `store.impl.tabModel` (desktop/main.cjs, extensionBrowser): the profile's ordinary windows with
//     their ordered tab list (pinned first), groups, opener and the page behind each tab, if it has one;
//   - the engine's store (electron-chrome-extensions) for extension windows (an extension's own page opened as a window).
// EVERY ordinary tab is a Chrome tab: also the new-tab page (drawn by the interface), a sleeping / discarded tab and one restored but not loaded
// yet (discarded: true, status 'unloaded'). A tab's id is stable for its life: the id of its first page (webContents.id, what the rest of the
// engine addresses), else a number of its own; a page it gets later (waking up) or a new page for the same tab (moved to another window) is an
// alias of that id. Private, Tor and secured tabs are never listed. Web-app windows are not browser windows (Chrome: type 'app').
const activeTabGrant = require('../surfaces/active-tab.cjs');
const {globTester} = require('../../glob-match.cjs');
const NONE = -1, CURRENT = -2;

const ERRORS = {
  tab: id => `No tab with id: ${id}.`,
  window: id => `No window with id: ${id}.`,
  index: index => `No tab at index: ${index}.`,
  url: url => `Invalid url: "${url}".`,
  noCurrentWindow: 'No current window',
  noLastFocused: 'No last-focused window',
  noSelected: 'No selected tab',
  javascript: 'JavaScript URLs are not allowed in extension navigations. Use chrome.scripting.executeScript instead.',
  openerUpdate: 'Tab opener must be in the same window as the updated tab.',
  openerCreate: 'Tab opener must be in the same window as the newly created tab.',
  notEditable: 'Tabs cannot be edited right now (user may be dragging a tab).',
  crossWindow: 'Acira cannot move a tab into another existing window yet.'
};

const ordinary = tab => !tab.privacy;
const quiet = fn => { try { return fn(); } catch { return undefined; } };
const same = (a, b) => (a ?? '') === (b ?? '');

/**
 * api: the ext-api package API (store(), session, permissions, getWindow(), getExtension()).
 * Returns {records, windows, tabOf, windowOf, lookup, chromeTab, canSee, ...}: pure reads of the current state; nothing is cached across calls
 * except numeric group ids, last-access times and the per-tab values Acira has no field for.
 */
function createTabsModel(api) {
  const groupNumbers = new Map(), accessed = new Map(), autoDiscardable = new Map(), mutedBy = new Map();
  let nextGroup = 1, wasActive = new Set();
  const groupNumber = key => {
    if (!groupNumbers.has(key)) groupNumbers.set(key, nextGroup++);
    return groupNumbers.get(key);
  };

  const hook = () => api.store()?.impl?.tabModel || null;

  /**
   * Chrome's url / pendingUrl: `url` is the last committed address (empty before the first commit), `pendingUrl` the address of a navigation that
   * has not committed. Acira's tab keeps the address it is going to (state.url); the page (wc.getURL()) says what has committed.
   */
  function addresses(target, committed, loading, requested) {
    const url = committed || (loading ? '' : target || '');
    const pending = !committed && loading && target ? target : (loading && requested && requested !== committed ? requested : undefined);
    return pending ? {url, pendingUrl: pending} : {url};
  }
  const profileId = w => w.profileId;

  /** The profile's ordinary windows from the hook: [{id, focused, state, pages, dispatch, ...}], front to back as the hook lists them. */
  function windows() {
    const model = hook();
    if (!model) return [];
    return (quiet(() => model.windows()) || []).filter(w => w && w.state && w.pages);
  }

  const groupOf = (w, tab) => {
    if (!tab.group) return NONE;
    const found = (w.state.tabGroups || []).find(g => g.name === tab.group && g.browserProfileId === tab.browserProfileId && same(g.workspaceId, tab.workspaceId));
    return groupNumber(found ? found.id : `${tab.browserProfileId}|${tab.workspaceId || ''}|${tab.group}`);
  };

  // ---- stable tab ids ---------------------------------------------------------------------------------------------------------------
  const ids = new Map(), aliases = new Map(), retired = new Set(), lastSeen = new Map(), pendingMoves = [];
  let nextSynthetic = 2000000000;   // below int32; webContents ids are small

  /** Acira's tab ids are unique per window only (the first tab of every window is 'tab-home'): a tab is known by its window and its id. */
  const keyOf = (w, tab) => w.id + '/' + tab.id;

  /** The extension tab id of an Acira tab: kept for the tab's life; the id of its first page, else a number of its own. */
  function idFor(w, tab, wc) {
    const key = keyOf(w, tab);
    let id = ids.get(key);
    if (id === undefined) { id = wc ? wc.id : nextSynthetic++; ids.set(key, id); }
    if (wc && wc.id !== id) aliases.set(wc.id, id);
    return id;
  }

  /** Acira cannot carry a page to another window: it opens the same address there and closes the old tab. The new tab continues the old one's id. */
  function handoff(acira, url, windowId) {
    const w = windows().find(item => windowId === undefined ? (item.state.tabs || []).some(tab => tab.id === acira) : item.id === windowId);
    if (w) pendingMoves.push({key: w.id + '/' + acira, windowId: w.id, url, at: Date.now()});
  }

  /**
   * Binds the new tab of a move to the old tab's id. The new window's first tab starts as the new-tab page and navigates to the address a moment
   * later, so such a tab (in a window other than the old tab's) is held back, not listed, for a few seconds while it may turn out to be the
   * continuation. Returns the Acira ids held back.
   */
  function resolveHandoffs(entries) {
    const now = Date.now(), held = new Set();
    for (let i = pendingMoves.length - 1; i >= 0; i--) {
      const move = pendingMoves[i], id = ids.get(move.key), age = now - move.at;
      if (age > 20000 || id === undefined) { pendingMoves.splice(i, 1); continue; }
      const elsewhere = item => item.w.id !== move.windowId && !ids.has(keyOf(item.w, item.tab));
      const successor = entries.find(item => elsewhere(item) && item.tab.url === move.url);
      if (successor) {
        ids.set(keyOf(successor.w, successor.tab), id);
        retired.add(move.key);
        pendingMoves.splice(i, 1);
        continue;
      }
      if (age < 4000) for (const item of entries) if (elsewhere(item) && item.tab.url === 'acira://new') held.add(keyOf(item.w, item.tab));
    }
    return held;
  }

  /** What an extension sees for an Acira page address: internal pages are shown as chrome:// pages (acira:// is not a scheme extensions know). */
  const exposeUrl = url => (typeof url === 'string' && url.startsWith('acira://') ? 'chrome://' + url.slice(8).replace(/^new\/?$/, 'newtab').replace(/\/?$/, '/') : url);

  /** Every tab in an ordinary window of the profile, then extension windows: [{id, wc|null, windowId, window, aux, tab, acira, index, active, ...}]. */
  function records() {
    const store = api.store();
    if (!store) return [];
    const out = [], claimed = new Set(), ws = windows(), now = Date.now(), entries = [];
    const strips = ws.map(w => {
      const whole = (w.state.tabs || []).filter(tab => ordinary(tab) && tab.browserProfileId === (profileId(w) ?? tab.browserProfileId));
      for (const tab of whole) entries.push({w, tab});
      return {w, whole};
    });
    const held = resolveHandoffs(entries);
    for (const {w, whole} of strips) {
      const pageOf = tab => { const wc = w.pages.get(tab.id)?.view?.webContents; return wc && !quiet(() => wc.isDestroyed()) && wc.session === api.session ? wc : null; };
      for (const tab of whole) { const gone = retired.has(keyOf(w, tab)) ? pageOf(tab) : null; if (gone) claimed.add(gone); }   // a tab that continues elsewhere: its old page is not an extension window
      const strip = whole.filter(tab => !retired.has(keyOf(w, tab)) && !held.has(keyOf(w, tab)));
      strip.forEach((tab, index) => {
        const wc = pageOf(tab);
        if (wc) claimed.add(wc);
        const id = idFor(w, tab, wc);
        lastSeen.set(keyOf(w, tab), now);
        const opener = tab.openerId ? strip.find(other => other.id === tab.openerId) : null;
        const web = tab.contentKind !== 'internal', loading = !!tab.loading;
        out.push({
          wc, id, windowId: w.id, window: w, aux: null, tab, acira: tab.id, index, stripLength: strip.length,
          active: w.state.activeTabId === tab.id, pinned: !!tab.pinned, groupId: groupOf(w, tab),
          openerId: opener ? idFor(w, opener, pageOf(opener)) : undefined,
          ...addresses(exposeUrl(tab.url), wc ? quiet(() => wc.getURL()) || '' : '', loading, exposeUrl(tab.requestedUrl)),
          title: tab.title, favicon: tab.favicon || '', loading,
          status: loading ? 'loading' : (wc || !web ? 'complete' : 'unloaded'), discarded: !wc && web && !loading,
          audible: !!tab.audible, muted: !!tab.muted, frozen: !!wc && !!tab.sleeping, zoom: tab.zoom, strip
        });
      });
    }
    // Extension windows (an extension's own page opened with tabs.create / windows.create) are one-tab windows outside Acira's strip.
    for (const wc of store.tabs || []) {
      if (claimed.has(wc) || quiet(() => wc.isDestroyed()) || wc.session !== api.session) continue;
      const win = store.tabToWindow?.get(wc);
      if (!win || quiet(() => win.isDestroyed())) continue;
      const loading = !!quiet(() => wc.isLoading());
      out.push({
        wc, id: wc.id, windowId: win.id, window: null, aux: win, tab: null, acira: null, index: 0, stripLength: 1,
        active: true, pinned: false, groupId: NONE, openerId: undefined, ...addresses('', quiet(() => wc.getURL()) || '', loading, undefined),
        title: quiet(() => wc.getTitle()) || '', favicon: store.tabDetailsCache?.get?.(wc.id)?.favIconUrl || '', loading, status: loading ? 'loading' : 'complete',
        discarded: false, audible: !!quiet(() => wc.isCurrentlyAudible()), muted: !!quiet(() => wc.audioMuted), frozen: false,
        zoom: Math.round((quiet(() => wc.getZoomFactor()) || 1) * 100), strip: []
      });
    }
    // lastAccessed: when the tab was first seen, and again each time it becomes the active tab of its window.
    const seenIds = new Set(out.map(r => r.id)), nowActive = new Set();
    for (const record of out) {
      if (!accessed.has(record.id) || record.active && !wasActive.has(record.id)) accessed.set(record.id, now);
      if (record.active) nowActive.add(record.id);
    }
    wasActive = nowActive;
    for (const id of [...accessed.keys()]) if (!seenIds.has(id)) { accessed.delete(id); autoDiscardable.delete(id); mutedBy.delete(id); }
    for (const [acira, at] of lastSeen) {   // a closed tab keeps its id for ten minutes (a closing page may still be asked about), then it is forgotten
      if (now - at < 600000) continue;
      const id = ids.get(acira);
      lastSeen.delete(acira); ids.delete(acira); retired.delete(acira);
      for (const [page, target] of aliases) if (target === id) aliases.delete(page);
    }
    return out;
  }

  /** The tab with an extension tab id, or one of its pages' ids (what Electron reports as sender.tab.id after a tab got a new page). */
  function byTabId(id) {
    const list = records();
    return list.find(record => record.id === id) || list.find(record => record.id === aliases.get(id)) || null;
  }

  /** The window id a call means: a given id (WINDOW_ID_CURRENT = the caller's), else the caller's window. Throws Chromium's errors. */
  function resolveWindow(event, windowId) {
    const ws = windows();
    if (windowId != null && windowId !== CURRENT) {
      const w = ws.find(item => item.id === windowId);
      if (!w) throw new Error(ERRORS.window(windowId));
      return w;
    }
    const w = currentWindow(event, ws);
    if (!w) throw new Error(windowId === CURRENT ? ERRORS.noCurrentWindow : ERRORS.noCurrentWindow);
    return w;
  }

  /**
   * The id of the window the calling page belongs to, focused or not (Chrome: a popup's current window is the window it was opened from; an
   * options page in a tab, that tab's window): the page's own tab, else the window that hosts it (toolbar popup, side panel). Null for a worker.
   */
  function ownerId(event) {
    const sender = event?.sender;
    if (!sender || event.type !== 'frame') return null;
    const record = records().find(item => item.wc === sender);
    if (record) return record.windowId;
    const owner = quiet(() => hook()?.ownerOf?.(sender));
    if (typeof owner !== 'number') return null;
    // Only a window the model knows counts: a page in some other window (a QA window, a detached helper) has no tabs of its own to be 'current'.
    return windows().some(w => w.id === owner) || records().some(item => item.windowId === owner) ? owner : null;
  }

  /** The ordinary window a call acts in: the caller's own when it has one, otherwise (worker, page of an extension window) the last focused. */
  function currentWindow(event, ws = windows()) {
    const id = ownerId(event);
    return (id !== null && ws.find(item => item.id === id)) || lastFocused(ws);
  }

  /** The focused window, else the one Acira focused last (the app may be in the background), else the engine's idea, else the first. */
  function lastFocused(ws = windows()) {
    const store = api.store();
    return ws.find(item => item.focused) || ws.find(item => item.last) || ws.find(item => item.id === store?.lastFocusedWindowId) || ws[0] || null;
  }

  const mayManifestHost = (extension, url) => {
    const table = api.permissions;
    if (table) return table.hasOrigin(extension, url);
    return false;
  };
  const hasPermission = (extension, name) => {
    const table = api.permissions;
    if (table) return table.has(extension, name);
    return Array.isArray(extension?.manifest?.permissions) && extension.manifest.permissions.includes(name);
  };

  /**
   * Chrome's ScrubTabBehavior: url, title and favIconUrl only with the "tabs" permission, host access to the page, or an activeTab GRANT for
   * this tab: the person used the extension on it (toolbar button, keyboard command, menu item: surfaces/active-tab.cjs) and the tab is
   * still on the origin it was given for. Declaring "activeTab" in the manifest grants nothing by itself (it carries no install warning, so
   * treating it as a standing permission would hand every such extension the address and title of every window's active tab).
   */
  function canSee(extension, record) {
    if (!extension) return false;
    if (hasPermission(extension, 'tabs')) return true;
    const address = record.url || record.pendingUrl;   // Chrome judges the visible address, which is the pending one before the first commit
    if (address && address.startsWith(`chrome-extension://${extension.id}/`)) return true;
    if (address && mayManifestHost(extension, address)) return true;
    return !!record.wc && hasPermission(extension, 'activeTab') && activeTabGrant.has(api.session, extension.id, quiet(() => record.wc.id), quiet(() => record.wc.getURL()) || '');
  }

  const sizeOf = record => {
    const w = record.window;
    const page = w && quiet(() => w.pageBounds?.());
    if (page && page.width > 0) return {width: Math.round(page.width), height: Math.round(page.height)};
    const bounds = (w && quiet(() => w.bounds?.())) || (record.aux && quiet(() => record.aux.getContentBounds?.()));
    return bounds ? {width: Math.round(bounds.width), height: Math.round(bounds.height)} : {};
  };

  /** The tabs.Tab for an extension (url/title/favIconUrl scrubbed when it may not see the page). */
  function chromeTab(record, extension) {
    const tab = {
      id: record.id, index: record.index, groupId: record.groupId, windowId: record.windowId,
      highlighted: record.active, active: record.active, pinned: record.pinned,
      lastAccessed: accessed.get(record.id) ?? Date.now(), audible: record.audible, frozen: record.frozen, discarded: record.discarded,
      autoDiscardable: autoDiscardable.has(record.id) ? autoDiscardable.get(record.id) : true,
      mutedInfo: mutedInfo(record), status: record.status, incognito: false, splitViewId: NONE,
      ...sizeOf(record)
    };
    if (record.openerId !== undefined) tab.openerTabId = record.openerId;
    if (canSee(extension, record)) {
      tab.url = record.url;
      if (record.pendingUrl) tab.pendingUrl = record.pendingUrl;
      tab.title = record.title;
      if (record.favicon) tab.favIconUrl = record.favicon;
    }
    return tab;
  }

  function mutedInfo(record) {
    if (!record.muted) return {muted: false};
    const by = mutedBy.get(record.id);
    return by ? {muted: true, reason: 'extension', extensionId: by} : {muted: true, reason: 'user'};
  }

  // ---- match patterns for tabs.query({url}) (URLPattern with every scheme valid) -------------------------------------------------------
  const PATTERN = /^(\*|https?|file|ftp|chrome-extension|chrome|about|data|ws|wss|[a-z][a-z0-9+.-]*):\/\/([^/]*)(\/.*)?$/i;
  function compilePattern(text) {
    if (text === '<all_urls>') return () => true;
    const parts = PATTERN.exec(text);
    if (!parts) return null;
    const [, scheme, host, path = ''] = parts;
    if (!path && scheme.toLowerCase() !== 'file') return null;
    if (host.includes('*') && !(host === '*' || /^\*\.[^*]+$/.test(host))) return null;
    const pathRe = globTester(path || '/*');
    return url => {
      let u; try { u = new URL(url); } catch { return false; }
      const s = u.protocol.slice(0, -1).toLowerCase();
      if (scheme === '*' ? !['http', 'https'].includes(s) : scheme.toLowerCase() !== s) return false;
      if (s !== 'file' && host !== '*') {
        const h = u.hostname.toLowerCase();
        if (host.startsWith('*.')) { const base = host.slice(2).toLowerCase(); if (h !== base && !h.endsWith('.' + base)) return false; }
        else {
          const [hostOnly, port] = host.split(':');
          if (h !== hostOnly.toLowerCase()) return false;
          if (port && port !== '*' && port !== (u.port || (s === 'https' ? '443' : '80'))) return false;
        }
      }
      return pathRe.test(u.pathname + u.search);
    };
  }
  const titleMatcher = pattern => globTester(String(pattern));

  /** tabs.query. Throws Chromium's invalid-pattern error. */
  function query(event, info = {}) {
    const extension = event.extension;
    let urls = null;
    if (info.url != null) {
      urls = (Array.isArray(info.url) ? info.url : [info.url]).map(text => {
        const test = compilePattern(text);
        if (!test) throw new Error(`Invalid url pattern '${text}'`);
        return test;
      });
    }
    const title = info.title != null ? titleMatcher(info.title) : null;
    const ws = windows();
    const callerWindow = ownerId(event);
    const current = (info.currentWindow !== undefined && info.currentWindow !== null) ? (callerWindow !== null ? {id: callerWindow} : currentWindow(event, ws)) : null;
    const focused = (info.lastFocusedWindow !== undefined && info.lastFocusedWindow !== null)
      ? lastFocused(ws) : null;
    const wanted = info.windowId === CURRENT ? (callerWindow !== null ? {id: callerWindow} : currentWindow(event, ws)) : null;
    const out = [];
    for (const record of records()) {
      if (info.active != null && record.active !== info.active) continue;
      if (info.highlighted != null && record.active !== info.highlighted) continue;
      if (info.pinned != null && record.pinned !== info.pinned) continue;
      if (info.audible != null && record.audible !== info.audible) continue;
      if (info.muted != null && record.muted !== info.muted) continue;
      if (info.discarded != null && record.discarded !== info.discarded) continue;
      if (info.frozen != null && record.frozen !== info.frozen) continue;
      const auto = autoDiscardable.has(record.id) ? autoDiscardable.get(record.id) : true;
      if (info.autoDiscardable != null && auto !== info.autoDiscardable) continue;
      if (info.status != null && record.status !== info.status) continue;
      if (info.groupId != null && record.groupId !== info.groupId) continue;
      if (info.splitViewId != null && info.splitViewId !== NONE) continue;
      if (info.index != null && record.index !== info.index) continue;
      if (info.windowType != null && info.windowType !== (record.window ? 'normal' : 'popup')) continue;
      if (info.windowId != null) {
        if (info.windowId === CURRENT ? !wanted || record.windowId !== wanted.id : record.windowId !== info.windowId) continue;
      }
      if (current !== null || info.currentWindow != null) {
        const inCurrent = !!current && record.windowId === current.id;
        if (inCurrent !== !!info.currentWindow) continue;
      }
      if (focused !== null || info.lastFocusedWindow != null) {
        const inFocused = !!focused && record.windowId === focused.id;
        if (inFocused !== !!info.lastFocusedWindow) continue;
      }
      // The page itself is what url and title filters read: an extension that may not see it cannot probe it.
      if ((urls || title) && !canSee(extension, record)) continue;
      if (urls && !urls.some(test => test(record.url || record.pendingUrl || ''))) continue;
      if (title && !title.test(record.title || '')) continue;
      out.push(chromeTab(record, extension));
    }
    return out;
  }

  /** The tab a call names, or the active tab of the caller's window when no id is given. Throws Chromium's errors. */
  function targetRecord(event, tabId, {allowCurrent = true} = {}) {
    if (tabId == null) {
      if (!allowCurrent) throw new Error(ERRORS.tab(tabId));
      const w = currentWindow(event);
      const found = w && records().find(record => record.windowId === w.id && record.active);
      if (!found) throw new Error(ERRORS.noSelected);
      return found;
    }
    const record = byTabId(tabId);
    if (!record) throw new Error(ERRORS.tab(tabId));
    return record;
  }

  const windowObject = w => {
    const bounds = quiet(() => w.bounds?.()) || {x: 0, y: 0, width: 0, height: 0};
    return {id: w.id, focused: !!w.focused, top: bounds.y, left: bounds.x, width: bounds.width, height: bounds.height,
      incognito: false, type: 'normal', state: w.state?.windowUi?.fullscreen ? 'fullscreen' : (quiet(() => w.maximized?.()) ? 'maximized' : 'normal'), alwaysOnTop: false};
  };

  return {
    windows, records, byTabId, handoff, aliases, resolveWindow, currentWindow, chromeTab, canSee, query, targetRecord, compilePattern, windowObject,
    autoDiscardable, mutedBy, accessed, groupNumber, ordinary
  };
}

module.exports = {createTabsModel, ERRORS, NONE, CURRENT};
