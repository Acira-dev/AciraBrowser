'use strict';
// "Report a problem with this site" (Page information and Protection panels, and "This site is safe? Tell Acira" on the warning page).
// A report is one small JSON message to Acira's own write-only endpoint (supabase/functions/report), sent only when the person presses Send, and
// only ever with exactly what the panel showed them: the site's host (never the address, path or query), the problem they chose, which list or
// feature was involved when Acira knows it, Acira's version, the system family, and their optional note (500 characters at most). No history,
// cookie, account, install id or other identifier; the endpoint stores no IP address. Nothing is ever sent from a Tor window or tab.
// The panel shows preview()'s payload and send() rebuilds the same payload from the same inputs, so what is shown is what is sent.
const { checkedEndpoint } = require('./metrics.cjs');

const KINDS = Object.freeze(['blocked', 'broken', 'banner', 'other']);
/** Which list or feature was involved. Threat lists by their id in threat-lists.cjs, the look-alike address check, and the two site switches. */
const LISTS = Object.freeze(['phishing', 'malware', 'phishing-db', 'lookalike', 'ad-blocking', 'cookie-banners']);
const PLATFORMS = Object.freeze(['darwin', 'win32', 'linux']);
const NOTE_MAX = 500, SCHEMA = 1;
// The same rules as validHost() in supabase/functions/report/handler.mjs (tests/site-reports.test.cjs checks they agree): a public DNS name, lowercase,
// so an IP address, localhost, a single-label intranet name or a .onion address is never offered or sent.
const HOST = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;
const PRIVATE_TLDS = new Set(['onion', 'local', 'localhost', 'internal', 'lan', 'home', 'arpa', 'test', 'invalid', 'example']);
const HOUR = 60 * 60 * 1000, PER_HOUR = 10;

/** The host a report may name for an address, or '' when the address is not a public website. Never the port, path, query or fragment. */
function reportHost(address) {
  let url; try { url = new URL(String(address)); } catch { return ''; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (host.length < 4 || host.length > 253 || !HOST.test(host) || PRIVATE_TLDS.has(host.slice(host.lastIndexOf('.') + 1))) return '';
  return host;
}

/** The note as it will be sent: trimmed, line breaks as \n, no other control characters, at most 500 characters. */
function cleanNote(value) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new Error('The note must be text.');
  const text = value.replace(/\r\n?|[\u2028\u2029]/g, '\n').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '').trim();
  if ([...text].length > NOTE_MAX) throw new Error(`Keep the note under ${NOTE_MAX} characters.`);
  return text;
}

/** Exactly the message that is sent. Throws when something is not reportable. */
function buildReport({ address, kind, list = null, note = '', appVersion, platform }) {
  const host = reportHost(address);
  if (!host) throw new Error('Only websites can be reported.');
  if (!KINDS.includes(kind)) throw new Error('Choose what went wrong.');
  if (list !== null && !LISTS.includes(list)) list = null;
  return { schema: SCHEMA, host, kind, list, appVersion: String(appVersion), platform: PLATFORMS.includes(platform) ? platform : 'linux', note: cleanNote(note) };
}

/** The endpoints in use. A test profile never reaches the shipped (live) project: only addresses QA names itself, plain http allowed on 127.0.0.1. */
function endpoints(env = process.env) {
  const test = Boolean(env.ACIRA_BROWSER_TEST_DATA), config = test ? null : require('./site-reports-config.cjs');
  const pick = (value) => checkedEndpoint(value || '', { allowLocal: test });
  return { report: pick(test ? env.ACIRA_SITE_REPORT_ENDPOINT : config.reportEndpoint), allowlist: pick(test ? env.ACIRA_SITE_ALLOWLIST_ENDPOINT : config.allowlistEndpoint) };
}

/** `send(url, body, session)` -> HTTP status. `tor` is checked again here, whatever the panel did. */
function createSiteReports({ endpoint = endpoints().report, send, appVersion, platform = process.platform, now = Date.now }) {
  const sent = [];
  const available = () => Boolean(endpoint);
  function preview(input) {
    if (input.tor) return { available: false, reason: 'tor' };
    if (!available()) return { available: false, reason: 'unavailable' };
    if (!reportHost(input.address)) return { available: false, reason: 'not-a-website' };
    if (!KINDS.includes(input.kind)) return { available: true, payload: null };
    return { available: true, payload: buildReport({ ...input, appVersion, platform }) };
  }
  async function submit(input, session) {
    if (input.tor) throw new Error('Reports are never sent from Tor windows.');
    if (!available()) throw new Error('Reports are not available in this version.');
    const payload = buildReport({ ...input, appVersion, platform });
    while (sent.length && now() - sent[0] > HOUR) sent.shift();
    if (sent.length >= PER_HOUR) throw new Error('You sent several reports in the last hour. Try again later.');
    let status = 0;
    try { status = await send(endpoint, JSON.stringify(payload), session); } catch { status = 0; }
    if (status === 429) throw new Error('Too many reports were sent. Try again later.');
    if (status !== 204 && status !== 200) throw new Error('The report could not be sent. Check your connection and try again.');
    sent.push(now());
    return { sent: true, payload };
  }
  return { available, preview, send: submit };
}

/** The real transport, on the tab's own session so a proxy the person chose is used: POST, JSON, no cookies, no Referer, no cache, no redirects. */
function electronSend(userAgent) {
  return async (url, body, session) => {
    const response = await session.fetch(url, { method: 'POST', body, credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer', headers: { 'Content-Type': 'application/json', 'User-Agent': userAgent }, signal: AbortSignal.timeout(15000) });
    return response.status;
  };
}

module.exports = { KINDS, LISTS, NOTE_MAX, PRIVATE_TLDS, reportHost, cleanNote, buildReport, endpoints, createSiteReports, electronSend };
