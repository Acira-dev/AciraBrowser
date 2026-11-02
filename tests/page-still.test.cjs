'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createPageStill, presentPage, uiAtRest, HOLD_MAX_MS, FADE_MS, DISSOLVE_STRETCH, NAV_HOLD_MS, SHOWN_SETTLE_MS } = require('../desktop/page-still.cjs');

class FakeContents extends EventEmitter {
  constructor() { super(); this.destroyed = false; this.css = new Map(); this.next = 0; this.captures = 0; this.captureMs = 0; this.empty = false; }
  isDestroyed() { return this.destroyed; } close() { this.destroyed = true; }
  loadURL() { setImmediate(() => this.emit('did-finish-load')); return Promise.resolve(); }
  insertCSS(text) { const key = 'k' + this.next++; this.css.set(key, text); return Promise.resolve(key); }
  removeInsertedCSS(key) { this.css.delete(key); return Promise.resolve(); }
  capturePage() { this.captures++; const empty = this.empty; return new Promise(resolve => setTimeout(() => resolve({ isEmpty: () => empty, getSize: () => ({ width: 1200, height: 800 }), resize() { return this; }, toJPEG: () => Buffer.from('jpeg') }), this.captureMs)); }
}
class FakeView {
  constructor(bounds = { x: 0, y: 68, width: 1280, height: 732 }) { this.webContents = new FakeContents(); this.visible = true; this.bounds = bounds; }
  setBackgroundColor() {} setVisible(v) { this.visible = v; } getVisible() { return this.visible; } setBounds(b) { this.bounds = b; } getBounds() { return this.bounds; }
}
const harness = (later) => {
  const children = [{ page: true }];
  const win = { isDestroyed: () => false, contentView: { children, addChildView(v, at) { const i = children.indexOf(v); if (i >= 0) children.splice(i, 1); if (typeof at === 'number') children.splice(at, 0, v); else children.push(v); }, removeChildView(v) { const i = children.indexOf(v); if (i >= 0) children.splice(i, 1); } } };
  const made = [];
  class MadeView extends FakeView { constructor() { super(); made.push(this); } }
  const still = createPageStill({ WebContentsView: MadeView, getWindow: () => win, ...(later ? { later } : {}) });
  return { still, made, children };
};
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

test('the page swap waits for the still, which covers the page area above every page, then dissolves', async () => {
  const h = harness(), old = new FakeView(), incoming = new FakeView(); incoming.visible = false;
  const order = [];
  h.still.begin(old, { scale: 1.7 });
  assert.equal(h.still.holding, true, 'while the picture is taken, swaps wait');
  h.still.flip({ id: 'old' }, () => { old.visible = false; order.push('hide old'); });
  h.still.flip({ id: 'new' }, () => { incoming.visible = true; order.push('show new'); });
  assert.deepEqual(order, [], 'nothing swapped yet: the old page stays until its still is up');
  await wait(HOLD_MAX_MS - 20);
  assert.deepEqual(order.sort(), ['hide old', 'show new'], 'both swaps ran once the still was painted');
  const layer = h.made[0]; assert.ok(layer, 'the still layer was made');
  assert.equal(layer.visible, true); assert.deepEqual(layer.bounds, old.getBounds()); assert.equal(h.children.at(-1), layer, 'above every page');
  const css = [...layer.webContents.css.values()];
  assert.ok(css.some(text => text.includes('data:image/jpeg;base64,') && text.includes('opacity:1')), 'drawn at full opacity first');
  assert.ok(css.some(text => text.includes('opacity:0') && text.includes(`${Math.round(FADE_MS * 1.7 * DISSOLVE_STRETCH)}ms`)), 'then dissolves on the workspace length at Premium');
});

test('Fast uses the shorter dissolve, and a later flip with no still waiting runs at once', async () => {
  const h = harness(), old = new FakeView();
  h.still.begin(old, { scale: 1 }); await wait(100);
  const layer = h.made[0], css = [...layer.webContents.css.values()];
  h.still.flip({ id: 'x' }, () => {});
  assert.ok([...layer.webContents.css.values()].some(text => text.includes(`${Math.round(FADE_MS * DISSOLVE_STRETCH)}ms`)), 'Fast = 130ms x stretch');
  let ran = false; h.still.flip({ id: 'later' }, () => { ran = true; }); assert.equal(ran, true, 'no still pending: the change is immediate');
  assert.ok(css.length >= 1);
});

