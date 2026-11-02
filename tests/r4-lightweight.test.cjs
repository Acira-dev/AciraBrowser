'use strict';
// R4-37 (lighter than Chrome without giving up protection): unit guards for the Round 4 performance changes.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {createFarbling, inject} = require('../desktop/browser-services/fingerprint-farbling.cjs');

// A minimal page realm: the classes the farbling script patches, with fixed "real" values.
const REALM = `var Navigator = class { get hardwareConcurrency() { return 16; } get deviceMemory() { return 8; } }
var navigator = new Navigator();
var Document = class { createElement() { return {}; } }
var document = new Document();
var HTMLCanvasElement = class { toDataURL() { return 'real'; } toBlob() {} getContext() { return null; } }
var CanvasRenderingContext2D = class { getImageData() { return {width: 0, height: 0, data: new Uint8ClampedArray(0)}; } }
var window = globalThis;
var location = {href: 'about:blank'};`;
const realm = extra => { const context = vm.createContext({}); vm.runInContext(REALM + (extra || ''), context); return context; };

test('farbling reaches a same-process child frame the moment its parent touches it', () => {
  const child = realm();
  const parent = realm(`var HTMLIFrameElement = class { get contentWindow() { return globalThis.childWindow; } get contentDocument() { return globalThis.childWindow.document; } }`);
  parent.childWindow = vm.runInContext('globalThis', child);
  const cfg = {token: '00'.repeat(32), fudge: 0.995, hardware: 0.25, memory: 0.1, strict: false};
  vm.runInContext(`(${inject.toString()})(${JSON.stringify(cfg)});`, parent);
  assert.equal(vm.runInContext('navigator.hardwareConcurrency', parent), 6, 'the top frame reads the farbled value (2 + round(14 * 0.25))');
  assert.equal(vm.runInContext('navigator.hardwareConcurrency', child), 16, 'an untouched child is still the real realm');
  assert.equal(vm.runInContext('new HTMLIFrameElement().contentWindow.navigator.hardwareConcurrency', parent), 6, 'reaching the child through contentWindow protects it first');
  assert.equal(vm.runInContext('navigator.hardwareConcurrency', child), 6, "the child's own scripts now read the farbled value too");
  const getter = () => vm.runInContext(`Object.getOwnPropertyDescriptor(Navigator.prototype, 'hardwareConcurrency').get`, child);
  const first = getter(); vm.runInContext('new HTMLIFrameElement().contentWindow; new HTMLIFrameElement().contentDocument;', parent);
  assert.equal(getter(), first, 'a child is patched once, however often it is reached');
  assert.match(vm.runInContext(`Function.prototype.toString.call(Object.getOwnPropertyDescriptor(Navigator.prototype, 'hardwareConcurrency').get)`, child), /return 16/, 'a patched getter prints as the original it replaced (native code in a real page)');
});

test('a child frame with its own page is left to its own preload (never patched twice from the parent)', () => {
  const child = realm(); vm.runInContext(`location.href = 'https://ads.example.net/frame';`, child);
  const parent = realm(`var HTMLIFrameElement = class { get contentWindow() { return globalThis.childWindow; } get contentDocument() { return globalThis.childWindow.document; } }`);
  parent.childWindow = vm.runInContext('globalThis', child);
  const cfg = {token: '00'.repeat(32), fudge: 0.995, hardware: 0.25, memory: 0.1, strict: false};
  vm.runInContext(`(${inject.toString()})(${JSON.stringify(cfg)});`, child); // the child's own preload, before its scripts
  vm.runInContext(`(${inject.toString()})(${JSON.stringify(cfg)});`, parent);
  assert.equal(vm.runInContext('navigator.hardwareConcurrency', child), 6, "the child's preload protects it");
  vm.runInContext('new HTMLIFrameElement().contentWindow', parent);
  assert.equal(vm.runInContext('navigator.hardwareConcurrency', child), 6, 'reaching it from the parent does not farble the farbled value again');
  for (const file of ['farbling-preload.cjs', 'chrome-identity-preload.cjs', 'passkey-guard-preload.cjs']) assert.match(require('node:fs').readFileSync(require('node:path').join(__dirname, '../desktop/browser-services', file), 'utf8'), /about:srcdoc/, `${file} also serves srcdoc frames`);
  for (const file of ['content-filter-preload.cjs', 'scriptlet-preload.cjs', 'js-dialog-preload.cjs', 'permission-state-preload.cjs', 'protected-media-preload.cjs'])
    assert.match(require('node:fs').readFileSync(require('node:path').join(__dirname, '../desktop/browser-services', file), 'utf8'), /process\.isMainFrame/, `${file} returns at once in iframes`);
  assert.equal((require('node:fs').readFileSync(require('node:path').join(__dirname, '../desktop/main.cjs'), 'utf8').match(/nodeIntegrationInSubFrames:true/g) || []).length, 3, 'tabs, pop-ups and Peek load preloads in iframes');
});

