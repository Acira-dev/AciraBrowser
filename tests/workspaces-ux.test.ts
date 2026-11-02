// R4-48 Workspaces UX (docs/launch/proposals/R4-48_WORKSPACES_UX.md §5.1): create says where the tabs went, "This tab"
// moves one tab (and its split), Main wears the profile's colour, counts feed the switcher and the delete confirmation,
// the icon follows the name, the HUD text, and "workspace" no longer names the sidebar.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createInitialState, makeTab, reduceBrowser } from '../src/runtime/core';
import { navigationTitle } from '../src/runtime/navigation';
import { scopeToWorkspace, windowWorkspaces, workspaceColorOf, workspaceCounts, workspaceIdOf, workspaceKeyLabel } from '../src/runtime/workspaces';
import { frameTintFor } from '../src/ui/theme';
import { suggestedGlyph } from '../src/features/workspaces/workspaceIcons';
import { searchSettingsDetailed } from '../src/features/settings/search';
import type { SettingsContext, SettingsEntry } from '../src/features/settings/model';
import type { BrowserAction, BrowserSnapshot } from '../src/runtime/types';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const run = (state: BrowserSnapshot, ...actions: BrowserAction[]) => actions.reduce(reduceBrowser, state);
function three(): BrowserSnapshot {
  const state = createInitialState(), profile = state.activeBrowserProfileId;
  return run({ ...state, tabs: ['a', 'b', 'c'].map(id => makeTab(id, '', `https://${id}.test/`, profile)), activeTabId: 'b' }, { type: 'ui.update', patch: {} });
}
const named = (state: BrowserSnapshot, name: string) => state.workspaces.find(workspace => workspace.name === name)!;

test('P0-1: create says the new and the previous workspace, the previous one\'s key, and Go back returns there', () => {
  const before = three(), main = windowWorkspaces(before)[0];
  const state = run(before, { type: 'workspace.create', name: 'Work' });
  assert.equal(state.toast?.i18n?.id, 'workspaces.created');
  assert.deepEqual(state.toast?.i18n?.params, { name: 'Work', previous: 'Main', key: workspaceKeyLabel(0) });
  assert.match(state.toast!.text, /^Work is ready\. Your other tabs are in Main · (Alt\+1|⌃1)$/);
  assert.equal(state.toast?.action?.labelId, 'workspaces.goBack');
  assert.deepEqual(state.toast?.action?.command, { type: 'workspace.select', id: main.id });
  const back = run(state, state.toast!.action!.command);
  assert.equal(back.activeWorkspaceId, main.id);
  assert.equal(back.activeTabId, 'b', 'Go back lands on the tab Main showed last');
});

test('P0-1: taking every tab along says so, with the count', () => {
  const state = run(three(), { type: 'workspace.create', name: 'Work', tabs: 'move' });
  assert.equal(state.toast?.i18n?.id, 'workspaces.createdAll');
  assert.equal(state.toast?.i18n?.params?.count, 3);
  assert.match(state.toast!.text, /with your 3 tabs\. Main starts fresh/);
});

test('P0-5: "This tab" moves the tab on screen (or the one asked for) and leaves the rest where they were', () => {
  const state = run(three(), { type: 'workspace.create', name: 'Work', tabs: 'current' });
  const work = named(state, 'Work'), main = windowWorkspaces(state)[0];
  assert.equal(state.activeWorkspaceId, work.id);
  assert.equal(state.activeTabId, 'b');
  assert.deepEqual(scopeToWorkspace(state).tabs.map(tab => tab.id), ['b']);
  assert.deepEqual(state.tabs.filter(tab => workspaceIdOf(state, tab) === main.id).map(tab => tab.id), ['a', 'c']);
  const asked = run(three(), { type: 'workspace.create', name: 'Study', tabs: 'current', tabId: 'c' });
  assert.deepEqual(scopeToWorkspace(asked).tabs.map(tab => tab.id), ['c']);
  assert.equal(asked.activeTabId, 'c');
});

test('P0-5: "This tab" brings its split partner along, and a private tab is never moved', () => {
  let state = three();
  state = { ...state, windowUi: { ...state.windowUi, splitGroups: [{ id: 'split-1', tabIds: ['b', 'c'], layout: 'columns' } as never] } };
  state = run(state, { type: 'workspace.create', name: 'Work', tabs: 'current' });
  assert.deepEqual(scopeToWorkspace(state).tabs.map(tab => tab.id).sort(), ['b', 'c']);
  const privateTab = three();
  privateTab.tabs[1] = { ...privateTab.tabs[1], privacy: 'private' } as never;
  const result = run(privateTab, { type: 'workspace.create', name: 'Work', tabs: 'current' });
  assert.ok(result.tabs.every(tab => tab.id === 'b' ? workspaceIdOf(result, tab) !== named(result, 'Work').id : true), 'the private tab stays put');
});

