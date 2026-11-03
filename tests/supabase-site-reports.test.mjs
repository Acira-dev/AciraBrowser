// Site problem reports on the server side (supabase/functions/report, supabase/functions/allowlist), run locally with no Deno, no network
// to Supabase and no database server: the report function's validation, size limit and rate limits, the allow-list function's answer and
// cache, both REST stores' requests, the migration's lock-down, and the deploy script's plan, health checks and config writer.
// (A Deno smoke test of both handlers: supabase/functions/report/handler_test.ts, run by hand with `deno test`.)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHandler, validate, validHost, HOST, BLOCKED_TLDS, KINDS, SITE_KINDS, APP_KINDS, LISTS, PLATFORMS, LIMITS, MAX_BYTES, NOTE_MAX, PROBE, COLUMNS, addressKey, sourceAddress } from '../supabase/functions/report/handler.mjs';
import { restStore } from '../supabase/functions/report/store.mjs';
import * as allowlist from '../supabase/functions/allowlist/handler.mjs';
import { restStore as allowlistStore, PAGE } from '../supabase/functions/allowlist/store.mjs';
import * as usage from '../supabase/functions/usage/handler.mjs';
import { main as deploy, healthChecks, smoke, writeEndpoints, endpointsFor, FUNCTIONS } from '../scripts/deploy-site-reports.mjs';
import { migrationFiles } from '../scripts/deploy-metrics.mjs';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const NOW = Date.parse('2026-11-02T12:00:00Z');
const HOUR = 3600000;
const ADDRESS = '203.0.113.7';
const sql = () => fs.readFileSync(path.join(root, 'supabase/migrations/20261102000000_site_reports.sql'), 'utf8');
const good = (extra = {}) => ({ schema: 1, host: 'www.example.org', kind: 'blocked', list: 'phishing-db', appVersion: '0.9.4', platform: 'darwin', note: 'Netflix videos stopped loading.', ...extra });
/** A report about Acira itself (the Acira menu, Help > Report a Problem): no host, no list, a note. */
const aboutAcira = (extra = {}) => ({ schema: 1, host: null, kind: 'app-crash', list: null, appVersion: '0.9.4', platform: 'win32', note: 'Froze when I opened Settings.', ...extra });

/** Mirrors public.rate_limit_hit: a counter per key per fixed window; true while within the limit. `clock` is the handler's clock. */
function memoryStore({ fail = false, probeOk = true, clock = () => NOW } = {}) {
  const counters = new Map(), rows = [], probes = [];
  return {
    counters, rows, probes,
    windowId: (key, seconds) => `${key}|${Math.floor(clock() / 1000 / seconds)}`,
    async hit(key, seconds, limit) { if (fail === 'hit') throw new Error('down'); const id = this.windowId(key, seconds); const total = (counters.get(id) || 0) + 1; counters.set(id, total); return total <= limit; },
    async insert(row) { if (fail) throw new Error('down'); rows.push(row); },
    async probe() { if (fail) throw new Error('down'); probes.push(true); return probeOk; },
  };
}
const call = (handler, body, { method = 'POST', headers = {} } = {}) => handler(new Request('https://x.supabase.co/functions/v1/report', { method, headers: { 'content-type': 'application/json', 'x-forwarded-for': ADDRESS, ...headers }, ...(method === 'POST' || method === 'PUT' ? { body: typeof body === 'string' || body instanceof Uint8Array ? body : JSON.stringify(body) } : {}) }));
const make = (options = {}) => { let time = NOW; const clock = () => time; const store = memoryStore({ clock, ...options }); return { store, handler: createHandler({ store, secret: 'salt-stand-in', now: clock }), advance: (ms) => { time += ms; } }; };
const noLeaks = async (reply) => {
  assert.equal(await reply.text(), '', 'no response body');
  for (const [name] of reply.headers) assert.doesNotMatch(name, /^access-control-|^set-cookie$/i, 'no CORS or cookie header: ' + name);
};

const GOOD_HOSTS = ['example.com', 'www.example.org', 'a.co', 'nflxvideo.net', 'sub-domain.example.co.uk', 'xn--bcher-kva.com', 'example.xn--p1ai', '1.2.3.example.com', 'a-b.c-d.museum', `${'a'.repeat(63)}.com`];
const BAD_HOSTS = [
  ['example.com/login', 'path'], ['example.com:8443', 'port'], ['example.com?q=1', 'query'], ['example.com#top', 'fragment'], ['https://example.com', 'scheme'],
  ['Example.com', 'uppercase'], ['EXAMPLE.COM', 'uppercase'], ['192.168.1.10', 'IPv4 literal'], ['1.2.3.4', 'IPv4 literal'], ['[::1]', 'IPv6 literal'], ['::1', 'IPv6 literal'],
  ['localhost', 'localhost'], ['foo.localhost', 'localhost name'], ['abc.onion', 'onion'], ['duckduckgogg42xjoc72x3sjasowoarfbgcmvfimaftt6twagswzczad.onion', 'onion'],
  ['printer.local', 'mDNS'], ['nas.lan', 'lan'], ['router.home', 'home'], ['db.internal', 'internal'], ['1.0.168.192.in-addr.arpa', 'arpa'], ['site.test', 'test'], ['x.invalid', 'invalid'], ['www.example', 'example TLD'],
  ['intranet', 'single label'], ['com', 'single label'], ['a.b', 'too short / one-letter TLD'], ['abc', 'too short'], ['example.com.', 'trailing dot'], ['.example.com', 'leading dot'], ['example..com', 'empty label'],
  ['-example.com', 'leading hyphen'], ['example-.com', 'trailing hyphen'], ['exa mple.com', 'space'], ['exämple.com', 'not punycode'], ['example.c0m', 'digit in TLD'], ['example.com\n', 'newline'],
  [`${'a'.repeat(64)}.com`, 'label over 63'], [`${Array(64).fill('abc').join('.')}.com`, 'over 253 characters'], ['', 'empty'],
];

