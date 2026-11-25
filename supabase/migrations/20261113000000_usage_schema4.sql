-- Acira anonymous usage counts, schema 4 (Beta 14, brief section B). See docs/launch/METRICS.md and docs/SUPABASE_SETUP.md.
-- NOT APPLIED: this migration is code in a branch. It is applied only with the team's go, through the team, never from a build session.
-- Safe to run more than once, and after 20261025000000_usage_metrics.sql, 20261026000000_usage_metrics_v2.sql, 20261027000000_usage_metrics_v3.sql and 20261103000000_usage_churn.sql.
-- Every new column is a short value from a CLOSED list, a bucket or a fixed format (a check constraint), so no URL, site, search term, name, exact count or free text
-- can be stored even by a hand-made request. Every new column is nullable: rows from schemas 1 to 3, and any fact a client leaves out, are NULL.
-- Row level security stays ON with NO policies, and every grant to public/anon/authenticated stays revoked; only the Edge Function (service role) writes.
--
-- What changes with schema 4:
--  - the install id is replaced on the device every 28 days (so nothing here follows an install for longer), and the first-of-day/week/month/ever flags, the install week
--    and the install day carry daily, weekly and monthly active installs, new installs and retention WITHOUT an id that lasts: see usage_active_flags and usage_retention_cohort;
--  - new message types: usage_off (sharing switched off: where, and how long Acira had been installed) and usage_surveys (an answer to one of our own questions), neither with an
--    install id; usage_uninstalls gets an optional one-tap reason;
--  - raw rows are kept 13 months at most (prune_usage); before they go, rollup_usage has counted every field and value per day into usage_rollup and usage_rollup_events,
--    which are kept for ever; the usage_public_* views show only groups of 5 or more installs (or events), so a small group is never shown;
--  - the id-based churn views (usage_gone_weekly, usage_retention, usage_uninstalls_weekly) only count schema 1 to 3 rows: an id that is replaced every 28 days can no longer say whether
--    an install is gone. They stay for the builds that still send schema 3.

-- 1. Schema 4 is a valid schema_version.
alter table public.daily_usage drop constraint if exists daily_usage_schema_version_check;
alter table public.daily_usage add constraint daily_usage_schema_version_check check (schema_version in (1, 2, 3, 4));

-- 2. Two helpers for the list columns. Both are immutable, so a check constraint can use them.
--    usage_set_ok: every element is on the closed list and none is repeated. usage_billboard_ok: at most 5 'card-id:state' pairs, each one of ours (see BILLBOARD_ID / BILLBOARD_STATES in the function).
create or replace function public.usage_set_ok(p_values text[], p_allowed text[])
returns boolean language sql immutable set search_path = public
as $$ select p_values is null or (p_values <@ p_allowed and cardinality(p_values) = (select count(distinct v) from unnest(p_values) as v)); $$;
create or replace function public.usage_billboard_ok(p_values text[])
returns boolean language sql immutable set search_path = public
as $$ select p_values is null or (cardinality(p_values) <= 5
  and not exists (select 1 from unnest(p_values) as v where v !~ '^[a-z0-9][a-z0-9.-]{2,63}:(shown|x|undo|cta|secondary|timeout)$')
  and cardinality(p_values) = (select count(distinct v) from unnest(p_values) as v)); $$;
revoke all on function public.usage_set_ok(text[], text[]), public.usage_billboard_ok(text[]) from public, anon, authenticated;

