'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path'), fs = require('node:fs'), vm = require('node:vm');
const { chromeUserAgent, applyChromeUserAgent } = require('../desktop/browser-services/user-agent.cjs');
const { pageLanguages, scriptFor } = require('../desktop/browser-services/chrome-identity.cjs');
const { googleAccountPage, nativeAuthenticationContext } = require('../desktop/browser-services/authentication-compatibility.cjs');
const { createFarbling, reduceClientHints } = require('../desktop/browser-services/fingerprint-farbling.cjs');
const appVersion = require('../package.json').version;
const base = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)';
const sample = `${base} AciraBrowser/44.9.3 Chrome/152.0.7977.167 Electron/44.9.3 Safari/537.36`;

test('Chromium-compatible UA identifies Acira and its actual version on every platform', () => {
  for (const platform of ['Windows NT 10.0; Win64; x64', 'Macintosh; Intel Mac OS X 10_15_7', 'X11; Linux x86_64']) {
    const original = sample.replace('Windows NT 10.0; Win64; x64', platform);
    const value = chromeUserAgent(original);
    assert.equal(value, original.replace(/ AciraBrowser\/44.9.3| Electron\/44.9.3/g, '').replace('152.0.7977.167', '152.0.0.0') + ' AciraBrowser/' + appVersion);
    assert.equal(chromeUserAgent(value), value, 'normalization is idempotent');
    assert.doesNotMatch(value, /Electron\//);
  }
  assert.equal(chromeUserAgent(sample, '2.3.4'), `${base} Chrome/152.0.0.0 Safari/537.36 AciraBrowser/2.3.4`);
  assert.throws(() => chromeUserAgent(sample, '1.0\r\nX-Fake: yes'), /valid Acira version/);
  for (const value of ['curl/8.0', '', undefined]) assert.equal(chromeUserAgent(value), value);
});

test('application UA is set before sessions; the existing comparison opt-out is retained', () => {
  const app = { userAgentFallback: sample };
  assert.equal(applyChromeUserAgent(app, {}), chromeUserAgent(sample));
  const control = { userAgentFallback: sample };
  assert.equal(applyChromeUserAgent(control, { ACIRA_KEEP_ELECTRON_UA: '1' }), sample);
  const main = fs.readFileSync(path.join(__dirname, '../desktop/main.cjs'), 'utf8');
  assert.ok(main.indexOf('applyChromeUserAgent(app)') < main.indexOf('app.whenReady'));
});

test('native authentication exception matches HTTPS Google Account pages, including embedded login frames, without matching lookalikes', () => {
  for (const url of ['https://accounts.google.com/', 'https://accounts.google.com/v3/signin/identifier?continue=https%3A%2F%2Fwww.youtube.com', 'https://ACCOUNTS.GOOGLE.COM/']) {
    assert.equal(googleAccountPage(url), true, url);
    assert.equal(nativeAuthenticationContext(url, 'https://www.gstatic.com/frame'), true);
    assert.equal(nativeAuthenticationContext('https://www.youtube.com/', url), true);
  }
  for (const url of ['http://accounts.google.com/', 'https://accounts.google.com.evil.test/', 'https://evil.test/accounts.google.com', 'https://accounts.google.com@evil.test/', 'https://user@accounts.google.com/', 'https://www.accounts.google.com/', 'https://www.google.com/', 'https://www.youtube.com/', 'about:blank', null]) {
    assert.equal(googleAccountPage(url), false, String(url));
    assert.equal(nativeAuthenticationContext('https://example.com/', url), false);
  }
});

test('Google authentication receives no language or fingerprint prototype patches, even in strict mode', () => {
  const auth = 'https://accounts.google.com/v3/signin/identifier';
  assert.equal(scriptFor(['fr'], { topUrl: auth }), '');
  assert.equal(scriptFor(['fr'], { topUrl: 'https://www.youtube.com/', frameUrl: auth }), '');
  for (const level of ['standard', 'strict']) {
    const farbling = createFarbling({ getLevel: () => level });
    assert.equal(farbling.scriptFor(auth), '');
    assert.equal(farbling.scriptFor('https://www.youtube.com/', auth), '');
    assert.equal(farbling.scriptFor(auth, 'https://www.gstatic.com/frame'), '');
    assert.notEqual(farbling.scriptFor(auth, auth, { allowNativeAuthentication: false }), '', 'Tor retains fingerprint protection');
    assert.notEqual(farbling.scriptFor('https://accounts.google.com.evil.test/'), '');
    const requestHeaders = { 'Sec-CH-UA-Full-Version-List': 'native', 'Sec-CH-UA-Arch': 'arm', Cookie: 'synthetic' };
    assert.deepEqual(reduceClientHints({ url: auth, referrer: 'https://www.youtube.com/', requestHeaders }, level), {});
    assert.deepEqual(reduceClientHints({ url: 'https://www.gstatic.com/probe', referrer: auth, requestHeaders }, level), {});
    assert.equal(requestHeaders.Cookie, 'synthetic');
  }
  assert.notEqual(scriptFor(['fr'], { topUrl: 'https://example.com/' }), '');
  assert.notEqual(scriptFor(['en-US'], { topUrl: auth, allowNativeAuthentication: false }), '', 'Tor retains its language policy');
  assert.ok(reduceClientHints({ url: 'https://example.com/', requestHeaders: { 'Sec-CH-UA-Arch': 'arm' } }, 'strict').requestHeaders);
});

test('website languages keep their preference without modifying UAData or Function.prototype.toString', () => {
  assert.deepEqual(pageLanguages(['fr', 'en']), ['fr', 'en']);
  assert.deepEqual(pageLanguages([]), ['en-US']);
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(`
    class Navigator { get languages() { return ['en-US', 'ar']; } get language() { return 'en-US'; } }
    class NavigatorUAData { get brands() { return [{brand:'Chromium',version:'152'}]; } }
    globalThis.Navigator = Navigator; globalThis.NavigatorUAData = NavigatorUAData;
    globalThis.originalBrands = Object.getOwnPropertyDescriptor(NavigatorUAData.prototype, 'brands').get;
    globalThis.originalToString = Function.prototype.toString;
  `, sandbox);
  vm.runInContext(scriptFor(['fr']), sandbox);
  assert.equal(vm.runInContext('new Navigator().language', sandbox), 'fr');
  assert.equal(vm.runInContext('Function.prototype.toString === originalToString', sandbox), true);
  assert.equal(vm.runInContext("Object.getOwnPropertyDescriptor(NavigatorUAData.prototype, 'brands').get === originalBrands", sandbox), true);
});

test('Tor keeps the identity it always had: no Acira token, its own brands, and ordinary sessions never get them', () => {
  const { torUserAgent, applyTorUserAgent } = require('../desktop/browser-services/user-agent.cjs');
  const clean = `${base} Chrome/152.0.0.0 Safari/537.36`, branded = chromeUserAgent(sample);
  assert.match(branded, /AciraBrowser\//);
  assert.equal(torUserAgent(branded), clean);
  let set; applyTorUserAgent({ getUserAgent: () => branded, setUserAgent: value => { set = value; } }); assert.equal(set, clean);
  set = null; applyTorUserAgent({ getUserAgent: () => clean, setUserAgent: value => { set = value; } }); assert.equal(set, null, 'already clean: left alone');
  const tor = require('../desktop/browser-services/tor-identity.cjs'), identity = tor.createIdentity('152.0.7977.167');
  assert.equal(identity.secChUa, '"Chromium";v="152", "Not?A_Brand";v="24", "Google Chrome";v="152"');
  assert.match(tor.scriptFor(identity, ['en-US']), /Google Chrome/);
  const main = fs.readFileSync(path.join(__dirname, '../desktop/main.cjs'), 'utf8'), windows = fs.readFileSync(path.join(__dirname, '../desktop/browser-services/tor-window.cjs'), 'utf8'), engine = fs.readFileSync(path.join(__dirname, '../desktop/browser-services/tor-engine.cjs'), 'utf8');
  assert.match(main, /torIdentitySession\(wc\.session\)/);
  const handler = main.indexOf("ipcMain.on('acira:chrome-identity'");
  assert.ok(handler > 0 && handler < main.indexOf('function createBrowserWindow('), 'one app-wide answer: a per-window handler answered nothing for windows after the first');
  assert.equal(main.split("ipcMain.on('acira:chrome-identity'").length, 2);
  assert.match(main, /if\(!torIdentitySession\(ses\)\)return require\('\.\/browser-services\/chrome-identity\.cjs'\)\.addNativeHints\(details\)/);
  assert.match(windows, /applyTorUserAgent\(session\)/, 'every locked Tor session');
  assert.match(engine, /applyTorUserAgent\(ses\)/, "the engine's own requests");
});

test('hints a page request lacks are added with the engine values; application requests and insecure pages are left alone', () => {
  const { addNativeHints, nativeBrands } = require('../desktop/browser-services/chrome-identity.cjs');
  assert.equal(nativeBrands('152.0.7977.167'), '"Not?A_Brand";v="24", "Chromium";v="152"');
  const page = { url: 'https://example.com/', resourceType: 'mainFrame', requestHeaders: { Accept: '*/*' } };
  assert.deepEqual(addNativeHints(page, '152.0.7977.167', 'win32').requestHeaders, { Accept: '*/*', 'Sec-CH-UA': nativeBrands('152'), 'Sec-CH-UA-Mobile': '?0', 'Sec-CH-UA-Platform': '"Windows"' });
  assert.deepEqual(addNativeHints({ ...page, requestHeaders: { 'sec-ch-ua': 'x', 'sec-ch-ua-mobile': '?0', 'sec-ch-ua-platform': 'y' } }, '152', 'win32'), {}, 'never rewrites what Chromium sent');
  assert.deepEqual(addNativeHints({ url: 'https://example.com/', requestHeaders: {} }, '152', 'win32'), {}, 'no page behind it');
  assert.deepEqual(addNativeHints({ ...page, url: 'http://example.com/' }, '152', 'win32'), {}, 'not a secure origin');
});

test('production wiring registers language preferences without identity header rewriting; the preload stays separate from bundled policy', () => {
  const main = fs.readFileSync(path.join(__dirname, '../desktop/main.cjs'), 'utf8');
  const bundle = fs.readFileSync(path.join(__dirname, '../scripts/desktop-bundle.mjs'), 'utf8');
  assert.match(main, /applyWebsiteLanguages\(ses,pipeline,languageOptions\.tor\|\|torMode\)/);
  assert.doesNotMatch(main, /createIdentity\(process\.versions\.chrome\)|sendHeaders\(chromeIdentity/);
  assert.match(main, /topUrl:wc\.getURL\(\),frameUrl:url/);
  assert.ok(bundle.includes('chrome-identity-preload.cjs'));
  assert.ok(!bundle.includes("'desktop/browser-services/chrome-identity.cjs'"), 'policy is inlined into main, not copied as a sandboxed preload');
});

test('WhatsApp Web refuses an unknown product token: only its host gets the token-free string, and a tab gets its own back when it leaves', () => {
  const { EventEmitter } = require('node:events');
  const { tokenIntolerantUrl, sendHeaders } = require('../desktop/browser-services/site-user-agent.cjs');
  const own = chromeUserAgent(sample), plain = `${base} Chrome/152.0.0.0 Safari/537.36`;
  assert.equal(own, `${plain} AciraBrowser/${appVersion}`);
  for (const url of ['https://web.whatsapp.com/', 'https://web.whatsapp.com/login/?x=1', 'wss://web.whatsapp.com/ws/chat']) assert.equal(tokenIntolerantUrl(url), true, url);
  for (const url of ['http://web.whatsapp.com/', 'https://web.whatsapp.com.evil.test/', 'https://evil.test/web.whatsapp.com', 'https://web.whatsapp.com@evil.test/', 'https://www.whatsapp.com/', 'https://static.whatsapp.net/', 'https://example.com/', 'about:blank', '', null, undefined]) assert.equal(tokenIntolerantUrl(url), false, String(url));
  const tab = () => { const value = new EventEmitter(); Object.assign(value, { ua: own, session: { getUserAgent: () => own }, setUserAgent(next) { value.ua = next; }, isDestroyed: () => false }); return value; };
  const request = (url, extra = {}) => ({ url, resourceType: 'mainFrame', requestHeaders: { 'user-agent': own, Accept: '*/*' }, ...extra });
  const session = { getUserAgent: () => own };
  const navigate = (contents, url, extra = {}) => contents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false, url, ...extra });

  // The wire: any request to the host, from a page, a worker or a socket, loses only the Acira token; everything else is left exactly alone.
  assert.deepEqual(sendHeaders(request('https://web.whatsapp.com/sw.js', { resourceType: 'serviceWorker' }), session).requestHeaders, { 'user-agent': plain, Accept: '*/*' });
  assert.deepEqual(sendHeaders(request('wss://web.whatsapp.com/ws/chat', { resourceType: 'webSocket' }), session).requestHeaders, { 'user-agent': plain, Accept: '*/*' });
  assert.deepEqual(sendHeaders(request('https://example.com/app.js', { resourceType: 'script' }), session), {});
  assert.deepEqual(sendHeaders(request('https://static.whatsapp.net/x.js', { resourceType: 'script' }), session), {});
  assert.deepEqual(sendHeaders({ url: 'https://web.whatsapp.com/', resourceType: 'mainFrame' }, session), {}, 'no headers, nothing to do');
  assert.deepEqual(sendHeaders({ ...request('https://web.whatsapp.com/'), requestHeaders: { Accept: '*/*' } }, session), {}, 'no User-Agent header to change');
  assert.deepEqual(sendHeaders({ ...request('https://web.whatsapp.com/'), requestHeaders: { 'User-Agent': plain } }, session), {}, 'already token-free');

  // A tab that never met the host is never touched, and does not even get a listener.
  const bystander = tab();
  assert.deepEqual(sendHeaders(request('https://example.com/', { webContents: bystander }), session), {});
  assert.equal(bystander.ua, own); assert.equal(bystander.listenerCount('did-start-navigation'), 0);

  // The tab: the first top-level request sets its own string and starts it following its main-frame navigations.
  const page = tab();
  assert.equal(sendHeaders(request('https://web.whatsapp.com/', { webContents: page }), session).requestHeaders['user-agent'], plain);
  assert.equal(page.ua, plain, 'navigator.userAgent agrees with the wire');
  sendHeaders(request('https://web.whatsapp.com/', { webContents: page }), session);
  assert.equal(page.listenerCount('did-start-navigation'), 1, 'followed once, not once per request');
  assert.equal(page.listenerCount('did-redirect-navigation'), 1);
  navigate(page, 'https://web.whatsapp.com/', { isSameDocument: true }); assert.equal(page.ua, plain);
  navigate(page, 'https://example.com/', { isSameDocument: true }); assert.equal(page.ua, plain, 'an in-page change is not a navigation');
  navigate(page, 'https://example.com/', { isMainFrame: false }); assert.equal(page.ua, plain, 'a frame is not the tab');
  navigate(page, 'https://example.com/'); assert.equal(page.ua, own, 'leaving restores the session string before the next page exists');
  navigate(page, 'https://web.whatsapp.com/'); assert.equal(page.ua, plain, 'coming back');
  page.emit('did-redirect-navigation', { isMainFrame: true, isSameDocument: false, url: 'https://example.org/away' }); assert.equal(page.ua, own, 'a redirect away');
  page.emit('did-redirect-navigation', { isMainFrame: true, isSameDocument: false, url: 'https://web.whatsapp.com/' }); assert.equal(page.ua, plain, 'a redirect to the host');
  assert.equal(page.listenerCount('did-start-navigation'), 1);

  // The request that leaves: Chromium built its headers before the tab was told, so it still carries the token-free string; it is put right.
  navigate(page, 'https://web.whatsapp.com/'); assert.equal(page.ua, plain);
  navigate(page, 'https://example.com/'); assert.equal(page.ua, own);
  const leaving = sendHeaders(request('https://example.com/', { webContents: page, requestHeaders: { 'user-agent': plain, Accept: '*/*' } }), session);
  assert.deepEqual(leaving.requestHeaders, { 'user-agent': own, Accept: '*/*' });
  assert.deepEqual(sendHeaders(request('https://example.com/', { webContents: page }), session), {}, 'a request already carrying the session string is left alone');
  assert.deepEqual(sendHeaders(request('https://example.com/', { webContents: page, requestHeaders: { 'user-agent': 'curl/8.0' } }), session), {}, 'a string that is not the token-free form of the session\'s is never replaced');
  // ... and when the navigation event was missed altogether, the request and the tab are both put right.
  navigate(page, 'https://web.whatsapp.com/'); assert.equal(page.ua, plain);
  const missed = sendHeaders(request('https://example.org/', { webContents: page, requestHeaders: { 'user-agent': plain } }), session);
  assert.equal(missed.requestHeaders['user-agent'], own); assert.equal(page.ua, own);
  const subresource = sendHeaders(request('https://example.org/a.js', { webContents: page, resourceType: 'script', requestHeaders: { 'user-agent': plain } }), session);
  assert.deepEqual(subresource, {}, 'only top-level navigations are corrected');

  // The tab is found through its id when the details carry no object, and a destroyed or odd tab never throws.
  const byId = tab();
  assert.equal(sendHeaders(request('https://web.whatsapp.com/', { webContentsId: 7 }), session, details => (details.webContentsId === 7 ? byId : null)).requestHeaders['user-agent'], plain);
  assert.equal(byId.ua, plain);
  const gone = tab(); gone.isDestroyed = () => true;
  assert.equal(sendHeaders(request('https://web.whatsapp.com/', { webContents: gone }), session).requestHeaders['user-agent'], plain);
  assert.equal(gone.ua, own, 'a destroyed tab is left alone'); assert.equal(gone.listenerCount('did-start-navigation'), 0);
  const refusing = tab(); refusing.setUserAgent = () => { throw new Error('closing'); };
  assert.equal(sendHeaders(request('https://web.whatsapp.com/', { webContents: refusing }), session).requestHeaders['user-agent'], plain, 'the header layer still works');
  assert.equal(sendHeaders(request('https://web.whatsapp.com/'), session).requestHeaders['user-agent'], plain, 'no tab behind it (a worker)');

  // Wiring: ordinary sessions only (Tor has no token), registered with the identity hook, one place.
  const main = fs.readFileSync(path.join(__dirname, '../desktop/main.cjs'), 'utf8');
  assert.match(main, /pipeline\.useSendHeaders\(details=>torIdentitySession\(ses\)\?\{\}:require\('\.\/browser-services\/site-user-agent\.cjs'\)\.sendHeaders\(details,ses\)\)/);
  assert.equal(main.split('site-user-agent.cjs').length, 2);
  assert.ok(main.indexOf('addNativeHints(details)') < main.indexOf('site-user-agent.cjs'), 'runs after the identity hints are in place');
});

let result, problem;
let electron;
try { electron = require('electron'); if (typeof electron !== 'string' || !fs.existsSync(electron)) electron = null; } catch {}
if (electron) {
  const env = { ...process.env, ELECTRON_ENABLE_LOGGING: '0', UA_FIXTURE_SUBFRAMES: '1' };
  delete env.ELECTRON_RUN_AS_NODE; delete env.ACIRA_KEEP_ELECTRON_UA; delete env.UA_FIXTURE_NATIVE;
  const run = spawnSync(electron, [path.join(__dirname, 'fixtures/user-agent/run.cjs')], { encoding: 'utf8', timeout: 120000, env });
  const line = (run.stdout || '').split(/\r?\n/).find(value => value.startsWith('RESULT '));
  if (run.status === 0 && line) result = JSON.parse(line.slice(7));
  else problem = ((run.stdout || '') + (run.stderr || '')).slice(-3000) || 'native fixture did not finish';
}
const skip = !electron ? 'Electron binary unavailable' : false;
const actual = () => { assert.ok(result, problem); return result; };

test('real Electron fixture completes across two persistent profiles, default, private, Peek and popups', { skip }, () => {
  assert.deepEqual(actual().sessions.map(item => item.label), ['default', 'profile', 'profile-2', 'private', 'peek']);
  for (const item of actual().sessions) assert.ok(item.popup?.sameSession, item.label);
});

test('real pages, frames, dedicated workers and service workers report identical native brands', { skip }, () => {
  for (const item of actual().sessions) for (const page of [item.page, item.second]) {
    assert.ok(page.brands.some(brand => brand.brand === 'Chromium' && brand.version === actual().chrome.split('.')[0]));
    assert.ok(!page.brands.some(brand => brand.brand === 'Google Chrome'), 'Acira does not claim the Google Chrome brand');
    assert.deepEqual(page.worker?.brands, page.brands, item.label + ' dedicated worker');
    assert.deepEqual(page.serviceWorker?.brands, page.brands, item.label + ' service worker');
    assert.deepEqual(page.frameInfo?.brands, page.brands, item.label + ' iframe');
    assert.deepEqual(page.json.brands, page.brands);
    assert.deepEqual(page.high.brands, page.brands);
    assert.equal(page.high.fullVersionList.find(brand => brand.brand === 'Chromium').version, actual().chrome);
  }
});

test('real request Client Hints agree with native page brands wherever the engine supplies them', { skip }, () => {
  const data = actual();
  const native = data.sessions[0].page.brands.map(item => `"${item.brand}";v="${item.version}"`).join(', ');
  const hints = data.requests.filter(request => request.headers['sec-ch-ua']);
  assert.ok(hints.length >= data.sessions.length, 'native renderer Client Hints were captured');
  const documents = data.requests.filter(request => ['document', 'iframe', 'worker', 'serviceworker'].includes(request.headers['sec-fetch-dest']));
  assert.ok(documents.some(request => request.headers['sec-fetch-dest'] === 'document') && documents.some(request => request.headers['sec-fetch-dest'] === 'iframe') && documents.some(request => request.headers['sec-fetch-dest'] === 'worker'));
  for (const request of documents) { assert.equal(request.headers['sec-ch-ua'], native, 'page, frame and worker requests carry the engine\'s brands: ' + request.path); assert.equal(request.headers['sec-ch-ua-mobile'], '?0'); assert.ok(request.headers['sec-ch-ua-platform']); }
  for (const request of hints) assert.equal(request.headers['sec-ch-ua'], native, request.label + request.path);
  for (const request of data.requests.filter(request => request.headers['sec-ch-ua-full-version-list'])) assert.doesNotMatch(request.headers['sec-ch-ua-full-version-list'], /Google Chrome/);
});

test('every native session, page, worker, popup and request identifies Acira using the same actual UA', { skip }, () => {
  const data = actual();
  assert.ok(data.fallback.endsWith(' AciraBrowser/' + appVersion));
  for (const item of data.sessions) {
    assert.equal(item.sessionUa, data.fallback); assert.equal(item.wcUa, data.fallback);
    assert.equal(item.popup.ua, data.fallback); assert.equal(item.popup.wcUa, data.fallback);
    assert.equal(item.mainFetch, 200);
    for (const page of [item.page, item.second]) {
      assert.equal(page.ua, data.fallback); assert.equal(page.worker.ua, data.fallback);
      assert.equal(page.webdriver, false); assert.equal(page.hasProcess, false); assert.equal(page.hasRequire, false);
      assert.deepEqual(page.languages, ['en-US']);
    }
  }
  for (const request of data.requests) assert.equal(request.headers['user-agent'], data.fallback, request.path);
});
