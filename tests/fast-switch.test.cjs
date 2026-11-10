'use strict';
// 13.6: a plain switch from one website to another shows the new page in the step that reduces the action (fast-switch.cjs), with the layout already in force.
const {test} = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const {planSwitch, createFastSwitch, STALE_MS, SLIDE_SETTLE_MS} = require('../desktop/fast-switch.cjs');

const tab = (id, extra = {}) => ({id, contentKind: 'web', browserProfileId: 'p1', url: 'https://' + id + '.test/', ...extra});
const stateOf = (active, extra = {}) => ({activeTabId: active, activeBrowserProfileId: 'p1', activeWorkspaceId: 'w1', windowUi: {split: null}, tabs: [tab('a'), tab('b'), tab('c'), tab('n', {contentKind: 'internal', url: 'acira://new'})], ...extra});
const bounds = {x: 280, y: 6, width: 800, height: 700};
const layoutOf = (id, extra = {}) => ({views: [{tabId: id, bounds}], pageBounds: bounds, pageImmediate: true, visible: true, ...extra});
const entry = (extra = {}) => ({dead: false, securedLocked: false, securedRestoring: false, ...extra});
const plan = (over = {}) => planSwitch({previous: stateOf('a'), state: stateOf('b'), layout: layoutOf('a'), entry: entry(), needsLoad: false, busy: false, now: 10000, layoutAt: 0, ...over});

test('a plain switch presents the new tab with the layout in force: same bounds, same fields, only the tab changes', () => {
  const layout = layoutOf('a', {pageRadius: 12, motionSpeed: 1, reducedMotion: false});
  const early = plan({layout});
  assert.deepEqual(early.views, [{tabId: 'b', bounds}]);
  assert.deepEqual({...early, views: null}, {...layout, views: null}, 'nothing but the view is touched');
  assert.equal(layout.views[0].tabId, 'a', 'the layout in force is not modified');
});

test('nothing to present: the same tab, another profile or workspace, a split, a new tab page, an error page, a private tab', () => {
  assert.equal(plan({state: stateOf('a')}), null);
  assert.equal(plan({state: stateOf('b', {activeBrowserProfileId: 'p2'})}), null);
  assert.equal(plan({state: stateOf('b', {activeWorkspaceId: 'w2'})}), null);
  assert.equal(plan({state: stateOf('b', {windowUi: {split: {tabIds: ['b', 'c']}}})}), null);
  assert.equal(plan({previous: stateOf('a', {windowUi: {split: {tabIds: ['a', 'c']}}})}), null);
  assert.equal(plan({state: stateOf('n')}), null, 'a new tab page is drawn by the interface');
  const withError = stateOf('b'); withError.tabs[1] = tab('b', {error: 'ERR_NAME_NOT_RESOLVED'});
  assert.equal(plan({state: withError}), null, 'an error page is drawn by the interface');
  const mixed = stateOf('b'); mixed.tabs[1] = tab('b', {privacy: 'private'});
  assert.equal(plan({state: mixed}), null, 'a private tab beside an ordinary one is not the settled case');
  const priv = (state, id) => { for (const t of state.tabs) if (t.id === 'a' || t.id === 'b') t.privacy = id; return state; };
  assert.ok(plan({previous: priv(stateOf('a'), 'private'), state: priv(stateOf('b'), 'private')}), 'two private tabs in a private window switch fast');
  assert.equal(plan({previous: priv(stateOf('a'), 'secured'), state: priv(stateOf('b'), 'secured')}), null, 'secured workspace tabs have a lock of their own');
  assert.equal(plan({previous: priv(stateOf('a'), 'tor'), state: priv(stateOf('b'), 'tor')}), null, 'Tor tabs have a circuit of their own');
  assert.equal(plan({state: stateOf('zzz')}), null, 'a tab that does not exist');
});

