// The whole logic of the `usage` Edge Function, with no Deno, network or database in it, so Node can run it in tests.
// index.ts supplies the real store (restStore) and the hashing salt; tests supply fakes.
//
// POST only. Five message types, each with exactly the fields the app sends (src: desktop/browser-services/metrics.cjs, usage-facts.cjs, feature-rating.cjs,
// and the Windows uninstaller, packaging/acira-installer.nsh):
//  - event "daily" (one a day per random install id; the id is replaced every 28 days): schema 4 (Beta 14) = the nine base fields (required) plus the first-of-day/week/
//    month/ever flags, the install week and day, coarse settings, engagement, feature use, discovery, health and setup-funnel facts, and the billboard measurement, every one
//    from a CLOSED list, a bucket or a fixed format (each optional, so a field the app no longer sends is simply NULL). Schema 3 (13.x builds) and schema 2 (Round 3 builds)
//    are still accepted exactly.
//  - event "off" (schema 4, once, the moment sharing is switched off): where it happened and how long Acira had been installed. No install id, nothing else.
//  - event "rating" (at most one a week, only when the person answered a feature-rating card): feature id, stars 1-5, app version, OS family, day. No install id.
//  - event "survey" (schema 4): the id of one of our own questions and an answer from a closed list. No install id, no text.
//  - event "uninstall" (Windows only, at most once per install: the uninstaller sends it when a person really removes Acira while usage sharing is on, never on an update;
//    packaging/acira-installer.nsh): the same random install id, app version, "win32", arch and day; schema 4 adds one optional reason from a closed list.
// Any other key or value is a 400, so free text, URLs and exact numbers cannot be stored. tests/supabase-metrics*.test.mjs fail if these lists
// drift from the client's or from the SQL check constraints.
// Answers 204 (stored or already stored), 202 (a deploy health probe: valid, storage reachable, nothing stored), 400 (anything wrong with the
// request), 405 (wrong method), 429 (rate limited), 503 (storage trouble). Never any body, never CORS headers (the app is not a web page),
// never a cookie. The source address is only ever used as a salted daily hash for the rate limit; it is never stored or logged.

/** Request size limit. The longest possible schema-4 daily message (every field at its longest allowed value, both discovery lists full, five billboard cards) is
 * computed by tests/supabase-metrics-v4.test.mjs; 10 KB fits it (Beta 14 added fifteen Insider names to the lists) with room for a short version suffix and still refuses anything bigger. */
export const MAX_BYTES = 10240;
/** A rating, off, survey or uninstall message is under 300 bytes; anything over 320 is not one. */
export const RATING_MAX_BYTES = 256;
export const OFF_MAX_BYTES = 320;
export const SURVEY_MAX_BYTES = 320;
export const UNINSTALL_MAX_BYTES = 320;
export const SAMPLE_ID = '00000000-0000-4000-8000-000000000000'; // the app's placeholder; a real opt-in never sends it, a health probe always does
const BASE_FIELDS = ['schema', 'event', 'installId', 'appVersion', 'channel', 'platform', 'arch', 'language', 'day'];

