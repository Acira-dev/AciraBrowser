import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { platformCatalogText } from '../src/i18n/platform';
import { LOCALES } from '../src/i18n/locales';

const require = createRequire(import.meta.url);
const { createShortcutRegistry } = require('../desktop/shortcut-registry.cjs');
const { resolveDefaultShortcut } = require('../desktop/shortcuts.cjs');
const { macMenuTemplate } = require('../desktop/platform.cjs');

// New Tor window showed ⌥⇧N on a Mac (Settings > Shortcuts, the Acira menu, Privacy), but Option+Shift+N types a character there and the
// Mac resolver ignores Option+letter: the key did nothing. On a Mac it is now Option+Cmd+N (Brave's Mac key for the same window).
const key = (mods: string[]) => ({ type: 'keyDown', key: 'n', code: 'KeyN', meta: mods.includes('cmd'), alt: mods.includes('alt'), shift: mods.includes('shift'), control: mods.includes('ctrl') });

test('Option+Cmd+N opens a Tor window on a Mac; the Windows key is unchanged', () => {
  assert.deepEqual(resolveDefaultShortcut(key(['cmd', 'alt']), 'darwin'), { action: 'tor-window' });
  assert.equal(resolveDefaultShortcut(key(['alt', 'shift']), 'darwin'), null, 'Option+Shift+N still types its character');
  assert.deepEqual(resolveDefaultShortcut(key(['cmd', 'shift']), 'darwin'), { action: 'private-window' });
  assert.deepEqual(resolveDefaultShortcut(key(['cmd']), 'darwin'), { action: 'new-window' });
  assert.equal(resolveDefaultShortcut(key(['cmd', 'alt', 'shift']), 'darwin'), null);
  assert.deepEqual(resolveDefaultShortcut(key(['alt', 'shift']), 'win32'), { action: 'tor-window' });
  assert.equal(resolveDefaultShortcut(key(['ctrl', 'alt']), 'win32'), null, 'Ctrl+Alt+N stays free on Windows (AltGr)');
});

test('on a Mac no two commands share a key, and Option+Cmd+N is New Tor window\'s alone', () => {
  const mac = createShortcutRegistry({ platform: 'darwin' }), owner = new Map<string, string>();
  for (const command of mac.list()) for (const accel of command.bindings) {
    assert.ok(!owner.has(accel), `${accel} is a Mac key of both ${owner.get(accel)} and ${command.id}`);
    owner.set(accel, command.id);
  }
  assert.equal(owner.get('Alt+Cmd+N'), 'tor-window');
  assert.equal(mac.describe('Alt+Cmd+N', 'tor-window').valid, true, 'not a key the editor refuses');
  const windows = createShortcutRegistry({ platform: 'win32' });
  assert.deepEqual(windows.list().find((command: { id: string }) => command.id === 'tor-window').bindings, ['Alt+Shift+N']);
});

test('the Mac File menu has New Tor Window on Option+Cmd+N, beside New Private Window', () => {
  const seen: string[] = [], file = macMenuTemplate((command: { action: string }) => seen.push(command.action)).find((menu: { label: string }) => menu.label === 'File');
  const labels = file.submenu.map((item: { label?: string }) => item.label);
  const tor = file.submenu.find((item: { label?: string }) => item.label === 'New Tor Window');
  if (!['arm64', 'x64'].includes(process.arch)) return assert.equal(tor, undefined);
  assert.equal(labels.indexOf('New Tor Window'), labels.indexOf('New Private Window') + 1);
  assert.equal(tor.accelerator, 'Command+Option+N');
  const menuKeys = macMenuTemplate(() => undefined).flatMap((menu: { submenu?: { accelerator?: string }[] }) => (menu.submenu || []).map((item) => item.accelerator).filter(Boolean));
  assert.equal(menuKeys.filter((accelerator: string) => accelerator === 'Command+Option+N').length, 1, 'no other menu item has the key');
  tor.click(tor, null, {});
  assert.deepEqual(seen, ['tor-window']);
});

test('the in-app menus and the Privacy sentence show the Mac key', () => {
  for (const file of ['src/components/BrowserMenu.tsx', 'src/App.tsx']) assert.match(readFileSync(file, 'utf8'), /isMac\(\) ?\? ?'Cmd Alt N' ?: ?'Alt Shift N'/, file);
  for (const { code } of LOCALES) {
    const text = JSON.parse(readFileSync(`src/i18n/${code}.json`, 'utf8'))['privacy.forAnonymityRatherThanA'] as string;
    const mac = platformCatalogText('privacy.forAnonymityRatherThanA', text, 'darwin');
    assert.ok(mac.includes('⌥⌘N') && !/Alt|⌥⇧N/.test(mac), `${code}: ${mac}`);
    assert.equal(platformCatalogText('privacy.forAnonymityRatherThanA', text, 'win32'), text);
  }
});
