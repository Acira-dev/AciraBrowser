// 13.10 tab-closing report (Discord, 15 Nov): "When I close a current tab the browser jumps to a random tab instead of the previous tab.
// Sometimes it goes to a pinned tab that I did not load, makes it active and takes up RAM." Closing the tab on screen goes back to the tab
// the person was on just before (the window's trail), never into another workspace or profile, and never wakes a tab that was not loaded
// while an awake one is left. Rules: src/runtime/tabTrail.ts.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createInitialState, makeTab, reduceBrowser, restoreSnapshot } from '../src/runtime/core';
import { closeLanding, trailAfter, unloadLanding, TRAIL_LIMIT } from '../src/runtime/tabTrail';
import { workspaceIdOf } from '../src/runtime/workspaces';
import type { BrowserAction, BrowserSnapshot, TabSession } from '../src/runtime/types';

const run = (state: BrowserSnapshot, ...actions: BrowserAction[]) => actions.reduce(reduceBrowser, state);
const select = (id: string): BrowserAction => ({ type: 'tab.select', id });
const close = (id: string): BrowserAction => ({ type: 'tab.close', id });
/** Tabs a, b, c, ... in the strip in that order; `active` on screen; `asleep` have no page (restored and never opened, or unloaded). */
function strip(ids: string[], { active = ids[0], asleep = [] as string[], pinned = [] as string[] } = {}): BrowserSnapshot {
  const base = createInitialState(), profile = base.activeBrowserProfileId;
  const tabs = ids.map(id => ({ ...makeTab(id, '', `https://${id}.test/`, profile), ...(asleep.includes(id) ? { sleeping: true } : {}), ...(pinned.includes(id) ? { pinned: true } : {}) }));
  return { ...base, tabs, activeTabId: active };
}

test('closing the tab on screen goes back to the tab the person was on before it, not the tab below it', () => {
  // strip a b c d; the person went to c, then to a, and closes a: the tab below a is b, the tab before it is c.
  const s = run(strip(['a', 'b', 'c', 'd']), select('c'), select('a'), close('a'));
  assert.equal(s.activeTabId, 'c');
});

test('the trail goes back one tab at a time, in the order the tabs were shown', () => {
  let s = run(strip(['a', 'b', 'c', 'd', 'e']), select('d'), select('b'), select('e'), select('c'));
  const seen: string[] = [];
  for (let n = 0; n < 4; n++) { const id = s.activeTabId; s = run(s, close(id)); seen.push(s.activeTabId); }
  assert.deepEqual(seen, ['e', 'b', 'd', 'a'], 'c closes to e, e to b, b to d, d to a (the first tab, where the person started)');
});

test('a tab that was never loaded is not picked while an awake tab is left (the pinned tab nobody opened)', () => {
  // The person never visited b (restored, asleep); a is awake. Closing the current tab must not load b, which is the tab below it.
  const s = run(strip(['a', 'x', 'b'], { active: 'x', asleep: ['b'] }), close('x'));
  assert.equal(s.activeTabId, 'a');
  // The same with a pinned tab that sits first in the strip and was never opened, while a later tab is awake in the background.
  const p = run(strip(['p', 'x', 'y'], { active: 'x', asleep: ['p'], pinned: ['p'] }), close('x'));
  assert.equal(p.activeTabId, 'y', 'the awake background tab, never the sleeping pinned one');
});

test('with only sleeping tabs left an ordinary one is picked before a pinned or Favorite one, and any tab as a last resort', () => {
  const a = run(strip(['p', 'x', 'o'], { active: 'x', asleep: ['p', 'o'], pinned: ['p'] }), close('x'));
  assert.equal(a.activeTabId, 'o');
  const b = run(strip(['p', 'x'], { active: 'x', asleep: ['p'], pinned: ['p'] }), close('x'));
  assert.equal(b.activeTabId, 'p', 'the only other tab is still shown');
  const c = strip(['x', 'f'], { active: 'x', asleep: ['f'] });
  c.tabs[1].favoriteId = 'fav-1';
  assert.equal(run(c, close('x')).activeTabId, 'f');
});

test('a tab the person visited is the previous tab even when it fell asleep meanwhile', () => {
  let s = run(strip(['a', 'b', 'c', 'd']), select('d'), select('a'));
  s = run(s, { type: 'browser.event', event: { type: 'state', tabId: 'd', sleeping: true } } as BrowserAction);
  assert.equal(run(s, close('a')).activeTabId, 'd', 'the Memory Saver slept it; closing still returns to it (not the awake tab below), as the person expects');
});

