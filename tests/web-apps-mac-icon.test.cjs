'use strict';
// 13.5: on the Mac, "Install site as app" closed the whole browser when the site had no usable icon. The fallback asked Electron for
// app.getFileIcon(..., {size:'large'}), which macOS does not support: the native process aborts (SIGTRAP; a bare Electron 44 probe exits 133 on
// 'large' and answers 'small' and 'normal'). These tests run the real install path with electron and process.platform stood in for, and record
// every size asked for: the Mac must never ask for 'large', Windows and Linux keep it, and a failing fallback installs the app without an icon.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), Module = require('node:module');

const asked = [];
let fileIcon = () => Promise.resolve({ isEmpty: () => true });
const fakeElectron = {
  app: { getPath: () => os.tmpdir(), isPackaged: false, getFileIcon(file, options) { asked.push(options && options.size); return fileIcon(file, options); } },
  nativeImage: { createFromBuffer: () => ({ isEmpty: () => true }), createFromPath: () => ({ isEmpty: () => true }) },
  shell: { writeShortcutLink: () => false },
};
const load = Module._load;
Module._load = function (request, ...rest) { return request === 'electron' ? fakeElectron : load.call(this, request, ...rest); };
let createWebApps; try { ({ createWebApps } = require('../desktop/web-apps.cjs')); } finally { Module._load = load; }

const as = async (platform, run) => { const real = Object.getOwnPropertyDescriptor(process, 'platform'); Object.defineProperty(process, 'platform', { value: platform }); try { return await run(); } finally { Object.defineProperty(process, 'platform', real); } };
// A page with no manifest and no icon links; every fetch fails (as an icon fetch does when it passes the time limit).
const page = (url = 'http://127.0.0.1:9/plain') => ({
  isDestroyed: () => false, getURL: () => url, getTitle: () => 'Plain page',
  executeJavaScriptInIsolatedWorld: async () => ({ manifest: '', credentials: false, title: 'Plain page', url, theme: '', icons: [] }),
  session: { fetch: async () => { throw new Error('timed out'); } },
});
const withDir = async run => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-webapp-icon-')); try { return await run(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); } };

test('Mac: installing a site with no usable icon never asks Electron for the unsupported "large" icon', () => withDir(async dir => {
  asked.length = 0; fileIcon = () => Promise.resolve({ isEmpty: () => true });
  const installed = await as('darwin', () => createWebApps({ dataDir: dir, testMode: true }).install(page(), { profileId: 'profile-personal', privateMode: false }));
  assert.ok(installed && installed.name === 'Plain page', 'the app is installed');
  assert.ok(asked.length > 0, 'the fallback icon is still asked for');
  assert.ok(!asked.includes('large'), 'asked for ' + JSON.stringify(asked) + ': "large" aborts the browser on macOS');
  assert.deepEqual(asked, ['normal']);
}));

test('Windows and Linux keep the "large" fallback icon, where it is supported', async () => {
  for (const platform of ['win32', 'linux']) await withDir(async dir => {
    asked.length = 0; fileIcon = () => Promise.resolve({ isEmpty: () => true });
    await as(platform, () => createWebApps({ dataDir: dir, testMode: true }).install(page(), { profileId: 'profile-personal', privateMode: false }));
    assert.deepEqual(asked, ['large'], platform);
  });
});

test('a fallback that throws or rejects installs the app without an icon; it never fails the install', async () => {
  for (const failing of [() => { throw new Error('native refused'); }, () => Promise.reject(new Error('no icon'))]) await withDir(async dir => {
    asked.length = 0; fileIcon = failing;
    const apps = createWebApps({ dataDir: dir, testMode: true });
    const installed = await as('darwin', () => apps.install(page(), { profileId: 'profile-personal', privateMode: false }));
    assert.equal(installed.name, 'Plain page');
    assert.equal(apps.list().length, 1, 'the app is recorded');
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'web-apps.json'), 'utf8')).apps[0].iconPng, '', 'no icon file');
  });
});
