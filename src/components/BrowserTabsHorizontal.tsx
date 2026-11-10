import { AnimatePresence,Reorder,motion,useDragControls,useIsPresent } from 'motion/react';
import { shownPrivacy } from '../ui/tabPrivacy';
import { useSiteIconColor } from '../ui/siteIconColor';
import { Children,Fragment,cloneElement,isValidElement,memo,useCallback,useEffect,useId,useLayoutEffect,useMemo,useRef,useState,useSyncExternalStore,type CSSProperties,type ReactElement,type ReactNode,type RefObject } from 'react';
import '../styles/tab-motion.css';
import { compactRevealTarget,compactScrollTarget } from '../ui/compactTabs';
import { controlTitle } from '../ui/shortcutHints';
import { standardTabDragConstraints,standardTabMetrics } from '../ui/standardTabs';
import { adjacentStripEntry,stripChange,stripValue,tabStripBlocks,tabStripEntries,type TabStripEntry } from '../ui/tabStripEntries';
import { installRowSelectionGuard } from '../ui/rowSelectionGuard';
installRowSelectionGuard();
import { stripSpacing } from '../ui/tabStripLayout';
import { useTabDragSurface } from '../ui/useTabDragSurface';import { holdPointer } from '../ui/dragPointer';import { SplitGroupSurfaces } from './SplitGroupSurfaces';
import { useTabSelectionMotion } from '../ui/useTabSelectionMotion';
import { decideAxis,rowPoint,type DragAxis } from '../ui/tabDragAxis';
import { createEdgeScroller,type EdgeScroller } from '../ui/dragEdgeScroll';
import { frequentSpeed,stripLeave } from '../ui/sharedMotion';
import { useArrivalStill } from '../ui/workspaceMotion';
import { ChevronLeft,ChevronRight,Columns2,Link2,X } from './AppIcons';
import { paneDropAction,selectStripTab,toggleSolo } from '../ui/splitPaneSelect';
import type { BrowserTabsProps } from './BrowserTabs';
import { tabSignature } from '../ui/tabSignature';
import { createSelectedStore,type SelectedStore } from '../ui/selectedStore';
import { tabGroupColor } from '../ui/theme';
import './BrowserTabs.css';
import { TabGroupSurface,TabGroupSurfaces } from './TabGroupSurfaces';
import { SplitGroupHeader,splitMemberIcons } from './SplitGroupHeader';
import { TabGroupDropFeedback,TabGroupHeader,type TabStripDrag } from './TabGroupTray';
import { canLiveReorder,captureTabDrag,captureTabDropIntent,releaseTabDrag,tabDropAtPoint } from './tabGroupDrag';
import { endSplitDrag,moveSplitDrag,splitDropAction } from '../ui/splitDrop';
import { TabPrivacyMark,isNewTabState,privacyNames } from './TabPrivacyMark';
import { TabMutedBadge,TabSoundMeter } from './TabSound';
import { tabSound } from '../ui/tabSound';
import { startTitleMarquee,stopTitleMarquee } from '../ui/titleMarquee';
import { renamedTip,shownTab } from '../runtime/tabTitle';
import { requestTabRename } from './TabTitleEditor';
import { cardAnswers,useTabHoverCardMode } from '../ui/tabHoverCard';

import { t as tr } from '../i18n';
/** The title's text gets its own span so a long title can scroll inside its faded box (titleMarquee); the box reads its direction
 * from the title (dir=auto), so an Arabic or Hebrew title starts at the right and fades out at the left. A private or
 * Tor tab's mark goes just before its close button; on the new-tab state, which has no site icon of its own, it takes
 * the icon's place instead (the slot before the title). */
const withMark=(node:ReactNode,mark:ReactElement|null,inIconSlot=false,removeLabel?:string)=>{
 const items=Children.toArray(isValidElement<{children?:ReactNode}>(node)&&node.type===Fragment?node.props.children:node);
 const at=(name:string)=>items.findIndex(child=>isValidElement<{className?:string}>(child)&&child.props.className===name);
 const title=at('tab-title'),titleNode=items[title];
 if(isValidElement<{children?:ReactNode}>(titleNode))items[title]=cloneElement(titleNode,{dir:'auto'} as object,<span className="tab-title-text">{titleNode.props.children}</span>);
 // A linked copy's × removes the tab from the split (the tab stays in its group): its label says so.
 const closing=at('tab-close');if(removeLabel&&closing>=0)items[closing]=cloneElement(items[closing] as ReactElement<{title?:string}>,{title:removeLabel,'aria-label':removeLabel} as object);
 if(!mark)return items;
 if(inIconSlot&&title>0){items[title-1]=mark;return items;}
 const close=at('tab-close');items.splice(close<0?items.length:close,0,mark);return items;
};

/** Where a dragged tab is released beyond the strip: outside the window (tear it off into a new window, Chrome), or
 * over the bookmarks bar (bookmark it at that slot). The UI view covers the whole window, so its viewport is the window. */
const outsideWindow=(point:{x:number;y:number})=>point.x<0||point.y<0||point.x>window.innerWidth||point.y>window.innerHeight;
const bookmarksBarAt=(point:{x:number;y:number})=>{const bar=document.querySelector<HTMLElement>('.bookmarks-bar');if(!bar?.checkVisibility())return null;const box=bar.getBoundingClientRect();return point.x>=box.left&&point.x<=box.right&&point.y>=box.top&&point.y<=box.bottom?bar:null;};
const markBookmarksBar=(bar:HTMLElement|null)=>{for(const node of document.querySelectorAll<HTMLElement>('.bookmarks-bar[data-tab-drop]'))if(node!==bar)delete node.dataset.tabDrop;if(bar)bar.dataset.tabDrop='';};

function TabPresence({children}:{children:(present:boolean,controls:ReturnType<typeof useDragControls>)=>ReactNode}){const controls=useDragControls();return children(useIsPresent(),controls);}

