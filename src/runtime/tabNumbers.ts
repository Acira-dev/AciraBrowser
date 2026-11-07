import type { BrowserSnapshot } from './types';
import { listedTabs } from './favoriteTabs';

/** The figure Ctrl/Cmd+1…9 answers to, for each tab: what the tab numbers show while the key is held.
 *
 *  It reads the shortcut, it does not invent a second rule. Main's `select-tab` takes `listedTabs(state)[digit - 1]` for 1…8
 *  and the last listed tab for 9 (desktop/shortcuts.cjs, desktop/main.cjs), so this walks the same digits over the same list:
 *  favorites' own tabs have no number in the sidebar layout (they live in their tiles, not in listedTabs), pinned tabs and the
 *  tabs of groups count by their place in the list, and a tab inside a collapsed group keeps its number (the shortcut still
 *  goes there; the sidebar has no row to draw it on). Past eight tabs only the first eight and the last one are reachable, and
 *  the last one is 9. A tab the shortcut reaches by two digits (the last tab of three is 3 and 9) shows the lower one.
 *
 *  `keys` are the digits whose Ctrl/Cmd chord still runs `select-tab` (main checks the user's own key bindings and sends them),
 *  so a number is never shown for a key that now does something else. Pure. */
export const TAB_NUMBER_DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
export function tabNumbers(state: BrowserSnapshot, keys: readonly number[] = TAB_NUMBER_DIGITS): Map<string, number> {
  const here = listedTabs(state), out = new Map<string, number>(), allowed = new Set(keys);
  for (const digit of TAB_NUMBER_DIGITS) {
    // The same expression as main's `select-tab`: index -1 is the last tab.
    const index = digit === 9 ? -1 : digit - 1, tab = index < 0 ? here.at(-1) : here[index];
    if (tab && allowed.has(digit) && !out.has(tab.id)) out.set(tab.id, digit);
  }
  return out;
}
