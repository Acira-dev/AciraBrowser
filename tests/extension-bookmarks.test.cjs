'use strict';
// chrome.bookmarks for extensions (desktop/browser-services/extension-bookmarks.cjs, extension-store-apis.cjs, extension-bookmark-events.cjs):
// Chrome's tree over Acira's nodes, every write with Chrome's rules and error texts, the events, and the wiring behind the permission.
const test = require('node:test'), assert = require('node:assert/strict'), { EventEmitter } = require('node:events');
const model = require('../desktop/browser-services/extension-bookmarks.cjs');
const { bookmarksApi } = require('../desktop/browser-services/extension-store-apis.cjs');
const events = require('../desktop/browser-services/extension-bookmark-events.cjs');
const bufferModule = require('../desktop/browser-services/extension-bookmark-buffer.cjs');
const { installExtensionApis } = require('../desktop/browser-services/extension-apis.cjs');
const { ERRORS } = model;
const P = 'profile-1';
let counter = 0;
const ids = kind => `${kind}-test-${++counter}`;
const N = (id, parentId, title, position, url, extra = {}) => ({ id, browserProfileId: P, parentId, title, position, createdAt: 1000, ...(url ? { url } : {}), ...extra });
const ctx = { profileId: P, newId: ids, now: 5000 };
const clone = list => list.map(n => ({ ...n }));
const titles = (nodes, id) => { const v = model.createView(nodes); return v.idsUnder(id).map(child => v.record(child).title); };
/** Invariants every result must keep: sibling positions are 0..n-1, parents exist and are folders, no id twice. */
function sound(nodes) {
  const byId = new Map(); for (const node of nodes) { assert.ok(!byId.has(node.id), 'one node per id: ' + node.id); byId.set(node.id, node); }
  const groups = new Map();
  for (const node of nodes) {
    if (node.parentId) { const parent = byId.get(node.parentId); assert.ok(parent && !parent.url, 'parent of ' + node.id + ' is a folder'); }
    const key = node.parentId || null; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(node.position);
  }
  for (const [key, list] of groups) assert.deepEqual([...list].sort((a, b) => a - b), list.map((_, i) => i), 'positions of ' + key + ' are 0..n-1');
  return nodes;
}
const start = () => [
  N('star1', null, 'News', 0, 'https://news.test/'), N('star2', null, 'Mail', 1, 'https://mail.test/'),
  N('work', null, 'Work', 2), N('w1', 'work', 'Docs', 0, 'https://docs.test/'), N('w2', 'work', 'Tickets', 1, 'https://tickets.test/'),
  N('tor1', null, 'Hidden service', 3, 'http://example.onion/', { tor: true })
];

test('the tree is Chrome\'s: root 0 with Bookmarks bar 1 (top-level pages) and Other bookmarks 2 (top-level folders), Tor pages hidden', () => {
  const tree = model.createView(start()).tree();
  assert.equal(tree.id, '0'); assert.equal(tree.parentId, undefined);
  assert.deepEqual(tree.children.map(c => [c.id, c.title, c.folderType, c.index, c.parentId]), [['1', 'Bookmarks bar', 'bookmarks-bar', 0, '0'], ['2', 'Other bookmarks', 'other', 1, '0']]);
  assert.deepEqual(tree.children[0].children.map(c => [c.title, c.index, c.parentId]), [['News', 0, '1'], ['Mail', 1, '1']]);
  assert.deepEqual(tree.children[1].children.map(c => [c.id, c.title, c.index, c.parentId]), [['work', 'Work', 0, '2']]);
  assert.deepEqual(tree.children[1].children[0].children.map(c => [c.title, c.index, c.parentId]), [['Docs', 0, 'work'], ['Tickets', 1, 'work']]);
  assert.ok(!JSON.stringify(tree).includes('onion'), 'a page saved from a Tor tab is never shown to an extension');
  assert.equal(tree.children[0].children[0].children, undefined, 'a page has no children');
  assert.equal(model.createView([]).tree().children.length, 2, 'both folders exist for an empty profile');
});

test('Acira\'s own "Bookmarks bar" and "Other bookmarks" folders are 1 and 2; the bar is the pages above its folder, the folder\'s children, then the pages below it', () => {
  const nodes = [N('bar', null, 'Bookmarks bar', 0), N('b1', 'bar', 'In bar', 0, 'https://b1.test/'), N('b2', 'bar', 'Sub', 1),
    N('oth', null, 'other bookmarks', 1), N('o1', 'oth', 'In other', 0, 'https://o1.test/'), N('star', null, 'Starred', 2, 'https://s.test/'), N('fold', null, 'Loose folder', 3)];
  const v = model.createView(nodes), tree = v.tree();
  assert.deepEqual(tree.children[0].children.map(c => [c.id, c.index]), [['b1', 0], ['b2', 1], ['star', 2]], 'the page below the bar folder comes after the folder\'s children, as the sidebar lists them');
  const above = [N('s0', null, 'Above', 0, 'https://above.test/'), ...nodes.map(n => ({ ...n, position: n.position + 1 }))];
  assert.deepEqual(model.createView(above).idsUnder('1'), ['s0', 'b1', 'b2', 'star'], 'a page above the folder comes first');
  assert.deepEqual(tree.children[1].children.map(c => [c.id, c.index]), [['fold', 0], ['o1', 1]]);
  assert.equal(v.record('b1').parentId, '1'); assert.equal(v.record('o1').parentId, '2');
  assert.equal(v.exists('bar'), false, 'the physical id of the bar folder is not a Chrome id');
  assert.equal(tree.children[0].dateAdded, 1000, 'the real folder\'s date');
});

