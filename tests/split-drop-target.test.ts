import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createInitialState, reduceBrowser } from '../src/runtime/core';
import { insertIndex, resolveSplitDrop, union, type SplitContainer } from '../src/ui/splitDropTarget';

// A strip: [chip 300-380][Video one 380-560][Video two 560-740] then a free tab at 744-924. Height 4-34.
const strip: SplitContainer[] = [{ id: 'split-1', box: union([{ left: 300, top: 4, right: 380, bottom: 34 }, { left: 380, top: 4, right: 560, bottom: 34 }, { left: 560, top: 4, right: 740, bottom: 34 }])!, members: [{ id: 'v1', box: { left: 380, top: 4, right: 560, bottom: 34 } }, { id: 'v2', box: { left: 560, top: 4, right: 740, bottom: 34 } }] }];

test('R3-79: a drop anywhere on the split container joins it at the slot under the pointer', () => {
  assert.deepEqual(resolveSplitDrop(strip, { x: 340, y: 18 }, 'x', false), { groupId: 'split-1', index: 0 }, 'on the chip: before the first member');
  assert.deepEqual(resolveSplitDrop(strip, { x: 420, y: 18 }, 'x', false), { groupId: 'split-1', index: 0 }, 'on the first half of the first member');
  assert.deepEqual(resolveSplitDrop(strip, { x: 560, y: 18 }, 'x', false), { groupId: 'split-1', index: 1 }, 'between the two members (the founder\'s two YouTube tabs)');
  assert.deepEqual(resolveSplitDrop(strip, { x: 720, y: 18 }, 'x', false), { groupId: 'split-1', index: 2 }, 'past the last member\'s centre: at the end');
  assert.equal(resolveSplitDrop(strip, { x: 742, y: 18 }, 'x', false), null, 'the gap just outside the container is an ordinary reorder');
  assert.equal(resolveSplitDrop(strip, { x: 500, y: 60 }, 'x', false), null, 'below the strip: not the split');
  assert.deepEqual(resolveSplitDrop(strip, { x: 600, y: 18 }, 'v1', false), { groupId: 'split-1', index: 0 }, 'a member dragged inside its own split counts the others only');
});

test('R3-79: a sidebar split lists its members top to bottom', () => {
  const side: SplitContainer[] = [{ id: 'split-2', vertical: true, box: { left: 8, top: 100, right: 230, bottom: 196 }, members: [{ id: 'a', box: { left: 8, top: 132, right: 230, bottom: 164 } }, { id: 'b', box: { left: 8, top: 164, right: 230, bottom: 196 } }] }];
  assert.deepEqual(resolveSplitDrop(side, { x: 100, y: 166 }, 'x', false), { groupId: 'split-2', index: 1 });
  assert.equal(insertIndex([10, 20, 30], 25), 2); assert.equal(insertIndex([], 5), 0);
});

test('a sidebar card\'s edges are drop zones: 6px inside the bottom edge is the last slot, 6px inside the top edge the first (28 Oct)', () => {
  // A card 8-230 × 100-196: header 102-130, panes 130-162 and 162-194 (2px card padding).
  const card: SplitContainer[] = [{ id: 'split-3', vertical: true, box: { left: 8, top: 100, right: 230, bottom: 196 }, members: [{ id: 'a', box: { left: 10, top: 130, right: 228, bottom: 162 } }, { id: 'b', box: { left: 10, top: 162, right: 228, bottom: 194 } }] }];
  assert.deepEqual(resolveSplitDrop(card, { x: 119, y: 190 }, 'x', false), { groupId: 'split-3', index: 2 }, 'bottom edge (on the last pane\'s lower half): after the last pane');
  assert.deepEqual(resolveSplitDrop(card, { x: 119, y: 195 }, 'x', false), { groupId: 'split-3', index: 2 }, 'the card\'s own padding below the last pane');
  assert.deepEqual(resolveSplitDrop(card, { x: 119, y: 106 }, 'x', false), { groupId: 'split-3', index: 0 }, 'top edge (the header): before the first pane');
  assert.equal(resolveSplitDrop(card, { x: 119, y: 198 }, 'x', false), null, 'the 3px margin under the card is an ordinary reorder');
  // The sidebar draws the slot as its own drop line (the strips' inset bar hid under a current row's raised card).
  const sidebar = fs.readFileSync(path.resolve('src/components/sidebar/sidebar.css'), 'utf8'), strips = fs.readFileSync(path.resolve('src/styles/split-groups.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(sidebar, /\.acira-sidebar \.sb-tab:is\(\[data-drop\],\[data-split-insert\]\)::before\{content:'';position:absolute;left:30px;right:8px;height:2px/);
  assert.match(sidebar, /\.sb-tab:is\(\[data-drop=before\],\[data-split-insert=before\]\)::before\{top:-1px\}/);
  assert.match(sidebar, /\.sb-tab:is\(\[data-drop=after\],\[data-split-insert=after\]\)::before\{bottom:-1px\}/);
  assert.doesNotMatch(strips, /\.sb-tab\[data-split-insert/);
});

test('R3-79: split.group.add takes the slot (and a member moved inside its split just changes place)', () => {
  let s = createInitialState(); const first = s.activeTabId;
  for (const url of ['https://two.test/', 'https://three.test/', 'https://four.test/']) s = reduceBrowser(s, { type: 'tab.new', url });
  const [, second, third, fourth] = s.tabs.map(tab => tab.id);
  s = reduceBrowser(s, { type: 'tab.select', id: first }); s = reduceBrowser(s, { type: 'split.open', tabIds: [first, second] });
  const group = s.windowUi.splitGroups![0].id;
  const joined = reduceBrowser(s, { type: 'split.group.add', id: group, tabId: third, index: 1 });
  assert.deepEqual(joined.windowUi.splitGroups!.find(g => g.id === group)!.tabIds, [first, third, second], 'dropped between the two members');
  const atEnd = reduceBrowser(s, { type: 'split.group.add', id: group, tabId: fourth });
  assert.deepEqual(atEnd.windowUi.splitGroups!.find(g => g.id === group)!.tabIds, [first, second, fourth], 'no slot: at the end, as before');
  const moved = reduceBrowser(s, { type: 'split.group.add', id: group, tabId: first, index: 1 });
  assert.deepEqual(moved.windowUi.splitGroups!.find(g => g.id === group)!.tabIds, [second, first]);
  assert.equal(moved.tabs.length, s.tabs.length);
  const validation = fs.readFileSync(path.resolve('desktop/validation.cjs'), 'utf8');
  assert.match(validation, /\['id','tabId','wholeGroup','index'\]/, 'the bridge accepts the slot');
  const drag = fs.readFileSync(path.resolve('src/components/tabGroupDrag.ts'), 'utf8');
  assert.match(drag, /const splitDrop=splitDropAt\(root\.ownerDocument,point,from,vertical\);\r?\n if\(splitDrop\)return \{type:'split\.group\.add',id:splitDrop\.groupId,tabId:from,index:splitDrop\.index\};/);
  assert.match(fs.readFileSync(path.resolve('src/components/sidebar/SidebarSplit.tsx'), 'utf8'), /data-split-container=\{split\.id\}/);
});
