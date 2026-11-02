'use strict';
// The generated Chromium extension-API surface (desktop/browser-services/extension-api-surface.gen.cjs) and the binding rules built on it
// (extension-api-signature.cjs): up to date with the vendored schemas, faithful to Chromium's values and error strings, and usable as the
// skeleton an implementation plugs behaviour into.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

const root = path.resolve(__dirname, '..');
const surface = require('../desktop/browser-services/extension-api-surface.gen.cjs');
const sig = require('../desktop/browser-services/extension-api-signature.cjs');

test('generated surface matches the vendored Chromium schemas', () => {
  const run = spawnSync(process.execPath, [path.join(root, 'scripts', 'gen-extension-api.mjs'), '--check'], {cwd: root, encoding: 'utf8'});
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.match(surface.chromium, /^chromium\/src 152\./);
  assert.deepEqual(surface.parseErrors, []);
});

test('namespaces Web Store extensions get on Windows, and the ones they do not', () => {
  for (const ns of ['tabs', 'windows', 'runtime', 'storage', 'alarms', 'declarativeNetRequest', 'sidePanel', 'offscreen', 'userScripts', 'devtools.panels', 'system.cpu'])
    assert.ok(surface.namespaces[ns], ns + ' exposed');
  assert.equal(surface.namespaces.tabs.status, 'exposed');
  assert.equal(surface.namespaces.types.status, 'types');
  for (const ns of ['fileManagerPrivate', 'browserAction', 'pageAction', 'enterprise.platformKeys', 'app.window', 'test']) assert.ok(surface.excluded[ns], ns + ' excluded');
  assert.match(surface.excluded.browserAction.why.join(' '), /Manifest V2/);
  assert.match(surface.excluded['enterprise.platformKeys'].why.join(' '), /chromeos|policy/);
});

test('permission gates and contexts come from Chromium feature files', () => {
  assert.deepEqual(surface.namespaces.alarms.permissions, ['alarms']);
  assert.deepEqual(surface.namespaces.tabs.permissions, []);
  assert.deepEqual(surface.namespaces.action.manifestKeys, ['action']);
  assert.deepEqual(surface.namespaces.runtime.functions.connectNative.feature.permissions, ['nativeMessaging']);
  assert.ok(surface.namespaces.runtime.functions.sendMessage.feature.contexts.includes('content_script'));
  assert.equal(surface.namespaces.tabs.functions.executeScript.feature.ok, false); // MV2 only
});

test('constants, enums and defaults carry Chromium values', () => {
  const dnr = surface.namespaces.declarativeNetRequest;
  assert.equal(dnr.properties.MAX_NUMBER_OF_DYNAMIC_RULES.value, 30000);
  assert.equal(dnr.properties.MAX_NUMBER_OF_REGEX_RULES.value, 1000);
  assert.equal(surface.namespaces.storage.properties.local.properties.QUOTA_BYTES.value, 10485760);
  assert.deepEqual(surface.namespaces.tabs.types.TabStatus.enum, ['unloaded', 'loading', 'complete']);
  assert.equal(surface.namespaces.tabs.properties.TAB_ID_NONE.value, -1);
});

test('signatures: optional parameters, trailing callback and promise support', () => {
  assert.equal(sig.signatureOf('alarms', 'create').text, 'optional string name, alarms.AlarmCreateInfo alarmInfo, optional function callback');
  assert.equal(sig.signatureOf('runtime', 'sendMessage').text, 'optional string extensionId, any message, optional object options, optional function callback');
  assert.deepEqual(sig.parseArguments('alarms', 'create', [{when: 1}]), {args: [null, {when: 1}], callback: null, async: 'promise'});
  const cb = () => {};
  assert.deepEqual(sig.parseArguments('alarms', 'create', ['a', {delayInMinutes: 1}, cb]), {args: ['a', {delayInMinutes: 1}], callback: cb, async: 'callback'});
  assert.deepEqual(sig.parseArguments('runtime', 'sendMessage', ['hi']).args, [null, 'hi', null]);
});

test("invalid calls fail with Chromium's exact messages", () => {
  const fails = (ns, fn, args, message) => assert.throws(() => sig.parseArguments(ns, fn, args), {name: 'TypeError', message});
  fails('alarms', 'create', ['a', 5], 'Error in invocation of alarms.create(optional string name, alarms.AlarmCreateInfo alarmInfo, optional function callback): No matching signature.');
  fails('tabs', 'get', ['x'], 'Error in invocation of tabs.get(integer tabId, optional function callback): No matching signature.');
  fails('tabs', 'query', [{foo: 1}], "Error in invocation of tabs.query(object queryInfo, optional function callback): Error at parameter 'queryInfo': Unexpected property: 'foo'.");
  fails('tabs', 'query', [{status: 'bogus'}], "Error in invocation of tabs.query(object queryInfo, optional function callback): Error at parameter 'queryInfo': Error at property 'status': Value must be one of complete, loading, unloaded.");
  fails('tabs', 'query', [{index: -1}], "Error in invocation of tabs.query(object queryInfo, optional function callback): Error at parameter 'queryInfo': Error at property 'index': Value must be at least 0.");
  fails('alarms', 'create', [{periodInMinutes: 'x'}], "Error in invocation of alarms.create(optional string name, alarms.AlarmCreateInfo alarmInfo, optional function callback): Error at parameter 'alarmInfo': Error at property 'periodInMinutes': Invalid type: expected number, found string.");
});

test('buildNamespace: behaviour only; everything else from the schema', async () => {
  const seen = [];
  const alarms = sig.buildNamespace('alarms', {functions: {create: (name, info) => { seen.push([name, info]); }, getAll: async () => []}});
  assert.deepEqual(Object.keys(alarms).sort(), ['clear', 'clearAll', 'create', 'get', 'getAll', 'onAlarm']);
  await alarms.create({delayInMinutes: 1});
  assert.deepEqual(seen, [[null, {delayInMinutes: 1}]]);
  assert.deepEqual(await alarms.getAll(), []);
  await assert.rejects(alarms.clear('x'), {message: 'Access to extension API denied.'});
  assert.throws(() => alarms.create(5), /No matching signature/);
  assert.equal(typeof alarms.onAlarm.addListener, 'function');
  const errors = [];
  await new Promise(resolve => alarms.get('x', value => { errors.push(value); resolve(); }));
  assert.deepEqual(errors, [undefined]);
  const dnr = sig.buildNamespace('declarativeNetRequest');
  assert.equal(dnr.MAX_NUMBER_OF_DYNAMIC_RULES, 30000);
  assert.equal(dnr.RuleActionType.MODIFY_HEADERS, 'modifyHeaders');
  const idle = sig.buildNamespace('idle', {functions: {queryState: async seconds => (seconds >= 15 ? 'active' : 'idle')}});
  assert.deepEqual(idle.IdleState, {ACTIVE: 'active', IDLE: 'idle', LOCKED: 'locked'});
  assert.equal(await idle.queryState(60), 'active');
  assert.throws(() => idle.queryState(10), /Error at parameter 'detectionIntervalInSeconds': Value must be at least 15\./);
  assert.ok(sig.unimplemented('alarms', {functions: {create() {}}}).includes('getAll'));
});
