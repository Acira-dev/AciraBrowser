'use strict';
// Site colour research (beta.12, item 19, researcher A). Pure helpers, no Electron: colour parsing, CIEDE2000, a few ways to summarise a block of
// pixels, and the smoothing + hysteresis that keeps a chrome colour from flickering. Used by desktop/site-color-probe.cjs (dev flag only, never wired
// into the visible UI) and covered by tests/site-color-probe.test.cjs.

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const hex2 = (value) => clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0');
/** [r, g, b] (0..255) -> "#rrggbb". */
const toHex = (rgb) => '#' + hex2(rgb[0]) + hex2(rgb[1]) + hex2(rgb[2]);
/** "#rgb", "#rrggbb" or "#rrggbbaa" -> [r, g, b, a(0..1)], or null. */
function fromHex(text) {
  const match = /^#([0-9a-f]{3,8})$/i.exec(String(text || '').trim());
  if (!match) return null;
  let digits = match[1];
  if (digits.length === 3 || digits.length === 4) digits = [...digits].map((digit) => digit + digit).join('');
  if (digits.length !== 6 && digits.length !== 8) return null;
  const channel = (at) => parseInt(digits.slice(at, at + 2), 16);
  return [channel(0), channel(2), channel(4), digits.length === 8 ? channel(6) / 255 : 1];
}
/** Source-over of [r, g, b, a] on an opaque [r, g, b]; the result is opaque. */
function over(rgba, base = [255, 255, 255]) {
  const a = rgba.length > 3 ? rgba[3] : 1;
  return [0, 1, 2].map((i) => rgba[i] * a + base[i] * (1 - a));
}

// sRGB -> CIE Lab (D65).
function toLab(rgb) {
  const lin = (value) => { const v = value / 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const r = lin(rgb[0]), g = lin(rgb[1]), b = lin(rgb[2]);
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047, y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b, z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const fx = f(x), fy = f(y), fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** CIEDE2000 between two sRGB colours: ~1 is the smallest difference an eye notices side by side, <=3 is a seam only a careful eye sees, 5 is plainly a different shade. */
function deltaE(a, b) { return deltaELab(toLab(a), toLab(b)); }
/** The same, between two Lab colours (the form the published CIEDE2000 test pairs come in). */
function deltaELab(lab1, lab2) {
  const [L1, a1, b1] = lab1, [L2, a2, b2] = lab2;
  const rad = Math.PI / 180, deg = 180 / Math.PI;
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2), Cm = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Math.pow(Cm, 7) / (Math.pow(Cm, 7) + Math.pow(25, 7))));
  const ap1 = (1 + G) * a1, ap2 = (1 + G) * a2, Cp1 = Math.hypot(ap1, b1), Cp2 = Math.hypot(ap2, b2);
  const hp = (y, x) => { if (x === 0 && y === 0) return 0; const h = Math.atan2(y, x) * deg; return h < 0 ? h + 360 : h; };
  const h1 = hp(b1, ap1), h2 = hp(b2, ap2);
  const dL = L2 - L1, dC = Cp2 - Cp1;
  let dh = 0;
  if (Cp1 * Cp2 !== 0) { dh = h2 - h1; if (dh > 180) dh -= 360; else if (dh < -180) dh += 360; }
  const dH = 2 * Math.sqrt(Cp1 * Cp2) * Math.sin(dh * rad / 2);
  const Lm = (L1 + L2) / 2, Cpm = (Cp1 + Cp2) / 2;
  let hm = h1 + h2;
  if (Cp1 * Cp2 !== 0) { hm = Math.abs(h1 - h2) <= 180 ? (h1 + h2) / 2 : (h1 + h2 < 360 ? (h1 + h2 + 360) / 2 : (h1 + h2 - 360) / 2); }
  const T = 1 - 0.17 * Math.cos((hm - 30) * rad) + 0.24 * Math.cos(2 * hm * rad) + 0.32 * Math.cos((3 * hm + 6) * rad) - 0.2 * Math.cos((4 * hm - 63) * rad);
  const dTheta = 30 * Math.exp(-Math.pow((hm - 275) / 25, 2));
  const Rc = 2 * Math.sqrt(Math.pow(Cpm, 7) / (Math.pow(Cpm, 7) + Math.pow(25, 7)));
  const Sl = 1 + (0.015 * Math.pow(Lm - 50, 2)) / Math.sqrt(20 + Math.pow(Lm - 50, 2)), Sc = 1 + 0.045 * Cpm, Sh = 1 + 0.015 * Cpm * T;
  const Rt = -Math.sin(2 * dTheta * rad) * Rc;
  return Math.sqrt(Math.pow(dL / Sl, 2) + Math.pow(dC / Sc, 2) + Math.pow(dH / Sh, 2) + Rt * (dC / Sc) * (dH / Sh));
}

