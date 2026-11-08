'use strict';
// chrome.tabs (package P1): Chromium's semantics over a fake Acira tab model, through the real patched preload.
const test = require('node:test');
const assert = require('node:assert/strict');
const {createRig, ID, SESSION} = require('./fixtures/ext-api-tabs/rig.cjs');
const {plain} = require('./fixtures/ext-api/world.cjs');
const activeTab = require('../desktop/browser-services/ext-api/surfaces/active-tab.cjs');

/** Two windows: #1 (focused) pinned "Mail", "Docs" (active), grouped "News"; a private tab and a Tor tab sit in the strip too. #2 one tab. */
function scene(options) {
  const rig = createRig(options);
  const one = rig.addWindow({focused: true}), two = rig.addWindow();
  const mail = rig.addTab(one, {url: 'https://mail.example.com/inbox', title: 'Inbox', pinned: true, favicon: 'data:mail'});
  const docs = rig.addTab(one, {url: 'https://docs.example.com/a', title: 'Docs A'});
  rig.addTab(one, {url: 'https://secret.example/', title: 'Private', privacy: 'private'});
  const news = rig.addTab(one, {url: 'https://news.example.org/', title: 'News', group: 'Reading'});
  rig.addTab(one, {url: 'https://tor.example/', title: 'Tor', privacy: 'tor'});
  const sleeping = rig.addTab(one, {url: 'https://asleep.example/', title: 'Asleep', page: false});
  one.state.activeTabId = docs.id;
  one.state.tabGroups.push({id: 'g-reading', name: 'Reading', color: 'blue', collapsed: false, browserProfileId: 'p'});
  const other = rig.addTab(two, {url: 'https://other.example.com/', title: 'Other'});
  two.state.activeTabId = other.id;
  const wcOf = (window, tab) => window.pages.get(tab.id).view.webContents;
  return {rig, one, two, mail, docs, news, sleeping, other, wcOf};
}

test('query: every tab in Acira\'s order (also one with no page, as discarded); pinned, group, active, windows; private and Tor tabs never appear', async () => {
  const {rig, one, two, wcOf, mail, docs, news} = scene();
  const all = plain(await rig.world.chrome.tabs.query({}));
  assert.deepEqual(all.map(t => t.title), ['Inbox', 'Docs A', 'News', 'Asleep', 'Other']);
  assert.deepEqual(all.map(t => t.index), [0, 1, 2, 3, 0], 'index is the strip position among ordinary tabs (private and Tor tabs leave no gap)');
  assert.deepEqual(all.map(t => t.windowId), [one.id, one.id, one.id, one.id, two.id]);
  const byTitle = Object.fromEntries(all.map(t => [t.title, t]));
  assert.equal(byTitle.Inbox.pinned, true);
  assert.equal(byTitle.Inbox.favIconUrl, 'data:mail');
  assert.equal(byTitle['Docs A'].active, true);
  assert.equal(byTitle['Docs A'].highlighted, true);
  assert.equal(byTitle.Inbox.active, false);
  assert.equal(byTitle.News.groupId > 0, true, 'a tab in an Acira group has its numeric group id');
  assert.equal(byTitle.Inbox.groupId, -1);
  assert.equal(byTitle.Other.active, true, 'one active tab per window');
  assert.equal(byTitle.Inbox.id, wcOf(one, mail).id, 'the tab id is the page id');
  assert.equal(byTitle.Inbox.discarded, false);
  assert.equal(byTitle.Asleep.discarded, true, 'a tab with no page is a discarded tab');
  assert.equal(byTitle.Asleep.status, 'unloaded');
  assert.equal(byTitle.Asleep.id >= 2000000000, true, 'it has an id of its own');
  assert.equal(byTitle.Asleep.url, 'https://asleep.example/');
  assert.equal(byTitle.Inbox.incognito, false);
  assert.deepEqual(byTitle.Inbox.mutedInfo, {muted: false});
  assert.equal(byTitle.Inbox.width, 1000);
  assert.equal(byTitle.Inbox.status, 'complete');
  assert.equal(typeof byTitle.Inbox.lastAccessed, 'number');
  void docs; void news;

  assert.deepEqual(plain(await rig.world.chrome.tabs.query({active: true, currentWindow: true})).map(t => t.title), ['Docs A'], 'the current window is the focused one');
  assert.deepEqual(plain(await rig.world.chrome.tabs.query({active: true, lastFocusedWindow: true})).map(t => t.title), ['Docs A']);
  assert.deepEqual(plain(await rig.world.chrome.tabs.query({currentWindow: false})).map(t => t.title), ['Other']);
  assert.deepEqual(plain(await rig.world.chrome.tabs.query({windowId: two.id})).map(t => t.title), ['Other']);
  assert.deepEqual(plain(await rig.world.chrome.tabs.query({windowId: -2})).map(t => t.title), ['Inbox', 'Docs A', 'News', 'Asleep'], 'WINDOW_ID_CURRENT');
  assert.deepEqual(plain(await rig.world.chrome.tabs.query({pinned: true})).map(t => t.title), ['Inbox']);
  assert.deepEqual(plain(await rig.world.chrome.tabs.query({index: 0, windowId: one.id})).map(t => t.title), ['Inbox']);
  assert.deepEqual(plain(await rig.world.chrome.tabs.query({groupId: byTitle.News.groupId})).map(t => t.title), ['News']);
  assert.deepEqual(plain(await rig.world.chrome.tabs.query({windowType: 'popup'})).map(t => t.title), []);
  assert.deepEqual(plain(await rig.world.chrome.tabs.query({windowType: 'normal'})).length, 5);
  assert.deepEqual(plain(await rig.world.chrome.tabs.query({url: '*://*.example.com/*'})).map(t => t.title), ['Inbox', 'Docs A', 'Other']);
  assert.deepEqual(plain(await rig.world.chrome.tabs.query({url: ['https://news.example.org/', 'https://mail.example.com/inbox']})).map(t => t.title), ['Inbox', 'News']);
  assert.deepEqual(plain(await rig.world.chrome.tabs.query({title: 'Docs*'})).map(t => t.title), ['Docs A']);
  assert.deepEqual(plain(await rig.world.chrome.tabs.query({discarded: true})).map(t => t.title), ['Asleep']);
  assert.equal(plain(await rig.world.chrome.tabs.query({discarded: false})).length, 4);
  assert.deepEqual(plain(await rig.world.chrome.tabs.query({status: 'unloaded'})).map(t => t.title), ['Asleep']);
  assert.deepEqual(plain(await rig.world.chrome.tabs.query({status: 'loading'})), []);
});

