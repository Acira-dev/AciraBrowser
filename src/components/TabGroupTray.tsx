import { cancelFrame,frame,motion,useIsPresent } from 'motion/react';
import { useEffect,useLayoutEffect,useRef,useState,type CSSProperties,type RefObject } from 'react';
import type { BrowserAction,TabGroup,TabSession } from '../runtime/types';
import { groupForTab } from '../runtime/tabGroups';
import { TabGroupBadge } from './TabGroupControls';
import { groupDropAtPoint,groupKeyboardDrop,tabDropAtPoint,type TabDropIntent } from './tabGroupDrag';

import { t } from '../i18n';
export type TabStripDrag={id:string;point:{x:number;y:number};intent?:TabDropIntent|null};
export type GroupAnchor={x:number;y:number;width:number;height:number};
export const groupSpring={type:'spring' as const,stiffness:322,damping:30.5,mass:1};
export function useGroupRename(ref:RefObject<HTMLElement|null>){
 const [editing,setEditing]=useState(false);
 useEffect(()=>{const node=ref.current;if(!node)return;const rename=()=>setEditing(true);node.addEventListener('acira-group-rename',rename);return()=>node.removeEventListener('acira-group-rename',rename);},[ref]);
 return {editing,start:()=>setEditing(true),stop:()=>setEditing(false)};
}
export function GroupNameInput({group,groups,onSave,onCancel}:{group:TabGroup;groups:TabGroup[];onSave:(name:string)=>void;onCancel:()=>void}){
 const ref=useRef<HTMLInputElement>(null),[name,setName]=useState(group.name),[invalid,setInvalid]=useState(false),done=useRef(false);
 useLayoutEffect(()=>{ref.current?.focus({preventScroll:true});ref.current?.select();},[]);
 const finish=(blur=false)=>{
  if(done.current)return;const value=name.trim();
  if(value&&groups.some(other=>other.id!==group.id&&other.browserProfileId===group.browserProfileId&&other.name===value)){if(blur){done.current=true;onCancel();}else{setInvalid(true);ref.current?.select();}return;}
  done.current=true;if(value&&value!==group.name)onSave(value);onCancel();
 };
 return <input ref={ref} className="tab-group-rename" aria-label={t("tabgrouptray.groupName")} aria-invalid={invalid||undefined} title={invalid?t("tabgrouptray.aGroupWithThisName"):''} value={name} maxLength={64} onChange={event=>{setName(event.target.value);setInvalid(false);}} onBlur={()=>finish(true)} onPointerDown={event=>event.stopPropagation()} onKeyDown={event=>{event.stopPropagation();if(event.nativeEvent.isComposing)return;if(event.key==='Enter'){event.preventDefault();finish();}if(event.key==='Escape'){event.preventDefault();done.current=true;onCancel();}}}/>;
}

export function TabGroupHeader({group,count,tab,tabs,groups,labelWidth,leadingSpace=0,ownerId,compact=false,reducedMotion,dispatch,viewport,onContext,onNavigateKey,onPreview,activeTabId,onProject}:{activeTabId:string;onProject?:()=>void;group:TabGroup;count:number;tab:TabSession;tabs:TabSession[];groups:TabGroup[];labelWidth:number;leadingSpace?:number;ownerId:string;compact?:boolean;reducedMotion:boolean;dispatch:(action:BrowserAction)=>void;viewport:RefObject<HTMLDivElement|null>;onContext:(id:string,anchor:GroupAnchor,isGroup?:boolean)=>void;onNavigateKey:(key:string)=>void;onPreview?:(id:string,anchor:GroupAnchor,visible:boolean,force?:boolean)=>void}){
 const present=useIsPresent();
 /* Every tab of the group is asleep (memory saver): its label goes quiet like a sleeping tab's title (tab-sleeping.css). */
 const allAsleep=(()=>{const members=tabs.filter(member=>groupForTab({tabGroups:groups},member)?.id===group.id);return members.length>0&&members.every(member=>member.sleeping);})();
 const [pressed,setPressed]=useState(false),renameOrigin=useRef<{time:number;activeId:string;collapsed:boolean}|null>(null);
 const header=useRef<HTMLDivElement>(null),editor=useGroupRename(header),previewTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
 const bounds=()=>{const b=header.current!.getBoundingClientRect();return{x:b.x,y:b.y,width:b.width,height:b.height};};
 const clear=()=>clearTimeout(previewTimer.current);
 const preview=(visible:boolean)=>{clear();if(!group.collapsed||editor.editing)return;previewTimer.current=setTimeout(()=>{if(header.current)onPreview?.(tab.id,bounds(),visible);},visible?400:100);};
 useEffect(()=>{if(!group.collapsed)clearTimeout(previewTimer.current);return()=>clearTimeout(previewTimer.current);},[group.collapsed,tab.id,group.name,editor.editing]);
 return <motion.div inert={!present||undefined} aria-hidden={!present||undefined} layout="position" onLayoutAnimationStart={onProject} ref={header} id={ownerId} style={{'--tab-width':`${present?labelWidth:0}px`,'--tab-space':`${present?leadingSpace:0}px`} as CSSProperties} className={`tab-group-header tab-flow ${compact?'compact':''}`} data-group-header={group.id} data-group-tab={tab.id} data-group-collapsed={group.collapsed} data-all-asleep={allAsleep||undefined} initial={{opacity:0}} exit={{opacity:0,transition:{duration:reducedMotion?0:.5}}} animate={{opacity:1,scale:pressed&&!reducedMotion ? .97 : 1}} transition={reducedMotion?{duration:0}:{...groupSpring,scale:{type:'spring',stiffness:1755,damping:72}}} onPointerDownCapture={event=>{if(event.button!==0)return;clear();setPressed(true);if(!renameOrigin.current||event.timeStamp-renameOrigin.current.time>400)renameOrigin.current={time:event.timeStamp,activeId:activeTabId,collapsed:group.collapsed};}} onPointerUp={()=>setPressed(false)} onPointerCancel={()=>setPressed(false)} onPointerEnter={()=>{viewport.current?.querySelector(`[data-group-tray="${CSS.escape(group.id)}"]`)?.setAttribute('data-hover','true');preview(true);}} onPointerLeave={()=>{setPressed(false);viewport.current?.querySelector(`[data-group-tray="${CSS.escape(group.id)}"]`)?.removeAttribute('data-hover');preview(false);}}
   onDoubleClick={event=>{event.preventDefault();event.stopPropagation();clear();const origin=renameOrigin.current;if(origin){if(origin.activeId!==activeTabId)dispatch({type:'tab.select',id:origin.activeId});if(origin.collapsed!==group.collapsed)dispatch({type:'tab.group.update',id:group.id,patch:{collapsed:origin.collapsed}});}editor.start();}}
   onContextMenu={event=>{event.preventDefault();event.stopPropagation();clear();const b=event.currentTarget.getBoundingClientRect();onContext(tab.id,{x:b.x,y:b.y,width:b.width,height:b.height},true);}}
   onKeyDown={event=>{if(editor.editing)return;if(event.key==='ContextMenu'||event.shiftKey&&event.key==='F10'){event.preventDefault();onContext(tab.id,bounds(),true);}else if(event.altKey){const move=groupKeyboardDrop(tabs,groups,group.id,event.key);if(move){event.preventDefault();dispatch(move);}}else if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key)){event.preventDefault();onNavigateKey(event.key);}}}>
   {editor.editing?<GroupNameInput group={group} groups={groups} onSave={name=>dispatch({type:'tab.group.update',id:group.id,patch:{name}})} onCancel={()=>{editor.stop();requestAnimationFrame(()=>header.current?.querySelector('button')?.focus({preventScroll:true}));}}/>:
    <TabGroupBadge reducedMotion={reducedMotion} standalone group={group} collapsed={group.collapsed} count={count} onMove={point=>{clear();const drop=groupDropAtPoint(viewport.current,point,tab.id,tabs,groups);if(drop)dispatch(drop);}} onToggle={()=>{clear();onPreview?.(tab.id,bounds(),false,true);dispatch({type:'tab.group.update',id:group.id,patch:{collapsed:!group.collapsed}});}}/>}
  </motion.div>;
}

