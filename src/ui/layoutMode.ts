import { workspaceIsOpen } from '../runtime/browserChrome';
import type { BrowserAction,BrowserSnapshot } from '../runtime/types';
import { dismissEdge,useChromeEdge } from './chromeEdge';
import { effectiveView,sidebarHeldOpenIn,windowViewOf } from '../runtime/windowView';
import { t } from '../i18n';
/** One layout store (docs/launch/LAYOUT_MODES.md §5).
 * - layout: native `settings.verticalTabs` (shared by every window; main reads it for the Ctrl+S contract).
 *   The per-profile `railPrefs.tabs` that App and Settings already read is kept in step by the sidebar.
 * - sidebarOpen: `windowUi.workspaceOpen` (persisted, docked; contents resize).
 * - sidebarPeek: transient, this window only (edge hover; hides on leave or blur). */
export type LayoutMode = 'horizontal' | 'vertical';
export const layoutOf = (state: Pick<BrowserSnapshot, 'settings'>): LayoutMode => state.settings.verticalTabs ? 'vertical' : 'horizontal';

/** The single toolbar toggle: vertical layout only, and Focus keeps it (R3-65: Focus hides secondary chrome, never the sidebar button).
 * Seamless has none: the sidebar there comes with the pointer at the left edge (or Ctrl+Shift+E, which pins it and lets go of it again; Esc and a click in the page also let go),
 * so the toolbar's first control is Back and there is no empty slot where the button stood. */
export function sidebarControl(state: BrowserSnapshot) {
  const tab = state.tabs.find(item => item.id === state.activeTabId) || state.tabs[0];
  const open = layoutOf(state) === 'vertical' && !!tab && workspaceIsOpen(state.windowUi, tab), view = effectiveView(state.settings, state.windowUi);
  // (13.5: Sidebar + address in Full has none either: its sidebar is the top of the window and stays open, windowView.ts sidebarHeldOpen.)
  return { visible: layoutOf(state) === 'vertical' && view !== 'seamless' && !sidebarHeldOpenIn(state.settings, state.windowUi), open, label: open ? t("app.collapseSidebar") : t("app.expandSidebar") };
}

/** The commands a list may offer in this window (the command bar, the address list): "Toggle sidebar" (registry id `workspace`, desktop/shortcut-registry.cjs) is not one of them where the sidebar is held open (13.5,
 * Sidebar + address in Full: nothing closes it, so the command would only answer with nothing). The same array back everywhere else. */
export const SIDEBAR_TOGGLE_COMMAND = 'workspace';
export function commandsOffered<T extends { id: string }>(state: Pick<BrowserSnapshot, 'settings' | 'windowUi'>, commands: readonly T[]): readonly T[] {
  return sidebarHeldOpenIn(state.settings, state.windowUi) ? commands.filter(command => command.id !== SIDEBAR_TOGGLE_COMMAND) : commands;
}

/** The sidebar stands on the window frame (founder P0, 27 Oct: "the sidebar and the toolbar don't match colors"): docked open, or
 * standing in its own column. Then the toolbar sits clear on the same frame and the page is the inset card. Hover previews float
 * over the page in every view; Full, Compact and Focus retain their connected header, while Seamless keeps its existing card finish.
 * CSS states the same thing as `:root:not([data-edge-float]) .app:has(> .ed-rail.is-expanded)` (frame.css, sidebar.css,
 * toolbar-controls.css; tests/sidebar-frame-surface.test.ts). */
export function sidebarOnFrame(state: BrowserSnapshot, edge: { side: boolean }, floating: boolean): boolean {
  return sidebarControl(state).open || (layoutOf(state) === 'vertical' && edge.side && !floating);
}

/** The peek is main's now (R3-68, desktop/edge-reveal.cjs): it watches the pointer and says when the left edge shows the sidebar
 * (`chrome-edge`), in every view. Opening is its job; the interface can only end it (Esc, docking the sidebar). */
export function setSidebarPeek(next: boolean) { if (!next) dismissEdge('side'); }

/** Round 2 (founder: open/close lagged and looked bad): the sidebar opens and closes in one layout step inside A's layout
 * view transition, so it slides on the GPU from the input frame and the page lays out once (main glides the page card
 * the same way, layout pageMotion 'slide'). These say which changes that is. */
export const opensOrClosesSidebar = (action: BrowserAction) => action.type === 'ui.update' && ('workspaceOpen' in action.patch || 'webWorkspaceOpen' in action.patch || 'focusMode' in action.patch || 'view' in action.patch);
export function sidebarLayoutChanged(previous: Pick<BrowserSnapshot, 'windowUi' | 'settings'> | null, next: Pick<BrowserSnapshot, 'windowUi' | 'settings'>) {
  if (!previous) return false;
  const a = previous.windowUi, b = next.windowUi;
  return a.workspaceOpen !== b.workspaceOpen || a.webWorkspaceOpen !== b.webWorkspaceOpen || a.focusMode !== b.focusMode || a.view !== b.view || windowViewOf(previous.settings) !== windowViewOf(next.settings) || previous.settings.verticalTabs !== next.settings.verticalTabs;
}
/** The layout change takes the sidebar away: it is open for the active tab now and closed for the tab that will be active. Asked before a layout switch starts, so a Sidebar-mode window
 * can fold the address block into the sidebar's own slide out (sharedMotion.ts, address-in-sidebar.css): the picture of the old state is taken when the switch starts. */
export function sidebarCloses(now: Pick<BrowserSnapshot, 'windowUi' | 'tabs' | 'activeTabId'>, nextUi: Pick<BrowserSnapshot['windowUi'], 'workspaceOpen' | 'webWorkspaceOpen'>, nextActiveTabId: string, nextTabs: Pick<BrowserSnapshot, 'tabs'>['tabs'] = now.tabs): boolean {
  const openFor = (ui: Pick<BrowserSnapshot['windowUi'], 'workspaceOpen' | 'webWorkspaceOpen'>, tabs: Pick<BrowserSnapshot, 'tabs'>['tabs'], id: string) => { const tab = tabs.find(item => item.id === id); return tab ? workspaceIsOpen(ui, tab) : ui.workspaceOpen; };
  return openFor(now.windowUi, now.tabs, now.activeTabId) && !openFor(nextUi, nextTabs, nextActiveTabId);
}
export function useSidebarPeek() { return useChromeEdge().side; }
