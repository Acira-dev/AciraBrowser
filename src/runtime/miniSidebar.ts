import { railOn, sidebarOn, type ShelfSettings } from './shelf';
import { effectiveView, sidebarHeldOpenIn, type WindowView } from './windowView';
import { workspaceIsOpen } from './browserChrome';
import type { Settings, TabSession, WindowUi } from './types';

/** Beta 14, section AJ: "When the sidebar is closed": Mini or Hidden.
 *
 * Hidden is what a closed sidebar has always been: nothing on screen, and it comes back from the window's edge (section T). Mini keeps the sidebar as a slim
 * rail (the left 56 px of the real sidebar) beside the page; resting the pointer on it opens the whole sidebar over the page. One setting, `sidebarClosed`.
 * A profile saved before it existed has none and reads as Hidden (nothing changes on update); a new profile starts as Mini (createInitialState).
 *
 * Pure and shared: the renderer, the reducer and (through the runtime bundle) main read it from here. */
export type SidebarClosed = 'mini' | 'hidden';
export const SIDEBAR_CLOSED_CHOICES: readonly SidebarClosed[] = ['mini', 'hidden'];
export const isSidebarClosed = (value: unknown): value is SidebarClosed => value === 'mini' || value === 'hidden';
export const sidebarClosedOf = (settings: { sidebarClosed?: unknown } | null | undefined): SidebarClosed => (settings?.sidebarClosed === 'mini' ? 'mini' : 'hidden');

/** The rail's width in interface px: twice the tab favicon's centre in the sidebar (28), so every icon sits on the rail's centre line. */
export const MINI_RAIL_WIDTH = 56;

/** Sidebar + address: tabs and the address bar both in the sidebar (ui/sidebarMode.ts sidebarModeOn, read here without the ui layer). */
export const addressSidebarOn = (settings: { verticalTabs?: boolean; addressInSidebar?: boolean } | null | undefined): boolean => settings?.verticalTabs === true && settings.addressInSidebar === true;

type MiniSettings = ShelfSettings & Partial<Pick<Settings, 'addressInSidebar' | 'windowView' | 'sidebarClosed'>>;
/** Mini applies to this window while its sidebar is closed: the setting says Mini, there is a sidebar in this layout (tabs in it, or the Shelf), the view is Full, Compact or Focus
 * (Seamless is "just the page": it keeps its own edge reveal), the layout is not Sidebar + address (no Mini there, 14.0 re-release) and the sidebar is not one the window holds open anyway. An installed web app's window has no sidebar at all.
 * Whether the sidebar is closed is the caller's question (`workspaceIsOpen`). A fullscreen window keeps its chrome and its sidebar, so it keeps the rail: no fullscreen exclusion here or in the callers. */
export function miniRailOn(settings: MiniSettings | null | undefined, windowUi: Pick<WindowUi, 'view' | 'app'> | null | undefined): boolean {
  if (!settings || sidebarClosedOf(settings) !== 'mini' || !sidebarOn(settings)) return false;
  if (windowUi?.app === true) return false;
  // The Shelf folded to its own 52 px rail (Beta 14) keeps that rail: it is a docked size of the Shelf, not a closed sidebar (the old rail is not migrated or removed).
  if (railOn(settings)) return false;
  // Beta 14.0 re-release (reported 18 Nov): Sidebar + address has no Mini. Its closed sidebar is Hidden (the window buttons go with the sidebar and the edge brings both back).
  if (addressSidebarOn(settings)) return false;
  const view: WindowView = effectiveView(settings, windowUi);
  return view !== 'seamless' && !sidebarHeldOpenIn(settings, { view, app: windowUi?.app });
}

/** Beta 14.0 (reported 20 Nov): the sidebar is the Mini rail right now (Mini applies to this window and its sidebar is closed). The rail cannot carry a drag (tabs and Favorites do not lift or reorder in it) and
 * its right-click menus start with Customize sidebar, which opens the sidebar first (the customizer has no room in 56 px). Read by the sidebar (AciraSidebar.tsx) and by the menus in the popup renderer (App.tsx tab-context). */
export function miniRailShown(state: { settings: MiniSettings & Partial<Settings>; windowUi: Pick<WindowUi, 'view' | 'app' | 'workspaceOpen' | 'webWorkspaceOpen'>; tabs: readonly Pick<TabSession, 'id' | 'url' | 'contentKind'>[]; activeTabId: string }): boolean {
  if (!state.windowUi || !miniRailOn(state.settings, state.windowUi)) return false;
  const current = state.tabs?.find(tab => tab.id === state.activeTabId) ?? state.tabs?.[0];
  return !!current && !workspaceIsOpen(state.windowUi, current);
}
