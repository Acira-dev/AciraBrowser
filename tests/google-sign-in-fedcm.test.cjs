'use strict';
// "Continue with Google" on pinterest.com did nothing (reported on Windows, beta.10; the same on the Mac). Pinterest's button asks the browser for FedCM
// (navigator.credentials.get({identity: {mode: 'active'}})). Electron ships that API without the account chooser the browser has to draw for it, so the
// request was dismissed at once ("NetworkError: Error retrieving a token", issue UiDismissedNoEmbargo), and Google Identity Services, which only checks
// that window.IdentityCredential exists, never fell back to its own sign-in window. Acira starts the engine with FedCm off, so the page does not see the
// API and takes the route Firefox and Safari get: window.open of Google's sign-in page, with its opener. Nothing about cookies or storage changes.
const { test } = require('node:test'), assert = require('node:assert/strict'), { spawnSync } = require('node:child_process');
const path = require('node:path'), fs = require('node:fs');
const { configureEngineFeatures, engineFeatureStatus, FEDCM_FEATURES, AD_API_FEATURES } = require('../desktop/browser-services/engine-features.cjs');
const { routeWindowOpen, popupBounds } = require('../desktop/window-open-policy.cjs');

function fakeApp(initial = {}) { const switches = new Map(Object.entries(initial)); return { isReady: () => false, commandLine: { getSwitchValue: name => switches.get(name) || '', appendSwitch: (name, value) => switches.set(name, value), removeSwitch: name => switches.delete(name) }, switches }; }

test('FedCM is switched off at startup, whatever the third-party cookie choice, and other features are kept', () => {
  assert.deepEqual([...FEDCM_FEATURES], ['FedCm']);
  for (const thirdPartyCookies of ['block', 'allow']) {
    const app = fakeApp({ 'enable-features': 'SomethingElse', 'disable-features': 'Other' });
    configureEngineFeatures({ app, thirdPartyCookies });
    const disabled = app.switches.get('disable-features').split(','), enabled = app.switches.get('enable-features').split(',');
    assert.ok(disabled.includes('FedCm'), thirdPartyCookies);
    assert.ok(disabled.includes('Other') && enabled.includes('SomethingElse'), 'unrelated features stay');
    for (const feature of AD_API_FEATURES) assert.ok(disabled.includes(feature), feature);
    assert.ok(!enabled.includes('FedCm'), 'never both enabled and disabled');
  }
});

test('it is applied once, not stacked, and a FedCm the person or launcher left in the enable list does not win', () => {
  const app = fakeApp({ 'enable-features': 'FedCm,SomethingElse', 'disable-features': 'FedCm' });
  configureEngineFeatures({ app }); configureEngineFeatures({ app });
  assert.equal(app.switches.get('disable-features').split(',').filter(name => name === 'FedCm').length, 1);
  assert.ok(!app.switches.get('enable-features').split(',').includes('FedCm'));
  assert.ok(app.switches.get('enable-features').split(',').includes('SomethingElse'));
});

test('the cookie and storage choices are unchanged: still blocked third-party cookies, partitioned storage, the status the panel reads', () => {
  const app = fakeApp(); configureEngineFeatures({ app });
  const enabled = app.switches.get('enable-features').split(',');
  assert.ok(enabled.includes('ForceThirdPartyCookieBlockingEnabled') && enabled.includes('ThirdPartyStoragePartitioning'));
  assert.deepEqual(engineFeatureStatus(app), { thirdPartyCookies: 'block', adApis: 'removed' });
  const allow = fakeApp(); configureEngineFeatures({ app: allow, thirdPartyCookies: 'allow' });
  assert.ok(!allow.switches.get('enable-features').split(',').includes('ForceThirdPartyCookieBlockingEnabled'), 'allow still allows');
});

test('the window Google\'s button opens (as Pinterest, Reddit, Dropbox, Canva and LinkedIn call it) is a pop-up window that keeps its opener', () => {
  // window.open(url, 'g_credential_picker_…', features) from the page's own script, on a click, as logged on pinterest.com and reddit.com
  const details = { url: 'https://accounts.google.com/o/oauth2/v2/auth?as=x&client_id=1.apps.googleusercontent.com&scope=openid%20email%20profile&response_type=id_token&gsiwebsdk=gis_attributes&redirect_uri=gis_transform', disposition: 'new-window', features: 'toolbar=no,location=no,directories=no,status=no,menubar=no,scrollbars=no,resizable=no,copyhistory=no,width=590,height=830,top=24,left=381', frameName: 'g_credential_picker_560a89483c0fb760' };
  const route = routeWindowOpen(details, { link: false, privateTab: false, tor: false, sameSession: true });
  assert.equal(route.route, 'popup', 'a window, not a tab: a tab would lose window.opener and the postMessage back to the page');
  const bounds = popupBounds(details.features, { x: 0, y: 25, width: 1440, height: 875 });
  assert.equal(bounds.width, 590); assert.equal(bounds.useContentSize, true);
  assert.equal(routeWindowOpen(details, { sameSession: true, privateTab: true }).route, 'popup', 'also in a private window');
});

// The real engine: the same page, asked what it sees of FedCM, with the engine started as Acira starts it and (control) without.
const electron = (() => { try { const value = require('electron'); return typeof value === 'string' && fs.existsSync(value) ? value : null; } catch { return null; } })();
const skip = !electron ? 'electron binary not available' : false;
function run(mode) {
  const env = { ...process.env, ELECTRON_ENABLE_LOGGING: '0' }; delete env.ELECTRON_RUN_AS_NODE;
  const out = spawnSync(electron, ['--use-mock-keychain', path.join(__dirname, 'fixtures', 'fedcm', 'run.cjs'), mode], { encoding: 'utf8', timeout: 90000, env });
  const line = (out.stdout || '').split(/\r?\n/).find(text => text.startsWith('RESULT ')), error = (out.stdout || '').split(/\r?\n/).find(text => text.startsWith('ERROR '));
  return { result: line ? JSON.parse(line.slice(7)) : null, problem: error || (out.error && String(out.error)) || (out.stderr || '').slice(0, 300) };
}
const control = skip ? null : run('off'), applied = skip ? null : run('on');

test('control, engine as Electron ships it: the page sees FedCM and an identity request is refused with no account chooser to show', { skip }, () => {
  assert.ok(control.result, control.problem || 'no result');
  assert.equal(control.result.seen.secure, true);
  assert.equal(control.result.seen.identityCredential, 'function', 'Google Identity Services sees the API and takes the FedCM path');
  assert.notEqual(control.result.seen.request, 'resolved');
});

test('engine started by Acira: the page does not see FedCM, so the sign-in button takes its own window', { skip }, () => {
  assert.ok(applied.result, applied.problem || 'no result');
  assert.deepEqual(applied.result.switches, ['FedCm']);
  assert.equal(applied.result.seen.identityCredential, 'undefined');
  assert.equal(applied.result.seen.inWindow, false);
});

test('main.cjs applies the engine features before the app is ready, for every session', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'main.cjs'), 'utf8');
  const early = main.indexOf('.early()'), ready = main.indexOf('app.whenReady()');
  assert.ok(early > 0, 'native network preferences start the engine features');
  assert.ok(ready < 0 || early < ready, 'before ready');
});
