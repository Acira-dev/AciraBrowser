'use strict';
// 13.8 (Windows laptop): an extension's page opened at install, Image Downloader's options page (src/Options/index.html), opened a window and ~0.4 s later the extension's worker logged
// "ERR_FAILED (-2) loading '.../src/Options/index.html'". Acira shows an extension's own page in a window of its own (extensionCreateTab in main.cjs); a failed first load closed that window
// and handed the error back to the extension, so the page was never there. Chromium opens an options page as ONE singleton tab (ExtensionTabUtil::OpenOptionsPage ->
// BrowserExtensionWindowController::OpenOptionsPage -> ShowSingletonTabOverwritingNTP, path respected, #fragment ignored) and loads it once the extension is there.
// Two things are fixed in desktop/browser-services/extension-page-windows.cjs and used by main.cjs: two asks for the same page close together make one window (a window that is still loading has
// no address yet, so the second ask found nothing and made another: two windows, seen in the real app), and a first load that ends in the generic ERR_FAILED (-2) is tried again while the window
// and the extension are still there. No Electron: the windows are fakes.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const {pageKey, findOpenPage, openOnce, loadWithRetry, isGenericLoadFailure} = require('../desktop/browser-services/extension-page-windows.cjs');

const ID = 'abcdefghijklmnopabcdefghijklmnop';
const PAGE = `chrome-extension://${ID}/src/Options/index.html`;
const settle = () => new Promise(resolve => setImmediate(resolve));

/** What main.cjs's extensionCreateTab does for an extension page, with fake windows: look for the open page, else make it once and load it (with the retry). */
function opener({loads = []} = {}) {
  const session = {name: 'personal'}, windows = [], made = [], notes = [];
  let loadsLeftToFail = 0, extensionLoaded = true;
  const fail = (count) => { loadsLeftToFail = count; };
  const ask = href => {
    const open = findOpenPage(windows, session, href);
    if (open) return Promise.resolve([open.webContents, open]);
    return openOnce(session, href, async () => {
      const window = {destroyed: false, url: '', shown: 0, isDestroyed: () => window.destroyed, isVisible: () => window.shown > 0, show() { window.shown++; }, close() { window.destroyed = true; },
        webContents: {session, isDestroyed: () => window.destroyed, getURL: () => window.url, loadURL: async next => { loads.push(next); await settle(); if (loadsLeftToFail > 0) { loadsLeftToFail--; throw new Error(`ERR_FAILED (-2) loading '${next}'`); } window.url = next; }}};
      windows.push(window); made.push(window);                                 // the window exists (and has no address) while its load runs, as in Electron
      try { await loadWithRetry(() => window.webContents.loadURL(href), {alive: () => !window.isDestroyed() && extensionLoaded, wait: 1, note: (error, attempt) => notes.push([attempt, String(error.message)])}); } catch (error) { window.close(); windows.splice(windows.indexOf(window), 1); throw error; }
      window.show();
      return [window.webContents, window];
    });
  };
  return {ask, windows, made, notes, fail, unload: () => { extensionLoaded = false; }, loads};
}

test('two asks for the same extension page at once make ONE window, and both get it (before: two windows)', async () => {
  const o = opener();
  const [first, second] = await Promise.all([o.ask(PAGE), o.ask(PAGE)]);
  assert.equal(o.made.length, 1, 'one window was made');
  assert.equal(first[1], second[1], 'the same window answers both');
  assert.equal(o.loads.length, 1, 'the page was loaded once');
  const third = await o.ask(PAGE);                                           // the window is open now: the usual "bring it forward"
  assert.equal(third[1], first[1]);
  assert.equal(o.made.length, 1);
});

test('three asks a few milliseconds apart, while the first is still loading, are still one window', async () => {
  const o = opener();
  const jobs = [];
  for (let i = 0; i < 3; i++) { jobs.push(o.ask(PAGE)); await Promise.resolve(); }
  const answers = await Promise.all(jobs);
  assert.equal(o.made.length, 1);
  assert.ok(answers.every(item => item[1] === answers[0][1]));
});

test('another page, another query, or another browsing profile is another open; the #fragment is not', async () => {
  const o = opener();
  await Promise.all([o.ask(PAGE), o.ask(PAGE + '#/general')]);
  assert.equal(o.made.length, 1, 'the fragment is the same page');
  await o.ask(`chrome-extension://${ID}/src/Welcome/index.html`);
  assert.equal(o.made.length, 2, 'another path');
  const a = {name: 'a'}, b = {name: 'b'};
  let makes = 0;
  const make = async () => { makes++; await settle(); return makes; };
  await Promise.all([openOnce(a, PAGE, make), openOnce(b, PAGE, make), openOnce(a, PAGE + '?x=1', make)]);
  assert.equal(makes, 3, 'session and query are part of the key');
});

test('openOnce: the in-progress open is forgotten when it ends, an error reaches every asker and is forgotten too, and a non-page address is never shared', async () => {
  const session = {};
  let makes = 0;
  const slow = async () => { makes++; await settle(); return 'window ' + makes; };
  assert.deepEqual(await Promise.all([openOnce(session, PAGE, slow), openOnce(session, PAGE, slow)]), ['window 1', 'window 1']);
  assert.equal(await openOnce(session, PAGE, slow), 'window 2', 'a later ask after the first ended makes its own');
  let tries = 0;
  const broken = async () => { tries++; await settle(); throw new Error('no window'); };
  const results = await Promise.allSettled([openOnce(session, PAGE, broken), openOnce(session, PAGE, broken)]);
  assert.deepEqual(results.map(item => item.status), ['rejected', 'rejected']);
  assert.equal(tries, 1, 'one attempt answered both');
  assert.equal(await openOnce(session, PAGE, slow), 'window 3', 'the failure did not stay');
  let plain = 0;
  await Promise.all([openOnce(session, 'https://example.com/', async () => { plain++; await settle(); }), openOnce(session, 'https://example.com/', async () => { plain++; await settle(); })]);
  assert.equal(plain, 2, 'only extension pages are one-at-a-time');
  assert.equal(await openOnce(null, PAGE, async () => 'no session'), 'no session');
});

