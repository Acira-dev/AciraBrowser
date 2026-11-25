'use strict';
// Profile transfer, protocol 2: every cryptographic step, as small pure functions with no network and no state (section 7 of
// the design notes). Only primitives that ship in Node and in Electron's Node (BoringSSL) are used: scrypt, HKDF-SHA256,
// HMAC-SHA256, X25519, AES-256-GCM and Brotli. tests/transfer-crypto.test.cjs freezes the outputs for a fixed code, fixed keys and fixed nonces,
// and runs under Electron too, so a Windows and a Mac install always derive the same bytes.
//
// Encoding, exactly as in section 7.0 (the frozen test vectors depend on every line of this):
//   LP(x)       = uint16BE(byteLength(x)) || x. Every `|` in the spec joins LP-wrapped fields, whatever their type: a number is its uint32BE
//                 (or one byte) wrapped like any other field. A string is its UTF-8 bytes. `||` is a plain concatenation.
//   slot        = 16 raw bytes inside MACs and AADs, 32 lowercase hex characters on the wire.
//   public keys = 32 raw bytes (X25519). On the wire every binary field is base64url without padding.
//   infoA/infoB = nonce(12) || ciphertext || tag(16); the plaintext is UTF-8 JSON; the AAD is the ASCII text "acira/v2/infoA|" or
//                 "acira/v2/infoB|" followed by the 16 raw slot bytes (a plain concatenation, not LP fields).
//   chunk i     = AES-256-GCM(session key, nonce = 4 zero bytes || uint64BE(i), AAD = LP("acira/v2/chunk") | LP(transcript) | LP(u32 i) |
//                 LP(u32 n) | LP(u8 last)) -> ciphertext || tag(16); n is the number of data chunks, last is 1 for i == n.
// Nothing in this file logs, and nothing here keeps a key: callers hold the keys and drop them with wipe().
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { promisify } = require('node:util');
const C = require('./constants.cjs');

const scryptAsync = promisify(crypto.scrypt);
const brotliCompressAsync = promisify(zlib.brotliCompress);
const brotliDecompressAsync = promisify(zlib.brotliDecompress);

/** Every failure here: `code` is one of tamper (a MAC or an info block did not verify), damaged (a chunk, a hash or the compressed data is wrong),
 * wrong_password, not_locked, newer, unsupported, bad_input. The message never carries a key, a code or any payload byte. */
class TransferCryptoError extends Error {
  constructor(code, message) { super(message || code); this.name = 'TransferCryptoError'; this.code = code; }
}

// ---- encoding -------------------------------------------------------------------------------------------------------------------------

