'use strict';
// The billboard (Beta 14, brief section D): one small card on the new-tab page for Acira's own news (a big release, a survey, the recognition programme).
// Never third-party ads, never remote HTML or code.
//
//   PULL     One public file beside the update feed (FILE_NAME), fetched on the update check's schedule through the same session and route (main.cjs).
//            A plain GET: no cookie, no Referer, no identifier, no query string, no redirect. The last good copy is kept on disk and every new tab reads
//            THAT copy; opening a tab never asks the network.
//   SIGNED   The file is what Mission Control's publish-billboard writes: {version: 1, generatedAt, notices: [...], signature}. The signature is Ed25519 over the UTF-8
//            bytes of canonical(file without its `signature`): JSON with recursively sorted keys and no whitespace (canonical below is the same function the publisher
//            uses). The public keys ship in the app (billboard-keys.cjs). Anything else (no signature, another key, one changed byte) is ignored whole.
//            `generatedAt` only goes up: an older signed file cannot bring back a card that a newer one removed (replay), and a copy older than CACHE_MAX_AGE
//            is not shown until the file is fetched again.
//   ON DEVICE  Each card's `audience` rule is judged here: platform, channel, language, version range, days since install (a minimum, or a bucket), has-not-used
//            features, sharing on/off, and the date window. A rule this build does not know makes the card NOT show (never "show to more people than meant").
//   ONE AT A TIME  A new card starts only when the last one started at least 7 days ago (`urgent` skips that wait), highest priority first. A card on screen
//            stays until it ends: X (with Undo), a click on its link, or maxAge after its first display (default 24 h). A closed card never returns.
//            An empty list, a card that is gone from the list, or a past endsAt removes it everywhere (the kill switch).
//   CONTENT  Plain text, links only to acira:// and acirabrowser.com, one of three fixed styles.
//   COUNTED  Every change of a card's state (shown, x, undo, cta, secondary, timeout) is told to `report(id, state)`; main hands it to the usage client (metrics.cjs noteBillboard),
//            which keeps it and sends it in the daily message as `billboard: [{id, state}]`, only while sharing is on. No beacon, no per-person link.
// Nothing here knows about the screen: main.cjs asks `current()`, the new-tab page draws what it returns.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { writeFileAtomic, readJsonFile } = require('../atomic-file.cjs');
const { lowerThan, isVersion } = require('./update-feeds.cjs');
const { checkedEndpoint } = require('./metrics.cjs');
const { feedFolderURL } = require('./release-feed.cjs');
const { PRODUCTION_KEYS } = require('./billboard-keys.cjs');
const { dayBucket, daysSinceInstall, BUCKETS } = require('./install-date.cjs');

const FILE_NAME = 'billboard.json';
const HOUR = 3600 * 1000, DAY = 24 * HOUR;
const SEVEN_DAYS = 7 * DAY, CACHE_MAX_AGE = 14 * DAY, UNDO_WINDOW = 2 * 60 * 1000;
const MAX_BYTES = 64 * 1024, MAX_NOTICES = 20, MAX_AGE_HOURS = 365 * 24, DEFAULT_AGE_HOURS = 24, MAX_CARDS_KEPT = 40, FUTURE_SLACK = 7 * DAY;
const REFRESH_EVERY = 2 * HOUR, REFRESH_JITTER = 10 * 60 * 1000, REFRESH_FIRST = 5 * 1000, MIN_GAP = 30 * 60 * 1000;
const STATES = Object.freeze(['shown', 'x', 'undo', 'cta', 'secondary', 'timeout']);
const STYLES = Object.freeze(['default', 'accent', 'update']);
const PLATFORMS = Object.freeze(['win32', 'darwin', 'linux']);
const CHANNELS = Object.freeze(['stable', 'beta']);
const AUDIENCE_KEYS = Object.freeze(['platforms', 'channels', 'languages', 'minDaysSinceInstall', 'notUsed', 'minVersion', 'maxVersion', 'daysSinceInstall', 'sharing']);
const NOTICE_KEYS = Object.freeze(['id', 'title', 'body', 'style', 'urgent', 'priority', 'startsAt', 'endsAt', 'maxAgeDays', 'maxAgeHours', 'cta', 'secondary', 'audience', 'translations']);
const ID = /^[a-z0-9][a-z0-9-]{1,63}$/;
const ISO = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}(?::?\d{2})?)$/;
const FEATURE = /^[A-Za-z][A-Za-z0-9]{1,31}$/;
const LANGUAGE = /^[a-z]{2}$/;
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
const LIMITS = Object.freeze({ title: 80, body: 280, cta: 32, secondary: 32, link: 300 });
const SPKI_ED25519 = Buffer.from('302a300506032b6570032100', 'hex');

