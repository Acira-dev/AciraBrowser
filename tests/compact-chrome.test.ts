import test from 'node:test';
import assert from 'node:assert/strict';
import { compactRest, compactStep, compactTimings, type CompactEvent, type CompactState } from '../src/ui/compactChrome';

const run = (...events: CompactEvent[]): CompactState => events.reduce(compactStep, compactRest);
const pin = (name: 'popup' | 'drag' | 'address' | 'pointer', on: boolean): CompactEvent => ({ type: 'pin', pin: name, on });

test('R4-14 the pointer never changes the layout: clicking the address field, a toolbar button or a menu keeps the one row', () => {
  // Click the address field: focus pins, nothing expands.
  assert.equal(run(pin('pointer', true), pin('address', true)).phase, 'collapsed');
  // Click a toolbar button that opens a popup, then click outside.
  const menu = run(pin('pointer', true), pin('popup', true));
  assert.equal(menu.phase, 'collapsed');
  assert.equal(compactStep(menu, pin('popup', false)).phase, 'collapsed');
  // Type, then Enter.
  assert.equal(run(pin('address', true), { type: 'commit' }).phase, 'collapsed');
  assert.deepEqual(run(pin('address', true), pin('address', false)), compactRest);
});

test('R4-14 Ctrl+L expands; focus holds it; Enter, Esc or a page click collapses at once', () => {
  const opened = run({ type: 'address-key' });
  assert.equal(opened.phase, 'expanded');
  assert.equal(opened.due, 'settle', 'waits for focus to land');
  const focused = compactStep(opened, pin('address', true));
  assert.equal(focused.due, null, 'focus pins it: no timer');
  for (const end of ['commit', 'escape', 'page'] as const) assert.equal(compactStep(focused, { type: end }).phase, 'collapsed', end);
  // Focus never landed: the settle timer collapses it, so it can never stay stuck open.
  assert.equal(compactStep(opened, { type: 'timeout', due: 'settle' }).phase, 'collapsed');
});

test('R4-14 a new tab expands until it is used; tab switch collapses', () => {
  const fresh = run({ type: 'new-tab' }, pin('address', true));
  assert.equal(fresh.phase, 'expanded');
  assert.equal(fresh.reason, 'new-tab');
  assert.equal(compactStep(fresh, { type: 'switch' }).phase, 'collapsed');
  assert.equal(compactStep(fresh, { type: 'commit' }).phase, 'collapsed');
});

test('R4-14 open a menu from the expanded chrome, then click outside: the menu pins, its close starts the grace', () => {
  let state = run({ type: 'address-key' }, pin('address', true), pin('pointer', true));
  state = compactStep(state, pin('address', false));
  state = compactStep(state, pin('popup', true));
  assert.equal(state.phase, 'expanded');
  // Esc belongs to the open menu first.
  assert.equal(compactStep(state, { type: 'escape' }).phase, 'expanded');
  state = compactStep(state, pin('popup', false));
  assert.equal(state.due, null, 'pointer still over the chrome');
  state = compactStep(state, pin('pointer', false));
  assert.equal(state.due, 'grace');
  // Pointer comes back during the grace: held again, and the stale timer does nothing.
  const back = compactStep(state, pin('pointer', true));
  assert.equal(compactStep(back, { type: 'timeout', due: 'grace' }).phase, 'expanded');
  assert.equal(compactStep(state, { type: 'timeout', due: 'grace' }).phase, 'collapsed');
  // A click outside in the page ends it at once, without waiting for the grace.
  assert.equal(compactStep(state, { type: 'page' }).phase, 'collapsed');
});

test('R4-14 Ctrl+Tab shows the strip while cycling and collapses one beat after the last step', () => {
  let state = run({ type: 'cycle' });
  assert.equal(state.phase, 'expanded');
  assert.equal(state.due, 'cycle');
  state = compactStep(state, { type: 'switch' });
  assert.equal(state.phase, 'expanded', 'the switch is the cycle itself');
  assert.equal(state.due, 'cycle');
  assert.equal(compactStep(state, { type: 'timeout', due: 'cycle' }).phase, 'collapsed');
  assert.ok(compactTimings.cycle >= 800 && compactTimings.grace <= 500);
});

test('R4-14 dragging a tab holds the chrome; the drop starts the grace', () => {
  let state = run({ type: 'new-tab' }, pin('drag', true));
  assert.equal(state.due, null);
  assert.equal(compactStep(state, { type: 'timeout', due: 'settle' }).phase, 'expanded', 'a stale timer never collapses under a drag');
  state = compactStep(state, { type: 'blur' });
  assert.equal(state.phase, 'expanded', 'a drag outside the window keeps it');
  state = compactStep(state, pin('drag', false));
  assert.equal(state.due, 'grace');
  assert.equal(compactStep(state, { type: 'timeout', due: 'grace' }).phase, 'collapsed');
});

test('R4-14 window blur collapses after the grace unless a menu window took the focus', () => {
  const open = run({ type: 'address-key' }, pin('address', true), pin('pointer', true));
  const blurred = compactStep(open, { type: 'blur' });
  assert.equal(blurred.due, 'grace');
  assert.deepEqual(blurred.pins, [], 'blur lets the pointer and the field focus go');
  // Coming back re-focuses the field: it pins, but a collapsed row stays collapsed.
  assert.equal(compactStep(compactStep(blurred, { type: 'timeout', due: 'grace' }), pin('address', true)).phase, 'collapsed');
  assert.equal(compactStep(blurred, { type: 'timeout', due: 'grace' }).phase, 'collapsed');
  const menu = compactStep(run({ type: 'address-key' }, pin('popup', true)), { type: 'blur' });
  assert.equal(menu.due, null);
  assert.equal(menu.phase, 'expanded');
});

test('R4-14 leaving Compact resets without losing what is pinned; collapsed ignores timers', () => {
  const state = compactStep(run({ type: 'address-key' }, pin('address', true)), { type: 'reset' });
  assert.equal(state.phase, 'collapsed');
  assert.deepEqual(state.pins, ['address']);
  assert.equal(compactStep(compactRest, { type: 'timeout', due: 'grace' }), compactRest);
  assert.equal(compactStep(compactRest, { type: 'switch' }), compactRest);
});
