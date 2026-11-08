'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createSessionEnd } = require('../desktop/session-end.cjs');
const { createSaveQueue } = require('../desktop/save-queue.cjs');

// beta.13: the computer shuts down or the person logs off. Windows sends no before-quit for that and ends the process a moment
// later, so a change still waiting for its 400 ms debounce was lost and the next start brought a closed tab back.

// A window with the same save path as main.cjs: a queue that writes into `records` (what the database would hold).
function windowWith(id, records, { privateMode = false } = {}) {
  const writes = [];
  const clock = { at: 0 };
  const saves = createSaveQueue({
    write() { if (!privateMode) { records.set(id, structuredClone(live.tabs)); writes.push(live.tabs.length); } },
    now: () => clock.at, setTimer: () => 1, clearTimer: () => {},
  });
  const live = { id, tabs: ['a', 'b', 'c'], writes, saves };
  live.save = () => saves.save();
  live.flushSave = () => saves.flush();
  live.change = tabs => { live.tabs = tabs; saves.queue(); };
  return live;
}
function rig(count = 2) {
  const records = new Map(), controllers = new Set(), calls = { begin: 0, secured: 0 }, warnings = [];
  const windows = Array.from({ length: count }, (_, i) => windowWith('w' + i, records));
  for (const w of windows) controllers.add(w);
  const end = createSessionEnd({
    getControllers: () => controllers,
    begin: () => { calls.begin += 1; }, flushSecured: () => { calls.secured += 1; }, warn: m => warnings.push(m),
  });
  return { end, windows, records, controllers, calls, warnings };
}

test('a change still waiting for its debounce is written when the session ends', () => {
  const r = rig(1);
  const [w] = r.windows;
  w.save(); // the record as it was
  assert.deepEqual(r.records.get('w0'), ['a', 'b', 'c']);
  w.change(['a', 'b']); // a tab closed 100 ms ago; its save is still waiting
  assert.deepEqual(r.records.get('w0'), ['a', 'b', 'c'], 'not written yet: this is the loss');
  const result = r.end.flush('session-end');
  assert.deepEqual(r.records.get('w0'), ['a', 'b'], 'the closed tab stays closed at the next start');
  assert.equal(result.full, 1);
});

test('every window is written, not only the one that heard the event', () => {
  const r = rig(3);
  r.windows[0].change(['a']); r.windows[1].change(['b']); r.windows[2].change(['c']);
  const result = r.end.flush();
  assert.equal(result.full, 3);
  assert.deepEqual([...r.records.entries()].sort(), [['w0', ['a']], ['w1', ['b']], ['w2', ['c']]]);
});

test('the list of open windows is frozen and the secured workspaces are written, before the windows', () => {
  const order = [];
  const w = windowWith('w0', new Map());
  const originalSave = w.save; w.save = () => { order.push('save'); return originalSave(); };
  const end = createSessionEnd({ getControllers: () => [w], begin: () => order.push('begin'), flushSecured: () => order.push('secured') });
  end.flush();
  assert.deepEqual(order, ['begin', 'secured', 'save']);
});

test('the event firing twice (every window hears it, then the shutdown notice) writes each window once', () => {
  const r = rig(3);
  for (const w of r.windows) w.change(['x']);
  r.end.flush('session-end'); r.end.flush('session-end'); r.end.flush('session-end'); r.end.flush('shutdown');
  for (const w of r.windows) assert.equal(w.writes.length, 1, w.id + ' was written once, not once per event');
  assert.equal(r.end.calls, 4);
  assert.equal(r.calls.begin, 4, 'freezing the list again changes nothing');
});

test('a change that arrives between two events is still written by the second', () => {
  const r = rig(2);
  r.end.flush();
  r.windows[1].change(['late']); // something changed after the first event
  const second = r.end.flush();
  assert.deepEqual(r.records.get('w1'), ['late']);
  assert.equal(second.pending, 1);
  assert.equal(second.full, 0);
  assert.equal(r.windows[0].writes.length, 1, 'the window with nothing waiting is left alone');
});

