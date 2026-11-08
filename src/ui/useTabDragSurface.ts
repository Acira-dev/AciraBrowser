import { animate,cancelFrame,frame } from 'motion/react';
import { useCallback,useLayoutEffect,useRef,type RefObject } from 'react';
import { morphSpring,motionScale } from './splitMotion';
import { liquidChip,type Liquid,type LiquidTarget } from './liquidSnap';
import { fillChipIcon } from './chipIcon';
import type { SidebarSide } from '../runtime/types';

/** The carried tab (R3-23/R3-26): below the strip a dragged tab is not a pill any more but its site icon on a small glass
 *  chip that follows the pointer, so it can be taken anywhere (the split picker, another window) and morphs back to a full
 *  tab when it returns to the strip. One progress value per drag (0 pill, 1 chip) on the research's spring, retargeted
 *  from wherever it is, so a reversal mid-flight is smooth. */
export const CARRIED_SIZE=28;
/** Hysteresis for leaving the strip: the chip forms 10px below it and the pill returns once back at its bottom edge. */
export function carriedState(was:boolean,pointerY:number,stripBottom:number){return was?pointerY>stripBottom+2:pointerY>stripBottom+10;}
/** The same hysteresis for a drag out of the sidebar, along x: `edge` is where the sidebar ends and the page begins (ui/sidebarLayout sidebarEdgeOf),
 * the chip forms 10px past it, toward the page, and the row returns once back within 2px of it. On the right the page lies at smaller x, so the
 * hysteresis is the left one seen in a mirror (x and edge negated). */
export function carriedBeyondEdge(was:boolean,x:number,edge:number,side:SidebarSide='left'){return side==='right'?carriedState(was,-x,-edge):carriedState(was,x,edge);}

/** A carried chip for a drag that has no strip preview (sidebar rows, R3-23): the row's icon on the same glass chip. It grows
 *  out of the icon once the pointer leaves `edge`, the sidebar's page-side edge (hysteresis as `carriedState`; see `carriedBeyondEdge` for the right side), follows the pointer freely in 2D, and goes back
 *  into the icon when the pointer returns or the drag ends, on the strip chip's springs. `end(true)` hands over at once (a split
 *  drop: the pane morph flies in from the chip's box). Works the same with one tab or many. */
export function carryChip(row:HTMLElement,iconSelector:string,{only,side='left',icon:given,badge,color}:{/** The targets this chip may stick to (all of them when absent). */only?:(target:LiquidTarget)=>boolean;/** The side the source sidebar is on: the page, and so the chip, lies beyond `edge` toward larger x on the left and smaller x on the right. */side?:SidebarSide;/** The icon to carry in place of a copy of the row's own (a group's folder: it is drawn from the group's colour, which a copy outside the group loses). */icon?:HTMLElement;/** A count on the chip's corner (a group's tabs). */badge?:string;/** The colour of that count. */color?:string}={}){
 const icon=row.querySelector<HTMLElement>(iconSelector)??row,home=icon.getBoundingClientRect(),chip=document.createElement('div');
 chip.className='tab-drag-preview tab-drag-chip';chip.setAttribute('aria-hidden','true');chip.inert=true;if(given)chip.append(given);else{chip.append(icon.cloneNode(true));fillChipIcon(chip,row.dataset.tabId??row.querySelector<HTMLElement>('[data-tab-id]')?.dataset.tabId);}
 if(badge){const mark=document.createElement('span');mark.className='tab-drag-chip-count';mark.textContent=badge;if(color)mark.style.setProperty('--chip-count',color);chip.append(mark);}
 Object.assign(chip.style,{position:'fixed',left:'0px',top:'0px',width:`${CARRIED_SIZE}px`,height:`${CARRIED_SIZE}px`,margin:'0',zIndex:'1000',pointerEvents:'none',opacity:'0'});
 (row.closest('.app')||document.body).append(chip);
 const state={p:0,target:0 as 0|1,stop:undefined as undefined|(()=>void),pointer:{x:home.left+home.width/2,y:home.top+home.height/2},gone:false,liquid:null as Liquid|null};
 const lerp=(a:number,b:number,t:number)=>a+(b-a)*t,cx=home.left+home.width/2,cy=home.top+home.height/2,small=Math.max(.3,Math.min(1,home.width/CARRIED_SIZE));
 // The spring may overshoot (1.04) but the chip never flies past the pointer: its place and size stop at the pointer (R4-28).
 const place=()=>{const p=Math.min(1,state.p),lean=state.liquid?.offset()??{x:0,y:0},x=lerp(cx,state.pointer.x+lean.x,p),y=lerp(cy,state.pointer.y+lean.y,p);chip.style.transform=`translate3d(${x-CARRIED_SIZE/2}px,${y-CARRIED_SIZE/2}px,0) scale(${lerp(small,1,Math.min(1,p))})`;chip.style.opacity=String(Math.max(0,Math.min(1,p*2.5)));chip.style.setProperty('--chip-p',String(Math.max(0,Math.min(1,p))));};
 const aim=(target:0|1,done?:()=>void)=>{
  state.target=target;state.stop?.();const scale=motionScale();
  if(scale===0){state.p=target;place();done?.();return;}
  const spring=morphSpring(target?'tab.split':'tab.merge',scale) as {stiffness:number;damping:number;mass:number};
  const controls=animate(state.p,target,{...spring,onUpdate:value=>{state.p=Math.max(0,Math.min(1.04,value));place();},onComplete:done});
  state.stop=()=>controls.stop();
 };
 // R3-80: the carried chip sticks to drop targets like water (liquidSnap); its frame loop re-places the chip.
 state.liquid=liquidChip(chip,{exclude:row.dataset.tabId??row.querySelector<HTMLElement>('[data-tab-id]')?.dataset.tabId??'',only,onFrame:()=>{if(!state.gone)place();}});
 const remove=()=>{if(state.gone)return;state.gone=true;state.stop?.();state.liquid?.end(true);chip.remove();};
 return {
  /** The pointer moved; `edge` is where the source list ends (the chip forms 10px past it, toward the page). */
  move(point:{x:number;y:number},edge:number){if(state.gone)return;state.pointer=point;const target=carriedBeyondEdge(state.target===1,point.x,edge,side)?1:0;state.liquid?.point(point,target===1);if(target!==state.target)aim(target);else place();},
  end(handOver=false){if(state.gone)return;state.liquid?.end(handOver);if(handOver||state.p<.02){remove();return;}aim(0,remove);setTimeout(remove,1500);},
 };
}