test('query: a bad url pattern rejects with Chromium\'s message; argument errors are Chromium\'s exact text', async () => {
  const {rig} = scene();
  await assert.rejects(rig.world.chrome.tabs.query({url: 'nonsense'}), {message: "Invalid url pattern 'nonsense'"});
  assert.throws(() => rig.world.chrome.tabs.query({foo: 1}),
    {message: "Error in invocation of tabs.query(object queryInfo, optional function callback): Error at parameter 'queryInfo': Unexpected property: 'foo'."});
  assert.throws(() => rig.world.chrome.tabs.get('x'), /Error in invocation of tabs.get\(integer tabId, optional function callback\)/);
});

test('url, title and favIconUrl need the tabs permission, host access, or activeTab on the active tab', async () => {
  const bare = scene({manifest: {manifest_version: 3, permissions: []}});
  const tabs = plain(await bare.rig.world.chrome.tabs.query({}));
  assert.equal(tabs.length, 5);
  for (const tab of tabs) { assert.equal('url' in tab, false); assert.equal('title' in tab, false); assert.equal('favIconUrl' in tab, false); assert.equal(typeof tab.id, 'number'); }
  assert.deepEqual(plain(await bare.rig.world.chrome.tabs.query({url: '*://*/*'})), [], 'a filter on url cannot probe pages it may not see');
  assert.deepEqual(plain(await bare.rig.world.chrome.tabs.query({title: '*'})), []);

  const host = scene({manifest: {manifest_version: 3, permissions: [], host_permissions: ['https://docs.example.com/']}});
  const seen = plain(await host.rig.world.chrome.tabs.query({}));
  assert.deepEqual(seen.filter(t => 'url' in t).map(t => t.url), ['https://docs.example.com/a'], 'host access reveals exactly those pages');

  // activeTab is a grant the person gives by using the extension on a tab; declaring it in the manifest shows nothing (no install warning,
  // so a standing read of every window's active tab would be a silent history feed).
  const active = scene({manifest: {manifest_version: 3, permissions: ['activeTab']}});
  assert.deepEqual(plain(await active.rig.world.chrome.tabs.query({})).filter(t => 'url' in t).map(t => t.title), [], 'activeTab declared, never used: nothing is revealed');
  assert.deepEqual(plain(await active.rig.world.chrome.tabs.query({active: true, currentWindow: true})).map(t => 'url' in t), [false]);
  assert.deepEqual(plain(await active.rig.world.chrome.tabs.query({url: '*://*/*', active: true})), [], 'and a url filter cannot probe the active tabs either');
  const docsPage = active.wcOf(active.one, active.docs);
  activeTab.grant(SESSION, ID, docsPage.id, docsPage.getURL());   // the person clicked the extension's button on Docs A
  assert.deepEqual(plain(await active.rig.world.chrome.tabs.query({})).filter(t => 'url' in t).map(t => t.title), ['Docs A'], 'the tab it was used on, and only that one');
  assert.equal(plain(await active.rig.world.chrome.tabs.get(docsPage.id)).url, 'https://docs.example.com/a');
  docsPage.url = 'https://bank.example/login';   // the tab goes on to another origin: the grant ends
  assert.deepEqual(plain(await active.rig.world.chrome.tabs.query({})).filter(t => 'url' in t), [], 'another origin: scrubbed again');
  activeTab.revoke(SESSION, ID, docsPage.id);
});

