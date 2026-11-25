'use strict';
// The coarse, anonymous facts in the daily usage message (schema 4, Beta 14; schema 3 was R4-60). Everything here is a choice from a CLOSED list,
// a bucket or a fixed format (an ISO week, a version): no URL, site, search term, title, name, path, address, exact count or free text can pass
// `sanitize`, whatever the caller supplies.
// supabase/functions/usage/handler.mjs repeats the same lists for the server side and the migration repeats them as check constraints;
// tests/supabase-metrics-v4.test.mjs and tests/metrics.test.cjs fail if they drift apart. Why each field exists: docs/launch/METRICS.md.
const { windowsBuild, windowsFamily } = require('../windows-version.cjs');
const COUNT_BUCKETS = Object.freeze(['0', '1-2', '3-9', '10+']);          // how many times a feature was used since the last message (about a day)
const SMALL_BUCKETS = Object.freeze(['0', '1', '2-3', '4-6', '7+']);        // extensions installed, across profiles
const PROFILE_BUCKETS = Object.freeze(['1', '2', '3-4', '5+']);             // profiles, workspaces
const SITE_BUCKETS = Object.freeze(['0', '1', '2-5', '6+']);                // sites where protection was switched off
const ON_OFF = Object.freeze(['on', 'off', 'unknown']);
const YES_NO = Object.freeze(['yes', 'no']);
const YES_NO_UNKNOWN = Object.freeze(['yes', 'no', 'unknown']);
// Schema 4 (Beta 14): engagement, health and setup-funnel buckets. Edges are half-open, lower bound included: 5 minutes is '5-30'.
const MINUTES_BUCKETS = Object.freeze(['0-5', '5-30', '30-120', '120+']);
const SESSION_BUCKETS = Object.freeze(['1', '2-3', '4-9', '10+']);
const PAGES_BUCKETS = Object.freeze(['0', '1-10', '11-50', '51-200', '200+']);
const SEARCH_BUCKETS = Object.freeze(['0', '1-5', '6-20', '20+']);
const DAYS_BUCKETS = Object.freeze(['0', '1', '2-3', '4-7', '8-14', '15-28', '29+']);
const COLD_START_BUCKETS = Object.freeze(['<1s', '1-2s', '2-4s', '4-8s', '8s+']);
const CRASH_BUCKETS = Object.freeze(['0', '1', '2-4', '5+']);
const MEMORY_BUCKETS = Object.freeze(['<1GB', '1-2GB', '2-4GB', '4GB+']);
const TRACKER_BUCKETS = Object.freeze(['0', '1-99', '100-999', '1000-9999', '10000+']);
const SETUP_SECONDS_BUCKETS = Object.freeze(['<30s', '30-60s', '60-120s', '120-300s', '300s+']);
const MONITOR_BUCKETS = Object.freeze(['1', '2', '3+']);
const DISPLAY_SCALES = Object.freeze(['100', '125', '150', '175', '200', 'other']);
const OS_VERSIONS = Object.freeze(['win10', 'win11', 'win-other', 'mac-11', 'mac-12', 'mac-13', 'mac-14', 'mac-15', 'mac-26', 'mac-27', 'mac-28', 'mac-other', 'linux', 'other']);
const SETTINGS_SECTIONS = Object.freeze(['none', 'appearance', 'profiles', 'tabs', 'new-tab', 'search', 'privacy', 'connection', 'accessibility', 'import-export', 'about']);
const SETUP_STEPS = Object.freeze(['welcome', 'import', 'profile', 'appearance', 'cover', 'search', 'privacy', 'default', 'finish']);
const SETUP_PATHS = Object.freeze(['completed', 'defaults', 'skipped', 'abandoned']);
const NOTICE_SEEN = Object.freeze(['x', 'link', 'timeout', 'undoneThenX', 'none']);
const UPDATE_RESULTS = Object.freeze(['ok', 'failed', 'rolledBack', 'none']);
// Beta 14 (B8): the choices of Beta 14's own settings. Each list is the brief's own, plus 'unknown' for a setting that could not be read (or is not built yet).
const ACTIVE_BORDER_STYLES = Object.freeze(['divider-fade', 'lit-edge', 'hairline', 'inner-light', 'plain', 'unknown']);
const FAVORITES_BEFORE_STACK = Object.freeze(['6', '9', '12', '16', '20', 'all', 'unknown']);
const CTRL_TAB_MODES = Object.freeze(['next', 'recent', 'viewer', 'unknown']);
const HIDDEN_SIDEBAR_REVEALS = Object.freeze(['edge', 'handle', 'never', 'unknown']);
const LOAD_AHEAD_MODES = Object.freeze(['nothing', 'pinned', 'recent', 'unknown']);
const SEARCH_SUGGESTION_MODES = Object.freeze(['off', 'engine', 'service', 'custom', 'unknown']);
/** The image-search services of the right-click menu (Google Lens, TinEye, Yandex, Bing, or an address the person wrote). `none`: nothing chosen yet; `ask`: asks every time. */
const IMAGE_SEARCH_SERVICES = Object.freeze(['google', 'tineye', 'yandex', 'bing', 'custom']);
const IMAGE_SEARCH_SETTINGS = Object.freeze(['none', 'ask', ...IMAGE_SEARCH_SERVICES, 'unknown']);
const SCREENSHOT_BUTTONS = Object.freeze(['off', 'sidebar', 'topbar', 'unknown']);
const NEW_TAB_PICTURE_SETS = Object.freeze(['all', 'picks', 'unknown']);
/** Why sharing was switched off (the `off` message). `notice` is the one-click Turn off on the new-tab page's notice. */
const OFF_WHERE = Object.freeze(['setup', 'settings', 'uninstaller', 'notice']);
/** The one-tap reasons of the Windows uninstall message (optional). */
const UNINSTALL_REASONS = Object.freeze(['slow', 'crashes', 'missing-feature', 'not-clear', 'switched-back', 'just-trying', 'other']);
/** A survey answer (`survey` message): the survey is one we wrote (an id like q-new-tab-2026-12) and the answer is one of these. Never free text. */
const SURVEY_ID = /^[a-z0-9][a-z0-9-]{2,31}$/;
const SURVEY_ANSWERS = Object.freeze(['1', '2', '3', '4', '5', 'yes', 'no', 'a', 'b', 'c', 'd', 'e', 'skip']);
/** The billboard measurement (section D): what happened to a card. */
const BILLBOARD_STATES = Object.freeze(['shown', 'x', 'undo', 'cta', 'secondary', 'timeout']);
const SEARCH_ENGINES = Object.freeze(['google', 'duckduckgo', 'bing', 'ecosia', 'brave', 'kagi', 'startpage', 'qwant', 'yahoo', 'other']);
/** The searches fields, one per engine family: searchesGoogle, searchesDuckduckgo, ... */
const searchField = (engine) => 'searches' + engine[0].toUpperCase() + engine.slice(1);
const SEARCH_FIELDS = Object.freeze(SEARCH_ENGINES.map(searchField));
const INSTALL_DAYS = Object.freeze(Array.from({ length: 30 }, (_, day) => String(day)));
/** Fixed formats (never free text): an ISO week of the install and a version (updateFrom). */
const INSTALL_WEEK = /^20[2-9]\d-W(0[1-9]|[1-4]\d|5[0-3])$/;
const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,4}(?:[-.][0-9A-Za-z.]{1,16}){0,2}$/;
/** An announcement's id (billboard) is one we wrote: lower case letters, digits, dots and dashes, 3 to 64 characters (the dashboard's slugs). */
const BILLBOARD_ID = /^[a-z0-9][a-z0-9.-]{2,63}$/;
const ENUMS = Object.freeze({
  // How Acira is set up
  theme: ['light', 'dark', 'system'],
  finish: ['porcelain', 'burgundy', 'deep-blue', 'ocean-blue', 'iphone-blue', 'emerald-green', 'alpine-green', 'deep-purple', 'desert-titanium', 'natural-titanium', 'silver', 'black-titanium', 'custom', 'unknown'],
  windowView: ['full', 'compact', 'focus', 'seamless', 'unknown'],
  tabLayout: ['strip', 'sidebar', 'shelf', 'compact', 'dynamic', 'unknown'],
  animation: ['premium', 'fast', 'off', 'default', 'unknown'],
  interfaceScale: ['80', '90', '100', '110', '125', '150', 'other'],
  uiLanguage: ['en', 'ar', 'de', 'es', 'fr', 'hi', 'it', 'ja', 'ko', 'pt-BR', 'ru', 'tr', 'zh-CN', 'other'],
  searchEngine: ['google', 'duckduckgo', 'bing', 'ecosia', 'brave', 'kagi', 'startpage', 'qwant', 'yahoo', 'other'],
  aiFree: ON_OFF, adBlocking: ON_OFF, phishingProtection: ON_OFF, linkPreview: ON_OFF, askBeforeClosing: ON_OFF, tabSleep: ON_OFF,
  shortcutsCustom: YES_NO,
  setup: ['completed', 'skipped', 'unknown'],
  // Connection
  proxy: ON_OFF, vpn: ON_OFF,
  vpnApp: ['none', 'Mullvad VPN', 'Proton VPN', 'IVPN', 'NordVPN', 'ExpressVPN', 'Surfshark', 'CyberGhost', 'Windscribe', 'Private Internet Access', 'Cloudflare WARP', 'Tailscale', 'TunnelBear', 'Hotspot Shield', 'OpenVPN', 'WireGuard', 'other'],
  // Sizes, as buckets
  extensions: SMALL_BUCKETS, profiles: PROFILE_BUCKETS, workspaces: PROFILE_BUCKETS, siteProtectionOff: SITE_BUCKETS,
  tabsOpen: ['1-5', '6-15', '16-40', '41-100', '101+'], windows: ['1', '2', '3-5', '6+'], splitPanes: ['none', '2', '3', '4'],
  // Moving in
  importSource: ['none', 'chrome', 'edge', 'firefox', 'brave', 'arc', 'opera', 'vivaldi', 'zen', 'safari', 'html', 'other'],
  passwordsImported: YES_NO,
  signBackIn: ['none', '0', '1-49', '50-99', '100'],
  // Beta 14's own settings (B8). Read by main.cjs from the settings, or reported by the interface for the ones that live in it (src/features/metrics/noteUse.ts reportSetting).
  activeBorderStyle: ACTIVE_BORDER_STYLES, ambientMode: ON_OFF, favoritesTileOnly: ON_OFF, favoritesBeforeStack: FAVORITES_BEFORE_STACK, ctrlTabMode: CTRL_TAB_MODES, tabSwitcherPictures: ON_OFF,
  hiddenSidebarReveal: HIDDEN_SIDEBAR_REVEALS, loadAhead: LOAD_AHEAD_MODES, searchSuggestions: SEARCH_SUGGESTION_MODES, imageSearchService: IMAGE_SEARCH_SETTINGS, autoPictureInPicture: ON_OFF,
  easyFiles: ON_OFF, screenshotButton: SCREENSHOT_BUTTONS, newTabPictureSet: NEW_TAB_PICTURE_SETS,
  // Schema 4 (Beta 14). Whether this is the first message today / this ISO week / this month / ever, and the install's first 30 days.
  firstToday: YES_NO, firstThisWeek: YES_NO, firstThisMonth: YES_NO, firstEver: YES_NO, installDay: INSTALL_DAYS,
  // Beta 14, B9: `yes` only in an install's first message, when its data folder was wiped on a computer that had Acira (install-mark.cjs); never sent otherwise
  returning: YES_NO,
  // Engagement
  minutesActive: MINUTES_BUCKETS, sessions: SESSION_BUCKETS, pagesLoaded: PAGES_BUCKETS, daysSinceInstall: DAYS_BUCKETS,
  ...Object.fromEntries(SEARCH_FIELDS.map((field) => [field, SEARCH_BUCKETS])),
  defaultBrowser: YES_NO_UNKNOWN, pinnedToTaskbar: YES_NO_UNKNOWN, inDock: YES_NO_UNKNOWN, openedAtStartup: YES_NO_UNKNOWN, settingsSection: SETTINGS_SECTIONS,
  // Health
  coldStartMs: COLD_START_BUCKETS, crashes: CRASH_BUCKETS, updateResult: UPDATE_RESULTS, memoryPeak: MEMORY_BUCKETS, gpuAccel: YES_NO_UNKNOWN,
  osVersion: OS_VERSIONS, displayScale: DISPLAY_SCALES, monitors: MONITOR_BUCKETS, trackersBlocked: TRACKER_BUCKETS, filterListsUpdated: YES_NO_UNKNOWN,
  // Setup funnel (sent once, in an install's first message)
  setupPath: SETUP_PATHS, setupStepReached: SETUP_STEPS, setupSeconds: SETUP_SECONDS_BUCKETS, noticeSeen: NOTICE_SEEN,
});
// Feature use counts, as buckets of the number of times used since the last message that was sent.
/** The schema-3 message's uses (before Beta 14): older builds still send them, and the function still accepts them (the function keeps its own copy, tests/supabase-metrics-v4.test.mjs checks the two agree). */
const USES_V3 = Object.freeze(['torTabs', 'torWindows', 'privateTabs', 'privateWindows', 'splitView', 'rewind', 'tabSets', 'peek', 'seamlessReveals', 'workspaceSwitches', 'tabGroups', 'vpnToggles', 'mediaControls', 'commandBar', 'protectionPanel']);
/** Beta 14 (B7): what changed from schema 3, each because two fields answered one question. `mediaControls` is now `nowPlayingCardActions` (the card is the only place those controls are; the old
 *  count never fired, it listened for an action the card does not send); `peek` stays and `linkPreviewOpens` is not added (both counted one Peek opening); `undoClose` is not added (`rewind` already counts
 *  every reopened tab and window); `pictureInPicture` is split into manual and automatic (B8); `toolbar` (the settings snapshot) is not sent because `windowView` already says it. */
