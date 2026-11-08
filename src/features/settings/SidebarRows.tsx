import type { BrowserAction, BrowserSnapshot, SidebarSide } from '../../runtime/types';
import { effectiveView, hideToolbarOn, seamlessEdgesOf, sidebarPeekOf } from '../../runtime/windowView';
import { sidebarModeOn } from '../../ui/sidebarMode';
import { sidebarEdgeId, sidebarSideOf } from '../../ui/sidebarSide';
import { Select, SettingRow, Switch } from './controls';

import { t } from '../../i18n';
/** The sidebar rows that live in two places (Settings › Tabs › Sidebar, and Appearance › Layout beside the Window view they depend on).
 * Each reads and writes the one setting, so the two always agree; the registry names the Tabs one. Where the address bar lives is not a row of its own:
 * it is the third answer of the Tabs choice (TabLayoutRow, ui/sidebarMode.ts). */
type Props = { state: BrowserSnapshot; dispatch: (action: BrowserAction) => void };

/** Which side of the window the sidebar stands on: Left or Right (physical in every language). Sidebar tabs only, like the rows around it. */
export function SidebarSideRow({ state, dispatch, always }: Props & { always?: boolean }) {
  if (!state.settings.verticalTabs && !always) return null;
  return (
    <SettingRow id="sidebar-side" title={t('sidebar.side')} detail={t('sidebar.sideDetail')}>
      <Select<SidebarSide> label={t('sidebar.side')} value={sidebarSideOf(state.settings)} onChange={(next) => dispatch({ type: 'settings.update', patch: { sidebarSide: next } })} options={[{ value: 'left', label: t('sidebar.sideLeft') }, { value: 'right', label: t('sidebar.sideRight') }]} />
    </SettingRow>
  );
}

/** The edge reveal for the window view in use (the edge the sidebar stands at): a closed sidebar showing itself (Full, Compact, Focus: one switch each), or the
 * sidebar in Seamless (not with the address bar in it: the sidebar then answers to the address's own edge). Sidebar tabs only. */
export function SidebarEdgeRows({ state, dispatch, describe }: Props & { /** Tabs › Sidebar says what the switch does; Appearance › Layout keeps its bare row. */ describe?: boolean }) {
  const s = state.settings, windowView = effectiveView(s, state.windowUi), side = sidebarSideOf(s);
  if (!s.verticalTabs) return null;
  // Sidebar mode has no top bar to fall back to: a closed sidebar always comes back from its own edge, so there is nothing to switch.
  // Also with the toolbar hidden (its sidebar button is away): a closed sidebar always comes back from its edge.
  if (windowView !== 'seamless' && (sidebarModeOn(s) || hideToolbarOn(s, windowView))) return null;
  if (windowView !== 'seamless')
    return (
      <SettingRow id="sidebar-peek" title={t(sidebarEdgeId('windowview.closedSidebarEdge', side))} detail={describe ? t(sidebarEdgeId('windowview.closedSidebarEdgeDetail', side)) : undefined}>
        <Switch label={t(sidebarEdgeId('windowview.closedSidebarEdge', side))} checked={sidebarPeekOf(s)[windowView]} onChange={(on) => dispatch({ type: 'settings.update', patch: { sidebarPeek: { ...sidebarPeekOf(s), [windowView]: on } } })} />
      </SettingRow>
    );
  if (s.addressInSidebar) return null;
  return (
    <SettingRow id="seamless-edge-side" title={t(sidebarEdgeId('windowview.edgeSide', side))}>
      <Switch label={t(sidebarEdgeId('windowview.edgeSide', side))} checked={seamlessEdgesOf(s).side} onChange={(side) => dispatch({ type: 'settings.update', patch: { seamlessEdges: { ...seamlessEdgesOf(s), side } } })} />
    </SettingRow>
  );
}
