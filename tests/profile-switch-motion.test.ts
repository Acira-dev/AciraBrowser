// Switching profiles with profiles as spaces (founder, 3 Nov: "it expands and glitches, then gets good"). The three decisions the
// switch rests on, without a window. The per-frame proof on a real window is qa/profile-switch-motion.mjs (npm run test:regressions).
import test from 'node:test';
import assert from 'node:assert/strict';
import { appendedTabs } from '../src/components/sidebar/sidebarActions';
import { stripChange } from '../src/ui/tabStripEntries';
import { workspaceSwitched } from '../src/ui/workspaceMotion';

const tab = (id: string) => ({ id });

test('another space\'s list is not "new tabs": its first frame keeps its own order instead of showing it upside down at the top', () => {
  const studio = new Set(['s1', 's2', 's3']);
  assert.deepEqual(appendedTabs([tab('p1'), tab('p2'), tab('p3'), tab('p4')], studio, new Set()), [], 'none of the tabs shown before is left: another list');
  assert.deepEqual(appendedTabs([tab('s1'), tab('s2'), tab('s3'), tab('n')], studio, new Set()).map(item => item.id), ['n'], 'a new tab at the end is still new');
  // A lone new loose tab beside the pinned or grouped tabs it joined is new (it goes to the top), not another list.
  const pinned = tab('pin');
  assert.deepEqual(appendedTabs([tab('n')], new Set(['pin', 'gone']), new Set(), [pinned, tab('n')]).map(item => item.id), ['n']);
});

test('a strip that keeps none of its chips shows another list: nothing leaves or grows in, the strip starts afresh', () => {
  const shown = (change: { entering: Set<string>; replaced: boolean }) => ({ entering: [...change.entering], replaced: change.replaced });
  assert.deepEqual(shown(stripChange(['p1', 'p2', 'p3'], new Set(['s1', 's2']))), { entering: [], replaced: true }, 'a space switch');
  assert.deepEqual(shown(stripChange(['s1', 's2', 'n'], new Set(['s1', 's2']))), { entering: ['n'], replaced: false }, 'a new tab still grows in');
  assert.deepEqual(shown(stripChange(['s1'], new Set(['s1', 's2']))), { entering: [], replaced: false }, 'a closed tab still leaves');
  assert.deepEqual(shown(stripChange(['s1'], new Set())), { entering: ['s1'], replaced: false }, 'the first tab of an empty strip is new');
});

test('with profiles as spaces a change of space crossfades like a workspace switch; with workspaces a change of profile does not', () => {
  const spaces = { settings: { spaces: 'profiles' as const } }, workspaces = { settings: { spaces: 'workspaces' as const } };
  const personal = { activeWorkspaceId: 'workspace-default', activeBrowserProfileId: 'profile-personal' }, client = { activeWorkspaceId: 'workspace-profile-client', activeBrowserProfileId: 'profile-client' };
  assert.equal(workspaceSwitched({ ...personal, ...spaces }, { ...client, ...spaces }), true, 'Personal\'s space to Client\'s');
  assert.equal(workspaceSwitched({ ...personal, ...workspaces }, { ...client, ...workspaces }), false, 'Switch here in a window of one profile');
  assert.equal(workspaceSwitched({ ...personal, ...workspaces }, { ...client, ...spaces }), false, 'turning profiles as spaces on is not a switch');
  assert.equal(workspaceSwitched(personal, { ...personal, activeWorkspaceId: 'workspace-work' }), true, 'a workspace of the same profile, as before');
  assert.equal(workspaceSwitched({ ...personal, ...spaces }, { ...personal, ...spaces }), false, 'nothing changed');
});
