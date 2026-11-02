// R4-60 / R4-61: schema 3 of the daily usage message and the feature-rating message, on the server side: strict validation, the size limit,
// rate limits, the deploy health probes, the v3 migration's columns and lock-down, the REST store and the deploy script's plan.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHandler, validate, validateRating, ENUMS, USES, COUNTS, COUNTS_V2, ENUMS_V2, USES_V2, RATING_FEATURES, DAILY_COLUMNS, RATING_COLUMNS, LIMITS, MAX_BYTES, RATING_MAX_BYTES, SAMPLE_ID, PROBES, snake } from '../supabase/functions/usage/handler.mjs';
import { restStore } from '../supabase/functions/usage/store.mjs';
import { main as deploy, healthChecks, smoke, ensureSalt, migrationFiles, SALT_NAME } from '../scripts/deploy-metrics.mjs';

const root = path.resolve(import.meta.dirname, '..');
const NOW = Date.parse('2026-10-27T12:00:00Z');
const DAY = '2026-10-27';
const ID = '6081ef29-10d4-4023-8c6e-7dc490f6903f';
const BASE = { schema: 3, event: 'daily', installId: ID, appVersion: '0.9.4', channel: 'beta', platform: 'win32', arch: 'x64', language: 'en', day: DAY };
const full = () => {
  const value = { ...BASE };
  for (const [field, list] of Object.entries(ENUMS)) value[field] = list[0];
  for (const field of USES) value[field] = '1-2';
  return value;
};
const rating = (extra = {}) => ({ schema: 1, event: 'rating', feature: 'splitView', stars: 4, appVersion: '0.9.4', platform: 'darwin', day: DAY, ...extra });
const sql = () => fs.readFileSync(path.join(root, 'supabase/migrations/20261027000000_usage_metrics_v3.sql'), 'utf8');
const allSql = () => fs.readdirSync(path.join(root, 'supabase/migrations')).filter((name) => name.endsWith('.sql')).sort().map((name) => fs.readFileSync(path.join(root, 'supabase/migrations', name), 'utf8')).join('\n');

function memoryStore({ fail = false, probeOk = true } = {}) {
  const counters = new Map(), rows = [], ratings = [], probes = [];
  return {
    counters, rows, ratings, probes,
    async hit(key, seconds, limit) { const id = `${key}|${Math.floor(NOW / 1000 / seconds)}`; const total = (counters.get(id) || 0) + 1; counters.set(id, total); return total <= limit; },
    async insert(row) { if (fail) throw new Error('down'); rows.push(row); },
    async insertRating(row) { if (fail) throw new Error('down'); ratings.push(row); },
    async probe(table, columns) { if (fail) throw new Error('down'); probes.push([table, columns]); return probeOk; },
  };
}
const call = (handler, body, headers = {}) => handler(new Request('https://x.supabase.co/functions/v1/usage', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) }));
const make = (options) => { const store = memoryStore(options); return { store, handler: createHandler({ store, secret: 'salt-stand-in', now: () => NOW }) }; };

test('schema 3 keeps every schema-2 field and adds the rest of the audit, every value from a closed list', () => {
  for (const [field, list] of Object.entries(ENUMS_V2)) assert.deepEqual(ENUMS[field], list, field + ' unchanged');
  for (const field of USES_V2) assert.ok(USES.includes(field), field);
  assert.deepEqual(COUNTS, ['0', '1-2', '3-9', '10+'], 'the founder buckets');
  assert.equal(Object.keys(ENUMS).length, 30); assert.equal(USES.length, 15);
  const row = validate(full(), NOW);
  assert.ok(row);
  assert.equal(row.schema_version, 3);
  assert.deepEqual(Object.keys(row).sort(), [...DAILY_COLUMNS].sort(), 'a full message writes exactly every schema-3 column');
});

