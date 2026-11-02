// R3-11: schema 2 of the anonymous usage message, still accepted exactly so Round 3 builds are counted. Nothing outside a closed list can be
// stored. (Schema 3 and ratings: supabase-metrics-v3.test.mjs; base behaviour, limits and deploy script: supabase-metrics.test.mjs.)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { validate, MAX_BYTES, ENUMS_V2 as ENUMS, USES_V2 as USES, COUNTS_V2 as COUNTS } from '../supabase/functions/usage/handler.mjs';

const require = createRequire(import.meta.url);
const client = require('../desktop/browser-services/usage-facts.cjs');
const root = path.resolve(import.meta.dirname, '..');
const NOW = Date.parse('2026-10-25T12:00:00Z');
const BASE = ['schema', 'event', 'installId', 'appVersion', 'channel', 'platform', 'arch', 'language', 'day'];
const good = () => ({
  schema: 2, event: 'daily', installId: '6081ef29-10d4-4023-8c6e-7dc490f6903f', appVersion: '0.1.0-beta.1', channel: 'beta', platform: 'win32', arch: 'x64', language: 'en', day: '2026-10-25',
  theme: 'dark', finish: 'burgundy', tabLayout: 'sidebar', toolbar: 'automatic', animation: 'fast', uiLanguage: 'fr', searchEngine: 'duckduckgo', importSource: 'chrome', aiFree: 'on', vpn: 'on', vpnApp: 'Mullvad VPN',
  extensions: '2-3', profiles: '2', siteProtectionOff: '1', torTabs: '2-5', torWindows: '0', privateTabs: '1', privateWindows: '0', splitView: '1', rewind: '0', tabSets: '0', peek: '6-20',
});
const snake = (name) => name.replace(/[A-Z]/g, (letter) => '_' + letter.toLowerCase());

test('schema 2 is the frozen Round 3 shape, and every list of it is still inside the app\'s schema-3 lists', () => {
  for (const [field, list] of Object.entries(ENUMS)) assert.deepEqual(client.ENUMS[field], list, field);
  for (const field of USES) assert.ok(client.USES.includes(field), field);
  assert.equal(Object.keys(good()).length, 9 + 14 + 8, 'nine base fields, 14 choices, 8 use buckets');
  assert.ok(validate(good(), NOW));
});

test('any value outside its closed list, any extra key and any wrong type is refused; the longest message fits the size limit', () => {
  const bad = (mutate) => { const value = good(); mutate(value); return validate(value, NOW); };
  for (const [field, list] of Object.entries(ENUMS)) {
    assert.equal(bad((v) => { v[field] = 'https://example.org/?q=private search'; }), null, field + ' as a URL');
    assert.equal(bad((v) => { v[field] = list[0] + ' '; }), null, field + ' with trailing text');
    assert.equal(bad((v) => { v[field] = 3; }), null, field + ' as a number');
    assert.equal(bad((v) => { delete v[field]; }), null, field + ' missing');
    for (const allowed of list) assert.ok(bad((v) => { v[field] = allowed; }), field + '=' + allowed);
  }
  for (const field of USES) {
    for (const wrong of ['7', '1000', 'many', 5, '2 - 5', '']) assert.equal(bad((v) => { v[field] = wrong; }), null, field + '=' + wrong);
    for (const allowed of COUNTS) assert.ok(bad((v) => { v[field] = allowed; }), field + '=' + allowed);
  }
  for (const extra of ['url', 'site', 'search', 'ip', 'userAgent', 'profileName', 'path']) assert.equal(bad((v) => { v[extra] = 'x'; }), null, extra);
  assert.equal(bad((v) => { v.schema = 1; }), null, 'schema 1 is no longer accepted');
  const longest = good();
  for (const [field, list] of Object.entries(ENUMS)) longest[field] = list.reduce((a, b) => (b.length > a.length ? b : a));
  for (const field of USES) longest[field] = '6-20';
  longest.appVersion = '1.2.3-' + 'a'.repeat(16);
  assert.ok(validate(longest, NOW), 'the longest allowed values validate');
  assert.ok(new TextEncoder().encode(JSON.stringify(longest)).length < MAX_BYTES, 'and fit the size limit');
});

test('the schema 2 migration: one check-constrained text column per field with exactly the allowed values; the lock-down is untouched', () => {
  const sql = fs.readFileSync(path.join(root, 'supabase/migrations/20261026000000_usage_metrics_v2.sql'), 'utf8');
  const columns = [...Object.entries(ENUMS).map(([field, list]) => [snake(field), list]), ...USES.map((field) => ['use_' + snake(field), COUNTS])];
  for (const [column, list] of columns) {
    const match = new RegExp(`add column if not exists ${column} text check \\(${column} in \\(([^)]*)\\)\\)`).exec(sql);
    assert.ok(match, column + ' column');
    assert.deepEqual(match[1].split(',').map((item) => item.trim().replace(/^'|'$/g, '')), list, column + ' allowed values');
  }
  assert.equal((sql.match(/add column if not exists/g) || []).length, columns.length + 1, 'only the documented columns (plus schema_version)');
  assert.doesNotMatch(sql, /create\s+policy|grant\s+(select|insert|update|delete|all)[^;]*\bto\s+(anon|authenticated|public)/i);
  assert.match(sql, /revoke all on public\.usage_choices, public\.usage_feature_use from public, anon, authenticated/);
  assert.doesNotMatch(sql, /\b(ip|address|user_agent|url|site|query|term)\b\s+(text|inet|varchar)/i, 'no column that could hold an address, URL or search term');
  const written = Object.keys(validate(good(), NOW));
  for (const [column] of columns) assert.ok(written.includes(column), column + ' is written by the function');
  assert.ok(written.includes('schema_version'));
});
