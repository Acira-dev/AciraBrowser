'use strict';
// chrome.scripting.removeCSS (Chromium: extensions/browser/api/scripting/scripting_api.cc ScriptingRemoveCSSFunction, which removes the sheet with the key
// InjectionKeyForCode / InjectionKeyForFile that insertCSS gave it). On 13.7 only executeScript and insertCSS knew the tab ids Acira gives extensions
// (2000000000 and up), so removeCSS answered "No tab with id: 2000000000" for every extension, and a sheet inserted after a toolbar click (activeTab) could
// not be removed at all.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {EventEmitter} = require('node:events');
const extApi = require('../desktop/browser-services/ext-api/index.cjs');
const activeTab = require('../desktop/browser-services/ext-api/surfaces/active-tab.cjs');
const {host, manifestExtension, ID} = require('./fixtures/ext-api-p8/host.cjs');
const {extensionWorld, plain} = require('./fixtures/ext-api/world.cjs');

const manifest = {manifest_version: 3, name: 'Css', version: '1', permissions: ['activeTab', 'scripting'], background: {service_worker: 'sw.js'}};

function fakeTab(id, url) {
  const calls = [];
  let counter = 0;
  const frame = (frameTreeNodeId, frameUrl, parent = null) => ({frameTreeNodeId, url: frameUrl, parent, processId: 1, routingId: 10 + frameTreeNodeId,
    executeJavaScript: async code => { calls.push(['frame', frameTreeNodeId, code]); }});
  const main = frame(0, url), sub = frame(5, new URL('/embed', url).href, main);
  main.framesInSubtree = [main, sub];
  return {id, calls, isDestroyed: () => false, getURL: () => url, mainFrame: main,
    insertCSS: async (css, options) => { const key = 'key' + (++counter); calls.push(['insert', key, css, options.cssOrigin]); return key; },
    removeInsertedCSS: async key => { calls.push(['remove', key]); }};
}
function scriptingHost() {
  const tabs = new Map(), store = Object.assign(new EventEmitter(), {tabs: new Set(), getTabById: id => tabs.get(id) || null});
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-remove-css-'));
  fs.writeFileSync(path.join(dir, 'a.css'), 'a{color:red}');
  fs.writeFileSync(path.join(dir, 'b.css'), 'b{color:blue}');
  const extension = manifestExtension(ID, manifest, 'Css', {path: dir});
  const h = host({packages: ['scripting'], extensions: [extension], store});
  h.tabs = tabs; h.dir = dir;
  return h;
}

test('extension side: removeCSS gets the page behind the tab id Acira gave out, like insertCSS (13.7: "No tab with id: 2000000000")', async () => {
  const seen = [];
  const w = extensionWorld({manifest_version: 3, name: 'x', version: '1', permissions: ['scripting']}, {
    packages: extApi.loadPackages({fresh: true}).filter(pkg => pkg.name === 'scripting'), worker: false,
    native: {scripting: {removeCSS: async (details, callback) => { seen.push(['remove', details.target.tabId, details.css]); if (callback) callback(); }, insertCSS: async details => { seen.push(['insert', details.target.tabId]); }}},
    answer: (name, args) => (name === 'acira.tabs.pageId' ? (args[0] === 2000000002 ? 55 : args[0]) : undefined)});
  await w.chrome.scripting.insertCSS({target: {tabId: 2000000002}, css: 'a{}'});
  await w.chrome.scripting.removeCSS({target: {tabId: 2000000002}, css: 'a{}'});
  await w.chrome.scripting.removeCSS({target: {tabId: 4}, css: 'a{}'});
  await new Promise(resolve => w.chrome.scripting.removeCSS({target: {tabId: 2000000002}, css: 'b{}'}, resolve));
  assert.deepEqual(seen, [['insert', 55], ['remove', 55, 'a{}'], ['remove', 4, 'a{}'], ['remove', 55, 'b{}']]);
});

test('extension side: with an activeTab grant the main process is asked first (the sheet it inserted is its own); without a grant Chromium\'s call answers', async () => {
  const asked = [], native = [];
  const w = extensionWorld(manifest, {packages: extApi.loadPackages({fresh: true}).filter(pkg => pkg.name === 'scripting'), worker: false,
    native: {scripting: {removeCSS: async details => { native.push(details.target.tabId); }}},
    answer: (name, args) => { asked.push(name); return args[0] && args[0].target && args[0].target.tabId === 3 ? undefined : {unavailable: true}; }});
  await w.chrome.scripting.removeCSS({target: {tabId: 3}, css: 'a{}'});
  await w.chrome.scripting.removeCSS({target: {tabId: 4}, css: 'a{}'});
  assert.deepEqual(asked.filter(name => name.startsWith('scripting.activeTab')), ['scripting.activeTab.removeCSS', 'scripting.activeTab.removeCSS']);
  assert.deepEqual(native, [4], 'only the tab without a grant went to Chromium');
});