test('schema 3: base fields required, each fact optional (NULL), any unknown key, wrong value or wrong bucket refused', () => {
  const minimal = validate({ ...BASE }, NOW);
  assert.deepEqual(minimal, { day: DAY, install_id: ID, app_version: '0.9.4', channel: 'beta', platform: 'win32', arch: 'x64', language: 'en', schema_version: 3 }, 'a client that sends no facts yet is still counted');
  for (const key of Object.keys(BASE)) { const value = full(); delete value[key]; assert.equal(validate(value, NOW), null, key + ' is required'); }
  const bad = (mutate) => { const value = full(); mutate(value); return validate(value, NOW); };
  for (const [field, list] of Object.entries(ENUMS)) {
    for (const allowed of list) assert.ok(bad((v) => { v[field] = allowed; }), field + '=' + allowed);
    for (const wrong of ['https://example.org/?q=private', list[0] + ' ', '', 3, null, true]) assert.equal(bad((v) => { v[field] = wrong; }), null, `${field}=${JSON.stringify(wrong)}`);
    assert.ok(bad((v) => { delete v[field]; }), field + ' may be left out');
  }
  for (const field of USES) {
    for (const allowed of COUNTS) assert.ok(bad((v) => { v[field] = allowed; }), field + '=' + allowed);
    for (const wrong of ['2-5', '21+', '7', 4, 'many', '']) assert.equal(bad((v) => { v[field] = wrong; }), null, field + '=' + wrong);
  }
  for (const extra of ['url', 'site', 'title', 'search', 'ip', 'userAgent', 'profileName', 'path', 'tabs', 'time', 'comment']) assert.equal(bad((v) => { v[extra] = 'x'; }), null, extra);
  assert.equal(bad((v) => { v.tabsOpen = '37'; }), null, 'no exact tab count');
  assert.equal(bad((v) => { v.day = '2026-10-27T13:45:00Z'; }), null, 'no time of day');
  assert.equal(bad((v) => { v.installId = SAMPLE_ID; }), null, 'the placeholder id is never stored');
  assert.equal(bad((v) => { v.schema = 4; }), null);
  assert.equal(validate({ ...full(), schema: 2 }, NOW), null, 'schema-3 fields are not schema 2');
});

test('the longest schema-3 message fits the 2 KB limit and needs more than the old 1 KB (why the limit was raised)', () => {
  const longest = { ...BASE, appVersion: '1234.1234.1234-' + 'a'.repeat(9) };
  for (const [field, list] of Object.entries(ENUMS)) longest[field] = list.reduce((a, b) => (b.length > a.length ? b : a));
  for (const field of USES) longest[field] = '10+';
  assert.ok(validate(longest, NOW));
  const bytes = new TextEncoder().encode(JSON.stringify(longest)).length;
  assert.ok(bytes > 1024 && bytes < MAX_BYTES, `longest message is ${bytes} bytes`);
  assert.equal(MAX_BYTES, 2048);
});

test('rating messages: exactly feature, stars 1-5, app version, OS family and day; no id, no text', () => {
  assert.deepEqual(validateRating(rating(), NOW), { day: DAY, feature: 'splitView', stars: 4, app_version: '0.9.4', platform: 'darwin' });
  for (const feature of RATING_FEATURES) assert.ok(validateRating(rating({ feature }), NOW), feature);
  for (const stars of [1, 2, 3, 4, 5]) assert.ok(validateRating(rating({ stars }), NOW), 'stars ' + stars);
  for (const stars of [0, 6, 4.5, '5', null, -1]) assert.equal(validateRating(rating({ stars }), NOW), null, 'stars ' + stars);
  for (const feature of ['split view', 'https://example.org', 'other', '', 7]) assert.equal(validateRating(rating({ feature }), NOW), null, 'feature ' + feature);
  for (const extra of ['installId', 'comment', 'text', 'url', 'arch', 'language', 'channel']) assert.equal(validateRating(rating({ [extra]: 'x' }), NOW), null, extra);
  for (const key of Object.keys(rating())) { const value = rating(); delete value[key]; assert.equal(validateRating(value, NOW), null, key + ' required'); }
  assert.equal(validateRating(rating({ schema: 2 }), NOW), null); assert.equal(validateRating(rating({ day: '2026-10-29' }), NOW), null);
  assert.equal(validateRating(rating({ platform: 'android' }), NOW), null); assert.equal(validateRating(rating({ appVersion: 'x' }), NOW), null);
  assert.ok(new TextEncoder().encode(JSON.stringify(rating({ feature: 'newTabArtwork', appVersion: '1234.1234.1234-' + 'a'.repeat(9) }))).length < RATING_MAX_BYTES);
});

