'use strict';
// Beta 14: the browser's side of the six Insider functions (the Insider contract). One small JSON POST each on the profile's own session (so a proxy
// the person chose is used), HTTPS, no cookies, no Referer, no cache, no redirects, SIGNED by the profile's own key exactly as rule 3 says (Acira-Key, Acira-Ts, Acira-Sig, and
// Acira-Cert when the profile holds a certificate; desktop/insider/acira-signing.cjs). The body is exactly the contract's: {"token":...}, {"code":...} or {}. Nothing else about the
// person is in a request: no name, no address, no setting.
//   insider-activate {token} -> {result, cert?}      insider-redeem {code} -> {result, cert?}      insider-move {code} -> {result, cert?}
//   insider-invite {} -> {result, code?, invitesLeft} insider-invites {} -> {result, invites, invitesLeft?} insider-move-code {} -> {result, code?}
// Every answer is read through closed lists: a result that is not one of the function's own results is not an answer, a certificate must be text of a sane size, a number is an
// integer in range, and a code or hint is cut to what may be shown. Any function may answer {result:'clock_skew'} (the request's time is more than 5 minutes off).
//
// SAFE RETRIES (rule 4): activate, redeem and move are safe to send again (the server gives the same number and certificate back to the same key). When the answer is lost (no
// answer, a server fault, something that is not an answer) the same request goes again, freshly signed, after a short random delay that grows each time, at most RETRIES more times;
// then the caller offers "Try again". A real answer (any result, a wait, a clock problem) is never retried. Invites and move codes are NOT retried by themselves (a second request
// could make a second code): the person presses again.
//
// Resolves {ok:true, result, ...} or {ok:false, failure}: 'offline' (nothing usable came back; `retry: true` after the last try), 'later' (the server answered with something that is
// not an answer and is not worth repeating), 'clock' (clock_skew), 'nokey' (this profile has no readable key).
const { parseCode, parseMoveCode } = require('./insider-code.cjs');
const { CERT_MAX } = require('./acira-signing.cjs');

const RETRIES = 5, BASE_DELAY = 400, MAX_DELAY = 6000;
const CLAIMS = ['ok', 'used', 'invalid', 'expired', 'revoked', 'rate_limited'];
const RESULTS = Object.freeze({
  activate: CLAIMS, redeem: CLAIMS, move: CLAIMS,
  invite: ['ok', 'none_left', 'revoked', 'invalid', 'rate_limited'],
  invites: ['ok', 'revoked', 'invalid'],
  moveCode: ['ok', 'revoked', 'invalid', 'rate_limited'],
  // Automatic enrollment (reported 16 Nov): the next number while enrollment is open; closed and full are quiet ends.
  enroll: ['ok', 'closed', 'full', 'revoked', 'rate_limited'],
});
const FUNCTIONS = Object.freeze({ activate: 'insider-activate', redeem: 'insider-redeem', move: 'insider-move', invite: 'insider-invite', invites: 'insider-invites', moveCode: 'insider-move-code', enroll: 'insider-enroll' });
const RETRIED = new Set(['activate', 'redeem', 'move', 'enroll']); // enroll is as safe to send again: the same key gets the same number
const INVITE_STATES = Object.freeze(['unused', 'used', 'expired']);
const MAX_INVITES = 50;

const whole = (value, min, max) => (Number.isInteger(value) && value >= min && value <= max ? value : null);
const iso = (value) => { const time = typeof value === 'string' ? Date.parse(value) : NaN; return Number.isFinite(time) ? new Date(time).toISOString() : null; };
/** The wait before try `n` (1 = the first retry): half fixed, half random ("equal jitter"), doubling each time, so many people retrying at once spread out instead of arriving together. */
const retryDelay = (n, random = Math.random) => { const span = Math.min(MAX_DELAY, BASE_DELAY * 2 ** (n - 1)); return Math.round(span / 2 + random() * span / 2); };

