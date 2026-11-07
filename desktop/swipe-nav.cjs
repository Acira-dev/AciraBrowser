'use strict';
// Two-finger swipe between pages (macOS "Swipe between pages"). Chrome does this in its own layer, above Chromium's content code, so
// Electron has no history swiping: its `swipe` event is the three-finger gesture only, and a plain two-finger swipe did nothing in
// Acira. This module is the whole feature, in three parts that can be tested apart:
//
//   pageCanScroll()      the overscroll rule: a swipe belongs to the page while the page can still scroll that way (a carousel, a map,
//                        a code block, a page wider than the window), or has cancelled the wheel, or has asked for no overscroll
//                        chaining (`overscroll-behavior-x`). Only a page at its edge, with nothing to scroll, lets the swipe through.
//   createSwipeTracker() the gesture: the trackpad's phases and deltas in, "show the arrow / how far / armed / open the list / go back
//                        N pages / cancel" out. Pure; time and effects are injected.
//   createSwipeNav()     the arrow chip and the list of earlier pages, drawn by desktop/swipe-nav.html in two small native views above
//                        the page (made like the tab hover card), and the navigation itself.
//
// The scroll phases come from a native event monitor (desktop/native/mac-material.mm, watchScroll): NSEvent's phase and momentumPhase
// are what tell a finger on the pad from the coast after it lifts, and Electron's wheel events do not carry them. What the page can still
// scroll comes from the page preload (page-input-preload.cjs), which sends a small snapshot of the scrollers under the pointer.
//
// Direction is the content's: dx > 0 moves the page to the right, which is the pull toward its LEFT edge, which is Back. With natural
// scrolling that is fingers to the right; with it off it is fingers to the left, as in Safari and Chrome.

/** Points of horizontal travel for the arrow to be full ("past the threshold"), and before the direction counts at all. */
const COMMIT = 100, ENGAGE = 10;
/** Still and past the threshold for this long: the list of earlier pages opens (ms). A row is this many points of vertical travel. */
const HOLD_MS = 450, ROW_STEP = 36;
/** How long a swipe waits for the page's scroll snapshot before it is left to the page (ms); how old a snapshot may be (ms). */
const FACTS_MS = 160, FACTS_FRESH_MS = 250;
/** After the fingers lift short of the threshold, the coast of the swipe may still carry it over (ms between momentum events). */
const COAST_MS = 220;
/** Movement smaller than this (points per event) is the finger resting, not moving. */
const NOISE = 2;
const MAX_ROWS = 6;
/** How long before the hold fires the list's view starts to be made (ms). */
const WARM_MS = 250;

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

/** NSEventPhase bits to words (began 1, stationary 2, changed 4, ended 8, cancelled 16, mayBegin 32). */
function phaseName(bits) {
  const n = Number(bits) || 0;
  return n & 1 ? 'began' : n & 2 ? 'stationary' : n & 4 ? 'changed' : n & 8 ? 'ended' : n & 16 ? 'cancelled' : n & 32 ? 'mayBegin' : 'none';
}

/** The native monitor's numbers as one sample: positions are window pixels from the top left, deltas are points. */
function decodeSample(phase, momentum, dx, dy, x, y, natural) {
  return {phase: phaseName(phase), momentum: phaseName(momentum), dx: Number(dx) || 0, dy: Number(dy) || 0, x: Number(x) || 0, y: Number(y) || 0, natural: natural !== 0 && natural !== false};
}

/** Is the macOS setting on, on a Mac? A missing method or a throw is off: nothing happens rather than something unasked for. */
function swipeEnabled(platform, prefs) {
  if (platform !== 'darwin') return false;
  try { return prefs?.isSwipeTrackingFromScrollEventsEnabled?.() === true; } catch { return false; }
}

