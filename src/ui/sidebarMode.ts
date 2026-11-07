import type { BrowserAction, BrowserSnapshot } from '../runtime/types';
import { workspaceIsOpen } from '../runtime/browserChrome';
import { effectiveView } from '../runtime/windowView';
import type { Direction } from './sidebarMorphPlan';
import { readRailPrefs, setRailPrefs } from './railPrefs';

/** Seamless has nothing on screen to show the switch working: the window hears this and lets the edge the mode lives at show for a moment. */
export const sidebarModePeekEvent = 'acira-sidebar-mode-peek';
export const SIDEBAR_MODE_PEEK_MS = 1300;

/** Sidebar mode (Arc, Zen): tabs in the sidebar and the address bar in the sidebar, together, in one step. It is not a setting of its own:
 * it is on exactly when both are on, so turning the two on by hand shows the switch on too. Turning it on remembers what the person had;
 * turning it off puts that back. With nothing remembered (both were turned on by hand) it takes the address bar back to the toolbar and
 * leaves the tabs where they are. */
export type SidebarChoice = { tabs: boolean; address: boolean };
export const sidebarModeOn = (settings: { verticalTabs?: boolean; addressInSidebar?: boolean }): boolean => settings.verticalTabs === true && settings.addressInSidebar === true;

/** What to set, and what to remember for the way back. Already in the mode (both on) keeps the memory it has. */
export function sidebarModePlan(current: SidebarChoice, on: boolean, before?: SidebarChoice): { set: SidebarChoice; remember: SidebarChoice | null } {
  if (on) return { set: { tabs: true, address: true }, remember: current.tabs && current.address ? before ?? null : current };
  const back = before && !(before.tabs && before.address) ? before : { tabs: current.tabs, address: false };
  return { set: back, remember: null };
}

/** The switch, wherever it sits (Settings › Tabs › Sidebar, Appearance › Layout, the Acira menu): one `sidebar.mode` action for both choices and for the sidebar's opening when it
 * was closed (so the tabs are not lost). The window plays it as the morph; the profile's own tabs switch follows inside the morph (runtime/client.ts). */
export function setSidebarMode(state: BrowserSnapshot, dispatch: (action: BrowserAction) => void, on: boolean) {
  const tab = state.tabs.find((item) => item.id === state.activeTabId) || state.tabs[0];
  const privateMode = !!state.browserProfiles.find((item) => item.id === tab.browserProfileId)?.private;
  const rail = readRailPrefs(tab.browserProfileId, privateMode);
  const plan = sidebarModePlan({ tabs: state.settings.verticalTabs === true, address: state.settings.addressInSidebar === true }, on, rail.sidebarModeBefore);

  // The profile's tabs switch follows the setting inside the morph (runtime/client.ts), so only the memory is written here.
  setRailPrefs({ sidebarModeBefore: plan.remember ?? undefined }, tab.browserProfileId, privateMode);
  // One action: both settings and the sidebar's opening arrive in one snapshot, so the morph that plays it never meets half a switch.
  dispatch({ type: 'sidebar.mode', tabs: plan.set.tabs, address: plan.set.address, ...(on && !workspaceIsOpen(state.windowUi, tab) ? { open: true } : {}) });
  if (effectiveView(state.settings, state.windowUi) === 'seamless' && typeof window !== 'undefined') window.dispatchEvent(new Event(sidebarModePeekEvent));
}

/** Which way the morph plays for a change from one snapshot to the next: Sidebar mode turning 'in' or 'out', or (a morph already playing takes any layout change, so no view transition ever
 * starts under it) the direction it was going. Null: the change is not the morph's. */
export function morphDirection(previous: { settings: { verticalTabs?: boolean; addressInSidebar?: boolean } }, next: { settings: { verticalTabs?: boolean; addressInSidebar?: boolean } }, running: boolean, layoutChanged: boolean, last: Direction): Direction | null {
  const was = sidebarModeOn(previous.settings), now = sidebarModeOn(next.settings);
  if (was !== now) return now ? 'in' : 'out';
  return running && layoutChanged ? last : null;
}
