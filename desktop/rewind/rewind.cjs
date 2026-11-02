'use strict';
const { t } = require('../browser-services/tx.cjs');
// Rewind (REWIND_SPEC): bounded, profile-scoped structural checkpoints of tab/group arrangement, captured before batch
// closes, on window close, every 15 minutes when the structure changed, and on demand. Restore is additive: fresh lazy
// tabs, deduplicated against what is open, never overwriting current work. Private windows never reach this module.
// Storage: one small JSON file per checkpoint under <userData>/rewind/<profileId>/ (a corrupt file isolates one row).
// The closed-tab log (closed-log.cjs, R3-39) sits beside them: one record per closed tab, so the page can list tabs, not snapshots.
const fs=require('node:fs');
const path=require('node:path');
const model=require('./checkpoint-model.cjs');
const closedModel=require('./closed-log.cjs');
const {createRoutines}=require('./routines.cjs');
const DAY=86400000;
const LIMITS={perProfile:500,totalBytes:50*1024*1024,maxCheckpoint:2*1024*1024,batchMs:1600,periodicMs:15*60*1000,idleMs:20*1000,tickMs:60*1000};
const DAYS=[1,3,7];
/** This run of the browser: moments carry it so the page can show them by session and window. */
const SESSION=Date.now().toString(36);
const safeId=id=>typeof id==='string'&&/^[A-Za-z0-9_.:-]{1,120}$/.test(id);
const fail=message=>{throw new Error(message);};

