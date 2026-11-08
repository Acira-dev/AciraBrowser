'use strict';
// Live pull requests, option A of the research note (previews/beta12/live-prs/README.md): read the profile's own github.com sign-in.
// No Acira server, no token kept: the request leaves the main process through the profile's own session (its cookies, its proxy, its
// content blocking) and asks github.com's search page for JSON, the same answer the page's own script gets. Signed out, GitHub answers
// 200 with `logged_in: false` (checked 7 Nov 2026), which is how this tells "not signed in" from "nothing waiting".
//
// What is NOT verified (nobody may sign in to GitHub in a test run): the signed-in answer for `author:@me` and the other `@me`
// queries, and whether the session's SameSite cookies are sent by a request that starts in the main process. Both are step 3 and 4
// of the spike in the report. Until then a shape or a query this file does not understand is "unreadable" (never a crash, never a
// guess) and the folder shows a quiet "Can't read GitHub right now" row; a source that fails backs off (refresh.cjs).
//
// The source is a function of an injected `request(url, headers)` so tests never touch the network:
//   request -> Promise<{status:number, headers:Record<string,string>, text:string}>   (rejects when the network is unreachable)
//   fetch({relations, recent, now}) -> {ok:true, rows, more} | {ok:false, reason, retryAfterMs?}
//   reason: 'signed-out' | 'rate-limited' | 'offline' | 'unreadable' | 'error'
const { mergeRows } = require('./model.cjs');

const SEARCH = 'https://github.com/search';
const QUERIES = Object.freeze({
  author: 'is:pr is:open author:@me',
  review: 'is:pr is:open review-requested:@me',
  assigned: 'is:pr is:open assignee:@me',
  mentioned: 'is:pr is:open mentions:@me',
});
const recentQuery = (since) => `is:pr is:closed involves:@me updated:>=${since}`;
const GAP_MS = 250;
const MIN_WAIT = 1000, MAX_WAIT = 2 * 3600 * 1000, DEFAULT_WAIT = 60 * 1000;

const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

/** How long the server asked us to wait: Retry-After in seconds or as a date, else the rate-limit reset time, else a minute. */
function waitFrom(headers, now) {
  const retry = headers['retry-after'];
  let ms = 0;
  if (retry !== undefined && retry !== '') {
    const seconds = Number(retry);
    ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retry) - now;
  } else if (headers['x-ratelimit-reset']) {
    ms = Number(headers['x-ratelimit-reset']) * 1000 - now;
  }
  if (!Number.isFinite(ms) || ms <= 0) ms = DEFAULT_WAIT;
  return Math.min(MAX_WAIT, Math.max(MIN_WAIT, Math.round(ms)));
}

/** The pull requests in one search answer. `relation` is the query's reason for being. */
function parseSearch(text, relation) {
  let data;
  try { data = JSON.parse(text); } catch { return { ok: false, reason: 'unreadable' }; }
  const route = data?.payload?.blackbirdSearchRoute;
  if (!route || typeof route !== 'object') return { ok: false, reason: 'unreadable' };
  if (route.logged_in === false) return { ok: false, reason: 'signed-out' };
  if (!Array.isArray(route.results)) return { ok: false, reason: 'unreadable' };
  if (!route.results.length && Array.isArray(route.errors) && route.errors.length) return { ok: false, reason: 'unreadable' };
  const rows = route.results.map((item) => {
    const repository = item?.repo?.repository;
    if (!repository || !repository.owner_login || !repository.name || !Number.isInteger(item.number)) return null;
    const stamp = Date.parse(item.updated_at || item.updated || item.created || '');
    return {
      url: `https://github.com/${repository.owner_login}/${repository.name}/pull/${item.number}`,
      title: item.hl_title ?? item.title,
      state: item.merged === true ? 'merged' : item.state,
      draft: item.reviewable_state === 'draft' || item.is_draft === true || item.draft === true,
      reviewRequested: relation === 'review',
      updatedAt: Number.isFinite(stamp) ? stamp : 0,
      relations: [relation],
    };
  }).filter(Boolean);
  return { ok: true, rows, more: Number(route.page_count) > 1 };
}

