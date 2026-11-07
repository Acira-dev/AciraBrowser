import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { createInitialState, reduceBrowser } from '../src/runtime/core';
import { morphDirection } from '../src/ui/sidebarMode';
import {
  ARC, LEAVE, LAG_MS, OPEN_MS, RAIL_IN, PILL_IN, arriving, bowCrossings, delayRowChange, layoutAt, leaving, moverBox, occlusion, pageCorner, pageGlide, progressAt, ramp, schedule, totalMs,
  type LayoutNumbers, type Mover, type Schedule,
} from '../src/ui/sidebarMorphPlan';

const require = createRequire(import.meta.url);
// Sidebar mode's morph (ui/sidebarMorph.ts plays it; ui/sidebarMorphPlan.ts is the choreography as numbers). The page of a website is a native view drawn ABOVE the interface, so the
// plan's whole shape comes from one fact: anything the interface moves under the page's rectangle is hidden by it. These tests pin that: the pieces are never covered, and they never
// leave the window, on the real geometry of every starting layout (measured in the app: 1200 x 790 window, 240 px sidebar, 28 px buttons).

const flat: LayoutNumbers = { col: 0, hdr: 72, mt: 0, mr: 0, mb: 0, ml: 0, radius: 0, ring: 0 };
const card: LayoutNumbers = { col: 240, hdr: 6, mt: 0, mr: 6, mb: 6, ml: 0, radius: 8, ring: 1 };
const mover = (id: string, first: number[], last: number[], extra: Partial<Mover> = {}): Mover => ({ id, first: { x: first[0], y: first[1], width: first[2], height: first[3] }, last: { x: last[0], y: last[1], width: last[2], height: last[3] }, attach0: false, attach1: false, bow: 0, resizes: false, xDelay: 0, yDelay: 0, ...extra });
const sidebarOf = (items: Mover[], reverse: boolean) => reverse ? items.map(m => ({ ...m, first: m.last, last: m.first, attach0: m.attach1, attach1: m.attach0 })) : items;

// tabs on top (Full), tabs in the sidebar with the toolbar row, Compact with tabs on top
const scenes = {
  'tabs on top': { a: flat, b: card, items: () => [mover('back', [12, 40, 28, 28], [78, 4, 28, 28]), mover('forward', [44, 40, 28, 28], [134, 4, 28, 28]), mover('reload', [76, 40, 28, 28], [106, 4, 28, 28]), mover('address', [240, 40, 720, 28], [8, 38, 224, 28], { resizes: true, attach1: true })] },
  'tabs in the sidebar': { a: { ...card, hdr: 36 }, b: card, items: () => [mover('toggle', [252, 4, 28, 28], [204, 4, 28, 28]), mover('back', [288, 4, 28, 28], [78, 4, 28, 28]), mover('forward', [328, 4, 28, 28], [134, 4, 28, 28]), mover('reload', [368, 4, 28, 28], [106, 4, 28, 28]), mover('address', [400, 4, 560, 28], [8, 38, 224, 28], { resizes: true, attach1: true })] },
  'Compact, tabs on top': { a: { ...flat, hdr: 32 }, b: card, items: () => [mover('back', [92, 2, 28, 28], [78, 4, 28, 28]), mover('forward', [122, 2, 28, 28], [134, 4, 28, 28]), mover('reload', [152, 2, 28, 28], [106, 4, 28, 28]), mover('address', [431, 3, 412, 26], [8, 38, 224, 28], { resizes: true, attach1: true })] },
} as const;