test('create: defaults to Other bookmarks, honours index, makes a folder when there is no url, and gives Chrome\'s errors', () => {
  let out = model.create(start(), { title: 'New', url: 'https://new.test/' }, ctx);
  sound(out.nodes);
  assert.equal(out.result.parentId, '2'); assert.equal(out.result.title, 'New'); assert.equal(out.result.url, 'https://new.test/'); assert.equal(out.result.children, undefined);
  assert.equal(out.nodes.find(n => n.title === 'Other bookmarks').parentId, null, 'Acira\'s Other bookmarks folder is made, as an import makes it');
  assert.equal(out.result.index, 1, 'after the top-level folder Work, as the last child of Other bookmarks');
  assert.equal(out.nodes.length, start().length + 2);
  // a folder, then a page inside it at index 0
  out = model.create(start(), { parentId: 'work', title: 'First', url: 'https://first.test/', index: 0 }, ctx); sound(out.nodes);
  assert.deepEqual(titles(out.nodes, 'work'), ['First', 'Docs', 'Tickets']); assert.equal(out.result.index, 0);
  out = model.create(start(), { parentId: 'work', title: 'Sub' }, ctx); sound(out.nodes);
  assert.equal(out.result.url, undefined); assert.ok(out.nodes.find(n => n.title === 'Sub' && !n.url && n.id.startsWith('folder-')));
  out = model.create(start(), { parentId: 'work', title: 'Empty url means folder', url: '' }, ctx); assert.equal(out.result.url, undefined);
  // 1: pages stay on the bar without making a folder; index inside the top-level pages keeps its place
  out = model.create(start(), { parentId: '1', title: 'Third', url: 'https://third.test/' }, ctx); sound(out.nodes);
  assert.equal(out.result.index, 2); assert.equal(out.nodes.some(n => n.title === 'Bookmarks bar'), false, 'a page on the bar needs no folder');
  out = model.create(start(), { parentId: '1', title: 'Zero', url: 'https://zero.test/', index: 0 }, ctx);
  assert.deepEqual(titles(out.nodes, '1'), ['Zero', 'News', 'Mail']);
  // a folder into 1 needs Acira's bar folder
  out = model.create(start(), { parentId: '1', title: 'Barfolder' }, ctx); sound(out.nodes);
  assert.equal(out.nodes.filter(n => n.title === 'Bookmarks bar').length, 1); assert.equal(out.result.parentId, '1'); assert.equal(out.result.index, 2);
  // a folder into 2 is a top-level folder; a page in 2 needs the folder
  out = model.create(start(), { parentId: '2', title: 'Topfolder' }, ctx); sound(out.nodes);
  assert.equal(out.nodes.some(n => n.title === 'Other bookmarks'), false); assert.equal(out.nodes.find(n => n.title === 'Topfolder').parentId, null);
  assert.deepEqual(titles(out.nodes, '2'), ['Work', 'Topfolder']);
  // errors, Chrome's texts and order
  assert.equal(model.create(start(), { parentId: '0', title: 'x' }, ctx).error, ERRORS.modifySpecial);
  assert.equal(model.create(start(), { parentId: 'nope', title: 'x' }, ctx).error, ERRORS.noParent);
  assert.equal(model.create(start(), { parentId: '', title: 'x' }, ctx).error, ERRORS.invalidId);
  assert.equal(model.create(start(), { parentId: 'star1', title: 'x' }, ctx).error, ERRORS.invalidParent);
  assert.equal(model.create(start(), { parentId: 'work', index: 3 }, ctx).error, ERRORS.invalidIndex);
  assert.equal(model.create(start(), { parentId: 'work', index: -1 }, ctx).error, ERRORS.invalidIndex);
  assert.equal(model.create(start(), { parentId: 'work', index: 1.5 }, ctx).error, ERRORS.invalidIndex);
  assert.equal(model.create(start(), { url: 'not a url' }, ctx).error, ERRORS.invalidUrl);
  // any valid address is kept, as in Chrome (bookmarklets and chrome:// pages must not stop a sync); a bad one is Chrome's "Invalid URL."
  for (const url of ['javascript:alert(1)', 'javascript:(function(){var a=1;})()', 'file:///etc/passwd', 'chrome://settings', 'about:blank', 'data:text/html,<p>x</p>', 'mailto:me@example.com', 'ftp://files.example.com/a'])
    assert.equal(model.create(start(), { url, title: 'odd' }, ctx).result.url, url, url);
  for (const url of ['not a url', '   ', '://x', 'x'.repeat(40000)]) if (url.trim()) assert.equal(model.create(start(), { url }, ctx).error, ERRORS.invalidUrl, url.slice(0, 20));
  assert.equal(model.create(start(), { url: '  https://padded.test/  ' }, ctx).result.url, 'https://padded.test/', 'trimmed');
  assert.equal(model.create(start(), { parentId: 'tor1' }, ctx).error, ERRORS.noParent, 'a Tor page is not there for an extension');
  assert.equal(model.create(start(), { title: 'x'.repeat(5000), url: 'https://long.test/' }, ctx).result.title.length, 2048);
  assert.equal(model.create([], { title: 'First ever', url: 'https://f.test/', parentId: '1' }, ctx).nodes[0].browserProfileId, P, 'an empty profile still gets nodes of its own profile');
});

test('create: duplicates of an address are allowed (Chrome allows them; a sync extension needs them)', () => {
  const first = model.create(start(), { parentId: 'work', title: 'Again', url: 'https://news.test/' }, ctx);
  assert.deepEqual(first.nodes.filter(n => n.url === 'https://news.test/').length, 2);
});

test('update: title and url, folders keep their (non-)url, the root folders can\'t change', () => {
  let out = model.update(start(), 'star1', { title: 'Daily news', url: 'https://daily.test/' });
  assert.deepEqual([out.result.title, out.result.url, out.result.parentId, out.result.index], ['Daily news', 'https://daily.test/', '1', 0]);
  assert.equal(model.update(start(), 'star1', { title: 'T' }).result.url, 'https://news.test/', 'untouched fields stay');
  assert.equal(model.update(start(), 'star1', { url: '' }).result.url, 'https://news.test/', 'an empty url changes nothing');
  assert.equal(model.update(start(), 'work', { title: 'Jobs' }).result.title, 'Jobs');
  assert.equal(model.update(start(), 'work', { url: 'https://x.test/' }).error, ERRORS.cannotSetUrlOfFolder);
  assert.equal(model.update(start(), 'work', { url: '' }).result.title, 'Work');
  assert.equal(model.update(start(), 'nope', { title: 'x' }).error, ERRORS.noNode);
  assert.equal(model.update(start(), 'tor1', { title: 'x' }).error, ERRORS.noNode);
  for (const id of ['0', '1', '2']) assert.equal(model.update(start(), id, { title: 'x' }).error, ERRORS.modifySpecial, id);
  assert.equal(model.update(start(), 'star1', { url: 'javascript:void(0)' }).result.url, 'javascript:void(0)', 'a bookmarklet is kept too');
  assert.equal(model.update(start(), 'star1', { url: 'nope' }).error, ERRORS.invalidUrl);
  const before = start(); model.update(before, 'star1', { title: 'changed' }); assert.equal(before[0].title, 'News', 'the nodes given are never changed in place');
});