test('handler: ratings are stored apart from daily rows, size-capped and rate-limited per address', async () => {
  const { handler, store } = make();
  assert.equal((await call(handler, rating())).status, 204);
  assert.equal(store.ratings.length, 1); assert.equal(store.rows.length, 0);
  assert.equal((await call(handler, JSON.stringify(rating()) + ' '.repeat(RATING_MAX_BYTES))).status, 400, 'a padded rating is refused');
  const statuses = []; for (let i = 0; i < LIMITS.ratingDay[2] + 2; i++) statuses.push((await call(handler, rating())).status);
  assert.deepEqual(statuses, [204, 204, 204, 429, 429, 429], 'four ratings a day per address in all');
  assert.equal((await call(handler, rating(), { 'x-forwarded-for': '198.51.100.9' })).status, 204, 'another address has its own allowance');
  for (const key of store.counters.keys()) assert.doesNotMatch(key, /203\.0\.113\.7|198\.51/, 'hashed keys only');
  assert.equal((await call(make({ fail: true }).handler, rating())).status, 503);
  assert.equal((await call(handler, full())).status, 204, 'a schema-3 daily message is stored as a daily row');
  assert.equal(store.rows.at(-1).schema_version, 3);
});

test('handler: a health probe validates, checks every column, answers 202 and never stores; it cannot carry a real id', async () => {
  const { handler, store } = make();
  assert.equal((await call(handler, PROBES.daily(DAY), { 'x-acira-probe': '1' })).status, 202);
  assert.equal((await call(handler, PROBES.rating(DAY), { 'x-acira-probe': '1' })).status, 202);
  assert.deepEqual(store.probes.map(([table]) => table), ['daily_usage', 'feature_ratings']);
  assert.deepEqual(store.probes[0][1], DAILY_COLUMNS); assert.deepEqual(store.probes[1][1], RATING_COLUMNS);
  assert.equal(store.rows.length + store.ratings.length, 0, 'nothing stored');
  assert.equal((await call(handler, full(), { 'x-acira-probe': '1' })).status, 400, 'a probe with a real id is refused');
  assert.equal((await call(handler, PROBES.daily(DAY))).status, 400, 'the placeholder id without the probe header is refused');
  assert.equal((await call(make({ probeOk: false }).handler, PROBES.daily(DAY), { 'x-acira-probe': '1' })).status, 503, 'missing columns fail the probe');
});

