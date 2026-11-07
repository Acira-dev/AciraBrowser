'use strict';
// Where releases and updates live is ONE setting (packaging/release-target.json). These tests pin the mapping to electron-builder's
// "publish" block, the unauthenticated reachability preflight (mocked fetch: nothing here touches the network) and that no release or
// update file hardcodes the repository any more.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const target = require('../packaging/release-target.cjs');

const root = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const github = { provider: 'github', owner: 'acme', repo: 'acira-releases' };
const generic = { provider: 'generic', url: 'https://updates.acme.test/acira' };

test('github target maps to the publish block the installed app reads (app-update.yml)', () => {
  assert.deepEqual(target.publishBlock(github), [{ provider: 'github', owner: 'acme', repo: 'acira-releases', releaseType: 'prerelease', channel: 'latest' }]);
  assert.equal(target.repoSlug(github), 'acme/acira-releases');
  assert.equal(target.dictionaryUrl(github), 'https://github.com/acme/acira-releases/releases/download/spellcheck-dictionaries/');
});

test('generic target maps to a generic provider and has no gh repository', () => {
  assert.deepEqual(target.publishBlock(generic), [{ provider: 'generic', url: 'https://updates.acme.test/acira', channel: 'latest' }]);
  assert.equal(target.repoSlug(generic), null);
  assert.equal(target.dictionaryUrl(generic), 'https://updates.acme.test/acira/spellcheck-dictionaries/');
});

test('target validation rejects anything that is not a plain github repo or an https folder', () => {
  assert.deepEqual(target.normalizeTarget({ provider: 'generic', url: 'https://x.test/a/' }), { provider: 'generic', url: 'https://x.test/a' });
  assert.deepEqual(target.normalizeTarget({ provider: 'generic', url: 'http://127.0.0.1:8080' }), { provider: 'generic', url: 'http://127.0.0.1:8080' });
  for (const bad of [null, {}, { provider: 'ftp' }, { provider: 'github', owner: 'a/b', repo: 'c' }, { provider: 'github', owner: 'a' }, { provider: 'generic', url: 'http://example.com' }, { provider: 'generic', url: 'https://u:p@example.com' }, { provider: 'generic', url: 'nonsense' }])
    assert.throws(() => target.normalizeTarget(bad), /release-target\.json/);
});

test('electron-builder config gets "publish" from the target and keeps the old key position', () => {
  const base = JSON.parse(read('packaging', 'electron-builder.json'));
  assert.equal('publish' in base, false, 'the publish block is built from release-target.json, not stored in electron-builder.json');
  const applied = target.applyReleaseTarget({ a: 1, forceCodeSigning: false, publish: ['stale'], b: 2 }, generic);
  assert.deepEqual(Object.keys(applied), ['a', 'forceCodeSigning', 'publish', 'b']);
  assert.deepEqual(applied.publish, target.publishBlock(generic));
  const { createConfig } = require('../packaging/signing-config.cjs');
  assert.deepEqual(createConfig({}).publish, target.publishBlock(target.loadReleaseTarget()));
  assert.deepEqual(createConfig({}, generic).publish, target.publishBlock(generic));
});

test('the committed default is the public metadata feed, the same one Mac uses; the source repository is not a target', () => {
  const current = target.loadReleaseTarget(), { publicFeedConfig, DEFAULT_FEED_URL } = require('../packaging/update-feed.cjs');
  assert.equal(current.provider, 'generic');
  assert.equal(`${current.url}/`, DEFAULT_FEED_URL);
  assert.equal(target.repoSlug(current), null);
  assert.deepEqual(target.publishBlock(current), [{ provider: 'generic', url: current.url, channel: 'latest' }]);
  assert.equal(new URL(publicFeedConfig(current.url).url).href, DEFAULT_FEED_URL);
  assert.equal(target.dictionaryUrl(current), `${DEFAULT_FEED_URL}spellcheck-dictionaries/`);
  assert.equal(target.describeTarget(current), DEFAULT_FEED_URL);
});

const reply = (status, body = '') => ({ status, text: async () => body });
const mock = routes => async (url) => { for (const [pattern, response] of routes) if (pattern.test(url)) return typeof response === 'function' ? response() : response; return reply(404); };
const publicRepo = [[/\/releases\?/, reply(200, '[]')], [/api\.github\.com\/repos\/acme\/acira-releases$/, reply(200, '{"private":false}')], [/releases\.atom$/, reply(200, '<feed xmlns="http://www.w3.org/2005/Atom"></feed>')]];

test('preflight: a public GitHub repository passes all three unauthenticated checks', async () => {
  const seen = [];
  const result = await target.checkReleaseTarget(github, { fetch: async (url, init) => { seen.push({ url, auth: init?.headers?.authorization }); return mock(publicRepo)(url); } });
  assert.equal(result.ok, true); assert.equal(result.state, 'public'); assert.equal(result.checks.length, 3);
  assert.ok(seen.every(call => !call.auth), 'never sends credentials');
});

