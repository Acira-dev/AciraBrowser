'use strict';
// Arc and Firefox importers on fixture profiles: what each source offers, what lands in Acira (Arc's Favorites for the
// sidebar, Spaces as workspaces (R4-48; past the eighth, collapsed tab groups), pinned tabs and folders as bookmarks; Firefox's bookmarks, history and site
// icons), and that Undo takes it all back.
const { test, after } = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os');
// Test files run in parallel processes. A private temp folder keeps this file's snapshot copies (acira-import-*) out of
// the leftover counts other import tests make in the shared one.
const privateTemp = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-arcfox-tests-'));
process.env.TEMP = process.env.TMP = process.env.TMPDIR = privateTemp;
after(() => fs.rmSync(privateTemp, { recursive: true, force: true }));
const { DatabaseSync } = require('node:sqlite');
const { BrowserDatabase } = require('../desktop/database.cjs'), { createImporter } = require('../desktop/imports.cjs'), { createInitialState } = require('../desktop/runtime.cjs');
const { parseArcSidebar, arcTabGroups, findSidebar } = require('../desktop/browser-services/import-arc.cjs');
const firefox = require('../desktop/browser-services/import-firefox.cjs');
const { createFaviconStore } = require('../desktop/browser-services/favicon-store.cjs');

const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
const temp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), name));

/** Arc's sidebar as Arc writes it: flat [id, item, id, item] lists, Spaces with "pinned"/"unpinned" containers. */
function arcSidebar() {
  const tab = (id, url, title, extra = {}) => [id, { id, title: extra.title ?? null, createdAt: 750000000, childrenIds: [], data: { tab: { savedURL: url, savedTitle: title } } }];
  const container = (id, children) => [id, { id, childrenIds: children, data: { itemContainer: { containerType: {} } } }];
  const folder = (id, title, children) => [id, { id, title, childrenIds: children, data: { list: {} } }];
  const items = [
    ...container('fav', ['t1', 't2']),
    ...tab('t1', 'https://mail.example.com/inbox', 'Mail'),
    ...tab('t2', 'arc://newtab', 'New Tab'),
    ...container('p1', ['t3', 'f1']),
    ...tab('t3', 'https://docs.example.com/', 'Docs', { title: 'Team docs' }),
    ...folder('f1', 'Research', ['t4', 't5']),
    ...tab('t4', 'https://paper.example.org/a', 'Paper A'),
    ...tab('t5', 'javascript:alert(1)', 'Bad'),
    ...container('u1', ['t6']),
    ...tab('t6', 'https://today.example.com/', 'Today tab'),
    ...container('p2', ['t7']),
    ...tab('t7', 'https://news.example.net/', 'News'),
    ...container('p3', ['t8']),
    ...tab('t8', 'https://other.example.com/', 'Other profile'),
  ];
  const spaces = [
    'work', { id: 'work', title: 'Work', profile: { default: true }, containerIDs: ['unpinned', 'u1', 'pinned', 'p1'], customInfo: { iconType: { emoji_v2: '💼' }, windowTheme: { background: { single: { _0: { style: { color: { _0: { blendedSingleColor: { _0: { color: { red: 0.2, green: 0.42, blue: 0.95, alpha: 1 } } } } } } } } } } } },
    'home', { id: 'home', title: 'Personal', profile: { default: true }, containerIDs: ['pinned', 'p2', 'unpinned', 'u2'] },
    'side', { id: 'side', title: 'Side project', profile: { custom: { _0: { directoryBasename: 'Profile 1', machineID: 'x' } } }, containerIDs: ['pinned', 'p3'] },
  ];
  return { sidebar: { containers: [{ global: {} }, { items, spaces, topAppsContainerIDs: [{ default: true }, 'fav'] }] } };
}