test('a slow capture falls back to the instant swap after the hold limit, and the late still never shows over the new page', async () => {
  const h = harness(), old = new FakeView(); old.webContents.captureMs = HOLD_MAX_MS + 150;
  let swapped = false;
  h.still.begin(old); h.still.flip({ id: 'old' }, () => { swapped = true; });
  assert.equal(swapped, false);
  await wait(HOLD_MAX_MS + 30);
  assert.equal(swapped, true, 'the swap is never held longer than the limit');
  await wait(260);
  const layer = h.made[0];
  assert.ok(!layer || layer.visible === false, 'a still that arrived after the swap is not drawn');
});

test('an empty capture, a destroyed page and a closed window make no still and never hold a swap', async () => {
  const h = harness(), empty = new FakeView(); empty.webContents.empty = true;
  let ran = 0; h.still.begin(empty); h.still.flip({ id: 'a' }, () => { ran++; }); await wait(40);
  assert.equal(ran, 1, 'an empty picture releases the swap at once');
  assert.ok(!h.made[0] || h.made[0].visible === false);
  const gone = new FakeView(); gone.webContents.destroyed = true; h.still.begin(gone); assert.equal(h.still.holding, false, 'a destroyed page makes no still');
});

test('the latest swap per page wins while waiting', async () => {
  const h = harness(), old = new FakeView(), seen = [];
  h.still.begin(old); const entry = { id: 'p' };
  h.still.flip(entry, () => seen.push('hide')); h.still.flip(entry, () => seen.push('show'));
  await wait(HOLD_MAX_MS - 20);
  assert.deepEqual(seen, ['show']);
});


test('an interrupted still cannot hide the replacement while its first frame settles', async () => {
  const pending = [], h = harness((fn, ms) => { const token = { fn, ms, unref() {} }; pending.push(token); return token; });
  h.still.begin(new FakeView()); await wait(20);
  const firstSettle = pending.find(timer => timer.ms === 32); assert.ok(firstSettle);
  h.still.begin(new FakeView()); await wait(20);
  const layer = h.made[0]; assert.equal(layer.visible, true);
  firstSettle.fn(); await wait(0);
  assert.equal(layer.visible, true, 'the old capture must not hide the newer still');
  h.still.destroy();
});

test('destroy during capture drops queued swaps and never recreates a layer after close', async () => {
  const h = harness(), old = new FakeView(); old.webContents.captureMs = 80;
  let swaps = 0; h.still.begin(old); h.still.flip(old, () => swaps++); h.still.destroy();
  await wait(HOLD_MAX_MS + 20);
  assert.equal(swaps, 0); assert.equal(h.made.length, 0); assert.equal(h.still.holding, false);
});
test('destroyed owners ignore late transitions while a separate window still swaps normally', async () => {
  const closed = harness(), live = harness(), page = new FakeView();
  closed.still.destroy(); closed.still.destroy();
  let closedSwaps = 0, liveSwaps = 0;
  closed.still.begin(page); closed.still.flip(page, () => closedSwaps++);
  assert.equal(await closed.still.prime(page.webContents, page.getBounds(), 'late'), false);
  live.still.begin(page); live.still.flip(page, () => liveSwaps++);
  await wait(HOLD_MAX_MS + 20);
  assert.equal(closedSwaps, 0); assert.equal(closed.made.length, 0);
  assert.equal(liveSwaps, 1); live.still.destroy();
});
// Round 4: new tab page -> website. The interface (not a page view) draws the new tab page, so its picture is primed ahead of time.
const ntp = () => { const h = harness(), ui = new FakeView({ x: 0, y: 0, width: 1280, height: 800 }), popup = { popup: true }; h.children.unshift(ui); h.children.push(popup); return { ...h, ui, popup, rect: { x: 0, y: 68, width: 1280, height: 732 } }; };
const above = h => others => Math.max(others.indexOf(h.ui), others.findIndex(child => child.page)) + 1;

