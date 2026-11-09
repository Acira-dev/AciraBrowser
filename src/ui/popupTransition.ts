import { designTokens } from './designSystem';
export const popupExitMilliseconds=(reducedMotion:boolean,speed=1)=>reducedMotion?0:designTokens.motion.vaporExit/Math.max(.1,speed);
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
