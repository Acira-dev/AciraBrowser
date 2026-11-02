'use strict';
// What an extension can access, in words (install review, permissions.request, "What it can access"): no raw permission names or host patterns in any
// language, host patterns grouped into one line, file addresses left out, and no outdated "availability must be verified" notes (websites hunt, 2 Nov).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const i18n = require('../desktop/i18n.cjs'), tx = require('../desktop/browser-services/tx.cjs');
const {describe, accessLines, PERMISSION_IDS} = require('../desktop/browser-services/extension-manager.cjs');
const {knownPermissions} = require('../desktop/browser-services/extension-permission-table.cjs');
const LOCALES = ['en', 'es', 'fr', 'de', 'pt-BR', 'it', 'ja', 'zh-CN', 'ar', 'tr', 'ru', 'ko', 'hi'];
const catalog = locale => JSON.parse(fs.readFileSync(path.join(__dirname, `../src/i18n/${locale}.json`), 'utf8'));
const use = locale => tx.setTranslator({t: (id, params) => { i18n.setMainLocale(locale, 'en-US'); return i18n.tm(id, params); }, locale: () => i18n.setMainLocale(locale, 'en-US')});
test.after(() => tx.setTranslator(null));
// The manifests of the five Web Store extensions the hunt installed (their permission and host lists).
const DARK_READER = {manifest_version: 3, name: 'Dark Reader', version: '4.9.134', permissions: ['alarms', 'contextMenus', 'storage', 'tabs', 'fontSettings', 'scripting'], host_permissions: ['*://*/*'], content_scripts: [{matches: ['<all_urls>']}]};
const BITWARDEN = {manifest_version: 3, name: 'Bitwarden', version: '2026.10.1', permissions: ['activeTab', 'alarms', 'clipboardRead', 'clipboardWrite', 'contextMenus', 'idle', 'nativeMessaging', 'notifications', 'offscreen', 'scripting', 'storage', 'tabs', 'unlimitedStorage', 'webNavigation', 'webRequest', 'webRequestAuthProvider', 'sidePanel'], host_permissions: ['https://*/*', 'http://*/*'], content_scripts: [{matches: ['*://*/*', 'file:///*']}]};
const UBOL = {manifest_version: 3, name: 'uBlock Origin Lite', version: '2026.1026.1812', permissions: ['activeTab', 'declarativeNetRequest', 'declarativeNetRequestWithHostAccess', 'scripting', 'storage', 'userScripts'], host_permissions: ['<all_urls>']};
const VIMIUM = {manifest_version: 3, name: 'Vimium', version: '2.4.2', permissions: ['tabs', 'bookmarks', 'history', 'storage', 'sessions', 'notifications', 'scripting', 'favicon', 'webNavigation', 'search', 'clipboardRead', 'clipboardWrite'], content_scripts: [{matches: ['<all_urls>']}, {matches: ['file:///*']}]};
const RAW = /\b(fontSettings|clipboardRead|unlimitedStorage|userScripts|webRequestAuthProvider|nativeMessaging|declarativeNetRequest\w*|sidePanel)\b|\*:\/\/|file:\/\/|<all_urls>|availability must be verified|ext\.(perm|note)\./;

test('every permission the engine knows has words, in every language', () => {
  for (const name of Object.keys(knownPermissions())) assert.ok(PERMISSION_IDS[name] || name === 'runtime', name + ' has no words');
  const [en, ...others] = LOCALES.map(catalog);
  for (const id of new Set([...Object.values(PERMISSION_IDS), 'ext.perm.sites', 'ext.perm.other', 'ext.note.nativeMessaging'])) {
    assert.ok(en[id], id);
    others.forEach((c, index) => assert.ok(c[id] && (c[id] !== en[id] || en[id].length <= 14), LOCALES[index + 1] + ' ' + id));
  }
});

test('the hunt\'s five extensions: their review lines are words, sites are one line, file access and stale notes are gone', () => {
  use('en');
  const lines = manifest => describe({id: 'x', manifest}).access;
  assert.deepEqual(lines(DARK_READER), ['Read and change every website', 'Run on a schedule', 'Add right-click items', 'Change your font settings', 'Run on the pages it works with', 'Keep its own settings', 'See your open tabs']);
  const bitwarden = describe({id: 'x', manifest: BITWARDEN});
  assert.equal(bitwarden.access[0], 'Read and change every website');
  for (const words of ['Read what you copy', 'Store as much of its own data as it needs', 'Answer websites’ sign-in prompts', 'Talk to apps installed on this computer', 'Show a side panel']) assert.ok(bitwarden.access.includes(words), words);
  assert.deepEqual(bitwarden.supportWarnings, ['Some of its features need its desktop app on this computer.'], 'the only note left, and in words');
  const ubol = describe({id: 'x', manifest: UBOL});
  assert.deepEqual(ubol.access, ['Read and change every website', 'Use the page you open it on', 'Block or change requests', 'Run on the pages it works with', 'Keep its own settings', 'Run scripts you add to it, if you allow it'], 'the two declarativeNetRequest permissions share a line');
  assert.deepEqual(ubol.supportWarnings, [], 'declarativeNetRequest and sidePanel work now: no "availability must be verified" line');
  for (const words of ['Show websites’ icons', 'Search with your search engine', 'See tabs you closed recently', 'Read what you copy']) assert.ok(lines(VIMIUM).includes(words), words);
  for (const locale of LOCALES) {
    use(locale);
    for (const manifest of [DARK_READER, BITWARDEN, UBOL, VIMIUM]) { const d = describe({id: 'x', manifest}); for (const line of [...d.access, ...d.supportWarnings]) { assert.doesNotMatch(line, RAW, `${locale} ${manifest.name}: ${line}`); assert.ok(!(line in knownPermissions()), `${locale} ${manifest.name}: raw name ${line}`); } }
  }
});

test('host patterns: grouped into one line, deduplicated across schemes, at most five named; file addresses never listed', () => {
  use('en');
  const t = tx.t;
  assert.deepEqual(accessLines(t, {origins: ['https://mail.example.com/*', 'http://mail.example.com/*']}), ['• Read and change mail.example.com']);
  assert.deepEqual(accessLines(t, {origins: ['https://*.github.com/*', 'https://gist.example.org/*', 'file:///*']}), ['• Read and change these websites: github.com, gist.example.org']);
  const many = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(name => `https://${name}.example/*`);
  assert.deepEqual(accessLines(t, {origins: many}), ['• Read and change these websites: a.example, b.example, c.example, d.example, e.example, …']);
  assert.deepEqual(accessLines(t, {origins: ['file:///*']}), [], 'no line for file addresses (the review says it cannot open files)');
  assert.deepEqual(accessLines(t, {permissions: ['runtime', 'menus', 'experimentalThing']}), ['• Use browser features Acira doesn’t have (those parts won’t work)'], 'names the engine does not know share one line');
});