test('get / getCurrent: Chromium errors, openerTabId, pending states', async () => {
  const {rig, one, docs, news, wcOf} = scene();
  const tab = plain(await rig.world.chrome.tabs.get(wcOf(one, docs).id));
  assert.equal(tab.url, 'https://docs.example.com/a');
  await assert.rejects(rig.world.chrome.tabs.get(99999), {message: 'No tab with id: 99999.'});
  const privateId = [...one.pages.values()].map(e => e.view.webContents).find(wc => wc.url === 'https://secret.example/').id;
  await assert.rejects(rig.world.chrome.tabs.get(privateId), {message: `No tab with id: ${privateId}.`});
  assert.equal(await rig.world.chrome.tabs.getCurrent(), undefined, 'a service worker is in no tab');
  news.openerId = docs.id;
  assert.equal(plain(await rig.world.chrome.tabs.get(wcOf(one, news).id)).openerTabId, wcOf(one, docs).id);
  // callback form: no value, runtime.lastError set
  const failed = await new Promise(resolve => rig.world.chrome.tabs.get(123456, () => resolve(rig.world.chrome.runtime.lastError && rig.world.chrome.runtime.lastError.message)));
  assert.equal(failed, 'No tab with id: 123456.');
  // getCurrent in an extension page that sits in a tab
  const page = rig.call('tabs.getCurrent');
  assert.equal(page, undefined);
  const caller = rig.event({type: 'frame', sender: wcOf(one, docs)});
  assert.equal(rig.handlers.get('tabs.getCurrent').callback(caller).id, wcOf(one, docs).id);
});

test('create: url, active, index, pinned, window, opener and Chromium\'s errors', async () => {
  const {rig, one, two, docs} = scene();
  const created = plain(await rig.world.chrome.tabs.create({url: 'https://new.example.net/', index: 1, windowId: one.id}));
  assert.equal(created.url, 'https://new.example.net/');
  assert.equal(created.index, 1, 'placed at the requested position (after the pinned tab)');
  assert.equal(created.windowId, one.id);
  assert.equal(created.active, true);
  assert.deepEqual(one.state.tabs.map(t => t.title || t.url).slice(0, 3), ['Inbox', 'https://new.example.net/', 'Docs A']);

  const pinned = plain(await rig.world.chrome.tabs.create({url: 'https://pin.example.net/', pinned: true, active: false}));
  assert.equal(pinned.pinned, true);
  assert.equal(pinned.index, 1, 'a pinned tab goes after the other pinned tabs');
  assert.equal(pinned.active, false);

  const second = plain(await rig.world.chrome.tabs.create({url: 'https://two.example.net/', windowId: two.id}));
  assert.equal(second.windowId, two.id);
  const absolute = plain(await rig.world.chrome.tabs.create({url: 'https://far.example.net/', index: 999}));
  assert.equal(absolute.index, plain(await rig.world.chrome.tabs.query({windowId: one.id})).length - 1, 'an index past the end means the end');

  await assert.rejects(rig.world.chrome.tabs.create({url: 'https://x.example/', windowId: 4242}), {message: 'No window with id: 4242.'});
  await assert.rejects(rig.world.chrome.tabs.create({url: 'http://'}), {message: 'Invalid url: "http://".'});
  await assert.rejects(rig.world.chrome.tabs.create({url: 'javascript:alert(1)'}), /JavaScript URLs are not allowed/);
  await assert.rejects(rig.world.chrome.tabs.create({url: 'https://x.example/', openerTabId: 31337}), {message: 'No tab with id: 31337.'});
  const otherId = [...two.pages.values()][0].view.webContents.id;
  await assert.rejects(rig.world.chrome.tabs.create({url: 'https://x.example/', openerTabId: otherId, windowId: one.id}), {message: 'Tab opener must be in the same window as the newly created tab.'});
  void docs;
});

