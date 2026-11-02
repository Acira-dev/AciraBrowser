'use strict';
// Anonymous usage counts. New setup initializes an unset choice to on; saved choices are preserved. One small message per day at most:
// a random install id, the app version, the system family, the interface language and coarse choices and counts (schema 3: how Acira is set
// up, which features are used as buckets, sizes as buckets, ...), each from a closed list or a bucket (usage-facts.cjs). No address, URL, site,
// search term, history, account, name, path, exact count, time of day or free text is in it.
// R4-61: occasionally, a one-question feature rating (feature-rating.cjs), only while this choice is on, sent as its own tiny message.
// The endpoint is a write-only address from metrics-config.cjs; there is no key, token or secret anywhere in the client.
const fs = require('node:fs'), path = require('node:path'), { randomUUID } = require('node:crypto');
const { sanitize, USES, PEAKS, importFamily } = require('./usage-facts.cjs');
const rating = require('./feature-rating.cjs');
const FILE = 'metrics.json';
const CHOICES = Object.freeze(['unset', 'on', 'off']);
const SAMPLE_ID = '00000000-0000-4000-8000-000000000000';
const dayOf = (time) => new Date(time).toISOString().slice(0, 10);
const small = (value, cap) => { const n = Number(value); return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), cap) : 0; };

/** https only (plain http only for a local test server), no credentials, no query string, no fragment. */
function checkedEndpoint(value, { allowLocal = false } = {}) {
  if (!value) return '';
  let url;
  try { url = new URL(value); } catch { return ''; }
  const local = allowLocal && url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !local) || url.username || url.password || url.search || url.hash) return '';
  return url.href;
}