test('move: to another folder, within one (Chrome\'s index counts the node itself), and Chrome\'s refusals', () => {
  const nodes = [N('a', null, 'A', 0, 'https://a.test/'), N('b', null, 'B', 1, 'https://b.test/'), N('c', null, 'C', 2, 'https://c.test/'), N('d', null, 'D', 3, 'https://d.test/'),
    N('f', null, 'F', 4), N('f1', 'f', 'F1', 0, 'https://f1.test/'), N('g', 'f', 'G', 1)];
  const order = (list, id = '1') => titles(list, id).join('');
  // within one parent: index 3 puts A after C (A leaves slot 0, so the list is B C A D)
  let out = model.move(nodes, 'a', { index: 3 }); sound(out.nodes);
  assert.equal(order(out.nodes), 'BCAD'); assert.equal(out.result.index, 2);
  out = model.move(nodes, 'd', { index: 0 }); assert.equal(order(out.nodes), 'DABC');
  out = model.move(nodes, 'a', { index: 4 }); assert.equal(order(out.nodes), 'BCDA', 'index equal to the length: last');
  out = model.move(nodes, 'a', { index: 1 }); assert.equal(out.unchanged, true, 'index old+1 is where it already is');
  out = model.move(nodes, 'b', { index: 1 }); assert.equal(out.unchanged, true);
  out = model.move(nodes, 'a', { parentId: 'f' }); sound(out.nodes);
  assert.deepEqual(titles(out.nodes, 'f'), ['F1', 'G', 'A'], 'no index: last'); assert.equal(out.result.parentId, 'f'); assert.equal(order(out.nodes), 'BCD');
  out = model.move(nodes, 'a', { parentId: 'f', index: 0 }); assert.deepEqual(titles(out.nodes, 'f'), ['A', 'F1', 'G']);
  // a folder to Other bookmarks' end, to the bar, into the real folders
  out = model.move(nodes, 'f', { parentId: '1', index: 0 }); sound(out.nodes);
  assert.equal(out.nodes.filter(n => n.title === 'Bookmarks bar').length, 1, 'a folder on the bar needs Acira\'s bar folder');
  assert.deepEqual(titles(out.nodes, '1').slice(0, 5), ['F', 'A', 'B', 'C', 'D'], 'a folder asked for index 0 is first; the pages below the new bar folder keep their order and stay on Acira\'s bar'); assert.equal(out.result.parentId, '1'); assert.equal(out.result.index, 0);
  assert.deepEqual(out.nodes.filter(n => !n.parentId && n.url).sort((a, b) => a.position - b.position).map(n => n.title), ['A', 'B', 'C', 'D']);
  out = model.move(nodes, 'b', { parentId: '2' }); sound(out.nodes);
  assert.equal(out.result.parentId, '2'); assert.equal(out.nodes.find(n => n.title === 'Other bookmarks').parentId, null);
  assert.deepEqual(titles(out.nodes, '2'), ['F', 'B'], 'a page in Other bookmarks lives in Acira\'s folder of that name');
  // refusals
  assert.equal(model.move(nodes, 'f', { parentId: 'f' }).error, ERRORS.invalidMoveDestination);
  assert.equal(model.move(nodes, 'f', { parentId: 'g' }).error, ERRORS.invalidMoveDestination, 'into its own descendant');
  assert.equal(model.move(nodes, 'a', { parentId: 'b' }).error, ERRORS.invalidParent);
  assert.equal(model.move(nodes, 'a', { parentId: '0' }).error, ERRORS.modifySpecial);
  assert.equal(model.move(nodes, 'a', { parentId: 'nope' }).error, ERRORS.noNode);
  assert.equal(model.move(nodes, 'nope', {}).error, ERRORS.noNode);
  assert.equal(model.move(nodes, 'a', { parentId: 'f', index: 3 }).error, ERRORS.invalidIndex);
  assert.equal(model.move(nodes, 'a', { index: 5 }).error, ERRORS.invalidIndex);
  for (const id of ['0', '1', '2']) assert.equal(model.move(nodes, id, { index: 0 }).error, ERRORS.modifySpecial, id);
  assert.equal(model.move([...nodes, N('t', null, 'Tor', 9, 'http://t.onion/', { tor: true })], 't', { parentId: 'f' }).error, ERRORS.noNode);
});

test('remove needs an empty folder, removeTree takes the branch, the root folders stay, a Tor page is never taken with it', () => {
  assert.equal(model.remove(start(), 'work').error, ERRORS.folderNotEmpty);
  let out = model.remove(start(), 'star1'); sound(out.nodes);
  assert.deepEqual(out.nodes.map(n => n.id), ['star2', 'work', 'w1', 'w2', 'tor1']); assert.equal(out.result, undefined);
  out = model.remove(start(), 'work', { recursive: true }); sound(out.nodes);
  assert.deepEqual(out.nodes.map(n => n.id), ['star1', 'star2', 'tor1']);
  out = model.remove([N('e', null, 'Empty', 0)], 'e'); assert.deepEqual(out.nodes, []);
  assert.equal(model.remove(start(), 'nope').error, ERRORS.noNode);
  for (const id of ['0', '1', '2']) { assert.equal(model.remove(start(), id).error, ERRORS.modifySpecial, id); assert.equal(model.remove(start(), id, { recursive: true }).error, ERRORS.modifySpecial, id); }
  // a folder holding a Tor page: the page is the person's, not the extension's
  const withTor = [N('f', null, 'F', 0), N('p', 'f', 'Plain', 0, 'https://p.test/'), N('t', 'f', 'Onion', 1, 'http://x.onion/', { tor: true })];
  out = model.remove(withTor, 'f', { recursive: true }); sound(out.nodes);
  assert.deepEqual(out.nodes.map(n => [n.id, n.parentId]), [['t', null]], 'the Tor page moves to the top level');
  out = model.remove([N('f', null, 'F', 0), N('t', 'f', 'Onion', 0, 'http://x.onion/', { tor: true })], 'f');
  assert.deepEqual(out.nodes.map(n => [n.id, n.parentId]), [['t', null]], 'a folder that looks empty to the extension can be removed, and its Tor page survives');
  assert.equal(model.remove(withTor, 't').error, ERRORS.noNode);
});

