'use strict';
// Reading a site's icon file the way a tab needs it: what kind of picture it really is (from its bytes, not its label), its real pixel
// size, the best picture inside an .ico, and a bounded copy to show or keep. Pure: no network, and Electron's nativeImage is only used
// (when given) to shrink an oversized PNG or JPEG. Electron cannot read an .ico into a nativeImage on macOS (it comes back empty), which
// is why .ico files are cut apart here instead.
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_PICTURES = 64, MAX_SIDE = 128, MAX_OUT = 64 * 1024;
const TYPES = { png: 'image/png', ico: 'image/x-icon', gif: 'image/gif', jpeg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif' };

/** The kind of picture these bytes are, or null. */
function sniff(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 8) return null;
  if (bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return 'png';
  if (bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 && bytes[3] === 0 && bytes.readUInt16LE(4) > 0) return 'ico';
  if (bytes.toString('latin1', 0, 4) === 'GIF8') return 'gif';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (bytes.length >= 12 && bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  if (bytes.length >= 12 && bytes.toString('latin1', 4, 8) === 'ftyp' && /^avi[fs]$/.test(bytes.toString('latin1', 8, 12))) return 'avif';
  const head = bytes.toString('utf8', 0, Math.min(bytes.length, 2048)).replace(/^﻿/, '').trimStart();
  if (/^(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*(?:<!DOCTYPE[^>]*>\s*)?<svg[\s>]/i.test(head)) return 'svg';
  return null;
}

/** The pictures inside an .ico: [{width, height, png, offset, size, header}], or null when the directory is not sound. */
function icoPictures(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 22 || bytes.readUInt16LE(0) !== 0 || bytes.readUInt16LE(2) !== 1) return null;
  const count = bytes.readUInt16LE(4);
  if (!count || count > MAX_PICTURES || bytes.length < 6 + 16 * count) return null;
  const out = [];
  for (let index = 0; index < count; index++) {
    const at = 6 + 16 * index, size = bytes.readUInt32LE(at + 8), offset = bytes.readUInt32LE(at + 12);
    if (size < 16 || offset < 6 + 16 * count || offset + size > bytes.length) continue;
    let width = bytes[at] || 256, height = bytes[at + 1] || 256, png = false;
    if (bytes.subarray(offset, offset + 8).equals(PNG_SIGNATURE)) {
      png = true;
      if (size >= 24) { width = bytes.readUInt32BE(offset + 16); height = bytes.readUInt32BE(offset + 20); }
    } else if (bytes.readUInt32LE(offset) >= 12 && size >= 16) {
      const dibWidth = bytes.readInt32LE(offset + 4), dibHeight = Math.abs(bytes.readInt32LE(offset + 8)) / 2;
      if (dibWidth > 0 && dibWidth <= 1024) width = dibWidth;
      if (dibHeight >= 1 && dibHeight <= 1024) height = Math.round(dibHeight);
    }
    if (!(width > 0 && height > 0 && width <= 16384 && height <= 16384)) continue;
    out.push({ width, height, png, offset, size, header: bytes.subarray(at, at + 16) });
  }
  return out.length ? out : null;
}

/** An .ico that holds just this one picture (what a tab needs: the browser draws it without choosing between sizes). */
function icoWith(bytes, picture) {
  const out = Buffer.alloc(22 + picture.size);
  out.writeUInt16LE(0, 0); out.writeUInt16LE(1, 2); out.writeUInt16LE(1, 4);
  picture.header.copy(out, 6); out.writeUInt32LE(22, 18);
  bytes.copy(out, 22, picture.offset, picture.offset + picture.size);
  return out;
}

/** Pictures of an .ico in the order they are worth trying for a place `need` device pixels wide: the smallest that is big enough,
 *  then bigger ones, then the biggest of the small ones. */
function icoPreference(pictures, need) {
  const side = (picture) => Math.max(picture.width, picture.height);
  const enough = pictures.filter((picture) => side(picture) >= need).sort((a, b) => side(a) - side(b) || Number(b.png) - Number(a.png));
  const small = pictures.filter((picture) => side(picture) < need).sort((a, b) => side(b) - side(a));
  return [...enough, ...small];
}

function pngSize(bytes) {
  return bytes.length >= 24 && bytes.toString('latin1', 12, 16) === 'IHDR' ? { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) } : null;
}
function gifSize(bytes) { return bytes.length >= 10 ? { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) } : null; }
function jpegSize(bytes) {
  let at = 2;
  while (at + 9 < bytes.length) {
    if (bytes[at] !== 0xff) { at++; continue; }
    const marker = bytes[at + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { at += 2; continue; }
    const length = bytes.readUInt16BE(at + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { height: bytes.readUInt16BE(at + 5), width: bytes.readUInt16BE(at + 7) };
    at += 2 + length;
  }
  return null;
}
function webpSize(bytes) {
  const kind = bytes.toString('latin1', 12, 16);
  if (kind === 'VP8X' && bytes.length >= 30) return { width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) };
  if (kind === 'VP8 ' && bytes.length >= 30) return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
  if (kind === 'VP8L' && bytes.length >= 25) { const bits = bytes.readUInt32LE(21); return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) }; }
  return null;
}

