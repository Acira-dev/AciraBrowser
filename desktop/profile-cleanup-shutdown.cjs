'use strict';

/** After accepted window close, serialize selective cleanup before native flush. */
/** What each profile's cleanup said, short, for the preview record only (ACIRA_PREVIEW_RECORD): a cleanup that did not complete names its error and the category that failed (for example
 * "Native service workers are still active" or a tracked request that was still open), so a failed run can be read. Nothing here is acted on. */
function summary(result){
 try{
  if(!result||!Array.isArray(result.profiles)||!result.profiles.length)return {};
  const text=value=>value===undefined||value===null?undefined:String(value).slice(0,240);
  // 13.8: the requests the pipeline still counted when the cleanup gave up: host only, never a path or a query (request-pipeline.cjs trackedRequests)
  const number=value=>typeof value==='number'&&Number.isFinite(value)?Math.round(value):undefined;
  const request=entry=>({host:text(entry&&entry.host),resourceType:text(entry&&entry.resourceType),method:text(entry&&entry.method),webContentsId:typeof(entry&&entry.webContentsId)==='number'?entry.webContentsId:text(entry&&entry.webContentsId),webContentsExists:typeof(entry&&entry.webContentsExists)==='boolean'?entry.webContentsExists:null,ageMs:number(entry&&entry.ageMs),phase:text(entry&&entry.phase),phaseAgeMs:number(entry&&entry.phaseAgeMs)});
  const requests=value=>Array.isArray(value)&&value.length?value.slice(0,8).map(request):undefined;
  return {profiles:result.profiles.slice(0,8).map(item=>({profileId:text(item&&item.profileId),completed:!!item&&item.completed===true,error:text(item&&item.error),results:Array.isArray(item&&item.results)?item.results.slice(0,8).map(entry=>({category:text(entry&&entry.category),status:text(entry&&entry.status),error:text(entry&&entry.error)})):undefined,...(requests(item&&item.tracked)?{tracked:requests(item.tracked)}:{})}))};
 }catch{return {};}
}
function createProfileCleanupShutdown({getCleanup,shutdown,quit,onState=()=>{},timeoutMs=5000}){
 if(!Number.isFinite(timeoutMs)||timeoutMs<1||timeoutMs>30000)throw Error('Use a bounded cleanup shutdown wait.');
 let waiting=false,finished=false,skipFlush=false;
 const notify=state=>{try{onState(state);}catch{}};
 return event=>{
  if(finished)return skipFlush?undefined:shutdown(event);
  const cleanup=getCleanup();if(!cleanup?.needsExit())return shutdown(event);
  event.preventDefault();if(waiting)return;waiting=true;notify({phase:'waiting',completed:false});
  void(async()=>{let timer;try{
   const result=await Promise.race([cleanup.finish(),new Promise(resolve=>timer=setTimeout(()=>resolve({timedOut:true,completed:false}),timeoutMs))]);
   // A timed-out deletion may still own native stores. Keep its durable journal
   // and network hold; do not race our custom cookie/store flush against it.
   skipFlush=result.timedOut===true;notify({phase:result.completed?'complete':'pending',completed:result.completed===true,flushSkipped:skipFlush,...summary(result)});
  }catch{notify({phase:'pending',completed:false,flushSkipped:false});}finally{clearTimeout(timer);finished=true;waiting=false;quit();}})();
 };
}
module.exports={createProfileCleanupShutdown};
