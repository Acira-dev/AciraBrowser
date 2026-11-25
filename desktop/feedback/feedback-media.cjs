'use strict';
// Beta 14: the pictures and the one video a report may carry. Up to 3 images (5 MB each) and 1 video (60 s, 25 MB). Everything is decided here from
// the bytes, never from a file name or a type the page claimed: the kind comes from the file's own first bytes, the video's length from its own header.
// Nothing about the file's origin leaves: the name sent is made up ("image-1.png"), and the hidden data a picture can carry (a camera's position and
// time, an editor's notes) is cut out of PNG, JPEG, WebP and GIF files before anything is shown or sent, so the preview is the file that goes.
// A video is sent as it is (its header cannot be rewritten without breaking it); the person previews it and the pop-up says to check it.
const crypto = require('node:crypto');

const LIMITS = Object.freeze({ images: 3, videos: 1, imageBytes: 5 * 1024 * 1024, videoBytes: 25 * 1024 * 1024, videoSeconds: 60 });
const TYPES = Object.freeze({ png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', mp4: 'video/mp4', webm: 'video/webm' });
const EXTENSION = Object.freeze({ png: 'png', jpeg: 'jpg', webp: 'webp', gif: 'gif', mp4: 'mp4', webm: 'webm' });

/** 'png' | 'jpeg' | 'webp' | 'gif' | 'mp4' | 'webm' from the file's first bytes, or null. (QuickTime .mov files are the MP4 family: 'ftyp' first.) */
function sniff(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 12) return null;
  if (bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return 'png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  if (bytes.toString('latin1', 0, 6) === 'GIF87a' || bytes.toString('latin1', 0, 6) === 'GIF89a') return 'gif';
  if (bytes.toString('latin1', 4, 8) === 'ftyp') return 'mp4';
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return 'webm';
  return null;
}
const isVideo = (type) => type === 'mp4' || type === 'webm';

// --- hidden data out of pictures ---------------------------------------------------------------------------------------------------------------
/** PNG: only the chunks a picture needs are kept (an allow-list); text, Exif, time, signer and every unknown ancillary chunk go, and nothing after the end chunk. */
const PNG_KEEP = new Set(['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND', 'gAMA', 'cHRM', 'sRGB', 'iCCP', 'sBIT', 'bKGD', 'pHYs', 'acTL', 'fcTL', 'fdAT']);
function stripPng(bytes) {
  const out = [bytes.subarray(0, 8)];
  let at = 8, ended = false;
  while (at + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(at), name = bytes.toString('latin1', at + 4, at + 8), end = at + 12 + length;
    if (end > bytes.length) return null;
    if (PNG_KEEP.has(name)) out.push(bytes.subarray(at, end));
    at = end;
    if (name === 'IEND') { ended = true; break; }
  }
  return ended ? Buffer.concat(out) : null; // a picture cut off before its end is not a picture
}
/** JPEG: an allow-list of what draws the picture (frame, tables, restart interval, the scans), the JFIF header without its thumbnail, an ICC colour profile and Adobe's colour flag.
 * Exif, XMP, Photoshop and C2PA segments, comments, other thumbnails and everything after the end marker (a cropped picture's old data, a motion photo's video) are gone. */
function stripJpeg(bytes) {
  const out = [bytes.subarray(0, 2)];
  let at = 2, ended = false, scans = 0;
  const kept = (marker, data) => {
    if ((marker >= 0xc0 && marker <= 0xcf) || marker === 0xdb || marker === 0xdd || marker === 0xdc) return true; // frame, DHT/DAC, DQT, DRI, DNL
    if (marker === 0xe0 && data.toString('latin1', 0, 5) === 'JFIF\0' && data.length >= 14) { const head = Buffer.from([0xff, 0xe0, 0x00, 0x10]); const body = Buffer.from(data.subarray(0, 14)); body[12] = 0; body[13] = 0; return Buffer.concat([head, body]); }
    if (marker === 0xe2 && data.toString('latin1', 0, 12) === 'ICC_PROFILE\0') return true;
    if (marker === 0xee && data.toString('latin1', 0, 5) === 'Adobe') return true;
    return false;
  };
  while (at + 2 <= bytes.length) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1];
    if (marker === 0xff) { at += 1; continue; }                        // fill byte
    if (marker === 0xd9) { out.push(Buffer.from([0xff, 0xd9])); ended = true; break; }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) { at += 2; continue; } // markers with no length outside a scan
    if (at + 4 > bytes.length) return null;
    const length = bytes.readUInt16BE(at + 2), end = at + 2 + length;
    if (length < 2 || end > bytes.length) return null;
    if (marker === 0xda) {                                              // a scan: its header and its entropy-coded data up to the next real marker
      let i = end;
      while (i + 1 < bytes.length) {
        if (bytes[i] === 0xff) { const next = bytes[i + 1]; if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) { i += 2; continue; } if (next === 0xff) { i += 1; continue; } break; }
        i += 1;
      }
      if (i + 1 >= bytes.length) return null;                           // no end marker: cut off
      out.push(bytes.subarray(at, i)); at = i; scans += 1; continue;
    }
    const keep = kept(marker, bytes.subarray(at + 4, end));
    if (keep) out.push(keep === true ? bytes.subarray(at, end) : keep);
    at = end;
  }
  return ended && scans > 0 ? Buffer.concat(out) : null;
}
const WEBP_KEEP = new Set(['VP8 ', 'VP8L', 'VP8X', 'ALPH', 'ANIM', 'ANMF', 'ICCP']);
function stripWebp(bytes) {
  const out = [];
  let at = 12;
  while (at + 8 <= bytes.length) {
    const name = bytes.toString('latin1', at, at + 4), size = bytes.readUInt32LE(at + 4), padded = size + (size & 1), end = at + 8 + padded;
    if (end > bytes.length) return null;
    if (WEBP_KEEP.has(name)) out.push(bytes.subarray(at, end));
    at = end;
  }
  if (at !== bytes.length || bytes.readUInt32LE(4) + 8 !== bytes.length) return null; // cut off, or longer than it says
  const body = Buffer.concat(out), header = Buffer.alloc(12);
  header.write('RIFF', 0, 'latin1'); header.writeUInt32LE(body.length + 4, 4); header.write('WEBP', 8, 'latin1');
  const whole = Buffer.concat([header, body]);
  // A VP8X header says which hidden chunks exist (bit 3: EXIF, bit 2: XMP); they are gone, so the flags go too.
  if (whole.toString('latin1', 12, 16) === 'VP8X') whole[20] &= ~0x0c;
  return whole;
}
function stripGif(bytes) {
  // Comment (0xFE) and application (0xFF, except the looping one) extensions go; frames and timing stay.
  const out = [bytes.subarray(0, 6)];
  let at = 6, ended = false;
  if (at + 7 > bytes.length) return null;
  const flags = bytes[at + 4], tableSize = flags & 0x80 ? 3 * (1 << ((flags & 7) + 1)) : 0;
  out.push(bytes.subarray(at, at + 7 + tableSize));
  at += 7 + tableSize;
  const skipBlocks = (from) => { let i = from; while (i < bytes.length && bytes[i] !== 0) i += bytes[i] + 1; return i + 1; };
  while (at < bytes.length) {
    const block = bytes[at];
    if (block === 0x3b) { out.push(bytes.subarray(at, at + 1)); at += 1; ended = true; break; }
    if (block === 0x21) {
      const label = bytes[at + 1], end = skipBlocks(at + 2);
      if (end > bytes.length) return null;
      const looping = label === 0xff && bytes.toString('latin1', at + 3, at + 14) === 'NETSCAPE2.0';
      if (label === 0xf9 || (label === 0xff && looping)) out.push(bytes.subarray(at, end));
      at = end;
    } else if (block === 0x2c) {
      if (at + 10 > bytes.length) return null;
      const local = bytes[at + 9], localTable = local & 0x80 ? 3 * (1 << ((local & 7) + 1)) : 0, end = skipBlocks(at + 10 + localTable + 1);
      if (end > bytes.length) return null;
      out.push(bytes.subarray(at, end));
      at = end;
    } else return null;
  }
  return ended ? Buffer.concat(out) : null;
}
/** The picture without its hidden data, or null when it is not a well-formed file of that kind (then it is not used). */
function stripHidden(bytes, type) {
  try {
    const stripped = type === 'png' ? stripPng(bytes) : type === 'jpeg' ? stripJpeg(bytes) : type === 'webp' ? stripWebp(bytes) : type === 'gif' ? stripGif(bytes) : null;
    return stripped && stripped.length > 0 ? stripped : null;
  } catch { return null; }
}

