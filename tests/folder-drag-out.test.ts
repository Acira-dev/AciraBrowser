import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createInitialState, reduceBrowser } from '../src/runtime/core';
import { dropPlace, folderEndFlip, stayDrop, tabDropAtPoint } from '../src/components/tabGroupDrag';
import type { BrowserAction, BrowserSnapshot } from '../src/runtime/types';

// 13.9, a user's video (13 Nov): a folder "trying" with three tabs and a loose tab above it. Taking a tab OUT of the folder was hard: dropping just below the last child or just above the header
// kept landing inside, and the grey slot and the blue line did not say where the tab would go. The sidebar's drop is one description now (dropPlace) for the slot, the line and the drop;
// the folder's ends are zones (the top of the header, below the last child), and what is tested is the list as it lies with the carried row's place closed.
const read = (path: string) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

type Box = { left: number; top: number; width: number; height: number };
const rect = (b: Box) => ({ left: b.left, top: b.top, right: b.left + b.width, bottom: b.top + b.height, width: b.width, height: b.height, x: b.left, y: b.top }) as DOMRect;
const el = (dataset: Record<string, string>, box: Box) => ({ dataset, hasAttribute: () => false, getBoundingClientRect: () => rect(box), querySelectorAll: () => [] }) as unknown as HTMLElement;

function scene() {
  let s: BrowserSnapshot = createInitialState();
  const tab = (name: string) => { s = reduceBrowser(s, { type: 'tab.new', url: `https://${name.toLowerCase()}.test/` }); s.tabs.at(-1)!.title = name; return s.tabs.at(-1)!.id; };
  const start = tab('Start'), c1 = tab('c1'), c2 = tab('c2'), c3 = tab('c3'), loose = tab('Loose');
  s = reduceBrowser(s, { type: 'tab.group.create', tabId: c1, name: 'trying' });
  s = reduceBrowser(s, { type: 'tab.group.assign', tabIds: [c2, c3], groupId: s.tabGroups[0].id });
  const group = s.tabGroups[0].id, tabs = s.tabs, groups = s.tabGroups;
  // 32px rows: Start 68, header 100, c1 132, c2 164, c3 196, Loose 228 (children indented 21px)
  const row = (id: string, top: number, indent = 0) => el({ tabId: id }, { left: 8 + indent, top, width: 224 - indent, height: 32 });
  const nodes = [row(start, 68), row(c1, 132, 21), row(c2, 164, 21), row(c3, 196, 21), row(loose, 228)], header = el({ groupHeader: group }, { left: 8, top: 100, width: 224, height: 32 });
  const root = { ownerDocument: { querySelectorAll: () => [], elementFromPoint: () => null }, getBoundingClientRect: () => rect({ left: 0, top: 60, width: 240, height: 300 }),
    querySelectorAll: (selector: string) => selector === '[data-tab-id]' ? nodes : selector === '[data-group-header]' ? [header] : [] } as unknown as HTMLElement;
  const drop = (from: string, y: number): BrowserAction | null => tabDropAtPoint(root, { x: 100, y }, from, tabs, groups, true);
  return { start, c1, c2, c3, loose, group, tabs, groups, drop };
}

test('below the last child is a place outside the folder, and the last child\'s own row is inside it', () => {
  const w = scene();
  // 13.8: the bottom 6px of the last row counted as leaving, the rest of it inside, and what lay below it (a pitch of the room) was tested against the wrong row
  assert.deepEqual(w.drop(w.start, 226), { type: 'tab.drop', from: w.start, to: w.c3, position: 'after', groupId: w.group }, 'the last row, even its bottom edge, is inside');
  assert.deepEqual(w.drop(w.start, 230), { type: 'tab.drop', from: w.start, to: w.loose, position: 'before', groupId: null }, 'the row below the folder: out, above it');
  assert.deepEqual(w.drop(w.start, 258), { type: 'tab.drop', from: w.start, to: w.loose, position: 'after', groupId: null });
});

test('the top of the folder\'s header is a place above the folder; the rest of it drops onto the folder (a folder\'s own tab stays first inside)', () => {
  const w = scene();
  assert.deepEqual(w.drop(w.start, 108), { type: 'tab.drop', from: w.start, to: w.c1, position: 'before', groupId: null }, 'top 40% of the header: above the folder');
  assert.deepEqual(w.drop(w.start, 120), { type: 'tab.drop', from: w.start, groupId: w.group }, 'the rest of the header: onto the folder');
  assert.deepEqual(w.drop(w.c2, 108), { type: 'tab.drop', from: w.c2, to: w.c1, position: 'before', groupId: null }, 'a folder\'s own tab pulled over the top of its header leaves above it');
  assert.deepEqual(w.drop(w.c2, 120), { type: 'tab.drop', from: w.c2, to: w.c1, position: 'before', groupId: w.group }, 'over the rest of its own header it stays, first');
});

test('the pointer the decision reads can be the one in the closed list (the sidebar passes it): rows are measured where they lie with the carried row\'s place closed', () => {
  const w = scene();
  assert.match(read("src/components/tabGroupDrag.ts"), /measure:\(node:HTMLElement\)=>DOMRect=node=>node\.getBoundingClientRect\(\),reach\?:Point\)/);
  assert.match(read("src/components/tabGroupDrag.ts"), /const aim=reach\?\?point,hitPoint=/);
  void w;
});