test('create without a url opens Acira\'s new-tab page: a Tab with an id that update and remove accept right away', async () => {
  const {rig, one} = scene();
  const tab = plain(await rig.world.chrome.tabs.create({}));
  assert.equal(typeof tab.id, 'number');
  assert.equal(tab.id >= 2000000000, true, 'no page yet: an id of its own');
  assert.equal(tab.windowId, one.id);
  assert.equal(tab.active, true);
  assert.equal(tab.url, 'chrome://newtab/', 'Acira\'s internal pages are shown as chrome:// pages');
  assert.equal(tab.status, 'complete');
  assert.equal(tab.discarded, false);
  const last = one.state.tabs[one.state.tabs.length - 1];
  assert.equal(last.url, 'acira://newtab');
  assert.equal(plain(await rig.world.chrome.tabs.get(tab.id)).id, tab.id);
  const moved = plain(await rig.world.chrome.tabs.update(tab.id, {url: 'https://later.example/'}));
  assert.equal(moved.id, tab.id);
  assert.deepEqual(rig.dispatched.at(-1), {type: 'tab.navigate', url: 'https://later.example/', tabId: last.id});
  await rig.world.chrome.tabs.remove(tab.id);
  assert.equal(one.state.tabs.includes(last), false);
  await assert.rejects(rig.world.chrome.tabs.get(tab.id), {message: `No tab with id: ${tab.id}.`});
  const ntp = plain(await rig.world.chrome.tabs.create({url: 'chrome://newtab/', active: false}));
  assert.equal(ntp.active, false);
  assert.equal(typeof ntp.id, 'number');
});

test('create: a relative url is the extension\'s own page (opened as the engine did, in an extension window)', async () => {
  const {rig} = scene();
  const tab = plain(await rig.world.chrome.tabs.create({url: 'options.html'}));
  assert.equal(tab.url, `chrome-extension://${rig.ID}/options.html`);
  assert.equal(tab.windowId > 500, true);
  assert.equal(tab.index, 0);
});

test('update: navigation, pin, mute (reason extension), activate, opener, autoDiscardable, Chromium\'s errors', async () => {
  const {rig, one, mail, docs, news, wcOf} = scene();
  const newsId = wcOf(one, news).id;
  const navigated = plain(await rig.world.chrome.tabs.update(newsId, {url: 'https://changed.example/path'}));
  assert.equal(navigated.url, 'https://changed.example/path');
  assert.deepEqual(rig.dispatched.at(-1), {type: 'tab.navigate', url: 'https://changed.example/path', tabId: news.id});

  const pinned = plain(await rig.world.chrome.tabs.update(newsId, {pinned: true}));
  assert.equal(pinned.pinned, true);
  assert.equal(pinned.index, 1, 'pinning moves the tab after the pinned tabs');
  await rig.world.chrome.tabs.update(newsId, {pinned: true});
  assert.equal(rig.dispatched.filter(a => a.type === 'tab.pin').length, 1, 'pinning a pinned tab changes nothing');

  const muted = plain(await rig.world.chrome.tabs.update(newsId, {muted: true}));
  assert.deepEqual(muted.mutedInfo, {muted: true, reason: 'extension', extensionId: rig.ID});
  const unmuted = plain(await rig.world.chrome.tabs.update(newsId, {muted: false}));
  assert.deepEqual(unmuted.mutedInfo, {muted: false});

  const activated = plain(await rig.world.chrome.tabs.update(newsId, {active: true}));
  assert.equal(activated.active, true);
  assert.equal(one.state.activeTabId, news.id);
  assert.equal(plain(await rig.world.chrome.tabs.update(newsId, {autoDiscardable: false})).autoDiscardable, false);

  // no tab id: the active tab of the current window
  const current = plain(await rig.world.chrome.tabs.update({url: 'https://current.example/'}));
  assert.equal(current.id, newsId);
  await assert.rejects(rig.world.chrome.tabs.update(77777, {pinned: true}), {message: 'No tab with id: 77777.'});
  await assert.rejects(rig.world.chrome.tabs.update(newsId, {openerTabId: 5}), {message: 'No tab with id: 5.'});
  await assert.rejects(rig.world.chrome.tabs.update(newsId, {url: 'javascript:void(0)'}), /JavaScript URLs are not allowed/);
  await assert.rejects(rig.world.chrome.tabs.update(newsId, {url: 'ftp://files.example/'}), /Cannot open ftp: addresses/);
  void mail; void docs;
});

