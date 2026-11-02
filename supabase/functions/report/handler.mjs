// The whole logic of the `report` Edge Function, with no Deno, network or database in it, so Node can run it in tests.
// index.ts supplies the real store (restStore) and the hashing salt; tests supply fakes.
//
// POST only. One message type, "Report a problem with this site" (src: desktop/browser-services/site-reports.cjs), with exactly these keys:
//   schema 1, host (a public site name only), kind and list (closed lists; list may be null), appVersion, platform (OS family),
//   note (the text the person typed, '' for none, at most 500 characters).
// Any other key or value is a 400, so a full address, a path, a query or an identifier cannot be stored. tests/supabase-site-reports.test.mjs
// fails if these lists drift from the SQL check constraints.
// Answers 204 (stored), 202 (a deploy health probe: valid, storage reachable, nothing stored), 400 (anything wrong with the request),
// 405 (wrong method), 429 (rate limited), 503 (storage trouble). Never any body, never CORS headers (the app is not a web page), never a
// cookie. The source address is only ever used as a salted daily hash for the rate limits; it is never stored or logged.

/** Request size limit. The longest valid report (a 253-character host and 500 four-byte characters of note) is about 2.4 KB;
 * tests/supabase-site-reports.test.mjs computes it. 4 KB fits it and still refuses anything bigger. */
export const MAX_BYTES = 4096;
export const NOTE_MAX = 500;
export const KINDS = Object.freeze(['blocked', 'broken', 'banner', 'other']);
export const LISTS = Object.freeze(['phishing', 'malware', 'phishing-db', 'lookalike', 'ad-blocking', 'cookie-banners']);
export const PLATFORMS = Object.freeze(['darwin', 'win32', 'linux']);
const FIELDS = ['schema', 'host', 'kind', 'list', 'appVersion', 'platform', 'note'];
/** Every site_reports column. The deploy health probe checks they exist. */
export const COLUMNS = Object.freeze(['id', 'created_at', 'host', 'kind', 'list', 'app_version', 'platform', 'note']);

/** A public DNS name in lowercase: dot-separated labels of 1-63 letters, digits and inner hyphens, ending in a letters-only or punycode label.
 * An IP address, a single label (localhost, intranet names) and a port, path or query never match. */
export const HOST = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;
/** Last labels that are never a public website: Tor, local networks, reserved test and documentation names. */
export const BLOCKED_TLDS = Object.freeze(['onion', 'local', 'localhost', 'internal', 'lan', 'home', 'arpa', 'test', 'invalid', 'example']);
export function validHost(host) {
  if (typeof host !== 'string' || host.length < 4 || host.length > 253 || !HOST.test(host)) return false;
  return !BLOCKED_TLDS.includes(host.slice(host.lastIndexOf('.') + 1));
}

const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,4}(?:[-.][0-9A-Za-z.]{1,16}){0,2}$/; // the same rule as usage's app version and the SQL check
/** C0 controls other than tab and line feed (so carriage return too), the Unicode line and paragraph separators, and lone surrogates. */
const BAD_NOTE = /[\u0000-\u0008\u000B-\u001F\u2028\u2029\uD800-\uDFFF]/u;
/** [name, window in seconds, limit]. Per source address (hour, day), per address and host (day), and for all callers together (hour). */
export const LIMITS = Object.freeze({ addressHour: ['h', 3600, 10], addressDay: ['d', 86400, 30], hostDay: ['s', 86400, 3], allHour: ['h', 3600, 3000] });

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const exactly = (keys, allowed) => keys.length === allowed.length && allowed.every((key) => keys.includes(key));

/** The note to store: trimmed, '' becomes null. Undefined when the note is not acceptable. */
function cleanNote(note) {
  if (typeof note !== 'string' || [...note].length > NOTE_MAX || BAD_NOTE.test(note)) return undefined;
  const trimmed = note.trim();
  return trimmed === '' ? null : trimmed;
}