test('dropPlace: one description of where a drop lands, for the slot, the line and the room', () => {
  const w = scene(), place = (action: BrowserAction | null) => dropPlace(action, w.tabs, w.groups);
  assert.deepEqual(place({ type: 'tab.drop', from: w.start, to: w.c2, position: 'after', groupId: w.group }), { kind: 'edge', anchor: 'tab', id: w.c2, position: 'after', level: 'in', to: w.c2 });
  assert.deepEqual(place({ type: 'tab.drop', from: w.start, to: w.loose, position: 'before', groupId: null }), { kind: 'edge', anchor: 'tab', id: w.loose, position: 'before', level: 'top', to: w.loose });
  assert.deepEqual(place({ type: 'tab.drop', from: w.c2, to: w.c3, position: 'after', groupId: null }), { kind: 'edge', anchor: 'block', id: w.group, position: 'after', level: 'top', to: w.c3 }, 'leaving at the folder\'s last place: the edge of the whole folder, at the top level (13.8 drew it inside, at the last row)');
  assert.deepEqual(place({ type: 'tab.drop', from: w.c2, to: w.c1, position: 'before', groupId: null }), { kind: 'edge', anchor: 'block', id: w.group, position: 'before', level: 'top', to: w.c1 }, 'leaving at the first place: above the folder\'s header');
  assert.deepEqual(place({ type: 'tab.drop', from: w.start, groupId: w.group }), { kind: 'join', group: w.group });
  assert.equal(place({ type: 'tab.drop', from: w.start, groupId: null }), null);
});

test('stayDrop: where the carried tab stands now is a decision of its own, in its own folder or beside its neighbour', () => {
  const w = scene();
  assert.deepEqual(stayDrop(w.c3, w.tabs, w.groups), { type: 'tab.drop', from: w.c3, to: w.c2, position: 'after', groupId: w.group }, 'a last child stays last in its folder (13.8 let a release over its own row leave the folder)');
  assert.deepEqual(stayDrop(w.c1, w.tabs, w.groups), { type: 'tab.drop', from: w.c1, to: w.c2, position: 'before', groupId: w.group });
  assert.deepEqual(stayDrop(w.start, w.tabs, w.groups), { type: 'tab.drop', from: w.start, to: w.c1, position: 'before', groupId: null }, 'a loose tab next to a folder stays above it');
});

test('at a folder\'s end the slot is one place two levels deep: its upper part keeps the tab inside, its lower part takes it out, with a band between', () => {
  const w = scene(), slot = { top: 228, height: 32 };
  const inside: BrowserAction = { type: 'tab.drop', from: w.start, to: w.c3, position: 'after', groupId: w.group }, out: BrowserAction = { ...inside, groupId: null };
  assert.equal(folderEndFlip(inside, w.tabs, w.groups, 236, slot), null, 'upper part: inside stays');
  assert.deepEqual(folderEndFlip(inside, w.tabs, w.groups, 252, slot), out, 'lower part: out (the pointer never has to cross a whole empty row)');
  assert.equal(folderEndFlip(out, w.tabs, w.groups, 250, slot), null, 'in the band, out stays out');
  assert.deepEqual(folderEndFlip(out, w.tabs, w.groups, 238, slot), inside, 'back in the upper part: inside again');
  assert.equal(folderEndFlip(stayDrop(w.c3, w.tabs, w.groups), w.tabs, w.groups, 255, slot), null, 'a last child over its own place stays: that is not a decision to leave');
});

test('the sidebar: one read of the drop (listDrop), one place for the slot, the line and the room; the line sits at the top level for a tab leaving; a release does what was shown', () => {
  const sidebar = read('src/components/sidebar/AciraSidebar.tsx'), drag = read('src/ui/sidebarTabDrag.ts'), css = read('src/components/sidebar/sidebar.css');
  assert.match(sidebar, /const hintOf=\(raw:BrowserAction\|null,over:BrowserAction\|null\)/);
  assert.match(sidebar, /if\(where\.position==='after'\)return \{id:where\.to,position:'after',out:true\};/, 'leaving after the folder: the line is on its last row, drawn at the top level');
  assert.match(sidebar, /hintOut=\{!options\.copy&&!!hint&&'id' in hint&&hint\.id===tab\.id&&hint\.out\}/);
  assert.match(sidebar, /data-drop-out=\{hint&&hintOut\|\|undefined\}/);
  assert.match(css, /\.sb-tab\[data-drop-out\]::before\{left:calc\(30px - var\(--sb-group-indent,21px\)\)\}/);
  assert.match(sidebar, /lastDrop\.current!==undefined&&lastPoint\.current&&Math\.hypot\(point\.x-lastPoint\.current\.x,point\.y-lastPoint\.current\.y\)<2\?lastDrop\.current:listDrop\(/, 'a release does what the list was showing');
  assert.match(sidebar, /if\(preview&&reach===null\)\{const slot=preview\.slot\(\),last=lastDrop\.current===undefined\?stayDrop\(/, 'inside the open slot the last decision stands, and at the start the tab stays');
  assert.match(drag, /const closed=\(node:HTMLElement\)=>/);
  assert.match(drag, /const reach=\(point:Point\):Point\|null=>/);
  assert.match(drag, /if\(where\?\.kind==='join'\)\{showGap\(null\);return;\}/, 'onto a folder\'s header no slot opens and the rows stay (the header stays under the pointer)');
  assert.match(drag, /level=edge\?\.anchor==='block'&&block\?bounds\(block\):box;/, 'at the top level the slot is as wide as a top-level row');
});
