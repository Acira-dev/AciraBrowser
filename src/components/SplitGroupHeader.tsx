import { motion,useIsPresent } from 'motion/react';
import { useMemo,type CSSProperties,type ReactNode } from 'react';
import { morphSpring,motionScale } from '../ui/splitMotion';
import { stripLeave } from '../ui/sharedMotion';
import type { BrowserAction,TabSession } from '../runtime/types';
import type { SplitGroup } from '../runtime/splitLayout';
import { ChevronDown, Columns2, Globe2 } from './AppIcons';
import { t } from '../i18n';
import '../styles/split-groups.css';

/** The members' site icons for a folded chip: up to four, the stored or own favicon, a globe when there is none. */
export function splitMemberIcons(group:SplitGroup,tabs:readonly TabSession[],iconOf?:(url:string)=>string|undefined):ReactNode {
  return group.tabIds.flatMap(id=>tabs.find(tab=>tab.id===id)||[]).slice(0,4).map(tab=>{const src=tab.favicon||iconOf?.(tab.url);return src?<img key={tab.id} className="split-group-icon" src={src} alt="" draggable={false}/>:<Globe2 key={tab.id} size={12}/>;});
}

/** The parent opens the saved arrangement; its separate disclosure only shows or hides individual children. */
export function SplitGroupHeader({group,dispatch,active,sidebar=false,style,reducedMotion=false,onNavigateKey,temporary=false,onContext,nestedIn,icons}:{group:SplitGroup;dispatch:(action:BrowserAction)=>void;active:boolean;sidebar?:boolean;style?:CSSProperties;reducedMotion?:boolean;onNavigateKey?:(key:string)=>void;temporary?:boolean;/** Right-click, the Menu key or Shift+F10: where the chip is, so its own menu opens under it (R3-28). */onContext?:(anchor:{x:number;y:number;width:number;height:number})=>void;/** The tab group this split sits in (R3-27): the group's outline runs under the chip. */nestedIn?:string;/** Collapsed, the chip shows who is inside as the members' site icons (R3-24). */icons?:ReactNode}) {
  // R3-26: a chip arriving in the strip (a tab joined a split) settles on the research's `tab.merge` spring at the speed setting.
  const joinSpring=useMemo(()=>reducedMotion?{duration:0}:morphSpring('tab.merge',motionScale()),[reducedMotion]);
  const label=group.name||t('browsermenu.splitView'),name=t('acirasidebar.groupCountTabs',{group:label,count:group.tabIds.length});
  // Unsplit (founder 26 Oct: "clunky"): in a strip the leaving chip gives its room back on the strip spring while its label fades
  // first, and stays mounted until the room is closed, so the members glide once instead of jumping when it unmounts.
  const present=useIsPresent(),leaving=!present&&!sidebar,shown=leaving?{...style,'--tab-width':'0px','--tab-space':'0px','--tab-space-after':'0px',pointerEvents:'none'} as CSSProperties:style;
  const exit=useMemo(()=>sidebar?{opacity:0}:reducedMotion?{opacity:0,transition:{duration:0}}:stripLeave(),[sidebar,reducedMotion]);
  return <motion.div layout="position" initial={reducedMotion?false:{opacity:.7,scale:.985}} animate={{opacity:1,scale:1}} exit={exit} className={`split-group-parent ${sidebar?'split-group-sidebar':'tab-flow'}`} data-split-group={group.id} data-tab-group={nestedIn} data-active={active||undefined} data-flip={sidebar?`split:${group.id}`:undefined} data-leaving={leaving||undefined} style={shown} onContextMenu={event=>{if(!onContext)return;event.preventDefault();event.stopPropagation();const box=event.currentTarget.getBoundingClientRect();onContext({x:box.x,y:box.y,width:box.width,height:box.height});}} transition={joinSpring}>
    <button type="button" className="split-group-disclosure" data-sb-focus={sidebar||undefined} aria-label={t('routinespage.showTabs')} aria-expanded={!group.collapsed} onClick={()=>dispatch({type:'split.group.toggle',id:group.id})}><ChevronDown size={13} style={{transform:group.collapsed?'rotate(-90deg)':undefined}}/></button>
    <button type="button" className="split-group-open" data-sb-focus={sidebar||undefined} aria-label={name} aria-description={temporary?t('bm.notSaved'):undefined} aria-pressed={active} title={temporary?`${name} · ${t('bm.notSaved')}`:name} onClick={()=>dispatch({type:'split.group.select',id:group.id})} onKeyDown={event=>{if(onContext&&(event.key==='ContextMenu'||event.shiftKey&&event.key==='F10')){event.preventDefault();const box=event.currentTarget.closest('.split-group-parent')!.getBoundingClientRect();onContext({x:box.x,y:box.y,width:box.width,height:box.height});return;}if(onNavigateKey&&['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();onNavigateKey(event.key);}}}><Columns2 size={14}/><span>{label}</span>{group.collapsed&&icons?<span className="split-group-icons" aria-hidden="true">{icons}</span>:<small>{group.tabIds.length}</small>}</button>
  </motion.div>;
}
