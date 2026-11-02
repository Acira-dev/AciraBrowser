import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { chipPose, createSim, liquidDistance, mergeAmount, liquidGeometry, liquidSprings, nearestOn, neckField, neckParams, neckRadius, parseColor, pickTarget, simStep, smin, stepSpring, strongest, tension, type LiquidTarget, type Pt } from '../src/ui/liquidSnap';
import { motionTokens } from '../src/ui/motionTokens';

const zone: LiquidTarget = { key: 'zone', box: { left: 100, top: 10, right: 160, bottom: 50 }, radius: 3, owned: true };
const springs = liquidSprings(1);
/** Drive the simulation along pointer positions (one per 60 Hz frame) and collect what happened. */
function run(sim = createSim(), points: Pt[], targets = [zone], dt = 1 / 60) {
  const events: string[] = [];
  for (const p of points) { const joined = sim.bodies.find(b => b.live && b.attached)?.key ?? ''; events.push(...simStep(sim, p, pickTarget(targets, p, joined, sim.half), dt, springs)); }
  return { sim, events };
}
const hold = (p: Pt, frames: number) => Array.from({ length: frames }, () => p);
const line = (from: Pt, to: Pt, frames: number) => Array.from({ length: frames }, (_, i) => ({ x: from.x + (to.x - from.x) * (i + 1) / frames, y: from.y + (to.y - from.y) * (i + 1) / frames }));

test('R4-28 (b): attraction starts only close (30 px from the chip centre = its edge 16 px from the target), smoothly, full on contact', () => {
  const geo = liquidGeometry(14);
  assert.equal(geo.reach, 30); assert.equal(geo.attach, 22); assert.equal(geo.breakAt, 38);
  assert.equal(tension(64), 0, 'nothing at the old 64 px reach (the founder\'s screenshot)'); assert.equal(tension(30), 0); assert.equal(tension(14), 1); assert.equal(tension(0), 1);
  assert.ok(tension(28) > 0 && tension(28) < .05, 'a light pull at the edge of reach'); assert.ok(tension(18) > .8, 'firm just before touching');
  for (let d = 14; d < 30; d++) assert.ok(tension(d) >= tension(d + 1), 'monotonic');
  assert.equal(liquidGeometry(21).reach, 45, 'scale-aware: a larger chip reaches proportionally further');
  assert.deepEqual(nearestOn(zone.box, { x: 130, y: 70 }), { point: { x: 130, y: 50 }, distance: 20 });
  assert.equal(strongest([zone], { x: 130, y: 85 }), null, '35 px away: nothing');
  assert.equal(strongest([zone], { x: 130, y: 70 })?.key, 'zone');
});

test('R4-28: the target under the pointer wins (the most specific), a joined neck holds until breakAt, else the nearest', () => {
  const big: LiquidTarget = { key: 'big', box: { left: 0, top: 0, right: 400, bottom: 200 } }, small: LiquidTarget = { key: 'small', box: { left: 10, top: 10, right: 40, bottom: 40 } };
  assert.equal(pickTarget([big, small], { x: 20, y: 20 })?.target.key, 'small');
  const near: LiquidTarget = { key: 'near', box: { left: 200, top: 300, right: 260, bottom: 340 } };
  assert.equal(pickTarget([zone, near], { x: 130, y: 86 }, 'zone')?.target.key, 'zone', 'joined at 36 px: still held');
  assert.equal(pickTarget([zone, near], { x: 130, y: 90 }, 'zone'), null, 'past breakAt (38 px): let go');
  assert.equal(pickTarget([zone], { x: 130, y: 86 }), null, 'not joined: 36 px is out of reach');
});

