'use strict';
// The app icon that can change without a new installer (Beta 14.3). Everything here is pure or takes what it needs as an argument: no Electron, no network of its own, no child process.
//
//   WHAT  Once a day the browser asks for ONE tiny file beside the update feed (update.acirabrowser.com/appicon/index.json, plain GET through the update check's own session: the same user agent, no cookie, no Referer, no
//         identifier, nothing about the person). If it names a newer icon set the three pictures (Windows 256, Mac 1024, Linux 512, PNG) are fetched, checked and handed to the platform layer (app-icon-apply.cjs), which
//         puts them where an app may change its own icon: the running window and the Dock (Mac), the running window and the Start menu or Desktop shortcut (Windows), the window and the launcher (Linux). The icon inside
//         the installed program cannot change; that is by design.
//   THE FILE  JSON, schema 1: {schema, version, name, standard?, from?, until?, minVersion?, audience?, windows, mac, linux: {file, size, width, height, sha512}}. `version` only goes up (an old copy served by a cache can
//         never flip the icon back); `standard: true` with a higher version goes back to the standard icon. A missing file, a 404, a bad answer or no connection means "keep what you have", never "go back to standard".
//   WHO   `minVersion` (the icon belongs to a release) and `audience` (insider | public | all) are judged on this computer; nothing is sent. A document that does not apply to this install is SKIPPED (the icon stays as it is,
//         nothing is downloaded, nothing is said) but is kept, so it applies by itself when the install later qualifies. Unknown values in a known field fail closed (the whole document does not apply); unknown fields are ignored.
//   SAFE  The file name comes from the document but is a bare name (no path, no address): it is joined to the fixed folder in this code. Size caps while streaming, PNG checked byte by byte (signature, header, every chunk's
//         checksum, the exact unpacked size, nothing after IEND, no animation), SHA-512 equal to the document's, only then decoded by Electron. Nothing in the document can run, write elsewhere or change a setting.
const fs = require('node:fs'), path = require('node:path'), zlib = require('node:zlib'), crypto = require('node:crypto');
const { writeFileAtomic, readJsonFile } = require('../atomic-file.cjs');
const { lowerThan, isVersion } = require('./update-feeds.cjs');
const { feedFolderURL } = require('./release-feed.cjs');

const SCHEMA = 1;
const HOUR = 3600 * 1000, DAY = 24 * HOUR;
const DOC_MAX = 8 * 1024, PICTURE_MAX = 400 * 1024, STATE_MAX = 64 * 1024;
const SIZES = Object.freeze({ windows: 256, mac: 1024, linux: 512 });
const PLATFORM_OF = Object.freeze({ win32: 'windows', darwin: 'mac', linux: 'linux' });
const AUDIENCES = Object.freeze(['insider', 'public', 'all']);
const FILE_NAME = /^[a-z0-9][a-z0-9-]{0,60}\.png$/;
const SHA512 = /^[A-Za-z0-9+/]{86}==$/;
const DAY_TEXT = /^(\d{4})-(\d{2})-(\d{2})$/;
const ICO_SIZES = Object.freeze([16, 24, 32, 48, 64, 128, 256]);
const UPDATE_HOST = 'update.acirabrowser.com';
const FIRST_LOOK = 90 * 1000, RETRY_GAP = 30 * 60 * 1000, TRIES_PER_DAY = 3, JITTER = 10 * 60 * 1000;
const MAX_VERSION = 999999, MAX_JUMP = 1000, BAD_PICTURE_TRIES = 3; // a version above 999999 would not fit the picture file names; a jump of more than 1000 is not what the publishing tool does (it numbers one above) and would pin every install
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

// ───────────────────────────────────────────────── the document

/** 'YYYY-MM-DD' of a moment in THIS computer's time zone (the day starts at 00:00 here). */
function localDay(at) {
  const date = new Date(at);
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
/** True for a real calendar day written 'YYYY-MM-DD'. */
function isDay(value) {
  const match = typeof value === 'string' ? DAY_TEXT.exec(value) : null;
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])], check = new Date(Date.UTC(year, month - 1, day));
  return year >= 2000 && year <= 2999 && check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day;
}

function pictureBlock(raw, platform) {
  if (!isObject(raw)) return null;
  const size = SIZES[platform];
  if (typeof raw.file !== 'string' || !FILE_NAME.test(raw.file)) return null;
  if (!Number.isSafeInteger(raw.size) || raw.size < 1 || raw.size > PICTURE_MAX) return null;
  if (raw.width !== size || raw.height !== size) return null;
  if (typeof raw.sha512 !== 'string' || !SHA512.test(raw.sha512)) return null;
  return { file: raw.file, size: raw.size, width: raw.width, height: raw.height, sha512: raw.sha512 };
}

