'use strict';
// Beta 14 section E, browser side: one service for the whole app. It owns, per profile, the contributor key (contributor-key.cjs) and the local copy of
// points, rank, marks, notes and sent reports (contributor-store.cjs), and answers the interface's `feedback.*` requests (desktop/preload.cjs ->
// 'acira:feedback'). Rules it keeps, each tested in tests/feedback-service.test.cjs:
//  - A private profile, a private window and a Tor window have no contributor: nothing is made, shown or sent for them.
//  - Nothing leaves the device until the person reports or connects something (`engaged`); before that the key only exists on disk.
//  - The server's answer wins over the local copy; the local copy is shown instantly and offline.
//  - Standing requests (the refresh) run at launch (after a quiet delay), once a day, and when the profile viewer or the report pop-up opens; never
//    after a quit has begun, never without the profile's own proxy ready, and a failed one changes nothing.
//  - The off switch hides points, rank, ring, aura and notes; report status still works; points keep counting on the server's side.
//  - "Delete my contributor data" removes the server's record first (and keeps everything when that fails, so the record is never orphaned),
//    then the key and the copy on this device; the Early Member mark, the switch and the auras already shown are kept.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createContributorKeys } = require('./contributor-key.cjs');
const { createContributorStore, blank } = require('./contributor-store.cjs');
const model = require('./contributor-model.cjs');
const media = require('./feedback-media.cjs');
const { buildReport, KINDS, CATEGORIES } = require('./feedback-report.cjs');
const { createFeedbackClient, endpoints: defaultEndpoints } = require('./feedback-client.cjs');
const { createInsiderService } = require('../insider/insider-service.cjs');
const { insiderConfig } = require('../insider/insider-config.cjs');
const { certificateTier } = require('../insider/membership-tier.cjs');
const { fromB64u, keyPairFromSeed } = require('../insider/acira-signing.cjs');

const OPEN_REFRESH_GAP = 15000, DAY = 24 * 60 * 60 * 1000, LAUNCH_DELAY = 30000, TICK = 60 * 60 * 1000, DRAFT_IDLE = 30 * 60 * 1000, MAX_DRAFTS = 8;
const fail = (message) => { throw new Error(message); };
const str = (value, label, max) => { if (typeof value !== 'string' || value.length > max) fail(`${label} must be text of at most ${max} characters.`); return value; };
/** Whether a version is before 1.0: the Early Member mark is open until then. */
const beforeOne = (version) => { const major = Number.parseInt(String(version).replace(/^v/, ''), 10); return Number.isFinite(major) && major < 1; };

