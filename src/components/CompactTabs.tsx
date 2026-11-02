import { AnimatePresence,Reorder,motion,useDragControls,useIsPresent } from 'motion/react';
import { shownPrivacy } from '../ui/tabPrivacy';
import { Fragment,memo,useCallback,useEffect,useId,useLayoutEffect,useMemo,useRef,useState,useSyncExternalStore,type CSSProperties,type ReactNode,type RefObject } from 'react';
import { tabSignature } from '../ui/tabSignature';
import { shownTab } from '../runtime/tabTitle';
import { cardAnswers,useTabHoverCardMode } from '../ui/tabHoverCard';
import { createSelectedStore,type SelectedStore } from '../ui/selectedStore';
import type { BrowserAction,TabGroup,TabSession } from '../runtime/types';
import '../styles/tab-motion.css';
import { compactEqualOverflowMetrics,compactRevealTarget,compactScrollTarget,compactTabMetrics } from '../ui/compactTabs';
import { aciraSpring } from '../ui/motion';import { stripLeave } from '../ui/sharedMotion';
import { controlTitle } from '../ui/shortcutHints';
import { adjacentStripEntry,stripValue,tabStripBlocks,tabStripEntries,type TabStripEntry } from '../ui/tabStripEntries';
import { tabGroupColor } from '../ui/theme';
import { paneDropAction } from '../ui/splitPaneSelect';
import { installRowSelectionGuard } from '../ui/rowSelectionGuard';
installRowSelectionGuard();
import { stripSpacing } from '../ui/tabStripLayout';
import { useTabDragSurface } from '../ui/useTabDragSurface';
import { useTabSelectionMotion } from '../ui/useTabSelectionMotion';
import { decideAxis,rowPoint,type DragAxis } from '../ui/tabDragAxis';
import { createEdgeScroller,type EdgeScroller } from '../ui/dragEdgeScroll';
import { ChevronLeft,ChevronRight,Columns2,Link2,Plus,VolumeX,X } from './AppIcons';
import { TabMutedBadge,TabSoundMeter } from './TabSound';
import { tabSound } from '../ui/tabSound';
import './CompactTabs.css';
import { TabGroupSurface,TabGroupSurfaces } from './TabGroupSurfaces';import { SplitGroupHeader,splitMemberIcons } from './SplitGroupHeader';import { SplitGroupSurfaces } from './SplitGroupSurfaces';import type { SplitGroup } from '../runtime/splitLayout';
import { TabPrivacyMark,isNewTabState,privacyNames } from './TabPrivacyMark';
import { startTitleMarquee,stopTitleMarquee } from '../ui/titleMarquee';
import { TabGroupDropFeedback,TabGroupHeader,type TabStripDrag } from './TabGroupTray';
import { canLiveReorder,captureTabDrag,captureTabDropIntent,releaseTabDrag,tabDropAtPoint } from './tabGroupDrag';
import { endSplitDrag,moveSplitDrag,splitDropAction } from '../ui/splitDrop';import { holdPointer } from '../ui/dragPointer';

import { t as tr } from '../i18n';
type Anchor={x:number;y:number;width:number;height:number};
type Props={
 tabs:TabSession[];activeTabId:string;titles:boolean;reducedMotion:boolean;speed:number;
 renderIcon:(tab:TabSession)=>ReactNode;onSelect:(id:string)=>void;onClose:(id:string)=>void;onNewTab:()=>void;onNewTabContext?:(anchor:{x:number;y:number;width:number;height:number})=>void;
 onContext?:(id:string,anchor:Anchor,isGroup?:boolean|'split')=>void;onMute?:(id:string,muted:boolean)=>void;onPreview?:(id:string,anchor:Anchor,visible:boolean,force?:boolean)=>void;groups?:TabGroup[];onGroupAction?:(action:BrowserAction)=>void;
 /** The stored site icon for a URL (part of a row's signature: rows are memoised). */iconOf?:(url:string)=>string|undefined;
 /** The open split's tabs: a tab outside them selects on click, not on press, so it can be dragged into the split. */splitIds?:readonly string[];
 /** R3-33: the saved splits stay splits in Focus mode too, drawn as the same chip the full strip shows. */splitGroups?:readonly SplitGroup[];activeSplitId?:string;
};
function Presence({children}:{children:(present:boolean,controls:ReturnType<typeof useDragControls>)=>ReactNode}){const controls=useDragControls();return children(useIsPresent(),controls);}

