import assert from 'node:assert/strict';
import test from 'node:test';
import { holdPointer } from '../src/ui/dragPointer';

/** A stand-in for the strip element: it records capture and lets a test fire the browser's lostpointercapture. */
function fakeStrip() {
  const listeners = new Map<string, Set<(event: Event) => void>>(), captured = new Set<number>(), calls: string[] = [];
  return {
    calls, captured,
    addEventListener: (type: string, fn: (event: Event) => void) => { (listeners.get(type) ?? listeners.set(type, new Set()).get(type)!).add(fn); },
    removeEventListener: (type: string, fn: (event: Event) => void) => { listeners.get(type)?.delete(fn); },
    setPointerCapture: (id: number) => { calls.push(`set:${id}`); captured.add(id); },
    releasePointerCapture: (id: number) => { calls.push(`release:${id}`); captured.delete(id); },
    hasPointerCapture: (id: number) => captured.has(id),
    /** What Chromium does when the pointer's stream is dropped mid-drag (a reorder moved a node, native views re-laid out). */
    lose: (id: number) => { captured.delete(id); for (const fn of listeners.get('lostpointercapture') ?? []) fn({ pointerId: id } as unknown as Event); },
    listenerCount: () => [...listeners.values()].reduce((sum, set) => sum + set.size, 0),
  };
}

test('R3-22: the strip takes the pointer when the drag starts and keeps it through any number of lost captures', () => {
  const strip = fakeStrip(), release = holdPointer(strip as unknown as HTMLElement, 7);
  assert.ok(strip.captured.has(7), 'captured at drag start');
  for (let swap = 0; swap < 5; swap++) { strip.lose(7); assert.ok(strip.captured.has(7), `captured again after swap ${swap + 1}`); }
  release();
  assert.equal(strip.captured.size, 0, 'released when the drag ends');
  assert.equal(strip.listenerCount(), 0, 'no listener is left behind');
});

test('R3-22: a lost capture after the drag ended, or for another pointer, is not taken back', () => {
  const strip = fakeStrip(), release = holdPointer(strip as unknown as HTMLElement, 3);
  strip.lose(9);
  assert.deepEqual(strip.calls, ['set:3'], 'another pointer is left alone');
  release();
  strip.lose(3);
  assert.equal(strip.captured.has(3), false);
  release();
  assert.deepEqual(strip.calls, ['set:3', 'release:3'], 'releasing twice is harmless');
});

test('R3-22: a pointer that is no longer active, or a missing strip, never throws', () => {
  const dead = { ...fakeStrip(), setPointerCapture: () => { throw new DOMException('inactive', 'InvalidStateError'); } };
  assert.doesNotThrow(() => holdPointer(dead as unknown as HTMLElement, 1)());
  assert.doesNotThrow(() => holdPointer(null, 1)());
  assert.doesNotThrow(() => holdPointer(fakeStrip() as unknown as HTMLElement, Number.NaN)());
});
