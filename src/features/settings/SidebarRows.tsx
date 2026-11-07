import type { BrowserAction, BrowserSnapshot } from '../../runtime/types';
import { effectiveView, seamlessEdgesOf, sidebarPeekOf } from '../../runtime/windowView';
import { setRailPrefs } from '../../ui/railPrefs';
import { setSidebarMode, sidebarModeOn } from '../../ui/sidebarMode';
import { SettingRow, Switch } from './controls';

import { t } from '../../i18n';
/** The sidebar rows that live in two places (Settings › Tabs › Sidebar, and Appearance › Layout beside the Window view they depend on).
 * Each reads and writes the one setting, so the two always agree; the registry names the Tabs one. */
type Props = { state: BrowserSnapshot; dispatch: (action: BrowserAction) => void };

/** Tabs in the sidebar, in this window and in the profile's own sidebar switch (Appearance › Layout and Tabs share this). */
export function useSidebarTabs({ state, dispatch }: Props) {
  const tab = state.tabs.find((item) => item.id === state.activeTabId) || state.tabs[0];
  const profile = state.browserProfiles.find((item) => item.id === tab.browserProfileId);
  return {
    inSidebar: Boolean(state.settings.verticalTabs),
    useSidebar: () => {
      dispatch({ type: 'settings.update', patch: { verticalTabs: true } });
      setRailPrefs({ tabs: true }, tab.browserProfileId, profile?.private);
    },
  };
}

/** Address bar in the sidebar. With tabs along the top the row stays, saying what it needs and offering the one tap that gives it. */
export function AddressInSidebarRow({ state, dispatch, always }: Props & { always?: boolean }) {
  const { inSidebar, useSidebar } = useSidebarTabs({ state, dispatch });
  if (!inSidebar && !always) return null;
  if (!inSidebar)
    return (
      <SettingRow id="address-in-sidebar" title={t('windowview.addressInSidebar')} detail={t('sidebar.addressNeedsSidebarTabs')}>
        <button type="button" className="st-button" onClick={useSidebar}>{t('sidebar.moveTabsToSidebar')}</button>
      </SettingRow>
    );
  return (
    <SettingRow id="address-in-sidebar" title={t('windowview.addressInSidebar')} detail={t('windowview.addressInSidebarDetail')}>
      <Switch label={t('windowview.addressInSidebar')} checked={state.settings.addressInSidebar === true} onChange={(on) => dispatch({ type: 'settings.update', patch: { addressInSidebar: on } })} />
    </SettingRow>
  );
}

/** The left edge reveal for the window view in use: a closed sidebar showing itself (Full, Compact, Focus: one switch each), or the
 * sidebar in Seamless (not with the address bar in it: the sidebar then answers to the address's own edge). Sidebar tabs only. */
export function SidebarEdgeRows({ state, dispatch, describe }: Props & { /** Tabs › Sidebar says what the switch does; Appearance › Layout keeps its bare row. */ describe?: boolean }) {
  const s = state.settings, windowView = effectiveView(s, state.windowUi);
  if (!s.verticalTabs) return null;
  // Sidebar mode has no top bar to fall back to: a closed sidebar always comes back from the left edge, so there is nothing to switch.
  if (windowView !== 'seamless' && sidebarModeOn(s)) return null;
  if (windowView !== 'seamless')
    return (
      <SettingRow id="sidebar-peek" title={t('windowview.closedSidebarEdge')} detail={describe ? t('windowview.closedSidebarEdgeDetail') : undefined}>
        <Switch label={t('windowview.closedSidebarEdge')} checked={sidebarPeekOf(s)[windowView]} onChange={(on) => dispatch({ type: 'settings.update', patch: { sidebarPeek: { ...sidebarPeekOf(s), [windowView]: on } } })} />
      </SettingRow>
    );
  if (s.addressInSidebar) return null;
  return (
    <SettingRow id="seamless-edge-side" title={t('windowview.edgeSide')}>
      <Switch label={t('windowview.edgeSide')} checked={seamlessEdgesOf(s).side} onChange={(side) => dispatch({ type: 'settings.update', patch: { seamlessEdges: { ...seamlessEdgesOf(s), side } } })} />
    </SettingRow>
  );
}

/** Sidebar mode: tabs and the address bar in the sidebar, in one step; off goes back to how it was (ui/sidebarMode.ts). */
export function SidebarModeRow({ state, dispatch }: Props) {
  return (
    <SettingRow id="sidebar-mode" title={t('sidebarmode.title')} detail={t('sidebarmode.detail')}>
      <Switch label={t('sidebarmode.title')} checked={sidebarModeOn(state.settings)} onChange={(on) => setSidebarMode(state, dispatch, on)} />
    </SettingRow>
  );
}
