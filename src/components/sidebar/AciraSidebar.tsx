import { AnimatePresence,motion } from 'motion/react';
import { useCallback,useEffect,useLayoutEffect,useRef,useState,useSyncExternalStore,type CSSProperties,type DragEvent,type KeyboardEvent,type MouseEvent,type PointerEvent,type ReactNode } from 'react';
import { ArrowUp,ArrowUpRight,BookOpen,Bookmark,Check,ChevronDown,Clock3,Columns2,Download,FileText,History as HistoryGlyph,PanelTop,Folder,FolderOpen,Link2,Maximize2,PanelsTopLeft,Pin,Plus,Search,Settings2,Star,VolumeX,X,type LucideIcon } from '../AppIcons';
import { BrandLogo } from '../BrandLogo';
import { useAddressSidebar } from '../../ui/addressSidebarStore';
import { DotMatrix } from '../DotMatrix';
import { PeekMarkerCard } from '../PeekMarkerCard';
import { TabSoundMeter } from '../TabSound';
import { tabSound } from '../../ui/tabSound';
import { tabShowsLoading } from '../../ui/tabLoading';
import { EditorGlyph,type EditorIconName } from '../EditorGlyph';
import { PreviewIcon } from '../PreviewIcon';
import { SiteIdentityIcon } from '../SiteIdentityIcon';
import { useSiteIconColor } from '../../ui/siteIconColor';
import { glideColors } from '../../ui/glowBlend';
import { GroupNameInput,useGroupRename } from '../TabGroupTray';
import { SidebarSplit } from './SidebarSplit';
import { LiveFolder } from './LiveFolder';
import { SidebarMedia } from './SidebarMedia';
import { appendedTabs,nameAndNote,newTabInGroupActions } from './sidebarActions';
import { GroupFolderGlyph } from './GroupFolderGlyph';
import type { SidebarFolders } from '../../ui/railPrefs';
import type { SplitGroup } from '../../runtime/splitLayout';
import { groupKeyboardDrop,tabDropAtPoint } from '../tabGroupDrag';
import { sidebarPatch,workspaceIsOpen } from '../../runtime/browserChrome';
import { runtime } from '../../runtime/client';
import { siteIdentity } from '../../runtime/sites';
import { isAddressLike } from '../../runtime/siteMark';
import { groupForTab } from '../../runtime/tabGroups';
import { splitPlacements } from '../../runtime/splitPlacement';
import { paneIsAlone,selectStripTab,toggleSolo } from '../../ui/splitPaneSelect';
import { outsideSplit } from '../../runtime/splitGroups';
import { sidebarRows } from './sidebarRows';
import { useSettledPress } from './settledPress';
import { installRowSelectionGuard } from '../../ui/rowSelectionGuard';

// A press-and-drag on a row never leaves text selected (ui/rowSelectionGuard.ts).
installRowSelectionGuard();
import type { BookmarkNode,BrowserAction,BrowserDownload,BrowserSnapshot,HistoryVisit,SidebarSide,TabGroup,TabSession } from '../../runtime/types';
import { pageKey } from '../../features/libraryModel';
import { sidebarNote } from '../../features/downloadText';
import { useNewTabPreferences } from '../../ui/newTabPreferences';
import { animateSpring,classScale,frequentStretch,motionSpeed,stripEase,stripMs,useListMotion } from '../../ui/sharedMotion';
import { bookmarkContext,openPage,savedPageIdentity } from '../../ui/pageActions';
import { openRailSection,setRailPrefs,toggleRailSection,useRailPrefs } from '../../ui/railPrefs';
import { useShownTabsSwitch } from '../../ui/layoutSync';
import { appClickPlan,appHost,appTabFor,droppedLink,listedInSidebar,moveSidebarApp,normalizeAppUrl,noteReleasedTab,removeSidebarAppWithUndo,seedSidebarApps,setSidebarAppsHidden,SIDEBAR_APPS_LIMIT,updateSidebarApp,useSidebarApps,type SidebarApp } from '../../ui/sidebarApps';
import { focusSidebarControl } from '../../ui/sidebarFocus';
import { pointerAnchor,rowAnchor } from '../../ui/popup';
import { profileDownloads } from '../../ui/downloadActivity';
import { DownloadsGlyph } from '../DownloadsGlyph';
import { useSiteIcons } from '../../ui/siteIcons';
import { useIconColors } from '../../ui/siteIconColor';
import { ProfileAvatar } from '../../features/accounts/profileModel';
import { TabPrivacyMark,isNewTabState,privacyNames } from '../TabPrivacyMark';
import { bookmarkControl } from '../../ui/bookmarkControl';
import { layoutOf,setSidebarPeek,useSidebarPeek } from '../../ui/layoutMode';
import { markSwitcherReleased,mruOrder,nextInCycle,readCtrlTabMode,readStamps,recordActivation,switcherIndex,tabCycleOrder,writeSwitcherStart } from '../../ui/tabMru';
import { cancelSplitDrag,endSplitDrag,moveSplitDrag,splitDropAction } from '../../ui/splitDrop';import { carryChip } from '../../ui/useTabDragSurface';import { createEdgeScroller } from '../../ui/dragEdgeScroll';
export { sidebarControl } from '../../ui/layoutMode';
import { clampSidebarWidth,draggedSidebarWidth,favoriteColumns,FAVORITES_LIMIT,overSidebar,previewSidebarWidth,rubberBandWidth,sidebarEdgeOf,sidebarKeyWidth,SIDEBAR_WIDTH,sizeOf,snapSidebarWidth,useSidebarSize } from '../../ui/sidebarLayout';
import { SIZE_NAME_ID } from '../../ui/sidebarSizeNames';
import { sidebarSideOf } from '../../ui/sidebarSide';
import { tabGroupColor } from '../../ui/theme';
import { openWorkspacePage } from '../../ui/workspaceView';
import { bookmarkPlace,bookmarkRef,bookmarkStep,isBarFolder,openBookmarkMenu,SIZE_REF,zoneRef,type DropWhere } from '../../ui/bookmarkMenu';
import { folderTitle } from '../../ui/bookmarkFolderName';
import { CUSTOMIZE_SIDEBAR_EVENT,hideSection,onSidebarRequest,saveSections,sectionHiddenToast,sectionLayout,sectionShown,sidebarWindowId,type SectionId,type SectionLayout } from '../../ui/sidebarSections';
import { groupMembers,profilesAsSpaces,windowWorkspaces } from '../../runtime/workspaces';
import { openWorkspacePopup } from '../../ui/workspaceTarget';
import { addToReadingList,removeFromReadingList,useReadingList } from '../../ui/readingList';
import { SidebarCustomize } from './SidebarCustomize';
import { WorkspaceRow,WorkspaceTitle } from '../../features/workspaces/WorkspaceSwitcher';
import { markWorkspaceDrop,workspaceDropAt,workspaceDropNote,type WorkspaceDragSubject } from '../../ui/workspaceDrop';
import { carrySidebarRow,sidebarRowArea } from '../../ui/sidebarTabDrag';
import { beginBookmarkArrival,useBookmarkArrival } from '../../ui/bookmarkArrival';
import { holdPointer } from '../../ui/dragPointer';
import { startTitleMarquee,stopTitleMarquee } from '../../ui/titleMarquee';
import { shownTab,tabDisplayTitle } from '../../runtime/tabTitle';
import { TabNameInput,useTabRename } from '../TabTitleEditor';
import { cardAnswers,useTabHoverCardMode } from '../../ui/tabHoverCard';
import { controlTitle } from '../../ui/shortcutHints';
import { setFavoriteEditTarget } from '../../ui/favoriteEdit';
import { favoriteTabOf,favoriteTabsOnlyInTile } from '../../runtime/favoriteTabs';
import { favoritesSeparator,favoritesTop } from './favoritesTop';
import { addFavorite,favoriteToast,iconsToBackfill,planFavorite,type FavoriteResult } from '../../ui/favoriteAdd';
import { favoriteMorphing,favoriteSlot,favoriteTile,holdFavoriteTile,releaseFavoriteTile,splitFavoriteFromRow } from '../../ui/favoriteMorph';
import { foldPlan } from './foldMotion';
import '../../styles/sidebar-controls.css';
import './sidebar.css';
import './tab-numbers.css';
import { formatShortcut } from '../../ui/platform';
import { useTabNumbers } from '../../ui/tabNumbers';
import { tabNumberMatches } from '../../runtime/tabNumbers';

import { t } from '../../i18n';
type Dispatch=(action:BrowserAction)=>void;
const APP_TYPE='application/x-acira-app',LINK_TYPE='text/uri-list';
const ease=[.2,0,0,1] as const;
const title=(tab:TabSession)=>tab.customTitle?tabDisplayTitle(tab):['acira://home','acira://new'].includes(tab.url)?t("browsermenu.newTab"):tab.title||tab.url;
const address=(url:string)=>url.replace(/^https?:\/\//,'').replace(/\/$/,'');
const savedTitle=(url:string,state:BrowserSnapshot)=>savedPageIdentity(url,state).title||address(url);
const isWeb=(tab?:TabSession)=>!!tab&&/^https?:\/\//i.test(tab.url);
/** Opens a popup from a row. A right-click passes its pointer so the menu opens AT the click (R3-48); the keyboard has no
 * pointer, so the menu hangs from the row itself. popupGeometry clamps either one inside the window. */
function popup(state:BrowserSnapshot,kind:string,target:HTMLElement,targetTabId?:string,pointer?:{clientX:number;clientY:number}){
 const {x,y,width,height}=pointer?pointerAnchor(pointer.clientX,pointer.clientY):target.getBoundingClientRect();
 void runtime.browserCommand({type:'ui',tabId:state.activeTabId,action:'open',kind,...(targetTabId?{targetTabId}:{}),anchor:{x,y,width,height}});
}
/** Arrow keys walk every focusable sidebar row in reading order, the way a tree view does. */
function moveFocus(event:KeyboardEvent<HTMLElement>,from:HTMLElement=event.currentTarget){
 if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key)||event.altKey||event.ctrlKey||event.metaKey)return false;
 const root=from.closest('.acira-sidebar');if(!root)return false;
 const items=[...root.querySelectorAll<HTMLElement>('[data-sb-focus]')].filter(node=>!node.closest('[inert]')&&node.getClientRects().length);
 const at=items.indexOf(from),next=event.key==='Home'?items[0]:event.key==='End'?items.at(-1):items[at+(event.key==='ArrowDown'?1:-1)];
 if(!next)return false;event.preventDefault();next.focus();next.scrollIntoView({block:'nearest'});return true;
}

/** Scrolls the tab list (only it, and only up or down) so `node` shows. scrollIntoView scrolled every box around the row too: the
 * sidebar is overflow:hidden, so while a switch slid the new list in from the right it scrolled 8px sideways, and the space row and
 * the footer drifted left and back (founder, 3 Nov). */
function revealRow(box:HTMLElement,node:HTMLElement,block:'nearest'|'center',behavior:ScrollBehavior){
 let top=0,at:HTMLElement|null=node;while(at&&at!==box){top+=at.offsetTop;at=at.offsetParent as HTMLElement|null;}
 if(at!==box)return;
 const view=box.scrollTop,height=box.clientHeight,size=node.offsetHeight;
 const goal=block==='center'?top-(height-size)/2:top<view?top:top+size>view+height?top+size-height:view,to=Math.max(0,Math.min(goal,box.scrollHeight-height));
 if(Math.abs(to-view)>.5)box.scrollTo({top:to,behavior});
}
/** Keeps the current tab findable: scrolls to it when it changes or when a tab opens in the background, and reports
 * which edge it went past while the list is scrolled away from it. */
function useActiveReveal(activeId:string,tabs:TabSession[],enabled:boolean,reduced:boolean,space:string){
 const root=useRef<HTMLDivElement>(null),[edge,setEdge]=useState<'above'|'below'|null>(null);
 const seen=useRef<Set<string>|null>(null),lastActive=useRef(activeId),lastSpace=useRef(space);
 const row=(id:string)=>root.current?.querySelector<HTMLElement>(`.sb-tab[data-tab-id="${CSS.escape(id)}"]:not(.sb-flip-ghost)`)||null;
 const measure=useCallback(()=>{
  const node=enabled?row(activeId):null,box=root.current;if(!node||!box||!node.getClientRects().length||node.closest('[inert]')){setEdge(null);return;}
  // Layout position, not the painted one: measured mid-FLIP (rows still transformed) the row read as scrolled away and
  // the "current tab" pill stayed up over a visible row until the next scroll.
  let top=0,at:HTMLElement|null=node;while(at&&at!==box){top+=at.offsetTop;at=at.offsetParent as HTMLElement|null;}
  if(at!==box){const a=node.getBoundingClientRect(),b=box.getBoundingClientRect();setEdge(a.bottom<=b.top+4?'above':a.top>=b.bottom-4?'below':null);return;}
  const view=box.scrollTop;setEdge(top+node.offsetHeight<=view+4?'above':top>=view+box.clientHeight-4?'below':null);
 },[activeId,enabled]);// eslint-disable-line react-hooks/exhaustive-deps
 const ids=tabs.map(tab=>tab.id).join();
 useEffect(()=>{
  const list=tabs.map(tab=>tab.id),fresh=seen.current?list.filter(id=>!seen.current!.has(id)):[];seen.current=new Set(list);
  const target=lastActive.current!==activeId?activeId:fresh.at(-1);lastActive.current=activeId;
  // Another space's list arrives scrolled where its tab is, not scrolling there from where the last list was.
  const switched=lastSpace.current!==space;lastSpace.current=space;
  if(!enabled||!target){measure();return;}
  const frame=requestAnimationFrame(()=>{const node=row(target),box=root.current;if(node&&box)revealRow(box,node,'nearest',reduced||switched?'auto':'smooth');measure();});
  return()=>cancelAnimationFrame(frame);
 },[activeId,ids,enabled,space]);// eslint-disable-line react-hooks/exhaustive-deps
 useEffect(()=>{const box=root.current;if(!box)return;box.addEventListener('scroll',measure,{passive:true});const observer=new ResizeObserver(measure);observer.observe(box);measure();return()=>{box.removeEventListener('scroll',measure);observer.disconnect();};},[measure]);
 return {root,edge,reveal:()=>{const node=row(activeId),box=root.current;if(node&&box)revealRow(box,node,'center',reduced?'auto':'smooth');}};
}

/** True while the element `selector` names starts below the scroll region's visible bottom (concept: with many tabs a
 * sticky "Bookmarks" row above the footer jumps there). */
function useBelowFold(root:{current:HTMLDivElement|null},selector:string,enabled:boolean){
 const [below,setBelow]=useState(false);
 useEffect(()=>{const box=root.current;if(!enabled||!box){setBelow(false);return;}
  const measure=()=>{const node=box.querySelector<HTMLElement>(selector);setBelow(!!node&&node.getBoundingClientRect().top>box.getBoundingClientRect().bottom-8);};
  measure();box.addEventListener('scroll',measure,{passive:true});const observer=new ResizeObserver(measure);observer.observe(box);for(const child of box.children)observer.observe(child);
  return()=>{box.removeEventListener('scroll',measure);observer.disconnect();};
 },[enabled,selector]);// eslint-disable-line react-hooks/exhaustive-deps
 return below;
}
/** Marks a zone whose header is stuck over its own scrolled rows; only then does the header take its glass, so at
 * rest it never draws a band over the sidebar. Written straight to the DOM on scroll (no re-render). */
function useStuckHeaders(root:{current:HTMLDivElement|null},enabled:boolean){
 useEffect(()=>{const box=root.current;if(!enabled||!box)return;
  const update=()=>{const top=box.getBoundingClientRect().top;for(const zone of box.querySelectorAll<HTMLElement>('.sb-zone')){const r=zone.getBoundingClientRect();zone.toggleAttribute('data-stuck',r.top<top-.5&&r.bottom>top+32);}};
  update();box.addEventListener('scroll',update,{passive:true});return()=>box.removeEventListener('scroll',update);
 },[enabled]);// eslint-disable-line react-hooks/exhaustive-deps
}

/** Every tab of this window a favorite can own: the workspace on screen and the others (a favorite's tab follows you). */
const favoriteScope=(state:BrowserSnapshot)=>state.otherWorkspaceTabs?.length?[...state.tabs,...state.otherWorkspaceTabs]:state.tabs;
/** A favorite tile's click (sidebarApps.ts appClickPlan): the favorite's own tab opens, comes back, or returns to its address. */
function openApp(event:MouseEvent<HTMLButtonElement>,app:SidebarApp,state:BrowserSnapshot,dispatch:Dispatch,profileId:string){
 const plan=appClickPlan(event,app,favoriteScope(state),state.activeTabId,profileId);
 if(plan.kind==='none')return;
 if(event.button===1||event.ctrlKey||event.metaKey||event.shiftKey)event.preventDefault();
 if(plan.kind==='open'){dispatch({type:'tab.new',url:app.url,browserProfileId:profileId,favoriteId:app.id});return;}
 if(plan.kind==='select'){dispatch({type:'tab.select',id:plan.tabId});return;}
 if(plan.kind==='adopt'){dispatch({type:'tab.favorite',id:plan.tabId,favoriteId:app.id});if(plan.select)dispatch({type:'tab.select',id:plan.tabId});return;}
 if(plan.kind==='home'){dispatch({type:'tab.navigate',url:app.url,tabId:plan.tabId});return;}
 if(plan.kind==='new-window'){const id='tab-'+crypto.randomUUID();dispatch({type:'tab.new',url:app.url,browserProfileId:profileId,background:true,id});dispatch({type:'tab.move-window',id});return;}
 dispatch({type:'tab.new',url:app.url,browserProfileId:profileId,background:true});
}
/** Ctrl+Tab in the chrome view (Settings > Tabs). "Next tab" (default, like Chrome) selects the next shown tab at once;
 * "Tab viewer" opens the Alt+T viewer; "Recently used" waits 120ms so a quick tap switches straight to the previous
 * tab, and only a held Ctrl shows the switcher overlay (TabSwitcher). */
const switcher={steps:0,timer:0 as number,open:false};
function switcherKey(type:string,direction:number,state:BrowserSnapshot,dispatch:Dispatch,listed:(tab:TabSession)=>boolean){
 if(type==='tab-switcher-release'){
  if(switcher.timer&&!switcher.open){window.clearTimeout(switcher.timer);const order=mruOrder(state.tabs.map(tab=>tab.id),state.activeTabId,readStamps()),target=order[switcherIndex(order.length,0,switcher.steps)];if(target&&target!==state.activeTabId)dispatch({type:'tab.select',id:target});}
  else if(switcher.open)markSwitcherReleased();// the switcher was asked for and may not be on screen yet to hear this (tabMru.ts)
  Object.assign(switcher,{steps:0,timer:0,open:false});return;
 }
 const mode=readCtrlTabMode();
 if(mode==='viewer'){void runtime.browserCommand({type:'ui',tabId:state.activeTabId,action:'open',kind:'tabs'});return;}
 if(state.tabs.length<2)return;
 // Next tab walks the list on screen (runtime/favoriteTabs.ts listedTabs, as main's Ctrl+PageDown): a tab that lives only in its tile is not in it.
 if(mode==='next'){const vertical=layoutOf(state)==='vertical',profile=state.tabs.find(tab=>tab.id===state.activeTabId)?.browserProfileId,cycle=vertical?state.tabs.filter(tab=>tab.browserProfileId===profile&&listed(tab)):state.tabs;const target=nextInCycle(tabCycleOrder(cycle,state.tabGroups,state.activeTabId,vertical),state.activeTabId,direction>0?1:-1);if(target&&target!==state.activeTabId)dispatch({type:'tab.select',id:target});return;}
 switcher.steps+=direction;writeSwitcherStart(switcher.steps);
 if(!switcher.timer&&!switcher.open)switcher.timer=window.setTimeout(()=>{switcher.open=true;switcher.timer=0;writeSwitcherStart(switcher.steps);void runtime.browserCommand({type:'ui',tabId:state.activeTabId,action:'open',kind:'switcher'});},120);
}

