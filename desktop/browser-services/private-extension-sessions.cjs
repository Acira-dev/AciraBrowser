'use strict';
// "Allow in private tabs" (Settings › Extensions): where a private session that runs extensions lives.
//
// Electron cannot load an extension into a memory-only session ("Extensions cannot be loaded in a temporary session"), which is what every private
// window and private tab uses. So when at least one extension of the profile is allowed in private, a NEW private window or private tab gets a session
// kept in a temporary folder of Acira's own data folder instead (`Partitions/acira-private-ext-<kind>-<id>`), and nothing else about it changes:
// it is still a `private-` profile for permissions, downloads, content blocking and spelling, its cache is off, and the same verified retirement
// empties it when the tab or window goes. The folder is deleted when that finishes and swept at every start (a crash or a force-quit leaves it until then).
// With no extension allowed (the default) nothing here runs and private sessions are exactly the memory-only ones they always were.
//
// Tor tabs and windows and secured workspaces never get one (neverFor): they stay extension-free whatever the switch says.
const fs = require('node:fs'), path = require('node:path'), { randomUUID } = require('node:crypto');

const PREFIX = 'acira-private-ext-';
const STORAGE_FOLDERS = ['Local Extension Settings', 'Sync Extension Settings', 'Managed Extension Settings'];
const sessions = new WeakSet(), partitions = new Map();

/** The partition string of a new temporary session. kind: 'tab' or 'window'. `persist:` is what makes Electron keep it in a folder (so an extension can load). */
const newPartition = kind => `persist:${PREFIX}${kind === 'window' ? 'window' : 'tab'}-${randomUUID()}`;
const isPartition = value => typeof value === 'string' && value.startsWith('persist:' + PREFIX) && !/[\\/\0]/.test(value);

/** Private kinds that must never run extensions, whatever the switch says: Tor (tab or window) and secured workspaces. */
const neverFor = ({ tor = false, privacy = '' } = {}) => Boolean(tor) || privacy === 'tor' || privacy === 'secured';

/** Makes (or returns) the session of a temporary partition. Cache off: nothing of the pages is kept for later. */
function create(partition, { electron = require('electron') } = {}) {
  if (!isPartition(partition)) throw new Error('Not a temporary private partition.');
  const session = electron.session.fromPartition(partition, { cache: false });
  sessions.add(session); partitions.set(partition, session);
  return session;
}
const isTemporary = session => Boolean(session) && sessions.has(session);
/** session.isPersistent(), except that a temporary private session (kept in a folder only so extensions can load) counts as the private, ephemeral kind it is. */
const persistent = session => session.isPersistent() === true && !sessions.has(session);
const sessionOf = partition => partitions.get(partition) || null;
const folderOf = session => { try { return typeof session?.storagePath === 'string' && session.storagePath ? session.storagePath : null; } catch { return null; } };

/** Deletes the folder of one temporary session, once its retirement is complete. Only a folder under `<userData>/Partitions/acira-private-ext-…` is ever removed. */
function removeFolder(userData, session, { fsImpl = fs } = {}) {
  const folder = folderOf(session), root = path.resolve(userData, 'Partitions');
  if (!folder) return false;
  const target = path.resolve(folder);
  if (path.dirname(target) !== root || !path.basename(target).toLowerCase().startsWith(PREFIX)) return false;
  try { fsImpl.rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }); } catch { return false; }
  return !fsImpl.existsSync(target);
}

/** Chromium keeps the session's storage open and writes again a little after the folder was deleted (its network state, a script-cache index), so the folder is
 *  deleted again a few times: right away, then after those delayed writes. Whatever is still there after that goes at the next start (sweep) or at quit. */
function removeSoon(userData, session, { fsImpl = fs, delays = [3000, 10000, 30000] } = {}) {
  removeFolder(userData, session, { fsImpl });
  for (const ms of delays) { const timer = setTimeout(() => { removeFolder(userData, session, { fsImpl }); }, ms); timer.unref?.(); }
}

/** At every start: nothing from an earlier run is left. Returns the number of folders removed (a session of this run is never touched: none exists yet). */
function sweep(userData, { fsImpl = fs } = {}) {
  const root = path.join(userData, 'Partitions');
  let names = [];
  try { names = fsImpl.readdirSync(root); } catch { return 0; }
  let removed = 0;
  for (const name of names) {
    if (!name.toLowerCase().startsWith(PREFIX)) continue;
    const target = path.join(root, name);
    try { if (fsImpl.lstatSync(target).isSymbolicLink()) { fsImpl.unlinkSync(target); removed++; continue; } fsImpl.rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }); removed++; } catch { /* retried at the next start */ }
  }
  return removed;
}

/** The extension's own data: its settings (chrome.storage.local, and the sync area that lives inside it) and its own IndexedDB (an extension such as a proxy
 *  switcher keeps which profile is selected there), copied from the ordinary profile into the private session's folder BEFORE the extension loads there. Only the
 *  folders of that one extension's origin: never localStorage, cookies or anything of a website. One way, at the start only: nothing the extension changes in
 *  private goes back, and it goes with the folder. Returns the folders copied; never throws (an extension that cannot be copied starts empty). */
function copySettings(fromStorage, toStorage, extensionId, { fsImpl = fs } = {}) {
  const copied = [];
  if (!fromStorage || !toStorage || !/^[a-p]{32}$/.test(extensionId) || path.resolve(fromStorage) === path.resolve(toStorage)) return copied;
  const own = [...STORAGE_FOLDERS.map(folder => [folder, extensionId]), ['IndexedDB', `chrome-extension_${extensionId}_0.indexeddb.leveldb`], ['IndexedDB', `chrome-extension_${extensionId}_0.indexeddb.blob`]];
  for (const [folder, name] of own) {
    const from = path.join(fromStorage, folder, name), to = path.join(toStorage, folder, name);
    try {
      if (!fsImpl.statSync(from).isDirectory()) continue;
      fsImpl.mkdirSync(path.dirname(to), { recursive: true });
      fsImpl.cpSync(from, to, { recursive: true, force: true, filter: source => path.basename(source) !== 'LOCK' });
      copied.push(folder + '/' + name);
    } catch { /* not there, or locked: this extension starts empty */ }
  }
  return copied;
}

module.exports = { PREFIX, STORAGE_FOLDERS, newPartition, isPartition, neverFor, create, isTemporary, persistent, sessionOf, folderOf, removeFolder, removeSoon, sweep, copySettings };