test('a window that appears after the first event is written in full by the next', () => {
  const r = rig(1);
  r.end.flush();
  const late = windowWith('w9', r.records); r.controllers.add(late);
  const second = r.end.flush();
  assert.equal(second.full, 1);
  assert.deepEqual(r.records.get('w9'), ['a', 'b', 'c']);
});

test('a window that fails to save does not stop the others, or the next call', () => {
  const r = rig(3);
  r.windows[1].save = () => { throw new Error('disk is full'); };
  r.windows[0].change(['first']); r.windows[2].change(['last']);
  const result = r.end.flush();
  assert.equal(result.failed, 1);
  assert.deepEqual(r.records.get('w0'), ['first']);
  assert.deepEqual(r.records.get('w2'), ['last']);
  assert.match(r.warnings.join('\n'), /disk is full/);
  assert.doesNotThrow(() => r.end.flush());
});

test('freezing the list or writing the secured workspaces failing never stops the windows being written', () => {
  const warnings = [], records = new Map();
  const w = windowWith('w0', records); w.change(['kept']);
  const end = createSessionEnd({
    getControllers: () => [w], warn: m => warnings.push(m),
    begin: () => { throw new Error('list'); }, flushSecured: () => { throw new Error('secured'); },
  });
  assert.doesNotThrow(() => end.flush());
  assert.deepEqual(records.get('w0'), ['kept']);
  assert.equal(warnings.length, 2);
});

test('a window list that cannot be read is a warning, not an exception', () => {
  const warnings = [];
  const end = createSessionEnd({ getControllers: () => { throw new Error('gone'); }, warn: m => warnings.push(m) });
  assert.doesNotThrow(() => end.flush());
  assert.equal(warnings.length, 1);
});

test('private windows are not written (the record itself refuses), and nothing is when there are no windows', () => {
  const records = new Map();
  const priv = windowWith('private', records, { privateMode: true });
  priv.change(['secret']);
  createSessionEnd({ getControllers: () => [priv] }).flush();
  assert.equal(records.size, 0);
  assert.deepEqual(createSessionEnd({ getControllers: () => [] }).flush(), { reason: 'session-end', full: 0, pending: 0, failed: 0 });
});

// The wiring in main.cjs.
const main = fs.readFileSync(path.join(__dirname, '../desktop/main.cjs'), 'utf8');

test('main.cjs: each window hears the session end, and the shutdown notice reaches the app after it is ready', () => {
  assert.match(main, /mainWindow\.on\('session-end',\(\)=>\{sessionEnd\.flush\('session-end'\);\}\);/);
  assert.match(main, /app\.whenReady\(\)\.then\(\(\)=>\{try\{require\('electron'\)\.powerMonitor\.on\('shutdown',\(\)=>\{sessionEnd\.flush\('shutdown'\);\}\);\}catch/);
  assert.equal((main.match(/powerMonitor\.on\('shutdown'/g) || []).length, 1, 'registered once, not once per window');
  assert.doesNotMatch(main.slice(main.indexOf("powerMonitor.on('shutdown'") - 120, main.indexOf("powerMonitor.on('shutdown'")), /preventDefault/, 'the shutdown is not held back');
});

test('main.cjs: the session end freezes the same list a quit does, and each window offers a write-if-waiting', () => {
  assert.match(main, /createSessionEnd\(\{getControllers:\(\)=>controllers,begin:\(\)=>openWindows\.begin\(\),flushSecured:\(\)=>securedService\?\.flush\(\)\}\)/);
  assert.match(main, /save,flushSave\(\)\{return saves\.flush\(\);\},get switchedAway\(\)/);
});

test('main.cjs: the quit path still saves every window at before-quit', () => {
  assert.match(main, /const beginQuit=\(\)=>\{closeSplash\(\);openWindows\.begin\(\);[^\n]*for\(const controller of controllers\)controller\.save\(\);\};/);
});