/** A tab dragged over the Favorites grid: where it would land. Tab drags are pointer drags (they must keep tracking
 * over the page for split view), so the grid learns about them here instead of through HTML drag events. */
let pinHint:{index:number;/** The page would make a new favorite: the tiles open a slot for it. */adding?:boolean}|null=null;const pinListeners=new Set<()=>void>();
function setPinHint(next:{index:number;adding?:boolean}|null){if(pinHint?.index===next?.index&&pinHint?.adding===next?.adding)return;pinHint=next;pinListeners.forEach(listener=>listener());}
const usePinHint=()=>useSyncExternalStore(listener=>{pinListeners.add(listener);return()=>{pinListeners.delete(listener);};},()=>pinHint);
/** True while a sidebar tab is being dragged: an empty Favorites area shows its drop target only then. */
/** The folder a carried group's chip shows: the header's closed folder in the group's own colour, solid (a copy of the header's icon outside its group loses the colour and the open/closed switch; the header's pale 22% fill is too faint on a chip). */
function groupFolderChip(header:HTMLElement):HTMLElement|undefined{
 const folder=header.querySelector<SVGElement>('.sb-group-folder>svg:first-child');if(!folder)return undefined;
 const mark=document.createElement('span'),copy=folder.cloneNode(true) as SVGElement;
 mark.style.color=getComputedStyle(header.querySelector('.sb-group-folder')??folder).color;copy.style.fill='currentColor';copy.style.opacity='1';mark.append(copy);return mark;
}
let tabDragActive=false;
function setTabDragActive(next:boolean){if(tabDragActive===next)return;tabDragActive=next;pinListeners.forEach(listener=>listener());}
const useTabDragActive=()=>useSyncExternalStore(listener=>{pinListeners.add(listener);return()=>{pinListeners.delete(listener);};},()=>tabDragActive);
/** True while a link is dragged over the window from a page or the interface (not a Favorites tile): with no favorites the drop zone shows only then. */
function useLinkDragActive(enabled:boolean):boolean{
 const [active,setActive]=useState(false);
 useEffect(()=>{
  if(!enabled){setActive(false);return;}
  const over=(event:globalThis.DragEvent)=>{const types=event.dataTransfer?.types;if(types&&types.includes(LINK_TYPE)&&!types.includes(APP_TYPE))setActive(true);};
  const end=()=>setActive(false),leave=(event:globalThis.DragEvent)=>{if(!event.relatedTarget)setActive(false);};
  document.addEventListener('dragenter',over,true);document.addEventListener('dragend',end,true);document.addEventListener('drop',end,true);document.addEventListener('dragleave',leave,true);
  return()=>{document.removeEventListener('dragenter',over,true);document.removeEventListener('dragend',end,true);document.removeEventListener('drop',end,true);document.removeEventListener('dragleave',leave,true);};
 },[enabled]);
 return active;
}
function appsIndexAt(point:{x:number;y:number}):number|null{
 const grid=document.querySelector<HTMLElement>('.acira-sidebar .sb-apps');if(!grid)return null;const box=grid.getBoundingClientRect();
 if(point.x<box.left-4||point.x>box.right+4||point.y<box.top-4||point.y>box.bottom+4)return null;
 // The slot the tiles opened for a tab (sb-app-gap) is not a tile: over it the drop stays where it is, so the slot never chases the pointer.
 const items=[...grid.querySelectorAll<HTMLElement>('[data-app-id],.sb-app-gap')],real=items.filter(node=>!node.classList.contains('sb-app-gap')),tile=items.find(node=>{const r=node.getBoundingClientRect();return point.x>=r.left&&point.x<=r.right&&point.y>=r.top&&point.y<=r.bottom;});
 if(!tile)return real.length;if(tile.classList.contains('sb-app-gap'))return items.indexOf(tile);
 const r=tile.getBoundingClientRect();return real.indexOf(tile)+(point.x>r.left+r.width/2?1:0);
}
/** Making a favorite is one function (ui/favoriteAdd.ts) and one motion (the split, ui/sidebarTabDrag.ts, held to the tile by ui/favoriteMorph.ts) however
 * it is asked for: a drag, Cmd+Shift+D, the command, the tab menu's Add to Favorites, the "+" form, a dropped link. The tab in hand is linked to the
 * favorite and stays in the list exactly where it is; a copy of it splits off and goes up to the tile (a drag hands over the card it carried). */
type RowPreview=NonNullable<ReturnType<typeof carrySidebarRow>>;
function applyFavorite(result:FavoriteResult,dispatch:Dispatch,options:{card?:RowPreview|null;toast?:'all'|'exists';/** Settings keep a favorite's tab only in its tile: the row leaves the list, so the carried card is one copy that goes up (nothing goes home to reopen the row). */tileOnly?:boolean;/** The "+" form: it is open above the list while it saves and closes as the tile arrives, so the row is not where a copy could start from. */still?:boolean}={}){
 const {app,adopt}=result;
 if(app&&result.added){
  if(options.card){holdFavoriteTile(app.id);options.card.favorite(()=>favoriteTile(app.id),()=>releaseFavoriteTile(app.id),{slot:favoriteSlot,...(options.tileOnly?{stay:true}:{})});}
  else if(adopt&&!options.still)splitFavoriteFromRow(app.id,adopt);
 }
 if(app&&adopt)dispatch({type:'tab.favorite',id:adopt,favoriteId:app.id});
 const toast=result.plan.kind==='refuse'||options.toast==='all'||(options.toast==='exists'&&!result.added&&!adopt)?favoriteToast(result):null;
 if(toast)dispatch(toast);
}
/** A tab dropped on Favorites becomes a favorite linked to that tab, which stays in the list (Arc keeps it in the tile; here the list keeps it). */
function pinTab(tab:TabSession,index:number,state:BrowserSnapshot,privateMode:boolean,dispatch:Dispatch,card?:RowPreview|null){
 if(!isWeb(tab)&&!tab.url.startsWith('acira://')){card?.end();return;}
 const result=addFavorite({profileId:tab.browserProfileId,privateMode,url:tab.url,tab,tabs:favoriteScope(state),index,reveal:true}),splits=Boolean(card&&result.added);
 applyFavorite(result,dispatch,{card:splits?card:null,toast:'exists',tileOnly:favoriteTabsOnlyInTile(state.settings)});
 if(card&&!splits)card.end();
}
/** Cmd+Shift+D, the command and the tab menu's Add to Favorites: this tab, wherever it is in the window. */
function favoriteTab(tabId:string,state:BrowserSnapshot,dispatch:Dispatch){
 const tab=favoriteScope(state).find(item=>item.id===tabId);if(!tab)return;
 const owner=state.browserProfiles.find(item=>item.id===tab.browserProfileId);
 if(!isWeb(tab)){dispatch({type:'toast',text:t("acirasidebar.onlyWebsitesCanBeAdded"),tone:'info'});return;}
 applyFavorite(addFavorite({profileId:tab.browserProfileId,privateMode:!!owner?.private,url:tab.url,tab,tabs:favoriteScope(state),reveal:true}),dispatch,{toast:'all'});
}

function RailButton({label,icon,current,onClick,count,children,popupTrigger=false,text,glyph}:{glyph?:EditorIconName;text?:string;label:string;icon?:LucideIcon;current?:boolean;onClick:(target:HTMLButtonElement)=>void;count?:number;children?:ReactNode;popupTrigger?:boolean}){
 return <button className="ed-rail-button" data-sb-focus aria-label={count?`${label}, ${count} active`:label} aria-current={current?'page':undefined} data-tooltip={label} data-popup-trigger={popupTrigger||undefined} onClick={event=>onClick(event.currentTarget)} onKeyDown={moveFocus}>
  {glyph?<EditorGlyph name={glyph}/>:icon?<PreviewIcon icon={icon} size={18}/>:children}<span className="ed-rail-label" aria-hidden="true">{text||label}</span>{count?<span className="ed-rail-count" aria-hidden="true">{count}</span>:null}
 </button>;
}

/** The sidebar (round 11, docs/launch/concepts/sidebar-concept.html): Favorites, then one scroll region with pinned
 * tabs, Tabs (New tab first, groups where their tabs are) and the Bookmarks tree, then the footer. Zones are separated
 * only by fade-ended dividers; every top-level row has its favicon at x=12 and its text at x=36. */
export function AciraSidebar({state,dispatch}:{state:BrowserSnapshot;dispatch:Dispatch}){
 const addressSide=useAddressSidebar();
 const current=state.tabs.find(tab=>tab.id===state.activeTabId)||state.tabs[0];
 // LAYOUT_MODES §5: the sidebar exists only in the vertical layout; in the horizontal layout tabs live in the strip.
 const vertical=layoutOf(state)==='vertical',expanded=vertical&&workspaceIsOpen(state.windowUi,current);
 const profile=state.browserProfiles.find(item=>item.id===current.browserProfileId),privateMode=!!profile?.private,profileId=current.browserProfileId;
 const navigate=(page:string)=>openWorkspacePage(page,state,dispatch);
 const prefs=useRailPrefs(profileId,privateMode),reduced=state.settings.reducedMotion;
 // The tab list is drawn from the switch as shown (ui/layoutSync.ts): a profile just arriving keeps the window's layout until its own switch is in line (the effect below).
 const listTabs=useShownTabsSwitch(vertical,prefs.tabs,profileId);
 const width=clampSidebarWidth(state.settings.sidebarWidth);
 const setWidth=(next:number)=>dispatch({type:'settings.update',patch:{sidebarWidth:clampSidebarWidth(next)}});
 // A favorite's tab is an ordinary tab of the list, where it was, unless Settings keep it only in its tile (runtime/favoriteTabsRule.ts, ui/sidebarApps.ts listedInSidebar).
 const favorites=useSidebarApps(profileId,privateMode);
 const listed=(tab:TabSession)=>listedInSidebar(tab,favorites,state.settings);
 const groups=state.tabGroups.filter(group=>group.browserProfileId===profileId).map(group=>({group,members:state.tabs.filter(tab=>listed(tab)&&groupForTab(state,tab)?.id===group.id)})).filter(item=>item.members.length);
 const profileTabs=state.tabs.filter(tab=>tab.browserProfileId===profileId),listedProfileTabs=profileTabs.filter(listed);
 const active=profileTabs.find(tab=>tab.id===state.activeTabId);
 // Closed is fully hidden (bible 5.2). Resting on the window's left edge peeks it at full width (App's closed width
 // reads --sidebar-rail); it hides again when the pointer leaves. The toolbar toggle and Ctrl+Shift+E open it for good.
 const peeking=useSidebarPeek()&&vertical&&!expanded,setPeeking=setSidebarPeek,shown=expanded||peeking;
 useLayoutEffect(()=>{const root=document.documentElement;if(peeking&&!expanded)root.style.setProperty('--sidebar-rail',`var(--sidebar-width,${width}px)`);else root.style.removeProperty('--sidebar-rail');},[peeking,expanded,width]);
 useEffect(()=>{if(expanded||!vertical)setPeeking(false);},[expanded,vertical]);
 useEffect(()=>{recordActivation(state.activeTabId,state.tabs.map(tab=>tab.id));},[state.activeTabId]);// eslint-disable-line react-hooks/exhaustive-deps
 // A removed favorite (Remove, Delete, an import's Undo, another window) hands its tab back to the tab list as an ordinary tab.
 useEffect(()=>{const ids=new Set(favorites.apps.map(app=>app.id));for(const tab of favoriteScope(state))if(tab.favoriteId&&tab.browserProfileId===profileId&&!ids.has(tab.favoriteId)){noteReleasedTab(tab.favoriteId,tab.id);dispatch({type:'tab.favorite',id:tab.id,favoriteId:null});}},[favorites.apps,state.tabs,state.otherWorkspaceTabs,profileId]);// eslint-disable-line react-hooks/exhaustive-deps
 // Open/closed is one choice for every page (sidebarPatch). If an older writer flipped only one page kind's flag,
 // adopt what the current page shows so switching between websites and internal pages never flips the sidebar.
 useEffect(()=>{if(state.windowUi.workspaceOpen!==state.windowUi.webWorkspaceOpen)dispatch({type:'ui.update',patch:sidebarPatch(workspaceIsOpen(state.windowUi,current))});},[state.windowUi.workspaceOpen,state.windowUi.webWorkspaceOpen]);// eslint-disable-line react-hooks/exhaustive-deps
 useEffect(()=>()=>{document.documentElement.style.removeProperty('--sidebar-rail');},[]);
 const peek=useActiveReveal(state.activeTabId,listedProfileTabs,(expanded||peeking)&&listTabs&&!prefs.folded.tabs,reduced,state.activeWorkspaceId);
 const bookmarksBelow=useBelowFold(peek.root,'[data-zone=bookmarks]',shown);
 useStuckHeaders(peek.root,shown);
 useFlip(peek.root,reduced,state.activeWorkspaceId);
 useSettledPress(peek.root);
 useCardGlide(peek.root,'.sb-tab[aria-current=true]:not([data-hidden])',reduced);
 // One layout store: native settings.verticalTabs is the truth; the per-profile switch follows it, and a change
 // made through that switch (Settings) is written back to the native setting.
 // Another profile coming on screen in this window (profiles as spaces) brings its own switch, which follows the native setting
 // and never rewrites it: the tab layout stays what it is when the profile changes.
 const seenLayout=useRef({native:vertical,profile:prefs.tabs,profileId});
 useEffect(()=>{const seen=seenLayout.current;if(profileId!==seen.profileId){seenLayout.current={native:vertical,profile:vertical,profileId};if(prefs.tabs!==vertical)setRailPrefs({tabs:vertical},profileId,privateMode);return;}
  if(vertical!==seen.native){seenLayout.current={native:vertical,profile:vertical,profileId};if(prefs.tabs!==vertical)setRailPrefs({tabs:vertical},profileId,privateMode);return;}
  if(prefs.tabs!==seen.profile){seenLayout.current={native:prefs.tabs,profile:prefs.tabs,profileId};if(prefs.tabs!==vertical)dispatch({type:'settings.update',patch:{verticalTabs:prefs.tabs}});}
 },[vertical,prefs.tabs,profileId,privateMode]);// eslint-disable-line react-hooks/exhaustive-deps
 // Native signals: Ctrl+Shift+D. (The left-edge peek is main's, desktop/edge-reveal.cjs, and reaches useSidebarPeek as chrome-edge.)
 const latest=useRef({state,dispatch,expanded});latest.current={state,dispatch,expanded};
 useEffect(()=>{const off=runtime.subscribeBrowser?.(raw=>{
  const event=raw as unknown as {type:string;tabId?:string};// sidebar-* events are G's own, outside the shared BrowserEvent union
  const {state,dispatch,expanded}=latest.current;
  if(event.type==='tab-switcher-open'||event.type==='tab-switcher-release'){switcherKey(event.type,(event as {direction?:number}).direction===-1?-1:1,state,dispatch,listed);return;}
  const asked=event.type==='sidebar-pin-app'?event.tabId:event.type==='ui'&&(event as {action?:string}).action==='favorite-tab'?(event as {targetTabId?:string}).targetTabId:undefined;
  if(typeof asked!=='string')return;
  favoriteTab(asked,state,dispatch);
 });return()=>{off?.();};},[]);
 // In sidebar mode the toolbar under a current private or Tor tab takes the same 6% tint as B's strip-mode toolbar,
 // keyed on this attribute (set even while the sidebar is closed, since the toolbar is always there).
 const currentPrivacy=vertical&&current.privacy&&current.privacy!=='secured'?current.privacy:undefined;/* R3-38: a secured workspace's tabs wear no private wash (ui/tabPrivacy.ts) */
 // Sections (Round 2, customisable): Favorites on top, then the movable ones in the order chosen, pinned tabs with
 // the tabs. Right-click on empty sidebar space, or Settings › Sidebar, opens Customize sidebar.
 const saved=sectionLayout(prefs),layout:SectionLayout={...saved,hidden:[...saved.hidden.filter(id=>id!=='favorites'),...(favorites.hidden?['favorites' as const]:[])]};
 const show=(id:SectionId)=>sectionShown(layout,id),[customizing,setCustomizing]=useState(false);
 const favoritesBottom=show('favorites')&&favorites.place==='bottom';
 useEffect(()=>{const open=()=>setCustomizing(true);window.addEventListener(CUSTOMIZE_SIDEBAR_EVENT,open);return()=>window.removeEventListener(CUSTOMIZE_SIDEBAR_EVENT,open);},[]);
 // Favorites keeps one switch, the Favorites store's (Settings › Sidebar "Show Favorites" reads the same one).
 const changeLayout=(next:SectionLayout)=>{const off=next.hidden.includes('favorites');if(off!==favorites.hidden)setSidebarAppsHidden(profileId,privateMode,off);saveSections({...next,hidden:next.hidden.filter(id=>id!=='favorites')},profileId,privateMode);};
 // A section's right-click menu (drawn in the popup renderer) asks this window's sidebar to hide that section or to open Customize sidebar.
 const sectionsNow=useRef({layout,changeLayout,dispatch,profileId,privateMode});sectionsNow.current={layout,changeLayout,dispatch,profileId,privateMode};
 useEffect(()=>onSidebarRequest(sidebarWindowId(state),request=>{
  if(request.kind==='customize'){setCustomizing(true);return;}
  const now=sectionsNow.current;if(now.layout.hidden.includes(request.section))return;
  now.changeLayout(hideSection(now.layout,request.section));now.dispatch(sectionHiddenToast(now.profileId,now.privateMode,request.section));
 }),[state.windowId]);// eslint-disable-line react-hooks/exhaustive-deps
 const background=(event:MouseEvent<HTMLElement>)=>{const target=event.target as HTMLElement;if(target!==event.currentTarget&&!target.classList.contains('sb-sep')&&!target.classList.contains('sb-foot'))return;event.preventDefault();/* Right-click on empty space: a small menu with New workspace… and Customize sidebar…; a private window has no workspaces, so it goes straight to Customize. */if(windowWorkspaces(state).length||profilesAsSpaces(state))openWorkspacePopup(state,'workspace-context',event,{mode:'sidebar'});else setCustomizing(true);};
 const blocks:{id:SectionId;lead:boolean}[]=[];
 for(const id of layout.order)if(id==='tabs'?listTabs&&(show('tabs')||show('pinned')):show(id))blocks.push({id,lead:blocks.length>0});
 const block=({id,lead}:{id:SectionId;lead:boolean})=>id==='tabs'?<SidebarTabs key={id} state={state} dispatch={dispatch} tabs={listedProfileTabs} groups={groups} newTabsTop={!!prefs.newTabsTop} folders={prefs.folders??'mixed'} showPinned={show('pinned')} showList={show('tabs')} lead={lead}/>
  :id==='bookmarks'?<SidebarBookmarks key={id} state={state} dispatch={dispatch} profileId={profileId} privateMode={privateMode} folded={prefs.folded} reduced={reduced} lead={lead}/>
  :id==='downloads'?<SidebarDownloads key={id} state={state} dispatch={dispatch} profileId={profileId} privateMode={privateMode} folded={prefs.folded} reduced={reduced} lead={lead} navigate={navigate}/>
  :id==='history'?<SidebarHistory key={id} state={state} dispatch={dispatch} profileId={profileId} privateMode={privateMode} folded={prefs.folded} reduced={reduced} lead={lead} navigate={navigate}/>
  :<SidebarReading key={id} state={state} dispatch={dispatch} current={current} profileId={profileId} privateMode={privateMode} folded={prefs.folded} reduced={reduced} lead={lead}/>;
 if(!shown)return <aside className="ed-rail acira-sidebar" aria-label={t("acirasidebar.sidebar")} aria-hidden="true" inert data-current-privacy={currentPrivacy} data-reduced-motion={reduced||undefined}/>;
 return <aside className={`ed-rail acira-sidebar is-expanded${peeking&&!expanded?' is-peek':''}`} aria-label={t("acirasidebar.sidebar")} data-current-privacy={currentPrivacy} data-reduced-motion={reduced||undefined} data-addr-side={addressSide.block||undefined} data-addr-open={addressSide.open||undefined}>
  {/* Favorites sit at the top (the default) or at the bottom, above the workspace row and the footer (Settings > Tabs > Sidebar > Favorites). */}
  {show('favorites')&&!favoritesBottom?<><SidebarTop state={state} dispatch={dispatch} current={current} profileId={profileId} privateMode={privateMode}/>{favoritesSeparator(favorites.apps.length)&&<div className="sb-sep" role="separator"/>}</>:<div className="sb-top-space" aria-hidden="true"/>}
  <div className="sb-sections-wrap">{!customizing&&<WorkspaceTitle state={state}/>}<div ref={peek.root} className="sb-scroll" onContextMenu={background}>
   {customizing?<SidebarCustomize layout={layout} onChange={changeLayout} onDone={()=>setCustomizing(false)} favoritesPlace={favorites.place==='bottom'?'bottom':'top'}/>:blocks.map(block)}
  </div>
  {peek.edge&&active&&<button type="button" className="sb-active-peek" data-edge={peek.edge} title={t("acirasidebar.showTheCurrentTab")} onClick={peek.reveal}><SiteIdentityIcon url={active.url} favicon={active.favicon} size={16}/><span className="sb-active-peek-title">{title(active)}</span><PreviewIcon icon={peek.edge==='above'?ArrowUp:ChevronDown} size={12}/></button>}
  {bookmarksBelow&&<button type="button" className="sb-jump" onClick={()=>peek.root.current?.querySelector<HTMLElement>('[data-zone=bookmarks]')?.scrollIntoView({block:'start',behavior:reduced?'auto':'smooth'})}><span>{t("browsermenu.bookmarks")}</span><PreviewIcon icon={ChevronDown} size={10}/></button>}
  </div>
  <SidebarMedia state={state} dispatch={dispatch}/>
  {favoritesBottom&&<div className="sb-favorites-bottom">{favoritesSeparator(favorites.apps.length)&&<div className="sb-sep" role="separator"/>}<SidebarTop state={state} dispatch={dispatch} current={current} profileId={profileId} privateMode={privateMode}/></div>}
  <WorkspaceRow state={state} dispatch={dispatch} moveFocus={moveFocus}/>
  <SidebarFooter state={state} dispatch={dispatch} current={current} navigate={navigate}/>
  {<ResizeHandle width={width} onChange={setWidth} side={sidebarSideOf(state.settings)}/>}
 </aside>;
}