/** What a row's handlers read when an event fires (rows are memoised, so they never keep a render's values in closures). */
interface CompactLive {
 props:Props;groups:TabGroup[];release:{current:(()=>void)|null};ids:string[];viewport:RefObject<HTMLDivElement|null>;layout:{current:{activeTabId:string;selected:number;linked:number}};userScroll:{current:boolean};
 revealSelected:()=>void;updateEdges:()=>void;dragSurface:ReturnType<typeof useTabDragSurface>;selection:ReturnType<typeof useTabSelectionMotion>;twin:ReturnType<typeof useTabSelectionMotion>;
 scrollFrame:{current:number};settleTimer:{current:ReturnType<typeof setTimeout>|undefined};dragged:{current:string|null};dragCancelled:{current:boolean};axis:{current:DragAxis|null};/** Scrolls the strip while a sideways drag is near its end (ui/dragEdgeScroll). */edge:{current:EdgeScroller|null};
 stripDrag:{current:TabStripDrag|null};dragOrigin:{current:ReturnType<typeof captureTabDrag>};suppressClick:{current:boolean};downSelect:{current:string|null};
 setDraggingTab:(id:string|null)=>void;focusEntry:(entry:TabStripEntry)=>void;selectAdjacent:(key:string,direction:string)=>void;
}
/** The pointer as the strip reads it: once the drag is a sideways reorder (ui/tabDragAxis, as the top strip) it is on the strip's row, whatever its height; until then, and in a vertical drag, where it is. */
const stripPoint=(L:CompactLive,point:{x:number;y:number})=>{const row=L.axis.current==='x'?L.viewport.current?.getBoundingClientRect():null;return row?rowPoint(point,row):point;};
/** The compact strip's travelling selection: placed by motion values (useTabSelectionMotion), it renders only for its tab's look. */
function CompactSelectionPill({store,live,twin=false}:{store:SelectedStore;live:{current:CompactLive};/** The second pill of a linked tab (founder, 28 Oct): the chip in the split tray reads as current too, on the same spring. */twin?:boolean}){
 const id=useSyncExternalStore(store.subscribe,store.get),L=live.current,tab=L.props.tabs.find(item=>item.id===id),motionOf=twin?L.twin:L.selection;
 return tab&&(!twin||L.layout.current.linked>=0)?<motion.span aria-hidden="true" className="acira-compact-selection" data-copy={twin||undefined} data-privacy={shownPrivacy(tab)} data-hidden={(twin?L.layout.current.linked:L.layout.current.selected)<0||undefined} ref={motionOf.selection} style={motionOf.style}/>:null;
}
/** The Reorder.Group and its rows, rebuilt only when its key changes; a select alone leaves it as it is (D, Round 2). */
const CompactTrack=memo(function CompactTrack({build}:{trackKey:string;build:{current:()=>ReactNode}}){return <>{build.current()}</>;});

interface CompactRowProps {
 entry:TabStripEntry;sig:string;present:boolean;controls:ReturnType<typeof useDragControls>;width:number;space:number;labels:boolean;store:SelectedStore;
 entering:boolean;draggable:boolean;inventory:string;reduced:boolean;speed:number;scopeId:string;live:{current:CompactLive};
}
const sameRow=(a:CompactRowProps,b:CompactRowProps)=>{for(const key in b){if(key==='entry'){if(a.entry.key!==b.entry.key||a.entry.splitGroup?.id!==b.entry.splitGroup?.id||a.entry.group?.id!==b.entry.group?.id||a.entry.group?.color!==b.entry.group?.color||a.entry.group?.name!==b.entry.group?.name||a.entry.linked!==b.entry.linked||a.entry.linkedIn?.id!==b.entry.linkedIn?.id||a.entry.homeGroup?.name!==b.entry.homeGroup?.name||a.entry.homeGroup?.color!==b.entry.homeGroup?.color)return false;continue;}if(a[key as keyof CompactRowProps]!==b[key as keyof CompactRowProps])return false;}return true;};
const OPACITY_FROM={opacity:0},OPACITY_TO={opacity:1},BOUNCE={bounceStiffness:600,bounceDamping:48};

/** One tab of the compact strip, memoised like the strip's rows (D, Round 2): it renders again only when its own tab,
 * width or selection changes, not on every snapshot. */
