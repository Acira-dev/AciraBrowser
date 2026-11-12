import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCENE_PALETTE, css255, hsv, packetHue, packetTint, poolFalloff, smoothstep } from '../src/features/onboarding/scenePalette';
import { beams, paintLightField, type Paint2D } from '../src/features/onboarding/LightField';

// LINUX SETUP COLOURS (13.7, reported: the first run on Linux / WSLg "doesn't show its real colours").
// A window drawn in software has no WebGL2 (Chromium 139 and later no longer fall back to software WebGL by themselves, and Acira does not turn that on:
// it would open software WebGL to every page), so PrismField mounts the 2D LightField instead. On 13.6 that fallback painted pale, desaturated tints
// (`hsl(hue, .35, .8)`, hue 170 to 330) in both themes, with beams in the light theme that the real scene does not have. It now paints the scene's own
// colours, from the numbers in scenePalette.ts, which these tests pin to the shader.
const here = path.dirname(fileURLToPath(import.meta.url));
const shader = fs.readFileSync(path.join(here, '../src/features/onboarding/prismRenderer.ts'), 'utf8');
const lightField = fs.readFileSync(path.join(here, '../src/features/onboarding/LightField.tsx'), 'utf8');
const squash = (text: string) => text.replace(/\s+/g, '');

// ---- the palette is the shader's ------------------------------------------------------------------------------------------------------------------------
test('the palette numbers are the shader\'s own', () => {
  const code = squash(shader);
  const vec = (rgb: readonly number[]) => 'vec3(' + rgb.map((c) => String(c).replace(/^0\./, '.')).join(',') + ')';
  const p = SCENE_PALETTE;
  assert.ok(code.includes('vec3(1.,.975,.95)'), 'the beam\'s warm white');
  assert.deepEqual([...p.dark.warmWhite], [1, 0.975, 0.95]);
  assert.ok(code.includes('vec3(.62,.66,.76)'), 'the haze');
  assert.deepEqual([...p.dark.fog], [0.62, 0.66, 0.76]);
  // hue = clamp(.375 - .46 k, .012, .8), saturation .97
  assert.ok(code.includes('clamp(tone<.5?.375-.46*k:.4-.42*k,tone<.5?.012:0.,.8)'), 'the packet\'s hue run');
  assert.deepEqual([p.dark.hueOrigin, p.dark.hueSlope, p.dark.hueMin, p.dark.hueMax], [0.375, 0.46, 0.012, 0.8]);
  assert.ok(code.includes('hsv(hue,tone<.5?.97:.95,1.)'), 'the packet\'s saturation');
  assert.equal(p.dark.saturation, 0.97);
  // the light pools
  assert.ok(code.includes('vec3(.60,.83,.935)') && code.includes('pool*.86'), 'aqua');
  assert.deepEqual([...p.light.aqua.rgb, p.light.aqua.weight], [0.6, 0.83, 0.935, 0.86]);
  assert.ok(code.includes('vec3(.82,.77,.97)') && code.includes('lilac*.44'), 'lilac');
  assert.deepEqual([...p.light.lilac.rgb, p.light.lilac.weight], [0.82, 0.77, 0.97, 0.44]);
  assert.ok(code.includes('vec3(.995,.83,.73)') && code.includes('peach*.36'), 'peach');
  assert.deepEqual([...p.light.peach.rgb, p.light.peach.weight], [0.995, 0.83, 0.73, 0.36]);
  assert.ok(code.includes('smoothstep(.62,.05,'), 'the pools\' falloff');
  void vec;
});

