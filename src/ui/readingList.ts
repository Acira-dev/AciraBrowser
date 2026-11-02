import { useSyncExternalStore } from 'react';

/** The Reading list (sidebar section, Round 2): pages to read later, kept per profile on this device, newest first.
 * Its own list rather than a bookmarks folder, since a page has one bookmark and saving it here must not move it out
 * of its folder. A private window keeps it in memory only. */
export type ReadingItem={url:string;title:string;addedAt:number};
const KEY='acira-reading-list',EVENT='acira-reading-list',LIMIT=200;
const memory=new Map<string,ReadingItem[]>(),cached=new Map<string,{raw:string;value:ReadingItem[]}>();
const EMPTY:ReadingItem[]=[];
function read(profile:string,privateMode:boolean):ReadingItem[]{
 const id=(privateMode?'private:':'normal:')+profile;if(privateMode||memory.has(id))return memory.get(id)??EMPTY;
 let raw='[]';try{raw=localStorage.getItem(`${KEY}:${profile}`)||'[]';}catch{}
 const hit=cached.get(id);if(hit?.raw===raw)return hit.value;
 let value:ReadingItem[]=EMPTY;try{const parsed:unknown=JSON.parse(raw);if(Array.isArray(parsed))value=parsed.filter((item):item is ReadingItem=>!!item&&typeof item.url==='string'&&/^https?:\/\//i.test(item.url)&&typeof item.title==='string').slice(0,LIMIT);}catch{}
 cached.set(id,{raw,value});return value;
}
function write(profile:string,privateMode:boolean,items:ReadingItem[]){
 const id=(privateMode?'private:':'normal:')+profile;
 if(privateMode)memory.set(id,items);else try{localStorage.setItem(`${KEY}:${profile}`,JSON.stringify(items));}catch{memory.set(id,items);}
 window.dispatchEvent(new Event(EVENT));
}
export const readingList=(profile:string,privateMode=false)=>read(profile,privateMode);
/** Adds a page at the top; false when it is already there. */
export function addToReadingList(profile:string,privateMode:boolean,page:{url:string;title?:string}):boolean{
 const items=read(profile,privateMode);if(!/^https?:\/\//i.test(page.url)||items.some(item=>item.url===page.url))return false;
 write(profile,privateMode,[{url:page.url,title:(page.title||'').trim().slice(0,300)||page.url,addedAt:Date.now()},...items].slice(0,LIMIT));return true;
}
export function removeFromReadingList(profile:string,privateMode:boolean,url:string):ReadingItem|undefined{
 const items=read(profile,privateMode),gone=items.find(item=>item.url===url);if(gone)write(profile,privateMode,items.filter(item=>item.url!==url));return gone;
}
export function restoreReadingItem(profile:string,privateMode:boolean,item:ReadingItem){
 const items=read(profile,privateMode);if(!items.some(entry=>entry.url===item.url))write(profile,privateMode,[...items,item].sort((a,b)=>b.addedAt-a.addedAt));
}
const subscribe=(listener:()=>void)=>{window.addEventListener(EVENT,listener);window.addEventListener('storage',listener);return()=>{window.removeEventListener(EVENT,listener);window.removeEventListener('storage',listener);};};
export const useReadingList=(profile:string,privateMode=false)=>useSyncExternalStore(subscribe,()=>read(profile,privateMode));
