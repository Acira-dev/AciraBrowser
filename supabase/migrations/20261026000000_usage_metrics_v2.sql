-- Acira anonymous usage counts, schema 2: coarse choices and feature-use buckets. See docs/launch/METRICS.md.
-- Safe to run more than once, and after 20261025000000_usage_metrics.sql. Every new column is a short value from a CLOSED list (a check constraint),
-- so no URL, site, search term, name or free text can be stored even by a hand-made request. Rows from schema 1 keep NULL in the new columns.
-- Row level security, the missing policies and the revoked grants from the first migration are unchanged and apply to the new columns.

alter table public.daily_usage add column if not exists schema_version smallint not null default 1 check (schema_version in (1, 2));

alter table public.daily_usage add column if not exists theme text check (theme in ('light', 'dark', 'system'));
alter table public.daily_usage add column if not exists finish text check (finish in ('porcelain', 'burgundy', 'deep-blue', 'ocean-blue', 'iphone-blue', 'emerald-green', 'alpine-green', 'deep-purple', 'desert-titanium', 'natural-titanium', 'silver', 'black-titanium', 'custom', 'unknown'));
alter table public.daily_usage add column if not exists tab_layout text check (tab_layout in ('strip', 'sidebar', 'compact', 'dynamic', 'unknown'));
alter table public.daily_usage add column if not exists toolbar text check (toolbar in ('expanded', 'automatic', 'unknown'));
alter table public.daily_usage add column if not exists animation text check (animation in ('premium', 'fast', 'off', 'default', 'unknown'));
alter table public.daily_usage add column if not exists ui_language text check (ui_language in ('en', 'ar', 'de', 'es', 'fr', 'hi', 'it', 'ja', 'ko', 'pt-BR', 'ru', 'tr', 'zh-CN', 'other'));
alter table public.daily_usage add column if not exists search_engine text check (search_engine in ('google', 'duckduckgo', 'bing', 'ecosia', 'brave', 'kagi', 'startpage', 'qwant', 'yahoo', 'other'));
alter table public.daily_usage add column if not exists import_source text check (import_source in ('none', 'chrome', 'edge', 'firefox', 'brave', 'arc', 'opera', 'vivaldi', 'safari', 'html', 'other'));
alter table public.daily_usage add column if not exists ai_free text check (ai_free in ('on', 'off', 'unknown'));
alter table public.daily_usage add column if not exists vpn text check (vpn in ('on', 'off', 'unknown'));
alter table public.daily_usage add column if not exists vpn_app text check (vpn_app in ('none', 'Mullvad VPN', 'Proton VPN', 'IVPN', 'NordVPN', 'ExpressVPN', 'Surfshark', 'CyberGhost', 'Windscribe', 'Private Internet Access', 'Cloudflare WARP', 'Tailscale', 'TunnelBear', 'Hotspot Shield', 'OpenVPN', 'WireGuard', 'other'));
alter table public.daily_usage add column if not exists extensions text check (extensions in ('0', '1', '2-3', '4-6', '7+'));
alter table public.daily_usage add column if not exists profiles text check (profiles in ('1', '2', '3-4', '5+'));
alter table public.daily_usage add column if not exists site_protection_off text check (site_protection_off in ('0', '1', '2-5', '6+'));
alter table public.daily_usage add column if not exists use_tor_tabs text check (use_tor_tabs in ('0', '1', '2-5', '6-20', '21+'));
alter table public.daily_usage add column if not exists use_tor_windows text check (use_tor_windows in ('0', '1', '2-5', '6-20', '21+'));
alter table public.daily_usage add column if not exists use_private_tabs text check (use_private_tabs in ('0', '1', '2-5', '6-20', '21+'));
alter table public.daily_usage add column if not exists use_private_windows text check (use_private_windows in ('0', '1', '2-5', '6-20', '21+'));
alter table public.daily_usage add column if not exists use_split_view text check (use_split_view in ('0', '1', '2-5', '6-20', '21+'));
alter table public.daily_usage add column if not exists use_rewind text check (use_rewind in ('0', '1', '2-5', '6-20', '21+'));
alter table public.daily_usage add column if not exists use_tab_sets text check (use_tab_sets in ('0', '1', '2-5', '6-20', '21+'));
alter table public.daily_usage add column if not exists use_peek text check (use_peek in ('0', '1', '2-5', '6-20', '21+'));

-- Read-only summaries for people (SQL editor, dashboards). Not reachable from the public API keys.
create or replace view public.usage_choices with (security_invoker = on) as
  select day, theme, finish, tab_layout, toolbar, animation, ui_language, search_engine, ai_free, vpn, vpn_app, count(*) as installs
  from public.daily_usage where schema_version = 2 group by 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11;
create or replace view public.usage_feature_use with (security_invoker = on) as
  select day,
    count(*) as installs,
    count(*) filter (where use_tor_tabs <> '0') as tor_tabs,
    count(*) filter (where use_tor_windows <> '0') as tor_windows,
    count(*) filter (where use_private_tabs <> '0') as private_tabs,
    count(*) filter (where use_private_windows <> '0') as private_windows,
    count(*) filter (where use_split_view <> '0') as split_view,
    count(*) filter (where use_rewind <> '0') as rewind,
    count(*) filter (where use_tab_sets <> '0') as tab_sets,
    count(*) filter (where use_peek <> '0') as peek
  from public.daily_usage where schema_version = 2 group by day order by day desc;
revoke all on public.usage_choices, public.usage_feature_use from public, anon, authenticated;