const USES = Object.freeze([...USES_V3.filter((name) => name !== 'mediaControls'),
  // Schema 4 (Beta 14, B4): feature use that was not counted before
  'downloads', 'bookmarksAdded', 'bookmarksOpened', 'historyOpened', 'findInPage', 'zoomChanges', 'passwordSaves', 'passwordFills', 'extensionInstalls', 'extensionPopupOpens',
  'importAttempted', 'importCompleted', 'settingsOpened', 'shortcutsEditorOpened', 'newTabPageActions', 'fullscreen', 'printOrSavePdf', 'siteProtectionToggles',
  // Beta 14's own features (B8). Counts only: never which site, file, name, picture or words. Features that other work is still building are counted through the helper (docs/launch/METRICS.md "Counting a new feature").
  'nowPlayingCardActions', 'pictureInPictureManual', 'pictureInPictureAutomatic', 'favoritesStackOpens', 'layoutPickerOpened', 'groupNested', 'groupReordered', 'tabSwitcherOpens', 'tabViewerOpens', 'bookmarksPopupOpens', 'extensionOverflowOpens', 'sidePanelOpens', 'pinnedTabSlept',
  'screenshotsArea', 'screenshotsVisible', 'screenshotsFull', 'zapUsed', 'zapRestored', 'easyFilesShown', 'easyFilesPickedClipboard', 'easyFilesPickedScreenshot', 'easyFilesPickedDownload', 'easyFilesPickedBrowse',
  ...IMAGE_SEARCH_SERVICES.map((service) => 'imageSearches' + service[0].toUpperCase() + service.slice(1)), 'searchSuggestionPicked', 'devtoolsOpenedRight', 'devtoolsOpenedBottom', 'devtoolsOpenedWindow', 'feedbackSent',
  // Beta 14 (the Insider programme, browser side): counts only, never a code, a result text or anything of the person. Nothing is counted while the programme is hidden (no server named).
  'insiderSheetShown', 'insiderActivated', 'insiderDeclined', 'insiderCodeOk', 'insiderCodeInvalid', 'insiderCodeUsed', 'insiderCodeExpired', 'insiderCodeRevoked', 'insiderCodeRateLimited', 'insiderCodeOffline', 'insiderInviteCreated', 'insiderInviteCopied', 'insiderMoveCodeMade', 'insiderChannelOn', 'insiderChannelOff', 'insiderSealCloser', 'insiderCardOpened', 'insiderCardShared']);
