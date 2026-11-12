'use strict';
// 13.7: the rounded box behind Windows' own caption buttons (desktop/caption-backing.cjs, wired in main.cjs's setCaption).
//
// Decision (11 Nov 2026): Windows' own minimise / maximise / close stay as they are (native icons, native square hover, red Close, Snap Layouts); only the background behind
// them changes. It hugs the window's top-right corner (square against the top and right edges, rounded only on its inside bottom-left corner, 12 px), a few px bigger than the buttons
// (6 px to the left and below) so a square hover never pokes past the rounded edge, flat and see-through (the caption tone at 88 %, following the theme and the site's colour), the
// same in Seamless, Hide the toolbar and the Sidebar + address notch. 13.6 drew it as the overlay's own colour, which Windows paints as a rectangle.
//
// main.cjs's OWN setCaption is cut out of the source (tests/caption-main-vm.cjs) and run against a fake Windows window whose contentView records the box's view: its colour, bounds and
// visibility after every call. What a person sees is the state at the end of the tick, so "the same frame as the buttons" is judged there: after every call that changes either, the
// box is up exactly when the buttons are up over the page (and clear), and nothing waits on a timer.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { realMainCaption, seen, alpha } = require('./caption-main-vm.cjs');
const { backingBounds, withAlpha, BUTTONS_WIDTH, MARGIN, RADIUS, OPACITY } = require('../desktop/caption-backing.cjs');

const frame = ctx => { const last = ctx.state.states.at(-1); return { buttons: last ? seen(last) : null, box: last && last.backing ? last.backing : null }; };
/** Every call that can change the caption leaves the box and the buttons in agreement: both up (the box with the overlay clear), or both down. */
const together = (ctx, label) => {
  const f = frame(ctx), overlay = ctx.state.states.at(-1)?.overlay;
  assert.equal(!!f.buttons, !!f.box, `${label}: the buttons are ${f.buttons ? 'up' : 'down'} and the box is ${f.box ? 'up' : 'down'}`);
  if (f.box) assert.equal(alpha(overlay.color), 0, `${label}: the overlay's own colour is clear while the box shows`);
};

test('the shape: square against the window\'s top and right edges, rounded only on the inside bottom-left corner, 6 px bigger than the buttons to the left and below', () => {
  assert.equal(RADIUS, 12);
  assert.equal(MARGIN, 6);
  for (const [width, captionHeight] of [[1920, 34], [1536, 40], [902, 36], [1280, 32]]) {
    const b = backingBounds(width, captionHeight);
    // the visible part is the window's own top-right rectangle: BUTTONS_WIDTH + MARGIN wide, captionHeight + MARGIN tall
    assert.equal(width - b.x, BUTTONS_WIDTH + MARGIN, `${width}: 6 px left of the buttons`);
    assert.equal(b.height - RADIUS, captionHeight + MARGIN, `${width}: 6 px below them`);
    // a View has one radius for all four corners: it reaches RADIUS px above and past the right edge of the window, where the window clips it, so only the bottom-left corner is left
    assert.equal(b.y, -RADIUS, 'it starts a radius above the window');
    assert.equal(b.x + b.width, width + RADIUS, 'it ends a radius past the right edge');
  }
  assert.equal(withAlpha('#eef0f2', OPACITY), '#e0eef0f2', 'the tone at 88 %, as Electron\'s ARGB hex');
  assert.equal(withAlpha('#27282b', 1), '#ff27282b');
  assert.equal(withAlpha('#abc', 0.5), '#80aabbcc');
  assert.equal(withAlpha('rgba(1,2,3,.5)', 1), null, 'only hex tones');
});

test('the Sidebar + address notch: the box and the buttons come and go in the same tick, the overlay stays clear, and nothing waits on a timer', () => {
  const ctx = realMainCaption();
  const { api, state, clock } = ctx;
  api.setCaption();
  together(ctx, 'notch at rest');
  assert.equal(state.views.length, 0, 'at rest nothing is made: a hidden notch has no box');
  const timers = clock.timers.length;
  api.notchShown(true);
  together(ctx, 'the pointer reached the top');
  assert.ok(frame(ctx).box, 'the box is up');
  assert.equal(clock.timers.length, timers, 'and no timer was set: it is the same tick');
  const view = state.views[0];
  assert.deepEqual({ radius: view.radius, color: view.color, bounds: view.bounds }, { radius: RADIUS, color: '#e0eef0f2', bounds: backingBounds(1200, 34) });
  // order inside the tick: the buttons are made ready and the overlay drawn first, then the box
  const shownAt = state.backingCalls.find(c => c.call === 'backing(shown)').at, overlayAt = state.calls.indexOf('overlay(visible)');
  assert.ok(overlayAt >= 0 && shownAt > overlayAt, `the overlay (call ${overlayAt}) first, then the box (after ${shownAt} calls)`);
  api.notchShown(true); api.setCaption();
  assert.equal(state.backingCalls.filter(c => c.call === 'backing(shown)').length, 1, 'a repeat changes nothing');
  api.notchShown(false);
  together(ctx, 'the pointer left');
  assert.equal(frame(ctx).box, null, 'the box is gone');
  assert.equal(clock.timers.length, timers, 'the same tick again');
  assert.equal(state.views.length, 1, 'one view for good: it is shown and hidden, never made again');
  api.notchShown(true);
  together(ctx, 'back again');
  assert.equal(state.views.length, 1);
  for (const s of state.states) { const box = seen(s); assert.ok(!(s.backing && !s.overlay), 'never a box with no overlay'); assert.ok(box === null || box.buttons === 3); }
});