// ───────────────────────────────────────────────── the file: signature and content

/** An Ed25519 public key (32 raw bytes, base64) as a Node key object; throws on anything else. */
function publicKeyOf(raw) {
  const bytes = Buffer.from(String(raw ?? ''), 'base64');
  if (bytes.length !== 32) throw new Error('An Ed25519 public key is 32 bytes.');
  return crypto.createPublicKey({ key: Buffer.concat([SPKI_ED25519, bytes]), format: 'der', type: 'spki' });
}

/** The keys a test profile may add: ACIRA_BILLBOARD_TEST_KEY="<id>:<base64 public key>", read ONLY while ACIRA_BROWSER_TEST_DATA is set. */
function testKeys(env = process.env) {
  if (!env.ACIRA_BROWSER_TEST_DATA || !env.ACIRA_BILLBOARD_TEST_KEY) return [];
  const match = /^([A-Za-z0-9._-]{1,32}):([A-Za-z0-9+/=]{43,44})$/.exec(env.ACIRA_BILLBOARD_TEST_KEY);
  return match ? [{ id: match[1], key: match[2] }] : [];
}

/** JSON with recursively sorted keys and no whitespace: the form the signature covers. The same function as publish-billboard's `canonical` (Mission Control). */
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}

/** The text of a link when it may be on a card: acira://<page>[/...] (lowercase letters, digits, dashes), or https://acirabrowser.com and its subdomains (no credentials, no port); otherwise null. */
function safeLink(value) {
  if (typeof value !== 'string' || !value || value.length > LIMITS.link || /[\s\u0000-\u001f\u007f]/.test(value)) return null;
  let url; try { url = new URL(value); } catch { return null; }
  if (url.username || url.password || url.port) return null;
  if (url.protocol === 'acira:') return /^[a-z0-9-]+$/.test(url.hostname) ? url.href : null;
  if (url.protocol === 'https:') return url.hostname === 'acirabrowser.com' || /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.acirabrowser\.com$/.test(url.hostname) ? url.href : null;
  return null;
}

/** Text without control characters, at most `max` long; '' only when `optional`. Anything else: null. */
const plain = (value, max, { optional = false } = {}) => {
  if (value === undefined || value === null) return optional ? '' : null;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (CONTROL.test(text) || text.length > max || (!optional && !text)) return null;
  return text;
};
const instant = (value) => (typeof value === 'string' && ISO.test(value) && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null);
const list = (value, ok, max = 12) => Array.isArray(value) && value.length > 0 && value.length <= max && value.every(ok) ? [...new Set(value)] : null;
const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value);

/** One notice as the browser keeps it, or {error}. Strict: an unknown key anywhere, a link that is not allowed, text with control characters or too long, a missing title,
 *  a window that is backwards: the notice is dropped (the others in the file stay). Names are the ones publish-billboard writes (toFileNotice). */
