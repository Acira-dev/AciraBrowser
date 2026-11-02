// The whole logic of the `usage` Edge Function, with no Deno, network or database in it, so Node can run it in tests.
// index.ts supplies the real store (restStore) and the hashing salt; tests supply fakes.
//
// POST only. Two message types, each with exactly the fields the app sends (src: desktop/browser-services/metrics.cjs, usage-facts.cjs, feature-rating.cjs):
//  - event "daily" (one a day per random install id): schema 3 = the nine base fields (required) plus coarse facts, every one from a CLOSED
//    list or a bucket (each optional, so a field the app no longer sends is simply NULL). Schema 2 (Round 3 builds) is still accepted exactly.
//  - event "rating" (at most one a week, only when the person answered a feature-rating card): feature id, stars 1-5, app version, OS family, day.
//    No install id, no free text, nothing else.
// Any other key or value is a 400, so free text, URLs and exact numbers cannot be stored. tests/supabase-metrics*.test.mjs fail if these lists
// drift from the client's or from the SQL check constraints.
// Answers 204 (stored or already stored), 202 (a deploy health probe: valid, storage reachable, nothing stored), 400 (anything wrong with the
// request), 405 (wrong method), 429 (rate limited), 503 (storage trouble). Never any body, never CORS headers (the app is not a web page),
// never a cookie. The source address is only ever used as a salted daily hash for the rate limit; it is never stored or logged.

/** Request size limit. The longest possible schema-3 daily message (every field at its longest allowed value) is about 1.6 KB;
 * tests/supabase-metrics-v3.test.mjs computes it. 2 KB fits that with room for a short version suffix and still refuses anything bigger. */
export const MAX_BYTES = 2048;
/** A rating message is under 140 bytes; anything over 256 is not one. */
export const RATING_MAX_BYTES = 256;
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

/** R4-61 feature ratings: the features a person can be asked about (only ones they used). */
export const RATING_FEATURES = Object.freeze(['splitView', 'windowViews', 'workspaces', 'peek', 'sidebarTabs', 'rewind', 'tabSets', 'adBlocking', 'signBackIn', 'newTabArtwork']);
const RATING_FIELDS = ['schema', 'event', 'feature', 'stars', 'appVersion', 'platform', 'day'];

export const snake = (name) => name.replace(/[A-Z]/g, (letter) => '_' + letter.toLowerCase());
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,4}(?:[-.][0-9A-Za-z.]{1,16}){0,2}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const CHANNELS = ['beta', 'stable'];
export const PLATFORMS = ['win32', 'darwin', 'linux'];
export const ARCHES = ['x64', 'arm64', 'ia32'];
/** Every daily_usage column the function writes (schema 3), and every feature_ratings column. The deploy health probe checks they exist. */
export const DAILY_COLUMNS = Object.freeze(['day', 'install_id', 'app_version', 'channel', 'platform', 'arch', 'language', 'schema_version', ...Object.keys(ENUMS).map(snake), ...USES.map((name) => 'use_' + snake(name))]);
export const RATING_COLUMNS = Object.freeze(['day', 'feature', 'stars', 'app_version', 'platform']);
/** [name, window in seconds, limit]. Per source address (all messages), per install id (daily), per address for ratings. */
export const LIMITS = Object.freeze({ ipHour: ['h', 3600, 30], ipDay: ['d', 86400, 200], idDay: ['i', 86400, 2], ratingDay: ['r', 86400, 4] });
const DAY_MS = 86400000;

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const exactly = (keys, allowed) => keys.length === allowed.length && allowed.every((key) => keys.includes(key));
const versionOk = (value) => typeof value === 'string' && value.length <= 24 && VERSION.test(value);
/** A real calendar date within one day of the server's date (time zones, late sends). */
function dayOk(day, now) {
  if (typeof day !== 'string' || !DAY.test(day)) return false;
  const when = Date.parse(day + 'T00:00:00Z');
  if (!Number.isFinite(when) || new Date(when).toISOString().slice(0, 10) !== day) return false;
  const today = Date.parse(new Date(now).toISOString().slice(0, 10) + 'T00:00:00Z');
  return Math.abs(when - today) <= DAY_MS;
}

