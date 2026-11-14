import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { revealQuiet } from '../src/ui/revealQuiet';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

// Round 6, 150 % (a sidebar list that overflows): selecting a tab the list has scrolled away from docked the "current tab" pill under the list at once, and the Bookmarks row a frame later:
// two 36px steps off the list's height before the scroll had begun (279 -> 243 -> 207px), the bottom rows cut and both rows popping in. 13.8 does the same. The pill is for a tab the
// list is scrolled away from, not for one it is on its way to show.
test('the quiet lasts from the start of a reveal to the end of its scroll', () => {
  const q = revealQuiet();
  assert.equal(q.quiet(), false, 'at rest the pill may show');
  const a = q.start();
  assert.equal(q.quiet(), true, 'while the list scrolls to the tab, no pill');
  assert.equal(q.end(a), true);
  assert.equal(q.quiet(), false, 'the scroll has ended: the pill is measured for where the list stopped');
});

test('only the latest reveal ends the quiet: a late scroll or a leftover timer of an earlier one does not', () => {
  const q = revealQuiet();
  const first = q.start();
  const second = q.start();
  assert.equal(q.end(first), false, 'the first reveal was replaced');
  assert.equal(q.quiet(), true, 'the second one is still on its way');
  assert.equal(q.end(second), true);
  assert.equal(q.quiet(), false);
  // tokens are never reused, even after the quiet ended: a listener left over from the first reveal must not end a later one
  const third = q.start();
  assert.notEqual(third, first);
  assert.equal(q.end(first), false);
  assert.equal(q.quiet(), true);
  assert.equal(q.end(third), true);
});

test('ending a reveal twice is harmless', () => {
  const q = revealQuiet();
  const token = q.start();
  assert.equal(q.end(token), true);
  assert.equal(q.end(token), false);
  assert.equal(q.quiet(), false);
});

test('the sidebar measures the pill only outside the quiet, and starts and ends it around the reveal scroll', () => {
  const side = read('../src/components/sidebar/AciraSidebar.tsx');
  assert.match(side, /const measure=useCallback\(\(\)=>\{\s*if\(quiet\.quiet\(\)\)return;/, 'the pill is not measured while the list scrolls to the selected tab');
  assert.match(side, /const token=quiet\.start\(\),smooth=!\(reduced\|\|switched\);/);
  assert.match(side, /const done=\(\)=>\{if\(quiet\.end\(token\)\)measure\(\);\};/, 'at its end the pill is measured for where the list stopped');
  assert.match(side, /box\.addEventListener\('scrollend',done,\{once:true\}\);window\.setTimeout\(done,900\);/, 'the scroll ends the quiet (a timer is the fallback)');
  assert.match(side, /if\(!\(node&&box&&revealRow\(box,node,'nearest',smooth\?'smooth':'auto'\)&&smooth\)\)\{done\(\);return;\}/, 'nothing scrolled, or an instant scroll: the quiet ends at once');
  assert.match(side, /return\(\)=>\{cancelAnimationFrame\(frame\);quiet\.end\(token\);\};/, 'a newer change ends it');
  // the pill's own button (the click that centres the tab) is not a selection: it scrolls with the pill showing
  assert.match(side, /reveal:\(\)=>\{const node=row\(activeId\),box=root\.current;if\(node&&box\)revealRow\(box,node,'center'/);
});
