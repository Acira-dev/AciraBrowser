'use strict';
// activeTab (ext-api/scripting*.cjs, surfaces/active-tab.cjs): a click on the toolbar button, a keyboard command or a menu item lets the extension
// script that tab, as in Chrome; before that, and on another origin, it cannot.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {EventEmitter} = require('node:events');
const extApi = require('../desktop/browser-services/ext-api/index.cjs');
const activeTab = require('../desktop/browser-services/ext-api/surfaces/active-tab.cjs');
const bridge = require('../desktop/browser-services/ext-api/surfaces/bridge.cjs');
const {host, manifestExtension, ID} = require('./fixtures/ext-api-p8/host.cjs');
const {extensionWorld, plain} = require('./fixtures/ext-api/world.cjs');

test('grant: one tab, the origin it was given for, gone when the tab moves to another origin', () => {
  const session = {};
  assert.equal(activeTab.grant(session, ID, 7, 'https://a.test/page?x=1'), true);
  assert.equal(activeTab.has(session, ID, 7, 'https://a.test/other'), true, 'same origin, another page');
  assert.equal(activeTab.has(session, ID, 7, 'https://b.test/'), false, 'another origin');
  assert.equal(activeTab.has(session, ID, 8, 'https://a.test/'), false, 'another tab');
  assert.equal(activeTab.has({}, ID, 7, 'https://a.test/'), false, 'another profile');
  assert.equal(activeTab.grant(session, ID, 9, 'chrome://settings'), false, 'only web pages');
  activeTab.revoke(session, ID, 7);
  assert.equal(activeTab.has(session, ID, 7, 'https://a.test/'), false);
});

function fakeTab(id, url) {
  const calls = [];
  const frame = (frameTreeNodeId, own, frameUrl, parent = null) => ({frameTreeNodeId, url: frameUrl, parent, executeJavaScript: async code => { calls.push(['frame', frameTreeNodeId, code]); return own; }, processId: 1, routingId: frameTreeNodeId + 10});
  const main = frame(0, 'main-result', url), sub = frame(5, 'sub-result', new URL('/embed', url).href, main), blank = frame(7, 'blank-result', 'about:blank', main), foreign = frame(6, 'foreign-result', 'https://pay.example/card', main);
  main.framesInSubtree = [main, sub, foreign, blank];
  return {id, calls, isDestroyed: () => false, getURL: () => url, mainFrame: main,
    executeJavaScriptInIsolatedWorld: async (world, scripts) => { calls.push(['isolated', world, scripts[0].code]); return 'isolated-result'; },
    insertCSS: async (css, options) => { calls.push(['css', css, options]); return 'key'; }};
}
function scriptingHost(extra = {}) {
  const tabs = new Map(), store = Object.assign(new EventEmitter(), {tabs: new Set(), getTabById: id => tabs.get(id) || null});
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-script-'));
  fs.writeFileSync(path.join(dir, 'content.js'), 'document.title');
  const extension = manifestExtension(ID, {manifest_version: 3, name: 'Img', version: '1', permissions: ['activeTab', 'scripting'], action: {}, background: {service_worker: 'sw.js'}}, 'Img', {path: dir});
  const h = host({packages: ['scripting', 'action', 'context-menus', 'commands'], extensions: [extension], store, seed: ({router}) => {
    router.handlers.set('browserAction.activate', {callback: () => 'engine', allowRemote: true, extensionContext: false});
  }, ...extra});
  h.tabs = tabs; h.dir = dir; h.extension = extension; h.store = store;
  return h;
}

