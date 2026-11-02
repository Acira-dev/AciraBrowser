import type { BrowserSnapshot,TabSession,WindowUi } from './types';
import { normalizeSplit } from './splitLayout';
import { normalizeSplitGroups } from './splitGroups';import { isWindowView,type WindowView } from './windowView';

const object=(value:unknown):Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
const finite=(value:unknown,fallback:number)=>typeof value==='number'&&Number.isFinite(value)?value:fallback;
export const HISTORY_LIMIT=5000;
export const defaultWindowUi=():WindowUi=>({focusMode:false,workspaceOpen:false,webWorkspaceOpen:false,split:null});

/** The active split follows the selected pane; saved split groups remain available when it is not on screen. */
export function windowUiState(input:unknown,tabs:readonly Pick<TabSession,'id'>[],activeId:string):WindowUi {
 const raw=object(input),split=object(raw.split),ids=Array.isArray(split.tabIds)?split.tabIds:[];
 // The window's own Window view; a session saved before the dial existed only has the Focus flag. An explicit `view: null` clears it.
 const own:WindowView|null=Object.hasOwn(raw,'view')?isWindowView(raw.view)?raw.view:null:raw.focusMode===true?'focus':null;
 // A closed member leaves its pane, not the whole split: the rest re-tile in the default layout for their count.
 const open=ids.filter(id=>typeof id==='string'&&tabs.some(tab=>tab.id===id)),kept=open.length<ids.length?{tabIds:open,groupId:split.groupId}:raw.split,groups=normalizeSplitGroups(raw.splitGroups,tabs);
 return {...(typeof raw.zoomTargetTabId==='string'&&tabs.some(tab=>tab.id===raw.zoomTargetTabId)?{zoomTargetTabId:raw.zoomTargetTabId}:{}),focusMode:own==='focus',...(own?{view:own}:{}),workspaceOpen:raw.workspaceOpen===true,webWorkspaceOpen:raw.webWorkspaceOpen===true,
  split:normalizeSplit(kept,tabs.map(tab=>tab.id),activeId),...(groups.length?{splitGroups:groups}:{}),...lastTabsOf(raw.lastTabs,tabs)};
}
/** The tab each workspace showed last: only real tabs survive (runtime/workspaces.ts settles the rest). */
function lastTabsOf(value:unknown,tabs:readonly Pick<TabSession,'id'>[]):{lastTabs?:Record<string,string>}{
 const entries=Object.entries(object(value)).filter((entry):entry is [string,string]=>typeof entry[1]==='string'&&tabs.some(tab=>tab.id===entry[1])).slice(0,16);
 return entries.length?{lastTabs:Object.fromEntries(entries)}:{};
}

export function webOrigin(url:string):string|null {
 try{const parsed=new URL(url);return parsed.protocol==='http:'||parsed.protocol==='https:'?parsed.origin:null;}catch{return null;}
}

/** What a zoom level is remembered for: a website's origin, or an Acira page's own address (acira://settings), as Chrome keeps a level per
 * host for its chrome:// pages. A level is per page, not per tab: every tab on that page, in any window of the profile, shares it. */
export function zoomOrigin(url:string):string|null {
 return webOrigin(url)??(/^acira:\/\/[a-z][a-z0-9-]{0,31}$/.test(url)?url:null);
}

export function normalizeOriginZooms(input:unknown,profiles:readonly {id:string}[]):BrowserSnapshot['originZooms'] {
 const result:BrowserSnapshot['originZooms']={},raw=object(input);
 for(const profile of profiles){
  const values=object(raw[profile.id]),clean:Record<string,number>={};
  for(const [url,zoom] of Object.entries(values)){const origin=zoomOrigin(url);if(origin&&typeof zoom==='number'&&Number.isFinite(zoom))clean[origin]=Math.max(25,Math.min(500,zoom));}
  if(Object.keys(clean).length)result[profile.id]=clean;
 }
 return result;
}

export function originZoom(state:Pick<BrowserSnapshot,'originZooms'>,tab:Pick<TabSession,'url'|'browserProfileId'|'privacy'|'zoom'>):number {
 if(tab.privacy)return tab.zoom;
 const origin=zoomOrigin(tab.url);return origin?state.originZooms[tab.browserProfileId]?.[origin]??100:100;
}

/** Ordinary tabs share per-origin zoom; private tabs keep their own unsaved zoom. */
export function setOriginZoom(state:BrowserSnapshot,tab:TabSession,value:number):void {
 const zoom=Math.max(25,Math.min(500,Number.isFinite(value)?value:tab.zoom)),origin=zoomOrigin(tab.url);
 // A private tab keeps its zoom to itself: the per-site table is saved, and would record which sites it visited.
 if(origin&&!tab.privacy){
  const map=state.originZooms[tab.browserProfileId]??(state.originZooms[tab.browserProfileId]={});map[origin]=zoom;
  for(const member of state.tabs)if(!member.privacy&&member.browserProfileId===tab.browserProfileId&&zoomOrigin(member.url)===origin)member.zoom=zoom;
 }else tab.zoom=zoom;
 const active=state.tabs.find(member=>member.id===state.activeTabId);if(active)state.settings.zoom=active.zoom;
}

export function shouldPersistSnapshot(previous:BrowserSnapshot,next:BrowserSnapshot):boolean{return previous!==next;}
