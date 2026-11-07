import { useMemo, useSyncExternalStore } from 'react';
import { runtime } from '../runtime/client';
import { tabNumbers } from '../runtime/tabNumbers';
import type { BrowserSnapshot } from '../runtime/types';

/** Tab numbers while Ctrl/Cmd is held (desktop/tab-numbers.cjs decides when; the key reaches main whichever page has focus,
 *  so nothing here listens to the keyboard and nothing moves focus). Main sends `{type:'tab-numbers', shown, keys}`: `shown`
 *  goes true after the key has been held alone for a short moment and false at once on release, on any other key and when the
 *  window loses focus; `keys` are the digits whose chord still goes to a tab. Not part of the BrowserEvent union (main's own
 *  message, like 'overlay-warmup'). */
let digits: readonly number[] | null = null;
const listeners = new Set<() => void>();
let stop: (() => void) | null = null;

function connect(): void {
  if (stop) return;
  stop = runtime.subscribeBrowser(event => {
    const raw = event as { type: string; shown?: boolean; keys?: unknown };
    if (raw.type !== 'tab-numbers') return;
    const next = raw.shown === true ? (Array.isArray(raw.keys) ? raw.keys.filter((key): key is number => Number.isInteger(key) && key >= 1 && key <= 9) : []) : null;
    if (next === null && digits === null) return;
    digits = next;
    listeners.forEach(listener => listener());
  });
}
function subscribe(listener: () => void): () => void {
  listeners.add(listener); connect();
  return () => { listeners.delete(listener); if (!listeners.size && stop) { stop(); stop = null; digits = null; } };
}

/** The tab id → figure map to draw while the key is held, or null (the usual case) when nothing is shown. */
export function useTabNumbers(state: BrowserSnapshot): ReadonlyMap<string, number> | null {
  const held = useSyncExternalStore(subscribe, () => digits, () => null);
  return useMemo(() => held ? tabNumbers(state, held) : null, [held, state]);
}
