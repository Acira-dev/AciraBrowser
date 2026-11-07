import { readRailPrefs,setRailPrefs,type RailPrefs } from './railPrefs';
import { setSidebarAppsHidden } from './sidebarApps';
import type { BrowserAction,BrowserSnapshot } from '../runtime/types';
import { t,translateText } from '../i18n';

/** The sidebar's sections (Round 2: customisable). Favorites stays at the top and pinned tabs stay with the tabs; the
 * rest can be reordered, and every section can be hidden. Kept per profile with the other sidebar choices (railPrefs),
 * and shared with Settings › Sidebar (C). */
export type SectionId='favorites'|'pinned'|'tabs'|'bookmarks'|'downloads'|'history'|'reading';
export const SECTION_NAMES:Record<SectionId,string>={favorites:'Favorites',pinned:'Pinned tabs',tabs:'Tabs',bookmarks:'Bookmarks',downloads:'Downloads',history:'History',reading:'Reading list'};
/** The order people can change, as it starts. */
export const MOVABLE_SECTIONS:SectionId[]=['tabs','bookmarks','downloads','history','reading'];
/** Shown at first; Downloads, History and the Reading list are there to turn on. */
const STARTS_HIDDEN:SectionId[]=['downloads','history','reading'];
const ALL:SectionId[]=['favorites','pinned',...MOVABLE_SECTIONS];
export type SectionLayout={order:SectionId[];hidden:SectionId[]};

export function sectionLayout(prefs:Pick<RailPrefs,'sections'>):SectionLayout{
 const saved=prefs.sections;
 const order=[...new Set((saved?.order??[]).filter((id):id is SectionId=>MOVABLE_SECTIONS.includes(id as SectionId)))];
 for(const id of MOVABLE_SECTIONS)if(!order.includes(id))order.push(id);
 const hidden=saved?[...new Set(saved.hidden.filter((id):id is SectionId=>ALL.includes(id as SectionId)))]:[...STARTS_HIDDEN];
 return {order,hidden};
}
export const sectionShown=(layout:SectionLayout,id:SectionId)=>!layout.hidden.includes(id);

/** Moves a section to `index` among the movable ones (clamped); a fixed or unknown id changes nothing. */
export function moveSection(layout:SectionLayout,id:SectionId,index:number):SectionLayout{
 const from=layout.order.indexOf(id);if(from<0)return layout;
 const order=layout.order.filter(item=>item!==id),to=Math.max(0,Math.min(order.length,Math.round(index)));
 order.splice(to,0,id);
 return order.every((item,at)=>item===layout.order[at])?layout:{...layout,order};
}
export const toggleSection=(layout:SectionLayout,id:SectionId):SectionLayout=>({...layout,hidden:layout.hidden.includes(id)?layout.hidden.filter(item=>item!==id):[...layout.hidden,id]});
export const saveSections=(layout:SectionLayout,profile='',privateMode=false)=>setRailPrefs({sections:{order:layout.order,hidden:layout.hidden}},profile,privateMode);

/** "Hide this section" (a section's right-click menu): the layout with `id` hidden. Hiding one that is hidden changes nothing. */
export const hideSection=(layout:SectionLayout,id:SectionId):SectionLayout=>layout.hidden.includes(id)?layout:{...layout,hidden:[...layout.hidden,id]};

/** The toast after Hide this section: names the section and offers Undo. The undo entry is kept in browser storage (as a removed
 * Favorite's is), so Undo works from whichever view shows the toast; a private window keeps its choices in memory only, so it gets the
 * toast without Undo (Customize sidebar brings the section back). */