const bytes = (value) => (Buffer.isBuffer(value) ? value : value instanceof Uint8Array ? Buffer.from(value) : Buffer.from(String(value), 'utf8'));
function u8(n) { return Buffer.from([n & 0xff]); }
function u16(n) { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; }
function u32(n) { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b; }
function u64(n) { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(n)); return b; }
/** LP(a) | LP(b) | ...: each field behind its uint16BE length. */
function lp(...fields) {
  const parts = [];
  for (const field of fields) {
    const data = bytes(field);
    if (data.length > 0xffff) throw new TransferCryptoError('bad_input', 'field too long');
    parts.push(u16(data.length), data);
  }
  return Buffer.concat(parts);
}
const b64u = (data) => bytes(data).toString('base64url');
/** Strict base64url (no padding, no other characters) of exactly `length` bytes, or null. */
function fromB64u(text, length) {
  if (typeof text !== 'string' || !/^[A-Za-z0-9_-]*$/.test(text)) return null;
  const data = Buffer.from(text, 'base64url');
  if (b64u(data) !== text) return null;
  return length !== undefined && data.length !== length ? null : data;
}
const hex = (data) => bytes(data).toString('hex');
const sha256 = (...parts) => { const h = crypto.createHash('sha256'); for (const part of parts) h.update(bytes(part)); return h.digest(); };
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();
const hkdf = (ikm, salt, info, length) => Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from(info, 'ascii'), length));
/** Constant-time equality of two byte strings (false at once for different lengths, which are not secret here). */
const same = (a, b) => { const x = bytes(a), y = bytes(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };
/** Overwrites buffers with zeros. */
function wipe(...buffers) { for (const b of buffers) if (Buffer.isBuffer(b) || b instanceof Uint8Array) b.fill(0); }

// ---- from the code (7.1) ----------------------------------------------------------------------------------------------------------------

/** scrypt of the code text (canonical lowercase, single spaces), N 2^17, r 8, p 1: about 400 ms and 128 MiB, off the main thread. */
function deriveMaster(code) {
  if (typeof code !== 'string' || !code) throw new TransferCryptoError('bad_input', 'no code');
  return scryptAsync(Buffer.from(code, 'utf8'), Buffer.from(C.SCRYPT_SALT, 'ascii'), 32, { N: C.SCRYPT_N, r: C.SCRYPT_R, p: C.SCRYPT_P, maxmem: C.SCRYPT_MAXMEM });
}

/** Every key the code gives: the slot, the join proof, and the three keys that never leave the two computers. */
function deriveKeys(master) {
  const empty = Buffer.alloc(0);
  const slotBytes = hkdf(master, empty, 'acira/v2/slot', 16);
  const joinKey = hkdf(master, empty, 'acira/v2/join', 32);
  return {
    slotBytes, slot: hex(slotBytes),
    joinKey, joinHash: hex(sha256(joinKey)),
    macKey: hkdf(master, empty, 'acira/v2/mac', 32),
    infoKey: hkdf(master, empty, 'acira/v2/info', 32),
    codeKey: hkdf(master, empty, 'acira/v2/code', 32),
  };
}
const wipeKeys = (keys) => { if (keys) wipe(keys.slotBytes, keys.joinKey, keys.macKey, keys.infoKey, keys.codeKey); };

// ---- X25519 -----------------------------------------------------------------------------------------------------------------------------

const PKCS8_X25519 = Buffer.from('302e020100300506032b656e04220420', 'hex');
const rawPublicOf = (keyObject) => Buffer.from(crypto.createPublicKey(keyObject).export({ format: 'jwk' }).x, 'base64url');
/** A fresh key pair: { privateKey: KeyObject, publicKey: 32 raw bytes }. */
function generateKeyPair() {
  const { privateKey } = crypto.generateKeyPairSync('x25519');
  return { privateKey, publicKey: rawPublicOf(privateKey) };
}
/** The pair for a given 32-byte private key (the frozen test vectors use fixed ones). */
function keyPairFromSeed(seed) {
  const privateKey = crypto.createPrivateKey({ key: Buffer.concat([PKCS8_X25519, bytes(seed)]), format: 'der', type: 'pkcs8' });
  return { privateKey, publicKey: rawPublicOf(privateKey) };
}
function sharedSecret(privateKey, peerPublic) {
  const raw = bytes(peerPublic);
  if (raw.length !== 32) throw new TransferCryptoError('tamper', 'bad public key');
  let shared;
  try {
    const publicKey = crypto.createPublicKey({ key: { kty: 'OKP', crv: 'X25519', x: b64u(raw) }, format: 'jwk' });
    shared = crypto.diffieHellman({ privateKey, publicKey });
  } catch { throw new TransferCryptoError('tamper', 'bad public key'); }
  if (shared.every((byte) => byte === 0)) throw new TransferCryptoError('tamper', 'bad public key'); // a low-order point
  return shared;
}

// ---- the handshake (7.2) ----------------------------------------------------------------------------------------------------------------

/** A device block for infoA / infoB: JSON, AES-256-GCM under the code's info key. `side` is 'A' or 'B'. `nonce` is only fixed by tests. */
function sealInfo(infoKey, slotBytes, side, info, nonce = crypto.randomBytes(12)) {
  const cipher = crypto.createCipheriv('aes-256-gcm', infoKey, nonce, { authTagLength: C.GCM_TAG });
  cipher.setAAD(Buffer.concat([Buffer.from(`acira/v2/info${side}|`, 'ascii'), slotBytes]));
  const body = Buffer.concat([cipher.update(JSON.stringify(info), 'utf8'), cipher.final()]);
  return Buffer.concat([nonce, body, cipher.getAuthTag()]);
}
/** The device block back as an object; any change to the bytes, the slot or the side throws 'tamper'. */
function openInfo(infoKey, slotBytes, side, sealed) {
  const data = bytes(sealed);
  if (data.length < 12 + C.GCM_TAG + 2) throw new TransferCryptoError('tamper', 'short info');
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', infoKey, data.subarray(0, 12), { authTagLength: C.GCM_TAG });
    decipher.setAAD(Buffer.concat([Buffer.from(`acira/v2/info${side}|`, 'ascii'), slotBytes]));
    decipher.setAuthTag(data.subarray(data.length - C.GCM_TAG));
    const info = JSON.parse(Buffer.concat([decipher.update(data.subarray(12, data.length - C.GCM_TAG)), decipher.final()]).toString('utf8'));
    if (!info || typeof info !== 'object' || Array.isArray(info)) throw new Error('not an object');
    return info;
  } catch { throw new TransferCryptoError('tamper', 'info did not verify'); }
}

