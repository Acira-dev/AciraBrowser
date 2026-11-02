import { urlDisplay } from './urlDisplay';

/** Selecting text in the address field while it shows the URL at rest (scheme and `www.` hidden, trailing `/` dropped).
 *
 * The at-rest text is an overlay above a transparent input that holds the full address, so the browser placed the drag's
 * anchor in the hidden full text (`https://…`) under the pointer, not in the text the person saw, and the overlay was
 * swapped out on press: every selection landed on other characters. Like Chrome's omnibox, the field now keeps the
 * at-rest text for the whole press, paints the drag over it, and on release shows the full address with the same
 * characters selected (offsets remapped through `addressDisplayMap`). A plain click selects the whole address. */

/** The text the field shows at rest, and how its offsets map into the full address held by the input. */
export interface AddressDisplayMap {
  text: string;
  /** Full-address index of each shown character (−1 when the shown character has no exact twin, e.g. decoded text). */
  index: number[];
  full: string;
}

/** Where the shown text begins in the full address: after `scheme://`, any `user:pass@`, and a hidden `www.`. */
function hostStart(full: string, shown: string): number {
  const scheme = full.indexOf('://');
  if (scheme < 0 || /^acira:/i.test(full)) return 0;
  let at = scheme + 3;
  const end = full.slice(at).search(/[/?#]/), authority = end < 0 ? full.slice(at) : full.slice(at, at + end), user = authority.lastIndexOf('@');
  if (user >= 0) at += user + 1;
  if (full.slice(at, at + 4).toLowerCase() === 'www.' && !shown.toLowerCase().startsWith('www.')) at += 4;
  return at;
}

/** Aligns the shown text with the full address. Shown text is the full address with pieces left out (scheme, `www.`, a
 * lone `/` path), so each shown character is matched to the next equal character from where the host starts; a shown
 * character with no twin (decoded punycode or percent-escapes, if the display ever does that) is left unmatched and
 * takes the gap between its matched neighbours. */
export function alignDisplay(full: string, shown: string): number[] {
  const index: number[] = [], lower = full.toLowerCase(), want = shown.toLowerCase();
  let at = hostStart(full, shown);
  for (let i = 0; i < want.length; i += 1) {
    const found = lower.indexOf(want[i], at);
    // Only a short skip counts as a left-out piece (`/` before `?`); a far match means this character was rewritten.
    if (found < 0 || found - at > 16) { index.push(-1); continue; }
    index.push(found); at = found + 1;
  }
  return index;
}

export function addressDisplayMap(full: string): AddressDisplayMap | null {
  const display = urlDisplay(full);
  if (!display) return null;
  const text = display.prefix + display.domain + display.rest;
  return { text, index: alignDisplay(full, text), full };
}

/** Full-address offset where a selection that starts before shown character `offset` starts. */
function startOf(map: AddressDisplayMap, offset: number): number {
  const { index, full, text } = map;
  if (offset >= text.length) return endOf(map, text.length);
  if (index[offset] >= 0) return index[offset];
  for (let i = offset - 1; i >= 0; i -= 1) if (index[i] >= 0) return index[i] + 1;
  return hostStart(full, text);
}

/** Full-address offset where a selection that ends after shown character `offset - 1` ends. */
function endOf(map: AddressDisplayMap, offset: number): number {
  const { index, full } = map;
  if (offset <= 0) return startOf(map, 0);
  if (index[offset - 1] >= 0) return index[offset - 1] + 1;
  for (let i = offset; i < index.length; i += 1) if (index[i] >= 0) return index[i];
  return full.length;
}

export interface FullSelection { start: number; end: number; direction: 'forward' | 'backward' | 'none' }

/** The full-address selection holding exactly the shown characters between `anchor` and `focus` (caret offsets in the
 * shown text; focus before anchor is a backward drag). */
export function mapDisplaySelection(map: AddressDisplayMap, anchor: number, focus: number): FullSelection {
  const clamp = (n: number) => Math.max(0, Math.min(map.text.length, n));
  const a = clamp(anchor), f = clamp(focus), lo = Math.min(a, f), hi = Math.max(a, f);
  if (lo === hi) { const at = startOf(map, lo); return { start: at, end: at, direction: 'none' }; }
  return { start: startOf(map, lo), end: endOf(map, hi), direction: f < a ? 'backward' : 'forward' };
}

/** Full-address offset of shown character `char` (for double-click: the word is found in the full address). */
export function mapDisplayChar(map: AddressDisplayMap, char: number): number {
  return startOf(map, Math.max(0, Math.min(map.text.length - 1, char)));
}

/** The word (or the run of punctuation) holding character `at`, the way a text field's double-click finds it. */
export function wordAt(text: string, at: number): { start: number; end: number } {
  if (!text) return { start: 0, end: 0 };
  const i = Math.max(0, Math.min(text.length - 1, at));
  const Segmenter = (Intl as unknown as { Segmenter?: new (locale?: string, options?: { granularity: 'word' }) => { segment(input: string): Iterable<{ segment: string; index: number }> } }).Segmenter;
  if (Segmenter) {
    for (const part of new Segmenter(undefined, { granularity: 'word' }).segment(text)) {
      if (i >= part.index && i < part.index + part.segment.length) return { start: part.index, end: part.index + part.segment.length };
    }
  }
  const word = /[\p{L}\p{N}_-]/u, same = (c: string) => word.test(c) === word.test(text[i]);
  let start = i, end = i + 1;
  while (start > 0 && same(text[start - 1])) start -= 1;
  while (end < text.length && same(text[end])) end += 1;
  return { start, end };
}

/** Caret offset (0…n) and character (0…n−1) under `x`, given the left edge of every shown character plus the right edge
 * of the last (`edges.length === n + 1`). Past `clipRight` (the drag left an ellipsised field) the caret is the end. */
export function hitDisplay(edges: readonly number[], x: number, clipRight = Infinity): { caret: number; char: number } {
  const n = edges.length - 1;
  if (n <= 0) return { caret: 0, char: 0 };
  if (x >= clipRight) return { caret: n, char: n - 1 };
  let char = 0;
  while (char < n - 1 && x >= edges[char + 1]) char += 1;
  const caret = x < edges[0] ? 0 : x >= edges[n] ? n : x - edges[char] < edges[char + 1] - x ? char : char + 1;
  return { caret, char };
}

/* ── Gesture state machine ─────────────────────────────────────────────────────────────────────────────────────────── */

export type AddressGesture =
  | { kind: 'idle' }
  /** Pointer held on the at-rest text: the field is focused but keeps showing it until release. */
  | { kind: 'press'; pointerId: number; x: number; y: number; anchor: number; focus: number; char: number; moved: boolean; shift: boolean }
  /** A plain click just expanded the field and selected it all; a double/triple click that follows refers to `char`. */
  | { kind: 'clicked'; x: number; y: number; char: number; time: number };

export type AddressGestureInput =
  | { type: 'down'; pointerId: number; x: number; y: number; caret: number; char: number; button: number; detail: number; shift: boolean; time: number; atRest: boolean }
  | { type: 'move'; pointerId: number; x: number; y: number; caret: number }
  | { type: 'up'; pointerId: number; x: number; y: number; caret: number; time: number }
  | { type: 'cancel'; pointerId: number }
  | { type: 'reset' };

export type AddressGestureEffect =
  /** Leave it to the browser (the field already shows the full address, or another button). */
  | { type: 'native' }
  /** Take the press: no native caret/selection, focus the field, keep the at-rest text. */
  | { type: 'hold'; anchor: number; focus: number }
  /** Paint the dragged characters over the at-rest text. */
  | { type: 'paint'; anchor: number; focus: number }
  /** Show the full address, all selected. */
  | { type: 'select-all' }
  /** Show the full address with these shown characters selected. */
  | { type: 'select-range'; anchor: number; focus: number }
  /** Select the word around this shown character, in the full address. */
  | { type: 'select-word'; char: number }
  | { type: 'none' };

/** Movement (px) that turns a press into a drag, and the slop/time a double click may stray from the first click. */
export const DRAG_SLOP = 4, MULTI_CLICK_SLOP = 6, MULTI_CLICK_MS = 1000;

export function stepAddressGesture(state: AddressGesture, input: AddressGestureInput): { state: AddressGesture; effect: AddressGestureEffect } {
  const idle: AddressGesture = { kind: 'idle' };
  switch (input.type) {
    case 'down': {
      if (input.button !== 0) return { state: idle, effect: { type: 'native' } };
      if (input.atRest) {
        const anchor = input.shift ? 0 : input.caret;
        return { state: { kind: 'press', pointerId: input.pointerId, x: input.x, y: input.y, anchor, focus: input.caret, char: input.char, moved: false, shift: input.shift }, effect: { type: 'hold', anchor, focus: input.caret } };
      }
      // The second/third press of a click that expanded the field: the text moved under the pointer, so the word is the
      // one under the first press, not whatever the full address now has there.
      if (state.kind === 'clicked' && input.detail >= 2 && !input.shift && input.time - state.time <= MULTI_CLICK_MS && Math.hypot(input.x - state.x, input.y - state.y) <= MULTI_CLICK_SLOP) {
        return { state: input.detail >= 3 ? idle : { ...state, time: input.time }, effect: input.detail >= 3 ? { type: 'select-all' } : { type: 'select-word', char: state.char } };
      }
      return { state: idle, effect: { type: 'native' } };
    }
    case 'move': {
      if (state.kind !== 'press' || state.pointerId !== input.pointerId) return { state, effect: { type: 'none' } };
      const moved = state.moved || Math.hypot(input.x - state.x, input.y - state.y) > DRAG_SLOP;
      const next = { ...state, moved, focus: input.caret };
      return { state: next, effect: moved || state.shift ? { type: 'paint', anchor: next.anchor, focus: next.focus } : { type: 'none' } };
    }
    case 'up': {
      if (state.kind !== 'press' || state.pointerId !== input.pointerId) return { state, effect: { type: 'none' } };
      const moved = state.moved || Math.hypot(input.x - state.x, input.y - state.y) > DRAG_SLOP;
      if (!moved && !state.shift) return { state: { kind: 'clicked', x: state.x, y: state.y, char: state.char, time: input.time }, effect: { type: 'select-all' } };
      return { state: idle, effect: { type: 'select-range', anchor: state.anchor, focus: moved ? input.caret : state.focus } };
    }
    case 'cancel':
      if (state.kind !== 'press' || state.pointerId !== input.pointerId) return { state, effect: { type: 'none' } };
      return { state: idle, effect: { type: 'select-all' } };
    case 'reset':
      return { state: idle, effect: { type: 'none' } };
  }
}
