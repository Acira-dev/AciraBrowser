import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { tabMenuRows } from '../src/ui/popup';
import { createInitialState, persistedSnapshot, reduceBrowser, restoreSnapshot } from '../src/runtime/core';
import { splitPlacement, splitPlacements } from '../src/runtime/splitPlacement';
import { groupForTab } from '../src/runtime/tabGroups';
import { sidebarRows } from '../src/components/sidebar/sidebarRows';
import { tabStripEntries } from '../src/ui/tabStripEntries';
import { selectStripTab } from '../src/ui/splitPaneSelect';
import type { BrowserAction, BrowserSnapshot } from '../src/runtime/types';

/** docs/launch/SPLIT_IN_GROUPS.md, linked copies: home and d are loose and split; b and c are in group G, e in group H. */
function world() {
  let s = createInitialState(); const home = s.activeTabId;
  for (const url of ['https://b.test/', 'https://c.test/', 'https://d.test/', 'https://e.test/']) s = reduceBrowser(s, { type: 'tab.new', url });
  const [, b, c, d, e] = s.tabs.map(tab => tab.id);
  s = reduceBrowser(s, { type: 'tab.group.create', tabId: b, name: 'G', color: 'blue' });
  const g = s.tabGroups.find(group => group.name === 'G')!.id;
  s = reduceBrowser(s, { type: 'tab.group.assign', tabIds: [c], groupId: g });
  s = reduceBrowser(s, { type: 'tab.group.create', tabId: e, name: 'H', color: 'green' });
  const h = s.tabGroups.find(group => group.name === 'H')!.id;
  s = reduceBrowser(s, { type: 'tab.select', id: home });
  s = reduceBrowser(s, { type: 'split.open', tabIds: [home, d] });
  return { s, home, b, c, d, e, g, h };
}
const split = (s: BrowserSnapshot) => s.windowUi.splitGroups![0];
const groupId = (s: BrowserSnapshot, id: string) => groupForTab(s, s.tabs.find(tab => tab.id === id)!)?.id ?? null;
const drop = (s: BrowserSnapshot, tabId: string, index?: number) => reduceBrowser(s, { type: 'split.group.add', id: split(s).id, tabId, ...(index === undefined ? {} : { index }) });
const sidebar = (s: BrowserSnapshot) => sidebarRows(s, s.tabs.filter(tab => !tab.pinned), s.tabGroups.map(group => ({ group, members: s.tabs.filter(tab => groupForTab(s, tab)?.id === group.id) })));

test('a grouped tab dropped on a loose split stays in its group and is also a pane of the split (one tab)', () => {
  const { s: start, home, b, d, g } = world();
  const s = drop(start, b);
  assert.deepEqual(split(s).tabIds, [home, d, b]);
  assert.deepEqual(split(s).linked, [b]);
  assert.equal(groupId(s, b), g, 'the tab keeps its group');
  assert.equal(s.tabs.filter(tab => tab.id === b).length, 1, 'one tab, one page');
  assert.equal(split(s).home, home, 'the home pane is still its first own pane');
  const placement = splitPlacement(split(s), s.tabs, s.tabGroups)!;
  assert.deepEqual(placement.linked, [b]);
  assert.equal(placement.home, undefined, 'the split still lives outside every group');
  const { paneOf, linkOf } = splitPlacements(s.windowUi.splitGroups, s.tabs, s.tabGroups);
  assert.equal(paneOf.has(b), false, 'its card is not the one place the tab shows');
  assert.equal(linkOf.get(b)?.split.id, split(s).id);
  assert.equal(paneOf.get(home)?.split.id, split(s).id);
});

