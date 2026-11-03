// beta.9, who stops using Acira, on the server side: the churn migration (gone and retention views over the daily messages already stored,
// the Windows uninstall table and its view), the `uninstall` message in the usage function (strict validation, size, rate limit, probe),
// the REST store and the deploy script. The views were also run on a real Postgres 17 (PGlite) with a made-up history; see the handover.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHandler, validateUninstall, UNINSTALL_FIELDS, UNINSTALL_COLUMNS, UNINSTALL_PLATFORMS, UNINSTALL_MAX_BYTES, ARCHES, LIMITS, SAMPLE_ID, PROBES } from '../supabase/functions/usage/handler.mjs';
import { restStore } from '../supabase/functions/usage/store.mjs';
import { main as deploy, healthChecks, smoke, migrationFiles } from '../scripts/deploy-metrics.mjs';

const root = path.resolve(import.meta.dirname, '..');
const NOW = Date.parse('2026-11-03T12:00:00Z');
const DAY = '2026-11-03';
const ID = '6081ef29-10d4-4023-8c6e-7dc490f6903f';
const FILE = '20261103000000_usage_churn.sql';
const sql = () => fs.readFileSync(path.join(root, 'supabase/migrations', FILE), 'utf8');
const message = (extra = {}) => ({ schema: 1, event: 'uninstall', installId: ID, appVersion: '0.1.0-beta.9', platform: 'win32', arch: 'x64', day: DAY, ...extra });
const list = (text) => text.split(',').map((item) => item.trim().replace(/^'|'$/g, ''));
const view = (name) => { const text = sql(); const start = text.indexOf(`create or replace view public.${name} `); assert.ok(start >= 0, name); return text.slice(start, text.indexOf(';\n', start)); };

function memoryStore({ fail = false, probeOk = true } = {}) {
  const counters = new Map(), uninstalls = new Map(), rows = [], ratings = [], probes = [];
  return {
    counters, uninstalls, rows, ratings, probes,
    async hit(key, seconds, limit) { const id = `${key}|${Math.floor(NOW / 1000 / seconds)}`; const total = (counters.get(id) || 0) + 1; counters.set(id, total); return total <= limit; },
    async insert(row) { if (fail) throw new Error('down'); rows.push(row); },
    async insertRating(row) { if (fail) throw new Error('down'); ratings.push(row); },
    async insertUninstall(row) { if (fail) throw new Error('down'); if (!uninstalls.has(row.install_id)) uninstalls.set(row.install_id, row); },
    async probe(table, columns) { if (fail) throw new Error('down'); probes.push([table, columns]); return probeOk; },
  };
}
const call = (handler, body, headers = {}) => handler(new Request('https://x.supabase.co/functions/v1/usage', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) }));
const make = (options) => { const store = memoryStore(options); return { store, handler: createHandler({ store, secret: 'salt-stand-in', now: () => NOW }) }; };

test('uninstall message: exactly the seven fields, Windows only, a real random id, no text', () => {
  assert.deepEqual(validateUninstall(message(), NOW), { install_id: ID, day: DAY, app_version: '0.1.0-beta.9', platform: 'win32', arch: 'x64' });
  assert.deepEqual([...UNINSTALL_FIELDS], ['schema', 'event', 'installId', 'appVersion', 'platform', 'arch', 'day']);
  for (const arch of ARCHES) assert.ok(validateUninstall(message({ arch }), NOW), arch);
  for (const key of UNINSTALL_FIELDS) { const value = message(); delete value[key]; assert.equal(validateUninstall(value, NOW), null, key + ' is required'); }
  for (const extra of ['channel', 'language', 'reason', 'comment', 'url', 'ip', 'userAgent', 'time', 'keptData']) assert.equal(validateUninstall(message({ [extra]: 'x' }), NOW), null, extra);
  for (const [field, wrong] of [['platform', 'darwin'], ['platform', 'linux'], ['platform', 'Win32'], ['arch', 'mips'], ['schema', 2], ['schema', '1'], ['event', 'daily'], ['event', 'Uninstall'], ['installId', ID.toUpperCase()], ['installId', 'not-an-id'], ['installId', SAMPLE_ID], ['appVersion', '1.0'], ['appVersion', '1.0.0; drop'], ['day', '2026-11-05'], ['day', '2026-11-03T10:00:00Z'], ['day', '2026-02-30']]) assert.equal(validateUninstall(message({ [field]: wrong }), NOW), null, `${field}=${wrong}`);
  assert.ok(validateUninstall(message({ day: '2026-11-02' }), NOW), 'yesterday (time zones)');
  assert.equal(validateUninstall(null, NOW), null); assert.equal(validateUninstall([], NOW), null);
  assert.equal(validateUninstall(PROBES.uninstall(DAY), NOW), null, 'the placeholder id only with the probe flag');
  assert.ok(validateUninstall(PROBES.uninstall(DAY), NOW, { probe: true }));
  assert.equal(validateUninstall(message(), NOW, { probe: true }), null, 'a probe never carries a real id');
});

