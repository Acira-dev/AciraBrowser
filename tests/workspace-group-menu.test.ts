import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// Item 16 (b): the group menu has "Move to workspace ›" once there is another workspace to go to; it sits with the other actions on every tab of the group.
register('data:text/javascript,' + encodeURIComponent("export async function load(url, context, next) { return url.endsWith('.css') ? { format: 'module', source: '', shortCircuit: true } : next(url, context); }"));
const store = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value), removeItem: (key: string) => void store.delete(key) },
  window: { acira: { platform: 'darwin', subscribeBrowser: () => () => undefined, service: async () => ({}) } },
});
const { TabGroupControls } = await import('../src/components/TabGroupControls');
const { createInitialState, makeTab, reduceBrowser } = await import('../src/runtime/core');
import type { BrowserAction, BrowserSnapshot } from '../src/runtime/types';

const run = (state: BrowserSnapshot, ...actions: BrowserAction[]) => actions.reduce(reduceBrowser, state);
function grouped(workspaces: number, spaces?: 'profiles' | 'workspaces'): BrowserSnapshot {
  const first = createInitialState(), profile = first.activeBrowserProfileId;
  let state = run({ ...first, tabs: ['a', 'b', 'c'].map(id => makeTab(id, '', `https://${id}.test/`, profile)), activeTabId: 'c' }, { type: 'ui.update', patch: {} });
  state = run(state, { type: 'tab.group.create', tabId: 'a', name: 'Research' });
  state = run(state, { type: 'tab.group.assign', tabIds: ['b'], groupId: state.tabGroups[0].id });
  for (let i = 1; i < workspaces; i++) state = run(state, { type: 'workspace.create', name: `Space ${i}` }, { type: 'workspace.select', id: state.workspaces[0].id });
  if (spaces) state.settings.spaces = spaces;
  return state;
}
const menu = (state: BrowserSnapshot, scope: 'tab' | 'group' = 'group') => renderToStaticMarkup(createElement(TabGroupControls, { state, tab: state.tabs.find(tab => tab.id === 'a')!, dispatch: () => undefined, scope }));

test('the group menu offers Move to workspace once the window has another workspace', () => {
  const two = menu(grouped(2));
  assert.match(two, /aria-haspopup="menu"[^>]*>.*?<span>Move to workspace<\/span>/);
  assert.doesNotMatch(menu(grouped(1)), /Move to workspace/, 'one workspace: nowhere to go');
});

test('it is not offered while profiles are spaces (a group stays in its profile)', () => {
  assert.doesNotMatch(menu(grouped(2, 'profiles')), /Move to workspace/);
});

test('the other rows are still there, in order: Put to sleep sits before Move to workspace, Rename and Ungroup stay after it', () => {
  const markup = menu(grouped(3));
  const at = (label: string) => markup.indexOf(`<span>${label}</span>`);
  assert.ok(at('New tab in group') >= 0 && at('Copy links') > at('New tab in group'));
  assert.ok(at('Put group to sleep') > at('Copy links') && at('Move to workspace') > at('Put group to sleep'), 'Put to sleep, then Move to workspace');
  assert.ok(at('Rename') > at('Move to workspace'), 'the group\'s own rows follow');
  assert.ok(at('Ungroup tabs') > at('Rename'));
});
