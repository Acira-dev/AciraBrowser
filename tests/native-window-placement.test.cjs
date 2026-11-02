'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {place, save, cascadeBounds, readState} = require('../desktop/window-placement.cjs');

const area = {x: 0, y: 0, width: 1920, height: 1040};
const areaFor = () => area;
const temp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'acira-placement-')), 'window-state.json');
const box = (x, y, width = 1200, height = 800) => ({x, y, width, height});

test('a new window is the opener\'s size, 24 px right and down', () => {
  const next = cascadeBounds(box(100, 80), area);
  assert.deepEqual(next, box(124, 104));
});

test('cascading wraps to the top-left of the work area instead of running off the screen', () => {
  assert.deepEqual(cascadeBounds(box(700, 230), area), box(0, 0), 'no room to the right');
  assert.deepEqual(cascadeBounds(box(100, 230), area), box(0, 0), 'no room below');
  const second = {x: 40, y: 30, width: 1000, height: 700};
  assert.deepEqual(cascadeBounds(second, {x: 1920, y: 0, width: 1920, height: 1040}), box(1920, 0, 1000, 700), 'a second display wraps to its own corner');
});

test('a new window never lands exactly on another one', () => {
  const taken = [box(124, 104), box(148, 128)];
  assert.deepEqual(cascadeBounds(box(100, 80), area, taken), box(172, 152));
});

test('a window the size of the screen is still kept on screen', () => {
  const full = {x: 0, y: 0, width: 1920, height: 1040};
  const next = cascadeBounds(full, area);
  assert.ok(next.x >= 0 && next.y >= 0 && next.x + next.width <= 1920 && next.y + next.height <= 1040);
});

test('every window keeps its own saved bounds across a restart', () => {
  const file = temp(), keep = ['a', 'b', 'c'];
  save(file, 'a', {bounds: box(10, 10, 1000, 700)}, keep);
  save(file, 'b', {bounds: box(300, 200, 1100, 760), maximized: true}, keep);
  save(file, 'c', {bounds: box(500, 300, 900, 650)}, keep);
  const get = id => place({file, windowId: id, restore: true, anchor: null, taken: [], areaFor});
  assert.deepEqual(get('a'), {bounds: box(10, 10, 1000, 700), maximized: false, fullscreen: false});
  assert.deepEqual(get('b'), {bounds: box(300, 200, 1100, 760), maximized: true, fullscreen: false});
  assert.deepEqual(get('c').bounds, box(500, 300, 900, 650));
  const disk = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(disk.bounds, box(10, 10, 1000, 700), 'the top level mirrors the first window, which the launch splash reads');
});

test('restoring a window that has no saved entry cascades from the windows already open, else uses the old single-window file', () => {
  const file = temp();
  fs.writeFileSync(file, JSON.stringify({bounds: box(50, 60, 1000, 700), maximized: false}));
  const first = place({file, windowId: 'main', restore: true, anchor: null, taken: [], areaFor});
  assert.deepEqual(first.bounds, box(50, 60, 1000, 700), 'old file: the first window gets the one saved size');
  const second = place({file, windowId: 'window-2', restore: true, anchor: {bounds: first.bounds, maximized: false}, taken: [first.bounds], areaFor});
  assert.deepEqual(second.bounds, box(74, 84, 1000, 700), 'the next one is cascaded, not stacked');
});

test('a new window ignores the saved entry for its id and the saved maximized state', () => {
  const file = temp();
  save(file, 'old', {bounds: box(0, 0), maximized: true, fullscreen: true}, ['old']);
  const fresh = place({file, windowId: 'new', restore: false, anchor: {bounds: box(200, 150, 1000, 700), maximized: false}, taken: [box(200, 150, 1000, 700)], areaFor});
  assert.deepEqual(fresh, {bounds: box(224, 174, 1000, 700), maximized: false, fullscreen: false});
});

test('a window opened from a maximized one is maximized too, with the cascaded size behind it', () => {
  const file = temp();
  const next = place({file, windowId: 'n', restore: false, anchor: {bounds: box(100, 80, 1200, 800), maximized: true}, taken: [], areaFor});
  assert.equal(next.maximized, true);
  assert.deepEqual(next.bounds, box(124, 104));
});

test('saved bounds that fall off the screen are pulled back', () => {
  const file = temp();
  save(file, 'a', {bounds: box(5000, 4000, 1200, 800)}, ['a']);
  const got = place({file, windowId: 'a', restore: true, anchor: null, taken: [], areaFor});
  assert.ok(got.bounds.x + got.bounds.width <= 1920 && got.bounds.y + got.bounds.height <= 1040);
});

test('windows that no longer come back are forgotten; junk in the file is ignored', () => {
  const file = temp();
  save(file, 'a', {bounds: box(1, 1)}, ['a', 'b']); save(file, 'b', {bounds: box(2, 2)}, ['a', 'b']);
  save(file, 'b', {bounds: box(3, 3)}, ['b']);
  assert.deepEqual(Object.keys(readState(file).windows), ['b']);
  fs.writeFileSync(file, '{"windows":{"../x":{"bounds":{"x":1}},"ok":{"bounds":{"x":"a","y":1,"width":5,"height":5}}},"bounds":[]}');
  assert.deepEqual(readState(file), {lead: {}, windows: {ok: {}}});
  fs.writeFileSync(file, 'not json');
  assert.deepEqual(readState(file), {lead: {}, windows: {}});
  assert.ok(place({file, windowId: 'x', restore: true, anchor: null, taken: [], areaFor}).bounds.width >= 900, 'defaults when nothing is saved');
});
