'use strict';

/** Flush native website stores only after window/beforeunload approval, without reading their contents. */
function createSessionShutdown({getSessions,quit,beforeFlush,onError=()=>{},timeoutMs=5000,setTimer=setTimeout,clearTimer=clearTimeout}){
 let pending=false,finished=false;
 const report=reason=>{try{onError(reason);}catch{}};
 return function handleWillQuit(event){
  if(finished)return;
  if(pending){event.preventDefault();return;}
  let sessions;
  try{sessions=[...new Set(getSessions())];}catch{report('Website sessions could not be flushed.');return;}
  // Initialization-only startup has no website sessions, but its protected URL
  // handoff still has to drain after window/beforeunload approval.
  if(!sessions.length&&!beforeFlush){finished=true;return;}
  event.preventDefault();pending=true;
  const operations=[];
  if(beforeFlush)try{operations.push(Promise.resolve(beforeFlush()));}catch(error){operations.push(Promise.reject(error));}
  for(const session of sessions){
   // One failure must not prevent another store (or another profile) from being flushed.
   for(const operation of [()=>session.flushStorageData(),()=>session.cookies.flushStore()]){
    try{operations.push(Promise.resolve(operation()));}catch(error){operations.push(Promise.reject(error));}
   }
  }
  let timer;
  const deadline=new Promise(resolve=>{timer=setTimer(()=>resolve('timeout'),timeoutMs);});
  const flushed=Promise.allSettled(operations);
  void Promise.race([flushed,deadline]).then(result=>{
   clearTimer(timer);
   if(result==='timeout')report('Website session flush timed out.');
   else if(result.some(item=>item.status==='rejected'))report('Some website session data could not be flushed.');
   finished=true;pending=false;quit();
  });
 };
}

module.exports={createSessionShutdown};
