'use strict';
// Website appearance (desktop/site-appearance.cjs): System · Light · Dark · Always dark, told to each website tab through the page's shared debugger session.
const test = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const {createSiteAppearance, MODES} = require('../desktop/site-appearance.cjs');
const {acquire} = require('../desktop/page-debugger.cjs');
const {createContextCommands} = require('../desktop/browser-services/context-commands.cjs');

function fakePage(url = 'https://www.example.com/', {attached = false, silent = false} = {}) {
  const log = [], debug = new EventEmitter(), wc = new EventEmitter();
  debug.attached = attached;
  debug.isAttached = () => debug.attached;
  debug.attach = () => { if (debug.attached) throw new Error('Debugger is already attached'); debug.attached = true; log.push('attach'); };
  debug.detach = () => { debug.attached = false; log.push('detach'); debug.emit('detach', {}, 'client'); };
  debug.sendCommand = (method, params, sessionId) => { log.push([method, params, sessionId]); return silent && wc.silent ? new Promise(() => {}) : Promise.resolve({}); };
  Object.assign(wc, {debugger: debug, url, isDestroyed: () => false, getURL: () => wc.url, log, silent: false});
  return wc;
}
function database() {
  const rows = new Map();
  return {rows, policy: (profile, site) => rows.get(profile + '|' + site) || null, policies: profile => [...rows].filter(([key]) => key.startsWith(profile + '|')).map(([key, value]) => ({site: key.slice(profile.length + 1), ...value})), setPolicy: (profile, site, value) => rows.set(profile + '|' + site, value), deletePolicy: (profile, site) => rows.delete(profile + '|' + site)};
}
function make({mode = 'system', nativeDark = false, tor = false, db = database(), ...rest} = {}) {
  const box = {mode, nativeDark, tor}, appearance = createSiteAppearance({database: db, mode: () => box.mode, nativeDark: () => box.nativeDark, isTor: entry => box.tor && entry.privacy === 'tor', profileOf: entry => entry.privacy === 'private' ? 'private-' + entry.profileId : entry.profileId, retryMs: 15, ...rest});
  return {box, appearance, db};
}
const tab = (extra = {}) => ({id: 't1', browserProfileId: 'p1', ...extra});
const sent = (wc, method) => wc.log.filter(entry => Array.isArray(entry) && entry[0] === method);
const lastScheme = (wc, sessionId) => sent(wc, 'Emulation.setEmulatedMedia').filter(entry => entry[2] === sessionId).at(-1)?.[1].features[0]?.value;
const lastAuto = (wc, sessionId) => sent(wc, 'Emulation.setAutoDarkModeOverride').filter(entry => entry[2] === sessionId).at(-1)?.[1];
async function settle(appearance, wc) { await appearance.whenIdle(wc); await new Promise(resolve => setTimeout(resolve, 10)); await appearance.whenIdle(wc); }
async function open(options, url, tabExtra) {
  const f = make(options), wc = fakePage(url);
  f.appearance.attach(wc, tab(tabExtra)); await settle(f.appearance, wc);
  return {...f, wc, settle: () => settle(f.appearance, wc)};
}

test('System touches nothing: no attach, no command, whatever Acira looks like', async () => {
  for (const nativeDark of [false, true]) {
    const f = await open({mode: 'system', nativeDark});
    assert.deepEqual(f.wc.log, [], `nativeDark ${nativeDark}`); assert.equal(f.wc.debugger.attached, false);
  }
});

test('Light and Dark tell the tab its scheme, and leave a tab alone that follows Acira into the same scheme anyway', async () => {
  let f = await open({mode: 'dark', nativeDark: false});
  assert.equal(lastScheme(f.wc), 'dark'); assert.equal(lastAuto(f.wc).enabled, false, 'Dark is not Auto Dark Mode'); assert.equal(f.wc.debugger.attached, true);
  f = await open({mode: 'light', nativeDark: true});
  assert.equal(lastScheme(f.wc), 'light'); assert.equal(lastAuto(f.wc).enabled, false);
  f = await open({mode: 'dark', nativeDark: true});
  assert.deepEqual(f.wc.log, [], 'dark Acira + Dark: the page already follows, nothing is attached');
  f = await open({mode: 'light', nativeDark: false});
  assert.deepEqual(f.wc.log, [], 'light Acira + Light: nothing is attached');
});

