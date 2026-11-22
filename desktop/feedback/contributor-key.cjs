'use strict';
// Beta 14 E2 + AH rule 1: the profile's ID. ONE Ed25519 KEY PAIR PER PROFILE, made on this device, kept in that profile's own file inside <userData>/contributor/ with the private half
// (its 32-byte seed) wrapped by the operating system's protected storage (Electron safeStorage; the mock keychain in tests) where it is available. It holds nothing about the person.
// The same key pair is the contributor key (points, ranks) and the Insider ID (the certificate's `sub`).
//  - The private half never leaves the device except inside the profile copy's end-to-end encryption (`exportSeed` below, used only by feedback-service.cjs `identity.export`,
//    which refuses any destination that is not encrypted). The protected file itself is never copied: its wrapping only opens on this computer and this account.
//  - Every request that belongs to this profile is SIGNED (AH rule 3, desktop/insider/acira-signing.cjs): Acira-Key (the public half), Acira-Ts, Acira-Sig, and Acira-Cert when the
//    profile holds an Insider certificate. Nothing reusable is sent: no secret, no cookie.
//  - It is never the analytics id and the analytics code never reads it. Nothing is made on the network: the key exists on the device from the Beta 14 update on, and nothing leaves
//    until the person reports, connects or activates something (feedback-service.cjs decides that, not this file).
//  - Deleting a profile deletes its key (remove); a fresh install starts a new one. A key that exists but cannot be read (the operating system's storage changed) is reported as
//    unreadable and never replaced by a new one: the person decides with "Delete my contributor data".
// THE 14 NOV FILE IS ALREADY THIS KEY PAIR: version 1 of the file has always held the Ed25519 seed (wrapped, or plain where the OS storage was missing), so nothing on the device
// changes and no point is lost. What changed is how a request proves it (rule 3 instead of the old "acira-contributor/1" proof). The server keeps a contributor's record under
// sha256(raw public key) (`keyHash`, the "Anonymous #482" fingerprint); a rule-3 request carries the public key itself, so the server finds the same record by hashing Acira-Key
// (the local stand-in, qa/feedback-standin.cjs, does exactly that).
// The private key object is kept inside this module: no caller ever receives it, so it cannot reach a log, a crash report, a usage message or a settings export.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { writeFileAtomic } = require('../atomic-file.cjs');
const { keyPairFromSeed, signRequest, fromB64u, PKCS8_PREFIX } = require('../insider/acira-signing.cjs');

const VERSION = 1, SAFE_PROFILE = /^[A-Za-z0-9_.:-]{1,120}$/;

const sha256Hex = (value) => crypto.createHash('sha256').update(value).digest('hex');
/** The server's identifier of a key: the sha256 of the raw 32-byte public key, in hex ("Anonymous #482" is looked up by it). */
const keyHash = (publicKey) => sha256Hex(Buffer.from(String(publicKey), 'base64url'));

/** `keys` is {available(), wrap(buffer), unwrap(blob)} (passwords/vault.cjs safeStorageKeys); without one, or when it is not available, the seed is kept
 * as it is in a file only this user can read (mode 0600) and `protected` says so. */