test('the other direction is unchanged: an ungrouped tab dropped on a split inside a group moves fully into the group', () => {
  let s = createInitialState();
  for (const url of ['https://b.test/', 'https://c.test/', 'https://d.test/']) s = reduceBrowser(s, { type: 'tab.new', url });
  const [, b, c, d] = s.tabs.map(tab => tab.id);
  s = reduceBrowser(s, { type: 'tab.group.create', tabId: b, name: 'G', color: 'blue' });
  const g = s.tabGroups[0].id;
  s = reduceBrowser(s, { type: 'tab.group.assign', tabIds: [c], groupId: g });
  s = reduceBrowser(s, { type: 'tab.select', id: b });
  s = reduceBrowser(s, { type: 'split.open', tabIds: [b, c] });
  s = reduceBrowser(s, { type: 'split.group.add', id: split(s).id, tabId: d });
  assert.equal(groupId(s, d), g, 'it joined the group');
  assert.equal(split(s).linked, undefined, 'nothing is linked');
});

test('a grouped tab dropped on a split inside another group moves into that group (links are for loose splits only)', () => {
  const { s: start, home, d, b, h, g } = world();
  let s = reduceBrowser(start, { type: 'split.move', groupId: split(start).id, tabGroupId: h });
  assert.equal(groupId(s, home), h);
  s = drop(s, b);
  assert.equal(split(s).linked, undefined);
  assert.equal(groupId(s, b), h, 'moved with the split, as before');
  assert.notEqual(groupId(s, b), g);
  assert.deepEqual(split(s).tabIds.sort(), [home, d, b].sort());
});

test('× on the split row only removes the link: the tab stays in its group, the split stays', () => {
  const { s: start, home, b, d, g } = world();
  const s = reduceBrowser(drop(start, b), { type: 'split.separate', tabId: b });
  assert.deepEqual(split(s).tabIds, [home, d]);
  assert.equal(split(s).linked, undefined);
  assert.equal(groupId(s, b), g);
  assert.ok(s.tabs.some(tab => tab.id === b), 'the tab is not closed');
});

test('closing the tab (× on the group row) closes it everywhere; the split shrinks', () => {
  const { s: start, home, b, d } = world();
  const s = reduceBrowser(drop(start, b), { type: 'tab.close', id: b });
  assert.equal(s.tabs.some(tab => tab.id === b), false);
  assert.deepEqual(split(s).tabIds, [home, d]);
  assert.equal(split(s).linked, undefined);
});

test('Remove from group turns the split row into a normal pane; ungrouping or closing the group keeps the split', () => {
  const { s: start, home, b, c, d, g } = world();
  const linked = drop(drop(start, b), c);
  assert.deepEqual(split(linked).linked, [b, c]);
  const removed = reduceBrowser(linked, { type: 'tab.group.assign', tabIds: [b], groupId: null });
  assert.deepEqual(split(removed).tabIds, [home, d, b, c]);
  assert.deepEqual(split(removed).linked, [c], 'only the other copy is still linked');
  assert.equal(groupId(removed, b), null, 'now an ordinary pane of the loose split');
  const ungrouped = reduceBrowser(linked, { type: 'tab.group.remove', id: g });
  assert.deepEqual(split(ungrouped).tabIds, [home, d, b, c], 'the split is kept');
  assert.equal(split(ungrouped).linked, undefined);
  assert.equal(groupId(ungrouped, b), null);
});

test('moving the whole split moves its own panes and leaves the copy in its group', () => {
  const { s: start, home, d, b, g, h } = world();
  const s = reduceBrowser(drop(start, b), { type: 'split.move', groupId: split(start).id, tabGroupId: h });
  assert.equal(groupId(s, home), h);
  assert.equal(groupId(s, d), h);
  assert.equal(groupId(s, b), g, 'the linked copy did not move');
  assert.deepEqual(split(s).linked, [b], 'still a copy of a tab in another group');
  const into = reduceBrowser(drop(start, b), { type: 'split.move', groupId: split(start).id, tabGroupId: g });
  assert.equal(split(into).linked, undefined, 'the split now lives in the very group the tab is in: one ordinary pane');
  assert.equal(groupId(into, b), g);
});

test('the home pane never becomes a linked copy: when it leaves, the next own pane takes over', () => {
  const { s: start, home, d, b } = world();
  const s = reduceBrowser(drop(start, b), { type: 'split.separate', tabId: home });
  assert.equal(split(s).home, d);
  assert.deepEqual(split(s).tabIds, [d, b]);
  assert.deepEqual(split(s).linked, [b]);
});

