import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { motionTokens, springFor, stripEase, stripMs } from '../src/ui/motionTokens';
import { stripLeave, stripSeconds } from '../src/ui/sharedMotion';
import { classStretch, morphSpring } from '../src/ui/splitMotion';
import { homeRect, planMorph, type PaneBox } from '../src/ui/splitMorph';

const read = (file: string) => fs.readFileSync(path.resolve(file), 'utf8');
const near = (a: number, b: number, tol: number, label: string) => assert.ok(Math.abs(a - b) <= tol, `${label}: ${a} vs ${b}`);

test('motion polish: one strip spring, with a launch kick, drives the strip, the compact strip and the sidebar rows', () => {
  assert.equal(stripMs, 480);
  const css = read('src/styles/tab-motion.css'), sidebar = read('src/components/sidebar/AciraSidebar.tsx');
  assert.ok(css.includes(`--tab-ease:${stripEase};`), 'tab-motion.css carries the same string as motionTokens.stripEase');
  assert.match(sidebar, /const SPRING=stripEase,springMs=\(\)=>stripMs\*frequentStretch/, 'the sidebar rows move on the same curve and time');
  const stops = stripEase.slice(7, -1).split(',').map(Number);
  assert.equal(stops.length, 33); assert.equal(stops[0], 0); assert.equal(stops.at(-1), 1);
  assert.ok(stops[1] > .1, 'the first sample (15 ms) already shows over 10% of the change: the first frame answers the input');
  assert.ok(stops.every((v, i) => !i || v >= stops[i - 1]) && Math.max(...stops) <= 1, 'monotonic, no overshoot (an instrument, not a bounce)');
});

test('motion polish: a strip item leaving fades its content first and stays until its room has closed (no ghost, no second jump)', () => {
  for (const speed of ['fast', 'premium'] as const) {
    const leave = stripLeave('menu.fade', speed) as { opacity: (number | null)[]; transition: { duration: number; times: number[] } };
    near(leave.transition.duration, stripSeconds(speed) + .03, 1e-9, `${speed}: held for the strip spring`);
    assert.deepEqual(leave.opacity, [null, 0, 0]);
    const fadeAt = leave.transition.times[1] * leave.transition.duration;
    assert.ok(fadeAt < .17, `${speed}: content gone by ${Math.round(fadeAt * 1000)} ms`);
  }
  near(stripSeconds('premium'), .48 * 1.28, 1e-9, 'Premium takes 40% of the stretch, like --motion-f');
  assert.deepEqual(stripLeave('menu.fade', 'off'), { opacity: 0, transition: { duration: 0 } });
  for (const file of ['src/components/BrowserTabsHorizontal.tsx', 'src/components/CompactTabs.tsx']) assert.match(read(file), /const exit=useMemo\(\(\)=>reduced\?\{opacity:0,transition:\{duration:0\}\}:stripLeave\(\),\[reduced\]\)/, file);
  const header = read('src/components/SplitGroupHeader.tsx');
  assert.match(header, /leaving=!present&&!sidebar,shown=leaving\?\{\.\.\.style,'--tab-width':'0px'/, 'the split chip gives its room back while it leaves (Unsplit)');
  assert.match(header, /stripLeave\(\)/);
});

test('motion polish: split springs come from the one token table and fades take the effects stretch (1.4), not the spatial one', () => {
  assert.equal(classStretch('tab.merge', 1.7), 1.7); near(classStretch('menu.fade', 1.7), 1.4, 1e-9, 'E at Premium'); assert.equal(classStretch('drag.follow', 1.7), 1);
  const fade = morphSpring('menu.fade', 1.7) as { stiffness: number }, d = (springFor('menu.fade', 'premium')!.duration);
  near(2 * Math.PI / Math.sqrt(fade.stiffness), d, .003, 'the split fade equals the app-wide Premium menu.fade');
  assert.doesNotMatch(read('src/ui/splitMotion.ts'), /const TOKENS/, 'no second token table');
  assert.equal(motionTokens['tab.merge'][1], .310);
});

test('Unsplit: the page that leaves flies back into its tab (clamped into the page area) and fades as it lands', () => {
  const box = (tabId: string, x: number, y: number, width: number, height: number): PaneBox => ({ tabId, x, y, width, height });
  const split = [box('a', 0, 0, 597, 700), box('b', 603, 0, 597, 700)];
  const home = homeRect({ x: 420, y: -34, width: 180, height: 30 }, { width: 1200, height: 700 });
  assert.deepEqual(home, { x: 420, y: 0, width: 180, height: 30 }, 'a strip tab above the page: right under it, inside the page area');
  assert.deepEqual(homeRect({ x: -250, y: 120, width: 230, height: 32 }, { width: 1200, height: 700 }), { x: 0, y: 120, width: 230, height: 32 }, 'a sidebar row to the left');
  const items = planMorph(split, [box('a', 0, 0, 1200, 700)], undefined, { b: home });
  const b = items.find(item => item.tabId === 'b')!;
  assert.equal(b.kind, 'exit'); assert.equal(b.home, true); assert.deepEqual(b.to, home); assert.deepEqual(b.from, { x: 603, y: 0, width: 597, height: 700 });
  assert.equal(planMorph(split, [box('a', 0, 0, 1200, 700)]).find(item => item.tabId === 'b')!.home, undefined, 'without a tab on screen it fades in place');
  const layer = read('src/components/SplitMorphLayer.tsx'), app = read('src/App.tsx');
  assert.match(layer, /morphSpring\(item\.kind === 'exit' && !item\.home \? 'menu\.fade' : morphToken\(intent\), scale\)/, 'a homing page rides the intent spring');
  assert.match(layer, /\.\.\.\(item\.home \? \{ opacity: fadeLate \} : \{\}\)/);
  assert.match(app, /homes\[id\] = homeRect\(/, 'App finds each leaving tab in the strip, compact strip or sidebar');
});
