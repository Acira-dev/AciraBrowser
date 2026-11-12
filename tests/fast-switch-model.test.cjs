'use strict';
// 13.7: a model of main and the interface exchanging states and layouts, run with random events, to find any order in which the page shown goes BACK to a tab
// the person has already left ("the page blinks between both tabs", Windows report on 13.6). The model uses the real planSwitch / createFastSwitch.
// The interface processes the states main sends in order, one at a time, and after each sends a layout for it (and sometimes another, as a resize does);
// the layouts reach main in order, at any time. main shows what the layout in force says. Page shown = layout.views[0].tabId.
const {test} = require('node:test'), assert = require('node:assert/strict');
const fastSwitch = require('../desktop/fast-switch.cjs');

const WEB = ['a', 'b', 'c', 'd', 'e'], OTHER = ['n'];   // n: a new tab page (not a website: never presented early)
const bounds = {x: 280, y: 6, width: 800, height: 700};
const tabOf = id => ({id, contentKind: WEB.includes(id) ? 'web' : 'internal', browserProfileId: 'p', url: 'https://' + id + '.test/'});
const stateOf = (active, rev) => ({activeTabId: active, revision: rev, activeBrowserProfileId: 'p', activeWorkspaceId: 'w', windowUi: {split: null}, tabs: [...WEB, ...OTHER].map(tabOf)});

function rng(seed) { let s = seed >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }

/** One run. `ops` decides which events may happen. Returns the list of regressions found. */
function run(seed, {make = () => fastSwitch.createFastSwitch(), steps = 40, fast = true, ineligible = true, doubleSelect = true, spurious = true, toggleBack = true, clicks = true} = {}) {
  const rand = rng(seed), pick = list => list[Math.floor(rand() * list.length)];
  let rev = 1, state = stateOf('a', rev);
  let layout = {views: [{tabId: 'a', bounds}], pageBounds: bounds, pageImmediate: true, visible: true};
  const wait = make();
  const uiIn = [], uiOut = []; let uiState = state, uiRep = 1, uiFloor = 0; const used = new Set(['a']);
  const shownLog = []; let shown = 'a', rank = 1, violations = [];
  // what the page shown stands for: the revision of the state it was chosen from. It may only go up.
  const showNow = (reason, repRev) => {
    const now = layout.views.length === 1 ? layout.views[0].tabId : null;
    if (now === shown) { rank = Math.max(rank, repRev); return; }
    if (repRev < rank) violations.push({reason, shown: now, from: shown, why: 'went back: the page stands for state ' + repRev + ' but state ' + rank + ' was already shown', log: shownLog.slice(-8)});
    else rank = repRev;
    shown = now; shownLog.push((now || 'nothing') + '@' + reason);
  };
  const select = id => {
    const previous = state; rev++; state = stateOf(id, rev);
    uiIn.push(state);
    if (!fast) return;
    const early = wait.select({previous, state, layout, entry: {dead: false}, needsLoad: false, busy: false, layoutAt: 0, forced: false});
    if (early) { layout = early; showNow('early ' + id, rev); }
  };
  const uiProcess = () => {
    const s = uiIn.shift();
    if (s.revision < uiFloor) return;                // the interface ignores a snapshot older than a click it has already drawn
    uiState = s; uiRep = s.revision;
    uiOut.push({views: WEB.includes(s.activeTabId) ? [{tabId: s.activeTabId, bounds}] : [], pageBounds: bounds, pageImmediate: true, visible: true, stateRevision: s.revision, __rep: s.revision});
  };
  // A click: the interface draws it at once (an optimistic update), sends the action, and its layout follows right behind, stamped with the revision it started from.
  const uiClick = id => {
    while (uiOut.length) mainReceive();              // everything the interface sent before the click reaches main before the action (one ordered pipe)
    const previous = state; rev++; state = stateOf(id, rev); uiIn.push(state); uiFloor = rev;
    if (fast) { const early = wait.select({previous, state, layout, entry: {dead: false}, needsLoad: false, busy: false, layoutAt: 0, forced: false, uiAware: true}); if (early) { layout = early; showNow('early (click) ' + id, rev); } }
    uiState = {...uiState, activeTabId: id}; uiRep = rev;
    uiOut.push({views: WEB.includes(id) ? [{tabId: id, bounds}] : [], pageBounds: bounds, pageImmediate: true, visible: true, stateRevision: uiState.revision, __rep: rev});
  };
  const mainReceive = () => { const next = uiOut.shift(); const adopted = (fast ? wait.adopt(next, state.activeTabId, layout) : {layout: next}); layout = adopted.layout; showNow('layout for ' + (next.views[0] ? next.views[0].tabId : 'nothing') + (adopted.layout === next ? '' : ' (replaced)'), adopted.layout === next ? next.__rep : rank); };
  for (let i = 0; i < steps; i++) {
    const roll = rand();
    if (roll < 0.25) {
      let id = pick(ineligible ? [...WEB, ...OTHER] : WEB);
      if (id === state.activeTabId && !doubleSelect) continue;
      if (!toggleBack && used.has(id) && id !== state.activeTabId) continue;
      used.add(id);
      select(id);
    } else if (clicks && roll < 0.37) {
      let id = pick(ineligible ? [...WEB, ...OTHER] : WEB);
      if (id === uiState.activeTabId) continue;      // a click on the row already highlighted does nothing
      if (!toggleBack && used.has(id)) continue;
      used.add(id);
      uiClick(id);
    } else if (roll < 0.62 && uiIn.length) uiProcess();
    else if (roll < 0.9 && uiOut.length) mainReceive();
    else if (spurious && roll < 0.95) uiOut.push({views: WEB.includes(uiState.activeTabId) ? [{tabId: uiState.activeTabId, bounds}] : [], pageBounds: bounds, pageImmediate: true, visible: true, stateRevision: uiState.revision, __rep: uiRep});
  }
  while (uiIn.length || uiOut.length) { if (uiIn.length && (rand() < 0.5 || !uiOut.length)) uiProcess(); else mainReceive(); }
  return {violations, shown, active: state.activeTabId, layout};
}


