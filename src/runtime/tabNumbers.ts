import type { BrowserSnapshot } from './types';
import { listedTabs } from './favoriteTabs';

/** The figure Ctrl/Cmd+1…9 answers to, for each tab: what the tab numbers show while the key is held.
 *
 *  It reads the shortcut, it does not invent a second rule. Main's `select-tab` takes `listedTabs(state)[digit - 1]` for 1…8
 *  and the last listed tab for 9 (desktop/shortcuts.cjs, desktop/main.cjs), so this walks the same digits over the same list:
 *  favorites' own tabs have no number in the sidebar layout (they live in their tiles, not in listedTabs), pinned tabs and the
 *  tabs of groups count by their place in the list, and a tab inside a collapsed group keeps its number (the shortcut still
 *  goes there; the sidebar has no row to draw it on).
 *
 *  Two digits (desktop/tab-numbers.cjs): with the modifier down, 1 then 5 within a moment goes to tab 15, so every tab from the tenth
 *  to the ninety-ninth shows its own place. Tab 9 has no figure once there are ten tabs (Ctrl+9 alone is the LAST tab; no digit is
 *  left to say 9). Under ten tabs only the first eight and the last one are reachable, and the last one is 9. A tab the shortcut
 *  reaches two ways (the last of twelve is 12, and Ctrl+9) shows its own place, and the last of a hundred or more, which has none, shows 9.
 *
 *  `keys` are the digits whose Ctrl/Cmd chord still runs `select-tab` (main checks the user's own key bindings and sends them),
 *  so a number is never shown for a key that now does something else; a two-digit place needs its first digit among them. Pure. */
export const TAB_NUMBER_DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
/** The most tabs a two-digit number can reach. */
export const TAB_NUMBER_MAX = 99;
export function tabNumbers(state: BrowserSnapshot, keys: readonly number[] = TAB_NUMBER_DIGITS): Map<string, number> {
  const here = listedTabs(state), out = new Map<string, number>(), allowed = new Set(keys);
  for (let place = 1; place <= Math.min(here.length, TAB_NUMBER_MAX); place++) {
    // 1…8 are their own key; from 10 on the figure is typed as two digits (9 is the last tab, below).
    const tab = here[place - 1];
    if (place === 9 || !tab) continue;
    if (place < 9 ? allowed.has(place) : allowed.has(Math.floor(place / 10))) out.set(tab.id, place);
  }
  // Ctrl+9 = the last tab: its figure is 9 unless it already carries its own place.
  const last = here.at(-1);
  if (last && allowed.has(9) && !out.has(last.id)) out.set(last.id, 9);
  return out;
}

/** The place a typed first digit leads to, for dimming the others while it waits: tabs 10d…10d+9 match digit d. */
export function tabNumberMatches(figure: number, typed: number): boolean {
  return figure >= 10 && Math.floor(figure / 10) === typed;
}
