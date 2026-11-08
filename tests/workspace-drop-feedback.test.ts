import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createInitialState, makeTab, reduceBrowser } from '../src/runtime/core';
import { workspaceIdOf } from '../src/runtime/workspaces';
import { markWorkspaceDrop, workspaceDropNote } from '../src/ui/workspaceDrop';
import type { BrowserAction, BrowserSnapshot } from '../src/runtime/types';

// Item 16: what the banner above the workspace row says while a tab, a split or a group is carried over a workspace icon.
const run = (state: BrowserSnapshot, ...actions: BrowserAction[]) => actions.reduce(reduceBrowser, state);
function scene() {
  const first = createInitialState(), profile = first.activeBrowserProfileId;
  let state = run({ ...first, tabs: ['a', 'b', 'c'].map(id => makeTab(id, '', `https://${id}.test/`, profile)), activeTabId: 'a' }, { type: 'ui.update', patch: {} });
  state = run(state, { type: 'tab.group.create', tabId: 'a', name: 'Research' });
  state = run(state, { type: 'tab.group.assign', tabIds: ['b'], groupId: state.tabGroups[0].id });
  const main = state.workspaces[0].id, group = state.tabGroups[0].id;
  state = run(state, { type: 'workspace.create', name: 'Work' }, { type: 'workspace.select', id: main }, { type: 'workspace.create', name: 'Vault' }, { type: 'workspace.select', id: main });
  const id = (name: string) => state.workspaces.find(item => item.name === name)!.id;
  return { state, main, group, work: id('Work'), vault: id('Vault') };
}

test('a tab over another workspace: "Move to Work"; over its own, nothing', () => {
  const { state, main, work } = scene();
  assert.deepEqual(workspaceDropNote(state, { kind: 'tabs', ids: ['c'] }, work), { text: 'Move to Work', refused: false });
  assert.equal(workspaceDropNote(state, { kind: 'tabs', ids: ['c'] }, main), null);
  assert.equal(workspaceDropNote(state, { kind: 'tabs', ids: ['c'] }, 'nope'), null);
  assert.equal(workspaceDropNote(state, { kind: 'tabs', ids: ['gone'] }, work), null);
});

test('a group over another workspace names the group, its tabs and the target', () => {
  const { state, work, group } = scene();
  assert.deepEqual(workspaceDropNote(state, { kind: 'group', id: group }, work), { text: 'Move Research · 2 tabs to Work', refused: false });
  assert.equal(workspaceDropNote(state, { kind: 'group', id: 'nope' }, work), null);
});

test('the first workspace is called Main on the banner while it has no name', () => {
  const { state, main, work } = scene();
  const there = run(state, { type: 'workspace.move-tabs', tabIds: ['c'], workspaceId: work }, { type: 'workspace.select', id: work });
  assert.deepEqual(workspaceDropNote(there, { kind: 'tabs', ids: ['c'] }, main), { text: 'Move to Main', refused: false });
});

test('a locked workspace refuses, with the existing words and a lock; a secured tab may not leave its workspace', () => {
  const { state, main, vault } = scene();
  const locked = run(state, { type: 'workspace.secured-set', id: vault, secured: true }, { type: 'workspace.secured-lock', id: vault }, { type: 'workspace.select', id: main });
  assert.deepEqual(workspaceDropNote(locked, { kind: 'tabs', ids: ['c'] }, vault), { text: 'Unlock Vault first', refused: true });
  const open = run(state, { type: 'workspace.secured-set', id: vault, secured: true }, { type: 'workspace.select', id: vault });
  const inside = open.tabs.find(tab => workspaceIdOf(open, tab) === vault)!;
  assert.equal(inside.privacy, 'secured');
  assert.deepEqual(workspaceDropNote(open, { kind: 'tabs', ids: [inside.id] }, main), { text: 'Tabs of a locked workspace stay in it', refused: true });
});

test('private and Tor tabs get no banner, over any workspace', () => {
  const { state, work, vault } = scene();
  for (const privacy of ['private', 'tor'] as const) {
    const marked = { ...state, tabs: state.tabs.map(tab => tab.id === 'c' ? { ...tab, privacy } : tab) };
    assert.equal(workspaceDropNote(marked, { kind: 'tabs', ids: ['c'] }, work), null, privacy);
    assert.equal(workspaceDropNote(marked, { kind: 'tabs', ids: ['c'] }, vault), null, privacy);
  }
});

