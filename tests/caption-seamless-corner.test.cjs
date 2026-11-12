'use strict';
// 13.7, Windows: the minimise, maximise and close buttons at the window's top-right corner while the caption is hidden over the page (Seamless and Hide the toolbar,
// a user's report and video: "an empty grey square first, the buttons only after 2 to 3 seconds, in a hard square dark box over the website").
//
// What was wrong (measured on 13.6 on a Windows laptop, real screen every 16 ms, 37 runs at 100, 125 and 150 %): a hidden caption's buttons are still Windows' hit regions
// (close always, restore on a maximised window), drawn transparent; the one under the pointer was painted in its hover colour with no glyph (the grey square; a fading red close).
// They came back only through the interface: the corner revealed the top edge at once, but the overlay waited for the interface's next layout (its page picture and view
// transition first): 94 to 176 ms in the window in front. In a window that is not in front the edge rules ignore the pointer, so only the corner fallback (caption-watch.cjs:
// the pointer STAYS in the corner 1.2 s) brought them back, in its box: 1219 to 1255 ms, with Windows' tooltip and snap menu over an invisible button meanwhile.
//
// The fix: the corner watch (caption-notch.cjs createCaptionCorner, edge-reveal.cjs's poller) shows a hidden caption's buttons in the poller tick the pointer reaches the corner,
// whether or not the window has the keyboard, for every caption hidden over the page (Seamless, Hide the toolbar, the Sidebar + address notch). They sit in the rounded box
// (caption-backing.cjs) from the first frame, in the window in front too, until the interface's own toolbar takes over (a clear backing left white glyphs on a white page unseen
// until the toolbar arrived).
//
// main's OWN caption code and its OWN edge item are cut out of desktop/main.cjs (tests/caption-main-vm.cjs) and run with the real poller (desktop/edge-reveal.cjs) on a fake
// clock; the interface is a stand-in that answers a top reveal with the layout the real one publishes, after a delay the test chooses (or never, as a starved interface).
const test = require('node:test');
const assert = require('node:assert/strict');
const { realMainCaption, seen, alpha } = require('./caption-main-vm.cjs');
const { watchChromeEdges, GRACE, MIN_VISIBLE, cornerLook } = require('../desktop/edge-reveal.cjs');
const { createCaptionCorner, cornerDistance, CORNER } = require('../desktop/caption-notch.cjs');
const { HANDOVER_MS } = require('../desktop/caption-backing.cjs');
const runtime = require('../desktop/runtime.cjs');

const STEP = 16;
// What the real interface publishes at rest in these layouts (read back with getBrowserLayout() on the Windows laptop, 11 Nov 2026).
const HIDDEN = { captionHidden: true, captionFloat: true, captionNotch: false, captionHeight: 36, edge: { topHeight: 36, sideWidth: 240 } };
const NOTCH = { captionNotch: true, captionHeight: 34, edge: { topHeight: 6, sideWidth: 240 } };
const MODES = {
  seamless: { layout: HIDDEN, settings: { verticalTabs: true, addressInSidebar: false, windowView: 'seamless' }, windowUi: { view: 'seamless', workspaceOpen: false, webWorkspaceOpen: false } },
  'hide the toolbar': { layout: HIDDEN, settings: { verticalTabs: true, addressInSidebar: false, hideToolbar: true, windowView: 'full' }, windowUi: { view: 'full', workspaceOpen: true, webWorkspaceOpen: true } },
  'sidebar + address (notch)': { layout: NOTCH, settings: { verticalTabs: true, addressInSidebar: true, windowView: 'full' }, windowUi: { view: 'full', workspaceOpen: true, webWorkspaceOpen: true } },
};

