import {isTorSupported} from './platform';
import {useSyncExternalStore} from 'react';
import {t} from '../i18n';
/** R3-43: the three-dots menu is the person's to arrange. Each profile keeps its own layout (reorder, move between the main
 * menu and More tools, hide, reset), stored like the toolbar buttons so the popup renderer and Settings stay in step.
 * "More tools" and "Settings" are fixed at the foot of the main menu: Settings is the recovery route, and More tools is
 * where the person's moved rows live (it hides itself while empty). */
export type MenuItemId='newTab'|'newPrivateTab'|'newTorTab'|'newWindow'|'newPrivateWindow'|'newTorWindow'|'find'|'zoom'|'split'|'protection'|'aiFree'|'bookmarks'|'history'|'recentlyClosed'|'rewind'|'downloads'|'allTabs'|'commands'|'print'|'savePage'|'copyAddress'|'devtools'|'clearData'|'focus'|'seamless'|'extensions'|'vpn';
export type MenuList='main'|'more';
export interface MenuLayout{main:MenuItemId[];more:MenuItemId[];hidden:MenuItemId[]}

/** Rows of the same group sit together; a hairline is drawn wherever the group changes. */
export const menuItemGroups:Record<MenuItemId,string>={
 newTab:'tabs',newPrivateTab:'tabs',newTorTab:'tabs',
 newWindow:'windows',newPrivateWindow:'windows',newTorWindow:'windows',
 find:'page',zoom:'page',split:'page',protection:'page',aiFree:'page',
 bookmarks:'library',history:'library',recentlyClosed:'library',rewind:'library',downloads:'library',
 allTabs:'find',commands:'find',
 print:'tools',savePage:'tools',copyAddress:'tools',devtools:'tools',clearData:'tools',
 focus:'view',seamless:'view',extensions:'view',vpn:'view',
};
export const defaultMenuLayout:MenuLayout=Object.freeze({
 main:['newTab','newPrivateTab','newTorTab','newWindow','newPrivateWindow','newTorWindow','find','zoom','split','protection','aiFree','bookmarks','history','recentlyClosed','rewind','downloads'],
 more:['allTabs','commands','print','savePage','copyAddress','devtools','clearData','focus','seamless','extensions','vpn'],
 hidden:[],
}) as MenuLayout;
const everyItem=[...defaultMenuLayout.main,...defaultMenuLayout.more] as MenuItemId[];
const known=new Set<string>(everyItem);
/** The menu's own label for each row (the customizer lists them by these). */
export const menuItemLabel=(id:MenuItemId):string=>({
 newTab:()=>t('browsermenu.newTab'),newPrivateTab:()=>t('browsermenu.newPrivateTab'),newTorTab:()=>t('browsermenu.newTorTab'),
 newWindow:()=>t('browsermenu.newWindow'),newPrivateWindow:()=>t('browsermenu.newPrivateWindow'),newTorWindow:()=>t('browsermenu.newTorWindow'),
 find:()=>t('browsermenu.findInPage'),zoom:()=>t('app.zoom'),split:()=>t('browsermenu.splitView'),protection:()=>t('protection.title'),aiFree:()=>t('browsermenu.aiFreeMode'),
 bookmarks:()=>t('browsermenu.bookmarks'),history:()=>t('browsermenu.history'),recentlyClosed:()=>t('rewind.recentlyClosed'),rewind:()=>t('browsermenu.rewind'),downloads:()=>t('browsermenu.downloads'),
 allTabs:()=>t('browsermenu.allOpenTabs'),commands:()=>t('browsermenu.searchAndCommands'),print:()=>t('browsermenu.print'),savePage:()=>t('browsermenu.savePageAs'),copyAddress:()=>t('browsermenu.copyPageAddress'),
 devtools:()=>t('browsermenu.developerTools'),clearData:()=>t('browsermenu.clearBrowsingData'),focus:()=>t('browsermenu.focusMode'),seamless:()=>t('browsermenu.seamless'),extensions:()=>t('browsermenu.extensions'),vpn:()=>t('vpn.control.title'),
}[id])();

/** Rows a saved layout may still name by an older id: "Reopen closed tab" became "Recently closed" (Rewind's quick list,
 * which opens a popup and keeps Ctrl+Shift+T as its hint), so a layout that moved, hid or kept it keeps that choice. */
const legacyIds:Readonly<Record<string,MenuItemId>>=Object.freeze({reopen:'recentlyClosed'});
const currentId=(id:unknown)=>typeof id==='string'&&Object.prototype.hasOwnProperty.call(legacyIds,id)?legacyIds[id]:id;
/** Unknown ids are dropped, an id in two lists keeps its first place, and rows added in a later version join the list they
 * default to, after their nearest predecessor. Ids renamed in a later version are migrated (legacyIds). */
