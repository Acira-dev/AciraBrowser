// The `report` function's storage, through Supabase's own REST interface with the service role key that the platform puts in the
// function's environment (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY). Nothing here is a secret kept in the repository.
// `fetchImpl` is injectable so Node tests can check exactly what would be sent.
import { COLUMNS } from './handler.mjs';

export function restStore({ url, key, fetchImpl = fetch }) {
  if (!url || !key) throw new Error('Storage is not configured.');
  const base = String(url).replace(/\/+$/, '');
  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  return {
    /** Fixed-window counter in Postgres (public.rate_limit_hit, from the usage migration). True when this call is within the limit. */
    async hit(counter, windowSeconds, limit) {
      const response = await fetchImpl(`${base}/rest/v1/rpc/rate_limit_hit`, { method: 'POST', headers, body: JSON.stringify({ p_key: counter, p_window_seconds: windowSeconds, p_limit: limit }) });
      if (!response.ok) throw new Error('rate limit store failed');
      return (await response.json()) === true;
    },
    /** One report. The database adds id and created_at. */
    async insert(row) {
      const response = await fetchImpl(`${base}/rest/v1/site_reports`, { method: 'POST', headers: { ...headers, Prefer: 'return=minimal' }, body: JSON.stringify(row) });
      if (!response.ok) throw new Error('report store failed');
    },
    /** Deploy health check: selects zero rows of every site_reports column. PostgREST answers 400 if the table or any column is missing,
     * so this proves the migration ran, without reading or writing a single row. */
    async probe() {
      const response = await fetchImpl(`${base}/rest/v1/site_reports?select=${COLUMNS.join(',')}&limit=0`, { method: 'GET', headers: { apikey: key, Authorization: `Bearer ${key}` } });
      return response.ok;
    },
  };
}