test('Always dark = dark scheme + Auto Dark Mode, even when Acira is dark; Tor and non-websites get nothing', async () => {
  for (const nativeDark of [false, true]) {
    const f = await open({mode: 'always-dark', nativeDark});
    assert.equal(lastScheme(f.wc), 'dark'); assert.equal(lastAuto(f.wc).enabled, true, `nativeDark ${nativeDark}`);
    assert.deepEqual(sent(f.wc, 'Target.setAutoAttach')[0][1], {autoAttach: true, waitForDebuggerOnStart: false, flatten: true, filter: [{type: 'iframe'}, {exclude: true}]}, 'frames only: a worker is never attached');
  }
  const tor = await open({mode: 'always-dark', tor: true}, 'https://www.example.com/', {privacy: 'tor'});
  assert.deepEqual(tor.wc.log, [], 'Tor is never touched'); assert.equal(tor.appearance.status(tor.wc).supported, false);
  const local = await open({mode: 'always-dark'}, 'acira://settings');
  assert.deepEqual(local.wc.log, [], 'an Acira page is not a website'); assert.equal(local.appearance.status(local.wc).supported, false);
});

test('changing the setting changes the tab in place; going back to System takes the overrides back and lets the session go', async () => {
  const f = await open({mode: 'dark'});
  f.box.mode = 'always-dark'; f.appearance.refreshAll(); await f.settle();
  assert.equal(lastAuto(f.wc).enabled, true); assert.equal(f.wc.log.filter(entry => entry === 'attach').length, 1, 'same session, no gap');
  assert.equal(f.wc.log.includes('detach'), false);
  f.box.nativeDark = true; f.box.mode = 'light'; f.appearance.refreshAll(); await f.settle();
  assert.equal(lastScheme(f.wc), 'light'); assert.equal(lastAuto(f.wc).enabled, false);
  f.box.mode = 'system'; f.appearance.refreshAll(); await f.settle();
  const cleared = f.wc.log.filter(entry => Array.isArray(entry) && ['Emulation.setAutoDarkModeOverride', 'Emulation.setEmulatedMedia'].includes(entry[0])).slice(-2);
  assert.deepEqual(cleared, [['Emulation.setAutoDarkModeOverride', {}, undefined], ['Emulation.setEmulatedMedia', {features: []}, undefined]], 'both overrides are cleared first');
  assert.equal(f.wc.log.at(-1), 'detach'); assert.equal(f.wc.debugger.attached, false);
  assert.equal(f.appearance.stateOf(f.wc).session, false);
});

test('another feature holding the page keeps the session after System, but the overrides are gone', async () => {
  const f = await open({mode: 'always-dark'});
  const zoom = acquire(f.wc, 'zoom-glide'); assert.ok(zoom, 'the glide shares the session instead of giving up');
  f.box.mode = 'system'; f.appearance.refreshAll(); await f.settle();
  assert.equal(lastAuto(f.wc).enabled, undefined, 'Auto Dark Mode cleared (the command has no enabled flag)');
  assert.deepEqual(f.wc.log.at(-1)[0], 'Target.setAutoAttach'); assert.equal(f.wc.debugger.attached, true);
  zoom.release(); assert.equal(f.wc.debugger.attached, false);
});