test('only the settled single view of the tab being left is replaced', () => {
  assert.equal(plan({layout: layoutOf('c')}), null, 'the layout shows another tab');
  assert.equal(plan({layout: {...layoutOf('a'), views: []}}), null, 'nothing is shown (a reader, a picker, a morph)');
  assert.equal(plan({layout: {...layoutOf('a'), views: [{tabId: 'a', bounds}, {tabId: 'c', bounds}]}}), null, 'a split');
  assert.equal(plan({layout: layoutOf('a', {visible: false})}), null);
  assert.equal(plan({layout: layoutOf('a', {pageHold: true})}), null, 'a held slide');
  assert.equal(plan({layout: layoutOf('a', {overlay: {kind: 'menu', id: 3, bounds}})}), null, 'a menu is open');
  assert.equal(plan({layout: layoutOf('a', {overlay: {kind: 'suggestions', id: 3, bounds}})}), null);
  assert.ok(plan({layout: layoutOf('a', {overlay: {kind: 'toast', id: 3, bounds}})}), 'a toast does not stop it');
  assert.ok(plan({layout: layoutOf('a', {overlay: {kind: 'zoom', id: 3, bounds}})}), 'the zoom badge does not stop it');
});

test('a page that is still gliding is not settled; once the glide is long over, it is', () => {
  const sliding = layoutOf('a', {pageImmediate: false, pageMotion: 'slide'});
  assert.equal(plan({layout: sliding, now: 10000, layoutAt: 10000 - SLIDE_SETTLE_MS + 50}), null);
  assert.ok(plan({layout: sliding, now: 10000, layoutAt: 10000 - SLIDE_SETTLE_MS - 50}));
});

test('the new tab needs a live page that is already on its address; and nothing else may own the screen', () => {
  assert.equal(plan({entry: null}), null, 'a sleeping tab has no page: it takes the old road');
  assert.equal(plan({entry: entry({dead: true})}), null);
  assert.equal(plan({entry: entry({securedLocked: true})}), null);
  assert.equal(plan({entry: entry({securedRestoring: true})}), null);
  assert.equal(plan({needsLoad: true}), null, 'a page about to navigate is not shown ahead of its address');
  assert.equal(plan({busy: true}), null, 'a sign-in, a full-screen page, a link preview, a dialog');
});

test('the interface layout that follows: the tab it was waiting for ends the wait and counts as a change', () => {
  const wait = createFastSwitch();
  const first = layoutOf('b');
  assert.deepEqual(wait.adopt(first), {layout: first, forceChanged: false}, 'nothing was presented early: untouched');
  wait.note('b', 'a');
  assert.equal(wait.waiting, 'b');
  assert.deepEqual(wait.adopt(first), {layout: first, forceChanged: true});
  assert.equal(wait.waiting, null);
  assert.deepEqual(wait.adopt(first), {layout: first, forceChanged: false}, 'one layout only');
});

test('a burst A -> B -> C: the interface layouts for A and B are stale and carry C; the layout for C ends the wait', () => {
  const wait = createFastSwitch();
  wait.note('b', 'a'); wait.note('c', 'b');
  assert.equal(wait.waiting, 'c');
  const stale = layoutOf('b', {pageImmediate: true});
  const out = wait.adopt(stale);
  assert.deepEqual(out.layout.views, [{tabId: 'c', bounds}], 'the page never steps back to B');
  assert.equal(out.forceChanged, false);
  assert.equal(wait.adopt(layoutOf('a')).layout.views[0].tabId, 'c', 'a layout for the tab the burst began on is stale too');
  assert.equal(wait.waiting, 'c', 'still waiting for C');
  const caughtUp = wait.adopt(layoutOf('c'));
  assert.equal(caughtUp.layout.views[0].tabId, 'c');
  assert.equal(caughtUp.forceChanged, true);
  assert.equal(wait.waiting, null);
});

test('a switch back to a tab the burst left (A -> B -> A) waits for A, and B is the stale one', () => {
  const wait = createFastSwitch();
  wait.note('b', 'a'); wait.note('a', 'b');
  assert.equal(wait.adopt(layoutOf('b')).layout.views[0].tabId, 'a');
  assert.equal(wait.adopt(layoutOf('a')).forceChanged, true);
});

