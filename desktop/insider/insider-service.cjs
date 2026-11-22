'use strict';
// The "Insider code" of Settings > About > Extras (13.11), browser side. One small service for the whole app. What it keeps, per profile, is the CERTIFICATE the Insider server signed
// (insider-store.cjs, <userData>/contributor/insider/<profile>.insider.json) and the profile's own key (contributor-key.cjs, <userData>/contributor/<profile>.key.json). Whether a profile is
// an Insider is worked out from the certificate every time (acira-signing.cjs readCertificate), never stored as a flag. The files are the ones Beta 14 reads and writes itself, byte for
// byte the same layout, so a profile activated here is an Insider in Beta 14 with the same number and is never enrolled a second time.
// Rules, each tested in tests/insider-*.test.cjs:
//  - NOTHING HAPPENS UNTIL A CODE IS ENTERED: no key is made, no file is written, no request goes out, at launch, in a look at Settings, at an update check. The service only reads (and
//    only files that are there). The one exception is a key or certificate that cannot belong to the profile any more, which is removed.
//  - HIDDEN WHILE THE SERVER IS NOT NAMED: with no server address or no public key (insider-config.cjs) nothing is available: no request, no answer but `unavailable`.
//  - ONLY AN ORDINARY PROFILE in a window that is not private and not Tor may enter a code.
//  - A CODE (the personal link's token, or the whole link) is checked for its shape first (insider-code.cjs), then sent once, signed by the profile's key, to the Insider server only
//    (insider-client.cjs). It stays here, in main: it is never counted, logged or kept on disk. Lost answers are retried safely, then the row offers "Try again".
//  - ONLY A VALID CERTIFICATE MAKES AN INSIDER: one that verifies with a shipped kid AND names this profile's own public key. One that fails either check is removed. No local flag or file
//    edit makes a profile an Insider.
//  - From then on, while the profile holds a valid certificate, the updater asks the Insider update feed (feedAuth), each request signed for its own path and only for addresses on the
//    feed's own origin. When the feed answers `revoked` the certificate is deleted at once and the next look asks the ordinary feed (feedRevoked).
//  - A removed profile takes its key and certificate with it (profileRemoved).
const fs = require('node:fs');
const { parseEntry } = require('./insider-code.cjs');
const { readCertificate, loadKeys } = require('./acira-signing.cjs');
const { createInsiderStore } = require('./insider-store.cjs');
const { createInsiderClient } = require('./insider-client.cjs');
const { insiderConfig } = require('./insider-config.cjs');