// --- a video's length from its own header ------------------------------------------------------------------------------------------------------
/** Seconds from an MP4 / QuickTime file's 'mvhd' box (found by walking the top-level boxes, jumping over the media data), or null. */
function mp4Seconds(bytes) {
  const walk = (from, to, wanted) => {
    let at = from;
    while (at + 8 <= to) {
      let size = bytes.readUInt32BE(at), header = 8;
      const name = bytes.toString('latin1', at + 4, at + 8);
      if (size === 1) { if (at + 16 > to) return null; size = Number(bytes.readBigUInt64BE(at + 8)); header = 16; } else if (size === 0) size = to - at;
      if (size < header || at + size > to) return null;
      if (name === wanted[0]) return wanted.length === 1 ? { at: at + header, end: at + size } : walk(at + header, at + size, wanted.slice(1));
      at += size;
    }
    return null;
  };
  const box = walk(0, bytes.length, ['moov', 'mvhd']);
  if (!box) return null;
  const version = bytes[box.at];
  let timescale, duration;
  if (version === 1 && box.at + 32 <= box.end) { timescale = bytes.readUInt32BE(box.at + 20); duration = Number(bytes.readBigUInt64BE(box.at + 24)); }
  else if (version === 0 && box.at + 20 <= box.end) { timescale = bytes.readUInt32BE(box.at + 12); duration = bytes.readUInt32BE(box.at + 16); }
  else return null;
  return timescale > 0 ? duration / timescale : null;
}
/** Seconds from a WebM file's Segment > Info > Duration (a file with none, as a live recording often is, has no known length: null). */
function webmSeconds(bytes) {
  const vint = (at, keepMarker) => {
    const first = bytes[at];
    if (!first) return null;
    let length = 1, mask = 0x80;
    while (length <= 8 && !(first & mask)) { length += 1; mask >>= 1; }
    if (length > 8 || at + length > bytes.length) return null;
    let value = keepMarker ? first : first & (mask - 1), unknown = (first & (mask - 1)) === mask - 1;
    for (let i = 1; i < length; i++) { value = value * 256 + bytes[at + i]; if (bytes[at + i] !== 0xff) unknown = false; }
    return { value, length, unknown };
  };
  const find = (from, to, path) => {
    let at = from;
    while (at < to) {
      const id = vint(at, true); if (!id) return null;
      const size = vint(at + id.length, false); if (!size) return null;
      const start = at + id.length + size.length, end = size.unknown ? to : Math.min(to, start + size.value);
      if (id.value === path[0]) return path.length === 1 ? { start, end } : find(start, end, path.slice(1));
      at = end;
    }
    return null;
  };
  const info = find(0, bytes.length, [0x18538067, 0x1549a966]);
  if (!info) return null;
  let scale = 1000000, duration = null, at = info.start;
  while (at < info.end) {
    const id = vint(at, true), size = id && vint(at + id.length, false); if (!size || size.unknown) break;
    const start = at + id.length + size.length, end = start + size.value; if (end > info.end) break;
    if (id.value === 0x2ad7b1) { scale = 0; for (let i = start; i < end; i++) scale = scale * 256 + bytes[i]; }
    else if (id.value === 0x4489) duration = size.value === 4 ? bytes.readFloatBE(start) : size.value === 8 ? bytes.readDoubleBE(start) : null;
    at = end;
  }
  return duration !== null && scale > 0 ? (duration * scale) / 1e9 : null;
}
const videoSeconds = (bytes, type) => (type === 'mp4' ? mp4Seconds(bytes) : type === 'webm' ? webmSeconds(bytes) : null);

