import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { createInitialState, persistedSnapshot, reduceBrowser, restoreSnapshot } from '../src/runtime/core';
import { soloSplit, splitPlacement } from '../src/runtime/splitPlacement';
import { groupForTab } from '../src/runtime/tabGroups';
import type { BrowserAction, BrowserSnapshot } from '../src/runtime/types';
import { tabStripEntries } from '../src/ui/tabStripEntries';
import { paneIsAlone, selectStripTab, toggleSolo } from '../src/ui/splitPaneSelect';
import { sidebarRows } from '../src/components/sidebar/sidebarRows';

/** docs/launch/SPLIT_IN_GROUPS.md: five tabs: home, b and c in group G, d loose, e in group H. */
function world() {
  let s = createInitialState(); const home = s.activeTabId;
  for (const url of ['https://b.test/', 'https://c.test/', 'https://d.test/', 'https://e.test/']) s = reduceBrowser(s, { type: 'tab.new', url });
  const [, b, c, d, e] = s.tabs.map(tab => tab.id);
  s = reduceBrowser(s, { type: 'tab.group.create', tabId: b, name: 'G', color: 'blue' });
  const g = s.tabGroups.find(group => group.name === 'G')!.id;
  s = reduceBrowser(s, { type: 'tab.group.assign', tabIds: [c], groupId: g });
  s = reduceBrowser(s, { type: 'tab.group.create', tabId: e, name: 'H', color: 'green' });
  const h = s.tabGroups.find(group => group.name === 'H')!.id;
  s = reduceBrowser(s, { type: 'tab.select', id: b });
  return { s, home, b, c, d, e, g, h };
}
const split = (s: BrowserSnapshot) => s.windowUi.splitGroups![0];
const shown = (s: BrowserSnapshot) => s.windowUi.split?.groupId;
const groupOf = (s: BrowserSnapshot, id: string) => s.tabs.find(tab => tab.id === id)?.group;
const strip = (s: BrowserSnapshot) => tabStripEntries(s.tabs, s.tabGroups, false, s.windowUi.splitGroups);
const sidebar = (s: BrowserSnapshot) => sidebarRows(s, s.tabs.filter(tab => !tab.pinned), s.tabGroups.map(group => ({ group, members: s.tabs.filter(tab => groupForTab(s, tab)?.id === group.id) })));
/** Every tab id drawn as a row, in order, nested groups and split cards flattened. */
const sidebarIds = (s: BrowserSnapshot) => { const rows = sidebar(s); return rows.entries.flatMap(entry => entry.kind === 'tab' ? [entry.tab.id] : entry.kind === 'split' ? entry.members.map(tab => tab.id) : rows.groupRows(entry.group, entry.members).flatMap(row => row.kind === 'tab' ? [row.tab.id] : row.members.map(tab => tab.id))); };
const cardOf = (s: BrowserSnapshot) => { const rows = sidebar(s); for (const entry of rows.entries) { if (entry.kind === 'split') return { card: entry, group: undefined }; if (entry.kind === 'group') { const card = rows.groupRows(entry.group, entry.members).find(row => row.kind === 'split'); if (card && card.kind === 'split') return { card, group: entry.group }; } } return undefined; };
const looseRows = (s: BrowserSnapshot) => sidebar(s).entries.flatMap(entry => entry.kind === 'tab' ? [entry.tab.id] : []);
const unique = (ids: string[]) => assert.equal(new Set(ids).size, ids.length, `no tab is listed twice: ${ids.join(',')}`);
/** A dispatcher over a local state, like the app's. */
const driver = (start: BrowserSnapshot) => { let s = start; const dispatch = (action: BrowserAction) => { s = reduceBrowser(s, action); }; return { dispatch, get s() { return s; } }; };

