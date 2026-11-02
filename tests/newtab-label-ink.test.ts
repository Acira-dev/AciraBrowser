// R3-76: the ink of the shortcut labels follows the painting behind them (src/features/newtab/labelInk.ts, pure parts).
import test from 'node:test';
import assert from 'node:assert/strict';
import { coverPlacement, groundOf, inkContrast, inkFromColor, luminance, pickInk } from '../src/features/newtab/labelInk';

test('luminance is the WCAG relative luminance', () => {
  assert.equal(luminance(0, 0, 0), 0);
  assert.ok(Math.abs(luminance(255, 255, 255) - 1) < 1e-9);
  assert.ok(Math.abs(luminance(255, 0, 0) - 0.2126) < 1e-4);
});

test('pale ground takes near-black ink, dark ground white ink, and both reach 4.5:1 on their own', () => {
  for (const [name, ground, ink] of [['pale cream', 0.62, 'dark'], ['near white', 0.9, 'dark'], ['dark wood', 0.04, 'light'], ['black', 0, 'light']] as const) {
    assert.equal(pickInk({ dark: ground, light: ground }), ink, name);
    const c = inkContrast({ dark: ground, light: ground });
    assert.ok(c[ink] >= 4.5, `${name}: ${c[ink].toFixed(1)}`);
  }
});

test('a mixed ground is judged by its worst case: the lightest tenth for white ink, the darkest tenth for dark ink', () => {
  const half = [...Array(50).fill(0.02), ...Array(50).fill(0.7)];
  const ground = groundOf(half);
  assert.ok(ground.dark <= 0.02 && ground.light >= 0.7);
  const c = inkContrast(ground);
  assert.ok(c.light < 2 && c.dark < 2, 'neither ink is clean on a split ground, so the label keeps the dark default and its glow');
  assert.equal(pickInk({ dark: 0.5, light: 0.5 }), 'dark');
});

test('object-fit: cover placement follows object-position', () => {
  const box = { width: 1000, height: 500 }, natural = { width: 2000, height: 2000 };
  const centre = coverPlacement(box, natural, '50% 50%');
  assert.equal(centre.scale, 0.5);
  assert.equal(centre.x + 0, 0);
  assert.equal(centre.y, -250);
  assert.equal(coverPlacement(box, natural, '50% 0%').y + 0, 0);
  assert.equal(coverPlacement(box, natural, '50% 100%').y, -500);
  assert.equal(coverPlacement(box, natural, undefined).y, -250);
});

test('a catalog average color is enough when the pixels cannot be read', () => {
  assert.equal(inkFromColor('#d2ca99'), 'dark');
  assert.equal(inkFromColor('#2d2a1d'), 'light');
  assert.equal(inkFromColor('rgb(1 2 3)'), undefined);
  assert.equal(inkFromColor(undefined), undefined);
});
