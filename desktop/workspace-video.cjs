'use strict';
// Beta 14.4 (reported 24 Nov 00:15: "live wallpapers ... people can actually put videos in there as a background"): the person's OWN video behind
// the New Tab. One video per profile, kept beside the own images (desktop/workspace-artwork.cjs: the same per-profile folder), copied under a random
// id; the path to the original is never kept. The interface checks that this engine can play it (it decodes the first frame, src/ui/videoProbe.ts),
// saves that frame as the still the New Tab shows at once, and only then is the video committed. Served with byte ranges (a video element seeks).
// Keep this file ASCII only (main's script text stays one byte per character).
const fs = require('node:fs'), path = require('node:path'), { randomUUID } = require('node:crypto');
const { Readable } = require('node:stream');

const MAX_VIDEO_BYTES = 200 * 1024 * 1024, MAX_LONG_SIDE = 3840, MAX_SHORT_SIDE = 2160, MAX_STILL_BYTES = 2 * 1024 * 1024, STILL_WIDTH = 1920, PROBE_BYTES = 4 * 1024 * 1024;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const KINDS = { mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm' };
const EXTENSIONS = Object.keys(KINDS);

const hex2 = value => value.toString(16).padStart(2, '0');
/** The codec of the first video track, from the container's own boxes (enough to ask the engine whether it decodes it efficiently; the engine's
 * own decode of the first frame is the real check). Pure: `head` and `tail` are the first and last bytes of the file. */
function sniffVideo(head, tail = Buffer.alloc(0)) {
  if (!Buffer.isBuffer(head) || head.length < 12) return null;
  const both = Buffer.concat([head, tail]);
  if (head.readUInt32BE(0) === 0x1a45dfa3) {
    // Matroska / WebM: the EBML DocType and the track's CodecID are plain strings
    if (!both.includes('webm')) return null;
    if (both.includes('V_VP9')) return { container: 'webm', mime: 'video/webm', codec: 'vp09.00.10.08' };
    if (both.includes('V_AV1')) return { container: 'webm', mime: 'video/webm', codec: 'av01.0.08M.08' };
    if (both.includes('V_VP8')) return { container: 'webm', mime: 'video/webm', codec: 'vp8' };
    return null;
  }
  if (head.toString('latin1', 4, 8) !== 'ftyp') return null;
  const brand = head.toString('latin1', 8, 12), container = brand === 'qt  ' ? 'mov' : 'mp4', mime = container === 'mov' ? 'video/quicktime' : 'video/mp4';
  const box = name => { const at = both.indexOf(name, 0, 'latin1'); return at < 4 ? null : both.subarray(at + 4, Math.min(both.length, at + 64)); };
  let body;
  if ((body = box('avcC')) && body.length >= 4) return { container, mime, codec: 'avc1.' + hex2(body[1]) + hex2(body[2]) + hex2(body[3]) };
  if ((body = box('hvcC')) && body.length >= 13) { const profile = body[1] & 0x1f, tier = body[1] & 0x20 ? 'H' : 'L'; return { container, mime, codec: `hvc1.${profile || 1}.6.${tier}${body[12] || 93}.B0` }; }
  if ((body = box('av1C')) && body.length >= 4) { const profile = body[1] >> 5, level = body[1] & 0x1f, tier = body[2] & 0x80 ? 'H' : 'M', depth = body[2] & 0x40 ? (body[2] & 0x20 ? 12 : 10) : 8; return { container, mime, codec: `av01.${profile}.${String(level).padStart(2, '0')}${tier}.${String(depth).padStart(2, '0')}` }; }
  if ((body = box('vpcC')) && body.length >= 7) { const profile = body[4], level = body[5], depth = body[6] >> 4; return { container, mime, codec: `vp09.${hex2(profile)}.${String(level || 10).padStart(2, '0')}.${String(depth || 8).padStart(2, '0')}` }; }
  return null;
}

/** Whether the size the engine reports is one Acira keeps: up to 3840 x 2160 either way round. Pure. */
const sizeAllowed = (width, height) => Number.isSafeInteger(width) && Number.isSafeInteger(height) && width > 0 && height > 0 && Math.max(width, height) <= MAX_LONG_SIDE && Math.min(width, height) <= MAX_SHORT_SIDE;

/** A byte range request (`bytes=a-b`, `bytes=a-`, `bytes=-n`) against a file of `size` bytes. Null when there is none or it cannot be served. Pure. */
function parseRange(header, size) {
  if (typeof header !== 'string' || !header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (!match[1] && !match[2])) return null;
  let start, end;
  if (!match[1]) { const length = Number(match[2]); if (!length) return null; start = Math.max(0, size - length); end = size - 1; }
  else { start = Number(match[1]); end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1; }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) return null;
  return { start, end };
}

