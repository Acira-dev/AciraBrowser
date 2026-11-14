'use strict';
// Gestures over the sidebar (13.9; a user from Arc and Zen): with the pointer over the sidebar's body, the mouse's back
// and forward buttons and a two-finger sideways swipe go to the previous / next workspace, in the switcher's order, through the switcher's own
// workspace.select (and its motion). Nothing past the first or last (no wrap, like Zen, no fall-through to the tab), nothing while a menu or panel is
// open; with one workspace the side buttons step the tab there and a swipe does nothing; the toolbar, the address field and the
// caption keep the tab's back and forward; one switch per swipe, never on an up-and-down scroll.
// desktop/mouse-nav.cjs (sidebarZone, steppedWorkspace, the interface's release), desktop/swipe-nav.cjs (the sidebar's tracker), main.cjs wiring.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const mouseNav = require('../desktop/mouse-nav.cjs');
const swipe = require('../desktop/swipe-nav.cjs');

const has = name => { assert.equal(typeof mouseNav[name], 'function', `mouse-nav.cjs exports ${name}`); return mouseNav[name]; };
const settle = () => new Promise(resolve => setImmediate(resolve));

// ---- which part of the interface is under the pointer (run against a stand-in page)

function node(tag, {classes = [], attrs = {}, parent = null} = {}) {
  const el = {tagName: tag, classList: new Set(classes), attrs, parentElement: parent,
    getAttribute(name) { return Object.hasOwn(this.attrs, name) ? this.attrs[name] : null; }, hasAttribute(name) { return Object.hasOwn(this.attrs, name); },
    matches(selector) { return selector.split(',').map(s => s.trim()).some(s => s.startsWith('.') ? this.classList.has(s.slice(1)) : s.startsWith('[') ? matchAttr(this, s) : this.tagName.toLowerCase() === s); },
    closest(selector) { let at = this; while (at) { if (at.matches(selector)) return at; at = at.parentElement; } return null; }};
  return el;
}
const matchAttr = (el, s) => { const m = /^\[([\w-]+)="([^"]*)"\]$/.exec(s); return Boolean(m) && el.getAttribute(m[1]) === m[2]; };
const page = at => ({elementFromPoint: () => at});

test('the sidebar\'s body is the sidebar zone; its caption, resize edge and text fields, a hidden sidebar and everything else are not', () => {
  const sidebarZone = has('sidebarZone');
  const sidebar = node('ASIDE', {classes: ['ed-rail', 'acira-sidebar', 'is-expanded']});
  const sections = node('DIV', {classes: ['sb-sections-wrap'], parent: sidebar}), row = node('BUTTON', {classes: ['sb-tab-main'], parent: node('DIV', {classes: ['sb-tab'], parent: sections})});
  const foot = node('BUTTON', {classes: ['sb-foot-icon'], parent: node('DIV', {classes: ['sb-foot'], parent: sidebar})});
  assert.equal(sidebarZone(page(row), 10, 10), 'sidebar', 'a tab row');
  assert.equal(sidebarZone(page(sections), 10, 10), 'sidebar', 'empty space in the list');
  assert.equal(sidebarZone(page(foot), 10, 10), 'sidebar', 'the footer (workspaces, profile)');
  assert.equal(sidebarZone(page(node('DIV', {classes: ['sb-caption'], parent: sidebar})), 10, 10), 'other', 'the caption strip (the window\'s drag area)');
  assert.equal(sidebarZone(page(node('DIV', {classes: ['sb-resize'], parent: sidebar})), 10, 10), 'other', 'the resize edge');
  assert.equal(sidebarZone(page(node('INPUT', {parent: sections})), 10, 10), 'other', 'a text field (a search or rename box)');
  assert.equal(sidebarZone(page(node('DIV', {classes: ['toolbar']})), 10, 10), 'other', 'the toolbar and the address field (never inside the sidebar element)');
  const hidden = node('ASIDE', {classes: ['acira-sidebar'], attrs: {'aria-hidden': 'true', inert: ''}});
  assert.equal(sidebarZone(page(node('DIV', {parent: hidden})), 10, 10), 'other', 'tabs on top: the sidebar is hidden');
  assert.equal(sidebarZone(page(null), 10, 10), 'other');
  assert.match(has('sidebarZoneProbe')(12.5, 40), /\(document, 12\.5, 40\)$/, 'main sends the function with the point');
});