/** The top of the sidebar: the Favorites grid, or (with no favorites) an empty band level with the toolbar row that
 * drags the window, so the tab list starts at the page's top edge and nothing floats in an unexplained gap. The band is
 * also where the drop zone floats while a tab or link is dragged (favoritesTop.ts). With favorites it is `display:contents`,
 * so the grid keeps one place in the tree when the first favorite arrives. */
function SidebarTop(props:{state:BrowserSnapshot;dispatch:Dispatch;current:TabSession;profileId:string;privateMode:boolean}){
 const {hidden,apps}=useSidebarApps(props.profileId,props.privateMode);
 return <div className="sb-caption" data-filled={!hidden&&apps.length>0?'':undefined} aria-hidden={hidden?true:undefined}><SidebarApps {...props}/></div>;
}

/** Downloads seen on the Downloads page; anything finished since shows a small accent dot. */
const SEEN='acira-downloads-seen';
const readSeen=()=>{try{return new Set<string>(JSON.parse(localStorage.getItem(SEEN)||'[]'));}catch{return new Set<string>();}};
/** The domino mask F's profile panel shows for private windows (ProfileSwitcher.tsx), so both read the same. */
const PrivateGlyph=()=><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"><path d="M1.75 6.25c0-1.1.9-1.75 2-1.75h8.5c1.1 0 2 .65 2 1.75v1c0 2.3-1.5 4-3.4 4-1.2 0-1.9-.7-2.85-1.9-.95 1.2-1.65 1.9-2.85 1.9-1.9 0-3.4-1.7-3.4-4z"/><path d="M4.5 7.5h1.75M9.75 7.5h1.75" strokeLinecap="round"/></svg>;
/** Footer: who you are (avatar + name, opens the profile panel) and four places on 28px targets. */
function SidebarFooter({state,dispatch,current,navigate}:{state:BrowserSnapshot;dispatch:Dispatch;current:TabSession;navigate:(page:string)=>void}){
 const profile=state.browserProfiles.find(item=>item.id===current.browserProfileId),isPrivate=!!profile?.private,name=isPrivate?'Private':profile?.name||'Personal';
 const downloads=profileDownloads(state,current.browserProfileId);
 const active=downloads.filter(item=>item.status==='Downloading');
 const onDownloads=current.url==='acira://downloads',[seen,setSeen]=useState(readSeen);
 const finished=downloads.filter(item=>item.status==='Ready').map(item=>item.id);
 useEffect(()=>{if(!onDownloads)return;const next=[...new Set([...seen,...finished])].slice(-400);try{localStorage.setItem(SEEN,JSON.stringify(next));}catch{/* the dot just stays */}setSeen(new Set(next));},[onDownloads,finished.join()]);// eslint-disable-line react-hooks/exhaustive-deps
 const fresh=!onDownloads&&finished.some(id=>!seen.has(id));
 /** The downloads button opens the downloads popup (the toolbar button's panel); the page itself is one row further, and Ctrl+J. Opening it counts as seeing what finished. */
 const openDownloads=(event:MouseEvent<HTMLButtonElement>)=>{const next=[...new Set([...seen,...finished])].slice(-400);try{localStorage.setItem(SEEN,JSON.stringify(next));}catch{/* the dot just stays */}setSeen(new Set(next));popup(state,'downloads',event.currentTarget);};
 const place=(label:string,current:boolean,onClick:()=>void,icon:ReactNode,extra?:ReactNode)=><button type="button" className="sb-foot-icon" aria-label={label} title={label} aria-current={current?'page':undefined} onClick={onClick}>{icon}{extra}</button>;
 return <div className="sb-foot">
  <button type="button" className="sb-foot-profile" data-sb-focus data-popup-trigger aria-haspopup="dialog" aria-label={`${name}. Switch profile`} title={isPrivate?t("acirasidebar.privateWindowNothingFromThis"):t("app.switchProfile")} onKeyDown={moveFocus} onClick={event=>popup(state,'profile',event.currentTarget)}>
   {isPrivate?<span className="sb-foot-private" aria-hidden="true"><PrivateGlyph/></span>:<ProfileAvatar name={name} color={profile?.color||'#6b7280'} avatar={profile?.avatar} picture={profile?.picture} size={22}/>}<span>{name}</span>
  </button>
  <div className="sb-foot-icons">
   {place(`Bookmarks · ${formatShortcut('Ctrl Shift O')}`,current.url==='acira://bookmarks',()=>navigate('bookmarks'),<EditorGlyph name="bookmarks"/>)}
   <button type="button" className="sb-foot-icon" data-popup-trigger aria-haspopup="dialog" aria-label={`${active.length?t('dl.btnActive',{count:active.length}):fresh?t('dl.btnNew'):t('browsermenu.downloads')} · ${formatShortcut('Ctrl J')}`} title={`${active.length?t('dl.btnActive',{count:active.length}):fresh?t('dl.btnNew'):t('browsermenu.downloads')} · ${formatShortcut('Ctrl J')}`} aria-current={onDownloads?'page':undefined} onClick={openDownloads}>
    <DownloadsGlyph downloads={downloads} reducedMotion={state.settings.reducedMotion} idle={<><svg viewBox="0 0 16 16" aria-hidden="true" className="sb-foot-glyph"><path d="M8 2.5v7.5M4.75 6.75 8 10l3.25-3.25M3 13.25h10"/></svg>{fresh?<i className="sb-foot-dot" aria-hidden="true"/>:null}</>}/>
   </button>
   {place(`History · ${formatShortcut('Ctrl H')}`,current.url==='acira://history',()=>navigate('history'),<EditorGlyph name="history"/>)}
   {place(`Settings · ${formatShortcut('Ctrl ,')}`,current.url==='acira://settings',()=>navigate('settings'),<EditorGlyph name="settings"/>)}
  </div>
 </div>;
}

/** Drag the sidebar edge: it follows the pointer between Narrow and Wide and, on release, settles on the nearest of the three sizes (the Favorites grid reflows
 * at the two midpoints, so it shows where it will land). Arrows step to the next size, Home is Narrow, End is Wide, Enter or a double-click is Standard, and a
 * right-click (or the menu key) lists the three. The grip is on the sidebar's page-side edge, so the drag and the arrows mirror on the right (ui/sidebarLayout
 * draggedSidebarWidth, sidebarKeyWidth); the rubber band and the clamp do not care which side. */
function ResizeHandle({width,onChange,side}:{width:number;onChange:(width:number)=>void;side:SidebarSide}){
 const drag=useRef<{x:number;width:number;raw:number}|null>(null);
 // Release: ease from the rubber-banded edge to the size it is nearest, then hand back to the setting.
 const end=()=>{if(!drag.current)return;const target=snapSidebarWidth(drag.current.raw);drag.current=null;previewSidebarWidth(target,false);onChange(target);window.setTimeout(()=>{if(!drag.current)previewSidebarWidth(null);},450);};
 const key=(event:KeyboardEvent<HTMLDivElement>)=>{
  if(event.key==='ContextMenu'||event.shiftKey&&event.key==='F10'){event.preventDefault();const box=event.currentTarget.getBoundingClientRect();openBookmarkMenu(SIZE_REF,{x:box.left+box.width/2,y:box.top+box.height/2,width:2,height:2});return;}
  const next=sidebarKeyWidth(side,event.key,width);
  if(next===null)return;event.preventDefault();onChange(next);
 };
 return <div className="sb-resize" role="separator" aria-orientation="vertical" aria-label={t("acirasidebar.resizeSidebar")} aria-valuemin={SIDEBAR_WIDTH.min} aria-valuemax={SIDEBAR_WIDTH.max} aria-valuenow={width} aria-valuetext={t(SIZE_NAME_ID[sizeOf(width)])} tabIndex={0} title={t("acirasidebar.dragToResizeDoubleClick")}
  onPointerDown={(event:PointerEvent<HTMLDivElement>)=>{if(event.button!==0)return;event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);drag.current={x:event.clientX,width,raw:width};previewSidebarWidth(width);}}
  onPointerMove={event=>{if(!drag.current)return;const raw=draggedSidebarWidth(side,drag.current.width,drag.current.x,event.clientX);drag.current.raw=raw;previewSidebarWidth(rubberBandWidth(raw));}}
  onContextMenu={event=>{event.preventDefault();event.stopPropagation();openBookmarkMenu(SIZE_REF,{x:event.clientX,y:event.clientY,width:2,height:2});}}
  onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end} onDoubleClick={()=>onChange(SIDEBAR_WIDTH.initial)} onKeyDown={key}/>;
}

/** Pinned sites above everything else. Click returns to the app's tab, or opens it. */
function SidebarApps({state,dispatch,current,profileId,privateMode}:{state:BrowserSnapshot;dispatch:Dispatch;current:TabSession;profileId:string;privateMode:boolean}){
 const {apps,hidden,seeded}=useSidebarApps(profileId,privateMode),[newTab]=useNewTabPreferences(profileId,privateMode);
 const [editing,setEditing]=useState<string|null>(null),[more,setMore]=useState(false),[drop,setDrop]=useState<{index:number}|null>(null);
 const grid=useRef<HTMLDivElement>(null),pin=usePinHint(),hint=drop||pin;
 useCardGlide(grid,'.sb-app[aria-current=page]',state.settings.reducedMotion);
 // R3-70: favorites tiles glide to their places when one is added, removed or moved (a new one settles in, a removed one fades out).
 useListMotion(grid,apps.map(app=>app.id).join(',')+':'+more+':'+(hint?hint.index:'')+(pin?.adding?'+':''),{frequent:true});
 const siteIcon=useSiteIcons(state);
 // The active tile's ring takes its site's colour: each tile's own icon, read once on this computer (ui/siteIconColor.ts); a private window keeps the answers in memory.
 const colours=useIconColors(apps.map(app=>({key:app.id,site:appHost(app.url),src:app.icon||siteIdentity(app.url).icon||siteIcon(app.url)})),!privateMode);
 useEffect(()=>{if(!seeded)seedSidebarApps(profileId,privateMode,newTab.shortcuts.filter(item=>item.sidebar).map(item=>({url:item.url,title:item.title})));},[seeded,profileId,privateMode]);// eslint-disable-line react-hooks/exhaustive-deps
 useEffect(()=>{if(editing&&editing!=='new'&&!apps.some(app=>app.id===editing))setEditing(null);},[apps,editing]);
 const draggingTab=useTabDragActive(),linkDragging=useLinkDragActive(!hidden&&!apps.length);
 // A favorite made without an icon (an import, a dropped link, a typed address) takes the first local one the browser knows, so it ends up the
 // tile a dragged tab makes (ui/favoriteAdd.ts iconsToBackfill). Nothing is fetched.
 const scope=favoriteScope(state),lacking=apps.some(app=>!app.icon&&!app.url.startsWith('acira://')),iconKey=lacking?scope.map(tab=>tab.id+tab.favicon.length).join(','):'';
 useEffect(()=>{if(!lacking)return;for(const item of iconsToBackfill(apps,scope,profileId,siteIcon))updateSidebarApp(profileId,privateMode,item.id,{icon:item.icon});},[apps,iconKey,siteIcon,profileId,privateMode]);// eslint-disable-line react-hooks/exhaustive-deps
 // The first favorite opens the region (a floating drop target turns into a row of tiles) and the last one closes it: the list below glides
 // by the difference on the list spring instead of jumping (it read as a pop: 31 px in one frame).
 const regionShown=useRef(apps.length),regionTop=useRef<number|null>(null);
 if(regionShown.current!==apps.length&&(regionShown.current===0||apps.length===0)&&regionTop.current===null)regionTop.current=document.querySelector('.acira-sidebar .sb-sections-wrap')?.getBoundingClientRect().top??null;
 useLayoutEffect(()=>{
  if(regionShown.current===apps.length)return;regionShown.current=apps.length;
  const before=regionTop.current;regionTop.current=null;if(before===null)return;
  const wrap=document.querySelector<HTMLElement>('.acira-sidebar .sb-sections-wrap'),shift=wrap?before-wrap.getBoundingClientRect().top:0;
  if(wrap&&Math.abs(shift)>1)animateSpring(wrap,[{translate:`0 ${shift}px`},{translate:'0 0'}],'reorder.move',{fill:'none'});
 },[apps.length]);
 if(hidden)return null;
 // No favorites yet: show nothing (Ctrl+Shift+D, dragging a tab up and Settings all add one). While a tab is dragged
 // a drop target floats over the top of the sidebar, so the list never shifts under the pointer.
 // A link dragged in from a page pins like a tab does, at the drop index (L's drag pass). Handled here, so the
 // document-level link drop (src/ui/useLinkDrop.ts) sees defaultPrevented and leaves it alone.
 const pinLink=(event:DragEvent<HTMLElement>,index:number)=>{
  const link=droppedLink(event.dataTransfer.getData(LINK_TYPE),event.dataTransfer.getData('text/html'),event.dataTransfer.getData('text/plain'));
  if(!link){dispatch({type:'toast',text:t("acirasidebar.onlyLinksToWebsitesCan"),tone:'info'});return;}
  applyFavorite(addFavorite({profileId,privateMode,url:link.url,title:link.title,tabs:favoriteScope(state),index,reveal:true}),dispatch,{toast:'all'});
 };
 const linkOver=(event:DragEvent<HTMLElement>)=>event.dataTransfer.types.includes(LINK_TYPE)&&!event.dataTransfer.types.includes(APP_TYPE);
// No Favorites yet (coordinator, 27 Oct): nothing is drawn, so a fresh sidebar has no empty boxes above New tab. While a tab or a link is
 // dragged, a drop zone floats over the top of the list (the rows never move under the pointer) and says what a drop does; it fades in
 // with the drag. Ctrl+Shift+D, the bookmark star menu and Settings › Sidebar add a favorite without a drag.
 const top=favoritesTop({hidden,count:apps.length,editingNew:editing==='new',tabDrag:draggingTab,linkDrag:linkDragging,overZone:Boolean(drop||hint)});
 if(top==='idle')return null;
 if(top==='drop'){
  return <div className="sb-apps-region sb-apps-float"><div className="sb-apps sb-apps-ghost" role="group" aria-label={t("acirasidebar.favoritesEmpty")} style={{'--sb-cols':3} as CSSProperties} data-dragging data-dropping={hint?'':undefined}
   onDragOver={event=>{if(!linkOver(event))return;event.preventDefault();event.dataTransfer.dropEffect='copy';setDrop(previous=>previous?previous:{index:0});}}
   onDragLeave={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node))setDrop(null);}}
   onDrop={event=>{if(!linkOver(event))return;event.preventDefault();setDrop(null);pinLink(event,0);}}>
   {[0,1,2].map(index=><span key={index} className="sb-app sb-app-ghost" aria-hidden="true"/>)}
   <span className="sb-apps-ghost-hint" aria-hidden="true">{t("acirasidebar.dropToAddToFavorites")}</span>
  </div></div>;
 }
 const open=(event:MouseEvent<HTMLButtonElement>,app:SidebarApp)=>{
  openApp(event,app,state,dispatch,profileId);
 };
 // Favorites cap at 12 (Arc, Zen), the rest behind +N, and never more than four rows: Narrow (2 across) shows 7 and +N. The size sets the columns: 2, 3 or 4 across;
 // Standard keeps 4 across for the counts where 3 leaves a ragged last row (Zen), as it always has.
 const size=useSidebarSize(clampSidebarWidth(state.settings.sidebarWidth)),limit=FAVORITES_LIMIT[size],overflow=!more&&apps.length>limit,shown=overflow?apps.slice(0,limit-1):apps,tiles=shown.length+(overflow?1:0);
 const cols=favoriteColumns(size,tiles),making=Boolean(pin?.adding)&&!overflow&&!drop;
 const focusTile=(id:string)=>requestAnimationFrame(()=>grid.current?.querySelector<HTMLElement>(`[data-app-id="${id}"]`)?.focus());
 // Edit favorite is a popover from the tile (A's panel spec); a private window's favorites live in this renderer only,
 // so there it stays the inline form.
 const edit=(app:SidebarApp,tile:HTMLElement)=>{if(privateMode){setEditing(app.id);return;}setFavoriteEditTarget({profileId,appId:app.id});popup(state,'favorite-edit',tile);};
 const key=(event:KeyboardEvent<HTMLButtonElement>,app:SidebarApp,index:number)=>{
  if(event.key==='F2'||event.key==='ContextMenu'||event.shiftKey&&event.key==='F10'){event.preventDefault();edit(app,event.currentTarget);return;}
  if(event.key==='Delete'){event.preventDefault();const toast=removeSidebarAppWithUndo(profileId,privateMode,app.id);if(toast)dispatch(toast);const next=apps[index+1]||apps[index-1];if(next)focusTile(next.id);return;}
  if(event.altKey&&(event.key==='ArrowLeft'||event.key==='ArrowRight')){event.preventDefault();moveSidebarApp(profileId,privateMode,app.id,index+(event.key==='ArrowLeft'?-1:1));focusTile(app.id);return;}
  if(event.key==='ArrowLeft'||event.key==='ArrowRight'){const tiles=[...(grid.current?.querySelectorAll<HTMLElement>('.sb-app')||[])],at=tiles.indexOf(event.currentTarget),next=tiles[at+(event.key==='ArrowLeft'?-1:1)];if(next){event.preventDefault();next.focus();}return;}
  moveFocus(event);
 };
 const dropIndex=(event:DragEvent<HTMLElement>)=>{
  const tile=(event.target as HTMLElement).closest<HTMLElement>('[data-app-id]');if(!tile)return apps.length;
  const index=apps.findIndex(app=>app.id===tile.dataset.appId),bounds=tile.getBoundingClientRect();
  return index<0?apps.length:index+(event.clientX>bounds.left+bounds.width/2?1:0);
 };
 const accepts=(event:DragEvent<HTMLElement>)=>event.dataTransfer.types.includes(APP_TYPE)||linkOver(event);
 const onDrop=(event:DragEvent<HTMLElement>)=>{
  if(!accepts(event))return;event.preventDefault();const index=dropIndex(event);setDrop(null);
  const appId=event.dataTransfer.getData(APP_TYPE);
  if(appId){const from=apps.findIndex(app=>app.id===appId);moveSidebarApp(profileId,privateMode,appId,from>=0&&from<index?index-1:index);return;}
  pinLink(event,index);
 };
 return <div className="sb-apps-region" onContextMenu={event=>{if((event.target as HTMLElement).closest('.sb-app,.sb-app-editor'))return;event.preventDefault();openBookmarkMenu(zoneRef('favorites'),{x:event.clientX,y:event.clientY,width:2,height:2});}}>
  <div ref={grid} className="sb-apps" role="toolbar" aria-label={t("acirasidebar.favorites")} style={{'--sb-cols':cols} as CSSProperties} data-dropping={hint?'':undefined}
   onDragOver={event=>{if(!accepts(event))return;event.preventDefault();event.dataTransfer.dropEffect=event.dataTransfer.types.includes(APP_TYPE)?'move':'link';const index=dropIndex(event);setDrop(previous=>previous?.index===index?previous:{index});}}
   onDragLeave={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node))setDrop(null);}} onDrop={onDrop}>
   {(()=>{const tiles=shown.map((app,index)=>{const tab=appTabFor(app,favoriteScope(state),profileId),active=tab?.id===state.activeTabId;
    const away=active&&tab.url!==app.url;
    return <button key={app.id} type="button" className="sb-app" data-app-id={app.id} data-morph={favoriteMorphing(app.id)?'':undefined} data-motion-skip={favoriteMorphing(app.id)?'':undefined} data-open={tab?'':undefined} data-sleeping={tab?.sleeping&&favoriteTabsOnlyInTile(state.settings)?'':undefined} data-site={colours[app.id]?'':undefined} style={colours[app.id]?{'--site-h':colours[app.id]!.h,'--site-c':colours[app.id]!.c} as CSSProperties:undefined} data-away={away||undefined} data-editing={editing===app.id||undefined} data-drop={making?undefined:hint?.index===index?'before':hint?.index===index+1&&index===shown.length-1?'after':undefined} aria-current={active?'page':undefined} aria-label={app.title} title={away?t("acirasidebar.clickToGoBack",{host:appHost(app.url)||address(app.url)}):`${app.title} · ${address(app.url)}`} draggable
     onClick={event=>open(event,app)} onAuxClick={event=>open(event,app)} onMouseDown={event=>{if(event.button===1)event.preventDefault();}}
     onContextMenu={event=>{event.preventDefault();edit(app,event.currentTarget);}} onKeyDown={event=>key(event,app,index)}
     onDragStart={event=>{event.dataTransfer.setData(APP_TYPE,app.id);event.dataTransfer.effectAllowed='move';}} onDragEnd={()=>setDrop(null)}>
     <AppIcon app={app} tab={tab} stored={siteIcon(app.url)} reduced={state.settings.reducedMotion}/>
    </button>;});
    // A tab over the grid that would make a favorite: the tiles make room, an empty slot opens where the copy will land (the split).
    if(making)tiles.splice(Math.min(pin!.index,shown.length),0,<span key="gap" className="sb-app sb-app-slot sb-app-gap" aria-hidden="true"/>);
    return tiles;})()}
   {overflow?<button type="button" className="sb-app sb-app-more" aria-label={t("acirasidebar.showCountMoreFavorites", { count: apps.length-shown.length })} onClick={()=>setMore(true)}>+{apps.length-shown.length}</button>
    // The pin tile only fills a gap in the last row (never starts a row of its own) and shows on hover or focus.
    :making||tiles%cols===0&&!hint&&editing!=='new'?null:<button type="button" className="sb-app sb-app-add" aria-label={t("acirasidebar.addAFavorite")} title={nameAndNote(t("acirasidebar.addToFavoritesDAdds", { shortcut: formatShortcut('Ctrl Shift D') }))} aria-expanded={editing==='new'} onClick={()=>setEditing(editing==='new'?null:'new')} onKeyDown={moveFocus}><PreviewIcon icon={Pin} size={14}/></button>}
   {/* Drop slots appear only while a tab is dragged over the grid; at rest the grid ends at the add tile. */}
   {!overflow&&hint&&!making&&Array.from({length:(cols-(tiles+1)%cols)%cols},(_,index)=><button key={'slot-'+index} type="button" tabIndex={-1} className="sb-app sb-app-slot" aria-hidden="true" onClick={()=>setEditing('new')}/>)}
   {more&&apps.length>limit&&<button type="button" className="sb-app sb-app-more" aria-label={t("acirasidebar.showFewerFavorites")} onClick={()=>setMore(false)}><PreviewIcon icon={ChevronDown} size={14} className="sb-flip"/></button>}
  </div>
  <AnimatePresence initial={false}>{editing&&<AppEditor key={editing} tabs={favoriteScope(state)} app={apps.find(app=>app.id===editing)} tab={editing==='new'?undefined:favoriteTabOf(favoriteScope(state),editing,profileId)} current={current} profileId={profileId} privateMode={privateMode} reduced={state.settings.reducedMotion} dispatch={dispatch} onDone={id=>{setEditing(null);if(id)focusTile(id);}}/>}</AnimatePresence>
 </div>;
}

