'use strict';
// chrome.bookmarks for extensions: Chrome's tree and Chrome's rules over Acira's own bookmark nodes (BookmarkNode in src/runtime/types.ts).
// Pure functions, no Electron: the node lists go in and come out, main.cjs applies a result with the `bookmark.replace` action, so the sidebar,
// the bookmarks bar, the bookmarks page and every other window of the profile follow at once, and chrome.bookmarks events are worked out from
// the before/after lists (diffEvents), whoever made the change (the person, an import, another window or an extension).
//
// THE TREE. Chrome has a root "0" holding "Bookmarks bar" ("1") and "Other bookmarks" ("2"); Acira has a forest whose top level holds starred
// pages, the person's own folders and, once used, two folders named "Bookmarks bar" and "Other bookmarks" (core.ts placeFolder, imports). The
// extension sees:
//   "1"  the top-level pages (they show on Acira's bar), then the children of the folder named "Bookmarks bar"
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
  invalidMoveDestination: "Can't move a folder to itself or its descendant.",
  // Acira's own: its bookmarks are web pages (imports leave other addresses out for the same reason).
  webOnly: 'Acira keeps web pages (http and https addresses) as bookmarks.'
});
const MAX_TITLE = 2048, MAX_URL = 8192, MAX_ID = 160;
const failure = message => ({ error: message });
const time = value => { const n = typeof value === 'number' ? value : Date.parse(value); return Number.isFinite(n) ? n : 0; };
const isNamed = (node, title) => !node.url && String(node.title || '').trim().toLowerCase() === title.toLowerCase();

/** An address as bookmarks hold it: an http(s) URL (the same text, trimmed), or an error message. */
function checkUrl(value) {
  const text = String(value).trim();
  if (!text || text.length > MAX_URL) return { error: ERRORS.invalidUrl };
  let parsed; try { parsed = new URL(text); } catch { return { error: ERRORS.invalidUrl }; }
  if (!/^https?:$/.test(parsed.protocol)) return { error: ERRORS.webOnly };
  return { url: text };
}
const isId = value => typeof value === 'string' && value.length > 0 && value.length <= MAX_ID;
const isIndex = value => Number.isInteger(value);

/**
 * Chrome's view of one profile's bookmark nodes. `skip` leaves some nodes out of the child lists (a node being placed again).
 * Lookups by Chrome id; records are BookmarkTreeNode objects without `children` (tree() and subTree() add them).
 */
function createView(allNodes, { skip = null } = {}) {
  const nodes = allNodes.filter(node => node && !node.tor);
  const byId = new Map(nodes.map(node => [node.id, node]));
  const order = new Map(nodes.map((node, i) => [node, i]));
  const kids = new Map();   // physical parent id (null: top level) -> children, in position order
  for (const node of nodes) {
    const parent = node.parentId && byId.has(node.parentId) && !byId.get(node.parentId).url ? node.parentId : null;
    if (!kids.has(parent)) kids.set(parent, []);
    kids.get(parent).push(node);
  }
  for (const list of kids.values()) list.sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || order.get(a) - order.get(b));
  const top = kids.get(null) || [];
  const bar = top.find(node => isNamed(node, BAR_TITLE)) || null, other = top.find(node => isNamed(node, OTHER_TITLE)) || null;
  const of = parent => (kids.get(parent) || []).filter(node => !skip || !skip.has(node));
  const cid = node => node === bar ? BAR : node === other ? OTHER : node.id;
  const zones = {
    [BAR]: { first: () => of(null).filter(node => node.url), folder: bar, accepts: node => !!node.url, title: BAR_TITLE },
    [OTHER]: { first: () => of(null).filter(node => !node.url && node !== bar && node !== other), folder: other, accepts: node => !node.url, title: OTHER_TITLE }
  };
  /** The Chrome children of a Chrome id (Acira nodes; for "0" the two virtual folders are null placeholders), or null for an unknown id or a page. */
  function listOf(id) {
    if (id === ROOT) return [BAR, OTHER];
    const zone = zones[id];
    if (zone) return [...zone.first(), ...(zone.folder ? of(zone.folder.id) : [])];
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
  return { nodes, byId, bar, other, zones, of, cid, listOf, nodeOf, exists, parentOfId, record, subTree, idsUnder, all, under, tree: () => subTree(ROOT) };
}

// ---------------------------------------------------------------------------------------------------------------- writing
const clone = nodes => nodes.map(node => ({ ...node }));
/** Sibling positions become 0..n-1 per parent, in the order they sort (a node placed at "position - 0.5" lands before that one). */
function renumber(draft) {
  const groups = new Map(), order = new Map(draft.map((node, i) => [node, i]));
  for (const node of draft) { const key = node.parentId || null; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(node); }
  for (const list of groups.values()) { list.sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || order.get(a) - order.get(b)); list.forEach((node, i) => { node.position = i; }); }
}
/** The folder an extension's write into "1" or "2" lands in: Acira's own, made now when it is not there yet (core.ts placeFolder: id, title, end of the top level). */
function ensureFolder(draft, zoneId, { now, profileId }) {
  const view = createView(draft), zone = view.zones[zoneId];
  if (zone.folder) return zone.folder;
  const token = zoneId === BAR ? 'bookmarks-bar' : 'other-bookmarks';
  const folder = { id: draft.some(node => node.id === token) ? `folder-${crypto.randomUUID()}` : token, browserProfileId: profileId || draft[0]?.browserProfileId, parentId: null, title: zone.title, position: Number.MAX_SAFE_INTEGER, createdAt: now };
  draft.push(folder);
  return folder;
}
/**
 * Puts `node` at Chrome index `index` of the Chrome parent `parentId` (the index counts the children without the node itself).
 * Into "1" and "2" the index lands in the first part (top-level pages, top-level folders) when it is inside it and the node belongs there,
 * or when Acira has no folder of that name; otherwise in Acira's own folder (made now when missing).
 */