test('with profiles as spaces there is no banner (a tab stays in its profile; the drop answers with its own toast)', () => {
  const { state, work } = scene();
  assert.equal(workspaceDropNote({ ...state, settings: { ...state.settings, spaces: 'profiles' } }, { kind: 'tabs', ids: ['c'] }, work), null);
});

/** A page of two icons: markWorkspaceDrop reads the element under the pointer, lights it and tells the banner. */
function pageWith(under: string | null) {
  const attrs = new Map<string, Map<string, string>>(), icons = ['workspace-work', 'workspace-vault'].map(id => { const own = new Map<string, string>(); attrs.set(id, own); const dataset: Record<string, string> = { ws: id }; return { dataset, getAttribute: (key: string) => key === 'aria-checked' ? 'false' : own.get(key) ?? null, setAttribute: (key: string, value: string) => { own.set(key, value); dataset.drop = value; } }; });
  const globals = globalThis as unknown as Record<string, unknown>;
  globals.CSS = { escape: (text: string) => text };
  globals.document = { elementFromPoint: () => under ? { closest: () => icons.find(icon => icon.dataset.ws === under) } : null, querySelectorAll: () => icons.filter(icon => 'drop' in icon.dataset), querySelector: (selector: string) => icons.find(icon => selector.includes(icon.dataset.ws)) };
  return { attrs, icons };
}
test('over an icon: it is marked (plain when the drop would move, "refused" when not), and cleared when the pointer leaves', () => {
  const ok = { text: 'Move to Work', refused: false }, no = { text: 'Unlock Vault first', refused: true };
  let page = pageWith('workspace-work');
  markWorkspaceDrop({ x: 1, y: 1 }, id => id === 'workspace-work' ? ok : no);
  assert.equal(page.attrs.get('workspace-work')!.get('data-drop'), '');
  page = pageWith('workspace-vault');
  markWorkspaceDrop({ x: 1, y: 1 }, id => id === 'workspace-work' ? ok : no);
  assert.equal(page.attrs.get('workspace-vault')!.get('data-drop'), 'refused');
  page = pageWith('workspace-work');
  markWorkspaceDrop({ x: 1, y: 1 }, () => null);
  assert.equal(page.attrs.get('workspace-work')!.has('data-drop'), false, 'nothing to say: the icon stays plain');
  markWorkspaceDrop({ x: 1, y: 1 });
  assert.equal(page.attrs.get('workspace-work')!.get('data-drop'), '', 'a caller with no note keeps the old fill');
  markWorkspaceDrop(null);
  assert.equal(page.icons.some(icon => 'drop' in icon.dataset), false);
});

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
test('the wiring: the sidebar carries a group by its header to a workspace, the menu has the row, main knows the action', () => {
  const sidebar = read('src/components/sidebar/AciraSidebar.tsx'), menu = read('src/components/TabGroupControls.tsx');
  assert.match(sidebar, /type:'workspace\.move-group',groupId:current\.group\.id,workspaceId:target/);
  assert.match(sidebar, /startDrag\(event,lead,undefined,false,'group:'\+entry\.group\.id,entry\.group\)/);
  assert.match(sidebar, /markWorkspaceDrop\(point,dropNote\(\{kind:'group'/);
  assert.match(sidebar, /markWorkspaceDrop\(point,dropNote\(\{kind:'tabs',ids:\[current\.id\]\}\)\)/);
  assert.match(sidebar, /workspaceDropAt\(point\)\?\{type:'workspace\.move-tabs' as const,tabIds:current\.split\.tabIds/, 'a split dropped on an icon is checked before the list');
  assert.match(menu, /type:'workspace\.move-group',groupId:group\.id/);
  assert.match(menu, /spaces\.length>0&&!profilesAsSpaces\(state\)&&item\(t\('workspaces\.moveTo'\)/);
  assert.match(read('desktop/validation.cjs'), /case 'workspace\.move-group'/);
  assert.match(read('desktop/main.cjs'), /'workspace\.move-group'/);
  assert.match(read('src/styles/workspaces.css'), /\.sb-ws\[data-drop=refused\]/);
  assert.match(read('src/features/workspaces/WorkspaceSwitcher.tsx'), /<DropNote \/><div ref=\{host\} className="sb-workspaces"/);
});
