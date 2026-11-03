-- Acira anonymous usage counts: who stops using Acira (beta.9). See docs/launch/METRICS.md, "Who stops using Acira".
-- Safe to run more than once, and after the earlier migrations (20261025000000_usage_metrics.sql made daily_usage and rate_limit).
-- Two parts:
--  - Founder views over the daily messages that are already stored (every platform; nothing new is collected for them):
--    usage_gone_weekly and usage_retention.
--  - The Windows uninstall message (event "uninstall", schema 1): a table and its founder view usage_uninstalls_weekly.
-- Row level security stays ON with NO policies, and every grant to public/anon/authenticated is revoked, so the public API keys can read and
-- write nothing. Only the Edge Function (service role) writes; the founder reads the views in the SQL editor.
--
-- What "gone" means, honestly: an install is gone when its last daily message is 14 or more days old. That is a person who deleted Acira,
-- one who stopped opening it, or one who turned usage sharing off (or whose messages are held back, e.g. by a manual proxy). Turning sharing
-- on again makes a NEW random id, so the old id looks gone and a new install appears. Everything here counts installations, not people.
-- Only installs that share usage are seen at all.

-- 1. One row per install that was really uninstalled on Windows while usage sharing was on (packaging/acira-installer.nsh, never on an
--    update). The install id is the same random id as in daily_usage, so the founder views can match it to that install's first and last
--    daily message; a second message for the same id is ignored (primary key). No address, user agent, time of day or free text column.
create table if not exists public.usage_uninstalls (
  install_id  uuid not null primary key,
  day         date not null,
  app_version text not null check (char_length(app_version) <= 24 and app_version ~ '^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}([-.][0-9A-Za-z.]{1,16}){0,2}$'),
  platform    text not null check (platform in ('win32')),
  arch        text not null check (arch in ('x64', 'arm64', 'ia32'))
);
alter table public.usage_uninstalls enable row level security;
revoke all on table public.usage_uninstalls from public, anon, authenticated;
create index if not exists usage_uninstalls_day on public.usage_uninstalls (day);

-- The churn views read each install's messages in day order.
create index if not exists daily_usage_install_day on public.daily_usage (install_id, day);

-- 2. Retention: usage rows, ratings and uninstall rows older than 400 days are deleted (nightly via pg_cron when enabled, see the first
--    migration). An install first seen more than 400 days ago therefore shows up with a later first day.
create or replace function public.prune_usage()
returns void
language sql
set search_path = public
as $$
  delete from public.daily_usage where day < current_date - 400;
  delete from public.feature_ratings where day < current_date - 400;
  delete from public.usage_uninstalls where day < current_date - 400;
  delete from public.rate_limit where window_start < now() - interval '2 days';
$$;
revoke all on function public.prune_usage() from public, anon, authenticated;
grant execute on function public.prune_usage() to service_role;

-- 3. Gone, per week. For each ISO week W (starting Monday, UTC) and the platform, channel and app version of each install's LAST message
--    in W (so an install that updated during W counts once, under its newer version):
--    active_installs  installs that sent at least one daily message in W;
--    gone_installs    of those, the ones whose last message ever was in W and is 14+ days old (deleted, stopped using, or sharing off);
--    gone_pct         gone_installs as a share of active_installs;
--    uninstalled      of gone_installs, the ones that also sent the Windows uninstall message (always 0 on macOS and Linux);
--    settled          true once every install active in W has had 14 days to fall silent (W + 20 days <= today). Before that,
--                     gone_installs can still grow. An install that comes back after 14 days of silence stops counting as gone.
create or replace view public.usage_gone_weekly with (security_invoker = on) as
  with weekly as (
    select distinct on (install_id, date_trunc('week', day))
      install_id, date_trunc('week', day)::date as week, day, platform, channel, app_version
    from public.daily_usage
    order by install_id, date_trunc('week', day), day desc
  ), seen as (
    select install_id, max(day) as last_day from public.daily_usage group by install_id
  ), marked as (
    select w.week, w.platform, w.channel, w.app_version,
      (s.last_day = w.day and s.last_day <= current_date - 14) as gone,
      (u.install_id is not null) as uninstalled
    from weekly w
    join seen s using (install_id)
    left join public.usage_uninstalls u using (install_id)
  )
  select week, platform, channel, app_version,
    count(*) as active_installs,
    count(*) filter (where gone) as gone_installs,
    round(100.0 * count(*) filter (where gone) / count(*), 1) as gone_pct,
    count(*) filter (where gone and uninstalled) as uninstalled,
    (week + 20 <= current_date) as settled
  from marked
  group by week, platform, channel, app_version
  order by week desc, active_installs desc;

