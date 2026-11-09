import assert from 'node:assert/strict';
import test from 'node:test';
import { createInitialState, makeTab, persistedSnapshot, reduceBrowser, restoreSnapshot } from '../src/runtime/core';
import { scopeToWorkspace, workspaceIdOf } from '../src/runtime/workspaces';
import { groupForTab } from '../src/runtime/tabGroups';
import { appClickPlan } from '../src/ui/sidebarApps';
import type { BrowserAction, BrowserSnapshot } from '../src/runtime/types';

// 13.4 (favorites across Spaces): a seeded random walk over three Spaces and two favorites, so the order of tile clicks, Space switches,
// closes, moves, splits, restores and saves is not the one a hand-written test happens to try. After EVERY step: one tab per favorite
// per profile, no duplicate tab, the Space on screen is the active tab's, every tab sits in a real Space of its profile, a split lives in
// one Space, and a save + restore gives the same tabs in the same Spaces. The tile click mirrors AciraSidebar.tsx openApp (the source
// test in sidebar-app-click.test.ts pins its dispatches); some clicks are planned from a stale view of the window, as a click that races
// the snapshot is.
const apps = [{ id: 'app-a', url: 'https://a.test/', title: 'A' }, { id: 'app-b', url: 'https://b.test/', title: 'B' }];
const run = (state: BrowserSnapshot, ...actions: BrowserAction[]) => actions.reduce(reduceBrowser, state);
function rng(seed: number) { return () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function start(): BrowserSnapshot {
  const base = createInitialState(), profile = base.activeBrowserProfileId;
  let state = run({ ...base, tabs: ['t1', 't2', 't3'].map(id => makeTab(id, '', `https://${id}.test/`, profile)), activeTabId: 't1' }, { type: 'ui.update', patch: {} });
  state = run(state, { type: 'workspace.create', name: 'Work' }, { type: 'workspace.create', name: 'Play' });
  return state;
}

/** The tile's click, as the sidebar runs it, planned from `seen` (the view the person saw) and sent to `state` (the window now). */
function click(state: BrowserSnapshot, app: typeof apps[number], seen: BrowserSnapshot = state): BrowserSnapshot {
  const scoped = scopeToWorkspace(seen), scope = [...scoped.tabs, ...(scoped.otherWorkspaceTabs ?? [])], profile = seen.activeBrowserProfileId;
  const plan = appClickPlan({ button: 0 }, app, scope, seen.activeTabId, profile);
  switch (plan.kind) {
    case 'open': return run(state, { type: 'tab.new', url: app.url, browserProfileId: profile, favoriteId: app.id });
    case 'select': return run(state, { type: 'tab.select', id: plan.tabId, here: true });
    case 'adopt': { const linked = run(state, { type: 'tab.favorite', id: plan.tabId, favoriteId: app.id }); return plan.select ? run(linked, { type: 'tab.select', id: plan.tabId, here: true }) : linked; }
    case 'home': return run(state, { type: 'tab.navigate', url: app.url, tabId: plan.tabId });
    default: return state;
  }
}

function violations(state: BrowserSnapshot): string[] {
  const out: string[] = [], ids = state.tabs.map(tab => tab.id);
  if (new Set(ids).size !== ids.length) out.push('duplicate tab ids');
  const owners = new Map<string, number>();
  for (const tab of state.tabs) if (tab.favoriteId) { const key = tab.browserProfileId + '\n' + tab.favoriteId; owners.set(key, (owners.get(key) ?? 0) + 1); }
  for (const [key, count] of owners) if (count > 1) out.push(`${count} tabs for favorite ${key.split('\n')[1]}`);
  const active = state.tabs.find(tab => tab.id === state.activeTabId);
  if (!active) { out.push('no active tab'); return out; }
  if (state.activeWorkspaceId !== workspaceIdOf(state, active)) out.push(`Space on screen ${state.activeWorkspaceId} is not the active tab's ${workspaceIdOf(state, active)}`);
  for (const tab of state.tabs) {
    const space = state.workspaces.find(workspace => workspace.id === workspaceIdOf(state, tab));
    if (!space || space.browserProfileId !== tab.browserProfileId) out.push(`tab ${tab.id} is in no Space of its profile`);
    if (tab.group && !groupForTab(state, tab)) out.push(`tab ${tab.id} names a group that is not in its Space`);
  }
  const spaceOf = (id: string) => { const tab = state.tabs.find(item => item.id === id); return tab ? workspaceIdOf(state, tab) : undefined; };
  for (const split of [...(state.windowUi.splitGroups ?? []), ...(state.windowUi.split ? [state.windowUi.split] : [])]) {
    const ids2 = (split as { tabIds: string[] }).tabIds, spaces = new Set(ids2.map(spaceOf));
    if (spaces.has(undefined)) out.push('a split names a tab that is gone'); else if (spaces.size > 1) out.push('a split spans two Spaces');
  }
  for (const [space, id] of Object.entries(state.windowUi.lastTabs ?? {})) if (spaceOf(id) !== space) out.push(`remembered tab ${id} of ${space} is elsewhere`);
  return out;
}

const shape = (state: BrowserSnapshot) => state.tabs.map(tab => `${tab.id}|${workspaceIdOf(state, tab)}|${tab.favoriteId ?? ''}|${tab.pinned ? 'p' : ''}`).sort().join(';') + '#' + state.activeTabId + '#' + state.activeWorkspaceId;

function walk(seed: number, steps: number): { log: string[]; problem?: string } {
  const random = rng(seed), pick = <T,>(list: readonly T[]): T => list[Math.floor(random() * list.length)];
  let state = start(), recent: BrowserSnapshot[] = [state];
  const log: string[] = [];
  for (let step = 0; step < steps; step++) {
    const spaces = state.workspaces.filter(workspace => workspace.browserProfileId === state.activeBrowserProfileId);
    const tabs = state.tabs.filter(tab => tab.browserProfileId === state.activeBrowserProfileId);
    const roll = random();
    let label: string, next = state;
    if (roll < 0.34) { const app = pick(apps); label = `click ${app.id}`; next = click(state, app); }
    else if (roll < 0.42) { const app = pick(apps), seen = pick(recent); label = `stale click ${app.id}`; next = click(state, app, seen); }
    else if (roll < 0.58) { const space = pick(spaces); label = `workspace.select ${space.id.slice(-4)}`; next = run(state, { type: 'workspace.select', id: space.id }); }
    else if (roll < 0.64) { const tab = pick(tabs); label = `tab.close ${tab.id}`; next = run(state, { type: 'tab.close', id: tab.id }); }
    else if (roll < 0.68) { label = 'tab.new'; next = run(state, { type: 'tab.new', url: `https://n${step}.test/` }); }
    else if (roll < 0.72) { const tab = pick(tabs); label = `tab.pin ${tab.id}`; next = run(state, { type: 'tab.pin', id: tab.id }); }
    else if (roll < 0.75) { const tab = pick(tabs); label = `tab.group.create ${tab.id}`; next = run(state, { type: 'tab.group.create', tabId: tab.id, name: 'G' + Math.floor(random() * 2) }); }
    else if (roll < 0.79) { const tab = pick(tabs), space = pick(spaces); label = `move ${tab.id} -> ${space.id.slice(-4)}`; next = run(state, { type: 'workspace.move-tabs', tabIds: [tab.id], workspaceId: space.id }); }
    else if (roll < 0.82) { const mine = scopeToWorkspace(state).tabs.filter(tab => !tab.pinned); if (mine.length > 1) { const a = pick(mine), b = pick(mine.filter(tab => tab.id !== a.id)); label = `split ${a.id} ${b.id}`; next = run(state, { type: 'split.open', tabIds: [a.id, b.id] }); } else label = 'noop'; }
    else if (roll < 0.85) { const tab = pick(tabs), app = pick(apps); label = `tab.favorite ${tab.id} ${app.id}`; next = run(state, { type: 'tab.favorite', id: tab.id, favoriteId: random() < 0.8 ? app.id : null }); }
    else if (roll < 0.89) { label = 'tab.restore'; next = run(state, { type: 'tab.restore' }); }
    else if (roll < 0.93) { const tab = pick(tabs); label = `plain tab.select ${tab.id}`; next = run(state, { type: 'tab.select', id: tab.id }); }
    else if (roll < 0.97) { label = 'save and restore'; next = restoreSnapshot(JSON.parse(JSON.stringify(persistedSnapshot(state)))); if (shape(next) !== shape(state)) { log.push(label); return { log, problem: `a restart changed the window:\n  ${shape(state)}\n  ${shape(next)}` }; } }
    else { label = `close the active tab ${state.activeTabId}`; next = run(state, { type: 'tab.close', id: state.activeTabId }); }
    log.push(label);
    state = next; recent = [...recent.slice(-5), state];
    const bad = violations(state);
    if (bad.length) return { log, problem: bad.join('; ') };
  }
  return { log };
}

test('favorites across three Spaces: a seeded random walk keeps one tab per favorite, the Space on screen, and a faithful save', () => {
  for (let seed = 1; seed <= 150; seed++) {
    const { log, problem } = walk(seed, 70);
    assert.equal(problem, undefined, `seed ${seed}, after step ${log.length}: ${problem}\n${log.slice(-12).join('\n')}`);
  }
});

test('a tile click never changes the Space on screen, wherever the favorite\'s tab is: here, in another Space, or not open yet', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const random = rng(seed * 7919), pick = <T,>(list: readonly T[]): T => list[Math.floor(random() * list.length)];
    let state = start();
    for (let step = 0; step < 40; step++) {
      if (random() < 0.45) { state = run(state, { type: 'workspace.select', id: pick(state.workspaces).id }); continue; }
      const before = state.activeWorkspaceId, app = pick(apps), next = click(state, app);
      assert.equal(next.activeWorkspaceId, before, `seed ${seed} step ${step}: clicking ${app.id} switched the Space`);
      state = next;
    }
  }
});
