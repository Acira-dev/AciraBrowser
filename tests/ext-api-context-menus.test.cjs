'use strict';
// chrome.contextMenus (ext-api/context-menus*.cjs): Chromium's rules and errors, which items show for which right-click, the click event,
// persistence for event-page and service-worker extensions, and the extension page/worker side.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const extApi = require('../desktop/browser-services/ext-api/index.cjs');
const {createStore, ERR} = require('../desktop/browser-services/ext-api/context-menus/store.cjs');
const build = require('../desktop/browser-services/ext-api/context-menus/build.cjs');
const {host, manifestExtension, ID} = require('./fixtures/ext-api-p8/host.cjs');
const {extensionWorld, plain} = require('./fixtures/ext-api/world.cjs');

const X = 'abcdefghijklmnopabcdefghijklmnop';

test('store: create validates like Chromium and uses its error texts', () => {
  const store = createStore();
  store.create(X, {id: 'a', title: 'A'});
  assert.throws(() => store.create(X, {id: 'a', title: 'Again'}), new RegExp(`^Error: Cannot create item with duplicate id a$`));
  assert.throws(() => store.create(X, {id: 'b'}), {message: ERR.title});
  assert.equal(ERR.title, 'All menu items except for separators must have a title.');
  assert.throws(() => store.create(X, {id: 'c', title: 'C', checked: true}), {message: 'Only items with type "radio" or "checkbox" can be checked.'});
  assert.throws(() => store.create(X, {id: 'd', title: 'D', parentId: 'nope'}), {message: 'Cannot find menu item with id nope'});
  store.create(X, {id: 'check', title: 'Check', type: 'checkbox'});
  assert.throws(() => store.create(X, {id: 'e', title: 'E', parentId: 'check'}), {message: 'Parent items must have type "normal"'});
  assert.throws(() => store.create(X, {id: 'f', title: 'F', documentUrlPatterns: ['not a pattern']}), {message: "Invalid url pattern 'not a pattern'"});
  assert.throws(() => store.create(X, {id: 'g', title: 'G', contexts: ['launcher']}), {message: "Only packaged apps are allowed to use 'launcher' context"});
  assert.doesNotThrow(() => store.create(X, {id: 'sep', type: 'separator'}), 'a separator needs no title');
  assert.deepEqual(store.find(X, 'a').contexts, ['page'], 'the default context is page');
  // ids are strings or integers and different from each other
  store.create(X, {id: 1, title: 'one'});
  store.create(X, {id: '1', title: 'string one'});
  assert.equal(store.list(X).filter(i => String(i.id) === '1').length, 2);
});

test('store: update, remove (children go too), removeAll, radio groups, toggling', () => {
  const store = createStore();
  store.create(X, {id: 'p', title: 'Parent'});
  store.create(X, {id: 'c1', title: 'Child 1', parentId: 'p'});
  store.create(X, {id: 'c2', title: 'Child 2', parentId: 'c1'});
  store.update(X, 'p', {title: 'Renamed', enabled: false});
  assert.equal(store.find(X, 'p').title, 'Renamed');
  assert.equal(store.find(X, 'p').enabled, false);
  assert.throws(() => store.update(X, 'zzz', {title: 'x'}), {message: 'Cannot find menu item with id zzz'});
  assert.throws(() => store.update(X, 'p', {parentId: 'c2'}), /Cannot find menu item with id c2/, 'a parent cannot move below its own child');
  assert.throws(() => store.update(X, 'c1', {type: 'checkbox'}), {message: 'Parent items must have type "normal"'}, 'a parent cannot become a checkbox');
  assert.equal(store.remove(X, 'c1'), 2, 'the child below goes with it');
  assert.deepEqual(store.list(X).map(i => i.id), ['p']);
  assert.throws(() => store.remove(X, 'c1'), {message: 'Cannot find menu item with id c1'});

  store.create(X, {id: 'r1', title: 'R1', type: 'radio', checked: true});
  store.create(X, {id: 'r2', title: 'R2', type: 'radio'});
  store.create(X, {id: 'plain', title: 'break'});
  store.create(X, {id: 'r3', title: 'R3', type: 'radio', checked: true});
  assert.deepEqual(store.toggle(X, 'r2'), {wasChecked: false, checked: true});
  assert.deepEqual(['r1', 'r2', 'r3'].map(id => store.find(X, id).checked), [false, true, true], 'a run of radio items is one group; r3 is in another');
  store.create(X, {id: 'box', title: 'Box', type: 'checkbox'});
  assert.deepEqual(store.toggle(X, 'box'), {wasChecked: false, checked: true});
  assert.deepEqual(store.toggle(X, 'box'), {wasChecked: true, checked: false});
  assert.equal(store.removeAll(X), true);
  assert.deepEqual(store.list(X), []);
});

