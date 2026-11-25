'use strict';
// Opera, Opera GX and Vivaldi: Chromium browsers whose profiles are read by the Chromium importer (Bookmarks, History,
// Favicons, Preferences, Extensions are Chrome's own formats) plus what is theirs alone:
//   Opera / GX  - workspaces (named in Preferences, ui.workspaces.config; each open tab's workspace is in its session data),
//                 open tabs (Sessions/Session_*), speed dial (a root inside Bookmarks).
//   Vivaldi     - workspaces (Preferences, vivaldi.workspaces.list), tab stacks and a tab's workspace (the tab's vivExtData,
//                 in the session data), speed dial (Bookmarks folders marked meta_info.Speeddial).
// Everything is read, never written. What each browser keeps for itself under names it has not published (the key a tab's
// workspace is stored under) is found by looking for what it must hold, and when that cannot be found the tabs still come over,
// in one group, and the import says so (`notes`). Nothing here asks the system for anything.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { readSessionTabs } = require('./import-snss.cjs');

const MAX_FAVORITES = 24;
const MAX_TABS = 2000;
const MAX_JSON = 32e6;

/** Opera's folders. Opera keeps its profile straight in the folder (older builds) or in Default/Profile N inside it (newer ones). */
function operaRoots(platform, home, env) {
  if (platform === 'win32') {
    const roaming = env.APPDATA || path.join(home, 'AppData', 'Roaming');
    const at = (...parts) => path.join(roaming, 'Opera Software', ...parts);
    return [
      { browser: 'Opera', channel: 'Stable', root: at('Opera Stable') },
      { browser: 'Opera', channel: 'Beta', root: at('Opera Beta') },
      { browser: 'Opera', channel: 'Developer', root: at('Opera Developer') },
      { browser: 'Opera', channel: 'Air', root: at('Opera Air Stable') },
      { browser: 'Opera GX', channel: 'Stable', root: at('Opera GX Stable') },
      { browser: 'Opera GX', channel: 'Beta', root: at('Opera GX Beta') },
    ].map((entry) => ({ ...entry, flavor: 'opera' }));
  }
  if (platform === 'darwin') {
    const base = path.join(home, 'Library', 'Application Support');
    const at = (name) => path.join(base, name);
    return [
      { browser: 'Opera', channel: 'Stable', root: at('com.operasoftware.Opera') },
      { browser: 'Opera', channel: 'Beta', root: at('com.operasoftware.OperaBeta') },
      { browser: 'Opera', channel: 'Beta', root: at('com.operasoftware.OperaNext') },
      { browser: 'Opera', channel: 'Developer', root: at('com.operasoftware.OperaDeveloper') },
      { browser: 'Opera', channel: 'Air', root: at('com.operasoftware.OperaAir') },
      { browser: 'Opera GX', channel: 'Stable', root: at('com.operasoftware.OperaGX') },
    ].map((entry) => ({ ...entry, flavor: 'opera' }));
  }
  const base = env.XDG_CONFIG_HOME || path.join(home, '.config');
  return [
    { browser: 'Opera', channel: 'Stable', root: path.join(base, 'opera') },
    { browser: 'Opera', channel: 'Beta', root: path.join(base, 'opera-beta') },
    { browser: 'Opera', channel: 'Developer', root: path.join(base, 'opera-developer') },
    // Flatpak and Snap keep their own copy of the configuration folder.
    { browser: 'Opera', channel: 'Stable', root: path.join(home, '.var', 'app', 'com.opera.Opera', 'config', 'opera') },
    { browser: 'Opera', channel: 'Stable', root: path.join(home, 'snap', 'opera', 'current', '.config', 'opera') },
  ].map((entry) => ({ ...entry, flavor: 'opera' }));
}