-- 3. The schema-4 facts: closed lists and buckets (38), the install week, the version the app updated from, two sets of feature names, the billboard measurement,
--    and more feature-use buckets (0, 1-2, 3-9, 10+): 18 not counted before and Beta 14's own features (B8), then Beta 14's own settings. A schema-4 message no longer
--    carries `toolbar` (windowView says the same), `use_media_controls` (now use_now_playing_card_actions), picture-in-picture as one count, link preview opens or undo-close:
--    the columns of schemas 2 and 3 stay for the messages of older builds.
alter table public.daily_usage add column if not exists first_today text check (first_today in ('yes', 'no'));
alter table public.daily_usage add column if not exists first_this_week text check (first_this_week in ('yes', 'no'));
alter table public.daily_usage add column if not exists first_this_month text check (first_this_month in ('yes', 'no'));
alter table public.daily_usage add column if not exists first_ever text check (first_ever in ('yes', 'no'));
-- B9: 'yes' only in an install's first message, when its data folder was wiped on a computer that had Acira (`returning` in the message; `returning` is a reserved word in SQL, so the column is is_returning).
alter table public.daily_usage add column if not exists is_returning text check (is_returning in ('yes', 'no'));
alter table public.daily_usage add column if not exists install_day text check (install_day in ('0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20', '21', '22', '23', '24', '25', '26', '27', '28', '29'));
alter table public.daily_usage add column if not exists minutes_active text check (minutes_active in ('0-5', '5-30', '30-120', '120+'));
alter table public.daily_usage add column if not exists sessions text check (sessions in ('1', '2-3', '4-9', '10+'));
alter table public.daily_usage add column if not exists pages_loaded text check (pages_loaded in ('0', '1-10', '11-50', '51-200', '200+'));
alter table public.daily_usage add column if not exists days_since_install text check (days_since_install in ('0', '1', '2-3', '4-7', '8-14', '15-28', '29+'));
alter table public.daily_usage add column if not exists searches_google text check (searches_google in ('0', '1-5', '6-20', '20+'));
alter table public.daily_usage add column if not exists searches_duckduckgo text check (searches_duckduckgo in ('0', '1-5', '6-20', '20+'));
alter table public.daily_usage add column if not exists searches_bing text check (searches_bing in ('0', '1-5', '6-20', '20+'));
alter table public.daily_usage add column if not exists searches_ecosia text check (searches_ecosia in ('0', '1-5', '6-20', '20+'));
alter table public.daily_usage add column if not exists searches_brave text check (searches_brave in ('0', '1-5', '6-20', '20+'));
alter table public.daily_usage add column if not exists searches_kagi text check (searches_kagi in ('0', '1-5', '6-20', '20+'));
alter table public.daily_usage add column if not exists searches_startpage text check (searches_startpage in ('0', '1-5', '6-20', '20+'));
alter table public.daily_usage add column if not exists searches_qwant text check (searches_qwant in ('0', '1-5', '6-20', '20+'));
alter table public.daily_usage add column if not exists searches_yahoo text check (searches_yahoo in ('0', '1-5', '6-20', '20+'));
alter table public.daily_usage add column if not exists searches_other text check (searches_other in ('0', '1-5', '6-20', '20+'));
alter table public.daily_usage add column if not exists default_browser text check (default_browser in ('yes', 'no', 'unknown'));
alter table public.daily_usage add column if not exists pinned_to_taskbar text check (pinned_to_taskbar in ('yes', 'no', 'unknown'));
alter table public.daily_usage add column if not exists in_dock text check (in_dock in ('yes', 'no', 'unknown'));
alter table public.daily_usage add column if not exists opened_at_startup text check (opened_at_startup in ('yes', 'no', 'unknown'));
alter table public.daily_usage add column if not exists settings_section text check (settings_section in ('none', 'appearance', 'profiles', 'tabs', 'new-tab', 'search', 'privacy', 'connection', 'accessibility', 'import-export', 'about'));
alter table public.daily_usage add column if not exists cold_start_ms text check (cold_start_ms in ('<1s', '1-2s', '2-4s', '4-8s', '8s+'));
alter table public.daily_usage add column if not exists crashes text check (crashes in ('0', '1', '2-4', '5+'));
alter table public.daily_usage add column if not exists update_result text check (update_result in ('ok', 'failed', 'rolledBack', 'none'));
alter table public.daily_usage add column if not exists memory_peak text check (memory_peak in ('<1GB', '1-2GB', '2-4GB', '4GB+'));
alter table public.daily_usage add column if not exists gpu_accel text check (gpu_accel in ('yes', 'no', 'unknown'));
alter table public.daily_usage add column if not exists os_version text check (os_version in ('win10', 'win11', 'win-other', 'mac-11', 'mac-12', 'mac-13', 'mac-14', 'mac-15', 'mac-26', 'mac-27', 'mac-28', 'mac-other', 'linux', 'other'));
alter table public.daily_usage add column if not exists display_scale text check (display_scale in ('100', '125', '150', '175', '200', 'other'));
alter table public.daily_usage add column if not exists monitors text check (monitors in ('1', '2', '3+'));
alter table public.daily_usage add column if not exists trackers_blocked text check (trackers_blocked in ('0', '1-99', '100-999', '1000-9999', '10000+'));
alter table public.daily_usage add column if not exists filter_lists_updated text check (filter_lists_updated in ('yes', 'no', 'unknown'));
alter table public.daily_usage add column if not exists setup_path text check (setup_path in ('completed', 'defaults', 'skipped', 'abandoned'));
alter table public.daily_usage add column if not exists setup_step_reached text check (setup_step_reached in ('welcome', 'import', 'profile', 'appearance', 'cover', 'search', 'privacy', 'default', 'finish'));
alter table public.daily_usage add column if not exists setup_seconds text check (setup_seconds in ('<30s', '30-60s', '60-120s', '120-300s', '300s+'));
alter table public.daily_usage add column if not exists notice_seen text check (notice_seen in ('x', 'link', 'timeout', 'undoneThenX', 'none'));
alter table public.daily_usage add column if not exists install_week text check (install_week ~ '^20[2-9][0-9]-W(0[1-9]|[1-4][0-9]|5[0-3])$');
alter table public.daily_usage add column if not exists update_from text check (char_length(update_from) <= 24 and update_from ~ '^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}([-.][0-9A-Za-z.]{1,16}){0,2}$');
alter table public.daily_usage add column if not exists ever_used text[] check (public.usage_set_ok(ever_used, array['torTabs', 'torWindows', 'privateTabs', 'privateWindows', 'splitView', 'rewind', 'tabSets', 'peek', 'seamlessReveals', 'workspaceSwitches', 'tabGroups', 'vpnToggles', 'commandBar', 'protectionPanel', 'downloads', 'bookmarksAdded', 'bookmarksOpened', 'historyOpened', 'findInPage', 'zoomChanges', 'passwordSaves', 'passwordFills', 'extensionInstalls', 'extensionPopupOpens', 'importAttempted', 'importCompleted', 'settingsOpened', 'shortcutsEditorOpened', 'newTabPageActions', 'fullscreen', 'printOrSavePdf', 'siteProtectionToggles', 'nowPlayingCardActions', 'pictureInPictureManual', 'pictureInPictureAutomatic', 'favoritesStackOpens', 'layoutPickerOpened', 'groupNested', 'groupReordered', 'tabSwitcherOpens', 'tabViewerOpens', 'bookmarksPopupOpens', 'extensionOverflowOpens', 'sidePanelOpens', 'pinnedTabSlept', 'screenshotsArea', 'screenshotsVisible', 'screenshotsFull', 'zapUsed', 'zapRestored', 'easyFilesShown', 'easyFilesPickedClipboard', 'easyFilesPickedScreenshot', 'easyFilesPickedDownload', 'easyFilesPickedBrowse', 'imageSearchesGoogle', 'imageSearchesTineye', 'imageSearchesYandex', 'imageSearchesBing', 'imageSearchesCustom', 'searchSuggestionPicked', 'devtoolsOpenedRight', 'devtoolsOpenedBottom', 'devtoolsOpenedWindow', 'feedbackSent', 'insiderSheetShown', 'insiderActivated', 'insiderDeclined', 'insiderCodeOk', 'insiderCodeInvalid', 'insiderCodeUsed', 'insiderCodeExpired', 'insiderCodeRevoked', 'insiderCodeRateLimited', 'insiderCodeOffline', 'insiderInviteCreated', 'insiderInviteCopied', 'insiderMoveCodeMade', 'insiderChannelOn', 'insiderChannelOff', 'insiderSealCloser', 'insiderCardOpened', 'insiderCardShared']));
alter table public.daily_usage add column if not exists used_in_first3_days text[] check (public.usage_set_ok(used_in_first3_days, array['torTabs', 'torWindows', 'privateTabs', 'privateWindows', 'splitView', 'rewind', 'tabSets', 'peek', 'seamlessReveals', 'workspaceSwitches', 'tabGroups', 'vpnToggles', 'commandBar', 'protectionPanel', 'downloads', 'bookmarksAdded', 'bookmarksOpened', 'historyOpened', 'findInPage', 'zoomChanges', 'passwordSaves', 'passwordFills', 'extensionInstalls', 'extensionPopupOpens', 'importAttempted', 'importCompleted', 'settingsOpened', 'shortcutsEditorOpened', 'newTabPageActions', 'fullscreen', 'printOrSavePdf', 'siteProtectionToggles', 'nowPlayingCardActions', 'pictureInPictureManual', 'pictureInPictureAutomatic', 'favoritesStackOpens', 'layoutPickerOpened', 'groupNested', 'groupReordered', 'tabSwitcherOpens', 'tabViewerOpens', 'bookmarksPopupOpens', 'extensionOverflowOpens', 'sidePanelOpens', 'pinnedTabSlept', 'screenshotsArea', 'screenshotsVisible', 'screenshotsFull', 'zapUsed', 'zapRestored', 'easyFilesShown', 'easyFilesPickedClipboard', 'easyFilesPickedScreenshot', 'easyFilesPickedDownload', 'easyFilesPickedBrowse', 'imageSearchesGoogle', 'imageSearchesTineye', 'imageSearchesYandex', 'imageSearchesBing', 'imageSearchesCustom', 'searchSuggestionPicked', 'devtoolsOpenedRight', 'devtoolsOpenedBottom', 'devtoolsOpenedWindow', 'feedbackSent', 'insiderSheetShown', 'insiderActivated', 'insiderDeclined', 'insiderCodeOk', 'insiderCodeInvalid', 'insiderCodeUsed', 'insiderCodeExpired', 'insiderCodeRevoked', 'insiderCodeRateLimited', 'insiderCodeOffline', 'insiderInviteCreated', 'insiderInviteCopied', 'insiderMoveCodeMade', 'insiderChannelOn', 'insiderChannelOff', 'insiderSealCloser', 'insiderCardOpened', 'insiderCardShared']));
alter table public.daily_usage add column if not exists billboard text[] check (public.usage_billboard_ok(billboard));
alter table public.daily_usage add column if not exists use_downloads text check (use_downloads in ('0', '1-2', '3-9', '10+'));
alter table public.daily_usage add column if not exists use_bookmarks_added text check (use_bookmarks_added in ('0', '1-2', '3-9', '10+'));
alter table public.daily_usage add column if not exists use_bookmarks_opened text check (use_bookmarks_opened in ('0', '1-2', '3-9', '10+'));
alter table public.daily_usage add column if not exists use_history_opened text check (use_history_opened in ('0', '1-2', '3-9', '10+'));
alter table public.daily_usage add column if not exists use_find_in_page text check (use_find_in_page in ('0', '1-2', '3-9', '10+'));
alter table public.daily_usage add column if not exists use_zoom_changes text check (use_zoom_changes in ('0', '1-2', '3-9', '10+'));
alter table public.daily_usage add column if not exists use_password_saves text check (use_password_saves in ('0', '1-2', '3-9', '10+'));
alter table public.daily_usage add column if not exists use_password_fills text check (use_password_fills in ('0', '1-2', '3-9', '10+'));
alter table public.daily_usage add column if not exists use_extension_installs text check (use_extension_installs in ('0', '1-2', '3-9', '10+'));
alter table public.daily_usage add column if not exists use_extension_popup_opens text check (use_extension_popup_opens in ('0', '1-2', '3-9', '10+'));
alter table public.daily_usage add column if not exists use_import_attempted text check (use_import_attempted in ('0', '1-2', '3-9', '10+'));
alter table public.daily_usage add column if not exists use_import_completed text check (use_import_completed in ('0', '1-2', '3-9', '10+'));
alter table public.daily_usage add column if not exists use_settings_opened text check (use_settings_opened in ('0', '1-2', '3-9', '10+'));
alter table public.daily_usage add column if not exists use_shortcuts_editor_opened text check (use_shortcuts_editor_opened in ('0', '1-2', '3-9', '10+'));
alter table public.daily_usage add column if not exists use_new_tab_page_actions text check (use_new_tab_page_actions in ('0', '1-2', '3-9', '10+'));
alter table public.daily_usage add column if not exists use_fullscreen text check (use_fullscreen in ('0', '1-2', '3-9', '10+'));
alter table public.daily_usage add column if not exists use_print_or_save_pdf text check (use_print_or_save_pdf in ('0', '1-2', '3-9', '10+'));
alter table public.daily_usage add column if not exists use_site_protection_toggles text check (use_site_protection_toggles in ('0', '1-2', '3-9', '10+'));
-- Beta 14's own features (B8): more use buckets, then Beta 14's own settings (closed lists).
alter table public.daily_usage add column if not exists use_now_playing_card_actions text check (use_now_playing_card_actions in ('0', '1-2', '3-9', '10+'));
alter table public.daily_usage add column if not exists use_picture_in_picture_manual text check (use_picture_in_picture_manual in ('0', '1-2', '3-9', '10+'));
alter table public.daily_usage add column if not exists use_picture_in_picture_automatic text check (use_picture_in_picture_automatic in ('0', '1-2', '3-9', '10+'));
alter table public.daily_usage add column if not exists use_favorites_stack_opens text check (use_favorites_stack_opens in ('0', '1-2', '3-9', '10+'));
alter table public.daily_usage add column if not exists use_layout_picker_opened text check (use_layout_picker_opened in ('0', '1-2', '3-9', '10+'));
alter table public.daily_usage add column if not exists use_group_nested text check (use_group_nested in ('0', '1-2', '3-9', '10+'));
alter table public.daily_usage add column if not exists use_group_reordered text check (use_group_reordered in ('0', '1-2', '3-9', '10+'));
alter table public.daily_usage add column if not exists use_tab_switcher_opens text check (use_tab_switcher_opens in ('0', '1-2', '3-9', '10+'));
alter table public.daily_usage add column if not exists use_tab_viewer_opens text check (use_tab_viewer_opens in ('0', '1-2', '3-9', '10+'));
alter table public.daily_usage add column if not exists use_bookmarks_popup_opens text check (use_bookmarks_popup_opens in ('0', '1-2', '3-9', '10+'));
alter table public.daily_usage add column if not exists use_extension_overflow_opens text check (use_extension_overflow_opens in ('0', '1-2', '3-9', '10+'));
alter table public.daily_usage add column if not exists use_side_panel_opens text check (use_side_panel_opens in ('0', '1-2', '3-9', '10+'));
alter table public.daily_usage add column if not exists use_pinned_tab_slept text check (use_pinned_tab_slept in ('0', '1-2', '3-9', '10+'));
alter table public.daily_usage add column if not exists use_screenshots_area text check (use_screenshots_area in ('0', '1-2', '3-9', '10+'));
alter table public.daily_usage add column if not exists use_screenshots_visible text check (use_screenshots_visible in ('0', '1-2', '3-9', '10+'));
alter table public.daily_usage add column if not exists use_screenshots_full text check (use_screenshots_full in ('0', '1-2', '3-9', '10+'));
alter table public.daily_usage add column if not exists use_zap_used text check (use_zap_used in ('0', '1-2', '3-9', '10+'));
alter table public.daily_usage add column if not exists use_zap_restored text check (use_zap_restored in ('0', '1-2', '3-9', '10+'));
alter table public.daily_usage add column if not exists use_easy_files_shown text check (use_easy_files_shown in ('0', '1-2', '3-9', '10+'));
alter table public.daily_usage add column if not exists use_easy_files_picked_clipboard text check (use_easy_files_picked_clipboard in ('0', '1-2', '3-9', '10+'));
alter table public.daily_usage add column if not exists use_easy_files_picked_screenshot text check (use_easy_files_picked_screenshot in ('0', '1-2', '3-9', '10+'));
alter table public.daily_usage add column if not exists use_easy_files_picked_download text check (use_easy_files_picked_download in ('0', '1-2', '3-9', '10+'));
alter table public.daily_usage add column if not exists use_easy_files_picked_browse text check (use_easy_files_picked_browse in ('0', '1-2', '3-9', '10+'));
alter table public.daily_usage add column if not exists use_image_searches_google text check (use_image_searches_google in ('0', '1-2', '3-9', '10+'));
alter table public.daily_usage add column if not exists use_image_searches_tineye text check (use_image_searches_tineye in ('0', '1-2', '3-9', '10+'));
alter table public.daily_usage add column if not exists use_image_searches_yandex text check (use_image_searches_yandex in ('0', '1-2', '3-9', '10+'));
alter table public.daily_usage add column if not exists use_image_searches_bing text check (use_image_searches_bing in ('0', '1-2', '3-9', '10+'));
alter table public.daily_usage add column if not exists use_image_searches_custom text check (use_image_searches_custom in ('0', '1-2', '3-9', '10+'));
alter table public.daily_usage add column if not exists use_search_suggestion_picked text check (use_search_suggestion_picked in ('0', '1-2', '3-9', '10+'));
alter table public.daily_usage add column if not exists use_devtools_opened_right text check (use_devtools_opened_right in ('0', '1-2', '3-9', '10+'));
alter table public.daily_usage add column if not exists use_devtools_opened_bottom text check (use_devtools_opened_bottom in ('0', '1-2', '3-9', '10+'));
alter table public.daily_usage add column if not exists use_devtools_opened_window text check (use_devtools_opened_window in ('0', '1-2', '3-9', '10+'));
alter table public.daily_usage add column if not exists use_feedback_sent text check (use_feedback_sent in ('0', '1-2', '3-9', '10+'));
alter table public.daily_usage add column if not exists use_insider_sheet_shown text check (use_insider_sheet_shown in ('0', '1-2', '3-9', '10+'));
alter table public.daily_usage add column if not exists use_insider_activated text check (use_insider_activated in ('0', '1-2', '3-9', '10+'));
alter table public.daily_usage add column if not exists use_insider_declined text check (use_insider_declined in ('0', '1-2', '3-9', '10+'));
alter table public.daily_usage add column if not exists use_insider_code_ok text check (use_insider_code_ok in ('0', '1-2', '3-9', '10+'));
alter table public.daily_usage add column if not exists use_insider_code_invalid text check (use_insider_code_invalid in ('0', '1-2', '3-9', '10+'));
alter table public.daily_usage add column if not exists use_insider_code_used text check (use_insider_code_used in ('0', '1-2', '3-9', '10+'));
alter table public.daily_usage add column if not exists use_insider_code_expired text check (use_insider_code_expired in ('0', '1-2', '3-9', '10+'));
alter table public.daily_usage add column if not exists use_insider_code_revoked text check (use_insider_code_revoked in ('0', '1-2', '3-9', '10+'));
alter table public.daily_usage add column if not exists use_insider_code_rate_limited text check (use_insider_code_rate_limited in ('0', '1-2', '3-9', '10+'));
alter table public.daily_usage add column if not exists use_insider_code_offline text check (use_insider_code_offline in ('0', '1-2', '3-9', '10+'));
alter table public.daily_usage add column if not exists use_insider_invite_created text check (use_insider_invite_created in ('0', '1-2', '3-9', '10+'));
alter table public.daily_usage add column if not exists use_insider_invite_copied text check (use_insider_invite_copied in ('0', '1-2', '3-9', '10+'));
alter table public.daily_usage add column if not exists use_insider_move_code_made text check (use_insider_move_code_made in ('0', '1-2', '3-9', '10+'));
alter table public.daily_usage add column if not exists use_insider_channel_on text check (use_insider_channel_on in ('0', '1-2', '3-9', '10+'));
alter table public.daily_usage add column if not exists use_insider_channel_off text check (use_insider_channel_off in ('0', '1-2', '3-9', '10+'));
alter table public.daily_usage add column if not exists use_insider_seal_closer text check (use_insider_seal_closer in ('0', '1-2', '3-9', '10+'));
alter table public.daily_usage add column if not exists use_insider_card_opened text check (use_insider_card_opened in ('0', '1-2', '3-9', '10+'));
alter table public.daily_usage add column if not exists use_insider_card_shared text check (use_insider_card_shared in ('0', '1-2', '3-9', '10+'));
alter table public.daily_usage add column if not exists active_border_style text check (active_border_style in ('divider-fade', 'lit-edge', 'hairline', 'inner-light', 'plain', 'unknown'));
alter table public.daily_usage add column if not exists ambient_mode text check (ambient_mode in ('on', 'off', 'unknown'));
alter table public.daily_usage add column if not exists favorites_tile_only text check (favorites_tile_only in ('on', 'off', 'unknown'));
alter table public.daily_usage add column if not exists favorites_before_stack text check (favorites_before_stack in ('6', '9', '12', '16', '20', 'all', 'unknown'));
alter table public.daily_usage add column if not exists ctrl_tab_mode text check (ctrl_tab_mode in ('next', 'recent', 'viewer', 'unknown'));
alter table public.daily_usage add column if not exists tab_switcher_pictures text check (tab_switcher_pictures in ('on', 'off', 'unknown'));
alter table public.daily_usage add column if not exists hidden_sidebar_reveal text check (hidden_sidebar_reveal in ('edge', 'handle', 'never', 'unknown'));
alter table public.daily_usage add column if not exists load_ahead text check (load_ahead in ('nothing', 'pinned', 'recent', 'unknown'));
alter table public.daily_usage add column if not exists search_suggestions text check (search_suggestions in ('off', 'engine', 'service', 'custom', 'unknown'));
alter table public.daily_usage add column if not exists image_search_service text check (image_search_service in ('none', 'ask', 'google', 'tineye', 'yandex', 'bing', 'custom', 'unknown'));
alter table public.daily_usage add column if not exists auto_picture_in_picture text check (auto_picture_in_picture in ('on', 'off', 'unknown'));
alter table public.daily_usage add column if not exists easy_files text check (easy_files in ('on', 'off', 'unknown'));
alter table public.daily_usage add column if not exists screenshot_button text check (screenshot_button in ('off', 'sidebar', 'topbar', 'unknown'));
alter table public.daily_usage add column if not exists new_tab_picture_set text check (new_tab_picture_set in ('all', 'picks', 'unknown'));
-- A closed list that grew: tab_layout gained 'shelf', import_source gained 'zen' (the column checks of schema 2 are replaced).
alter table public.daily_usage drop constraint if exists daily_usage_tab_layout_check;
alter table public.daily_usage add constraint daily_usage_tab_layout_check check (tab_layout in ('strip', 'sidebar', 'shelf', 'compact', 'dynamic', 'unknown'));
alter table public.daily_usage drop constraint if exists daily_usage_import_source_check;
alter table public.daily_usage add constraint daily_usage_import_source_check check (import_source in ('none', 'chrome', 'edge', 'firefox', 'brave', 'arc', 'opera', 'vivaldi', 'zen', 'safari', 'html', 'other'));

