'use strict';
// chrome.proxy (ext-api/proxy*.cjs): ChromeSetting rules over the shared settings store, the Chrome <-> Electron proxy conversion, the way
// the proxy is handed to proxy-settings.cjs, onChange / onProxyError, and the promise that a Tor session is never touched.
const test = require('node:test');
const assert = require('node:assert/strict');
const convert = require('../desktop/browser-services/ext-api/proxy/convert.cjs');
const chromeSettings = require('../desktop/browser-services/extension-chrome-settings.cjs');
const extApi = require('../desktop/browser-services/ext-api/index.cjs');
const {createProxySettings} = require('../desktop/browser-services/proxy-settings.cjs');
const {extensionWorld, plain} = require('./fixtures/ext-api/world.cjs');
const {world, fakeSession, manifest, A, B} = require('./fixtures/ext-api-proxy/harness.cjs');

const vpn = {name: 'Fast VPN', manifest: manifest(['proxy'])};
const server = {scheme: 'https', host: 'proxy.example.net', port: 443};
const tick = () => new Promise(resolve => setImmediate(resolve));

test('conversion: every Chromium mode becomes an Electron proxy config', () => {
  assert.deepEqual(convert.toElectron({mode: 'direct'}), {mode: 'direct'});
  assert.deepEqual(convert.toElectron({mode: 'system'}), {mode: 'system'});
  assert.deepEqual(convert.toElectron({mode: 'auto_detect'}), {mode: 'auto_detect'});
  assert.deepEqual(convert.toElectron({mode: 'fixed_servers', rules: {singleProxy: {host: 'p.example', port: 8080}, bypassList: ['<local>', '*.corp.example', '10.0.0.0/8']}}),
    {mode: 'fixed_servers', proxyRules: 'http://p.example:8080', proxyBypassRules: '<local>,*.corp.example,10.0.0.0/8'});
  assert.deepEqual(convert.toElectron({mode: 'fixed_servers', rules: {proxyForHttp: {host: 'a.example', port: 80}, proxyForHttps: {scheme: 'socks5', host: 'b.example', port: 1080}, fallbackProxy: {scheme: 'socks4', host: 'c.example'}}}),
    {mode: 'fixed_servers', proxyRules: 'http=http://a.example:80;https=socks5://b.example:1080;socks=socks4://c.example', proxyBypassRules: ''});
  assert.deepEqual(convert.toElectron({mode: 'pac_script', pacScript: {url: 'https://pac.example/p.pac'}}), {mode: 'pac_script', pacScript: 'https://pac.example/p.pac'});
  const data = 'function FindProxyForURL(){return "DIRECT";}';
  const electron = convert.toElectron({mode: 'pac_script', pacScript: {data}});
  assert.equal(Buffer.from(electron.pacScript.split(',')[1], 'base64').toString(), data);
  assert.match(electron.pacScript, /^data:application\/x-ns-proxy-autoconfig;base64,/);
});

test('conversion: invalid configurations are refused with a message the extension can read', () => {
  const bad = [
    [{}, /'mode' must be one of/],
    [{mode: 'tor'}, /'mode' must be one of/],
    [{mode: 'fixed_servers'}, /needs 'rules'/],
    [{mode: 'fixed_servers', rules: {}}, /needs a proxy server/],
    [{mode: 'fixed_servers', rules: {singleProxy: {host: 'a'}, proxyForHttp: {host: 'b'}}}, /cannot be combined/],
    [{mode: 'fixed_servers', rules: {singleProxy: {host: 'a b'}}}, /host name or IP/],
    [{mode: 'fixed_servers', rules: {singleProxy: {host: 'a;http=evil'}}}, /host name or IP/],
    [{mode: 'fixed_servers', rules: {singleProxy: {host: 'a', port: 70000}}}, /port/],
    [{mode: 'fixed_servers', rules: {singleProxy: {host: 'a', scheme: 'ftp'}}}, /scheme/],
    [{mode: 'fixed_servers', rules: {singleProxy: {host: 'a'}, bypassList: ['a,b']}}, /bypassList/],
    [{mode: 'pac_script'}, /needs 'pacScript'/],
    [{mode: 'pac_script', pacScript: {}}, /exactly one/],
    [{mode: 'pac_script', pacScript: {url: 'ftp://x/y.pac'}}, /http, https, file or data/],
    [{mode: 'direct', rules: {singleProxy: {host: 'a'}}}, /takes no 'rules'/],
    [{mode: 'fixed_servers', rules: {singleProxy: {host: 'a'}}, bogus: 1}, /unknown property 'bogus'/]
  ];
  for (const [config, message] of bad) assert.throws(() => convert.validate(config), message, JSON.stringify(config));
  assert.match(convert.pacSyntaxError({pacScript: {data: 'function ('}}), /./);
  assert.equal(convert.pacSyntaxError({pacScript: {data: 'function FindProxyForURL(){return "DIRECT";}'}}), null);
});

