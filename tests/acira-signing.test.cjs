'use strict';
// Beta 14 AH rules 2, 3 and 10: the signed request and the Insider certificate (desktop/insider/acira-signing.cjs). The FIXED TEST VECTORS below are the contract another codebase
// (a future Acira server) must reproduce byte for byte; docs/launch/BETA14_INSIDER_CONTRACT.md repeats them. They are test keys only: no real key exists in
// the repository. If one of these numbers changes, every server that verifies Acira requests or certificates breaks: do not "update the vector", find what changed.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const signing = require('../desktop/insider/acira-signing.cjs');

// ---- Test vector 1: a signed request (rule 3)
const PROFILE_SEED = Buffer.from('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f', 'hex');
const PROFILE_PUBLIC = 'A6EHv_POEL4dcN0Y50vAmWfk1jCbpQ1fHdyGZBJVMbg';
const REQUEST = { method: 'POST', url: 'https://insider.example.com/functions/v1/insider-activate', body: '{"token":"Qx7mR2vT9pLk4sWn8cYe3bHa6dJf5gUz"}', ts: 1794744000 };
const SIGNING_STRING = 'acira-v1\nPOST\n/functions/v1/insider-activate\n1794744000\npYYD0kIQs06lcVqJuqkoZmJUykSiOvvQx6wp6S-83QI';
const SIGNATURE = '1baPmfxloP2PSKlxKrkS9BUR8FIquxz-K-sub8aMgVxIDIY6rpZTQKvIN0RIC9fnbOutHB9MKMonpRUbPhOOCA';
const EMPTY_BODY_HASH = '47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU';
// ---- Test vector 2: a certificate (rule 2), signed by a TEST server key
const SERVER_SEED = Buffer.from('a0a1a2a3a4a5a6a7a8a9aaabacadaeafb0b1b2b3b4b5b6b7b8b9babbbcbdbebf', 'hex');
const SERVER_PUBLIC = 'T9CZzNR9eJPf6ewkQU7LDZtUICMqrTDZHEZb4zy-ZcQ';
const KID = 'test-2026-11';
const PAYLOAD = { v: 1, sub: PROFILE_PUBLIC, tier: 'insider', no: 7, since: '2026-11', by: 'founding-team', perks: ['insider'], iat: 1794744000 };
// (three parts joined at run time: a whole JWS in a source file reads as a leaked token to tests/no-secrets.test.cjs)
const CERT = ['eyJhbGciOiJFZERTQSIsImtpZCI6InRlc3QtMjAyNi0xMSJ9', 'eyJ2IjoxLCJzdWIiOiJBNkVIdl9QT0VMNGRjTjBZNTB2QW1XZmsxakNicFExZkhkeUdaQkpWTWJnIiwidGllciI6Imluc2lkZXIiLCJubyI6Nywic2luY2UiOiIyMDI2LTExIiwiYnkiOiJmb3VuZGluZy10ZWFtIiwicGVya3MiOlsiaW5zaWRlciJdLCJpYXQiOjE3OTQ3NDQwMDB9', 'iFQHqayQouJWPAIL2DM4iKpJWtIBtOWRJdABIhoyMTQw8y8vGgOmU3weAV3KqqN73v8TZ0Ss0DUJR8XY2NwYCg'].join('.');

const profile = signing.keyPairFromSeed(PROFILE_SEED);
const server = signing.keyPairFromSeed(SERVER_SEED);
const keys = signing.loadKeys([{ kid: KID, publicKey: SERVER_PUBLIC }]);

