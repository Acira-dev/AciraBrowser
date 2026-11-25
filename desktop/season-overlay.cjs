'use strict';
// Noël, "Snowfall: Over the whole window" (the opt-in snow): the snow that crosses the toolbar and the page. The page itself is never touched: the flakes are drawn in a
// separate transparent window glued to the page area (a BaseWindow child of the browser window holding one WebContentsView), above the page views, that
//   - takes no input at all (setIgnoreMouseEvents, not focusable, no shadow, not in the task bar) and, like everything a person sees, shows in a screenshot or a recording (D169, the team 24 Nov 03:58: no content protection; a
//     recording without the snow read as a fault; it still rests while Acira itself shares its window);
//   - exists only while it snows: it is made when the choice is on and the snow may fall, and torn down once its last flake has melted, so at rest it costs nothing;
//   - hides for the length of a window move or resize and comes back after (a Windows child window does not follow its parent by itself; on a Mac the system does, and this file only
//     re-fits it), and for the length of any change of the page area's size (a sidebar motion), so it is never seen out of place.
// It is drawn fainter over a website and never settles on one. With Keep snowing (Settings, on by default; the team 24 Nov: "it should be constantly snowing") it falls whenever
// the window can be seen: it stops only while a PAGE is in full screen (a video; the window's own full screen keeps it), while the person types in the page (back 2 s after the
// last key), while Acira shares its window, with either Reduce motion, in a private or secured tab, and when the window is hidden, minimised or (on a Mac) fully covered.
// With Keep snowing off it also stops when the window is not the active one, while the active tab plays sound, and after 2 min without input (30 s on battery).
// All decisions are made here from the app's own state, injected as functions, so a test can drive them (tests/season-overlay.test.cjs).
const path = require('node:path');

const TYPING_QUIET_MS = 2000, MOVE_QUIET_MS = 220, MELT_MS = 4200, TICK_MS = 500, CHECK_MS = 3000;
// D169 (the team, 24 Nov 00:45): a person who chose snow over the whole window is watching it, so it rests after 2 min without input on mains power and 30 s on battery
// (the sidebar's own snow keeps the app's 10 s rest); it comes back on the next input (the 2 Hz tick sees it).
const REST_MAINS_MS = 2 * 60 * 1000, REST_BATTERY_MS = 30 * 1000;

/** The rules, in the order they are read: the first that says no is the reason it does not snow (`whyNoSnow`). Each name is what a read-out and the log say. */
const RULES = [
  ['choice-off', s => !s.settings || s.settings.noelOn !== true || s.settings.noelSnow !== 'window'],
  // D196 (25 Nov, a Linux user, 14.4 AppImage: "the main window just shows snow, does not tile and covers any URL you attempt to view"): on Linux the snow's own window is
  // a top-level window to the window manager, which may tile it, place it, blur what is behind it (his screenshot: the wallpaper, blurred, over the whole page) or, on Wayland,
  // not glue it to the browser window at all. So on Linux there is no separate snow window; the snow falls in the sidebar (the interface draws it there for this choice too).
  ['linux-own-window', s => !windowSnowSupported(s.platform)],
  ['reduce-motion', s => !!s.reducedMotion],                       // Acira's own Reduce motion
  ['system-reduce-motion', s => !!s.reducedMotionSetting],         // the system's
  ['window-hidden', s => !s.windowVisible],
  ['minimized', s => !!s.minimized],
  ['not-active-window', s => !s.focused && !s.keep],              // Keep snowing (on by default): it falls while the window can be seen, keys elsewhere or not
  ['idle', s => !!s.idle && !s.keep],                                         // 2 min without input, 30 s on battery (REST_MAINS_MS / REST_BATTERY_MS)
  ['fullscreen', s => !!s.fullscreen],                             // a PAGE in full screen (a video); the window's own full screen (a Mac's green button) is not
  ['sharing', s => !!s.sharing],
  ['sign-in', s => !!s.authActive],
  ['no-page-area', s => !s.pageBounds],
  ['page-too-small', s => !(s.pageBounds.width > 80 && s.pageBounds.height > 80)],
  ['sound', s => !!s.audible && !s.keep],                                     // the active tab plays sound a person can hear (main leaves a muted tab out)
  ['media', s => !!s.mediaPlaying],
  ['typing', s => s.now - (s.lastKeyInPage || -1e9) < TYPING_QUIET_MS],
  ['moving', s => !!s.moving],
  ['secured-workspace-tab', s => !!s.securedTab],                 // a tab of a secured workspace (it counts as private)
  ['private-tab', s => !!s.privateTab],
];
/** Whether the snow over the whole window (its own window) may be made on this platform: not on Linux (D196). */
function windowSnowSupported(platform) { return platform !== 'linux'; }
/** The first rule that says no, by name, or '' when the overlay may snow. Pure: `s` is a plain record of what the app knows (`info()` below). */
function whyNoSnow(s) { for (const [name, no] of RULES) if (no(s)) return name; return ''; }
/** Whether the overlay may snow now. Pure. */
function mayFall(s) { return whyNoSnow(s) === ''; }
/** Where the overlay stands (screen px): over the toolbar and the page, from the window's top edge to the page's bottom, on the page's own columns. */
function overlayBounds(content, page) {
  const x = Math.round(content.x + page.x), y = Math.round(content.y);
  // D176 (b): each edge is rounded on its own, so at a fractional scale the right or the bottom edge could stand a pixel past the window's content area (on Windows a
  // transparent child window there can show as a line). Both edges are kept inside the content area: a window that is already inside is not changed by this.
  const right = Math.min(Math.round(content.x + page.x + page.width), Math.floor(content.x + content.width)), bottom = Math.min(Math.round(content.y + page.y + page.height), Math.floor(content.y + content.height));
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
}