test('a caption that floats over the page (Seamless, Hide the toolbar, the corner watch with no toolbar coming) has the same box', () => {
  const ctx = realMainCaption({ layout: { captionNotch: false, captionFloat: true, captionHidden: false, captionHeight: 36 } });
  ctx.api.setCaption();
  together(ctx, 'floating caption');
  assert.deepEqual(frame(ctx).box && { color: frame(ctx).box.color, bounds: frame(ctx).box.bounds, radius: frame(ctx).box.radius }, { color: '#e0eef0f2', bounds: backingBounds(1200, 36), radius: RADIUS });
  const hidden = realMainCaption({ layout: { captionNotch: false, captionFloat: true, captionHidden: true, captionHeight: 36 } });
  hidden.api.setCaption();
  together(hidden, 'Seamless at rest');
  assert.equal(frame(hidden).box, null, 'hidden caption: no box');
  assert.equal(hidden.state.views.length, 0);
});

test('a caption on the toolbar (the plain layouts) has no box at all, and its colour is what it was', () => {
  const ctx = realMainCaption({ layout: { captionNotch: false, captionFloat: false, captionHidden: false, captionHeight: 40 } });
  ctx.api.setCaption();
  assert.equal(ctx.state.views.length, 0, 'no view is made');
  assert.equal(ctx.state.overlay.color, '#00000000', 'the window\'s own colour (clear over the material), as in 13.6');
  assert.ok(seen(ctx.state.states.at(-1)), 'the buttons are drawn');
});

test('it follows the theme and the site\'s colour live: the tone changes in place, the one view is reused', () => {
  const ctx = realMainCaption({ layout: { appearance: 'light', captionColor: '#eef0f2' } });
  const { api, state, layout } = ctx;
  api.notchShown(true);
  const view = state.views[0];
  assert.equal(view.color, '#e0eef0f2', 'light');
  Object.assign(layout, { appearance: 'dark', captionColor: '#27282b' });
  api.setCaption();
  assert.equal(view.color, '#e027282b', 'dark');
  layout.captionColor = '#3a6bd8'; // a site's colour
  api.setCaption();
  assert.equal(view.color, '#e03a6bd8', 'a coloured site');
  assert.equal(state.views.length, 1);
  together(ctx, 'after the colour changes');
  const calls = state.backingCalls.length;
  api.setCaption();
  assert.equal(state.backingCalls.length, calls, 'the same colour again changes nothing');
});

test('it is a plain view of its own, made a layer so it sits over the page and under the buttons, and the popup layer stays above it', () => {
  const ctx = realMainCaption();
  const { api, state } = ctx;
  const chrome = { id: 'interface' }, page = { id: 'page' }, popups = { id: 'popups' };
  state.children.push(chrome, page, popups);
  ctx.setOverlayHost(popups);
  api.notchShown(true);
  const view = state.views[0];
  assert.deepEqual(view.order, ['blur1', 'blur0', 'radius'], 'a layer first (a plain view paints under the page: measured), flat again, then the rounding (a blur of none after the radius drops it)');
  assert.deepEqual(state.children.map(c => c.id || 'box'), ['interface', 'page', 'box', 'popups'], 'above the page, below the popup layer');
  state.children.splice(1, 1); state.children.splice(1, 0, { id: 'page2' }); // a page attached later goes under it, at its own index; the box is raised only when it shows
  api.notchShown(false); api.notchShown(true);
  assert.equal(state.children.at(-2), view, 'still right under the popup layer');
  assert.equal(view.webContents, undefined, 'a plain view: no web contents of its own, no page, no input handling');
  const source = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'caption-backing.cjs'), 'utf8'), main = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'main.cjs'), 'utf8');
  assert.doesNotMatch(source, /WebContentsView|webContents|loadURL|insertCSS|executeJavaScript/, 'nothing is loaded into it');
  assert.match(main, /createCaptionBacking\(\{create:\(\)=>new View\(\),window:\(\)=>mainWindow\}\)/);
});