function arcFixture() {
  const root = temp('acira-arc-'), userData = path.join(root, 'Arc', 'User Data');
  for (const folder of ['Default', 'Profile 1']) fs.mkdirSync(path.join(userData, folder), { recursive: true });
  fs.writeFileSync(path.join(root, 'Arc', 'StorableSidebar.json'), JSON.stringify(arcSidebar()));
  fs.writeFileSync(path.join(userData, 'Local State'), JSON.stringify({ profile: { info_cache: { Default: { name: 'Arc' }, 'Profile 1': { name: 'Side' } } } }));
  const db = new DatabaseSync(path.join(userData, 'Default', 'History'));
  db.exec('CREATE TABLE urls(url TEXT,title TEXT,last_visit_time INTEGER)');
  db.prepare('INSERT INTO urls VALUES(?,?,?)').run('https://visited.example.com/', 'Visited', (BigInt(Date.now()) + 11644473600000n) * 1000n);
  db.close();
  return { root, userData };
}

function importerFor(root, options, prepare = () => {}) {
  const database = new BrowserDatabase(path.join(root, 'acira.sqlite'));
  let state = createInitialState();
  prepare(state);
  const importer = createImporter({ database, getState: () => state, commit: (next) => { state = next; }, ...options });
  return { importer, state: () => state, close: () => database.close() };
}

test('Arc: the sidebar parses into Favorites and Spaces per profile, skipping arc:// pages, unpinned tabs and non-web links', () => {
  const raw = arcSidebar();
  const own = parseArcSidebar(raw, 'Default');
  assert.deepEqual(own.favorites, [{ url: 'https://mail.example.com/inbox', title: 'Mail' }]);
  assert.deepEqual(own.spaces.map((space) => [space.title, space.tabs.map((tab) => tab.title)]), [['Work', ['Team docs', 'Paper A']], ['Personal', ['News']]]);
  assert.deepEqual(own.spaces[0].tree.map((node) => [node.type, node.name]), [['url', 'Team docs'], ['folder', 'Research']]);
  const side = parseArcSidebar(raw, 'Profile 1');
  assert.deepEqual(side.favorites, [], 'Favorites belong to the default profile');
  assert.deepEqual(side.spaces.map((space) => space.title), ['Side project']);
  assert.deepEqual(parseArcSidebar({}, 'Default'), { favorites: [], spaces: [] });
  const { groups, skipped } = arcTabGroups(own.spaces, 2);
  assert.deepEqual(groups.map((group) => [group.name, group.tabs.length]), [['Work', 2]]);
  assert.equal(skipped, 1);
});

