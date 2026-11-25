'use strict';
// Beta 14 (final design, 15 Nov 18:07), browser side. One service for the whole app (made inside the feedback service, which owns the profile's key pair it signs with and the
// rules for who may be asked: an ordinary profile in a window that is not private and not Tor). What it keeps, per profile, is the CERTIFICATE the server signed (insider-store.cjs);
// whether the profile is an Insider is worked out from that certificate every time (acira-signing.cjs readCertificate), never stored as a flag.
// Rules, each tested in tests/insider-*.test.cjs:
//  - HIDDEN WHILE THE SERVER IS NOT NAMED: with no server address or no public key (insider-config.cjs) nothing about the programme is available: no sheet, no request, no event.
//  - PERMANENT (rule 2): a valid certificate never expires, is never renewed, and nothing is asked at launch or on a timer. The seal, the card and the number work offline for ever.
//  - ONLY A VALID CERTIFICATE MAKES AN INSIDER: one that verifies with a shipped kid AND names this profile's own public key. One that fails either check is removed. No local
//    flag, setting or file edit makes a profile an Insider.
//  - ACTIVATION (rule 4): a personal link only ever OPENS the confirmation sheet for the window's profile (`offer`); the request goes out only when the person taps Activate. The token
//    stays here, in main: the interface never holds it, and it is never counted, logged or kept on disk. Lost answers are retried safely (insider-client.cjs), then "Try again".
//  - "ENTER INSIDER CODE" (rules 4, 5, 9): an invite code (insider-redeem), a move code (insider-move) or a pasted link/token (insider-activate), told apart by their shape.
//  - REMOVAL WITHOUT ANY REFRESH (rule 7): when the server answers `revoked` to something an Insider asks (an invite, the list of invites, a move code, the Insider feed), the
//    certificate is deleted at once: the seal, the card, the Insider channel and the invite button go, and the profile is a normal member. No other check exists.
//  - The Insider update channel (rule 8) is offered only with a valid certificate (and a feed), is off by default, and is cleared with the certificate.
//  - An invite's code and a move code are handed to the interface once and never kept here; the list of invites is what the server says, masked; N is the server's.
//  - AUTOMATIC ENROLLMENT (reported 16 Nov, the first Insider builds 14.0 to 14.3; OFF from 14.4: insider-config.cjs SHIPPED.autoEnroll is false, a profile gets its pass only from a key; config.autoEnroll): an ordinary profile with no certificate, asking from a window that is not private or Tor,
//    asks the server for the next number ONCE per launch (autoEnroll, called by the feedback service at the profile's requests), quietly: no sheet, no prompt. For the team, who
//    open their RESERVED links (Nos. 1 and 2) on the same build: it waits 60 s after the launch (or until the welcome opens or moves on, which needs the status), never runs once an
//    activation link reached this run (pending or in progress), and never on a profile that holds any certificate. Only when the app allows it (`allowEnroll`, main.cjs).
//    ONE PER APP (reported 17 Nov): never while another ordinary profile of this app holds a certificate, and only the first profile to ask in a run asks (the others skip, writing nothing, so a later launch
//    checks again). Activation links and codes are not automatic enrollment: they still work on any profile.
//    ok -> the certificate is kept exactly as an activation keeps it (the welcome then shows the Insider seal and card, the viewer the rank). Offline, an error or `closed` (the
//    the team open enrollment at release time) -> asked again at a later launch, at most once per launch, for 14 days after the first try. full or revoked -> never again.
//  - THE ONE-TIME BETA 14 WELCOME (section AL) belongs to the welcome's own work: its show-once state and claim are kept here unchanged (markWelcomeOwed, welcome*), and it READS
//    the Insider state through `member(profileId)` (or the view's `member`). A profile that becomes an Insider after its welcome sees the seal and card in the activation sheet itself.
const fs = require('node:fs');
const { parseEntry, maskedCode } = require('./insider-code.cjs');
const { readCertificate, loadKeys } = require('./acira-signing.cjs');
const { createInsiderStore, WELCOME_STEPS } = require('./insider-store.cjs');
const { createInsiderClient } = require('./insider-client.cjs');
const { insiderConfig } = require('./insider-config.cjs');

const FLOWS = Object.freeze(['welcome', 'code', 'invites', 'seal', 'reveal', 'activate', 'move', 'card']);
/** The beta number of an Acira version ('0.1.0-beta.14.2' -> 14), or null when it is not a beta. A stable 1.x counts as after every beta. */
const betaOf = (version) => { const match = /-beta\.(\d+)/.exec(String(version ?? '')); if (match) return Number(match[1]); return /^v?[1-9]\d*\.\d+\.\d+(?:$|[+])/.test(String(version ?? '')) ? Infinity : null; };
/** [beta, fix] of a 0.1.0-beta.14.1 style version ('0.1.0-beta.14' is [14, 0]), or null. Used only to tell Beta 14.0 / 14.1 (the welcome was marked seen the moment it OPENED) from Beta 14.2 and later (D146). */
const betaPair = (version) => { const match = /-beta\.(\d+)(?:\.(\d+))?/.exec(String(version ?? '')); return match ? [Number(match[1]), Number(match[2] ?? 0)] : null; };
const pairBefore = (a, b) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
/** The first build that records the welcome as seen only when the person ends it. */
const WELCOME_FIXED_IN = Object.freeze([14, 2]);
/** The calm result of each code kind, for the usage counts (the result kind only, never the code). */
const CODE_NOTES = Object.freeze({ ok: 'insiderCodeOk', invalid: 'insiderCodeInvalid', used: 'insiderCodeUsed', expired: 'insiderCodeExpired', revoked: 'insiderCodeRevoked', rate_limited: 'insiderCodeRateLimited', offline: 'insiderCodeOffline', clock: 'insiderCodeOffline' });
/** Automatic enrollment keeps asking at later launches for this long after its first try. */
const ENROLL_WINDOW = 14 * 24 * 3600 * 1000;
/** An offer of the activation sheet lives this long without a tap (the window may have been left open). */
const OFFER_LIFETIME = 30 * 60 * 1000;