function createSeasonOverlay(deps) {
  const { BaseWindow, WebContentsView, ipcMain, session, getWindow, state, pageBounds, activeTabInfo, flags, nowMs = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout, dark = () => true, osReducedMotion = () => false, forceActive = () => false, idleNow = null, quietMs = null, onBattery = () => false, log = null, platform = process.platform, follow = () => process.platform !== 'darwin' || globalThis.__noelFollow === true, html = path.join(__dirname, 'season-overlay.html'), preload = path.join(__dirname, 'season-overlay-preload.cjs') } = deps;
  let win = null, view = null, running = false, lastError = '', choiceOn = false, checkTimer = null, hiddenForMove = false, moveTimer = null, tick = null, meltTimer = null, lastKey = -1e9, lastBounds = '', idle = false, ready = false, queued = null, destroyed = false;
  const main = () => { const w = getWindow(); return w && !w.isDestroyed() ? w : null; };
  const battery = () => { try { return !!onBattery(); } catch { return false; } };
  const restNow = () => quietMs ? quietMs() >= (battery() ? REST_BATTERY_MS : REST_MAINS_MS) : idleNow ? !!idleNow() : idle;
  const info = () => {
    const w = main(), tab = activeTabInfo ? activeTabInfo() : {}, f = flags ? flags() : {};
    const page = pageBounds();
    return { platform, settings: state().settings, reducedMotionSetting: !!osReducedMotion(), reducedMotion: !!(state().settings && state().settings.reducedMotion), windowVisible: !!w && w.isVisible(), minimized: !!w && w.isMinimized(), focused: !!w && (w.isFocused() || forceActive()), idle: restNow(), fullscreen: !!f.pageFullscreen, keep: !(state().settings && state().settings.noelKeepSnowing === false), sharing: !!f.sharing, authActive: !!f.authActive, pageBounds: page, audible: !!tab.audible, mediaPlaying: !!tab.mediaPlaying, privateTab: !!tab.privateTab, securedTab: !!tab.securedTab, lastKeyInPage: lastKey, moving: !!f.layoutMoving, now: nowMs() };
  };
  const post = (payload) => { if (!view || view.webContents.isDestroyed()) return; if (!ready) { queued = payload; return; } view.webContents.send('noel:state', payload); };
  const place = () => {
    const w = main(), page = pageBounds(); if (!win || win.isDestroyed() || !w || !page) return;
    const b = overlayBounds(w.getContentBounds(), page), key = `${b.x},${b.y},${b.width},${b.height}`;
    if (key !== lastBounds) { lastBounds = key; win.setBounds(b); if (view) view.setBounds({ x: 0, y: 0, width: b.width, height: b.height }); post({ type: 'size', width: b.width, height: b.height }); }
  };
  const create = () => {
    if (win || destroyed) return; const w = main(); if (!w) return;
    win = new BaseWindow({ parent: w, show: false, frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false, focusable: false, skipTaskbar: true, resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false, thickFrame: false, roundedCorners: false });
    try { win.setIgnoreMouseEvents(true); win.setFocusable(false); win.setAlwaysOnTop(false); } catch { /* an older shell */ }
    view = new WebContentsView({ webPreferences: { preload, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, partition: 'noel-overlay', spellcheck: false } });
    try { view.setBackgroundColor('#00000000'); } catch { /* the page is transparent anyway */ }
    win.contentView.addChildView(view); ready = false; queued = null; lastBounds = '';
    // Once the page is there it is told everything afresh: its size first (place() only sends a size that changed, and the one it sent before the page was ready was
    // dropped: switching to Over the whole window while Acira ran gave a canvas of the default size and no snow), then whether it snows. Nothing queued is replayed.
    view.webContents.once('did-finish-load', () => { ready = true; queued = null; lastBounds = ''; place(); post({ type: 'config', dark: dark(), run: running }); });
    const note = (text) => { lastError = String(text || '').slice(0, 200); };
    try {
      view.webContents.on('console-message', (e, level, message) => { const lv = e && e.level !== undefined ? e.level : level; if (lv === 'error' || lv === 3) note(e && e.message !== undefined ? e.message : message); });
      view.webContents.on('did-fail-load', (_e, code, desc) => note(`load failed ${code} ${desc}`));
      view.webContents.on('render-process-gone', (_e, d) => note(`page gone ${d && d.reason}`));
    } catch { /* a fake in a test */ }
    view.webContents.on('will-navigate', e => e.preventDefault()); view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    void view.webContents.loadFile(html).catch(() => {});
    place(); try { if (!hiddenForMove) win.showInactive(); } catch { /* shown by the parent */ }
  };
  const destroy = () => {
    if (meltTimer) { clearTimer(meltTimer); meltTimer = null; }
    const w = win, v = view; win = null; view = null; ready = false; queued = null; lastBounds = '';
    try { if (v && !v.webContents.isDestroyed()) v.webContents.close(); } catch { /* gone */ }
    try { if (w && !w.isDestroyed()) w.destroy(); } catch { /* gone */ }
  };
  const evaluate = () => {
    if (destroyed) return;
    const may = mayFall(info());
    if (may && !running) { running = true; if (meltTimer) { clearTimer(meltTimer); meltTimer = null; } create(); if (win) { place(); post({ type: 'config', dark: dark(), run: true }); try { if (!hiddenForMove) win.showInactive(); } catch { /* gone */ } } }
    else if (!may && running) { running = false; post({ type: 'config', dark: dark(), run: false }); if (win) meltTimer = setTimer(() => { meltTimer = null; if (!running) destroy(); }, MELT_MS + 1500); }
    else if (may && win) { place(); }
  };
  const hideForMove = () => {
    if (!win || win.isDestroyed()) { hiddenForMove = true; if (moveTimer) clearTimer(moveTimer); moveTimer = setTimer(() => { moveTimer = null; hiddenForMove = false; evaluate(); }, MOVE_QUIET_MS); return; }
    if (!hiddenForMove) { hiddenForMove = true; try { win.hide(); } catch { /* gone */ } }
    if (moveTimer) clearTimer(moveTimer);
    moveTimer = setTimer(() => { moveTimer = null; hiddenForMove = false; place(); try { if (win && !win.isDestroyed() && running) win.showInactive(); } catch { /* gone */ } evaluate(); }, MOVE_QUIET_MS);
  };
  /** What a rig or the log reads: the first rule saying no, and the snow window's own state. Reads only; changes nothing. */
  const readout = () => {
    const s = info(), w = main();
    let shown = false; try { shown = !!win && !win.isDestroyed() && win.isVisible(); } catch { /* gone */ }
    let mainKey = false; try { mainKey = !!w && w.isFocused(); } catch { /* gone */ }
    return { why: whyNoSnow(s), running, made: !!win, shown, hiddenForMove, bounds: lastBounds, pageLoaded: ready, lastError, mainKey, forced: !!forceActive(), keep: s.keep, quietS: quietMs ? Math.round(quietMs() / 1000) : null, onBattery: battery(), restAfterS: (battery() ? REST_BATTERY_MS : REST_MAINS_MS) / 1000, pageBounds: s.pageBounds ? { x: Math.round(s.pageBounds.x), y: Math.round(s.pageBounds.y), width: Math.round(s.pageBounds.width), height: Math.round(s.pageBounds.height) } : null };
  };
  /** The read-out and, when the snow page is there, what it last drew (its `__noelStat`: frames, flakes, canvas size, visibility). */
  const probe = async () => {
    const r = readout();
    if (view && ready && !view.webContents.isDestroyed()) { try { const t = await view.webContents.executeJavaScript('window.__noelStat ? JSON.stringify(window.__noelStat) : null', false); r.page = t ? JSON.parse(t) : null; } catch (e) { r.page = { error: String(e && e.message || e).slice(0, 120) }; } }
    else r.page = null;
    return r;
  };
  // Once per time the choice is switched on (and at start when it is on): CHECK_MS later, if it does not snow (a rule says no, or the snow page has drawn nothing), one line to the log.
  const check = async () => {
    checkTimer = null; if (destroyed || !choiceOn || !log) return;
    const r = await probe(); if (!choiceOn) return;
    const drawing = r.running && r.page && !r.page.error && r.page.frames > 0 && r.page.drawn > 0;
    if (drawing) return;
    if (!r.why && r.running) r.why = !r.made ? 'no-window' : !r.pageLoaded ? 'page-not-loaded' : !r.shown ? 'window-not-shown' : 'page-not-drawing';
    try { log(r); } catch { /* the log is never in the way */ }
  };
  const onEnded = (event) => { if (view && event.sender === view.webContents && !running) destroy(); };
  ipcMain.on('noel:ended', onEnded);
  const start = () => { if (!tick) tick = setInterval(evaluate, TICK_MS); };
  const stop = () => { if (tick) { clearInterval(tick); tick = null; } };
  return {
    /** Call when the settings, the window or the page area change; also runs on a 2 Hz timer while the choice is on. */
    update() { const on = windowSnowSupported(platform) && state().settings && state().settings.noelOn === true && state().settings.noelSnow === 'window'; if (on && !choiceOn && log) { if (checkTimer) clearTimer(checkTimer); checkTimer = setTimer(() => { void check(); }, CHECK_MS); } choiceOn = !!on; if (on) start(); else { stop(); running = false; if (win) { post({ type: 'config', dark: dark(), run: false }); if (!meltTimer) meltTimer = setTimer(() => { meltTimer = null; destroy(); }, MELT_MS + 1500); } } evaluate(); },
    /** The window was moved or resized (Windows needs the hide; on a Mac the child follows by itself and is only re-fitted). */
    moved() { if (follow()) hideForMove(); else { place(); } },
    resized() { if (follow()) hideForMove(); else place(); },
    /** The page area took another place or size (a sidebar motion, a layout switch): the overlay is hidden until it has stood still for a moment, so it is never seen out of place. */
    layoutChanged() {
      if (!win || win.isDestroyed()) return; const w = main(), page = pageBounds(); if (!w || !page) return;
      const b = overlayBounds(w.getContentBounds(), page); if (`${b.x},${b.y},${b.width},${b.height}` !== lastBounds) hideForMove();
    },
    /** The interface says the person rests or is back (main's `input-idle`). */
    setIdle(value) { idle = !!value; evaluate(); },
    /** A key reached the page: the snow stops over it until 2 s after the last one. */
    key() { lastKey = nowMs(); evaluate(); },
    focusChanged() { evaluate(); },
    /** The tree's menu: Shake the globe. While it snows over the whole window, the snow over the page is shaken too (src/season/winter/overlay.ts). */
    shake() { if (running && win) post({ type: 'shake' }); },
    dispose() { destroyed = true; stop(); if (checkTimer) { clearTimer(checkTimer); checkTimer = null; } if (moveTimer) clearTimer(moveTimer); ipcMain.removeListener('noel:ended', onEnded); destroy(); },
    /** For the tests and the rigs. */
    _debug: () => ({ running, hasWindow: !!win, hiddenForMove, bounds: lastBounds }),
    readout, probe,
  };
}
module.exports = { createSeasonOverlay, mayFall, whyNoSnow, windowSnowSupported, RULES, CHECK_MS, REST_MAINS_MS, REST_BATTERY_MS, overlayBounds, TYPING_QUIET_MS, MOVE_QUIET_MS, MELT_MS };