test('a first load that ends in ERR_FAILED (-2) is tried again and the page appears (before: the window was closed and the extension got the error)', async () => {
  const o = opener();
  o.fail(2);
  const [contents, window] = await o.ask(PAGE);
  assert.equal(o.loads.length, 3, 'two failed loads and the third that worked');
  assert.equal(window.url, PAGE);
  assert.equal(window.destroyed, false, 'the window stayed');
  assert.deepEqual(o.notes.map(item => item[0]), [1, 2], 'each retried failure was noted (the trace)');
  assert.equal(o.made.length, 1, 'still one window');
});

test('a load that keeps failing gives up after three tries, closes the window, and the extension hears the error; the next ask starts over', async () => {
  const o = opener();
  o.fail(10);
  await assert.rejects(o.ask(PAGE), /ERR_FAILED \(-2\) loading/);
  assert.equal(o.loads.length, 3);
  assert.equal(o.made[0].destroyed, true);
  assert.deepEqual(o.windows, [], 'no window left behind');
  o.fail(0);
  const [, window] = await o.ask(PAGE);
  assert.equal(window.url, PAGE, 'a later ask opens it');
});

test('no retry for a window that is gone, an extension that is no longer loaded, or any other failure', async () => {
  const o = opener();
  o.fail(1); o.unload();
  await assert.rejects(o.ask(PAGE), /ERR_FAILED/);
  assert.equal(o.loads.length, 1, 'the extension was removed: one try');
  let calls = 0;
  await assert.rejects(loadWithRetry(async () => { calls++; throw new Error("ERR_FILE_NOT_FOUND (-6) loading 'x'"); }, {wait: 1}), /ERR_FILE_NOT_FOUND/);
  assert.equal(calls, 1, 'a missing file is not a race');
  await assert.rejects(loadWithRetry(async () => { calls++; throw new Error("ERR_ABORTED (-3) loading 'x'"); }, {wait: 1}), /ERR_ABORTED/);
  assert.equal(calls, 2, 'a load that something else replaced is not tried again');
  let gone = false;
  calls = 0;
  await assert.rejects(loadWithRetry(async () => { calls++; gone = true; throw new Error("ERR_FAILED (-2) loading 'x'"); }, {alive: () => !gone, wait: 1}), /ERR_FAILED/);
  assert.equal(calls, 1, 'the window was closed while it loaded');
});

test('what counts as the generic failure: Electron\'s text with code -2, or code ERR_FAILED / errno -2; nothing else', () => {
  assert.equal(isGenericLoadFailure(new Error("ERR_FAILED (-2) loading 'chrome-extension://x/y.html'")), true);
  assert.equal(isGenericLoadFailure(Object.assign(new Error('x'), {code: 'ERR_FAILED'})), true);
  assert.equal(isGenericLoadFailure(Object.assign(new Error('x'), {errno: -2})), true);
  for (const bad of ["ERR_ABORTED (-3) loading 'x'", "ERR_FILE_NOT_FOUND (-6) loading 'x'", "ERR_BLOCKED_BY_CLIENT (-20) loading 'x'", 'ERR_FAILED without a code', '', null, undefined]) assert.equal(isGenericLoadFailure(bad), false, String(bad));
});

test('the waits between tries grow (the extension is given time to finish loading) and are bounded', async () => {
  const waits = [];
  let calls = 0;
  await assert.rejects(loadWithRetry(async () => { calls++; throw new Error("ERR_FAILED (-2) loading 'x'"); }, {wait: 100, sleep: async ms => { waits.push(ms); }}), /ERR_FAILED/);
  assert.equal(calls, 3);
  assert.deepEqual(waits, [100, 200], 'about 0.3 s in all before the extension is told');
});

test('main.cjs: the new-window branch of extensionCreateTab goes through openOnce and loadWithRetry, and still finds an open page first', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'main.cjs'), 'utf8');
  const start = main.indexOf('async function extensionCreateTab(');
  const end = main.indexOf('function extensionSelect(', start);
  assert.ok(start > 0 && end > start);
  const body = main.slice(start, end);
  assert.match(body, /findOpenPage\(BrowserWindow\.getAllWindows\(\),ses,target\.href\)/, 'an open window of the page is brought forward first');
  assert.match(body, /pageWindows\.openOnce\(ses,target\.href,async\(\)=>\{/, 'the new window is made under openOnce');
  assert.match(body, /pageWindows\.loadWithRetry\(\(\)=>window\.webContents\.loadURL\(target\.href\)/, 'its first load goes through the retry');
  const branch = body.slice(body.indexOf('pageWindows.openOnce'));
  assert.doesNotMatch(branch.replace(/pageWindows\.loadWithRetry\(\(\)=>window\.webContents\.loadURL\(target\.href\)/, ''), /await window\.webContents\.loadURL\(/, 'no bare first load is left in the new-window branch');
  assert.match(branch, /extension page load failed/, 'a retried failure is written to the extension trace');
});
