'use strict';
// A tab let go outside the window opens a new window under the pointer, or joins the Acira window there: the screen point travels in `at`.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const {validateAction} = require('../desktop/validation.cjs');
const {createInitialState} = require('../desktop/runtime.cjs');

const state = () => { const s = createInitialState(); return s; };

test('tab.move-window takes the tab, and optionally the screen point where it was let go', () => {
  const s = state(), id = s.tabs[0].id;
  assert.doesNotThrow(() => validateAction({type: 'tab.move-window', id}, s));
  assert.doesNotThrow(() => validateAction({type: 'tab.move-window', id, at: {x: 1200, y: 40}}, s));
  assert.doesNotThrow(() => validateAction({type: 'tab.move-window', id, at: {x: -1500.5, y: 20}}, s), 'a window left of the main display has negative coordinates');
});

test('a bad point or an unknown tab is refused', () => {
  const s = state(), id = s.tabs[0].id;
  for (const at of [{x: 'a', y: 1}, {x: 1}, {x: 1, y: 2, z: 3}, {x: Infinity, y: 0}, {x: 1e9, y: 0}, null, 5])
    assert.throws(() => validateAction({type: 'tab.move-window', id, at}, s), undefined, JSON.stringify(at));
  assert.throws(() => validateAction({type: 'tab.move-window', id: 'tab-missing', at: {x: 1, y: 1}}, s));
  assert.throws(() => validateAction({type: 'tab.move-window', id, extra: 1}, s));
});

test('the main process places the new window under the point or hands the tab to the window there', () => {
  const main = fs.readFileSync(require('node:path').join(__dirname, '../desktop/main.cjs'), 'utf8').replace(/\r/g, '');
  assert.match(main, /function placeAtPoint\(bounds,point\)/);
  // A profile switch (switchProfileHere) places its window on the frame it takes over; otherwise the saved place, under the point.
  assert.match(main, /initialBounds=(?:windowFrame\?\{[^}]*\}:)?placeAtPoint\(savedWindow\.bounds,windowAt\)/);
  assert.match(main, /target\.openExternalURL\(moving\.url\)/);
  assert.match(main, /other\.profileId===moving\.browserProfileId/);
  assert.match(main, /at:point\}\)\)/);
});
