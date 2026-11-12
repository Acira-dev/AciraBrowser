'use strict';
// 13.7, GitHub #4 follow-up (Tabrr as the New Tab page): the page views of ordinary tabs give a docked extension side panel its width
// (main.cjs: clampBounds(extensionPanel.trim(...))), but the New Tab override view took the raw page area and sits above the panel, so the
// extension's page covered the whole panel. overrideBounds gives the override view what a page view gets.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {overrideBounds, createNewTabOverride} = require('../desktop/browser-services/extension-new-tab.cjs');
const {panelGeometry, trimBounds, GAP} = require('../desktop/browser-services/extension-side-panel.cjs');

const page = {x: 0, y: 72, width: 1088, height: 628};
const layout = {visible: true, pageBounds: page};
// main.cjs's wiring, with the real geometry: a panel is open or not
const withPanel = open => ({layout, trim: (bounds, p) => trimBounds(bounds, p, open ? panelGeometry(p) : null), clamp: b => b});

test('no side panel: the override view fills the whole page area, as before', () => {
  assert.deepEqual(overrideBounds(withPanel(false)), page);
});

test('a docked side panel: the override view gives up the panel\'s width and the gap, so nothing is covered', () => {
  const geometry = panelGeometry(page);
  const bounds = overrideBounds(withPanel(true));
  assert.equal(bounds.x, page.x);
  assert.equal(bounds.y, page.y);
  assert.equal(bounds.height, page.height);
  assert.equal(bounds.width, page.width - geometry.reserve);
  assert.equal(geometry.reserve, geometry.panel.width + GAP);
  assert.ok(bounds.x + bounds.width <= geometry.panel.x, 'the override view ends where the panel starts (minus the gap)');
});

test('a window too narrow to share (no panel geometry) keeps the whole area', () => {
  const narrow = {x: 0, y: 72, width: 500, height: 600};
  assert.equal(panelGeometry(narrow), null);
  assert.deepEqual(overrideBounds({layout: {visible: true, pageBounds: narrow}, trim: (b, p) => trimBounds(b, p, panelGeometry(p)), clamp: b => b}), narrow);
});

test('the same hooks as pages: trim is asked with the page area as both arguments, clamp gets what trim returned', () => {
  const calls = [];
  const out = overrideBounds({layout, trim: (b, p) => {calls.push(['trim', b, p]); return {...b, width: 700};}, clamp: b => {calls.push(['clamp', b]); return {...b, height: 600};}});
  assert.deepEqual(calls[0], ['trim', page, page]);
  assert.deepEqual(calls[1], ['clamp', {...page, width: 700}]);
  assert.deepEqual(out, {...page, width: 700, height: 600});
});

test('nothing shows while the interface is hidden, the authentication window is up or there is no page area', () => {
  assert.equal(overrideBounds({layout: {visible: false, pageBounds: page}}), null);
  assert.equal(overrideBounds({layout, authActive: true}), null);
  assert.equal(overrideBounds({layout: {visible: true}}), null);
  assert.equal(overrideBounds({layout: null}), null);
  assert.equal(overrideBounds({}), null);
});

test('the wiring: main.cjs places the override view through overrideBounds with the side panel\'s trim and its own clamp, only while the window exists', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'main.cjs'), 'utf8');
  assert.match(main, /createNewTabOverride\(\{WebContentsView,getWindow:\(\)=>mainWindow,pageBounds:\(\)=>mainWindow&&!mainWindow\.isDestroyed\(\)\?require\('\.\/browser-services\/extension-new-tab\.cjs'\)\.overrideBounds\(\{layout,authActive,trim:\(bounds,page\)=>extensionPanel\.trim\(bounds,page\),clamp:clampBounds\}\):null,/);
  assert.doesNotMatch(main, /pageBounds:\(\)=>layout\.visible===false\|\|authActive\?null:layout\.pageBounds,radius:\(\)=>layout\.pageRadius\?\?8,current:/);
});

// The side panel's trim remembers the page card it sits beside (an `anchor`) every time it narrows something. A split's page views set that
// anchor; if the override view asked for its bounds on every layout pass, also while it is not shown, it would overwrite the split's anchor
// and the panel would sit at the wrong top (found in the real app: panel y 72 instead of 98 beside a split).
function fakes() {
  const children = [];
  const win = {isDestroyed: () => false, contentView: {children, addChildView(view, at) {const i = children.indexOf(view); if (i >= 0) children.splice(i, 1); if (at === undefined) children.push(view); else children.splice(at, 0, view);}, removeChildView(view) {const i = children.indexOf(view); if (i >= 0) children.splice(i, 1);}}};
  class FakeView {
    constructor() {this.visible = false; this.bounds = null; this.webContents = {setWindowOpenHandler() {}, on() {}, loadURL: () => Promise.resolve(), isDestroyed: () => false, close() {}};}
    setBounds(b) {this.bounds = b;} setBorderRadius() {} setVisible(v) {this.visible = v;}
  }
  return {win, FakeView};
}

test('the override view asks for the page area only while it is wanted, so an idle override never touches the panel\'s anchor', () => {
  const {win, FakeView} = fakes();
  let wanted = null, asked = 0;
  const override = createNewTabOverride({
    WebContentsView: FakeView, getWindow: () => win, pageBounds: () => {asked++; return {x: 0, y: 72, width: 1088, height: 628};},
    current: () => wanted, sessionFor: () => ({}), navigateTab() {}, openTab() {}
  });
  assert.equal(override.sync(), null);
  assert.equal(override.sync(), null);
  assert.equal(asked, 0, 'no wanted override (a website tab, a split, a private window): pageBounds is never called');
  wanted = {tabId: 1, profileId: 'p', extensionId: 'a'.repeat(32), url: 'chrome-extension://' + 'a'.repeat(32) + '/newtab.html'};
  assert.deepEqual(override.sync(), {tabId: 1, url: wanted.url});
  assert.equal(asked, 1);
  assert.deepEqual(win.contentView.children[0].bounds, {x: 0, y: 72, width: 1088, height: 628});
  wanted = null;
  assert.equal(override.sync(), null);
  assert.equal(asked, 1, 'hidden again: no further call');
  assert.equal(win.contentView.children[0].visible, false);
});

test('a wanted override with no page area (interface hidden, fullscreen) hides instead of placing', () => {
  const {win, FakeView} = fakes();
  const override = createNewTabOverride({
    WebContentsView: FakeView, getWindow: () => win, pageBounds: () => null,
    current: () => ({tabId: 1, profileId: 'p', extensionId: 'a'.repeat(32), url: 'chrome-extension://' + 'a'.repeat(32) + '/n.html'}), sessionFor: () => ({}), navigateTab() {}, openTab() {}
  });
  assert.equal(override.sync(), null);
  assert.equal(win.contentView.children.length, 0, 'nothing is created while there is no area');
});