/** What of an answer is kept, per function. Returns the clean answer or null when it is not an answer of that function. */
function readAnswer(kind, json) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  if (json.result === 'clock_skew') return { result: 'clock_skew' };
  if (!RESULTS[kind].includes(json.result)) return null;
  const answer = { result: json.result };
  if (json.result === 'rate_limited') answer.retryAfter = whole(json.retryAfter, 1, 24 * 3600);
  const left = whole(json.invitesLeft, 0, 999);
  if (left !== null && kind !== 'moveCode') answer.invitesLeft = left;
  if ((RESULTS[kind] === CLAIMS || kind === 'enroll') && json.result === 'ok') {
    if (typeof json.cert !== 'string' || !json.cert.length || json.cert.length > CERT_MAX) return null;
    answer.cert = json.cert;
  }
  if (kind === 'invite' && json.result === 'ok') { const code = parseCode(json.code); if (!code.ok) return null; answer.code = code.code; }
  // The server's own switch for invites (insider_enrollment.invites_open): while it is shut, an invite answers none_left with `closed: true` (the member still HAS their codes: none_left here is "not open yet", not "used up").
  if (kind === 'invite' && json.result === 'none_left' && json.closed === true) answer.closed = true;
  if (kind === 'moveCode' && json.result === 'ok') { const code = parseMoveCode(json.code); if (!code) return null; answer.code = code; }
  if (kind === 'invites' && json.result === 'ok') {
    // The server's own invites switch, as the list answer says it: ONLY a literal true is open, a missing or any other value is closed (order safety: an app that comes before the server change, or the function deployed on the live project, which does not pass the field on until it is redeployed, never opens invites).
    answer.invitesOpen = json.invitesOpen === true;
    const total = whole(json.invitesTotal, 0, 999); if (total !== null) answer.invitesTotal = total;
    answer.invites = (Array.isArray(json.invites) ? json.invites.slice(0, MAX_INVITES) : []).flatMap((item) => {
      if (!item || typeof item !== 'object' || !INVITE_STATES.includes(item.state) || typeof item.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(item.id)) return [];
      // The server holds only a fingerprint of a code, so a list can never show one in full: at most the last two characters of a hint are ever kept.
      const hint = typeof item.hint === 'string' ? item.hint.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(-2) : '';
      return [{ id: item.id, state: item.state, hint, createdAt: iso(item.createdAt), usedAt: item.state === 'used' ? iso(item.usedAt) : null }];
    });
  }
  return answer;
}

/**
 * `keys` is the contributor keyring (contributor-key.cjs: sign); `certOf(profileId)` the certificate the profile holds (sent as Acira-Cert) or null; `send(request, session)` the
 * transport ({status, json}); `wait(ms)` the delay between tries (tests pass their own).
 */
function createInsiderClient({ endpoint, keys, certOf = () => null, send, wait = (ms) => new Promise((resolve) => { const timer = setTimeout(resolve, ms); timer.unref?.(); }), random = Math.random, onTry = () => {} }) {
  const available = () => Boolean(endpoint);

  async function once(kind, profileId, fields, session) {
    const url = new URL(FUNCTIONS[kind], endpoint).href;
    const body = JSON.stringify(fields);
    const headers = keys.sign(profileId, { method: 'POST', url, body, cert: certOf(profileId) });
    if (!headers) return { ok: false, failure: 'nokey' };
    let answer;
    try { onTry(kind); answer = await send({ url, method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body }, session); } catch { answer = { status: 0 }; }
    if (!answer || !answer.status) return { ok: false, failure: 'offline', lost: true };
    // The functions answer with their own result even when it is a refusal (a wait is 429, a clock problem 401), so a well-formed result counts at any status.
    const read = readAnswer(kind, answer.json);
    if (read?.result === 'clock_skew') return { ok: false, failure: 'clock' };
    if (read) return { ok: true, ...read };
    return { ok: false, failure: answer.status >= 500 || (answer.status >= 200 && answer.status < 300) ? 'offline' : 'later', lost: answer.status >= 500 || (answer.status >= 200 && answer.status < 300), status: answer.status };
  }

  async function call(kind, profileId, fields, session) {
    if (!available()) return { ok: false, failure: 'later' };
    let answer = await once(kind, profileId, fields, session), tries = 1;
    if (!RETRIED.has(kind)) return answer;
    while (!answer.ok && answer.lost && tries <= RETRIES) {
      await wait(retryDelay(tries, random));
      answer = await once(kind, profileId, fields, session);
      tries += 1;
    }
    if (!answer.ok && answer.lost) return { ok: false, failure: 'offline', retry: true, tries };
    return { ...answer, tries };
  }

  return {
    available,
    /** The personal link's token (rule 4), for this profile's key. */
    activate: (profileId, token, session) => call('activate', profileId, { token }, session),
    /** An invite code ('ACIRA-XXXX-XXXX'), for this profile's key. */
    redeem: (profileId, code, session) => call('redeem', profileId, { code }, session),
    /** A move code ('ACIRA-XXXX-XXXX-XXXX'): the same Insider record and number move to this profile's key. */
    move: (profileId, code, session) => call('move', profileId, { code }, session),
    /** A fresh one-time code for a friend, if invites remain (sent with the certificate). */
    invite: (profileId, session) => call('invite', profileId, {}, session),
    /** The codes this Insider made, by state. */
    invites: (profileId, session) => call('invites', profileId, {}, session),
    /** A one-time move code for this Insider. */
    moveCode: (profileId, session) => call('moveCode', profileId, {}, session),
    /** Automatic enrollment: the next Insider number for this profile's key, while enrollment is open ({} body, signed like every call). */
    enroll: (profileId, session) => call('enroll', profileId, {}, session),
  };
}

module.exports = { createInsiderClient, readAnswer, retryDelay, RESULTS, FUNCTIONS, RETRIES };