test('settings store: the last installed extension wins, levelOfControl names who holds it, a disabled one does not count', () => {
  const store = chromeSettings.createStore({now: (() => { let n = 1000; return () => n++; })()});
  const active = new Set([A, B]);
  store.setResolver({active: id => active.has(id), name: id => `Name ${id[0]}`});
  assert.equal(store.levelOfControl('proxy', A), 'controllable_by_this_extension');
  store.setValue('proxy', A, {mode: 'direct'});
  assert.equal(store.levelOfControl('proxy', A), 'controlled_by_this_extension');
  store.setValue('proxy', B, {mode: 'system'});
  assert.deepEqual([store.winner('proxy').extensionId, store.winner('proxy').name], [B, 'Name b']);
  assert.equal(store.levelOfControl('proxy', A), 'controlled_by_other_extensions', 'B was installed later');
  assert.equal(store.levelOfControl('proxy', B), 'controlled_by_this_extension');
  active.delete(B);
  assert.equal(store.winner('proxy').extensionId, A, 'a disabled extension keeps its value but does not count');
  assert.equal(store.levelOfControl('proxy', B), 'controllable_by_this_extension', 'B is the later one: it could take control again');
  active.add(B);
  assert.equal(store.levelOfControl('proxy', 'c'.repeat(32), {fixed: true}), 'not_controllable');
  store.setValue('proxy', B, {mode: 'pac_script'}, 'regular_only');
  assert.deepEqual(store.winner('proxy').value, {mode: 'pac_script'}, 'regular_only beats regular of the same extension');
  assert.equal(store.clearValue('proxy', B, 'regular_only'), true);
  assert.deepEqual(store.winner('proxy').value, {mode: 'system'});
  assert.deepEqual(store.forget(B), ['proxy']);
  assert.equal(store.winner('proxy').extensionId, A);
  assert.throws(() => store.setValue('proxy', A, {}, 'incognito_persistent'), /Invalid scope/);
});

test('settings store: values survive a restart; the first start counts every saved extension until the real ones are known', async () => {
  const w = world({extensions: {[A]: vpn}});
  try {
    await w.call(A, 'proxy.settings.set', {value: {mode: 'direct'}});
    assert.ok(w.store().file, 'saved under userData');
    const again = chromeSettings.createStore({userData: w.userData, storeKey: w.storeKey});
    assert.deepEqual(again.winner('proxy'), {extensionId: A, name: 'Fast VPN', value: {mode: 'direct'}});
    assert.deepEqual(chromeSettings.proxyOverride(w.storeKey, w.session).native, {mode: 'direct'}, 'proxy-settings.cjs can ask before the extension has loaded');
    const quick = chromeSettings.createStore({userData: w.userData, storeKey: w.storeKey});
    quick.setResolver({active: () => false});
    assert.equal(quick.winner('proxy'), null, 'with the real list, an extension that is not running does not count');
  } finally { w.dispose(); }
});