const CompactRow=memo(function CompactRow({entry,present,controls,width,space,labels,store,entering,draggable,inventory,reduced,speed,scopeId,live}:CompactRowProps){
 const tab=shownTab(entry.tab),group=entry.group,L=live.current,{renderIcon}=L.props,sound=tabSound(tab);
 // A linked tab (founder, 28 Oct): two chips of one tab, both current together (two pills, one spring). Its own chip says "Also in split
 // view" and a click selects the tab alone; the copy in the split's tray says "In group G", takes the group's colour, a fainter title,
 // and its × (and a drag out, Delete, a middle click) only removes it from the split.
 const key=stripValue(entry),copy=!!entry.linked,home=entry.homeGroup,linkTip=copy?tr("acirasidebar.linkedInGroup",{group:home?.name||'Unnamed group'}):entry.linkedIn?tr("acirasidebar.linkedInSplit"):undefined;
 const leaveSplit=()=>live.current.props.onGroupAction?.({type:'split.separate',tabId:tab.id}),pick=()=>{const P=live.current.props;if(entry.linkedIn&&P.onGroupAction)P.onGroupAction({type:'tab.select',id:tab.id});else P.onSelect(tab.id);};
 const selected=useSyncExternalStore(store.subscribe,()=>store.get()===tab.id),cardMode=useTabHoverCardMode();
 const transition=useMemo(()=>({...aciraSpring(reduced,speed),opacity:{duration:reduced?0:.14}}),[reduced,speed]);
 const exit=useMemo(()=>reduced?{opacity:0,transition:{duration:0}}:stripLeave(),[reduced]);// content leaves first, the room closes on the strip spring, unmount only once it has
 const style=useMemo(()=>({'--tab-width':`${present?width:0}px`,'--tab-space':`${present?space:0}px`,pointerEvents:present?undefined:'none',...(home?{'--link-color':tabGroupColor(home.color)}:{})} as CSSProperties),[present,width,space,home?.color]);
 return <Reorder.Item as="div" value={key} layout="position" layoutDependency={inventory} onLayoutAnimationStart={()=>live.current.dragSurface.project(key)}
      className={`acira-compact-tab tab-flow ${selected?'selected':''} ${copy?'link-copy':''} ${entry.linkedIn?'link-home':''}`} id={`${scopeId}-tab-${key}`} data-tab-id={tab.id} data-drag-key={key} data-link-copy={copy||undefined} data-linked-in={entry.linkedIn?.id} data-privacy={shownPrivacy(tab)} data-sound={sound||undefined} data-entering={entering||undefined} data-tab-group={group?.id} data-split-member={entry.splitGroup?.id} data-pinned={tab.pinned} data-group-color={group?.color} data-group-collapsed={false} data-labels={labels}
      initial={OPACITY_FROM} animate={OPACITY_TO} exit={exit}
      transition={transition} onAnimationComplete={()=>{const L=live.current;L.updateEdges();if(present&&tab.id===L.layout.current.activeTabId&&!L.userScroll.current)L.revealSelected();}}
      style={style} inert={!present||undefined} aria-hidden={!present||undefined}
      role="tab" aria-label={`${tab.title}${tab.pinned?' (pinned)':''}${shownPrivacy(tab)?`, ${privacyNames[shownPrivacy(tab)!].label}`:''}${sound==='playing'?`, ${tr("tabsound.playing")}`:''}${linkTip?`, ${linkTip}`:''}`} aria-selected={selected} tabIndex={present&&selected?0:-1} title={cardAnswers(cardMode,tab)?undefined:`${tab.title}${tab.pageTitle!==undefined?` · ${tr("tabrename.renamedTip")}`:''}${group?` · ${group.name}`:''}${shownPrivacy(tab)?` · ${privacyNames[shownPrivacy(tab)!].tip}`:''}${linkTip?` · ${linkTip}`:''}`}
      drag={draggable} dragMomentum={false} dragSnapToOrigin dragTransition={BOUNCE} dragControls={controls} dragListener={false}
      onPointerDownCapture={event=>{const L=live.current,{activeTabId,onGroupAction,splitIds}=L.props,control=(event.target as Element).closest('button,input,select,a'),outsideSplit=!!splitIds&&!splitIds.includes(tab.id);L.downSelect.current=null;if(event.button===0&&!event.defaultPrevented&&!control&&tab.id!==activeTabId&&!outsideSplit){L.downSelect.current=tab.id;pick();}if(onGroupAction&&event.button===0&&!event.defaultPrevented&&(!control||control.matches('.acira-compact-tab-close')))controls.start(event);}}
      onClickCapture={event=>{if(live.current.suppressClick.current){event.preventDefault();event.stopPropagation();}}}
      onDragStart={(_event,info)=>{const L=live.current,{tabs}=L.props,groups=L.groups;cancelAnimationFrame(L.scrollFrame.current);clearTimeout(L.settleTimer.current);L.scrollFrame.current=0;L.userScroll.current=true;L.dragged.current=key;L.dragOrigin.current=captureTabDrag(tab.id,tabs,groups);L.dragSurface.start(key);L.selection.startDrag();L.twin.startDrag();L.dragCancelled.current=false;L.axis.current=null;L.stripDrag.current={id:tab.id,point:info.point,intent:captureTabDropIntent(L.viewport.current,info.point,tab.id,tabs,groups)};L.setDraggingTab(tab.id);L.suppressClick.current=true;L.release.current?.();L.release.current=holdPointer(L.viewport.current,(_event as PointerEvent).pointerId);L.edge.current?.stop();/* motion's drag follows the scrolling viewport (the tab stays under the pointer) and its Reorder reads the slot there */L.edge.current=createEdgeScroller({axis:'x',scroller:()=>live.current.viewport.current});}}
      onDrag={(_event,moved)=>{const L=live.current,was=L.axis.current,axis=L.axis.current=decideAxis(was,moved.offset);if(axis==='x'&&was!=='x')L.dragSurface.pin(key);/* Sideways from the first few pixels: a reorder to the end, its pointer read on the strip's row (no chip, and the split picker's page zone is out of reach), as in the top strip. */const info=axis==='x'?{...moved,point:stripPoint(L,moved.point)}:moved;if(!L.dragCancelled.current)L.stripDrag.current={...L.stripDrag.current,id:tab.id,point:info.point};moveSplitDrag(tab.id,info.point,!L.dragCancelled.current&&!!L.props.onGroupAction&&L.props.tabs.length>1);/* A lone tab is carried in 2D too (it just can't split). */L.dragSurface.carry(key,info.point,L.viewport.current?.getBoundingClientRect().bottom??0,!L.dragCancelled.current&&axis!=='x');/* Chrome, Arc: a sideways drag near the strip's end scrolls it */if(axis==='x'&&!L.dragCancelled.current)L.edge.current?.update(moved.point.x);else L.edge.current?.stop();}}
      onPointerCancel={()=>{const L=live.current;L.release.current?.();L.release.current=null;L.dragSurface.end(key);L.dragCancelled.current=true;L.axis.current=null;L.stripDrag.current=null;L.setDraggingTab(null);L.edge.current?.stop();L.edge.current=null;}}
      onDragEnd={(_event,released)=>{const L=live.current,{tabs,activeTabId,onGroupAction}=L.props,groups=L.groups,info=L.axis.current==='x'?{...released,point:stripPoint(L,released.point)}:released,scrolled=!!L.edge.current?.scrolled;L.axis.current=null;L.release.current?.();L.release.current=null;L.edge.current?.stop();L.edge.current=null;L.selection.endDrag();L.twin.endDrag();const split=endSplitDrag(tab.id)&&splitDropAction(tab.id,activeTabId,tabs.map(item=>item.id));L.dragSurface.end(key,Boolean(split));const raw=L.dragCancelled.current||split?null:tabDropAtPoint(L.viewport.current,info.point,tab.id,tabs,groups,false,L.stripDrag.current?.intent),drop=paneDropAction(raw,tab.id,entry.splitGroup,copy)??releaseTabDrag(raw,L.dragOrigin.current,tabs,groups);L.stripDrag.current=null;L.setDraggingTab(null);if(split)onGroupAction?.(split);else if(drop)onGroupAction?.(drop);else if(raw&&scrolled)/* the strip scrolled under the tab faster than the live reorder followed: it lands in the slot under the pointer */onGroupAction?.(raw);L.dragged.current=null;L.dragOrigin.current=null;setTimeout(()=>{L.suppressClick.current=false;},0);}}
      onPointerEnter={event=>startTitleMarquee(event.currentTarget.querySelector<HTMLElement>('.acira-compact-tab-label'))} onPointerLeave={event=>stopTitleMarquee(event.currentTarget.querySelector<HTMLElement>('.acira-compact-tab-label'))} onClick={()=>{const L=live.current;if(L.downSelect.current===tab.id){L.downSelect.current=null;return;}if(L.suppressClick.current)return;pick();}} onAuxClick={event=>{if(event.button===1){event.preventDefault();if(copy)leaveSplit();else live.current.props.onClose(tab.id);}}}
      onContextMenu={event=>{event.preventDefault();live.current.props.onContext?.(tab.id,{x:event.clientX,y:event.clientY,width:2,height:2});}}
      onKeyDown={event=>{const L=live.current,{onContext,onGroupAction,onClose}=L.props;if(event.target!==event.currentTarget)return;if(event.key==='ContextMenu'||event.shiftKey&&event.key==='F10'){event.preventDefault();const b=event.currentTarget.getBoundingClientRect();onContext?.(tab.id,{x:b.x,y:b.y,width:b.width,height:b.height});return;}if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key)){event.preventDefault();if(event.altKey){/* A linked copy has no place of its own to move: Alt+arrow belongs to the tab's chip in its group. */if(copy)return;const ids=L.ids,position=ids.indexOf(tab.id),direction=['ArrowLeft','ArrowUp'].includes(event.key)?-1:1,target=ids[event.key==='Home'?0:event.key==='End'?ids.length-1:(position+direction+ids.length)%ids.length];onGroupAction?.({type:'tab.reorder',from:tab.id,to:target});L.focusEntry(entry);}else L.selectAdjacent(entry.key,event.key);}else if(event.key==='Delete'){event.preventDefault();if(copy)leaveSplit();else onClose(tab.id);}else if(event.key==='Enter'||event.key===' '){event.preventDefault();pick();}}}>
      <div className="acira-compact-tab-inner"><span className="acira-compact-tab-icon" data-sleeping={tab.sleeping||undefined}>{shownPrivacy(tab)&&isNewTabState(tab.url)?<TabPrivacyMark privacy={shownPrivacy(tab)!} size={16} className="tab-privacy-mark tab-privacy-icon"/>:<>{renderIcon(tab)}{shownPrivacy(tab)&&<TabPrivacyMark privacy={shownPrivacy(tab)!} size={9} className="tab-privacy-badge"/>}</>}{/* R4-30: an icon-only or narrow tab has no slot, so the equaliser sits on the icon (tab-sound.css). */}{sound==='playing'&&<TabSoundMeter badge reducedMotion={reduced}/>}{sound==='muted'&&<TabMutedBadge/>}</span><span className="acira-compact-tab-label" dir="auto"><span className="tab-title-text">{tab.title}</span></span>{shownPrivacy(tab)&&!isNewTabState(tab.url)&&<TabPrivacyMark privacy={shownPrivacy(tab)!}/>}{linkTip&&<span className="acira-compact-tab-link" data-role={copy?'group':'split'} title={linkTip} aria-hidden="true">{copy?<Link2 size={12}/>:<Columns2 size={12}/>}</span>}{sound==='muted'&&!tab.pinned&&<button type="button" className="acira-compact-tab-audio is-muted" title={tr("app.unmuteTab")} aria-label={tr("tabsound.unmuteName", { name: tab.title })} aria-pressed={true} tabIndex={-1} onPointerDown={event=>event.stopPropagation()} onClick={event=>{event.stopPropagation();live.current.props.onMute?.(tab.id,false);}}><VolumeX size={13}/></button>}{sound==='playing'&&<TabSoundMeter reducedMotion={reduced}/>}{/* Pinned tabs never offer close (Chrome): an icon-only active tab centres its X over the icon. */}{!tab.pinned&&<button type="button" className="acira-compact-tab-close" disabled={!selected} aria-hidden={!selected} tabIndex={selected?0:-1} title={copy?tr("acirasidebar.removeFromSplit"):selected?controlTitle("Close tab"):tr("app.closeTitle", { title: tab.title })} aria-label={copy?`${tr("acirasidebar.removeFromSplit")}: ${tab.title}`:tr("app.closeTitle", { title: tab.title })} onPointerDown={event=>event.stopPropagation()} onClick={event=>{event.stopPropagation();if(copy)leaveSplit();else live.current.props.onClose(tab.id);}}><X size={14}/></button>}</div>
     </Reorder.Item>;
},sameRow);