-- 4. Messages that carry no install id.
--    usage_off: sharing was switched off. Where it happened and how long Acira had been installed (a bucket); no id, so it can never be tied to a daily row.
create table if not exists public.usage_off (
  id                 bigint   generated always as identity primary key,
  day                date     not null,
  off_where          text     not null check (off_where in ('setup', 'settings', 'uninstaller', 'notice')),
  days_since_install text     check (days_since_install in ('0', '1', '2-3', '4-7', '8-14', '15-28', '29+')),
  app_version        text     not null check (char_length(app_version) <= 24 and app_version ~ '^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}([-.][0-9A-Za-z.]{1,16}){0,2}$'),
  platform           text     not null check (platform in ('win32', 'darwin', 'linux'))
);
alter table public.usage_off enable row level security;
revoke all on table public.usage_off from public, anon, authenticated;
revoke all on sequence public.usage_off_id_seq from public, anon, authenticated;
create index if not exists usage_off_day on public.usage_off (day);

--    usage_surveys: an answer to one of our own in-app questions. The question is an id we wrote, the answer one of a closed list. No id, no text.
create table if not exists public.usage_surveys (
  id          bigint   generated always as identity primary key,
  day         date     not null,
  survey      text     not null check (survey ~ '^[a-z0-9][a-z0-9-]{2,31}$'),
  answer      text     not null check (answer in ('1', '2', '3', '4', '5', 'yes', 'no', 'a', 'b', 'c', 'd', 'e', 'skip')),
  app_version text     not null check (char_length(app_version) <= 24 and app_version ~ '^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}([-.][0-9A-Za-z.]{1,16}){0,2}$'),
  platform    text     not null check (platform in ('win32', 'darwin', 'linux'))
);
alter table public.usage_surveys enable row level security;
revoke all on table public.usage_surveys from public, anon, authenticated;
revoke all on sequence public.usage_surveys_id_seq from public, anon, authenticated;
create index if not exists usage_surveys_day on public.usage_surveys (day, survey);

