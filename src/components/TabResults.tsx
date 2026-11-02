import { motion } from 'motion/react';
import { useLayoutEffect,useRef,useState,type ReactNode } from 'react';
import type { TabSession } from '../runtime/types';
import { tabDisplayTitle } from '../runtime/tabTitle';
import { revealInViewport } from '../ui/scrollReveal';
import { useListMotion } from '../ui/sharedMotion';
import { Pin,X } from './AppIcons';

import { t as tr } from '../i18n';
/** One moving selection surface; rows and text keep their own pixel geometry. */
/** Host only, as in the palette spec: the title carries the page, the host says where it is. */
const tabHost=(url:string)=>{try{const parsed=new URL(url);return parsed.protocol==='acira:'?'':parsed.host.replace(/^www\./,'');}catch{return url;}};
/** Comfortable rows (the original viewer, founder 25 Oct) show the whole address under the title, without the scheme. */
const tabAddress=(url:string)=>{try{const parsed=new URL(url);if(parsed.protocol==='acira:')return '';return (parsed.host.replace(/^www\./,'')+parsed.pathname.replace(/\/$/,'')+parsed.search).slice(0,240);}catch{return url;}};
export type TabViewerDensity='comfortable'|'compact';
export function TabResults({tabs,groups,currentId,cursorId,inputMode,animateSelection,reducedMotion,speed,renderIcon,onCursor,onSelect,onClose,density='compact'}:{
 density?:TabViewerDensity;
 tabs:TabSession[];
 /** R4-48 P1-2: while searching, the other workspaces' matching tabs, each group under its workspace's name; choosing one switches there. */
 groups?:{id:string;name:string;tabs:TabSession[]}[];currentId:string;cursorId:string;inputMode:'keyboard'|'pointer';
 animateSelection:boolean;reducedMotion:boolean;speed:number;
 renderIcon:(tab:TabSession)=>ReactNode;onCursor:(id:string)=>void;
 onSelect:(id:string)=>void;onClose:(id:string)=>void;
}){
 const list=useRef<HTMLDivElement>(null);
 const revealed=useRef(false);
 const [bounds,setBounds]=useState<{y:number;width:number;height:number}|null>(null);
 const every=groups?.length?[...tabs,...groups.flatMap(group=>group.tabs)]:tabs;
 const selected=every.some(t=>t.id===cursorId)?cursorId:every[0]?.id;
 const inventory=every.map(t=>t.id).join('|');
 useLayoutEffect(()=>{
  const root=list.current,node=root?.querySelector<HTMLElement>(`.tab-result[data-tab-id="${selected}"]`);
  if(!root||!node)return;
  const measure=()=>{let y=0,current:HTMLElement|null=node;while(current&&current!==root){y+=current.offsetTop;current=current.offsetParent as HTMLElement|null;}if(current!==root)return;const next={y,width:node.offsetWidth,height:node.offsetHeight};setBounds(old=>old?.y===next.y&&old.width===next.width&&old.height===next.height?old:next);};
  measure();const observer=new ResizeObserver(measure);observer.observe(root);observer.observe(node);return()=>observer.disconnect();
 },[selected,inventory]);
 useLayoutEffect(()=>{
  const root=list.current,node=root?.querySelector<HTMLElement>(`.tab-result[data-tab-id="${selected}"]`),viewport=root?.closest<HTMLElement>('.popup-scroll');
  if(!node||!viewport||inputMode!=='keyboard')return;
  const duration=revealed.current&&!reducedMotion?130/Math.max(.5,speed):0;
  revealed.current=true;
  const cancel=revealInViewport(viewport,node,duration);
  // Direct wheel/touch scrolling takes ownership immediately.
  viewport.addEventListener('wheel',cancel,{passive:true});viewport.addEventListener('pointerdown',cancel);
  return()=>{cancel();viewport.removeEventListener('wheel',cancel);viewport.removeEventListener('pointerdown',cancel);};
 },[selected,inventory,inputMode,reducedMotion,speed]);
 // Filtering the viewer moves its rows on the shared list motion (A, round 2).
 useListMotion(list,every.map(tab=>tab.id).join(' '),{frequent:true});
 const comfortable=density==='comfortable';
 const row=(tab:TabSession)=><div className="tab-result-row" key={tab.id} data-cursor={tab.id===selected}>
   <button data-tab-id={tab.id} data-cursor={tab.id===selected} aria-current={tab.id===currentId?'page':undefined} onFocus={()=>onCursor(tab.id)} className={`tab-result ${tab.id===currentId?'selected':''}`} onClick={()=>onSelect(tab.id)}>
    {comfortable?<span className="tab-result-tile">{renderIcon(tab)}</span>:renderIcon(tab)}<span className="tab-result-label"><strong>{tabDisplayTitle(tab)}</strong>{(comfortable?tabAddress(tab.url):tab.group||tabHost(tab.url))&&<small>{comfortable?tabAddress(tab.url):tab.group||tabHost(tab.url)}</small>}</span>{tab.pinned&&<Pin size={14}/>}
   </button>
   <button className="tab-result-close" aria-label={tr("app.closeTitle", { title: tabDisplayTitle(tab) })} onClick={()=>onClose(tab.id)}><X size={15}/></button>
  </div>;
 return <div ref={list} className="tab-result-list" data-density={density}>
  {animateSelection&&selected&&bounds&&<motion.div aria-hidden="true" data-motion-skip className="tab-switcher-selection" initial={false} animate={{...bounds,opacity:1}} transition={{duration:reducedMotion?0:.14/Math.max(.5,speed),ease:[.2,.8,.2,1]}}/>}
  {tabs.map(row)}
  {groups?.map(group=><div className="tab-result-group" role="group" aria-label={tr("workspaces.foundIn",{name:group.name})} key={group.id}>
   <div className="tab-result-group-head" aria-hidden="true">{tr("workspaces.foundIn",{name:group.name})}</div>
   {group.tabs.map(row)}
  </div>)}
 </div>;
}
