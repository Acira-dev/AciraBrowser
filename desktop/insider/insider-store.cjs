'use strict';
// Beta 14 AH: what one profile keeps about the Insider programme: one small file per profile in <userData>/insider/ (<profile>.insider.json, 0600), written whole and atomically,
// read back through the same checks as anything the server sent, deleted with the profile (and with an unreadable key's "Delete my contributor data"; a readable key keeps its certificate: B5).
// It keeps the CERTIFICATE TEXT, permanently (rule 2: no expiry, no renewal), and never a verdict: whether the profile is an Insider is worked out from the certificate every time it is
// asked (acira-signing.cjs readCertificate, against the shipped keys and this profile's own public key), so editing this file by hand can change nothing but the choices that are
// the person's own (the update channel, where the welcome stands). A file of the 14 Nov build (a `pass`, its renewal time, the 16:40 build's activation state) is read as a profile
// with no certificate: those passes were never valid certificates.
const fs = require('node:fs');
const path = require('node:path');
const { writeFileAtomic, readJsonFile } = require('../atomic-file.cjs');
const { CERT_MAX } = require('./acira-signing.cjs');

const VERSION = 1, SAFE_PROFILE = /^[A-Za-z0-9_.:-]{1,120}$/;
/** The welcome's steps, in order (kept as they were: the welcome is section AL's, see insider-service.cjs). */
const WELCOME_STEPS = Object.freeze(['welcome', 'new', 'something', 'seal', 'card']);
const WELCOME_STATES = Object.freeze([null, 'owed', 'done']);

/** A profile that has never touched the programme. */
// `enroll` (automatic enrollment, 16 Nov): when this profile first asked (ms) and whether it must never ask again (it got its number, or enrollment was closed or full).
// `channel`: the Insider update channel's choice: null = never chosen (ON for an Insider: the founder's promise that Insider updates arrive in the app, 16 Nov), true, false.
const blank = () => ({ v: VERSION, cert: null, invitesLeft: null, channel: null, revealedFor: null, welcome: { state: null, step: null }, enroll: { firstTry: null, stopped: false } });

function clean(raw) {
  const local = blank();
  if (!raw || typeof raw !== 'object' || raw.v !== VERSION) return local;
  if (typeof raw.cert === 'string' && raw.cert.length > 0 && raw.cert.length <= CERT_MAX) local.cert = raw.cert;
  if (Number.isInteger(raw.invitesLeft) && raw.invitesLeft >= 0 && raw.invitesLeft <= 999) local.invitesLeft = raw.invitesLeft;
  local.channel = raw.channel === true ? true : raw.channel === false ? false : null;
  if (Number.isInteger(raw.revealedFor) && raw.revealedFor >= 1) local.revealedFor = raw.revealedFor;
  const state = raw.welcome?.state ?? null;
  local.welcome.state = WELCOME_STATES.includes(state) ? state : null;
  local.welcome.step = local.welcome.state === 'owed' && WELCOME_STEPS.includes(raw.welcome?.step) ? raw.welcome.step : null;
  if (Number.isSafeInteger(raw.enroll?.firstTry) && raw.enroll.firstTry > 0) local.enroll.firstTry = raw.enroll.firstTry;
  local.enroll.stopped = raw.enroll?.stopped === true;
  return local;
}

function createInsiderStore({ dir, fileSystem = fs, warn = () => {} }) {
  const fileOf = (profileId) => { if (typeof profileId !== 'string' || !SAFE_PROFILE.test(profileId)) throw new Error('Unknown profile.'); return path.join(dir, `${profileId}.insider.json`); };
  const cache = new Map();
  const api = {
    read(profileId) {
      if (cache.has(profileId)) return cache.get(profileId);
      const local = clean(readJsonFile(fileOf(profileId), { maxBytes: 64 * 1024, fileSystem, warn }));
      cache.set(profileId, local);
      return local;
    },
    exists(profileId) { try { return fileSystem.existsSync(fileOf(profileId)); } catch { return false; } },
    /** `change(copy)` returns the new copy (or changes it and returns nothing). Written whole; the cache holds the same object. */
    update(profileId, change) {
      const current = api.read(profileId);
      const next = clean(change(structuredClone(current)) ?? current);
      fileSystem.mkdirSync(dir, { recursive: true });
      writeFileAtomic(fileOf(profileId), JSON.stringify(next), { mode: 0o600, fileSystem });
      cache.set(profileId, next);
      return next;
    },
    remove(profileId) {
      cache.delete(profileId);
      for (const name of [fileOf(profileId), `${fileOf(profileId)}.bak`]) { try { fileSystem.rmSync(name, { force: true }); } catch { /* gone is the goal */ } }
    },
    list() { try { return fileSystem.readdirSync(dir).filter((name) => name.endsWith('.insider.json')).map((name) => name.slice(0, -'.insider.json'.length)); } catch { return []; } },
  };
  return api;
}

module.exports = { createInsiderStore, blank, clean, WELCOME_STEPS };
