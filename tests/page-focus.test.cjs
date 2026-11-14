'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {createPageFocus, interfaceKeepsFocus, INTERFACE_FOCUS_PROBE, ACTIVATE_DELAY_MS, RETRY_MS, RETRIES} = require('../desktop/page-focus.cjs');

// Reported 6 Nov: "I click a tab in the sidebar, go to another app, come back, press Space, and nothing happens". The keyboard stayed
// in the interface (reproduced on the Mac: pressing the row of the tab already on screen left getFocusedWebContents() on the
// interface, and so did coming back from another app). Chrome puts it back on the page; so does Acira now, except while the interface
// is being typed in or driven with the keyboard.

/** A manual clock: timers run only when the test says so. */
function clock() {
  const queue = [];
  return {
    setTimeout(fn, ms) { const timer = {fn, ms, off: false}; queue.push(timer); return timer; },
    clearTimeout(timer) { if (timer) timer.off = true; },
    pending: () => queue.filter(timer => !timer.off).length,
    /** Runs what is due next (and lets its promises settle). */
    async tick() {
      const timer = queue.find(item => !item.off);
      if (!timer) return false;
      timer.off = true;
      await timer.fn();
      for (let i = 0; i < 6; i++) await new Promise(resolve => setImmediate(resolve));
      return true;
    },
    async drain(limit = 40) { let n = 0; while (n < limit && await this.tick()) n++; return n; },
  };
}

function world(over = {}) {
  const calls = {focus: [], probe: 0};
  const clk = clock();
  const win = {destroyed: false, focused: true, isDestroyed() { return this.destroyed; }, isFocused() { return this.focused; }};
  const ui = {destroyed: false, focused: true, answer: false, isDestroyed() { return this.destroyed; }, isFocused() { return this.focused; },
    async executeJavaScript(source) { calls.probe++; calls.source = source; if (this.answer instanceof Error) throw this.answer; return this.answer; }};
  const contents = {destroyed: false, isDestroyed() { return this.destroyed; }};
  const shown = {id: 'tab-1', contents, visible: true};
  const env = {window: () => win, chrome: () => ui, page: () => env.shown, blocked: () => env.isBlocked, focus: c => calls.focus.push(c), timers: clk, shown, isBlocked: false, ...over};
  return {calls, clk, win, ui, contents, env, focus: createPageFocus(env)};
}

test('a press that chose a page: the tab on screen takes the keyboard at once', async () => {
  const w = world();
  w.focus.chose();
  await w.clk.drain();
  assert.deepEqual(w.calls.focus, [w.contents]);
  // 13.8: the press itself blurred any field, so the first look asks only whether the person is typing for this very tab (a field entered
  // after the press, before a busy main got to the look: tests/address-typing-wins.test.cjs), never the keep-focus question.
  assert.equal(w.calls.probe, 1);
  assert.ok(w.calls.source.includes('__aciraShownTab') && w.calls.source.includes('"tab-1"'), 'the typing question, for the tab on screen');
});

test('a tab still on its way to the screen: looks every 50 ms, up to 12 times, then stops', async () => {
  const w = world();
  w.env.shown.visible = false;
  w.focus.chose();
  assert.equal(w.clk.pending(), 1);
  assert.deepEqual(w.calls.focus, []);
  await w.clk.tick(); await w.clk.tick();
  w.env.shown.visible = true;
  await w.clk.drain();
  assert.deepEqual(w.calls.focus, [w.contents], 'focused as soon as it is shown');

  const never = world();
  never.env.shown.visible = false;
  never.focus.chose();
  const looks = await never.clk.drain(100);
  assert.equal(looks, RETRIES, 'bounded');
  assert.deepEqual(never.calls.focus, []);
  assert.equal(RETRY_MS, 50);
});

test('after waiting, a field or keyboard focus that opened in the interface in the meantime keeps the keyboard (a rename)', async () => {
  const w = world();
  w.env.shown.visible = false;
  w.focus.chose();
  await w.clk.tick();
  w.env.shown.visible = true;
  w.ui.answer = true;                      // a rename field is open now
  await w.clk.drain();
  assert.deepEqual(w.calls.focus, [], 'not stolen');
  assert.equal(w.calls.probe, 1);
});

