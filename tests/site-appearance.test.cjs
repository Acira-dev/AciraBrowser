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
    assert.deepEqual(sent(f.wc, 'Target.setAutoAttach')[0][1], {autoAttach: true, waitForDebuggerOnStart: false, flatten: true});
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

test('a cross-site frame gets the same commands, nested frames are followed, workers are let go, and a change reaches the frames', async () => {
  const f = await open({mode: 'always-dark', nativeDark: true});
  f.wc.debugger.emit('message', {}, 'Target.attachedToTarget', {sessionId: 'frame-1', targetInfo: {type: 'iframe'}}, '');
  f.wc.debugger.emit('message', {}, 'Target.attachedToTarget', {sessionId: 'worker-1', targetInfo: {type: 'service_worker'}}, '');
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(lastAuto(f.wc, 'frame-1').enabled, true); assert.equal(lastScheme(f.wc, 'frame-1'), 'dark');
  assert.equal(sent(f.wc, 'Target.setAutoAttach').some(entry => entry[2] === 'frame-1'), true, 'frames inside that frame');
  assert.deepEqual(sent(f.wc, 'Target.detachFromTarget')[0][1], {sessionId: 'worker-1'});
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
