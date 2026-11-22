'use strict';
// What the person may type or paste into "Insider code" (Settings, About, Extras): the personal link's token (32 random characters of A-Z a-z 0-9 _ -, case kept), or the whole
// acira://insider/activate?t=... link, alone or inside a pasted message. Told by its SHAPE alone: whether a code is real is for the server to say, but a shape that cannot be one is
// told on the spot and is never sent, so a typing slip does not spend one of the server's tries.
// Spaces and line breaks around it, invisible characters a chat app leaves in a copy (soft hyphens, zero-width and direction marks, the byte order mark) and quotes, backticks or
// angle brackets wrapped round it are not part of the code. Short invite codes (ACIRA-XXXX-XXXX) and move codes are NOT codes of this build.
const { parseInsiderLink, TOKEN } = require('./insider-link.cjs');

const MAX_INPUT = 400;
/** Soft hyphens, zero-width and direction marks, the word joiner and the byte order mark: what a copied code can carry without showing. */
const chars = (...codes) => codes.map((code) => String.fromCharCode(code)).join('');
const INVISIBLE = new RegExp(`[${chars(0xad, 0x200b)}-${chars(0x200f, 0x202a)}-${chars(0x202e, 0x2060)}-${chars(0x2064, 0xfeff)}]`, 'g'); // U+00AD, U+200B-U+200F, U+202A-U+202E, U+2060-U+2064, U+FEFF
/** What chat apps and quoting put round a pasted code. */
const WRAP = `\\s"'\`<>${chars(0xab, 0xbb, 0x201c, 0x201d, 0x2018, 0x2019)}()[\\]`;
const WRAPPERS = new RegExp(`^[${WRAP}]+|[${WRAP}]+$`, 'g');
const LINK_IN_TEXT = /acira:\/\/insider\/activate\?[^\s"'`<>]*/i;

/**
 * Whatever was typed into "Insider code": {ok:true, token} or {ok:false, reason: 'empty'|'long'|'shape'}.
 * 'shape' covers everything that is not a token or the link (too short, too long, other characters, a short invite code, a link with anything else in it).
 */
function parseEntry(input) {
  if (typeof input !== 'string') return { ok: false, reason: 'empty' };
  if (input.length > MAX_INPUT) return { ok: false, reason: 'long' };
  const plain = input.normalize('NFKC').replace(INVISIBLE, '');
  if (!plain.trim().length) return { ok: false, reason: 'empty' };
  const link = LINK_IN_TEXT.exec(plain);
  if (link) {
    const token = parseInsiderLink(link[0].replace(/[.,;:!?)\]]+$/, ''));
    return token ? { ok: true, token } : { ok: false, reason: 'shape' };
  }
  const bare = plain.replace(WRAPPERS, '');
  return TOKEN.test(bare) ? { ok: true, token: bare } : { ok: false, reason: 'shape' };
}

module.exports = { parseEntry, MAX_INPUT };