function cleanNotice(raw) {
  const fail = (error) => ({ error });
  if (!isObject(raw)) return fail('not an object');
  if (Object.keys(raw).some((key) => !NOTICE_KEYS.includes(key))) return fail('unknown field');
  if (typeof raw.id !== 'string' || !ID.test(raw.id)) return fail('id');
  const startsAt = raw.startsAt === undefined || raw.startsAt === null ? null : instant(raw.startsAt);
  const endsAt = raw.endsAt === undefined || raw.endsAt === null ? null : instant(raw.endsAt);
  if ((raw.startsAt != null && startsAt === null) || (raw.endsAt != null && endsAt === null) || (startsAt !== null && endsAt !== null && endsAt <= startsAt)) return fail('window');
  if (raw.maxAgeDays != null && raw.maxAgeHours != null) return fail('maxAge twice');
  let hours = DEFAULT_AGE_HOURS;
  if (raw.maxAgeHours != null) hours = raw.maxAgeHours; else if (raw.maxAgeDays != null) hours = Number.isInteger(raw.maxAgeDays) ? raw.maxAgeDays * 24 : NaN;
  if (!Number.isInteger(hours) || hours < 1 || hours > MAX_AGE_HOURS) return fail('maxAge');
  const priority = raw.priority === undefined ? 0 : raw.priority;
  if (!Number.isInteger(priority) || priority < -1000 || priority > 1000) return fail('priority');
  if (raw.urgent !== undefined && typeof raw.urgent !== 'boolean') return fail('urgent');
  const style = raw.style === undefined ? 'default' : raw.style;
  if (!STYLES.includes(style)) return fail('style');

  const show = {}, source = raw.audience === undefined || raw.audience === null ? {} : raw.audience;
  if (!isObject(source) || Object.keys(source).some((key) => !AUDIENCE_KEYS.includes(key))) return fail('audience rule');
  const given = (key) => source[key] !== undefined && source[key] !== null && !(Array.isArray(source[key]) && source[key].length === 0); // an empty list is "no rule" (the dashboard writes them)
  if (given('platforms') && !(show.platform = list(source.platforms, (v) => PLATFORMS.includes(v)))) return fail('audience.platforms');
  if (given('channels') && !(show.channel = list(source.channels, (v) => CHANNELS.includes(v)))) return fail('audience.channels');
  if (given('languages') && !(show.language = list(source.languages, (v) => typeof v === 'string' && LANGUAGE.test(v), 24))) return fail('audience.languages');
  for (const key of ['minVersion', 'maxVersion']) if (given(key)) { if (!isVersion(source[key])) return fail('audience.' + key); show[key] = source[key].trim(); }
  if (given('minDaysSinceInstall')) { if (!Number.isInteger(source.minDaysSinceInstall) || source.minDaysSinceInstall < 0 || source.minDaysSinceInstall > 10000) return fail('audience.minDaysSinceInstall'); show.minDays = source.minDaysSinceInstall; }
  if (given('daysSinceInstall') && !(show.daysSinceInstall = list(source.daysSinceInstall, (v) => BUCKETS.includes(v), BUCKETS.length))) return fail('audience.daysSinceInstall');
  if (given('notUsed') && !(show.notUsed = list(source.notUsed, (v) => typeof v === 'string' && FEATURE.test(v), 5))) return fail('audience.notUsed');
  if (given('sharing')) { if (source.sharing !== 'on' && source.sharing !== 'off') return fail('audience.sharing'); show.sharing = source.sharing; }

  // The words: the notice's own title/body/labels are the base text (the dashboard writes them in English); each language in `translations` may replace any of the four.
  const links = {};
  const button = (key) => {
    const given = raw[key];
    if (given === undefined || given === null) return { label: '' };
    if (!isObject(given) || Object.keys(given).some((name) => name !== 'label' && name !== 'url')) return null;
    const label = plain(given.label, LIMITS[key]), link = safeLink(given.url);
    if (label === null || link === null) return null;
    links[key] = link; return { label };
  };
  const cta = button('cta'), secondary = button('secondary');
  if (!cta || !secondary) return fail('button');
  const base = { title: plain(raw.title, LIMITS.title), body: plain(raw.body, LIMITS.body, { optional: true }), cta: cta.label, secondary: secondary.label };
  if (base.title === null || base.body === null) return fail('text');
  const translations = {}, rawTranslations = raw.translations === undefined || raw.translations === null ? {} : raw.translations;
  if (!isObject(rawTranslations) || Object.keys(rawTranslations).length > 24) return fail('translations');
  for (const [tag, text] of Object.entries(rawTranslations)) {
    if (!LANGUAGE.test(tag) || !isObject(text) || Object.keys(text).some((key) => !['title', 'body', 'cta_label', 'secondary_label'].includes(key))) return fail('translation ' + tag);
    const entry = { title: plain(text.title, LIMITS.title, { optional: true }), body: plain(text.body, LIMITS.body, { optional: true }), cta: plain(text.cta_label, LIMITS.cta, { optional: true }), secondary: plain(text.secondary_label, LIMITS.secondary, { optional: true }) };
    if (entry.title === null || entry.body === null || entry.cta === null || entry.secondary === null) return fail('translation ' + tag + ' text');
    translations[tag] = entry;
  }
  return { notice: { id: raw.id, startsAt, endsAt, maxAgeHours: hours, priority, urgent: raw.urgent === true, show, text: { base, translations }, links, style } };
}

