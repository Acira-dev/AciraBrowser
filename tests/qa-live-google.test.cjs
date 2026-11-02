'use strict';
// QA runs must not reach Google's search and sign-in pages by accident: automated traffic (navigator.webdriver=true) from this PC's one address
// earns Google's unusual-traffic page for the founder's own browsing too. Only a QA run (ACIRA_QA_RUN=1, set by every qa/ rig) is kept off Google:
// the preview and "npm start" run on a test profile (ACIRA_BROWSER_TEST_DATA) too, and the person browsing there must reach every site.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const { qaHostRules, qaRun, LIVE_GOOGLE_HOSTS } = require('../desktop/browser-services/quiet-network.cjs');
const QA = { ACIRA_BROWSER_TEST_DATA: 'x', ACIRA_QA_RUN: '1' };

test('a QA run cannot resolve Google search, sign-in or YouTube, and store and update hosts stay open', () => {
  const rules = qaHostRules(QA);
  for (const host of ['www.google.com', 'accounts.google.com', 'www.youtube.com', 'accounts.youtube.com']) assert.ok(rules.includes(`MAP ${host} ~NOTFOUND`), host);
  for (const host of ['clients2.google.com', 'chromewebstore.google.com', 'update.googleapis.com', 'www.gstatic.com']) assert.ok(!LIVE_GOOGLE_HOSTS.includes(host), host);
});

test('the person browsing is never blocked, on any launcher or profile', () => {
  // The preview (scripts/preview.mjs), "npm start" (launch.mjs, e.g. Run Acira Browser.command) and any hand launch use a test profile and no QA flag.
  for (const env of [{ ACIRA_BROWSER_TEST_DATA: '/x/.preview-profile' }, { ACIRA_BROWSER_TEST_DATA: '/x/.profile/local-mac' }, { ACIRA_BROWSER_TEST_DATA: 'x', ACIRA_BROWSER_TEST_HIDDEN: '1' }, { ACIRA_BROWSER_TEST_DATA: 'x', ACIRA_QA_RUN: '0' }, { ACIRA_BROWSER_TEST_DATA: 'x', ACIRA_QA_RUN: '' }]) {
    assert.equal(qaHostRules(env), '', JSON.stringify(env));
    assert.equal(qaRun(env), false, JSON.stringify(env));
  }
});

test('an installed Acira is never affected, and the live opt-in is explicit', () => {
  assert.equal(qaHostRules({}), '');
  assert.equal(qaHostRules({ ACIRA_QA_RUN: '1' }), '', 'a QA flag without a test profile does nothing');
  assert.equal(qaHostRules({ ACIRA_QA_RUN: '1', ACIRA_QA_LIVE_GOOGLE: '1' }), '');
  assert.equal(qaHostRules({ ...QA, ACIRA_QA_LIVE_GOOGLE: '1' }), '', 'ACIRA_QA_LIVE_GOOGLE=1 is the deliberate opt-in');
  assert.equal(qaHostRules({ ...QA, ACIRA_QA_LIVE_GOOGLE: '0' }), qaHostRules(QA));
});

test('a rig that maps its own fixture keeps it, and the app applies the rules before any session exists', () => {
  const main = read('desktop', 'main.cjs');
  const at = main.indexOf('qaHostRules()');
  assert.ok(at > 0 && at < main.indexOf('createNativeNetworkPreferences'), 'applied right after the data folder is chosen');
  assert.match(main, /if\(process\.env\.ACIRA_QA_RUN&&!app\.commandLine\.hasSwitch\('host-resolver-rules'\)\)/);
  assert.doesNotMatch(main, /if\(process\.env\.ACIRA_BROWSER_TEST_DATA&&!app\.commandLine\.hasSwitch\('host-resolver-rules'\)\)/, 'a test profile alone is not a QA run');
});

test('the launchers a person uses never carry the QA flag and never opt in to anything', () => {
  const preview = read('scripts', 'preview.mjs'), launch = read('launch.mjs');
  assert.match(preview, /delete env\.ACIRA_QA_RUN;/);
  assert.match(launch, /delete env\.ACIRA_QA_RUN;/);
  assert.doesNotMatch(preview, /ACIRA_QA_RUN\s*:/);
  assert.doesNotMatch(preview, /ACIRA_QA_LIVE_GOOGLE/, 'the preview needs no workaround: it is not a QA run');
  assert.match(read('qa', 'google-signin-manual.cjs'), /delete process\.env\.ACIRA_QA_RUN;/, 'the by-hand Google sign-in tool is a person, not automation');
});

test('every rig that gives the app a test profile marks the run as QA', () => {
  const rigs = [], walk = dir => { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (!['artifacts', 'fixtures', 'node_modules'].includes(entry.name)) walk(full); } else if (/\.(mjs|cjs|js|ps1)$/.test(entry.name)) rigs.push(full);
  } };
  walk(path.join(root, 'qa'));
  // Assignments only: a key in an env object, or process.env.X = / $env:X =. Reads and comments do not make a rig.
  const assigns = /ACIRA_BROWSER_TEST_DATA\s*:\s*[^\s'"]|\.ACIRA_BROWSER_TEST_DATA\s*=(?!=)|\$env:ACIRA_BROWSER_TEST_DATA\s*=/;
  const unmarked = rigs.filter(file => { const text = fs.readFileSync(file, 'utf8'); return assigns.test(text) && !text.includes('ACIRA_QA_RUN'); }).map(file => path.relative(root, file));
  assert.ok(rigs.length > 100, 'found the rigs');
  assert.deepEqual(unmarked, [], 'these rigs launch the app on a test profile without ACIRA_QA_RUN=1, so they would reach Google unguarded');
});

test('rigs that drive Google themselves refuse to run unless asked', () => {
  for (const rig of ['r6-google-youtube', 'r6-google-youtube-chromium', 'r4-google-rules', 'ua-google', 'ua-google-dom', 'identity-sites', 'v-volume-youtube'])
    assert.match(read('qa', rig + '.mjs'), /^import '\.\/live-google-gate\.mjs';/m, rig);
});

test('the scam-page guard leaves no named global for a page to read', () => {
  assert.doesNotMatch(read('desktop', 'browser-services', 'page-risk.cjs'), /__aciraClickFix/);
});
