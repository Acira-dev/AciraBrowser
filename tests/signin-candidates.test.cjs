'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { computeCandidates, hostOf, registrable, providerOf, loginPageOf } = require('../desktop/signin/candidates.cjs');
const { createSignin, onSignInPage, signInCookies } = require('../desktop/signin/service.cjs');

const NOW = Date.parse('2026-10-27T12:00:00Z');
const DAY = 86400000;
const ago = (days) => new Date(NOW - days * DAY).toISOString();
const visit = (url, days = 1, times = 1) => Array.from({ length: times }, () => ({ url, time: ago(days) }));
const ids = (list) => list.map((item) => item.id);

test('hosts and registrable domains: www is dropped, co.uk keeps three labels, IPs and one-word hosts are not sites', () => {
  assert.equal(hostOf('https://www.Acme.com/a?b=1'), 'acme.com');
  assert.equal(hostOf('http://192.168.1.4/router'), '');
  assert.equal(hostOf('https://intranet/'), '');
  assert.equal(hostOf('about:blank'), '');
  assert.equal(hostOf('chrome://settings'), '');
  assert.equal(registrable('app.acme.com'), 'acme.com');
  assert.equal(registrable('shop.delta.co.uk'), 'delta.co.uk');
  assert.equal(registrable('acme.com'), 'acme.com');
});

test('one account covers many sites: Google, YouTube and Gmail are one row, with the services the person uses first', () => {
  const rows = computeCandidates({
    now: NOW,
    visits: [...visit('https://www.youtube.com/watch?v=1', 2, 40), ...visit('https://mail.google.com/mail/u/0/', 1, 12), ...visit('https://www.google.com/search?q=a', 1, 30), ...visit('https://drive.google.com/', 5, 3)],
  });
  assert.equal(rows.length, 1);
  const [google] = rows;
  assert.equal(google.id, 'google');
  assert.equal(google.kind, 'provider');
  assert.equal(google.name, 'Google');
  assert.equal(google.url, 'https://accounts.google.com/signin');
  assert.equal(google.visits, 85);
  assert.deepEqual(google.covers, ['YouTube', 'Gmail', 'Drive', 'Maps']);
  assert.equal(google.host, 'google.com');
});

test('Google leads, then Microsoft, then Apple, even when other sites are visited more; the rest follow by score', () => {
  const rows = computeCandidates({
    now: NOW,
    visits: [
      ...visit('https://github.com/login', 1, 3), ...visit('https://github.com/acira', 1, 200),
      ...visit('https://www.apple.com/', 3, 2),
      ...visit('https://outlook.live.com/mail/', 1, 4),
      ...visit('https://www.google.com/', 1, 1),
      ...visit('https://news.ycombinator.com/', 1, 100),
    ],
  });
  assert.deepEqual(ids(rows).slice(0, 4), ['google', 'microsoft', 'apple', 'github']);
});

test('recent visits count for more than old ones, and visits past 90 days do not count', () => {
  const rows = computeCandidates({
    now: NOW,
    visits: [...visit('https://recent.cargo.net/', 1, 8), ...visit('https://old.bravo.org/', 80, 8), ...visit('https://ancient.echo.io/', 120, 50)],
  });
  assert.deepEqual(ids(rows), ['site:cargo.net', 'site:bravo.org']);
  assert.ok(rows[0].score > rows[1].score);
});

test('sub-domains of one site are one row; a regional domain is its own site', () => {
  const rows = computeCandidates({
    now: NOW,
    visits: [...visit('https://app.acme.com/home', 1, 4), ...visit('https://www.acme.com/', 1, 3), ...visit('https://docs.acme.com/', 2, 2), ...visit('https://shop.delta.co.uk/', 1, 9)],
  });
  assert.deepEqual(ids(rows).sort(), ['site:acme.com', 'site:delta.co.uk']);
  const com = rows.find((row) => row.id === 'site:acme.com');
  assert.equal(com.visits, 9);
  assert.equal(com.name, 'acme.com');
  assert.equal(com.url, 'https://app.acme.com/');
});

