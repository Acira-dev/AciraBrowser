import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createInitialState, persistedSnapshot, reduceBrowser, restoreSnapshot } from '../src/runtime/core';
import type { BrowserSnapshot } from '../src/runtime/types';
import { tabStripBlocks, tabStripEntries } from '../src/ui/tabStripEntries';
import { stripLayout, stripSpacing } from '../src/ui/tabStripLayout';
import { standardTabDragConstraints } from '../src/ui/standardTabs';

function splitState() {
  let s = createInitialState(); const first = s.activeTabId;
  s = reduceBrowser(s, { type: 'tab.new', url: 'https://second.test/' }); const second = s.activeTabId;
  s = reduceBrowser(s, { type: 'tab.new', url: 'https://third.test/' }); const third = s.activeTabId;
  s = reduceBrowser(s, { type: 'tab.select', id: first });
  s = reduceBrowser(s, { type: 'split.open', tabIds: [first, second] });
  return { s, first, second, third, group: s.windowUi.splitGroups![0].id };
}

test('R3-30: a collapsed split lists no member rows, so the selected tab has no slot (and its pill is hidden)', () => {
  const { s, first, second, third, group } = splitState();
  const expanded = tabStripEntries(s.tabs, s.tabGroups, false, s.windowUi.splitGroups);
  assert.deepEqual(expanded.filter(entry => !entry.header).map(entry => entry.tab.id), [first, second, third]);
  assert.ok(expanded.some(entry => entry.header && entry.splitGroup?.id === group));
  const folded = reduceBrowser(s, { type: 'split.group.toggle', id: group });
  const collapsed = tabStripEntries(folded.tabs, folded.tabGroups, false, folded.windowUi.splitGroups);
  assert.deepEqual(collapsed.filter(entry => !entry.header).map(entry => entry.tab.id), [third], 'members are folded into the chip');
  assert.equal(collapsed.findIndex(entry => !entry.header && entry.tab.id === folded.activeTabId), -1, 'the active member has no visible row: the strip must not draw its pill');
  const again = reduceBrowser(folded, { type: 'split.group.toggle', id: group });
  assert.deepEqual(tabStripEntries(again.tabs, again.tabGroups, false, again.windowUi.splitGroups).filter(entry => !entry.header).map(entry => entry.tab.id), [first, second, third], 'members flow right after the chip again');
});

function groupedSplit() {
  let { s, first, second, third, group } = splitState();
  s = reduceBrowser(s, { type: 'tab.group.create', tabId: first, name: 'Research' });
  const gid = s.tabGroups[0].id;
  s = reduceBrowser(s, { type: 'tab.group.assign', tabIds: [second, third], groupId: gid });
  return { s, first, second, third, group, gid };
}

test('R3-27: a split whose tabs share a tab group nests inside it: group header, then the split chip and its members, all in the group', () => {
  const { s, first, second, third, group, gid } = groupedSplit();
  assert.ok(s.windowUi.splitGroups?.some(item => item.id === group), 'the group does not dissolve the split');
  assert.equal(s.tabGroups.length, 1, 'the split does not dissolve the tab group');
  const entries = tabStripEntries(s.tabs, s.tabGroups, false, s.windowUi.splitGroups);
  assert.deepEqual(entries.map(entry => (entry.nested ? 'chip' : entry.header ? 'group' : entry.tab.id === first ? 'a' : entry.tab.id === second ? 'b' : entry.tab.id === third ? 'c' : 'x')), ['group', 'chip', 'a', 'b', 'c']);
  const chip = entries.find(entry => entry.nested)!;
  assert.equal(chip.group?.id, gid);
  assert.equal(chip.splitGroup?.id, group);
  assert.equal(entries.find(entry => entry.header && !entry.nested && entry.group)?.count, 3, 'the tally counts the split members');
  const blocks = tabStripBlocks(entries);
  assert.equal(blocks.length, 1);
  assert.deepEqual(blocks[0].items.map(item => item.entry.nested ? 'chip' : item.entry.header ? 'group' : 'tab'), ['group', 'chip', 'tab', 'tab', 'tab'], 'the group block spans its nested split');
});

