'use strict';
// 13.8 (reported on 13.7): after a WhatsApp Web voice message the address-bar pill (red dot, mic, "Stop") stayed until the tab was
// reloaded. 13.7 knew a page had stopped its microphone only from a DevTools walk of the page's whole heap every 3 s with a 2 s limit:
// on a page with a large heap (a 760 MB heap took 3.9 s on an M5) every walk ran out of time, its answer was dropped, and the pill never
// cleared. Chromium's indicator (chrome/browser/media/webrtc/media_stream_capture_indicator.cc, WebContentsDeviceUsage) follows the
// live capture requests: it changes the moment a page's last track on a device stops. Here: desktop/capture-indicator.cjs (the count, per
// page) and desktop/browser-services/capture-tracker-preload.cjs (what the page's frames report).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {createCaptureIndicator, indicatorOf, existing, UNSEEN_MS, PENDING_MS, POLL_MS, MISSES, STOP_WAIT_MS} = require('../desktop/capture-indicator.cjs');
const {captureTracker} = require('../desktop/browser-services/capture-tracker-preload.cjs');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

// A page realm with stand-ins for the media classes, shaped like Blink's: the prototype methods the tracker wraps, getters for kind and
// readyState, no 'ended' event for the page's own stop(), MediaStream.clone cloning audio then video tracks without the JS clone().
const STANDINS = `
  class EventTarget {
    addEventListener(type, listener) { const all = this.__l || (this.__l = {}); (all[type] || (all[type] = [])).push(listener); }
    dispatchEvent(event) { for (const listener of ((this.__l || {})[event.type] || []).slice()) listener.call(this, event); return true; }
  }
  class Event { constructor(type, init = {}) { this.type = type; this.persisted = !!init.persisted; } }
  let ids = 0;
  const cloneTrack = track => { const copy = new MediaStreamTrack(track.__kind, track.__label, track.__settings); copy.__state = track.__state; return copy; };
  class MediaStreamTrack extends EventTarget {
    constructor(kind, label, settings = {}) { super(); this.__kind = kind; this.__label = label; this.__settings = settings; this.__state = 'live'; this.id = 't' + (++ids); }
    get kind() { return this.__kind; }
    get label() { return this.__label; }
    get readyState() { return this.__state; }
    getSettings() { return Object.assign({}, this.__settings); }
    stop() { this.__state = 'ended'; }
    clone() { return cloneTrack(this); }
  }
  class MediaStream {
    constructor(tracks = []) { this.__tracks = tracks.slice(); }
    getTracks() { return this.getAudioTracks().concat(this.getVideoTracks()); }
    getAudioTracks() { return this.__tracks.filter(t => t.__kind === 'audio'); }
    getVideoTracks() { return this.__tracks.filter(t => t.__kind === 'video'); }
    clone() { return new MediaStream(this.getAudioTracks().map(cloneTrack).concat(this.getVideoTracks().map(cloneTrack))); }
  }
  globalThis.fail = null;
  class MediaDevices {
    getUserMedia(constraints = {}) {
      if (globalThis.fail) return Promise.reject(new Error(globalThis.fail));
      const tracks = [];
      if (constraints.audio) tracks.push(new MediaStreamTrack('audio', 'Fake microphone', {deviceId: 'mic-1'}));
      if (constraints.video) tracks.push(new MediaStreamTrack('video', 'Fake camera', {deviceId: 'cam-1'}));
      return Promise.resolve(new MediaStream(tracks));
    }
    getDisplayMedia(constraints = {}) {
      const tracks = [new MediaStreamTrack('video', 'screen:1:0', {displaySurface: 'monitor', deviceId: 'screen:1:0'})];
      if (constraints.audio) tracks.push(new MediaStreamTrack('audio', 'System audio', {}));
      return Promise.resolve(new MediaStream(tracks));
    }
  }
  class Navigator {}
  Object.setPrototypeOf(globalThis, EventTarget.prototype);
  Object.assign(globalThis, {EventTarget, Event, MediaStreamTrack, MediaStream, MediaDevices, Navigator});
  globalThis.navigator = Object.assign(new Navigator(), {mediaDevices: new MediaDevices()});
  // A call's remote track, a canvas capture: tracks no capture call made.
  globalThis.remoteTrack = () => new MediaStreamTrack('audio', 'remote audio', {});
`;