test('a site with one visit and no other sign is left out; a saved password, a sign-in page or a bookmark brings it in', () => {
  const quiet = computeCandidates({ now: NOW, visits: visit('https://blog.cargo.net/post', 2, 1) });
  assert.deepEqual(quiet, []);
  const bookmarked = computeCandidates({ now: NOW, visits: visit('https://blog.cargo.net/post', 2, 2), bookmarks: ['https://blog.cargo.net/'] });
  assert.deepEqual(ids(bookmarked), ['site:cargo.net']);
  const saved = computeCandidates({ now: NOW, passwordHosts: ['https://bank.bravo.org', 'bank.bravo.org'] });
  assert.deepEqual(ids(saved), ['site:bravo.org']);
  assert.equal(saved[0].saved, true);
  const login = computeCandidates({ now: NOW, visits: visit('https://club.acme.com/members/login?next=/private&token=abc#frag', 3, 1) });
  assert.deepEqual(ids(login), ['site:acme.com']);
  assert.equal(login[0].url, 'https://club.acme.com/members/login', 'the query and fragment are dropped');
});

test('a saved password marks the row for autofill and lifts it above plain visits', () => {
  const rows = computeCandidates({
    now: NOW,
    visits: [...visit('https://busy.cargo.net/', 1, 20), ...visit('https://vault.bravo.org/', 20, 14)],
    passwordHosts: ['https://vault.bravo.org'],
  });
  assert.equal(rows[0].id, 'site:bravo.org');
  assert.equal(rows[0].saved, true);
  assert.equal(rows[1].saved, false);
});

test('the password file alone is enough: its hosts become rows even with no history', () => {
  const rows = computeCandidates({ now: NOW, passwordHosts: ['https://github.com', 'https://accounts.google.com', 'https://netflix.com'] });
  assert.deepEqual(ids(rows), ['google', 'github', 'netflix']);
  assert.ok(rows.every((row) => row.saved));
});

test('providers: longest owned domain wins, regional shops sign in on their own domain, unknown sites have no provider', () => {
  assert.equal(providerOf('console.aws.amazon.com').id, 'aws');
  assert.equal(providerOf('www.amazon.de'.replace(/^www\./, '')).id, 'amazon');
  assert.equal(providerOf('google.co.uk').id, 'google');
  assert.equal(providerOf('acme.com'), null);
  const rows = computeCandidates({ now: NOW, visits: visit('https://www.amazon.de/gp/cart', 1, 3) });
  assert.equal(rows[0].url, 'https://www.amazon.de/ap/signin');
  const uk = computeCandidates({ now: NOW, visits: visit('https://www.amazon.co.uk/', 1, 3) });
  assert.equal(uk[0].url, 'https://www.amazon.co.uk/ap/signin');
});

test('sites that never need an account and shared hosts are not offered', () => {
  const rows = computeCandidates({
    now: NOW,
    visits: [...visit('https://en.wikipedia.org/wiki/Cat', 1, 80), ...visit('https://www.bing.com/search?q=a', 1, 80), ...visit('https://someone.github.io/', 1, 30), ...visit('https://localhost:3000/', 1, 40), ...visit('http://192.168.0.1/', 1, 40)],
    bookmarks: ['https://en.wikipedia.org/'],
  });
  assert.deepEqual(rows, []);
});

test('the list is capped, ranked, and stable across calls', () => {
  const visits = [];
  for (let i = 0; i < 30; i++) visits.push(...visit(`https://store${i}.net/`, 1 + (i % 5), 7 + i));
  const first = computeCandidates({ now: NOW, visits, limit: 10 });
  const second = computeCandidates({ now: NOW, visits: [...visits].reverse(), limit: 10 });
  assert.equal(first.length, 10);
  assert.deepEqual(ids(first), ids(second));
  for (let i = 1; i < first.length; i++) assert.ok(first[i - 1].score >= first[i].score);
});

