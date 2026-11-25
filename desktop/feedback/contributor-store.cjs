'use strict';
// Beta 14: the local copy of one profile's points, rank, marks, notes and sent reports, one small file per profile in <userData>/contributor/
// (<profile>.state.json, beside <profile>.key.json). Nothing secret is in it. It is written whole and atomically, read back through the same
// checks as a server answer (a hand-edited or damaged file can never show a rank that is not a rank), and deleted with the profile.
const fs = require('node:fs');
const path = require('node:path');
const { writeFileAtomic, readJsonFile } = require('../atomic-file.cjs');
const { normalizeServer, plain } = require('./contributor-model.cjs');

const VERSION = 1, SAFE_PROFILE = /^[A-Za-z0-9_.:-]{1,120}$/, ID = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_SENT = 200, MAX_SEEN = 400, MAX_PLAYED = 40;
const RANK_IDS = ['contributor', 'trusted', 'insider', 'founding'];
const AURA_ID = /^(?:earlyMember|rank:(?:contributor|trusted|insider|founding))$/;

const iso = (value) => { const time = typeof value === 'string' ? Date.parse(value) : NaN; return Number.isFinite(time) ? new Date(time).toISOString() : null; };

/** A fresh profile's copy. `earlyMember` is set by the service when the key is made (the mark needs no server check). */
const blank = () => ({ v: VERSION, earlyMember: false, engaged: false, off: false, server: null, ringRank: null, sent: [], notesSeen: [], aura: { played: [], pending: null }, pointsOwed: 0, pointsCounted: [], inviteOwed: 0, inviteCounted: [], dot: false, thanks: null });

/** Whatever was read, made into a well-formed copy (unknown fields dropped). */
function clean(raw) {
  const local = blank();
  if (!raw || typeof raw !== 'object' || raw.v !== VERSION) return local;
  local.earlyMember = raw.earlyMember === true;
  local.engaged = raw.engaged === true;
  local.off = raw.off === true;
  local.dot = raw.dot === true;
  local.ringRank = RANK_IDS.includes(raw.ringRank) ? raw.ringRank : null;
  if (raw.server) { const server = normalizeServer(raw.server); if (server) { server.fetchedAt = Number.isFinite(raw.server.fetchedAt) ? raw.server.fetchedAt : 0; local.server = server; } }
  for (const item of Array.isArray(raw.sent) ? raw.sent.slice(-MAX_SENT) : []) {
    if (!item || typeof item.id !== 'string' || !ID.test(item.id) || (item.kind !== 'bug' && item.kind !== 'idea')) continue;
    local.sent.push({ id: item.id, kind: item.kind, snippet: plain(item.snippet, 80), at: iso(item.at), files: Number.isInteger(item.files) ? Math.max(0, Math.min(4, item.files)) : 0 });
  }
  local.notesSeen = (Array.isArray(raw.notesSeen) ? raw.notesSeen : []).filter((id) => typeof id === 'string' && ID.test(id)).slice(-MAX_SEEN);
  local.aura.played = (Array.isArray(raw.aura?.played) ? raw.aura.played : []).filter((id) => typeof id === 'string' && AURA_ID.test(id)).slice(-MAX_PLAYED);
  local.aura.pending = typeof raw.aura?.pending === 'string' && AURA_ID.test(raw.aura.pending) && !local.aura.played.includes(raw.aura.pending) ? raw.aura.pending : null;
  // Beta 14.4: the points of accepted reports the member has not been told about yet by the bubble, and the notes already counted (so one acceptance is never announced twice)
  local.pointsOwed = Number.isInteger(raw.pointsOwed) && raw.pointsOwed > 0 ? Math.min(raw.pointsOwed, 1000000) : 0;
  local.pointsCounted = (Array.isArray(raw.pointsCounted) ? raw.pointsCounted : []).filter((id) => typeof id === 'string' && ID.test(id)).slice(-MAX_SEEN);
  // Beta 14.5: the points of friends who joined that the member has not been told about yet by the bubble, and the notes already counted
  local.inviteOwed = Number.isInteger(raw.inviteOwed) && raw.inviteOwed > 0 ? Math.min(raw.inviteOwed, 1000000) : 0;
  local.inviteCounted = (Array.isArray(raw.inviteCounted) ? raw.inviteCounted : []).filter((id) => typeof id === 'string' && ID.test(id)).slice(-MAX_SEEN);
  local.thanks = raw.thanks && typeof raw.thanks === 'object' && typeof raw.thanks.name === 'string' ? { name: plain(raw.thanks.name, 40) } : null;
  return local;
}

function createContributorStore({ dir, fileSystem = fs, warn = () => {} }) {
  const fileOf = (profileId) => { if (typeof profileId !== 'string' || !SAFE_PROFILE.test(profileId)) throw new Error('Unknown profile.'); return path.join(dir, `${profileId}.state.json`); };
  const cache = new Map();
  const api = {
    read(profileId) {
      if (cache.has(profileId)) return cache.get(profileId);
      const local = clean(readJsonFile(fileOf(profileId), { maxBytes: 512 * 1024, fileSystem, warn }));
      cache.set(profileId, local);
      return local;
    },
    exists(profileId) { try { return fileSystem.existsSync(fileOf(profileId)); } catch { return false; } },
    /** `change(local)` returns the new copy (or mutates and returns it). Written whole; the cache holds the same object. */
    update(profileId, change) {
      const next = clean(change(structuredClone(api.read(profileId))) ?? api.read(profileId));
      fileSystem.mkdirSync(dir, { recursive: true });
      writeFileAtomic(fileOf(profileId), JSON.stringify(next), { mode: 0o600, fileSystem });
      cache.set(profileId, next);
      return next;
    },
    remove(profileId) {
      cache.delete(profileId);
      for (const name of [fileOf(profileId), `${fileOf(profileId)}.bak`]) { try { fileSystem.rmSync(name, { force: true }); } catch { /* gone is the goal */ } }
    },
    list() { try { return fileSystem.readdirSync(dir).filter((name) => name.endsWith('.state.json')).map((name) => name.slice(0, -'.state.json'.length)); } catch { return []; } },
  };
  return api;
}

module.exports = { createContributorStore, blank, clean, MAX_SENT };
