export type PopupMaterialProvider='css'|'pending'|'live'|'opaque'|'native';

/** Old-context pixels may finish only an already-visible close. Live streams,
 * accessibility changes and a new/reopened context never inherit that cache. */
export function canRetainClosingMaterial({closing,enabled,previousEnabled,frames}:{closing:boolean;enabled:boolean;previousEnabled:boolean;frames:readonly{frame?:{width:number;height:number};stream?:{getTracks():readonly{readyState:string}[]}}[]}){
 return closing&&enabled&&previousEnabled&&frames.length>0&&frames.every(item=>item.frame&&item.frame.width>0&&item.frame.height>0&&(!item.stream||item.stream.getTracks().every(track=>track.readyState==='ended')));
}

// Baseline acquisition after formation took120–147ms, including the former
// idle scheduling. Keep a short, bounded priming budget; tune against cold
// native measurements rather than allowing the decoder's2500ms safety timeout.
export const popupCaptureBudgetMs=160;
export function createPopupMaterialDeadline(fallback:()=>void,budget=popupCaptureBudgetMs){
 let settled=false;
 const timer=setTimeout(()=>{if(settled)return;settled=true;fallback();},budget);
 return{
  accept(){if(settled)return false;settled=true;clearTimeout(timer);return true;},
  cancel(){settled=true;clearTimeout(timer);},
 };
}

/** A sheet never waits for its captured glass (founder: the first frame lands on the input frame, nothing hidden).
 * While the frozen frost decodes (~35–60ms after mount) the sheet condenses on the dense tint plate, and the complete
 * captured layer crossfades in under the still-moving formation, so the glass thickens with the motion instead of
 * switching on after it. A context/accessibility change replaces sources the same way. */
export function popupMaterialProvider({native,reducedTransparency,status,opaque}:{native:boolean;reducedTransparency:boolean;status:'pending'|'live'|'native';opaque:boolean;visible?:boolean}):PopupMaterialProvider{
 if(!native)return 'css';
 if(reducedTransparency)return 'opaque';
 if(status==='pending')return 'opaque';
 if(status==='native')return 'native';
 return opaque?'opaque':'live';
}