test('only an https sign-in page is remembered, never its query', () => {
  assert.equal(loginPageOf('https://a.acme.com/users/sign_in?x=1'), 'https://a.acme.com/users/sign_in');
  assert.equal(loginPageOf('http://a.acme.com/login'), '');
  assert.equal(loginPageOf('https://a.acme.com/blog/post'), '');
});

test('an account with a saved password but no recent visit is listed below the ones in use', () => {
  const rows = computeCandidates({
    now: NOW,
    visits: visit('https://busy.cargo.net/', 1, 6),
    passwordHosts: ['https://dormant.bravo.org/login', 'https://busy.cargo.net'],
  });
  assert.deepEqual(ids(rows), ['site:cargo.net', 'site:bravo.org']);
  assert.ok(rows[0].score > rows[1].score);
});

// ── progress state ─────────────────────────────────────────────────────────────────────────────────────────────────

function harness() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-signin-'));
  const file = path.join(dir, 'signin.json');
  let clock = NOW;
  const service = createSignin({ file, now: () => clock });
  const visits = [...visit('https://www.youtube.com/', 1, 20), ...visit('https://github.com/', 1, 20), ...visit('https://club.acme.com/members/login', 2, 3)].map((v) => ({ ...v, importBatchId: 'import-1' }));
  const base = { visits, bookmarks: [], passwordOrigins: ['https://github.com'], cookies: [], tabUrls: [] };
  return { dir, file, service, base, tick: (ms) => { clock += ms; } };
}

test('progress: rows start to do, count only signed-in ones, and the order does not shuffle', () => {
  const { service, base } = harness();
  const plan = service.plan('p1', base);
  assert.deepEqual(plan.items.map((item) => item.id), ['google', 'github', 'site:acme.com']);
  assert.deepEqual(plan.items.map((item) => item.status), ['todo', 'todo', 'todo']);
  assert.equal(plan.total, 3);
  assert.equal(plan.done, 0);
  assert.equal(plan.items.find((item) => item.id === 'github').autofill, true, 'a saved password says Autofill ready');
  assert.equal(plan.items.find((item) => item.id === 'google').autofill, false);
  service.mark('p1', 'github', 'done');
  service.mark('p1', 'site:acme.com', 'skipped');
  const after = service.plan('p1', { ...base, visits: [...base.visits, ...visit('https://new.cargo.net/', 0, 99)] });
  assert.deepEqual(after.items.map((item) => item.id), ['google', 'github', 'site:acme.com'], 'a new busy site waits for a refresh');
  assert.equal(after.total, 2, 'a skipped row leaves the count');
  assert.equal(after.done, 1);
  assert.equal(after.items[1].by, 'manual');
  const refreshed = service.plan('p1', { ...base, visits: [...base.visits, ...visit('https://new.cargo.net/', 0, 99)], refresh: true });
  assert.ok(refreshed.items.some((item) => item.id === 'site:cargo.net'));
  service.mark('p1', 'github', 'todo');
  assert.equal(service.plan('p1', base).done, 0);
});

test('progress survives a restart, per profile, and a profile with nothing imported gets no list', () => {
  const { service, base, file } = harness();
  service.plan('p1', base);
  service.mark('p1', 'google', 'done');
  service.dismiss('p1', true);
  const again = createSignin({ file, now: () => NOW });
  const plan = again.plan('p1', base);
  assert.equal(plan.dismissed, true);
  assert.equal(plan.items.find((item) => item.id === 'google').status, 'done');
  assert.deepEqual(again.plan('p2', { ...base, eligible: false }).items, []);
  assert.equal(again.plan('p2', { ...base, eligible: false }).total, 0);
  again.removeProfile('p1');
  assert.deepEqual(createSignin({ file, now: () => NOW }).plan('p1', { ...base, eligible: false }).items, []);
});