/** Drop feedback belongs to the tray. No SVG contour or colored membership rail. */
export function TabGroupDropFeedback({track,viewport,tabs,groups,drag,dragging}:{track:RefObject<HTMLDivElement|null>;viewport:RefObject<HTMLDivElement|null>;tabs:TabSession[];groups:TabGroup[];drag:RefObject<TabStripDrag|null>;dragging:string|null}){
 const status=useRef<HTMLSpanElement>(null);
 useLayoutEffect(()=>{
  const clear=()=>{for(const node of document.querySelectorAll('[data-group-drop-target],[data-group-drop-leaving]')){node.removeAttribute('data-group-drop-target');node.removeAttribute('data-group-drop-leaving');}for(const node of document.querySelectorAll('[data-drop-intent]'))node.removeAttribute('data-drop-intent');};
  if(!dragging){clear();if(status.current)status.current.textContent='';return;}
  const draw=()=>{const current=drag.current;if(!current)return;const drop=tabDropAtPoint(viewport.current,current.point,current.id,tabs,groups,false,current.intent),id=drop?.type==='tab.drop'?drop.groupId:null;
   // The dragged tab and its source tray both say whether a release joins, leaves, or only reorders.
   const membership=tabs.find(tab=>tab.id===current.id)?.group,from=membership?groups.find(group=>group.id===membership||group.name===membership)?.id||null:null,leaving=drop?.type==='tab.drop'&&!id&&!!from;
   const dragged=track.current?.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(current.id)}"]`),target=id?track.current?.querySelector<HTMLElement>(`[data-group-tray="${CSS.escape(id)}"]`):null;
   dragged?.setAttribute('data-drop-intent',id&&id!==from?'join':leaving?'leave':'move');
   if(target)dragged?.style.setProperty('--drop-accent',getComputedStyle(target).getPropertyValue('--group-accent'));
   for(const node of track.current?.querySelectorAll<HTMLElement>('[data-group-tray]')||[]){node.toggleAttribute('data-group-drop-target',node.dataset.groupTray===id);node.toggleAttribute('data-group-drop-leaving',leaving&&node.dataset.groupTray===from);}
   for(const node of document.querySelectorAll<HTMLElement>('[data-sidebar-group]'))node.toggleAttribute('data-group-drop-target',node.dataset.sidebarGroup===id);
   const announcement=drop?.type==='tab.drop'?(id?`${id===from?'Move within':'Join'} ${groups.find(group=>group.id===id)?.name} group`:from?'Move outside group':''):'';if(status.current?.textContent!==announcement&&status.current)status.current.textContent=announcement;
  };draw();frame.postRender(draw,true);return()=>{cancelFrame(draw);clear();};
 },[track,viewport,tabs,groups,drag,dragging]);
 return <span ref={status} className="tab-group-drop-status" role="status" aria-live="polite"/>;
}