test('remove, reload, move, highlight, detectLanguage', async () => {
  const {rig, one, two, mail, docs, news, wcOf} = scene();
  const [mailId, docsId, newsId] = [mail, docs, news].map(t => wcOf(one, t).id);
  await rig.world.chrome.tabs.reload(docsId);
  assert.deepEqual(wcOf(one, docs).reloads, ['reload']);
  await rig.world.chrome.tabs.reload(docsId, {bypassCache: true});
  assert.deepEqual(wcOf(one, docs).reloads, ['reload', 'bypass']);
  await rig.world.chrome.tabs.reload();
  assert.equal(wcOf(one, docs).reloads.length, 3, 'no id: the active tab of the current window');
  await assert.rejects(rig.world.chrome.tabs.reload(1234), {message: 'No tab with id: 1234.'});

  // move within the window (pinned tabs stay first), and a list moves in order
  const moved = plain(await rig.world.chrome.tabs.move(newsId, {index: 0}));
  assert.equal(moved.index, 1, 'an unpinned tab cannot go before a pinned one: clamped to the first unpinned slot');
  const both = plain(await rig.world.chrome.tabs.move([docsId, newsId], {index: -1}));
  assert.deepEqual(both.map(t => t.id), [docsId, newsId]);
  assert.deepEqual(plain(await rig.world.chrome.tabs.query({windowId: one.id})).map(t => t.title), ['Inbox', 'Asleep', 'Docs A', 'News']);
  await assert.rejects(rig.world.chrome.tabs.move(docsId, {windowId: two.id, index: 0}), /another existing window/);
  await assert.rejects(rig.world.chrome.tabs.move(555, {index: 0}), {message: 'No tab with id: 555.'});

  const window = plain(await rig.world.chrome.tabs.highlight({tabs: 0}));
  assert.equal(window.id, one.id);
  assert.equal(one.state.activeTabId, mail.id);
  await assert.rejects(rig.world.chrome.tabs.highlight({tabs: 50}), {message: 'No tab at index: 50.'});
  await assert.rejects(rig.world.chrome.tabs.highlight({tabs: 0, windowId: 99}), {message: 'No window with id: 99.'});

  assert.equal(await rig.world.chrome.tabs.detectLanguage(mailId), 'en');
  wcOf(one, mail).lang = 'zh-cn';
  assert.equal(await rig.world.chrome.tabs.detectLanguage(mailId), 'zh-CN');
  wcOf(one, mail).lang = '';
  assert.equal(await rig.world.chrome.tabs.detectLanguage(mailId), 'und');

  await rig.world.chrome.tabs.remove([docsId, newsId]);
  assert.equal(one.pages.size >= 1, true);
  assert.equal([...one.pages.values()].some(e => e.view.webContents.id === docsId), false);
  await assert.rejects(rig.world.chrome.tabs.remove(docsId), {message: `No tab with id: ${docsId}.`});
});

test('constants and members: every Chromium member exists; unbuilt ones answer "Access to extension API denied."', async () => {
  const {rig} = scene();
  const tabs = rig.world.chrome.tabs;
  assert.equal(tabs.TAB_ID_NONE, -1);
  assert.equal(tabs.TAB_INDEX_NONE, -1);
  assert.equal(tabs.SPLIT_VIEW_ID_NONE, -1);
  assert.equal(tabs.MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND, 2);
  for (const name of ['get', 'getCurrent', 'create', 'query', 'update', 'move', 'highlight', 'detectLanguage', 'remove', 'reload', 'captureVisibleTab', 'duplicate', 'sendMessage', 'connect'])
    assert.equal(typeof tabs[name], 'function', name);
  for (const name of ['onCreated', 'onUpdated', 'onMoved', 'onActivated', 'onHighlighted', 'onDetached', 'onAttached', 'onRemoved', 'onReplaced'])
    assert.equal(typeof tabs[name].addListener, 'function', name);
  await assert.rejects(tabs.discard(1), {message: 'Access to extension API denied.'});
  assert.equal(rig.world.browser.tabs.TAB_ID_NONE, -1, 'Chromium\'s separate `browser` object has the same namespace');
});

