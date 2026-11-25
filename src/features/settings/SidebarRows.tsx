import type { BrowserAction, BrowserSnapshot, SidebarReveal, SidebarSide } from '../../runtime/types';
import { effectiveView, hideToolbarOn, seamlessEdgesOf, sidebarHeldOpenIn, sidebarPeekOf } from '../../runtime/windowView';
import { sidebarModeOn } from '../../ui/sidebarMode';
import { sidebarOn } from '../../runtime/shelf';
import { miniRailOn } from '../../runtime/miniSidebar';
import { sidebarEdgeId, sidebarSideOf } from '../../ui/sidebarSide';
import { Select, SettingRow, Switch } from './controls';

import { t } from '../../i18n';
/** The sidebar rows. They live in Settings › Tabs › Sidebar only (Appearance › Layout points at them); a row that cannot apply in the current setup stays, off the table, with its reason (settings/layoutAvailability.ts). Where the address bar lives is not a row of its own:
 * it is the third answer of the Tabs choice (TabLayoutRow, ui/sidebarMode.ts). */
type Props = { state: BrowserSnapshot; dispatch: (action: BrowserAction) => void };

/** Which side of the window the sidebar stands on: Left or Right (physical in every language). Sidebar tabs only, like the rows around it. */
export function SidebarSideRow({ state, dispatch, always }: Props & { always?: boolean }) {
  if (!sidebarOn(state.settings) && !always) return null;
  const noSidebar = !sidebarOn(state.settings);
  return (
    <SettingRow id="sidebar-side" title={t('sidebar.side')} detail={noSidebar ? t('settings.reasonNoSidebar') : t('sidebar.sideDetail')}>
      <Select<SidebarSide> label={t('sidebar.side')} value={sidebarSideOf(state.settings)} disabled={noSidebar} onChange={(next) => dispatch({ type: 'settings.update', patch: { sidebarSide: next } })} options={[{ value: 'left', label: t('sidebar.sideLeft') }, { value: 'right', label: t('sidebar.sideRight') }]} />
    </SettingRow>
  );
}

/** Beta 14.4: the edge rows are always listed, each in its own home, and say why when they cannot be switched (nothing disappears).
 * Sidebar › "When the sidebar is closed, show it at the left edge": a closed sidebar showing itself in Full, Compact or Focus (one switch each). */
export function SidebarPeekRow({ state, dispatch }: Props) {
  const s = state.settings, windowView = effectiveView(s, state.windowUi), side = sidebarSideOf(s);
  // Beta 14: with Mini, a closed sidebar is a rail beside the page and nothing waits at the edge. Beta 14: with a handle only, or never, the whole edge has nothing to decide.
  const mini = miniRailOn(s, state.windowUi);
  const wholeEdge = s.sidebarReveal !== 'handle' && s.sidebarReveal !== 'never';
  const view = windowView === 'seamless' ? 'full' : windowView;
  // Sidebar mode has no top bar to fall back to, and a hidden toolbar takes its sidebar button with it: there a closed sidebar always comes back from its edge.
  const reason = !sidebarOn(s) ? 'settings.reasonNoSidebar' : windowView === 'seamless' ? 'settings.reasonPeekSeamless'
    : (sidebarModeOn(s) || hideToolbarOn(s, windowView)) ? 'settings.reasonPeekAlways' : mini ? 'settings.reasonHiddenOnly' : !wholeEdge ? 'settings.reasonWholeEdgeOnly' : null;
  return (
    <SettingRow id="sidebar-peek" title={t(sidebarEdgeId('windowview.closedSidebarEdge', side))} detail={reason ? t(reason) : t(sidebarEdgeId('windowview.closedSidebarEdgeDetail', side))}>
      <Switch label={t(sidebarEdgeId('windowview.closedSidebarEdge', side))} disabled={reason !== null} checked={sidebarPeekOf(s)[view]} onChange={(on) => dispatch({ type: 'settings.update', patch: { sidebarPeek: { ...sidebarPeekOf(s), [view]: on } } })} />
    </SettingRow>
  );
}

/** Layout › Window view › "In Seamless, show the sidebar at the left edge" (not with the address bar in the sidebar: the sidebar then answers to the address's own edge). */
export function SeamlessSideRow({ state, dispatch }: Props) {
  const s = state.settings, windowView = effectiveView(s, state.windowUi), side = sidebarSideOf(s);
  const wholeEdge = s.sidebarReveal !== 'handle' && s.sidebarReveal !== 'never';
  const reason = !sidebarOn(s) ? 'settings.reasonNoSidebar' : windowView !== 'seamless' ? 'settings.reasonOnlySeamless'
    : s.addressInSidebar ? 'settings.reasonSeamlessSideAddress' : !wholeEdge ? 'settings.reasonWholeEdgeOnly' : null;
  return (
    <SettingRow id="seamless-edge-side" title={t(sidebarEdgeId('windowview.edgeSide', side))} detail={reason ? t(reason) : t('windowview.edgeSideDetail')}>
      <Switch label={t(sidebarEdgeId('windowview.edgeSide', side))} disabled={reason !== null} checked={seamlessEdgesOf(s).side} onChange={(next) => dispatch({ type: 'settings.update', patch: { seamlessEdges: { ...seamlessEdgesOf(s), side: next } } })} />
    </SettingRow>
  );
}

/** Beta 14, "Show the hidden sidebar when the mouse touches": the whole edge (as it always was, the default), a handle only (a short faint line on the edge that is dragged to where it suits; only it reveals the sidebar),
 * or never (the shortcut and the menu only). Shown only where the sidebar can hide: sidebar tabs, and not Sidebar + address in Full, where it is held open. In the handle and never modes the views' own edge switches above
 * have nothing to decide (the handle is there for any hidden sidebar), so they are shown but off the table. */
export function SidebarRevealRow({ state, dispatch }: Props) {
  const s = state.settings;
  const noSidebar = !sidebarOn(s), heldOpen = !noSidebar && sidebarHeldOpenIn(s, state.windowUi);
  // Beta 14: only a Hidden sidebar comes back from the edge (and Seamless's, whatever the choice says): with Mini the rail is what the mouse reaches, so the choice is shown off the table with the reason.
  const mini = miniRailOn(s, state.windowUi);
  const mode: SidebarReveal = s.sidebarReveal === 'handle' || s.sidebarReveal === 'never' ? s.sidebarReveal : 'edge';
  return (
    <SettingRow id="sidebar-reveal" title={t('sidebar.reveal')} detail={noSidebar ? t('settings.reasonNoSidebar') : heldOpen ? t('settings.reasonSidebarHeldOpen') : mini ? t('settings.reasonHiddenOnly') : t('sidebar.revealDetail')}>
      <Select<SidebarReveal> label={t('sidebar.reveal')} value={mode} disabled={mini || noSidebar || heldOpen} onChange={(next) => dispatch({ type: 'settings.update', patch: { sidebarReveal: next } })}
        options={[{ value: 'edge', label: t('sidebar.revealEdge') }, { value: 'handle', label: t('sidebar.revealHandle') }, { value: 'never', label: t('sidebar.revealNever') }]} />
    </SettingRow>
  );
}
