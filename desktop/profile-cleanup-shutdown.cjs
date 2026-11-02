'use strict';

/** After accepted window close, serialize selective cleanup before native flush. */
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
   skipFlush=result.timedOut===true;notify({phase:result.completed?'complete':'pending',completed:result.completed===true,flushSkipped:skipFlush});
  }catch{notify({phase:'pending',completed:false,flushSkipped:false});}finally{clearTimeout(timer);finished=true;waiting=false;quit();}})();
 };
}
module.exports={createProfileCleanupShutdown};
