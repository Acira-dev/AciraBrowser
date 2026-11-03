// The Edge Function's storage, through Supabase's own REST interface with the service role key that the platform puts in the
// function's environment (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY). Nothing here is a secret kept in the repository.
// `fetchImpl` is injectable so Node tests can check exactly what would be sent.

const TABLES = ['daily_usage', 'feature_ratings', 'usage_uninstalls'];

export function restStore({ url, key, fetchImpl = fetch }) {
  if (!url || !key) throw new Error('Storage is not configured.');
  const base = String(url).replace(/\/+$/, '');
  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  return {
    /** Fixed-window counter in Postgres (public.rate_limit_hit). True when this call is within the limit. */
    async hit(counter, windowSeconds, limit) {
      const response = await fetchImpl(`${base}/rest/v1/rpc/rate_limit_hit`, { method: 'POST', headers, body: JSON.stringify({ p_key: counter, p_window_seconds: windowSeconds, p_limit: limit }) });
      if (!response.ok) throw new Error('rate limit store failed');
      return (await response.json()) === true;
    },
    /** One daily row; a repeat of the same day and install id is ignored. */
    async insert(row) {
      const response = await fetchImpl(`${base}/rest/v1/daily_usage?on_conflict=day,install_id`, { method: 'POST', headers: { ...headers, Prefer: 'resolution=ignore-duplicates,return=minimal' }, body: JSON.stringify(row) });
      if (!response.ok) throw new Error('usage store failed');
    },
    /** One feature rating (R4-61). There is no id to deduplicate on; the client asks at most once a week and the handler rate-limits. */
    async insertRating(row) {
      const response = await fetchImpl(`${base}/rest/v1/feature_ratings`, { method: 'POST', headers: { ...headers, Prefer: 'return=minimal' }, body: JSON.stringify(row) });
      if (!response.ok) throw new Error('rating store failed');
    },
    /** One Windows uninstall; a repeat of the same install id is ignored (the uninstaller sends once, but a retry must not fail). */
    async insertUninstall(row) {
      const response = await fetchImpl(`${base}/rest/v1/usage_uninstalls?on_conflict=install_id`, { method: 'POST', headers: { ...headers, Prefer: 'resolution=ignore-duplicates,return=minimal' }, body: JSON.stringify(row) });
      if (!response.ok) throw new Error('uninstall store failed');
    },
    /** Deploy health check: selects zero rows of the named columns. PostgREST answers 400 if the table or any column is missing, so this proves
     * the migrations ran, without reading or writing a single row. */
    async probe(table, columns) {
      if (!TABLES.includes(table) || !columns.every((column) => /^[a-z_]{1,40}$/.test(column))) return false;
      const response = await fetchImpl(`${base}/rest/v1/${table}?select=${columns.join(',')}&limit=0`, { method: 'GET', headers: { apikey: key, Authorization: `Bearer ${key}` } });
      return response.ok;
    },
  };
}