test('the spectrum packet runs violet (trailing) to red (leading), with the shader\'s smooth HSV', () => {
  assert.ok(packetHue(-1) <= 0.8 + 1e-9 && packetHue(-1) > packetHue(0) && packetHue(0) > packetHue(1) && packetHue(1) >= 0.012 - 1e-9);
  assert.equal(packetHue(-5), 0.8, 'clamped at the violet end');
  assert.equal(packetHue(5), 0.012, 'clamped at the red end');
  const red = packetTint(1, 1), green = packetTint(0, 1), violet = packetTint(-1, 1);
  assert.ok(red[0] > 1 && red[1] < 0.35 && red[2] < 0.1, 'a clear, lifted red at the leading edge: ' + red);
  assert.ok(green[1] > green[0] && green[1] > green[2], 'green-teal in the middle: ' + green);
  assert.ok(violet[2] > violet[1] && violet[0] > violet[1], 'violet at the trailing edge: ' + violet);
  assert.deepEqual(packetTint(0, 0), [...SCENE_PALETTE.dark.warmWhite], 'outside the packet the beam is warm white');
  assert.deepEqual(hsv(0, 1, 1).map((c) => Math.round(c * 1000) / 1000), [1, 0, 0]);
  assert.equal(smoothstep(0, 1, 0.5), 0.5);
  assert.equal(poolFalloff(0), 1);
  assert.equal(poolFalloff(1), 0);
  assert.ok(poolFalloff(0.3) > poolFalloff(0.6));
  assert.equal(css255([1, 0.5, 0]), '255,128,0');
});

// ---- what the fallback actually paints ----------------------------------------------------------------------------------------------------------------
type Stop = { p: number; r: number; g: number; b: number; a: number };
function recorder() {
  const stops: Stop[] = [], calls = { linear: 0, radial: 0, fills: 0 }, composites = new Set<string>(), fillOrder: string[] = [];
  let composite = 'source-over';
  let fillStyleNow: string | CanvasGradient | CanvasPattern = '';
  const gradient = () => ({
    addColorStop(p: number, color: string) {
      const m = /rgba\((\d+),(\d+),(\d+),([\d.eE+-]+)\)/.exec(color);
      assert.ok(m, 'a colour the test can read: ' + color);
      stops.push({ p, r: +m![1], g: +m![2], b: +m![3], a: +m![4] });
    },
  });
  const context = {
    get globalCompositeOperation() { return composite; },
    set globalCompositeOperation(value: string) { composite = value; composites.add(value); },
    get fillStyle() { return fillStyleNow; },
    set fillStyle(value: string | CanvasGradient | CanvasPattern) { fillStyleNow = value; },
    clearRect() {}, save() {}, restore() {}, translate() {}, scale() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {},
    fill() { calls.fills++; }, fillRect() { calls.fills++; fillOrder.push(typeof fillStyleNow === 'string' ? fillStyleNow : 'gradient'); },
    createLinearGradient() { calls.linear++; return gradient(); },
    createRadialGradient() { calls.radial++; return gradient(); },
  };
  return { context: context as unknown as Paint2D, stops, calls, composites, fillOrder };
}
const frame = (dark: boolean, t: number) => ({ dark, width: 640, height: 400, t, level: 1, clear: 0, list: beams(11) });
const chroma = (s: Stop) => (Math.max(s.r, s.g, s.b) - Math.min(s.r, s.g, s.b)) / 255;
const hueDegrees = (s: Stop) => {
  const r = s.r / 255, g = s.g / 255, b = s.b / 255, max = Math.max(r, g, b), d = max - Math.min(r, g, b);
  if (!d) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
};

test('dark: the beams carry the scene\'s full-strength spectrum, not pale tints (fails on 13.6, whose strongest beam colour had chroma .14)', () => {
  let strongest = 0, red = false, violet = false, green = false;
  for (let t = 0; t < 60; t += 0.5) {
    const rec = recorder();
    paintLightField(rec.context, frame(true, t));
    for (const s of rec.stops) {
      if (s.a < 0.01) continue;
      strongest = Math.max(strongest, chroma(s));
      if (chroma(s) > 0.5) {
        const h = hueDegrees(s);
        assert.ok(h <= 0.8 * 360 + 1 || h >= 359, 'no hue beyond the violet end of the shader\'s run: ' + h);
        if (h < 25 || h > 350) red = true;
        if (h > 100 && h < 170) green = true;
        if (h > 250 && h < 290) violet = true;
      }
    }
  }
  assert.ok(strongest > 0.8, 'a saturated spectrum colour appears: strongest chroma ' + strongest.toFixed(2));
  assert.ok(red && green && violet, `red ${red}, green ${green}, violet ${violet}: the whole run is drawn over a cycle`);
});