/** What a row's handlers read when an event fires: the strip's current state, callbacks and refs (D, Round 2: rows are
 * memoised, so they must never hold a render's values in closures). */
/** The travelling selection: its place moves on motion values (useTabSelectionMotion); it renders only for its tab's look. */
function SelectionPill({store,live,twin=false}:{store:SelectedStore;live:{current:StripLive};/** The second pill of a linked tab (founder, 28 Oct): the chip in the split tray reads as current too, on the same spring. */twin?:boolean}){
 const id=useSyncExternalStore(store.subscribe,store.get),L=live.current,tab=L.props.state.tabs.find(item=>item.id===id),motionOf=twin?L.twin:L.selection;
 return tab&&(!twin||L.layout.current.linkedIndex>=0)?<motion.span aria-hidden="true" className="tab-strip-selection" data-glow={twin?undefined:''} data-copy={twin||undefined} data-privacy={shownPrivacy(tab)} data-hidden={(twin?L.layout.current.linkedIndex:L.layout.current.selectedIndex)<0||undefined} ref={motionOf.selection} style={{...motionOf.style,height:twin||L.layout.current.grouped?24:30,...(twin?{}:{'--site':motionOf.glow})}}/>:null;
}
/** The Reorder.Group and everything in it, rebuilt only when its key changes (tabs, places, looks, drag); a select alone
 * leaves it as it is. It renders the strip's latest closure, so a rebuild never sees stale values. */
const StripTrack=memo(function StripTrack({build}:{trackKey:string;build:{current:()=>ReactNode}}){return <>{build.current()}</>;});

interface StripLive {
 props:BrowserTabsProps;container:RefObject<HTMLDivElement|null>;release:{current:(()=>void)|null};ids:string[];viewport:RefObject<HTMLDivElement|null>;layout:{current:{activeId:string;selectedIndex:number;linkedIndex:number;grouped:boolean}};userScroll:{current:boolean};
 revealSelected:()=>void;updateEdges:()=>void;dragSurface:ReturnType<typeof useTabDragSurface>;selection:ReturnType<typeof useTabSelectionMotion>;twin:ReturnType<typeof useTabSelectionMotion>;
 scrollFrame:{current:number};settleTimer:{current:ReturnType<typeof setTimeout>|undefined};dragged:{current:string|null};dragCancelled:{current:boolean};reordered:{current:string};axis:{current:DragAxis|null};/** Scrolls the strip while a sideways drag is near its end (ui/dragEdgeScroll). */edge:{current:EdgeScroller|null};
 stripDrag:{current:TabStripDrag|null};dragOrigin:{current:ReturnType<typeof captureTabDrag>};suppressClick:{current:boolean};downSelect:{current:string|null};
 setDraggingTab:(id:string|null)=>void;focusEntry:(entry:TabStripEntry)=>void;navigateEntry:(key:string,direction:string)=>void;
}
/** The order follows where the dragged tab IS. Framer's Reorder swaps a neighbour only while the drag has velocity toward it, and not at all while an
 * earlier swap is still being applied, so a flick across two tabs, or a pause that ends with the tab past a neighbour's middle, left the order as it was:
 * the tab sat over its new place, then snapped back on release (founder, 1 Nov: "it's not letting me move it always"). This reads the dragged tab's
 * box against its neighbours' laid-out middles, with no velocity: one slot at a time while dragging (what Reorder does, when it does), and across as many
 * as it has passed on release. `L.reordered` is the order a swap was already asked for, so Reorder's own swap and this one never both fire. */
function followPosition(L:StripLive,id:string,release:boolean){
 const {state,dispatch}=L.props,ids=L.ids,from=ids.indexOf(id),root=L.container.current;
 if(from<0||!root||L.reordered.current===ids.join()||state.windowUi.splitGroups?.some(group=>group.tabIds.includes(id)))return;
 const find=(key:string)=>root.querySelector<HTMLElement>(`[data-drag-key="${CSS.escape(key)}"]`),me=find(id),parent=me?.offsetParent as HTMLElement|null;
 if(!me||!parent)return;
 const base=parent.getBoundingClientRect().left,box=me.getBoundingClientRect(),near=2,left=box.left-base,right=box.right-base;
 const middle=(key:string)=>{const node=find(key);return node&&node.offsetParent===parent?node.offsetLeft+node.offsetWidth/2:null;};
 let to=from;
 for(;to+1<ids.length;to++){const at=middle(ids[to+1]);if(at===null||right<=at+near||(!release&&to>from))break;}
 if(to===from)for(;to>0;to--){const at=middle(ids[to-1]);if(at===null||left>=at-near||(!release&&to<from))break;}
 if(to===from||!canLiveReorder(id,ids[to],state.tabs,state.tabGroups))return;
 L.reordered.current=ids.join();dispatch({type:'tab.reorder',from:id,to:ids[to]});
}
/** The pointer as the strip reads it: once the drag is a sideways reorder (ui/tabDragAxis) it is on the strip's row, whatever its height; until then, and in a vertical drag, where it is. */
const stripPoint=(L:StripLive,point:{x:number;y:number})=>{const row=L.axis.current==='x'?L.viewport.current?.getBoundingClientRect():null;return row?rowPoint(point,row):point;};
interface StripTabProps {
 entry:TabStripEntry;sig:string;index:number;present:boolean;controls:ReturnType<typeof useDragControls>;width:number;space:number;offset:number;
 iconOnly:boolean;store:SelectedStore;entering:boolean;agentState?:string;inventory:string;reduced:boolean;scopeId:string;live:{current:StripLive};
}
/** A row re-renders only when what it draws changes; the snapshot's fresh tab and group objects alone do not count. */
const sameRow=(a:StripTabProps,b:StripTabProps)=>{for(const key in b){if(key==='entry'){if(a.entry.key!==b.entry.key||a.entry.splitGroup?.id!==b.entry.splitGroup?.id||a.entry.group?.id!==b.entry.group?.id||a.entry.group?.color!==b.entry.group?.color||a.entry.group?.name!==b.entry.group?.name||a.entry.linked!==b.entry.linked||a.entry.linkedIn?.id!==b.entry.linkedIn?.id||a.entry.homeGroup?.name!==b.entry.homeGroup?.name||a.entry.homeGroup?.color!==b.entry.homeGroup?.color)return false;continue;}if(a[key as keyof StripTabProps]!==b[key as keyof StripTabProps])return false;}return true;};

