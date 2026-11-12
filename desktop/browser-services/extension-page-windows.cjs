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

module.exports = {pageKey, findOpenPage};
