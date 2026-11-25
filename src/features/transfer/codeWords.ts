// The receiving side's helpers for the transfer code, a TypeScript port of desktop/transfer/code.cjs (tests/transfer-code-words.test.ts keeps the two
// equal on random input). Five words from the 2,048-word BIP-39 English list; every word is unique by its first 4 letters (often by 3), so a typed
// prefix completes to one word, and a typo is suggested within edit distance 2. The words are English in every interface language: they are data.
// The list is the very file main reads (desktop/transfer/words.json), so the two can never drift apart.
import WORD_LIST from '../../../desktop/transfer/words.json';

/** The 2,048 words, in the list's order. */
export const WORDS: readonly string[] = WORD_LIST as string[];
/** How many words make a code (desktop/transfer/constants.cjs CODE_WORDS). */
export const CODE_WORDS = 5;

const INDEX = new Map(WORDS.map((word, at) => [word, at]));
/** What may sit between typed words: whitespace, hyphen, underscore, period, comma and the middle dot. */
export const SEPARATOR = /[\s\-_.,·]+/;

/** The typed pieces of a text, lowercase, empty pieces dropped. */
export const tokens = (text: unknown): string[] => String(text ?? '').normalize('NFKC').toLowerCase().split(SEPARATOR).filter(Boolean);

/** The list word a typed piece stands for: the word itself, or a piece of 4 or more letters that starts exactly one word. Otherwise null. */
export function resolveWord(piece: unknown): string | null {
  const token = String(piece ?? '').toLowerCase();
  if (INDEX.has(token)) return token;
  if (token.length < 4 || !/^[a-z]+$/.test(token)) return null;
  let found: string | null = null;
  for (const word of WORDS) {
    if (!word.startsWith(token)) continue;
    if (found) return null;
    found = word;
  }
  return found;
}

/** Words that complete what is typed so far (at most `limit`); one means the rest can show as ghost text. */
export function complete(prefix: unknown, limit = 8): string[] {
  const token = String(prefix ?? '').toLowerCase();
  if (!token || !/^[a-z]+$/.test(token)) return [];
  const out: string[] = [];
  for (const word of WORDS) if (word.startsWith(token)) { out.push(word); if (out.length >= limit) break; }
  return out;
}

/** The ghost text for what is typed: the rest of the one word it completes to, or '' (nothing, several words, or the word is already whole). */
export function ghostFor(typed: string): string {
  const token = typed.toLowerCase();
  if (!token) return '';
  const found = complete(token, 2);
  return found.length === 1 && found[0].length > token.length ? found[0].slice(token.length) : '';
}

/** The text read piece by piece, for the code field's chips: [{ token, word }] with word null for an unknown piece. */
export const readPieces = (text: unknown): { token: string; word: string | null }[] => tokens(text).map((token) => ({ token, word: resolveWord(token) }));

/** The code in a text: the five words as an array, or null unless there are exactly CODE_WORDS known words (4 or 6 are refused). */
export function parseCode(text: unknown): string[] | null {
  const words = Array.isArray(text) ? text.map((piece) => resolveWord(piece)) : readPieces(text).map((piece) => piece.word);
  if (words.length !== CODE_WORDS || words.some((word) => !word)) return null;
  return words as string[];
}

/** Damerau-Levenshtein distance (the restricted form: one swap of neighbours counts as one step), cut off above `max`. */
export function distance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const rows: number[][] = [];
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
export function suggest(piece: unknown, limit = 3): string[] {
  const token = String(piece ?? '').toLowerCase();
  if (!token || INDEX.has(token) || token.length > 12) return [];
  const near: [number, string][] = [];
  for (const word of WORDS) { const d = distance(token, word); if (d <= 2) near.push([d, word]); }
  return near.sort((x, y) => x[0] - y[0] || (x[1] < y[1] ? -1 : 1)).slice(0, limit).map(([, word]) => word);
}

/** Is this exactly a word on the list? */
export const isCodeWord = (word: string): boolean => INDEX.has(word);
