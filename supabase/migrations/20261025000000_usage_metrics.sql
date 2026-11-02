-- Acira anonymous usage counts (opt-in). See docs/launch/METRICS.md.
-- Safe to run more than once. Row level security is ON for both tables and there are NO policies, so the public API keys
-- (anon, authenticated) can read and write nothing. Only the Edge Function, using the service role, touches these tables.

create table if not exists public.daily_usage (
  day         date    not null,
  install_id  uuid    not null,
  app_version text    not null check (char_length(app_version) <= 24 and app_version ~ '^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}([-.][0-9A-Za-z.]{1,16}){0,2}$'),
  channel     text    not null check (channel in ('beta', 'stable')),
  platform    text    not null check (platform in ('win32', 'darwin', 'linux')),
  arch        text    not null check (arch in ('x64', 'arm64', 'ia32')),
  language    text    not null check (language ~ '^[a-z]{2}$'),
  primary key (day, install_id)
);
alter table public.daily_usage enable row level security;
revoke all on table public.daily_usage from public, anon, authenticated;

create table if not exists public.rate_limit (
  key          text        not null,
  window_start timestamptz not null,
  hits         integer     not null default 0,
  primary key (key, window_start)
);
alter table public.rate_limit enable row level security;
revoke all on table public.rate_limit from public, anon, authenticated;

-- Fixed-window counter. Returns true while the count for this key in the current window is within the limit.
-- Keys are built by the function from a salted daily hash of the address, never the address itself.
create or replace function public.rate_limit_hit(p_key text, p_window_seconds integer, p_limit integer)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  window_begin timestamptz;
  total integer;
begin
  if p_window_seconds is null or p_window_seconds <= 0 or p_limit is null or p_limit <= 0 or p_key is null or char_length(p_key) > 128 then
    raise exception 'bad rate limit arguments';
  end if;
  window_begin := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  insert into public.rate_limit as r (key, window_start, hits)
  values (p_key, window_begin, 1)
  on conflict (key, window_start) do update set hits = r.hits + 1
  returning r.hits into total;
  if random() < 0.01 then
    delete from public.rate_limit where window_start < now() - interval '2 days';
  end if;
  return total <= p_limit;
end;
$$;
revoke all on function public.rate_limit_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, integer, integer) to service_role;

-- Retention: rows older than 400 days are deleted.
create or replace function public.prune_usage()
returns void
language sql
set search_path = public
as $$
  delete from public.daily_usage where day < current_date - 400;
  delete from public.rate_limit where window_start < now() - interval '2 days';
$$;
revoke all on function public.prune_usage() from public, anon, authenticated;
grant execute on function public.prune_usage() to service_role;

-- Schedule the prune nightly when the pg_cron extension is enabled (Database > Extensions). Skipped quietly otherwise; run prune_usage() by hand then.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'acira-prune-usage';
    perform cron.schedule('acira-prune-usage', '17 3 * * *', 'select public.prune_usage()');
  end if;
end $$;

-- Read-only summaries for people (SQL editor, dashboards). They are not reachable from the public API keys.
create or replace view public.usage_daily_active with (security_invoker = on) as
  select day, count(*) as installs from public.daily_usage group by day order by day desc;
create or replace view public.usage_monthly_active with (security_invoker = on) as
  select date_trunc('month', day)::date as month, count(distinct install_id) as installs from public.daily_usage group by 1 order by 1 desc;
create or replace view public.usage_versions with (security_invoker = on) as
  select day, app_version, channel, platform, arch, language, count(*) as installs from public.daily_usage group by 1, 2, 3, 4, 5, 6;
revoke all on public.usage_daily_active, public.usage_monthly_active, public.usage_versions from public, anon, authenticated;
