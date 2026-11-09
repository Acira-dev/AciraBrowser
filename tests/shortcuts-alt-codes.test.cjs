'use strict';
// Windows types a character by its code while Alt is held and the digits go in on the numeric keypad (Alt+0233 = é). Alt+1..8 is Acira's "go to workspace" shortcut; the keypad's
// digits reported the same key '2' with code Numpad2, so every digit of an Alt code switched workspace (or was swallowed) and the character never came.
const test = require('node:test'), assert = require('node:assert/strict');
const { resolveDefaultShortcut, shortcutKey } = require('../desktop/shortcuts.cjs');
const { createShortcutRegistry } = require('../desktop/shortcut-registry.cjs');

const key = (code, extra = {}) => ({ type: 'keyDown', key: code.replace(/^(Digit|Numpad)/, ''), code, alt: true, control: false, shift: false, meta: false, isAutoRepeat: false, ...extra });

test('Alt + a top-row digit still goes to that workspace; Alt + a keypad digit is left to the system', () => {
  for (const platform of ['win32', 'linux']) {
    for (let n = 1; n <= 8; n++) {
      assert.deepEqual(resolveDefaultShortcut(key('Digit' + n), platform), { action: 'switch-workspace', index: n - 1 }, `Alt+${n} on ${platform}`);
      assert.equal(resolveDefaultShortcut(key('Numpad' + n), platform), null, `Alt+Numpad${n} on ${platform}`);
    }
    for (const digit of ['0', '9']) assert.equal(resolveDefaultShortcut(key('Numpad' + digit), platform), null);
  }
});

test('the shortcut table (default bindings) agrees', () => {
  const registry = createShortcutRegistry({ platform: 'win32' });
  assert.deepEqual(registry.resolve(key('Digit3'), resolveDefaultShortcut, shortcutKey), { action: 'switch-workspace', index: 2 });
  assert.equal(registry.resolve(key('Numpad3'), resolveDefaultShortcut, shortcutKey), null);
});

test('the keypad is still the keypad for the other shortcuts: Ctrl+Numpad digit selects a tab, Alt+Numpad plus/minus is not a zoom', () => {
  assert.deepEqual(resolveDefaultShortcut(key('Numpad2', { alt: false, control: true }), 'win32'), { action: 'select-tab', index: 1 });
  assert.equal(resolveDefaultShortcut({ type: 'keyDown', key: 'Add', code: 'NumpadAdd', alt: true, control: false, shift: false, meta: false }, 'win32'), null);
});
