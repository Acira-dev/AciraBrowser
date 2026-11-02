'use strict';
// The coarse, anonymous facts in the daily usage message (schema 3, R4-60). Everything here is a choice from a CLOSED list or a bucket:
// no URL, site, search term, title, name, path, address, exact count or free text can pass `sanitize`, whatever the caller supplies.
// supabase/functions/usage/handler.mjs repeats the same lists for the server side; tests/supabase-metrics-v3.test.mjs and tests/metrics.test.cjs
// fail if they drift apart. Why each field exists: docs/launch/METRICS.md.
const COUNT_BUCKETS = Object.freeze(['0', '1-2', '3-9', '10+']);          // how many times a feature was used since the last message (about a day)
const SMALL_BUCKETS = Object.freeze(['0', '1', '2-3', '4-6', '7+']);        // extensions installed, across profiles
const PROFILE_BUCKETS = Object.freeze(['1', '2', '3-4', '5+']);             // profiles, workspaces
const SITE_BUCKETS = Object.freeze(['0', '1', '2-5', '6+']);                // sites where protection was switched off
const ON_OFF = Object.freeze(['on', 'off', 'unknown']);
const YES_NO = Object.freeze(['yes', 'no']);
const ENUMS = Object.freeze({
  // How Acira is set up
  theme: ['light', 'dark', 'system'],
  finish: ['porcelain', 'burgundy', 'deep-blue', 'ocean-blue', 'iphone-blue', 'emerald-green', 'alpine-green', 'deep-purple', 'desert-titanium', 'natural-titanium', 'silver', 'black-titanium', 'custom', 'unknown'],
  windowView: ['full', 'compact', 'focus', 'seamless', 'unknown'],
  tabLayout: ['strip', 'sidebar', 'compact', 'dynamic', 'unknown'],
  toolbar: ['expanded', 'automatic', 'unknown'],
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
  importSource: ['none', 'chrome', 'edge', 'firefox', 'brave', 'arc', 'opera', 'vivaldi', 'safari', 'html', 'other'],
  passwordsImported: YES_NO,
  signBackIn: ['none', '0', '1-49', '50-99', '100'],
});
// Feature use counts, as buckets of the number of times used since the last message that was sent.
const USES = Object.freeze(['torTabs', 'torWindows', 'privateTabs', 'privateWindows', 'splitView', 'rewind', 'tabSets', 'peek', 'seamlessReveals', 'workspaceSwitches', 'tabGroups', 'vpnToggles', 'mediaControls', 'commandBar', 'protectionPanel']);
/** Daily highest values (kept as small integers locally, sent only as buckets). */
const PEAKS = Object.freeze(['tabsOpen', 'windows', 'splitPanes']);
const FIELDS = Object.freeze([...Object.keys(ENUMS), ...USES]);
const FALLBACK = Object.freeze({ finish: 'unknown', windowView: 'unknown', tabLayout: 'unknown', toolbar: 'unknown', animation: 'unknown', interfaceScale: 'other', uiLanguage: 'other', searchEngine: 'other', importSource: 'none', theme: 'system', setup: 'unknown', vpnApp: 'none', shortcutsCustom: 'no', passwordsImported: 'no', signBackIn: 'none', extensions: '0', profiles: '1', workspaces: '1', siteProtectionOff: '0', tabsOpen: '1-5', windows: '1', splitPanes: 'none' });

const bucket = (count, edges) => { const n = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0; for (const [label, max] of edges) if (n <= max) return label; return edges.at(-1)[0]; };
const countBucket = (n) => bucket(n, [['0', 0], ['1-2', 2], ['3-9', 9], ['10+', Infinity]]);
const smallBucket = (n) => bucket(n, [['0', 0], ['1', 1], ['2-3', 3], ['4-6', 6], ['7+', Infinity]]);
const profileBucket = (n) => bucket(Math.max(1, n || 1), [['1', 1], ['2', 2], ['3-4', 4], ['5+', Infinity]]);
const siteBucket = (n) => bucket(n, [['0', 0], ['1', 1], ['2-5', 5], ['6+', Infinity]]);
const tabsBucket = (n) => bucket(Math.max(1, n || 1), [['1-5', 5], ['6-15', 15], ['16-40', 40], ['41-100', 100], ['101+', Infinity]]);
const windowsBucket = (n) => bucket(Math.max(1, n || 1), [['1', 1], ['2', 2], ['3-5', 5], ['6+', Infinity]]);
const panesBucket = (n) => (!Number.isFinite(n) || n < 2 ? 'none' : n >= 4 ? '4' : String(Math.floor(n)));
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

/** Maps raw local facts (counts as numbers, ids as the app stores them) to the message fields. Anything unexpected becomes a fallback value. */
function sanitize(raw = {}, uses = {}, peaks = {}) {
  const most = (name) => Math.max(Number(raw[name]) || 0, Number(peaks && peaks[name]) || 0);
  const out = {
    theme: pick('theme', raw.theme),
    finish: pick('finish', String(raw.finish ?? '').toLowerCase().replace(/\s+/g, '-')),
    windowView: pick('windowView', raw.windowView),
    tabLayout: pick('tabLayout', raw.tabLayout),
    toolbar: pick('toolbar', raw.toolbar),
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
  };
  for (const name of USES) out[name] = countBucket(uses && uses[name]);
  return out;
}

/** Interface language setting ('system' or a catalog code) plus the OS locale, to one of the shipped codes. */
function uiLanguageOf(setting, systemLocale) {
  const wanted = !setting || setting === 'system' ? String(systemLocale || 'en') : String(setting);
  const exact = ENUMS.uiLanguage.find((code) => code.toLowerCase() === wanted.toLowerCase());
  if (exact) return exact;
  const base = wanted.slice(0, 2).toLowerCase(); // 'fr-CA' -> 'fr', 'zh-TW' -> 'zh-CN' has no catalog, so 'other'
  return ENUMS.uiLanguage.find((code) => code === base) || 'other';
}
const importFamily = (sourceId) => {
  const id = String(sourceId || '').toLowerCase();
  for (const name of ['chrome', 'edge', 'firefox', 'brave', 'arc', 'opera', 'vivaldi', 'safari']) if (id.includes(name)) return name;
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

module.exports = { ENUMS, USES, PEAKS, FIELDS, FALLBACK, COUNT_BUCKETS, SMALL_BUCKETS, PROFILE_BUCKETS, SITE_BUCKETS, sanitize, countBucket, smallBucket, profileBucket, siteBucket, tabsBucket, windowsBucket, panesBucket, signBackInBucket, onOff, yesNo, uiLanguageOf, importFamily, searchEngineOf, vpnAppOf, tabSleepOf, phishingProtectionOf };