const ON_OFF = ['on', 'off', 'unknown'];
const YES_NO = ['yes', 'no'];
/** Schema 2 (Round 3). Kept exactly so a build made before schema 3 can still be counted. */
export const ENUMS_V2 = Object.freeze({
  theme: ['light', 'dark', 'system'],
  finish: ['porcelain', 'burgundy', 'deep-blue', 'ocean-blue', 'iphone-blue', 'emerald-green', 'alpine-green', 'deep-purple', 'desert-titanium', 'natural-titanium', 'silver', 'black-titanium', 'custom', 'unknown'],
  tabLayout: ['strip', 'sidebar', 'compact', 'dynamic', 'unknown'],
  toolbar: ['expanded', 'automatic', 'unknown'],
  animation: ['premium', 'fast', 'off', 'default', 'unknown'],
  uiLanguage: ['en', 'ar', 'de', 'es', 'fr', 'hi', 'it', 'ja', 'ko', 'pt-BR', 'ru', 'tr', 'zh-CN', 'other'],
  searchEngine: ['google', 'duckduckgo', 'bing', 'ecosia', 'brave', 'kagi', 'startpage', 'qwant', 'yahoo', 'other'],
  importSource: ['none', 'chrome', 'edge', 'firefox', 'brave', 'arc', 'opera', 'vivaldi', 'safari', 'html', 'other'],
  aiFree: ON_OFF,
  vpn: ON_OFF,
  vpnApp: ['none', 'Mullvad VPN', 'Proton VPN', 'IVPN', 'NordVPN', 'ExpressVPN', 'Surfshark', 'CyberGhost', 'Windscribe', 'Private Internet Access', 'Cloudflare WARP', 'Tailscale', 'TunnelBear', 'Hotspot Shield', 'OpenVPN', 'WireGuard', 'other'],
  extensions: ['0', '1', '2-3', '4-6', '7+'],
  profiles: ['1', '2', '3-4', '5+'],
  siteProtectionOff: ['0', '1', '2-5', '6+'],
});
export const USES_V2 = Object.freeze(['torTabs', 'torWindows', 'privateTabs', 'privateWindows', 'splitView', 'rewind', 'tabSets', 'peek']);
export const COUNTS_V2 = Object.freeze(['0', '1', '2-5', '6-20', '21+']);

/** Schema 3 (Round 4, R4-60): every schema-2 choice plus the rest of the audit. */
export const ENUMS = Object.freeze({
  ...ENUMS_V2,
  windowView: ['full', 'compact', 'focus', 'seamless', 'unknown'],
  interfaceScale: ['80', '90', '100', '110', '125', '150', 'other'],
  adBlocking: ON_OFF,
  phishingProtection: ON_OFF,
  linkPreview: ON_OFF,
  askBeforeClosing: ON_OFF,
  tabSleep: ON_OFF,
  proxy: ON_OFF,
  shortcutsCustom: YES_NO,
  passwordsImported: YES_NO,
  workspaces: ['1', '2', '3-4', '5+'],
  signBackIn: ['none', '0', '1-49', '50-99', '100'],
  setup: ['completed', 'skipped', 'unknown'],
  tabsOpen: ['1-5', '6-15', '16-40', '41-100', '101+'],
  windows: ['1', '2', '3-5', '6+'],
  splitPanes: ['none', '2', '3', '4'],
});
export const USES = Object.freeze([...USES_V2, 'seamlessReveals', 'workspaceSwitches', 'tabGroups', 'vpnToggles', 'mediaControls', 'commandBar', 'protectionPanel']);
/** Schema 3 use buckets: times used since the previous message that was sent (about a day). */
export const COUNTS = Object.freeze(['0', '1-2', '3-9', '10+']);

