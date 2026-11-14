'use strict';
// 13.8 regression (found by the Windows serial suite, qa/page-zoom-rendering.mjs "Keyboard zoom works over an editable website that cancels page keys"):
// with page-first routing (desktop/key-routing.cjs) Ctrl+= no longer zoomed over a page that cancels its keys, because the page's own preventDefault was
// taken as "the page consumed the key". These tests run the REAL page-preload answer through the REAL router for every shortcut Acira resolves, on a
// modelled page, and pin both halves:
//   - a key the page did not preventDefault always runs its browser command, whichever element has the focus (text box, textarea, contenteditable, nothing);
//   - a key the page did preventDefault stays with the page (Ctrl+K of a command palette) - except the keys Acira keeps for the browser: Chromium's reserved list,
//     Acira's own browser-first keys, and (the fix) the page zoom keys.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {RESULT, RESERVED, BROWSER_FIRST, preHandleKeyboardEvent, createAckRouter, menuAccelerators, matchesMenuAccelerator} = require('../desktop/key-routing.cjs');
const {macMenuTemplate} = require('../desktop/platform.cjs');
const {resolveDefaultShortcut, shortcutKey} = require('../desktop/shortcuts.cjs');

const preload = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'page-input-preload.cjs'), 'utf8');
const blockOf = () => {
  const start = preload.indexOf('try{\n // The next task');
  const tail = '/* no acknowledgement from this frame (no MessageChannel, no window): the main process keeps the key itself */}';
  const end = preload.indexOf(tail, start);
  assert.ok(start > 0 && end > start, 'the acknowledgement block is in the preload');
  return preload.slice(start, end + tail.length);
};

/** The page preload's block, run against a fake window; `fire` dispatches a keydown the way a renderer does (capture listener first, then the page's own handlers). */
function pageWith(behavior) {
  const sent = [], listeners = [];
  const context = {
    require: name => (name === 'electron' ? {ipcRenderer: {send: (...args) => sent.push(args)}} : {}),
    window: {addEventListener: (type, fn, capture) => listeners.push({type, fn, capture})},
    MessageChannel: class { constructor() { const self = this; this.port1 = {set onmessage(fn) { self.handler = fn; }}; this.port2 = {postMessage() { setTimeout(() => self.handler && self.handler({}), 0); }}; } }
  };
  vm.runInNewContext('const {ipcRenderer}=require("electron");' + blockOf(), context);
  sent.length = 0;
  return {
    sent,
    async fire(input, target) {
      const event = {isTrusted: true, isComposing: false, key: input.key, code: input.code || '', ctrlKey: !!input.control, metaKey: !!input.meta, altKey: !!input.alt, shiftKey: !!input.shift, repeat: !!input.isAutoRepeat, defaultPrevented: false, target};
      for (const listener of listeners) if (listener.type === 'keydown') listener.fn(event);   // the preload's capture listener
      if (behavior(event)) event.defaultPrevented = true;                                          // then the page's own listeners
      await new Promise(resolve => setTimeout(resolve, 2));                                        // the next task: the answer goes out
    }
  };
}

const down = (key, mods = {}, code) => ({type: 'keyDown', key, code: code || (key.length === 1 && /[a-z]/i.test(key) ? 'Key' + key.toUpperCase() : key), control: false, shift: false, alt: false, meta: false, isAutoRepeat: false, ...mods});
const TARGETS = {
  'a text box': {tagName: 'INPUT', type: 'text', isContentEditable: false},
  'a textarea': {tagName: 'TEXTAREA', isContentEditable: false},
  'a contenteditable editor': {tagName: 'DIV', isContentEditable: true},
  'a password box': {tagName: 'INPUT', type: 'password', isContentEditable: false},
  'nothing in particular': {tagName: 'BODY', isContentEditable: false}
};

/**
 * What main.cjs shortcut() does with a key typed into a page: the router's decision, then (for a key that went to the page) the page's real answer.
 * Returns the commands that ran.
 */
const macMenu = menuAccelerators(macMenuTemplate(() => {}, {report: true}));
async function press({platform = 'win32', input, behavior = () => false, target = TARGETS['a text box'], ready = true, fullscreen = false}) {
  const command = resolveDefaultShortcut(input, platform), ran = [];
  if (!command) return {command, ran, how: 'no command'};
  // main.cjs: a key that is also an item of the macOS application menu is the browser's first (AppKit would run the menu item a second time otherwise).
  if (platform === 'darwin' && matchesMenuAccelerator(macMenu, input, shortcutKey)) { ran.push(command.action); return {command, ran, how: 'menu key'}; }
  const wc = {}, router = createAckRouter({setTimer: () => ({unref() {}}), clearTimer() {}});
  if (ready) router.ready(wc, 'frame');
  const how = preHandleKeyboardEvent({input, command, fullscreen, ready: router.canAcknowledge(wc, 'frame'), platform});
  if (how === RESULT.HANDLED) { ran.push(command.action); return {command, ran, how}; }
  if (how === RESULT.NOT_HANDLED_IS_SHORTCUT) {
    router.defer(wc, input, () => ran.push(command.action), 'frame');
    const page = pageWith(behavior);
    await page.fire(input, target);
    for (const [channel, payload] of page.sent) if (channel === 'acira:key-ack') router.ack(wc, payload);
  }
  return {command, ran, how};
}

