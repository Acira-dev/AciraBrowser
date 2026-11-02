'use strict';
// chrome.commands (ext-api/commands*.cjs): the manifest's commands in Acira's shortcut registry, suggested keys that give way to Acira's own, getAll,
// key presses reaching onCommand / the action button, and the extension page/worker side.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const extApi = require('../desktop/browser-services/ext-api/index.cjs');
const keys = require('../desktop/browser-services/ext-api/commands/keys.cjs');
const bridge = require('../desktop/browser-services/ext-api/surfaces/bridge.cjs');
const {createShortcutRegistry} = require('../desktop/shortcut-registry.cjs');
const {host, manifestExtension, ID, ID2} = require('./fixtures/ext-api-p8/host.cjs');
const {extensionWorld, plain} = require('./fixtures/ext-api/world.cjs');

test('suggested keys: Chromium\'s rules, per platform', () => {
  const win = 'win32', mac = 'darwin';
  assert.equal(keys.parseAccelerator('Ctrl+Shift+Y', win), 'Ctrl+Shift+Y');
  assert.equal(keys.parseAccelerator('Alt+Shift+F5', win), 'Alt+Shift+F5');
  assert.equal(keys.parseAccelerator('Ctrl+Comma', win), 'Ctrl+,');
  assert.equal(keys.parseAccelerator('Ctrl+Period', win), 'Ctrl+.');
  assert.equal(keys.parseAccelerator('Alt+Left', win), 'Alt+Left');
  assert.equal(keys.parseAccelerator('MediaPlayPause', win), 'MediaPlayPause', 'media keys need no modifier');
  assert.equal(keys.parseAccelerator('Y', win), null, 'a letter alone');
  assert.equal(keys.parseAccelerator('Shift+Y', win), null, 'Shift alone is not enough');
  assert.equal(keys.parseAccelerator('Ctrl+y', win), null, 'keys are upper case');
  assert.equal(keys.parseAccelerator('Ctrl+Ctrl+Y', win), null);
  assert.equal(keys.parseAccelerator('Ctrl+F13', win), null);
  assert.equal(keys.parseAccelerator('Command+Y', win), null, 'Command exists on a Mac only');
  assert.equal(keys.parseAccelerator('Ctrl+Y', mac), 'Cmd+Y', 'Ctrl means Command on a Mac');
  assert.equal(keys.parseAccelerator('MacCtrl+Y', mac), 'Ctrl+Y');
  assert.equal(keys.suggestedFor({default: 'Ctrl+Y', windows: 'Alt+Y'}, 'win32'), 'Alt+Y');
  assert.equal(keys.suggestedFor({default: 'Ctrl+Y', windows: 'Alt+Y'}, 'linux'), 'Ctrl+Y');
  assert.equal(keys.suggestedFor('Ctrl+U', 'linux'), 'Ctrl+U');
  const list = keys.commandsOf({commands: {
    _execute_action: {suggested_key: {default: 'Ctrl+Shift+1'}, description: 'Open'},
    a: {suggested_key: {default: 'Ctrl+Shift+2'}, description: 'A'}, b: {suggested_key: {default: 'Ctrl+Shift+3'}}, c: {suggested_key: {default: 'Ctrl+Shift+4'}},
    d: {suggested_key: {default: 'Ctrl+Shift+5'}, description: 'too many'}, bad: 5, _execute_nothing: {}, bogus: {suggested_key: {default: 'nonsense'}}, global: {suggested_key: {default: 'Ctrl+Shift+6'}, global: true}
  }}, {platform: 'win32'});
  assert.deepEqual(list.map(c => [c.name, c.key]), [['_execute_action', 'Ctrl+Shift+1'], ['a', 'Ctrl+Shift+2'], ['b', 'Ctrl+Shift+3'], ['c', 'Ctrl+Shift+4'], ['d', ''], ['bogus', ''], ['global', '']],
    'four suggestions at most; unknown _execute_* and non-objects dropped');
});

function registryWith(dir) {
  const changes = [];
  const registry = createShortcutRegistry({file: path.join(dir, 'shortcuts.json'), platform: process.platform, onChange: () => changes.push(1)});
  bridge.setShortcuts(registry);
  return {registry, changes};
}
const withRegistry = async (run) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-commands-'));
  try { return await run(registryWith(dir), dir); } finally { bridge.setShortcuts(null); fs.rmSync(dir, {recursive: true, force: true}); }
};
const manifest = (commands, extra = {}) => ({manifest_version: 3, name: 'Cmd', version: '1', action: {}, commands, background: {service_worker: 'sw.js'}, ...extra});

