'use strict';
const {storedWindowSnapshot}=require('./stored-window.cjs');
const {t}=require('./tx.cjs');
const {site}=require('./site-data.cjs');

function sameOrigin(value,origin){try{return new URL(value).origin===origin;}catch{return false;}}
function forgetOriginRecords(snapshot,profileId,origin){
 const canonical=site(origin).origin;
 if(canonical!==origin||!snapshot.browserProfiles.some(profile=>profile.id===profileId))throw new Error('Unknown local profile or website origin.');
 const next=structuredClone(snapshot),counts={history:0,closedTabs:0,closedHistoryEntries:0};
 next.browsingHistory=next.browsingHistory.filter(record=>{if(record.browserProfileId!==profileId||!sameOrigin(record.url,origin))return true;counts.history++;return false;});
 next.closedTabs=(next.closedTabs||[]).filter(tab=>{
  if(tab.browserProfileId!==profileId)return true;
  if(sameOrigin(tab.url,origin)){counts.closedTabs++;return false;}
  const previous=Array.isArray(tab.history)?tab.history:[],kept=previous.map((url,index)=>({url,index})).filter(entry=>!sameOrigin(entry.url,origin));
  if(kept.length!==previous.length){counts.closedHistoryEntries+=previous.length-kept.length;const oldIndex=Number.isSafeInteger(tab.historyIndex)?tab.historyIndex:previous.length-1;tab.history=kept.map(entry=>entry.url);tab.historyIndex=Math.max(0,kept.filter(entry=>entry.index<=oldIndex).length-1);tab.canGoBack=tab.historyIndex>0;tab.canGoForward=tab.historyIndex<tab.history.length-1;}
  return true;
 });
 next.revision++;
 return {snapshot:next,counts,filesDeleted:false};
}

function forgetStoredOrigin(database,profileId,origin){
 if(typeof profileId!=='string'||site(origin).origin!==origin)throw new Error('Invalid stored website scope.');
 return database.transaction(()=>{
  let history=0;const windowIds=[];
  const remove=database.db.prepare('DELETE FROM history WHERE id=? AND profile_id=?');
  for(const row of database.db.prepare('SELECT id,payload FROM history WHERE profile_id=?').all(profileId))if(sameOrigin(JSON.parse(row.payload).url,origin)){remove.run(row.id,profileId);history++;}
  const update=database.db.prepare('UPDATE windows SET payload=?,updated_at=? WHERE id=?');
  for(const row of database.db.prepare('SELECT id,payload FROM windows').all()){
   const snapshot=JSON.parse(row.payload);if(!snapshot.browserProfiles?.some(profile=>profile.id===profileId))continue;
   const changed=forgetOriginRecords(snapshot,profileId,origin);
   if(Object.values(changed.counts).some(Boolean)){update.run(JSON.stringify(storedWindowSnapshot(changed.snapshot)),Date.now(),row.id);windowIds.push(row.id);}
  }
  return {history,windowIds,filesDeleted:false};
 });
}

function prepareForgetRecords(database,liveWindows,profileId,origin){
 if(site(origin).origin!==origin||!Array.isArray(liveWindows))throw new Error('Invalid native Forget site scope.');
 const stored=database?database.db.prepare('SELECT id,payload FROM windows').all().map(row=>({id:row.id,snapshot:JSON.parse(row.payload)})):[],windows=new Map(stored.map(window=>[window.id,window.snapshot])),history=new Map(),closed=new Map();
 for(const window of liveWindows){if(typeof window.id!=='string'||!window.snapshot)throw new Error('Invalid live-window snapshot.');windows.set(window.id,window.snapshot);}
 const addHistory=record=>{if(typeof record.id!=='string')throw new Error('A history record has no stable identity.');const previous=history.get(record.id);if(previous&&previous.browserProfileId!==record.browserProfileId)throw new Error('Conflicting native history profile identity.');history.set(record.id,record);};
 if(database)for(const row of database.db.prepare('SELECT payload FROM history').all())addHistory(JSON.parse(row.payload));
 // Live snapshots replace their stale saved window and then override shared entity versions.
 for(const snapshot of windows.values())for(const record of snapshot.browsingHistory||[])addHistory(record);
 for(const window of liveWindows)for(const record of window.snapshot.browsingHistory||[])addHistory(record);
 for(const snapshot of [...windows.values(),...liveWindows.map(window=>window.snapshot)])for(const tab of snapshot.closedTabs||[])if(tab.browserProfileId===profileId){if(typeof tab.id!=='string')throw new Error('A closed tab has no stable identity.');closed.set(tab.id,tab);}
 const counts={history:0,closedTabs:0,closedHistoryEntries:0};for(const record of history.values())if(record.browserProfileId===profileId&&sameOrigin(record.url,origin))counts.history++;
 for(const tab of closed.values())if(sameOrigin(tab.url,origin))counts.closedTabs++;else counts.closedHistoryEntries+=(tab.history||[]).filter(url=>sameOrigin(url,origin)).length;
 const plans=[];for(const [id,snapshot]of windows){if(!snapshot.browserProfiles?.some(profile=>profile.id===profileId))continue;if(database&&snapshot.browserProfiles.some(profile=>profile.private))throw new Error('Private state cannot enter a stored Forget site plan.');const profiles=new Set(snapshot.browserProfiles.map(profile=>profile.id)),canonical={...snapshot,browsingHistory:[...history.values()].filter(record=>profiles.has(record.browserProfileId))};plans.push({id,snapshot:forgetOriginRecords(canonical,profileId,origin).snapshot});}
 if(!plans.length)throw new Error('Unknown local profile.');return {counts,windows:plans,history:[...history.values()],filesDeleted:false};
}
function commitForgetRecords(database,liveWindows,profileId,origin){
 return database.transaction(()=>{
  const plan=prepareForgetRecords(database,liveWindows,profileId,origin),upsert=database.db.prepare('INSERT INTO history(id,profile_id,visited_at,payload) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET profile_id=excluded.profile_id,visited_at=excluded.visited_at,payload=excluded.payload');
  for(const record of plan.history)if(!(record.browserProfileId===profileId&&sameOrigin(record.url,origin)))upsert.run(record.id,record.browserProfileId,record.time,JSON.stringify(record));
  const remove=database.db.prepare('DELETE FROM history WHERE id=? AND profile_id=?');for(const row of database.db.prepare('SELECT id,payload FROM history WHERE profile_id=?').all(profileId))if(sameOrigin(JSON.parse(row.payload).url,origin))remove.run(row.id,profileId);
  const save=database.db.prepare('INSERT INTO windows(id,payload,updated_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at');for(const window of plan.windows)save.run(window.id,JSON.stringify(storedWindowSnapshot(window.snapshot)),Date.now());
  return {counts:plan.counts,windows:plan.windows,filesDeleted:false};
 });
}