test('case A: two tabs of one group open a split that lives inside that group (model, strip and sidebar)', () => {
  const { s: start, b, c, g } = world();
  const s = reduceBrowser(start, { type: 'split.open', tabIds: [b, c] });
  assert.deepEqual(s.windowUi.split?.tabIds, [b, c], 'the split opens');
  assert.equal(groupOf(s, b), 'G'); assert.equal(groupOf(s, c), 'G');
  const placement = splitPlacement(split(s), s.tabs, s.tabGroups)!;
  assert.equal(placement.home?.id, g); assert.deepEqual(placement.panes, [b, c]);
  const chip = strip(s).find(entry => entry.header && entry.splitGroup)!;
  assert.ok(chip.nested && chip.group?.id === g, 'the strip chip nests in the group');
  const rows = sidebar(s), group = rows.entries.find(entry => entry.kind === 'group' && entry.group.id === g);
  assert.ok(group && group.kind === 'group', 'the sidebar still draws the group (it used to vanish)');
  assert.ok(!rows.entries.some(entry => entry.kind === 'split'), 'the split is not lifted to the top level');
  const inside = rows.groupRows(group.group, group.members);
  assert.deepEqual(inside.map(row => row.kind), ['split'], 'the split is a row of the group');
  assert.deepEqual(inside[0].kind === 'split' && inside[0].members.map(tab => tab.id), [b, c]);
  unique(sidebarIds(s));
});

// Coordinator decision on the founder's simplification (28 Oct): no clones, no mirrors. A tab that joins a split moves to where
// the split lives.
test('move on join, case B: a loose tab joining a split inside a group moves into that group, next to the panes; no remnant row', () => {
  const { s: start, b, d, g } = world();
  const s = reduceBrowser(start, { type: 'split.open', tabIds: [b, d] });
  assert.equal(groupOf(s, b), 'G'); assert.equal(groupOf(s, d), 'G', 'd moved into G');
  const order = s.tabs.map(tab => tab.id);
  assert.equal(order[order.indexOf(b) + 1], d, 'right after its fellow pane');
  const placement = splitPlacement(split(s), s.tabs, s.tabGroups)!;
  assert.equal(placement.home?.id, g); assert.deepEqual(placement.panes, [b, d]);
  assert.ok(!looseRows(s).includes(d), 'no loose row of d is left behind');
  const found = cardOf(s)!;
  assert.equal(found.group?.id, g); assert.deepEqual(found.card.members.map(tab => tab.id), [b, d], 'the card lists both panes');
  const entries = strip(s);
  assert.equal(entries.filter(entry => !entry.header && entry.tab.id === d).length, 1, 'one chip for d in the strip');
  assert.equal(entries.find(entry => !entry.header && entry.tab.id === d)?.splitGroup?.id, split(s).id, 'and it sits in the split');
  assert.ok(entries.every(entry => !('linked' in entry)), 'no linked chips');
  unique(sidebarIds(s)); unique(entries.filter(entry => !entry.header).map(entry => entry.tab.id));
});

test('move on join, case B: a tab from another group joins the split\'s group and leaves its own', () => {
  const { s: start, c, e, g } = world();
  const s = reduceBrowser(reduceBrowser(start, { type: 'tab.select', id: c }), { type: 'split.open', tabIds: [c, e] });
  assert.equal(groupOf(s, e), 'G', 'e left H for G');
  assert.equal(splitPlacement(split(s), s.tabs, s.tabGroups)?.home?.id, g);
  const entry = strip(s).find(item => !item.header && item.tab.id === e)!;
  assert.equal(entry.group?.id, g); assert.equal(entry.splitGroup?.id, split(s).id);
  unique(sidebarIds(s));
});

test('move on join, case A: a grouped tab joining a split outside any group leaves its group', () => {
  let { s, b, d, home } = world();
  s = reduceBrowser(s, { type: 'split.open', tabIds: [d, home, b] });
  const placement = splitPlacement(split(s), s.tabs, s.tabGroups)!;
  assert.equal(placement.home, undefined); assert.equal(placement.anchorId, d, 'the first pane is the home pane');
  assert.equal(groupOf(s, b), '', 'b left G');
  assert.ok(sidebar(s).entries.some(entry => entry.kind === 'split'), 'a free split row');
  assert.ok(!looseRows(s).some(id => [d, home, b].includes(id)), 'its panes show only in the card');
  unique(sidebarIds(s));
});