test('proxy.settings.set / get / clear: the extension is told who controls the proxy, and Acira applies it', async () => {
  const w = world({extensions: {[A]: vpn}});
  try {
    let answer = await w.call(A, 'proxy.settings.get', {});
    assert.deepEqual(answer, {value: {mode: 'system'}, levelOfControl: 'controllable_by_this_extension'});
    await w.call(A, 'proxy.settings.set', {value: {mode: 'fixed_servers', rules: {singleProxy: server, bypassList: ['<local>']}}});
    assert.deepEqual(w.session.calls.filter(c => c[0] === 'setProxy').pop()[1], {mode: 'fixed_servers', proxyRules: 'https://proxy.example.net:443', proxyBypassRules: '<local>'});
    assert.ok(w.session.calls.some(c => c[0] === 'closeAllConnections'), 'connections made before the change are closed');
    answer = await w.call(A, 'proxy.settings.get', {});
    assert.equal(answer.levelOfControl, 'controlled_by_this_extension');
    assert.deepEqual(answer.value.rules.singleProxy, server);
    await w.call(A, 'proxy.settings.clear', {});
    assert.deepEqual(w.session.calls.filter(c => c[0] === 'setProxy').pop()[1], {mode: 'system'}, 'without an extension value the person\'s own choice comes back');
    assert.equal((await w.call(A, 'proxy.settings.get', {})).levelOfControl, 'controllable_by_this_extension');
    await w.call(A, 'proxy.settings.clear', {});   // clearing nothing is fine
  } finally { w.dispose(); }
});

test('two extensions: the later one wins, the earlier hears about it, uninstalling the later one gives control back', async () => {
  const w = world({extensions: {[A]: vpn, [B]: {name: 'Other', manifest: manifest(['proxy'])}}});
  try {
    w.listen(A, 'proxy.settings.onChange');
    await w.call(A, 'proxy.settings.set', {value: {mode: 'direct'}});
    await w.call(B, 'proxy.settings.set', {value: {mode: 'fixed_servers', rules: {singleProxy: {host: 'b.example', port: 3128}}}});
    assert.equal(w.session.calls.filter(c => c[0] === 'setProxy').pop()[1].proxyRules, 'http://b.example:3128');
    assert.deepEqual((await w.call(A, 'proxy.settings.get', {})).levelOfControl, 'controlled_by_other_extensions');
    assert.deepEqual(w.sent.filter(s => s[1] === 'proxy.settings.onChange').map(s => [s[0], s[2].levelOfControl, s[2].value.mode]),
      [[A, 'controlled_by_this_extension', 'direct'], [A, 'controlled_by_other_extensions', 'fixed_servers']], 'A hears its own change and then B taking over');
    w.installed.forget(B);
    await tick();
    assert.deepEqual(w.session.calls.filter(c => c[0] === 'setProxy').pop()[1], {mode: 'direct'}, 'A\'s value is in effect again');
    assert.equal(w.sent.filter(s => s[1] === 'proxy.settings.onChange').pop()[2].levelOfControl, 'controlled_by_this_extension');
  } finally { w.dispose(); }
});

test('disabling or removing the extension that holds the proxy hands the connection back', async () => {
  const w = world({extensions: {[A]: vpn}});
  try {
    await w.call(A, 'proxy.settings.set', {value: {mode: 'direct'}});
    w.session.calls.length = 0;
    w.unload(A);
    await tick();
    assert.deepEqual(w.session.calls.filter(c => c[0] === 'setProxy').pop()[1], {mode: 'system'});
    w.session.calls.length = 0;
    w.load(A, vpn);
    await tick();
    assert.deepEqual(w.session.calls.filter(c => c[0] === 'setProxy').pop()[1], {mode: 'direct'}, 'enabled again: its value counts again');
  } finally { w.dispose(); }
});

test('nothing is re-applied (no setProxy, no closed connections) unless the route really changes', async () => {
  const w = world({extensions: {[A]: vpn, [B]: {name: 'Earlier', manifest: manifest(['proxy'])}}});
  try {
    await w.call(B, 'proxy.settings.set', {value: {mode: 'direct'}});
    await w.call(A, 'proxy.settings.set', {value: {mode: 'auto_detect'}});
    const applied = () => w.session.calls.filter(c => c[0] === 'setProxy').length;
    const n = applied();
    for (let i = 0; i < 26; i++) w.load(String.fromCharCode(100 + (i % 10)).repeat(32), {name: 'other ' + i, manifest: manifest(['storage'])});
    await w.call(B, 'proxy.settings.set', {value: {mode: 'system'}});   // B installed first: A still holds the proxy
    await tick();
    assert.equal(applied(), n, '26 unrelated extensions loading and a losing extension\'s set() touch nothing');
    assert.equal((await w.call(B, 'proxy.settings.get', {})).levelOfControl, 'controlled_by_other_extensions');
  } finally { w.dispose(); }
});