interface Surface{node:HTMLElement;held:boolean;/** A sideways reorder (ui/tabDragAxis): the tab is drawn on its row's height whatever the pointer's. */row?:boolean;quiet:number;bg?:string;preview?:HTMLElement;chip:{p:number;target:0|1;stop?:()=>void};pointer?:{x:number;y:number};padding?:[number,number];liquid?:Liquid}
/** Keep a dragged tab opaque until its return and neighboring layout have settled. */
export function useTabDragSurface(track:RefObject<HTMLDivElement|null>){
 const surfaces=useRef(new Map<string,Surface>());
 const removePreview=(surface:Surface)=>{surface.chip.stop?.();surface.liquid?.end(true);surface.liquid=undefined;surface.preview?.remove();surface.node.removeAttribute('data-drag-preview-source');};
 const following=useRef(false);
 const lerp=(a:number,b:number,t:number)=>a+(b-a)*t;
 const follow=useCallback(()=>{
  const root=track.current;
  if(root){
   const origin=root.getBoundingClientRect(),nodes=[...root.querySelectorAll<HTMLElement>('[data-tab-id],[data-group-header]')];
   const boxes=new Map(nodes.map(node=>[node,node.getBoundingClientRect()]));
   for(const [id,surface] of surfaces.current){
    const {node}=surface,box=boxes.get(node);
    if(!box){removePreview(surface);node.removeAttribute('data-drag-surface');surfaces.current.delete(id);continue;}
    if(surface.preview){
     // A separate visual follows the measured tab above the scroll viewport; carried below the strip it is a chip on the pointer.
     const p=Math.min(1,surface.chip.p),pointer=surface.pointer,width=lerp(box.width,CARRIED_SIZE,p),height=lerp(box.height,CARRIED_SIZE,p);
     // As a chip it also leans into a drop target it nears (liquid snap, R3-80), scaled by how much of a chip it is.
     const lean=surface.liquid?.offset()??{x:0,y:0};
     const natural=surface.row?origin.top+node.offsetTop:box.top,left=pointer&&p>0?lerp(box.left,pointer.x+lean.x-width/2,p):box.left,top=pointer&&p>0?lerp(natural,pointer.y+lean.y-height/2,p):natural;
     const style=surface.preview.style;
     style.transform=`translate3d(${left}px,${top}px,0)`;style.width=`${width}px`;style.height=`${height}px`;
     style.setProperty('--chip-p',String(p));
     if(surface.padding){style.paddingLeft=`${lerp(surface.padding[0],(CARRIED_SIZE-16)/2,p)}px`;style.paddingRight=`${lerp(surface.padding[1],0,p)}px`;}
     style.background=p>.02?'transparent':surface.bg??'';
    }
    if(surface.held)continue;
    const arrived=Math.abs(box.left-origin.left-node.offsetLeft)<.75&&Math.abs(box.top-origin.top-node.offsetTop)<.75&&Math.abs(box.width-node.offsetWidth)<.75;
    const overlap=[...boxes].some(([other,b])=>other!==node&&Math.min(box.right,b.right)-Math.max(box.left,b.left)>.75&&Math.min(box.bottom,b.bottom)-Math.max(box.top,b.top)>.75);
    surface.quiet=arrived&&!overlap&&surface.chip.p<.02?surface.quiet+1:0;
    if(surface.quiet>=4){removePreview(surface);node.removeAttribute('data-drag-surface');surfaces.current.delete(id);}
   }
  }else {for(const surface of surfaces.current.values())removePreview(surface);surfaces.current.clear();}
  if(!surfaces.current.size){cancelFrame(follow);following.current=false;}
 },[track]);
 const start=useCallback((id:string)=>{
  // A chip is named by data-drag-key (the tab id, or the key of a linked copy: one tab drawn twice).
  const node=track.current?.querySelector<HTMLElement>(`[data-drag-key="${CSS.escape(id)}"]`)||track.current?.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(id)}"]`);if(!node)return;
  for(const surface of surfaces.current.values())if(surface.held){surface.held=false;surface.node.setAttribute('data-drag-surface','settling');}
  const previous=surfaces.current.get(id);if(previous)removePreview(previous);
  node.setAttribute('data-drag-surface','held');
  const preview=node.cloneNode(true) as HTMLElement,box=node.getBoundingClientRect(),computed=getComputedStyle(node);
  for(const child of [preview,...preview.querySelectorAll<HTMLElement>('*')]){
   for(const name of ['id','data-tab-id','data-group-header','data-drag-surface','role','tabindex','aria-selected','aria-controls','aria-labelledby'])child.removeAttribute(name);
  }
  preview.classList.add('tab-drag-preview');preview.setAttribute('aria-hidden','true');preview.inert=true;fillChipIcon(preview,node.dataset.tabId??id);/* a loading tab's dot matrix copies blank: never an empty chip */
  Object.assign(preview.style,{position:'fixed',left:'0px',top:'0px',margin:'0',width:`${box.width}px`,height:`${box.height}px`,minWidth:'0',maxWidth:'none',padding:computed.padding,transform:`translate3d(${box.left}px,${box.top}px,0)`,transition:'none',opacity:'1',background:computed.backgroundColor,color:computed.color,zIndex:'1000',pointerEvents:'none'});
  (node.closest('.app')||document.body).append(preview);node.setAttribute('data-drag-preview-source','true');
  surfaces.current.set(id,{node,held:true,quiet:0,preview,bg:computed.backgroundColor,chip:{p:0,target:0},padding:[parseFloat(computed.paddingLeft)||0,parseFloat(computed.paddingRight)||0],liquid:liquidChip(preview,{exclude:id})});
  if(!following.current){following.current=true;frame.postRender(follow,true);}
 },[track,follow]);
 const project=useCallback((id:string)=>{
  if(surfaces.current.has(id))return;
  const node=track.current?.querySelector<HTMLElement>(`[data-drag-key="${CSS.escape(id)}"]`)||track.current?.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(id)}"],[data-group-header="${CSS.escape(id)}"]`);if(!node)return;
  surfaces.current.set(id,{node,held:false,quiet:0,chip:{p:0,target:0}});node.setAttribute('data-drag-surface','layout');
  if(!following.current){following.current=true;frame.postRender(follow,true);}
 },[track,follow]);
 /** The drag is a sideways reorder: the tab keeps to its row for the rest of the drag and its settling (the vertical wobble of the hand is not drawn). */
 const pin=useCallback((id:string)=>{const surface=surfaces.current.get(id);if(surface)surface.row=true;},[]);
 /** Where the pointer is and whether the tab is out of the strip: the pill morphs to the icon chip (or back), retargeting from where it is. */
 const carry=useCallback((id:string,point:{x:number;y:number},stripBottom:number,enabled=true)=>{
  const surface=surfaces.current.get(id);if(!surface?.preview)return;
  surface.pointer=point;
  const target=enabled&&carriedState(surface.chip.target===1,point.y,stripBottom)?1:0;
  surface.liquid?.point(point,target===1);// only a chip sticks to targets; as a pill in the strip it reorders
  if(surface.chip.target===target)return;
  surface.chip.target=target;surface.chip.stop?.();
  const scale=motionScale();
  if(scale===0){surface.chip.p=target;return;}
  const spring=morphSpring(target?'tab.split':'tab.merge',scale) as {stiffness:number;damping:number;mass:number};
  const controls=animate(surface.chip.p,target,{...spring,onUpdate:value=>{surface.chip.p=Math.max(0,Math.min(1.04,value));}});
  surface.chip.stop=()=>controls.stop();
 },[]);
 /** The drag is over. A tab released over the strip settles into its slot (the chip morphs back on the way); one dropped on a split zone
  *  hands over at once: the morph takes it from the chip's own box (hide). */
 const end=useCallback((id:string,hide=false)=>{
  const surface=surfaces.current.get(id);if(!surface)return;
  if(hide){removePreview(surface);surface.node.removeAttribute('data-drag-surface');surfaces.current.delete(id);return;}
  surface.held=false;surface.quiet=0;surface.node.setAttribute('data-drag-surface','settling');
  if(surface.chip.target!==0||surface.chip.p>0)carry(id,surface.pointer??{x:0,y:0},0,false);
 },[carry]);
 useLayoutEffect(()=>()=>{cancelFrame(follow);for(const surface of surfaces.current.values()){removePreview(surface);surface.node.removeAttribute('data-drag-surface');}surfaces.current.clear();following.current=false;},[follow]);
 return {start,end,project,carry,pin};
}