test('a site is left out by its registrable domain, only in Always dark; the choice is saved per profile and Include undoes it', async () => {
  const db = database(), f = await open({mode: 'always-dark', db}, 'https://news.example.co.uk/a');
  assert.deepEqual(f.appearance.status(f.wc), {supported: true, enabled: true, site: 'example.co.uk', excluded: false});
  f.appearance.setExcluded(f.wc, true); await f.settle();
  assert.deepEqual(db.policy('p1', 'dark:example.co.uk'), {dark: 'exclude'});
  assert.equal(f.appearance.status(f.wc).excluded, true);
  assert.equal(f.appearance.stateOf(f.wc).session, false, 'a left-out site is shown as System shows it');
  f.appearance.setExcluded(f.wc, false); await f.settle();
  assert.equal(db.policy('p1', 'dark:example.co.uk'), null); assert.equal(f.appearance.stateOf(f.wc).session, true);
  for (const mode of ['system', 'light', 'dark']) { f.box.mode = mode; assert.equal(f.appearance.status(f.wc).enabled, false, `${mode}: no menu row`); }
});

test('a left-out site stays left out when Dark or Light is chosen later, and comes back in Always dark', async () => {
  const f = await open({mode: 'always-dark'});
  f.appearance.setExcluded(f.wc, true); await f.settle();
  f.box.mode = 'dark'; f.appearance.refreshAll(); await f.settle();
  assert.equal(lastScheme(f.wc), 'dark', 'Dark applies to every site, the exclusion belongs to Always dark');
  f.box.mode = 'always-dark'; f.appearance.refreshAll(); await f.settle();
  assert.equal(f.appearance.stateOf(f.wc).session, false, 'left out again');
});

test('a private tab keeps its choices in memory and writes nothing', async () => {
  const db = database(), f = await open({mode: 'always-dark', db}, 'https://www.example.com/', {privacy: 'private'});
  f.appearance.setExcluded(f.wc, true); await f.settle();
  assert.equal(db.rows.size, 0, 'nothing saved from a private session'); assert.equal(f.appearance.status(f.wc).excluded, true);
  assert.equal(f.appearance.stateOf(f.wc).session, false);
});

test('a cross-site frame gets the same commands, nested frames are followed, workers are left completely alone, and a change reaches the frames', async () => {
  const f = await open({mode: 'always-dark', nativeDark: true});
  f.wc.debugger.emit('message', {}, 'Target.attachedToTarget', {sessionId: 'frame-1', targetInfo: {type: 'iframe'}}, '');
  f.wc.debugger.emit('message', {}, 'Target.attachedToTarget', {sessionId: 'worker-1', targetInfo: {type: 'service_worker'}}, '');
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(lastAuto(f.wc, 'frame-1').enabled, true); assert.equal(lastScheme(f.wc, 'frame-1'), 'dark');
  assert.equal(sent(f.wc, 'Target.setAutoAttach').some(entry => entry[2] === 'frame-1'), true, 'frames inside that frame');
  assert.deepEqual(f.wc.log.filter(entry => Array.isArray(entry) && (entry[2] === 'worker-1' || entry[1]?.sessionId === 'worker-1')), [], 'no command at all for a worker, and no detach');
  f.box.mode = 'light'; f.appearance.refreshAll(); await f.settle();
  assert.equal(lastScheme(f.wc, 'frame-1'), 'light'); assert.equal(lastAuto(f.wc, 'frame-1').enabled, false);
});

test('a debugger somebody else attached (Tor, a hidden page) is not touched; the tab is looked at again shortly and gets its appearance when the page is free', async () => {
  const f = make({mode: 'always-dark'}), wc = fakePage('https://www.example.com/', {attached: true});
  f.appearance.attach(wc, tab()); await settle(f.appearance, wc);
  assert.deepEqual(wc.log, []);
  wc.debugger.attached = false;
  await new Promise(resolve => setTimeout(resolve, 60)); await settle(f.appearance, wc);
  assert.equal(lastAuto(wc).enabled, true, 'applied once the page was free');
});