/**
 * Checks and reads a billboard file. text: the file as fetched; keys: [{id, key}] (billboard-keys.cjs); afterAt: the newest `generatedAt` ever accepted here (ms); now: the clock.
 * {ok:true, generatedAt, notices, dropped} or {ok:false, reason}: 'too-large' | 'malformed' | 'no-key' | 'bad-signature' | 'bad-date' | 'stale'.
 */
function verifyFeed(text, { keys = PRODUCTION_KEYS, afterAt = 0, now = Date.now() } = {}) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_BYTES) return { ok: false, reason: 'too-large' };
  let file;
  try { file = JSON.parse(text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text); } catch { return { ok: false, reason: 'malformed' }; }
  if (!isObject(file) || file.version !== 1 || typeof file.signature !== 'string' || !Array.isArray(file.notices) || instant(file.generatedAt) === null) return { ok: false, reason: 'malformed' };
  if (!keys || !keys.length) return { ok: false, reason: 'no-key' };
  const { signature, ...rest } = file, message = Buffer.from(canonical(rest), 'utf8'), bytes = Buffer.from(signature, 'base64');
  const good = keys.some((entry) => { try { return crypto.verify(null, message, publicKeyOf(entry.key), bytes); } catch { return false; } });
  if (!good) return { ok: false, reason: 'bad-signature' };
  const generatedAt = instant(file.generatedAt);
  if (generatedAt > now + FUTURE_SLACK) return { ok: false, reason: 'bad-date' };
  if (generatedAt < afterAt) return { ok: false, reason: 'stale' };
  if (file.notices.length > MAX_NOTICES) return { ok: false, reason: 'malformed' };
  const notices = [], seen = new Set(); let dropped = 0;
  for (const raw of file.notices) {
    const result = cleanNotice(raw);
    if (result.error || seen.has(result.notice.id)) { dropped++; continue; }
    seen.add(result.notice.id); notices.push(result.notice);
  }
  return { ok: true, generatedAt, notices, dropped };
}

// ───────────────────────────────────────────────── the on-device rules

/** The words a card shows in the interface language: 'pt-BR' -> pt-BR, then pt, then the notice's own text. Each field falls back to the base text on its own. */
function copyFor(notice, language) {
  const tag = String(language || 'en'), base = tag.slice(0, 2).toLowerCase(), own = notice.text.translations[tag] || notice.text.translations[base] || {};
  const root = notice.text.base;
  return { title: own.title || root.title, body: own.body || root.body, cta: root.cta ? own.cta || root.cta : '', secondary: root.secondary ? own.secondary || root.secondary : '' };
}