test('R3-27: collapsing the group hides the split too; the chip folds only the members; ungrouping keeps the split', () => {
  let { s, group, gid } = groupedSplit();
  const shown = (state: BrowserSnapshot) => tabStripEntries(state.tabs, state.tabGroups, false, state.windowUi.splitGroups).filter(entry => entry.splitGroup).length;
  assert.equal(shown(s), 3);
  s = reduceBrowser(s, { type: 'split.group.toggle', id: group });
  assert.equal(shown(s), 1, 'folding the split leaves its chip inside the group');
  s = reduceBrowser(s, { type: 'split.group.toggle', id: group });
  const collapsed = reduceBrowser(s, { type: 'tab.group.update', id: gid, patch: { collapsed: true } });
  assert.equal(shown(collapsed), 0, 'a collapsed group hides the chip and its members');
  const loose = reduceBrowser(s, { type: 'tab.group.remove', id: gid });
  assert.equal(loose.tabGroups.length, 0);
  assert.deepEqual(loose.windowUi.splitGroups?.map(item => item.id), [group], 'ungrouping keeps the split');
  assert.ok(tabStripEntries(loose.tabs, loose.tabGroups, false, loose.windowUi.splitGroups).every(entry => !entry.nested), 'and it stands alone again');
});

test('R3-27: nesting survives a restart; a pane given a group takes its split along into it (SPLIT_IN_GROUPS, 28 Oct: no linked tabs)', () => {
  const { s, group } = groupedSplit();
  const back = restoreSnapshot(persistedSnapshot(s));
  assert.deepEqual(back.windowUi.splitGroups?.map(item => item.id), [group]);
  assert.ok(tabStripEntries(back.tabs, back.tabGroups, false, back.windowUi.splitGroups).some(entry => entry.nested));
  let mixed = splitState();
  let state = reduceBrowser(mixed.s, { type: 'tab.group.create', tabId: mixed.first, name: 'Only first' });
  const entries = tabStripEntries(state.tabs, state.tabGroups, false, state.windowUi.splitGroups);
  assert.ok(entries.some(entry => entry.header && entry.splitGroup && entry.nested), 'the chip sits in the first tab\'s group');
  assert.equal(entries.find(entry => !entry.header && entry.tab.id === mixed.second)?.splitGroup?.id, mixed.group, 'the other pane is in the chip, not a linked tab');
  assert.equal(state.tabs.find(tab => tab.id === mixed.first)?.group, 'Only first', 'its member keeps its own group');
  assert.equal(state.tabs.find(tab => tab.id === mixed.second)?.group, 'Only first', 'the other pane followed it into the group');
});

test('R3-23: a dragged tab is free in two dimensions: no axis lock on the row, only the horizontal limits of the strip', () => {
  const strip = fs.readFileSync(path.resolve('src/components/BrowserTabsHorizontal.tsx'), 'utf8'), compact = fs.readFileSync(path.resolve('src/components/CompactTabs.tsx'), 'utf8');
  assert.match(strip, /drag=\{true\}/);
  assert.doesNotMatch(strip, /drag=\{group\?true:"x"\}/);
  assert.match(compact, /drag=\{draggable\}/);
  assert.match(strip, /NO_ELASTIC=\{left:0,right:0,top:0,bottom:0\}/);
  const limits = standardTabDragConstraints({ current: { scrollLeft: 0, clientWidth: 800 } }, 200, 148);
  assert.deepEqual(Object.keys(limits).sort(), ['left', 'right'], 'nothing limits the vertical travel');
  assert.equal(limits.left, -200);
  assert.equal(limits.right, 800 - 148 - 200);
});

test('R3-25: the split picker is glass (live blur over a translucent tint, hairline, layered shadow) with wells for its layouts and a speed-aware spring', () => {
  const css = fs.readFileSync(path.resolve('src/styles/split-picker.css'), 'utf8'), card = css.match(/\.split-picker-card\{[^}]*\}/)![0], tsx = fs.readFileSync(path.resolve('src/components/SplitPicker.tsx'), 'utf8');
  assert.match(card, /background:var\(--split-tint\)/);
  assert.match(card, /backdrop-filter:blur\(var\(--frost-blur,32px\)\) saturate\(/);
  assert.match(card, /box-shadow:var\(--split-hairline\),var\(--split-shadow\)/);
  assert.match(css, /--split-tint:color-mix\(in srgb,var\(--glass\) \d\d%,transparent\)/, 'translucent, not the opaque panel colour');
  assert.match(css, /\.split-picker-thumb\{[^}]*background:var\(--split-well\)[^}]*inset 0 1px 3px/, 'layouts are recessed wells');
  assert.match(css, /\.split-picker-cell\{[^}]*background:var\(--split-cell\)/);
  assert.doesNotMatch(css, /transition:[^;}]*backdrop-filter|animation:[^;}]*blur/, 'blur never animates (bible 3.9)');
  assert.match(tsx, /motionScale\(\)/, 'reads the global speed setting');
  assert.match(tsx, /morphSpring\('popover\.grow', scale\)/, 'grows in on the research\'s popover token');
  assert.match(tsx, /morphSpring\('menu\.shrink', scale\)/, 'leaves on menu.shrink');
  assert.match(tsx, /scale === 0 \? \{ duration: 0 \}/, 'speed Off (or reduced motion) shows it at once');
});

