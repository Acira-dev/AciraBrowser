'use strict';
// The closed-tab log (R3-39): one small record per tab you closed, newest first, so Rewind can answer "where is that tab?" without
// you choosing a snapshot. It keeps what a Rewind moment keeps and nothing more: address, title, group name and colour, pinned,
// the split it was in (the partners' addresses and titles, its slot, whether it was a linked copy), the window and workspace it lived in, and when it was closed.
// Never page contents, forms, cookies or icons. Private and Tor tabs, private profiles and addresses that look like sign-in
// callbacks never get here (entryFromTab), and every deletion path of Rewind reaches the log too (purge, deleteSince, remove).
// Storage: <rewind dir>/<profileId>/closed.json, written atomically a moment after a change (flush() writes at once).
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const model=require('./checkpoint-model.cjs');
const DAY=86400000;
const SCHEMA=1,FILE='closed.json';
const LIMITS={perProfile:1000,writeMs:400,maxBytes:2*1024*1024};
const LAYOUTS=model.LAYOUTS;
const ID=/^ct-[a-z0-9]+-[0-9a-f]{8}$/,BATCH=/^[A-Za-z0-9_.:-]{1,60}$/,SAFE=/^[A-Za-z0-9_.:-]{1,120}$/;
const clean=(text,max)=>String(text||'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,max);
const hostOf=url=>{try{return new URL(url).hostname.replace(/^www\./,'');}catch{return '';}};
/** The same page: the address without its #fragment. */
const keyOf=url=>{try{const parsed=new URL(url);parsed.hash='';return parsed.href;}catch{return String(url);}};
const newId=at=>`ct-${at.toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
const isId=value=>typeof value==='string'&&ID.test(value);

/** One stored record, or null when anything is off (a corrupt row is dropped, never half-trusted). */
function readEntry(raw){
 if(!raw||typeof raw!=='object'||!isId(raw.id)||!Number.isFinite(raw.closedAt)||!model.eligibleUrl(raw.url))return null;
 const partners=Array.isArray(raw.split?.partners)?raw.split.partners.filter(p=>p&&model.eligibleUrl(p.url)).slice(0,3).map(p=>({url:p.url,title:clean(p.title,300)||hostOf(p.url),...(p.linked===true?{linked:true}:{})})):[];
 // Where the tab sat among the split's panes (the number of partners before it) and whether it was a linked copy: so a reopen can rejoin the split at its slot.
 const slot=Number.isInteger(raw.split?.slot)?Math.max(0,Math.min(partners.length,raw.split.slot)):partners.length;
 return {id:raw.id,url:raw.url,title:clean(raw.title,300)||hostOf(raw.url),closedAt:raw.closedAt,
  group:clean(raw.group,64),groupColor:typeof raw.groupColor==='string'?clean(raw.groupColor,16):'none',pinned:raw.pinned===true,
  batch:typeof raw.batch==='string'&&BATCH.test(raw.batch)?raw.batch:'',
  ...(partners.length?{split:{layout:LAYOUTS.includes(raw.split.layout)?raw.split.layout:'columns',slot,...(raw.split.linked===true?{linked:true}:{}),partners}}:{}),
  workspaceRef:typeof raw.workspaceRef==='string'&&SAFE.test(raw.workspaceRef)?raw.workspaceRef:null,
  windowId:typeof raw.windowId==='string'&&SAFE.test(raw.windowId)?raw.windowId:'',kept:raw.kept===true};
}

/** The split this tab was in, as the other panes' addresses and titles; null when it was in none or no partner is a plain web page. */
function splitOf(state,tab){
 const ui=state?.windowUi||{},groups=[...(ui.splitGroups||[]),...(ui.split?[ui.split]:[])];
 const group=groups.find(item=>Array.isArray(item?.tabIds)&&item.tabIds.includes(tab.id));if(!group)return null;
 const linked=Array.isArray(group.linked)?group.linked:[],at=group.tabIds.indexOf(tab.id);
 const kept=group.tabIds.filter(id=>id!==tab.id).map(id=>(state.tabs||[]).find(item=>item.id===id))
  .filter(item=>item&&!item.privacy&&item.browserProfileId===tab.browserProfileId&&item.contentKind==='web'&&model.eligibleUrl(item.url)).slice(0,3);
 const partners=kept.map(item=>({url:item.url,title:clean(item.title,300)||hostOf(item.url),...(linked.includes(item.id)?{linked:true}:{})}));
 // The slot counts the partners kept here that sat before this tab, so it indexes `partners` even when a private pane was left out.
 const slot=kept.filter(item=>group.tabIds.indexOf(item.id)<at).length;
 return partners.length?{layout:LAYOUTS.includes(group.layout)?group.layout:'columns',slot,...(linked.includes(tab.id)?{linked:true}:{}),partners}:null;
}

/** What to log for `tab` as it was in `state` (the state before the close), or null: private and Tor tabs, private profiles,
 *  Acira pages and addresses that carry credentials or tokens are never recorded. */
function entryFromTab(state,tab,{windowId='',batch=''}={}){
 if(!tab||tab.privacy||tab.contentKind!=='web'||!model.eligibleUrl(tab.url))return null;
 const profile=(state?.browserProfiles||[]).find(item=>item.id===tab.browserProfileId);if(!profile||profile.private)return null;
 const source=tab.group&&!tab.pinned?(state.tabGroups||[]).find(group=>group.name===tab.group&&group.browserProfileId===tab.browserProfileId):null;
 const split=splitOf(state,tab);
 return {url:tab.url,title:clean(tab.title,300)||hostOf(tab.url),group:tab.group&&!tab.pinned?clean(tab.group,64):'',groupColor:source?.color||'none',pinned:tab.pinned===true,
  batch:BATCH.test(batch)?batch:'',...(split?{split}:{}),workspaceRef:tab.workspaceId||state.activeWorkspaceId||null,windowId:String(windowId||'')};
}

/** Search over title, address, site, group and a split partner's title. Case-insensitive plain text. */
function matchesEntry(entry,query){
 const q=String(query||'').trim().toLowerCase();if(!q)return true;
 return entry.title.toLowerCase().includes(q)||entry.url.toLowerCase().includes(q)||hostOf(entry.url).includes(q)||entry.group.toLowerCase().includes(q)
  ||(entry.split?.partners||[]).some(p=>p.title.toLowerCase().includes(q)||p.url.toLowerCase().includes(q));
}

function createClosedLog({dir,now=Date.now,limits={},timers={setTimeout,clearTimeout}}={}){
 const L={...LIMITS,...limits};
 const profiles=new Map(),dirty=new Set();let timer=null;
 const file=profileId=>path.join(dir,profileId,FILE);
 const safe=profileId=>typeof profileId==='string'&&SAFE.test(profileId);
 function load(profileId){
  if(profiles.has(profileId))return profiles.get(profileId);
  let entries=[];
  try{const text=fs.readFileSync(file(profileId),'utf8'),raw=JSON.parse(text);if(raw?.schemaVersion===SCHEMA&&Array.isArray(raw.entries)){const seen=new Set();entries=raw.entries.map(readEntry).filter(entry=>entry&&!seen.has(entry.id)&&seen.add(entry.id));entries.sort((a,b)=>b.closedAt-a.closedAt);}}catch{}
  profiles.set(profileId,entries);return entries;
 }
 function writeNow(profileId){
  const entries=profiles.get(profileId);if(!entries)return;
  try{
   if(!entries.length){fs.rmSync(file(profileId),{force:true});return;}
   let text=JSON.stringify({schemaVersion:SCHEMA,entries});
   // Bounded on disk too: the oldest unkept rows go first.
   while(Buffer.byteLength(text)>L.maxBytes&&entries.length>1){const at=entries.findLastIndex(entry=>!entry.kept);entries.splice(at<0?entries.length-1:at,1);text=JSON.stringify({schemaVersion:SCHEMA,entries});}
   fs.mkdirSync(path.dirname(file(profileId)),{recursive:true});const tmp=`${file(profileId)}.${process.pid}.tmp`;fs.writeFileSync(tmp,text);fs.renameSync(tmp,file(profileId));
  }catch{}
 }
 function flush(){if(timer){timers.clearTimeout(timer);timer=null;}for(const profileId of [...dirty])writeNow(profileId);dirty.clear();}
 function touch(profileId){dirty.add(profileId);if(timer)return;timer=timers.setTimeout(()=>{timer=null;flush();},L.writeMs);timer?.unref?.();}
 /** Age (the Rewind setting, in days) and count, whichever evicts first; kept rows skip age and go last under the count. */
 function prune(profileId,days){
  const entries=load(profileId),cutoff=now()-days*DAY;let changed=false;
  for(let i=entries.length-1;i>=0;i--)if(entries[i].closedAt<=cutoff&&!entries[i].kept){entries.splice(i,1);changed=true;}
  while(entries.length>L.perProfile){const at=entries.findLastIndex(entry=>!entry.kept);entries.splice(at<0?entries.length-1:at,1);changed=true;}
  if(changed)touch(profileId);
  return changed;
 }
 /** Adds closed tabs (newest first within a call's order of arrival); the same page closed again replaces its older row and keeps its Keep. */
 function record(profileId,items,days=7){
  if(!safe(profileId)||!Array.isArray(items))return [];
  const entries=load(profileId),added=[];
  for(const item of items){
   if(!item||!model.eligibleUrl(item.url))continue;
   const key=keyOf(item.url),at=entries.findIndex(entry=>keyOf(entry.url)===key),older=at>=0?entries.splice(at,1)[0]:null;
   const entry=readEntry({...item,id:newId(now()),closedAt:now(),kept:older?.kept===true});if(!entry)continue;
   entries.unshift(entry);added.push(entry);
  }
  if(added.length){prune(profileId,days);touch(profileId);}
  return added;
 }
 /** The log as the page shows it: the same page once (its newest close), not expired, not open in `state`, matching `query`. */
 function list(profileId,{state=null,query='',days=7,limit=500}={}){
  if(!safe(profileId))return {entries:[],total:0};
  const entries=load(profileId),cutoff=now()-days*DAY,open=new Set();
  if(state)for(const tab of state.tabs||[])if(tab.browserProfileId===profileId&&typeof tab.url==='string')open.add(keyOf(tab.url));
  const seen=new Set(),out=[];
  for(const entry of entries){
   if(entry.closedAt<=cutoff&&!entry.kept)continue;
   const key=keyOf(entry.url);if(seen.has(key))continue;seen.add(key);
   if(open.has(key)||!matchesEntry(entry,query))continue;
   out.push(entry);
  }
  return {entries:out.slice(0,limit),total:out.length};
 }
 const get=(profileId,id)=>safe(profileId)&&isId(id)?load(profileId).find(entry=>entry.id===id)||null:null;
 function setKept(profileId,id,kept){const entry=get(profileId,id);if(!entry)return false;entry.kept=kept===true;touch(profileId);return true;}
 /** Forget one tab: its row and every older row of the same page. Returns the forgotten page's address, or null. */
 function remove(profileId,id){
  const entry=get(profileId,id);if(!entry)return null;const key=keyOf(entry.url),entries=load(profileId);
  for(let i=entries.length-1;i>=0;i--)if(keyOf(entries[i].url)===key)entries.splice(i,1);
  touch(profileId);return entry.url;
 }
 /** Removes every row whose address matches (history deletion, forget site). */
 function purge(profileId,match){
  if(!safe(profileId))return 0;const entries=load(profileId);let gone=0;
  for(let i=entries.length-1;i>=0;i--)if(match(entries[i].url)){entries.splice(i,1);gone++;}
  if(gone)touch(profileId);return gone;
 }
 function deleteSince(profileId,since){
  if(!safe(profileId))return 0;const entries=load(profileId);let gone=0;
  for(let i=entries.length-1;i>=0;i--)if(entries[i].closedAt>=since){entries.splice(i,1);gone++;}
  if(gone)touch(profileId);return gone;
 }
 function removeProfile(profileId){if(!safe(profileId))return;profiles.set(profileId,[]);dirty.delete(profileId);try{fs.rmSync(file(profileId),{force:true});}catch{}profiles.delete(profileId);}
 const count=profileId=>safe(profileId)?load(profileId).length:0;
 return {record,list,get,setKept,remove,purge,deleteSince,removeProfile,prune,flush,count,load:profileId=>load(profileId).slice()};
}
module.exports={createClosedLog,entryFromTab,matchesEntry,readEntry,splitOf,keyOf,isId,LAYOUTS,LIMITS};