// Every key the shortcut table can resolve, on Windows/Linux and on a Mac: letters, digits, punctuation, function and navigation keys, with the usual modifier sets.
function allKeys(platform) {
  const keys = [];
  const named = ['Tab', 'PageUp', 'PageDown', 'ArrowLeft', 'ArrowRight', 'Delete', 'Backspace', 'Escape', 'F3', 'F4', 'F5', 'F6', 'F9', 'F10', 'F11', 'F12', 'Enter'];
  const symbols = [[',', 'Comma'], ['=', 'Equal'], ['+', 'Equal'], ['-', 'Minus'], ['0', 'Digit0'], ['[', 'BracketLeft'], [']', 'BracketRight'], ['+', 'NumpadAdd'], ['-', 'NumpadSubtract'], ['0', 'Numpad0']];
  const base = [...'abcdefghijklmnopqrstuvwxyz'].map(k => [k, 'Key' + k.toUpperCase()]).concat([...'123456789'].map(k => [k, 'Digit' + k]), symbols, named.map(k => [k, k]));
  const mods = platform === 'darwin' ? [{meta: true}, {meta: true, shift: true}, {meta: true, alt: true}, {control: true}, {}, {alt: true}] : [{control: true}, {control: true, shift: true}, {control: true, alt: true}, {alt: true}, {}, {shift: true}];
  for (const [key, code] of base) for (const mod of mods) keys.push(down(key, mod, code));
  return keys;
}
const label = input => [input.control && 'Ctrl', input.meta && 'Cmd', input.alt && 'Alt', input.shift && 'Shift', input.key + '/' + input.code].filter(Boolean).join('+');
const browserKeeps = command => BROWSER_FIRST.has(command.action) || RESERVED.has(command.action);

test('zoom: Ctrl+=, Ctrl+Shift+=, Ctrl+-, Ctrl+0 and the keypad keys are the browser\'s first, so a page that cancels every key cannot stop zooming (fails on e296632d)', async () => {
  const cancelsEverything = () => true;
  for (const platform of ['win32', 'linux']) {
    for (const [input, change] of [[down('=', {control: true}, 'Equal'), 1], [down('+', {control: true, shift: true}, 'Equal'), 1], [down('-', {control: true}, 'Minus'), -1], [down('0', {control: true}, 'Digit0'), 0], [down('+', {control: true}, 'NumpadAdd'), 1], [down('-', {control: true}, 'NumpadSubtract'), -1], [down('0', {control: true}, 'Numpad0'), 0]]) {
      assert.deepEqual(resolveDefaultShortcut(input, platform), {action: 'zoom', change}, label(input));
      for (const [where, target] of Object.entries(TARGETS)) {
        const result = await press({platform, input, behavior: cancelsEverything, target});
        assert.deepEqual(result.ran, ['zoom'], platform + ' ' + label(input) + ' over ' + where + ' that cancels every key: it zooms');
        assert.equal(result.how, RESULT.HANDLED, label(input) + ' is taken at once, before the page');
      }
    }
  }
});

test('zoom: the same keys on a Mac (Cmd+=, Cmd+-, Cmd+0, keypad) stay the browser\'s first by themselves, and as application-menu keys', async () => {
  const rules = macMenu;
  for (const input of [down('=', {meta: true}, 'Equal'), down('+', {meta: true, shift: true}, 'Equal'), down('-', {meta: true}, 'Minus'), down('0', {meta: true}, 'Digit0'), down('+', {meta: true}, 'NumpadAdd'), down('-', {meta: true}, 'NumpadSubtract')]) {
    assert.equal(resolveDefaultShortcut(input, 'darwin').action, 'zoom', label(input));
    assert.equal(matchesMenuAccelerator(rules, input, shortcutKey), true, label(input) + ' is a menu key: main takes it first');
    const result = await press({platform: 'darwin', input, behavior: () => true});
    assert.deepEqual(result.ran, ['zoom'], label(input) + ' on a Mac over a page that cancels every key');
    // And without the menu rule (a Mac whose menu did not take it): the router alone keeps zoom the browser's.
    assert.equal(preHandleKeyboardEvent({input, command: {action: 'zoom', change: 1}, platform: 'darwin'}), RESULT.HANDLED, label(input));
  }
  // Cmd+K is not a menu key and not a zoom key: it still goes to the page first.
  const palette = await press({platform: 'darwin', input: down('k', {meta: true}), behavior: event => event.key === 'k'});
  assert.deepEqual(palette.ran, [], 'a page that takes Cmd+K keeps it');
});

