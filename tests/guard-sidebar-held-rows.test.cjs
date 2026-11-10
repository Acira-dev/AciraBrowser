'use strict';
// 13.5: the regression guard's rows for the closed Sidebar-mode sidebar (c1 sidebarmode-full/compact, c3 "bare" reveal, c4 bare popups) drove a state that Sidebar + address no longer has in Full, Compact and
// Focus (src/runtime/windowView.ts sidebarHeldOpen). They were retargeted, not dropped: this pins that, and that each retargeted row keeps a control that can fail (the rig is not blind).
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
  assert.match(c1, /negative control saw 0 ghost frames with the fix undone: the rig is blind/);
});

test('c3: the held-open rows (Full, Compact, Focus) require that hover and Cmd+Shift+E change nothing, each with a Sidebar-only control that must run transitions; the Seamless control must make the baseline comparison fail', only, () => {
  const c3 = read('c3-bare-reveal.mjs');
  assert.match(c3, /kind: 'held', view, look: 'dark', speed: 'premium'/);
  assert.match(c3, /view transition\(s\) ran for a \$\{trig\} that must do nothing/);
  assert.match(c3, /the \$\{trig\} ran no view transition in the Sidebar-only layout: the rig is blind/);
  assert.match(c3, /negative control \(field named again\) was not caught by the Seamless comparison: the rig is blind/);
  assert.match(c3, /filter\(b => \/view-transition layers\/\.test\(b\)\)/);
  assert.doesNotMatch(c3, /for \(const view of views\) for \(const look of looks\) for \(const speed of speeds\) out\.push/, 'the old Full/Compact/Focus bare configs are gone');
});

test('c4: the scene still asks for the sidebar away, and the check requires that Sidebar mode kept it docked (data-sbmode block) before judging the popups against the field', only, () => {
  const c4 = read('c4-bare-popups.mjs');
  assert.match(c4, /await scene\(ctx, \{view, look, sbmode: true, open: false\}\);/);
  assert.match(c4, /if \(bare !== 'block'\) bad\.push\(`Sidebar mode did not keep the sidebar docked/);
  assert.doesNotMatch(c4, /the scene is not the bare state/);
});
