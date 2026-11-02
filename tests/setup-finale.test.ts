import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FINALE, QUIET, SKIP_GRACE, deliberateSkip, finaleSchedule, finaleTimeline } from '../src/features/onboarding/finale';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');
const finale = read('src/features/onboarding/finale.ts');
const css = read('src/features/onboarding/onboarding.css');
const onboarding = read('src/features/onboarding/Onboarding.tsx');
const renderer = read('src/features/onboarding/prismRenderer.ts');
const block = css.slice(css.indexOf('/* ── Leaving: the mark, in glass'), css.indexOf('/* ── Reduced motion, small windows'));

test('the moment fits the budget the founder set: ≤ 2.2 s at Premium, ≤ 1.4 s at Fast, every phase a spring', () => {
  const premium = finaleTimeline('premium'), fast = finaleTimeline('fast');
  assert.ok(premium.total <= 2200, `Premium ${premium.total}`);
  assert.ok(fast.total <= 1400, `Fast ${fast.total}`);
  // Draw, hold, retreat, bloom, in that order; the retreat is the drawing reversed (the second stripe goes first).
  assert.ok(premium.draw >= 650 && premium.draw <= 1000, `draw ${premium.draw}`);
  assert.equal(premium.retreatAt, premium.enter + premium.draw + premium.hold);
  assert.ok(premium.bloomAt > premium.retreatAt && premium.bloomAt < premium.retreatAt + premium.retreat, 'the light blooms as the retreat ends');
  // Springs from the shared system (APPLE_MORPH_RESEARCH), never linear: linear() easings sampled from a spring.
  for (const spring of [premium.drawSpring, premium.retractSpring, premium.bloomSpring]) assert.match(spring.easing, /^linear\(0, /);
  assert.match(finale, /backAt = retreatAt \+ retreatGap \* \(stripes\.length - 1 - i\)/);
});

test('the un-draw is the draw run backwards: it gathers speed and pulls into the point, never crawls a tail', () => {
  const { retractSpring } = finaleTimeline('premium');
  const points = /^linear\((.*)\)$/.exec(retractSpring.easing)![1].split(',').map((stop, i, all) => {
    const [v, at] = stop.trim().split(/\s+/);
    return { x: at ? parseFloat(at) / 100 : i === 0 ? 0 : 1, y: +v };
  });
  points.forEach((p, i) => i && assert.ok(p.x >= points[i - 1].x && p.y >= points[i - 1].y - 1e-6, 'monotonic'));
  // Progress over the first and the last fifth of the time: most of the path is covered at the end.
  const at = (x: number) => { const i = points.findIndex((p) => p.x >= x); const a = points[i - 1] ?? points[0], b = points[i]; return a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x || 1); };
  assert.ok(1 - at(0.8) > 4 * at(0.2), `arrives fast, starts gently (${at(0.2).toFixed(3)} / ${(1 - at(0.8)).toFixed(3)})`);
  assert.ok(points[1].y > 0, 'starts moving at once (the dead tail is trimmed)');
  // The frost clears on the same curve, over the retreat and the bloom, so it reaches the corners as the light goes.
  assert.match(finale, /const clear = \{ duration: clearFor, easing: t\.retractSpring\.easing \}/);
});

test('the mark is the real logo, its two stripes drawn out one after the other as Liquid Glass', () => {
  // Geometry from the 2026 logo pipeline's own symbol file, split into its stripes; never a redrawn copy.
  assert.match(finale, /fetch\("\.\/acira-symbol\.svg"\)/);
  assert.match(finale, /\.split\(\/\(\?=M\)\/\)/);
  // Glass: a lens that bends the frost (displacement), a body, an inner edge, a lit rim with a specular tip, a caustic.
  for (const part of ['fr-glass-lens', 'fr-glass-body', 'fr-glass-rim', 'fr-glass-tip', 'fr-glass-caustic', 'fr-glass-spark']) assert.ok(finale.includes(`class="${part}"`), part);
  assert.match(finale, /feDisplacementMap/);
  assert.ok(FINALE.stagger > 0 && FINALE.stagger < 1, 'the second stripe starts while the first is still drawing');
  assert.match(onboarding, /mark: true/);
});

