'use strict';
// Safari (macOS only). Bookmarks and the Reading List come from Bookmarks.plist (a binary property list, read with
// import-bplist.cjs), history from History.db (SQLite, read from a private snapshot copy by import-snapshot.cjs, so this works
// while Safari is open).
//
// PERMISSION FLOW
//  1. Safari shows in the import list only because the app is installed (safariInstalled: /Applications/Safari.app or the
//     system Cryptex copies, none of which are protected). Nothing under ~/Library/Safari is touched at this point: not read,
//     not listed, not even stat-ed.
//  2. Only when the person picks Safari does Acira look inside the folder (safariAccess), then read Bookmarks.plist and a
//     snapshot of History.db (readSafariBookmarks, readSafariHistory).
//  3. macOS protects ~/Library/Safari (it needs the Full Disk Access permission) and answers EPERM / EACCES when Acira has not
//     been given it. The screen then says why and offers two ways on: allow Acira in System Settings > Privacy & Security >
//     Full Disk Access and try again, or use Safari's File > Export > Bookmarks (HTML) with the existing "Import bookmarks
//     file" option.
//  4. Acira never asks macOS for access itself, and never reads Safari's passwords (they live in the Keychain), tab groups, open
//     tabs, extensions or Profiles. Open tabs and tab groups are left alone on purpose: Safari 18 changed where it keeps them and
//     the new storage is not reliable to read.
//
// The root folder is always a parameter (safariRoot() only builds the usual path), so every reader below runs on a fixture folder
// in tests and never on the real one. Reads that fail throw the original fs error, whose `.code` (EPERM, EACCES, ENOENT, ...)
// tells the caller why.
//
// Bookmarks.plist, as Safari writes it: the root dict is {WebBookmarkType: 'WebBookmarkTypeList', Title: '', Children: [...]}.
// The top-level Children are lists titled 'BookmarksBar' (the Favorites bar), 'BookmarksMenu' and 'com.apple.ReadingList', plus
// a 'History' entry of type 'WebBookmarkTypeProxy' (a placeholder for the History menu; ignored). A folder is
// {WebBookmarkType: 'WebBookmarkTypeList', Title, Children, WebBookmarkUUID}; a bookmark is {WebBookmarkType:
// 'WebBookmarkTypeLeaf', URLString, URIDictionary: {title}, WebBookmarkUUID}; a Reading List item also has a
// ReadingList: {DateAdded, PreviewText} dict, which is not carried over (the bookmark shape has no field for it).
// History.db: history_items(id, url, visit_count, ...) one row per address and history_visits(id, history_item, visit_time,
// title, ...) one row per visit; visit_time is a Core Data time, seconds (REAL) since 2001-01-01.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const { readDatabase } = require('./import-snapshot.cjs');
const { parsePlist, MAX_FILE_BYTES } = require('./import-bplist.cjs');

const MAX_DEPTH = 64; // folders inside folders (the bar, menu and Reading List themselves do not count)
const MAX_NODES = 50000; // bookmarks and folders looked at, kept or not
const MAX_TITLE = 2048;
const CORE_DATA_EPOCH_SECONDS = 978307200; // 2001-01-01T00:00:00Z in Unix seconds

const APP_PATHS = [
  '/Applications/Safari.app',
  '/System/Cryptexes/App/System/Applications/Safari.app',
  '/System/Volumes/Preboot/Cryptexes/App/System/Applications/Safari.app',
];

/** Safari's data folder under `home`. Only builds the path; nothing is read. */
function safariRoot(home = os.homedir()) {
  return path.join(home, 'Library', 'Safari');
}

/** True when Safari is installed. These app folders are not protected, so this is what puts Safari in the import list without
 *  touching ~/Library/Safari. `exists` is injectable for tests. */
function safariInstalled(exists = fs.existsSync) {
  return APP_PATHS.some((candidate) => {
    try {
      return Boolean(exists(candidate));
    } catch {
      return false;
    }
  });
}

/** Whether the data folder can be listed: {ok: true}, or {ok: false, reason} with reason 'permission' (EPERM / EACCES: macOS is
 *  withholding Full Disk Access), 'missing' (no such folder) or 'other'. Called only after the person chose Safari. `fsApi` is
 *  injectable for tests. */
function safariAccess(root, fsApi = fs) {
  try {
    fsApi.readdirSync(root);
    return { ok: true };
  } catch (error) {
    const code = error && error.code;
    if (code === 'EPERM' || code === 'EACCES') return { ok: false, reason: 'permission' };
    if (code === 'ENOENT' || code === 'ENOTDIR') return { ok: false, reason: 'missing' };
    return { ok: false, reason: 'other' };
  }
}

/** What the folder holds: {bookmarks, history}. Cheap (fs.existsSync, no parsing). macOS answers "not there" for a file it will
 *  not let Acira see, so call safariAccess first and treat a false here as "nothing readable". */
function safariOffers(root) {
  return { bookmarks: fs.existsSync(path.join(root, 'Bookmarks.plist')), history: fs.existsSync(path.join(root, 'History.db')) };
}