test('main: without a grant the page is out of reach; after a click the extension may script that tab (isolated world, files, all frames, MAIN, CSS)', async () => {
  const h = scriptingHost();
  try {
    const wc = fakeTab(7, 'https://example.com/a');
    h.tabs.set(7, wc);
    const run = (name, details) => h.call(`scripting.activeTab.${name}`, null, details);
    const func = {target: {tabId: 7}, world: 'ISOLATED', source: '(() => document.title)(...[])'};
    assert.deepEqual(await run('executeScript', func), {unavailable: true}, 'no grant yet: Chromium\'s own answer stands');
    // the toolbar click grants
    const activate = h.handlers.get('browserAction.activate').callback;
    assert.equal(activate({type: 'frame', sender: {id: 1}}, {eventType: 'click', extensionId: ID, tabId: 7}), 'engine');
    const result = await run('executeScript', func);
    assert.deepEqual(result, [{frameId: 0, documentId: '1:10', result: 'isolated-result'}]);
    assert.equal(wc.calls[0][0], 'isolated');
    assert.ok(wc.calls[0][1] >= 1_100_000, 'the extension\'s own world');
    assert.equal(wc.calls[0][2], '(() => document.title)(...[])');
    // files from the extension folder, every frame
    wc.calls.length = 0;
    const files = await run('executeScript', {target: {tabId: 7, allFrames: true}, files: ['content.js']});
    assert.deepEqual(files.map(r => [r.frameId, r.result]), [[0, 'isolated-result'], [5, 'sub-result'], [7, 'blank-result']], 'allFrames: the origin the person used the extension on (an about:blank frame of it included); the cross-origin payment frame is skipped');
    assert.deepEqual(wc.calls.map(c => [c[0], c[2]]), [['isolated', 'document.title'], ['frame', 'document.title'], ['frame', 'document.title']]);
    assert.equal(wc.calls.some(c => c[1] === 6), false, 'nothing ran in the frame of another origin');
    const named = await run('executeScript', {target: {tabId: 7, frameIds: [6]}, source: 'document.cookie'});
    assert.match(named.__acira_error, /^Cannot access contents of url "https:\/\/pay\.example\/card"\. Extension manifest must request permission/, 'a frame named by id is refused');
    assert.equal(wc.calls.some(c => c[1] === 6), false);
    assert.equal(await run('insertCSS', {target: {tabId: 7, allFrames: true}, css: 'a{color:red}'}), undefined);
    assert.equal(wc.calls.some(c => c[1] === 6), false, 'insertCSS skips that frame as well');
    assert.deepEqual(await run('executeScript', {target: {tabId: 7}, files: ['../outside.js']}), {__acira_error: "Could not load file: '../outside.js'."});
    wc.calls.length = 0;
    await run('executeScript', {target: {tabId: 7}, world: 'MAIN', source: '1+1'});
    assert.deepEqual(wc.calls, [['frame', 0, '1+1']]);
    assert.equal(await run('insertCSS', {target: {tabId: 7}, css: 'body{color:red}'}), undefined);
    assert.deepEqual(wc.calls.at(-1), ['css', 'body{color:red}', {cssOrigin: 'author'}]);
    // the tab goes to another origin: the grant is over
    wc.getURL = () => 'https://other.test/';
    assert.deepEqual(await run('executeScript', func), {unavailable: true}, 'another origin');
    assert.deepEqual(await run('executeScript', {target: {tabId: 99}, source: '1'}), {unavailable: true}, 'no such tab here');
    assert.deepEqual(await run('executeScript', {target: {}, source: '1'}), {__acira_error: 'Invalid target.'});
  } finally { fs.rmSync(h.dir, {recursive: true, force: true}); }
});

test('an extension whose host permissions cover the page gets Chromium\'s own executeScript (content-script world with chrome.runtime), also after a toolbar click', async () => {
  const covered = new Set(['https://example.com']);
  const h = scriptingHost({permissions: {has: (extension, name) => (extension.manifest.permissions || []).includes(name), hasOrigin: (extension, url) => covered.has(new URL(url).origin)}});
  try {
    const wc = fakeTab(7, 'https://example.com/a');
    h.tabs.set(7, wc);
    h.handlers.get('browserAction.activate').callback({type: 'frame', sender: {id: 1}}, {eventType: 'click', extensionId: ID, tabId: 7});
    const run = (name, details) => h.call(`scripting.activeTab.${name}`, null, details);
    assert.deepEqual(await run('executeScript', {target: {tabId: 7}, files: ['content.js']}), {unavailable: true}, 'host access: not Acira\'s world without chrome');
    assert.deepEqual(await run('insertCSS', {target: {tabId: 7}, css: 'a{}'}), {unavailable: true});
    assert.deepEqual(wc.calls, [], 'nothing ran through the activeTab path');
    covered.clear();   // no host access: the click\'s grant is what lets it script this tab
    assert.equal(Array.isArray(await run('executeScript', {target: {tabId: 7}, source: '1'})), true);
  } finally { fs.rmSync(h.dir, {recursive: true, force: true}); }
});