/** What a failed answer means. 200 is handled by parseSearch. */
function judgeStatus(response, now) {
  const { status, headers } = response;
  if (status === 0 || (status >= 300 && status < 400) || status === 401) return { ok: false, reason: 'signed-out' };
  if (status === 429) return { ok: false, reason: 'rate-limited', retryAfterMs: waitFrom(headers, now) };
  if (status === 403) {
    const limited = headers['retry-after'] !== undefined || headers['x-ratelimit-remaining'] === '0';
    return limited ? { ok: false, reason: 'rate-limited', retryAfterMs: waitFrom(headers, now) } : { ok: false, reason: 'error' };
  }
  if (status >= 500) return { ok: false, reason: 'error' };
  return { ok: false, reason: 'unreadable' };
}

/** What a trace line may say about one answer: the status, which of our readings it got, how many results and which field names the first one had.
 *  Never a title, an address or a name (the trace is for the first signed-in check, which only the person can do: README, "The spike"). */
function summarize(relation, response, answer) {
  let route = null;
  if (response && response.status === 200) { try { route = JSON.parse(response.text)?.payload?.blackbirdSearchRoute ?? null; } catch { route = null; } }
  const first = route && Array.isArray(route.results) && route.results[0] && typeof route.results[0] === 'object' ? route.results[0] : null;
  return {
    relation, status: response ? response.status : 0, reading: answer.ok ? 'ok' : answer.reason,
    loggedIn: route ? route.logged_in ?? null : null, results: route && Array.isArray(route.results) ? route.results.length : null,
    pages: route ? route.page_count ?? null : null, errors: route && Array.isArray(route.errors) ? route.errors.length : null,
    fields: first ? Object.keys(first).sort() : null, rows: answer.ok ? answer.rows.length : null,
  };
}

/** @param {{request: (url: string, headers: Record<string, string>) => Promise<{status:number, headers:Record<string,string>, text:string}>, pause?: (ms:number) => Promise<void>, trace?: (line: object) => void}} options */
function createGithubSessionSource({ request, pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), trace }) {
  const ask = async (query, relation, now) => {
    const url = `${SEARCH}?q=${encodeURIComponent(`${query} sort:updated-desc`)}&type=pullrequests`;
    let response, answer;
    try { response = await request(url, { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' }); } catch { answer = { ok: false, reason: 'offline' }; }
    if (!answer) answer = response.status !== 200 ? judgeStatus(response, now) : parseSearch(response.text, relation);
    try { trace?.({ at: new Date(now).toISOString(), ...summarize(relation, response, answer) }); } catch { /* a trace never changes an answer */ }
    return answer;
  };
  return {
    id: 'github-session',
    async fetch({ relations, recent = false, now = Date.now() }) {
      const asked = relations.filter((relation) => QUERIES[relation]).map((relation) => [QUERIES[relation], relation]);
      if (recent) asked.push([recentQuery(isoDay(now - 24 * 3600 * 1000)), 'recent']);
      const lists = [];
      let more = false;
      for (const [index, [query, relation]] of asked.entries()) {
        if (index) await pause(GAP_MS);
        const answer = await ask(query, relation, now);
        if (!answer.ok) return answer;
        lists.push(answer.rows);
        more ||= answer.more;
      }
      return { ok: true, rows: mergeRows(lists), more };
    },
  };
}

/** The production request: the profile's own session (cookies, proxy and blocking as its pages have them), 15 seconds at most, no referrer, no redirects followed. */
function sessionRequest(session) {
  return async (url, headers) => {
    const response = await session.fetch(url, { credentials: 'include', redirect: 'manual', referrerPolicy: 'no-referrer', headers, signal: AbortSignal.timeout(15000) });
    const out = {};
    response.headers.forEach((value, name) => { out[name.toLowerCase()] = value; });
    const text = response.status === 200 ? (await response.text()).slice(0, 2_000_000) : '';
    return { status: response.status, headers: out, text };
  };
}

module.exports = { createGithubSessionSource, sessionRequest, parseSearch, judgeStatus, waitFrom, QUERIES, recentQuery };
