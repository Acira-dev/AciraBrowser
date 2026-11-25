'use strict';
// Fingerprint protection by "farbling" (F58): small, deterministic, per-site-per-session differences in the values that
// fingerprinting scripts read, so the same device looks different to each site and to each browser session, while
// real pages keep working. Modelled on Brave's "standard" level and ported from brave-core (MPL-2.0, rev 1e6f002):
//  - canvas / WebGL pixel perturbation: third_party/blink/renderer/core/farbling/brave_session_cache.cc PerturbPixelsInternal
//    (HMAC-SHA256 of the pixels keyed by the site token chooses 512 colour-channel LSBs to flip; the LFSR is lfsr_next)
//  - audio fudge factor 0.99..1.0 on analyser output and channel data: third_party/blink/renderer/platform/brave_audio_farbling_helper.cc,
//    ios/browser/brave_shields/resources/farbling.ts
//  - hardwareConcurrency = 2 + round((real - 2) * scale): ios/browser/brave_shields/resources/farbling.ts
// Differences from Brave, all forced by running as page JavaScript instead of inside Blink: the pixel HMAC covers at most
// 512 bytes of evenly spaced samples (speed), wrappers are patched to print as native functions but remain detectable by
// determined scripts, and a copy of the canvas is perturbed instead of the internal bitmap.
const { createHmac, randomBytes } = require('node:crypto'), { getDomain } = require('tldts');
const { nativeAuthenticationContext } = require('./authentication-compatibility.cjs');
const LEVELS = new Set(['standard', 'strict']);
/** Per-session secret -> per-site values. A new key every launch, so farbled values never persist across sessions. */
function createFarbling({ sessionKey = randomBytes(32), getLevel = () => 'standard' } = {}) {
  const config = site => {
    const digest = createHmac('sha256', sessionKey).update(site).digest(), unit = offset => digest.readUInt32LE(offset) / 4294967296;
    return { token: digest.toString('hex'), fudge: 0.99 + unit(0) * 0.01, hardware: unit(4), memory: unit(8) };
  };
  return {
    /** JavaScript to run before the page's scripts in this frame, or '' when protection is off or the frame is not a website. */
    scriptFor(topUrl, frameUrl = topUrl, { allowNativeAuthentication = true } = {}) {
      const level = getLevel();
      if (!LEVELS.has(level) || !/^https?:/.test(frameUrl || '') || (allowNativeAuthentication && nativeAuthenticationContext(topUrl, frameUrl))) return '';
      let site = ''; try { const host = new URL(topUrl).hostname; site = getDomain(host, { allowPrivateDomains: true }) || host; } catch { return ''; }
      return '(' + inject.toString() + ')(' + JSON.stringify({ ...config(site), strict: level === 'strict' }) + ');';
    },
    config
  };
}
/* eslint-disable */
// Everything below runs in the page's own world. It must be self-contained: it is stringified and executed per frame.
// `w` is the window to protect: the frame the script runs in, or a same-origin child frame reached from it (see the end).
// `done` holds one constructor per protected window, so a window is never patched twice (a WindowProxy outlives its document).
function inject(cfg, win, covered) {
  'use strict';
  try {
    const w = win || window, done = covered || new WeakSet();
    if (done.has(w.Navigator)) return; done.add(w.Navigator);
    const nativeToString = w.Function.prototype.toString, disguised = new WeakMap();
    const toStringPatch = function toString() { const text = disguised.get(this); return text !== undefined ? text : nativeToString.call(this); };
    disguised.set(toStringPatch, 'function toString() { [native code] }');
    Object.defineProperty(w.Function.prototype, 'toString', { value: toStringPatch, writable: true, configurable: true });
    const wrap = (fn, original) => { try { Object.defineProperty(fn, 'name', { value: original.name, configurable: true }); Object.defineProperty(fn, 'length', { value: original.length, configurable: true }); } catch { } disguised.set(fn, nativeToString.call(original)); return fn; };
    const patch = (proto, name, make) => { const d = Object.getOwnPropertyDescriptor(proto, name); if (!d || typeof d.value !== 'function') return; const original = d.value; Object.defineProperty(proto, name, { ...d, value: wrap(make(original), original) }); };
    const patchGetter = (proto, name, compute) => { const d = Object.getOwnPropertyDescriptor(proto, name); if (!d || !d.get) return; const original = d.get; Object.defineProperty(proto, name, { ...d, get: wrap({ [`get ${name}`]() { return compute(Reflect.apply(original, this, [])); } }[`get ${name}`], original) }); };
    // --- SHA-256 / HMAC (synchronous: canvas reads are synchronous) ---
    const K = new Int32Array([0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
    const tokenBytes = Uint8Array.from(cfg.token.match(/../g).map(x => parseInt(x, 16)));
    // 14.0: the same HMAC-SHA256, bit for bit (the tests compare it with node's crypto), without the allocations: the key's two padded blocks are hashed once per page and their states kept, the message is read in place,
    // one reusable work buffer, every step in 32-bit integers. A 512-byte sample is 10 block compressions (it was 12, plus about 14 typed arrays and a copy of the sample, per read).
    const W = new Int32Array(64), IV = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const compress = (s, u8, o) => {
      for (let i = 0; i < 16; i++, o += 4) W[i] = (u8[o] << 24) | (u8[o + 1] << 16) | (u8[o + 2] << 8) | u8[o + 3];
      for (let i = 16; i < 64; i++) { const x = W[i - 15], y = W[i - 2]; W[i] = (((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10)) + W[i - 7] + (((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)) + W[i - 16] | 0; }
      let a = s[0], b = s[1], c = s[2], d = s[3], e = s[4], f = s[5], g = s[6], h = s[7];
      for (let i = 0; i < 64; i++) {
        const t1 = (h + (((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))) + ((e & f) ^ (~e & g)) + K[i] + W[i]) | 0, t2 = ((((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      s[0] = (s[0] + a) | 0; s[1] = (s[1] + b) | 0; s[2] = (s[2] + c) | 0; s[3] = (s[3] + d) | 0; s[4] = (s[4] + e) | 0; s[5] = (s[5] + f) | 0; s[6] = (s[6] + g) | 0; s[7] = (s[7] + h) | 0;
    };
    const tail = new Uint8Array(128);
    const finish = (s, u8, o, len, total) => { // the last (partial) block of a message of `total` bytes, padded: one or two blocks
      const rest = len - o, end = rest < 56 ? 64 : 128, hiBits = Math.floor(total / 0x20000000), loBits = (total << 3) >>> 0;
      tail.fill(0); for (let i = 0; i < rest; i++) tail[i] = u8[o + i]; tail[rest] = 0x80;
      tail[end - 8] = hiBits >>> 24; tail[end - 7] = (hiBits >>> 16) & 255; tail[end - 6] = (hiBits >>> 8) & 255; tail[end - 5] = hiBits & 255;
      tail[end - 4] = loBits >>> 24; tail[end - 3] = (loBits >>> 16) & 255; tail[end - 2] = (loBits >>> 8) & 255; tail[end - 1] = loBits & 255;
      compress(s, tail, 0); if (end === 128) compress(s, tail, 64);
    };
    const stateBytes = (s, out) => { for (let i = 0; i < 8; i++) { out[i * 4] = s[i] >>> 24; out[i * 4 + 1] = (s[i] >>> 16) & 255; out[i * 4 + 2] = (s[i] >>> 8) & 255; out[i * 4 + 3] = s[i] & 255; } return out; };
    const digestOf = bytes => { const s = Int32Array.from(IV); let o = 0; for (; o + 64 <= bytes.length; o += 64) compress(s, bytes, o); finish(s, bytes, o, bytes.length, bytes.length); return stateBytes(s, new Uint8Array(32)); };
    const keyed = (key, pad) => { const block = new Uint8Array(64); block.set(key.length > 64 ? digestOf(key) : key); for (let i = 0; i < 64; i++) block[i] ^= pad; const s = Int32Array.from(IV); compress(s, block, 0); return s; };
    const innerStart = keyed(tokenBytes, 0x36), outerStart = keyed(tokenBytes, 0x5c), inner = new Int32Array(8), outer = new Int32Array(8), outerBlock = new Uint8Array(64), mac = new Uint8Array(32);
    outerBlock[32] = 0x80; outerBlock[62] = 0x03; // the outer message is the 64-byte key block and the 32-byte inner digest: 768 bits = 0x0300
    const hmac = sample => { // sample: a Uint8Array; the result is a reused 32-byte buffer, read before the next call
      inner.set(innerStart); let o = 0; for (; o + 64 <= sample.length; o += 64) compress(inner, sample, o);
      finish(inner, sample, o, sample.length, 64 + sample.length);
      stateBytes(inner, outerBlock); outer.set(outerStart); compress(outer, outerBlock, 0);
      return stateBytes(outer, mac);
    };
    // --- Brave's pixel perturbation ---
    // 14.0: the same perturbation at a fraction of the cost. A read used to hash up to 256 KB of pixels through a JavaScript HMAC-SHA256 and then step a BigInt generator 512 times: 219 us for a 50 x 50 read, 3.1 ms
    // for a 250 x 250 one, and in MotionMark's Images test (one 50 x 50 read per canvas per frame) the SHA-256 alone was 65 % of the page's main thread (12 % of bare Electron's score). Now (1) at most HASH_BYTES of the pixels are
    // hashed, evenly spaced with an odd stride so every colour channel counts, and a read of that many bytes or fewer is hashed whole and gets exactly the noise it always got; (2) the 64-bit generator runs on two 32-bit
    // halves (the same values, bit for bit). What the noise is does not change: a deterministic function of the per-site, per-session key and of the pixels, 512 flips of the lowest bit of a colour channel, never alpha.
    // (3) The generator's remainders never use % on the 32-bit halves: a half above 2^31 is a double in V8 and a double % is a call into the C library (about 13 ns, six of them per step: 40 of the 47 us of a 50 x 50 read).
    // v % 3 is the sum of the two 16-bit halves of each half % 3 (65536 is 1 mod 3), and v % pixels is x - floor(x / pixels) * pixels, exact because x < 2^46 and the quotient's spacing (below 2^-6 / pixels) is finer than 1 / pixels.
    const HASH_BYTES = 512;
    const perturb = data => {
      if (!data || data.length < 4) return;
      const pixels = Math.floor(data.length / 4), sample = data.length > HASH_BYTES ? new Uint8Array(HASH_BYTES) : data;
      if (sample !== data) { const stride = Math.floor(data.length / HASH_BYTES) | 1; for (let i = 0; i < HASH_BYTES; i++) sample[i] = data[(i * stride) % data.length]; }
      const key = hmac(sample === data ? new Uint8Array(data.buffer, data.byteOffset, data.length) : sample);
      // v is the 64-bit state of the original: v = key[7] .. key[0] (little endian), then v = (v >> 1) | (((v << 62) ^ (v << 61)) & TOP) every step
      let lo = (key[0] | (key[1] << 8) | (key[2] << 16) | (key[3] << 24)) >>> 0, hi = (key[4] | (key[5] << 8) | (key[6] << 16) | (key[7] << 24)) >>> 0;
      const twoTo32 = 4294967296 % pixels;
      for (const byte of key) {
        let bit = byte;
        for (let j = 0; j < 16; j++) {
          if (j % 8 === 0) bit = byte;
          const channel = ((((hi >>> 16) + (hi & 0xffff)) % 3) + (((lo >>> 16) + (lo & 0xffff)) % 3)) % 3, mix = (hi - Math.floor(hi / pixels) * pixels) * twoTo32 + (lo - Math.floor(lo / pixels) * pixels), index = 4 * (mix - Math.floor(mix / pixels) * pixels) + channel;
          data[index] = data[index] ^ (bit & 1); bit >>= 1;
          const t62 = (lo & 1) ^ ((lo >>> 1) & 1), t63 = ((lo >>> 1) & 1) ^ ((lo >>> 2) & 1);
          lo = ((lo >>> 1) | (hi << 31)) >>> 0; hi = ((hi >>> 1) | (t62 << 30) | (t63 << 31)) >>> 0;
        }
      }
    };
    const MAX_PIXELS = 8 * 1024 * 1024;
    // --- Canvas ---
    const createElement = w.Document.prototype.createElement;
    const canvasCopy = canvas => { const width = canvas.width, height = canvas.height; if (!width || !height || width * height > MAX_PIXELS) return null; const copy = Reflect.apply(createElement, w.document, ['canvas']); copy.width = width; copy.height = height; const context = Reflect.apply(w.HTMLCanvasElement.prototype.getContext, copy, ['2d']); context.drawImage(canvas, 0, 0); const image = Reflect.apply(w.CanvasRenderingContext2D.prototype.getImageData, context, [0, 0, width, height]); perturb(image.data); context.putImageData(image, 0, 0); return copy; };
    patch(w.HTMLCanvasElement.prototype, 'toDataURL', original => function toDataURL(...args) { let copy = null; try { copy = canvasCopy(this); } catch { } return Reflect.apply(original, copy || this, args); });
    patch(w.HTMLCanvasElement.prototype, 'toBlob', original => function toBlob(...args) { let copy = null; try { copy = canvasCopy(this); } catch { } return Reflect.apply(original, copy || this, args); });
    for (const Context of [w.CanvasRenderingContext2D, w.OffscreenCanvasRenderingContext2D]) if (Context) patch(Context.prototype, 'getImageData', original => function getImageData(...args) { const image = Reflect.apply(original, this, args); if (image.width * image.height <= MAX_PIXELS) perturb(image.data); return image; });
    // --- WebGL readbacks ---
    for (const GL of [w.WebGLRenderingContext, w.WebGL2RenderingContext]) if (GL) {
      patch(GL.prototype, 'readPixels', original => function readPixels(...args) { const result = Reflect.apply(original, this, args), target = args[6]; if (target && target.constructor === w.Uint8Array && args[4] === this.RGBA && args[5] === this.UNSIGNED_BYTE && args[2] * args[3] <= MAX_PIXELS) perturb(target); return result; });
      if (cfg.strict) patch(GL.prototype, 'getParameter', original => function getParameter(parameter) { const value = Reflect.apply(original, this, [parameter]); if (parameter === 0x9245) return 'Google Inc. (Generic)'; if (parameter === 0x9246) return 'ANGLE (Generic, Generic Renderer, OpenGL 4.1)'; return value; });
    }
    // --- Audio ---
    const fudge = cfg.fudge, seen = new WeakSet(), scale = array => { for (let i = 0; i < array.length; i++) array[i] = array[i] * fudge; };
    if (w.AudioBuffer) {
      patch(w.AudioBuffer.prototype, 'getChannelData', original => function getChannelData(...args) { const data = Reflect.apply(original, this, args); if (!seen.has(data)) { seen.add(data); scale(data); } return data; });
      patch(w.AudioBuffer.prototype, 'copyFromChannel', original => function copyFromChannel(destination, ...rest) { Reflect.apply(original, this, [destination, ...rest]); scale(destination); });
    }
    if (w.AnalyserNode) for (const name of ['getFloatFrequencyData', 'getByteFrequencyData', 'getByteTimeDomainData', 'getFloatTimeDomainData']) patch(w.AnalyserNode.prototype, name, original => function (...args) { Reflect.apply(original, this, args); const destination = args[0]; if (destination && destination.length) { if (destination instanceof w.Float32Array) scale(destination); } });
    // --- Device details ---
    patchGetter(w.Navigator.prototype, 'hardwareConcurrency', real => real <= 2 ? real : 2 + Math.round((real - 2) * cfg.hardware));
    patchGetter(w.Navigator.prototype, 'deviceMemory', real => { const options = [2, 4, 8].filter(value => value <= Math.max(2, real)); return options[Math.min(options.length - 1, Math.floor(cfg.memory * options.length))]; });
    if (cfg.strict) patchGetter(w.Navigator.prototype, 'languages', real => Object.freeze(real.slice(0, 1)));
    // --- Child frames with nothing loaded yet (about:blank, the classic way to reach untouched canvas functions): protected the
    // moment this frame reaches them. Frames with a page of their own (http(s), srcdoc; same-origin or cross-site) run the farbling preload
    // themselves before their scripts (tabs load preloads in iframes, R4-37), so they are left alone here and never patched twice.
    const cover = child => { try { if (child && child !== w && child.location.href === 'about:blank' && child.Navigator) inject(cfg, child, done); } catch { /* Another origin: not reachable from here. */ } return child; };
    for (const Frame of [w.HTMLIFrameElement, w.HTMLFrameElement, w.HTMLObjectElement]) if (Frame) {
      patchGetter(Frame.prototype, 'contentWindow', cover);
      patchGetter(Frame.prototype, 'contentDocument', doc => { try { if (doc) cover(doc.defaultView); } catch { } return doc; });
    }
    // --- High-entropy client hints: report the reduced values the user-agent string already shows ---
    if (w.NavigatorUAData) patch(w.NavigatorUAData.prototype, 'getHighEntropyValues', original => function getHighEntropyValues(hints) { return Reflect.apply(original, this, [hints]).then(values => { const reduced = { ...values }; const major = String(values.uaFullVersion || '').split('.')[0]; if ('architecture' in reduced) reduced.architecture = 'x86'; if ('bitness' in reduced) reduced.bitness = '64'; if ('model' in reduced) reduced.model = ''; if ('platformVersion' in reduced) reduced.platformVersion = String(values.platformVersion || '').split('.')[0] + '.0.0'; if ('uaFullVersion' in reduced && major) reduced.uaFullVersion = major + '.0.0.0'; if (Array.isArray(reduced.fullVersionList)) reduced.fullVersionList = reduced.fullVersionList.map(item => ({ brand: item.brand, version: String(item.version).split('.')[0] + '.0.0.0' })); return reduced; }); });
  } catch (error) { /* A page must never break because protection failed. */ }
}
/** Request headers that carry high-entropy client hints. Dropped for cross-site requests (and every request in strict mode). */
const HIGH_ENTROPY_HINTS = new Set(['sec-ch-ua-full-version-list', 'sec-ch-ua-full-version', 'sec-ch-ua-platform-version', 'sec-ch-ua-arch', 'sec-ch-ua-bitness', 'sec-ch-ua-model', 'sec-ch-ua-wow64']);
function reduceClientHints(details, level, { allowNativeAuthentication = true } = {}) {
  if (!LEVELS.has(level)) return {};
  if (allowNativeAuthentication && nativeAuthenticationContext(details.referrer || details.webContents?.getURL?.(), details.url)) return {};
  const headers = details.requestHeaders || {}, hit = Object.keys(headers).filter(name => HIGH_ENTROPY_HINTS.has(name.toLowerCase()));
  if (!hit.length) return {};
  if (level !== 'strict') { let crossSite = false; try { const page = details.referrer || details.webContents?.getURL?.() || '', a = getDomain(new URL(details.url).hostname) || '', b = getDomain(new URL(page).hostname) || ''; crossSite = !!page && a !== b; } catch { } if (!crossSite) return {}; }
  const next = { ...headers }; for (const name of hit) delete next[name]; return { requestHeaders: next };
}
module.exports = { createFarbling, reduceClientHints, inject, LEVELS };