/** Reads the document's text. {ok: true, doc} with only the known fields, or {ok: false, reason}. Anything this build does not fully understand is refused whole (never "applies to everyone"). */
function parseDocument(text) {
  if (typeof text !== 'string') return { ok: false, reason: 'not-text' };
  if (Buffer.byteLength(text, 'utf8') > DOC_MAX) return { ok: false, reason: 'too-large' };
  let raw;
  try { raw = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text); } catch { return { ok: false, reason: 'not-json' }; }
  if (!isObject(raw)) return { ok: false, reason: 'not-an-object' };
  if (raw.schema !== SCHEMA) return { ok: false, reason: 'schema' };
  if (!Number.isSafeInteger(raw.version) || raw.version < 1 || raw.version > MAX_VERSION) return { ok: false, reason: 'version' };
  if (raw.standard !== undefined && typeof raw.standard !== 'boolean') return { ok: false, reason: 'standard' };
  if (raw.name !== undefined && (typeof raw.name !== 'string' || !raw.name.length || raw.name.length > 40 || CONTROL.test(raw.name))) return { ok: false, reason: 'name' };
  if (raw.audience !== undefined && !AUDIENCES.includes(raw.audience)) return { ok: false, reason: 'audience' };
  if (raw.minVersion !== undefined && (typeof raw.minVersion !== 'string' || raw.minVersion !== raw.minVersion.trim() || !isVersion(raw.minVersion))) return { ok: false, reason: 'minVersion' };
  for (const key of ['from', 'until']) if (raw[key] !== undefined && !isDay(raw[key])) return { ok: false, reason: 'dates' };
  if (raw.from !== undefined && raw.until !== undefined && raw.from > raw.until) return { ok: false, reason: 'dates' };
  const standard = raw.standard === true;
  if (standard && (raw.from !== undefined || raw.until !== undefined)) return { ok: false, reason: 'dates' }; // "back to standard" has no dates: refused whole
  const doc = { schema: SCHEMA, version: raw.version, name: raw.name ?? '', standard, from: raw.from ?? null, until: raw.until ?? null, minVersion: raw.minVersion ?? null, audience: raw.audience ?? 'all', pictures: null };
  if (!standard) {
    const pictures = {};
    for (const platform of Object.keys(SIZES)) {
      const block = pictureBlock(raw[platform], platform);
      if (!block) return { ok: false, reason: 'pictures' }; // every platform's block must be sound, even the ones this computer does not use
      pictures[platform] = block;
    }
    doc.pictures = pictures;
  }
  return { ok: true, doc };
}

/** Whether a (parsed) document applies to this install, apart from its dates. {ok: true} or {ok: false, why, certain}: `certain` is false only when the answer is "unknown" (the Insider read was not clear). */
function gate(doc, { running, insider }) {
  if (doc.minVersion !== null) {
    if (!isVersion(running)) return { ok: false, why: 'running-version-unknown', certain: false };
    if (lowerThan(running, doc.minVersion)) return { ok: false, why: 'below-min-version', certain: true };
  }
  if (doc.audience === 'insider' || doc.audience === 'public') {
    if (insider !== true && insider !== false) return { ok: false, why: 'audience-unknown', certain: false };
    if ((doc.audience === 'insider') !== insider) return { ok: false, why: 'audience', certain: true };
  }
  return { ok: true };
}

/** 'before' | 'within' | 'after' for a document's dates (a document with none is always 'within'), in this computer's days. */
function windowOf(subject, at) {
  const today = localDay(at);
  if (subject.from && today < subject.from) return 'before';
  if (subject.until && today > subject.until) return 'after';
  return 'within';
}

/** What this install should show now, from the newest document it knows and what it has applied. {target: 'picture' | 'standard' | 'keep', why, picture?}. Pure.
 *  `applied`: {version, audience, from, until} of the icon on screen, or null (the standard icon). `insider`: true | false | null (null: not clearly known). */
function decide({ doc, applied = null, running, platform, now, insider }) {
  const keepOrExpire = (why) => (applied && windowOf(applied, now) === 'after' ? { target: 'standard', why: 'applied-expired' } : { target: 'keep', why });
  if (!doc) return keepOrExpire('no-document');
  const passed = gate(doc, { running, insider });
  if (!passed.ok) {
    // Leaving the programme takes the programme's icon with it, but only on a clear "not an Insider"; one unclear moment changes nothing.
    if (passed.why === 'audience' && passed.certain && applied && applied.audience === 'insider') return { target: 'standard', why: 'left-the-programme' };
    return keepOrExpire(passed.why);
  }
  if (doc.standard) return { target: 'standard', why: 'standard' };
  const key = PLATFORM_OF[platform] || platform, picture = doc.pictures?.[key];
  if (!picture) return keepOrExpire('no-picture-for-platform');
  const place = windowOf(doc, now);
  // Not due yet: the icon on screen stays while its own days last (its next one is fetched in advance); otherwise the standard icon shows.
  if (place === 'before' && applied && windowOf(applied, now) === 'within') return { target: 'keep', why: 'next-not-due', picture, prefetch: true };
  if (place !== 'within') return { target: 'standard', why: 'outside-dates-' + place, picture, prefetch: place === 'before' };
  return { target: 'picture', why: 'ok', picture };
}

// ───────────────────────────────────────────────── the pictures

