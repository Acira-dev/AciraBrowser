import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { FOLD_CURVE, FOLD_GONE, curveAt, curveTime, foldAt, foldPlan, type FoldRow } from '../src/components/sidebar/foldMotion';
import { stripEase, stripMs, frequentStretch, classScale } from '../src/ui/motionTokens';

const rows = (n: number, h = 32, top = 100): FoldRow[] => Array.from({ length: n }, (_, i) => ({ top: top + i * h, height: h }));
const speeds = { fast: stripMs * frequentStretch(classScale('fast', 'S')), premium: stripMs * frequentStretch(classScale('premium', 'S')) };

test('R5 fold mirror: the fade runs on the unfold\'s own spring curve, read exactly as CSS linear() reads it', () => {
  assert.equal(FOLD_CURVE.length, 33); assert.equal(FOLD_CURVE[0], 0); assert.equal(FOLD_CURVE.at(-1), 1);
  assert.equal(stripEase.match(/[\d.]+/g)!.length, FOLD_CURVE.length);
  for (const v of [.1, .5, .9, .95]) assert.ok(Math.abs(curveAt(curveTime(v)) - v) < 1e-9, `inverse at ${v}`);
});

test('R5 fold mirror: no leaving row is ever clipped while it can still be seen (opacity > .05), at Fast and Premium', () => {
  for (const [speed, spring] of Object.entries(speeds)) for (const n of [1, 2, 3, 6, 9, 14, 20]) for (const slide of [-1, 0.5, 1]) {
    const list = rows(n), span = n * 32, plan = foldPlan(list, slide < 0 ? 0 : span * slide, spring), bottom = 100 + span;
    for (let t = 0; t <= plan.wait + plan.spring + plan.fade + 80; t += .5) {
      const { opacity, edge } = foldAt(plan, list, t);
      list.forEach((row, i) => {
        const u = bottom - (row.top + row.height); // how far above the section's bottom the row's bottom sits
        if (edge > u + 1e-6) assert.ok(opacity[i] <= FOLD_GONE + 1e-3, `${speed} n=${n} slide=${slide}: row ${i} cut at ${t} ms while at ${opacity[i].toFixed(3)}`);
      });
    }
  }
});

test('R5 fold mirror: timing reversed — lowest row first, 16 ms apart (at most 64), the unfold\'s length, and the rows below wait only for the lowest fade', () => {
  const spring = speeds.fast, plan = foldPlan(rows(6), 6 * 32, spring);
  assert.deepEqual(plan.delays.slice(-5), [64, 48, 32, 16, 0], 'the reverse of the unfold\'s top-first stagger');
  for (let i = 1; i < plan.delays.length; i++) assert.ok(plan.delays[i] <= plan.delays[i - 1], 'never a higher row before a lower one');
  assert.equal(plan.spring, spring, 'the edge and the rows below glide on the unfold\'s spring and length');
  assert.ok(plan.wait > 0 && plan.wait <= spring * .25, `the rows below start as soon as the lowest row has faded (${plan.wait} ms)`);
  assert.ok(plan.fade < spring, 'a fade is quicker than the glide it hands over to');
  const premium = foldPlan(rows(6), 6 * 32, speeds.premium);
  assert.ok(premium.wait > plan.wait && premium.fade > plan.fade, 'Premium is a little longer, Fast quicker');
  const off = foldPlan(rows(6), 6 * 32, 0);
  assert.equal(off.wait + off.fade + off.spring + Math.max(...off.delays), 0, 'Off: nothing moves');
});

test('R5 fold mirror: wired in the sidebar — pictures keep their nesting and left edge, the clip has headroom for the rise', () => {
  const tsx = fs.readFileSync(path.resolve('src/components/sidebar/AciraSidebar.tsx'), 'utf8'), css = fs.readFileSync(path.resolve('src/components/sidebar/sidebar.css'), 'utf8');
  assert.match(tsx, /foldPlan\(leaving\.map/, 'useFlip plans every fold');
  assert.match(tsx, /delay:fold\.wait,fill:'backwards'/, 'the rows below wait for the fade, holding where they were');
  assert.match(tsx, /delay:fold\.delays\[at\],easing:SPRING/, 'each picture fades on the unfold\'s spring, on its own planned delay');
  assert.match(tsx, /opacity:0,transform:'translateY\(-4px\) scale\(\.98\)'/, 'back the way it came: up 4px and to 98%');
  assert.match(tsx, /item\.el\.animate\(\[\{opacity:from,transform:'translateY\(-4px\) scale\(\.98\)'\},\{opacity:1,transform:'none'\}\]/, 'the unfold it mirrors');
  assert.match(tsx, /ghost\.setAttribute\('data-nested',''\)/, 'a picture keeps its section\'s nesting');
  assert.match(tsx, /top:\(top-HEAD\)\+'px'/, 'the clip starts above the first row, so its rise is never cut');
  assert.match(tsx, /!springMs\(\)\)\{flipSkip=false;return;\}/, 'speed Off: instant');
  assert.match(css, /\.sb-flip-ghost\{z-index:1;pointer-events:none;transform-origin:0 50%\}/, 'a picture scales from its left edge, like the row');
  assert.match(css, /\.sb-flip-ghost\[data-nested\]\{--sb-nest:12px\}/);
  assert.match(css, /\.sb-zone-body\[data-nested\]\{--sb-nest:12px\}/, 'the same nesting as the live section');
});