function page() {
  const reports = [];
  let stopper = null;
  const ctx = vm.createContext({});
  vm.runInContext(STANDINS, ctx);
  vm.runInContext('(' + captureTracker.toString() + ')', ctx)(value => reports.push({kinds: [...value.kinds], pending: value.pending}), fn => { stopper = fn; });
  const run = code => vm.runInContext(code, ctx);
  return {ctx, run, reports, last: () => reports.at(-1), stop: () => stopper(), flush: () => new Promise(resolve => setImmediate(resolve))};
}

test('tracker: a page that gets the microphone and stops its tracks reports at once (the WhatsApp voice message)', async () => {
  const p = page();
  await p.run(`navigator.mediaDevices.getUserMedia({audio: true}).then(s => { globalThis.s = s; })`);
  assert.deepEqual(p.reports, [{kinds: [], pending: 1}, {kinds: ['microphone'], pending: 0}], 'in flight, then live');
  p.run(`s.getTracks().forEach(t => t.stop())`);
  assert.deepEqual(p.last(), {kinds: [], pending: 0}, 'the page\'s own stop() is reported, though it fires no ended event');
});

test('tracker: two streams, one stops: the kind stays until the last one stops', async () => {
  const p = page();
  await p.run(`Promise.all([navigator.mediaDevices.getUserMedia({audio: true}), navigator.mediaDevices.getUserMedia({audio: true})]).then(([a, b]) => { globalThis.a = a; globalThis.b = b; })`);
  assert.deepEqual(p.last(), {kinds: ['microphone'], pending: 0});
  const before = p.reports.length;
  p.run(`a.getTracks()[0].stop()`);
  assert.equal(p.reports.length, before, 'nothing changed: the second stream still holds the microphone');
  p.run(`b.getTracks()[0].stop()`);
  assert.deepEqual(p.last(), {kinds: [], pending: 0});
});

test('tracker: clones hold the device (MediaStreamTrack.clone and MediaStream.clone), as a source stays open while any track on it is live', async () => {
  const p = page();
  await p.run(`navigator.mediaDevices.getUserMedia({audio: true}).then(s => { globalThis.s = s; globalThis.c = s.getTracks()[0].clone(); globalThis.sc = s.clone(); })`);
  assert.deepEqual(p.last().kinds, ['microphone']);
  p.run(`s.getTracks()[0].stop()`); assert.deepEqual(p.last().kinds, ['microphone'], 'the track clone is live');
  p.run(`c.stop()`); assert.deepEqual(p.last().kinds, ['microphone'], 'the stream clone is live');
  p.run(`sc.getTracks()[0].stop()`); assert.deepEqual(p.last().kinds, []);
});

test('tracker: one call with camera and microphone counts for both until both devices stop (Chromium keeps the request until then)', async () => {
  const p = page();
  await p.run(`navigator.mediaDevices.getUserMedia({audio: true, video: true}).then(s => { globalThis.s = s; })`);
  assert.deepEqual(p.last().kinds, ['camera', 'microphone']);
  p.run(`s.getAudioTracks()[0].stop()`); assert.deepEqual(p.last().kinds, ['camera', 'microphone'], 'MediaStreamManager::StopDevice keeps the request while its camera is open; ~UIDelegate removes both');
  p.run(`s.getVideoTracks()[0].stop()`); assert.deepEqual(p.last().kinds, []);
});

test('tracker: a screen share (and its sound) is the screen; a failed call leaves nothing; remote and canvas tracks never count', async () => {
  const p = page();
  await p.run(`navigator.mediaDevices.getDisplayMedia({video: true, audio: true}).then(s => { globalThis.d = s; })`);
  assert.deepEqual(p.last().kinds, ['screen']);
  p.run(`d.getVideoTracks()[0].stop()`); assert.deepEqual(p.last().kinds, ['screen'], 'the shared sound is still live');
  p.run(`d.getAudioTracks()[0].stop()`); assert.deepEqual(p.last().kinds, []);
  p.run(`globalThis.fail = 'NotReadableError'`);
  await assert.rejects(p.run(`navigator.mediaDevices.getUserMedia({audio: true})`), /NotReadableError/, 'the page sees the same failure');
  assert.deepEqual(p.last(), {kinds: [], pending: 0});
  const before = p.reports.length;
  p.run(`const r = remoteTrack(); r.clone().stop(); r.stop();`);
  assert.equal(p.reports.length, before, 'a track no capture call made changes nothing');
});

