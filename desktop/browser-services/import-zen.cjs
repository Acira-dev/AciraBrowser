'use strict';
// Zen Browser (Firefox underneath): its Spaces become Acira workspaces and its Essentials (the small always-visible tiles)
// become Acira Favorites. The profile folder is the one that holds places.sqlite; it is only ever read.
//
// Where Zen keeps them (format notes follow Zen's public source, github.com/zen-browser/desktop, dev branch):
//  - zen-sessions.jsonlz4 (src/zen/sessionstore/ZenSessionManager.sys.mjs, FILE_NAME) is Zen's own sidebar store, a JSONFile
//    with LZ4 compression: {spaces, tabs, folders, groups, splitViewData, lastCollected}. `tabs` is every tab of every space;
//    each carries Zen's own fields next to Firefox's (src/browser/components/sessionstore/TabState-sys-mjs.patch):
//    zenWorkspace (owning space uuid), zenSyncId, zenEssential (essentials are also pinned), zenIsEmpty (placeholder),
//    zenStaticLabel (a name the person gave the tab), _zenPinnedInitialState ({entry:{url,title}}: the address a pin
//    resets to) and, from Firefox, entries/index (1-based)/pinned/hidden/groupId. `folders` (ZenFolders.mjs,
//    storeDataForSessionStore) holds {id, name, parentId, collapsed, pinned, workspaceId, splitViewGroup}; a tab belongs to a
//    folder when its groupId is the folder's id, and folders nest through parentId.
//  - sessionstore-backups/recovery.jsonlz4 and sessionstore.jsonlz4 are Firefox's own session files: {windows:[{tabs, spaces,
//    folders, groups}]}. Zen adds the same zen* fields to those tabs and writes the spaces into each window.
//  - Older Zen kept the definitions in places.sqlite (zen_workspaces, zen_pins); the session manager only reads those tables
//    when the session file has no spaces ("running migration"), so they are stale once a session file has spaces. This module
//    treats them the same way: they are read only when no session source defines a space.
// What was not tested against a real Zen profile: the privacy rules of this work forbid reading one, so the shapes above come
// from the source, and the tests build fixtures in the same shape.
const fs = require('node:fs'), path = require('node:path');
const { readJsonLz4 } = require('./import-mozlz4.cjs');
const { readDatabase } = require('./import-snapshot.cjs');

const SESSIONS = 'zen-sessions.jsonlz4';
const RECOVERY = 'sessionstore-backups/recovery.jsonlz4';
const SESSIONSTORE = 'sessionstore.jsonlz4';
const PLACES = 'places.sqlite';
const MAX_SPACES = 64;
const MAX_TABS = 5000;
const MAX_TEXT = 2048;
// Never walk more than this many raw tab entries, windows or folders: a damaged or hostile file cannot keep the import busy.
const MAX_RAW = 50000;
const MAX_WINDOWS = 32;
const MAX_FOLDER_DEPTH = 16;
// Where a tab came from; when the same tab (by zenSyncId) shows up in two tiers the lower tier wins.
const TIER_SESSIONS = 0, TIER_RECOVERY = 1, TIER_SESSIONSTORE = 2, TIER_LEGACY = 3;

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const truthy = (value) => value === true || value === 1 || value === '1' || value === 'true';
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** A string with control characters turned into spaces, trimmed and cut to `limit`; anything that is not a string is ''. */
function text(value, limit = MAX_TEXT) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').trim().slice(0, limit) : '';
}

/** An id as a short string (session ids are strings, but a number is accepted); '' for anything else. */
function idText(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return text(value, 200);
}

/** The normalised address when `value` is an http(s) URL without credentials and short enough to keep, else null. */
function webURL(value) {
  if (typeof value !== 'string' || value.length > MAX_TEXT) return null;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && url.href.length <= MAX_TEXT ? url.href : null;
  } catch {
    return null;
  }
}

