'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), { EventEmitter } = require('node:events');
const { RELEASE_URL, dictionaryBaseURL, secureSpellcheckDownloads, installSpellcheckDownloads } = require('../desktop/browser-services/spellcheck-dictionaries.cjs');

const google = url => /(^|\.)(google|googleapis|gvt1|gstatic|googleusercontent)\.com$/i.test(new URL(url).hostname);
const fakeSession = () => ({ urls: [], setSpellCheckerDictionaryDownloadURL(url) { this.urls.push(url); } });

test('dictionaries come from Acira, never from Google', () => {
  assert.equal(dictionaryBaseURL({}), RELEASE_URL);
  assert.equal(google(RELEASE_URL), false);
  assert.ok(RELEASE_URL.startsWith('https://') && RELEASE_URL.endsWith('/'));
});

test('every session is pointed at Acira as it is created, and the default one if it exists', () => {
  const app = new EventEmitter(); app.isReady = () => true;
  const defaultSession = fakeSession();
  installSpellcheckDownloads(app, { defaultSession }, dictionaryBaseURL({}));
  const sessions = [fakeSession(), fakeSession(), fakeSession()];
  for (const session of sessions) app.emit('session-created', session);
  for (const session of [defaultSession, ...sessions]) {
    assert.equal(session.urls.length, 1);
    assert.equal(google(session.urls[0]), false);
  }
});

test('a session created before ready is covered by the hook, not by a second call', () => {
  const app = new EventEmitter(); app.isReady = () => false;
  const defaultSession = fakeSession();
  installSpellcheckDownloads(app, { defaultSession });
  assert.equal(defaultSession.urls.length, 0);
  app.emit('session-created', defaultSession);
  assert.deepEqual(defaultSession.urls, [RELEASE_URL]);
  app.emit('session-created', {}); // a session without spelling support does not throw
});

test('the test/mirror override accepts https or this computer only', () => {
  assert.equal(dictionaryBaseURL({ ACIRA_SPELLCHECK_DICTIONARY_URL: 'http://127.0.0.1:4555/d' }), 'http://127.0.0.1:4555/d/');
  assert.equal(dictionaryBaseURL({ ACIRA_SPELLCHECK_DICTIONARY_URL: 'https://mirror.example/dicts/' }), 'https://mirror.example/dicts/');
  assert.equal(dictionaryBaseURL({ ACIRA_SPELLCHECK_DICTIONARY_URL: 'http://mirror.example/dicts/' }), RELEASE_URL);
  assert.equal(dictionaryBaseURL({ ACIRA_SPELLCHECK_DICTIONARY_URL: 'file:///C:/dicts/' }), RELEASE_URL);
  assert.equal(dictionaryBaseURL({ ACIRA_SPELLCHECK_DICTIONARY_URL: 'https://u:p@mirror.example/' }), RELEASE_URL);
  assert.equal(secureSpellcheckDownloads(null), false);
});