test('handler: an uninstall is stored once per id, size-capped, rate-limited per address, apart from daily rows and ratings', async () => {
  const { handler, store } = make();
  const reply = await call(handler, message());
  assert.equal(reply.status, 204); assert.equal(await reply.text(), '');
  assert.equal(store.uninstalls.size, 1); assert.equal(store.rows.length + store.ratings.length, 0);
  assert.equal((await call(handler, message())).status, 204, 'a repeat is harmless');
  assert.equal(store.uninstalls.size, 1, 'and stored once');
  assert.equal((await call(handler, JSON.stringify(message()) + ' '.repeat(UNINSTALL_MAX_BYTES))).status, 400, 'a padded message is refused');
  assert.equal((await call(handler, message({ platform: 'darwin' }))).status, 400);
  const fresh = make(); const statuses = [];
  for (let i = 0; i < LIMITS.uninstallDay[2] + 2; i++) statuses.push((await call(fresh.handler, message({ installId: `6081ef29-10d4-4023-8c6e-${String(i).padStart(12, '0')}` }))).status);
  assert.deepEqual(statuses, [204, 204, 204, 429, 429], 'three uninstalls a day per address');
  assert.equal((await call(fresh.handler, message(), { 'x-forwarded-for': '198.51.100.9' })).status, 204, 'another address has its own allowance');
  for (const key of fresh.store.counters.keys()) assert.doesNotMatch(key, /203\.0\.113\.7|198\.51/, 'hashed keys only');
  assert.ok([...fresh.store.counters.keys()].some((key) => key.startsWith('un:')), 'its own counter');
  assert.equal((await call(make({ fail: true }).handler, message())).status, 503);
  for (const [name] of reply.headers) assert.doesNotMatch(name, /^access-control-|^set-cookie$/i);
});

test('handler: the uninstall probe validates, checks every column, answers 202 and stores nothing', async () => {
  const { handler, store } = make();
  assert.equal((await call(handler, PROBES.uninstall(DAY), { 'x-acira-probe': '1' })).status, 202);
  assert.deepEqual(store.probes, [['usage_uninstalls', UNINSTALL_COLUMNS]]);
  assert.equal(store.uninstalls.size, 0);
  assert.equal((await call(handler, message(), { 'x-acira-probe': '1' })).status, 400, 'a probe with a real id is refused');
  assert.equal((await call(make({ probeOk: false }).handler, PROBES.uninstall(DAY), { 'x-acira-probe': '1' })).status, 503, 'a missing table fails the probe');
});

test('restStore: an uninstall goes to usage_uninstalls, a repeat id is ignored; the probe may read that table', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return new Response(null, { status: init.method === 'GET' ? 200 : 201 }); };
  const store = restStore({ url: 'https://abc.supabase.co', key: 'KEY-FROM-ENV', fetchImpl });
  await store.insertUninstall(validateUninstall(message(), NOW));
  assert.equal(calls[0].url, 'https://abc.supabase.co/rest/v1/usage_uninstalls?on_conflict=install_id');
  assert.match(calls[0].init.headers.Prefer, /resolution=ignore-duplicates/); assert.match(calls[0].init.headers.Prefer, /return=minimal/);
  assert.deepEqual(JSON.parse(calls[0].init.body), { install_id: ID, day: DAY, app_version: '0.1.0-beta.9', platform: 'win32', arch: 'x64' });
  assert.equal(await store.probe('usage_uninstalls', [...UNINSTALL_COLUMNS]), true);
  assert.equal(calls[1].url, `https://abc.supabase.co/rest/v1/usage_uninstalls?select=${UNINSTALL_COLUMNS.join(',')}&limit=0`);
  await assert.rejects(restStore({ url: 'https://abc.supabase.co', key: 'k', fetchImpl: async () => new Response('no', { status: 500 }) }).insertUninstall({}), /uninstall store failed/);
});

