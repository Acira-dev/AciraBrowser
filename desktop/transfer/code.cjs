'use strict';
// The transfer code: five words from the BIP-39 English list (2,048 words, 55 bits). Make one, read what a person typed or pasted, suggest a
// word for a typo, and hide a code that ended up in a piece of text (a log line). The list is data in words.json; its first four letters are
// unique per word, so four letters (often three) name a word. Sections 3.1, 4.3 R1 and 7.5 of the design notes.
const crypto = require('node:crypto');
const WORDS = require('./words.json');
const { CODE_WORDS } = require('./constants.cjs');

const INDEX = new Map(WORDS.map((word, at) => [word, at]));
/** What may sit between typed words: whitespace, hyphen, underscore, period, comma and the middle dot. */
const SEPARATOR = /[\s\-_.,\u00b7]+/;
const MASK = '[transfer code]';

/** A fresh code: CODE_WORDS words, each an unbiased draw from the whole list. */
function makeCode(random = crypto.randomInt) {
  const words = [];
  for (let at = 0; at < CODE_WORDS; at++) words.push(WORDS[random(WORDS.length)]);
  return words;
}

/** The one canonical text of a code (lowercase, single spaces): what the key derivation hashes, whatever the person typed. */
const canonical = (words) => words.join(' ');
/** What Copy puts on the clipboard. */
const dashed = (words) => words.join('-');

/** The typed pieces of a text, lowercase, empty pieces dropped. */
const tokens = (text) => String(text ?? '').normalize('NFKC').toLowerCase().split(SEPARATOR).filter(Boolean);

/** The list word a typed piece stands for: the word itself, or a piece of 4 or more letters that starts exactly one word. Otherwise null. */
function resolveWord(piece) {
  const token = String(piece ?? '').toLowerCase();
  if (INDEX.has(token)) return token;
  if (token.length < 4 || !/^[a-z]+$/.test(token)) return null;
  let found = null;
  for (const word of WORDS) {
    if (!word.startsWith(token)) continue;
    if (found) return null;
    found = word;
  }
  return found;
}

/** Words that complete what is typed so far (at most `limit`); one means the rest can show as ghost text. */
function complete(prefix, limit = 8) {
  const token = String(prefix ?? '').toLowerCase();
  if (!token || !/^[a-z]+$/.test(token)) return [];
  const out = [];
  for (const word of WORDS) if (word.startsWith(token)) { out.push(word); if (out.length >= limit) break; }
  return out;
}

/** The text read piece by piece, for the code field's chips: [{ token, word }] with word null for an unknown piece. */
const readPieces = (text) => tokens(text).map((token) => ({ token, word: resolveWord(token) }));

/** The code in a text: the five words as an array, or null unless there are exactly CODE_WORDS known words (4 or 6 are refused). */
function parseCode(text) {
  const words = Array.isArray(text) ? text.map((piece) => resolveWord(piece)) : readPieces(text).map((piece) => piece.word);
  if (words.length !== CODE_WORDS || words.some((word) => !word)) return null;
  return words;
}

/** Damerau-Levenshtein distance (the restricted form: one swap of neighbours counts as one step), cut off above `max`. */
function distance(a, b, max = 2) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const rows = [];
  for (let i = 0; i <= a.length; i++) { rows.push(new Array(b.length + 1).fill(0)); rows[i][0] = i; }
  for (let j = 0; j <= b.length; j++) rows[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    const cost = a[i - 1] === b[j - 1] ? 0 : 1;
    rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1);
  }
  return rows[a.length][b.length];
}

/** "Did you mean ...?": the list words within edit distance 2 of a mistyped piece, nearest first, then alphabetical. */
function suggest(piece, limit = 3) {
  const token = String(piece ?? '').toLowerCase();
  if (!token || INDEX.has(token) || token.length > 12) return [];
  const near = [];
  for (const word of WORDS) { const d = distance(token, word); if (d <= 2) near.push([d, word]); }
  return near.sort((x, y) => x[0] - y[0] || (x[1] < y[1] ? -1 : 1)).slice(0, limit).map(([, word]) => word);
}

/** Hides every run of CODE_WORDS (or more) list words in a text, however they are separated: for log lines and error text, so a code never lands
 * in a file. A run of ordinary words that happen to be on the list is hidden too; that only costs a log line some detail. */
function maskCodes(text) {
  const source = String(text ?? '');
  const pieces = [...source.matchAll(/[A-Za-z]+/g)];
  const hidden = [];
  let run = [];
  const close = () => { if (run.length >= CODE_WORDS) hidden.push([run[0].index, run[run.length - 1].index + run[run.length - 1][0].length]); run = []; };
  const GAP = /^[\s\-_.,\u00b7]+$/;
  for (const piece of pieces) {
    const last = run[run.length - 1];
    // A word continues the run only when nothing but separators sits between it and the one before.
    if (last && !GAP.test(source.slice(last.index + last[0].length, piece.index))) close();
    if (INDEX.has(piece[0].toLowerCase())) run.push(piece); else close();
  }
  close();
  let out = '', at = 0;
  for (const [from, to] of hidden) { out += source.slice(at, from) + MASK; at = to; }
  return out + source.slice(at);
}

module.exports = { WORDS, makeCode, canonical, dashed, tokens, readPieces, resolveWord, complete, parseCode, distance, suggest, maskCodes, MASK, SEPARATOR };
