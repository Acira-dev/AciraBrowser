'use strict';
// 13.8, a Windows report on 13.7: "the search bar lags and cuts back between what I typed a second ago and what I'm typing now".
// Reproduced in a hidden Acira with main answering 300-600 ms late (a slow Windows machine): a press on a tab, then on the address field, then
// letters. When main got to the switch it handed the keyboard to the page twice (main.cjs applyLayout's first showing of the tab, and the
// press's own page-focus look): the field lost focus after one or two letters, its text went back to the page's address and the rest of the
// letters went to the page (4/4 runs, 18 of 19 letters). Chromium restores a tab's keyboard in the same step as the switch, so nothing the
// person does afterwards is undone by it, and the omnibox they type in keeps the keyboard. Here: a page shown late never takes the keyboard
// from a field the person is typing in, in an interface that already shows that tab (desktop/page-focus.cjs presented, chose).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {createPageFocus, typingFor, typingProbe, isTextField, RETRIES} = require('../desktop/page-focus.cjs');

function world({typing = false, uiFocused = true} = {}) {
  const calls = {focus: [], probes: []};
  const timers = {setTimeout: (fn) => { calls.later = fn; return 1; }, clearTimeout() {}};
  const ui = {focused: uiFocused, isDestroyed: () => false, isFocused() { return this.focused; },
    async executeJavaScript(source) { calls.probes.push(source); return typeof typing === 'function' ? typing(source) : typing; }};
  const contents = {isDestroyed: () => false};
  const env = {shown: {id: 'tab-2', contents, visible: true}};
  const focus = createPageFocus({window: () => ({isDestroyed: () => false, isFocused: () => true}), chrome: () => ui, page: () => env.shown, focus: c => calls.focus.push(c), timers});
  return {calls, ui, contents, env, focus};
}
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };

test('a page shown while the person types in the address field for that tab does not take the keyboard', async () => {
  const w = world({typing: true});
  w.focus.presented(w.contents, 'tab-2');
  await settle();
  assert.deepEqual(w.calls.focus, [], 'what the person types wins');
  assert.equal(w.calls.probes.length, 1);
  assert.ok(w.calls.probes[0].includes('"tab-2"'), 'asked about the tab being shown');
});

test('a page shown with the keyboard idle in the interface (a press on its tab) takes it, once the interface has answered', async () => {
  const w = world({typing: false});
  w.focus.presented(w.contents, 'tab-2');
  assert.deepEqual(w.calls.focus, [], 'not before the answer');
  await settle();
  assert.deepEqual(w.calls.focus, [w.contents]);
});

test('a page shown while the keyboard is elsewhere (a shortcut from the page, a notification) takes it at once, nothing asked', () => {
  const w = world({uiFocused: false, typing: true});
  w.focus.presented(w.contents, 'tab-2');
  assert.deepEqual(w.calls.focus, [w.contents], 'same step, as Chromium');
  assert.equal(w.calls.probes.length, 0);
});

test('the answer is old: the tab or main\'s own conditions changed while the interface was asked', async () => {
  const moved = world({typing: false});
  moved.focus.presented(moved.contents, 'tab-2');
  moved.env.shown = {id: 'tab-3', contents: {isDestroyed: () => false}, visible: true};
  await settle();
  assert.deepEqual(moved.calls.focus, [], 'another tab is on screen now');
  const menu = world({typing: false});
  menu.focus.presented(menu.contents, 'tab-2', () => false);
  await settle();
  assert.deepEqual(menu.calls.focus, [], 'a menu opened meanwhile (still() says no)');
  const failing = world({typing: () => { throw new Error('gone'); }});
  failing.ui.executeJavaScript = async () => { throw new Error('gone'); };
  failing.focus.presented(failing.contents, 'tab-2');
  await settle();
  assert.deepEqual(failing.calls.focus, [failing.contents], 'cannot say: the page takes it, as before 13.8');
});

