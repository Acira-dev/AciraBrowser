'use strict';
// 13.8 (Windows laptop): an AI assistant extension's Ctrl+E (the shortcut that closes its side panel) never ran. Its manifest suggests Ctrl+E (Command+E on a Mac); on Windows and Linux Ctrl+E is ALSO the address bar's alias for "focus the
// address bar" (Chrome's focus-search key), so the registry counted it "taken by Acira" and left the extension's command without a key: Ctrl+E only focused the address bar. A Mac has no Cmd+E in Acira, which is why it worked there.
// What an extension may take is an ALIAS of a browser command (a default that is not the command's first), never a command's own key, a key the person gave a command, or a reserved one. No Electron: the real registry and host fixture.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const bridge = require('../desktop/browser-services/ext-api/surfaces/bridge.cjs');
const {createShortcutRegistry} = require('../desktop/shortcut-registry.cjs');
const {host, manifestExtension, ID, ID2} = require('./fixtures/ext-api-p8/host.cjs');

const manifest = commands => ({manifest_version: 3, name: 'Cmd', version: '1', action: {}, commands, background: {service_worker: 'sw.js'}});
const assistant = () => manifestExtension(ID, manifest({'toggle-side-panel': {suggested_key: {default: 'Ctrl+E', mac: 'Command+E'}, description: 'Toggle the side panel'}}), 'AI assistant');
const input = (key, mods = {}) => ({type: 'keyDown', key, code: 'Key' + key.toUpperCase(), control: false, alt: false, shift: false, meta: false, ...mods});
const keyOf = event => event.key;

async function withRegistry(platform, run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-commands-alias-'));
  const registry = createShortcutRegistry({file: path.join(dir, 'shortcuts.json'), platform});
  bridge.setShortcuts(registry);
  try { return await run(registry); } finally { bridge.setShortcuts(null); fs.rmSync(dir, {recursive: true, force: true}); }
}
const mine = (registry, name) => registry.list().find(c => c.id.endsWith(`:${ID}:${encodeURIComponent(name)}`));
const stock = (input, platform) => require('../desktop/shortcuts.cjs').resolveShortcut ? require('../desktop/shortcuts.cjs').resolveShortcut(input, platform) : null;

test('Windows: an AI assistant extension\'s Ctrl+E is the extension\'s, the address bar keeps Ctrl+L, Ctrl+K, F6 and Alt+D, and a key press runs the extension\'s command', async () => {
  await withRegistry('win32', async registry => {
    const before = registry.list().find(c => c.id === 'address');
    assert.ok(before.bindings.includes('Ctrl+E'), 'the address bar answers to Ctrl+E until an extension asks for it');
    const h = host({packages: ['commands'], extensions: [assistant()]});
    try {
    const command = mine(registry, 'toggle-side-panel');
    assert.deepEqual(command.bindings, ['Ctrl+E'], 'the command has its suggested key');
    const address = registry.list().find(c => c.id === 'address');
    assert.deepEqual(address.bindings, ['Ctrl+L', 'Ctrl+K', 'F6', 'Alt+D'], 'the address bar keeps its own key and its other aliases, and gives up only Ctrl+E');
    // the key press itself: the registry answers with the extension's command before the stock table (which says "address")
    const resolved = registry.resolve(input('e', {control: true}), () => ({action: 'address'}), keyOf);
    assert.equal(resolved && resolved.action, 'extension-command', 'Ctrl+E runs the extension command');
    assert.equal(resolved.command, 'toggle-side-panel');
    const l = registry.resolve(input('l', {control: true}), () => ({action: 'address'}), keyOf);
    assert.equal(l.action, 'address', 'Ctrl+L still focuses the address bar');
    } finally { h.dispose(); }
  });
});

test('a Mac is unchanged (Acira has no Cmd+E): the command has Cmd+E and Cmd+L is the address bar\'s', async () => {
  await withRegistry('darwin', async registry => {
    const h = host({packages: ['commands'], extensions: [assistant()]});
    try {
      assert.deepEqual(mine(registry, 'toggle-side-panel').bindings, ['Cmd+E']);
      assert.deepEqual(registry.list().find(c => c.id === 'address').bindings, ['Cmd+L', 'Cmd+K', 'F6'], 'nothing was taken from the address bar there');
    } finally { h.dispose(); }
  });
});

test('what an extension still never takes: a command\'s own first key (Ctrl+R, Ctrl+L), a reserved command\'s alias (Ctrl+F4 closes the tab), a reserved combination (Ctrl+C), a key the person gave a command', async () => {
  await withRegistry('win32', async registry => {
    const taker = manifestExtension(ID, manifest({
      reload: {suggested_key: {default: 'Ctrl+R'}, description: 'r'}, own: {suggested_key: {default: 'Ctrl+L'}, description: 'l'},
      closer: {suggested_key: {default: 'Ctrl+F4'}, description: 'f4'}, copy: {suggested_key: {default: 'Ctrl+C'}, description: 'c'}
    }), 'Taker');
    // the person's own choice: Ctrl+Shift+9 is given to a browser command before any extension asks
    const given = registry.set('downloads', 'Ctrl+Shift+9');
    assert.equal(given.ok, true);
    const two = manifestExtension(ID2, manifest({mine: {suggested_key: {default: 'Ctrl+Shift+9'}, description: 'u'}}), 'Other');
    const h = host({packages: ['commands'], extensions: [taker, two]});
    try {
      const byName = name => registry.list().find(c => c.id.includes(`:${encodeURIComponent(name)}`));
      for (const name of ['reload', 'own', 'closer', 'copy']) assert.deepEqual(byName(name).bindings, [], `${name}: Acira keeps it`);
      assert.deepEqual(byName('mine').bindings, [], 'a key the person gave a command is theirs');
      assert.ok(registry.list().find(c => c.id === 'downloads').bindings.includes('Ctrl+Shift+9'));
    } finally { h.dispose(); }
  });
});

test('the first extension keeps a shared alias, and the address bar gets Ctrl+E back when the extension goes', async () => {
  await withRegistry('win32', async registry => {
    const second = manifestExtension(ID2, manifest({other: {suggested_key: {default: 'Ctrl+E'}, description: 'second'}}), 'Second');
    const h = host({packages: ['commands'], extensions: [assistant(), second]});
    assert.deepEqual(mine(registry, 'toggle-side-panel').bindings, ['Ctrl+E']);
    const other = registry.list().find(c => c.id.includes(`:${ID2}:`));
    assert.deepEqual(other.bindings, [], 'the second one did not get it');
    assert.ok(!registry.list().find(c => c.id === 'address').bindings.includes('Ctrl+E'));
    h.dispose();
    assert.ok(registry.list().find(c => c.id === 'address').bindings.includes('Ctrl+E'), 'the address bar has its alias again when the extension is gone');
  });
});
