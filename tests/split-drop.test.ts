import assert from 'node:assert/strict';
import test from 'node:test';
import { inSplitZone, splitDropAction } from '../src/ui/splitDrop';

const page = { left: 0, top: 68, right: 1280, bottom: 800 };

test('the picker arms anywhere on the page below the strip', () => {
  assert.equal(inSplitZone({ x: 1100, y: 400 }, page), true);
  assert.equal(inSplitZone({ x: 600, y: 400 }, page), true);
  assert.equal(inSplitZone({ x: 1100, y: 80 }, page), false);
  assert.equal(inSplitZone({ x: 1100, y: 20 }, page), false);
});

test('the dragged tab opens on the right of the current one, or of the last used when it is the current one', () => {
  assert.deepEqual(splitDropAction('b', 'a', ['a', 'b', 'c'], {}), { type: 'split.open', tabIds: ['a', 'b'] });
  assert.deepEqual(splitDropAction('a', 'a', ['a', 'b', 'c'], { c: 20, b: 10 }), { type: 'split.open', tabIds: ['c', 'a'] });
  assert.equal(splitDropAction('a', 'a', ['a'], {}), null);
});

test('picker zones are the cells of each offered layout, inside the card', async () => {
  const { pickerGeometry } = await import('../src/ui/splitDrop');
  const geo = pickerGeometry(1280, 720, ['columns', 'rows']);
  assert.equal(geo.thumbs.length, 2);
  assert.equal(geo.thumbs[0].cells.length, 2);
  for (const thumb of geo.thumbs) for (const cell of thumb.cells) {
    assert.ok(cell.x >= geo.card.x && cell.x + cell.width <= geo.card.x + geo.card.width);
    assert.ok(cell.y >= geo.card.y && cell.y + cell.height <= geo.card.y + geo.card.height);
  }
  assert.ok(Math.abs(geo.card.x + geo.card.width / 2 - 640) <= 1, 'centred');
});
