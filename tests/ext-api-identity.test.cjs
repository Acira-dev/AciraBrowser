'use strict';
// P9 essentials: chrome.identity. No Google account in Acira: the account members answer as Chrome does while signed out; getRedirectURL and
// launchWebAuthFlow (non-Google sign-in) work. The real window flow is proven by qa/p9/identity-live.mjs against a local fake OAuth server.
const test = require('node:test'), assert = require('node:assert/strict');
const os = require('node:os');
const {extensionWorld, plain, ID} = require('./fixtures/ext-api/world.cjs');
const extApi = require('../desktop/browser-services/ext-api/index.cjs');
const identity = require('../desktop/browser-services/ext-api/identity.cjs');
const {installExtensionApis} = require('../desktop/browser-services/extension-apis.cjs');

const mine = () => extApi.loadPackages({fresh: true}).filter(pkg => pkg.name === 'identity');
const answers = (name, args) => {
  if (name === 'identity.getAuthToken') return {__acira_error: identity.authTokenError({oauth2: {client_id: 'x.apps.googleusercontent.com', scopes: ['email']}}, args[0])};
  if (name === 'identity.getProfileUserInfo') return {email: '', id: ''};
  if (name === 'identity.launchWebAuthFlow') return `https://${ID}.chromiumapp.org/cb?code=1`;
  return undefined;
};

test('getAuthToken while signed out: Chrome\'s errors in Chrome\'s order', () => {
  assert.equal(identity.authTokenError({}, {}), 'Invalid OAuth2 Client ID.');
  assert.equal(identity.authTokenError({oauth2: {}}, {}), 'Invalid OAuth2 Client ID.');
  assert.equal(identity.authTokenError({oauth2: {client_id: 'c'}}, {}), 'Invalid OAuth2 scopes.');
  assert.equal(identity.authTokenError({oauth2: {client_id: 'c', scopes: []}}, {scopes: []}), 'Invalid OAuth2 scopes.');
  assert.equal(identity.authTokenError({oauth2: {client_id: 'c', scopes: ['email']}}, {}), 'The user is not signed in.');
  assert.equal(identity.authTokenError({oauth2: {client_id: 'c'}}, {scopes: ['profile']}), 'The user is not signed in.', 'scopes may come from the call');
  assert.equal(identity.authTokenError({oauth2: {client_id: 'c', scopes: ['email']}}, {interactive: true}), 'The user is not signed in.', 'interactive changes nothing: no sign-in to offer');
});

test('renderer: chrome.identity on Chromium\'s schema; a signed-out account answers with lastError or a rejection', async () => {
  const none = extensionWorld({manifest_version: 3, permissions: ['storage']}, {packages: mine()});
  assert.equal(none.chrome.identity, undefined, 'needs the identity permission');
  const world = extensionWorld({manifest_version: 3, permissions: ['identity'], oauth2: {client_id: 'x.apps.googleusercontent.com', scopes: ['email']}}, {packages: mine(), browser: {runtime: {id: ID}}, answer: answers});
  const {chrome} = world;
  assert.equal(chrome.identity.getRedirectURL(), `https://${ID}.chromiumapp.org/`);
  assert.equal(chrome.identity.getRedirectURL('cb'), `https://${ID}.chromiumapp.org/cb`);
  assert.equal(chrome.identity.getRedirectURL('/cb/deep?x=1'), `https://${ID}.chromiumapp.org/cb/deep?x=1`);
  assert.deepEqual(plain(chrome.identity.AccountStatus), {SYNC: 'SYNC', ANY: 'ANY'});
  await assert.rejects(chrome.identity.getAuthToken({interactive: false}), {message: 'The user is not signed in.'});
  const viaCallback = await new Promise(resolve => chrome.identity.getAuthToken({interactive: true}, token => resolve([token, chrome.runtime.lastError && chrome.runtime.lastError.message])));
  assert.deepEqual(viaCallback, [undefined, 'The user is not signed in.']);
  assert.equal(chrome.runtime.lastError, undefined, 'lastError is gone after the callback');
  assert.deepEqual(plain(await chrome.identity.getProfileUserInfo({accountStatus: 'ANY'})), {email: '', id: ''});
  assert.deepEqual(plain(await chrome.identity.getProfileUserInfo()), {email: '', id: ''});
  assert.equal(await chrome.identity.removeCachedAuthToken({token: 'gone'}), undefined);
  assert.equal(await chrome.identity.clearAllCachedAuthTokens(), undefined);
  assert.equal(await chrome.identity.launchWebAuthFlow({url: 'https://auth.test/authorize', interactive: true}), `https://${ID}.chromiumapp.org/cb?code=1`);
  assert.throws(() => chrome.identity.launchWebAuthFlow({interactive: true}), {message: /Error in invocation of identity\.launchWebAuthFlow/});
  assert.throws(() => chrome.identity.getProfileUserInfo({accountStatus: 'MAYBE'}), {message: /accountStatus/});
  assert.equal(world.browser.identity, chrome.identity);
  chrome.identity.onSignInChanged.addListener(() => {});
  assert.equal(chrome.identity.onSignInChanged.hasListeners(), true);
});

