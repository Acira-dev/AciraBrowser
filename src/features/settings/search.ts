import { isAvailable, type SettingsContext, type SettingsEntry } from './model';

export interface SettingsHit {
  entry: SettingsEntry;
  score: number;
  /** Synonym that matched when the title did not, e.g. "dark mode" → Appearance. */
  via?: string;
}

const fold = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

const words = (value: string) => (value ? value.split(' ') : []);

/** Tokens a query word may stand for: itself and a naive singular. */
const forms = (token: string) => (token.length > 3 && token.endsWith('s') ? [token, token.slice(0, -1)] : [token]);

function fieldScore(field: string, fieldWords: string[], token: string, weights: { start: number; inside: number }) {
  let best = 0;
  for (const form of forms(token)) {
    if (fieldWords.some((word) => word.startsWith(form))) best = Math.max(best, weights.start);
    else if (field.includes(form)) best = Math.max(best, weights.inside);
  }
  return best;
}

/** A signpost entry whose synonym is the whole query ("sidebar", "vertical tabs", "layout") leads the list: worth an exact title match. */
const SIGNPOST_BONUS = 140;

export function scoreEntry(entry: SettingsEntry, query: string): SettingsHit | undefined {
  const folded = fold(query);
  const tokens = words(folded);
  if (!tokens.length) return undefined;
  const title = fold(entry.title);
  const titleWords = words(title);
  const description = fold(entry.description);
  const descriptionWords = words(description);
  const place = fold(`${entry.section} ${entry.group ?? ''}`);
  const placeWords = words(place);
  const aliases = entry.aliases.map(fold);
  let total = 0;
  let via: string | undefined;
  let viaScore = 0;
  for (const token of tokens) {
    let best = fieldScore(title, titleWords, token, { start: 100, inside: 55 });
    for (const alias of aliases) {
      const score = fieldScore(alias, words(alias), token, { start: 72, inside: 40 });
      if (score > best) best = score;
      if (score > viaScore && score >= 40) {
        viaScore = score;
        via = alias;
      }
    }
    best = Math.max(best, fieldScore(place, placeWords, token, { start: 34, inside: 18 }), fieldScore(description, descriptionWords, token, { start: 26, inside: 12 }));
    if (!best) return undefined;
    total += best;
  }
  if (title === folded) total += 140;
  else if (title.startsWith(folded)) total += 70;
  else if (title.includes(folded)) total += 30;
  if (entry.signpost && aliases.includes(folded)) total += SIGNPOST_BONUS;
  const titleCovered = tokens.every((token) => fieldScore(title, titleWords, token, { start: 1, inside: 1 }));
  return { entry, score: total, via: titleCovered ? undefined : via };
}

/* ── Typo tolerance (R4-27): "seemless", "compackt", "phising" still find their setting. Used only when nothing matches as typed. ── */

/** Damerau–Levenshtein distance (optimal string alignment): an insert, a delete, a substitution and the swap of two neighbours each cost 1. Stops early past `max`. */
export function editDistance(a: string, b: string, max = 3): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const rows: number[][] = [];
  for (let i = 0; i <= a.length; i++) { rows.push(new Array<number>(b.length + 1).fill(0)); rows[i][0] = i; }
  for (let j = 0; j <= b.length; j++) rows[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let low = max + 1;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) value = Math.min(value, rows[i - 2][j - 2] + 1);
      rows[i][j] = value;
      low = Math.min(low, value);
    }
    if (low > max) return max + 1;
  }
  return rows[a.length][b.length];
}

/** One edit for a word of up to five letters, two for a longer one. Words under four letters are never corrected (too many neighbours). */
const MIN_FUZZY_LENGTH = 4;
const tolerance = (length: number) => (length <= 5 ? 1 : 2);
/** A correction shows the closest few only. */
const FUZZY_LIMIT = 3;

