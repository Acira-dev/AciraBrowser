'use strict';
// Beta 14, Zap: one window's picking session and the rules' traffic between the pages, the picker's layer, the store and the person.
//   - The layer (zap-layer.html, a transparent native view over the page) takes the pointer, wheel and keys; main turns them into messages to the page (zap-preload.cjs), which
//     answers with what is under the pointer and, on a click, the rule for it. Nothing the person does while picking reaches the page.
//   - A removal is saved here (browser-services/zap.cjs), told to the page that made it and to every other page of the same site in the same profile, and offered as "Removed. Undo".
//   - Restoring (Undo, Ctrl+Z, the site controls, Settings) is told to the pages the same way and plays the return.
// The pages of every window share one registry, so a change in one window reaches the others. Private and Tor windows have their own rules, kept in memory (zap.cjs).
const path = require('node:path');
const {sharedZap, hostKey, compile, forPage, applicableKeys} = require('./browser-services/zap.cjs');

const FILE = path.join(__dirname, 'zap-layer.html'), PRELOAD = path.join(__dirname, 'zap-layer-preload.cjs');
const CHANNEL = 'acira:zap', EVENT = 'acira:zap-event', LAYER = 'acira:zap-layer', EARLY = 'acira:zap-early';
const UNDO_KEPT = 12, UNDO_MS = 10 * 60 * 1000, UNDO_KEY_MS = 8000;

// Every page of every window that may carry removals: webContents -> {owner, tabId, profileKey()}.
const registry = {pages: new Map(), installed: false};
const finite = value => (Number.isFinite(value) ? value : 0);

/** What a page asks for at its start (answered through frame-boot.cjs): its site's style sheet and rules, or null. Only the main frame of a registered page gets one. */
function earlyAnswer(event, database) {
  try {
    const info = registry.pages.get(event.sender), frame = event.senderFrame;
    if (!info || !frame || frame !== event.sender.mainFrame) return null;
    const host = hostKey(frame.url);
    return host ? sharedZap(database).earlyFor(info.profileKey(), host) : null;
  } catch { return null; }
}

/** Registers the three channels once for the whole app (frame-boot.cjs needs exactly one handler for the early answer). */
function install(ipcMain, database) {
  if (registry.installed) return;
  registry.installed = true;
  ipcMain.on(EARLY, event => { event.returnValue = earlyAnswer(event, database); });
  ipcMain.on(EVENT, (event, message) => { const info = registry.pages.get(event.sender); if (info && event.senderFrame === event.sender.mainFrame && message && typeof message === 'object') info.owner.fromPage(event.sender, info, message); });
  ipcMain.on(LAYER, (event, message) => { for (const owner of owners) if (owner.isLayer(event.sender)) { owner.fromLayer(message); return; } });
}
const owners = new Set();

// The page's right-click menu: "Zap element", with the part under the click already chosen (the hook of desktop/browser-services/context-commands.cjs; the key shown is the live key of the 'zap' command).
try {
  require('./browser-services/context-commands.cjs').registerPageMenu({id: 'zap', slot: 'page', rows: ctx => (ctx.owner?.preview || !hostKey(ctx.pageURL) ? [] : [ctx.item('zap', ctx.tr('zap.menu'), () => ctx.command({type: 'zap', tabId: ctx.tabId, x: ctx.params.x, y: ctx.params.y}), true, {shortcut: ctx.keyFor('zap')})])});
} catch { /* the menu simply has no such row */ }

