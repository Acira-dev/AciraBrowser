'use strict';
// Secured workspaces (R3-38, R4-48 P2-4), the main-process half. The reducer half is src/runtime/workspaces.ts; the leak
// checklist is docs/launch/SECURED_WORKSPACES.md.
//
//  - Session: every tab of a secured workspace uses ONE memory-only partition for that workspace and this run
//    (`acira-secured-<run>-<workspace>`, no `persist:`), with a `private-` profile id, so permissions, downloads, spelling,
//    favicons and blocking treat it as "keep nothing". It is shared by the workspace's tabs (one sign-in for the workspace) and
//    with nothing else; it is emptied when the workspace is deleted or stops being secured, and dies with the app.
//  - Lock: the tabs (with their tab groups and saved splits) are sealed into the vault FIRST (desktop/browser-services/secured-vault.cjs, AES-256-GCM + DPAPI), then
//    removed from every window's state (`workspace.secured-lock`): their live pages are detached and retained privately in main, and no surface can show a title or icon
//    that is not there. Triggers: the Lock button / menu, leaving the workspace, N minutes of system idle (Settings, default 5),
//    minimising the window, Windows locking or sleeping, the window closing, quitting.
//  - Unlock: only from here, only after Windows Hello (or the Windows password when Hello isn't set up), one prompt per unlock.
//    The interface can't send `workspace.secured-unlock` (desktop/validation.cjs refuses it).
const {randomUUID}=require('node:crypto');

const LOCK_CHOICES=[0,1,5,15,30],DEFAULT_LOCK_MINUTES=5,ID=/^[A-Za-z0-9_.:-]{1,120}$/;
const lockMinutes=settings=>{const value=Number(settings?.securedLockMinutes);return LOCK_CHOICES.includes(value)?value:DEFAULT_LOCK_MINUTES;};
const securedIds=state=>new Set((state?.workspaces||[]).filter(workspace=>workspace.secured).map(workspace=>workspace.id));
const firstWorkspaceOf=(state,profileId)=>(state.workspaces||[]).find(workspace=>workspace.browserProfileId===profileId)?.id;
/** The workspace a tab is in (main's copy of workspaceIdOf: no stamp = the profile's first workspace, which is never secured). */
const workspaceOfTab=(state,tab)=>tab.workspaceId&&(state.workspaces||[]).some(workspace=>workspace.id===tab.workspaceId&&workspace.browserProfileId===tab.browserProfileId)?tab.workspaceId:firstWorkspaceOf(state,tab.browserProfileId);
const LOCKED_URL='acira://locked';

