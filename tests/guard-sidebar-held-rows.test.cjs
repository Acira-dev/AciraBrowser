'use strict';
// 13.5 retargeted the guard's rows for the closed Sidebar-mode sidebar (c1 sidebarmode-full/compact, c3 "bare" reveal, c4 bare popups) because Sidebar + address held its sidebar open. Beta 14 dropped that rule: c3 and
// c4 are measuring the bare state again (pinned below, with the controls that can fail); c1's two closed Full/Compact Sidebar-mode rows were not restored (c1 still passes without them).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const dir = path.join(__dirname, '..', 'qa', 'regression-guard', 'checks');
const HAVE = fs.existsSync(dir); // the public source leaves the guard rig out
const only = { skip: HAVE ? false : 'the regression guard is not in this tree' };
const read = name => fs.readFileSync(path.join(dir, name), 'utf8');

test('c1: no row asks for a closed Full/Compact Sidebar mode; the Sidebar-mode reveal that is left (Seamless) has one, with the negative control kept', only, () => {
  const c1 = read('c1-edge-line.mjs');
  assert.doesNotMatch(c1, /name: `sidebarmode-full-/);
  assert.doesNotMatch(c1, /name: `sidebarmode-compact-/);
  assert.match(c1, /name: `sidebarmode-seamless-\$\{look\}`, view: 'seamless', sbmode: true/);
  assert.match(c1, /negative control saw 0 ghost frames with the stroke drawn and the fix undone: the rig is blind/);
});

test('c3: Sidebar-mode Full, Compact and Focus are measured as bare reveals again (Beta 14 F2 dropped the held-open rule), the Seamless rows stay, and both negative controls can fail', only, () => {
  const c3 = read('c3-bare-reveal.mjs');
  assert.match(c3, /kind: 'bare', view, look: 'dark', speed: 'premium'/);
  assert.doesNotMatch(c3, /measureHeld|kind: 'held'/, 'the 13.5 "must do nothing" rows are gone');
  assert.match(c3, /kind: 'seamless', view: 'seamless'/);
  assert.match(c3, /const missing = r => !r\.error && \(c\.view === 'seamless' \? r\.windows === 0 : r\.windows < 2\);/, 'a missing reveal or hide is measured once more, as before 13.5');
  assert.match(c3, /negative control \(field named again\) saw 0 px past the sidebar edge: the rig is blind/, 'control 1: the Sidebar-mode Full reveal must show the block past the edge when the field is named again');
  assert.match(c3, /negative control \(field named again\) was not caught by the Seamless comparison: the rig is blind/, 'control 2: the Seamless comparison must fail on the extra layer');
  assert.match(c3, /if \(!bare\.pass\) problems\.push\('control \(Sidebar mode\): '/);
});

test('c4: the check is the pre-13.5 one again: the scene\'s "sidebar away" is the bare state, judged against the docked reference and the field box', only, () => {
  const c4 = read('c4-bare-popups.mjs');
  assert.match(c4, /await scene\(ctx, \{view, look, sbmode: true, open: true\}\);/, 'the docked reference run');
  assert.match(c4, /await scene\(ctx, \{view, look, sbmode: true, open: false\}\);/);
  assert.match(c4, /if \(bare !== 'bare'\) bad\.push\(`the scene is not the bare state/);
  assert.match(c4, /popup is \$\{row\.parity_dy\}px off the place it takes with the sidebar docked/);
  assert.match(c4, /gap_min: -2, gap_max: 20, parity_dy: 4/);
  assert.doesNotMatch(c4, /did not keep the sidebar docked/);
});