const webURL = (value) => {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
};

/** An error that carries a `.code` like an fs error does, so the caller can tell the cases apart. */
function codedError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

/** Reads a whole file, refusing one over `cap` bytes before it is read. fs errors (EPERM, EACCES, ENOENT, EISDIR, ...) pass through. */
function readCapped(file, cap) {
  const descriptor = fs.openSync(file, 'r');
  try {
    const { size } = fs.fstatSync(descriptor);
    if (size > cap) throw codedError(path.basename(file) + ' is too large to import', 'EFBIG');
    const buffer = Buffer.allocUnsafe(size);
    let filled = 0;
    while (filled < size) {
      const read = fs.readSync(descriptor, buffer, filled, size - filled, null);
      if (!read) break;
      filled += read;
    }
    return filled === size ? buffer : buffer.subarray(0, filled);
  } finally {
    fs.closeSync(descriptor);
  }
}

const isRecord = (value) => value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
const text = (value) => (typeof value === 'string' && value.trim() ? value : '');

// The three lists Safari has at the top, and where each lands (the keys and names match the Chromium-shaped tree the shared
// importer reads; core.ts finds the bar by this title).
const TOP_LISTS = new Map([
  ['BookmarksBar', ['bookmark_bar', 'Bookmarks bar']],
  ['BookmarksMenu', ['menu', 'Bookmarks menu']],
  ['com.apple.ReadingList', ['reading_list', 'Reading List']],
]);

/** 'leaf', 'list', 'proxy' or null (not something to import). A node with no WebBookmarkType is judged by its keys. */
function kindOf(entry) {
  const type = entry.WebBookmarkType;
  if (type === 'WebBookmarkTypeLeaf') return 'leaf';
  if (type === 'WebBookmarkTypeList') return 'list';
  if (type === 'WebBookmarkTypeProxy') return 'proxy';
  if (type === undefined && typeof entry.URLString === 'string') return 'leaf';
  if (type === undefined && Array.isArray(entry.Children)) return 'list';
  return null;
}

/** Turns a parsed Bookmarks.plist (see the top of this file for its shape) into {tree, bookmarks, folders, readingList, notWeb,
 *  truncated}. Never throws on odd nodes: they are skipped. Only web addresses without credentials are kept; the rest count as
 *  `notWeb`. At most 50,000 nodes are looked at and folders more than 64 deep are left out (`truncated` says either happened). */
function safariBookmarksFrom(plist) {
  const state = { nodes: 0, notWeb: 0, truncated: false, bookmarks: 0, folders: 0, readingList: 0, used: new Set(), repeats: new Map() };

  /** The node's id: 'safari-' + Safari's own UUID, or a stable hash of where it sits when the UUID is missing or odd. A repeated
   *  UUID (a damaged file) gets a counter so ids stay unique. */
  const guidFor = (uuid, seed) => {
    const base = 'safari-' + (typeof uuid === 'string' && /^[\w.-]{1,100}$/.test(uuid) ? uuid : crypto.createHash('sha1').update(seed).digest('hex').slice(0, 20));
    let guid = base;
    if (state.used.has(guid)) {
      let count = state.repeats.get(base) || 1;
      do count++;
      while (state.used.has(base + '-' + count));
      state.repeats.set(base, count);
      guid = base + '-' + count;
    }
    state.used.add(guid);
    return guid;
  };

  /** One bookmark or folder as a Chromium-style node, or null when it is left out. `trail` is its position (the indexes taken from the top). */
  const convert = (entry, reading, depth, trail) => {
    if (!isRecord(entry)) return null;
    if (state.nodes >= MAX_NODES) {
      state.truncated = true;
      return null;
    }
    state.nodes++;
    const kind = kindOf(entry);
    if (kind === 'leaf') {
      if (typeof entry.URLString !== 'string') return null;
      const url = webURL(entry.URLString);
      if (!url) {
        state.notWeb++;
        return null;
      }
      const title = text(isRecord(entry.URIDictionary) ? entry.URIDictionary.title : '') || text(entry.Title) || new URL(url).hostname;
      if (reading) state.readingList++;
      else state.bookmarks++;
      return { type: 'url', name: title.slice(0, MAX_TITLE), url, guid: guidFor(entry.WebBookmarkUUID, trail.join('/') + ' ' + url) };
    }
    if (kind === 'list') {
      if (entry.ShouldOmitFromUI === true) return null;
      if (depth >= MAX_DEPTH) {
        state.truncated = true;
        return null;
      }
      state.folders++;
      const name = (text(entry.Title) || 'Folder').slice(0, MAX_TITLE);
      return { type: 'folder', name, guid: guidFor(entry.WebBookmarkUUID, trail.join('/') + ' ' + name), children: convertAll(entry.Children, reading, depth + 1, trail) };
    }
    return null;
  };

  /** The kept nodes among `entries`, in order. */
  const convertAll = (entries, reading, depth, trail) => {
    const kept = [];
    if (!Array.isArray(entries)) return kept;
    for (let index = 0; index < entries.length; index++) {
      if (state.nodes >= MAX_NODES) {
        state.truncated = true;
        break;
      }
      const node = convert(entries[index], reading, depth, [...trail, index]);
      if (node) kept.push(node);
    }
    return kept;
  };

  const lists = new Map(); // root key -> children
  const extras = []; // top-level lists Safari does not name, and loose links: kept in the menu
  const top = isRecord(plist) && Array.isArray(plist.Children) ? plist.Children : [];
  for (let index = 0; index < top.length && !state.truncated; index++) {
    const entry = top[index];
    if (!isRecord(entry)) continue;
    const kind = kindOf(entry);
    const known = kind === 'list' ? TOP_LISTS.get(entry.Title) : undefined;
    if (known) {
      if (state.nodes >= MAX_NODES) {
        state.truncated = true;
        break;
      }
      state.nodes++;
      const children = convertAll(entry.Children, known[0] === 'reading_list', 0, [index]);
      lists.set(known[0], (lists.get(known[0]) || []).concat(children));
    } else if (kind === 'list' || kind === 'leaf') {
      const node = convert(entry, false, 0, [index]);
      if (node) extras.push(node);
    }
  }
  if (extras.length) lists.set('menu', (lists.get('menu') || []).concat(extras));

  const roots = {};
  for (const [, [key, name]] of TOP_LISTS) {
    const children = lists.get(key);
    if (children && children.length) roots[key] = { name, children };
  }
  return { tree: { roots }, readingList: state.readingList, folders: state.folders, bookmarks: state.bookmarks, notWeb: state.notWeb, truncated: state.truncated };
}

