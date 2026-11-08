import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { checkLights, dottedTick, updateCheckAt, UPDATE_TICK } from '../src/ui/matrixShapes';

// The update's dot matrix (founder, 7 Nov 2026: too big, stuck to the top of its area, keep the matrix look; 8 Nov: "checkmark still sucks", then "option 3 but dotted"): the toolbar's Update
// pill and the update and What's new panels draw it through one component, 14px (16px in a panel) of 6x6 dots that fill with the real progress; the check is seven round dots evenly spaced
// along a tick over the same faint grid, painted on its own canvas at the real pixel density.
register('data:text/javascript,' + encodeURIComponent("export async function load(url, context, next) { return url.endsWith('.css') ? { format: 'module', source: '', shortCircuit: true } : next(url, context); }"));
(globalThis as { window?: unknown }).window ??= {};
const { UpdateMark, UPDATE_MARK_SIZE, UPDATE_MARK_PANEL_SIZE, UPDATE_MARK_ROWS, UPDATE_MARK_DOT, UPDATE_CHECK_MS, paintUpdateCheck } = await import('../src/features/updates/UpdateMark');
const read = (file: string) => readFileSync(file, 'utf8');

test('the pill\'s mark is smaller than the 16px of 5x5 it was, and the fill\'s dots keep a clear gap at both sizes', () => {
  assert.ok(UPDATE_MARK_SIZE < 16 && UPDATE_MARK_SIZE >= 12, 'smaller, not a speck: ' + UPDATE_MARK_SIZE);
  assert.equal(UPDATE_MARK_PANEL_SIZE, 16, 'in a panel it fills the 16px icon column, so the title\'s text edge stays');
  for (const size of [UPDATE_MARK_SIZE, UPDATE_MARK_PANEL_SIZE]) {
    const cell = size / UPDATE_MARK_ROWS, gapDevicePixels = cell * (1 - UPDATE_MARK_DOT) * 2;
    assert.ok(gapDevicePixels >= 1.8, size + 'px: on a 2x screen the gap between two dots is about two device pixels, not a line: ' + gapDevicePixels.toFixed(2));
  }
  assert.ok(UPDATE_MARK_DOT <= 0.7, 'never rounder or closer than the classic matrix');
  // while it downloads the mark is the shared dot matrix; once ready it is the check's own canvas of the same size
  const fill = renderToStaticMarkup(createElement(UpdateMark, { preset: 'progress', progress: .4, tone: 'ink', reducedMotion: false }));
  assert.match(fill, /<canvas class="dot-matrix " style="width:14px;height:14px"[^>]*data-preset="progress"/);
  const pill = renderToStaticMarkup(createElement(UpdateMark, { preset: 'check', tone: 'accent', reducedMotion: false }));
  assert.match(pill, /<canvas class="dot-matrix" style="width:14px;height:14px"[^>]*data-preset="check"/);
  const panel = renderToStaticMarkup(createElement(UpdateMark, { preset: 'check', tone: 'accent', reducedMotion: false, panel: true }));
  assert.match(panel, /style="width:16px;height:16px"/);
});

test('the tick is a row of round dots evenly spaced along it: one on the elbow, the same pitch on both arms, centred on the mark both ways, on whole pixels', () => {
  for (const size of [UPDATE_MARK_SIZE, UPDATE_MARK_PANEL_SIZE]) {
    const dots = dottedTick(size), pitch = UPDATE_TICK.step * Math.SQRT2;
    assert.equal(dots.length, UPDATE_TICK.arm1 + UPDATE_TICK.arm2 + 1, size + 'px: a dot at each step and one on the elbow');
    for (let i = 1; i < dots.length; i++) assert.ok(Math.abs(Math.hypot(dots[i][0] - dots[i - 1][0], dots[i][1] - dots[i - 1][1]) - pitch) < 1e-9, size + 'px: dots ' + (i - 1) + ' and ' + i + ' are one pitch apart');
    const elbow = dots[UPDATE_TICK.arm1];
    assert.ok(dots.every(([, y]) => y <= elbow[1]), 'the elbow is the lowest dot');
    assert.ok(dots[UPDATE_TICK.arm1 - 1][0] < elbow[0] && dots[UPDATE_TICK.arm1 + 1][0] > elbow[0], 'one arm each side of it');
    const xs = dots.map((dot) => dot[0]), ys = dots.map((dot) => dot[1]), radius = UPDATE_TICK.dot / 2;
    assert.equal(Math.min(...xs) + Math.max(...xs), size, size + 'px: centred left to right');
    assert.equal(Math.min(...ys) + Math.max(...ys), size, size + 'px: centred top to bottom, not stuck to the top');
    assert.ok(Math.min(...xs, ...ys) - radius >= 0 && Math.max(...xs, ...ys) + radius <= size, 'inside the mark');
    assert.ok(dots.every(([x, y]) => Number.isInteger(x) && Number.isInteger(y)), size + 'px: whole css pixels, so a 2px dot is whole device pixels at 1x, 1.5x and 2x');
    assert.ok(pitch - UPDATE_TICK.dot >= .8, 'a clear gap between two dots on the diagonal: ' + (pitch - UPDATE_TICK.dot).toFixed(2));
  }
});