test('a tab the person unloaded leaves the trail: closing the next tab does not wake it again', () => {
  let s = run(strip(['a', 'b', 'c']), select('b'), select('c'));
  s = run(s, { type: 'browser.event', event: { type: 'state', tabId: 'b', sleeping: true } } as BrowserAction, { type: 'tab.unloaded', ids: ['b'] });
  assert.equal(s.windowUi.tabTrail?.includes('b'), false);
  assert.equal(run(s, close('c')).activeTabId, 'a');
});

test('a tab opened from another goes back to its opener when closed, before the tab was shown anywhere else', () => {
  let s = run(strip(['a', 'b', 'c'], { active: 'b' }), select('c'), select('b'));
  s = run(s, { type: 'tab.new', url: 'https://child.test/', afterId: 'b' });
  const child = s.activeTabId;
  assert.notEqual(child, 'b');
  assert.equal(run(s, close(child)).activeTabId, 'b', 'its opener, not the trail\'s c or the strip\'s next tab');
  // Opened, then another tab chosen and the child chosen again: the opener is forgotten, the trail decides.
  const t = run(s, select('a'), select(child));
  assert.equal(run(t, close(child)).activeTabId, 'a');
});

test('closing never leaves the workspace or the profile of the closed tab', () => {
  let s = strip(['a', 'b', 'c']);
  s = run(s, { type: 'workspace.create', name: 'Work', tabs: 'current', tabId: 'a' });
  const work = s.workspaces.find(w => w.name === 'Work')!;
  // b and c stay in the first workspace, a is alone in Work. The person visited b and c, then went to Work.
  s = run(s, { type: 'workspace.select', id: s.workspaces.find(w => w.id !== work.id)!.id }, select('b'), select('c'), { type: 'workspace.select', id: work.id });
  assert.equal(s.activeTabId, 'a');
  const closed = run(s, close('a'));
  assert.equal(workspaceIdOf(closed, closed.tabs.find(t => t.id === closed.activeTabId)!), work.id, 'a new tab of Work, not b or c');
  assert.equal(closed.tabs.some(t => t.id === 'b') && closed.tabs.some(t => t.id === 'c'), true);
  assert.notEqual(closed.activeTabId, 'b');
  assert.notEqual(closed.activeTabId, 'c');
});

test('in a workspace the previous tab of that workspace is picked, skipping another workspace\'s tabs in the trail', () => {
  let s = strip(['a', 'b', 'c', 'd']);
  s = run(s, { type: 'workspace.create', name: 'Work', tabs: 'current', tabId: 'c' });
  const work = s.workspaces.find(w => w.name === 'Work')!, main = s.workspaces.find(w => w.id !== work.id)!;
  // Work holds c and a new tab d... d stays in Main; put d in Work as well, visit c, d (Work) with Main's a, b in the trail between.
  s = run(s, { type: 'workspace.select', id: main.id }, select('a'), { type: 'workspace.select', id: work.id });
  s = run(s, { type: 'tab.new', url: 'https://w2.test/', workspaceId: work.id });
  const w2 = s.activeTabId;
  s = run(s, select('c'), select(w2), select('c'));
  assert.equal(run(s, close('c')).activeTabId, w2, 'the other tab of Work, though a (Main) was shown more recently');
});

test('closing several tabs together never lands on one of them', () => {
  // strip a b c d: the person is on a, c is closing with it, and b is the tab below. The batch is a and c: b, not c, is shown.
  const s = run(strip(['a', 'b', 'c', 'd']), select('c'), select('a'));
  const batch = run(s, { type: 'tab.close', id: 'a', soon: ['a', 'c'] });
  assert.equal(batch.activeTabId, 'b', 'c is the previous tab but is closing too');
  assert.equal(run(s, { type: 'tab.close', id: 'a', soon: ['a', 'b', 'c'] }).activeTabId, 'd', 'the tab below is closing as well: the first tab nobody closes');
  // Close the whole batch the way a group menu does: every close carries the batch.
  const all = run(s, ...['a', 'b', 'c'].map(id => ({ type: 'tab.close', id, soon: ['a', 'b', 'c'] }) as BrowserAction));
  assert.deepEqual(all.tabs.map(t => t.id), ['d']);
  assert.equal(all.activeTabId, 'd');
});

test('a split pane still closes to the other pane', () => {
  let s = run(strip(['a', 'b', 'c']), select('c'), select('a'), { type: 'split.open', tabIds: ['a', 'b'] });
  s = run(s, select('b'), close('b'));
  assert.equal(s.activeTabId, 'a');
});

test('closing the only tab of a workspace still opens a new tab there', () => {
  const s = run(strip(['a']), close('a'));
  assert.equal(s.tabs.length, 1);
  assert.notEqual(s.activeTabId, 'a');
});

