import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { createInitialState, reduceBrowser } from '../src/runtime/core';
import { scopeToWorkspace, windowHoldsWorkspace, workspaceHolders, workspaceIdOf } from '../src/runtime/workspaces';
import { paletteSections } from '../src/ui/paletteResults';
import type { BrowserSnapshot } from '../src/runtime/types';

const require = createRequire(import.meta.url);
const { COMMANDS, createShortcutRegistry } = require('../desktop/shortcut-registry.cjs') as { COMMANDS: { id: string; defaults: string[]; action: Record<string, unknown> }[]; createShortcutRegistry: (options: { platform: string; file?: string }) => { list: () => { commands?: unknown }; set: (id: string, value: string, options?: { replace?: boolean }) => { ok: boolean }; resolve: (input: unknown, resolver: (input: unknown, platform?: string) => unknown, keyOf: (input: unknown) => string) => unknown; effective: () => Map<string, string> } };
const { resolveDefaultShortcut, shortcutKey } = require('../desktop/shortcuts.cjs') as { resolveDefaultShortcut: (input: unknown, platform?: string) => unknown; shortcutKey: (input: unknown) => string };
const read = (file: string) => fs.readFileSync(path.resolve(file), 'utf8');
const run = (state: BrowserSnapshot, ...actions: Parameters<typeof reduceBrowser>[1][]) => actions.reduce(reduceBrowser, state);
const key = (code: string, extra: Record<string, unknown> = {}) => ({ type: 'keyDown', key: code, code, alt: false, control: false, meta: false, shift: false, ...extra });

/** A window with Main (one page) and Work (two pages), the open workspace Work. */
function twoWorkspaces() {
  let s = createInitialState();
  s = run(s, { type: 'tab.navigate', tabId: s.activeTabId, url: 'https://main.test/' }, { type: 'workspace.create', name: 'Work' }, { type: 'tab.new', url: 'https://figma.test/design' }, { type: 'tab.new', url: 'https://docs.test/' });
  return s;
}

test('tab search: the scoped view carries the other workspaces\' tabs, and only with several workspaces', () => {
  const s = twoWorkspaces(), scoped = scopeToWorkspace(s), work = s.activeWorkspaceId, main = s.workspaces.find(w => w.id !== work)!.id;
  assert.ok(scoped.tabs.every(tab => workspaceIdOf(s, tab) === work), 'the strip and sidebar still show only the open workspace');
  assert.ok(scoped.otherWorkspaceTabs && scoped.otherWorkspaceTabs.length >= 1);
  assert.ok(scoped.otherWorkspaceTabs!.every(tab => workspaceIdOf(s, tab) === main), 'every one lives in another workspace');
  assert.ok(scoped.otherWorkspaceTabs!.some(tab => tab.url === 'https://main.test/'));
  const single = scopeToWorkspace(createInitialState());
  assert.equal(single.otherWorkspaceTabs, undefined);
});

test('tab search: the command bar lists matching tabs of other workspaces in a section named for the workspace, behind this workspace\'s own', () => {
  const here = [{ id: 'h1', title: 'Figma plugins', url: 'https://here.test/' }, { id: 'h2', title: 'Notes', url: 'https://notes.test/' }];
  const other = [{ id: 'o1', title: 'Figma - Design file', url: 'https://figma.test/design' }, { id: 'o2', title: 'Groceries', url: 'https://shop.test/' }];
  const input = { commands: [], tabs: here, activeTabId: 'h2', history: [], pages: [], recent: [], otherTabs: [{ id: 'workspace-work', name: 'Work', tabs: other }] };
  const found = paletteSections({ ...input, query: 'figma' });
  const own = found.find(section => section.key === 'tabs')!, elsewhere = found.find(section => section.key === 'workspace:workspace-work')!;
  assert.ok(own && elsewhere, 'both sections');
  assert.equal(elsewhere.label, 'In Work', 'labelled with the workspace');
  assert.deepEqual(elsewhere.items.map(item => item.kind === 'tab' && item.tab.id), ['o1']);
  assert.deepEqual(own.items.map(item => item.kind === 'tab' && item.tab.id), ['h1']);
  assert.ok(own.items[0].score > elsewhere.items[0].score, 'this workspace\'s own tabs rank first');
  assert.equal(found.findIndex(section => section.key === 'tabs') < found.findIndex(section => section.key === 'workspace:workspace-work'), true);
  assert.equal(paletteSections({ ...input, query: '' }).some(section => section.key.startsWith('workspace:')), false, 'nothing from other workspaces before you type');
  assert.equal(paletteSections({ ...input, query: 'zzzz-nothing' }).some(section => section.key === 'workspace:workspace-work'), false);
  // A tab already open here is not offered again from history, and other workspaces' pages are not either.
  const withHistory = paletteSections({ ...input, query: 'figma', history: [{ url: 'https://figma.test/design', title: 'Figma - Design file' }] });
  assert.equal(withHistory.find(section => section.key === 'history'), undefined);
});

