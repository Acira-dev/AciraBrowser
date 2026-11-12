'use strict';
// 13.8, glitch 10: 1Password logged out (no desktop app, no account) has no popup by its own choice: its background sets the popup to "" and its toolbar button opens its
// welcome page, after looking for one that is already open (chrome.tabs.query({url, currentWindow: true}), then tabs.update to bring it forward). Acira shows an extension
// page in a window of its own, which that look never finds from the browser window, so every press made another window (6 presses, 6 windows). An extension page that is
// already open in a window of its own is now brought forward (desktop/browser-services/extension-page-windows.cjs, used by extensionCreateTab in main.cjs).
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const {pageKey, findOpenPage} = require('../desktop/browser-services/extension-page-windows.cjs');

const ID = 'aeblfdkhhhdcdjpifhhbdiojplfjncoa', OTHER = 'nngceckbapebfimnlniiiahkandclblb';
const WELCOME = `chrome-extension://${ID}/app/app.html#/page/welcome?language=en`;
const SESSION = {name: 'personal'};
const fakeWindow = (url, {session = SESSION, destroyed = false, contentsDestroyed = false} = {}) => {
  const window = {
    url, shown: 0, focused: 0, restored: 0, loads: [], minimized: false, destroyed,
    isDestroyed: () => window.destroyed, isMinimized: () => window.minimized, restore() { window.restored++; window.minimized = false; }, show() { window.shown++; }, focus() { window.focused++; },
    webContents: {session, isDestroyed: () => contentsDestroyed, getURL: () => window.url, loadURL: async next => { window.loads.push(next); window.url = next; }}
  };
  return window;
};

test('an extension page is the same page with another #fragment; another path, another query, another extension or something that is not an extension page is not', () => {
  assert.equal(pageKey(`chrome-extension://${ID}/app/app.html#/page/welcome?language=en`), `chrome-extension://${ID}/app/app.html`);
  assert.equal(pageKey(`chrome-extension://${ID}/app/app.html#/page/settings`), pageKey(`chrome-extension://${ID}/app/app.html`));
  assert.notEqual(pageKey(`chrome-extension://${ID}/app/app.html?type=F#/page/welcome`), pageKey(`chrome-extension://${ID}/app/app.html#/page/welcome`), 'a query is part of the page');
  assert.notEqual(pageKey(`chrome-extension://${ID}/options.html`), pageKey(`chrome-extension://${ID}/app/app.html`));
  assert.notEqual(pageKey(`chrome-extension://${OTHER}/app/app.html`), pageKey(`chrome-extension://${ID}/app/app.html`));
  for (const value of ['https://example.com/app/app.html', 'about:blank', '', undefined, null, 'not an address']) assert.equal(pageKey(value), '', String(value));
});

test('findOpenPage finds the open window of the same page in the same session, and nothing else', () => {
  const welcome = fakeWindow(WELCOME);
  assert.equal(findOpenPage([fakeWindow('https://example.com/'), welcome], SESSION, WELCOME), welcome);
  assert.equal(findOpenPage([welcome], SESSION, `chrome-extension://${ID}/app/app.html#/page/settings`), welcome, 'the fragment does not make another page');
  assert.equal(findOpenPage([welcome], SESSION, `chrome-extension://${ID}/options.html`), null, 'another page of the extension');
  assert.equal(findOpenPage([welcome], SESSION, `chrome-extension://${ID}/app/app.html?type=F`), null, 'another query');
  assert.equal(findOpenPage([welcome], {name: 'work'}, WELCOME), null, 'another browsing profile has its own window');
  assert.equal(findOpenPage([fakeWindow(WELCOME, {destroyed: true}), fakeWindow(WELCOME, {contentsDestroyed: true})], SESSION, WELCOME), null, 'a window that is going away is not reused');
  assert.equal(findOpenPage([welcome], SESSION, 'https://example.com/'), null, 'a website is never an extension page');
  assert.equal(findOpenPage([welcome], SESSION, 'about:blank'), null);
  assert.equal(findOpenPage([], SESSION, WELCOME), null);
  const first = fakeWindow(WELCOME), second = fakeWindow(WELCOME);
  assert.equal(findOpenPage([first, second], SESSION, WELCOME), first);
  assert.equal(findOpenPage([{isDestroyed() { throw new Error('gone'); }}, welcome], SESSION, WELCOME), welcome, 'a window that throws is skipped');
});