/** Daily highest values (kept as small integers locally, sent only as buckets). */
const PEAKS = Object.freeze(['tabsOpen', 'windows', 'splitPanes']);
const FIELDS = Object.freeze([...Object.keys(ENUMS), ...USES]);
/** The settings snapshot (schema 3's 30 choices and sizes): the part of the message that describes how Acira is set up. */
const SNAPSHOT = Object.freeze(['theme', 'finish', 'windowView', 'tabLayout', 'animation', 'interfaceScale', 'uiLanguage', 'searchEngine', 'aiFree', 'adBlocking', 'phishingProtection', 'linkPreview', 'askBeforeClosing', 'tabSleep', 'shortcutsCustom', 'setup', 'proxy', 'vpn', 'vpnApp', 'extensions', 'profiles', 'workspaces', 'siteProtectionOff', 'tabsOpen', 'windows', 'splitPanes', 'importSource', 'passwordsImported', 'signBackIn',
  // Beta 14's own settings (B8)
  'activeBorderStyle', 'ambientMode', 'favoritesTileOnly', 'favoritesBeforeStack', 'ctrlTabMode', 'tabSwitcherPictures', 'hiddenSidebarReveal', 'loadAhead', 'searchSuggestions', 'imageSearchService', 'autoPictureInPicture', 'easyFiles', 'screenshotButton', 'newTabPictureSet']);
