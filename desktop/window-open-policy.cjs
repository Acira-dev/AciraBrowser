'use strict';
// Where a page's new window goes. Chromium decides first and Electron hands us its answer as details.disposition; the window.open() feature
// string (details.features) decides between a pop-up window and a tab the same way the HTML standard's "popup window is requested" check
// does, so this follows Chrome and not a guess about the link:
//   foreground-tab / background-tab / default  -> a tab (background for Ctrl or middle click)
//   new-window with popup features             -> a pop-up window (OAuth and payment pop-ups; opener kept)
//   new-window with no popup features          -> a tab, except a Shift+click on a link, which is a new browser window
// Only noopener / noreferrer in the features is not a pop-up request (it says nothing about the window).

const ALIASES = {screenx: 'left', screeny: 'top', innerwidth: 'width', innerheight: 'height'};

/** "width=500, height = 600,noopener" -> Map(width -> 500, height -> 600, noopener -> ''); names lower-cased, aliases folded. */
function tokenizeFeatures(features) {
  const map = new Map();
  const pattern = /([^\s,=]+)(?:\s*=\s*([^\s,=]*))?/g;
  const text = typeof features === 'string' ? features : '';
  let match;
  while ((match = pattern.exec(text))) {
    const name = match[1].toLowerCase();
    map.set(ALIASES[name] || name, match[2] ?? '');
  }
  return map;
}

/** The standard's "parse a boolean feature": empty, yes and true are on, otherwise a non-zero leading integer. */
function featureOn(value) {
  if (value === '' || value === 'yes' || value === 'true') return true;
  const number = /^\s*([+-]?\d+)/.exec(String(value));
  return number ? Number(number[1]) !== 0 : false;
}

/** { popup, noopener } for a window.open() feature string. */
function readFeatures(features) {
  const map = tokenizeFeatures(features);
  const noopener = (map.has('noopener') && featureOn(map.get('noopener'))) || (map.has('noreferrer') && featureOn(map.get('noreferrer')));
  map.delete('noopener'); map.delete('noreferrer');
  const flag = (name, fallback) => (map.has(name) ? featureOn(map.get(name)) : fallback);
  let popup;
  if (!map.size) popup = false;
  else if (map.has('popup')) popup = featureOn(map.get('popup'));
  else popup = !(flag('location', false) || flag('toolbar', false)) || !flag('menubar', false) || !flag('resizable', true) || !flag('scrollbars', false) || !flag('status', false);
  return {popup, noopener};
}

/**
 * details: Electron's window-open details ({disposition, features}). link: the click was on a link the person is pointing at.
 * Returns {kind: 'tab' | 'popup' | 'window', background, noopener}; 'window' is a new browser window (Shift+click on a link).
 */
function decideWindowOpen(details, {link = false} = {}) {
  const {popup, noopener} = readFeatures(details?.features);
  const disposition = details?.disposition;
  if (disposition === 'background-tab') return {kind: 'tab', background: true, noopener};
  if (disposition === 'foreground-tab' || disposition === 'default') return {kind: 'tab', background: false, noopener};
  if (popup) return {kind: 'popup', background: false, noopener};
  if (disposition === 'new-window' && link) return {kind: 'window', background: false, noopener: true};
  return {kind: 'tab', background: false, noopener};
}

/**
 * What the browser does with one window-open request, as one answer for main.cjs to carry out.
 * ctx: link (the pointer is on this link), privateTab (a private, Tor or secured tab), tor, sameSession (the tab's own page session is the
 * opener's, so a view made for it can be linked to its opener).
 *   'tab'              a new tab, no opener: a link (a link has none to keep), or noopener
 *   'tab-with-opener'  a new tab whose page keeps window.opener and is what window.open() returns (a script's window.open without noopener)
 *   'popup'            a pop-up window, opener kept (size / position / popup=1 features; also a private or Tor tab's script-opened window,
 *                      since a tab of another session cannot be linked to its opener, and about:blank)
 *   'window'           a new browser window (Shift+click on a link)
 *   'deny'             anything that is not a web address
 * background: the tab opens behind the current one. privateTab: carry the opener's privacy to the new tab or window.
 */
