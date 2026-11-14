'use strict';
// 13.8: Chromium's keyboard routing (desktop/key-routing.cjs): reserved commands are the browser's first, every other browser shortcut goes to the page
// first and runs only if the page did not consume the key. The resolver of the keys themselves is desktop/shortcuts.cjs.
const test = require('node:test');
const assert = require('node:assert/strict');
const {RESULT, RESERVED, isReservedCommand, preHandleKeyboardEvent, createAckRouter, signatureOf, menuAccelerators, matchesMenuAccelerator} = require('../desktop/key-routing.cjs');
const {macMenuTemplate} = require('../desktop/platform.cjs');
const {shortcutKey} = require('../desktop/shortcuts.cjs');
const {resolveDefaultShortcut} = require('../desktop/shortcuts.cjs');

const down = (key, mods = {}, extra = {}) => ({type: 'keyDown', key, code: extra.code || (key.length === 1 ? 'Key' + key.toUpperCase() : key), control: false, shift: false, alt: false, meta: false, isAutoRepeat: false, ...mods});
const route = (platform, input, options = {}) => preHandleKeyboardEvent({input, command: resolveDefaultShortcut(input, platform), platform, ...options});

test('the reserved commands are Chromium\'s IsReservedCommandOrKey list, nothing more', () => {
  assert.deepEqual([...RESERVED].sort(), ['close-tab', 'close-window', 'cycle-tab', 'new-tab', 'new-window', 'private-window', 'quit', 'restore', 'tab-switcher']);
  for (const action of RESERVED) assert.equal(isReservedCommand({action}), true, action);
  for (const action of ['address', 'find', 'palette', 'reload', 'bookmark', 'history', 'downloads', 'select-tab', 'move-tab', 'fullscreen', 'zoom', 'print', 'devtools', 'settings', 'switch-workspace', 'workspace'])
    assert.equal(isReservedCommand({action}), false, action);
});

test('Windows and Linux: Ctrl+T/W/N/Shift+N/Shift+T/Tab/PageDown and the page zoom keys stay the browser\'s first; Ctrl+K, Ctrl+E, Ctrl+L, Ctrl+F and the rest go to the page first', () => {
  const ctrl = (key, mods = {}) => down(key, {control: true, ...mods});
  for (const input of [ctrl('t'), ctrl('w'), ctrl('n'), ctrl('n', {shift: true}), ctrl('t', {shift: true}), ctrl('w', {shift: true}), ctrl('Tab', {code: 'Tab'}), ctrl('PageDown', {code: 'PageDown'}), ctrl('PageUp', {code: 'PageUp'}), ctrl('F4', {code: 'F4'}), ctrl('q', {shift: true}), ctrl('=', {code: 'Equal'}), ctrl('-', {code: 'Minus'}), ctrl('0', {code: 'Digit0'}), ctrl('+', {shift: true, code: 'Equal'})])
    assert.equal(route('win32', input), RESULT.HANDLED, JSON.stringify([input.key, input.shift]));
  for (const input of [ctrl('k'), ctrl('e'), ctrl('l'), ctrl('f'), ctrl('d'), ctrl('h'), ctrl('j'), ctrl('r'), ctrl('p'), ctrl('s'), ctrl('k', {shift: true}), ctrl('1', {code: 'Digit1'}), down('F5', {}, {code: 'F5'}), down('F12', {}, {code: 'F12'}), down('d', {alt: true}), down('ArrowLeft', {alt: true}, {code: 'ArrowLeft'})])
    assert.equal(route('win32', input), RESULT.NOT_HANDLED_IS_SHORTCUT, JSON.stringify([input.key, input.control, input.shift, input.alt]));
});

test('macOS: Cmd+K goes to the page first (the Webflow / command-palette case); Cmd+T, Cmd+W, Cmd+N, Cmd+Shift+N stay the browser\'s', () => {
  const cmd = (key, mods = {}) => down(key, {meta: true, ...mods});
  for (const input of [cmd('t'), cmd('w'), cmd('n'), cmd('n', {shift: true}), cmd('t', {shift: true}), cmd(']', {shift: true}), cmd('ArrowRight', {alt: true}, {code: 'ArrowRight'})])
    assert.equal(route('darwin', input), RESULT.HANDLED, JSON.stringify([input.key, input.shift, input.alt]));
  for (const input of [cmd('k'), cmd('l'), cmd('f'), cmd('d'), cmd('r'), cmd('y'), cmd('j', {shift: true})]) assert.equal(route('darwin', input), RESULT.NOT_HANDLED_IS_SHORTCUT, JSON.stringify([input.key, input.shift]));
});

