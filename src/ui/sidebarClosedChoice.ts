import type { BrowserAction, BrowserSnapshot } from '../runtime/types';
import { sidebarPatch, workspaceIsOpen } from '../runtime/browserChrome';
import { addressSidebarOn, sidebarClosedOf, type SidebarClosed } from '../runtime/miniSidebar';
import { sidebarOn } from '../runtime/shelf';
import { closedBlock, closedChoiceAvailable, type ClosedBlock } from '../features/settings/layoutAvailability';

/** Beta 14 (the reference design notes, 17 Nov): "Mini is hard to find and doesn't work". One place for the three states of the sidebar as a person thinks of them, Open, Mini or Hidden, used by the main menu's
 * "Sidebar" row and by Settings › Tabs › When the sidebar is closed:
 *  - Open is the sidebar docked beside the page; Mini and Hidden are the two ways it is closed (`settings.sidebarClosed`).
 *  - Picking Mini or Hidden from the menu closes the sidebar at once, so the choice is seen straight away (the sidebar closes to the rail or away, as the toolbar's sidebar button would close it).
 *  - Picking Mini in Settings while the sidebar is open closes it to the rail too (the Settings card used to change a setting nothing on screen answered to); picking Hidden there leaves it open.
 *  - A state the layout cannot have is not offered: it says why in its tooltip (the same lines as Settings, settings/layoutAvailability.ts). Pure; the callers dispatch. */
export type SidebarChoice = 'open' | 'mini' | 'hidden';

/** The row's state for this window, or null where it is not offered (no sidebar in the layout, or an installed web app's window). `reasons` has a message id for each choice that cannot be picked now. */
export interface SidebarRow { value: SidebarChoice | undefined; reasons: Partial<Record<SidebarChoice, ReasonId>> }
type ReasonId = 'settings.reasonMiniView' | 'settings.reasonMiniRail' | 'settings.reasonMiniAddress' | 'sidebar.closedSeamlessNote';
export function sidebarRowOf(state: Pick<BrowserSnapshot, 'settings' | 'windowUi' | 'tabs' | 'activeTabId'>): SidebarRow | null {
  if (!state.windowUi || !sidebarOn(state.settings)) return null;
  const block: ClosedBlock = closedBlock(state.settings, state.windowUi);
  if (block === 'no-sidebar') return null;
  const tab = state.tabs.find(item => item.id === state.activeTabId) || state.tabs[0];
  // Beta 14.0 re-release (reported 18 Nov): Sidebar + address has no Mini. The row still lists it, dimmed, with the reason; a closed sidebar there is Hidden.
  const address = block === 'address' || (block === 'seamless' && addressSidebarOn(state.settings));
  if (block === 'seamless') {
    // Seamless is just the page: its sidebar comes from the left edge (no docked state to open or close), so the row shows what it would be and gives the reason on every choice.
    return { value: undefined, reasons: { open: 'sidebar.closedSeamlessNote', mini: address ? 'settings.reasonMiniAddress' : 'settings.reasonMiniView', hidden: 'sidebar.closedSeamlessNote' } };
  }
  const open = !!tab && workspaceIsOpen(state.windowUi, tab);
  const reasons: SidebarRow['reasons'] = {};
  if (!closedChoiceAvailable(block, 'mini')) reasons.mini = address ? 'settings.reasonMiniAddress' : 'settings.reasonMiniRail';
  return { value: open ? 'open' : address ? 'hidden' : sidebarClosedOf(state.settings), reasons };
}

type Dispatch = (action: BrowserAction) => void;
const isOpen = (state: BrowserSnapshot): boolean => { const tab = state.tabs.find(item => item.id === state.activeTabId) || state.tabs[0]; return !!tab && workspaceIsOpen(state.windowUi, tab); };

/** The menu's Sidebar row: Open docks the sidebar; Mini and Hidden record what a closed sidebar is and close it now. Nothing happens for a choice the row does not offer. */
export function chooseSidebarState(state: BrowserSnapshot, dispatch: Dispatch, choice: SidebarChoice): void {
  const row = sidebarRowOf(state);
  if (!row || row.reasons[choice]) return;
  if (choice === 'open') { if (!isOpen(state)) dispatch({ type: 'ui.update', patch: sidebarPatch(true) }); return; }
  // In Sidebar + address a closed sidebar is Hidden whatever the setting says, so picking it only closes the sidebar: the profile's choice (Mini, for the layouts that have it) is left alone.
  if (!addressSidebarOn(state.settings) && sidebarClosedOf(state.settings) !== choice) dispatch({ type: 'settings.update', patch: { sidebarClosed: choice } });
  if (isOpen(state)) dispatch({ type: 'ui.update', patch: sidebarPatch(false) });
}

/** Settings › Tabs › When the sidebar is closed: records the choice; Mini also closes an open sidebar to the rail at once, where Mini applies (not in Seamless or with the Shelf's rail, where the card is off the table anyway). */
export function chooseSidebarClosed(state: BrowserSnapshot, dispatch: Dispatch, choice: SidebarClosed): void {
  if (sidebarClosedOf(state.settings) !== choice) dispatch({ type: 'settings.update', patch: { sidebarClosed: choice } });
  if (choice === 'mini' && closedBlock(state.settings, state.windowUi) === 'none' && isOpen(state)) dispatch({ type: 'ui.update', patch: sidebarPatch(false) });
}
