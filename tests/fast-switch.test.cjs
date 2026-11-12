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

// The wait (13.7): every layout the interface sends is stamped with the revision of the state it was built from. A layout older than the switch keeps the page main shows.
const stamped = (id, rev, extra = {}) => ({...layoutOf(id, extra), stateRevision: rev});
const sel = (wait, from, to, rev, over = {}) => wait.select({previous: {...stateOf(from), revision: rev - 1}, state: {...stateOf(to), revision: rev}, layout: layoutOf(from), entry: entry(), needsLoad: false, busy: false, layoutAt: 0, forced: false, ...over});
const shownOf = out => out.layout.views.length ? out.layout.views[0].tabId : null;

test('a select shows the new tab at once; a select of the tab already on screen changes nothing', () => {
  const wait = createFastSwitch();
  assert.equal(sel(wait, 'a', 'a', 2), null);
  assert.equal(wait.waiting, null);
  const early = sel(wait, 'a', 'b', 2);
  assert.deepEqual(early.views, [{tabId: 'b', bounds}]);
  assert.equal(wait.waiting, 'b');
});

test('the layout that has caught up (stamped with the switch\'s revision or later) is applied as sent, counts as a change and ends the wait; an older one keeps the page', () => {
  const wait = createFastSwitch();
  assert.deepEqual(wait.adopt(stamped('b', 5)), {layout: stamped('b', 5), forceChanged: false}, 'nothing was presented early: untouched');
  sel(wait, 'a', 'b', 2);
  const old = stamped('a', 1), out = wait.adopt(old, 'b', layoutOf('b'));
  assert.deepEqual(out.layout.views, [{tabId: 'b', bounds}], 'built before the switch: it must not take the page back to A');
  assert.equal(out.forceChanged, false);
  assert.equal(wait.waiting, 'b', 'still waiting');
  const fresh = stamped('b', 2), done = wait.adopt(fresh, 'b', layoutOf('b'));
  assert.equal(done.layout, fresh);
  assert.equal(done.forceChanged, true);
  assert.equal(wait.waiting, null);
  assert.deepEqual(wait.adopt(old, 'b', layoutOf('b')), {layout: old, forceChanged: false}, 'one wait only');
});

test('a layout that says nothing about its state (unstamped) is treated as older', () => {
  const wait = createFastSwitch(); sel(wait, 'a', 'b', 2);
  const out = wait.adopt(layoutOf('a'), 'b', layoutOf('b'));
  assert.deepEqual(out.layout.views, [{tabId: 'b', bounds}]);
  assert.equal(wait.waiting, 'b');
});

test('a burst A, B, C: the layouts built for A and B carry C; the one built for C ends the wait', () => {
  const wait = createFastSwitch();
  sel(wait, 'a', 'b', 2); sel(wait, 'b', 'c', 3, {layout: layoutOf('b')});
  assert.equal(wait.waiting, 'c');
  assert.equal(shownOf(wait.adopt(stamped('b', 2), 'c', layoutOf('c'))), 'c');
  assert.equal(shownOf(wait.adopt(stamped('a', 1), 'c', layoutOf('c'))), 'c');
  assert.equal(wait.waiting, 'c');
  const done = wait.adopt(stamped('c', 3), 'c', layoutOf('c'));
  assert.equal(shownOf(done), 'c');
  assert.equal(done.forceChanged, true);
  assert.equal(wait.waiting, null);
});

test('13.6 BLINK: a switch back (A, B, A) before the interface answers: the layout for A built before the first switch is older than the second and keeps the page', () => {
  const wait = createFastSwitch();
  sel(wait, 'a', 'b', 2); sel(wait, 'b', 'a', 3, {layout: layoutOf('b')});
  assert.equal(wait.waiting, 'a');
  // by tab id these three are indistinguishable from the answer; by revision they are not
  assert.equal(shownOf(wait.adopt(stamped('a', 1), 'a', layoutOf('a'))), 'a', 'built for the first A: stale, A stays');
  assert.equal(wait.waiting, 'a', 'and it does not end the wait');
  assert.equal(shownOf(wait.adopt(stamped('b', 2), 'a', layoutOf('a'))), 'a', 'built for B: stale, B must not come back');
  assert.equal(wait.waiting, 'a');
  assert.equal(wait.adopt(stamped('a', 3), 'a', layoutOf('a')).forceChanged, true);
});

