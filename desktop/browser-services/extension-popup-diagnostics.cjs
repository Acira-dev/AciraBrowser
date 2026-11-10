'use strict';
// What an extension's toolbar popup did on this computer, written to the local extension trace (ext-trace.cjs: <user data>/logs/extension-windows.log).
//
// Why: a Linux user (CachyOS, KDE) reported that the Proton Pass popup opens as a small empty window that is not under its icon, and the packaged
// app has no debugger to ask why (test-hooks.cjs removes Chromium's DevTools switches). Three different things can look the same from outside, and each
// needs a different fix, so the log answers them in one run:
//   1. Did the window system honour the position and size the app asked for? (Wayland does not let an app place or even read a window's position:
//      Electron returns { x: 0, y: 0 } for it, so the placement maths of extension-popup-placement.cjs has nothing to work with there.)
//   2. Did the page build anything? (nodes, text length, the background it painted, visibility and focus: a page that painted its background but no
//      text is waiting for something, usually its service worker, which is Proton Pass's known blank-popup signature.)
//   3. Is the extension's service worker running? (session.serviceWorkers)
// Only ids, numbers, booleans, colours and error texts are written, as the trace's own header promises; nothing is sent anywhere.
const {trace: defaultTrace, fileName} = require('./ext-trace.cjs');

/** Runs in the popup's page. Numbers and flags only: no text of the page ever leaves it. */
const PROBE_SCRIPT = '(()=>{const b=document.body,e=document.documentElement;let text=-1;try{text=(b&&b.innerText||"").length;}catch{}let bg=null;try{bg=b?getComputedStyle(b).backgroundColor:null;}catch{}return {ready:document.readyState,visible:document.visibilityState,focused:document.hasFocus(),nodes:document.getElementsByTagName("*").length,text,inner:[innerWidth,innerHeight],scroll:[e.scrollWidth,e.scrollHeight],bg};})()';

const POSITION_SLACK = 2;   // DIPs: a window system may round to whole device pixels
const MAX_SIZES = 8, MAX_ERRORS = 3, ERROR_LENGTH = 160;

/** The machine's window system as far as the environment tells: what a Linux bug report needs first (session type, desktop, ozone switch). */
function sessionFacts({env = process.env, platform = process.platform, versions = process.versions, app} = {}) {
  const facts = {platform, electron: versions && versions.electron, chrome: versions && versions.chrome};
  if (platform !== 'linux') return facts;
  let ozone = null;
  try { const line = app && app.commandLine; ozone = (line && (line.getSwitchValue('ozone-platform') || line.getSwitchValue('ozone-platform-hint'))) || null; } catch { /* no command line to ask */ }
  return {
    ...facts, session: env.XDG_SESSION_TYPE || null, desktop: env.XDG_CURRENT_DESKTOP || null,
    waylandDisplay: Boolean(env.WAYLAND_DISPLAY), x11Display: Boolean(env.DISPLAY), ozone, appImage: Boolean(env.APPIMAGE),
  };
}

/** The window the app asked for against the window the system gave it (both {x, y, width, height} in DIPs). */
function placementFacts(asked, got) {
  const a = asked || {}, g = got || {};
  const near = (x, y) => Math.abs((Number(x) || 0) - (Number(y) || 0)) <= POSITION_SLACK;
  return {
    asked: [a.x, a.y, a.width, a.height], got: [g.x, g.y, g.width, g.height],
    positionHonoured: near(a.x, g.x) && near(a.y, g.y), sizeHonoured: near(a.width, g.width) && near(a.height, g.height),
    // Wayland answers { 0, 0 } to whatever was asked: the sign that the app cannot see or set where its window is.
    positionUnknown: !near(a.x, g.x) && g.x === 0 && g.y === 0,
  };
}

/** The extension's service worker, if one of this session is running for it. */
function workerRunning(session, extensionId) {
  try {
    const running = session && session.serviceWorkers && session.serviceWorkers.getAllRunning && session.serviceWorkers.getAllRunning();
    if (!running) return null;
    const scope = `chrome-extension://${extensionId}/`;
    return Object.values(running).some(info => info && typeof info.scope === 'string' && info.scope.startsWith(scope));
  } catch { return null; }
}

/**
 * deps: {trace, enabled, env, platform, versions, app (a function returning Electron's app), probeDelays, placedDelay, setTimer, clearTimer, now}. Every part of it is optional so that a test (or a fake
 * page) can leave out what it does not model: nothing here may throw into the popup.
 */