/** Play a morph the way the engine does and return, per piece, the worst fraction of it the page covers and the path it took. */
function play(name: keyof typeof scenes, direction: 'in' | 'out', scale = 1) {
  const scene = scenes[name], on = direction === 'in', first = on ? scene.a : scene.b, last = on ? scene.b : scene.a;
  const sch = schedule(direction, scale), items = sidebarOf(scene.items(), !on);
  bowCrossings(items, Math.max(first.hdr, last.hdr)); delayRowChange(items, sch); sch.total = totalMs(sch, items);
  const worst: Record<string, number> = {}, minX: Record<string, number> = {}, maxBottom: Record<string, number> = {}, xs: Record<string, number[]> = {};
  for (let ms = 0; ms <= sch.total + 40; ms += 4) {
    const now = layoutAt(first, last, sch, ms), page = pageCorner(first, last, sch, ms);
    for (const m of items) {
      const box = moverBox(m, first, last, now, sch, ms);
      worst[m.id] = Math.max(worst[m.id] ?? 0, occlusion(box, page));
      minX[m.id] = Math.min(minX[m.id] ?? 1e9, box.x); maxBottom[m.id] = Math.max(maxBottom[m.id] ?? 0, box.y + box.height);
      (xs[m.id] ??= []).push(box.x);
    }
  }
  return { sch, items, worst, minX, maxBottom, xs, first, last };
}

test('turning it on collapses the header: the page\'s top edge lags and the pieces lead; off is the mirror', () => {
  const on = schedule('in', 1), off = schedule('out', 1);
  assert.deepEqual([on.lagX, on.lagY, on.moveDelay], [0, LAG_MS, 0]);
  assert.deepEqual([off.lagX, off.lagY, off.moveDelay], [LAG_MS, 0, OPEN_MS], 'off: the band opens first, the pieces cross it, the sidebar\'s edge follows');
  const fast = schedule('in', .6);
  assert.equal(fast.lagY, Math.round(LAG_MS * .6));
  assert.ok(fast.drawer.duration < on.drawer.duration && fast.total < on.total, 'Fast is a shorter morph');
  const turned = schedule('out', 1, true);
  assert.deepEqual([turned.lagX, turned.lagY, turned.moveDelay], [0, 0, 0], 'a morph turned round half way waits for nothing');
  assert.ok(on.total >= PILL_IN[1] && on.total <= 500, 'about 420 ms at Premium: faster than the half second it was');
});

test('the spring: nothing before its delay, monotonic, exactly 1 once settled', () => {
  const spec = { duration: .2, bounce: 0 };
  assert.equal(progressAt(spec, 50, 100), 0);
  let before = 0;
  for (let ms = 0; ms <= 400; ms += 4) { const p = progressAt(spec, ms); assert.ok(p >= before - 1e-9, `monotonic at ${ms}`); assert.ok(p <= 1); before = p; }
  assert.equal(progressAt(spec, 2000), 1);
  assert.equal(pageGlide(on('in')).spring.bounce, 0, 'critically damped: nothing overshoots');
  function on(d: 'in' | 'out') { return schedule(d, 1); }
});

test('the layout numbers: the column and the side margins on the x clock, the header and the vertical margins on the y clock, each held back by its lag', () => {
  const sch = schedule('in', 1), mid = layoutAt(flat, card, sch, 90);
  assert.ok(mid.col > 100 && mid.col < 240, 'the sidebar\'s column is travelling');
  assert.equal(mid.hdr, 72, 'the header has not moved: the page\'s top edge is waiting');
  assert.equal(layoutAt(flat, card, sch, 0).col, 0);
  const end = layoutAt(flat, card, sch, sch.total);
  assert.deepEqual(end, card, 'it ends exactly on the layout React drew');
  const out = schedule('out', 1), back = layoutAt(card, flat, out, 90);
  assert.equal(back.col, 240, 'off: the column waits');
  assert.ok(back.hdr > 40, 'while the band opens');
});

