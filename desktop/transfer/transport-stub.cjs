'use strict';
// An in-process stand-in for the relay transport (desktop/transfer/session.cjs), for the service's unit tests. It is NOT the protocol: no crypto, no server. Two
// parties in one process find each other by code. It follows the real transport's contract where the service can tell: the payload is UTF-8 JSON bytes handed
// through untouched, the number is a string of digits, `approve` answers with a promise, progress is { done, total, fraction }.
const { EventEmitter } = require('node:events');

const WORDS = ['amber', 'falcon', 'river', 'copper', 'lantern', 'meadow', 'orbit', 'quartz', 'willow', 'harbor', 'ember', 'canyon'];

function createStubTransport({ now = Date.now, ttl = 600000, number = () => 10 + Math.floor(Math.random() * 90) } = {}) {
  const open = new Map();
  let counter = 0;
  const pick = () => Array.from({ length: 5 }, (_, i) => WORDS[(counter * 5 + i) % WORDS.length]);
  return {
    words: () => WORDS.slice(),
    send(bytes, manifest) {
      const code = pick(); counter++;
      const out = new EventEmitter(), expiresAt = now() + ttl;
      const session = { out, bytes, manifest, expected: number(), peer: null, receiver: null, done: false };
      Object.assign(out, {
        code, expiresAt,
        status: () => ({ state: session.state, peer: session.peer }),
        async approve(typed) {
          if (!session.receiver || session.done) return { ok: false, reason: 'mismatch' };
          const digits = String(typed ?? '').replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x660)).trim();
          if (digits !== String(session.expected)) { out.cancel('mismatch'); return { ok: false, reason: 'mismatch' }; }
          out.emit('state', { state: 'sending', progress: { done: 0, total: bytes.length, fraction: 0 } });
          setImmediate(() => {
            session.receiver.emit('state', { state: 'receiving', manifest: { ...manifest, bytes: bytes.length }, progress: { done: 0, total: bytes.length, fraction: 0 } });
            session.receiver.emit('state', { state: 'checking', manifest: { ...manifest, bytes: bytes.length } });
            session.receiver.emit('state', { state: 'received', payloadBytes: Buffer.from(bytes), manifest: { ...manifest, bytes: bytes.length } });
            out.emit('state', { state: 'uploaded', progress: { done: bytes.length, total: bytes.length, fraction: 1 } });
            session.done = true;
            out.emit('state', { state: 'done' });
          });
          return { ok: true };
        },
        deny() { out.cancel('mismatch'); },
        cancel(reason = 'sender') { if (session.done) return; session.done = true; open.delete(code.join(' ')); out.emit('state', { state: 'cancelled', reason }); session.receiver?.emit('state', { state: 'cancelled', reason }); }
      });
      open.set(code.join(' '), session);
      return out;
    },
    receive(typed) {
      const key = (Array.isArray(typed) ? typed : String(typed).split(/[\s\-_.,]+/)).map((word) => word.toLowerCase()).join(' ');
      const inc = new EventEmitter();
      Object.assign(inc, { status: () => ({}), cancel() { inc.emit('state', { state: 'cancelled', reason: 'receiver' }); }, finish() {} });
      setImmediate(() => {
        const session = open.get(key);
        if (!session) return inc.emit('state', { state: 'failed', reason: 'ended' });
        if (session.receiver) return inc.emit('state', { state: 'failed', reason: 'ended' });
        session.receiver = inc; session.peer = { label: 'This computer' };
        inc.emit('state', { state: 'confirming', number: String(session.expected), peer: { label: 'Sender', platform: 'win32' } });
        session.out.emit('state', { state: 'confirming', peer: { label: 'This computer', platform: process.platform } });
      });
      return inc;
    }
  };
}

module.exports = { createStubTransport, WORDS };