/** A readable name for a page without a title: its host, without "www.". */
function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** A list from a JSON value, at most `limit` items long ([] for anything that is not an array). */
const items = (value, limit = MAX_RAW) => (Array.isArray(value) ? value.slice(0, limit) : []);

/** A CSS colour or an [r, g, b] array as #rrggbb, or null when it is neither (hex #rgb / #rrggbb / #rrggbbaa and rgb()/rgba()). */
function hexColor(value) {
  const hex = (channels) => '#' + channels.map((channel) => Math.round(channel).toString(16).padStart(2, '0')).join('');
  const inRange = (channels) => channels.length >= 3 && channels.slice(0, 3).every((channel) => Number.isFinite(channel) && channel >= 0 && channel <= 255);
  if (Array.isArray(value)) return inRange(value) ? hex(value.slice(0, 3)) : null;
  if (typeof value !== 'string') return null;
  const css = value.trim();
  let match = /^#([0-9a-f]{3})$/i.exec(css);
  if (match) return '#' + [...match[1]].map((digit) => digit + digit).join('').toLowerCase();
  match = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(css);
  if (match) return '#' + match[1].toLowerCase();
  match = /^rgba?\(\s*([\d.]+)\s*[,\s]\s*([\d.]+)\s*[,\s]\s*([\d.]+)\s*(?:[,/]\s*[\d.]+%?\s*)?\)$/i.exec(css);
  if (match) {
    const channels = match.slice(1, 4).map(Number);
    return inRange(channels) ? hex(channels) : null;
  }
  return null;
}

/** A space's theme colour as #rrggbb: the primary entry of `theme.gradientColors` when it has a usable colour, else the first
 *  usable one. Entries are css strings or Zen's {c: [r, g, b] | css string, isPrimary, isCustom, algorithm}. */
function spaceColor(theme) {
  const colors = isObject(theme) ? items(theme.gradientColors, 64) : [];
  const read = (entry) => (isObject(entry) ? hexColor(entry.c ?? entry.color) : hexColor(entry));
  const primary = colors.find((entry) => isObject(entry) && entry.isPrimary === true && read(entry));
  if (primary) return read(primary);
  for (const entry of colors) {
    const color = read(entry);
    if (color) return color;
  }
  return undefined;
}

/** A space's icon when it is one emoji or one letter/number (Zen can also store an svg path or an icon name: those are left
 *  out, Acira picks its own). At most 16 characters. */
function spaceIcon(value) {
  if (typeof value !== 'string') return undefined;
  const icon = value.trim();
  if (!icon || icon.length > 16) return undefined;
  if ([...graphemes.segment(icon)].length !== 1) return undefined;
  return /[\p{Extended_Pictographic}\p{Regional_Indicator}\p{L}\p{N}]/u.test(icon) ? icon : undefined;
}

/** The space definitions from raw {uuid, name, icon, position, theme} objects: unique by uuid, at most 64, in `position`
 *  order when every space has one (the session file keeps them in order already), named "Space N" when unnamed. */
function normalizeSpaces(raw) {
  const spaces = [], seen = new Set();
  for (const space of raw) {
    if (!isObject(space)) continue;
    const key = idText(space.uuid ?? space.id);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    spaces.push({ key, name: text(space.name, 80), icon: spaceIcon(space.icon), color: spaceColor(space.theme), position: Number.isFinite(space.position) ? space.position : null });
    if (spaces.length >= MAX_SPACES) break;
  }
  if (spaces.length > 1 && spaces.every((space) => space.position !== null)) spaces.sort((a, b) => a.position - b.position);
  spaces.forEach((space, index) => {
    space.title = space.name || `Space ${index + 1}`;
  });
  return spaces;
}

/** The entry a tab is showing: `entries[index - 1]` (index is 1-based), clamped into range; the last entry when the index is
 *  missing or the entry there has no address. Null when the tab has no usable entry. */
