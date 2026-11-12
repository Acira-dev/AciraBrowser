'use strict';
// Does an extension's popup page fit the window it was given?
//
// Chrome sizes a toolbar popup to its page, up to 800 x 600. Two things make the page bigger than the window that holds it, and in both the
// page is cut off (Surfshark's popup on a Windows laptop, Nov 2026):
//  1. A scrollbar takes room from the page. A popup taller than 600 (or wider than 800) scrolls, and on Windows a scrollbar is 15 px wide and
//     not an overlay: a fixed-width page loses 15 px on the right and grows a second, horizontal scrollbar. Chrome's popup is that much wider
//     (taller) than the page. The window here was exactly the page's width, so the right edge was cut. (A Mac shows overlay scrollbars that
//     take no room, which is why this never showed on the Mac.)
//  2. Whole device pixels. At 125 % and 150 % display scale a window of a whole number of DIPs is a fractional number of pixels; the page's
//     viewport comes out a fraction of a pixel smaller than the page, and a scrollbar appears for that one pixel (and, with it, the first
//     problem again).
// The window cannot know either from the size the page asked for, so extension-popup-window.cjs measures the page after each resize and
// asks fitStep() what the window still lacks. The window only ever grows, never past the limits Chrome has, and each step is smaller
// than the last until the page fits.
const LIMITS = Object.freeze({maxWidth: 800, maxHeight: 600});

/**
 * Runs in the popup's page. iw/ih: the whole viewport (scrollbars included); cw/ch: the part scrollbars leave; sw/sh: the page's size;
 * fh: the page's height with its fraction (scrollHeight is a whole number: a page 374.6 px tall reads 374 in a viewport 374 px tall).
 */
const METRICS_SCRIPT = '(()=>{const e=document.documentElement;return {iw:innerWidth,ih:innerHeight,cw:e.clientWidth,ch:e.clientHeight,sw:e.scrollWidth,sh:e.scrollHeight,fh:e.getBoundingClientRect().height};})()';

const whole = value => (Number.isFinite(value) && value > 0 ? Math.ceil(value) : 0);

/**
 * Was the page measured in this window? A window that was just resized still holds a page laid out at its old size until the page's renderer
 * has caught up: right after the load the window already has the 480 x 600 Bitwarden asked for while its page still measures a 25 x 25
 * viewport, and a 480 px page in a 25 px viewport looks 455 px too wide. Numbers taken then are of a window that is gone.
 * metrics: what METRICS_SCRIPT (or the sizing script) returned, iw / ih in CSS px; size: the window's {width, height} in DIPs; zoom: the page's
 * zoom factor (CSS px to DIPs). A pixel of rounding either way is the same window.
 */
function laidOutIn(metrics, size, zoom = 1) {
  const m = metrics || {}, z = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  if (!Number.isFinite(m.iw) || !Number.isFinite(m.ih) || !size) return false;
  return Math.abs(m.iw * z - size.width) <= 1 && Math.abs(m.ih * z - size.height) <= 1;
}

/**
 * metrics: what METRICS_SCRIPT returned; size: the window's current {width, height}; limits: {maxWidth, maxHeight}.
 * Returns {width, height}: how many more DIPs the window needs on each axis (0 = enough, or it has reached Chrome's limit).
 */
function fitStep(metrics, size, limits = LIMITS) {
  const m = metrics || {};
  const roomW = Math.max(0, limits.maxWidth - size.width), roomH = Math.max(0, limits.maxHeight - size.height);
  const overW = (m.sw || 0) - (m.iw || 0), overH = (m.sh || 0) - (m.ih || 0);   // the page against the whole window
  const barY = (m.iw || 0) - (m.cw || 0), barX = (m.ih || 0) - (m.ch || 0);     // a scrollbar that is showing, and how thick it is
  // The page is bigger than the window and the window may still grow: grow to the page. This often takes the scrollbars away on its own, so
  // nothing else is decided before the next measurement.
  let width = overW > 0 ? Math.min(whole(overW), roomW) : 0, height = overH > 0 ? Math.min(whole(overH), roomH) : 0;
  // A vertical scrollbar over a page that is a fraction of a pixel taller than the window (374.6 px in a window 374 px tall: uBlock Origin Lite at 125 %)
  // is no cascade of the horizontal one: its pixel goes with the width's. Alone, the width fixed the page's 1 px of width and the scrollbar then asked
  // the page for 15 px more, a window 15 px wider asked it for the 1 px again, and the popup changed width every few milliseconds for as long as it was open.
  if (!height && barY > 0 && (m.fh || 0) > (m.ih || 0)) height = Math.min(1, roomH);
  if (width || height) return {width, height};
  // The window is as large as it may be along the page's long side (a real scrollbar): the bar's own thickness goes on the other side.
  if (barY > 0 && overH > 0) width = Math.min(whole((m.sw || 0) - (m.cw || 0)), roomW);
  if (barX > 0 && overW > 0) height = Math.min(whole((m.sh || 0) - (m.ch || 0)), roomH);
  if (width || height) return {width, height};
  // A scrollbar with nothing to scroll (the page is not bigger than the window): a sub-pixel shortfall. One DIP more, then measure again.
  if (barY > 0 && overH <= 0) height = Math.min(1, roomH);
  else if (barX > 0 && overW <= 0) width = Math.min(1, roomW);
  return {width, height};
}

module.exports = {fitStep, laidOutIn, METRICS_SCRIPT, LIMITS};