test('validHost: public DNS names only; the rule is exported for the app tests and matches the allow-list function copy', () => {
  for (const host of GOOD_HOSTS) assert.equal(validHost(host), true, host);
  for (const [host, why] of BAD_HOSTS) assert.equal(validHost(host), false, `${why}: ${host}`);
  for (const value of [null, undefined, 7, ['example.com'], { host: 'example.com' }]) assert.equal(validHost(value), false, String(value));
  assert.equal(`${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(57)}.com`.length, 253);
  assert.equal(validHost(`${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(57)}.com`), true, 'exactly 253 characters');
  assert.equal(validHost(`${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(58)}.com`), false, '254 characters');
  assert.deepEqual([...BLOCKED_TLDS], ['onion', 'local', 'localhost', 'internal', 'lan', 'home', 'arpa', 'test', 'invalid', 'example']);
  assert.ok(HOST instanceof RegExp);
  // The allow-list function keeps its own copy (each function deploys on its own); it must be the same rule.
  assert.equal(allowlist.HOST.source, HOST.source); assert.equal(allowlist.HOST.flags, HOST.flags);
  assert.deepEqual([...allowlist.BLOCKED_TLDS], [...BLOCKED_TLDS]);
  for (const host of [...GOOD_HOSTS, ...BAD_HOSTS.map(([value]) => value)]) assert.equal(allowlist.validHost(host), validHost(host), host);
  // The database checks the same rule (both tables).
  const text = sql();
  const checks = text.match(/host ~ '([^']+)' and host !~ '\\\.\(([a-z|]+)\)\$'/g) || [];
  assert.equal(checks.length, 2, 'both tables check the host');
  for (const check of checks) {
    const [, pattern, tlds] = /host ~ '([^']+)' and host !~ '\\\.\(([a-z|]+)\)\$'/.exec(check);
    assert.equal(pattern, HOST.source, 'SQL host pattern'); assert.deepEqual(tlds.split('|'), [...BLOCKED_TLDS], 'SQL blocked last labels');
  }
  assert.equal((text.match(/char_length\(host\) between 4 and 253/g) || []).length, 2);
});

test('validate accepts exactly the report contract and stores exactly six columns', () => {
  assert.deepEqual(validate(good()), { host: 'www.example.org', kind: 'blocked', list: 'phishing-db', app_version: '0.9.4', platform: 'darwin', note: 'Netflix videos stopped loading.' });
  for (const kind of SITE_KINDS) assert.equal(validate(good({ kind })).kind, kind);
  for (const list of LISTS) assert.equal(validate(good({ list })).list, list);
  assert.equal(validate(good({ list: null })).list, null, 'list may be null');
  for (const platform of PLATFORMS) assert.equal(validate(good({ platform })).platform, platform);
  for (const appVersion of ['0.9.4', '1.0.0-beta.1', '12.3.4567-rc.2.x', '0.0.0-probe']) assert.ok(validate(good({ appVersion })), appVersion);
  assert.ok(validate(PROBE), 'the deploy probe is a valid report');
  assert.deepEqual([...SITE_KINDS], ['blocked', 'broken', 'banner', 'other']); assert.deepEqual([...APP_KINDS], ['app-broken', 'app-looks', 'app-crash', 'app-idea']);
  assert.deepEqual([...KINDS], [...SITE_KINDS, ...APP_KINDS]);
  assert.deepEqual([...LISTS], ['phishing', 'malware', 'phishing-db', 'lookalike', 'ad-blocking', 'cookie-banners']);
  assert.deepEqual([...PLATFORMS].sort(), ['darwin', 'linux', 'win32']);
  assert.equal(MAX_BYTES, 4096); assert.equal(NOTE_MAX, 500);
  assert.deepEqual(Object.keys(validate(good())).sort(), COLUMNS.filter((column) => column !== 'id' && column !== 'created_at').sort(), 'the row fills every column except the two the database sets');
});

test('validate refuses anything outside the contract', () => {
  const bad = (mutate) => { const value = good(); mutate(value); return validate(value); };
  assert.equal(bad((v) => { v.extra = 'x'; }), null, 'extra key');
  for (const extra of ['url', 'path', 'query', 'title', 'installId', 'ip', 'userAgent', 'email', 'day', 'event']) assert.equal(bad((v) => { v[extra] = 'x'; }), null, extra);
  for (const key of Object.keys(good())) assert.equal(bad((v) => { delete v[key]; }), null, key + ' is required');
  for (const schema of [2, 0, '1', null, 1.5]) assert.equal(bad((v) => { v.schema = schema; }), null, 'schema ' + schema);
  for (const [host, why] of BAD_HOSTS) assert.equal(bad((v) => { v.host = host; }), null, `${why}: ${host}`);
  for (const kind of ['spam', 'Blocked', '', null, 1, ['blocked']]) assert.equal(bad((v) => { v.kind = kind; }), null, 'kind ' + kind);
  for (const list of ['easylist', 'Phishing', '', 0, false, ['phishing']]) assert.equal(bad((v) => { v.list = list; }), null, 'list ' + list);
  assert.equal(bad((v) => { v.list = undefined; }), null, 'list undefined is not null');
  for (const appVersion of ['1.0', '1.0.0; drop table', '1.2.3-' + 'a'.repeat(30), 'v1.0.0', '', 7, null]) assert.equal(bad((v) => { v.appVersion = appVersion; }), null, 'version ' + appVersion);
  for (const platform of ['android', 'Darwin', 'macos', '', null, 1]) assert.equal(bad((v) => { v.platform = platform; }), null, 'platform ' + platform);
  for (const value of [null, [], 'x', 1, true, undefined]) assert.equal(validate(value), null, String(value));
});

test('a report about Acira itself: no host, no list, a required note; the two subjects never mix', () => {
  for (const kind of APP_KINDS) assert.deepEqual(validate(aboutAcira({ kind })), { host: null, kind, list: null, app_version: '0.9.4', platform: 'win32', note: 'Froze when I opened Settings.' }, kind);
  assert.equal(validate(aboutAcira({ note: '  Idea: a darker sidebar.  ', kind: 'app-idea' })).note, 'Idea: a darker sidebar.', 'trimmed');
  for (const note of ['', '   ', '\n\t']) assert.equal(validate(aboutAcira({ note })), null, 'an empty note is refused: ' + JSON.stringify(note));
  for (const host of ['example.com', 'www.example.org', '', 'acira']) assert.equal(validate(aboutAcira({ host })), null, 'an app report names no site: ' + host);
  for (const list of LISTS) assert.equal(validate(aboutAcira({ list })), null, 'an app report names no list: ' + list);
  assert.equal(validate(aboutAcira({ note: 'x'.repeat(NOTE_MAX + 1) })), null, 'the same 500-character limit');
  for (const kind of SITE_KINDS) assert.equal(validate(aboutAcira({ kind })), null, 'a site kind needs a site: ' + kind);
  for (const kind of APP_KINDS) assert.equal(validate(good({ kind, list: null })), null, 'an app kind with a site is refused: ' + kind);
  const { host, ...noHost } = aboutAcira(); assert.equal(validate(noHost), null, 'host is still a required key (null)');
  for (const kind of ['app', 'app-other', 'App-crash', 'crash']) assert.equal(validate(aboutAcira({ kind })), null, 'kind ' + kind);
});