test('Arc: discovered with its Favorites and Spaces; import makes workspaces, bookmarks and history; Undo removes them', () => {
  const { root, userData } = arcFixture();
  assert.equal(findSidebar(path.join(userData, 'Default')), path.join(root, 'Arc', 'StorableSidebar.json'));
  const { importer, state, close } = importerFor(root, { roots: [['Arc', userData]] });
  const sources = importer.discover();
  const arc = sources.find((source) => source.name === 'Arc');
  assert.ok(arc && arc.browser === 'Arc');
  assert.deepEqual(arc.available, { bookmarks: true, history: true, preferences: false, extensions: false, favorites: true, spaces: true });
  const preview = importer.preview(arc.id);
  assert.equal(preview.favorites, 1);
  assert.equal(preview.spaces, 2);
  assert.equal(preview.pinned, 3);
  assert.equal(preview.bookmarks, 3);
  const tabsBefore = state().tabs.length, workspacesBefore = state().workspaces.length;
  const batch = importer.run(arc.id, ['favorites', 'spaces', 'bookmarks', 'history']);
  assert.deepEqual(batch.results.map((row) => [row.category, row.status]), [['bookmarks', 'imported'], ['history', 'imported'], ['favorites', 'imported'], ['spaces', 'imported']]);
  assert.equal(batch.results.find((row) => row.category === 'spaces').workspaces, 2);
  assert.deepEqual(batch.favorites, [{ url: 'https://mail.example.com/inbox', title: 'Mail' }]);
  // R4-48 P0-10: each Space is a workspace after the profile's own first one (Alt+2, Alt+3), with its emoji and colour.
  const profile = state().activeBrowserProfileId, own = state().workspaces.filter((workspace) => workspace.browserProfileId === profile);
  assert.deepEqual(own.map((workspace) => workspace.name), ['', 'Work', 'Personal']);
  assert.equal(own[0].id, 'workspace-default', 'the first workspace stays first, so tabs without a stamp stay in it');
  assert.deepEqual(own.slice(1).map((workspace) => workspace.id), batch.workspaceIds);
  assert.equal(own[1].icon, '💼');
  assert.equal(own[1].color, '#0088ff', 'the Arc theme colour, as the nearest workspace colour (blue)');
  assert.equal(own[2].icon, undefined);
  // Top-level pinned tabs stay pinned; a folder becomes a collapsed group inside its workspace.
  const tabs = state().tabs.filter((tab) => batch.tabIds.includes(tab.id));
  assert.deepEqual(tabs.map((tab) => [tab.title, tab.url, tab.pinned, tab.group, tab.workspaceId]), [
    ['Team docs', 'https://docs.example.com/', true, '', own[1].id],
    ['Paper A', 'https://paper.example.org/a', false, 'Research', own[1].id],
    ['News', 'https://news.example.net/', true, '', own[2].id],
  ]);
  const groups = state().tabGroups.filter((group) => batch.groupIds.includes(group.id));
  assert.deepEqual(groups.map((group) => [group.name, group.collapsed, group.workspaceId]), [['Research', true, own[1].id]]);
  assert.ok(tabs.every((tab) => tab.contentKind === 'web' && !tab.loading && tab.browserProfileId === profile));
  const nodes = state().bookmarkNodes.filter((node) => node.importBatchId === batch.id);
  const top = nodes.find((node) => !node.parentId);
  assert.equal(top.title, 'Arc');
  assert.deepEqual(nodes.filter((node) => node.parentId === top.id).map((node) => node.title), ['Work', 'Personal']);
  assert.ok(nodes.some((node) => node.title === 'Research' && !node.url));
  assert.ok(state().browsingHistory.some((visit) => visit.url === 'https://visited.example.com/' && visit.importBatchId === batch.id));
  importer.undo(batch.id);
  assert.equal(state().tabs.length, tabsBefore);
  assert.equal(state().workspaces.length, workspacesBefore, 'Undo import removes the workspaces it made');
  assert.equal(state().tabGroups.filter((group) => batch.groupIds.includes(group.id)).length, 0);
  assert.equal(state().bookmarkNodes.filter((node) => node.importBatchId === batch.id).length, 0);
  assert.equal(state().browsingHistory.filter((visit) => visit.importBatchId === batch.id).length, 0);
  close();
  fs.rmSync(root, { recursive: true, force: true });
});

test('Arc: a Space named like a workspace here gets its own name, and Spaces past the eighth workspace become tab groups', () => {
  const { root, userData } = arcFixture();
  const { importer, state, close } = importerFor(root, { roots: [['Arc', userData]] }, (initial) => {
    const profile = initial.activeBrowserProfileId;
    initial.workspaces = [{ id: 'workspace-default', name: '', browserProfileId: profile }, { id: 'workspace-mine', name: 'Work', browserProfileId: profile }];
    for (let n = 3; n <= 7; n++) initial.workspaces.push({ id: `workspace-n${n}`, name: `Set ${n}`, browserProfileId: profile });
    initial.tabGroups.push({ id: 'group-mine', name: 'Personal', color: 'grey', collapsed: false, browserProfileId: profile });
  });
  const arc = importer.discover().find((source) => source.name === 'Arc');
  const batch = importer.run(arc.id, ['spaces']);
  const profile = state().activeBrowserProfileId, own = state().workspaces.filter((workspace) => workspace.browserProfileId === profile);
  assert.equal(own.length, 8, 'room for one more workspace only');
  assert.equal(own[7].name, 'Work · Arc', 'the first Space takes the last place, under its own name');
  const fallback = state().tabGroups.filter((group) => batch.groupIds.includes(group.id) && !group.workspaceId);
  assert.deepEqual(fallback.map((group) => [group.name, group.collapsed]), [['Personal · Arc', true]], 'the second Space falls back to a collapsed tab group');
  importer.undo(batch.id);
  assert.deepEqual(state().workspaces.map((workspace) => workspace.id).slice(0, 2), ['workspace-default', 'workspace-mine']);
  assert.equal(state().workspaces.length, 7);
  assert.deepEqual(state().tabGroups.map((group) => group.id), ['group-mine']);
  close();
  fs.rmSync(root, { recursive: true, force: true });
});