test('R4-28 (a): both shapes morph and merge as one smooth surface (smooth-min union), no line between them', () => {
  assert.equal(smin(3, 9, 4), 3, 'far apart: a plain union'); assert.ok(smin(3, 4, 6) < 3, 'close: the fillet joins them');
  const { sim, events } = run(createSim(), [...line({ x: 130, y: 90 }, { x: 130, y: 68 }, 14), ...hold({ x: 130, y: 68 }, 20)]);
  assert.ok(events.includes('merge'), 'the drops touch and join');
  const body = sim.bodies[0];
  assert.ok(body.attached && body.bulge.x > 6, `the target swells toward the chip (${body.bulge.x.toFixed(1)} px)`);
  const pose = chipPose(sim);
  assert.ok(pose.sx > 1.04 && Math.abs(pose.sx * pose.sy - 1) < 1e-9, `the chip stretches toward the target, area kept (sx ${pose.sx.toFixed(3)})`);
  assert.ok(Math.abs(Math.cos(pose.angle)) < .2, 'along the pull (vertical)');
  assert.ok(pose.lean.y < -1, 'and leans in');
  for (let y = 51; y < 68 - 14; y++) assert.ok(liquidDistance(sim, { x: 130, y }) < 0, `one surface from the target to the chip (y ${y})`);
  assert.ok(liquidDistance(sim, { x: 112, y: 58 }) > 0, 'a neck, not a slab: the sides stay open');
});

test('R4-28 (d): pulled away, the neck thins, then snaps at breakAt; both shapes settle back thick (one small wobble) inside ~400 ms', () => {
  assert.ok(neckRadius(22) > neckRadius(30) && neckRadius(30) > neckRadius(38), 'longer = thinner (area kept)');
  const { sim } = run(createSim(), [...line({ x: 130, y: 90 }, { x: 130, y: 68 }, 14), ...hold({ x: 130, y: 68 }, 20)]);
  const neckHeld = sim.bodies[0].neck.x;
  // Every frame from the moment the neck lets go.
  const bulge: number[] = [], strain: number[] = []; let snapped = false;
  for (const p of line({ x: 130, y: 68 }, { x: 130, y: 100 }, 10)) { if (run(sim, [p]).events.includes('snap')) snapped = true; if (snapped) { bulge.push(sim.bodies[0].bulge.x); strain.push(sim.strain.a.x); } }
  assert.ok(snapped, 'the neck lets go'); assert.ok(neckHeld > 5);
  run(sim, hold({ x: 130, y: 120 }, 1)); bulge.push(sim.bodies[0]?.bulge.x ?? 0); strain.push(sim.strain.a.x);
  assert.ok(sim.bodies[0].neck.x < neckHeld * .6, 'the neck pinches at once');
  for (let y = 70; y < 96; y += 2) assert.ok(liquidDistance(sim, { x: 130, y }) > 0, `no thread left hanging after the snap (y ${y})`);
  for (let i = 0; i < 40; i++) { run(sim, hold({ x: 130, y: 120 }, 1)); bulge.push(sim.bodies[0]?.bulge.x ?? 0); strain.push(sim.strain.a.x); }
  const crossings = (xs: number[], eps = .05) => xs.slice(1).filter((x, i) => Math.sign(x) !== Math.sign(xs[i]) && Math.abs(x) > eps).length;
  const n = crossings(bulge.slice(0, 30));
  assert.ok(n >= 1 && n <= 2, `the target wobbles back once, thick, not a water balloon (${n} sign changes)`);
  const held = bulge[0], dent = Math.min(...bulge);
  assert.ok(dent < 0 && -dent < Math.abs(held) * .45, `one small overshoot (${dent.toFixed(2)} after ${held.toFixed(2)})`);
  assert.ok(Math.min(...strain.slice(0, 24)) < -.003, 'the chip recoils a little too');
  const late = Math.max(...bulge.slice(24, 28).map(Math.abs));
  assert.ok(late < Math.abs(held) * .06, `settled by ~420 ms (${late.toFixed(2)})`);
  run(sim, hold({ x: 130, y: 120 }, 30));
  assert.equal(sim.bodies.length, 0, 'and the body is gone once still');
});