/** The order of the message after the nine base fields: the exact message is shown to people in this order, grouped like "What's sent". */
const FLAGS = Object.freeze(['firstToday', 'firstThisWeek', 'firstThisMonth', 'firstEver', 'returning', 'installWeek', 'installDay']);
const ENGAGEMENT = Object.freeze(['minutesActive', 'sessions', 'pagesLoaded', ...SEARCH_FIELDS, 'daysSinceInstall', 'defaultBrowser', 'pinnedToTaskbar', 'inDock', 'openedAtStartup', 'settingsSection']);
const HEALTH = Object.freeze(['coldStartMs', 'crashes', 'updateFrom', 'updateResult', 'memoryPeak', 'gpuAccel', 'osVersion', 'displayScale', 'monitors', 'trackersBlocked', 'filterListsUpdated']);
const FUNNEL = Object.freeze(['setupPath', 'setupStepReached', 'setupSeconds', 'noticeSeen']);
const DISCOVERY = Object.freeze(['everUsed', 'usedInFirst3Days']);
/** Every key a schema-4 daily message may carry after the base fields, in message order. */
const MESSAGE_ORDER = Object.freeze([...FLAGS, ...SNAPSHOT, ...ENGAGEMENT, ...USES, ...DISCOVERY, ...HEALTH, ...FUNNEL, 'billboard']);
const FALLBACK = Object.freeze({ finish: 'unknown', windowView: 'unknown', tabLayout: 'unknown', animation: 'unknown', interfaceScale: 'other', uiLanguage: 'other', searchEngine: 'other', importSource: 'none', theme: 'system', setup: 'unknown', vpnApp: 'none', shortcutsCustom: 'no', passwordsImported: 'no', signBackIn: 'none', activeBorderStyle: 'unknown', favoritesBeforeStack: 'unknown', ctrlTabMode: 'unknown', hiddenSidebarReveal: 'unknown', loadAhead: 'unknown', searchSuggestions: 'unknown', imageSearchService: 'unknown', screenshotButton: 'unknown', newTabPictureSet: 'unknown', extensions: '0', profiles: '1', workspaces: '1', siteProtectionOff: '0', tabsOpen: '1-5', windows: '1', splitPanes: 'none' });

