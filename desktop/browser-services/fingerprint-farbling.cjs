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
// 256 KB of evenly spaced samples (speed), wrappers are patched to print as native functions but remain detectable by
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
    const K = new Uint32Array([0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
    const sha256 = bytes => {
      const length = bytes.length, padded = new Uint8Array((((length + 9 + 63) >> 6) << 6)); padded.set(bytes); padded[length] = 0x80;
      const view = new DataView(padded.buffer); view.setUint32(padded.length - 8, Math.floor(length / 0x20000000)); view.setUint32(padded.length - 4, (length << 3) >>> 0);
      const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]), w = new Uint32Array(64);
      const rotr = (x, n) => (x >>> n) | (x << (32 - n));
      for (let offset = 0; offset < padded.length; offset += 64) {
        for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
        for (let i = 16; i < 64; i++) { const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3), s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10); w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0; }
        let [a, b, c, d, e, f, g, hh] = h;
        for (let i = 0; i < 64; i++) { const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0, t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0; hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0; }
        h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
      }
      const out = new Uint8Array(32), ov = new DataView(out.buffer); for (let i = 0; i < 8; i++) ov.setUint32(i * 4, h[i]); return out;
    };
    const hmac = (key, data) => { const block = new Uint8Array(64); block.set(key.length > 64 ? sha256(key) : key); const inner = new Uint8Array(64 + data.length), outer = new Uint8Array(96); for (let i = 0; i < 64; i++) { inner[i] = block[i] ^ 0x36; outer[i] = block[i] ^ 0x5c; } inner.set(data, 64); outer.set(sha256(inner), 64); return sha256(outer); };
    const tokenBytes = Uint8Array.from(cfg.token.match(/../g).map(x => parseInt(x, 16)));
    // --- Brave's pixel perturbation ---
    const U64 = (1n << 64n) - 1n, TOP = 0xC000000000000000n, lfsr = v => ((v >> 1n) | (((v << 62n) ^ (v << 61n)) & TOP)) & U64;
    const perturb = data => {
      if (!data || data.length < 4) return;
      const pixels = Math.floor(data.length / 4), cap = 262144, sample = data.length > cap ? new Uint8Array(cap) : data;
      if (sample !== data) { const stride = Math.floor(data.length / cap); for (let i = 0; i < cap; i++) sample[i] = data[i * stride]; }
      const key = hmac(tokenBytes, sample === data ? new Uint8Array(data.buffer, data.byteOffset, data.length) : sample), count = BigInt(pixels);
      let v = 0n; for (let i = 7; i >= 0; i--) v = (v << 8n) | BigInt(key[i]);
      for (const byte of key) { let bit = byte; for (let j = 0; j < 16; j++) { if (j % 8 === 0) bit = byte; const channel = Number(v % 3n), index = 4 * Number(v % count) + channel; data[index] = data[index] ^ (bit & 1); bit >>= 1; v = lfsr(v); } }
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
