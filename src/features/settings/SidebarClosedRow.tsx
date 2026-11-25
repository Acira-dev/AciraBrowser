import { ChoiceCards } from './ChoiceCards';
import { RailMini } from './SidebarSizeRow';
import { SettingCrossLink, SettingRow } from './controls';
import { closedBlock, closedChoiceAvailable, type ClosedBlock } from './layoutAvailability';
import { sidebarClosedOf, type SidebarClosed } from '../../runtime/miniSidebar';
import type { BrowserAction, BrowserSnapshot } from '../../runtime/types';
import { chooseSidebarClosed } from '../../ui/sidebarClosedChoice';
import { t, type MessageId } from '../../i18n';

/** Beta 14, Settings › Tabs › Sidebar › "When the sidebar is closed": Mini (a slim column of icons beside the page that opens over it when pointed at) or Hidden (nothing on screen; the sidebar
 * comes back from the window's edge, Beta 14 T's "Show the hidden sidebar when the mouse touches"). Two pictures drawn like the Sidebar size cards (SidebarSizeRow.tsx: the rail with its column, the same
 * window with none), so they take the live theme and mirror with the sidebar on the right. The line under the row says what the chosen card does.
 * The row is always there. Where a choice cannot work in this setup (settings/layoutAvailability.ts, the rules the window itself uses) its card is dimmed and cannot be chosen, and a line under the cards
 * says why and opens the setting that changes it: Mini in Seamless, in Sidebar + address (14.0 re-release: no Mini there) or with the Shelf folded to its rail; both cards where the sidebar does not exist (Along the top).
 * A choice already made stays chosen (dimmed): it comes back when the setup allows it. */
const REASON: Record<Exclude<ClosedBlock, 'none'>, { text: MessageId; to: string; section: string; title: MessageId }> = {
  seamless: { text: 'settings.reasonMiniView', to: 'window-view', section: 'Layout', title: 'windowview.title' },
  address: { text: 'settings.reasonMiniAddress', to: 'sidebar-only-tabs', section: 'Layout', title: 'settings.whereTabsGo' },
  rail: { text: 'settings.reasonMiniRail', to: 'sidebar-size', section: 'Sidebar', title: 'sidebar.sizeTitle' },
  'no-sidebar': { text: 'settings.reasonNoSidebar', to: 'sidebar-only-tabs', section: 'Layout', title: 'settings.whereTabsGo' },
};
export function SidebarClosedRow({ state, dispatch }: { state: BrowserSnapshot; dispatch: (action: BrowserAction) => void }) {
  const s = state.settings;
  const value = sidebarClosedOf(s), block = closedBlock(s, state.windowUi);
  const reason = block === 'none' ? null : REASON[block];
  return <>
    <SettingRow id="sidebar-closed" title={t('sidebar.closedTitle')} detail={t(value === 'mini' ? 'sidebar.closedMiniDetail' : 'sidebar.closedHiddenDetail')} stacked>
      <ChoiceCards<SidebarClosed> label={t('sidebar.closedTitle')} value={value} columns={4}
        onChange={(next) => chooseSidebarClosed(state, dispatch, next)}
        options={[
          { value: 'mini', label: t('sidebar.closedMini'), art: <RailMini />, disabled: !closedChoiceAvailable(block, 'mini') },
          { value: 'hidden', label: t('sidebar.closedHidden'), art: <RailMini column={false} />, disabled: !closedChoiceAvailable(block, 'hidden') },
        ]} />
    </SettingRow>
    {reason && <SettingCrossLink id="closed-reason" to={reason.to} section={reason.section} title={t(reason.title)} detail={t(reason.text)} />}
  </>;
}