/**
 * The overscroll rule. `facts` is what the page preload saw for one horizontal wheel: `prevented` (the page cancelled the wheel) and `chain`,
 * the scrollers from the element under the pointer outward, the page's own last: {scrolls, left, max, rtl, behavior} where `scrolls` says
 * the element scrolls sideways at all (overflow auto or scroll, or the page's own scroller not hidden), `left` is its scrollLeft, `max` how
 * far it can scroll, `rtl` whether its scroll offsets run negative, `behavior` its overscroll-behavior-x. `direction` is 'back' (toward the
 * left edge) or 'forward'. True when the swipe is the page's to keep.
 */
function pageCanScroll(facts, direction) {
  if (!facts || facts.prevented) return true;
  const chain = Array.isArray(facts.chain) ? facts.chain : [];
  for (const node of chain) {
    // Not a sideways scroller, or nothing to scroll: the wheel chains on to the next one out.
    if (!node || !node.scrolls || !(Number(node.max) > 1)) continue;
    const left = Number(node.left) || 0, max = Number(node.max), start = node.rtl ? -max : 0, end = node.rtl ? 0 : max;
    if (direction === 'back' ? left > start + 1 : left < end - 1) return true;
    // At its edge: a scroller that stops the chain (contain, none) also stops the swipe, as Chrome does.
    if (node.behavior && node.behavior !== 'auto') return true;
  }
  return false;
}

/**
 * One gesture at a time, from the pad's phases. `opts`: enabled() (the setting, checked at the start), begin(sample) (false: not over a page),
 * canGo(direction), verdict(direction) ('go' | 'blocked' | 'wait', from the page's scroll snapshot), rows(direction) (how many earlier
 * pages a list would show), emit(effect), now/after/clear (time), config (the numbers above).
 * Effects: start {direction}, progress {progress 0..1}, armed {on}, list {open, count}, select {index}, commit {direction, steps}, cancel.
 */
