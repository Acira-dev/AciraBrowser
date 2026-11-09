'use strict';
// chrome.bookmarks for extensions: Chrome's tree and Chrome's rules over Acira's own bookmark nodes (BookmarkNode in src/runtime/types.ts).
// Pure functions, no Electron: the node lists go in and come out, main.cjs applies a result with the `bookmark.replace` action, so the sidebar,
// the bookmarks bar, the bookmarks page and every other window of the profile follow at once, and chrome.bookmarks events are worked out from
// the before/after lists (diffEvents), whoever made the change (the person, an import, another window or an extension).
//
// THE TREE. Chrome has a root "0" holding "Bookmarks bar" ("1") and "Other bookmarks" ("2"); Acira has a forest whose top level holds starred
// pages, the person's own folders and, once used, two folders named "Bookmarks bar" and "Other bookmarks" (core.ts placeFolder, imports). The
// extension sees:
//   "1"  the top-level pages above the folder named "Bookmarks bar" (they show on Acira's bar), then that folder's children, then the top-level pages below it
//        (the order Acira's own sidebar lists them in; without that folder, all top-level pages)
//   "2"  the top-level folders other than those two, then the children of the folder named "Other bookmarks"
//   a folder           its own children
// "1" and "2" are always there, even before Acira has made either folder; a write into one makes it (placeFolder's id and title). The person
// sees no change: nothing moves until an extension moves it, and an extension's folders and pages land in the same two folders an import from
// Chrome fills. Pages saved from a Tor tab (node.tor) are never visible to an extension, and a folder an extension removes never takes one
// with it (it goes to the top level).
const crypto = require('node:crypto');

const ROOT = '0', BAR = '1', OTHER = '2';
const BAR_TITLE = 'Bookmarks bar', OTHER_TITLE = 'Other bookmarks';
// Chromium: chrome/browser/extensions/bookmarks/bookmarks_error_constants.cc
const ERRORS = Object.freeze({
  noNode: "Can't find bookmark for id.",
  noParent: "Can't find parent bookmark for id.",
  folderNotEmpty: "Can't remove non-empty folder (use recursive to force).",
  invalidId: 'Bookmark id is invalid.',
  invalidIndex: 'Index out of bounds.',
  invalidParent: "Parameter 'parentId' does not specify a folder.",
  invalidUrl: 'Invalid URL.',
  modifySpecial: "Can't modify the root bookmark folders.",
  cannotSetUrlOfFolder: "Can't set URL of a bookmark folder.",
  invalidMoveDestination: "Can't move a folder to itself or its descendant."
});
const MAX_TITLE = 2048, MAX_URL = 32768, MAX_ID = 160;
const failure = message => ({ error: message });
const time = value => { const n = typeof value === 'number' ? value : Date.parse(value); return Number.isFinite(n) ? n : 0; };
const isNamed = (node, title) => !node.url && String(node.title || '').trim().toLowerCase() === title.toLowerCase();

/**
 * An address as bookmarks hold it: the text, trimmed, when it is a valid absolute URL of any scheme (Chrome keeps bookmarklets, chrome://, file:
 * and the rest; a sync extension has to get back what it stored, or it takes the missing item for a deletion and removes it from its server).
 * Acira's own screens treat anything but http(s) as inert: it is listed, never opened (validation.cjs refuses to navigate to it).
 */
function checkUrl(value) {
  const text = String(value).trim();
  if (!text || text.length > MAX_URL) return { error: ERRORS.invalidUrl };
  try { new URL(text); } catch { return { error: ERRORS.invalidUrl }; }
  return { url: text };
}
const isId = value => typeof value === 'string' && value.length > 0 && value.length <= MAX_ID;
const isIndex = value => Number.isInteger(value);

/**
 * Chrome's view of one profile's bookmark nodes. `skip` leaves some nodes out of the child lists (a node being placed again).
 * Lookups by Chrome id; records are BookmarkTreeNode objects without `children` (tree() and subTree() add them).
 */