/** Schema 4 (Beta 14): every schema-3 choice plus first-of-period flags, engagement, health and the setup funnel. Mirrors desktop/browser-services/usage-facts.cjs. */
const YES_NO_UNKNOWN = ['yes', 'no', 'unknown'];
const { toolbar: _toolbarOfSchema3, ...ENUMS_FROM_V3 } = ENUMS; // schema 4 does not send `toolbar`: `windowView` already says it (compact = automatic)
export const ENUMS_V4 = Object.freeze({
  ...ENUMS_FROM_V3,
  tabLayout: ['strip', 'sidebar', 'shelf', 'compact', 'dynamic', 'unknown'],
  importSource: ['none', 'chrome', 'edge', 'firefox', 'brave', 'arc', 'opera', 'vivaldi', 'zen', 'safari', 'html', 'other'],
  firstToday: ['yes', 'no'],
  firstThisWeek: ['yes', 'no'],
  firstThisMonth: ['yes', 'no'],
  firstEver: ['yes', 'no'],
  returning: ['yes', 'no'],
  installDay: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20', '21', '22', '23', '24', '25', '26', '27', '28', '29'],
  minutesActive: ['0-5', '5-30', '30-120', '120+'],
  sessions: ['1', '2-3', '4-9', '10+'],
  pagesLoaded: ['0', '1-10', '11-50', '51-200', '200+'],
  daysSinceInstall: ['0', '1', '2-3', '4-7', '8-14', '15-28', '29+'],
  searchesGoogle: ['0', '1-5', '6-20', '20+'],
  searchesDuckduckgo: ['0', '1-5', '6-20', '20+'],
  searchesBing: ['0', '1-5', '6-20', '20+'],
  searchesEcosia: ['0', '1-5', '6-20', '20+'],
  searchesBrave: ['0', '1-5', '6-20', '20+'],
  searchesKagi: ['0', '1-5', '6-20', '20+'],
  searchesStartpage: ['0', '1-5', '6-20', '20+'],
  searchesQwant: ['0', '1-5', '6-20', '20+'],
  searchesYahoo: ['0', '1-5', '6-20', '20+'],
  searchesOther: ['0', '1-5', '6-20', '20+'],
  defaultBrowser: ['yes', 'no', 'unknown'],
  pinnedToTaskbar: ['yes', 'no', 'unknown'],
  inDock: ['yes', 'no', 'unknown'],
  openedAtStartup: ['yes', 'no', 'unknown'],
  settingsSection: ['none', 'appearance', 'profiles', 'tabs', 'new-tab', 'search', 'privacy', 'connection', 'accessibility', 'import-export', 'about'],
  coldStartMs: ['<1s', '1-2s', '2-4s', '4-8s', '8s+'],
  crashes: ['0', '1', '2-4', '5+'],
  updateResult: ['ok', 'failed', 'rolledBack', 'none'],
  memoryPeak: ['<1GB', '1-2GB', '2-4GB', '4GB+'],
  gpuAccel: ['yes', 'no', 'unknown'],
  osVersion: ['win10', 'win11', 'win-other', 'mac-11', 'mac-12', 'mac-13', 'mac-14', 'mac-15', 'mac-26', 'mac-27', 'mac-28', 'mac-other', 'linux', 'other'],
  displayScale: ['100', '125', '150', '175', '200', 'other'],
  monitors: ['1', '2', '3+'],
  trackersBlocked: ['0', '1-99', '100-999', '1000-9999', '10000+'],
  filterListsUpdated: ['yes', 'no', 'unknown'],
  setupPath: ['completed', 'defaults', 'skipped', 'abandoned'],
  setupStepReached: ['welcome', 'import', 'profile', 'appearance', 'cover', 'search', 'privacy', 'default', 'finish'],
  setupSeconds: ['<30s', '30-60s', '60-120s', '120-300s', '300s+'],
  noticeSeen: ['x', 'link', 'timeout', 'undoneThenX', 'none'],
  // Beta 14's own settings (B8)
  activeBorderStyle: ['divider-fade', 'lit-edge', 'hairline', 'inner-light', 'plain', 'unknown'],
  ambientMode: ['on', 'off', 'unknown'],
  favoritesTileOnly: ['on', 'off', 'unknown'],
  favoritesBeforeStack: ['6', '9', '12', '16', '20', 'all', 'unknown'],
  ctrlTabMode: ['next', 'recent', 'viewer', 'unknown'],
  tabSwitcherPictures: ['on', 'off', 'unknown'],
  hiddenSidebarReveal: ['edge', 'handle', 'never', 'unknown'],
  loadAhead: ['nothing', 'pinned', 'recent', 'unknown'],
  searchSuggestions: ['off', 'engine', 'service', 'custom', 'unknown'],
  imageSearchService: ['none', 'ask', 'google', 'tineye', 'yandex', 'bing', 'custom', 'unknown'],
  autoPictureInPicture: ['on', 'off', 'unknown'],
  easyFiles: ['on', 'off', 'unknown'],
  screenshotButton: ['off', 'sidebar', 'topbar', 'unknown'],
  newTabPictureSet: ['all', 'picks', 'unknown'],
});
/** Schema 4 uses: the schema-3 ones except `mediaControls` (now `nowPlayingCardActions`), then the new ones. Mirrors usage-facts.cjs USES; tests/supabase-metrics-v4.test.mjs fails if they drift apart. */
export const USES_V4 = Object.freeze([...USES.filter((name) => name !== 'mediaControls'),
  'downloads', 'bookmarksAdded', 'bookmarksOpened', 'historyOpened', 'findInPage', 'zoomChanges', 'passwordSaves', 'passwordFills', 'extensionInstalls', 'extensionPopupOpens',
  'importAttempted', 'importCompleted', 'settingsOpened', 'shortcutsEditorOpened', 'newTabPageActions', 'fullscreen', 'printOrSavePdf', 'siteProtectionToggles',
  'nowPlayingCardActions', 'pictureInPictureManual', 'pictureInPictureAutomatic', 'favoritesStackOpens', 'layoutPickerOpened', 'groupNested', 'groupReordered', 'tabSwitcherOpens', 'tabViewerOpens', 'bookmarksPopupOpens', 'extensionOverflowOpens', 'sidePanelOpens', 'pinnedTabSlept',
  'screenshotsArea', 'screenshotsVisible', 'screenshotsFull', 'zapUsed', 'zapRestored', 'easyFilesShown', 'easyFilesPickedClipboard', 'easyFilesPickedScreenshot', 'easyFilesPickedDownload', 'easyFilesPickedBrowse',
  'imageSearchesGoogle', 'imageSearchesTineye', 'imageSearchesYandex', 'imageSearchesBing', 'imageSearchesCustom', 'searchSuggestionPicked', 'devtoolsOpenedRight', 'devtoolsOpenedBottom', 'devtoolsOpenedWindow', 'feedbackSent',
  'insiderSheetShown', 'insiderActivated', 'insiderDeclined', 'insiderCodeOk', 'insiderCodeInvalid', 'insiderCodeUsed', 'insiderCodeExpired', 'insiderCodeRevoked', 'insiderCodeRateLimited', 'insiderCodeOffline', 'insiderInviteCreated', 'insiderInviteCopied', 'insiderMoveCodeMade', 'insiderChannelOn', 'insiderChannelOff', 'insiderSealCloser', 'insiderCardOpened', 'insiderCardShared']);