test('tab search: choosing a tab in another workspace switches there (the open workspace follows the tab)', () => {
  const s = twoWorkspaces(), work = s.activeWorkspaceId, mainTab = s.tabs.find(tab => tab.url === 'https://main.test/')!;
  assert.notEqual(workspaceIdOf(s, mainTab), work);
  const next = reduceBrowser(s, { type: 'tab.select', id: mainTab.id });
  assert.equal(next.activeTabId, mainTab.id);
  assert.equal(next.activeWorkspaceId, workspaceIdOf(s, mainTab));
  const palette = read('src/components/CommandPalette.tsx'), viewer = read('src/components/TabResults.tsx'), app = read('src/App.tsx');
  assert.match(palette, /otherTabs/); assert.match(palette, /dispatch\(\{ type: 'tab\.select', id: item\.tab\.id \}\)/);
  assert.match(viewer, /groups\?\.map\(group=>/); assert.match(viewer, /workspaces\.foundIn/);
  assert.match(app, /groups=\{otherMatching\}/); assert.match(app, /state\.otherWorkspaceTabs/);
  // Live page views now switch without replaying a captured page. The native
  // navigation checks verify that the selected workspace keeps its document.
});

test('next / previous workspace: Ctrl+Alt+PageDown / PageUp in the stock resolver and the registry, editable, no conflicts', () => {
  assert.deepEqual(resolveDefaultShortcut(key('PageDown', { control: true, alt: true }), 'win32'), { action: 'workspace-cycle', direction: 1 });
  assert.deepEqual(resolveDefaultShortcut(key('PageUp', { control: true, alt: true }), 'win32'), { action: 'workspace-cycle', direction: -1 });
  assert.equal(resolveDefaultShortcut(key('PageDown', { control: true, alt: true, isAutoRepeat: true }), 'win32'), null, 'a held key does not spin');
  assert.deepEqual(resolveDefaultShortcut(key('PageDown', { control: true }), 'win32'), { action: 'cycle-tab', direction: 1 }, 'Ctrl+PageDown is still the next tab');
  assert.deepEqual(resolveDefaultShortcut(key('PageDown', { control: true, shift: true }), 'win32'), { action: 'move-tab', direction: 1 });
  assert.notDeepEqual(resolveDefaultShortcut(key('PageDown', { alt: true }), 'win32'), { action: 'workspace-cycle', direction: 1 });
  const next = COMMANDS.find(command => command.id === 'next-workspace')!, prev = COMMANDS.find(command => command.id === 'prev-workspace')!;
  assert.deepEqual(next.defaults, ['Mod+Alt+PageDown']); assert.deepEqual(prev.defaults, ['Mod+Alt+PageUp']);
  assert.deepEqual(next.action, { action: 'workspace-cycle', direction: 1 });
  const owners = new Map<string, string[]>();
  for (const command of COMMANDS) for (const accel of command.defaults ?? []) owners.set(accel, [...(owners.get(accel) ?? []), command.id]);
  assert.deepEqual(owners.get('Mod+Alt+PageDown'), ['next-workspace']); assert.deepEqual(owners.get('Mod+Alt+PageUp'), ['prev-workspace']);
  const registry = createShortcutRegistry({ platform: 'win32' });
  const owner = registry.effective();
  assert.equal(owner.get('Ctrl+Alt+PageDown'), 'next-workspace'); assert.equal(owner.get('Ctrl+Alt+PageUp'), 'prev-workspace');
  assert.deepEqual(registry.resolve(key('PageDown', { control: true, alt: true }), resolveDefaultShortcut, shortcutKey), { action: 'workspace-cycle', direction: 1 });
  // Rebinding moves it: the stock keys stop answering and the new one does.
  assert.equal(registry.set('next-workspace', 'Ctrl+Alt+Right').ok, true);
  assert.equal(registry.resolve(key('PageDown', { control: true, alt: true }), resolveDefaultShortcut, shortcutKey), null);
  assert.deepEqual(registry.resolve(key('ArrowRight', { control: true, alt: true }), resolveDefaultShortcut, shortcutKey), { action: 'workspace-cycle', direction: 1 });
});

test('next / previous workspace: main cycles with wrap-around and shows the keys in the tooltips and the command bar', () => {
  const main = read('desktop/main.cjs'), switcher = read('src/features/workspaces/WorkspaceSwitcher.tsx'), palette = read('src/components/CommandPalette.tsx');
  assert.match(main, /case 'workspace-cycle':\{const list=windowWorkspaces\(state\),at=list\.findIndex/);
  assert.match(main, /\(Math\.max\(0,at\)\+command\.direction\+list\.length\)%list\.length/);
  assert.match(switcher, /title=\{withCycle\(t\('workspaces\.titleTip'\)\)\}/); assert.match(switcher, /title=\{withCycle\(t\(spaces \? 'workspaces\.spaceChipTip' : 'workspaces\.chipTip'/); // with profiles as spaces, the space words
  assert.match(switcher, /\['next-workspace'/); assert.match(switcher, /\['prev-workspace'/);
  // Not filtered out of the command bar (only the positional switch-workspace-N and new-workspace are).
  const listed = /const listed = \(id: string\) => !\/\^\(([^)]*)\)\//.exec(palette)![1];
  assert.equal(new RegExp(`^(${listed})`).test('next-workspace'), false);
  assert.equal(new RegExp(`^(${listed})`).test('prev-workspace'), false);
});

test('multi-window: the workspace another window holds is marked with that window and is never opened empty here', () => {
  let one = twoWorkspaces();
  one = run(one, { type: 'workspace.select', id: one.workspaces[0].id });   // window 1 shows Main and holds Work's two pages
  const work = one.workspaces.find(w => w.id !== one.activeWorkspaceId)!.id;
  assert.equal(windowHoldsWorkspace(one, work), true); assert.equal(windowHoldsWorkspace(one, one.activeWorkspaceId), true);
  // Window 2 is new: the same workspaces, one new tab in Main.
  const two: BrowserSnapshot = { ...createInitialState(), workspaces: structuredClone(one.workspaces), activeWorkspaceId: one.workspaces[0].id };
  assert.equal(windowHoldsWorkspace(two, work), false, 'a lone new tab is not tabs');
  assert.deepEqual(workspaceHolders(two, [{ number: 1, state: one }]), { [work]: 1 }, 'Work lives in window 1');
  assert.deepEqual(workspaceHolders(one, [{ number: 2, state: two }]), {}, 'window 1 holds both');
  // A window showing a workspace wins over one that merely holds pages in it.
  const elsewhere: BrowserSnapshot = { ...two, activeWorkspaceId: work };
  assert.deepEqual(workspaceHolders(two, [{ number: 1, state: one }, { number: 3, state: elsewhere }]), { [work]: 3 });
  // Nobody holds it: nothing is marked, so choosing it opens it here (a fresh workspace, not a twin).
  const nobody = { ...one, tabs: one.tabs.filter(tab => workspaceIdOf(one, tab) !== work), activeWorkspaceId: one.workspaces[0].id };
  assert.deepEqual(workspaceHolders(two, [{ number: 1, state: nobody }]), {});
  const main = read('desktop/main.cjs');
  assert.match(main, /action\.type==='workspace\.select'&&!privateMode&&!windowHoldsWorkspace\(state,action\.id\)/);
  assert.match(main, /owner\.show\(\);if\(owner\.state\.activeWorkspaceId!==action\.id\)owner\.dispatchAction\(action\)/, 'the holder is brought forward first, then switched (showing it hands focus to its old page, which would undo a switch made before it)');
  assert.match(main, /const out=workspaceHolders\(state,/);
});

test('private windows: Alt+N, the next / previous keys and New workspace… say once that private windows have no workspaces', () => {
  const main = read('desktop/main.cjs');
  assert.match(main, /let privateWorkspaceNoted=false;function noteNoWorkspaces\(\)\{if\(!privateMode\|\|privateWorkspaceNoted\)return;privateWorkspaceNoted=true;dispatch\(\{type:'toast',text:tm\("workspaces\.privateNone"\),tone:'info'\}\)/);
  assert.match(main, /else noteNoWorkspaces\(\);break;\}/);
  assert.match(main, /case 'workspace-new':if\(privateMode\)noteNoWorkspaces\(\);else ui\('workspace-edit'\)/);
  for (const locale of ['en', 'ar', 'de', 'es', 'fr', 'hi', 'it', 'ja', 'ko', 'pt-BR', 'ru', 'tr', 'zh-CN']) {
    const catalog = JSON.parse(read(`src/i18n/${locale}.json`)) as Record<string, string>;
    for (const id of ['workspaces.privateNone', 'workspaces.foundIn', 'shortcutCmd.next-workspace', 'shortcutCmd.prev-workspace']) assert.ok(catalog[id], `${locale} ${id}`);
  }
  assert.equal((JSON.parse(read('src/i18n/en.json')) as Record<string, string>)['workspaces.privateNone'], 'Private windows don\'t use workspaces.');
});