test('no page on screen (a page of Acira\'s own, a locked or closing tab): nothing is focused and nothing is retried forever', async () => {
  const w = world();
  w.env.shown = null;
  w.focus.chose();
  assert.equal(await w.clk.drain(100), RETRIES);
  assert.deepEqual(w.calls.focus, []);
});

test('something else owns the keyboard (a sign-in card, a dialog, a popup, Peek, page fullscreen): a press does not take it', async () => {
  const w = world();
  w.env.isBlocked = true;
  w.focus.chose();
  await w.clk.drain();
  assert.deepEqual(w.calls.focus, []);
  const gone = world();
  gone.win.destroyed = true;
  gone.focus.chose();
  await gone.clk.drain();
  assert.deepEqual(gone.calls.focus, []);
});

test('back from another app with the keyboard idle in the interface: the page gets it after 120 ms', async () => {
  const w = world();
  w.ui.answer = false;
  w.focus.activated();
  assert.equal(w.clk.pending(), 1);
  assert.deepEqual(w.calls.focus, [], 'not before the native restore has settled');
  await w.clk.drain();
  assert.deepEqual(w.calls.focus, [w.contents]);
  assert.equal(ACTIVATE_DELAY_MS, 120);
});

test('back from another app: a text field, a rename or keyboard navigation in the interface keeps the keyboard', async () => {
  const w = world();
  w.ui.answer = true;
  w.focus.activated();
  await w.clk.drain();
  assert.deepEqual(w.calls.focus, []);
  assert.equal(w.calls.probe, 1);
});

test('back from another app: when the page (or a popup) already holds the keyboard the interface is not even asked', async () => {
  const w = world();
  w.ui.focused = false;
  w.focus.activated();
  await w.clk.drain();
  assert.deepEqual(w.calls.focus, []);
  assert.equal(w.calls.probe, 0);
});

test('back from another app: nothing to focus, a blocked window, a window that lost focus again, a probe that fails or comes back late', async () => {
  const hidden = world();
  hidden.env.shown.visible = false;
  hidden.focus.activated(); await hidden.clk.drain();
  assert.deepEqual(hidden.calls.focus, [], 'page not on screen');

  const none = world();
  none.env.shown = null;
  none.focus.activated(); await none.clk.drain();
  assert.deepEqual(none.calls.focus, [], 'an interface page is shown (new tab, settings)');

  const blocked = world();
  blocked.env.isBlocked = true;
  blocked.focus.activated(); await blocked.clk.drain();
  assert.deepEqual(blocked.calls.focus, []);

  const lost = world();
  lost.win.focused = false;
  lost.focus.activated(); await lost.clk.drain();
  assert.deepEqual(lost.calls.focus, [], 'the window is not the active one any more');

  const failing = world();
  failing.ui.answer = new Error('gone');
  failing.focus.activated(); await failing.clk.drain();
  assert.deepEqual(failing.calls.focus, [], 'unknown means keep');

  const late = world();
  late.ui.answer = false;
  late.ui.executeJavaScript = async () => { late.win.focused = false; return false; };
  late.focus.activated(); await late.clk.drain();
  assert.deepEqual(late.calls.focus, [], 'the answer is old when the window changed while it was being asked');
});

test('two activations close together make one look', async () => {
  const w = world();
  w.focus.activated();
  w.focus.activated();
  assert.equal(w.clk.pending(), 1);
  await w.clk.drain();
  assert.equal(w.calls.focus.length, 1);
});

// ---- what counts as "keep" inside the interface

const element = (over = {}) => ({tagName: 'BUTTON', type: '', isContentEditable: false, getAttribute: () => null, matches: () => false, ...over});
const doc = active => ({activeElement: active, body: {}, documentElement: {}});

