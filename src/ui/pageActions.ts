import type { MouseEvent } from 'react';
import type { BrowserAction,BrowserSnapshot } from '../runtime/types';

export function openPage(event:MouseEvent,url:string,dispatch:(action:BrowserAction)=>void,onNavigate:(url:string)=>void){
  if(event.button!==0&&event.button!==1)return;
  event.preventDefault();
  if(event.button===1||event.ctrlKey||event.metaKey||event.shiftKey){dispatch({type:'tab.new',url,background:!event.shiftKey});return;}
  onNavigate(url);
}

export const bookmarkMenuEvent='acira-study-bookmark-menu';
export type BookmarkMenuRequest={url:string;anchor:{x:number;y:number;width:number;height:number}};
export function bookmarkContext(event:MouseEvent,url:string,_state:BrowserSnapshot){
  event.preventDefault();
  // A bookmark URL is not a tab ID. Route within the trusted chrome renderer,
  // through its existing menu controller, rather than weakening the IPC schema.
  window.dispatchEvent(new CustomEvent<BookmarkMenuRequest>(bookmarkMenuEvent,{detail:{url,anchor:{x:event.clientX,y:event.clientY,width:2,height:2}}}));
}

/** The newest visit of each page per profile, built once per history list: every row of History, Bookmarks and the new tab page asks for its page, and a scan of up to 5,000 visits per row was most of those pages' render time. */
const visitIndex=new WeakMap<BrowserSnapshot['browsingHistory'],{first:string|undefined;pages:Map<string,BrowserSnapshot['browsingHistory'][number]>}>();
function visitOf(state:BrowserSnapshot,url:string,profileId:string){
  const first=state.browserProfiles[0]?.id;let index=visitIndex.get(state.browsingHistory);
  if(!index||index.first!==first){const pages=new Map<string,BrowserSnapshot['browsingHistory'][number]>();for(const item of state.browsingHistory){const key=(item.browserProfileId??first)+'\n'+item.url;if(!pages.has(key))pages.set(key,item);}index={first,pages};visitIndex.set(state.browsingHistory,index);}
  return index.pages.get(profileId+'\n'+url);
}
export function savedPageIdentity(url:string,state:BrowserSnapshot){
  const profileId=state.tabs.find(tab=>tab.id===state.activeTabId)?.browserProfileId||state.activeBrowserProfileId;
  const tab=state.tabs.find(tab=>tab.url===url&&tab.browserProfileId===profileId);
  const visit=visitOf(state,url,profileId);
  return {title:tab?.title||visit?.title,favicon:tab?.favicon};
}
/** Copy from a trusted UI click. The UI session grants no clipboard permission, so this uses the
 * click's own user activation (execCommand) and only falls back to the async API. */
export function copyText(text:string):Promise<void>{
  const area=document.createElement('textarea');area.value=text;area.setAttribute('readonly','');area.style.cssText='position:fixed;left:-9999px;top:0;opacity:0';
  const previous=document.activeElement as HTMLElement|null;document.body.append(area);area.select();
  let copied=false;try{copied=document.execCommand('copy');}catch{}
  area.remove();previous?.focus?.({preventScroll:true});
  return copied?Promise.resolve():navigator.clipboard.writeText(text);
}