--    The Windows uninstall message gets an optional one-tap reason (a closed list).
alter table public.usage_uninstalls add column if not exists reason text check (reason in ('slow', 'crashes', 'missing-feature', 'not-clear', 'switched-back', 'just-trying', 'other'));

-- 4b. Real releases only (brief B9: accurate counts). The function already drops a message whose version is not a release (1.2.3, 1.2.3-beta.14, 1.2.3-beta.13.8), whose channel is not beta or stable, or whose day is
--     more than 2 days from the server's date; a daily message is unique on (day, install id), so a second one the same day changes nothing (primary key + ignore-duplicates). These checks say the same in the database,
--     for every table that has a version, and apply to new rows only (NOT VALID: nothing already stored is touched). usage_daily_real is what every the team view, the roll-up and the public views read.
alter table public.daily_usage drop constraint if exists daily_usage_release_check;
alter table public.daily_usage add constraint daily_usage_release_check check (channel in ('beta', 'stable') and app_version ~ '^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}(-beta\.[0-9]{1,3}(\.[0-9]{1,3})?)?$') not valid;
alter table public.feature_ratings drop constraint if exists feature_ratings_release_check;
alter table public.feature_ratings add constraint feature_ratings_release_check check (app_version ~ '^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}(-beta\.[0-9]{1,3}(\.[0-9]{1,3})?)?$') not valid;
alter table public.usage_uninstalls drop constraint if exists usage_uninstalls_release_check;
alter table public.usage_uninstalls add constraint usage_uninstalls_release_check check (app_version ~ '^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}(-beta\.[0-9]{1,3}(\.[0-9]{1,3})?)?$') not valid;
alter table public.usage_off drop constraint if exists usage_off_release_check;
alter table public.usage_off add constraint usage_off_release_check check (app_version ~ '^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}(-beta\.[0-9]{1,3}(\.[0-9]{1,3})?)?$') not valid;
alter table public.usage_surveys drop constraint if exists usage_surveys_release_check;
alter table public.usage_surveys add constraint usage_surveys_release_check check (app_version ~ '^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}(-beta\.[0-9]{1,3}(\.[0-9]{1,3})?)?$') not valid;
create or replace view public.usage_daily_real with (security_invoker = on) as
  select * from public.daily_usage where channel in ('beta', 'stable') and app_version ~ '^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}(-beta\.[0-9]{1,3}(\.[0-9]{1,3})?)?$';