test('a page that does not answer (a frozen tab) does not wedge the module: the call ends, the session is let go, and the next call works', async () => {
  const f = make({mode: 'always-dark', commandMs: 20, retries: 0}), wc = fakePage('https://www.example.com/', {silent: true});
  wc.silent = true;
  f.appearance.attach(wc, tab()); await new Promise(resolve => setTimeout(resolve, 150)); await f.appearance.whenIdle(wc);
  assert.equal(f.appearance.stateOf(wc).session, false); assert.equal(wc.debugger.attached, false);
  wc.silent = false; f.appearance.refreshAll(); await settle(f.appearance, wc);
  assert.equal(lastAuto(wc).enabled, true); assert.equal(f.appearance.stateOf(wc).session, true);
});

test('a session that ends under the module (the page crashed, the debugger was force-detached) is taken up again', async () => {
  const f = await open({mode: 'always-dark'});
  f.wc.debugger.attached = false; f.wc.debugger.emit('detach', {}, 'target crashed');
  await new Promise(resolve => setTimeout(resolve, 80)); await f.settle();
  assert.equal(f.wc.log.filter(entry => entry === 'attach').length, 2); assert.equal(f.appearance.stateOf(f.wc).session, true);
});

test('Sec-CH-Prefers-Color-Scheme follows the tab: a told tab answers its scheme, a tab that follows Acira answers undefined', async () => {
  const f = await open({mode: 'dark'});
  assert.equal(f.appearance.darkFor(f.wc, 'https://www.example.com/'), true);
  f.box.mode = 'light'; assert.equal(f.appearance.darkFor(f.wc), false);
  f.box.mode = 'system'; assert.equal(f.appearance.darkFor(f.wc), undefined);
  f.box.mode = 'always-dark'; f.appearance.setExcluded(f.wc, true); assert.equal(f.appearance.darkFor(f.wc), undefined, 'a left-out site follows Acira');
  assert.equal(f.appearance.darkFor({}, 'https://x.example/'), undefined, 'a page that is not tracked');
});

test('the setting is one of the four values; anything else counts as System', async () => {
  assert.deepEqual(MODES, ['system', 'light', 'dark', 'always-dark']);
  const f = await open({mode: 'banana'});
  assert.deepEqual(f.wc.log, []);
});

test('the page menu offers Exclude / Include only in Always dark, on a website, and the row works', async () => {
  const f = await open({mode: 'always-dark'}, 'https://www.example.com/');
  const owner = {tabId: 't1', profileId: 'p1', searchEngine: 'duckduckgo', private: false};
  const stand = {mainFrame: {}, navigationHistory: {canGoBack: () => true, canGoForward: () => true}, downloadURL() {}, copyImageAt() {}, inspectElement() {}, session: {isPersistent: () => true}};
  Object.assign(f.wc, stand);
  const service = createContextCommands({getContext: () => owner, clipboard: {writeText() {}}, openTab() {}, openWindow() {}, command() {}, peek() {}, dark: f.appearance});
  const build = wc => service.build(wc, {frame: {url: wc.url, isDestroyed: () => false, executeJavaScript: async () => {}}, x: 1, y: 1});
  const row = () => build(f.wc).find(item => item.id === 'dark-site');
  assert.match(row().label, /Exclude this site from dark mode/);
  const first = row(); assert.equal(typeof first.click, 'function'); first.click();
  await f.settle();
  assert.equal(f.appearance.status(f.wc).excluded, true);
  assert.match(row().label, /Include this site again/);
  for (const mode of ['system', 'light', 'dark']) { f.box.mode = mode; assert.equal(row(), undefined, `${mode}: no row`); }
});

test('the settings bridge accepts the four values and nothing else, and a new profile starts on System', () => {
  const {validateAction} = require('../desktop/validation.cjs'), {createInitialState} = require('../desktop/runtime.cjs'), state = createInitialState();
  assert.equal(state.settings.websiteAppearance, 'system', 'nothing changes for anyone who does not touch it');
  for (const value of MODES) assert.doesNotThrow(() => validateAction({type: 'settings.update', patch: {websiteAppearance: value}}, state), value);
  for (const value of ['', 'Dark', 'always_dark', true, null, 3]) assert.throws(() => validateAction({type: 'settings.update', patch: {websiteAppearance: value}}, state), /Website appearance/, String(value));
});

