'use strict';
// Anonymous usage counts. A finished new setup (Use defaults, Skip setup, the last step) initializes an unset choice to on; saved choices are preserved,
// and nothing is sent until setup has finished (`ready`) and the usage notice (section C) has been seen (X, a link, or 24 hours). One small message per day at most:
// a random install id that is replaced every 28 days, the app version, the system family, the interface language and coarse choices and counts (schema 4:
// how Acira is set up, how it is used, which features are used as buckets, how it runs, ...), each from a closed list or a bucket (usage-facts.cjs). No
// address, URL, site, search term, history, account, name, path, exact count, time of day or free text is in it. When sharing is switched off the id and
// every count are deleted and one `off` message (no id) says where it happened.
// R4-61: occasionally, a one-question feature rating (feature-rating.cjs), only while this choice is on, sent as its own tiny message.
// beta.9, Windows only: the uninstaller (packaging/acira-installer.nsh) sends one last message when Acira is really removed while this is on.
// It reads this file's first keys, which write() keeps in a fixed order: {"choice":"on","installId":"<id>","route":"ok",...
// The endpoint is a write-only address from metrics-config.cjs; there is no key, token or secret anywhere in the client.
const fs = require('node:fs'), path = require('node:path'), { randomUUID } = require('node:crypto');
const facts4 = require('./usage-facts.cjs');
const { sanitize4, USES, PEAKS, importFamily, UNINSTALL_REASONS } = facts4;
const state = require('./usage-state.cjs');
const rating = require('./feature-rating.cjs');
const installMark = require('./install-mark.cjs');
const FILE = 'metrics.json';
const CHOICES = Object.freeze(['unset', 'on', 'off']);
const SAMPLE_ID = '00000000-0000-4000-8000-000000000000';
const dayOf = (time) => new Date(time).toISOString().slice(0, 10);
const small = (value, cap) => { const n = Number(value); return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), cap) : 0; };
/** What the last check of the connection found: 'ok' (the normal route, so a message may leave), 'held' (a manual proxy, or not confirmed
 * yet) or '' (not checked since sharing was turned on). The Windows uninstaller sends only after 'ok', so it never bypasses a proxy either. */
const ROUTES = Object.freeze(['ok', 'held']);

/** The message the Windows uninstaller sends (packaging/acira-installer.nsh builds the same fields in the same order). Shown in "What's sent". */
function uninstallMessage({ installId, appVersion, arch, day, reason }) {
  const base = { event: 'uninstall', installId: String(installId), appVersion: String(appVersion), platform: 'win32', arch: String(arch), day: String(day) };
  // Beta 14 (the plan): schema 4 adds the one word a person tapped on the uninstaller's card (one of seven, usage-facts.cjs UNINSTALL_REASONS); no tap is the message as before (schema 1, no reason)
  return UNINSTALL_REASONS.includes(reason) ? { schema: 4, ...base, reason } : { schema: 1, ...base };
}

/** https only (plain http only for a local test server), no credentials, no query string, no fragment. */
function checkedEndpoint(value, { allowLocal = false } = {}) {
  if (!value) return '';
  let url;
  try { url = new URL(value); } catch { return ''; }
  const local = allowLocal && url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !local) || url.username || url.password || url.search || url.hash) return '';
  return url.href;
}

/** `uninstallSends`: this build's uninstaller sends the uninstall message (Windows, not a QA build); only then does "What's sent" show it.
 *  `returningMark`: the "installed here before" marker outside the data folder (install-mark.cjs, Beta 14): `get()` says whether the data folder was wiped on a computer that had Acira (the first message then carries `returning`), `leave()` writes it (macOS).
 *  `installedOn`: the day this install began ('YYYY-MM-DD'), read by main from install-date.cjs (<userData>/install.json, the billboard's too; not stored here, so it survives turning sharing off).
 *  `systemVersion`: the OS version text (windows-version.cjs systemVersion), reduced to a closed OS list before it is sent. */