test('an interface that moved on (a split, a new tab page, no view) ends the wait and is applied as sent', () => {
  for (const next of [{...layoutOf('a'), views: []}, {...layoutOf('a'), views: [{tabId: 'a', bounds}, {tabId: 'q', bounds}]}, layoutOf('n')]) {
    const wait = createFastSwitch(); wait.note('b', 'a');
    const out = wait.adopt(next);
    assert.equal(out.layout, next);
    assert.equal(out.forceChanged, true);
    assert.equal(wait.waiting, null);
  }
});

test('the wait does not outlive a window that never answers, and cancel ends it', () => {
  let t = 1000; const wait = createFastSwitch({now: () => t});
  wait.note('b', 'a'); t += STALE_MS + 1;
  const out = wait.adopt(layoutOf('a'));
  assert.equal(out.layout.views[0].tabId, 'a', 'after the cap, the interface is believed');
  assert.equal(out.forceChanged, false);
  wait.note('b', 'a'); wait.cancel();
  assert.equal(wait.waiting, null);
  assert.equal(wait.adopt(layoutOf('a')).layout.views[0].tabId, 'a');
});

test('main.cjs wires it: the action, the interface layout, the forced change and the off switch', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'main.cjs'), 'utf8');
  assert.match(main, /if\(action\.type==='tab\.select'\)fastSwitchTo\(action,previous,peekOpen\);if\(action\.type!=='tick'\|\|meaningful\)\{syncPages\(\);/, 'before syncPages, which presents the layout');
  assert.match(main, /const peekOpen=peek\.active;[^]*?peek\.onState\(state\);/, 'a link preview closes on any tab change: whether it was open is read before that');
  assert.match(main, /const adopted=fastSwitchWait\.adopt\(valid,state\.activeTabId\);applyLayout\(adopted\.layout,\{forceChanged:adopted\.forceChanged\}\)/);
  assert.match(main, /function applyLayout\(next,opts\)/);
  assert.match(main, /\|\|!!opts\?\.forceChanged/);
  assert.match(main, /ACIRA_NO_FAST_SWITCH==='1'/);
  assert.match(main, /action\.here\|\|action\.individual/, 'a tab brought here from another space takes the old road');
});

test('a rig can audit the prediction: the interface layout is compared with what main presented, whatever the key order', () => {
  const rows = [], wait = createFastSwitch({audit: row => rows.push(row)});
  const predicted = {views: [{tabId: 'b', bounds}], pageBounds: bounds, pageImmediate: true, visible: true};
  wait.note('b', 'a', predicted);
  wait.adopt({visible: true, pageImmediate: true, pageBounds: {...bounds}, views: [{bounds: {...bounds}, tabId: 'b'}]});
  wait.note('b', 'a', predicted);
  wait.adopt({...predicted, pageBounds: {...bounds, width: 700}, pageImmediate: false});
  assert.deepEqual(rows.map(row => row.kind), ['early', 'matched', 'early', 'differs']);
  assert.deepEqual(rows[3].keys.sort(), ['pageBounds', 'pageImmediate']);
});

test('something else changing the active tab (the early tab is closed, another opened) ends the wait: the interface layout is applied as sent, never replaced by the closed tab', () => {
  const wait = createFastSwitch();
  wait.note('b', 'a');
  // tab B is closed within the wait; the window's active tab is A again, and the interface (which left A earlier) sends the layout for A
  const out = wait.adopt(layoutOf('a'), 'a');
  assert.equal(out.layout.views[0].tabId, 'a');
  assert.equal(out.forceChanged, true);
  assert.equal(wait.waiting, null);
  // while the wait is on and the active tab is the one waited for, a stale layout still carries it
  wait.note('b', 'a');
  assert.equal(wait.adopt(layoutOf('a'), 'b').layout.views[0].tabId, 'b');
});