test('R4-28 (c): thick jelly — the plate stretches a little along a fast move and eases back near-critically (velocity-aware, spring-driven)', () => {
  const sim = createSim(); run(sim, line({ x: 400, y: 400 }, { x: 640, y: 400 }, 10), []);
  const moving = chipPose(sim); assert.ok(moving.sx > 1.04 && moving.sx < 1.1 && Math.abs(Math.sin(moving.angle)) < .2, `stretched a little along the horizontal move (${moving.sx.toFixed(3)})`);
  const axis: number[] = []; for (let i = 0; i < 18; i++) { run(sim, hold({ x: 640, y: 400 }, 1), []); axis.push(sim.strain.a.x); }
  assert.ok(Math.min(...axis) > -.01, `after the stop it eases back with no visible squash-wobble (honey, not a water balloon: ${Math.min(...axis).toFixed(3)})`);
  run(sim, hold({ x: 640, y: 400 }, 30), []); assert.ok(chipPose(sim).sx < 1.005, 'and comes to rest');
  // Frame-rate independent: the same 200 ms at 60 and 144 Hz land in the same place.
  const at60 = { x: 0, v: 0 }, at144 = { x: 0, v: 0 };
  for (let i = 0; i < 12; i++) stepSpring(at60, 1, 1 / 60, springs.pull);
  for (let i = 0; i < 29; i++) stepSpring(at144, 1, 1 / 144, springs.pull);
  assert.ok(Math.abs(at60.x - at144.x) < .02, `${at60.x} / ${at144.x}`);
});

test('R4-28 (e): a drop on the target absorbs the chip; tokens are latency-bound so Premium never slows the liquid', () => {
  const { sim } = run(createSim(), [...line({ x: 130, y: 80 }, { x: 130, y: 30 }, 12), ...hold({ x: 130, y: 30 }, 10)]);
  assert.ok(sim.bodies[0].inside && sim.bodies[0].hover.x > .9, 'inside an owned cell its fill turns to the highlight');
  sim.absorb = 0; for (let i = 0; i < 12; i++) simStep(sim, null, null, 1 / 60, springs);
  assert.equal(chipPose(sim).absorb, 0, 'the chip has sunk into the cell within 200 ms');
  assert.deepEqual(motionTokens['liquid.pull'], ['L', .150, .14]); assert.deepEqual(motionTokens['liquid.jiggle'], ['L', .200, .45]); assert.deepEqual(motionTokens['liquid.jelly'], ['L', .200, .2]); assert.deepEqual(motionTokens['liquid.form'], ['L', .220, .15]);
  assert.deepEqual(liquidSprings(1.7), liquidSprings(1), 'Premium = Fast for the liquid (L class)');
  assert.deepEqual(parseColor('rgba(255, 0, 0, 0.5)'), [1, 0, 0, .5]); assert.deepEqual(parseColor('color(srgb 0.5 0.25 0 / 0.4)'), [.5, .25, 0, .4]); assert.deepEqual(parseColor('rgb(0 0 0 / .2)'), [0, 0, 0, .2]);
});

test('R4-28 founder: merged they are ONE shape — the chip\'s own shadow fades with the merge (continuous) and returns as they separate', () => {
  const sim = createSim(); run(sim, hold({ x: 130, y: 120 }, 2)); assert.equal(mergeAmount(sim), 0, 'far: the chip keeps its own shadow');
  const amounts: number[] = []; for (const p of line({ x: 130, y: 90 }, { x: 130, y: 66 }, 16)) { run(sim, [p]); amounts.push(mergeAmount(sim)); }
  assert.ok(amounts.some(a => a > .2 && a < .8), 'it passes through partial values (a fade, not a switch)');
  run(sim, hold({ x: 130, y: 66 }, 20)); assert.ok(mergeAmount(sim) > .95, 'merged: no separate chip shadow');
  const pulling: number[] = []; for (const p of line({ x: 130, y: 66 }, { x: 130, y: 86 }, 10)) { run(sim, [p]); pulling.push(mergeAmount(sim)); }
  assert.ok(pulling.at(-1)! < .75 && pulling.at(-1)! > 0, `pulled toward the break the neck thins and the shadow is coming back (${pulling.at(-1)!.toFixed(2)})`);
  run(sim, hold({ x: 130, y: 130 }, 40)); assert.ok(mergeAmount(sim) < .02, 'apart: the chip\'s shadow is whole again');
});

