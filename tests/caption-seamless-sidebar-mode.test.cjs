'use strict';
// 13.5, Windows, Seamless + Sidebar + address: the minimise, maximise and close buttons (reported 9 Nov 2026: "glitch").
//
// What was wrong. Sidebar + address switches the top edge off (main.cjs edgeItem.edges: { top: false, side: true }: there is no toolbar to bring down), but in Seamless the interface still
// hid the caption (captionHidden + captionFloat: its "top bar is hidden" flags) and waited for the top edge to bring it back with the toolbar. That reveal belongs to the top zone, which does
// not exist in this layout, so hovering the top (corner, middle, anywhere) never showed anything; the only way back was the corner fallback (caption-watch.cjs: the pointer STAYS in the
// corner for 1.2 s), and until then the hidden buttons were a dead native corner (minimise and maximise off, close refused) over the page's top right. The person saw: nothing at the top,
// a page control in that corner that does not answer, then a box with three buttons popping up a second later and going half a second after the pointer left.
//
// The fix: the caption is the notch there, as it is in Full (caption-notch.cjs): 34 px of the three buttons, shown while the pointer is along the top, as one piece.
//
// Here main's OWN caption code and its OWN edge item are cut out of desktop/main.cjs and run against a fake Windows window with the real edge poller (desktop/edge-reveal.cjs) on a fake
// clock. The two layouts are what the real interface published in this state (read back from the Windows stand-in with getBrowserLayout(), 9 Nov 2026): 13.4's and 13.5's.
// The interface's own decision is pinned in tests/caption-seamless-sidebar-mode.test.ts and checked in the real app by the regression guard's c7 (qa/regression-guard/lib/caption.mjs).
const test = require('node:test');
const assert = require('node:assert/strict');
const { realMainCaption, seen } = require('./caption-main-vm.cjs');
const { watchChromeEdges } = require('../desktop/edge-reveal.cjs');
const runtime = require('../desktop/runtime.cjs');

const LAYOUT_13_4 = { captionHidden: true, captionFloat: true, captionNotch: false, captionHeight: 36 };
const LAYOUT_13_5 = { captionNotch: true, captionHeight: 34 };
const state = { settings: { verticalTabs: true, addressInSidebar: true, windowView: 'seamless' }, windowUi: { view: 'seamless', workspaceOpen: false, webWorkspaceOpen: false }, tabs: [{ id: 'tab-1', contentKind: 'web' }], activeTabId: 'tab-1' };
const STEP = 16;

function rig(layout) {
  const ctx = realMainCaption({ layout: { ...layout }, edge: { state } });
  ctx.api.setCaption();
  let next = null;
  watchChromeEdges({ app: { whenReady: () => ({ then: fn => fn() }), on() {} }, windows: () => [ctx.api.edgeItem], screen: ctx.screen, view: s => runtime.effectiveView(s.settings, s.windowUi), now: () => ctx.clock.t, schedule: fn => { next = fn; return { unref() {} }; }, cancel() {} });
  const b = ctx.state.bounds, at = (x, y) => ({ x: b.x + x, y: b.y + y });
  const away = at(500, 400), corner = at(b.width - 40, 3), middle = at(Math.round(b.width / 2), 3), onNotch = at(b.width - 60, 20);
  ctx.screen.point = away;
  const box = () => seen(ctx.state.states.at(-1));
  /** Runs the poller every STEP ms (what main's timer does while an edge is active), with the caption's own timers on the same clock; records what is on screen after each look. */
  const run = ms => { const frames = []; for (let t = 0; t < ms; t += STEP) { ctx.advance(STEP); const fn = next; next = null; if (fn) fn(); frames.push({ t, box: box() }); } return frames; };
  const first = frames => { const hit = frames.find(frame => frame.box && frame.box.buttons === 3); return hit ? hit.t : null; };
  const widths = frames => [...new Set(frames.filter(frame => frame.box).map(frame => frame.box.buttons))];
  return { ctx, run, first, widths, at, away, corner, middle, onNotch, point: p => { ctx.screen.point = p; }, box };
}
const warm = r => { r.point(r.away); r.run(400); };

test('main\'s own edge item says Sidebar + address has no top edge, in Seamless: the cause', () => {
  const r = rig(LAYOUT_13_4), item = r.ctx.api.edgeItem;
  assert.deepEqual(JSON.parse(JSON.stringify(item.edges())), { top: false, side: true });
  assert.equal(runtime.effectiveView(state.settings, state.windowUi), 'seamless');
});