const bucket = (count, edges) => { const n = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0; for (const [label, max] of edges) if (n <= max) return label; return edges.at(-1)[0]; };
const countBucket = (n) => bucket(n, [['0', 0], ['1-2', 2], ['3-9', 9], ['10+', Infinity]]);
const smallBucket = (n) => bucket(n, [['0', 0], ['1', 1], ['2-3', 3], ['4-6', 6], ['7+', Infinity]]);
const profileBucket = (n) => bucket(Math.max(1, n || 1), [['1', 1], ['2', 2], ['3-4', 4], ['5+', Infinity]]);
const siteBucket = (n) => bucket(n, [['0', 0], ['1', 1], ['2-5', 5], ['6+', Infinity]]);
const tabsBucket = (n) => bucket(Math.max(1, n || 1), [['1-5', 5], ['6-15', 15], ['16-40', 40], ['41-100', 100], ['101+', Infinity]]);
const windowsBucket = (n) => bucket(Math.max(1, n || 1), [['1', 1], ['2', 2], ['3-5', 5], ['6+', Infinity]]);
const panesBucket = (n) => (!Number.isFinite(n) || n < 2 ? 'none' : n >= 4 ? '4' : String(Math.floor(n)));
const count = (n) => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);
/** Schema 4 buckets. `seconds` of active time, page loads, searches, sessions (a launch counts as one; never fewer than 1). */
const minutesBucket = (seconds) => { const minutes = Math.max(0, Number(seconds) || 0) / 60; return minutes < 5 ? '0-5' : minutes < 30 ? '5-30' : minutes < 120 ? '30-120' : '120+'; };
const sessionsBucket = (n) => { const value = Math.max(1, count(n)); return value === 1 ? '1' : value <= 3 ? '2-3' : value <= 9 ? '4-9' : '10+'; };
const pagesBucket = (n) => { const value = count(n); return value === 0 ? '0' : value <= 10 ? '1-10' : value <= 50 ? '11-50' : value <= 200 ? '51-200' : '200+'; };
const searchBucket = (n) => { const value = count(n); return value === 0 ? '0' : value <= 5 ? '1-5' : value <= 20 ? '6-20' : '20+'; };
const daysBucket = (days) => { const value = count(days); return value === 0 ? '0' : value === 1 ? '1' : value <= 3 ? '2-3' : value <= 7 ? '4-7' : value <= 14 ? '8-14' : value <= 28 ? '15-28' : '29+'; };
const coldStartBucket = (ms) => { const value = Number(ms); if (!Number.isFinite(value) || value < 0) return undefined; return value < 1000 ? '<1s' : value < 2000 ? '1-2s' : value < 4000 ? '2-4s' : value < 8000 ? '4-8s' : '8s+'; };
const crashBucket = (n) => { const value = count(n); return value === 0 ? '0' : value === 1 ? '1' : value <= 4 ? '2-4' : '5+'; };
const GIB = 1024 ** 3;
const memoryBucket = (bytes) => { const value = Number(bytes); if (!Number.isFinite(value) || value <= 0) return undefined; return value < GIB ? '<1GB' : value < 2 * GIB ? '1-2GB' : value < 4 * GIB ? '2-4GB' : '4GB+'; };
const trackerBucket = (n) => { const value = count(n); return value === 0 ? '0' : value <= 99 ? '1-99' : value <= 999 ? '100-999' : value <= 9999 ? '1000-9999' : '10000+'; };
const setupSecondsBucket = (seconds) => { const value = Number(seconds); if (!Number.isFinite(value) || value < 0) return undefined; return value < 30 ? '<30s' : value < 60 ? '30-60s' : value < 120 ? '60-120s' : value < 300 ? '120-300s' : '300s+'; };
const monitorsBucket = (n) => { const value = count(n); return value <= 0 ? undefined : value === 1 ? '1' : value === 2 ? '2' : '3+'; };
const displayScaleBucket = (factor) => { const percent = Math.round((Number(factor) || 0) * 100); return DISPLAY_SCALES.includes(String(percent)) && percent > 0 ? String(percent) : 'other'; };
/** The OS version text ('10.0.22631', '26.0.1'; windows-version.cjs systemVersion) and the platform to a closed OS list: Windows 10 or 11 (by build, through desktop/windows-version.cjs, the only
 *  place that reads a Windows build), the macOS major version, Linux. */
function osVersionBucket(platform, systemVersion) {
  const parts = String(systemVersion || '').split('.').map((part) => Number.parseInt(part, 10));
  if (platform === 'win32') { const family = windowsFamily(windowsBuild(String(systemVersion || ''), 'win32')); return family === 'windows-11' ? 'win11' : family === 'windows-10' ? 'win10' : 'win-other'; }
  if (platform === 'darwin') { const label = 'mac-' + parts[0]; return OS_VERSIONS.includes(label) ? label : 'mac-other'; }
  return platform === 'linux' ? 'linux' : 'other';
}
/** The ISO week (Monday first) of a UTC day 'YYYY-MM-DD' as 'YYYY-Www'. */
function isoWeekOf(day) {
  const time = Date.parse(day + 'T00:00:00Z'); if (!Number.isFinite(time)) return '';
  const date = new Date(time); const weekday = (date.getUTCDay() + 6) % 7; // Monday = 0
  date.setUTCDate(date.getUTCDate() - weekday + 3); // the Thursday of this ISO week decides the year
  const year = date.getUTCFullYear(), first = new Date(Date.UTC(year, 0, 4));
  const week = 1 + Math.round(((date - first) / 86400000 - 3 + ((first.getUTCDay() + 6) % 7)) / 7);
  return year + '-W' + String(week).padStart(2, '0');
}
const addDaysTo = (day, days) => new Date(Date.parse(day + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);
const daysBetween = (from, to) => Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000);
const settingsSectionOf = (name) => { const id = String(name || '').toLowerCase().replace(/&/g, '').replace(/\s+/g, '-').replace(/-+/g, '-'); return SETTINGS_SECTIONS.includes(id) && id !== 'none' ? id : undefined; };
/** Sign back in progress: how much of the list is done, as a coarse share; never which sites. */
const signBackInBucket = (progress) => {
  const total = Number(progress?.total), done = Number(progress?.done);
  if (!Number.isFinite(total) || total <= 0) return 'none';
  const share = Math.max(0, Math.min(1, (Number.isFinite(done) ? done : 0) / total));
  return share === 0 ? '0' : share >= 1 ? '100' : share < 0.5 ? '1-49' : '50-99';
};
const onOff = (value) => (value === true || value === 'on' ? 'on' : value === false || value === 'off' ? 'off' : 'unknown');
const yesNo = (value) => (value === true || value === 'yes' ? 'yes' : 'no');

