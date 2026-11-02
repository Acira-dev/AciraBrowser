-- Acira anonymous usage counts, schema 3 (R4-60), and feature ratings (R4-61). See docs/launch/METRICS.md and docs/SUPABASE_SETUP.md.
-- Safe to run more than once, and after 20261025000000_usage_metrics.sql and 20261026000000_usage_metrics_v2.sql.
-- Every new column is a short value from a CLOSED list (a check constraint), so no URL, site, search term, name, exact count or free text
-- can be stored even by a hand-made request. Every new column is nullable: rows from schema 1 and 2, and any fact a client leaves out, are NULL.
-- Row level security stays ON with NO policies, and every grant to public/anon/authenticated stays revoked; only the Edge Function (service role) writes.

-- 1. Schema 3 accepts schema_version 3, and the use buckets of schema 3 (0, 1-2, 3-9, 10+) next to those of schema 2 (0, 1, 2-5, 6-20, 21+).
--    The old column checks are found by column and replaced by named ones, so this works whatever Postgres called them.
do $$
declare c record;
begin
  for c in
    select distinct con.conname
    from pg_constraint con
    join pg_attribute att on att.attrelid = con.conrelid and att.attnum = any (con.conkey)
    where con.conrelid = 'public.daily_usage'::regclass and con.contype = 'c'
      and att.attname in ('schema_version', 'use_tor_tabs', 'use_tor_windows', 'use_private_tabs', 'use_private_windows', 'use_split_view', 'use_rewind', 'use_tab_sets', 'use_peek')
  loop
    execute format('alter table public.daily_usage drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.daily_usage add constraint daily_usage_schema_version_check check (schema_version in (1, 2, 3));
alter table public.daily_usage add constraint daily_usage_use_tor_tabs_check check (use_tor_tabs in ('0', '1-2', '3-9', '10+', '1', '2-5', '6-20', '21+'));
alter table public.daily_usage add constraint daily_usage_use_tor_windows_check check (use_tor_windows in ('0', '1-2', '3-9', '10+', '1', '2-5', '6-20', '21+'));
alter table public.daily_usage add constraint daily_usage_use_private_tabs_check check (use_private_tabs in ('0', '1-2', '3-9', '10+', '1', '2-5', '6-20', '21+'));
alter table public.daily_usage add constraint daily_usage_use_private_windows_check check (use_private_windows in ('0', '1-2', '3-9', '10+', '1', '2-5', '6-20', '21+'));
alter table public.daily_usage add constraint daily_usage_use_split_view_check check (use_split_view in ('0', '1-2', '3-9', '10+', '1', '2-5', '6-20', '21+'));
alter table public.daily_usage add constraint daily_usage_use_rewind_check check (use_rewind in ('0', '1-2', '3-9', '10+', '1', '2-5', '6-20', '21+'));
alter table public.daily_usage add constraint daily_usage_use_tab_sets_check check (use_tab_sets in ('0', '1-2', '3-9', '10+', '1', '2-5', '6-20', '21+'));
alter table public.daily_usage add constraint daily_usage_use_peek_check check (use_peek in ('0', '1-2', '3-9', '10+', '1', '2-5', '6-20', '21+'));

-- 2. The new schema-3 facts: how Acira is set up (closed lists) and which features are used (buckets).
alter table public.daily_usage add column if not exists window_view text check (window_view in ('full', 'compact', 'focus', 'seamless', 'unknown'));
alter table public.daily_usage add column if not exists interface_scale text check (interface_scale in ('80', '90', '100', '110', '125', '150', 'other'));
alter table public.daily_usage add column if not exists ad_blocking text check (ad_blocking in ('on', 'off', 'unknown'));
alter table public.daily_usage add column if not exists phishing_protection text check (phishing_protection in ('on', 'off', 'unknown'));
alter table public.daily_usage add column if not exists link_preview text check (link_preview in ('on', 'off', 'unknown'));
alter table public.daily_usage add column if not exists ask_before_closing text check (ask_before_closing in ('on', 'off', 'unknown'));
alter table public.daily_usage add column if not exists tab_sleep text check (tab_sleep in ('on', 'off', 'unknown'));
alter table public.daily_usage add column if not exists proxy text check (proxy in ('on', 'off', 'unknown'));
alter table public.daily_usage add column if not exists shortcuts_custom text check (shortcuts_custom in ('yes', 'no'));
alter table public.daily_usage add column if not exists passwords_imported text check (passwords_imported in ('yes', 'no'));
alter table public.daily_usage add column if not exists workspaces text check (workspaces in ('1', '2', '3-4', '5+'));
alter table public.daily_usage add column if not exists sign_back_in text check (sign_back_in in ('none', '0', '1-49', '50-99', '100'));
alter table public.daily_usage add column if not exists setup text check (setup in ('completed', 'skipped', 'unknown'));
alter table public.daily_usage add column if not exists tabs_open text check (tabs_open in ('1-5', '6-15', '16-40', '41-100', '101+'));
alter table public.daily_usage add column if not exists windows text check (windows in ('1', '2', '3-5', '6+'));
alter table public.daily_usage add column if not exists split_panes text check (split_panes in ('none', '2', '3', '4'));
alter table public.daily_usage add column if not exists use_seamless_reveals text check (use_seamless_reveals in ('0', '1-2', '3-9', '10+'));
alter table public.daily_usage add column if not exists use_workspace_switches text check (use_workspace_switches in ('0', '1-2', '3-9', '10+'));
alter table public.daily_usage add column if not exists use_tab_groups text check (use_tab_groups in ('0', '1-2', '3-9', '10+'));
alter table public.daily_usage add column if not exists use_vpn_toggles text check (use_vpn_toggles in ('0', '1-2', '3-9', '10+'));
alter table public.daily_usage add column if not exists use_media_controls text check (use_media_controls in ('0', '1-2', '3-9', '10+'));
alter table public.daily_usage add column if not exists use_command_bar text check (use_command_bar in ('0', '1-2', '3-9', '10+'));
alter table public.daily_usage add column if not exists use_protection_panel text check (use_protection_panel in ('0', '1-2', '3-9', '10+'));

-- 3. Feature ratings (R4-61): one row per answered rating card. No install id, no address, no free text: a feature from a closed list,
--    1 to 5 stars, the app version, the OS family and the UTC day.
create table if not exists public.feature_ratings (
  id          bigint   generated always as identity primary key,
  day         date     not null,
  feature     text     not null check (feature in ('splitView', 'windowViews', 'workspaces', 'peek', 'sidebarTabs', 'rewind', 'tabSets', 'adBlocking', 'signBackIn', 'newTabArtwork')),
  stars       smallint not null check (stars between 1 and 5),
  app_version text     not null check (char_length(app_version) <= 24 and app_version ~ '^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}([-.][0-9A-Za-z.]{1,16}){0,2}$'),
  platform    text     not null check (platform in ('win32', 'darwin', 'linux'))
);
alter table public.feature_ratings enable row level security;
revoke all on table public.feature_ratings from public, anon, authenticated;
revoke all on sequence public.feature_ratings_id_seq from public, anon, authenticated;
create index if not exists feature_ratings_day_feature on public.feature_ratings (day, feature);

-- 4. Retention: usage rows and ratings older than 400 days are deleted (nightly via pg_cron when enabled, see the first migration).
create or replace function public.prune_usage()
returns void
language sql
set search_path = public
as $$
  delete from public.daily_usage where day < current_date - 400;
  delete from public.feature_ratings where day < current_date - 400;
  delete from public.rate_limit where window_start < now() - interval '2 days';
$$;
revoke all on function public.prune_usage() from public, anon, authenticated;
grant execute on function public.prune_usage() to service_role;

-- 5. Read-only summaries for the founder (SQL editor, dashboards). Not reachable from the public API keys.
-- Feature adoption: per day, how many installs used each feature at least once.
create or replace view public.usage_feature_adoption with (security_invoker = on) as
  select day,
    count(*) as installs,
    count(*) filter (where use_split_view <> '0') as split_view,
    count(*) filter (where use_peek <> '0') as peek,
    count(*) filter (where use_seamless_reveals <> '0') as seamless_reveals,
    count(*) filter (where use_workspace_switches <> '0') as workspace_switches,
    count(*) filter (where use_tab_groups <> '0') as tab_groups,
    count(*) filter (where use_rewind <> '0') as rewind,
    count(*) filter (where use_tab_sets <> '0') as tab_sets,
    count(*) filter (where use_private_tabs <> '0') as private_tabs,
    count(*) filter (where use_private_windows <> '0') as private_windows,
    count(*) filter (where use_tor_tabs <> '0') as tor_tabs,
    count(*) filter (where use_tor_windows <> '0') as tor_windows,
    count(*) filter (where use_vpn_toggles <> '0') as vpn_toggles,
    count(*) filter (where use_media_controls <> '0') as media_controls,
    count(*) filter (where use_command_bar <> '0') as command_bar,
    count(*) filter (where use_protection_panel <> '0') as protection_panel
  from public.daily_usage where schema_version = 3 group by day order by day desc;

-- Feature intensity: per day, feature and bucket, how many installs (e.g. how many split view users open it 10+ times a day).
create or replace view public.usage_feature_intensity with (security_invoker = on) as
  select u.day, f.feature, f.bucket, count(*) as installs
  from public.daily_usage u
  cross join lateral (values
    ('split_view', u.use_split_view), ('peek', u.use_peek), ('seamless_reveals', u.use_seamless_reveals), ('workspace_switches', u.use_workspace_switches),
    ('tab_groups', u.use_tab_groups), ('rewind', u.use_rewind), ('tab_sets', u.use_tab_sets), ('private_tabs', u.use_private_tabs),
    ('private_windows', u.use_private_windows), ('tor_tabs', u.use_tor_tabs), ('tor_windows', u.use_tor_windows), ('vpn_toggles', u.use_vpn_toggles),
    ('media_controls', u.use_media_controls), ('command_bar', u.use_command_bar), ('protection_panel', u.use_protection_panel)
  ) as f(feature, bucket)
  where u.schema_version = 3 and f.bucket is not null
  group by 1, 2, 3;

-- Setting share: per day, every setting and value, how many installs and what share of that day's installs (modes, themes, protections...).
create or replace view public.usage_setting_share with (security_invoker = on) as
  select s.day, s.setting, s.value, count(*) as installs,
    round(100.0 * count(*) / sum(count(*)) over (partition by s.day, s.setting), 1) as share_pct
  from (
    select u.day, v.setting, v.value
    from public.daily_usage u
    cross join lateral (values
      ('theme', u.theme), ('finish', u.finish), ('window_view', u.window_view), ('tab_layout', u.tab_layout), ('toolbar', u.toolbar),
      ('animation', u.animation), ('interface_scale', u.interface_scale), ('ui_language', u.ui_language), ('search_engine', u.search_engine),
      ('ai_free', u.ai_free), ('ad_blocking', u.ad_blocking), ('phishing_protection', u.phishing_protection), ('link_preview', u.link_preview),
      ('ask_before_closing', u.ask_before_closing), ('tab_sleep', u.tab_sleep), ('proxy', u.proxy), ('vpn', u.vpn), ('vpn_app', u.vpn_app),
      ('shortcuts_custom', u.shortcuts_custom), ('extensions', u.extensions), ('profiles', u.profiles), ('site_protection_off', u.site_protection_off),
      ('workspaces', u.workspaces), ('import_source', u.import_source), ('passwords_imported', u.passwords_imported), ('sign_back_in', u.sign_back_in),
      ('setup', u.setup), ('tabs_open', u.tabs_open), ('windows', u.windows), ('split_panes', u.split_panes)
    ) as v(setting, value)
    where u.schema_version = 3 and v.value is not null
  ) s
  group by 1, 2, 3;

-- Modes share: the Window view and tab layout combinations people actually run, per day.
create or replace view public.usage_modes with (security_invoker = on) as
  select day, window_view, tab_layout, count(*) as installs,
    round(100.0 * count(*) / sum(count(*)) over (partition by day), 1) as share_pct
  from public.daily_usage where schema_version = 3 group by 1, 2, 3;

-- Ratings: average stars per feature per ISO week, with the spread.
create or replace view public.feature_ratings_weekly with (security_invoker = on) as
  select date_trunc('week', day)::date as week, feature, count(*) as ratings, round(avg(stars), 2) as average_stars,
    count(*) filter (where stars = 1) as one_star, count(*) filter (where stars = 2) as two_stars, count(*) filter (where stars = 3) as three_stars,
    count(*) filter (where stars = 4) as four_stars, count(*) filter (where stars = 5) as five_stars
  from public.feature_ratings group by 1, 2 order by 1 desc, 2;

revoke all on public.usage_feature_adoption, public.usage_feature_intensity, public.usage_setting_share, public.usage_modes, public.feature_ratings_weekly from public, anon, authenticated;

-- 6. Let the REST layer see the new columns and table now (the deploy health probe reads them right after this).
notify pgrst, 'reload schema';
