import type { BrowserAction, BrowserSnapshot } from '../runtime/types';
import { workspaceIsOpen } from '../runtime/browserChrome';
import { effectiveView, hideToolbarOn, windowViews, type WindowView } from '../runtime/windowView';
import type { Direction } from './sidebarMorphPlan';
import { setRailPrefs } from './railPrefs';
import { railOn, sidebarOn } from '../runtime/shelf';

/** Seamless has nothing on screen to show the switch working: the window hears this and lets the edge the mode lives at show for a moment. */
export const sidebarModePeekEvent = 'acira-sidebar-mode-peek';
export const SIDEBAR_MODE_PEEK_MS = 1300;

/** Where tabs and the address bar live: one choice, made of two settings that were already there (`verticalTabs`, `addressInSidebar`), so nothing is migrated:
 *   top             tabs along the top, the toolbar over the page          (verticalTabs off, whatever addressInSidebar says)
 *   sidebar         tabs in a sidebar, the toolbar still over the page      (verticalTabs on, addressInSidebar off or unset)
 *   sidebar-address tabs, address bar and its buttons all in the sidebar    (both on: Sidebar mode, Arc and Zen's layout)
 *   top-sidebar     tabs along the top and a sidebar that never lists them  (Beta 14, the Shelf: verticalTabs off, `shelf` on; runtime/shelf.ts)
 * The menu, Appearance › Layout, Settings › Tabs and setup all show and write this one choice. The Shelf is listed second (picture and menu order: Along the top, Top + sidebar, In a sidebar, Sidebar + address). */
export type TabsLayout = 'top' | 'top-sidebar' | 'sidebar' | 'sidebar-address';
export const tabsLayouts: readonly TabsLayout[] = ['top', 'top-sidebar', 'sidebar', 'sidebar-address'];
type LayoutSettings = { verticalTabs?: boolean; addressInSidebar?: boolean; shelf?: boolean };
/** Tabs and the address bar both in the sidebar. This is what plays the morph (ui/sidebarMorph.ts) and what the sidebar chrome (addressInSidebar.ts) follows. */
export const sidebarModeOn = (settings: LayoutSettings): boolean => settings.verticalTabs === true && settings.addressInSidebar === true;
export const tabsLayoutOf = (settings: LayoutSettings): TabsLayout => (settings.verticalTabs !== true ? (settings.shelf === true ? 'top-sidebar' : 'top') : settings.addressInSidebar === true ? 'sidebar-address' : 'sidebar');
/** The settings a layout stands for: tabs in the sidebar, the address bar in it, and the Shelf (a sidebar with the tabs along the top). */
export const tabsLayoutSettings = (layout: TabsLayout): { tabs: boolean; address: boolean; shelf: boolean } => ({ tabs: layout === 'sidebar' || layout === 'sidebar-address', address: layout === 'sidebar-address', shelf: layout === 'top-sidebar' });
/** A sidebar exists in a layout: every one but Along the top. */
export const layoutHasSidebar = (layout: TabsLayout): boolean => layout !== 'top';

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
  const { tabs, address, shelf } = tabsLayoutSettings(layout);
  if ((state.settings.verticalTabs === true) === tabs && (state.settings.addressInSidebar === true) === address && (state.settings.shelf === true) === shelf) return;
  // Beta 14: a layout with a sidebar comes with it open (the Shelf from Along the top has nothing else to show, and the Shelf's window is its sidebar + the page), and the whole change is one action so one snapshot reaches every window and the switch plays once.
  const opens = (address || (shelf && !sidebarOn(state.settings))) && !!tab && !workspaceIsOpen(state.windowUi, tab);
  // The Shelf is written only where it is on, or was (to be turned off): the three older layouts write exactly what they always wrote.
  const withShelf = shelf || state.settings.shelf === true ? { shelf } : {};
  // (Beta 14.0: the tab strip arriving above the toolbar or leaving while the sidebar stands, Sidebar <-> Tabs on top + sidebar, is one action as well: it plays as the row morph, see `stripSwitch`.)
  // (Beta 14.0, group C: the same switch with Hide the toolbar on plays as the layout transition, and is one action too, see `stripTurnHidden`.)
  const to = { ...state, settings: { ...state.settings, verticalTabs: tabs, addressInSidebar: address, ...withShelf } };
  // (Beta 14.0, Along the top <-> Sidebar or Tabs on top + sidebar: one action as well, it plays as the row morph with the sidebar's column opening or closing, see `topTurn`.)
  if (sidebarModeOn(state.settings) === address && !opens && !stripSwitch(state, to) && !stripTurnHidden(state, to) && !topTurn(state, to)) {
    const privateMode = !!state.browserProfiles.find((item) => item.id === tab?.browserProfileId)?.private;
    setRailPrefs({ tabs }, tab?.browserProfileId, privateMode);
    dispatch({ type: 'settings.update', patch: { verticalTabs: tabs, addressInSidebar: address, ...withShelf } });
    return;
  }
  dispatch({ type: 'sidebar.mode', tabs, address, ...withShelf, ...(opens ? { open: true } : {}) });
  // Seamless has no bars to show the layout changing: the window lets the edge it moved to show for a moment.
  if (effectiveView(state.settings, state.windowUi) === 'seamless' && typeof window !== 'undefined') window.dispatchEvent(new Event(sidebarModePeekEvent));
}