test('the next workspace: in the switcher\'s order, never wrapping, none with one', () => {
  const steppedWorkspace = has('steppedWorkspace');
  const list = [{id: 'w1'}, {id: 'w2'}, {id: 'w3'}];
  assert.equal(steppedWorkspace(list, 'w2', -1).id, 'w1', 'back: the previous');
  assert.equal(steppedWorkspace(list, 'w2', 1).id, 'w3', 'forward: the next');
  assert.equal(steppedWorkspace(list, 'w1', -1), null, 'nothing before the first (no wrap, like Zen)');
  assert.equal(steppedWorkspace(list, 'w3', 1), null, 'nothing after the last');
  assert.equal(steppedWorkspace([{id: 'w1'}], 'w1', 1), null, 'one workspace: nothing');
  assert.equal(steppedWorkspace(list, 'gone', 1), null);
  assert.equal(steppedWorkspace(list, 'w1', 2), null);
});

test('profiles as spaces: it steps through the switcher\'s own list (one space per ordinary profile)', () => {
  const steppedWorkspace = has('steppedWorkspace');
  const {windowWorkspaces} = require('../desktop/runtime.cjs');
  const state = {settings: {spaces: 'profiles'}, activeBrowserProfileId: 'p1', browserProfiles: [{id: 'p1'}, {id: 'p2'}, {id: 'p3', private: true}, {id: 'p4'}],
    workspaces: [{id: 'a1', browserProfileId: 'p1'}, {id: 'a2', browserProfileId: 'p1'}, {id: 'b1', browserProfileId: 'p2'}, {id: 'c1', browserProfileId: 'p3'}, {id: 'd1', browserProfileId: 'p4'}]};
  const list = windowWorkspaces(state);
  assert.deepEqual(list.map(item => item.id), ['a1', 'b1', 'd1'], 'the switcher: each ordinary profile\'s first workspace');
  assert.equal(steppedWorkspace(list, 'a1', 1).id, 'b1');
  assert.equal(steppedWorkspace(list, 'b1', 1).id, 'd1', 'the private profile is not a space');
});

// ---- the mouse's side buttons over the interface

function world({zone = 'sidebar', blocked = false, workspaces = 3, workspace = null} = {}) {
  let t = 0; const queue = [];
  const timers = {setTimeout: (fn, ms) => { const item = {at: t + ms, fn, live: true}; queue.push(item); return item; }, clearTimeout: item => { if (item) item.live = false; }};
  const advance = ms => { t += ms; for (const item of [...queue].sort((a, b) => a.at - b.at)) if (item.live && item.at <= t) { item.live = false; item.fn(); } };
  const steps = [], env = {zone, blocked, workspaces};
  const nav = mouseNav.createMouseNav({now: () => t, timers, active: d => steps.push(['tab', d]), tabStep: () => {}, zoneAt: () => env.zone, workspace: workspace || (d => steps.push(['workspace', d])), workspaces: () => env.workspaces, blocked: () => env.blocked});
  const event = () => ({prevented: false, preventDefault() { this.prevented = true; }});
  return {nav, steps, advance, env, event};
}
const press = (w, button, x = 40, y = 300) => { w.nav.ui('interface', {type: 'mouseDown', button, x, y}, w.event()); w.nav.ui('interface', {type: 'mouseUp', button, x, y}, w.event()); };

test('over the sidebar\'s body: back = the previous workspace, forward = the next, on the release, instead of the tab', async () => {
  const w = world({zone: 'sidebar'});
  press(w, 'back'); await settle();
  press(w, 'forward'); await settle();
  assert.deepEqual(w.steps, [['workspace', -1], ['workspace', 1]]);
});