/** macB = HMAC(macKey, "B" | slot | pkB | infoB). */
const macB = (macKey, slotBytes, pkB, infoB) => hmac(macKey, lp('B', slotBytes, pkB, infoB));
/** macA = HMAC(macKey, "A" | slot | pkA | pkB | infoA). */
const macA = (macKey, slotBytes, pkA, pkB, infoA) => hmac(macKey, lp('A', slotBytes, pkA, pkB, infoA));
/** transcript = SHA-256("acira/v2" | slot | pkA | pkB). */
const transcriptOf = (slotBytes, pkA, pkB) => sha256(lp('acira/v2', slotBytes, pkA, pkB));

/** The session key and the two-digit number both computers derive, from their X25519 secret, the peer's public key, the code's key and the
 * transcript: { session: 32 bytes, number: 10..99 }. A wrong code, a swapped key or a different transcript gives different results. */
function deriveSession({ privateKey, peerPublic, codeKey, transcript }) {
  const shared = sharedSecret(privateKey, peerPublic);
  const ikm = Buffer.concat([shared, codeKey]);
  const session = hkdf(ikm, transcript, 'acira/v2/session', 32);
  const sas = hkdf(ikm, transcript, 'acira/v2/sas', 4);
  wipe(shared, ikm);
  return { session, number: 10 + (sas.readUInt32BE(0) % 90) };
}

/** approveMac = HMAC(macKey, "OK" | transcript | u32(totalChunks) | u32(totalBytes)): A's yes, bound to exactly what it will send. */
const approveMac = (macKey, transcript, totalChunks, totalBytes) => hmac(macKey, lp('OK', transcript, u32(totalChunks), u32(totalBytes)));

/** The number the person types, as the two digits "10".."99" in Western digits, or null. Arabic-Indic and Persian digits are accepted. */
function readNumber(input) {
  const text = String(input ?? '').replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x660)).replace(/[\u06f0-\u06f9]/g, (d) => String(d.charCodeAt(0) - 0x6f0)).trim();
  return /^[1-9][0-9]$/.test(text) ? text : null;
}

// ---- data (7.3) -------------------------------------------------------------------------------------------------------------------------

/** Brotli quality 9, off the main thread. */
function pack(data) {
  const input = bytes(data);
  return brotliCompressAsync(input, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: input.length } });
}
/** Brotli back, refusing to inflate past `limit` bytes (a small file that expands to gigabytes is a bomb). Any failure is 'damaged'. */
async function unpack(data, limit = C.MAX_INFLATED) {
  try { return await brotliDecompressAsync(bytes(data), { maxOutputLength: limit }); } catch { throw new TransferCryptoError('damaged', 'the data could not be unpacked'); }
}

const chunkNonce = (i) => Buffer.concat([Buffer.alloc(4), u64(i)]);
const chunkAad = (transcript, i, n) => lp('acira/v2/chunk', transcript, u32(i), u32(n), u8(i === n ? 1 : 0));
/** Chunk i of n data chunks (i = 0 is the manifest) -> ciphertext || tag. */
function sealChunk(session, transcript, i, n, piece) {
  const cipher = crypto.createCipheriv('aes-256-gcm', session, chunkNonce(i), { authTagLength: C.GCM_TAG });
  cipher.setAAD(chunkAad(transcript, i, n));
  return Buffer.concat([cipher.update(bytes(piece)), cipher.final(), cipher.getAuthTag()]);
}
/** The plain bytes of chunk i, or throws 'damaged' (a flipped byte, another index, another n, another session all fail the tag). */
function openChunk(session, transcript, i, n, sealed) {
  const data = bytes(sealed);
  if (data.length < C.GCM_TAG + 1) throw new TransferCryptoError('damaged', 'short chunk');
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', session, chunkNonce(i), { authTagLength: C.GCM_TAG });
    decipher.setAAD(chunkAad(transcript, i, n));
    decipher.setAuthTag(data.subarray(data.length - C.GCM_TAG));
    return Buffer.concat([decipher.update(data.subarray(0, data.length - C.GCM_TAG)), decipher.final()]);
  } catch { throw new TransferCryptoError('damaged', 'a chunk did not verify'); }
}

