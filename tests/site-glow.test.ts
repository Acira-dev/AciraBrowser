import test from 'node:test';
import assert from 'node:assert/strict';
import { fromOklch, contrast } from '../src/ui/colorMath';
import { frameReadability, type SiteTintBase } from '../src/ui/siteTint';
import { glowColour, glowPeak, isBrandColour, siteGlowColors, SITE_GLOW_LEVELS } from '../src/ui/siteGlow';
import { studyFinish } from '../src/ui/theme';
import { appearancePalettes } from '../src/runtime/appearancePalettes';

function baseOf(preset: string, dark: boolean): SiteTintBase {
  const p = appearancePalettes.find(item => item.name === preset)!, f = studyFinish({ colorPreset: p.name, browserTint: p.tint, accentColor: p.accent }, dark);
  const hex = '#' + f['--sidebar-rgb'].split(' ').map(n => Number(n).toString(16).padStart(2, '0')).join('');
  return { dark: f['--sidebar-tone'] === 'dark', frame: hex, ink: f['--sidebar-ink'], muted: f['--sidebar-muted'], accent: f['--chrome-accent'], marker: f['--sidebar-selection-marker'] };
}
const BASES = appearancePalettes.flatMap(p => [false, true].map(dark => ({ name: `${p.name}/${dark ? 'dark' : 'light'}`, base: baseOf(p.name, dark) })));
const SWEEP: string[] = [];
for (const L of [.3, .5, .7, .9]) for (const C of [.03, .08, .16, .3]) for (let h = 0; h < 360; h += 30) SWEEP.push(fromOklch(L, C, h * Math.PI / 180));
const SAMPLES = ['#FF0033', '#1ED760', '#FF4500', '#0000FF', '#FFD60A', '#00FFFF', '#FF3EA5', '#00E000'];

test('the glow at its peak keeps AA for ink and secondary ink, and 3:1 for the accent and marker, on every finish and colour', () => {
  let n = 0, gated = 0, none = 0, weakest = 99;
  for (const { name, base } of BASES) for (const color of [...SAMPLES, ...SWEEP]) for (const strength of [0, .5, 1]) {
    const g = siteGlowColors({ color, strength }, base); n++;
    if (g.note === 'none') { none++; continue; }
    if (g.note === 'gated') gated++;
    const r = frameReadability(base, g.peak, base.ink, base.muted, base.dark);
    assert.ok(r.ink >= 4.5 && r.muted >= 4.5 && r.marksOk, `${name} ${color} ${strength}: ink ${r.ink.toFixed(2)} muted ${r.muted.toFixed(2)} on peak ${g.peak}`);
    weakest = Math.min(weakest, r.muted);
    assert.ok(g.opacity >= .12 && g.opacity <= .55, 'opacity stays in the range from the New Tab\'s own .12 to .55');
  }
  console.log(`glow AA sweep: ${n} combinations, ${gated} gated, ${none} with no glow (no hue or strength 0), weakest secondary ink at the peak ${weakest.toFixed(2)}:1`);
});

test('the peak is the strongest pixel: screen in dark, normal in light, never past the finish\'s band', () => {
  const base = BASES.find(b => b.name === 'Porcelain/dark')!.base, light = BASES.find(b => b.name === 'Porcelain/light')!.base;
  const d = siteGlowColors({ color: '#FF0033', strength: 1 }, base), l = siteGlowColors({ color: '#FF0033', strength: 1 }, light);
  assert.ok(contrast(d.peak, base.frame) < 3 && contrast(l.peak, light.frame) < 2.2, 'a wash, not a fill');
  assert.equal(glowPeak('#000000', '#ffffff', .5, true), '#808080');
  assert.equal(glowPeak('#ffffff', '#000000', .5, false), '#808080');
});

test('colour source follows researcher A\'s accent order, on his measured values', () => {
  // YouTube: favicon #ff0033, theme-color #ffffff (a white page)
  assert.deepEqual(glowColour({ favicon: '#ff0033', themeColor: '#ffffff', edge: '#ffffff' }), { color: '#ff0033', from: 'favicon' });
  // Reddit: theme-color #000000 (wrong over a white page) must lose to the favicon's #ff4500
  assert.deepEqual(glowColour({ favicon: '#ff4500', themeColor: '#000000', edge: '#ffffff' }), { color: '#ff4500', from: 'favicon' });
  // Spotify: favicon #1ed760 over a black top edge
  assert.deepEqual(glowColour({ favicon: '#1ed760', edge: '#000000' }), { color: '#1ed760', from: 'favicon' });
  // Wikipedia, Notion (white tiles), GitHub (near-black favicon, near-black theme-color): no glow, not black
  assert.deepEqual(glowColour({ favicon: '#fefefe', edge: '#ffffff' }), {});
  assert.deepEqual(glowColour({ favicon: '#ffffff', edge: '#ffffff' }), {});
  assert.deepEqual(glowColour({ favicon: '#171515', themeColor: '#1e2327', edge: '#ffffff' }), {});
  // the coordinator's order (theme-color, edge, favicon) agrees where theme-color is a brand colour and differs where it is not
  assert.deepEqual(glowColour({ favicon: '#ff4500', themeColor: '#000000' }, 'surface-first'), { color: '#ff4500', from: 'favicon' });
  assert.deepEqual(glowColour({ favicon: '#1db954', themeColor: '#ffd60a' }, 'surface-first'), { color: '#ffd60a', from: 'themeColor' });
  assert.equal(isBrandColour('#808080'), false); assert.equal(isBrandColour('#101010'), false); assert.equal(isBrandColour('#ff0000'), true);
});
test('levels', () => assert.ok(SITE_GLOW_LEVELS.soft < SITE_GLOW_LEVELS.rich && SITE_GLOW_LEVELS.rich <= .55));
