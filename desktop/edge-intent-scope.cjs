'use strict';
// What a page says about the pointer (a control under it, a cursor that is not the arrow, an in-page drag) is only true while the pointer is over that page on
// screen. The page reports it as events, and main kept the last report as one window-wide answer: after the pointer left a page for the interface (the toolbar's
// button that opens a new tab) or a new tab's page took the place of the old one, the last report of the page left stayed in force, and a fresh page does not
// say "the arrow" again (Chromium sends no cursor change for a view that starts on the default cursor). Every rest at the window's edge then counted as "over
// a control" and needed the long wait for one (edge-reveal.cjs ENGAGED_DWELL, 650 ms; 260 pressed to the edge): on Tabrr's New Tab page, the toolbar and
// address bar of Seamless seemed not to come.
// Pure, no Electron: main.cjs asks `pointOnAny` with the pointer in window coordinates and the boxes of the pages that are on screen.

/** Is the point inside any of the boxes ({x, y, width, height})? An unknown pointer (no point, a non-number) is taken as "on a page": what was reported stands, as before. */
function pointOnAny(point, rects) {
 if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return true;
 for (const box of rects || []) {
  if (!box || ![box.x, box.y, box.width, box.height].every(Number.isFinite)) continue;
  if (point.x >= box.x && point.x < box.x + box.width && point.y >= box.y && point.y < box.y + box.height) return true;
 }
 return false;
}

module.exports = {pointOnAny};