test('dark: additive light, beams as gradients along their length, the haze in the scene\'s fog colour', () => {
  const rec = recorder();
  paintLightField(rec.context, frame(true, 3));
  assert.ok(rec.composites.has('lighter'), 'additive');
  assert.ok(rec.calls.linear >= 14 * 3, 'three wedges for each of the 14 beams');
  const fog = css255(SCENE_PALETTE.dark.fog).split(',').map(Number);
  assert.ok(rec.stops.some((s) => s.r === fog[0] && s.g === fog[1] && s.b === fog[2]), 'the haze is the shader\'s fog colour');
});

test('dark: a beam outside its spectrum packet is the shader\'s warm white', () => {
  const rec = recorder();
  paintLightField(rec.context, frame(true, 0));              // the first cycle has only just begun: the packet is not on the beams yet
  const warm = css255(SCENE_PALETTE.dark.warmWhite).split(',').map(Number);
  const bodyStops = rec.stops.filter((s) => s.a > 0.001 && chroma(s) < 0.1);
  assert.ok(bodyStops.some((s) => Math.abs(s.r - warm[0]) <= 1 && Math.abs(s.g - warm[1]) <= 1 && Math.abs(s.b - warm[2]) <= 1));
});

test('light: pools of the scene\'s aqua, lilac and peach over white, no beams (fails on 13.6, which drew pale hsl beams in the light theme too)', () => {
  const rec = recorder();
  paintLightField(rec.context, frame(false, 5));
  assert.equal(rec.fillOrder[0], 'rgb(255,255,255)', 'an opaque white ground first, as the shader\'s: the stage behind the canvas is a pearl grey (--fr-bg #d4d3da) that must not show through (the real app on 13.7 showed the pools on grey)');
  assert.equal(rec.calls.linear, 0, 'the light scene has no beams');
  assert.ok(!rec.composites.has('lighter'), 'source-over, light on white');
  const wanted = (['aqua', 'lilac', 'peach'] as const).map((name) => ({ name, rgb: css255(SCENE_PALETTE.light[name].rgb).split(',').map(Number), weight: SCENE_PALETTE.light[name].weight }));
  for (const w of wanted) {
    const mine = rec.stops.filter((s) => s.r === w.rgb[0] && s.g === w.rgb[1] && s.b === w.rgb[2]);
    assert.ok(mine.length > 0, w.name + ' is painted');
    assert.ok(Math.max(...mine.map((s) => s.a)) <= w.weight * 1.35 + 1e-9, w.name + ' within 35 % of the shader\'s weight (the 2D fit lifts lilac and peach a little, lowers aqua)');
    assert.ok(Math.max(...mine.map((s) => s.a)) >= w.weight * 0.4, w.name + ' is strong enough to be seen');
  }
  // nothing else is painted: every stop is one of the three pool colours
  for (const s of rec.stops) assert.ok(wanted.some((w) => s.r === w.rgb[0] && s.g === w.rgb[1] && s.b === w.rgb[2]), 'a colour that is not a pool: ' + [s.r, s.g, s.b]);
  // each pool fades out at its edge
  assert.ok(rec.stops.some((s) => s.p === 1 && s.a === 0));
});

test('light: the quiet pocket (clearCenter) lowers the pools, the strength raises them', () => {
  const strongest = (clear: number, level: number) => { const rec = recorder(); paintLightField(rec.context, { ...frame(false, 5), clear, level }); return Math.max(...rec.stops.map((s) => s.a)); };
  assert.ok(strongest(1, 1) < strongest(0, 1));
  assert.ok(strongest(0, 0.5) < strongest(0, 1));
});

// ---- the component still only runs without WebGL2 ------------------------------------------------------------------------------------------------------
test('the pale 13.6 tints are gone from the source, and PrismField still uses the fallback only without WebGL2', () => {
  assert.equal(/hsl\(/.test(lightField), false, 'no HSL tints');
  assert.equal(/0\.35,\s*0\.8/.test(lightField), false);
  assert.equal(/rgba\(200,206,222/.test(lightField), false, 'the old pale haze');
  const prism = fs.readFileSync(path.join(here, '../src/features/onboarding/PrismField.tsx'), 'utf8');
  assert.match(prism, /if \(!prism\) \{\s*setFailed\(true\);/, 'the fallback is for a missing WebGL2 only');
  assert.match(prism, /\{failed && <LightField tone=\{tone\}/);
});