test('tracker: the device going away (ended) and Acira\'s Stop end the capture; Stop tells the page with ended', async () => {
  const p = page();
  await p.run(`navigator.mediaDevices.getUserMedia({video: true}).then(s => { globalThis.s = s; })`);
  p.run(`s.getTracks()[0].__state = 'ended'; s.getTracks()[0].dispatchEvent(new Event('ended'))`);
  assert.deepEqual(p.last().kinds, [], 'a track that ended by itself');
  await p.run(`Promise.all([navigator.mediaDevices.getUserMedia({audio: true, video: true}), navigator.mediaDevices.getDisplayMedia({video: true})]).then(([a, b]) => { globalThis.a = a; globalThis.b = b; globalThis.endedEvents = 0; a.getTracks().concat(b.getTracks()).forEach(t => t.addEventListener('ended', () => endedEvents++)); })`);
  assert.deepEqual(p.last().kinds, ['camera', 'microphone', 'screen']);
  p.stop();
  assert.deepEqual(p.last().kinds, []);
  assert.deepEqual(JSON.parse(p.run(`JSON.stringify(a.getTracks().concat(b.getTracks()).map(t => t.readyState))`)), ['ended', 'ended', 'ended']);
  assert.equal(p.run(`endedEvents`), 3);
});

test('tracker: the document going away reports nothing live; the wrappers look like the built-in methods', async () => {
  const p = page();
  await p.run(`navigator.mediaDevices.getUserMedia({audio: true}).then(s => { globalThis.s = s; })`);
  p.run(`globalThis.dispatchEvent(new Event('pagehide'))`);
  assert.deepEqual(p.last(), {kinds: [], pending: 0});
  assert.deepEqual(JSON.parse(p.run(`JSON.stringify([MediaDevices.prototype.getUserMedia, MediaDevices.prototype.getDisplayMedia, MediaStreamTrack.prototype.stop, MediaStreamTrack.prototype.clone, MediaStream.prototype.clone].map(f => [f.name, f.length, 'prototype' in f]))`)),
    [['getUserMedia', 0, false], ['getDisplayMedia', 0, false], ['stop', 0, false], ['clone', 0, false], ['clone', 0, false]]);
});

// The indicator, with a clock and timers under the test's control.
function clock() {
  let t = 1000; const timers = [];
  return {
    now: () => t,
    setTimer: (fn, ms) => { const timer = {at: t + ms, fn, done: false}; timers.push(timer); return timer; },
    clearTimer: timer => { if (timer) timer.done = true; },
    async advance(ms) { const end = t + ms; for (;;) { const next = timers.filter(x => !x.done && x.at <= end).sort((a, b) => a.at - b.at)[0]; if (!next) break; t = next.at; next.done = true; next.fn(); await new Promise(r => setImmediate(r)); } t = end; await new Promise(r => setImmediate(r)); },
  };
}
function indicator({check = async () => [], frames = new Set(['1:1'])} = {}) {
  const c = clock(), shown = [], checks = [], stops = [];
  const ind = createCaptureIndicator({check: async options => { checks.push(options); return check(options); }, sendStop: () => stops.push(true), alive: key => frames.has(key), now: c.now, setTimer: c.setTimer, clearTimer: c.clearTimer});
  ind.watch(kinds => shown.push(kinds.join(',')));
  return {ind, c, shown, checks, stops, frames, last: () => shown.at(-1)};
}

test('indicator: the pill shows at the grant and clears the moment the page stops its microphone, with no heap walk (failed on 13.7)', async () => {
  const w = indicator({check: async () => { throw new Error('the outside check must not run'); }});
  w.ind.report('1:1', {kinds: [], pending: 1});
  w.ind.grant(['microphone']); assert.equal(w.last(), 'microphone', 'shown at the grant');
  w.ind.report('1:1', {kinds: ['microphone'], pending: 0}); assert.equal(w.last(), 'microphone');
  await w.c.advance(20000); assert.equal(w.last(), 'microphone', 'stays while the stream is live');
  w.ind.report('1:1', {kinds: [], pending: 0});
  assert.equal(w.last(), '', 'cleared at once');
  assert.equal(w.checks.length, 0);
});

