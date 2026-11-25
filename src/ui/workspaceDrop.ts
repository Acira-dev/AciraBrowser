import { useSyncExternalStore } from 'react';
import { groupMembers, moveBlock, profilesAsSpaces, windowWorkspaces, workspaceIdOf, workspaceName } from '../runtime/workspaces';
import type { BrowserSnapshot } from '../runtime/types';
import { t } from '../i18n';

/**
 * Dropping a tab, a split or a whole tab group on a workspace's icon in the sidebar moves it there (R3-57 flow C, item 16). The
 * sidebar's drag asks these questions as the pointer moves and lets go: which workspace icon is under it (the open one is not a
 * target), what would happen there (`workspaceDropNote`: the banner above the row says it in words, the icon wears a ring in the
 * workspace's colour, or is dimmed when the move is refused), and, on release, the same icon again.
 */
export function workspaceDropAt(point: { x: number; y: number }): string | null {
  const icon = document.elementFromPoint(point.x, point.y)?.closest<HTMLElement>('[data-ws]');
  return icon?.dataset.ws && icon.getAttribute('aria-checked') !== 'true' ? icon.dataset.ws : null;
}

/** What is being carried to a workspace: tab rows (a tab, or the panes of a split) or one whole group. */
export type WorkspaceDragSubject = { kind: 'tabs'; ids: readonly string[] } | { kind: 'group'; id: string };
/** What the banner says over a workspace icon; `refused` when the drop would not move anything (a locked workspace, a secured tab), shown muted with a lock. */
export interface WorkspaceDropNote { text: string; refused: boolean }

/**
 * The banner for dropping `subject` on workspace `workspaceId`, or null when there is nothing to say: no such workspace, the subject's
 * own workspace, profiles as spaces (a tab stays in its profile: the drop answers with its own toast), or tabs that never move
 * (private and Tor tabs). The rules are the runtime's own (`moveBlock`), so the banner never promises a move the action would refuse.
 */
export function workspaceDropNote(state: BrowserSnapshot, subject: WorkspaceDragSubject, workspaceId: string): WorkspaceDropNote | null {
  if (profilesAsSpaces(state)) return null;
  const target = windowWorkspaces(state).find(item => item.id === workspaceId);
  if (!target) return null;
  const group = subject.kind === 'group' ? state.tabGroups.find(item => item.id === subject.id) : undefined;
  const tabs = subject.kind === 'group' ? (group ? groupMembers(state, group) : []) : subject.ids.flatMap(id => state.tabs.find(tab => tab.id === id) ?? []);
  if (!tabs.length || tabs.every(tab => workspaceIdOf(state, tab) === target.id)) return null;
  const name = workspaceName(target, t('workspaces.main')), block = moveBlock(state, tabs, target);
  if (block === 'private') return null;
  if (block === 'locked') return { text: t('workspaces.unlockFirst', { name }), refused: true };
  if (block === 'secured') return { text: t('workspaces.securedStays'), refused: true };
  return { text: group ? t('workspaces.dropMoveGroup', { group: group.name, count: tabs.length, name }) : t('workspaces.dropMove', { name }), refused: false };
}

interface Hover { id: string; note: WorkspaceDropNote }
let hover: Hover | null = null;
const listeners = new Set<() => void>();
const publish = (next: Hover | null) => {
  if (next?.id === hover?.id && next?.note.text === hover?.note.text && next?.note.refused === hover?.note.refused) return;
  hover = next; for (const listener of [...listeners]) listener();
};
/** The workspace icon a drag is over and what dropping there would do (the banner above the workspace row), null while it is over none. */
export function useWorkspaceDropHover(): Hover | null {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => hover, () => null);
}

/** Lights the icon under `point` (null clears it). `noteFor` says what a drop there would do: a note shows the banner and rings the icon (dims it when
 *  refused); null (nothing to say) leaves the icon plain; without it the icon only wears the old fill. */
export function markWorkspaceDrop(point: { x: number; y: number } | null, noteFor?: (workspaceId: string) => WorkspaceDropNote | null): void {
  const id = point ? workspaceDropAt(point) : null, note = id && noteFor ? noteFor(id) : null;
  const lit = id && (!noteFor || note) ? id : null;
  for (const icon of document.querySelectorAll<HTMLElement>('[data-ws][data-drop]')) if (icon.dataset.ws !== lit) delete icon.dataset.drop;
  if (lit) document.querySelector<HTMLElement>(`[data-ws="${CSS.escape(lit)}"]`)?.setAttribute('data-drop', note?.refused ? 'refused' : '');
  publish(lit && note ? { id: lit, note } : null);
}