test('the browser never zooms: it is there behind a frosted veil that opens from the centre outward', () => {
  assert.match(block, /::view-transition-group\(root\)\s*\{\s*animation: none;/);
  assert.match(block, /::view-transition-new\(root\)\s*\{\s*animation: none;/);
  assert.doesNotMatch(block + finale, /fr-arrive-window/);
  // A constant blur; what moves is a radial mask opening from the centre (and a last fade), never the blur radius.
  assert.match(block, /\.fr-finale-veil\s*\{[^}]*backdrop-filter: blur\(24px\) saturate\(1\.25\);/);
  assert.match(block, /mask-image: radial-gradient\(circle farthest-corner at 50% 50%, transparent var\(--fr-veil-open\)/);
  assert.match(finale, /"--fr-veil-open": "-30%"/);
  assert.match(finale, /registerProperty/);
});

test('the setup leaves in one view transition on transform and opacity only, never blur or filter', () => {
  assert.match(finale, /startViewTransition/);
  const keyframes = [...block.matchAll(/@keyframes fr-finale-[\w-]+\s*\{([\s\S]*?)\n\}/g)].map((match) => match[1]);
  assert.ok(keyframes.length >= 3);
  for (const body of keyframes)
    for (const property of body.matchAll(/([a-z-]+)\s*:/g)) assert.ok(['transform', 'opacity'].includes(property[1]), property[1]);
  // Only the setup images are named while it runs, so the browser's own named parts stay in the browser frame.
  const names = /:root:is\(\[data-fr-finale\], \[data-fr-prewarm\], \[data-fr-switch\]\) \.app :is\(([^)]*)\),\s*\.app:has\(> \.setup-dialog\) :is\(\1\)\s*\{\s*view-transition-name: none !important;/.exec(css);
  assert.ok(names, 'named browser parts are unnamed while it runs');
  const unnamed = names[1].split(',').map((name) => name.trim().slice(1));
  for (const file of ['src/components/sidebar/sidebar.css', 'src/styles/toolbar-controls.css'])
    for (const rule of read(file).matchAll(/([^{}]+)\{[^}]*view-transition-name:\s*[a-z-]+/g))
      assert.ok(unnamed.some((name) => rule[1].includes(`.${name}`)), `${file}: ${rule[1].trim()}`);
  // Starting it never restyles the document: no universal rules, no custom properties on :root.
  assert.doesNotMatch(block, /\.app \*/);
  assert.doesNotMatch(finale, /root\.style\.setProperty/);
});

test('it uses the shared motion system; reduced motion or Off still end on the mark, quietly (R4-18)', () => {
  assert.match(finale, /from "\.\.\/\.\.\/ui\/sharedMotion"/);
  assert.match(finale, /springFor\("materialize", speed\)/);
  assert.match(finale, /reduced \|\| speed === "off"/);
  assert.match(finale, /function fade\(/);
  // Not nothing: the drawn mark in glass fades in over a frosted veil, rests and fades away; opacity only.
  assert.match(finale, /fade\(app, stage\);\s*start\(\);\s*quietMark\(tone, withMark, arrive\);/);
  assert.ok(QUIET.in >= 150 && QUIET.hold >= 400 && QUIET.in + QUIET.hold + QUIET.out <= 1400, JSON.stringify(QUIET));
  assert.match(css, /\.fr-finale-veil\.fr-finale-quiet \+ \.fr-finale-mark \.fr-glass-lens\s*\{\s*opacity: 1;/);
});

test('any deliberate click or key lands it, the click only skips, and keys still reach the browser', () => {
  assert.match(finale, /addEventListener\("pointerdown", skipPointer, true\)/);
  assert.match(finale, /addEventListener\("keydown", skipKey, true\)/);
  assert.match(finale, /stopImmediatePropagation/);
  assert.match(finale, /if \(deliberateSkip\("key", performance\.now\(\) - clicked, event\)\) hurry\(\);/);
});

test('R4-18: nothing accidental can cancel the moment before it is seen', () => {
  // A wheel never skips: a touchpad's scrolling momentum from the last card keeps sending wheel events.
  assert.equal(deliberateSkip('wheel', 5000), false);
  assert.doesNotMatch(finale, /addEventListener\("wheel"/);
  // The second press of a double click, or a key bounce, right after the click that started it: swallowed, no skip.
  assert.equal(deliberateSkip('pointer', 120), false);
  assert.equal(deliberateSkip('key', 200, { key: 'Enter' }), false);
  // A held key's auto-repeat and lone modifiers never skip.
  assert.equal(deliberateSkip('key', 900, { key: 'Enter', repeat: true }), false);
  for (const key of ['Shift', 'Control', 'Alt', 'Meta']) assert.equal(deliberateSkip('key', 900, { key }), false, key);
  // A real click or key once the moment is under way lands it.
  assert.equal(deliberateSkip('pointer', SKIP_GRACE + 1), true);
  assert.equal(deliberateSkip('key', 900, { key: 'Escape' }), true);
});

test('R4-18: the moment runs on its own clock from its first frame, so a late first frame never cuts it', () => {
  const t = finaleTimeline('premium');
  const plan = finaleSchedule(t, t.clearAt, t.total - t.clearAt);
  assert.ok(plan.end >= t.total && plan.arrive < plan.end, JSON.stringify(plan));
  // Timers are armed when the view transition is ready (its first frame), not at the click.
  assert.match(finale, /view\.ready\.then\(\s*\(\) => \{\s*\/\/[^\n]*\n\s*requestAnimationFrame\(\(\) => \{\s*clock\(\);/);
  assert.doesNotMatch(finale, /timers\.push\(window\.setTimeout\(end, Math\.max\(t\.total/);
  // A theme crossfade still running is taken over, never a reason for the quiet fade.
  assert.doesNotMatch(finale, /hasAttribute\("data-fr-switch"\)\) \{\s*fade/);
  assert.match(finale, /root\.removeAttribute\("data-fr-switch"\)/);
  // Skip setup ends on the mark too: the short version (the Fast timeline).
  assert.match(onboarding, /playFinale\(stageRef\.current, \{ reduced: reducedMotion, onStart: close, onArrive: offerUndo, mark: true, short: true \}\)/);
  assert.match(finale, /finaleTimeline\(short && speed === "premium" \? "fast" : speed\)/);
  assert.ok(finaleTimeline('fast').total < t.total);
});

test('setup closes once the motion runs, Make it yours enters as the browser clears, no fixed timers', () => {
  assert.match(onboarding, /playFinale\(stageRef\.current, \{[\s\S]*?onStart: close,[\s\S]*?onArrive: defaults \? offerUndo : \(\) => showMakeItYours/);
  assert.doesNotMatch(onboarding, /setTimeout\(\(\) => showMakeItYours/);
  assert.doesNotMatch(onboarding, /function evaporate/);
});

test('the old bloom is gone, so nothing plays a second transition', () => {
  assert.doesNotMatch(renderer, /finale|flare|sweep/);
});

test('the browser is laid out and rastered under the last card before setup leaves (prewarm), invisibly', () => {
  assert.match(onboarding, /data-prewarm=\{prewarm \|\| undefined\}/);
  assert.match(css, /\.fr-stage\[data-prewarm\]\s*\{\s*opacity: 0\.998;/);
  assert.match(css, /\.app\.style-acira:not\(\.native-layer\):has\(> \.setup-dialog\) > \.browser-root\s*\{\s*grid-column: 2;/);
  assert.match(onboarding, /prewarmFinale\(stageRef\.current\)/);
  assert.match(finale, /export function prewarmFinale/);
});