test('one workspace: over the sidebar the side buttons step the tab, as anywhere else in the interface; two or more: the workspace, and at an end nothing (no fall-through)', async () => {
  const one = world({zone: 'sidebar', workspaces: 1});
  press(one, 'back'); await settle();
  press(one, 'forward'); await settle();
  assert.deepEqual(one.steps, [['tab', -1], ['tab', 1]]);
  const none = world({zone: 'sidebar', workspaces: 0});
  press(none, 'back'); await settle();
  assert.deepEqual(none.steps, [['tab', -1]], 'no list at all: the tab, as before');
  const tried = [];
  const end = world({zone: 'sidebar', workspaces: 2, workspace: d => { tried.push(d); return false; }});
  press(end, 'back'); await settle();
  assert.deepEqual(tried, [-1], 'the workspace step is asked for');
  assert.deepEqual(end.steps, [], 'past the first workspace: nothing, not the tab');
  const two = world({zone: 'sidebar', workspaces: 2});
  press(two, 'forward'); await settle();
  assert.deepEqual(two.steps, [['workspace', 1]]);
});

test('over the toolbar, the address field or the caption: the tab\'s own back and forward (unchanged)', async () => {
  const w = world({zone: 'other'});
  press(w, 'back'); await settle();
  assert.deepEqual(w.steps, [['tab', -1]]);
});

test('a menu or panel open at the press or at the release: nothing at all', async () => {
  const w = world({zone: 'sidebar', blocked: true});
  press(w, 'back'); await settle();
  w.env.zone = 'other'; press(w, 'back'); await settle();
  assert.deepEqual(w.steps, []);
  const late = world({zone: 'sidebar'});
  late.nav.ui('interface', {type: 'mouseDown', button: 'back', x: 1, y: 1}, late.event()); late.env.blocked = true;
  late.nav.ui('interface', {type: 'mouseUp', button: 'back', x: 1, y: 1}, late.event()); await settle();
  assert.deepEqual(late.steps, []);
});

test('no answer from the interface in time: the tab steps, as before (never nothing, never twice)', async () => {
  let t = 0; const queue = [], steps = [];
  const timers = {setTimeout: (fn, ms) => { const item = {at: t + ms, fn, live: true}; queue.push(item); return item; }, clearTimeout: item => { if (item) item.live = false; }};
  const nav = mouseNav.createMouseNav({now: () => t, timers, active: d => steps.push(['tab', d]), tabStep: () => {}, zoneAt: () => new Promise(() => {}), workspace: d => steps.push(['workspace', d]), workspaces: () => 3});
  const e = () => ({preventDefault() {}});
  nav.ui('interface', {type: 'mouseDown', button: 'back', x: 1, y: 1}, e()); nav.ui('interface', {type: 'mouseUp', button: 'back', x: 1, y: 1}, e());
  await settle(); assert.deepEqual(steps, []);
  t += mouseNav.ZONE_MS; for (const item of queue) if (item.live && item.at <= t) { item.live = false; item.fn(); }
  await settle(); assert.deepEqual(steps, [['tab', -1]]);
});

// ---- a two-finger swipe over the sidebar (macOS; the same tracker as the page swipe)

function swipeWorld({zone = 'sidebar', overPage = false, workspaces = 3, at = 1, enabled = true} = {}) {
  let t = 0; const queue = [];
  const after = (fn, ms) => { const item = {at: t + ms, fn, live: true}; queue.push(item); return item; }, clear = item => { if (item) item.live = false; };
  const advance = ms => { t += ms; for (const item of [...queue].sort((a, b) => a.at - b.at)) if (item.live && item.at <= t) { item.live = false; item.fn(); } };
  const steps = [], env = {at};
  const nav = swipe.createSwipeNav({WebContentsView: function () { throw new Error('no view for a sidebar swipe'); }, getWindow: () => null, now: () => t, after, clear,
    enabled: () => enabled, blocked: () => false, pageAt: () => (overPage ? {tabId: 't1', bounds: {x: 0, y: 0, width: 800, height: 600}} : null), cursor: () => null, canGo: () => true,
    sidebar: {zoneAt: () => zone, canStep: d => env.at + d >= 0 && env.at + d < workspaces, step: d => { steps.push(d); env.at += d; }}});
  return {nav, steps, advance};
}
const gesture = async (w, {dx = 30, dy = 0, count = 6, momentum = 0} = {}) => {
  w.nav.sample({phase: 'began', dx: 0, dy: 0, x: 60, y: 300, natural: true}); await settle();
  for (let i = 0; i < count; i++) { w.nav.sample({phase: 'changed', dx, dy, x: 60, y: 300, natural: true}); w.advance(8); await settle(); }
  w.nav.sample({phase: 'ended', dx: 0, dy: 0, x: 60, y: 300, natural: true}); await settle();
  for (let i = 0; i < momentum; i++) { w.nav.sample({phase: 'none', momentum: i === momentum - 1 ? 'ended' : 'changed', dx, dy, x: 60, y: 300, natural: true}); w.advance(8); await settle(); }
};