function createForgetSite({getContext,previewRecords,commitRecords,siteData,dialog,getWindow}){
 if(typeof previewRecords!=='function')throw new Error('Forget site requires a native profile-wide record preview.');
 const generations=new WeakMap(),pending=new WeakSet();
 function capture(wc){
  if(!wc||wc.isDestroyed())throw new Error('This website tab is no longer available.');
  const owner=getContext(wc);if(!owner||typeof owner.profileId!=='string'||typeof owner.tabId!=='string')throw new Error('Unknown website tab or profile.');
  if(!generations.has(wc)){generations.set(wc,0);wc.on('did-start-navigation',(_event,_url,_inPlace,main)=>{if(main)generations.set(wc,(generations.get(wc)||0)+1);});}
  return {...site(wc.getURL()),profileId:owner.profileId,tabId:owner.tabId,privateMode:!!(owner.privateMode||owner.private),session:wc.session,generation:generations.get(wc)};
 }
 function valid(wc,c){if(wc.isDestroyed())return false;const owner=getContext(wc);return owner?.profileId===c.profileId&&owner?.tabId===c.tabId&&!!(owner.privateMode||owner.private)===c.privateMode&&wc.session===c.session&&wc.getURL()===c.url&&generations.get(wc)===c.generation;}
 async function describe(wc,c){
  const info=await siteData.status(wc);if(!valid(wc,c))throw new Error('The website changed. Review its data again.');
  const counts=await previewRecords({profileId:c.profileId,origin:c.origin,privateMode:c.privateMode});if(!valid(wc,c))throw new Error('The website changed. Review its data again.');if(!counts||!['history','closedTabs','closedHistoryEntries'].every(key=>Number.isSafeInteger(counts[key])&&counts[key]>=0))throw new Error('The complete profile record preview is unavailable.');
  return {origin:c.origin,cookieScope:c.cookieDomain,storageScope:c.origin,profileId:c.profileId,private:c.privateMode,counts:{history:counts.history,closedTabs:counts.closedTabs,closedHistoryEntries:counts.closedHistoryEntries,cookies:info.cookieCount,permissions:info.permissions.length},preserved:[t('forget.kept.bookmarks'),t('forget.kept.downloads'),t('forget.kept.tabs'),t('forget.kept.filtering')],notice:t('forget.notice')};
 }
 async function preview(wc){const c=capture(wc);return describe(wc,c);}
 async function forget(wc){
  const c=capture(wc);if(pending.has(c.session))throw new Error('A Forget site review is already open for this browsing profile.');pending.add(c.session);
  try{
   const review=await describe(wc,c),answer=await dialog.showMessageBox(getWindow(wc),{type:'warning',title:t('forget.title'),message:t('forget.message',{origin:c.origin}),detail:t('forget.detail',{history:review.counts.history,closedTabs:review.counts.closedTabs,entries:review.counts.closedHistoryEntries,cookies:review.counts.cookies,cookieDomain:c.cookieDomain,origin:c.origin}),buttons:[t('dialog.cancel'),t('forget.title')],defaultId:0,cancelId:0});
   if(answer.response!==1)return {cancelled:true};
   if(!valid(wc,c))throw new Error('The selected website changed during review. No data was cleared.');
   const results=[];let engine;
   try{engine=await siteData.clear(wc,{categories:['cookies','storage','cache','permissions'],confirmed:true});results.push(...engine.results);}catch(error){results.push({category:'site-data',status:'failed',error:String(error.message||error)});}
   // Commit against the owner's current canonical state, never the preview snapshot.
   try{const records=await commitRecords({profileId:c.profileId,origin:c.origin,privateMode:c.privateMode});results.push({category:'local-records',status:'cleared',scope:c.origin,counts:records.counts,filesDeleted:false});}catch(error){results.push({category:'local-records',status:'failed',error:String(error.message||error)});}
   return {origin:c.origin,cookieScope:c.cookieDomain,results,cleared:results.every(result=>result.status==='cleared'),reloadRequired:true,recoveryPaused:engine?.recoveryPaused??null,preserved:review.preserved,filesDeleted:false};
  }finally{pending.delete(c.session);}
 }
 return {preview,forget};
}
module.exports={createForgetSite,forgetOriginRecords,forgetStoredOrigin,prepareForgetRecords,commitForgetRecords};