for (const name of Object.keys(scenes) as (keyof typeof scenes)[]) for (const direction of ['in', 'out'] as const) test(`${name}, ${direction === 'in' ? 'on' : 'off'}: no piece is covered by the page, none leaves the window, the address field only moves one way`, () => {
  const { worst, minX, maxBottom, xs, first, last } = play(name, direction);
  for (const [id, share] of Object.entries(worst)) assert.ok(share <= .02, `${id} is covered ${(share * 100).toFixed(1)}% by the page`);
  for (const [id, x] of Object.entries(minX)) assert.ok(x >= -1, `${id} stays inside the window (x ${x.toFixed(0)})`);
  for (const [id, bottom] of Object.entries(maxBottom)) assert.ok(bottom <= Math.max(first.hdr, last.hdr, 72) + 40, `${id} bottom ${bottom.toFixed(0)}`);
  const path = xs.address, rising = path[path.length - 1] >= path[0] - 1e-6, falling = path[path.length - 1] <= path[0] + 1e-6;
  for (let i = 1; i < path.length; i++) assert.ok(rising ? path[i] >= path[i - 1] - .5 : falling ? path[i] <= path[i - 1] + .5 : true, 'x is monotonic at step ' + i);
});

test('Fast and Premium both keep the pieces clear of the page', () => {
  for (const scale of [.6, 1]) for (const name of Object.keys(scenes) as (keyof typeof scenes)[]) for (const direction of ['in', 'out'] as const) {
    const { worst } = play(name, direction, scale);
    for (const [id, share] of Object.entries(worst)) assert.ok(share <= .03, `${name} ${direction} x${scale}: ${id} ${(share * 100).toFixed(1)}%`);
  }
});

test('Forward and Reload swap places: they bow in opposite directions as far as the band allows, and simply pass when it allows nothing', () => {
  const trio = () => [mover('back', [12, 40, 28, 28], [78, 4, 28, 28]), mover('forward', [44, 40, 28, 28], [134, 4, 28, 28]), mover('reload', [76, 40, 28, 28], [106, 4, 28, 28])];
  const roomy = bowCrossings(trio(), 72), byId = Object.fromEntries(roomy.map(m => [m.id, m.bow]));
  assert.ok(byId.forward * byId.reload < 0 && Math.abs(byId.forward) >= 6 && Math.abs(byId.forward) <= ARC, JSON.stringify(byId));
  assert.equal(byId.back, 0, 'Back keeps its order');
  assert.ok(bowCrossings(trio(), 36).every(m => m.bow === 0), 'a 36 px row has no room to bow');
  assert.ok(bowCrossings([mover('a', [10, 4, 28, 28], [50, 4, 28, 28]), mover('b', [60, 4, 28, 28], [100, 4, 28, 28])], 72).every(m => m.bow === 0), 'no swap, no bow');
});

test('the wide address field that changes row crosses sideways first on the way in, rises first on the way out', () => {
  const sch = schedule('in', 1), down = delayRowChange([mover('address', [400, 4, 560, 28], [8, 38, 224, 28], { resizes: true })], sch)[0];
  assert.ok(down.yDelay > 100 && down.xDelay === 0);
  const off = schedule('out', 1), up = delayRowChange([mover('address', [8, 38, 224, 28], [431, 3, 412, 26], { resizes: true })], off)[0];
  assert.equal(up.yDelay, -off.moveDelay, 'it rises at once, inside the sidebar\'s column');
  assert.equal(delayRowChange([mover('back', [12, 40, 28, 28], [78, 4, 28, 28])], sch)[0].yDelay, 0, 'the buttons do not wait');
  assert.ok(totalMs(sch, [down]) >= sch.moveDelay + down.yDelay);
});

test('the pieces that only one layout has: the old chrome leaves quickly, the sidebar\'s contents and the pill arrive last', () => {
  assert.equal(leaving(LEAVE, 0), 1); assert.equal(leaving(LEAVE, LEAVE[1]), 0);
  assert.ok(leaving(LEAVE, LEAVE[1] / 2) < .3, 'a fast fall, not a linear one');
  assert.equal(arriving(RAIL_IN, RAIL_IN[0] - 1), 0); assert.equal(arriving(RAIL_IN, RAIL_IN[1] + 1), 1);
  assert.ok(RAIL_IN[0] > LEAVE[1] && PILL_IN[0] > RAIL_IN[0], 'the old chrome is gone before the sidebar\'s contents settle in, and the pill is last');
  assert.equal(arriving(RAIL_IN, 0, 1, .4), .4, 'an interrupted morph carries the opacity it had');
  assert.equal(ramp([0, 100], 100, 2), ramp([0, 200], 100), 'the speed setting scales the windows');
});