test('one cosmetic path per page: the content filter feeds the ad engine; Ghostery\'s own preload is not registered', () => {
  const fs = require('node:fs'), path = require('node:path');
  const blocking = fs.readFileSync(path.join(__dirname, '../desktop/content-blocking.cjs'), 'utf8');
  assert.doesNotMatch(blocking, /registerPreloadScript\(\{type:'frame',filePath:require\.resolve\('@ghostery\/adblocker-electron-preload'\)\}\)/, 'no second observer over every page');
  assert.match(blocking, /ipcMain\.handle\('@ghostery\/adblocker\/inject-cosmetic-filters'/, 'the ad engine still answers cosmetic requests');
  const preload = fs.readFileSync(path.join(__dirname, '../desktop/browser-services/content-filter-preload.cjs'), 'utf8');
  assert.match(preload, /invoke\('@ghostery\/adblocker\/inject-cosmetic-filters',location\.href\)/, 'host rules at page start');
  assert.match(preload, /invoke\('@ghostery\/adblocker\/inject-cosmetic-filters',location\.href,ad\)/, 'class, id and link names from the same DOM pass');
  assert.match(preload, /adCosmetics=on===true/, 'only a real yes turns the ad names on (the injected iframe copy answers with an options object)');
  // The iframe copy (optional-filtering.cjs injectFrame) must still parse and must not reach for the preload-only `process`.
  const runtime = preload.replace("const {ipcRenderer}=require('electron');", '').replace('if(process.isMainFrame&&', 'if(');
  assert.doesNotThrow(() => new Function('ipcRenderer', runtime)); assert.doesNotMatch(runtime, /\bprocess\./);
});

test('farbling script only names page classes through the window it protects', () => {
  const source = inject.toString();
  for (const name of ['document', 'HTMLCanvasElement', 'CanvasRenderingContext2D', 'AudioBuffer', 'AnalyserNode', 'Navigator', 'NavigatorUAData', 'Document', 'Float32Array'])
    assert.doesNotMatch(source, new RegExp(`(?<![.\\w$])${name}\\b(?!\\s*:)`), `${name} must be read as w.${name} so child frames get their own realm's classes`);
  const script = createFarbling({sessionKey: Buffer.alloc(32, 1)}).scriptFor('https://example.com/', 'https://example.com/');
  assert.doesNotThrow(() => new vm.Script(script), 'the per-frame script still parses');
  assert.match(script, /contentWindow/, 'child-frame coverage is part of the shipped script');
});

test('threat lists kept as packed hashes answer exactly like the Set/Map form', async () => {
  const {parseThreatList, validateAsync, listMatches, matchEntry, SOURCES} = require('../desktop/browser-services/threat-lists.cjs');
  const lines = ['evil.example.top', '203.0.113.7', '203.0.113.8:8080', '||url.example.net/phish^$all', '||q.example.net/a?id=7^$all', '||dir.example.net/kit/^$all', '[::ffff:b2a2:ecde]', '||two.example.net/a^$all', '||two.example.net/a/b^$all'];
  const text = `! Title: ${SOURCES[0].title}\n${Array.from({length: 600}, (_, i) => `filler-${i}.example.test`).join('\n')}\n${lines.join('\n')}\n`;
  const plain = parseThreatList(text), packed = await validateAsync(text, SOURCES[0]);
  assert.equal(packed.packed, true, 'the app form is packed'); assert.equal(packed.entries, plain.entries);
  assert.ok(packed.hosts instanceof Float64Array && packed.paths instanceof Float64Array, 'hashes, not strings');
  const urls = ['https://evil.example.top/', 'http://evil.example.top/any/path?x=1', 'https://a.b.evil.example.top/', 'http://203.0.113.7/x', 'http://203.0.113.8:8080/y', 'https://url.example.net/phish', 'https://url.example.net/phish/login', 'https://url.example.net/phish?x=1',
    'https://q.example.net/a?id=7', 'https://q.example.net/a?id=7&b=2', 'https://dir.example.net/kit/index.php', 'http://[::ffff:b2a2:ecde]/', 'https://two.example.net/a/b/c', 'https://filler-7.example.test/x',
    'https://top/', 'https://example.top/', 'https://notevil.example.top/', 'http://203.0.113.70/x', 'http://203.0.113.8:9090/y', 'http://203.0.113.8/y', 'https://url.example.net/phishing', 'https://url.example.net/phish2', 'https://url.example.net/phish.html',
    'https://url.example.net/', 'https://q.example.net/a?id=8', 'https://dir.example.net/kit', 'https://evil.example.top.example.com/', 'https://two.example.net/ab'];
  for (const address of urls) assert.equal(listMatches(packed, new URL(address)), listMatches(plain, new URL(address)), address);
  assert.equal(matchEntry(packed, new URL('https://url.example.net/phish/login')), 'url.example.net/phish', 'the remembered key is host + listed prefix');
});

test('the main process builds only the catalog it uses (English fallback + the active language)', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '../src/i18n/main.ts'), 'utf8');
  const imported = [...source.matchAll(/^import\s+\w+\s+from\s+'\.\/([\w-]+)\.json'/gm)].map(match => match[1]);
  assert.deepEqual(imported, ['en'], 'only English is imported eagerly; the other twelve load on first use');
  for (const code of ['es', 'fr', 'de', 'pt-BR', 'it', 'ja', 'zh-CN', 'ar', 'tr', 'ru', 'ko', 'hi']) assert.match(source, new RegExp(`require\\('\\./${code}\\.json'\\)`), `${code} stays in the bundle behind a lazy require`);
  assert.doesNotMatch(source, /import\.meta/, 'the release bundle builds without the empty-import-meta warning');
});
