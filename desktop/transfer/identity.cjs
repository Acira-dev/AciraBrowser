'use strict';
// The profile's identity in a transfer (the plan point 4, E2 and AH): the ID key pair (the profile's contributor key and Insider ID), the Insider certificate (the signed pass),
// the "welcome seen" flag (AL) and the recognition state the device keeps (Early Member, rank ring, auras played). Moved so the same profile on a second computer is the same
// contributor with the same points, rank and Insider number, and so the welcome does not show again.
//
// Rules, all enforced here or in payload.cjs / apply.cjs:
//   * The private half travels only INSIDE the transfer's own end-to-end encryption (a code, or a password-locked file), never in a file that has no password, never as the
//     operating system's protected file (it cannot be read on another computer: the module that owns the key exports it and writes it back through itself).
//   * It is never put in the import batch's record (the database): a receiving profile whose own identity was ever used KEEPS it (the module says 'own'); Undo calls `forget`
//     only for an identity this transfer wrote.
//   * The analytics ID and its marks never move (inventory 9.6: device facts, section B).
//
// THE API of the module that owns the key and the certificate (settled while the transfer was built; in main it is
// `feedbackService().identity`, desktop/feedback/feedback-service.cjs). The transfer calls exactly these four:
//   export(profileId, { destination })   -> Buffer | null    destination 'code' | 'locked-file', anything else THROWS code 'identity-needs-encryption'; null = a private profile or no readable key.
//                                           The bytes are UTF-8 JSON { format:'acira-identity', v:1, key:<32-byte Ed25519 seed, base64url>, publicKey:<base64url>, createdAt, cert:<JWS>|null,
//                                           recognition:{ earlyMember, engaged, off, ringRank, auraPlayed:[], welcomeSeen } }.
//   import(profileId, bytes, { mode })   -> { ok:true, adopted, insider, number, certDropped } | { ok:false, reason:'format'|'private'|'own' }
//                                           mode 'new' (the profile this apply created) always adopts; mode 'current' adopts only when the profile's own ID was never used (no report, no
//                                           certificate), else reason 'own' and nothing changes. It verifies the seed against publicKey and the certificate against a shipped kid
//                                           (a certificate that does not verify is dropped, certDropped:true, the key is still adopted) and merges recognition.
//   forget(profileId)                    -> void              the Undo of an apply that adopted: key, certificate and the local recognition copy go; a fresh ID is made on next use.
//   peek(profileId)                      -> { publicKey, insider, number } | null     no secret: for the preview line and for proof.
// Until that module is on the integration branch, tests/helpers/identity-stub.cjs stands in for it with the same four calls, and main.cjs wires nothing in production
// (`sources.identity` is absent, so a profile's identity is skipped, silently, until the real module is wired).
const crypto = require('node:crypto');

const FORMAT = 'acira-identity', VERSION = 1;
const CERT_MAX = 8 * 1024, RECOGNITION_MAX = 4 * 1024;
const B64URL = /^[A-Za-z0-9_-]+$/;

/** An Ed25519 seed and its public half, both base64url of 32 bytes; checked by deriving the public half from the seed. */
function cleanKeyPair(seed, publicKey) {
  if (typeof seed !== 'string' || typeof publicKey !== 'string' || seed.length !== 43 || publicKey.length !== 43 || !B64URL.test(seed) || !B64URL.test(publicKey)) return null;
  try {
    const derived = crypto.createPublicKey(crypto.createPrivateKey({ key: { kty: 'OKP', crv: 'Ed25519', d: seed, x: publicKey }, format: 'jwk' })).export({ format: 'jwk' });
    return derived.x === publicKey ? { key: seed, publicKey } : null;
  } catch { return null; }
}

/** A compact JWS (three base64url parts) within the size the certificate may have; anything else is no certificate. */
const cleanCert = (value) => (typeof value === 'string' && value.length <= CERT_MAX && value.split('.').length === 3 && value.split('.').every((part) => part.length > 0 && B64URL.test(part)) ? value : null);

