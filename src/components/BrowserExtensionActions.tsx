import {useEffect,useLayoutEffect,useRef} from 'react';
import '../styles/extension-actions.css';
import {runtime} from '../runtime/client';

import type {ExtensionToolbarTarget} from '../runtime/connectedServices';
import { t } from '../i18n';
import { popupAnchor } from '../ui/extensionPopupAnchor';
import {bridge,moreRows,openButtonList,type ButtonList,type ButtonWish} from '../ui/extensionButtonList';
import {setMoreTarget} from '../ui/extensionMoreTarget';
import {LineIcon} from './LineIcon';
export type {ExtensionToolbarTarget} from '../runtime/connectedServices';

/** Preserve the public library's real buttons, badges, context actions and keyboard behavior. */
export function BrowserExtensionActions({target,limit=6,handlesPopupEvents=true,silent=false,keepAs,more}:{target:ExtensionToolbarTarget|null;limit?:number;/** Only one copy of the buttons answers action.openPopup() and an extension's shortcut: the sidebar's row says false. */handlesPopupEvents?:boolean;/** No buttons, only the answer to action.openPopup() and an extension's shortcut, hung from the Acira menu button: Focus view with the Top bar layout draws no extension buttons and had nobody to answer them (App.tsx). */silent?:boolean;/** A place that comes and goes (the sidebar's row: the whole sidebar is an empty column while it is hidden) names itself, so its buttons are kept while it is away and are in its very first frame when it comes back (ui/extensionButtonList.ts). */keepAs?:string;/** Beta 14: the extensions beyond `limit` are behind a "more" button at the end of the buttons (a list in a pop-up: ExtensionMoreList); `tabId` is the window's active tab, which the pop-up is opened for. Without it the extensions beyond `limit` are not shown (the manager's copies show all). */more?:{tabId:string}}){
 const root=useRef<HTMLDivElement>(null),buttons=useRef<ButtonList|null>(null),signature=target?JSON.stringify([target.profileId,target.partition,target.webContentsId,target.pinnedIds,limit]):'';
 const wanted=!silent&&Boolean(target?.supported&&target.partition&&target.webContentsId!==null&&target.pinnedIds.length);
 const wishOf=(target:ExtensionToolbarTarget):ButtonWish=>{const pinned=new Set(target.pinnedIds.slice(0,limit)),rank=new Map(target.pinnedIds.map((id,at)=>[id,String(at)]));return {tab:target.webContentsId!,pinned,rank};};
 // The list of buttons stands as long as this place wants buttons (silent in the deps: the copy that stood in the toolbar before Focus is the same instance after it, and its buttons must go: a stale one answered the event with a rectangle of 0 x 0).
 // It is not built again at a tab switch or a change of the pinned list: the one that is there is told (the next effect), so its icons do not blink (ui/extensionButtonList.ts).
 useLayoutEffect(()=>{
  const host=root.current;if(!host||!wanted||!target)return;
  const opened=openButtonList({host,partition:target.partition!,keepAs,wish:wishOf(target)});buttons.current=opened;
  return()=>{opened.release();if(buttons.current===opened)buttons.current=null;};
 },[wanted,target?.partition,keepAs,silent]);// eslint-disable-line react-hooks/exhaustive-deps
 useLayoutEffect(()=>{if(wanted&&target)buttons.current?.wish(wishOf(target));},[signature]);// eslint-disable-line react-hooks/exhaustive-deps
 // action.openPopup() and the shortcut of _execute_action: press the extension's own button; an extension that is not on the toolbar opens its popup at the toolbar's end.
 useEffect(()=>{
  if(limit>12||!handlesPopupEvents||!target?.supported||!target.partition)return;
  return runtime.subscribeBrowser(event=>{
   if(event.type!=='extension-popup')return;
   const button=root.current?.querySelector('browser-action-list')?.shadowRoot?.querySelector<HTMLButtonElement>(`button.action[id="${CSS.escape(event.extensionId)}"]`);
   if(button&&!button.hidden&&button.style.display!=='none'){button.click();return;}
   const edge=silent?null:root.current?.getBoundingClientRect(),menu=silent?[...document.querySelectorAll('.toolbar-menu-control')].map(node=>node.getBoundingClientRect()).find(box=>box.width>0&&box.height>0):null;
   void bridge()?.activate(target.partition!,{eventType:'click',extensionId:event.extensionId,tabId:target.webContentsId??-1,alignment:'bottom right',anchorRect:popupAnchor({menu:menu&&{x:menu.x,y:menu.y,width:menu.width,height:menu.height},edge,viewportWidth:window.innerWidth})});
  });
 },[target?.partition,target?.webContentsId,target?.supported,limit,handlesPopupEvents,silent]);
 const behind=wanted&&more&&target?target.pinnedIds.length-Math.max(0,limit):0,moreButton=useRef<HTMLButtonElement>(null);
 const asking=useRef(false);
 const openMore=async()=>{
  const button=moreButton.current;if(!button||!more||!target?.partition||target.webContentsId===null||asking.current)return;
  asking.current=true;
  const box=button.getBoundingClientRect(),anchor={x:box.x,y:box.y,width:box.width,height:box.height},partition=target.partition,tab=target.webContentsId,behindIds=target.pinnedIds.slice(Math.max(0,limit));
  // The list names each extension by its name (the engine's action title can say more: "12 blocked"): asked of the extension manager, never waited for longer than a moment.
  const names=await Promise.race([target.profileId?runtime.extensions({profileId:target.profileId,type:'list'}).then(snapshot=>new Map(snapshot.extensions.map(extension=>[extension.id,extension.name]))):null,new Promise<null>(resolve=>setTimeout(resolve,150))]).catch(()=>null);
  asking.current=false;
  setMoreTarget({partition,tab,anchor,rows:moreRows(behindIds,tab).map(row=>({...row,title:names?.get(row.id)||row.title}))});
  void runtime.browserCommand({type:'ui',tabId:more.tabId,action:'open',kind:'extension-more',anchor});
 };
 return <div className="native-extension-actions" ref={root} aria-label={t("browserextensionactions.pinnedExtensions")} hidden={silent||!target?.supported||!target.pinnedIds.length}>{behind>0&&<button type="button" ref={moreButton} className="extension-more-button" data-popup-trigger data-sb-focus aria-haspopup="menu" aria-label={t('browserextensionactions.moreExtensions')} title={t('browserextensionactions.moreExtensions')} onClick={()=>void openMore()}><LineIcon name="puzzle" size={18}/></button>}</div>;
}
