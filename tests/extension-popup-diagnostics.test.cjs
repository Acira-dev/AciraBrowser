'use strict';
// A Linux user's Proton Pass popup opened as a small empty window that was not under its icon (9 Nov 2026, 0.1.0-beta.13.4), and the packaged app cannot
// be debugged from outside. The popup now writes what it did to the local extension trace (desktop/browser-services/extension-popup-diagnostics.cjs):
// whether the window system honoured the position and size it was asked for, whether the page built anything, whether the extension's worker runs.
// These tests pin what is written, that it is bounded, and that nothing in it can reach into the popup.
const test = require('node:test'), assert = require('node:assert/strict');
const {EventEmitter} = require('node:events'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {createPopupDiagnostics, watchWorkerErrors, sessionFacts, placementFacts, workerRunning, PROBE_SCRIPT} = require('../desktop/browser-services/extension-popup-diagnostics.cjs');
const trace = require('../desktop/browser-services/ext-trace.cjs');

const ID = 'ghmbeldphafepmbegfdlkpapadhbakde';

/** A timer that runs only when the test says so, with the delay it was asked for. */
function manualTimers() {
  const pending = [];
  const setTimer = (work, delay) => { const timer = {work, delay, cleared: false, unref() {}}; pending.push(timer); return timer; };
  const clearTimer = timer => { if (timer) timer.cleared = true; };
  return {setTimer, clearTimer, pending, run: delay => { for (const timer of pending.filter(t => !t.cleared && (delay === undefined || t.delay === delay))) { timer.cleared = true; timer.work(); } }};
}
function fakePopup({window, size = {width: 400, height: 500}} = {}) {
  const popup = new EventEmitter();
  popup.extensionId = ID; popup.size = size;
  popup.webContents = Object.assign(new EventEmitter(), {
    destroyed: false, isDestroyed() { return this.destroyed; }, isLoading: () => false,
    session: {serviceWorkers: {getAllRunning: () => ({7: {scope: `chrome-extension://${ID}/`}})}},
    executeJavaScript: async script => { popup.scripts.push(script); return {ready: 'complete', visible: 'visible', focused: true, nodes: 124, text: 0, inner: [400, 500], scroll: [400, 500], bg: 'rgb(248, 248, 252)'}; },
  });
  popup.scripts = [];
  popup.window = window || {isDestroyed: () => false, getBounds: () => ({x: 913, y: 77, width: 400, height: 500}), isVisible: () => true, isFocused: () => true};
  popup.parent = {isDestroyed: () => false, isFocused: () => false};
  return popup;
}
function harness(options = {}) {
  const lines = [], timers = manualTimers();
  const diagnostics = createPopupDiagnostics({trace: (...parts) => lines.push(parts), enabled: () => true, setTimer: timers.setTimer, clearTimer: timers.clearTimer, now: () => 1000, ...options});
  return {lines, timers, diagnostics, names: () => lines.map(line => line[0])};
}
const flush = () => new Promise(resolve => setImmediate(resolve));

// ---- the facts

test('sessionFacts: off Linux only the platform and versions; on Linux the session type, desktop, display variables and ozone switch (a Wayland session is the first thing to know)', () => {
  const versions = {electron: '44.9.3', chrome: '152.0.7977.167'};
  assert.deepEqual(sessionFacts({platform: 'darwin', versions, env: {XDG_SESSION_TYPE: 'wayland'}}), {platform: 'darwin', electron: '44.9.3', chrome: '152.0.7977.167'});
  const app = {commandLine: {getSwitchValue: name => (name === 'ozone-platform-hint' ? 'auto' : '')}};
  assert.deepEqual(sessionFacts({platform: 'linux', versions, app, env: {XDG_SESSION_TYPE: 'wayland', XDG_CURRENT_DESKTOP: 'KDE', WAYLAND_DISPLAY: 'wayland-0', DISPLAY: ':1', APPIMAGE: '/x.AppImage'}}),
    {platform: 'linux', electron: '44.9.3', chrome: '152.0.7977.167', session: 'wayland', desktop: 'KDE', waylandDisplay: true, x11Display: true, ozone: 'auto', appImage: true});
  const bare = sessionFacts({platform: 'linux', versions, env: {}});
  assert.deepEqual([bare.session, bare.desktop, bare.waylandDisplay, bare.x11Display, bare.ozone, bare.appImage], [null, null, false, false, null, false]);
  assert.doesNotThrow(() => sessionFacts({platform: 'linux', versions, app: {commandLine: {getSwitchValue() { throw new Error('no'); }}}, env: {}}));
});

test('placementFacts: a window system that honours the request says so; Wayland answers { 0, 0 } to any position and is reported as not knowing where the window is', () => {
  const asked = {x: 913, y: 77, width: 27, height: 100};
  assert.deepEqual(placementFacts(asked, {x: 913, y: 77, width: 27, height: 100}), {asked: [913, 77, 27, 100], got: [913, 77, 27, 100], positionHonoured: true, sizeHonoured: true, positionUnknown: false});
  assert.equal(placementFacts(asked, {x: 914, y: 76, width: 27, height: 100}).positionHonoured, true, 'whole device pixels may move it by a DIP');
  const wayland = placementFacts(asked, {x: 0, y: 0, width: 27, height: 100});
  assert.deepEqual([wayland.positionHonoured, wayland.sizeHonoured, wayland.positionUnknown], [false, true, true]);
  const placed = placementFacts(asked, {x: 66, y: 426, width: 600, height: 430});
  assert.deepEqual([placed.positionHonoured, placed.sizeHonoured, placed.positionUnknown], [false, false, false], 'moved by the window manager: known, not honoured');
  assert.doesNotThrow(() => placementFacts(undefined, undefined));
});

test('workerRunning: true when a running worker has the extension\'s scope, false when another extension\'s runs, null when the session cannot say', () => {
  assert.equal(workerRunning({serviceWorkers: {getAllRunning: () => ({1: {scope: `chrome-extension://${ID}/`}})}}, ID), true);
  assert.equal(workerRunning({serviceWorkers: {getAllRunning: () => ({1: {scope: 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/'}})}}, ID), false);
  assert.equal(workerRunning({serviceWorkers: {getAllRunning: () => ({})}}, ID), false);
  assert.equal(workerRunning({}, ID), null);
  assert.equal(workerRunning({serviceWorkers: {getAllRunning() { throw new Error('gone'); }}}, ID), null);
});

test('the probe reads numbers and flags from the page and never its text', () => {
  assert.match(PROBE_SCRIPT, /innerText.*length/);
  assert.doesNotMatch(PROBE_SCRIPT, /innerHTML|outerHTML|textContent|value\b|cookie|localStorage/);
  assert.doesNotThrow(() => new Function(`return ${PROBE_SCRIPT}`));
});

// ---- what a popup writes

test('a popup writes: the session once per run, that it opened, each page size (at most 8), where the window really is 300 ms after it shows, two page probes with the worker, and how long it lived', async () => {
  const h = harness(), popup = fakePopup();
  h.diagnostics.attach(popup);
  assert.deepEqual(h.names(), ['session', 'toolbar popup opens']);
  for (let i = 0; i < 12; i++) popup.webContents.emit('preferred-size-changed', {}, {width: 25 + i, height: 100});
  assert.equal(h.names().filter(name => name === 'toolbar popup page size').length, 8, 'bounded');
  popup.emit('will-move', {x: 913, y: 77});
  popup.emit('shown');
  assert.deepEqual(h.timers.pending.map(t => t.delay).sort((a, b) => a - b), [300, 1500, 5000]);
  h.timers.run();
  await flush();
  const placed = h.lines.find(line => line[0] === 'toolbar popup placed');
  assert.deepEqual(placed.slice(1, 2), [ID]);
  assert.deepEqual([placed[2].asked, placed[2].got, placed[2].positionHonoured, placed[2].visible, placed[2].focused, placed[2].parentFocused], [[913, 77, 400, 500], [913, 77, 400, 500], true, true, true, false]);
  const probes = h.lines.filter(line => line[0] === 'toolbar popup page');
  assert.equal(probes.length, 2);
  assert.deepEqual([probes[0][2].probe, probes[1][2].probe, probes[0][2].worker, probes[0][2].nodes, probes[0][2].text, probes[0][2].bg, probes[0][2].loading], [1, 2, true, 124, 0, 'rgb(248, 248, 252)', false]);
  popup.emit('gone');
  assert.deepEqual(h.lines.slice(-1)[0], ['toolbar popup closed', ID, {afterMs: 0}]);
  const second = fakePopup(); h.diagnostics.attach(second);
  assert.equal(h.names().filter(name => name === 'session').length, 1, 'the session line is written once');
});

test('on a Wayland-like window system the trace says the position was not given and the window cannot be found', () => {
  const h = harness({placedDelay: 300}), asked = {x: 913, y: 77};
  const popup = fakePopup({size: {width: 27, height: 100}, window: {isDestroyed: () => false, getBounds: () => ({x: 0, y: 0, width: 27, height: 100}), isVisible: () => true, isFocused: () => false}});
  h.diagnostics.attach(popup);
  popup.emit('will-move', asked); popup.emit('shown'); h.timers.run(300);
  const facts = h.lines.find(line => line[0] === 'toolbar popup placed')[2];
  assert.deepEqual([facts.asked, facts.got, facts.positionHonoured, facts.positionUnknown, facts.sizeHonoured], [[913, 77, 27, 100], [0, 0, 27, 100], false, true, true]);
});

test('the page\'s errors are logged only for the first three, cut to 160 characters, as Electron 44 (one details object) and older versions (level, message) send them; warnings are not logged', () => {
  const h = harness(), popup = fakePopup();
  h.diagnostics.attach(popup);
  popup.webContents.emit('console-message', {level: 'warning', message: 'not an error'});
  for (let i = 0; i < 5; i++) popup.webContents.emit('console-message', {level: 'error', message: `boom ${i} ${'x'.repeat(400)}`});
  popup.webContents.emit('console-message', {}, 3, 'old style');
  const errors = h.lines.filter(line => line[0] === 'toolbar popup page error');
  assert.equal(errors.length, 3);
  assert.ok(errors.every(line => line[2].length <= 160));
  assert.match(errors[0][2], /^boom 0 /);
});

test('a page that fails to load, loses its process or hangs is written down; a page that is gone is not probed and nothing throws', async () => {
  const h = harness(), popup = fakePopup();
  h.diagnostics.attach(popup);
  popup.webContents.emit('did-fail-load', {}, -105, 'ERR_NAME_NOT_RESOLVED');
  popup.webContents.emit('render-process-gone', {}, {reason: 'crashed', exitCode: 11});
  popup.webContents.emit('unresponsive');
  assert.deepEqual(h.lines.slice(2).map(line => line[0]), ['toolbar popup load failed', 'toolbar popup page process gone', 'toolbar popup page unresponsive']);
  assert.deepEqual(h.lines[3][2], {reason: 'crashed', exitCode: 11});
  popup.emit('shown');
  popup.webContents.destroyed = true;
  assert.doesNotThrow(() => h.timers.run());
  await flush();
  assert.equal(h.names().includes('toolbar popup page'), false, 'a destroyed page is not asked');
  const rejecting = fakePopup(); rejecting.webContents.executeJavaScript = () => Promise.reject(new Error('Script failed to execute'));
  h.diagnostics.attach(rejecting); rejecting.emit('shown');
  assert.doesNotThrow(() => h.timers.run());
  await flush();
});

test('closing the popup stops its timers, and a trace that throws or a fake with none of the optional parts never reaches the popup', async () => {
  const h = harness(), popup = fakePopup();
  h.diagnostics.attach(popup); popup.emit('shown'); popup.emit('gone');
  assert.ok(h.timers.pending.every(timer => timer.cleared));
  h.timers.run(); await flush();
  assert.equal(h.names().includes('toolbar popup page'), false, 'nothing is written after the popup is gone');
  const throwing = createPopupDiagnostics({trace() { throw new Error('disk full'); }, enabled: () => true, setTimer: manualTimers().setTimer});
  const bare = new EventEmitter(); bare.extensionId = ID; bare.webContents = new EventEmitter();
  assert.doesNotThrow(() => { throwing.attach(bare); bare.emit('shown'); bare.webContents.emit('preferred-size-changed', {}, {width: 1, height: 1}); bare.emit('gone'); });
  assert.doesNotThrow(() => createPopupDiagnostics({trace() {}, enabled: () => true}).attach(undefined));
});

test('nothing is attached while the trace has no file (tests, a development run): no listeners, no timers', () => {
  const h = harness({enabled: () => false}), popup = fakePopup();
  h.diagnostics.attach(popup);
  assert.deepEqual([h.lines.length, h.timers.pending.length, popup.listenerCount('shown'), popup.webContents.listenerCount('preferred-size-changed')], [0, 0, 0, 0]);
});

test('with the real trace file the lines are one per row, carry no query strings, and the file stays bounded', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'acira-popup-trace-')), 'logs', 'extension-windows.log');
  trace.setFile(file);
  try {
    const h = createPopupDiagnostics({enabled: () => true, setTimer: manualTimers().setTimer}), popup = fakePopup();
    h.attach(popup);
    popup.webContents.emit('console-message', {level: 'error', message: 'fetch failed https://pass.proton.me/api/x?token=SECRET&u=1 end'});
    popup.emit('gone');
    const text = fs.readFileSync(file, 'utf8');
    assert.match(text, /session \{"platform":/);
    assert.match(text, /toolbar popup opens ghmbeldphafepmbegfdlkpapadhbakde/);
    assert.doesNotMatch(text, /SECRET|token=/, 'the trace removes query strings from addresses');
    assert.ok(text.trimEnd().split('\n').every(row => /^\d{4}-\d\d-\d\dT/.test(row)));
  } finally { trace.setFile(null); fs.rmSync(path.dirname(path.dirname(file)), {recursive: true, force: true}); }
});

// ---- the extension's worker

test('watchWorkerErrors: the first five errors of each extension\'s worker go to the trace (the API a blank Proton Pass popup waits on); warnings, other scripts and websites\' workers do not', () => {
  const lines = [], workers = new EventEmitter();
  workers.getWorkerFromVersionID = id => (id === 9 ? {scope: `chrome-extension://${ID}/`} : null);
  const stop = watchWorkerErrors({serviceWorkers: workers}, {trace: (...parts) => lines.push(parts)});
  const script = `chrome-extension://${ID}/background.js`;
  workers.emit('console-message', {}, {level: 2, message: 'a warning', sourceUrl: script});
  workers.emit('console-message', {}, {level: 3, message: 'from a website', sourceUrl: 'https://example.com/sw.js', versionId: 1});
  for (let i = 0; i < 8; i++) workers.emit('console-message', {}, {level: 3, message: `Cannot read properties of undefined (reading 'onAdded') ${i} ${'x'.repeat(300)}`, sourceUrl: script});
  workers.emit('console-message', {}, {level: 'error', message: 'by version only', versionId: 9});
  const other = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  workers.emit('console-message', {}, {level: 3, message: 'another extension', sourceUrl: `chrome-extension://${other}/sw.js`});
  const mine = lines.filter(line => line[1] === ID);
  assert.equal(mine.length, 5, 'five per extension');
  assert.ok(mine.every(line => line[0] === 'extension worker error' && line[2].length <= 160));
  assert.match(mine[0][2], /^Cannot read properties of undefined \(reading 'onAdded'\) 0 /);
  assert.deepEqual(lines.filter(line => line[1] === other).map(line => line[2]), ['another extension'], 'counted per extension');
  assert.equal(lines.some(line => /warning|website/.test(line[2])), false);
  stop();
  assert.equal(workers.listenerCount('console-message'), 0);
  workers.emit('console-message', {}, {level: 3, message: 'late', sourceUrl: script});
  assert.equal(lines.length, 6);
});

test('watchWorkerErrors: a session with no service-worker object, a broken one, or a trace that throws is left alone', () => {
  assert.equal(typeof watchWorkerErrors(undefined), 'function');
  assert.equal(typeof watchWorkerErrors({}), 'function');
  const workers = new EventEmitter();
  watchWorkerErrors({serviceWorkers: workers}, {trace() { throw new Error('disk full'); }});
  assert.doesNotThrow(() => workers.emit('console-message', {}, {level: 3, message: 'x', sourceUrl: `chrome-extension://${ID}/a.js`}));
  assert.doesNotThrow(() => workers.emit('console-message', {}, undefined));
  assert.doesNotThrow(() => watchWorkerErrors({serviceWorkers: {on() { throw new Error('no'); }}}) && 0);
});
