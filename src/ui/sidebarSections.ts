import { readRailPrefs,setRailPrefs,type RailPrefs } from './railPrefs';
import { setSidebarAppsHidden } from './sidebarApps';
import type { BrowserAction,BrowserSnapshot } from '../runtime/types';
import { t,translateText } from '../i18n';

/** The sidebar's sections (Round 2: customisable; Beta 14: Customize sidebar's blocks). Favorites sits on an edge of the sidebar (the top or the bottom) and the others can be reordered and turned off. Pinned tabs is a block of its own (it used to stand with the
 * tabs), and so are the pinned extensions' row and the side panel sites' icons. Kept per profile with the other sidebar choices (railPrefs), and shared with Settings › Sidebar (C); where the blocks that sit on the two edges stand is `edges`
 * (ui/customizeModel.ts arrangeOf says what is drawn where). */
export type SectionId='favorites'|'pinned'|'tabs'|'bookmarks'|'downloads'|'history'|'reading'|'extensions'|'sidepanel';
export const SECTION_NAMES:Record<SectionId,string>={favorites:'Favorites',pinned:'Pinned tabs',tabs:'Tabs',bookmarks:'Bookmarks',downloads:'Downloads',history:'History',reading:'Reading list',extensions:'Pinned extensions',sidepanel:'Side panel sites'};
/** The order people can change, as it starts (the sections that can stand in the list). */
export const MOVABLE_SECTIONS:SectionId[]=['pinned','tabs','bookmarks','downloads','history','reading','extensions','sidepanel'];
/** Shown at first; Downloads, History and the Reading list are there to turn on. */
const STARTS_HIDDEN:SectionId[]=['downloads','history','reading'];
const ALL:SectionId[]=['favorites',...MOVABLE_SECTIONS];
/** The blocks on the sidebar's two edges, in order (Favorites' own edge is the Favorites store's). Missing: the default places (customizeModel.ts). */
export type SectionEdges={top:string[];bottom:string[]};
export type SectionLayout={order:SectionId[];hidden:SectionId[];edges?:SectionEdges};

/** Beta 14, the Shelf (Top + sidebar): a sidebar with no tab list. It has its own hidden list (every library section starts shown: the shelf is nothing but them, so a shelf that opened with
 * Bookmarks alone would look empty), the order is shared with the other layouts, and Tabs and Pinned tabs are not sections of it. Hiding one in the shelf hides nothing in the other layouts. */
const SHELF_ONLY:SectionId[]=['tabs','pinned'];
/** The order a shelf starts in (the brief's: Bookmarks, Reading list, History, Downloads) until a person moves a section. */
const SHELF_DEFAULT_ORDER:SectionId[]=['bookmarks','reading','history','downloads','extensions','sidepanel'];
/** The two edges as saved: ids of blocks only, each at most once. */
const edgesOf=(saved:{edges?:{top:string[];bottom:string[]}}|undefined):SectionEdges|undefined=>{
 if(!saved?.edges)return undefined;const seen=new Set<string>(),clean=(list:string[])=>list.filter(id=>(id==='footer'||ALL.includes(id as SectionId))&&!seen.has(id)&&!!seen.add(id));
 const top=clean(saved.edges.top),bottom=clean(saved.edges.bottom);return {top,bottom};
};
export function sectionLayout(prefs:Pick<RailPrefs,'sections'>,shelf=false):SectionLayout{
 const saved=prefs.sections,edges=edgesOf(saved);
 const order=[...new Set((saved?.order??[]).filter((id):id is SectionId=>MOVABLE_SECTIONS.includes(id as SectionId)))];
 // a profile that saved its order before Pinned tabs was a block of its own: Pinned tabs stands before the Tabs list, as it always did
 if(saved&&!order.includes('pinned')){const tabs=order.indexOf('tabs');if(tabs>=0)order.splice(tabs,0,'pinned');}
 for(const id of MOVABLE_SECTIONS)if(!order.includes(id))order.push(id);
 if(shelf){
  const hidden=[...new Set((saved?.shelfHidden??[]).filter((id):id is SectionId=>ALL.includes(id as SectionId)&&!SHELF_ONLY.includes(id as SectionId)))];
  return {order:saved?.order?.length?order.filter(id=>!SHELF_ONLY.includes(id)):[...SHELF_DEFAULT_ORDER],hidden,...(edges?{edges}:{})};
 }
 // Where the tabs live in the sidebar, the Tabs section is their list: hiding it left no tab list anywhere on screen (found 12 Nov, Beta 14 the plan). It is never hidden there, whatever an older profile saved.
 const hidden=saved?[...new Set(saved.hidden.filter((id):id is SectionId=>ALL.includes(id as SectionId)&&!sectionLocked(id as SectionId)))]:[...STARTS_HIDDEN];
 return {order,hidden,...(edges?{edges}:{})};
}
/** Tabs cannot be hidden in the layouts that keep them in the sidebar (the Shelf has no Tabs section at all). Its switches are drawn on and disabled, and Hide this section is not offered for it. */
export const sectionLocked=(id:SectionId):boolean=>id==='tabs';
export const sectionShown=(layout:SectionLayout,id:SectionId)=>!layout.hidden.includes(id);