test('interfaceKeepsFocus: typing fields keep it, a button pressed with the mouse does not, one reached with the keyboard does', () => {
  assert.equal(interfaceKeepsFocus(doc(null)), false);
  const body = {};
  assert.equal(interfaceKeepsFocus({activeElement: body, body, documentElement: {}}), false, 'nothing focused: the body');
  for (const type of ['text', 'search', 'url', 'email', 'password', 'number', ''])
    assert.equal(interfaceKeepsFocus(doc(element({tagName: 'INPUT', type}))), true, `input ${type || '(none)'}`);
  for (const type of ['button', 'checkbox', 'radio', 'submit', 'range'])
    assert.equal(interfaceKeepsFocus(doc(element({tagName: 'INPUT', type}))), false, `input ${type} pressed with the mouse`);
  assert.equal(interfaceKeepsFocus(doc(element({tagName: 'TEXTAREA'}))), true);
  assert.equal(interfaceKeepsFocus(doc(element({tagName: 'SELECT'}))), true);
  assert.equal(interfaceKeepsFocus(doc(element({tagName: 'DIV', isContentEditable: true}))), true, 'a rename that is contenteditable');
  for (const role of ['textbox', 'searchbox', 'combobox', 'spinbutton'])
    assert.equal(interfaceKeepsFocus(doc(element({tagName: 'DIV', getAttribute: name => name === 'role' ? role : null}))), true, role);
  assert.equal(interfaceKeepsFocus(doc(element())), false, 'a button clicked with the mouse');
  assert.equal(interfaceKeepsFocus(doc(element({matches: selector => selector === ':focus-visible'}))), true, 'a button reached with Tab, F6 or the arrows');
  assert.equal(interfaceKeepsFocus(doc(element({matches() { throw new Error('unsupported'); }}))), false);
});

test('the script main sends is that same function, and it runs on its own in the page', () => {
  const run = active => vm.runInNewContext(INTERFACE_FOCUS_PROBE, {document: doc(active)});
  assert.equal(run(element({tagName: 'INPUT', type: 'text'})), true);
  assert.equal(run(element()), false);
  assert.equal(run(element({matches: () => true})), true);
  assert.equal(run(null), false);
});

// ---- wiring in main and the command shape

const main = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'main.cjs'), 'utf8');

test('main: one page-focus object per window, fed by the shown tab, and blocked by what owns the keyboard', () => {
  assert.ok(main.includes("require('./page-focus.cjs').createPageFocus({window:()=>mainWindow,chrome:()=>chromeView?.webContents,"));
  const at = main.indexOf("createPageFocus({window:()=>mainWindow");
  const body = main.slice(at, at + 900);
  for (const needle of ['pages.get(state.activeTabId)', 'entry.securedLocked', 'entry.view.getVisible()', 'authActive', 'dialogDepth>0', 'peek.active', 'pageFullscreen.any()', "['toast','zoom','group-preview']", 'focus:focusContents'])
    assert.ok(body.includes(needle), needle);
});

test('main: the `focus-page` command is answered before any tab lookup (it must not wake a sleeping tab), and activation asks too', () => {
  const command = main.indexOf("if(c.type==='focus-page'){pageFocus.chose();return;}");
  assert.ok(command > 0, 'handled');
  assert.ok(command < main.indexOf("if(c.type==='tab-card')"), 'first');
  assert.ok(command < main.indexOf("const entry=tab.contentKind==='web'?ensurePage(tab):null"), 'before ensurePage');
  assert.ok(main.includes("restoreVisibleFocus();pageFocus.activated();});resize();"), "the window's focus event");
});

test('the command is accepted with a tab and nothing else', () => {
  const {createInitialState} = require('../desktop/runtime.cjs');
  const {validateCommand} = require('../desktop/validation.cjs');
  const s = createInitialState(), tabId = s.activeTabId;
  assert.deepEqual(validateCommand({type: 'focus-page', tabId}, s), {type: 'focus-page', tabId});
  assert.throws(() => validateCommand({type: 'focus-page'}, s));
  assert.throws(() => validateCommand({type: 'focus-page', tabId, url: 'https://example.com/'}, s));
});

test('registered with the node suite (package.json)', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  const listed = Object.values(pkg.testSuites).flat();
  assert.ok(listed.includes('tests/page-focus.test.cjs'));
  assert.ok(listed.includes('tests/page-focus-pick.test.ts'));
});
