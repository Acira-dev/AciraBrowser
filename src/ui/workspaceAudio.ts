import type { BrowserSnapshot } from '../runtime/types';
import { workspaceIdOf } from '../runtime/workspaces';

/** Background workspace audio is scoped separately; the open workspace keeps its live tabs. */
export function workspacePlaying(state: BrowserSnapshot, id: string): boolean {
  return Boolean(state.audibleWorkspaces?.includes(id) || state.tabs.some(tab => tab.audible && !tab.muted && workspaceIdOf(state, tab) === id));
}
