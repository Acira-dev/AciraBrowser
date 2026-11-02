import test from 'node:test';
import assert from 'node:assert/strict';
import { compactLabelFloor,compactTabMetrics } from '../src/ui/compactTabs';

const tabs = (count: number) => Array.from({ length: count }, () => ({ pinned: false }));

test('with room, compact tabs share the row evenly with their titles', () => {
  const { widths } = compactTabMetrics(600, tabs(3), true, 1);
  assert.ok(widths.every(width => width === widths[0] && width >= compactLabelFloor));
});

test('when titles would shrink to a few letters, the active tab keeps its title and the rest become favicons', () => {
  const { widths, occupied } = compactTabMetrics(250, tabs(3), true, 0);
  assert.equal(widths[1], 38); assert.equal(widths[2], 38);
  assert.ok(widths[0] > 100 && widths[0] <= 144);
  assert.ok(occupied <= 250);
});

test('without titles, or with no active tab, every tab stays an even favicon pill', () => {
  assert.deepEqual(compactTabMetrics(250, tabs(3), false, 0).widths, [38, 38, 38]);
  const { widths } = compactTabMetrics(250, tabs(3), true);
  assert.ok(widths.every(width => width === widths[0]));
});