test('keys that are no browser command, key ups, Acira\'s own browser-first keys and extension commands', () => {
  assert.equal(route('win32', down('a')), RESULT.NOT_HANDLED, 'a plain letter is no command');
  assert.equal(preHandleKeyboardEvent({input: {...down('k', {control: true}), type: 'keyUp'}, command: {action: 'address'}}), RESULT.NOT_HANDLED, 'BrowserView registers no released accelerators');
  assert.equal(preHandleKeyboardEvent({input: {...down('t', {control: true}), type: 'keyUp'}, command: {action: 'new-tab'}}), RESULT.NOT_HANDLED);
  assert.equal(preHandleKeyboardEvent({input: down('x'), command: {action: 'record-key'}}), RESULT.HANDLED, 'recording a shortcut: the key is the answer');
  assert.equal(preHandleKeyboardEvent({input: down('Escape', {}, {code: 'Escape'}), command: {action: 'escape'}}), RESULT.HANDLED);
  assert.equal(preHandleKeyboardEvent({input: down('y', {control: true, shift: true}), command: {action: 'extension-command'}}), RESULT.HANDLED, 'extension commands are processed by the focus manager first, as Chrome\'s documentation says');
  assert.equal(preHandleKeyboardEvent({input: {type: 'char'}, command: {action: 'address'}}), RESULT.NOT_HANDLED);
});

test('a frame that cannot acknowledge keys (no preload: the PDF viewer, an error page) keeps the old behaviour: the browser takes the key first', () => {
  assert.equal(route('win32', down('k', {control: true}), {ready: false}), RESULT.HANDLED);
  assert.equal(route('win32', down('t', {control: true}), {ready: false}), RESULT.HANDLED);
});

test('fullscreen: only leaving it is reserved (IDC_EXIT, IDC_FULLSCREEN); on a Mac the list stays and the fullscreen key joins it', () => {
  assert.equal(isReservedCommand({action: 'new-tab'}, {fullscreen: true, platform: 'win32'}), false, 'Ctrl+T goes to the page in fullscreen');
  assert.equal(isReservedCommand({action: 'close-tab'}, {fullscreen: true, platform: 'linux'}), false);
  assert.equal(isReservedCommand({action: 'quit'}, {fullscreen: true, platform: 'win32'}), true);
  assert.equal(isReservedCommand({action: 'fullscreen'}, {fullscreen: true, platform: 'win32'}), true);
  assert.equal(isReservedCommand({action: 'fullscreen'}, {fullscreen: false, platform: 'win32'}), false, 'outside fullscreen F11 is an ordinary shortcut');
  assert.equal(isReservedCommand({action: 'new-tab'}, {fullscreen: true, platform: 'darwin'}), true);
  assert.equal(isReservedCommand({action: 'fullscreen'}, {fullscreen: true, platform: 'darwin'}), true);
  assert.equal(route('win32', down('t', {control: true}), {fullscreen: true}), RESULT.NOT_HANDLED_IS_SHORTCUT);
  assert.equal(route('win32', down('F11', {}, {code: 'F11'}), {fullscreen: true}), RESULT.HANDLED);
});

// ------------------------------------------------------------------------------------------------ the acknowledgement

function rig(timeoutMs = 1000) {
  const timers = [];
  const router = createAckRouter({timeoutMs, setTimer: (fn, ms) => { const t = {fn, ms, cleared: false, unref() {}}; timers.push(t); return t; }, clearTimer: t => { if (t) t.cleared = true; }});
  const wc = {id: 1}, ran = [];
  const input = down('k', {control: true});
  const payload = (extra = {}) => ({key: 'k', code: 'KeyK', ctrl: true, alt: false, shift: false, meta: false, repeat: false, prevented: false, ...extra});
  return {router, wc, ran, input, payload, timers, fire: i => { if (!timers[i].cleared) timers[i].fn(); }};
}

test('a page that does not consume the key: the command runs once, when its answer arrives', () => {
  const r = rig();
  r.router.ready(r.wc, 'f1');
  assert.equal(r.router.canAcknowledge(r.wc, 'f1'), true);
  r.router.defer(r.wc, r.input, why => r.ran.push(why), 'f1');
  assert.deepEqual(r.ran, [], 'nothing runs before the page answers');
  assert.equal(r.router.ack(r.wc, r.payload()), 'ran');
  assert.deepEqual(r.ran, ['ack']);
  assert.equal(r.router.pending(r.wc), 0);
  assert.equal(r.timers[0].cleared, true, 'the time limit is cancelled');
  assert.equal(r.router.ack(r.wc, r.payload()), 'unknown', 'an answer is used once');
});