test('main: removeCSS takes out the sheet insertCSS put in (code or file, AUTHOR or USER, main frame and sub-frames), and only that one', async () => {
  const h = scriptingHost();
  try {
    const wc = fakeTab(7, 'https://example.com/a');
    h.tabs.set(7, wc);
    activeTab.grant(h.session, ID, 7, wc.getURL());
    const call = (name, details) => h.call(`scripting.activeTab.${name}`, null, details);
    await call('insertCSS', {target: {tabId: 7, allFrames: true}, css: 'p{x:1}'});
    await call('insertCSS', {target: {tabId: 7}, css: 'p{x:1}', origin: 'USER'});
    await call('insertCSS', {target: {tabId: 7}, files: ['a.css', 'b.css']});
    const inserted = wc.calls.filter(c => c[0] === 'insert');
    assert.deepEqual(inserted.map(c => [c[2], c[3]]), [['p{x:1}', 'author'], ['p{x:1}', 'user'], ['a{color:red}', 'author'], ['b{color:blue}', 'author']], 'a file is a sheet of its own, as in Chromium');
    wc.calls.length = 0;
    // removing code that was inserted as AUTHOR takes the AUTHOR sheet only
    assert.equal(await call('removeCSS', {target: {tabId: 7, allFrames: true}, css: 'p{x:1}'}), undefined);
    assert.deepEqual(wc.calls.filter(c => c[0] === 'remove'), [['remove', 'key1']]);
    assert.equal(wc.calls.some(c => c[0] === 'frame' && /data-acira-css/.test(c[2]) && /remove\(\)/.test(c[2])), true, 'the sub-frame\'s <style> goes as well');
    wc.calls.length = 0;
    await call('removeCSS', {target: {tabId: 7}, css: 'p{x:1}', origin: 'USER'});
    assert.deepEqual(wc.calls.filter(c => c[0] === 'remove'), [['remove', 'key2']], 'the USER sheet is its own');
    wc.calls.length = 0;
    await call('removeCSS', {target: {tabId: 7}, files: ['b.css']});
    assert.deepEqual(wc.calls.filter(c => c[0] === 'remove'), [['remove', 'key4']], 'one file out of two');
    wc.calls.length = 0;
    await call('removeCSS', {target: {tabId: 7}, css: 'never inserted'});
    assert.deepEqual(wc.calls.filter(c => c[0] === 'remove'), [], 'nothing to remove is not an error (Chromium)');
    // the same sheet twice, removed once: both go
    await call('insertCSS', {target: {tabId: 7}, css: 'q{}'});
    await call('insertCSS', {target: {tabId: 7}, css: 'q{}'});
    wc.calls.length = 0;
    await call('removeCSS', {target: {tabId: 7}, css: 'q{}'});
    assert.equal(wc.calls.filter(c => c[0] === 'remove').length, 2);
  } finally { fs.rmSync(h.dir, {recursive: true, force: true}); h.dispose(); }
});

test('main: removeCSS follows insertCSS\'s rules: no grant is Chromium\'s answer, bad arguments and files are refused', async () => {
  const h = scriptingHost();
  try {
    const wc = fakeTab(7, 'https://example.com/a');
    h.tabs.set(7, wc);
    const call = (name, details) => h.call(`scripting.activeTab.${name}`, null, details);
    assert.deepEqual(await call('removeCSS', {target: {tabId: 7}, css: 'a{}'}), {unavailable: true}, 'no grant');
    activeTab.grant(h.session, ID, 7, wc.getURL());
    assert.deepEqual(await call('removeCSS', {target: {tabId: 7}}), {__acira_error: "Exactly one of 'css' and 'files' must be specified."});
    assert.deepEqual(await call('removeCSS', {target: {tabId: 7}, files: ['../outside.css']}), {__acira_error: "Could not load file: '../outside.css'."});
  } finally { fs.rmSync(h.dir, {recursive: true, force: true}); h.dispose(); }
});
