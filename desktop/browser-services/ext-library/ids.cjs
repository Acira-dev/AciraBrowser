'use strict';
// Chrome's numeric ids for Acira's records (bookmark nodes, history pages and visits, downloads). Chrome hands extensions small
// integers (bookmarks "4", downloads 12) that stay the same across restarts; Acira's records carry string ids ("bookmark-…",
// "download-<uuid>"). One map per profile and kind, kept in userData/extension-library-ids/<profile>.json, so an id an extension saved
// yesterday still names the same record today. Ids of records that are gone are forgotten (never reused: `next` only grows).
const fs=require('node:fs'),path=require('node:path');

const FILE_LIMIT=8*1024*1024;
const safeName=value=>String(value||'default').replace(/[^A-Za-z0-9_.-]/g,'_').slice(0,120)||'default';

/** createIdStore({dir, profile}) -> {map(kind, {first}) -> IdMap, flush()} */
function createIdStore({dir,profile,delay=250}){
 const file=dir?path.join(dir,safeName(profile)+'.json'):null;
 let data={version:1,kinds:{}},loaded=false,timer=null;
 function load(){
  if(loaded)return;loaded=true;
  if(!file)return;
  try{if(fs.statSync(file).size<FILE_LIMIT){const saved=JSON.parse(fs.readFileSync(file,'utf8'));if(saved&&typeof saved==='object'&&saved.kinds&&typeof saved.kinds==='object')data={version:1,kinds:saved.kinds};}}catch{}
 }
 function flush(){
  if(timer){clearTimeout(timer);timer=null;}
  if(!file)return;
  try{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file+'.tmp',JSON.stringify(data));fs.renameSync(file+'.tmp',file);}catch{}
 }
 function schedule(){if(!file||timer)return;timer=setTimeout(flush,delay);timer.unref?.();}
 /** One kind's map: key (Acira id or address) <-> number. */
 function map(kind,{first=1}={}){
  load();
  const entry=data.kinds[kind]&&typeof data.kinds[kind]==='object'?data.kinds[kind]:(data.kinds[kind]={next:first,ids:{}});
  if(!Number.isSafeInteger(entry.next)||entry.next<first)entry.next=first;
  if(!entry.ids||typeof entry.ids!=='object')entry.ids={};
  let reverse=null;
  const back=()=>{if(!reverse){reverse=new Map();for(const [key,value] of Object.entries(entry.ids))reverse.set(value,key);}return reverse;};
  return {
   /** The number for a key, made the first time it is asked for. */
   id(key){
    key=String(key);const known=entry.ids[key];if(Number.isSafeInteger(known))return known;
    const value=entry.next++;entry.ids[key]=value;if(reverse)reverse.set(value,key);schedule();return value;
   },
   /** The number for a key, or undefined when it has none yet. */
   peek(key){const known=entry.ids[String(key)];return Number.isSafeInteger(known)?known:undefined;},
   /** The key for a number (or a numeric string), or undefined. */
   key(value){const n=typeof value==='string'&&/^\d+$/.test(value)?Number(value):value;return Number.isSafeInteger(n)?back().get(n):undefined;},
   /** Forgets every key not in `alive` (records that are gone). */
   keep(alive){
    const set=alive instanceof Set?alive:new Set(alive);let changed=false;
    for(const key of Object.keys(entry.ids))if(!set.has(key)){if(reverse)reverse.delete(entry.ids[key]);delete entry.ids[key];changed=true;}
    if(changed)schedule();
   },
   forget(key){key=String(key);if(!(key in entry.ids))return;if(reverse)reverse.delete(entry.ids[key]);delete entry.ids[key];schedule();}
  };
 }
 return {map,flush,file};
}

module.exports={createIdStore};
