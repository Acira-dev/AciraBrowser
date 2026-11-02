import {useSyncExternalStore} from 'react';
import type {BrowserAction} from '../runtime/types';
import {favoriteTabOf} from '../runtime/favoriteTabs';
import { t } from '../i18n';
/** Profile-scoped sidebar apps (pinned sites above the tab list). Private windows keep them in memory only. */
export type SidebarApp={id:string;url:string;title:string;icon?:string};
export type SidebarApps={apps:SidebarApp[];hidden:boolean;seeded:boolean};
export const SIDEBAR_APPS_MAX=24;
const KEY='acira-sidebar-apps',EVENT='acira-sidebar-apps',memory=new Map<string,SidebarApps>(),cached=new Map<string,{raw:string|null;value:SidebarApps}>();
const EMPTY:SidebarApps={apps:[],hidden:false,seeded:false};
const scope=(profile:string,privateMode:boolean)=>(privateMode?'private:':'normal:')+profile;

/** Accepts `example.com`, `https://…` and internal `acira://` pages; anything else is refused. */
export function normalizeAppUrl(input:string):string|null{
 const value=input.trim();if(!value||value.length>2048)return null;
 const withScheme=/^[a-z][a-z0-9+.-]*:/i.test(value)?value:'https://'+value;
 try{const url=new URL(withScheme);if(url.protocol==='acira:')return url.href;if(!/^https?:$/.test(url.protocol)||!url.hostname||url.username||url.password)return null;return url.href;}catch{return null;}
}
/** A link dragged in from a web page (text/uri-list, with text/html and text/plain alongside): its first web address
 * and the anchor's own text as the title. Comments and non-web schemes are ignored. Pure. */
export function droppedLink(uriList:string,html='',plain=''):{url:string;title?:string}|null{
 const first=(uriList||'').split(/\r?\n/).map(line=>line.trim()).find(line=>line&&!line.startsWith('#'))||plain.trim();
 const url=first&&/^https?:\/\//i.test(first)?normalizeAppUrl(first):null;if(!url)return null;
 const anchor=/<a\b[^>]*>([\s\S]*?)<\/a>/i.exec(html||'');
 const text=(anchor?anchor[1]:'').replace(/<[^>]*>/g,'').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/\s+/g,' ').trim();
 const title=text&&!/^https?:\/\//i.test(text)?text.slice(0,80):undefined;
 return title?{url,title}:{url};
}
export const appHost=(url:string)=>{try{return new URL(url).hostname.replace(/^www\./,'');}catch{return '';}};
/** Only already-local images are kept: data URLs from the tab, never a remote address to fetch later. */
const localIcon=(icon:unknown)=>typeof icon==='string'&&/^data:image\/(png|x-icon|vnd\.microsoft\.icon|svg\+xml|jpeg|webp|gif);base64,/i.test(icon)&&icon.length<=96*1024?icon:undefined;
function clean(raw:unknown):SidebarApps{
 if(!raw||typeof raw!=='object')return EMPTY;const value=raw as Record<string,unknown>,ids=new Set<string>(),apps:SidebarApp[]=[];
 for(const item of Array.isArray(value.apps)?value.apps:[]){if(apps.length>=SIDEBAR_APPS_MAX||!item||typeof item!=='object')continue;const app=item as Record<string,unknown>,url=typeof app.url==='string'?normalizeAppUrl(app.url):null,id=typeof app.id==='string'?app.id:'';if(!url||!id||ids.has(id))continue;ids.add(id);apps.push({id,url,title:(typeof app.title==='string'&&app.title.trim()?app.title.trim():appHost(url)||url).slice(0,80),icon:localIcon(app.icon)});}
 return {apps,hidden:value.hidden===true,seeded:value.seeded===true};
}
function read(profile='',privateMode=false):SidebarApps{
 const id=scope(profile,privateMode);if(memory.has(id))return memory.get(id)!;
 let raw:string|null=null;try{if(!privateMode)raw=localStorage.getItem(KEY+':'+profile);}catch{}
 const previous=cached.get(id);if(previous&&previous.raw===raw)return previous.value;
 let value=EMPTY;try{if(raw)value=clean(JSON.parse(raw));}catch{}
 cached.set(id,{raw,value});return value;
}
function write(next:SidebarApps,profile='',privateMode=false){
 const id=scope(profile,privateMode);
 if(privateMode)memory.set(id,next);else try{const raw=JSON.stringify(next);localStorage.setItem(KEY+':'+profile,raw);cached.set(id,{raw,value:next});}catch{memory.set(id,next);}
 window.dispatchEvent(new Event(EVENT));
}
const update=(profile:string,privateMode:boolean,change:(value:SidebarApps)=>SidebarApps)=>write(change(read(profile,privateMode)),profile,privateMode);
const newId=()=>'app-'+Date.now().toString(36)+Math.random().toString(36).slice(2,7);