test('main wires it to every website page: tabs, link previews, the hint, and Acira\'s own appearance changing', () => {
  const fs = require('node:fs'), path = require('node:path'), main = fs.readFileSync(path.join(__dirname, '../desktop/main.cjs'), 'utf8'), peek = fs.readFileSync(path.join(__dirname, '../desktop/rewind/peek.cjs'), 'utf8');
  assert.match(main, /if\(tab\.contentKind==='web'\)siteAppearance\.attach\(wc,tab\)/, 'tab pages');
  assert.match(main, /pageCreated:\(wc,source\)=>siteAppearance\.attach\(wc,source\)/, 'a link preview is told the same colours as a tab');
  assert.match(peek, /pageCreated\(wc,source\)/);
  assert.match(main, /nativeTheme\.on\('updated',\(\)=>siteAppearance\.refreshAll\(\)\)/, 'Dark while Acira turns dark needs no session any more, and the reverse');
  assert.match(main, /Object\.hasOwn\(action\.patch,'websiteAppearance'\)\)setTimeout\(\(\)=>siteAppearance\.refreshAll\(\),0\)/, 'the setting is applied to open tabs at once');
});

test('a frame that goes away is forgotten, and a change that failed halfway is made again', async () => {
  const f = await open({mode: 'always-dark', nativeDark: true});
  f.wc.debugger.emit('message', {}, 'Target.attachedToTarget', {sessionId: 'frame-9', targetInfo: {type: 'iframe'}}, '');
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(f.appearance.stateOf(f.wc).frames, 1);
  f.wc.debugger.emit('message', {}, 'Target.detachedFromTarget', {sessionId: 'frame-9'}, '');
  assert.equal(f.appearance.stateOf(f.wc).frames, 0);
  // the page stops answering during a change: the setting is not recorded as applied, so the next call sends it again
  const quick = make({mode: 'always-dark', nativeDark: true, commandMs: 20, retries: 0}), wc = fakePage('https://www.example.com/');
  quick.appearance.attach(wc, tab()); await settle(quick.appearance, wc);
  const answer = wc.debugger.sendCommand; let silent = true;
  wc.debugger.sendCommand = (...args) => silent ? new Promise(() => {}) : answer(...args);
  quick.box.mode = 'light'; quick.appearance.refreshAll(); await new Promise(resolve => setTimeout(resolve, 80)); await quick.appearance.whenIdle(wc);
  assert.equal(quick.appearance.stateOf(wc).want.scheme, 'dark', 'still recorded as dark: the light command never got through');
  silent = false; quick.appearance.refreshAll(); await settle(quick.appearance, wc);
  assert.equal(quick.appearance.stateOf(wc).want.scheme, 'light'); assert.equal(lastScheme(wc), 'light');
});

