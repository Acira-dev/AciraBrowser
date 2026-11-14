'use strict';
// chrome.privacy (ext-api/privacy*.cjs): only what Acira really controls is controllable; the rest says so truthfully.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const chromeSettings = require('../desktop/browser-services/extension-chrome-settings.cjs');
const settingsHelper = require('../desktop/browser-services/ext-api/_settings.cjs');
const extApi = require('../desktop/browser-services/ext-api/index.cjs');
const table = require('../desktop/browser-services/ext-api/privacy/table.cjs');
const {extensionWorld, plain} = require('./fixtures/ext-api/world.cjs');
const {world, fakeSession, manifest, A, B} = require('./fixtures/ext-api-proxy/harness.cjs');

const ext = {name: 'Guard', manifest: manifest(['privacy'])};
const RTC = 'privacy.network.webRTCIPHandlingPolicy';
const PW = 'privacy.services.passwordSavingEnabled';
const page = session => ({session, policy: null, isDestroyed: () => false, setWebRTCIPHandlingPolicy(value) { this.policy = value; }});

test('WebRTC: a stricter policy is honoured and reaches the pages of this profile only', async () => {
  const session = fakeSession(), mine = page(session), other = page(fakeSession());
  settingsHelper.hooks.contents = () => [mine, other];
  const w = world({packages: ['privacy'], extensions: {[A]: ext}, session});
  try {
    assert.deepEqual(await w.call(A, RTC + '.get', {}), {value: 'default_public_interface_only', levelOfControl: 'controllable_by_this_extension'}, 'Acira\'s own floor is the starting value');
    await w.call(A, RTC + '.set', {value: 'disable_non_proxied_udp'});
    assert.deepEqual(await w.call(A, RTC + '.get', {}), {value: 'disable_non_proxied_udp', levelOfControl: 'controlled_by_this_extension'});
    assert.deepEqual([mine.policy, other.policy], ['disable_non_proxied_udp', null]);
    assert.equal(chromeSettings.webRtcPolicy(session, 'default_public_interface_only'), 'disable_non_proxied_udp');
    await w.call(A, RTC + '.clear', {});
    assert.equal(mine.policy, 'default_public_interface_only', 'clearing puts Acira\'s policy back on open pages');
  } finally { settingsHelper.hooks.contents = null; w.dispose(); }
});

test('WebRTC: a looser policy than Acira\'s floor is not used, and get() does not pretend it was', async () => {
  const session = fakeSession(), mine = page(session);
  settingsHelper.hooks.contents = () => [mine];
  const w = world({packages: ['privacy'], extensions: {[A]: ext}, session});
  try {
    for (const loose of ['default', 'default_public_and_private_interfaces']) {
      await w.call(A, RTC + '.set', {value: loose});   // no error, as for a setting Chrome does not let an extension change
      assert.deepEqual(await w.call(A, RTC + '.get', {}), {value: 'default_public_interface_only', levelOfControl: 'controllable_by_this_extension'}, loose);
    }
    assert.equal(w.store().winner(RTC), null, 'nothing stored');
    assert.equal(mine.policy, null, 'no page was touched');
    await w.call(A, RTC + '.set', {value: 'default_public_interface_only'});
    assert.equal((await w.call(A, RTC + '.get', {})).levelOfControl, 'controlled_by_this_extension');
    await assert.rejects(w.call(A, RTC + '.set', {value: 'everything'}), /Invalid value for webRTCIPHandlingPolicy/);
  } finally { settingsHelper.hooks.contents = null; w.dispose(); }
});

test('onChange: a second extension taking WebRTC control is heard by the first', async () => {
  settingsHelper.hooks.contents = () => [];
  const w = world({packages: ['privacy'], extensions: {[A]: ext, [B]: ext}});
  try {
    await w.call(A, RTC + '.set', {value: 'default_public_interface_only'});
    w.listen(A, RTC + '.onChange');
    await w.call(A, RTC + '.get', {});
    await w.call(B, RTC + '.set', {value: 'disable_non_proxied_udp'});
    const heard = w.sent.filter(s => s[1] === RTC + '.onChange');
    assert.deepEqual(heard.map(s => [s[0], s[2].value, s[2].levelOfControl]), [[A, 'disable_non_proxied_udp', 'controlled_by_other_extensions']]);
  } finally { settingsHelper.hooks.contents = null; w.dispose(); }
});

