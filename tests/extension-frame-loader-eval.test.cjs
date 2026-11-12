'use strict';
// Chromium's own offscreen documents (an AI assistant's, Bitwarden's, ...) run Acira's frame preload in the page's own world, under the extension's default page CSP
// (script-src 'self', no unsafe-eval). The loader (extension-runtime-patch.cjs frameLoader) built the preload with new Function(...), which that CSP refuses:
// Electron logged "Unable to load preload script ... EvalError" in the page's console on every offscreen document. Nothing was lost there (a Chrome
// offscreen document only has chrome.runtime, which is Chromium's own), so the loader now ends quietly when the page refuses eval. Any other error
// still surfaces, and a loader file left on disk by an older version is replaced (its name carries only the preload's hash).
const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {frameLoader, installPatchedPreload} = require('../desktop/browser-services/extension-runtime-patch.cjs');

const OFFSCREEN = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/offscreen.html';
function run(source, {eval: allowed, href = OFFSCREEN, preload = 'globalThis.loaded = true;'}) {
  const logs = [], sandbox = {location: {href}, process: {}, console: {error: (...a) => logs.push(a.join(' '))}, require: () => ({ipcRenderer: {sendSync: () => preload}})};
  const context = vm.createContext(sandbox, {codeGeneration: {strings: allowed, wasm: false}});
  let thrown = null; try { vm.runInContext(source, context); } catch (error) { thrown = error; }
  return {thrown, logs, loaded: context.loaded === true};
}

test('control: where eval is allowed (a popup, the side panel) the loader runs the preload', () => {
  const r = run(frameLoader('0123456789ab'), {eval: true});
  assert.equal(r.thrown, null); assert.equal(r.loaded, true);
});

test('where the page refuses eval (Chromium\'s offscreen document) the loader ends quietly: no error for Electron to log', () => {
  const r = run(frameLoader('0123456789ab'), {eval: false});
  assert.equal(r.thrown, null, 'the loader must not throw: ' + (r.thrown && r.thrown.message));
  assert.equal(r.loaded, false);
  assert.deepEqual(r.logs, []);
});

test('an error inside the preload itself still surfaces, an EvalError there too', () => {
  const bug = run(frameLoader('0123456789ab'), {eval: true, preload: 'throw new TypeError("real bug");'});
  assert.ok(bug.thrown && /real bug/.test(bug.thrown.message), 'an ordinary error is not swallowed');
  const inner = run(frameLoader('0123456789ab'), {eval: true, preload: 'throw new EvalError("inside the preload");'});
  assert.ok(inner.thrown && /inside the preload/.test(inner.thrown.message), 'only the refusal to compile is swallowed');
});

test('web pages still stop at the first check, and the loader stays tiny', () => {
  const source = frameLoader('0123456789ab');
  assert.ok(Buffer.byteLength(source) < 1024);
  const r = run(source, {eval: false, href: 'https://example.com/'});
  assert.equal(r.thrown, null); assert.equal(r.loaded, false);
});

test('a profile that already has an older loader file for the same preload hash gets the new one at the next start', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-loader-'));
  const electronPath = require.resolve('electron'), before = require.cache[electronPath];
  try {
    require.cache[electronPath] = {id: electronPath, filename: electronPath, loaded: true, exports: {ipcMain: {on() {}}}};
    const session = {getPreloadScripts: () => [], registerPreloadScript() {}, unregisterPreloadScript() {}};
    installPatchedPreload(session, fixture, {});
    const dir = path.join(fixture, 'extension-runtime'), name = fs.readdirSync(dir).find(f => f.endsWith('.frame.js'));
    assert.ok(name, 'a loader file was written');
    const hash = name.match(/\.([0-9a-f]{12})\.frame\.js$/)[1];
    assert.equal(fs.readFileSync(path.join(dir, name), 'utf8'), frameLoader(hash));
    fs.writeFileSync(path.join(dir, name), '// an older loader');
    installPatchedPreload(session, fixture, {});
    assert.equal(fs.readFileSync(path.join(dir, name), 'utf8'), frameLoader(hash), 'the older loader file was replaced');
    const stamp = fs.statSync(path.join(dir, name)).mtimeMs;
    installPatchedPreload(session, fixture, {});
    assert.equal(fs.statSync(path.join(dir, name)).mtimeMs, stamp, 'an unchanged loader is not written again');
  } finally {
    if (before) require.cache[electronPath] = before; else delete require.cache[electronPath];
    fs.rmSync(fixture, {recursive: true, force: true});
  }
});
