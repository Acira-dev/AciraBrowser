'use strict';
// R3-58 / R3-63: what websites see (status), and Google's page language (hl) from the website language, only where the person has not chosen.
const { test } = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { target, hlFor, hasOwnChoice, attach } = require('../desktop/browser-services/google-language.cjs');
const { createWebsiteLanguages } = require('../desktop/browser-services/website-languages.cjs');

test('hl is the language the website language sends: region only where Google needs it', () => {
  assert.deepEqual(['en-US', 'en', 'fr-CA', 'pt-BR', 'pt-PT', 'pt', 'zh-CN', 'zh-TW', 'ar-SA', 'tr', 'ja'].map(hlFor), ['en', 'en', 'fr', 'pt-BR', 'pt-PT', 'pt', 'zh-CN', 'zh-TW', 'ar', 'tr', 'ja']);
  for (const bad of ['', 'x', '123', 'a_b', null, undefined, {}]) assert.equal(hlFor(bad), '', String(bad));
});

test('only https Google home and search pages without hl are changed; nothing else is touched', () => {
  assert.equal(target('https://www.google.com/', 'en'), 'https://www.google.com/?hl=en');
  assert.equal(target('https://www.google.com/search?q=cats', 'en'), 'https://www.google.com/search?q=cats&hl=en');
  assert.equal(target('https://google.com.lb/search?q=a%20b&tbm=isch', 'fr'), 'https://google.com.lb/search?q=a%20b&tbm=isch&hl=fr');
  assert.equal(target('https://www.google.co.uk/', 'en'), 'https://www.google.co.uk/?hl=en');
  for (const skipped of [
    'https://www.google.com/search?q=cats&hl=fr',            // the person or a link already chose
    'http://www.google.com/',                                  // plain http is never rewritten
    'https://mail.google.com/', 'https://accounts.google.com/', 'https://docs.google.com/', 'https://www.google.com/maps', 'https://www.google.com/account', // other Google pages and sign-in
    'https://www.google.com.evil.example/', 'https://notgoogle.com/', 'https://www.google.com:8443/', 'https://user:pw@www.google.com/', 'https://google.evil/',
    'not a url', '']) assert.equal(target(skipped, 'en'), null, skipped);
  assert.equal(target('https://www.google.com/', ''), null, 'no language, no change');
});

test('a Google PREF cookie with hl, or a signed-in cookie, means the person already chose: nothing is added', () => {
  assert.equal(hasOwnChoice([{ name: 'PREF', value: 'tz=Asia.Beirut&hl=fr&f6=40000000' }]), true);
  assert.equal(hasOwnChoice([{ name: 'PREF', value: 'hl=ar' }]), true);
  assert.equal(hasOwnChoice([{ name: 'PREF', value: 'tz=Asia.Beirut&f6=40000000' }]), false, 'a PREF without a language is not a choice');
  assert.equal(hasOwnChoice([{ name: 'PREF', value: 'xhl=1' }]), false);
  for (const name of ['SID', '__Secure-1PSID', '__Secure-3PSID', 'SAPISID']) assert.equal(hasOwnChoice([{ name, value: 'x' }]), true, name);
  assert.equal(hasOwnChoice([{ name: 'NID', value: 'x' }, { name: 'AEC', value: 'y' }]), false);
  assert.equal(hasOwnChoice([]), false);
});

function harness({ languages = ['en-US'], cookies = [] } = {}) {
  let handler; const asked = [];
  attach({ cookies: { get: async (filter) => { asked.push(filter); if (cookies instanceof Error) throw cookies; return cookies; } } }, { useBefore: (fn) => { handler = fn; } }, () => languages);
  return { run: (details) => handler({ resourceType: 'mainFrame', method: 'GET', ...details }), asked };
}
test('the request hook redirects a top-level Google visit once, never other requests, and fails open on any trouble', async () => {
  const h = harness();
  assert.deepEqual(await h.run({ url: 'https://www.google.com/search?q=x' }), { redirectURL: 'https://www.google.com/search?q=x&hl=en' });
  assert.deepEqual(h.asked, [{ url: 'https://www.google.com/search?q=x' }], 'cookies are read for that URL only, never written');
  assert.deepEqual(await h.run({ url: 'https://www.google.com/search?q=x&hl=en' }), {}, 'no redirect loop');
  assert.deepEqual(await h.run({ url: 'https://www.google.com/', resourceType: 'script' }), {}, 'only the top-level page');
  assert.deepEqual(await h.run({ url: 'https://www.google.com/', method: 'POST' }), {}, 'only GET');
  assert.deepEqual(await h.run({ url: 'https://example.org/' }), {});
  assert.deepEqual(await harness({ cookies: [{ name: 'PREF', value: 'hl=fr' }] }).run({ url: 'https://www.google.com/' }), {}, 'the person chose French on Google');
  assert.deepEqual(await harness({ cookies: [{ name: 'SID', value: 'x' }] }).run({ url: 'https://www.google.com/' }), {}, 'signed in: the account decides');
  assert.deepEqual(await harness({ cookies: new Error('cookie store busy') }).run({ url: 'https://www.google.com/' }), {}, 'cookie trouble changes nothing');
  assert.deepEqual(await harness({ languages: [] }).run({ url: 'https://www.google.com/' }), {});
  assert.deepEqual(await harness({ languages: ['pt-BR', 'en'] }).run({ url: 'https://www.google.com/' }), { redirectURL: 'https://www.google.com/?hl=pt-BR' });
});