test('settings Acira fixes answer truthfully: the real value, not_controllable, and an extension\'s value changes nothing', async () => {
  const w = world({packages: ['privacy'], extensions: {[A]: ext}});
  try {
    for (const [name, value] of table.FIXED) {
      const path = 'privacy.' + name;
      assert.deepEqual(await w.call(A, path + '.get', {}), {value, levelOfControl: 'not_controllable'}, name);
      await w.call(A, path + '.set', {value: !value});
      assert.deepEqual(await w.call(A, path + '.get', {}), {value, levelOfControl: 'not_controllable'}, name + ' after set');
      await w.call(A, path + '.clear', {});
    }
    assert.equal(w.store().keys().length, 0);
    await assert.rejects(w.call(A, 'privacy.network.networkPredictionEnabled.set', {value: 'yes'}), /boolean is required/);
  } finally { w.dispose(); }
});

const THREE = ['autofillAddressEnabled', 'autofillCreditCardEnabled', 'passwordSavingEnabled'];
// Bitwarden's BrowserApi.browserAutofillSettingsOverridden(): all three controlled_by_this_extension with value false.
const overriddenFor = w => async id => { let all = true; for (const name of THREE) { const got = await w.call(id, 'privacy.services.' + name + '.get', {}); all = all && got.levelOfControl === 'controlled_by_this_extension' && !got.value; } return all; };
// Bitwarden's BrowserApi.updateDefaultBrowserAutofillSettings(value): its "default password manager" switch sets all three to !on.
const press = (w, id, on) => (async () => { for (const name of THREE) await w.call(id, 'privacy.services.' + name + '.set', {value: !on}); })();

test('address and card autofill: Acira has neither; an extension\'s value is kept and answered as in Chrome, true or false, and a password manager sees itself in control', async () => {
  const w = world({packages: ['privacy'], extensions: {[A]: ext, [B]: ext}, storeKey: 'autofill'});
  try {
    chromeSettings.provide({passwordsEnabled: () => true});
    for (const [name] of [...table.NO_FEATURE].reverse()) { // autofillEnabled last: it also sets the other two
      const path = 'privacy.' + name;
      assert.deepEqual(await w.call(A, path + '.get', {}), {value: false, levelOfControl: 'controllable_by_this_extension'}, name + ' before: Acira has no such autofill');
      await w.call(A, path + '.set', {value: true});
      assert.deepEqual(await w.call(A, path + '.get', {}), {value: true, levelOfControl: 'controlled_by_this_extension'}, name + ': the extension\'s "on" is its value (SetPreferenceFunction stores it)');
      await w.call(A, path + '.set', {value: false});
      assert.deepEqual(await w.call(A, path + '.get', {}), {value: false, levelOfControl: 'controlled_by_this_extension'}, name + ' held off');
    }
    await w.call(A, PW + '.set', {value: false});
    const overridden = overriddenFor(w);
    assert.equal(await overridden(A), true, 'the extension that switched all three off is the default password manager');
    assert.equal(await overridden(B), false, 'another extension is not');
    await w.call(A, 'privacy.services.autofillAddressEnabled.clear', {});
    assert.equal(await overridden(A), false, 'clearing one gives the control back');
  } finally { w.dispose(); }
});

test('Bitwarden\'s "default password manager" switch, with the person\'s own save offer off: on, off, on again; its check follows every press and onChange tells it', async () => {
  const w = world({packages: ['privacy'], extensions: {[A]: ext}, storeKey: 'bw'});
  try {
    chromeSettings.provide({passwordsEnabled: () => false});
    for (const name of THREE) w.listen(A, 'privacy.services.' + name + '.onChange');
    for (const name of THREE) await w.call(A, 'privacy.services.' + name + '.get', {});
    const overridden = overriddenFor(w), heard = () => w.sent.filter(s => /\.onChange$/.test(s[1])).map(s => [s[1].split('.')[2], s[2].value, s[2].levelOfControl]);
    await press(w, A, true);
    assert.equal(await overridden(A), true, 'on');
    assert.equal(chromeSettings.passwordSavingOffByExtension('bw'), true, 'Acira\'s save offer is off while it is the default');
    assert.deepEqual(heard(), [['autofillAddressEnabled', false, 'controlled_by_this_extension'], ['autofillCreditCardEnabled', false, 'controlled_by_this_extension'],
      ['passwordSavingEnabled', false, 'controlled_by_this_extension']]);
    w.sent.length = 0;
    await press(w, A, false);
    assert.equal(await overridden(A), false, 'off: it read "still the default" before, so the switch went back on by itself');
    for (const name of THREE) assert.deepEqual(await w.call(A, 'privacy.services.' + name + '.get', {}), {value: true, levelOfControl: 'controlled_by_this_extension'}, name);
    assert.deepEqual(heard(), [['autofillAddressEnabled', true, 'controlled_by_this_extension'], ['autofillCreditCardEnabled', true, 'controlled_by_this_extension'],
      ['passwordSavingEnabled', true, 'controlled_by_this_extension']], 'onChange for each of the three');
    assert.equal(chromeSettings.passwordSavingOffByExtension('bw'), false);
    assert.equal(chromeSettings.fact('passwordsEnabled'), false, 'the person\'s own "off" is untouched: Acira\'s offer stays off');
    await press(w, A, true);
    assert.equal(await overridden(A), true, 'on again');
  } finally { w.dispose(); }
});