/** How the compressed payload splits: n data chunks (at least one) behind the manifest, and the exact sum of every chunk body. */
function chunkPlan(plainLength, manifestLength) {
  const n = Math.max(1, Math.ceil(plainLength / C.CHUNK_PLAIN));
  return { n, totalChunks: n + 1, totalBytes: (manifestLength + C.GCM_TAG) + plainLength + C.GCM_TAG * n };
}
/** The piece of the compressed payload that data chunk k (1..n) carries. */
const pieceOf = (plain, k) => plain.subarray((k - 1) * C.CHUNK_PLAIN, Math.min(plain.length, k * C.CHUNK_PLAIN));

// ---- the profile file (7.4) -------------------------------------------------------------------------------------------------------------

const MAGIC = Buffer.from('ACP2', 'ascii');
const HEADER = 4 + 16 + 1 + 12;
/** True when the bytes start like a password-locked profile file. */
const isLockedFile = (data) => Buffer.isBuffer(data) && data.length >= 4 && data.subarray(0, 4).equals(MAGIC);
const passwordKey = (password, salt) => {
  const text = String(password ?? '');
  if (!text || text.length > 1024) throw new TransferCryptoError('bad_input', 'bad password');
  return scryptAsync(Buffer.from(text.normalize('NFKC'), 'utf8'), salt, 32, { N: C.SCRYPT_N, r: C.SCRYPT_R, p: C.SCRYPT_P, maxmem: C.SCRYPT_MAXMEM });
};
/** "ACP2" | salt(16) | N exponent (1 byte, 17) | nonce(12) | AES-256-GCM(key, nonce, brotli(json), AAD = the 33 header bytes) | tag(16).
 * `salt` and `nonce` are only fixed by tests. */
async function lockFile(json, password, { salt = crypto.randomBytes(16), nonce = crypto.randomBytes(12) } = {}) {
  const key = await passwordKey(password, salt);
  const header = Buffer.concat([MAGIC, salt, Buffer.from([C.SCRYPT_N_EXPONENT]), nonce]);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce, { authTagLength: C.GCM_TAG });
  cipher.setAAD(header);
  const body = await pack(json);
  const out = Buffer.concat([header, cipher.update(body), cipher.final(), cipher.getAuthTag()]);
  wipe(key);
  return out;
}
/** The JSON bytes of a locked file. 'not_locked' (no "ACP2"), 'newer' (an exponent above 17: made by a newer Acira), 'unsupported' (any other
 * exponent: nothing is ever derived from an untrusted cost), 'wrong_password' (the tag failed: also a changed file), 'damaged'. */
async function unlockFile(file, password) {
  const data = bytes(file);
  if (!isLockedFile(data)) throw new TransferCryptoError('not_locked');
  if (data.length < HEADER + C.GCM_TAG + 1) throw new TransferCryptoError('damaged', 'short file');
  const exponent = data[20];
  if (exponent > C.SCRYPT_N_EXPONENT) throw new TransferCryptoError('newer');
  if (exponent !== C.SCRYPT_N_EXPONENT) throw new TransferCryptoError('unsupported');
  const key = await passwordKey(password, data.subarray(4, 20));
  let body;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, data.subarray(21, HEADER), { authTagLength: C.GCM_TAG });
    decipher.setAAD(data.subarray(0, HEADER));
    decipher.setAuthTag(data.subarray(data.length - C.GCM_TAG));
    body = Buffer.concat([decipher.update(data.subarray(HEADER, data.length - C.GCM_TAG)), decipher.final()]);
  } catch { throw new TransferCryptoError('wrong_password'); } finally { wipe(key); }
  return unpack(body);
}

module.exports = {
  TransferCryptoError, lp, u8, u16, u32, u64, b64u, fromB64u, hex, sha256, hmac, hkdf, same, wipe,
  deriveMaster, deriveKeys, wipeKeys,
  generateKeyPair, keyPairFromSeed, sharedSecret,
  sealInfo, openInfo, macA, macB, transcriptOf, deriveSession, approveMac, readNumber,
  pack, unpack, sealChunk, openChunk, chunkPlan, pieceOf,
  isLockedFile, lockFile, unlockFile,
};
