'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createSaveQueue, DEBOUNCE_MS, CEILING_MS } = require('../desktop/save-queue.cjs');

// beta.12 item 23: tabs closed in the last 400 ms before the window closed came back at the next start, because the window's
// 'closed' handler cancelled the save that was still waiting for its debounce.
function rig() {
  const clock = { at: 10000 };
  const timers = new Map();
  let next = 1;
  const writes = [];
  const queue = createSaveQueue({
    write: () => writes.push(clock.at),
    now: () => clock.at,
    setTimer: (fn, ms) => { const id = next++; timers.set(id, { fn, at: clock.at + ms }); return id; },
    clearTimer: id => timers.delete(id),
  });
  // moves the clock forward and fires the timers that come due, in order
  const advance = ms => {
    const end = clock.at + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]); clock.at = due[1].at; due[1].fn();
    }
    clock.at = end;
  };
  return { queue, advance, clock, writes, timers };
}

test('a change is written after 400 ms of quiet, once', () => {
  const r = rig();
  r.queue.queue();
  r.advance(DEBOUNCE_MS - 1); assert.equal(r.writes.length, 0);
  r.advance(1); assert.equal(r.writes.length, 1);
  r.advance(5000); assert.equal(r.writes.length, 1, 'nothing more is written for the same change');
  assert.equal(r.queue.pending(), false);
});

test('a page that keeps changing never puts the save off past 2.5 s', () => {
  const r = rig();
  r.queue.queue(); const first = r.clock.at;
  for (let i = 0; i < 40 && !r.writes.length; i++) { r.advance(300); r.queue.queue(); }
  assert.equal(r.writes.length, 1);
  assert.ok(r.writes[0] - first <= CEILING_MS, 'written ' + (r.writes[0] - first) + ' ms after the first change');
});

test('closing the window right after tabs were closed writes them instead of dropping them', () => {
  const r = rig();
  r.queue.queue(); // the tab that was just closed
  r.advance(120); // the window is closed 120 ms later, well inside the 400 ms wait
  assert.equal(r.writes.length, 0, 'still waiting for its debounce');
  assert.equal(r.queue.flush(), true, 'the closed handler writes it');
  assert.equal(r.writes.length, 1);
  assert.equal(r.writes[0], 10120, 'written at the moment the window closed');
  assert.equal(r.timers.size, 0, 'the waiting timer is gone, so the same state is not written twice');
  r.advance(5000); assert.equal(r.writes.length, 1);
});

test('closing with nothing waiting writes nothing', () => {
  const r = rig();
  assert.equal(r.queue.flush(), false);
  r.queue.queue(); r.advance(DEBOUNCE_MS); // already written by its own timer
  assert.equal(r.writes.length, 1);
  assert.equal(r.queue.flush(), false);
  assert.equal(r.writes.length, 1);
});

test('a save made at the close event leaves nothing waiting for the closed event to write again', () => {
  const r = rig();
  r.queue.queue(); r.advance(50);
  r.queue.save(); // the window's 'close' event
  assert.equal(r.writes.length, 1);
  assert.equal(r.queue.flush(), false, 'nothing changed since');
  r.queue.queue(); r.advance(10); // a late change between close and closed (a tab close that finished after the close event)
  assert.equal(r.queue.flush(), true);
  assert.equal(r.writes.length, 2);
});

test('a record that is about to be deleted is never written', () => {
  const r = rig();
  r.queue.queue(); r.advance(100);
  r.queue.cancel(); // closeEmpty: the window gave its tabs to another window
  assert.equal(r.queue.flush(), false);
  r.advance(5000);
  assert.equal(r.writes.length, 0);
  assert.equal(r.timers.size, 0);
});

test('after a flush a new change starts a fresh 2.5 s ceiling', () => {
  const r = rig();
  r.queue.queue(); r.advance(10); r.queue.flush();
  r.advance(3000);
  r.queue.queue(); const again = r.clock.at; r.advance(DEBOUNCE_MS);
  assert.equal(r.writes.length, 2);
  assert.equal(r.writes[1], again + DEBOUNCE_MS);
});

// The wiring in main.cjs: the 'closed' handler flushes before the record can be deleted or the window list changed.
const main = fs.readFileSync(path.join(__dirname, '../desktop/main.cjs'), 'utf8');
const closed = main.slice(main.indexOf("mainWindow.on('closed',()=>{"));
const handler = closed.slice(0, closed.indexOf('updateQuit?updateQuit.lastWindowClosed():app.quit();});') + 80);

test('main.cjs: the closed handler writes a waiting save first, and not for a record that is being deleted', () => {
  assert.ok(handler.length > 500, 'the closed handler was found');
  const flush = handler.indexOf('saves.flush()'), cancel = handler.indexOf('saves.cancel()'), del = handler.indexOf('database.deleteWindow(windowId)'), list = handler.indexOf('persistOpenWindows()');
  assert.ok(flush > 0 && cancel > 0, 'flush and cancel are both there');
  assert.match(handler.slice(0, flush + 20), /if\(discardRecord\)saves\.cancel\(\);else saves\.flush\(\)/);
  assert.ok(flush < del, 'the record is written before it can be deleted');
  assert.ok(cancel < del, 'a record to be deleted is not left to a late write');
  assert.ok(flush < list, 'the record is whole before the list of open windows is updated');
  assert.doesNotMatch(handler, /clearTimeout\(saveTimer\)/, 'the waiting save is no longer cancelled');
});

test('main.cjs: every save goes through the one queue', () => {
  assert.doesNotMatch(main, /\bsaveTimer\b|\bsaveDue\b/);
  assert.match(main, /function save\(\)\{saves\.save\(\);\}/);
  assert.match(main, /function queueSave\(\)\{saves\.queue\(\);\}/);
});
