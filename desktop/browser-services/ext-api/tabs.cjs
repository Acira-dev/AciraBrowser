'use strict';
// chrome.tabs (package P1, main process). Replaces the engine's tabs handlers with ones that read and write Acira's real tab model
// (order, pinned, groups, opener, windows) through the `tabModel` hook of desktop/main.cjs; see ext-api/tabs/model.cjs and events.cjs.
// Tab ids stay the page's webContents id (what the rest of the engine addresses). Private, Tor and secured tabs are never listed.
// Not rebuilt here (the engine / Electron keep answering): sendMessage and connect (given the page's own id), goBack / goForward, insertCSS.
const {createTabsModel, ERRORS, NONE} = require('./tabs/model.cjs');
const {createTabEvents} = require('./tabs/events.cjs');

const NEW_TAB_URLS = new Set(['chrome://newtab', 'chrome://newtab/', 'chrome-search://local-ntp/local-ntp.html']);

/** The URL an extension asked for, resolved against its own root (Extension::GetResourceURL) and checked: Chromium's messages where Chrome has one. */
function prepareUrl(extension, text) {
  if (NEW_TAB_URLS.has(text)) return {kind: 'newtab', href: ''};
  let url;
  try { url = new URL(text, `chrome-extension://${extension.id}/`); } catch { throw new Error(ERRORS.url(text)); }
  if (url.protocol === 'javascript:') throw new Error(ERRORS.javascript);
  if (url.protocol === 'http:' || url.protocol === 'https:') return {kind: 'web', href: url.href};
  if (url.protocol === 'chrome-extension:' && url.hostname === extension.id) return {kind: 'extension', href: url.href};
  if (url.href === 'about:blank') return {kind: 'blank', href: url.href};
  throw new Error(`Cannot open ${url.protocol} addresses from an extension in Acira.`);
}

