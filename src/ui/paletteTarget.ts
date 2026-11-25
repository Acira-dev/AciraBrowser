import type { PaletteItem } from './paletteResults';

/** Where a Command search result goes when it is chosen.
 *  switch: an open tab is shown (it is already open, so no key opens a second copy); run: a command runs;
 *  here / new: a page, a history item or a web search opens in the current tab or in a new one.
 *  `newTabByDefault` is Settings › Tabs › "Command search opens results in a new tab"; `modifier` is Alt+Enter (Option+Enter on a Mac),
 *  the key the address bar already uses for "open this in a new tab", or an Alt, Ctrl or Cmd click. The modifier always chooses the other tab. */
export type PaletteOpen = 'switch' | 'run' | 'here' | 'new';
/** How the modifier reads in text: the address bar's Alt+Enter, Option+Enter on a Mac (the key names stay as printed on the keys, in every language). */
export const paletteModifierKey = (mac: boolean) => (mac ? '⌥↵' : 'Alt+Enter');
export function paletteOpen(kind: PaletteItem['kind'], newTabByDefault: boolean, modifier: boolean): PaletteOpen {
  if (kind === 'tab') return 'switch';
  if (kind === 'command' || kind === 'setting') return 'run';
  return newTabByDefault !== modifier ? 'new' : 'here';
}
