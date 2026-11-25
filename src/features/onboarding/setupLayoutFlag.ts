import { tabsLayouts, type TabsLayout } from '../../ui/sidebarMode';

/** OPEN (Beta 14 brief K2, "the team to confirm"): the layout picker as a step of the setup flow. Make it yours already asks the Tabs question with three answers; with this on
 * it asks with all four, Top + sidebar included, which is the same picker as Settings › Appearance › Layout and the menus (they read the one `tabsLayouts` list).
 * It is built and OFF. Turning it on is this one value (or `ACIRA_SETUP_LAYOUT_PICKER=1` in a development build, so pictures can be made without editing code). */
export const SETUP_LAYOUT_PICKER = false;

/** The Tabs answers the setup flow offers, in the picker's order. */
export function setupTabsLayouts(on: boolean = SETUP_LAYOUT_PICKER || devSwitchOn()): readonly TabsLayout[] {
  return on ? tabsLayouts : tabsLayouts.filter((layout) => layout !== 'top-sidebar');
}

function devSwitchOn(): boolean {
  try { return import.meta.env.DEV === true && localStorage.getItem('acira-setup-layout-picker') === '1'; } catch { return false; }
}