/** The fixed formats: an ISO week of the install, a version (updateFrom), a billboard card id (one of ours) and a survey id (one of ours). */
export const INSTALL_WEEK = /^20[2-9]\d-W(0[1-9]|[1-4]\d|5[0-3])$/;
export const BILLBOARD_ID = /^[a-z0-9][a-z0-9.-]{2,63}$/;
export const BILLBOARD_STATES = Object.freeze(['shown', 'x', 'undo', 'cta', 'secondary', 'timeout']);
export const SURVEY_ID = /^[a-z0-9][a-z0-9-]{2,31}$/;
export const SURVEY_ANSWERS = Object.freeze(['1', '2', '3', '4', '5', 'yes', 'no', 'a', 'b', 'c', 'd', 'e', 'skip']);
export const OFF_WHERE = Object.freeze(['setup', 'settings', 'uninstaller', 'notice']);
export const DAYS_BUCKETS = Object.freeze(ENUMS_V4.daysSinceInstall);
export const UNINSTALL_REASONS = Object.freeze(['slow', 'crashes', 'missing-feature', 'not-clear', 'switched-back', 'just-trying', 'other']);
/** The fields of a schema-4 daily message that are not a closed-list string: two lists of feature names, the install week, a version and the billboard measurement. */
export const LIST_FIELDS = Object.freeze({ everUsed: 'ever_used', usedInFirst3Days: 'used_in_first3_days' });

/** R4-61 feature ratings: the features a person can be asked about (only ones they used). */
export const RATING_FEATURES = Object.freeze(['splitView', 'windowViews', 'workspaces', 'peek', 'sidebarTabs', 'rewind', 'tabSets', 'adBlocking', 'signBackIn', 'newTabArtwork']);
const RATING_FIELDS = ['schema', 'event', 'feature', 'stars', 'appVersion', 'platform', 'day'];
/** The Windows uninstall message (packaging/acira-installer.nsh builds it; desktop/browser-services/metrics.cjs uninstallMessage shows it). */
export const UNINSTALL_FIELDS = Object.freeze(['schema', 'event', 'installId', 'appVersion', 'platform', 'arch', 'day']);
/** Only the Windows uninstaller can tell that Acira is being removed (a Mac app is dragged to the Trash; nothing runs). */
export const UNINSTALL_PLATFORMS = Object.freeze(['win32']);