/** A Firefox profile folder with places.sqlite (roots, a folder, a separator, a smart folder) and favicons.sqlite. */
function firefoxFixture() {
  const root = temp('acira-firefox-'), home = path.join(root, 'Firefox'), location = path.join(home, 'Profiles', 'abcd.default-release');
  fs.mkdirSync(location, { recursive: true });
  fs.writeFileSync(path.join(home, 'profiles.ini'), ['[Install308046B0AF4A39CB]', 'Default=Profiles/abcd.default-release', '', '[Profile1]', 'Name=default', 'IsRelative=1', 'Path=Profiles/old.default', '', '[Profile0]', 'Name=default-release', 'IsRelative=1', 'Path=Profiles/abcd.default-release', ''].join('\r\n'));
  fs.writeFileSync(path.join(location, 'signedInUser.json'), JSON.stringify({ accountData: { email: 'fox@example.com' } }));
  const places = new DatabaseSync(path.join(location, 'places.sqlite'));
  places.exec('PRAGMA journal_mode=WAL; CREATE TABLE moz_places(id INTEGER PRIMARY KEY, url TEXT, title TEXT, last_visit_date INTEGER, hidden INTEGER DEFAULT 0); CREATE TABLE moz_bookmarks(id INTEGER PRIMARY KEY, type INTEGER, fk INTEGER, parent INTEGER, position INTEGER, title TEXT, guid TEXT, dateAdded INTEGER)');
  const now = BigInt(Date.now()) * 1000n;
  const place = places.prepare('INSERT INTO moz_places(id,url,title,last_visit_date,hidden) VALUES(?,?,?,?,?)');
  place.run(1, 'https://fox.example.com/', 'Fox', now, 0);
  place.run(2, 'https://reading.example.org/post', 'A post', now - 60000000n, 0);
  place.run(3, 'place:sort=8&maxResults=10', 'Most visited', null, 0);
  place.run(4, 'https://hidden.example.com/', 'Hidden', now, 1);
  const mark = places.prepare('INSERT INTO moz_bookmarks(id,type,fk,parent,position,title,guid,dateAdded) VALUES(?,?,?,?,?,?,?,?)');
  mark.run(1, 2, null, 0, 0, '', 'root________', 0);
  mark.run(2, 2, null, 1, 0, 'menu', 'menu________', 0);
  mark.run(3, 2, null, 1, 1, 'toolbar', 'toolbar_____', 0);
  mark.run(4, 2, null, 1, 2, 'unfiled', 'unfiled_____', 0);
  mark.run(10, 1, 1, 3, 0, 'Fox home', 'guidFox00001', 0);
  mark.run(11, 2, null, 3, 1, 'Reading', 'guidFolder01', 0);
  mark.run(12, 1, 2, 11, 0, 'A post', 'guidPost0001', 0);
  mark.run(13, 3, null, 3, 2, '', 'guidSep00001', 0);
  mark.run(14, 1, 3, 2, 0, 'Most visited', 'guidSmart001', 0);
  places.close();
  const icons = new DatabaseSync(path.join(location, 'favicons.sqlite'));
  icons.exec('CREATE TABLE moz_icons(id INTEGER PRIMARY KEY, icon_url TEXT, width INTEGER, data BLOB); CREATE TABLE moz_pages_w_icons(id INTEGER PRIMARY KEY, page_url TEXT); CREATE TABLE moz_icons_to_pages(page_id INTEGER, icon_id INTEGER)');
  icons.prepare('INSERT INTO moz_icons VALUES(?,?,?,?)').run(1, 'https://fox.example.com/favicon.png', 32, PNG);
  icons.prepare('INSERT INTO moz_icons VALUES(?,?,?,?)').run(2, 'https://fox.example.com/huge.png', 256, PNG);
  icons.prepare('INSERT INTO moz_pages_w_icons VALUES(?,?)').run(1, 'https://fox.example.com/');
  icons.prepare('INSERT INTO moz_icons_to_pages VALUES(?,?)').run(1, 1);
  icons.prepare('INSERT INTO moz_icons_to_pages VALUES(?,?)').run(1, 2);
  icons.close();
  return { root, home, location };
}

