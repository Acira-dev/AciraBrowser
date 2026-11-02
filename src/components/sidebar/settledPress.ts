import { useEffect } from 'react';

/** A press while rows are still sliding (useFlip: a tab just joined a split, a row closed, a fold) lands on what will be under
 *  the pointer once they settle (28 Oct: a click 40–250 ms after a join selected the neighbour drawn over that place mid-slide).
 *  Rows are hit-tested against their layout boxes (the painted box minus the running slide's translate); when that row is not
 *  the one drawn under the pointer, the press, the click and the menu go to the same spot of the settled row instead. Nothing
 *  moves and nothing else changes: outside a slide every event passes through untouched. */
const ROWS='[data-flip],.split-group-parent';

/** The slide still to run under `el` (its own and its ancestors' running animations, up to the scroll box), in px. */
function slideShift(el:Element,box:Element):number{
 let dy=0;
 for(let node:Element|null=el;node&&node!==box;node=node.parentElement){
  if(!node.getAnimations().some(animation=>animation.playState==='running'))continue;
  const transform=getComputedStyle(node).transform;if(transform&&transform!=='none')dy+=new DOMMatrixReadOnly(transform).m42;
 }
 return dy;
}

/** The control a press at (x, y) reaches once every row has settled, or null when that is what is drawn there now. */
export function settledTarget(box:HTMLElement,x:number,y:number):HTMLElement|null{
 const rows=[...box.querySelectorAll<HTMLElement>(ROWS)].filter(row=>row.offsetHeight&&!row.closest('.sb-flip-ghost,[data-hidden]'));
 if(!rows.some(row=>slideShift(row,box)!==0))return null;
 let best:{row:HTMLElement;height:number;shift:number}|null=null;
 for(const row of rows){
  const r=row.getBoundingClientRect(),shift=slideShift(row,box),top=r.top-shift;
  if(x<r.left||x>r.right||y<top||y>=top+r.height)continue;
  if(!best||r.height<best.height)best={row,height:r.height,shift};
 }
 if(!best)return null;
 const drawn=document.elementFromPoint(x,y)?.closest<HTMLElement>(ROWS);
 if(drawn===best.row)return null;
 // The same spot of the settled row, where it is drawn now (another row may still be drawn over it: take the first of its own).
 const own=document.elementsFromPoint(x,y+best.shift).find(node=>best.row.contains(node)) as HTMLElement|undefined;
 return own||best.row.querySelector<HTMLElement>('.sb-tab-main,.split-group-open')||best.row;
}

/** Installed once on the window (capture phase), so it holds whenever the scroll box mounts or remounts. */
export function useSettledPress(root:{current:HTMLElement|null}){
 useEffect(()=>{
  let pending:{control:HTMLElement;at:number}|null=null;
  const inside=(event:Event)=>{const box=root.current;return box&&event.target instanceof Node&&box.contains(event.target)?box:null;};
  const resend=(control:HTMLElement,event:MouseEvent)=>{event.stopPropagation();event.preventDefault();control.dispatchEvent(event instanceof PointerEvent?new PointerEvent(event.type,event):new MouseEvent(event.type,event));};
  const down=(event:PointerEvent)=>{
   if(!event.isTrusted)return;// the press re-sent below passes here too
   pending=null;
   const box=event.isPrimary?inside(event):null;if(!box)return;
   const control=settledTarget(box,event.clientX,event.clientY);
   if(!control)return;
   pending={control,at:performance.now()};resend(control,event);
  };
  // The click (and a right-click's menu, a middle-click) of that press follows it to the settled row.
  const follow=(event:MouseEvent)=>{
   if(!event.isTrusted||!pending||!inside(event))return;
   if(performance.now()-pending.at>1500||!pending.control.isConnected){pending=null;return;}
   const control=pending.control;if(event.type!=='contextmenu')pending=null;
   if(control.contains(event.target as Node))return;
   resend(control,event);
   if(event.type==='click')control.closest<HTMLElement>('button,[tabindex]')?.focus({preventScroll:true});
  };
  window.addEventListener('pointerdown',down,true);window.addEventListener('click',follow,true);window.addEventListener('contextmenu',follow,true);window.addEventListener('auxclick',follow,true);
  return()=>{window.removeEventListener('pointerdown',down,true);window.removeEventListener('click',follow,true);window.removeEventListener('contextmenu',follow,true);window.removeEventListener('auxclick',follow,true);};
 },[root]);
}
