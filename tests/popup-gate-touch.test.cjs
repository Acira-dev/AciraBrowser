'use strict';
// A tap on a touch screen (Windows laptops with one) reaches a page as touch and gesture events and the page makes the click itself: no mouse event passes the browser
// side. The pop-up gate counted only mouse and key events, so tapping a target=_blank link or a "Sign in with..." button was blocked as a pop-up, and mailto:/tel: links did nothing.
const test = require('node:test'), assert = require('node:assert/strict'), { EventEmitter } = require('node:events');
const { createPopupGate } = require('../desktop/popup-gate.cjs');

const fixture = () => { let time = 1000; const blocked = [], gate = createPopupGate({ now: () => time, onBlocked: () => blocked.push(time) }), wc = new EventEmitter(); gate.attach(wc); return { gate, wc, blocked, advance: ms => { time += ms; } }; };

test('a tap (gestureTap, or the end of a touch) counts as the gesture that allows a pop-up', () => {
  for (const type of ['gestureTap', 'touchEnd']) {
    const { gate, wc, advance } = fixture();
    assert.equal(gate.allow(wc, {}), false, 'no gesture yet');
    advance(100); wc.emit('input-event', {}, { type });
    advance(200);
    assert.equal(gate.allow(wc, {}), true, type);
    assert.equal(gate.recent(wc), true);
    advance(6000);
    assert.equal(gate.allow(wc, {}), false, 'a gesture older than 5 s no longer counts');
  }
});

test('events that are not a tap (moves, scrolls, touch start, flings) never allow a pop-up; the mouse and the keyboard still do', () => {
  const { gate, wc, advance } = fixture();
  for (const type of ['touchStart', 'touchMove', 'gestureScrollUpdate', 'gestureFlingStart', 'mouseMove', 'pointerMove', undefined]) wc.emit('input-event', {}, { type });
  wc.emit('input-event', {}, null);
  assert.equal(gate.allow(wc, {}), false);
  advance(10); wc.emit('before-mouse-event', {}, { type: 'mouseDown' });
  assert.equal(gate.allow(wc, {}), true, 'a mouse press');
  const second = fixture(); second.wc.emit('before-input-event', {}, { type: 'keyDown', key: 'Shift' });
  assert.equal(second.gate.allow(second.wc, {}), false, 'a modifier alone is not a gesture');
  second.wc.emit('before-input-event', {}, { type: 'keyDown', key: 'Enter' });
  assert.equal(second.gate.allow(second.wc, {}), true, 'a key press');
});