test('R4-28 glitches: a fast flick past a target never joins (no thread), a released chip leaves no stub where it was', () => {
  const sim = createSim(), flick = run(sim, [...line({ x: 10, y: 66 }, { x: 290, y: 70 }, 7), ...hold({ x: 290, y: 70 }, 4)]);
  assert.ok(!flick.events.includes('merge'), 'too quick for a bridge to form');
  for (let x = 100; x <= 160; x += 6) for (let y = 54; y <= 64; y += 2) assert.ok(liquidDistance(sim, { x, y }) > 0, `nothing hanging under the cell (${x},${y})`);
  const held = createSim(); run(held, [...line({ x: 130, y: 90 }, { x: 130, y: 68 }, 14), ...hold({ x: 130, y: 68 }, 20)]);
  held.released = true; simStep(held, null, null, 1 / 60, springs); simStep(held, null, null, 1 / 60, springs);
  assert.equal(chipPose(held).engaged, 0, 'released: the layer stops drawing the chip at once (its CSS plate takes over)');
  assert.ok(liquidDistance(held, { x: 130, y: 68 }) > 0, 'and no stub is left at the chip\'s old place');
});

test('R5 founder: the whole surface reaches out — the neck grows out of the full face of the chip, then necks in the middle', () => {
  const { sim } = run(createSim(), [...line({ x: 130, y: 90 }, { x: 130, y: 68 }, 14), ...hold({ x: 130, y: 68 }, 20), ...line({ x: 130, y: 68 }, { x: 130, y: 86 }, 10), ...hold({ x: 130, y: 86 }, 4)]);
  const body = sim.bodies[0]; assert.ok(body.attached, 'still joined, pulled out');
  const neck = neckParams(sim, body)!; assert.ok(neck, 'a neck is drawn');
  const pose = chipPose(sim), top = neck.c.y + neck.u.y * (neck.xb + 2), waist = neck.c.y + neck.u.y * neck.xw;
  assert.ok(neck.u.y < -.99 && neck.xt - neck.xb > 6, `a real gap to bridge, straight up (${(neck.xt - neck.xb).toFixed(1)} px)`);
  assert.ok(neck.hc >= sim.half * pose.sy * .85, `the base is the plate's whole face (${neck.hc.toFixed(1)} of ${(sim.half * pose.sy).toFixed(1)} as stretched)`);
  // (Before R5 the neck was a 4 px thread here, as wide at the face as at its waist.)
  for (const dx of [-7, -4, 0, 4, 7]) assert.ok(liquidDistance(sim, { x: pose.centre.x + dx, y: top - 1 }) < 0, `out of the full width of the face, not a dot at the icon (dx ${dx})`);
  assert.ok(liquidDistance(sim, { x: pose.centre.x + 7, y: waist }) > 0, 'and necks in the middle (not a slab)');
  assert.ok(liquidDistance(sim, { x: pose.centre.x, y: waist }) < 0, 'still joined through the waist');
  assert.ok(neckField({ x: pose.centre.x + neck.rw + .5, y: waist }, neck) > 0 && neckField({ x: pose.centre.x + neck.rw - .5, y: waist }, neck) < 0, 'the waist is rw wide');
});