function fixture(system) {
  const policies = new Map(), database = { policy: (id) => policies.get(id), setPolicy: (id, _site, value) => policies.set(id, structuredClone(value)), transaction: (run) => run() };
  const service = createWebsiteLanguages({ database, systemLanguages: () => system }), session = () => ({ getUserAgent: () => 'UA', setUserAgent() {} });
  return { service, session, policies };
}
test('"Websites see" shows only the first system language by default (Chromium reduces the header), and the whole list only when chosen', () => {
  const f = fixture(['en-US', 'ar-SA']), s = f.session();
  const initial = f.service.attach(s, 'a');
  assert.deepEqual(initial.current, ['en-US', 'ar-SA'], 'the raw list the engine was given');
  assert.deepEqual(initial.visible, ['en-US'], 'what a page can read');
  assert.deepEqual(f.service.pageLanguages(s), initial.visible, 'status and the page agree');
  const chosen = f.service.set(s, ['fr', 'en']);
  assert.deepEqual(chosen.visible, ['en-US'], 'a saved choice waits for a restart');
  assert.deepEqual(chosen.willSee, ['fr', 'en']);
  assert.equal(chosen.restartRequired, true);
  const restarted = createWebsiteLanguages({ database: { policy: (id) => f.policies.get(id), setPolicy() {}, transaction: (run) => run() }, systemLanguages: () => ['en-US', 'ar-SA'] }).attach(f.session(), 'a');
  assert.deepEqual(restarted.visible, ['fr', 'en']);
  assert.deepEqual(restarted.willSee, ['fr', 'en']);
  assert.deepEqual(f.service.attach(f.session(), 'tor-x', { tor: true }).visible, ['en-US', 'en'], 'Tor always shows English');
});

test('the settings row says what websites see in plain words, from the status, in every language', () => {
  const panel = fs.readFileSync(path.join(__dirname, '../src/features/settings/panels/languages.tsx'), 'utf8');
  assert.match(panel, /web\.visible\?\?web\.current/, 'the line shows what a page can read, not the raw system list');
  assert.match(panel, /Intl\.DisplayNames/);
  const forbidden = /request language|page scripts|robot|preference sent|Accept-Language|navigator/i;
  for (const file of fs.readdirSync(path.join(__dirname, '../src/i18n')).filter((name) => name.endsWith('.json') && name !== 'converted.json')) {
    const doc = JSON.parse(fs.readFileSync(path.join(__dirname, '../src/i18n', file), 'utf8'));
    for (const key of ['language.websiteDetail', 'language.websiteHelp', 'language.websiteCurrent', 'language.websiteRestart']) assert.ok(doc[key], file + ' ' + key);
    assert.match(doc['language.websiteCurrent'], /\{languages\}/, file);
    if (file === 'en.json') for (const key of ['language.websiteDetail', 'language.websiteHelp', 'language.websiteCurrent', 'language.websiteRestart']) assert.doesNotMatch(doc[key], forbidden, key);
  }
  assert.equal(JSON.parse(fs.readFileSync(path.join(__dirname, '../src/i18n/en.json'), 'utf8'))['language.websiteCurrent'], 'Websites see: {languages}');
});

test('main attaches the Google language hook once per session, from the profile website language', () => {
  const main = fs.readFileSync(path.join(__dirname, '../desktop/main.cjs'), 'utf8');
  assert.match(main, /googleLanguageAttached\.has\(ses\)/);
  assert.match(main, /google-language\.cjs'\)\.attach\(ses,pipeline,\(\)=>websiteLanguagesService\(\)\.pageLanguages\(ses\)\)/);
});