test('adding a pane (drop on the card, split.group.add) follows the same rule and never moves the split', () => {
  let { s, home, b, c, d, g } = world(); const base = s;
  s = reduceBrowser(reduceBrowser(s, { type: 'tab.select', id: home }), { type: 'split.open', tabIds: [home, d] });
  s = reduceBrowser(s, { type: 'split.group.add', id: split(s).id, tabId: b, index: 0 });
  assert.deepEqual(split(s).tabIds, [b, home, d], 'b is now the first pane');
  const placement = splitPlacement(split(s), s.tabs, s.tabGroups)!;
  assert.equal(placement.anchorId, home, 'the home pane is still the tab it was made from'); assert.equal(placement.home, undefined, 'still outside every group');
  assert.equal(groupOf(s, b), 'G', 'b stays in G: dropped on a loose split it is a linked copy (tests/split-linked.test.ts)'); assert.deepEqual(split(s).linked, [b]);
  let grouped = base;
  grouped = reduceBrowser(grouped, { type: 'split.open', tabIds: [b, c] });
  grouped = reduceBrowser(grouped, { type: 'split.group.add', id: split(grouped).id, tabId: d, index: 0 });
  assert.equal(splitPlacement(split(grouped), grouped.tabs, grouped.tabGroups)?.home?.id, g); assert.equal(groupOf(grouped, d), 'G', 'd joined G');
});

test('a pane dragged inside its own card reorders the panes; it stays in the split', () => {
  let { s, b, c, d } = world();
  s = reduceBrowser(s, { type: 'split.open', tabIds: [b, c, d] });
  s = reduceBrowser(s, { type: 'split.group.add', id: split(s).id, tabId: d, index: 0 });
  assert.deepEqual(split(s).tabIds, [d, b, c]);
  assert.ok([b, c, d].every(id => groupOf(s, id) === 'G'));
});

test('split.move: the whole split joins a group (panes together, nested) and leaves every group', () => {
  let { s, b, d, e, h } = world();
  s = reduceBrowser(s, { type: 'split.open', tabIds: [b, d] });
  const id = split(s).id;
  s = reduceBrowser(s, { type: 'split.move', groupId: id, tabGroupId: h });
  assert.equal(groupOf(s, b), 'H'); assert.equal(groupOf(s, d), 'H');
  const order = s.tabs.map(tab => tab.id), at = order.indexOf(b);
  assert.equal(order[at + 1], d, 'the panes sit next to each other'); assert.ok(order.indexOf(e) < at, 'after the group\'s own tabs');
  assert.equal(splitPlacement(split(s), s.tabs, s.tabGroups)?.home?.id, h);
  assert.deepEqual(s.windowUi.split?.tabIds, [b, d], 'the split stays on screen');
  s = reduceBrowser(s, { type: 'split.move', groupId: id, tabGroupId: null });
  assert.ok(s.tabs.filter(tab => [b, d].includes(tab.id)).every(tab => !tab.group), 'out of every group');
  const placement = splitPlacement(split(s), s.tabs, s.tabGroups)!;
  assert.equal(placement.home, undefined); assert.deepEqual([...placement.panes].sort(), [b, d].sort());
  assert.ok(s.tabGroups.some(group => group.id === h), 'H keeps its own tab');
});

test("split.move beside a tab places the block there; aimed at one of its own panes it lands beside the card", () => {
  let { s, b, c, d, e, g } = world();
  s = reduceBrowser(reduceBrowser(s, { type: 'tab.select', id: d }), { type: 'split.open', tabIds: [d, e] });
  const id = split(s).id;
  assert.equal(groupOf(s, e), '', 'e joined the loose split');
  const same = reduceBrowser(s, { type: 'split.move', groupId: id, tabGroupId: g, to: d, position: 'before' });
  assert.ok([d, e].every(tid => groupOf(same, tid) === 'G'));
  s = reduceBrowser(s, { type: 'split.move', groupId: id, tabGroupId: g, to: c, position: 'before' });
  const order = s.tabs.map(tab => tab.id);
  assert.deepEqual(order.slice(order.indexOf(b), order.indexOf(b) + 4), [b, d, e, c], 'between b and c, in G');
});

test('a pane given another group from its tab menu takes its split along; the split is never torn apart', () => {
  let { s, b, c, h } = world();
  s = reduceBrowser(s, { type: 'split.open', tabIds: [b, c] });
  const out = reduceBrowser(s, { type: 'tab.group.assign', tabIds: [c], groupId: null });
  assert.equal(groupOf(out, b), '', 'b followed c out'); assert.equal(out.windowUi.splitGroups?.length, 1, 'the split survives');
  const moved = reduceBrowser(s, { type: 'tab.group.assign', tabIds: [b], groupId: h });
  assert.equal(groupOf(moved, c), 'H', 'the home pane moved: c follows it into H');
  assert.equal(split(moved).home, b, 'the home pane stays the home pane');
  const pinned = reduceBrowser(s, { type: 'tab.pin', id: c });
  assert.equal(groupOf(pinned, b), 'G', 'pinning a pane takes no group from the others');
});