test('note: at most 500 code points, no control characters except tab and line feed, trimmed, empty is NULL', () => {
  const note = (value) => validate(good({ note: value }));
  assert.equal(note('a'.repeat(NOTE_MAX)).note.length, 500, '500 characters');
  assert.equal(note('a'.repeat(NOTE_MAX + 1)), null, '501 characters');
  const emoji = '\u{1F600}'.repeat(NOTE_MAX);
  assert.equal(emoji.length, 1000, '500 emoji are 1000 UTF-16 units');
  assert.equal(note(emoji).note, emoji, '500 emoji are 500 characters');
  assert.equal(note(emoji + '\u{1F600}'), null, '501 emoji');
  assert.equal(note(' '.repeat(10) + 'a'.repeat(NOTE_MAX - 10)).note, 'a'.repeat(NOTE_MAX - 10), 'counted before trimming');
  assert.equal(note('  It is a false positive.\n\tThanks  ').note, 'It is a false positive.\n\tThanks', 'trimmed; inner line feeds and tabs kept');
  assert.equal(note('').note, null, 'empty is stored as NULL');
  assert.equal(note('  \n\t ').note, null, 'only white space is stored as NULL');
  for (const [value, why] of [['a\u0000b', 'NUL'], ['a\rb', 'carriage return'], ['a\r\nb', 'CRLF'], ['a\u001bb', 'escape'], ['a\u0008b', 'backspace'], ['a\u000bb', 'vertical tab'], ['a\u000cb', 'form feed'], ['a\u001fb', 'unit separator'], ['a\u2028b', 'line separator'], ['a\u2029b', 'paragraph separator'], ['a\ud800b', 'lone high surrogate'], ['a\udc00b', 'lone low surrogate'], ['\ud83d', 'cut emoji']]) assert.equal(note(value), null, why);
  for (const value of [null, undefined, 5, ['x'], { text: 'x' }, true]) assert.equal(note(value), null, 'non-string note ' + JSON.stringify(value));
  assert.equal(validate(JSON.parse('{"schema":1,"host":"example.com","kind":"other","list":null,"appVersion":"1.0.0","platform":"linux","note":"\\ud800"}')), null, 'a lone surrogate sent as a JSON escape');
});

test('the longest valid report fits the 4 KB limit', () => {
  const host = `${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(57)}.com`;
  const longest = { schema: 1, host, kind: 'blocked', list: 'cookie-banners', appVersion: '1234.1234.1234-' + 'a'.repeat(9), platform: 'darwin', note: '\u{1F600}'.repeat(NOTE_MAX) };
  assert.ok(validate(longest));
  const bytes = new TextEncoder().encode(JSON.stringify(longest)).length;
  assert.ok(bytes < MAX_BYTES && bytes > 2048, `longest report is ${bytes} bytes`);
  // Escaped characters cost 2 bytes in JSON: a note of 500 line feeds is still far under.
  assert.ok(new TextEncoder().encode(JSON.stringify({ ...longest, note: 'a' + '\n'.repeat(498) + 'a' })).length < MAX_BYTES);
});

test('handler: POST only; 204 stores exactly the row; no body, no CORS, no cookie ever', async () => {
  const { handler, store } = make();
  const replies = [];
  for (const method of ['GET', 'HEAD', 'PUT', 'DELETE', 'OPTIONS', 'PATCH']) { const reply = await call(handler, good(), { method }); assert.equal(reply.status, 405, method); assert.equal(reply.headers.get('allow'), 'POST'); replies.push(reply); }
  const ok = await call(handler, good());
  assert.equal(ok.status, 204); replies.push(ok);
  assert.deepEqual(store.rows, [{ host: 'www.example.org', kind: 'blocked', list: 'phishing-db', app_version: '0.9.4', platform: 'darwin', note: 'Netflix videos stopped loading.' }]);
  assert.equal((await call(handler, good({ note: '', list: null }))).status, 204);
  assert.deepEqual(store.rows[1], { host: 'www.example.org', kind: 'blocked', list: null, app_version: '0.9.4', platform: 'darwin', note: null }, 'empty note stored as NULL');
  replies.push(await call(handler, '{'), await call(make({ fail: true }).handler, good()), await call(handler, good(), { headers: { 'x-acira-probe': '1' } }));
  for (const reply of replies) await noLeaks(reply);
});

test('handler: 400 for bad JSON, a wrong shape, and anything over 4 KB (declared or actual)', async () => {
  const { handler, store } = make();
  for (const body of ['', 'not json', '{', '[]', 'null', '1', '"x"', JSON.stringify({ ...good(), extra: 1 }), JSON.stringify(good({ host: 'example.com/x' }))]) {
    const reply = await call(handler, body); assert.equal(reply.status, 400, body); await noLeaks(reply);
  }
  assert.equal((await call(handler, good(), { headers: { 'content-length': String(MAX_BYTES + 1) } })).status, 400, 'declared size too big');
  const padded = JSON.stringify(good()) + ' '.repeat(MAX_BYTES);
  assert.equal((await call(handler, padded)).status, 400, 'actual size too big (valid JSON with padding)');
  const exact = JSON.stringify(good()); const fill = MAX_BYTES - new TextEncoder().encode(exact).length;
  assert.equal((await call(handler, exact + ' '.repeat(fill))).status, 204, 'exactly 4096 bytes is allowed');
  assert.equal((await call(handler, exact + ' '.repeat(fill + 1))).status, 400, '4097 bytes is not');
  const latin1 = new Uint8Array([...new TextEncoder().encode(JSON.stringify(good({ note: 'caf' })).slice(0, -2)), 0xe9, 0x22, 0x7d]);
  assert.equal((await call(handler, latin1)).status, 400, 'bytes that are not UTF-8');
  assert.equal(store.rows.length, 1, 'only the exact-size report was stored');
});

test('handler: per-address limits (10 an hour, 30 a day) answer 429 with Retry-After and store nothing more', async () => {
  const hour = make();
  const statuses = [];
  for (let i = 0; i < LIMITS.addressHour[2] + 2; i++) statuses.push((await call(hour.handler, good({ host: `s${i}.example.org` }))).status);
  assert.deepEqual(statuses, [...Array(10).fill(204), 429, 429]);
  assert.equal(hour.store.rows.length, 10);
  const limited = await call(hour.handler, good({ host: 'other.example.org' }));
  assert.equal(limited.status, 429); assert.equal(limited.headers.get('retry-after'), '3600'); await noLeaks(limited);
  assert.equal((await call(hour.handler, good({ host: 'other.example.org' }), { headers: { 'x-forwarded-for': '198.51.100.9' } })).status, 204, 'another address has its own allowance');
  hour.advance(HOUR);
  assert.equal((await call(hour.handler, good({ host: 'next.example.org' }))).status, 204, 'the next hour has a fresh hourly allowance');

  const day = make();
  const daily = [];
  for (let h = 0; h < 3; h++) { for (let i = 0; i < 10; i++) daily.push((await call(day.handler, good({ host: `h${h}-${i}.example.org` }))).status); day.advance(HOUR); }
  assert.deepEqual([...new Set(daily)], [204]); assert.equal(day.store.rows.length, LIMITS.addressDay[2]);
  assert.equal((await call(day.handler, good({ host: 'one-more.example.org' }))).status, 429, 'the 31st report of the day');
  assert.deepEqual(LIMITS.addressHour.slice(1), [3600, 10]); assert.deepEqual(LIMITS.addressDay.slice(1), [86400, 30]);
});