function createPopupDiagnostics(deps = {}) {
  const trace = deps.trace || defaultTrace;
  const enabled = deps.enabled || (() => Boolean(fileName()));
  const setTimer = deps.setTimer || setTimeout, clearTimer = deps.clearTimer || clearTimeout;
  const probeDelays = deps.probeDelays || [1500, 5000], placedDelay = deps.placedDelay ?? 300;
  let announced = false;

  function attach(popup) {
    if (!popup || !enabled()) return () => {};
    const id = popup.extensionId, contents = popup.webContents, timers = new Set();
    let willMove, sizes = 0, errors = 0, shownAt = 0, finished = false;
    const now = deps.now || Date.now;
    const safe = work => { try { return work(); } catch { return undefined; } };
    const later = (delay, work) => {
      const timer = setTimer(() => { timers.delete(timer); if (!finished) safe(work); }, delay);
      timer && timer.unref && timer.unref();
      timers.add(timer);
    };
    if (!announced) { announced = true; safe(() => trace('session', sessionFacts({env: deps.env, platform: deps.platform, versions: deps.versions, app: deps.app && deps.app()}))); }
    safe(() => trace('toolbar popup opens', id));

    const listen = (emitter, name, handler) => { try { emitter && emitter.on && emitter.on(name, handler); } catch { /* an emitter that does not take it */ } };
    listen(contents, 'preferred-size-changed', (_event, size) => { if (sizes++ < MAX_SIZES) safe(() => trace('toolbar popup page size', id, size && {width: size.width, height: size.height})); });
    listen(contents, 'did-fail-load', (_event, code, description) => safe(() => trace('toolbar popup load failed', id, {code, description})));
    listen(contents, 'render-process-gone', (_event, details) => safe(() => trace('toolbar popup page process gone', id, details && {reason: details.reason, exitCode: details.exitCode})));
    listen(contents, 'unresponsive', () => safe(() => trace('toolbar popup page unresponsive', id)));
    // Electron 44 passes one details object; older versions passed (level, message). Only errors, only the first few, only their start.
    listen(contents, 'console-message', (event, level, message) => {
      const details = event && typeof event === 'object' && 'message' in event ? event : {level, message};
      const isError = details.level === 'error' || details.level === 3;
      if (isError && errors++ < MAX_ERRORS) safe(() => trace('toolbar popup page error', id, String(details.message || '').slice(0, ERROR_LENGTH)));
    });
    listen(popup, 'will-move', spot => { willMove = spot; });
    listen(popup, 'shown', () => {
      shownAt = now();
      const asked = {...(willMove || {}), ...(popup.size || {})};
      later(placedDelay, () => {
        const window = popup.window;
        if (!window || window.isDestroyed()) return;
        trace('toolbar popup placed', id, {...placementFacts(asked, window.getBounds()), visible: window.isVisible && window.isVisible(), focused: window.isFocused && window.isFocused(), parentFocused: parentFocused(popup)});
      });
      probeDelays.forEach((delay, index) => later(delay, () => probe(index)));
    });
    listen(popup, 'gone', () => {
      finished = true;
      for (const timer of timers) clearTimer(timer);
      timers.clear();
      safe(() => trace('toolbar popup closed', id, {...(shownAt ? {afterMs: now() - shownAt} : {neverShown: true}), ...(popup.closeReason ? {reason: popup.closeReason} : {})}));
    });

    function probe(index) {
      if (!contents || (contents.isDestroyed && contents.isDestroyed()) || typeof contents.executeJavaScript !== 'function') return;
      Promise.resolve(contents.executeJavaScript(PROBE_SCRIPT)).then(page => {
        if (finished) return;
        trace('toolbar popup page', id, {probe: index + 1, ...page, loading: contents.isLoading ? contents.isLoading() : null, worker: workerRunning(contents.session, id)});
      }).catch(() => { /* a page that is going away */ });
    }
    return () => { finished = true; for (const timer of timers) clearTimer(timer); timers.clear(); };
  }

  return {attach};
}

/**
 * The first few errors an extension's service worker logs, to the same trace (the worker's console is otherwise out of reach in a packaged app).
 * A popup that stays blank waiting for its worker (Proton Pass: its worker threw `Cannot read properties of undefined (reading 'onAdded')` on a missing
 * API, 26 Oct 2026) says nothing on its own; the worker's error names the API. Only extension workers (chrome-extension:// scripts), at most `limit`
 * per extension per run. Returns the function that stops watching.
 */
function watchWorkerErrors(session, {trace = defaultTrace, limit = 5, length = ERROR_LENGTH} = {}) {
  const workers = session && session.serviceWorkers;
  if (!workers || typeof workers.on !== 'function') return () => {};
  const counts = new Map();
  const handler = (_event, details) => {
    try {
      if (!details || !(details.level === 3 || details.level === 'error')) return;
      let where = String(details.sourceUrl || '');
      if (!where.startsWith('chrome-extension://') && typeof workers.getWorkerFromVersionID === 'function') {
        const worker = workers.getWorkerFromVersionID(details.versionId);
        where = String((worker && worker.scope) || '');
      }
      const match = /^chrome-extension:\/\/([a-p]{32})\//.exec(where);
      if (!match) return;
      const id = match[1], seen = counts.get(id) || 0;
      if (seen >= limit) return;
      counts.set(id, seen + 1);
      trace('extension worker error', id, String(details.message || '').slice(0, length));
    } catch { /* a log line is never worth an exception in the engine's event */ }
  };
  try { workers.on('console-message', handler); } catch { return () => {}; }
  return () => { try { workers.removeListener('console-message', handler); } catch { /* gone with its session */ } };
}

function parentFocused(popup) {
  try { const parent = popup.parent; return parent && !parent.isDestroyed() ? parent.isFocused() : null; } catch { return null; }
}

const shared = createPopupDiagnostics({app: () => { try { return require('electron').app; } catch { return undefined; } }});

module.exports = {createPopupDiagnostics, attachPopupDiagnostics: popup => shared.attach(popup), watchWorkerErrors, sessionFacts, placementFacts, workerRunning, PROBE_SCRIPT};
