import type { ReactNode } from 'react';
import type { BrowserAction, BrowserSnapshot } from '../../runtime/types';
import type { BrowserMenuIcon } from '../BrowserMenu';
import { Check } from '../AppIcons';
import { t } from '../../i18n';

/** The now-playing card's menu (right-click on the card, or the menu key on its picture-in-picture button): the one switch the person meets there, "Picture-in-picture when I switch tabs",
 * with a tick while it is on. It is the Settings > Tabs setting itself (`autoPictureInPicture`), so the two never disagree. Choosing it closes the menu. */
const Blank: BrowserMenuIcon = ({ size }) => <svg width={size ?? 16} height={size ?? 16} aria-hidden="true" />;   // the icon column of a row that is not ticked
export function MediaMenu({ state, dispatch, row, close }: { state: BrowserSnapshot; dispatch: (action: BrowserAction) => void; row: (label: string, Icon: BrowserMenuIcon, action: () => void, hint?: string) => ReactNode; close: () => void }) {
  const on = state.settings.autoPictureInPicture === true;
  return <div role="group" aria-label={t('autopip.title')}>
    {row(t('autopip.title'), on ? Check : Blank, () => { dispatch({ type: 'settings.update', patch: { autoPictureInPicture: !on } }); close(); })}
  </div>;
}
