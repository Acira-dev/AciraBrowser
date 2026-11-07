'use strict';
// Chromium writes cookies and DOM storage lazily (tens of seconds), so a crash or force-kill a moment after a
// sign-in loses it. Flush shortly after every cookie change and periodically for page storage.
function createStorageDurability({setTimer=setTimeout,clearTimer=clearTimeout,setRepeat=setInterval,clearRepeat=clearInterval,now=Date.now,delayMs=1200,maxWaitMs=5000,storageEveryMs=5000,onError=()=>{}}={}){
 const attached=new WeakSet();
 function attach(session){
  if(!session||attached.has(session)||typeof session.isPersistent!=='function'||!require('./browser-services/private-extension-sessions.cjs').persistent(session))return false;
  attached.add(session);
  let timer=null,firstChange=0;
  const flush=()=>{timer=null;firstChange=0;try{Promise.resolve(session.cookies.flushStore()).catch(onError);}catch(error){onError(error);}};
  session.cookies.on('changed',()=>{
   const time=now();if(!firstChange)firstChange=time;
   if(timer)clearTimer(timer);
   timer=setTimer(flush,Math.max(0,Math.min(delayMs,firstChange+maxWaitMs-time)));timer.unref?.();
  });
  const repeat=setRepeat(()=>{try{session.flushStorageData();}catch(error){onError(error);}},storageEveryMs);repeat.unref?.();
  return true;
 }
 return {attach};
}
module.exports={createStorageDurability};