test('closing a tab that is not on screen changes nothing on screen and drops it from the trail', () => {
  let s = run(strip(['a', 'b', 'c']), select('b'), select('c'));
  assert.deepEqual(s.windowUi.tabTrail, ['b', 'a']);
  s = run(s, close('b'));
  assert.equal(s.activeTabId, 'c');
  assert.deepEqual(s.windowUi.tabTrail, ['a']);
});

test('the trail is capped, has no duplicates, never lists the tab on screen and is not saved', () => {
  const ids = Array.from({ length: TRAIL_LIMIT + 10 }, (_, n) => 't' + n);
  let s = strip(ids);
  for (const id of ids.slice(1)) s = run(s, select(id));
  assert.equal(s.windowUi.tabTrail!.length, TRAIL_LIMIT);
  assert.equal(new Set(s.windowUi.tabTrail).size, TRAIL_LIMIT);
  assert.equal(s.windowUi.tabTrail!.includes(s.activeTabId), false);
  assert.equal(s.windowUi.tabTrail![0], ids.at(-2), 'the tab just left is first');
  const back = restoreSnapshot(JSON.parse(JSON.stringify(s)));
  assert.equal(back.windowUi.tabTrail, undefined, 'a restarted window has visited nothing');
  assert.deepEqual(trailAfter(s, s), s.windowUi.tabTrail);
});

test('a restored window picks an awake neighbour, then a sleeping ordinary tab: nothing was visited', () => {
  const saved = restoreSnapshot(JSON.parse(JSON.stringify(run(strip(['p', 'a', 'x', 'b'], { active: 'x', pinned: ['p'] }), select('a'), select('x')))));
  const s = { ...saved, tabs: saved.tabs.map(t => ({ ...t, sleeping: true })) };
  assert.equal(run(s, close('x')).activeTabId, 'b', 'below first, and the pinned tab last');
});

test('Unload on the tab on screen goes to an awake tab only', () => {
  let s = run(strip(['a', 'b', 'c'], { asleep: ['b'] }), select('b'), select('c'));
  const c = s.tabs.find(t => t.id === 'c')!;
  assert.equal(unloadLanding(s, c)?.id, 'a', 'b was visited but is asleep: it would have to load');
  s = strip(['a', 'b', 'c'], { active: 'a', asleep: ['b', 'c'] });
  assert.equal(unloadLanding(s, s.tabs[0]), undefined, 'every other tab is asleep: nothing to move to, so the row is not offered');
});

test('closeLanding is the reducer\'s choice', () => {
  const s = run(strip(['a', 'b', 'c', 'd']), select('d'), select('b'));
  const b = s.tabs.find(t => t.id === 'b') as TabSession;
  const without = { ...s, tabs: s.tabs.filter(t => t.id !== 'b') };
  assert.equal(closeLanding(s, without, b)?.id, 'd');
  assert.equal(run(s, close('b')).activeTabId, 'd');
});

test('ten tabs closed one after another walk back through the trail and end on the first tab', () => {
  const ids = Array.from({ length: 11 }, (_, n) => 't' + n);
  let s = strip(ids);
  for (const id of ids.slice(1)) s = run(s, select(id));
  const seen: string[] = [];
  for (let n = 0; n < 10; n++) { s = run(s, close(s.activeTabId)); seen.push(s.activeTabId); }
  assert.deepEqual(seen, ids.slice(0, 10).reverse(), 't10 closes to t9, t9 to t8 ... t1 to t0');
  assert.equal(s.tabs.length, 1);
  assert.equal(s.windowUi.tabTrail, undefined, 'an empty trail is not kept');
});

test('a big group closed with its soon list leaves the person on the tab shown before the group', () => {
  // d is the tab before the group; the group is a b c (a on screen). Every close carries the batch, so no close lands on a member.
  const s = run(strip(['a', 'b', 'c', 'd', 'e']), select('d'), select('c'), select('b'), select('a'));
  const batch = ['a', 'b', 'c'];
  const after = run(s, ...batch.map(id => ({ type: 'tab.close', id, soon: batch }) as BrowserAction));
  assert.deepEqual(after.tabs.map(t => t.id), ['d', 'e']);
  assert.equal(after.activeTabId, 'd', 'the tab shown before the group');
});

test('Unload keeps every row: tab.unloaded changes nothing but the trail (no duplicate or lost tab)', () => {
  const s = run(strip(['a', 'b', 'c']), select('c'), select('a'));
  const after = run(s, { type: 'tab.unloaded', ids: ['c'] });
  assert.deepEqual(after.tabs.map(t => t.id), s.tabs.map(t => t.id));
  assert.equal(after.activeTabId, s.activeTabId);
  assert.equal(after.windowUi.tabTrail, undefined, 'the unloaded tab left the trail, which is then empty');
});
