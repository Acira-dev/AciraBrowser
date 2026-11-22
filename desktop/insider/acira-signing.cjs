'use strict';
// Beta 14 AH rules 2, 3 and 10 (and E2): THE ONE PLACE where Acira's request signature and Insider certificate are made and read. Kept small and free of Electron so another
// codebase (a future Acira server) can match it byte for byte: tests/acira-signing.test.cjs holds fixed test vectors (a fixed key, a fixed request,
// the expected signature; a fixed server key, a fixed payload, the expected certificate) and the Insider contract repeats them. NEVER change a format here
// without a new prefix or version: other servers verify these bytes.
//
// 1. A signed request (rule 3). The profile's Ed25519 private key signs exactly
//      "acira-v1\n" + METHOD + "\n" + PATH + "\n" + TIMESTAMP + "\n" + base64url(SHA-256(body))
//    METHOD upper case; PATH the request's path as sent (pathname plus "?query" when there is one, no host); TIMESTAMP unix seconds in decimal; body the exact bytes sent ("" when
//    there are none). Headers: Acira-Key (the raw 32-byte public key, base64url), Acira-Ts, Acira-Sig (64 bytes, base64url) and Acira-Cert (the certificate, when the profile has
//    one). No shared secret, no cookie, no nonce: a server refuses a timestamp more than 5 minutes from its own clock ("clock_skew").
// 2. A certificate (rule 2). A compact JWS: base64url(header) "." base64url(payload) "." base64url(signature), EdDSA (Ed25519) over the ASCII of the first two parts. Header
//    {"alg":"EdDSA","kid":"<id>"}; payload {"v":1,"sub":"<profile public key, base64url>","tier":"insider","no":7,"since":"2026-11","by":"founding-team"|"member","perks":["insider"],"iat":<s>}.
//    No expiry. It is valid only when a shipped key with that kid verifies it AND sub equals this profile's own public key. Unknown perks are ignored; nothing else of the payload is read.
// base64url is always without padding and must be canonical (re-encoding gives the same text), so one value has one spelling.
const crypto = require('node:crypto');

const PREFIX = 'acira-v1';
const HEADERS = Object.freeze({ key: 'Acira-Key', ts: 'Acira-Ts', sig: 'Acira-Sig', cert: 'Acira-Cert' });
const MAX_SKEW_SECONDS = 300;
const CERT_MAX = 4096;
const KID = /^[A-Za-z0-9_.-]{1,32}$/;
const B64U = /^[A-Za-z0-9_-]+$/;
const SINCE = /^\d{4}-(?:0[1-9]|1[0-2])$/;
/** The tiers this version knows (rule 2: "tier": "insider"). A certificate of another tier is not an Insider here, and is left alone (a later version may read it). */
const TIERS = Object.freeze(['insider']);
/** The perks this version knows. `perks` is a list so a new perk needs no app update: unknown values are ignored. */
const KNOWN_PERKS = Object.freeze(['insider']);
const BY = Object.freeze(['founding-team', 'member']);
/** The fixed DER prefixes of an Ed25519 key: SPKI (the 32-byte public key follows) and PKCS#8 (the 32-byte seed follows). */
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

const b64u = (bytes) => Buffer.from(bytes).toString('base64url');
/** The bytes of a canonical base64url text (of `length` bytes when given), or null. */
function fromB64u(text, length) {
  if (typeof text !== 'string' || !text.length || !B64U.test(text)) return null;
  const raw = Buffer.from(text, 'base64url');
  if (b64u(raw) !== text || (length !== undefined && raw.length !== length)) return null;
  return raw;
}

/** The profile's key pair from its 32-byte seed: {privateKey (a KeyObject, never serialisable), publicKey (base64url of the raw 32 bytes)}. */
function keyPairFromSeed(seed) {
  if (!Buffer.isBuffer(seed) || seed.length !== 32) throw new Error('An Ed25519 seed is 32 bytes.');
  const privateKey = crypto.createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, seed]), format: 'der', type: 'pkcs8' });
  const raw = crypto.createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).subarray(SPKI_PREFIX.length);
  return { privateKey, publicKey: b64u(raw) };
}
/** A public key object from the raw 32 bytes in base64url, or null. */
function publicKeyFrom(text) {
  const raw = fromB64u(text, 32);
  if (!raw) return null;
  try { return crypto.createPublicKey({ key: Buffer.concat([SPKI_PREFIX, raw]), format: 'der', type: 'spki' }); } catch { return null; }
}