-- 4. Retention by cohort: installs grouped by the ISO week of their FIRST daily message (day 0), per platform (that of the first message)
--    and for all platforms together (platform = 'all').
--    installs         the cohort;
--    day_N_base       cohort installs at least N days old (first day + N <= today), the only ones that can be counted for day N;
--    day_N_still      of those, the ones that sent a message on day N or later (still using Acira after N days; one message a day at most,
--                     and only on days Acira is opened, so a quiet day in between does not count against it);
--    day_N_pct        day_N_still as a share of day_N_base (empty while day_N_base is 0);
--    gone, gone_pct   cohort installs whose last message is 14+ days old (see usage_gone_weekly for what that covers).
create or replace view public.usage_retention with (security_invoker = on) as
  with installs as (
    select install_id, date_trunc('week', min(day))::date as cohort_week, min(day) as first_day, max(day) as last_day,
      (array_agg(platform order by day))[1] as platform
    from public.daily_usage
    group by install_id
  )
  select cohort_week,
    case when grouping(platform) = 1 then 'all' else platform end as platform,
    count(*) as installs,
    count(*) filter (where first_day + 1 <= current_date) as day_1_base,
    count(*) filter (where first_day + 1 <= current_date and last_day >= first_day + 1) as day_1_still,
    round(100.0 * count(*) filter (where first_day + 1 <= current_date and last_day >= first_day + 1) / nullif(count(*) filter (where first_day + 1 <= current_date), 0), 1) as day_1_pct,
    count(*) filter (where first_day + 7 <= current_date) as day_7_base,
    count(*) filter (where first_day + 7 <= current_date and last_day >= first_day + 7) as day_7_still,
    round(100.0 * count(*) filter (where first_day + 7 <= current_date and last_day >= first_day + 7) / nullif(count(*) filter (where first_day + 7 <= current_date), 0), 1) as day_7_pct,
    count(*) filter (where first_day + 30 <= current_date) as day_30_base,
    count(*) filter (where first_day + 30 <= current_date and last_day >= first_day + 30) as day_30_still,
    round(100.0 * count(*) filter (where first_day + 30 <= current_date and last_day >= first_day + 30) / nullif(count(*) filter (where first_day + 30 <= current_date), 0), 1) as day_30_pct,
    count(*) filter (where last_day <= current_date - 14) as gone,
    round(100.0 * count(*) filter (where last_day <= current_date - 14) / count(*), 1) as gone_pct
  from installs
  group by grouping sets ((cohort_week), (cohort_week, platform))
  order by cohort_week desc, grouping(platform) desc, platform;

-- 5. Windows uninstalls per ISO week, exact (one message per real uninstall while sharing was on; never on an update), by the version and
--    processor type that were removed:
--    uninstalls           messages received;
--    median_days_kept     median days from the install's first daily message to the uninstall (empty when no daily message is stored);
--    came_back            installs that sent a daily message after the uninstall day: Acira was installed again and the person had kept
--                         their data (the same random id); these are not really gone.
create or replace view public.usage_uninstalls_weekly with (security_invoker = on) as
  with seen as (
    select install_id, min(day) as first_day, max(day) as last_day from public.daily_usage group by install_id
  )
  select date_trunc('week', u.day)::date as week, u.app_version, u.arch,
    count(*) as uninstalls,
    round((percentile_cont(0.5) within group (order by (u.day - s.first_day)))::numeric, 1) as median_days_kept,
    count(*) filter (where s.last_day > u.day) as came_back
  from public.usage_uninstalls u
  left join seen s using (install_id)
  group by 1, 2, 3
  order by 1 desc, 4 desc;

revoke all on public.usage_gone_weekly, public.usage_retention, public.usage_uninstalls_weekly from public, anon, authenticated;

-- 6. Let the REST layer see the new table now (the deploy health probe reads it right after this).
notify pgrst, 'reload schema';