test('a press that chose a page: its first look, late on a busy main, leaves the keyboard to a field typed in for that tab', async () => {
  const w = world({typing: source => source.includes('__aciraShownTab')});
  w.focus.chose();
  await settle();
  assert.deepEqual(w.calls.focus, [], 'the field the person clicked after the press keeps it');
  assert.equal(w.calls.probes.length, 1);
  const idle = world({typing: false});
  idle.focus.chose();
  await settle();
  assert.deepEqual(idle.calls.focus, [idle.contents], 'nothing typed: the page takes it, as before');
  assert.equal(RETRIES, 12);
});

// ---- the question asked inside the interface

const field = (over = {}) => ({tagName: 'INPUT', type: 'text', isContentEditable: false, getAttribute: name => name === 'role' ? 'combobox' : null, ...over});
const doc = (active, shown) => ({activeElement: active, body: {}, documentElement: {}, defaultView: {__aciraShownTab: shown}});

test('typingFor: a text field, in an interface that already shows that tab', () => {
  assert.equal(typingFor(doc(field(), 'tab-2'), 'tab-2'), true);
  assert.equal(typingFor(doc(field(), 'tab-1'), 'tab-2'), false, 'a field from before the interface drew the switch belongs to the tab left');
  assert.equal(typingFor(doc(field({tagName: 'BUTTON', type: '', getAttribute: () => null}), 'tab-2'), 'tab-2'), false, 'a tab pressed with the mouse');
  assert.equal(typingFor(doc(null, 'tab-2'), 'tab-2'), false);
  const body = {};
  assert.equal(typingFor({activeElement: body, body, documentElement: {}, defaultView: {__aciraShownTab: 'tab-2'}}, 'tab-2'), false);
  assert.equal(typingFor({activeElement: field(), body: {}, documentElement: {}}, 'tab-2'), false, 'no window to read');
  assert.equal(typingFor(doc(field(), undefined), undefined), false, 'no tab asked about');
  assert.equal(isTextField(field({tagName: 'DIV', type: undefined, isContentEditable: true, getAttribute: () => null})), true, 'a rename');
});

test('the script main sends runs on its own in the page, and a tab id cannot break out of it', () => {
  const run = (active, shown, id) => vm.runInNewContext(typingProbe(id), {document: doc(active, shown)});
  assert.equal(run(field(), 'tab-2', 'tab-2'), true);
  assert.equal(run(field(), 'tab-1', 'tab-2'), false);
  assert.equal(run(field({tagName: 'BUTTON', type: '', getAttribute: () => null}), 'tab-2', 'tab-2'), false);
  const odd = 'x"),globalThis.hacked=1,("';
  assert.equal(run(field(), odd, odd), true);
  assert.equal(vm.runInNewContext(`${typingProbe(odd)};typeof hacked`, {document: doc(field(), odd)}), 'undefined');
});

// ---- wiring

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('main: the first showing of the active tab goes through page-focus, with main\'s own conditions to re-check', () => {
  const main = read('desktop/main.cjs');
  assert.ok(main.includes("if(!isNewTabOverride(id))pageFocus.presented(entry.view.webContents,id,()=>state.activeTabId===id&&(!layout.overlay||['toast','zoom','group-preview'].includes(layout.overlay.kind)));presentedActiveTab=id;}"));
  assert.ok(!main.includes('if(!isNewTabOverride(id))focusContents(entry.view.webContents);'), 'no direct hand-over left');
});

test('the interface says which tab it shows, when it draws it', () => {
  assert.ok(read('src/App.tsx').includes('useLayoutEffect(() => { (window as Window & { __aciraShownTab?: string }).__aciraShownTab = tab.id; }, [tab.id]);'));
});

test('registered with the node suite (package.json)', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.ok(pkg.testSuites.node.includes('tests/address-typing-wins.test.cjs'));
  assert.ok(pkg.testSuites.tsx.includes('tests/address-typing-wins.test.ts'));
});
