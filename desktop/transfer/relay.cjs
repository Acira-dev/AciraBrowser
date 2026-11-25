'use strict';
// The HTTP client for the transfer relay (protocol 2): one method per operation, an injectable `fetch`, a timeout on
// every request, retries with back-off for a connection that drops, and every answer turned into either the parsed body or a RelayError whose
// `reason` the session understands. Section 8.4 and 12.2 of the design notes.
//
// The real `fetch` is the active profile's session.fetch (main passes it in), so a proxy the person chose is respected. Every request goes out with
// credentials omitted, redirects refused, no referrer and a plain Acira user agent. Nothing here logs: a URL carries the slot, a header the token.
//
// What counts as a lost connection (retried, then reported as `offline`, or `slow` for a chunk that keeps timing out): a network error, a timeout, a
// 502/504 or a bare 5xx, and an answer that is not what the relay sends (a captive portal's HTML page). What does not (reported at once): the relay's
// own answers, 4xx and the 503 `busy`; a 404 that is not the relay's JSON is the platform saying the function is not deployed (`unavailable`).
const C = require('./constants.cjs');

/** `reason` is one of: offline, slow, unavailable, busy, rate_limited, not_found, not_yet, in_use, slot_taken, expired, ended, gone (401: the session
 * no longer exists for this token), bad_state, too_large, bad_request, unsupported_protocol, aborted. */
class RelayError extends Error {
  constructor(reason, status = 0) { super(reason); this.name = 'RelayError'; this.reason = reason; this.status = status; }
}

const ERROR_REASONS = Object.freeze({
  unauthorized: 'gone', not_found: 'not_found', not_yet: 'not_yet', in_use: 'in_use', slot_taken: 'slot_taken', expired: 'expired', ended: 'ended',
  bad_state: 'bad_state', too_large: 'too_large', busy: 'busy', rate_limited: 'rate_limited', bad_request: 'bad_request', unsupported_protocol: 'unsupported_protocol',
});
const PATIENCE = Object.freeze({ first: 8000, call: 60000, data: 90000 });

/** Waits `ms`, or less when `signal` aborts. */
const pause = (ms, signal) => new Promise((resolve) => {
  if (signal?.aborted) return resolve();
  const timer = setTimeout(done, ms);
  function done() { clearTimeout(timer); signal?.removeEventListener('abort', done); resolve(); }
  signal?.addEventListener('abort', done, { once: true });
});