test('a primed new tab picture waits parked outside the window, then covers the page area at once, above pages and under popups', async () => {
  const h = ntp();
  assert.equal(await h.still.prime(h.ui.webContents, h.rect, 'tab-1|a'), true);
  const layer = h.made[0];
  assert.equal(layer.visible, true, 'parked painted, so moving it needs no first paint');
  assert.ok(layer.bounds.x + layer.bounds.width <= 0, 'parked outside the window, where it takes no clicks');
  assert.deepEqual([layer.bounds.width, layer.bounds.height], [h.rect.width, h.rect.height], 'same size as the page area: moving it never re-rasters');
  assert.ok([...layer.webContents.css.values()].some(text => text.includes('data:image/jpeg;base64,') && text.includes('opacity:1')));
  assert.equal(h.still.cover({ key: 'tab-1|stale' }), false, 'a picture of something else is never used');
  assert.equal(h.still.cover({ key: 'tab-1|a', scale: 1.7, above: above(h) }), true);
  assert.deepEqual(layer.bounds, h.rect, 'covers the page area in the same call (no capture on the switch path)');
  assert.equal(h.children.indexOf(layer), h.children.indexOf(h.popup) - 1, 'over the pages and the interface, under the popup layer');
  const shown = []; h.still.flip({ id: 'web' }, () => shown.push('web'), true);
  assert.deepEqual(shown, ['web'], 'the website appears beneath the picture at once');
  const fadeCss = () => [...layer.webContents.css.values()].some(text => text.includes('opacity:0') && text.includes(`${Math.round(FADE_MS * 1.7)}ms`));
  assert.equal(fadeCss(), false, 'held until the shown page has had its frames');
  await wait(SHOWN_SETTLE_MS + 20);
  assert.equal(fadeCss(), true, 'then dissolves on the house crossfade x Premium');
  assert.equal(h.still.cover({ key: 'tab-1|a' }), false, 'a picture is used once');
});

test('a navigation holds the picture until the new page has painted, and never longer than the bound', async () => {
  const h = ntp(); await h.still.prime(h.ui.webContents, h.rect, 'k');
  let painted; const until = new Promise(resolve => { painted = resolve; });
  h.still.cover({ key: 'k', scale: 1, until, above: above(h) });
  h.still.flip({ id: 'web' }, () => {}, true);
  await wait(SHOWN_SETTLE_MS + 30);
  const layer = h.made[0], faded = () => [...layer.webContents.css.values()].some(text => text.includes('opacity:0') && text.includes(`${FADE_MS}ms`));
  assert.equal(faded(), false, 'a page that has not drawn yet stays under the picture (no white or dark frame)');
  painted(); await wait(5);
  assert.equal(faded(), true, 'it dissolves once the page has painted (Fast = 130 ms)');
  const g = ntp(); await g.still.prime(g.ui.webContents, g.rect, 'k');
  g.still.cover({ key: 'k', until: new Promise(() => {}) }); g.still.flip({ id: 'web' }, () => {}, true);
  await wait(NAV_HOLD_MS + 30);
  assert.ok([...g.made[0].webContents.css.values()].some(text => text.includes('opacity:0')), 'a page that never paints is revealed at the bound');
});

test('a press on the covering picture ends it and goes on to the website; dropping the new tab page parks nothing', async () => {
  const h = ntp(), page = new FakeContents(), sent = []; page.sendInputEvent = e => sent.push(e.type);
  await h.still.prime(h.ui.webContents, h.rect, 'k');
  h.still.cover({ key: 'k', target: () => page, above: above(h) });
  const layer = h.made[0]; let prevented = 0; const event = { preventDefault() { prevented++; } };
  layer.webContents.emit('before-mouse-event', event, { type: 'mouseDown', x: 10, y: 10, button: 'left', clickCount: 1 });
  layer.webContents.emit('before-mouse-event', event, { type: 'mouseUp', x: 10, y: 10, button: 'left', clickCount: 1 });
  layer.webContents.emit('before-mouse-event', event, { type: 'mouseMove', x: 12, y: 12 });
  assert.equal(layer.visible, false, 'the picture is gone on the press');
  assert.deepEqual(sent, ['mouseDown', 'mouseUp'], 'the click reaches the page');
  assert.equal(prevented, 2);
  const d = ntp(); await d.still.prime(d.ui.webContents, d.rect, 'k'); d.still.drop();
  assert.equal(d.made[0].visible, false); assert.equal(d.still.cover({ key: 'k' }), false, 'nothing to cover with once the new tab page left');
});