let crcTable = null;
/** CRC-32 (the PNG chunk checksum). */
function crc32(bytes) {
  if (!crcTable) { crcTable = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; } }
  let c = 0xffffffff;
  for (let index = 0; index < bytes.length; index++) c = crcTable[(c ^ bytes[index]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }, DEPTHS = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };

/** Checks a PNG byte by byte: {ok: true} or {ok: false, reason}. It must be exactly `width` x `height`, not interlaced, not animated, every chunk's checksum right, nothing after IEND, and its picture data must unpack to exactly the
 *  size the header promises (so a small file cannot hide a huge picture). Never throws. */
function checkPng(bytes, { width, height } = {}) {
  const fail = (reason) => ({ ok: false, reason });
  if (!Buffer.isBuffer(bytes)) return fail('not-bytes');
  if (bytes.length > PICTURE_MAX) return fail('too-large');
  if (bytes.length < 57 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return fail('not-png');
  let at = 8, header = null, ended = false;
  const data = [];
  for (let chunks = 0; at < bytes.length && chunks < 5000; chunks++) {
    if (at + 12 > bytes.length) return fail('truncated');
    const length = bytes.readUInt32BE(at), type = bytes.toString('latin1', at + 4, at + 8), end = at + 12 + length;
    if (length > 0x7fffffff || !/^[A-Za-z]{4}$/.test(type)) return fail('bad-chunk');
    if (end > bytes.length) return fail('truncated');
    if (bytes.readUInt32BE(end - 4) !== crc32(bytes.subarray(at + 4, end - 4))) return fail('bad-checksum');
    if (chunks === 0 && (type !== 'IHDR' || length !== 13)) return fail('bad-header');
    if (type === 'IHDR' && chunks > 0) return fail('bad-chunk');
    if (type === 'acTL' || type === 'fcTL' || type === 'fdAT') return fail('animated');
    if (type === 'IHDR') header = { width: bytes.readUInt32BE(at + 8), height: bytes.readUInt32BE(at + 12), depth: bytes[at + 16], color: bytes[at + 17], compression: bytes[at + 18], filter: bytes[at + 19], interlace: bytes[at + 20] };
    else if (type === 'IDAT') data.push(bytes.subarray(at + 8, at + 8 + length));
    at = end;
    if (type === 'IEND') { if (length !== 0) return fail('bad-chunk'); ended = true; break; }
  }
  if (!header) return fail('bad-header');
  if (!ended) return fail('truncated');
  if (at !== bytes.length) return fail('trailing-bytes');
  if (!(Number.isSafeInteger(width) && width > 0 && header.width === width && Number.isSafeInteger(height) && height > 0 && header.height === height)) return fail('wrong-size');
  if (!DEPTHS[header.color] || !DEPTHS[header.color].includes(header.depth)) return fail('bad-header');
  if (header.compression !== 0 || header.filter !== 0) return fail('bad-header');
  if (header.interlace !== 0) return fail('interlaced');
  if (!data.length) return fail('no-data');
  const rowBytes = Math.ceil((width * CHANNELS[header.color] * header.depth) / 8), expected = height * (1 + rowBytes);
  let raw;
  try { raw = zlib.inflateSync(Buffer.concat(data), { maxOutputLength: expected + 1 }); } catch { return fail('bad-data'); }
  if (raw.length !== expected) return fail('bad-data');
  return { ok: true, width: header.width, height: header.height };
}

/** Whether all four corner pixels of a PNG are opaque (a full-bleed square), by reading the picture itself: true | false | null (cannot tell: an interlaced, palette or odd-depth picture). Used by the publishing tool: macOS draws a
 *  run-time Dock picture exactly as supplied, so a full-bleed square would show as a hard square among rounded icons. The picture is assumed sound (checkPng first). */
function cornersOpaque(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 33 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE) || bytes.toString('latin1', 12, 16) !== 'IHDR') return null;
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20), depth = bytes[24], color = bytes[25], interlace = bytes[28];
  if (interlace !== 0 || (depth !== 8 && depth !== 16) || ![0, 2, 4, 6].includes(color) || width < 1 || height < 1 || width * height > 4096 * 4096) return null;
  const hasAlpha = color === 4 || color === 6, channels = CHANNELS[color], pixel = channels * (depth / 8);
  if (!hasAlpha) return true;                               // no alpha channel: every pixel is opaque
  const data = [];
  for (let at = 8; at + 12 <= bytes.length;) { const length = bytes.readUInt32BE(at), type = bytes.toString('latin1', at + 4, at + 8); if (type === 'IDAT') data.push(bytes.subarray(at + 8, at + 8 + length)); if (type === 'IEND') break; at += 12 + length; }
  let raw; try { raw = zlib.inflateSync(Buffer.concat(data)); } catch { return null; }
  const rowBytes = width * pixel;
  if (raw.length !== height * (1 + rowBytes)) return null;
  let previous = Buffer.alloc(rowBytes), row = Buffer.alloc(rowBytes);
  const alphaAt = (line, x) => line[x * pixel + (channels - 1) * (depth / 8)];   // the high byte of the alpha sample
  const corners = [];
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (1 + rowBytes)], source = raw.subarray(y * (1 + rowBytes) + 1, (y + 1) * (1 + rowBytes));
    for (let i = 0; i < rowBytes; i++) {
      const left = i >= pixel ? row[i - pixel] : 0, up = previous[i], upLeft = i >= pixel ? previous[i - pixel] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left; else if (filter === 2) predictor = up; else if (filter === 3) predictor = (left + up) >> 1;
      else if (filter === 4) { const p = left + up - upLeft, pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - upLeft); predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft; }
      else if (filter !== 0) return null;
      row[i] = (source[i] + predictor) & 0xff;
    }
    if (y === 0 || y === height - 1) corners.push(alphaAt(row, 0), alphaAt(row, width - 1));
    [previous, row] = [row, previous];
  }
  return corners.every((alpha) => alpha >= 250);
}