function createContributorKeys({ dir, keys = null, random = crypto.randomBytes, now = Date.now, fileSystem = fs }) {
  const loaded = new Map(); // profileId -> {privateKey, publicKey, hash, protected, createdAt}: the private key object stays in here
  const profileCheck = (profileId) => { if (typeof profileId !== 'string' || !SAFE_PROFILE.test(profileId)) throw new Error('Unknown profile.'); return profileId; };
  const fileOf = (profileId) => path.join(dir, `${profileCheck(profileId)}.key.json`);
  const osProtects = () => { try { return Boolean(keys?.available()); } catch { return false; } };

  function identityFromSeed(seed) {
    const pair = keyPairFromSeed(seed);
    return { privateKey: pair.privateKey, publicKey: pair.publicKey, hash: keyHash(pair.publicKey) };
  }
  /** What a caller sees of a loaded key: never the private half. */
  const shown = (identity) => ({ state: 'ready', publicKey: identity.publicKey, hash: identity.hash, protected: identity.protected });

  /** The seed in the profile's file. {state:'none'} when there is none, {state:'unreadable'} when it is there and cannot be opened, else {state:'ready', seed, wasProtected, createdAt}. */
  function readSeed(profileId) {
    let blob;
    try { blob = JSON.parse(fileSystem.readFileSync(fileOf(profileId), 'utf8')); } catch (error) { return error?.code === 'ENOENT' ? { state: 'none' } : { state: 'unreadable' }; }
    try {
      if (blob?.v !== VERSION) throw new Error('version');
      let seed, wasProtected = false;
      if (typeof blob.wrapped === 'string') { seed = keys.unwrap(Buffer.from(blob.wrapped, 'base64')); wasProtected = true; }
      else if (typeof blob.seed === 'string' && /^[0-9a-f]{64}$/.test(blob.seed)) seed = Buffer.from(blob.seed, 'hex');
      else throw new Error('empty');
      if (!Buffer.isBuffer(seed)) seed = Buffer.from(seed);
      if (seed.length !== 32) throw new Error('length');
      return { state: 'ready', seed, wasProtected, createdAt: typeof blob.createdAt === 'string' ? blob.createdAt : null };
    } catch { return { state: 'unreadable' }; }
  }

  /** Reads the profile's key file (once; then the loaded key). */
  function read(profileId) {
    profileCheck(profileId);
    if (loaded.has(profileId)) return { state: 'ready', ...loaded.get(profileId) };
    const found = readSeed(profileId);
    if (found.state !== 'ready') return found;
    try {
      const identity = { ...identityFromSeed(found.seed), protected: found.wasProtected, createdAt: found.createdAt };
      loaded.set(profileId, identity);
      // A key kept plain because the operating system's storage was missing is wrapped the first time it is there.
      if (!found.wasProtected && osProtects()) { try { writeKey(profileId, found.seed, found.createdAt); identity.protected = true; } catch { /* stays plain; tried again next run */ } }
      return { state: 'ready', ...identity };
    } catch { return { state: 'unreadable' }; } finally { found.seed.fill(0); }
  }

  function writeKey(profileId, seed, createdAt) {
    fileSystem.mkdirSync(dir, { recursive: true });
    const wrapped = osProtects();
    const blob = { v: VERSION, createdAt: createdAt || new Date(now()).toISOString(), ...(wrapped ? { wrapped: keys.wrap(seed).toString('base64') } : { seed: seed.toString('hex') }) };
    writeFileAtomic(fileOf(profileId), JSON.stringify(blob), { mode: 0o600, fileSystem });
  }

  const api = {
    /** The profile's key, made on the first call (never over a key that cannot be read). {state:'ready', publicKey, hash, protected} or {state:'unreadable'}. */
    ensure(profileId) {
      const found = read(profileId);
      if (found.state === 'ready') return shown(found);
      if (found.state !== 'none') return found;
      const seed = random(32);
      writeKey(profileId, seed);
      loaded.set(profileId, { ...identityFromSeed(seed), protected: osProtects(), createdAt: new Date(now()).toISOString() });
      return shown(loaded.get(profileId));
    },
    /** Like ensure but never makes one: what a read-only caller (the viewer, a refresh) uses. */
    peek(profileId) { const found = read(profileId); return found.state === 'ready' ? shown(found) : found; },
    exists(profileId) { return read(profileId).state !== 'none'; },
    /**
     * The headers of one signed request (AH rule 3), or null when the profile has no readable key. `url` is where it goes, `body` the exact text sent, `cert` the profile's Insider
     * certificate when it has one (sent as Acira-Cert).
     */
    sign(profileId, { method = 'POST', url, body = '', cert = null }) {
      const identity = read(profileId);
      if (identity.state !== 'ready') return null;
      return signRequest({ privateKey: identity.privateKey, publicKey: identity.publicKey, method, url, body, cert, now: now() });
    },
    /**
     * FOR THE PROFILE COPY ONLY (feedback-service.cjs identity.export, which refuses an unencrypted destination): the 32-byte seed in base64url, the public half and when it was made.
     * null when there is no readable key. The caller puts it inside end-to-end encryption and nowhere else.
     */
    exportSeed(profileId) {
      const found = readSeed(profileCheck(profileId));
      if (found.state !== 'ready') return null;
      try { return { seed: found.seed.toString('base64url'), publicKey: keyPairFromSeed(found.seed).publicKey, createdAt: found.createdAt }; } finally { found.seed.fill(0); }
    },
    /**
     * Takes a key pair brought by a profile copy: its seed is wrapped under THIS computer's protected storage and replaces the profile's key. The caller (feedback-service.cjs
     * identity.import) decides whether the profile's own key may be replaced. Returns the new public key, or null when `seed` is not a 32-byte seed whose public half is `publicKey`.
     */
    adopt(profileId, { seed, publicKey, createdAt = null }) {
      profileCheck(profileId);
      const raw = fromB64u(seed, 32);
      if (!raw) return null;
      try {
        const identity = identityFromSeed(raw);
        if (identity.publicKey !== publicKey) return null;
        writeKey(profileId, raw, typeof createdAt === 'string' && !Number.isNaN(Date.parse(createdAt)) ? createdAt : null);
        loaded.set(profileId, { ...identity, protected: osProtects(), createdAt });
        return identity.publicKey;
      } catch { return null; } finally { raw.fill(0); }
    },
    /** Deletes the profile's key: the profile was removed, or "Delete my contributor data" on a key that cannot be read (a readable key stays: it is the Insider ID, B5). */
    remove(profileId) {
      loaded.delete(profileId);
      for (const name of [fileOf(profileId), `${fileOf(profileId)}.bak`]) { try { fileSystem.rmSync(name, { force: true }); } catch { /* a missing file is the goal */ } }
    },
    /** Profile ids that have a key file (for tidying keys whose profile no longer exists). */
    list() { try { return fileSystem.readdirSync(dir).filter((name) => name.endsWith('.key.json')).map((name) => name.slice(0, -'.key.json'.length)); } catch { return []; } },
  };
  return api;
}

module.exports = { createContributorKeys, keyHash, PKCS8_PREFIX };