test('Firefox: profiles.ini names the default profile; bookmarks keep folders and land on the bookmarks bar', () => {
  const { root, home, location } = firefoxFixture();
  const profiles = firefox.readProfiles(home);
  assert.deepEqual(profiles.map((profile) => [profile.name, profile.isDefault]), [['default', false], ['default-release', true]]);
  assert.equal(profiles[1].location, location);
  assert.equal(firefox.displayName('default-release'), 'Default');
  assert.equal(firefox.displayName('Work'), 'Work');
  const tree = firefox.readBookmarks(location);
  assert.deepEqual(Object.keys(tree.roots), ['bookmark_bar']);
  assert.equal(tree.roots.bookmark_bar.name, 'Bookmarks bar');
  assert.deepEqual(tree.roots.bookmark_bar.children.map((node) => [node.type, node.name]), [['url', 'Fox home'], ['folder', 'Reading']]);
  const history = firefox.readHistory(location);
  assert.deepEqual(history.map((row) => row.url), ['https://fox.example.com/', 'https://reading.example.org/post']);
  assert.ok(Math.abs(history[0].time - Date.now()) < 60000);
  fs.rmSync(root, { recursive: true, force: true });
});

test('Firefox: discovered with its account email; import brings bookmarks, history and site icons from a copy; Undo removes them', () => {
  const { root, home, location } = firefoxFixture();
  // M's favicon store (History, Bookmarks and new tab read it); nativeImage stands in for Electron's.
  const nativeImage = { createFromBuffer: (bytes) => ({ isEmpty: () => !bytes.length, getSize: () => ({ width: 32 }), toDataURL: () => 'data:image/png;base64,' + bytes.toString('base64') }) };
  const faviconStore = createFaviconStore({ file: path.join(root, 'favicons.json'), nativeImage });
  const { importer, state, close } = importerFor(root, { roots: [], firefoxRoots: [['Firefox', home]], faviconStore });
  const [source] = importer.discover().filter((item) => item.name === 'Default');
  assert.equal(source.browser, 'Firefox');
  assert.equal(source.email, 'fox@example.com');
  assert.deepEqual(source.available, { bookmarks: true, history: true, preferences: false, extensions: false, favorites: false, spaces: false });
  const preview = importer.preview(source.id);
  assert.equal(preview.bookmarks, 2);
  assert.equal(preview.history, 2);
  assert.deepEqual(preview.warnings, []);
  const leftovers = () => fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith('acira-import-')).length;
  const before = leftovers(), original = fs.readFileSync(path.join(location, 'places.sqlite'));
  const batch = importer.run(source.id, ['bookmarks', 'history']);
  assert.deepEqual(batch.results.map((row) => [row.category, row.status, row.count]), [['bookmarks', 'imported', 2], ['history', 'imported', 2]]);
  assert.equal(batch.icons, 1);
  assert.equal(leftovers(), before, 'the snapshot copies are deleted');
  assert.ok(original.equals(fs.readFileSync(path.join(location, 'places.sqlite'))), 'Firefox’s own file is only read');
  const bar = state().bookmarkNodes.find((node) => node.importBatchId === batch.id && !node.parentId);
  assert.equal(bar.title, 'Bookmarks bar');
  const icons = faviconStore.list(state().activeBrowserProfileId, new Set(['fox.example.com', 'reading.example.org']));
  assert.deepEqual(Object.keys(icons), ['fox.example.com'], 'the 32px icon, not the 256px one, and only for sites that have one');
  assert.equal(icons['fox.example.com'], 'data:image/png;base64,' + PNG.toString('base64'));
  assert.equal(faviconStore.adopt(state().activeBrowserProfileId, new Map([['fox.example.com', PNG]])), 0, 'an icon already there is kept');
  importer.undo(batch.id);
  assert.equal(state().bookmarkNodes.filter((node) => node.importBatchId === batch.id).length, 0);
  assert.equal(state().browsingHistory.filter((visit) => visit.importBatchId === batch.id).length, 0);
  close();
  fs.rmSync(root, { recursive: true, force: true });
});

