'use strict';
// `scripts/app-icon.mjs preview`: one PNG of the three pictures as they will look, made BEFORE anything is published, with no network and no tool outside Node: a Mac Dock tile between two system-shaped neighbours, the
// Windows taskbar sizes, the Linux launcher sizes. The pictures are drawn exactly as supplied (only scaled down for the small sizes), so a full-bleed Mac square shows as the hard square macOS 27 would draw.
const zlib = require('node:zlib');
const icon = require('../desktop/browser-services/app-icon.cjs');

const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 };
/** An 8 or 16 bit, non-interlaced PNG as {width, height, data: RGBA bytes}; null when it is another kind. */
function decodeRgba(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 33 || bytes.toString('latin1', 12, 16) !== 'IHDR') return null;
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20), depth = bytes[24], color = bytes[25];
  if (bytes[28] !== 0 || (depth !== 8 && depth !== 16) || !CHANNELS[color] || width < 1 || height < 1 || width * height > 4096 * 4096) return null;
  const idat = [];
  for (let at = 8; at + 12 <= bytes.length;) { const length = bytes.readUInt32BE(at), type = bytes.toString('latin1', at + 4, at + 8); if (type === 'IDAT') idat.push(bytes.subarray(at + 8, at + 8 + length)); if (type === 'IEND') break; at += 12 + length; }
  let raw; try { raw = zlib.inflateSync(Buffer.concat(idat)); } catch { return null; }
  const bytesPer = depth / 8, channels = CHANNELS[color], pixel = channels * bytesPer, rowBytes = width * pixel;
  if (raw.length !== height * (1 + rowBytes)) return null;
  const out = Buffer.alloc(width * height * 4); let previous = Buffer.alloc(rowBytes), row = Buffer.alloc(rowBytes);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (1 + rowBytes)], source = raw.subarray(y * (1 + rowBytes) + 1, (y + 1) * (1 + rowBytes));
    for (let i = 0; i < rowBytes; i++) {
      const left = i >= pixel ? row[i - pixel] : 0, up = previous[i], upLeft = i >= pixel ? previous[i - pixel] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left; else if (filter === 2) predictor = up; else if (filter === 3) predictor = (left + up) >> 1;
      else if (filter === 4) { const p = left + up - upLeft, pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - upLeft); predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft; } else if (filter !== 0) return null;
      row[i] = (source[i] + predictor) & 255;
    }
    for (let x = 0; x < width; x++) {
      const at = x * pixel, to = (y * width + x) * 4, sample = (c) => row[at + c * bytesPer];
      if (color === 6) { out[to] = sample(0); out[to + 1] = sample(1); out[to + 2] = sample(2); out[to + 3] = sample(3); }
      else if (color === 2) { out[to] = sample(0); out[to + 1] = sample(1); out[to + 2] = sample(2); out[to + 3] = 255; }
      else if (color === 4) { out[to] = out[to + 1] = out[to + 2] = sample(0); out[to + 3] = sample(1); }
      else { out[to] = out[to + 1] = out[to + 2] = sample(0); out[to + 3] = 255; }
    }
    [previous, row] = [row, previous];
  }
  return { width, height, data: out };
}

/** Area-average scale to `side` x `side` (premultiplied, so transparent corners do not bleed colour). */
function scale(image, side) {
  const out = Buffer.alloc(side * side * 4), ratio = image.width / side;
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
    const x0 = Math.floor(x * ratio), x1 = Math.max(x0 + 1, Math.floor((x + 1) * ratio)), y0 = Math.floor(y * ratio), y1 = Math.max(y0 + 1, Math.floor((y + 1) * ratio));
    let r = 0, g = 0, b = 0, a = 0, n = 0;
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { const at = (yy * image.width + xx) * 4, alpha = image.data[at + 3]; r += image.data[at] * alpha; g += image.data[at + 1] * alpha; b += image.data[at + 2] * alpha; a += alpha; n++; }
    const to = (y * side + x) * 4;
    if (a > 0) { out[to] = r / a; out[to + 1] = g / a; out[to + 2] = b / a; out[to + 3] = a / n; }
  }
  return { width: side, height: side, data: out };
}