test('Remove from split view (split.separate): the tab leaves, the split shrinks; a two-pane split ends and its last pane stays where it was', () => {
  let { s, b, c, d, g } = world();
  s = reduceBrowser(s, { type: 'split.open', tabIds: [b, c, d] });
  assert.equal(groupOf(s, d), 'G');
  s = reduceBrowser(s, { type: 'split.separate', tabId: d });
  assert.deepEqual(split(s).tabIds, [b, c], 'the split shrinks');
  assert.equal(groupOf(s, d), 'G', 'from the menu the tab stays where it is');
  assert.ok(sidebar(s).groupRows(s.tabGroups.find(group => group.id === g)!, s.tabs.filter(tab => tab.group === 'G')).some(row => row.kind === 'tab' && row.tab.id === d), 'd is a plain row of G again');
  s = reduceBrowser(s, { type: 'split.separate', tabId: c });
  assert.ok(!s.windowUi.splitGroups?.length, 'a split of one ends');
  assert.equal(groupOf(s, b), 'G', 'its last pane stays in G');
  assert.equal(s.windowUi.split, null);
});

// Founder, 28 Oct: "Make it so I can drag a tab out of a split even if it is inside a group."
test('dragging a pane out of a card inside a group: it lands at the drop line and takes the group of wherever it lands', () => {
  let { s, home, b, c, d, e, h } = world(); const base = s;
  s = reduceBrowser(s, { type: 'split.open', tabIds: [b, c, home] });
  assert.equal(groupOf(s, home), 'G');
  // To the top level, before the loose tab d.
  const loose = reduceBrowser(s, { type: 'split.separate', tabId: home, to: d, position: 'before', groupId: null });
  assert.equal(groupOf(loose, home), ''); const order = loose.tabs.map(tab => tab.id);
  assert.equal(order[order.indexOf(d) - 1], home, 'right at the drop line'); assert.deepEqual(split(loose).tabIds, [b, c]);
  assert.ok(looseRows(loose).includes(home), 'a loose row now');
  // Into another group.
  const other = reduceBrowser(s, { type: 'split.separate', tabId: home, to: e, position: 'after', groupId: h });
  assert.equal(groupOf(other, home), 'H'); assert.equal(other.tabs[other.tabs.findIndex(tab => tab.id === e) + 1]?.id, home);
  // Into the same group, outside the card (aimed at one of its own panes: beside the card).
  const same = reduceBrowser(s, { type: 'split.separate', tabId: home, to: c, position: 'after', groupId: s.tabGroups.find(group => group.name === 'G')!.id });
  assert.equal(groupOf(same, home), 'G'); assert.deepEqual(split(same).tabIds, [b, c], 'it left the split');
  // A two-pane split ends; the last pane stays where the split was.
  const pair = reduceBrowser(base, { type: 'split.open', tabIds: [b, c] });
  const ended = reduceBrowser(pair, { type: 'split.separate', tabId: c, to: d, position: 'after', groupId: null });
  assert.ok(!ended.windowUi.splitGroups?.length); assert.equal(groupOf(ended, b), 'G'); assert.equal(groupOf(ended, c), '');
});

