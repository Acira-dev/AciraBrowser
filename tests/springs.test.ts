import test from 'node:test';
import assert from 'node:assert/strict';
import { springAt, springEasing, springExit, springFlight, springFromResponse, springParams, springPeak, springSettle, springs } from '../src/ui/springs';
import { animationSpeedOf, motionScaleOf, motionScales } from '../src/ui/sharedMotion';
import { classScales, kick, motionTokens, springFor } from '../src/ui/motionTokens';

test('a spring starts at its origin and ends at its target', () => {
  for (const spec of Object.values(springs)) {
    assert.equal(springAt(spec, 0, 1, 0).value, 0);
    assert.ok(Math.abs(springAt(spec, 0, 1, 5).value - 1) < 1e-4, JSON.stringify(spec));
    assert.ok(Math.abs(springAt(spec, 20, -10, 5).value + 10) < 1e-3);
  }
});

test('SwiftUI conversion: stiffness (2π/d)², damping (4π/d)(1 − bounce)', () => {
  const { stiffness, damping } = springParams({ duration: .5, bounce: .3 });
  assert.ok(Math.abs(stiffness - 157.9) < .1, String(stiffness)); // Apple's documented example
  assert.ok(Math.abs(damping - 17.6) < .1, String(damping));
});

test('critically damped springs never overshoot; slight-bounce springs overshoot by a few percent at most', () => {
  for (const name of ['smooth', 'settle', 'quick'] as const) assert.ok(springPeak(springs[name]) < 1.0005, name);
  const morph = springPeak(springs.morph);
  assert.ok(morph > 1.005 && morph < 1.04, `morph overshoots ${(morph - 1) * 100}%`);
  assert.ok(springPeak(springs.bouncy) > 1.03);
});

test('velocity is continuous: a retargeted spring carries on from where it was', () => {
  const spec = springs.morph, first = springAt(spec, 0, 1, .12), carried = springAt(spec, first.value, 2, 0, first.velocity);
  assert.equal(carried.value, first.value);
  assert.equal(carried.velocity, first.velocity);
  const dt = 1e-4, after = springAt(spec, first.value, 2, dt, first.velocity).value;
  assert.ok(Math.abs((after - first.value) / dt - first.velocity) < 1, 'the first instant moves at the incoming velocity');
});

test('settle time grows with the duration and stays short enough for UI', () => {
  assert.ok(springSettle(springs.settle) < .6);
  assert.ok(springSettle({ duration: .64, bounce: 0 }) > springSettle({ duration: .32, bounce: 0 }) * 1.9);
});

test('springEasing makes a CSS linear() curve that ends exactly at 1, stretched by the speed scale', () => {
  const fast = springEasing(springs.settle, 1), premium = springEasing(springs.settle, motionScales.premium);
  assert.match(fast.easing, /^linear\(0, /);
  assert.ok(fast.easing.endsWith(', 1)'));
  const stops = fast.easing.slice(7, -1).split(', ');
  assert.ok(stops.length >= 40);
  const percents = stops.map(stop => stop.split(' ')[1]).filter(Boolean).map(p => parseFloat(p));
  assert.ok(percents.every((p, i) => i === 0 || p >= percents[i - 1]), 'input positions never go backwards');
  assert.ok(premium.duration > fast.duration * 1.6 && premium.duration < fast.duration * 1.8);
  assert.deepEqual(springEasing(springs.settle, 0), { duration: 0, easing: 'linear', peak: 1 });
  assert.equal(springEasing(springs.settle, 1), fast, 'cached');
});

test('the animation-speed setting: Premium by default, Fast, and Off which reduced motion forces', () => {
  assert.equal(animationSpeedOf({}), 'premium');
  assert.equal(animationSpeedOf(undefined), 'premium');
  assert.equal(animationSpeedOf({ animationSpeed: 'fast' }), 'fast');
  assert.equal(animationSpeedOf({ animationSpeed: 'fast', reducedMotion: true }), 'off');
  assert.equal(animationSpeedOf({ animationSpeed: 'premium', reducedMotion: true }), 'off');
  assert.equal(animationSpeedOf({ animationSpeed: 'nonsense' }), 'premium');
  assert.deepEqual([motionScaleOf({}), motionScaleOf({ animationSpeed: 'fast' }), motionScaleOf({ reducedMotion: true })], [1.7, 1, 0]);
});

test('response and damping ratio map to duration and bounce; exits are critically damped and shorter', () => {
  const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);
  near(springFromResponse(.5, .7).bounce, .3);
  assert.equal(springFromResponse(.5, .7).duration, .5);
  assert.equal(springFromResponse(.3, 1.4).bounce, 0);
  const exit = springExit(springs.morph);
  assert.equal(exit.bounce, 0);
  assert.ok(exit.duration < springs.morph.duration * .75);
});

test('a spring in flight reports where it is and retargets with its velocity', () => {
  const flight = springFlight(springs.morph, 0, 100, 0, 1), mid = flight.at(120);
  assert.ok(mid.value > 20 && mid.value < 100 && mid.velocity > 0);
  const next = flight.retarget(40, 120), start = next.at(120);
  assert.equal(start.value, mid.value);
  assert.equal(start.velocity, mid.velocity);
  assert.ok(Math.abs(next.at(120 + 900).value - 40) < 1);
  assert.ok(flight.done(2000) && !flight.done(100));
});

test('motion tokens reproduce the research tables: Fast d, Premium S ×1.7 / E ×1.4 / L ×1 rounded to 5 ms, Off none', () => {
  const ms = (id: Parameters<typeof springFor>[0], speed: 'fast' | 'premium') => Math.round(springFor(id, speed)!.duration * 1000);
  assert.deepEqual(['menu.grow', 'menu.content', 'menu.shrink', 'menu.fade', 'popover.grow', 'toast.in', 'toast.out', 'toast.stack', 'island.expand', 'island.content', 'reorder.move', 'materialize'].map(id => ms(id as any, 'fast')), [170, 130, 115, 85, 210, 310, 150, 225, 295, 150, 150, 170]);
  assert.deepEqual(['menu.grow', 'menu.content', 'menu.shrink', 'menu.fade', 'popover.grow', 'toast.in', 'toast.out', 'toast.stack', 'island.expand', 'island.content', 'reorder.move', 'materialize'].map(id => ms(id as any, 'premium')), [290, 180, 195, 120, 355, 525, 255, 385, 500, 210, 255, 240]);
  for (const id of ['drag.follow', 'press.down', 'press.up', 'hover.lift'] as const) assert.equal(ms(id, 'premium'), ms(id, 'fast'), `${id} (L) is never slowed`);
  assert.equal(springFor('menu.grow', 'off'), null);
  assert.equal(springFor('toast.in', 'fast')!.bounce, .12);
  assert.equal(classScales.premium.E, 1.4);
  assert.ok(kick.premium > kick.fast && kick.off === 0);
  for (const [id, [cls, , bounce]] of Object.entries(motionTokens)) if (cls === 'E') assert.equal(bounce, 0, `${id}: effects never bounce`);
});

test('a spring that arrives with velocity gives a different curve than one from rest', () => {
  const rest = springEasing(springs.settle, 1), moving = springEasing(springs.settle, 1, 30);
  assert.notEqual(rest.easing, moving.easing);
  assert.ok(moving.peak > rest.peak, 'a moving start overshoots a critically damped target');
  assert.deepEqual(springEasing(springs.settle, 0, 30), { duration: 0, easing: 'linear', peak: 1 });
});
