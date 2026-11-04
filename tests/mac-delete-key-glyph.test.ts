import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

// On a Mac the key labelled "delete" is Backspace (⌫); forward delete (fn+delete) is Delete (⌦). Clear browsing data read
// "⇧⌘Delete"; a binding recorded on the ⌫ key read "⇧ ⌘ Backspace", and one recorded on ⌦ read like the ⌫ key, though ⌫ does not
// run it. Every surface now shows the key that fires: Backspace as ⌫, Delete as ⌦, and the stock binding is stored on ⌫, the key
// every Mac keyboard has (the resolver still takes ⌦ for it too). Windows is unchanged.
Object.assign(globalThis, { window: { acira: { platform: 'darwin' } } });
const { formatShortcut, shortcutLabel } = await import('../src/ui/platform');
const require = createRequire(import.meta.url);
const { createShortcutRegistry, display } = require('../desktop/shortcut-registry.cjs');
const { resolveDefaultShortcut, shortcutKey } = require('../desktop/shortcuts.cjs');
const press = (key: string) => ({ type: 'keyDown', key, code: key, meta: true, shift: true, control: false, alt: false });
const registry = (platform: string) => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-shortcuts-')); return { r: createShortcutRegistry({ platform, file: path.join(dir, 'shortcuts.json') }), done: () => fs.rmSync(dir, { recursive: true, force: true }) }; };

test('menu hints written in Windows terms show the Mac delete key as ⌫', () => {
  assert.equal(formatShortcut('Ctrl Shift Delete'), '⇧⌘⌫', 'Windows Delete is the key a Mac calls delete');
  assert.equal(shortcutLabel('Ctrl + Shift + Delete'), '⇧⌘⌫');
  assert.equal(formatShortcut('Ctrl Shift T'), '⇧⌘T', 'other keys unchanged');
  assert.equal(formatShortcut('Delete'), 'Delete', 'a key named alone in a sentence stays a word');
});

test('the stock Mac binding is the ⌫ key, shown as ⌫, and both delete keys run it', () => {
  const { r, done } = registry('darwin');
  try {
    assert.deepEqual(r.list().find((command: { id: string }) => command.id === 'clear-data').bindings, ['Shift+Cmd+Backspace']);
    assert.equal(r.menuKey('clear-data'), '⇧⌘⌫');
    assert.equal(r.resolve(press('Backspace'), resolveDefaultShortcut, shortcutKey)?.action, 'clear-data');
    assert.equal(r.resolve(press('Delete'), resolveDefaultShortcut, shortcutKey)?.action, 'clear-data');
  } finally { done(); }
});

test('a binding recorded on forward delete shows ⌦, the only key that runs it', () => {
  const { r, done } = registry('darwin');
  try {
    assert.equal(r.set('clear-data', 'Shift+Cmd+Delete').display, '⇧⌘⌦');
    assert.equal(r.resolve(press('Delete'), resolveDefaultShortcut, shortcutKey)?.action, 'clear-data');
    assert.equal(r.resolve(press('Backspace'), resolveDefaultShortcut, shortcutKey), null);
    assert.equal(display('Shift+Cmd+Backspace', 'darwin'), '⇧⌘⌫');
  } finally { done(); }
});

test('Windows keeps Ctrl+Shift+Delete', () => {
  const { r, done } = registry('win32');
  try {
    assert.deepEqual(r.list().find((command: { id: string }) => command.id === 'clear-data').bindings, ['Ctrl+Shift+Delete']);
    assert.equal(display('Ctrl+Shift+Delete', 'win32'), 'Ctrl + Shift + Delete');
  } finally { done(); }
});

test('Settings › Shortcuts key caps on a Mac: Backspace is ⌫ and Delete is ⌦ (the panel imports CSS, so its rule is read)', () => {
  const panel = fs.readFileSync(new URL('../src/features/settings/panels/shortcuts.tsx', import.meta.url), 'utf8');
  assert.match(panel, /const MAC_KEYS: Record<string, string> = \{ Backspace: '⌫', Delete: '⌦' \};/);
  assert.match(panel, /\(mac && \(MAC_GLYPHS\[part\] \|\| MAC_KEYS\[part\]\)\) \|\| KEY_NAMES\[part\]/);
});
