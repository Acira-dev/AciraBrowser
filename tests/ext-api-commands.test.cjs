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

test('a key on one of Acira\'s own pages (Settings, New tab): the command hears that page as the tab, not the website behind it, and nothing is granted', async () => {
  const activeTab = require('../desktop/browser-services/ext-api/surfaces/active-tab.cjs');
  await withRegistry(async () => {
    const ext = manifestExtension(ID, manifest({go: {suggested_key: {default: 'Ctrl+Alt+J'}, description: 'Go'}, _execute_action: {suggested_key: {default: 'Ctrl+Shift+Y'}}}), 'Tool');
    const front = {id: 2000000003, windowId: 1, active: true, url: 'chrome://settings/'};
    const asked = [];
    let h, bare;
    try {
    h = host({packages: ['commands'], extensions: [ext], tabs: {4: {id: 4, url: 'https://a.test/', active: false}}, store: {impl: {tabModel: {}}}});
    h.handlers.set('tabs.query', {callback: (event, info) => { if (!event.extension) return {__acira_error: 'ACCESS_DENIED'}; asked.push(info); return [front]; }, extensionContext: false});
    const controller = bridge.all('commands').find(entry => entry.session === h.session).controller;
    assert.equal(controller.run(ID, 'go', undefined), true);
    assert.deepEqual(h.sent, [[ID, 'commands.onCommand', 'go', front]], 'the page in front, as chrome.tabs describes it, never the last website tab');
    assert.deepEqual(asked, [{active: true, lastFocusedWindow: true}]);
    assert.equal(activeTab.has(h.session, ID, 4, 'https://a.test/'), false);
    // _execute_action is the action package's: it is told there is no page of its own to use.
    const invoked = [];
    const release = bridge.register(h.session, 'action', {invoke: (id, contents) => { invoked.push([id, contents]); return true; }});
    assert.equal(controller.run(ID, '_execute_action', undefined), true);
    assert.deepEqual(invoked, [[ID, undefined]]);
    release();
    // Without the tab list (a session that has none) the command still fires, with no tab, as before.
    bare = host({packages: ['commands'], extensions: [ext]});
    const bareController = bridge.all('commands').find(entry => entry.session === bare.session).controller;
    assert.equal(bareController.run(ID, 'go', undefined), true);
    assert.deepEqual(bare.sent, [[ID, 'commands.onCommand', 'go', undefined]]);
    } finally { h?.dispose(); bare?.dispose(); }
  });
});