const UNDO_KEY='acira-sidebar-section-undo',UNDO_MS=10*60_000;
type HiddenEntry={token:string;profile:string;section:SectionId;at:number};
const hiddenEntries=():HiddenEntry[]=>{try{const value:unknown=JSON.parse(localStorage.getItem(UNDO_KEY)||'[]');return Array.isArray(value)?value.filter((item):item is HiddenEntry=>!!item&&typeof item.token==='string'&&typeof item.profile==='string'&&ALL.includes(item.section)&&typeof item.at==='number'&&Date.now()-item.at<UNDO_MS):[];}catch{return [];}};
export function sectionHiddenToast(profile:string,privateMode:boolean,section:SectionId):BrowserAction{
 let token:string|undefined='s'+Date.now().toString(36)+Math.random().toString(36).slice(2,8);
 if(privateMode)token=undefined;else try{localStorage.setItem(UNDO_KEY,JSON.stringify([...hiddenEntries().slice(-7),{token,profile,section,at:Date.now()}]));}catch{token=undefined;}
 return {type:'toast',text:t("sidebarmenu.sectionHidden",{section:translateText(SECTION_NAMES[section])}),...(token?{action:{label:t("toast.undo"),command:{type:'sidebar.section.restore',token}}}:{})};
}
/** Undo: the section is shown again. False when the entry is gone (used, or older than ten minutes). */
export function restoreHiddenSection(token:string):boolean{
 const list=hiddenEntries(),entry=list.find(item=>item.token===token);if(!entry)return false;
 try{localStorage.setItem(UNDO_KEY,JSON.stringify(list.filter(item=>item!==entry)));}catch{/* the entry expires on its own */}
 if(entry.section==='favorites')setSidebarAppsHidden(entry.profile,false,false);// Favorites keeps its one switch in the Favorites store
 else{const layout=sectionLayout(readRailPrefs(entry.profile,false));saveSections({...layout,hidden:layout.hidden.filter(id=>id!==entry.section)},entry.profile,false);}
 return true;
}

/** Settings › Tabs › Sidebar opens Customize sidebar with this event (same window). */
export const CUSTOMIZE_SIDEBAR_EVENT='acira-customize-sidebar';
export const openSidebarCustomize=()=>window.dispatchEvent(new Event(CUSTOMIZE_SIDEBAR_EVENT));

/** What a sidebar right-click menu asks of the sidebar: hide this section, or open Customize sidebar. The menus live in the popup
 * renderer and the sidebar in the window's own, so the request travels through storage (as the Edit favorite target does), keyed
 * by the window: only that window's sidebar acts on it, with its own stores (a private window keeps its choices in memory). */
export type SidebarRequest={kind:'customize'}|{kind:'hide';section:SectionId};
const REQUEST_KEY='acira-sidebar-request:',REQUEST_EVENT='acira-sidebar-request';
const REQUEST_FRESH_MS=5000;
export function requestSidebar(windowId:string|undefined,request:SidebarRequest){
 window.dispatchEvent(new CustomEvent<SidebarRequest>(REQUEST_EVENT,{detail:request}));// a menu drawn in the sidebar's own renderer (the page preview)
 if(!windowId)return;
 try{localStorage.setItem(REQUEST_KEY+windowId,JSON.stringify({...request,at:Date.now()}));}catch{/* the in-window event above still works */}
}
/** The request a storage value holds, when it is a fresh, well-formed one. */
export function parseSidebarRequest(raw:string|null,now=Date.now()):SidebarRequest|null{
 try{
  const value:unknown=JSON.parse(raw||'null');if(!value||typeof value!=='object')return null;
  const {kind,section,at}=value as Record<string,unknown>;
  if(typeof at!=='number'||now-at>REQUEST_FRESH_MS||at>now+1000)return null;
  if(kind==='customize')return {kind};
  if(kind==='hide'&&typeof section==='string'&&ALL.includes(section as SectionId))return {kind,section:section as SectionId};
 }catch{/* not a request */}
 return null;
}
/** The window a menu belongs to: the snapshot's, or the one this renderer was opened for (a popup's own snapshot may not carry it). */
export const sidebarWindowId=(state:Pick<BrowserSnapshot,'windowId'>):string|undefined=>state.windowId||(typeof window==='undefined'?undefined:window.acira?.initialSnapshot?.windowId);
/** The sidebar of window `windowId` listens here for requests from its menus. */
export function onSidebarRequest(windowId:string|undefined,listener:(request:SidebarRequest)=>void):()=>void{
 const key=REQUEST_KEY+(windowId??''),seen=new Set<string>();
 const heard=(event:StorageEvent)=>{
  if(!windowId||event.key!==key||!event.newValue||seen.has(event.newValue))return;
  seen.add(event.newValue);const request=parseSidebarRequest(event.newValue);if(request)listener(request);
 };
 const local=(event:Event)=>listener((event as CustomEvent<SidebarRequest>).detail);
 window.addEventListener('storage',heard);window.addEventListener(REQUEST_EVENT,local);
 return()=>{window.removeEventListener('storage',heard);window.removeEventListener(REQUEST_EVENT,local);};
}
