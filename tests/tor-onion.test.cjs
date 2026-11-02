'use strict';
// Onion-Location on the main-process side: only a v3 .onion address from a secure, non-onion page counts; it belongs to the page that sent it (and goes with that page's
// address); "Prefer .onion versions" is one saved Tor preference.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {createTorWindows, onionTarget} = require('../desktop/browser-services/tor-window.cjs');
const ONION = 'http://2gzyxa5ihm7nsggfxnu52rck2vv4rvmdlkiu3zzui5du4xyclen53wid.onion/';

test('onionTarget: v3 onion addresses from secure clear-web pages only', () => {
  assert.equal(onionTarget(ONION, 'https://www.torproject.org/'), ONION);
  assert.equal(onionTarget([ONION + 'docs?x=1'], 'https://www.torproject.org/a'), ONION + 'docs?x=1', 'a header with several values: the first');
  assert.equal(onionTarget('https://2gzyxa5ihm7nsggfxnu52rck2vv4rvmdlkiu3zzui5du4xyclen53wid.onion/', 'https://www.torproject.org/'), 'https://2gzyxa5ihm7nsggfxnu52rck2vv4rvmdlkiu3zzui5du4xyclen53wid.onion/');
  assert.equal(onionTarget(ONION, 'http://www.torproject.org/'), '', 'a page loaded over plain http cannot send visitors anywhere');
  assert.equal(onionTarget(ONION, ONION), '', 'an onion service does not point at itself');
  for (const bad of ['', 'http://example.com/', 'http://abc.onion/', 'ftp://2gzyxa5ihm7nsggfxnu52rck2vv4rvmdlkiu3zzui5du4xyclen53wid.onion/', 'http://user:pw@2gzyxa5ihm7nsggfxnu52rck2vv4rvmdlkiu3zzui5du4xyclen53wid.onion/', '/relative/path', 'javascript:alert(1)', undefined, null, []])
    assert.equal(onionTarget(bad, 'https://www.torproject.org/'), '', String(bad));
});

function windowsWithPipeline(userData = '') {
  const pipeline = {headers: null, useBefore() {}, useHeaders(fn) { pipeline.headers = fn; }};
  const contentBlocking = {attach: () => pipeline, https: {setPrivate() {}}};
  const engine = {status: () => ({state: 'ready', progress: 100, socksPort: 9150, error: null, version: '0.4.9.14'}), onStatus() { return () => {}; }, acquire() { return async () => {}; }, retry() {}};
  const session = {getUserAgent: () => 'Mozilla/5.0', setUserAgent() {}, setProxy: async () => {}, closeAllConnections: async () => {}, resolveProxy: async () => '', setPermissionRequestHandler() {}, setPermissionCheckHandler() {}};
  return {pipeline, tor: createTorWindows({contentBlocking, engine, userData}), session};
}
const response = (webContentsId, url, headers, resourceType = 'mainFrame') => ({webContentsId, url, resourceType, responseHeaders: headers});
const pageAt = (id, url) => ({id, getURL: () => url});

test('the offer belongs to the page that sent it and goes when the page moves or answers without it', async () => {
  const {pipeline, tor, session} = windowsWithPipeline();
  await tor.prepare({windowId: 1, session, profileId: 'p', emit() {}});
  pipeline.headers(response(7, 'https://www.torproject.org/', {'Onion-Location': [ONION]}));
  assert.equal(tor.onionLocationOf(pageAt(7, 'https://www.torproject.org/')), ONION);
  assert.equal(tor.onionLocationOf(pageAt(7, 'https://www.torproject.org/#top')), ONION, 'a fragment is the same page');
  assert.equal(tor.onionLocationOf(pageAt(7, 'https://other.example/')), '', 'the page moved on');
  assert.equal(tor.onionLocationOf(pageAt(8, 'https://www.torproject.org/')), '', 'another tab never inherits it');
  pipeline.headers(response(7, 'https://www.torproject.org/next', {'content-type': ['text/html']}));
  assert.equal(tor.onionLocationOf(pageAt(7, 'https://www.torproject.org/')), '', 'a later response without the header clears it');
  pipeline.headers(response(7, 'https://www.torproject.org/', {'onion-location': [ONION]}, 'image'));
  assert.equal(tor.onionLocationOf(pageAt(7, 'https://www.torproject.org/')), '', 'only the main document counts, not an image or a frame');
  pipeline.headers(response(7, 'https://www.torproject.org/', {'ONION-LOCATION': ['http://example.com/']}));
  assert.equal(tor.onionLocationOf(pageAt(7, 'https://www.torproject.org/')), '', 'a header that is not a v3 onion address is ignored');
  await tor.release(1);
});

