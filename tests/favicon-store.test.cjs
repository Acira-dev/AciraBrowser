'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createFaviconStore } = require('../desktop/browser-services/favicon-store.cjs');
const { inspect } = require('../desktop/browser-services/icon-image.cjs');
const { png, ico, svg, nativeImage, response } = require('./fixtures/tab-icons/pictures.cjs');

const urlOf = (bytes, type = 'image/png') => `data:${type};base64,${bytes.toString('base64')}`;
function fixture({ type = 'image/png', body = png(64), ok = true } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'favicons-')), file = path.join(directory, 'favicons.json'), fetched = [];
  let time = 1_000_000;
  const session = { fetch: async (url, init) => { fetched.push({ url, init }); return ok ? response(body, type) : { ok: false, headers: { get: () => type }, arrayBuffer: async () => new ArrayBuffer(0) }; } };
  const store = createFaviconStore({ file, nativeImage, now: () => time });
  return { store, session, fetched, file, advance: (ms) => { time += ms; }, cleanup: () => fs.rmSync(directory, { recursive: true, force: true }) };
}
const visit = (f, over = {}) => f.store.remember({ session: f.session, profileId: 'p1', privateMode: false, pageUrl: 'https://www.Wikipedia.org/wiki/Gogh', iconUrl: 'https://www.wikipedia.org/favicon.ico', ...over });

test('an icon is fetched once without cookies and kept as an image per site, at the size the site sent (up to 96px)', async () => {
  const f = fixture();
  try {
    assert.equal(await visit(f), true);
    assert.deepEqual(f.fetched.map((call) => [call.url, call.init.credentials]), [['https://www.wikipedia.org/favicon.ico', 'omit']]);
    assert.deepEqual(f.store.list('p1', new Set(['wikipedia.org'])), { 'wikipedia.org': urlOf(png(64)) }, 'not shrunk to 32px any more: a New Tab tile draws it 48 to 72 device pixels wide');
    assert.equal(await visit(f), false, 'the same icon is not fetched again within a week');
    assert.equal(f.fetched.length, 1);
    f.advance(8 * 86400000);
    assert.equal(await visit(f), true, 'a week later it is refreshed');
    assert.equal(await visit(f, { iconUrl: 'https://www.wikipedia.org/other.png' }), true, 'a different icon address is taken at once');
  } finally { f.cleanup(); }
});

test('a bigger picture is shrunk to 96px, an .ico is kept as its one best picture and an SVG as it is', async () => {
  const big = fixture({ body: png(192) }), made = fixture({ type: 'image/x-icon', body: ico([16, 32, 48, 64]) }), vector = fixture({ type: 'image/svg+xml', body: svg() });
  try {
    await visit(big);
    assert.deepEqual(inspect(Buffer.from(big.store.list('p1', new Set(['wikipedia.org']))['wikipedia.org'].split(',')[1], 'base64')), { kind: 'png', width: 96, height: 96, vector: false });
    await visit(made);
    const kept = made.store.list('p1', new Set(['wikipedia.org']))['wikipedia.org'];
    assert.match(kept, /^data:image\/x-icon;base64,/, 'an .ico used to come back empty from Electron and was never kept');
    assert.deepEqual(inspect(Buffer.from(kept.split(',')[1], 'base64')), { kind: 'ico', width: 48, height: 48, vector: false });
    await visit(vector);
    assert.match(vector.store.list('p1', new Set(['wikipedia.org']))['wikipedia.org'], /^data:image\/svg\+xml;base64,/);
  } finally { big.cleanup(); made.cleanup(); vector.cleanup(); }
});

test('the file the tab already fetched is kept with no second request; icons from before this version are refreshed at the next visit', async () => {
  const f = fixture();
  try {
    const tab = { bytes: ico([16, 48]) };
    assert.equal(await f.store.remember({ profileId: 'p1', privateMode: false, pageUrl: 'https://www.wikipedia.org/', iconUrl: 'https://www.wikipedia.org/favicon.ico', icon: tab }), true);
    assert.equal(f.fetched.length, 0, 'the site was not asked again');
    assert.match(f.store.list('p1', new Set(['wikipedia.org']))['wikipedia.org'], /^data:image\/x-icon/);
    assert.equal(await f.store.remember({ profileId: 'p1', privateMode: true, pageUrl: 'https://www.wikipedia.org/', iconUrl: 'https://www.wikipedia.org/favicon.ico', icon: tab }), false, 'a private window keeps nothing');
    assert.equal(await f.store.remember({ profileId: 'p1', privateMode: false, pageUrl: 'https://www.wikipedia.org/', iconUrl: 'https://www.wikipedia.org/favicon.ico', icon: { bytes: Buffer.from('<html>') } }), false, 'not a picture');
    f.store.flush();
    const old = JSON.parse(fs.readFileSync(f.file, 'utf8')); delete old.profiles.p1['wikipedia.org'].v; fs.writeFileSync(f.file, JSON.stringify(old));
    const again = createFaviconStore({ file: f.file, nativeImage, now: () => 1_000_000 });
    assert.equal(await again.remember({ profileId: 'p1', privateMode: false, pageUrl: 'https://www.wikipedia.org/', iconUrl: 'https://www.wikipedia.org/favicon.ico', icon: tab }), true, 'a 32px copy from beta.10 is replaced by the sharper one at once, not after a week');
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
  for (const options of [{ ok: false }, { type: 'text/html' }, { body: Buffer.alloc(0) }, { body: Buffer.alloc(300 * 1024) }, { body: Buffer.from('<html>not an icon</html>'), type: 'image/png' }, { body: Buffer.concat([png(64), Buffer.alloc(300 * 1024)]) }]) {
    const g = fixture(options);
    try { assert.equal(await visit(g), false, JSON.stringify({ ...options, body: options.body && options.body.length })); assert.deepEqual(g.store.list('p1', new Set(['wikipedia.org'])), {}); } finally { g.cleanup(); }
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

test('icons from another browser\'s import are kept the same way: .ico and PNG, never replacing a real visit', () => {
  const f = fixture();
  try {
    assert.equal(f.store.adopt('p1', new Map([['a.example', png(32)], ['b.example', ico([16, 32])], ['c.example', Buffer.from('nope')], ['WWW.D.example', png(64)]])), 3);
    const icons = f.store.list('p1', new Set(['a.example', 'b.example', 'c.example', 'www.d.example']));
    assert.deepEqual(Object.keys(icons).sort(), ['a.example', 'b.example', 'www.d.example']);
    assert.match(icons['b.example'], /^data:image\/x-icon/);
    assert.equal(f.store.adopt('p1', new Map([['a.example', png(64)]])), 0, 'an icon already there is kept');
  } finally { f.cleanup(); }
});

test('icons survive a restart and the store stays bounded', async () => {
  const f = fixture();
  try {
    await visit(f);
    f.store.flush();
    const again = createFaviconStore({ file: f.file, nativeImage });
    assert.deepEqual(again.list('p1', new Set(['wikipedia.org'])), { 'wikipedia.org': urlOf(png(64)) });
    for (let index = 0; index < 405; index++) { f.advance(10); await visit(f, { pageUrl: `https://site${index}.example/`, iconUrl: `https://site${index}.example/i.png` }); }
    const hosts = new Set(Array.from({ length: 405 }, (_, index) => `site${index}.example`).concat('wikipedia.org'));
    assert.ok(Object.keys(f.store.list('p1', hosts)).length <= 400);
  } finally { f.cleanup(); }
});