test('captureVisibleTab asks the engine\'s capture about the window Acira says is meant', async () => {
  const {rig, one, two, wcOf, docs, other} = scene();
  const seen = [];
  rig.handlers.set('tabs.captureVisibleTab', {callback: (event, windowId, options) => { seen.push([windowId, options]); return 'data:image/png;base64,AA'; }, extensionContext: true});
  // a second install point: wrap() reads the engine's current handler, so install on top of it
  const again = require('../desktop/browser-services/ext-api/index.cjs').installPackages(rig.base, {packages: require('../desktop/browser-services/ext-api/index.cjs').loadPackages({fresh: true}).filter(p => p.name === 'tabs')});
  assert.equal(await rig.call('tabs.captureVisibleTab', null, null), 'data:image/png;base64,AA');
  assert.deepEqual(seen.at(-1), [one.id, null], 'the current window is the focused one, passed by id');
  assert.equal(await rig.call('tabs.captureVisibleTab', two.id, {format: 'jpeg'}), 'data:image/png;base64,AA');
  assert.deepEqual(seen.at(-1), [two.id, {format: 'jpeg'}]);
  assert.deepEqual(await rig.call('tabs.captureVisibleTab', 777, null), {__acira_error: 'No window with id: 777.'});
  again.dispose();
  void wcOf; void docs; void other;
});

test('sendMessage reports "no receiver" like Chrome: a Manifest V3 page asks the engine for its promise form (the engine\'s lastError is not visible to the page); a Manifest V2 page keeps the callback form', async () => {
  const noReceiver = 'Could not establish connection. Receiving end does not exist.';
  const forms = [], zoomSeen = [];
  // The engine as it behaves in Acira: with a callback it runs the callback with NO lastError the page can read (it sets its own and logs
  // "Unchecked runtime.lastError"); without one it rejects.
  const native = {tabs: {sendMessage(tabId, message, ...rest) {
    const callback = typeof rest[rest.length - 1] === 'function' ? rest.pop() : null;
    forms.push(callback ? 'callback' : 'promise');
    if (callback) { callback(); return undefined; }
    return Promise.reject(new Error(noReceiver));
  }, getZoomSettings(...rest) { zoomSeen.push(rest.filter(value => typeof value !== 'function')); return Promise.resolve({mode: 'automatic', scope: 'per-origin'}); }}};
  const v3 = scene({native, manifest: {manifest_version: 3, permissions: []}});
  const id = v3.wcOf(v3.one, v3.docs).id, tabs = v3.rig.world.chrome.tabs;
  await assert.rejects(tabs.sendMessage(id, {checkInstalled: true}), {message: noReceiver});
  const seenInCallback = await new Promise(resolve => tabs.sendMessage(id, {checkInstalled: true}, response => resolve([response, v3.rig.world.chrome.runtime.lastError && v3.rig.world.chrome.runtime.lastError.message])));
  assert.deepEqual(seenInCallback, [undefined, noReceiver], 'the callback form sets chrome.runtime.lastError (YouTube Inline Fullscreen\'s popup injects its script on it)');
  assert.deepEqual(forms, ['promise', 'promise'], 'a Manifest V3 page never uses the engine\'s callback form');
  // the members that share the wrapper are given the page behind the tab id too (Chromium knows pages, an extension holds Acira's tab ids)
  const docsTab = plain(await tabs.query({active: true, windowId: v3.one.id}))[0];
  assert.deepEqual(plain(await tabs.getZoomSettings(docsTab.id)), {mode: 'automatic', scope: 'per-origin'});
  assert.deepEqual(zoomSeen, [[id]], 'Chromium got the page\'s id (the same lookup tabs.sendMessage makes)');
  forms.length = 0;
  const v2 = scene({native, manifest: {manifest_version: 2, permissions: []}});
  await v2.rig.world.chrome.tabs.sendMessage(v2.wcOf(v2.one, v2.docs).id, 'x');
  assert.deepEqual(forms, ['callback'], 'a Manifest V2 page has no promise form from the engine');
});