test('every write keeps the invariants: a random run of creates, moves, updates and removes', () => {
  let seed = 7; const rnd = n => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return (((t ^ (t >>> 14)) >>> 0) % n); };
  let nodes = start(); const done = { create: 0, move: 0, update: 0, remove: 0 };
  let ownedList = clone(nodes), ownedIds = 0; ownedList.normalized = false;   // the same run, worked in place the way the buffer does
  const idFor = kind => `${kind}-fz-${++ownedIds}`;
  for (let step = 0; step < 1500; step++) {
    const view = model.createView(nodes), all = view.all(), pick = () => all[rnd(all.length)], folders = all.filter(id => view.listOf(id)), folder = () => folders[rnd(folders.length)];
    const roll = rnd(12); let out, kind, again;
    const run = (list, extra) => {
      if (roll < 5) { return model.create(list, args.create, { ...ctx, newId: idFor, ...extra }); }
      if (roll < 9) { return model.move(list, args.id, args.move, { ...ctx, ...extra }); }
      if (roll < 10) { return model.move(list, args.id, args.same, { ...ctx, ...extra }); }
      if (roll < 11) { return model.update(list, args.id, { title: 'u' + step }, extra); }
      return model.remove(list, args.id, { recursive: args.recursive, ...extra });
    };
    const args = { create: { parentId: folder(), index: rnd(4), title: 't' + step, ...(rnd(3) ? { url: `https://s${step}.test/` } : {}) }, id: pick(), move: { parentId: folder(), index: rnd(5) }, same: { index: rnd(5) }, recursive: !!rnd(2) };
    kind = roll < 5 ? 0 : roll < 9 ? 1 : roll < 10 ? 4 : roll < 11 ? 2 : 3;
    const idsBefore = ownedIds; out = run(nodes, { newId: idFor }); ownedIds = idsBefore;
    again = run(ownedList, { owned: true, newId: idFor });
    assert.equal(!!again.error, !!out.error, 'the same call has the same outcome in place: ' + JSON.stringify([again.error, out.error]));
    if (out.error) { assert.equal(again.error, out.error); continue; }
    if (again.nodes) ownedList = again.nodes;
    assert.deepEqual(ownedList.map(n => ({ ...n })), out.nodes.map(n => ({ ...n })), 'working in place gives the same list as copying');
    const previous = nodes;
    nodes = sound(out.nodes);
    // what the call says happened is what a comparison of before and after finds, and its record is where the node really is
    const compared = model.diffEvents(previous, nodes);
    if (kind === 1 || kind === 4) {
      // a move: both name a move, and applying either one to the old order gives the new order (which of two swapped neighbours "moved" is a matter of taste)
      assert.deepEqual(out.events.map(e => e.name), compared.map(e => e.name), 'a move is one onMoved, or nothing');
      if (out.events.length > 1) assert.deepEqual(out.events.map(e => [e.name, ...e.args]), compared.map(e => [e.name, ...e.args]), 'when pages had to move below the bar folder, the call tells what a comparison finds');
      else for (const list of [out.events, compared]) for (const e of list) {
        const [id, info] = e.args, was = model.createView(previous), now = model.createView(nodes);
        const order = was.idsUnder(info.oldParentId).filter(x => x !== id); if (info.oldParentId === info.parentId) order.splice(info.index, 0, id);
        if (info.oldParentId === info.parentId) assert.deepEqual(order, now.idsUnder(info.parentId), 'the event takes the old order to the new');
        assert.equal(now.record(id).index, info.index); assert.equal(now.record(id).parentId, info.parentId); assert.equal(was.record(id).parentId, info.oldParentId); assert.equal(was.record(id).index, info.oldIndex);
      }
    } else assert.deepEqual(out.events.map(e => [e.name, ...e.args]), compared.map(e => [e.name, ...e.args]), 'the call\'s own events are the comparison\'s');
    if (out.result && out.result.id) assert.deepEqual(out.result, model.createView(nodes).record(out.result.id), 'the call\'s answer is the node\'s real place');
    done[['create', 'move', 'update', 'remove', 'move'][kind]]++;
    assert.ok(nodes.some(n => n.id === 'tor1'), 'the Tor page is never lost');
    const count = list => model.createView(list).all().length, ev = model.diffEvents(previous, nodes);
    assert.equal(count(nodes) - count(previous), ev.filter(e => e.name === 'bookmarks.onCreated').length - model.createView(previous).all().filter(id => !model.createView(nodes).exists(id)).length, 'created and removed events add up to the change in size');
    for (const e of ev) assert.ok(e.args[0] && typeof e.args[0] === 'string');
  }
  assert.ok(done.create > 300 && done.move > 300 && done.update > 30 && done.remove > 10, JSON.stringify(done));
});

test('events: created, changed, moved, removed (with the branch) and reordered, from a before and an after list', () => {
  const names = list => list.map(e => e.name.replace('bookmarks.', ''));
  const before = start();
  let after = model.create(before, { parentId: 'work', title: 'Added', url: 'https://added.test/', index: 1 }, ctx).nodes;
  let ev = model.diffEvents(before, after);
  assert.deepEqual(names(ev), ['onCreated']); assert.deepEqual([ev[0].args[1].title, ev[0].args[1].parentId, ev[0].args[1].index], ['Added', 'work', 1]);
  assert.equal(model.diffEvents(after, after).length, 0, 'nothing changed, nothing said');
  after = model.update(before, 'star1', { title: 'Renamed', url: 'https://renamed.test/' }).nodes;
  ev = model.diffEvents(before, after); assert.deepEqual(names(ev), ['onChanged']); assert.deepEqual(ev[0].args, ['star1', { title: 'Renamed', url: 'https://renamed.test/' }]);
  after = model.update(before, 'work', { title: 'Jobs' }).nodes; ev = model.diffEvents(before, after); assert.deepEqual(ev[0].args, ['work', { title: 'Jobs' }], 'a folder\'s change has no url');
  after = model.move(before, 'w2', { parentId: 'work', index: 0 }).nodes;
  ev = model.diffEvents(before, after); assert.deepEqual(names(ev), ['onMoved']); assert.deepEqual(ev[0].args, ['w2', { parentId: 'work', index: 0, oldParentId: 'work', oldIndex: 1 }]);
  after = model.move(before, 'w1', { parentId: '1', index: 1 }).nodes;
  ev = model.diffEvents(before, after); assert.deepEqual(ev.map(e => e.name), ['bookmarks.onMoved'], 'only the moved node, not the siblings that shifted');
  assert.deepEqual(ev[0].args, ['w1', { parentId: '1', index: 1, oldParentId: 'work', oldIndex: 0 }]);
  after = model.remove(before, 'star1').nodes; ev = model.diffEvents(before, after);
  assert.deepEqual(names(ev), ['onRemoved']); assert.deepEqual([ev[0].args[0], ev[0].args[1].parentId, ev[0].args[1].index, ev[0].args[1].node.title], ['star1', '1', 0, 'News']);
  after = model.remove(before, 'work', { recursive: true }).nodes; ev = model.diffEvents(before, after);
  assert.equal(ev.length, 1, 'one event for a removed branch'); assert.deepEqual(ev[0].args[1].node.children.map(c => c.title), ['Docs', 'Tickets']);
  // created folder with its contents arrives parents first
  const restored = [...before, N('nf', null, 'Back', 9), N('nf1', 'nf', 'Back1', 0, 'https://back.test/')];
  ev = model.diffEvents(before, restored); assert.deepEqual(ev.map(e => e.args[0]), ['nf', 'nf1']);
  // Sort by name: several moves in one folder at once are one onChildrenReordered
  const big = [N('a', null, 'C', 0, 'https://c.test/'), N('b', null, 'A', 1, 'https://a.test/'), N('c', null, 'B', 2, 'https://b.test/'), N('d', null, 'D', 3, 'https://d.test/')];
  const reversed = [{ ...big[3], position: 0 }, { ...big[2], position: 1 }, { ...big[1], position: 2 }, { ...big[0], position: 3 }];
  ev = model.diffEvents(big, reversed); assert.deepEqual(ev.length, 1);
  assert.deepEqual([ev[0].name, ev[0].args[0], ev[0].args[1].childIds.join('')], ['bookmarks.onChildrenReordered', '1', 'dcba']);
  const oneMoved = [{ ...big[1], position: 0 }, { ...big[2], position: 1 }, { ...big[0], position: 2 }, big[3]];
  ev = model.diffEvents(big, oneMoved); assert.deepEqual(ev.map(e => [e.name, e.args[0]]), [['bookmarks.onMoved', 'a']], 'one node out of order is one move');
  // a Tor page being added or removed says nothing
  assert.equal(model.diffEvents(before, [...before, N('t2', null, 'Onion2', 9, 'http://y.onion/', { tor: true })]).length, 0);
  // the bar folder being made does not move what is on the bar
  const made = model.create(before, { parentId: '1', title: 'F' }, ctx).nodes; ev = model.diffEvents(before, made); assert.deepEqual(names(ev), ['onCreated']);
});

