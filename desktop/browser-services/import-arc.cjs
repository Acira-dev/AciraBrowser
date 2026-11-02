'use strict';
// Arc stops working on 22 Dec 2026, so its people need a way out. Arc is Chromium underneath: its profiles (Default,
// Profile 1, …) hold History and sometimes Bookmarks like Chrome's, and the existing Chromium scan reads those. What makes
// Arc Arc lives in StorableSidebar.json at the Arc root, two levels above a profile: Favorites (the icons at the top),
// Spaces, and each Space's pinned tabs and folders. Format notes follow Helium's ArcSidebarImporter
// (patches/helium/core/add-arc-importer.patch, imputnet/helium f29a259, GPL-3.0): `items`, `spaces` and
// `topAppsContainerIDs` are flat lists that alternate key, value; a Space's `containerIDs` alternate "pinned"/"unpinned"
// and a container id; item times are CFAbsoluteTime (seconds since 2001-01-01).
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');

const SIDEBAR = 'StorableSidebar.json';
const CF_EPOCH_MS = 978307200000;
const MAX_TABS = 200;

/** Arc's Chromium "User Data" folder for this platform (Windows: the MSIX package's LocalCache). */
function arcUserData(platform = process.platform, home = os.homedir(), env = process.env) {
  if (platform === 'win32') {
    const local = env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    return path.join(local, 'Packages', 'TheBrowserCompany.Arc_ttt1ap7aakyb4', 'LocalCache', 'Local', 'Arc', 'User Data');
  }
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Arc', 'User Data');
  return null;
}

/** StorableSidebar.json for a profile folder: the Arc root first (where Arc keeps it), then the nearer folders. */
function findSidebar(location) {
  for (const candidate of [path.join(location, '..', '..', SIDEBAR), path.join(location, '..', SIDEBAR), path.join(location, SIDEBAR)]) {
    try {
      if (fs.statSync(candidate).isFile()) return path.resolve(candidate);
    } catch {}
  }
  return null;
}

function readSidebar(location) {
  const file = findSidebar(location);
  if (!file) return null;
  if (fs.statSync(file).size > 64e6) throw new Error('Arc’s sidebar file is too large to read.');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** Pairs from a flat [key, value, key, value, …] list. Newer files sometimes hold plain objects with their own id. */
function pairs(list) {
  const out = [];
  if (!Array.isArray(list)) return out;
  for (let i = 0; i < list.length; i++) {
    const key = list[i];
    if (key && typeof key === 'object' && typeof key.id === 'string') out.push([key.id, key]);
    else if (i + 1 < list.length) out.push([key, list[++i]]);
  }
  return out;
}

/** The Arc profile folder a Space or Favorites set belongs to: {"default":…} or {"custom":{"_0":{"directoryBasename":…}}}. */
function profileFolder(value) {
  const custom = value && typeof value === 'object' ? value.custom : null;
  if (custom && typeof custom === 'object') {
    const inner = custom._0 || Object.values(custom)[0];
    if (inner && typeof inner.directoryBasename === 'string') return inner.directoryBasename;
  }
  return 'Default';
}

const webURL = (value) => {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
};
const host = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};
const created = (value) => (typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.round(value * 1000 + CF_EPOCH_MS)) : undefined);

function parseItems(list) {
  const items = new Map();
  for (const [id, raw] of pairs(list)) {
    if (typeof id !== 'string' || !raw || typeof raw !== 'object') continue;
    const tab = raw.data?.tab, container = raw.data?.itemContainer;
    items.set(id, {
      id,
      title: typeof raw.title === 'string' ? raw.title : '',
      url: tab && typeof tab.savedURL === 'string' ? tab.savedURL : '',
      savedTitle: tab && typeof tab.savedTitle === 'string' ? tab.savedTitle : '',
      createdAt: created(raw.createdAt),
      children: Array.isArray(raw.childrenIds) ? raw.childrenIds.filter((child) => typeof child === 'string') : [],
      container: Boolean(container),
    });
  }
  return items;
}

/** A container's children as Chromium-style bookmark nodes ({type, name, url, guid, children}); containers are
 *  transparent, arc:// pages and non-web addresses are dropped, folders keep their names. */