// Founder, 1 Nov: after a navigation a flat grey panel as wide as the sidebar stood beside the open sidebar, over the new tab page, which was
// cut off behind it. The still was primed 260 ms after the layout changed, while the sidebar still glided (the page content held in its old box,
// displaced by the sidebar's width beside a bare strip of the page card), and it was keyed to the glide's final bounds, so the key matched.
test('a picture taken while the interface moves is never kept, and is asked for again until it rests', async () => {
  const h = ntp(); let moving = 3, asked = 0; const rest = async () => { asked++; return moving-- <= 0; };
  const before = h.ui.webContents.captures;
  assert.equal(await h.still.prime(h.ui.webContents, h.rect, 'k', { rest }), 'moving', 'moving before the capture: nothing is captured');
  assert.equal(h.ui.webContents.captures, before, 'no capture is spent on a moving frame');
  assert.equal(h.still.cover({ key: 'k' }), false, 'and nothing stands ready to cover a navigation');
  assert.equal(h.made.length, 0, 'not even the layer is made');
  assert.equal(await h.still.prime(h.ui.webContents, h.rect, 'k', { rest }), 'moving');
  assert.equal(await h.still.prime(h.ui.webContents, h.rect, 'k', { rest }), 'moving');
  assert.equal(await h.still.prime(h.ui.webContents, h.rect, 'k', { rest }), true, 'at rest, before and after the capture, it is kept');
  assert.equal(asked, 5, 'three moving answers, then before and after the one capture that is kept');
  assert.equal(h.still.cover({ key: 'k', above: above(h) }), true);
});

test('a frame that starts to move during the capture is not kept either', async () => {
  const h = ntp(); let calls = 0; const rest = async () => ++calls === 1;
  assert.equal(await h.still.prime(h.ui.webContents, h.rect, 'k', { rest }), 'moving', 'at rest before the capture, moving after it');
  assert.equal(h.ui.webContents.captures, 1);
  assert.equal(h.still.cover({ key: 'k' }), false, 'the picture of the moving frame was thrown away');
  assert.equal(h.made.length, 0);
});

test('a settled picture is not replaced by a moving one, and a layout change still drops it', async () => {
  const h = ntp(); assert.equal(await h.still.prime(h.ui.webContents, h.rect, 'k', { rest: async () => true }), true);
  assert.equal(await h.still.prime(h.ui.webContents, h.rect, 'k', { rest: async () => false }), 'moving');
  assert.equal(h.still.cover({ key: 'k', above: above(h) }), true, 'the settled picture still covers');
  const g = ntp(); await g.still.prime(g.ui.webContents, g.rect, 'k', { rest: async () => true }); g.still.release();
  assert.equal(g.still.cover({ key: 'k' }), false, 'a changed layout releases the picture (main.cjs applyLayout)');
});

