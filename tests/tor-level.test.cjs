'use strict';
// Tor security level (Standard / Safer / Safest): the choice is saved, each Tor page remembers the level it was made with (Electron does not
// report additionalArguments back), pages made earlier count as stale until they reopen, and applying the level reopens exactly those.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {createTorWindows, TOR_LEVEL_PREFERENCES} = require('../desktop/browser-services/tor-window.cjs');

const engine = () => ({status: () => ({state: 'ready', progress: 100, socksPort: 9150, error: null, version: '0.4.9.14'}), onStatus() { return () => {}; }, acquire() { return async () => {}; }, retry() {}, async newIdentity() { return {ok: true}; }});
const torSession = () => { const s = {[Symbol.for('acira.tor.session')]: true, getUserAgent: () => 'Mozilla/5.0', setUserAgent() {}, setProxy: async () => {}, closeAllConnections: async () => {}, resolveProxy: async () => '', setPermissionRequestHandler() {}, setPermissionCheckHandler() {}}; return s; };
const page = (session, url) => ({session, isDestroyed: () => false, getURL: () => url, setWebRTCIPHandlingPolicy() {}});

test('Safer and Safest turn off the JIT and WebAssembly in the renderer, WebGL and autoplay; Safest also JavaScript', () => {
  assert.equal(TOR_LEVEL_PREFERENCES.standard.additionalArguments.some(a => /jitless|wasm/.test(a)), false);
  for (const level of ['safer', 'safest']) {
    const prefs = TOR_LEVEL_PREFERENCES[level];
    assert.ok(prefs.additionalArguments.includes('--js-flags=--jitless --no-expose-wasm'));
    assert.equal(prefs.webgl, false);assert.equal(prefs.autoplayPolicy, 'document-user-activation-required');
  }
  assert.equal(TOR_LEVEL_PREFERENCES.safest.javascript, false);
  assert.notEqual(TOR_LEVEL_PREFERENCES.safer.javascript, false);
});

test('the level is saved, read back by the next run, and pages made at another level are stale until they reopen', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-tor-level-')), pages = [], created = [];
  const app = {on: (event, handler) => { if (event === 'web-contents-created') created.push(handler); }};
  const tor = createTorWindows({app, engine: engine(), userData, allContents: () => pages});
  try {
    const session = torSession(), old = page(session, 'https://example.com/');
    pages.push(old);
    await tor.prepare({windowId: 1, session, profileId: 'p', emit() {}}); // locks what already lives in the session: the old page is stamped Standard
    assert.equal(tor.handle({type: 'tor.level'}).torLevel.level, 'standard');
    assert.equal(tor.handle({type: 'tor.level'}).torLevel.stale, 0);
    const changed = tor.handle({type: 'tor.level-set', level: 'safer'}).torLevel;
    assert.equal(changed.level, 'safer');assert.equal(changed.stale, 1, 'the open page still runs at Standard');
    assert.deepEqual(tor.webPreferences, TOR_LEVEL_PREFERENCES.safer, 'pages made now get the Safer preferences');
    const fresh = page(session, 'https://example.org/');
    pages.push(fresh);for (const handler of created) handler(null, fresh); // a page made after the change is stamped Safer
    assert.equal(tor.levelOfContents(old), 'standard');assert.equal(tor.levelOfContents(fresh), 'safer');
    assert.equal(tor.handle({type: 'tor.level'}).torLevel.stale, 1, 'only the old page is stale');
    let reopened = 0;
    const applied = await tor.handle({type: 'tor.level-apply'}, {reopenTorTabs: async () => { reopened++; pages.splice(pages.indexOf(old), 1); return 1; }});
    assert.equal(reopened, 1);assert.equal(applied.reopened, 1);assert.equal(applied.torLevel.stale, 0);
    assert.throws(() => tor.handle({type: 'tor.level-set', level: 'paranoid'}), /Standard, Safer or Safest/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(userData, 'tor', 'settings.json'), 'utf8')).level, 'safer');
    const next = createTorWindows({engine: engine(), userData});
    assert.equal(next.level(), 'safer', 'the next run starts at the saved level');next.release(1);
  } finally { await tor.release(1); fs.rmSync(userData, {recursive: true, force: true}); }
});

test('a level that cannot be saved is refused, not applied for this run only', () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-tor-level-')), blocked = path.join(userData, 'tor');
  fs.writeFileSync(blocked, 'a file where the folder should be'); // mkdir of tor/ fails
  try {
    const tor = createTorWindows({engine: engine(), userData});
    assert.throws(() => tor.handle({type: 'tor.level-set', level: 'safest'}), /couldn.t be saved/i);
    assert.equal(tor.level(), 'standard');
  } finally { fs.rmSync(userData, {recursive: true, force: true}); }
});