test('an unloaded extension stops counting at once, even if the engine still lists it for a moment (after the start-up grace too)', async () => {
  const {openStore} = require('../desktop/browser-services/ext-api/_settings.cjs');
  const session = fakeSession(), listed = new Set([A]);
  const opened = openStore({storeKey: 'race', userData: require('node:os').tmpdir(), session, getExtension: id => (listed.has(id) ? {id, name: 'Racy'} : null), errors: {}}, {grace: 0});
  try {
    opened.store.setValue('proxy', A, {mode: 'direct'});
    assert.equal(opened.store.winner('proxy').extensionId, A);
    session.extensions.emit('extension-unloaded', {}, {id: A});     // the engine has not dropped it from its list yet
    assert.equal(opened.store.winner('proxy'), null);
    session.extensions.emit('extension-loaded', {}, {id: A, name: 'Racy'});
    assert.equal(opened.store.winner('proxy').extensionId, A, 'loaded again: it counts again');
    listed.delete(A);
    assert.equal(opened.store.winner('proxy'), null, 'no longer listed and the grace is over: it does not count');
  } finally { opened.dispose(); chromeSettings.reset(); }
});

test('a proxy that cannot be applied is rolled back and the call fails', async () => {
  const w = world({extensions: {[A]: vpn}});
  try {
    await w.call(A, 'proxy.settings.set', {value: {mode: 'direct'}});
    w.session.failProxy = true;
    await assert.rejects(w.call(A, 'proxy.settings.set', {value: {mode: 'auto_detect'}}), /bad proxy/);
    w.session.failProxy = false;
    assert.deepEqual((await w.call(A, 'proxy.settings.get', {})).value, {mode: 'direct'}, 'the earlier value is back');
  } finally { w.dispose(); }
});

test('errors: bad values, incognito scopes and calls without the proxy permission', async () => {
  const w = world({extensions: {[A]: vpn, [B]: {name: 'No proxy', manifest: manifest(['storage'])}}});
  try {
    await assert.rejects(w.call(A, 'proxy.settings.set', {value: {mode: 'nope'}}), /'mode' must be one of/);
    await assert.rejects(w.call(A, 'proxy.settings.set', {value: {mode: 'direct'}, scope: 'incognito_persistent'}), /incognito preferences/);
    await assert.rejects(w.call(A, 'proxy.settings.get', {incognito: true}), /incognito preferences/);
    await assert.rejects(w.call(B, 'proxy.settings.get', {}), {message: 'Access to extension API denied.'});
    assert.equal(w.session.calls.length, 0, 'nothing reached the session');
  } finally { w.dispose(); }
});

test('Tor: a Tor session is not controllable and nothing an extension asks reaches it', async () => {
  const tor = fakeSession({tor: true});
  const w = world({extensions: {[A]: vpn}, session: tor});
  try {
    const answer = await w.call(A, 'proxy.settings.get', {});
    assert.equal(answer.levelOfControl, 'not_controllable');
    await w.call(A, 'proxy.settings.set', {value: {mode: 'direct'}});
    await w.call(A, 'proxy.settings.clear', {});
    assert.deepEqual(tor.calls, [], 'no setProxy, no closeAllConnections');
    assert.equal(w.store().winner('proxy'), null, 'nothing stored');
    assert.equal(chromeSettings.proxyOverride(w.storeKey, tor), null);
    // even with a saved extension value for the profile, the Tor session never sees it
    const ordinary = fakeSession();
    chromeSettings.forProfile(w.storeKey, {userData: w.userData}).setValue('proxy', A, {mode: 'direct'});
    chromeSettings.registerHost(ordinary, {store: w.store()});
    assert.ok(chromeSettings.proxyOverride(w.storeKey, ordinary));
    assert.equal(chromeSettings.proxyOverride(w.storeKey, tor), null);
    assert.equal(chromeSettings.webRtcPolicy(tor, 'default_public_interface_only'), 'default_public_interface_only');
  } finally { w.dispose(); }
});