/** Moves a section to `index` among the movable ones (clamped); a fixed or unknown id changes nothing. */
export function moveSection(layout:SectionLayout,id:SectionId,index:number):SectionLayout{
 const from=layout.order.indexOf(id);if(from<0)return layout;
 const order=layout.order.filter(item=>item!==id),to=Math.max(0,Math.min(order.length,Math.round(index)));
 order.splice(to,0,id);
 return order.every((item,at)=>item===layout.order[at])?layout:{...layout,order};
}
export const toggleSection=(layout:SectionLayout,id:SectionId):SectionLayout=>sectionLocked(id)?layout:({...layout,hidden:layout.hidden.includes(id)?layout.hidden.filter(item=>item!==id):[...layout.hidden,id]});
export function saveSections(layout:SectionLayout,profile='',privateMode=false,shelf=false){
 const saved=readRailPrefs(profile,privateMode).sections,edges=layout.edges??saved?.edges;
 if(!shelf){setRailPrefs({sections:{order:layout.order,hidden:layout.hidden,...(edges?{edges}:{}),...(saved?.shelfHidden?{shelfHidden:saved.shelfHidden}:{})}},profile,privateMode);return;}
 // The shelf has no Tabs: the order the other layouts keep holds Tabs where it was, and the shelf's sections move around it.
 const queue=[...layout.order],order=sectionLayout({sections:saved}).order.map(id=>SHELF_ONLY.includes(id)?id:queue.shift()??id);
 setRailPrefs({sections:{order,hidden:saved?.hidden??[...STARTS_HIDDEN],shelfHidden:layout.hidden,...(edges?{edges}:{})}},profile,privateMode);
}

/** "Hide this section" (a section's right-click menu): the layout with `id` hidden. Hiding one that is hidden changes nothing. */
export const hideSection=(layout:SectionLayout,id:SectionId):SectionLayout=>layout.hidden.includes(id)||sectionLocked(id)?layout:{...layout,hidden:[...layout.hidden,id]};

/** The toast after Hide this section: names the section and offers Undo. The undo entry is kept in browser storage (as a removed
 * Favorite's is), so Undo works from whichever view shows the toast; a private window keeps its choices in memory only, so it gets the
 * toast without Undo (Customize sidebar brings the section back). */
const UNDO_KEY='acira-sidebar-section-undo',UNDO_MS=10*60_000;
type HiddenEntry={token:string;profile:string;section:SectionId;at:number;/** Hidden in the shelf (Top + sidebar), whose hidden list is its own. */shelf?:boolean};
const hiddenEntries=():HiddenEntry[]=>{try{const value:unknown=JSON.parse(localStorage.getItem(UNDO_KEY)||'[]');return Array.isArray(value)?value.filter((item):item is HiddenEntry=>!!item&&typeof item.token==='string'&&typeof item.profile==='string'&&ALL.includes(item.section)&&typeof item.at==='number'&&Date.now()-item.at<UNDO_MS):[];}catch{return [];}};
export function sectionHiddenToast(profile:string,privateMode:boolean,section:SectionId,shelf=false):BrowserAction{
 let token:string|undefined='s'+Date.now().toString(36)+Math.random().toString(36).slice(2,8);
 if(privateMode)token=undefined;else try{localStorage.setItem(UNDO_KEY,JSON.stringify([...hiddenEntries().slice(-7),{token,profile,section,at:Date.now(),...(shelf?{shelf}:{})}]));}catch{token=undefined;}
 return {type:'toast',text:t("sidebarmenu.sectionHidden",{section:translateText(SECTION_NAMES[section])}),...(token?{action:{label:t("toast.undo"),command:{type:'sidebar.section.restore',token}}}:{})};
}
/** Undo: the section is shown again. False when the entry is gone (used, or older than ten minutes). */
export function restoreHiddenSection(token:string):boolean{
 const list=hiddenEntries(),entry=list.find(item=>item.token===token);if(!entry)return false;
 try{localStorage.setItem(UNDO_KEY,JSON.stringify(list.filter(item=>item!==entry)));}catch{/* the entry expires on its own */}
 if(entry.section==='favorites')setSidebarAppsHidden(entry.profile,false,false);// Favorites keeps its one switch in the Favorites store
 else{const shelf=entry.shelf===true,layout=sectionLayout(readRailPrefs(entry.profile,false),shelf);saveSections({...layout,hidden:layout.hidden.filter(id=>id!==entry.section)},entry.profile,false,shelf);}
 return true;
}

/** Settings › Tabs › Sidebar opens Customize sidebar with this event (same window). */
export const CUSTOMIZE_SIDEBAR_EVENT='acira-customize-sidebar';
export const openSidebarCustomize=()=>window.dispatchEvent(new Event(CUSTOMIZE_SIDEBAR_EVENT));

/** What a sidebar right-click menu asks of the sidebar: hide this section, or open Customize sidebar. The menus live in the popup
 * renderer and the sidebar in the window's own, so the request travels through storage (as the Edit favorite target does), keyed
 * by the window: only that window's sidebar acts on it, with its own stores (a private window keeps its choices in memory). */
export type SidebarRequest={kind:'customize'}|{kind:'hide';section:SectionId}|{kind:'edit-favorite';appId:string};
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
  if(kind==='edit-favorite'&&typeof (value as Record<string,unknown>).appId==='string'&&/^[\w.-]{1,80}$/.test((value as Record<string,string>).appId))return {kind,appId:(value as Record<string,string>).appId};
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