test('the event hub: only the watched profile, only changes, nothing for the first list, a private or other profile never arrives', async () => {
  events.reset();
  const seen = [], later = fn => fn();
  const other = [N('o1', null, 'Other profile page', 0, 'https://o.test/', { browserProfileId: 'profile-2' })];
  const stop = events.watch({ profileId: P, initial: start().concat(other), deliver: (name, ...args) => seen.push([name, ...args]), later });
  events.noteBookmarks(start().concat(other)); assert.equal(seen.length, 0, 'the same list says nothing');
  const added = model.create(start(), { parentId: 'work', title: 'Added', url: 'https://added.test/' }, ctx).nodes;
  events.noteBookmarks(added.concat(other)); assert.deepEqual(seen.map(e => e[0]), ['bookmarks.onCreated']);
  events.noteBookmarks(added.concat(other)); assert.equal(seen.length, 1, 'a second window reporting the same list says nothing more');
  events.noteBookmarks(added.concat([{ ...other[0], title: 'Renamed in profile 2' }])); assert.equal(seen.length, 1, 'another profile\'s change never reaches this one');
  events.noteBookmarks(added.concat(other, [N('t3', null, 'Onion', 9, 'http://z.onion/', { tor: true })])); assert.equal(seen.length, 1);
  stop(); events.noteBookmarks(start()); assert.equal(seen.length, 1, 'stopped');
  // no list at first: the first note only learns it
  const late = []; events.watch({ profileId: P, initial: null, deliver: (name, ...args) => late.push(name), later });
  events.noteBookmarks(start()); assert.equal(late.length, 0);
  events.noteBookmarks(added); assert.deepEqual(late, ['bookmarks.onCreated']);
  // an import brackets its onCreated events with onImportBegan / onImportEnded, for its profile only
  const imp = []; events.reset();
  events.watch({ profileId: P, initial: start(), deliver: name => imp.push(name), later });
  events.watch({ profileId: 'profile-2', initial: [], deliver: name => imp.push('other:' + name), later });
  events.importBegan(P); events.noteBookmarks(added); events.importEnded(P); events.importBegan(null);
  assert.deepEqual(imp, ['bookmarks.onImportBegan', 'bookmarks.onCreated', 'bookmarks.onImportEnded']);
  // delivery is after the change, not inside it
  const queue = []; events.reset();
  events.watch({ profileId: P, initial: start(), deliver: name => queue.push(name), later: fn => setImmediate(fn) });
  events.noteBookmarks(added); assert.equal(queue.length, 0); await new Promise(resolve => setImmediate(resolve)); assert.equal(queue.length, 1);
  events.reset();
});

test('chrome.bookmarks API object: reads, writes through the host, errors as __acira_error', () => {
  let nodes = start(); const seenCompute = [];
  const host = { profileId: P, update: compute => { const out = compute(structuredClone(nodes)); seenCompute.push(out); if (out && out.nodes && !out.unchanged) nodes = out.nodes; return out; } };
  const api = bookmarksApi(() => nodes, host);
  assert.equal(api.getTree()[0].children.length, 2);
  assert.deepEqual(api.getChildren({}, '1').map(n => n.title), ['News', 'Mail']); assert.deepEqual(api.getChildren({}, '0').map(n => n.id), ['1', '2']);
  assert.deepEqual(api.getChildren({}, 'star1'), { __acira_error: ERRORS.noNode }, 'a page has no children');
  assert.deepEqual(api.get({}, ['work', '2']).map(n => n.id), ['work', '2']); assert.deepEqual(api.get({}, '1').map(n => n.id), ['1']);
  assert.deepEqual(api.get({}, ['tor1']), { __acira_error: ERRORS.noNode });
  assert.equal(api.getSubTree({}, 'work')[0].children.length, 2);
  assert.deepEqual(api.search({}, 'docs').map(n => n.id), ['w1']); assert.deepEqual(api.search({}, 'onion'), []);
  assert.deepEqual(api.getRecent({}, 2).length, 2);
  const made = api.create({}, { parentId: 'work', title: 'Made', url: 'https://made.test/' });
  assert.equal(made.title, 'Made'); assert.equal(nodes.length, start().length + 1);
  assert.equal(api.update({}, made.id, { title: 'Made2' }).title, 'Made2');
  assert.equal(api.move({}, made.id, { parentId: '1', index: 0 }).parentId, '1');
  assert.equal(api.remove({}, made.id), undefined); assert.equal(nodes.length, start().length);
  assert.deepEqual(api.remove({}, 'work'), { __acira_error: ERRORS.folderNotEmpty });
  assert.equal(api.removeTree({}, 'work'), undefined); assert.ok(!nodes.some(n => n.id === 'w1'));
  assert.deepEqual(api.create({}, { parentId: '0' }), { __acira_error: ERRORS.modifySpecial });
  assert.deepEqual(bookmarksApi(() => nodes, {}).create({}, { title: 'x' }), { __acira_error: 'Acira cannot change bookmarks right now.' });
  assert.deepEqual(bookmarksApi(() => nodes, { update: () => { throw new Error('Acira has no open window for this profile.'); } }).remove({}, 'star1'), { __acira_error: 'Acira has no open window for this profile.' });
});