function createView(allNodes, options = {}) {
  const hold = { skip: options.skip || null };
  const nodes = allNodes.filter(node => node && !node.tor);
  const byId = new Map(nodes.map(node => [node.id, node]));
  const kids = new Map();   // physical parent id (null: top level) -> children, in position order
  for (const node of nodes) {
    const parent = node.parentId && byId.has(node.parentId) && !byId.get(node.parentId).url ? node.parentId : null;
    if (!kids.has(parent)) kids.set(parent, []);
    kids.get(parent).push(node);
  }
  for (const list of kids.values()) list.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));   // stable: equal positions keep the list's order
  const top = kids.get(null) || [];
  const bar = top.find(node => isNamed(node, BAR_TITLE)) || null, other = top.find(node => isNamed(node, OTHER_TITLE)) || null;
  const of = parent => (kids.get(parent) || []).filter(node => !hold.skip || !hold.skip.has(node));
  const cid = node => node === bar ? BAR : node === other ? OTHER : node.id;
  // "1": the top-level pages above the folder, its children, the top-level pages below it. "2": the top-level folders, then the children of its folder.
  const pagesAround = side => { const top = of(null), at = bar ? top.indexOf(bar) : -1; return top.filter((node, i) => node.url && (side === 'before' ? at < 0 || i < at : at >= 0 && i > at)); };
  const zones = {
    [BAR]: { before: () => pagesAround('before'), after: () => pagesAround('after'), folder: bar, accepts: node => !!node.url, title: BAR_TITLE },
    [OTHER]: { first: () => of(null).filter(node => !node.url && node !== bar && node !== other), folder: other, accepts: node => !node.url, title: OTHER_TITLE }
  };
  /** The Chrome children of a Chrome id (Acira nodes; for "0" the two virtual folders are null placeholders), or null for an unknown id or a page. */
  function listOf(id) {
    if (id === ROOT) return [BAR, OTHER];
    const zone = zones[id];
    if (zone) { const inside = zone.folder ? of(zone.folder.id) : []; return id === BAR ? [...zone.before(), ...inside, ...zone.after()] : [...zone.first(), ...inside]; }
    const node = byId.get(id);
    return node && !node.url && node !== bar && node !== other ? of(node.id) : null;
  }
  /** Acira node for a Chrome id; "0", "1" and "2" have none unless Acira has made the folder. */
  const nodeOf = id => id === BAR ? bar : id === OTHER ? other : id === ROOT ? null : byId.get(id) || null;
  const exists = id => id === ROOT || id === BAR || id === OTHER || (byId.has(id) && id !== bar?.id && id !== other?.id);
  function chromeParent(node) {
    if (node === bar || node === other) return ROOT;
    const parent = node.parentId && byId.has(node.parentId) && !byId.get(node.parentId).url ? byId.get(node.parentId) : null;
    if (!parent) return node.url ? BAR : OTHER;
    return cid(parent);
  }
  const parentOfId = id => id === ROOT ? null : id === BAR || id === OTHER ? ROOT : exists(id) ? chromeParent(byId.get(id)) : null;
  function record(id) {
    if (id === ROOT) return { id: ROOT, title: '', dateAdded: 0, dateGroupModified: 0 };
    const node = nodeOf(id), special = id === BAR || id === OTHER;
    if (!node && !special) return null;
    const parentId = parentOfId(id), index = idsUnder(parentId).indexOf(id);
    if (!node) return { id, parentId: ROOT, index: id === BAR ? 0 : 1, title: id === BAR ? BAR_TITLE : OTHER_TITLE, dateAdded: 0, dateGroupModified: 0, folderType: id === BAR ? 'bookmarks-bar' : 'other' };
    const out = { id, parentId, index: index < 0 ? 0 : index, title: String(node.title || ''), dateAdded: time(node.createdAt) };
    if (node.url) out.url = String(node.url); else out.dateGroupModified = out.dateAdded;
    if (id === BAR) out.folderType = 'bookmarks-bar'; else if (id === OTHER) out.folderType = 'other';
    return out;
  }
  const idsUnder = id => (listOf(id) || []).map(item => typeof item === 'string' ? item : cid(item));
  function subTree(id) {
    const out = record(id);
    if (!out || out.url !== undefined) return out;
    out.children = idsUnder(id).map(child => subTree(child));
    return out;
  }
  const all = () => {
    const out = [];
    const walk = id => { out.push(id); for (const child of idsUnder(id)) walk(child); };
    walk(ROOT);
    return out;
  };
  /** Does `id` stand at or under `ancestor` in Chrome's tree? */
  function under(id, ancestor) {
    for (let at = id, steps = 0; at !== null && steps < 10000; at = parentOfId(at), steps++) if (at === ancestor) return true;
    return false;
  }
  return { nodes, byId, bar, other, zones, of, cid, listOf, nodeOf, exists, parentOfId, record, subTree, idsUnder, all, under, tree: () => subTree(ROOT), skip: set => { hold.skip = set; } };
}