/** The SHA-512 of the exact bytes, base64 (the form the document carries). */
const sha512Of = (bytes) => crypto.createHash('sha512').update(bytes).digest('base64');

/** An .ico that holds these PNG pictures [{size, png}] (Windows reads PNG inside an .ico from Vista on). The 256 picture is written as the byte-for-byte copy it is given. */
function buildIco(frames) {
  if (!Array.isArray(frames) || !frames.length || frames.length > 16) throw new Error('An .ico needs 1 to 16 pictures.');
  const header = Buffer.alloc(6 + 16 * frames.length);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(frames.length, 4);
  let offset = header.length;
  frames.forEach(({ size, png }, index) => {
    if (!Number.isInteger(size) || size < 1 || size > 256 || !Buffer.isBuffer(png)) throw new Error('A bad picture for the .ico.');
    const at = 6 + 16 * index;
    header[at] = size === 256 ? 0 : size; header[at + 1] = size === 256 ? 0 : size; header[at + 2] = 0; header[at + 3] = 0;
    header.writeUInt16LE(1, at + 4); header.writeUInt16LE(32, at + 6); header.writeUInt32LE(png.length, at + 8); header.writeUInt32LE(offset, at + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...frames.map((frame) => frame.png)]);
}
/** The .ico of a 256 picture: 16, 24, 32, 48, 64, 128 (made by `resize(png, side)` -> PNG bytes) and the 256 picture itself. */
function makeIco(png256, resize) {
  return buildIco(ICO_SIZES.map((size) => ({ size, png: size === 256 ? png256 : resize(png256, size) })));
}

// ───────────────────────────────────────────────── the saved state

const blankState = () => ({ schema: SCHEMA, seenVersion: 0, doc: null, tag: null, askedAt: 0, attempt: { day: '', count: 0, at: 0 }, applied: null, previous: null, told: false, lastError: null, runningWas: '', pictureAttempt: { day: '', count: 0 }, pictureBad: { version: 0, count: 0 } });
const STATE_FILE = /^icon-v\d{1,9}\.png$/;
const finite = (value) => Number.isFinite(value) && value >= 0;

/** A saved state read back: anything out of shape is dropped (a damaged or edited file means "no document, standard icon"). The document is parsed again like a fresh one. */
function readState(raw) {
  const state = blankState();
  if (!isObject(raw) || raw.schema !== SCHEMA) return state;
  if (Number.isSafeInteger(raw.seenVersion) && raw.seenVersion >= 0 && raw.seenVersion <= MAX_VERSION) state.seenVersion = raw.seenVersion;
  let understood = true;
  if (isObject(raw.doc)) { const parsed = parseDocument(JSON.stringify(raw.doc)); if (parsed.ok) { state.doc = parsed.doc; state.seenVersion = Math.max(state.seenVersion, parsed.doc.version); } else { understood = false; state.seenVersion = 0; } }
  state.tag = understood ? validTag(raw.tag) : null;   // a document this build cannot read back is asked for again, never answered "304"
  if (typeof raw.runningWas === 'string' && raw.runningWas.length <= 80) state.runningWas = raw.runningWas;
  if (isObject(raw.pictureAttempt) && typeof raw.pictureAttempt.day === 'string' && DAY_TEXT.test(raw.pictureAttempt.day) && Number.isSafeInteger(raw.pictureAttempt.count) && raw.pictureAttempt.count >= 0) state.pictureAttempt = { day: raw.pictureAttempt.day, count: raw.pictureAttempt.count };
  if (isObject(raw.pictureBad) && Number.isSafeInteger(raw.pictureBad.version) && raw.pictureBad.version >= 0 && Number.isSafeInteger(raw.pictureBad.count) && raw.pictureBad.count >= 0) state.pictureBad = { version: raw.pictureBad.version, count: raw.pictureBad.count };
  if (finite(raw.askedAt)) state.askedAt = raw.askedAt;
  if (isObject(raw.attempt) && typeof raw.attempt.day === 'string' && DAY_TEXT.test(raw.attempt.day) && Number.isSafeInteger(raw.attempt.count) && raw.attempt.count >= 0 && finite(raw.attempt.at)) state.attempt = { day: raw.attempt.day, count: raw.attempt.count, at: raw.attempt.at };
  const a = raw.applied;
  if (isObject(a) && Number.isSafeInteger(a.version) && a.version >= 1 && typeof a.file === 'string' && STATE_FILE.test(a.file) && typeof a.sha512 === 'string' && SHA512.test(a.sha512)) {
    state.applied = { version: a.version, name: typeof a.name === 'string' && a.name.length <= 40 && !CONTROL.test(a.name) ? a.name : '', audience: AUDIENCES.includes(a.audience) ? a.audience : 'all', from: isDay(a.from) ? a.from : null, until: isDay(a.until) ? a.until : null, file: a.file, sha512: a.sha512 };
  }
  if (typeof raw.previous === 'string' && STATE_FILE.test(raw.previous)) state.previous = raw.previous;
  state.told = raw.told === true;
  if (typeof raw.lastError === 'string') state.lastError = raw.lastError.slice(0, 120);
  return state;
}
/** A parsed document written back in the form the server serves it (so what is saved is read by the same reader as a fresh answer). */
function documentOf(doc) {
  return { schema: SCHEMA, version: doc.version, ...(doc.name ? { name: doc.name } : {}), ...(doc.standard ? { standard: true } : {}), ...(doc.from ? { from: doc.from } : {}), ...(doc.until ? { until: doc.until } : {}), ...(doc.minVersion ? { minVersion: doc.minVersion } : {}), audience: doc.audience, ...(doc.pictures || {}) };
}
/** What is saved of the state: the same shape, the document in the form above. */
const stateText = (state) => JSON.stringify({ ...state, doc: state.doc && documentOf(state.doc) });
const validTag = (value) => (typeof value === 'string' && value.length > 0 && value.length <= 200 && /^[\x20-\x7e]+$/.test(value) ? value : null);

// ───────────────────────────────────────────────── the service

/** The address of the icon folder (with its trailing slash), or ''. A test profile reaches only what QA names (ACIRA_APPICON_URL, plain http on 127.0.0.1, the folder's address). In production it is the update feed's own
 *  folder plus appicon/, and only on update.acirabrowser.com: no other host is ever asked. */
function appIconBase(env = process.env, { feedFolder = feedFolderURL } = {}) {
  const { checkedEndpoint } = require('./metrics.cjs');   // loaded when the address is first needed, not when a window is made
  if (env.ACIRA_BROWSER_TEST_DATA) {
    const url = checkedEndpoint(env.ACIRA_APPICON_URL || '', { allowLocal: true });
    return url && url.startsWith('http://') && url.endsWith('/') && new URL(url).hostname === '127.0.0.1' ? url : ''; // never an https address and never another name: a test profile cannot reach a real host
  }
  let folder = '';
  try { folder = feedFolder(); } catch { folder = ''; }
  const base = folder ? checkedEndpoint(folder + 'appicon/') : '';
  try { const url = base && new URL(base); return url && url.hostname === UPDATE_HOST && url.port === '' ? base : ''; } catch { return ''; }
}

/**
 * directory: <data folder>/app-icon (state.json and the pictures). platform: process.platform. running: the app's version. enabled(): the person's setting. insider(): true | false | null.
 * baseUrl: where the folder is ('' means never ask). fetchDocument({url, tag}) -> {status: 200, text, tag} | {status: 304}, or throws. fetchPicture({url, maxBytes}) -> Buffer, or throws.
 * apply(target): the platform layer; target {kind: 'picture', version, name, file (absolute), platform} | {kind: 'standard'}; resolves true when the icon changed, false/throws when it did not (then nothing is recorded).
 * notify(): called once, the first time a new icon is applied (the quiet toast). onChange(): what a window's icon would be may have changed.
 */
function createAppIcon({ directory, platform = process.platform, running = '', enabled = () => true, insider = () => null, baseUrl = '', fetchDocument = null, fetchPicture = null, apply = async () => true, notify = () => {}, onChange = () => {}, now = Date.now, io = fs, schedule = setTimeout, cancel = clearTimeout, random = Math.random, first = FIRST_LOOK, warn = () => {} } = {}) {
  const stateFile = path.join(directory, 'state.json'), key = PLATFORM_OF[platform] || platform;
  let state = null, timer = null, started = false, queue = Promise.resolve(), reasserted = false, generation = 0;

  const load = () => {
    if (state) return state;
    const saved = readJsonFile(stateFile, { fileSystem: io, now, maxBytes: STATE_MAX, warn });
    state = readState(saved);
    return state;
  };
  const persist = () => { try { io.mkdirSync(directory, { recursive: true }); writeFileAtomic(stateFile, stateText(state), { fileSystem: io }); } catch { /* kept in memory until the next save */ } };
  const insiderNow = () => { try { const value = insider(); return value === true || value === false ? value : null; } catch { return null; } };
  const isEnabled = () => { try { return enabled() !== false; } catch { return true; } };
  const fileOf = (name) => path.join(directory, name);
  const exists = (name) => { try { return io.statSync(fileOf(name)).isFile(); } catch { return false; } };
  // The Insider read is made only when the saved document is for a group (an `all` document never looks at it), so an ordinary install does not even build the feedback service for the icon.
  const decision = () => { load(); return decide({ doc: state.doc, applied: state.applied, running, platform, now: now(), insider: state.doc && state.doc.audience !== 'all' ? insiderNow() : null }); };

  /** The file a window should wear at start-up: from the saved state alone, no network. A document that now applies (the app was updated, the day came) and whose picture is already here counts at once. Null: the standard icon. */
  function startupIcon() {
    load();
    if (!isEnabled()) return null;
    const verdict = decision();
    if (verdict.target === 'standard') return null;
    if (verdict.target === 'picture') { const name = `icon-v${state.doc.version}.png`; if (state.applied?.file === name && exists(name)) return fileOf(name); }
    return state.applied && exists(state.applied.file) ? fileOf(state.applied.file) : null;
  }
  /** The icon applied now, {file, version, name}, or null. */
  function current() { load(); return state.applied && exists(state.applied.file) ? { file: fileOf(state.applied.file), version: state.applied.version, name: state.applied.name } : null; }

  const attemptsToday = () => (load().attempt.day === localDay(now()) ? state.attempt.count : 0);
  const noteAttempt = () => { const day = localDay(now()); state.attempt = { day, count: state.attempt.day === day ? state.attempt.count + 1 : 1, at: now() }; };
  // Pictures have their own daily budget (a bad picture must not use up the day's look at the document), and a picture that fails its checks is given up on after three tries until a newer document comes.
  const pictureTriesToday = () => (load().pictureAttempt.day === localDay(now()) ? state.pictureAttempt.count : 0);
  const notePictureTry = () => { const day = localDay(now()); state.pictureAttempt = { day, count: state.pictureAttempt.day === day ? state.pictureAttempt.count + 1 : 1 }; };
  const noteBadPicture = (version) => { state.pictureBad = { version, count: state.pictureBad.version === version ? state.pictureBad.count + 1 : 1 }; };

  /** Removes the pictures that are neither the applied one nor the one before it. */
  function tidy() {
    try {
      const keep = new Set([state.applied?.file, state.previous, state.doc && !state.doc.standard ? `icon-v${state.doc.version}.png` : null].filter(Boolean));
      for (const name of io.readdirSync(directory)) if (STATE_FILE.test(name) && !keep.has(name)) try { io.rmSync(fileOf(name), { force: true }); } catch { /* next time */ }
    } catch { /* nothing to tidy */ }
  }

  /** The picture of this platform for a document: on disk and checked, or fetched, checked and written. Returns the file name or null (nothing changes then). */
  async function ensurePicture(doc, block) {
    const name = `icon-v${doc.version}.png`;
    if (exists(name)) { try { if (sha512Of(io.readFileSync(fileOf(name))) === block.sha512) return name; } catch { /* fetched again */ } }
    if (!baseUrl || !fetchPicture || !isEnabled() || pictureTriesToday() >= TRIES_PER_DAY || (state.pictureBad.version === doc.version && state.pictureBad.count >= BAD_PICTURE_TRIES)) return null;
    notePictureTry(); persist();
    let bytes;
    try { bytes = await fetchPicture({ url: baseUrl + block.file, maxBytes: PICTURE_MAX }); } catch (error) { state.lastError = ('picture: ' + String(error?.message || error)).slice(0, 120); persist(); return null; }
    const verdict = Buffer.isBuffer(bytes) ? checkPng(bytes, { width: block.width, height: block.height }) : { ok: false, reason: 'not-bytes' };
    if (!verdict.ok || bytes.length !== block.size || sha512Of(bytes) !== block.sha512) { noteBadPicture(doc.version); state.lastError = ('picture: ' + (verdict.ok ? 'does not match the document' : verdict.reason)).slice(0, 120); persist(); return null; }
    try { io.mkdirSync(directory, { recursive: true }); writeFileAtomic(fileOf(name), bytes, { fileSystem: io }); } catch { state.lastError = 'picture: could not be saved'; persist(); return null; }
    return name;
  }

  async function act(verdict) {
    if (verdict.prefetch && state.doc && verdict.picture) { await ensurePicture(state.doc, verdict.picture); tidy(); }   // a picture that is not due yet is fetched in advance, shown when its day comes
    if (verdict.target === 'keep') return false;
    if (verdict.target === 'standard') {
      if (!state.applied) return false;
      let done = false;
      try { done = (await apply({ kind: 'standard', platform: key, directory })) !== false; } catch { done = false; }
      if (!done) return false;
      state.previous = state.applied.file; state.applied = null; persist(); tidy(); onChange();
      return true;
    }
    const doc = state.doc, name = `icon-v${doc.version}.png`;
    if (state.applied?.file === name && state.applied.sha512 === verdict.picture.sha512 && exists(name)) {
      // Already on screen. The first look of each RUN puts it there again quietly: the Dock shows the bundle's own icon until the app says otherwise, and an installer update re-creates the Start menu entry.
      if (!reasserted) { reasserted = true; try { await apply({ kind: 'picture', version: doc.version, name: doc.name, file: fileOf(name), platform: key, directory, again: true }); } catch { /* the next run */ } }
      return false;
    }
    const file = await ensurePicture(doc, verdict.picture);
    if (!file || !isEnabled()) return false;                // the switch may have gone off while the picture came
    let done = false;
    try { done = (await apply({ kind: 'picture', version: doc.version, name: doc.name, file: fileOf(file), platform: key, directory })) !== false; } catch { done = false; }
    if (!done) return false;
    if (state.applied && state.applied.file !== file) state.previous = state.applied.file;
    reasserted = true;
    state.applied = { version: doc.version, name: doc.name, audience: doc.audience, from: doc.from, until: doc.until, file, sha512: verdict.picture.sha512 };
    state.lastError = null;
    const speak = !state.told && isEnabled(); if (speak) state.told = true;
    persist(); tidy(); onChange();
    if (speak) { try { notify(); } catch { /* a toast never breaks the icon */ } }
    return true;
  }

  /** Looks again at what the saved document says for today (no request for the document; a picture is fetched only when one is now needed). */
  function evaluate() {
    const run = queue.then(async () => {
      load();
      if (!isEnabled()) return settle();
      return act(decision());
    }).catch(() => false);
    queue = run.then(() => undefined, () => undefined);
    return run;
  }
  /** The person's switch is off: the standard icon, now, whatever the document says. */
  async function settle() {
    if (!state.applied) return false;
    let done = false;
    try { done = (await apply({ kind: 'standard', platform: key, directory })) !== false; } catch { done = false; }
    if (!done) return false;
    state.previous = state.applied.file; state.applied = null; persist(); tidy(); onChange();
    return true;
  }

  /** The daily look: asks for the document (when none was asked for in the last 24 hours and this day's tries are not used up), keeps what is good, then evaluates. Resolves status(). */
  function refresh({ force = false } = {}) {
    const run = queue.then(async () => {
      load();
      if (!isEnabled() || !baseUrl || !fetchDocument) { await (isEnabled() ? Promise.resolve() : settle()); return status(); }
      if (!force && (now() - state.askedAt < DAY && state.askedAt <= now())) { await act(decision()); return status(); }
      if (attemptsToday() >= TRIES_PER_DAY) return status();
      if (state.runningWas !== running) { state.runningWas = running; state.tag = null; }   // a newer build asks for the document afresh: what an older build refused may be understood now
      noteAttempt(); persist();
      let answer;
      try { answer = await fetchDocument({ url: baseUrl + 'index.json', tag: state.tag }); } catch (error) { state.lastError = String(error?.message || error).slice(0, 120); persist(); return status(); }
      if (answer?.status === 304) { state.askedAt = now(); state.lastError = null; persist(); await act(decision()); return status(); }
      if (answer?.status !== 200 || typeof answer.text !== 'string') { state.lastError = ('HTTP ' + (answer?.status ?? '?')).slice(0, 40); persist(); return status(); }
      state.askedAt = now();
      const read = parseDocument(answer.text);
      // A document this build refuses is NOT remembered by its tag: a later build, or the team's correction, must be read, not answered "304 unchanged".
      if (!read.ok) { state.lastError = 'document: ' + read.reason; persist(); return status(); }
      if (state.seenVersion > 0 && read.doc.version > state.seenVersion + MAX_JUMP) { state.lastError = 'document: version-jump'; persist(); return status(); }
      state.tag = validTag(answer.tag); // the server's own tag for what it holds now: the next look can be answered '304 unchanged'
      if (read.doc.version > state.seenVersion) { state.doc = read.doc; state.seenVersion = read.doc.version; }
      state.lastError = null; persist();
      if (!isEnabled()) return status();
      await act(decision());
      return status();
    }).catch(() => status());
    queue = run.then(() => undefined, () => undefined);
    return run;
  }

  const untilMidnight = () => { const date = new Date(now()); return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1, 0, 0, 30).getTime() - date.getTime(); };
  /** How long until the next tick. The first one comes `first` after start. After that: the earlier of the next look at the server (a day after the last answer; half an hour after a failed try, never more than three tries
   *  a day, then tomorrow) and the next local midnight (the dates in the saved document change then, and no request is needed to see it). Never sooner than a minute. With no address there is no server look at all. */
  function nextDelay(firstTime = false) {
    load();
    if (firstTime) return first;
    const t = now(), midnight = untilMidnight();
    if (!baseUrl || !fetchDocument) return Math.max(60 * 1000, Math.min(midnight, DAY));
    let ask;
    if (state.askedAt && t >= state.askedAt && t - state.askedAt < DAY) ask = DAY - (t - state.askedAt) + Math.floor(random() * JITTER);
    else if (attemptsToday() >= TRIES_PER_DAY) ask = midnight;
    else ask = state.attempt.count && state.attempt.day === localDay(t) ? Math.max(0, RETRY_GAP - (t - state.attempt.at)) : 0;
    return Math.max(60 * 1000, Math.min(ask, midnight, DAY));
  }
  /** Starts the schedule. Nothing at all while the setting is off (and then a later start() can still begin it). One unreferenced timer at a time; a tick that finishes after stop() or a newer start() arms nothing. */
  function start() {
    if (started || !isEnabled()) return;
    started = true;
    const mine = ++generation;
    const arm = (firstTime) => {
      if (!started || mine !== generation) return;
      timer = schedule(async () => {
        timer = null;
        try { if (isEnabled()) { await evaluate(); await refresh(); } } catch { /* the next tick */ }
        arm(false);
      }, nextDelay(firstTime));
      timer?.unref?.();
    };
    arm(true);
  }
  function stop() { started = false; generation++; if (timer) cancel(timer); timer = null; }
  /** The setting changed: the standard icon at once when it went off; the saved document is looked at again when it went on (and the timer starts if it was not running). */
  async function changed() {
    if (!isEnabled()) { stop(); await evaluate(); return; }
    if (!started) start();
    await evaluate();
  }

  function status() {
    load();
    const verdict = decision();
    return { enabled: isEnabled(), configured: Boolean(baseUrl), seenVersion: state.seenVersion, applied: state.applied ? { version: state.applied.version, name: state.applied.name, audience: state.applied.audience } : null, wants: verdict.target, why: verdict.why, askedAt: state.askedAt, attemptsToday: attemptsToday(), lastError: state.lastError, told: state.told };
  }

  return { load, startupIcon, current, evaluate, refresh, start, stop, changed, status, nextDelay };
}