test('handler: the same host from the same address is accepted 3 times a day', async () => {
  const { handler, store } = make();
  const statuses = []; for (let i = 0; i < 5; i++) statuses.push((await call(handler, good({ note: `try ${i}` }))).status);
  assert.deepEqual(statuses, [204, 204, 204, 429, 429]);
  assert.equal((await call(handler, good({ host: 'another.example.org' }))).status, 204, 'another host from the same address');
  assert.equal((await call(handler, good(), { headers: { 'x-forwarded-for': '198.51.100.9' } })).status, 204, 'the same host from another address');
  assert.equal(store.rows.length, 5);
  assert.deepEqual(LIMITS.hostDay.slice(1), [86400, 3]);
});

test('handler: a report about Acira is stored with no host; the same kind from the same address 3 times a day', async () => {
  const { handler, store } = make();
  const statuses = []; for (let i = 0; i < 5; i++) statuses.push((await call(handler, aboutAcira({ note: `crash ${i}` }))).status);
  assert.deepEqual(statuses, [204, 204, 204, 429, 429]);
  assert.equal((await call(handler, aboutAcira({ kind: 'app-idea', note: 'An idea' }))).status, 204, 'another kind from the same address');
  assert.equal((await call(handler, good())).status, 204, 'a site report from the same address has its own allowance');
  assert.deepEqual(store.rows.slice(0, 3).map((row) => row.host), [null, null, null]);
  assert.deepEqual(store.rows[3], { host: null, kind: 'app-idea', list: null, app_version: '0.9.4', platform: 'win32', note: 'An idea' });
  const keys = [...store.counters.keys()].join(' ');
  assert.doesNotMatch(keys, /acira|crash|idea/, 'the kind is hashed with the address like a host');
  assert.equal((await call(handler, aboutAcira({ note: '' }))).status, 400, 'no note, no report');
});

test('handler: a global cap of 3000 reports an hour across all callers; callers over their own limit do not use it up', async () => {
  const { handler, store } = make();
  for (let i = 0; i < 12; i++) await call(handler, good({ host: `g${i}.example.org` }));
  assert.equal(store.counters.get(store.windowId('rp:all:h', 3600)), 10, 'only reports that passed the per-address limits counted');
  store.counters.set(store.windowId('rp:all:h', 3600), LIMITS.allHour[2]);
  const reply = await call(handler, good({ host: 'fresh.example.org' }), { headers: { 'x-forwarded-for': '198.51.100.20' } });
  assert.equal(reply.status, 429, 'a new address is refused once the global cap is reached'); assert.equal(reply.headers.get('retry-after'), '3600');
  assert.equal(store.rows.length, 10);
  assert.deepEqual(LIMITS.allHour.slice(1), [3600, 3000]);
});

test('handler: counters hold hashed keys under rp: only; neither the address nor the host is in any key or stored row', async () => {
  const { handler, store } = make();
  await call(handler, good({ host: 'secret-site.example.org' }));
  const keys = [...store.counters.keys()].map((id) => id.split('|')[0]);
  assert.equal(keys.length, 4, 'address hour, address day, address+host day, global');
  for (const key of keys) {
    assert.match(key, /^rp:(?:[0-9a-f]{32}|all):[hds]$/, key); assert.ok(key.length <= 128, 'rate_limit_hit accepts keys up to 128 characters');
    assert.doesNotMatch(key, /203\.0\.113\.7|secret-site/, key);
    assert.doesNotMatch(key, /^(?:ip|id|rt):/, 'no collision with the usage function keys');
  }
  assert.ok(keys.includes('rp:all:h'));
  assert.doesNotMatch(JSON.stringify(store.rows), /203\.0\.113\.7/);
  assert.equal(new Set(keys.filter((key) => key !== 'rp:all:h').map((key) => key.split(':')[1])).size, 2, 'the address key and the address+host key differ');
  // addressKey and sourceAddress are copies of the usage function's: same results.
  for (const [address, day] of [['203.0.113.7', '2026-11-02'], ['2001:db8::1', '2026-11-03']]) assert.equal(await addressKey(address, 's', day), await usage.addressKey(address, 's', day));
  for (const headers of [{ 'x-forwarded-for': '1.2.3.4, 5.6.7.8' }, { 'cf-connecting-ip': '9.9.9.9' }, {}, { 'x-forwarded-for': ' ' }]) assert.equal(sourceAddress(new Headers(headers)), usage.sourceAddress(new Headers(headers)), JSON.stringify(headers));
});

test('handler: storage trouble answers 503 without detail', async () => {
  for (const fail of [true, 'hit']) { const reply = await call(make({ fail }).handler, good()); assert.equal(reply.status, 503, String(fail)); await noLeaks(reply); }
  assert.equal((await call(make({ probeOk: false }).handler, PROBE, { headers: { 'x-acira-probe': '1' } })).status, 503, 'a missing column fails the probe');
  assert.equal((await call(make({ fail: true }).handler, PROBE, { headers: { 'x-acira-probe': '1' } })).status, 503);
});

test('handler: a probe validates, checks only the hourly address limit, reaches storage, answers 202 and stores nothing', async () => {
  const { handler, store } = make();
  const reply = await call(handler, PROBE, { headers: { 'x-acira-probe': '1' } });
  assert.equal(reply.status, 202); await noLeaks(reply);
  assert.equal(store.probes.length, 1); assert.equal(store.rows.length, 0, 'nothing stored');
  assert.deepEqual([...store.counters.keys()].map((id) => id.split('|')[0].replace(/[0-9a-f]{32}/, 'X')), ['rp:X:h'], 'only the hourly address counter');
  assert.equal((await call(handler, { ...PROBE, host: 'example.com/login' }, { headers: { 'x-acira-probe': '1' } })).status, 400, 'an invalid probe is refused');
  assert.equal((await call(handler, { ...PROBE, note: 'x'.repeat(501) }, { headers: { 'x-acira-probe': '1' } })).status, 400);
  for (let i = 0; i < 9; i++) await call(handler, PROBE, { headers: { 'x-acira-probe': '1' } });
  assert.equal((await call(handler, PROBE, { headers: { 'x-acira-probe': '1' } })).status, 429, 'probes count against the hourly address limit');
  assert.equal(store.rows.length, 0);
});

