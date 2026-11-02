import { cancelFrame,frame,motion,useIsPresent } from 'motion/react';
import { useLayoutEffect,type CSSProperties,type RefObject } from 'react';
import type { TabGroup,TabSession } from '../runtime/types';
import type { TabStripEntry } from '../ui/tabStripEntries';
import { tabGroupColor } from '../ui/theme';
import type { TabStripDrag } from './TabGroupTray';

type Props={track:RefObject<HTMLDivElement|null>;entries:TabStripEntry[];tabs:TabSession[];groups:TabGroup[];drag:RefObject<TabStripDrag|null>;dragging:string|null;layoutKey:string};
export function TabGroupSurface({group,count,owns,scopeId,reducedMotion,compact,labelWidth}:{group:TabGroup;count:number;owns:string;scopeId:string;reducedMotion:boolean;compact:boolean;width:number;labelWidth:number}){
 const present=useIsPresent();
 return <motion.div id={`${scopeId}-tray-${group.id}`} style={{width:labelWidth+4,'--group-accent':group.color==='none'?'var(--ed-line)':tabGroupColor(group.color)} as CSSProperties} className={`tab-group-tray ${compact?'compact':''}`} data-group-tray={group.id} data-group-color={group.color} data-collapsed={group.collapsed} role="group" aria-label={`${group.name}, ${count} tabs`} aria-owns={owns} inert={!present||undefined} aria-hidden={!present||undefined} initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0,transition:{duration:reducedMotion?0:.5}}} transition={{opacity:{duration:reducedMotion?0:.12}}}/>;
}
/** One V2 container follows the actual rendered members. It has no independent
 * width animation to outrun tab entry, exit, reorder or interrupted collapse. */
export function TabGroupSurfaces({track,dragging,layoutKey}:Props){
 useLayoutEffect(()=>{
  let signature='',quiet=0,until=performance.now()+700;
  const draw=()=>{
   const root=track.current;if(!root)return;const origin=root.getBoundingClientRect();
   const headers=[...root.querySelectorAll<HTMLElement>('[data-group-header]')],members=[...root.querySelectorAll<HTMLElement>('[data-tab-group]')];
   const boxes=new Map([...headers,...members].map(node=>[node,node.hasAttribute('data-drag-preview-source')?new DOMRect(origin.left+node.offsetLeft,origin.top+node.offsetTop,node.offsetWidth,node.offsetHeight):node.getBoundingClientRect()]));
   const measured=[...root.querySelectorAll<HTMLElement>('[data-group-tray]')].flatMap(surface=>{
    const id=surface.dataset.groupTray,header=headers.find(node=>node.dataset.groupHeader===id);
    if(!header)return [];const box=boxes.get(header)!;
    // Include exits until their occupied width has collapsed. A dragged tab
    // keeps its layout slot; its separate preview must not stretch the tray.
    const contents=members.filter(node=>node.dataset.tabGroup===id&&node.offsetWidth>0).map(node=>boxes.get(node)!);
    const left=box.left-(header.offsetWidth-box.width)/2,right=left+header.offsetWidth;
    const start=Math.min(left,...contents.map(box=>box.left)),end=Math.max(right,...contents.map(box=>box.right));
    // 3px of tray beside its members keeps a selected member's white sheet clear of the group ring;
    // vertically the tray stays 30px inside the 36px row.
    const x=Math.max(0,start-origin.left-3),rightEdge=Math.min(root.scrollWidth,end-origin.left+3);
    return [{surface,x,y:box.top-origin.top-(header.offsetHeight-box.height)/2-2,width:Math.max(0,rightEdge-x),height:header.offsetHeight+4}];
   });
   for(const {surface,x,y,width,height} of measured){surface.style.left=`${x}px`;surface.style.top=`${y}px`;surface.style.width=`${width}px`;surface.style.height=`${height}px`;}
   const next=measured.map(({x,y,width,height})=>[x,y,width,height].map(value=>value.toFixed(2)).join(',')).join('|');quiet=next===signature?quiet+1:0;signature=next;
   if(!measured.length||!dragging&&quiet>8&&performance.now()>until)cancelFrame(draw);
  };
  // A newly revealed layout can first commit while its ancestors still have
  // zero geometry. Observe its real size instead of freezing that first read.
  const wake=()=>{quiet=0;until=performance.now()+700;draw();frame.postRender(draw,true);};
  // This effect belongs to a child of the track, so on a cold mount it can run before
  // the track's ref is attached. Retry on the next frame instead of never measuring.
  const observer=new ResizeObserver(wake);let boot=0;
  const attach=()=>{const root=track.current;if(!root){boot=requestAnimationFrame(attach);return;}observer.observe(root);root.querySelectorAll('[data-group-header]').forEach(node=>observer.observe(node));if(root.querySelector('[data-group-tray]'))wake();};
  attach();return()=>{cancelAnimationFrame(boot);observer.disconnect();cancelFrame(draw);};
 },[track,layoutKey,dragging]);
 return null;
}