export function addSidebarApp(profile:string,privateMode:boolean,input:{url:string;title?:string;icon?:string}):SidebarApp|string{
 const url=normalizeAppUrl(input.url);if(!url)return 'Enter a web address, like example.com.';
 const current=read(profile,privateMode);if(current.apps.length>=SIDEBAR_APPS_MAX)return `Up to ${SIDEBAR_APPS_MAX} favorites.`;
 const app:SidebarApp={id:newId(),url,title:(input.title?.trim()||appHost(url)||url).slice(0,80),icon:localIcon(input.icon)};
 write({...current,apps:[...current.apps,app],seeded:true},profile,privateMode);return app;
}
export function updateSidebarApp(profile:string,privateMode:boolean,id:string,patch:{url?:string;title?:string;icon?:string|null}):string|null{
 const url=patch.url===undefined?undefined:normalizeAppUrl(patch.url);if(url===null)return 'Enter a web address, like example.com.';
 update(profile,privateMode,value=>({...value,apps:value.apps.map(app=>app.id!==id?app:{...app,...(url?{url}:{}),...(patch.title!==undefined?{title:(patch.title.trim()||appHost(url||app.url)).slice(0,80)}:{}),...(patch.icon!==undefined?{icon:localIcon(patch.icon)}:{}),...(url&&appHost(url)!==appHost(app.url)&&patch.icon===undefined?{icon:undefined}:{})})}));
 return null;
}
export const removeSidebarApp=(profile:string,privateMode:boolean,id:string)=>update(profile,privateMode,value=>({...value,apps:value.apps.filter(app=>app.id!==id)}));
/** Remove with the shared Undo toast (A: a destructive action gets Undo, not a confirm). The removed favorite waits under a
 * token in this origin's storage, so the toast's Undo puts it back from whichever renderer shows the toast. A private
 * window's favorites never reach storage, so they go without Undo. Returns the toast to dispatch. */
const UNDO_KEY='acira-sidebar-apps-undo',UNDO_MS=10*60_000;
type RemovedApp={token:string;profile:string;app:SidebarApp;index:number;at:number;/** Tabs the favorite owned, handed back to the tab list when it went (noteReleasedTab). */tabIds?:string[]};
const removedApps=():RemovedApp[]=>{try{const value:unknown=JSON.parse(localStorage.getItem(UNDO_KEY)||'[]');return Array.isArray(value)?value.filter((item:RemovedApp)=>!!item&&typeof item.token==='string'&&typeof item.profile==='string'&&!!item.app&&Date.now()-item.at<UNDO_MS):[];}catch{return [];}};
export function removeSidebarAppWithUndo(profile:string,privateMode:boolean,id:string):BrowserAction|null{
 const current=read(profile,privateMode),index=current.apps.findIndex(app=>app.id===id),app=current.apps[index];if(!app)return null;
 let token:string|undefined='f'+Date.now().toString(36)+Math.random().toString(36).slice(2,8);
 if(privateMode)token=undefined;else try{localStorage.setItem(UNDO_KEY,JSON.stringify([...removedApps().slice(-7),{token,profile,app,index,at:Date.now()}]));}catch{token=undefined;}
 removeSidebarApp(profile,privateMode,id);
 return {type:'toast',text:`${app.title||appHost(app.url)} removed from Favorites`,...(token?{action:{label:t("toast.undo"),command:{type:'favorite.restore',token}}}:{})};
}
export function restoreSidebarApp(token:string,restored?:(appId:string,tabIds:string[])=>void):boolean{
 const list=removedApps(),entry=list.find(item=>item.token===token);if(!entry)return false;
 try{localStorage.setItem(UNDO_KEY,JSON.stringify(list.filter(item=>item!==entry)));}catch{/* the entry expires on its own */}
 let back=false;update(entry.profile,false,value=>{if(value.apps.some(app=>app.id===entry.app.id||app.url===entry.app.url)||value.apps.length>=SIDEBAR_APPS_MAX)return value;back=true;return {...value,apps:[...value.apps.slice(0,entry.index),entry.app,...value.apps.slice(entry.index)]};});
 if(back)restored?.(entry.app.id,entry.tabIds??[]);
 return true;
}
/** A removed favorite's tab handed back to the tab list (AciraSidebar) is noted on the removal's Undo entry, so Undo, from
 * whichever view shows the toast, makes it the favorite's own tab again. */
