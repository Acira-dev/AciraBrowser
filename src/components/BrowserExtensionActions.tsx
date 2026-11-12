import {useEffect,useRef} from 'react';
import '../styles/extension-actions.css';
import {runtime} from '../runtime/client';

import type {ExtensionToolbarTarget} from '../runtime/connectedServices';
import { t } from '../i18n';
import { popupAnchor } from '../ui/extensionPopupAnchor';
export type {ExtensionToolbarTarget} from '../runtime/connectedServices';

/** The engine's toolbar bridge (electron-chrome-extensions/browser-action), exposed to the interface by the preload. */
interface ActionState{id:string;tabs?:Record<string,{enabled?:boolean;color?:string;textColor?:string}>}
interface ActionBridge{getAction(id:string):ActionState|undefined;addEventListener(name:string,listener:()=>void):void;removeEventListener(name:string,listener:()=>void):void;activate(partition:string,details:Record<string,unknown>):Promise<unknown>}
const bridge=():ActionBridge|undefined=>(window as unknown as {browserAction?:ActionBridge}).browserAction;
const DEFAULT_BADGE='#666';

/** Preserve the public library's real buttons, badges, context actions and keyboard behavior. */
export function BrowserExtensionActions({target,limit=6,handlesPopupEvents=true,silent=false}:{target:ExtensionToolbarTarget|null;limit?:number;/** Only one copy of the buttons answers action.openPopup() and an extension's shortcut: the sidebar's row says false. */handlesPopupEvents?:boolean;/** No buttons, only the answer to action.openPopup() and an extension's shortcut, hung from the Acira menu button: Focus view with the Top bar layout draws no extension buttons and had nobody to answer them (App.tsx). */silent?:boolean}){
 const root=useRef<HTMLDivElement>(null),signature=target?JSON.stringify([target.profileId,target.partition,target.webContentsId,target.pinnedIds,limit]):'';
 useEffect(()=>{
  const host=root.current;if(silent||!host||!target?.supported||!target.partition||target.webContentsId===null||!target.pinnedIds.length)return;let alive=true,observer:MutationObserver|undefined,frame=0;const pinned=new Set(target.pinnedIds.slice(0,limit)),rank=new Map(target.pinnedIds.map((id,at)=>[id,String(at)]));let list:HTMLElement|undefined;
  const tabKey=String(target.webContentsId);
  // The engine's button draws a badge in white on the extension's colour and knows nothing of a disabled action (action.disable) or a text colour
  // (action.setBadgeTextColor): the state it receives carries them, the buttons are dressed here. Values are written only when they differ.
  const put=(element:HTMLElement,property:'color'|'backgroundColor'|'opacity'|'filter'|'cursor',value:string)=>{if(element.style[property]!==value)element.style[property]=value;};
  const dress=()=>{
   for(const button of list?.shadowRoot?.querySelectorAll<HTMLButtonElement>('button.action')||[]){
    const own=bridge()?.getAction(button.id)?.tabs?.[tabKey],disabled=own?.enabled===false;
    put(button,'opacity',disabled?'.4':'');put(button,'filter',disabled?'grayscale(1)':'');put(button,'cursor',disabled?'default':'');
    if(disabled)button.setAttribute('aria-disabled','true');else button.removeAttribute('aria-disabled');
    const badge=button.querySelector<HTMLElement>('.badge');
    if(badge){put(badge,'color',own?.textColor||'#fff');put(badge,'backgroundColor',own?.color&&own.color!=='rgba(0, 0, 0, 0)'?own.color:DEFAULT_BADGE);}
   }
  };
  const later=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{frame=requestAnimationFrame(dress);});};
  void customElements.whenDefined('browser-action-list').then(()=>{if(!alive)return;list=document.createElement('browser-action-list');list.setAttribute('partition',target.partition!);list.setAttribute('tab',String(target.webContentsId));list.setAttribute('alignment','bottom right');host.append(list);const sync=()=>{for(const button of list!.shadowRoot?.querySelectorAll<HTMLButtonElement>('button.action')||[]){const visible=pinned.has(button.id),display=visible?'':'none',order=rank.get(button.id)??'';if(button.hidden===visible)button.hidden=!visible;if(button.style.display!==display)button.style.display=display;/* the engine adds the buttons in the order its extensions first spoke, which races: the buttons follow the list's order (the order they were added) */if(button.style.order!==order)button.style.order=order;}dress();};if(list.shadowRoot){observer=new MutationObserver(sync);observer.observe(list.shadowRoot,{childList:true,subtree:true,attributes:true,attributeFilter:['style','class']});}sync();bridge()?.addEventListener('update',later);}).catch(()=>{/* Keep the ordinary extension manager available if public action setup fails. */});
  return()=>{alive=false;cancelAnimationFrame(frame);observer?.disconnect();bridge()?.removeEventListener('update',later);list?.remove();};
 },[signature,silent]);   // silent in the deps: the copy that stood in the toolbar before Focus is the same instance after it, and its buttons must go (a stale one answered the event with a rectangle of 0 x 0)
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
 return <div className="native-extension-actions" ref={root} aria-label={t("browserextensionactions.pinnedExtensions")} hidden={silent||!target?.supported||!target.pinnedIds.length}/>;
}