function createProfileVideo({ directory, nativeImage, onChange = () => {} }) {
  const index = path.join(directory, 'video.json');
  let video = null, pending = null;
  const plainFile = file => { try { const stat = fs.lstatSync(file); return stat.isFile() && !stat.isSymbolicLink() ? stat : null; } catch { return null; } };
  const fileOf = entry => path.join(directory, entry.id + '.' + entry.ext), stillOf = entry => path.join(directory, entry.id + '-still.jpg');
  try {
    const stat = plainFile(index);
    if (stat && stat.size <= 8192) {
      const raw = JSON.parse(fs.readFileSync(index, 'utf8'))?.video;
      if (raw && UUID.test(raw.id) && EXTENSIONS.includes(raw.ext) && Number.isSafeInteger(raw.bytes) && raw.bytes > 0 && raw.bytes <= MAX_VIDEO_BYTES && sizeAllowed(raw.width, raw.height)) {
        const entry = { id: raw.id, ext: raw.ext, mime: KINDS[raw.ext], name: typeof raw.name === 'string' ? raw.name.slice(0, 100) : 'Video', codec: typeof raw.codec === 'string' ? raw.codec.slice(0, 40) : '', bytes: raw.bytes, width: raw.width, height: raw.height, duration: Number.isFinite(raw.duration) ? raw.duration : 0, powerEfficient: raw.powerEfficient === true, stillBytes: raw.stillBytes };
        if (plainFile(fileOf(entry))?.size === entry.bytes && plainFile(stillOf(entry))?.size === entry.stillBytes) video = entry;
      }
    }
  } catch { video = null; }
  // a copy left by a check that never finished (the app closed while it ran): only video files and stills named by an id, never anything else
  try { for (const name of fs.readdirSync(directory)) { const match = /^([a-f0-9-]{36})(?:\.(?:mp4|m4v|mov|webm)|-still\.jpg)$/.exec(name); if (match && UUID.test(match[1]) && match[1] !== video?.id && plainFile(path.join(directory, name))) fs.unlinkSync(path.join(directory, name)); } } catch { /* nothing to clear */ }
  const save = () => {
    const temporary = path.join(directory, 'video-' + randomUUID() + '.tmp');
    try { fs.writeFileSync(temporary, JSON.stringify({ version: 1, video }), { flag: 'wx' }); fs.renameSync(temporary, index); }
    finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  };
  const drop = entry => { for (const file of [fileOf(entry), stillOf(entry)]) if (plainFile(file)) try { fs.unlinkSync(file); } catch {} };
  const readEnds = (file, size) => {
    const handle = fs.openSync(file, 'r');
    try {
      const head = Buffer.alloc(Math.min(PROBE_BYTES, size)); fs.readSync(handle, head, 0, head.length, 0);
      const tailLength = Math.max(0, Math.min(PROBE_BYTES, size - head.length)), tail = Buffer.alloc(tailLength);
      if (tailLength) fs.readSync(handle, tail, 0, tailLength, size - tailLength);
      return { head, tail };
    } finally { fs.closeSync(handle); }
  };
  return {
    info: () => video,
    pending: () => pending,
    /** Copies one chosen file in as a PENDING video: a plain file (no link, no folder), MP4 / MOV / WebM by its own boxes, up to 200 MB. */
    add(source) {
      const ext = path.extname(String(source)).slice(1).toLowerCase(), stat = plainFile(source);
      if (!stat || !EXTENSIONS.includes(ext)) throw Error('Choose an MP4, MOV or WebM video.');
      if (stat.size > MAX_VIDEO_BYTES) throw Error('Choose a video up to 200 MB.');
      if (!stat.size) throw Error('This video is empty.');
      const { head, tail } = readEnds(source, stat.size), kind = sniffVideo(head, tail);
      if (!kind) throw Error("This video can't be played. Try an MP4 (H.264) or WebM file.");
      if (pending) this.discard(pending.id);
      const id = randomUUID(), entry = { id, ext: kind.container === 'webm' ? 'webm' : kind.container === 'mov' ? 'mov' : 'mp4', mime: kind.mime, codec: kind.codec, bytes: stat.size, name: path.basename(String(source).replaceAll('\\', '/')).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 100) || 'Video' };
      fs.copyFileSync(source, fileOf(entry), fs.constants.COPYFILE_EXCL);
      if (plainFile(fileOf(entry))?.size !== entry.bytes) { drop(entry); throw Error('The video could not be copied. Choose it again.'); }
      pending = entry;
      return entry;
    },
    /** The interface played the pending video's first frame: keep its still and make it THE video of this profile (the one before it goes). */
    commit({ id, still, width, height, duration, powerEfficient }) {
      if (!pending || pending.id !== id) throw Error('This video is no longer waiting to be added.');
      if (!sizeAllowed(width, height)) { this.discard(id); throw Error('Choose a video up to 3840 x 2160.'); }
      const bytes = Buffer.isBuffer(still) ? still : Buffer.from(String(still || ''), 'base64');
      const image = bytes.length && bytes.length <= MAX_STILL_BYTES ? nativeImage.createFromBuffer(bytes) : null;
      if (!image || image.isEmpty()) { this.discard(id); throw Error("This video can't be played. Try an MP4 (H.264) or WebM file."); }
      const size = image.getSize(), output = (size.width > STILL_WIDTH ? image.resize({ width: STILL_WIDTH, quality: 'best' }) : image).toJPEG(86);
      const entry = { ...pending, width, height, duration: Number.isFinite(duration) && duration > 0 ? Math.min(duration, 86400) : 0, powerEfficient: powerEfficient === true, stillBytes: output.length };
      fs.writeFileSync(stillOf(entry), output);
      const before = video;
      video = entry; pending = null;
      try { save(); } catch { video = before; drop(entry); throw Error('The video could not be saved.'); }
      if (before && before.id !== entry.id) drop(before);
      onChange();
      return video;
    },
    discard(id) { if (pending && pending.id === id) { drop(pending); pending = null; } },
    remove() { if (pending) { drop(pending); pending = null; } if (!video) return null; const before = video; video = null; save(); drop(before); onChange(); return null; },
    /** The file or its still, as a protocol response: whole, or the asked byte range (206). */
    response(id, part, rangeHeader) {
      const entry = video && video.id === id ? video : pending && pending.id === id ? pending : null;
      if (!entry) return null;
      if (part === 'still') { const file = stillOf(entry), stat = plainFile(file); if (!stat || stat.size !== entry.stillBytes) return null; return new Response(fs.readFileSync(file), { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } }); }
      if (part !== 'file') return null;
      const file = fileOf(entry), stat = plainFile(file); if (!stat || stat.size !== entry.bytes) return null;
      const range = parseRange(rangeHeader, stat.size), start = range ? range.start : 0, end = range ? range.end : stat.size - 1;
      const headers = { 'Content-Type': entry.mime, 'Accept-Ranges': 'bytes', 'Content-Length': String(end - start + 1), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
      if (range) headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
      return new Response(Readable.toWeb(fs.createReadStream(file, { start, end })), { status: range ? 206 : 200, headers });
    },
  };
}

module.exports = { createProfileVideo, sniffVideo, sizeAllowed, parseRange, MAX_VIDEO_BYTES, MAX_LONG_SIDE, MAX_SHORT_SIDE, EXTENSIONS };