// --- one attachment, and the set ---------------------------------------------------------------------------------------------------------------
/** Checks one file's bytes. {ok:true, record, bytes} (bytes: what will be sent: pictures without hidden data) or {ok:false, reason}: 'empty' | 'type' | 'size' | 'unreadable' | 'length' (a video over 60 s) | 'unknown-length'. */
function inspect(input) {
  if (!Buffer.isBuffer(input) || input.length === 0) return { ok: false, reason: 'empty' };
  const type = sniff(input);
  if (!type) return { ok: false, reason: 'type' };
  const video = isVideo(type);
  if (input.length > (video ? LIMITS.videoBytes : LIMITS.imageBytes)) return { ok: false, reason: 'size' };
  let bytes = input, seconds = null;
  if (video) {
    seconds = videoSeconds(input, type);
    if (seconds === null || !Number.isFinite(seconds)) return { ok: false, reason: 'unknown-length' };
    if (seconds > LIMITS.videoSeconds + 0.5) return { ok: false, reason: 'length' };
  } else {
    bytes = stripHidden(input, type);
    if (!bytes) return { ok: false, reason: 'unreadable' };
  }
  return { ok: true, bytes, record: { kind: video ? 'video' : 'image', format: type, type: TYPES[type], bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), ...(video ? { seconds: Math.round(seconds * 10) / 10 } : {}) } };
}

/** Whether another file of this kind fits next to the ones already chosen ({images, videos} counts). */
const fits = (record, counts) => (record.kind === 'video' ? counts.videos < LIMITS.videos : counts.images < LIMITS.images);
/** The names that go out: made up, numbered, with the right extension. */
const sentName = (record, indexOfKind) => `${record.kind}-${indexOfKind + 1}.${EXTENSION[record.format]}`;

module.exports = { LIMITS, TYPES, sniff, isVideo, stripHidden, mp4Seconds, webmSeconds, inspect, fits, sentName };
