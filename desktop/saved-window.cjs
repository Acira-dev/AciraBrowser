'use strict';
// A window's saved record (its tabs, and the settings, bookmarks and history every window carries) that cannot be read: a damaged payload that SQLite's
// own check does not see, or a shape a newer Acira wrote. Its start used to throw, and with one window Acira stayed running with nothing on screen and no
// message. Now the person is asked once per launch: "Start fresh" keeps a copy of the whole database first (browser.sqlite.damaged-<time>, named in the
// question) and opens the window with one new tab; "Quit" changes nothing. While the question waits, that window never saves over the record (main.cjs
// checks `recordUnreadable`).
// Bookmarks, history, downloads and profiles come from their own tables, which every save rewrites: another window's record can be weeks old (a closed
// window's record stays), and the first save of the new window would put its old lists back over today's. Only the settings, which nothing else holds,
// come from the newest other record that reads.
// A read that fails because the database is busy or locked (another connection is writing) is tried again; if it keeps failing nothing is asked or
// moved: Acira explains and quits. Every other failure (damage, text that cannot be read, an I/O error, a record too big) may well happen at every start,
// so it gets the question: explaining and quitting would mean Acira never opens again.
const {randomUUID}=require('node:crypto');

/** SQLITE_BUSY or SQLITE_LOCKED, with their extended codes (SQLITE_BUSY_SNAPSHOT 517, SQLITE_LOCKED_SHAREDCACHE 262…): a read that may work a moment later. */
const passing=error=>[5,6].includes(Number(error?.errcode)&0xff);

/** The window's record restored ({snapshot}), null when there is none, {damaged:error} when it is there but cannot be read, or {unavailable:error} when the
 *  database stayed busy or locked (tried `tries` times). */
async function readSavedWindow({database,windowId,restoreSnapshot,tries=3,pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))}){
 for(let attempt=1;;attempt++){
  let raw;
  try{raw=database.readWindow(windowId);}
  catch(error){if(!passing(error))return {damaged:error};if(attempt>=tries)return {unavailable:error};await pause(150*attempt);continue;}
  if(!raw)return null;
  try{return {snapshot:restoreSnapshot(raw)};}catch(error){return {damaged:error};}
 }
}

/** A new window's state with what can still be read: the tables' bookmarks, history, downloads and profiles, the settings of the newest other record
 *  that reads. One new tab. */
function salvage({database,windowId,restoreSnapshot,createInitialState,makeTab}){
 let lender=null;
 try{
  for(const row of database.db.prepare('SELECT id,payload FROM windows WHERE id<>? ORDER BY updated_at DESC').all(windowId)){
   try{lender=restoreSnapshot(JSON.parse(row.payload));break;}catch{/* that one is unreadable too */}
  }
 }catch{}
 const rows=sql=>{try{return database.db.prepare(sql).all().flatMap(row=>{try{return [JSON.parse(row.payload)];}catch{return [];}});}catch{return [];}};
 const profiles=rows('SELECT payload FROM profiles').filter(profile=>profile&&typeof profile.id==='string'&&!profile.private);
 const base=restoreSnapshot({...(profiles.length?{browserProfiles:profiles}:{}),...(lender?{settings:lender.settings}:{}),bookmarkNodes:rows('SELECT payload FROM bookmarks ORDER BY profile_id,parent_id,position'),browsingHistory:rows('SELECT payload FROM history ORDER BY visited_at DESC'),downloads:rows('SELECT payload FROM downloads')});
 const ordinary=(base.browserProfiles||[]).filter(profile=>!profile.private);
 const profileId=(ordinary.find(profile=>profile.id===lender?.activeBrowserProfileId)||ordinary[0]||createInitialState().browserProfiles[0]).id;
 const state=restoreSnapshot({...base,windowUi:{...base.windowUi,split:null,splitGroups:[],lastTabs:{}},tabs:[],closedTabs:[],tabGroups:[]});
 state.tabs=[makeTab('tab-'+randomUUID(),'',undefined,profileId)];state.activeTabId=state.tabs[0].id;state.activeBrowserProfileId=profileId;
 return state;
}

/** One answer per launch for every window whose record cannot be read: the first such window asks, the others wait for that answer. */
function createSavedWindowRecovery({database,ask,quit,explain=quit,restoreSnapshot,createInitialState,makeTab,asideName,warn=message=>console.warn(message),now=Date.now}){
 let answer=null,aside=null,explained=false;
 /** 'fresh' with the state to start from, or 'quit'. The copy is made only when the person chose Start fresh, so Quit changes nothing. */
 async function recover(windowId,error){
  try{warn('A saved window could not be read ('+String(error&&error.message||error).slice(0,200)+').');}catch{}
  if(!answer){
   const name=asideName(database.filename,{now:now()});
   answer=Promise.resolve().then(()=>ask({aside:name})).catch(()=>'quit').then(choice=>{
    if(choice!=='fresh')return 'quit';
    try{database.backup(name);aside=name;try{require('node:fs').chmodSync(name,0o600);}catch{}}catch(copyError){try{warn('The copy before starting fresh failed: '+copyError.message);}catch{}return 'failed';}
    return 'fresh';
   });
  }
  const choice=await answer;
  // no copy could be made (a full disk): nothing is changed, and Acira says so rather than starting fresh over the only copy
  if(choice==='failed'){if(!explained){explained=true;try{explain();}catch{}}return {choice:'quit'};}
  if(choice!=='fresh'){try{quit();}catch{}return {choice:'quit'};}
  return {choice:'fresh',aside,state:salvage({database,windowId,restoreSnapshot,createInitialState,makeTab})};
 }
 /** The database stayed busy or locked: nothing is asked, copied or written; Acira explains once and quits. */
 async function unavailable(windowId,error){
  try{warn('A saved window could not be read for now ('+String(error&&error.message||error).slice(0,200)+').');}catch{}
  if(!explained){explained=true;try{explain();}catch{}}else try{quit();}catch{}
  return {choice:'quit'};
 }
 return {recover,unavailable};
}

module.exports={readSavedWindow,salvage,createSavedWindowRecovery};
