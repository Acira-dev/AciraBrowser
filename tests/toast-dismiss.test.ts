import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createToastTimers, TOAST_RESUME_GRACE, type ToastClock } from '../src/ui/toastTimers';

// Toast.tsx imports its stylesheet; Node has no CSS loader, so a .css import loads as an empty module here.
register('data:text/javascript,' + encodeURIComponent("export async function load(url, context, next) { return url.endsWith('.css') ? { format: 'module', source: '', shortCircuit: true } : next(url, context); }"));
const { dismissOnEscape, ToastCard, toastLift, toastRowSize } = await import('../src/components/transient/Toast');

/** A clock the test moves by hand: timers fire only when `advance` passes their due time. */
function fakeClock() {
  let now = 0, serial = 0, hidden = false;
  const due = new Map<number, { at: number; run: () => void }>();
  const clock: ToastClock = {
    now: () => now,
    setTimeout: (run, ms) => { const id = ++serial; due.set(id, { at: now + ms, run }); return id; },
    clearTimeout: id => { due.delete(id as number); },
    hidden: () => hidden,
  };
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      const next = [...due.entries()].filter(([, entry]) => entry.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      now = next[1].at; due.delete(next[0]); next[1].run();
    }
    now = end;
  };
  return { clock, advance, hide: (value: boolean) => { hidden = value; } };
}

test('a toast leaves when its time is up', () => {
  const { clock, advance } = fakeClock(), gone: number[] = [];
  const timers = createToastTimers(key => gone.push(key), clock);
  timers.arm(1, 4000);
  advance(3999); assert.deepEqual(gone, []);
  advance(1); assert.deepEqual(gone, [1]);
  assert.equal(timers.left(1), undefined, 'an expired toast has no clock left');
});

test('hovering pauses every timer and leaving resumes each with the time it had left', () => {
  const { clock, advance } = fakeClock(), gone: number[] = [];
  const timers = createToastTimers(key => gone.push(key), clock);
  timers.arm(1, 8000); timers.arm(2, 4000);
  advance(1000);
  timers.hold(true);
  assert.equal(timers.running(1), false); assert.equal(timers.running(2), false);
  assert.equal(timers.left(1), 7000); assert.equal(timers.left(2), 3000);
  advance(60_000);
  assert.deepEqual(gone, [], 'nothing leaves while the pointer is on the stack');
  timers.hold(false);
  advance(2999); assert.deepEqual(gone, []);
  advance(1); assert.deepEqual(gone, [2]);
  advance(4000); assert.deepEqual(gone, [2, 1]);
});

test('a toast with almost no time left gets a grace after the pointer leaves', () => {
  const { clock, advance } = fakeClock(), gone: number[] = [];
  const timers = createToastTimers(key => gone.push(key), clock);
  timers.arm(1, 4000);
  advance(3900);
  timers.hold(true);
  assert.equal(timers.left(1), TOAST_RESUME_GRACE);
  timers.hold(false);
  advance(TOAST_RESUME_GRACE - 1); assert.deepEqual(gone, [], 'not gone the instant the pointer leaves');
  advance(1); assert.deepEqual(gone, [1]);
});

test('a toast raised while the stack is held waits for the release', () => {
  const { clock, advance } = fakeClock(), gone: number[] = [];
  const timers = createToastTimers(key => gone.push(key), clock);
  timers.hold(true);
  timers.arm(5, 4000);
  advance(10_000); assert.deepEqual(gone, []);
  timers.hold(false);
  advance(4000); assert.deepEqual(gone, [5]);
});

test('a hidden window pauses too, and a hold does not resume a hidden window', () => {
  const { clock, advance, hide } = fakeClock(), gone: number[] = [];
  const timers = createToastTimers(key => gone.push(key), clock);
  timers.arm(1, 4000);
  advance(1000); hide(true); timers.visibility();
  timers.hold(true); timers.hold(false);
  advance(20_000); assert.deepEqual(gone, [], 'still hidden');
  hide(false); timers.visibility();
  advance(3000); assert.deepEqual(gone, [1]);
});

test('dismissing from the × clears that toast alone; its old timer never fires', () => {
  const { clock, advance } = fakeClock(), gone: number[] = [];
  const timers = createToastTimers(key => gone.push(key), clock);
  timers.arm(1, 4000); timers.arm(2, 4000);
  timers.clear(1);
  advance(4000);
  assert.deepEqual(gone, [2]);
  timers.arm(3, 4000); timers.arm(3, 8000);
  advance(4000); assert.deepEqual(gone, [2], 're-arming replaces the old clock');
  advance(4000); assert.deepEqual(gone, [2, 3]);
});