test('indicator: two frames and two kinds are combined; a frame that navigates or goes away ends its own; the main frame\'s commit and a crash end all', async () => {
  const w = indicator({frames: new Set(['1:1', '2:7'])});
  w.ind.report('1:1', {kinds: [], pending: 1}); w.ind.grant(['camera', 'microphone']); w.ind.report('1:1', {kinds: ['camera', 'microphone'], pending: 0});
  w.ind.report('2:7', {kinds: [], pending: 1}); w.ind.grant(['screen']); w.ind.report('2:7', {kinds: ['screen'], pending: 0});
  assert.equal(w.last(), 'camera,microphone,screen');
  w.ind.frameGone('2:7'); assert.equal(w.last(), 'camera,microphone', 'the subframe navigated');
  w.ind.report('2:7', {kinds: [], pending: 1}); w.ind.grant(['screen']); w.ind.report('2:7', {kinds: ['screen'], pending: 0});
  w.frames.delete('2:7'); await w.c.advance(POLL_MS + 10); assert.equal(w.last(), 'camera,microphone', 'a frame that went without a word');
  w.ind.reset(); assert.equal(w.last(), '', 'the page committed another document (or crashed)');
  w.ind.report('1:1', {kinds: ['camera'], pending: 0}); assert.equal(w.last(), '', 'a late report of the old document shows nothing: the new one was granted nothing');
});

test('indicator: kinds a page reports without a grant are never shown', () => {
  const w = indicator();
  w.ind.report('1:1', {kinds: ['camera', 'microphone', 'screen'], pending: 0});
  assert.equal(w.last(), '');
});

test('indicator: a granted call that fails is settled by one outside check; a stream no tracker saw stays under that check until it ends', async () => {
  let live = [];
  const w = indicator({check: async () => live});
  w.ind.report('1:1', {kinds: [], pending: 1}); w.ind.grant(['microphone']);
  w.ind.report('1:1', {kinds: [], pending: 0}); // the call settled with nothing live
  assert.equal(w.last(), 'microphone', 'held until the check answers');
  await w.c.advance(1); assert.equal(w.checks.length, 1); assert.equal(w.last(), '', 'the check found nothing: cleared');
  // A grant for a stream made where no tracker runs (no call was seen in flight).
  live = ['camera'];
  w.ind.grant(['camera']); assert.equal(w.last(), 'camera');
  await w.c.advance(UNSEEN_MS + 1); assert.equal(w.checks.length, 2); assert.equal(w.last(), 'camera', 'the check sees it');
  await w.c.advance(POLL_MS + 1); assert.equal(w.checks.length, 3, 'checked again while only the check can see it');
  live = [];
  await w.c.advance(POLL_MS + 1); assert.equal(w.last(), '', 'gone when the check no longer sees it');
  const after = w.checks.length; await w.c.advance(60000); assert.equal(w.checks.length, after, 'no more checks once nothing is shown');
});

test('indicator: a check that cannot run (a heap walk past its time, another debugger) is retried, then the trackers are trusted (13.7: stuck forever)', async () => {
  const w = indicator({check: async () => null});
  w.ind.report('1:1', {kinds: [], pending: 1}); w.ind.grant(['microphone']); w.ind.report('1:1', {kinds: [], pending: 0});
  await w.c.advance(1);
  for (let i = 1; i < MISSES; i++) { assert.equal(w.last(), 'microphone'); await w.c.advance(POLL_MS + 1); }
  assert.equal(w.checks.length, MISSES); assert.equal(w.last(), '');
  assert.equal(w.checks[0].timeoutMs >= 15000, true, 'one check may take as long as a big page needs (13.7 gave up at 2 s)');
});

test('indicator: a call the tracker saw start waits for it to settle (a camera can take seconds to open), then the outside check decides', async () => {
  const w = indicator({check: async () => []});
  w.ind.report('1:1', {kinds: [], pending: 1}); w.ind.grant(['camera']);
  await w.c.advance(PENDING_MS - 10); assert.equal(w.checks.length, 0); assert.equal(w.last(), 'camera');
  await w.c.advance(20); assert.equal(w.checks.length, 1); assert.equal(w.last(), '');
});

