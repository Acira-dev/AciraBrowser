-- Acira anonymous usage counts: unique installs and daily active installs, per platform and version (Beta 14, brief B9). See docs/SUPABASE_SETUP.md section 12.
-- Safe to run more than once, and after 20261113000000_usage_schema4.sql (it reads usage_daily_real and the schema-4 columns first_ever and is_returning).
-- Views only: no table, no column and no grant changes. Row level security stays ON with NO policies; every grant to public/anon/authenticated is revoked.
--
-- Beta 14 (the Insider build) sends to its own project, so in that project every row is an Insider install and these are Insider-only counts;
-- the public 13.x builds send to acira-usage and are never counted there.
--
-- What "unique install" means: one installation of Acira (its data folder), counted once, on its first message ever (first_ever = 'yes'). The app decides
-- first_ever from a mark in its data folder (desktop/browser-services/install-mark.cjs), so a relaunch, an update, a repair, a reinstall that keeps the data,
-- a second profile or sharing turned off and on again is never a second install. An install whose data was deleted on a computer that had Acira before
-- (is_returning = 'yes': the Windows uninstaller's marker, or the macOS preferences value) is counted apart as returning, not as a new one.
-- Only installs that share usage are seen at all.

-- Per UTC day, platform and version: daily active installs (one message per install per day), new unique installs and returning installs.
create or replace view public.usage_installs with (security_invoker = on) as
  select day, platform, app_version,
    count(*) as active_installs,
    count(*) filter (where first_ever = 'yes' and coalesce(is_returning, 'no') <> 'yes') as new_installs,
    count(*) filter (where first_ever = 'yes' and is_returning = 'yes') as returning_installs
  from public.usage_daily_real
  where schema_version = 4
  group by day, platform, app_version
  order by day desc, active_installs desc;

-- Totals since the first message, per platform and for all platforms together (platform = 'all'): unique installs, returning installs,
-- installs active today (UTC), and the days of the first install and of the latest message.
create or replace view public.usage_installs_total with (security_invoker = on) as
  select case when grouping(platform) = 1 then 'all' else platform end as platform,
    count(*) filter (where first_ever = 'yes' and coalesce(is_returning, 'no') <> 'yes') as unique_installs,
    count(*) filter (where first_ever = 'yes' and is_returning = 'yes') as returning_installs,
    count(*) filter (where day = current_date) as active_today,
    min(day) filter (where first_ever = 'yes') as first_install_day,
    max(day) as last_message_day
  from public.usage_daily_real
  where schema_version = 4
  group by grouping sets ((platform), ())
  order by grouping(platform) desc, platform;

revoke all on public.usage_installs, public.usage_installs_total from public, anon, authenticated;