test('passwordSavingEnabled: the extension\'s value is answered as in Chrome; only a winning false switches Acira\'s offer off, a true never turns it back on for someone who switched it off', async () => {
  const w = world({packages: ['privacy'], extensions: {[A]: ext}, storeKey: 'pw'});
  try {
    chromeSettings.provide({passwordsEnabled: () => true});
    assert.deepEqual(await w.call(A, PW + '.get', {}), {value: true, levelOfControl: 'controllable_by_this_extension'});
    assert.equal(chromeSettings.passwordSavingOffByExtension('pw'), false);
    await w.call(A, PW + '.set', {value: false});
    assert.deepEqual(await w.call(A, PW + '.get', {}), {value: false, levelOfControl: 'controlled_by_this_extension'});
    assert.equal(chromeSettings.passwordSavingOffByExtension('pw'), true);
    assert.equal(chromeSettings.passwordSavingOffByExtension('someone-else'), false);
    await w.call(A, PW + '.clear', {});
    assert.equal(chromeSettings.passwordSavingOffByExtension('pw'), false);
    chromeSettings.provide({passwordsEnabled: () => false});
    assert.deepEqual(await w.call(A, PW + '.get', {}), {value: false, levelOfControl: 'controllable_by_this_extension'}, 'the person\'s own "off"');
    await w.call(A, PW + '.set', {value: true});
    assert.deepEqual(await w.call(A, PW + '.get', {}), {value: true, levelOfControl: 'controlled_by_this_extension'}, 'the extension\'s value');
    assert.equal(w.store().winner(PW).value, true);
    assert.equal(chromeSettings.passwordSavingOffByExtension('pw'), false);
    assert.equal(chromeSettings.fact('passwordsEnabled'), false, 'Acira\'s offer still follows the person\'s switch');
  } finally { w.dispose(); }
});

test('the deprecated autofillEnabled also sets the card and address settings (SetPreferenceFunction::Run), and clearing it leaves them', async () => {
  const w = world({packages: ['privacy'], extensions: {[A]: ext}, storeKey: 'old-autofill'});
  try {
    for (const name of ['autofillAddressEnabled', 'autofillCreditCardEnabled']) { w.listen(A, 'privacy.services.' + name + '.onChange'); await w.call(A, 'privacy.services.' + name + '.get', {}); }
    await w.call(A, 'privacy.services.autofillEnabled.set', {value: false});
    for (const name of ['autofillEnabled', 'autofillAddressEnabled', 'autofillCreditCardEnabled'])
      assert.deepEqual(await w.call(A, 'privacy.services.' + name + '.get', {}), {value: false, levelOfControl: 'controlled_by_this_extension'}, name);
    assert.deepEqual(w.sent.filter(s => /\.onChange$/.test(s[1])).map(s => s[1].split('.')[2]).sort(), ['autofillAddressEnabled', 'autofillCreditCardEnabled']);
    await w.call(A, 'privacy.services.autofillEnabled.clear', {});
    assert.deepEqual(await w.call(A, 'privacy.services.autofillEnabled.get', {}), {value: false, levelOfControl: 'controllable_by_this_extension'});
    assert.deepEqual(await w.call(A, 'privacy.services.autofillAddressEnabled.get', {}), {value: false, levelOfControl: 'controlled_by_this_extension'}, 'ClearPreferenceFunction has no fan-out');
  } finally { w.dispose(); }
});