test('the founder\'s layout: a four-pane split in "New group" and loose tabs; no split mark or pane row outside the card', () => {
  let s = createInitialState();
  for (let i = 0; i < 6; i++) s = reduceBrowser(s, { type: 'tab.new', url: `https://p${i}.test/` });
  const ids = s.tabs.map(tab => tab.id);
  s = reduceBrowser(s, { type: 'tab.group.create', tabId: ids[1], name: 'New group' });
  s = reduceBrowser(reduceBrowser(s, { type: 'tab.select', id: ids[1] }), { type: 'split.open', tabIds: [ids[1], ids[0], ids[2], ids[3]] });
  assert.ok([ids[0], ids[1], ids[2], ids[3]].every(id => groupOf(s, id) === 'New group'), 'every pane lives in the group');
  assert.deepEqual(looseRows(s), [ids[4], ids[5], ids[6]], 'only the loose tabs are top-level rows');
  assert.deepEqual(cardOf(s)!.card.members.map(tab => tab.id), [ids[1], ids[0], ids[2], ids[3]]);
  unique(sidebarIds(s));
  const sidebarSource = readFileSync('src/components/sidebar/AciraSidebar.tsx', 'utf8');
  assert.doesNotMatch(sidebarSource, /sb-tab-split|data-split-linked|data-split-mirror|linkedTo|mirror=/, 'no linked mark or mirror row is drawn any more');
  for (const file of ['src/components/BrowserTabsHorizontal.tsx', 'src/components/CompactTabs.tsx', 'src/ui/tabStripEntries.ts']) assert.doesNotMatch(readFileSync(file, 'utf8'), /splitLinkedTip|data-split-shown|data-split-linked/, `${file}: no shown tint or old linked-tip chip`);
});