function routeWindowOpen(details, {link = false, privateTab = false, tor = false, sameSession = true} = {}) {
  const url = String(details?.url ?? '');
  const web = /^https?:\/\//i.test(url);
  if (!web && url !== 'about:blank') return {route: 'deny', background: false, privateTab};
  const verdict = decideWindowOpen(details, {link});
  const privateKind = Boolean(privateTab || tor);
  if (!web) return {route: 'popup', background: false, privateTab};
  if (verdict.kind === 'window') return {route: 'window', background: false, privateTab};
  if (verdict.kind === 'popup') return {route: 'popup', background: false, privateTab};
  if (verdict.noopener || link) return {route: 'tab', background: verdict.background, privateTab};
  if (!privateKind && sameSession) return {route: 'tab-with-opener', background: verdict.background, privateTab};
  return {route: 'popup', background: false, privateTab};
}

/**
 * The size and place of a pop-up window from its feature string, as Chrome opens it: width and height are the page's own area
 * (useContentSize), at least 100 (Chromium's floor) and no larger than the screen; left and top are kept on that screen. A request
 * with no size gets the default window size. workArea is the work area of the opener's display.
 */
function popupBounds(features, workArea, fallback = {width: 640, height: 760}, frame = {width: 0, height: 28}) {
  const map = tokenizeFeatures(features);
  const number = name => { const match = /^\s*([+-]?\d+)/.exec(map.get(name) ?? ''); return match ? Number(match[1]) : null; };
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const area = workArea && workArea.width > 0 && workArea.height > 0 ? workArea : null;
  const maxWidth = area ? Math.max(100, area.width - frame.width) : Infinity, maxHeight = area ? Math.max(100, area.height - frame.height) : Infinity;
  const askedWidth = number('width'), askedHeight = number('height');
  const width = Math.round(clamp(askedWidth ?? fallback.width, 100, maxWidth)), height = Math.round(clamp(askedHeight ?? fallback.height, 100, maxHeight));
  const bounds = {width, height, useContentSize: askedWidth !== null || askedHeight !== null};
  const left = number('left'), top = number('top');
  if (area && left !== null) bounds.x = Math.round(clamp(left, area.x, area.x + area.width - width - frame.width));
  if (area && top !== null) bounds.y = Math.round(clamp(top, area.y, area.y + area.height - height - frame.height));
  return bounds;
}

/**
 * Views made for a window.open() that becomes a tab, kept until that tab's page is built: createWindow hands the view to Chromium (which
 * links it to its opener and starts the navigation), and the tab's page adopts it instead of making a second one.
 */
function createOpenedViews() {
  const claims = new Map();
  return {
    /** Before the tab is made: the next page built takes this view. */
    offer(claim) { claims.set('next', claim); },
    /** After the tab is made: key the claim by the tab, or drop it (and report false) when no tab appeared. */
    settle(claim, tabId) {
      if (claims.get('next') === claim) claims.delete('next');
      if (!tabId) return false;
      if (!claim.taken) claims.set(tabId, claim);
      return true;
    },
    /** Called when a tab's page is built: that tab's view, if it was opened by a page. */
    adopt(tabId) {
      const claim = claims.get(tabId) || claims.get('next');
      if (!claim) return null;
      claims.delete(tabId); if (claims.get('next') === claim) claims.delete('next');
      claim.taken = true;
      return claim.view.webContents.isDestroyed() ? null : claim.view;
    },
    has(tabId) { return claims.has(tabId); },
  };
}

module.exports = {tokenizeFeatures, readFeatures, decideWindowOpen, routeWindowOpen, createOpenedViews, popupBounds};
