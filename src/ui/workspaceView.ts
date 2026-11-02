import { useSyncExternalStore } from 'react';
import { runtime } from '../runtime/client';
import type { BrowserAction,BrowserSnapshot,TabSession } from '../runtime/types';

type View = 'home'|'bookmarks';
const key='acira-study-tab-views';
const listeners=new Set<()=>void>();
let views:Record<string,View>={};
try {
  const stored:unknown=JSON.parse(sessionStorage.getItem(key)||'{}');
  if(stored&&typeof stored==='object'&&!Array.isArray(stored))
    views=Object.fromEntries(Object.entries(stored).filter((entry):entry is [string,View]=>entry[1]==='home'||entry[1]==='bookmarks'));
} catch { /* In-memory navigation remains usable. */ }
const isStart=(tab:TabSession)=>['acira://home','acira://new'].includes(tab.url);
const read=(id:string):View=>views[id]==='bookmarks'?'bookmarks':'home';
const subscribe=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};};
function setView(id:string,view:View){
  views={...views,[id]:view};
  try{sessionStorage.setItem(key,JSON.stringify(views));}catch{/* Storage is optional. */}
  listeners.forEach(listener=>listener());
}
export function useWorkspaceView(tabId:string){return useSyncExternalStore(subscribe,()=>read(tabId));}

/** Navigation stays with a tab; a fresh tab never inherits another tab's library. */
export async function selectWorkspaceView(view:View,state:BrowserSnapshot,dispatch:(action:BrowserAction)=>void){
  const current=state.tabs.find(tab=>tab.id===state.activeTabId);
  const profileId=current?.browserProfileId||state.activeBrowserProfileId;
  const target=current&&isStart(current)?current:state.tabs.find(tab=>isStart(tab)&&tab.browserProfileId===profileId&&read(tab.id)===view);
  if(target){setView(target.id,view);if(target.id!==state.activeTabId)dispatch({type:'tab.select',id:target.id});return;}
  await runtime.dispatch({type:'tab.new',url:'acira://new',browserProfileId:profileId});
  const next=await runtime.getSnapshot();
  const created=next.tabs.find(tab=>tab.id===next.activeTabId);
  if(created&&isStart(created)&&!state.tabs.some(tab=>tab.id===created.id))setView(created.id,view);
}

/** Reuse an existing tool tab without replacing the user's website or task. */
export function openWorkspacePage(page:string,state:BrowserSnapshot,dispatch:(action:BrowserAction)=>void){
  const current=state.tabs.find(tab=>tab.id===state.activeTabId);
  const profileId=current?.browserProfileId||state.activeBrowserProfileId;
  const url=`acira://${page}`;
  const existing=state.tabs.find(tab=>tab.url===url&&tab.browserProfileId===profileId);
  // An empty new tab simply becomes the page; any other page stays as it was, and the new tab opens beside it (Back on it returns there, appPages.ts).
  if(existing)dispatch({type:'tab.select',id:existing.id});
  else if(current&&isStart(current)&&!current.privacy&&current.browserProfileId===profileId)dispatch({type:'tab.navigate',url,tabId:current.id});
  else dispatch({type:'tab.new',url,browserProfileId:profileId,...(current?{afterId:current.id}:{})});
}
