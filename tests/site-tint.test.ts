import test from 'node:test';
import assert from 'node:assert/strict';
import { contrast, fromOklch, toOklch } from '../src/ui/colorMath';
import { frameReadability, fitMuted, glideColor, siteTintColors, siteTintStates, type SiteTintBase, type SiteTintRequest } from '../src/ui/siteTint';
import { studyFinish } from '../src/ui/theme';
import { appearancePalettes } from '../src/runtime/appearancePalettes';

/** The finish's own sidebar frame, exactly as the app writes it (the engine reads the same inline tokens). */
function baseOf(preset: string, dark: boolean): SiteTintBase {
  const p = appearancePalettes.find(item => item.name === preset)!;
  const f = studyFinish({ colorPreset: p.name, browserTint: p.tint, accentColor: p.accent }, dark);
  const hex = '#' + f['--sidebar-rgb'].split(' ').map(n => Number(n).toString(16).padStart(2, '0')).join('');
  return { dark: f['--sidebar-tone'] === 'dark', frame: hex, ink: f['--sidebar-ink'], muted: f['--sidebar-muted'], accent: f['--chrome-accent'], marker: f['--sidebar-selection-marker'] };
}
const PRESETS = ['Porcelain', 'Burgundy', 'Deep Blue', 'Ocean Blue', 'Emerald Green', 'Alpine Green', 'Deep Purple', 'Desert Titanium', 'Natural Titanium', 'Silver', 'Black Titanium'];
const BASES = PRESETS.flatMap(name => [false, true].map(dark => ({ name: `${name}/${dark ? 'dark' : 'light'}`, base: baseOf(name, dark) })));
/** Site colours: the six samples plus a sweep of lightness, chroma and hue, white, black and greys included. */
const SAMPLES = ['#FF0000', '#0D1117', '#FF4500', '#FFFFFF', '#1DB954', '#F7F6F3', '#121212', '#000000', '#808080', '#0000FF', '#00FFFF', '#FFD60A', '#FF3EA5', '#0A0F2C', '#00E000'];
const SWEEP: string[] = [];
for (const L of [.05, .15, .3, .5, .7, .85, .95]) for (const C of [0, .03, .08, .16, .3]) for (let h = 0; h < 360; h += 30) SWEEP.push(fromOklch(L, C, h * Math.PI / 180));
const STRENGTHS = [.22, .45, .72, 1];

function check(request: SiteTintRequest, base: SiteTintBase, label: string) {
  const c = siteTintColors(request, base);
  const r = frameReadability(base, c.frame, base.ink, c.muted, base.dark);
  assert.ok(r.ink >= 4.5, `${label}: ink ${r.ink.toFixed(2)} on ${c.frame}`);
  assert.ok(r.muted >= 4.5, `${label}: muted ${r.muted.toFixed(2)} on ${c.frame}`);
  assert.ok(r.marksOk, `${label}: accent or selection marker fell under 3:1 on ${c.frame}`);
  // The toolbar's raised row: the finish's ink on Acira's white with a fifth of the frame in it.
  assert.ok(contrast(base.ink, c.surface) >= 7, `${label}: ink on the raised row ${contrast(base.ink, c.surface).toFixed(2)}`);
  return c;
}

test('every finish x every sample/sweep colour x every strength keeps AA for ink and secondary ink on the frame and its steps', () => {
  let n = 0, gated = 0, weakest = 99;
  for (const { name, base } of BASES) for (const color of [...SAMPLES, ...SWEEP]) for (const strength of STRENGTHS) {
    const c = check({ color, strength }, base, `${name} ${color} ${strength}`);
    n++; if (c.note === 'gated') gated++;
    weakest = Math.min(weakest, frameReadability(base, c.frame, base.ink, c.muted, base.dark).muted);
  }
  assert.ok(n > 20000, `ran ${n}`);
  console.log(`site tint AA sweep: ${n} combinations, ${gated} gated (chroma lowered), weakest secondary ink ${weakest.toFixed(2)}:1`);
});

test('the ink is never replaced: the lightness band keeps the finish\'s own ink valid (no flip)', () => {
  for (const { name, base } of BASES) for (const color of SAMPLES) {
    const c = siteTintColors({ color, strength: 1 }, base);
    assert.equal(c.ink, undefined, `${name} ${color} replaced the ink`);
    assert.equal(c.tone, base.dark ? 'dark' : 'light');
    assert.ok(Math.abs(toOklch(c.frame)[0] - toOklch(base.frame)[0]) <= (base.dark ? .06 : .12), `${name} ${color} left the lightness band`);
  }
});

test('colours with no hue to give leave the frame the finish\'s own: white, black and grey', () => {
  for (const { name, base } of BASES) for (const color of ['#FFFFFF', '#000000', '#808080', '#F7F6F3']) {
    const c = siteTintColors({ color, strength: 1 }, base);
    assert.ok(contrast(c.frame, base.frame) < 1.12, `${name} ${color}: frame moved to ${c.frame}`);
  }
});

test('a glide between any two tints is readable on every frame (AA holds mid-morph, so there is no flash)', () => {
  let frames = 0;
  for (const { name, base } of BASES.filter((_, i) => i % 3 === 0)) {
    for (const a of SAMPLES) for (const b of SAMPLES) {
      const from = siteTintColors({ color: a, strength: .72 }, base).frame, to = siteTintColors({ color: b, strength: .72 }, base).frame;
      let last = from;
      for (let t = 0; t <= 1.0001; t += .05) {
        const frame = glideColor(from, to, Math.min(1, t)), st = siteTintStates(frame, base.ink, base.dark);
        const surfaces = [frame, st.hover, st.pressed, st.selected], fit = fitMuted(base.muted, base.ink, surfaces);
        for (const mark of [base.accent, base.marker]) if (mark) assert.ok(contrast(mark, frame) >= Math.min(3, contrast(mark, base.frame) - .02) - .15, `${name} ${a}->${b} t=${t.toFixed(2)} mark ${mark} on ${frame}: ${contrast(mark, frame).toFixed(2)}`);
        for (const surface of surfaces) { assert.ok(contrast(base.ink, surface) >= 4.5, `${name} ${a}->${b} t=${t.toFixed(2)} ink`); assert.ok(contrast(fit.color, surface) >= 4.5, `${name} ${a}->${b} t=${t.toFixed(2)} muted`); }
        // No jump: a 20-step glide never moves a frame more than a few levels of lightness.
        assert.ok(Math.abs(toOklch(frame)[0] - toOklch(last)[0]) < .03, `${name} ${a}->${b} lightness jump`);
        last = frame; frames++;
      }
    }
  }
  console.log(`glide sweep: ${frames} frames, all AA`);
});

test('match mode (comparison only) does flip the ink, which is why it is not recommended', () => {
  const base = BASES.find(item => item.name === 'Porcelain/light')!.base;
  const c = siteTintColors({ color: '#0D1117', strength: 1, mode: 'match' }, base);
  assert.equal(c.tone, 'dark');
  assert.equal(c.ink, '#ffffff');
});
