import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createInitialState, reduceBrowser } from '../src/runtime/core';
import { groupForTab } from '../src/runtime/tabGroups';
import type { BrowserSnapshot } from '../src/runtime/types';
import { foldersArea, sidebarRows, type SidebarEntry } from '../src/components/sidebar/sidebarRows';
import { readRailPrefs, setRailPrefs, SIDEBAR_FOLDERS } from '../src/ui/railPrefs';

// Item 14 (a GitHub user's suggestion, founder's OK 7 Nov): tab groups can sit in an area of their own, above or below the loose tabs,
// chosen in Settings > Sidebar > Tab groups. "With your tabs" (today) is the default, so nothing moves for anyone who does not choose.
const read = (path: string) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const sidebar = read('src/components/sidebar/AciraSidebar.tsx'), panel = read('src/features/settings/panels/sidebar.tsx'), entries = read('src/features/settings/entries/sidebar.ts');

/** home, d and f loose; group G holds b and c; group H holds e. Tab order: home, b, c, d, e, f. */
function world() {
  let s = createInitialState(); const home = s.activeTabId;
  for (const url of ['https://b.test/', 'https://c.test/', 'https://d.test/', 'https://e.test/', 'https://f.test/']) s = reduceBrowser(s, { type: 'tab.new', url });
  const [, b, c, d, e, f] = s.tabs.map(tab => tab.id);
  s = reduceBrowser(s, { type: 'tab.group.create', tabId: b, name: 'G', color: 'blue' });
  const g = s.tabGroups.find(group => group.name === 'G')!.id;
  s = reduceBrowser(s, { type: 'tab.group.assign', tabIds: [c], groupId: g });
  s = reduceBrowser(s, { type: 'tab.group.create', tabId: e, name: 'H', color: 'green' });
  const h = s.tabGroups.find(group => group.name === 'H')!.id;
  return { s, home, b, c, d, e, f, g, h };
}
const rows = (s: BrowserSnapshot, folders?: 'mixed' | 'above' | 'below') => sidebarRows(s, s.tabs.filter(tab => !tab.pinned), s.tabGroups.map(group => ({ group, members: s.tabs.filter(tab => groupForTab(s, tab)?.id === group.id) })), folders);
const shape = (list: readonly SidebarEntry[]) => list.map(entry => entry.kind === 'tab' ? entry.tab.id : entry.kind === 'group' ? 'group:' + entry.group.name : 'split');

test('With your tabs (the default) leaves the list as the tabs were opened', () => {
  const { s, home, d, f } = world();
  assert.deepEqual(shape(rows(s).entries), [home, 'group:G', d, 'group:H', f]);
  assert.deepEqual(shape(rows(s, 'mixed').entries), shape(rows(s).entries), 'no argument is the same as mixed');
  assert.equal(rows(s).folderCount, 0, 'no separator is drawn for it');
});

test('Above puts the groups first, Below puts them last; each side keeps its own order', () => {
  const { s, home, d, f } = world();
  const above = rows(s, 'above'), below = rows(s, 'below');
  assert.deepEqual(shape(above.entries), ['group:G', 'group:H', home, d, f]);
  assert.deepEqual(shape(below.entries), [home, d, f, 'group:G', 'group:H']);
  assert.deepEqual([above.folderCount, above.looseCount, below.folderCount, below.looseCount], [2, 3, 2, 3]);
});

test('the keyboard walks the rows in the order they are on screen', () => {
  const { s, home, b, c, d, e, f } = world();
  assert.deepEqual(rows(s, 'above').visibleTabs([]).map(tab => tab.id), [b, c, e, home, d, f]);
  assert.deepEqual(rows(s, 'below').visibleTabs([]).map(tab => tab.id), [home, d, f, b, c, e]);
  assert.deepEqual(rows(s).visibleTabs([]).map(tab => tab.id), [home, b, c, d, e, f]);
});

test('a free split stays with the loose tabs, a group with its split inside stays a group', () => {
  const tab = (id: string) => ({ kind: 'tab', tab: { id } }) as unknown as SidebarEntry;
  const split = { kind: 'split', split: { id: 'sp' }, members: [] } as unknown as SidebarEntry;
  const group = (name: string) => ({ kind: 'group', group: { name }, members: [] }) as unknown as SidebarEntry;
  const list = [tab('a'), group('G'), split, group('H'), tab('z')];
  assert.deepEqual(shape(foldersArea(list, 'above').entries), ['group:G', 'group:H', 'a', 'split', 'z']);
  assert.deepEqual(shape(foldersArea(list, 'below').entries), ['a', 'split', 'z', 'group:G', 'group:H']);
  assert.equal(foldersArea([], 'above').folderCount, 0);
  assert.equal(foldersArea([group('G')], 'below').looseCount, 0, 'nothing loose: no separator');
});