revoke all on public.usage_daily_real from public, anon, authenticated;

-- 5. Aggregates that are kept for ever. rollup_usage counts, per day, every field and value of the daily messages and of the other message types, so a day can be read long after
--    its raw rows are gone. Nothing in them says which install a row came from. Single-field counts only (a field, a value, how many installs), never a combination of two.
create table if not exists public.usage_rollup (
  day      date    not null,
  field    text    not null check (char_length(field) <= 60),
  value    text    not null check (char_length(value) <= 80),
  installs integer not null check (installs > 0),
  primary key (day, field, value)
);
create table if not exists public.usage_rollup_events (
  day    date    not null,
  event  text    not null check (event in ('off', 'rating', 'survey', 'uninstall')),
  field  text    not null check (char_length(field) <= 60),
  value  text    not null check (char_length(value) <= 80),
  events integer not null check (events > 0),
  primary key (day, event, field, value)
);
alter table public.usage_rollup enable row level security;
alter table public.usage_rollup_events enable row level security;
revoke all on table public.usage_rollup, public.usage_rollup_events from public, anon, authenticated;

-- Recomputes the aggregates for every day from p_from to p_to (inclusive), replacing what was there, so it can be run again and a late message is counted.
-- Field '_all' is the number of daily messages that day. The two lists (everUsed, usedInFirst3Days) and the billboard pairs count once per element.
create or replace function public.rollup_usage(p_from date default current_date - 3, p_to date default current_date)
returns void
language plpgsql
set search_path = public
as $$
begin
  if p_from is null or p_to is null or p_to < p_from then return; end if;
  delete from public.usage_rollup where day between p_from and p_to;
  delete from public.usage_rollup_events where day between p_from and p_to;
  insert into public.usage_rollup (day, field, value, installs)
    select d.day, '_all', 'all', count(*)::integer from public.usage_daily_real d where d.day between p_from and p_to group by d.day;
  insert into public.usage_rollup (day, field, value, installs)
    select d.day, kv.key, kv.value, count(*)::integer
    from public.usage_daily_real d
    cross join lateral jsonb_each_text(to_jsonb(d) - 'install_id' - 'day' - 'ever_used' - 'used_in_first3_days' - 'billboard') as kv
    where d.day between p_from and p_to and kv.value is not null
    group by d.day, kv.key, kv.value;
  insert into public.usage_rollup (day, field, value, installs)
    select d.day, 'ever_used', v, count(*)::integer from public.usage_daily_real d cross join lateral unnest(d.ever_used) as v where d.day between p_from and p_to group by d.day, v;
  insert into public.usage_rollup (day, field, value, installs)
    select d.day, 'used_in_first3_days', v, count(*)::integer from public.usage_daily_real d cross join lateral unnest(d.used_in_first3_days) as v where d.day between p_from and p_to group by d.day, v;
  insert into public.usage_rollup (day, field, value, installs)
    select d.day, 'billboard', v, count(*)::integer from public.usage_daily_real d cross join lateral unnest(d.billboard) as v where d.day between p_from and p_to group by d.day, v;
  insert into public.usage_rollup_events (day, event, field, value, events)
    select o.day, 'off', kv.key, kv.value, count(*)::integer from public.usage_off o
    cross join lateral jsonb_each_text(to_jsonb(o) - 'id' - 'day' - 'app_version') as kv where o.day between p_from and p_to and kv.value is not null group by o.day, kv.key, kv.value;
  insert into public.usage_rollup_events (day, event, field, value, events)
    select r.day, 'rating', 'feature', r.feature, count(*)::integer from public.feature_ratings r where r.day between p_from and p_to group by r.day, r.feature;
  insert into public.usage_rollup_events (day, event, field, value, events)
    select r.day, 'rating', 'stars:' || r.feature, r.stars::text, count(*)::integer from public.feature_ratings r where r.day between p_from and p_to group by r.day, r.feature, r.stars;
  insert into public.usage_rollup_events (day, event, field, value, events)
    select s.day, 'survey', 'answer:' || s.survey, s.answer, count(*)::integer from public.usage_surveys s where s.day between p_from and p_to group by s.day, s.survey, s.answer;
  insert into public.usage_rollup_events (day, event, field, value, events)
    select u.day, 'uninstall', kv.key, kv.value, count(*)::integer from public.usage_uninstalls u
    cross join lateral jsonb_each_text(to_jsonb(u) - 'install_id' - 'day' - 'app_version') as kv where u.day between p_from and p_to and kv.value is not null group by u.day, kv.key, kv.value;