/** base64url(SHA-256(body)). `body` is the exact text or bytes sent; none is "". */
const bodyHash = (body) => b64u(crypto.createHash('sha256').update(body === undefined || body === null ? '' : body).digest());
/** The PATH of rule 3 for a full address: its path and query exactly as sent, without the host. */
function requestPath(url) { const parsed = new URL(url); return parsed.pathname + parsed.search; }
/** The exact text a request's signature covers (rule 3). */
function signingString({ method, path, ts, body }) {
  if (typeof path !== 'string' || !path.startsWith('/')) throw new Error('A request path starts with "/".');
  if (!Number.isSafeInteger(ts) || ts < 0) throw new Error('A timestamp is whole unix seconds.');
  return `${PREFIX}\n${String(method).toUpperCase()}\n${path}\n${ts}\n${bodyHash(body)}`;
}

/** The headers of one signed request. `url` (or `path`) is where it goes, `body` exactly what is sent, `cert` the profile's certificate when it has one. */
function signRequest({ privateKey, publicKey, method, url, path = url === undefined ? undefined : requestPath(url), body = '', cert = null, now = Date.now() }) {
  const ts = Math.floor(now / 1000);
  const signature = crypto.sign(null, Buffer.from(signingString({ method, path, ts, body }), 'utf8'), privateKey);
  const headers = { [HEADERS.key]: publicKey, [HEADERS.ts]: String(ts), [HEADERS.sig]: b64u(signature) };
  if (typeof cert === 'string' && cert.length) headers[HEADERS.cert] = cert;
  return headers;
}

/** A header's value whatever its case ({} of Node's lower-case names, a fetch Headers, or the names as sent). */
function headerOf(headers, name) {
  if (!headers) return undefined;
  if (typeof headers.get === 'function') return headers.get(name) ?? undefined;
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) if (key.toLowerCase() === lower) return Array.isArray(value) ? value[0] : value;
  return undefined;
}

/**
 * What a server does with a signed request (the local fake uses it; a future Acira server does the same in its own language): the headers are there and well formed, the timestamp
 * is within 5 minutes of the server's clock, and the signature over the rebuilt string verifies with Acira-Key. {ok:true, key, ts, cert} or {ok:false, error}:
 * 'missing' (a header is not there) · 'bad_key' · 'clock_skew' · 'bad_signature'.
 */
function verifyRequest({ headers, method, path, body = '', now = Date.now(), maxSkew = MAX_SKEW_SECONDS }) {
  const key = headerOf(headers, HEADERS.key), ts = headerOf(headers, HEADERS.ts), sig = headerOf(headers, HEADERS.sig), cert = headerOf(headers, HEADERS.cert);
  if (![key, ts, sig].every((value) => typeof value === 'string' && value.length > 0 && value.length <= 200)) return { ok: false, error: 'missing' };
  const publicKey = publicKeyFrom(key);
  if (!publicKey) return { ok: false, error: 'bad_key' };
  if (!/^\d{1,12}$/.test(ts)) return { ok: false, error: 'clock_skew' };
  const seconds = Number(ts);
  if (Math.abs(Math.floor(now / 1000) - seconds) > maxSkew) return { ok: false, error: 'clock_skew' };
  const signature = fromB64u(sig, 64);
  if (!signature) return { ok: false, error: 'bad_signature' };
  let good = false;
  try { good = crypto.verify(null, Buffer.from(signingString({ method, path, ts: seconds, body }), 'utf8'), publicKey, signature); } catch { good = false; }
  if (!good) return { ok: false, error: 'bad_signature' };
  return { ok: true, key, ts: seconds, cert: typeof cert === 'string' && cert.length ? cert : null };
}

/** Makes a certificate (the server's side: the local fake and the test vectors; the app never holds a signing key). */
function signCertificate({ privateKey, kid, payload }) {
  if (!KID.test(String(kid))) throw new Error('A kid is 1 to 32 of A-Z a-z 0-9 _ . -');
  const head = b64u(JSON.stringify({ alg: 'EdDSA', kid })), body = b64u(JSON.stringify(payload));
  return `${head}.${body}.${b64u(crypto.sign(null, Buffer.from(`${head}.${body}`, 'ascii'), privateKey))}`;
}

