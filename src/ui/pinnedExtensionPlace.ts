import { hideToolbarOn,effectiveView,type WindowView } from '../runtime/windowView';
import { railOn,sidebarOn } from '../runtime/shelf';
import { sidebarModeOn } from './sidebarMode';
import type { Settings,WindowUi } from '../runtime/types';

/** Where a pinned extension's icon is drawn, Beta 14 (a tester saw it twice: in the toolbar AND above New tab in the sidebar, and found no way to take it off the sidebar). One place at a time:
 *  - 'toolbar': the toolbar's own copy, wherever the toolbar stands at rest (Full and Compact; the Top, Sidebar and Top + sidebar layouts);
 *  - 'sidebar': the sidebar's row (Customize sidebar's "Pinned extensions" block), where the toolbar's copy is not on screen at rest and the sidebar is: Focus, Seamless, Hide the toolbar, and Sidebar + address (the toolbar's buttons sit behind the address block there);
 *  - 'none': nowhere at rest (Focus with no sidebar row); the toolbar's silent anchor still answers an extension's shortcut and action.openPopup().
 * Static: it reads the settings and the window's view, never a measurement (a toolbar copy that a narrow window folds into its » menu is still 'toolbar'; feeding that back would flip the place on and off). The copy that is drawn is the one that
 * answers popup requests (BrowserExtensionActions handlesPopupEvents: the toolbar's default; the sidebar row never does), and with the sidebar closed the toolbar's silent anchor answers, so no extension is ever out of reach. */
export type PinnedExtensionPlace = 'toolbar' | 'sidebar' | 'none';
export function pinnedExtensionPlace(settings: Pick<Settings, 'verticalTabs' | 'shelf' | 'sidebarRail' | 'addressInSidebar' | 'hideToolbar' | 'windowView' | 'toolbarLayout'> | null | undefined, windowUi: Pick<WindowUi, 'view'> & { app?: boolean } | null | undefined): PinnedExtensionPlace {
  const view: WindowView = effectiveView(settings, windowUi);
  // the open sidebar draws the row; the Top + sidebar rail and an installed web app's window have none
  const rowCanExist = sidebarOn(settings) && !railOn(settings) && windowUi?.app !== true;
  const toolbarAtRest = !!settings && !sidebarModeOn(settings as never) && view !== 'focus' && view !== 'seamless' && !hideToolbarOn(settings, view);
  if (toolbarAtRest) return 'toolbar';
  if (rowCanExist) return 'sidebar';
  return view === 'seamless' ? 'toolbar' : 'none';
}