test('proxy-settings.cjs: the extension\'s proxy replaces the person\'s while it holds it, and the person\'s comes back', async () => {
  const w = world({extensions: {[A]: vpn}, storeKey: 'p1'});
  try {
    const policy = {networkProxy: {mode: 'fixed_servers', server: {scheme: 'http', host: 'mine.example', port: 8080}, bypassHosts: []}};
    const service = createProxySettings({database: {policy: () => policy, setPolicy() {}}, getContext() {}, getWindow() {}, dialog: {showMessageBox: async () => ({response: 1})}});
    await service.attach(w.session, 'p1', false);
    assert.equal(w.session.calls.filter(c => c[0] === 'setProxy').pop()[1].proxyRules, 'http://mine.example:8080');
    assert.deepEqual(await w.call(A, 'proxy.settings.get', {}), {value: {mode: 'fixed_servers', rules: {singleProxy: {scheme: 'http', host: 'mine.example', port: 8080}, bypassList: []}}, levelOfControl: 'controllable_by_this_extension'}, 'Acira\'s own proxy is what get() shows');
    await w.call(A, 'proxy.settings.set', {value: {mode: 'fixed_servers', rules: {singleProxy: server}}});
    assert.equal(w.session.calls.filter(c => c[0] === 'setProxy').pop()[1].proxyRules, 'https://proxy.example.net:443');
    const status = service.status(w.session);
    assert.equal(status.controlledBy.name, 'Fast VPN');
    assert.equal(status.controlledBy.mode, 'fixed_servers');
    assert.equal(status.choice.server.host, 'mine.example', 'the person\'s choice is kept');
    await assert.rejects(service.set(w.session, {mode: 'direct'}), /Fast VPN/);
    await w.call(A, 'proxy.settings.clear', {});
    assert.equal(w.session.calls.filter(c => c[0] === 'setProxy').pop()[1].proxyRules, 'http://mine.example:8080');
    assert.equal(service.status(w.session).controlledBy, undefined);
    assert.equal((await service.takeBack(w.session)).controlledBy, undefined);   // taking control back when nobody holds it changes nothing
  } finally { w.dispose(); }
});

test('proxy-settings.cjs: the person can take control back, and a restart applies the extension before anything loads', async () => {
  const w = world({extensions: {[A]: vpn}, storeKey: 'p2'});
  try {
    const service = createProxySettings({database: {policy: () => null, setPolicy() {}}, getContext() {}, getWindow() {}, dialog: {showMessageBox: async () => ({response: 1})}});
    await service.attach(w.session, 'p2', false);
    await w.call(A, 'proxy.settings.set', {value: {mode: 'direct'}});
    assert.equal(service.status(w.session).controlledBy.extensionId, A);
    assert.equal((await service.takeBack(w.session)).controlledBy, undefined);
    assert.deepEqual(w.session.calls.filter(c => c[0] === 'setProxy').pop()[1], {mode: 'system'});
    assert.equal(w.store().winner('proxy'), null);
    // a fresh start: the saved value is applied at attach, before any extension is loaded
    await w.call(A, 'proxy.settings.set', {value: {mode: 'pac_script', pacScript: {url: 'https://pac.example/p.pac'}}});
    const restarted = fakeSession();
    const again = createProxySettings({database: {policy: () => null, setPolicy() {}}, getContext() {}, getWindow() {}, dialog: {showMessageBox: async () => ({response: 1})}});
    await again.attach(restarted, 'p2', false);
    assert.deepEqual(restarted.calls.filter(c => c[0] === 'setProxy').pop()[1], {mode: 'pac_script', pacScript: 'https://pac.example/p.pac'});
    // private sessions never get an extension proxy
    const priv = fakeSession();
    await again.attach(priv, 'p2', true);
    assert.deepEqual(priv.calls.filter(c => c[0] === 'setProxy').pop()[1], {mode: 'system'});
  } finally { w.dispose(); }
});

test('onProxyError: a PAC script that cannot compile is reported to the extension that set it', async () => {
  const w = world({extensions: {[A]: vpn}});
  try {
    await w.call(A, 'proxy.settings.set', {value: {mode: 'pac_script', pacScript: {data: 'function ('}}});
    const error = w.sent.find(s => s[1] === 'proxy.onProxyError');
    assert.equal(error[0], A);
    assert.equal(error[2].fatal, true);
    assert.equal(error[2].error, 'net::ERR_PAC_SCRIPT_FAILED');
    assert.ok(error[2].details);
  } finally { w.dispose(); }
});