test('sendMessage and connect go to Electron unchanged (given the page\'s own id): promise and callback forms, Chromium\'s argument checks, a tab with no page', async () => {
  const seen = [];
  const native = {tabs: {
    sendMessage(tabId, message, ...rest) { const callback = typeof rest[rest.length - 1] === 'function' ? rest.pop() : null; seen.push(['sendMessage', tabId, message, ...rest]); if (callback) { callback({echo: message}); return undefined; } return Promise.resolve({echo: message}); },
    connect(tabId, info) { seen.push(['connect', tabId, info]); return {name: (info && info.name) || ''}; }
  }};
  const {rig, one, docs, sleeping, wcOf} = scene({native});
  const tabs = rig.world.chrome.tabs, id = wcOf(one, docs).id;
  assert.deepEqual(plain(await tabs.sendMessage(id, {hello: 1})), {echo: {hello: 1}});
  assert.deepEqual(plain(await tabs.sendMessage(id, 'x', {frameId: 0})), {echo: 'x'});
  assert.equal(seen[0].length, 3, 'an omitted options object is not passed on');
  assert.deepEqual(plain(seen[1][3]), {frameId: 0}, 'options are');
  assert.equal(await new Promise(resolve => tabs.sendMessage(id, 'cb', response => resolve(response && response.echo))), 'cb', 'callback form');
  assert.deepEqual(plain(tabs.connect(id, {name: 'port'})), {name: 'port'});
  assert.throws(() => tabs.sendMessage('x', {}), /Error in invocation of tabs.sendMessage\(integer tabId, any message, optional object options, optional function callback\)/);
  // a tab with no page cannot be messaged; one whose page was replaced is reached through its new page
  const asleepId = plain(await tabs.query({discarded: true}))[0].id;
  await assert.rejects(tabs.sendMessage(asleepId, 'hi'), {message: 'Could not establish connection. Receiving end does not exist.'});
  const page = wcOf(one, docs);
  one.pages.set(sleeping.id, {view: {webContents: Object.assign(rig.makeWc('https://asleep.example/', 'Asleep'), {})}});
  rig.store.tabs.add(one.pages.get(sleeping.id).view.webContents);
  const woken = one.pages.get(sleeping.id).view.webContents;
  assert.equal(plain(await tabs.get(asleepId)).id, asleepId, 'waking up keeps the id');
  assert.deepEqual(plain(await tabs.sendMessage(asleepId, 'again')), {echo: 'again'});
  assert.equal(seen.at(-1)[1], woken.id, 'Electron got the new page\'s id');
  assert.equal(plain(await tabs.get(woken.id)).id, asleepId, 'the page\'s own id is an alias of the tab\'s');
  void page;
});

test('zoom is Acira\'s: setZoom goes through its zoom command, getZoom reads its state, onZoomChange follows it', async () => {
  const {rig, one, docs, wcOf} = scene();
  const tabs = rig.world.chrome.tabs, id = wcOf(one, docs).id;
  assert.equal(await tabs.getZoom(id), 1);
  await tabs.setZoom(id, 1.5);
  assert.deepEqual(rig.commands.at(-1), {type: 'zoom', tabId: docs.id, zoom: 150});
  assert.equal(await tabs.getZoom(id), 1.5);
  await tabs.setZoom(0);   // the current tab, back to the default
  assert.deepEqual(rig.commands.at(-1), {type: 'zoom', tabId: docs.id, zoom: 100});
  await tabs.setZoom(id, 9);
  assert.equal(rig.commands.at(-1).zoom, 500, 'clamped to Chrome\'s range');
});

test('the current window is the focused one, else the one Acira focused last (the app may be in the background), else the first', async () => {
  const {rig, one, two} = scene();
  one.focused = false; two.last = true;
  assert.deepEqual(plain(await rig.world.chrome.tabs.query({active: true, currentWindow: true})).map(t => t.title), ['Other']);
  assert.deepEqual(plain(await rig.world.chrome.tabs.query({active: true, lastFocusedWindow: true})).map(t => t.title), ['Other']);
  two.last = false;
  rig.store.lastFocusedWindowId = one.id;
  assert.deepEqual(plain(await rig.world.chrome.tabs.query({active: true, currentWindow: true})).map(t => t.title), ['Docs A']);
  one.focused = true;
  two.focused = true;
  assert.equal(plain(await rig.world.chrome.tabs.query({active: true, currentWindow: true})).length, 1);
});

