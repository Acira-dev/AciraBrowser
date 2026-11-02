// The usage backend (supabase/), run locally with no Deno, no network to Supabase and no database server:
// the handler's validation and rate limits, the REST store's requests, the migration's safety, the deploy script, and the real client end to end against a stub.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { createHandler, validate, addressKey, sourceAddress, LIMITS, MAX_BYTES, SAMPLE_ID, DAILY_COLUMNS } from '../supabase/functions/usage/handler.mjs';
import { restStore } from '../supabase/functions/usage/store.mjs';
import { readInputs, endpointFor, writeEndpoint, main as deploy } from '../scripts/deploy-metrics.mjs';

const require = createRequire(import.meta.url);
const { createMetrics } = require('../desktop/browser-services/metrics.cjs');
const root = path.resolve(import.meta.dirname, '..');
const NOW = Date.parse('2026-10-25T12:00:00Z');
const FACTS = { theme: 'dark', finish: 'burgundy', tabLayout: 'sidebar', toolbar: 'automatic', animation: 'fast', uiLanguage: 'fr', searchEngine: 'duckduckgo', importSource: 'chrome', aiFree: 'on', vpn: 'on', vpnApp: 'Mullvad VPN', extensions: '2-3', profiles: '2', siteProtectionOff: '1', torTabs: '2-5', torWindows: '0', privateTabs: '1', privateWindows: '0', splitView: '1', rewind: '0', tabSets: '0', peek: '6-20' };
const good = () => ({ schema: 2, event: 'daily', installId: '6081ef29-10d4-4023-8c6e-7dc490f6903f', appVersion: '0.1.0-beta.1', channel: 'beta', platform: 'win32', arch: 'x64', language: 'en', day: '2026-10-25', ...FACTS });

