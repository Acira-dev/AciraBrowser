'use strict';
// The transfer service main hands to the renderer (spec 12.1/12.2): it ties the payload, the file, the apply and the transport together.
//
//   summary, saveFile, openFile      the profile file road
//   send / approve / deny / receive  the code road, through `deps.transport` (desktop/transfer/session.cjs, or the in-process stand-in): the transport takes the payload as
//                                    UTF-8 JSON bytes and compresses it itself, and hands the receiver the decompressed JSON bytes in `received.payloadBytes`
//   preview, apply, applyLook, applied, cancel, rolledBack   the shared end: one preview, one apply, one Undo
//
// Everything outside this module (dialogs, files, the stores, the clock) comes in through `deps`, so the tests drive it whole.
// `deps.shared` is the bag the app's windows have in common (one outgoing and one incoming session per install, the payload waiting to be applied, the ids rolled
// back at start): every window builds its own service (its own state and importer) over the same bag. Without it the service keeps a private one.

const fs = require('node:fs');
const path = require('node:path');
const inventory = require('./inventory.cjs');
const payloads = require('./payload.cjs');
const profileFile = require('./profile-file.cjs');
const { createTransferApply } = require('./apply.cjs');

const MAX_CODE_BYTES = 24 * 1024 * 1024;
const fail = (code, message) => Object.assign(new Error(message), { code });
const rowsOf = (include) => Object.fromEntries(inventory.ROWS.map((row) => [row, include?.[row] === true]));

const PLATFORMS = ['darwin', 'win32', 'linux'];
const APPLY_STEPS = ['spaces', 'bookmarks', 'history', 'settings', 'sites', 'other'];
const clamp01 = (value) => Math.min(1, Math.max(0, Number(value) || 0));
/** `{done, total, fraction}` whatever the transport sent (the real one sends exactly that; the stand-in sends a fraction). */
function progressOf(value) {
  if (typeof value === 'number') return { done: value, total: 1, fraction: clamp01(value) };
  if (!value || typeof value !== 'object') return undefined;
  const done = Number(value.done) || 0, total = Number(value.total) || 0;
  return { done, total, fraction: clamp01(value.fraction ?? (total ? done / total : 0)) };
}
/** What the other computer said about itself, with every field present. */
function peerOf(value) {
  if (!value || typeof value !== 'object') return null;
  return { label: String(value.label ?? ''), platform: PLATFORMS.includes(value.platform) ? value.platform : 'unknown', appVersion: String(value.appVersion ?? ''), profileName: String(value.profileName ?? '') };
}
/** The manifest the screens show (the sender's own words about what is coming); the protocol's hash and chunk count stay inside the transport. */
function manifestOf(value) {
  if (!value || typeof value !== 'object') return null;
  return { profileName: String(value.profileName ?? ''), platform: PLATFORMS.includes(value.platform) ? value.platform : 'unknown', createdAt: value.createdAt ?? '', counts: value.counts && typeof value.counts === 'object' && !Array.isArray(value.counts) ? { ...value.counts } : {}, bytes: Number(value.bytes) || 0 };
}
const ENDED = ['cancelled', 'expired', 'failed'];
const isEnded = (state) => ENDED.includes(state);
/** Is a transfer under way in this bag of sessions? (Sending until it ends or is done; receiving until the payload is checked and waiting in the preview.) */
function transferActive(shared) {
  const live = (view, over) => Boolean(view) && !over.includes(view.state);
  return live(shared.out?.view, [...ENDED, 'done']) || live(shared.inc?.view, [...ENDED, 'preview']);
}