function currentEntry(tab) {
  const entries = Array.isArray(tab.entries) ? tab.entries : [];
  if (!entries.length) return null;
  const index = Number.isInteger(tab.index) ? Math.min(Math.max(tab.index, 1), entries.length) : entries.length;
  const usable = (entry) => isObject(entry) && typeof entry.url === 'string' && entry.url !== '';
  if (usable(entries[index - 1])) return entries[index - 1];
  return usable(entries[entries.length - 1]) ? entries[entries.length - 1] : null;
}

/** One session tab as a placement candidate, or null for a placeholder (zenIsEmpty) and a tab with no address at all.
 *  The address is the current history entry; for a pinned tab or an essential it is the pin's own address when Zen kept
 *  one (_zenPinnedInitialState), because that is what the pin is, not the page it was last browsed to. The title is the
 *  name the person gave the tab (zenStaticLabel), else the entry's title, else the tab's `label`. */
function sessionCandidate(tab, tier) {
  if (!isObject(tab) || truthy(tab.zenIsEmpty)) return null;
  const essential = truthy(tab.zenEssential), pinned = essential || truthy(tab.pinned);
  const pin = isObject(tab._zenPinnedInitialState) ? tab._zenPinnedInitialState.entry : null;
  const options = [];
  if (pinned && isObject(pin) && typeof pin.url === 'string' && pin.url) options.push(pin);
  const current = currentEntry(tab);
  if (current) options.push(current);
  if (!options.length) return null;
  const entry = options.find((option) => webURL(option.url)) || options[0];
  return {
    syncId: idText(tab.zenSyncId) || idText(tab.zenPinnedId) || null,
    url: entry.url,
    title: text(tab.zenStaticLabel) || text(entry.title) || text(tab.label),
    space: idText(tab.zenWorkspace) || null,
    essential,
    pinned,
    groupId: idText(tab.groupId) || null,
    active: tab._zenIsActiveTab === true,
    tier,
  };
}

/** Records a folder or tab group in `containers` ({id, name, parentId, split}); a second record for the same id (Zen lists a
 *  folder in both `folders` and `groups`) only fills in what the first lacked. Split-view groups are not folders. */
function addContainer(containers, raw) {
  if (!isObject(raw) || containers.size >= MAX_RAW) return;
  const id = idText(raw.id);
  if (!id) return;
  const known = containers.get(id) || { id, name: '', parentId: null, split: false, pinned: false };
  known.name = known.name || text(raw.name ?? raw.label, 64);
  known.parentId = known.parentId || idText(raw.parentId) || null;
  known.split = known.split || raw.splitViewGroup === true || raw.splitView === true;
  known.pinned = known.pinned || raw.pinned === true || raw.isPinned === true;
  containers.set(id, known);
}

/** The top-level folder a container belongs to: itself or its outermost non-split ancestor (nested folders flatten into the
 *  folder at the top). Null when the id is unknown or only split-view groups lead to it. */
function topFolder(containers, id) {
  let node = containers.get(id), top = null;
  for (let depth = 0; node && depth < MAX_FOLDER_DEPTH; depth++) {
    if (!node.split) top = node;
    node = node.parentId ? containers.get(node.parentId) : null;
  }
  return top;
}

/** The non-split folders from the top one down to the container (Beta 14, pinned folders: the first nest level is kept as an inner folder, deeper ones flatten into it). */
function folderChain(containers, id) {
  const chain = [];
  let node = containers.get(id);
  for (let depth = 0; node && depth < MAX_FOLDER_DEPTH; depth++) {
    if (!node.split) chain.unshift(node);
    node = node.parentId ? containers.get(node.parentId) : null;
  }
  return chain.slice(0, 2);
}

/** Reads `relative` (a path inside the profile, "/"-separated) as jsonlz4 JSON. Null when the file is absent; when it exists
 *  but cannot be decoded, or is not a JSON object, its name goes into `unreadable` and null comes back. */
