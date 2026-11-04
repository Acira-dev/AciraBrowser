import assert from 'node:assert/strict';
import test from 'node:test';
import { createInitialState, makeTab, reduceBrowser } from '../src/runtime/core';
import { scopeToWorkspace } from '../src/runtime/workspaces';
import type { BrowserAction, BrowserSnapshot, TabSession } from '../src/runtime/types';

// QA of "Profiles as spaces" (bug 1b): failing tests that reproduce what the live app showed.
const run = (state: BrowserSnapshot, ...actions: BrowserAction[]) => actions.reduce(reduceBrowser, state);

/** Alex's Main (a, b) and an unlocked secured workspace Bank (vault, on screen), plus Client's tabs x, y in the same window. */
function bankOpen(): { state: BrowserSnapshot; alex: string; client: string } {
  const initial = createInitialState(), alex = initial.activeBrowserProfileId;
  let state = run(initial, { type: 'browser.profile.create', name: 'Client' });
  const client = state.browserProfiles.find(profile => profile.name === 'Client')!.id;
  const tab = (id: string, profile: string, extra: Partial<TabSession> = {}): TabSession => ({ ...makeTab(id, '', `https://${id}.test/`, profile), ...extra });
  state = run({
    ...state,
    workspaces: [...state.workspaces.filter(workspace => workspace.browserProfileId !== alex), { id: 'ws-main', name: '', browserProfileId: alex }, { id: 'ws-bank', name: 'Bank', browserProfileId: alex, secured: true, unlocked: true }],
    tabs: [tab('a', alex), tab('b', alex), tab('vault', alex, { workspaceId: 'ws-bank', privacy: 'secured' }), tab('x', client), tab('y', client)],
    activeTabId: 'vault', activeWorkspaceId: 'ws-bank'
  }, { type: 'ui.update', patch: {} });
  return { state, alex, client };
}

test('profiles as spaces: main\'s lock of a secured workspace (workspace.secured-lock) still applies once the mode is on', () => {
  // main.cjs settleProfileWindows dispatches workspace.lock after commitAction has turned the mode on; the secured service then
  // sends workspace.secured-lock, which the reducer must not drop (live: Bank stayed unlocked and its page stayed open).
  const { state } = bankOpen();
  const on = run(state, { type: 'settings.update', patch: { spaces: 'profiles' } });
  const locked = run(on, { type: 'workspace.secured-lock', id: 'ws-bank' } as BrowserAction);
  const bank = locked.workspaces.find(workspace => workspace.id === 'ws-bank');
  assert.ok(bank && !bank.unlocked, 'Bank is locked');
  assert.ok(!locked.tabs.some(item => item.id === 'vault'), 'its secured tab left the window');
});

test('profiles as spaces: a window left on a workspace that is not a space never lists another profile\'s tabs', () => {
  // Live: turning the mode on with the secured Bank on screen left activeWorkspaceId on Bank; scopeToWorkspace then skipped
  // scoping and the tab strip drew Client's (and every other profile's) tabs next to Alex's.
  const { state, client } = bankOpen();
  const on = run(state, { type: 'settings.update', patch: { spaces: 'profiles' } });
  const shown = scopeToWorkspace(on).tabs;
  assert.deepEqual(shown.filter(item => item.browserProfileId === client).map(item => item.id), [], 'no Client tab is shown in Alex\'s window list');
});