test('store: restored items are replaced silently when the extension creates them again', () => {
  const store = createStore();
  store.restore(X, [{id: 'a', title: 'Old', contexts: ['page']}, {id: 'broken', type: 'weird'}, null]);
  assert.deepEqual(store.list(X).map(i => i.id), ['a'], 'a bad entry is dropped');
  assert.doesNotThrow(() => store.create(X, {id: 'a', title: 'New'}));
  assert.equal(store.find(X, 'a').title, 'New');
  assert.throws(() => store.create(X, {id: 'a', title: 'Third'}), /duplicate id a/, 'but a real duplicate still fails');
});

const page = (extra = {}) => ({pageURL: 'https://example.com/path', ...extra});
const shownFor = (store, params, id = X) => build.buildTemplates({store, extension: {id, name: 'Ext'}, params, show: item => build.matchesPage(item, params), click: () => () => {}});

test('which items show: contexts, selection, link, media, editable, frame, document and target patterns', () => {
  const store = createStore();
  store.create(X, {id: 'page', title: 'Page only'});
  assert.equal(shownFor(store, page()).length, 1);
  assert.equal(shownFor(store, page({selectionText: 'hello'})).length, 0, 'the page context is not offered over a selection');
  assert.equal(shownFor(store, page({linkURL: 'https://a.test/'})).length, 0);
  assert.equal(shownFor(store, page({mediaType: 'image', srcURL: 'https://a.test/a.png'})).length, 0);
  assert.equal(shownFor(store, page({isEditable: true})).length, 0);

  const sel = createStore();
  sel.create(X, {id: 's', title: 'Search "%s"', contexts: ['selection']});
  assert.equal(shownFor(sel, page()).length, 0);
  assert.equal(shownFor(sel, page({selectionText: 'cats and dogs'}))[0].label, 'Search "cats and dogs"');
  assert.match(shownFor(sel, page({selectionText: 'x'.repeat(80)}))[0].label, /^Search "x{49}…"$/, 'a long selection is cut at 50 characters');

  const link = createStore();
  link.create(X, {id: 'l', title: 'Link', contexts: ['link'], targetUrlPatterns: ['https://*.good.test/*']});
  assert.equal(shownFor(link, page({linkURL: 'https://a.good.test/x'})).length, 1);
  assert.equal(shownFor(link, page({linkURL: 'https://bad.test/x'})).length, 0, 'targetUrlPatterns filter the link');

  const media = createStore();
  media.create(X, {id: 'i', title: 'Image', contexts: ['image']});
  media.create(X, {id: 'v', title: 'Video', contexts: ['video', 'audio']});
  assert.deepEqual(shownFor(media, page({mediaType: 'image', srcURL: 'https://a.test/a.png'})).map(i => i.label), ['Image']);
  assert.deepEqual(shownFor(media, page({mediaType: 'video', srcURL: 'https://a.test/a.mp4'})).map(i => i.label), ['Video']);

  const edit = createStore();
  edit.create(X, {id: 'e', title: 'Fill', contexts: ['editable']});
  assert.equal(shownFor(edit, page({isEditable: true})).length, 1);
  assert.equal(shownFor(edit, page()).length, 0);

  const frame = createStore();
  frame.create(X, {id: 'f', title: 'Frame', contexts: ['frame']});
  assert.equal(shownFor(frame, page()).length, 0, 'the main frame is not a "frame" context');
  assert.equal(shownFor(frame, page({frameURL: 'https://frame.test/'})).length, 1);

  const all = createStore();
  all.create(X, {id: 'a', title: 'Everywhere', contexts: ['all']});
  for (const params of [page(), page({selectionText: 's'}), page({linkURL: 'https://a.test/'}), page({isEditable: true})]) assert.equal(shownFor(all, params).length, 1);
  assert.equal(build.matchesAction(all.find(X, 'a')), false, '"all" does not include the toolbar button\'s menu');

  const docs = createStore();
  docs.create(X, {id: 'd', title: 'Doc', documentUrlPatterns: ['https://example.com/*']});
  docs.create(X, {id: 'o', title: 'Other', documentUrlPatterns: ['https://other.test/*']});
  assert.deepEqual(shownFor(docs, page()).map(i => i.label), ['Doc'], 'documentUrlPatterns look at the page');
  assert.deepEqual(shownFor(docs, page({frameURL: 'https://other.test/f'})).map(i => i.label), ['Other'], 'inside a frame they look at the frame, not the page');

  const hidden = createStore();
  hidden.create(X, {id: 'h', title: 'Hidden', visible: false});
  assert.equal(shownFor(hidden, page()).length, 0);
});

