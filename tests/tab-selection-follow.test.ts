import test from 'node:test';
import assert from 'node:assert/strict';
import { followFrame, followSettleMs } from '../src/ui/tabSelectionFollow';

const box = (x: number, width = 140) => ({ x, width });

test('the first frame after a change writes even when the new active tab is already in place (founder: stuck surface)', () => {
  // Closing the last tab with the pointer on the strip: its left neighbour does not move, so its box equals its target.
  const step = followFrame({ x: NaN, width: NaN }, box(432.8), box(432.9), 0, false, 0);
  assert.equal(step.moved, true, 'the surface is written to the tab');
  assert.equal(step.settled, 0);
});

test('a quiet tab settles after four frames once it is at its destination', () => {
  let settled = 0;
  for (let frame = 0; frame < 4; frame++) settled = followFrame(box(432.8), box(432.8), box(432.9), 16 * frame, false, settled).settled;
  assert.equal(settled, 4);
});

test('quiet frames before a layout animation do not settle early, at any refresh rate', () => {
  // A tab still away from its destination is not settled however many frames pass (144Hz = 36 frames in 250ms).
  let settled = 0;
  for (let frame = 0; frame < 36; frame++) settled = followFrame(box(577), box(577), box(432.9), frame * 7, false, settled).settled;
  assert.equal(settled, 0);
  assert.ok(followFrame(box(577), box(577), box(432.9), followSettleMs + 1, false, 0).settled > 0, 'only time lets a box resting off its target settle');
});

test('moving and dragging never settle', () => {
  assert.equal(followFrame(box(500), box(480), box(432.9), 900, false, 3).settled, 0);
  assert.equal(followFrame(box(432.9), box(432.9), box(432.9), 900, true, 3).settled, 0);
});