// 13.4: "Always dark" crashed the whole browser. Asking Chromium to attach the page's debugger session to every Web Worker (Target.setAutoAttach) and then sending
// Target.detachFromTarget for each one made Electron's main process die with a SIGSEGV a few seconds after opening sites that start workers (tests/site-appearance-workers.test.cjs
// reproduces it in a real Electron). Workers are now kept out by the auto-attach filter and are never touched.
// Every session the module opens runs the same auto-attach: Always dark, and Light / Dark whenever they differ from Acira's own appearance (a tab that follows Acira anyway holds none).
const SESSIONS = [['always-dark', false], ['always-dark', true], ['light', true], ['dark', false]];
for (const [mode, nativeDark] of SESSIONS) test(`13.4: ${mode} on ${nativeDark ? 'a dark' : 'a light'} Acira: Target.detachFromTarget is never sent, whatever attaches (workers, shared and service workers, worklets, popups), and every auto-attach asks for frames only`, async () => {
  const f = await open({mode, nativeDark});
  assert.equal(f.appearance.stateOf(f.wc).session, true, 'this configuration holds a session');
  const types = ['worker', 'service_worker', 'shared_worker', 'worklet', 'page', 'other', 'auction_worklet', 'webview', 'browser', 'tab'];
  types.forEach((type, index) => f.wc.debugger.emit('message', {}, 'Target.attachedToTarget', {sessionId: 'x-' + index, targetInfo: {type}}, ''));
  f.wc.debugger.emit('message', {}, 'Target.attachedToTarget', {sessionId: 'frame-1', targetInfo: {type: 'iframe'}}, '');
  f.wc.debugger.emit('message', {}, 'Target.attachedToTarget', {sessionId: 'nested-under-frame', targetInfo: {type: 'worker'}}, 'frame-1');
  f.wc.debugger.emit('message', {}, 'Target.attachedToTarget', {sessionId: 'frame-2', targetInfo: {type: 'iframe'}}, 'frame-1');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(sent(f.wc, 'Target.detachFromTarget'), [], 'a detach from an auto-attached target killed the browser process');
  assert.deepEqual(f.wc.log.filter(entry => Array.isArray(entry) && /^x-|nested-under-frame/.test(String(entry[2]) + JSON.stringify(entry[1] || ''))), [], 'nothing at all is sent to a target that is not a frame');
  const attaches = sent(f.wc, 'Target.setAutoAttach');
  assert.deepEqual(attaches.map(entry => entry[2] || 'page').sort(), ['frame-1', 'frame-2', 'page'], 'the page, the frame, and the frame inside that frame');
  for (const entry of attaches) assert.deepEqual(entry[1].filter, [{type: 'iframe'}, {exclude: true}], `session ${entry[2] || 'page'}: frames only`);
  assert.equal(f.appearance.stateOf(f.wc).frames, 2, 'only the two frames are followed');
  for (const id of ['frame-1', 'frame-2']) assert.equal(lastScheme(f.wc, id), mode === 'light' ? 'light' : 'dark', `${id} is told what the page is told`);
});

test('13.4: every command ends: a page that never answers, a page destroyed in the middle of a command, a debugger that answers late', async () => {
  const f = make({mode: 'always-dark', commandMs: 25, retries: 0}), wc = fakePage('https://www.example.com/', {silent: true});
  wc.silent = true; // nothing is ever answered
  f.appearance.attach(wc, tab()); await new Promise(resolve => setTimeout(resolve, 120)); await f.appearance.whenIdle(wc);
  assert.equal(f.appearance.stateOf(wc).session, false, 'the call ended and the session was let go');
  assert.equal(wc.debugger.attached, false);
  // a frame message arrives, its nested auto-attach never answers: nothing waits on it
  const live = make({mode: 'always-dark', commandMs: 25}), page = fakePage('https://www.example.com/');
  live.appearance.attach(page, tab()); await settle(live.appearance, page);
  const answer = page.debugger.sendCommand; page.debugger.sendCommand = (method, params, sessionId) => sessionId === 'frame-1' ? new Promise(() => {}) : answer(method, params, sessionId);
  page.debugger.emit('message', {}, 'Target.attachedToTarget', {sessionId: 'frame-1', targetInfo: {type: 'iframe'}}, '');
  await new Promise(resolve => setTimeout(resolve, 80)); await live.appearance.whenIdle(page);
  assert.equal(live.appearance.stateOf(page).session, true, 'the page keeps its session, the silent frame costs nothing');
  // destroyed while a command is on its way
  const dying = make({mode: 'always-dark', commandMs: 200}), gone = fakePage('https://www.example.com/');
  let destroyed = false; gone.isDestroyed = () => destroyed;
  gone.debugger.sendCommand = () => new Promise((_resolve, reject) => setTimeout(() => reject(new Error('Object has been destroyed')), 10));
  dying.appearance.attach(gone, tab()); await new Promise(resolve => setTimeout(resolve, 5));
  destroyed = true; gone.debugger.attached = false; gone.emit('destroyed');
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(dying.appearance.stateOf(gone), null, 'a destroyed page is forgotten, nothing is retried on it');
  assert.equal(gone.log.filter(entry => entry === 'attach').length, 1, 'no attach after it was destroyed');
});

