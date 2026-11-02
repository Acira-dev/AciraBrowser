/** Split changes never cut (founder, R3-26): when the panes on screen change (a tab dropped on the picker, a layout change,
 *  a pane swap, a pane closed, Unsplit) every page glides from where it was to where it is going, and a page that arrives
 *  flies in from the tab that was dropped. The native website views cannot be animated by the UI, so while the morph runs
 *  they step aside and stills of the pages move in their place (the picker does the same); this module is the pure part:
 *  which panes moved, where each one starts and ends, and which spring tells the story. Rects are in page-area coordinates
 *  and cover each pane's page (below its ribbon). */
export interface MorphRect { x: number; y: number; width: number; height: number }
export interface PaneBox extends MorphRect { tabId: string }
/** What the morph tells: a page joins a split, panes leave it, or panes just trade places and sizes. */
export type MorphIntent = 'merge' | 'split' | 'rearrange';
export interface MorphItem { tabId: string; kind: 'move' | 'enter' | 'exit'; from: MorphRect; to: MorphRect; /** An exit that flies back into its tab (Unsplit): `to` is the tab's box. */ home?: boolean }
/** The box a leaving page flies to: its tab's box (page-area coordinates), kept inside the page area (the morph layer clips
 *  there), so the page visibly shrinks into a tab-sized tile right under or beside its tab before it fades. */
export function homeRect(tab: MorphRect, area: { width: number; height: number }): MorphRect {
  const width = Math.max(24, Math.min(tab.width, area.width)), height = Math.max(20, Math.min(tab.height, area.height));
  return { x: Math.round(Math.max(0, Math.min(area.width - width, tab.x))), y: Math.round(Math.max(0, Math.min(area.height - height, tab.y))), width: Math.round(width), height: Math.round(height) };
}

/** A morph is worth running when the panes on screen change and at least one page is on screen both before and after
 *  (the page that stays is what the eye follows): a tab opening in a split with the page you were on, Unsplit, a pane
 *  swap, a layout change, closing a pane. Switching to an unrelated tab is not one. */
export function shouldMorph(before: readonly string[], after: readonly string[], layoutChanged = false) {
  // The same panes in the same order: only a different layout moves them (a plain resize is the handles' own, live).
  if (before.length === after.length && before.every((id, index) => id === after[index])) return layoutChanged && after.length > 1;
  return before.some(id => after.includes(id)) && (before.length > 1 || after.length > 1);
}
export function morphIntent(before: readonly string[], after: readonly string[]): MorphIntent {
  return after.length > before.length ? 'merge' : after.length < before.length ? 'split' : 'rearrange';
}

/** The tile that flies in for a dropped tab: about a tab's size, centred on where it was released. */
export function dropOrigin(point: { x: number; y: number }, width = 200, height = 30): MorphRect {
  return { x: Math.round(point.x - width / 2), y: Math.round(point.y - height / 2), width, height };
}
const settle = (rect: MorphRect, by = .06): MorphRect => ({ x: rect.x + rect.width * by / 2, y: rect.y + rect.height * by / 2, width: rect.width * (1 - by), height: rect.height * (1 - by) });

/** Where every page starts and ends. A page on screen before and after moves (and reshapes) between its two boxes; a page
 *  that arrives flies from `origin` (the dropped tab) or, with none, grows from its own box; a page that leaves stays
 *  put and fades while the others take its room. */
export function planMorph(before: readonly PaneBox[], after: readonly PaneBox[], origin?: { tabId: string; rect: MorphRect }, homes: Readonly<Record<string, MorphRect>> = {}): MorphItem[] {
  const items: MorphItem[] = [];
  for (const next of after) {
    const { tabId, ...to } = next, old = before.find(box => box.tabId === tabId);
    if (old) { const { tabId: _id, ...from } = old; items.push({ tabId, kind: 'move', from, to }); }
    else items.push({ tabId, kind: 'enter', from: origin?.tabId === tabId ? origin.rect : settle(to, .1), to });
  }
  // A page that leaves flies back into its tab when `homes` knows where that tab is (Unsplit: the pane becomes its tab again,
  // founder 26 Oct); otherwise it stays put and fades while the others take its room.
  for (const old of before) if (!after.some(box => box.tabId === old.tabId)) { const { tabId, ...rect } = old, home = homes[tabId]; items.push(home ? { tabId, kind: 'exit', from: rect, to: home, home: true } : { tabId, kind: 'exit', from: rect, to: settle(rect, .04) }); }
  return items;
}

/** The size a still is drawn at while its box is smaller than the page it shows: it covers the final box (never stretched). */
export const coverScale = (from: MorphRect, to: MorphRect) => Math.max(to.width / Math.max(1, from.width), to.height / Math.max(1, from.height));
/** Which spring each intent uses: joining is `tab.merge`, leaving is `tab.split`, rearranging is `reorder.release`. */
export const morphToken = (intent: MorphIntent) => intent === 'merge' ? 'tab.merge' as const : intent === 'split' ? 'tab.split' as const : 'reorder.release' as const;