test('report restStore sends exactly the expected REST requests with the service role key from its environment', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return new Response(url.includes('/rpc/') ? 'true' : null, { status: url.includes('/rpc/') ? 200 : init.method === 'GET' ? 200 : 201 }); };
  const store = restStore({ url: 'https://abc.supabase.co/', key: 'KEY-FROM-ENV', fetchImpl });
  assert.equal(await store.hit('rp:all:h', 3600, 3000), true);
  const row = validate(good());
  await store.insert(row);
  assert.equal(await store.probe(), true);
  assert.equal(calls.length, 3);
  assert.equal(calls[0].url, 'https://abc.supabase.co/rest/v1/rpc/rate_limit_hit'); assert.equal(calls[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].init.body), { p_key: 'rp:all:h', p_window_seconds: 3600, p_limit: 3000 });
  assert.equal(calls[1].url, 'https://abc.supabase.co/rest/v1/site_reports'); assert.equal(calls[1].init.method, 'POST');
  assert.equal(calls[1].init.headers.Prefer, 'return=minimal'); assert.deepEqual(JSON.parse(calls[1].init.body), row);
  assert.equal(calls[2].url, 'https://abc.supabase.co/rest/v1/site_reports?select=id,created_at,host,kind,list,app_version,platform,note&limit=0'); assert.equal(calls[2].init.method, 'GET');
  for (const { init } of calls) { assert.equal(init.headers.Authorization, 'Bearer KEY-FROM-ENV'); assert.equal(init.headers.apikey, 'KEY-FROM-ENV'); }
  assert.equal(await restStore({ url: 'https://abc.supabase.co', key: 'k', fetchImpl: async () => new Response('false') }).hit('k', 1, 1), false);
  await assert.rejects(restStore({ url: 'https://abc.supabase.co', key: 'k', fetchImpl: async () => new Response('no', { status: 500 }) }).hit('k', 1, 1), /rate limit store failed/);
  await assert.rejects(restStore({ url: 'https://abc.supabase.co', key: 'k', fetchImpl: async () => new Response('no', { status: 500 }) }).insert({}), /report store failed/);
  assert.equal(await restStore({ url: 'https://abc.supabase.co', key: 'k', fetchImpl: async () => new Response('{}', { status: 400 }) }).probe(), false, 'a missing column fails the probe');
  assert.throws(() => restStore({ url: '', key: '' }), /not configured/);
});