function place(draft, node, parentId, index, { now, profileId }) {
  const view = createView(draft, { skip: new Set([node]) });
  const siblingsOf = parent => draft.filter(item => (item.parentId || null) === parent && item !== node);
  const put = (parent, successor) => {
    const siblings = siblingsOf(parent);
    node.parentId = parent;
    node.position = successor ? (successor.position ?? 0) - 0.5 : (siblings.length ? Math.max(...siblings.map(item => item.position ?? 0)) : -1) + 1;
  };
  const zone = view.zones[parentId];
  if (zone) {
    const first = zone.first();
    // Without Acira's own folder an item that belongs in the first part simply goes there (a page on the bar, a folder at the top level): nothing is made.
    if (zone.accepts(node) && (index < first.length || !zone.folder)) return put(null, first[index] || null);
    const target = zone.folder || ensureFolder(draft, parentId, { now, profileId }), children = view.of(target.id);
    return put(target.id, children[Math.max(0, Math.min(index - first.length, children.length))] || null);
  }
  const folder = view.nodeOf(parentId), children = view.of(folder.id);
  return put(folder.id, children[Math.max(0, Math.min(index, children.length))] || null);
}

/** The shared front of write calls: the profile's nodes cloned, and a fresh view. */
function begin(nodes) { const draft = clone(nodes); renumber(draft); return draft; }
const finish = draft => { renumber(draft); return draft; };

function create(nodes, info, context = {}) {
  const { newId = kind => `${kind}-${crypto.randomUUID()}`, now = Date.now() } = context, profileId = context.profileId || nodes[0]?.browserProfileId;
  const details = info && typeof info === 'object' ? info : {};
  const draft = begin(nodes), view = createView(draft);
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
  place(draft, made, parentId, index, { now, profileId });
  finish(draft);
  return { nodes: draft, result: createView(draft).record(made.id) };
}

function update(nodes, id, changes) {
  const details = changes && typeof changes === 'object' ? changes : {};
  let url; if (typeof details.url === 'string' && details.url !== '') { const checked = checkUrl(details.url); if (checked.error) return failure(checked.error); url = checked.url; }
  if (!isId(id)) return failure(ERRORS.invalidId);
  const draft = begin(nodes), view = createView(draft);
  if (!view.exists(id)) return failure(ERRORS.noNode);
  if (id === ROOT || id === BAR || id === OTHER) return failure(ERRORS.modifySpecial);
  const node = draft.find(item => item.id === id);
  if (url !== undefined && !node.url) return failure(ERRORS.cannotSetUrlOfFolder);
  if (typeof details.title === 'string') node.title = details.title.slice(0, MAX_TITLE);
  if (url !== undefined) node.url = url;
  return { nodes: draft, result: createView(draft).record(id) };
}

function move(nodes, id, destination, context = {}) {
  const { now = Date.now() } = context, profileId = context.profileId || nodes[0]?.browserProfileId;
  const details = destination && typeof destination === 'object' ? destination : {};
  if (!isId(id)) return failure(ERRORS.invalidId);
  const draft = begin(nodes), view = createView(draft);
  if (!view.exists(id)) return failure(ERRORS.noNode);
  if (id === ROOT || id === BAR || id === OTHER) return failure(ERRORS.modifySpecial);
  const node = draft.find(item => item.id === id), was = view.record(id);
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
    if (index === was.index || index === was.index + 1) return { nodes: draft, result: was, unchanged: true };
    if (index > was.index) index--;
  }
  place(draft, node, parentId, index, { now, profileId });
  finish(draft);
  return { nodes: draft, result: createView(draft).record(id) };
}

function remove(nodes, id, { recursive = false } = {}) {
  if (!isId(id)) return failure(ERRORS.invalidId);
  const draft = begin(nodes), view = createView(draft);
  if (!view.exists(id)) return failure(ERRORS.noNode);
  if (id === ROOT || id === BAR || id === OTHER) return failure(ERRORS.modifySpecial);
  const node = draft.find(item => item.id === id);
  if (!node.url && view.listOf(id).length && !recursive) return failure(ERRORS.folderNotEmpty);
  // The node and everything under it, Tor pages aside (they are not the extension's to remove: they move to the top level).
  const doomed = new Set([id]);
  let grew = true;
  while (grew) { grew = false; for (const item of draft) if (item.parentId && doomed.has(item.parentId) && !doomed.has(item.id) && !item.tor) { doomed.add(item.id); grew = true; } }
  const kept = draft.filter(item => !doomed.has(item.id));
  for (const item of kept) if (item.parentId && doomed.has(item.parentId)) { item.parentId = null; item.position = Number.MAX_SAFE_INTEGER; }
  finish(kept);
  return { nodes: kept, result: undefined };
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
