// The whole logic of the `allowlist` Edge Function, with no Deno, network or database in it, so Node can run it in tests.
// index.ts supplies the real store (restStore); tests supply fakes.
//
// GET and HEAD only. Answers the hosts the team cleared after reviewing site reports (public.site_allowlist) as exactly
// {"schema":1,"hosts":[...]}: sorted, without repeats, each checked again with validHost (a bad row typed in the dashboard is skipped,
// not served), at most MAX_HOSTS. Never the reason or the date a row was added. The query string and any body are ignored.
// The app reads it with desktop/browser-services/site-allowlist.cjs, which refuses the whole answer if any host is not a valid one.
// Answers 200 (the list), 405 (wrong method), 503 (storage trouble). Never CORS headers, never a cookie; the request's address is not read.

export const MAX_HOSTS = 20000;
/** How long one function instance reuses its answer before reading the table again. */
export const CACHE_MS = 60000;
const HEADERS = Object.freeze({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });

// HOST, BLOCKED_TLDS and validHost mirror supabase/functions/report/handler.mjs (copied so each function deploys on its own; the tests compare them).
export const HOST = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;
export const BLOCKED_TLDS = Object.freeze(['onion', 'local', 'localhost', 'internal', 'lan', 'home', 'arpa', 'test', 'invalid', 'example']);
export function validHost(host) {
  if (typeof host !== 'string' || host.length < 4 || host.length > 253 || !HOST.test(host)) return false;
  return !BLOCKED_TLDS.includes(host.slice(host.lastIndexOf('.') + 1));
}

/** The answer body for the rows the store returned: valid hosts only, sorted, without repeats, at most MAX_HOSTS. */
export function listBody(hosts) {
  const valid = [...new Set(hosts.filter(validHost))].sort();
  return JSON.stringify({ schema: 1, hosts: valid.slice(0, MAX_HOSTS) });
}

const reply = (status, headers = {}) => new Response(null, { status, headers });

/** `store.hosts()` -> the host column of every site_allowlist row (or throws). `now` is injectable for the cache tests. */
export function createHandler({ store, now = () => Date.now() }) {
  let cached = null, pending = null;
  async function current() {
    if (cached && now() - cached.at < CACHE_MS) return cached.body;
    // Calls that arrive while the table is being read share that one read.
    if (!pending) pending = store.hosts().then((hosts) => { cached = { body: listBody(hosts), at: now() }; return cached.body; }).finally(() => { pending = null; });
    return pending;
  }
  return async function handle(request) {
    if (request.method !== 'GET' && request.method !== 'HEAD') return reply(405, { Allow: 'GET, HEAD' });
    let body;
    try { body = await current(); } catch { return reply(503); }
    return new Response(request.method === 'HEAD' ? null : body, { status: 200, headers: HEADERS });
  };
}
