'use strict';
// 13.7, GitHub issue #4 ("Tabrr: the login window opens blank"). An extension asking for a tab with no address (chrome.tabs.create({}): Tabrr's toolbar button does exactly that, and
// Chrome opens the New Tab page) reached main.cjs' extensionCreateTab with an empty address, which became about:blank in an "Acira extension" window: a dark, empty window. The
// engine's own tabs.create answers {} itself, but the library's handler stays when that package is not installed (installPackages only logs a package that failed), and the library
// passes the missing address on. The no-address request now opens the New Tab page in the browser; an explicit about:blank is still a blank page.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const {asksForNewTab} = require('../desktop/browser-services/extension-new-tab.cjs');

test('asksForNewTab: no address, an empty one or one of the New Tab addresses; never about:blank or a real page', () => {
  for (const yes of [undefined, null, '', '   ', 'chrome://newtab', 'chrome://newtab/', 'CHROME://NEWTAB/', 'chrome://new-tab-page/', 'about:newtab', 'chrome-search://local-ntp/local-ntp.html']) assert.equal(asksForNewTab(yes), true, String(yes));
  for (const no of ['about:blank', 'https://tabrr.com/how-it-works.html', 'chrome-extension://ehmneimbopigfgchjglgngamiccjkijh/newtab.html', 'chrome://settings/', 'chrome://newtab/x', 'about:newtabs', 'data:text/html,hi']) assert.equal(asksForNewTab(no), false, no);
});

const main = fs.readFileSync(path.join(__dirname, '../desktop/main.cjs'), 'utf8');
const start = main.indexOf('async function extensionCreateTab(details={}){');
const text = main.slice(start, main.indexOf('/* `profileId`: the extension\'s profile', start));

function run(details, {profiles = [{id: 'p1', private: false, partition: 'persist:p1'}]} = {}) {
  const calls = {dispatched: [], windows: [], shown: 0, loaded: []};
  const state = {browserProfiles: profiles, activeBrowserProfileId: 'p1', tabs: []};
  const BrowserWindow = function (options) { calls.windows.push(options); this.webContents = {loadURL: async url => { calls.loaded.push(url); }, setWindowOpenHandler() {}, on() {}}; this.setMenu = () => {}; this.on = () => {}; this.id = 9; this.show = () => {}; this.isDestroyed = () => false; this.close = () => {}; };
  BrowserWindow.getAllWindows = () => [];   // extensionCreateTab looks for the extension's page already open in a window (extension-page-windows.cjs, 1Password): none here
  const factory = new Function('privateMode', 'windowClosing', 'quitting', 'state', 'dispatch', 'validateAction', 'showMain', 'parseExternalURLs', 'BrowserWindow', 'path', 'dist', 'tm', 'require', 'auxiliaries', 'extensionManager', 'ensurePage', 'loadPage', 'process',
    `${text}\nreturn extensionCreateTab;`);
  const fake = {session: {fromPartition: () => ({extensions: {getExtension: () => null}})}};
  const create = factory(false, false, false, state, action => calls.dispatched.push(action), (action) => action, () => { calls.shown++; }, list => list.map(value => { try { const u = new URL(value); return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : undefined; } catch { return undefined; } }),
    BrowserWindow, path, '/dist', key => key, name => (name === 'electron' ? fake : name.startsWith('.') ? require(path.join(__dirname, '../desktop', name)) : require(name)), new Map(), {attachTab() {}}, async () => ({}), async () => {}, process);
  return create(details).then(result => ({calls, result}), error => ({calls, error}));
}

test('main.cjs extensionCreateTab: a request with no address opens the New Tab page in the browser, makes no window, and says the page cannot be handed to the extension', async () => {
  assert.ok(start > 0 && text.length > 500, 'the function was found');
  for (const details of [{}, {url: ''}, {url: 'chrome://newtab/'}, {active: true}]) {
    const {calls, error} = await run(details);
    assert.equal(calls.windows.length, 0, 'no "Acira extension" window for ' + JSON.stringify(details));
    assert.deepEqual(calls.dispatched, [{type: 'tab.new', background: false, browserProfileId: 'p1'}]);
    assert.equal(calls.shown, 1, 'the browser comes to the front');
    assert.match(String(error && error.message), /new tab page opened in the browser/);
  }
  // in the background: the tab is made without being selected, and the window stays where it is
  const {calls} = await run({active: false});
  assert.deepEqual(calls.dispatched, [{type: 'tab.new', background: true, browserProfileId: 'p1'}]);
  assert.equal(calls.shown, 0);
  // the extension's own profile
  const second = await run({profileId: 'p2'}, {profiles: [{id: 'p1', private: false}, {id: 'p2', private: false}]});
  assert.equal(second.calls.dispatched[0].browserProfileId, 'p2');
});

test('main.cjs extensionCreateTab: an explicit about:blank is still a blank page in an extension window, and a website is still a tab', async () => {
  const blank = await run({url: 'about:blank'});
  assert.equal(blank.calls.windows.length, 1, 'asked for, so made');
  assert.deepEqual(blank.calls.loaded, ['about:blank']);
  assert.deepEqual(blank.calls.dispatched, []);
  const site = await run({url: 'https://tabrr.com/how-it-works.html'});
  assert.equal(site.calls.windows.length, 0);
  assert.equal(site.calls.dispatched[0].type, 'tab.new');
  assert.equal(site.calls.dispatched[0].url, 'https://tabrr.com/how-it-works.html');
});