// ───────────────────────────────────────────────── the person's switch

/** "Seasonal app icon": ON unless the person turned it off (the team's default). One tiny file in the icon folder, `setting.json` {on}; a damaged file is kept aside and reads as the default, one that is there but cannot be read (locked) reads as OFF for now. */
function createSetting({ directory, io = fs, now = Date.now, warn = () => {} } = {}) {
  const file = path.join(directory, 'setting.json');
  let cached = null;
  const get = () => {
    if (cached === null) {
      const saved = readJsonFile(file, { fileSystem: io, maxBytes: 1024, now, warn });
      if (saved === undefined && io.existsSync(file)) return false;   // the file is there but cannot be read just now (locked): the person's choice is unknown, so nothing is asked this time, and it is read again next time
      cached = !(saved && saved.on === false);
    }
    return cached;
  };
  const set = (on) => {
    cached = on !== false;
    try { io.mkdirSync(directory, { recursive: true }); writeFileAtomic(file, JSON.stringify({ on: cached }), { fileSystem: io }); } catch (error) { warn('app icon: the switch could not be saved (' + String(error?.message || error).slice(0, 80) + '); it holds for this run'); }
    return cached;
  };
  return { get, set };
}

// ───────────────────────────────────────────────── the real fetch

/** The two GETs over an Electron session's fetch (the update check's own session and route): no cookies, no Referer, no cache, no redirect, 20 s, a byte cap that stops the read, and for the document only `If-None-Match` with
 *  the tag the server itself gave. Nothing about the person or the install is in either request. */