/** WCAG relative luminance (0..1) and contrast ratio (1..21). */
function luminance(rgb) {
  const lin = (value) => { const v = value / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
}
const contrast = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
/** HSL-style saturation 0..1 (chroma over the colour's own range): grey is 0. */
function saturation(rgb) { const max = Math.max(...rgb), min = Math.min(...rgb); return max === min ? 0 : (max - min) / (255 - Math.abs(max + min - 255)); }

/** Summary of a block of pixels in a BGRA buffer (Electron's NativeImage.toBitmap() on macOS and Windows).
 *  region = {x0, y0, x1, y1} in pixels (x1 and y1 exclusive); step = take every Nth pixel in both directions.
 *   mean    average of every sampled pixel (muddy over an image, fine over a flat colour)
 *   median  per-channel median
 *   mode    the commonest colour on a 4-bit-per-channel grid, averaged over the pixels in that cell
 *   share   how much of the block sits in the mode's cell or a cell next to it (1 = a flat colour; low = a photograph or gradient)
 *   spread  mean distance of the pixels from the mean colour in plain RGB (0..441)
 *  bytes of length width*height*4, stride width*4. */
function summarise(bgra, width, height, region, step = 1) {
  const x0 = clamp(region.x0 | 0, 0, width), x1 = clamp(region.x1 | 0, 0, width), y0 = clamp(region.y0 | 0, 0, height), y1 = clamp(region.y1 | 0, 0, height);
  if (x1 <= x0 || y1 <= y0) return null;
  const hist = new Map(), channels = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  let n = 0, sr = 0, sg = 0, sb = 0;
  for (let y = y0; y < y1; y += step) {
    for (let x = x0; x < x1; x += step) {
      const at = (y * width + x) * 4, b = bgra[at], g = bgra[at + 1], r = bgra[at + 2];
      n++; sr += r; sg += g; sb += b; channels[0][r]++; channels[1][g]++; channels[2][b]++;
      const key = (r >> 4) << 8 | (g >> 4) << 4 | (b >> 4), cell = hist.get(key);
      if (cell) { cell[0]++; cell[1] += r; cell[2] += g; cell[3] += b; } else hist.set(key, [1, r, g, b]);
    }
  }
  if (!n) return null;
  const mean = [sr / n, sg / n, sb / n];
  const median = channels.map((counts) => { let seen = 0; for (let value = 0; value < 256; value++) { seen += counts[value]; if (seen * 2 >= n) return value; } return 255; });
  let best = null, bestKey = 0;
  for (const [key, cell] of hist) if (!best || cell[0] > best[0]) { best = cell; bestKey = key; }
  const mode = [best[1] / best[0], best[2] / best[0], best[3] / best[0]];
  let near = 0;
  const kr = bestKey >> 8, kg = (bestKey >> 4) & 15, kb = bestKey & 15;
  for (let dr = -1; dr <= 1; dr++) for (let dg = -1; dg <= 1; dg++) for (let db = -1; db <= 1; db++) {
    const r = kr + dr, g = kg + dg, b = kb + db;
    if (r < 0 || g < 0 || b < 0 || r > 15 || g > 15 || b > 15) continue;
    const cell = hist.get(r << 8 | g << 4 | b); if (cell) near += cell[0];
  }
  let spread = 0;
  for (let y = y0; y < y1; y += step) for (let x = x0; x < x1; x += step) { const at = (y * width + x) * 4; spread += Math.hypot(bgra[at + 2] - mean[0], bgra[at + 1] - mean[1], bgra[at] - mean[2]); }
  return { hex: toHex(mode), mean: toHex(mean), median: toHex(median), mode: toHex(mode), rgb: mode.map(Math.round), share: near / n, spread: spread / n, pixels: n };
}


/** The colours of an icon (BGRA bitmap): `all` is the commonest colour among the opaque pixels (a white tile with a small logo reads white),
 *  `brand` the commonest among the colourful ones (saturated, neither near-black nor near-white), with the share of the opaque pixels each covers. */
function iconColours(bgra, width, height) {
  const all = new Map(), brand = new Map();
  let opaque = 0, total = width * height;
  for (let i = 0; i < total; i++) {
    const at = i * 4, a = bgra[at + 3];
    if (a < 200) continue;
    opaque++;
    const b = bgra[at], g = bgra[at + 1], r = bgra[at + 2], key = (r >> 4) << 8 | (g >> 4) << 4 | (b >> 4);
    const put = (map) => { const cell = map.get(key); if (cell) { cell[0]++; cell[1] += r; cell[2] += g; cell[3] += b; } else map.set(key, [1, r, g, b]); };
    put(all);
    const lum = luminance([r, g, b]);
    if (saturation([r, g, b]) >= 0.3 && lum > 0.02 && lum < 0.8) put(brand);
  }
  const best = (map) => { let top = null; for (const cell of map.values()) if (!top || cell[0] > top[0]) top = cell; return top; };
  const a = best(all), c = best(brand);
  const pack = (cell) => cell && { hex: toHex([cell[1] / cell[0], cell[2] / cell[0], cell[3] / cell[0]]), share: opaque ? cell[0] / opaque : 0 };
  return { opaqueShare: total ? opaque / total : 0, all: pack(a), brand: pack(c) };
}

/** The pixels of one 32/24/8/4/1-bit BMP picture inside an .ico (what Electron's nativeImage cannot read on macOS): {width, height, bgra} or null.
 *  `at` is the picture's offset in `bytes`. The AND mask makes pixels transparent when the picture carries no alpha of its own. */
function decodeIcoBitmap(bytes, at) {
  try {
    const header = bytes.readUInt32LE(at), width = bytes.readInt32LE(at + 4), height = Math.abs(bytes.readInt32LE(at + 8)) / 2 | 0, bpp = bytes.readUInt16LE(at + 14), compression = bytes.readUInt32LE(at + 16);
    if (header < 40 || width < 1 || width > 512 || height < 1 || height > 512 || ![1, 4, 8, 24, 32].includes(bpp) || (compression !== 0 && !(compression === 3 && bpp === 32))) return null;
    const colours = bpp <= 8 ? (bytes.readUInt32LE(at + 32) || (1 << bpp)) : 0, palette = at + header, pixels = palette + colours * 4;
    const rowBytes = ((width * bpp + 31) >> 5) << 2, maskRow = ((width + 31) >> 5) << 2, mask = pixels + rowBytes * height;
    if (mask > bytes.length) return null;
    const out = Buffer.alloc(width * height * 4);
    let anyAlpha = false;
    for (let y = 0; y < height; y++) {
      const row = pixels + rowBytes * (height - 1 - y), maskAt = mask + maskRow * (height - 1 - y);
      for (let x = 0; x < width; x++) {
        let b, g, r, a = 255;
        if (bpp === 32) { b = bytes[row + x * 4]; g = bytes[row + x * 4 + 1]; r = bytes[row + x * 4 + 2]; a = bytes[row + x * 4 + 3]; if (a) anyAlpha = true; }
        else if (bpp === 24) { b = bytes[row + x * 3]; g = bytes[row + x * 3 + 1]; r = bytes[row + x * 3 + 2]; }
        else { const index = bpp === 8 ? bytes[row + x] : bpp === 4 ? (bytes[row + (x >> 1)] >> (x & 1 ? 0 : 4)) & 15 : (bytes[row + (x >> 3)] >> (7 - (x & 7))) & 1; b = bytes[palette + index * 4]; g = bytes[palette + index * 4 + 1]; r = bytes[palette + index * 4 + 2]; }
        const o = (y * width + x) * 4; out[o] = b; out[o + 1] = g; out[o + 2] = r; out[o + 3] = a;
      }
    }
    if (bpp !== 32 || !anyAlpha) for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const bit = (bytes[mask + maskRow * (height - 1 - y) + (x >> 3)] >> (7 - (x & 7))) & 1;
      out[(y * width + x) * 4 + 3] = bit ? 0 : 255;
    }
    return { width, height, bgra: out };
  } catch { return null; }
}

