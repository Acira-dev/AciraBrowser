'use strict';

function navigationKey(url) {
  try { const value=new URL(url);value.hash='';return value.href; } catch { return url; }
}

/** Lifecycle estimates, not bytes downloaded. Each navigation owns its timers. */
function createTabProgress({send,isCurrent=()=>true,reducedMotion=()=>false,setTimeout:schedule=setTimeout,clearTimeout:cancel=clearTimeout}) {
  let generation=0,target=null,active=false,disposed=false,value,stageIndex=0,timer=null,clearTimer=null;
  const milestones=[.1,.35,.7,.9],caps=[.35,.7,.9,.98];
  const clearTimers=()=>{if(timer!==null)cancel(timer);if(clearTimer!==null)cancel(clearTimer);timer=clearTimer=null;};
  const publish=next=>{value=next;if(!disposed&&isCurrent())send(next);};
  const valid=token=>!disposed&&token===generation&&isCurrent();
  const matches=url=>!disposed&&isCurrent()&&target!==null&&navigationKey(url)===target;
  const dispose=()=>{disposed=true;generation++;active=false;target=null;clearTimers();};
  const advance=()=>{
    if(!active||disposed||reducedMotion()||timer!==null||value>=caps[stageIndex])return;
    const token=generation;
    timer=schedule(()=>{
      timer=null;
      if(!valid(token)){if(token===generation)dispose();return;}
      if(!active||reducedMotion())return;
      const cap=caps[stageIndex],remaining=cap-value;
      // Snap the final imperceptible distance, then sleep until a real event.
      publish(remaining<=.001?cap:value+remaining*.16);
      advance();
    },200);
  };
  return {
    get progress(){return value;},get loading(){return active;},get generation(){return generation;},
    matches,
    begin(url){
      if(disposed||!isCurrent())return generation;
      clearTimers();generation++;target=navigationKey(url);active=true;stageIndex=0;publish(.1);advance();return generation;
    },
    redirect(url,token=generation){if(!valid(token)||!active)return false;target=navigationKey(url);return true;},
    milestone(progress,url,token=generation){
      const index=milestones.indexOf(progress);
      if(!valid(token)||!active||!matches(url)||index<0)return false;
      stageIndex=Math.max(stageIndex,index);publish(Math.max(value,progress));
      if(timer!==null)cancel(timer);timer=null;advance();return true;
    },
    complete(url,token=generation){
      if(!valid(token)||!active||!matches(url))return false;
      clearTimers();active=false;publish(1);
      clearTimer=schedule(()=>{clearTimer=null;if(valid(token))publish(undefined);},450);
      return true;
    },
    abandon(token=generation){
      if(disposed||token!==generation)return false;
      clearTimers();generation++;active=false;target=null;if(value!==undefined)publish(undefined);return true;
    },
    /** The tab was shown while loading: hand the interface the value it missed. */
    resend(){if(!disposed&&isCurrent()&&value!==undefined)send(value);},
    refreshMotion(){if(timer!==null)cancel(timer);timer=null;advance();},
    dispose,
  };
}

module.exports={createTabProgress,navigationKey};