/** Safari's bookmarks and Reading List: {tree, readingList, folders, bookmarks, notWeb, truncated}. `tree` is a Chromium "Bookmarks"
 *  object, {roots: {bookmark_bar, menu, reading_list}} (empty roots left out), for the shared importer. `bookmarks` and `folders` count
 *  the bar and the menu, `readingList` the Reading List items. Throws an Error with `.code` when the file cannot be read (EPERM /
 *  EACCES: macOS withholds Full Disk Access; ENOENT: no such file; EFBIG: over 64 MB) or 'EBADPLIST' when it is not a property list. */
function readSafariBookmarks(root) {
  const buffer = readCapped(path.join(root, 'Bookmarks.plist'), MAX_FILE_BYTES);
  let plist;
  try {
    plist = parsePlist(buffer);
  } catch (error) {
    throw codedError('Safari bookmarks could not be read: ' + error.message, 'EBADPLIST');
  }
  return safariBookmarksFrom(plist);
}

/** Visited pages, newest first: [{url, title, time (ms since 1970)}], one per address, with the time and title of its latest
 *  visit (the host name when that visit had no title). Only web addresses are returned, at most `limit` of them; `skipped.notWeb`
 *  (optional) counts the addresses passed over on the way because they are not web pages. Throws the fs error (with `.code`) when
 *  History.db cannot be read. */
function readSafariHistory(root, limit = 50000, skipped = null) {
  const max = Number.isFinite(limit) && limit >= 0 ? Math.floor(limit) : 50000;
  // One row per address. SQLite documents that with a single MAX() in the query, the bare columns (url, title) come from the row
  // that holds the maximum, i.e. the latest visit; no index on history_visits is needed.
  const found = readDatabase(root, 'History.db', (database) => {
    const query = database.prepare(
      'SELECT i.url AS url, MAX(v.visit_time) AS time, v.title AS title FROM history_items i JOIN history_visits v ON v.history_item = i.id GROUP BY i.id ORDER BY time DESC, i.id DESC',
    );
    const entries = [];
    let notWeb = 0;
    if (max === 0) return { entries, notWeb };
    for (const row of query.iterate()) {
      const url = typeof row.url === 'string' ? webURL(row.url) : null;
      if (!url) {
        notWeb++;
        continue;
      }
      if (typeof row.time !== 'number') continue;
      const time = Math.round((row.time + CORE_DATA_EPOCH_SECONDS) * 1000);
      if (!Number.isFinite(time) || Math.abs(time) > 8.64e15) continue;
      entries.push({ url, title: (text(row.title) || new URL(url).hostname).slice(0, MAX_TITLE), time });
      if (entries.length >= max) break;
    }
    return { entries, notWeb };
  });
  if (skipped) skipped.notWeb += found.notWeb;
  return found.entries;
}

/** How many addresses have at least one visit in History.db (what readSafariHistory can return, before its limit). */
function countSafariHistory(root) {
  return readDatabase(root, 'History.db', (database) =>
    Number(database.prepare('SELECT count(DISTINCT v.history_item) AS count FROM history_visits v JOIN history_items i ON i.id = v.history_item').get().count),
  );
}

module.exports = { safariRoot, safariInstalled, safariAccess, safariOffers, safariBookmarksFrom, readSafariBookmarks, readSafariHistory, countSafariHistory };