test('wired behind the permission: handlers answer only an extension holding "bookmarks", writes reach the store in one change, events go to the profile\'s router', async () => {
  events.reset(); bufferModule.reset();
  const ID = 'abcdefghijklmnopabcdefghijklmnop', handlers = new Map(), sent = [];
  const router = { handlers, listeners: new Map(), handle(name, callback) { handlers.set(name, { callback }); }, sendEvent() {}, broadcastEvent(name, ...args) { sent.push([name, ...args]); } };
  let nodes = start(); const commits = [];
  const stores = { bookmarks: () => nodes, bookmarksReady: () => true, history: () => [], closedTabs: () => [], search: async () => {},
    commitBookmarks(next) { commits.push(next.length); nodes = next.map(n => ({ ...n })); events.noteBookmarks(nodes); } };
  const userData = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'acira-bookmarks-test-'));
  const apis = installExtensionApis({ ctx: { router } }, { session: { extensions: new EventEmitter() }, userData, storeKey: P, stores });
  const withPerm = permissions => ({ extension: { id: ID, manifest: { manifest_version: 3, permissions } } });
  const has = withPerm(['bookmarks']), none = withPerm(['tabs']), later = () => new Promise(resolve => setTimeout(resolve, 120));
  for (const name of ['create', 'update', 'move', 'remove', 'removeTree']) assert.ok(handlers.has('bookmarks.' + name), name);
  assert.deepEqual(await handlers.get('bookmarks.create').callback(none, { title: 'x' }), { __acira_error: "'bookmarks' permission is required." });
  assert.equal(commits.length, 0, 'an extension without the permission reaches nothing');
  const made = [];
  for (let i = 0; i < 25; i++) made.push(await handlers.get('bookmarks.create').callback(has, { parentId: 'work', title: 'Via router ' + i, url: `https://router${i}.test/` }));
  assert.equal(made[24].title, 'Via router 24');
  assert.equal((await handlers.get('bookmarks.getChildren').callback(has, 'work')).length, 27, 'the extension reads its own writes at once');
  assert.equal(commits.length, 0, 'but the store has not been changed yet: a burst is one change');
  await later();
  assert.deepEqual(commits, [nodes.length], 'one change for 25 writes'); assert.ok(nodes.some(n => n.id === made[24].id));
  assert.deepEqual(sent.map(e => e[0]), Array(25).fill('bookmarks.onCreated'), 'every write told its own event, none twice when the store changed');
  assert.deepEqual(sent.map(e => e[1]), made.map(m => m.id), 'in order');
  sent.length = 0;
  assert.deepEqual(await handlers.get('bookmarks.remove').callback(has, 'work'), { __acira_error: ERRORS.folderNotEmpty });
  assert.equal(await handlers.get('bookmarks.removeTree').callback(has, 'work'), undefined);
  await later();
  assert.deepEqual(sent.map(e => e[0]), ['bookmarks.onRemoved']); assert.equal(commits.length, 2);
  // the person changes something while a write is waiting: the write goes in first
  await handlers.get('bookmarks.create').callback(has, { parentId: '1', title: 'Pending', url: 'https://pending.test/' });
  bufferModule.flushAll(); assert.equal(commits.length, 3); assert.ok(nodes.some(n => n.title === 'Pending'));
  // history stays read-only
  assert.deepEqual(await handlers.get('history.deleteAll').callback(withPerm(['history'])), { __acira_error: 'Acira lets extensions read history but not change it.' });
  assert.ok((await handlers.get('sessions.restore').callback(withPerm(['sessions']))).__acira_error);
  apis.dispose(); events.reset(); bufferModule.reset(); require('node:fs').rmSync(userData, { recursive: true, force: true });
});

test('the write buffer: a burst is one store change; reads see the writes; flushing before the person\'s own change; never more than the cap late', () => {
  bufferModule.reset();
  const timers = []; let clock = 0, stored = start(); const commits = [], told = [], adopted = [];
  const buffer = bufferModule.createBookmarkBuffer({ read: () => stored, commit: nodes => { commits.push(nodes.length); stored = nodes; }, adopt: nodes => adopted.push(nodes.length), deliver: (name, ...args) => told.push([name, args[0]]),
    now: () => clock, setTimer: (fn, ms) => { const t = { fn, at: clock + ms }; timers.push(t); return t; }, clearTimer: t => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); } });
  const write = i => buffer.apply((nodes, c) => model.create(nodes, { parentId: 'work', title: 'n' + i, url: `https://n${i}.test/` }, { ...ctx, ...c }));
  const tick = ms => { clock += ms; for (const t of [...timers]) if (t.at <= clock) { timers.splice(timers.indexOf(t), 1); t.fn(); } };
  for (let i = 0; i < 200; i++) { assert.ok(write(i).result.id); tick(2); }   // 400 ms of writes, one every 2 ms
  assert.equal(buffer.nodes().length, start().length + 200, 'reads see every write');
  assert.ok(commits.length >= 1 && commits.length <= 3, 'a 400 ms burst is at most 3 changes, not 200: ' + commits.join());
  assert.ok(told.length === 200 && told.every(e => e[0] === 'bookmarks.onCreated'), 'every write told its event, at once');
  tick(100); assert.equal(buffer.hasPending(), false); assert.equal(stored.length, start().length + 200, 'the store ends with everything');
  assert.deepEqual(adopted, commits, 'the hub is told each change is already told, before the store changes');
  // an error changes nothing and schedules nothing
  const before = commits.length; assert.equal(buffer.apply((nodes, c) => model.create(nodes, { parentId: 'nope' }, { ...ctx, ...c })).error, ERRORS.noParent); tick(500); assert.equal(commits.length, before);
  // flush on demand: the person's change must not meet a stale list
  write(900); assert.equal(buffer.hasPending(), true); assert.equal(stored.some(n => n.title === 'n900'), false);
  bufferModule.flushAll(); assert.equal(stored.some(n => n.title === 'n900'), true); assert.equal(buffer.hasPending(), false);
  // the cap: writes that never pause still reach the store within 250 ms of the first
  const n0 = commits.length; for (let i = 0; i < 30; i++) { write(1000 + i); tick(10); } assert.ok(commits.length - n0 >= 1, 'a long burst is cut at the cap'); tick(100);
  // no window: refused at once, as before; and a change that cannot be made yet is tried again
  let open = false; const waiting = bufferModule.createBookmarkBuffer({ read: () => stored, ready: () => open, commit: nodes => { stored = nodes; }, now: () => clock, setTimer: (fn, ms) => { const t = { fn, at: clock + ms }; timers.push(t); return t; }, clearTimer: t => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); } });
  assert.throws(() => waiting.apply((nodes, c) => model.create(nodes, { title: 'x' }, { ...ctx, ...c })), /no open window/);
  open = true; waiting.apply((nodes, c) => model.create(nodes, { title: 'late', url: 'https://late.test/' }, { ...ctx, ...c })); open = false; tick(300); assert.equal(waiting.hasPending(), true, 'kept while no window can take it');
  open = true; tick(600); assert.equal(waiting.hasPending(), false); assert.ok(stored.some(n => n.title === 'late'));
  bufferModule.reset();
});