/** `answer`: ms after a top reveal reaches it until the interface publishes its toolbar's layout (null: never). `focused`: this window has the keyboard. */
function rig(mode, { answer = null, focused = true, maximized = true, side = 'left', dark = false } = {}) {
  const spec = MODES[mode];
  const state = { settings: { ...spec.settings, sidebarSide: side }, windowUi: { ...spec.windowUi }, tabs: [{ id: 'tab-1', contentKind: 'web' }], activeTabId: 'tab-1' };
  const ctx = realMainCaption({ layout: { ...spec.layout, appearance: dark ? 'dark' : 'light' }, edge: { state }, flags: { maximized } });
  ctx.state.maximized = maximized;
  let hasKeys = focused;
  ctx.window.isFocused = () => hasKeys;
  ctx.api.setCaption();
  const item = ctx.api.edgeItem, own = item.emit;
  let next = null, delay = null, due = null;
  const publish = toolbar => { for (const key of ['captionHidden', 'captionFloat']) delete ctx.layout[key]; if (!toolbar) Object.assign(ctx.layout, { captionHidden: true, captionFloat: true }); ctx.api.setCaption(); };
  // main's own emit runs first (it notes whether a toolbar is coming), then the stand-in interface hears the event
  item.emit = event => { own(event); if (event.type !== 'chrome-edge' || spec.layout.captionNotch) return; if (event.top) { if (answer !== null) due = ctx.clock.t + answer; } else { due = null; publish(false); } };
  watchChromeEdges({ app: { whenReady: () => ({ then: fn => fn() }), on() {} }, windows: () => [item], screen: ctx.screen, view: s => runtime.effectiveView(s.settings, s.windowUi), now: () => ctx.clock.t, schedule: (fn, ms) => { next = fn; delay = ms; return { unref() {} }; }, cancel() {} });
  const b = ctx.state.bounds, at = (x, y) => ({ x: b.x + x, y: b.y + y });
  const box = () => seen(ctx.state.states.at(-1));
  /** Runs the poller as main's timer does (every STEP ms here, whatever delay it asked for, so the frames line up), the interface answering on the same clock. */
  const run = ms => { const frames = []; for (let t = 0; t < ms; t += STEP) { ctx.advance(STEP); if (due !== null && ctx.clock.t >= due) { due = null; publish(true); } const fn = next; next = null; if (fn) fn(); const s = ctx.state.states.at(-1); frames.push({ t: t + STEP, box: seen(s), back: s?.backing ?? null, color: s?.overlay?.color, ink: s?.overlay?.symbolColor, delay }); } return frames; };
  const point = p => { ctx.screen.point = p; };
  point(at(500, 400)); run(600);
  return { ctx, run, point, at, box, b, focus: on => { hasKeys = on; }, nextDelay: () => delay, corner: at(b.width - 3, 3), onClose: at(b.width - 20, 14), onMax: at(b.width - 69, 14), onMin: at(b.width - 115, 14), middle: at(Math.round(b.width / 2), 3), away: at(500, 400) };
}
const firstFull = frames => frames.find(f => f.box && f.box.buttons === 3)?.t ?? null;
/** Drawn in full within one poller tick of the pointer getting there. */
const atOnce = frames => { const t = firstFull(frames); return t !== null && t <= STEP; };
const narrow = r => r.ctx.state.states.filter(s => { const b = seen(s); return b && b.buttons !== 3; }).map(s => s.call);
// 13.7: the box behind the buttons is the rounded view (caption-backing.cjs), the tone at 88 % (e0 of ff, as Electron's ARGB hex); the overlay's own colour stays clear
const BOX = { light: '#e0eef0f2', notch: '#e0eef0f2' };

for (const mode of Object.keys(MODES)) for (const focused of [true, false]) {
  const where = `${mode}, ${focused ? 'the window in front' : 'a window that is not in front'}`;

  test(`${where}: the pointer reaching the top-right corner shows all three buttons within one tick (13.6: from the 1.2 s fallback, or the interface's answer)`, () => {
    for (const spot of ['corner', 'onClose', 'onMax', 'onMin']) {
      const r = rig(mode, { focused });
      assert.equal(r.box(), null, 'at rest: nothing over the page');
      r.point(r[spot]);
      const frames = r.run(1000);
      const when = firstFull(frames);
      assert.ok(when !== null && when <= STEP, `${spot}: the buttons are drawn ${when} ms after the pointer got there`);
      assert.deepEqual(frames.filter(f => f.t >= when && !f.box).map(f => f.t), [], `${spot}: and they stay while it rests there`);
      assert.deepEqual(narrow(r), [], 'never a box of one or two buttons');
    }
  });

  test(`${where}: they go when the pointer leaves, after the grace, guarded again, and do not come back while it is in the page (no flicker)`, () => {
    for (const answer of [null, 200]) {
      const r = rig(mode, { focused, answer });
      r.point(r.corner); r.run(700);
      assert.ok(r.box(), 'shown');
      r.point(r.away);
      const frames = r.run(2500);
      const gone = frames.findIndex(f => !f.box);
      assert.ok(gone >= 0, 'gone');
      assert.ok(frames[gone].t >= GRACE.top - STEP && frames[gone].t <= GRACE.top + MIN_VISIBLE + STEP * 4, `after the grace (${frames[gone].t} ms)`);
      assert.deepEqual(frames.slice(gone).filter(f => f.box).map(f => f.t), [], 'and nothing comes back while the pointer is in the page');
      assert.equal(r.ctx.api.guard.held(), true, 'minimise and maximise held off again');
      assert.deepEqual(narrow(r), []);
    }
  });

  test(`${where}: 120 fast trips in and out of the corner, along the top and into the page: always three buttons, consistent at the end, and the corner still works`, () => {
    const r = rig(mode, { focused, answer: 180 });
    const spots = [r.corner, r.middle, r.onMax, r.away, r.onClose, r.away];
    for (let i = 0; i < 120; i++) { r.point(spots[i % spots.length]); r.run(i % 3 === 0 ? 32 : 144); }
    r.point(r.away); r.run(3000);
    assert.equal(r.box(), null, 'pointer in the page: gone');
    assert.equal(r.ctx.api.guard.held(), true);
    assert.deepEqual(narrow(r), []);
    r.point(r.corner);
    assert.ok(atOnce(r.run(300)), 'the corner still shows them at once');
  });
}