function createMetrics({ directory, endpoint = '', allowLocal = false, appVersion, platform, arch, language, send, facts = async () => ({}), routeOk = () => true, now = () => Date.now(), ratingQuietMs }) {
  const file = path.join(directory, FILE), target = checkedEndpoint(endpoint, { allowLocal });
  let sending = false, sessionCounted = false;
  const launchedAt = now();
  const read = () => {
    try {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      const uses = {}; for (const name of USES) { const n = small(saved.uses?.[name], 100000); if (n) uses[name] = n; }
      const peaks = {}; for (const name of PEAKS) { const n = small(saved.peaks?.[name], 100000); if (n) peaks[name] = n; }
      const signIn = saved.signBackIn && typeof saved.signBackIn === 'object' ? { total: small(saved.signBackIn.total, 1000), done: small(saved.signBackIn.done, 1000) } : null;
      return { choice: CHOICES.includes(saved.choice) ? saved.choice : 'unset', initializeAllowed: saved.choice === 'unset', installId: typeof saved.installId === 'string' && /^[0-9a-f-]{36}$/.test(saved.installId) ? saved.installId : '', lastSent: /^\d{4}-\d{2}-\d{2}$/.test(saved.lastSent || '') ? saved.lastSent : '', uses, peaks, importSource: typeof saved.importSource === 'string' ? saved.importSource : 'none', passwordsImported: saved.passwordsImported === true, signBackIn: signIn, rating: rating.clean(saved.rating), askRatings: saved.askRatings !== false };
    } catch (error) { return { choice: 'unset', initializeAllowed: error.code === 'ENOENT', installId: '', lastSent: '', uses: {}, peaks: {}, importSource: 'none', passwordsImported: false, signBackIn: null, rating: rating.clean(null), askRatings: true }; }
  };
  const write = (value) => { const { initializeAllowed, ...kept } = value; fs.mkdirSync(directory, { recursive: true }); fs.writeFileSync(file + '.tmp', JSON.stringify(kept)); fs.renameSync(file + '.tmp', file); };
  /** Applies `change` to the saved state, only while the choice is on with a real id. Never throws. */
  const whileOn = (change) => { const saved = read(); if (saved.choice !== 'on' || !saved.installId) return false; try { write(change(saved)); return true; } catch { return false; } };
  /** The exact message. While off the preview uses a placeholder; a saved on choice creates the real id. */
  const payload = async (saved = read()) => {
    let raw = {}; try { raw = (await facts()) || {}; } catch { raw = {}; }
    return { schema: 3, event: 'daily', installId: saved.installId || SAMPLE_ID, appVersion: String(appVersion), channel: 'beta', platform: String(platform), arch: String(arch), language: String(language || 'en').slice(0, 2).toLowerCase(), day: dayOf(now()), ...sanitize({ ...raw, importSource: saved.importSource, passwordsImported: saved.passwordsImported, signBackIn: saved.signBackIn }, saved.uses, saved.peaks) };
  };
  /** What a rating answer would send (shown in "What's sent"; the feature and stars are examples there). */
  const ratingSample = () => rating.ratingMessage({ feature: 'splitView', stars: 5, appVersion: String(appVersion), platform: String(platform), day: dayOf(now()) });

  async function status() {
    const saved = read();
    return { choice: saved.choice, enabled: saved.choice === 'on', configured: Boolean(target), endpointHost: target ? new URL(target).hostname : '', lastSent: saved.lastSent, sample: saved.installId === '', payload: await payload(saved), askRatings: saved.askRatings, ratingPayload: ratingSample() };
  }
  /** Counts one use of a feature, only while the choice is on. The count stays on this computer until the next daily message and is deleted when this is turned off.
   * Rating-only notes (sidebarTabs, newTabArtwork, signBackIn, windowView) only feed the local rating counters and are never sent. */
  function note(name) {
    const daily = USES.includes(name), rated = Boolean(rating.SOURCES[name]);
    if (!daily && !rated) return;
    whileOn((saved) => ({ ...saved, uses: daily ? { ...saved.uses, [name]: (saved.uses[name] || 0) + 1 } : saved.uses, rating: rated ? rating.countUse(saved.rating, name) : saved.rating }));
  }
  /** Keeps the day's highest number of open tabs, windows and panes in one split view (sent only as buckets). */
  function notePeaks(values = {}) {
    const next = {}; for (const name of PEAKS) { const n = small(values[name], 100000); if (n) next[name] = n; }
    if (!Object.keys(next).length) return;
    const saved = read(); if (saved.choice !== 'on' || PEAKS.every((name) => !next[name] || next[name] <= (saved.peaks[name] || 0))) return;
    whileOn((current) => { const peaks = { ...current.peaks }; for (const [name, n] of Object.entries(next)) peaks[name] = Math.max(peaks[name] || 0, n); return { ...current, peaks }; });
  }
  /** Remembers only the browser family a profile was last imported from (chrome, firefox, ...), never a profile name or a path. */
  function noteImport(sourceId) { whileOn((saved) => ({ ...saved, importSource: importFamily(sourceId) })); }
  /** Passwords were imported at least once (yes/no; never how many or from where). */
  function notePasswordsImported() { whileOn((saved) => ({ ...saved, passwordsImported: true })); }
  /** Sign back in progress as two small numbers, sent only as a share bucket (none, 0, 1-49, 50-99, 100); never which sites. */
  function noteSignBackIn(plan) {
    if (!plan || typeof plan !== 'object') return;
    whileOn((saved) => ({ ...saved, signBackIn: { total: small(plan.total, 1000), done: small(plan.done, 1000) } }));
  }
  /** Turning it off forgets the id, the last day, every count and the rating state, so turning it on later starts from a fresh random id. */
  function set(enabled, {onlyIfUnset = false} = {}) {
    if (typeof enabled !== 'boolean') throw new Error('Choose on or off.');
    if (typeof onlyIfUnset !== 'boolean') throw new Error('Choose a valid initialization mode.');
    const saved = read();
    if (onlyIfUnset && (saved.choice !== 'unset' || !saved.initializeAllowed)) return status();
    write(enabled ? { ...saved, choice: 'on', installId: saved.installId || randomUUID() } : { choice: 'off', installId: '', lastSent: '', uses: {}, peaks: {}, importSource: 'none', passwordsImported: false, signBackIn: null, rating: rating.clean(null), askRatings: saved.askRatings });
    return status();
  }
  /** Settings > Privacy: "Ask me now and then how features are working" (on by default; only offered while sharing is on). */
  function setAskRatings(enabled) {
    if (typeof enabled !== 'boolean') throw new Error('Choose on or off.');
    const saved = read(); write({ ...saved, askRatings: enabled });
    return status();
  }
  /** Sends today's message only for a saved on choice, a configured endpoint and an eligible route. Never throws. */
  async function maybeSend() {
    if (sending) return {sent: false, reason: 'busy'};
    const saved = read();
    if (saved.choice !== 'on' || !saved.installId) return { sent: false, reason: 'off' };
    if (!target) return { sent: false, reason: 'no endpoint' };
    if (saved.lastSent === dayOf(now())) return { sent: false, reason: 'already sent today' };
    try {
      if (!routeOk()) return { sent: false, reason: 'route' };
      sending = true;
      const reply = await send(target, JSON.stringify(await payload(saved)));
      if (reply !== 200 && reply !== 202 && reply !== 204) return { sent: false, reason: 'server' };
      // A completed in-flight request must never undo an opt-out or restore its deleted id.
      const current = read();
      if (current.choice === 'on' && current.installId === saved.installId) {
        // Uses counted while the request was in flight stay for tomorrow; only what was reported is taken off. Peaks start again each day.
        const left = {}; for (const name of USES) { const rest = (current.uses[name] || 0) - (saved.uses[name] || 0); if (rest > 0) left[name] = rest; }
        write({ ...current, lastSent: dayOf(now()), uses: left, peaks: {} });
      }
      return { sent: true };
    } catch { return { sent: false, reason: 'network' }; }
    finally { sending = false; }
  }

  // R4-61 feature ratings. Every step is a no-op unless sharing is on.
  /** Counts this launch once (the first launch with sharing on is the "first session" and never asks). */
  function ratingSession() { if (sessionCounted) return; sessionCounted = whileOn((saved) => ({ ...saved, rating: rating.startSession(saved.rating, dayOf(now())) })); }
  /** The feature to ask about now, or null. Main adds the window rules (not private, not Tor); the card adds typing/fullscreen/video/setup. */
  function ratingOffer() {
    ratingSession();
    const saved = read();
    return rating.nextFeature(saved.rating, { sharing: saved.choice === 'on' && Boolean(saved.installId), ask: saved.askRatings, today: dayOf(now()), launchedAt, now: now(), ...(Number.isFinite(ratingQuietMs) && ratingQuietMs >= 0 ? { quietMs: ratingQuietMs } : {}) });
  }
  function ratingShown(feature) { whileOn((saved) => ({ ...saved, rating: rating.shown(saved.rating, feature, dayOf(now())) })); }
  function ratingDismiss(feature) { whileOn((saved) => ({ ...saved, rating: rating.dismissed(saved.rating, feature) })); }
  /** Records the answer and sends {feature, stars, version, OS, day}. Sent at most once; a failed send is not retried (it is only an opinion). */
  async function ratingAnswer(feature, stars) {
    const message = rating.ratingMessage({ feature, stars, appVersion: String(appVersion), platform: String(platform), day: dayOf(now()) });
    if (!message) throw new Error('Choose 1 to 5 stars.');
    if (!whileOn((saved) => ({ ...saved, rating: rating.answered(saved.rating, feature) }))) return { sent: false, reason: 'off' };
    if (!target) return { sent: false, reason: 'no endpoint' };
    try { if (!routeOk()) return { sent: false, reason: 'route' }; const reply = await send(target, JSON.stringify(message)); return reply === 204 || reply === 200 || reply === 202 ? { sent: true } : { sent: false, reason: 'server' }; }
    catch { return { sent: false, reason: 'network' }; }
  }
  return { status, set, setAskRatings, maybeSend, note, notePeaks, noteImport, notePasswordsImported, noteSignBackIn, ratingSession, ratingOffer, ratingShown, ratingDismiss, ratingAnswer, payload: () => payload() };
}

/** The real transport: Electron's net on an isolated in-memory session. POST, JSON body, no cookies, no Referer, one generic User-Agent, no redirects. */
function electronSend(session, userAgent) {
  return async (url, body) => {
    const response = await session.fetch(url, { method: 'POST', body, credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', headers: { 'Content-Type': 'application/json', 'User-Agent': userAgent }, signal: AbortSignal.timeout(10000) });
    return response.status;
  };
}

module.exports = { createMetrics, electronSend, checkedEndpoint, SAMPLE_ID };