test('launchWebAuthFlow never stops the navigation inside did-start-navigation (it ended Electron 44\'s main process natively: the whole browser closed on every successful sign-in)', async () => {
  const {EventEmitter} = require('node:events');
  const {createIdentity} = require('../desktop/browser-services/extension-apis.cjs');
  const win = new EventEmitter(), wc = new EventEmitter();
  let stopped = 0, destroyed = 0;
  Object.assign(wc, {stop() { stopped++; }, setWindowOpenHandler() {}, loadURL: async () => {}});
  Object.assign(win, {webContents: wc, isDestroyed: () => destroyed > 0, destroy() { destroyed++; win.emit('closed'); }, once: win.once.bind(win), setTitle() {}, show() {}});
  const identity = createIdentity({session: {}, createWindow: () => win, hidden: () => true});
  const flow = identity.launchWebAuthFlow({extension: {id: ID, name: 'T', manifest: {name: 'T'}}}, {url: 'https://auth.test/start', interactive: true});
  // Chromium reports the navigation to the redirect address first (details object, as Electron 44 passes it) ...
  wc.emit('did-start-navigation', {url: `https://${ID}.chromiumapp.org/cb?code=1`, isMainFrame: true, isSameDocument: false});
  assert.equal(await flow, `https://${ID}.chromiumapp.org/cb?code=1`);
  assert.equal(stopped, 0, 'wc.stop() inside did-start-navigation is the crash');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(destroyed, 1, 'the window is destroyed on the next tick instead');
});

test('main: the handlers answer behind the permission check; launchWebAuthFlow stays the older handler', async () => {
  const handlers = new Map();
  const router = {handlers, listeners: new Map(), handle(name, callback) { handlers.set(name, {callback, extensionContext: true}); }, sendEvent() {}, broadcastEvent() {}};
  const session = {extensions: {getExtension: () => null, on() {}}, serviceWorkers: {getAllRunning: () => ({})}};
  installExtensionApis({ctx: {router}}, {session, userData: os.tmpdir()});
  const event = permissions => ({type: 'service-worker', extension: {id: ID, manifest: {manifest_version: 3, permissions, oauth2: {client_id: 'c', scopes: ['email']}}}});
  assert.deepEqual(await handlers.get('identity.getAuthToken').callback(event(['identity']), {interactive: false}), {__acira_error: 'The user is not signed in.'});
  assert.deepEqual(await handlers.get('identity.getAuthToken').callback(event([]), {}), {__acira_error: 'Access to extension API denied.'});
  assert.deepEqual(await handlers.get('identity.getProfileUserInfo').callback(event(['identity']), {}), {email: '', id: ''});
  assert.equal(typeof handlers.get('identity.launchWebAuthFlow').callback, 'function');
});