test('the toast card shows its glyph and a Dismiss × in the same leading spot; actions stay', () => {
  const html = renderToStaticMarkup(createElement(ToastCard, { row: { key: 1, text: 'Link copied' }, onDismiss: () => {} }));
  assert.match(html, /^<div class="t-toast"[^>]*><span class="t-lead"><span class="t-glyph" aria-hidden="true"><svg[^>]*acira-check/);
  assert.match(html, /<button type="button" class="t-close" aria-label="Dismiss"><svg[^>]*acira-cross[^>]*width="16"/, 'same 16px drawing as the check');
  assert.ok(html.indexOf('t-close') < html.indexOf('t-text'), 'the × sits where the glyph is, before the text');
  assert.doesNotMatch(html, /t-dismiss/, 'no trailing × any more');
  const withAction = renderToStaticMarkup(createElement(ToastCard, { row: { key: 2, text: 'Tab closed', actionLabel: 'Undo' }, onDismiss: () => {}, action: createElement('button', { className: 'toast-action' }, 'Undo') }));
  assert.match(withAction, /t-close[\s\S]*t-text[\s\S]*toast-action">Undo/);
  const error = renderToStaticMarkup(createElement(ToastCard, { row: { key: 3, text: 'Failed', tone: 'error', dismissible: true }, onDismiss: () => {} }));
  assert.match(error, /role="alert"[\s\S]*acira-cross[\s\S]*class="t-close"/);
  assert.equal(toastRowSize({ key: 4, text: 'Failed', dismissible: true }).width, toastRowSize({ key: 4, text: 'Failed' }).width, 'the × takes no width of its own');
});

test('Esc dismisses the focused toast; other keys do nothing', () => {
  let dismissed = 0;
  const event = (key: string) => { const fake = { key, defaultPrevented: false, preventDefault: () => { fake.defaultPrevented = true; }, stopPropagation: () => {}, currentTarget: { closest: () => null } }; return fake; };
  dismissOnEscape(event('Enter') as never, () => dismissed++);
  assert.equal(dismissed, 0);
  const esc = event('Escape');
  dismissOnEscape(esc as never, () => dismissed++);
  assert.equal(dismissed, 1);
  assert.equal(esc.defaultPrevented, true, 'Esc goes no further (no popup or page closes with it)');
});

test('over a website the overlay forwards the dismiss for that toast, and an emptied stack lets go of its hold', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /const done = \(\) => void runtime\.browserCommand\(\{ type: 'ui', tabId: state\.activeTabId, action: 'toast-dismiss', \.\.\.\(row \? \{ toastId: row\.id \} : \{\}\) \}\); return <ToastCard row=\{model\} action=\{row && <ToastAction action=\{row\.action\} dispatch=\{dispatch\} onDone=\{done\}\/>\} onDismiss=\{done\}\/>/);
  assert.match(app, /if \(typeof event\.toastId === 'number'\) toastState\.dismissId\(event\.toastId\)/);
  assert.match(app, /if \(!list\.length && timers\.held\(\)\) hold\(false\)/);
});

test('a collapsed stack peeks every older card exactly 10px above the front one, whatever their heights', () => {
  const peek = 10;
  // Card tops, measured from the stack's bottom edge: a card of height h lifted by `lift` has its top at h + lift.
  const top = (heights: number[], index: number, front: number) => heights[index] + toastLift(heights, index, false, front);
  for (const heights of [[44, 44], [44, 60], [60, 44], [44, 60, 44], [60, 44, 60], [44, 44, 60], [60, 60, 44]]) {
    const front = heights[heights.length - 1];
    heights.forEach((_, index) => {
      const behind = heights.length - 1 - index;
      if (!behind) return;
      // A taller card behind is cropped to the front's height by the stack (clip), so its visible top is its top minus the crop.
      const crop = Math.max(0, heights[index] - front);
      assert.equal(top(heights, index, front) - crop, front + peek * behind, heights.join(',') + ' card ' + index);
    });
  }
  // The newest card never moves, and expanded cards still clear every newer card plus 8px gaps.
  assert.equal(toastLift([44, 60], 1, false, 60), 0);
  assert.equal(toastLift([44, 60, 44], 0, true, 44), 44 + 8 + 60 + 8);
});