test('the hub: a buffered burst is told once; the person\'s change after it is told as theirs; non-web addresses can be put back by Undo', () => {
  events.reset();
  const seen = [], later = fn => fn();
  const stop = events.watch({ profileId: P, initial: start(), deliver: (name, ...args) => seen.push([name, args[0]]), later });
  const written = model.create(start(), { parentId: 'work', title: 'W', url: 'https://w.test/' }, ctx);
  stop.emit(written.events[0].name, ...written.events[0].args);   // the buffer tells the write's own event
  stop.adopt(written.nodes); events.noteBookmarks(written.nodes);   // then the store changes: nothing more is said
  assert.deepEqual(seen.map(e => e[0]), ['bookmarks.onCreated']);
  const theirs = model.update(written.nodes, 'star1', { title: 'Theirs' }).nodes; events.noteBookmarks(theirs);
  assert.deepEqual(seen.map(e => e[0]), ['bookmarks.onCreated', 'bookmarks.onChanged'], 'the person\'s own change is still told');
  stop(); events.reset();
  const { validateAction } = require('../desktop/validation.cjs');
  const restore = url => ({ type: 'bookmark.restore', nodes: [{ id: 'b1', browserProfileId: P, parentId: null, title: 't', url, position: 0, createdAt: 1 }] });
  for (const url of ['https://a.test/', 'javascript:(function(){})()', 'chrome://settings', 'file:///tmp/x.html', 'about:blank']) assert.doesNotThrow(() => validateAction(restore(url), null), url);
  for (const url of ['not an address', '']) assert.throws(() => validateAction(restore(url), null), url);
  assert.throws(() => validateAction({ type: 'bookmark.add', url: 'javascript:alert(1)', title: 'x', parentId: null, index: 0 }, null), /unsupported protocol/, 'a new bookmark from the page stays web only');
  assert.throws(() => validateAction({ type: 'tab.navigate', url: 'javascript:alert(1)' }, null), /unsupported protocol/, 'opening one is refused, so a bookmarklet never runs');
});

test('no window of the profile is open: reads fail instead of answering an empty tree (a sync extension would take it for "everything was deleted")', () => {
  let open = false, nodes = start(); const pending = { on: false };
  const api = bookmarksApi(() => open ? nodes : [], { profileId: P, ready: () => open || pending.on, update: compute => compute(structuredClone(nodes)) });
  const refused = { __acira_error: 'Acira cannot read bookmarks right now.' };
  assert.deepEqual(api.getTree({}), refused); assert.deepEqual(api.getSubTree({}, '1'), refused); assert.deepEqual(api.get({}, '1'), refused);
  assert.deepEqual(api.getChildren({}, '1'), refused); assert.deepEqual(api.getRecent({}, 5), refused); assert.deepEqual(api.search({}, 'news'), refused);
  open = true; assert.equal(api.getTree({})[0].children.length, 2); assert.ok(api.search({}, 'docs').length);
  // writes already waiting in the buffer can still be read back, window or not
  open = false; pending.on = true; assert.ok(Array.isArray(api.getTree({})));
});

test('Floccus synced to the Bookmarks bar folder only: creates under "1" without an index, then orders every item; nothing fails, the second pass changes nothing', () => {
  // The calls Floccus 5.12 makes (BrowserTree.ts): getSubTree('1'), create({parentId, title, url}) with no index, move(id, {parentId, index}) per item of the server's order.
  const server = [{ f: 'A', c: [{ u: 'https://a1.test/' }, { u: 'https://a2.test/' }] }, { u: 'https://page1.test/' }, { f: 'B', c: [{ u: 'https://b1.test/' }, { f: 'B-in', c: [{ u: 'https://deep.test/' }] }] }, { u: 'https://page2.test/' }];
  const pull = (startNodes, tree) => {
    let list = startNodes; const made = new Map(); let counter2 = 0; const c2 = { profileId: P, newId: kind => `${kind}-fl-${++counter2}`, now: 7000 };
    const step = (what, run) => { const out = run(); assert.ok(!out.error, `${what}: ${out.error}`); if (out.nodes) list = out.nodes; return out; };
    const build = (parent, items) => { for (const item of items) { const out = step('create', () => model.create(list, item.f ? { parentId: parent, title: item.f } : { parentId: parent, title: item.u, url: item.u }, c2)); made.set(item, out.result.id); if (item.f) build(out.result.id, item.c); } };
    const order = (parent, items) => { items.forEach((item, index) => { const out = step('move', () => model.move(list, made.get(item), { parentId: parent, index }, c2)); if (item.f) order(made.get(item), item.c); }); return list; };
    build('1', tree); order('1', tree);
    return { list, made };
  };
  const shape = (nodes, id) => { const v = model.createView(nodes); return v.idsUnder(id).map(child => { const r = v.record(child); return r.url ? r.url : { [r.title]: shape(nodes, child) }; }); };
  const wanted = items => items.map(item => item.f ? { [item.f]: wanted(item.c) } : item.u);
  // an empty Acira: the whole server order is kept, folders and pages interleaved
  const first = pull([], server);
  assert.deepEqual(shape(first.list, '1'), wanted(server), 'the bar folder holds the server\'s items in the server\'s order');
  assert.deepEqual(shape(first.list, '2'), [], 'Other bookmarks is not touched');
  assert.ok(sound(first.list), 'the list stays sound');
  // the person already has starred pages on the bar: Floccus' order cannot always be kept, but nothing fails and nothing is lost or doubled
  const mine = [N('t1', null, 'T1', 0, 'https://t1.test/'), N('t2', null, 'T2', 1, 'https://t2.test/'), N('mine', null, 'Mine', 2)];
  const mixed = pull(mine, server);
  const flat = (nodes, id) => { const v = model.createView(nodes); return v.idsUnder(id).flatMap(child => { const r = v.record(child); return [r.title, ...(r.url ? [] : flat(nodes, child))]; }); };
  for (const title of ['T1', 'T2', 'A', 'B', 'B-in', 'https://a1.test/', 'https://deep.test/', 'https://page1.test/', 'https://page2.test/']) assert.equal(flat(mixed.list, '1').filter(t => t === title).length, 1, title + ' once in the bar');
  assert.deepEqual(shape(mixed.list, '2').map(x => Object.keys(x)[0]), ['Mine'], 'the person\'s own folder is not part of the bar and stays where it is');
  assert.ok(sound(mixed.list));
  // a second pass with the same order changes nothing: no store change, no event (Floccus' next sync is quiet)
  const again = model.move(mixed.list, mixed.made.get(server[1]), { parentId: '1', index: model.createView(mixed.list).idsUnder('1').indexOf(mixed.made.get(server[1])) }, ctx);
  assert.equal(again.unchanged, true); assert.deepEqual(again.events || [], []);
});

