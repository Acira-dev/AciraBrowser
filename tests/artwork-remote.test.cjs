'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createRemoteArtwork, HOSTS, COLLECTIONS } = require('../desktop/artwork-remote.cjs');
const LISTS = require('../desktop/artwork-remote-lists.cjs');

// A tiny valid JPEG header (SOI, APP0, SOF0 640x480).
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]), Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0'), Buffer.from([0xff, 0xc0, 0, 17, 8, 1, 0xe0, 2, 0x80, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]), Buffer.from([0xff, 0xda]), Buffer.alloc(64, 1), Buffer.from([0xff, 0xd9])]);
const page = (n) => ({ title: `File:Nebula ${n}.jpg`, imageinfo: [{ thumburl: `https://upload.wikimedia.org/wikipedia/commons/thumb/a/a${n}/Nebula_${n}.jpg/3840px-Nebula_${n}.jpg`, width: 4000, height: 2500, mime: 'image/jpeg', descriptionurl: `https://commons.wikimedia.org/wiki/File:Nebula_${n}.jpg`, extmetadata: { LicenseShortName: { value: 'Public domain' }, Artist: { value: 'NASA, ESA' }, ObjectName: { value: `Nebula ${n}` }, DateTimeOriginal: { value: '2020-01-0' + n } } }] });
const wikiList = { query: { pages: { 1: page(1), 2: page(2), 3: page(3) } } };
const LIST_REQUESTS = COLLECTIONS.space.listUrls().length;
function setup(handler) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'art-')), log = [];
  const request = async (url) => { log.push(url); return handler(url); };
  let clock = 1_000_000;
  return { root, log, art: createRemoteArtwork({ root, request, now: () => clock }), tick: (ms) => { clock += ms; } };
}
const ok = (bytes) => ({ status: 200, headers: {}, bytes });
const answer = (url) => url.includes('commons.wikimedia.org') ? ok(Buffer.from(JSON.stringify(wikiList))) : ok(jpeg);

test('one picture is fetched, verified, cached and then served with no network call', async () => {
  const { art, log } = setup(answer);
  const first = await art.pick('space', 'tab-1');
  assert.match(first.src, /^acira-browser-ui:\/\/ui\/artwork-remote\/[a-f0-9]{24}\.jpg$/);
  assert.equal(first.credit, 'Wikimedia Commons');
  assert.equal(first.license, 'Public domain');
  assert.equal(log.length, LIST_REQUESTS + 1, 'the list, then one picture');
  const again = await art.pick('space', 'tab-1');
  assert.equal(again.src, first.src);
  assert.equal(log.length, LIST_REQUESTS + 1, 'a cached picture and list cost no request');
  const served = art.response(new URL(first.src));
  assert.equal(served.mime, 'image/jpeg');
  assert.ok(served.bytes.equals(jpeg));
});

test('the list is refreshed at most once a day', async () => {
  const { art, log, tick } = setup(answer);
  await art.pick('space', 'a'); const before = log.filter((url) => url.includes('commons.wikimedia.org/w/api.php')).length;
  tick(60 * 60 * 1000); await art.pick('space', 'b'); assert.equal(log.filter((url) => url.includes('commons.wikimedia.org/w/api.php')).length, before);
  tick(25 * 60 * 60 * 1000); await art.pick('space', 'c'); assert.equal(log.filter((url) => url.includes('commons.wikimedia.org/w/api.php')).length, before + LIST_REQUESTS);
});

test('manual choices exclude the previous image even when the seed would repeat it, and stay stable across restart', async () => {
  const { root, art, log } = setup(answer);
  const first = await art.pick('space', 'same-seed');
  const next = await art.pick('space', 'same-seed', first.id);
  assert.notEqual(next.id, first.id);
  assert.notEqual(next.src, first.src);
  assert.equal((await art.pick('space', 'same-seed', first.id)).id, next.id);
  const before = log.length;
  const restarted = createRemoteArtwork({ root, request: async () => { throw Error('Cached manual choice must not fetch'); }, now: () => 1_000_000 });
  assert.equal((await restarted.pick('space', 'same-seed', first.id)).id, next.id);
  assert.equal(log.length, before);
});

test('a collection with only the excluded image still returns its available picture', async () => {
  const singleton = { query: { pages: { 1: page(1) } } };
  const { art } = setup(url => url.includes('commons.wikimedia.org') ? ok(Buffer.from(JSON.stringify(singleton))) : ok(jpeg));
  const first = await art.pick('space', 'a');
  assert.equal((await art.pick('space', 'b', first.id)).id, first.id);
});

test('simultaneous choices with different exclusions do not share the same in-flight answer', async () => {
  const { art } = setup(answer);
  const first = await art.pick('space', 'inflight');
  const [unchanged, changed] = await Promise.all([art.pick('space', 'inflight'), art.pick('space', 'inflight', first.id)]);
  assert.equal(unchanged.id, first.id);
  assert.notEqual(changed.id, first.id);
});

test('only allow-listed https hosts are ever requested, including through redirects', async () => {
  const { art, log } = setup((url) => url.includes('commons.wikimedia.org') ? ok(Buffer.from(JSON.stringify(wikiList))) : { status: 302, headers: { location: 'https://evil.example/x.jpg' }, bytes: Buffer.alloc(0) });
  await assert.rejects(art.pick('space', 'x'));
  assert.ok(log.every((url) => HOSTS.has(new URL(url).hostname)), log.join(','));
  const none = setup(() => ok(Buffer.from('{}')));
  await assert.rejects(none.art.pick('nope', 'x'), /Unknown collection/);
});