export function noteReleasedTab(appId:string,tabId:string){
 try{const list=removedApps(),entry=list.filter(item=>item.app.id===appId).at(-1);if(!entry||entry.tabIds?.includes(tabId))return;entry.tabIds=[...(entry.tabIds??[]),tabId].slice(-8);localStorage.setItem(UNDO_KEY,JSON.stringify(list));}catch{/* Undo brings the favorite back without its tab */}
}
export function moveSidebarApp(profile:string,privateMode:boolean,id:string,index:number){
 update(profile,privateMode,value=>{const from=value.apps.findIndex(app=>app.id===id);if(from<0)return value;const apps=[...value.apps],[app]=apps.splice(from,1);apps.splice(Math.max(0,Math.min(apps.length,index)),0,app);return {...value,apps};});
}
export const setSidebarAppsHidden=(profile:string,privateMode:boolean,hidden:boolean)=>update(profile,privateMode,value=>({...value,hidden}));
/** One-time import of new-tab shortcuts that were already marked for the sidebar. */
export const seedSidebarApps=(profile:string,privateMode:boolean,seed:{url:string;title:string}[])=>update(profile,privateMode,value=>value.seeded?value:{...value,seeded:true,apps:[...value.apps,...seed.flatMap(item=>{const url=normalizeAppUrl(item.url);return url&&!value.apps.some(app=>app.url===url)?[{id:newId(),url,title:item.title.slice(0,80)||appHost(url)}]:[];})].slice(0,SIDEBAR_APPS_MAX)});
function subscribe(listener:()=>void){window.addEventListener(EVENT,listener);window.addEventListener('storage',listener);return()=>{window.removeEventListener(EVENT,listener);window.removeEventListener('storage',listener);};}
export const readSidebarApps=(profile='',privateMode=false)=>read(profile,privateMode);
export function useSidebarApps(profile='',privateMode=false){return useSyncExternalStore(subscribe,()=>read(profile,privateMode));}

/** What a click on a favorite tile does (reviewer, 2 Nov: "fav tabs aren't a tab … it's basically a bookmark"). A favorite owns
 * one tab (runtime/favoriteTabs.ts): a plain click opens it the first time, switches back to it after that (bringing it in from
 * another workspace, its page, scroll, sign-in and media as they were), and on the favorite's own tab, once you have browsed
 * away, takes it back to the favorite's address (Arc). On its own tab at that address a click does nothing: never a second copy.
 * Middle-click and Ctrl/Cmd+click still open an ordinary background tab at the address, and Shift+click a new window. Pure,
 * so the rule is tested without a window. This replaces R3-72 (a second click opened a fresh tab). */
export interface AppClick{button:number;ctrlKey?:boolean;metaKey?:boolean;shiftKey?:boolean}
export type AppClickPlan={kind:'none'}|{kind:'open'}|{kind:'select';tabId:string}|{kind:'home';tabId:string}|{kind:'new-tab'}|{kind:'new-window'};
export function appClickPlan<T extends {id:string;url:string;browserProfileId:string;favoriteId?:string}>(click:AppClick,app:SidebarApp,tabs:readonly T[],activeTabId:string,profile:string):AppClickPlan{
 if(click.button!==0&&click.button!==1)return {kind:'none'};
 if(click.button===1||click.ctrlKey||click.metaKey)return {kind:'new-tab'};
 if(click.shiftKey)return {kind:'new-window'};
 const tab=favoriteTabOf(tabs,app.id,profile);
 if(!tab)return {kind:'open'};
 if(tab.id!==activeTabId)return {kind:'select',tabId:tab.id};
 return tab.url!==app.url?{kind:'home',tabId:tab.id}:{kind:'none'};
}
/** Whether a tab shows in the sidebar's tab list: a favorite's own tab lives in its tile instead, unless Favorites are hidden
 * (then it is listed like any tab). A tab whose favorite was removed is listed until the sidebar hands it back (AciraSidebar). */
export const listedInSidebar=(tab:{favoriteId?:string},favorites:Pick<SidebarApps,'apps'|'hidden'>)=>!(tab.favoriteId&&!favorites.hidden&&favorites.apps.some(app=>app.id===tab.favoriteId));
/** The favorite's own tab in this window, if it is open: in the workspace on screen or another (`tabs` then holds both). */
export const appTabFor=<T extends {browserProfileId:string;favoriteId?:string}>(app:SidebarApp,tabs:readonly T[],profile:string):T|undefined=>favoriteTabOf(tabs,app.id,profile);
