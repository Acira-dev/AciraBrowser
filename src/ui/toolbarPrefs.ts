import {useSyncExternalStore} from 'react';
import {t} from '../i18n';
/** Customizable toolbar actions, stored per local profile. Button order is not browsing data, so a private
 * profile keeps its own layout too; storage is shared with the popup renderer so both stay in step.
 * The Acira menu and pinned extension actions are fixed: the menu is the recovery route to Settings. */
export type ToolbarItemId='extensions'|'downloads'|'history'|'bookmarks'|'split'|'appearance'|'focus'|'profile'|'routines'|'aifree'|'vpn'|'protection';
export type ToolbarItem={id:ToolbarItemId;visible:boolean};
export const toolbarItemLabels:Record<ToolbarItemId,string>={extensions:'Extensions',downloads:'Downloads',history:'History',bookmarks:'All bookmarks',split:'Split view',appearance:'Appearance',focus:'Focus mode',profile:'Profiles',routines:'Tab sets',aifree:'AI-free mode',vpn:'VPN',get protection(){return t('protection.title');}};
export const defaultToolbarItems:readonly ToolbarItem[]=[
 {id:'extensions',visible:true},{id:'downloads',visible:false},{id:'history',visible:false},{id:'bookmarks',visible:false},
 {id:'split',visible:false},{id:'appearance',visible:false},{id:'routines',visible:false},{id:'aifree',visible:false},{id:'vpn',visible:false},{id:'protection',visible:false},{id:'focus',visible:true},{id:'profile',visible:true},
];
const KEY='acira-toolbar-items',EVENT='acira-toolbar-items',memory=new Map<string,ToolbarItem[]>(),cached=new Map<string,{raw:string;value:ToolbarItem[]}>();
const known=new Set(defaultToolbarItems.map(item=>item.id));
/** Unknown ids are dropped and items added in later versions join in their default place. */
export function normalizeToolbarItems(input:unknown):ToolbarItem[]{
 const seen=new Set<string>(),items:ToolbarItem[]=[];
 if(Array.isArray(input))for(const raw of input){const id=raw?.id;if(typeof id==='string'&&known.has(id as ToolbarItemId)&&!seen.has(id)){seen.add(id);items.push({id:id as ToolbarItemId,visible:raw.visible!==false});}}
 defaultToolbarItems.forEach((item,index)=>{if(seen.has(item.id))return;const after=defaultToolbarItems.slice(0,index).map(previous=>previous.id).reverse().find(id=>seen.has(id));const at=after?items.findIndex(entry=>entry.id===after)+1:0;items.splice(at,0,{...item});seen.add(item.id);});
 return items;
}
export function moveToolbarItem(items:readonly ToolbarItem[],id:ToolbarItemId,delta:number):ToolbarItem[]{
 const from=items.findIndex(item=>item.id===id),to=Math.max(0,Math.min(items.length-1,from+delta));
 if(from<0||from===to)return [...items];
 const next=[...items];const [moved]=next.splice(from,1);next.splice(to,0,moved);return next;
}

function read(profile=''):ToolbarItem[]{
 const id=profile;if(memory.has(id))return memory.get(id)!;
 let raw='';try{raw=localStorage.getItem(KEY+':'+profile)||'';}catch{}
 const previous=cached.get(id);if(previous&&previous.raw===raw)return previous.value;
 let value=normalizeToolbarItems(undefined);try{if(raw)value=normalizeToolbarItems(JSON.parse(raw));}catch{}
 cached.set(id,{raw,value});return value;
}
export function setToolbarItems(items:readonly ToolbarItem[],profile=''){
 const next=normalizeToolbarItems(items),id=profile;
 try{const raw=JSON.stringify(next);localStorage.setItem(KEY+':'+profile,raw);cached.set(id,{raw,value:next});}catch{memory.set(id,next);}
 window.dispatchEvent(new Event(EVENT));
}
export function resetToolbarItems(profile=''){
 memory.delete(profile);cached.delete(profile);
 try{localStorage.removeItem(KEY+':'+profile);}catch{}
 window.dispatchEvent(new Event(EVENT));
}
function subscribe(listener:()=>void){window.addEventListener(EVENT,listener);window.addEventListener('storage',listener);return()=>{window.removeEventListener(EVENT,listener);window.removeEventListener('storage',listener);};}
export function useToolbarItems(profile=''){return useSyncExternalStore(subscribe,()=>read(profile));}
