'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createPageScrim, scrimAlpha } = require('../desktop/page-scrim.cjs');

class FakeContents extends EventEmitter {
  constructor() { super(); this.destroyed = false; this.css = new Map(); this.next = 0; }
  isDestroyed() { return this.destroyed; } close() { this.destroyed = true; }
  loadURL() { setImmediate(() => this.emit('did-finish-load')); return Promise.resolve(); }
  insertCSS(text) { const key = 'k' + this.next++; this.css.set(key, text); return Promise.resolve(key); }
  removeInsertedCSS(key) { this.css.delete(key); return Promise.resolve(); }
}
class FakeView { constructor() { this.webContents = new FakeContents(); this.visible = true; } setBackgroundColor() {} setVisible(v) { this.visible = v; } setBounds(b) { this.bounds = b; } }
const harness = () => { const children = [{ page: true }], win = { isDestroyed: () => false, contentView: { children, addChildView(v) { const i = children.indexOf(v); if (i >= 0) children.splice(i, 1); children.push(v); }, removeChildView(v) { const i = children.indexOf(v); if (i >= 0) children.splice(i, 1); } } }; let dismissed = 0; const scrim = createPageScrim({ WebContentsView: FakeView, getWindow: () => win, onDismiss: () => dismissed++, reducedMotion: () => true }); return { scrim, children, get dismissed() { return dismissed; } }; };
const page = { x: 0, y: 68, width: 1280, height: 732 };
const tick = () => new Promise(resolve => setTimeout(resolve, 60));

test('only centred panels dim the page: 35% on dark chrome, 20% on light', () => {
  assert.equal(scrimAlpha({ kind: 'tabs' }, 'dark'), .35); assert.equal(scrimAlpha({ kind: 'palette' }, 'light'), .2);
  assert.equal(scrimAlpha({ kind: 'menu' }, 'dark'), 0); assert.equal(scrimAlpha({ kind: 'toast' }, 'light'), 0); assert.equal(scrimAlpha(undefined, 'dark'), 0);
  assert.equal(scrimAlpha({ kind: 'profile' }, 'dark'), 0, 'the profile chooser is anchored to its control');
});

test('the scrim covers the page area above the pages, its page draws the tint, a click on it closes the panel, and it fades out', async () => {
  const h = harness();
  h.scrim.update(undefined, page, 'dark'); await tick();
  assert.equal(h.children.length, 1, 'an idle window has no scrim renderer');
  h.scrim.update({ kind: 'tabs' }, page, 'dark'); await tick();
  const layer = h.children.at(-1); assert.ok(layer instanceof FakeView, 'made when the first panel asks for a tint');
  assert.deepEqual(layer.bounds, page); assert.equal(layer.visible, true); assert.equal(h.scrim.alpha, .35);
  assert.ok([...layer.webContents.css.values()].some(css => css.includes('rgb(0 0 0 / 0.35)')));
  layer.webContents.emit('input-event', {}, { type: 'mouseDown' }); assert.equal(h.dismissed, 1);
  h.scrim.update(undefined, null, 'dark'); await tick();
  assert.equal(h.scrim.alpha, 0); assert.equal(layer.visible, false);
  assert.ok([...layer.webContents.css.values()].some(css => css.includes('rgb(0 0 0 / 0)')) && ![...layer.webContents.css.values()].some(css => css.includes('0.35')));
  h.scrim.update({ kind: 'menu' }, page, 'dark'); assert.equal(h.scrim.alpha, 0, 'anchored menus never dim');
});

test('the scrim renderer is released after the tint has been gone for a while and made again on the next panel', async () => {
  const real = global.setTimeout, timers = [];
  global.setTimeout = (fn, ms) => { const t = { fn, ms, unref() {} }; timers.push(t); return t; };
  try {
    const h = harness();
    h.scrim.update({ kind: 'tabs' }, page, 'dark'); const first = h.children.at(-1);
    h.scrim.update(undefined, page, 'dark');
    const release = timers.find(t => t.ms === 30000); assert.ok(release, 'release is scheduled');
    release.fn(); assert.equal(first.webContents.destroyed, true); assert.equal(h.children.length, 1);
    h.scrim.update(undefined, page, 'dark'); assert.equal(h.children.length, 1, 'nothing recreated for a closed panel');
    h.scrim.update({ kind: 'palette' }, page, 'dark'); const second = h.children.at(-1);
    assert.ok(second instanceof FakeView && second !== first); assert.equal(h.scrim.alpha, .35);
  } finally { global.setTimeout = real; }
});


test('destroy invalidates delayed tint work, closes its renderer and allows a clean replacement', async () => {
  const h = harness(); h.scrim.update({ kind: 'tabs' }, page, 'dark');
  const first = h.children.at(-1); h.scrim.destroy();
  assert.equal(first.webContents.destroyed, true); assert.equal(h.scrim.alpha, 0);
  h.scrim.update({ kind: 'palette' }, page, 'light'); await tick();
  const second = h.children.at(-1); assert.notEqual(first, second);
  assert.equal(h.scrim.alpha, .2); assert.equal(second.visible, true);
  assert.ok([...second.webContents.css.values()].some(css => css.includes('0.2)')));
  h.scrim.destroy(); assert.equal(h.children.length, 1);
});
