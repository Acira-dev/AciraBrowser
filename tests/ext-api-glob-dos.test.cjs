'use strict';
// A pattern an extension writes must not be able to freeze the browser's main process. Match-pattern paths, title patterns, user-script globs and
// permission containment used to become regular expressions ('*' -> '.*'); with a few stars the matching time grows with the n-th power of
// the text, which the extension also controls (the address or title of a tab it opened, its own downloads). downloads.search took the
// extension's own regular expression. Both are now bounded.
const test = require('node:test');
const assert = require('node:assert/strict');
const {globMatch} = require('../desktop/browser-services/glob-match.cjs');
const {compilePattern, urlParts} = require('../desktop/browser-services/ext-api/web-request/patterns.cjs');
const {patternCovers, originsCoverUrl} = require('../desktop/browser-services/extension-permission-table.cjs');
const {matchesPattern} = require('../desktop/browser-services/user-scripts.cjs');
const items = require('../desktop/browser-services/ext-api/downloads/item.cjs');
const {createRig} = require('./fixtures/ext-api-tabs/rig.cjs');
const {plain} = require('./fixtures/ext-api/world.cjs');

const STARS = '*a'.repeat(24) + '*b';             // twenty-four stars: effectively endless as a regular expression
const LONG = 'a'.repeat(3000);
const fast = (run, limitMs = 1500) => { const start = Date.now(); const value = run(); const took = Date.now() - start; assert.ok(took < limitMs, `took ${took} ms`); return value; };

test('globMatch: * is any run (newlines included), ? one character when asked, the rest is literal, both ends anchored', () => {
  assert.equal(globMatch('/*', '/anything?x=1'), true);
  assert.equal(globMatch('/a*c', '/abc'), true);
  assert.equal(globMatch('/a*c', '/abd'), false);
  assert.equal(globMatch('*', ''), true);
  assert.equal(globMatch('a*', 'a\nb'), true, 'the s flag: a title with a line break still matches');
  assert.equal(globMatch('a.c', 'abc'), false, 'a dot is a dot');
  assert.equal(globMatch('a?c', 'abc'), false, '? is literal unless single is set');
  assert.equal(globMatch('a?c', 'abc', {single: true}), true);
  assert.equal(globMatch('a?c', 'ac', {single: true}), false);
  assert.equal(globMatch('**x**', 'x'), true);
  assert.equal(globMatch('a*b*c', 'a-b-b-c'), true);
  assert.equal(globMatch('a*b*c', 'a-c-b'), false);
  assert.equal(globMatch('[a]+(b){2}|^$', '[a]+(b){2}|^$'), true, 'regex syntax characters are literal');
});

test('a pattern with many stars against a long text answers at once', () => {
  assert.equal(fast(() => globMatch('/' + STARS, '/' + LONG)), false);
  assert.equal(fast(() => globMatch('/' + STARS, '/' + LONG + 'b')), true);
  assert.equal(fast(() => globMatch(STARS, LONG, {single: true})), false);
});

test('tabs.query: a url or title pattern of many stars cannot hang the main process', async () => {
  const rig = createRig({manifest: {manifest_version: 3, permissions: ['tabs']}});
  const window = rig.addWindow({focused: true});
  rig.addTab(window, {url: 'https://example.com/' + LONG, title: LONG});
  const started = Date.now();
  assert.deepEqual(plain(await rig.world.chrome.tabs.query({url: 'https://*/*' + STARS})), []);
  assert.deepEqual(plain(await rig.world.chrome.tabs.query({title: STARS})), []);
  assert.equal(plain(await rig.world.chrome.tabs.query({url: 'https://*/*' + STARS.replace(/b$/, '')})).length, 1, 'and the same pattern without the b matches');
  assert.ok(Date.now() - started < 3000, `took ${Date.now() - started} ms`);
});

test('webRequest filters, host-permission containment and user-script / menu patterns are linear too', () => {
  const pattern = 'https://*/' + STARS, parts = urlParts('https://example.com/' + LONG);
  assert.equal(fast(() => compilePattern(pattern)(parts)), false);
  assert.equal(fast(() => compilePattern('https://*/*')(parts)), true);
  assert.equal(fast(() => patternCovers('https://*/' + STARS, 'https://example.com/' + LONG)), false);
  assert.equal(fast(() => originsCoverUrl(['https://*/' + STARS], 'https://example.com/' + LONG)), false);
  assert.equal(patternCovers('https://*.example.com/*', 'https://www.example.com/a/b'), true, 'ordinary containment is unchanged');
  assert.equal(patternCovers('https://example.com/a/*', 'https://example.com/b/x'), false);
  assert.equal(fast(() => matchesPattern('https://*/' + STARS, 'https://example.com/' + LONG)), false);
  assert.equal(matchesPattern('https://*/*', 'https://example.com/' + LONG), true);
});

test('downloads.search: filenameRegex / urlRegex run with a time limit; catastrophic backtracking is "Invalid query filter"', () => {
  const record = {id: 1, url: 'https://example.com/' + LONG + '!', finalUrl: 'https://example.com/' + LONG + '!', filename: 'C:\\dl\\' + LONG + '!'};
  const list = [record];
  const started = Date.now();
  assert.throws(() => items.search(list, {urlRegex: '^https://example\\.com/(a+)+$'}), /Invalid query filter/);
  assert.throws(() => items.search(list, {filenameRegex: '^C:\\\\dl\\\\(a+)+$'}), /Invalid query filter/);
  assert.ok(Date.now() - started < 1500, `took ${Date.now() - started} ms`);
  // an ordinary expression still works, and so do the errors Chromium gives for a bad one
  const ok = [{id: 1, url: 'https://example.com/a.zip', finalUrl: 'https://example.com/a.zip', filename: 'C:\\dl\\a.zip'}, {id: 2, url: 'https://example.com/b.txt', finalUrl: 'https://example.com/b.txt', filename: 'C:\\dl\\b.txt'}];
  assert.deepEqual(items.search(ok, {filenameRegex: '\\.zip$'}).map(item => item.id), [1]);
  assert.deepEqual(items.search(ok, {urlRegex: '^https://example\\.com/[ab]\\.'}).map(item => item.id), [1, 2]);
  assert.throws(() => items.search(ok, {urlRegex: '('}), /Invalid query filter/);
  assert.throws(() => items.search(ok, {urlRegex: 'a'.repeat(5000)}), /Invalid query filter/);
});