/** Local images only: a saved data URL, a bundled site icon, an open tab's live favicon, M's favicon store (kept on
 * this computer while you were on the site), else the initial. */
function AppIcon({app,tab,stored,reduced=false}:{app:SidebarApp;tab?:TabSession;stored?:string;reduced?:boolean}){
 const live=tab&&appHost(tab.url)===appHost(app.url)?tab.favicon:'';
 // The Link preview marker (item 17): while a preview is open from this favorite's tab, a card with the preview's site icon slides out beside the icon.
 const marker=<PeekMarkerCard tabId={tab?.id} size={14} reduced={reduced}/>;
 if(app.icon||siteIdentity(app.url).icon||live||stored||app.url.startsWith('acira://')||isAddressLike(app.url))return <><SiteIdentityIcon url={app.url} favicon={app.icon||live||stored} size={16}/>{marker}</>;
 return <><span className="sb-app-initial" aria-hidden="true">{(app.title||appHost(app.url)||'?').trim()[0]?.toUpperCase()}</span>{marker}</>;
}

/** A private window's inline Add / Edit favorite. `tab`: the favorite's own tab while open, which Close tab unloads (as Cmd+W does) keeping the favorite. */
function AppEditor({app,tab,tabs,current,profileId,privateMode,reduced,dispatch,onDone}:{app?:SidebarApp;tab?:TabSession;tabs:readonly TabSession[];current:TabSession;profileId:string;privateMode:boolean;reduced:boolean;dispatch:Dispatch;onDone:(focusId?:string)=>void}){
 const fromTab=!app&&isWeb(current);
 const [name,setName]=useState(app?.title??(fromTab?current.title:'')),[url,setUrl]=useState(app?.url??(fromTab?current.url:'')),[error,setError]=useState('');
 const first=useRef<HTMLInputElement>(null);
 useLayoutEffect(()=>{first.current?.focus({preventScroll:true});first.current?.select();},[]);
 const save=()=>{
  if(app){const failed=updateSidebarApp(profileId,privateMode,app.id,{url,title:name});if(failed)return setError(failed);return onDone(app.id);}
  // The same favorite a drag makes: when the address is the current page's, that tab becomes its own tab (ui/favoriteAdd.ts).
  const result=addFavorite({profileId,privateMode,url,title:name,tab:fromTab&&normalizeAppUrl(url)===normalizeAppUrl(current.url)?current:undefined,tabs,reveal:true});
  if(result.plan.kind==='refuse')return setError(result.plan.message);
  if(!result.added&&!result.adopt)return setError(t("acirasidebar.titleIsAlreadyInFavorites",{title:result.app?.title??name}));
  applyFavorite(result,dispatch,{still:true});onDone(result.app?.id);
 };
 return <motion.form className="sb-app-editor" aria-label={app?t("acirasidebar.editFavorite"):t("acirasidebar.addToFavorites")} initial={reduced?false:{opacity:0,y:-4}} animate={{opacity:1,y:0}} exit={reduced?{opacity:0,transition:{duration:0}}:{opacity:0,y:-4}} transition={{duration:reduced?0:.14,ease}}
  onSubmit={event=>{event.preventDefault();save();}} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();onDone(app?.id);}}}>
  <div className="sb-app-editor-body">
   <div className="sb-app-editor-head"><span>{app?t("acirasidebar.editFavorite"):t("acirasidebar.addToFavorites")}</span>{isWeb(current)&&url!==current.url&&<button type="button" className="sb-link" onClick={()=>{setName(current.title);setUrl(current.url);setError('');}}>{t("acirasidebar.useCurrentTab")}</button>}</div>
   <label><span>{t("acirasidebar.name")}</span><input ref={app||fromTab?first:undefined} value={name} maxLength={80} placeholder={t("acirasidebar.mail")} onChange={event=>setName(event.target.value)}/></label>
   <label><span>{t("acirasidebar.address")}</span><input ref={app||fromTab?undefined:first} value={url} placeholder="example.com" spellCheck={false} aria-invalid={!!error||undefined} aria-describedby={error?'sb-app-error':undefined} onChange={event=>{setUrl(event.target.value);setError('');}}/></label>
   {error&&<p id="sb-app-error" className="sb-app-error" role="alert">{error}</p>}
   <div className="sb-app-editor-actions">{app&&<button type="button" className="sb-button sb-danger" onClick={()=>{const toast=removeSidebarAppWithUndo(profileId,privateMode,app.id);if(toast)dispatch(toast);onDone();}}>{t("acirasidebar.remove")}</button>}{app&&tab&&<button type="button" className="sb-button" onClick={()=>{dispatch({type:'tab.close',id:tab.id});onDone(app.id);}}>{t("app.closeTab")}</button>}<span/><button type="button" className="sb-button" onClick={()=>onDone(app?.id)}>{t("acirasidebar.cancel")}</button><button type="submit" className="sb-button sb-primary">{app?t("acirasidebar.save"):'Add'}</button></div>
  </div>
 </motion.form>;
}

/** Pinned tabs (their own zone, no close), then the Tabs zone: New tab first (last when "New tabs at the top" is off),
 * then groups and loose tabs in tab order (a group sits where its first tab is; groups are not hoisted). */
