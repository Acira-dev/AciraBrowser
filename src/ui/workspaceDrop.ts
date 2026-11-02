/**
 * Dropping a tab on a workspace's icon in the sidebar moves it there (R3-57 flow C). The sidebar's tab drag asks these two
 * questions as the pointer moves and lets go: which workspace icon is under it (the open one is not a target), and light
 * that icon while a tab hovers over it.
 */
export function workspaceDropAt(point: { x: number; y: number }): string | null {
  const icon = document.elementFromPoint(point.x, point.y)?.closest<HTMLElement>('[data-ws]');
  return icon?.dataset.ws && icon.getAttribute('aria-checked') !== 'true' ? icon.dataset.ws : null;
}
/** Lights the icon under `point` (null clears it). */
export function markWorkspaceDrop(point: { x: number; y: number } | null): void {
  const id = point ? workspaceDropAt(point) : null;
  for (const icon of document.querySelectorAll<HTMLElement>('[data-ws][data-drop]')) if (icon.dataset.ws !== id) delete icon.dataset.drop;
  if (id) document.querySelector<HTMLElement>(`[data-ws="${CSS.escape(id)}"]`)?.setAttribute('data-drop', '');
}
