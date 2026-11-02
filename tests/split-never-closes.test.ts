import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createInitialState, reduceBrowser } from '../src/runtime/core';
import type { BrowserAction, BrowserSnapshot } from '../src/runtime/types';

/** R3-78 (founder 26 Oct, corrected): Unsplit separates a split's tabs and never closes one; Close split is the only split
 *  control that closes tabs (with Undo). Every other split or pane control keeps every tab open. */
function withSplit() {
  let s = createInitialState(); const first = s.activeTabId;
  for (const url of ['https://two.test/', 'https://three.test/', 'https://four.test/']) s = reduceBrowser(s, { type: 'tab.new', url });
  const [, second, third, fourth] = s.tabs.map(tab => tab.id);
  s = reduceBrowser(s, { type: 'tab.select', id: first });
  s = reduceBrowser(s, { type: 'split.open', tabIds: [first, second] });
  return { s, first, second, third, fourth, group: s.windowUi.splitGroups![0].id };
}
const ids = (s: BrowserSnapshot) => s.tabs.map(tab => tab.id);

test('R3-78: Unsplit and every split or pane control other than Close split keeps every tab open', () => {
  const { s, first, second, third, group } = withSplit();
  const controls: Array<[string, BrowserAction]> = [
    ['Unsplit', { type: 'split.unsplit', groupId: group }],
    ['Close split view (leave the view, keep the saved split)', { type: 'split.close' }],
    ['a pane\'s × (Remove from split view)', { type: 'split.remove', tabId: second }],
    ['the other pane\'s ×', { type: 'split.remove', tabId: first }],
    ['Change layout', { type: 'split.layout', layout: 'rows' }],
    ['swap panes', { type: 'split.swap', a: first, b: second }],
    ['resize', { type: 'split.resize', cols: [.3, .7] }],
    ['ratio', { type: 'split.ratio', ratio: .4 }],
    ['Rename', { type: 'split.rename', groupId: group, name: 'Reading' }],
    ['fold the chip', { type: 'split.group.toggle', id: group }],
    ['open the saved split', { type: 'split.group.select', id: group }],
    ['add a pane', { type: 'split.add', tabId: third }],
    ['New tab in split', { type: 'split.addTab', groupId: group }],
  ];
  for (const [name, action] of controls) {
    const after = reduceBrowser(s, action);
    assert.ok(ids(s).every(id => ids(after).includes(id)), `${name} closed a tab`);
    assert.ok(after.tabs.length >= s.tabs.length, `${name} removed a tab`);
  }
  // Two in a row (the founder's path: Unsplit after a pane change) still closes nothing.
  const twice = reduceBrowser(reduceBrowser(s, { type: 'split.remove', tabId: second }), { type: 'split.unsplit', groupId: group });
  assert.deepEqual(ids(twice), ids(s));
});

test('R3-78: Close split is the one control that closes the split\'s tabs, and only those', () => {
  const { s, first, second, third, fourth, group } = withSplit();
  const after = reduceBrowser(s, { type: 'split.close', groupId: group });
  assert.ok(!ids(after).includes(first) && !ids(after).includes(second), 'its members are closed');
  assert.ok(ids(after).includes(third) && ids(after).includes(fourth), 'other tabs stay');
});

test('R3-78: the split menus and pane controls dispatch Unsplit / remove, never a tab close', () => {
  for (const file of ['src/components/SplitRibbon.tsx', 'src/components/SplitGroupHeader.tsx', 'src/components/sidebar/SplitHeaderMenu.tsx', 'src/components/sidebar/SidebarSplit.tsx', 'src/components/SplitPicker.tsx']) {
    assert.doesNotMatch(fs.readFileSync(path.resolve(file), 'utf8'), /type:\s*'tab\.close'/, `${file} closes a tab`);
  }
  const menu = fs.readFileSync(path.resolve('src/components/sidebar/SplitHeaderMenu.tsx'), 'utf8');
  assert.match(menu, /item\(t\("acirasidebar\.splitUnsplit"\),\(\)=>run\(\{type:'split\.unsplit',groupId:id\}\),<Unplug size=\{15\}\/>\)/, 'Unsplit separates (with its glyph)');
  assert.match(menu, /item\(t\("acirasidebar\.splitClose"\),\(\)=>run\(\{type:'split\.close',groupId:id\}\),<X size=\{15\}\/>,false,true\)/, 'Close split is the red row');
  // R3-78b: every row of the split menu has a glyph in the icon column (New tab in split, Change layout, Rename, Unsplit, Close split).
  for (const glyph of ['<Plus size={15}/>', '<Columns2 size={15}/>', 'icon={<PenLine size={15}/>}', '<Unplug size={15}/>', '<X size={15}/>']) assert.ok(menu.includes(glyph), `missing ${glyph}`);
  assert.match(fs.readFileSync(path.resolve('src/components/MenuFormFlyout.tsx'), 'utf8'), /\{icon\?\?<span\/>\}<span className="acira-menu-title">/, 'a flyout row can carry a glyph');
});