function loadState(location, relative, unreadable) {
  const file = path.join(location, ...relative.split('/'));
  if (!fs.existsSync(file)) return null;
  try {
    const data = readJsonLz4(file);
    if (!isObject(data)) throw new Error('not an object');
    return data;
  } catch {
    unreadable.push(relative);
    return null;
  }
}

/** The windows of a Firefox session file that hold the person's own tabs: popups, taskbar tabs, private windows and Zen's
 *  unsynced windows are left out. */
function sessionWindows(state) {
  return items(state && state.windows, MAX_WINDOWS).filter((win) => isObject(win) && !truthy(win.isPopup) && !truthy(win.isTaskbarTab) && !truthy(win.isPrivate) && !truthy(win.isZenUnsynced));
}

/** The legacy tables of places.sqlite as {spaces: rows, pins: rows}. A table that is absent gives no rows; a database that
 *  cannot be opened puts places.sqlite into `unreadable`. Null when there is no places.sqlite. */
function readLegacyTables(location, unreadable) {
  if (!fs.existsSync(path.join(location, PLACES))) return null;
  try {
    return readDatabase(location, PLACES, (database) => {
      const has = (table) => database.prepare(`PRAGMA table_info(${table})`).all().length > 0;
      return {
        spaces: has('zen_workspaces') ? database.prepare('SELECT * FROM zen_workspaces LIMIT 1000').all() : [],
        pins: has('zen_pins') ? database.prepare('SELECT * FROM zen_pins LIMIT ' + MAX_RAW).all() : [],
      };
    });
  } catch {
    unreadable.push(PLACES);
    return null;
  }
}

/** Rows ordered by `position` (rows without one last), keeping the database order among equals. */
const byPosition = (rows) => rows.map((row, index) => ({ row, index })).sort((a, b) => (Number.isFinite(a.row.position) ? a.row.position : Infinity) - (Number.isFinite(b.row.position) ? b.row.position : Infinity) || a.index - b.index).map((entry) => entry.row);

/** Legacy zen_workspaces rows as raw space objects (theme_colors is a JSON array stored as text). */
function legacySpaces(rows) {
  return byPosition(rows.filter(isObject)).map((row) => {
    let colors = [];
    try {
      colors = JSON.parse(row.theme_colors);
    } catch {}
    return { uuid: row.uuid, name: row.name, icon: row.icon, position: row.position, theme: { gradientColors: Array.isArray(colors) ? colors : [] } };
  });
}

/** Legacy zen_pins rows: folders (is_group) into `containers`, the rest as candidates. Every pin is a pinned tab; is_essential
 *  ones are essentials. A pin's uuid is the zenSyncId of the tab Zen made from it. */
function legacyCandidates(rows, containers) {
  const out = [];
  for (const row of byPosition(rows.filter(isObject))) {
    const uuid = idText(row.uuid);
    if (truthy(row.is_group)) {
      addContainer(containers, { id: uuid, name: row.title, parentId: row.folder_parent_uuid });
      continue;
    }
    if (typeof row.url !== 'string' || !row.url) continue;
    out.push({ syncId: uuid || null, url: row.url, title: text(row.title), space: idText(row.workspace_uuid) || null, essential: truthy(row.is_essential), pinned: true, groupId: idText(row.folder_parent_uuid) || null, active: false, tier: TIER_LEGACY });
  }
  return out;
}

/** One candidate per zenSyncId: the lowest tier wins; within a tier (the same tab in two windows) a copy that has a web address
 *  beats one that has not, then the copy Zen marks as the live one. Candidates without a zenSyncId all stay. */
function dedupeBySyncId(candidates) {
  const at = new Map(), out = [];
  for (const candidate of candidates) {
    if (!candidate.syncId) {
      out.push(candidate);
      continue;
    }
    const index = at.get(candidate.syncId);
    if (index === undefined) {
      at.set(candidate.syncId, out.length);
      out.push(candidate);
      continue;
    }
    const kept = out[index], hasWeb = (value) => Boolean(webURL(value.url));
    if (kept.tier === candidate.tier && ((hasWeb(candidate) && !hasWeb(kept)) || (hasWeb(candidate) === hasWeb(kept) && candidate.active && !kept.active))) out[index] = candidate;
  }
  return out;
}

