'use strict';
// Live pull requests (item 31): the GitHub source reads the profile's own sign-in through an injected request, so nothing here touches the network.
const test = require('node:test'), assert = require('node:assert/strict');
const { createGithubSessionSource, sessionRequest, parseSearch, judgeStatus, waitFrom, QUERIES } = require('../desktop/live-prs/github-session.cjs');
const { mockRows, mockSourceFor, scriptedSource } = require('../desktop/live-prs/mock.cjs');

const NOW = Date.parse('2026-11-07T12:00:00Z');
// The shape github.com/search answered with on 7 Nov 2026 (signed out, a public query): the fields this file reads, with the rest left out.
const answer = (results, extra = {}) => JSON.stringify({ payload: { blackbirdSearchRoute: { results, logged_in: true, page_count: 1, errors: [], ...extra } } });
const result = (owner, name, number, extra = {}) => ({ number, state: 'open', merged: false, reviewable_state: 'ready', hl_title: `Title <em>${number}</em>`, created: '2026-11-07T10:00:00.000Z', repo: { repository: { owner_login: owner, name } }, ...extra });
const ok = (body, headers = {}) => ({ status: 200, headers, text: body });
const source = (handler, pauses = []) => createGithubSessionSource({ request: async (url, headers) => handler(url, headers), pause: async (ms) => { pauses.push(ms); } });
const queryOf = (url) => new URL(url).searchParams.get('q');

test('a search answer becomes adapter rows: address from owner, name and number; highlight tags stripped; draft from reviewable_state; merged from merged', () => {
  const out = parseSearch(answer([result('acme', 'app', 7), result('acme', 'app', 8, { reviewable_state: 'draft' }), result('acme', 'app', 9, { state: 'closed', merged: true })]), 'author');
  assert.equal(out.ok, true); assert.equal(out.more, false);
  assert.deepEqual(out.rows.map((row) => [row.url, row.state, row.draft]), [['https://github.com/acme/app/pull/7', 'open', false], ['https://github.com/acme/app/pull/8', 'open', true], ['https://github.com/acme/app/pull/9', 'merged', false]]);
  assert.equal(out.rows[0].title, 'Title <em>7</em>', 'the source passes the raw title; the model strips it (see model tests)');
  assert.equal(out.rows[0].updatedAt, Date.parse('2026-11-07T10:00:00.000Z'));
  assert.deepEqual(out.rows[0].relations, ['author']);
});

test('the review query marks its rows review-requested, the others do not', () => {
  assert.equal(parseSearch(answer([result('a', 'b', 1)]), 'review').rows[0].reviewRequested, true);
  assert.equal(parseSearch(answer([result('a', 'b', 1)]), 'author').rows[0].reviewRequested, false);
});

test('signed out is its own answer (logged_in false), not "nothing waiting"', () => {
  assert.deepEqual(parseSearch(answer([], { logged_in: false }), 'author'), { ok: false, reason: 'signed-out' });
  assert.deepEqual(parseSearch(answer([], { logged_in: true }), 'author'), { ok: true, rows: [], more: false }, 'signed in with nothing waiting is an empty list');
});

test('anything else GitHub might answer is unreadable: not JSON, no route, no results, a query it rejected', () => {
  for (const text of ['<html>', '', 'null', '{}', JSON.stringify({ payload: {} }), JSON.stringify({ payload: { blackbirdSearchRoute: { logged_in: true } } }), answer([], { errors: [{ message: 'bad query' }] })])
    assert.deepEqual(parseSearch(text, 'author'), { ok: false, reason: 'unreadable' }, text.slice(0, 40));
});

test('a result with no repository or number is skipped, not a crash', () => {
  const out = parseSearch(answer([{ number: 1 }, result('a', 'b', 2), { repo: { repository: { owner_login: 'x' } }, number: 3 }, null]), 'author');
  assert.equal(out.rows.length, 1);
});

test('more pages than the first sets `more`, so the folder can offer "More on GitHub"', () => {
  assert.equal(parseSearch(answer([result('a', 'b', 1)], { page_count: 3 }), 'author').more, true);
});