function createMetrics({ directory, endpoint = '', allowLocal = false, appVersion, platform, arch, language, send, facts = async () => ({}), routeOk = () => true, ready = () => true, now = () => Date.now(), ratingQuietMs, uninstallSends = String(platform) === 'win32', installedOn = () => '', systemVersion = '', afterSend = () => {}, returningMark = { kind: 'none', get: async () => false, leave: async () => {} } }) {
  const file = path.join(directory, FILE), target = checkedEndpoint(endpoint, { allowLocal });
  let sending = false, sessionCounted = false, pendingOff = Promise.resolve(), flushedAt = 0;
  /** High-frequency counts (page loads, searches, active time) are added in memory and written to the file at most every 10 s, on every read that needs them,
   *  and when the app quits; a crash can lose a few seconds of counting, never anything else. */
  let pending = null;
  const launchedAt = now();
  const read = () => {
    try {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      const uses = {}; for (const name of USES) { const n = small(saved.uses?.[name], 100000); if (n) uses[name] = n; }
      const peaks = {}; for (const name of PEAKS) { const n = small(saved.peaks?.[name], 100000); if (n) peaks[name] = n; }
      const signIn = saved.signBackIn && typeof saved.signBackIn === 'object' ? { total: small(saved.signBackIn.total, 1000), done: small(saved.signBackIn.done, 1000) } : null;
      return { choice: CHOICES.includes(saved.choice) ? saved.choice : 'unset', initializeAllowed: saved.choice === 'unset', installId: typeof saved.installId === 'string' && /^[0-9a-f-]{36}$/.test(saved.installId) ? saved.installId : '', route: ROUTES.includes(saved.route) ? saved.route : '', lastSent: /^\d{4}-\d{2}-\d{2}$/.test(saved.lastSent || '') ? saved.lastSent : '', uses, peaks, importSource: typeof saved.importSource === 'string' ? saved.importSource : 'none', passwordsImported: saved.passwordsImported === true, signBackIn: signIn, rating: rating.clean(saved.rating), askRatings: saved.askRatings !== false, ...state.cleanState(saved) };
    } catch (error) { return { choice: 'unset', initializeAllowed: error.code === 'ENOENT', installId: '', route: '', lastSent: '', uses: {}, peaks: {}, importSource: 'none', passwordsImported: false, signBackIn: null, rating: rating.clean(null), askRatings: true, ...state.cleanState(null) }; }
  };
  /** choice, installId and route always come first, in that order: the Windows uninstaller reads only the start of this file. */
  const write = (value) => {
    const { initializeAllowed, noticeMissing, choice, installId, route, ...rest } = value;
    const kept = { choice, installId, ...(choice === 'on' && installId && ROUTES.includes(route) ? { route } : {}), ...rest };
    fs.mkdirSync(directory, { recursive: true }); fs.writeFileSync(file + '.tmp', JSON.stringify(kept)); fs.renameSync(file + '.tmp', file);
  };
  /** Applies `change` to the saved state, only while the choice is on with a real id. Never throws. */
  const whileOn = (change) => { const saved = read(); if (saved.choice !== 'on' || !saved.installId) return false; try { write(change(saved)); return true; } catch { return false; } };
  const today = () => dayOf(now());
  /** Whether sharing is on, for the counters that are called very often (a page loaded, a tracker blocked): the file is read at most every 5 s, and at once when this changes. */
  let sharingAt = -Infinity, sharingOn = false;
  const sharing = () => { const time = now(); if (time - sharingAt > 5000 || time < sharingAt) { const saved = read(); sharingOn = saved.choice === 'on' && Boolean(saved.installId); sharingAt = time; } return sharingOn; };
  const startDay = () => { const day = String(installedOn() || ''); return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : ''; };
  /** The saved state with what a read must settle first, for a choice that is on: a pending count is written; an id with no recorded day (a build before Beta 14 kept
   *  one id for ever) or older than 28 days is replaced by a fresh one; a file written before the notice existed (an upgrade of an install that is already sharing)
   *  gets the notice now; and the notice's 24 hours are noted when over. */
  const current = () => {
    flushPending();
    const saved = read();
    if (saved.choice !== 'on' || !saved.installId) return saved;
    let next = saved, changed = false; const time = now();
    if (state.idDue(saved.idCreated, today())) { next = { ...next, installId: randomUUID(), idCreated: today() }; changed = true; }
    if (saved.noticeMissing) { next = { ...next, notice: state.noticeStart(time) }; changed = true; }
    const timedOut = state.noticeTimeout(next.notice, time); if (timedOut.how !== next.notice.how) { next = { ...next, notice: timedOut }; changed = true; }
    if (!changed) return saved;
    try { write(next); } catch { return saved; }
    return { ...next, noticeMissing: false };
  };
  /** What this computer remembers about messages already sent (brief B9): the mark in the data folder (kept when sharing is turned off, so turning it on again is not a new install) and, for an install from
   *  before the mark existed, metrics.json's own `lastSent`. `ever`: a first message was sent; `lastSent`: the UTC day of the latest. */
  const sentBefore = (saved) => { const mark = installMark.readMark(directory); const last = [mark.last, saved.lastSent].filter(Boolean).sort().at(-1) || ''; return { ever: mark.sent || Boolean(saved.lastSent), lastSent: last }; };
  /** The exact message. While off the preview uses a placeholder; a saved on choice creates the real id. */
  const payload = async (saved = current()) => {
    let raw = {}; try { raw = (await facts()) || {}; } catch { raw = {}; }
    const day = today(), installed = startDay(), before = sentBefore(saved), flags = state.flagsFor(before, day, installed), notice = state.noticeStatus(saved.notice, now());
    const outcome = state.updateOutcome(saved.lastVersion, String(appVersion), raw.updateFailed === true);
    // The setup funnel and the notice are an install's own first message only: they would otherwise be the same on every message and could join messages together.
    const funnel = flags.firstEver ? { ...(saved.funnel || {}), notice: notice.how } : null;
    // A data folder that was wiped on a computer that had Acira (the uninstaller's "delete my data" left its marker, or macOS wrote one): this first message is a returning install, not a new person (brief B9).
    if (flags.firstEver) { let again = false; try { again = await returningMark.get(); } catch { again = false; } if (again) flags.returning = true; }
    const message = sanitize4({ ...raw, ...outcome, platform: String(platform), systemVersion: raw.systemVersion ?? systemVersion, importSource: saved.importSource, passwordsImported: saved.passwordsImported, signBackIn: saved.signBackIn },
      { uses: saved.uses, peaks: saved.peaks, flags, day: { ...saved.day, topSection: state.topSection(saved.day.sections) }, ever: saved.ever, early: saved.early, funnel, billboard: saved.billboard });
    return { schema: 4, event: 'daily', installId: saved.installId || SAMPLE_ID, appVersion: String(appVersion), channel: 'beta', platform: String(platform), arch: String(arch), language: String(language || 'en').slice(0, 2).toLowerCase(), day, ...message };
  };
  /** What a rating answer would send (shown in "What's sent"; the feature and stars are examples there). */
  const ratingSample = () => rating.ratingMessage({ feature: 'splitView', stars: 5, appVersion: String(appVersion), platform: String(platform), day: today() });
  /** What switching sharing off sends: where it happened and how long Acira had been installed, nothing else, and no id. */
  const offMessage = (where) => { const days = state.daysSinceInstall(startDay(), today()); return { schema: 4, event: 'off', where: facts4.OFF_WHERE.includes(where) ? where : 'settings', ...(days === undefined ? {} : { daysSinceInstall: facts4.daysBucket(days) }), appVersion: String(appVersion), platform: String(platform), day: today() }; };

  /** What this computer keeps for the count, as acira://usage lists it: the mark in the data folder (a first message was sent: yes or no) and the "installed here before" marker outside it (yes, no, or null where
   *  there is none: Linux). Booleans only. */
  const marks = async (saved) => { let again = null; try { if (returningMark.kind !== 'none') again = Boolean(await returningMark.get()); } catch { again = null; } return { firstMessageSent: sentBefore(saved).ever, installedBefore: again, installedBeforeKind: returningMark.kind }; };
  async function status() {
    const saved = current();
    return { choice: saved.choice, enabled: saved.choice === 'on', configured: Boolean(target), endpointHost: target ? new URL(target).hostname : '', lastSent: saved.lastSent, lastSentAt: saved.lastSentAt, sample: saved.installId === '', payload: await payload(saved), askRatings: saved.askRatings, ratingPayload: ratingSample(),
      marks: await marks(saved), offPayload: offMessage('settings'), idResetsOn: state.idResetDay(saved.idCreated), notice: noticeView(saved),
      uninstallPayload: uninstallSends ? uninstallMessage({ installId: saved.installId || SAMPLE_ID, appVersion, arch, day: today() }) : null };
  }
  /** The usage notice as the interface needs it. Only a choice that is on has one. */
  function noticeView(saved) {
    const view = state.noticeStatus(saved.notice, now());
    // Without a counting server (an empty endpoint) nothing can be sent, so there is nothing to tell: no banner, and no hold either.
    const on = saved.choice === 'on' && Boolean(saved.installId) && Boolean(target);
    return { applies: on && view.applies, visible: on && view.visible, pending: on && view.pending, settled: !on || view.settled, how: on ? view.how : 'none', expiresAt: view.expiresAt };
  }
  /** Counts one use of a feature, only while the choice is on. The count stays on this computer until the next daily message and is deleted when this is turned off.
   * The feature is also remembered as ever used, and as used in the first 3 days when this install is that young (the discovery fields).
   * Rating-only notes (sidebarTabs, newTabArtwork, signBackIn, windowView) only feed the local rating counters and are never sent. */
  function note(name) {
    const daily = USES.includes(name), rated = Boolean(rating.SOURCES[name]);
    if (!daily && !rated) return;
    whileOn((saved) => ({ ...saved, uses: daily ? { ...saved.uses, [name]: (saved.uses[name] || 0) + 1 } : saved.uses, rating: rated ? rating.countUse(saved.rating, name) : saved.rating,
      ever: daily ? { ...saved.ever, [name]: 1 } : saved.ever, early: daily && state.inFirstDays(startDay(), today()) ? { ...saved.early, [name]: 1 } : saved.early }));
  }
  /** Whether this feature was ever used on this install, for the billboard's "not used yet" audience (the Discovery fields kept for the message). `undefined` means
   *  unknown: sharing is off or has no id (nothing is counted then), or the name is not one of the counted features. Read-only; nothing leaves this computer here. */
  function everUsed(name) {
    if (!USES.includes(name)) return undefined;
    try { const saved = read(); if (saved.choice !== 'on' || !saved.installId) return undefined; return Boolean(saved.ever && saved.ever[name]); } catch { return undefined; }
  }
  // The day's engagement and health counts. Additive ones are batched in memory (see `pending`); the rest are written when they change.
  const batch = () => (pending ||= { seconds: 0, pages: 0, trackers: 0, crashes: 0, searches: {}, sections: {} });
  const flushSoon = () => { if (now() - flushedAt > 10000) flushPending(); };
  const add = (key, amount = 1) => { if (!amount) return; batch()[key] += amount; flushSoon(); };
  function flushPending() {
    const batch = pending; if (!batch) return; pending = null; flushedAt = now();
    whileOn((saved) => { const day = { ...saved.day, searches: { ...saved.day.searches }, sections: { ...saved.day.sections } };
      for (const key of ['seconds', 'pages', 'trackers', 'crashes']) day[key] = Math.min(state.cleanDay({ [key]: day[key] + batch[key] })[key], 2 ** 40);
      for (const [engine, n] of Object.entries(batch.searches)) day.searches[engine] = (day.searches[engine] || 0) + n;
      for (const [id, n] of Object.entries(batch.sections)) day.sections[id] = (day.sections[id] || 0) + n;
      return { ...saved, day: state.cleanDay(day) }; });
  }
  /** Seconds of use (window focused, the computer not idle). */
  function noteActive(seconds) { const n = small(seconds, 3600); if (n && sharing()) add('seconds', n); }
  /** One page finished loading in a normal (not private, not Tor) window: only that it happened. */
  function notePage() { if (sharing()) add('pages'); }
  /** One search made with the default search engine's family (a closed list; never the words searched). */
  function noteSearch(engine) { const family = facts4.SEARCH_ENGINES.includes(engine) ? engine : 'other'; if (!sharing()) return; const b = batch(); b.searches[family] = (b.searches[family] || 0) + 1; flushSoon(); }
  /** A Settings section was opened (a closed list). */
  function noteSection(name) { const id = facts4.settingsSectionOf(name); if (!id || !sharing()) return; const b = batch(); b.sections[id] = (b.sections[id] || 0) + 1; flushSoon(); }
  /** A web page's process or a helper process crashed (counted; no dump, no detail). */
  function noteCrash() { if (sharing()) add('crashes'); }
  /** Trackers and ads blocked since the last count. */
  function noteTrackers(n) { const value = small(n, 1e7); if (value && sharing()) add('trackers', value); }
  /** The highest memory use sampled (bytes). */
  function noteMemory(bytes) { const value = small(bytes, 2 ** 45); if (!value) return; const saved = read(); if (saved.choice !== 'on' || value <= saved.day.memory) return; whileOn((current) => ({ ...current, day: { ...current.day, memory: Math.max(current.day.memory, value) } })); }
  /** This launch counts as one session; whether it was opened by the system at login is kept for the day. */
  function noteSession(openedAtLogin) { if (sessionCounted) return; sessionCounted = whileOn((saved) => ({ ...saved, day: { ...saved.day, sessions: saved.day.sessions + 1, login: openedAtLogin === true ? true : saved.day.login === true ? true : openedAtLogin === false ? false : saved.day.login } })); }
  /** What happened to an announcement card (section D): reported once in the next daily message. */
  function noteBillboard(id, outcome) { whileOn((saved) => ({ ...saved, billboard: state.cleanBillboard([...saved.billboard, { id, state: outcome }]) })); }
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
  /** The usage notice (section C): `close` = X, `undo` = the toast's Undo, `link` = See exactly what we send or Turn off. Returns the notice as the interface needs it. */
  function noticeAct(kind) {
    const time = now();
    if (kind !== 'status') whileOn((saved) => ({ ...saved, notice: kind === 'close' ? state.noticeClose(saved.notice, time) : kind === 'undo' ? state.noticeUndo(saved.notice, time) : kind === 'link' ? state.noticeLink(saved.notice) : saved.notice }));
    return noticeView(current());
  }
  /** Turning it off forgets the id, the last day, every count, the discovery sets, the notice and the rating state, so turning it on later starts from a fresh random id,
   * and sends the one `off` message (no id) that says where it happened. `where`: setup, settings, uninstaller or notice. `setup` (only with onlyIfUnset): how setup ended. */
  function set(enabled, { onlyIfUnset = false, where = 'settings', setup = null } = {}) {
    if (typeof enabled !== 'boolean') throw new Error('Choose on or off.');
    if (typeof onlyIfUnset !== 'boolean') throw new Error('Choose a valid initialization mode.');
    flushPending(); sharingAt = -Infinity;
    const saved = read();
    if (onlyIfUnset && (saved.choice !== 'unset' || !saved.initializeAllowed)) return status();
    if (enabled) {
      // A new id, made now. Only setup's own initialisation (the default) carries the notice; a person who switches it on in Settings has just been told.
      const fresh = !saved.installId, initializing = fresh && onlyIfUnset && saved.choice === 'unset';
      write({ ...saved, choice: 'on', installId: saved.installId || randomUUID(), route: saved.installId ? saved.route : '', idCreated: fresh ? today() : saved.idCreated,
        notice: fresh ? (initializing ? state.noticeStart(now()) : state.cleanNotice(null)) : saved.notice, lastVersion: fresh ? String(appVersion) : saved.lastVersion, funnel: fresh && initializing ? state.cleanFunnel(setup) : saved.funnel });
    } else {
      const message = saved.choice !== 'off' ? offMessage(where) : null;
      write({ choice: 'off', installId: '', lastSent: '', lastSentAt: 0, uses: {}, peaks: {}, importSource: 'none', passwordsImported: false, signBackIn: null, rating: rating.clean(null), askRatings: saved.askRatings, idCreated: '', day: state.cleanDay(null), ever: {}, early: {}, funnel: null, notice: state.cleanNotice(null), lastVersion: '', billboard: [] });
      if (message) queueOff(message);
    }
    return status();
  }
  /** The one `off` message, once, never through a manual proxy or Tor (`routeOk`), never retried. Fire and forget; `idle()` waits for it. */
  function queueOff(message) {
    pendingOff = (async () => { try { if (!target || !routeOk()) return; await send(target, JSON.stringify(message)); } catch { /* it is only a count; nothing is retried */ } })();
  }
  /** Settings > Privacy: "Ask me now and then how features are working" (on by default; only offered while sharing is on). */
  function setAskRatings(enabled) {
    if (typeof enabled !== 'boolean') throw new Error('Choose on or off.');
    const saved = read(); write({ ...saved, askRatings: enabled });
    return status();
  }
  /** Sends today's message only for a saved on choice, a configured endpoint, a finished setup, a seen notice and an eligible route. Never throws.
   * Every call (at launch and every 6 hours) also notes what the route check found, for the Windows uninstaller; only a change is written. */
  async function maybeSend() {
    if (sending) return {sent: false, reason: 'busy'};
    const saved = current();
    if (saved.choice !== 'on' || !saved.installId) return { sent: false, reason: 'off' };
    let routed = false; try { routed = Boolean(routeOk()); } catch { routed = false; }
    if (saved.route !== (routed ? 'ok' : 'held')) whileOn((current) => (current.installId === saved.installId ? { ...current, route: routed ? 'ok' : 'held' } : current));
    if (!target) return { sent: false, reason: 'no endpoint' };
    // One daily message per install per UTC day, whatever happened to the id or the choice since (brief B9): the day comes from the mark in the data folder as well as from this file.
    if (sentBefore(saved).lastSent === today()) return { sent: false, reason: 'already sent today' };
    try {
      // Nothing leaves while setup is still open: setup's Privacy step turns an unset choice on as soon as it shows, long before the person has finished.
      if (!ready()) return { sent: false, reason: 'setup' };
      // The first message waits for the notice: until X (and its Undo time), a link, or 24 hours after setup finished (section C).
      if (!state.noticeStatus(saved.notice, now()).settled) return { sent: false, reason: 'notice' };
      if (!routed) return { sent: false, reason: 'route' };
      sending = true;
      const message = await payload(saved);
      const first = sentBefore(saved).ever === false;
      const reply = await send(target, JSON.stringify(message));
      if (reply !== 200 && reply !== 202 && reply !== 204) return { sent: false, reason: 'server' };
      // The message was counted: from now on this data folder is an install that has been counted (an update, a repair or turning sharing off and on will not count it again).
      installMark.writeMark(directory, today());
      if (first) { try { void returningMark.leave(); } catch { /* the marker is only for a later wipe */ } }
      // A completed in-flight request must never undo an opt-out or restore its deleted id.
      flushPending();
      const after = read();
      if (after.choice === 'on' && after.installId === saved.installId) {
        // Uses counted while the request was in flight stay for tomorrow; only what was reported is taken off. Peaks start again each day.
        const left = {}; for (const name of USES) { const rest = (after.uses[name] || 0) - (saved.uses[name] || 0); if (rest > 0) left[name] = rest; }
        const day = { ...after.day, searches: {}, sections: {}, memory: 0, login: undefined };
        for (const key of ['seconds', 'sessions', 'pages', 'crashes', 'trackers']) day[key] = Math.max(0, after.day[key] - saved.day[key]);
        for (const [engine, n] of Object.entries(after.day.searches)) { const rest = n - (saved.day.searches[engine] || 0); if (rest > 0) day.searches[engine] = rest; }
        for (const [id, n] of Object.entries(after.day.sections)) { const rest = n - (saved.day.sections[id] || 0); if (rest > 0) day.sections[id] = rest; }
        const reported = new Set((message.billboard || []).map((card) => card.id + ':' + card.state));
        write({ ...after, lastSent: today(), lastSentAt: now(), uses: left, peaks: {}, day: state.cleanDay(day), funnel: null, lastVersion: String(appVersion), billboard: after.billboard.filter((card) => !reported.has(card.id + ':' + card.state)) });
      }
      try { afterSend(); } catch { /* a note for the caller only */ }
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
  /** An answer to an in-app question (`survey`, no id): the survey is one of ours (an id), the answer one of a closed list. Sent once, only while sharing is on. */
  async function survey(id, answer) {
    if (typeof id !== 'string' || !facts4.SURVEY_ID.test(id) || !facts4.SURVEY_ANSWERS.includes(answer)) throw new Error('Choose one of the survey answers.');
    if (read().choice !== 'on') return { sent: false, reason: 'off' };
    if (!target) return { sent: false, reason: 'no endpoint' };
    try { if (!routeOk()) return { sent: false, reason: 'route' }; const reply = await send(target, JSON.stringify({ schema: 4, event: 'survey', survey: id, answer, appVersion: String(appVersion), platform: String(platform), day: today() })); return reply === 204 || reply === 200 || reply === 202 ? { sent: true } : { sent: false, reason: 'server' }; }
    catch { return { sent: false, reason: 'network' }; }
  }
  /** Writes the pending counts and waits for an `off` message that is on its way (tests, and the app at quit). */
  const idle = async () => { flushPending(); await pendingOff; };
  return { status, set, setAskRatings, maybeSend, note, everUsed, notePeaks, noteImport, notePasswordsImported, noteSignBackIn, noteActive, notePage, noteSearch, noteSection, noteCrash, noteTrackers, noteMemory, noteSession, noteBillboard, noticeAct, survey, idle, flush: flushPending,
    ratingSession, ratingOffer, ratingShown, ratingDismiss, ratingAnswer, payload: () => payload(), offMessage };
}

/** The real transport: Electron's net on an isolated in-memory session. POST, JSON body, no cookies, no Referer, one generic User-Agent, no redirects. */
function electronSend(session, userAgent) {
  return async (url, body) => {
    const response = await session.fetch(url, { method: 'POST', body, credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', headers: { 'Content-Type': 'application/json', 'User-Agent': userAgent }, signal: AbortSignal.timeout(10000) });
    return response.status;
  };
}

module.exports = { createMetrics, electronSend, checkedEndpoint, uninstallMessage, SAMPLE_ID };
