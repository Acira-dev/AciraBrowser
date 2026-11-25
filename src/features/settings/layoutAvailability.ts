import { railOn, sidebarOn, type ShelfSettings } from '../../runtime/shelf';
import { effectiveView, windowViews, type WindowView } from '../../runtime/windowView';
import { addressSidebarOn } from '../../runtime/miniSidebar';
import { tabsLayoutOf, viewsOfLayout, type TabsLayout } from '../../ui/sidebarMode';
import type { Settings, WindowUi } from '../../runtime/types';

/** Which layout choices cannot work together, in one place, so Settings can show them as unavailable with the reason instead of hiding them or letting a choice do nothing.
 * Nothing here is a new rule: every answer is the one the window itself already uses (runtime/miniSidebar.ts miniRailOn, runtime/windowView.ts hideToolbarOn / sidebarHeldOpen,
 * ui/sidebarMode.ts viewsOfLayout). tests/settings-layout-availability.test.ts pins each answer to those functions. Pure. */
type LayoutSettings = ShelfSettings & Partial<Pick<Settings, 'addressInSidebar' | 'windowView' | 'sidebarClosed' | 'hideToolbar' | 'toolbarLayout'>>;
type LayoutWindow = Pick<WindowUi, 'view' | 'app'> | null | undefined;

/** Why "When the sidebar is closed" has no say right now:
 *   none        it has: a closed sidebar is Mini or Hidden as chosen
 *   address     Sidebar + address has no Mini (14.0 re-release, the team 18 Nov): its closed sidebar is always Hidden, and the window buttons go with it
 *   no-sidebar  this layout has no sidebar (Along the top), or the window is an installed web app's
 *   rail        the Shelf is folded to its own rail, which is a docked size and not a closed sidebar: Mini has nothing to add (Hidden still applies)
 *   seamless    Seamless is just the page and brings the sidebar from its edge: Mini does not apply (Hidden is what it does) */
export type ClosedBlock = 'none' | 'no-sidebar' | 'address' | 'rail' | 'seamless';

/** The order is miniRailOn's own, so `closedBlock(...) === 'none'` exactly when Mini would apply to a window whose choice is Mini. */
export function closedBlock(settings: LayoutSettings | null | undefined, windowUi: LayoutWindow): ClosedBlock {
  if (!settings || !sidebarOn(settings) || windowUi?.app === true) return 'no-sidebar';
  if (railOn(settings)) return 'rail';
  const view: WindowView = effectiveView(settings, windowUi);
  if (view === 'seamless') return 'seamless';
  return addressSidebarOn(settings) ? 'address' : 'none';
}

/** Can this card be chosen now? Mini needs `none`; Hidden needs a sidebar that can close at all (`none`, `address`, `rail` or `seamless`, where it is simply what the edge reveal already is). */
export const closedChoiceAvailable = (block: ClosedBlock, choice: 'mini' | 'hidden'): boolean => (choice === 'mini' ? block === 'none' : block !== 'no-sidebar');

/** The Window views a layout lists as unavailable (still shown, dimmed): Sidebar + address has no top bar to slim or hide, so Compact and Focus are Full there. */
export const unavailableViews = (layout: TabsLayout): readonly WindowView[] => {
  const listed = viewsOfLayout(layout);
  return windowViews.filter((view) => !listed.includes(view));
};

/** Why "Hide the toolbar" cannot be switched now, or null when it can:
 *   seamless  the view already hides the toolbar until the pointer rests at the top edge
 *   layout    only tabs in a sidebar with the toolbar over the page have a toolbar to hide (not Along the top, Top + sidebar or Sidebar + address) */
export type HideToolbarBlock = 'seamless' | 'layout';
export function hideToolbarBlock(settings: LayoutSettings | null | undefined, windowUi: LayoutWindow): HideToolbarBlock | null {
  const layout = tabsLayoutOf(settings ?? {});
  const view = effectiveView(settings, windowUi);
  if (layout !== 'sidebar') return 'layout';
  return view === 'seamless' ? 'seamless' : null;
}

/** True when the person chose Mini but this window is not showing it (Seamless, Sidebar + address, the Shelf's rail): the choice is kept, and Settings says it is paused. */
export const miniPaused = (settings: LayoutSettings | null | undefined, windowUi: LayoutWindow): boolean => {
  if (!settings || settings.sidebarClosed !== 'mini') return false;
  const block = closedBlock(settings, windowUi);
  return block === 'seamless' || block === 'rail' || block === 'address';
};