test('13.4: hovering the top of the window shows nothing, and the corner only after its 1.2 s fallback (the reported glitch)', () => {
  const middle = rig(LAYOUT_13_4); warm(middle); middle.point(middle.middle);
  const idle = middle.run(3000);
  assert.equal(middle.first(idle), null, 'a rest at the top, anywhere but the corner: nothing in 3 s');
  const r = rig(LAYOUT_13_4); warm(r); r.point(r.corner);
  const frames = r.run(2500);
  const when = r.first(frames);
  assert.ok(when !== null && when >= 1100, `the corner shows the buttons only at ${when} ms (the corner fallback's dwell is 1200)`);
  assert.equal(r.ctx.state.minimizable === true || r.ctx.state.maximizable === true, true, 'then they are on');
  // until then the hidden caption is a dead corner: minimise and maximise off, so a click there reaches nothing
  const dead = rig(LAYOUT_13_4); warm(dead); dead.point(dead.corner); dead.run(600);
  assert.equal(dead.ctx.api.guard.held(), true, 'minimise and maximise are held off while the pointer waits in the corner');
  assert.equal(dead.box(), null, 'and nothing is drawn there');
});

test('13.5: the notch shows at once in the corner and after a short rest anywhere along the top, as one piece of three buttons', () => {
  const c = rig(LAYOUT_13_5); warm(c); c.point(c.corner);
  const corner = c.run(400);
  assert.ok(c.first(corner) !== null && c.first(corner) <= STEP * 3, `the corner shows it at ${c.first(corner)} ms`);
  assert.deepEqual(c.widths(corner), [3], 'never a box of one or two buttons');
  const m = rig(LAYOUT_13_5); warm(m); m.point(m.middle);
  const rest = m.run(600);
  assert.ok(m.first(rest) !== null && m.first(rest) <= 160, `a rest at the top shows it at ${m.first(rest)} ms`);
  assert.deepEqual(m.widths(rest), [3]);
});

test('13.5: it stays while the pointer is on the buttons, goes when the pointer is in the page, and the buttons are guarded while it is away', () => {
  const r = rig(LAYOUT_13_5); warm(r);
  assert.equal(r.box(), null, 'at rest, pointer in the page: nothing');
  assert.equal(r.ctx.api.guard.held(), true, 'minimise and maximise are held off while it is hidden (a click on the transparent buttons does nothing)');
  r.point(r.corner); r.run(300);
  r.point(r.onNotch);
  assert.equal(r.first(r.run(1500)), 0, 'on the buttons it stays');
  r.point(r.away);
  const gone = r.run(2500);
  assert.equal(gone.at(-1).box, null, 'the pointer in the page: it is gone');
  assert.equal(r.ctx.api.guard.held(), true);
  const sweep = []; for (const frame of gone) if (frame.box && frame.box.buttons !== 3) sweep.push(frame);
  assert.deepEqual(sweep, [], 'and it never went through a narrower box');
});

test('13.5: no overlay with fewer than three buttons is ever on screen, through a reveal, a hide and a second reveal', () => {
  const r = rig(LAYOUT_13_5); warm(r);
  const frames = [];
  r.point(r.corner); frames.push(...r.run(500));
  r.point(r.away); frames.push(...r.run(2200));
  r.point(r.middle); frames.push(...r.run(600));
  assert.deepEqual(r.widths(frames), [3]);
  for (const s of r.ctx.state.states) { const b = seen(s); assert.ok(!b || b.buttons === 3, `after ${s.call}: ${b && b.buttons} buttons`); }
});

// ---- edge paths (no errors, glitches or crashes): repeats, jitter, layout changes under the pointer, window events -------------------------------------------------
const setLayout = (r, layout) => { for (const key of ['captionHidden', 'captionFloat', 'captionNotch', 'captionHeight']) delete r.ctx.layout[key]; Object.assign(r.ctx.layout, layout); r.ctx.api.setCaption(); };
const everyBoxIsFull = r => { for (const s of r.ctx.state.states) { const b = seen(s); assert.ok(!b || b.buttons === 3, `after ${s.call}: a visible box of ${b && b.buttons} buttons`); } };

test('13.5 fast repeats: 80 reveals and hides at the corner and along the top, pointer jumping in and out: always three buttons, always consistent at the end', () => {
  const r = rig(LAYOUT_13_5); warm(r);
  const spots = [r.corner, r.middle, r.onNotch, r.away];
  for (let i = 0; i < 80; i++) { r.point(spots[i % 4]); r.run(i % 3 === 0 ? 48 : 160); }
  r.point(r.away); r.run(3000);
  assert.equal(r.box(), null, 'pointer in the page: gone');
  assert.equal(r.ctx.api.guard.held(), true, 'and the buttons are guarded again');
  assert.equal(r.ctx.api.notchIsShown(), false);
  everyBoxIsFull(r);
  r.point(r.corner); assert.ok(r.first(r.run(300)) !== null, 'and it still comes back');
});