test('A source can import into another local profile, and Undo from the window’s own profile still finds that batch', () => {
  const { root, home } = firefoxFixture();
  const { importer, state, close } = importerFor(root, { roots: [], firefoxRoots: [['Firefox', home]] }, (initial) => {
    initial.browserProfiles.push({ id: 'profile-work', name: 'Work', color: '#266a98', partition: 'persist:acira-profile-work' });
  });
  const [source] = importer.discover().filter((item) => item.name === 'Default');
  assert.equal(importer.sourceInfo(source.id).browser, 'Firefox');
  assert.throws(() => importer.run(source.id, ['bookmarks'], { profileId: 'nobody' }), /local profile/);
  const batch = importer.run(source.id, ['bookmarks', 'history'], { profileId: 'profile-work' });
  assert.equal(batch.profileId, 'profile-work');
  assert.ok(state().bookmarkNodes.filter((node) => node.importBatchId === batch.id).every((node) => node.browserProfileId === 'profile-work'));
  assert.ok(state().browsingHistory.filter((visit) => visit.importBatchId === batch.id).every((visit) => visit.browserProfileId === 'profile-work'));
  assert.notEqual(state().activeBrowserProfileId, 'profile-work');
  assert.equal(batch.initiatorProfileId,state().activeBrowserProfileId);
  const origin=state().activeBrowserProfileId;
  state().browserProfiles.push({id:'unrelated',name:'Unrelated',private:false,partition:'persist:unrelated'});
  state().activeBrowserProfileId='unrelated';
  assert.throws(()=>importer.undo(batch.id),/not part of this profile/);
  assert(state().bookmarkNodes.some(node=>node.importBatchId===batch.id));
  state().activeBrowserProfileId=origin;
  importer.undo(batch.id);
  assert.equal(state().bookmarkNodes.filter((node) => node.importBatchId === batch.id).length, 0);
  close();
  fs.rmSync(root, { recursive: true, force: true });
});

test('Firefox: an unreadable places database fails calmly, without error codes', () => {
  const { root, home, location } = firefoxFixture();
  fs.writeFileSync(path.join(location, 'places.sqlite'), 'not a database');
  for (const name of ['places.sqlite-wal', 'places.sqlite-shm']) fs.rmSync(path.join(location, name), { force: true });
  const { importer, close } = importerFor(root, { roots: [], firefoxRoots: [['Firefox', home]] });
  const [source] = importer.discover().filter((item) => item.name === 'Default');
  const batch = importer.run(source.id, ['bookmarks', 'history']);
  const history = batch.results.find((row) => row.category === 'history');
  assert.equal(history.status, 'failed');
  assert.match(history.error, /^Couldn't read Firefox's history right now\. Try again, or close Firefox first\.$/);
  assert.deepEqual(batch.results.find((row) => row.category === 'bookmarks'), { category: 'bookmarks', status: 'failed', error: "Couldn't read Firefox's bookmarks right now. Try again, or close Firefox first." });
  close();
  fs.rmSync(root, { recursive: true, force: true });
});