test('it follows the window: a resize, a maximise and a restore move it in the same event; full screen and a minimised window have none', () => {
  const ctx = realMainCaption();
  const { api, state, window } = ctx;
  api.notchShown(true);
  const view = state.views[0];
  assert.equal(view.bounds.x, 1200 - (BUTTONS_WIDTH + MARGIN));
  state.bounds.width = 1700;
  for (const fn of state.listeners.resize) fn();
  assert.equal(view.bounds.x, 1700 - (BUTTONS_WIDTH + MARGIN), 'moved with the resize event, not at the interface\'s next layout');
  state.bounds.width = 1920;
  for (const fn of state.listeners.maximize || []) fn();
  assert.equal(view.bounds.x, 1920 - (BUTTONS_WIDTH + MARGIN));
  window.isFullScreen = () => true;
  for (const fn of state.listeners['enter-full-screen']) fn();
  assert.equal(view.getVisible(), false, 'no caption buttons in full screen, so no box');
  window.isFullScreen = () => false;
  for (const fn of state.listeners['leave-full-screen']) fn();
  assert.equal(view.getVisible(), true, 'and back with them');
});

test('main.cjs wires it: the box is changed inside the overlay\'s own paint, one decision; the only delay is the hand-over to the interface\'s toolbar', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'main.cjs'), 'utf8');
  assert.match(main, /try\{updateCaption\(mainWindow,\{\.\.\.caption,hidden:layout\.captionHidden===true\}\);[^\n]*captionBackdrop\.apply\(box,\{above:overlayHost,linger:!hidden&&!box\?require\('\.\/caption-backing\.cjs'\)\.HANDOVER_MS:0\}\);captionKey=key;/, 'a delay only when the buttons stay and the box goes (the toolbar took the caption over), never when they hide');
  assert.match(main, /const key=JSON\.stringify\(\[caption,layout\.captionHidden===true,box\]\);/, 'the box is part of what "already applied" means');
  assert.match(main, /box=behind&&behind\.box&&process\.platform==='win32'\?\{tone:behind\.box\.tone,height\}:null;/, 'Windows only');
  const backing = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'caption-backing.cjs'), 'utf8');
  assert.doesNotMatch(backing, /setInterval|requestAnimationFrame/, 'no repeating timer and no frame callback');
  assert.equal((backing.match(/schedule\(/g) || []).length, 1, 'one delayed call: the hand-over');
});

test('the hand-over: when the interface\'s toolbar takes the caption over, the box stays HANDOVER_MS (the toolbar is not painted at once), a hide is immediate, a new box cancels the wait', () => {
  const { createCaptionBacking, HANDOVER_MS } = require('../desktop/caption-backing.cjs');
  const clock = { t: 0, timers: [] };
  const schedule = (fn, ms) => { const timer = { fn, at: clock.t + ms, unref() {} }; clock.timers.push(timer); return timer; };
  const cancel = timer => { const at = clock.timers.indexOf(timer); if (at >= 0) clock.timers.splice(at, 1); };
  const advance = ms => { clock.t += ms; for (const timer of clock.timers.filter(item => item.at <= clock.t)) { clock.timers.splice(clock.timers.indexOf(timer), 1); timer.fn(); } };
  const view = { visible: false, setBackgroundBlur() {}, setBorderRadius() {}, setVisible(v) { this.visible = v; }, getVisible() { return this.visible; }, setBounds() {}, setBackgroundColor() {} };
  const children = [];
  const win = { isDestroyed: () => false, getContentSize: () => [1200, 800], isFullScreen: () => false, isMinimized: () => false, on() {}, contentView: { children, addChildView: v => children.push(v), removeChildView: v => children.splice(children.indexOf(v), 1) } };
  const backing = createCaptionBacking({ create: () => view, window: () => win, schedule, cancel });
  const box = { tone: '#eef0f2', height: 34 };
  assert.ok(HANDOVER_MS >= 200 && HANDOVER_MS <= 500, `a few frames of the toolbar's paint, not a visible wait: ${HANDOVER_MS} ms`);
  backing.apply(box); assert.equal(view.visible, true, 'the box is up');
  backing.apply(null, { linger: HANDOVER_MS });
  assert.equal(view.visible, true, 'the toolbar took over: the box stays');
  advance(HANDOVER_MS - 1); assert.equal(view.visible, true, 'for the whole hand-over');
  advance(1); assert.equal(view.visible, false, 'and goes when it is over');
  assert.equal(clock.timers.length, 0);
  // a hide (the pointer left: the buttons go too) is immediate and cancels a wait that is running
  backing.apply(box); backing.apply(null, { linger: HANDOVER_MS });
  backing.apply(null); assert.equal(view.visible, false, 'a hide never waits');
  assert.equal(clock.timers.length, 0, 'and leaves no timer behind');
  // a new box in the meantime keeps it up, and the old wait does not take it down later
  backing.apply(box); backing.apply(null, { linger: HANDOVER_MS });
  advance(100); backing.apply(box);
  advance(HANDOVER_MS * 2); assert.equal(view.visible, true, 'the old wait was cancelled');
  // with no box up there is nothing to wait for
  backing.apply(null); backing.apply(null, { linger: HANDOVER_MS });
  assert.equal(clock.timers.length, 0, 'no timer for a box that is not showing');
  backing.apply(box); backing.apply(null, { linger: HANDOVER_MS }); backing.dispose();
  assert.equal(clock.timers.length, 0, 'dispose ends a wait');
});
