'use strict';
// An extension's toolbar popup opened detached from its icon and ran past the window and the screen (Discord, Windows 0.1.0-beta.10, Bitwarden).
// electron-chrome-extensions put the popup's left edge on the icon's left edge ("bottom right" alignment) and never looked at the window or the
// screen; the icon's rectangle was also CSS pixels of the interface page, which Acira zooms with its Interface size. These tests pin the placement
// maths (DIPs on the screen). The gap under the icon (8) and the margin to the edges (12) are Acira's own menus' (src/ui/popup.ts popupGeometry).
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const {placePopup, interfaceScale, anchorOnScreen, fitSpan, GAP, MARGIN} = require('../desktop/browser-services/extension-popup-placement.cjs');

const rect = (x, y, width, height) => ({x, y, width, height});
const inside = (spot, size, box) => spot.x >= box.x && spot.x + size.width <= box.x + box.width && spot.y >= box.y && spot.y + size.height <= box.y + box.height;
const BITWARDEN = {width: 480, height: 600};

test('the report: an icon near the window\'s right end opens its popup under it, right edges together, inside the window (Windows 1920x1080 at 100%)', () => {
  const window = rect(100, 80, 1100, 700), area = rect(0, 0, 1920, 1040);
  const anchor = rect(100 + 845, 80 + 39, 30, 30);  // the Bitwarden button, 845 px into a 1100 px window
  const spot = placePopup({anchor, size: BITWARDEN, window, area});
  assert.equal(spot.x + BITWARDEN.width, anchor.x + anchor.width);          // right edge on the icon's right edge (Chrome's)
  assert.equal(spot.y, anchor.y + anchor.height + GAP);                  // right under the icon
  assert.equal(spot.direction, 'left');
  assert.ok(inside(spot, BITWARDEN, window));
  // what 0.1.0-beta.10 did: left edge on the icon, 480 px to the right, 230 px past the window
  assert.ok(anchor.x + BITWARDEN.width > window.x + window.width);
});

test('a toolbar at the left with room to its right keeps the popup where it always opened (the left edge on the icon)', () => {
  const window = rect(0, 0, 1400, 800), area = rect(0, 0, 1920, 1040), anchor = rect(60, 40, 30, 30);
  const spot = placePopup({anchor, size: {width: 300, height: 400}, window, area});
  assert.deepEqual([spot.x, spot.y, spot.direction, spot.clamped], [60, 40 + 30 + GAP, 'right', false]);
});

test('the side follows the icon: right half of the window, the popup runs left from it (Chrome\'s); left half, it runs right; no room, it flips', () => {
  const window = rect(0, 0, 1400, 800), area = rect(0, 0, 1920, 1040), size = {width: 300, height: 200};
  assert.equal(placePopup({anchor: rect(900, 40, 30, 30), size, window, area}).x, 900 + 30 - 300);
  assert.equal(placePopup({anchor: rect(100, 40, 30, 30), size, window, area}).x, 100);
  // a left-half icon whose right side runs off the screen (the window is wider than the display): the popup flips to the side that has room
  const flipped = placePopup({anchor: rect(900, 40, 30, 30), size: {width: 480, height: 200}, window: rect(0, 0, 2000, 800), area: rect(0, 0, 1000, 800)});
  assert.deepEqual([flipped.direction, flipped.x, flipped.clamped], ['left', 930 - 480, false]);
});

test('a popup never leaves the window sideways: it is moved in by the margin when the icon is at an edge', () => {
  const window = rect(0, 0, 1000, 700), area = rect(0, 0, 1920, 1040);
  const atRightEdge = placePopup({anchor: rect(985, 40, 14, 30), size: {width: 300, height: 200}, window, area});
  assert.equal(atRightEdge.x + 300, 1000 - MARGIN);
  assert.equal(atRightEdge.clamped, true);
  const atLeftEdge = placePopup({anchor: rect(1, 40, 14, 30), size: {width: 300, height: 200}, window, area});
  assert.equal(atLeftEdge.x, MARGIN);
});

test('a window at the right end of the screen (or partly off it) keeps the popup on the screen', () => {
  const area = rect(0, 0, 1352, 823);
  const window = rect(452, 69, 900, 700);  // flush with the screen's right edge
  const spot = placePopup({anchor: rect(452 + 845, 108, 30, 30), size: BITWARDEN, window, area});
  assert.ok(inside(spot, BITWARDEN, area));
  // a window hanging off the screen: the screen limits the popup, not the window
  const hanging = rect(700, 69, 900, 700);
  const second = placePopup({anchor: rect(700 + 845, 108, 30, 30), size: BITWARDEN, window: hanging, area});
  assert.ok(second.x + BITWARDEN.width <= area.x + area.width);
});

