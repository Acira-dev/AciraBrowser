import { designTokens } from './designSystem';
export const popupExitMilliseconds=(reducedMotion:boolean,speed=1)=>reducedMotion?0:designTokens.motion.vaporExit/Math.max(.1,speed);
export const popupMorphMilliseconds=(reducedMotion:boolean,speed=1)=>reducedMotion?0:designTokens.motion.morph/Math.max(.1,speed);

/** Keep one material present while its geometry and keyed content morph. */
export function createPopupTransition(publish:(kind:string|null)=>void){
 let current:string|null=null;
 const set=(kind:string|null)=>{current=kind;publish(kind);};
 return {
  set,
  hasOpen:()=>current!==null,
  request(kind:string,commit:()=>void,force=false){
   if(current===kind&&!force){set(null);return;}
   commit();current=kind;publish(kind);
  },
  dispose(){current=null;},
 };
}