test('uiAtRest: the layout glide, the held page content and any frame animation count as motion; ambient loops and tooltips do not', () => {
  const attrs = new Set(), animations = [];
  const inside = names => ({ closest: selector => selector.split(',').map(part => part.trim().replace('.', '')).some(name => names.includes(name)) ? {} : null });
  const animation = ({ state = 'running', pseudo = null, endTime = 480, names = [], target = true } = {}) => ({ playState: state, effect: { pseudoElement: pseudo, getComputedTiming: () => ({ endTime }), target: target ? inside(names) : null } });
  global.document = { documentElement: { hasAttribute: name => attrs.has(name) }, getAnimations: () => animations };
  try {
    assert.equal(uiAtRest(), true, 'nothing running: at rest');
    attrs.add('data-mode-switch'); assert.equal(uiAtRest(), false, 'a layout / appearance / edge view transition is in flight'); attrs.clear();
    attrs.add('data-page-live'); assert.equal(uiAtRest(), false, 'the page content is held in its old box (followPage)'); attrs.clear();
    for (const name of ['data-fr-switch', 'data-theme-settle', 'data-edge-snapshot']) { attrs.add(name); assert.equal(uiAtRest(), false, name); attrs.clear(); }
    animations.push(animation({ pseudo: '::view-transition-group(acira-page)' })); assert.equal(uiAtRest(), false, 'a view-transition pseudo animation'); animations.length = 0;
    animations.push(animation({ names: ['page-area'] })); assert.equal(uiAtRest(), false, 'a running animation inside the page card (the new tab page arriving)'); animations.length = 0;
    animations.push(animation({ names: ['ed-rail'] })); assert.equal(uiAtRest(), false, 'inside the sidebar'); animations.length = 0;
    animations.push(animation({ state: 'pending', names: ['browser-toolbar'] })); assert.equal(uiAtRest(), false, 'one that has not started yet'); animations.length = 0;
    animations.push(animation({ state: 'finished', names: ['page-area'] }), animation({ names: ['page-area'], endTime: Infinity }), animation({ names: ['page-area'], endTime: 30000 }), animation({ names: ['t-tip'] }), animation({ target: false }));
    assert.equal(uiAtRest(), true, 'finished, endless, very long and unrelated animations do not hold the picture back');
  } finally { delete global.document; }
});

test('main.cjs keeps the new tab picture only while the interface is at rest, and asks again while it moves', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'desktop', 'main.cjs'), 'utf8');
  assert.match(source, /newTabStill\.prime\(chromeView\.webContents,layout\.pageBounds,newTabStillKey\(\),\{rest:interfaceAtRest\}\)/, 'the prime is given the rest probe');
  assert.match(source, /result!=='moving'\|\|tries>=NEWTAB_PRIME_RETRIES/, 'a prime that found the interface moving is repeated, bounded');
  assert.match(source, /uiAtRest/, 'the probe is the one page-still.cjs exports');
  assert.match(source, /clearTimeout\(newTabRetryTimer\);pageStill\.destroy\(\)/, 'the retry ends with the window');
});

// R5 (founder: "when I switch between tabs the page is completely empty though YouTube is playing; it only appears after I open and
// close the sidebar"). Main's layout pass, as main.cjs runs it: each layout says whether the page is shown, presentPage routes the change.
const twoStills = () => { const outer = harness(), inner = harness(); return { outer, inner, route: (entry, visible) => presentPage(entry, visible, { outer: outer.still, inner: inner.still, apply: shown => { entry.view.visible = shown; } }) }; };
const oldRule = (s, entry, visible) => { if (entry.view.getVisible() !== visible) s.outer.still.flip(entry, () => s.inner.still.flip(entry, () => { entry.view.visible = visible; }, visible)); };

test('a website left for the new tab page and picked again while its still is being made stays shown (Ctrl+Tab tapped twice)', async () => {
  // Before: the return found the view still shown (its hide was waiting in the still), asked for nothing, and the hide ran afterwards.
  const before = twoStills(), was = { id: 'yt', view: new FakeView() };
  before.outer.still.begin(was.view);
  oldRule(before, was, false); oldRule(before, was, true);
  await wait(HOLD_MAX_MS + 30);
  assert.equal(was.view.visible, false, 'the old rule leaves the active page hidden: the empty page area');
  // After: the return replaces the waiting hide.
  const s = twoStills(), yt = { id: 'yt', view: new FakeView() };
  s.outer.still.begin(yt.view);
  assert.equal(s.route(yt, false), true, 'the switch to the new tab page waits in the still');
  assert.equal(yt.view.visible, true, 'nothing swapped while the picture is taken');
  assert.equal(s.route(yt, true), true, 'the return is routed although the view never left');
  await wait(HOLD_MAX_MS + 30);
  assert.equal(yt.view.visible, true, 'the website is on screen once the still lets the swaps go');
  assert.equal(s.route(yt, true), false, 'nothing more to ask once the view and the request agree');
});

