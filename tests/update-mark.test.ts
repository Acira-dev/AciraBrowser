import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { checkLights } from '../src/ui/matrixShapes';

// The update's dot matrix (founder, 7 Nov 2026: too big, stuck to the top of its area, keep the matrix look): the toolbar's Update pill and the
// update and What's new panels draw it through one component, 14px of 6x6 dots whose check is centred on the grid both ways.
register('data:text/javascript,' + encodeURIComponent("export async function load(url, context, next) { return url.endsWith('.css') ? { format: 'module', source: '', shortCircuit: true } : next(url, context); }"));
(globalThis as { window?: unknown }).window ??= {};
const { UpdateMark, UPDATE_MARK_SIZE, UPDATE_MARK_PANEL_SIZE, UPDATE_MARK_ROWS, UPDATE_MARK_DOT } = await import('../src/features/updates/UpdateMark');
const read = (file: string) => readFileSync(file, 'utf8');

test('the pill\'s mark is smaller than the 16px of 5x5 it was, and the dots keep a clear gap at both sizes', () => {
  assert.ok(UPDATE_MARK_SIZE < 16 && UPDATE_MARK_SIZE >= 12, 'smaller, not a speck: ' + UPDATE_MARK_SIZE);
  assert.equal(UPDATE_MARK_PANEL_SIZE, 16, 'in a panel it fills the 16px icon column, so the title\'s text edge stays');
  for (const size of [UPDATE_MARK_SIZE, UPDATE_MARK_PANEL_SIZE]) {
    const cell = size / UPDATE_MARK_ROWS, gapDevicePixels = cell * (1 - UPDATE_MARK_DOT) * 2;
    assert.ok(gapDevicePixels >= 1.8, size + 'px: on a 2x screen the gap between two dots is about two device pixels, not a line: ' + gapDevicePixels.toFixed(2));
  }
  assert.ok(UPDATE_MARK_DOT <= 0.7, 'never rounder or closer than the classic matrix');
  const pill = renderToStaticMarkup(createElement(UpdateMark, { preset: 'check', tone: 'accent', reducedMotion: false }));
  assert.match(pill, /<canvas class="dot-matrix " style="width:14px;height:14px"[^>]*data-preset="check"/);
  const panel = renderToStaticMarkup(createElement(UpdateMark, { preset: 'check', tone: 'accent', reducedMotion: false, panel: true }));
  assert.match(panel, /style="width:16px;height:16px"/);
});

test('the check is lit on the middle of the grid: as far from the top as from the bottom, from the left as from the right', () => {
  const lit: number[][] = [];
  for (let r = 0; r < UPDATE_MARK_ROWS; r++) for (let c = 0; c < UPDATE_MARK_ROWS; c++) if (checkLights(r, c, UPDATE_MARK_ROWS, UPDATE_MARK_ROWS)) lit.push([r, c]);
  assert.ok(lit.length >= 5, 'a check is there: ' + lit.length);
  const rows = lit.map((dot) => dot[0]), cols = lit.map((dot) => dot[1]);
  assert.equal(Math.min(...rows) + Math.max(...rows), UPDATE_MARK_ROWS - 1, 'not stuck to the top');
  assert.equal(Math.min(...cols) + Math.max(...cols), UPDATE_MARK_ROWS - 1);
});

test('the pill, the update panel and the What\'s new panel all draw the same mark; no hand-made 16px 5x5 matrix is left', () => {
  for (const file of ['UpdatePill.tsx', 'UpdatePopover.tsx', 'WhatsNewPopover.tsx']) {
    const source = read('src/features/updates/' + file);
    assert.match(source, /<UpdateMark /, file + ' uses the shared mark');
    assert.doesNotMatch(source, /<DotMatrix/, file + ' draws no matrix of its own');
  }
  assert.match(read('src/features/updates/update-pill.css'), /\.update-pill-mark \{[^}]*width: 14px; height: 14px;/, 'the pill\'s box is the mark\'s size');
  const matrix = read('src/components/DotMatrix.tsx');
  assert.match(matrix, /dot = \.7/, 'every other matrix keeps the classic dot size');
  assert.match(matrix, /radius = cell \* dot \/ 2/);
});
