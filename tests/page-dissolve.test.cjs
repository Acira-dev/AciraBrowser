'use strict';
// The picture a held slide dissolves its one re-layout under (desktop/page-dissolve.cjs): made from the page, painted in a transparent
// layer outside the window, laid over the page, and faded once the page shows its new layout.
const test = require('node:test'); const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createPageDissolve, POLL_MS, SETTLE_MS, PAINT_MS, EXPIRY_MS, HOLD_MAX_MS } = require('../desktop/page-dissolve.cjs');

/** A bitmap image whose content is `pattern`: 'text' (dark and light), 'other' (dark and light elsewhere) or 'blank'. */
class FakeImage {
  constructor(width, height, pattern = 'text', empty = false) { this.width = width; this.height = height; this.pattern = pattern; this.empty = empty; }
  isEmpty() { return this.empty; } getSize() { return { width: this.width, height: this.height }; }
  toJPEG() { return Buffer.from('jpeg-' + this.pattern); }
  resize({ width, height }) { return new FakeImage(width, height, this.pattern); }
  crop({ width, height }) { return new FakeImage(width, height, this.pattern); }
  toBitmap() {
    const out = Buffer.alloc(this.width * this.height * 4, 255), shift = this.pattern === 'other' ? 3 : 0;
    if (this.pattern !== 'blank') for (let i = 0; i < this.width * this.height; i++) if ((i + shift) % 7 < 3) out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = 0;
    return out;
  }
}
class FakeContents extends EventEmitter {
  constructor() { super(); this.destroyed = false; this.scripts = []; this.captures = []; this.sent = []; this.laid = null; }
  isDestroyed() { return this.destroyed; } close() { this.destroyed = true; }
  loadURL() { setImmediate(() => this.emit('did-finish-load')); return Promise.resolve(); }
  insertCSS() { return Promise.resolve('k'); }
  executeJavaScript(script) { this.scripts.push(script); return script.includes('requestAnimationFrame') ? (this.laid = this.laid || new Promise(resolve => { this.finishLayout = () => resolve(true); })) : Promise.resolve(1); }
  capturePage() { const next = this.captures.length > 1 ? this.captures.shift() : this.captures[0]; return Promise.resolve(next); }
  sendInputEvent(event) { this.sent.push(event); }
}
class FakeView {
  constructor(bounds = { x: 240, y: 36, width: 1026, height: 716 }) { this.webContents = new FakeContents(); this.visible = true; this.bounds = bounds; this.radius = 0; }
  setBackgroundColor() {} setVisible(v) { this.visible = v; } getVisible() { return this.visible; } setBounds(b) { this.bounds = { ...b }; } getBounds() { return { ...this.bounds }; } setBorderRadius(r) { this.radius = r; }
}
function harness() {
  const children = [{ chrome: true }, { page: true }];
  const win = { isDestroyed: () => false, contentView: { children, addChildView(v, at) { const i = children.indexOf(v); if (i >= 0) children.splice(i, 1); if (typeof at === 'number') children.splice(at, 0, v); else children.push(v); }, removeChildView(v) { const i = children.indexOf(v); if (i >= 0) children.splice(i, 1); } } };
  const made = [], trace = [];
  class MadeView extends FakeView { constructor() { super({ x: 0, y: 0, width: 1, height: 1 }); made.push(this); } }
  const dissolve = createPageDissolve({ WebContentsView: MadeView, getWindow: () => win, fadeMs: () => 140, above: others => others.length, trace: (...what) => trace.push(what) });
  return { dissolve, made, children, trace };
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const page = (pattern = 'text') => { const view = new FakeView(); view.webContents.captures = [new FakeImage(2052, 1432, pattern)]; return view; };

test('a picture is made from the page, painted in the layer outside the window at the size asked for, and shown above the pages', async () => {
  const h = harness(), view = page();
  const cover = h.dissolve.begin(view, { width: 1272, height: 722 });
  assert.equal(await cover.ready, true);
  const layer = h.made[0];
  assert.ok(layer.visible && layer.bounds.x < 0, 'painted where it cannot be seen');
  assert.deepEqual([layer.bounds.width, layer.bounds.height], [1272, 722], 'as large as the page will be, so it only ever moves');
  const style = layer.webContents.scripts.find(script => script.includes(Buffer.from('jpeg-text').toString('base64')));
  assert.ok(style && style.includes('width:1026px;height:716px') && style.includes('background:rgb('), 'the picture at the size the page had, on the page\'s own background');
  assert.ok(!style.includes('documentElement'), 'on child elements: a root background is painted on the canvas and an opacity does not fade it');
  assert.ok(style.includes("back.id = 'b'") && style.includes('<div id=p>'), 'the picture inside the page\'s own background: it fades through it, never across to the page');
  assert.equal(cover.show({ x: 150, y: 36, width: 1272, height: 722 }, 12), true);
  assert.deepEqual(layer.bounds, { x: 150, y: 36, width: 1272, height: 722 }); assert.equal(layer.radius, 12);
  assert.equal(h.children.at(-1), layer, 'above the pages');
});

test('a page that cannot be pictured leaves the slide as it was', async () => {
  const h = harness(), view = page(); view.webContents.captures = [new FakeImage(0, 0, 'text', true)];
  const cover = h.dissolve.begin(view);
  assert.equal(await cover.ready, false); assert.equal(cover.show({ x: 0, y: 0, width: 10, height: 10 }), false, 'nothing to show');
  const gone = page(); gone.webContents.destroyed = true;
  assert.equal(h.dissolve.begin(gone), null, 'a closed page has nothing to picture');
});

test('the picture fades only once the page has laid out and shows a layout of its own, not blank and not the old one', async () => {
  const h = harness(), view = page('text');
  const cover = h.dissolve.begin(view, { width: 1272, height: 722 }); await cover.ready; cover.show({ x: 100, y: 36, width: 1272, height: 722 });
  const layer = h.made[0], fades = () => layer.webContents.scripts.filter(script => script.includes("picture.transition") && script.includes('56ms linear') && script.includes('119ms cubic-bezier(0,0,.2,1) 56ms')).length;
  view.webContents.captures = [new FakeImage(2544, 1444, 'blank'), new FakeImage(2052, 1432, 'text'), new FakeImage(2544, 1444, 'other')];
  cover.release(cover.laidOut);
  await wait(SETTLE_MS + POLL_MS * 2 + 60);
  assert.equal(fades(), 0, 'the layout has not been reported yet: the picture stays');
  view.webContents.finishLayout();
  for (let i = 0; i < 60 && fades() < 1; i++) await wait(25); // a loaded machine takes longer than the polls need
  assert.equal(fades(), 1, 'blank (not drawn yet) and unchanged (still the old layout) hold it; the new layout lets it fade');
  await wait(140 + 120);
  assert.equal(layer.visible, false, 'and it goes when the fade is over'); assert.ok(layer.bounds.x < 0);
});

test('a page that never shows anything new still gets its picture back, after a bound', async () => {
  const h = harness(), view = page('text');
  const cover = h.dissolve.begin(view); await cover.ready; cover.show({ x: 240, y: 36, width: 1026, height: 716 });
  cover.release(Promise.resolve(true));
  await wait(700);
  assert.ok(h.made[0].webContents.scripts.some(script => script.includes('56ms linear')), 'faded');
});

test('a press on the picture ends it and goes on to the page beneath; a page that leaves takes its picture with it', async () => {
  const h = harness(), view = page();
  let cover = h.dissolve.begin(view); await cover.ready; cover.show({ x: 240, y: 36, width: 1026, height: 716 });
  const layer = h.made[0], press = { type: 'mouseDown', x: 10, y: 10 };
  layer.webContents.emit('before-mouse-event', { preventDefault() {} }, press);
  assert.deepEqual(view.webContents.sent, [press], 'the press reaches the page');
  assert.equal(layer.visible, false, 'and the picture is gone');
  cover = h.dissolve.begin(view); await cover.ready; cover.show({ x: 240, y: 36, width: 1026, height: 716 });
  h.dissolve.dropFor(new FakeContents()); assert.equal(layer.visible, true, 'another page leaving changes nothing');
  h.dissolve.dropFor(view.webContents); assert.equal(layer.visible, false);
  assert.equal(h.dissolve.active, false);
});

test('a second picture drops the first, and the layer is only made when needed', async () => {
  const h = harness(); assert.equal(h.made.length, 0);
  const first = h.dissolve.begin(page()), second = h.dissolve.begin(page());
  assert.equal(first.dropped, true); await second.ready; assert.equal(second.dropped, false);
  assert.equal(h.made.length, 1, 'one layer for all of them');
  h.dissolve.destroy(); assert.equal(h.made[0].webContents.destroyed, true);
  assert.equal(h.dissolve.begin(page()), null, 'a destroyed owner makes no more');
});

test('the constants keep a picture quick enough to beat a page\'s own layout', () => { assert.ok(PAINT_MS <= 24 && SETTLE_MS <= 40); });

test('a page that a tab switch hid gets no picture, and a picture it has comes down (a grey panel stood over the new tab page, 1 Nov)', async () => {
  const h = harness(), hidden = page(); hidden.visible = false;
  assert.equal(h.dissolve.begin(hidden), null, 'nothing to dissolve for a page that is not shown');
  assert.equal(h.made.length, 0, 'and no layer made for it');
  const view = page(), cover = h.dissolve.begin(view, { width: 1272, height: 722 }); await cover.ready;
  assert.equal(cover.show({ x: 100, y: 36, width: 1272, height: 722 }), true);
  view.visible = false;
  assert.equal(cover.show({ x: 90, y: 36, width: 1272, height: 722 }), false, 'the next frame of the slide finds the page hidden');
  assert.equal(cover.dropped, true); assert.equal(h.made[0].visible, false, 'the layer is gone, not left over the page that is shown');
  const again = h.dissolve.begin(page()); await again.ready; again.show({ x: 240, y: 36, width: 1026, height: 716 });
  again.view.visible = false; again.release(Promise.resolve(true));
  await wait(SETTLE_MS + 80);
  assert.equal(again.dropped, true, 'a picture waiting to fade goes when its page is hidden');
});

test('a picture never outlives its glide: whoever forgets it, it is gone within the bound', () => {
  const timers = [], h = (() => {
    const children = [{ chrome: true }];
    const win = { isDestroyed: () => false, contentView: { children, addChildView(v) { children.push(v); }, removeChildView() {} } };
    class MadeView extends FakeView { constructor() { super({ x: 0, y: 0, width: 1, height: 1 }); } }
    return createPageDissolve({ WebContentsView: MadeView, getWindow: () => win, later: (fn, ms) => { timers.push({ fn, ms }); return { unref() {} }; } });
  })();
  const cover = h.begin(page());
  const expiry = timers.find(t => t.ms === EXPIRY_MS);
  assert.ok(expiry, 'an expiry is set the moment it begins'); assert.ok(EXPIRY_MS <= 2500, 'and it is short: ' + EXPIRY_MS);
  assert.ok(HOLD_MAX_MS <= 800, 'a released picture waits at most this long to fade: ' + HOLD_MAX_MS);
  expiry.fn(); assert.equal(cover.dropped, true);
});