/** Returns the daily_usage row to store, or null when the body is not exactly a valid daily message. `probe` accepts only the placeholder id. */
export function validate(value, now = Date.now(), { probe = false } = {}) {
  if (!isObject(value)) return null;
  const keys = Object.keys(value);
  const { schema, event, installId, appVersion, channel, platform, arch, language, day } = value;
  if (event !== 'daily' || (schema !== 2 && schema !== 3)) return null;
  const enums = schema === 2 ? ENUMS_V2 : ENUMS, uses = schema === 2 ? USES_V2 : USES, counts = schema === 2 ? COUNTS_V2 : COUNTS;
  const facts = [...Object.keys(enums), ...uses];
  if (schema === 2 && !exactly(keys, [...BASE_FIELDS, ...facts])) return null;
  // Schema 3: the base fields are required; each fact may be left out (stored as NULL), but no key outside the list is allowed.
  if (schema === 3 && (!BASE_FIELDS.every((key) => keys.includes(key)) || !keys.every((key) => BASE_FIELDS.includes(key) || facts.includes(key)))) return null;
  if (typeof installId !== 'string' || !UUID_V4.test(installId) || (probe ? installId !== SAMPLE_ID : installId === SAMPLE_ID)) return null;
  if (!versionOk(appVersion)) return null;
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
  return row;
}

/** Returns the feature_ratings row to store, or null when the body is not exactly a valid rating message. */
export function validateRating(value, now = Date.now()) {
  if (!isObject(value) || !exactly(Object.keys(value), RATING_FIELDS)) return null;
  const { schema, event, feature, stars, appVersion, platform, day } = value;
  if (schema !== 1 || event !== 'rating') return null;
  if (typeof feature !== 'string' || !RATING_FEATURES.includes(feature)) return null;
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) return null;
  if (!versionOk(appVersion) || !PLATFORMS.includes(platform) || !dayOk(day, now)) return null;
  return { day, feature, stars, app_version: appVersion, platform };
}

/** The two health-probe messages the deploy script sends with `X-Acira-Probe: 1`. They pass validation, reach storage, and store nothing. */
export const PROBES = Object.freeze({
  daily: (day) => ({ schema: 3, event: 'daily', installId: SAMPLE_ID, appVersion: '0.0.0-probe', channel: 'beta', platform: 'linux', arch: 'x64', language: 'en', day, windowView: 'full', splitView: '0' }),
  rating: (day) => ({ schema: 1, event: 'rating', feature: 'splitView', stars: 5, appVersion: '0.0.0-probe', platform: 'linux', day }),
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
 * `store.insertRating(row)` stores one rating; `store.probe(table, columns)` -> true when the table and every column exist (reads no row). */
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
    const rating = isObject(body) && body.event === 'rating';
    const row = rating ? (size <= RATING_MAX_BYTES ? validateRating(body, time) : null) : validate(body, time, { probe });
    if (!row) return reply(400);
    try {
      const today = new Date(time).toISOString().slice(0, 10);
      const ip = await addressKey(sourceAddress(request.headers), secret, today);
      const checks = [[`ip:${ip}:${LIMITS.ipHour[0]}`, ...LIMITS.ipHour.slice(1)]];
      if (!probe) {
        checks.push([`ip:${ip}:${LIMITS.ipDay[0]}`, ...LIMITS.ipDay.slice(1)]);
        checks.push(rating ? [`rt:${ip}:${today}:${LIMITS.ratingDay[0]}`, ...LIMITS.ratingDay.slice(1)] : [`id:${row.install_id}:${today}:${LIMITS.idDay[0]}`, ...LIMITS.idDay.slice(1)]);
      }
      for (const [key, seconds, limit] of checks) if (!(await store.hit(key, seconds, limit))) return reply(429, LIMITED);
      if (probe) return reply((await store.probe(rating ? 'feature_ratings' : 'daily_usage', rating ? RATING_COLUMNS : DAILY_COLUMNS)) ? 202 : 503);
      if (rating) await store.insertRating(row); else await store.insert(row);
      return reply(204);
    } catch { return reply(503); }
  };
}
