import test from 'node:test';
import assert from 'node:assert/strict';
import { settledBox, type SettlingElement } from '../src/ui/settledBox';

// R6: a new group's menu opens on the next frame at the box the group's chip/header settles into, not where its motion has it.
// A tiny model: an element's box is its layout offset, plus inline transforms (translate px) up its chain, plus the live offset
// of every animation that moves it (its own FLIP, an ancestor's, or a neighbour's width transition pushing it along).
type Anim = { playState: string; currentTime: number | null; offset: (time: number) => { x: number; y: number }; effect: { getComputedTiming(): { endTime: number } } };
const anim = (from: { x: number; y: number }, duration: number, now: number, playState = 'running'): Anim => ({
  playState, currentTime: now, offset: t => (t >= duration ? { x: 0, y: 0 } : { x: from.x * (1 - t / duration), y: from.y * (1 - t / duration) }), effect: { getComputedTiming: () => ({ endTime: duration }) },
});
const parse = (transform: string) => { const m = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(transform); return m ? { x: +m[1], y: +m[2] } : { x: 0, y: 0 }; };
function el(layout: { x: number; y: number; width: number; height: number }, parent: SettlingElement | null, opts: { classes?: string[]; transform?: string; movedBy?: Anim[] } = {}): SettlingElement {
  const node: SettlingElement = {
    parentElement: parent, style: { transform: opts.transform ?? '' },
    matches: selector => selector.split(',').some(s => (opts.classes ?? []).includes(s.trim().replace(/^\./, ''))),
    getBoundingClientRect() {
      let x = layout.x, y = layout.y;
      for (let at: SettlingElement | null = node; at; at = at.parentElement) { const t = parse(at.style.transform); x += t.x; y += t.y; }
      for (const a of opts.movedBy ?? []) { const o = a.offset(Number(a.currentTime)); x += o.x; y += o.y; }
      return { x, y, width: layout.width, height: layout.height };
    },
  };
  return node;
}

test('a sidebar header still sliding in (WAAPI FLIP) reads where it lands, and keeps sliding', () => {
  const list = el({ x: 0, y: 0, width: 240, height: 800 }, null), flip = anim({ x: 0, y: -3.4 }, 420, 0);
  const header = el({ x: 8, y: 164, width: 224, height: 32 }, list, { classes: ['sb-group-header'], movedBy: [flip] });
  assert.ok(header.getBoundingClientRect().y < 164, 'in flight it is above its place (measured: 160.6)');
  assert.deepEqual(settledBox(header, () => [flip]), { x: 8, y: 164, width: 224, height: 32 });
  assert.equal(flip.currentTime, 0, 'the motion carries on from where it was');
});

test('a strip chip pushed along by its neighbours\' width transitions reads where it ends up', () => {
  const strip = el({ x: 0, y: 0, width: 1280, height: 40 }, null), neighbours = anim({ x: 54.5, y: 0 }, 600, 0);
  const chip = el({ x: 486, y: 5, width: 124, height: 26 }, strip, { classes: ['tab-group-badge'], movedBy: [neighbours] });
  assert.equal(chip.getBoundingClientRect().x, 540.5, 'first frame (measured)');
  assert.deepEqual(settledBox(chip, () => [neighbours]), { x: 486, y: 5, width: 124, height: 26 });
  assert.equal(neighbours.currentTime, 0);
});

test('a projection transform on a strip item is lifted; the toolbar\'s own static offset is kept', () => {
  const toolbar = el({ x: 0, y: 0, width: 1280, height: 40 }, null, { transform: 'translate(0px, 6px)' });
  const tray = el({ x: 0, y: 0, width: 140, height: 34 }, toolbar, { classes: ['tab-group-header', 'tab-flow'], transform: 'translate(58px, 0px)' });
  const chip = el({ x: 487, y: 4, width: 123, height: 26 }, tray, { classes: ['tab-group-badge'] });
  assert.equal(chip.getBoundingClientRect().x, 545);
  assert.deepEqual(settledBox(chip, () => []), { x: 487, y: 10, width: 123, height: 26 });
  assert.equal(tray.style.transform, 'translate(58px, 0px)', 'put back');
});

test('a strip still scrolling to its goal shifts the chip by what is left of the scroll, until the tween is over', () => {
  const viewport = el({ x: 0, y: 0, width: 300, height: 34 }, null);
  Object.assign(viewport, { scrollLeft: 20, dataset: { scrollGoal: '80', scrollGoalUntil: '1000' } });
  const chip = el({ x: 240, y: 1, width: 96, height: 30 }, viewport, { classes: ['tab-group-badge'] });
  assert.deepEqual(settledBox(chip, () => [], () => 500), { x: 180, y: 1, width: 96, height: 30 }, '60px more to scroll: it ends 60px left');
  assert.deepEqual(settledBox(chip, () => [], () => 1200), { x: 240, y: 1, width: 96, height: 30 }, 'a stale goal is ignored');
});

test('finished, idle and endless animations are left alone', () => {
  const spinner = anim({ x: 3, y: 0 }, Infinity, 10), done = anim({ x: 9, y: 0 }, 100, 100, 'finished'), idle = anim({ x: 5, y: 0 }, 100, 0, 'idle');
  const row = el({ x: 10, y: 20, width: 100, height: 30 }, null, { movedBy: [done] });
  assert.deepEqual(settledBox(row, () => [spinner, done, idle]), row.getBoundingClientRect());
  assert.deepEqual([spinner.currentTime, done.currentTime, idle.currentTime], [10, 100, 0]);
});
