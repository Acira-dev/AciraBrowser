'use strict';
// Spaces and workspaces from another browser, placed as Acira workspaces (R4-48 P0-10, shared by Arc, Opera, Vivaldi and Zen).
// A source gives spaces: [{key, title, icon?, color?, pinned: [{url, title}], tabs: [{url, title}], groups: [{name, tabs}]}].
// The first spaces that fit become workspaces with the space's name, emoji and colour: its pinned tabs stay pinned, each group
// becomes a collapsed tab group inside it, and its other open tabs sit in it as they were. Past Acira's workspace limit a space
// falls back to one collapsed tab group. Nothing is opened: a tab is only state until it is shown (main makes a page for the
// active tab only), so nothing loads at import. Everything made is listed on the batch, so Undo removes exactly that.
const { arcTabGroups, nearestColor } = require('./import-arc.cjs');

/** One entry's tabs flattened, in the order they show: pinned, then the groups' tabs, then the rest. */
const everyTab = (space) => [...(space.pinned || []), ...(space.groups || []).flatMap((group) => group.tabs), ...(space.tabs || [])];

/** The first `room` spaces as workspaces (tabs capped at `limit` in all, loose tabs cut first), and the rest as flat spaces for tab groups.
 *  {workspaces, rest, left, skipped}: `skipped` counts the tabs of those workspaces the limit cut. */
function workspacesFrom(spaces, room, limit) {
  let left = limit;
  const take = (tabs) => {
    const kept = tabs.slice(0, Math.max(0, left));
    left -= kept.length;
    return kept;
  };
  const chosen = spaces.slice(0, Math.max(0, room));
  const workspaces = chosen.map((space) => {
    const pinned = take(space.pinned || []);
    const names = new Set(), groups = [], finalName = new Map(), parents = new Set((space.groups || []).map((group) => group.parent).filter(Boolean));
    for (const group of space.groups || []) {
      let name = String(group.name || 'Group').slice(0, 64);
      for (let n = 2; names.has(name); n++) name = String(group.name || 'Group').slice(0, 58) + ' ' + n;
      names.add(name);
      finalName.set(group.name, name);
      const tabs = take(group.tabs);
      // Beta 14, pinned folders: a group may be pinned (Zen's pinned folders) and may stand inside a parent group of the same space (one level)
      if (tabs.length || parents.has(group.name)) groups.push({ name, tabs, ...(group.pinned === true && !group.parent ? { pinned: true } : {}), ...(group.parent && finalName.has(group.parent) ? { parent: finalName.get(group.parent) } : {}) });
    }
    const tabs = take(space.tabs || []);
    return { key: space.key, title: space.title, ...(space.icon ? { icon: space.icon } : {}), ...(space.color ? { color: space.color } : {}), pinned, groups, tabs };
  });
  const kept = workspaces.reduce((sum, space) => sum + space.pinned.length + space.tabs.length + space.groups.reduce((n, group) => n + group.tabs.length, 0), 0);
  const rest = spaces.slice(Math.max(0, room)).map((space) => ({ id: space.key, title: space.title, tabs: everyTab(space) }));
  return { workspaces, rest, left, skipped: chosen.reduce((sum, space) => sum + everyTab(space).length, 0) - kept };
}

/** Puts `made` ({workspaces, rest, left, skipped} from workspacesFrom or Arc's arcWorkspaces) into `next` (a copy of the state) and lists
 *  what it made on `batch` (workspaceIds, groupIds, tabIds). `tag` names the source in a name that is already taken ("Work · Opera").
 *  Returns {workspaces, groups, tabs, skipped} for the batch's result row. */
function placeSpaces(next, { profileId, batch, made, tag, importedTab, randomUUID, workspaceColors, validWorkspaceIcon, groupsFor = arcTabGroups }) {
  batch.tabIds = [];
  batch.groupIds = [];
  batch.workspaceIds = [];
  next.tabGroups ||= [];
  next.workspaces ||= [];
  // The profile's own first workspace stays first (a tab without a stamp is its), so it exists before any space joins.
  let own = next.workspaces.filter((workspace) => workspace.browserProfileId === profileId);
  if (!own.length) {
    let id = profileId === 'profile-personal' ? 'workspace-default' : ('workspace-' + profileId).slice(0, 120);
    while (next.workspaces.some((workspace) => workspace.id === id)) id += '-new';
    next.workspaces.push({ id, name: '', browserProfileId: profileId });
    own = next.workspaces.filter((workspace) => workspace.browserProfileId === profileId);
  }
  const names = new Set(own.map((workspace) => (workspace.name || 'Main').toLowerCase()));
  for (const space of made.workspaces) {
    let name = space.title.slice(0, 40);
    if (names.has(name.toLowerCase())) name = space.title.slice(0, 34 - tag.length + 3) + ' · ' + tag;
    for (let n = 2; names.has(name.toLowerCase()); n++) name = space.title.slice(0, 34 - tag.length + 3) + ' ' + n;
    names.add(name.toLowerCase());
    const id = 'workspace-' + randomUUID(), color = nearestColor(space.color, workspaceColors);
    next.workspaces.push({ id, name, browserProfileId: profileId, ...(space.icon && validWorkspaceIcon(space.icon) ? { icon: space.icon } : {}), ...(color ? { color } : {}) });
    batch.workspaceIds.push(id);
    const put = (tab, extra) => {
      const tabId = 'tab-' + randomUUID();
      next.tabs.push({ ...importedTab(tabId, tab, profileId, extra.group || ''), ...(extra.pinned ? { pinned: true } : {}), workspaceId: id });
      batch.tabIds.push(tabId);
    };
    for (const tab of space.pinned) put(tab, { pinned: true });
    const groupIds = new Map();
    for (const group of space.groups) {
      const groupId = 'group-' + randomUUID();
      groupIds.set(group.name, groupId);
      next.tabGroups.push({ id: groupId, name: group.name, color: 'grey', collapsed: true, browserProfileId: profileId, workspaceId: id, ...(group.pinned === true ? { pinned: true } : {}), ...(group.parent && groupIds.has(group.parent) ? { parentGroupId: groupIds.get(group.parent) } : {}) });
      batch.groupIds.push(groupId);
      for (const tab of group.tabs) put(tab, { group: group.name });
    }
    for (const tab of space.tabs || []) put(tab, {});
  }
  const { groups, skipped } = groupsFor(made.rest, made.left);
  const taken = new Set(next.tabGroups.filter((group) => group.browserProfileId === profileId && !group.workspaceId).map((group) => group.name));
  for (const group of groups) {
    let name = group.name.slice(0, 64);
    if (taken.has(name)) name = group.name.slice(0, 58 - tag.length + 3) + ' · ' + tag;
    for (let n = 2; taken.has(name); n++) name = group.name.slice(0, 58) + ' ' + n;
    taken.add(name);
    const groupId = 'group-' + randomUUID();
    next.tabGroups.push({ id: groupId, name, color: group.color, collapsed: true, browserProfileId: profileId });
    batch.groupIds.push(groupId);
    for (const tab of group.tabs) {
      const tabId = 'tab-' + randomUUID();
      next.tabs.push(importedTab(tabId, tab, profileId, name));
      batch.tabIds.push(tabId);
    }
  }
  return { workspaces: made.workspaces.length, groups: groups.length, tabs: batch.tabIds.length, skipped: skipped + made.skipped };
}

module.exports = { everyTab, workspacesFrom, placeSpaces };