test('a key the page did not preventDefault always runs its browser command, over a text box, a textarea, a contenteditable editor or nothing: every shortcut Acira resolves, on every platform', async () => {
  let checked = 0;
  for (const platform of ['win32', 'linux', 'darwin']) {
    for (const input of allKeys(platform)) {
      const command = resolveDefaultShortcut(input, platform);
      if (!command) continue;
      for (const where of ['a text box', 'a contenteditable editor']) {
        const result = await press({platform, input, behavior: () => false, target: TARGETS[where]});
        assert.deepEqual(result.ran, [command.action], `${platform} ${label(input)} (${command.action}) over ${where}: the page left the key, so the browser acts, once`);
        checked++;
      }
    }
  }
  assert.ok(checked > 700, 'the sweep covers the whole table: ' + checked);
});

test('a key the page did preventDefault stays with the page, except the keys the browser keeps: Ctrl+K of a command palette is the page\'s; Ctrl+T, Ctrl+W and zoom are not', async () => {
  let sweep = 0;
  for (const platform of ['win32', 'linux', 'darwin']) {
    for (const input of allKeys(platform)) {
      const command = resolveDefaultShortcut(input, platform);
      if (!command) continue;
      // A Mac menu key is the browser's first (main.cjs); every other key is decided by the router and the page's answer.
      const menuKey = platform === 'darwin' && matchesMenuAccelerator(macMenu, input, shortcutKey);
      const result = await press({platform, input, behavior: () => true});
      assert.deepEqual(result.ran, menuKey || browserKeeps(command) ? [command.action] : [], `${platform} ${label(input)} (${command.action}) over a page that cancels it`);
      sweep++;
    }
  }
  assert.ok(sweep > 300, 'the sweep covers the whole table: ' + sweep);
  // The named cases, on their own.
  const ctrl = (key, mods = {}, code) => down(key, {control: true, ...mods}, code);
  const takes = event => event.ctrlKey && ['k', 'e', 'l', 'f', 'd', 'h', 'j', 'r', 'p', 's', 'o', 'g'].includes(event.key.toLowerCase());
  for (const key of ['k', 'e', 'l', 'f', 'd', 'h', 'j', 'r', 'p', 's', 'o', 'g']) assert.deepEqual((await press({input: ctrl(key), behavior: takes})).ran, [], 'Ctrl+' + key + ' handled by the page stays with the page');
  assert.deepEqual((await press({input: ctrl('k', {shift: true}), behavior: takes})).ran, [], 'Ctrl+Shift+K handled by the page stays with the page');
  for (const key of ['k', 'e', 'l', 'f']) assert.deepEqual((await press({input: ctrl(key), behavior: () => false})).ran, [key === 'k' || key === 'l' || key === 'e' ? 'address' : 'find'], 'Ctrl+' + key + ' the page left is the browser\'s');
  for (const [input, action] of [[ctrl('t'), 'new-tab'], [ctrl('w'), 'close-tab'], [ctrl('n'), 'new-window'], [ctrl('Tab', {}, 'Tab'), 'tab-switcher']]) assert.deepEqual((await press({input, behavior: () => true})).ran, [action], label(input) + ' is reserved: the page never sees it');
});

test('the page\'s answer never depends on which element has the focus: a text box, a textarea, a contenteditable editor and the page itself are answered alike', async () => {
  for (const input of [down('=', {control: true}, 'Equal'), down('k', {control: true}), down('e', {control: true}), down('F5', {}, 'F5'), down('d', {alt: true})]) {
    const answers = [];
    for (const target of Object.values(TARGETS)) {
      const page = pageWith(() => false);
      await page.fire(input, target);
      answers.push(JSON.stringify(page.sent.filter(([channel]) => channel === 'acira:key-ack')));
    }
    assert.equal(new Set(answers).size, 1, label(input) + ' is answered the same for every target');
    assert.equal(JSON.parse(answers[0]).length, 1, label(input) + ' is answered');
    assert.equal(JSON.parse(answers[0])[0][1].prevented, false);
  }
});

test('a frame that cannot answer keeps the old rule for every key, zoom included: the browser takes it', async () => {
  for (const input of [down('=', {control: true}, 'Equal'), down('k', {control: true}), down('f', {control: true})]) {
    const result = await press({input, ready: false, behavior: () => true});
    assert.equal(result.how, RESULT.HANDLED, label(input));
    assert.deepEqual(result.ran, [resolveDefaultShortcut(input, 'win32').action]);
  }
});