test('"Prefer .onion versions" is saved beside the other Tor preferences and survives a restart', () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-tor-onion-'));
  try {
    const {tor} = windowsWithPipeline(userData);
    assert.deepEqual(tor.handle({type: 'tor.onion-prefer'}).torOnion, {prefer: false});
    assert.throws(() => tor.handle({type: 'tor.onion-prefer-set', prefer: 'yes'}), /on or off/);
    assert.deepEqual(tor.handle({type: 'tor.onion-prefer-set', prefer: true}).torOnion, {prefer: true});
    tor.handle({type: 'tor.level-set', level: 'safest'});
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(userData, 'tor', 'settings.json'), 'utf8')), {level: 'safest', downloadWarning: true, preferOnion: true});
    assert.equal(windowsWithPipeline(userData).tor.preferOnion(), true);
  } finally { fs.rmSync(userData, {recursive: true, force: true}); }
});

test('main.cjs and the interface wire the chip to the offer and follow the preference once per page', () => {
  const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), main = read('desktop/main.cjs'), app = read('src/App.tsx');
  assert.match(main, /\.\.\.onionState\(id,entry,wc,committed\),url:wc\.getURL\(\)/);
  assert.match(main, /committed&&onion&&tor\.preferOnion\(\)&&entry\.autoOnion!==onion/, 'one automatic open per offered address, so Back is not undone');
  assert.match(app, /isTorSite\(state, tab\) && <TorOnionChip tab=\{tab\} dispatch=\{dispatch\}\/>/);
});

// Onion-Location in the page's HTML (<meta http-equiv="onion-location">, which Tor Browser also reads).
const {readOnionMeta} = require('../desktop/browser-services/tor-window.cjs');
const OTHER = 'http://vww6ybal4bd7szmgncyruucpgfkqahzddi37ktceo3ah7ngmcopnpyyd.onion/';
const documentWith = (...metas) => ({querySelectorAll: selector => { assert.equal(selector, 'meta[http-equiv]'); return metas.map(([equiv, content]) => ({getAttribute: name => name === 'http-equiv' ? equiv : content})); }});

test('readOnionMeta: the first onion-location meta tag with a value, in any letter case; nothing else leaves the page', () => {
  assert.equal(readOnionMeta(documentWith(['onion-location', ONION])), ONION);
  assert.equal(readOnionMeta(documentWith(['refresh', '5'], [' Onion-Location ', '  ' + ONION + ' '], ['onion-location', OTHER])), ONION, 'other tags are skipped; the first onion-location wins; the value is trimmed');
  assert.equal(readOnionMeta(documentWith(['onion-location', ''], ['onion-location', '   '], ['onion-location', OTHER])), OTHER, 'a tag without a value is skipped');
  assert.equal(readOnionMeta(documentWith(['onion-location', 'http://' + 'a'.repeat(2100) + '.onion/'])), '', 'a value over 2048 characters is ignored');
  assert.equal(readOnionMeta(documentWith(['refresh', ONION], ['content-type', ONION])), '', 'only http-equiv="onion-location" counts');
  assert.equal(readOnionMeta(documentWith()), '');
  assert.equal(readOnionMeta(documentWith([null, ONION], ['onion-location', null])), '', 'missing attributes are not strings');
  assert.equal(readOnionMeta({querySelectorAll() { throw new Error('page broke it'); }}), '', 'a failing document gives nothing');
  // It is shipped as source text into an isolated world: the function must stand alone.
  assert.equal(new Function('document', `return (${readOnionMeta.toString()})(document)`)(documentWith(['onion-location', ONION])), ONION);
});

