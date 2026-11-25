'use strict';
// The two transfer state machines (section 12.2 of the design notes): the sending computer (A) and the receiving one (B),
// speaking protocol 2 to the relay (relay.cjs) with the cryptography of crypto.cjs. This is the whole interface the rest of the app uses:
//
//   const transport = createTransport({ relay, device });         // device: { label, platform, appVersion } or a function returning it
//   const out = transport.send(payloadBytes, manifest);           // payloadBytes: the payload as UTF-8 JSON bytes; the transport compresses them
//   out.code            // string[5], the words. Show them only from the 'ready' state on (a code is made again if the relay says the slot is taken)
//   out.expiresAt       // ms on THIS computer's clock when the unclaimed code ends (an estimate until 'ready', then the relay's own deadline)
//   out.on('state', s => ...)        s = { state, ...fields }, one of:
//        ready {code, expiresAt} | confirming {peer, approveDeadline} | sending {progress} | uploaded {progress} | done |
//        cancelled {reason, local, from} | expired {reason, from} | failed {reason, from}
//        (before 'ready' the status is { state: 'building' }; there is no event for it)
//   out.approve(number)  // Promise<{ok:true} | {ok:false, reason:'mismatch'|'not_ready'|'ended'|...}>; a wrong number cancels at once
//   out.deny(); out.cancel(); out.status()
//
//   const inc = transport.receive(code);                           // code: the typed text, or the five words
//   inc.on('state', s => ...)        joining | waiting {approveDeadline} | confirming {number, peer, approveDeadline} |
//        receiving {manifest, progress} | checking | received {payloadBytes, manifest} | cancelled / expired / failed {reason, from}
//   inc.cancel(); inc.status()
//   inc.finish()         // after payloadBytes are read: tells the relay (which deletes everything), drops the transport's copy; returns a Promise
//
// `progress` is { done, total, fraction }: bytes the receiver has taken and verified (so both screens move together), of the bytes in all.
// `from` is the state the session was in when it ended, so the screen can pick the right message. Every `reason`, and the section 4.6 row it means:
//   cancelled: sender, receiver (the other computer cancelled, or this one when local is true), mismatch (a wrong number or Deny; "Cancelled for safety"),
//              timeout (nobody confirmed the number in 3 minutes), tamper (a check failed: "Something interfered with the connection")
//   expired:   expired (the code ran out of time, or the 20 minute cap)
//   failed:    not_found, in_use, ended (this code was already used or cancelled), gone (the transfer ended or vanished after the number was matched), busy, rate_limited,
//              offline, slow (below about 35 kbit/s), unavailable (the function is not deployed, or keeps failing), silent (45 s with no sign of the other computer),
//              damaged (a chunk, the hash or the unpacking failed), too_large, own_code (the code was typed on the computer that made it), bad_code, newer, protocol, internal
//
// Nothing here logs or writes a file. Keys, tokens and the code live only in these objects and are wiped when a session ends.
const { EventEmitter } = require('node:events');
const nodeCrypto = require('node:crypto');
const C = require('./constants.cjs');
const codeLib = require('./code.cjs');
const realCrypto = require('./crypto.cjs');
const { RelayError } = require('./relay.cjs');

const PLATFORMS = ['darwin', 'win32', 'linux'];
const LIVE_AFTER_HELLO = ['claimed', 'hello', 'approved', 'sending', 'sent'];
const DATA_FLOWS = ['approved', 'sending', 'sent'];