class Canvas {
  constructor(width, height) { this.width = width; this.height = height; this.data = Buffer.alloc(width * height * 4); }
  blend(x, y, r, g, b, a) { if (x < 0 || y < 0 || x >= this.width || y >= this.height || a <= 0) return; const at = (y * this.width + x) * 4, f = a / 255, d = this.data; d[at] = d[at] * (1 - f) + r * f; d[at + 1] = d[at + 1] * (1 - f) + g * f; d[at + 2] = d[at + 2] * (1 - f) + b * f; d[at + 3] = 255; }
  /** A rounded rectangle, anti-aliased, filled by `paint(u, v)` -> [r, g, b, a] with u, v in 0..1 across it. */
  rounded(x, y, w, h, radius, paint) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const dx = Math.max(radius - i - 0.5, 0, i + 0.5 - (w - radius)), dy = Math.max(radius - j - 0.5, 0, j + 0.5 - (h - radius)), edge = radius - Math.hypot(dx, dy);
      const cover = Math.max(0, Math.min(1, edge + 0.5)); if (cover <= 0) continue;
      const [r, g, b, a] = paint(i / w, j / h); this.blend(x + i, y + j, r, g, b, a * cover);
    }
  }
  /** A picture, exactly as it is (scaled only to `side`). */
  picture(image, x, y, side) { const s = image.width === side ? image : scale(image, side); for (let j = 0; j < side; j++) for (let i = 0; i < side; i++) { const at = (j * side + i) * 4; this.blend(x + i, y + j, s.data[at], s.data[at + 1], s.data[at + 2], s.data[at + 3]); } }
  png() {
    const rows = Buffer.alloc(this.height * (1 + this.width * 4));
    for (let y = 0; y < this.height; y++) this.data.copy(rows, y * (1 + this.width * 4) + 1, y * this.width * 4, (y + 1) * this.width * 4);
    const chunk = (type, data) => { const body = Buffer.concat([Buffer.from(type, 'latin1'), data]), out = Buffer.alloc(12 + data.length); out.writeUInt32BE(data.length, 0); body.copy(out, 4); out.writeUInt32BE(icon.crc32(body), 8 + data.length); return out; };
    const head = Buffer.alloc(13); head.writeUInt32BE(this.width, 0); head.writeUInt32BE(this.height, 4); head[8] = 8; head[9] = 6;
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', head), chunk('IDAT', zlib.deflateSync(rows, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
  }
}
const fill = (r, g, b, a = 255) => () => [r, g, b, a];
const gradient = (top, bottom) => (u, v) => [0, 1, 2].map((c) => top[c] + (bottom[c] - top[c]) * v).concat(255);

const WIDTH = 720, HEIGHT = 470;
/** The preview of the three pictures {windows, mac, linux} (PNG bytes, already checked by the caller): {png, notes}. */
function preview(pictures) {
  const notes = [], image = (key) => { const decoded = decodeRgba(pictures[key]); if (!decoded) notes.push(`the ${key} picture could not be read for the preview`); return decoded; };
  const win = image('windows'), mac = image('mac'), lin = image('linux');
  const c = new Canvas(WIDTH, HEIGHT);
  c.rounded(0, 0, WIDTH, HEIGHT, 0, gradient([58, 66, 96], [118, 104, 138]));                         // a wallpaper-ish backdrop
  // Mac: the Dock shelf, two system-shaped neighbours (a rounded body 80 % of the tile, as the system icons have it) and ours exactly as supplied
  c.rounded(120, 40, 480, 150, 34, fill(255, 255, 255, 70));
  const tile = 128, y = 52, xs = [150, 296, 442];
  const neighbour = (x, top, bottom) => c.rounded(x + 13, y + 13, 102, 102, 24, gradient(top, bottom));
  neighbour(xs[0], [92, 170, 255], [34, 84, 210]); neighbour(xs[2], [255, 190, 96], [226, 96, 52]);
  if (mac) c.picture(mac, xs[1], y, tile);
  // Windows: a taskbar with ours at 32 and 48 px (100 % and 150 % scaling), between two neighbours
  c.rounded(0, 226, WIDTH, 64, 0, fill(24, 26, 32, 235));
  c.rounded(150, 242, 32, 32, 6, fill(120, 130, 150)); c.rounded(300, 242, 32, 32, 6, fill(150, 120, 100));
  if (win) { c.picture(win, 220, 242, 32); c.picture(win, 350, 234, 48); }
  // Linux: a launcher panel with ours at 64 and 48 px
  c.rounded(0, 316, WIDTH, 96, 0, fill(44, 46, 56, 245));
  c.rounded(150, 332, 64, 64, 14, fill(110, 150, 120)); c.rounded(430, 340, 48, 48, 10, fill(150, 110, 140));
  if (lin) { c.picture(lin, 250, 332, 64); c.picture(lin, 340, 340, 48); }
  if (mac && icon.cornersOpaque(pictures.mac) === true) notes.push('The Mac picture is a full-bleed square: macOS draws it as a hard-cornered square (the middle tile of the Dock), unlike its rounded neighbours.');
  return { png: c.png(), notes };
}

module.exports = { decodeRgba, scale, preview, WIDTH, HEIGHT };