test('the list retires to Settings after 14 days', () => {
  const { service, base, tick } = harness();
  assert.equal(service.plan('p1', base).retired, false);
  tick(13 * DAY);
  assert.equal(service.plan('p1', base).retired, false);
  tick(2 * DAY);
  assert.equal(service.plan('p1', base).retired, true);
});

test('signed in is inferred from new session-cookie NAMES after the sign-in page has been left', () => {
  const { service, base } = harness();
  service.plan('p1', base);
  // Google: its own cookie is proof once the tab has left accounts.google.com.
  const google = (extra) => ({ ...base, cookies: [{ domain: '.google.com', name: 'NID', value: 'CANARY-NID' }, ...extra] });
  const sid = { domain: '.google.com', name: 'SAPISID', value: 'CANARY-SAPISID' };
  assert.equal(service.plan('p1', google([])).items[0].status, 'todo');
  assert.equal(service.plan('p1', { ...google([sid]), tabUrls: ['https://accounts.google.com/v3/signin/challenge/pwd'] }).items[0].status, 'todo', 'still on the sign-in page');
  const done = service.plan('p1', { ...google([sid]), tabUrls: ['https://myaccount.google.com/'] });
  assert.equal(done.items[0].status, 'done');
  assert.equal(done.items[0].by, 'detected');
  assert.equal(done.done, 1);
});

test('a guessed session cookie counts only after Sign in was pressed on that row; analytics cookies never count', () => {
  const { service, base, file } = harness();
  service.plan('p1', base);
  const noise = [{ domain: 'club.acme.com', name: '_ga', value: 'x' }, { domain: 'club.acme.com', name: 'OptanonConsent', value: 'x' }];
  const session = { domain: 'club.acme.com', name: 'member_session', value: 'CANARY-SESSION' };
  assert.equal(service.plan('p1', { ...base, cookies: [...noise, session] }).items[2].status, 'todo', 'not opened: a cookie set while browsing is not proof');
  const opened = service.open('p1', 'site:acme.com', { ...base, cookies: noise });
  assert.equal(opened.url, 'https://club.acme.com/members/login');
  assert.equal(service.plan('p1', { ...base, cookies: noise }).items[2].status, 'opened');
  assert.equal(service.plan('p1', { ...base, cookies: noise, tabUrls: ['https://club.acme.com/members/login'] }).items[2].status, 'opened');
  assert.equal(service.plan('p1', { ...base, cookies: [...noise, session], tabUrls: ['https://club.acme.com/members/login'] }).items[2].status, 'opened', 'the tab is still on the sign-in page');
  assert.equal(service.plan('p1', { ...base, cookies: [...noise, session], tabUrls: ['https://club.acme.com/members'] }).items[2].status, 'done');
  // Names only: no cookie value is ever stored.
  assert.ok(!fs.readFileSync(file, 'utf8').includes('CANARY'));
});

test('cookie detection: a cookie present before Sign in was pressed is not a sign-in', () => {
  const item = { host: 'club.acme.com', iconHosts: ['club.acme.com'], cookieDomains: ['acme.com'] };
  const keys = signInCookies(item, [{ domain: '.acme.com', name: 'sessionid' }, { domain: 'other.org', name: 'sessionid' }, { domain: 'club.acme.com', name: '_gid' }]);
  assert.deepEqual(keys.map((key) => key.key), ['acme.com|sessionid']);
  assert.equal(onSignInPage('https://accounts.google.com/', ['google.com']), true);
  assert.equal(onSignInPage('https://mail.google.com/mail', ['google.com']), false);
  assert.equal(onSignInPage('https://elsewhere.org/login', ['google.com']), false);
});

test('marking and opening validate: unknown rows and states are refused', () => {
  const { service, base } = harness();
  service.plan('p1', base);
  assert.throws(() => service.mark('p1', 'github', 'opened'), /done, to do or not now/);
  assert.throws(() => service.mark('p1', 'site:nowhere.org', 'done'), /not on the list/);
  assert.throws(() => service.open('p1', 'site:nowhere.org', base), /not on the list/);
});