function createSwipeTracker(opts = {}) {
  const cfg = {commit: COMMIT, engage: ENGAGE, holdMs: HOLD_MS, warmMs: WARM_MS, rowStep: ROW_STEP, factsMs: FACTS_MS, coastMs: COAST_MS, noise: NOISE, ...opts.config};
  const now = opts.now || Date.now, after = opts.after || ((fn, ms) => setTimeout(fn, ms)), clear = opts.clear || (timer => clearTimeout(timer));
  const emit = effect => { try { opts.emit?.(effect); } catch { /* an effect that fails never breaks the gesture */ } };
  let st = 'idle', dir = null, x = 0, y = 0, p = 0, shown = false, armed = false, held = false, sel = 0, rows = 0, heldY = 0, natural = true;
  let hold = null, warm = null, wait = null, coast = null;

  const timers = () => { clear(hold); clear(warm); clear(wait); clear(coast); hold = warm = wait = coast = null; };
  const reset = () => { timers(); st = 'idle'; dir = null; x = y = p = 0; shown = armed = held = false; sel = rows = heldY = 0; };
  const along = () => dir === 'back' ? x : -x;
  const done = () => { timers(); st = 'off'; shown = armed = held = false; };
  const cancel = () => { const was = shown; done(); if (was) emit({type: 'cancel'}); };
  const commit = steps => { const direction = dir; done(); emit({type: 'commit', direction, steps}); };
  const progress = () => {
    const next = clamp(along() / cfg.commit, 0, 1);
    if (next !== p) { p = next; emit({type: 'progress', progress: p}); }
  };
  const armHold = () => {
    clear(hold); clear(warm);
    // The list's view is made a little before it is needed, so a swipe that is simply let go never pays for it.
    warm = after(() => { warm = null; if (st === 'tracking' && armed && !held) emit({type: 'warm'}); }, Math.max(0, cfg.holdMs - cfg.warmMs));
    hold = after(() => {
      hold = null;
      if (st !== 'tracking' || !armed || held) return;
      rows = Math.min(MAX_ROWS, Number(opts.rows?.(dir)) || 0);
      if (rows >= 2) { held = true; sel = 0; heldY = 0; emit({type: 'list', open: true, count: rows}); }
    }, cfg.holdMs);
  };

  function decide() {
    const ax = Math.abs(x), ay = Math.abs(y);
    if (ay >= cfg.engage && ay > ax) { st = 'off'; return; }          // up and down: the page's scroll
    if (ax < cfg.engage || ax < ay * 1.2) return;                       // not far enough, or not clearly sideways yet
    dir = x > 0 ? 'back' : 'forward';
    if (!opts.canGo?.(dir)) { st = 'off'; return; }                     // nowhere to go: nothing is shown
    st = 'probing';
    resolveFacts();
  }
  function resolveFacts() {
    const verdict = opts.verdict?.(dir) || 'wait';
    if (verdict === 'blocked') { clear(wait); wait = null; st = 'off'; return; }
    if (verdict === 'go') {
      clear(wait); wait = null; st = 'tracking'; shown = true;
      emit({type: 'start', direction: dir});
      progress();
      return;
    }
    // The page's snapshot has not come yet: the swipe waits a moment for it, and with none it is left to the page.
    if (!wait) wait = after(() => { wait = null; if (st === 'probing') st = 'off'; }, cfg.factsMs);
  }
  function track(dx, dy) {
    const sideways = along();
    if (sideways < -cfg.engage) { cancel(); return; }                   // the fingers went back the other way
    if (!held && Math.abs(y) > Math.max(sideways, 0) * .9 + cfg.engage * 2) { cancel(); return; } // more up-down than sideways
    progress();
    const moving = Math.abs(dx) + Math.abs(dy) >= cfg.noise;
    if (!armed && p >= 1) { armed = true; emit({type: 'armed', on: true}); armHold(); }
    else if (armed && !held && p < .9) { armed = false; emit({type: 'armed', on: false}); clear(hold); clear(warm); hold = warm = null; }
    else if (armed && !held && moving) armHold();
    if (held) {
      heldY = clamp(heldY + (natural ? dy : -dy), 0, rows * cfg.rowStep - 1);   // fingers down moves down the list; no dead travel past either end
      const index = clamp(Math.floor(heldY / cfg.rowStep), 0, rows - 1);
      if (index !== sel) { sel = index; emit({type: 'select', index}); }
      if (p < .5) { held = false; armed = false; emit({type: 'list', open: false}); emit({type: 'armed', on: false}); }
    }
  }
  function lift() {
    clear(hold); clear(warm); hold = warm = null;
    if (st === 'tracking') {
      if (held) { commit(sel + 1); return; }
      if (armed) { commit(1); return; }
      // Short of the threshold with the fingers up: the swipe's coast can still carry it over; with no coast it is let go.
      if (along() > cfg.engage) { st = 'coasting'; coast = after(() => { coast = null; if (st === 'coasting') cancel(); }, cfg.coastMs); return; }
      cancel();
      return;
    }
    if (st === 'probing' || st === 'watching') st = 'off';
  }
  function coasting(dx, dy) {
    x += dx; y += dy;
    clear(coast); coast = after(() => { coast = null; if (st === 'coasting') cancel(); }, cfg.coastMs);
    progress();
    if (p >= 1) commit(1);
  }
  function move(dx, dy) {
    x += dx; y += dy;
    if (st === 'watching') decide();
    else if (st === 'probing') resolveFacts();
    else if (st === 'tracking') track(dx, dy);
  }

  /** One scroll event: {phase, momentum, dx, dy, x, y, natural} (see decodeSample). */
  function feed(sample) {
    const phase = sample.phase || 'none', momentum = sample.momentum || 'none', dx = Number(sample.dx) || 0, dy = Number(sample.dy) || 0;
    if (phase === 'began') {
      reset(); natural = sample.natural !== false;
      if (!opts.enabled?.() || opts.begin?.(sample) === false) { st = 'off'; return; }
      st = 'watching';
      move(dx, dy);
      return;
    }
    if (phase === 'cancelled') { if (st === 'tracking' || st === 'coasting') cancel(); else if (st !== 'idle') done(); return; }
    if (phase === 'changed') { move(dx, dy); return; }
    if (phase === 'ended') { move(dx, dy); lift(); return; }
    if (momentum !== 'none') {
      if (st === 'tracking') lift();                                    // the lift was not reported: the coast says it
      if (st === 'coasting') { if (momentum === 'ended') cancel(); else coasting(dx, dy); }
    }
  }
  /** The page's scroll snapshot arrived (or changed): a swipe that was waiting goes on, a swipe the page now owns stops. */
  function factsChanged() {
    if (st === 'probing') resolveFacts();
    else if (st === 'tracking' && opts.verdict?.(dir) === 'blocked') cancel();
  }
  /** Something else took the screen (a menu, another tab, the window closing): let the gesture go. */
  function abort() { if (st === 'tracking' || st === 'coasting') cancel(); else if (st !== 'idle') done(); }

  return {
    feed, factsChanged, abort, reset,
    get state() { return st; },
    get direction() { return dir; },
    get config() { return cfg; },
    get snapshot() { return {state: st, direction: dir, progress: p, armed, held, selected: sel, shown}; },
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
const path = require('node:path');
const FILE = path.join(__dirname, 'swipe-nav.html'), PRELOAD = path.join(__dirname, 'swipe-nav-preload.cjs');
// Interface pixels (the pages are zoomed with the interface, so a view is `px × uiScale` window pixels).
const STRIP = 76, CHIP = 36, SHADOW = 28, REST = 12, LIST_GAP = 10, LIST_WIDTH = 300, ROW = 44, LIST_PAD = 4, EDGE = 8;
const IDLE_MS = 60000, EXIT_MS = 180;

/** Where the chip's strip and the list go, in window pixels. `page` is the page view's box; `side` is the edge the swipe pulls from.
 * The strip is a fixed rectangle at the page's edge, so the chip slides in from the page's own border and nothing about it ever resizes;
 * the list sits beside the chip's resting place, centred on it, and stays inside the page. Pure. */
function swipePlacement({page, side, rows = 0, scale = 1}) {
  const k = scale, strip = Math.round(STRIP * k), tall = Math.round((CHIP + 2 * SHADOW) * k);
  const middle = page.y + page.height / 2;
  const chip = {x: side === 'right' ? page.x + page.width - strip : page.x, y: Math.round(middle - tall / 2), width: strip, height: tall};
  const width = Math.min(LIST_WIDTH, Math.max(160, (page.width / k) - (REST + CHIP + LIST_GAP) - REST - 2 * SHADOW)), height = LIST_PAD * 2 + ROW * rows;
  const margin = SHADOW * k, listW = Math.round(width * k), listH = Math.round(height * k);
  const lx = side === 'right' ? page.x + page.width - Math.round((REST + CHIP + LIST_GAP) * k) - listW : page.x + Math.round((REST + CHIP + LIST_GAP) * k);
  const ly = clamp(Math.round(middle - listH / 2), page.y + Math.round(EDGE * k), Math.max(page.y + Math.round(EDGE * k), page.y + page.height - listH - Math.round(EDGE * k)));
  return {chip, list: {x: lx - margin, y: ly - margin, width: listW + 2 * margin, height: listH + 2 * margin}};
}

/** A history entry's address for a row: no scheme, no www, no bare slash. */
function rowAddress(url) {
  try { const u = new URL(url); return (u.host.replace(/^www\./, '') + (u.pathname === '/' ? '' : u.pathname) + u.search).slice(0, 200); } catch { return String(url || '').slice(0, 200); }
}

/** The earlier (back) or later (forward) pages of a web page's own history, nearest first; null unless every row is a website. Pure. */
function historyRows(entries, active, direction, limit = MAX_ROWS) {
  if (!Array.isArray(entries) || !Number.isInteger(active) || active < 0 || active >= entries.length) return null;
  const step = direction === 'back' ? -1 : 1, rows = [];
  for (let i = active + step; i >= 0 && i < entries.length && rows.length < limit; i += step) {
    const entry = entries[i];
    if (!entry || !/^https?:\/\//i.test(entry.url || '')) break;
    rows.push({index: i, steps: Math.abs(i - active), title: String(entry.title || '').slice(0, 300), url: entry.url, address: rowAddress(entry.url)});
  }
  return rows;
}

/**
 * The arrow and the list. Dependencies (all of the window it belongs to): WebContentsView and getWindow(); pageAt(x, y) → {tabId, bounds,
 * contents} for the website under a window point, or null; cursor() the pointer in window pixels (the fallback for a point that misses); pageOf(tabId) the same by tab; canGo(tabId, direction); history(tabId, direction) → {rows} for the held list
 * (or null); navigate(tabId, direction, row) (row null: one step); icons(rows, tabId) → {host: dataURL}; enabled() (the setting); blocked()
 * (a menu, a card, a closing window); isDark(), motion() ('premium' | 'fast' | 'off'), uiScale(), tokens() (the interface's popup colours).
 */
function createSwipeNav(deps) {
  const {WebContentsView, getWindow} = deps;
  const now = deps.now || Date.now, after = deps.after || ((fn, ms) => setTimeout(fn, ms)), clear = deps.clear || (timer => clearTimeout(timer));
  const views = {chip: null, list: null};   // role -> {view, ready, queue}
  let gesture = null, facts = null, scale = 1, idleTimer = null, exitTimer = null, visible = {chip: false, list: false}, listed = null;

  const scaleNow = () => Number(deps.uiScale?.()) || 1;
  const live = role => { const slot = views[role]; return slot && !slot.view.webContents.isDestroyed() ? slot : null; };

  function prepare(role) {
    clear(idleTimer); idleTimer = after(destroy, IDLE_MS); idleTimer?.unref?.();
    if (live(role)) return views[role];
    const win = getWindow();
    if (!win || win.isDestroyed()) return null;
    scale = scaleNow();
    const view = new WebContentsView({webPreferences: {preload: PRELOAD, contextIsolation: true, nodeIntegration: false, sandbox: true, partition: 'acira-swipe-nav', zoomFactor: scale}});
    view.setBackgroundColor?.('#00000000'); view.setBounds?.({x: 0, y: 0, width: Math.round(STRIP * scale), height: Math.round((CHIP + 2 * SHADOW) * scale)}); view.setVisible?.(false);
    const slot = {view, ready: false, queue: []};
    views[role] = slot;
    const wc = view.webContents;
    wc.setZoomFactor?.(scale);
    wc.ipc.on('acira:swipe-nav', (_event, message) => {
      if (views[role] !== slot || message !== 'ready') return;
      wc.setZoomFactor?.(scale);   // Chromium restores the zoom it kept for this origin as the page loads
      slot.ready = true;
      for (const item of slot.queue.splice(0)) try { wc.send('acira:swipe-nav-state', item); } catch { /* a closed view */ }
    });
    wc.setWindowOpenHandler?.(() => ({action: 'deny'}));
    wc.on?.('will-navigate', event => event.preventDefault());
    try { win.contentView.addChildView(view); } catch { /* the window is closing */ }
    wc.loadFile(FILE, {query: {role}}).catch(() => {});
    return slot;
  }
  function destroy() {
    clear(idleTimer); clear(exitTimer); idleTimer = exitTimer = null; visible = {chip: false, list: false};
    for (const role of Object.keys(views)) {
      const slot = views[role]; views[role] = null;
      if (!slot) continue;
      try { getWindow()?.contentView.removeChildView(slot.view); } catch { /* gone */ }
      try { if (!slot.view.webContents.isDestroyed()) slot.view.webContents.close(); } catch { /* gone */ }
    }
  }
  function send(role, message) {
    const slot = live(role);
    if (!slot) return;
    if (!slot.ready) { if (message.type === 'progress') { const last = slot.queue[slot.queue.length - 1]; if (last?.type === 'progress') { last.progress = message.progress; return; } } slot.queue.push(message); return; }
    try { slot.view.webContents.send('acira:swipe-nav-state', message); } catch { /* a closed view */ }
  }
  // The look: dark or light, the motion, and the interface's own popup colours (--overlay, --text, --muted, --menu-hover, --float-shadow), so the arrow and the list are the same surface as a menu.
  const common = () => { let tokens = null; try { tokens = deps.tokens?.() || null; } catch { /* the page has its own */ } return {dark: deps.isDark?.() !== false, motion: deps.motion?.() || 'premium', tokens}; };
  function show(role, bounds) {
    const slot = live(role);
    if (!slot) return;
    slot.view.setBounds(bounds);
    const win = getWindow();
    try { win?.contentView.addChildView(slot.view); } catch { /* the window is closing */ }
    slot.view.setVisible?.(true); visible[role] = true;
  }
  function hideView(role) {
    const slot = live(role);
    visible[role] = false;
    if (slot) try { slot.view.setVisible?.(false); } catch { /* gone */ }
  }
  /** Every effect of the gesture ends here. `leave` says how the views go: the arrow sinks back (cancel) or is spent (commit). */
  function finish(leave) {
    clear(exitTimer); exitTimer = null;
    for (const role of ['chip', 'list']) if (visible[role]) send(role, {type: 'leave', leave, ...common()});
    const wait = deps.motion?.() === 'off' ? 0 : EXIT_MS, run = () => { exitTimer = null; hideView('chip'); hideView('list'); };
    if (wait) { exitTimer = after(run, wait); exitTimer?.unref?.(); } else run();
  }

  const tracker = createSwipeTracker({
    now, after, clear, config: deps.config,
    enabled: () => Boolean(deps.enabled?.()) && !deps.blocked?.(),
    begin: sample => {
      // The point the monitor read from the event; where the pointer is, when that misses every page (AppKit sends a scroll to the view under the pointer).
      let page = deps.pageAt?.(sample.x, sample.y);
      if (!page) { const pointer = deps.cursor?.(); if (pointer) page = deps.pageAt?.(pointer.x, pointer.y); }
      if (!page) return false;
      facts = facts && facts.tabId === page.tabId ? facts : null;
      gesture = {tabId: page.tabId, startedAt: now()}; listed = null;
      return true;
    },
    canGo: direction => Boolean(gesture) && Boolean(deps.canGo?.(gesture.tabId, direction)),
    verdict: direction => {
      if (!gesture || !facts || facts.tabId !== gesture.tabId) return 'wait';
      if (now() - facts.at > FACTS_FRESH_MS || facts.toward !== (direction === 'back' ? -1 : 1)) return 'wait';
      return pageCanScroll(facts, direction) ? 'blocked' : 'go';
    },
    rows: direction => { listed = gesture ? deps.history?.(gesture.tabId, direction) : null; return listed?.rows?.length || 0; },
    emit: effect => {
      if (!gesture && effect.type !== 'cancel') return;
      if (effect.type === 'start') {
        const page = deps.pageOf?.(gesture.tabId);
        if (!page) { tracker.abort(); return; }
        gesture.page = page; gesture.side = effect.direction === 'back' ? 'left' : 'right';
        if (!prepare('chip')) return;
        clear(exitTimer); exitTimer = null;
        const placed = swipePlacement({page: page.bounds, side: gesture.side, scale: scaleNow()});
        show('chip', placed.chip);
        send('chip', {type: 'show', side: gesture.side, ...common()});
      } else if (effect.type === 'progress') send('chip', {type: 'progress', progress: effect.progress});
      else if (effect.type === 'armed') send('chip', {type: 'armed', on: effect.on});
      else if (effect.type === 'warm') { if (deps.history?.(gesture.tabId, tracker.direction)?.rows?.length >= 2) prepare('list'); }
      else if (effect.type === 'list') {
        if (!effect.open) { send('list', {type: 'leave', leave: 'cancel', ...common()}); after(() => hideView('list'), deps.motion?.() === 'off' ? 0 : EXIT_MS); return; }
        const slot = prepare('list');
        if (!slot || !listed?.rows?.length) return;
        const rows = listed.rows.slice(0, effect.count).map(row => ({...row}));
        const icons = deps.icons?.(rows, gesture.tabId) || {};
        for (const row of rows) { try { row.icon = icons[new URL(row.url).hostname.replace(/^www\./, '').toLowerCase()] || ''; } catch { row.icon = ''; } }
        const placed = swipePlacement({page: gesture.page.bounds, side: gesture.side, rows: rows.length, scale: scaleNow()});
        show('list', placed.list);
        send('list', {type: 'list', side: gesture.side, rows: rows.map(({title, address, icon}) => ({title, address, icon})), selected: 0, ...common()});
      } else if (effect.type === 'select') send('list', {type: 'select', index: effect.index});
      else if (effect.type === 'commit') {
        const tab = gesture.tabId, row = effect.steps > 1 ? listed?.rows?.[effect.steps - 1] || null : null;
        finish('commit');
        try { deps.navigate?.(tab, effect.direction, row); } catch { /* the tab went away */ }
      } else if (effect.type === 'cancel') finish('cancel');
    },
  });

  return {
    /** One native scroll sample (see decodeSample). */
    sample: raw => { try { tracker.feed(raw); } catch { tracker.abort(); } },
    /** The page's scroll snapshot for the wheel it just saw: {toward, prevented, chain} from the page of `tabId`. */
    facts: (tabId, payload) => {
      if (!payload || typeof payload !== 'object' || (payload.toward !== -1 && payload.toward !== 1) || !Array.isArray(payload.chain) || payload.chain.length > 32) return;
      facts = {tabId, at: now(), toward: payload.toward, prevented: payload.prevented === true, chain: payload.chain.map(node => ({scrolls: node?.scrolls === true, left: Number(node?.left) || 0, max: Number(node?.max) || 0, rtl: node?.rtl === true, behavior: ['auto', 'contain', 'none'].includes(node?.behavior) ? node.behavior : 'auto'}))};
      tracker.factsChanged();
    },
    /** After every committed action: another tab in front, or this one gone, ends the gesture. */
    onState: (previous, next) => {
      if (!gesture) return;
      if ((previous && previous.activeTabId !== next.activeTabId) || !next.tabs.some(tab => tab.id === gesture.tabId)) tracker.abort();
      if (views.chip && scaleNow() !== scale) destroy();
    },
    /** The window's layout changed: the views stay above the page, or the gesture ends if a menu took the space. */
    relayout: () => {
      if (!visible.chip && !visible.list) return;
      if (deps.blocked?.()) { tracker.abort(); return; }
      const win = getWindow();
      for (const role of ['chip', 'list']) if (visible[role] && live(role)) try { win.contentView.addChildView(views[role].view); } catch { /* gone */ }
    },
    abort: () => tracker.abort(),
    dispose: destroy,
    get active() { return tracker.state !== 'idle' && tracker.state !== 'off'; },
    get tracker() { return tracker; },
    get views() { return {chip: live('chip')?.view.webContents || null, list: live('list')?.view.webContents || null}; },
  };
}

module.exports = {
  createSwipeTracker, createSwipeNav, pageCanScroll, swipeEnabled, decodeSample, phaseName, swipePlacement, historyRows, rowAddress,
  COMMIT, ENGAGE, HOLD_MS, WARM_MS, ROW_STEP, FACTS_MS, FACTS_FRESH_MS, COAST_MS, NOISE, MAX_ROWS, STRIP, CHIP, SHADOW, REST, LIST_GAP, LIST_WIDTH, ROW,
};