// ---------------------------------------------------------------------------------------------------------------- writing
// Every write takes the profile's nodes and a context {profileId, newId, now, owned}. With owned: true the list is the caller's own working copy
// (extension-bookmark-buffer.cjs keeps one while a burst of writes is coalesced): it is changed in place and every later call skips the clone
// and the first renumbering. Otherwise the list given is never touched. A result is {nodes, result, events} or {error}; `events` are the
// chrome.bookmarks events of that one call, in Chrome's form, so a burst needs no before/after comparison to be told to extensions.
const clone = nodes => nodes.map(node => ({ ...node }));
const markNormalized = draft => { Object.defineProperty(draft, 'normalized', { value: true, enumerable: false, configurable: true, writable: true }); return draft; };
/** Sibling positions become 0..n-1 per parent, in the order they sort (a node placed at "position - 0.5" lands before that one; equal ones keep the list's order). `only`: just these parents (null: the top level). */
function renumber(draft, only = null) {
  const groups = new Map();
  for (const node of draft) { const key = node.parentId || null; if (only && !only.has(key)) continue; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(node); }
  for (const list of groups.values()) { list.sort((a, b) => (a.position ?? 0) - (b.position ?? 0)); list.forEach((node, i) => { node.position = i; }); }
}
/** The folder an extension's write into "1" or "2" lands in: Acira's own, made now when it is not there yet (core.ts placeFolder: id, title, end of the top level). */
function ensureFolder(draft, view, zoneId, { now, profileId }) {
  const zone = view.zones[zoneId];
  if (zone.folder) return zone.folder;
  const token = zoneId === BAR ? 'bookmarks-bar' : 'other-bookmarks';
  const tops = draft.filter(node => !node.parentId);
  const folder = { id: draft.some(node => node.id === token) ? `folder-${crypto.randomUUID()}` : token, browserProfileId: profileId || draft[0]?.browserProfileId, parentId: null, title: zone.title, position: tops.length ? Math.max(...tops.map(node => node.position ?? 0)) + 1 : 0, createdAt: now };
  draft.push(folder);
  return folder;
}
/**
 * Puts `node` at Chrome index `index` of the Chrome parent `parentId` (the index counts the children without the node itself) and answers
 * the index it really got. Into "1" and "2" the index lands in the first part (top-level pages, top-level folders) when it is inside it and the
 * node belongs there, or when Acira has no folder of that name; otherwise in Acira's own folder (made now when missing).
 * `view` is the one the call built; the node being placed is left out of its lists here.
 */
