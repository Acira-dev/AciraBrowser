// The `allowlist` function's storage, through Supabase's own REST interface with the service role key that the platform puts in the
// function's environment (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY). Nothing here is a secret kept in the repository.
// `fetchImpl` is injectable so Node tests can check exactly what would be sent.
import { MAX_HOSTS } from './handler.mjs';

/** Rows read per request. Supabase caps one REST answer at the project's "Max rows" setting (1000 unless changed), so the list is read in
 * pages until a page comes back empty; that works whatever the setting is. */
export const PAGE = 1000;

export function restStore({ url, key, fetchImpl = fetch }) {
  if (!url || !key) throw new Error('Storage is not configured.');
  const base = String(url).replace(/\/+$/, '');
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  return {
    /** The host column of site_allowlist in host order, at most MAX_HOSTS + 1 rows (one more than is served). Never reason or added_at. */
    async hosts() {
      const hosts = [];
      while (hosts.length <= MAX_HOSTS) {
        const limit = Math.min(PAGE, MAX_HOSTS + 1 - hosts.length);
        const response = await fetchImpl(`${base}/rest/v1/site_allowlist?select=host&order=host.asc&limit=${limit}&offset=${hosts.length}`, { method: 'GET', headers });
        if (!response.ok) throw new Error('allow-list store failed');
        const rows = await response.json();
        if (!Array.isArray(rows)) throw new Error('allow-list store failed');
        if (!rows.length) break;
        for (const row of rows) hosts.push(row?.host);
      }
      return hosts;
    },
  };
}