module.exports = {
  namespaces: ['tabs'],
  install(api) {
    // Without the host's tab model (desktop/main.cjs extensionBrowser().tabModel) there is nothing to read or write: the engine's handlers stay.
    if (!api.store()?.impl?.tabModel) {
      api.log('no tabModel hook: the engine\'s tabs handlers stay');
      // The page script of tabs.sendMessage asks for the page behind a tab id; with no tab model (a private session that runs extensions) a tab id IS its page's id.
      try { api.handle('acira.tabs.pageId', (event, tabId) => { let found = null; try { found = api.store()?.getTabById?.(tabId) || null; } catch { /* unknown tab */ } return found && !found.isDestroyed?.() ? found.id : null; }); } catch { /* the handler already exists */ }
      return {};
    }
    const model = createTabsModel(api);
    const store = () => api.store();
    const fresh = windowId => model.windows().find(w => w.id === windowId) || null;
    const stripOf = windowId => (fresh(windowId)?.state.tabs || []).filter(model.ordinary);
    const hook = store()?.impl?.tabModel;
    const offHandoff = hook && typeof hook.onHandoff === 'function' ? hook.onHandoff((acira, url, windowId) => model.handoff(acira, url, windowId)) : null;
    // The engine's own handlers still look a tab up by page id: let them find a tab by the id an extension was given too.
    const engineStore = store();
    const originalGetTabById = engineStore && typeof engineStore.getTabById === 'function' ? engineStore.getTabById : null;
    if (originalGetTabById) engineStore.getTabById = function (id) { return originalGetTabById.call(this, id) || (model.byTabId(id)?.wc && originalGetTabById.call(this, model.byTabId(id).wc.id)) || undefined; };

    // The engine fires its own tabs.* events from webContents events; ours come from the tab model, so the engine's are dropped here.
    const router = api.runtime?.ctx?.router;
    let restoreBroadcast = null;
    if (router && typeof router.broadcastEvent === 'function') {
      const original = router.broadcastEvent;
      router.broadcastEvent = function (name, ...args) { if (typeof name === 'string' && name.startsWith('tabs.')) return undefined; return original.call(this, name, ...args); };
      restoreBroadcast = () => { if (router.broadcastEvent !== original) router.broadcastEvent = original; };
    }
    const events = createTabEvents({api, model});

    /** The tabs an extension can address in a window, in strip order (an index is a position in this list). */
    const visibleOf = windowId => model.records().filter(record => record.windowId === windowId && record.window);

    /** Put tab `acira` at `index` of the addressable tabs (Chrome clamps: pinned tabs stay among the pinned, the others after them). */
    function place(windowId, acira, index) {
      const w = fresh(windowId), visible = visibleOf(windowId), me = visible.find(record => record.acira === acira);
      if (!w || !me) return;
      const pinned = visible.filter(record => record.pinned).length;
      const low = me.pinned ? 0 : pinned, high = me.pinned ? Math.max(pinned - 1, 0) : visible.length - 1;
      const occupant = visible[Math.min(Math.max(index < 0 ? visible.length - 1 : index, low), high)];
      if (occupant && occupant.acira !== acira) w.dispatch({type: 'tab.reorder', from: acira, to: occupant.acira});
    }

    /** The page (webContents) id behind an extension tab id, or null when the tab has no page: what Electron's messaging and zoom address. */
    api.handle('acira.tabs.pageId', (event, tabId) => { const record = model.byTabId(tabId); return record && record.wc ? record.wc.id : null; });

    api.handle('tabs.getZoom', (event, tabId) => {
      const record = model.targetRecord(event, tabId);
      return Math.round((record.zoom || 100)) / 100;
    });

    api.handle('tabs.setZoom', (event, tabId, factor) => {
      const record = model.targetRecord(event, tabId), percent = factor === 0 ? 100 : Math.min(500, Math.max(25, Math.round(factor * 100)));
      if (record.window && typeof record.window.command === 'function') record.window.command({type: 'zoom', tabId: record.acira, zoom: percent});
      else if (record.wc) record.wc.setZoomFactor(percent / 100);
      events.schedule();
      return undefined;
    });

    api.handle('tabs.get', (event, tabId) => model.chromeTab(model.targetRecord(event, tabId, {allowCurrent: false}), event.extension));

    api.handle('tabs.getCurrent', event => {
      if (event.type !== 'frame' || !event.sender) return undefined;
      const record = model.records().find(item => item.wc === event.sender);
      return record ? model.chromeTab(record, event.extension) : undefined;
    });

    api.handle('tabs.query', (event, info) => model.query(event, info || {}));

    api.handle('tabs.create', async (event, props) => {
      props = props || {};
      const extension = event.extension, w = model.resolveWindow(event, props.windowId);
      const target = props.url != null ? prepareUrl(extension, props.url) : {kind: 'newtab', href: ''};
      const active = props.active ?? props.selected ?? true;
      if (props.openerTabId != null) {
        const opener = model.byTabId(props.openerTabId);
        if (!opener) throw new Error(ERRORS.tab(props.openerTabId));
        if (opener.windowId !== w.id) throw new Error(ERRORS.openerCreate);
      }
      let record;
      if (target.kind === 'newtab') {
        // Acira's new-tab page is drawn by the interface, not by a page: the tab exists, an extension cannot address it by id.
        const before = new Set(stripOf(w.id).map(tab => tab.id));
        w.dispatch({type: 'tab.new', background: !active});
        const made = stripOf(w.id).find(tab => !before.has(tab.id));
        if (!made) throw new Error('The new tab could not be created.');
        if (props.pinned) w.dispatch({type: 'tab.pin', id: made.id});
        if (props.index != null) place(w.id, made.id, props.index);
        events.schedule();
        const fresh1 = model.records().find(item => item.acira === made.id);
        if (!fresh1) throw new Error('The new tab could not be created.');
        return model.chromeTab(fresh1, extension);
      }
      const wc = await store().createTab({url: target.href, active, windowId: w.id});
      record = model.byTabId(wc.id);
      if (record && record.window) {
        if (props.pinned) record.window.dispatch({type: 'tab.pin', id: record.acira});
        if (props.index != null) place(record.windowId, record.acira, props.index);
        record = model.byTabId(wc.id) || record;
      }
      if (!record) throw new Error('The new tab could not be created.');
      events.schedule();
      return model.chromeTab(record, extension);
    });

    api.handle('tabs.update', async (event, tabId, props) => {
      props = props || {};
      const extension = event.extension, record = model.targetRecord(event, tabId);
      const target = props.url != null ? prepareUrl(extension, props.url) : null;
      if (props.openerTabId != null) {
        const opener = model.byTabId(props.openerTabId);
        if (!opener) throw new Error(ERRORS.tab(props.openerTabId));
        if (opener.windowId !== record.windowId) throw new Error(ERRORS.openerUpdate);
      }
      if (target && target.kind === 'newtab') throw new Error('Acira cannot turn a page into the new-tab page from an extension yet.');
      if (target) {
        if (record.window && target.kind === 'web') record.window.dispatch({type: 'tab.navigate', url: target.href, tabId: record.acira});
        else if (record.wc) await record.wc.loadURL(target.href);
        else throw new Error('Acira cannot show an extension page inside a browser tab yet.');
      }
      if (props.pinned != null && record.window && props.pinned !== record.pinned) record.window.dispatch({type: 'tab.pin', id: record.acira});
      if (props.muted != null) {
        if (record.window) record.window.dispatch({type: 'tab.mute', id: record.acira, muted: props.muted});
        else record.wc.setAudioMuted(props.muted);
        if (props.muted) model.mutedBy.set(record.id, extension.id); else model.mutedBy.delete(record.id);
      }
      if (props.autoDiscardable != null) model.autoDiscardable.set(record.id, props.autoDiscardable);
      const activate = props.active ?? props.selected ?? (props.highlighted === true ? true : undefined);
      if (activate === true && record.window && !record.active) record.window.dispatch({type: 'tab.select', id: record.acira});
      events.schedule();
      return model.chromeTab(model.byTabId(record.id) || record, extension);
    });

    api.handle('tabs.remove', (event, tabIds) => {
      for (const id of Array.isArray(tabIds) ? tabIds : [tabIds]) {
        const record = model.byTabId(id);
        if (!record) throw new Error(ERRORS.tab(id));
        if (record.window) record.window.dispatch({type: 'tab.close', id: record.acira});   // the way the tab's own close button does (asks about unsaved pages)
        else store().removeTab(record.wc);
      }
      return undefined;
    });

    api.handle('tabs.reload', (event, tabId, props) => {
      const record = model.targetRecord(event, tabId);
      if (record.wc) { if (props && props.bypassCache) record.wc.reloadIgnoringCache(); else record.wc.reload(); }
      else if (record.window && record.tab && record.tab.contentKind !== 'internal') record.window.dispatch({type: 'tab.navigate', url: record.tab.url, tabId: record.acira});   // wakes a sleeping tab
      return undefined;
    });

    api.handle('tabs.move', (event, tabIds, props) => {
      props = props || {};
      const ids = Array.isArray(tabIds) ? tabIds : [tabIds];
      const records = ids.map(id => { const record = model.byTabId(id); if (!record) throw new Error(ERRORS.tab(id)); return record; });
      let windowId = records[0] ? records[0].windowId : undefined;
      if (props.windowId != null) {
        const w = model.resolveWindow(event, props.windowId);
        if (records.some(record => record.windowId !== w.id)) throw new Error(ERRORS.crossWindow);
        windowId = w.id;
      }
      if (records.some(record => !record.window || record.windowId !== windowId)) throw new Error(ERRORS.crossWindow);
      const base = props.index;
      records.forEach((record, i) => place(windowId, record.acira, base < 0 ? Number.MAX_SAFE_INTEGER : base + i));
      events.schedule();
      const moved = records.map(record => model.chromeTab(model.byTabId(record.id) || record, event.extension));
      return Array.isArray(tabIds) ? moved : moved[0];
    });

    api.handle('tabs.highlight', (event, info) => {
      const w = model.resolveWindow(event, info.windowId);
      const wanted = Array.isArray(info.tabs) ? info.tabs : [info.tabs];
      const records = model.records().filter(record => record.windowId === w.id);
      const found = wanted.map(index => {
        const record = records.find(item => item.index === index);
        if (!record) throw new Error(ERRORS.index(index));
        return record;
      });
      if (found[0] && found[0].window && !found[0].active) found[0].window.dispatch({type: 'tab.select', id: found[0].acira});
      events.schedule();
      return model.windowObject(fresh(w.id) || w);
    });

    api.handle('tabs.detectLanguage', async (event, tabId) => {
      const record = model.targetRecord(event, tabId);
      if (!record.wc || !/^https?:/i.test(record.url || '')) return 'und';
      let lang = '';
      try {
        lang = await record.wc.executeJavaScript(
          `(() => { const meta = document.querySelector('meta[http-equiv="content-language" i]'); return (document.documentElement.getAttribute('lang') || (meta && meta.content) || '').trim(); })()`, false);
      } catch { lang = ''; }
      const parts = String(lang || '').split(/[-_]/).filter(Boolean);
      if (!parts.length || !/^[A-Za-z]{2,3}$/.test(parts[0])) return 'und';
      const language = parts[0].toLowerCase();
      return language === 'zh' && parts[1] ? `zh-${parts[1].toUpperCase()}` : language;
    });

    // The engine's PNG / JPEG capture with its checks (host access or activeTab, 2 calls a second), now for the window Acira says is meant.
    api.wrap('tabs.captureVisibleTab', original => async (event, windowId, options) => {
      if (windowId && typeof windowId === 'object') { options = windowId; windowId = null; }
      const w = model.resolveWindow(event, windowId);
      const active = model.records().find(record => record.windowId === w.id && record.active);
      if (!active || !active.wc) throw new Error('No active web contents to capture');
      try { store().setActiveTab?.(active.wc); } catch { /* the engine keeps its own idea */ }
      if (!original) throw new Error(api.errors.accessDenied());
      return original(event, w.id, options);
    });

    return {
      forget() { /* nothing is kept per extension */ },
      dispose() { events.dispose(); if (restoreBroadcast) restoreBroadcast(); if (typeof offHandoff === 'function') offHandoff(); if (originalGetTabById) engineStore.getTabById = originalGetTabById; }
    };
  }
};