function place(draft, view, node, parentId, index, { now, profileId, fresh = false }) {
  view.skip(new Set([node]));
  const siblingsOf = parent => draft.filter(item => (item.parentId || null) === parent && item !== node);
  const put = (parent, successor) => {
    const siblings = siblingsOf(parent);
    node.parentId = parent;
    node.position = successor ? (successor.position ?? 0) - 0.5 : (siblings.length ? Math.max(...siblings.map(item => item.position ?? 0)) : -1) + 1;
  };
  const zone = view.zones[parentId];
  if (zone && parentId === BAR) {
    // One list: the pages above Acira's bar folder, the folder's items, the pages below it. A page lands in the part the index falls in (the ends are
    // Acira's bar; between the folder's items it is one of them); a folder always lives in the folder, and a folder asked to stand before pages above
    // the bar folder takes them to below it (their order, and Acira's bar, do not change), so the order an extension asks for is the order it gets.
    const before = zone.before(), after = zone.after(), count = before.length + (zone.folder ? view.of(zone.folder.id).length : 0) + after.length;
    const at = Math.max(0, Math.min(index, count));
    if (node.url) {
      if (!zone.folder || at <= before.length) { if (zone.folder) put(null, before[at] || zone.folder); else put(null, before[at] || null); return Math.min(at, before.length); }
      const inside = view.of(zone.folder.id);
      if (at < before.length + inside.length) { put(zone.folder.id, inside[at - before.length] || null); return at; }
      const j = at - before.length - inside.length; put(null, after[j] || null); return before.length + inside.length + Math.min(j, after.length);
    }
    const target = zone.folder || ensureFolder(draft, view, parentId, { now, profileId }), inside = view.of(target.id);
    if (at < before.length) {
      const moved = before.slice(at);
      // the order of the pages among themselves, and Acira's bar, stay as they are; the list an extension sees changes more than it asked, so the call's events come from a comparison
      view.reshuffled = clone(fresh ? draft.filter(item => item !== node) : draft);
      moved.forEach((page, k) => { page.position = (target.position ?? 0) + (k + 1) / (moved.length + 1) * 0.5; });
      put(target.id, inside[0] || null);
      return at;
    }
    const slot = Math.min(at - before.length, inside.length);
    put(target.id, inside[slot] || null);
    return before.length + slot;
  }
  if (zone) {
    const first = zone.first();
    // Without Acira's own folder an item that belongs in the first part simply goes there (a page on the bar, a folder at the top level): nothing is made.
    if (zone.accepts(node) && (index < first.length || !zone.folder)) { const at = Math.min(index, first.length); put(null, first[at] || null); return at; }
    const target = zone.folder || ensureFolder(draft, view, parentId, { now, profileId }), children = view.of(target.id), at = Math.max(0, Math.min(index - first.length, children.length));
    put(target.id, children[at] || null);
    return first.length + at;
  }
  const folder = view.nodeOf(parentId), children = view.of(folder.id), at = Math.max(0, Math.min(index, children.length));
  put(folder.id, children[at] || null);
  return at;
}
/** The BookmarkTreeNode record of a node at a known place (what createView().record answers, without building the view again). */
function recordAt(node, parentId, index) {
  const out = { id: node.id, parentId, index, title: String(node.title || ''), dateAdded: time(node.createdAt) };
  if (node.url) out.url = String(node.url); else out.dateGroupModified = out.dateAdded;
  return out;
}

/** The working list of a write: the caller's own (owned), or a copy with sibling positions made 0..n-1. */
function begin(nodes, owned) {
  if (owned) { if (!nodes.normalized) { renumber(nodes); markNormalized(nodes); } return nodes; }
  const draft = clone(nodes); renumber(draft); return markNormalized(draft);
}
const finish = (draft, only = null) => { renumber(draft, only); return markNormalized(draft); };

function create(nodes, info, context = {}) {
  const { newId = kind => `${kind}-${crypto.randomUUID()}`, now = Date.now(), owned = false } = context, profileId = context.profileId || nodes[0]?.browserProfileId;
  const details = info && typeof info === 'object' ? info : {};
  const draft = begin(nodes, owned), view = createView(draft);
  const parentId = details.parentId === undefined || details.parentId === null ? OTHER : details.parentId;
  if (!isId(parentId)) return failure(ERRORS.invalidId);
  if (parentId === ROOT) return failure(ERRORS.modifySpecial);
  if (!view.exists(parentId)) return failure(ERRORS.noParent);
  const parentNode = view.nodeOf(parentId);
  if (parentNode && parentNode.url) return failure(ERRORS.invalidParent);
  const count = view.listOf(parentId).length;
  const index = details.index === undefined || details.index === null ? count : details.index;
  if (!isIndex(index) || index < 0 || index > count) return failure(ERRORS.invalidIndex);
  const hasUrl = typeof details.url === 'string' && details.url !== '';
  let url; if (hasUrl) { const checked = checkUrl(details.url); if (checked.error) return failure(checked.error); url = checked.url; }
  const title = typeof details.title === 'string' ? details.title.slice(0, MAX_TITLE) : '';
  const made = { id: newId(hasUrl ? 'bookmark' : 'folder'), browserProfileId: profileId, parentId: null, title, ...(hasUrl ? { url } : {}), position: 0, createdAt: now };
  draft.push(made);
  const at = place(draft, view, made, parentId, index, { now, profileId, fresh: true });
  finish(draft, new Set([made.parentId || null, null]));
  const result = recordAt(made, parentId, at);
  return { nodes: draft, result, events: view.reshuffled ? diffEvents(view.reshuffled, draft) : [{ name: 'bookmarks.onCreated', args: [made.id, result] }] };
}