test('v3 migration: one check-constrained nullable column per new field, widened use buckets, a locked feature_ratings table, founder views', () => {
  const text = sql();
  const fresh = [...Object.entries(ENUMS).filter(([field]) => !(field in ENUMS_V2)).map(([field, list]) => [snake(field), list]), ...USES.filter((field) => !USES_V2.includes(field)).map((field) => ['use_' + snake(field), COUNTS])];
  for (const [column, list] of fresh) {
    const match = new RegExp(`add column if not exists ${column} text check \\(${column} in \\(([^)]*)\\)\\)`).exec(text);
    assert.ok(match, column + ' column');
    assert.deepEqual(match[1].split(',').map((item) => item.trim().replace(/^'|'$/g, '')), list, column + ' allowed values');
  }
  assert.equal((text.match(/add column if not exists/g) || []).length, fresh.length, 'only the documented columns');
  assert.doesNotMatch(text, /add column if not exists \w+ \w+ not null/, 'every new column is nullable');
  for (const field of USES_V2) {
    const column = 'use_' + snake(field), match = new RegExp(`constraint daily_usage_${column}_check check \\(${column} in \\(([^)]*)\\)\\)`).exec(text);
    assert.ok(match, column + ' widened'); const values = match[1].split(',').map((item) => item.trim().replace(/^'|'$/g, ''));
    for (const bucket of [...COUNTS, ...COUNTS_V2]) assert.ok(values.includes(bucket), column + ' accepts ' + bucket);
  }
  assert.match(text, /check \(schema_version in \(1, 2, 3\)\)/);
  const features = /feature\s+text\s+not null check \(feature in \(([^)]*)\)\)/.exec(text);
  assert.deepEqual(features[1].split(',').map((item) => item.trim().replace(/^'|'$/g, '')), [...RATING_FEATURES]);
  assert.match(text, /stars\s+smallint not null check \(stars between 1 and 5\)/);
  assert.match(text, /alter table public\.feature_ratings enable row level security/);
  assert.match(text, /revoke all on table public\.feature_ratings from public, anon, authenticated/);
  const table = text.match(/create table if not exists public\.feature_ratings \([\s\S]*?\n\);/)[0];
  for (const field of ['install_id', 'ip', 'address', 'user_agent', 'email', 'url', 'comment', 'text', 'created_at', 'time']) assert.doesNotMatch(table, new RegExp('^\\s*' + field + '\\s', 'im'), 'no ' + field + ' column');
  assert.doesNotMatch(text, /create\s+policy/i); assert.doesNotMatch(text, /grant\s+(select|insert|update|delete|all)[^;]*\bto\s+(anon|authenticated|public)/i);
  for (const view of ['usage_feature_adoption', 'usage_feature_intensity', 'usage_setting_share', 'usage_modes', 'feature_ratings_weekly']) {
    assert.match(text, new RegExp(`create or replace view public\\.${view} with \\(security_invoker = on\\)`), view);
    assert.match(text, new RegExp(`revoke all on [^;]*public\\.${view}[^;]* from public, anon, authenticated`), view + ' revoked');
  }
  assert.match(text, /delete from public\.feature_ratings where day < current_date - 400/, 'ratings follow the 400-day retention');
  const every = allSql();
  for (const column of DAILY_COLUMNS) assert.match(every, new RegExp(`\\b${column}\\b`), column + ' exists in the migrations');
  for (const column of RATING_COLUMNS) assert.match(table, new RegExp(`\\b${column}\\b`), column + ' in feature_ratings');
  for (const column of USES.map((field) => 'use_' + snake(field))) assert.match(text, new RegExp(`'\\w+', u\\.${column}\\)`), column + ' in the intensity view');
});

test('restStore: ratings go to feature_ratings, the probe reads zero rows of named columns and refuses anything else', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return new Response(null, { status: init.method === 'GET' ? 200 : 201 }); };
  const store = restStore({ url: 'https://abc.supabase.co', key: 'KEY-FROM-ENV', fetchImpl });
  await store.insertRating({ day: DAY, feature: 'peek', stars: 5, app_version: '1.0.0', platform: 'win32' });
  assert.equal(calls[0].url, 'https://abc.supabase.co/rest/v1/feature_ratings'); assert.match(calls[0].init.headers.Prefer, /return=minimal/);
  assert.equal(await store.probe('daily_usage', ['day', 'use_peek']), true);
  assert.equal(calls[1].url, 'https://abc.supabase.co/rest/v1/daily_usage?select=day,use_peek&limit=0'); assert.equal(calls[1].init.method, 'GET');
  assert.equal(await store.probe('rate_limit', ['key']), false, 'only the two message tables');
  assert.equal(await store.probe('daily_usage', ['day;drop']), false);
  assert.equal(calls.length, 2);
  assert.equal(await restStore({ url: 'https://abc.supabase.co', key: 'k', fetchImpl: async () => new Response('{}', { status: 400 }) }).probe('feature_ratings', ['day']), false, 'a missing column fails');
  await assert.rejects(restStore({ url: 'https://abc.supabase.co', key: 'k', fetchImpl: async () => new Response('no', { status: 500 }) }).insertRating({}), /rating store failed/);
});

