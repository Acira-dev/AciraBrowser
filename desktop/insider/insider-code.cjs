'use strict';
// Beta 14 rules 4, 5 and 9: what the person may type or paste into "Enter Insider code" in the profile viewer. Three kinds, told apart by their SHAPE alone (the browser never
// decides whether one is real: only the server knows that):
//   invite      ACIRA-XXXX-XXXX       eight characters of the server's alphabet (32 characters, none that look alike), one use      -> insider-redeem {code}
//   move        ACIRA-XXXX-XXXX-XXXX  twelve characters of the same alphabet, made by "Move my Insider" on the old profile, one use -> insider-move {code}
//   activation  the personal link's token (32 random characters, A-Z a-z 0-9 _ -, case kept), or the whole acira://insider/activate?t=... link, when the link cannot be opened
//               (rule 4: "the same token may be pasted into Enter Insider code")                                                      -> insider-activate {token}
// A code is accepted with or without the dashes and the ACIRA prefix, in any letter case, with spaces or invisible characters in it, or inside a pasted sentence
// ("Your code is ACIRA-7KQ2-M9XD."). A shape that cannot be any of them is told on the spot and is never sent, so a typing slip does not spend one of the server's tries.
// The move code's shape is the browser's side of the contract (the function is named, not the shape): the Insider contract says what the server must give.
const { parseInsiderLink, parseInviteLink, TOKEN } = require('./insider-link.cjs');

const LENGTH = 8, MOVE_LENGTH = 12, PREFIX = 'ACIRA', MAX_INPUT = 400;
/** Soft hyphens, zero-width and direction marks, the word joiner and the byte order mark: what a copied code can carry without showing. */
const INVISIBLE = /[­​-‏‪-‮⁠-⁤﻿]/g;
/** Whitespace, hyphens in all their forms, underscores and dots: what people put between the groups. */
const SEPARATORS = /[\s‐-―−_.\-]/g;
const SEP = '[\\s\\u2010-\\u2015\\u2212_.\\-]*';
const SHAPE = /^[A-Z0-9]+$/;
/** A code inside other text: the prefix, then two (invite) or three (move) groups of four, and not when the group goes on (a longer code is not this one). */
const IN_TEXT_MOVE = new RegExp(`ACIRA${SEP}([A-Z0-9]{4})${SEP}([A-Z0-9]{4})${SEP}([A-Z0-9]{4})(?![A-Z0-9]|[_\\u2010-\\u2015\\u2212\\-][A-Z0-9])`);
const IN_TEXT = new RegExp(`ACIRA${SEP}([A-Z0-9]{4})${SEP}([A-Z0-9]{4})(?![A-Z0-9]|[_\\u2010-\\u2015\\u2212\\-][A-Z0-9])`);
const LINK_IN_TEXT = /acira:\/\/insider\/(?:activate|invite)\?[^\s"'<>]*/i;

const clean = (text) => text.normalize('NFKC').replace(INVISIBLE, '').toUpperCase();

/** The eight or twelve characters of a code typed or pasted, or {ok:false, reason}. `lengths` are the code lengths allowed. */
function rawOf(input, lengths) {
  if (typeof input !== 'string') return { ok: false, reason: 'empty' };
  if (input.length > MAX_INPUT) return { ok: false, reason: 'long' };
  const text = clean(input);
  let raw = null;
  if (lengths.includes(MOVE_LENGTH)) { const found = IN_TEXT_MOVE.exec(text); if (found) raw = found[1] + found[2] + found[3]; }
  if (raw === null) { const found = IN_TEXT.exec(text); if (found) raw = found[1] + found[2]; }
  if (raw === null) {
    raw = text.replace(SEPARATORS, '');
    if (raw.startsWith(PREFIX) && lengths.includes(raw.length - PREFIX.length)) raw = raw.slice(PREFIX.length);
  }
  if (!raw.length || raw === PREFIX) return { ok: false, reason: 'empty' }; // nothing typed yet, or only the prefix
  const longest = Math.max(...lengths), shortest = Math.min(...lengths);
  if (raw.length < shortest) return { ok: false, reason: 'short' };
  if (raw.length > longest) return { ok: false, reason: 'long' };
  if (!SHAPE.test(raw)) return { ok: false, reason: 'characters' };
  if (!lengths.includes(raw.length)) return { ok: false, reason: raw.length < longest ? 'short' : 'long' };
  return { ok: true, raw };
}

/** An invite code: {ok:true, raw:'7KQ2M9XD', code:'ACIRA-7KQ2-M9XD'} or {ok:false, reason:'empty'|'short'|'long'|'characters'}. */
function parseCode(input) {
  const read = rawOf(input, [LENGTH]);
  return read.ok ? { ok: true, raw: read.raw, code: formatCode(read.raw) } : read;
}

/**
 * Whatever was typed into "Enter Insider code": {ok:true, kind:'invite'|'move', code} | {ok:true, kind:'activation', token} | {ok:false, reason}.
 * A link or a bare 32-character token is an activation (its case is kept); otherwise eight characters are an invite code and twelve a move code.
 */
function parseEntry(input) {
  if (typeof input !== 'string') return { ok: false, reason: 'empty' };
  if (input.length > MAX_INPUT) return { ok: false, reason: 'long' };
  const plain = input.normalize('NFKC').replace(INVISIBLE, '');
  const link = LINK_IN_TEXT.exec(plain);
  if (link) {
    const text = link[0].replace(/[.,;:!?)\]]+$/, ''), token = parseInsiderLink(text), code = token ? null : parseInviteLink(text);
    return token ? { ok: true, kind: 'activation', token } : code ? { ok: true, kind: 'invite', code } : { ok: false, reason: 'characters' };
  }
  const bare = plain.trim();
  if (TOKEN.test(bare)) return { ok: true, kind: 'activation', token: bare };
  const read = rawOf(input, [LENGTH, MOVE_LENGTH]);
  if (!read.ok) return read;
  return read.raw.length === MOVE_LENGTH ? { ok: true, kind: 'move', code: formatMoveCode(read.raw) } : { ok: true, kind: 'invite', code: formatCode(read.raw) };
}

/** 'ACIRA-XXXX-XXXX' from the eight characters. */
const formatCode = (raw) => `${PREFIX}-${raw.slice(0, 4)}-${raw.slice(4)}`;
/** 'ACIRA-XXXX-XXXX-XXXX' from the twelve characters of a move code. */
const formatMoveCode = (raw) => `${PREFIX}-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8)}`;
/** A move code as the server gave it, in its one form, or null. */
function parseMoveCode(input) { const read = rawOf(input, [MOVE_LENGTH]); return read.ok ? formatMoveCode(read.raw) : null; }

/** A code as the list of invites shows it: never in full. `hint` is the last characters the server gave (at most two are used). */
function maskedCode(hint) {
  const tail = typeof hint === 'string' ? clean(hint).replace(SEPARATORS, '').replace(/[^A-Z0-9]/g, '').slice(-2) : '';
  return `${PREFIX}-••••-••${tail.padStart(2, '•')}`;
}

module.exports = { parseCode, parseEntry, parseMoveCode, formatCode, formatMoveCode, maskedCode, LENGTH, MOVE_LENGTH, PREFIX };