/** What the morph needs of a snapshot: the layout's settings and, for the switches that keep the sidebar standing, whether it is open in this window. */
type MorphSnapshot = { settings: LayoutSettings & { hideToolbar?: boolean; sidebarRail?: boolean; windowView?: string }; windowUi?: BrowserSnapshot['windowUi']; tabs?: BrowserSnapshot['tabs']; activeTabId?: string };
/** A docked sidebar stands open in this window (not the Shelf's rail, not a closed one). */
function sidebarStands(snapshot: MorphSnapshot): boolean {
  if (!snapshot.windowUi || !sidebarOn(snapshot.settings) || railOn(snapshot.settings)) return false;
  const tab = snapshot.tabs?.find((item) => item.id === snapshot.activeTabId) ?? snapshot.tabs?.[0];
  return tab ? workspaceIsOpen(snapshot.windowUi, tab) : snapshot.windowUi.workspaceOpen === true;
}
/** Beta 14.0: the tab strip arriving above the toolbar or leaving while the sidebar stands (Sidebar <-> Tabs on top + sidebar), in the Full view with its toolbar on screen. Nothing of it was a morph:
 * the layout view transition cross-faded the old strip over the new toolbar row and the two sidebar lists over each other. It plays as the row morph now (ui/sidebarMorph.ts): 'in' when the strip leaves
 * (the bar loses a row, the page's top edge waits for it to empty), 'out' when it arrives (the bar opens first). Null: not that switch. */
export function stripSwitch(previous: MorphSnapshot, next: MorphSnapshot): Direction | null {
  if ((previous.settings.verticalTabs === true) === (next.settings.verticalTabs === true) || sidebarModeOn(previous.settings) || sidebarModeOn(next.settings)) return null;
  if (!sidebarStands(previous) || !sidebarStands(next) || !previous.windowUi || !next.windowUi) return null;
  for (const side of [previous, next]) { const view = effectiveView(side.settings as BrowserSnapshot['settings'], side.windowUi!); if (view !== 'full' || hideToolbarOn(side.settings, view)) return null; }
  return next.settings.verticalTabs === true ? 'in' : 'out';
}
/** Beta 14.0, group C: the same strip arriving or leaving beside a sidebar that stands, where Hide the toolbar is on (it is in effect only with the tabs in the sidebar, so the toolbar comes back
 * or goes with the strip). That switch is not the row morph (`stripSwitch` says no: there is no toolbar row on one side) but the layout transition, and it has to change the window in ONE render inside
 * that transition. Written the way the Tabs card always wrote a layout (the profile's tabs switch first, the settings after), the window was redrawn a render before the transition began and the sidebar's
 * list changed in two steps, which its own motion took for a burst: every row stood at once, the old list cut and the new one there on the first frame while the strip, the same tabs, was still fading
 * (stepped frames and the list's own log, 19 Nov). So it is one `sidebar.mode` action as well, and runtime/client.ts puts the profile's tabs switch into the transition's render. */