/** A field's column: camelCase to snake_case, except `returning` (Beta 14, B9), which is a reserved word in SQL: its column is `is_returning`. */
const COLUMN_OVERRIDES = Object.freeze({ returning: 'is_returning' });
export const snake = (name) => COLUMN_OVERRIDES[name] ?? name.replace(/[A-Z]/g, (letter) => '_' + letter.toLowerCase());
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,4}(?:[-.][0-9A-Za-z.]{1,16}){0,2}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const CHANNELS = ['beta', 'stable'];
export const PLATFORMS = ['win32', 'darwin', 'linux'];
export const ARCHES = ['x64', 'arm64', 'ia32'];
/** Every daily_usage column the function writes (any schema: a schema-2 or -3 message still fills `toolbar` and `use_media_controls`), and every table's columns. The deploy health probe checks they exist. */
export const DAILY_COLUMNS = Object.freeze(['day', 'install_id', 'app_version', 'channel', 'platform', 'arch', 'language', 'schema_version', ...Object.keys({ ...ENUMS, ...ENUMS_V4 }).map(snake), 'install_week', 'update_from', ...Object.values(LIST_FIELDS), 'billboard', ...[...new Set([...USES, ...USES_V4])].map((name) => 'use_' + snake(name))]);
export const RATING_COLUMNS = Object.freeze(['day', 'feature', 'stars', 'app_version', 'platform']);
export const UNINSTALL_COLUMNS = Object.freeze(['install_id', 'day', 'app_version', 'platform', 'arch', 'reason']);
export const OFF_COLUMNS = Object.freeze(['day', 'off_where', 'days_since_install', 'app_version', 'platform']);
export const SURVEY_COLUMNS = Object.freeze(['day', 'survey', 'answer', 'app_version', 'platform']);
/** [name, window in seconds, limit]. Per source address (all messages), per install id (daily), per address for ratings, uninstalls, offs and surveys
 * (an install sends at most one uninstall message; a repeat of the same id is ignored by the table's primary key). */
export const LIMITS = Object.freeze({ ipHour: ['h', 3600, 30], ipDay: ['d', 86400, 200], idDay: ['i', 86400, 2], ratingDay: ['r', 86400, 4], uninstallDay: ['u', 86400, 3], offDay: ['o', 86400, 5], surveyDay: ['s', 86400, 20] });
const DAY_MS = 86400000;

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const exactly = (keys, allowed) => keys.length === allowed.length && allowed.every((key) => keys.includes(key));
const versionOk = (value) => typeof value === 'string' && value.length <= 24 && VERSION.test(value);
/** A real release (Beta 14, B9): 1.2.3, 1.2.3-beta.14 or 1.2.3-beta.13.8. Anything else (a development, QA, test or rehearsal label, a made-up string) is dropped, so it can never reach a dashboard number. A health probe may
 *  use the placeholder version, nothing else may. The same pattern is a check constraint in the migration. */
export const RELEASE_VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,4}(?:-beta\.\d{1,3}(?:\.\d{1,3})?)?$/;
export const PROBE_VERSION = '0.0.0-probe';
const releaseOk = (value, probe = false) => versionOk(value) && (RELEASE_VERSION.test(value) || (probe && value === PROBE_VERSION));
/** A real calendar date within 2 days of the server's date (time zones, late sends, a computer whose clock is wrong). Anything further is dropped (Beta 14, B9). */
function dayOk(day, now) {
  if (typeof day !== 'string' || !DAY.test(day)) return false;
  const when = Date.parse(day + 'T00:00:00Z');
  if (!Number.isFinite(when) || new Date(when).toISOString().slice(0, 10) !== day) return false;
  const today = Date.parse(new Date(now).toISOString().slice(0, 10) + 'T00:00:00Z');
  return Math.abs(when - today) <= 2 * DAY_MS;
}

const idOk = (installId, probe) => typeof installId === 'string' && UUID_V4.test(installId) && (probe ? installId === SAMPLE_ID : installId !== SAMPLE_ID);