test('status codes: redirect or 401 = signed out; 429 and a limited 403 = rate limited with the wait; other 403 and 5xx = error; other 4xx = unreadable', () => {
  assert.equal(judgeStatus({ status: 302, headers: {} }, NOW).reason, 'signed-out');
  assert.equal(judgeStatus({ status: 0, headers: {} }, NOW).reason, 'signed-out', 'an opaque redirect');
  assert.equal(judgeStatus({ status: 401, headers: {} }, NOW).reason, 'signed-out');
  assert.deepEqual(judgeStatus({ status: 429, headers: { 'retry-after': '90' } }, NOW), { ok: false, reason: 'rate-limited', retryAfterMs: 90000 });
  assert.equal(judgeStatus({ status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(NOW / 1000 + 120) } }, NOW).retryAfterMs, 120000);
  assert.equal(judgeStatus({ status: 403, headers: { 'retry-after': '30' } }, NOW).reason, 'rate-limited');
  assert.equal(judgeStatus({ status: 403, headers: {} }, NOW).reason, 'error');
  assert.equal(judgeStatus({ status: 502, headers: {} }, NOW).reason, 'error');
  assert.equal(judgeStatus({ status: 404, headers: {} }, NOW).reason, 'unreadable');
});

test('how long to wait: Retry-After in seconds or as a date, else the reset time, else a minute; never under a second or over two hours', () => {
  assert.equal(waitFrom({ 'retry-after': '45' }, NOW), 45000);
  assert.equal(waitFrom({ 'retry-after': new Date(NOW + 300000).toUTCString() }, NOW), 300000);
  assert.equal(waitFrom({ 'x-ratelimit-reset': String(NOW / 1000 + 10) }, NOW), 10000);
  assert.equal(waitFrom({}, NOW), 60000);
  assert.equal(waitFrom({ 'retry-after': '0' }, NOW), 60000, 'a zero or past wait is not trusted');
  assert.equal(waitFrom({ 'retry-after': '999999' }, NOW), 2 * 3600 * 1000);
  assert.equal(waitFrom({ 'retry-after': 'soon' }, NOW), 60000);
});

test('one request per switched-on relation, one after the other with a pause between, asking github.com for JSON with no cookies named by us', async () => {
  const seen = [], pauses = [];
  const live = source(async (url, headers) => { seen.push({ url, headers }); return ok(answer([result('acme', 'app', seen.length)])); }, pauses);
  const out = await live.fetch({ relations: ['author', 'review', 'assigned'], now: NOW });
  assert.equal(out.ok, true);
  assert.equal(seen.length, 3); assert.equal(pauses.length, 2, 'a pause between requests, none before the first');
  for (const { url, headers } of seen) {
    const parsed = new URL(url);
    assert.equal(parsed.origin + parsed.pathname, 'https://github.com/search'); assert.equal(parsed.searchParams.get('type'), 'pullrequests');
    assert.equal(headers.Accept, 'application/json'); assert.equal('Cookie' in headers, false); assert.equal('Authorization' in headers, false);
  }
  assert.deepEqual(seen.map(({ url }) => queryOf(url)), [QUERIES.author, QUERIES.review, QUERIES.assigned].map((query) => query + ' sort:updated-desc'));
  assert.equal(out.rows.length, 3);
});

test('Mentioned is asked for only when it is on; Recently merged or closed adds one query for the last day', async () => {
  const seen = [];
  const live = source(async (url) => { seen.push(queryOf(url)); return ok(answer([])); });
  await live.fetch({ relations: ['author'], now: NOW });
  assert.equal(seen.length, 1);
  seen.length = 0;
  await live.fetch({ relations: ['author', 'mentioned'], recent: true, now: NOW });
  assert.equal(seen.length, 3);
  assert.match(seen[1], /mentions:@me/); assert.match(seen[2], /is:closed involves:@me updated:>=2026-11-06 /);
  seen.length = 0;
  await live.fetch({ relations: [], now: NOW });
  assert.equal(seen.length, 0, 'nothing switched on, nothing asked');
});

test('the same pull request found by two queries is one row with both reasons (yours and review requested)', async () => {
  const live = source(async (url) => ok(answer([result('acme', 'app', 5)])));
  const out = await live.fetch({ relations: ['author', 'review'], now: NOW });
  assert.equal(out.rows.length, 1); assert.deepEqual(out.rows[0].relations.sort(), ['author', 'review']); assert.equal(out.rows[0].reviewRequested, true);
});

test('the first failure ends the refresh: signed out, rate limited and an unreachable network each come back as they are, and no further request is made', async () => {
  for (const [handler, expected] of [
    [async () => ok(answer([], { logged_in: false })), { ok: false, reason: 'signed-out' }],
    [async () => ({ status: 429, headers: { 'retry-after': '120' }, text: '' }), { ok: false, reason: 'rate-limited', retryAfterMs: 120000 }],
    [async () => { throw new Error('ENOTFOUND'); }, { ok: false, reason: 'offline' }],
    [async () => ({ status: 200, headers: {}, text: 'not json' }), { ok: false, reason: 'unreadable' }],
  ]) {
    let calls = 0;
    const live = source(async (...args) => { calls += 1; return handler(...args); });
    assert.deepEqual(await live.fetch({ relations: ['author', 'review', 'assigned'], now: NOW }), expected);
    assert.equal(calls, 1);
  }
});