/** Does the card's `audience` rule (and its date window) let it appear on this install now? {ok:true} or {ok:false, reason}. ctx: {now, version, platform, channel,
 *  language, installedAt, sharing (true when usage counts are on), everUsed(name) -> true | false | undefined}. */
function eligibility(notice, ctx) {
  const t = ctx.now, rule = notice.show;
  if (notice.startsAt !== null && t < notice.startsAt) return { ok: false, reason: 'not yet' };
  if (notice.endsAt !== null && t >= notice.endsAt) return { ok: false, reason: 'ended' };
  if (rule.platform && !rule.platform.includes(ctx.platform)) return { ok: false, reason: 'platform' };
  if (rule.channel && !rule.channel.includes(ctx.channel)) return { ok: false, reason: 'channel' };
  if (rule.minVersion || rule.maxVersion) {
    if (!isVersion(ctx.version)) return { ok: false, reason: 'version unknown' };
    if (rule.minVersion && lowerThan(ctx.version, rule.minVersion)) return { ok: false, reason: 'version below' };
    if (rule.maxVersion && lowerThan(rule.maxVersion, ctx.version)) return { ok: false, reason: 'version above' };
  }
  if (rule.language && !rule.language.includes(String(ctx.language || 'en').slice(0, 2).toLowerCase())) return { ok: false, reason: 'language' };
  if (rule.minDays !== undefined || rule.daysSinceInstall) {
    const days = daysSinceInstall(ctx.installedAt, t);
    if (days === null) return { ok: false, reason: 'days since install' };
    if (rule.minDays !== undefined && days < rule.minDays) return { ok: false, reason: 'days since install' };
    if (rule.daysSinceInstall && !rule.daysSinceInstall.includes(dayBucket(days))) return { ok: false, reason: 'days since install' };
  }
  if (rule.sharing && (rule.sharing === 'on') !== Boolean(ctx.sharing)) return { ok: false, reason: 'sharing' };
  if (rule.notUsed && rule.notUsed.length) {
    for (const name of rule.notUsed) { let used; try { used = ctx.everUsed?.(name); } catch { used = undefined; } if (used !== false) return { ok: false, reason: used === true ? 'already used ' + name : 'use of ' + name + ' unknown' }; }
  }
  return { ok: true };
}