function createZapSession(deps) {
  // focus(wc): gives a web contents the keyboard. main passes its focus gate (page-focus.cjs createFocusGate), so a picker that starts or stops while Acira is not the
  // active app only records where the keyboard goes and takes nothing from the app the person is using (webContents.focus() alone activates Acira on macOS).
  const {WebContentsView, getWindow, database, pageOf, pageBounds, dispatch, tm, emit = () => {}, appearance, motion, profileKeyOf, activeTabId, toastShown = () => false, now = Date.now, focus = wc => wc.focus()} = deps;
  const store = sharedZap(database);
  let session = null;        // while picking: {tabId, wc, layer, ready, keys, handlers}
  let layer = null, layerReady = null, layerWc = null, releaseTimer = null;
  const undoStack = [];      // [{profileKey, host, id, rule, at}] newest last
  let undoKey = null;        // for a few seconds after a removal: {wc, handler, timer, typing}: Ctrl+Z there brings it back

  const live = view => view && !view.webContents.isDestroyed();
  const motionNow = () => { const m = motion(); return {ms: m.ms, reduced: m.reduced}; };
  function toPage(wc, message) { try { if (!wc.isDestroyed()) wc.mainFrame.send(CHANNEL, {motion: motionNow(), ...message}); } catch { /* a page that is going away */ } }
  function toLayer(state) { try { if (live(layer)) layer.webContents.send('acira:zap-layer-state', state); } catch { /* closing */ } }
  const theme = () => { const a = appearance(); return {dark: a.dark, accent: a.accent, ui: a.ui, speed: a.speed, reduced: motionNow().reduced, message: tm('zap.bar'), close: tm('zap.stop'), menuStop: tm('zap.menu.stop'), menuUndo: tm('zap.menu.undo'), undoKey: process.platform === 'darwin' ? '\u2318Z' : 'Ctrl+Z', undoable: undoable()}; };

  // ----------------------------------------------------------------------------------------------------------------------------- the layer
  function ensureLayer() {
    const win = getWindow();
    if (!win || win.isDestroyed()) return null;
    clearTimeout(releaseTimer); releaseTimer = null;
    if (!live(layer)) {
      layer = new WebContentsView({webPreferences: {preload: PRELOAD, contextIsolation: true, nodeIntegration: false, sandbox: true, partition: 'acira-zap-layer'}});
      layer.setBackgroundColor('#00000000'); layer.setVisible(false);
      layerWc = layer.webContents;
      layerReady = new Promise(resolve => { const timer = setTimeout(() => resolve(false), 3000); layerWc.once('did-finish-load', () => { clearTimeout(timer); resolve(true); }); layerWc.loadFile(FILE).catch(() => resolve(false)); });
    }
    if (!win.contentView.children.includes(layer)) win.contentView.addChildView(layer);
    return layer;
  }
  function place(bounds) {
    if (!live(layer) || !bounds) return;
    const win = getWindow();
    if (win && win.contentView.children.at(-1) !== layer) win.contentView.addChildView(layer);
    layer.setBounds({x: Math.round(bounds.x), y: Math.round(bounds.y), width: Math.round(bounds.width), height: Math.round(bounds.height)});
  }
  function release() {
    clearTimeout(releaseTimer); releaseTimer = null;
    if (live(layer)) { try { getWindow()?.contentView.removeChildView(layer); } catch { /* gone */ } try { layer.webContents.close(); } catch { /* gone */ } }
    layer = null; layerWc = null; layerReady = null;
  }
  const isLayer = wc => Boolean(layerWc && wc === layerWc);

  // ------------------------------------------------------------------------------------------------------------------------- pages and rules
  function attach(wc, tab) {
    if (registry.pages.has(wc)) return;
    const info = {owner: api, tabId: tab.id, profileKey: () => profileKeyOf(tab)};
    registry.pages.set(wc, info);
    wc.once('destroyed', () => { registry.pages.delete(wc); if (session && session.wc === wc) stop('closed'); });
    wc.on('did-start-navigation', details => { if (session && session.wc === wc && (details?.isMainFrame ?? true) && !details?.isSameDocument) stop('navigated'); });
  }
  function hostOf(wc) { return hostKey(wc.getURL()); }
  /** Tell every page (of every window) on this site, in this profile, what its rules are now; `revealed` lists the rules that were just restored so the page plays the return. */
  function push(profileKey, host, {except = null, revealed = []} = {}) {
    for (const [wc, info] of registry.pages) {
      if (wc === except || wc.isDestroyed() || info.profileKey() !== profileKey) continue;
      const pageHost = hostOf(wc);
      if (!pageHost || !applicableKeys(pageHost).includes(host)) continue;
      const rules = store.rulesFor(profileKey, pageHost);
      toPage(wc, {op: 'sheet', css: compile(rules), rules: forPage(rules), revealed});
    }
  }
  const changed = profileKey => emit({type: 'filters-changed', profileId: profileKey});

  /** Ctrl+Z (Cmd+Z) straight after a removal brings it back, as the toast's Undo does, unless a text field on the page has the keyboard (there it is the field's own undo). */
  function armUndoKey(wc) {
    disarmUndoKey();
    const handler = (event, input) => {
      if (input.type !== 'keyDown' || !(input.control || input.meta) || input.shift || input.alt || String(input.key).toLowerCase() !== 'z') return;
      if (!undoKey || undoKey.typing || session) return;   // while picking the layer and onKey own the key
      if (undoLast()) event.preventDefault();
    };
    undoKey = {wc, handler, typing: false, timer: setTimeout(disarmUndoKey, UNDO_KEY_MS)};
    undoKey.timer.unref?.();
    wc.on('before-input-event', handler);
    toPage(wc, {op: 'typing-watch', on: true});
  }
  function disarmUndoKey() {
    if (!undoKey) return;
    const current = undoKey; undoKey = null; clearTimeout(current.timer);
    try { current.wc.removeListener('before-input-event', current.handler); } catch { /* gone */ }
    toPage(current.wc, {op: 'typing-watch', on: false});
  }
  /** Whether there is a removal the person can still take back (what the menu's "Undo last removal" row needs). */
  const undoable = () => undoStack.some(item => now() - item.at <= UNDO_MS);
  const syncUndoable = () => toLayer({undoable: undoable()});
  function remember(entry) { undoStack.push({...entry, at: now()}); while (undoStack.length > UNDO_KEPT) undoStack.shift(); syncUndoable(); }
  /** The bar rests above any toast while picking (they would sit on each other at the bottom of the page): checked every 300 ms while it lasts, and at once for the toast Zap itself raises. */
  let lifted = false, liftTimer = null;
  function syncLift(now) {
    const up = Boolean(session) && (now === true || toastShown());
    if (up === lifted) return;
    lifted = up; toLayer({lift: up});
  }
  function watchLift() { clearInterval(liftTimer); lifted = false; liftTimer = setInterval(() => syncLift(), 300); liftTimer.unref?.(); syncLift(); }
  function unwatchLift() { clearInterval(liftTimer); liftTimer = null; lifted = false; }
  function toast(text, id, undoId) {
    if (session) syncLift(true);
    dispatch({type: 'toast', text: tm(text), i18n: {id: text}, ...(undoId ? {action: {label: tm('toast.undo'), labelId: 'toast.undo', command: {type: 'zap.undo', id: undoId}}} : {})});
  }

  /** Where a page's own view is in the window (a pane of a split view is its own area, smaller than the page area). */
  function viewBoundsOf(found) { try { const b = found?.view?.getBounds?.(); return b && b.width > 0 && b.height > 0 ? b : null; } catch { return null; } }

  function fromPage(wc, info, message) {
    switch (message.type) {
      case 'hover': {
        if (!session || session.wc !== wc) return;
        const rect = message.rect && typeof message.rect === 'object' ? {x: finite(message.rect.x), y: finite(message.rect.y), width: finite(message.rect.width), height: finite(message.rect.height)} : null;
        const radius = Array.isArray(message.radius) && message.radius.length === 4 ? message.radius.map(value => Math.max(0, Math.min(2000, finite(value)))) : [0, 0, 0, 0];
        toLayer({rect, radius, moved: message.moved === true, keys: session.keys});
        return;
      }
      case 'commit': {
        const host = hostOf(wc), profileKey = info.profileKey(), token = String(message.token || '').slice(0, 24);
        let saved;
        try { saved = store.add(profileKey, host, message.rule); } catch (error) { toPage(wc, {op: 'saved', token, ok: false}); dispatch({type: 'toast', text: String(error?.message || error).slice(0, 160), tone: 'error'}); return; }
        const rules = store.rulesFor(profileKey, host);
        toPage(wc, {op: 'saved', token, ok: true, id: saved.rule.id, css: compile(rules), rules: forPage(rules)});
        push(profileKey, host, {except: wc});
        if (!saved.again) { remember({profileKey, host: saved.rule.host || host, id: saved.rule.id, rule: saved.rule}); armUndoKey(wc); }
        toast(saved.rule.hold === 'firm' ? 'zap.removed' : 'zap.removedForNow', null, saved.again ? null : saved.rule.id);
        changed(profileKey);
        return;
      }
      case 'unlocked': { if (message.value === true && typeof message.id === 'string') { const host = hostOf(wc); store.amend(info.profileKey(), host, message.id, {unlock: true}); } return; }
      case 'learn': {
        const host = hostOf(wc);
        if (typeof message.id === 'string') { try { store.amend(info.profileKey(), host, message.id, {sels: message.sels, deep: message.deep, fp: message.fp}); push(info.profileKey(), host, {except: wc}); } catch { /* an unusable answer is ignored */ } }
        return;
      }
      case 'typing': if (undoKey && undoKey.wc === wc) undoKey.typing = message.value === true; return;
      case 'refused': toast('zap.refused'); return;
      default: return;
    }
  }

  // ------------------------------------------------------------------------------------------------------------------------------ picking
  function onKey(event, input) {
    if (!session || input.type !== 'keyDown') return;
    const mod = input.control || input.meta;
    if (input.key === 'Escape') { event.preventDefault(); if (session.menuOpen) { session.menuOpen = false; toLayer({menu: 'close'}); } else stop('escape'); }
    else if (input.key === 'ArrowUp') { event.preventDefault(); session.keys = true; toPage(session.wc, {op: 'pick-level', delta: 1}); }
    else if (input.key === 'ArrowDown') { event.preventDefault(); session.keys = true; toPage(session.wc, {op: 'pick-level', delta: -1}); }
    else if (input.key === 'Enter') { event.preventDefault(); toPage(session.wc, {op: 'pick-commit'}); }
    else if (input.key === 'PageDown' || (input.key === ' ' && !input.shift)) { event.preventDefault(); toPage(session.wc, {op: 'scroll', dir: 1}); }
    else if (input.key === 'PageUp' || (input.key === ' ' && input.shift)) { event.preventDefault(); toPage(session.wc, {op: 'scroll', dir: -1}); }
    else if (input.key === 'End') { event.preventDefault(); toPage(session.wc, {op: 'scroll', dir: 2}); }
    else if (input.key === 'Home') { event.preventDefault(); toPage(session.wc, {op: 'scroll', dir: -2}); }
    else if (mod && !input.shift && !input.alt && input.key.toLowerCase() === 'z') { event.preventDefault(); undoLast(); }
  }
  /** Starts picking on a tab. `at` (page-view units) pre-selects the part under that point (a right-click). Returns whether it began. */
  async function start(tabId, at) {
    const found = pageOf(tabId);
    if (!found || found.wc.isDestroyed() || !hostOf(found.wc)) return false;
    if (session) { if (session.tabId === tabId) return true; stop('moved'); }
    const bounds = viewBoundsOf(found) || pageBounds();
    if (!bounds || !pageBounds()) return false;
    const view = ensureLayer();
    if (!view) return false;
    session = {tabId, wc: found.wc, view: found.view, keys: false, onKey};
    session.keyTargets = [found.wc, ...(deps.keyTargets ? deps.keyTargets() : [])].filter(Boolean);
    for (const target of session.keyTargets) target.on('before-input-event', onKey);
    place(bounds); view.setVisible(true);
    await layerReady;
    if (!session || !live(layer)) return false;
    toLayer({...theme(), rect: null, barOn: true, keys: false});
    watchLift();
    toPage(found.wc, {op: 'pick-start', width: bounds.width, x: at ? at.x : undefined, y: at ? at.y : undefined});
    try { focus(layer.webContents); } catch { /* the window is not in front */ }
    emit({type: 'zap-picking', tabId, on: true});
    return true;
  }
  function stop() {
    if (!session) return;
    const current = session; session = null;
    for (const target of current.keyTargets || []) { try { target.removeListener('before-input-event', onKey); } catch { /* gone */ } }
    toPage(current.wc, {op: 'pick-end'});
    toLayer({rect: null, barOn: false, lift: false}); unwatchLift();
    clearTimeout(releaseTimer);
    const view = layer;
    setTimeout(() => { if (!session && view === layer && live(layer)) layer.setVisible(false); }, 220).unref?.();
    releaseTimer = setTimeout(() => { if (!session) release(); }, 30000); releaseTimer.unref?.();
    emit({type: 'zap-picking', tabId: current.tabId, on: false});
    try { if (!current.wc.isDestroyed()) focus(current.wc); } catch { /* none */ }
  }
  function fromLayer(message) {
    if (!session || !message || typeof message !== 'object') return;
    switch (message.type) {
      case 'move': toPage(session.wc, {op: 'pick-move', x: finite(message.x), y: finite(message.y)}); break;
      case 'leave': break;
      case 'level': session.keys = message.keys === true; toPage(session.wc, {op: 'pick-level', delta: message.delta}); break;
      case 'commit': toPage(session.wc, {op: 'pick-commit'}); break;
      case 'stop': stop('stop'); break;
      case 'undo': undoLast(); break;
      case 'scroll': toPage(session.wc, {op: 'scroll', dir: message.dir}); break;
      case 'menu': session.menuOpen = message.open === true; if (session.menuOpen) syncUndoable(); break;   // a right-click only offers the choice: picking goes on
      default: break;
    }
  }
  /** The page area moved or resized (the layout was applied): the layer follows. Called on every applied layout. */
  function layout(bounds) {
    if (!session) return;
    if (!bounds) { stop('hidden'); return; }
    place(viewBoundsOf(session) || bounds);
  }
  /** The active tab changed: picking belongs to one tab. */
  function activeChanged(id) { if (session && id !== session.tabId) stop('switched'); }

  // ------------------------------------------------------------------------------------------------------------------------------ restoring
  function restoreRule(profileKey, host, id) {
    const rule = store.remove(profileKey, host, id);
    if (!rule) return null;
    push(profileKey, host, {revealed: [rule]});
    changed(profileKey);
    return rule;
  }
  function undo(id) {
    const at = undoStack.findIndex(item => item.id === id);
    if (at < 0) return false;
    const [item] = undoStack.splice(at, 1);
    syncUndoable();
    if (now() - item.at > UNDO_MS) return false;
    return Boolean(restoreRule(item.profileKey, item.host, item.id));
  }
  function undoLast() { const item = undoStack[undoStack.length - 1]; return item ? undo(item.id) : false; }
  /** The site controls: what applies on a tab's site, and restoring one, or all. */
  function siteStatus(tabId) {
    const found = pageOf(tabId);
    const host = found && !found.wc.isDestroyed() ? hostOf(found.wc) : '', profileKey = keyOf(tabId);
    if (!host || !profileKey) return {supported: false, host: '', picking: false, private: false, rules: []};
    return {supported: true, host, picking: Boolean(session && session.tabId === tabId), private: store.isPrivate(profileKey), rules: store.listFor(profileKey, host)};
  }
  const keyOf = tabId => { const found = pageOf(tabId); return found ? registry.pages.get(found.wc)?.profileKey() || '' : ''; };
  function restore(tabId, host, id) { const key = keyOf(tabId); if (key) restoreRule(key, host, id); return siteStatus(tabId); }
  function restoreAll(tabId) {
    const key = keyOf(tabId), status = siteStatus(tabId);
    if (!key || !status.supported) return status;
    const revealedByHost = new Map();
    for (const item of status.rules) { const rule = store.remove(key, item.host, item.id); if (rule) { if (!revealedByHost.has(item.host)) revealedByHost.set(item.host, []); revealedByHost.get(item.host).push(rule); } }
    for (const [host, revealed] of revealedByHost) push(key, host, {revealed});
    if (revealedByHost.size) changed(key);
    return siteStatus(tabId);
  }
  /** Settings: everything of a profile. */
  function listAll(profileKey) { return {sites: store.listAll(profileKey)}; }
  function restoreInSettings(profileKey, host, id) { restoreRule(profileKey, host, id); return listAll(profileKey); }
  function restoreSite(profileKey, host) { const rules = store.removeHost(profileKey, host); if (rules.length) { push(profileKey, host, {revealed: rules}); changed(profileKey); } return listAll(profileKey); }
  function clearAll(profileKey) { const removed = []; for (const site of store.listAll(profileKey)) removed.push([site.host, store.removeHost(profileKey, site.host)]); for (const [host, rules] of removed) push(profileKey, host, {revealed: rules}); if (removed.length) changed(profileKey); return listAll(profileKey); }
  function forgetPrivate(profileKey) { store.forgetPrivate(profileKey); }
  const picking = () => Boolean(session);
  function destroy() { stop('closed'); disarmUndoKey(); release(); owners.delete(api); for (const [wc, info] of [...registry.pages]) if (info.owner === api) registry.pages.delete(wc); }

  const api = {attach, start, stop, fromPage, fromLayer, isLayer, layout, activeChanged, undo, undoLast, siteStatus, restore, restoreAll, listAll, restoreInSettings, restoreSite, clearAll, forgetPrivate, picking, destroy, store};
  owners.add(api);
  return api;
}

module.exports = {createZapSession, install, earlyAnswer, registry, CHANNEL, EVENT, LAYER, EARLY};