test('13.4: nothing in the feature can throw into the app: a debugger that throws, a page that cannot be read, a handler fed rubbish', async () => {
  const f = make({mode: 'always-dark'}), wc = fakePage('https://www.example.com/');
  wc.debugger.attach = () => { throw new Error('Debugger is already attached to this WebContents.'); };
  assert.doesNotThrow(() => f.appearance.attach(wc, tab())); await settle(f.appearance, wc);
  assert.equal(f.appearance.stateOf(wc).session, false, 'the tab stays as it is');
  const sync = fakePage('https://www.example.com/');
  sync.debugger.sendCommand = () => { throw new TypeError('Cannot read properties of null'); };
  assert.doesNotThrow(() => f.appearance.attach(sync, tab({id: 't2'}))); await new Promise(resolve => setTimeout(resolve, 60)); await f.appearance.whenIdle(sync);
  assert.equal(f.appearance.stateOf(sync).session, false); assert.equal(sync.debugger.attached, false, 'the session is let go again');
  const broken = fakePage('https://www.example.com/'); broken.getURL = () => { throw new Error('Object has been destroyed'); };
  assert.doesNotThrow(() => f.appearance.attach(broken, tab({id: 't3'}))); assert.doesNotThrow(() => f.appearance.refreshAll()); await new Promise(resolve => setTimeout(resolve, 60));
  assert.doesNotThrow(() => f.appearance.attach(null, tab({id: 't4'})), 'not even a missing page throws');
  const live = await open({mode: 'always-dark'});
  for (const rubbish of [[undefined, undefined], ['Target.attachedToTarget', null], ['Target.attachedToTarget', {sessionId: 'a', targetInfo: null}], ['Target.detachedFromTarget', {}], [42, 'x']])
    assert.doesNotThrow(() => live.wc.debugger.emit('message', {}, ...rubbish, ''));
  live.wc.debugger.sendCommand = () => { throw new Error('Debugger is not attached to the target page.'); };
  assert.doesNotThrow(() => live.wc.debugger.emit('message', {}, 'Target.attachedToTarget', {sessionId: 'frame-3', targetInfo: {type: 'iframe'}}, ''));
  await new Promise(resolve => setTimeout(resolve, 20));
});

test('13.4: a page whose renderer crashed is not attached again until it navigates (no attach loop on a dead page)', async () => {
  const f = await open({mode: 'always-dark'});
  f.wc.crashed = true; f.wc.isCrashed = () => true;
  f.wc.debugger.attached = false; f.wc.emit('render-process-gone', {}, {reason: 'crashed', exitCode: 11}); f.wc.debugger.emit('detach', {}, 'target crashed');
  await new Promise(resolve => setTimeout(resolve, 80)); await f.settle();
  assert.equal(f.wc.log.filter(entry => entry === 'attach').length, 1, 'no second attach on a crashed page');
  assert.equal(f.appearance.stateOf(f.wc).session, false);
  f.wc.isCrashed = () => false; f.wc.emit('did-navigate', {}, 'https://www.example.com/');
  await f.settle();
  assert.equal(f.wc.log.filter(entry => entry === 'attach').length, 2, 'the page is told again once it loads');
  assert.equal(f.appearance.stateOf(f.wc).session, true);
  // a renderer that left cleanly (a process swap) does not count as a crash
  const clean = await open({mode: 'always-dark'});
  clean.wc.emit('render-process-gone', {}, {reason: 'clean-exit', exitCode: 0}); clean.wc.emit('dom-ready'); await clean.settle();
  assert.equal(clean.appearance.stateOf(clean.wc).session, true);
});
