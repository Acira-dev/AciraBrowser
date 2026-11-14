'use strict';
// 13.8 exit-cleanup blocker hunt: Acira's OWN scheduled downloads never hold up or race the shutdown.
//
// What runs: the filter lists (20 s after start, then every ~4 h, filter-updates.cjs), the threat lists (6 s and 30 s after start, then every 6 h, threat-lists.cjs: three lists of
// up to 16 MB, one after the other, each with a 10 minute limit and a second address to try) and the site allow-list (site-allowlist.cjs, 30 s limit). They go out on the first
// ordinary profile's session (content-blocking.cjs ordinarySession), so for that profile each one is a TRACKED REQUEST of its pipeline (request-pipeline.cjs hasActiveRequests):
// the same count the exit cleanup waits on ("Closed A has no ... tracked requests", exit-cleanup.cjs waitForQuiescence: 1 s) and the release check reads before the quit.
// On a fresh profile all of them run in the first minute, one after another and some in parallel, and a slow line makes them last longer than that.
// Nothing stopped them when the person quit: a download in flight had to be cut by the cleanup's closeAllConnections(), and the address-by-address retry of the lists then
// started the next request into the cleanup's own barrier, again and again, until the lists ran out.
//
// Chromium's way (chrome/browser/browser_process_impl.cc BrowserProcessImpl::StartTearDown; chrome/browser/safe_browsing/safe_browsing_service.cc SafeBrowsingServiceImpl::Stop;
// components/component_updater/component_updater_service.cc Stop; the same rule dl-keys ported for the extension updater, chrome/browser/extensions/updater/extension_updater.cc
// ExtensionUpdater::Stop): background services that belong to the browser are told to stop when the browser starts to shut down, their requests are cancelled, and nothing
// starts once that has begun. They never decide how long the shutdown takes.
//
// This is the one switch for them: `work.allowed()` is asked before every request, `work.signal()` is handed to the request in flight, and the app's quit events call
// `interrupt()` first (before-quit comes before the window closes and before will-quit starts the profile cleanup). A quit that is called off (windows still open a minute
// later) lets the downloads go on; they are retried on their own schedules anyway.

/** How long after a quit began, with windows still open, the quit is taken as called off. */
const QUIT_RESUME_MS = 60000;

/** The app's quit events (Electron), or null outside Electron (a unit test). */
function appLifecycle() {
  try {
    const electron = require('electron'), app = electron && electron.app;
    if (!app || typeof app.on !== 'function') return null;
    return {
      now: () => Date.now(),
      windowsOpen: () => { try { return electron.BrowserWindow.getAllWindows().some(window => !window.isDestroyed()); } catch { return false; } },
      onQuit(fn) {
        const events = [[app, 'before-quit'], [app, 'will-quit']];
        try { if (electron.autoUpdater && typeof electron.autoUpdater.on === 'function') events.push([electron.autoUpdater, 'before-quit-for-update']); } catch { /* no app updater */ }
        for (const [emitter, name] of events) emitter.on(name, fn);
        return () => { for (const [emitter, name] of events) try { emitter.removeListener(name, fn); } catch { /* gone */ } };
      },
    };
  } catch { return null; }
}

/** The error a stopped download ends with; the callers that retry on another address or another list stop instead of trying again. */
const closing = () => Object.assign(new Error('Acira is closing.'), { closing: true });
const isClosing = error => !!error && error.closing === true;

/** `lifecycle`: {now(), windowsOpen(), onQuit(fn) -> unsubscribe}; the default is the app's own, a test passes its own (or null for none). */
function createBackgroundWork({ lifecycle = appLifecycle() } = {}) {
  let stopped = false, quitAt = 0, controller = new AbortController(), unsubscribe = null;
  const now = () => (lifecycle ? lifecycle.now() : Date.now());
  function resumeIfCalledOff() {
    if (!stopped || !lifecycle) return;
    let open = false;
    try { open = lifecycle.windowsOpen(); } catch { open = false; }
    if (open && now() - quitAt >= QUIT_RESUME_MS) { stopped = false; controller = new AbortController(); }
  }
  /** The quit began: the request in flight is aborted and nothing starts. */
  function interrupt() {
    quitAt = now();
    if (stopped) return;
    stopped = true;
    controller.abort();
  }
  if (lifecycle && typeof lifecycle.onQuit === 'function') unsubscribe = lifecycle.onQuit(interrupt);
  return {
    allowed() { resumeIfCalledOff(); return !stopped; },
    /** Aborted when the quit begins; a fresh one after a quit that was called off. Hand it to the request. */
    signal() { resumeIfCalledOff(); return controller.signal; },
    interrupt,
    dispose() { if (unsubscribe) { try { unsubscribe(); } catch { /* gone */ } unsubscribe = null; } },
  };
}

let instance = null;
/** The app's one switch. Asked for at start (content-blocking.cjs) so it is listening to the quit events before anything is scheduled. */
function shared() { return instance || (instance = createBackgroundWork()); }
/** For a test: the next shared() is a new one (or this one). */
function setShared(work) { instance = work || null; }

module.exports = { createBackgroundWork, shared, setShared, closing, isClosing, QUIT_RESUME_MS };