function createInsiderService({
  directory, keyring, config = insiderConfig(), send, ordinary = () => true, eligible = () => true, sessionFor = () => null, routed = () => true, profiles = () => [], tell = () => {},
  note = () => {}, onChannelChange = () => {}, onActivated = () => {}, onInvites = () => {}, ensureProfile = null, describeProfile = () => null, now = Date.now, fileSystem = fs, onWarning = () => {},
  wait, random, allowEnroll = false, enrollDelay = 60 * 1000,
}) {
  const store = createInsiderStore({ dir: directory, fileSystem, warn: onWarning });
  const keys = loadKeys(config.keys);
  const certText = (profileId) => { try { return store.read(profileId).cert; } catch { return null; } };
  const client = createInsiderClient({ endpoint: config.endpoint, keys: keyring, certOf: certText, send, ...(wait ? { wait } : {}), ...(random ? { random } : {}) });
  const generation = new Map(); // raised when a profile's data is deleted: an answer on its way is ignored
  const claimed = new Map();    // profile id -> window id that holds this run's welcome
  const revealClaimed = new Map(); // profile id -> window id that holds this run's reveal
  const asked = new Map();      // window id -> the screen the Insider pop-up was asked to open on (the pop-up is drawn in a page of its own: it takes it once, when it mounts)
  const offers = new Map();     // window id -> {token, profileId, at, state:'ask'|'working'|'done', result, retry, waitSeconds} : the activation sheet's question (the token never leaves main)
  const working = new Map();    // profile id -> the claim in flight (a second tap waits for the same answer)
  const enrollTried = new Set(); // profile ids that asked to be enrolled in this run (at most once per launch)
  const enrollQueue = new Map(); // profiles that asked in the launch's first minute, in the order they asked (insertion order)
  let enrollTimer = null;        // the one timer that asks for them when the launch's 60 s are up
  const launchedAt = now();
  let linkSeen = false;          // an activation link (or its pasted token) reached this run: no automatic enrollment until the next launch
  let enrollOwner = null;        // ONE automatic enrollment per app (reported 17 Nov: "if someone has multiple profiles, only his main gets the Founding contributor"): the profile that was first to ask in this run
  /** True when another ordinary profile of this app already holds a certificate (any, valid or not: read-only, nothing is verified or removed here) or was first to ask in this run (its answer, an offline retry or a refusal, is its alone). */
  const anotherEnrolls = (profileId) => {
    if (enrollOwner !== null && enrollOwner !== profileId) return true;
    try { return profiles().some((profile) => profile && profile.id !== profileId && ordinary(profile.id) && Boolean(certText(profile.id))); } catch { return false; }
  };
  const generationOf = (profileId) => generation.get(profileId) || 0;

  const available = () => Boolean(config.endpoint) && keys.length > 0;

  /** The check of the profile's stored certificate: {ok, cert} or {ok:false, reason}. A certificate that fails the signature or the key check is REMOVED here (rule 2). */
  function verified(profileId) {
    const text = certText(profileId);
    if (!text) return { ok: false, reason: 'none' };
    const identity = keyring.peek(profileId);
    const read = readCertificate(text, { keys, subject: identity.state === 'ready' ? identity.publicKey : null });
    if (!read.ok && read.remove) {
      onWarning(`Insider: a stored certificate was not valid for this profile (${read.reason}) and was removed.`);
      drop(profileId);
    }
    return read;
  }
  /** Whether this profile is an Insider right now. */
  const isInsider = (profileId) => available() && ordinary(profileId) && verified(profileId).ok;
  /** ONE PERSON = ONE NUMBER (reported 17 Nov: "the founding contributor is going to be for all of his profiles"): display only, local. An ordinary profile WITHOUT a certificate of its own shows the Founding card and seal of
   * the install's numbered profile: the first other ordinary profile (in the list's order) whose certificate verifies. Nothing is copied into this profile's store and nothing is asked of the server; the number stays tied to
   * the profile that got it, which alone has the actions (invites, Move my Insider, the reveal, the welcome). A profile with its own certificate shows its own. When the lender's certificate goes, this stops at once. */
  function lenderOf(profileId) {
    if (!available() || typeof profileId !== 'string' || !ordinary(profileId) || certText(profileId)) return null;
    try { for (const profile of profiles()) if (profile && profile.id !== profileId && ordinary(profile.id) && verified(profile.id).ok) return profile.id; } catch { /* no list, no lender */ }
    return null;
  }
  const showsCertified = (profileId) => isInsider(profileId) || lenderOf(profileId) !== null;
  /** Beta 14.5 (reported 25 Nov): the profile whose key makes and lists the invites for this one: its own, else the lending profile's on the same computer (the one that holds the number this profile shows). Never a second number,
   * never a move: the codes are the lender's and so are its invites left. null when neither holds a certificate. */
  const inviterOf = (profileId) => (isInsider(profileId) ? profileId : lenderOf(profileId));
  /** Own member, else the lender's (for the card, the seal and the number only). */
  function shownMember(profileId) { const own = member(profileId); if (own) return own; const from = lenderOf(profileId); return from ? member(from) : null; }
  /** THE READ API (the welcome of section AL, the new tab block, the card): {tier, number, since, by, perks} from a valid certificate, else null. */
  function member(profileId) {
    if (!available() || typeof profileId !== 'string' || !ordinary(profileId)) return null;
    const check = verified(profileId);
    return check.ok ? { tier: check.cert.tier, number: check.cert.number, since: check.cert.since, by: check.cert.by, perks: [...check.cert.perks] } : null;
  }

  // The server's own invites switch as the list answer last said it, per profile, for THIS run only (nothing is stored: a new run asks again when the invites screen opens). null = not asked yet; a missing field in the answer is false.
  const serverInvites = new Map();
  const invitesNow = (profileId) => (serverInvites.has(profileId) ? serverInvites.get(profileId) : null);
  const welcomeOf = (profileId) => { const local = store.read(profileId); return { owed: local.welcome.state === 'owed', step: local.welcome.state === 'owed' ? local.welcome.step || 'welcome' : null }; };
  const NONE = (welcome) => ({ available: false, insider: false, member: null, borrowed: false, canInvite: false, invitesLeft: null, invitesOpen: false, invitesAsked: false, channel: { offered: false, on: false }, reveal: false, welcome, activation: null, closed: null });

  /** What the interface is shown. Nothing about the programme while it is not available; the welcome is shown without it. (`activation` and `closed` stay null: the 16:40 build is gone.) */
  function view(ctx) {
    if (!eligible(ctx)) return NONE({ owed: false, step: null });
    const welcome = welcomeOf(ctx.profileId);
    if (!available()) return NONE(welcome);
    const local = store.read(ctx.profileId), mine = member(ctx.profileId), lent = mine ? null : shownMember(ctx.profileId);
    const inviter = mine || lent ? inviterOf(ctx.profileId) : null;   // the invites of a borrowed profile are its lender's (same computer, same number)
    return {
      available: true, insider: Boolean(mine), member: mine || lent, borrowed: Boolean(lent), canInvite: Boolean(inviter), invitesLeft: inviter ? store.read(inviter).invitesLeft : null, invitesOpen: Boolean(inviter) && Boolean(config.invitesOpen) && invitesNow(inviter) === true, invitesAsked: invitesNow(inviter ?? ctx.profileId) !== null,
      channel: { offered: Boolean(mine && config.feed), on: Boolean(mine && config.feed && local.channel !== false) }, // on unless the person turned it off
      reveal: Boolean(mine && local.revealedFor !== mine.number), welcome, activation: null, closed: null,
    };
  }

  /** Rule 7: the server said this profile is not an Insider (any more). The certificate, the invite count and the channel choice go, at once. */
  function drop(profileId) {
    const hadChannel = store.read(profileId).channel !== false && Boolean(config.feed);
    store.update(profileId, (current) => { current.cert = null; current.invitesLeft = null; current.channel = null; return current; });
    tell(profileId);
    if (hadChannel) { try { onChannelChange(); } catch { /* the next look finds the feed it should */ } }
  }

  /** A certificate the server just gave: kept only when it verifies with a shipped key AND names this profile's key. Returns the member or null. */
  function keepCert(profileId, cert, extra = {}) {
    const identity = keyring.peek(profileId);
    const read = readCertificate(cert, { keys, subject: identity.state === 'ready' ? identity.publicKey : null });
    if (!read.ok) { onWarning(`Insider: a certificate from the server was not accepted (${read.reason}).`); return null; }
    store.update(profileId, (current) => {
      current.cert = cert;
      if (extra.invitesLeft !== undefined) current.invitesLeft = extra.invitesLeft;
      if (extra.revealed) current.revealedFor = read.cert.number; // the screen that asked shows the seal and card itself
      return current;
    });
    tell(profileId);
    if (config.feed && store.read(profileId).channel !== false) { try { onChannelChange(); } catch { /* the next look asks the Insider feed anyway */ } } // the channel is on by default: the updater asks the Insider feed from now on
    return member(profileId);
  }

  const guard = (ctx) => available() && eligible(ctx) && ordinary(ctx.profileId);
  /** The profile's key, made if missing (the Early Member mark with it, as every profile's is). */
  const ready = (profileId) => { const found = ensureProfile ? ensureProfile(profileId) : keyring.ensure(profileId); return Boolean(found) && (!found.state || found.state === 'ready') && (found.key === undefined || found.key === 'ready') && keyring.peek(profileId).state === 'ready'; };
  const failure = (answer) => (answer.failure === 'clock' ? { result: 'clock' } : { result: 'offline', ...(answer.retry ? { retry: true } : {}) });
  const refusal = (answer) => (answer.result === 'rate_limited' ? { result: 'rate_limited', waitSeconds: answer.retryAfter ?? null } : { result: answer.result });

  /** One claim (activate, redeem or move) for this profile: the answer as the interface reads it, the certificate kept when it is ok. A second call while one is out waits for it. */
  function claim(profileId, kind, value, session) {
    if (kind === 'activate') linkSeen = true; // a personal or reserved link's token (opened or pasted): no automatic enrollment in this run
    const key = `${profileId}\u0000${kind}\u0000${value}`;
    if (working.has(key)) return working.get(key);
    const run = (async () => {
      if (!ready(profileId)) return { result: 'unavailable' };
      if (!routed(session)) return { result: 'offline', retry: true };
      const mine = generationOf(profileId);
      const answer = await client[kind](profileId, value, session);
      if (generationOf(profileId) !== mine) return { result: 'offline' };
      if (!answer.ok) return failure(answer);
      if (answer.result !== 'ok') return refusal(answer);
      const kept = keepCert(profileId, answer.cert, { invitesLeft: answer.invitesLeft, revealed: true });
      if (!kept) return { result: 'offline' };
      return { result: 'ok', member: kept };
    })();
    working.set(key, run);
    run.finally(() => working.delete(key)).catch(() => {});
    return run;
  }

  /**
   * Automatic enrollment for the profile of this context (see the rules at the top). Returns a promise of what happened ('skipped' when nothing was asked), never throws, and
   * shows nothing: the interface learns about a new certificate through the ordinary view update.
   */
  async function autoEnroll(ctx, { soon = false } = {}) {
    try {
      if (!allowEnroll || !config.autoEnroll || linkSeen || !guard(ctx) || enrollTried.has(ctx.profileId)) return 'skipped';
      const local = store.read(ctx.profileId);
      if (local.enroll.stopped || local.cert || verified(ctx.profileId).ok || (local.enroll.firstTry && now() - local.enroll.firstTry > ENROLL_WINDOW)) { enrollTried.add(ctx.profileId); return 'skipped'; }
      if (anotherEnrolls(ctx.profileId)) return 'skipped'; // not marked tried and nothing written: a later launch (or the same one, if that certificate goes) checks again
      const left = launchedAt + enrollDelay - now();
      if (!soon && left > 0) {
        // Not in the launch's first minute (an owner opening a reserved link must not get the next number first): ask when it is up, unless the welcome needs it sooner.
        // ONE timer for the launch minute and a queue in the order the profiles asked: when it fires they are called in that order, so the first to ask claims the run (enrollOwner is set before its first await) and the rest are
        // skipped, whatever the timers' resolution (per-profile timers aimed at the same moment fired out of order on Windows and gave the number to the second profile).
        if (!enrollQueue.has(ctx.profileId)) enrollQueue.set(ctx.profileId, { profileId: ctx.profileId, private: false, tor: false, session: ctx.session });
        if (!enrollTimer) {
          enrollTimer = setTimeout(() => { enrollTimer = null; const queued = [...enrollQueue.values()]; enrollQueue.clear(); for (const target of queued) void autoEnroll(target, { soon: true }); }, left);
          enrollTimer.unref?.();
        }
        return 'waiting';
      }
      const session = sessionFor(ctx);
      if (!routed(session)) return 'skipped'; // not this request: the next one of the run may find the profile's network ready
      if (!ready(ctx.profileId)) return 'skipped';
      if (anotherEnrolls(ctx.profileId)) return 'skipped'; // the same check again where it counts: nothing awaits between it and the claim below, so two profiles can never both ask
      enrollOwner = ctx.profileId;
      enrollTried.add(ctx.profileId);
      if (!local.enroll.firstTry) store.update(ctx.profileId, (current) => { current.enroll.firstTry = now(); return current; });
      if (linkSeen) return 'skipped';
      const mine = generationOf(ctx.profileId);
      const answer = await client.enroll(ctx.profileId, session);
      if (generationOf(ctx.profileId) !== mine) return 'offline';
      // closed (the team open enrollment at release time: the final checks run the real build against a closed server), a wait or a lost answer: a later launch asks again
      if (!answer.ok || answer.result === 'rate_limited' || answer.result === 'closed') return answer.ok ? answer.result : 'offline';
      if (answer.result !== 'ok') { store.update(ctx.profileId, (current) => { current.enroll.stopped = true; return current; }); return answer.result; } // full, revoked: never again
      const kept = keepCert(ctx.profileId, answer.cert, { invitesLeft: answer.invitesLeft, revealed: true });
      if (!kept) return 'offline';
      store.update(ctx.profileId, (current) => { current.enroll.stopped = true; return current; });
      try { onActivated(ctx.profileId); } catch { /* the aura just stays quiet */ }
      note('insiderActivated'); // counted as an activation (the name only, as every usage count)
      return 'ok';
    } catch { return 'offline'; }
  }

  /** The activation sheet's question for this window, as the interface may see it (never the token). */
  function offerOf(windowId) {
    const offer = offers.get(String(windowId ?? 0));
    if (!offer) return null;
    if (offer.state === 'ask' && now() - offer.at > OFFER_LIFETIME) { offers.delete(String(windowId ?? 0)); return null; }
    return { state: offer.state, result: offer.result, retry: offer.retry, waitSeconds: offer.waitSeconds, profile: describeProfile(offer.profileId), profileId: offer.profileId, member: offer.result === 'ok' ? member(offer.profileId) : null };
  }

  const handlers = {
    /** "Enter Insider code": an invite code, a move code or a pasted activation link/token. {result, ...}: ok | invalid | used | expired | revoked | rate_limited (+ waitSeconds) | offline (+ retry) | clock | unavailable. */
    async redeem(ctx, request) {
      if (!guard(ctx)) return { result: 'unavailable' };
      const entry = parseEntry(request.code);
      if (!entry.ok) return { result: 'invalid', local: true }; // told on the spot, never sent
      const kind = entry.kind === 'invite' ? 'redeem' : entry.kind === 'move' ? 'move' : 'activate';
      const answer = await claim(ctx.profileId, kind, entry.kind === 'activation' ? entry.token : entry.code, sessionFor(ctx));
      if (answer.result !== 'unavailable') note(CODE_NOTES[answer.result] || 'insiderCodeOffline');
      if (answer.result === 'ok') { try { onActivated(ctx.profileId); } catch { /* the aura just plays */ } return { result: 'ok', view: view(ctx) }; }
      return answer;
    },
    /** The activation sheet asks what it is showing: {offer, view}. */
    offer: (ctx) => ({ offer: offerOf(ctx.windowId), view: view(ctx) }),
    /** Activate (rule 4): the ONLY way a link becomes a request. {result, ...} as redeem, and the sheet's offer moves on. */
    async activate(ctx) {
      const id = String(ctx.windowId ?? 0), offer = offers.get(id);
      if (!offer) return { result: 'unavailable', offer: null };
      if (offer.state === 'working') return { result: 'busy', offer: offerOf(ctx.windowId) }; // a second tap while the first is out: one request
      if (!offer.token) return { result: offer.result || 'unavailable', offer: offerOf(ctx.windowId) }; // a one-use link that already has its answer
      const target = { ...ctx, profileId: offer.profileId };
      if (!guard(target)) { offers.delete(id); return { result: 'unavailable', offer: null }; }
      offer.state = 'working'; offer.result = null; offer.retry = false; offer.waitSeconds = null;
      tell(offer.profileId);
      const answer = await claim(offer.profileId, offer.kind === 'invite' ? 'redeem' : 'activate', offer.token, sessionFor(target));
      if (offers.get(id) !== offer) return { result: answer.result, offer: offerOf(ctx.windowId) };
      offer.state = 'done'; offer.result = answer.result; offer.retry = answer.retry === true; offer.waitSeconds = answer.waitSeconds ?? null;
      // A one-use token that has given its answer is not kept: only "Try again" (offline, clock, a wait) needs it again.
      if (!['offline', 'clock', 'rate_limited'].includes(answer.result)) offer.token = null;
      if (answer.result === 'ok') { note('insiderActivated'); try { onActivated(offer.profileId); } catch { /* the aura just plays */ } }
      tell(offer.profileId);
      return { result: answer.result, ...(answer.retry ? { retry: true } : {}), ...(answer.waitSeconds !== undefined ? { waitSeconds: answer.waitSeconds } : {}), offer: offerOf(ctx.windowId), view: view(target) };
    },
    /** Not now: the question is dropped and nothing was sent. Closing the sheet after an answer only forgets it. */
    decline(ctx) {
      const id = String(ctx.windowId ?? 0), offer = offers.get(id);
      if (offer && offer.state === 'ask') note('insiderDeclined');
      if (offer && offer.state !== 'working') offers.delete(id);
      return { ok: true };
    },
    /** A fresh code for a friend, if invites remain. The code is in this answer and nowhere else. */
    async invite(ctx) {
      const who = guard(ctx) ? inviterOf(ctx.profileId) : null;   // this profile's own key, else its lender's
      if (!who) return { result: 'unavailable' };
      if (!config.invitesOpen) return { result: 'closed' }; // invites are not open yet (B1): nothing is asked of the server
      if (invitesNow(who) !== true) return { result: 'closed', view: view(ctx) }; // the server has not said "open" (the list answer's invitesOpen): no code is asked for
      const session = sessionFor(ctx);
      if (!routed(session)) return { result: 'offline' };
      const answer = await client.invite(who, session);
      if (!answer.ok) return failure(answer);
      if (answer.result === 'revoked') { drop(who); if (who !== ctx.profileId) tell(ctx.profileId); return { result: 'revoked', view: view(ctx) }; }
      // The server's invites are shut (none_left with `closed`): the member's codes are all still theirs, so the count kept here is NOT overwritten with the 0 that answer carries; the screen says invites are not open.
      if (answer.result === 'none_left' && answer.closed) { serverInvites.set(who, false); tell(who); tell(ctx.profileId); return { result: 'closed', view: view(ctx) }; }
      if (answer.invitesLeft !== undefined) store.update(who, (current) => { current.invitesLeft = answer.invitesLeft; return current; });
      if (answer.result === 'ok') { note('insiderInviteCreated'); try { onInvites(who); } catch { /* the points copy is a courtesy */ } tell(who); tell(ctx.profileId); return { result: 'ok', code: answer.code, invitesLeft: answer.invitesLeft ?? null, view: view(ctx) }; }
      return { ...refusal(answer), view: view(ctx) };
    },
    /** The codes this Insider made, by state, never in full. */
    async invites(ctx) {
      const who = guard(ctx) ? inviterOf(ctx.profileId) : null;
      if (!who) return { result: 'unavailable' };
      if (!config.invitesOpen) return { result: 'closed' };
      const session = sessionFor(ctx);
      if (!routed(session)) return { result: 'offline' };
      const answer = await client.invites(who, session);
      if (!answer.ok) return failure(answer);
      if (answer.result === 'revoked') { drop(who); if (who !== ctx.profileId) tell(ctx.profileId); return { result: 'revoked', view: view(ctx) }; }
      if (answer.result !== 'ok') return { result: answer.result, view: view(ctx) };
      // What the server says about its invites switch is kept for this run, per profile: only the list's own `invitesOpen: true` opens them (client readAnswer), so nothing is shown or asked for from a server that has not said so.
      const wasOpen = invitesNow(who);
      serverInvites.set(who, answer.invitesOpen === true);
      if (answer.invitesOpen === true) { try { onInvites(who); } catch { /* the points copy is a courtesy */ } }
      if (answer.invitesLeft !== undefined && answer.invitesLeft !== store.read(who).invitesLeft) { store.update(who, (current) => { current.invitesLeft = answer.invitesLeft; return current; }); tell(who); tell(ctx.profileId); }
      else if (wasOpen !== (answer.invitesOpen === true)) { tell(who); tell(ctx.profileId); }
      return { result: 'ok', invitesOpen: answer.invitesOpen === true, ...(answer.invitesTotal !== undefined ? { invitesTotal: answer.invitesTotal } : {}), invites: answer.invites.map((item) => ({ id: item.id, state: item.state, code: maskedCode(item.hint), createdAt: item.createdAt, usedAt: item.usedAt })), view: view(ctx) };
    },
    /** "Move my Insider" (rule 9): a one-time move code, shown once. */
    async moveCode(ctx) {
      if (!guard(ctx) || !verified(ctx.profileId).ok) return { result: 'unavailable' };
      const session = sessionFor(ctx);
      if (!routed(session)) return { result: 'offline' };
      const answer = await client.moveCode(ctx.profileId, session);
      if (!answer.ok) return failure(answer);
      if (answer.result === 'revoked') { drop(ctx.profileId); return { result: 'revoked', view: view(ctx) }; }
      if (answer.result === 'ok') { note('insiderMoveCodeMade'); return { result: 'ok', code: answer.code }; }
      return { ...refusal(answer), view: view(ctx) };
    },
    /** The viewer or a screen opened: only the view comes back. Nothing is sent (rule 2: no renewal, no launch call, no check). */
    opened: (ctx) => ({ view: view(ctx) }),
    state: (ctx) => ({ view: view(ctx) }),
    /** The Insider update channel: only with a valid certificate and an Insider feed; ON by default for an Insider (16 Nov), until the person turns it off. */
    channel(ctx, request) {
      if (!guard(ctx) || !config.feed || !verified(ctx.profileId).ok) return { ok: false, view: view(ctx) };
      const on = request.on === true;
      const before = store.read(ctx.profileId).channel;
      if (before !== on) store.update(ctx.profileId, (current) => { current.channel = on; return current; });
      if ((before !== false) !== on) { note(on ? 'insiderChannelOn' : 'insiderChannelOff'); try { onChannelChange(); } catch { /* the next look finds the feed it should */ } } // only a real change (it is on by default)
      tell(ctx.profileId);
      return { ok: true, view: view(ctx) };
    },
    /** The seal (and card) was shown for this membership: it is not shown again. */
    revealSeen(ctx) {
      const check = guard(ctx) ? verified(ctx.profileId) : { ok: false };
      if (check.ok) { store.update(ctx.profileId, (current) => { current.revealedFor = check.cert.number; return current; }); revealClaimed.delete(ctx.profileId); tell(ctx.profileId); }
      return { view: view(ctx) };
    },
    /** Whoever opens the Insider pop-up says first which screen it is for; the pop-up takes it once, when it mounts. Nothing is kept for a context that may not have a programme. */
    flowSet(ctx, request) {
      if (!eligible(ctx) || !FLOWS.includes(request.flow) || request.flow === 'activate') return { ok: false }; // the sheet is opened by main for a link, never by the interface
      asked.set(String(ctx.windowId ?? 0), request.flow);
      return { ok: true };
    },
    flowTake(ctx) {
      const key = String(ctx.windowId ?? 0), flow = asked.get(key) || 'code';
      asked.delete(key);
      return { flow };
    },
    /** This window takes the welcome for this run (only one window ever shows it). {claimed, view}. */
    welcomeClaim(ctx) {
      if (!eligible(ctx) || !ordinary(ctx.profileId) || !welcomeOf(ctx.profileId).owed) return { claimed: false, view: view(ctx) };
      void autoEnroll(ctx, { soon: true }); // the welcome is about to show the rank's seal and card: it needs the status now, not after the launch's first minute
      const holder = claimed.get(ctx.profileId);
      if (holder !== undefined && holder !== ctx.windowId) return { claimed: false, view: view(ctx) };
      claimed.set(ctx.profileId, ctx.windowId);
      return { claimed: true, view: view(ctx) };
    },
    /** This window takes the reveal for this run: an Insider (by a code entered elsewhere, or a profile copy) who has not seen the seal and card yet. Only when no welcome is owed. {claimed, view}. */
    revealClaim(ctx) {
      const check = guard(ctx) ? verified(ctx.profileId) : { ok: false };
      if (!check.ok || welcomeOf(ctx.profileId).owed || store.read(ctx.profileId).revealedFor === check.cert.number) return { claimed: false, view: view(ctx) };
      const holder = revealClaimed.get(ctx.profileId);
      if (holder !== undefined && holder !== ctx.windowId) return { claimed: false, view: view(ctx) };
      revealClaimed.set(ctx.profileId, ctx.windowId);
      return { claimed: true, view: view(ctx) };
    },
    /** D126: the window that holds this run's reveal gives the claim back (its popup was replaced before the seal was shown), so the reveal can be claimed again. Only the holder can; the seal still counts as unseen. */
    revealRelease(ctx) {
      if (revealClaimed.get(ctx.profileId) === ctx.windowId) revealClaimed.delete(ctx.profileId);
      return { view: view(ctx) };
    },
    /** The welcome reached a step (kept, so a quit in the middle goes on from there). */
    welcomeStep(ctx, request) {
      if (!eligible(ctx) || !WELCOME_STEPS.includes(request.step) || !welcomeOf(ctx.profileId).owed) return { view: view(ctx) };
      void autoEnroll(ctx, { soon: true });
      store.update(ctx.profileId, (current) => { current.welcome = { state: 'owed', step: request.step }; return current; });
      return { view: view(ctx) };
    },
    /** The welcome is over because the PERSON ended it (finished it, or closed it themselves): it is never shown again to this profile. Nothing else may call this: the interface sends it from the welcome's own exit, never when it opens (Beta 14.0 / 14.1 did, so a welcome that vanished a second later counted as seen, D146). */
    welcomeDone(ctx) {
      if (!eligible(ctx) || !welcomeOf(ctx.profileId).owed) return { view: view(ctx) };
      store.update(ctx.profileId, (current) => { current.welcome = { state: 'done', step: null, by: 'person' }; return current; });
      claimed.delete(ctx.profileId);
      tell(ctx.profileId);
      return { view: view(ctx) };
    },
  };

  /** A fresh install's welcome (see markWelcomeOwed): every ordinary profile that has not had one and holds no certificate. Returns how many now owe it. */
  function owedFresh() {
    let marked = 0;
    for (const profile of profiles()) {
      if (!profile || profile.private || !ordinary(profile.id)) continue;
      const local = store.read(profile.id);
      if (local.welcome.state !== null || local.cert) continue;
      store.update(profile.id, (current) => { current.welcome = { state: 'owed', step: 'welcome' }; return current; });
      marked += 1;
    }
    return marked;
  }

  /** D146, the first run on Beta 14.2 or later after Beta 14.0 / 14.1: a member who holds a certificate, whose welcome 14.1 recorded as seen the moment it opened (a record with no `by`), and who never reached the seal
   *  (`revealedFor` is still empty: the seal and card are marked seen when the welcome's Gift step shows) lost it to the bug and owes it once more. A record that says `by` was ended by a person; a profile with no certificate, or
   *  one that saw its seal, cannot be told from a person who finished it, so it is left alone (never shown again to someone who finished it). Returns how many profiles now owe it. */
  function owedAgain(from, to) {
    const was = betaPair(from), now = betaPair(to);
    if (!was || !now || !pairBefore(was, WELCOME_FIXED_IN) || pairBefore(now, WELCOME_FIXED_IN)) return 0;
    let marked = 0;
    for (const profile of profiles()) {
      if (!profile || profile.private || !ordinary(profile.id)) continue;
      const local = store.read(profile.id);
      if (local.welcome.state !== 'done' || local.welcome.by || !local.cert || local.revealedFor !== null) continue;
      if (!verified(profile.id).ok) continue;
      store.update(profile.id, (current) => { current.welcome = { state: 'owed', step: 'welcome' }; return current; });
      claimed.delete(profile.id);
      marked += 1;
    }
    return marked;
  }

  const api = {
    available, view, verified, isInsider, member, shownMember, showsCertified, handlers,
    /**
     * Rule 4: a personal link was opened (from the system, a page or a second start). Main has picked the window (the ordinary window in front) and its profile; the sheet's question
     * is kept for that window and the pop-up is told to open on it. Nothing is sent. Returns false when the programme is hidden or the context may not have one (a private or Tor
     * window, a private profile): then the link does nothing.
     */
    offer({ windowId, profileId, private: isPrivate = false, tor = false }, token, kind = 'activate') {
      const ctx = { windowId, profileId, private: isPrivate, tor };
      if (typeof token === 'string' && token.length) linkSeen = true; // an activation link reached this run: automatic enrollment waits for the next launch
      if (!guard(ctx) || typeof token !== 'string' || !token.length) return false;
      // Beta 14.5: an INVITE link (kind 'invite', the token is the code) on a profile that already shows a number (its own pass, or one it borrows on this computer) opens nothing: the code would not be spent, and a sheet
      // that says "Activate" for a member is wrong. Main tells the person calmly ('member').
      if (kind === 'invite' && showsCertified(profileId)) return 'member';
      const id = String(windowId ?? 0), current = offers.get(id);
      if (current?.state === 'working') return true; // an answer is on its way: the sheet stays as it is
      offers.set(id, { token, kind: kind === 'invite' ? 'invite' : 'activate', profileId, at: now(), state: 'ask', result: null, retry: false, waitSeconds: null });
      asked.set(id, 'activate');
      tell(profileId);
      return true;
    },
    /** The Insider feed (rule 8): the address and a signer of each request, for the profile that turned the Insider channel on while holding a valid certificate; null otherwise. */
    feedAuth() {
      if (!available() || !config.feed) return null;
      for (const profile of profiles()) {
        if (profile.private || !ordinary(profile.id)) continue;
        const local = store.read(profile.id);
        if (local.channel === false || !verified(profile.id).ok) continue;
        const profileId = profile.id;
        return { url: config.feed, profileId, headers: (url, method = 'GET') => { try { return keyring.sign(profileId, { method, url, body: '', cert: certText(profileId) }) || undefined; } catch { return undefined; } } };
      }
      return null;
    },
    /** Whether this install is following the Insider feed right now, as feedAuth() would say, for a reader that must not act on a moment it cannot read (the app icon's `audience`, browser-services/app-icon.cjs):
     *  true | false | null. null: the profile list is not there yet or the read failed. Makes no key and writes nothing of its own; it shares the update check's read of the certificate, which removes one that fails its check (rule 2), exactly as the update check does. */
    following() {
      try {
        if (!available()) return false;
        if (!profiles().length) return null;
        return this.feedAuth() !== null;
      } catch { return null; }
    },
    /** The Insider feed answered `revoked` for this profile (rule 7, rule 8): the certificate goes and the next look asks the ordinary feed. */
    feedRevoked(profileId) { if (typeof profileId === 'string' && certText(profileId)) drop(profileId); },
    /** The certificate text this profile holds (for the profile copy, feedback-service.cjs identity.export), or null. */
    certificateOf: (profileId) => certText(profileId),
    /**
     * A certificate brought by a profile copy, for the key that came with it (`publicKey`). Kept when its `sub` is that key and, while the programme ships keys, when its signature
     * verifies with a shipped kid. Returns {kept, member}.
     */
    adoptCertificate(profileId, cert, publicKey) {
      if (typeof cert !== 'string' || !cert.length) return { kept: false, member: null };
      const read = readCertificate(cert, { keys: keys.length ? keys : null, subject: publicKey });
      const shapeOnly = !keys.length && read.reason === 'nokeys' && certSubject(cert) === publicKey;
      if (!read.ok && !shapeOnly) return { kept: false, member: null };
      store.update(profileId, (current) => { current.cert = cert; current.revealedFor = read.ok ? read.cert.number : current.revealedFor; return current; });
      tell(profileId);
      return { kept: true, member: member(profileId) };
    },
    /** Recognition state the profile copy carries: whether the welcome was seen, and taking it over. */
    welcomeSeen: (profileId) => store.read(profileId).welcome.state === 'done',
    markWelcomeSeen(profileId) { store.update(profileId, (current) => { current.welcome = { state: 'done', step: null, by: 'carried' }; return current; }); claimed.delete(profileId); tell(profileId); },
    /** `from` and `to` are Acira versions: a profile that exists now owes the welcome when this run is the first 14.x after 13.x or older (also straight to a later 14.x). */
    markWelcomeOwed({ from, to, fresh = false }) {
      const before = betaOf(from), after = betaOf(to);
      // Public 14.4: a FRESH install (main says so: the updater could answer and has no earlier run on record) owes the same one-time welcome to the profiles it has now, once, and never again: the person is shown the Early Member seal (no card: Early Member has none).
      // A profile that holds a certificate is left out (it has its own seal-and-card reveal and never the Early Member one); a private or Tor profile never has one. An update (a known earlier run) is as before.
      if (fresh === true && from == null && after === 14) return owedFresh();
      if (before === null || after === null) return 0;
      if (before === 14 && after === 14) return owedAgain(from, to);
      if (before >= 14 || after !== 14) return 0;
      let marked = 0;
      for (const profile of profiles()) {
        if (profile.private || !ordinary(profile.id)) continue;
        if (store.read(profile.id).welcome.state !== null) continue;
        store.update(profile.id, (current) => { current.welcome = { state: 'owed', step: 'welcome' }; return current; });
        marked += 1;
      }
      return marked;
    },
    /** A profile was deleted, or its key was replaced (an unreadable one, by "Delete my contributor data"): the certificate (tied to that key) goes with it. A readable key's "Delete my contributor data" no longer calls this (B5: the Insider number stays). */
    forget(profileId) { generation.set(profileId, generationOf(profileId) + 1); serverInvites.delete(profileId); claimed.delete(profileId); revealClaimed.delete(profileId); for (const [id, offer] of offers) if (offer.profileId === profileId) offers.delete(id); try { store.remove(profileId); } catch (error) { onWarning(`Insider: ${error.message}`); } },
    /** The profile's key was replaced (a profile copy brought its ID): an answer on its way for the old key is ignored, and a certificate of the old key goes (it names that key). */
    keyChanged(profileId) {
      generation.set(profileId, generationOf(profileId) + 1);
      for (const [id, offer] of offers) if (offer.profileId === profileId) offers.delete(id);
      if (certText(profileId) || store.read(profileId).channel === true) drop(profileId);
    },
    /** Files whose profile no longer exists go at start; a stored certificate that is not valid for its profile goes too (rule 2). Nothing is sent. */
    tidy(liveIds) { for (const id of store.list()) { if (!liveIds.has(id)) { try { store.remove(id); } catch { /* next start */ } } else if (available()) { try { verified(id); } catch { /* next start */ } } } },
    /** Nothing runs on a timer (rule 2: no launch call, no periodic check). Kept so the feedback service's start and stop stay one call. */
    start() {},
    stop() { offers.clear(); if (enrollTimer) clearTimeout(enrollTimer); enrollTimer = null; enrollQueue.clear(); },
    /** Automatic enrollment for this context's profile (once per launch; see the top of the file). */
    autoEnroll,
    /** A test profile only: owe this profile the welcome (or not) as if it came from 13.x. */
    qaWelcome(profileId, owed) {
      if (!process.env.ACIRA_BROWSER_TEST_DATA) return false;
      store.update(profileId, (current) => { current.welcome = owed ? { state: 'owed', step: 'welcome' } : { state: null, step: null }; return current; });
      tell(profileId);
      return true;
    },
    peek: (profileId) => store.read(profileId),
  };
  return api;
}

/** The `sub` of a certificate's payload (no check), or null. */
function certSubject(cert) { try { return JSON.parse(Buffer.from(String(cert).split('.')[1], 'base64url').toString('utf8')).sub ?? null; } catch { return null; } }

module.exports = { createInsiderService, betaOf, FLOWS, OFFER_LIFETIME };
