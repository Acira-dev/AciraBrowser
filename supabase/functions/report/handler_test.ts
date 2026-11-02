// @ts-nocheck
// Both site-report handlers under real Deno (the runtime Supabase Edge Functions use), with in-memory stores: no network, no environment,
// no file access. Not part of npm test (the Node suite is tests/supabase-site-reports.test.mjs). Run by hand:
//   deno test supabase/functions/report/handler_test.ts
import { createHandler as reportHandler, PROBE } from './handler.mjs';
import { createHandler as allowlistHandler } from '../allowlist/handler.mjs';

function assertEquals(actual, expected, message = '') {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${message} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function memoryStore() {
  const counters = new Map(), rows = [];
  return {
    counters, rows,
    async hit(key, seconds, limit) { const total = (counters.get(key) || 0) + 1; counters.set(key, total); return total <= limit; },
    async insert(row) { rows.push(row); },
    async probe() { return true; },
  };
}
const post = (body, headers = {}) => new Request('https://x.supabase.co/functions/v1/report', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7', ...headers }, body: JSON.stringify(body) });

Deno.test('report: a valid report is stored (204), an invalid one is refused (400), a probe stores nothing (202)', async () => {
  const store = memoryStore();
  const handle = reportHandler({ store, secret: 'salt-stand-in' });
  const ok = await handle(post({ schema: 1, host: 'nflxvideo.net', kind: 'blocked', list: 'phishing-db', appVersion: '0.9.4', platform: 'darwin', note: '  Videos stopped loading.  ' }));
  assertEquals(ok.status, 204, 'valid report');
  assertEquals(await ok.text(), '', 'no body');
  assertEquals(store.rows, [{ host: 'nflxvideo.net', kind: 'blocked', list: 'phishing-db', app_version: '0.9.4', platform: 'darwin', note: 'Videos stopped loading.' }], 'stored row');
  for (const bad of [{ ...PROBE, host: 'nflxvideo.net/watch' }, { ...PROBE, host: '127.0.0.1' }, { ...PROBE, note: 'x'.repeat(501) }, { ...PROBE, extra: 1 }, {}]) {
    const reply = await handle(post(bad));
    assertEquals(reply.status, 400, JSON.stringify(bad).slice(0, 60));
  }
  assertEquals((await handle(post(PROBE, { 'x-acira-probe': '1' }))).status, 202, 'probe');
  assertEquals((await handle(new Request('https://x.supabase.co/functions/v1/report'))).status, 405, 'GET');
  assertEquals(store.rows.length, 1, 'only the valid report was stored');
  for (const key of store.counters.keys()) if (!/^rp:(?:[0-9a-f]{32}|all):[hds]$/.test(key) || key.includes('203.0.113.7')) throw new Error('unexpected counter key ' + key);
});

Deno.test('allowlist: GET answers 200 with the sorted, checked host list; HEAD has no body; POST is refused', async () => {
  const handle = allowlistHandler({ store: { hosts: async () => ['nflxvideo.net', 'a.example.org', 'nflxvideo.net', 'BAD.example.org', 'localhost'] } });
  const reply = await handle(new Request('https://x.supabase.co/functions/v1/allowlist'));
  assertEquals(reply.status, 200, 'GET');
  assertEquals(await reply.text(), '{"schema":1,"hosts":["a.example.org","nflxvideo.net"]}', 'body');
  assertEquals(reply.headers.get('content-type'), 'application/json; charset=utf-8', 'content type');
  assertEquals(reply.headers.get('cache-control'), 'public, max-age=3600', 'cache control');
  const head = await handle(new Request('https://x.supabase.co/functions/v1/allowlist', { method: 'HEAD' }));
  assertEquals([head.status, await head.text()], [200, ''], 'HEAD');
  assertEquals((await handle(new Request('https://x.supabase.co/functions/v1/allowlist', { method: 'POST', body: '{}' }))).status, 405, 'POST');
});