test('a page that has not committed yet: url is empty and pendingUrl is the address it is going to (both only with access)', async () => {
  const {rig, one, news, wcOf} = scene();
  const wc = wcOf(one, news);
  wc.url = ''; news.loading = true;                 // Acira's tab already has its address; the page has committed nothing
  const loading = plain(await rig.world.chrome.tabs.get(wc.id));
  assert.equal(loading.url, '');
  assert.equal(loading.pendingUrl, 'https://news.example.org/');
  assert.equal(loading.status, 'loading');
  const created = plain(await rig.world.chrome.tabs.query({status: 'loading'}));
  assert.deepEqual(created.map(t => t.pendingUrl), ['https://news.example.org/']);
  wc.url = 'https://news.example.org/'; news.loading = false;
  const done = plain(await rig.world.chrome.tabs.get(wc.id));
  assert.equal(done.url, 'https://news.example.org/');
  assert.equal('pendingUrl' in done, false);
  // a navigation away from a committed page: url stays, pendingUrl is where it is going
  news.loading = true; news.requestedUrl = 'https://elsewhere.example/';
  const navigating = plain(await rig.world.chrome.tabs.get(wc.id));
  assert.deepEqual([navigating.url, navigating.pendingUrl], ['https://news.example.org/', 'https://elsewhere.example/']);
  // no access to the page: neither is shown
  const bare = scene({manifest: {manifest_version: 3, permissions: []}});
  const bareWc = bare.wcOf(bare.one, bare.news); bareWc.url = ''; bare.news.loading = true;
  const hidden = plain(await bare.rig.world.chrome.tabs.get(bareWc.id));
  assert.equal('url' in hidden, false);
  assert.equal('pendingUrl' in hidden, false);
});

test('a popup\'s current window is the window it belongs to, focused or not; an extension window\'s page is its own window', async () => {
  const {rig, one, two} = scene();
  one.focused = false; two.focused = false; one.last = false; two.last = false;   // the app is in the background
  const popup = rig.popup(two);
  const asPopup = rig.event({type: 'frame', sender: popup});
  const listed = rig.handlers.get('tabs.query').callback(asPopup, {active: true, currentWindow: true});
  assert.deepEqual(listed.map(tab => tab.windowId), [two.id], 'the popup of window two sees window two\'s active tab');
  assert.deepEqual(rig.handlers.get('tabs.query').callback(asPopup, {active: true, windowId: -2}).map(tab => tab.windowId), [two.id]);
  assert.deepEqual(rig.handlers.get('tabs.query').callback(asPopup, {currentWindow: false}).map(tab => tab.windowId).includes(two.id), false);
  const stray = rig.popup({id: 9999});   // a page in a window the browser does not own (a helper window): the last focused window, not nothing
  one.last = true;
  assert.equal(rig.handlers.get('tabs.query').callback(rig.event({type: 'frame', sender: stray}), {active: true, currentWindow: true}).length, 1);
  one.last = false;
  const worker = rig.handlers.get('tabs.query').callback(rig.event(), {active: true, currentWindow: true});
  assert.equal(worker.length, 1, 'a worker has no window of its own: the last focused one (here the first)');
  // an options page opened as an extension window: its own window
  const options = await rig.world.chrome.tabs.create({url: 'options.html'});
  const optionsWc = [...rig.store.tabs].find(wc => wc.id === options.id);
  const asOptions = rig.event({type: 'frame', sender: optionsWc});
  assert.deepEqual(rig.handlers.get('tabs.query').callback(asOptions, {currentWindow: true}).map(tab => tab.id), [options.id]);
});

test('Acira\'s tab ids are unique per window only (every window starts with tab-home): two windows, two tabs, two ids', async () => {
  const rig = createRig();
  const one = rig.addWindow({focused: true}), two = rig.addWindow();
  rig.addTab(one, {id: 'tab-home', url: 'https://one.example/', title: 'One', page: false, contentKind: 'internal'});
  rig.addTab(two, {id: 'tab-home', url: 'https://two.example/', title: 'Two'});
  one.state.activeTabId = 'tab-home'; two.state.activeTabId = 'tab-home';
  const tabs = plain(await rig.world.chrome.tabs.query({}));
  assert.equal(tabs.length, 2);
  assert.notEqual(tabs[0].id, tabs[1].id);
  assert.deepEqual(tabs.map(tab => tab.windowId), [one.id, two.id]);
});