test('indicator: Stop asks every frame to stop and clears when they report; with no tracker it ends the captures from outside', async () => {
  const w = indicator({check: async () => { throw new Error('not needed'); }});
  w.ind.report('1:1', {kinds: [], pending: 1}); w.ind.grant(['microphone']); w.ind.report('1:1', {kinds: ['microphone'], pending: 0});
  const done = w.ind.stop();
  assert.equal(w.stops.length, 1);
  w.ind.report('1:1', {kinds: [], pending: 0});
  await w.c.advance(100); assert.equal(await done, true); assert.equal(w.last(), '');
  // A page whose captures no tracker reported (13.7's Stop: the outside check ends every capture track).
  const bare = indicator({frames: new Set()});
  bare.ind.grant(['screen']); assert.equal(bare.last(), 'screen');
  const ended = bare.ind.stop(); await bare.c.advance(STOP_WAIT_MS + 100);
  assert.equal(await ended, true); assert.deepEqual(bare.checks.map(c => c.stop), [true]); assert.equal(bare.last(), '');
  // A frame that never answers and an outside stop that cannot run: Stop says so (Acira shows "Couldn't stop sharing").
  const stuck = indicator({check: async () => null});
  stuck.ind.report('1:1', {kinds: [], pending: 1}); stuck.ind.grant(['camera']); stuck.ind.report('1:1', {kinds: ['camera'], pending: 0});
  const failed = stuck.ind.stop(); await stuck.c.advance(STOP_WAIT_MS + 100);
  assert.equal(await failed, false); assert.equal(stuck.last(), 'camera', 'still shown: it is still live');
});

test('indicatorOf: one indicator per page, gone with the page', () => {
  const handlers = {};
  const wc = {destroyed: false, isDestroyed() { return this.destroyed; }, once(event, fn) { handlers[event] = fn; }};
  let made = 0;
  const a = indicatorOf(wc, () => { made++; return createCaptureIndicator({check: async () => []}); });
  assert.equal(indicatorOf(wc, () => { made++; }), a); assert.equal(made, 1); assert.equal(existing(wc), a);
  handlers.destroyed(); assert.equal(existing(wc), null);
});

