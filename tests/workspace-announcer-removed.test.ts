import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import test from 'node:test';
import type { BrowserAction, BrowserSnapshot } from '../src/runtime/types';

// The screen-reader line for a space switch ("Work, 1 tab") stayed after the profile whose space was on screen was removed: the window
// went to the other space without saying so (one space left: nothing to switch between), and the line still named Work. A change of
// place the line does not announce now empties it.
register('data:text/javascript,' + encodeURIComponent("export async function load(url, context, next) { return url.endsWith('.css') ? { format: 'module', source: '', shortCircuit: true } : next(url, context); }"));
(globalThis as { window?: unknown }).window ??= {}; // the runtime client reads window.acira at import
const { createInitialState, makeTab, reduceBrowser } = await import('../src/runtime/core');
const { scopeToWorkspace, switchSpoken, windowWorkspaces } = await import('../src/runtime/workspaces');
const { hudText, keptAnnouncement } = await import('../src/features/workspaces/WorkspaceHud');
const run = (state: BrowserSnapshot, ...actions: BrowserAction[]) => actions.reduce(reduceBrowser, state);
const place = (state: BrowserSnapshot) => ({ id: state.activeWorkspaceId, profile: state.activeBrowserProfileId });

/** What WorkspaceSwitchFeedback's region holds after each state, as its effect decides it (the switcher on screen). It is given the
 *  interface's view of the window: the space on screen (runtime/client.ts). */
function announcer(states: BrowserSnapshot[]) {
  let said = '', last: ReturnType<typeof place> | null = null;
  return states.map(scopeToWorkspace).map(state => {
    const before = last, now = place(state);
    said = keptAnnouncement(said, before, now);
    last = now;
    if (switchSpoken(state, before, now)) said = hudText(state) ?? said;
    return said;
  });
}

test('removing the profile whose space is on screen empties the switch line', () => {
  const initial = createInitialState(), personal = initial.activeBrowserProfileId;
  let state = run({ ...initial, tabs: [makeTab('a', '', 'https://a.test/', personal)], activeTabId: 'a' }, { type: 'browser.profile.create', name: 'Work' });
  const work = state.browserProfiles.find(profile => profile.name === 'Work')!.id;
  state = run({ ...state, tabs: [...state.tabs, makeTab('w', '', 'https://w.test/', work)], settings: { ...state.settings, spaces: 'profiles' } }, { type: 'ui.update', patch: {} });
  const workSpace = windowWorkspaces(state).find(item => item.browserProfileId === work)!;
  const onWork = run(state, { type: 'workspace.select', id: workSpace.id });
  const removed = run(onWork, { type: 'browser.profile.remove', id: work });
  assert.equal(removed.activeBrowserProfileId, personal, 'the window is back on Personal');
  const said = announcer([state, onWork, removed]);
  assert.equal(said[1], 'Work, 1 tab', 'the switch to Work is said');
  assert.equal(said[2], '', 'and nothing names Work once it is gone');
});

test('the line stays while the place stays; the first look keeps it empty', () => {
  const home = { id: 'ws-1', profile: 'p-1' }, there = { id: 'ws-2', profile: 'p-2' };
  assert.equal(keptAnnouncement('Work, 1 tab', there, there), 'Work, 1 tab');
  assert.equal(keptAnnouncement('', null, home), '');
  assert.equal(keptAnnouncement('Work, 1 tab', there, home), '');
  const hud = readFileSync(new URL('../src/features/workspaces/WorkspaceHud.tsx', import.meta.url), 'utf8');
  assert.match(hud, /setSaid\(said => keptAnnouncement\(said, before, now\)\);\s*last\.current = now;\s*if \(!switchSpoken\(state, before, now\)\) return;/, 'every change of place goes through it before the switch is said');
});