test('without the activeTab permission a click grants nothing that can be used', async () => {
  const h = scriptingHost({extensions: [manifestExtension(ID, {manifest_version: 3, name: 'No', version: '1', permissions: ['scripting'], action: {}})],
    permissions: {has: (extension, name) => (extension.manifest.permissions || []).includes(name)}});
  try {
    h.tabs.set(7, fakeTab(7, 'https://example.com/'));
    h.handlers.get('browserAction.activate').callback({type: 'frame'}, {eventType: 'click', extensionId: ID, tabId: 7});
    assert.deepEqual(await h.call('scripting.activeTab.executeScript', null, {target: {tabId: 7}, source: '1'}), {unavailable: true});
  } finally { fs.rmSync(h.dir, {recursive: true, force: true}); }
});

test('a menu item and a keyboard command grant the tab as well', async () => {
  const h = scriptingHost();
  try {
    const wc = fakeTab(7, 'https://example.com/a');
    wc.session = h.session; wc.mainFrame.frameTreeNodeId = 0;
    h.tabs.set(7, wc);
    const script = () => h.call('scripting.activeTab.executeScript', null, {target: {tabId: 7}, source: '1'});
    assert.deepEqual(await script(), {unavailable: true});
    await h.call('contextMenus.create', null, {id: 'm', title: 'Use', contexts: ['page']});
    h.runtime.getContextMenuItems(wc, {pageURL: 'https://example.com/a'})[0].click();
    assert.equal(Array.isArray(await script()), true, 'after the menu click');
    activeTab.revoke(h.session, ID, 7);
    assert.deepEqual(await script(), {unavailable: true});
    const registryCommands = bridge.all('commands').find(entry => entry.session === h.session);
    h.extension.manifest.commands = {go: {description: 'Go'}};
    h.sessionExtensions.fire('extension-loaded', h.extension);
    registryCommands.controller.run(ID, 'go', wc);
    assert.equal(Array.isArray(await script()), true, 'after the keyboard command');
  } finally { fs.rmSync(h.dir, {recursive: true, force: true}); }
});

function world(native, options = {}) {
  const packages = extApi.loadPackages({fresh: true}).filter(p => p.name === 'scripting');
  return extensionWorld({manifest_version: 3, name: 'x', version: '1', permissions: ['scripting', 'activeTab']}, {packages, native, worker: false, ...options});
}
const refusal = new Error('Cannot access contents of url "https://a.test/". Extension manifest must request permission to access this host.');

test('extension side: with activeTab the main process is asked first (functions travel as source); without a grant Chromium\'s own call answers', async () => {
  const calls = [], native = [];
  const w = world({scripting: {executeScript: async details => { native.push(['script', details.target.tabId]); return [{frameId: 0, result: 'native'}]; }, insertCSS: async details => { native.push(['css', details.target.tabId]); }}},
    {answer: (name, args) => { calls.push([name, args]); const tab = args[0].target.tabId; if (tab === 3) return name === 'scripting.activeTab.executeScript' ? [{frameId: 0, result: 'T'}] : undefined; return {unavailable: true}; }});
  const {chrome} = w;
  const done = await chrome.scripting.executeScript({target: {tabId: 3, allFrames: true}, func: (a, b) => a + b, args: [1, 2]});
  assert.deepEqual(plain(done), [{frameId: 0, result: 'T'}]);
  const sent = plain(calls[0][1][0]);
  assert.equal(calls[0][0], 'scripting.activeTab.executeScript');
  assert.deepEqual(sent.target, {tabId: 3, allFrames: true});
  assert.equal(sent.world, 'ISOLATED');
  assert.match(sent.source, /^\(\(a, b\) => a \+ b\)\(\.\.\.\[1,2\]\)$/);
  assert.deepEqual(native, [], 'Chromium\'s own call is not used for a granted tab');
  await chrome.scripting.executeScript({target: {tabId: 3}, files: ['a.js'], world: 'MAIN'});
  assert.deepEqual(plain(calls[1][1][0]), {target: {tabId: 3}, world: 'MAIN', files: ['a.js']});
  await chrome.scripting.insertCSS({target: {tabId: 3}, css: 'a{}'});
  assert.equal(calls[2][0], 'scripting.activeTab.insertCSS');
  const viaCallback = await new Promise(resolve => chrome.scripting.executeScript({target: {tabId: 3}, func: () => 1}, resolve));
  assert.deepEqual(plain(viaCallback), [{frameId: 0, result: 'T'}]);
  // another tab: no grant, so Chromium's own answer
  assert.deepEqual(plain(await chrome.scripting.executeScript({target: {tabId: 4}, func: () => 1})), [{frameId: 0, result: 'native'}]);
  await chrome.scripting.insertCSS({target: {tabId: 4}, css: 'a{}'});
  assert.deepEqual(native, [['script', 4], ['css', 4]]);
});