test('main: the pill follows the indicator; navigation ends captures at commit, not at its start; Stop goes through the trackers', () => {
  const main = read('desktop/main.cjs');
  assert.doesNotMatch(main, /did-start-navigation',details=>\{if\(details\.isMainFrame&&!details\.isSameDocument&&entry\.capture\?\.length\)setCapture/, 'a navigation that never commits (a download link) no longer clears a running call\'s pill');
  assert.doesNotMatch(main, /pollCapture|captureTimer|captureQuiet/, 'no heap walk every 3 s while a page captures');
  assert.match(main, /captureOf\(wc\)\?\.watch\(kinds=>setCapture\(tab\.id,kinds\)\)/);
  assert.match(main, /wc\.on\('did-navigate',\(\)=>indicator\.reset\(\)\)/);
  assert.match(main, /wc\.on\('render-process-gone',\(\)=>indicator\.reset\(\)\)/, 'a crashed page clears its pill (13.7 kept it)');
  assert.match(main, /if\(!isMainFrame\)indicator\.frameGone\(processId\+':'\+routingId\)/);
  assert.match(main, /onCapture:\(wc,names\)=>\{captureOf\(wc\)\?\.grant\(captureState\.kindsFromGrant\(names\)\);\}/);
  assert.match(main, /ipcMain\.on\('acira:capture-state',\(event,report\)=>\{[^}]*captureIndicator\.existing\(wc\)\?\.report\(event\.processId\+':'\+event\.frameId,report\)/);
  assert.match(main, /frame\.send\('acira:capture-stop'\)/);
  assert.match(main, /async function stopCapture\(id\)\{const entry=pages\.get\(id\);if\(!entry\)return;const done=await captureOf\(entry\.view\.webContents\)\?\.stop\(\);if\(done===false\)dispatch\(\{type:'toast',text:tm\("main\.couldnTStopSharingReload"\)/);
});

test('every website frame gets the tracker, and the release ships it', () => {
  assert.match(read('desktop/browser-services/permission-engine.cjs'), /registerPreloadScript\(\{type:'frame',filePath:path\.join\(__dirname,'capture-tracker-preload\.cjs'\)\}\)/);
  assert.match(read('scripts/desktop-bundle.mjs'), /'desktop\/browser-services\/capture-tracker-preload\.cjs',/);
  const preload = read('desktop/browser-services/capture-tracker-preload.cjs');
  assert.match(preload, /contextBridge\.executeInMainWorld\(\{func: captureTracker, args: \[report, onStop\]\}\)/);
  assert.match(preload, /ipcRenderer\.send\('acira:capture-state'/);
  assert.match(preload, /ipcRenderer\.on\('acira:capture-stop'/);
});

test('indicator: a share answered in the macOS system picker (no Acira handler, no grant) shows once the page has its screen stream', () => {
  const w = indicator();
  w.ind.report('1:1', {kinds: ['screen'], pending: 0}); assert.equal(w.last(), '', 'never without the browser\'s word');
  w.ind.allow(['screen']); assert.equal(w.last(), 'screen', 'the page reported its stream (before or after the browser let it ask)');
  w.ind.report('1:1', {kinds: [], pending: 0}); assert.equal(w.last(), '');
  const fresh = indicator();
  fresh.ind.allow(['screen']); assert.equal(fresh.last(), '', 'allowing the question shows nothing: the person may still cancel the picker');
});

test('permission engine: a website\'s share request that goes on to a picker tells the indicator; an extension page\'s does not', async () => {
  const {createPermissions} = require('../desktop/browser-services/permission-engine.cjs');
  let request; const session = {setPermissionCheckHandler() {}, setPermissionRequestHandler: f => { request = f; }, setDevicePermissionHandler() {}, setDisplayMediaRequestHandler() {}};
  const site = {url: 'https://meet.example/call', isDestroyed: () => false}, wc = {id: 5, mainFrame: site, isDestroyed: () => false, getURL: () => site.url};
  const allowed = [], granted = [];
  const permissions = createPermissions({database: {permission() {}, setPermission() {}, permissions: () => []}, dialog: {}, getWindow: () => null, ownsContents: c => c === wc, onCapture: (c, names) => granted.push(names), onDisplayAllowed: c => allowed.push(c), getFrameOwner: () => wc});
  permissions.attach(session, 'p');
  assert.equal(await new Promise(resolve => request(wc, 'media', resolve, {mediaTypes: [], requestingUrl: site.url})), true);
  assert.deepEqual(allowed, [wc]); assert.deepEqual(granted, [[]], 'no camera or microphone in a share request');
  const ext = {id: 6, mainFrame: {url: 'chrome-extension://abc/offscreen.html', isDestroyed: () => false}, isDestroyed: () => false, getURL: () => 'chrome-extension://abc/offscreen.html'};
  await new Promise(resolve => request(ext, 'media', resolve, {mediaTypes: [], requestingUrl: 'chrome-extension://abc/offscreen.html'}));
  assert.deepEqual(allowed, [wc], 'an extension\'s capture is listed by its own broker');
  assert.match(read('desktop/main.cjs'), /onDisplayAllowed:wc=>\{captureOf\(wc\)\?\.allow\(\['screen'\]\);\}/);
});

test('indicator: a check still running when the page commits a new document does not leave the new document\'s grant unplanned', async () => {
  let release; const w = indicator({check: () => new Promise(resolve => { release = resolve; })});
  w.ind.grant(['camera']); await w.c.advance(UNSEEN_MS + 1); assert.equal(w.checks.length, 1, 'a check is running');
  w.ind.reset(); assert.equal(w.last(), '');
  w.ind.grant(['microphone']); assert.equal(w.last(), 'microphone');
  release(['camera']); await w.c.advance(1);
  assert.equal(w.last(), 'microphone', 'the old document\'s answer changes nothing');
  await w.c.advance(UNSEEN_MS + 1); assert.equal(w.checks.length, 2, 'the new grant is checked');
  release([]); await w.c.advance(1); assert.equal(w.last(), '');
});