function torTab(url, read, {tor = true} = {}) {
  const calls = [];
  const wc = {id: 11, session: null, destroyed: false, url, isDestroyed() { return this.destroyed; }, getURL() { return this.url; },
    async executeJavaScriptInIsolatedWorld(world, scripts) { calls.push({world, scripts}); return typeof read === 'function' ? read(wc) : read; }};
  return {wc, calls, torSession: tor};
}
async function metaSetup(url, read, options) {
  const {pipeline, tor, session} = windowsWithPipeline();
  await tor.prepare({windowId: 1, session, profileId: 'p', emit() {}});
  const tab = torTab(url, read, options);
  tab.wc.session = tab.torSession ? session : {};
  return {pipeline, tor, tab};
}

test('a meta tag becomes the page\'s offer, read in an isolated world and validated exactly like the header', async () => {
  const {tor, tab} = await metaSetup('https://www.torproject.org/', ONION);
  assert.equal(await tor.noteOnionMeta(tab.wc), true);
  assert.equal(tor.onionLocationOf(tab.wc), ONION);
  assert.equal(tab.calls.length, 1);
  assert.ok(Number.isInteger(tab.calls[0].world) && tab.calls[0].world > 999, 'an isolated world of its own, not the page\'s (0) nor Electron\'s (999)');
  assert.match(tab.calls[0].scripts[0].code, /^\(function readOnionMeta\(document\)/);
  assert.equal(await tor.noteOnionMeta(tab.wc), false, 'a page that already has its offer is not read again');
  tab.wc.url = 'https://www.torproject.org/#top';
  assert.equal(tor.onionLocationOf(tab.wc), ONION, 'a fragment is the same page');
  tab.wc.url = 'https://other.example/';
  assert.equal(tor.onionLocationOf(tab.wc), '', 'the offer goes when the page moves on');
  await tor.release(1);
});

test('a meta offer that the header rules would refuse is refused', async () => {
  for (const [label, url, value] of [
    ['a plain-http page', 'http://www.torproject.org/', ONION],
    ['an onion page', ONION, OTHER],
    ['a page that is not http(s)', 'data:text/html,hi', ONION],
    ['an address that is not an onion', 'https://www.torproject.org/', 'http://example.com/'],
    ['a v2-length onion', 'https://www.torproject.org/', 'http://abc.onion/'],
    ['credentials in the address', 'https://www.torproject.org/', 'http://user:pw@2gzyxa5ihm7nsggfxnu52rck2vv4rvmdlkiu3zzui5du4xyclen53wid.onion/'],
    ['a relative address', 'https://www.torproject.org/', '/relative/path'],
    ['a javascript: address', 'https://www.torproject.org/', 'javascript:alert(1)'],
    ['a page script\'s non-string answer', 'https://www.torproject.org/', {href: ONION}],
    ['an empty answer', 'https://www.torproject.org/', ''],
  ]) {
    const {tor, tab} = await metaSetup(url, value);
    assert.equal(await tor.noteOnionMeta(tab.wc), false, label);
    assert.equal(tor.onionLocationOf(tab.wc), '', label);
  }
});

test('only a Tor tab\'s own, unchanged page is read: no script for pages that cannot offer, other sessions or a page that moved on', async () => {
  for (const [label, url, options] of [['plain http', 'http://www.torproject.org/', {}], ['an onion service', ONION, {}], ['an ordinary (not Tor) session', 'https://www.torproject.org/', {tor: false}]]) {
    const {tor, tab} = await metaSetup(url, ONION, options);
    assert.equal(await tor.noteOnionMeta(tab.wc), false, label);
    assert.equal(tab.calls.length, 0, `${label}: no script was run in the page`);
  }
  const moved = await metaSetup('https://www.torproject.org/', wc => { wc.url = 'https://elsewhere.example/'; return ONION; });
  assert.equal(await moved.tor.noteOnionMeta(moved.tab.wc), false, 'the answer belongs to the page it was read from');
  moved.tab.wc.url = 'https://www.torproject.org/';
  assert.equal(moved.tor.onionLocationOf(moved.tab.wc), '', 'and is not kept for a page that came back');
  const closed = await metaSetup('https://www.torproject.org/', wc => { wc.destroyed = true; return ONION; });
  assert.equal(await closed.tor.noteOnionMeta(closed.tab.wc), false, 'a closed tab');
  const broken = await metaSetup('https://www.torproject.org/', () => { throw new Error('frame is gone'); });
  assert.equal(await broken.tor.noteOnionMeta(broken.tab.wc), false, 'a failing script read');
  assert.equal(await metaSetup('https://www.torproject.org/', ONION).then(({tor}) => tor.noteOnionMeta(null)), false, 'no tab');
});

test('the header wins over the meta tag, and a new response clears a meta offer like a header one', async () => {
  const {pipeline, tor, tab} = await metaSetup('https://www.torproject.org/', OTHER);
  pipeline.headers(response(11, 'https://www.torproject.org/', {'Onion-Location': [ONION]}));
  assert.equal(await tor.noteOnionMeta(tab.wc), false);
  assert.equal(tab.calls.length, 0, 'with a header offer the page is not even read');
  assert.equal(tor.onionLocationOf(tab.wc), ONION, 'the header\'s offer stays');
  // A header that is present but not a valid onion address still counts as the header: the tag does not take over.
  pipeline.headers(response(11, 'https://www.torproject.org/', {'Onion-Location': ['http://example.com/']}));
  assert.equal(await tor.noteOnionMeta(tab.wc), false);
  assert.equal(tor.onionLocationOf(tab.wc), '');
  // A response without the header: the tag is read.
  pipeline.headers(response(11, 'https://www.torproject.org/', {'content-type': ['text/html']}));
  assert.equal(await tor.noteOnionMeta(tab.wc), true);
  assert.equal(tor.onionLocationOf(tab.wc), OTHER);
  // The next main-frame response (a reload or another page) starts over.
  pipeline.headers(response(11, 'https://www.torproject.org/', {'content-type': ['text/html']}));
  assert.equal(tor.onionLocationOf(tab.wc), '', 'a reload without the header drops the old meta offer until its tag is read again');
  assert.equal(await tor.noteOnionMeta(tab.wc), true);
  assert.equal(tor.onionLocationOf(tab.wc), OTHER);
});

test('main.cjs reads the tag when a Tor tab\'s main document is there and files it with the header\'s offer', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'desktop/main.cjs'), 'utf8');
  assert.match(main, /function onionMeta\(id,entry,wc\)\{\s*if\(!\(torMode\|\|entry\.privacy==='tor'\)\)return;\s*void torWindows\(\)\.noteOnionMeta\(wc\)\.then\(found=>\{if\(found&&pages\.get\(id\)===entry&&!wc\.isDestroyed\(\)\)browserEvent\(id,onionState\(id,entry,wc,true\)\);\}\);/);
  assert.match(main, /wc\.on\('dom-ready',\(\)=>\{if\(entry\.navigation\.phase==='committed'&&!entry\.navigation\.waitingForCommit\(wc\.getURL\(\)\)\)\{entry\.progress\.milestone\(\.7,wc\.getURL\(\)\);onionMeta\(tab\.id,entry,wc\);\}\}\);/);
  assert.match(main, /currentState\(\);onionMeta\(tab\.id,entry,wc\);\}\}\);/, 'again when the main frame has finished loading');
});