test('extension side: Chromium\'s own call gets the page id of the tab (a tab restored from sleep has a stable id of its own, 2000000002, that Chromium does not know)', async () => {
  const seen = [];
  const w = extensionWorld({manifest_version: 3, name: 'x', version: '1', permissions: ['scripting']}, {
    packages: extApi.loadPackages({fresh: true}).filter(p => p.name === 'scripting'), worker: false,
    native: {scripting: {executeScript: async details => { seen.push(['script', details.target.tabId, details.files]); return [{frameId: 0}]; }, insertCSS: async details => { seen.push(['css', details.target.tabId]); }}},
    answer: (name, args) => (name === 'acira.tabs.pageId' ? (args[0] === 2000000002 ? 55 : args[0] === 2000000003 ? null : args[0]) : undefined)});
  await w.chrome.scripting.executeScript({target: {tabId: 2000000002, allFrames: true}, files: ['a.js'], world: 'ISOLATED'});
  await w.chrome.scripting.insertCSS({target: {tabId: 2000000002}, css: 'a{}'});
  await w.chrome.scripting.executeScript({target: {tabId: 4}, func: () => 1});
  await w.chrome.scripting.executeScript({target: {tabId: 2000000003}, func: () => 1});
  assert.deepEqual(seen, [['script', 55, ['a.js']], ['css', 55], ['script', 4, undefined], ['script', 2000000003, undefined]], 'a tab with its own id gets its page, any other id goes through as given');
});

test('extension side: Chromium\'s executeScript / insertCSS get the page behind the tab id Acira gave out (YouTube Inline Fullscreen\'s popup: "No tab with id: 2000000000"); an id Acira does not know goes on unchanged', async () => {
  const seen = [];
  const native = {scripting: {
    executeScript: async details => { seen.push(['script', details.target.tabId, details.target.allFrames, details.files]); return [{frameId: 0, result: null}]; },
    insertCSS: async details => { seen.push(['css', details.target.tabId, undefined, details.files]); }
  }};
  const pages = new Map([[2000000000, 41]]);
  const noGrant = extensionWorld({manifest_version: 3, name: 'x', version: '1', permissions: ['scripting'], host_permissions: ['*://www.youtube.com/*']}, {
    packages: extApi.loadPackages({fresh: true}).filter(p => p.name === 'scripting'), worker: false, native,
    answer: (name, args) => (name === 'acira.tabs.pageId' ? (pages.get(args[0]) ?? null) : undefined)});
  const {chrome} = noGrant;
  const target = {tabId: 2000000000, allFrames: true}, files = ['ytif_content_script.js'];
  await chrome.scripting.insertCSS({target: {tabId: 2000000000}, files: ['ytif_style.css']});
  assert.deepEqual(plain(await chrome.scripting.executeScript({target, files})), [{frameId: 0, result: null}]);
  assert.deepEqual(plain(seen), [['css', 41, null, ['ytif_style.css']], ['script', 41, true, files]], 'both calls reach Chromium with the page\'s id; the rest of the details are untouched');
  assert.equal(target.tabId, 2000000000, 'the caller\'s object is not changed');
  seen.length = 0;
  await chrome.scripting.executeScript({target: {tabId: 77}, func: () => 1});
  assert.equal(seen[0][1], 77, 'an id Acira does not know (a page id) goes on as it is');
  const viaCallback = await new Promise(resolve => chrome.scripting.executeScript({target: {tabId: 2000000000}, files}, resolve));
  assert.equal(plain(viaCallback)[0].frameId, 0);
  assert.equal(seen.at(-1)[1], 41, 'the callback form too');
});