function update(nodes, id, changes, context = {}) {
  const details = changes && typeof changes === 'object' ? changes : {};
  let url; if (typeof details.url === 'string' && details.url !== '') { const checked = checkUrl(details.url); if (checked.error) return failure(checked.error); url = checked.url; }
  if (!isId(id)) return failure(ERRORS.invalidId);
  const draft = begin(nodes, !!context.owned), view = createView(draft);
  if (!view.exists(id)) return failure(ERRORS.noNode);
  if (id === ROOT || id === BAR || id === OTHER) return failure(ERRORS.modifySpecial);
  const node = view.nodeOf(id);
  if (url !== undefined && !node.url) return failure(ERRORS.cannotSetUrlOfFolder);
  const was = view.record(id);
  if (typeof details.title === 'string') node.title = details.title.slice(0, MAX_TITLE);
  if (url !== undefined) node.url = url;
  const result = recordAt(node, was.parentId, was.index);
  const changed = result.title !== was.title || result.url !== was.url;
  return { nodes: draft, result, events: changed ? [{ name: 'bookmarks.onChanged', args: [id, { title: result.title, ...(result.url !== undefined ? { url: result.url } : {}) }] }] : [] };
}

function move(nodes, id, destination, context = {}) {
  const { now = Date.now(), owned = false } = context, profileId = context.profileId || nodes[0]?.browserProfileId;
  const details = destination && typeof destination === 'object' ? destination : {};
  if (!isId(id)) return failure(ERRORS.invalidId);
  const draft = begin(nodes, owned), view = createView(draft);
  if (!view.exists(id)) return failure(ERRORS.noNode);
  if (id === ROOT || id === BAR || id === OTHER) return failure(ERRORS.modifySpecial);
  const node = view.nodeOf(id), was = view.record(id);
  const parentId = details.parentId === undefined || details.parentId === null ? was.parentId : details.parentId;
  if (!isId(parentId)) return failure(ERRORS.invalidId);
  if (parentId === ROOT) return failure(ERRORS.modifySpecial);
  if (!view.exists(parentId)) return failure(ERRORS.noNode);
  const parentNode = view.nodeOf(parentId);
  if (parentNode && parentNode.url) return failure(ERRORS.invalidParent);
  if (view.under(parentId, id)) return failure(ERRORS.invalidMoveDestination);
  const count = view.listOf(parentId).length;
  let index = details.index === undefined || details.index === null ? count : details.index;
  if (!isIndex(index) || index < 0 || index > count) return failure(ERRORS.invalidIndex);
  if (parentId === was.parentId) {
    // Chrome's BookmarkModel::Move: the index counts the node itself; putting it where it is (or just after) changes nothing.
    if (index === was.index || index === was.index + 1) return { nodes: draft, result: was, unchanged: true, events: [] };
    if (index > was.index) index--;
  }
  const oldParent = node.parentId || null;
  const at = place(draft, view, node, parentId, index, { now, profileId });
  finish(draft, new Set([oldParent, node.parentId || null, null]));
  const result = recordAt(node, parentId, at);
  const moved = result.parentId !== was.parentId || result.index !== was.index;
  return { nodes: draft, result, events: view.reshuffled ? diffEvents(view.reshuffled, draft) : moved ? [{ name: 'bookmarks.onMoved', args: [id, { parentId: result.parentId, index: result.index, oldParentId: was.parentId, oldIndex: was.index }] }] : [] };
}

function remove(nodes, id, { recursive = false, owned = false } = {}) {
  if (!isId(id)) return failure(ERRORS.invalidId);
  const draft = begin(nodes, owned), view = createView(draft);
  if (!view.exists(id)) return failure(ERRORS.noNode);
  if (id === ROOT || id === BAR || id === OTHER) return failure(ERRORS.modifySpecial);
  const node = view.nodeOf(id);
  if (!node.url && view.listOf(id).length && !recursive) return failure(ERRORS.folderNotEmpty);
  const was = view.record(id), branch = view.subTree(id);
  // The node and everything under it, Tor pages aside (they are not the extension's to remove: they move to the top level).
  const doomed = new Set([id]);
  let grew = true;
  while (grew) { grew = false; for (const item of draft) if (item.parentId && doomed.has(item.parentId) && !doomed.has(item.id) && !item.tor) { doomed.add(item.id); grew = true; } }
  const kept = draft.filter(item => !doomed.has(item.id)), touched = new Set([node.parentId || null, null]);
  for (const item of kept) if (item.parentId && doomed.has(item.parentId)) { item.parentId = null; item.position = Number.MAX_SAFE_INTEGER; }
  finish(kept, touched);
  return { nodes: kept, result: undefined, events: [{ name: 'bookmarks.onRemoved', args: [id, { parentId: was.parentId, index: was.index, node: branch }] }] };
}