test('a password manager\'s switch survives a restart, stops counting while the extension is unloaded (disabled) and comes back, and goes with an uninstall', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-bw-restart-'));
  let w = world({packages: ['privacy'], extensions: {[A]: ext}, storeKey: 'keep', userData});
  try {
    chromeSettings.provide({passwordsEnabled: () => true});
    await press(w, A, true);
    w.installed.dispose(); chromeSettings.reset();
    w = world({packages: ['privacy'], extensions: {[A]: ext}, storeKey: 'keep', userData});
    chromeSettings.provide({passwordsEnabled: () => true});
    assert.equal(await overriddenFor(w)(A), true, 'after a restart');
    assert.equal(chromeSettings.passwordSavingOffByExtension('keep'), true);
    w.unload(A);
    assert.equal(chromeSettings.passwordSavingOffByExtension('keep'), false, 'disabled: Acira\'s offer is back');
    w.load(A, ext);
    assert.equal(chromeSettings.passwordSavingOffByExtension('keep'), true, 'enabled again: its value counts again (ExtensionPrefValueMap::SetExtensionState)');
    w.installed.forget(A);
    assert.equal(chromeSettings.passwordSavingOffByExtension('keep'), false, 'uninstalled');
    assert.deepEqual(w.store().keys(), [], 'its values are gone');
  } finally { w.dispose(); fs.rmSync(userData, {recursive: true, force: true}); }
});

test('Tor: every privacy setting is fixed and nothing is applied', async () => {
  const tor = fakeSession({tor: true}), mine = page(tor);
  settingsHelper.hooks.contents = () => [mine];
  const w = world({packages: ['privacy'], extensions: {[A]: ext}, session: tor});
  try {
    assert.equal((await w.call(A, RTC + '.get', {})).levelOfControl, 'not_controllable');
    await w.call(A, RTC + '.set', {value: 'disable_non_proxied_udp'});
    assert.equal(mine.policy, null, 'a Tor page keeps what tor-window.cjs gave it');
    assert.equal(w.store().winner(RTC), null);
    assert.equal((await w.call(A, PW + '.get', {})).levelOfControl, 'not_controllable');
  } finally { settingsHelper.hooks.contents = null; w.dispose(); }
});

test('incognito and permission errors match the proxy ones', async () => {
  const w = world({packages: ['privacy'], extensions: {[A]: ext, [B]: {name: 'x', manifest: manifest(['storage'])}}});
  try {
    await assert.rejects(w.call(A, RTC + '.get', {incognito: true}), /incognito preferences/);
    await assert.rejects(w.call(A, RTC + '.set', {value: 'disable_non_proxied_udp', scope: 'incognito_session_only'}), /incognito preferences/);
    await assert.rejects(w.call(B, RTC + '.get', {}), {message: 'Access to extension API denied.'});
  } finally { w.dispose(); }
});

test('renderer: the names it builds are exactly the ones the main side answers', () => {
  const packages = extApi.loadPackages({fresh: true}).filter(p => p.name === 'privacy');
  const defined = table.definitions().map(def => def.path);
  const w = extensionWorld({manifest_version: 3, permissions: ['privacy']}, {packages, answer: () => ({value: false, levelOfControl: 'not_controllable'})});
  const {privacy} = w.chrome;
  for (const path of defined) {
    const parts = path.split('.').slice(1);
    const setting = parts.reduce((object, part) => object[part], privacy);
    assert.equal(typeof setting.get, 'function', path);
    assert.equal(typeof setting.set, 'function', path);
    assert.equal(typeof setting.clear, 'function', path);
    assert.equal(typeof setting.onChange.addListener, 'function', path);
  }
  assert.equal(privacy.IPHandlingPolicy.DISABLE_NON_PROXIED_UDP, 'disable_non_proxied_udp');
  assert.throws(() => privacy.network.webRTCIPHandlingPolicy.set({}), {message: /Missing required property 'value'/});
  return privacy.network.networkPredictionEnabled.get({}).then(answer => {
    assert.deepEqual(plain(answer), {value: false, levelOfControl: 'not_controllable'});
    assert.ok(w.calls.some(c => c.name === 'privacy.network.networkPredictionEnabled.get'));
  });
});

test('privacy.websites stays Chromium\'s default answer (deferred)', async () => {
  const packages = extApi.loadPackages({fresh: true}).filter(p => p.name === 'privacy');
  const w = extensionWorld({manifest_version: 3, permissions: ['privacy']}, {packages});
  await assert.rejects(w.chrome.privacy.websites.hyperlinkAuditingEnabled.get({}), {message: 'Access to extension API denied.'});
});