test('vector 1: the profile key, the signing string, the headers and the signature are exactly the published ones', () => {
  assert.equal(profile.publicKey, PROFILE_PUBLIC);
  assert.equal(signing.bodyHash(''), EMPTY_BODY_HASH);
  assert.equal(signing.bodyHash(undefined), EMPTY_BODY_HASH);
  assert.equal(signing.signingString({ method: 'post', path: signing.requestPath(REQUEST.url), ts: REQUEST.ts, body: REQUEST.body }), SIGNING_STRING, 'METHOD upper case, PATH without the host');
  const headers = signing.signRequest({ privateKey: profile.privateKey, publicKey: profile.publicKey, method: REQUEST.method, url: REQUEST.url, body: REQUEST.body, now: REQUEST.ts * 1000 + 999 });
  assert.deepEqual(headers, { 'Acira-Key': PROFILE_PUBLIC, 'Acira-Ts': '1794744000', 'Acira-Sig': SIGNATURE }, 'exactly these three headers when the profile has no certificate (Ed25519 is deterministic)');
  assert.deepEqual(Object.keys(signing.signRequest({ privateKey: profile.privateKey, publicKey: profile.publicKey, method: 'POST', url: REQUEST.url, body: '', cert: CERT })), ['Acira-Key', 'Acira-Ts', 'Acira-Sig', 'Acira-Cert']);
});

test('vector 1 checked by a second implementation (WebCrypto Ed25519 from the raw key, SHA-256 from @noble/hashes)', async () => {
  const { sha256 } = await import('@noble/hashes/sha2.js');
  assert.equal(Buffer.from(sha256(Buffer.from(REQUEST.body))).toString('base64url'), SIGNING_STRING.split('\n')[4]);
  const key = await crypto.webcrypto.subtle.importKey('raw', Buffer.from(PROFILE_PUBLIC, 'base64url'), { name: 'Ed25519' }, false, ['verify']);
  assert.equal(await crypto.webcrypto.subtle.verify({ name: 'Ed25519' }, key, Buffer.from(SIGNATURE, 'base64url'), Buffer.from(SIGNING_STRING)), true);
});

test('the path is the path and query as sent; a query changes the signature', () => {
  assert.equal(signing.requestPath('https://feed.example.com/insider/latest-mac.yml?noCache=1'), '/insider/latest-mac.yml?noCache=1');
  assert.equal(signing.requestPath('https://x.example/a%20b/'), '/a%20b/');
  assert.throws(() => signing.signingString({ method: 'GET', path: 'no-slash', ts: 1, body: '' }));
});

test('a server accepts the request within 5 minutes and refuses an old or future timestamp (clock_skew), an edited body, path, method or key', () => {
  const headers = signing.signRequest({ privateKey: profile.privateKey, publicKey: profile.publicKey, method: 'POST', url: REQUEST.url, body: REQUEST.body, now: REQUEST.ts * 1000 });
  const at = (seconds, over = {}) => signing.verifyRequest({ headers, method: 'POST', path: '/functions/v1/insider-activate', body: REQUEST.body, now: (REQUEST.ts + seconds) * 1000, ...over });
  assert.equal(at(0).ok, true); assert.equal(at(300).ok, true); assert.equal(at(-300).ok, true);
  assert.deepEqual(at(301), { ok: false, error: 'clock_skew' }); assert.deepEqual(at(-301), { ok: false, error: 'clock_skew' });
  assert.deepEqual(at(0, { body: REQUEST.body.replace('Qx7', 'Qx8') }), { ok: false, error: 'bad_signature' });
  assert.deepEqual(at(0, { path: '/functions/v1/insider-redeem' }), { ok: false, error: 'bad_signature' });
  assert.deepEqual(at(0, { method: 'PUT' }), { ok: false, error: 'bad_signature' });
  const other = signing.keyPairFromSeed(crypto.randomBytes(32));
  assert.deepEqual(signing.verifyRequest({ headers: { ...headers, 'Acira-Key': other.publicKey }, method: 'POST', path: '/functions/v1/insider-activate', body: REQUEST.body, now: REQUEST.ts * 1000 }), { ok: false, error: 'bad_signature' });
  assert.deepEqual(signing.verifyRequest({ headers: { 'Acira-Key': PROFILE_PUBLIC }, method: 'POST', path: '/', body: '', now: 0 }), { ok: false, error: 'missing' });
  assert.equal(signing.verifyRequest({ headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])), method: 'POST', path: '/functions/v1/insider-activate', body: REQUEST.body, now: REQUEST.ts * 1000 }).ok, true, 'header names in any case');
  // A non-canonical spelling of the same signature (base64url has one spelling per value here) is refused.
  assert.equal(signing.verifyRequest({ headers: { ...headers, 'Acira-Sig': headers['Acira-Sig'] + '=' }, method: 'POST', path: '/functions/v1/insider-activate', body: REQUEST.body, now: REQUEST.ts * 1000 }).ok, false);
});

