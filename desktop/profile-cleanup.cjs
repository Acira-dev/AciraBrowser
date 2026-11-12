'use strict';

const {createExitCleanup,commitExitRecords}=require('./browser-services/exit-cleanup.cjs');
const {createExtensionManager}=require('./extensions.cjs');

/** One ordinary-profile lifecycle. Private retirement has its own native owner. */
function createProfileCleanup({database,cookieRestore,permissions,getSession,getPipeline,getControllers,getAllContents,dialog,getWindow,registryPath,onChange=()=>{},createService=createExitCleanup,createInventory=createExtensionManager}) {
 const contexts=new Map(),errors=new Map(),reviews=new Map();let profiles=[],queue=Promise.resolve(),exiting=false;
 const notify=()=>{try{onChange();}catch{}};
 const serialized=operation=>{const result=queue.then(operation,operation);queue=result.catch(()=>{});return result;};
 const inventory=createInventory({getProfiles:()=>profiles,getSession,dialog,getWindow:()=>getWindow(),registryPath});
 function owner(id){const profile=profiles.find(item=>item.id===id);if(!profile)throw Error('Select an ordinary local profile.');return profile;}
 function live(id){
  const context=contexts.get(id);if(!context)return true;
  for(const controller of getControllers())if(!controller.privateMode){
   for(const entry of controller.pages.values())if(entry.view.webContents.session===context.session&&!entry.view.webContents.isDestroyed())return true;
   for(const window of controller.auxiliaries.values())if(!window.isDestroyed()&&window.webContents.session===context.session)return true;
   for(const view of controller.downloadSources.values())if(!view.webContents.isDestroyed()&&view.webContents.session===context.session)return true;
  }
  // Cookie recovery owns isolated about:blank protocol-access targets. Website,
  // extension and background documents outside the window maps remain live.
  return getAllContents().some(contents=>!contents.isDestroyed()&&contents.session===context.session&&(contents.getURL()!=='about:blank'||contents.getType()==='backgroundPage'));
 }
 const reviewDialog={showMessageBox:async(window,options)=>{const answer=await dialog.showMessageBox(window,options);return window?.isDestroyed()?{response:0}:answer;}};
 const service=createService({database,getProfiles:()=>profiles,getSession:profile=>contexts.get(profile.id)?.session,getPipeline:(profile,session)=>getPipeline(session,profile.id),hasLivePages:live,cookieRestore,permissions,dialog:reviewDialog,getWindow:id=>reviews.get(id)||getWindow(id),getProtectedOrigins:(_session,profile)=>inventory.storageOrigins(profile.id),commitRecords:({profileId,keepOrigins})=>{
  const controllers=[...getControllers()].filter(item=>!item.privateMode),plan=commitExitRecords(database,controllers.map(item=>({id:item.windowId,snapshot:item.state})),profileId,keepOrigins),changed=[];
  for(const window of plan.windows){const controller=controllers.find(item=>item.windowId===window.id);if(controller){controller.replaceRecords(window.snapshot);changed.push(controller);}}
  for(const controller of changed)controller.publishRecords();return {counts:plan.counts,filesDeleted:false};
 }});
 function hold(context){context.ready=false;if(!context.release)context.release=context.pipeline.holdNetwork('ordinary-cleanup-lifecycle');}
 function remember(values){
  const next=values.filter(profile=>!profile.private),ids=new Set(),partitions=new Set();
  for(const profile of next){if(typeof profile.id!=='string'||!profile.id||typeof profile.partition!=='string'||!profile.partition.startsWith('persist:')||ids.has(profile.id)||partitions.has(profile.partition))throw Error('Ordinary cleanup requires distinct canonical native profiles.');ids.add(profile.id);partitions.add(profile.partition);const existing=contexts.get(profile.id);if(existing&&existing.partition!==profile.partition)throw Error('A native cleanup profile changed its storage partition.');}
  profiles=next.map(profile=>({...profile}));
  for(const profile of profiles)if(!contexts.has(profile.id)){const session=getSession(profile.partition),pipeline=getPipeline(session,profile.id);if(typeof pipeline?.holdNetwork!=='function')throw Error('The qualified native request barrier is unavailable.');const context={session,pipeline,partition:profile.partition,ready:false,attached:false,release:null};contexts.set(profile.id,context);hold(context);}
 }
 function mayBrowse(id){return !exiting&&contexts.get(id)?.ready===true;}
 function assertReady(id){owner(id);if(!mayBrowse(id))throw Error(errors.get(id)||'Selected profile cleanup must finish before websites open.');}
 function gate(id){owner(id);let pending=false,error=errors.get(id)||null;try{const status=service.status(id);pending=status.pending;error=error||status.recoveryError;}catch(cause){pending=true;error=String(cause.message||cause);}return {profileId:id,ready:mayBrowse(id),pending,error,closing:exiting};}
 function status(id){owner(id);const value=service.status(id);return {...value,networkBlocked:value.networkBlocked||!mayBrowse(id),recoveryError:errors.get(id)||value.recoveryError};}
 async function recover(ids){
  let result;
  try{
   // Restore runs to its end before any cleanup, so nothing it puts back can outlive a clear. When restore is off
   // ({supported:false}: Linux with no keyring, where Chromium falls back to basic_text, or a restore that failed)
   // nothing more is saved or put back this run, and a clear still revokes the saved copy, so nothing cleared can
   // come back: the profile browses. Only an attach that throws keeps the hold.
   for(const id of ids){const context=contexts.get(id);hold(context);if(!context.attached){await cookieRestore.attach({session:context.session,profileId:id,partition:context.partition,private:false});context.attached=true;}}
   result=await service.runPending({phase:'startup'});
   const safe=new Set();
   for(const id of ids){const current=service.status(id),failure=result.profiles.find(item=>item.profileId===id&&!item.completed);if(failure||current.pending||current.networkBlocked||current.recoveryError)errors.set(id,failure?.error||current.recoveryError||'Selected cleanup is still pending. Close website tabs and retry, or reopen Acira.');else{errors.delete(id);safe.add(id);}}
   // The next crash must be covered before any selected profile can browse.
   service.armAll();
   for(const id of safe){const context=contexts.get(id);if(exiting)continue;context.ready=true;context.release?.();context.release=null;}
  }catch(error){for(const id of ids)errors.set(id,String(error.message||error));result={completed:false,profiles:[]};}
  notify();return result;
 }
 return {
  prepare(values){remember(values);return serialized(()=>{
   // Restored windows share recovery. Recheck after earlier owners finish so a
   // queued window cannot re-hold live profiles or consume their next exit job.
   const ids=profiles.filter(profile=>!contexts.get(profile.id).ready).map(profile=>profile.id);
   return ids.length?recover(ids):{completed:true,profiles:[]};
  });},
  mayBrowse,assertReady,gate,status,
  uiNetworkAllowed(){return ![...getControllers()].some(controller=>!controller.privateMode&&!mayBrowse(controller.profileId));},
  async set(id,choice,window,options){assertReady(id);if(!window||window.isDestroyed())throw Error('The reviewed browser window is unavailable.');if(reviews.has(id))throw Error('Another cleanup choice is being reviewed for this profile.');reviews.set(id,window);try{const result=await service.set(id,choice,options);notify();return result;}finally{reviews.delete(id);}},
  retry(id){owner(id);if(exiting)throw Error('Acira is closing.');if([...profiles].some(profile=>live(profile.id)))throw Error('Close website tabs and popup windows before retrying cleanup.');const ids=profiles.filter(profile=>!mayBrowse(profile.id)).map(profile=>profile.id);return serialized(async()=>{await recover(ids);return gate(id);});},
  needsExit(){if(!profiles.length)return false;try{return profiles.some(profile=>{const current=service.status(profile.id);return current.choice.enabled||current.pending||current.networkBlocked;});}catch{return true;}},
  finish(){exiting=true;for(const context of contexts.values())hold(context);return serialized(async()=>{try{return await service.runPending({phase:'exit'});}finally{notify();}});}
 };
}
module.exports={createProfileCleanup};
