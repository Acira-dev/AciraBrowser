import { runtime } from '../runtime/client';
import type { BrowserSnapshot, Rectangle } from '../runtime/types';
import { pointerAnchor } from './popup';
import { setWorkspaceTarget, type WorkspaceTarget } from './workspaceTargetStore';

export { peekWorkspaceTarget, setWorkspaceTarget, takeWorkspaceTarget, type WorkspaceTarget } from './workspaceTargetStore';
export type WorkspacePopupKind = 'workspace-menu' | 'workspace-context' | 'workspace-edit';

/** Opens a workspace popup from a control (its own box) or at a right-click; the chrome toggles it if it is already open. */
export function openWorkspacePopup(state: Pick<BrowserSnapshot, 'activeTabId'>, kind: WorkspacePopupKind, from: HTMLElement | { clientX: number; clientY: number }, target?: WorkspaceTarget): void {
  if (target) setWorkspaceTarget(target);
  const box: Rectangle = 'getBoundingClientRect' in from ? from.getBoundingClientRect().toJSON() : pointerAnchor(from.clientX, from.clientY);
  void runtime.browserCommand({ type: 'ui', tabId: state.activeTabId, action: 'open', kind, anchor: { x: box.x, y: box.y, width: box.width, height: box.height } });
}
/** Opens a workspace popup where the chrome decides (it looks the switcher or the strip chip up): from inside another popup. */
export function openWorkspacePopupFromPopup(state: Pick<BrowserSnapshot, 'activeTabId'>, kind: WorkspacePopupKind, target: WorkspaceTarget): void {
  setWorkspaceTarget(target);
  void runtime.browserCommand({ type: 'ui', tabId: state.activeTabId, action: 'open', kind });
}