test('layout: several top-level items go under the extension\'s name; a child shows only under a shown parent; & is literal', () => {
  const store = createStore();
  store.create(X, {id: 'one', title: 'Tom & Jerry'});
  assert.equal(shownFor(store, page())[0].label, 'Tom && Jerry', 'escaped for a native menu; Acira\'s menu turns && back into &');
  store.create(X, {id: 'two', title: 'Two'});
  store.create(X, {id: 'kid', title: 'Kid', parentId: 'two'});
  store.create(X, {id: 'sel-kid', title: 'Selected only', parentId: 'two', contexts: ['selection']});
  const rows = shownFor(store, page());
  assert.equal(rows.length, 1);
  assert.equal(rows[0].label, 'Ext');
  assert.deepEqual(rows[0].submenu.map(r => r.label), ['Tom && Jerry', 'Two']);
  assert.deepEqual(rows[0].submenu[1].submenu.map(r => r.label), ['Kid'], 'the child that does not match this click is left out');
  // a parent that does not show hides its children
  const orphan = createStore();
  orphan.create(X, {id: 'p', title: 'P', contexts: ['selection']});
  orphan.create(X, {id: 'c', title: 'C', parentId: 'p', contexts: ['page']});
  assert.equal(shownFor(orphan, page()).length, 0);
  // action menu: at most ACTION_MENU_TOP_LEVEL_LIMIT top-level items, not grouped
  const many = createStore();
  for (let i = 0; i < 9; i++) many.create(X, {id: `i${i}`, title: `Item ${i}`, contexts: ['action']});
  const rowsA = build.buildTemplates({store: many, extension: {id: X, name: 'Ext'}, params: {}, show: build.matchesAction, group: false, limit: build.ACTION_MENU_TOP_LEVEL_LIMIT, click: () => () => {}});
  assert.equal(rowsA.length, 6);
});

function lazyHost(extra = {}) {
  const h = host({packages: ['context-menus'], tabs: {7: {id: 7, url: 'https://example.com/path', active: true}}, ...extra});
  const wc = {id: 7, session: h.session, isDestroyed: () => false, getURL: () => 'https://example.com/path', mainFrame: {frameTreeNodeId: 1}};
  return {h, wc};
}

test('a click names the tab as chrome.tabs does (a restored tab has its own id, not its page\'s), the engine\'s details are only the fallback', async () => {
  const {h, wc} = lazyHost();
  h.handlers.set('tabs.get', {callback: (event, id) => ({id: 2000000002, url: 'https://example.com/path', active: true}), extensionContext: false});
  await h.call('contextMenus.create', null, {id: 'search', title: 'Search %s', contexts: ['selection']});
  h.runtime.getContextMenuItems(wc, {pageURL: 'https://example.com/path', selectionText: 'cats', linkURL: '', frameURL: ''})[0].click();
  assert.equal(h.sent.at(-1)[3].id, 2000000002);
  h.handlers.set('tabs.get', {callback: () => ({__acira_error: 'No tab'}), extensionContext: false});
  h.runtime.getContextMenuItems(wc, {pageURL: 'https://example.com/path', selectionText: 'cats', linkURL: '', frameURL: ''})[0].click();
  assert.equal(h.sent.at(-1)[3].id, 7, 'no answer from the tabs package: the engine\'s details');
});

