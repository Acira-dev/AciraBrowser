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

// ---- beta.14: keys that outlive their extension's presence, startup order, Windows and Mac key forms ----
const {shortcutKey} = require('../desktop/shortcuts.cjs');
const readFile = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'shortcuts.json'), 'utf8')).bindings;
const extId = (id, name) => `ext:profile-1:${id}:${name}`;

test('the person\'s keys for an extension wait while it is away (turned off, another profile not open yet), come back with it, and go only when it is removed', async () => {
  await withRegistry(async ({registry}, dir) => {
    const ext = manifestExtension(ID, manifest({
      go: {suggested_key: {default: 'Ctrl+Alt+J'}, description: 'Go'}, second: {description: 'Second'}, third: {suggested_key: {default: 'Ctrl+Alt+K'}, description: 'Third'}
    }), 'Tool');
    let h = host({packages: ['commands'], extensions: [ext]});
    assert.equal(registry.set(extId(ID, 'go'), 'Ctrl+Shift+8').ok, true);
    assert.equal(registry.set(extId(ID, 'second'), 'Ctrl+Shift+9').ok, true);
    assert.equal(registry.clear(extId(ID, 'third')).ok, true);
    // the extension is turned off: its rows go, then the person changes a key that has nothing to do with it
    h.dispose();
    assert.equal(registry.list().filter(c => c.id.startsWith('ext:')).length, 0);
    assert.equal(registry.set('print', 'Ctrl+Shift+F8').ok, true);
    assert.equal(registry.clear('find-next').ok, true);
    const saved = readFile(dir);
    assert.deepEqual(saved[extId(ID, 'go')], ['Ctrl+Shift+8'], 'still in the file');
    assert.deepEqual(saved[extId(ID, 'second')], ['Ctrl+Shift+9']);
    assert.deepEqual(saved[extId(ID, 'third')], [], 'a cleared key stays cleared');
    assert.deepEqual(saved.print, ['Ctrl+Shift+F8'], 'the other change was saved too');
    // turned on again
    h = host({packages: ['commands'], extensions: [ext]});
    const by = Object.fromEntries(registry.list().filter(c => c.id.startsWith('ext:')).map(c => [c.id.split(':').pop(), c]));
    assert.deepEqual(by.go.bindings, ['Ctrl+Shift+8']);
    assert.deepEqual(by.second.bindings, ['Ctrl+Shift+9']);
    assert.deepEqual(by.third.bindings, [], 'cleared stays cleared (its suggestion is not used again)');
    assert.equal(by.go.customized, true);
    // a new run of the app (a new registry on the same file) finds them as well
    h.dispose();
    const again = createShortcutRegistry({file: path.join(dir, 'shortcuts.json'), platform: process.platform});
    bridge.setShortcuts(again);
    h = host({packages: ['commands'], extensions: [ext]});
    assert.deepEqual(again.list().find(c => c.id === extId(ID, 'go')).bindings, ['Ctrl+Shift+8'], 'survives a restart');
    // the extension is removed for good: its keys go with it, and a later install starts from the suggestions
    h.installed.forget(ID);
    h.dispose();
    assert.equal(Object.keys(readFile(dir)).some(id => id.startsWith('ext:')), false, 'nothing of it is left in the file');
    assert.deepEqual(readFile(dir).print, ['Ctrl+Shift+F8']);
    h = host({packages: ['commands'], extensions: [ext]});
    assert.deepEqual(again.list().find(c => c.id === extId(ID, 'go')).bindings, [again.canonical(keys.parseAccelerator('Ctrl+Alt+J'))], 'back to the suggested key');
    h.dispose();
  });
});

test('Reset all also drops the parked keys of an extension that is away', async () => {
  await withRegistry(async ({registry}, dir) => {
    const ext = manifestExtension(ID, manifest({go: {suggested_key: {default: 'Ctrl+Alt+J'}, description: 'Go'}}), 'Tool');
    let h = host({packages: ['commands'], extensions: [ext]});
    registry.set(extId(ID, 'go'), 'Ctrl+Shift+8');
    h.dispose();
    assert.deepEqual(readFile(dir)[extId(ID, 'go')], ['Ctrl+Shift+8']);
    registry.resetAll();
    assert.deepEqual(readFile(dir), {});
    h = host({packages: ['commands'], extensions: [ext]});
    assert.deepEqual(registry.list().find(c => c.id === extId(ID, 'go')).bindings, [registry.canonical(keys.parseAccelerator('Ctrl+Alt+J'))]);
    h.dispose();
  });
});

test('an extension that loads before the shortcut registry exists gets its rows when the registry arrives', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-commands-'));
  try {
    bridge.setShortcuts(null);
    const ext = manifestExtension(ID, manifest({go: {suggested_key: {default: 'Ctrl+Alt+J'}, description: 'Go'}, _execute_action: {suggested_key: {default: 'Ctrl+Shift+Y'}}}), 'Tool');
    const h = host({packages: ['commands'], extensions: [ext]});
    const registry = createShortcutRegistry({file: path.join(dir, 'shortcuts.json'), platform: process.platform});
    assert.equal(registry.list().filter(c => c.id.startsWith('ext:')).length, 0);
    bridge.setShortcuts(registry);   // main.cjs does this once the registry is built
    const rows = registry.list().filter(c => c.id.startsWith('ext:'));
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.find(c => c.id === extId(ID, 'go')).bindings, [registry.canonical(keys.parseAccelerator('Ctrl+Alt+J'))]);
    h.dispose();
  } finally { bridge.setShortcuts(null); fs.rmSync(dir, {recursive: true, force: true}); }
});

