'use strict';
// 2 Nov 2026 (jackwestin.com): Phishing.Database listed the storage host nyc3.digitaloceanspaces.com as a whole host, so a study site's question images were blocked, and
// turning the site's protection off did not bring them back: the phishing step ran before, and outside, the per-site switch. A listed page resource now follows the
// switch of the page it is for; the warning before opening a listed page itself does not.
const {test} = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const {createThreatGate} = require('../desktop/browser-services/threat-gate.cjs');

const LISTED = 'nyc3.digitaloceanspaces.com';
const lists = {lookup(address) { const host = new URL(address).hostname; return host === LISTED || host.endsWith('.' + LISTED) ? {kind: 'phishing', list: 'Phishing.Database active domains', host, key: LISTED} : null; }};
const image = {url: 'https://jw-assets.nyc3.digitaloceanspaces.com/dda/content/questions/a.jpg', resourceType: 'image'};

test('a listed page resource is blocked while the site is protected and loads once its protection is off', () => {
  const gate = createThreatGate({lists}), wc = {id: 7};
  assert.deepEqual(gate.check(image, wc, 'p1', {pageProtected: () => true}), {cancel: true});
  assert.deepEqual(gate.check(image, wc, 'p1'), {cancel: true}, 'callers that pass no switch keep blocking');
  for (const resourceType of ['image', 'script', 'subFrame', 'xhr', 'media'])
    assert.deepEqual(gate.check({...image, resourceType}, wc, 'p1', {pageProtected: () => false}), {}, resourceType + ' passes with protection off');
  assert.equal(gate.stats().blocked, 2, 'only real blocks are counted');
});

test('the warning before opening a listed page stays whatever the switch says', () => {
  const gate = createThreatGate({lists}), wc = {id: 8};
  let asked = 0;
  assert.deepEqual(gate.check({url: 'https://evil.nyc3.digitaloceanspaces.com/login', resourceType: 'mainFrame'}, wc, 'p1', {pageProtected: () => { asked++; return false; }}), {cancel: true});
  assert.equal(asked, 0, 'top-level pages never ask the site switch');
  assert.equal(gate.status(8, 'https://evil.nyc3.digitaloceanspaces.com/login').host, 'evil.nyc3.digitaloceanspaces.com');
});

test('the site switch is asked only for listed addresses, so ordinary requests cost no lookup', () => {
  const gate = createThreatGate({lists});
  let asked = 0; const page = () => { asked++; return true; };
  for (let i = 0; i < 50; i++) assert.deepEqual(gate.check({url: 'https://jw-assets.nyc3.cdn.digitaloceanspaces.com/x' + i + '.jpg', resourceType: 'image'}, {id: 9}, 'p1', {pageProtected: page}), {});
  assert.equal(asked, 0);
  gate.check(image, {id: 9}, 'p1', {pageProtected: page});
  assert.equal(asked, 1);
});

// The real siteOff line from content-blocking.cjs, evaluated with stand-ins for its closure (contexts, temporary choices, saved policies).
function siteOffFrom(source, {policies = {}, temporary = new Map(), privateMode = false, siteBlocking = new Map()} = {}) {
  const line = source.split(/\r?\n/).find(text => text.trim().startsWith('const siteOff='));
  assert.ok(line, 'siteOff is defined');
  const origin = value => { try { return new URL(value).origin; } catch { return null; } };
  const session = {}, contexts = new Map([[session, {profileId: 'p1', privateMode, siteBlocking}]]);
  const database = {policy: (profile, site) => policies[profile + '|' + site]};
  const siteOff = new Function('contexts', 'temporary', 'database', 'origin', line.trim() + '\nreturn siteOff;')(contexts, temporary, database, origin);
  return url => siteOff(session, {id: 4, getURL: () => url}, url);
}

test('only protection turned off for the site itself counts, never ad blocking off for the whole profile', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'content-blocking.cjs'), 'utf8');
  const page = 'https://jackwestin.com/daily/x';
  assert.equal(siteOffFrom(source)(page), false, 'nothing chosen');
  assert.equal(siteOffFrom(source, {policies: {'p1|https://jackwestin.com': {blocking: false}}})(page), true, 'the panel switch, saved for the site');
  assert.equal(siteOffFrom(source, {policies: {'p1|https://jackwestin.com': {blocking: true}, 'p1|*': {blocking: false}}})(page), false);
  assert.equal(siteOffFrom(source, {policies: {'p1|*': {blocking: false}}})(page), false, 'Settings > Block ads and trackers off for the profile keeps the phishing check');
  assert.equal(siteOffFrom(source, {policies: {'p1|https://jackwestin.com': {annoyances: true}}})(page), false, 'a banner choice alone is not protection off');
  assert.equal(siteOffFrom(source, {temporary: new Map([['4|https://jackwestin.com', false]])})(page), true, 'a temporary choice for this tab');
  assert.equal(siteOffFrom(source, {privateMode: true, siteBlocking: new Map([['https://jackwestin.com', false]])})(page), true, 'a private window\'s site choice');
  assert.equal(siteOffFrom(source, {policies: {'p1|https://jackwestin.com': {blocking: false}}})('https://other.example/'), false, 'another site keeps it');
  assert.equal(siteOffFrom(source)(''), false, 'a page without a site keeps the check');
});

test('content blocking passes that switch to the phishing step, the banner filter and the panel', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'content-blocking.cjs'), 'utf8');
  const line = source.split(/\r?\n/).find(text => text.includes('threatGate.check('));
  assert.ok(line, 'the phishing step is wired');
  assert.match(line, /threatGate\.check\(details,wc,profileId,\{quiet:privateMode,pageProtected:\(\)=>!siteOff\(session,wc,wc\.getURL\(\)\)\}\)/);
  assert.match(source, /protectionOff:wc=>\{try\{return siteOff\(wc\.session,wc,wc\.getURL\(\)\);\}catch\{return false;\}\}/);
  assert.match(source, /return \{site,blocking:enabled\(wc\.session,wc,wc\.getURL\(\)\),siteOff:siteOff\(wc\.session,wc,wc\.getURL\(\)\),/);
});
