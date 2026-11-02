/** Serialize bounded private retirement before the existing native session flush.
 * This runs at will-quit, after every cancellable window/beforeunload decision. */
function createPrivateShutdown({getRetirement,shutdown,quit,onState=()=>{},timeoutMs=5000}){
 if(!Number.isFinite(timeoutMs)||timeoutMs<1||timeoutMs>30000)throw Error('Use a bounded private-shutdown wait.');
 let waiting=false,finished=false;
 const notify=value=>{try{onState(value);}catch{}};
 return event=>{
  const service=getRetirement();let needsWait=false;
  try{needsWait=!!service&&service.pending().length>0;}catch{needsWait=!!service;}
  if(finished||!needsWait)return shutdown(event);
  event.preventDefault();if(waiting)return;waiting=true;notify({phase:'waiting',completed:false});
  void(async()=>{let timer;try{
   const result=await Promise.race([service.settle({timeoutMs}),new Promise(resolve=>timer=setTimeout(()=>resolve({completed:false}),timeoutMs+250))]);
   notify({phase:result.completed?'complete':'pending',completed:result.completed===true});
  }catch{notify({phase:'pending',completed:false});}finally{clearTimeout(timer);finished=true;waiting=false;quit();}})();
 };
}
module.exports={createPrivateShutdown};
