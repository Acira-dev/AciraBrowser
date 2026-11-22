'use strict';
// The browser's side of the Insider server's one call 13.11 makes: insider-activate {token}. One small JSON POST on the profile's own session (so a proxy the person chose is used),
// HTTPS, no cookies, no Referer, no cache, no redirects, SIGNED by the profile's own key exactly as rule 3 says (Acira-Key, Acira-Ts, Acira-Sig; desktop/insider/acira-signing.cjs).
// The body is exactly the contract's: {"token":...}. Nothing else about the person is in a request: no name, no address, no setting. The address is the Insider server's alone: the
// request is built from the configured endpoint and refused (nothing signed, nothing sent) when it would go anywhere else.
//   insider-activate {token} -> {result, cert?}
// The answer is read through closed lists: a result that is not one of the function's own results is not an answer, and a certificate must be text of a sane size. The function may
// answer {result:'clock_skew'} (the request's time is more than 5 minutes off).
//
// SAFE RETRIES (rule 4): activate is safe to send again (the server gives the same number and certificate back to the same key). When the answer is lost (no answer, a server fault,
// something that is not an answer) the same request goes again, freshly signed, after a short random delay that grows each time, at most RETRIES more times; then the caller offers
// "Try again". A real answer (any result, a wait, a clock problem) is never retried.
//
// Resolves {ok:true, result, ...} or {ok:false, failure}: 'offline' (nothing usable came back; `retry: true` after the last try), 'later' (the server answered with something that is
// not an answer and is not worth repeating), 'clock' (clock_skew), 'nokey' (this profile has no readable key).
const { CERT_MAX } = require('./acira-signing.cjs');

const RETRIES = 5, BASE_DELAY = 400, MAX_DELAY = 6000;
/** A whole activation (every try and every wait) ends by itself after this long, with `offline` and a "Try again": Settings' row stops waiting at 15 s, so this is a little less. A try's own limit is what is left of it. */
const DEADLINE = 13000, MIN_TRY = 1500;
/** The results of insider-activate. `full` is not one the live server gives for a code today (it answers `revoked` and spends nothing); it is kept so a server that says it is understood. */
const CLAIMS = ['ok', 'used', 'invalid', 'expired', 'revoked', 'full', 'rate_limited'];
const FUNCTION = 'insider-activate';

const whole = (value, min, max) => (Number.isInteger(value) && value >= min && value <= max ? value : null);
/** The wait before try `n` (1 = the first retry): half fixed, half random ("equal jitter"), doubling each time, so many people retrying at once spread out instead of arriving together. */
const retryDelay = (n, random = Math.random) => { const span = Math.min(MAX_DELAY, BASE_DELAY * 2 ** (n - 1)); return Math.round(span / 2 + random() * span / 2); };

/** What of an answer is kept. Returns the clean answer or null when it is not an answer of insider-activate. */
function readAnswer(json) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  if (json.result === 'clock_skew') return { result: 'clock_skew' };
  if (!CLAIMS.includes(json.result)) return null;
  const answer = { result: json.result };
  if (json.result === 'rate_limited') answer.retryAfter = whole(json.retryAfter, 1, 24 * 3600);
  const left = whole(json.invitesLeft, 0, 999);
  if (left !== null) answer.invitesLeft = left;
  if (json.result === 'ok') {
    if (typeof json.cert !== 'string' || !json.cert.length || json.cert.length > CERT_MAX) return null;
    answer.cert = json.cert;
  }
  return answer;
}

/**
 * `endpoint` is the Insider server's base address (insider-config.cjs); `keys` the contributor keyring (contributor-key.cjs: sign); `send(request, session)` the transport
 * ({status, json}); `wait(ms)` the delay between tries (tests pass their own).
 */
function createInsiderClient({ endpoint, keys, send, wait = (ms) => new Promise((resolve) => { const timer = setTimeout(resolve, ms); timer.unref?.(); }), random = Math.random, onTry = () => {}, now = Date.now, deadline = DEADLINE }) {
  let origin = '';
  try { const parsed = endpoint ? new URL(endpoint) : null; origin = parsed && /^https?:$/.test(parsed.protocol) ? parsed.origin : ''; } catch { origin = ''; }
  const available = () => Boolean(origin);

  async function once(profileId, fields, session, end) {
    const url = new URL(FUNCTION, endpoint).href;
    if (new URL(url).origin !== origin) return { ok: false, failure: 'later' }; // never signed, never sent: only the Insider server's own address is ever asked
    const body = JSON.stringify(fields);
    const headers = keys.sign(profileId, { method: 'POST', url, body });
    if (!headers) return { ok: false, failure: 'nokey' };
    let answer;
    try { onTry(); answer = await send({ url, method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body, timeoutMs: Math.max(MIN_TRY, Math.min(15000, end - now())) }, session); } catch { answer = { status: 0 }; }
    if (!answer || !answer.status) return { ok: false, failure: 'offline', lost: true };
    // The function answers with its own result even when it is a refusal (a wait is 429, a clock problem 401), so a well-formed result counts at any status.
    const read = readAnswer(answer.json);
    if (read?.result === 'clock_skew') return { ok: false, failure: 'clock' };
    if (read) return { ok: true, ...read };
    const lost = answer.status >= 500 || (answer.status >= 200 && answer.status < 300);
    return { ok: false, failure: lost ? 'offline' : 'later', lost, status: answer.status };
  }

  async function activate(profileId, token, session) {
    if (!available()) return { ok: false, failure: 'later' };
    const end = now() + deadline;
    let answer = await once(profileId, { token }, session, end), tries = 1;
    while (!answer.ok && answer.lost && tries <= RETRIES) {
      const pause = retryDelay(tries, random);
      if (now() + pause + MIN_TRY > end) break; // no time for another try: "Try again" (a safe retry, the server gives the same answer back)
      await wait(pause);
      answer = await once(profileId, { token }, session, end);
      tries += 1;
    }
    if (!answer.ok && answer.lost) return { ok: false, failure: 'offline', retry: true, tries };
    return { ...answer, tries };
  }

  return { available, activate };
}

const JSON_MAX = 64 * 1024;
/**
 * The real transport: one fetch on the profile's own session (its proxy and DNS), no cookies, no cache, no Referer, no redirect (a redirect is an error, so a signed request can never be
 * forwarded to another address), a timeout. Resolves {status, json} (json only when the body is JSON of a sane size).
 */
function electronSend(userAgent) {
  return async ({ url, method, headers, body, timeoutMs = 15000 }, session) => {
    const response = await session.fetch(url, { method, body, credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer', headers: { 'User-Agent': userAgent, ...headers }, signal: AbortSignal.timeout(timeoutMs) });
    let json;
    try { const text = await response.text(); if (text.length <= JSON_MAX) json = JSON.parse(text); } catch { json = undefined; }
    return { status: response.status, json };
  };
}

module.exports = { createInsiderClient, electronSend, readAnswer, retryDelay, CLAIMS, FUNCTION, RETRIES, DEADLINE };