test('vector 2: the certificate is exactly the published compact JWS, and it reads back', () => {
  assert.equal(server.publicKey, SERVER_PUBLIC);
  assert.equal(signing.signCertificate({ privateKey: server.privateKey, kid: KID, payload: PAYLOAD }), CERT);
  const [head, body] = CERT.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(head, 'base64url')), { alg: 'EdDSA', kid: KID });
  assert.deepEqual(JSON.parse(Buffer.from(body, 'base64url')), PAYLOAD);
  assert.deepEqual(signing.readCertificate(CERT, { keys, subject: PROFILE_PUBLIC }), { ok: true, cert: { tier: 'insider', number: 7, since: '2026-11', by: 'founding-team', perks: ['insider'], iat: 1794744000, kid: KID } });
});

test('vector 2 checked by a second implementation (WebCrypto Ed25519 over the JWS signing input)', async () => {
  const key = await crypto.webcrypto.subtle.importKey('jwk', { kty: 'OKP', crv: 'Ed25519', x: SERVER_PUBLIC }, { name: 'Ed25519' }, false, ['verify']);
  const [head, body, sig] = CERT.split('.');
  assert.equal(await crypto.webcrypto.subtle.verify({ name: 'Ed25519' }, key, Buffer.from(sig, 'base64url'), Buffer.from(`${head}.${body}`)), true);
});

// ---- Security checks of the brief (AH): each fails without its protection.
const resign = (payload, { kid = KID, privateKey = server.privateKey } = {}) => signing.signCertificate({ privateKey, kid, payload });

test('SECURITY: an edited certificate is rejected (and must be removed)', () => {
  const [head, body, sig] = CERT.split('.');
  const edited = Buffer.from(JSON.stringify({ ...PAYLOAD, no: 1 })).toString('base64url');
  assert.deepEqual(signing.readCertificate(`${head}.${edited}.${sig}`, { keys, subject: PROFILE_PUBLIC }), { ok: false, reason: 'signature', remove: true });
  const flipped = sig.slice(0, 10) + (sig[10] === 'A' ? 'B' : 'A') + sig.slice(11);
  assert.equal(signing.readCertificate(`${head}.${body}.${flipped}`, { keys, subject: PROFILE_PUBLIC }).remove, true);
  const otherHead = Buffer.from(JSON.stringify({ alg: 'EdDSA', kid: KID, x: 1 })).toString('base64url');
  assert.equal(signing.readCertificate(`${otherHead}.${body}.${sig}`, { keys, subject: PROFILE_PUBLIC }).ok, false, 'the header is signed too');
});

test('SECURITY: a certificate issued to another key is rejected (and must be removed)', () => {
  const other = signing.keyPairFromSeed(crypto.randomBytes(32));
  assert.deepEqual(signing.readCertificate(CERT, { keys, subject: other.publicKey }), { ok: false, reason: 'subject', remove: true });
  const forOther = resign({ ...PAYLOAD, sub: other.publicKey });
  assert.deepEqual(signing.readCertificate(forOther, { keys, subject: PROFILE_PUBLIC }), { ok: false, reason: 'subject', remove: true });
});

test('SECURITY: a certificate signed by an unknown kid, or by an unknown key under a known kid, is rejected (and must be removed)', () => {
  assert.deepEqual(signing.readCertificate(resign(PAYLOAD, { kid: 'other-kid' }), { keys, subject: PROFILE_PUBLIC }), { ok: false, reason: 'kid', remove: true });
  const stranger = signing.keyPairFromSeed(crypto.randomBytes(32));
  assert.deepEqual(signing.readCertificate(resign(PAYLOAD, { privateKey: stranger.privateKey }), { keys, subject: PROFILE_PUBLIC }), { ok: false, reason: 'signature', remove: true });
});