test('migration: the uninstall table mirrors the function, is locked, has no identifying column, follows the 400-day retention', () => {
  const text = sql();
  const table = text.match(/create table if not exists public\.usage_uninstalls \([\s\S]*?\n\);/)[0];
  assert.match(table, /install_id\s+uuid not null primary key/, 'one row per install');
  for (const column of UNINSTALL_COLUMNS) assert.match(table, new RegExp(`^\\s*${column}\\s+\\w+ not null`, 'm'), column + ' not null');
  assert.equal((table.match(/^\s{2}\w+\s/gm) || []).length, UNINSTALL_COLUMNS.length, 'only these columns');
  assert.deepEqual(list(/check \(platform in \(([^)]*)\)\)/.exec(table)[1]), [...UNINSTALL_PLATFORMS]);
  assert.deepEqual(list(/check \(arch in \(([^)]*)\)\)/.exec(table)[1]), [...ARCHES]);
  const daily = fs.readFileSync(path.join(root, 'supabase/migrations/20261025000000_usage_metrics.sql'), 'utf8');
  assert.equal(/app_version text\s+not null (check \([^\n]*\)),/.exec(table)[1], /app_version text\s+not null (check \([^\n]*\)),/.exec(daily)[1], 'the same version rule as daily_usage');
  for (const field of ['ip', 'address', 'user_agent', 'email', 'url', 'reason', 'comment', 'created_at', 'time', 'language', 'channel']) assert.doesNotMatch(table, new RegExp('^\\s*' + field + '\\s', 'im'), 'no ' + field + ' column');
  assert.match(text, /alter table public\.usage_uninstalls enable row level security/);
  assert.match(text, /revoke all on table public\.usage_uninstalls from public, anon, authenticated/);
  assert.doesNotMatch(text, /create\s+policy/i); assert.doesNotMatch(text, /grant\s+(select|insert|update|delete|all)[^;]*\bto\s+(anon|authenticated|public)/i);
  assert.match(text, /grant execute on function public\.prune_usage\(\) to service_role/);
  assert.match(text, /revoke all on function public\.prune_usage\(\) from public, anon, authenticated/);
  const prune = text.slice(text.indexOf('create or replace function public.prune_usage()'), text.indexOf('$$;', text.indexOf('create or replace function public.prune_usage()')));
  for (const line of ['delete from public.daily_usage where day < current_date - 400', 'delete from public.feature_ratings where day < current_date - 400', 'delete from public.usage_uninstalls where day < current_date - 400', "delete from public.rate_limit where window_start < now() - interval '2 days'"]) assert.ok(prune.includes(line), 'prune keeps: ' + line);
  assert.match(text, /notify pgrst, 'reload schema';\s*$/, 'the REST layer sees the table before the deploy probe');
  assert.match(text, /create index if not exists daily_usage_install_day on public\.daily_usage \(install_id, day\)/);
  for (const statement of text.match(/^(create|alter)[^\n]*/gm)) assert.match(statement, /if not exists|or replace|enable row level security/, 'idempotent: ' + statement);
});

test('migration: the three founder views are invoker views, revoked, and say "gone" the same way (14 days of silence)', () => {
  const text = sql();
  for (const name of ['usage_gone_weekly', 'usage_retention', 'usage_uninstalls_weekly']) {
    assert.match(text, new RegExp(`create or replace view public\\.${name} with \\(security_invoker = on\\)`), name);
    assert.match(text, new RegExp(`revoke all on [^;]*public\\.${name}[^;]* from public, anon, authenticated`), name + ' revoked');
  }
  const gone = view('usage_gone_weekly'), retention = view('usage_retention'), uninstalls = view('usage_uninstalls_weekly');
  assert.match(gone, /s\.last_day = w\.day and s\.last_day <= current_date - 14/, 'gone: the last message ever, 14+ days old');
  assert.match(retention, /last_day <= current_date - 14/);
  assert.match(gone, /distinct on \(install_id, date_trunc\('week', day\)\)[\s\S]*order by install_id, date_trunc\('week', day\), day desc/, 'each install once per week, by its last message that week');
  for (const column of ['active_installs', 'gone_installs', 'gone_pct', 'uninstalled', 'settled']) assert.match(gone, new RegExp(`as ${column}\\b`), column);
  assert.match(gone, /group by week, platform, channel, app_version/, 'by platform, channel and app version');
  assert.match(gone, /\(week \+ 20 <= current_date\) as settled/);
  for (const n of [1, 7, 30]) {
    assert.match(retention, new RegExp(`count\\(\\*\\) filter \\(where first_day \\+ ${n} <= current_date\\) as day_${n}_base`), `day ${n} counts only installs old enough`);
    assert.match(retention, new RegExp(`filter \\(where first_day \\+ ${n} <= current_date and last_day >= first_day \\+ ${n}\\) as day_${n}_still`), `day ${n}: still sending on day ${n} or later`);
    assert.match(retention, new RegExp(`nullif\\(count\\(\\*\\) filter \\(where first_day \\+ ${n} <= current_date\\), 0\\), 1\\) as day_${n}_pct`), `day ${n}: no division by zero`);
  }
  assert.match(retention, /group by grouping sets \(\(cohort_week\), \(cohort_week, platform\)\)/, 'per platform and for all');
  assert.match(retention, /date_trunc\('week', min\(day\)\)::date as cohort_week/, 'cohort = the week first seen');
  for (const column of ['uninstalls', 'median_days_kept', 'came_back']) assert.match(uninstalls, new RegExp(`as ${column}\\b`), column);
  assert.match(uninstalls, /filter \(where s\.last_day > u\.day\) as came_back/);
  // the views read only what is already stored: no new column on daily_usage
  assert.doesNotMatch(text, /alter table public\.daily_usage add column/);
  // the comments say plainly what is measured
  for (const phrase of [/deleted Acira/, /stopped opening it/, /turned usage\s+sharing off/, /installations, not people/, /NEW random id/]) assert.match(text, phrase);
});

