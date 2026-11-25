/**
 * Beta 14: how many rows the toolbar's » menu holds. The menu is a popup (its own renderer), and its height is worked out before it opens from the page state alone, which does not know how
 * many side panel sites the fit took out of the row; the » button leaves the count here just before it opens the menu (the same hand-off the extensions' "more" list uses: ui/extensionMoreTarget.ts).
 * No imports: the popup geometry reads it for the height.
 */
const KEY = 'acira-overflow-rows';
export function setOverflowRows(count: number): void {
  try { localStorage.setItem(KEY, JSON.stringify({ count: Math.max(0, Math.min(40, Math.round(count) || 0)), at: Date.now() })); } catch { /* the menu then opens at its usual height */ }
}
export function peekOverflowRows(): number | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!value || typeof value !== 'object') return null;
    const { count, at } = value as Record<string, unknown>;
    if (typeof count !== 'number' || typeof at !== 'number' || Date.now() - at > 2 * 60_000) return null;
    return Math.max(0, Math.min(40, Math.round(count)));
  } catch { return null; }
}
/** How many rows the menu's ids make: one each, except the side panel sites' token (`sp035`), which is a row per digit. */
export const overflowRowCount = (overflow: string): number => overflow.split('.').filter(Boolean).reduce((rows, id) => rows + (/^sp\d+$/.test(id) ? id.length - 2 : 1), 0);
/** The places of the sites behind the » (their indexes in the profile's list), from the menu's ids. */
export const overflowSites = (ids: readonly string[]): number[] => ids.flatMap(id => /^sp\d+$/.test(id) ? [...id.slice(2)].map(Number) : []);
/** The menu's height: 30 px rows in a 12 px frame, never less than the two rows it always had room for. */
export const overflowHeight = (rows: number | null): number => Math.max(72, 12 + 30 * Math.max(0, rows ?? 0));