function tree(ids, items, seen, depth = 0) {
  const out = [];
  if (depth > 64) return out;
  for (const id of ids) {
    const item = items.get(id);
    if (!item || seen.has(id)) continue;
    seen.add(id);
    if (item.url) {
      const url = webURL(item.url);
      if (url) out.push({ type: 'url', name: (item.title || item.savedTitle || host(url)).slice(0, 2048), url, guid: 'arc-' + id, createdAt: item.createdAt });
    } else if (item.container) {
      out.push(...tree(item.children, items, seen, depth + 1));
    } else if (item.children.length) {
      const children = tree(item.children, items, seen, depth + 1);
      if (children.length) out.push({ type: 'folder', name: (item.title || item.savedTitle || 'Folder').slice(0, 2048), guid: 'arc-' + id, children });
    }
  }
  return out;
}

const flatten = (nodes) => nodes.flatMap((node) => (node.type === 'url' ? [{ url: node.url, title: node.name }] : flatten(node.children)));

/** A Space's own emoji (Arc's customInfo.iconType), when it has one. */
function spaceIcon(space) {
  const info = space && typeof space.customInfo === 'object' ? space.customInfo : null, type = info && typeof info.iconType === 'object' ? info.iconType : null;
  const emoji = type ? type.emoji_v2 ?? type.emoji : info?.emoji;
  return typeof emoji === 'string' && emoji.trim() && emoji.trim().length <= 16 ? emoji.trim() : undefined;
}
/** A Space's theme colour as #rrggbb: the first {red, green, blue} (0–1) in its window theme. */
function spaceColor(space) {
  const seen = new Set();
  const find = (value, depth = 0) => {
    if (!value || typeof value !== 'object' || depth > 16 || seen.has(value)) return null;
    seen.add(value);
    if (['red', 'green', 'blue'].every((key) => typeof value[key] === 'number' && Number.isFinite(value[key]))) return value;
    for (const child of Object.values(value)) { const hit = find(child, depth + 1); if (hit) return hit; }
    return null;
  };
  const rgb = find(space?.customInfo?.windowTheme);
  if (!rgb) return undefined;
  const byte = (n) => Math.round(Math.max(0, Math.min(1, n)) * 255).toString(16).padStart(2, '0');
  return '#' + byte(rgb.red) + byte(rgb.green) + byte(rgb.blue);
}
/** The nearest of Acira's workspace colours to an Arc theme colour, or undefined for a grey one (hue decides). */
function nearestColor(hex, palette) {
  const hsl = (value) => { const [r, g, b] = [1, 3, 5].map((at) => parseInt(value.slice(at, at + 2), 16) / 255), max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
    if (!d) return [0, 0, l];
    const s = d / (1 - Math.abs(2 * l - 1)), h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [(h * 60 + 360) % 360, s, l]; };
  if (typeof hex !== 'string' || !/^#[0-9a-f]{6}$/i.test(hex)) return undefined;
  const [h, s] = hsl(hex);
  if (s < 0.12) return undefined;
  let best, gap = Infinity;
  for (const candidate of palette) { const [ch, cs] = hsl(candidate); if (cs < 0.12) continue; const diff = Math.min(Math.abs(ch - h), 360 - Math.abs(ch - h)); if (diff < gap) { gap = diff; best = candidate; } }
  return best?.toLowerCase();
}

/** Everything the sidebar holds for one Arc profile folder ("Default", "Profile 1", …):
 *  favorites [{url,title}] and spaces [{id, title, tree, tabs}] (tree keeps folders, tabs is the flat pinned list). */
function parseArcSidebar(raw, folder = 'Default') {
  const empty = { favorites: [], spaces: [] };
  const data = raw?.sidebar?.containers?.[1];
  if (!data || typeof data !== 'object') return empty;
  const items = parseItems(data.items);
  if (!items.size) return empty;
  const seen = new Set();
  const topApps = pairs(data.topAppsContainerIDs);
  // Favorites are per profile; an older file has a single unlabelled set, which belongs to the default profile.
  const mine = topApps.find(([key]) => profileFolder(key) === folder) || (folder === 'Default' && topApps.length === 1 ? topApps[0] : null);
  const favoritesContainer = mine && items.get(mine[1]);
  const favorites = favoritesContainer ? flatten(tree(favoritesContainer.children, items, seen)) : [];
  const spaces = [];
  for (const [id, space] of pairs(data.spaces)) {
    if (typeof id !== 'string' || !space || typeof space !== 'object') continue;
    if (profileFolder(space.profile) !== folder) continue;
    const pinned = pairs(space.containerIDs).find(([label]) => label === 'pinned')?.[1];
    const container = typeof pinned === 'string' ? items.get(pinned) : null;
    if (!container?.children.length) continue;
    const nodes = tree(container.children, items, seen);
    if (!nodes.length) continue;
    const title = (typeof space.title === 'string' && space.title.trim()) || (id.includes('defaultPersonalSpaceID') ? 'Personal' : `Space ${spaces.length + 1}`);
    const icon = spaceIcon(space), color = spaceColor(space);
    spaces.push({ id, title: title.slice(0, 80), tree: nodes, tabs: flatten(nodes), ...(icon ? { icon } : {}), ...(color ? { color } : {}) });
  }
  return { favorites, spaces };
}

/** Pinned tabs and their folders as a Chromium Bookmarks object for the shared bookmark import: one "Arc" root folder,
 *  with a folder per Space when there is more than one. */
function arcBookmarks(spaces) {
  if (!spaces.length) return { roots: {} };
  const children = spaces.length === 1 ? spaces[0].tree : spaces.map((space) => ({ type: 'folder', name: space.title, guid: 'arc-space-' + space.id, children: space.tree }));
  return { roots: { arc: { type: 'folder', name: 'Arc', guid: 'arc-root', children } } };
}

/** Spaces as tab groups: one collapsed group per Space, its pinned tabs in order (folders flattened), at most MAX_TABS in
 *  all. Tabs are only state: Acira makes a page for a tab when it is first shown, so nothing loads at import. */
function arcTabGroups(spaces, limit = MAX_TABS) {
  const colors = ['blue', 'purple', 'green', 'orange', 'pink', 'cyan', 'red', 'yellow'];
  let left = limit;
  const groups = [];
  for (const [index, space] of spaces.entries()) {
    if (left <= 0) break;
    const tabs = space.tabs.slice(0, left);
    left -= tabs.length;
    if (tabs.length) groups.push({ key: space.id, name: space.title, color: colors[index % colors.length], tabs });
  }
  return { groups, skipped: spaces.reduce((sum, space) => sum + space.tabs.length, 0) - (limit - left) };
}

/** Spaces as workspaces (R4-48 P0-10): the first `room` Spaces each become a workspace with the Space's name, emoji and
 *  colour; its top-level pinned tabs stay pinned, and each folder becomes a collapsed tab group inside it (nested folders
 *  flatten into their top folder). At most `limit` tabs in all. The Spaces past `room` come back as `rest` (for tab groups). */
function arcWorkspaces(spaces, room, limit = MAX_TABS) {
  let left = limit;
  const take = (tabs) => { const kept = tabs.slice(0, Math.max(0, left)); left -= kept.length; return kept; };
  const workspaces = spaces.slice(0, Math.max(0, room)).map((space) => {
    const pinned = take(space.tree.filter((node) => node.type === 'url').map((node) => ({ url: node.url, title: node.name })));
    const names = new Set(), groups = [];
    for (const node of space.tree.filter((item) => item.type === 'folder')) {
      let name = node.name.slice(0, 64);
      for (let n = 2; names.has(name); n++) name = node.name.slice(0, 58) + ' ' + n;
      names.add(name);
      const tabs = take(flatten(node.children));
      if (tabs.length) groups.push({ name, tabs });
    }
    return { key: space.id, title: space.title, ...(space.icon ? { icon: space.icon } : {}), ...(space.color ? { color: space.color } : {}), pinned, groups };
  });
  const kept = workspaces.reduce((sum, space) => sum + space.pinned.length + space.groups.reduce((n, group) => n + group.tabs.length, 0), 0);
  return { workspaces, rest: spaces.slice(Math.max(0, room)), left, skipped: spaces.slice(0, Math.max(0, room)).reduce((sum, space) => sum + space.tabs.length, 0) - kept };
}

/** What a profile folder offers, for discovery (never throws: an unreadable sidebar offers nothing extra). */
function arcAvailability(location, folder) {
  try {
    const { favorites, spaces } = parseArcSidebar(readSidebar(location), folder);
    return { favorites: favorites.length > 0, spaces: spaces.length > 0, pinned: spaces.length > 0 };
  } catch {
    return { favorites: false, spaces: false, pinned: false };
  }
}

module.exports = { arcUserData, findSidebar, readSidebar, parseArcSidebar, arcBookmarks, arcTabGroups, arcWorkspaces, nearestColor, arcAvailability, MAX_TABS };