test('WebRTC follows an extension proxy: calls cannot reveal the local address around it', async () => {
  const page = session => ({session, policy: null, isDestroyed: () => false, setWebRTCIPHandlingPolicy(value) { this.policy = value; }});
  const session = fakeSession(), mine = page(session), another = page(fakeSession()), torPage = page(session);
  torPage.__aciraTorLocked = true;
  const w = world({extensions: {[A]: vpn}, session, contents: []});
  try {
    assert.equal(chromeSettings.webRtcPolicy(session, 'default_public_interface_only'), 'default_public_interface_only');
    assert.equal(chromeSettings.webRtcPolicy(session, 'default'), 'default_public_interface_only', 'never looser than Acira\'s floor');
    await w.call(A, 'proxy.settings.set', {value: {mode: 'fixed_servers', rules: {singleProxy: server}}});
    assert.equal(chromeSettings.webRtcPolicy(session, 'default_public_interface_only'), 'disable_non_proxied_udp');
    const { pushWebRtcPolicy } = require('../desktop/browser-services/ext-api/_settings.cjs');
    assert.equal(pushWebRtcPolicy(session, {contents: () => [mine, another, torPage]}), 1, 'only this profile\'s own, unlocked pages');
    assert.deepEqual([mine.policy, another.policy, torPage.policy], ['disable_non_proxied_udp', null, null]);
  } finally { w.dispose(); }
});

test('renderer: chrome.proxy has Chromium\'s shape, checks arguments and forwards to the main process', async () => {
  const packages = extApi.loadPackages({fresh: true}).filter(p => p.name === 'proxy');
  const answers = {'proxy.settings.get': {value: {mode: 'system'}, levelOfControl: 'controllable_by_this_extension'}};
  const world = extensionWorld({manifest_version: 3, permissions: ['proxy']}, {packages, answer: (name, args) => answers[name]});
  const {chrome} = world;
  assert.equal(typeof chrome.proxy.settings.get, 'function');
  assert.equal(typeof chrome.proxy.settings.set, 'function');
  assert.equal(typeof chrome.proxy.settings.clear, 'function');
  assert.equal(typeof chrome.proxy.settings.onChange.addListener, 'function');
  assert.equal(typeof chrome.proxy.onProxyError.addListener, 'function');
  assert.deepEqual(plain(await chrome.proxy.settings.get({})), answers['proxy.settings.get']);
  assert.throws(() => chrome.proxy.settings.get(5), {message: /^Error in invocation of types\.ChromeSetting\.get\(object details, optional function callback\)/});
  await chrome.proxy.settings.set({value: {mode: 'direct'}, scope: 'regular'});
  assert.deepEqual(plain(world.calls.filter(c => c.name === 'proxy.settings.set').map(c => c.args)), [[{value: {mode: 'direct'}, scope: 'regular'}]]);
  const heard = [];
  chrome.proxy.settings.onChange.addListener(details => heard.push(details.levelOfControl));
  world.emit('proxy.settings.onChange', {value: {mode: 'direct'}, levelOfControl: 'controlled_by_other_extensions'});
  assert.deepEqual(heard, ['controlled_by_other_extensions']);
  // Chrome runs callbacks and event listeners with the global object as `this` (ZeroOmega hands an unbound method to proxy.settings.get).
  const receivers = [];
  await new Promise(resolve => chrome.proxy.settings.get({}, function () { receivers.push(this && this.chrome === chrome); resolve(); }));
  chrome.proxy.settings.onChange.addListener(function () { receivers.push(this && this.chrome === chrome); });
  world.emit('proxy.settings.onChange', {value: {mode: 'direct'}, levelOfControl: 'controlled_by_this_extension'});
  assert.deepEqual(receivers, [true, true]);
  const without = extensionWorld({manifest_version: 3, permissions: ['storage']}, {packages});
  assert.equal(without.chrome.proxy, undefined, 'no proxy permission, no chrome.proxy');
});
