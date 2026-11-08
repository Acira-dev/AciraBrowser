import type { BrowserAction, BrowserSnapshot } from '../runtime/types';
import { workspaceIsOpen } from '../runtime/browserChrome';
import { effectiveView, windowViews, type WindowView } from '../runtime/windowView';
import type { Direction } from './sidebarMorphPlan';
import { setRailPrefs } from './railPrefs';

/** Seamless has nothing on screen to show the switch working: the window hears this and lets the edge the mode lives at show for a moment. */
export const sidebarModePeekEvent = 'acira-sidebar-mode-peek';
export const SIDEBAR_MODE_PEEK_MS = 1300;

/** Where tabs and the address bar live: one choice, made of two settings that were already there (`verticalTabs`, `addressInSidebar`), so nothing is migrated:
 *   top             tabs along the top, the toolbar over the page          (verticalTabs off, whatever addressInSidebar says)
 *   sidebar         tabs in a sidebar, the toolbar still over the page      (verticalTabs on, addressInSidebar off or unset)
 *   sidebar-address tabs, address bar and its buttons all in the sidebar    (both on: Sidebar mode, Arc and Zen's layout)
 * The menu, Appearance › Layout, Settings › Tabs and setup all show and write this one choice. */
export type TabsLayout = 'top' | 'sidebar' | 'sidebar-address';
export const tabsLayouts: readonly TabsLayout[] = ['top', 'sidebar', 'sidebar-address'];
type LayoutSettings = { verticalTabs?: boolean; addressInSidebar?: boolean };
/** Tabs and the address bar both in the sidebar. This is what plays the morph (ui/sidebarMorph.ts) and what the sidebar chrome (addressInSidebar.ts) follows. */
export const sidebarModeOn = (settings: LayoutSettings): boolean => settings.verticalTabs === true && settings.addressInSidebar === true;
export const tabsLayoutOf = (settings: LayoutSettings): TabsLayout => (settings.verticalTabs !== true ? 'top' : settings.addressInSidebar === true ? 'sidebar-address' : 'sidebar');
/** The two settings a layout stands for. */
export const tabsLayoutSettings = (layout: TabsLayout): { tabs: boolean; address: boolean } => ({ tabs: layout !== 'top', address: layout === 'sidebar-address' });

/** The window views that look different in a layout. With the address bar in the sidebar there is no top bar to slim or hide, so Full, Compact and Focus are one window
 * (addressInSidebar.ts): the choice lists Full and Seamless there. The stored view is never touched: Compact comes back, ticked, in the other two layouts. */
export const viewsOfLayout = (layout: TabsLayout, views: readonly WindowView[] = windowViews): readonly WindowView[] => (layout === 'sidebar-address' ? views.filter((view) => view === 'full' || view === 'seamless') : views);
/** The view to show as chosen in a layout: a Compact or Focus that the layout does not list shows as Full, the window it looks like. */
export const shownView = (layout: TabsLayout, view: WindowView): WindowView => (viewsOfLayout(layout).includes(view) ? view : 'full');

/** Picking a layout, wherever the choice sits (the Acira menu, Appearance › Layout, Settings › Tabs, setup). Both settings are always written, so a leftover address flag from an
 * older switch is cleared, and nothing is remembered: each layout is its own pair.
 * When the address bar moves into or out of the sidebar (Sidebar mode turning on or off) it is one `sidebar.mode` action for both settings and, going in with the sidebar closed, for
 * its opening (so the address bar is not lost): the window plays it as the morph Sidebar mode has always had, and the profile's own tabs switch follows inside it (runtime/client.ts).
 * Between Top and Sidebar nothing of the sort happens, so it stays what the Tabs card always did: the settings, and the profile's tabs switch, written in the one step the layout switch plays on. */
export function setTabsLayout(state: BrowserSnapshot, dispatch: (action: BrowserAction) => void, layout: TabsLayout) {
  const tab = state.tabs.find((item) => item.id === state.activeTabId) || state.tabs[0];
  const { tabs, address } = tabsLayoutSettings(layout);
  if ((state.settings.verticalTabs === true) === tabs && (state.settings.addressInSidebar === true) === address) return;
  if (sidebarModeOn(state.settings) === address) {
    const privateMode = !!state.browserProfiles.find((item) => item.id === tab?.browserProfileId)?.private;
    setRailPrefs({ tabs }, tab?.browserProfileId, privateMode);
    dispatch({ type: 'settings.update', patch: { verticalTabs: tabs, addressInSidebar: address } });
    return;
  }
  dispatch({ type: 'sidebar.mode', tabs, address, ...(address && tab && !workspaceIsOpen(state.windowUi, tab) ? { open: true } : {}) });
  // Seamless has no bars to show the layout changing: the window lets the edge it moved to show for a moment.
  if (effectiveView(state.settings, state.windowUi) === 'seamless' && typeof window !== 'undefined') window.dispatchEvent(new Event(sidebarModePeekEvent));
}

/** Which way the morph plays for a change from one snapshot to the next: Sidebar mode turning 'in' or 'out', or (a morph already playing takes any layout change, so no view transition ever
 * starts under it) the direction it was going. Null: the change is not the morph's. */
export function morphDirection(previous: { settings: { verticalTabs?: boolean; addressInSidebar?: boolean } }, next: { settings: { verticalTabs?: boolean; addressInSidebar?: boolean } }, running: boolean, layoutChanged: boolean, last: Direction): Direction | null {
  const was = sidebarModeOn(previous.settings), now = sidebarModeOn(next.settings);
  if (was !== now) return now ? 'in' : 'out';
  return running && layoutChanged ? last : null;
}
