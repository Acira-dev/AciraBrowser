'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { noticed, siteOf } = require('../desktop/browser-services/protected-media.cjs');
const preloadSource = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'browser-services', 'protected-media-preload.cjs'), 'utf8');

/** Runs the real preload against a fake frame, then the script it injects against a fake page world. */
function frame({ url = 'https://video.example/watch', keySystems = () => Promise.reject(new DOMException('Unsupported keySystem', 'NotSupportedError')), withApi = true } = {}) {
  const sent = [], scripts = [], listeners = new Map();
  const window = { addEventListener: (name, fn, options) => listeners.set(name, options?.once ? (event) => { listeners.delete(name); fn(event); } : fn), dispatchEvent: (event) => { listeners.get(event.type)?.(event); return true; } };
  class Event { constructor(type) { this.type = type; } }
  const electron = { ipcRenderer: { send: (...args) => sent.push(args) }, webFrame: { executeJavaScript: (script) => { scripts.push(script); return Promise.resolve(); } } };
  vm.runInNewContext(preloadSource, { require: (name) => (name === 'electron' ? electron : require(name)), process: { isMainFrame: true }, location: { href: url }, window, crypto: { getRandomValues: (bytes) => bytes.fill(7) }, Uint8Array, Array, JSON });
  const calls = [];
  class Navigator {}
  if (withApi) Object.defineProperty(Navigator.prototype, 'requestMediaKeySystemAccess', { configurable: true, enumerable: true, writable: true, value: function requestMediaKeySystemAccess(keySystem, configs) { calls.push({ self: this, keySystem, configs }); return keySystems(keySystem, configs); } });
  const page = { Navigator, window, Event, Proxy, Reflect, Object, String, JSON, Promise };
  for (const script of scripts) vm.runInNewContext(script, page);
  return { sent, scripts, navigator: new Navigator(), calls, Navigator, listeners };
}
const settle = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

test('a refused Widevine request is reported once, with no data from the page', async () => {
  const f = frame();
  await assert.rejects(f.navigator.requestMediaKeySystemAccess('com.widevine.alpha', [{ videoCapabilities: [] }]), /Unsupported/);
  await settle();
  assert.deepEqual(f.sent, [['acira:protected-media']]);
  await assert.rejects(f.navigator.requestMediaKeySystemAccess('com.widevine.alpha.experiment', []));
  await settle();
  assert.equal(f.sent.length, 1, 'once per frame however often the player asks');
});

test('nothing is reported when the request works or asks for another key system', async () => {
  const works = frame({ keySystems: () => Promise.resolve({ keySystem: 'com.widevine.alpha' }) });
  await works.navigator.requestMediaKeySystemAccess('com.widevine.alpha', []);
  await settle();
  assert.equal(works.sent.length, 0);
  const other = frame();
  await assert.rejects(other.navigator.requestMediaKeySystemAccess('com.microsoft.playready', []));
  await assert.rejects(other.navigator.requestMediaKeySystemAccess('org.w3.clearkey', []));
  await settle();
  assert.equal(other.sent.length, 0);
});

test('the page sees the same call: same promise, arguments, this, errors and function shape', async () => {
  const promise = Promise.resolve('granted');
  const f = frame({ keySystems: () => promise });
  const configs = [{ initDataTypes: ['cenc'] }];
  const result = f.navigator.requestMediaKeySystemAccess('com.widevine.alpha', configs);
  assert.equal(result, promise, 'the very promise the engine returned');
  assert.equal(f.calls[0].self, f.navigator);
  assert.equal(f.calls[0].configs, configs);
  assert.equal(f.Navigator.prototype.requestMediaKeySystemAccess.name, 'requestMediaKeySystemAccess');
  assert.equal(f.Navigator.prototype.requestMediaKeySystemAccess.length, 2);
  const throwing = frame({ keySystems: () => { throw new TypeError('bad config'); } });
  assert.throws(() => throwing.navigator.requestMediaKeySystemAccess('com.widevine.alpha', []), /bad config/, 'a synchronous error still reaches the page');
  const odd = frame({ keySystems: () => 42 });
  assert.equal(odd.navigator.requestMediaKeySystemAccess('com.widevine.alpha', []), 42, 'a result that is not a promise is left alone');
  const descriptor = Object.getOwnPropertyDescriptor(f.Navigator.prototype, 'requestMediaKeySystemAccess');
  assert.deepEqual([descriptor.configurable, descriptor.enumerable, descriptor.writable], [true, true, true]);
});

test('it stays out of the way: other schemes, insecure pages without the API, and a closing window', async () => {
  for (const url of ['about:blank', 'file:///c:/page.html', 'acira-browser-ui://ui/index.html', 'chrome-error://chromewebdata/']) assert.equal(frame({ url }).scripts.length, 0, url);
  const bare = frame({ withApi: false });
  assert.equal(bare.scripts.length, 1);
  assert.doesNotThrow(() => vm.runInNewContext(bare.scripts[0], { Navigator: class {}, window: {}, Proxy, Reflect, Object, String }));
  const closing = frame();
  closing.listeners.forEach((fn) => fn({}));
  assert.doesNotThrow(() => closing.listeners.forEach((fn) => fn({})));
});

test('the main side names the site the person sees and tells the interface once in a while', () => {
  assert.equal(siteOf('https://www.Netflix.com/watch/1'), 'netflix.com');
  assert.equal(siteOf('http://127.0.0.1:5173/'), '127.0.0.1');
  for (const url of ['file:///c:/a.html', 'acira://settings', 'about:blank', 'not a url', '']) assert.equal(siteOf(url), null, url);
  const events = [], emit = (event) => events.push(event);
  const contents = { getURL: () => 'https://www.disneyplus.com/video/1', isDestroyed: () => false };
  assert.equal(noticed(contents, 'tab-1', emit, 100000), true);
  assert.deepEqual(events, [{ type: 'protected-media', tabId: 'tab-1', host: 'disneyplus.com' }]);
  assert.equal(noticed(contents, 'tab-1', emit, 101000), false, 'not again within five seconds');
  assert.equal(noticed(contents, 'tab-2', emit, 101000), true, 'another tab is its own');
  assert.equal(noticed(contents, 'tab-1', emit, 120000), true);
  assert.equal(noticed({ getURL: () => 'file:///x', isDestroyed: () => false }, 'tab-3', emit, 1), false);
  assert.equal(noticed({ getURL: () => 'https://a.example/', isDestroyed: () => true }, 'tab-3', emit, 1), false);
  assert.equal(noticed(contents, '', emit, 500000), false);
});