test('a command that asks for a media key has no key and says why (Settings › Shortcuts); others carry no note', async () => {
  await withRegistry(async ({registry}) => {
    const ext = manifestExtension(ID, manifest({
      play: {suggested_key: {default: 'MediaPlayPause'}, description: 'Play or pause'},
      next: {suggested_key: {default: 'MediaNextTrack'}, description: 'Next'},
      go: {suggested_key: {default: 'Ctrl+Alt+J'}, description: 'Go'},
      plain: {description: 'No key'}
    }), 'Tool');
    let h;
    try {
      h = host({packages: ['commands'], extensions: [ext]});
      const byName = Object.fromEntries(registry.list().filter(c => c.id.startsWith('ext:')).map(c => [decodeURIComponent(c.id.split(':').pop()), c]));
      assert.deepEqual(['play', 'next', 'go', 'plain'].map(name => byName[name].note), ['media-key', 'media-key', undefined, undefined]);
      assert.deepEqual(byName.play.bindings, [], 'a media key cannot be delivered, so none is shown as set');
      assert.equal('note' in byName.go, false, 'the shape of every other row is unchanged');
      assert.equal(byName.go.bindings.length, 1);
    } finally { h?.dispose(); }
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

test('a key press names the tab as chrome.tabs does (a restored tab has its own id, not its page\'s)', async () => {
  await withRegistry(async () => {
    const ext = manifestExtension(ID, manifest({go: {suggested_key: {default: 'Ctrl+Alt+J'}, description: 'Go'}}), 'Tool');
    const h = host({packages: ['commands'], extensions: [ext], tabs: {4: {id: 4, url: 'https://a.test/', active: true}}});
    const controller = bridge.all('commands').find(entry => entry.session === h.session).controller;
    h.handlers.set('tabs.get', {callback: () => ({id: 2000000002, url: 'https://a.test/', active: true}), extensionContext: false});
    assert.equal(controller.run(ID, 'go', {id: 4, isDestroyed: () => false}), true);
    assert.equal(h.sent.at(-1)[3].id, 2000000002);
    h.dispose();
  });
});

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

// ---- beta.13.2: keys in private windows and tabs, for the extensions allowed there
const glue = require('../desktop/browser-services/ext-api/surfaces/main-glue.cjs');

test('private sessions: no rows of their own in Settings, their getAll answers with the profile\'s keys, and a key pressed in a private page runs in that page\'s private session', async () => {
  await withRegistry(async ({registry}) => {
    const ext = manifestExtension(ID, manifest({go: {suggested_key: {default: 'Ctrl+Alt+J'}, description: 'Go'}, _execute_action: {suggested_key: {default: 'Ctrl+Shift+Y'}}}), 'Tool');
    const ordinary = host({packages: ['commands'], extensions: [ext], tabs: {4: {id: 4, url: 'https://a.test/', active: true}}});
    const privateOne = host({packages: ['commands'], extensions: [ext], storeKey: 'private-tab-1', sourceProfileId: 'profile-1', tabs: {9: {id: 9, url: 'https://p.test/', active: true, incognito: true}}});
    assert.deepEqual(registry.list().filter(c => c.id.startsWith('ext:')).map(c => c.id.split(':')[1]), ['profile-1', 'profile-1'], 'one row per command, none for the private session');
    assert.equal((await privateOne.call('commands.getAll', ext)).find(c => c.name === 'go').shortcut, registry.list().find(c => c.id === extId(ID, 'go')).bindings[0].replace(/\bCmd\b/g, 'Command'), 'the private session reports the profile\'s key');
    const action = {action: 'extension-command', profileId: 'profile-1', extensionId: ID, command: 'go'};
    const privatePage = {id: 9, session: privateOne.session, isDestroyed: () => false};
    assert.equal(glue.runCommand(action, {webContents: privatePage, privateMode: true}), true);
    assert.deepEqual(privateOne.sent, [[ID, 'commands.onCommand', 'go', {id: 9, url: 'https://p.test/', active: true, incognito: true}]]);
    assert.deepEqual(ordinary.sent, [], 'the ordinary session did not hear a private key press');
    // an ordinary page still goes to the ordinary session
    assert.equal(glue.runCommand(action, {webContents: {id: 4, session: ordinary.session, isDestroyed: () => false}}), true);
    assert.equal(ordinary.sent.length, 1);
    assert.equal(privateOne.sent.length, 1);
    privateOne.dispose();
    assert.equal(registry.list().filter(c => c.id.startsWith('ext:')).length, 2, 'closing the private session leaves the profile\'s rows');
    ordinary.dispose();
  });
});

test('private keys: never for an extension that is not allowed in private, another profile\'s key, Tor or a private page without an extension session, or an Acira page', async () => {
  await withRegistry(async () => {
    const allowed = manifestExtension(ID, manifest({go: {suggested_key: {default: 'Ctrl+Alt+J'}, description: 'Go'}}), 'Allowed');
    const notAllowed = manifestExtension(ID2, manifest({go: {suggested_key: {default: 'Ctrl+Alt+K'}, description: 'Go'}}), 'Not allowed');
    const ordinary = host({packages: ['commands'], extensions: [allowed, notAllowed]});
    const privateOne = host({packages: ['commands'], extensions: [allowed], storeKey: 'private-tab-1', sourceProfileId: 'profile-1', tabs: {9: {id: 9, url: 'https://p.test/', active: true}}});   // only the allowed one is loaded there
    const page = {id: 9, session: privateOne.session, isDestroyed: () => false};
    const press = (extensionId, profileId = 'profile-1', contents = page) => glue.runCommand({action: 'extension-command', profileId, extensionId, command: 'go'}, {webContents: contents, privateMode: true});
    assert.equal(press(ID), true);
    assert.equal(press(ID2), false, 'the extension that is not allowed in private tabs is not in the private session');
    assert.equal(press(ID, 'profile-2'), false, 'a key of another profile');
    assert.equal(press(ID, 'profile-1', {id: 12, session: {extensions: {}}, isDestroyed: () => false}), false, 'a private (or Tor, or secured) page whose session has no extensions');
    assert.equal(press(ID, 'profile-1', null), false, 'an Acira page has no page of its own');
    assert.equal(press(ID, 'profile-1', {id: 9, session: privateOne.session, isDestroyed: () => true}), false, 'a page that is gone');
    assert.equal(glue.runCommand({action: 'extension-command', profileId: 'private-tab-1', extensionId: ID, command: 'go'}, {webContents: page, privateMode: true}), false, 'only the profile\'s own key reaches a private session');
    assert.equal(privateOne.sent.length, 1, 'one command reached the private session in all');
    assert.equal(ordinary.sent.length, 0);
    privateOne.dispose(); ordinary.dispose();
  });
});
