'use strict';
// Windows: installing a second web app with the same name (two accounts of one site, generic page titles such as "Dashboard") wrote over the first app's Start menu and desktop
// shortcut: the test that picks "Name (Acira).lnk" was the wrong way round (it suffixed only when no other app owned the file). Run here on any computer: process.platform and
// electron's shell are stood in for.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), Module = require('node:module');

const links = [];
const fakeElectron = { app: { getPath: () => os.tmpdir(), isPackaged: true }, nativeImage: {}, shell: { writeShortcutLink(target, operation, options) { fs.writeFileSync(target, JSON.stringify({ operation, args: options.args, id: options.appUserModelId })); links.push(target); return true; } } };
const load = Module._load;
Module._load = function (request, ...rest) { return request === 'electron' ? fakeElectron : load.call(this, request, ...rest); };
let createWebApps; try { ({ createWebApps } = require('../desktop/web-apps.cjs')); } finally { Module._load = load; }

const asWindows = run => { const real = Object.getOwnPropertyDescriptor(process, 'platform'); Object.defineProperty(process, 'platform', { value: 'win32' }); try { return run(); } finally { Object.defineProperty(process, 'platform', real); } };
const app = (id, name) => ({ id, name, startUrl: 'https://' + id + '.example/', iconIco: '' });

test('two web apps with one name each keep their own shortcut; the second gets "(Acira)", the third "(Acira 2)"', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-webapps-names-'));
  try {
    const apps = createWebApps({ dataDir: dir, testMode: true });
    const [a, b, c] = asWindows(() => ['a1', 'b2', 'c3'].map(id => apps.writeShortcuts(app(id.repeat(10).slice(0, 20), 'Mail'))));
    const folder = path.join(dir, 'web-app-shortcuts');
    assert.deepEqual(fs.readdirSync(folder).sort(), ['Mail (Acira 2).lnk', 'Mail (Acira).lnk', 'Mail.lnk']);
    assert.deepEqual([a, b, c].map(list => list.map(file => path.basename(file))), [['Mail.lnk'], ['Mail (Acira).lnk'], ['Mail (Acira 2).lnk']], 'each app records its own file');
    assert.match(fs.readFileSync(path.join(folder, 'Mail.lnk'), 'utf8'), /a1a1a1a1a1a1a1a1a1a1/, 'the first app\'s shortcut still launches the first app');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a shortcut of the person\'s own with that name is never written over, and a different name is not suffixed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-webapps-names-'));
  try {
    const folder = path.join(dir, 'web-app-shortcuts'); fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, 'Notes.lnk'), 'mine');
    const apps = createWebApps({ dataDir: dir, testMode: true });
    const [notes] = asWindows(() => [apps.writeShortcuts(app('n'.repeat(20), 'Notes')), apps.writeShortcuts(app('d'.repeat(20), 'Docs'))]);
    assert.equal(fs.readFileSync(path.join(folder, 'Notes.lnk'), 'utf8'), 'mine');
    assert.deepEqual(notes.map(file => path.basename(file)), ['Notes (Acira).lnk']);
    assert.ok(fs.existsSync(path.join(folder, 'Docs.lnk')));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('an app named like a Windows device (Aux, Con, Nul) still gets a shortcut file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-webapps-names-'));
  try {
    const apps = createWebApps({ dataDir: dir, testMode: true });
    const [aux] = asWindows(() => [apps.writeShortcuts(app('x'.repeat(20), 'Aux'))]);
    assert.deepEqual(aux.map(file => path.basename(file)), ['_Aux.lnk']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