/** Puts the candidates in their places. Essentials (deduped by address) go to `essentials`; every other tab goes to the space
 *  named by its zenWorkspace (an unknown or missing one: the first space, or a "Zen" space when no space is defined). Pinned
 *  tabs outside folders are `pinned`, tabs inside a folder or group are in `groups` (named for the top-level folder), the rest
 *  are `tabs`. Spaces without any tab are dropped unless one is all there is. */
function place(definitions, candidates, containers) {
  const result = { spaces: [], essentials: [], skippedNotWeb: 0 };
  const buckets = new Map(), order = [];
  const open = (key, title, icon, color) => {
    const bucket = { key, title, icon, color, pinned: [], tabs: [], groups: new Map(), seen: new Set() };
    buckets.set(key, bucket);
    order.push(bucket);
    return bucket;
  };
  for (const space of definitions) open(space.key, space.title, space.icon, space.color);
  const bucketFor = (id) => buckets.get(id) || order[0] || open('zen', 'Zen');
  const essentialUrls = new Set();
  let total = 0;
  for (const candidate of candidates) {
    if (total >= MAX_TABS) break;
    const url = webURL(candidate.url);
    if (!url) {
      result.skippedNotWeb++;
      continue;
    }
    const tab = { url, title: candidate.title || hostOf(url) };
    if (candidate.essential) {
      if (essentialUrls.has(url)) continue;
      essentialUrls.add(url);
      result.essentials.push(tab);
      total++;
      continue;
    }
    const bucket = bucketFor(candidate.space);
    const chain = candidate.groupId ? folderChain(containers, candidate.groupId) : [], folder = chain[0] || null, level = chain[1] || null;
    const section = folder ? 'group:' + (level || folder).id : candidate.pinned ? 'pinned' : 'tab';
    const mark = section + '\n' + url;
    if (bucket.seen.has(mark)) continue;
    bucket.seen.add(mark);
    if (folder) {
      if (!bucket.groups.has(folder.id)) bucket.groups.set(folder.id, { name: folder.name || 'Folder', tabs: [] });
      const top = bucket.groups.get(folder.id);
      // a folder pinned in Zen (or holding a pinned tab) is a pinned folder here
      if (folder.pinned || candidate.pinned) top.pinned = true;
      if (level) {
        if (!bucket.groups.has(level.id)) bucket.groups.set(level.id, { name: level.name || 'Folder', tabs: [], parent: top.name });
        bucket.groups.get(level.id).tabs.push(tab);
      } else top.tabs.push(tab);
    } else if (candidate.pinned) {
      bucket.pinned.push(tab);
    } else {
      bucket.tabs.push(tab);
    }
    total++;
  }
  const filled = (bucket) => bucket.pinned.length + bucket.tabs.length + bucket.groups.size > 0;
  for (const bucket of order.length === 1 ? order : order.filter(filled)) {
    result.spaces.push({
      key: bucket.key,
      title: bucket.title,
      ...(bucket.icon ? { icon: bucket.icon } : {}),
      ...(bucket.color ? { color: bucket.color } : {}),
      pinned: bucket.pinned,
      tabs: bucket.tabs,
      groups: [...bucket.groups.values()],
    });
  }
  return result;
}

