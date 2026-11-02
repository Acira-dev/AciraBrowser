import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { armsRowGuard, installRowSelectionGuard } from '../src/ui/rowSelectionGuard';

// Coordinator, 27 Oct: a press-and-drag on any sidebar or strip row must never leave text selected; text fields stay selectable.
const node = (inArea: boolean, editable = false) => ({ closest: (selector: string) => (selector.includes('.acira-sidebar') ? inArea : editable) || null });

test('a press on a row in the sidebar or a strip arms the guard; a press in a text field or outside does not', () => {
  assert.equal(armsRowGuard(node(true)), true);
  assert.equal(armsRowGuard(node(true, true)), false, 'inline rename fields and inputs keep their selection');
  assert.equal(armsRowGuard(node(false)), false, 'the page and other surfaces are untouched');
  assert.equal(armsRowGuard(null), false);
});

test('after a press on a row the selection the drag would start is blocked and an old selection is cleared; after release it is not', () => {
  let cleared = 0;
  const doc = new EventTarget() as EventTarget & { getSelection: () => unknown; activeElement: unknown };
  doc.getSelection = () => ({ isCollapsed: false, removeAllRanges: () => { cleared++; } }); doc.activeElement = null;
  installRowSelectionGuard(doc as unknown as Document);
  const fire = (type: string, target: unknown, extra: Record<string, unknown> = {}) => { const event = new Event(type, { cancelable: true }); Object.defineProperty(event, 'target', { value: target }); Object.assign(event, extra); doc.dispatchEvent(event); return event; };
  fire('pointerdown', node(true), { button: 0 });
  assert.equal(cleared, 1, 'a drag starting on a row clears what was selected');
  assert.equal(fire('selectstart', { nodeType: 3 }).defaultPrevented, true, 'the text node under the moving pointer cannot start a selection');
  assert.equal(fire('selectstart', node(true, true)).defaultPrevented, false, 'a text field inside still can');
  fire('pointerup', node(true));
  assert.equal(fire('selectstart', { nodeType: 3 }).defaultPrevented, false, 'released, selection works again');
  fire('pointerdown', node(true, true), { button: 0 });
  assert.equal(fire('selectstart', node(true, true)).defaultPrevented, false, 'pressing in a rename field never arms it');
});

test('rows are user-select:none in the sidebar and both strips; inputs stay selectable', () => {
  const sidebar = fs.readFileSync('src/components/sidebar/sidebar.css', 'utf8'), strips = fs.readFileSync('src/styles/split-groups.css', 'utf8');
  assert.match(sidebar, /\.acira-sidebar :is\(\.sb-tab,\.sb-split-group,\.sb-group,\.sb-app,\.sb-bookmark,\.sb-folder,\.sb-new-tab\)\{-webkit-user-select:none;user-select:none\}/);
  assert.match(sidebar, /\.acira-sidebar :is\(input,textarea,\[contenteditable=true\]\)\{-webkit-user-select:text;user-select:text\}/);
  assert.match(strips, /:is\(\.tabs-strip,\.acira-compact-tabs\) :is\(\.tab-flow,\[data-group-header\],\.split-group-parent\)\{-webkit-user-select:none;user-select:none\}/);
  for (const file of ['src/components/sidebar/AciraSidebar.tsx', 'src/components/BrowserTabsHorizontal.tsx', 'src/components/CompactTabs.tsx'])
    assert.match(fs.readFileSync(file, 'utf8'), /installRowSelectionGuard\(\);/, `${file} installs the guard`);
});
