import {useRef} from 'react';
import {BrowserExtensionActions} from '../BrowserExtensionActions';
import {useExtensionToolbar} from '../../ui/useExtensionToolbar';
import type {TabSession} from '../../runtime/types';
import type {ExtensionToolbarTarget} from '../../runtime/connectedServices';
import {t} from '../../i18n';

/**
 * What the row shows while the toolbar's hook is asking again. The hook answers null for a moment at every tab switch and every address change, which hides the
 * toolbar's buttons for a frame without moving anything. Here it would drop the row and jump the whole tab list up and down by the row's height on every
 * navigation, so the last answer of the same profile stays until the new one comes. A tab with an error page, no tab, or another profile gets none.
 */
export function keepTarget(previous:ExtensionToolbarTarget|null,next:ExtensionToolbarTarget|null,tab:Pick<TabSession,'browserProfileId'|'error'>|null):ExtensionToolbarTarget|null{
 if(next)return next;
 if(!tab||tab.error||!previous||previous.profileId!==tab.browserProfileId)return null;
 return previous;
}

/**
 * The pinned extensions, as a row of buttons at the top of the sidebar (13.6, from a Linux report: with the toolbar folded away or hidden nobody found them). The
 * same buttons as the toolbar's, from the same engine and the same pinned list and order of the same profile, so a click opens the popup, a right click gives the
 * toolbar button's menu (Unpin included), and a private window shows what its own session runs. The toolbar keeps its own copy: nothing that was there moved.
 * Only the toolbar's copy answers action.openPopup() and an extension's shortcut (handlesPopupEvents), so one request opens one popup.
 */
export function SidebarExtensions({tab}:{tab:TabSession|null}){
 const answer=useExtensionToolbar(tab),last=useRef<ExtensionToolbarTarget|null>(null);
 const target=keepTarget(last.current,answer,tab);
 last.current=target;
 const shown=Boolean(target?.supported&&target.pinnedIds.length);
 return <div className="sb-ext-row" role="group" aria-label={t('browserextensionactions.pinnedExtensions')} hidden={!shown}><BrowserExtensionActions target={target} limit={12} handlesPopupEvents={false}/></div>;
}