for (const mode of ['seamless', 'hide the toolbar']) {
  test(`${mode}: what is behind them. The window in front: the rounded box from the first frame, in the same tick as the buttons, until the interface's own toolbar takes over. Not in front: the same box`, () => {
    const front = rig(mode, { answer: 150 });
    front.point(front.corner);
    const frames = front.run(800);
    const shown = frames.filter(f => f.box);
    assert.ok(shown.length && shown.every(f => f.color === '#00000000'), `the overlay's own colour is clear: ${[...new Set(shown.map(f => f.color))]}`);
    // 13.7: a clear backing left the buttons' white glyphs on a white page (the black ones on a dark page) unseen until the toolbar arrived, 150 to 320 ms later in the real window
    assert.equal(shown[0].back?.color, BOX.light, 'the box is there in the very frame the buttons are');
    const before = shown.filter(f => f.t <= 150), handover = shown.filter(f => f.t > 150 + STEP * 2 && f.t < 150 + HANDOVER_MS), onToolbar = shown.filter(f => f.t >= 150 + HANDOVER_MS + STEP * 3);
    assert.ok(before.length && before.every(f => f.back && f.back.color === BOX.light), 'and stays while the toolbar is on its way');
    // the toolbar is not painted for a few frames after its layout says so (3 to 9 frames with the buttons on the bare page, measured): the box, nearly its tone, stays through that
    assert.ok(handover.length && handover.every(f => f.back && f.back.color === BOX.light), 'through the hand-over to the toolbar too');
    assert.ok(onToolbar.length && onToolbar.every(f => f.back === null), 'and goes once the toolbar is there (the buttons are on it, the overlay clear over the window\'s material)');
    assert.deepEqual(frames.filter(f => f.t >= shown[0].t && !f.box).map(f => f.t), [], 'no frame without the buttons from the corner through the toolbar\'s arrival');
    const back = rig(mode, { focused: false, answer: 150 });
    back.point(back.corner);
    const boxed = back.run(600).filter(f => f.box);
    assert.ok(boxed.length && boxed.every(f => f.color === '#00000000' && f.back && f.back.color === BOX.light), `in the rounded box, the overlay clear: ${[...new Set(boxed.map(f => f.color + ' ' + f.back?.color))]}`);
    assert.equal(alpha(boxed[0].ink), 1, 'with the caption ink');
    // the window coming to the front with the pointer still there: the corner's top reveal brings the toolbar, and the box goes with it once it is there
    back.focus(true); back.point(back.onClose); back.run(48); back.point(back.corner);
    const after = back.run(700).filter(f => f.box);
    assert.equal(after.at(-1).color, '#00000000');
    assert.equal(after.at(-1).back, null, 'and the rounded box is gone with the toolbar there');
  });

  test(`${mode}: a rest along the top away from the corner still brings the toolbar first, with no buttons over the page ahead of it (unchanged)`, () => {
    const r = rig(mode);
    r.point(r.middle);
    assert.equal(firstFull(r.run(1000)), null, 'nothing at the corner while the interface has not answered');
    const a = rig(mode, { answer: 250 });
    a.point(a.middle);
    const frames = a.run(1000), when = firstFull(frames);
    assert.ok(when !== null && when >= 250, `the buttons come with the toolbar (${when} ms)`);
    assert.equal(frames.find(f => f.box).color, '#00000000', 'on the toolbar');
    const m = rig(mode);
    m.point(m.middle); m.run(200); m.point(m.corner);
    assert.ok(atOnce(m.run(300)), 'the corner, reached while the toolbar is on its way, shows them at once');
  });

  test(`${mode}: the sidebar on the right, a window that is not maximised, dark: the corner is the same`, () => {
    for (const options of [{ side: 'right' }, { maximized: false }, { dark: true }, { side: 'right', focused: false }]) {
      const r = rig(mode, options);
      r.point(r.corner);
      const when = firstFull(r.run(400));
      assert.ok(when !== null && when <= STEP, `${JSON.stringify(options)}: ${when} ms`);
    }
  });
}