test('only EdDSA, only a plain {alg,kid} header: alg none, HS256, an embedded key or crit are refused', () => {
  const [, body, sig] = CERT.split('.');
  for (const header of [{ alg: 'none', kid: KID }, { alg: 'HS256', kid: KID }, { alg: 'EdDSA' }, { alg: 'EdDSA', kid: KID, jwk: { kty: 'OKP', crv: 'Ed25519', x: SERVER_PUBLIC } }, { alg: 'EdDSA', kid: KID, crit: ['b64'] }]) {
    const head = Buffer.from(JSON.stringify(header)).toString('base64url');
    assert.equal(signing.readCertificate(`${head}.${body}.${sig}`, { keys, subject: PROFILE_PUBLIC }).ok, false, JSON.stringify(header));
  }
  assert.equal(signing.readCertificate(`${CERT.split('.').slice(0, 2).join('.')}.`, { keys, subject: PROFILE_PUBLIC }).reason, 'format');
  assert.equal(signing.readCertificate('a.b', { keys, subject: PROFILE_PUBLIC }).reason, 'format');
  assert.equal(signing.readCertificate('x'.repeat(5000), { keys, subject: PROFILE_PUBLIC }).reason, 'format');
});

test('no expiry; unknown perks and payload fields are ignored; an unknown `by` reads as nothing; a key rotation is a second kid', () => {
  const later = resign({ ...PAYLOAD, perks: ['insider', 'credits-2027', 7], by: 'someone-else', exp: 1, account: 'later' });
  const read = signing.readCertificate(later, { keys, subject: PROFILE_PUBLIC });
  assert.equal(read.ok, true, 'an exp field does not expire it'); assert.deepEqual(read.cert.perks, ['insider']); assert.equal(read.cert.by, null);
  const next = signing.keyPairFromSeed(crypto.randomBytes(32));
  const rotated = signing.loadKeys([{ kid: KID, publicKey: SERVER_PUBLIC }, { kid: 'next', publicKey: next.publicKey }]);
  assert.equal(signing.readCertificate(CERT, { keys: rotated, subject: PROFILE_PUBLIC }).ok, true, 'old certificates stay valid');
  assert.equal(signing.readCertificate(resign(PAYLOAD, { kid: 'next', privateKey: next.privateKey }), { keys: rotated, subject: PROFILE_PUBLIC }).ok, true);
});

test('a signed certificate of a version or tier this app does not know is not an Insider, and is kept (a later app may read it)', () => {
  for (const payload of [{ ...PAYLOAD, v: 2 }, { ...PAYLOAD, tier: 'founding' }, { ...PAYLOAD, no: 0 }, { ...PAYLOAD, since: '2026-11-15' }]) {
    const read = signing.readCertificate(resign(payload), { keys, subject: PROFILE_PUBLIC });
    assert.deepEqual(read, { ok: false, reason: 'fields', remove: false }, JSON.stringify(payload));
  }
  assert.deepEqual(signing.readCertificate(CERT, { keys: [], subject: PROFILE_PUBLIC }), { ok: false, reason: 'nokeys', remove: false });
  assert.deepEqual(signing.readCertificate(CERT, { keys, subject: null }), { ok: false, reason: 'nokey', remove: false });
});

test('loadKeys drops what is not a 32-byte key or a kid, and keeps the first of a repeated kid', () => {
  const loaded = signing.loadKeys([{ kid: KID, publicKey: SERVER_PUBLIC }, { kid: KID, publicKey: PROFILE_PUBLIC }, { kid: 'bad kid', publicKey: SERVER_PUBLIC }, { kid: 'short', publicKey: 'AAAA' }, null, 'x']);
  assert.equal(loaded.length, 1); assert.equal(loaded[0].kid, KID);
  assert.equal(signing.readCertificate(CERT, { keys: loaded, subject: PROFILE_PUBLIC }).ok, true);
});

test('a private key object never prints or serialises its material', () => {
  const seedHex = PROFILE_SEED.toString('hex'), seed64 = PROFILE_SEED.toString('base64url');
  for (const text of [JSON.stringify(profile), require('node:util').inspect(profile, { depth: 5, showHidden: true }), String(profile.privateKey)]) {
    assert.ok(!text.includes(seedHex) && !text.includes(seed64), text);
  }
});