test('the finish: every grid dot lit, then the grid steps back while the tick\'s dots arrive one after another, start to end, and it ends still', () => {
  const start = updateCheckAt(0), end = updateCheckAt(1), mid = updateCheckAt(.5);
  assert.equal(start.grid, 1); assert.equal(start.drawn, 0); assert.equal(end.grid, 0); assert.equal(end.drawn, 1);
  for (let i = 0; i < 7; i++) { assert.equal(start.dot(i, 7), 0); assert.equal(end.dot(i, 7), 1); }
  for (let i = 1; i < 7; i++) assert.ok(mid.dot(i - 1, 7) >= mid.dot(i, 7), 'dot ' + (i - 1) + ' is there before dot ' + i);
  let last = 0; for (let p = 0; p <= 1.0001; p += .05) { const drawn = updateCheckAt(p).drawn; assert.ok(drawn >= last - 1e-9, 'never goes back'); last = drawn; }
  assert.ok(UPDATE_CHECK_MS >= 300 && UPDATE_CHECK_MS <= 600, 'a short, calm finish: ' + UPDATE_CHECK_MS + ' ms');
  // reduced motion (and a panel that opens on a ready update) shows the done mark at once: the effect paints frame 1 unless a finish is asked for and motion is allowed
  const source = read('src/features/updates/UpdateMark.tsx');
  assert.match(source, /if \(finish && !reducedMotion\) step\(\); else paint\(1\);/);
  assert.match(source, /const sawFill = useRef\(false\);\s*if \(preset !== 'check'\) sawFill\.current = true;/, 'the finish plays only where the fill was showing in this very mark');
  assert.match(source, /Math\.max\(1, window\.devicePixelRatio \|\| 1\)/, 'painted at the real pixel density, not at 2x and shrunk');
});

test('painted: at the end the tick is seven full dots over the faint grid, none of it hiding behind them; at the start every grid dot is lit and no tick dot is there', () => {
  type Fill = { x: number; y: number; r: number; color: string; alpha: number };
  const record = () => {
    const fills: Fill[] = []; let color = '', alpha = 1, point = [0, 0, 0];
    const context = { set fillStyle(value: string) { color = value; }, set globalAlpha(value: number) { alpha = value; }, beginPath() {}, arc(x: number, y: number, r: number) { point = [x, y, r]; }, fill() { fills.push({ x: point[0], y: point[1], r: point[2], color, alpha }); } };
    return { context: context as unknown as CanvasRenderingContext2D, fills };
  };
  for (const size of [UPDATE_MARK_SIZE, UPDATE_MARK_PANEL_SIZE]) {
    const done = record(); paintUpdateCheck(done.context, size, 'ON', 'OFF', 1);
    const lit = done.fills.filter((fill) => fill.color === 'ON'), grid = done.fills.filter((fill) => fill.color === 'OFF');
    assert.equal(lit.length, 7, size + 'px: seven tick dots and no lit grid dot'); assert.ok(lit.every((fill) => fill.r === UPDATE_TICK.dot / 2 && fill.alpha === 1));
    assert.ok(grid.length >= 20 && grid.length < 36, size + 'px: the faint grid stays, minus the dots a tick dot would half-cover: ' + grid.length);
    assert.ok(grid.every((fill) => lit.every((dot) => Math.hypot(dot.x - fill.x, dot.y - fill.y) >= dot.r + fill.r)), size + 'px: no grid dot touches a tick dot');
    const first = record(); paintUpdateCheck(first.context, size, 'ON', 'OFF', 0);
    assert.equal(first.fills.filter((fill) => fill.color === 'ON').length, 36, size + 'px: the fill\'s last frame, every grid dot lit'); assert.equal(first.fills.length, 72);
  }
});

test('the pill, the update panel and the What\'s new panel all draw the same mark; no hand-made 16px 5x5 matrix is left; the other matrices keep the classic check', () => {
  for (const file of ['UpdatePill.tsx', 'UpdatePopover.tsx', 'WhatsNewPopover.tsx']) {
    const source = read('src/features/updates/' + file);
    assert.match(source, /<UpdateMark /, file + ' uses the shared mark');
    assert.doesNotMatch(source, /<DotMatrix/, file + ' draws no matrix of its own');
  }
  assert.match(read('src/features/updates/update-pill.css'), /\.update-pill-mark \{[^}]*width: 14px; height: 14px;/, 'the pill\'s box is the mark\'s size');
  const matrix = read('src/components/DotMatrix.tsx');
  assert.match(matrix, /dot = \.7/, 'every other matrix keeps the classic dot size');
  assert.match(matrix, /radius = cell \* dot \/ 2/);
  // the rating card's thanks and a finished download still draw the classic lit-cell check
  assert.match(matrix, /check: \(_t, r, c, R, C\) => checkLights\(r, c, R, C\)/);
  assert.equal(checkLights(2, 0, 6, 6), 1); assert.equal(checkLights(1, 5, 6, 6), 1); assert.equal(checkLights(0, 0, 6, 6), 0);
  assert.equal(checkLights(3, 0, 7, 7), 1);
});
