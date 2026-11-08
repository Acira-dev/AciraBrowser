'use strict';
// chrome.bookmarks.onCreated / onChanged / onMoved / onRemoved / onChildrenReordered for extensions. main.cjs calls noteBookmarks(nodes) with a
// window's shared bookmark list whenever that window's shared state changes (publishShared), which covers every way a bookmark changes: the
// person (sidebar, bar, star, manager), an import or its undo, another window, and an extension's own write. Each profile's extension runtime
// watches for its own profile only, so nothing of another profile (or of a private window, which never publishes) reaches an extension.
// The events come from comparing the list with the one before it (extension-bookmarks.cjs diffEvents); a list equal to the last one says nothing,
// so several windows reporting the same change give one set of events.
const model = require('./extension-bookmarks.cjs');

const watchers = new Set();
/** The fields a comparison needs, so a later change to a live node object cannot alter what was remembered. */
const compact = nodes => nodes.map(node => ({ id: node.id, browserProfileId: node.browserProfileId, parentId: node.parentId ?? null, title: node.title, url: node.url, position: node.position, createdAt: node.createdAt, tor: node.tor }));
const same = (a, b) => a.length === b.length && a.every((x, i) => { const y = b[i]; return x.id === y.id && x.parentId === y.parentId && x.title === y.title && x.url === y.url && x.position === y.position && x.tor === y.tor; });

/** Called by main.cjs with a window's bookmark list (every profile's nodes). Costs nothing while no extension watches. */
function noteBookmarks(nodes) {
  if (!watchers.size || !Array.isArray(nodes)) return;
  for (const watcher of [...watchers]) { try { watcher.note(nodes); } catch { /* one extension runtime never stops the others */ } }
}
/** An import into a profile begins or ends (onImportBegan / onImportEnded); the bookmarks it adds arrive between the two as onCreated. */
function signal(name, profileId) {
  if (!watchers.size || typeof profileId !== 'string') return;
  for (const watcher of [...watchers]) if (watcher.profileId === profileId) { try { watcher.signal(name); } catch { /* ignore */ } }
}
const importBegan = profileId => signal('bookmarks.onImportBegan', profileId), importEnded = profileId => signal('bookmarks.onImportEnded', profileId);

/**
 * Watch one profile. `initial`: the profile's nodes now, or null when no window can say yet (the first note then only learns the list).
 * `deliver(name, ...args)` sends one event to the profile's extensions. Returns a function that stops the watch.
 */
function watch({ profileId, initial = null, deliver, later = fn => setImmediate(fn) }) {
  let last = Array.isArray(initial) ? compact(initial.filter(node => node && node.browserProfileId === profileId)) : null;
  const note = nodes => {
    const now = compact(nodes.filter(node => node && node.browserProfileId === profileId)), before = last;
    last = now;
    if (before === null || same(before, now)) return;
    const events = model.diffEvents(before, now);
    if (events.length) later(() => { for (const event of events) { try { deliver(event.name, ...event.args); } catch { /* delivery never breaks a bookmark change */ } } });
  };
  const send = (name, args) => later(() => { try { deliver(name, ...args); } catch { /* delivery never breaks a bookmark change */ } });
  const watcher = { profileId, note, signal: name => send(name, []) };
  watchers.add(watcher);
  const stopWatching = () => { watchers.delete(watcher); };
  /** The profile's nodes are now `nodes` and its extensions have been told (a buffered burst of writes already sent its own events): the next list that equals it says nothing. */
  stopWatching.adopt = nodes => { last = compact(nodes.filter(node => node && node.browserProfileId === profileId)); };
  /** One event to this profile's extensions, now (after the current step), in the order given. */
  stopWatching.emit = (name, ...args) => send(name, args);
  return stopWatching;
}

/** For tests: forget every watcher. */
const reset = () => watchers.clear();

module.exports = { noteBookmarks, importBegan, importEnded, watch, reset };
