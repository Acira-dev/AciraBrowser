'use strict';
// An extension page that is already open in a window of its own is brought forward when the extension opens it again, instead of a second window.
//
// Acira shows an extension's own page (chrome.tabs.create with a chrome-extension:// address) in a window of its own: it cannot be a tab of the browser window yet.
// An extension that checks for its page before it opens one (1Password's welcome page: chrome.tabs.query({url, currentWindow: true}), then tabs.update to bring the
// tab forward) looks in the window it was clicked from and never finds a page that lives in another window, so every press of its toolbar button made one more window:
// six presses, six windows. In Chrome the page is a tab of the same window and the second press finds it.
//
// "The same page" is the same address without its #fragment (an extension's own router moves the fragment), in the same browsing profile (session). Another path or
// another query is another page: an extension that opens two screens of itself still gets two windows.

/** The address of an extension page without its #fragment, or '' for anything that is not an extension page. */
function pageKey(href) {
  try {
    const url = new URL(String(href));
    if (url.protocol !== 'chrome-extension:') return '';
    url.hash = '';
    return url.href;
  } catch { return ''; }
}

/** The open window (of `windows`) that shows the same extension page in the same session as `href`, or null. */
function findOpenPage(windows, session, href) {
  const wanted = pageKey(href);
  if (!wanted) return null;
  for (const window of windows) {
    try {
      if (!window || window.isDestroyed()) continue;
      const contents = window.webContents;
      if (!contents || contents.isDestroyed() || contents.session !== session) continue;
      if (pageKey(contents.getURL()) === wanted) return window;
    } catch { /* a window that is going away */ }
  }
  return null;
}

// Two asks for the same page close together (13.8: an extension that opens its options page when it is installed, from its install handler and from a second place within
// milliseconds) both found no window yet, because a window that is still loading has no address, and each made one: two windows. Chromium opens an options page as a singleton
// tab (ExtensionTabUtil::OpenOptionsPage -> BrowserExtensionWindowController::OpenOptionsPage -> ShowSingletonTabOverwritingNTP: the page's path is respected, its #fragment is not),
// so the second ask must find the first one's page. openOnce keeps the open that is in progress for a page of a session; a second ask for the same page gets its answer.
const inFlight = new WeakMap();   // session -> Map(page key -> promise of the window)

/** make() for this page in this session, once at a time: a second ask while the first is running gets the first's result (and its error). */
function openOnce(session, href, make) {
  const key = pageKey(href);
  if (!key || !session || typeof session !== 'object') return Promise.resolve().then(make);
  let running = inFlight.get(session);
  if (!running) { running = new Map(); inFlight.set(session, running); }
  const known = running.get(key);
  if (known) return known;
  const promise = Promise.resolve().then(make);
  running.set(key, promise);
  const done = () => { if (running.get(key) === promise) running.delete(key); };
  promise.then(done, done);
  return promise;
}

/** Electron's text for a load that ended in net::ERR_FAILED: "ERR_FAILED (-2) loading 'address'" (code -2, no other reason). */
function isGenericLoadFailure(error) {
  if (!error) return false;
  if (error.code === 'ERR_FAILED' || error.errno === -2) return true;
  return /^ERR_FAILED \(-2\)/.test(String(error.message || error));
}

/**
 * The first load of an extension's page in a window of its own, tried again when it ends in the generic ERR_FAILED (-2) while the window and the extension are still there: an extension
 * that opens its page at install asks while the install is still settling (13.8, laptop: "ERR_FAILED (-2) loading '.../src/Options/index.html'" 0.4 s after the window was made, and no
 * page). Any other failure, a window that is gone, or an extension that is no longer loaded ends it at once. `note(error, attempt)` hears each failure that is tried again.
 */
async function loadWithRetry(load, {alive = () => true, attempts = 3, wait = 200, note = () => {}, sleep = ms => new Promise(resolve => setTimeout(resolve, ms))} = {}) {
  for (let attempt = 1; ; attempt++) {
    try { return await load(); } catch (error) {
      if (attempt >= attempts || !isGenericLoadFailure(error) || !alive()) throw error;
      try { note(error, attempt); } catch { /* a log line is never worth an exception */ }
      await sleep(wait * attempt);
      if (!alive()) throw error;
    }
  }
}

module.exports = {pageKey, findOpenPage, openOnce, loadWithRetry, isGenericLoadFailure};