/** All tabs stay in one scroll plane; clipping never removes a tab from state. */
export function CompactTabs(props:Props){
 const {tabs,activeTabId,titles,reducedMotion,speed,onSelect,onNewTab,onNewTabContext,onContext,onPreview,groups=[],onGroupAction,iconOf,splitGroups=[],activeSplitId}=props;
 const suppressClick=useRef(false),downSelect=useRef<string|null>(null),dragged=useRef<string|null>(null),dragOrigin=useRef<ReturnType<typeof captureTabDrag>>(null),release=useRef<(()=>void)|null>(null);
 const stripDrag=useRef<TabStripDrag|null>(null),dragCancelled=useRef(false),axis=useRef<DragAxis|null>(null),edge=useRef<EdgeScroller|null>(null);const [draggingTab,setDraggingTab]=useState<string|null>(null);
 const root=useRef<HTMLDivElement>(null),viewport=useRef<HTMLDivElement>(null),track=useRef<HTMLDivElement>(null);
 const scrollFrame=useRef(0),scrollGoal=useRef(0),lastPixelWheel=useRef(-Infinity),userScroll=useRef(false),settleTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
 const [available,setAvailable]=useState(0),[edges,setEdges]=useState({left:false,right:false});
 const entries=tabStripEntries(tabs,groups,true,splitGroups),ordered=entries.filter(entry=>!entry.header).map(entry=>entry.tab),ids=entries.filter(entry=>!entry.header).map(stripValue);
 // Revealed group members enter too; existing visible tabs never re-enter on a DOM move.
 const previousTabs=useRef(new Set(ids));
 const scopeId=useId(),spacing=stripSpacing(entries);
 const blocks=tabStripBlocks(entries),ownership=new Map(blocks.filter(block=>block.header?.group).map(block=>[block.header!.group!.id,block.items.filter(({entry})=>!entry.nested).map(({entry})=>entry.header?`${scopeId}-header-${entry.group!.id}`:`${scopeId}-tab-${entry.tab.id}`).join(' ')]));
 const inventory=entries.map(entry=>`${entry.key}:${entry.pinned}:${entry.group?.id}:${entry.group?.collapsed}:${entry.splitGroup?.id}:${entry.splitGroup?.collapsed}`).join('|');
 useLayoutEffect(()=>{previousTabs.current=new Set(ids);},[inventory]);
 const condensed=available<90,activeIndex=entries.findIndex(entry=>!entry.header&&!entry.linked&&entry.tab.id===activeTabId),linkedIndex=entries.findIndex(entry=>entry.linked&&entry.tab.id===activeTabId);
 const scrollable=compactTabMetrics(available,entries,titles,activeIndex).occupied>available+1;
 const {widths,offsets,occupied,pitch,phase}=scrollable?compactEqualOverflowMetrics(Math.max(0,available-52),entries):{...compactTabMetrics(available,entries,titles,activeIndex),pitch:0,phase:0};
 const groupWidths=new Map(blocks.filter(block=>block.header?.group).map(block=>{const first=block.items[0].index,last=block.items.at(-1)!.index;return [block.header!.group!.id,offsets[last]+widths[last]-offsets[first]+4];}));
 const selected=activeIndex;
 const layout=useRef({activeTabId,selected,linked:linkedIndex,widths,offsets,scrollable});layout.current={activeTabId,selected,linked:linkedIndex,widths,offsets,scrollable};
 const updateEdges=useCallback(()=>{const node=viewport.current;if(!node)return;const left=node.scrollLeft>1,right=node.scrollWidth-node.clientWidth-node.scrollLeft>1;setEdges(old=>old.left===left&&old.right===right?old:{left,right});},[]);
 const moveScroll=useCallback((target:number,snap=false)=>{
  const node=viewport.current;if(!node)return;
  cancelAnimationFrame(scrollFrame.current);scrollFrame.current=0;
  const from=node.scrollLeft,to=compactScrollTarget(target,node.scrollWidth-node.clientWidth,snap?pitch:0,phase);scrollGoal.current=to;
  if(reducedMotion||Math.abs(to-from)<.5){node.scrollLeft=to;updateEdges();return;}
  const started=performance.now(),duration=180/Math.max(.5,speed);
  node.dataset.scrollGoal=String(to);node.dataset.scrollGoalUntil=String(performance.now()+duration+50);/* R6: settledBox reads where the strip stops */
  const tick=(now:number)=>{const t=Math.min(1,(now-started)/duration);node.scrollLeft=from+(to-from)*(1-Math.pow(1-t,3));if(t<1)scrollFrame.current=requestAnimationFrame(tick);else{delete node.dataset.scrollGoal;scrollFrame.current=0;updateEdges();}};
  scrollFrame.current=requestAnimationFrame(tick);
 },[reducedMotion,speed,updateEdges,pitch,phase]);
 useEffect(()=>()=>{cancelAnimationFrame(scrollFrame.current);clearTimeout(settleTimer.current);release.current?.();},[]);
 const revealSelected=useCallback(()=>{
  if(dragged.current)return;
  const node=viewport.current;if(!node||!node.clientWidth)return;
  const current=layout.current,focused=document.activeElement?.closest<HTMLElement>('[data-group-header]'),header=focused&&track.current?.contains(focused)?focused:null;if(!header&&current.selected<0)return;
  clearTimeout(settleTimer.current);cancelAnimationFrame(scrollFrame.current);scrollFrame.current=0;scrollGoal.current=node.scrollLeft;
  if(!current.scrollable){node.scrollLeft=0;updateEdges();return;}
  const headerOffset=header?header.getBoundingClientRect().left-track.current!.getBoundingClientRect().left:undefined;
  const target=compactRevealTarget(node.scrollLeft,node.clientWidth,headerOffset??current.offsets[current.selected],header?.offsetWidth??current.widths[current.selected],node.scrollWidth-node.clientWidth,pitch,phase);
  if(Math.abs(target-node.scrollLeft)>1)moveScroll(target);
  updateEdges();
 },[activeTabId,moveScroll,updateEdges,pitch,phase]);
 useLayoutEffect(()=>{
  const node=root.current;if(!node)return;
  const measure=()=>{setAvailable(Math.max(0,node.clientWidth-34));updateEdges();};
  const observer=new ResizeObserver(measure);observer.observe(node);if(viewport.current)observer.observe(viewport.current);if(track.current)observer.observe(track.current);measure();return()=>observer.disconnect();
 },[updateEdges]);
 useLayoutEffect(()=>{if(dragged.current)return;userScroll.current=false;const frame=requestAnimationFrame(revealSelected);return()=>cancelAnimationFrame(frame);},[revealSelected,inventory,available,titles]);
 useEffect(()=>{
  const node=viewport.current,region=root.current;if(!node||!region)return;
  const wheel=(event:WheelEvent)=>{
   if(event.ctrlKey||node.scrollWidth<=node.clientWidth+1)return;
   const delta=Math.abs(event.deltaX)>Math.abs(event.deltaY)?event.deltaX:event.deltaY;
   if(!Number.isFinite(delta)||!delta)return;
   event.preventDefault();event.stopPropagation();userScroll.current=true;
   clearTimeout(settleTimer.current);
   if(event.deltaMode===0){
    // Pixel events already carry the trackpad's motion and inertia. Follow them
    // directly: restarting an easing curve and snapping every 90ms fought the hand.
    const now=performance.now(),continuing=now-lastPixelWheel.current<200&&!scrollFrame.current&&Math.abs(scrollGoal.current-node.scrollLeft)<1;
    const from=continuing?scrollGoal.current:node.scrollLeft;lastPixelWheel.current=now;
    cancelAnimationFrame(scrollFrame.current);scrollFrame.current=0;
    delete node.dataset.scrollGoal;delete node.dataset.scrollGoalUntil;
    // Retain fractional distance even if this display rounds its scroll offset.
    scrollGoal.current=compactScrollTarget(from+delta,node.scrollWidth-node.clientWidth,0);
    node.scrollLeft=scrollGoal.current;updateEdges();
   }else moveScroll((scrollFrame.current?scrollGoal.current:node.scrollLeft)+delta*(event.deltaMode===1?24:node.clientWidth));
  };
  region.addEventListener('wheel',wheel,{passive:false});return()=>region.removeEventListener('wheel',wheel);
 },[moveScroll,updateEdges]);
 const scroll=(direction:number)=>{const node=viewport.current;if(node){userScroll.current=true;clearTimeout(settleTimer.current);moveScroll((scrollFrame.current?scrollGoal.current:node.scrollLeft)+direction*(pitch||(widths[0]||38)+4),true);}};
 const focusEntry=(entry:TabStripEntry)=>requestAnimationFrame(()=>{const selector=entry.header&&entry.splitGroup?`[data-split-group="${CSS.escape(entry.splitGroup.id)}"] .split-group-open`:entry.header?`[data-group-header="${CSS.escape(entry.group!.id)}"] button`:`[data-drag-key="${CSS.escape(stripValue(entry))}"]`;track.current?.querySelector<HTMLElement>(selector)?.focus({preventScroll:true});revealSelected();});
 const selectAdjacent=(key:string,direction:string)=>{const entry=adjacentStripEntry(entries,key,direction);if(!entry)return;if(!entry.header)onSelect(entry.tab.id);focusEntry(entry);};
 const transition=aciraSpring(reducedMotion,speed);
 const selection=useTabSelectionMotion(track,activeTabId,inventory,{x:offsets[selected]||0,width:widths[selected]||0,top:0},transition,`${widths.join(',')}:${offsets.join(',')}`);
 const twin=useTabSelectionMotion(track,activeTabId,inventory,{x:offsets[linkedIndex]||0,width:widths[linkedIndex]||0,top:0},transition,`${widths.join(',')}:${offsets.join(',')}`,true);
 const dragSurface=useTabDragSurface(track);
 const live=useRef<CompactLive>(null!);live.current={props,groups,release,ids:entries.filter(entry=>!entry.header&&!entry.linked).map(entry=>entry.tab.id),viewport,layout,userScroll,revealSelected,updateEdges,dragSurface,selection,twin,scrollFrame,settleTimer,dragged,dragCancelled,axis,edge,stripDrag,dragOrigin,suppressClick,downSelect,setDraggingTab,focusEntry,selectAdjacent};
 const [store]=useState(()=>createSelectedStore(activeTabId));
 useLayoutEffect(()=>store.set(activeTabId),[store,activeTabId]);
 const trackKey=[inventory,widths.join(),offsets.join(),spacing.join(),occupied,titles,scrollable,reducedMotion,speed,scopeId,draggingTab??'',!!onGroupAction,blocks.some(block=>block.header)?activeTabId:'',entries.map(entry=>entry.header?`h${entry.key}|${entry.count}|${entry.group?.name}|${entry.group?.color}|${entry.group?.collapsed}|${entry.splitGroup?.name}|${activeSplitId}`:`${tabSignature(entry.tab,iconOf?.(entry.tab.url))}|${previousTabs.current.has(stripValue(entry))?1:0}|${entry.linked?1:0}|${entry.linkedIn?.id??''}|${entry.homeGroup?.name??''}|${entry.homeGroup?.color??''}`).join('\n')].join('\u0002');
 const buildTrack=useRef<()=>ReactNode>(()=>null);
 const reorder=(next:string[])=>{const from=dragged.current;if(!from)return;const target=ids[next.indexOf(from)];if(!target||target===from)return;if(!canLiveReorder(from,target,tabs,groups)||splitGroups?.some(group=>group.tabIds.includes(from)))return;/* a pane chip stays in its split's tray until it is dropped */onGroupAction?.({type:'tab.reorder',from,to:target});};
 buildTrack.current=()=>(
    <Reorder.Group as="div" axis="x" values={ids} onReorder={reorder} className="acira-compact-tabs-track tab-width-motion" ref={track} style={{width:occupied}}>
     <CompactSelectionPill store={store} live={live}/><CompactSelectionPill store={store} live={live} twin/>
     <TabGroupSurfaces entries={entries} track={track} tabs={tabs} groups={groups} drag={stripDrag} dragging={draggingTab} layoutKey={`${inventory}:${widths.join(',')}:${offsets.join(',')}`}/>
     <SplitGroupSurfaces track={track} entries={entries} activeId={activeSplitId} layoutKey={`${inventory}:${widths.join(',')}:${offsets.join(',')}:${activeSplitId??''}`} dragging={draggingTab}/>
     <TabGroupDropFeedback track={track} viewport={viewport} tabs={tabs} groups={groups} drag={stripDrag} dragging={draggingTab}/>
     <AnimatePresence initial={false}>
      {entries.map((entry,index)=>entry.header&&entry.splitGroup?<SplitGroupHeader key={entry.key} group={entry.splitGroup} icons={splitMemberIcons(entry.splitGroup,tabs,iconOf)} temporary={entry.splitGroup.tabIds.some(id=>tabs.find(tab=>tab.id===id)?.privacy)} active={activeSplitId===entry.splitGroup.id||(entry.splitGroup.collapsed&&entry.splitGroup.tabIds.includes(activeTabId))} dispatch={action=>onGroupAction?.(action)} reducedMotion={reducedMotion} onNavigateKey={key=>selectAdjacent(entry.key,key)} onContext={anchor=>onContext?.(entry.splitGroup!.tabIds[0],anchor,'split')} nestedIn={entry.nested?entry.group?.id:undefined} style={{'--tab-width':`${widths[index]}px`,'--tab-space':`${spacing[index]}px`} as CSSProperties}/>:entry.header?<Fragment key={entry.key}><TabGroupSurface width={groupWidths.get(entry.group!.id)!} labelWidth={widths[index]} group={entry.group!} count={entry.count} owns={ownership.get(entry.group!.id)!} scopeId={scopeId} compact={true} reducedMotion={reducedMotion}/><TabGroupHeader ownerId={`${scopeId}-header-${entry.group!.id}`} leadingSpace={spacing[index]} activeTabId={activeTabId} onProject={()=>dragSurface.project(entry.group!.id)} group={entry.group!} count={entry.count} tab={entry.tab} tabs={tabs} groups={groups} labelWidth={widths[index]} compact reducedMotion={reducedMotion} dispatch={action=>onGroupAction?.(action)} viewport={viewport} onContext={(id,anchor,isGroup)=>onContext?.(id,anchor,isGroup)} onNavigateKey={key=>selectAdjacent(entry.key,key)} onPreview={onPreview}/></Fragment>:<Presence key={entry.key}>{(present,controls)=><CompactRow entry={entry} sig={tabSignature(entry.tab,iconOf?.(entry.tab.url))} present={present} controls={controls} width={widths[index]} space={spacing[index]} labels={titles&&!entry.tab.pinned&&!scrollable&&widths[index]>=88} store={store} entering={!previousTabs.current.has(stripValue(entry))} draggable={!!onGroupAction} inventory={inventory} reduced={reducedMotion} speed={speed} scopeId={scopeId} live={live}/>}</Presence>)}
     </AnimatePresence>
    </Reorder.Group>
 );
 return <div className="acira-compact-tabs" ref={root} data-scrollable={scrollable} data-condensed={condensed} data-dragging={!!draggingTab} data-groups={blocks.some(block=>block.header)} data-peek-pitch={pitch} data-peek-phase={phase} data-overflow-left={edges.left} data-overflow-right={edges.right} data-reduced-motion={reducedMotion}>
  <motion.button type="button" className="acira-compact-scroll previous tab-width-motion" style={{width:scrollable&&!condensed?24:0,marginRight:scrollable&&!condensed?2:0,flex:'0 0 auto',overflow:'hidden'}} aria-hidden={!scrollable||condensed||undefined} aria-label={tr("compacttabs.scrollTabsLeft")} disabled={condensed||!scrollable||!edges.left} tabIndex={!condensed&&scrollable&&edges.left?0:-1} onPointerDown={event=>event.stopPropagation()} onClick={event=>{event.stopPropagation();scroll(-1);}}><ChevronLeft size={16}/></motion.button>
  {/* Keep the existing wheel scroller; Reorder's eager edge pan moves a clipped group header away before drop. */}
  <motion.div layoutScroll style={{width:condensed?0:Math.max(0,Math.min(occupied,available-(scrollable?52:0))),overflowX:draggingTab||!scrollable?'hidden':undefined}} className="acira-compact-tabs-viewport tab-width-motion" ref={viewport} onScroll={updateEdges} inert={condensed||undefined} aria-hidden={condensed||undefined} role="tablist" aria-label={tr("compacttabs.openTabs")} aria-orientation="horizontal">
   <CompactTrack trackKey={trackKey} build={buildTrack}/>
  </motion.div>
  <motion.button type="button" className="acira-compact-scroll next tab-width-motion" style={{width:scrollable&&!condensed?24:0,marginLeft:scrollable&&!condensed?2:0,flex:'0 0 auto',overflow:'hidden'}} aria-hidden={!scrollable||condensed||undefined} aria-label={tr("compacttabs.scrollTabsRight")} disabled={condensed||!scrollable||!edges.right} tabIndex={!condensed&&scrollable&&edges.right?0:-1} onPointerDown={event=>event.stopPropagation()} onClick={event=>{event.stopPropagation();scroll(1);}}><ChevronRight size={16}/></motion.button>
  <button className="acira-compact-new" aria-label={tr("browsermenu.newTab")} title={controlTitle('New tab')} onClick={onNewTab} onContextMenu={event=>{if(!onNewTabContext)return;event.preventDefault();event.stopPropagation();const b=event.currentTarget.getBoundingClientRect();onNewTabContext({x:b.x,y:b.y,width:b.width,height:b.height});}}><Plus size={17}/></button>
  <div className="acira-compact-drag" aria-hidden="true"/>
 </div>;
}