test('a sideways swipe over the sidebar: back (content to the right) = the previous workspace, forward = the next, once per gesture', async () => {
  const w = swipeWorld();
  assert.ok(w.nav.sidebarTracker, 'the sidebar has its own tracker');
  await gesture(w, {dx: 30});
  assert.deepEqual(w.steps, [-1], 'one step back');
  await gesture(w, {dx: -30});
  assert.deepEqual(w.steps, [-1, 1], 'one step forward');
  await gesture(w, {dx: 30, count: 6, momentum: 20});
  assert.deepEqual(w.steps, [-1, 1, -1], 'the coast after the lift never makes a second switch');
});

test('an up-and-down scroll of the tab list never switches; a short swipe does not either', async () => {
  const w = swipeWorld();
  await gesture(w, {dx: 3, dy: 40});
  await gesture(w, {dx: 10, count: 2});
  assert.deepEqual(w.steps, []);
});

test('nothing outside the sidebar\'s body, past the ends, with one workspace, over a page, or with "Swipe between pages" off', async () => {
  for (const [label, opts] of [['the toolbar', {zone: 'other'}], ['the first workspace, back', {at: 0}], ['one workspace', {workspaces: 1, at: 0}], ['over a page (its own swipe)', {overPage: true}], ['the setting off', {enabled: false}]]) {
    const w = swipeWorld(opts); await gesture(w, {dx: 30});
    assert.deepEqual(w.steps, [], label);
  }
  const last = swipeWorld({at: 2}); await gesture(last, {dx: -30});
  assert.deepEqual(last.steps, [], 'the last workspace, forward');
});

// ---- wiring in main

const main = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'main.cjs'), 'utf8');

test('main: the side buttons and the swipe share one zone check and one workspace step, through the switcher\'s own action', () => {
  assert.ok(main.includes("zoneAt:(x,y)=>sidebarZoneAt(x,y),workspace:direction=>{stepWorkspace(direction);},workspaces:()=>windowWorkspaces(state).length,blocked:()=>Boolean(layout.overlay&&!['toast','zoom','group-preview'].includes(layout.overlay.kind))});"), 'the side buttons');
  assert.ok(main.includes("sidebar:{zoneAt:(x,y)=>sidebarZoneAt(x,y),canStep:direction=>Boolean(require('./mouse-nav.cjs').steppedWorkspace(windowWorkspaces(state),state.activeWorkspaceId,direction)),step:direction=>stepWorkspace(direction)}"), 'the swipe');
  assert.ok(main.includes("function sidebarZoneAt(x,y){const ui=chromeView?.webContents;if(!ui||ui.isDestroyed())return Promise.resolve('other');const zoom=ui.getZoomFactor()||1;return ui.executeJavaScript(require('./mouse-nav.cjs').sidebarZoneProbe(x/zoom,y/zoom)).catch(()=>'other');}"), 'the interface answers, in its own pixels');
  assert.ok(main.includes("function stepWorkspace(direction){if(windowClosing)return false;const next=require('./mouse-nav.cjs').steppedWorkspace(windowWorkspaces(state),state.activeWorkspaceId,direction);if(next)dispatch({type:'workspace.select',id:next.id});return Boolean(next);}"), 'the switcher\'s own action');
});

test('the test is registered with npm test', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.ok(pkg.testSuites.node.includes('tests/gesture-nav.test.cjs'));
});