/** Strips control characters, collapses blanks and cuts to `maxBytes` of UTF-8 at a whole character: what a device label or profile name may carry. */
function cleanText(value, maxBytes) {
  let text = String(value ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim();
  while (Buffer.byteLength(text, 'utf8') > maxBytes) text = text.slice(0, -1);
  return text.trim();
}
/** What the other computer says about itself, made safe to show. It is never called verified: the number is the proof. */
function peerOf(info) {
  const version = String(info?.appVersion ?? '');
  return {
    label: cleanText(info?.label, C.LABEL_BYTES) || 'Another computer',
    platform: PLATFORMS.includes(info?.platform) ? info.platform : 'unknown',
    appVersion: /^\d{1,4}\.\d{1,4}\.\d{1,4}(?:[-.][0-9A-Za-z.]{1,16}){0,2}$/.test(version) && version.length <= 24 ? version : '',
    profileName: cleanText(info?.profileName, C.NAME_BYTES),
  };
}

const tamper = () => Object.assign(new Error('tamper'), { name: 'TransferCryptoError', code: 'tamper' });
const damaged = () => Object.assign(new Error('damaged'), { name: 'TransferCryptoError', code: 'damaged' });

/** The ending that a thrown error means: [state, reason], or null for an abort we asked for. */
function endingFor(error, from) {
  if (error instanceof RelayError) {
    switch (error.reason) {
      case 'aborted': return null;
      case 'expired': return from === 'confirming' || from === 'waiting' ? ['cancelled', 'timeout'] : ['expired', 'expired'];
      case 'ended': return ['failed', from === 'joining' ? 'ended' : 'gone'];
      // While the number is still being matched, a session that has vanished is one whose three minutes ran out (the relay deletes it, and whichever side
      // asks first is told "expired", the other finds nothing): both ends say the number was not confirmed in time.
      case 'gone': return from === 'confirming' || from === 'waiting' ? ['cancelled', 'timeout'] : ['failed', 'gone'];
      case 'unsupported_protocol': return ['failed', 'newer'];
      case 'offline': case 'slow': case 'unavailable': case 'busy': case 'rate_limited': case 'not_found': case 'in_use': case 'too_large': return ['failed', error.reason];
      default: return ['failed', 'protocol'];
    }
  }
  if (error?.name === 'TransferCryptoError') return error.code === 'tamper' ? ['cancelled', 'tamper'] : ['failed', 'damaged'];
  return ['failed', 'internal'];
}

/** What both machines share: the state, the events, one abort signal for every request in flight, and a clean ending. */
class Machine extends EventEmitter {
  constructor(deps, first) {
    super();
    this.d = deps;
    this.over = false;
    this.abort = new AbortController();
    this.timers = new Set();
    this.lastProgress = 0;
    this._status = first;
  }
  get K() { return this.d.crypto; }
  status() { return { ...this._status }; }
  _set(state, fields = {}) {
    if (this.over) return;
    this._status = { state, ...fields };
    this._emit();
  }
  /** Each listener on its own, so one that throws neither stops the others nor the transfer. */
  _emit() {
    for (const listener of this.listeners('state')) {
      try { listener.call(this, { ...this._status }); } catch { /* a listener's mistake must not stop a transfer */ }
    }
  }
  /** At most one progress event per `progressGap`, but always the first, the last and any change of state. */
  _progress(state, fields, progress) {
    const at = this.d.now();
    if (progress.fraction < 1 && this._status.state === state && at - this.lastProgress < this.d.timings.progressGap) { this._status = { state, ...fields }; return; }
    this.lastProgress = at;
    this._set(state, fields);
  }
  _timer(ms, fn) {
    const timer = setTimeout(() => { this.timers.delete(timer); fn(); }, Math.max(0, ms));
    this.timers.add(timer);
    return timer;
  }
  _clear(timer) { clearTimeout(timer); this.timers.delete(timer); }
  /** The one ending: stops every request and timer, wipes the secrets, and tells the listeners. Later calls do nothing. */
  _end(state, reason, extra = {}) {
    if (this.over) return false;
    const from = this._status.state;
    this.over = true;
    this.abort.abort();
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    this._wipe();
    this._status = { state, reason, from, ...extra };
    this._emit();
    return true;
  }
  _fail(error) {
    if (this.over) return;
    const ending = endingFor(error, this._status.state);
    if (!ending) return;
    const [state, reason] = ending;
    // A broken check also tells the other computer, so it stops too.
    if (reason === 'tamper' || (state === 'failed' && reason === 'damaged')) this._tellRelay('tamper');
    this._end(state, reason, state === 'cancelled' ? { local: true } : {});
  }
  /** Best effort: tell the relay this side is done, without the session's own abort signal (it is aborted by now) and without waiting long. */
  _tellRelay(reason) {
    if (!this.slot || !this.token) return Promise.resolve();
    // A copy of the token: the session wipes its own the moment it ends, and a retry must still send the real one.
    return this.d.relay.cancel({ slot: this.slot, token: Buffer.from(this.token), reason }, { patience: 5000 }).catch(() => {});
  }
  _spacing(started) { return Math.max(0, this.d.timings.waitGap - (this.d.now() - started)); }
  _silent(view) {
    return Number.isFinite(view.peerSeenAt) && Number.isFinite(view.serverTime) && view.serverTime - view.peerSeenAt > this.d.timings.peerTimeout;
  }
}

class Outgoing extends Machine {
  constructor(deps, payload, manifest) {
    super(deps, { state: 'building' });
    this.payload = payload;
    this.manifestIn = manifest;
    this.words = deps.code.makeCode();
    this.estimatedExpiry = deps.now() + C.CODE_TTL;
    this.phase = 'building';
    this.ownUploaded = 0;
    this.sizes = [];
    this.uploadedEmitted = false;
    this.lastAcked = -2;
    this.token = deps.random(32);
  }
  get code() { return this.words.slice(); }
  get expiresAt() { return this.claimDeadline ?? this.estimatedExpiry; }
  _wipe() {
    this.K.wipeKeys(this.keys);
    this.K.wipe(this.token, this.session, this.transcript, this.plain);
    this.payload = null;
  }

  async run() {
    const { relay, K, code } = this.d;
    const signal = this.abort.signal;
    try {
      const plain = await K.pack(this.payload);
      this.payload = null;
      if (this.over) return;
      if (plain.length > C.MAX_PAYLOAD) return void this._end('failed', 'too_large');
      this.plain = plain;
      const sha256 = K.hex(K.sha256(plain));
      const chunks = Math.max(1, Math.ceil(plain.length / C.CHUNK_PLAIN));
      this.manifestBytes = Buffer.from(JSON.stringify({ ...this.manifestIn, protocol: C.PROTOCOL, bytes: plain.length, sha256, chunks }), 'utf8');
      if (this.manifestBytes.length > C.MAX_MANIFEST) return void this._end('failed', 'too_large');
      this.plan = K.chunkPlan(plain.length, this.manifestBytes.length);
      this.sizes = [this.manifestBytes.length + C.GCM_TAG];
      for (let k = 1; k <= this.plan.n; k++) this.sizes.push(K.pieceOf(plain, k).length + C.GCM_TAG);

      let created = null;
      for (let tries = 0; tries < 3 && !created; tries++) {
        if (tries > 0) this.words = code.makeCode();
        const keys = K.deriveKeys(await K.deriveMaster(code.canonical(this.words)));
        if (this.over) return void K.wipeKeys(keys);
        K.wipeKeys(this.keys);
        this.keys = keys;
        this.slot = keys.slot;
        this.d.owner.outgoingSlot = keys.slot;
        try {
          created = await relay.create({ protocol: C.PROTOCOL, slot: keys.slot, joinHash: keys.joinHash, senderHash: K.hex(K.sha256(this.token)) }, { signal });
        } catch (error) { if (error.reason !== 'slot_taken') throw error; }
      }
      if (!created) return void this._end('failed', 'protocol');
      this.claimDeadline = relay.local(created.claimDeadline);
      this.phase = 'ready';
      this._set('ready', { code: this.code, expiresAt: this.claimDeadline });
      void this._watch();
    } catch (error) { this._fail(error); }
  }

  /** The long-poll loop for the whole life of the session: it notices B joining, B's acknowledgements, the end of the upload, a cancel or silence. */
  async _watch() {
    const { relay } = this.d;
    let since = { state: 'open', acked: -1, uploadedCount: 0 }, started = 0;
    try {
      while (!this.over) {
        if (DATA_FLOWS.includes(since.state)) { const gap = this._spacing(started); if (gap) await this.d.sleep(gap, this.abort.signal); if (this.over) return; }
        started = this.d.now();
        const view = await relay.wait({ slot: this.slot, token: this.token, since: { ...since, uploadedCount: Math.max(since.uploadedCount, this.ownUploaded) } }, { signal: this.abort.signal });
        if (this.over) return;
        since = { state: view.state, acked: view.acked, uploadedCount: view.uploadedCount };
        await this._onView(view);
      }
    } catch (error) { this._fail(error); }
  }

  async _onView(view) {
    if (view.state === 'cancelled') return void this._end('cancelled', view.cancelReason || 'receiver', { local: false });
    if (view.state === 'done') {
      // B has taken everything. A receiver that is quicker than this side's next look takes the last chunk and finishes between two polls, so `sent` was never seen: the documented
      // sequence still holds, the sender passes through `uploaded` (every byte taken) before `done`.
      if (this.phase === 'sending' && !this.uploadedEmitted) {
        this.uploadedEmitted = true;
        const total = this.plan.totalBytes;
        this.progress = { done: total, total, fraction: 1 };
        this._set('uploaded', { progress: this.progress });
      }
      this.phase = 'done'; return void this._end('done', undefined);
    }
    if (LIVE_AFTER_HELLO.includes(view.state) && this._silent(view)) {
      void this._tellRelay('timeout');
      return void this._end('failed', 'silent');
    }
    if (view.state === 'claimed' && !this.handshaking) { this.handshaking = true; this._handshake(view).catch((error) => this._fail(error)); }
    if (view.acked !== this.lastAcked && this.phase === 'sending') {
      this.lastAcked = view.acked;
      let done = 0;
      for (let i = 0; i <= view.acked; i++) done += this.sizes[i] || 0;
      this.progress = { done, total: this.plan.totalBytes, fraction: Math.min(1, done / this.plan.totalBytes) };
      // Once every chunk is on the relay the state is `uploaded`; B's acknowledgements keep arriving as `uploaded` events, never as `sending` again.
      this._progress(this.uploadedEmitted ? 'uploaded' : 'sending', { progress: this.progress }, this.progress);
    }
    if (view.state === 'sent' && !this.uploadedEmitted && this.phase === 'sending') {
      this.uploadedEmitted = true;
      this._set('uploaded', { progress: this.progress || { done: 0, total: this.plan.totalBytes, fraction: 0 } });
    }
  }

  async _handshake(view) {
    const { relay, K } = this.d, keys = this.keys, signal = this.abort.signal;
    const pkB = K.fromB64u(view.pkB, 32), infoB = K.fromB64u(view.infoB), macB = K.fromB64u(view.macB, 32);
    if (!pkB || !infoB || !macB || !K.same(macB, K.macB(keys.macKey, keys.slotBytes, pkB, infoB))) throw tamper();
    const peer = peerOf(K.openInfo(keys.infoKey, keys.slotBytes, 'B', infoB));
    const pair = K.generateKeyPair();
    const me = this.d.device();
    const infoA = K.sealInfo(keys.infoKey, keys.slotBytes, 'A', { label: cleanText(me.label, C.LABEL_BYTES), platform: me.platform, appVersion: me.appVersion, profileName: cleanText(this.manifestIn?.profileName, C.NAME_BYTES) });
    const macA = K.macA(keys.macKey, keys.slotBytes, pair.publicKey, pkB, infoA);
    await relay.hello({ slot: this.slot, token: this.token, pkA: K.b64u(pair.publicKey), infoA: K.b64u(infoA), macA: K.b64u(macA) }, { signal });
    if (this.over) return;
    this.transcript = K.transcriptOf(keys.slotBytes, pair.publicKey, pkB);
    const derived = K.deriveSession({ privateKey: pair.privateKey, peerPublic: pkB, codeKey: keys.codeKey, transcript: this.transcript });
    this.session = derived.session;
    this.number = String(derived.number);
    this.phase = 'confirming';
    const approveDeadline = relay.local(view.approveDeadline) ?? this.d.now() + this.d.timings.approveTtl;
    this._set('confirming', { peer, approveDeadline });
    this._timer(approveDeadline - this.d.now(), () => this._timeout());
  }

  /** Nobody typed the number in time: cancel for safety. */
  _timeout() {
    if (this.over || this.phase !== 'confirming') return;
    void this._tellRelay('timeout');
    this._end('cancelled', 'timeout', { local: true });
  }

  /** The number the person typed on this computer. A wrong one ends everything at once; the right one starts the upload. */
  async approve(input) {
    if (this.over) return { ok: false, reason: 'ended' };
    if (this.phase !== 'confirming') return { ok: false, reason: 'not_ready' };
    const typed = this.K.readNumber(input);
    if (!typed || !this.K.same(typed, this.number)) {
      this.phase = 'ending';
      void this._tellRelay('mismatch');
      this._end('cancelled', 'mismatch', { local: true });
      return { ok: false, reason: 'mismatch' };
    }
    this.phase = 'approving';
    try {
      const mac = this.K.approveMac(this.keys.macKey, this.transcript, this.plan.totalChunks, this.plan.totalBytes);
      await this.d.relay.approve({ slot: this.slot, token: this.token, approveMac: this.K.b64u(mac), totalChunks: this.plan.totalChunks, totalBytes: this.plan.totalBytes }, { signal: this.abort.signal });
    } catch (error) {
      this._fail(error);
      return { ok: false, reason: this._status.reason || 'ended' };
    }
    if (this.over) return { ok: false, reason: 'ended' };
    this.phase = 'sending';
    this.timers.forEach((timer) => clearTimeout(timer));
    this.timers.clear();
    this._set('sending', { progress: { done: 0, total: this.plan.totalBytes, fraction: 0 } });
    void this._upload();
    return { ok: true };
  }

  async _upload() {
    const { relay, K } = this.d;
    try {
      for (let i = 0; i <= this.plan.n; i++) {
        if (this.over) return;
        const sealed = K.sealChunk(this.session, this.transcript, i, this.plan.n, i === 0 ? this.manifestBytes : K.pieceOf(this.plain, i));
        try { await relay.put({ slot: this.slot, token: this.token, index: i, data: sealed }, { signal: this.abort.signal }); } catch (error) {
          // The relay says the session is over or not in a state to take data: ask it how it really ended before choosing the words.
          if (['bad_state', 'ended', 'gone'].includes(error.reason) && !this.over) return void this._learn();
          throw error;
        }
        this.ownUploaded = i + 1;
      }
      K.wipe(this.plain);
    } catch (error) { this._fail(error); }
  }

  /** Asks the relay for the true state after a refusal and ends with the precise reason (the other side's cancel, or gone). */
  async _learn() {
    try {
      const view = await this.d.relay.wait({ slot: this.slot, token: this.token, since: null }, { signal: this.abort.signal });
      await this._onView(view);
      if (!this.over) this._end('failed', 'protocol');
    } catch (error) { this._fail(error); }
  }

  deny() {
    if (this.over) return Promise.resolve();
    this.phase = 'ending';
    const told = this._tellRelay('mismatch');
    this._end('cancelled', 'mismatch', { local: true });
    return told;
  }
  cancel() {
    if (this.over) return Promise.resolve();
    this.phase = 'ending';
    const told = this._tellRelay('sender');
    this._end('cancelled', 'sender', { local: true });
    return told;
  }
}

class Incoming extends Machine {
  constructor(deps, input) {
    super(deps, { state: 'joining' });
    this.input = input;
    this.got = new Map();
    this.gotBytes = 0;
    this.ackedUpTo = -1;
    this.fetching = false;
    this.token = deps.random(32);
    this.phase = 'joining';
  }
  _wipe() {
    this.K.wipeKeys(this.keys);
    this.K.wipe(this.token, this.session, this.transcript);
    for (const piece of this.got.values()) this.K.wipe(piece);
    this.got.clear();
    if (!this.delivered) this.K.wipe(this.payload);
    this.payload = null;
  }

  async run() {
    const { relay, K, code } = this.d;
    const signal = this.abort.signal;
    try {
      const words = code.parseCode(this.input);
      this.input = null;
      if (!words) return void this._end('failed', 'bad_code');
      const keys = K.deriveKeys(await K.deriveMaster(code.canonical(words)));
      this.keys = keys;
      if (this.over) return;
      if (this.d.owner.outgoingSlot && this.d.owner.outgoingSlot === keys.slot && !this.d.owner.outgoingOver()) return void this._end('failed', 'own_code');
      this.slot = keys.slot;
      const pair = K.generateKeyPair();
      this.pair = pair;
      const me = this.d.device();
      const infoB = K.sealInfo(keys.infoKey, keys.slotBytes, 'B', { label: cleanText(me.label, C.LABEL_BYTES), platform: me.platform, appVersion: me.appVersion });
      this.pkB = pair.publicKey;
      const joined = await relay.join({ slot: keys.slot, joinKey: K.b64u(keys.joinKey), receiverHash: K.hex(K.sha256(this.token)), pkB: K.b64u(pair.publicKey), infoB: K.b64u(infoB), macB: K.b64u(K.macB(keys.macKey, keys.slotBytes, pair.publicKey, infoB)) }, { signal });
      if (this.over) return;
      this.phase = 'waiting';
      this.approveDeadline = relay.local(joined.approveDeadline);
      this._set('waiting', { approveDeadline: this.approveDeadline });
      await this._watch();
    } catch (error) { this._fail(error); }
  }

  async _watch() {
    const { relay } = this.d;
    let since = { state: 'claimed', acked: -1, uploadedCount: 0 }, started = 0;
    while (!this.over && this.phase !== 'received') {
      if (DATA_FLOWS.includes(since.state)) { const gap = this._spacing(started); if (gap) await this.d.sleep(gap, this.abort.signal); if (this.over) return; }
      started = this.d.now();
      const view = await relay.wait({ slot: this.slot, token: this.token, since: { ...since, acked: Math.max(since.acked, this.ackedUpTo) } }, { signal: this.abort.signal });
      if (this.over) return;
      since = { state: view.state, acked: view.acked, uploadedCount: view.uploadedCount };
      await this._onView(view);
    }
  }

  async _onView(view) {
    if (view.state === 'cancelled') return void this._end('cancelled', view.cancelReason || 'sender', { local: false });
    if (LIVE_AFTER_HELLO.includes(view.state) && this._silent(view)) {
      void this._tellRelay('timeout');
      return void this._end('failed', 'silent');
    }
    const { K } = this.d, keys = this.keys;
    if (!this.session && view.pkA && view.infoA && view.macA) {
      const pkA = K.fromB64u(view.pkA, 32), infoA = K.fromB64u(view.infoA), macA = K.fromB64u(view.macA, 32);
      if (!pkA || !infoA || !macA || !K.same(macA, K.macA(keys.macKey, keys.slotBytes, pkA, this.pkB, infoA))) throw tamper();
      const peer = peerOf(K.openInfo(keys.infoKey, keys.slotBytes, 'A', infoA));
      this.transcript = K.transcriptOf(keys.slotBytes, pkA, this.pkB);
      const derived = K.deriveSession({ privateKey: this.pair.privateKey, peerPublic: pkA, codeKey: keys.codeKey, transcript: this.transcript });
      this.session = derived.session;
      this.pair = null;
      this.phase = 'confirming';
      this._set('confirming', { number: String(derived.number), peer, approveDeadline: this.approveDeadline });
    }
    if (this.session && !this.plan && view.approveMac) {
      const totalChunks = view.totalChunks, totalBytes = view.totalBytes;
      const mac = K.fromB64u(view.approveMac, 32);
      if (!mac || !Number.isInteger(totalChunks) || !Number.isInteger(totalBytes) || totalChunks < 2 || totalChunks > C.MAX_CHUNKS + 1 || totalBytes < 1 || totalBytes > C.MAX_TOTAL_BYTES
        || !K.same(mac, K.approveMac(keys.macKey, this.transcript, totalChunks, totalBytes))) throw tamper();
      this.plan = { n: totalChunks - 1, totalChunks, totalBytes };
      this.phase = 'receiving';
      this._set('receiving', { manifest: null, progress: { done: 0, total: totalBytes, fraction: 0 } });
    }
    if (this.plan && this.phase === 'receiving') await this._fetch(view.present);
  }

  /** Takes every chunk the relay lists that is not here yet, in order: opens it, keeps it, acknowledges in batches. */
  async _fetch(present) {
    const { relay, K } = this.d, signal = this.abort.signal;
    let sinceAck = 0;
    const ack = async () => {
      let up = this.ackedUpTo;
      while (this.got.has(up + 1)) up++;
      if (up <= this.ackedUpTo) return;
      await relay.ack({ slot: this.slot, token: this.token, upTo: up }, { signal });
      this.ackedUpTo = up;
      this.lastAckAt = this.d.now();
      sinceAck = 0;
    };
    for (const index of [...present].filter((i) => Number.isInteger(i) && i >= 0 && i < this.plan.totalChunks && !this.got.has(i)).sort((a, b) => a - b)) {
      if (this.over) return;
      let sealed;
      try { sealed = await relay.get({ slot: this.slot, token: this.token, index }, { signal }); } catch (error) { if (error.reason === 'not_yet') continue; throw error; }
      const piece = K.openChunk(this.session, this.transcript, index, this.plan.n, sealed);
      if (index === 0) this._readManifest(piece);
      this.got.set(index, piece);
      this.gotBytes += sealed.length;
      sinceAck++;
      const progress = { done: this.gotBytes, total: this.plan.totalBytes, fraction: Math.min(1, this.gotBytes / this.plan.totalBytes) };
      this._progress('receiving', { manifest: this.manifest, progress }, progress);
      if (sinceAck >= this.d.timings.ackEvery) await ack();
    }
    if (this.over) return;
    const everything = this.got.size === this.plan.totalChunks;
    // A batch of acknowledgements, not one per chunk: every few chunks, every half second, and at the very end.
    if (everything || sinceAck >= this.d.timings.ackEvery || this.d.now() - (this.lastAckAt ?? 0) >= this.d.timings.ackGap) await ack();
    if (everything && this.ackedUpTo === this.plan.n) await this._complete();
  }

  _readManifest(piece) {
    let manifest;
    try { manifest = JSON.parse(piece.toString('utf8')); } catch { throw damaged(); }
    const fine = manifest && typeof manifest === 'object' && !Array.isArray(manifest) && manifest.protocol === C.PROTOCOL && manifest.chunks === this.plan.n
      && Number.isInteger(manifest.bytes) && manifest.bytes >= 1 && manifest.bytes <= C.MAX_PAYLOAD && /^[0-9a-f]{64}$/.test(manifest.sha256 || '');
    if (!fine) throw damaged();
    this.manifest = manifest;
  }

  async _complete() {
    const { K } = this.d;
    this.phase = 'checking';
    this._set('checking', { manifest: this.manifest });
    const pieces = [];
    for (let i = 1; i <= this.plan.n; i++) pieces.push(this.got.get(i));
    const plain = Buffer.concat(pieces);
    if (plain.length !== this.manifest.bytes || K.hex(K.sha256(plain)) !== this.manifest.sha256) throw damaged();
    const payload = await K.unpack(plain);
    K.wipe(plain);
    if (this.over) return void K.wipe(payload);
    for (const piece of this.got.values()) K.wipe(piece);
    this.got.clear();
    this.payload = payload;
    this.phase = 'received';
    this.delivered = true;
    this._set('received', { payloadBytes: payload, manifest: this.manifest });
  }

  /** After the payload bytes are read: tells the relay (which deletes everything and tells the sender), and drops this side's copies. */
  async finish() {
    if (this.over || this.phase !== 'received') return;
    this.phase = 'finishing';
    try { await this.d.relay.done({ slot: this.slot, token: this.token }, { patience: 15000 }); } catch { /* the relay deletes it within 20 minutes anyway */ }
    this.over = true;
    this.abort.abort();
    this._wipe();
    this._status = { state: 'finished' };
  }
  cancel() {
    if (this.over) return Promise.resolve();
    const told = this.slot ? this._tellRelay('receiver') : Promise.resolve();
    this._end('cancelled', 'receiver', { local: true });
    return told;
  }
}

function createTransport({ relay, device, crypto = realCrypto, code = codeLib, random = (n) => nodeCrypto.randomBytes(n), now = () => Date.now(), sleep, timings = {} } = {}) {
  if (!relay) throw new TypeError('The transport needs a relay client.');
  const pause = sleep || ((ms, signal) => new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() { clearTimeout(timer); signal?.removeEventListener('abort', done); resolve(); }
    signal?.addEventListener('abort', done, { once: true });
  }));
  const owner = { outgoingSlot: null, outgoingOver: () => !out || out.over };
  let out = null, inc = null;
  const deps = {
    relay, crypto, code, random, now, sleep: pause, owner, K: crypto,
    timings: { peerTimeout: C.PEER_TIMEOUT, approveTtl: C.APPROVE_TTL, waitGap: C.WAIT_GAP, ackEvery: C.ACK_EVERY, ackGap: C.ACK_GAP, progressGap: 100, ...timings },
    device: () => { const me = typeof device === 'function' ? device() : device || {}; return { label: me.label || '', platform: PLATFORMS.includes(me.platform) ? me.platform : process.platform, appVersion: me.appVersion || '' }; },
  };
  const start = (machine) => { queueMicrotask(() => machine.run().catch((error) => machine._fail(error))); return machine; };
  return {
    /** Starts a send. A send already waiting is cancelled first (one outgoing session per install). */
    send(payloadBytes, manifest = {}) {
      if (!(payloadBytes instanceof Uint8Array) || payloadBytes.length === 0) throw new TypeError('send needs the payload bytes.');
      if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) || JSON.stringify(manifest).length > C.MAX_MANIFEST - 256) throw new TypeError('send needs a small manifest object.');
      void out?.cancel();
      owner.outgoingSlot = null;
      out = start(new Outgoing(deps, Buffer.from(payloadBytes), manifest));
      return out;
    },
    /** Starts a receive. One already running is cancelled first. */
    receive(codeInput) {
      void inc?.cancel();
      inc = start(new Incoming(deps, codeInput));
      return inc;
    },
    status: () => ({ outgoing: out ? out.status() : null, incoming: inc ? inc.status() : null }),
    /** Ends both sessions and resolves when the relay has been told (best effort): for quitting Acira. */
    cancelAll: () => Promise.all([out?.cancel(), inc?.cancel()]).then(() => {}),
  };
}

module.exports = { createTransport, cleanText, peerOf, endingFor };