test('13.6 BLINK: a double click (the same tab selected twice before the interface answers) does not drop the guard', () => {
  const wait = createFastSwitch();
  sel(wait, 'a', 'b', 2);
  assert.equal(wait.select({previous: {...stateOf('b'), revision: 2}, state: {...stateOf('b'), revision: 3}, layout: layoutOf('b'), entry: entry(), needsLoad: false, busy: false, layoutAt: 0, forced: false}), null);
  assert.equal(wait.waiting, 'b', 'the second select of B changes nothing');
  assert.equal(shownOf(wait.adopt(stamped('a', 1), 'b', layoutOf('b'))), 'b', 'the layout built before the first select still cannot take the page back to A');
});

test('13.6 BLINK: a select that cannot be shown early (a new tab page, a sleeping tab) while an earlier one waits keeps the guard and moves the revision to wait for', () => {
  const wait = createFastSwitch();
  sel(wait, 'a', 'b', 2);
  // C is not a website page: no early layout, the wait stays and now needs the interface to reach revision 3
  assert.equal(sel(wait, 'b', 'n', 3, {layout: layoutOf('b')}), null);
  assert.equal(wait.waiting, 'b', 'B stays on screen until the interface answers for the new tab page');
  assert.equal(shownOf(wait.adopt(stamped('a', 1), 'n', layoutOf('b'))), 'b');
  assert.equal(shownOf(wait.adopt(stamped('b', 2), 'n', layoutOf('b'))), 'b', 'the layout built for B is older than the new tab page: B stays, not a flash of something else');
  const done = wait.adopt({...stamped('n', 3), views: []}, 'n', layoutOf('b'));
  assert.deepEqual(done.layout.views, [], 'the interface\'s answer for the new tab page is applied as sent');
  assert.equal(done.forceChanged, true);
});

test('a stale layout with no view, or a split, still keeps the page main shows (its other fields are applied)', () => {
  for (const views of [[], [{tabId: 'a', bounds}, {tabId: 'q', bounds}]]) {
    const wait = createFastSwitch(); sel(wait, 'a', 'b', 2);
    const next = {...stamped('a', 1), views, pageBounds: {...bounds, width: 640}};
    const out = wait.adopt(next, 'b', layoutOf('b'));
    assert.deepEqual(out.layout.views, [{tabId: 'b', bounds}]);
    assert.equal(out.layout.pageBounds.width, 640, 'geometry that changed since (a resize) still reaches main');
  }
});

test('the page main shows takes the place the stale layout gives it', () => {
  const wait = createFastSwitch(); sel(wait, 'a', 'b', 2);
  const moved = {x: 100, y: 6, width: 900, height: 700};
  const out = wait.adopt({...stamped('a', 1), views: [{tabId: 'a', bounds: moved}]}, 'b', layoutOf('b'));
  assert.deepEqual(out.layout.views, [{tabId: 'b', bounds: moved}]);
});

test('something other than a select changing the active tab (the tab shown was closed, another opened) ends the wait: the interface layout is applied as sent', () => {
  const wait = createFastSwitch(); sel(wait, 'a', 'b', 2);
  const next = stamped('a', 3);
  const out = wait.adopt(next, 'a', layoutOf('b'));
  assert.equal(out.layout, next);
  assert.equal(out.forceChanged, true);
  assert.equal(wait.waiting, null);
});

test('the wait does not outlive a window that never answers, and cancel ends it', () => {
  let t = 1000; const wait = createFastSwitch({now: () => t});
  sel(wait, 'a', 'b', 2); t += STALE_MS + 1;
  const old = stamped('a', 1);
  assert.deepEqual(wait.adopt(old, 'b', layoutOf('b')), {layout: old, forceChanged: false}, 'after the cap, the interface is believed');
  sel(wait, 'a', 'b', 4); wait.cancel();
  assert.equal(wait.waiting, null);
});

test('a select forced onto the old road (a tab brought here from another space, a split taken apart) shows nothing early but keeps an earlier wait', () => {
  const wait = createFastSwitch(); sel(wait, 'a', 'b', 2);
  assert.equal(sel(wait, 'b', 'c', 3, {layout: layoutOf('b'), forced: true}), null);
  assert.equal(wait.waiting, 'b');
  assert.equal(shownOf(wait.adopt(stamped('b', 2), 'c', layoutOf('b'))), 'b');
});

test('a select the interface draws itself (a click: an optimistic update) shows nothing ahead of it and ends an earlier wait', () => {
  const wait = createFastSwitch();
  sel(wait, 'a', 'b', 2);
  assert.equal(wait.waiting, 'b');
  assert.equal(sel(wait, 'b', 'c', 3, {layout: layoutOf('b'), uiAware: true}), null, 'the interface is ahead of main for this one: the old road');
  assert.equal(wait.waiting, null, 'every layout it sent before the click arrived before the action: nothing older is on its way');
  const next = stamped('c', 1);
  assert.deepEqual(wait.adopt(next, 'c', layoutOf('b')), {layout: next, forceChanged: false}, 'its layouts, stamped with the revision it started from, are applied as sent');
  assert.equal(sel(createFastSwitch(), 'a', 'b', 2, {uiAware: true}), null, 'also with nothing waiting');
});