/** One tab of the strip (memoised, D's tab-click profile, Round 2): a Reorder.Item with its framer motion values is the
 * costly part of a strip render, so a row renders again only when its own tab, place or selection changes. */
const StripTab=memo(function StripTab({entry,index,present,controls,width,space,offset,iconOnly,store,entering,agentState,inventory,reduced,scopeId,live}:StripTabProps){
 const tab=shownTab(entry.tab),group=entry.group,privacy=shownPrivacy(tab)?privacyNames[shownPrivacy(tab)!]:null,L=live.current,sound=tabSound(tab);
 // Tab glow (item 11): see tab-glow.css; a private, Tor, sleeping or outlined tab, and the copy in a split's tray, never glow.
 const siteColor=useSiteIconColor(tab.url,tab.favicon,!shownPrivacy(tab)&&!tab.sleeping&&!tab.risk&&!entry.linked,!!tab.error);
 // A linked tab (founder, 28 Oct) is two chips: its own in the group ("Also in split view") and a copy in the split's tray ("In group G",
 // in the group's colour, a fainter title, a × that only removes it from the split). Both are current together (two pills, one spring).
 const key=stripValue(entry),copy=!!entry.linked,home=entry.homeGroup,linkTip=copy?tr("acirasidebar.linkedInGroup",{group:home?.name||'Unnamed group'}):entry.linkedIn?tr("acirasidebar.linkedInSplit"):undefined;
 const leaveSplit=()=>live.current.props.dispatch({type:'split.separate',tabId:tab.id});
 const selected=useSyncExternalStore(store.subscribe,()=>store.get()===tab.id),cardMode=useTabHoverCardMode();
 const movement=useMemo(()=>reduced?{duration:0}:{type:'spring' as const,stiffness:360,damping:38,mass:1},[reduced]);
 const transition=useMemo(()=>({...movement,opacity:{duration:reduced?0:.14}}),[movement,reduced]);
 const exit=useMemo(()=>reduced?{opacity:0,transition:{duration:0}}:stripLeave(),[reduced]);// content leaves first, the room closes on the strip spring, unmount only once it has
 const constraints=useMemo(()=>group?undefined:standardTabDragConstraints(L.viewport,offset,width),[group,offset,width]);// eslint-disable-line react-hooks/exhaustive-deps
 const style=useMemo(()=>({'--tab-width':`${present?width:0}px`,'--tab-space':`${present?space:0}px`,'--tab-padding':`${present&&!iconOnly?10:0}px`,minWidth:0,maxWidth:'none',flexShrink:0,flexBasis:'auto',touchAction:'none',pointerEvents:present?undefined:'none',...(home?{'--link-color':tabGroupColor(home.color)}:{}),...(siteColor?{'--site':siteColor}:{})} as CSSProperties),[present,width,space,iconOnly,home?.color,siteColor]);
 return <Reorder.Item as="div" value={key} layout="position" layoutDependency={inventory} onLayoutAnimationStart={()=>live.current.dragSurface.project(key)}
  initial={OPACITY_FROM} animate={OPACITY_TO} exit={exit}
  transition={transition} dragSnapToOrigin drag={true} dragMomentum={false} dragConstraints={constraints} dragElastic={NO_ELASTIC} dragControls={controls} dragListener={false}
  style={style}
  className={`browser-tab tab-flow ${selected?'selected':''} ${tab.pinned?'pinned':''} ${group?'grouped':''} ${copy?'link-copy':''} ${entry.linkedIn?'link-home':''}`}
  id={`${scopeId}-tab-${key}`} data-drag-key={key} data-link-copy={copy||undefined} data-linked-in={entry.linkedIn?.id} onPointerEnter={event=>startTitleMarquee(event.currentTarget.querySelector<HTMLElement>('.tab-title'))} onPointerLeave={event=>stopTitleMarquee(event.currentTarget.querySelector<HTMLElement>('.tab-title'))} data-tab-id={tab.id} data-glow={siteColor?'':undefined} data-leaving={!present||undefined} data-privacy={shownPrivacy(tab)} data-sleeping={tab.sleeping||undefined} data-sound={sound||undefined} data-capturing={tab.capturing?.length||undefined} data-agent-state={agentState} data-entering={entering||undefined} data-tab-group={group?.id} data-split-member={entry.splitGroup?.id} data-group-color={group?.color} data-group-collapsed={false} data-icon-only={iconOnly} role="tab" tabIndex={present&&selected?0:-1} aria-selected={selected} aria-label={`${tab.title}${tab.pinned?' (pinned)':''}${privacy?`, ${privacy.label}`:''}${sound==='playing'?`, ${tr("tabsound.playing")}`:sound==='muted'?`, ${tr("tabsound.muted")}`:''}${linkTip?`, ${linkTip}`:''}`} data-risk={tab.risk?.kind} title={cardAnswers(cardMode,tab)?undefined:renamedTip(tab,tab.risk?`${tab.title} · ${tab.risk.title}. ${tab.risk.detail}`:privacy?`${tab.title} · ${privacy.tip}`:group?`${tab.title} · ${group.name}`:tab.capturing?.length?`${tab.title} · using your ${tab.capturing.join(' and ')}`:tab.sleeping?`${tab.title} · ${tr("tabsleep.tipSleeping")}`:tab.title,tr("tabrename.renamedTip"))+(linkTip?` · ${linkTip}`:'')} aria-hidden={!present||undefined} inert={!present||undefined}
  onAnimationComplete={()=>{const L=live.current;L.updateEdges();if(present&&tab.id===L.layout.current.activeId&&!L.userScroll.current)L.revealSelected();}}
  onPointerDownCapture={event=>{const L=live.current,control=(event.target as Element).closest('button,input,select,a');L.downSelect.current=null;/* Selection commits on click, so starting an inactive tab drag never replaces the pane it is meant to join. */if(event.button===0&&!event.defaultPrevented&&(!control||control.matches('.tab-close,.standard-tab-icon-close')))controls.start(event);}}
  onClickCapture={event=>{if(live.current.suppressClick.current){event.preventDefault();event.stopPropagation();return;}if(copy&&(event.target as Element).closest('.tab-close,.standard-tab-icon-close')){event.preventDefault();event.stopPropagation();leaveSplit();}}}
  onDragStart={(_event,info)=>{const L=live.current,{state}=L.props;cancelAnimationFrame(L.scrollFrame.current);clearTimeout(L.settleTimer.current);L.scrollFrame.current=0;L.userScroll.current=true;L.dragSurface.start(key);L.selection.startDrag();L.twin.startDrag();L.dragged.current=key;L.dragCancelled.current=false;L.reordered.current='';L.axis.current=null;L.stripDrag.current={id:tab.id,point:info.point,intent:captureTabDropIntent(L.viewport.current,info.point,tab.id,state.tabs,state.tabGroups)};L.setDraggingTab(tab.id);L.dragOrigin.current=captureTabDrag(tab.id,state.tabs,state.tabGroups);L.suppressClick.current=true;L.release.current?.();L.release.current=holdPointer(L.container.current,(_event as PointerEvent).pointerId);L.edge.current?.stop();/* motion's drag follows the scrolling viewport (the tab stays under the pointer) and calls onDrag, so the slot is read again there */L.edge.current=createEdgeScroller({axis:'x',scroller:()=>live.current.viewport.current});}}
  onDrag={(_event,moved)=>{const L=live.current,was=L.axis.current,axis=L.axis.current=decideAxis(was,moved.offset);if(axis==='x'&&was!=='x')L.dragSurface.pin(key);/* Sideways from the first few pixels: a reorder to the end, its pointer is read on the strip's row (no chip, bookmarks bar or window edge, and the picker's page zone is out of reach). */const info=axis==='x'?{...moved,point:stripPoint(L,moved.point)}:moved;if(!L.dragCancelled.current)L.stripDrag.current={...L.stripDrag.current,id:tab.id,point:info.point};moveSplitDrag(tab.id,info.point,!L.dragCancelled.current&&L.props.state.tabs.length>1);if(!L.dragCancelled.current&&info.point.y<(L.viewport.current?.getBoundingClientRect().bottom??0)+16)followPosition(L,tab.id,false);/* The chip follows the pointer in 2D whatever the tab count: a lone tab is carried too (it can't split, but it isn't pinned to a vertical track). */L.dragSurface.carry(key,info.point,L.viewport.current?.getBoundingClientRect().bottom??0,!L.dragCancelled.current&&axis!=='x');markBookmarksBar(L.dragCancelled.current||axis==='x'?null:bookmarksBarAt(info.point));/* Chrome, Arc: a sideways drag near the strip's end scrolls it */if(axis==='x'&&!L.dragCancelled.current)L.edge.current?.update(moved.point.x);else L.edge.current?.stop();}}
  onPointerCancel={()=>{const L=live.current;L.release.current?.();L.release.current=null;markBookmarksBar(null);L.dragSurface.end(key);L.dragCancelled.current=true;L.axis.current=null;L.stripDrag.current=null;L.setDraggingTab(null);L.edge.current?.stop();L.edge.current=null;}}
  onDragEnd={(_event,released)=>{const L=live.current,{state,dispatch}=L.props,info=L.axis.current==='x'?{...released,point:stripPoint(L,released.point)}:released,current=state.tabs.find(item=>item.id===tab.id)??tab;L.axis.current=null;L.release.current?.();L.release.current=null;L.edge.current?.stop();L.edge.current=null;L.selection.endDrag();L.twin.endDrag();markBookmarksBar(null);
   const bar=!L.dragCancelled.current&&bookmarksBarAt(info.point),torn=!L.dragCancelled.current&&!bar&&outsideWindow(info.point)&&state.tabs.length>1;
   if(bar||torn){endSplitDrag(tab.id);L.dragSurface.end(key);L.stripDrag.current=null;L.setDraggingTab(null);L.dragOrigin.current=null;L.dragged.current=null;setTimeout(()=>{L.suppressClick.current=false;},0);
    if(torn){const pointer=_event as PointerEvent;dispatch({type:'tab.move-window',id:tab.id,at:{x:Math.round(pointer.screenX??window.screenX+info.point.x),y:Math.round(pointer.screenY??window.screenY+info.point.y)}});}
    else if(bar){const slot=[...bar.querySelectorAll<HTMLElement>(':scope>[data-bookmark]')].filter(item=>{const box=item.getBoundingClientRect();return box.left+box.width/2<info.point.x;}).length;dispatch({type:'bookmark.add',url:current.url,title:current.title,parentId:'bookmarks-bar',index:slot});}
    return;}
   const split=endSplitDrag(tab.id)&&splitDropAction(tab.id,state.activeTabId,state.tabs.map(item=>item.id));L.dragSurface.end(key,Boolean(split));const raw=L.dragCancelled.current||split?null:tabDropAtPoint(L.viewport.current,info.point,tab.id,state.tabs,state.tabGroups,false,L.stripDrag.current?.intent),drop=paneDropAction(raw,tab.id,entry.splitGroup,copy)??releaseTabDrag(raw,L.dragOrigin.current,state.tabs,state.tabGroups);L.stripDrag.current=null;L.setDraggingTab(null);if(split)dispatch(split);else if(drop)dispatch(drop);else if(raw&&!L.dragCancelled.current)followPosition(L,tab.id,true);L.dragOrigin.current=null;L.dragged.current=null;setTimeout(()=>{L.suppressClick.current=false;},0);}}
  onClick={()=>{const L=live.current;if(!L.suppressClick.current)selectStripTab(L.props.state,L.props.dispatch,tab.id,entry.splitGroup);}}
  onAuxClick={event=>{if(event.button===1){event.preventDefault();if(copy)leaveSplit();else live.current.props.dispatch({type:'tab.close',id:tab.id});}}}
  onKeyDown={event=>{const L=live.current,{dispatch,onContext}=L.props;if(event.target!==event.currentTarget)return;if(event.key==='F2'&&!event.altKey&&!event.ctrlKey&&!event.shiftKey){event.preventDefault();requestTabRename(tab.id);return;}if(event.key==='ContextMenu'||event.shiftKey&&event.key==='F10'){event.preventDefault();const b=event.currentTarget.getBoundingClientRect();onContext(tab.id,{x:b.x,y:b.y,width:b.width,height:b.height});return;}if(entry.splitGroup&&event.key==='Enter'&&event.shiftKey){event.preventDefault();toggleSolo(L.props.state,dispatch,tab.id,entry.splitGroup);return;}if(event.key==='Enter'||event.key===' '){event.preventDefault();selectStripTab(L.props.state,dispatch,tab.id,entry.splitGroup);}if(event.key==='Delete'){event.preventDefault();if(copy)leaveSplit();else dispatch({type:'tab.close',id:tab.id});}if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key)){event.preventDefault();if(event.altKey){/* A linked copy has no place of its own to move: Alt+arrow belongs to the tab's chip in its group. */if(copy)return;const ids=L.ids,position=ids.indexOf(tab.id),direction=['ArrowLeft','ArrowUp'].includes(event.key)?-1:1,target=ids[event.key==='Home'?0:event.key==='End'?ids.length-1:(position+direction+ids.length)%ids.length];dispatch({type:'tab.reorder',from:tab.id,to:target});L.focusEntry(entry);}else L.navigateEntry(entry.key,event.key);}}}
  onContextMenu={event=>{event.preventDefault();const box=event.currentTarget.getBoundingClientRect();/* A linked tab has two chips: its menu opens at the one that was clicked. */live.current.props.onContext(tab.id,entry.linked||entry.linkedIn?{x:box.x,y:box.y,width:box.width,height:box.height}:undefined);}}>
  {withMark(L.props.render(tab),shownPrivacy(tab)?<TabPrivacyMark key="privacy-mark" privacy={shownPrivacy(tab)!} className={isNewTabState(tab.url)?"tab-privacy-mark tab-privacy-icon":"tab-privacy-mark"} size={isNewTabState(tab.url)?16:14}/>:linkTip?<span key="link-mark" className="tab-link-mark" data-role={copy?'group':'split'} title={linkTip} aria-hidden="true">{copy?<Link2 size={12}/>:<Columns2 size={12}/>}</span>:null,shownPrivacy(tab)?isNewTabState(tab.url):false,copy?tr("acirasidebar.removeFromSplit"):undefined)}
  {/* R4-30: icon-only, pinned and narrow tabs have no close slot for the equaliser, so it sits on the site icon (tab-sound.css); a roomier tab has it inside its close button (App render). A muted tab's speaker-off glyph takes the same places: the button in a roomy tab, the icon's corner otherwise. */}{sound==='playing'&&<TabSoundMeter badge reducedMotion={reduced}/>}{sound==='muted'&&<TabMutedBadge/>}
  {/* Pinned tabs never offer close (Chrome): an icon-only active tab shows its X over the icon. */}{iconOnly&&selected&&!tab.pinned&&<button type="button" className="standard-tab-icon-close" title={controlTitle("Close tab")} aria-label={tr("app.closeTitle", { title: tab.title })} onPointerDown={event=>event.stopPropagation()} onClick={event=>{event.stopPropagation();live.current.props.dispatch({type:'tab.close',id:tab.id});}}><X size={14}/></button>}
 </Reorder.Item>;
},sameRow);
const OPACITY_FROM={opacity:0},OPACITY_TO={opacity:1},NO_ELASTIC={left:0,right:0,top:0,bottom:0};

