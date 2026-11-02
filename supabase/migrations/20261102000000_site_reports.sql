-- Acira site problem reports ("Report a problem with this site") and the reviewed allow-list. See docs/SUPABASE_SETUP.md.
-- Safe to run more than once. Row level security is ON for both tables and there are NO policies, so the public API keys
-- (anon, authenticated) can read and write nothing. Only the Edge Functions, using the service role, touch these tables:
-- `report` inserts reports, `allowlist` reads host names. The rate_limit table and rate_limit_hit() that `report` uses come from
-- 20261025000000_usage_metrics.sql, which runs first.

-- One row per report the person chose to send. The host is a public site name only (no path, query, port, IP address, local name or
-- .onion name: the same rule as validHost() in supabase/functions/report/handler.mjs). Kind and list are closed lists; the note is the
-- optional text the person typed, at most 500 characters. There is no address, user, install id or user agent column, so a report
-- cannot be tied to a person or to their other reports.
create table if not exists public.site_reports (
  id          bigint      generated always as identity primary key,
  created_at  timestamptz not null default now(),
  host        text        not null check (char_length(host) between 4 and 253 and host ~ '^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$' and host !~ '\.(onion|local|localhost|internal|lan|home|arpa|test|invalid|example)$'),
  kind        text        not null check (kind in ('blocked', 'broken', 'banner', 'other')),
  list        text        null check (list in ('phishing', 'malware', 'phishing-db', 'lookalike', 'ad-blocking', 'cookie-banners')),
  app_version text        not null check (char_length(app_version) <= 24 and app_version ~ '^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}([-.][0-9A-Za-z.]{1,16}){0,2}$'),
  platform    text        not null check (platform in ('darwin', 'win32', 'linux')),
  note        text        null check (char_length(note) between 1 and 500)
);
alter table public.site_reports enable row level security;
revoke all on table public.site_reports from public, anon, authenticated;
create index if not exists site_reports_created_at on public.site_reports (created_at);

-- Hosts the team checked and cleared after reviewing reports (for example a false positive in a threat feed). The `allowlist`
-- function serves the host names only, never the reason or the date; the app then stops blocking those hosts as a whole.
-- The team adds rows in the dashboard (Table editor > site_allowlist > Insert row) after reviewing reports, or in the SQL editor:
--   insert into public.site_allowlist (host, reason) values ('nflxvideo.net', 'Netflix video servers, Phishing.Database false positive, 2 Nov 2026') on conflict do nothing;
-- Delete the row to take a host off the list again. The app picks up a change within a day.
create table if not exists public.site_allowlist (
  host     text        primary key check (char_length(host) between 4 and 253 and host ~ '^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$' and host !~ '\.(onion|local|localhost|internal|lan|home|arpa|test|invalid|example)$'),
  reason   text        not null check (char_length(reason) between 1 and 500),
  added_at timestamptz not null default now()
);
alter table public.site_allowlist enable row level security;
revoke all on table public.site_allowlist from public, anon, authenticated;

-- Retention: reports older than 365 days are deleted. Allow-list rows stay until the team removes them.
create or replace function public.prune_site_reports()
returns void
language sql
set search_path = public
as $$
  delete from public.site_reports where created_at < now() - interval '365 days';
$$;
revoke all on function public.prune_site_reports() from public, anon, authenticated;
grant execute on function public.prune_site_reports() to service_role;

-- Schedule the prune nightly when the pg_cron extension is enabled (Database > Extensions). Skipped quietly otherwise; run prune_site_reports() by hand then.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'acira-prune-site-reports';
    perform cron.schedule('acira-prune-site-reports', '29 3 * * *', 'select public.prune_site_reports()');
  end if;
end $$;

-- Read-only summary for people reviewing reports (SQL editor, Table editor). Not reachable from the public API keys.
-- The notes themselves: select created_at, host, kind, list, note from public.site_reports where host = '...' order by created_at desc;
create or replace view public.site_reports_by_host with (security_invoker = on) as
  select host, kind, list, count(*) as reports, max(created_at) as last_report
  from public.site_reports
  where created_at > now() - interval '30 days'
  group by host, kind, list
  order by reports desc, host;
revoke all on public.site_reports_by_host from public, anon, authenticated;