test('a page that consumes the key (preventDefault on the keydown): the command never runs', () => {
  const r = rig();
  r.router.ready(r.wc, 'f1');
  r.router.defer(r.wc, r.input, why => r.ran.push(why), 'f1');
  assert.equal(r.router.ack(r.wc, r.payload({prevented: true})), 'consumed');
  assert.deepEqual(r.ran, []);
  r.fire(0);
  assert.deepEqual(r.ran, [], 'and the time limit is gone');
});

test('a page that never answers: the command runs when the time is up, and that frame is no longer asked until it says it is ready again', () => {
  const r = rig();
  r.router.ready(r.wc, 'f1');
  r.router.defer(r.wc, r.input, why => r.ran.push(why), 'f1');
  r.fire(0);
  assert.deepEqual(r.ran, ['timeout']);
  assert.equal(r.router.canAcknowledge(r.wc, 'f1'), false);
  r.router.ready(r.wc, 'f1');
  assert.equal(r.router.canAcknowledge(r.wc, 'f1'), true);
});

test('two presses of one key are answered in the order they were made; another key\'s answer touches nothing', () => {
  const r = rig();
  r.router.ready(r.wc, 'f1');
  r.router.defer(r.wc, r.input, why => r.ran.push('first:' + why), 'f1');
  r.router.defer(r.wc, r.input, why => r.ran.push('second:' + why), 'f1');
  assert.equal(r.router.ack(r.wc, r.payload({code: 'KeyL', key: 'l'})), 'unknown');
  r.router.ack(r.wc, r.payload({prevented: true}));
  r.router.ack(r.wc, r.payload());
  assert.deepEqual(r.ran, ['second:ack'], 'the first was consumed, the second ran');
});

test('the physical key decides when the spelling differs (a dead key, an Option combination); modifiers and repeat must match', () => {
  const r = rig();
  r.router.ready(r.wc, 'f1');
  r.router.defer(r.wc, {...r.input, key: 'k'}, why => r.ran.push(why), 'f1');
  assert.equal(r.router.ack(r.wc, r.payload({key: 'Dead'})), 'ran');
  r.router.defer(r.wc, r.input, why => r.ran.push(why), 'f1');
  assert.equal(r.router.ack(r.wc, r.payload({ctrl: false})), 'unknown');
  assert.equal(r.router.ack(r.wc, r.payload({repeat: true})), 'unknown');
  assert.equal(r.router.pending(r.wc), 1);
  assert.deepEqual(signatureOf(down('k', {control: true, isAutoRepeat: true})), {key: 'k', code: 'KeyK', ctrl: true, alt: false, shift: false, meta: false, repeat: true});
});

test('a page that is gone or hidden: abandoned keys run nothing; a new document forgets which frames could answer', () => {
  const r = rig();
  r.router.ready(r.wc, 'f1');
  r.router.defer(r.wc, r.input, why => r.ran.push(why), 'f1');
  r.router.abandon(r.wc);
  assert.equal(r.router.ack(r.wc, r.payload()), 'unknown');
  r.fire(0);
  assert.deepEqual(r.ran, []);
  r.router.forgetFrames(r.wc);
  assert.equal(r.router.canAcknowledge(r.wc, 'f1'), false);
  assert.equal(r.router.canAcknowledge({id: 2}, 'f1'), false, 'another page');
});

// ------------------------------------------------------------------------------------------------ macOS menu

test('macOS: a key that is also an application-menu accelerator stays the browser\'s first (the menu would run it a second time); keys the menu does not bind go to the page', () => {
  const rules = menuAccelerators(macMenuTemplate(() => {}, {report: true}));
  assert.ok(rules.length >= 20, 'the menu binds its keys: ' + rules.length);
  const cmd = (key, mods = {}, code) => down(key, {meta: true, ...mods}, code ? {code} : {});
  for (const input of [cmd('r'), cmd('r', {shift: true}), cmd('['), cmd(']'), cmd('d'), cmd('y'), cmd('0', {}, 'Digit0'), cmd('-', {}, 'Minus'), cmd('=', {}, 'Equal'), cmd('=', {shift: true}, 'Equal'), cmd(',', {}), cmd('b', {alt: true}), cmd('s'), cmd('p'), cmd('t'), cmd('w')])
    assert.equal(matchesMenuAccelerator(rules, input, shortcutKey), true, JSON.stringify([input.key, input.shift, input.alt]));
  for (const input of [cmd('k'), cmd('l'), cmd('f'), cmd('g'), cmd('j'), cmd('o'), cmd('k', {shift: true}), down('F5', {}, {code: 'F5'}), down('k', {control: true})])
    assert.equal(matchesMenuAccelerator(rules, input, shortcutKey), false, JSON.stringify([input.key, input.shift, input.control]));
  assert.equal(matchesMenuAccelerator(null, cmd('r'), shortcutKey), false, 'Windows and Linux have no menu');
});