test('the migration: two locked tables (RLS on, no policies, no public grants), no identifying column, a service-role prune, a locked view', () => {
  const text = sql();
  for (const table of ['site_reports', 'site_allowlist']) {
    assert.match(text, new RegExp(`create table if not exists public\\.${table} \\(`), table);
    assert.match(text, new RegExp(`alter table public\\.${table} enable row level security`), table + ' RLS');
    assert.match(text, new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated`), table + ' revoked');
  }
  assert.doesNotMatch(text, /create\s+policy/i); assert.doesNotMatch(text, /disable row level security/i);
  assert.doesNotMatch(text, /grant\s+(select|insert|update|delete|all)[^;]*\bto\s+(anon|authenticated|public)/i);
  assert.doesNotMatch(text.replace(/^\s*--.*$/gm, ''), /insert into/i, 'no data is inserted');
  assert.match(text, /--\s+insert into public\.site_allowlist \(host, reason\) values \('nflxvideo\.net', '[^']+'\) on conflict do nothing;/, 'the example insert is a comment');
  const columns = (table) => text.match(new RegExp(`create table if not exists public\\.${table} \\(([\\s\\S]*?)\\n\\);`))[1].split('\n').map((line) => line.trim().split(/\s+/)[0]).filter((word) => word && word !== 'constraint');
  assert.deepEqual(columns('site_reports'), [...COLUMNS], 'exactly the documented columns');
  for (const column of columns('site_reports')) assert.doesNotMatch(column, /ip|address|user|install|agent|email|url|path|session|device/i, 'no identifying column: ' + column);
  assert.deepEqual(columns('site_allowlist'), ['host', 'reason', 'added_at']);
  const table = text.match(/create table if not exists public\.site_reports \([\s\S]*?\n\);/)[0];
  assert.match(table, /id\s+bigint\s+generated always as identity primary key/); assert.match(table, /created_at\s+timestamptz not null default now\(\)/);
  const list = (column) => /in \(([^)]*)\)/.exec(table.split('\n').find((line) => line.trim().startsWith(column + ' ')))[1].split(',').map((item) => item.trim().replace(/^'|'$/g, ''));
  assert.deepEqual(list('kind'), [...KINDS]); assert.deepEqual(list('list'), [...LISTS]); assert.deepEqual(list('platform').sort(), [...PLATFORMS].sort());
  assert.match(table, /list\s+text\s+null check/, 'list is nullable'); assert.match(table, /note\s+text\s+null check \(char_length\(note\) between 1 and 500\)/);
  for (const column of ['kind', 'app_version', 'platform']) assert.match(table, new RegExp(`\\n\\s*${column}\\s+text\\s+not null check`), column + ' is required and constrained');
  assert.match(table, /\n\s*host\s+text\s+null check \(char_length\(host\)/, 'host is constrained, and empty only for a report about Acira');
  const subject = /constraint site_reports_subject check \(\(kind in \(([^)]*)\) and host is not null\) or \(kind in \(([^)]*)\) and host is null and list is null and note is not null\)\)/.exec(table);
  assert.ok(subject, 'one check ties the subject to the kind');
  const names = (group) => group.split(',').map((item) => item.trim().replace(/^'|'$/g, ''));
  assert.deepEqual(names(subject[1]), [...SITE_KINDS], 'site kinds need a host'); assert.deepEqual(names(subject[2]), [...APP_KINDS], 'app kinds have no host or list and need a note');
  // The upgrade of a table made by the first version (host required, site kinds only): the same two checks, re-made, and host nullable.
  const upgrade = text.slice(text.indexOf(table) + table.length, text.indexOf('alter table public.site_reports enable row level security'));
  assert.deepEqual(upgrade.split('\n').filter((line) => line.startsWith('alter table')), [
    'alter table public.site_reports alter column host drop not null;',
    'alter table public.site_reports drop constraint if exists site_reports_kind_check;',
    `alter table public.site_reports add constraint site_reports_kind_check check (kind in (${[...KINDS].map((kind) => `'${kind}'`).join(', ')}));`,
    'alter table public.site_reports drop constraint if exists site_reports_subject;',
    `alter table public.site_reports add constraint site_reports_subject ${/constraint site_reports_subject (check .*)$/m.exec(table)[1]};`,
  ], 'idempotent, and the same checks as the table definition');
  const usageSql = fs.readFileSync(path.join(root, 'supabase/migrations/20261025000000_usage_metrics.sql'), 'utf8');
  assert.equal(/app_version text\s+not null (check \(.*\)),/.exec(table)[1], /app_version text\s+not null (check \(.*\)),/.exec(usageSql)[1], 'the same app version check as daily_usage');
  assert.match(text, /reason\s+text\s+not null check \(char_length\(reason\) between 1 and 500\)/);
  assert.match(text, /delete from public\.site_reports where created_at < now\(\) - interval '365 days'/);
  assert.match(text, /revoke all on function public\.prune_site_reports\(\) from public, anon, authenticated/);
  assert.match(text, /grant execute on function public\.prune_site_reports\(\) to service_role/);
  assert.match(text, /if exists \(select 1 from pg_extension where extname = 'pg_cron'\)/);
  assert.match(text, /cron\.schedule\('acira-prune-site-reports', '[^']+', 'select public\.prune_site_reports\(\)'\)/);
  assert.match(text, /create or replace view public\.site_reports_by_host with \(security_invoker = on\) as\s+select host, kind, list, count\(\*\) as reports, max\(created_at\) as last_report\s+from public\.site_reports\s+where created_at > now\(\) - interval '30 days'\s+group by host, kind, list/);
  assert.match(text, /revoke all on public\.site_reports_by_host from public, anon, authenticated/);
  assert.doesNotMatch(text, /create (or replace )?function public\.rate_limit_hit|create table if not exists public\.rate_limit\b/, 'reuses the usage rate limit');
  assert.doesNotMatch(text, /\bdrop\s+(table|view|function)/i, 'nothing is dropped');
});

test('the migration runs after the usage migrations in both deploy scripts', async () => {
  const files = await migrationFiles();
  assert.ok(files.includes('20261102000000_site_reports.sql'));
  assert.ok(files.indexOf('20261025000000_usage_metrics.sql') < files.indexOf('20261102000000_site_reports.sql'), 'rate_limit_hit exists before report is deployed');
});

/** A fake allow-list store whose rows can change, counting reads. */
function listStore(initial, { fail = false } = {}) {
  const state = { hosts: initial, reads: 0, fail };
  return { state, async hosts() { state.reads++; if (state.fail) throw new Error('down'); return state.hosts; } };
}
const get = (handler, { method = 'GET', url = 'https://x.supabase.co/functions/v1/allowlist', body } = {}) => handler(new Request(url, { method, ...(body ? { body } : {}) }));

test('allowlist handler: GET answers exactly {"schema":1,"hosts":[...]}, sorted, without repeats, invalid rows skipped', async () => {
  const store = listStore(['nflxvideo.net', 'b.example.org', 'nflxvideo.net', 'a.example.org', 'Upper.example.org', '192.168.0.1', 'example.com/path', 'intranet', 'x.onion', null, 7, '', 'printer.local', 'xn--bcher-kva.com']);
  const handler = allowlist.createHandler({ store, now: () => NOW });
  const reply = await get(handler);
  assert.equal(reply.status, 200);
  assert.equal(await reply.text(), '{"schema":1,"hosts":["a.example.org","b.example.org","nflxvideo.net","xn--bcher-kva.com"]}');
  assert.equal(reply.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.equal(reply.headers.get('cache-control'), 'public, max-age=3600');
  for (const [name] of reply.headers) assert.doesNotMatch(name, /^access-control-|^set-cookie$/i, name);
  const query = await get(allowlist.createHandler({ store: listStore(['a.example.org']), now: () => NOW }), { url: 'https://x.supabase.co/functions/v1/allowlist?host=b.example.org&all=1' });
  assert.equal(await query.text(), '{"schema":1,"hosts":["a.example.org"]}', 'the query string is ignored');
  assert.equal(await (await get(allowlist.createHandler({ store: listStore([]), now: () => NOW }))).text(), '{"schema":1,"hosts":[]}', 'an empty list');
});

test('allowlist handler: at most 20000 hosts, the first ones in sort order', async () => {
  const hosts = Array.from({ length: allowlist.MAX_HOSTS + 5 }, (_, i) => `h${String(i).padStart(5, '0')}.example.org`).reverse();
  const reply = await get(allowlist.createHandler({ store: listStore(hosts), now: () => NOW }));
  const body = JSON.parse(await reply.text());
  assert.equal(body.hosts.length, 20000); assert.equal(allowlist.MAX_HOSTS, 20000);
  assert.equal(body.hosts[0], 'h00000.example.org'); assert.equal(body.hosts.at(-1), 'h19999.example.org');
  assert.deepEqual(Object.keys(body), ['schema', 'hosts']);
});

test('allowlist handler: HEAD has the headers and no body; other methods 405; storage trouble 503 and not cached', async () => {
  const store = listStore(['a.example.org']);
  const handler = allowlist.createHandler({ store, now: () => NOW });
  const head = await get(handler, { method: 'HEAD' });
  assert.equal(head.status, 200); assert.equal(await head.text(), ''); assert.equal(head.headers.get('cache-control'), 'public, max-age=3600');
  for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH']) {
    const reply = await get(handler, { method, ...(method === 'POST' || method === 'PUT' ? { body: '{"hosts":["evil.example.org"]}' } : {}) });
    assert.equal(reply.status, 405, method); assert.equal(reply.headers.get('allow'), 'GET, HEAD'); assert.equal(await reply.text(), '');
  }
  const failing = listStore(['a.example.org'], { fail: true });
  const down = allowlist.createHandler({ store: failing, now: () => NOW });
  const reply = await get(down);
  assert.equal(reply.status, 503); assert.equal(await reply.text(), '');
  for (const [name] of reply.headers) assert.doesNotMatch(name, /^access-control-|^set-cookie$/i, name);
  failing.state.fail = false;
  assert.equal((await get(down)).status, 200, 'a failure is not cached');
  assert.equal((await get(allowlist.createHandler({ store: { hosts: async () => ({ not: 'a list' }) }, now: () => NOW }))).status, 503, 'an odd store answer');
});

test('allowlist handler: one instance reuses its answer for 60 s, then reads the table again; concurrent calls share one read', async () => {
  let time = NOW;
  const store = listStore(['a.example.org']);
  const handler = allowlist.createHandler({ store, now: () => time });
  assert.equal(allowlist.CACHE_MS, 60000);
  await get(handler); store.state.hosts = ['a.example.org', 'b.example.org'];
  time += allowlist.CACHE_MS - 1;
  assert.equal(await (await get(handler)).text(), '{"schema":1,"hosts":["a.example.org"]}', 'within the TTL: the cached answer');
  assert.equal(store.state.reads, 1);
  time += 1;
  assert.equal(await (await get(handler)).text(), '{"schema":1,"hosts":["a.example.org","b.example.org"]}', 'after the TTL: read again');
  assert.equal(store.state.reads, 2);
  const fresh = listStore(['a.example.org']); const shared = allowlist.createHandler({ store: fresh, now: () => time });
  await Promise.all([get(shared), get(shared), get(shared, { method: 'HEAD' })]);
  assert.equal(fresh.state.reads, 1);
});

test('allowlist restStore reads only the host column, in pages, with the service role key; never reason or added_at', async () => {
  const rows = Array.from({ length: 2500 }, (_, i) => ({ host: `h${String(i).padStart(4, '0')}.example.org`, reason: 'secret reason', added_at: '2026-11-02T00:00:00Z' }));
  const calls = [];
  const cap = 1000; // what Supabase's "Max rows" does to a larger limit
  const fetchImpl = async (url, init) => { calls.push({ url, init }); const query = new URL(url).searchParams; const offset = Number(query.get('offset')), limit = Math.min(Number(query.get('limit')), cap); return new Response(JSON.stringify(rows.slice(offset, offset + limit)), { status: 200 }); };
  const hosts = await allowlistStore({ url: 'https://abc.supabase.co/', key: 'KEY-FROM-ENV', fetchImpl }).hosts();
  assert.deepEqual(hosts, rows.map((row) => row.host));
  assert.deepEqual(calls.map(({ url }) => url), [0, 1000, 2000, 2500].map((offset) => `https://abc.supabase.co/rest/v1/site_allowlist?select=host&order=host.asc&limit=${PAGE}&offset=${offset}`));
  for (const { init } of calls) { assert.equal(init.method, 'GET'); assert.equal(init.headers.Authorization, 'Bearer KEY-FROM-ENV'); assert.equal(init.headers.apikey, 'KEY-FROM-ENV'); assert.equal(init.body, undefined); }
  const body = allowlist.listBody(hosts); assert.doesNotMatch(body, /secret reason|added_at|2026-11-02/);
  // Never more than MAX_HOSTS + 1 rows are read, however many there are.
  const many = []; const endless = async (url) => { many.push(url); const query = new URL(url).searchParams; return new Response(JSON.stringify(Array.from({ length: Number(query.get('limit')) }, (_, i) => ({ host: `h${Number(query.get('offset')) + i}.example.org` })))); };
  assert.equal((await allowlistStore({ url: 'https://abc.supabase.co', key: 'k', fetchImpl: endless }).hosts()).length, allowlist.MAX_HOSTS + 1);
  assert.match(many.at(-1), /limit=1&offset=20000$/);
  await assert.rejects(allowlistStore({ url: 'https://abc.supabase.co', key: 'k', fetchImpl: async () => new Response('no', { status: 500 }) }).hosts(), /allow-list store failed/);
  await assert.rejects(allowlistStore({ url: 'https://abc.supabase.co', key: 'k', fetchImpl: async () => new Response('{"message":"x"}') }).hosts(), /allow-list store failed/);
  assert.throws(() => allowlistStore({ url: '', key: '' }), /not configured/);
});

test('config.toml: both functions enabled with JWT verification off and an entrypoint that exists', () => {
  const config = fs.readFileSync(path.join(root, 'supabase/config.toml'), 'utf8');
  for (const name of ['usage', 'report', 'allowlist']) {
    const block = new RegExp(`\\[functions\\.${name}\\]\\nenabled = true\\n#[^\\n]*\\nverify_jwt = false\\nentrypoint = "\\./functions/${name}/index\\.ts"`).exec(config);
    assert.ok(block, name + ' block'); assert.ok(fs.existsSync(path.join(root, 'supabase/functions', name, 'index.ts')), name + ' entrypoint');
  }
});

test('deploy-site-reports --dry-run makes no network call, changes no file, prints both functions and never the token', async () => {
  const configFile = path.join(root, 'desktop/browser-services/site-reports-config.cjs');
  const before = fs.existsSync(configFile) ? fs.readFileSync(configFile, 'utf8') : null;
  const logs = [], fetched = [];
  const originalLog = console.log, originalFetch = globalThis.fetch;
  console.log = (...args) => logs.push(args.join(' ')); globalThis.fetch = async (url) => { fetched.push(String(url)); throw new Error('no network in a dry run'); };
  let result;
  try { result = await deploy({ SUPABASE_PROJECT_REF: 'abcdefghijklmnopqrst', SUPABASE_ACCESS_TOKEN: 'sbp_SECRETVALUE' }, ['--dry-run', '--write']); } finally { console.log = originalLog; globalThis.fetch = originalFetch; }
  assert.deepEqual(fetched, [], 'no network call');
  assert.deepEqual(result, { reportEndpoint: 'https://abcdefghijklmnopqrst.supabase.co/functions/v1/report', allowlistEndpoint: 'https://abcdefghijklmnopqrst.supabase.co/functions/v1/allowlist', dryRun: true });
  const plan = logs.join('\n');
  for (const name of await migrationFiles()) assert.match(plan, new RegExp(`migrate\\s+supabase/migrations/${name.replace('.', '\\.')}`));
  assert.deepEqual(FUNCTIONS, ['report', 'allowlist']);
  for (const name of FUNCTIONS) assert.match(plan, new RegExp(`deploy\\s+Edge Function "${name}"`));
  assert.match(plan, /ACIRA_USAGE_SALT/);
  for (const [label, , , want] of healthChecks()) assert.ok(plan.includes(`${label} -> ${want}`), label);
  assert.match(plan, /write\s+reportEndpoint https:\/\/abcdefghijklmnopqrst\.supabase\.co\/functions\/v1\/report/);
  assert.match(plan, /write\s+allowlistEndpoint https:\/\/abcdefghijklmnopqrst\.supabase\.co\/functions\/v1\/allowlist/);
  assert.doesNotMatch(plan, /SECRETVALUE/, 'the token is never printed');
  assert.equal(fs.existsSync(configFile) ? fs.readFileSync(configFile, 'utf8') : null, before, 'a dry run changes no file');
  await assert.rejects(deploy({ SUPABASE_PROJECT_REF: 'ABC', SUPABASE_ACCESS_TOKEN: 't' }, ['--dry-run']), /SUPABASE_PROJECT_REF/);
  await assert.rejects(deploy({ SUPABASE_PROJECT_REF: 'abcdefghijklmnopqrst' }, ['--dry-run']), /SUPABASE_ACCESS_TOKEN/);
  await assert.rejects(deploy({ SUPABASE_PROJECT_REF: 'abcdefghijklmnopqrst', SUPABASE_ACCESS_TOKEN: 't' }, ['--dry-run', '--token=x']), /Unknown option/);
  assert.deepEqual(endpointsFor('abcdefghijklmnopqrst'), { reportEndpoint: 'https://abcdefghijklmnopqrst.supabase.co/functions/v1/report', allowlistEndpoint: 'https://abcdefghijklmnopqrst.supabase.co/functions/v1/allowlist' });
});

test('deploy health checks pass against the real handlers, store nothing, and fail loudly against a wrong answer', async () => {
  const store = memoryStore();
  const report = createHandler({ store, secret: 'salt-stand-in', now: () => NOW });
  const list = allowlist.createHandler({ store: listStore(['nflxvideo.net']), now: () => NOW });
  const endpoints = endpointsFor('abcdefghijklmnopqrst');
  const fetchImpl = (url, init) => (url === endpoints.reportEndpoint ? report : list)(new Request(url, { ...init, headers: { 'x-forwarded-for': '192.0.2.1', ...(init.headers || {}) } }));
  const original = console.log; const logs = []; console.log = (...args) => logs.push(args.join(' '));
  try { await smoke(endpoints, fetchImpl, { attempts: 1, wait: 0 }); } finally { console.log = original; }
  assert.equal(store.rows.length, 0, 'the health checks store nothing');
  assert.equal(store.probes.length, 1, 'the probe reached storage once');
  assert.equal((logs.join('\n').match(/^ok {2}/gm) || []).length, healthChecks().length);
  assert.deepEqual(healthChecks().map(([, name, , want]) => `${name} ${want}`), ['report 405', 'report 400', 'report 400', 'report 400', 'report 202', 'allowlist 405', 'allowlist 200']);
  for (const [, name, init] of healthChecks()) if (name === 'report' && init.method === 'POST') assert.equal(init.headers['X-Acira-Probe'], '1', 'every report check is a probe');
  await assert.rejects(smoke(endpoints, async () => new Response(null, { status: 204 }), { attempts: 1, wait: 0 }), /Health check failed/);
  // The allow-list check reads the body: a 200 with any other shape fails.
  const wrongShape = (url, init) => (url === endpoints.reportEndpoint ? fetchImpl(url, init) : new Response('{"schema":1,"hosts":[],"reasons":[]}', { status: init.method === 'GET' ? 200 : 405 }));
  console.log = () => {};
  try { await assert.rejects(smoke(endpoints, wrongShape, { attempts: 1, wait: 0 }), /unexpected body/); } finally { console.log = original; }
});

test('deploy --write sets only the two endpoint values, and only to plain https addresses', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-site-reports-cfg-'));
  const file = path.join(dir, 'site-reports-config.cjs');
  const real = path.join(root, 'desktop/browser-services/site-reports-config.cjs');
  const template = "'use strict';\n// Where reports go. reportEndpoint and allowlistEndpoint are addresses, never keys.\nmodule.exports = { reportEndpoint: '', allowlistEndpoint: '' };\n";
  for (const source of [template, ...(fs.existsSync(real) ? [fs.readFileSync(real, 'utf8')] : [])]) {
    fs.writeFileSync(file, source);
    const endpoints = endpointsFor('abcdefghijklmnopqrst');
    await writeEndpoints(file, endpoints);
    const written = fs.readFileSync(file, 'utf8');
    // The shipped file may already hold the live addresses (after the first deploy); either way only the two quoted values change.
    assert.equal(written, source.replace(/reportEndpoint: '[^']*'/, `reportEndpoint: '${endpoints.reportEndpoint}'`).replace(/allowlistEndpoint: '[^']*'/, `allowlistEndpoint: '${endpoints.allowlistEndpoint}'`), 'nothing else changed');
    delete require.cache[file];
    assert.deepEqual(require(file), endpoints);
    await writeEndpoints(file, endpoints); assert.equal(fs.readFileSync(file, 'utf8'), written, 'writing again changes nothing');
  }
  const good = endpointsFor('abcdefghijklmnopqrst');
  for (const bad of ['http://x.supabase.co/functions/v1/report', 'https://u:p@x.supabase.co/', 'https://x.supabase.co/?apikey=k', 'https://x.supabase.co/#x', "https://x.supabase.co/a'b", 'nonsense', '']) {
    await assert.rejects(writeEndpoints(file, { ...good, reportEndpoint: bad }), Error, 'report ' + bad);
    await assert.rejects(writeEndpoints(file, { ...good, allowlistEndpoint: bad }), Error, 'allowlist ' + bad);
  }
  fs.writeFileSync(file, "module.exports = { endpoint: '' };\n");
  await assert.rejects(writeEndpoints(file, good), /no single reportEndpoint/);
  fs.writeFileSync(file, "module.exports = { reportEndpoint: '', allowlistEndpoint: '', reportEndpoint: '' };\n");
  await assert.rejects(writeEndpoints(file, good), /no single reportEndpoint/);
  assert.equal(fs.readFileSync(file, 'utf8'), "module.exports = { reportEndpoint: '', allowlistEndpoint: '', reportEndpoint: '' };\n", 'a refused write changes nothing');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('nothing in the new server files or the deploy script holds a key, token or project reference; neither function logs', () => {
  const files = ['supabase/config.toml', 'supabase/migrations/20261102000000_site_reports.sql', 'scripts/deploy-site-reports.mjs', 'docs/SUPABASE_SETUP.md',
    ...['report', 'allowlist'].flatMap((name) => ['handler.mjs', 'store.mjs', 'index.ts'].map((file) => `supabase/functions/${name}/${file}`))];
  const keyLike = [/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/, /\bsbp_[A-Za-z0-9]{20,}/, /\bsb_(secret|publishable)_[A-Za-z0-9_-]{10,}/, /AKIA[0-9A-Z]{12,}/, /\b[A-Fa-f0-9]{32,}\b/, /\b[a-z0-9]{20}\.supabase\.co/];
  for (const file of files) { const text = fs.readFileSync(path.join(root, file), 'utf8'); for (const pattern of keyLike) assert.doesNotMatch(text, pattern, file + ' ' + pattern); }
  for (const name of ['report', 'allowlist']) {
    const index = fs.readFileSync(path.join(root, 'supabase/functions', name, 'index.ts'), 'utf8');
    assert.match(index, /Deno\.env\.get\('SUPABASE_SERVICE_ROLE_KEY'\)/); assert.doesNotMatch(index, /Access-Control|cors/i);
    for (const file of ['handler.mjs', 'store.mjs', 'index.ts']) assert.doesNotMatch(fs.readFileSync(path.join(root, 'supabase/functions', name, file), 'utf8'), /console\.|Set-Cookie|Access-Control/, `${name}/${file}`);
  }
  assert.match(fs.readFileSync(path.join(root, 'supabase/functions/report/index.ts'), 'utf8'), /Deno\.env\.get\('ACIRA_USAGE_SALT'\)/, 'the same salt secret as usage');
  const script = fs.readFileSync(path.join(root, 'scripts/deploy-site-reports.mjs'), 'utf8');
  assert.doesNotMatch(script, /console\.(log|error)\([^)]*token/i, 'the token is never logged'); assert.doesNotMatch(script, /'--token'|--access-token/, 'the token is never a command-line argument');
});
