'use strict';
// 13.8 item 11 (Colorway's magnifier). Chromium gives a script that an extension injects after a toolbar click the user's activation, so the page's
// own EyeDropper.open() is allowed: the click is dispatched as action.onClicked WITH user gesture (extension_action_dispatcher.cc,
// EventRouter::UserGestureState::kEnabled), the worker's chrome.scripting.executeScript call carries it (service_worker_data.cc, api_request_handler.cc),
// scripting_api.cc hands user_gesture() to the ScriptExecutor and Blink runs the script with UserActivationOption::kActivate, which notifies the frame
// (transient activation, 5 s: blink::kActivationLifespan). Acira ran the injected script with no userGesture, so open() threw NotAllowedError and Colorway
// fell back to its own panel. On Windows and Linux Chromium's ShowEyeDropper also needs the page's own view to have focus (eye_dropper_aura.cc), which a
// click on Acira's separate toolbar view takes away.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {EventEmitter} = require('node:events');
const extApi = require('../desktop/browser-services/ext-api/index.cjs');
const activeTab = require('../desktop/browser-services/ext-api/surfaces/active-tab.cjs');
const {host, manifestExtension, ID, ID2} = require('./fixtures/ext-api-p8/host.cjs');
const {extensionWorld, plain} = require('./fixtures/ext-api/world.cjs');

const LIFESPAN = 5000; // third_party/blink/public/common/frame/user_activation_state.h, kActivationLifespan

test('gestureLive: the 5 s after the click, for that extension on that tab and origin only', () => {
  const session = {};
  assert.equal(typeof activeTab.gestureLive, 'function', 'the grant has a gesture window');
  assert.equal(activeTab.grant(session, ID, 7, 'https://a.test/page', 1000), true);
  assert.equal(activeTab.gestureLive(session, ID, 7, 'https://a.test/other', 1000), true, 'at the click');
  assert.equal(activeTab.gestureLive(session, ID, 7, 'https://a.test/', 1000 + LIFESPAN), true, 'on the last millisecond');
  assert.equal(activeTab.gestureLive(session, ID, 7, 'https://a.test/', 1000 + LIFESPAN + 1), false, 'a millisecond too late');
  assert.equal(activeTab.has(session, ID, 7, 'https://a.test/'), true, 'the grant itself outlives the gesture');
  assert.equal(activeTab.gestureLive(session, ID2, 7, 'https://a.test/', 1000), false, 'another extension');
  assert.equal(activeTab.gestureLive(session, ID, 8, 'https://a.test/', 1000), false, 'another tab');
  assert.equal(activeTab.gestureLive({}, ID, 7, 'https://a.test/', 1000), false, 'another profile');
  assert.equal(activeTab.gestureLive(session, ID, 7, 'https://b.test/', 1000), false, 'the tab moved to another origin');
  assert.equal(activeTab.gestureLive(session, ID, 7, 'https://a.test/', 999), false, 'a clock that went backwards is no gesture');
  // a second click is a new gesture
  activeTab.grant(session, ID, 7, 'https://a.test/page', 9000);
  assert.equal(activeTab.gestureLive(session, ID, 7, 'https://a.test/', 9000 + LIFESPAN), true, 'the second click starts a new window');
  activeTab.revoke(session, ID, 7);
  assert.equal(activeTab.gestureLive(session, ID, 7, 'https://a.test/', 9000), false, 'revoked');
});

function fakeTab(id, url, state) {
  const calls = [];
  const frame = (frameTreeNodeId, frameUrl, parent = null) => ({frameTreeNodeId, url: frameUrl, parent, processId: 1, routingId: frameTreeNodeId + 10,
    executeJavaScript: async (code, userGesture) => { calls.push({kind: 'frame', frame: frameTreeNodeId, code, userGesture}); return 'frame-result'; }});
  const main = frame(0, url), sub = frame(5, new URL('/embed', url).href, main);
  main.framesInSubtree = [main, sub];
  return {id, calls, focusCalls: 0, isDestroyed: () => false, getURL: () => url, mainFrame: main,
    isFocused: () => state.focused.has(id),
    focus() { this.focusCalls++; state.focused.add(id); },
    executeJavaScriptInIsolatedWorld: async (world, scripts, userGesture) => { calls.push({kind: 'isolated', world, code: scripts[0].code, userGesture}); return 'isolated-result'; },
    insertCSS: async () => 'key'};
}