/** Vivaldi's folders: a normal Chromium user-data folder (Default, Profile 1, ...). */
function vivaldiRoots(platform, home, env) {
  if (platform === 'win32') return [{ browser: 'Vivaldi', channel: 'Stable', root: path.join(env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Vivaldi', 'User Data'), flavor: 'vivaldi' }];
  if (platform === 'darwin') return [{ browser: 'Vivaldi', channel: 'Stable', root: path.join(home, 'Library', 'Application Support', 'Vivaldi'), flavor: 'vivaldi' }];
  const base = env.XDG_CONFIG_HOME || path.join(home, '.config');
  return [
    { browser: 'Vivaldi', channel: 'Stable', root: path.join(base, 'vivaldi'), flavor: 'vivaldi' },
    { browser: 'Vivaldi', channel: 'Snapshot', root: path.join(base, 'vivaldi-snapshot'), flavor: 'vivaldi' },
    { browser: 'Vivaldi', channel: 'Stable', root: path.join(home, '.var', 'app', 'com.vivaldi.Vivaldi', 'config', 'vivaldi'), flavor: 'vivaldi' },
  ];
}

/** [{browser, channel, root, flavor}] for this machine, every folder a browser may use (most of them will not exist). */
function forkRoots(platform = process.platform, home = os.homedir(), env = process.env) {
  return [...operaRoots(platform, home, env), ...vivaldiRoots(platform, home, env)];
}

const PROFILE_FILES = ['Bookmarks', 'History', 'Preferences', 'Sessions', 'Current Session', 'Last Session', 'Favicons'];
const holdsProfile = (folder) => PROFILE_FILES.some((name) => fs.existsSync(path.join(folder, name)));

/** The profile folders inside one root: Default / Profile N when there are any, else the root itself (Opera's older layout). */
function forkProfiles(root) {
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const inside = entries.filter((entry) => entry.isDirectory() && /^Default$|^Profile \d+$/.test(entry.name) && holdsProfile(path.join(root, entry.name))).map((entry) => ({ folder: entry.name, location: path.join(root, entry.name) }));
  if (inside.length) return inside;
  return holdsProfile(root) ? [{ folder: 'Default', location: root, flat: true }] : [];
}

function readJSON(file) {
  if (fs.statSync(file).size > MAX_JSON) throw new Error('File is too large.');
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
}
const tryJSON = (file) => {
  try {
    return readJSON(file);
  } catch {
    return null;
  }
};

const webURL = (value) => {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
};
const hostOf = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};
const clean = (value, max = 2048) => (typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');

// ---- bookmarks: speed dial and the roots the Chromium importer should read --------------------------------------------

const urlLeaves = (nodes, out = [], depth = 0) => {
  if (depth > 64) return out;
  for (const node of Array.isArray(nodes) ? nodes : []) {
    if (!node || typeof node !== 'object') continue;
    if (node.type === 'url' || (typeof node.url === 'string' && !node.children)) {
      const url = webURL(node.url);
      if (url) out.push({ url, title: clean(node.name) || hostOf(url) });
    } else urlLeaves(node.children, out, depth + 1);
  }
  return out;
};

/** Opera: Bookmarks has roots.custom_root = {speedDial, userRoot, unsorted, trash}. The browser's own folders become roots; the
 *  speed dial and the bin do not (they are not bookmarks). Vivaldi: folders flagged meta_info.Speeddial are the speed dial, and its
 *  `trash` root is the bin. Returns {tree, speedDial}: `tree` in Chromium's shape for the shared bookmark import. */
function forkBookmarks(raw, flavor) {
  const roots = {};
  let speedDial = [];
  if (!raw || typeof raw !== 'object' || !raw.roots || typeof raw.roots !== 'object') return { tree: { roots }, speedDial };
  const withoutSpeedDial = (nodes, depth = 0) =>
    (Array.isArray(nodes) ? nodes : []).flatMap((node) => {
      if (!node || typeof node !== 'object' || depth > 64) return [];
      if (node.type === 'folder' && String(node.meta_info?.Speeddial) === 'true') {
        speedDial.push(...urlLeaves(node.children));
        return [];
      }
      return [node.type === 'folder' ? { ...node, children: withoutSpeedDial(node.children, depth + 1) } : node];
    });
  for (const [key, root] of Object.entries(raw.roots)) {
    if (!root || typeof root !== 'object') continue;
    if (key === 'trash') continue;
    if (key === 'custom_root') {
      for (const [inner, sub] of Object.entries(root)) {
        if (!sub || typeof sub !== 'object') continue;
        if (inner === 'speedDial' || inner === 'speed_dial') speedDial.push(...urlLeaves(sub.children));
        else if (inner !== 'trash' && Array.isArray(sub.children) && sub.children.length) roots['opera_' + inner] = { ...sub, name: clean(sub.name) || (inner === 'unsorted' ? 'Unsorted bookmarks' : 'Bookmarks') };
      }
      continue;
    }
    if (key === 'speed_dial' || key === 'speedDial') {
      speedDial.push(...urlLeaves(root.children));
      continue;
    }
    if (!Array.isArray(root.children)) continue;
    const children = flavor === 'vivaldi' ? withoutSpeedDial(root.children) : root.children;
    if (children.length) roots[key] = { ...root, children };
  }
  const seen = new Set();
  speedDial = speedDial.filter((entry) => !seen.has(entry.url) && seen.add(entry.url));
  return { tree: { roots }, speedDial };
}

// ---- workspaces --------------------------------------------------------------------------------------------------------

/** A workspace's id the way a tab refers to it: numbers and numeric text read the same ("2", 2 and 2.0), anything else as text. */
function workspaceKey(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string' && value.trim()) {
    const number = Number(value);
    return value.trim() !== '' && Number.isFinite(number) && /^-?\d+(\.\d+)?$/.test(value.trim()) ? String(number) : value.trim();
  }
  return '';
}

/** Opera's workspace definitions from Preferences: [{key, name, icon?}] in the browser's own order. The shape is not published
 *  (ui.workspaces.config holds an id counter, an order and the definitions), so entries are found by what they are: objects with a name. */
function operaWorkspaces(prefs) {
  const config = prefs?.ui?.workspaces?.config;
  if (!config || typeof config !== 'object') return [];
  const found = new Map();
  const add = (hint, value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    const name = clean(value.name ?? value.title, 80);
    const key = workspaceKey(value.id ?? value.workspace_id ?? hint);
    if (!key || found.has(key) || (!name && typeof value.id === 'undefined' && typeof value.icon === 'undefined')) return;
    found.set(key, { key, name, ...(typeof value.icon === 'string' && value.icon ? { icon: value.icon } : {}) });
  };
  for (const holder of [config.workspaces, config.list, config.items, config]) {
    if (Array.isArray(holder)) holder.forEach((value, index) => add(String(index), value));
    else if (holder && typeof holder === 'object') for (const [hint, value] of Object.entries(holder)) add(hint, value);
  }
  const order = Array.isArray(config.order) ? config.order.map(workspaceKey) : config.order && typeof config.order === 'object' ? Object.values(config.order).map(workspaceKey) : [];
  const list = [...found.values()];
  const position = (key) => (order.includes(key) ? order.indexOf(key) : order.length + Number(key) || order.length);
  return list.sort((a, b) => position(a.key) - position(b.key));
}

/** Vivaldi's workspaces from Preferences (vivaldi.workspaces.list): [{key, name, icon?}]. */
function vivaldiWorkspaces(prefs) {
  const list = prefs?.vivaldi?.workspaces?.list;
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const value of list) {
    if (!value || typeof value !== 'object') continue;
    const key = workspaceKey(value.id);
    if (!key || out.some((item) => item.key === key)) continue;
    out.push({ key, name: clean(value.name, 80), ...(typeof value.emoji === 'string' && value.emoji.trim() ? { icon: value.emoji.trim() } : {}) });
  }
  return out;
}

const parseObject = (text) => {
  if (typeof text !== 'string' || text.length > 200000 || !/^\s*\{/.test(text)) return null;
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
};

/** What a tab's extra data says: {workspace, group, groupTitle, pinned}. Every value is tried as JSON; a key that names a workspace
 *  with a plain value counts too. Looks at what the browser must store, whatever it calls it. */
function tabExtras(tab) {
  const found = { workspace: '', group: '', groupTitle: '', pinned: false };
  for (const { key, value } of tab.extras || []) {
    const object = parseObject(value);
    if (object) {
      for (const [name, inner] of Object.entries(object)) {
        if (!found.workspace && /^workspace(_?id)?$/i.test(name) && (typeof inner === 'number' || typeof inner === 'string')) found.workspace = workspaceKey(inner);
        if (!found.group && /^group(_?id)?$/i.test(name) && typeof inner === 'string' && inner) found.group = inner;
        if (!found.groupTitle && /^(fixedGroupTitle|group_?title|stack_?title)$/i.test(name) && typeof inner === 'string') found.groupTitle = clean(inner, 64);
        if (name === 'pinned' && inner === true) found.pinned = true;
      }
    } else if (!found.workspace && /workspace/i.test(String(key)) && typeof value === 'string' && value.trim()) {
      found.workspace = workspaceKey(value);
    }
  }
  return found;
}

/** The workspaces of a session: tabs grouped by their workspace, in the browser's order. Opera tabs carry no stack; Vivaldi's stacks become
 *  groups. Returns {spaces, counts, unknown}: `unknown` is true when workspaces are defined but no tab says which one it is in, and then
 *  every tab comes in one workspace named for the browser rather than being guessed into the first. */
function buildSpaces({ flavor, label = flavor === 'vivaldi' ? 'Vivaldi' : 'Opera', defs, tabs, tabLimit = MAX_TABS }) {
  const counts = { notWeb: 0, cut: 0, read: tabs.length };
  const web = [];
  for (const tab of tabs) {
    const url = webURL(tab.url);
    if (!url) {
      counts.notWeb++;
      continue;
    }
    const extras = tabExtras(tab);
    web.push({ ...extras, url, title: clean(tab.title) || hostOf(url), pinned: tab.pinned || extras.pinned });
  }
  const anyAssigned = web.some((tab) => tab.workspace);
  const unknown = Boolean(defs.length > 1 && web.length && !anyAssigned);
  const named = new Map(defs.map((def, index) => [def.key, { ...def, index }]));
  // A tab that names no workspace is in the first one (Opera) or the default one (Vivaldi); with one defined workspace and no
  // tab naming any, all of them are in it. With several defined and none named, they stay together in an unnamed bucket.
  const home = flavor === 'vivaldi' ? '' : anyAssigned || defs.length === 1 ? defs[0]?.key || '' : '';
  const buckets = new Map();
  const bucketOf = (key) => {
    if (!buckets.has(key)) buckets.set(key, { key, pinned: [], tabs: [], groups: new Map() });
    return buckets.get(key);
  };
  let kept = 0;
  for (const tab of web) {
    if (kept >= tabLimit) {
      counts.cut++;
      continue;
    }
    kept++;
    const bucket = bucketOf(tab.workspace || home);
    const entry = { url: tab.url, title: tab.title };
    if (tab.pinned) bucket.pinned.push(entry);
    else if (flavor === 'vivaldi' && tab.group) {
      if (!bucket.groups.has(tab.group)) bucket.groups.set(tab.group, { name: tab.groupTitle, tabs: [] });
      const group = bucket.groups.get(tab.group);
      group.name ||= tab.groupTitle;
      group.tabs.push(entry);
    } else bucket.tabs.push(entry);
  }
  // The browser's own order for the workspaces it defines; those a tab names without a definition follow by id; the unnamed bucket
  // leads for Vivaldi (its default workspace) and follows for Opera.
  const rank = (key) => (named.has(key) ? named.get(key).index : key === '' ? (flavor === 'vivaldi' ? -1 : defs.length + 1e6) : defs.length + (Number(key) || 0));
  const spaces = [];
  for (const key of [...buckets.keys()].sort((a, b) => rank(a) - rank(b))) {
    const bucket = buckets.get(key);
    const groups = [...bucket.groups.values()].map((group, index) => ({ name: group.name || 'Stack ' + (index + 1), tabs: group.tabs }));
    if (!bucket.pinned.length && !bucket.tabs.length && !groups.some((group) => group.tabs.length)) continue;
    const def = named.get(key);
    const number = Number.isInteger(Number(key)) && key !== '' ? Number(key) + 1 : spaces.length + 1;
    const title = def ? def.name || 'Workspace ' + (def.index + 1) : key === '' ? (flavor === 'vivaldi' ? 'Default' : label) : 'Workspace ' + number;
    spaces.push({ key: 'fork-' + (key || 'none'), title, ...(def?.icon ? { icon: def.icon } : {}), pinned: bucket.pinned, tabs: bucket.tabs, groups });
  }
  return { spaces, counts, unknown };
}

/** Everything a fork profile offers beyond Chromium's own data: {speedDial, spaces, tabs: counts, definedWorkspaces, encrypted, unreadable, unknown}. Never throws. */
function readFork(location, flavor, { tabLimit = MAX_TABS, label } = {}) {
  const result = { speedDial: [], spaces: [], counts: { notWeb: 0, cut: 0, read: 0 }, definedWorkspaces: 0, encrypted: 0, unreadable: 0, unknown: false };
  try {
    const bookmarks = tryJSON(path.join(location, 'Bookmarks'));
    if (bookmarks) result.speedDial = forkBookmarks(bookmarks, flavor).speedDial;
  } catch {}
  let defs = [];
  try {
    const prefs = tryJSON(path.join(location, 'Preferences'));
    defs = flavor === 'vivaldi' ? vivaldiWorkspaces(prefs) : operaWorkspaces(prefs);
  } catch {}
  result.definedWorkspaces = defs.length;
  try {
    const session = readSessionTabs(location);
    result.encrypted = session.encrypted;
    result.unreadable = session.unreadable;
    if (session.tabs.length) {
      const built = buildSpaces({ flavor, label, defs, tabs: session.tabs, tabLimit });
      Object.assign(result, { spaces: built.spaces, counts: built.counts, unknown: built.unknown });
    }
  } catch {
    result.unreadable++;
  }
  return result;
}

module.exports = { MAX_FAVORITES, MAX_TABS, forkRoots, forkProfiles, forkBookmarks, operaWorkspaces, vivaldiWorkspaces, tabExtras, buildSpaces, readFork, workspaceKey, webURL };
