'use strict';
// Beta 14/E2: the browser's side of Acira's feedback server. Every request is one small JSON POST on the profile's own session
// (so a proxy the person chose is used), with no cookies, no Referer, no cache and no redirects, sent only because the person pressed Send, opened
// or the profile viewer, and signed with that profile's own contributor key (contributor-key.cjs: the public half and a
// signature go out, never the secret). Nothing is ever sent from a private or Tor window or profile (feedback-service.cjs checks that before it
// gets here). The tests run against a local stand-in for the server.
//
// Failures resolve to {ok:false, failure}: 'offline' (nothing answered), 'later' (the server answered and refused it: limits, its storage, anything
// else), 'clock' (it said the request's time is off: the computer's clock), 'nokey' (this profile has no readable key).
const { checkedEndpoint } = require('../browser-services/metrics.cjs');
const { SCHEMA } = require('./feedback-report.cjs');

const HOUR = 60 * 60 * 1000, REPORTS_PER_HOUR = 10, JSON_MAX = 64 * 1024;

/** The endpoints in use. A test profile never reaches a shipped project: only addresses QA names itself, plain http allowed on 127.0.0.1. */
function endpoints(env = process.env) {
  const test = Boolean(env.ACIRA_BROWSER_TEST_DATA), config = test ? null : require('./feedback-config.cjs');
  const pick = (value) => checkedEndpoint(value || '', { allowLocal: test });
  return {
    report: pick(test ? env.ACIRA_FEEDBACK_REPORT_ENDPOINT : config.reportEndpoint),
    contributor: pick(test ? env.ACIRA_FEEDBACK_CONTRIBUTOR_ENDPOINT : config.contributorEndpoint),
    discordInvite: checkedEndpoint(test ? env.ACIRA_FEEDBACK_DISCORD_INVITE : config.discordInvite, { allowLocal: test }),
    allowLocal: test,
  };
}

/** An upload address the server gave: https, no account in it, and on the same host as the report address (the server's own storage), so an answer can never aim a picture at another
 * machine, an address on this network or a name that is only local. In a test the local stand-in (plain http on 127.0.0.1) is taken. */
function uploadAddress(value, allowLocal, reportEndpoint = '') {
  let url; try { url = new URL(String(value)); } catch { return ''; }
  if (allowLocal && url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname) && !url.username && !url.password && !url.hash) return url.href;
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) return '';
  const host = url.hostname;
  if (host.startsWith('[') || /^\d+\.\d+\.\d+\.\d+$/.test(host) || host === 'localhost' || host.endsWith('.local') || host.endsWith('.localhost') || !host.includes('.')) return '';
  let site = ''; try { site = new URL(reportEndpoint).hostname; } catch { /* no address, no upload */ }
  return site && host === site ? url.href : '';
}

function createFeedbackClient({ endpoints: points = endpoints(), keys, send, now = Date.now }) {
  const sentAt = [];
  const available = () => Boolean(points.report && points.contributor);

  /** One signed POST. Resolves {ok, json} or {ok:false, failure}. */
  async function post(url, profileId, payload, session) {
    const body = JSON.stringify(payload);
    const proof = keys.sign(profileId, { method: 'POST', url, body }); // Beta 14: signed as in AH rule 3 (desktop/insider/acira-signing.cjs)
    if (!proof) return { ok: false, failure: 'nokey' };
    let answer;
    try { answer = await send({ url, method: 'POST', headers: { 'Content-Type': 'application/json', ...proof }, body }, session); } catch { answer = { status: 0 }; }
    if (!answer || !answer.status) return { ok: false, failure: 'offline' };
    if (answer.status === 200 && answer.json && answer.json.ok === true) return { ok: true, json: answer.json };
    return { ok: false, failure: (answer.json?.error === 'stale' || answer.json?.error === 'clock_skew' || answer.json?.result === 'clock_skew') ? 'clock' : 'later', status: answer.status };
  }
  const contributor = (profileId, action, fields, session) => post(points.contributor, profileId, { schema: SCHEMA, action, ...fields }, session);
  return {
    available,
    /** Sends a report: the message, then each file to the address the server gave for it, then "finish". `files` are {bytes, ...record} in the payload's order.
     * Resolves {sent:true, id, state, attachmentsFailed} or {sent:false, failure}. A file that did not upload does not lose the report: the text is already there. */
    async report(profileId, payload, files, session) {
      if (!available()) return { sent: false, failure: 'later' };
      while (sentAt.length && now() - sentAt[0] > HOUR) sentAt.shift();
      if (sentAt.length >= REPORTS_PER_HOUR) return { sent: false, failure: 'later' };
      const made = await post(points.report, profileId, payload, session);
      if (!made.ok) return { sent: false, failure: made.failure };
      const id = typeof made.json.id === 'string' ? made.json.id : '';
      if (!id) return { sent: false, failure: 'later' };
      sentAt.push(now());
      const uploaded = [];
      for (const slot of Array.isArray(made.json.uploads) ? made.json.uploads.slice(0, files.length) : []) {
        const file = Number.isInteger(slot?.index) ? files[slot.index] : null, url = uploadAddress(slot?.url, points.allowLocal, points.report);
        if (!file || !url || uploaded.includes(slot.index)) continue;
        try {
          const answer = await send({ url, method: 'PUT', headers: { 'Content-Type': file.type }, body: file.bytes, timeoutMs: 120000, upload: true }, session);
          if (answer?.status >= 200 && answer.status < 300) uploaded.push(slot.index);
        } catch { /* this file stays behind; the report is already sent */ }
      }
      let state = made.json.state ?? null;
      if (payload.attachments.length) {
        const finished = await post(points.report, profileId, { schema: SCHEMA, action: 'finish', id, uploaded }, session);
        if (finished.ok && finished.json.state) state = finished.json.state;
      }
      return { sent: true, id, state, attachmentsFailed: payload.attachments.length - uploaded.length };
    },
    /** The standing request: everything the profile's record says (points, rank, thresholds, reports, notes). `marks` are the local marks (Early Member). */
    status: (profileId, { marks = [], appVersion } = {}, session) => contributor(profileId, 'status', { marks, appVersion }, session),
    /** The person's answer to the note that asked "Want to be thanked in the release notes?": a name, or null for no. */
    thanks: (profileId, { noteId, name }, session) => contributor(profileId, 'thanks', { noteId, name }, session),
    /** The notes the person has now seen (they stop being sent). */
    seen: (profileId, noteIds, session) => contributor(profileId, 'seen', { noteIds }, session),
    /** "Delete my contributor data": the record on the server's side (the key and local copy are removed by the service). */
    deleteData: (profileId, session) => contributor(profileId, 'delete', {}, session),
  };
}

/** The real transport: `send({url, method, headers, body, timeoutMs}, session)` -> {status, json?}. No cookies, no Referer, no cache, no redirects. */
function electronSend(userAgent) {
  return async ({ url, method, headers, body, timeoutMs = 15000 }, session) => {
    const response = await session.fetch(url, { method, body, credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer', headers: { 'User-Agent': userAgent, ...headers }, signal: AbortSignal.timeout(timeoutMs) });
    let json;
    try { const text = await response.text(); if (text.length <= JSON_MAX) json = JSON.parse(text); } catch { json = undefined; }
    return { status: response.status, json };
  };
}

module.exports = { endpoints, uploadAddress, createFeedbackClient, electronSend, REPORTS_PER_HOUR };