/** An SVG icon's colours, by how often the file names them (fill, stroke, stop-color; #rgb, #rrggbb, rgb()): [{hex, count}] most used first, no pure black/white/none. */
function svgColours(text) {
  const counts = new Map(), add = (hex) => counts.set(hex, (counts.get(hex) || 0) + 1);
  for (const match of String(text).matchAll(/(?:fill|stroke|stop-color|color)\s*[:=]\s*["']?\s*(#[0-9a-f]{3,8}|rgb\(\s*\d+[\s,]+\d+[\s,]+\d+)/gi)) {
    const value = match[1];
    const parsed = value[0] === '#' ? fromHex(value) : (() => { const n = value.match(/\d+/g).map(Number); return [n[0], n[1], n[2], 1]; })();
    if (parsed) add(toHex(parsed.slice(0, 3)));
  }
  return [...counts.entries()].map(([hex, count]) => ({ hex, count })).sort((a, b) => b.count - a.count);
}

/** The colour the chrome should take, from competing readings: smoothing + hysteresis so a transient frame or a one-step shade change never repaints it.
 *   push(rgb, atMs, {force})  -> the colour to show now ({rgb, changed}). A reading is a candidate; it takes over only when it is more than `enter` away
 *                                (CIEDE2000) from what is shown AND the same candidate (within `same`) has been seen for `dwellMs` AND at least `minReads`
 *                                times. `force` (a navigation to another site, a theme toggle) skips the dwell but not the distance.
 *   The shown colour never goes back for a change smaller than `leave` while a candidate waits.
 * Simulation: feed it a recorded series of readings and count `changes` (the repaints a person would see). */
function createHold({ enter = 3.5, same = 2, dwellMs = 220, minReads = 2 } = {}) {
  let shown = null, candidate = null, since = 0, reads = 0, changes = 0;
  return {
    get shown() { return shown; },
    get changes() { return changes; },
    push(rgb, atMs, { force = false } = {}) {
      if (!rgb) return { rgb: shown, changed: false };
      if (!shown) { shown = rgb; changes++; return { rgb: shown, changed: true }; }
      if (deltaE(shown, rgb) <= enter) { candidate = null; reads = 0; return { rgb: shown, changed: false }; }
      if (candidate && deltaE(candidate, rgb) <= same) { reads++; } else { candidate = rgb; since = atMs; reads = 1; }
      if (force || (atMs - since >= dwellMs && reads >= minReads)) { shown = candidate; candidate = null; reads = 0; changes++; return { rgb: shown, changed: true }; }
      return { rgb: shown, changed: false };
    },
  };
}

/** Frame-by-frame glide from one colour to the next in Lab, so a change is a short fade rather than a cut: colour at t (0..1), easing in-out. */
function glide(from, to, t) {
  const u = clamp(t, 0, 1), e = u * u * (3 - 2 * u);
  return [0, 1, 2].map((i) => from[i] + (to[i] - from[i]) * e);
}

module.exports = { clamp, toHex, fromHex, over, toLab, deltaE, deltaELab, luminance, contrast, saturation, summarise, iconColours, decodeIcoBitmap, svgColours, createHold, glide };
