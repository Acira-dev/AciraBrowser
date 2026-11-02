import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { sectionFocusTarget } from '../src/components/useSectionFocus';

/** The split header menu (sidebar) moves keyboard focus like the tab group menu: into a section it opens (the back row), and back to the
 *  row that opened it when the section is left. Real app, native keys: qa/split-menu-focus.mjs. */
const row = (text: string) => ({ textContent: `  ${text} ` });
const labels = { layout: 'Change layout', groups: 'Move to tab group' };

test('opening a section focuses its first row; leaving it focuses the row that opened it, found by its text', () => {
  const main = [row('New tab in split view'), row('Change layout'), row('Rename…'), row('Move to tab group'), row('Unsplit')];
  const section = [row('Change layout'), row('Columns'), row('Rows')];
  assert.equal(sectionFocusTarget(section, 'layout', null, labels), section[0], 'into a section: its first row (the back row)');
  assert.equal(sectionFocusTarget(main, null, 'layout', labels), main[1], 'back from Change layout: the row that opened it');
  assert.equal(sectionFocusTarget(main, null, 'groups', labels), main[3], 'back from Move to tab group: its row');
  assert.equal(sectionFocusTarget(main, null, null, labels), undefined, 'a menu that never opened a section moves no focus');
  assert.equal(sectionFocusTarget(main, null, 'groups', { ...labels, groups: 'In Tab-Gruppe verschieben' }), undefined, 'the row is found by the active language\'s text, nothing else');
  assert.equal(sectionFocusTarget([], 'layout', null, labels), undefined, 'an empty section has nothing to focus');
});

test('SplitHeaderMenu wires the hook before its early return, with both section rows, in the active language', () => {
  const source = fs.readFileSync(new URL('../src/components/sidebar/SplitHeaderMenu.tsx', import.meta.url), 'utf8');
  const hook = source.indexOf('useSectionFocus(menu,section,');
  assert.ok(hook > 0, 'SplitHeaderMenu calls useSectionFocus');
  assert.ok(hook < source.indexOf('if(!group)return null;'), 'hooks run before the early return');
  const call = source.slice(hook, source.indexOf(');', hook));
  assert.ok(call.includes('layout:t("acirasidebar.splitChangeLayout")') && call.includes('groups:t("tabgroupcontrols.moveToTabGroup")'), 'the labels are the translated rows that open each section');
  assert.ok(source.includes("['ArrowLeft','Escape'].includes(event.key)"), 'ArrowLeft and Escape leave a section');
});

test('the hook focuses on section changes only, like TabGroupControls', () => {
  const source = fs.readFileSync(new URL('../src/components/useSectionFocus.ts', import.meta.url), 'utf8');
  assert.ok(source.includes('if(!section&&!before)return;'), 'no focus move on the first render');
  assert.ok(source.includes("[role=menuitem]") && source.includes('preventScroll:true'), 'it uses the menu items and does not scroll');
});