function scriptingHost() {
  const tabs = new Map(), front = new Map(), state = {focused: new Set()};
  const store = Object.assign(new EventEmitter(), {tabs: new Set(), getTabById: id => tabs.get(id) || null, impl: {tabModel: {}}});
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-gesture-'));
  fs.writeFileSync(path.join(dir, 'inject.js'), 'window.__colorway = 1');
  const extension = manifestExtension(ID, {manifest_version: 3, name: 'Picker', version: '1', permissions: ['activeTab', 'scripting'], action: {}, background: {service_worker: 'sw.js'}}, 'Picker', {path: dir});
  const h = host({packages: ['scripting', 'action'], extensions: [extension], store, seed: ({router}) => {
    router.handlers.set('browserAction.activate', {callback: () => 'engine', allowRemote: true, extensionContext: false});
    // chrome.tabs.get: which tab is on screen (ext-api/surfaces/own-page.cjs pageInFront)
    router.handlers.set('tabs.get', {callback: (event, tabId) => ({id: tabId, active: front.get(tabId) !== false}), allowRemote: true, extensionContext: false});
  }});
  Object.assign(h, {tabs, front, state, dir, store});
  h.click = (tabId) => h.handlers.get('browserAction.activate').callback({type: 'frame', sender: {id: 1}}, {eventType: 'click', extensionId: ID, tabId});
  h.run = (details) => h.call('scripting.activeTab.executeScript', null, details);
  return h;
}

function withClock(start, body) {
  let now = start;
  const original = Date.now;
  Date.now = () => now;
  const clock = {set: value => { now = value; }, advance: ms => { now += ms; }};
  return Promise.resolve(body(clock)).finally(() => { Date.now = original; });
}

test('a toolbar click gives the injected script the user gesture, in every frame and world, for 5 s', async () => {
  const h = scriptingHost();
  try {
    await withClock(100000, async clock => {
      const wc = fakeTab(7, 'https://example.com/a', h.state);
      h.tabs.set(7, wc);
      assert.equal(h.click(7), 'engine');
      // what Colorway's worker runs: chrome.scripting.executeScript({target: {tabId}, files: ['inject.js']})
      await h.run({target: {tabId: 7, allFrames: true}, files: ['inject.js']});
      const byKind = kind => wc.calls.filter(c => c.kind === kind);
      assert.equal(byKind('isolated').length, 1);
      assert.equal(byKind('isolated')[0].userGesture, true, 'the extension\'s isolated world (the page frame gets a transient activation)');
      assert.deepEqual(byKind('frame').map(c => [c.frame, c.userGesture]), [[5, true]], 'a sub-frame of the same origin');
      wc.calls.length = 0;
      await h.run({target: {tabId: 7}, world: 'MAIN', source: '1+1'});
      assert.deepEqual(wc.calls.map(c => [c.kind, c.userGesture]), [['frame', true]], 'the page\'s own world');
      // 5 s later it is a plain script again (the grant itself is still there)
      clock.advance(LIFESPAN + 1);
      wc.calls.length = 0;
      await h.run({target: {tabId: 7}, files: ['inject.js']});
      assert.deepEqual(wc.calls.map(c => [c.kind, c.userGesture]), [['isolated', false]], 'no gesture after the activation lifespan');
      // another click is another gesture
      h.click(7);
      wc.calls.length = 0;
      await h.run({target: {tabId: 7}, files: ['inject.js']});
      assert.deepEqual(wc.calls.map(c => [c.kind, c.userGesture]), [['isolated', true]], 'a second click');
    });
  } finally { h.dispose(); fs.rmSync(h.dir, {recursive: true, force: true}); }
});

test('without a click nothing changes: no grant is still Chromium\'s own answer, and nothing is focused', async () => {
  const h = scriptingHost();
  try {
    const wc = fakeTab(7, 'https://example.com/a', h.state);
    h.tabs.set(7, wc);
    assert.deepEqual(await h.run({target: {tabId: 7}, files: ['inject.js']}), {unavailable: true});
    assert.equal(wc.calls.length, 0);
    assert.equal(wc.focusCalls, 0);
  } finally { h.dispose(); fs.rmSync(h.dir, {recursive: true, force: true}); }
});

test('the page gets its focus back when the gesture script runs (Windows/Linux: ShowEyeDropper needs the page view focused), only the tab in front, only once', async () => {
  const h = scriptingHost();
  try {
    await withClock(500000, async clock => {
      const front = fakeTab(7, 'https://example.com/a', h.state), behind = fakeTab(8, 'https://example.com/b', h.state);
      h.tabs.set(7, front); h.tabs.set(8, behind); h.front.set(8, false);
      h.click(7); h.click(8);
      await h.run({target: {tabId: 7}, files: ['inject.js']});
      assert.equal(front.focusCalls, 1, 'the tab on screen takes the keyboard back from the toolbar');
      await h.run({target: {tabId: 7}, files: ['inject.js']});
      assert.equal(front.focusCalls, 1, 'already focused: left alone');
      await h.run({target: {tabId: 8}, files: ['inject.js']});
      assert.equal(behind.focusCalls, 0, 'a tab that is not on screen is never focused');
      // after the gesture is over the script runs but takes no focus
      h.state.focused.clear();
      clock.advance(LIFESPAN + 1);
      await h.run({target: {tabId: 7}, files: ['inject.js']});
      assert.equal(front.focusCalls, 1, 'no focus once the gesture is over');
    });
  } finally { h.dispose(); fs.rmSync(h.dir, {recursive: true, force: true}); }
});