// ---------------------------------------------------------------------------------------------------------------- events
/** longest increasing run of `values` (indices), so only the nodes outside it count as moved */
function stayers(values) {
  const tails = [], prev = new Array(values.length).fill(-1), at = [];
  values.forEach((value, i) => {
    let lo = 0, hi = tails.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (values[tails[mid]] < value) lo = mid + 1; else hi = mid; }
    if (lo > 0) prev[i] = tails[lo - 1];
    tails[lo] = i; at[lo] = i;
  });
  const keep = new Set();
  for (let i = tails.length ? tails[tails.length - 1] : -1; i >= 0; i = prev[i]) keep.add(i);
  return keep;
}

/**
 * chrome.bookmarks events for a change of one profile's nodes: [{name, args}] in the order created, changed, moved/reordered, removed.
 * A node whose place only shifted because a sibling came or went did not move. One node out of order is onMoved; several in one folder at
 * once (Sort by name) are one onChildrenReordered.
 */
function diffEvents(before, after) {
  const a = createView(before), b = createView(after);
  const idsA = new Set(a.all()), idsB = new Set(b.all());
  const events = [];
  const created = [...idsB].filter(id => !idsA.has(id));   // tree order: a folder before what it holds
  for (const id of created) events.push({ name: 'bookmarks.onCreated', args: [id, b.record(id)] });
  const both = [...idsB].filter(id => idsA.has(id) && id !== ROOT);
  for (const id of both) {
    const x = a.record(id), y = b.record(id);
    if (!x || !y || (x.title === y.title && x.url === y.url)) continue;
    events.push({ name: 'bookmarks.onChanged', args: [id, { title: y.title, ...(y.url !== undefined ? { url: y.url } : {}) }] });
  }
  const reorder = [];
  for (const id of both) {   // moved to another parent
    const x = a.record(id), y = b.record(id);
    if (x && y && x.parentId !== y.parentId) events.push({ name: 'bookmarks.onMoved', args: [id, { parentId: y.parentId, index: y.index, oldParentId: x.parentId, oldIndex: x.index }] });
  }
  for (const parent of [...idsB].filter(id => idsA.has(id) && b.listOf(id))) {   // same parent, another order
    const was = a.idsUnder(parent), now = b.idsUnder(parent);
    const wasSet = new Set(was), stay = new Set(now.filter(id => wasSet.has(id) && b.parentOfId(id) === a.parentOfId(id)));
    const old = was.filter(id => stay.has(id)), next = now.filter(id => stay.has(id));
    if (old.length < 2 || old.every((id, i) => id === next[i])) continue;
    const rank = new Map(old.map((id, i) => [id, i])), keep = stayers(next.map(id => rank.get(id)));
    const out = next.filter((_, i) => !keep.has(i));
    if (out.length > 1) reorder.push({ name: 'bookmarks.onChildrenReordered', args: [parent, { childIds: now }] });
    else for (const id of out) { const x = a.record(id), y = b.record(id); events.push({ name: 'bookmarks.onMoved', args: [id, { parentId: y.parentId, index: y.index, oldParentId: x.parentId, oldIndex: x.index }] }); }
  }
  events.push(...reorder);
  const gone = [...idsA].filter(id => !idsB.has(id)), goneSet = new Set(gone);   // only the top of a removed branch, with its contents
  for (const id of gone) {
    const x = a.record(id);
    if (!x || goneSet.has(x.parentId)) continue;
    events.push({ name: 'bookmarks.onRemoved', args: [id, { parentId: x.parentId, index: x.index, node: a.subTree(id) }] });
  }
  return events;
}

module.exports = { ROOT, BAR, OTHER, ERRORS, createView, create, update, move, remove, diffEvents, checkUrl };