test('registry: every command appears under Extensions with its suggested key; Acira\'s own keys win; the first extension keeps a shared key', async () => {
  await withRegistry(async ({registry}) => {
    const one = manifestExtension(ID, manifest({
      _execute_action: {suggested_key: {default: 'Ctrl+Shift+Y'}, description: 'x'},
      toggle: {suggested_key: {default: 'Alt+T'}, description: 'Toggle thing'},          // Acira's "Open tab switcher" (Alt+T on every platform)
      reload: {suggested_key: {default: 'Ctrl+R'}, description: 'Reload thing'},                // Acira's reload
      unbound: {description: 'No key'}
    }), 'Tool');
    const two = manifestExtension(ID2, manifest({other: {suggested_key: {default: 'Ctrl+Shift+Y'}, description: 'Same key'}}), 'Other');
    const h = host({packages: ['commands'], extensions: [one, two]});
    const list = registry.list().filter(c => c.id.startsWith('ext:'));
    const byId = Object.fromEntries(list.map(c => [c.id.split(':').slice(2).join(':'), c]));
    assert.equal(list.length, 5);
    assert.ok(list.every(c => c.category === 'Extensions'));
    assert.deepEqual(byId[`${ID}:_execute_action`].bindings, [registry.canonical(keys.parseAccelerator('Ctrl+Shift+Y'))]);
    assert.deepEqual(byId[`${ID}:toggle`].bindings, [], 'Alt+T belongs to Acira');
    assert.deepEqual(byId[`${ID}:reload`].bindings, [], 'Ctrl+R belongs to Acira');
    assert.deepEqual(byId[`${ID}:unbound`].bindings, []);
    assert.deepEqual(byId[`${ID2}:other`].bindings, [], 'Ctrl+Shift+Y went to the extension that came first');
    assert.equal(byId[`${ID}:toggle`].label, 'Tool: Toggle thing');
    assert.ok(registry.list().find(c => c.id === 'tab-viewer').bindings.includes('Alt+T'), 'Acira\'s own binding is untouched');
    // the key reaches the extension: the registry answers a key press with the command
    const press = {type: 'keyDown', key: 'y', control: process.platform !== 'darwin', shift: true, alt: false, meta: process.platform === 'darwin'};
    const action = registry.resolve(press, () => null, input => input.key);
    assert.deepEqual(action, {action: 'extension-command', profileId: 'profile-1', extensionId: ID, command: '_execute_action'});
    h.dispose();
    assert.equal(registry.list().filter(c => c.id.startsWith('ext:')).length, 0, 'gone with the profile');
  });
});

test('the person\'s own key for an extension command is kept (Settings › Shortcuts) and getAll reports it', async () => {
  await withRegistry(async ({registry}) => {
    const ext = manifestExtension(ID, manifest({go: {suggested_key: {default: 'Ctrl+Alt+J'}, description: 'Go'}, _execute_action: {}}), 'Tool');
    const h = host({packages: ['commands'], extensions: [ext]});
    const id = `ext:profile-1:${ID}:go`;
    assert.deepEqual(await h.call('commands.getAll', ext), [
      {name: 'go', description: 'Go', shortcut: registry.canonical(keys.parseAccelerator('Ctrl+Alt+J')).replace(/\bCmd\b/g, 'Command')},
      {name: '_execute_action', description: 'Activate the extension', shortcut: ''}]);
    assert.equal(registry.set(id, 'Ctrl+Shift+8').ok, true);
    assert.equal((await h.call('commands.getAll', ext))[0].shortcut, 'Ctrl+Shift+8');
    registry.clear(id);
    assert.equal((await h.call('commands.getAll', ext))[0].shortcut, '', 'cleared');
    // a new run of the app brings the choice back
    h.dispose();
    const second = host({packages: ['commands'], extensions: [ext]});
    assert.deepEqual(registry.list().find(c => c.id === id).bindings, [], 'still cleared');
    second.dispose();
  });
});

test('a key press: a named command fires onCommand with the tab; _execute_action is a click on the button; other profiles and unknown names do nothing', async () => {
  await withRegistry(async () => {
    const ext = manifestExtension(ID, manifest({go: {suggested_key: {default: 'Ctrl+Alt+J'}, description: 'Go'}, _execute_action: {suggested_key: {default: 'Ctrl+Shift+Y'}}}), 'Tool');
    const h = host({packages: ['commands'], extensions: [ext], tabs: {4: {id: 4, url: 'https://a.test/', active: true}}});
    const controller = bridge.all('commands').find(entry => entry.session === h.session).controller;
    assert.equal(controller.profileId, 'profile-1');
    const wc = {id: 4, isDestroyed: () => false};
    assert.equal(controller.run(ID, 'go', wc), true);
    assert.deepEqual(h.sent, [[ID, 'commands.onCommand', 'go', {id: 4, url: 'https://a.test/', active: true}]]);
    assert.equal(controller.run(ID, 'nope', wc), false);
    assert.equal(controller.run(ID2, 'go', wc), false);
    // _execute_action goes to the action package's controller
    const invoked = [];
    const release = bridge.register(h.session, 'action', {invoke: (id, contents) => { invoked.push([id, contents.id]); return true; }});
    assert.equal(controller.run(ID, '_execute_action', wc), true);
    assert.deepEqual(invoked, [[ID, 4]]);
    release();
    h.dispose();
  });
});

test('global (system-wide) shortcuts are not registered', async () => {
  await withRegistry(async ({registry}) => {
    const ext = manifestExtension(ID, manifest({everywhere: {suggested_key: {default: 'Ctrl+Shift+H'}, description: 'Global', global: true}}), 'Tool');
    const h = host({packages: ['commands'], extensions: [ext]});
    assert.equal(registry.list().filter(c => c.id.startsWith('ext:')).length, 0);
    h.dispose();
  });
});

function world(m, options = {}) {
  const packages = extApi.loadPackages({fresh: true}).filter(p => p.name === 'commands');
  return extensionWorld({name: 'x', version: '1', ...m}, {packages, ...options});
}

test('extension side: getAll and onCommand; no chrome.commands without the manifest key', async () => {
  const w = world(manifest({go: {description: 'Go'}}), {worker: true, answer: name => (name === 'commands.getAll' ? [{name: 'go', description: 'Go', shortcut: 'Ctrl+G'}] : undefined)});
  assert.deepEqual(plain(await w.chrome.commands.getAll()), [{name: 'go', description: 'Go', shortcut: 'Ctrl+G'}]);
  let got = null;
  w.chrome.commands.onCommand.addListener((command, tab) => { got = [command, tab && tab.id]; });
  w.emit('commands.onCommand', 'go', {id: 3});
  assert.deepEqual(got, ['go', 3]);
  const none = world({manifest_version: 3}, {worker: true});
  assert.equal(none.chrome.commands, undefined);
});