function SidebarTabs({state,dispatch,tabs,groups,newTabsTop,folders='mixed',showPinned=true,showList=true,lead=false}:{state:BrowserSnapshot;dispatch:Dispatch;tabs:TabSession[];groups:{group:TabGroup;members:TabSession[]}[];newTabsTop:boolean;/** Where the groups sit among the tabs (Settings > Sidebar > Tab groups). */folders?:SidebarFolders;showPinned?:boolean;showList?:boolean;lead?:boolean}){
 // Arc/Dia (founder, 24 Oct): newest tabs first, right under the New tab row. A tab that was just appended is shown
 // at the top at once (the model is reordered a moment later), so it never flashes at the bottom first; a reopened
 // tab keeps its own place.
 const known=useRef<Set<string>|null>(null),closedBefore=useRef<Set<string>>(new Set()),reduced=state.settings.reducedMotion;
 // Settings keep a favorite's tab only in its tile: dragging the tile onto the tab list takes the tab out of it, into the list. The favorite stays, its tile loses the dot.
 const tileOnly=favoriteTabsOnlyInTile(state.settings);
 const tileOver=(event:DragEvent<HTMLElement>)=>{if(tileOnly&&event.dataTransfer.types.includes(APP_TYPE)){event.preventDefault();event.dataTransfer.dropEffect='move';}};
 const tileDrop=(event:DragEvent<HTMLElement>)=>{const appId=tileOnly?event.dataTransfer.getData(APP_TYPE):'';if(!appId)return;event.preventDefault();const profile=state.tabs.find(tab=>tab.id===state.activeTabId)?.browserProfileId??'',tab=favoriteTabOf(favoriteScope(state),appId,profile);if(tab)dispatch({type:'tab.favorite',id:tab.id,favoriteId:null});};
 // Where each split shows (docs/launch/SPLIT_IN_GROUPS.md): its card, inside its home pane's group when it has one. Its panes
 // show only there (28 Oct: no mirrors); a pinned pane is listed in the card, not among the pinned tabs.
 const {paneOf}=splitPlacements(state.windowUi.splitGroups,state.tabs,state.tabGroups);
 const isPinned=(tab:TabSession)=>tab.pinned&&!groupForTab(state,tab)&&!paneOf.has(tab.id);
 const pinnedTabs=tabs.filter(isPinned),restTabs=tabs.filter(tab=>!isPinned(tab));
 const looseTabs=restTabs.filter(tab=>!groupForTab(state,tab)),previousIds=known.current;
  const appended=newTabsTop&&previousIds?appendedTabs(looseTabs,previousIds,closedBefore.current,tabs):[];
 useEffect(()=>{const previous=known.current;known.current=new Set(tabs.map(tab=>tab.id));closedBefore.current=new Set([...state.closedTabs,...(state.closedPrivateTabs??[])].map(tab=>tab.id));if(!previous||!newTabsTop||!appended.length)return;
  let top=restTabs.find(tab=>previous.has(tab.id)&&!appended.includes(tab))?.id;if(!top)return;
  for(const tab of appended){dispatch({type:'tab.drop',from:tab.id,to:top,position:'before',groupId:null});top=tab.id;}
 },[tabs.map(tab=>tab.id).join(),newTabsTop]);// eslint-disable-line react-hooks/exhaustive-deps
 // Ctrl/Cmd held: the figure each row answers to (ui/tabNumbers.ts); null the rest of the time.
 const numbers=useTabNumbers(state);
 const list=useRef<HTMLDivElement>(null),[dragging,setDragging]=useState<string|null>(null),[hint,setHint]=useState<{id:string;position:'before'|'after'}|{group:string}|null>(null);
 const ordered=[...[...appended].reverse(),...restTabs.filter(tab=>!appended.includes(tab))];
 // Free splits are entries of their own; a split in a group is one of that group's rows (sidebarRows.ts).
 const {entries,groupRows,visibleTabs,folderCount,looseCount}=sidebarRows(state,ordered,groups,folders),visible=visibleTabs(pinnedTabs);
 // Tab drags are pointer drags with capture: they keep tracking over the native page, which HTML drag-and-drop
 // cannot see. Inside the sidebar they reorder, pin over Favorites or save over Bookmarks; over the right of the page
 // they split view after the strip's 450ms dwell (src/ui/splitDrop.ts). In the sidebar a split can never arm.
 const latest=useRef({state,dispatch});latest.current={state,dispatch};
 const drag=useRef<{id:string;/** Which row: a linked tab has two (its group row, its card row). */key:string;/** Grabbed in a split's card (a pane row), not by a group row of the same tab. */card:boolean;x:number;y:number;pointer:number;moved:boolean;node:HTMLElement;off:()=>void;chip?:ReturnType<typeof carryChip>;rowPreview?:ReturnType<typeof carrySidebarRow>;release?:()=>void;full?:boolean;split?:SplitGroup;/** A whole tab group carried by its header: it only goes to a workspace. */group?:TabGroup}|null>(null),suppressClick=useRef(false);
 const hintFor=(action:BrowserAction|null)=>action?.type==='tab.drop'||action?.type==='split.separate'?action.to&&action.position?{id:action.to,position:action.position}:action.groupId?{group:action.groupId}:null:null;
 const setHintIf=(next:ReturnType<typeof hintFor>)=>setHint(previous=>JSON.stringify(previous)===JSON.stringify(next)?previous:next);
 // A sidebar that hides mid-drag (a peeking one closes as soon as the pointer is over the page) unmounts this list, but a drag that has
 // moved is not the list's to end: its window listeners run to the release, the carried icon stays under the pointer and the split
 // picker takes the drop (founder, 31 Oct: the icon vanished and the picker was stuck).
 useEffect(()=>()=>{const current=drag.current;if(!current||current.moved)return;current.off();current.release?.();current.chip?.end(true);current.rowPreview?.end();},[]);
 /** What the banner above the workspace row says while `subject` is carried over an icon (ui/workspaceDrop.ts). */
 const dropNote=(subject:WorkspaceDragSubject)=>(id:string)=>workspaceDropNote(latest.current.state,subject,id);
 /** A split row dragged by its header carries all its panes (docs/launch/SPLIT_IN_GROUPS.md): over a group they all join it,
  *  over loose rows they leave their groups. Dropped on its own card or on another split, nothing happens. */
 const splitMoveAt=(point:{x:number;y:number},split:SplitGroup):{drop:BrowserAction;move:BrowserAction}|null=>{
  const {state}=latest.current,anchor=state.tabs.find(tab=>split.tabIds.includes(tab.id));if(!anchor)return null;
  const drop=tabDropAtPoint(list.current,point,anchor.id,state.tabs,state.tabGroups,true);
  // On its own card it stays put (split.move aims a drop on one of its own panes at the row beside the card).
  if(drop?.type!=='tab.drop')return null;
  const target=drop.to?state.tabs.find(tab=>tab.id===drop.to):undefined,tabGroupId=Object.hasOwn(drop,'groupId')?drop.groupId??null:target?groupForTab(state,target)?.id??null:null;
  return {drop,move:{type:'split.move',groupId:split.id,tabGroupId,...(drop.to?{to:drop.to,position:drop.position??'before'}:{})}};
 };
 /** A pane dragged out of its split card (founder, 28 Oct: "drag a tab out of a split even if it is inside a group") leaves the
 *  split and lands at the drop line, taking the group of wherever it lands. Over its own card the drop stays a pane reorder
 *  (split.group.add); a drop aimed at one of its own panes lands beside the card. */
 const paneDrop=(action:BrowserAction|null,tabId:string,card=true):BrowserAction|null=>{
  const {state}=latest.current,split=card?state.windowUi.splitGroups?.find(group=>group.tabIds.includes(tabId)):undefined;
  if(!split||action?.type!=='tab.drop')return action;
  // A linked copy dragged out of the card only leaves the split: its tab stays where it is in its group, whatever the drop line says.
  if(split.linked?.includes(tabId))return {type:'split.separate',tabId};
  const {to,position}=outsideSplit(state,split,action.to,action.position??'before');
  return {type:'split.separate',tabId,...(to?{to,position}:{}),...(Object.hasOwn(action,'groupId')?{groupId:action.groupId??null}:{})};
 };
 /** A drop line beside a split card is beside the whole card. The card stands where the first of its tabs stands in the tab
  *  order (sidebarRows.ts); aimed at the pane that leads in the split's own order, the tab landed between the card's tabs and the
  *  row never moved (founder, 30 Oct). */
 const besideCard=(action:BrowserAction|null):BrowserAction|null=>{
  if(action?.type!=='tab.drop'||!action.to)return action;
  const {state}=latest.current,split=state.windowUi.splitGroups?.find(group=>group.tabIds.includes(action.to!));
  if(!split||split.tabIds.includes(action.from))return action;
  const members=state.tabs.filter(tab=>split.tabIds.includes(tab.id)),anchor=action.position==='after'?members.at(-1):members[0];
  return anchor?{...action,to:anchor.id}:action;
 };
 const startDrag=(event:PointerEvent<HTMLElement>,tab:TabSession,split?:SplitGroup,card=false,rowId=tab.id,group?:TabGroup)=>{
  if(event.button!==0||(event.target as HTMLElement).closest('.sb-tab-close,.sb-tab-action,.sb-header-add'))return;
  // Where the sidebar ends and the page begins: its right edge on the left, its left edge on the right (the sidebar is the region up to the edge, or from it).
  const side=sidebarSideOf(latest.current.state.settings),sidebarEdge=()=>sidebarEdgeOf(document.querySelector('.acira-sidebar')?.getBoundingClientRect(),side);
  // Over a workspace's icon a carried chip forms and sticks at once: an edge far off on the sidebar's own side makes the pointer always "beyond" it (toward the page, which is smaller x on the right).
  const stuck=side==='right'?1e6:-1e6;
  // The active tab's peek pinned just under (or over) the list is the list's visible end, where the edge scroll rests: a drop on it is a drop at
  // that end of the rows the list shows (it read as no drop at all, and the tab went back).
  const listPoint=(point:{x:number;y:number})=>{const scroller=list.current?.closest<HTMLElement>('.sb-scroll'),box=scroller?.getBoundingClientRect(),peek=scroller?.parentElement?.querySelector<HTMLElement>(':scope>.sb-active-peek')?.getBoundingClientRect();
   if(!box||!peek||point.x<peek.left||point.x>peek.right)return point;
   return point.y>box.bottom&&point.y<=peek.bottom?{x:point.x,y:box.bottom-2}:point.y<box.top&&point.y>=peek.top?{x:point.x,y:box.top+2}:point;};
  const finish=(commit:boolean,point?:{x:number;y:number})=>{
   const current=drag.current;if(!current)return;drag.current=null;current.off();current.release?.();
   if(!current.moved){cancelSplitDrag();return;}
   setTabDragActive(false);
   const {state,dispatch}=latest.current,inSidebar=!!point&&!!list.current&&overSidebar(point.x,sidebarEdge(),side);
   // A group dropped on a workspace's icon goes there with all its tabs; anywhere else it stays. The chip hands over to the move, or goes back into the header when the move is refused (a locked workspace) or there is none.
   if(current.group){
    const target=commit&&point?workspaceDropAt(point):null,refused=target?workspaceDropNote(state,{kind:'group',id:current.group.id},target)?.refused:false;
    current.chip?.end(Boolean(target&&!refused));
    if(target)dispatch({type:'workspace.move-group',groupId:current.group.id,workspaceId:target});
    markWorkspaceDrop(null);setDragging(null);setHint(null);window.setTimeout(()=>{suppressClick.current=false;},0);return;
   }
   if(current.split){
    // The workspace row is inside the sidebar: a drop on an icon is a move to that workspace before it is anything on the list.
    const moved=commit&&point?workspaceDropAt(point)?{type:'workspace.move-tabs' as const,tabIds:current.split.tabIds,workspaceId:workspaceDropAt(point)!}:inSidebar?splitMoveAt(listPoint(point),current.split)?.move:null:null;
    current.chip?.end(false);if(moved){skipNextFlip();dispatch(moved);}
    markWorkspaceDrop(null);setDragging(null);setHint(null);window.setTimeout(()=>{suppressClick.current=false;},0);return;
   }
   const split=commit&&endSplitDrag(current.id)&&splitDropAction(current.id,state.activeTabId,state.tabs.map(item=>item.id));   const destination=commit&&point?workspaceDropAt(point):null;
   const owner=state.tabs.find(item=>item.id===current.id),bookmarkZone=commit&&point&&inSidebar&&appsIndexAt(point)===null&&overBookmarks(point)?document.querySelector<HTMLElement>('.acira-sidebar [data-zone=bookmarks]'):null;
   const canSave=owner&&isWeb(owner)&&bookmarkControl(state,owner).available;
   const alreadySaved=owner&&state.bookmarkNodes.some(node=>node.browserProfileId===owner.browserProfileId&&node.url&&pageKey(node.url)===pageKey(owner.url)&&!!node.tor===(owner.privacy==='tor'));
   const bookmarkBefore=current.rowPreview?.bookmarkBefore()??null;
   // A drop on Favorites that makes a favorite: a copy splits off the carried tab and goes up to the tile; the tab itself goes home (the split, ui/sidebarTabDrag.ts).
   const favoritePlan=commit&&point&&inSidebar&&owner&&!bookmarkZone&&!split&&!destination&&appsIndexAt(point)!==null&&(isWeb(owner)||owner.url.startsWith('acira://'))?planFavorite({profileId:owner.browserProfileId,privateMode:!!state.browserProfiles.find(item=>item.id===owner.browserProfileId)?.private,url:owner.url,tab:owner,tabs:favoriteScope(state)}):null;
   const adding=favoritePlan?.kind==='add';
   if(bookmarkZone&&canSave&&!alreadySaved){
    const settled=beginBookmarkArrival(owner.url,owner.browserProfileId);
    openRailSection('bookmarks-open',owner.browserProfileId,false);
    current.rowPreview?.bookmark(()=>document.querySelector<HTMLElement>(`.acira-sidebar .sb-bookmark[data-bookmark-key="${CSS.escape(pageKey(owner.url))}"]`),settled);
   }
   else if(!adding)current.rowPreview?.end(destination?document.querySelector<HTMLElement>(`[data-ws="${CSS.escape(destination)}"]`):null,Boolean(destination||split||commit&&point&&inSidebar&&!bookmarkZone&&appsIndexAt(point)===null&&tabDropAtPoint(list.current,listPoint(point),current.id,state.tabs,state.tabGroups,true,undefined,current.rowPreview?.bounds)),Boolean(split));
   current.chip?.end(Boolean(split));
   if(!commit)cancelSplitDrag();
   if(split)dispatch(split);
   else if(commit&&point&&workspaceDropAt(point))dispatch({type:'workspace.move-tabs',tabIds:[current.id],workspaceId:workspaceDropAt(point)!});/* R3-57: dropped on a workspace's icon */
   else if(commit&&point&&inSidebar){const at=appsIndexAt(point),owner=state.tabs.find(item=>item.id===current.id);
    if(at!==null&&owner){const profile=state.browserProfiles.find(item=>item.id===owner.browserProfileId);pinTab(owner,at,state,!!profile?.private,dispatch,adding?current.rowPreview:null);}
    else if(owner&&overBookmarks(point))saveToBookmarks(owner,state,dispatch,bookmarkBefore);
    else{const action=paneDrop(besideCard(tabDropAtPoint(list.current,listPoint(point),current.id,state.tabs,state.tabGroups,true,undefined,current.rowPreview?.bounds)),current.id,current.card);if(action){skipNextFlip();dispatch(action);}}}
   current.node.closest('.sb-split-group')?.removeAttribute('data-leaving');
   markWorkspaceDrop(null);setDragging(null);setHint(null);setPinHint(null);setBookmarkHint(false);setTabDragActive(false);window.setTimeout(()=>{suppressClick.current=false;},0);
  };
  // Chrome, Arc: a row carried near the top or bottom of the list scrolls it (only inside it: past its ends are the pinned tiles and the saved
  // pages, drops of their own). Each step reads the drop under the resting pointer again.
  let lastMove:globalThis.PointerEvent|null=null;
  // The active tab's peek (scrolled out of view, it sits pinned just past the list's top or bottom) is that end of the list: resting on it scrolls.
  // It goes no further than the last tab: the saved pages below the tabs are a drop of their own (a bookmark), not a place to scroll a tab to.
  // Two rows deep: with the peek pinned there, resting on the last row the list shows still scrolls.
  const scrollEdge=createEdgeScroller({axis:'y',beyond:'none',band:64,scroller:()=>list.current?.closest<HTMLElement>('.sb-scroll')??null,
   span:node=>{const box=node.getBoundingClientRect(),peek=node.parentElement?.querySelector<HTMLElement>(':scope>.sb-active-peek')?.getBoundingClientRect();return {start:peek&&peek.bottom<=box.top+peek.height?Math.min(box.top,peek.top):box.top,end:peek&&peek.top>=box.bottom-peek.height?Math.max(box.bottom,peek.bottom):box.bottom};},
   limit:node=>{const tabs=list.current?.getBoundingClientRect();return {min:0,max:tabs?node.scrollTop+tabs.bottom-node.getBoundingClientRect().bottom:Infinity};},
   onStep:()=>{if(lastMove&&drag.current?.moved)move(lastMove);}});
  const move=(next:globalThis.PointerEvent)=>{
   const current=drag.current;if(!current||next.pointerId!==current.pointer)return;
   if(!current.moved){if(Math.hypot(next.clientX-current.x,next.clientY-current.y)<5)return;current.moved=true;suppressClick.current=true;if(!current.group)setTabDragActive(true);current.release=holdPointer(list.current,current.pointer);setDragging(current.split?'split:'+current.split.id:current.key);}
   const {state}=latest.current,point={x:next.clientX,y:next.clientY},edge=sidebarEdge(),inSidebar=!!list.current&&overSidebar(point.x,edge,side);
   lastMove=next;if(inSidebar)scrollEdge.update(point.y);else scrollEdge.stop();
   // A group goes one place: a workspace's icon. Its folder leaves the header as a chip at once (the edge is far off on the sidebar's own side), with its tab count.
   if(current.group){const group=current.group;current.chip??=carryChip(current.node,'.sb-group-folder',{side,only:item=>!!item.node?.dataset.ws,icon:groupFolderChip(current.node),badge:String(groupMembers(state,group).length),color:getComputedStyle(current.node.querySelector('.sb-group-folder')??current.node).color});current.chip.move(point,stuck);markWorkspaceDrop(point,dropNote({kind:'group',id:group.id}));return;}
   // A split row stays a row: it never splits again over the page, pins or saves; it only moves (or goes to a workspace).
   if(current.split){current.chip??=carryChip(current.node,'.split-group-open>svg',{side});current.chip.move(point,workspaceDropAt(point)?stuck:edge);/* over a workspace's icon the chip forms and sticks to it, as a tab's does */markWorkspaceDrop(point,dropNote({kind:'tabs',ids:current.split.tabIds}));setHintIf(inSidebar?hintFor(splitMoveAt(listPoint(point),current.split)?.drop??null):null);return;}
   // Out of the sidebar the row travels as its icon chip, free in 2D, with one tab or many (R3-23).
   current.rowPreview??=carrySidebarRow(current.node,list.current!,{x:current.x,y:current.y},state.activeWorkspaceId);
   moveSplitDrag(current.id,point,!inSidebar&&state.tabs.length>1);// B's snap layouts take a 3rd and 4th pane, as from the strip
   const at=inSidebar?appsIndexAt(point):null,saving=inSidebar&&at===null&&overBookmarks(point),owner=state.tabs.find(item=>item.id===current.id);
   const newBookmark=saving&&owner&&isWeb(owner)&&bookmarkControl(state,owner).available&&!state.bookmarkNodes.some(node=>node.browserProfileId===owner.browserProfileId&&node.url&&pageKey(node.url)===pageKey(owner.url)&&!!node.tor===(owner.privacy==='tor'));
   // Over Favorites with a page that is not a favorite yet: a copy will go up, so the tab stays as it is and the tiles make room (the split).
   const newFavorite=at!==null&&!!owner&&(isWeb(owner)||owner.url.startsWith('acira://'))&&planFavorite({profileId:owner.browserProfileId,privateMode:!!state.browserProfiles.find(item=>item.id===owner.browserProfileId)?.private,url:owner.url,tab:owner,tabs:favoriteScope(state)}).kind==='add';
   setPinHint(at===null?null:{index:at,adding:newFavorite});setBookmarkHint(Boolean(newBookmark));markWorkspaceDrop(point,dropNote({kind:'tabs',ids:[current.id]}));
   const over=inSidebar&&at===null&&!saving?paneDrop(besideCard(tabDropAtPoint(list.current,listPoint(point),current.id,state.tabs,state.tabGroups,true,undefined,current.rowPreview?.bounds)),current.id,current.card):null;
   current.full=saving||sidebarRowArea(point,current.node.closest<HTMLElement>('.acira-sidebar'),current.full??true,current.rowPreview.bounds);
   // A slot opens among the saved pages only for a page not saved yet (a drop there saves it; a saved one stays as it is).
   current.rowPreview.move(point,current.full,over,newBookmark?document.querySelector<HTMLElement>('.acira-sidebar [data-zone=bookmarks]'):null,newFavorite);
   setHintIf(hintFor(over));
   // A linked copy dragged out of its card can only leave the split (its tab keeps its place in its group), so no drop line is drawn for
   // it: the row says so instead ("Remove from split view" in place of its title) until it is over a drop that really lands somewhere else.
   current.node.closest('.sb-split-group')?.toggleAttribute('data-leaving',over?.type==='split.separate'&&!!state.windowUi.splitGroups?.some(group=>group.linked?.includes(current.id)));
  };
  const up=(next:globalThis.PointerEvent)=>{if(drag.current&&next.pointerId===drag.current.pointer)finish(true,{x:next.clientX,y:next.clientY});};
  const cancel=(next:globalThis.PointerEvent)=>{if(drag.current&&next.pointerId===drag.current.pointer)finish(false);};
  const blur=()=>finish(false);
  const key=(next:globalThis.KeyboardEvent)=>{if(next.key==='Escape'&&drag.current?.moved){next.preventDefault();next.stopPropagation();finish(false);}};
  window.addEventListener('blur',blur);window.addEventListener('pointermove',move);window.addEventListener('pointerup',up);window.addEventListener('pointercancel',cancel);window.addEventListener('keydown',key,true);
  const off=()=>{scrollEdge.stop();window.removeEventListener('blur',blur);window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);window.removeEventListener('pointercancel',cancel);window.removeEventListener('keydown',key,true);};
  drag.current?.off();drag.current={id:tab.id,key:rowId,card,x:event.clientX,y:event.clientY,pointer:event.pointerId,moved:false,node:event.currentTarget,off,...(split?{split}:{}),...(group?{group}:{})};
 };
 // Motion is compositor-only (founder: the sidebar must never lag): rows never animate height. The scroll region's
 // FLIP pass (useFlip) slides rows that moved with transform, fades new rows in and fades a ghost of a closed row out.
 const moveBy=(tab:TabSession,direction:-1|1)=>{const at=visible.findIndex(item=>item.id===tab.id),target=visible[at+direction];if(!target)return;skipNextFlip();dispatch({type:'tab.drop',from:tab.id,to:target.id,position:direction<0?'before':'after',groupId:groupForTab(state,target)?.id??null});};
 // A linked tab (founder, 28 Oct) has two rows: its own in the group (`link`: also in that split) and a copy in the split's card
 // (`copy`: × removes it from the split, a drag out only leaves the split). They share the tab id, so the copy has its own keys.
 const row=(tab:TabSession,options:{pinned?:boolean;hidden?:boolean;pane?:SplitGroup;link?:SplitGroup;copy?:boolean}={})=>{const rowKey=options.copy?'link:'+tab.id:tab.id;return <TabRow key={rowKey} tab={tab} state={state} dispatch={dispatch} pinned={options.pinned} hidden={options.hidden} pane={options.pane} link={options.link} copy={options.copy} number={options.copy||options.hidden?undefined:numbers?.figures.get(tab.id)} numberTyped={options.copy||options.hidden||!numbers||numbers.typed===null?undefined:(numbers.figures.get(tab.id)!==undefined&&tabNumberMatches(numbers.figures.get(tab.id)!,numbers.typed)?'match':'other')} dragging={dragging===rowKey} hint={!options.copy&&hint&&'id' in hint&&hint.id===tab.id?hint.position:undefined} onMove={direction=>moveBy(tab,direction)} onClose={()=>dispatch(options.copy?{type:'split.separate',tabId:tab.id}:{type:'tab.close',id:tab.id})} onPointerDown={event=>startDrag(event,tab,undefined,!!options.pane,rowKey)}/>;};
 // A split row and its panes; inside a group it is one of the group's members (indented, in the group's colour).
 const splitBlock=(split:SplitGroup,members:TabSession[],nestedIn?:TabGroup,hidden=false)=><SidebarSplit key={split.id} state={state} dispatch={dispatch} split={split} members={members} reduced={reduced} row={row} focusFrom={moveFocus} nestedIn={nestedIn} hidden={hidden} dragging={dragging==='split:'+split.id} onPointerDown={event=>{const anchor=state.tabs.find(tab=>split.tabIds.includes(tab.id));if(anchor&&(event.target as HTMLElement).closest('.split-group-parent'))startDrag(event,anchor,split);}} openMenu={(node,pointer)=>{const lead=members.find(tab=>tab.id===split.lastActiveTabId)||members[0];if(lead)popup(state,'split-context',node,lead.id,pointer);}}/>;
 const groupChildren=(group:TabGroup,members:TabSession[])=>groupRows(group,members).map(item=>item.kind==='tab'?row(item.tab,{hidden:item.hidden,link:item.link}):splitBlock(item.split,item.members,group,item.hidden));
 // The open-tab count sits at the row's end (founder, 25 Oct: kept, but not as a header of its own); Ctrl+T takes its
 // place on hover.
 const newTab=<button key="new-tab" className="sb-new-tab" data-flip="new-tab" data-sb-focus onContextMenu={event=>{event.preventDefault();event.stopPropagation();popup(state,'strip-context',event.currentTarget,undefined,event);}} aria-label={t("acirasidebar.newTabCountOpen", { count: tabs.length })} onKeyDown={moveFocus} onClick={()=>dispatch({type:'tab.new'})}><span className="sb-tab-icon"><PreviewIcon icon={Plus} size={14}/></span><span>{t("browsermenu.newTab")}</span><span className="sb-new-end" aria-hidden="true"><kbd>{formatShortcut('Ctrl T')}</kbd></span></button>;
 // Groups in an area of their own (item 14): a line is the area's edge, as it is for the zones (no header, founder 25 Oct).
 const listed:ReactNode[]=entries.map(entry=>entry.kind==='tab'?row(entry.tab):entry.kind==='split'?splitBlock(entry.split,entry.members):<SidebarGroup key={entry.group.id} group={entry.group} members={entry.members} state={state} dispatch={dispatch} showMembers joining={!!hint&&'group' in hint&&hint.group===entry.group.id} dragging={dragging==='group:'+entry.group.id} onPointerDown={event=>{const lead=entry.members.find(tab=>tab.id===entry.group.lastActiveTabId)||entry.members[0];if(lead)startDrag(event,lead,undefined,false,'group:'+entry.group.id,entry.group);}}>{groupChildren(entry.group,entry.members)}</SidebarGroup>);
 if(folders!=='mixed'&&folderCount>0&&looseCount>0)listed.splice(folders==='above'?folderCount:looseCount,0,<div key="sep-folders" className="sb-sep" role="separator" data-flip="sep:folders"/>);
    const body=[...(newTabsTop?[newTab]:[]),<LiveFolder key="live-folder" state={state} dispatch={dispatch} moveFocus={moveFocus}/>,...listed,...(newTabsTop?[]:[newTab])];
 return <>{lead&&<div className="sb-sep" role="separator" data-flip="sep:tabs"/>}<div ref={list} className="sb-tabs" data-dragging={dragging?'':undefined} onClickCapture={event=>{if(suppressClick.current){event.preventDefault();event.stopPropagation();}}}>
  {/* One flat keyed list per zone, so a close never remounts the rows around it. */}
  {showPinned&&pinnedTabs.length>0&&<><div className="sb-pinned" role="list" aria-label={t("acirasidebar.pinnedTabs")}>{pinnedTabs.map(tab=>row(tab,{pinned:true}))}</div>{showList&&<div className="sb-sep" role="separator" data-flip="sep:pinned"/>}</>}
  {/* No header (founder, 25 Oct): the separator above is the zone's edge and New tab is its first row. */}
  {showList&&<section className="sb-zone" data-zone="tabs" aria-label={t("acirasidebar.tabs")} onDragOver={tileOver} onDrop={tileDrop}><div className="sb-zone-body" role="list">{body}</div></section>}
 </div></>;
}

