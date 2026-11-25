import { Fragment, type ReactNode } from 'react';
import type { BrowserAction, BrowserSnapshot } from '../../runtime/types';
import type { BrowserMenuIcon } from '../BrowserMenu';
import { Check } from '../AppIcons';
import { SIDEBAR_SIZE_ORDER, SIDEBAR_SIZES, sizeOf } from '../../ui/sidebarLayout';
import { SIZE_NAME_ID } from '../../ui/sidebarSizeNames';
import { SHELF_SIZE_ORDER, shelfOn, shelfSizeOf, shelfSizePatch } from '../../runtime/shelf';
import { t } from '../../i18n';

/** The menu of the sidebar's edge (right-click on it, or the menu key with it focused): the three sizes with a tick on the current one. It is the same menu
 * on a sidebar on the right; the popup opens on the page side of the edge either way. Choosing a size closes it (the sidebar eases to the new width). In Top + sidebar (the Shelf) the list has the rail first, as the Settings row and the edge's keys do: the choice is the same `shelfSizePatch` (the rail is a switch of its own, so picking a width also turns it off). */
const Blank: BrowserMenuIcon = ({ size }) => <svg width={size ?? 16} height={size ?? 16} aria-hidden="true" />; // the icon column of a row that is not ticked (the row styles its svg child, not a span)
export function SizeMenu({ state, dispatch, row, close }: { state: BrowserSnapshot; dispatch: (action: BrowserAction) => void; row: (label: string, Icon: BrowserMenuIcon, action: () => void, hint?: string) => ReactNode; close: () => void }) {
  const shelf = shelfOn(state.settings), current = shelf ? shelfSizeOf(state.settings) : sizeOf(state.settings.sidebarWidth);
  return <div role="group" aria-label={t('sidebar.sizeTitle')}>
    {(shelf ? SHELF_SIZE_ORDER : SIDEBAR_SIZE_ORDER).map((size) => <Fragment key={size}>
      {row(t(size === 'rail' ? 'sidebar.sizeRail' : SIZE_NAME_ID[size]), size === current ? Check : Blank, () => { dispatch({ type: 'settings.update', patch: shelf ? shelfSizePatch(size) : { sidebarWidth: SIDEBAR_SIZES[size as keyof typeof SIDEBAR_SIZES] } }); close(); })}
    </Fragment>)}
  </div>;
}