function createSecuredWorkspaces({tm=key=>key,controllers,vault,gate,powerMonitor=null,session=null,Notification=null,onNotificationClick=()=>{},onForgetProfile=()=>{},now=Date.now,log=()=>{},timers={setTimeout,clearTimeout,setInterval,clearInterval},run=randomUUID().slice(0,8)}){
 const profiles=new Map(),writeTimers=new Map(),lastWritten=new Map(),shown=new Map(),lastShown=new Map();
 const ordinary=()=>[...controllers].filter(c=>!c.privateMode&&!c.webApp&&c.state);
 const tabsIn=(controller,id)=>(controller.state.tabs||[]).filter(tab=>tab.url!==LOCKED_URL&&tab.privacy==='secured'&&workspaceOfTab(controller.state,tab)===id);
 const workspaceIn=(state,id)=>(state?.workspaces||[]).find(workspace=>workspace.id===id);
 const unlockedAnywhere=id=>ordinary().some(c=>workspaceIn(c.state,id)?.unlocked);
 /** What the vault holds for a workspace: its tabs, tab groups and saved splits in every window (a workspace is open in one window at a time, so normally one). */
 function collect(id){const tabs=[],groups=[],splits=[];let activeId='';for(const c of ordinary()){const mine=tabsIn(c,id),ids=new Set(mine.map(tab=>tab.id));tabs.push(...mine);groups.push(...(c.state.tabGroups||[]).filter(group=>group.workspaceId===id));splits.push(...(c.state.windowUi?.splitGroups||[]).filter(split=>split.tabIds?.length&&split.tabIds.every(tabId=>ids.has(tabId))));if(mine.some(tab=>tab.id===c.state.activeTabId))activeId=c.state.activeTabId;else if(!activeId&&c.state.windowUi?.lastTabs?.[id])activeId=c.state.windowUi.lastTabs[id];}return {tabs,activeId,groups,splits};}
 function write(id){
  const timer=writeTimers.get(id);if(timer){timers.clearTimeout(timer);writeTimers.delete(id);}
  if(!unlockedAnywhere(id))return true;// locked: the sealed file already holds the tabs, and nothing here may replace it
  const payload=collect(id),signature=JSON.stringify([payload.tabs.map(tab=>[tab.id,tab.url,tab.title,tab.customTitle||'',tab.group||'',tab.historyIndex,tab.history]),payload.groups,payload.splits])+'|'+payload.activeId;
  if(lastWritten.get(id)===signature)return true;
  try{vault.write(id,payload);lastWritten.set(id,signature);return true;}catch(error){log('Secured workspace save:',error?.code||error?.message);return false;}
 }
 const queueWrite=id=>{if(writeTimers.has(id))return;writeTimers.set(id,timers.setTimeout(()=>{writeTimers.delete(id);write(id);},1200));};

 const api={
  run,
  /** The one memory-only profile a secured workspace's pages use this run. */
  profileFor(tab,real){
   const id=String(tab.workspaceId||'');if(!ID.test(id))return null;
   let profile=profiles.get(id);
   if(!profile){const safe=id.replace(/[^A-Za-z0-9_-]/g,'_');profile={id:`private-secured-${run}-${safe}`,name:'Secured',color:real?.color||'#62666d',partition:`acira-secured-${run}-${safe}`,private:true,secured:true};profiles.set(id,profile);}
   return profile;
  },
  partitionOf:id=>profiles.get(id)?.partition||null,
  /** Seals and hides a secured workspace everywhere. Returns false when the tabs couldn't be sealed (then nothing is hidden or lost). */
  lock(id,reason='manual'){
   const any=ordinary().find(c=>workspaceIn(c.state,id)?.secured);if(!any)return false;
   if(!unlockedAnywhere(id))return true;
   lastWritten.delete(id);
   if(!write(id)){for(const c of ordinary())if(workspaceIn(c.state,id)?.unlocked){c.commitAction({type:'toast',text:tm('workspaces.lockFailed'),tone:'error'});break;}return false;}
   for(const c of ordinary())if(workspaceIn(c.state,id)?.unlocked)c.commitAction({type:'workspace.secured-lock',id,reason});
   lastWritten.delete(id);api.clearNotifications(id);
   return true;
  },
  lockAll(reason){let all=true;for(const id of new Set(ordinary().flatMap(c=>[...securedIds(c.state)])))if(unlockedAnywhere(id))all=api.lock(id,reason)&&all;return all;},
  /** Windows Hello, then the sealed tabs come back into `controller`'s window. */
  async unlock(id,controller){
   const workspace=workspaceIn(controller.state,id);
   if(!workspace?.secured)return {ok:false,code:'missing'};
   if(workspace.unlocked)return {ok:true};
   const verified=await gate.ensure('secured',controller.window);
   if(!verified?.ok)return {ok:false,code:verified?.code||'failed',message:verified?.message};
   let sealed;try{sealed=vault.read(id);}catch(error){return {ok:false,code:error?.code||'corrupt'};}
   if(!workspaceIn(controller.state,id)?.secured)return {ok:false,code:'missing'};
   // A native page belongs to its original window; another window restores from the sealed file instead.
   for(const other of ordinary())if(other!==controller)other.dropSecuredPages?.(id);
   controller.commitAction({type:'workspace.secured-unlock',id,tabs:sealed.tabs,activeId:sealed.activeId,groups:sealed.groups||[],splits:sealed.splits||[]});
   lastWritten.delete(id);
   return {ok:true};
  },
  /** "Lock this workspace": verify once (so nobody locks themselves out), then the workspace becomes secured and is sealed. */
  async enable(id,controller){
   const workspace=workspaceIn(controller.state,id);
   if(!workspace)return {ok:false,code:'missing'};
   if(workspace.secured)return {ok:true};
   if(firstWorkspaceOf(controller.state,workspace.browserProfileId)===id)return {ok:false,code:'first'};
   if(!vault.available())return {ok:false,code:'unavailable'};
   const verified=await gate.ensure('secured',controller.window);
   if(!verified?.ok)return {ok:false,code:verified?.code||'failed',message:verified?.message};
   controller.commitAction({type:'workspace.secured-set',id,secured:true});
   if(!workspaceIn(controller.state,id)?.secured)return {ok:false,code:'refused'};
   lastWritten.delete(id);write(id);
   return {ok:true};
  },
  /** "Stop locking": verify, the tabs move back to the profile's session, the sealed file and the memory session go. */
  async disable(id,controller){
   const workspace=workspaceIn(controller.state,id);
   if(!workspace?.secured)return {ok:true};
   if(!workspace.unlocked)return {ok:false,code:'locked'};
   const verified=await gate.ensure('secured',controller.window);
   if(!verified?.ok)return {ok:false,code:verified?.code||'failed',message:verified?.message};
   controller.commitAction({type:'workspace.secured-set',id,secured:false});
   api.forget(id);
   return {ok:true};
  },
  /** The workspace is gone (deleted, or no longer secured): its sealed file and its memory session go too. */
  forget(id){
   for(const c of ordinary())c.dropSecuredPages?.(id);
   const timer=writeTimers.get(id);if(timer){timers.clearTimeout(timer);writeTimers.delete(id);}
   lastWritten.delete(id);try{vault.remove(id);}catch{}
   const profile=profiles.get(id);profiles.delete(id);
   if(profile)try{onForgetProfile(profile);}catch(error){log('Secured spelling cleanup:',error?.message);}
   if(profile&&session)try{const ses=session.fromPartition(profile.partition);void Promise.allSettled([ses.clearStorageData(),ses.clearCache(),ses.clearAuthCache(),ses.closeAllConnections?.()]);}catch{}
  },
  /** A page of a secured workspace showed a web notification (secured-notification-preload.cjs; the page's own title and body never leave it). Windows shows one
   *  neutral line instead, "New notification in a locked workspace", and only while the workspace is unlocked; a burst becomes one. Chromium's own
   *  notifications are refused for these sessions (permission-engine.cjs), so nothing else can carry the words. */
  notify(controller,tabId,request={}){
   const state=controller?.state,tab=state?.tabs?.find(item=>item.id===tabId);
   if(!tab||tab.privacy!=='secured'||tab.url===LOCKED_URL)return {ok:false,code:'not-secured'};
   const id=workspaceOfTab(state,tab),workspace=workspaceIn(state,id);
   if(!workspace?.secured||!workspace.unlocked)return {ok:false,code:'locked'};
   if(!Notification||(typeof Notification.isSupported==='function'&&!Notification.isSupported()))return {ok:false,code:'unsupported'};
   const at=now();if(lastShown.has(id)&&at-lastShown.get(id)<4000)return {ok:true,merged:true};lastShown.set(id,at);
   let note;try{note=new Notification({title:tm('workspaces.securedNotification'),body:'',silent:request.silent===true});}catch(error){log('Secured notification:',error?.message);return {ok:false,code:'failed'};}
   shown.set(note,id);
   try{note.on?.('click',()=>{shown.delete(note);try{onNotificationClick(controller,tabId,request.token);}catch{}});note.on?.('close',()=>shown.delete(note));note.show();}catch(error){shown.delete(note);log('Secured notification:',error?.message);return {ok:false,code:'failed'};}
   return {ok:true};
  },
  /** Locking takes the workspace's notifications away too (Windows keeps nothing that says more than the neutral line anyway). */
  clearNotifications(id){for(const [note,owner] of [...shown])if(owner===id){shown.delete(note);try{note.close();}catch{}}lastShown.delete(id);},
  /** Runs after every action of an ordinary window: leaving locks, edits are sealed, a deleted workspace is forgotten, and the window is kept out of screen capture while a secured tab is on screen. */
  afterAction(controller,previous,state,action){
   if(!previous||!state||controller.privateMode)return;
   const before=securedIds(previous),now=securedIds(state);
   if(!before.size&&!now.size)return;
   for(const id of before)if(!now.has(id)&&action?.type==='workspace.delete')api.forget(id);
   const left=previous.activeWorkspaceId;
   if(left&&left!==state.activeWorkspaceId&&workspaceIn(state,left)?.secured&&workspaceIn(state,left)?.unlocked&&action?.type!=='workspace.secured-set')timers.setTimeout(()=>api.lock(left,'leave'),0);
   for(const id of now)if(workspaceIn(state,id)?.unlocked&&(previous.tabs!==state.tabs||previous.activeTabId!==state.activeTabId||previous.tabGroups!==state.tabGroups||previous.windowUi?.splitGroups!==state.windowUi?.splitGroups))queueWrite(id);
   api.protect(controller,state);
  },
  protect(controller,state=controller.state){
   const active=(state.tabs||[]).find(tab=>tab.id===state.activeTabId),on=active?.privacy==='secured'&&active.url!==LOCKED_URL;
   if(controller.__securedProtected===on)return;controller.__securedProtected=on;
   try{const win=controller.window;if(win&&!win.isDestroyed()&&typeof win.setContentProtection==='function')win.setContentProtection(on);}catch{}
  },
  /** A window is closing: its secured workspaces are sealed and lock everywhere. */
  windowClosing(controller){for(const id of securedIds(controller.state))if(workspaceIn(controller.state,id)?.unlocked)api.lock(id,'close');},
  /** Quit: every open secured workspace is sealed now (synchronously), whatever the timers had queued. */
  flush(){for(const id of new Set(ordinary().flatMap(c=>[...securedIds(c.state)])))write(id);},
  lockMinutes,
  /** N minutes without any input on this PC (Settings › Privacy, default 5; 0 = only when Windows locks). */
  tick(){
   if(!powerMonitor||typeof powerMonitor.getSystemIdleTime!=='function')return;
   const settings=ordinary()[0]?.state?.settings,minutes=lockMinutes(settings);if(!minutes)return;
   let idle=0;try{idle=powerMonitor.getSystemIdleTime();}catch{return;}
   if(idle>=minutes*60)api.lockAll('idle');
  },
 };
 let interval=null;
 if(powerMonitor){
  for(const event of ['lock-screen','suspend'])try{powerMonitor.on(event,()=>api.lockAll('os'));}catch{}
  interval=timers.setInterval(()=>api.tick(),30000);interval?.unref?.();
 }
 api.dispose=()=>{if(interval)timers.clearInterval(interval);for(const timer of writeTimers.values())timers.clearTimeout(timer);writeTimers.clear();};
 return api;
}
module.exports={createSecuredWorkspaces,lockMinutes,LOCK_CHOICES,DEFAULT_LOCK_MINUTES,LOCKED_URL};
