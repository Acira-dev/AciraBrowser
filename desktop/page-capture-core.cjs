'use strict';
// Beta 14 section R (screenshot of the page): the parts of the capture that need no Electron, so they can be tested alone.
//  - planFullPage: how a tall page is cut into slices that join without a seam at any display scale, and where the size limit stops it
//  - encodePng: a PNG of the slices put one under the other, written without holding the whole picture twice and without blocking the main process
//  - the file name, the kinds and their order (the kind used last comes first)
const zlib = require('node:zlib');

/** The size limit of a full-page picture. One piece of a page is never taller than SLICE_PIXELS device pixels (a GPU texture and a renderer's
 * capture buffer stay small), the whole picture never taller than MAX_HEIGHT_PIXELS or larger than MAX_PIXELS. Past that the top of the page is saved and the
 * person is told what was left out (page-capture.cjs). */
const LIMITS = Object.freeze({ SLICE_PIXELS: 4096, MAX_HEIGHT_PIXELS: 32768, MAX_PIXELS: 100_000_000 });

const KINDS = Object.freeze(['area', 'visible', 'full']);
const isKind = value => KINDS.includes(value);
/** The three kinds, the one used last first (it is what Enter picks in the menu). */
const orderedKinds = last => (isKind(last) ? [last, ...KINDS.filter(kind => kind !== last)] : [...KINDS]);

/** Whole CSS pixels that are a whole number of device pixels at this display scale (1 at 100 %, 4 at 125 %, 2 at 150 %): a slice boundary on such a
 * row is a device-pixel row too, so two slices meet exactly. */
function wholeStep(scale) {
  const dpr = Number.isFinite(scale) && scale > 0 ? scale : 1;
  for (let step = 1; step <= 40; step++) { const px = step * dpr; if (Math.abs(px - Math.round(px)) < 1e-6) return step; }
  return 1;
}

/** Cut a page of `cssWidth` x `cssHeight` CSS pixels at display scale `scale` into slices from the top.
 * Returns {slices:[{y, height}] (CSS pixels, y and height whole), savedHeight (CSS pixels), truncated, deviceWidth, deviceHeight (of what is saved), pageDeviceHeight, reason}.
 * `reason` is 'height' or 'pixels' when the page is cut at the limit. */
function planFullPage({ cssWidth, cssHeight, scale = 1, limits = LIMITS } = {}) {
  const dpr = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const width = Math.max(1, Math.ceil(Number(cssWidth) || 0)), height = Math.max(1, Math.ceil(Number(cssHeight) || 0));
  const step = wholeStep(dpr), deviceWidth = Math.max(1, Math.round(width * dpr));
  const byPixels = Math.floor(limits.MAX_PIXELS / deviceWidth), maxDevice = Math.min(limits.MAX_HEIGHT_PIXELS, byPixels);
  const reason = limits.MAX_HEIGHT_PIXELS <= byPixels ? 'height' : 'pixels';
  const maxCss = Math.max(step, Math.floor(maxDevice / dpr / step) * step);
  const truncated = height > maxCss, savedHeight = truncated ? maxCss : height;
  const slice = Math.max(step, Math.floor(limits.SLICE_PIXELS / dpr / step) * step), slices = [];
  for (let y = 0; y < savedHeight; y += slice) slices.push({ y, height: Math.min(slice, savedHeight - y) });
  return { slices, savedHeight, truncated, ...(truncated ? { reason } : {}), cssWidth: width, deviceWidth, deviceHeight: Math.round(savedHeight * dpr), pageDeviceHeight: Math.round(height * dpr), step };
}

// ---- PNG, written by hand: slices of raw 8-bit RGBA rows -> one file ----
const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0); out.write(type, 4, 'ascii'); data.copy(out, 8);
  out.writeUInt32BE(zlib.crc32(out.subarray(4, 8 + data.length)) >>> 0, 8 + data.length);
  return out;
}
/** A slice's bytes as Chromium's bitmaps give them (blue, green, red, alpha) turned into the order PNG wants (red, green, blue, alpha), in place. */
function bgraToRgba(buffer) {
  const words = new Uint32Array(buffer.buffer, buffer.byteOffset, buffer.length >>> 2);
  for (let i = 0; i < words.length; i++) { const v = words[i]; words[i] = ((v & 0xff00ff00) | ((v >>> 16) & 0xff) | ((v & 0xff) << 16)) >>> 0; }
  return buffer;
}
const tick = () => new Promise(resolve => setImmediate(resolve));
/** `slices` is an array (or an async generator) of {width, height, data: Buffer of RGBA rows, tightly packed}; all of one width. The compression runs on the
 * thread pool; between slices the main thread is let go. Resolves with the PNG file as a Buffer. */
async function encodePng(slices, { level = 3 } = {}) {
  const parts = [], deflate = zlib.createDeflate({ level, chunkSize: 1 << 20 });
  const done = new Promise((resolve, reject) => { deflate.on('data', piece => parts.push(piece)); deflate.on('end', resolve); deflate.on('error', reject); });
  let width = 0, height = 0;
  for await (const part of slices) {
    if (!width) width = part.width; else if (part.width !== width) throw new Error('Screenshot pieces differ in width.');
    if (part.data.length !== part.width * part.height * 4) throw new Error('Screenshot piece is not RGBA of its size.');
    const row = width * 4;
    for (let y = 0; y < part.height; y += 256) {
      const rows = Math.min(256, part.height - y), band = Buffer.allocUnsafe(rows * (row + 1));   // a new buffer each time: the stream keeps the one it was given until it has compressed it
      for (let r = 0; r < rows; r++) { band[r * (row + 1)] = 0; part.data.copy(band, r * (row + 1) + 1, (y + r) * row, (y + r + 1) * row); }
      if (!deflate.write(band)) await new Promise(resolve => deflate.once('drain', resolve));
    }
    height += part.height; await tick();
  }
  if (!width || !height) throw new Error('Nothing to write.');
  deflate.end(); await done;
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;   // 8 bit, colour type 6 (RGBA), no interlace
  return Buffer.concat([SIGNATURE, chunk('IHDR', header), chunk('IDAT', Buffer.concat(parts)), chunk('IEND', Buffer.alloc(0))]);
}

const two = value => String(value).padStart(2, '0');
/** `Acira screenshot 2026-11-13 at 15.42.07.png` (the local time, the brief's own name). */
function screenshotName(date = new Date()) {
  return `Acira screenshot ${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} at ${two(date.getHours())}.${two(date.getMinutes())}.${two(date.getSeconds())}.png`;
}

/** Is this file name one a page screenshot was saved under? `Acira screenshot 2026-11-13 at 15.42.07.png`, or with the " (1)" the downloads folder adds when the name is taken. Easy Files (Beta 14) offers these first. */
const SCREENSHOT_NAME = /^Acira screenshot \d{4}-\d{2}-\d{2} at \d{2}\.\d{2}\.\d{2}(?: \(\d+\))?\.png$/;
const isScreenshotName = name => typeof name === 'string' && SCREENSHOT_NAME.test(name);

module.exports = { LIMITS, KINDS, isKind, orderedKinds, wholeStep, planFullPage, encodePng, bgraToRgba, screenshotName, isScreenshotName };