/** A closed-list value, or the field's fallback. The caller's text is never copied. */
const pick = (field, value) => (ENUMS[field].includes(value) ? value : FALLBACK[field] ?? ENUMS[field][0]);

/** Beta 14's own settings (B8). Whoever builds a setting may store its choice as 'top-bar', 'topBar' or 'Top bar': only the letters and digits count, and the answer is the list's own spelling.
 *  A value that matches nothing (or an address, or text) is the field's fallback, never copied. */
const looseKey = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const pickLoose = (field, value) => { const key = looseKey(value); return (key && ENUMS[field].find((entry) => looseKey(entry) === key)) || FALLBACK[field] || 'unknown'; };
/** Search suggestions as the setting may be stored: a list value, a switch (true = the engine's own, false = off), or `{ enabled, mode }`. */
function searchSuggestionsOf(value) {
  if (value === false) return 'off';
  if (value === true) return 'engine';
  if (value && typeof value === 'object') return value.enabled === false ? 'off' : value.mode !== undefined ? value.mode : value.source !== undefined ? value.source : value.enabled === true ? 'engine' : undefined;
  return value;
}
/** The names of Beta 14's own settings (B8): each is read from the saved settings under its own name, or reported by the interface (src/features/metrics/reportSettings.ts). */
const BETA14_SETTINGS = Object.freeze(['activeBorderStyle', 'ambientMode', 'favoritesTileOnly', 'favoritesBeforeStack', 'ctrlTabMode', 'tabSwitcherPictures', 'hiddenSidebarReveal', 'loadAhead', 'searchSuggestions',
  'imageSearchService', 'autoPictureInPicture', 'easyFiles', 'screenshotButton', 'newTabPictureSet']);
/** Settings that main reads straight from the saved settings (never from the interface). */
const READ_FROM_SETTINGS = Object.freeze(['activeBorderStyle', 'ambientMode', 'favoritesTileOnly']);
/** What one report from the interface may be: a name of the list above and a value of that field's closed list, spelled as the list spells it. Anything else is refused (undefined). */
function acceptReport(name, value) {
  if (!BETA14_SETTINGS.includes(name) || READ_FROM_SETTINGS.includes(name) || typeof value !== 'string') return undefined;
  const entry = ENUMS[name].find((item) => item === value);
  return entry && entry !== 'unknown' ? entry : undefined;
}
/** The raw settings facts of Beta 14's own settings, from the saved settings and what the interface reported (`reported`: { name: value } kept in memory by main, only values `acceptReport` took).
 *  A setting that is not there yet (not built, not reported) is left out: the message says 'unknown'. */
function betaSettingsOf(settings, reported) {
  const saved = settings && typeof settings === 'object' ? settings : {}, told = reported && typeof reported === 'object' ? reported : {}, out = {};
  out.activeBorderStyle = saved.activeBorder;
  out.ambientMode = saved.ambientMode === true;
  out.favoritesTileOnly = saved.favoriteTabsInList !== true;
  for (const name of BETA14_SETTINGS) {
    if (READ_FROM_SETTINGS.includes(name)) continue;
    const value = name in told ? told[name] : name === 'searchSuggestions' ? searchSuggestionsOf(saved.searchSuggestions) : saved[name];
    if (value !== undefined) out[name] = value;
  }
  return out;
}