/** FLIP for the scroll region (bible §3.9: premium and fast, drawn on the GPU with transform and opacity only). After
 * each render every [data-flip] row that moved settles from where it was on a critically damped spring (no overshoot);
 * rows that arrive rise 4px and scale up from 98% at their left edge, staggered 16ms (at most 64ms) so a zone unfolds
 * as one layered reveal; a row that leaves is drawn once more where it was and fades out with a slight shrink, on the
 * exit curve at about two-thirds of the enter time. Keyboard moves skip a pass (no motion on keyboard moves).
 * Positions are in content coordinates, so scrolling never animates; a sticky zone header is measured at its section. */
let flipSkip=false;
const skipNextFlip=()=>{flipSkip=true;};
/** 1-(1+wt)e^(-wt), w=9.3, sampled 24 times: a critically damped spring that settles by t=1 with no overshoot. */
// The tab strip's spring (B 28bee146: stiffness 360, damping 38, critically damped), sampled for the compositor; the
// sidebar moves on the same feel and timing as the strip.
const SPRING=stripEase,springMs=()=>stripMs*frequentStretch(classScale(motionSpeed(),'S'));
// The fold's fade starts as fast as the unfold's does (R4-32): the old exit curve (.4,0,1,1) held the rows at full ink for the first
// third and then dropped them at once, which read as "stuck" and then "gone".
const EXIT='cubic-bezier(.16,1,.3,1)';
type FlipBox={el:HTMLElement;top:number;left:number;width:number;height:number;nested:boolean};
function useFlip(root:{current:HTMLDivElement|null},reduced:boolean,space:string){
 const last=useRef<Map<string,FlipBox>>(new Map()),baseline=useRef(0),ghosts=useRef(new Map<string,HTMLElement>()),flying=useRef(0),shownSpace=useRef(space);
 useLayoutEffect(()=>{
  const switched=shownSpace.current!==space;shownSpace.current=space;
  const box=root.current;if(!box){last.current=new Map();return;}
  // Layout positions (the offset chain inside the scroll box), which a running slide does not change. This runs on
  // every render, and pages loading re-render often: measured from painted rects, a row mid-slide read as moved and
  // its slide restarted or nudged (the founder's "sometimes jerky").
  const at=(el:HTMLElement)=>{let top=0,left=0,node:HTMLElement|null=el;while(node&&node!==box){top+=node.offsetTop;left+=node.offsetLeft;node=node.offsetParent as HTMLElement|null;}return node===box?{top,left}:null;};
  const measure=()=>{const next=new Map<string,FlipBox>();
   for(const el of box.querySelectorAll<HTMLElement>('[data-flip]')){
    if(!el.offsetHeight)continue;
    const anchor=el.dataset.flipAnchor==='parent'&&el.parentElement?el.parentElement:el,p=at(anchor),own=at(el);if(!p||!own)continue;
    next.set(el.dataset.flip!,{el,top:p.top,left:own.left,width:el.offsetWidth,height:el.offsetHeight,nested:!!el.closest('[data-nested]')});
   }
   return next;};
  // Nothing to animate yet (the sidebar just appeared, as in a layout switch): take the baseline after the frame paints
  // instead of forcing a layout of every row inside it (M F04: one 67ms frame on a switch at 27 tabs).
  if(!last.current.size){flipSkip=false;if(!baseline.current)baseline.current=requestAnimationFrame(()=>{baseline.current=0;if(root.current===box&&!last.current.size)last.current=measure();});return;}
  const next=measure(),previous=last.current;last.current=next;
  // Another workspace or profile's space came on screen: the list is replaced, not changed, and the switch's own slide carries it
  // (useWorkspaceSlide). Played as a change, the last space's rows faded out as pictures over the new ones while every new row dropped
  // into a slot (founder, 3 Nov: "it glitches, then gets good"). The new list stands at once; nothing of the last one stays behind.
  if(switched){for(const anim of box.getAnimations({subtree:true}))if(anim.id==='sb-flip'||anim.id==='sb-arrive')anim.cancel();box.querySelectorAll(':scope>.sb-flip-ghosts').forEach(node=>node.remove());ghosts.current.clear();flying.current=0;flipSkip=false;return;}
  // Speed Off (or reduced motion): a fold or an unfold is instant, nothing is left to fade.
  if(flipSkip||reduced||!previous.size||!springMs()){flipSkip=false;return;}
  const arrivals:(FlipBox&{key:string})[]=[],moves:{el:HTMLElement;dy:number;from:number;was:number}[]=[];let slide=0;
  for(const [key,item] of next){
   const was=previous.get(key);
   if(!was){arrivals.push({...item,key});continue;}
   const dy=was.top-item.top;if(Math.abs(dy)<=.5||item.el.closest('[data-stuck]'))continue;
   slide=Math.max(slide,dy);
   // A row still sliding from the last change starts its new slide from where it is drawn now: no jump on a quick
   // second move.
   let drawn=0;for(const anim of item.el.getAnimations())if(anim.id==='sb-flip'){drawn=new DOMMatrixReadOnly(getComputedStyle(item.el).transform).m42;anim.cancel();}
   moves.push({el:item.el,dy,from:dy+drawn,was:was.top});
  }
  // Rows leaving (a fold, a closed tab): drawn once more where they were, as pictures (see below).
  const leaving=[...previous].filter(([key])=>!next.has(key)).map(([key,was])=>({key,was})).sort((a,b)=>a.was.top-b.was.top);
  // A fold (a section, a folder or a group closing; anything but one closed tab) is the unfold played back (foldMotion.ts): the
  // rows below wait until the lowest leaving row has faded, then glide up with the section's edge, in step with the fade.
  const fold=leaving.length&&(leaving.length>1||!leaving[0].was.el.matches('.sb-tab'))?foldPlan(leaving.map(({was})=>({top:was.top,height:was.height})),slide,springMs()):null;
  // Tabs opened or closed in a burst (founder: rows piling up over each other): a change while the last slide still runs never
  // slides on top of it. Every row stands in its place at once, new rows included, so rows can't overlap and the next × is where it looks.
  const changed=moves.length>0||arrivals.length>0||leaving.length>0,moment=performance.now(),burst=changed&&!fold&&moment<flying.current;
  if(changed)flying.current=moment+springMs();
  if(!burst)for(const move of moves){
   const below=!!fold&&move.dy>0&&move.was>=fold.top+fold.span-.5;
   move.el.animate([{transform:`translateY(${move.from}px)`},{transform:'none'}],{id:'sb-flip',duration:springMs(),easing:SPRING,...(below?{delay:fold.wait,fill:'backwards' as const}:{})});
  }
  // A picture still leaving is dropped (its row is back): the section toggled again mid-fold, and the row rises from where its picture had faded to.
  const dropGhost=(key:string)=>{const g=ghosts.current.get(key);if(!g)return;ghosts.current.delete(key);const wrap=g.parentElement;g.getAnimations().forEach(animation=>{animation.onfinish=null;animation.oncancel=null;animation.cancel();});g.remove();if(wrap?.classList.contains('sb-flip-ghosts')&&!wrap.querySelector('.sb-flip-ghost'))wrap.remove();};
  if(burst){
   for(const anim of box.getAnimations({subtree:true}))if(anim.id==='sb-flip'||anim.id==='sb-arrive')anim.cancel();
   for(const key of [...ghosts.current.keys()])dropGhost(key);
   return;
  }
  arrivals.sort((a,b)=>a.top-b.top).forEach((item,index)=>{
   const gone=ghosts.current.get(item.key),from=gone?Number.parseFloat(getComputedStyle(gone).opacity)||0:0;if(gone)dropGhost(item.key);
   // A new tab opens a slot (Round 2; founder: new tabs overlapped and arrived late): the rows below slide down and its
   // content comes down into the slot with them, on the same spring and clipped to the row, so nothing ever overlaps.
   if(item.el.matches('.sb-tab')&&item.el.closest('[data-zone=tabs]')){
    const parts=[...item.el.children] as HTMLElement[];let left=parts.length;item.el.style.overflow='clip';
    for(const part of parts){const slide=part.animate([{transform:`translateY(${-item.height}px)`},{transform:'none'}],{id:'sb-arrive',duration:springMs(),easing:SPRING});slide.onfinish=slide.oncancel=()=>{if(--left<=0)item.el.style.overflow='';};}
    return;
   }
   item.el.animate([{opacity:from,transform:'translateY(-4px) scale(.98)'},{opacity:1,transform:'none'}],{id:'sb-arrive',duration:springMs(),delay:Math.min(index,4)*16,easing:SPRING,fill:'backwards'});
  });
  // Leaving rows fade and rise in a reverse stagger (the lowest first) inside a clip that closes from the bottom with the rows
  // below. A fold follows its plan (each row gone before the edge reaches it); one closed tab keeps the quick close (R4-32).
  // Every picture keeps its row's look where it was: its nesting (--sb-nest lives on the section body it has left) and its left
  // edge as the scale origin, so nothing moves sideways. The clip starts 8px above the first row so the 4px rise is never cut.
  // Nothing is drawn over a row that is still going, and every picture and the clip remove themselves when done. A row caught
  // mid-unfold leaves from the opacity it had reached.
  if(leaving.length){
   const top=leaving[0].was.top,span=Math.max(...leaving.map(item=>item.was.top+item.was.height))-top,spring=springMs(),life=fold?fold.fade:Math.round(spring*.62),HEAD=8;
   const wrap=document.createElement('div');wrap.className='sb-flip-ghosts';wrap.setAttribute('aria-hidden','true');wrap.inert=true;
   Object.assign(wrap.style,{position:'absolute',left:'0',right:'0',top:(top-HEAD)+'px',height:(span+HEAD)+'px',overflow:'hidden',pointerEvents:'none',zIndex:'1'});
   box.appendChild(wrap);
   let live=leaving.length;
   leaving.forEach(({key,was},at)=>{
    const nested=was.nested||!!was.el.closest('[data-nested]');
    const ghost=(was.el.isConnected?was.el.cloneNode(true):was.el) as HTMLElement;
    // A ghost is only a picture: nothing may find it as a row, a current item or a focus stop.
    for(const node of [ghost,...ghost.querySelectorAll<HTMLElement>('*')])for(const name of ['data-flip','data-tab-id','data-group-header','data-group-tab','aria-current','data-sb-focus','data-glide'])node.removeAttribute(name);
    ghost.setAttribute('aria-hidden','true');ghost.inert=true;ghost.classList.add('sb-flip-ghost');if(nested)ghost.setAttribute('data-nested','');
    Object.assign(ghost.style,{position:'absolute',top:(was.top-top+HEAD)+'px',left:was.left+'px',width:was.width+'px',height:was.height+'px',margin:'0',display:'flex'});
    wrap.appendChild(ghost);
    const shown=getComputedStyle(ghost),o=Number.parseFloat(shown.opacity),at0=shown.transform;
    ghost.getAnimations().forEach(animation=>animation.cancel());
    ghosts.current.set(key,ghost);
    const fade=ghost.animate([{opacity:Number.isFinite(o)?o:1,transform:at0&&at0!=='none'?at0:'none'},{opacity:0,transform:'translateY(-4px) scale(.98)'}],fold?{duration:life,delay:fold.delays[at],easing:SPRING,fill:'both'}:{duration:life,delay:Math.min(leaving.length-1-at,4)*16,easing:EXIT,fill:'both'});
    const end=()=>{if(ghosts.current.get(key)===ghost)ghosts.current.delete(key);ghost.remove();if(--live<=0)wrap.remove();};
    fade.onfinish=end;fade.oncancel=end;
   });
   wrap.animate([{clipPath:'inset(0 0 0 0)'},{clipPath:`inset(0 0 ${fold?fold.travel:slide>0?Math.min(slide,span):span}px 0)`}],{duration:spring,delay:fold?.wait??0,easing:SPRING,fill:'both'});
   // Backstop: whatever happens to the animations, nothing of the fold outlives it.
   window.setTimeout(()=>{for(const [key,g] of ghosts.current)if(g.parentElement===wrap||!g.isConnected)ghosts.current.delete(key);wrap.remove();},spring+(fold?.wait??0)+life+500);
  }
 });
}

/** Shared-element hand-off (bible §3.9): when the current item changes, its raised card glides from the old item to the
 * new one on the spring (transform only) instead of one card fading out and another fading in. The new item hides its
 * own card until the glide lands. Used for tab rows (scroll region) and Favorites tiles (the grid).
 * A linked tab (founder, 28 Oct) is current in two rows at once, its group row and its copy in the split card: both rows
 * glide together on the same spring, each from its own previous place (a card new to its role starts where the single
 * card was, so one card becomes two), so the pair reads as one selection. */
function useCardGlide(root:{current:HTMLElement|null},selector:string,reduced:boolean){
 type Spot={el:HTMLElement;x:number;y:number;w:number;h:number};
 const last=useRef<Map<string,Spot>>(new Map()),flying=useRef<Map<string,{glide:HTMLElement;motion:Animation}>>(new Map());
 useLayoutEffect(()=>{
  const box=root.current,els=box?[...box.querySelectorAll<HTMLElement>(selector)].slice(0,2):[];
  if(!box||!els.length){last.current=new Map();return;}
  // Layout positions, not painted ones: a row still sliding (useFlip) must not send the card to where it is drawn now.
  const spots=new Map<string,Spot>();
  for(const el of els){
   let x=0,y=0,node:HTMLElement|null=el;while(node&&node!==box){x+=node.offsetLeft;y+=node.offsetTop;node=node.offsetParent as HTMLElement|null;}
   if(node!==box){last.current=new Map();return;}
   spots.set(el.dataset.linkRole||'',{el,x,y,w:el.offsetWidth,h:el.offsetHeight});
  }
  const before=last.current,first=[...before.values()][0];last.current=spots;
  const view=box.getBoundingClientRect(),finish=(node:HTMLElement)=>node.getAnimations().forEach(animation=>{if(animation instanceof CSSTransition)animation.finish();});
  for(const [role,now] of spots){
   let was=before.get(role)??first;
   // A second click before the first glide lands (founder, 28 Oct: "selecting more than one tab randomly"): two raised cards were
   // drawn at once, one still landing on the old row. The new glide starts where the flying card is and the old one goes.
   const prior=was&&was.el!==now.el?flying.current.get(role):undefined;
   if(prior){flying.current.delete(role);if(prior.glide.isConnected){const a=prior.glide.getBoundingClientRect(),b=box.getBoundingClientRect();was={...was!,x:a.left-b.left+box.scrollLeft-box.clientLeft,y:a.top-b.top+box.scrollTop-box.clientTop,w:a.width,h:a.height};}prior.motion.cancel();}
   // When the current tab was closed there is nothing to hand off from: the next tab's own card slides up with its row
   // (founder: the highlight lingered on the row below before sliding up).
   if(reduced||!was||was.el===now.el||!now.h||!was.el.isConnected||was.el.classList.contains('sb-flip-ghost'))continue;// a closed row lives on only as useFlip's fading ghost
   if(was.y-box.scrollTop+was.h<0||was.y-box.scrollTop>view.height)continue;// the old card was out of sight: nothing to hand off
   const el=now.el,glide=document.createElement('div');glide.className='sb-glide';glide.setAttribute('aria-hidden','true');
   Object.assign(glide.style,{left:now.x+'px',top:now.y+'px',width:now.w+'px',height:now.h+'px',borderRadius:getComputedStyle(el).borderRadius});
   // A Favorites tile's card carries its site's ring colour (sidebar.css): it flies in the colour of the tile it leaves and arrives in the colour of the tile it lands on.
   const tile=el.classList.contains('sb-app'),ring=(node:HTMLElement)=>getComputedStyle(node).getPropertyValue('--sb-site').trim();
   if(tile)glide.style.setProperty('--sb-site',ring(el));
   box.prepend(glide);el.setAttribute('data-glide','');finish(el);if(was.el.isConnected)finish(was.el);
   // Tab glow (item 11): the raised card carries the ring and the glow in the site's colour, blending from the old tab's to the new one's on this same
   // animation (one curve, one clock); tab-glow.css draws them from --glow-c, a registered colour, so the browser interpolates it.
   const tones=glideColors(was.el.style.getPropertyValue('--site'),el.style.getPropertyValue('--site'));if(tones)glide.setAttribute('data-glow','');
   const motion=glide.animate([{transform:`translate(${was.x-now.x}px,${was.y-now.y}px) scale(${was.w/now.w},${was.h/now.h})`,...(tile?{'--sb-site':ring(was.el)}:{}),...(tones?{'--glow-c':tones[0]}:{})},{transform:'none',...(tones?{'--glow-c':tones[1]}:{})}],{duration:springMs(),easing:SPRING});
   const land=()=>{el.style.transition='none';el.removeAttribute('data-glide');glide.remove();if(flying.current.get(role)?.glide===glide)flying.current.delete(role);requestAnimationFrame(()=>{el.style.transition='';});};
   motion.onfinish=land;motion.oncancel=land;flying.current.set(role,{glide,motion});
  }
 });
}

/** A tab dragged over the Bookmarks zone saves its page there (one signal: the zone header takes the drop fill). */
let bookmarkHint=false;
let bookmarkDropBox:{left:number;right:number;top:number;bottom:number}|null=null;
function setBookmarkHint(next:boolean){if(bookmarkHint===next)return;bookmarkHint=next;if(!next)bookmarkDropBox=null;pinListeners.forEach(listener=>listener());}
const useBookmarkHint=()=>useSyncExternalStore(listener=>{pinListeners.add(listener);return()=>{pinListeners.delete(listener);};},()=>bookmarkHint);
/** Over the saved pages where they lie out: a drag moving them to make room (sidebarTabDrag.ts) does not move the place to drop. */
function overBookmarks(point:{x:number;y:number}){const zone=document.querySelector<HTMLElement>('.acira-sidebar [data-zone=bookmarks]');if(!zone)return false;const drawn=zone.getBoundingClientRect(),t=getComputedStyle(zone).translate,lift=t==='none'?0:parseFloat(t.split(' ').at(-1)!)||0,box={left:drawn.left,right:drawn.right,top:Math.min(drawn.top,drawn.top-lift),bottom:Math.max(drawn.bottom,drawn.bottom-lift)};// Keep the expanded drop surface while its rows and header glide. A temporary
 // gap between their painted and laid-out positions must not fold Bookmarks shut.
 if(bookmarkHint){for(const row of zone.querySelectorAll<HTMLElement>('.sb-bookmark,.sb-folder,.sb-bookmark-more')){if(row.closest('.sb-flip-ghosts')||!row.offsetHeight)continue;const r=row.getBoundingClientRect();box.top=Math.min(box.top,r.top);box.bottom=Math.max(box.bottom,r.bottom);}const previous=bookmarkDropBox;bookmarkDropBox={left:box.left,right:box.right,top:Math.min(box.top,previous?.top??box.top),bottom:Math.max(box.bottom,previous?.bottom??box.bottom)};}
 const hit=bookmarkHint&&bookmarkDropBox?bookmarkDropBox:box;
 // Only where the zone is seen: scrolled out of the list's view (under the active tab's peek, the Bookmarks jump or the footer, where a tab dragged
 // to the end of the list rests) it is no drop, or a tab let go there was saved as a bookmark nobody saw being made.
 const seen=zone.closest<HTMLElement>('.sb-scroll')?.getBoundingClientRect();
 return point.x>=hit.left&&point.x<=hit.right&&point.y>=hit.top&&point.y<=hit.bottom&&(!seen||point.y>=seen.top&&point.y<=seen.bottom);}
/** Saves the tab's page among the saved pages: before `before` (a bookmark's id, where the drag opened its slot), else after the last. */
function saveToBookmarks(tab:TabSession,state:BrowserSnapshot,dispatch:Dispatch,before:string|null=null){
 if(!isWeb(tab)||!bookmarkControl(state,tab).available){dispatch({type:'toast',text:t("acirasidebar.onlyWebsitesCanBeBookmarked"),tone:'info'});return;}
 const key=pageKey(tab.url),tor=tab.privacy==='tor';
 if(state.bookmarkNodes.some(node=>node.browserProfileId===tab.browserProfileId&&node.url&&pageKey(node.url)===key&&!!node.tor===tor))return;
 const roots=state.bookmarkNodes.filter(node=>node.browserProfileId===tab.browserProfileId&&!node.parentId),at=before?roots.find(node=>node.id===before)?.position:undefined;
 dispatch({type:'bookmark.add',url:tab.url,title:tab.title,parentId:null,index:at??roots.length,...(tor?{tor:true}:{})});
}