function createRewind({dir,now=Date.now,limits={},timers={setTimeout,clearTimeout,setInterval,clearInterval},openWindow=null,shortcuts=null}={}){
 const L={...LIMITS,...limits};
 const profiles=new Map();// profileId -> Map(id -> {checkpoint,bytes})
 const epochs=new Map(),windows=new Map(),pending=new Map(),receipts=new Map(),closedWindows=new Map(),undoable=new Map(),closeBatches=new Map();let routines=null,quiet=null,reopenCount=0;
 const routineService=()=>routines??=createRoutines({dir:path.join(dir,'..','routines'),shortcuts});
 const closedLog=closedModel.createClosedLog({dir,now,timers});
 let settings=readSettings();
 function readSettings(){try{const raw=JSON.parse(fs.readFileSync(path.join(dir,'settings.json'),'utf8'));return {enabled:raw.enabled!==false,days:DAYS.includes(raw.days)?raw.days:7};}catch{return {enabled:true,days:7};}}
 function writeAtomic(file,text){fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=`${file}.${process.pid}.tmp`;fs.writeFileSync(tmp,text);fs.renameSync(tmp,file);}
 const profileDir=id=>path.join(dir,id);
 const epoch=id=>epochs.get(id)||0;
 const bump=id=>epochs.set(id,epoch(id)+1);
 function load(profileId){
  if(profiles.has(profileId))return profiles.get(profileId);
  const rows=new Map();profiles.set(profileId,rows);
  let names=[];try{names=fs.readdirSync(profileDir(profileId)).filter(name=>/^cp-[a-z0-9]+-[0-9a-f]{8}\.json$/.test(name));}catch{}
  for(const name of names){const file=path.join(profileDir(profileId),name);try{const text=fs.readFileSync(file,'utf8');const checkpoint=model.readCheckpoint(JSON.parse(text),profileId);if(checkpoint&&`${checkpoint.id}.json`===name)rows.set(checkpoint.id,{checkpoint,bytes:Buffer.byteLength(text)});else fs.rmSync(file,{force:true});}catch{try{fs.rmSync(file,{force:true});}catch{}}}
  prune(profileId);return rows;
 }
 function remove(profileId,id){const rows=load(profileId);rows.delete(id);try{fs.rmSync(path.join(profileDir(profileId),`${id}.json`),{force:true});}catch{}}
 /** Age, per-profile count and application-wide bytes, whichever evicts first (oldest first). */
 function prune(profileId){
  const rows=profiles.get(profileId);if(!rows)return;const cutoff=now()-settings.days*DAY;
  for(const [id,row] of [...rows])if(row.checkpoint.createdAt<=cutoff&&row.checkpoint.kept!==true)remove(profileId,id);
  // Kept moments skip age expiry; under the count and byte caps they go last.
  const evictFirst=(a,b)=>(a.checkpoint.kept===true)-(b.checkpoint.kept===true)||a.checkpoint.createdAt-b.checkpoint.createdAt;
  const ordered=[...rows.values()].sort(evictFirst);
  while(ordered.length>L.perProfile)remove(profileId,ordered.shift().checkpoint.id);
  let total=[...profiles.values()].flatMap(map=>[...map.values()]).reduce((sum,row)=>sum+row.bytes,0);
  const all=[...profiles.entries()].flatMap(([owner,map])=>[...map.values()].map(row=>({owner,row}))).sort((a,b)=>evictFirst(a.row,b.row));
  while(total>L.totalBytes&&all.length){const {owner,row}=all.shift();total-=row.bytes;remove(owner,row.checkpoint.id);}
 }
 const latest=(profileId,windowId)=>[...load(profileId).values()].map(row=>row.checkpoint).filter(c=>!windowId||c.sourceWindowId===String(windowId)).sort((a,b)=>b.createdAt-a.createdAt)[0];
 /** Project -> size/eligibility -> dedupe -> durable write. Returns {ok,checkpoint} or {ok:false,code}. */
 function capture(state,{windowId,reason,label='',expectEpoch,force=false}={}){
  if(!settings.enabled&&!force)return {ok:false,code:'disabled'};
  const profileId=state?.activeBrowserProfileId;if(!safeId(profileId))return {ok:false,code:'no-profile'};
  if(expectEpoch!==undefined&&expectEpoch!==epoch(profileId))return {ok:false,code:'stale'};
  const payload=model.project(state,profileId);if(!payload)return {ok:false,code:'empty'};
  const hash=model.payloadHash(payload),last=latest(profileId,windowId);
  if(!force&&last&&last.payloadHash===hash)return {ok:true,checkpoint:last,deduped:true};
  const checkpoint=model.makeCheckpoint({payload,profileId,windowId,sessionId:SESSION,reason,label,epoch:epoch(profileId),now});
  const text=JSON.stringify(checkpoint);if(Buffer.byteLength(text)>L.maxCheckpoint)return {ok:false,code:'too-large'};
  try{writeAtomic(path.join(profileDir(profileId),`${checkpoint.id}.json`),text);}catch{return {ok:false,code:'write-failed'};}
  load(profileId).set(checkpoint.id,{checkpoint,bytes:Buffer.byteLength(text)});prune(profileId);
  return {ok:true,checkpoint};
 }
 /** Removes matching tabs from every checkpoint of a profile; empty checkpoints go away. */
 function purge(profileId,match,{keepEpoch=false}={}){
  if(!safeId(profileId))return 0;if(!keepEpoch)bump(profileId);let changed=closedLog.purge(profileId,match);
  for(const [id,row] of [...load(profileId)]){
   const tabs=row.checkpoint.tabs.filter(tab=>!match(tab.url));if(tabs.length===row.checkpoint.tabs.length)continue;changed++;
   if(!tabs.length){remove(profileId,id);continue;}
   const used=new Set(tabs.map(t=>t.groupRef)),refs=new Set(tabs.map(t=>t.ref)),checkpoint={...row.checkpoint,tabs,groups:row.checkpoint.groups.filter(g=>used.has(g.ref)),splits:(row.checkpoint.splits||[]).filter(split=>split.tabRefs.every(ref=>refs.has(ref)))};
   const text=JSON.stringify(checkpoint);try{writeAtomic(path.join(profileDir(profileId),`${id}.json`),text);row.checkpoint=checkpoint;row.bytes=Buffer.byteLength(text);}catch{remove(profileId,id);}
  }
  return changed;
 }
 function removeProfile(profileId){if(!safeId(profileId))return;bump(profileId);closedLog.removeProfile(profileId);profiles.delete(profileId);try{fs.rmSync(profileDir(profileId),{recursive:true,force:true});}catch{}for(const [key,value] of pending)if(value.profileId===profileId){timers.clearTimeout(value.timer);pending.delete(key);}}
 function deleteSince(profileId,since){if(!safeId(profileId))return;bump(profileId);closedLog.deleteSince(profileId,since);for(const [id,row] of [...load(profileId)])if(row.checkpoint.createdAt>=since)remove(profileId,id);}
 function flush(windowId){
  const batch=pending.get(windowId);if(!batch)return;pending.delete(windowId);timers.clearTimeout(batch.timer);
  if(batch.closed<2)return;
  const after=windows.get(windowId)?.state,closed=batch.before.tabs.filter(tab=>!after?.tabs.some(item=>item.id===tab.id));
  const groupNames=new Set(closed.map(tab=>tab.group||''));const group=groupNames.size===1?[...groupNames][0]:'';
  const groupGone=group&&!after?.tabs.some(tab=>tab.group===group&&tab.browserProfileId===batch.profileId);
  capture(batch.before,{windowId,reason:groupGone?'group-close':'tabs-close',label:groupGone?group:`${closed.length} tabs closed`,expectEpoch:batch.epoch});
 }
 /** Called by main after every committed action of a normal window. */
 function observe(windowId,previous,next,action){
  windows.set(windowId,{state:next,changedAt:now(),lastPeriodic:windows.get(windowId)?.lastPeriodic||now()});
  // Deletion is authoritative (REWIND_SPEC §8): history removal reaches checkpoints too.
  if(action?.type==='history.clear'){const owner=previous.activeBrowserProfileId,since=typeof action.since==='number'?action.since:0;deleteSince(owner,since);const gone=removedUrls(previous,next,owner);if(gone.size)purge(owner,url=>gone.has(model.canonical(url)));}
  else if(typeof action?.type==='string'&&action.type.startsWith('history.')){for(const owner of new Set((previous.browsingHistory||[]).map(v=>v.browserProfileId)))if(owner){const gone=removedUrls(previous,next,owner);if(gone.size)purge(owner,url=>gone.has(model.canonical(url)));}}
  const vanished=(previous.browserProfiles||[]).filter(p=>!p.private&&!(next.browserProfiles||[]).some(q=>q.id===p.id));
  if(vanished.length&&(next.browserProfiles||[]).length)for(const profile of vanished)removeProfile(profile.id);
  if(action?.type==='window.reopen'&&typeof action.id==='string')void reopenWindow(action.id).catch(()=>{});
  // Closing the tabs a restore just made (its Undo) is not a new moment to save.
  // Deleting a workspace closes all its tabs at once (R3-57): that is a moment to keep too, alongside the toast's Undo.
  if((action?.type==='tab.close'||action?.type==='workspace.delete')&&settings.enabled&&quiet!==windowId){
   if(action.type==='workspace.delete'){const kept=new Set((next.tabs||[]).map(item=>item.id));for(const tab of previous.tabs||[])if(!kept.has(tab.id))logClosedTab(windowId,previous,next,{id:tab.id});}
   else logClosedTab(windowId,previous,next,action);
   let batch=pending.get(windowId);
   if(!batch){batch={before:previous,closed:0,epoch:epoch(previous.activeBrowserProfileId),profileId:previous.activeBrowserProfileId,timer:null};pending.set(windowId,batch);}
   batch.closed+=action.type==='workspace.delete'?Math.max(1,previous.tabs.length-next.tabs.length):1;timers.clearTimeout(batch.timer);batch.timer=timers.setTimeout(()=>flush(windowId),L.batchMs);
  }
 }
 /** Single-tab close: the tab goes into the closed-tab log (a close within batchMs of another in the same window shares its batch, so a
  *  group closed tab by tab is still one group). Private, Tor and ineligible tabs are filtered by entryFromTab. */
 function logClosedTab(windowId,previous,next,action){
  const tab=(previous.tabs||[]).find(item=>item.id===action.id);if(!tab||(next.tabs||[]).some(item=>item.id===tab.id))return;
  const at=now(),last=closeBatches.get(windowId),batch=last&&at-last.at<L.batchMs?last.id:`b${at.toString(36)}${Math.random().toString(36).slice(2,6)}`;
  const entry=closedModel.entryFromTab(previous,tab,{windowId,batch});if(!entry)return;
  closeBatches.set(windowId,{id:batch,at});while(closeBatches.size>20)closeBatches.delete(closeBatches.keys().next().value);
  if(safeId(tab.browserProfileId))closedLog.record(tab.browserProfileId,[entry],settings.days);
 }
 function removedUrls(previous,next,owner){
  const kept=new Set((next.browsingHistory||[]).filter(v=>v.browserProfileId===owner).map(v=>v.id));
  return new Set((previous.browsingHistory||[]).filter(v=>v.browserProfileId===owner&&!kept.has(v.id)).map(v=>model.canonical(v.url)));
 }
 /** A closing window's arrangement: written to Rewind when it is on, and kept in memory (bounded) for "Window closed · Undo". */
 function windowClosed(windowId,state){
  flush(windowId);windows.delete(windowId);closedLog.flush();if(!state)return null;
  const result=capture(state,{windowId,reason:'window-close',label:''}),profileId=state.activeBrowserProfileId;
  let checkpoint=result.checkpoint;
  if(!checkpoint&&result.code==='disabled'){const payload=model.project(state,profileId);if(payload)checkpoint=model.makeCheckpoint({payload,profileId,windowId,reason:'window-close',label:'',epoch:epoch(profileId),now});}
  if(checkpoint){closedWindows.set(String(windowId),{checkpoint,profileId,at:now()});while(closedWindows.size>10)closedWindows.delete(closedWindows.keys().next().value);}
  return result;
 }
 /** After the window is gone: offer Undo in a surviving ordinary window (same profile first). Quitting never gets here. */
 function windowGone(windowId,controllers){
  const entry=closedWindows.get(String(windowId));if(!entry)return false;
  const alive=controllers.filter(c=>!c.privateMode&&!c.closing&&c.window&&!c.window.isDestroyed?.());
  const survivor=alive.find(c=>c.profileId===entry.profileId)||alive[0];if(!survivor){closedWindows.delete(String(windowId));return false;}
  survivor.commitAction({type:'window.closed.toast',id:String(windowId),count:entry.checkpoint.tabs.length});return true;
 }
 async function reopenWindow(windowId){
  const entry=closedWindows.get(String(windowId));if(!entry||!openWindow)return null;closedWindows.delete(String(windowId));
  if(entry.checkpoint.privacyEpoch!==epoch(entry.profileId))return null;// history was deleted since: do not resurrect
  return openInWindow(entry.checkpoint,entry.checkpoint.tabs.map(t=>t.ref),entry.profileId);
 }
 /** A new ordinary window holding these tabs of a moment, in their order and groups; the moment's active tab is selected. */
 async function openInWindow(checkpoint,refs,profileId){
  if(!openWindow)return {ok:false,code:'unavailable',message:t('rewind.main.noWindow')};
  const wanted=new Set(refs),tabs=[...checkpoint.tabs].sort((a,b)=>a.order-b.order).filter(t=>wanted.has(t.ref)&&model.eligibleUrl(t.url));
  if(!tabs.length)return {ok:true,restored:0,skipped:[],groups:[]};
  const controller=openWindow({profileId,initialURL:tabs[0].url});if(!await controller?.ready)return {ok:false,code:'failed',message:t('rewind.main.windowFailed')};
  const ctx={windowId:controller.windowId,privateMode:false,state:()=>controller.state,dispatch:a=>controller.commitAction(a)};
  const result=restoreCheckpoint(checkpoint,tabs.map(t=>t.ref),ctx,{adoptOpen:true,splits:true});
  const active=tabs.find(t=>t.active)||tabs[0],id=active&&result.byRef?.get(active.ref);if(id)ctx.dispatch({type:'tab.select',id});
  return {...result,restored:tabs.length,window:true};
 }
 const closedProfiles=()=>{try{return fs.readdirSync(dir,{withFileTypes:true}).filter(item=>item.isDirectory()&&safeId(item.name)).map(item=>item.name);}catch{return [];}};
 function tick(){
  if(!settings.enabled)return;const t=now();
  for(const [windowId,item] of windows){if(t-item.lastPeriodic<L.periodicMs||t-item.changedAt<L.idleMs||pending.has(windowId))continue;item.lastPeriodic=t;capture(item.state,{windowId,reason:'periodic'});}
  for(const profileId of profiles.keys())prune(profileId);
  for(const profileId of new Set([...profiles.keys(),...closedProfiles()]))closedLog.prune(profileId,settings.days);
 }
 const flushLog=()=>closedLog.flush();process.on('exit',flushLog);// a close just before quitting is written even inside the write delay
 const interval=timers.setInterval(tick,L.tickMs);interval?.unref?.();
 // --- trusted UI requests (window.acira.rewind) -------------------------------------------------------------------
 const exact=(request,allowed)=>{for(const key of Object.keys(request))if(key!=='type'&&!allowed.includes(key))fail('Unexpected Rewind request field.');};
 const cpId=value=>{if(typeof value!=='string'||!/^cp-[a-z0-9]+-[0-9a-f]{8}$/.test(value))fail('Unknown saved moment.');return value;};
 const view=()=>({enabled:settings.enabled,days:settings.days});
 /** Newest first. With the live state each row says how much of it isn't open; with a query only matching moments come back, with hit counts.
  *  Each row also says what changed since the previous moment of the same window in the same session. */
 function list(profileId,{state=null,query=''}={}){
  const rows=[...load(profileId).values()].map(row=>row.checkpoint).sort((a,b)=>a.createdAt-b.createdAt),previous=new Map(),out=[];
  for(const checkpoint of rows){
   const key=`${checkpoint.sessionId}|${checkpoint.sourceWindowId}`,before=previous.get(key);previous.set(key,checkpoint);
   const summary=model.summary(checkpoint,{days:settings.days,now,state,profileId});if(summary.expired)continue;
   const found=model.matches(checkpoint,query);if(!found.any)continue;
   out.push({...summary,hits:found.hits,...(before?model.diff(before,checkpoint):{added:checkpoint.tabs.length,removed:0}),first:!before});
  }
  return out.reverse();
 }
 const listView=(profileId,state,query='')=>({...view(),session:SESSION,closedTabs:closedLog.count(profileId),checkpoints:list(profileId,{state,query})});
 function restore(request,ctx){
  const state=ctx.state(),profileId=state.activeBrowserProfileId,row=load(profileId).get(cpId(request.id));
  if(!row)return {ok:false,code:'unavailable',message:t('rewind.main.momentGone')};
  // `all` is every tab of the moment (a window card's "Restore window" does not need its tab list first).
  const refs=request.all===true?row.checkpoint.tabs.map(tab=>tab.ref):request.refs;
  if(!Array.isArray(refs)||!refs.length||refs.length>2000||!refs.every(ref=>typeof ref==='string'&&/^t\d{1,5}$/.test(ref)))fail('Choose tabs to restore.');
  if(request.newWindow===true)return openInWindow(row.checkpoint,refs,profileId);
  const result=restoreCheckpoint(row.checkpoint,refs,ctx);
  // Undo takes back exactly the tabs this restore made, in this window, while they are still open.
  if(result.ok&&result.tabIds?.length){const token=`u${now().toString(36)}${Math.random().toString(36).slice(2,8)}`;undoable.set(token,{windowId:ctx.windowId,tabIds:result.tabIds,at:now()});while(undoable.size>20)undoable.delete(undoable.keys().next().value);result.token=token;}
  return result;
 }
 function undo(request,ctx){
  if(typeof request.token!=='string'||!/^u[a-z0-9]{4,24}$/.test(request.token))fail('Nothing to undo.');
  const batch=undoable.get(request.token);if(!batch||batch.windowId!==ctx.windowId)return {ok:false,code:'unavailable',message:t('rewind.main.undoGone')};
  undoable.delete(request.token);
  const open=batch.tabIds.filter(id=>ctx.state().tabs.some(t=>t.id===id));
  quiet=ctx.windowId;try{for(const id of open)ctx.dispatch({type:'tab.close',id});}finally{quiet=null;}
  // Say it happened (it replaces the closed-tabs toast those closes raised: this was an undo, not a close).
  if(open.length)ctx.dispatch({type:'toast',text:t('rewind.main.restoreUndone'),tone:'status',icon:'check'});
  return {ok:true,closed:open.length};
 }
 /** Additive restore into ctx's window. adoptOpen: tabs already open there join their restored group (window reopen). */
 function restoreCheckpoint(checkpoint,refs,ctx,{adoptOpen=false,splits=false}={}){
  const state=ctx.state(),profileId=state.activeBrowserProfileId;
  if(checkpoint.ownerProfileId!==profileId)return {ok:false,code:'unavailable',message:t('rewind.main.otherProfile')};
  const wanted=new Set(refs),marked=model.markOpen(checkpoint,state,profileId);
  const skipped=[],chosen=[],adopted=new Map(),taken=new Set();
  for(const tab of marked){if(!wanted.has(tab.ref))continue;if(adoptOpen&&tab.open){const match=state.tabs.find(t=>t.browserProfileId===profileId&&!taken.has(t.id)&&model.canonical(t.url)===model.canonical(tab.url));if(match){taken.add(match.id);adopted.set(tab.ref,match.id);chosen.push(tab);continue;}}const receipt=receipts.get(`${checkpoint.id}:${tab.ref}`);if(receipt&&state.tabs.some(t=>t.id===receipt)){skipped.push({title:tab.title,reason:'already-restored'});continue;}if(tab.open){skipped.push({title:tab.title,reason:'already-open'});continue;}if(!model.eligibleUrl(tab.url)){skipped.push({title:tab.title,reason:'unsupported'});continue;}chosen.push(tab);}
  if(!chosen.length)return {ok:true,restored:0,skipped,groups:[]};
  const created=new Map();
  for(const tab of chosen){if(adopted.has(tab.ref))continue;
   // Back into the workspace the tab came from (R3-57), when it still exists; else the one on screen.
   const home=tab.workspace&&ctx.state().workspaces?.some(w=>w.id===tab.workspace&&w.browserProfileId===profileId)?tab.workspace:null;
   const before=new Set(ctx.state().tabs.map(t=>t.id));ctx.dispatch({type:'tab.new',url:tab.url,background:true,lazy:true,browserProfileId:profileId,...(home?{workspaceId:home}:{})});
   const fresh=ctx.state().tabs.find(t=>!before.has(t.id));if(!fresh)continue;created.set(tab.ref,fresh.id);receipts.set(`${checkpoint.id}:${tab.ref}`,fresh.id);
   if(tab.title)ctx.dispatch({type:'tab.update',id:fresh.id,patch:{title:tab.title}});
   if(tab.pinned)ctx.dispatch({type:'tab.pin',id:fresh.id});
  }
  while(receipts.size>2000)receipts.delete(receipts.keys().next().value);
  const groups=[];
  for(const group of checkpoint.groups){
   const byRef=ref=>created.get(ref)||adopted.get(ref),members=chosen.filter(t=>t.groupRef===group.ref&&byRef(t.ref)).map(t=>byRef(t.ref));if(!members.length)continue;
   // A group that only closed tabs still reference is invisible to the user: bring it back under its own name.
   // Groups belong to a workspace (R3-57): look in the one these tabs are in.
   const spaces=ctx.state().workspaces?.filter(w=>w.browserProfileId===profileId)||[],spaceOf=item=>item.workspaceId&&spaces.some(w=>w.id===item.workspaceId)?item.workspaceId:spaces[0]?.id||null,target=spaceOf(ctx.state().tabs.find(t=>t.id===members[0])||{});
   const live=name=>ctx.state().tabs.some(t=>t.browserProfileId===profileId&&spaceOf(t)===target&&t.group===name&&!members.includes(t.id));
   const dormant=ctx.state().tabGroups.find(g=>g.browserProfileId===profileId&&spaceOf(g)===target&&g.name===group.name&&!live(g.name));
   if(dormant){ctx.dispatch({type:'tab.group.assign',tabIds:members,groupId:dormant.id});ctx.dispatch({type:'tab.group.update',id:dormant.id,patch:{color:group.color,collapsed:false}});groups.push(group.name);continue;}
   let name=live(group.name)?`${group.name} · Recovered`.slice(0,64):group.name;
   while(ctx.state().tabGroups.some(g=>g.browserProfileId===profileId&&spaceOf(g)===target&&g.name===name))name=`${name}′`.slice(0,64);
   ctx.dispatch({type:'tab.group.create',tabId:members[0],name,color:group.color});
   const made=ctx.state().tabGroups.find(g=>g.browserProfileId===profileId&&spaceOf(g)===target&&g.name===name);if(made&&members.length>1)ctx.dispatch({type:'tab.group.assign',tabIds:members,groupId:made.id});
   groups.push(name);
  }
  // A split comes back whole, or not at all: every pane must be a live tab (restored now or already open). The first pane is selected,
  // because a split always includes the tab you are on. Only asked for by "restore with its split" and by a new window.
  let split=false;
  if(splits)for(const item of checkpoint.splits||[]){
   const members=item.tabRefs.map(ref=>marked.find(t=>t.ref===ref)),ids=members.map(tab=>tab&&(created.get(tab.ref)||adopted.get(tab.ref)||ctx.state().tabs.find(t=>t.browserProfileId===profileId&&model.canonical(t.url)===model.canonical(tab.url))?.id));
   if(ids.some(id=>!id)||!members.some(tab=>created.has(tab.ref)||adopted.has(tab.ref)))continue;
   ctx.dispatch({type:'tab.select',id:ids[0]});ctx.dispatch({type:'split.open',tabIds:ids,layout:item.layout});split=ctx.state().windowUi?.split?.tabIds?.includes(ids[0])||split;
  }
  // The Rewind page reports the result itself (bible §4: no toast for what the UI already shows).
  return {ok:true,restored:created.size,skipped,groups,split,tabIds:[...created.values()],byRef:new Map([...adopted,...created])};
 }
 // --- the closed-tab view -----------------------------------------------------------------------------------------------------
 /** Closed tabs, newest first, the same page once, none that are open now. groupSize says how many of a group closed together are still closed. */
 function tabsView(profileId,state,{query='',limit=500}={}){
  const all=closedLog.list(profileId,{state,days:settings.days,limit:1000}).entries,sizes=new Map();
  for(const entry of all)if(entry.group&&entry.batch){const key=`${entry.batch}|${entry.group}`;sizes.set(key,(sizes.get(key)||0)+1);}
  const shown=all.filter(entry=>closedModel.matchesEntry(entry,query));
  return {total:shown.length,tabs:shown.slice(0,limit).map(entry=>({id:entry.id,url:entry.url,title:entry.title,closedAt:entry.closedAt,group:entry.group||null,groupColor:entry.groupColor,pinned:entry.pinned,
   split:entry.split||null,groupSize:entry.group&&entry.batch?sizes.get(`${entry.batch}|${entry.group}`):1,kept:entry.kept}))};
 }
 /** One card per window as it last was (this run's window id + session), with its earlier saved states folded under it. Windows that are open
  *  now are left out, except this one when it has tabs to bring back. */
 function windowsView(profileId,state,ctx,query=''){
  const liveIds=new Set([...windows.keys()].map(String)),mine=String(ctx.windowId||''),groups=new Map(),cards=[];
  for(const row of load(profileId).values()){const c=row.checkpoint,key=`${c.sessionId||''}|${c.sourceWindowId}`;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(c);}
  for(const [key,list] of groups){
   list.sort((a,b)=>b.createdAt-a.createdAt);
   const latest=list[0],live=latest.sessionId===SESSION&&liveIds.has(latest.sourceWindowId),current=live&&latest.sourceWindowId===mine;
   if(live&&!current)continue;
   const summary=model.summary(latest,{days:settings.days,now,state,profileId});if(summary.expired)continue;
   const found=model.matches(latest,query);if(!found.any||(current&&!summary.closed))continue;
   const earlier=list.slice(1).map(c=>model.summary(c,{days:settings.days,now,state,profileId})).filter(item=>!item.expired);
   cards.push({key,...summary,hits:found.hits,closedWindow:latest.reason==='window-close',current,earlierCount:earlier.length,
    earlier:earlier.slice(0,12).map(item=>({id:item.id,createdAt:item.createdAt,reason:item.reason,label:item.label,tabCount:item.tabCount,missing:item.closed,kept:item.kept}))});
  }
  cards.sort((a,b)=>b.createdAt-a.createdAt);
  return {current:mine,windows:cards};
 }
 /** A reopened tab that was a split pane: its partners are the tabs open now at those addresses (same profile and workspace). When they are the
  *  rest of its split, or no split any more, `split.rejoin` puts it back at its slot, linked again when it was a linked copy, with the old layout
  *  when every pane is back (splitGroups.ts, the path Undo takes). Returns whether any tab is in its split now. */
 function rejoinSplits(ctx,profileId,items){
  let joined=false;
  for(const {entry,tabId} of items){
   const info=entry.split,own=ctx.state().tabs.find(tab=>tab.id===tabId);if(!own)continue;
   const found=info.partners.map(partner=>ctx.state().tabs.find(tab=>tab.id!==tabId&&tab.browserProfileId===profileId&&!tab.privacy&&(tab.workspaceId??'')===(own.workspaceId??'')&&model.canonical(tab.url)===model.canonical(partner.url)));
   const open=found.filter(Boolean);if(!open.length)continue;
   const linked=[...(info.linked?[tabId]:[]),...found.flatMap((tab,at)=>tab&&info.partners[at].linked?[tab.id]:[])];
   ctx.dispatch({type:'split.rejoin',tabId,partners:open.map(tab=>tab.id),slot:found.slice(0,info.slot).filter(Boolean).length,...(open.length===found.length?{layout:info.layout}:{}),...(linked.length?{linked}:{})});
   if((ctx.state().windowUi?.splitGroups||[]).some(group=>group.tabIds.includes(tabId)))joined=true;
  }
  return joined;
 }
 /** Brings closed tabs back (background tabs, old group, never replacing anything open). With unit, a group closed together returns together and a
  *  split returns as a split; with newWindow, they open in a fresh window. Same Undo token as a moment's restore. */
 function reopen(request,ctx){
  const state=ctx.state(),profileId=state.activeBrowserProfileId;
  if(!Array.isArray(request.ids)||!request.ids.length||request.ids.length>200||!request.ids.every(closedModel.isId))fail('Choose tabs to reopen.');
  for(const key of ['newWindow','unit'])if(key in request&&typeof request[key]!=='boolean')fail('New window and group must be true or false.');
  const chosen=[...new Set(request.ids)].map(id=>closedLog.get(profileId,id)).filter(Boolean);
  if(!chosen.length)return {ok:false,code:'unavailable',message:t('rewind.main.tabGone')};
  const entries=new Map(),ordered=[];
  if(request.unit){
   const all=closedLog.list(profileId,{state,days:settings.days,limit:1000}).entries;
   for(const entry of chosen){entries.set(entry.id,entry);if(entry.group&&entry.batch)for(const mate of all)if(mate.batch===entry.batch&&mate.group===entry.group)entries.set(mate.id,mate);}
   const place=new Map(closedLog.load(profileId).map((entry,at)=>[entry.id,at]));// the log is newest first: the oldest close comes back first
   ordered.push(...[...entries.values()].sort((a,b)=>place.get(b.id)-place.get(a.id)));
  }else ordered.push(...chosen);
  const groups=[],groupRef=new Map(),tabs=[],refOfKey=new Map();
  const add=entry=>{
   const key=closedModel.keyOf(entry.url);if(refOfKey.has(key))return refOfKey.get(key);
   let ref=null;if(entry.group&&!entry.pinned){if(!groupRef.has(entry.group)){groupRef.set(entry.group,`g${groups.length}`);groups.push({ref:`g${groups.length}`,name:entry.group,color:entry.groupColor||'none',order:groups.length,collapsed:false});}ref=groupRef.get(entry.group);}
   const tabRef=`t${tabs.length}`;tabs.push({ref:tabRef,groupRef:ref,order:tabs.length,title:entry.title,url:entry.url,pinned:entry.pinned,active:false});refOfKey.set(key,tabRef);return tabRef;
  };
  for(const entry of ordered)add(entry);
  const splits=[],lead=request.unit?chosen.find(entry=>entry.split):null;
  if(lead){const members=[add(lead),...lead.split.partners.map(partner=>add({url:partner.url,title:partner.title,group:'',pinned:false}))];if(members.length>=2&&members.length<=4)splits.push({tabRefs:members,layout:lead.split.layout});}
  const checkpoint={id:`closed-${++reopenCount}`,ownerProfileId:profileId,groups,tabs,splits},refs=tabs.map(tab=>tab.ref);
  if(request.newWindow===true)return openInWindow(checkpoint,refs,profileId);
  const result=restoreCheckpoint(checkpoint,refs,ctx,{splits:splits.length>0});
  // A reopened split pane goes back into its split at its slot (Undo's path), unless this reopen already rebuilt the whole split.
  if(result.ok&&!result.split&&result.tabIds?.length){
   const back=ordered.map(entry=>({entry,tabId:result.byRef?.get(refOfKey.get(closedModel.keyOf(entry.url)))})).filter(item=>item.entry.split&&item.tabId&&result.tabIds.includes(item.tabId));
   if(rejoinSplits(ctx,profileId,back))result.split=true;
  }
  if(result.ok&&result.tabIds?.length){const token=`u${now().toString(36)}${Math.random().toString(36).slice(2,8)}`;undoable.set(token,{windowId:ctx.windowId,tabIds:result.tabIds,at:now()});while(undoable.size>20)undoable.delete(undoable.keys().next().value);result.token=token;}
  return result;
 }
 function handle(request,ctx){
  if(!request||typeof request!=='object'||Array.isArray(request)||typeof request.type!=='string'||JSON.stringify(request).length>72*1024)fail('Invalid Rewind request.');
  // Routines share this trusted channel (same window context, same sender check in main).
  if(request.type.startsWith('routines.'))return routineService().handle(request,ctx);
  if(ctx.privateMode)return {rewind:{private:true,...view(),checkpoints:[]}};
  const state=ctx.state(),profileId=state.activeBrowserProfileId;if(!safeId(profileId))fail('No profile.');
  switch(request.type){
   case 'rewind.list':{exact(request,['query']);const query=request.query===undefined?'':request.query;if(typeof query!=='string'||query.length>200)fail('Search is too long.');return {rewind:{private:false,...listView(profileId,state,query)}};}
   case 'rewind.tabs':{exact(request,['query','limit']);const query=request.query===undefined?'':request.query;if(typeof query!=='string'||query.length>200)fail('Search is too long.');if('limit' in request&&!(Number.isInteger(request.limit)&&request.limit>=1&&request.limit<=1000))fail('Limit must be 1 to 1000.');return {rewind:{private:false,...view(),session:SESSION,current:String(ctx.windowId||''),...tabsView(profileId,state,{query,limit:request.limit})}};}
   case 'rewind.windows':{exact(request,['query']);const query=request.query===undefined?'':request.query;if(typeof query!=='string'||query.length>200)fail('Search is too long.');return {rewind:{private:false,...view(),session:SESSION,...windowsView(profileId,state,ctx,query)}};}
   case 'rewind.reopen':{exact(request,['ids','newWindow','unit']);const strip=({byRef:_,...result})=>({rewind:result}),result=reopen(request,ctx);return result&&typeof result.then==='function'?result.then(strip):strip(result);}
   case 'rewind.get':{exact(request,['id']);const row=load(profileId).get(cpId(request.id));if(!row)return {rewind:{checkpoint:null}};return {rewind:{checkpoint:{...model.summary(row.checkpoint,{days:settings.days,now,state,profileId}),groups:row.checkpoint.groups.map(group=>({...group,count:row.checkpoint.tabs.filter(tab=>tab.groupRef===group.ref).length})),splits:row.checkpoint.splits||[],tabs:model.markOpen(row.checkpoint,state,profileId)}}};}
   case 'rewind.restore':{exact(request,['id','refs','newWindow','all']);if('newWindow' in request&&typeof request.newWindow!=='boolean')fail('New window must be true or false.');if('all' in request&&typeof request.all!=='boolean')fail('All must be true or false.');const strip=({byRef:_,...result})=>({rewind:result}),result=restore(request,ctx);return result&&typeof result.then==='function'?result.then(strip):strip(result);}
   case 'rewind.undo':exact(request,['token']);return {rewind:undo(request,ctx)};
   case 'rewind.save':{exact(request,[]);const result=capture(state,{windowId:ctx.windowId,reason:'manual',force:true});return {rewind:{ok:result.ok,code:result.code,id:result.checkpoint?.id,...listView(profileId,state)}};}
   case 'rewind.keep':{exact(request,['id','kept']);if(typeof request.kept!=='boolean')fail('Keep must be true or false.');if(closedModel.isId(request.id))return {rewind:{ok:closedLog.setKept(profileId,request.id,request.kept),...listView(profileId,state)}};const row=load(profileId).get(cpId(request.id));if(!row)return {rewind:{ok:false,code:'unavailable',...listView(profileId,state)}};const checkpoint={...row.checkpoint,kept:request.kept},text=JSON.stringify(checkpoint);try{writeAtomic(path.join(profileDir(profileId),`${checkpoint.id}.json`),text);row.checkpoint=checkpoint;row.bytes=Buffer.byteLength(text);}catch{return {rewind:{ok:false,code:'write-failed',...listView(profileId,state)}};}return {rewind:{ok:true,...listView(profileId,state)}};}
   case 'rewind.remove':{exact(request,['id','window']);if('window' in request&&typeof request.window!=='boolean')fail('Window must be true or false.');if(closedModel.isId(request.id)){const url=closedLog.remove(profileId,request.id);if(url){const key=closedModel.keyOf(url);purge(profileId,address=>closedModel.keyOf(address)===key,{keepEpoch:true});}return {rewind:{ok:Boolean(url),...listView(profileId,state)}};}const target=load(profileId).get(cpId(request.id));
    // A whole window: this state and every other state of the same window in the same run.
    if(target&&request.window===true){const {sessionId,sourceWindowId}=target.checkpoint;for(const [id,row] of [...load(profileId)])if(row.checkpoint.sessionId===sessionId&&row.checkpoint.sourceWindowId===sourceWindowId)remove(profileId,id);}
    else remove(profileId,request.id);
    return {rewind:listView(profileId,state)};}
   case 'rewind.clear':exact(request,[]);removeProfile(profileId);return {rewind:{...view(),closedTabs:0,checkpoints:[]}};
   case 'rewind.settings':{exact(request,['enabled','days']);if('enabled' in request&&typeof request.enabled!=='boolean')fail('Rewind on/off must be true or false.');if('days' in request&&!DAYS.includes(request.days))fail('Keep saved moments for 1, 3 or 7 days.');settings={enabled:'enabled' in request?request.enabled:settings.enabled,days:'days' in request?request.days:settings.days};writeAtomic(path.join(dir,'settings.json'),JSON.stringify(settings));for(const id of profiles.keys())prune(id);closedLog.prune(profileId,settings.days);return {rewind:listView(profileId,state)};}
   default:fail('Unknown Rewind request.');
  }
 }
 return {observe,windowClosed,windowGone,reopenWindow,undo:(token,ctx)=>undo({token},ctx),closedLog,flushClosed:flushLog,routines:routineService,capture,purge,forgetOrigin:(profileId,origin)=>purge(profileId,url=>model.sameOrigin(url,origin)),removeProfile,deleteSince,handle,tick,flush,list,settings:()=>({...settings}),dispose:()=>{process.removeListener('exit',flushLog);flushLog();timers.clearInterval(interval);for(const value of pending.values())timers.clearTimeout(value.timer);pending.clear();}};
}
/** One Rewind per process: every window shares the same checkpoint index, closed-window memory and routines. */
let shared=null;
const sharedRewind=options=>shared??=createRewind(options);
module.exports={createRewind,sharedRewind,LIMITS,SESSION};