test('the production request goes through the profile session with its own sign-in, no referrer, no redirects followed, a time limit, and reads only a 200 body', async () => {
  const calls = [];
  const session = { fetch: async (url, init) => { calls.push({ url, init }); return calls.length === 1 ? { status: 200, headers: { forEach: (fn) => fn('application/json', 'Content-Type') }, text: async () => '{"a":1}' } : { status: 302, headers: { forEach: (fn) => fn('/login', 'Location') }, text: async () => { throw new Error('must not read'); } }; } };
  const request = sessionRequest(session);
  const first = await request('https://github.com/search?q=x', { Accept: 'application/json' });
  assert.deepEqual(first, { status: 200, headers: { 'content-type': 'application/json' }, text: '{"a":1}' });
  const second = await request('https://github.com/search?q=y', {});
  assert.equal(second.status, 302); assert.equal(second.text, '');
  assert.equal(calls[0].init.credentials, 'include'); assert.equal(calls[0].init.redirect, 'manual'); assert.equal(calls[0].init.referrerPolicy, 'no-referrer');
  assert.ok(calls[0].init.signal, 'a time limit');
  assert.equal(new URL(calls[0].url).hostname, 'github.com');
});

test('the mock source: pictures data with every state, scripted answers, and the QA variants', async () => {
  const rows = mockRows(NOW);
  assert.deepEqual(new Set(rows.map((row) => row.state + (row.draft ? '-draft' : '') + (row.reviewRequested ? '-review' : ''))), new Set(['open', 'open-review', 'open-draft', 'merged', 'closed']));
  assert.ok(rows.every((row) => row.url.startsWith('https://github.com/acme/')), 'made-up repositories only');
  for (const [kind, expected] of [['mock', true], ['mock:empty', true], ['mock:signed-out', false], ['mock:offline', false], ['mock:rate-limited', false], ['mock:bogus', false]]) assert.equal((await mockSourceFor(kind, () => NOW).fetch({})).ok, expected, kind);
  const scripted = scriptedSource([{ ok: false, reason: 'offline' }, () => ({ ok: true, rows: [] })]);
  assert.equal((await scripted.fetch({ a: 1 })).reason, 'offline'); assert.equal((await scripted.fetch({})).ok, true); assert.equal((await scripted.fetch({})).ok, true, 'the last answer repeats');
  assert.deepEqual(scripted.calls[0], { a: 1 });
});

test('the trace says what each answer was and never what it contained: statuses, readings, counts and field names only', async () => {
  const lines = [];
  const live = createGithubSessionSource({ request: async (url) => (/review-requested/.test(decodeURIComponent(url)) ? { status: 200, headers: {}, text: answer([], { logged_in: false }) } : ok(answer([result('acme', 'app', 7, { hl_title: 'SECRET TITLE' })], { page_count: 2 }))), pause: async () => {}, trace: (line) => lines.push(line) });
  await live.fetch({ relations: ['author', 'review'], now: NOW });
  assert.equal(lines.length, 2);
  assert.deepEqual(lines[0], { at: '2026-11-07T12:00:00.000Z', relation: 'author', status: 200, reading: 'ok', loggedIn: true, results: 1, pages: 2, errors: 0, fields: ['created', 'hl_title', 'merged', 'number', 'repo', 'reviewable_state', 'state'], rows: 1 });
  assert.deepEqual([lines[1].relation, lines[1].reading, lines[1].loggedIn, lines[1].rows], ['review', 'signed-out', false, null]);
  assert.doesNotMatch(JSON.stringify(lines), /SECRET TITLE|acme|github\.com/, 'no title, repository or address');
  const failing = createGithubSessionSource({ request: async () => { throw new Error('x'); }, pause: async () => {}, trace: (line) => lines.push(line) });
  await failing.fetch({ relations: ['author'], now: NOW }); assert.deepEqual([lines[2].status, lines[2].reading], [0, 'offline']);
  const broken = createGithubSessionSource({ request: async () => ok(answer([])), pause: async () => {}, trace: () => { throw new Error('disk full'); } });
  assert.equal((await broken.fetch({ relations: ['author'], now: NOW })).ok, true, 'a trace that fails changes nothing');
});
