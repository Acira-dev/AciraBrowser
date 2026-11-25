'use strict';
// Profile transfer, protocol 2: every number the two computers and the relay must agree on (the design notes, section 7).
// The relay function repeats the ones it enforces; the relay tests and
// fail if a copy drifts from this file or from the migration.
const SECOND = 1000, MINUTE = 60 * SECOND;
const CHUNK_PLAIN = 512 * 1024;
const MAX_CHUNKS = 48;
const GCM_TAG = 16;

module.exports = Object.freeze({
  PROTOCOL: 2,
  /** Words in one code, drawn from the 2,048-word BIP-39 list: 11 bits each, 55 bits in all. */
  CODE_WORDS: 5,
  /** An unclaimed code lives this long. */
  CODE_TTL: 10 * MINUTE,
  /** A claimed code waits this long for the number to be typed on the sending computer. */
  APPROVE_TTL: 3 * MINUTE,
  /** Hard cap from create. */
  SESSION_TTL: 20 * MINUTE,
  /** No sign of the other computer for this long while a transfer is active ends it. */
  PEER_TIMEOUT: 45 * SECOND,
  /** One `wait` call holds the line for at most this long. */
  LONG_POLL: 25 * SECOND,
  /** Plain bytes in one chunk; the stored chunk is these plus the 16-byte GCM tag. */
  CHUNK_PLAIN,
  GCM_TAG,
  /** Chunks after the manifest: 48 x 512 KiB = 24 MiB of (compressed) payload. */
  MAX_CHUNKS,
  MAX_PAYLOAD: CHUNK_PLAIN * MAX_CHUNKS,
  /** What the manifest chunk may hold (JSON). */
  MAX_MANIFEST: 8 * 1024,
  /** Largest sum of every stored chunk body (manifest included); the relay's table check is 25,200,000. */
  MAX_TOTAL_BYTES: 25200000,
  /** Brotli output cap on the receiving side (and for a locked file). */
  MAX_INFLATED: 128 * 1024 * 1024,
  /** scrypt for the code and for a file password: N = 2^17, r = 8, p = 1. */
  SCRYPT_N: 1 << 17,
  SCRYPT_N_EXPONENT: 17,
  SCRYPT_R: 8,
  SCRYPT_P: 1,
  SCRYPT_MAXMEM: 256 * 1024 * 1024,
  SCRYPT_SALT: 'acira-transfer-v2',
  /** Network: per-request timeouts, and the back-off between retries (the last value repeats). */
  TIMEOUT_CALL: 30 * SECOND,
  TIMEOUT_WAIT: 35 * SECOND,
  TIMEOUT_DATA: 120 * SECOND,
  BACKOFF: Object.freeze([1000, 2000, 4000, 8000, 15000]),
  /** While data flows, a side leaves at least this long between the start of one `wait` and the next. */
  WAIT_GAP: 1000,
  /** B sends an acknowledgement every this many chunks, or when this long has passed since the last one, or when the last chunk is in. */
  ACK_EVERY: 4,
  ACK_GAP: 500,
  /** Upper bounds, in UTF-8 bytes, for the texts that travel inside infoA / infoB (so the relay's 512-character cap always holds). */
  LABEL_BYTES: 64,
  NAME_BYTES: 64,
});
