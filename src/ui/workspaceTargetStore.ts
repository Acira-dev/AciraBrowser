/**
 * Which workspace a workspace popup is about, and what it should do. A popup may only carry a tab id across to its own
 * renderer, so the control that opens it leaves the target here just before (the same hand-off the Edit favorite popover
 * uses, ui/favoriteEdit.ts). It is read once: a popup opened later without a target (a custom shortcut, the command bar)
 * is always a new workspace. This file has no imports so the popup geometry can read it.
 */
const KEY = 'acira-workspace-target';
/** `start: 'current'` (the tab menu's Move to › New workspace…) preselects This tab, for `tabId` when given (R4-48). */
export type WorkspaceTarget = { mode: 'new'; start?: 'current'; tabId?: string } | { mode: 'edit'; workspaceId: string; focus?: 'name' | 'icon' } | { mode: 'context'; workspaceId: string };

export function setWorkspaceTarget(target: WorkspaceTarget): void {
  try { localStorage.setItem(KEY, JSON.stringify({ ...target, at: Date.now() })); } catch { /* the popup then opens for a new workspace */ }
}
function read(consume: boolean): WorkspaceTarget | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (consume) localStorage.removeItem(KEY);
    if (!value || typeof value !== 'object') return null;
    const { mode, workspaceId, focus, at, start, tabId } = value as Record<string, unknown>;
    if (typeof at !== 'number' || Date.now() - at > 2 * 60_000) return null;
    if (mode === 'new') return { mode, ...(start === 'current' ? { start } : {}), ...(start === 'current' && typeof tabId === 'string' && tabId.length <= 200 ? { tabId } : {}) };
    if ((mode === 'edit' || mode === 'context') && typeof workspaceId === 'string') return mode === 'edit' ? { mode, workspaceId, ...(focus === 'icon' || focus === 'name' ? { focus } : {}) } : { mode, workspaceId };
  } catch { /* no target */ }
  return null;
}
/** The target, once: the popup reads it as it opens. */
export const takeWorkspaceTarget = (): WorkspaceTarget | null => read(true);
/** The target without using it up: where the chrome puts the popup, and how tall it is. */
export const peekWorkspaceTarget = (): WorkspaceTarget | null => read(false);