/** The loading matrix is a signal: it shows on every row whose page is really loading, current tab or not (tabShowsLoading),
 * and only after 300ms so a quick load never flashes it; sleeping tabs that have not loaded keep their favicon (concept, round 11 #2).
 * The row re-renders only when loading starts and stops; the dots themselves are painted by DotMatrix's one shared loop. */
function useLoadingSignal(on:boolean){
 const [late,setLate]=useState(false);
 useEffect(()=>{if(!on){setLate(false);return;}const timer=window.setTimeout(()=>setLate(true),300);return()=>window.clearTimeout(timer);},[on]);
 return on&&late;
}

function TabRow({tab,state,dispatch,pinned=false,hidden=false,pane,link,copy=false,number,numberTyped,dragging,hint,onMove,onClose,onPointerDown}:{tab:TabSession;state:BrowserSnapshot;dispatch:Dispatch;pinned?:boolean;hidden?:boolean;/** The split whose card lists this row (the one place a pane shows, 28 Oct). */pane?:SplitGroup;/** Linked copies (founder, 28 Oct): `link` marks the tab's row in its group as also drawn in this loose split; `copy` marks the split card's row of such a tab (its × removes it from the split, its group colour and tooltip say where the tab lives). */link?:SplitGroup;copy?:boolean;/** The figure Ctrl/Cmd+number goes to this tab by, drawn at the row's end while the key is held. */number?:number;/** While a first digit waits for its second (Ctrl/Cmd+1, then 5 = tab 15): 'match' for the figures it can still lead to (10…19 for 1), 'other' for the rest. */numberTyped?:'match'|'other';dragging:boolean;hint?:'before'|'after';onMove:(direction:-1|1)=>void;onClose:()=>void;onPointerDown:(event:PointerEvent<HTMLDivElement>)=>void}){
 // D's private tabs and N's Tor tabs (TabSession.privacy; 'tor' is typed when N's tabs land).
 const active=tab.id===state.activeTabId,sound=tabSound(tab),name=title(tab),raw=tab.privacy as string|undefined,privacy:'private'|'tor'|undefined=raw==='private'||raw==='tor'?raw:undefined,privateTab=privacy==='private',torTab=privacy==='tor',markInIcon=!!privacy&&isNewTabState(tab.url);
 const loading=useLoadingSignal(tabShowsLoading(tab));
 // Tab glow (item 11): the site icon's colour, for a row that may wear it (not private, Tor, asleep, outlined for a risk, or a linked copy); the stylesheet (tab-glow.css) decides how much, from Settings › Site colour.
 const siteColor=useSiteIconColor(tab.url,tab.favicon,!privacy&&!tab.sleeping&&!tab.risk&&!copy&&!hidden,!!tab.error);
 // Inline rename (R3 zen-extras): double-click the row, F2, or Rename tab in its menu; the field takes the button's place.
 const rowRef=useRef<HTMLDivElement>(null),[renaming,setRenaming]=useTabRename(rowRef),shown=shownTab(tab),cardMode=useTabHoverCardMode();
 const context=(node:HTMLElement,pointer?:{clientX:number;clientY:number})=>popup(state,'tab-context',node,tab.id,pointer);
 // A pane (founder, 28 Oct): one click shows its split focused on it (Chrome, Arc, Zen); Open alone (the row's expand button,
 // Shift+Enter, the tab menu) shows it by itself while the split stays saved, and the same button, a click on the row or on the
 // card brings the split back. Only the current row reads as current; the card's line says its split is on screen.
 const solo=!!pane&&paneIsAlone(state,tab.id,pane),toggle=()=>{if(pane)toggleSolo(state,dispatch,tab.id,pane);};
 const soloName=solo?t('acirasidebar.showSplitView'):t('acirasidebar.openAlone');
 // A linked tab is two rows of one tab: both read as current together. The group row carries the split glyph ("Also in split view"),
 // the card row the group's colour and link glyph ("In group G") and a fainter title; the card row's × removes it from the split.
 const homeGroup=copy?groupForTab(state,tab):undefined,linkTip=copy?t("acirasidebar.linkedInGroup",{group:homeGroup?.name||'Unnamed group'}):link?t("acirasidebar.linkedInSplit"):undefined;
 return <div className="sb-tab" ref={rowRef} role="listitem" data-flip={hidden?undefined:'t:'+tab.id+(copy?'~split':'')} data-tab-id={tab.id} data-link-role={copy?'split':link?'group':undefined} data-split-link={copy?homeGroup?.id||'':undefined} data-in-split={link?.id} style={copy&&homeGroup?{'--group-color':tabGroupColor(homeGroup.color)} as CSSProperties:siteColor?{'--site':siteColor} as CSSProperties:undefined} data-glow={siteColor?'':undefined} data-split-pane={pane?.id} data-solo={solo||undefined} onPointerEnter={event=>startTitleMarquee(event.currentTarget.querySelector<HTMLElement>('.sb-tab-title'))} onPointerLeave={event=>stopTitleMarquee(event.currentTarget.querySelector<HTMLElement>('.sb-tab-title'))} data-private={privateTab||undefined} data-tor={torTab||undefined} data-pinned={pinned||undefined} data-hidden={hidden||undefined} inert={hidden||undefined} aria-hidden={hidden||undefined} data-sleeping={tab.sleeping||undefined} data-capturing={tab.capturing?.length||undefined} data-risk={tab.risk?.kind} title={tab.risk?`${tab.risk.title}. ${tab.risk.detail}`:undefined} aria-current={active||undefined} data-dragging={dragging||undefined} data-drop={hint} onPointerDown={onPointerDown} onDragStart={event=>event.preventDefault()}
  onMouseDown={event=>{if(event.button===1)event.preventDefault();}} onAuxClick={event=>{if(event.button===1&&!pinned){event.preventDefault();onClose();}}}
  onContextMenu={event=>{event.preventDefault();event.stopPropagation();context(event.currentTarget,event);}}>
  {renaming?<div className="sb-tab-main sb-tab-editing"><span className="sb-tab-icon" data-loading={loading||undefined}>{loading?<DotMatrix preset="loader" size={14} reducedMotion={state.settings.reducedMotion}/>:markInIcon?<TabPrivacyMark privacy={privacy!} size={16} className="sb-tab-icon-mark"/>:<SiteIdentityIcon url={tab.url} favicon={tab.favicon} size={16} error={!!tab.error}/>}</span><TabNameInput tab={shown} dispatch={dispatch} onDone={()=>{setRenaming(null);requestAnimationFrame(()=>rowRef.current?.querySelector<HTMLElement>('.sb-tab-main')?.focus({preventScroll:true}));}}/></div>:
  <button className="sb-tab-main" data-sb-focus onDoubleClick={event=>{event.preventDefault();setRenaming('inline');}} aria-current={active?'page':undefined} aria-label={privacy||sound==='playing'||linkTip?`${name}${privacy?`, ${privacyNames[privacy].label}`:''}${sound==='playing'?`, ${t("tabsound.playing")}`:''}${linkTip?`, ${linkTip}`:''}`:undefined} title={cardAnswers(cardMode,tab)?undefined:`${name}${tab.customTitle?' · '+t("tabrename.renamedTip"):''}${privacy?' · '+privacyNames[privacy].tip:''}${tab.sleeping?' · sleeping':''}${isWeb(tab)?'\n'+address(tab.url):''}`} onClick={()=>{if(pane)selectStripTab(state,dispatch,tab.id,pane);else if(!active)dispatch({type:'tab.select',id:tab.id});}}
   onKeyDown={event=>{
    if(event.key==='ContextMenu'||event.shiftKey&&event.key==='F10'){event.preventDefault();event.stopPropagation();context(event.currentTarget);return;}
    if(event.key==='Delete'&&!pinned){event.preventDefault();onClose();return;}
    if(pane&&event.key==='Enter'&&event.shiftKey&&!event.ctrlKey&&!event.altKey&&!event.metaKey){event.preventDefault();toggle();return;}
    if(event.key==='F2'&&!event.altKey&&!event.ctrlKey&&!event.shiftKey){event.preventDefault();setRenaming('inline');return;}
    if(event.altKey&&event.shiftKey&&(event.key==='ArrowUp'||event.key==='ArrowDown')){event.preventDefault();onMove(event.key==='ArrowUp'?-1:1);const id=tab.id;requestAnimationFrame(()=>document.querySelector<HTMLElement>(`.acira-sidebar [data-tab-id="${id}"] .sb-tab-main`)?.focus());return;}
    moveFocus(event);}}>
   <span className="sb-tab-icon" data-loading={loading||undefined}>{loading?<DotMatrix preset="loader" size={14} reducedMotion={state.settings.reducedMotion}/>:markInIcon?<TabPrivacyMark privacy={privacy!} size={16} className="sb-tab-icon-mark"/>:<SiteIdentityIcon url={tab.url} favicon={tab.favicon} size={16} error={!!tab.error}/>}</span><span className="sb-tab-title" dir="auto"><span className="sb-tab-title-text">{name}</span>{copy&&<span className="sb-tab-leave" aria-hidden="true">{t("acirasidebar.removeFromSplit")}</span>}</span>
   <PeekMarkerCard tabId={tab.id} size={12} reduced={state.settings.reducedMotion}/>{/* the Link preview marker (item 17): a card with the preview's site icon beside this icon while a preview is open from this tab */}
  </button>}
  {tab.capturing?.length ? <button className="sb-tab-action sb-tab-capture" data-persistent aria-label={t("acirasidebar.stopSharingYourAndWith", { and: tab.capturing.join(' and '), name: name })} title={t("app.usingYourAndClickTo", { and: tab.capturing.join(' and ') })} onClick={()=>void runtime.browserCommand({type:'stop-capture',tabId:tab.id})}><span aria-hidden="true"/></button> : null}
  {/* B's shared mark (the strip draws the same): F's mask for a private tab, N's onion for a Tor tab, in the mark colour;
      on the new-tab state it takes the icon's place instead. */}
  {privacy&&!markInIcon&&<TabPrivacyMark privacy={privacy} className="sb-tab-mark"/>}
  {linkTip&&!hidden&&<span className="sb-tab-link" data-role={copy?'group':'split'} title={linkTip} aria-hidden="true"><PreviewIcon icon={copy?Link2:Columns2} size={12}/></span>}
  {/* Open alone / Show split view (founder, 28 Oct): on hover and on the current pane; kept while the pane is shown by itself. */}
  {pane&&!hidden&&<button type="button" className="sb-tab-action sb-tab-solo" data-persistent={solo||undefined} aria-label={`${soloName}: ${name}`} title={`${soloName} (${formatShortcut('Shift Enter')})`} onClick={toggle}><PreviewIcon icon={solo?Columns2:Maximize2} size={12}/></button>}
  {/* R4-30: a muted tab keeps its speaker-off button (one click unmutes); a tab playing sound shows the equaliser in the close slot (the x on hover or focus), or in its own slot when pinned. Mute is in the tab's menu. */}
  {sound==='muted'&&<button className="sb-tab-action" data-persistent aria-label={t("tabsound.unmuteName", { name })} aria-pressed={true} title={t("acirasidebar.unmute")} onClick={()=>dispatch({type:'tab.mute',id:tab.id,muted:false})}><PreviewIcon icon={VolumeX} size={12}/></button>}
  {sound==='playing'&&pinned&&<span className="sb-tab-sound" aria-hidden="true"><TabSoundMeter reducedMotion={state.settings.reducedMotion}/></span>}
  {/* Pinned tabs never close from the list; unpin from their menu (concept). */}
  {!pinned&&<button className="sb-tab-close" data-sound={sound==='playing'?'playing':undefined} aria-label={copy?`${t("acirasidebar.removeFromSplit")}: ${name}`:t("acirasidebar.closeName", { name: name })} title={copy?t("acirasidebar.removeFromSplit"):controlTitle('Close tab')} onClick={onClose}><PreviewIcon icon={X} size={14}/>{sound==='playing'&&<TabSoundMeter reducedMotion={state.settings.reducedMotion}/>}</button>}
  {number!==undefined&&<span className="sb-tab-number" data-typed={numberTyped} aria-hidden="true">{number}</span>}
 </div>;
}

/** A tab group, drawn as a folder (GroupFolderGlyph: sheets for its tabs, closed or open) in the group's color in the icon column, name at the text
 * edge, chevron on hover (always when collapsed), members one step in beside a rail in the group's color. Reuses the strip's inline rename. */
function SidebarGroup({group,members,state,dispatch,showMembers=false,joining=false,dragging=false,onPointerDown,children}:{group:TabGroup;members:TabSession[];state:BrowserSnapshot;dispatch:Dispatch;showMembers?:boolean;joining?:boolean;/** Carried by its header to a workspace. */dragging?:boolean;onPointerDown?:(event:PointerEvent<HTMLButtonElement>)=>void;children?:ReactNode}){
 const root=useRef<HTMLDivElement>(null),editor=useGroupRename(root),activeInside=members.some(tab=>tab.id===state.activeTabId);
 const lead=members.find(tab=>tab.id===group.lastActiveTabId)||members[0];
 const context=(node:HTMLElement,pointer?:{clientX:number;clientY:number})=>popup(state,'group-context',node,lead.id,pointer);
 // Collapsing keeps the current tab where it is, visible under the header (Arc); the strip keeps Chrome's rule.
 const select=()=>{if(showMembers)dispatch({type:'tab.group.update',id:group.id,keepActive:true,patch:{collapsed:!group.collapsed}});else dispatch({type:'tab.select',id:lead.id});};
 // The hover "+" (R3-49): a new tab right after the group's last tab, joined to the group; a collapsed group opens so it shows.
 const addTab=()=>newTabInGroupActions(group,members.at(-1)?.id,lead.browserProfileId,'tab-'+crypto.randomUUID()).forEach(dispatch);
 return <div ref={root} className="ed-rail-tab-group sb-group" role={showMembers?'listitem':undefined} data-sidebar-group={showMembers?undefined:group.id} data-collapsed={group.collapsed||undefined} data-all-asleep={members.length>0&&members.every(member=>member.sleeping)||undefined} data-holds-active={activeInside||undefined} style={{'--group-color':tabGroupColor(group.color)} as CSSProperties} data-joining={joining||undefined} data-dragging={dragging||undefined} onContextMenu={event=>{event.preventDefault();event.stopPropagation();context(event.currentTarget,event);}}>
  {editor.editing?<GroupNameInput group={group} groups={state.tabGroups} onSave={name=>dispatch({type:'tab.group.update',id:group.id,patch:{name}})} onCancel={()=>{editor.stop();requestAnimationFrame(()=>root.current?.querySelector<HTMLElement>('.sb-group-header')?.focus());}}/>
   :<button type="button" className="ed-rail-tab-group-name sb-group-header" data-flip={"g:"+group.id} data-sb-focus data-group-header={showMembers?group.id:undefined} data-group-tab={showMembers?lead.id:undefined} aria-label={t("acirasidebar.groupCountTabs", { group: group.name||'Unnamed group', count: members.length })} aria-expanded={showMembers?!group.collapsed:undefined} title={t("acirasidebar.groupDoubleClickToRename", { group: group.name||'Unnamed group' })} onClick={select} onDoubleClick={editor.start} onPointerDown={showMembers?onPointerDown:undefined}
    onKeyDown={event=>{if(event.key==='F2'){event.preventDefault();editor.start();return;}if(event.key==='ContextMenu'||event.shiftKey&&event.key==='F10'){event.preventDefault();context(event.currentTarget);return;}if(event.altKey&&event.shiftKey&&(event.key==='ArrowUp'||event.key==='ArrowDown')){const drop=groupKeyboardDrop(state.tabs,state.tabGroups,group.id,event.key);if(drop){event.preventDefault();dispatch(drop);}return;}moveFocus(event);}}>
    <span className="sb-tab-icon sb-group-folder" aria-hidden="true"><GroupFolderGlyph count={members.length}/></span><span className="sb-group-name">{group.name||'Unnamed group'}</span>{showMembers&&<PreviewIcon icon={ChevronDown} size={12}/>}</button>}
  {showMembers&&!editor.editing&&<button type="button" className="sb-header-add" aria-label={t("acirasidebar.newTabInGroup")} title={t("acirasidebar.newTabInGroup")} onClick={addTab}><PreviewIcon icon={Plus} size={14}/></button>}
  {showMembers&&<div className="ed-rail-group-members sb-group-members" role="list">{children}</div>}
 </div>;
}

/** Downloads, History and the Reading list (Round 2, off until turned on in Customize sidebar): a 32px header row like
 * Bookmarks, open by default, and a short list; the header's list button opens the full page. */