test('main gets the morph\'s spring and the lag of the pair that waits (and only that one)', () => {
  assert.deepEqual(pageGlide(schedule('in', 1)).lag, { y: LAG_MS });
  assert.deepEqual(pageGlide(schedule('out', 1)).lag, { x: LAG_MS });
  assert.deepEqual(pageGlide(schedule('in', 1, true)).lag, {});
  assert.deepEqual(pageGlide(schedule('in', .6)).spring, { duration: .2 * .6, bounce: 0 });
});

test('which way the morph plays: Sidebar mode flipping, or whatever layout change arrives while one is playing', () => {
  const settings = (verticalTabs: boolean, addressInSidebar: boolean) => ({ settings: { verticalTabs, addressInSidebar } });
  assert.equal(morphDirection(settings(false, false), settings(true, true), false, true, 'out'), 'in');
  assert.equal(morphDirection(settings(true, true), settings(false, false), false, true, 'in'), 'out');
  assert.equal(morphDirection(settings(true, false), settings(true, true), false, true, 'out'), 'in', 'the address row alone completes the mode');
  assert.equal(morphDirection(settings(true, true), settings(true, true), false, true, 'in'), null, 'a sidebar toggle with the mode unchanged is the view transition\'s, as ever');
  assert.equal(morphDirection(settings(true, true), settings(true, true), true, true, 'out'), 'out', 'while a morph plays every layout change joins it: no view transition under it');
  assert.equal(morphDirection(settings(true, true), settings(true, true), true, false, 'out'), null);
});

test('one action carries the whole switch: reducer, validator and the allowed list agree', () => {
  const state = createInitialState();
  state.windowUi = { ...state.windowUi, workspaceOpen: false, webWorkspaceOpen: false };
  const on = reduceBrowser(state, { type: 'sidebar.mode', tabs: true, address: true, open: true });
  assert.equal(on.settings.verticalTabs, true); assert.equal(on.settings.addressInSidebar, true);
  assert.equal(on.windowUi.workspaceOpen, true, 'the sidebar opens with it');
  const kept = reduceBrowser(on, { type: 'sidebar.mode', tabs: false, address: false });
  assert.equal(kept.settings.verticalTabs, false); assert.equal(kept.settings.addressInSidebar, false);
  assert.equal(kept.windowUi.workspaceOpen, true, 'without `open` the sidebar is left as it is');
  const { validateAction } = require('../desktop/validation.cjs');
  assert.doesNotThrow(() => validateAction({ type: 'sidebar.mode', tabs: true, address: true, open: true }, state));
  assert.doesNotThrow(() => validateAction({ type: 'sidebar.mode', tabs: false, address: false }, state));
  assert.throws(() => validateAction({ type: 'sidebar.mode', tabs: 'yes', address: true }, state));
  assert.throws(() => validateAction({ type: 'sidebar.mode', tabs: true }, state));
  assert.match(readFileSync(new URL('../desktop/main.cjs', import.meta.url), 'utf8'), /'settings\.update','sidebar\.mode','ui\.update'/, 'the window may send it');
});

