'use strict';
// The .aciraprofile file (spec 4.5 and 7.4) and the sniffing that tells it from an older Acira export and from a bookmarks file.
//
//   unlocked   UTF-8 JSON, the payload v2 itself (passwords forbidden)
//   locked     "ACP2" | salt(16) | N exponent (1 byte, 17) | nonce(12) | AES-256-GCM ciphertext | tag(16)
//              the key is scrypt(NFKC(password), salt, N 2^17, r 8, p 1) and the 33 header bytes are the GCM's additional data
//              the plaintext is Brotli(JSON)
//
// The N exponent comes from an untrusted file: exactly 17 is accepted, so a crafted file cannot ask for gigabytes of memory.
// (desktop/transfer/crypto.cjs, from the transport work, has the same lock for the code path's constants; the format here is the file's own.)

const crypto = require('node:crypto');
const { promisify } = require('node:util');
const payloads = require('./payload.cjs');

const scrypt = promisify(crypto.scrypt);
const MAGIC = Buffer.from('ACP2', 'ascii');
const N_EXPONENT = 17;
const HEADER = MAGIC.length + 16 + 1 + 12;
const MAX_FILE = 64 * 1024 * 1024;
const MIN_PASSWORD = 10;
const EXTENSION = 'aciraprofile';

const fail = (code, message) => Object.assign(new Error(message), { code });
const key = (password, salt, exponent = N_EXPONENT) => scrypt(Buffer.from(String(password).normalize('NFKC'), 'utf8'), salt, 32, { N: 2 ** exponent, r: 8, p: 1, maxmem: 256 * 1024 * 1024 });

/** What is wrong with a password for a locked file, or null. */
function passwordProblem(password) {
  if (typeof password !== 'string' || [...password.normalize('NFKC')].length < MIN_PASSWORD) return 'short';
  return null;
}

/** A payload as the bytes of a file. A payload with passwords is only ever written locked. */
async function seal(payload, { password } = {}) {
  if (payload.passwords?.length && !password) throw fail('password-required', 'A file with passwords must be locked with a password.');
  if (!password) return Buffer.from(JSON.stringify(payload), 'utf8');
  if (passwordProblem(password)) throw fail('password-short', 'Use a password of at least ' + MIN_PASSWORD + ' characters.');
  const plain = await payloads.pack(payload);
  const salt = crypto.randomBytes(16), nonce = crypto.randomBytes(12);
  const header = Buffer.concat([MAGIC, salt, Buffer.from([N_EXPONENT]), nonce]);
  const cipher = crypto.createCipheriv('aes-256-gcm', await key(password, salt), nonce);
  cipher.setAAD(header);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([header, body, cipher.getAuthTag()]);
}

/** Looks at the first bytes: 'locked' (ACP2), 'profile' (an unlocked v2 file), 'v1' (Acira's older JSON export), 'html' (bookmarks) or 'unknown'. By content, never by file name. */
function sniff(bytes) {
  if (!Buffer.isBuffer(bytes) || !bytes.length) return { kind: 'unknown' };
  if (bytes.length >= MAGIC.length && bytes.subarray(0, MAGIC.length).equals(MAGIC)) return { kind: 'locked' };
  if (bytes.length >= 4 && /^ACP[0-9]/.test(bytes.subarray(0, 4).toString('ascii'))) return { kind: 'locked-newer' };
  const head = bytes.subarray(0, 4096).toString('utf8').replace(/^﻿/, '').trimStart();
  if (head.startsWith('{')) {
    let value;
    try { value = JSON.parse(bytes.toString('utf8').replace(/^﻿/, '')); } catch { return { kind: 'unknown' }; }
    if (value && value.format === payloads.FORMAT) return { kind: 'profile', value };
    if (value && value.format === 'acira-local-data') return { kind: 'v1', value };
    return { kind: 'unknown' };
  }
  if (/<!doctype\s+netscape-bookmark-file|<dl[\s>]|<title>\s*bookmarks/i.test(head)) return { kind: 'html' };
  return { kind: 'unknown' };
}

/** The payload inside a locked file (a wrong password and a damaged file both fail the GCM tag; the first is the likely one). */
async function unlock(bytes, password) {
  if (bytes.length < HEADER + 16 + 1) throw fail('damaged', 'This file is damaged.');
  const exponent = bytes[MAGIC.length + 16];
  if (exponent > N_EXPONENT) throw fail('newer', 'This file was made by a newer Acira.');
  if (exponent !== N_EXPONENT) throw fail('damaged', 'This file is damaged.');
  const header = bytes.subarray(0, HEADER), salt = bytes.subarray(MAGIC.length, MAGIC.length + 16), nonce = bytes.subarray(MAGIC.length + 17, HEADER);
  const tag = bytes.subarray(bytes.length - 16), body = bytes.subarray(HEADER, bytes.length - 16);
  let plain;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', await key(password, salt), nonce);
    decipher.setAAD(header); decipher.setAuthTag(tag);
    plain = Buffer.concat([decipher.update(body), decipher.final()]);
  } catch { throw fail('wrong-password', 'That password doesn’t open this file.'); }
  return payloads.unpack(plain);
}

/**
 * Opens any file the Open dialog may give: the result says what it is.
 *   { kind: 'profile', raw, locked }   a v2 payload (parsed JSON, still to be validated)
 *   { kind: 'v1' | 'html' }            older exports, handed to the importers
 * Throws { code: 'password-needed' | 'wrong-password' | 'newer' | 'damaged' | 'unknown' | 'too-large' }.
 */
async function open(bytes, { password } = {}) {
  if (!Buffer.isBuffer(bytes) || bytes.length > MAX_FILE) throw fail('too-large', 'This file is too large to be an Acira profile.');
  const sniffed = sniff(bytes);
  if (sniffed.kind === 'locked') {
    if (password === undefined) throw fail('password-needed', 'This file is locked with a password.');
    return { kind: 'profile', raw: await unlock(bytes, password), locked: true };
  }
  if (sniffed.kind === 'locked-newer') throw fail('newer', 'This file was made by a newer Acira.');
  if (sniffed.kind === 'profile') return { kind: 'profile', raw: sniffed.value, locked: false };
  if (sniffed.kind === 'v1' || sniffed.kind === 'html') return { kind: sniffed.kind };
  throw fail('unknown', 'This isn’t an Acira profile or bookmarks file.');
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "Alex – Acira profile – 7 Nov 2026.aciraprofile", safe on both systems. */
function defaultFileName(profileName, date = new Date()) {
  const name = String(profileName || 'Acira').replace(/[\u0000-\u001f<>:"/\\|?*]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Acira';
  return name + ' – Acira profile – ' + date.getDate() + ' ' + MONTHS[date.getMonth()] + ' ' + date.getFullYear() + '.' + EXTENSION;
}

module.exports = { MAGIC, N_EXPONENT, MIN_PASSWORD, MAX_FILE, EXTENSION, seal, open, sniff, unlock, passwordProblem, defaultFileName };