/** The guard as it shipped in 13.6 (by tab id, cancelled by any select it could not present), kept here as the model's negative control: the model must find its blink. */
function legacy13_6() {
  const STALE_MS = 1500; let waiting = null;
  const single = layout => (layout && Array.isArray(layout.views) && layout.views.length === 1 ? layout.views[0] : null);
  return {
    select({previous, state, layout, entry, needsLoad, busy, layoutAt, forced}) {
      const early = forced ? null : fastSwitch.planSwitch({previous, state, layout, entry, needsLoad, busy, now: 1000, layoutAt});
      if (early) { const id = state.activeTabId, from = previous.activeTabId; if (waiting) { waiting.left.add(waiting.tabId); waiting.left.add(from); waiting.tabId = id; waiting.left.delete(id); } else waiting = {tabId: id, left: new Set([from])}; return early; }
      waiting = null; return null;
    },
    adopt(next, activeTabId) {
      if (!waiting) return {layout: next, forceChanged: false};
      if (activeTabId !== undefined && activeTabId !== waiting.tabId) { waiting = null; return {layout: next, forceChanged: true}; }
      const view = single(next);
      if (view && view.tabId === waiting.tabId) { waiting = null; return {layout: next, forceChanged: true}; }
      if (view && waiting.left.has(view.tabId)) return {layout: {...next, views: [{...view, tabId: waiting.tabId}]}, forceChanged: false};
      waiting = null; return {layout: next, forceChanged: true};
    }
  };
}

test('model sanity: with the fast switch off, the page never goes back and ends on the active tab', () => {
  for (let seed = 1; seed <= 3000; seed++) {
    const r = run(seed, {fast: false});
    assert.deepEqual(r.violations, [], 'seed ' + seed);
    const want = WEB.includes(r.active) ? r.active : null;
    assert.equal(r.shown, want, 'seed ' + seed + ' ends on the active tab');
  }
});

const sweep = (label, options, seeds = 4000) => {
  const bad = [];
  for (let seed = 1; seed <= seeds; seed++) {
    const r = run(seed, options);
    const want = WEB.includes(r.active) ? r.active : null;
    if (r.violations.length || r.shown !== want) bad.push({seed, violations: r.violations.slice(0, 1), shown: r.shown, active: r.active});
    if (bad.length > 5) break;
  }
  assert.deepEqual(bad.slice(0, 3), [], label + ': orders that blink or end on the wrong page: ' + JSON.stringify(bad.slice(0, 2)).slice(0, 700));
};

test('distinct tabs, websites only, interface layouts in any order (the plain case: clicks, Ctrl+Tab): no blink', () => sweep('plain', {ineligible: false, doubleSelect: false, toggleBack: false}));
test('the same tab selected twice before the interface answers (a double click on a slow machine): no blink', () => sweep('double select', {ineligible: false, doubleSelect: true, toggleBack: false}));
test('a switch back to a tab left a moment ago (A, B, A) before the interface answers: no blink', () => sweep('toggle back', {ineligible: false, doubleSelect: false, toggleBack: true}));
test('a switch to a tab that is not a website page (new tab page, a sleeping tab) while an earlier switch waits: no blink', () => sweep('ineligible', {ineligible: true, doubleSelect: false, toggleBack: false}));
test('all of it together', () => sweep('everything', {}));

test('negative control: the model finds the blink of the 13.6 guard (a double click, a switch back, a switch to a tab not presented early)', () => {
  const found = {};
  for (const [label, options] of [['double select', {ineligible: false, doubleSelect: true, toggleBack: false}], ['toggle back', {ineligible: false, doubleSelect: false, toggleBack: true}], ['ineligible', {ineligible: true, doubleSelect: false, toggleBack: false}]]) {
    let n = 0;
    for (let seed = 1; seed <= 1500; seed++) if (run(seed, {...options, make: legacy13_6}).violations.length) n++;
    found[label] = n;
  }
  assert.ok(found['double select'] > 0 && found['toggle back'] > 0 && found['ineligible'] > 0, 'the 13.6 guard must blink in each: ' + JSON.stringify(found));
  let plain = 0;
  for (let seed = 1; seed <= 1500; seed++) if (run(seed, {ineligible: false, doubleSelect: false, toggleBack: false, make: legacy13_6}).violations.length) plain++;
  assert.equal(plain, 0, 'and not in the plain case, which is why a single click never showed it');
});
