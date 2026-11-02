'use strict';
// ext-api/capture-renderer.cjs: chrome.tabCapture / chrome.desktopCapture on Chromium's schema, and the getUserMedia shim for their stream
// ids, also inside offscreen documents (Chromium's own chrome.offscreen gives them chrome.runtime without getManifest: Loom's path).
const test = require('node:test'), assert = require('node:assert/strict');
const {extensionWorld, plain} = require('./fixtures/ext-api/world.cjs');

const MANIFEST = {manifest_version: 3, name: 'Recorder', version: '1', permissions: ['tabCapture', 'desktopCapture', 'offscreen']};

/** A fake navigator.mediaDevices: getDisplayMedia hands out a stream of fake tracks; getUserMedia records the native calls. */
function media() {
  const calls = {display: [], user: []};
  class Track {
    constructor(kind) { this.kind = kind; this.readyState = 'live'; this.listeners = {}; }
    stop() { this.readyState = 'ended'; }
    addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
    dispatchEvent(event) { for (const fn of this.listeners[event.type] || []) fn(event); return true; }
    applyConstraints(want) { this.constraints = want; return Promise.resolve(); }
  }
  const devices = {
    getUserMedia: async constraints => { calls.user.push(constraints); return {native: true}; },
    getDisplayMedia: async constraints => {
      calls.display.push(constraints);
      const tracks = [new Track('video'), ...(constraints.audio ? [new Track('audio')] : [])];
      return {getTracks: () => [...tracks], getVideoTracks: () => tracks.filter(t => t.kind === 'video'), getAudioTracks: () => tracks.filter(t => t.kind === 'audio'), removeTrack: t => tracks.splice(tracks.indexOf(t), 1)};
    }
  };
  return {devices, calls, globals: {navigator: {mediaDevices: devices, userActivation: {isActive: false}}, Event: class { constructor(type) { this.type = type; } }}};
}

const answers = log => (name, args) => {
  log.push([name, ...args]);
  if (name === 'mediaCapture.arm') return {captureId: 'cap-1', audio: true, source: {type: 'tab'}};
  if (name === 'tabCapture.getMediaStreamId') return 'stream-1';
  if (name === 'tabCapture.captureStreamId') return 'stream-2';
  if (name === 'desktopCapture.chooseDesktopMedia') return {streamId: 'desk-1', canRequestAudioTrack: true};
  return undefined;
};

test('offscreen document (no getManifest): the getUserMedia shim arms the stream id and answers through getDisplayMedia', async () => {
  const log = [], m = media(), original = m.devices.getUserMedia;
  const world = extensionWorld(MANIFEST, {worker: false, answer: answers(log), globals: m.globals, native: {runtime: {id: 'abcdefghijklmnopabcdefghijklmnop'}}});
  assert.notEqual(m.devices.getUserMedia, original, 'replaced although the manifest is unknown here');
  const stream = await world.context.navigator.mediaDevices.getUserMedia({audio: {mandatory: {chromeMediaSource: 'tab', chromeMediaSourceId: 'stream-1'}}, video: {mandatory: {chromeMediaSource: 'tab', chromeMediaSourceId: 'stream-1', maxWidth: 1280}}});
  assert.deepEqual(log.map(entry => entry[0]), ['mediaCapture.arm', 'mediaCapture.started']);
  assert.equal(log[0][1], 'stream-1');
  assert.deepEqual(plain(m.calls.display), [{video: true, audio: true}]);
  assert.deepEqual(plain(stream.getVideoTracks()[0].constraints), {width: {max: 1280}});
  for (const track of stream.getTracks()) track.stop();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(log.at(-1), ['mediaCapture.ended', 'cap-1'], 'the capture ends when every track stopped');
  // Camera and microphone are untouched.
  await world.context.navigator.mediaDevices.getUserMedia({audio: true});
  assert.deepEqual(plain(m.calls.user), [{audio: true}]);
});

test('a page of an extension without capture permissions keeps the browser\'s getUserMedia', () => {
  const m = media(), before = m.devices.getUserMedia;
  extensionWorld({manifest_version: 3, name: 'Plain', version: '1', permissions: ['storage']}, {worker: false, globals: m.globals});
  assert.equal(m.devices.getUserMedia, before);
});