test('R5 founder: not a drop of water — exactly the surface\'s own fill: no highlight, glint, rim, gradient or accent tint; the icon is never stretched', () => {
  const snap = fs.readFileSync(path.resolve('src/ui/liquidSnap.ts'), 'utf8'), css = fs.readFileSync(path.resolve('src/styles/split-picker.css'), 'utf8');
  const shader = snap.slice(snap.indexOf('const FRAGMENT'), snap.indexOf('const VERTEX'));
  for (const banned of [/uLead|uGlint|uMerge|uChipLine/, /\binner\b|\bshine\b|\bglint\b/, /exp\(d\/|exp\(-pow\(/, /mix\(zf,uChipFill,w\)\s*\+|\buAccent\b/])
    assert.doesNotMatch(shader, banned, `no water light in the shader (${banned})`);
  // R5 (founder 27 Oct, later): a lit (targeted) cell's accent fills the whole union — still one flat fill, no light.
  assert.match(shader, /vec4 fill = mix\(zf,uChipFill,w\*\(1\.-hov\)\);/, 'one flat fill: the chip\'s, or an owned cell\'s own (all of it once the cell is the target)');
  assert.match(shader, /rim = cover\*clamp\(\(d\+1\.\)\/gl\+\.5,0\.,1\.\)\*\(1\.-w\)\*\(1\.-reach\)/, 'an outline only on an owned cell\'s own contour, never on the chip or the neck');
  assert.match(shader, /edge = mix\(1\., 1\.6\*uView\.z, reach\)/, 'a slight softness where the surface reaches out, crisp elsewhere');
  assert.match(snap, /chipFill = colors\.chip;/, 'the chip\'s own tint, no accent energy');
  assert.doesNotMatch(snap, /colors\.accent\[0\], colors\.accent\[1\], colors\.accent\[2\], colors\.chip\[3\]/);
  const plate = css.slice(css.indexOf('.liquid-layer'));
  assert.doesNotMatch(plate, /color-mix\(in srgb,var\(--accent\) calc\(var\(--liquid-s/, 'the CSS plate keeps its own fill as it pulls');
  assert.match(css, /\.tab-drag-preview>:not\(:first-child\)/, 'the icon is its own layer on top');
  assert.match(plate, /\.tab-drag-preview::before\{opacity:calc\(var\(--chip-p,0\) \* \(1 - var\(--liquid-on,0\)\)\);transform:rotate/, 'only the plate stretches, never the icon');
});

test('R4-28: one liquid primitive on every carried chip, one small WebGL layer, Off-aware, no goo filter', () => {
  const surface = fs.readFileSync(path.resolve('src/ui/useTabDragSurface.ts'), 'utf8'), snap = fs.readFileSync(path.resolve('src/ui/liquidSnap.ts'), 'utf8'), css = fs.readFileSync(path.resolve('src/styles/split-picker.css'), 'utf8');
  assert.match(surface, /liquid:liquidChip\(preview,\{exclude:id\}\)/, 'the strip and compact strip chip');
  assert.match(surface, /state\.liquid=liquidChip\(chip,/, 'the sidebar chip');
  assert.match(surface, /surface\.liquid\?\.point\(point,target===1\)/, 'only a chip sticks; a pill in the strip reorders');
  assert.match(snap, /if \(!scale \|\| typeof document === 'undefined'\) return \{ point\(\) \{\}, offset: \(\) => \(\{ x: 0, y: 0 \}\), end\(\) \{\},dispose\(\) \{\} \}/, 'speed Off: no liquid');
  assert.match(snap, /split-picker-cell/); assert.match(snap, /splitContainers\(doc\)/); assert.match(snap, /\[data-group-header\],\[data-tab-group\]/); assert.match(snap, /\[data-ws\]/);
  assert.match(snap, /getContext\('webgl2'/); assert.match(snap, /float smin\(float a,float b,float k\)/, 'the shader draws the same smooth-min union');
  assert.match(css, /\.liquid-layer\{position:fixed;left:0;top:0;z-index:999;pointer-events:none;visibility:hidden/);
  assert.match(css, /\.tab-drag-preview::before\{opacity:calc\(var\(--chip-p,0\) \* \(1 - var\(--liquid-on,0\)\)\)/, 'the CSS plate hands over to the layer');
  assert.doesNotMatch(css.slice(css.indexOf('.liquid-layer')), /filter:url|feGaussianBlur/, 'no goo filter: the union is a distance field');
});