test('a missing or failing focus() never breaks the injection', async () => {
  const h = scriptingHost();
  try {
    const wc = fakeTab(7, 'https://example.com/a', h.state);
    wc.focus = () => { throw new Error('view is gone'); };
    h.tabs.set(7, wc);
    h.click(7);
    const result = await h.run({target: {tabId: 7}, files: ['inject.js']});
    assert.deepEqual(result.map(r => [r.frameId, r.result]), [[0, 'isolated-result']]);
    const bare = fakeTab(9, 'https://example.com/c', h.state);
    delete bare.focus; delete bare.isFocused;
    h.tabs.set(9, bare);
    h.click(9);
    assert.equal((await h.run({target: {tabId: 9}, files: ['inject.js']})).length, 1);
  } finally { h.dispose(); fs.rmSync(h.dir, {recursive: true, force: true}); }
});

test('a popup click is a gesture of its own: the extension page says so, and main honours it only with a grant (a worker never says it)', async () => {
  const h = scriptingHost();
  try {
    await withClock(900000, async clock => {
      const wc = fakeTab(7, 'https://example.com/a', h.state);
      h.tabs.set(7, wc);
      h.click(7);
      clock.advance(60000); // the toolbar click is long gone; the person then clicks a button in the popup
      const run = details => { wc.calls.length = 0; return h.run({target: {tabId: 7}, files: ['inject.js'], ...details}).then(() => wc.calls.map(c => c.userGesture)); };
      assert.deepEqual(await run({}), [false], 'no gesture of any kind');
      assert.deepEqual(await run({gesture: true}), [true], 'the popup frame has transient activation');
      assert.deepEqual(await run({gesture: 'yes'}), [false], 'only the literal true counts');
      assert.deepEqual(await run({gesture: 1}), [false]);
      assert.equal(wc.focusCalls, 0, 'a gesture the popup frame claims never moves the focus (the popup is open)');
      // no grant (never clicked on another tab): the claim alone gets nothing
      const other = fakeTab(9, 'https://example.com/z', h.state);
      h.tabs.set(9, other);
      assert.deepEqual(await h.run({target: {tabId: 9}, files: ['inject.js'], gesture: true}), {unavailable: true});
      assert.equal(other.calls.length, 0);
    });
  } finally { h.dispose(); fs.rmSync(h.dir, {recursive: true, force: true}); }
});

function rendererWorld(options) {
  const calls = [];
  const packages = extApi.loadPackages({fresh: true}).filter(p => p.name === 'scripting');
  const w = extensionWorld({manifest_version: 3, name: 'x', version: '1', permissions: ['scripting', 'activeTab']}, {
    packages, native: {scripting: {executeScript: async () => [{frameId: 0, result: 'native'}], insertCSS: async () => {}}},
    answer: (name, args) => { calls.push([name, plain(args[0])]); return [{frameId: 0, result: 'T'}]; }, ...options});
  return {...w, calls};
}

test('extension side (Chromium: HasActiveExtensionInteraction): a frame with user activation sends gesture; no activation, or a service worker, sends nothing new', async () => {
  const popup = rendererWorld({worker: false, userGesture: true});
  await popup.chrome.scripting.executeScript({target: {tabId: 3}, files: ['a.js']});
  assert.equal(popup.calls[0][0], 'scripting.activeTab.executeScript');
  assert.deepEqual(popup.calls[0][1], {target: {tabId: 3}, world: 'ISOLATED', files: ['a.js'], gesture: true});
  popup.setGesture(false);
  await popup.chrome.scripting.executeScript({target: {tabId: 3}, files: ['a.js']});
  assert.deepEqual(popup.calls[1][1], {target: {tabId: 3}, world: 'ISOLATED', files: ['a.js']}, 'the activation ran out: the payload is exactly what it was before');
  const worker = rendererWorld({worker: true, userGesture: true});
  await worker.chrome.scripting.executeScript({target: {tabId: 3}, files: ['a.js']});
  assert.equal('gesture' in worker.calls[0][1], false, 'a worker has no frame; main\'s window after the click stands in');
});

test('an extension with a popup never has the focus moved: its popup is open and would close', async () => {
  const h = scriptingHost();
  try {
    h.runtime.api.browserAction = {getPopupUrl: (extensionId, tabId) => (extensionId === ID && tabId === 7 ? 'chrome-extension://x/popup.html' : '')};
    const wc = fakeTab(7, 'https://example.com/a', h.state), other = fakeTab(8, 'https://example.com/b', h.state);
    h.tabs.set(7, wc); h.tabs.set(8, other);
    h.click(7); h.click(8);
    await h.run({target: {tabId: 7}, files: ['inject.js']});
    assert.deepEqual(wc.calls.map(c => c.userGesture), [true], 'the gesture still reaches the script');
    assert.equal(wc.focusCalls, 0, 'but the focus stays where the popup put it');
    await h.run({target: {tabId: 8}, files: ['inject.js']});
    assert.equal(other.focusCalls, 1, 'a tab the extension has no popup for is focused as before');
  } finally { h.dispose(); fs.rmSync(h.dir, {recursive: true, force: true}); }
});
