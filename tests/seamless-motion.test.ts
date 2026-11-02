import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { springAt, springPeak, springSettle } from '../src/ui/springs';
import { motionTokens, springFor } from '../src/ui/motionTokens';

const require = createRequire(import.meta.url);
const { placePageBounds, springAt: nativeSpringAt, springSettle: nativeSpringSettle } = require('../desktop/page-motion.cjs');

// R3-68 section 5: the reveal is stiffness 400 / damping 33 (zeta .83, about +1% overshoot), the hide stiffness 1330 / damping 73
// (critically damped, about two thirds as long); the speed setting stretches both; Off has no travel.
test('the Seamless springs are the spec\'s: +1% overshoot on the way in, none on the way out, the way out two thirds as long', () => {
  const reveal = springFor('seamless.reveal', 'fast')!, hide = springFor('seamless.hide', 'fast')!;
  assert.equal(motionTokens['seamless.reveal'][0], 'S');
  const stiffness = (spring: { duration: number }) => Math.round((2 * Math.PI / spring.duration) ** 2), damping = (spring: { duration: number; bounce: number }) => (4 * Math.PI / spring.duration) * (1 - spring.bounce);
  assert.ok(Math.abs(stiffness(reveal) - 400) <= 3, `reveal stiffness ${stiffness(reveal)}`);
  assert.ok(Math.abs(damping(reveal) - 33) <= .5, `reveal damping ${damping(reveal)}`);
  assert.ok(Math.abs(stiffness(hide) - 1330) <= 40, `hide stiffness ${stiffness(hide)}`);
  assert.ok(Math.abs(damping(hide) - 73) <= 1.2, `hide damping ${damping(hide)}`);
  const peak = springPeak(reveal);
  assert.ok(peak > 1.008 && peak < 1.013, `reveal overshoots ${((peak - 1) * 100).toFixed(2)}%`);
  assert.equal(springPeak(hide), 1);
  const inMs = springSettle(reveal, .02) * 1000, outMs = springSettle(hide, .02) * 1000;
  assert.ok(inMs > 180 && inMs < 260, `reveal settles in ${inMs}ms`);
  assert.ok(outMs > 145 && outMs < 175, `hide settles in ${outMs}ms`);
  assert.ok(outMs / inMs > .6 && outMs / inMs < .9, 'the way out is about two thirds of the way in');
});

test('the speed setting stretches the spring (Premium x1.7, Fast x1) and Off has none (opacity only)', () => {
  const fast = springFor('seamless.reveal', 'fast')!, premium = springFor('seamless.reveal', 'premium')!;
  assert.ok(Math.abs(premium.duration / fast.duration - 1.7) < .01);
  assert.equal(premium.bounce, fast.bounce, 'the shape stays, only the time stretches');
  assert.equal(springFor('seamless.reveal', 'off'), null);
  assert.equal(springFor('seamless.hide', 'off'), null);
});

test('main\'s copy of the spring gives the native page exactly the curve the interface draws', () => {
  for (const spec of [springFor('seamless.reveal', 'fast')!, springFor('seamless.reveal', 'premium')!, springFor('seamless.hide', 'fast')!, { duration: .5, bounce: .15 }]) {
    for (const t of [0, .01, .05, .1, .2, .35, .6, 1]) assert.ok(Math.abs(springAt(spec, 0, 1, t).value - nativeSpringAt(spec, t)) < 1e-9, `t=${t}`);
    assert.ok(Math.abs(springSettle(spec) - nativeSpringSettle(spec)) < 1e-9);
  }
});

function glide(start: object, target: object, spring?: { duration: number; bounce: number }) {
  let now = 0, queued: (() => void) | null = null;
  const tops: number[] = [], sizes: string[] = [], bottoms: number[] = [];
  const view = { bounds: { ...start } as Record<string, number>, getBounds() { return { ...this.bounds }; }, setBounds(next: Record<string, number>) { this.bounds = { ...next }; tops.push(next.y); bottoms.push(next.y + next.height); sizes.push(`${next.width}x${next.height}`); }, webContents: { isDestroyed: () => false } };
  const clock = { now: () => now, later: (fn: () => void) => { queued = fn; return 1; }, cancel: () => { queued = null; } };
  placePageBounds({ view }, target, true, clock, 1000 / 60, 'slide', spring);
  for (let i = 0; i < 400 && queued; i++) { now += 1000 / 60; const fn = queued; queued = null; (fn as () => void)(); }
  return { view, tops, bottoms, sizes: [...new Set(sizes)], frames: tops.length };
}

test('a pinned toolbar takes the page down on the spring, one viewport per frame, its bottom edge never moving (R6: no frosted atomic resize)', () => {
  const { view, bottoms, sizes, frames } = glide({ x: 0, y: 0, width: 1440, height: 900 }, { x: 0, y: 72, width: 1440, height: 828 }, springFor('seamless.reveal', 'premium')!);
  assert.deepEqual(view.bounds, { x: 0, y: 72, width: 1440, height: 828 });
  assert.ok(frames > 20 && sizes.length > 10, 'the site lays out live at many heights on the way');
  assert.ok(bottoms.every(bottom => bottom === 900), 'the bottom edge stays on the window edge');
});

test('the toolbar hiding lifts the page on the critically damped spring: no overshoot, growing to full height with it', () => {
  const { view, tops, bottoms, sizes } = glide({ x: 0, y: 72, width: 1440, height: 828 }, { x: 0, y: 0, width: 1440, height: 900 }, springFor('seamless.hide', 'fast')!);
  assert.deepEqual(view.bounds, { x: 0, y: 0, width: 1440, height: 900 });
  assert.ok(sizes.length > 10, 'the site lays out live at many heights on the way');
  assert.ok(bottoms.every(bottom => bottom === 900), 'the bottom edge stays on the window edge');
  assert.ok(Math.min(...tops) >= 0, 'never above the window');
  for (let i = 1; i < tops.length; i++) assert.ok(tops[i] <= tops[i - 1], 'no step back');
});

test('a floating slide without its own spring keeps the sidebar\'s 480ms curve', () => {
  const { frames, view } = glide({ x: 0, y: 36, width: 1280, height: 764 }, { x: 240, y: 36, width: 1280, height: 764 });
  assert.deepEqual(view.bounds, { x: 240, y: 36, width: 1280, height: 764 });
  assert.ok(frames > 20, `${frames} position steps over 480ms`);
});
