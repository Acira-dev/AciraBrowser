import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

/** A light/dark (or any appearance) switch is one crossfade of the frame (ui/sharedMotion startModeTransition). It used the glide curve
 * (expo-out), which puts three quarters of the change into its first frame: the selected tab, the largest surface that changes the
 * most (white to dark), went 249 → 98 in one frame (249 → 60 → 44 at a coarser sampling) after the frame around it had already dimmed.
 * The appearance crossfade now eases in and out; durations are untouched (they belong to the motion-speed work). */
const css = readFileSync(new URL('../src/styles/transient.css', import.meta.url), 'utf8');

const bezier = (x1: number, y1: number, x2: number, y2: number) => (t: number) => {
  let lo = 0, hi = 1;
  for (let i = 0; i < 60; i++) { const s = (lo + hi) / 2, x = 3 * (1 - s) ** 2 * s * x1 + 3 * (1 - s) * s * s * x2 + s ** 3; if (x < t) lo = s; else hi = s; }
  const s = (lo + hi) / 2;
  return 3 * (1 - s) ** 2 * s * y1 + 3 * (1 - s) * s * s * y2 + s ** 3;
};
const curves: Record<string, (t: number) => number> = { ease: bezier(.25, .1, .25, 1), 'cubic-bezier(.16, 1, .3, 1)': bezier(.16, 1, .3, 1) };
/** The largest share of the whole change that lands in one of `frames` equal steps. */
const largestStep = (curve: (t: number) => number, frames = 12) => Math.max(...Array.from({ length: frames }, (_, i) => curve((i + 1) / frames) - curve(i / frames)));

test('Appearance crossfade: its own curve, after the shared crossfade rule, on the root and on every named group\'s images, and no duration of its own', () => {
  const shared = css.indexOf(':root[data-mode-switch]::view-transition-old(root),');
  const rule = /:root\[data-mode-switch='appearance'\]::view-transition-old\(root\),\s*:root\[data-mode-switch='appearance'\]::view-transition-new\(root\),\s*:root\[data-mode-switch='appearance'\]::view-transition-old\(\*\),\s*:root\[data-mode-switch='appearance'\]::view-transition-new\(\*\) \{([^}]*)\}/.exec(css);
  assert.ok(shared >= 0 && rule, 'both rules are there');
  assert.ok(rule!.index > shared, 'the appearance rule comes later: same specificity on the root images, so it wins there');
  assert.equal(rule![1].trim(), 'animation-timing-function: ease;');
  assert.match(css.slice(shared, rule!.index), /animation-duration: calc\(240ms \* var\(--motion-scale, 1\)\);\s*animation-timing-function: cubic-bezier\(\.16, 1, \.3, 1\);/, 'the shared rule still owns the duration (and the glide curve for layout switches)');
});

test('Appearance crossfade: no frame carries a jump (at most a fifth of the change in any twelfth of the time); the glide curve put over 40% in its first', () => {
  const glide = curves['cubic-bezier(.16, 1, .3, 1)'], ease = curves.ease;
  assert.ok(glide(1 / 12) > .4, `the old curve: ${glide(1 / 12).toFixed(2)} of the change in the first twelfth`);
  assert.ok(largestStep(ease) <= .2, `ease: largest step ${largestStep(ease).toFixed(3)}`);
  assert.ok(ease(1 / 12) < .1, 'and it starts gently, so a white tab does not snap dark on the first frame');
});