function sessionFetchers(session, { route = async () => {}, maxDocument = DOC_MAX } = {}) {
  const get = async (url, headers) => {
    await route();
    return session.fetch(url, { method: 'GET', headers, credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(20000) });
  };
  const read = async (response, maxBytes) => {
    if (Number(response.headers.get('content-length') || 0) > maxBytes) throw new Error('The answer is too large.');
    const chunks = []; let total = 0;
    const reader = response.body?.getReader?.();
    if (!reader) { const bytes = Buffer.from(await response.arrayBuffer()); if (bytes.length > maxBytes) throw new Error('The answer is too large.'); return bytes; }
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maxBytes) { try { await reader.cancel(); } catch { /* over */ } throw new Error('The answer is too large.'); }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks);
  };
  return {
    async fetchDocument({ url, tag }) {
      const response = await get(url, tag ? { 'If-None-Match': tag } : undefined);
      if (response.status === 304) return { status: 304 };
      if (response.status !== 200) return { status: response.status };
      return { status: 200, text: (await read(response, maxDocument)).toString('utf8'), tag: response.headers.get('etag') || null };
    },
    async fetchPicture({ url, maxBytes = PICTURE_MAX }) {
      const response = await get(url);
      if (response.status !== 200) throw new Error('The picture answered HTTP ' + response.status + '.');
      return read(response, maxBytes);
    },
  };
}

module.exports = { SCHEMA, DOC_MAX, PICTURE_MAX, SIZES, PLATFORM_OF, AUDIENCES, FILE_NAME, ICO_SIZES, UPDATE_HOST, FIRST_LOOK, TRIES_PER_DAY, localDay, isDay, parseDocument, gate, windowOf, decide, crc32, checkPng, cornersOpaque, sha512Of, buildIco, makeIco, readState, blankState, appIconBase, createSetting, createAppIcon, sessionFetchers };