end;
$$;
revoke all on function public.rollup_usage(date, date) from public, anon, authenticated;
grant execute on function public.rollup_usage(date, date) to service_role;

-- 6. Retention: raw rows (daily messages, ratings, uninstalls, off messages, survey answers) are kept 13 months at most. Whatever is about to go is rolled up first, so the
--    aggregates above already hold it; the last 3 days are rolled up every night as well.
create or replace function public.prune_usage()
returns void
language plpgsql
set search_path = public
as $$
declare cutoff date := (current_date - interval '13 months')::date;
begin
  perform public.rollup_usage(current_date - 3, current_date);
  perform public.rollup_usage(least((select min(day) from public.daily_usage), (select min(day) from public.usage_off), (select min(day) from public.usage_surveys), (select min(day) from public.feature_ratings), (select min(day) from public.usage_uninstalls)), cutoff);
  delete from public.daily_usage where day < cutoff;
  delete from public.feature_ratings where day < cutoff;
  delete from public.usage_uninstalls where day < cutoff;
  delete from public.usage_off where day < cutoff;
  delete from public.usage_surveys where day < cutoff;
  delete from public.rate_limit where window_start < now() - interval '2 days';
end;
$$;
revoke all on function public.prune_usage() from public, anon, authenticated;
grant execute on function public.prune_usage() to service_role;