/** Mirrors public.rate_limit_hit: a counter per key per fixed window; true while within the limit. */
function memoryStore(options = {}) {
  const counters = new Map(), rows = new Map(), ratings = [];
  return {
    rows, counters, ratings,
    async hit(key, seconds, limit) { const window = Math.floor((options.now?.() ?? NOW) / 1000 / seconds); const id = `${key}|${window}`; const total = (counters.get(id) || 0) + 1; counters.set(id, total); return total <= limit; },
    async insert(row) { if (options.fail) throw new Error('down'); const id = `${row.day}|${row.install_id}`; if (!rows.has(id)) rows.set(id, row); },
    async insertRating(row) { if (options.fail) throw new Error('down'); ratings.push(row); },
    async probe() { return !options.fail; },
  };
}
const call = (handler, body, { method = 'POST', headers = {} } = {}) => handler(new Request('https://x.supabase.co/functions/v1/usage', { method, headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7', ...headers }, ...(method === 'POST' ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}) }));
const make = (extra = {}) => { const store = memoryStore(extra); return { store, handler: createHandler({ store, secret: 'service-role-stand-in', now: () => NOW }) }; };

test('validate accepts exactly what the app sends and nothing else', () => {
  assert.ok(validate(good(), NOW));
  assert.deepEqual(validate(good(), NOW), { day: '2026-10-25', install_id: good().installId, app_version: '0.1.0-beta.1', channel: 'beta', platform: 'win32', arch: 'x64', language: 'en', schema_version: 2, theme: 'dark', finish: 'burgundy', tab_layout: 'sidebar', toolbar: 'automatic', animation: 'fast', ui_language: 'fr', search_engine: 'duckduckgo', import_source: 'chrome', ai_free: 'on', vpn: 'on', vpn_app: 'Mullvad VPN', extensions: '2-3', profiles: '2', site_protection_off: '1', use_tor_tabs: '2-5', use_tor_windows: '0', use_private_tabs: '1', use_private_windows: '0', use_split_view: '1', use_rewind: '0', use_tab_sets: '0', use_peek: '6-20' });
  const bad = (mutate) => { const value = good(); mutate(value); return validate(value, NOW); };
  assert.equal(bad((v) => { v.extra = 'x'; }), null, 'extra field');
  assert.equal(bad((v) => { delete v.arch; }), null, 'missing field');
  assert.equal(bad((v) => { v.schema = 1; }), null);
  assert.equal(bad((v) => { v.event = 'click'; }), null);
  assert.equal(bad((v) => { v.installId = SAMPLE_ID; }), null, 'placeholder id');
  assert.equal(bad((v) => { v.installId = 'not-a-uuid'; }), null);
  assert.equal(bad((v) => { v.installId = v.installId.toUpperCase(); }), null);
  assert.equal(bad((v) => { v.appVersion = '1.0.0; drop table'; }), null);
  assert.equal(bad((v) => { v.appVersion = '1.2.3-' + 'a'.repeat(30); }), null);
  assert.equal(bad((v) => { v.channel = 'nightly'; }), null);
  assert.equal(bad((v) => { v.platform = 'plan9'; }), null);
  assert.equal(bad((v) => { v.arch = 'mips'; }), null);
  assert.equal(bad((v) => { v.language = 'en-GB'; }), null, 'language is two letters only');
  assert.equal(bad((v) => { v.language = 'EN'; }), null);
  assert.equal(bad((v) => { v.day = '2026-10-27'; }), null, 'two days ahead');
  assert.equal(bad((v) => { v.day = '2026-10-23'; }), null, 'two days behind');
  assert.ok(bad((v) => { v.day = '2026-10-24'; }), 'yesterday is allowed (time zones, late sends)');
  assert.ok(bad((v) => { v.day = '2026-10-26'; }), 'tomorrow is allowed');
  assert.equal(bad((v) => { v.day = '2026-02-30'; }), null, 'impossible date');
  assert.equal(validate(null, NOW), null); assert.equal(validate([], NOW), null); assert.equal(validate('x', NOW), null);
  for (const key of ['platform', 'arch', 'language', 'appVersion']) assert.equal(bad((v) => { v[key] = 7; }), null, key + ' as a number');
});

test('the real client builds a message the function accepts (including the app version from package.json)', async () => {
  const sent = [];
  const metrics = createMetrics({ directory: fs.mkdtempSync(path.join(os.tmpdir(), 'acira-sb-')), endpoint: 'https://x.supabase.co/functions/v1/usage', appVersion: require('../package.json').version, platform: process.platform === 'win32' ? 'win32' : 'linux', arch: 'x64', language: 'en-GB', send: async (url, body) => { sent.push(JSON.parse(body)); return 204; }, now: () => NOW });
  await metrics.set(true);
  const payload = (await metrics.status()).payload;
  assert.ok(validate(payload, NOW), JSON.stringify(payload));
  assert.equal(payload.schema, 3);
  assert.deepEqual(Object.keys(validate(payload, NOW)).sort(), [...DAILY_COLUMNS].sort(), 'the real client fills every column the function writes');
});

test('handler: POST only, 204 on success, repeats are harmless, no body and no CORS ever', async () => {
  const { handler, store } = make();
  for (const method of ['GET', 'PUT', 'DELETE', 'OPTIONS']) { const reply = await call(handler, null, { method }); assert.equal(reply.status, 405, method); assert.equal(reply.headers.get('allow'), 'POST'); }
  const ok = await call(handler, good());
  assert.equal(ok.status, 204); assert.equal(await ok.text(), '');
  assert.equal((await call(handler, good())).status, 204, 'the same day and id again');
  assert.equal(store.rows.size, 1, 'stored once');
  for (const reply of [ok, await call(handler, '{'), await call(handler, null, { method: 'GET' })]) for (const [name] of reply.headers) assert.doesNotMatch(name, /^access-control-|^set-cookie$/i, 'no CORS or cookie header: ' + name);
});

test('handler: 400 for anything that is not exactly a valid message, including size', async () => {
  const { handler, store } = make();
  assert.equal((await call(handler, '')).status, 400);
  assert.equal((await call(handler, 'not json')).status, 400);
  assert.equal((await call(handler, '[]')).status, 400);
  assert.equal((await call(handler, { ...good(), extra: 1 })).status, 400);
  assert.equal((await call(handler, { ...good(), appVersion: 'x'.repeat(600) })).status, 400);
  const padded = JSON.stringify(good()) + ' '.repeat(MAX_BYTES);
  assert.equal((await call(handler, padded)).status, 400, 'over 512 bytes');
  assert.equal((await call(handler, good(), { headers: { 'content-length': '9000' } })).status, 400, 'declared size too big');
  assert.equal(store.rows.size, 0);
});

test('handler: rate limits per address (hour, day) and per install id (day) answer 429 and store nothing more', async () => {
  const hour = make();
  const statuses = [];
  for (let i = 0; i < LIMITS.ipHour[2] + 2; i++) statuses.push((await call(hour.handler, { ...good(), installId: `6081ef29-10d4-4023-8c6e-${String(i).padStart(12, '0')}` })).status);
  assert.deepEqual([...new Set(statuses.slice(0, LIMITS.ipHour[2]))], [204]); assert.deepEqual([...new Set(statuses.slice(LIMITS.ipHour[2]))], [429]);
  assert.equal(hour.store.rows.size, LIMITS.ipHour[2]);
  const otherAddress = await call(hour.handler, { ...good(), installId: '6081ef29-10d4-4023-8c6e-ffffffffffff' }, { headers: { 'x-forwarded-for': '198.51.100.9' } });
  assert.equal(otherAddress.status, 204, 'another address has its own allowance');
  const sameId = make();
  const results = []; for (let i = 0; i < 4; i++) results.push((await call(sameId.handler, good())).status);
  assert.deepEqual(results, [204, 204, 429, 429], 'two a day per install id');
  assert.equal((await call(make().handler, good(), { headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' } })).status, 204);
  const limited = await call(sameId.handler, good()); assert.equal(limited.headers.get('retry-after'), '3600');
});

test('handler: storage trouble answers 503 and never leaks detail; counters hold hashed keys, never an address', async () => {
  const down = make({ fail: true });
  const reply = await call(down.handler, good());
  assert.equal(reply.status, 503); assert.equal(await reply.text(), '');
  const { handler, store } = make();
  await call(handler, good());
  for (const key of store.counters.keys()) assert.doesNotMatch(key, /203\.0\.113\.7/, key);
  const a = await addressKey('203.0.113.7', 'secret', '2026-10-25');
  assert.match(a, /^[0-9a-f]{32}$/); assert.notEqual(a, await addressKey('203.0.113.7', 'secret', '2026-10-26'), 'rotates daily');
  assert.notEqual(a, await addressKey('203.0.113.8', 'secret', '2026-10-25'));
  assert.equal(sourceAddress(new Headers({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8' })), '1.2.3.4');
  assert.equal(sourceAddress(new Headers()), 'unknown');
});

test('the Postgres fixed-window upsert behaves as the handler assumes (same logic, run in SQLite, which spells the alias differently)', () => {
  const database = new DatabaseSync(':memory:');
  database.exec('create table rate_limit (key text not null, window_start integer not null, hits integer not null default 0, primary key (key, window_start))');
  const hit = database.prepare('insert into rate_limit (key, window_start, hits) values (?, ?, 1) on conflict (key, window_start) do update set hits = hits + 1 returning hits');
  const totals = [1, 2, 3].map(() => hit.get('ip:abc:h', 100).hits);
  assert.deepEqual(totals, [1, 2, 3]); assert.equal(hit.get('ip:abc:h', 101).hits, 1, 'a new window starts at one'); assert.equal(hit.get('ip:other:h', 100).hits, 1);
  const sql = fs.readFileSync(path.join(root, 'supabase/migrations/20261025000000_usage_metrics.sql'), 'utf8');
  assert.match(sql, /insert into public\.rate_limit as r \(key, window_start, hits\)\s+values \(p_key, window_begin, 1\)\s+on conflict \(key, window_start\) do update set hits = r\.hits \+ 1\s+returning r\.hits into total/);
  assert.match(sql, /return total <= p_limit/);
});

test('the migration locks both tables: RLS on, no policies, no public grants, functions for the service role only', () => {
  const sql = fs.readFileSync(path.join(root, 'supabase/migrations/20261025000000_usage_metrics.sql'), 'utf8');
  for (const table of ['daily_usage', 'rate_limit']) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(sql, new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated`));
  }
  assert.doesNotMatch(sql, /create\s+policy/i); assert.doesNotMatch(sql, /grant\s+(select|insert|update|delete|all)[^;]*\bto\s+(anon|authenticated|public)/i);
  assert.match(sql, /revoke all on function public\.rate_limit_hit\(text, integer, integer\) from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.rate_limit_hit\(text, integer, integer\) to service_role/);
  assert.match(sql, /primary key \(day, install_id\)/);
  for (const column of ['channel', 'platform', 'arch', 'language', 'app_version']) assert.match(sql, new RegExp(`${column}\\s+text\\s+not null check`), column + ' is constrained');
  assert.match(sql, /security_invoker = on/);
  for (const field of ['ip', 'address', 'user_agent', 'email', 'url']) assert.doesNotMatch(sql.match(/create table if not exists public\.daily_usage \([\s\S]*?\n\);/)[0], new RegExp('\\b' + field + '\\b', 'i'), 'no ' + field + ' column');
  const config = fs.readFileSync(path.join(root, 'supabase/config.toml'), 'utf8');
  assert.match(config, /\[functions\.usage\][\s\S]*verify_jwt = false/);
});

test('restStore sends exactly the two requests the database needs, with the service role key from its environment', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return new Response(url.includes('/rpc/') ? 'true' : null, { status: url.includes('/rpc/') ? 200 : 201 }); };
  const store = restStore({ url: 'https://abc.supabase.co/', key: 'KEY-FROM-ENV', fetchImpl });
  assert.equal(await store.hit('ip:1:h', 3600, 30), true);
  await store.insert({ day: '2026-10-25', install_id: good().installId, app_version: '1.0.0', channel: 'beta', platform: 'win32', arch: 'x64', language: 'en' });
  assert.equal(calls[0].url, 'https://abc.supabase.co/rest/v1/rpc/rate_limit_hit'); assert.deepEqual(JSON.parse(calls[0].init.body), { p_key: 'ip:1:h', p_window_seconds: 3600, p_limit: 30 });
  assert.equal(calls[1].url, 'https://abc.supabase.co/rest/v1/daily_usage?on_conflict=day,install_id'); assert.match(calls[1].init.headers.Prefer, /ignore-duplicates/);
  assert.equal(calls[0].init.headers.Authorization, 'Bearer KEY-FROM-ENV');
  assert.equal(await restStore({ url: 'https://abc.supabase.co', key: 'k', fetchImpl: async () => new Response('false') }).hit('k', 1, 1), false);
  await assert.rejects(restStore({ url: 'https://abc.supabase.co', key: 'k', fetchImpl: async () => new Response('no', { status: 500 }) }).insert({}), /usage store failed/);
  assert.throws(() => restStore({ url: '', key: '' }), /not configured/);
});

test('end to end: the real client opts in, sends over HTTP to the real handler, and the row lands once', async () => {
  const { handler, store } = make({ now: () => Date.now() });
  const live = createHandler({ store, secret: 's', now: () => Date.now() });
  const server = http.createServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const reply = await live(new Request('http://127.0.0.1/functions/v1/usage', { method: request.method, headers: { 'content-type': request.headers['content-type'] || '', 'x-forwarded-for': '203.0.113.50' }, body: request.method === 'POST' ? Buffer.concat(chunks) : undefined }));
    response.writeHead(reply.status, Object.fromEntries(reply.headers)); response.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const endpoint = `http://127.0.0.1:${server.address().port}/functions/v1/usage`;
    const post = async (url, body) => (await fetch(url, { method: 'POST', body, headers: { 'Content-Type': 'application/json' } })).status;
    const metrics = createMetrics({ directory: fs.mkdtempSync(path.join(os.tmpdir(), 'acira-e2e-')), endpoint, allowLocal: true, appVersion: require('../package.json').version, platform: 'win32', arch: 'x64', language: 'en-US', send: post });
    assert.deepEqual(await metrics.maybeSend(), { sent: false, reason: 'off' }); assert.equal(store.rows.size, 0, 'nothing before consent');
    await metrics.set(true);
    assert.deepEqual(await metrics.maybeSend(), { sent: true });
    assert.equal(store.rows.size, 1);
    const [row] = [...store.rows.values()];
    assert.deepEqual(Object.keys(row).sort(), [...DAILY_COLUMNS].sort()); assert.equal(row.schema_version, 3); assert.equal(row.theme, 'system', 'unconfigured facts fall back to the documented defaults');
    assert.equal(row.app_version, require('../package.json').version); assert.equal(row.language, 'en');
    assert.deepEqual(await metrics.maybeSend(), { sent: false, reason: 'already sent today' });
    assert.equal(await post(endpoint, '{}'), 400, 'a junk message is refused over the wire too');
    assert.equal((await fetch(endpoint)).status, 405);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('deploy script: needs a valid project ref and a token from the environment, rejects unknown options, and a dry run touches nothing', async () => {
  assert.throws(() => readInputs({}, []), /SUPABASE_PROJECT_REF/);
  assert.throws(() => readInputs({ SUPABASE_PROJECT_REF: 'ABC' }, []), /SUPABASE_PROJECT_REF/);
  assert.throws(() => readInputs({ SUPABASE_PROJECT_REF: 'abcdefghijklmnopqrst' }, []), /SUPABASE_ACCESS_TOKEN/);
  assert.throws(() => readInputs({ SUPABASE_PROJECT_REF: 'abcdefghijklmnopqrst', SUPABASE_ACCESS_TOKEN: 't' }, ['--token=x']), /Unknown option/);
  const inputs = readInputs({ SUPABASE_PROJECT_REF: 'abcdefghijklmnopqrst', SUPABASE_ACCESS_TOKEN: 'tok' }, ['--write', '--dry-run']);
  assert.deepEqual([inputs.write, inputs.dryRun, inputs.smoke], [true, true, true]);
  const before = fs.readFileSync(path.join(root, 'desktop/browser-services/metrics-config.cjs'), 'utf8');
  const logs = []; const original = console.log; console.log = (...args) => logs.push(args.join(' '));
  try { const result = await deploy({ SUPABASE_PROJECT_REF: 'abcdefghijklmnopqrst', SUPABASE_ACCESS_TOKEN: 'sbp_SECRETVALUE' }, ['--dry-run', '--write']); assert.equal(result.endpoint, 'https://abcdefghijklmnopqrst.supabase.co/functions/v1/usage'); } finally { console.log = original; }
  assert.doesNotMatch(logs.join('\n'), /SECRETVALUE/, 'the token is never printed');
  assert.equal(fs.readFileSync(path.join(root, 'desktop/browser-services/metrics-config.cjs'), 'utf8'), before, 'dry run changes no file');
  assert.equal(endpointFor('abcdefghijklmnopqrst'), 'https://abcdefghijklmnopqrst.supabase.co/functions/v1/usage');
});

test('deploy --write sets only the endpoint line, and only to a plain https address', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'acira-cfg-')), 'metrics-config.cjs');
  fs.copyFileSync(path.join(root, 'desktop/browser-services/metrics-config.cjs'), file);
  await writeEndpoint(file, 'https://abcdefghijklmnopqrst.supabase.co/functions/v1/usage');
  const written = require(file); assert.deepEqual(Object.keys(written), ['endpoint']); assert.equal(written.endpoint, 'https://abcdefghijklmnopqrst.supabase.co/functions/v1/usage');
  assert.equal(require('../desktop/browser-services/metrics.cjs').checkedEndpoint(written.endpoint), written.endpoint, 'the client accepts what the script wrote');
  for (const bad of ['http://x.supabase.co/', 'https://u:p@x.supabase.co/', 'https://x.supabase.co/?apikey=k', 'nonsense']) await assert.rejects(writeEndpoint(file, bad), bad);
  // The repo ships with no endpoint until the deploy (docs/SUPABASE_SETUP.md) writes the public function address; then only that address.
  assert.match(JSON.parse(JSON.stringify(require('../desktop/browser-services/metrics-config.cjs'))).endpoint, /^(?:|https:\/\/[a-z0-9]{20}\.supabase\.co\/functions\/v1\/usage)$/, 'empty, or exactly the deployed usage function address');
});

test('nothing in supabase/ or the deploy script holds a key, token or project reference', () => {
  const files = ['supabase/config.toml', 'supabase/functions/usage/handler.mjs', 'supabase/functions/usage/store.mjs', 'supabase/functions/usage/index.ts', 'supabase/migrations/20261025000000_usage_metrics.sql', 'supabase/migrations/20261026000000_usage_metrics_v2.sql', 'supabase/migrations/20261027000000_usage_metrics_v3.sql', 'scripts/deploy-metrics.mjs', 'docs/SUPABASE_SETUP.md'];
  const keyLike = [/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/, /\bsbp_[A-Za-z0-9]{20,}/, /\bsb_(secret|publishable)_[A-Za-z0-9_-]{10,}/, /AKIA[0-9A-Z]{12,}/, /\b[A-Fa-f0-9]{32,}\b/, /\b[a-z0-9]{20}\.supabase\.co/];
  for (const file of files) { const text = fs.readFileSync(path.join(root, file), 'utf8'); for (const pattern of keyLike) assert.doesNotMatch(text, pattern, file + ' ' + pattern); }
  const index = fs.readFileSync(path.join(root, 'supabase/functions/usage/index.ts'), 'utf8');
  assert.match(index, /Deno\.env\.get\('SUPABASE_SERVICE_ROLE_KEY'\)/); assert.doesNotMatch(index, /Access-Control|cors/i);
  const script = fs.readFileSync(path.join(root, 'scripts/deploy-metrics.mjs'), 'utf8');
  assert.doesNotMatch(script, /console\.(log|error)\([^)]*token/i, 'the token is never logged'); assert.doesNotMatch(script, /'--token'|--access-token/, 'the token is never a command-line argument');
});