/** Beta 14.0 (the team's call, 19 Nov: D86, D88): Along the top, where no sidebar stands, and a layout whose sidebar stands open beside the page (Sidebar, Tabs on top + sidebar), in the Full view with
 * its toolbar on screen. It was the layout transition: the tab strip jumped 35 pt on the first frame, the sidebar's rows stood over the page while it was still leaving their place, and, played by the settings alone
 * (another window of the profile), a light box sat in the field and the sidebar button drifted onto the tab. It plays as the row morph now, the sidebar's column opening or closing on the morph's clock
 * (ui/sidebarMorph.ts, `MorphTarget.top`): 'in' when the sidebar comes (the bar may lose its strip), 'out' when it goes. Along the top <-> Sidebar + address is Sidebar mode turning on or off (`morphDirection`). */
export function topTurn(previous: MorphSnapshot, next: MorphSnapshot): Direction | null {
  if (sidebarModeOn(previous.settings) || sidebarModeOn(next.settings)) return null;
  const was = sidebarOn(previous.settings), now = sidebarOn(next.settings);
  if (was === now || !previous.windowUi || !next.windowUi) return null;
  const on = now ? next : previous;
  if (!sidebarStands(on) || railOn(on.settings)) return null;
  for (const side of [previous, next]) { const view = effectiveView(side.settings as BrowserSnapshot['settings'], side.windowUi!); if (view !== 'full' || hideToolbarOn(side.settings, view)) return null; }
  return now ? 'in' : 'out';
}
/** One side of a switch is Along the top (no sidebar at all): the row morph may then open or close the sidebar's column (sidebarMorphPlan.ts rowMorphApplies). */
export const alongTheTop = (previous: MorphSnapshot, next: MorphSnapshot): boolean => !sidebarOn(previous.settings) || !sidebarOn(next.settings);
export function stripTurnHidden(previous: MorphSnapshot, next: MorphSnapshot): boolean {
  if ((previous.settings.verticalTabs === true) === (next.settings.verticalTabs === true) || sidebarModeOn(previous.settings) || sidebarModeOn(next.settings)) return false;
  if (!sidebarStands(previous) || !sidebarStands(next) || !previous.windowUi || !next.windowUi) return false;
  const hidden = (side: MorphSnapshot) => hideToolbarOn(side.settings, effectiveView(side.settings as BrowserSnapshot['settings'], side.windowUi!));
  return hidden(previous) !== hidden(next);
}
/** What the layout a switch goes to has (ui/sidebarMorph.ts MorphTarget: the page's top edge takes its wait from it). */
export const morphTargetOf = (next: MorphSnapshot): { sidebar: boolean; block: boolean; strip: boolean; bar: boolean } => ({ sidebar: sidebarStands(next), block: sidebarModeOn(next.settings), strip: next.settings.verticalTabs !== true,
  /* a toolbar row stands over the page: not with Hide the toolbar in effect (group C: the page's edges then have no bar to wait for) */ bar: !(next.windowUi && hideToolbarOn(next.settings, effectiveView(next.settings as BrowserSnapshot['settings'], next.windowUi))) });

/** Which way the morph plays for a change from one snapshot to the next: Sidebar mode turning 'in' or 'out', or (a morph already playing takes any layout change, so no view transition ever
 * starts under it) the direction it was going. Null: the change is not the morph's. */
export function morphDirection(previous: MorphSnapshot, next: MorphSnapshot, running: boolean, layoutChanged: boolean, last: Direction): Direction | null {
  const was = sidebarModeOn(previous.settings), now = sidebarModeOn(next.settings);
  if (was !== now) return now ? 'in' : 'out';
  const top = topTurn(previous, next);
  if (top) return top;
  const strip = stripSwitch(previous, next);
  if (strip) return strip;
  return running && layoutChanged ? last : null;
}
