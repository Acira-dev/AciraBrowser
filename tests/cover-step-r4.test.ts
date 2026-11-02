import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { coverEdges, coverPageTarget, coverReveal, coverSnap, fadeWidth } from '../src/features/onboarding/coverRow';

// R4-51: the setup cover step — a silky card row, a decoded crossfade, "Example" on every collection, "No image" as the real
// new tab without a picture.
const read = (file: string) => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const cover = read('src/features/onboarding/CoverStep.tsx');
const css = read('src/features/onboarding/onboarding.css');
const block = (selector: string) => {
  const at = css.indexOf('\n' + selector + ' {');
  assert.ok(at >= 0, selector + ' exists');
  return css.slice(at, css.indexOf('}', at));
};

// 8 cards of 96px with an 8px gap and the row's 4px padding, in a 560px-wide row.
const reach = 272; // 8 × 96 + 7 × 8 + 8 − 560
const points = [0, 104, 208, 312, 416, 520, 624, 728, reach];

test('the edge fades follow the distance left to scroll and vanish exactly at each end', () => {
  assert.deepEqual(coverEdges(0, reach), { start: false, end: true, fadeStart: 0, fadeEnd: fadeWidth.end });
  assert.deepEqual(coverEdges(reach, reach), { start: true, end: false, fadeStart: fadeWidth.start, fadeEnd: 0 });
  const near = coverEdges(reach - 10, reach);
  assert.equal(near.fadeEnd, 10, 'the far fade shrinks with the last pixels instead of switching off');
  assert.equal(coverEdges(20, reach).fadeStart, 20);
});

test('an arrow pages by about three quarters of the row, lands on a card edge and never overshoots an end', () => {
  const forward = coverPageTarget(points, 0, 1, 560, reach);
  assert.ok(points.includes(forward) || forward === reach, 'lands on a card edge or the end');
  assert.ok(forward > 0 && forward <= reach);
  assert.equal(coverPageTarget(points, reach, 1, 560, reach), reach, 'at the end it stays');
  assert.equal(coverPageTarget(points, forward, -1, 560, reach), 0, 'back to the start');
  assert.equal(coverPageTarget(points, 0, -1, 560, reach), 0);
  // A second click while the first glide flies continues from its target, one more page on.
  assert.equal(coverPageTarget(points, 104, 1, 560, reach), reach);
});

test('a resting wheel or touchpad settles on the nearest card edge; the ends stay put', () => {
  assert.equal(coverSnap(points, 100, reach), 104);
  assert.equal(coverSnap(points, 150, reach), 104);
  assert.equal(coverSnap(points, 0, reach), 0);
  assert.equal(coverSnap(points, reach, reach), reach);
});

test('revealing a card moves the row the least, clear of the fades, within the ends', () => {
  assert.equal(coverReveal(4, 96, 0, 560, reach), 0, 'the first card is already in view');
  assert.equal(coverReveal(212, 96, 0, 560, reach), 0, 'a card in the middle stays');
  const last = coverReveal(732, 96, 0, 560, reach);
  assert.equal(last, reach, 'the last card brings the row to its end');
  assert.equal(coverReveal(108, 96, 200, 560, reach), 108 - fadeWidth.start, 'a card under the start fade comes out of it');
});

test('the row glides on the house springs, snaps itself and keeps the native focus scroll from jumping it', () => {
  assert.match(cover, /springFlight\(/, 'one spring flight, retargeted with its velocity');
  assert.match(cover, /addEventListener\("wheel", wheel, \{ passive: false \}\)/, 'the wheel turns into a glide');
  assert.match(cover, /focus\(\{ preventScroll: true \}\)/, 'arrow keys move the selection without the native jump');
  assert.match(cover, /place\(known\.current, rowSign\(\)\)/, 'a focus scroll is undone before paint and glided instead');
  assert.doesNotMatch(block('.fr-cover-row'), /scroll-snap-type/, 'no CSS snapping fights the glide');
  assert.doesNotMatch(css, /scroll-snap-align/);
  assert.doesNotMatch(cover, /scrollIntoView/);
  assert.match(block('.fr-cover-more'), /opacity: 0/, 'the arrows fade instead of mounting');
  assert.doesNotMatch(cover, /\{edge\.(start|end) &&/);
});

test('the preview decodes the next picture first and crossfades over the old one', () => {
  assert.match(cover, /image\.decode\(\)/);
  assert.match(cover, /\{ duration: 0\.26, bounce: 0 \}/, 'about 260 ms on a damped spring');
  assert.match(cover, /fill: "backwards"/);
  assert.doesNotMatch(cover, /blur\(/, 'no blur pass on the swap');
});

test('every collection carries the Example badge (Paintings too); your own picture does not', () => {
  assert.match(cover, /const example = \(id: Pick\) => id !== "own" && id !== "none";/);
  assert.match(cover, /data-shown=\{example\(artPick\) \|\| undefined\}/);
});

test('No image is the new tab without a picture, reached by a transform-only morph', () => {
  assert.doesNotMatch(cover, /fr-cp-empty/);
  assert.doesNotMatch(css, /dashed/);
  assert.match(block('.fr-cp-page[data-none] .fr-cp-lift'), /translateY\(var\(--fr-cp-drop/);
  assert.match(block('.fr-cp-page[data-none] .fr-cp-art'), /opacity: 0;\s*transform: scale\(0\.94\)/);
  assert.match(cover, /--fr-cp-in-ms/);
  assert.match(cover, /reducedMotion \? 0 : motionScale\(cls\)/, 'Off and reduced motion are instant');
});

test('the skeleton breath stops when motion is off instead of strobing', () => {
  assert.match(css, /animation-duration: calc\(2\.4s \* max\(var\(--motion-scale, 1\), 1\)\)/);
  assert.match(css, /opacity: calc\(1 - 0\.45 \* min\(var\(--motion-scale, 1\), 1\)\)/);
});

test('the cover row gets keyboard focus back after the file chooser closes (its radios are disabled while it is open)', () => {
  assert.match(cover, /const focused = document\.activeElement;\n\s*setBusy\(true\);/);
  assert.match(cover, /setBusy\(false\);\n\s*requestAnimationFrame\(\(\) => \{ if \(focused instanceof HTMLElement && focused\.isConnected && document\.activeElement === document\.body\) focused\.focus\(\{ preventScroll: true \}\); \}\);/);
});