test('chrome.tabCapture on Chromium\'s schema: argument checks, promise and callback forms, capture() gives a stream', async () => {
  const log = [], m = media();
  const world = extensionWorld(MANIFEST, {worker: false, answer: answers(log), globals: m.globals});
  const {tabCapture} = world.chrome;
  assert.deepEqual(plain(tabCapture.TabCaptureState), {PENDING: 'pending', ACTIVE: 'active', STOPPED: 'stopped', ERROR: 'error'});
  assert.equal(await tabCapture.getMediaStreamId({targetTabId: 4}), 'stream-1');
  assert.throws(() => tabCapture.getMediaStreamId({targetTabId: 'x'}), /Error in invocation of tabCapture\.getMediaStreamId/);
  assert.throws(() => tabCapture.getMediaStreamId({bogus: 1}), /Unexpected property: 'bogus'/);
  const viaCallback = await new Promise(resolve => tabCapture.getMediaStreamId({}, resolve));
  assert.equal(viaCallback, 'stream-1');
  const stream = await new Promise(resolve => tabCapture.capture({video: true, audio: false}, resolve));
  assert.equal(stream.getVideoTracks().length, 1);
  assert.ok(log.some(entry => entry[0] === 'tabCapture.captureStreamId'));
  assert.equal(typeof tabCapture.onStatusChanged.addListener, 'function');
  assert.equal(world.browser === undefined || world.browser.tabCapture === tabCapture, true);
});

test('chrome.desktopCapture.chooseDesktopMedia returns the request id at once and calls back with (streamId, options)', async () => {
  const log = [], m = media();
  const world = extensionWorld(MANIFEST, {worker: false, answer: answers(log), globals: m.globals});
  const {desktopCapture} = world.chrome;
  let requestId;
  const [streamId, options] = await new Promise(resolve => { requestId = desktopCapture.chooseDesktopMedia(['screen', 'window', 'tab'], (...args) => resolve(args)); });
  assert.equal(requestId, 1);
  assert.equal(streamId, 'desk-1');
  assert.deepEqual(plain(options), {canRequestAudioTrack: true});
  assert.deepEqual(log.find(entry => entry[0] === 'desktopCapture.chooseDesktopMedia').slice(1), [1, ['screen', 'window', 'tab'], null]);
  assert.throws(() => desktopCapture.chooseDesktopMedia('screen', () => {}), /Error in invocation of desktopCapture\.chooseDesktopMedia/);
  assert.equal(desktopCapture.cancelChooseDesktopMedia(1), undefined);
  assert.equal(desktopCapture.DesktopCaptureSourceType.SCREEN, 'screen');
});

test('a context with the capture permissions sets up without an error (the older shim and the package are both installed; a stray reference once aborted the setup of every such extension)', () => {
  for (const worker of [true, false]) {
    const m = media();
    const world = extensionWorld(MANIFEST, {worker, answer: answers([]), globals: worker ? {} : m.globals});
    assert.deepEqual(world.logged.error, [], `no setup error (${worker ? 'worker' : 'page'})`);
    assert.equal(typeof world.chrome.runtime.getContexts, 'function', 'the additions after the capture shim ran');
  }
});

test('offscreen package: one document per extension; a non-capture reason asks for an existing one first, then creates', async () => {
  let documents = 0;
  const calls = [];
  const world = extensionWorld(MANIFEST, {worker: true, answer: (name, args) => {
    calls.push(name);
    if (name === 'offscreen.hasDocument') return documents > 0;
    if (name === 'offscreen.createDocument') { documents++; return undefined; }
    return undefined;
  }});
  const params = {url: 'off.html', reasons: ['CLIPBOARD'], justification: 'copy'};
  await world.chrome.offscreen.createDocument(params);
  assert.deepEqual(calls, ['offscreen.hasDocument', 'offscreen.createDocument']);
  assert.equal(await world.chrome.offscreen.hasDocument(), true);
  await assert.rejects(world.chrome.offscreen.createDocument(params), {message: 'Only a single offscreen document may be created.'});
  assert.equal(calls.filter(name => name === 'offscreen.createDocument').length, 1, 'the second create never reached the main process');
});

test('a worker gets the namespaces but no getUserMedia shim', () => {
  const log = [];
  const world = extensionWorld(MANIFEST, {worker: true, answer: answers(log)});
  assert.equal(typeof world.chrome.tabCapture.getMediaStreamId, 'function');
  assert.equal(typeof world.chrome.desktopCapture.chooseDesktopMedia, 'function');
});
