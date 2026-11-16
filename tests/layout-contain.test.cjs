// 13.10 round 4 (laptop traces): the page rectangle {0,72,..} of the Full view with a Seamless pane at {6,6,..} never reaches the page (desktop/layout-contain.cjs, applyLayout).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { containPage } = require('../desktop/layout-contain.cjs');

const pane = { x: 6, y: 6, width: 1268, height: 668 }, layout = (pageBounds, bounds = pane, extra = {}) => ({ pageBounds, views: [{ tabId: 'a', bounds }], viewport: { width: 1280, height: 680 }, ...extra });

test('the trace\'s layout (page {0,72,1280,608}, pane {6,6,1268,668}) gets the pane\'s rectangle as its page', () => {
  const out = containPage(layout({ x: 0, y: 72, width: 1280, height: 608 }));
  assert.deepEqual(out.pageBounds, pane);
  assert.deepEqual(out.views[0].bounds, pane, 'the pane itself is not touched');
  assert.equal(out.viewport.width, 1280, 'nothing else of the layout changes');
});

test('a page rectangle that holds its pane is never touched, whatever it is (the rest, the 12 px wider measure, the Full view\'s own, the card a few pixels off)', () => {
  for (const page of [{ x: 6, y: 6, width: 1268, height: 668 }, { x: 6, y: 6, width: 1280, height: 668 }, { x: 0, y: 0, width: 1280, height: 680 }, { x: 10, y: 12, width: 1268, height: 668 }]) {
    const input = layout(page);
    assert.equal(containPage(input), input, JSON.stringify(page));
  }
  const full = { x: 0, y: 72, width: 1280, height: 608 }, input = layout(full, full);
  assert.equal(containPage(input), input, 'Full view: its page and its pane are the same rectangle');
});

test('only a single pane is judged: a split (the page area holds two panes), no pane, no page rectangle, a malformed one', () => {
  const split = { pageBounds: { x: 0, y: 72, width: 1280, height: 608 }, views: [{ tabId: 'a', bounds: pane }, { tabId: 'b', bounds: { x: 600, y: 6, width: 600, height: 668 } }] };
  assert.equal(containPage(split), split);
  const none = { pageBounds: { x: 0, y: 72, width: 1280, height: 608 }, views: [] };
  assert.equal(containPage(none), none);
  const noPage = { views: [{ tabId: 'a', bounds: pane }] };
  assert.equal(containPage(noPage), noPage);
  const bad = layout({ x: 0, y: NaN, width: 1280, height: 608 });
  assert.equal(containPage(bad), bad);
  assert.equal(containPage(null), null);
});

test('main applies it to every layout, before the Windows fit, and says so under ACIRA_EDGE_TRACE', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'main.cjs'), 'utf8');
  const apply = main.slice(main.indexOf('function applyLayout(next,opts)'), main.indexOf('function applyLayout(next,opts)') + 2500);
  assert.ok(apply.indexOf("containPage(next)") > 0 && apply.indexOf("containPage(next)") < apply.indexOf('fitWindowsOverlay'), 'contained before fitWindowsOverlay');
  assert.match(apply, /\[layout-contained\]/);
});
