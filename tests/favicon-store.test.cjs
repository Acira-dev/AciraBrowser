'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createFaviconStore } = require('../desktop/browser-services/favicon-store.cjs');

const image = (width, empty = false) => ({ isEmpty: () => empty, getSize: () => ({ width, height: width }), resize: ({ width: to }) => image(to), toDataURL: () => `data:image/png;base64,w${width}` });
function fixture({ type = 'image/png', size = 400, ok = true, width = 64 } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'favicons-')), file = path.join(directory, 'favicons.json'), fetched = [];
  let time = 1_000_000;
  const session = { fetch: async (url, init) => { fetched.push({ url, init }); return { ok, headers: { get: () => type }, arrayBuffer: async () => new ArrayBuffer(size) }; } };
  const nativeImage = { createFromBuffer: (bytes) => image(width, bytes.length === 0) };
  const store = createFaviconStore({ file, nativeImage, now: () => time });
  return { store, session, fetched, file, advance: (ms) => { time += ms; }, cleanup: () => fs.rmSync(directory, { recursive: true, force: true }) };
}
const visit = (f, over = {}) => f.store.remember({ session: f.session, profileId: 'p1', privateMode: false, pageUrl: 'https://www.Wikipedia.org/wiki/Gogh', iconUrl: 'https://www.wikipedia.org/favicon.ico', ...over });

test('an icon is fetched once without cookies, shrunk to 32px and kept as an image per site', async () => {
  const f = fixture();
  try {
    assert.equal(await visit(f), true);
    assert.deepEqual(f.fetched.map((call) => [call.url, call.init.credentials]), [['https://www.wikipedia.org/favicon.ico', 'omit']]);
    assert.deepEqual(f.store.list('p1', new Set(['wikipedia.org'])), { 'wikipedia.org': 'data:image/png;base64,w32' });
    assert.equal(await visit(f), false, 'the same icon is not fetched again within a week');
    assert.equal(f.fetched.length, 1);
    f.advance(8 * 86400000);
    assert.equal(await visit(f), true, 'a week later it is refreshed');
    assert.equal(await visit(f, { iconUrl: 'https://www.wikipedia.org/other.png' }), true, 'a different icon address is taken at once');
  } finally { f.cleanup(); }
});

test('private windows, non-websites and unusable answers keep nothing', async () => {
  const f = fixture();
  try {
    assert.equal(await visit(f, { privateMode: true }), false);
    assert.equal(await visit(f, { pageUrl: 'acira://settings' }), false);
    assert.equal(await visit(f, { iconUrl: 'data:image/png;base64,AAAA' }), false);
    assert.equal(await visit(f, { profileId: '' }), false);
    assert.equal(f.fetched.length, 0, 'none of those reached the network');
  } finally { f.cleanup(); }
  for (const options of [{ ok: false }, { type: 'text/html' }, { size: 0 }, { size: 200000 }]) {
    const g = fixture(options);
    try { assert.equal(await visit(g), false, JSON.stringify(options)); assert.deepEqual(g.store.list('p1', new Set(['wikipedia.org'])), {}); } finally { g.cleanup(); }
  }
  const failing = fixture();
  failing.session.fetch = async () => { throw new Error('offline'); };
  try { assert.equal(await visit(failing), false); } finally { failing.cleanup(); }
});

test('an icon is forgotten as soon as the profile no longer has the site, and profiles are separate', async () => {
  const f = fixture();
  try {
    await visit(f);
    await visit(f, { pageUrl: 'https://example.org/', iconUrl: 'https://example.org/icon.png' });
    assert.deepEqual(Object.keys(f.store.list('p1', new Set(['wikipedia.org', 'example.org']))).sort(), ['example.org', 'wikipedia.org']);
    assert.deepEqual(Object.keys(f.store.list('p1', new Set(['example.org']))), ['example.org'], 'history cleared for one site');
    assert.deepEqual(f.store.list('p1', new Set(['wikipedia.org'])), {}, 'and it does not come back');
    assert.deepEqual(f.store.list('p2', new Set(['example.org'])), {}, 'another profile has none');
    f.store.forgetProfile('p1');
    assert.deepEqual(f.store.list('p1', new Set(['example.org'])), {});
  } finally { f.cleanup(); }
});

test('icons survive a restart and the store stays bounded', async () => {
  const f = fixture();
  try {
    await visit(f);
    f.store.flush();
    const again = createFaviconStore({ file: f.file, nativeImage: { createFromBuffer: () => image(32) } });
    assert.deepEqual(again.list('p1', new Set(['wikipedia.org'])), { 'wikipedia.org': 'data:image/png;base64,w32' });
    for (let index = 0; index < 405; index++) { f.advance(10); await visit(f, { pageUrl: `https://site${index}.example/`, iconUrl: `https://site${index}.example/i.png` }); }
    const hosts = new Set(Array.from({ length: 405 }, (_, index) => `site${index}.example`).concat('wikipedia.org'));
    assert.ok(Object.keys(f.store.list('p1', hosts)).length <= 400);
  } finally { f.cleanup(); }
});
