// R4-39: the responsive sweep's state plan covers every pair of factors, stays within its budget and never asks for a window below the minimum.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MIN, SCALES, TABS, VIEWS, POPUPS, PAGES, planFor, pairwise } from '../qa/r4-responsive-plan.mjs';

test('pairwise covers every pair of values', () => {
  const counts = [5, 4, 2, 4], rows = pairwise(counts, 7);
  for (let i = 0; i < counts.length; i++) for (let j = i + 1; j < counts.length; j++) for (let a = 0; a < counts[i]; a++) for (let b = 0; b < counts[j]; b++)
    assert.ok(rows.some(r => r[i] === a && r[j] === b), `pair ${i}:${a} ${j}:${b} missing`);
});

test('each display scale plans every size x interface scale, view and tab layout pair within the state budget', () => {
  let total = 0;
  for (const display of [100, 125, 150]) {
    const rows = planFor(display), sizes = [...new Set(rows.map(r => r.size[0]))];
    total += rows.length;
    for (const s of sizes) for (const scale of SCALES) assert.ok(rows.some(r => r.size[0] === s && r.scale === scale), `${display}%: ${s} never meets ${scale}%`);
    for (const s of sizes) for (const view of VIEWS) assert.ok(rows.some(r => r.size[0] === s && r.view === view), `${display}%: ${s} never meets ${view}`);
    for (const s of sizes) for (const tabs of TABS) assert.ok(rows.some(r => r.size[0] === s && r.tabs === tabs), `${display}%: ${s} never meets tabs ${tabs}`);
    for (const view of VIEWS) for (const tabs of TABS) assert.ok(rows.some(r => r.view === view && r.tabs === tabs), `${display}%: ${view} never meets tabs ${tabs}`);
    for (const r of rows) { assert.ok(r.size[1] >= MIN[0] && r.size[2] >= MIN[1], `${r.size[0]} below the window minimum`); assert.ok(POPUPS.includes(r.popup) && PAGES.includes(r.page)); }
  }
  assert.ok(total <= 150, `${total} planned rows exceed the 150-state budget`);
});

test('the plan is deterministic and the smallest and largest sizes are both present', () => {
  assert.deepEqual(planFor(100), planFor(100));
  const sizes = planFor(100).map(r => r.size);
  assert.ok(sizes.some(s => s[1] === 900 && s[2] === 600), 'minimum size');
  assert.ok(sizes.some(s => s[1] >= 3440), 'ultrawide');
  assert.ok(planFor(125).some(r => r.size[1] === 1536) && planFor(150).some(r => r.size[1] === 2560), '1080p@125 and 4K@150 maximized');
});

test('every size meets every popup and (nearly) every page surface', () => {
  for (const display of [100, 125, 150]) {
    const rows = planFor(display), sizes = [...new Set(rows.map(r => r.size[0]))];
    for (const s of sizes) {
      const mine = rows.filter(r => r.size[0] === s);
      if (mine.length >= POPUPS.length) assert.equal(new Set(mine.map(r => r.popup)).size, POPUPS.length, `${display}% ${s}: popups`);
      assert.ok(new Set(mine.map(r => r.page)).size >= Math.min(mine.length, PAGES.length) - 1, `${display}% ${s}: pages`);
    }
  }
});