test('a split never keeps only copies: when its last own pane leaves, the panes are ordinary panes of their group', () => {
  const { s: start, home, d, b, c, g } = world();
  let s = drop(drop(start, b), c);
  s = reduceBrowser(s, { type: 'split.separate', tabId: home });
  s = reduceBrowser(s, { type: 'split.separate', tabId: d });
  assert.deepEqual(split(s).tabIds, [b, c]);
  assert.equal(split(s).linked, undefined);
  assert.equal(groupId(s, b), g);
  assert.equal(groupId(s, c), g);
  assert.equal(splitPlacement(split(s), s.tabs, s.tabGroups)!.home?.id, g, 'the split now lives in the group both tabs are in');
});

test('the last own pane leaving a split with one copy ends the split; the tab stays in its group', () => {
  const { s: start, home, d, b, g } = world();
  let s = reduceBrowser(drop(start, b), { type: 'split.separate', tabId: home });
  s = reduceBrowser(s, { type: 'split.separate', tabId: d });
  assert.equal(s.windowUi.splitGroups?.length ?? 0, 0);
  assert.equal(groupId(s, b), g);
});

test('Close split leaves the copy open in its group', () => {
  const { s: start, home, d, b, g } = world();
  const s = reduceBrowser(drop(start, b), { type: 'split.close', groupId: split(start).id });
  assert.equal(s.tabs.some(tab => tab.id === home || tab.id === d), false, 'its own panes close');
  assert.ok(s.tabs.some(tab => tab.id === b), 'the linked tab stays');
  assert.equal(groupId(s, b), g);
});

test('four panes at most, copies included', () => {
  const { s: start, b, c, e } = world();
  const four = drop(drop(start, b), c);
  assert.equal(split(four).tabIds.length, 4);
  const five = drop(four, e);
  assert.equal(split(five).tabIds.length, 4, 'refused');
  assert.equal(five.toast?.i18n?.id, 'runtime.splitNeedsTwo');
});

test('a restart keeps the copy linked (persisted split, derived placement)', () => {
  const { s: start, b, g } = world();
  const back = restoreSnapshot(persistedSnapshot(drop(start, b)));
  assert.deepEqual(back.windowUi.splitGroups![0].linked, [b]);
  assert.equal(groupId(back, b), g);
  assert.deepEqual(splitPlacement(back.windowUi.splitGroups![0], back.tabs, back.tabGroups)!.linked, [b]);
});

test('sidebar rows: the tab keeps its row in the group and the card lists a copy', () => {
  const { s: start, b, home, d, g } = world();
  const s = drop(start, b), rows = sidebar(s);
  const card = rows.entries.find(entry => entry.kind === 'split');
  assert.deepEqual(card?.kind === 'split' ? card.members.map(tab => tab.id) : [], [home, d, b]);
  const group = rows.entries.find(entry => entry.kind === 'group' && entry.group.id === g);
  assert.ok(group?.kind === 'group');
  const row = group.kind === 'group' ? rows.groupRows(group.group, group.members).find(item => item.kind === 'tab' && item.tab.id === b) : undefined;
  assert.ok(row && row.kind === 'tab', 'the group still lists the tab');
  assert.equal(row.kind === 'tab' ? row.link?.id : undefined, split(s).id, 'and says it is also in that split');
});

test('strip entries: a chip in the split tray and the tab\'s own chip in its group, one key each', () => {
  const { s: start, b, c, home, d } = world();
  const entries = tabStripEntries(drop(start, b).tabs, drop(start, b).tabGroups, false, drop(start, b).windowUi.splitGroups);
  const keys = entries.map(entry => entry.key);
  assert.equal(new Set(keys).size, keys.length, 'keys are unique');
  const own = entries.find(entry => entry.tab.id === b && !entry.linked && !entry.header)!;
  const copy = entries.find(entry => entry.tab.id === b && entry.linked)!;
  assert.ok(own.group && !own.splitGroup, 'the group chip');
  assert.equal(own.linkedIn?.id, split(drop(start, b)).id, 'and it knows its split');
  assert.ok(copy.splitGroup && !copy.group, 'the split chip');
  assert.ok(entries.findIndex(entry => entry === copy) > entries.findIndex(entry => entry.tab.id === d && !entry.header), 'after the split\'s own panes');
  assert.ok(entries.some(entry => entry.tab.id === c && !entry.linked), 'the group lists its other tab');
  assert.ok(entries.some(entry => entry.tab.id === home && !entry.linked));
});