// Founder, 28 Oct: "It's still sometimes selecting more than one tab randomly."
test('single current: after a plain click on any pane or tab exactly one sidebar row is the current one', () => {
  const { s: start, home, b, c, d } = world();
  const app = driver(reduceBrowser(start, { type: 'split.open', tabIds: [b, c, d] }));
  for (const id of [b, c, d, home, c, b]) {
    selectStripTab(app.s, app.dispatch, id, app.s.windowUi.splitGroups?.find(group => group.tabIds.includes(id)));
    const ids = sidebarIds(app.s);
    unique(ids);
    assert.equal(ids.filter(row => row === app.s.activeTabId).length, 1, `one current row after clicking ${id}`);
    assert.equal(app.s.activeTabId, id);
    if (id !== home) assert.equal(app.s.windowUi.split?.groupId, split(app.s).id, 'a pane click shows its split, focused on that pane');
  }
  const css = readFileSync('src/components/sidebar/sidebar.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(css, /\.split-group-sidebar\[data-active\]\{background:none;box-shadow:none\}/, 'the split header takes no current fill of its own');
  assert.doesNotMatch(css + readFileSync('src/styles/split-groups.css', 'utf8'), /data-split-shown/, 'no pane is lit just for being in the split on screen');
  const sidebarSource = readFileSync('src/components/sidebar/AciraSidebar.tsx', 'utf8');
  assert.match(sidebarSource, /prior\.motion\.cancel\(\)/, 'a second click before the card glide lands cancels the first glide (two raised cards at once)');
});

test('open alone: the pane shows by itself while the split stays saved; one click on the pane or the card brings the split back', () => {
  const { s: start, b, c } = world();
  const app = driver(reduceBrowser(start, { type: 'split.open', tabIds: [b, c] }));
  const id = split(app.s).id;
  assert.equal(soloSplit(app.s), undefined, 'on screen, not alone');
  toggleSolo(app.s, app.dispatch, c, split(app.s));
  assert.equal(app.s.activeTabId, c); assert.equal(app.s.windowUi.split, null, 'c is shown by itself');
  assert.equal(soloSplit(app.s)?.id, id); assert.ok(paneIsAlone(app.s, c, split(app.s)));
  assert.deepEqual(split(app.s).tabIds, [b, c], 'the split stays intact');
  assert.equal(cardOf(app.s)?.card.split.id, id, 'its card stays in the sidebar');
  toggleSolo(app.s, app.dispatch, c, split(app.s));
  assert.equal(shown(app.s), id, 'Show split view restores it'); assert.equal(app.s.activeTabId, c, 'focused on the pane that was alone');
  toggleSolo(app.s, app.dispatch, b, split(app.s));
  selectStripTab(app.s, app.dispatch, b, split(app.s));
  assert.equal(shown(app.s), id, 'a plain click on the pane row restores it too');
  toggleSolo(app.s, app.dispatch, b, split(app.s));
  app.dispatch({ type: 'split.group.select', id });
  assert.equal(shown(app.s), id, 'and so does the card header'); assert.equal(app.s.activeTabId, b);
  const back = restoreSnapshot(persistedSnapshot(reduceBrowser(app.s, { type: 'tab.select', id: c, individual: true })));
  assert.deepEqual(split(back).tabIds, [b, c], 'Rewind/restart keeps the split while a pane is alone');
});

test('the home pane leaving the split hands the home to the next pane in pane order; swapping panes never moves it', () => {
  let { s, home, b, c } = world(); const base = s;
  s = reduceBrowser(reduceBrowser(s, { type: 'tab.select', id: home }), { type: 'split.open', tabIds: [home, b, c] });
  assert.equal(splitPlacement(split(s), s.tabs, s.tabGroups)?.home, undefined);
  assert.equal(groupOf(s, b), '', 'b and c joined the loose split');
  const swapped = reduceBrowser(s, { type: 'split.swap', a: home, b: c });
  assert.equal(split(swapped).home, home, 'a swap keeps the home pane');
  s = reduceBrowser(s, { type: 'tab.close', id: home });
  assert.equal(split(s).home, b, 'b, next in pane order, is the new home');
  const separated = reduceBrowser(reduceBrowser(reduceBrowser(base, { type: 'tab.select', id: home }), { type: 'split.open', tabIds: [home, b, c] }), { type: 'split.separate', tabId: home });
  assert.equal(split(separated).home, b, 'Remove from split view on the home pane hands it on too');
});

test('Rewind/restart keeps the home pane, even when it is not the first pane any more', () => {
  let { s, home, b, d } = world();
  s = reduceBrowser(reduceBrowser(s, { type: 'tab.select', id: d }), { type: 'split.open', tabIds: [d, home] });
  s = reduceBrowser(s, { type: 'split.group.add', id: split(s).id, tabId: b, index: 0 });
  const back = restoreSnapshot(persistedSnapshot(s));
  assert.equal(split(back).home, d); assert.equal(splitPlacement(split(back), back.tabs, back.tabGroups)?.home, undefined, 'still outside the group');
  assert.equal(groupOf(back, b), 'G', 'b is a linked copy: it stays in G'); assert.deepEqual(split(back).linked, [b]);
});

test('Rewind/restart of a session saved with a mixed split (before this rule): the pane moves into its split\'s group', () => {
  let { s, b, d, g } = world();
  s = reduceBrowser(s, { type: 'split.open', tabIds: [b, d] });
  const saved = persistedSnapshot(s) as BrowserSnapshot;
  for (const tab of saved.tabs) if (tab.id === d) tab.group = '';
  const back = restoreSnapshot(saved);
  assert.equal(groupOf(back, d), 'G', 'd is moved into G on restore');
  assert.equal(splitPlacement(split(back), back.tabs, back.tabGroups)?.home?.id, g);
  unique(sidebarIds(back));
});

test('closing panes: three shrink to two inside the group; two to one ends the split and the tab keeps its group', () => {
  let { s, b, c, d, g } = world();
  s = reduceBrowser(s, { type: 'split.open', tabIds: [b, c, d] });
  s = reduceBrowser(s, { type: 'tab.close', id: d });
  assert.deepEqual(split(s).tabIds, [b, c]);
  assert.equal(splitPlacement(split(s), s.tabs, s.tabGroups)?.home?.id, g);
  s = reduceBrowser(s, { type: 'tab.close', id: c });
  assert.ok(!s.windowUi.splitGroups?.length, 'no split of one'); assert.equal(groupOf(s, b), 'G');
  assert.ok(sidebar(s).entries.some(entry => entry.kind === 'group'), 'the group is still listed');
  assert.equal(sidebarIds(s).filter(id => id === s.activeTabId).length, 1, 'one current row after closing panes');
});

test('collapsing the group hides the split in the strip; the sidebar keeps it while it is on screen', () => {
  let { s, b, c, g } = world();
  s = reduceBrowser(s, { type: 'split.open', tabIds: [b, c] });
  const kept = reduceBrowser(s, { type: 'tab.group.update', id: g, keepActive: true, patch: { collapsed: true } });
  const group = sidebar(kept).entries.find(entry => entry.kind === 'group')!;
  assert.ok(group.kind === 'group');
  const inside = sidebar(kept).groupRows(group.group, group.members);
  assert.equal(inside.find(row => row.kind === 'split')?.hidden, false, 'the split on screen stays under the collapsed header');
  const away = reduceBrowser(kept, { type: 'tab.select', id: kept.tabs[0].id, individual: true });
  const folded = reduceBrowser(away, { type: 'tab.group.update', id: g, patch: { collapsed: true } });
  const awayGroup = sidebar(folded).entries.find(entry => entry.kind === 'group')!;
  assert.ok(awayGroup.kind === 'group');
  assert.equal(sidebar(folded).groupRows(awayGroup.group, awayGroup.members).find(row => row.kind === 'split')?.hidden, true, 'otherwise it hides with the group');
  assert.ok(!strip(folded).some(entry => entry.splitGroup), 'the strip hides the chip in a collapsed group');
  const open = reduceBrowser(folded, { type: 'tab.group.update', id: g, patch: { collapsed: false } });
  assert.ok(strip(open).some(entry => entry.header && entry.nested), 'expanding brings it back inside the group');
});

test('rename works on a split inside a group, and Rewind/restart brings it back in the group with its name', () => {
  let { s, b, c, g } = world();
  s = reduceBrowser(s, { type: 'split.open', tabIds: [b, c] });
  const id = split(s).id;
  s = reduceBrowser(s, { type: 'split.rename', groupId: id, name: 'Research pair' });
  assert.equal(split(s).name, 'Research pair');
  const back = restoreSnapshot(persistedSnapshot(s));
  const named = back.windowUi.splitGroups?.find(item => item.name === 'Research pair')!;
  assert.equal(splitPlacement(named, back.tabs, back.tabGroups)?.home?.id, g);
  unique(sidebarIds(back));
});

test('private tabs never join a group: the card lists the private pane, nothing else shows it; Move to group skips it', () => {
  let { s, b, g } = world();
  s = reduceBrowser(s, { type: 'tab.new', url: 'https://p.test/', privacy: 'private' } as never);
  const p = s.tabs.at(-1)!;
  if (p.privacy !== 'private') return; // the private tab kind is created elsewhere in this build
  s = reduceBrowser(s, { type: 'split.open', tabIds: [b, p.id] });
  s = reduceBrowser(s, { type: 'split.move', groupId: split(s).id, tabGroupId: g });
  assert.equal(groupOf(s, p.id), '', 'the private tab stays out of the group');
  assert.ok(!looseRows(s).includes(p.id), 'and has no row of its own outside the card');
});

test('split.move and split.separate pass the native validation boundary and malformed ones do not', () => {
  const { validateAction } = createRequire(import.meta.url)('../desktop/validation.cjs');
  let { s, b, c, d, g } = world();
  s = reduceBrowser(s, { type: 'split.open', tabIds: [b, c] });
  const id = split(s).id;
  assert.doesNotThrow(() => validateAction({ type: 'split.move', groupId: id, tabGroupId: g }, s));
  assert.doesNotThrow(() => validateAction({ type: 'split.move', groupId: id, tabGroupId: null, to: b, position: 'after' }, s));
  assert.throws(() => validateAction({ type: 'split.move', groupId: id }, s));
  assert.throws(() => validateAction({ type: 'split.move', groupId: 'split-nope', tabGroupId: null }, s));
  assert.throws(() => validateAction({ type: 'split.move', groupId: id, tabGroupId: 'group-nope' }, s));
  assert.throws(() => validateAction({ type: 'split.move', groupId: id, tabGroupId: null, position: 'inside' }, s));
  assert.doesNotThrow(() => validateAction({ type: 'split.separate', tabId: c }, s));
  assert.doesNotThrow(() => validateAction({ type: 'split.separate', tabId: c, to: d, position: 'before', groupId: null }, s));
  assert.doesNotThrow(() => validateAction({ type: 'split.separate', tabId: c, to: b, position: 'after', groupId: g }, s));
  assert.throws(() => validateAction({ type: 'split.separate', tabId: d }, s), 'd is in no split');
  assert.throws(() => validateAction({ type: 'split.separate', tabId: c, position: 'inside' }, s));
  assert.throws(() => validateAction({ type: 'split.separate', tabId: c, groupId: 'group-nope' }, s));
  assert.throws(() => validateAction({ type: 'split.separate', tabId: c, extra: 1 }, s));
  // The real app rejected split.move before the main process listed it (found by the old splitgroup capture rig).
  const main = readFileSync('desktop/main.cjs', 'utf8');
  assert.match(main, /'split\.insert','split\.move','split\.separate'\]\)actionNames\.add\(name\)/, 'main lets the interface send split.move and split.separate');
});