test('deploy: the dry run lists v1 -> v3, the salt secret and both message-type probes; the health checks pass against the real handler', async () => {
  assert.deepEqual(await migrationFiles(), ['20261025000000_usage_metrics.sql', '20261026000000_usage_metrics_v2.sql', '20261027000000_usage_metrics_v3.sql']);
  const logs = []; const original = console.log; console.log = (...args) => logs.push(args.join(' '));
  try { await deploy({ SUPABASE_PROJECT_REF: 'abcdefghijklmnopqrst', SUPABASE_ACCESS_TOKEN: 'sbp_SECRETVALUE' }, ['--dry-run']); } finally { console.log = original; }
  const plan = logs.join('\n');
  for (const name of await migrationFiles()) assert.match(plan, new RegExp(name.replace('.', '\\.')));
  assert.match(plan, new RegExp(SALT_NAME)); assert.match(plan, /daily usage probe[^\n]*202/); assert.match(plan, /feature rating probe[^\n]*202/);
  assert.doesNotMatch(plan, /SECRETVALUE/);
  // smoke() probes with today's date, so this handler runs on the real clock (a fixed NOW made the test fail once the day moved on).
  const store = memoryStore(); const handler = createHandler({ store, secret: 'salt-stand-in', now: () => Date.now() });
  const fetchImpl = (url, init) => handler(new Request(url, { ...init, headers: { 'x-forwarded-for': '192.0.2.1', ...(init.headers || {}) } }));
  console.log = () => {};
  try { await smoke('https://x.supabase.co/functions/v1/usage', fetchImpl, { attempts: 1, wait: 0 }); } finally { console.log = original; }
  assert.equal(store.rows.length + store.ratings.length, 0, 'the health checks store nothing');
  assert.equal(healthChecks(DAY).length, 6);
  await assert.rejects(smoke('https://x.supabase.co/functions/v1/usage', async () => new Response(null, { status: 204 }), { attempts: 1, wait: 0 }), /Health check failed/);
});

test('deploy: the salt is set once, random, server side only, and never printed', async () => {
  const requests = [], logs = [];
  const fetchImpl = (existing) => async (url, init) => { requests.push({ url, init }); return init.method === 'GET' ? new Response(JSON.stringify(existing), { status: 200 }) : new Response(null, { status: 201 }); };
  const original = console.log; console.log = (...args) => logs.push(args.join(' '));
  try {
    assert.equal(await ensureSalt({ ref: 'abcdefghijklmnopqrst', token: 't' }, fetchImpl([{ name: 'OTHER' }])), true);
    const body = JSON.parse(requests[1].init.body);
    assert.equal(requests[1].url, 'https://api.supabase.com/v1/projects/abcdefghijklmnopqrst/secrets');
    assert.equal(body.length, 1); assert.equal(body[0].name, SALT_NAME); assert.match(body[0].value, /^[0-9a-f]{64}$/);
    assert.doesNotMatch(logs.join('\n'), new RegExp(body[0].value), 'the salt is never printed');
    requests.length = 0;
    assert.equal(await ensureSalt({ ref: 'abcdefghijklmnopqrst', token: 't' }, fetchImpl([{ name: SALT_NAME }])), false, 'an existing salt is kept');
    assert.equal(requests.length, 1);
  } finally { console.log = original; }
  const index = fs.readFileSync(path.join(root, 'supabase/functions/usage/index.ts'), 'utf8');
  assert.match(index, /Deno\.env\.get\('ACIRA_USAGE_SALT'\)/);
});