test('a click on either row selects the tab (and shows the split on the card row); both rows read as the current tab', () => {
  const { s: start, b } = world();
  let s = drop(start, b);
  const dispatch = (action: BrowserAction) => { s = reduceBrowser(s, action); };
  selectStripTab(s, dispatch, b, split(s));
  assert.equal(s.activeTabId, b);
  assert.equal(s.windowUi.split?.groupId, split(s).id, 'the card row shows the split focused on the tab');
  const rows = sidebar(s);
  const group = rows.entries.find(entry => entry.kind === 'group');
  assert.ok(group?.kind === 'group');
  const placements = splitPlacements(s.windowUi.splitGroups, s.tabs, s.tabGroups);
  assert.equal(placements.linkOf.get(b)?.split.id, split(s).id, 'the same tab id drives both rows');
  // The group row: a plain select of the same tab (it keeps showing the split when it is on screen).
  dispatch({ type: 'tab.select', id: b });
  assert.equal(s.activeTabId, b);
});

test('the tooltips are in all 13 catalogs, the group name placeholder kept', () => {
  for (const lang of ['ar', 'de', 'en', 'es', 'fr', 'hi', 'it', 'ja', 'ko', 'pt-BR', 'ru', 'tr', 'zh-CN']) {
    const catalog = JSON.parse(readFileSync(`src/i18n/${lang}.json`, 'utf8')) as Record<string, string>;
    assert.match(catalog['acirasidebar.linkedInGroup'] ?? '', /\{group\}/, `${lang}: In group {group}`);
    assert.ok(catalog['acirasidebar.linkedInSplit'], `${lang}: Also in split view`);
  }
});

test('the tab menu counts the same rows for a linked tab on either of its rows (a pane of a saved split, in a group)', () => {
  const { s: start, b, home } = world();
  const s = drop(start, b);
  const target = (state: BrowserSnapshot, id: string) => state.tabs.find(tab => tab.id === id)!;
  const ungrouped = reduceBrowser(s, { type: 'tab.group.assign', tabIds: [b], groupId: null });
  assert.equal(tabMenuRows(s, target(s, b)), tabMenuRows(ungrouped, target(ungrouped, b)) + 1, 'a linked tab is a pane of a split and a grouped tab: Open alone, Remove from split view and Remove from group');
  assert.ok(tabMenuRows(s, target(s, home)) >= 9 + 2 + 2, 'its own pane has Open alone and Remove from split view too');
});

test('markup: each row/chip of a linked tab says where the tab also is, its × and drag only leave the split', () => {
  const sidebar = readFileSync('src/components/sidebar/AciraSidebar.tsx', 'utf8');
  assert.match(sidebar, /data-link-role=\{copy\?'split':link\?'group':undefined\}/);
  assert.match(sidebar, /acirasidebar\.linkedInGroup/);
  assert.match(sidebar, /type:'split\.separate',tabId:tab\.id/);
  for (const file of ['src/components/BrowserTabsHorizontal.tsx', 'src/components/CompactTabs.tsx']) {
    const source = readFileSync(file, 'utf8');
    assert.match(source, /data-link-copy=\{copy\|\|undefined\}/, file);
    assert.match(source, /paneDropAction\(raw,tab\.id,entry\.splitGroup,copy\)/, `${file}: a copy dragged out only leaves the split`);
    assert.match(source, /twin/, `${file}: the second pill`);
  }
});

