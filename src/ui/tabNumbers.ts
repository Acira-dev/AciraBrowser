import { useMemo, useSyncExternalStore } from 'react';
import { runtime } from '../runtime/client';
import { tabNumbers } from '../runtime/tabNumbers';
import type { BrowserSnapshot } from '../runtime/types';

/** Tab numbers while Ctrl/Cmd is held (desktop/tab-numbers.cjs decides when; the key reaches main whichever page has focus,
 *  so nothing here listens to the keyboard and nothing moves focus). Main sends `{type:'tab-numbers', shown, keys}`: `shown`
 *  goes true after the key has been held alone for a short moment and false at once on release, on any other key and when the
 *  window loses focus; `keys` are the digits whose chord still goes to a tab; `typed` is the first digit of a two-digit number that is
 *  waiting for its second (1…9, tabs 10…19 for 1), or absent. Not part of the BrowserEvent union (main's own message, like 'overlay-warmup'). */
let shape: { keys: readonly number[]; typed: number | null } | null = null;
const listeners = new Set<() => void>();
let stop: (() => void) | null = null;

function connect(): void {
  if (stop) return;
  stop = runtime.subscribeBrowser(event => {
    const raw = event as { type: string; shown?: boolean; keys?: unknown; typed?: unknown };
    if (raw.type !== 'tab-numbers') return;
    const next = raw.shown === true
      ? { keys: Array.isArray(raw.keys) ? raw.keys.filter((key): key is number => Number.isInteger(key) && key >= 1 && key <= 9) : [], typed: Number.isInteger(raw.typed) && (raw.typed as number) >= 1 && (raw.typed as number) <= 9 ? (raw.typed as number) : null }
      : null;
    if (next === null && shape === null) return;
    if (next && shape && next.typed === shape.typed && next.keys.length === shape.keys.length && next.keys.every((key, at) => key === shape!.keys[at])) return;
    shape = next;
    listeners.forEach(listener => listener());
  });
}
function subscribe(listener: () => void): () => void {
  listeners.add(listener); connect();
  return () => { listeners.delete(listener); if (!listeners.size && stop) { stop(); stop = null; shape = null; } };
}

/** What to draw while the key is held, or null (the usual case) when nothing is shown: the tab id → figure map, and the first digit of a
 *  two-digit number that is waiting for its second (null when none; the figures it can still lead to are the ones to highlight). */
export interface TabNumbersView { figures: ReadonlyMap<string, number>; typed: number | null }
export function useTabNumbers(state: BrowserSnapshot): TabNumbersView | null {
  const held = useSyncExternalStore(subscribe, () => shape, () => null);
  return useMemo(() => held ? { figures: tabNumbers(state, held.keys), typed: held.typed } : null, [held, state]);
}