// The text of extensionCreateTab that decides it, run against fake windows with the real helper: the button pressed six times.
const main = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'main.cjs'), 'utf8');
const from = main.indexOf('async function extensionCreateTab(');
const body = main.slice(from, main.indexOf('async function extensionRemove(', from));
const startAt = body.indexOf("const open=require('./browser-services/extension-page-windows.cjs')");
const endText = 'return [open.webContents,open];}';
const snippet = body.slice(startAt, body.indexOf(endText, startAt) + endText.length);
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

function press(windows, traces, details, href = WELCOME) {
  const helper = require('../desktop/browser-services/extension-page-windows.cjs');
  const run = new AsyncFunction('require', 'BrowserWindow', 'ses', 'target', 'details', 'process', `${snippet}\nreturn 'a new window is made';`);
  return run(request => (/extension-page-windows/.test(request) ? helper : {trace: (...parts) => traces.push(parts.join(' '))}), {getAllWindows: () => windows}, SESSION, new URL(href), details, {env: {}});
}

test('main.cjs: extensionCreateTab brings an open extension page forward before it makes a window', () => {
  assert.ok(from > 0 && startAt > 0 && snippet.length > 200, 'the reuse is in extensionCreateTab');
  assert.ok(startAt < body.indexOf('const window=new BrowserWindow('), 'it is asked before a window is made');
  assert.match(snippet, /findOpenPage\(BrowserWindow\.getAllWindows\(\),ses,target\.href\)/);
});

test('the toolbar button pressed six times: the first press makes the window, the next five bring it forward (no five more windows)', async () => {
  const windows = [], traces = [];
  const made = [];
  for (let press_ = 1; press_ <= 6; press_++) {
    const result = await press(windows, traces, {active: true});
    if (result === 'a new window is made') { const window = fakeWindow(WELCOME); windows.push(window); made.push(press_); } else assert.equal(result[1], windows[0], 'the same window comes back');
  }
  assert.deepEqual(made, [1], 'a window only for the first press');
  assert.equal(windows.length, 1);
  assert.equal(windows[0].shown, 5);
  assert.equal(windows[0].focused, 5, 'in front each time');
  assert.deepEqual(windows[0].loads, [], 'the same address: nothing is loaded again');
  assert.equal(traces.length, 5);
  assert.match(traces[0], /already open/);
});

test('an open page asked for with another #fragment is pointed there; a minimised one is restored; a background request does not take the focus', async () => {
  const window = fakeWindow(WELCOME); window.minimized = true;
  const result = await press([window], [], {active: true}, `chrome-extension://${ID}/app/app.html#/page/settings`);
  assert.equal(result[1], window);
  assert.deepEqual(window.loads, [`chrome-extension://${ID}/app/app.html#/page/settings`]);
  assert.equal(window.restored, 1);
  assert.equal(window.shown, 1);
  const quiet = fakeWindow(WELCOME);
  await press([quiet], [], {active: false});
  assert.equal(quiet.shown + quiet.focused, 0, 'active: false leaves the focus where it is');
});

test('another page of the extension, or the same page in another profile, still gets a window of its own', async () => {
  const windows = [fakeWindow(WELCOME)];
  assert.equal(await press(windows, [], {active: true}, `chrome-extension://${ID}/options.html`), 'a new window is made');
  assert.equal(await press([fakeWindow(WELCOME, {session: {name: 'work'}})], [], {active: true}), 'a new window is made');
});