test('main accepts the interface\'s optimistic tab.select (the whole action validation, not only the case: the first build of this change was refused by the top-level key list)', () => {
  const {validateAction} = require('../desktop/validation.cjs');
  const snapshot = {tabs: [{id: 'a'}, {id: 'b'}], activeTabId: 'a', windowUi: {}, settings: {}, tabGroups: [], workspaces: [], browserProfiles: [], activeBrowserProfileId: 'p'};
  assert.doesNotThrow(() => validateAction({type: 'tab.select', id: 'b', optimistic: true}, snapshot));
  assert.doesNotThrow(() => validateAction({type: 'tab.select', id: 'b'}, snapshot));
  assert.throws(() => validateAction({type: 'tab.select', id: 'b', optimistic: 'yes'}, snapshot), /Drawn by the interface already/);
  assert.throws(() => validateAction({type: 'tab.select', id: 'b', surprise: true}, snapshot));
});

test('main.cjs wires it: the action, the interface layout with its revision, the forced change and the off switch', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'main.cjs'), 'utf8');
  assert.match(main, /if\(action\.type==='tab\.select'\)fastSwitchTo\(action,previous,peekOpen\);if\(action\.type!=='tick'\|\|meaningful\)\{syncPages\(\);/, 'before syncPages, which presents the layout');
  assert.match(main, /const peekOpen=peek\.active;[^]*?peek\.onState\(state\);/, 'a link preview closes on any tab change: whether it was open is read before that');
  assert.match(main, /fastSwitchWait\.select\(\{previous,state,layout,layoutAt:uiLayoutAt,forced:!!\(action\.here\|\|action\.individual\)\|\|process\.env\.ACIRA_NO_FAST_SWITCH==='1'/, 'every tab.select goes through the wait, forced ones included');
  assert.match(main, /forced:!!\(action\.here\|\|action\.individual\)\|\|process\.env\.ACIRA_NO_FAST_SWITCH==='1',uiAware:!!action\.optimistic,/, 'a switch the interface already draws is not shown ahead of it');
  const client = fs.readFileSync(path.join(__dirname, '..', 'src', 'runtime', 'client.ts'), 'utf8');
  assert.match(client, /if\(action\.type==='tab\.select'\)sent=\{\.\.\.action,optimistic:true\};/, 'the interface tags the optimistic select it sends');
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'desktop', 'validation.cjs'), 'utf8'), /case 'tab\.select':shape\(\['id','individual','here','optimistic'\],\['id'\]\)/);
  assert.match(main, /const adopted=fastSwitchWait\.adopt\(valid,state\.activeTabId,layout\);applyLayout\(adopted\.layout,\{forceChanged:adopted\.forceChanged\}\)/);
  assert.match(main, /function applyLayout\(next,opts\)/);
  assert.match(main, /\|\|!!opts\?\.forceChanged/);
  const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.tsx'), 'utf8');
  assert.match(app, /const layout: BrowserLayout = \{ views, stateRevision: state\.revision,/, 'the interface stamps its layout with the state it was built from');
  const validation = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'validation.cjs'), 'utf8');
  assert.match(validation, /'pageDragging','stateRevision'\],'Browser layout'/);
  assert.match(validation, /number\(value\.stateRevision,0,Number\.MAX_SAFE_INTEGER,'State revision'\)/);
});

test('a rig can audit the prediction: the interface layout is compared with what main presented, whatever the key order', () => {
  const rows = [], wait = createFastSwitch({audit: row => rows.push(row)});
  const predicted = {views: [{tabId: 'b', bounds}], pageBounds: bounds, pageImmediate: true, visible: true};
  sel(wait, 'a', 'b', 2);
  wait.adopt({visible: true, pageImmediate: true, pageBounds: {...bounds}, stateRevision: 2, views: [{bounds: {...bounds}, tabId: 'b'}]}, 'b', predicted);
  sel(wait, 'a', 'b', 4);
  wait.adopt({...predicted, pageBounds: {...bounds, width: 700}, pageImmediate: false, stateRevision: 4}, 'b', predicted);
  assert.deepEqual(rows.map(row => row.kind), ['early', 'matched', 'early', 'differs']);
  assert.deepEqual(rows[3].keys.sort(), ['pageBounds', 'pageImmediate'], 'the stamp itself is not a difference');
});