test('Floccus pulling a bar that mixes pages and folders: its loose pages are made first, then the folders are ordered between them; the order asked for is the order kept, with or without the person\'s own starred pages', () => {
  // what Floccus 5.12 really did against Acira (traced): create every loose page of the root first, then the folders with their items, then move each root item to its place in the server's order
  const order = ['L0', 'L1', 'L2', 'F0', 'F1', 'B1', 'F2', 'F3', 'B3', 'F4'];
  const isFolder = name => name.startsWith('F');
  const run = (startNodes, wanted) => {
    let list = startNodes, counter3 = 0; const c3 = { profileId: P, newId: kind => `${kind}-x-${++counter3}`, now: 8000 }, made = new Map();
    const step = (what, run2) => { const out = run2(); assert.ok(!out.error, `${what}: ${out.error}`); if (out.nodes) list = out.nodes; return out; };
    for (const n of startNodes) if (n.url) made.set(n.title, n.id);
    for (const name of wanted.filter(n => !isFolder(n) && !made.has(n))) made.set(name, step('page ' + name, () => model.create(list, { parentId: '1', title: name, url: `https://${name.toLowerCase()}.test/` }, c3)).result.id);
    for (const name of wanted.filter(isFolder)) { made.set(name, step('folder ' + name, () => model.create(list, { parentId: '1', title: name }, c3)).result.id); step('child', () => model.create(list, { parentId: made.get(name), title: name + ' child', url: `https://${name.toLowerCase()}-child.test/` }, c3)); }
    wanted.forEach((name, index) => step('move ' + name, () => model.move(list, made.get(name), { parentId: '1', index }, c3)));
    return list;
  };
  const names = nodes => { const v = model.createView(nodes); return v.idsUnder('1').map(id => v.record(id).title); };
  const topPages = nodes => nodes.filter(n => !n.parentId && n.url).sort((a, b) => a.position - b.position).map(n => n.title);
  const empty = run([], order);
  assert.deepEqual(names(empty), order, 'exactly the order the server has');
  assert.deepEqual(topPages(empty), ['L0', 'L1', 'L2'], 'the pages before the first folder stay on Acira\'s bar; the ones between folders live in the bar folder');
  assert.ok(sound(empty));
  // the person already starred T1 T2 T3 (first merge: the pages that exist only here come last in Floccus' order): the server\'s items keep their order, and the starred pages stay on the bar
  const mine = [N('t1', null, 'T1', 0, 'https://t1.test/'), N('t2', null, 'T2', 1, 'https://t2.test/'), N('t3', null, 'T3', 2, 'https://t3.test/')];
  const merged = run(mine, [...order, 'T1', 'T2', 'T3']);
  assert.deepEqual(names(merged), [...order, 'T1', 'T2', 'T3'], 'the server\'s order and the local pages at the end, exactly as asked');
  assert.deepEqual(topPages(merged), ['L0', 'L1', 'L2', 'T1', 'T2', 'T3'], 'T1 T2 T3 are still on Acira\'s bar, in order');
  assert.ok(sound(merged));
  // a second pass changes nothing
  const again = model.move(merged, merged.find(n => n.title === 'B1').id, { parentId: '1', index: names(merged).indexOf('B1') }, ctx);
  assert.equal(again.unchanged, true); assert.deepEqual(again.events, []);
});

test('the bar is one list: a page lands in the part the index falls in, a folder asked before pages takes them below its folder, and every call tells exactly what changed', () => {
  const c5 = { profileId: P, newId: kind => `${kind}-z-${++counter}`, now: 9500 };
  let list = [N('a', null, 'A', 0, 'https://a.test/'), N('b', null, 'B', 1, 'https://b.test/'), N('bar', null, 'Bookmarks bar', 2), N('f1', 'bar', 'F1', 0), N('f2', 'bar', 'F2', 1), N('c', null, 'C', 3, 'https://c.test/')];
  const view = () => model.createView(list), order = () => view().idsUnder('1').map(id => view().record(id).title);
  const run = out => { assert.ok(!out.error, out.error); if (out.nodes) list = out.nodes; return out; };
  const check = (before, out) => assert.deepEqual(out.events.map(e => [e.name, e.args[0]]), model.diffEvents(before, list).map(e => [e.name, e.args[0]]), 'the call\'s events are what a comparison finds');
  assert.deepEqual(order(), ['A', 'B', 'F1', 'F2', 'C']);
  let before = list, out = run(model.move(list, 'c', { parentId: '1', index: 0 }, c5));
  assert.deepEqual(order(), ['C', 'A', 'B', 'F1', 'F2'], 'index 0: the top of the bar'); assert.equal(list.find(n => n.id === 'c').parentId, null); check(before, out);
  before = list; out = run(model.create(list, { parentId: '1', title: 'Mid', url: 'https://mid.test/', index: 4 }, c5));
  assert.deepEqual(order(), ['C', 'A', 'B', 'F1', 'Mid', 'F2'], 'between two folders: it is one of the folder\'s items'); assert.equal(list.find(n => n.title === 'Mid').parentId, 'bar'); assert.equal(out.result.index, 4);
  before = list; out = run(model.create(list, { parentId: '1', title: 'Last', url: 'https://last.test/' }, c5));
  assert.equal(order().at(-1), 'Last'); assert.equal(list.find(n => n.title === 'Last').parentId, null, 'appended: the end of the bar, below the folder, on Acira\'s bar'); check(before, out);
  before = list; out = run(model.create(list, { parentId: '1', title: 'F0' }, c5));
  assert.deepEqual(order().slice(-2), ['F0', 'Last'], 'a folder appended is the folder\'s last item, before the pages below it'); assert.equal(out.result.index, order().length - 2); check(before, out);
  before = list; out = run(model.move(list, list.find(n => n.title === 'F0').id, { parentId: '1', index: 1 }, c5));
  assert.deepEqual(order().slice(0, 2), ['C', 'F0'], 'a folder asked to stand before A and B gets that place...');
  assert.deepEqual(list.filter(n => !n.parentId && n.url).sort((x, y) => x.position - y.position).map(n => n.title), ['C', 'A', 'B', 'Last'], '...A and B move below the bar folder; Acira\'s bar shows the same pages in the same order');
  assert.equal(out.result.index, 1); check(before, out);
  assert.ok(sound(list));
});