test('a registry that cannot take the commands does not break loading the extension (it warns, once per publish)', async () => {
  const warnings = [], original = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    bridge.setShortcuts({list: () => [], canonical: value => value, setDynamic() { throw new Error('boom'); }});
    const h = host({packages: ['commands'], extensions: [manifestExtension(ID, manifest({go: {description: 'Go'}}), 'Tool')]});
    assert.ok(warnings.some(line => /shortcuts were not registered: boom/.test(line)));
    h.dispose();
  } finally { console.warn = original; bridge.setShortcuts(null); }
});

test('Windows: Ctrl and Alt suggestions become keys that real key events reach; Command and MacCtrl suggestions do not exist there', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-commands-'));
  let h;
  try {
    const registry = createShortcutRegistry({file: path.join(dir, 'shortcuts.json'), platform: 'win32'});
    bridge.setShortcuts(registry);
    const one = manifestExtension(ID, manifest({
      _execute_action: {suggested_key: {default: 'Alt+Shift+Y', mac: 'Command+Shift+Y'}},
      digit: {suggested_key: {default: 'Ctrl+Shift+9'}, description: 'Digit'},
      comma: {suggested_key: {default: 'Ctrl+Shift+Comma'}, description: 'Comma'},
      period: {suggested_key: {default: 'Alt+Period'}, description: 'Period'}
    }), 'Tool');
    const two = manifestExtension(ID2, manifest({
      winlike: {suggested_key: {default: 'Ctrl+Shift+Y', windows: 'Ctrl+Alt+Y'}, description: 'Per platform'},
      macOnly: {suggested_key: {mac: 'Command+Shift+M'}, description: 'Mac only'},
      macWord: {suggested_key: {default: 'Command+Shift+K'}, description: 'Command on Windows'},
      macCtrl: {suggested_key: {default: 'MacCtrl+Shift+K'}, description: 'MacCtrl on Windows'}
    }), 'Other');
    h = host({packages: ['commands'], extensions: [one, two]});
    const bound = Object.fromEntries(registry.list().filter(c => c.id.startsWith('ext:')).map(c => [c.id.split(':').pop(), c.bindings]));
    assert.deepEqual(bound, {_execute_action: ['Alt+Shift+Y'], digit: ['Ctrl+Shift+9'], comma: ['Ctrl+Shift+,'], period: ['Alt+.'], winlike: ['Ctrl+Alt+Y'], macOnly: [], macWord: [], macCtrl: []});
    const press = (key, code, mods) => registry.resolve({type: 'keyDown', key, code, control: false, shift: false, alt: false, meta: false, ...mods}, () => null, shortcutKey);
    const command = (id, name) => ({action: 'extension-command', profileId: 'profile-1', extensionId: id, command: name});
    assert.deepEqual(press('Y', 'KeyY', {alt: true, shift: true}), command(ID, '_execute_action'));
    assert.deepEqual(press('(', 'Digit9', {control: true, shift: true}), command(ID, 'digit'), 'Shift turns 9 into ( on a US keyboard; the key is still 9');
    assert.deepEqual(press('<', 'Comma', {control: true, shift: true}), command(ID, 'comma'), 'Shift turns the comma into <; the key is still Comma');
    assert.deepEqual(press('.', 'Period', {alt: true}), command(ID, 'period'));
    assert.deepEqual(press('y', 'KeyY', {control: true, alt: true}), command(ID2, 'winlike'));
    assert.equal(press('y', 'KeyY', {control: true, shift: true}), null, 'Ctrl+Shift+Y is not taken by an extension that asked for another key on Windows');
    assert.equal(press('Y', 'KeyY', {meta: true, shift: true}), null, 'the Windows key does not stand in for Command');
  } finally { h?.dispose(); bridge.setShortcuts(null); fs.rmSync(dir, {recursive: true, force: true}); }
});

test('Mac: Ctrl in a manifest means Command, MacCtrl the Control key', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-commands-'));
  let h;
  try {
    const registry = createShortcutRegistry({file: path.join(dir, 'shortcuts.json'), platform: 'darwin'});
    bridge.setShortcuts(registry);
    const ext = manifestExtension(ID, manifest({
      a: {suggested_key: {default: 'Ctrl+Shift+Y'}, description: 'A'}, b: {suggested_key: {default: 'MacCtrl+Shift+U'}, description: 'B'}, c: {suggested_key: {default: 'Alt+Shift+I'}, description: 'C'}
    }), 'Tool');
    h = host({packages: ['commands'], extensions: [ext]});
    const bound = Object.fromEntries(registry.list().filter(c => c.id.startsWith('ext:')).map(c => [c.id.split(':').pop(), c.bindings]));
    assert.deepEqual(bound, {a: ['Shift+Cmd+Y'], b: ['Ctrl+Shift+U'], c: ['Alt+Shift+I']});
    const press = (key, code, mods) => registry.resolve({type: 'keyDown', key, code, control: false, shift: true, alt: false, meta: false, ...mods}, () => null, shortcutKey);
    assert.equal(press('Y', 'KeyY', {meta: true})?.command, 'a');
    assert.equal(press('U', 'KeyU', {control: true})?.command, 'b');
    assert.equal(press('I', 'KeyI', {alt: true})?.command, 'c');
    assert.equal(press('Y', 'KeyY', {control: true}), null, 'the Control key is not Command');
  } finally { h?.dispose(); bridge.setShortcuts(null); fs.rmSync(dir, {recursive: true, force: true}); }
});