test('deploy: the dry run lists the churn migration and the uninstall checks; the health checks pass against the real handler and store nothing', async () => {
  const files = await migrationFiles();
  assert.equal(files.at(-1), FILE);
  assert.equal(healthChecks(DAY).length, 8);
  const labels = healthChecks(DAY).map(([label, , want]) => `${label} ${want}`).join('\n');
  assert.match(labels, /uninstall message from a Mac is refused 400/); assert.match(labels, /uninstall probe[^\n]*202/);
  const logs = []; const original = console.log; console.log = (...args) => logs.push(args.join(' '));
  try { await deploy({ SUPABASE_PROJECT_REF: 'abcdefghijklmnopqrst', SUPABASE_ACCESS_TOKEN: 'sbp_SECRETVALUE' }, ['--dry-run']); } finally { console.log = original; }
  const plan = logs.join('\n');
  assert.match(plan, new RegExp(`migrate\\s+supabase/migrations/${FILE.replace('.', '\\.')}`));
  assert.match(plan, /event "uninstall" schema 1/); assert.match(plan, /uninstall probe[^\n]*-> 202/);
  assert.doesNotMatch(plan, /SECRETVALUE/);
  const store = memoryStore(); const handler = createHandler({ store, secret: 'salt-stand-in', now: () => Date.now() });
  const fetchImpl = (url, init) => handler(new Request(url, { ...init, headers: { 'x-forwarded-for': '192.0.2.1', ...(init.headers || {}) } }));
  console.log = () => {};
  try { await smoke('https://x.supabase.co/functions/v1/usage', fetchImpl, { attempts: 1, wait: 0 }); } finally { console.log = original; }
  assert.equal(store.rows.length + store.ratings.length + store.uninstalls.size, 0, 'the health checks store nothing');
  assert.deepEqual(store.probes.map(([table]) => table), ['daily_usage', 'feature_ratings', 'usage_uninstalls']);
});

test('the public source export and the setup runbook know the new migration', async () => {
  const { allowedSource } = await import('../scripts/export-public-source.mjs');
  assert.equal(allowedSource('supabase/migrations/' + FILE), true, 'export-public-source.mjs exports ' + FILE);
  const runbook = fs.readFileSync(path.join(root, 'docs/SUPABASE_SETUP.md'), 'utf8');
  assert.ok(runbook.includes(FILE)); for (const name of ['usage_gone_weekly', 'usage_retention', 'usage_uninstalls_weekly', 'usage_uninstalls']) assert.ok(runbook.includes(name), 'runbook names ' + name);
  const metrics = fs.readFileSync(path.join(root, 'docs/launch/METRICS.md'), 'utf8');
  for (const phrase of [/usage_gone_weekly/, /usage_retention/, /usage_uninstalls_weekly/, /installations, not people/i, /Mac/]) assert.match(metrics, phrase);
});

test('nothing in the new migration holds a key or token', () => {
  const text = sql();
  for (const pattern of [/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/, /\bsbp_[A-Za-z0-9]{20,}/, /\bsb_(secret|publishable)_[A-Za-z0-9_-]{10,}/, /\b[A-Fa-f0-9]{32,}\b/, /\b[a-z0-9]{20}\.supabase\.co/]) assert.doesNotMatch(text, pattern);
});