test('a bad picture is refused and never served', async () => {
  const { art } = setup((url) => url.includes('commons.wikimedia.org') ? ok(Buffer.from(JSON.stringify(wikiList))) : ok(Buffer.from('<html>not an image at all, just text here</html>')));
  await assert.rejects(art.pick('space', 'x'));
  assert.equal(art.response(new URL('acira-browser-ui://ui/artwork-remote/../../secret.jpg')), null);
  assert.equal(art.response(new URL('acira-browser-ui://ui/artwork-remote/aaaaaaaaaaaaaaaaaaaaaaaa.jpg')), null);
});

test('Wikimedia lists keep only open licenses, sharp sizes, and drop the tracking query string', async () => {
  const info = (extra) => ({ thumburl: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/a/aa/A.jpg/3840px-A.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo', width: 4000, height: 2600, mime: 'image/jpeg', descriptionurl: 'https://commons.wikimedia.org/wiki/File:A.jpg', extmetadata: { LicenseShortName: { value: 'CC BY-SA 4.0' }, Artist: { value: '<a href="x">Jane</a>' }, ObjectName: { value: 'Alpine lake' } }, ...extra });
  const wiki = { query: { pages: {
    1: { title: 'File:A.jpg', imageinfo: [info({})] },
    2: { title: 'File:B.jpg', imageinfo: [info({ extmetadata: { LicenseShortName: { value: 'CC BY-NC 4.0' } } })] },
    3: { title: 'File:C.jpg', imageinfo: [info({ width: 1920, height: 1080 })] },
    4: { title: 'File:D.png', imageinfo: [info({ mime: 'image/png' })] },
    5: { title: 'File:E.jpg', imageinfo: [info({ width: 2560, height: 1000 })] },
  } } };
  const w = setup((url) => url.includes('commons.wikimedia.org') ? ok(Buffer.from(JSON.stringify(wiki))) : ok(jpeg));
  const listed = await w.art.list('landscapes');
  assert.ok(listed.length && listed.every((item) => item.title === 'Alpine lake'), 'NC licence, small, PNG and short pictures are dropped');
  const pick = await w.art.pick('landscapes', 's'); assert.equal(pick.name, 'Alpine lake'); assert.equal(pick.artist, 'Jane');
  const imageRequest = w.log.find((url) => !url.includes('commons.wikimedia.org'));
  assert.equal(imageRequest, 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/aa/A.jpg/3840px-A.jpg');
});

test('the NASA library is gone and every genre has a generous, unique, short-request list', () => {
  assert.deepEqual(Object.keys(COLLECTIONS).sort(), ['architecture', 'landscapes', 'nature', 'space']);
  assert.ok(![...HOSTS].some((host) => host.includes('nasa')));
  const all = new Set();
  for (const [id, titles] of Object.entries(LISTS)) {
    assert.ok(titles.length >= 75, id + ' has ' + titles.length);
    for (const title of titles) { assert.ok(!all.has(title), 'listed twice: ' + title); all.add(title); assert.ok(/.jpe?g$/i.test(title), title); }
    const urls = COLLECTIONS[id].listUrls();
    assert.ok(urls.every((url) => url.length < 3200 && HOSTS.has(new URL(url).hostname)), id + ' request length');
    assert.equal(urls.reduce((sum, url) => sum + url.split('&titles=')[1].split('%7C').length, 0), titles.length, id + ' every file is asked for once');
  }
});

test('picture fetches follow the profile proxy and never go direct when it is unconfirmed', async () => {
  const { followProfileProxy } = require('../desktop/artwork-remote.cjs');
  const calls = [];
  const session = { setProxy: async (config) => { calls.push(['proxy', config]); }, closeAllConnections: async () => { calls.push(['close']); } };
  let state = { choice: { mode: 'fixed_servers', server: { scheme: 'socks5', host: '10.0.0.2', port: 1080 }, bypassHosts: [] }, applied: true, busy: false, error: null };
  const toNative = (choice) => choice.mode === 'fixed_servers' ? { mode: 'fixed_servers', proxyRules: `${choice.server.scheme}://${choice.server.host}:${choice.server.port}` } : { mode: choice.mode };
  const prepare = followProfileProxy({ session, status: () => state, toNative });
  await prepare(); await prepare();
  assert.deepEqual(calls, [['proxy', { mode: 'fixed_servers', proxyRules: 'socks5://10.0.0.2:1080' }], ['close']], 'applied once, connections closed once');
  state = { ...state, choice: { mode: 'system' } };
  await prepare();
  assert.deepEqual(calls.slice(2), [['proxy', { mode: 'system' }], ['close']]);
  for (const bad of [{ ...state, error: 'could not apply' }, { ...state, applied: false }, { ...state, choice: { mode: 'tor' } }, null]) { state = bad; await assert.rejects(prepare()); }
  assert.equal(calls.length, 4, 'nothing changes when it refuses');
  const { art, log } = setup(answer);
  const guarded = createRemoteArtwork({ root: fs.mkdtempSync(path.join(os.tmpdir(), 'art-')), request: async (url) => { log.push(url); return answer(url); }, prepare: async () => { throw Error('not confirmed'); } });
  await assert.rejects(guarded.pick('space', 'x'), /not confirmed/);
  assert.equal(log.length, 0, 'no request is made when the route is unconfirmed');
});
