import { useMemo, useSyncExternalStore } from 'react';
import { runtime } from '../runtime/client';
import { tabNumbers } from '../runtime/tabNumbers';
import type { BrowserSnapshot } from '../runtime/types';

/** Tab numbers while Ctrl/Cmd is held (desktop/tab-numbers.cjs decides when; the key reaches main whichever page has focus,
 *  so nothing here listens to the keyboard and nothing moves focus). Main sends `{type:'tab-numbers', shown, keys}`: `shown`
 *  goes true after the key has been held alone for a short moment and false at once on release, on any other key and when the
 *  window loses focus; `keys` are the digits whose chord still goes to a tab; `typed` is the first digit of a two-digit number that is
 *  waiting for its second (1…9, tabs 10…19 for 1), or absent. Not part of the BrowserEvent union (main's own message, like 'overlay-warmup'). */
/** What main last said about the held key, as the sidebar draws it. `leaving`: Ctrl/Cmd was let go and the figures are fading out (Beta 14: they fade in and
 *  out, they do not pop). They stay in the tree for FADE_MS and go with the fade; pressing again while they fade brings them back from where they are (the CSS
 *  transition reverses). */
export interface HeldShape { keys: readonly number[]; typed: number | null; leaving: boolean }
/** Longer than the CSS fade (tab-numbers.css, --sb-dur 120 ms at the slowest pace) so the figures are never taken away mid-fade. */
export const FADE_MS = 200;

export interface TabNumbersStore { subscribe(listener: () => void): () => void; get(): HeldShape | null }
/** The store behind useTabNumbers, over any `subscribeBrowser` (the timers are injectable so a test drives the clock). The defaults are arrow functions on purpose: a bare setTimeout kept as the `set` property and called as
 *  `timers.set(...)` has the timers object as `this`, and a browser's setTimeout throws "Illegal invocation" for that (found in the real app: the released figures stayed in the tree at no ink). */
export function createTabNumbersStore(subscribeBrowser: (listener: (event: unknown) => void) => () => void, timers: { set: (fn: () => void, ms: number) => unknown; clear: (id: unknown) => void } = { set: (fn, ms) => setTimeout(fn, ms), clear: id => clearTimeout(id as ReturnType<typeof setTimeout>) }): TabNumbersStore {
  let shape: HeldShape | null = null, stop: (() => void) | null = null, fadeTimer: unknown = null;
  const listeners = new Set<() => void>();
  const tell = () => listeners.forEach(listener => listener());
  const clearFade = () => { if (fadeTimer !== null) { timers.clear(fadeTimer); fadeTimer = null; } };
  function connect(): void {
    if (stop) return;
    stop = subscribeBrowser(event => {
      const raw = event as { type: string; shown?: boolean; keys?: unknown; typed?: unknown };
      if (raw.type !== 'tab-numbers') return;
      if (raw.shown !== true) {
        // released: the figures stay and fade out, then go
        if (shape === null || shape.leaving) return;
        shape = { ...shape, leaving: true };
        tell();
        clearFade();
        fadeTimer = timers.set(() => { fadeTimer = null; if (shape?.leaving) { shape = null; tell(); } }, FADE_MS);
        return;
      }
      const next: HeldShape = { keys: Array.isArray(raw.keys) ? raw.keys.filter((key): key is number => Number.isInteger(key) && key >= 1 && key <= 9) : [], typed: Number.isInteger(raw.typed) && (raw.typed as number) >= 1 && (raw.typed as number) <= 9 ? (raw.typed as number) : null, leaving: false };
      clearFade();
      if (shape && !shape.leaving && next.typed === shape.typed && next.keys.length === shape.keys.length && next.keys.every((key, at) => key === shape!.keys[at])) return;
      shape = next;
      tell();
    });
  }
  return {
    subscribe(listener) {
      listeners.add(listener); connect();
      return () => { listeners.delete(listener); if (!listeners.size && stop) { stop(); stop = null; shape = null; clearFade(); } };
    },
    get: () => shape,
  };
}
const store = createTabNumbersStore(listener => runtime.subscribeBrowser(listener as Parameters<typeof runtime.subscribeBrowser>[0]));

/** What to draw while the key is held, or null (the usual case) when nothing is shown: the tab id → figure map, and the first digit of a
 *  two-digit number that is waiting for its second (null when none; the figures it can still lead to are the ones to highlight). */
export interface TabNumbersView { figures: ReadonlyMap<string, number>; typed: number | null; leaving: boolean }
export function useTabNumbers(state: BrowserSnapshot): TabNumbersView | null {
  const held = useSyncExternalStore(store.subscribe, store.get, () => null);
  return useMemo(() => held ? { figures: tabNumbers(state, held.keys), typed: held.typed, leaving: held.leaving } : null, [held, state]);
}
