'use strict';
const {storedWindowSnapshot}=require('./stored-window.cjs');
const { tm } = require('../tm.cjs');
const {site}=require('./site-data.cjs');
const KEY='exit-cleanup-plan-v1',CATEGORIES=new Set(['cookies','storage','history','permissions']);
const MAX_JOURNAL_CHARS=512000,MAX_JOBS=100;
function cleanupChoice(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['enabled','categories','keepOrigins'].includes(key))||typeof value.enabled!=='boolean'||!Array.isArray(value.categories)||value.categories.some(category=>!CATEGORIES.has(category))||value.enabled&&!value.categories.length||!Array.isArray(value.keepOrigins)||value.keepOrigins.length>100)throw new Error('Choose supported cleanup categories and at most100explicit keep-site origins.');
 if(value.categories.length>4)throw new Error('Too many exit-cleanup categories.');
 const keepOrigins=[...new Set(value.keepOrigins.map(value=>{if(typeof value!=='string'||value.length>2048)throw new Error('Enter a bounded keep-site origin.');const url=new URL(value);if(url.pathname!=='/'||url.search||url.hash)throw new Error('Keep-site rules must name an HTTP(S) origin, without a path or query.');return site(url.href).origin;}))];
 return {enabled:value.enabled,categories:[...new Set(value.categories)],keepOrigins};
}
const emptyChoice=()=>({enabled:false,categories:[],keepOrigins:[]});
const origin=value=>{try{return site(value).origin;}catch{return null;}};
function clearExitRecords(snapshot,profileId,keepOrigins){
 if(!snapshot.browserProfiles.some(profile=>profile.id===profileId))throw new Error('Unknown local profile.');const keep=new Set(keepOrigins),next=structuredClone(snapshot),counts={history:0,closedTabs:0,navigationEntries:0};
 next.browsingHistory=next.browsingHistory.filter(row=>{if(row.browserProfileId!==profileId||keep.has(origin(row.url)))return true;counts.history++;return false;});
 next.closedTabs=(next.closedTabs||[]).filter(tab=>{if(tab.browserProfileId!==profileId||keep.has(origin(tab.url)))return true;counts.closedTabs++;return false;});
 for(const tab of [...(next.tabs||[]),...next.closedTabs])if(tab.browserProfileId===profileId){
  const history=Array.isArray(tab.history)?tab.history:[],current=history[tab.historyIndex]===tab.url?tab.historyIndex:-1,kept=history.map((url,index)=>({url,index})).filter(entry=>keep.has(origin(entry.url))||entry.index===current);
  if(!kept.some(entry=>entry.index===current&&entry.url===tab.url))kept.push({url:tab.url,index:-1});
  counts.navigationEntries+=Math.max(0,history.length-kept.length);tab.history=kept.map(entry=>entry.url);tab.historyIndex=kept.findIndex(entry=>entry.index===current&&entry.url===tab.url);if(tab.historyIndex<0)tab.historyIndex=tab.history.length-1;tab.canGoBack=tab.historyIndex>0;tab.canGoForward=tab.historyIndex<tab.history.length-1;
 }
 next.revision++;return {snapshot:next,counts,filesDeleted:false};
}
function commitExitRecords(database,liveWindows,profileId,keepOrigins){
 const keep=new Set(cleanupChoice({enabled:true,categories:['history'],keepOrigins}).keepOrigins);return database.transaction(()=>{
  const windows=new Map(database.db.prepare('SELECT id,payload FROM windows').all().map(row=>[row.id,JSON.parse(row.payload)])),history=new Map();for(const window of liveWindows)windows.set(window.id,window.snapshot);
  const add=record=>{if(typeof record.id!=='string')throw new Error('History record has no stable identity.');const previous=history.get(record.id);if(previous&&previous.browserProfileId!==record.browserProfileId)throw new Error('Conflicting native history identity.');history.set(record.id,record);};
  for(const row of database.db.prepare('SELECT payload FROM history').all())add(JSON.parse(row.payload));for(const snapshot of windows.values())for(const record of snapshot.browsingHistory||[])add(record);for(const window of liveWindows)for(const record of window.snapshot.browsingHistory||[])add(record);
  const counts={history:0},plans=[];for(const record of history.values())if(record.browserProfileId===profileId&&!keep.has(origin(record.url)))counts.history++;
  const upsert=database.db.prepare('INSERT INTO history(id,profile_id,visited_at,payload) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET profile_id=excluded.profile_id,visited_at=excluded.visited_at,payload=excluded.payload');for(const record of history.values())if(record.browserProfileId!==profileId||keep.has(origin(record.url)))upsert.run(record.id,record.browserProfileId,record.time,JSON.stringify(record));
  const remove=database.db.prepare('DELETE FROM history WHERE id=? AND profile_id=?');for(const row of database.db.prepare('SELECT id,payload FROM history WHERE profile_id=?').all(profileId))if(!keep.has(origin(JSON.parse(row.payload).url)))remove.run(row.id,profileId);
  const save=database.db.prepare('INSERT INTO windows(id,payload,updated_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at');for(const [id,snapshot]of windows){if(!snapshot.browserProfiles?.some(profile=>profile.id===profileId))continue;if(snapshot.browserProfiles.some(profile=>profile.private))throw new Error('Private state cannot enter a stored exit-cleanup plan.');const profiles=new Set(snapshot.browserProfiles.map(profile=>profile.id)),canonical={...snapshot,browsingHistory:[...history.values()].filter(record=>profiles.has(record.browserProfileId))},changed=clearExitRecords(canonical,profileId,keepOrigins);save.run(id,JSON.stringify(storedWindowSnapshot(changed.snapshot)),Date.now());plans.push({id,snapshot:changed.snapshot});}
  return {counts,windows:plans,filesDeleted:false};
 });
}
const clearStoredExitRecords=(database,profileId,keepOrigins)=>commitExitRecords(database,[],profileId,keepOrigins);
function createExitCleanup({database,getProfiles,getSession,getPipeline,hasLivePages,cookieRestore,permissions,commitRecords,dialog,getWindow,getProtectedOrigins}){
 if(typeof getPipeline!=='function')throw new Error('Exit cleanup requires the existing native-session request pipeline.');
 if(typeof getProtectedOrigins!=='function')throw new Error('Exit cleanup requires complete native installation metadata, including disabled and unavailable extensions.');
 const running=new Set(),reviewing=new Set(),barriers=new Map();let pendingRun=false;
 function profile(id){const result=getProfiles().find(profile=>profile.id===id);if(!result||result.private||typeof result.partition!=='string'||!result.partition.startsWith('persist:'))throw new Error('Select an ordinary persistent local profile. Private windows already have separate ephemeral teardown.');return result;}
 const choice=id=>cleanupChoice(database.policy(id,'*')?.exitCleanup||emptyChoice());
 function checkedJobs(parsed){
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)||Object.keys(parsed).some(key=>!['version','jobs'].includes(key))||parsed.version!==1||!Array.isArray(parsed.jobs)||parsed.jobs.length>MAX_JOBS)throw new Error('Invalid exit-cleanup journal or too many pending profiles (maximum100).');
  const seen=new Set();return parsed.jobs.map(job=>{if(!job||typeof job!=='object'||Array.isArray(job)||Object.keys(job).some(key=>!['profileId','partition','armedAt','choice'].includes(key))||typeof job.profileId!=='string'||!job.profileId||job.profileId.length>200||seen.has(job.profileId)||typeof job.partition!=='string'||job.partition.length>250||!job.partition.startsWith('persist:')||job.partition.length===8||!Number.isSafeInteger(job.armedAt)||job.armedAt<0)throw new Error('Invalid exit-cleanup job.');seen.add(job.profileId);const checked=cleanupChoice(job.choice);if(!checked.enabled)throw new Error('A pending cleanup job must be enabled.');return {profileId:job.profileId,partition:job.partition,armedAt:job.armedAt,choice:checked};});
 }
 function encodeJobs(jobs){const raw=JSON.stringify({version:1,jobs:checkedJobs({version:1,jobs})});if(raw.length>MAX_JOURNAL_CHARS)throw new Error('Exit-cleanup journal capacity exceeded (512000 characters). Previous choices and pending jobs were kept; reduce keep-site rules or pending profiles.');return raw;}
 function readJobs(){
  const row=database.db.prepare('SELECT value FROM metadata WHERE key=?').get(KEY);if(!row)return [];const raw=row.value;
  if(typeof raw!=='string'||raw.length>MAX_JOURNAL_CHARS)throw new Error('Exit-cleanup journal exceeds its safe bound.');return checkedJobs(JSON.parse(raw));
 }
 const writeEncoded=raw=>database.db.prepare('INSERT INTO metadata(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(KEY,raw);
 const writeJobs=jobs=>writeEncoded(encodeJobs(jobs));
 function prepareArm(id,selected,previous){
  const owner=profile(id);if(running.has(id)||barriers.has(id))throw new Error('Complete startup cleanup recovery before arming this profile again.');const jobs=previous.filter(job=>job.profileId!==id);if(selected.enabled)jobs.push({profileId:id,partition:owner.partition,armedAt:Date.now(),choice:selected});return jobs;
 }
 function checkRestartCapacity(jobs,id,selected){
  let future=jobs;for(const candidate of getProfiles())if(!candidate.private){const owner=profile(candidate.id),next=owner.id===id?selected:choice(owner.id),previous=future.find(job=>job.profileId===owner.id);future=future.filter(job=>job.profileId!==owner.id);if(next.enabled)future.push({profileId:owner.id,partition:owner.partition,armedAt:previous?.armedAt??Date.now(),choice:next});}encodeJobs(future);
 }
 function armAll(){return database.transaction(()=>{let jobs=readJobs();for(const owner of getProfiles())if(!owner.private)jobs=prepareArm(owner.id,choice(owner.id),jobs);writeJobs(jobs);return {armed:readJobs().map(job=>job.profileId)};});}
 function status(id){profile(id);const held=barriers.get(id);return {profileId:id,choice:choice(id),pending:readJobs().some(job=>job.profileId===id)||!!(held&&(!held.completed||held.journalError)),running:running.has(id),networkBlocked:barriers.has(id),recoveryError:held?.journalError||null,scope:'Storage includes cached files. Keep rules preserve exact-origin storage/history and registrable-domain cookies. Bookmarks, downloads and current restored-tab URLs remain. Existing extension/browser UI storage is protected. Exit network barriers remain held until explicit successful startup recovery; active workers keep cleanup pending.'};}
 /** `review:false` is the Settings panel applying its own switch instantly; any other caller still gets the native confirmation. */
 async function set(id,value,options){
  const selected=cleanupChoice(value),owner=profile(id);if(running.has(id)||reviewing.has(id)||barriers.has(id))throw new Error('Complete startup cleanup recovery before changing this profile choice.');reviewing.add(id);
  try{
   const answer=options?.review===false?{response:1}:await dialog.showMessageBox(getWindow(id),{type:'warning',title:tm("cleanup.enable"),message:selected.enabled?tm("exitCleanup.clearTheseDataWhenThis"):tm("exitCleanup.stopAutomaticExitCleanupFor"),detail:tm("exitCleanup.categoriesNoneCountKeepSite", { none: selected.categories.join(', ')||'none', count: selected.keepOrigins.length }),buttons:['Cancel','Save cleanup choice'],defaultId:0,cancelId:0});
   if(answer.response!==1)return {cancelled:true};if(profile(id).partition!==owner.partition)throw new Error('The profile changed during review.');
   return database.transaction(()=>{const jobs=prepareArm(id,selected,readJobs()),encoded=encodeJobs(jobs);if(selected.enabled)checkRestartCapacity(jobs,id,selected);database.setPolicy(id,'*',{...(database.policy(id,'*')||{}),exitCleanup:selected});writeEncoded(encoded);return status(id);});
  }finally{reviewing.delete(id);}
 }
 async function protectedOrigins(session,owner){
  const inventory=await getProtectedOrigins(session,owner),values=inventory?.origins;if(inventory?.complete!==true||!Array.isArray(values)||values.length>2000||inventory.profileId!==undefined&&inventory.profileId!==owner.id)throw new Error('The complete native installed-origin inventory is unknown. Cleanup remains pending.');
  return [...new Set(['acira-browser-ui://ui',...values.map(value=>{if(typeof value!=='string'||!(/^(?:chrome-extension:\/\/[a-p]{32}|acira-browser-ui:\/\/ui)$/.test(value)))throw new Error('Invalid native internal origin.');return value;})])];
 }
 function releaseBarrier(id){const held=barriers.get(id);if(!held)return;held.dispose();held.session.cookies.off('changed',held.cookieChanged);held.session.serviceWorkers.off('running-status-changed',held.workerChanged);barriers.delete(id);}
 function rearm(held){database.transaction(()=>{const jobs=readJobs();if(!jobs.some(current=>current.profileId===held.job.profileId)){jobs.push(held.job);writeJobs(jobs);}});held.journalError=null;}
 async function holdBarrier(owner,session,job){
  let held=barriers.get(owner.id);if(held&&held.session!==session)throw new Error('The cleanup session changed while its network barrier was held.');
  if(!held){
   const pipeline=await getPipeline(owner,session);if(!pipeline||typeof pipeline.useBefore!=='function'||typeof pipeline.useHeaders!=='function'||typeof pipeline.hasActiveRequests!=='function'||typeof session.closeAllConnections!=='function'||typeof session.cookies?.on!=='function'||typeof session.cookies?.off!=='function'||typeof session.serviceWorkers?.getAllRunning!=='function'||typeof session.serviceWorkers?.on!=='function'||typeof session.serviceWorkers?.off!=='function')throw new Error('Qualified native request, cookie and worker lifecycle access is required before cleanup.');
   const fence=details=>/^(?:https?|wss?):/i.test(details.url)?{cancel:true}:{},removeBefore=pipeline.useBefore(fence),removeHeaders=pipeline.useHeaders(fence);if(typeof removeBefore!=='function'||typeof removeHeaders!=='function')throw new Error('The shared request pipeline did not return removable barriers.');
   held={session,pipeline,job,epoch:0,journalError:null,completed:false,dispose:()=>{removeBefore();removeHeaders();}};
   const invalidate=()=>{held.epoch++;if(!held.completed)return;held.completed=false;try{rearm(held);}catch(error){held.journalError=String(error.message||error);}};
   held.cookieChanged=(_event,cookie,_cause,removed)=>{if(removed||!held.job.choice.categories.includes('cookies'))return;const host=cookie.domain?.replace(/^\./,'').replace(/^\[|\]$/g,'');if(!host){invalidate();return;}try{const domain=site((cookie.secure?'https://':'http://')+(host.includes(':')?'['+host+']':host)).cookieDomain;if(!held.job.choice.keepOrigins.some(value=>site(value).cookieDomain===domain))invalidate();}catch{invalidate();}};
   held.workerChanged=details=>{if(details.runningStatus==='starting'||details.runningStatus==='running')invalidate();};
   session.cookies.on('changed',held.cookieChanged);session.serviceWorkers.on('running-status-changed',held.workerChanged);barriers.set(owner.id,held);
  }
  held.job=job;held.completed=false;await session.closeAllConnections();if(held.journalError)throw new Error('Cleanup journal could not record new background activity: '+held.journalError);return held;
 }
 function assertQuiescent(owner,session){if(profile(owner.id).partition!==owner.partition||hasLivePages(owner.id)!==false)throw new Error('The profile or its live pages changed while cleanup was running.');if(Object.keys(session.serviceWorkers.getAllRunning()).length)throw new Error('Native service workers are still active. Cleanup remains pending until every worker has stopped; registrations and unselected storage are preserved.');if(barriers.get(owner.id)?.pipeline.hasActiveRequests()!==false)throw new Error('Native network requests are still active or their lifetime is unknown. Cleanup remains pending until the shared pipeline is idle.');}
 async function runJob(job){
  const owner=profile(job.profileId);if(owner.partition!==job.partition)throw new Error('Pending cleanup does not match the actual profile partition.');if(running.has(owner.id)||reviewing.has(owner.id)||hasLivePages(owner.id)!==false)throw new Error('Close every website page for this profile before cleanup.');running.add(owner.id);
  try{
   const session=await getSession(owner),barrier=await holdBarrier(owner,session,job);assertQuiescent(owner,session);const activityEpoch=barrier.epoch,internal=await protectedOrigins(session,owner),excludeOrigins=[...job.choice.keepOrigins,...internal],results=[],keep=new Set(job.choice.keepOrigins),keptCookieDomains=new Set(job.choice.keepOrigins.map(value=>site(value).cookieDomain));assertQuiescent(owner,session);
   if(job.choice.categories.includes('cookies')){
    let revoked=false,deleted=false,recoveryCompleted=false;
    try{
     if(!cookieRestore?.flush||!cookieRestore.clear||!cookieRestore.completeClear)throw new Error('Qualified session-cookie recovery is required before exit cookie deletion.');await cookieRestore.flush();assertQuiescent(owner,session);
     if(!job.choice.keepOrigins.length){revoked=true;cookieRestore.clear(session);}
     else{const cookies=await session.cookies.get({}),domains=new Map();for(const cookie of cookies){const host=cookie.domain.replace(/^\./,'').replace(/^\[|\]$/g,'');const url=(cookie.secure?'https://':'http://')+(host.includes(':')?'['+host+']':host),domain=site(url).cookieDomain;if(!keptCookieDomains.has(domain))domains.set(domain,url);}for(const [registrableDomain,url]of domains){revoked=true;cookieRestore.clear(session,{origin:url,registrableDomain});}}
     await session.clearData({dataTypes:['cookies'],excludeOrigins,originMatchingMode:'origin-in-all-contexts'});deleted=true;assertQuiescent(owner,session);if(revoked)await cookieRestore.completeClear(session);recoveryCompleted=true;results.push({category:'cookies',status:'cleared',keepCookieDomains:[...keptCookieDomains]});
    }catch(error){results.push({category:'cookies',status:'failed',error:String(error.message||error),nativeDeletionCompleted:deleted,recoveryPaused:revoked?!recoveryCompleted:null});}
   }
   if(job.choice.categories.includes('storage'))try{assertQuiescent(owner,session);await session.clearData({dataTypes:['fileSystems','indexedDB','localStorage','serviceWorkers','backgroundFetch','cache'],excludeOrigins,originMatchingMode:'origin-in-all-contexts'});results.push({category:'storage',status:'cleared',includesCachedFiles:true});}catch(error){results.push({category:'storage',status:'failed',error:String(error.message||error)});}
   if(job.choice.categories.includes('permissions'))try{let count=0;for(const row of permissions.list(owner.id))if(!keep.has(row.requester)||!keep.has(row.embedder)){permissions.reset(owner.id,row.requester,row.embedder,row.permission);count++;}results.push({category:'permissions',status:'cleared',count});}catch(error){results.push({category:'permissions',status:'failed',error:String(error.message||error)});}
   if(job.choice.categories.includes('history'))try{const changed=await commitRecords({profileId:owner.id,keepOrigins:job.choice.keepOrigins});results.push({category:'history',status:'cleared',counts:changed.counts,filesDeleted:false});}catch(error){results.push({category:'history',status:'failed',error:String(error.message||error)});}
   assertQuiescent(owner,session);if(barrier.journalError)throw new Error('Cleanup journal could not record new background activity: '+barrier.journalError);if(activityEpoch!==barrier.epoch)throw new Error('Background activity changed during deletion; cleanup remains pending.');
   const completed=results.every(result=>result.status==='cleared');if(completed){database.transaction(()=>writeJobs(readJobs().filter(current=>current.profileId!==job.profileId||current.armedAt!==job.armedAt)));barrier.completed=true;}
   return {profileId:owner.id,completed,pending:!completed,networkBlocked:true,results,filesDeleted:false};
  }finally{running.delete(owner.id);}
 }
 async function runPending({phase='exit'}={}){
  if(!['exit','startup'].includes(phase))throw new Error('Choose startup recovery or final exit cleanup.');if(pendingRun)throw new Error('An app-level cleanup pass is already running.');pendingRun=true;
  try{const results=[];for(const held of barriers.values())if(held.journalError)try{rearm(held);}catch(error){held.journalError=String(error.message||error);results.push({profileId:held.job.profileId,completed:false,pending:true,networkBlocked:true,error:held.journalError});}for(const job of readJobs())try{results.push(await runJob(job));}catch(error){results.push({profileId:job.profileId,completed:false,pending:true,networkBlocked:barriers.has(job.profileId),error:String(error.message||error)});}const pending=new Set(readJobs().map(job=>job.profileId));if(phase==='startup')for(const [id,held]of barriers)if(!pending.has(id)&&held.completed&&!held.journalError)releaseBarrier(id);return {completed:results.every(result=>result.completed)&&pending.size===0&&![...barriers.values()].some(held=>held.journalError),profiles:results};}finally{pendingRun=false;}
 }
 return {status,set,armAll,runPending};
}
module.exports={createExitCleanup,cleanupChoice,clearExitRecords,clearStoredExitRecords,commitExitRecords};