/** {kind, width, height, vector} for an icon file, or null when it is not a picture we know. A vector (SVG) has no fixed size
 *  (width and height are 0) and is sharp at any size. An .ico reports its biggest picture. */
function inspect(bytes) {
  const kind = sniff(bytes);
  if (!kind) return null;
  if (kind === 'svg') return { kind, width: 0, height: 0, vector: true };
  let size = null;
  if (kind === 'png') size = pngSize(bytes);
  else if (kind === 'gif') size = gifSize(bytes);
  else if (kind === 'jpeg') size = jpegSize(bytes);
  else if (kind === 'webp') size = webpSize(bytes);
  else if (kind === 'ico') {
    const pictures = icoPictures(bytes);
    if (!pictures) return null;
    const biggest = pictures.reduce((best, picture) => (Math.max(picture.width, picture.height) > Math.max(best.width, best.height) ? picture : best));
    size = { width: biggest.width, height: biggest.height };
  }
  if (kind !== 'avif' && !(size && size.width > 0 && size.height > 0)) return null;
  return { kind, width: size ? size.width : 0, height: size ? size.height : 0, vector: false };
}

const sideOf = (info) => Math.max(info.width, info.height);

/** Shrinks a PNG or JPEG so its longer side is at most `side`; the PNG that comes back, or null when that cannot be done. */
function shrink(bytes, side, nativeImage) {
  try {
    const image = nativeImage && nativeImage.createFromBuffer(bytes);
    if (!image || image.isEmpty()) return null;
    const { width, height } = image.getSize();
    if (!(width > 0 && height > 0)) return null;
    const resized = image.resize(width >= height ? { width: side, quality: 'best' } : { height: side, quality: 'best' });
    const png = resized.toPNG();
    return png && png.length ? { bytes: png, ...(resized.getSize ? resized.getSize() : { width: side, height: side }) } : null;
  } catch { return null; }
}

/** An icon file made ready to show or keep: {type, bytes, data (a data: URL), width, height, vector}, or null when it is not a usable picture.
 *   need     the device pixels of the biggest place it is drawn (picks the picture of an .ico; default 48)
 *   maxSide  a PNG or JPEG bigger than this is shrunk to it (needs nativeImage); default 128
 *   maxOut   the most bytes kept; default 64 KB
 * Nothing is redrawn when the file already fits: the bytes the site sent are the bytes kept, except an .ico, which is cut down to the one
 * picture (stored as a PNG when that picture is one). */
function normalizeIcon({ bytes, need = 48, maxSide = MAX_SIDE, maxOut = MAX_OUT, nativeImage = null } = {}) {
  const info = inspect(bytes);
  if (!info) return null;
  const finish = (type, body, width, height, vector = false) => ({ type, bytes: body, data: `data:${type};base64,${body.toString('base64')}`, width, height, vector });
  const fits = (body, width, height) => body.length <= maxOut && Math.max(width, height) <= maxSide;
  const fromRaster = (kind, body, width, height) => {
    if (fits(body, width, height)) return finish(TYPES[kind], body, width, height);
    if (kind === 'png' || kind === 'jpeg') {
      for (const side of [maxSide, 96, 64]) {
        if (side > maxSide) continue;
        const small = shrink(body, Math.min(side, Math.max(width, height)), nativeImage);
        if (small && small.bytes.length <= maxOut) return finish('image/png', small.bytes, small.width, small.height);
      }
    }
    return null;
  };
  if (info.kind === 'svg') {
    const text = bytes.toString('utf8').replace(/^﻿/, '');
    return bytes.length <= maxOut ? finish(TYPES.svg, Buffer.from(text, 'utf8'), 0, 0, true) : null;
  }
  if (info.kind === 'ico') {
    for (const picture of icoPreference(icoPictures(bytes), need)) {
      const body = bytes.subarray(picture.offset, picture.offset + picture.size);
      const made = picture.png ? fromRaster('png', Buffer.from(body), picture.width, picture.height) : (() => { const ico = icoWith(bytes, picture); return fits(ico, picture.width, picture.height) ? finish(TYPES.ico, ico, picture.width, picture.height) : null; })();
      if (made) return made;
    }
    return null;
  }
  return fromRaster(info.kind, bytes, info.width, info.height);
}

module.exports = { sniff, inspect, icoPictures, icoWith, icoPreference, normalizeIcon, sideOf, TYPES, MAX_SIDE, MAX_OUT };