/** Maps raw local facts (counts as numbers, ids as the app stores them) to the message fields. Anything unexpected becomes a fallback value. */
function sanitize(raw = {}, uses = {}, peaks = {}) {
  const most = (name) => Math.max(Number(raw[name]) || 0, Number(peaks && peaks[name]) || 0);
  const out = {
    theme: pick('theme', raw.theme),
    finish: pick('finish', String(raw.finish ?? '').toLowerCase().replace(/\s+/g, '-')),
    windowView: pick('windowView', raw.windowView),
    tabLayout: pick('tabLayout', raw.tabLayout),
    animation: pick('animation', raw.animation),
    interfaceScale: pick('interfaceScale', String(raw.interfaceScale ?? '')),
    uiLanguage: pick('uiLanguage', raw.uiLanguage),
    searchEngine: pick('searchEngine', raw.searchEngine),
    aiFree: onOff(raw.aiFree), adBlocking: onOff(raw.adBlocking), phishingProtection: onOff(raw.phishingProtection), linkPreview: onOff(raw.linkPreview),
    askBeforeClosing: onOff(raw.askBeforeClosing), tabSleep: onOff(raw.tabSleep),
    shortcutsCustom: yesNo(raw.shortcutsCustom),
    setup: pick('setup', raw.setup),
    proxy: onOff(raw.proxy), vpn: onOff(raw.vpn), vpnApp: pick('vpnApp', raw.vpnApp),
    extensions: smallBucket(raw.extensions), profiles: profileBucket(raw.profiles), workspaces: profileBucket(raw.workspaces), siteProtectionOff: siteBucket(raw.siteProtectionOff),
    tabsOpen: tabsBucket(most('tabsOpen')), windows: windowsBucket(most('windows')), splitPanes: panesBucket(most('splitPanes')),
    importSource: pick('importSource', raw.importSource),
    passwordsImported: yesNo(raw.passwordsImported),
    signBackIn: signBackInBucket(raw.signBackIn),
    // Beta 14's own settings (B8): a closed-list value, 'unknown' when the setting is not there or could not be read
    activeBorderStyle: pickLoose('activeBorderStyle', raw.activeBorderStyle), ambientMode: onOff(raw.ambientMode), favoritesTileOnly: onOff(raw.favoritesTileOnly),
    favoritesBeforeStack: pickLoose('favoritesBeforeStack', raw.favoritesBeforeStack), ctrlTabMode: pickLoose('ctrlTabMode', raw.ctrlTabMode), tabSwitcherPictures: onOff(raw.tabSwitcherPictures),
    hiddenSidebarReveal: pickLoose('hiddenSidebarReveal', raw.hiddenSidebarReveal), loadAhead: pickLoose('loadAhead', raw.loadAhead), searchSuggestions: pickLoose('searchSuggestions', searchSuggestionsOf(raw.searchSuggestions)),
    imageSearchService: pickLoose('imageSearchService', raw.imageSearchService), autoPictureInPicture: onOff(raw.autoPictureInPicture), easyFiles: onOff(raw.easyFiles),
    screenshotButton: pickLoose('screenshotButton', raw.screenshotButton), newTabPictureSet: pickLoose('newTabPictureSet', raw.newTabPictureSet),
  };
  for (const name of USES) out[name] = countBucket(uses && uses[name]);
  return out;
}

/** Schema 4: the facts of `sanitize` plus the engagement, health and funnel fields, each from a number, a flag or a name the caller computed locally.
 *  A fact that could not be read (undefined) is left out of the message, never guessed: the server stores it as NULL. Order = MESSAGE_ORDER. */
function sanitize4(raw = {}, state = {}) {
  const base = sanitize(raw, state.uses, state.peaks), out = {}, set = (name, value) => { if (value !== undefined) out[name] = value; };
  const unknown = (value) => (value === true || value === 'yes' ? 'yes' : value === false || value === 'no' ? 'no' : 'unknown');
  const flags = state.flags || {};
  for (const name of ['firstToday', 'firstThisWeek', 'firstThisMonth', 'firstEver']) set(name, flags[name] === true ? 'yes' : flags[name] === false ? 'no' : undefined);
  if (flags.returning === true && flags.firstEver === true) out.returning = 'yes'; // only a first message can be a returning install
  if (typeof flags.installWeek === 'string' && INSTALL_WEEK.test(flags.installWeek)) out.installWeek = flags.installWeek;
  if (Number.isInteger(flags.installDay) && flags.installDay >= 0 && flags.installDay <= 29) out.installDay = String(flags.installDay);
  for (const name of SNAPSHOT) out[name] = base[name];
  const day = state.day || {};
  out.minutesActive = minutesBucket(day.seconds);
  out.sessions = sessionsBucket(day.sessions);
  out.pagesLoaded = pagesBucket(day.pages);
  for (const engine of SEARCH_ENGINES) out[searchField(engine)] = searchBucket(day.searches && day.searches[engine]);
  set('daysSinceInstall', Number.isFinite(flags.daysSinceInstall) ? daysBucket(flags.daysSinceInstall) : undefined);
  out.defaultBrowser = unknown(raw.defaultBrowser); out.pinnedToTaskbar = unknown(raw.pinnedToTaskbar); out.inDock = unknown(raw.inDock); out.openedAtStartup = unknown(day.login ?? raw.openedAtStartup);
  set('settingsSection', settingsSectionOf(day.topSection) || 'none');
  for (const name of USES) out[name] = base[name];
  for (const [field, names] of [['everUsed', state.ever], ['usedInFirst3Days', state.early]]) { const list = USES.filter((name) => names && names[name]); out[field] = list; }
  set('coldStartMs', coldStartBucket(raw.coldStartMs));
  out.crashes = crashBucket(day.crashes);
  if (typeof raw.updateFrom === 'string' && raw.updateFrom.length <= 24 && VERSION.test(raw.updateFrom)) out.updateFrom = raw.updateFrom;
  out.updateResult = UPDATE_RESULTS.includes(raw.updateResult) ? raw.updateResult : 'none';
  set('memoryPeak', memoryBucket(day.memory));
  out.gpuAccel = unknown(raw.gpuAccel);
  out.osVersion = osVersionBucket(raw.platform, raw.systemVersion);
  set('displayScale', Number(raw.displayScale) > 0 ? displayScaleBucket(raw.displayScale) : undefined);
  set('monitors', monitorsBucket(raw.monitors));
  out.trackersBlocked = trackerBucket(day.trackers);
  out.filterListsUpdated = unknown(raw.filterListsUpdated);
  const funnel = state.funnel;
  if (funnel) {
    if (SETUP_PATHS.includes(funnel.path)) out.setupPath = funnel.path;
    if (SETUP_STEPS.includes(funnel.step)) out.setupStepReached = funnel.step;
    set('setupSeconds', setupSecondsBucket(funnel.seconds));
    if (NOTICE_SEEN.includes(funnel.notice)) out.noticeSeen = funnel.notice;
  }
  const cards = (state.billboard || []).filter((card) => card && BILLBOARD_ID.test(card.id) && BILLBOARD_STATES.includes(card.state)).slice(0, 5).map((card) => ({ id: card.id, state: card.state }));
  if (cards.length) out.billboard = cards;
  const ordered = {}; for (const name of MESSAGE_ORDER) if (name in out) ordered[name] = out[name];
  return ordered;
}

