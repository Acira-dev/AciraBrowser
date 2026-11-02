'use strict';
// Import Undo may remove only unopened, still-pending profiles whose imported
// data was confirmed undone. Preserve any data or window created since import.
function emptyImportedProfile(state,id){
 return id!==state.activeBrowserProfileId&&state.browserProfiles.some(p=>p.id===id&&!p.private)&&
  !['bookmarkNodes','browsingHistory','downloads'].some(key=>(state[key]||[]).some(item=>item.browserProfileId===id))&&
  !(state.tabs||[]).some(tab=>tab.browserProfileId===id&&tab.url!=='acira://new');
}
function createImportUndo({getState,importer,setupService,removeProfile,profileOpen,toast}){
 return async function undo(batchIds,profileIds=[]){
  const targets=new Set();
  try{
   for(const id of batchIds){const result=await importer.undo(id);if(!result?.undone)throw Error('The import could not be undone. Try again.');if(result.profileId)targets.add(result.profileId);}
   let removed=0;
   for(const id of new Set(profileIds)){
    if(!targets.has(id)||profileOpen(id)||!emptyImportedProfile(getState(),id))continue;
    const status=await setupService()?.command({type:'status'},{profileId:id,privateMode:false});
    if(!status?.progress?.pendingSetup||profileOpen(id)||!emptyImportedProfile(getState(),id))continue;
    const result=await removeProfile(id);if(result?.ok)removed++;
   }
   return toast(profileIds.length?(removed?`Import undone. Removed ${removed} unused ${removed===1?'profile':'profiles'}.`:'Import undone. Your profiles were kept.'):'Import undone');
  }catch(error){return toast(String(error?.message||error).slice(0,200),'error');}
 };
}
module.exports={createImportUndo,emptyImportedProfile};