test('the layout message may carry the morph\'s lag and hold; the page glide start is announced to the interface', () => {
  const { validateLayout } = require('../desktop/validation.cjs'), state = createInitialState();
  assert.doesNotThrow(() => validateLayout({ views: [], visible: true, pageSpring: { duration: .2, bounce: 0 }, pageEdgeLag: { y: 180 }, pageHold: true }, state));
  assert.throws(() => validateLayout({ views: [], visible: true, pageEdgeLag: { y: 9000 } }, state));
  assert.throws(() => validateLayout({ views: [], visible: true, pageHold: 'yes' }, state));
  const main = readFileSync(new URL('../desktop/main.cjs', import.meta.url), 'utf8');
  assert.match(main, /next\.pageHold===true&&animated\)emitBrowser\(\{type:'page-glide',at:Date\.now\(\)\}\)/);
  assert.match(main, /next\.pageHold===true\)&&next\.views\.length===1/, 'the held glide is for any view, one page');
});

test('the engine keeps off the other transitions and restores everything it set (source check of the contract)', () => {
  const src = readFileSync(new URL('../src/ui/sidebarMorph.ts', import.meta.url), 'utf8');
  for (const piece of ["'data-sm-morph'", "'data-sm-rail'", "'data-sm-pin'"]) assert.ok(src.includes(piece), piece);
  assert.match(src, /root\.setAttribute\('data-mode-switch', 'morph'\)/, 'a view transition cannot start under it');
  assert.match(src, /item\.el\.style\.translate = item\.translate; item\.el\.style\.opacity = item\.opacity;/, 'inline styles go back to what they were');
  const client = readFileSync(new URL('../src/runtime/client.ts', import.meta.url), 'utf8');
  assert.match(client, /morph&&startSidebarMorph\(\(\)=>flushSync\(applyNow\),morph\)/, 'the snapshot plays as the morph');
  assert.match(client, /applyNow=\(\)=>\{apply\(next\);if\(morph\)syncRail\(next\);/, 'the profile\'s tabs switch goes in the same render, however the switch is played');
  assert.match(client, /if\(kind==='layout'&&sidebarMorphRunning\(\)&&startSidebarMorph\(update,sidebarMorphDirection\(\)\)\)return;/, 'a layout switch asked for while it plays joins it');
  assert.match(client, /'sidebar\.mode'\]\)/, 'the local press starts it on the press frame');
});

test('the bare state (sidebar away, nothing above the page) still works: focus waits for a drawn field, the strip drags the window, a load shows its line, fullscreen has no strip', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8'), css = readFileSync(new URL('../src/styles/address-in-sidebar.css', import.meta.url), 'utf8'), client = readFileSync(new URL('../src/runtime/client.ts', import.meta.url), 'utf8');
  assert.match(app, /!input\.closest\('\[inert\]'\) && getComputedStyle\(input\)\.visibility !== 'hidden'\) focusNow\(\)/, 'Ctrl/Cmd+L on a closed sidebar: the field is focused once the sidebar has made it visible, not while it is hidden');
  assert.match(css, /\[data-sbmode='bare'\] \{ overflow: hidden; -webkit-app-region: drag; \}/, 'the strip that is left moves the window');
  assert.match(app, /effectiveMode!=='standard'\|\|topBarHidden\|\|sbHeader==='bare'\)&&<NavigationProgress/, 'a page loading shows its line where the address field is not drawn');
  assert.match(app, /const addrStrip = sbChrome \? windowFullscreen \? 0 : addressStripHeight\(/, 'a fullscreen window has no strip');
  assert.match(client, /const stale=!!optimistic\.current&&next\.revision<optimistic\.current\.base\+optimistic\.current\.count,morph=stale\?null:morphOf\(latest\.current,next\)/, 'a snapshot older than the local switch is never a morph');
  assert.match(client, /if\(action\.type==='sidebar\.mode'&&direction\)modeSwitch\(settle,'layout'\);else settle\(\);/, 'a morph that cannot play falls back to the view transition, not to a cut');
  const engine = readFileSync(new URL('../src/ui/sidebarMorph.ts', import.meta.url), 'utf8');
  assert.match(engine, /catch \(error\) \{ abort\(\); throw error; \}/, 'a failed start leaves the plain window');
  assert.match(engine, /setVar\(m, m\.bar, '--sm-hdr'/, 'the bookmarks row reads the header\'s height from its own element');
});
