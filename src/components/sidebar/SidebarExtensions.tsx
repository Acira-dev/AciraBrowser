import {useLayoutEffect,useRef,useState,type RefObject} from 'react';
import {BrowserExtensionActions} from '../BrowserExtensionActions';
import {useExtensionToolbar,warmTab} from '../../ui/useExtensionToolbar';
import {measuredSlots,rowSlots,slotsInSidebar} from '../../ui/extensionRowFit';
import {glideBy,springNow} from '../../ui/sharedMotion';
import type {TabSession} from '../../runtime/types';
export {keepTarget} from '../../ui/useExtensionToolbar';
import {t} from '../../i18n';

/** The last width the row measured: a row that mounts again (a reveal) starts from it, and corrects itself before the first paint if the sidebar's width changed meanwhile. */
let lastSlots=Number.POSITIVE_INFINITY;
/** How many buttons the row's one line has room for, kept up to date as the sidebar is dragged wider or narrower. */
function useRowSlots(row:RefObject<HTMLElement|null>,active:boolean):number{
 const [slots,setSlots]=useState(lastSlots);
 useLayoutEffect(()=>{
  const node=row.current;if(!node||!active)return;
  const measure=()=>{const style=getComputedStyle(node),next=measuredSlots(node.clientWidth-(parseFloat(style.paddingLeft)||0)-(parseFloat(style.paddingRight)||0));if(next===null)return;lastSlots=next;setSlots(current=>current===next?current:next);};
  measure();
  if(typeof ResizeObserver!=='function')return;
  const observer=new ResizeObserver(measure);observer.observe(node);
  return()=>observer.disconnect();
 },[active,row]);
 return slots;
}

/**
 * 14.1 (the team's GO for option B): a pin or an unpin changes how wide the group of buttons is, and a centred group then moves by half of
 * that. The group GLIDES from where it stood to its new place (the lists' own move, `reorder.move` on the frequent pace, picked up mid-flight by
 * the next change) instead of jumping. A change of the row's own width (the sidebar's edge dragged, a reveal, a size) is not the group's: there
 * the group follows the sidebar at once, as it always has. Reduced motion: no glide. Layout values only (offsetLeft / offsetWidth), so a glide in
 * flight never reads as a move of its own.
 */
function useGroupGlide(row:RefObject<HTMLElement|null>,active:boolean){
 useLayoutEffect(()=>{
  const node=row.current;if(!node||!active||typeof ResizeObserver!=='function')return;
  const read=()=>{const group=node.querySelector<HTMLElement>(':scope > .native-extension-actions');return group?{group,row:node.clientWidth,left:group.offsetLeft,width:group.offsetWidth}:null;};
  let last=read();
  const observer=new ResizeObserver(()=>{
   const now=read(),before=last;last=now;
   if(!now||!before||before.group!==now.group||before.row!==now.row||Math.abs(before.width-now.width)<.5)return;
   const dx=before.left-now.left;if(Math.abs(dx)>=.5)glideBy(now.group,{x:dx,y:0},springNow('reorder.move',true));
  });
  observer.observe(node);if(last)observer.observe(last.group);
  return()=>observer.disconnect();
 },[active,row]);
}

/**
 * The pinned extensions, as a row of buttons at the top of the sidebar (13.6, from a Linux report: with the toolbar folded away or hidden nobody found them). The
 * same buttons as the toolbar's, from the same engine and the same pinned list and order of the same profile, so a click opens the popup, a right click gives the
 * toolbar button's menu (Unpin included), and a private window shows what its own session runs. The toolbar keeps its own copy: nothing that was there moved.
 * Only the toolbar's copy answers action.openPopup() and an extension's shortcut (handlesPopupEvents), so one request opens one popup.
 * The whole sidebar is an empty column while it is hidden, so the row mounts again at every reveal: its buttons are kept between (keepAs) and its target comes from the hook's memory.
 * Beta 14: the row is ONE line at the buttons' own size. When more are pinned than the line holds, the last slot is a "more" button and the rest are behind it in a list
 * (ExtensionMoreList); the order is the pinned order and what does not fit is taken from the end. The row's height never changes with the number of extensions.
 * 14.1 (a Discord ask; the team chose option B from the pictures): while every pinned button fits (no "more" button) the buttons sit in the middle of the row
 * (`data-centred`, sidebar.css), so one to five pinned extensions no longer leave the row half empty on one side; a row with the "more" button is as before.
 */
export function SidebarExtensions({tab,place='top'}:{tab:TabSession|null;/** Customize sidebar: the row stands at the top edge (where it always was) or in the sidebar's list. */place?:'top'|'bottom'|'list'}){
 // The hook holds the last answer of the same profile while it asks again (a tab switch, an address change) and starts a new mount from it: the row is in the first frame of a reveal, with its buttons (keepAs).
 const target=useExtensionToolbar(tab),row=useRef<HTMLDivElement>(null);
 const shown=Boolean(target?.supported&&target.pinnedIds.length),total=target?.supported?target.pinnedIds.length:0;
 const fit=rowSlots(useRowSlots(row,shown),total);
 useGroupGlide(row,shown);
 return <div className="sb-ext-row" data-place={place==='top'?undefined:place} data-centred={shown&&!fit.more?'':undefined} ref={row} role="group" aria-label={t('browserextensionactions.pinnedExtensions')} title={t('sidebarextensions.hint')} hidden={!shown}><BrowserExtensionActions target={target} limit={fit.visible} handlesPopupEvents={false} keepAs="sidebar" more={tab?{tabId:tab.id}:undefined}/></div>;
}

/** In the holder every pinned button counts as shown: a button that is "shown" here is not "coming back" when the row takes the list, so none of them fades in during the slide. */
const WARM_LIMIT=99;
/**
 * Beta 14: the first reveal of a window whose sidebar started hidden had no list to bring (every later one does: keepAs). While the sidebar is hidden (the empty column) the list
 * waits here, in a holder that is not drawn, asked once for the page the sidebar started with (and again when the extensions change): its buttons and their icons are loaded before
 * the first reveal, and the reveal moves them to the row in the call that mounts it. The holder is the kept list's other place, never a second copy: the row's handle takes the list
 * over, and nothing here answers a pop-up request (handlesPopupEvents is false), so one request still opens one pop-up.
 */
export function SidebarExtensionsWarm({tab,tabs,width}:{tab:TabSession|null;tabs:readonly Pick<TabSession,'id'>[];/** The sidebar's width (the setting): a window that never showed its row yet starts the first reveal from the slots this gives, not from "all of them" (one button too many in the first frame, then the "more" button in its place). */width:number}){
 const first=useRef<TabSession|null>(null);
 useLayoutEffect(()=>{if(Number.isFinite(lastSlots))return;const seeded=slotsInSidebar(width);if(seeded!==null)lastSlots=seeded;},[width]);
 first.current=warmTab(first.current,tab,tabs);
 const target=useExtensionToolbar(first.current);
 return <div className="sb-ext-warm" hidden aria-hidden="true"><BrowserExtensionActions target={target} limit={WARM_LIMIT} handlesPopupEvents={false} keepAs="sidebar"/></div>;
}