test('moving tabs to another workspace: a split takes its own panes and leaves its copies behind in their groups; a copy\'s tab moves alone', () => {
  const { s: start, home, d, b, g } = world();
  let base = reduceBrowser(start, { type: 'workspace.create', name: 'Work' });
  const work = base.workspaces.find(item => item.name === 'Work')!.id, first = base.workspaces[0].id;
  base = reduceBrowser(base, { type: 'workspace.select', id: first });
  const withLink = drop(base, b);
  assert.deepEqual(split(withLink).linked, [b]);
  const whole = reduceBrowser(withLink, { type: 'workspace.move-tabs', tabIds: [home], workspaceId: work });
  const there = (s: BrowserSnapshot, id: string) => s.tabs.find(tab => tab.id === id)?.workspaceId;
  assert.equal(there(whole, home), work, 'its own panes moved');
  assert.equal(there(whole, d), work);
  assert.notEqual(there(whole, b), work, 'the copy\'s tab stayed in its workspace');
  assert.equal(groupId(whole, b), g, 'and in its group');
  assert.equal((whole.windowUi.splitGroups ?? []).some(group => group.tabIds.includes(b)), false, 'no split spans two workspaces');
  const alone = reduceBrowser(withLink, { type: 'workspace.move-tabs', tabIds: [b], workspaceId: work });
  assert.equal(there(alone, b), work, 'a copy\'s tab moves alone');
  assert.notEqual(there(alone, home), work, 'its split stayed put');
  assert.equal((alone.windowUi.splitGroups ?? []).some(group => group.tabIds.includes(b)), false);
});

test('Undo of a closed split pane puts it back into its split at its slot (any pane, a copy too), re-showing a split that was on screen', () => {
  const { s: start, home, d, b, g } = world();
  const x = start.tabs.find(tab => tab.url.includes('e.test'))!.id;
  // A loose three-pane split on screen: [home, d, x]; the middle pane closes, then comes back.
  const three = reduceBrowser(drop(reduceBrowser(start, { type: 'tab.select', id: home }), x), { type: 'split.layout', layout: 'top-two-bottom-one' });
  assert.deepEqual(split(three).tabIds, [home, d, x]);
  const shownBefore = three.windowUi.split?.groupId;
  const closed = reduceBrowser(three, { type: 'tab.close', id: d });
  assert.deepEqual(split(closed).tabIds, [home, x]);
  const back = reduceBrowser(closed, { type: 'tab.restore' });
  assert.deepEqual(split(back).tabIds, [home, d, x], 'back at its slot');
  assert.equal(split(back).layout, 'top-two-bottom-one', 'with the split\'s old layout');
  assert.equal(back.windowUi.split?.groupId, shownBefore, 'on screen again if it was');
  assert.deepEqual(back.windowUi.split?.tabIds, [home, d, x]);
  // The first pane (slot 0) and the last.
  for (const [pane, at] of [[home, 0], [x, 2]] as const) {
    const undone = reduceBrowser(reduceBrowser(three, { type: 'tab.close', id: pane }), { type: 'tab.restore' });
    assert.equal(split(undone).tabIds.indexOf(pane), at, `slot ${at}`);
  }
  // The toast's Undo (a batch of one) does the same.
  const toast = reduceBrowser(three, { type: 'tab.close', id: d });
  const undo = toast.toast?.action?.command as BrowserAction;
  assert.deepEqual(split(reduceBrowser(toast, undo)).tabIds, [home, d, x]);
  // A two-pane split ended by the close is made again with the pane that is still open.
  const two = reduceBrowser(drop(start, b), { type: 'split.separate', tabId: b });
  const id2 = split(two).id;
  const ended = reduceBrowser(two, { type: 'tab.close', id: d });
  assert.equal(ended.windowUi.splitGroups?.length ?? 0, 0, 'the split ended');
  const again = reduceBrowser(ended, { type: 'tab.restore' });
  assert.deepEqual(split(again).tabIds, [home, d]);
  assert.equal(split(again).id, id2, 'the same split');
  // A linked copy: the group row's × closes the tab; Undo brings it back into its group AND into the split as a copy.
  const withCopy = drop(start, b), closedCopy = reduceBrowser(withCopy, { type: 'tab.close', id: b });
  assert.equal(split(closedCopy).linked, undefined);
  const restoredCopy = reduceBrowser(closedCopy, { type: 'tab.restore' });
  assert.deepEqual(split(restoredCopy).tabIds, [home, d, b]);
  assert.deepEqual(split(restoredCopy).linked, [b]);
  assert.equal(groupId(restoredCopy, b), g, 'still in its group');
});