/** Position-only projection preserves text; the viewport owns scrolling, not the tab track. */
export function BrowserTabsHorizontal({state,dispatch,render,onContext,onBlankContext,onPreview,newTab,tabState,iconOf}:BrowserTabsProps){
 const container=useRef<HTMLDivElement>(null),viewport=useRef<HTMLDivElement>(null),track=useRef<HTMLDivElement>(null);
 const dragOrigin=useRef<ReturnType<typeof captureTabDrag>>(null),release=useRef<(()=>void)|null>(null);
 const stripDrag=useRef<TabStripDrag|null>(null),dragCancelled=useRef(false);const [draggingTab,setDraggingTab]=useState<string|null>(null);
 const dragged=useRef<string|null>(null),reordered=useRef(''),orderNow=useRef(''),axis=useRef<DragAxis|null>(null),edge=useRef<EdgeScroller|null>(null),suppressClick=useRef(false),downSelect=useRef<string|null>(null),scrollFrame=useRef(0),scrollGoal=useRef(0),lastPixelWheel=useRef(-Infinity),userScroll=useRef(false),settleTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
 const [available,setAvailable]=useState(1200),[closingWidth,setClosingWidth]=useState<number|null>(null),[edges,setEdges]=useState({left:false,right:false});
 const previousCount=useRef(state.tabs.length),reduced=state.settings.reducedMotion,speed=frequentSpeed(state.settings);
 const entries=tabStripEntries(state.tabs,state.tabGroups,false,state.windowUi.splitGroups),ordered=entries.filter(entry=>!entry.header).map(entry=>entry.tab),ids=entries.filter(entry=>!entry.header).map(stripValue),inventory=entries.map(entry=>`${entry.key}:${entry.pinned}:${entry.group?.id}:${entry.group?.collapsed}:${entry.splitGroup?.id}:${entry.splitGroup?.collapsed}`).join('|');
 // Revealed group members enter too; existing visible tabs never re-enter on a DOM move.
 // A list that replaced the strip (another space) starts a fresh presence and stands in its final places for its first frames (useArrivalStill).
 const previousTabs=useRef(new Set(ids)),{entering:arriving,replaced}=stripChange(ids,previousTabs.current),listKey=useRef(''),standing=useArrivalStill(replaced);if(replaced)listKey.current=ids[0];
 useLayoutEffect(()=>{previousTabs.current=new Set(ids);},[inventory]);
 // A swap asked for is pending only until the order changes: if the order then comes back to the one it was asked from (Reorder swaps a tab back when it reads a layout that is a frame old), nothing is pending, and followPosition must not stay blocked for the rest of the drag.
 useLayoutEffect(()=>{reordered.current='';},[ids.join()]);// eslint-disable-line react-hooks/exhaustive-deps
 const scopeId=useId(),spacing=stripSpacing(entries);orderNow.current=ids.join();
 const blocks=tabStripBlocks(entries),ownership=new Map(blocks.filter(block=>block.header?.group).map(block=>[block.header!.group!.id,block.items.filter(({entry})=>!entry.nested).map(({entry})=>entry.header?`${scopeId}-header-${entry.group!.id}`:`${scopeId}-tab-${entry.tab.id}`).join(' ')]));
 const metrics=standardTabMetrics(available,entries,closingWidth),{widths,offsets,occupied,pitch}=metrics;
 const groupWidths=new Map(blocks.filter(block=>block.header?.group).map(block=>{const first=block.items[0].index,last=block.items.at(-1)!.index;return [block.header!.group!.id,offsets[last]+widths[last]-offsets[first]+4];}));
 // A linked tab is current in two chips: its own (the pill below) and its copy in the split's tray (the twin pill).
 const selectedIndex=entries.findIndex(entry=>!entry.header&&!entry.linked&&entry.tab.id===state.activeTabId),linkedIndex=entries.findIndex(entry=>entry.linked&&entry.tab.id===state.activeTabId);
 const grouped=!!(entries[selectedIndex]?.group||entries[selectedIndex]?.splitGroup),layout=useRef({activeId:state.activeTabId,selectedIndex,linkedIndex,grouped,widths,offsets,overflow:metrics.overflow});layout.current={activeId:state.activeTabId,selectedIndex,linkedIndex,grouped,widths,offsets,overflow:metrics.overflow};
 const updateEdges=useCallback(()=>{const node=viewport.current;if(!node)return;const left=node.scrollLeft>1,right=node.scrollWidth-node.clientWidth-node.scrollLeft>1;setEdges(old=>old.left===left&&old.right===right?old:{left,right});},[]);
 useLayoutEffect(()=>{const node=viewport.current,strip=track.current;if(!node||!strip)return;const observer=new ResizeObserver(updateEdges);observer.observe(node);observer.observe(strip);return()=>observer.disconnect();},[updateEdges]);
 const moveScroll=useCallback((target:number,snap=false)=>{
  const node=viewport.current;if(!node)return;cancelAnimationFrame(scrollFrame.current);scrollFrame.current=0;
  const from=node.scrollLeft,to=compactScrollTarget(target,node.scrollWidth-node.clientWidth,snap?pitch:0);scrollGoal.current=to;
  if(reduced||Math.abs(to-from)<.5){node.scrollLeft=to;updateEdges();return;}
  const start=performance.now(),duration=180/Math.max(.5,speed);
  node.dataset.scrollGoal=String(to);node.dataset.scrollGoalUntil=String(performance.now()+duration+50);/* R6: settledBox reads where the strip stops */
  const tick=(now:number)=>{const t=Math.min(1,(now-start)/duration);node.scrollLeft=from+(to-from)*(1-Math.pow(1-t,3));if(t<1)scrollFrame.current=requestAnimationFrame(tick);else{delete node.dataset.scrollGoal;scrollFrame.current=0;updateEdges();}};
  scrollFrame.current=requestAnimationFrame(tick);
 },[pitch,reduced,speed,updateEdges]);
 const revealSelected=useCallback(()=>{
  if(dragged.current)return;
  const node=viewport.current,current=layout.current,focused=document.activeElement?.closest<HTMLElement>('[data-group-header]'),header=focused&&track.current?.contains(focused)?focused:null;if(!node?.clientWidth||!header&&current.selectedIndex<0)return;
  clearTimeout(settleTimer.current);cancelAnimationFrame(scrollFrame.current);scrollFrame.current=0;scrollGoal.current=node.scrollLeft;
  if(!current.overflow){node.scrollLeft=0;updateEdges();return;}
  const headerOffset=header?header.getBoundingClientRect().left-track.current!.getBoundingClientRect().left:undefined;
  const target=compactRevealTarget(node.scrollLeft,node.clientWidth,headerOffset??current.offsets[current.selectedIndex],header?.offsetWidth??current.widths[current.selectedIndex],node.scrollWidth-node.clientWidth,pitch);
  if(Math.abs(target-node.scrollLeft)>1)moveScroll(target);updateEdges();
 },[pitch,moveScroll,updateEdges]);
 useLayoutEffect(()=>{const node=container.current;if(!node)return;const observer=new ResizeObserver(()=>setAvailable(node.clientWidth));observer.observe(node);setAvailable(node.clientWidth);return()=>observer.disconnect();},[]);
 // Another space's list reads its room in the frame it arrives: the space chip before the strip has another name, so another width, and
 // the observer's answer a frame later moved every chip once more.
 useLayoutEffect(()=>{const node=container.current;if(replaced&&node&&node.clientWidth!==available)setAvailable(node.clientWidth);});
 useLayoutEffect(()=>{setClosingWidth(null);},[available]);
 useLayoutEffect(()=>{if(ordered.length>previousCount.current)setClosingWidth(null);previousCount.current=ordered.length;},[ordered.length]);
 useLayoutEffect(()=>{if(dragged.current)return;userScroll.current=false;const frame=requestAnimationFrame(revealSelected);return()=>cancelAnimationFrame(frame);},[state.activeTabId,inventory,available,revealSelected]);
 useEffect(()=>()=>{cancelAnimationFrame(scrollFrame.current);clearTimeout(settleTimer.current);release.current?.();},[]);
 useEffect(()=>{
  const node=viewport.current,region=container.current;if(!node||!region)return;
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
 const scroll=(direction:number)=>{const node=viewport.current;if(!node)return;userScroll.current=true;clearTimeout(settleTimer.current);moveScroll((scrollFrame.current?scrollGoal.current:node.scrollLeft)+direction*Math.max(84,node.clientWidth*.7),true);};
 const movement=reduced?{duration:0}:{type:'spring' as const,stiffness:360*speed*speed,damping:38*speed,mass:1};
 // Tab glow (item 11): the selected tab's colour travels with the pill and blends from the last tab's on the same spring (useTabSelectionMotion).
 const activeTab=state.tabs.find(item=>item.id===state.activeTabId),shownActive=activeTab&&shownTab(activeTab);
 const activeTone=useSiteIconColor(shownActive?.url??'',shownActive?.favicon,!!shownActive&&!shownPrivacy(shownActive)&&!shownActive.sleeping&&!shownActive.risk,!!shownActive?.error);
 const selection=useTabSelectionMotion(track,state.activeTabId,inventory,{x:offsets[selectedIndex]||0,width:widths[selectedIndex]||0,top:entries[selectedIndex]?.group||entries[selectedIndex]?.splitGroup?6:3},movement,`${widths.join(',')}:${offsets.join(',')}`,false,activeTone);
 const twin=useTabSelectionMotion(track,state.activeTabId,inventory,{x:offsets[linkedIndex]||0,width:widths[linkedIndex]||0,top:6},movement,`${widths.join(',')}:${offsets.join(',')}`,true);
 const dragSurface=useTabDragSurface(track);
 const focusEntry=(entry:TabStripEntry)=>requestAnimationFrame(()=>{const selector=entry.header&&entry.splitGroup?`[data-split-group="${CSS.escape(entry.splitGroup.id)}"] .split-group-open`:entry.header?`[data-group-header="${CSS.escape(entry.group!.id)}"] button`:`[data-drag-key="${CSS.escape(stripValue(entry))}"]`;track.current?.querySelector<HTMLElement>(selector)?.focus({preventScroll:true});revealSelected();});
 const navigateEntry=(key:string,direction:string)=>{const entry=adjacentStripEntry(entries,key,direction);if(!entry)return;if(!entry.header)selectStripTab(state,dispatch,entry.tab.id,entry.splitGroup);focusEntry(entry);};
 const live=useRef<StripLive>(null!);live.current={props:{state,dispatch,render,onContext,onBlankContext,onPreview,newTab,tabState,iconOf},container,release,ids:entries.filter(entry=>!entry.header&&!entry.linked).map(entry=>entry.tab.id),viewport,layout,userScroll,revealSelected,updateEdges,dragSurface,selection,twin,scrollFrame,settleTimer,dragged,dragCancelled,reordered,axis,edge,stripDrag,dragOrigin,suppressClick,downSelect,setDraggingTab,focusEntry,navigateEntry};
 const [store]=useState(()=>createSelectedStore(state.activeTabId));
 useLayoutEffect(()=>store.set(state.activeTabId),[store,state.activeTabId]);
 const hasGroups=blocks.some(block=>block.header);
 const trackKey=[inventory,listKey.current,standing,state.windowUi.split?.groupId,widths.join(),offsets.join(),spacing.join(),occupied,metrics.iconOnly,reduced,scopeId,draggingTab??'',hasGroups?state.activeTabId:'',entries.map(entry=>entry.header?`h${entry.key}|${entry.count}|${entry.group?.name}|${entry.group?.color}|${entry.group?.collapsed}|${entry.splitGroup?.name}`:`${tabSignature(entry.tab,iconOf?.(entry.tab.url))}|${tabState?.(entry.tab)??''}|${arriving.has(stripValue(entry))?0:1}|${entry.linked?1:0}|${entry.linkedIn?.id??''}|${entry.homeGroup?.name??''}|${entry.homeGroup?.color??''}`).join('\n')].join('\u0002');
 const buildTrack=useRef<()=>ReactNode>(()=>null);
 const reorder=(next:string[])=>{const from=dragged.current;if(!from)return;const index=next.indexOf(from),target=ids[index];if(!target||target===from)return;if(!canLiveReorder(from,target,state.tabs,state.tabGroups)||state.windowUi.splitGroups?.some(group=>group.tabIds.includes(from)))return;/* a pane chip stays in its split's tray until it is dropped */if(reordered.current===ids.join()||orderNow.current!==ids.join())return;/* a swap from this order is already asked for (followPosition's), or this is a callback from an order the strip has left: either would move the tab back */reordered.current=ids.join();dispatch({type:'tab.reorder',from,to:target});};
 buildTrack.current=()=>(
    <Reorder.Group as="div" ref={track} axis="x" values={ids} onReorder={reorder}
     initial={false} style={{width:occupied,gap:0}}
     className="tabs-strip tab-width-motion" role="tablist" aria-label={tr("browsertabshorizontal.browserTabs")} aria-orientation="horizontal"
     onContextMenu={event=>{if(!(event.target as HTMLElement).closest('.browser-tab')){event.preventDefault();event.stopPropagation();onBlankContext({x:event.clientX,y:event.clientY,width:2,height:2});}}}>
     <SelectionPill store={store} live={live}/><SelectionPill store={store} live={live} twin/>
     <TabGroupSurfaces entries={entries} track={track} tabs={state.tabs} groups={state.tabGroups} drag={stripDrag} dragging={draggingTab} layoutKey={`${inventory}:${widths.join(',')}:${offsets.join(',')}`}/>
     <SplitGroupSurfaces track={track} entries={entries} activeId={state.windowUi.split?.groupId} layoutKey={`${inventory}:${widths.join(',')}:${offsets.join(',')}:${state.windowUi.split?.groupId??''}`} dragging={draggingTab}/>
     <TabGroupDropFeedback track={track} viewport={viewport} tabs={state.tabs} groups={state.tabGroups} drag={stripDrag} dragging={draggingTab}/>
     <AnimatePresence key={listKey.current} initial={false}>{entries.map((entry,index)=>entry.header&&entry.splitGroup?<SplitGroupHeader key={entry.key} group={entry.splitGroup} icons={splitMemberIcons(entry.splitGroup,state.tabs,iconOf)} temporary={entry.splitGroup.tabIds.some(id=>state.tabs.find(tab=>tab.id===id)?.privacy)||state.browserProfiles.some(profile=>profile.id===state.activeBrowserProfileId&&profile.private)} active={state.windowUi.split?.groupId===entry.splitGroup.id||(entry.splitGroup.collapsed&&entry.splitGroup.tabIds.includes(state.activeTabId))} dispatch={dispatch} reducedMotion={reduced} onNavigateKey={key=>navigateEntry(entry.key,key)} onContext={anchor=>onContext(entry.splitGroup!.tabIds[0],anchor,'split')} nestedIn={entry.nested?entry.group?.id:undefined} style={{'--tab-width':`${widths[index]}px`,'--tab-space':`${spacing[index]}px` } as CSSProperties}/>:entry.header?<Fragment key={entry.key}><TabGroupSurface width={groupWidths.get(entry.group!.id)!} labelWidth={widths[index]} group={entry.group!} count={entry.count} owns={ownership.get(entry.group!.id)!} scopeId={scopeId} compact={false} reducedMotion={reduced}/><TabGroupHeader ownerId={`${scopeId}-header-${entry.group!.id}`} leadingSpace={spacing[index]} activeTabId={state.activeTabId} onProject={()=>dragSurface.project(entry.group!.id)} group={entry.group!} count={entry.count} tab={entry.tab} tabs={state.tabs} groups={state.tabGroups} labelWidth={widths[index]} reducedMotion={reduced} dispatch={dispatch} viewport={viewport} onContext={onContext} onNavigateKey={key=>navigateEntry(entry.key,key)} onPreview={onPreview}/></Fragment>:<TabPresence key={entry.key}>{(present,controls)=><StripTab entry={entry} sig={tabSignature(entry.tab,iconOf?.(entry.tab.url))} index={index} present={present} controls={controls} width={widths[index]} space={spacing[index]} offset={offsets[index]} iconOnly={entry.tab.pinned||metrics.iconOnly} store={store} entering={arriving.has(stripValue(entry))} agentState={tabState?.(entry.tab)} inventory={inventory} reduced={reduced||standing} scopeId={scopeId} live={live}/>}</TabPresence>)}</AnimatePresence>
    </Reorder.Group>
 );
 return <div ref={container} className="tab-strip-container" data-scrollable={metrics.overflow} data-dragging={!!draggingTab} data-groups={blocks.some(block=>block.header)} data-peek-pitch={pitch} data-overflow-left={edges.left} data-overflow-right={edges.right} data-reduced-motion={reduced||standing}
  onPointerLeave={()=>setClosingWidth(null)}
  onClickCapture={event=>{if(event.detail>0&&(event.target as HTMLElement).closest('.tab-close,.standard-tab-icon-close'))setClosingWidth(metrics.width);else if((event.target as HTMLElement).closest('.tab-strip-add'))setClosingWidth(null);}}
  onAuxClickCapture={event=>{if(event.button===1&&(event.target as HTMLElement).closest('.browser-tab'))setClosingWidth(metrics.width);}}>
  <motion.button type="button" className="standard-tabs-scroll previous tab-width-motion" style={{width:metrics.overflow?24:0,marginRight:metrics.overflow?2:0,flex:'0 0 auto',overflow:'hidden'}} aria-hidden={!metrics.overflow||undefined} aria-label={tr("compacttabs.scrollTabsLeft")} disabled={!metrics.overflow||!edges.left} tabIndex={metrics.overflow&&edges.left?0:-1} onClick={event=>{event.stopPropagation();scroll(-1);}}><ChevronLeft size={16}/></motion.button>
  <motion.div style={{width:metrics.viewport,overflowX:draggingTab&&metrics.overflow?'hidden':undefined}} className="tab-strip-viewport tab-width-motion" ref={viewport} layoutScroll initial={false} onScroll={updateEdges}>
   <StripTrack trackKey={trackKey} build={buildTrack}/>
  </motion.div>
  <motion.button type="button" className="standard-tabs-scroll next tab-width-motion" style={{width:metrics.overflow?24:0,marginLeft:metrics.overflow?2:0,flex:'0 0 auto',overflow:'hidden'}} aria-hidden={!metrics.overflow||undefined} aria-label={tr("compacttabs.scrollTabsRight")} disabled={!metrics.overflow||!edges.right} tabIndex={metrics.overflow&&edges.right?0:-1} onClick={event=>{event.stopPropagation();scroll(1);}}><ChevronRight size={16}/></motion.button>
  <div className="tab-strip-add" onContextMenu={event=>{event.preventDefault();event.stopPropagation();const b=event.currentTarget.getBoundingClientRect();onBlankContext({x:b.x,y:b.y,width:b.width,height:b.height});}}>{newTab}</div>
  <div className="tab-strip-drag" aria-hidden="true" />
 </div>;
}