test('preflight: a private or missing repository (404) is unreachable with a clear problem per failing check', async () => {
  const result = await target.checkReleaseTarget(github, { fetch: mock([]) });
  assert.equal(result.ok, false); assert.equal(result.state, 'unreachable');
  assert.equal(result.problems.length, 3);
  assert.match(result.problems[0], /404/); assert.match(result.problems[0], /cannot read it/);
});

test('preflight: a repository that answers but is private is unreachable', async () => {
  const result = await target.checkReleaseTarget(github, { fetch: mock([[/repos\/acme\/acira-releases$/, reply(200, '{"private":true}')], ...publicRepo]) });
  assert.equal(result.ok, false); assert.equal(result.state, 'unreachable');
});

test('preflight: offline or a server error is "unverified", not "public"', async () => {
  const offline = await target.checkReleaseTarget(github, { fetch: async () => { throw new Error('getaddrinfo ENOTFOUND'); } });
  assert.equal(offline.ok, false); assert.equal(offline.state, 'unverified'); assert.match(offline.problems[0], /could not verify/);
  const broken = await target.checkReleaseTarget(github, { fetch: mock([[/./, reply(503)]]) });
  assert.equal(broken.state, 'unverified');
});

test('preflight: a generic target is reachable when latest.yml answers with a version', async () => {
  const ok = await target.checkReleaseTarget(generic, { fetch: mock([[/acira\/latest\.yml$/, reply(200, 'version: 1.2.3\nfiles: []\n')]]) });
  assert.equal(ok.ok, true); assert.equal(ok.checks[0].url, 'https://updates.acme.test/acira/latest.yml');
  const missing = await target.checkReleaseTarget(generic, { fetch: mock([]) });
  assert.equal(missing.ok, false); assert.equal(missing.state, 'unreachable');
  const wrong = await target.checkReleaseTarget(generic, { fetch: mock([[/latest\.yml$/, reply(200, '<html>login</html>')]]) });
  assert.equal(wrong.ok, false);
  const json = await target.checkReleaseTarget(generic, { fetch: mock([[/latest\.yml$/, reply(200, '{\n  "version": "0.0.0",\n  "files": []\n}')]]) }); // the public feed's channel documents are JSON, which is valid YAML
  assert.equal(json.ok, true);
});

test('release.mjs refuses --publish to an unreachable target unless --allow-private-target, and a generic target never runs gh', () => {
  const release = read('scripts', 'release.mjs');
  assert.match(release, /checkReleaseTarget\(target\)/);
  assert.match(release, /publish && !reach\.ok && !flag\('--allow-private-target'\)\) fail\(/);
  assert.match(release, /if \(!REPO\) \{ say\(.*nothing was uploaded/);
  assert.ok(release.indexOf('checkReleaseTarget(target)') < release.indexOf("run(process.platform === 'win32' ? 'npm.cmd'"), 'the preflight runs before the long build');
});

test('no release or update file hardcodes the releases repository', () => {
  const files = ['desktop/browser-services/app-updater.cjs', 'desktop/browser-services/spellcheck-dictionaries.cjs', 'packaging/electron-builder.json', 'packaging/electron-builder.cjs', 'packaging/signing-config.cjs',
    'scripts/release.mjs', 'scripts/release-package.mjs', 'scripts/release-installer.mjs', 'scripts/publish-spellcheck-dictionaries.mjs', 'scripts/check-release-target.mjs'];
  for (const file of files) {
    const text = read(...file.split('/'));
    assert.equal(/Acira-dev\/AciraBrowserNoAI|"owner":\s*"Acira-dev"/.test(text), false, `${file} hardcodes the repository`);
  }
});

test('the updater interval label matches the code in every catalog (2 hours since beta.11)', () => {
  const { CHECK_EVERY } = require('../desktop/browser-services/app-updater.cjs');
  assert.equal(CHECK_EVERY, 2 * 60 * 60 * 1000);
  for (const file of fs.readdirSync(path.join(root, 'src', 'i18n')).filter(name => /^[A-Za-z-]+\.json$/.test(name) && name !== 'converted.json')) {
    const text = JSON.parse(read('src', 'i18n', file))['updates.checksAtLaunchAndEvery'];
    assert.match(text, file === 'ar.json' ? /ساعتين/ : /\b2\b/, `${file}: ${text}`); assert.doesNotMatch(text, /\b(?:6|8)\b/, `${file}: ${text}`);
    const detail = JSON.parse(read('src', 'i18n', file))['updates.autoDetail'];
    assert.match(detail, file === 'ar.json' ? /ساعتين/ : /\b2\b/, `${file} autoDetail: ${detail}`);
  }
});

test('the installed app never reads packaging/release-target.json at startup: the default target is a bundled require', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'packaging', 'release-target.cjs'), 'utf8');
  assert.match(src, /if \(file === undefined\) return normalizeTarget\(require\('\.\/release-target\.json'\)\);/);
});