test('package: create/update/remove answer on the router; the engine\'s menu builder is replaced; a click emits onClicked with Chromium\'s info', async () => {
  const {h, wc} = lazyHost();
  assert.deepEqual(h.installed.packages, ['context-menus']);
  assert.equal(await h.call('contextMenus.create', null, {id: 'search', title: 'Search %s', contexts: ['selection']}), undefined);
  assert.deepEqual(await h.call('contextMenus.create', null, {id: 'search', title: 'Again'}), {__acira_error: 'Cannot create item with duplicate id search'});
  assert.deepEqual(await h.call('contextMenus.create', null, {title: 'No id'}), {__acira_error: 'Extensions using event pages or Service Workers must pass an id parameter to chrome.contextMenus.create'});
  const rows = h.runtime.getContextMenuItems(wc, {pageURL: 'https://example.com/path', selectionText: 'cats', linkURL: '', frameURL: ''});
  assert.equal(rows.length, 1);
  assert.equal(rows[0].label, 'Search cats');
  rows[0].click();
  assert.deepEqual(h.sent, [[ID, 'contextMenus.onClicked', {menuItemId: 'search', pageUrl: 'https://example.com/path', frameId: 0, selectionText: 'cats', editable: false}, {id: 7, url: 'https://example.com/path', active: true}]]);

  await h.call('contextMenus.create', null, {id: 'sub', title: 'Parent', contexts: ['selection']});
  await h.call('contextMenus.create', null, {id: 'check', title: 'Check', type: 'checkbox', parentId: 'sub', contexts: ['selection']});
  await h.call('contextMenus.update', null, 'sub', {title: 'Renamed'});
  const grouped = h.runtime.getContextMenuItems(wc, {pageURL: 'https://example.com/path', selectionText: 'x'});
  assert.equal(grouped[0].label, 'Test extension', 'two top-level items: the extension\'s name');
  const check = grouped[0].submenu[1].submenu[0];
  h.sent.length = 0;
  check.click();
  check.click();
  assert.deepEqual(h.sent.map(e => [e[2].menuItemId, e[2].parentMenuItemId, e[2].wasChecked, e[2].checked]), [['check', 'sub', false, true], ['check', 'sub', true, false]]);
  assert.deepEqual(await h.call('contextMenus.update', null, 'missing', {title: 'x'}), {__acira_error: 'Cannot find menu item with id missing'});
  await h.call('contextMenus.remove', null, 'sub');
  assert.equal(h.runtime.getContextMenuItems(wc, {pageURL: 'https://example.com/path', selectionText: 'x'}).length, 1);
  await h.call('contextMenus.removeAll', null);
  assert.deepEqual(h.runtime.getContextMenuItems(wc, {pageURL: 'https://example.com/path', selectionText: 'x'}), []);
  // another session's tab gets nothing
  assert.deepEqual(h.runtime.getContextMenuItems({...wc, session: {}}, {pageURL: 'https://example.com/path'}), []);
});

test('package: an extension without the contextMenus permission cannot create items (Chromium\'s gate)', async () => {
  const h = host({packages: ['context-menus'], extensions: [manifestExtension(ID, {manifest_version: 3, name: 'No perm', version: '1', permissions: []})],
    permissions: {has: (extension, name) => (extension.manifest.permissions || []).includes(name)}});
  assert.deepEqual(await h.call('contextMenus.create', null, {id: 'a', title: 'A'}), {__acira_error: 'Access to extension API denied.'});
});

