'use strict';
// Pop-up policy: a page may open a window only right after a real click or key press on it (transient activation),
// so OAuth and payment pop-ups keep working while load-time and timer-driven pop-ups are refused.
const MODIFIER_KEYS=new Set(['Control','Shift','Alt','Meta','AltGraph','CapsLock','OS']);

function createPopupGate({now=Date.now,windowMs=5000,noticeMs=4000,onBlocked=()=>{}}={}){
 const gestures=new WeakMap(),notices=new WeakMap();
 function attach(wc){
  if(gestures.has(wc))return;
  gestures.set(wc,0);
  wc.on('before-mouse-event',(_event,input)=>{if(input?.type==='mouseDown'||input?.type==='mouseUp')gestures.set(wc,now());});
  wc.on('before-input-event',(_event,input)=>{if(input?.type==='keyDown'&&!MODIFIER_KEYS.has(input.key))gestures.set(wc,now());});
 }
 /** True when the window request follows a recent user gesture on this page. */
 function allow(wc,details){
  const last=gestures.get(wc)||0,ok=last>0&&now()-last<=windowMs;
  if(!ok&&now()-(notices.get(wc)||-Infinity)>noticeMs){notices.set(wc,now());try{onBlocked(wc,details);}catch{}}
  return ok;
 }
 /** The same test without the notice: did a click or key press just reach this page? */
 function recent(wc){const last=gestures.get(wc)||0;return last>0&&now()-last<=windowMs;}
 return {attach,allow,recent};
}
module.exports={createPopupGate};