/** Plain JSON only, small, shallow: the recognition state is shown, never run. */
function cleanRecognition(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  let text; try { text = JSON.stringify(value); } catch { return undefined; }
  if (text.length > RECOGNITION_MAX) return undefined;
  const strip = (item, depth) => {
    if (depth > 4) return undefined;
    if (item === null || typeof item === 'boolean' || (typeof item === 'number' && Number.isFinite(item))) return item;
    if (typeof item === 'string') return item.slice(0, 200);
    if (Array.isArray(item)) return item.slice(0, 50).map((entry) => strip(entry, depth + 1)).filter((entry) => entry !== undefined);
    if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item).slice(0, 30).filter(([name]) => /^[A-Za-z0-9_.-]{1,40}$/.test(name)).map(([name, entry]) => [name, strip(entry, depth + 1)]).filter(([, entry]) => entry !== undefined));
    return undefined;
  };
  return strip(JSON.parse(text), 0);
}

/**
 * What a file or a peer sent as `identity`, made whole: a key pair that is a key pair or nothing (without it there is no identity to copy), a certificate only when it has the
 * shape of one (the module verifies its signature), the recognition state as small plain JSON. Anything else in the object is dropped.
 */
function cleanIdentity(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.format !== FORMAT || raw.v !== VERSION) return null;
  const pair = cleanKeyPair(raw.key, raw.publicKey);
  if (!pair) return null;
  const createdAt = typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt) ? raw.createdAt : typeof raw.createdAt === 'string' ? raw.createdAt.slice(0, 40) : undefined;
  const recognition = cleanRecognition(raw.recognition);
  return { format: FORMAT, v: VERSION, key: pair.key, publicKey: pair.publicKey, ...(createdAt !== undefined ? { createdAt } : {}), cert: cleanCert(raw.cert), ...(recognition && Object.keys(recognition).length ? { recognition } : {}) };
}

/**
 * The bridge between the transfer and the module's four calls: objects in, objects out (the bytes are made and read here), and the module's answers turned into the
 * outcomes the apply records: 'imported' (this transfer wrote it: Undo may forget it), 'same' (the profile already has this very key), 'kept' (it has its own: nothing changed),
 * 'skipped' (a private profile) and 'invalid'. `source()` returns the module, or nothing (then nothing moves).
 */
function createBridge(source) {
  const peekOf = (module, profileId) => { try { return module.peek?.(profileId) || null; } catch { return null; } };
  return {
    /** The profile's identity as a plain object, or null. `destination` is 'code' or 'locked-file'; the module refuses any other. */
    async export(profileId, destination) {
      const module = source();
      if (!module?.export) return null;
      const bytes = await module.export(profileId, { destination });
      if (!bytes || !bytes.length) return null;
      let parsed; try { parsed = JSON.parse(Buffer.from(bytes).toString('utf8')); } catch { return null; }
      return cleanIdentity(parsed);
    },
    /** `mode`: 'new' for the profile this apply created, 'current' otherwise. Never throws for a refusal; returns what happened. */
    async import(profileId, identity, { mode } = {}) {
      const module = source();
      if (!module?.import) return { status: 'skipped', verified: null };
      const clean = cleanIdentity(identity);
      if (!clean) return { status: 'invalid', verified: null };
      const before = peekOf(module, profileId);
      const sameBefore = Boolean(before && before.publicKey === clean.publicKey);
      const result = await module.import(profileId, Buffer.from(JSON.stringify(clean), 'utf8'), { mode: mode === 'new' ? 'new' : 'current' });
      if (!result?.ok) {
        if (result?.reason === 'own') return { status: sameBefore ? 'same' : 'kept', verified: sameBefore ? verified(module, profileId, clean, {}) : null };
        return { status: result?.reason === 'private' ? 'skipped' : 'invalid', verified: null };
      }
      // Undo may forget only what this transfer wrote: not a key the profile already had (a second copy of the same profile)
      return { status: sameBefore ? 'same' : 'imported', ...(sameBefore ? {} : { receipt: { adopted: true } }), verified: verified(module, profileId, clean, result), insider: result.insider === true, number: Number.isInteger(result.number) ? result.number : null, certDropped: result.certDropped === true };
    },
    undo(profileId, receipt) {
      const module = source();
      if (receipt?.adopted === true && module?.forget) module.forget(profileId);
    }
  };
  /** The key on this computer is the one that was sent, and a certificate that was sent is still there and verified (the module drops one that does not verify). */
  function verified(module, profileId, clean, result) {
    const now = peekOf(module, profileId);
    if (!now || now.publicKey !== clean.publicKey) return false;
    return clean.cert ? result.certDropped !== true && now.insider === true : true;
  }
}

module.exports = { FORMAT, VERSION, CERT_MAX, RECOGNITION_MAX, cleanIdentity, cleanKeyPair, cleanCert, cleanRecognition, createBridge };