test('sidebar + address (notch): the corner watch shows the notch in its own look in a window that is not in front (13.5\'s notch waited 1.2 s there)', () => {
  const r = rig('sidebar + address (notch)', { focused: false });
  r.point(r.corner);
  const frames = r.run(600), shown = frames.filter(f => f.box);
  assert.ok(atOnce(frames), 'at once');
  assert.ok(shown.every(f => f.color === '#00000000' && f.back && f.back.color === BOX.notch), `the notch is the same rounded box: ${[...new Set(shown.map(f => f.color + ' ' + f.back?.color))]}`);
  // a rest along the top of a window that is not in front still shows nothing (only the corner answers there)
  const m = rig('sidebar + address (notch)', { focused: false });
  m.point(m.middle);
  assert.equal(firstFull(m.run(1000)), null);
});

test('the poller looks at a hidden corner sooner the closer the pointer is, and at its idle pace far away, in a window that is not in front', () => {
  const r = rig('seamless', { focused: false });
  const look = p => { r.point(p); r.run(STEP * 2); return r.nextDelay(); };
  assert.equal(look(r.at(-3000, 400)), 250, 'on another screen, far away: the idle 250 ms');
  const mid = look(r.at(r.b.width - 900, 300));
  assert.ok(mid > 16 && mid < 250, `in the page, 900 DIPs from the corner: ${mid} ms`);
  assert.equal(look(r.at(r.b.width - 200, 60)), 16, 'next to the corner: every tick');
  assert.equal(cornerLook(0), 16);
  assert.equal(cornerLook(10_000), 250);
  // a pointer moving 10 DIPs per ms toward the corner is looked at again before it can get there
  for (const d of [40, 160, 400, 900, 1600, 2400]) assert.ok(cornerLook(d) * 10 <= Math.max(d, 160), `${d} DIPs: ${cornerLook(d)} ms`);
});

test('the corner watch on its own: the corner only, focused or not, the band keeps it, nothing while a button is held, minimised or in full screen', () => {
  const clock = { t: 10_000 }, watch = createCaptionCorner({ now: () => clock.t });
  const bounds = { x: 100, y: 50, width: 1200, height: 800 }, at = (x, y) => ({ x: bounds.x + x, y: bounds.y + y });
  const base = { bounds, suspended: false, active: true, height: 36, speed: 'premium', pressed: false };
  let hidden = true;
  const hold = (point, ms, over = {}) => { let shown = false; for (let e = 0; e <= ms; e += STEP) { shown = watch.sample({ ...base, hidden, ...over, point }); hidden = !shown; clock.t += STEP; } return shown; };
  assert.equal(hold(at(600, 3), 500), false, 'the top edge away from the corner: nothing');
  assert.equal(hold(at(1200 - CORNER.width + 2, 20), 0), true, 'the corner: at once');
  assert.equal(hold(at(700, 30), 1000), true, 'along the caption band: it stays');
  assert.equal(hold(at(700, 300), 1500), false, 'into the page: gone after the grace');
  assert.equal(hold(at(1190, 10), 0), true, 'back on the buttons at once (no lock-out wait over the buttons themselves)');
  hold(at(700, 300), 1500);
  assert.equal(hold(at(1190, 10), 200, { pressed: true }), false, 'a held button: nothing');
  assert.equal(hold(at(700, 300), 300), false);
  assert.equal(hold(at(1190, 10), 200, { suspended: true }), false, 'minimised, full screen, a fullscreen page: nothing');
  assert.equal(hold(at(1190, 10), 200, { active: false }), false, 'no caption over the page: nothing');
  assert.ok(cornerDistance(at(1190, 10), bounds, 36) === 0 && cornerDistance(at(600, 400), bounds, 36) > 300);
});

test('main.cjs wires it: one place decides what is behind the buttons, the edge item reports the corner, and the one-step guard, the close refusal and the fallback stay', () => {
  const fs = require('node:fs'), path = require('node:path');
  const main = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'main.cjs'), 'utf8');
  assert.match(main, /const captionBehind=\(\{notch,overPage,tone,color\}\)=>notch\|\|overPage\?\{overlay:'#00000000',box:\{tone\}\}:\{overlay:color,box:null\};/, 'the backing is chosen in one place');
  assert.equal((main.match(/captionBehind\(/g) || []).length, 1, 'asked once (its own declaration reads captionBehind=)');
  assert.match(main, /corner:\(\)=>process\.platform==='win32'\?\{active:layout\.captionNotch===true\|\|layout\.captionHidden===true,hidden:captionHiddenNow,/);
  assert.match(main, /cornerShown:shown=>\{if\(captionCornerShown===shown\)return;captionCornerShown=shown;setCaption\(\);\}/);
  assert.match(main, /captionGuard\.apply\(\{hidden,paint:/, 'the one-step guard');
  assert.match(main, /\(captionHiddenNow\|\|Date\.now\(\)-captionShownAt<200\)/, 'the 200 ms close refusal');
  assert.match(main, /require\('\.\/caption-watch\.cjs'\)\.createCaptionWatch\(/, 'the 1.2 s fallback');
});