/** The shipped public keys: [{kid, publicKey (raw 32 bytes, base64url)}] -> [{kid, key}]; anything that is not a key is dropped. */
function loadKeys(list) {
  const keys = [];
  for (const item of Array.isArray(list) ? list : []) {
    if (!item || !KID.test(String(item.kid)) || keys.some((known) => known.kid === item.kid)) continue;
    const key = publicKeyFrom(item.publicKey);
    if (key) keys.push({ kid: String(item.kid), key });
  }
  return keys;
}

const parseJson = (raw) => { try { const value = JSON.parse(raw.toString('utf8')); return value && typeof value === 'object' && !Array.isArray(value) ? value : null; } catch { return null; } };

/**
 * Reads a certificate for the profile whose public key is `subject` (base64url), against the shipped `keys` (loadKeys' result).
 * {ok:true, cert:{tier, number, since, by, perks, iat, kid}} or {ok:false, reason, remove}. `remove` says the stored certificate must go (rule 2: it fails the signature or the
 * key check): 'format' (not a compact EdDSA JWS), 'kid' (no shipped key has its kid), 'signature', 'subject' (issued to another key). Kept (remove false): 'none' (no token),
 * 'nokeys' (the programme ships no key yet), 'nokey' (this profile's own key cannot be read right now), 'fields' (signed and ours, but a version or tier this app does not know).
 */
function readCertificate(token, { keys, subject }) {
  if (typeof token !== 'string' || !token.length) return { ok: false, reason: 'none', remove: false };
  if (!Array.isArray(keys) || !keys.length) return { ok: false, reason: 'nokeys', remove: false };
  const bad = (reason) => ({ ok: false, reason, remove: true });
  if (token.length > CERT_MAX) return bad('format');
  const parts = token.split('.');
  if (parts.length !== 3) return bad('format');
  const [headText, bodyText, sigText] = parts;
  const headRaw = fromB64u(headText), bodyRaw = fromB64u(bodyText), signature = fromB64u(sigText, 64);
  if (!headRaw || !bodyRaw || !signature) return bad('format');
  const head = parseJson(headRaw);
  if (!head || head.alg !== 'EdDSA' || typeof head.kid !== 'string' || !KID.test(head.kid) || 'crit' in head || 'jwk' in head || 'jku' in head || 'x5u' in head || 'x5c' in head) return bad('format');
  const shipped = keys.find((item) => item.kid === head.kid);
  if (!shipped) return bad('kid');
  let signed = false;
  try { signed = crypto.verify(null, Buffer.from(`${headText}.${bodyText}`, 'ascii'), shipped.key, signature); } catch { signed = false; }
  if (!signed) return bad('signature');
  const body = parseJson(bodyRaw);
  if (!body || !fromB64u(body.sub, 32)) return bad('format');
  if (typeof subject !== 'string' || !subject.length) return { ok: false, reason: 'nokey', remove: false };
  if (body.sub !== subject) return bad('subject');
  const number = body.no;
  const valid = body.v === 1 && TIERS.includes(body.tier) && Number.isInteger(number) && number >= 1 && number <= 10_000_000
    && typeof body.since === 'string' && SINCE.test(body.since) && Number.isInteger(body.iat) && body.iat > 0;
  if (!valid) return { ok: false, reason: 'fields', remove: false };
  const perks = Array.isArray(body.perks) ? [...new Set(body.perks.filter((perk) => KNOWN_PERKS.includes(perk)))] : [];
  return { ok: true, cert: { tier: body.tier, number, since: body.since, by: BY.includes(body.by) ? body.by : null, perks, iat: body.iat, kid: head.kid } };
}

module.exports = {
  PREFIX, HEADERS, MAX_SKEW_SECONDS, CERT_MAX, TIERS, KNOWN_PERKS, BY, SPKI_PREFIX, PKCS8_PREFIX,
  b64u, fromB64u, keyPairFromSeed, publicKeyFrom, bodyHash, requestPath, signingString, signRequest, verifyRequest, headerOf, signCertificate, loadKeys, readCertificate,
};