type SectionProps={state:BrowserSnapshot;dispatch:Dispatch;profileId:string;privateMode:boolean;folded:Record<string,boolean>;reduced:boolean;lead:boolean};
const listButton=(label:string,shortcut:string,onClick:()=>void)=><button type="button" className="sb-zone-action sb-zone-icon" aria-label={label} title={`${label} · ${formatShortcut(shortcut)}`} onClick={onClick}><svg className="sb-list-glyph" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 3h8M2 6h8M2 9h5"/></svg></button>;
const quietRow=(key:string,text:string)=><div key={key} className="sb-section-empty" data-flip={'empty:'+key}><span className="sb-tab-icon"/><span>{text}</span></div>;
function SidebarDownloads({state,profileId,privateMode,folded,reduced,lead,navigate}:SectionProps&{navigate:(page:string)=>void}){
 const items=state.downloads.filter(item=>!item.browserProfileId||item.browserProfileId===profileId).sort((a,b)=>(b.startedAt||0)-(a.startedAt||0)).slice(0,5);
 const open=(item:BrowserDownload)=>{if(item.status==='Ready'&&item.canOpen)void runtime.service({type:'downloads.command',id:item.id,command:'open'}).catch(()=>navigate('downloads'));else navigate('downloads');};
 return <>{lead&&<div className="sb-sep" role="separator" data-flip="sep:downloads"/>}<Zone id="downloads" title={t("browsermenu.downloads")} folded={!!folded['downloads-closed']} toggleKey="downloads-closed" mark={<PreviewIcon icon={Download} size={14}/>} reduced={reduced} profileId={profileId} privateMode={privateMode} action={<span className="sb-zone-actions">{listButton('All downloads','Ctrl J',()=>navigate('downloads'))}</span>}>
  {items.length?items.map(item=><button key={item.id} type="button" className="sb-bookmark sb-download" data-flip={'d:'+item.id} data-sb-focus title={item.name} onKeyDown={moveFocus} onClick={()=>open(item)} onContextMenu={event=>{event.preventDefault();event.stopPropagation();if(item.url&&/^https?:/i.test(item.url))openBookmarkMenu(item.url,{x:event.clientX,y:event.clientY,width:2,height:2});}}>
   <span className="sb-tab-icon"><PreviewIcon icon={FileText} size={16}/></span><span className="sb-tab-title" dir="auto">{item.name}</span><small className="sb-row-note">{sidebarNote(item)}</small></button>)
   :[quietRow('downloads','No downloads yet')]}
 </Zone></>;
}
function SidebarHistory({state,dispatch,profileId,privateMode,folded,reduced,lead,navigate}:SectionProps&{navigate:(page:string)=>void}){
 const siteIcon=useSiteIcons(state),seen=new Set<string>(),items:HistoryVisit[]=[];
 for(const visit of [...state.browsingHistory].sort((a,b)=>Date.parse(b.time)-Date.parse(a.time))){
  if(items.length>=6)break;if((visit.browserProfileId||profileId)!==profileId||!/^https?:/i.test(visit.url))continue;
  const key=pageKey(visit.url);if(seen.has(key))continue;seen.add(key);items.push(visit);
 }
 const openTabs=new Map(state.tabs.filter(tab=>tab.browserProfileId===profileId&&isWeb(tab)).map(tab=>[pageKey(tab.url),tab]));
 const open=(event:MouseEvent<HTMLButtonElement>,url:string)=>{const tab=openTabs.get(pageKey(url));if(tab&&event.button===0&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey){dispatch({type:'tab.select',id:tab.id});return;}openPage(event,url,dispatch,next=>dispatch({type:'tab.navigate',url:next}));};
 return <>{lead&&<div className="sb-sep" role="separator" data-flip="sep:history"/>}<Zone id="history" title={t("browsermenu.history")} folded={!!folded['history-closed']} toggleKey="history-closed" mark={<PreviewIcon icon={HistoryGlyph} size={14}/>} reduced={reduced} profileId={profileId} privateMode={privateMode} action={<span className="sb-zone-actions">{listButton('All history','Ctrl H',()=>navigate('history'))}</span>}>
  {items.length?items.map(visit=><button key={visit.id} type="button" className="sb-bookmark" data-flip={'h:'+visit.id} data-sb-focus title={`${visit.title||address(visit.url)}\n${address(visit.url)}`} onKeyDown={moveFocus} onClick={event=>open(event,visit.url)} onAuxClick={event=>open(event,visit.url)} onMouseDown={event=>{if(event.button===1)event.preventDefault();}} onContextMenu={event=>{event.preventDefault();event.stopPropagation();openBookmarkMenu(visit.url,{x:event.clientX,y:event.clientY,width:2,height:2});}}>
   <span className="sb-tab-icon"><SiteIdentityIcon url={visit.url} favicon={openTabs.get(pageKey(visit.url))?.favicon||siteIcon(visit.url)} size={16}/></span><span className="sb-tab-title" dir="auto">{visit.title||address(visit.url)}</span></button>)
   :[quietRow('history',privateMode?'Nothing is kept in a private window':'No history yet')]}
 </Zone></>;
}
function SidebarReading({state,dispatch,current,profileId,privateMode,folded,reduced,lead}:SectionProps&{current:TabSession}){
 const items=useReadingList(profileId,privateMode),siteIcon=useSiteIcons(state);
 const openTabs=new Map(state.tabs.filter(tab=>tab.browserProfileId===profileId&&isWeb(tab)).map(tab=>[pageKey(tab.url),tab]));
 const add=()=>{if(!isWeb(current)){dispatch({type:'toast',text:t("acirasidebar.onlyWebsitesCanGoIn"),tone:'info'});return;}
  dispatch({type:'toast',text:addToReadingList(profileId,privateMode,{url:current.url,title:current.title})?t("acirasidebar.addedToReadingList",{title:current.title||address(current.url)}):t("acirasidebar.alreadyInYourReadingList")});};
 const done=(url:string)=>{const gone=removeFromReadingList(profileId,privateMode,url);if(gone)dispatch({type:'toast',text:t("acirasidebar.markedAsRead",{title:gone.title})});return gone;};
 const open=(event:MouseEvent<HTMLButtonElement>,url:string)=>{const tab=openTabs.get(pageKey(url));if(tab&&event.button===0&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey){dispatch({type:'tab.select',id:tab.id});return;}openPage(event,url,dispatch,next=>dispatch({type:'tab.navigate',url:next}));};
 return <>{lead&&<div className="sb-sep" role="separator" data-flip="sep:reading"/>}<Zone id="reading" title={t("acirasidebar.readingList")} folded={!!folded['reading-closed']} toggleKey="reading-closed" mark={<PreviewIcon icon={BookOpen} size={14}/>} reduced={reduced} profileId={profileId} privateMode={privateMode}
  action={<span className="sb-zone-actions"><button type="button" className="sb-zone-action sb-zone-icon" aria-label={t("acirasidebar.addThisPageToThe")} title={t("acirasidebar.addThisPageToThe")} onClick={add}><PreviewIcon icon={Plus} size={14}/></button></span>}>
  {items.length?items.slice(0,8).map(item=><div key={item.url} className="sb-tab sb-reading" data-flip={'r:'+item.url} role="listitem">
   <button type="button" className="sb-tab-main" data-sb-focus title={`${item.title}\n${address(item.url)}`} onKeyDown={moveFocus} onClick={event=>open(event,item.url)} onAuxClick={event=>open(event,item.url)} onMouseDown={event=>{if(event.button===1)event.preventDefault();}} onContextMenu={event=>{event.preventDefault();event.stopPropagation();openBookmarkMenu(item.url,{x:event.clientX,y:event.clientY,width:2,height:2});}}>
    <span className="sb-tab-icon"><SiteIdentityIcon url={item.url} favicon={openTabs.get(pageKey(item.url))?.favicon||siteIcon(item.url)} size={16}/></span><span className="sb-tab-title" dir="auto">{item.title}</span></button>
   <button type="button" className="sb-tab-action sb-reading-done" aria-label={t("acirasidebar.markTitleAsRead", { title: item.title })} title={t("acirasidebar.markAsRead")} onClick={()=>done(item.url)}><PreviewIcon icon={Check} size={12}/></button>
  </div>):[quietRow('reading','Add pages with + to read later')]}
 </Zone></>;
}

/** A zone: one 32px header row (a mark or, on hover, the chevron in the icon column, the label on the text edge, no
 * count) over a body that folds away; the choice is remembered on this device. Bookmarks is the only one. */
function Zone({id,title,action,folded,reduced,profileId,privateMode,role,hint=false,mark,toggleKey,onContextMenu,children}:{id:string;title:string;action?:ReactNode;folded:boolean;reduced:boolean;profileId:string;privateMode?:boolean;role?:string;hint?:boolean;mark?:ReactNode;toggleKey?:string;onContextMenu?:(event:MouseEvent<HTMLElement>)=>void;children:ReactNode}){
 const chevron=<span className={`sb-zone-chev${mark?' sb-zone-chev-end':' sb-tab-icon'}`} aria-hidden="true"><PreviewIcon icon={ChevronDown} size={10}/></span>;
 return <section className="sb-zone" data-zone={id} aria-label={title} data-folded={folded||undefined} data-dropping={hint||undefined} onContextMenu={onContextMenu??(event=>{event.preventDefault();event.stopPropagation();openBookmarkMenu(zoneRef(id),{x:event.clientX,y:event.clientY,width:2,height:2});})}>
  <div className="sb-zone-head" data-flip={"z:"+id} data-flip-anchor="parent"><button type="button" className="sb-zone-toggle" data-sb-focus aria-expanded={!folded} onKeyDown={moveFocus} onClick={()=>toggleRailSection(toggleKey||id,profileId,privateMode)}>{mark?<span className="sb-tab-icon sb-zone-mark" aria-hidden="true">{mark}</span>:chevron}<span className="sb-zone-label">{title}</span>{mark?chevron:null}</button>{action}</div>
  {/* Folding is not a height animation: the rows fade and the zones below slide (useFlip), compositor only. */}
  {!folded&&<div className="sb-zone-body" role={role} data-nested>{children}</div>}
 </section>;
}

/** Bookmarks, structured (founder, 25 Oct): the zone is the root; under it the Bookmarks bar (the special folder), then
 * your folders, then loose bookmarks. Folders start closed and remember being opened; children step in 12px. The root
 * shows up to five loose bookmarks and an open folder up to eight items; the rest is one click away on the Bookmarks
 * page. Right-click (or Shift+F10) on any row, or on the zone, opens the shared bookmark menu; the zone's + makes a
 * folder. A bookmark open in a tab reads at full ink and a click goes to that tab (open-or-focus). */
function SidebarBookmarks({state,dispatch,profileId,privateMode,folded,reduced,lead}:{state:BrowserSnapshot;dispatch:Dispatch;profileId:string;privateMode:boolean;folded:Record<string,boolean>;reduced:boolean;lead:boolean}){
 const dropping=useBookmarkHint(),siteIcon=useSiteIcons(state),arrival=useBookmarkArrival(profileId);
 const [revealed,setRevealed]=useState<string|null>(null);useEffect(()=>{if(arrival)setRevealed(arrival.url);},[arrival]);
 // Drag to reorder (R3-52): HTML drag and drop like the Bookmarks bar and the Bookmarks page. Over a row's top or bottom edge
 // the line shows where the bookmark lands; over the middle of a folder it goes inside (a closed one opens after a moment).
 const [drag,setDrag]=useState<string|null>(null),[drop,setDrop]=useState<{id:string;where:DropWhere}|null>(null),dwell=useRef(0);
 useEffect(()=>()=>window.clearTimeout(dwell.current),[]);
 const nodes=state.bookmarkNodes.filter(node=>node.browserProfileId===profileId);
 if(privateMode&&!nodes.length)return null;
 const rank=(node:BookmarkNode)=>isBarFolder(node)?0:node.url?2:1;
 const kids=(parent:string|null)=>nodes.filter(node=>(node.parentId||null)===parent).sort((a,b)=>parent===null?rank(a)-rank(b)||a.position-b.position:a.position-b.position);
 const count=nodes.filter(node=>node.url).length,openTabs=new Map(state.tabs.filter(tab=>tab.browserProfileId===profileId&&isWeb(tab)&&!tab.privacy).map(tab=>[pageKey(tab.url),tab])),torTabs=new Map(state.tabs.filter(tab=>tab.browserProfileId===profileId&&isWeb(tab)&&tab.privacy==='tor').map(tab=>[pageKey(tab.url),tab]));
 const isOpen=(node:BookmarkNode)=>!!folded['bmo:'+node.id];
 const toggle=(node:BookmarkNode)=>toggleRailSection('bmo:'+node.id,profileId,privateMode);
 const library=()=>openWorkspacePage('bookmarks',state,dispatch);
 const open=(event:MouseEvent<HTMLButtonElement>,url:string,tor=false)=>{
  const tab=(tor?torTabs:openTabs).get(pageKey(url)),plain=event.button===0&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey;
  if(tab&&plain){dispatch({type:'tab.select',id:tab.id});return;}
  // A Tor bookmark always opens in a Tor tab, never in the ordinary tab on screen.
  if(tor){if(event.button===0||event.button===1)dispatch({type:'tab.new',url,privacy:'tor',background:!plain});return;}
  openPage(event,url,dispatch,next=>dispatch({type:'tab.navigate',url:next}));
 };
 const endDrag=()=>{window.clearTimeout(dwell.current);dwell.current=0;setDrag(null);setDrop(null);};
 const whereOver=(event:DragEvent<HTMLElement>,node:BookmarkNode):DropWhere=>{const box=event.currentTarget.getBoundingClientRect(),ratio=(event.clientY-box.top)/Math.max(1,box.height);return !node.url&&ratio>.3&&ratio<.7?'into':ratio<.5?'before':'after';};
 const dnd=(node:BookmarkNode)=>{
  if(privateMode)return {};
  return {
   draggable:!isBarFolder(node),'data-dragging':drag===node.id||undefined,'data-drop':drop?.id===node.id?drop.where:undefined,
   onDragStart:(event:DragEvent<HTMLElement>)=>{setDrag(node.id);event.dataTransfer.effectAllowed='copyMove';event.dataTransfer.setData('application/x-acira-bookmark',node.id);if(node.url){event.dataTransfer.setData(LINK_TYPE,node.url);event.dataTransfer.setData('text/plain',node.url);}},
   onDragEnd:endDrag,
   onDragOver:(event:DragEvent<HTMLElement>)=>{
    if(!drag)return;const where=whereOver(event,node);
    if(!bookmarkPlace(state.bookmarkNodes,profileId,drag,node.id,where)){setDrop(null);return;}
    event.preventDefault();event.dataTransfer.dropEffect='move';setDrop(previous=>previous?.id===node.id&&previous.where===where?previous:{id:node.id,where});
    if(where==='into'&&!isOpen(node)){if(!dwell.current)dwell.current=window.setTimeout(()=>{dwell.current=0;toggle(node);},650);}else{window.clearTimeout(dwell.current);dwell.current=0;}
   },
   // Leaving means the pointer is outside the row's box (a move between the row's own icon and title also fires dragleave).
   onDragLeave:(event:DragEvent<HTMLElement>)=>{const box=event.currentTarget.getBoundingClientRect();if(event.clientX>box.left&&event.clientX<box.right&&event.clientY>box.top&&event.clientY<box.bottom)return;window.clearTimeout(dwell.current);dwell.current=0;setDrop(previous=>previous?.id===node.id?null:previous);},
   onDrop:(event:DragEvent<HTMLElement>)=>{
    if(!drag)return;event.preventDefault();const place=bookmarkPlace(state.bookmarkNodes,profileId,drag,node.id,whereOver(event,node));
    if(place)dispatch({type:'bookmark.move',id:drag,...place});endDrag();
   },
  };
 };
 const menuAt=(event:MouseEvent<HTMLElement>,ref:string)=>{event.preventDefault();event.stopPropagation();openBookmarkMenu(ref,{x:event.clientX,y:event.clientY,width:2,height:2});};
 const keys=(ref:string,extra?:(event:KeyboardEvent<HTMLButtonElement>)=>boolean)=>(event:KeyboardEvent<HTMLButtonElement>)=>{
  if(event.key==='ContextMenu'||event.shiftKey&&event.key==='F10'){event.preventDefault();const box=event.currentTarget.getBoundingClientRect();openBookmarkMenu(ref,sidebarSideOf(state.settings)==='right'?rowAnchor(box,'right'):{x:box.left+36,y:box.bottom-4,width:2,height:2});return;}
  // Alt+Shift+Up/Down moves the row one place, as it does a tab (the menu's Move up / Move down).
  if(event.altKey&&event.shiftKey&&(event.key==='ArrowUp'||event.key==='ArrowDown')&&!privateMode){event.preventDefault();const id=ref.slice(5),place=bookmarkStep(state.bookmarkNodes,profileId,id,event.key==='ArrowUp'?-1:1);if(place){skipNextFlip();dispatch({type:'bookmark.move',id,...place});}return;}
  if(extra?.(event))return;moveFocus(event);
 };
 const more=(key:string,level:number,label:string)=><button key={key} type="button" className="sb-bookmark sb-bookmark-more" data-flip={'more:'+key} data-sb-focus style={{'--sb-level':level} as CSSProperties} onKeyDown={moveFocus} onClick={library}><span className="sb-tab-icon"><PreviewIcon icon={ArrowUpRight} size={14}/></span><span className="sb-tab-title" dir="auto">{label}</span></button>;
 const page=(node:BookmarkNode,level:number)=>{const url=node.url!,tab=(node.tor?torTabs:openTabs).get(pageKey(url)),ref=bookmarkRef(node.id);
  return <button key={node.id} type="button" className="sb-bookmark" data-bookmark-key={pageKey(url)} data-bookmark-arriving={arrival?.url===pageKey(url)||undefined} {...dnd(node)} data-flip={'b:'+node.id} data-sb-focus data-open={tab?'':undefined} data-tor={node.tor||undefined} style={{'--sb-level':level} as CSSProperties} data-card-title={`${node.title||address(url)}${node.tor?' · '+privacyNames.tor.label:''}`} data-card-host={address(url)} aria-label={node.title||address(url)} onKeyDown={keys(ref)} onClick={event=>open(event,url,!!node.tor)} onAuxClick={event=>open(event,url,!!node.tor)} onMouseDown={event=>{if(event.button===1)event.preventDefault();}} onContextMenu={event=>menuAt(event,ref)}>
   <span className="sb-tab-icon"><SiteIdentityIcon url={url} favicon={tab?.favicon||siteIcon(url)||savedPageIdentity(url,state).favicon} size={16}/></span><span className="sb-tab-title" dir="auto">{node.title||savedTitle(url,state)}</span>{node.tor&&<TabPrivacyMark privacy="tor" className="sb-tab-mark"/>}</button>;};
 const folder=(node:BookmarkNode,level:number):ReactNode[]=>{
  const expanded=isOpen(node),bar=isBarFolder(node),ref=bookmarkRef(node.id);
  const head=<button key={node.id} type="button" className="sb-folder" {...dnd(node)} data-flip={'f:'+node.id} data-sb-focus data-bar={bar||undefined} aria-expanded={expanded} style={{'--sb-level':level} as CSSProperties} title={bar?t("acirasidebar.bookmarksBarThePagesOn"):undefined}
   onKeyDown={keys(ref,event=>{if(event.key==='ArrowRight'&&!expanded||event.key==='ArrowLeft'&&expanded){event.preventDefault();toggle(node);return true;}return false;})} onClick={()=>toggle(node)} onContextMenu={event=>menuAt(event,ref)}>
   <span className="sb-tab-icon"><PreviewIcon icon={bar?PanelTop:expanded?FolderOpen:Folder} size={16}/></span><span className="sb-tab-title" dir="auto">{folderTitle(node)||'Untitled folder'}</span><PreviewIcon icon={ChevronDown} size={12}/></button>;
  if(!expanded)return [head];
  if(level>=2)return [head,more(node.id,level+1,'Show in Bookmarks')];
  const inside=kids(node.id),shown=inside.slice(0,8);
  return [head,...shown.flatMap((child):ReactNode[]=>child.url?[page(child,level+1)]:folder(child,level+1)),...(inside.length>shown.length?[more(node.id,level+1,`${inside.length-shown.length} more in Bookmarks`)]:[])];
 };
 const root=kids(null),folders=root.filter(node=>!node.url),loose=root.filter(node=>node.url),shownLoose=loose.slice(0,dropping?loose.length:Math.max(5,loose.findIndex(node=>node.url&&pageKey(node.url)===(arrival?.url||revealed))+1));
 const landing=(dropping||arrival)&&!nodes.some(node=>node.url&&pageKey(node.url)===arrival?.url)?<div key="landing" className="sb-bookmark-landing" aria-hidden="true"/>:null;
 const body:ReactNode[]=nodes.length?[...folders.flatMap(node=>folder(node,0)),...shownLoose.map(node=>page(node,0)),...(loose.length>shownLoose.length||folders.length&&count>shownLoose.length?[more('all',0,`Show all ${count} bookmarks`)]:[])]
  :dropping||arrival?[landing]:[<div key="empty" className="sb-bookmarks-empty" data-flip="empty:bookmarks"><span className="sb-tab-icon"><PreviewIcon icon={Star} size={14}/></span><span>{t("acirasidebar.starAPageOrDrag")}</span></div>];
 const anchorOf=(event:MouseEvent<HTMLButtonElement>)=>{const box=event.currentTarget.getBoundingClientRect();return {x:box.left,y:box.top,width:box.width,height:box.height};};
 // Folded by default (founder, 25 Oct): one "Bookmarks" row under the tabs, so saved pages never read as more tabs.
 return <>{lead&&<div className="sb-sep" role="separator" data-flip="sep:bookmarks"/>}<Zone id="bookmarks" title={t("browsermenu.bookmarks")} folded={!folded['bookmarks-open']&&!dropping&&!arrival} toggleKey="bookmarks-open" mark={<PreviewIcon icon={Bookmark} size={14}/>} hint={dropping} reduced={reduced} profileId={profileId} privateMode={privateMode}
  onContextMenu={event=>menuAt(event,'node:root')}
  action={<span className="sb-zone-actions">
   {!privateMode&&<button type="button" className="sb-zone-action sb-zone-icon" aria-label={t("acirasidebar.newBookmarksFolder")} title={t("acirasidebar.newFolder")} onClick={event=>openBookmarkMenu('node:new:root',anchorOf(event))}><PreviewIcon icon={Plus} size={14}/></button>}
   <button type="button" className="sb-zone-action sb-zone-icon" aria-label={t("app.allBookmarks")} title={t("acirasidebar.allBookmarksO", { shortcut: formatShortcut('Ctrl Shift O') })} onClick={library}><svg className="sb-list-glyph" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 3h8M2 6h8M2 9h5"/></svg></button>
  </span>}>{body}</Zone></>;
}
