import { animate,cancelFrame,frame,useMotionValue,type Transition } from 'motion/react';
import { useCallback,useLayoutEffect,useRef,type RefObject } from 'react';
import { followFrame } from './tabSelectionFollow';

/** Keep the existing switching spring; structural moves follow the tab's rendered box. */
export function useTabSelectionMotion(track:RefObject<HTMLDivElement|null>,activeId:string,inventory:string,target:{x:number;width:number;top:number},transition:Transition,layoutKey=inventory,copy=false){
 const selection=useRef<HTMLSpanElement>(null),x=useMotionValue(target.x),width=useMotionValue(target.width);
 const current=useRef({activeId,target});current.current={activeId,target};
 const previous=useRef<{activeId:string;inventory:string;layoutKey:string;key:string}|null>(null),dragging=useRef(false),tracking=useRef(false);
 const settled=useRef(0),since=useRef(0),last=useRef({x:NaN,width:NaN});
 const follow=useCallback(()=>{
  const root=track.current,node=selection.current;
  // A tab that is leaving can share its id with one coming back (reopen): follow the one that stays.
  // A linked tab (founder, 28 Oct) has two chips: the pill of its own chip follows the one outside the split tray, `copy` the tray's.
  const selected=root?.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(current.current.activeId)}"]${copy?'[data-link-copy]':':not([data-link-copy])'}:not([data-leaving])`);
  if(!root||!node||!selected){cancelFrame(follow);tracking.current=false;return;}
  const bounds=selected.getBoundingClientRect(),origin=root.getBoundingClientRect();
  const next={x:bounds.left-origin.left,width:bounds.width};
  const step=followFrame(last.current,next,current.current.target,performance.now()-since.current,dragging.current,settled.current);
  if(step.moved){
   x.jump(next.x);width.jump(next.width);
   // Projection and drag transforms have now rendered. Apply the same box before paint,
   // without putting another spring or one display frame between surface and content.
   node.style.transform=`translateX(${next.x}px) translateY(${current.current.target.top}px)`;
   node.style.width=`${next.width}px`;
  }
  // Quiet frames can precede a layout animation: keep following until the tab has reached its destination, or for
  // followSettleMs when its box rests a little off it (display scaling); never every frame forever (followFrame).
  settled.current=step.settled;
  last.current=next;
  if(settled.current>=4){cancelFrame(follow);tracking.current=false;}
 },[track,x,width]);
 const startFollowing=useCallback(()=>{
  x.stop();width.stop();settled.current=0;since.current=performance.now();last.current={x:NaN,width:NaN};
  if(!tracking.current){tracking.current=true;frame.postRender(follow,true);}
 },[follow,x,width]);
 useLayoutEffect(()=>{
  const key=`${inventory}:${layoutKey}:${target.x}:${target.width}`,before=previous.current;previous.current={activeId,inventory,layoutKey,key};
  if(!before){x.jump(target.x);width.jump(target.width);return;}
  if(before.activeId!==activeId&&before.inventory===inventory&&before.layoutKey===layoutKey&&!dragging.current&&!tracking.current){
   cancelFrame(follow);tracking.current=false;
   animate(x,target.x,transition);animate(width,target.width,transition);
  }else if(before.activeId!==activeId||before.key!==key)startFollowing();
 },[activeId,inventory,layoutKey,target.x,target.width,transition,follow,startFollowing,x,width]);
 useLayoutEffect(()=>()=>{cancelFrame(follow);x.stop();width.stop();},[follow,x,width]);
 return {selection,style:{x,y:target.top,width},startDrag:()=>{dragging.current=true;startFollowing();},endDrag:()=>{dragging.current=false;startFollowing();}};
}