export function normalizeMenuLayout(input:unknown):MenuLayout{
 const seen=new Set<string>(),pick=(value:unknown):MenuItemId[]=>Array.isArray(value)?value.map(currentId).filter((id):id is MenuItemId=>typeof id==='string'&&known.has(id)&&!seen.has(id)&&(seen.add(id),true)):[];
 const raw=(input&&typeof input==='object'?input:{}) as Partial<Record<keyof MenuLayout,unknown>>;
 const main=pick(raw.main),more=pick(raw.more),hidden=pick(raw.hidden);
 const lists:Record<MenuList,MenuItemId[]>={main,more};
 for(const list of ['main','more'] as const)defaultMenuLayout[list].forEach((id,index)=>{
  if(seen.has(id))return;seen.add(id);
  const previous=defaultMenuLayout[list].slice(0,index).reverse().find(other=>lists[list].includes(other)),at=previous?lists[list].indexOf(previous)+1:0;
  lists[list].splice(at,0,id);
 });
 return {main,more,hidden};
}
export const menuListOf=(layout:MenuLayout,id:MenuItemId):MenuList|'hidden'=>layout.main.includes(id)?'main':layout.more.includes(id)?'more':'hidden';
const without=(layout:MenuLayout,id:MenuItemId):MenuLayout=>({main:layout.main.filter(item=>item!==id),more:layout.more.filter(item=>item!==id),hidden:layout.hidden.filter(item=>item!==id)});
export function moveMenuItem(layout:MenuLayout,id:MenuItemId,delta:number):MenuLayout{
 const list=menuListOf(layout,id);if(list==='hidden')return layout;
 const items=[...layout[list]],from=items.indexOf(id),to=Math.max(0,Math.min(items.length-1,from+delta));
 if(from===to)return layout;items.splice(from,1);items.splice(to,0,id);return {...layout,[list]:items};
}
/** Reorders one list to the order a drag produced (the other lists are untouched). */
export const reorderMenuList=(layout:MenuLayout,list:MenuList,order:readonly MenuItemId[]):MenuLayout=>({...layout,[list]:order.filter(id=>layout[list].includes(id))});
/** Moves a row to the foot of the other list (More tools or the main menu). */
export function moveMenuItemToList(layout:MenuLayout,id:MenuItemId,list:MenuList):MenuLayout{
 if(menuListOf(layout,id)===list)return layout;
 const next=without(layout,id);
 // It lands beside the rows of its own group when the list has some, else at the end.
 const items=[...next[list]],at=items.reduce((last,item,index)=>menuItemGroups[item]===menuItemGroups[id]?index+1:last,-1);
 items.splice(at<0?items.length:at,0,id);return {...next,[list]:items};
}
export function setMenuItemHidden(layout:MenuLayout,id:MenuItemId,hidden:boolean):MenuLayout{
 const where=menuListOf(layout,id);if(hidden===(where==='hidden'))return layout;
 if(hidden)return {...without(layout,id),hidden:[...layout.hidden,id]};
 const home=defaultMenuLayout.main.includes(id)?'main':'more';return moveMenuItemToList(without(layout,id),id,home);
}
export const isDefaultMenuLayout=(layout:MenuLayout)=>JSON.stringify(layout)===JSON.stringify(defaultMenuLayout);

/** What a list draws, in order: its rows with a hairline wherever the group changes. */
export function menuSections(ids:readonly MenuItemId[]):MenuItemId[][]{
 const sections:MenuItemId[][]=[];
 for(const id of ids){const last=sections.at(-1);if(last&&menuItemGroups[last[0]]===menuItemGroups[id])last.push(id);else sections.push([id]);}
 return sections;
}
/** Height of the popup's rows (30px rows, 9px hairlines, 12px of padding), from the count alone, so the first frame opens at
 * its final size. "More tools" and "Settings" are the main menu's two fixed rows; the default composition is the measured
 * 588px (menu) and 330px (More tools). */
export const menuRowHeight=30,menuSeparatorHeight=9,menuPaddingHeight=12;
export function menuHeight(layout:MenuLayout,list:MenuList,rowHeight=menuRowHeight):number{
 const ids=layout[list],fixed=list==='main'?(layout.more.length?2:1):0,rows=ids.length+fixed,sections=menuSections(ids).length;
 const separators=Math.max(0,sections-1)+(list==='main'&&ids.length?1:0);
 return menuPaddingHeight+rows*rowHeight+separators*menuSeparatorHeight;
}

const KEY='acira-menu-layout',EVENT='acira-menu-layout',memory=new Map<string,MenuLayout>(),cached=new Map<string,{raw:string;value:MenuLayout}>();
function read(profile=''):MenuLayout{
 if(memory.has(profile))return memory.get(profile)!;
 let raw='';try{raw=localStorage.getItem(KEY+':'+profile)||'';}catch{}
 const previous=cached.get(profile);if(previous&&previous.raw===raw)return previous.value;
 let value=normalizeMenuLayout(undefined);try{if(raw)value=normalizeMenuLayout(JSON.parse(raw));}catch{}
 cached.set(profile,{raw,value});return value;
}
export const readMenuLayout=read;
export function setMenuLayout(layout:MenuLayout,profile=''){
 const next=normalizeMenuLayout(layout);
 try{const raw=JSON.stringify(next);localStorage.setItem(KEY+':'+profile,raw);cached.set(profile,{raw,value:next});}catch{memory.set(profile,next);}
 window.dispatchEvent(new Event(EVENT));
}
export function resetMenuLayout(profile=''){
 memory.delete(profile);cached.delete(profile);
 try{localStorage.removeItem(KEY+':'+profile);}catch{}
 window.dispatchEvent(new Event(EVENT));
}
function subscribe(listener:()=>void){window.addEventListener(EVENT,listener);window.addEventListener('storage',listener);return()=>{window.removeEventListener(EVENT,listener);window.removeEventListener('storage',listener);};}
export function useMenuLayout(profile=''){return useSyncExternalStore(subscribe,()=>read(profile));}

/** Existing platform support: unavailable Tor actions never draw or count in Mac/Linux menus. */
export function platformMenuLayout(layout:MenuLayout):MenuLayout{if(isTorSupported())return layout;const supported=(id:MenuItemId)=>id!=='newTorTab'&&id!=='newTorWindow';return {main:layout.main.filter(supported),more:layout.more.filter(supported),hidden:layout.hidden.filter(supported)};}
