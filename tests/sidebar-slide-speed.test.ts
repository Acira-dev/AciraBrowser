import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { fastPace, motionPaceOf } from '../src/ui/motionTokens';

// The docked sidebar's slide (view-morph.css), the page card's group (sidebar.css), a page the interface draws (sharedMotion followPage)
// and the native page's glide (desktop/page-motion.cjs) are one spring of one length. The sidebar's was once scaled by --motion-scale
// (Premium, the default, is 1.7), so it ran 816 ms against the page's 480 and trailed it by up to a quarter of the travel, a darker band
// opening between them (sidebar-hunt, 1 Nov). Premium never stretches them; Fast quickens all four together by --motion-pace (2 Nov).
const here = path.dirname(fileURLToPath(import.meta.url)), read = (file: string) => fs.readFileSync(path.join(here, '..', file), 'utf8');
const require = createRequire(import.meta.url);
const { placePageBounds, layoutPace, FAST_PACE } = require('../desktop/page-motion.cjs');
const paced = 'calc(480ms * var(--motion-pace, 1))';

test('the docked sidebar, the page card and a drawn page glide on one 480 ms spring times --motion-pace, never --motion-scale', () => {
  const morph = read('src/styles/view-morph.css'), sidebar = read('src/components/sidebar/sidebar.css'), shared = read('src/ui/sharedMotion.ts');
  const slide = /view-transition-(old|new)\(acira-sidebar\):only-child\{animation:(calc\([^)]*\)\)|[^ ]+) /g;
  for (const css of [morph, sidebar]) {
    const durations = [...css.matchAll(slide)].map(match => match[2]);
    assert.equal(durations.length, 2, 'a leave and an arrive');
    assert.ok(durations.every(duration => duration === paced), `480ms at the speed's pace, got ${durations.join(' / ')}`);
  }
  assert.ok(sidebar.includes(`view-transition-group(acira-toolbar){animation-duration:${paced};`), 'the toolbar row glides with it');
  assert.ok(sidebar.includes(`view-transition-group(acira-page-content){animation-duration:${paced};`), 'the page card group too');
  assert.match(shared, /const PAGE_GLIDE_MS = 480;/);
  assert.match(shared, /content\.animate\(\[from, to\], \{ duration: PAGE_GLIDE_MS \* motionPace\(\), easing: PAGE_SPRING/, 'and a page the interface draws');
  assert.doesNotMatch(morph + sidebar, /acira-(sidebar|toolbar|page)[^{]*\{animation(-duration)?:[^;}]*--motion-scale/, 'Premium never stretches the glide');
});

test('the pace: 1 at Premium and Off, .5 in Fast (half of Premium); main reads it from the layout\'s motion speed', () => {
  assert.deepEqual([motionPaceOf('premium'), motionPaceOf('fast'), motionPaceOf('off')], [1, .5, 1]);
  assert.equal(FAST_PACE, fastPace, 'main\'s copy of Fast\'s pace is the interface\'s');
  // The interface sends motionSpeed = 1 / --motion-scale (App.tsx); Off sends 1.
  for (const [speed, scale] of [['premium', 1.7], ['fast', .6]] as const) assert.ok(Math.abs(layoutPace(1 / scale) - motionPaceOf(speed)) < 1e-9, speed);
  assert.equal(layoutPace(1), 1); assert.equal(layoutPace(undefined), 1); assert.equal(layoutPace('nonsense'), 1);
  assert.match(read('desktop/main.cjs'), /placePageBounds\(entry,bounds,animated,[^;]*,layoutPace\(next\.motionSpeed\),next\.pageEdgeLag\);/);
});

/** Drives placePageBounds frame by frame (60 Hz) and returns when its last frame ran (ms) and where the page was halfway through. */
function glideMs(pace?: number) {
  let now = 0, queued: (() => void) | null = null, last = 0, half = NaN;
  const view = { bounds: { x: 0, y: 36, width: 1280, height: 764 } as Record<string, number>, getBounds() { return { ...this.bounds }; }, setBounds(next: Record<string, number>) { this.bounds = { ...next }; }, setBorderRadius() {} };
  const clock = { now: () => now, later: (fn: () => void) => { queued = fn; return 1; }, cancel: () => { queued = null; } };
  placePageBounds({ view }, { x: 240, y: 36, width: 1280, height: 764 }, true, clock, 1000 / 60, 'slide', undefined, undefined, false, pace);
  const series: [number, number][] = [];
  for (let i = 0; i < 400 && queued; i++) { now += 1000 / 60; const fn = queued; queued = null; (fn as () => void)(); last = now; series.push([now, view.bounds.x]); if (Number.isNaN(half) && now >= (pace ?? 1) * 240) half = view.bounds.x; }
  assert.deepEqual(view.bounds, { x: 240, y: 36, width: 1280, height: 764 });
  /** Where the page was `ms` into the glide, between two frames (a glide of 240 ms has 14 of them: a frame is 7% of it). */
  const xAt = (ms: number) => { for (let i = 1; i < series.length; i++) if (series[i][0] >= ms) { const [t0, x0] = series[i - 1], [t1, x1] = series[i]; return x0 + (x1 - x0) * (ms - t0) / (t1 - t0); } return series[series.length - 1][1]; };
  return { last, half, xAt };
}

test('the native page lands with the sidebar: 480 ms at Premium, 240 ms in Fast', () => {
  const premium = glideMs(1), fast = glideMs(.5), unset = glideMs();
  assert.ok(premium.last >= 480 && premium.last < 480 + 17, `Premium ends at ${premium.last}`);
  assert.ok(fast.last >= 240 && fast.last < 240 + 17, `Fast ends at ${fast.last}`);
  // The same curve, quicker: halfway through its own length each is about 90% of the way (the spring's sample at .5 is .9083). Premium's
  // frame at 60 Hz is 3% of its glide, Fast's 7%, so Fast is read between its frames.
  for (const [name, run, ms] of [['Premium', premium, 240], ['Fast', fast, 120]] as const) { const at = run.xAt(ms); assert.ok(at > 240 * .85 && at < 240 * .96, `${name} halfway at ${at}`); }
  for (const f of [.25, .5, .75]) assert.ok(Math.abs(fast.xAt(f * 240) - premium.xAt(f * 480)) < 4, `the same curve at ${f * 100}% of the length`);
  assert.deepEqual([unset.last, unset.half], [premium.last, premium.half], 'without a pace, the Premium length');
});