const order = (a, b) => b.priority - a.priority || (a.startsAt ?? 0) - (b.startsAt ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

// ───────────────────────────────────────────────── the service: cache, card lifecycle, counting

/**
 * directory: a folder of Acira's own (the billboard keeps `billboard-feed.json` and `billboard-state.json` in it). keys: the trusted public keys. url: where the file is
 * ('' means "never fetch": the cache, if any, is still read). fetchText(url) -> the file's text, or throws. context() -> the ctx of `eligibility` without `now`.
 * onChange() is called when what a new tab would show may have changed. report(id, state) is told of every change of a card's state (never throws into the service).
 */
function createBillboard({ directory, keys = PRODUCTION_KEYS, url = '', fetchText = null, context = () => ({}), now = Date.now, io = fs, onChange = () => {}, report = () => {}, random = Math.random, schedule = setTimeout, cancel = clearTimeout, first = REFRESH_FIRST, every = REFRESH_EVERY, minGap = MIN_GAP } = {}) {
  const feedFile = path.join(directory, 'billboard-feed.json'), stateFile = path.join(directory, 'billboard-state.json');
  let feed = null, state = { issued: 0, lastStartedAt: null, cards: {} }, loaded = false, refreshing = null, lastTry = 0, lastError = null, timer = null, started = false;

  const tell = (id, to) => { try { report(id, to); } catch { /* counting never breaks a card */ } };
  const persist = () => { try { io.mkdirSync(directory, { recursive: true }); writeFileAtomic(stateFile, JSON.stringify(state), { fileSystem: io }); } catch { /* kept in memory until the next save */ } };
  const prune = () => {
    const ids = Object.keys(state.cards); if (ids.length <= MAX_CARDS_KEPT) return;
    for (const id of ids.sort((a, b) => (state.cards[b].at || 0) - (state.cards[a].at || 0)).slice(MAX_CARDS_KEPT)) delete state.cards[id];
  };

  function load() {
    if (loaded) return; loaded = true;
    const saved = readJsonFile(stateFile, { fileSystem: io, now });
    if (saved && isObject(saved.cards)) {
      state = { issued: Number.isFinite(saved.issued) && saved.issued >= 0 ? saved.issued : 0, lastStartedAt: Number.isFinite(saved.lastStartedAt) ? saved.lastStartedAt : null, cards: {} };
      for (const [id, card] of Object.entries(saved.cards)) {
        if (!ID.test(id) || !isObject(card) || !Number.isFinite(card.firstShownAt) || !STATES.includes(card.state)) continue;
        state.cards[id] = { firstShownAt: card.firstShownAt, maxAgeMs: Number.isFinite(card.maxAgeMs) && card.maxAgeMs > 0 ? Math.min(card.maxAgeMs, MAX_AGE_HOURS * HOUR) : DEFAULT_AGE_HOURS * HOUR, ended: STATES.includes(card.ended) ? card.ended : null, endedAt: Number.isFinite(card.endedAt) ? card.endedAt : null, state: card.state, at: Number.isFinite(card.at) ? card.at : card.firstShownAt };
      }
    }
    // The cached file is judged again like a fresh one: a changed or foreign cache is ignored, and so is one older than the newest generatedAt ever accepted.
    const cached = readJsonFile(feedFile, { fileSystem: io, now });
    if (cached && typeof cached.text === 'string' && Number.isFinite(cached.fetchedAt)) {
      const result = verifyFeed(cached.text, { keys, afterAt: state.issued, now: now() });
      if (result.ok) feed = { generatedAt: result.generatedAt, notices: result.notices, fetchedAt: Math.min(cached.fetchedAt, now()) };
    }
  }

  /** Ends the cards that have been on screen for their maxAgeHours. */
  function expire(t) {
    let changed = false;
    const timedOut = [];
    for (const [id, card] of Object.entries(state.cards)) if (!card.ended && t - card.firstShownAt >= card.maxAgeMs) { card.ended = 'timeout'; card.endedAt = t; card.state = 'timeout'; card.at = t; changed = true; timedOut.push(id); }
    if (changed) persist();
    for (const id of timedOut) tell(id, 'timeout');
  }

  const context_ = () => { let given = {}; try { given = context() || {}; } catch { given = {}; } return { ...given, now: now() }; };

  /** What the page draws. expiresAt: when this card ends by itself (its endsAt, or its maxAge after its first display, whichever is first; null when it has neither yet); the page looks again then, so a card
   *  on a tab that stays open still leaves with its animation. */
  function view(notice, ctx) {
    const text = copyFor(notice, ctx.language), card = state.cards[notice.id], end = Math.min(notice.endsAt ?? Infinity, card ? card.firstShownAt + card.maxAgeMs : Infinity);
    return { id: notice.id, style: notice.style, urgent: notice.urgent, title: text.title, body: text.body, cta: text.cta ? { label: text.cta, link: notice.links.cta } : null, secondary: text.secondary ? { label: text.secondary, link: notice.links.secondary } : null, expiresAt: Number.isFinite(end) ? end : null };
  }

  /** The card a new tab shows now, or null. Reads the saved copy; never touches the network. A private window never gets one. */
  function current({ private: isPrivate = false } = {}) {
    if (isPrivate) return null;
    load();
    const ctx = context_(), t = ctx.now;
    if (!feed || t - feed.fetchedAt > CACHE_MAX_AGE || t < feed.fetchedAt - DAY) return null;
    expire(t);
    const live = feed.notices.filter((notice) => eligibility(notice, ctx).ok);
    const onScreen = live.filter((notice) => { const card = state.cards[notice.id]; return card && !card.ended; }).sort(order)[0];
    if (onScreen) return view(onScreen, ctx);
    const waited = state.lastStartedAt === null || t - state.lastStartedAt >= SEVEN_DAYS || t < state.lastStartedAt;
    const next = live.filter((notice) => !state.cards[notice.id] && (notice.urgent || waited)).sort(order)[0];
    return next ? view(next, ctx) : null;
  }

  /** The new-tab page says a card is on screen. The first time starts its clock (maxAgeHours) and the 7 days. Only the card `current()` would give is accepted. */
  function shown(id, { private: isPrivate = false } = {}) {
    if (isPrivate) return false;
    const card = current();
    if (!card || card.id !== id) return false;
    if (state.cards[id]) return true;
    const notice = feed.notices.find((item) => item.id === id), t = now();
    state.cards[id] = { firstShownAt: t, maxAgeMs: notice.maxAgeHours * HOUR, ended: null, endedAt: null, state: 'shown', at: t };
    state.lastStartedAt = t; prune(); persist(); tell(id, 'shown'); onChange();
    return true;
  }

  /** X (how 'x'), or a click on the card's first or second link (how 'cta' | 'secondary'). The card is closed for good; only Undo within UNDO_WINDOW brings an X back. */
  function close(id, how) {
    load();
    const card = state.cards[id];
    if (!card || card.ended || !['x', 'cta', 'secondary'].includes(how)) return false;
    const t = now(); card.ended = how; card.endedAt = t; card.state = how; card.at = t;
    persist(); tell(id, how); onChange();
    return true;
  }

  /** The Undo of the toast after X: the card is back (state 'undo'), its clock still running from its first display. */
  function undo(id) {
    load();
    const card = state.cards[id], t = now();
    if (!card || card.ended !== 'x' || t - card.endedAt > UNDO_WINDOW) return false;
    card.ended = null; card.endedAt = null; card.state = 'undo'; card.at = t;
    persist(); tell(id, 'undo'); onChange();
    return true;
  }

  /** Fetches, checks and keeps the file. A failed fetch or an unacceptable file changes nothing (the last good copy stays). Resolves status(). */
  async function refresh() {
    load();
    // No trusted key (none ships until the team give one): a file could never be verified, so nothing is asked of the network at all.
    if (!url || !fetchText || !keys.length) return status();
    if (!refreshing) refreshing = (async () => {
      lastTry = now();
      try {
        const text = await fetchText(url);
        const result = verifyFeed(text, { keys, afterAt: state.issued, now: now() });
        if (!result.ok) { lastError = result.reason; return; }
        feed = { generatedAt: result.generatedAt, notices: result.notices, fetchedAt: now() };
        lastError = null;
        if (result.generatedAt > state.issued) { state.issued = result.generatedAt; persist(); }
        try { io.mkdirSync(directory, { recursive: true }); writeFileAtomic(feedFile, JSON.stringify({ fetchedAt: feed.fetchedAt, text }), { fileSystem: io }); } catch { /* kept in memory */ }
        onChange();
      } catch (error) { lastError = String(error?.message || error).slice(0, 120); }
    })().finally(() => { refreshing = null; });
    await refreshing;
    return status();
  }
  /** refresh(), unless one was tried less than minGap (30 minutes) ago. */
  function maybeRefresh() { return now() - lastTry < minGap && lastTry ? Promise.resolve(status()) : refresh(); }

  /** Starts the schedule: a first look `first` (5 s) after this call, then every `every` (2 h, + up to 10 minutes of jitter), like the update check's rhythm. */
  function start() {
    if (started || !keys.length) return; started = true;   // without a trusted key there is nothing to look for: no timer either
    const arm = (delay) => { timer = schedule(() => { void maybeRefresh().finally(() => { if (started) arm(every + Math.floor(random() * Math.min(REFRESH_JITTER, every * 0.2))); }); }, delay); timer?.unref?.(); };
    arm(first);
  }
  function stop() { started = false; if (timer) cancel(timer); timer = null; }

  function status() {
    load();
    return { configured: Boolean(url) && keys.length > 0, generatedAt: feed?.generatedAt ?? null, notices: feed ? feed.notices.length : 0, fetchedAt: feed?.fetchedAt ?? null, lastError, lastStartedAt: state.lastStartedAt, cards: JSON.parse(JSON.stringify(state.cards)) };
  }

  /** The requests main.cjs routes here (native-core.cjs: billboard.*). Each answers {billboard: the card to show now or null, closed: true when this request was an X that closed a card (main then raises the Undo toast)}. */
  function handle(request, { private: isPrivate = false } = {}) {
    const known = ['billboard.current', 'billboard.shown', 'billboard.close', 'billboard.undo'];
    if (!isObject(request) || !known.includes(request.type)) throw new Error('Unknown billboard request.');
    const allowed = { 'billboard.current': [], 'billboard.shown': ['id'], 'billboard.close': ['id', 'how'], 'billboard.undo': ['id'] }[request.type];
    if (Object.keys(request).some((key) => key !== 'type' && !allowed.includes(key))) throw new Error('Unexpected billboard field.');
    if (request.type !== 'billboard.current' && (typeof request.id !== 'string' || !ID.test(request.id))) throw new Error('Unexpected billboard card.');
    if (isPrivate) return { billboard: null, closed: false };
    let closed = false;
    if (request.type === 'billboard.shown') shown(request.id);
    else if (request.type === 'billboard.close') { if (!['x', 'cta', 'secondary'].includes(request.how)) throw new Error('Unexpected billboard close.'); closed = close(request.id, request.how) && request.how === 'x'; }
    else if (request.type === 'billboard.undo') undo(request.id);
    return { billboard: current(), closed };
  }

  return { load, current, shown, close, undo, refresh, maybeRefresh, start, stop, status, handle };
}

// ───────────────────────────────────────────────── the real fetch and the address

/** Where the file is: beside the update feed (update.acirabrowser.com). A test profile reaches only what QA names (ACIRA_BILLBOARD_URL, plain http on 127.0.0.1), never the real host. */
function billboardFileURL(env = process.env, { feedFolder = feedFolderURL } = {}) {
  if (env.ACIRA_BROWSER_TEST_DATA) return checkedEndpoint(env.ACIRA_BILLBOARD_URL || '', { allowLocal: true });
  const folder = feedFolder();
  return folder ? checkedEndpoint(folder + FILE_NAME) : '';
}

/** The real GET over an Electron session's fetch (the update check's own session and route): no cookies, no Referer, no cache, no redirect, 20 s, MAX_BYTES at most. */
function sessionFetchText(session) {
  return async (url) => {
    const response = await session.fetch(url, { method: 'GET', credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(20000) });
    if (response.status !== 200) throw Object.assign(new Error('The billboard answered HTTP ' + response.status + '.'), { status: response.status });
    if (Number(response.headers.get('content-length') || 0) > MAX_BYTES) throw new Error('The billboard file is too large.');
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_BYTES) throw new Error('The billboard file is too large.');
    return bytes.toString('utf8');
  };
}

module.exports = { createBillboard, verifyFeed, cleanNotice, eligibility, copyFor, canonical, safeLink, publicKeyOf, testKeys, billboardFileURL, sessionFetchText, FILE_NAME, STATES, STYLES, LIMITS, MAX_BYTES, SEVEN_DAYS, CACHE_MAX_AGE, UNDO_WINDOW, REFRESH_EVERY };
