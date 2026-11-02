import { setRailPrefs,type RailPrefs } from './railPrefs';

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

/** Settings › Sidebar (C) and the sidebar's own right-click open Customize sidebar with this event (same window). */
export const CUSTOMIZE_SIDEBAR_EVENT='acira-customize-sidebar';
export const openSidebarCustomize=()=>window.dispatchEvent(new Event(CUSTOMIZE_SIDEBAR_EVENT));