/** Returns the daily_usage row to store, or null when the body is not exactly a valid daily message. `probe` accepts only the placeholder id. */
export function validate(value, now = Date.now(), { probe = false } = {}) {
  if (!isObject(value)) return null;
  const keys = Object.keys(value);
  const { schema, event, installId, appVersion, channel, platform, arch, language, day } = value;
  if (event !== 'daily' || (schema !== 2 && schema !== 3 && schema !== 4)) return null;
  const enums = schema === 2 ? ENUMS_V2 : schema === 3 ? ENUMS : ENUMS_V4, uses = schema === 2 ? USES_V2 : schema === 3 ? USES : USES_V4, counts = schema === 2 ? COUNTS_V2 : COUNTS;
  const extras = schema === 4 ? ['installWeek', 'updateFrom', ...Object.keys(LIST_FIELDS), 'billboard'] : [];
  const facts = [...Object.keys(enums), ...uses, ...extras];
  if (schema === 2 && !exactly(keys, [...BASE_FIELDS, ...facts])) return null;
  // Schemas 3 and 4: the base fields are required; each fact may be left out (stored as NULL), but no key outside the list is allowed.
  if (schema >= 3 && (!BASE_FIELDS.every((key) => keys.includes(key)) || !keys.every((key) => BASE_FIELDS.includes(key) || facts.includes(key)))) return null;
  if (!idOk(installId, probe)) return null;
  if (!releaseOk(appVersion, probe)) return null;
  if (!CHANNELS.includes(channel) || !PLATFORMS.includes(platform) || !ARCHES.includes(arch)) return null;
  if (typeof language !== 'string' || !/^[a-z]{2}$/.test(language)) return null;
  if (!dayOk(day, now)) return null;
  const row = { day, install_id: installId, app_version: appVersion, channel, platform, arch, language, schema_version: schema };
  for (const [field, allowed] of Object.entries(enums)) {
    if (!(field in value)) continue;
    const item = value[field]; if (typeof item !== 'string' || !allowed.includes(item)) return null; row[snake(field)] = item;
  }
  for (const field of uses) {
    if (!(field in value)) continue;
    const item = value[field]; if (typeof item !== 'string' || !counts.includes(item)) return null; row['use_' + snake(field)] = item;
  }
  if (schema === 4) {
    if ('installWeek' in value) { if (typeof value.installWeek !== 'string' || !INSTALL_WEEK.test(value.installWeek)) return null; row.install_week = value.installWeek; }
    if ('updateFrom' in value) { if (!versionOk(value.updateFrom)) return null; row.update_from = value.updateFrom; }
    for (const [field, column] of Object.entries(LIST_FIELDS)) {
      if (!(field in value)) continue;
      const list = value[field];
      // A set of feature names from the closed list: no repeat, no other word.
      if (!Array.isArray(list) || list.length > USES_V4.length || new Set(list).size !== list.length || !list.every((name) => typeof name === 'string' && USES_V4.includes(name))) return null;
      row[column] = [...list].sort();
    }
    if ('billboard' in value) {
      const cards = value.billboard;
      if (!Array.isArray(cards) || cards.length > 5) return null;
      const seen = new Set();
      for (const card of cards) {
        if (!isObject(card) || !exactly(Object.keys(card), ['id', 'state']) || typeof card.id !== 'string' || !BILLBOARD_ID.test(card.id) || !BILLBOARD_STATES.includes(card.state)) return null;
        seen.add(card.id + ':' + card.state);
      }
      if (seen.size !== cards.length) return null;
      row.billboard = [...seen].sort();
    }
  }
  return row;
}

/** Returns the feature_ratings row to store, or null when the body is not exactly a valid rating message. */
export function validateRating(value, now = Date.now(), { probe = false } = {}) {
  if (!isObject(value) || !exactly(Object.keys(value), RATING_FIELDS)) return null;
  const { schema, event, feature, stars, appVersion, platform, day } = value;
  if (schema !== 1 || event !== 'rating') return null;
  if (typeof feature !== 'string' || !RATING_FEATURES.includes(feature)) return null;
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) return null;
  if (!releaseOk(appVersion, probe) || !PLATFORMS.includes(platform) || !dayOk(day, now)) return null;
  return { day, feature, stars, app_version: appVersion, platform };
}

/** Returns the usage_uninstalls row to store, or null when the body is not exactly a valid uninstall message: schema 1 (the seven fields the installer builds) or
 * schema 4 (the same plus one optional `reason` from a closed list). `probe` accepts only the placeholder id. */