test('P0-6: with one workspace the frame wears the profile colour, even if Main has its own; Main inherits the profile colour', () => {
  const base = createInitialState();
  const second = { id: 'profile-studio', name: 'Studio', color: '#e8590c' } as BrowserSnapshot['browserProfiles'][number];
  let state = run({ ...base, browserProfiles: [...base.browserProfiles, second] }, { type: 'ui.update', patch: {} });
  state = { ...state, activeBrowserProfileId: 'profile-studio', tabs: [makeTab('s1', '', 'https://s.test/', 'profile-studio')], activeTabId: 's1' };
  state = run(state, { type: 'ui.update', patch: {} });
  const main = windowWorkspaces(state)[0];
  assert.equal(frameTintFor(state), '#e8590c');
  const coloured = { ...state, workspaces: state.workspaces.map(item => item.id === main.id ? { ...item, color: '#2f6fed' } : item) };
  assert.equal(frameTintFor(coloured), '#e8590c', 'one workspace: its colour cannot replace the profile\'s');
  assert.equal(workspaceColorOf(state, main), '#e8590c', 'Main wears the profile colour on its rail');
  const two = run(state, { type: 'workspace.create', name: 'Work', color: '#2f6fed' });
  assert.equal(frameTintFor(two), '#2f6fed', 'two workspaces: the open one\'s own colour');
  assert.equal(workspaceColorOf(two, named(two, 'Work')), '#2f6fed');
  assert.equal(frameTintFor(run(two, { type: 'workspace.select', id: main.id })), '#e8590c', 'Main is back to the profile colour');
  const plain = run(three(), { type: 'workspace.create', name: 'Work' });
  assert.equal(workspaceColorOf(plain, windowWorkspaces(plain)[0]), undefined, 'the default profile has no tint, so Main has none');
});

test('P0-4 / P0-8: counts per workspace (tabs, and tabs with a page) reach the scoped view', () => {
  let state = run(three(), { type: 'workspace.create', name: 'Work' });
  const work = named(state, 'Work'), main = windowWorkspaces(state)[0];
  assert.deepEqual(workspaceCounts(state)[main.id], { tabs: 3, pages: 3 });
  assert.deepEqual(workspaceCounts(state)[work.id], { tabs: 1, pages: 0 }, 'a fresh workspace holds one new tab and no pages: it deletes at once');
  assert.deepEqual(scopeToWorkspace(state).workspaceTabCounts, workspaceCounts(state));
  state = run(state, { type: 'workspace.delete', id: work.id });
  assert.equal(state.toast?.i18n?.id, 'runtime.workspaceDeleted');
  assert.equal(state.toast?.action?.command.type, 'workspace.restore', 'delete keeps its Undo');
});

test('P0-6: a new workspace\'s icon follows its name', () => {
  assert.equal(suggestedGlyph('Work'), 'bag');
  assert.equal(suggestedGlyph('Study'), 'book');
  assert.equal(suggestedGlyph('Side project'), 'star');
  assert.equal(suggestedGlyph('Personal'), 'home');
  assert.equal(suggestedGlyph('Arbeit'), 'bag');
  assert.equal(suggestedGlyph('Zebra'), undefined);
});

test('P0-9: "workspace" no longer names the sidebar host: the home page title, the Frost rail and Settings search', async () => {
  assert.equal(navigationTitle('acira://home'), 'Home');
  const en = JSON.parse(fs.readFileSync(path.join(root, 'src/i18n/en.json'), 'utf8')) as Record<string, string>;
  for (const id of ['frostworkspace.workspace', 'frostworkspace.workspaceNavigation', 'frostworkspace.aciraWorkspace']) assert.doesNotMatch(en[id], /workspace/i, id);
  assert.equal(en['workspaces.hint'], undefined, 'the first-run tip is retired');
  assert.ok(!fs.existsSync(path.join(root, 'src/features/workspaces/workspaceHint.ts')));
  const all: SettingsEntry[] = [];
  const dir = path.join(root, 'src/features/settings/entries');
  for (const file of fs.readdirSync(dir).filter(name => name.endsWith('.ts')).sort()) all.push(...((await import(pathToFileURL(path.join(dir, file)).href)).default as SettingsEntry[]));
  const context: SettingsContext = { customGlassColors: true, privateProfile: false, desktop: true, websiteOpen: true, appearanceChanged: true, toolbarChanged: true, newTabChanged: true, stockSearch: true };
  for (const query of ['workspace', 'workspaces', 'spaces']) {
    const hits = searchSettingsDetailed(all, query, context).hits.map(hit => hit.entry.id);
    assert.ok(hits.length > 0, query);
    assert.ok(!hits.includes('shortcut-workspace'), `${query} does not find Toggle sidebar`);
  }
});

test('P0-2 / P0-3 / P0-7: one workspace shows no switcher, chip or title line; the HUD text names the workspace and its tabs', () => {
  const src = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');
  const switcher = src('src/features/workspaces/WorkspaceSwitcher.tsx');
  assert.match(switcher, /if \(!several\) return null;/, 'the sidebar row');
  assert.match(switcher, /if \(list\.length < 2 \|\| !open\) return null;/, 'the title line');
  assert.match(switcher, /if \(!open \|\| list\.length < 2\) return null;/, 'the strip chip');
  assert.doesNotMatch(switcher, /workspaceHint|sb-ws-hint|data-single/, 'no first-run tip and no single-workspace control');
  const en = JSON.parse(src('src/i18n/en.json')) as Record<string, string>;
  assert.ok(en['workspaces.hud'].includes('{name} workspace'));
  assert.ok(src('src/features/accounts/ProfileSwitcher.tsx').includes('data-profile-workspace-new'), 'the profile panel offers New workspace…');
  assert.ok(src('src/components/TabGroupControls.tsx').includes("start:'current',tabId:tab.id"), 'the tab menu offers Move to › New workspace…');
});