function createFeedbackService({
  directory, keys = null, appVersion, platform = process.platform, channel = 'beta', profiles = () => [], getSession = () => null, routeReady = () => true,
  facts = () => ({}), send, endpoints = defaultEndpoints(), emit = () => {}, openFilePicker = null, now = Date.now, random = crypto.randomBytes,
  fileSystem = fs, setTimer = setTimeout, clearTimer = clearTimeout, onWarning = () => {},
  /** Beta 14: the Insider programme's settings (insider-config.cjs), where its small files live, and where an event goes (usage-hooks names; nothing personal, never for a private or Tor window). */
  insider: insiderOptions = {}, note = () => {},
}) {
  const keyring = createContributorKeys({ dir: directory, keys, random, now, fileSystem });
  const store = createContributorStore({ dir: directory, fileSystem, warn: onWarning });
  const client = createFeedbackClient({ endpoints, keys: keyring, send, now });
  const drafts = new Map(); // windowId -> {items: [{id, record, bytes}], touched}
  const busy = new Set();   // profile ids with a standing request in flight
  const generation = new Map(); // profile id -> counter, raised when its data is deleted: an answer that was already on its way is then ignored
  const generationOf = (profileId) => generation.get(profileId) || 0;
  const lastOpened = new Map(); // profile id -> time of the last refresh the viewer or pop-up opening asked for
  const sending = new Set();    // profile ids with a report on its way: a second Send waits for it
  let stopped = false, launchTimer = null, tickTimer = null;
  const available = () => client.available();
  const ordinary = (profileId) => profiles().some((profile) => profile.id === profileId && !profile.private);
  /** A context counts as a contributor's only in an ordinary profile outside a private or Tor window. */
  const eligible = (ctx) => Boolean(ctx.profileId) && !ctx.private && !ctx.tor && ordinary(ctx.profileId);
  const sessionFor = (ctx) => ctx.session ?? getSession(ctx.profileId);
  const routed = (session) => { try { return Boolean(session) && routeReady(session) !== false; } catch { return false; } };
  const tell = (profileId) => { try { emit(profileId); } catch { /* a closed window */ } };
  /** The team decision (16 Nov 21:40): every profile with a VALID Insider certificate (the private link, or the automatic enrollment that issues the same certificate) shows the Founding Contributor
   * rank, seal, ring and aura, and the Founding card; it never shows the Early Member mark or plays its aura. Without a certificate nothing here changes (an 'insider' rank from the points copy still shows as Trusted). */
  // Public 14.4 (24 Nov): the certificate's NUMBER decides which of the two it is: 1 to 100 the Founding Contributor (rank 'founding'), 101 and up an Insider (rank 'insider'), the same line the server draws (membership-tier.cjs).
  // Nothing changes for a number up to 100, and never the certificate's `by` field. A certificate whose number cannot be read counts as Founding, as every certificate did before.
  const certifiedRankOf = (number) => certificateTier(number) ?? 'founding';
  const certifiedAuraOf = (number) => `rank:${certifiedRankOf(number)}`;
  /** The number of the certificate this profile shows (its own, else the install's numbered profile's), or null. */
  const certifiedNumber = (profileId) => { try { return insider.shownMember(profileId)?.number ?? null; } catch { return null; } };
  const insider = createInsiderService({
    directory: insiderOptions.directory || path.join(directory, 'insider'), keyring, config: insiderOptions.config || insiderConfig(), send, ordinary, eligible, sessionFor, routed, profiles, tell, note,
    onChannelChange: insiderOptions.onChannelChange, describeProfile: insiderOptions.profile || (() => null), wait: insiderOptions.wait, random: insiderOptions.random,
    // Automatic enrollment only when the app that made this service allows it (main.cjs: insider.enroll), so a service made anywhere else (tests, tools) never sends on its own.
    allowEnroll: insiderOptions.enroll === true, ...(insiderOptions.enrollDelay !== undefined ? { enrollDelay: insiderOptions.enrollDelay } : {}),
    // An activation or a code makes the key the way every profile's is (the Early Member mark with it), and a profile made an Insider has its "new rank" aura marked played (the sheet's or the reveal's seal is its moment).
    ensureProfile: (profileId) => ensureProfile(profileId),
    // Beta 14.5: a member who opens the invites screen or makes a code has joined the invite programme, so their profile asks the server for its record from then on (a friend who joins adds points that it tells
    // about); nothing is asked before that, as for everyone else. The deliberate act is the engagement, as sending a report is.
    onInvites: (profileId) => { if (certificateTier(certifiedNumber(profileId)) === 'insider' && !store.read(profileId).engaged) store.update(profileId, (current) => { current.engaged = true; return current; }); },
    onActivated: (profileId) => { const certifiedAura = certifiedAuraOf(certifiedNumber(profileId)); store.update(profileId, (current) => { if (!current.aura.played.includes(certifiedAura)) current.aura.played.push(certifiedAura); if (current.aura.pending && current.aura.pending !== 'earlyMember') current.aura.pending = null; return current; }); },
    now, fileSystem, onWarning,
  });
  /** The higher of two ranks (either may be null). */
  const higherRank = (a, b) => (model.rankIndex(a) >= model.rankIndex(b) ? a : b);
  /** Beta 14.4: the bubble for accepted reports that only added points: its id carries the total ('points:25'); null when nothing is owed. */
  const pointsAuraOf = (n) => (Number.isInteger(n) && n > 0 ? `points:${n}` : null);
  const POINTS_ID = /^points:[1-9]\d{0,6}$/;
  /** Beta 14.5: the bubble for friends who joined with the member's invite code ('invite:25'); after the points bubble of reports, null when nothing is owed. */
  const inviteAuraOf = (n) => (Number.isInteger(n) && n > 0 ? `invite:${n}` : null);
  const INVITE_ID = /^invite:[1-9]\d{0,6}$/;
  /** The total-carrying bubbles (their id is 'points:<n>' or 'invite:<n>'): what kind it is, and its total. */
  const totalOf = (id) => (typeof id === 'string' && (POINTS_ID.test(id) || INVITE_ID.test(id)) ? { kind: id.slice(0, id.indexOf(':')), total: Number(id.slice(id.indexOf(':') + 1)) } : null);
  const pendingTotal = (local) => pointsAuraOf(local.pointsOwed) ?? inviteAuraOf(local.inviteOwed);   // the id comes from the interface: only a whole, positive total of at most seven digits
  /** The aura a profile is owed, for the view: a certificate holder is owed the Founding aura (once), never the Early Member one and never an Insider one. */
  const auraOwed = (local, certified, number = null) => {
    const pending = local.aura.pending;
    if (!pending) return null;
    if (!certified) return pending === 'rank:insider' ? null : pending;
    const certifiedAura = certifiedAuraOf(number);
    return pending === 'earlyMember' || local.aura.played.includes(certifiedAura) ? null : certifiedAura;
  };

  /** The profile's key and copy, made if missing (only for an ordinary profile). The Early Member mark is set when the key is made, while the version is before 1.0. */
  function ensureProfile(profileId) {
    if (!ordinary(profileId)) return null;
    const had = keyring.peek(profileId);
    if (had.state === 'unreadable') return { key: 'unreadable', local: store.read(profileId) };
    const identity = keyring.ensure(profileId);
    if (identity.state !== 'ready') return { key: 'unreadable', local: store.read(profileId) };
    let local = store.read(profileId);
    if (had.state === 'none' || !store.exists(profileId)) {
      local = store.update(profileId, (current) => {
        if (!current.earlyMember && beforeOne(appVersion)) current.earlyMember = true;
        if (current.earlyMember && !current.aura.played.includes('earlyMember')) current.aura.pending = 'earlyMember';
        return current;
      });
    }
    return { key: 'ready', local };
  }

  /** The rank emblems are not shipped: until the team's final look no build shows them. A test profile (ACIRA_BROWSER_TEST_DATA) may switch them on, by the variable or by setEmblem: `default` (or `1`, `on`) is the drawing
   * chosen as the default while the team is away (hybrid: the Mark ladder, engraved only at Founding); `mark`, `etched` and `ring` stay selectable for the review. Anything else is off. */
  let emblemChosen = null;
  const EMBLEMS = { default: 'hybrid', 1: 'hybrid', on: 'hybrid', hybrid: 'hybrid', mark: 'mark', etched: 'etched', ring: 'ring' };
  const emblem = () => { if (!process.env.ACIRA_BROWSER_TEST_DATA) return null; const name = String(emblemChosen ?? process.env.ACIRA_RANK_EMBLEM ?? ''); return Object.hasOwn(EMBLEMS, name) ? EMBLEMS[name] : null; };

  function view(ctx) {
    // `insider` is part of every view: the interface reads view.insider.welcome on every window (WelcomeHost), and insider.view answers NONE for a context that is not eligible.
    if (!eligible(ctx)) return { ...model.viewOf(null, { available: false, privateOrTor: true, key: 'none' }), emblem: null, insider: insider.view(ctx) };
    const found = ensureProfile(ctx.profileId);
    const base = model.viewOf(found.local, { available: available(), key: found.key });
    // Beta 14: an Insider by pass (a pass that verifies for this profile, insider-pass.cjs) shows at least the Insider rank; losing the pass falls back to the rank the server gave.
    // Beta 14 (the team, 15 Nov 19:51): the word "Insider" needs a valid certificate. A certificate shows at least the Insider rank; WITHOUT one, an 'insider' rank from the points copy (unsigned, kept on this
    // computer) is shown as Trusted Contributor, the highest rank points alone give here, so no local copy or file edit can show the Insider rank.
    // One person = one number (17 Nov): a profile without a certificate of its own shows the install's numbered profile's Founding rank, with no aura of its own (no second reveal).
    const ownCert = insider.isInsider(ctx.profileId), lent = !ownCert && insider.showsCertified(ctx.profileId);
    if (!base.off && !base.privateOrTor && (ownCert || lent)) { const number = certifiedNumber(ctx.profileId), rank = certifiedRankOf(number); if (rank !== base.rank) { base.rank = rank; base.next = null; } base.mark = null; base.aura = ownCert ? auraOwed(found.local, true, number) : null; }
    else { if (base.rank === 'insider') { base.rank = 'trusted'; base.next = null; } if (base.aura) base.aura = auraOwed(found.local, false); }
    // The bubble for points only (never for a private window or the switch off); a rank's or the mark's aura goes first, this one follows when that has been shown.
    if (!base.aura && !base.off && !base.privateOrTor) base.aura = pendingTotal(found.local);
    // A note's "You are now a ..." line is the server's own rank event. It is told only when that rank is the one the profile shows now or one above the last it showed: never the Insider rank (150 points: this build never
    // shows it, Trusted above) and never a rank BELOW the shown one (a Founding Contributor, by certificate or by hand, is not told "You are now a Trusted Contributor"). The note keeps its other lines.
    const shownIndex = model.rankIndex(base.rank);
    base.notes = base.notes.map((note) => (note.rank && (note.rank === 'insider' || model.rankIndex(note.rank) < shownIndex) ? { ...note, rank: null } : note));
    return { ...base, inviteUrl: endpoints.discordInvite || '', emblem: emblem(), insider: insider.view(ctx) };
  }

  /** Applies a server answer's `state` to the profile's copy. {ok:false} when it is not a well-formed answer (nothing changes), else {ok:true, gained} (the rank just reached, or null). */
  function apply(profileId, answerState) {
    const server = model.normalizeServer(answerState, { now });
    if (!server) return { ok: false, gained: null };
    let gained = null;
    store.update(profileId, (current) => { const result = model.applyServer(current, server, { certified: insider.showsCertified(profileId) }); gained = result.newRank; return result.local; });
    tell(profileId);
    return { ok: true, gained };
  }

  /** The standing request. Only for an engaged profile, only when the endpoints are set, the proxy is ready and no quit has begun. Resolves true when the answer was applied. */
  async function refresh(profileId, session) {
    if (stopped || !available() || busy.has(profileId) || !ordinary(profileId)) return false;
    const local = store.read(profileId);
    if (!local.engaged || !routed(session)) return false;
    busy.add(profileId);
    const mine = generationOf(profileId);
    try {
      const answer = await client.status(profileId, { marks: local.earlyMember ? ['earlyMember'] : [], appVersion }, session);
      if (stopped || !answer.ok || generationOf(profileId) !== mine) return false;
      return apply(profileId, answer.json.state).ok;
    } catch { return false; } finally { busy.delete(profileId); }
  }

  const draftOf = (windowId) => {
    for (const [id, draft] of drafts) if (now() - draft.touched > DRAFT_IDLE) drafts.delete(id);
    if (!drafts.has(windowId)) { if (drafts.size >= MAX_DRAFTS) drafts.delete(drafts.keys().next().value); drafts.set(windowId, { items: [], touched: now() }); }
    const draft = drafts.get(windowId); draft.touched = now(); return draft;
  };
  const counts = (draft) => ({ images: draft.items.filter((item) => item.record.kind === 'image').length, videos: draft.items.filter((item) => item.record.kind === 'video').length });
  const listDraft = (draft) => draft.items.map((item) => ({ id: item.id, ...item.record, bytes: undefined, size: item.record.bytes }));
  const filesOf = (draft) => [...draft.items.filter((item) => item.record.kind === 'image'), ...draft.items.filter((item) => item.record.kind === 'video')];

  function attach(ctx, input) {
    const draft = draftOf(ctx.windowId);
    const checked = media.inspect(Buffer.isBuffer(input) ? input : Buffer.from(input));
    if (!checked.ok) return { ok: false, reason: checked.reason, files: listDraft(draft) };
    if (!media.fits(checked.record, counts(draft))) return { ok: false, reason: 'count', files: listDraft(draft) };
    draft.items.push({ id: random(8).toString('hex'), record: checked.record, bytes: checked.bytes });
    return { ok: true, files: listDraft(draft) };
  }

  function payloadOf(ctx, request, { draft = false } = {}) {
    const items = filesOf(draftOf(ctx.windowId));
    return buildReport({ kind: request.kind, category: request.category ?? null, text: request.text ?? '', details: request.details === true, facts: request.details === true ? (typeof ctx.facts === 'function' ? ctx.facts : facts)() : null, files: items.map((item) => item.record), appVersion, channel, platform }, { draft });
  }

  const handlers = {
    state: (ctx) => ({ view: view(ctx) }),
    /** What each ordinary profile's picture wears, from the local copies only: the rank ring (Contributor and up) or nothing, and the mark. Nothing for a private context. */
    rings: (ctx) => {
      if (ctx.private || ctx.tor) return { rings: {} };
      api.ensureAll(); // a profile made since the start gets its key here, the first time anything asks about profiles
      const rings = {};
      for (const profile of profiles()) {
        if (profile.private) continue;
        const local = store.read(profile.id), shown = !local.off;
        const certified = insider.showsCertified(profile.id); // own certificate or the install's numbered profile's (one person = one number)
        const ring = shown && certified ? certifiedRankOf(certifiedNumber(profile.id)) : local.ringRank === 'insider' ? 'trusted' : local.ringRank; // a certificate holder wears the Founding ring and no Early Member mark; without one an Insider ring is Trusted
        // `points` is what the profile menu's row shows beside its rank token (B2, 17 Nov): the local copy's figure, null where nothing is shown (the switch is off, or the key cannot be read).
        rings[profile.id] = { rank: shown ? ring : null, mark: shown && !certified && local.earlyMember ? 'earlyMember' : null, dot: shown && local.dot, points: shown && keyring.peek(profile.id).state === 'ready' ? (local.server?.points ?? 0) : null };
      }
      return { rings, emblem: emblem() };
    },
    /** The viewer or the pop-up opened: the quiet dot goes, and an engaged profile asks the server for its record (the local copy is shown at once, the answer follows as an event). */
    opened: async (ctx) => {
      if (!eligible(ctx)) return { view: view(ctx) };
      ensureProfile(ctx.profileId);
      if (store.read(ctx.profileId).dot) { store.update(ctx.profileId, (current) => { current.dot = false; return current; }); tell(ctx.profileId); }
      const first = view(ctx);
      if (store.read(ctx.profileId).engaged && now() - (lastOpened.get(ctx.profileId) || 0) > OPEN_REFRESH_GAP) { lastOpened.set(ctx.profileId, now()); void refresh(ctx.profileId, sessionFor(ctx)); }
      return { view: first };
    },
    refresh: async (ctx) => { if (eligible(ctx)) await refresh(ctx.profileId, sessionFor(ctx)); return { view: view(ctx) }; },
    preview: (ctx, request) => {
      if (!eligible(ctx)) return { available: false, reason: 'private' };
      if (!available()) return { available: false, reason: 'unavailable' };
      try { return { available: true, payload: payloadOf(ctx, request, { draft: true }), files: listDraft(draftOf(ctx.windowId)) }; } catch (error) { return { available: true, payload: null, error: error.message, files: listDraft(draftOf(ctx.windowId)) }; }
    },
    attach: (ctx, request) => (eligible(ctx) ? attach(ctx, Buffer.from(request.data)) : { ok: false, reason: 'private', files: [] }),
    /** The system file chooser (production only; QA never reaches it). Each chosen file goes through the same checks as a dropped one. */
    pick: async (ctx) => {
      if (!eligible(ctx) || typeof openFilePicker !== 'function') return { ok: false, reason: 'unavailable', files: listDraft(draftOf(ctx.windowId)), results: [] };
      const chosen = await openFilePicker(ctx);
      const results = [];
      for (const file of chosen || []) { const added = attach(ctx, file); results.push(added.ok ? { ok: true } : { ok: false, reason: added.reason }); }
      return { ok: results.some((item) => item.ok), files: listDraft(draftOf(ctx.windowId)), results };
    },
    draftFile: (ctx, request) => { const item = draftOf(ctx.windowId).items.find((entry) => entry.id === request.id); return item ? { ok: true, record: item.record, data: new Uint8Array(item.bytes) } : { ok: false }; },
    draftRemove: (ctx, request) => { const draft = draftOf(ctx.windowId); draft.items = draft.items.filter((item) => item.id !== request.id); return { ok: true, files: listDraft(draft) }; },
    draftClear: (ctx) => { drafts.delete(ctx.windowId); return { ok: true, files: [] }; },
    send: async (ctx, request) => {
      if (!eligible(ctx)) return { sent: false, failure: 'private' };
      if (!available()) return { sent: false, failure: 'unavailable' };
      const found = ensureProfile(ctx.profileId);
      if (found.key !== 'ready') return { sent: false, failure: 'nokey' };
      const session = sessionFor(ctx);
      if (!routed(session)) return { sent: false, failure: 'offline' };
      let payload;
      try { payload = payloadOf(ctx, request); } catch (error) { return { sent: false, failure: 'invalid', message: error.message }; }
      if (sending.has(ctx.profileId)) return { sent: false, failure: 'later' };
      sending.add(ctx.profileId);
      try {
        const draft = draftOf(ctx.windowId), files = filesOf(draft);
        const result = await client.report(ctx.profileId, payload, files.map((item) => ({ ...item.record, bytes: item.bytes })), session);
        if (!result.sent) return { sent: false, failure: result.failure };
        // The report is out: whatever happens to the bookkeeping, it is never told as "not sent" (a resend would duplicate it).
        try {
          store.update(ctx.profileId, (current) => {
            current.engaged = true;
            current.sent.push({ id: result.id, kind: payload.kind, snippet: model.plain(payload.text, 80), at: new Date(now()).toISOString(), files: payload.attachments.length });
            return current;
          });
          if (result.state) apply(ctx.profileId, result.state);
        } catch (error) { onWarning(`Feedback: the report went out but could not be noted on this computer: ${error.message}`); }
        drafts.delete(ctx.windowId);
        tell(ctx.profileId);
        let after; try { after = view(ctx); } catch { after = undefined; }
        return { sent: true, attachmentsFailed: result.attachmentsFailed, ...(after ? { view: after } : {}) };
      } finally { sending.delete(ctx.profileId); }
    },
    /** A note's name answer ("Want to be thanked in the release notes?"): the name, or null for no. */
    thanks: async (ctx, request) => {
      if (!eligible(ctx)) return { ok: false };
      const name = request.name === null ? null : model.plain(str(request.name, 'Name', 80), 40) || null;
      const session = sessionFor(ctx);
      if (!available() || !routed(session)) return { ok: false, failure: 'offline', view: view(ctx) };
      const answer = await client.thanks(ctx.profileId, { noteId: str(request.noteId, 'Note', 64), name }, session);
      if (!answer.ok) return { ok: false, failure: answer.failure, view: view(ctx) };
      store.update(ctx.profileId, (current) => { current.thanks = name ? { name } : null; if (!current.notesSeen.includes(request.noteId)) current.notesSeen.push(request.noteId); return current; });
      if (answer.json.state) apply(ctx.profileId, answer.json.state);
      tell(ctx.profileId);
      return { ok: true, view: view(ctx) };
    },
    /** A note the person has read and closed: it stops showing here and (best effort) stops being sent. */
    /** The new-tab page's aura tip (the team's notes 17 Nov, A4) was shown and closed: the aura it stood for is done, as the layer's own end marks it (the ring, then the quiet dot). Only the aura this profile owes counts. */
    auraTip: (ctx, request) => {
      str(request.id, 'Id', 40);
      if (!eligible(ctx)) return { done: false };
      const owed = api.auraPending(ctx.profileId);
      const owedTotal = totalOf(owed);
      if (!owed || (owed !== request.id && !(owedTotal && totalOf(request.id)?.kind === owedTotal.kind))) return { done: false };   // a total that grew while the bubble was up is still the same kind of bubble
      api.auraDone(ctx.profileId, owedTotal ? request.id : owed);
      return { done: true };
    },
    noteSeen: async (ctx, request) => {
      if (!eligible(ctx)) return { ok: false };
      const id = str(request.id, 'Note', 64);
      store.update(ctx.profileId, (current) => { if (!current.notesSeen.includes(id)) current.notesSeen.push(id); return current; });
      const session = sessionFor(ctx);
      if (available() && store.read(ctx.profileId).engaged && routed(session) && !stopped) void client.seen(ctx.profileId, [id], session);
      tell(ctx.profileId);
      return { ok: true, view: view(ctx) };
    },
    setOff: (ctx, request) => {
      if (!eligible(ctx)) return { ok: false };
      ensureProfile(ctx.profileId);
      store.update(ctx.profileId, (current) => { current.off = request.off === true; if (current.off) current.dot = false; return current; });
      tell(ctx.profileId);
      return { ok: true, view: view(ctx) };
    },
    /** "Delete my contributor data" (Beta 14, the reference design B5, 17 Nov): the points, the rank, the report list and the record on our side go; the KEY AND THE INSIDER CERTIFICATE STAY, because the key is also the profile's Insider ID
     * (one key pair per profile): deleting it took the Insider number with it, unannounced. Only a key that cannot be read has no ID to keep, so that one is still replaced (it is how a person gets out of an unreadable key). */
    deleteData: async (ctx) => {
      if (!eligible(ctx)) return { ok: false };
      const local = store.read(ctx.profileId);
      const keyReadable = keyring.peek(ctx.profileId).state === 'ready';
      if (local.engaged && keyReadable) {
        const session = sessionFor(ctx);
        if (!available() || !routed(session)) return { ok: false, failure: 'offline', view: view(ctx) };
        const answer = await client.deleteData(ctx.profileId, session);
        if (!answer.ok) return { ok: false, failure: answer.failure, view: view(ctx) };
      }
      generation.set(ctx.profileId, generationOf(ctx.profileId) + 1);
      const keep = { earlyMember: local.earlyMember, off: local.off, played: local.aura.played };
      if (keyReadable) store.remove(ctx.profileId); // the key and the certificate stay: the Insider number is kept
      else { keyring.remove(ctx.profileId); store.remove(ctx.profileId); insider.forget(ctx.profileId); ensureProfile(ctx.profileId); } // a pass is tied to the key that is gone
      store.update(ctx.profileId, (current) => { current.earlyMember = keep.earlyMember; current.off = keep.off; current.aura = { played: keep.played, pending: null }; return current; });
      tell(ctx.profileId);
      return { ok: true, view: view(ctx) };
    },
  };
  const ROUTES = {
    'feedback.state': 'state', 'feedback.rings': 'rings', 'feedback.opened': 'opened', 'feedback.refresh': 'refresh', 'feedback.preview': 'preview', 'feedback.attach': 'attach', 'feedback.pick': 'pick',
    'feedback.draft-file': 'draftFile', 'feedback.draft-remove': 'draftRemove', 'feedback.draft-clear': 'draftClear', 'feedback.send': 'send', 'feedback.thanks': 'thanks',
    'feedback.note-seen': 'noteSeen', 'feedback.set-off': 'setOff', 'feedback.delete-data': 'deleteData', 'feedback.aura-tip': 'auraTip',
  };
  /** Beta 14: the Insider programme's requests (insider/insider-service.cjs handlers). Answers go back under `insider`, not `feedback`. */
  const INSIDER_ROUTES = {
    'insider.state': 'state', 'insider.opened': 'opened', 'insider.redeem': 'redeem', 'insider.invite': 'invite', 'insider.invites': 'invites', 'insider.channel': 'channel',
    'insider.offer': 'offer', 'insider.activate': 'activate', 'insider.decline': 'decline', 'insider.move-code': 'moveCode',
    'insider.reveal-seen': 'revealSeen', 'insider.welcome-claim': 'welcomeClaim', 'insider.welcome-step': 'welcomeStep', 'insider.welcome-done': 'welcomeDone', 'insider.reveal-claim': 'revealClaim', 'insider.reveal-release': 'revealRelease', 'insider.flow-set': 'flowSet', 'insider.flow-take': 'flowTake',
  };
  // The activation sheet's requests carry NO token (main keeps it with the window's question, insider-service.cjs offer): the interface can only say Activate or Not now.
  const INSIDER_FIELDS = { state: [], opened: [], redeem: ['code'], invite: [], invites: [], channel: ['on'], offer: [], activate: [], decline: [], moveCode: [], revealSeen: [], welcomeClaim: [], welcomeStep: ['step'], welcomeDone: [], revealClaim: [], revealRelease: [], flowSet: ['flow'], flowTake: [] };
  const FIELDS = {
    state: [], rings: [], opened: [], refresh: [], preview: ['kind', 'category', 'text', 'details'], attach: ['data'], pick: [], draftFile: ['id'], draftRemove: ['id'], draftClear: [],
    send: ['kind', 'category', 'text', 'details'], thanks: ['noteId', 'name'], noteSeen: ['id'], setOff: ['off'], deleteData: [], auraTip: ['id'],
  };
  async function handleInsider(route, request, ctx) {
    for (const key of Object.keys(request)) if (key !== 'type' && !INSIDER_FIELDS[route].includes(key)) fail('Unexpected feedback request field.');
    if (route === 'redeem') str(request.code, 'Code', 400);
    if (route === 'channel' && typeof request.on !== 'boolean') fail('Choose on or off.');
    if (route === 'welcomeStep') str(request.step, 'Step', 20);
    if (route === 'flowSet') str(request.flow, 'Flow', 20);
    const answer = await insider.handlers[route](ctx, request);
    // A new Insider by code or by the link's sheet: the reveal is its moment, so the "new rank" aura is not owed on top of it. The welcome's seal step is the Early Member mark's moment: its aura is not owed either.
    const played = (route === 'redeem' || route === 'activate') && answer?.result === 'ok' ? certifiedAuraOf(certifiedNumber(ctx.profileId)) : route === 'welcomeStep' && request.step === 'seal' ? 'earlyMember' : null;
    if (played && ctx.profileId && eligible(ctx)) { try { store.update(ctx.profileId, (current) => { if (!current.aura.played.includes(played)) current.aura.played.push(played); if (current.aura.pending === played) current.aura.pending = null; return current; }); } catch { /* the aura just plays */ } }
    return answer;
  }

  /** The interface's entry point. `ctx`: {profileId, private, tor, windowId, session}. Unknown types and extra fields are refused. */
  async function handle(request, ctx) {
    if (!request || typeof request !== 'object' || Array.isArray(request) || typeof request.type !== 'string') fail('Invalid feedback request.');
    // Automatic enrollment (first Insider build): the profile's first request of this run from an ordinary window asks for its number, quietly and without waiting for it.
    if (!stopped && ctx && eligible(ctx)) void insider.autoEnroll(ctx); // asks nothing unless main allowed it (allowEnroll) and the build has autoEnroll on
    if (Object.hasOwn(INSIDER_ROUTES, request.type)) return { insider: await handleInsider(INSIDER_ROUTES[request.type], request, ctx || {}) };
    const route = Object.hasOwn(ROUTES, request.type) ? ROUTES[request.type] : null;
    if (!route) fail('Unknown feedback request.');
    for (const key of Object.keys(request)) if (key !== 'type' && !FIELDS[route].includes(key)) fail('Unexpected feedback request field.');
    if (route === 'preview' || route === 'send') {
      if (!KINDS.includes(request.kind)) fail('Choose a bug or an idea.');
      if (request.category !== undefined && request.category !== null && !CATEGORIES.includes(request.category)) fail('Unknown category.');
      if (request.text !== undefined) str(request.text, 'Text', 20000);
    }
    if (route === 'attach' && !(request.data instanceof ArrayBuffer || ArrayBuffer.isView(request.data))) fail('A file must be bytes.');
    if (route === 'thanks' && request.name !== null) str(request.name, 'Name', 80);
    if (route === 'setOff' && typeof request.off !== 'boolean') fail('Choose on or off.');
    return { feedback: await handlers[route](ctx || {}, request) };
  }

  /**
   * Beta 14 + AH rule 9 + AM rule 4: the profile's ID (its key pair) and Insider certificate for the profile copy ("Move or copy this profile to another computer") and, later,
   * any sync. The copy carries the KEY ITSELF, re-encrypted inside its own end-to-end encryption; the operating system's protected file is never copied (it opens only here).
   */
  const IDENTITY_FORMAT = 'acira-identity', IDENTITY_MAX = 16 * 1024, ENCRYPTED = ['code', 'locked-file'];
  const identity = {
    /**
     * The bytes to put INSIDE the copy's encryption: UTF-8 JSON {format, v:1, key (the 32-byte seed, base64url), publicKey, createdAt, cert|null, recognition}. They hold the private
     * key. `destination` must be 'code' (the relay's end-to-end payload) or 'locked-file' (a password-locked profile file): anything else throws (code 'identity-needs-encryption'),
     * so the key never goes into a file without a password. null: a private profile, or no readable key (nothing to move).
     */
    export(profileId, { destination } = {}) {
      if (!ENCRYPTED.includes(destination)) throw Object.assign(new Error('The profile\'s ID key only travels inside an encrypted copy: by code, or in a password-locked file.'), { code: 'identity-needs-encryption' });
      if (!ordinary(profileId)) return null;
      const seed = keyring.exportSeed(profileId);
      if (!seed) return null;
      const local = store.read(profileId);
      return Buffer.from(JSON.stringify({
        format: IDENTITY_FORMAT, v: 1, key: seed.seed, publicKey: seed.publicKey, createdAt: seed.createdAt, cert: insider.certificateOf(profileId) || null,
        recognition: { earlyMember: local.earlyMember, engaged: local.engaged, off: local.off, ringRank: local.ringRank, auraPlayed: [...local.aura.played], welcomeSeen: insider.welcomeSeen(profileId) },
      }), 'utf8');
    },
    /**
     * Takes an ID brought by a copy into `profileId`. mode 'new' (a profile the copy just made): always adopted. mode 'current': adopted only when this profile's own ID was never
     * used (nothing reported or connected, no certificate), else {ok:false, reason:'own'} and nothing changes. The certificate is kept only when its sub is the brought key and it
     * verifies with a shipped kid ({certDropped:true} otherwise; the key is still adopted). The seed is wrapped under THIS computer's protected storage.
     * {ok:true, adopted:true, insider, number, certDropped} | {ok:false, reason:'format'|'private'|'own'}.
     */
    import(profileId, bytes, { mode = 'current' } = {}) {
      if (!ordinary(profileId)) return { ok: false, reason: 'private' };
      let blob;
      try { const buffer = Buffer.from(bytes); if (buffer.length > IDENTITY_MAX) throw new Error('large'); blob = JSON.parse(buffer.toString('utf8')); } catch { return { ok: false, reason: 'format' }; }
      if (!blob || blob.format !== IDENTITY_FORMAT || blob.v !== 1 || typeof blob.key !== 'string' || typeof blob.publicKey !== 'string') return { ok: false, reason: 'format' };
      const seed = fromB64u(blob.key, 32);
      try { if (!seed || keyPairFromSeed(seed).publicKey !== blob.publicKey) return { ok: false, reason: 'format' }; } finally { seed?.fill(0); }
      const own = keyring.peek(profileId), same = own.state === 'ready' && own.publicKey === blob.publicKey;
      if (mode !== 'new' && !same && (own.state === 'unreadable' || store.read(profileId).engaged || insider.certificateOf(profileId))) return { ok: false, reason: 'own' };
      if (!same) {
        generation.set(profileId, generationOf(profileId) + 1);
        insider.keyChanged(profileId);
        if (!keyring.adopt(profileId, { seed: blob.key, publicKey: blob.publicKey, createdAt: blob.createdAt })) return { ok: false, reason: 'format' };
      }
      const kept = blob.cert ? insider.adoptCertificate(profileId, blob.cert, blob.publicKey) : { kept: false, member: null };
      const r = blob.recognition && typeof blob.recognition === 'object' ? blob.recognition : {};
      store.update(profileId, (current) => {
        if (r.earlyMember === true) current.earlyMember = true;
        if (r.engaged === true) current.engaged = true;
        if (mode === 'new' && typeof r.off === 'boolean') current.off = r.off;
        if (typeof r.ringRank === 'string') current.ringRank = higherRank(current.ringRank, r.ringRank);
        for (const id of Array.isArray(r.auraPlayed) ? r.auraPlayed : []) if (typeof id === 'string' && !current.aura.played.includes(id)) current.aura.played.push(id);
        if (current.aura.pending && current.aura.played.includes(current.aura.pending)) current.aura.pending = null;
        return current;
      });
      if (r.welcomeSeen === true) insider.markWelcomeSeen(profileId);
      tell(profileId);
      const mine = insider.member(profileId);
      return { ok: true, adopted: true, insider: Boolean(mine), number: mine ? mine.number : null, certDropped: Boolean(blob.cert) && !kept.kept };
    },
    /** Undo of a copy that adopted an ID: the key, the certificate and the local recognition copy go; a fresh ID is made the next time one is needed. */
    forget(profileId) {
      generation.set(profileId, generationOf(profileId) + 1);
      keyring.remove(profileId); store.remove(profileId); insider.forget(profileId);
      tell(profileId);
    },
    /** What a preview or a proof may see (no secret): {publicKey, insider, number}. */
    peek(profileId) {
      const found = keyring.peek(profileId), mine = insider.member(profileId);
      return { publicKey: found.state === 'ready' ? found.publicKey : null, insider: Boolean(mine), number: mine ? mine.number : null };
    },
  };

  const api = {
    handle, view, available, ensureProfile, refresh, insider, identity,
    /** A test profile only: which rank emblem the pictures show (null = the dots). Ignored outside a test profile. */
    setEmblem(name) { emblemChosen = name ?? null; },
    /** Every ordinary profile has its key and copy from the Beta 14 update on (nothing is sent). */
    ensureAll() { for (const profile of profiles()) if (!profile.private) { try { ensureProfile(profile.id); } catch (error) { onWarning(`Contributor key: ${error.message}`); } } },
    /** A profile was deleted: its key and its copy go with it. */
    profileRemoved(profileId) { try { keyring.remove(profileId); store.remove(profileId); insider.forget(profileId); drafts.clear(); } catch (error) { onWarning(`Contributor key: ${error.message}`); } },
    /** Keys and copies whose profile no longer exists (a removal that was cut off) go at start. */
    tidy() { if (!profiles().some((profile) => !profile.private)) return; /* the profile list is not known yet: nothing may be called leftover */ const live = new Set(profiles().filter((profile) => !profile.private).map((profile) => profile.id)); for (const id of new Set([...keyring.list(), ...store.list()])) if (!live.has(id)) { keyring.remove(id); store.remove(id); } insider.tidy(live); },
    /** The aura a profile still owes (its id: 'earlyMember' or 'rank:<rank>'), or null; and that it was shown. */
    auraPending(profileId) { try { const local = store.read(profileId); return local.off ? null : (auraOwed(local, insider.isInsider(profileId)) ?? pendingTotal(local)); } catch { return null; } }, // a certificate holder is owed the Founding aura, never the Early Member one; the Insider aura no longer exists
    /** The aura closed as a ring: the resting ring appears now, under the layer's own identical one (the layer fades a moment later). The aura itself is marked done at its end. */
    auraRing(profileId, id) {
      if (typeof id !== 'string' || !id.startsWith('rank:')) return;
      store.update(profileId, (current) => { current.ringRank = id.slice(5); return current; });
      tell(profileId);
    },
    auraDone(profileId, id) {
      store.update(profileId, (current) => {
        if (id.startsWith('invite:')) { if (INVITE_ID.test(id)) current.inviteOwed = Math.max(0, current.inviteOwed - Math.min(Number(id.slice(7)), current.inviteOwed)); if (!current.off) current.dot = true; return current; }   // a friend's bubble told the member; never more than what is owed
        if (id.startsWith('points:')) { if (POINTS_ID.test(id)) current.pointsOwed = Math.max(0, current.pointsOwed - Math.min(Number(id.slice(7)), current.pointsOwed)); if (!current.off) current.dot = true; return current; }   // never more than what is owed, and never an addition   // the bubble told the member what it said; points that arrived while it was up stay for the next one
        if (!current.aura.played.includes(id)) current.aura.played.push(id);
        if (current.aura.pending === id) current.aura.pending = null;
        if (id.startsWith('rank:')) current.ringRank = id.slice(5);   // the ring appears now, identical to the one the aura closed as
        if (!current.off) current.dot = true;
        return current;
      });
      tell(profileId);
    },
    /** A test profile only (ACIRA_BROWSER_TEST_DATA): owe this profile the aura `id` again, as if it had never played, with no ring yet and no quiet dot (the pictures of the aura replay it). */
    qaOweAura(profileId, id) {
      if (!process.env.ACIRA_BROWSER_TEST_DATA || typeof id !== 'string') return false;
      store.update(profileId, (current) => { current.aura.played = current.aura.played.filter((item) => item !== id); current.aura.pending = id; current.ringRank = null; current.dot = false; return current; });
      tell(profileId);
      return true;
    },
    /** What the aura draws: the mark or the rank it is for (the colour is the rank's, set in one place in the interface). */
    peek(profileId) { return store.read(profileId); },
    /** The launch refresh (after a quiet delay) and a check every hour for a profile whose copy is a day old. */
    start() {
      stopped = false;
      const run = () => { for (const profile of profiles()) if (!profile.private) { const local = store.read(profile.id); if (local.engaged && now() - (local.server?.fetchedAt || 0) > DAY) void refresh(profile.id, getSession(profile.id)).catch(() => {}); } };
      launchTimer = setTimer(() => { launchTimer = null; for (const profile of profiles()) if (!profile.private && store.read(profile.id).engaged) void refresh(profile.id, getSession(profile.id)).catch(() => {}); }, LAUNCH_DELAY);
      tickTimer = setTimer(function again() { run(); tickTimer = setTimer(again, TICK); tickTimer.unref?.(); }, TICK);
      launchTimer.unref?.(); tickTimer.unref?.();
      insider.start();
    },
    /** A quit has begun: nothing new starts. */
    stop() { stopped = true; clearTimer(launchTimer); clearTimer(tickTimer); insider.stop(); drafts.clear(); },
    get stopped() { return stopped; },
  };
  return api;
}

module.exports = { createFeedbackService, beforeOne, LAUNCH_DELAY, DAY };