/** Interface language setting ('system' or a catalog code) plus the OS locale, to one of the shipped codes. */
function uiLanguageOf(setting, systemLocale) {
  const wanted = !setting || setting === 'system' ? String(systemLocale || 'en') : String(setting);
  const exact = ENUMS.uiLanguage.find((code) => code.toLowerCase() === wanted.toLowerCase());
  if (exact) return exact;
  const base = wanted.slice(0, 2).toLowerCase(); // 'fr-CA' -> 'fr', 'zh-TW' -> 'zh-CN' has no catalog, so 'other'
  return ENUMS.uiLanguage.find((code) => code === base) || 'other';
}
/** How setup ended, from setup's own record. Skip setup writes `skipped` AND `complete`, so `skipped` is read first (13.8 read `complete` first and
 *  reported every skipped setup as completed). */
const setupFactOf = (installation) => (installation && installation.skipped ? 'skipped' : installation && installation.complete ? 'completed' : 'unknown');
const importFamily = (sourceId) => {
  const id = String(sourceId || '').toLowerCase();
  for (const name of ['chrome', 'edge', 'firefox', 'brave', 'arc', 'opera', 'vivaldi', 'zen', 'safari']) if (id.includes(name)) return name;
  return id.includes('html') ? 'html' : id ? 'other' : 'none';
};
const searchEngineOf = (id) => { const wanted = String(id || '').toLowerCase(); return ENUMS.searchEngine.includes(wanted) && wanted !== 'other' ? wanted : 'other'; };
/** The detected VPN app (vpn-detect.cjs names) to a closed name; a VPN we do not list is just 'other'. */
const vpnAppOf = (name) => (ENUMS.vpnApp.includes(name) && name !== 'none' ? name : name ? 'other' : 'none');
/** Tab sleep as Settings › Memory saver shows it: `settings.memorySaver` is only written once someone changes it, and until then the
 *  switch (and tab-sleep.cjs) is on, so only an explicit `enabled: false` is off. */
const tabSleepOf = (memorySaver) => !(memorySaver && typeof memorySaver === 'object' && memorySaver.enabled === false);
/** Phishing and malware warnings, as the Settings switch and the protection panel read them: on while the open threat lists are on
 *  (privacy-plus `phishingLists`, on by default), or while Google Safe Browsing (with its own key) is ready. Unknown only when
 *  neither status could be read. */
function phishingProtectionOf(antiTrackingSettings, safeBrowsingStatus) {
  const lists = antiTrackingSettings && typeof antiTrackingSettings === 'object' ? antiTrackingSettings.phishingLists !== false : undefined;
  const google = safeBrowsingStatus && typeof safeBrowsingStatus === 'object' ? safeBrowsingStatus.state === 'ready' : undefined;
  return lists === undefined && google === undefined ? undefined : Boolean(lists || google);
}

module.exports = { ENUMS, USES, USES_V3, BETA14_SETTINGS, READ_FROM_SETTINGS, acceptReport, betaSettingsOf, searchSuggestionsOf, pickLoose, PEAKS, FIELDS, SNAPSHOT, FLAGS, ENGAGEMENT, HEALTH, FUNNEL, DISCOVERY, MESSAGE_ORDER, FALLBACK, COUNT_BUCKETS, SMALL_BUCKETS, PROFILE_BUCKETS, SITE_BUCKETS, SEARCH_ENGINES, SEARCH_FIELDS, SETUP_STEPS, SETUP_PATHS, NOTICE_SEEN, UPDATE_RESULTS, OFF_WHERE, UNINSTALL_REASONS, SURVEY_ID, SURVEY_ANSWERS, BILLBOARD_STATES, SETTINGS_SECTIONS, OS_VERSIONS, INSTALL_WEEK, VERSION, BILLBOARD_ID, searchField, sanitize, sanitize4, minutesBucket, sessionsBucket, pagesBucket, searchBucket, daysBucket, coldStartBucket, crashBucket, memoryBucket, trackerBucket, setupSecondsBucket, monitorsBucket, displayScaleBucket, osVersionBucket, isoWeekOf, addDaysTo, daysBetween, settingsSectionOf, countBucket, smallBucket, profileBucket, siteBucket, tabsBucket, windowsBucket, panesBucket, signBackInBucket, onOff, yesNo, uiLanguageOf, setupFactOf, importFamily, searchEngineOf, vpnAppOf, tabSleepOf, phishingProtectionOf };
