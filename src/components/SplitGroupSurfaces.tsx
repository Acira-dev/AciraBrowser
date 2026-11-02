import { cancelFrame,frame } from 'motion/react';
import { useLayoutEffect,useRef,type RefObject } from 'react';
import type { TabStripEntry } from '../ui/tabStripEntries';
import '../styles/split-groups.css';

/** One joined container per split (R3-24): the chip and its member tabs sit inside a single rounded outline, so the
 *  people reading the strip see which tabs belong together. Like a tab group's tray it follows the rendered boxes (so it
 *  also follows entry, exit, reorder and fold animations) and is not a second layout: it only draws. It is distinct from
 *  a tab group's tray: a hairline ring on a neutral glass wash, the accent when its split is the one on screen. */
export function SplitGroupSurfaces({track,entries,activeId,layoutKey,dragging}:{track:RefObject<HTMLDivElement|null>;entries:readonly TabStripEntry[];activeId?:string;layoutKey:string;dragging?:string|null}){
 const chips=entries.filter(entry=>entry.header&&entry.splitGroup),nodes=useRef(new Map<string,HTMLElement>());
 useLayoutEffect(()=>{
  let quiet=0,until=performance.now()+700,signature='';
  const draw=()=>{
   const root=track.current;if(!root){return;}
   const origin=root.getBoundingClientRect(),next:string[]=[];
   for(const [id,tray] of nodes.current){
    const chip=root.querySelector<HTMLElement>(`[data-split-group="${CSS.escape(id)}"]`);
    if(!chip||chip.closest('[inert]')){tray.style.opacity='0';continue;}
    const members=[...root.querySelectorAll<HTMLElement>(`[data-split-member="${CSS.escape(id)}"]`)].filter(node=>node.offsetWidth>0);
    const boxes=[chip,...members].map(node=>node.hasAttribute('data-drag-preview-source')?new DOMRect(origin.left+node.offsetLeft,origin.top+node.offsetTop,node.offsetWidth,node.offsetHeight):node.getBoundingClientRect());
    const left=Math.min(...boxes.map(box=>box.left)),right=Math.max(...boxes.map(box=>box.right)),top=Math.min(...boxes.map(box=>box.top)),bottom=Math.max(...boxes.map(box=>box.bottom));
    // 3px of container beside its contents and 1px above and below keep a selected member's pill clear of the ring.
    const x=Math.max(0,left-origin.left-3),y=top-origin.top-1,width=Math.max(0,Math.min(root.scrollWidth,right-origin.left+3)-x),height=bottom-top+2;
    tray.style.opacity='';tray.style.transform=`translate3d(${x}px,${y}px,0)`;tray.style.width=`${width}px`;tray.style.height=`${height}px`;
    next.push([x,y,width,height].map(value=>value.toFixed(2)).join(','));
   }
   const now=next.join('|');quiet=now===signature?quiet+1:0;signature=now;
   if(!nodes.current.size||!dragging&&quiet>8&&performance.now()>until)cancelFrame(draw);
  };
  const wake=()=>{quiet=0;until=performance.now()+700;draw();frame.postRender(draw,true);};
  const observer=new ResizeObserver(wake);let boot=0;
  // The track's ref may not be attached yet on a cold mount: retry on the next frame instead of never measuring.
  const attach=()=>{const root=track.current;if(!root){boot=requestAnimationFrame(attach);return;}observer.observe(root);root.querySelectorAll('[data-split-group]').forEach(node=>observer.observe(node));wake();};
  attach();return()=>{cancelAnimationFrame(boot);observer.disconnect();cancelFrame(draw);};
 },[track,layoutKey,dragging]);
 return <>{chips.map(({splitGroup,nested})=><span key={splitGroup!.id} ref={node=>{if(node)nodes.current.set(splitGroup!.id,node);else nodes.current.delete(splitGroup!.id);}} aria-hidden="true" className="split-group-tray" data-split-tray={splitGroup!.id} data-active={activeId===splitGroup!.id||undefined} data-collapsed={splitGroup!.collapsed||undefined} data-nested={nested||undefined}/>)}</>;
}
