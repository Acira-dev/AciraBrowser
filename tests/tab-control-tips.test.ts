import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { placeTooltip, type TooltipRect } from '../src/ui/tooltipPlacement';

/** Founder after beta.7: a tab's own controls (its close button, its info) and the tab hover card must never cover working controls (the
 * tab's close, the next tabs and their controls, the toolbar's buttons). The tip of a tab's close button only kept off the website and
 * the window buttons: in Compact and Focus it opened to the right over the next tabs, their close buttons, New tab and the address
 * field (measured in the app: one tip over nine controls), and in the top strip under the close button over the address field. */
const require = createRequire(import.meta.url);
const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const rect = (left: number, top: number, right: number, bottom: number): TooltipRect => ({ left, top, right, bottom });
const overlaps = (a: TooltipRect, b: TooltipRect) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
const boxOf = (p: { x: number; y: number }, width: number, height = 24) => rect(p.x - width / 2, p.y - height / 2, p.x + width / 2, p.y + height / 2);
const viewport = { width: 1200, height: 738 }, mac = rect(0, 0, 86, 32);

test('Compact and Focus root cause: the close button\'s tip took the free side over the next tabs; kept clear of them it finds no spot and stays quiet', () => {
  const page = rect(0, 32, 1200, 738), close = rect(338, 10, 354, 26), width = 111;
  // Its own tab is 270..359 (85px, the pointer's); before it a tab and the Home and All open tabs buttons, after it the next tabs.
  const neighbours = [rect(181, 2, 266, 30), rect(363, 2, 448, 30), rect(452, 2, 537, 30), rect(541, 6, 565, 28)/* New tab */, rect(600, 4, 1000, 28)/* address */, rect(120, 4, 144, 28), rect(150, 4, 174, 28)];
  const before = placeTooltip(close, width, viewport, page, mac, 24);
  assert.ok(before && before.side === 'right', 'today: beside, to the right');
  assert.ok(neighbours.some(other => overlaps(boxOf(before, width), other)), 'over the next tab');
  assert.equal(placeTooltip(close, width, viewport, page, mac, 24, false, neighbours), null, 'every side is the page, off the window or another control');
  assert.match(read('src/components/transient/Tooltip.tsx'), /\|\| \(row \? 'quiet' : false\);/, 'and a tab\'s control with no clear spot shows no tip (the system tooltip would land on the toolbar)');
  const wide = placeTooltip(close, width, viewport, page, mac, 24, false, neighbours.slice(1));
  assert.ok(wide && wide.side === 'left' && boxOf(wide, width).left >= 181, 'a wider own tab (no tab right before it) takes the tip over its title');
});

test('Top strip: the close button\'s tip leaves the address field and goes beside it, over its own tab\'s title', () => {
  const page = rect(0, 72, 1200, 738), close = rect(400, 10, 416, 26), width = 111;
  const neighbours = [rect(425, 3, 625, 33)/* next tab */, rect(240, 40, 960, 68)/* address */, rect(12, 40, 36, 68), rect(44, 40, 68, 68), rect(76, 40, 100, 68), rect(108, 40, 132, 68)];
  const before = placeTooltip(close, width, viewport, page, mac, 24);
  assert.ok(before && before.side === 'below' && overlaps(boxOf(before, width), neighbours[1]), 'today: under the close button, over the address field');
  const after = placeTooltip(close, width, viewport, page, mac, 24, false, neighbours);
  assert.ok(after && after.side === 'left', JSON.stringify(after));
  const box = boxOf(after, width);
  assert.ok(neighbours.every(other => !overlaps(box, other)) && box.left >= 221, 'on its own tab only');
});

test('A side that is blocked where it is centred is tried slid along, still touching the control', () => {
  const trigger = rect(100, 10, 116, 26), width = 80, page = rect(0, 600, 1200, 738), caption = rect(1200, 0, 1200, 0);
  const avoid = [rect(112, 30, 140, 60), rect(100, 0, 160, 8)];
  assert.equal(placeTooltip(trigger, width, viewport, page, caption, 24)?.side, 'below', 'centred below without neighbours');
  const slid = placeTooltip(trigger, width, viewport, page, caption, 24, false, avoid);
  assert.ok(slid && slid.side === 'below', JSON.stringify(slid));
  const box = boxOf(slid, width);
  assert.ok(box.right <= 112 && box.right > trigger.left, 'slid left of the neighbour, still under the control');
});

test('Without neighbours (every other control) the placement is exactly as before', () => {
  const sidebarClose = rect(206, 140, 226, 156), page = rect(240, 36, 1200, 738);
  const before = placeTooltip(sidebarClose, 111, viewport, page, mac, 24, true), after = placeTooltip(sidebarClose, 111, viewport, page, mac, 24, true, [rect(8, 172, 232, 204), rect(8, 100, 232, 132)]);
  assert.deepEqual(after, before, 'a sidebar row\'s close tip opens over its own row, as before, clear of the rows above and below');
  assert.equal(before?.side, 'left');
});

test('The tab card\'s native view stops at the toolbar\'s line beside a sidebar tab near the top: its shadow room takes the pointer too', () => {
  const { cardPlacement } = require('../desktop/tab-card.cjs');
  const placed = cardPlacement({ anchor: { x: 8, y: 40, width: 224, height: 32 }, side: 'right', height: 76, window: { width: 1200, height: 738 }, floor: 36 });
  assert.equal(placed.side, 'right');
  assert.ok(placed.card.y >= 36 && placed.bounds.y >= 36, JSON.stringify(placed));
  assert.equal(placed.card.y - placed.bounds.y, placed.inset.top, 'the page is told the inset it was given');
  const lower = cardPlacement({ anchor: { x: 8, y: 160, width: 224, height: 32 }, side: 'right', height: 76, window: { width: 1200, height: 738 }, floor: 36 });
  assert.equal(lower.card.y - lower.bounds.y, 24, 'lower down it keeps its whole shadow room');
});

test('Wiring: a control inside a tab row is placed clear of its neighbours (the next tabs, their controls, the toolbar\'s buttons)', () => {
  const tip = read('src/components/transient/Tooltip.tsx');
  assert.match(tip, /const row = el\.parentElement\?\.closest<HTMLElement>\(TAB_ROW\) \?\? null, avoid = row \? tabControlNeighbours\(el, row\) : undefined;/);
  assert.match(tip, /placeTooltip\(r,w,\{width:innerWidth,height:innerHeight\},page,caption,h,[^;]*,avoid\);/);
  assert.match(tip, /if \(current === el && show\(el\) === false\) restore\(el\);/, 'a quiet tip keeps the title held, so the system tooltip does not show either');
  assert.match(tip, /if \(row\.contains\(other\) && box\.width >= own\.width \/ 2\) continue;/, 'its own row\'s body may be covered, its other small controls may not');
});
