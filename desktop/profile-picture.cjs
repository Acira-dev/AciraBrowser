'use strict';
// A profile picture is a PNG, JPEG or WebP data URL of at most 64 KB and 256 x 256 px, read from the image header here (nothing is decoded).
const MAX_BYTES = 64 * 1024, MAX_SIDE = 256;
const DATA_URL = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/;

function pngSize(bytes) {
  if (bytes.length < 24 || bytes.readUInt32BE(0) !== 0x89504e47 || bytes.readUInt32BE(4) !== 0x0d0a1a0a || bytes.toString('latin1', 12, 16) !== 'IHDR') return null;
  return {width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20)};
}

function jpegSize(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let at = 2;
  while (at + 3 < bytes.length) {
    if (bytes[at] !== 0xff) return null;
    while (bytes[at] === 0xff && at + 1 < bytes.length) at += 1;
    const marker = bytes[at++];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (marker === 0xd9 || marker === 0xda) return null;
    if (at + 2 > bytes.length) return null;
    const length = bytes.readUInt16BE(at);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (length < 8 || at + 7 > bytes.length) return null;
      return {height: bytes.readUInt16BE(at + 3), width: bytes.readUInt16BE(at + 5)};
    }
    if (length < 2) return null;
    at += length;
  }
  return null;
}

function webpSize(bytes) {
  if (bytes.length < 30 || bytes.toString('latin1', 0, 4) !== 'RIFF' || bytes.toString('latin1', 8, 12) !== 'WEBP') return null;
  const kind = bytes.toString('latin1', 12, 16);
  if (kind === 'VP8 ') return bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a ? {width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff} : null;
  if (kind === 'VP8L') { if (bytes[20] !== 0x2f) return null; const bits = bytes.readUInt32LE(21); return {width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1}; }
  if (kind === 'VP8X') return {width: bytes.readUIntLE(24, 3) + 1, height: bytes.readUIntLE(27, 3) + 1};
  return null;
}

/** null when the value is an acceptable picture, otherwise the reason in plain words. */
function profilePictureProblem(value) {
  const reason = 'A profile picture must be a PNG, JPEG or WebP image, at most 64 KB and 256 by 256 pixels';
  if (typeof value !== 'string' || value.length > Math.ceil(MAX_BYTES / 3) * 4 + 40) return reason;
  const match = DATA_URL.exec(value);
  if (!match) return reason;
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > MAX_BYTES) return reason;
  const size = match[1] === 'png' ? pngSize(bytes) : match[1] === 'webp' ? webpSize(bytes) : jpegSize(bytes);
  if (!size || !(size.width >= 1 && size.height >= 1 && size.width <= MAX_SIDE && size.height <= MAX_SIDE)) return reason;
  return null;
}

const EMAIL = /^[^\s@<>"'`\\]{1,64}@[^\s@<>"'`\\]{1,255}\.[^\s@<>"'`\\]{2,}$/;
/** The email shown under a profile name. Display only, so this only keeps junk and markup out. */
function profileEmailProblem(value) {
  return typeof value === 'string' && value.length <= 254 && EMAIL.test(value.trim()) ? null : 'A profile email must look like name@example.com';
}

module.exports = {profilePictureProblem, profileEmailProblem, MAX_BYTES, MAX_SIDE};