-- Schedule the nightly job when the pg_cron extension is enabled (Database > Extensions). Skipped quietly otherwise; run select public.prune_usage() by hand then.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'acira-prune-usage';
    perform cron.schedule('acira-prune-usage', '17 3 * * *', 'select public.prune_usage()');
  end if;
end $$;


-- 7. The team views (private; SQL editor and dashboards). Not reachable from the public API keys.
--    The id-based churn views of beta.9, now for schema 1 to 3 rows only (see the header).
create or replace view public.usage_gone_weekly with (security_invoker = on) as
  with weekly as (
    select distinct on (install_id, date_trunc('week', day))
      install_id, date_trunc('week', day)::date as week, day, platform, channel, app_version
    from public.usage_daily_real where schema_version <= 3
    order by install_id, date_trunc('week', day), day desc
  ), seen as (
    select install_id, max(day) as last_day from public.usage_daily_real where schema_version <= 3 group by install_id
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

create or replace view public.usage_retention with (security_invoker = on) as
  with installs as (
    select install_id, date_trunc('week', min(day))::date as cohort_week, min(day) as first_day, max(day) as last_day,
      (array_agg(platform order by day))[1] as platform
    from public.usage_daily_real where schema_version <= 3
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

create or replace view public.usage_uninstalls_weekly with (security_invoker = on) as
  with seen as (
    select install_id, min(day) as first_day, max(day) as last_day from public.usage_daily_real where schema_version <= 3 group by install_id
  )
  select date_trunc('week', u.day)::date as week, u.app_version, u.arch,
    count(*) as uninstalls,
    round((percentile_cont(0.5) within group (order by (u.day - s.first_day)))::numeric, 1) as median_days_kept,
    count(*) filter (where s.last_day > u.day) as came_back
  from public.usage_uninstalls u
  left join seen s using (install_id)
  group by 1, 2, 3
  order by 1 desc, 4 desc;

--    Every schema-4 field, per day: how many installs have each value and what share of that day's messages (settings, buckets, health, funnel, engagement).
create or replace view public.usage_fields with (security_invoker = on) as
  select s.day, s.field, s.value, count(*) as installs,
    round(100.0 * count(*) / sum(count(*)) over (partition by s.day, s.field), 1) as share_pct
  from (
    select d.day, kv.key as field, kv.value
    from public.usage_daily_real d
    cross join lateral jsonb_each_text(to_jsonb(d) - 'install_id' - 'day' - 'ever_used' - 'used_in_first3_days' - 'billboard' - 'update_from') as kv
    where d.schema_version = 4 and kv.value is not null
  ) s
  group by 1, 2, 3;

--    Weekly and monthly active installs and new installs from the flags, with no id that lasts: a message with first_this_week = 'yes' is the first one that install sent that ISO week.
create or replace view public.usage_active_weekly with (security_invoker = on) as
  select date_trunc('week', day)::date as week, platform,
    count(*) filter (where first_this_week = 'yes') as active_installs,
    count(*) filter (where first_ever = 'yes' and coalesce(is_returning, 'no') <> 'yes') as new_installs,
    count(*) filter (where first_ever = 'yes' and is_returning = 'yes') as returning_installs
  from public.usage_daily_real where schema_version = 4 group by 1, 2 order by 1 desc, 2;
create or replace view public.usage_active_monthly with (security_invoker = on) as
  select date_trunc('month', day)::date as month, platform,
    count(*) filter (where first_this_month = 'yes') as active_installs,
    count(*) filter (where first_ever = 'yes' and coalesce(is_returning, 'no') <> 'yes') as new_installs,
    count(*) filter (where first_ever = 'yes' and is_returning = 'yes') as returning_installs
  from public.usage_daily_real where schema_version = 4 group by 1, 2 order by 1 desc, 2;

--    Retention by install week, from install_day (the first 30 days only): of the installs that first reported in a week, how many sent a message on day N.
create or replace view public.usage_retention_cohort with (security_invoker = on) as
  with cohort as (
    select install_week, count(*) as installs from public.usage_daily_real
    where schema_version = 4 and first_ever = 'yes' and install_week is not null group by install_week
  )
  select d.install_week, d.install_day::integer as install_day, count(*) as active_installs, c.installs as cohort_installs,
    round(100.0 * count(*) / c.installs, 1) as retention_pct
  from public.usage_daily_real d join cohort c using (install_week)
  where d.schema_version = 4 and d.install_day is not null
  group by d.install_week, d.install_day, c.installs;

--    Discovery: per day and feature, how many installs have ever used it and how many used it in their first 3 days.
create or replace view public.usage_discovery with (security_invoker = on) as
  select d.day, f.feature, count(*) as installs,
    count(*) filter (where f.feature = any (d.ever_used)) as ever_used_installs,
    count(*) filter (where f.feature = any (d.used_in_first3_days)) as first3_installs
  from public.usage_daily_real d
  cross join lateral unnest(array['torTabs', 'torWindows', 'privateTabs', 'privateWindows', 'splitView', 'rewind', 'tabSets', 'peek', 'seamlessReveals', 'workspaceSwitches', 'tabGroups', 'vpnToggles', 'commandBar', 'protectionPanel', 'downloads', 'bookmarksAdded', 'bookmarksOpened', 'historyOpened', 'findInPage', 'zoomChanges', 'passwordSaves', 'passwordFills', 'extensionInstalls', 'extensionPopupOpens', 'importAttempted', 'importCompleted', 'settingsOpened', 'shortcutsEditorOpened', 'newTabPageActions', 'fullscreen', 'printOrSavePdf', 'siteProtectionToggles', 'nowPlayingCardActions', 'pictureInPictureManual', 'pictureInPictureAutomatic', 'favoritesStackOpens', 'layoutPickerOpened', 'groupNested', 'groupReordered', 'tabSwitcherOpens', 'tabViewerOpens', 'bookmarksPopupOpens', 'extensionOverflowOpens', 'sidePanelOpens', 'pinnedTabSlept', 'screenshotsArea', 'screenshotsVisible', 'screenshotsFull', 'zapUsed', 'zapRestored', 'easyFilesShown', 'easyFilesPickedClipboard', 'easyFilesPickedScreenshot', 'easyFilesPickedDownload', 'easyFilesPickedBrowse', 'imageSearchesGoogle', 'imageSearchesTineye', 'imageSearchesYandex', 'imageSearchesBing', 'imageSearchesCustom', 'searchSuggestionPicked', 'devtoolsOpenedRight', 'devtoolsOpenedBottom', 'devtoolsOpenedWindow', 'feedbackSent', 'insiderSheetShown', 'insiderActivated', 'insiderDeclined', 'insiderCodeOk', 'insiderCodeInvalid', 'insiderCodeUsed', 'insiderCodeExpired', 'insiderCodeRevoked', 'insiderCodeRateLimited', 'insiderCodeOffline', 'insiderInviteCreated', 'insiderInviteCopied', 'insiderMoveCodeMade', 'insiderChannelOn', 'insiderChannelOff', 'insiderSealCloser', 'insiderCardOpened', 'insiderCardShared']) as f(feature)
  where d.schema_version = 4 group by 1, 2;

--    Where and when people switch sharing off, the answers to our questions, and what happened to each announcement card.
create or replace view public.usage_off_weekly with (security_invoker = on) as
  select date_trunc('week', day)::date as week, platform, off_where, days_since_install, count(*) as offs
  from public.usage_off group by 1, 2, 3, 4 order by 1 desc, 5 desc;
create or replace view public.usage_survey_results with (security_invoker = on) as
  select day, survey, answer, count(*) as answers from public.usage_surveys group by 1, 2, 3 order by 1 desc, 2, 3;
create or replace view public.usage_billboard_results with (security_invoker = on) as
  select d.day, split_part(v, ':', 1) as card, split_part(v, ':', 2) as state, count(*) as installs
  from public.usage_daily_real d cross join lateral unnest(d.billboard) as v
  where d.schema_version = 4 group by 1, 2, 3;
--    Why people uninstall (Windows): the one-tap reason, per week and version; a person who skipped the question counts as 'none'.
create or replace view public.usage_uninstall_reasons with (security_invoker = on) as
  select date_trunc('week', day)::date as week, platform, app_version, coalesce(reason, 'none') as reason, count(*) as uninstalls
  from public.usage_uninstalls group by 1, 2, 3, 4 order by 1 desc, 5 desc;

-- 8. Public aggregates (for the website's public numbers, later). Every row stands for 5 or more installs (or events): a group of 1 to 4 is never shown, and a figure that would
--    be 1 to 4 is left empty. They read the rolled-up counts (kept for ever) or, for a combination of two fields, the raw rows (13 months). NOTHING is granted to the public keys by this
--    migration: the website page comes later, and publishing these is an owner decision (a select grant on the usage_public_* views to the anon role, then).
create or replace view public.usage_public_fields with (security_invoker = on) as
  select day, field, value, installs from public.usage_rollup where installs >= 5;
create or replace view public.usage_public_events with (security_invoker = on) as
  select day, event, field, value, events from public.usage_rollup_events where events >= 5;
create or replace view public.usage_public_modes with (security_invoker = on) as
  select day, window_view, tab_layout, count(*) as installs
  from public.usage_daily_real where schema_version = 4 group by 1, 2, 3 having count(*) >= 5;
create or replace view public.usage_public_retention with (security_invoker = on) as
  select install_week, install_day, active_installs, cohort_installs, retention_pct
  from public.usage_retention_cohort where active_installs >= 5 and cohort_installs >= 5;
create or replace view public.usage_public_active_weekly with (security_invoker = on) as
  select week, platform, active_installs, case when new_installs >= 5 then new_installs end as new_installs
  from public.usage_active_weekly where active_installs >= 5;

revoke all on public.usage_gone_weekly, public.usage_retention, public.usage_uninstalls_weekly, public.usage_fields, public.usage_active_weekly, public.usage_active_monthly, public.usage_retention_cohort,
  public.usage_discovery, public.usage_off_weekly, public.usage_survey_results, public.usage_billboard_results, public.usage_uninstall_reasons,
  public.usage_public_fields, public.usage_public_events, public.usage_public_modes, public.usage_public_retention, public.usage_public_active_weekly from public, anon, authenticated;

-- 9. Count what is already stored (schema 1 to 3 rows included), then let the REST layer see the new columns and tables now (the deploy health probe reads them right after this).
select public.rollup_usage((select min(day) from public.daily_usage), current_date);
notify pgrst, 'reload schema';
