import assert from 'node:assert/strict';
import test from 'node:test';
import { effectiveReducedMotion } from '../src/runtime/motion';
import { createInitialState, persistedSnapshot, reduceBrowser, restoreSnapshot } from '../src/runtime/core';

test('untouched Reduce motion follows software drawing; a normal GPU is unchanged', () => {
  assert.equal(effectiveReducedMotion({ reducedMotion: false }, false, true), true, 'software, never chosen: on');
  assert.equal(effectiveReducedMotion({ reducedMotion: false }, false, false), false, 'normal GPU: off, as before');
  assert.equal(effectiveReducedMotion({ reducedMotion: true }, false, false), true, 'on stays on');
  assert.equal(effectiveReducedMotion({}, false, true), true, 'no value at all counts as never chosen');
});

test('a choice made by the person is kept, on software drawing too', () => {
  assert.equal(effectiveReducedMotion({ reducedMotion: false, reducedMotionChosen: true }, false, true), false, 'explicitly off stays off');
  assert.equal(effectiveReducedMotion({ reducedMotion: true, reducedMotionChosen: true }, false, false), true);
  // the operating system's own setting still wins over an Off, as it did
  assert.equal(effectiveReducedMotion({ reducedMotion: false, reducedMotionChosen: true }, true, true), true);
});

test('the first time anything sets Reduce motion it is marked as chosen, and the mark survives a restart', () => {
  let state = createInitialState();
  assert.equal(state.settings.reducedMotion, false);
  assert.equal(state.settings.reducedMotionChosen, undefined, 'a fresh profile has not chosen');
  state = reduceBrowser(state, { type: 'settings.update', patch: { appearance: 'dark' } });
  assert.equal(state.settings.reducedMotionChosen, undefined, 'other settings do not mark it');
  state = reduceBrowser(state, { type: 'settings.update', patch: { reducedMotion: false } });
  assert.equal(state.settings.reducedMotionChosen, true, 'turning it off is a choice');
  const saved = persistedSnapshot(state), back = restoreSnapshot(JSON.parse(JSON.stringify(saved)));
  assert.equal(back.settings.reducedMotionChosen, true);
  assert.equal(effectiveReducedMotion(back.settings, false, true), false, 'explicit off sticks across a restart on software drawing');
  // a profile saved before 13.5: false and no marker
  const old = restoreSnapshot(JSON.parse(JSON.stringify(persistedSnapshot(createInitialState()))));
  assert.equal(old.settings.reducedMotionChosen, undefined);
  assert.equal(effectiveReducedMotion(old.settings, false, true), true);
});