test('Undo of a whole split closed at once (Close split) brings the split back with every pane in order', () => {
  const { s: start, home, d, b } = world();
  const x = start.tabs.find(tab => tab.url.includes('e.test'))!.id;
  const three = drop(reduceBrowser(start, { type: 'tab.select', id: home }), x);
  const closed = reduceBrowser(three, { type: 'split.close', groupId: split(three).id });
  assert.equal(closed.windowUi.splitGroups?.length ?? 0, 0);
  const undo = closed.toast?.action?.command as BrowserAction;
  const back = reduceBrowser(closed, undo);
  assert.deepEqual(split(back).tabIds, [home, d, x]);
  void b;
});

test('Undo of a pane of a split inside a group puts it back in the split and in the group', () => {
  let s = createInitialState();
  for (const url of ['https://b.test/', 'https://c.test/', 'https://d.test/']) s = reduceBrowser(s, { type: 'tab.new', url });
  const [, b, c, d] = s.tabs.map(tab => tab.id);
  s = reduceBrowser(s, { type: 'tab.group.create', tabId: b, name: 'G', color: 'blue' });
  const g = s.tabGroups[0].id;
  s = reduceBrowser(s, { type: 'tab.group.assign', tabIds: [c, d], groupId: g });
  s = reduceBrowser(s, { type: 'tab.select', id: b });
  s = reduceBrowser(s, { type: 'split.open', tabIds: [b, c, d] });
  const closed = reduceBrowser(s, { type: 'tab.close', id: c });
  const back = reduceBrowser(closed, { type: 'tab.restore' });
  assert.deepEqual(split(back).tabIds, [b, c, d]);
  assert.equal(groupId(back, c), g);
  assert.equal(splitPlacement(split(back), back.tabs, back.tabGroups)!.home?.id, g, 'the split still lives in the group');
});

test('Alt+arrow reorder in the strips never names a linked copy: its ids are tab ids without copies, and a copy chip ignores Alt+arrow', () => {
  const { s: start, b } = world();
  const s = drop(start, b);
  const entries = tabStripEntries(s.tabs, s.tabGroups, true, s.windowUi.splitGroups);
  const reorderIds = entries.filter(entry => !entry.header && !entry.linked).map(entry => entry.tab.id);
  assert.equal(new Set(reorderIds).size, reorderIds.length, 'every tab once');
  assert.ok(entries.some(entry => entry.linked), 'there is a copy chip');
  assert.ok(!reorderIds.some(id => id.startsWith('link:')));
  for (const file of ['src/components/BrowserTabsHorizontal.tsx', 'src/components/CompactTabs.tsx']) {
    const source = readFileSync(file, 'utf8');
    assert.match(source, /ids:entries\.filter\(entry=>!entry\.header&&!entry\.linked\)\.map\(entry=>entry\.tab\.id\)/, `${file}: reorder ids skip copies`);
    assert.match(source, /if\(event\.altKey\)\{[^}]*if\(copy\)return;const ids=L\.ids/, `${file}: a copy chip ignores Alt+arrow`);
  }
});

test('the tab menu asked for by tab id (no anchor) opens at the chip in view of its strip, the compact strip included; a right-click on either chip of a linked tab anchors at that chip', () => {
  const app = readFileSync('src/App.tsx', 'utf8');
  assert.match(app, /querySelectorAll<HTMLElement>\('\.browser-tab,\.acira-compact-tab'\)\)\.filter\(item => item\.dataset\.tabId === contextId/);
  assert.match(app, /closest<HTMLElement>\('\.tab-strip-viewport,\.acira-compact-tabs-viewport'\)/);
  assert.match(app, /node = rows\.find\(inView\) \|\| rows\[0\] \|\| node;/);
  const strip = readFileSync('src/components/BrowserTabsHorizontal.tsx', 'utf8');
  assert.match(strip, /onContext\(tab\.id,entry\.linked\|\|entry\.linkedIn\?\{x:box\.x,y:box\.y,width:box\.width,height:box\.height\}:undefined\)/);
});