function createInsiderService({
  directory, keyring, config = insiderConfig(), send, ordinary = () => true, eligible = () => true, sessionFor = () => null, routed = () => true, profiles = () => [], tell = () => {},
  onChannelChange = () => {}, now = Date.now, fileSystem = fs, onWarning = () => {}, wait, random,
}) {
  const store = createInsiderStore({ dir: directory, fileSystem, warn: onWarning });
  const keys = loadKeys(config.keys);
  const client = createInsiderClient({ endpoint: config.endpoint, keys: keyring, send, ...(wait ? { wait } : {}), ...(random ? { random } : {}) });
  const generation = new Map(); // raised when a profile's data is deleted: an answer on its way is ignored
  const working = new Map();    // profile id -> the claim in flight (a second press waits for the same answer)
  const generationOf = (profileId) => generation.get(profileId) || 0;
  const certText = (profileId) => { try { return store.read(profileId).cert; } catch { return null; } };
  const available = () => Boolean(config.endpoint) && keys.length > 0;

  /** The check of the profile's stored certificate: {ok, cert} or {ok:false, reason}. A certificate that fails the signature or the key check is REMOVED here. Reads only. */
  function verified(profileId) {
    const text = certText(profileId);
    if (!text) return { ok: false, reason: 'none' };
    const identity = keyring.peek(profileId);
    const read = readCertificate(text, { keys, subject: identity.state === 'ready' ? identity.publicKey : null });
    if (!read.ok && read.remove) {
      onWarning(`Insider: a stored certificate was not valid for this profile (${read.reason}) and was removed.`);
      drop(profileId);
    }
    return read;
  }
  /** {number, since, by} from a valid certificate, else null. */
  function member(profileId) {
    if (!available() || typeof profileId !== 'string' || !ordinary(profileId)) return null;
    const check = verified(profileId);
    return check.ok ? { number: check.cert.number, since: check.cert.since, by: check.cert.by } : null;
  }

  /** The certificate and the invite count go (the server said this profile is not an Insider any more, or the certificate is not valid for it). */
  function drop(profileId) {
    const hadChannel = store.read(profileId).channel !== false && Boolean(config.feed);
    store.update(profileId, (current) => { current.cert = null; current.invitesLeft = null; current.channel = null; return current; });
    tell(profileId);
    if (hadChannel) { try { onChannelChange(); } catch { /* the next look finds the feed it should */ } }
  }

  /** A certificate the server just gave: kept only when it verifies with a shipped key AND names this profile's key. Written as Beta 14 writes it. Returns the member or null. */
  function keepCert(profileId, cert, invitesLeft) {
    const identity = keyring.peek(profileId);
    const read = readCertificate(cert, { keys, subject: identity.state === 'ready' ? identity.publicKey : null });
    if (!read.ok) { onWarning(`Insider: a certificate from the server was not accepted (${read.reason}).`); return null; }
    store.update(profileId, (current) => {
      current.cert = cert;
      if (invitesLeft !== undefined) current.invitesLeft = invitesLeft;
      // `revealedFor` stays as it is (null on a profile that never saw the seal): the row shows the number as text, so Beta 14's one-time reveal of the seal and card, which it gives an Insider
      // whose certificate came from elsewhere, is still owed, and its welcome (when it owes one) shows them and marks them seen.
      return current;
    });
    tell(profileId);
    if (config.feed && store.read(profileId).channel !== false) { try { onChannelChange(); } catch { /* the next look asks the Insider feed anyway */ } } // the updater asks the Insider feed from now on
    return member(profileId);
  }

  const guard = (ctx) => available() && Boolean(ctx) && eligible(ctx) && ordinary(ctx.profileId);
  /** The profile's key, made if missing. Only reached with a code whose shape is right. */
  const ready = (profileId) => { try { return keyring.ensure(profileId).state === 'ready' && keyring.peek(profileId).state === 'ready'; } catch { return false; } };
  const failure = (answer) => (answer.failure === 'clock' ? { result: 'clock' } : { result: 'offline', ...(answer.retry ? { retry: true } : {}) });
  const refusal = (answer) => (answer.result === 'rate_limited' ? { result: 'rate_limited', waitSeconds: answer.retryAfter ?? null } : { result: answer.result });

  /** One claim for this profile: the answer as the row reads it, the certificate kept when it is ok. A second press while one is out waits for it. */
  function claim(profileId, token, session) {
    if (working.has(profileId)) return working.get(profileId);
    const run = (async () => {
      const already = Boolean(member(profileId));
      if (!ready(profileId)) return { result: 'unavailable' };
      if (!routed(session)) return { result: 'offline', retry: true };
      const mine = generationOf(profileId);
      const answer = await client.activate(profileId, token, session);
      if (generationOf(profileId) !== mine) return { result: 'offline' };
      if (!answer.ok) return failure(answer);
      if (answer.result !== 'ok') return refusal(answer);
      const kept = keepCert(profileId, answer.cert, answer.invitesLeft);
      if (!kept) return { result: 'offline' };
      return { result: 'ok', number: kept.number, since: kept.since, by: kept.by, already };
    })();
    working.set(profileId, run);
    run.finally(() => { if (working.get(profileId) === run) working.delete(profileId); }).catch(() => {});
    return run;
  }

  const NONE = { available: false, eligible: false, state: 'idle', number: null, since: null, by: null };
  const api = {
    available, verified, member,
    /** What the row is shown. No network, nothing written, no key made. */
    view(ctx) {
      if (!available()) return { ...NONE };
      if (!guard(ctx)) return { ...NONE, available: true };
      const mine = member(ctx.profileId);
      if (mine) return { available: true, eligible: true, state: 'accepted', number: mine.number, since: mine.since, by: mine.by };
      return { available: true, eligible: true, state: working.has(ctx.profileId) ? 'checking' : 'idle', number: null, since: null, by: null };
    },
    /** "Insider code": {result, ...}. Nothing is sent, and no key is made, for anything that is not the shape of a code. */
    async code(ctx, request) {
      if (!guard(ctx)) return { result: 'unavailable' };
      const entry = parseEntry(request?.code);
      if (!entry.ok) return { result: 'invalid', local: true }; // told on the spot, never sent
      return claim(ctx.profileId, entry.token, sessionFor(ctx));
    },
    /** The Insider feed: the address and a signer of each request, for the first ordinary profile that holds a valid certificate; null otherwise (and then nothing at all is different). */
    feedAuth() {
      if (!available() || !config.feed) return null;
      let base;
      try { base = new URL(config.feed); } catch { return null; }
      for (const profile of profiles()) {
        if (!profile || profile.private || !ordinary(profile.id)) continue;
        const local = store.read(profile.id);
        if (!local.cert || local.channel === false || !verified(profile.id).ok) continue;
        const profileId = profile.id;
        return {
          url: config.feed, profileId,
          // Signed only for the Insider feed's own origin and path: a file the feed points at on another host gets no Acira headers.
          headers: (url, method = 'GET') => {
            try {
              const target = new URL(String(url));
              if (target.origin !== base.origin || !target.pathname.startsWith(base.pathname)) return undefined;
              return keyring.sign(profileId, { method, url: target.href, body: '', cert: certText(profileId) }) || undefined;
            } catch { return undefined; }
          },
        };
      }
      return null;
    },
    /** The Insider feed answered `revoked` for this profile: the certificate goes and the next look asks the ordinary feed. */
    feedRevoked(profileId) { if (typeof profileId === 'string' && certText(profileId)) drop(profileId); },
    /** A profile was deleted: its key and certificate go with it, and an answer on its way for it is ignored. */
    profileRemoved(profileId) {
      generation.set(profileId, generationOf(profileId) + 1);
      try { keyring.remove(profileId); } catch (error) { onWarning(`Insider: ${error.message}`); }
      try { store.remove(profileId); } catch (error) { onWarning(`Insider: ${error.message}`); }
    },
    stop() { working.clear(); },
    peek: (profileId) => store.read(profileId),
  };
  return api;
}

module.exports = { createInsiderService };
