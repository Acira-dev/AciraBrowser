'use strict';
// 2 Nov 2026 (jackwestin.com, beta.6): cookie-banner hiding hid the site's sign-in dialog, and turning the site's protection off did not bring it back, because banner
// hiding and the cookie lists' blocking only followed their own switch. With protection off for a site, its banners show and the cookie lists block nothing there.
const {test} = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const {createOptionalFiltering} = require('../desktop/browser-services/optional-filtering.cjs');

function fixture() {
  const handlers = {}, policies = new Map(), participants = [];
  const database = {policy: (profile, site) => policies.get(profile + '|' + site), setPolicy: (profile, site, value) => { policies.set(profile + '|' + site, value); }, policies: () => []};
  const session = {registerPreloadScript() {}}, wc = {id: 3, session, url: 'https://www.ikea.com/de/de/', getURL() { return this.url; }, isDestroyed: () => false, mainFrame: {send() {}, isDestroyed: () => false}, on() {}, once() {}};
  const protectedSites = new Map(), adsOn = {value: true};
  const optional = createOptionalFiltering({ipcMain: {handle(name, fn) { handlers[name] = fn; }, on() {}}, database, getOwner: () => ({}), resolveContents: () => wc, adsBlocked: () => adsOn.value, protectionOff: page => protectedSites.get(new URL(page.getURL()).origin) === false});
  optional.attach(session, 'profile-1', false, {useBefore(fn) { participants.push(fn); }});
  optional.setProfile('profile-1', {annoyances: true});
  const ask = () => handlers['acira:content-filter-options']({sender: wc, senderFrame: {url: wc.url, isDestroyed: () => false}});
  const dom = () => handlers['acira:content-filter-dom']({sender: wc, senderFrame: {url: wc.url, isDestroyed: () => false}}, {classes: ['grecaptcha-badge'], ids: ['onetrust-banner-sdk']});
  const blocked = url => participants.reduce((out, fn) => out.cancel ? out : fn({url, resourceType: 'script', webContents: wc, referrer: wc.url}), {}).cancel === true;
  return {optional, wc, ask, dom, blocked, adsOn, setProtection: value => protectedSites.set(new URL(wc.url).origin, value)};
}

test('with protection on, a profile that hides banners hides them and the cookie lists block consent managers', async () => {
  const {ask, dom, blocked} = fixture();
  const options = await ask();
  assert.ok(options.annoyanceStyles.length > 0); assert.equal(options.cookieHints, true);
  assert.notEqual(await dom(), '');
  assert.equal(blocked('https://cdn.iubenda.com/cs/iubenda_cs.js'), true);
});

test('with protection off for the site, its banners show and the cookie lists block nothing there; the banner choice itself is kept', async () => {
  const {optional, wc, ask, dom, blocked, setProtection} = fixture();
  setProtection(false);
  const options = await ask();
  assert.equal(options.annoyanceStyles, '', 'no banner CSS');
  assert.equal(options.cookieHints, false, 'no banner watch and so no clean-up of dialogs or scroll locks');
  assert.equal(await dom(), '', 'no later banner rules either');
  assert.equal(blocked('https://cdn.iubenda.com/cs/iubenda_cs.js'), false, 'the consent manager loads and can be answered');
  assert.equal(optional.status(wc).annoyances, true, 'the person\'s banner choice is unchanged');
  setProtection(true);
  assert.ok((await ask()).annoyanceStyles.length > 0, 'turning protection back on brings hiding back');
  assert.equal(blocked('https://cdn.iubenda.com/cs/iubenda_cs.js'), true);
  setProtection(false); wc.url = 'https://www.spiegel.de/';
  assert.equal((await ask()).cookieHints, true, 'another site keeps hiding');
});

test('ad blocking off for the whole profile leaves the profile\'s banner choice alone', async () => {
  const {ask, blocked, adsOn} = fixture();
  adsOn.value = false;
  assert.equal((await ask()).cookieHints, true);
  assert.equal(blocked('https://cdn.iubenda.com/cs/iubenda_cs.js'), true);
});

test('the site panel shows the banner switch off and greyed while the site\'s protection is off', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'features', 'ShieldsSummary.tsx'), 'utf8');
  assert.match(source, /const siteOff=privacy\?\.siteOff===true,/);
  assert.match(source, /label=\{t\("shieldssummary\.hideCookieBannersOnThis"\)\} checked=\{banners&&!siteOff\} disabled=\{busy\|\|!filters\|\|!ready\|\|siteOff\}/);
  const wiring = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'content-blocking.cjs'), 'utf8');
  const call = wiring.split(/\r?\n/).find(text => text.includes('const optionalFilters=createOptionalFiltering({'));
  assert.ok(call && call.includes('protectionOff:wc=>{try{return siteOff(wc.session,wc,wc.getURL());}catch{return false;}}'), 'the panel\'s site switch');
});