export function validateUninstall(value, now = Date.now(), { probe = false } = {}) {
  if (!isObject(value)) return null;
  const keys = Object.keys(value);
  const { schema, event, installId, appVersion, platform, arch, day, reason } = value;
  if (event !== 'uninstall' || (schema !== 1 && schema !== 4)) return null;
  if (schema === 1 ? !exactly(keys, UNINSTALL_FIELDS) : !(UNINSTALL_FIELDS.every((key) => keys.includes(key)) && keys.every((key) => UNINSTALL_FIELDS.includes(key) || key === 'reason'))) return null;
  if (!idOk(installId, probe) || !releaseOk(appVersion, probe) || !UNINSTALL_PLATFORMS.includes(platform) || !ARCHES.includes(arch) || !dayOk(day, now)) return null;
  if (reason !== undefined && (typeof reason !== 'string' || !UNINSTALL_REASONS.includes(reason))) return null;
  return { install_id: installId, day, app_version: appVersion, platform, arch, ...(reason === undefined ? {} : { reason }) };
}

/** Returns the usage_off row to store: sharing was switched off. No install id; where it happened and how long Acira had been installed. */
export function validateOff(value, now = Date.now(), { probe = false } = {}) {
  if (!isObject(value)) return null;
  const keys = Object.keys(value), allowed = ['schema', 'event', 'where', 'daysSinceInstall', 'appVersion', 'platform', 'day'];
  if (!keys.every((key) => allowed.includes(key)) || !['schema', 'event', 'where', 'appVersion', 'platform', 'day'].every((key) => keys.includes(key))) return null;
  const { schema, event, where, daysSinceInstall, appVersion, platform, day } = value;
  if (schema !== 4 || event !== 'off' || typeof where !== 'string' || !OFF_WHERE.includes(where)) return null;
  if ('daysSinceInstall' in value && (typeof daysSinceInstall !== 'string' || !DAYS_BUCKETS.includes(daysSinceInstall))) return null;
  if (!releaseOk(appVersion, probe) || !PLATFORMS.includes(platform) || !dayOk(day, now)) return null;
  return { day, off_where: where, ...('daysSinceInstall' in value ? { days_since_install: daysSinceInstall } : {}), app_version: appVersion, platform };
}

/** Returns the usage_surveys row to store: the id of one of our own questions and an answer from a closed list. No install id, no text. */
export function validateSurvey(value, now = Date.now(), { probe = false } = {}) {
  if (!isObject(value) || !exactly(Object.keys(value), ['schema', 'event', 'survey', 'answer', 'appVersion', 'platform', 'day'])) return null;
  const { schema, event, survey, answer, appVersion, platform, day } = value;
  if (schema !== 4 || event !== 'survey' || typeof survey !== 'string' || !SURVEY_ID.test(survey) || typeof answer !== 'string' || !SURVEY_ANSWERS.includes(answer)) return null;
  if (!releaseOk(appVersion, probe) || !PLATFORMS.includes(platform) || !dayOk(day, now)) return null;
  return { day, survey, answer, app_version: appVersion, platform };
}

/** The health-probe messages the deploy script sends with `X-Acira-Probe: 1`. They pass validation, reach storage, and store nothing. */
export const PROBES = Object.freeze({
  daily: (day) => ({ schema: 4, event: 'daily', installId: SAMPLE_ID, appVersion: '0.0.0-probe', channel: 'beta', platform: 'linux', arch: 'x64', language: 'en', day, windowView: 'full', splitView: '0', firstEver: 'no', everUsed: ['peek'] }),
  rating: (day) => ({ schema: 1, event: 'rating', feature: 'splitView', stars: 5, appVersion: '0.0.0-probe', platform: 'linux', day }),
  uninstall: (day) => ({ schema: 1, event: 'uninstall', installId: SAMPLE_ID, appVersion: '0.0.0-probe', platform: 'win32', arch: 'x64', day }),
  off: (day) => ({ schema: 4, event: 'off', where: 'settings', daysSinceInstall: '0', appVersion: '0.0.0-probe', platform: 'linux', day }),
  survey: (day) => ({ schema: 4, event: 'survey', survey: 'probe', answer: 'yes', appVersion: '0.0.0-probe', platform: 'linux', day }),
});