test('persistence: event-page and service-worker items return after a restart; a persistent background page recreates its own', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-cm-'));
  try {
    const mv3 = manifestExtension(ID, {manifest_version: 3, name: 'Mv3', version: '1', permissions: ['contextMenus'], background: {service_worker: 'sw.js'}});
    const first = host({packages: ['context-menus'], extensions: [mv3], userData: dir});
    await first.call('contextMenus.create', null, {id: 'keep', title: 'Keep', contexts: ['page']});
    first.dispose();   // writes
    const file = path.join(dir, 'extension-context-menus', 'profile-1.json');
    assert.ok(fs.existsSync(file), 'saved');
    const second = host({packages: ['context-menus'], extensions: [mv3], userData: dir});
    const wc = {id: 1, session: second.session, isDestroyed: () => false, getURL: () => 'https://a.test/', mainFrame: {}};
    assert.deepEqual(second.runtime.getContextMenuItems(wc, {pageURL: 'https://a.test/'}).map(r => r.label), ['Keep'], 'restored when the extension loads');
    // install code runs again (update): the same id is not an error
    assert.equal(await second.call('contextMenus.create', null, {id: 'keep', title: 'Keep v2'}), undefined);
    second.dispose();
    // an extension that empties its menu does not get the old items back; one that is disabled keeps them for when it is enabled again
    const emptied = host({packages: ['context-menus'], extensions: [mv3], userData: dir});
    await emptied.call('contextMenus.removeAll', null);
    emptied.dispose();
    const afterEmpty = host({packages: ['context-menus'], extensions: [mv3], userData: dir});
    const wc2 = {id: 1, session: afterEmpty.session, isDestroyed: () => false, getURL: () => 'https://a.test/', mainFrame: {}};
    assert.deepEqual(afterEmpty.runtime.getContextMenuItems(wc2, {pageURL: 'https://a.test/'}), []);
    await afterEmpty.call('contextMenus.create', null, {id: 'later', title: 'Later'});
    afterEmpty.sessionExtensions.fire('extension-unloaded', mv3);
    afterEmpty.dispose();
    const enabled = host({packages: ['context-menus'], extensions: [mv3], userData: dir});
    const wc3 = {id: 1, session: enabled.session, isDestroyed: () => false, getURL: () => 'https://a.test/', mainFrame: {}};
    assert.deepEqual(enabled.runtime.getContextMenuItems(wc3, {pageURL: 'https://a.test/'}).map(r => r.label), ['Later'], 'disabled and enabled again');
    enabled.dispose();

    const mv2 = manifestExtension(ID, {manifest_version: 2, name: 'Mv2', version: '1', permissions: ['contextMenus'], background: {scripts: ['bg.js']}});
    fs.rmSync(path.join(dir, 'extension-context-menus'), {recursive: true, force: true});
    const third = host({packages: ['context-menus'], extensions: [mv2], userData: dir});
    await third.call('contextMenus.create', null, {id: 'mine', title: 'Mine'});
    third.dispose();
    const saved = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).extensions : {};
    assert.equal(saved[ID], undefined, 'a persistent background page is not restored from disk');
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

function world(manifest, options = {}) {
  const packages = extApi.loadPackages({fresh: true}).filter(p => p.name === 'context-menus');
  return extensionWorld({name: 'x', version: '1', permissions: ['contextMenus'], ...manifest}, {packages, ...options});
}

test('worker side: create returns the id at once, errors follow Chromium, ids are mandatory in a service worker', async () => {
  const calls = [];
  const w = world({manifest_version: 3, background: {service_worker: 'sw.js'}}, {worker: true, answer: (name, args) => { calls.push([name, ...args]); return undefined; }});
  const {chrome} = w;
  assert.equal(chrome.contextMenus.ACTION_MENU_TOP_LEVEL_LIMIT, 6);
  assert.equal(chrome.contextMenus.create({id: 'x', title: 'X'}), 'x');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(plain(calls), [['contextMenus.create', {id: 'x', title: 'X'}]]);
  const errors = [];
  chrome.contextMenus.create({title: 'No id'}, () => errors.push(chrome.runtime.lastError && chrome.runtime.lastError.message));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(errors, ['Extensions using event pages or Service Workers must pass an id parameter to chrome.contextMenus.create']);
  const onclickErrors = [];
  chrome.contextMenus.create({id: 'y', title: 'Y', onclick() {}}, () => onclickErrors.push(chrome.runtime.lastError && chrome.runtime.lastError.message));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.match(onclickErrors[0], /cannot pass an onclick parameter/);
  assert.throws(() => chrome.contextMenus.create({id: 'z', title: 'Z', type: 'bogus'}), /Error in invocation of contextMenus\.create/, 'argument checks are Chromium\'s');
  await chrome.contextMenus.update('x', {title: 'Renamed'});
  await chrome.contextMenus.remove('x');
  await chrome.contextMenus.removeAll();
  assert.deepEqual(plain(calls.slice(1)).map(c => c[0]), ['contextMenus.update', 'contextMenus.remove', 'contextMenus.removeAll']);
  let seen = null;
  chrome.contextMenus.onClicked.addListener((info, tab) => { seen = [info.menuItemId, tab && tab.id]; });
  w.emit('contextMenus.onClicked', {menuItemId: 'x'}, {id: 4});
  assert.deepEqual(seen, ['x', 4]);
});

test('page side: a persistent background page gets generated ids and may use onclick', async () => {
  const w = world({manifest_version: 2, background: {scripts: ['bg.js']}}, {worker: false, answer: () => undefined});
  const {chrome} = w;
  const first = chrome.contextMenus.create({title: 'A'}), second = chrome.contextMenus.create({title: 'B'});
  assert.equal(typeof first, 'number');
  assert.equal(second, first + 1);
  let clicked = null;
  const id = chrome.contextMenus.create({id: 'cb', title: 'Callback', onclick: (info, tab) => { clicked = [info.menuItemId, tab.id]; }});
  assert.equal(id, 'cb');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(plain(w.calls.filter(c => c.name === 'contextMenus.create')[2].args[0]).onclick, undefined, 'the function stays in the page');
  w.emit('contextMenus.onClicked', {menuItemId: 'cb'}, {id: 9});
  assert.deepEqual(clicked, ['cb', 9]);
});

test('Acira\'s own menu: extension templates become rows (a heading and rows one step in, the icon, marks); built-in checkbox rows stay toggles', () => {
  const {menuData} = require('../desktop/browser-services/context-commands.cjs');
  const clicks = [];
  const store = createStore();
  store.create(X, {id: 'a', title: 'Tom & Jerry'});
  store.create(X, {id: 'b', title: 'Parent'});
  store.create(X, {id: 'c', title: 'Radio', type: 'radio', checked: true, parentId: 'b'});
  store.create(X, {id: 'd', title: 'Box', type: 'checkbox', parentId: 'b'});
  const templates = build.buildTemplates({store, extension: {id: X, name: 'My ext'}, params: page(), icon: {url: 'data:image/png;base64,AAAA'}, show: i => build.matchesPage(i, page()), click: i => () => clicks.push(i.id)});
  const builtin = {id: 'media-mute', label: 'Mute', enabled: true, type: 'checkbox', checked: true, click: () => clicks.push('mute')};
  const data = menuData([builtin, {type: 'separator'}, ...templates]);
  assert.deepEqual(data.items.map(r => [r.label, r.depth || 0, !!r.header, r.mark || '', r.checked === undefined ? '' : r.checked]),
    [['Mute', 0, false, '', true], [undefined, 0, false, '', ''], ['My ext', 0, true, '', ''], ['Tom & Jerry', 1, false, '', ''], ['Parent', 1, true, '', ''], ['Radio', 2, false, 'dot', ''], ['Box', 2, false, 'none', '']]);
  assert.equal(data.items[2].icon, 'data:image/png;base64,AAAA');
  assert.ok(data.items[2].id.startsWith('ext:'));
  data.run(data.items[5].id);
  data.run(data.items[2].id);   // a heading has no action
  assert.deepEqual(clicks, ['c']);
  // an extension cannot fill the menu: the overlay accepts 48 rows in all
  const flood = createStore();
  for (let i = 0; i < 100; i++) flood.create(X, {id: `f${i}`, title: `F${i}`});
  const rows = build.buildTemplates({store: flood, extension: {id: X, name: 'Flood'}, params: page(), show: i => build.matchesPage(i, page()), click: () => () => {}});
  assert.ok(menuData(rows).items.length <= 25);
});
