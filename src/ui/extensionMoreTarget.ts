/**
 * Beta 14: what the "more extensions" list is about. A popup may only carry a tab id across to its own renderer, so the button that opens it leaves the list here just
 * before (the same hand-off the workspace popups and the Edit favorite popover use: ui/workspaceTargetStore.ts). The interface and the popup layer are two pages of one origin and
 * share this storage. It is read, never consumed by a render (the popup renders more than once), and it goes stale after two minutes. No imports: the popup geometry reads it for the height.
 */
const KEY = 'acira-extension-more';
export interface MoreRow { id: string; title: string; text: string; color: string; textColor: string; enabled: boolean }
export interface MoreTarget {
  /** The engine's partition of the profile whose extensions these are. */
  partition: string;
  /** The page the buttons are for (the engine's `tab`). */
  tab: number;
  /** The "more" button's box in the window: the extension's own popup opens from it, as it does from the button it replaces. */
  anchor: { x: number; y: number; width: number; height: number };
  /** The extensions behind the button, in the person's pinned order. */
  rows: MoreRow[];
}

export function setMoreTarget(target: MoreTarget): void {
  try { localStorage.setItem(KEY, JSON.stringify({ ...target, at: Date.now() })); } catch { /* the list then opens empty */ }
}
export function clearMoreTarget(): void {
  try { localStorage.removeItem(KEY); } catch { /* nothing to clear */ }
}
const text = (value: unknown, max: number): string => (typeof value === 'string' ? value.slice(0, max) : '');
const finite = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
export function peekMoreTarget(): MoreTarget | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!value || typeof value !== 'object') return null;
    const { partition, tab, anchor, rows, at } = value as Record<string, unknown>;
    if (typeof at !== 'number' || Date.now() - at > 2 * 60_000 || typeof partition !== 'string' || !partition || !Array.isArray(rows)) return null;
    const box = (anchor && typeof anchor === 'object' ? anchor : {}) as Record<string, unknown>;
    return {
      partition: partition.slice(0, 200),
      tab: finite(tab),
      anchor: { x: finite(box.x), y: finite(box.y), width: finite(box.width), height: finite(box.height) },
      rows: rows.slice(0, 200).flatMap((row): MoreRow[] => {
        if (!row || typeof row !== 'object') return [];
        const r = row as Record<string, unknown>;
        return typeof r.id === 'string' && /^[a-p]{32}$/.test(r.id) ? [{ id: r.id, title: text(r.title, 200), text: text(r.text, 12), color: text(r.color, 40), textColor: text(r.textColor, 40), enabled: r.enabled !== false }] : [];
      }),
    };
  } catch { return null; }
}