test('R3-24: a split reads as one unit: its chip and members are joined (2px) and set off from their neighbours', () => {
  const { s } = splitState();
  const entries = tabStripEntries(s.tabs, s.tabGroups, false, s.windowUi.splitGroups);   // chip, a, b, c
  const spacing = stripSpacing(entries);
  assert.deepEqual(spacing, [4, 2, 2, 8], 'inside the split 2px; a tab leaving it keeps the 4px gap plus the container padding');
  assert.equal(stripLayout(entries, entries.map(() => 100)).occupied, 4 + 100 + 2 + 100 + 2 + 100 + 8 + 100, 'a split that ends the strip leaves room for its container edge');
  const folded = reduceBrowser(s, { type: 'split.group.toggle', id: s.windowUi.splitGroups![0].id });
  const chip = tabStripEntries(folded.tabs, folded.tabGroups, false, folded.windowUi.splitGroups)[0];
  assert.ok(chip.fixedWidth! >= 150, 'a folded chip has room for the members\' site icons');
  assert.ok(entries[0].fixedWidth! >= 130 && entries[0].fixedWidth! < chip.fixedWidth!, 'an open chip is narrower: the count replaces the icons');
});

test('R3-33: Focus mode on and off leaves a split exactly as it was, and the compact strip draws it as a split chip, not as loose tabs or a group', () => {
  const { s, first, second } = splitState();
  const on = reduceBrowser(s, { type: 'ui.update', patch: { focusMode: true } });
  assert.deepEqual(on.windowUi.split, s.windowUi.split);
  assert.deepEqual(on.windowUi.splitGroups, s.windowUi.splitGroups);
  assert.deepEqual(on.tabGroups, s.tabGroups, 'no tab group appears');
  const compact = tabStripEntries(on.tabs, on.tabGroups, true, on.windowUi.splitGroups);
  assert.ok(compact.some(entry => entry.header && entry.splitGroup && !entry.group), 'the chip leads its members');
  assert.deepEqual(compact.filter(entry => entry.splitGroup && !entry.header).map(entry => entry.tab.id), [first, second]);
  const off = reduceBrowser(on, { type: 'ui.update', patch: { focusMode: false } });
  assert.deepEqual(off.windowUi.split, s.windowUi.split);
  assert.deepEqual(off.windowUi.splitGroups, s.windowUi.splitGroups);
  const source = fs.readFileSync(path.resolve('src/App.tsx'), 'utf8');
  assert.match(source, /splitGroups=\{state\.windowUi\.splitGroups\}/, 'App hands the saved splits to the compact strip');
});

test('R3-28: the tab bar and split menus are title-less context menus like the tab and group menus (no header on the top edge)', () => {
  const app = fs.readFileSync(path.resolve('src/App.tsx'), 'utf8'), css = fs.readFileSync(path.resolve('src/components/TabGroups.css'), 'utf8');
  // The live pull requests popup (item 31) is a title-less context menu too: its header is out of the keyboard's way like theirs.
  assert.match(app, /inert=\{\['tab-context','group-context','split-context','page-context','strip-context','live-folder'\]\.includes\(kind\)\|\|undefined\}/);
  assert.match(css, /\.popup-content-strip-context,\.popup-content-split-context\)>\.popup-header\{position:absolute/);
  assert.match(fs.readFileSync(path.resolve('desktop/validation.cjs'), 'utf8'), /'split-context'[^\]]*'strip-context'/, 'the native boundary knows the popup kind');
});

test('R3-30: the selection pill is hidden by CSS while its tab is folded away', () => {
  const css = fs.readFileSync(path.resolve('src/styles/split-groups.css'), 'utf8');
  assert.match(css, /\.tab-strip-selection,\.acira-compact-selection\)\[data-hidden\]\{opacity:0/);
  const strip = fs.readFileSync(path.resolve('src/components/BrowserTabsHorizontal.tsx'), 'utf8');
  assert.match(strip, /data-hidden=\{\(twin\?L\.layout\.current\.linkedIndex:L\.layout\.current\.selectedIndex\)<0\|\|undefined\}/);
});