const hex = (buffer) => [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
/** A salted hash of the address that changes every day, so a stored counter key can never be turned back into an address or followed across days. */
export async function addressKey(address, secret, day) {
  const bytes = new TextEncoder().encode(`${secret}:${day}:${address}`);
  return hex(await crypto.subtle.digest('SHA-256', bytes)).slice(0, 32);
}
export const sourceAddress = (headers) => String(headers.get('x-forwarded-for') || headers.get('cf-connecting-ip') || headers.get('x-real-ip') || 'unknown').split(',')[0].trim().slice(0, 64) || 'unknown';

const reply = (status, headers = {}) => new Response(null, { status, headers });
const LIMITED = { 'Retry-After': '3600' };

/** `store.hit(key, windowSeconds, limit)` -> true when allowed; `store.insert(row)` stores one daily row (a repeat of day+install id is not an error);
 * `store.insertRating(row)` stores one rating; `store.insertUninstall(row)` stores one uninstall (a repeat of the install id is not an error);
 * `store.probe(table, columns)` -> true when the table and every column exist (reads no row). */
export function createHandler({ store, secret, now = () => Date.now() }) {
  return async function handle(request) {
    if (request.method !== 'POST') return reply(405, { Allow: 'POST' });
    const declared = Number(request.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_BYTES) return reply(400);
    let text;
    try { text = await request.text(); } catch { return reply(400); }
    const size = new TextEncoder().encode(text).length;
    if (size > MAX_BYTES) return reply(400);
    let body;
    try { body = JSON.parse(text); } catch { return reply(400); }
    const probe = request.headers.get('x-acira-probe') === '1', time = now();
    const kind = isObject(body) && ['rating', 'uninstall', 'off', 'survey'].includes(body.event) ? body.event : 'daily';
    const row = kind === 'rating' ? (size <= RATING_MAX_BYTES ? validateRating(body, time, { probe }) : null)
      : kind === 'uninstall' ? (size <= UNINSTALL_MAX_BYTES ? validateUninstall(body, time, { probe }) : null)
      : kind === 'off' ? (size <= OFF_MAX_BYTES ? validateOff(body, time, { probe }) : null)
      : kind === 'survey' ? (size <= SURVEY_MAX_BYTES ? validateSurvey(body, time, { probe }) : null)
      : validate(body, time, { probe });
    if (!row) return reply(400);
    try {
      const today = new Date(time).toISOString().slice(0, 10);
      const ip = await addressKey(sourceAddress(request.headers), secret, today);
      const checks = [[`ip:${ip}:${LIMITS.ipHour[0]}`, ...LIMITS.ipHour.slice(1)]];
      if (!probe) {
        checks.push([`ip:${ip}:${LIMITS.ipDay[0]}`, ...LIMITS.ipDay.slice(1)]);
        // Messages that carry no install id are limited per address; the daily message per install id.
        const prefix = { rating: 'rt', uninstall: 'un', off: 'of', survey: 'sv' }[kind], perAddress = { rating: LIMITS.ratingDay, uninstall: LIMITS.uninstallDay, off: LIMITS.offDay, survey: LIMITS.surveyDay }[kind];
        checks.push(perAddress ? [`${prefix}:${ip}:${today}:${perAddress[0]}`, ...perAddress.slice(1)] : [`id:${row.install_id}:${today}:${LIMITS.idDay[0]}`, ...LIMITS.idDay.slice(1)]);
      }
      for (const [key, seconds, limit] of checks) if (!(await store.hit(key, seconds, limit))) return reply(429, LIMITED);
      const tables = { daily: ['daily_usage', DAILY_COLUMNS], rating: ['feature_ratings', RATING_COLUMNS], uninstall: ['usage_uninstalls', UNINSTALL_COLUMNS], off: ['usage_off', OFF_COLUMNS], survey: ['usage_surveys', SURVEY_COLUMNS] };
      if (probe) return reply((await store.probe(...tables[kind])) ? 202 : 503);
      await { daily: store.insert, rating: store.insertRating, uninstall: store.insertUninstall, off: store.insertOff, survey: store.insertSurvey }[kind].call(store, row);
      return reply(204);
    } catch { return reply(503); }
  };
}