test('no group, or only groups, means no line between areas', () => {
  const { s } = world();
  const only = { ...s, tabs: s.tabs.filter(tab => tab.group) };
  assert.equal(rows(only, 'above').looseCount, 0);
  assert.match(sidebar, /if\(folders!=='mixed'&&folderCount>0&&looseCount>0\)listed\.splice\(folders==='above'\?folderCount:looseCount,0,<div key="sep-folders" className="sb-sep" role="separator" data-flip="sep:folders"\/>\)/);
});

test('the setting is remembered for each profile, and an unknown value falls back to With your tabs', () => {
  assert.deepEqual([...SIDEBAR_FOLDERS], ['mixed', 'above', 'below']);
  const saved = new Map<string, string>(); const events: string[] = [];
  Object.assign(globalThis, { window: { dispatchEvent: (event: Event) => { events.push(event.type); return true; }, addEventListener() {} }, localStorage: { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => { saved.set(key, value); } } });
  assert.equal(readRailPrefs('p1').folders, 'mixed', 'nothing stored: today\'s behaviour');
  setRailPrefs({ folders: 'below' }, 'p1');
  assert.equal(readRailPrefs('p1').folders, 'below');
  assert.equal(readRailPrefs('p2').folders, 'mixed', 'another profile keeps its own');
  setRailPrefs({ folders: 'above' }, 'p3', true);
  assert.equal(readRailPrefs('p3', true).folders, 'above', 'a private window too (kept in memory only)');
  assert.ok(events.includes('acira-rail-prefs'), 'the sidebar hears the change');
  saved.set('acira-rail-prefs:p9', JSON.stringify({ folders: 'sideways', tabs: true }));
  assert.equal(readRailPrefs('p9').folders, 'mixed');
  saved.set('acira-rail-prefs:p8', JSON.stringify({ folders: 'above' }));
  assert.equal(readRailPrefs('p8').folders, 'above');
});

test('Settings > Sidebar has a "Tab groups" row with three choices, searchable, reset by "Reset sidebar layout"', () => {
  assert.match(panel, /<SettingRow id="sidebar-folders" title=\{t\("sidebar\.tabGroups"\)\} detail=\{t\("sidebar\.tabGroupsDetail"\)\}>/);
  assert.match(panel, /value=\{rail\.folders \?\? 'mixed'\}/);
  assert.match(panel, /\{ value: 'mixed', label: t\("sidebar\.groupsWithTabs"\) \}, \{ value: 'above', label: t\("sidebar\.groupsAbove"\) \}, \{ value: 'below', label: t\("sidebar\.groupsBelow"\) \}/);
  assert.ok(panel.indexOf('id="sidebar-folders"') > panel.indexOf('id="sidebar-new-tabs-top"') && panel.indexOf('id="sidebar-folders"') < panel.indexOf('id="sidebar-reset"'), 'between New tabs at the top and the reset row, with the other tab-list rows (the Width row is the Sidebar size row now, under Show sidebar)');
  // The reset and its check share one list (settings/changed.ts SIDEBAR_RESET, sidebarLayoutChanged): the panel writes it, the list puts Tab groups back to With your tabs.
  const changed = readFileSync(new URL('../src/features/settings/changed.ts', import.meta.url), 'utf8');
  assert.match(panel, /setRailPrefs\(to\.rail, tab\.browserProfileId, privateMode\)/, 'Reset sidebar layout writes the shared list');
  assert.match(changed, /folders: 'mixed' as SidebarFolders/, 'Reset sidebar layout goes back to today\'s');
  assert.match(changed, /\(now\.folders \?\? d\.rail\.folders\) !== d\.rail\.folders/, 'and is enabled when it is not');
  assert.match(entries, /\{ id: 'sidebar-folders', title: t\("sidebar\.tabGroups"\), group: 'Sidebar', description: t\("sidebar\.tabGroupsSearch"\)/);
  assert.match(sidebar, /folders=\{prefs\.folders\?\?'mixed'\}/, 'the tab list reads it from the profile\'s rail prefs');
});

test('the six strings exist in English and in every language', () => {
  const ids = ['sidebar.tabGroups', 'sidebar.tabGroupsDetail', 'sidebar.tabGroupsSearch', 'sidebar.groupsWithTabs', 'sidebar.groupsAbove', 'sidebar.groupsBelow'];
  const english = JSON.parse(read('src/i18n/en.json')) as Record<string, string>;
  for (const id of ids) assert.ok(english[id], id);
  for (const locale of ['es', 'fr', 'de', 'pt-BR', 'it', 'ja', 'zh-CN', 'ar', 'tr', 'ru', 'ko', 'hi']) {
    const catalog = JSON.parse(read(`src/i18n/${locale}.json`)) as Record<string, string>;
    for (const id of ids) { assert.ok(catalog[id], `${locale} ${id}`); assert.notEqual(catalog[id], english[id], `${locale} ${id} is translated`); }
  }
});