/** Returns the site_reports row to store, or null when the body is not exactly a valid report. */
export function validate(value) {
  if (!isObject(value) || !exactly(Object.keys(value), FIELDS)) return null;
  const { schema, host, kind, list, appVersion, platform, note } = value;
  if (schema !== 1 || !validHost(host)) return null;
  if (typeof kind !== 'string' || !KINDS.includes(kind)) return null;
  if (list !== null && (typeof list !== 'string' || !LISTS.includes(list))) return null;
  if (typeof appVersion !== 'string' || appVersion.length > 24 || !VERSION.test(appVersion)) return null;
  if (typeof platform !== 'string' || !PLATFORMS.includes(platform)) return null;
  const stored = cleanNote(note);
  if (stored === undefined) return null;
  return { host, kind, list, app_version: appVersion, platform, note: stored };
}

/** The health-probe message the deploy script sends with `X-Acira-Probe: 1`. It passes validation, reaches storage, and stores nothing. */
export const PROBE = Object.freeze({ schema: 1, host: 'example.com', kind: 'blocked', list: 'phishing-db', appVersion: '0.0.0-probe', platform: 'linux', note: 'Deploy health check. Nothing is stored.' });

// addressKey and sourceAddress mirror supabase/functions/usage/handler.mjs (copied so each function deploys on its own; the tests compare them).
const hex = (buffer) => [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
/** A salted hash of the address that changes every day, so a stored counter key can never be turned back into an address or followed across days. */
export async function addressKey(address, secret, day) {
  const bytes = new TextEncoder().encode(`${secret}:${day}:${address}`);
  return hex(await crypto.subtle.digest('SHA-256', bytes)).slice(0, 32);
}
export const sourceAddress = (headers) => String(headers.get('x-forwarded-for') || headers.get('cf-connecting-ip') || headers.get('x-real-ip') || 'unknown').split(',')[0].trim().slice(0, 64) || 'unknown';

/** Reads the body as UTF-8, stopping as soon as it passes `limit` bytes (null then), so an oversized upload with no declared length is not
 * buffered whole. Bytes that are not valid UTF-8 throw. */
async function readCapped(request, limit) {
  if (!request.body) return '';
  const reader = request.body.getReader(), chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel().catch(() => {}); return null; }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

const reply = (status, headers = {}) => new Response(null, { status, headers });
const LIMITED = { 'Retry-After': '3600' };
const counter = (id, [name, seconds, limit]) => [`rp:${id}:${name}`, seconds, limit];

/** `store.hit(key, windowSeconds, limit)` -> true when allowed; `store.insert(row)` stores one report; `store.probe()` -> true when the table
 * and every column exist (reads no row). */
export function createHandler({ store, secret, now = () => Date.now() }) {
  return async function handle(request) {
    if (request.method !== 'POST') return reply(405, { Allow: 'POST' });
    const declared = Number(request.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_BYTES) return reply(400);
    let text;
    try { text = await readCapped(request, MAX_BYTES); } catch { return reply(400); }
    if (text === null) return reply(400);
    let body;
    try { body = JSON.parse(text); } catch { return reply(400); }
    const row = validate(body);
    if (!row) return reply(400);
    const probe = request.headers.get('x-acira-probe') === '1';
    try {
      const today = new Date(now()).toISOString().slice(0, 10), address = sourceAddress(request.headers);
      const ip = await addressKey(address, secret, today);
      const checks = [counter(ip, LIMITS.addressHour)];
      if (!probe) {
        // The same host from the same address: a hash of both, so the counter key names neither the address nor the site.
        const site = await addressKey(`${address}|${row.host}`, secret, today);
        // The global cap comes last, so callers already over their own limit do not use up everyone's allowance.
        checks.push(counter(ip, LIMITS.addressDay), counter(site, LIMITS.hostDay), counter('all', LIMITS.allHour));
      }
      for (const [key, seconds, limit] of checks) if (!(await store.hit(key, seconds, limit))) return reply(429, LIMITED);
      if (probe) return reply((await store.probe()) ? 202 : 503);
      await store.insert(row);
      return reply(204);
    } catch { return reply(503); }
  };
}