test('a window narrower than the popup is limited by the screen alone', () => {
  const area = rect(0, 0, 1920, 1040), window = rect(500, 100, 420, 600);
  const spot = placePopup({anchor: rect(500 + 360, 140, 30, 30), size: BITWARDEN, window, area});
  assert.ok(inside(spot, BITWARDEN, area));
  assert.equal(spot.x + BITWARDEN.width, 500 + 360 + 30);
});

test('no room below: a toolbar at the top slides the popup up to the screen\'s bottom edge, a toolbar low on the screen opens upwards', () => {
  const area = rect(0, 0, 1366, 728), window = rect(0, 0, 1366, 728);
  const top = placePopup({anchor: rect(1200, 40, 30, 30), size: BITWARDEN, window, area});
  assert.deepEqual([top.side, top.y], ['below', 70 + GAP]);  // 78 + 600 fits in 728 - 12
  const short = rect(0, 0, 1366, 640);
  const slid = placePopup({anchor: rect(1200, 40, 30, 30), size: BITWARDEN, window: short, area: short});
  assert.equal(slid.side, 'shifted');
  assert.equal(slid.y + BITWARDEN.height, 640 - MARGIN);  // the screen's bottom edge, less the menus' margin
  const low = placePopup({anchor: rect(1200, 560, 30, 30), size: {width: 480, height: 400}, window, area});
  assert.deepEqual([low.side, low.y], ['above', 560 - GAP - 400]);
});

test('a popup taller than the screen starts at its top edge; the work area\'s own origin (a menu bar, a second monitor to the left) is respected', () => {
  const tall = placePopup({anchor: rect(10, 10, 30, 30), size: {width: 100, height: 900}, window: rect(0, 0, 800, 500), area: rect(0, 25, 800, 500)});
  assert.equal(tall.y, 25);
  const second = rect(-1920, 0, 1920, 1040), window = rect(-1500, 100, 1200, 700);
  const spot = placePopup({anchor: rect(-1500 + 1100, 140, 30, 30), size: BITWARDEN, window, area: second});
  assert.ok(inside(spot, BITWARDEN, window));
  assert.equal(spot.x + 480, -1500 + 1100 + 30);
});

test('the gap and the margin are the menus\' and grow with Interface size (CSS px of the interface x its scale)', () => {
  const window = rect(0, 0, 1400, 800), area = rect(0, 0, 1920, 1040), anchor = rect(1200, 50, 45, 45);  // a 30 px button at 150 %
  const at100 = placePopup({anchor: rect(1200, 50, 30, 30), size: {width: 300, height: 200}, window, area, scale: 1});
  const at150 = placePopup({anchor, size: {width: 300, height: 200}, window, area, scale: 1.5});
  assert.equal(at100.y - 80, GAP);
  assert.equal(at150.y - 95, GAP * 1.5);
  const edge = placePopup({anchor: rect(1390, 50, 8, 30), size: {width: 300, height: 200}, window, area, scale: 1.5});
  assert.equal(edge.x + 300, 1400 - MARGIN * 1.5);
});

test('placement is whole DIPs and fractional anchors (125%, 175% displays) never drift by a pixel from repeated placement', () => {
  const window = rect(100.5, 80.25, 1100, 700), area = rect(0, 0, 1536, 816);
  const anchor = rect(100.5 + 845.2, 80.25 + 39.6, 30, 30);
  const first = placePopup({anchor, size: BITWARDEN, window, area});
  for (let i = 0; i < 5; i++) assert.deepEqual(placePopup({anchor, size: BITWARDEN, window, area}), first);
  assert.ok(Number.isInteger(first.x) && Number.isInteger(first.y));
});

test('fitSpan: shifts into the range, begins at the minimum when the span does not fit', () => {
  assert.equal(fitSpan(50, 100, 0, 1000), 50);
  assert.equal(fitSpan(-20, 100, 0, 1000), 0);
  assert.equal(fitSpan(990, 100, 0, 1000), 900);
  assert.equal(fitSpan(5, 400, 0, 300), 0);
});
