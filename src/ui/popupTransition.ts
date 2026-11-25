import { designTokens } from './designSystem';
import { dialogVapor } from './sheetFormation';
/** How long a closing popup's scene is kept. A dialog or a prompt (Beta 14) leaves on its own 176 ms x speed vapor (the exit is the entrance backwards) and a beat more, so the last frame is never cut. */
export const popupExitMilliseconds=(reducedMotion:boolean,speed=1,kind?:string)=>reducedMotion?0:kind!==undefined&&kind in dialogVapor.kinds?dialogVapor.ms/Math.max(.1,speed)+80:designTokens.motion.vaporExit/Math.max(.1,speed);
export const popupMorphMilliseconds=(reducedMotion:boolean,speed=1)=>reducedMotion?0:designTokens.motion.morph/Math.max(.1,speed);

/** Keep one material present while its geometry and keyed content morph.
 *  `republish` makes the interface render again after every request that commits: a request mints the popup's new id (in `commit`), and that id
 *  reaches main only in the layout the next render sends. When the kind in state does not change (a second right-click while a page menu is up,
 *  or main's dismissal of the old menu and the new request landing in one batch) `publish(kind)` alone changes nothing, no render follows, the new id
 *  is never sent, and main's later dismissal of the old id no longer matches: the popup state stays open for good and nothing opens again. */
export function createPopupTransition(publish:(kind:string|null)=>void,republish:()=>void=()=>{}){
 let current:string|null=null;
 const set=(kind:string|null)=>{current=kind;publish(kind);};
 return {
  set,
  hasOpen:()=>current!==null,
  request(kind:string,commit:()=>void,force=false){
   if(current===kind&&!force){set(null);return;}
   commit();current=kind;publish(kind);republish();
  },
  dispose(){current=null;},
 };
}