function createRelay({ endpoint, fetch: fetchImpl = globalThis.fetch, userAgent = 'Acira', now = () => Date.now(), sleep = pause, backoff = C.BACKOFF, timeouts = {}, patience = {} } = {}) {
  if (typeof endpoint !== 'string' || !endpoint) throw new TypeError('The relay needs an endpoint.');
  const base = endpoint.replace(/\/+$/, '');
  const limits = { call: C.TIMEOUT_CALL, wait: C.TIMEOUT_WAIT, data: C.TIMEOUT_DATA, ...timeouts };
  const waits = { ...PATIENCE, ...patience };
  let offset = 0; // server clock minus this computer's clock, from the last answer

  const noteTime = (body) => { if (body && Number.isFinite(body.serverTime)) offset = body.serverTime - now(); };
  const tokenHeader = (token) => (token ? { 'x-acira-transfer-token': Buffer.from(token).toString('base64url') } : {});

  /** One attempt. Returns the parsed body (JSON ops), the bytes (get) or null (204); throws RelayError with `transient` set when worth retrying. */
  async function attempt(op, { method = 'POST', query = '', token, body, raw, kind = 'call', signal }) {
    const timeout = AbortSignal.timeout(limits[kind]);
    const init = {
      method, credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', cache: 'no-store',
      headers: { 'User-Agent': userAgent, ...tokenHeader(token), ...(raw ? { 'Content-Type': 'application/octet-stream' } : body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
      ...(raw ? { body: raw } : body !== undefined ? { body: JSON.stringify(body) } : {}),
    };
    let response;
    try { response = await fetchImpl(`${base}?op=${op}${query}`, init); } catch (cause) {
      if (signal?.aborted) throw new RelayError('aborted');
      const lost = new RelayError(timeout.aborted && kind === 'data' ? 'slow' : 'offline');
      lost.transient = true;
      throw lost;
    }
    const type = String(response.headers.get('content-type') || '').toLowerCase();
    let text = null;
    const readText = async () => { if (text === null) { try { text = await response.text(); } catch { text = ''; } } return text; };
    const lost = (reason) => Object.assign(new RelayError(reason, response.status), { transient: true });

    if (response.status === 204) return null;
    if (response.status >= 200 && response.status < 300) {
      if (op === 'get') {
        let data;
        try { data = Buffer.from(await response.arrayBuffer()); } catch { throw lost(kind === 'data' && timeout.aborted ? 'slow' : 'offline'); }
        if (!type.startsWith('application/octet-stream') || data.length < 17 || data.length > 524304) throw lost('offline');
        return data;
      }
      let parsed;
      try { parsed = JSON.parse(await readText()); } catch { throw lost('offline'); } // not the relay: a captive portal or a proxy page
      if (!type.startsWith('application/json') || !parsed || typeof parsed !== 'object') throw lost('offline');
      noteTime(parsed);
      return parsed;
    }
    let parsed = null;
    if (type.startsWith('application/json')) { try { parsed = JSON.parse(await readText()); } catch { parsed = null; } }
    const code = parsed && typeof parsed.error === 'string' ? parsed.error : '';
    // The platform saying no, not the relay (a Free plan whose monthly allowance is used up answers 402/403, or a 429 without the relay's own error): "busy, try later, or use a file" and no retry, a retry cannot help
    if (response.status === 402 || response.status === 403 || (response.status === 429 && code !== 'rate_limited')) throw new RelayError('busy', response.status);
    if (response.status === 429) throw new RelayError('rate_limited', 429);
    if (code && Object.hasOwn(ERROR_REASONS, code)) {
      if (response.status >= 500 && code !== 'busy') throw lost('unavailable');
      throw new RelayError(ERROR_REASONS[code], response.status);
    }
    if (code === 'unavailable' || response.status === 502 || response.status === 504 || (response.status >= 500 && !code)) throw lost('unavailable');
    // Anything else (the platform's own 404 "function not found", a gateway 401, a 405): this is not a working relay.
    throw new RelayError('unavailable', response.status);
  }

  /** Runs `attempt` again after a lost connection, backing off 1, 2, 4, 8, then 15 s, for as long as `patience` allows. */
  async function request(op, spec) {
    const started = now();
    const patience = spec.patience ?? waits.call;
    for (let tries = 0; ; tries++) {
      if (spec.signal?.aborted) throw new RelayError('aborted');
      try { return await attempt(op, spec); } catch (error) {
        if (!(error instanceof RelayError)) throw new RelayError('offline');
        if (!error.transient) throw error;
        const delay = backoff[Math.min(tries, backoff.length - 1)];
        if (now() - started + delay > patience) throw new RelayError(error.reason, error.status);
        await sleep(delay, spec.signal);
      }
    }
  }
  const q = (slot, extra = '') => `&slot=${slot}${extra}`;

  return {
    /** Server clock minus ours, in ms; local(serverMs) turns a deadline from the relay into this computer's clock. */
    get offset() { return offset; },
    local: (serverMs) => (Number.isFinite(serverMs) ? serverMs - offset : null),
    /** Deploy health check: the function is there and its tables exist. */
    ping: (opts = {}) => request('ping', { method: 'GET', ...opts }),
    create: (body, opts = {}) => request('create', { body, patience: waits.first, ...opts }),
    join: (body, opts = {}) => request('join', { body, patience: waits.first, ...opts }),
    /** Long-poll: answers as soon as the state, the acked number or the uploaded count differs from `since`, or after at most 25 s. */
    wait: ({ slot, token, since }, opts = {}) => request('wait', { body: { slot, since: since ?? null }, token, kind: 'wait', ...opts }),
    hello: ({ slot, token, pkA, infoA, macA }, opts = {}) => request('hello', { body: { slot, pkA, infoA, macA }, token, ...opts }),
    approve: ({ slot, token, approveMac, totalChunks, totalBytes }, opts = {}) => request('approve', { body: { slot, approveMac, totalChunks, totalBytes }, token, ...opts }),
    put: ({ slot, token, index, data }, opts = {}) => request('put', { method: 'PUT', query: q(slot, `&i=${index}`), raw: data, token, kind: 'data', patience: waits.data, ...opts }),
    get: ({ slot, token, index }, opts = {}) => request('get', { method: 'GET', query: q(slot, `&i=${index}`), token, kind: 'data', patience: waits.data, ...opts }),
    ack: ({ slot, token, upTo }, opts = {}) => request('ack', { body: { slot, upTo }, token, ...opts }),
    done: ({ slot, token }, opts = {}) => request('done', { body: { slot }, token, ...opts }),
    cancel: ({ slot, token, reason }, opts = {}) => request('cancel', { body: { slot, reason }, token, ...opts }),
  };
}

module.exports = { createRelay, RelayError, PATIENCE };