/** What `readZen` does, free to throw (readZen turns that into an empty answer). */
function collect(location) {
  const unreadable = [], states = [], rawSpaces = [], candidates = [], containers = new Map();
  const sessions = loadState(location, SESSIONS, unreadable);
  if (sessions) states.push({ tier: TIER_SESSIONS, state: sessions });
  // Firefox's own files fill in what zen-sessions.jsonlz4 lacks. sessionstore.jsonlz4 is the snapshot of the last clean
  // shutdown, older than recovery.jsonlz4 whenever both exist, so it is only used when recovery gave no tabs.
  const recoveryWindows = sessionWindows(loadState(location, RECOVERY, unreadable));
  for (const win of recoveryWindows) states.push({ tier: TIER_RECOVERY, state: win });
  if (!recoveryWindows.some((win) => items(win.tabs, 1).length)) {
    for (const win of sessionWindows(loadState(location, SESSIONSTORE, unreadable))) states.push({ tier: TIER_SESSIONSTORE, state: win });
  }
  let sessionData = false;
  for (const { tier, state } of states) {
    const spaces = items(state.spaces, MAX_SPACES * 4), tabs = items(state.tabs);
    if (spaces.length || tabs.length) sessionData = true;
    rawSpaces.push(...spaces);
    for (const folder of items(state.folders)) addContainer(containers, folder);
    for (const group of items(state.groups)) addContainer(containers, group);
    for (const tab of tabs) {
      const candidate = sessionCandidate(tab, tier);
      if (candidate && candidates.length < MAX_RAW) candidates.push(candidate);
    }
  }
  let definitions = normalizeSpaces(rawSpaces), legacyData = false;
  // No session source defines a space: Zen itself would fall back to the old tables, so this does too.
  if (!definitions.length) {
    const legacy = readLegacyTables(location, unreadable);
    if (legacy && (legacy.spaces.length || legacy.pins.length)) {
      definitions = normalizeSpaces(legacySpaces(legacy.spaces));
      candidates.push(...legacyCandidates(legacy.pins, containers));
      legacyData = definitions.length > 0 || legacy.pins.length > 0;
    }
  }
  const placed = place(definitions, dedupeBySyncId(candidates), containers);
  return {
    spaces: placed.spaces,
    essentials: placed.essentials,
    skipped: { notWeb: placed.skippedNotWeb },
    read: { sessions: sessionData, legacy: legacyData },
    unreadable,
  };
}

/** The Spaces and Essentials of the Zen profile folder `location` (the folder with places.sqlite), read-only:
 *  {spaces: [{key, title, icon?, color?, pinned: [{url, title}], tabs: [{url, title}], groups: [{name, tabs}]}],
 *   essentials: [{url, title}], skipped: {notWeb}, read: {sessions, legacy}, unreadable: [file names]}.
 *  Only http(s) addresses without credentials are kept (the rest are counted in skipped.notWeb); at most 64 spaces and 5000
 *  tabs. Never throws: a file that cannot be decoded is listed in `unreadable` and the others are still used. */
function readZen(location) {
  const empty = { spaces: [], essentials: [], skipped: { notWeb: 0 }, read: { sessions: false, legacy: false }, unreadable: [] };
  if (typeof location !== 'string' || !location) return empty;
  try {
    return collect(location);
  } catch {
    // A bug or an odd file shape must not break discovery or import: report what is there as unreadable.
    const there = zenLocations(location);
    return { ...empty, unreadable: [there.sessions && SESSIONS, there.recovery && RECOVERY, there.legacy && PLACES].filter(Boolean) };
  }
}

/** Which Zen data files a profile folder has, by file name only (nothing is read): {sessions: zen-sessions.jsonlz4,
 *  recovery: Firefox's session file, legacy: places.sqlite (which may hold the old zen_workspaces / zen_pins tables)}.
 *  Every Firefox profile has recovery and legacy files, so `sessions` is the one that says "this profile has Zen Spaces". */
function zenLocations(location) {
  const has = (...parts) => {
    try {
      return fs.existsSync(path.join(location, ...parts));
    } catch {
      return false;
    }
  };
  return {
    sessions: has(SESSIONS),
    recovery: has('sessionstore-backups', 'recovery.jsonlz4') || has(SESSIONSTORE),
    legacy: has(PLACES),
  };
}

module.exports = { readZen, zenLocations };