test('every routed change lands: a hide and a show of two pages, a page hidden directly, and the new tab still nested inside', async () => {
  const s = twoStills(), a = { id: 'a', view: new FakeView() }, b = { id: 'b', view: new FakeView() }; b.view.visible = false;
  s.outer.still.begin(a.view);
  s.route(a, false); s.route(b, true);
  await wait(HOLD_MAX_MS + 30);
  assert.deepEqual([a.view.visible, b.view.visible], [false, true]);
  b.view.visible = false; // something hid it directly (full screen, a sign-in)
  assert.equal(s.route(b, true), true, 'the view itself is still compared');
  assert.equal(b.view.visible, true, 'no still waiting: at once');
});

test('a still that is released, or abandoned for a new one, runs the swaps it held instead of dropping them', async () => {
  const h = harness(), old = new FakeView(); old.webContents.captureMs = 60;
  const ran = [];
  h.still.begin(old); h.still.flip({ id: 'x' }, () => ran.push('x'));
  h.still.release();
  assert.deepEqual(ran, ['x'], 'released while the owner is live: the swap still runs');
  const g = harness(), first = new FakeView(), second = new FakeView(); first.webContents.captureMs = 60;
  g.still.begin(first); g.still.flip({ id: 'y' }, () => ran.push('y'));
  g.still.begin(second);
  assert.deepEqual(ran, ['x', 'y'], 'abandoned for a newer still: its swaps land now, not with the next one');
  assert.equal(g.still.holding, true, 'the newer still holds what comes after it');
  await wait(HOLD_MAX_MS + 30);
  assert.equal(g.still.holding, false);
});

test('an abandoned still whose picture is up never stays over the page when the next one cannot be made', async () => {
  const h = harness(), first = new FakeView(), second = new FakeView(); second.webContents.empty = true;
  h.still.begin(first);
  // The first picture is up and waits for its swap, which has not come yet.
  await wait(SHOWN_SETTLE_MS + 20); const layer = h.made[0];
  assert.equal(layer.visible, true, 'the first picture is up');
  h.still.begin(second); await wait(40);
  assert.equal(layer.visible, false, 'the second still had no picture: the first one is taken down');
});

test('the hold deadline during first-frame settling removes the visible still and allows a new prime', async () => {
  // Capture and insertCSS finished, but the layer's 32 ms paint wait has not.
  // The 120 ms deadline can land here on an actual Mac under load.
  const pending = [], h = harness((fn, ms) => { const token = { fn, ms, unref() {} }; pending.push(token); return token; });
  const page = new FakeView(); let swaps = 0;
  h.still.begin(page); h.still.flip(page, () => swaps++);
  await wait(20);
  const layer = h.made[0], settle = pending.find(t => t.ms === 32), deadline = pending.find(t => t.ms === HOLD_MAX_MS);
  assert(layer?.visible && settle && deadline, 'picture is already visible while the first frame settles');
  deadline.fn();
  assert.equal(swaps, 1, 'the waiting swap is released exactly once');
  assert.equal(layer.visible, false, 'the timed-out picture cannot cover the live page');
  settle.fn(); await wait(0);
  assert.equal(layer.visible, false, 'late settle completion cannot revive the old frame');
  assert.equal(await h.still.prime(page.webContents, page.getBounds(), 'fresh'), true, 'an abandoned job cannot block future transitions');
  h.still.destroy();
});

test('a replacement that fails removes a prior picture that was visible but had not settled', async () => {
  const pending = [], h = harness((fn, ms) => { const token = { fn, ms, unref() {} }; pending.push(token); return token; });
  h.still.begin(new FakeView()); await wait(20);
  const layer = h.made[0], settle = pending.find(t => t.ms === 32);
  assert(layer.visible && settle);
  const empty = new FakeView(); empty.webContents.empty = true;
  h.still.begin(empty); await wait(20);
  assert.equal(layer.visible, false, 'failed replacement leaves no previous picture covering the page');
  settle.fn(); await wait(0);
  assert.equal(layer.visible, false, 'the replaced job cannot resurrect its frame');
  h.still.destroy();
});