test('13.5 jitter at the corner\'s edge: the pointer shaking across the boundary 200 times never shows a narrow box and never strands the buttons on', () => {
  const r = rig(LAYOUT_13_5); warm(r);
  const inside = r.at(r.ctx.state.bounds.width - 100, 20), outside = r.at(r.ctx.state.bounds.width - 100 - 150 - 14, 100);
  for (let i = 0; i < 200; i++) { r.point(i % 2 ? inside : outside); r.run(STEP * (1 + (i % 3))); }
  everyBoxIsFull(r);
  r.point(r.away); r.run(3000);
  assert.equal(r.box(), null);
  assert.equal(r.ctx.api.guard.held(), true);
});

test('13.5 the same layout sent again and again while the notch shows is not a repaint (no overlay call, no flag call)', () => {
  const r = rig(LAYOUT_13_5); warm(r); r.point(r.corner); r.run(300);
  assert.ok(r.box(), 'shown');
  const before = r.ctx.state.calls.length;
  for (let i = 0; i < 40; i++) r.ctx.api.setCaption();
  assert.equal(r.ctx.state.calls.length, before, `${r.ctx.state.calls.length - before} calls for 40 identical layouts`);
});

test('13.5 the layout changes under a showing notch: Seamless + address turned off, or the window view changed: it ends hidden and guarded in one tick, never a narrow box', () => {
  for (const [name, next] of [['ordinary Seamless (hidden caption)', { captionHidden: true, captionFloat: true, captionNotch: false, captionHeight: 36 }], ['no caption flags (Full with a toolbar strip)', { captionNotch: false, captionHeight: 40 }], ['the Full notch again', LAYOUT_13_5]]) {
    const r = rig(LAYOUT_13_5); warm(r); r.point(r.corner); r.run(300);
    assert.ok(r.box(), name + ': shown first');
    r.point(r.away); r.run(2500);
    setLayout(r, next);
    r.run(200); everyBoxIsFull(r);
    if (next.captionNotch === true || next.captionHidden === true) { assert.equal(r.box(), null, name + ': at rest it is hidden'); assert.equal(r.ctx.api.guard.held(), true, name + ': guarded'); }
    else { assert.equal(r.box() && r.box().buttons, 3, name + ': the strip\'s caption is visible'); assert.equal(r.ctx.api.guard.held(), false, name + ': buttons on'); }
  }
  // and with the pointer still on the notch when the layout turns into a hidden Seamless: gone at once, no stuck "shown"
  const r = rig(LAYOUT_13_5); warm(r); r.point(r.onNotch); r.run(400); assert.ok(r.box());
  setLayout(r, { captionHidden: true, captionFloat: true, captionNotch: false, captionHeight: 36 });
  assert.equal(r.ctx.api.notchIsShown(), false, 'main forgets the notch when the layout leaves the mode');
  assert.equal(r.box(), null); assert.equal(r.ctx.api.guard.held(), true);
  everyBoxIsFull(r);
});

test('13.5 window events while the notch shows or hides (maximise, un-maximise, minimise and restore, full screen in and out, an overlay Windows lost): the caption is re-sent right, never narrow', () => {
  const r = rig(LAYOUT_13_5); warm(r); r.point(r.corner); r.run(300);
  assert.ok(r.box());
  for (const [maximized, minimized, fullscreen] of [[true, false, false], [false, false, false], [false, true, false], [false, false, false], [false, false, true], [false, false, false]]) {
    Object.assign(r.ctx.state, { maximized, minimized, fullscreen }); r.ctx.api.watch.event(); r.run(300);
  }
  // after a minimise or a move the poller waits for the pointer to leave and come back (its own rule, edge-reveal.cjs geometryChanged), so bring it back
  r.point(r.away); r.run(1500); r.point(r.corner); r.run(400);
  assert.ok(r.box() && r.box().buttons === 3, 'shown again after the pointer came back');
  r.ctx.state.dropOverlay(); assert.equal(r.ctx.state.drawn, null, 'Windows lost what the overlay drew');
  r.ctx.api.watch.event(); r.run(300);
  assert.ok(r.box() && r.box().buttons === 3, 'a lost overlay is drawn again, in full');
  everyBoxIsFull(r);
  r.point(r.away); r.run(2500);
  assert.equal(r.box(), null); assert.equal(r.ctx.api.guard.held(), true);
});