test('extension side: a script injected by file gets Acira\'s storage.sync shim first when the package carries it (the world is new, no manifest content script made it)', async () => {
  const seen = [];
  const native = {scripting: {executeScript: async details => { seen.push(details.files); return [{frameId: 0, result: null}]; }}};
  const shimmed = extensionWorld({manifest_version: 3, name: 'x', version: '1', permissions: ['scripting', 'storage'], content_scripts: [{matches: ['*://*.youtube.com/*'], js: ['acira-storage-sync-shim.js', 'cs.js']}]}, {
    packages: extApi.loadPackages({fresh: true}).filter(p => p.name === 'scripting'), worker: false, native});
  await shimmed.chrome.scripting.executeScript({target: {tabId: 1}, files: ['cs.js']});
  await shimmed.chrome.scripting.executeScript({target: {tabId: 1}, files: ['acira-storage-sync-shim.js', 'cs.js']});
  await shimmed.chrome.scripting.executeScript({target: {tabId: 1}, files: ['cs.js'], world: 'MAIN'});
  await shimmed.chrome.scripting.executeScript({target: {tabId: 1}, func: () => 1});
  assert.deepEqual(plain(seen.slice(0, 3)), [['acira-storage-sync-shim.js', 'cs.js'], ['acira-storage-sync-shim.js', 'cs.js'], ['cs.js']], 'added once; never in the page\'s own (MAIN) world');
  assert.equal(seen[3], undefined, 'a function has no files');
  seen.length = 0;
  const plainPackage = extensionWorld({manifest_version: 3, name: 'x', version: '1', permissions: ['scripting', 'storage'], content_scripts: [{matches: ['*://*.youtube.com/*'], js: ['cs.js']}]}, {
    packages: extApi.loadPackages({fresh: true}).filter(p => p.name === 'scripting'), worker: false, native});
  await plainPackage.chrome.scripting.executeScript({target: {tabId: 1}, files: ['cs.js']});
  assert.deepEqual(plain(seen), [['cs.js']], 'a package Acira did not shim (a folder the person chose) is left alone');
});

test('extension side: an extension without activeTab never asks; Chromium\'s errors pass through; script errors from the main process reach the caller', async () => {
  const calls = [];
  const plainWorld = extensionWorld({manifest_version: 3, name: 'x', version: '1', permissions: ['scripting']}, {
    packages: extApi.loadPackages({fresh: true}).filter(p => p.name === 'scripting'), worker: false,
    native: {scripting: {executeScript: async () => { throw refusal; }}}, answer: name => { calls.push(name); }});
  await assert.rejects(() => plainWorld.chrome.scripting.executeScript({target: {tabId: 1}, func: () => 1}), /Extension manifest must request permission/);
  assert.deepEqual(calls, ['acira.tabs.pageId'], 'no activeTab: no question about the page, only which page the extension\'s tab id is');
  const failing = world({scripting: {executeScript: async () => [{frameId: 0, result: 'native'}]}}, {answer: () => ({__acira_error: 'boom'})});
  await assert.rejects(() => failing.chrome.scripting.executeScript({target: {tabId: 1}, func: () => 1}), /boom/);
  const errors = [];
  await new Promise(resolve => failing.chrome.scripting.executeScript({target: {tabId: 1}, func: () => 1}, () => { errors.push(failing.chrome.runtime.lastError && failing.chrome.runtime.lastError.message); resolve(); }));
  assert.equal(errors[0], 'boom');
});
