'use strict';
// A white window after a minimise and a restore (Windows). A minimised window reports a content size of 0 x 0. Main's resize() took that for a resize, shrank the
// layout by the whole window width (every page view to a width of 0), and nothing ever sent the layout again: the interface does not change size when a window is
// minimised, so it never publishes one, and the restore only grew the already empty view by the same amount. The page stayed white until a tab was switched.
// This runs main's OWN resize() (cut out of the source text) against a fake window, with the real resizeLayout, so it judges the real order of calls.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { resizeLayout, closesOnWindowChange } = require('../desktop/native-policy.cjs');
const plain = value => JSON.parse(JSON.stringify(value)); // values made inside the vm have another realm's prototypes

const source = fs.readFileSync(path.join(__dirname, '../desktop/main.cjs'), 'utf8');
const match = /const resize=\(\)=>\{.*?previousSize=size;publishLayout\(\);\};/s.exec(source);

/** The window as main sees it: a content size that can be asked for, a minimised flag, and the layout main keeps. */
function rig({ width = 1440, height = 900 } = {}) {
  const state = { size: [width, height], minimized: false, applied: [], published: 0, chrome: null };
  const page = { x: 0, y: 72, width, height: height - 72 };
  const layout = { views: [{ tabId: 'a', bounds: { ...page } }], viewport: { width, height }, pageBounds: { ...page }, overlay: undefined };
  const context = {
    mainWindow: { getContentSize: () => state.size.slice(), isMinimized: () => state.minimized },
    chromeView: { setBounds: bounds => { state.chrome = bounds; } },
    layout, previousSize: [width, height], closesOnWindowChange, closeOverlay: () => {}, resizeLayout,
    // main's applyLayout keeps the layout it was given: the next resize starts from it
    applyLayout: next => { state.applied.push(next); context.layout = next; },
    publishLayout: () => { state.published += 1; },
  };
  vm.createContext(context);
  const resize = vm.runInContext(`(()=>{${match[0]};return resize;})()`, context);
  return { state, context, resize, pageWidth: () => context.layout.views[0].bounds.width, pageWidthBefore: width };
}

test('main has the resize function this test cuts out', () => {
  assert.ok(match, 'const resize=()=>{... previousSize=size;publishLayout();}; is in desktop/main.cjs');
});

test('a minimise (content size 0 x 0) is not a resize: the page views keep their width, nothing is laid out again', () => {
  const r = rig();
  r.state.minimized = true; r.state.size = [0, 0];
  r.resize();
  assert.equal(r.state.applied.length, 0, 'no layout was applied for a window that is only minimised');
  assert.equal(r.pageWidth(), 1440, 'the page view is still 1440 wide');
  assert.deepEqual(plain(r.context.previousSize), [1440, 900], 'the size that counts is still the last real one');
});

test('minimise, then restore: the page is the width it was, and a real resize after it still works', () => {
  const r = rig();
  r.state.minimized = true; r.state.size = [0, 0]; r.resize();
  r.state.minimized = false; r.state.size = [1440, 900]; r.resize();
  assert.equal(r.pageWidth(), 1440, 'after the restore the page view has its width (the bug left it at 0: a white window)');
  assert.deepEqual(plain(r.state.chrome), { x: 0, y: 0, width: 1440, height: 900 }, 'the interface view covers the window');
  r.state.size = [1200, 800]; r.resize();
  assert.equal(r.pageWidth(), 1200, 'a real resize afterwards lays the page out as before');
  assert.equal(r.context.layout.views[0].bounds.height, 728);
});

test('a zero size is ignored even where the window is not flagged as minimised (the event can come first)', () => {
  const r = rig();
  r.state.size = [0, 0]; r.resize();
  r.state.size = [1440, 0]; r.resize();
  r.state.size = [0, 900]; r.resize();
  assert.equal(r.state.applied.length, 0);
  assert.equal(r.pageWidth(), 1440);
});

test('a resize while minimised, then the restore to another size, lays the page out for the restored size', () => {
  const r = rig();
  r.state.minimized = true; r.state.size = [0, 0]; r.resize();
  r.state.minimized = false; r.state.size = [1100, 760]; r.resize();
  assert.equal(r.pageWidth(), 1100);
  assert.equal(r.context.layout.views[0].bounds.height, 688);
});

test('a window that is not minimised still publishes its layout on every resize event', () => {
  const r = rig();
  r.resize();
  assert.equal(r.state.published, 1);
  assert.equal(r.state.applied.length, 0, 'same size: nothing to apply');
});