/** Every word a person could mean: the words of titles, synonyms, sections and groups, weighted by where they appear. */
const vocabularies = new WeakMap<readonly SettingsEntry[], Map<string, number>>();
function vocabularyOf(entries: readonly SettingsEntry[]): Map<string, number> {
  let vocabulary = vocabularies.get(entries);
  if (vocabulary) return vocabulary;
  vocabulary = new Map();
  const add = (text: string, weight: number) => { for (const word of words(fold(text))) if (word.length >= MIN_FUZZY_LENGTH) vocabulary!.set(word, (vocabulary!.get(word) ?? 0) + weight); };
  for (const entry of entries) {
    add(entry.title, 3);
    for (const alias of entry.aliases) add(alias, 2);
    add(entry.section, 1);
    if (entry.group) add(entry.group, 1);
  }
  vocabularies.set(entries, vocabulary);
  return vocabulary;
}

const before = (a: number[], b: number[]) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i]; return false; };

/** The word a typed word most likely means, or undefined. Whole-word edits first; a word typed only halfway ("seamk") may also be one edit from the start of a longer one. */
function closestWord(token: string, vocabulary: Map<string, number>): string | undefined {
  const limit = tolerance(token.length);
  let best: { word: string; key: number[] } | undefined;
  for (const [word, weight] of vocabulary) {
    let distance = editDistance(token, word, limit), prefix = 0;
    if (word.length > token.length && token.length > 4) {
      for (const length of [token.length - 1, token.length, token.length + 1]) {
        if (length >= word.length) continue;
        const start = editDistance(token, word.slice(0, length), limit);
        if (start < distance) { distance = start; prefix = 1; }
      }
    }
    if (!distance || distance > limit) continue;
    // Closest first; a whole word beats the start of a longer one; then the nearest length; then the word the index uses most.
    const key = [distance, prefix, Math.abs(word.length - token.length), -weight];
    if (!best || before(key, best.key)) best = { word, key };
  }
  return best?.word;
}

/** The query with each word that matches nothing replaced by its closest word in the index; undefined when no word changed. */
export function correctQuery(entries: readonly SettingsEntry[], query: string): string | undefined {
  const tokens = words(fold(query));
  const vocabulary = vocabularyOf(entries);
  let changed = false;
  const corrected = tokens.map((token) => {
    if (token.length < MIN_FUZZY_LENGTH) return token;
    for (const form of forms(token)) for (const word of vocabulary.keys()) if (word.includes(form)) return token; // already a word, or part of one, in the index
    const fixed = closestWord(token, vocabulary);
    if (!fixed) return token;
    changed = true;
    return fixed;
  });
  return changed ? corrected.join(' ') : undefined;
}

export interface SettingsSearchResult {
  hits: SettingsHit[];
  /** Set when nothing matched as typed and these are the closest few for this corrected query ("Showing results for …"). */
  corrected?: string;
}

/** Ranked, as-you-type results; when nothing matches as typed, the closest one to three for the corrected spelling. */
export function searchSettingsDetailed(entries: readonly SettingsEntry[], query: string, context: SettingsContext, limit = 8): SettingsSearchResult {
  const exact = rank(entries, query, context, limit);
  if (exact.length) return { hits: exact };
  const corrected = correctQuery(entries, query);
  if (!corrected) return { hits: [] };
  const hits = rank(entries, corrected, context, Math.min(limit, FUZZY_LIMIT));
  return hits.length ? { hits, corrected } : { hits: [] };
}

/** Ranked, as-you-type results. Stable: equal scores keep registry order. */
export const searchSettings = (entries: readonly SettingsEntry[], query: string, context: SettingsContext, limit = 8): SettingsHit[] => searchSettingsDetailed(entries, query, context, limit).hits;

function rank(entries: readonly SettingsEntry[], query: string, context: SettingsContext, limit: number): SettingsHit[] {
  return entries
    .filter((entry) => isAvailable(entry, context))
    .map((entry, index) => ({ hit: scoreEntry(entry, query), index }))
    .filter((item): item is { hit: SettingsHit; index: number } => Boolean(item.hit))
    .sort((a, b) => b.hit.score - a.hit.score || a.index - b.index)
    .slice(0, limit)
    .map((item) => item.hit);
}
