'use strict';
// A network job that failed (the update check, the Widevine download) tries again on a short ladder instead of waiting for its next regular round:
// 2, 10 and 30 minutes after the failure, then only the job's own regular schedule. Waking the Mac or the network coming back tries again at once.
// Nothing is shown for any of it: the job reports its own state as it always did.
const STEPS=Object.freeze([2*60*1000,10*60*1000,30*60*1000]),POLL=20*1000,QUIET=30*1000;

/** `run` starts one attempt; the job calls failed() or succeeded() when the attempt (or anything else it did) ends. `watch` (createNetworkWatch) nudges it. */
function createRetry({run,steps=STEPS,schedule=setTimeout,cancel=clearTimeout,now=Date.now,quiet=QUIET,watch=null}){
 let failures=0,timer=null,lastRun=-Infinity,forget=null;
 const clear=()=>{if(timer!==null){cancel(timer);timer=null;}};
 const go=()=>{timer=null;lastRun=now();try{run();}catch{/* the job records its own failure */}};
 const retry={
  /** One more failure: the next rung of the ladder, or nothing once it is used up (the regular schedule carries on). Returns the delay, or null. */
  failed(){clear();failures++;watch?.arm();const delay=steps[failures-1];if(delay===undefined)return null;timer=schedule(go,delay);timer?.unref?.();return delay;},
  succeeded(){failures=0;clear();},
  /** The Mac woke or the network came back: a job whose last attempt failed tries again now, but not twice within `quiet` (both often arrive together). */
  nudge(){if(!failures||now()-lastRun<quiet)return false;clear();go();return true;},
  get failing(){return failures>0;},
  dispose(){clear();forget?.();},
 };
 forget=watch?.add(retry)||null;
 return retry;
}

/** Nudges every failing retry when the Mac wakes or the network comes back. The main process has no network-change event, so net.isOnline() is read
 *  every `poll` ms, and only while some retry is failing; the poll stops by itself when none is. */
function createNetworkWatch({powerMonitor=null,net=null,every=setInterval,stop=clearInterval,poll=POLL}={}){
 const retries=new Set();let timer=null,wasOnline=true;
 const online=()=>{try{return net?net.isOnline():true;}catch{return true;}};
 const failing=()=>[...retries].some(retry=>retry.failing);
 const back=()=>{for(const retry of retries)if(retry.failing)retry.nudge();};
 const onResume=()=>back();
 function arm(){
  if(timer||!net||!failing())return;
  wasOnline=online();
  timer=every(()=>{if(!failing()){stop(timer);timer=null;return;}const now=online();if(now&&!wasOnline)back();wasOnline=now;},poll);timer?.unref?.();
 }
 try{powerMonitor?.on?.('resume',onResume);}catch{}
 return {
  /** Follows `retry` (createRetry does this); arm() starts the network poll after a failure. */
  add(retry){retries.add(retry);return ()=>retries.delete(retry);},
  arm,
  back,
  dispose(){if(timer){stop(timer);timer=null;}try{powerMonitor?.removeListener?.('resume',onResume);}catch{}retries.clear();},
 };
}

module.exports={createRetry,createNetworkWatch,STEPS,POLL,QUIET};