function createTransfer(deps) {
  const stores = deps.stores || {};
  const fsApi = deps.fs || fs;
  const now = deps.now || Date.now;
  const maxCodeBytes = deps.maxCodeBytes ?? MAX_CODE_BYTES;
  const S = deps.shared || {};
  S.rolledBackIds ??= []; S.out ??= null; S.inc ??= null; S.incoming ??= null; S.heldFile ??= null; S.heldInfo ??= null; S.lastSaved ??= null; S.applying ??= null;
  /** Steps 1-4 of the apply report themselves here: the screens read `applying` from the status (R6's ticks). */
  const step = (name) => {
    if (!S.applying || !APPLY_STEPS.includes(name) || S.applying.done.includes(name)) return;
    S.applying = { done: [...S.applying.done, name], step: APPLY_STEPS.find((item) => item !== name && ![...S.applying.done, name].includes(item)) || null };
    emit();
  };
  const apply = createTransferApply({ ...deps, onStep: step });
  const buildDeps = () => ({ getState: deps.getState, database: deps.database, app: deps.app, stores, now });
  const validationContext = (profileId, locked) => ({ locked, validateSettings: deps.validateSettings, searchProvidersChoice: deps.searchProvidersChoice, current: apply.current(profileId) });
  /** The payload waiting on the receiving side (from a file or the code road) and a locked file main already read are forgotten together. */
  const drop = () => { S.incoming = null; S.heldFile = null; };

  async function build(request) {
    if (request.profileId == null) throw fail('invalid', 'Choose a profile.');
    return payloads.buildPayload(buildDeps(), request);
  }

  /** Counts per row and an estimate of what each would add to the compressed size (spec 4.2: "Too large to send by code" is decided before Create code). */
  async function summary({ profileId, ui }) {
    const state = deps.getState();
    const profile = state.browserProfiles.find((item) => item.id === profileId && !item.private && !item.tor);
    if (!profile) throw fail('private', 'Moving a profile is not available in a private window.');
    const everything = await build({ profileId, include: rowsOf(Object.fromEntries(inventory.ROWS.map((row) => [row, row !== 'passwords']))), historyDays: 0, ui, passwords: false });
    const sizes = {};
    for (const row of inventory.ROWS) {
      if (row === 'passwords') continue;
      const { payload } = await build({ profileId, include: rowsOf({ [row]: true }), historyDays: 0, ui, passwords: false });
      sizes[row] = (await payloads.pack(payload, { quality: 4 })).length;
    }
    const history90 = (await build({ profileId, include: rowsOf({ history: true }), historyDays: 90, ui })).payload.history?.length || 0;
    const history30 = (await build({ profileId, include: rowsOf({ history: true }), historyDays: 30, ui })).payload.history?.length || 0;
    return {
      profileName: profile.name, counts: { ...everything.counts, history90, history30 }, sizes, limit: maxCodeBytes,
      passwordsAvailable: stores.vault?.count ? await stores.vault.count(profileId) : (await (stores.vault?.all?.(profileId) ?? [])).length
    };
  }

  // ------------------------------------------------------------------ the file road

  async function saveFile(request) {
    const include = rowsOf(request.include);
    if (include.passwords && !request.password) throw fail('password-required', 'A file with passwords must be locked with a password.');
    if (request.password && profileFile.passwordProblem(request.password)) throw fail('password-short', 'Use a password of at least ' + profileFile.MIN_PASSWORD + ' characters.');
    if (include.passwords && deps.passwordsGate && !(await deps.passwordsGate())) return { passwordsRefused: true };
    const { payload } = await build({ profileId: request.profileId, include, historyDays: request.historyDays || 0, ui: request.ui, passwords: include.passwords && Boolean(request.password), identity: request.password ? 'locked-file' : false });
    const bytes = await profileFile.seal(payload, { password: request.password || undefined });
    const name = profileFile.defaultFileName(payload.profile.name, new Date(now()));
    const chosen = await deps.dialog.showSaveDialog(deps.getWindow?.(), { title: deps.tm ? deps.tm('transfer.file.save.title') : 'Save profile file', defaultPath: name, filters: [{ name: 'Acira profile', extensions: [profileFile.EXTENSION] }] });
    if (chosen.canceled || !chosen.filePath) return { cancelled: true };
    const target = /\.[A-Za-z0-9]+$/.test(chosen.filePath) ? chosen.filePath : chosen.filePath + '.' + profileFile.EXTENSION;
    fsApi.writeFileSync(target, bytes, { mode: 0o600 });
    S.lastSaved = target;
    return { saved: true, path: target, name: path.basename(target), locked: Boolean(request.password), bytes: bytes.length };
  }

  /** The Open dialog (main picks the file, the renderer never passes a path). Returns `{ preview }`, `{ needsPassword }`, `{ legacy }` for an older export or a bookmarks file, or `{ cancelled }`. */
  async function openFile({ password, profileId }) {
    let bytes = S.heldFile, file = null;
    if (!bytes) {
      const chosen = await deps.dialog.showOpenDialog(deps.getWindow?.(), { title: deps.tm ? deps.tm('transfer.file.open.title') : 'Open profile file', properties: ['openFile'], filters: [{ name: 'Acira profile or bookmarks', extensions: [profileFile.EXTENSION, 'json', 'html', 'htm'] }] });
      if (chosen.canceled || !chosen.filePaths?.[0]) return { cancelled: true };
      file = chosen.filePaths[0];
      if (fsApi.statSync(file).size > profileFile.MAX_FILE) throw fail('too-large', 'This file is too large to be an Acira profile.');
      bytes = fsApi.readFileSync(file);
    }
    let opened;
    try { opened = await profileFile.open(bytes, { password }); }
    catch (error) {
      if (error.code === 'password-needed' || error.code === 'wrong-password') {
        S.heldFile = bytes; if (file) S.heldInfo = { name: path.basename(file), bytes: bytes.length };
        return { needsPassword: true, ...(error.code === 'wrong-password' ? { wrongPassword: true } : {}), ...(S.heldInfo || {}) };
      }
      S.heldFile = null; S.heldInfo = null; throw error;
    }
    S.heldFile = null; S.heldInfo = null;
    if (opened.kind === 'v1' || opened.kind === 'html') {
      const result = await deps.importer.importFile(file, profileId, opened.kind === 'v1' ? 'json' : 'html');
      return { legacy: opened.kind, ...result };
    }
    return accept(opened.raw, { locked: opened.locked, source: 'file', profileId });
  }

  // ------------------------------------------------------------------ the shared end: validate, preview, apply

  /** A payload from either road. `locked`: it came through a code or a password-locked file, so passwords in it are read. */
  function accept(raw, { locked, source, profileId, peer }) {
    const checked = payloads.validatePayload(raw, validationContext(profileId, locked));
    if (checked.status === 'newer') throw fail('newer', 'This came from a newer Acira. Update Acira on this computer first.');
    if (checked.status !== 'ok') throw fail('invalid', 'This isn’t an Acira profile or bookmarks file.');
    S.incoming = { payload: checked.payload, checked, source, profileId, peer: peer || null, at: now() };
    return { preview: previewOf() };
  }
  /** The code road hands over the decrypted, decompressed payload: UTF-8 JSON bytes (the transport packs and unpacks the Brotli itself). */
  function acceptBytes(bytes, { profileId, peer }) {
    let raw;
    try { raw = JSON.parse(Buffer.from(bytes).toString('utf8')); } catch { throw fail('damaged', 'The transfer was damaged on the way, so nothing was changed. Try again.'); }
    return accept(raw, { locked: true, source: 'code', profileId, peer });
  }

  function previewOf(target = 'current') {
    const incoming = S.incoming;
    if (!incoming) throw fail('gone', 'Start again on the other computer.');
    const { payload, checked } = incoming;
    const profileId = incoming.profileId ?? deps.getState().activeBrowserProfileId;
    const detail = apply.preview(payload, { profileId, target });
    return {
      source: incoming.source, from: { name: payload.profile?.name || '', platform: payload.app?.platform || '', version: payload.app?.version || '', createdAt: payload.createdAt },
      included: payload.included, counts: detail.counts, safety: detail.safety, spaces: detail.spaces, fresh: detail.fresh, language: detail.language, changesSpacesMode: detail.changesSpacesMode, notMoved: detail.notMoved,
      defaultTarget: detail.fresh ? 'current' : 'new', notes: checked.notes, dropped: checked.dropped.map((item) => item.section), hasPasswords: Boolean(payload.passwords?.length), hasIdentity: Boolean(payload.identity)
    };
  }

  async function applyIncoming(request) {
    const incoming = S.incoming;
    if (!incoming) throw fail('gone', 'Start again on the other computer.');
    const profileId = incoming.profileId ?? deps.getState().activeBrowserProfileId;
    S.applying = { done: [], step: APPLY_STEPS[0] };
    emit();
    let outcome;
    try {
      outcome = await apply.apply(incoming.payload, { target: request.target === 'new' ? 'new' : 'current', profileId, safety: Array.isArray(request.safety) ? request.safety.filter((id) => typeof id === 'string') : [], include: request.include });
    } finally { S.applying = null; emit(); }
    // The payload leaves memory the moment it is applied; the receipt keeps only what the renderer needs.
    S.incoming = null; incoming.payload = null;
    // The transport was already told at the preview (the sender saw "Sent" then); finishing again is a no-op there and covers a stand-in that waits.
    const finished = S.inc; S.inc = null;
    try { void Promise.resolve(finished?.inc.finish?.()).catch(() => {}); } catch { /* the session is gone */ }
    // A finished transfer is no longer "incoming": the status goes back to nothing, so the next time the sheet opens it starts clean.
    emit();
    return outcome;
  }

  // ------------------------------------------------------------------ the code road (the transport interface: desktop/transfer/session.cjs)

  const emit = (event) => deps.emit?.({ type: 'transfer-changed', ...(event ? { reason: event } : {}) });
  // No transport at all = the app has no relay address (the relay's own project is not set up yet): "not available yet" (a relay that exists but cannot be reached ends a session as 'unavailable' instead)
  const unavailable = () => fail('not-yet', 'Moving with a code isn’t available yet. You can use a profile file instead.');
  /** The transport answers at once (session.cjs) or after a promise (a stand-in); both are fine. The record is attached before anything else can happen. */
  const started = (made, attach) => (made && typeof made.then === 'function' ? made.then(attach) : attach(made));

  /** What a `state` event from the sending transport means for the status: fields carry over from state to state while the session lives; an ending keeps only what the screens need. */
  function mergeOutgoing(rec, event) {
    const before = rec.view, state = event.state;
    const view = { state };
    if (isEnded(state)) {
      view.reason = event.reason ?? null; view.from = event.from; if (event.local !== undefined) view.local = event.local;
      if (before.peer) view.peer = before.peer;
      if (before.progress) view.progress = before.progress;
    } else if (state === 'done') {
      if (before.peer) view.peer = before.peer;
      view.progress = { done: before.progress?.total || 1, total: before.progress?.total || 1, fraction: 1 };
    } else {
      if (before.code) view.code = before.code;
      if (before.expiresAt) view.expiresAt = before.expiresAt;
      if (before.peer) view.peer = before.peer;
      if (before.progress) view.progress = before.progress;
      if (before.approveDeadline && state === 'confirming') view.approveDeadline = before.approveDeadline;
      if (event.code) view.code = [...event.code];
      if (event.expiresAt) view.expiresAt = event.expiresAt;
      if (event.peer) view.peer = peerOf(event.peer);
      if (event.approveDeadline) view.approveDeadline = event.approveDeadline;
      if (event.progress !== undefined) view.progress = progressOf(event.progress);
    }
    if (before.passwordsRefused) view.passwordsRefused = true;
    rec.view = view;
  }

  /** One outgoing session per install; a second `send` ends the first (spec 14.7). Resolves once the code is on the relay (`ready`) or the session has already ended. */
  async function send(request) {
    if (!deps.transport) throw unavailable();
    if (S.out) { const old = S.out; S.out = null; try { void Promise.resolve(old.out.cancel?.()).catch(() => {}); } catch { /* already over */ } }
    const include = rowsOf(request.include);
    const passwords = include.passwords && deps.passwordsGate ? await deps.passwordsGate() : include.passwords;
    const passwordsRefused = include.passwords && !passwords;
    const { payload, counts } = await build({ profileId: request.profileId, include: { ...include, passwords: include.passwords && passwords }, historyDays: request.historyDays || 0, ui: request.ui, passwords: include.passwords && passwords, identity: 'code' });
    const bytes = Buffer.from(JSON.stringify(payload), 'utf8');
    // The transport compresses and refuses what does not fit (`failed/too_large`); this check says so before a code exists. A payload under the limit raw cannot be over it packed.
    if (bytes.length > maxCodeBytes && (await payloads.pack(payload)).length > maxCodeBytes) throw fail('too-large', 'Too large to send by code. Choose Last 90 days for History or untick New tab pictures.');
    const manifest = { profileName: payload.profile.name, platform: payload.app.platform, createdAt: payload.createdAt, counts };
    let settle;
    const readyOrEnded = new Promise((resolve) => { settle = resolve; });
    const out = await started(deps.transport.send(bytes, manifest), (out) => {
      const rec = { out, view: { state: 'building', ...(passwordsRefused ? { passwordsRefused: true } : {}) } };
      S.out = rec;
      const onEvent = (event) => {
        if (S.out !== rec || !event || typeof event.state !== 'string') return;
        mergeOutgoing(rec, event);
        if (rec.view.state !== 'building') settle();
        emit();
      };
      out.on('state', onEvent);
      // A stand-in has no `building` and no `ready` event: its code is good at once.
      const first = out.status?.();
      if (first && typeof first.state === 'string' && first.state !== 'building') onEvent(first);
      else if (!first || first.state === undefined) { rec.view = { state: 'ready', code: [...out.code], expiresAt: out.expiresAt, ...(passwordsRefused ? { passwordsRefused: true } : {}) }; settle(); }
      return out;
    });
    emit();
    await readyOrEnded;
    const live = S.out?.out === out && !isEnded(S.out.view.state);
    return { code: live ? [...out.code] : [], expiresAt: live ? S.out.view.expiresAt ?? out.expiresAt : 0, passwordsRefused };
  }

  /** The two digits typed on this computer. Digits of any script are read by the transport; a wrong number ends everything at once. */
  async function approve({ number }) {
    const rec = S.out;
    if (!rec) throw fail('gone', 'There is nothing to confirm.');
    const result = await rec.out.approve(String(number ?? ''));
    return result?.ok ? { ok: true } : { ok: false, reason: result?.reason || 'ended' };
  }
  /** "That's not the number" / Cancel on the number screen: the session ends as `cancelled/mismatch`, and the screens show "Cancelled for safety". */
  function deny() {
    const rec = S.out;
    if (rec) { try { void Promise.resolve(rec.out.deny?.()).catch(() => {}); } catch { /* already over */ } }
    return {};
  }

  /** What a `state` event from the receiving transport means for the status. */
  function mergeIncoming(rec, event) {
    const before = rec.view, state = event.state;
    const view = { state };
    if (isEnded(state)) {
      view.reason = event.reason ?? null; view.from = event.from; if (event.local !== undefined) view.local = event.local;
      if (before.peer) view.peer = before.peer;
      if (before.manifest) view.manifest = before.manifest;
    } else {
      if (before.peer) view.peer = before.peer;
      if (before.manifest) view.manifest = before.manifest;
      if (before.progress) view.progress = before.progress;
      if (before.approveDeadline) view.approveDeadline = before.approveDeadline;
      if (state === 'confirming' && event.number !== undefined && event.number !== null) view.number = event.number;
      if (event.peer) view.peer = peerOf(event.peer);
      if (event.approveDeadline) view.approveDeadline = event.approveDeadline;
      if (event.manifest) view.manifest = manifestOf(event.manifest);
      if (event.progress !== undefined) view.progress = progressOf(event.progress);
      if (state === 'checking' || state === 'received') view.progress = { done: view.progress?.total || 1, total: view.progress?.total || 1, fraction: 1 };
    }
    rec.view = view;
  }

  /** The whole payload arrived and was verified: read it, check it, and show the preview. Anything wrong ends the receiving side with the reason of spec 4.6. */
  function onReceived(rec, event) {
    const bytes = event.payloadBytes;
    const failWith = (reason) => {
      rec.sealed = true;
      rec.view = { state: 'failed', reason, from: 'checking', ...(rec.view.peer ? { peer: rec.view.peer } : {}), ...(rec.view.manifest ? { manifest: rec.view.manifest } : {}) };
      // The sender is told the truth: this computer did not take it.
      try { void Promise.resolve(rec.inc.cancel?.()).catch(() => {}); } catch { /* already over */ }
    };
    try {
      acceptBytes(bytes, { profileId: rec.profileId, peer: rec.view.peer });
      rec.view = { state: 'preview', ...(rec.view.peer ? { peer: rec.view.peer } : {}), ...(rec.view.manifest ? { manifest: rec.view.manifest } : {}), progress: { done: rec.view.progress?.total || 1, total: rec.view.progress?.total || 1, fraction: 1 } };
      // The payload is in memory and checked: the relay may delete its copy now, and the sender sees "Sent".
      try { void Promise.resolve(rec.inc.finish?.()).catch(() => {}); } catch { /* the session is over */ }
    } catch (error) {
      failWith(error.code === 'newer' ? 'newer' : error.code === 'damaged' ? 'damaged' : 'invalid');
    } finally {
      // The transport keeps no copy once it has delivered; this one must not outlive the parse either.
      if (bytes && typeof bytes.fill === 'function') bytes.fill(0);
    }
  }

  /** One incoming session per install; a new `receive` ends the one before it and forgets what it brought. */
  async function receive({ code, profileId }) {
    if (!deps.transport) throw unavailable();
    if (S.inc) { const old = S.inc; S.inc = null; try { void Promise.resolve(old.inc.cancel?.()).catch(() => {}); } catch { /* already over */ } }
    drop();
    started(deps.transport.receive(code), (inc) => {
      const rec = { inc, view: { state: 'joining' }, profileId, sealed: false };
      S.inc = rec;
      const onEvent = (event) => {
        if (S.inc !== rec || rec.sealed || !event || typeof event.state !== 'string') return;
        if (event.state === 'received') { if (rec.view.state === 'preview') return; mergeIncoming(rec, { ...event, state: 'checking' }); onReceived(rec, event); emit(); return; }
        mergeIncoming(rec, event);
        emit();
      };
      inc.on('state', onEvent);
      // An ending that happened before this listener (a code that is not five words fails at once) is read from the session itself.
      const first = inc.status?.();
      if (first && typeof first.state === 'string' && first.state !== 'joining') onEvent(first);
    });
    emit();
    return {};
  }

  // ------------------------------------------------------------------ status

  const outgoingView = () => (S.out ? { ...S.out.view } : null);
  const incomingView = () => (S.inc ? { ...S.inc.view } : null);
  /** `{outgoing, incoming}` as the screens read them, plus `applying` while Bring it over runs (`{done:[…steps], step}`; steps: spaces, bookmarks, history, settings, sites, other). */
  function status() {
    return { outgoing: outgoingView(), incoming: incomingView(), applying: S.applying ? { done: [...S.applying.done], step: S.applying.step } : null };
  }
  /**
   * The person's own Cancel. A live session ends and is forgotten (the sheet goes back to its first screen); one that had already ended is simply dismissed.
   * The incoming side also forgets the payload it was holding (spec 14.17).
   */
  function cancel({ side }) {
    if (side === 'outgoing') {
      const rec = S.out; S.out = null;
      if (rec) { try { void Promise.resolve(rec.out.cancel?.()).catch(() => {}); } catch { /* already over */ } }
    } else {
      const rec = S.inc; S.inc = null;
      if (rec) { try { void Promise.resolve(rec.inc.cancel?.()).catch(() => {}); } catch { /* already over */ } }
      drop();
    }
    emit();
    return {};
  }
  /** Quitting: both sessions end, best effort. */
  function cancelAll() {
    const told = [S.out?.out, S.inc?.inc].map((session) => { try { return Promise.resolve(session?.cancel?.()).catch(() => {}); } catch { return Promise.resolve(); } });
    S.out = null; S.inc = null; drop();
    return Promise.all(told).then(() => {});
  }

  // ------------------------------------------------------------------ startup

  /** Takes back every transfer that was cut off while applying; remembers their ids for the renderer's half (`rolledBack`). */
  function recover() {
    S.rolledBackIds = deps.importer.recoverApplying();
    return S.rolledBackIds;
  }

  return {
    summary, saveFile, openFile, acceptBytes, preview: previewOf, apply: applyIncoming,
    applyLook: ({ batchId }) => apply.applyLook(batchId), applied: ({ batchId }) => apply.applied(batchId),
    rolledBack: () => ({ batchIds: [...S.rolledBackIds] }), recover, cancel, cancelAll, drop,
    lastSavedPath: () => S.lastSaved, send, approve, deny, receive, status, active: () => transferActive(S), undoHooks: apply.undoHooks, _apply: apply
  };
}

module.exports = { createTransfer, transferActive, MAX_CODE_BYTES, APPLY_STEPS };
