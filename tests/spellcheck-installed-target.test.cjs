'use strict';
// 28 Oct: requiring packaging/ from this module stopped the installed app (no packaging/ folder) before its first window.
// In the installed app the dictionary location comes from resources/app-update.yml; it never falls back to Google's CDN.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sp = require('../desktop/browser-services/spellcheck-dictionaries.cjs');

test('the dictionary folder is read from an installed app-update.yml (github and generic)', () => {
  assert.equal(sp.dictionaryURLFromUpdateConfig('owner: Acira-dev\nrepo: acira-releases\nprovider: github\n'), 'https://github.com/Acira-dev/acira-releases/releases/download/spellcheck-dictionaries/');
  assert.equal(sp.dictionaryURLFromUpdateConfig('provider: generic\nurl: https://dl.example.com/acira/\n'), 'https://dl.example.com/acira/spellcheck-dictionaries/');
  assert.equal(sp.dictionaryURLFromUpdateConfig('provider: generic\nurl: https://raw.githubusercontent.com/Acira-dev/AciraBrowserUpdates/main/feed/\nchannel: latest\n'), 'https://raw.githubusercontent.com/Acira-dev/AciraBrowserUpdates/main/feed/spellcheck-dictionaries/');
  assert.equal(sp.dictionaryURLFromUpdateConfig(''), '');
  assert.equal(sp.dictionaryURLFromUpdateConfig('url: http://insecure.example.com\n'), '');
});

test('from source, the dictionary host is the public update feed folder, the same one an installed app derives from app-update.yml', () => {
  const { loadReleaseTarget } = require('../packaging/release-target.cjs'), { DEFAULT_FEED_URL } = require('../packaging/update-feed.cjs');
  assert.equal(sp.RELEASE_URL, `${DEFAULT_FEED_URL}spellcheck-dictionaries/`);
  assert.equal(sp.dictionaryURLFromUpdateConfig(`provider: generic\nurl: ${loadReleaseTarget().url}\n`), sp.RELEASE_URL);
});

test('with no known location, downloads go to a closed local port, never Google', () => {
  let set; sp.secureSpellcheckDownloads({ setSpellCheckerDictionaryDownloadURL: u => { set = u; } }, '');
  assert.equal(set, 'http://127.0.0.1:9/');
});

test('no runtime module requires packaging/ at load time without a fallback', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'browser-services', 'spellcheck-dictionaries.cjs'), 'utf8');
  assert.match(src, /try \{ const \{ loadReleaseTarget, dictionaryUrl \} = require\('\.\.\/\.\.\/packaging\/release-target\.cjs'\);/);
  assert.doesNotMatch(src, /^const \{[^}]*\} = require\('\.\.\/\.\.\/packaging\//m);
});
