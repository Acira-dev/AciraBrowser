import { railGlowRef0, railGlowRef1, railGlowRef2 } from '../../ui/siteGlowEngine';
import { useEdgeLight } from './useEdgeLight';
import { AmbientSideLayer } from './AmbientSideLayer';
import { AnimatePresence,motion } from 'motion/react';
import { Fragment,createContext,useCallback,useContext,useEffect,useInsertionEffect,useLayoutEffect,useRef,useState,useSyncExternalStore,type CSSProperties,type DragEvent,type KeyboardEvent,type MouseEvent,type PointerEvent,type ReactNode } from 'react';
import { ArrowUp,ArrowUpRight,BookOpen,Bookmark,Check,ChevronDown,Clock3,Columns2,Download,FileText,History as HistoryGlyph,PanelTop,Folder,FolderOpen,Link2,Maximize2,PanelsTopLeft,Pin,Plus,Search,Settings2,Star,VolumeX,X,type LucideIcon } from '../AppIcons';
import { BrandLogo } from '../BrandLogo';
import { useAddressSidebar } from '../../ui/addressSidebarStore';
import { DotMatrix } from '../DotMatrix';
import { PeekMarkerCard } from '../PeekMarkerCard';
import { TabSoundMeter } from '../TabSound';
import { tabSound } from '../../ui/tabSound';
import { tabShowsLoading } from '../../ui/tabLoading';
import { EditorGlyph,type EditorIconName } from '../EditorGlyph';
import { LineIcon } from '../LineIcon';
import { PreviewIcon } from '../PreviewIcon';
import { SiteIdentityIcon } from '../SiteIdentityIcon';
import { useSiteIconColor } from '../../ui/siteIconColor';
import { useSidebarClickAway } from '../../ui/sidebarClickAway';
import { currentSiteColor, rowGlowColour, useOwnPageAccent } from '../../ui/ownPageGlow';
import { glideColors, parseGlow } from '../../ui/glowBlend';
import { GroupNameInput,useGroupRename } from '../TabGroupTray';
import { SidebarSplit } from './SidebarSplit';
import { LiveFolder } from './LiveFolder';
import { SidebarMedia } from './SidebarMedia';
import { SidePanelIcons } from './SidePanelIcons';
import { nameAndNote,newTabInGroupActions } from './sidebarActions';
import { frontOf,newTabsAtTop,planMoves,type NewTabHold } from './newTabHold';
import { GroupFolderGlyph } from './GroupFolderGlyph';
import { useGroupAutoColors } from './groupAutoColors';
import { useFolderRail } from './folderRail';
import { useNestConnector } from './nestRail';
import { carryGroupRow,type GroupCarry } from './groupCarry';
import { setGroupCarryOverPage } from '../../ui/groupCarryOverPage';
import { primeSplitStills,requestSplitStills } from '../../ui/splitDrop';
import { FOLDER_SILHOUETTE } from './folderGlyph';
import { isAutoGroup } from '../../runtime/tabGroups';
import type { SidebarFolders } from '../../ui/railPrefs';
import type { SplitGroup } from '../../runtime/splitLayout';
import { dropPlace,folderEndFlip,groupKeyboardDrop,groupKeyboardNest,stayDrop,tabDropAtPoint,type DropPlace } from '../tabGroupDrag';
import { sidebarPatch,workspaceIsOpen } from '../../runtime/browserChrome';
import { effectiveView,hideToolbarOn } from '../../runtime/windowView';
import { BellIcon } from '../../features/siteNotifications/NotificationsPanel';
import { useSiteNotifications } from '../../features/siteNotifications/useSiteNotifications';
import { runtime } from '../../runtime/client';
import { siteIdentity } from '../../runtime/sites';
import { isAddressLike } from '../../runtime/siteMark';
import { familyTabs,groupForTab,groupPinned,inPinnedFolder } from '../../runtime/tabGroups';
import { pinnedCloseOffered } from '../../runtime/pinnedClose';
import { splitPlacements } from '../../runtime/splitPlacement';
import { paneIsAlone,selectStripTab,toggleSolo } from '../../ui/splitPaneSelect';
import { outsideSplit } from '../../runtime/splitGroups';
import { pinnedTabsOf, sidebarGroups, sidebarRows } from './sidebarRows';
import { arrangeOf,type BlockId } from '../../ui/customizeModel';
import { sitesOf } from '../../ui/sidePanelSites';
import { pinnedExtensionPlace } from '../../ui/pinnedExtensionPlace';
import { useSettledPress } from './settledPress';
import { installRowSelectionGuard } from '../../ui/rowSelectionGuard';

// A press-and-drag on a row never leaves text selected (ui/rowSelectionGuard.ts).
installRowSelectionGuard();
import type { BookmarkNode,BrowserAction,BrowserDownload,BrowserSnapshot,HistoryVisit,SidebarSide,TabGroup,TabSession } from '../../runtime/types';
import { pageKey } from '../../features/libraryModel';
import { sidebarNote } from '../../features/downloadText';
import { useNewTabPreferences } from '../../ui/newTabPreferences';
import { animateSpring,classScale,frequentStretch,motionSpeed,stripEase,stripMs,useListMotion } from '../../ui/sharedMotion';
import { bookmarkContext,navigateFromRow,openPage,savedPageIdentity } from '../../ui/pageActions';
import { openRailSection,setRailPrefs,toggleRailSection,useRailPrefs } from '../../ui/railPrefs';
import { useShownTabsSwitch } from '../../ui/layoutSync';
import { allowedDropEffect,appClickPlan,appHost,appTabFor,droppedLink,setBookmarkLinkData,listedInSidebar,moveSidebarApp,normalizeAppUrl,noteReleasedTab,removeSidebarAppWithUndo,seedSidebarApps,setSidebarAppsHidden,setSidebarAppsPlace,updateSidebarApp,useSidebarApps,type SidebarApp } from '../../ui/sidebarApps';
import { FavoritesPanel } from './FavoritesPanel';
import { favoritesPanelKey,favoritesPanelWanted,setFavoritesPanelWanted } from './favoritesPanelState';
import { BookmarkFolderRow,BookmarkMoreRow,BookmarkPageRow } from './BookmarkTree';
import { SIDEBAR_LIMITS,kidsOf,treeRows } from '../../ui/bookmarkTreeRows';
import { markPanel,watchStackSnap } from './favoritesStack';
import { warmFavoritesPanelWhenIdle } from './favoritesDisperse';
import { useIconPlates } from '../../ui/iconPlate';
import { foldFavorites,panelRows,placesBeforeStack,stackColumns,STACK_PLATES } from '../../ui/favoritesStackLimit';
import { focusSidebarControl,keepTabFocus,listedTabIds,neighbourTabId,tabFocusEnvironment } from '../../ui/sidebarFocus';
import { pointerAnchor,rowAnchor } from '../../ui/popup';
import { noteUse } from '../../features/metrics/noteUse';
import { profileDownloads } from '../../ui/downloadActivity';
import { DownloadsGlyph } from '../DownloadsGlyph';
import { useSiteIcons } from '../../ui/siteIcons';
import { useIconColors } from '../../ui/siteIconColor';
import { ProfileAvatar } from '../../features/accounts/profileModel';
import { NoelFx } from '../../season/NoelFx';
import { NoelHat } from '../../season/NoelHat';
import { NoelSnow } from '../../season/NoelSnow';
import { noelCarry } from '../../season/noelPlate';
import { dropSelected as dropSelectedSnow } from '../../season/winter/controller';
import { NoelTree } from '../../season/NoelTree';
import { TabPrivacyMark,isNewTabState,privacyNames } from '../TabPrivacyMark';
import { bookmarkControl } from '../../ui/bookmarkControl';
import { hasSidebar,layoutOf,setSidebarPeek,useSidebarPeek } from '../../ui/layoutMode';
import { RAIL_BREAK,RAIL_WIDTH,railOn,shelfOn,shelfSizeAt,shelfSizeOf,shelfSizePatch,steppedShelfSize,type RailSection,type ShelfSize } from '../../runtime/shelf';
import { SWITCH_ARRIVE_SHARE,listSwitchPlan } from './listSwitchMotion';
import { isRailSection,railColumnWidth,setRailPanel,toggleRailPanel,useRailPanel } from '../../ui/shelfRail';
import { ShelfRail,type RailEntry } from './ShelfRail';
import { adoptStamps,markSwitcherReleased,newestStamps,readCtrlTabMode,readCtrlTabShow,recordActivation,subscribeCtrlTabMode,writeSwitcherStart } from '../../ui/tabMru';
import { cancelSplitDrag,endSplitDrag,moveSplitDrag,splitDropAction } from '../../ui/splitDrop';import { carryChip } from '../../ui/useTabDragSurface';import { createPressMemo,selectsOnPress } from '../../ui/pressSelect';import { RootMirror } from '../../ui/rootMirror';import { createEdgeScroller } from '../../ui/dragEdgeScroll';
export { sidebarControl } from '../../ui/layoutMode';
import { clampSidebarWidth,dragCollapses,draggedSidebarWidth,favoriteColumns,overSidebar,previewSidebarWidth,rubberBandWidth,sidebarEdgeOf,sidebarKeyWidth,SIDEBAR_WIDTH,sizeOf,snapSidebarWidth,useSidebarSize } from '../../ui/sidebarLayout';
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
import { carriedAsPill } from '../../ui/carriedForm';
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
import { clipTravel,slideOffset } from './flipLeave';
import '../../styles/sidebar-controls.css';
import './sidebar.css';
import './edges.css';
import './miniRail.css';
import { MINI_RAIL,afterMiniDock,markDarkIcons,miniEnable,miniRailFor,noteMiniWheel,placeMiniLine,railGhost,setRailInert,useMiniPhase,useMiniRail } from '../../ui/miniRail';
import { favWheel,type FavWheelState } from '../../ui/miniFavWheel';
import { miniRailShown } from '../../runtime/miniSidebar';
import { miniDockMove } from '../../ui/miniDockMove';
import { MINI_BOTTOM_AIR,miniBand,miniColumn } from '../../ui/miniGeometry';
import './favorites-stack.css';
import './tab-numbers.css';
import { formatShortcut } from '../../ui/platform';
import { useTabNumbers } from '../../ui/tabNumbers';
import { tabNumberMatches } from '../../runtime/tabNumbers';

import { SidebarExtensions,SidebarExtensionsWarm } from './SidebarExtensions';
import { EdgeThumb } from '../EdgeThumb';
import { revealQuiet } from '../../ui/revealQuiet';
import { screenshotMenuCommand } from '../../ui/screenshotKinds';
import { t } from '../../i18n';
import { ProfileDot } from '../../features/feedback/ProfileDot';
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
 * the footer drifted left and back (reported 3 Nov). */
function revealRow(box:HTMLElement,node:HTMLElement,block:'nearest'|'center',behavior:ScrollBehavior):boolean{
 let top=0,at:HTMLElement|null=node;while(at&&at!==box){top+=at.offsetTop;at=at.offsetParent as HTMLElement|null;}
 if(at!==box)return false;
 const view=box.scrollTop,height=box.clientHeight,size=node.offsetHeight;
 const goal=block==='center'?top-(height-size)/2:top<view?top:top+size>view+height?top+size-height:view,to=Math.max(0,Math.min(goal,box.scrollHeight-height));
 if(Math.abs(to-view)<=.5)return false;
 box.scrollTo({top:to,behavior});return true;
}
/** Keeps the current tab findable: scrolls to it when it changes or when a tab opens in the background, and reports
 * which edge it went past while the list is scrolled away from it. */
function useActiveReveal(activeId:string,tabs:TabSession[],enabled:boolean,reduced:boolean,space:string){
 const root=useRef<HTMLDivElement>(null),[edge,setEdge]=useState<'above'|'below'|null>(null);
 const seen=useRef<Set<string>|null>(null),lastActive=useRef(activeId),lastSpace=useRef(space);
 // While the list scrolls to the tab that was just selected, the "current tab" pill stays away: the tab is on its way into view, and the pill's arrival (and, a frame later, the Bookmarks row it pushes into view) took 36px off the list's height in two steps before the scroll had begun, cutting the bottom rows and popping both rows in (round 6, 150 %). The pill is for a tab the list is scrolled away from.
 const quiet=useRef(revealQuiet()).current;
 const row=(id:string)=>root.current?.querySelector<HTMLElement>(`.sb-tab[data-tab-id="${CSS.escape(id)}"]:not(.sb-flip-ghost)`)||null;
 const measure=useCallback(()=>{
  if(quiet.quiet())return;
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
  const token=quiet.start(),smooth=!(reduced||switched);
  // The last reveal to start is the one that ends the quiet: when its scroll has finished (or at once when nothing scrolled), the pill is measured for where the list stopped.
  const done=()=>{if(quiet.end(token))measure();};
  const frame=requestAnimationFrame(()=>{
   const node=row(target),box=root.current;
   if(!(node&&box&&revealRow(box,node,'nearest',smooth?'smooth':'auto')&&smooth)){done();return;}
   box.addEventListener('scrollend',done,{once:true});window.setTimeout(done,900);
  });
  // A newer change (another tab, a tab opened) ends this quiet: the next run starts its own, or measures at once.
  return()=>{cancelAnimationFrame(frame);quiet.end(token);};
 },[activeId,ids,enabled,space]);// eslint-disable-line react-hooks/exhaustive-deps
 useEffect(()=>{const box=root.current;if(!box)return;box.addEventListener('scroll',measure,{passive:true});const observer=new ResizeObserver(measure);observer.observe(box);measure();return()=>{box.removeEventListener('scroll',measure);observer.disconnect();};},[measure]);
 return {root,edge,reveal:()=>{const node=row(activeId),box=root.current;if(node&&box)revealRow(box,node,'center',reduced?'auto':'smooth');}};
}

/** True while the element `selector` names starts below the scroll region's visible bottom (concept: with many tabs a
 * sticky "Bookmarks" row above the footer jumps there). */
/** `key`: what the scroll box is drawn as (Beta 14: the open sidebar's list or the rail's panel are different boxes, so the listeners follow the box, not only whether it is shown). */
function useBelowFold(root:{current:HTMLDivElement|null},selector:string,enabled:boolean,key='',unlatch=false){
 const [below,setBelow]=useState(false),[boxEl,setBoxEl]=useState<HTMLDivElement|null>(null);
 useEffect(()=>{if(root.current!==boxEl)setBoxEl(root.current);});// Customize unmounts the list and mounts a new one: the listeners below follow the box that is there now (the 'Bookmarks' row stayed after Bookmarks was turned off)
 useEffect(()=>{const box=root.current;if(!enabled||!box){setBelow(false);return;}
  // `unlatch` (Mini): the jump row below the list takes room from the list itself, so Bookmarks a row or so below the fold stayed "below" for as long as the row was there (the list was shorter by its height): measured against the list as it is without it.
  const measure=()=>{const node=box.querySelector<HTMLElement>(selector),edge=box.getBoundingClientRect().bottom,jump=unlatch?box.parentElement?.querySelector<HTMLElement>(':scope>.sb-jump'):null;setBelow(!!node&&node.getBoundingClientRect().top>edge+(jump?Math.max(0,jump.getBoundingClientRect().bottom-edge):0)-8);};
  measure();box.addEventListener('scroll',measure,{passive:true});const observer=new ResizeObserver(measure);observer.observe(box);for(const child of box.children)observer.observe(child);
  return()=>{box.removeEventListener('scroll',measure);observer.disconnect();};
 },[enabled,selector,key,unlatch,boxEl]);// eslint-disable-line react-hooks/exhaustive-deps
 return below;
}
/** Marks a zone whose header is stuck over its own scrolled rows; only then does the header take its glass, so at
 * rest it never draws a band over the sidebar. Written straight to the DOM on scroll (no re-render). */
function useStuckHeaders(root:{current:HTMLDivElement|null},enabled:boolean,key=''){
 const [boxEl,setBoxEl]=useState<HTMLDivElement|null>(null);
 useEffect(()=>{if(root.current!==boxEl)setBoxEl(root.current);});// the list that comes back after Customize is a new element: the scroll listener follows it
 useEffect(()=>{const box=root.current;if(!enabled||!box)return;
  const update=()=>{const top=box.getBoundingClientRect().top;for(const zone of box.querySelectorAll<HTMLElement>('.sb-zone')){const r=zone.getBoundingClientRect();zone.toggleAttribute('data-stuck',r.top<top-.5&&r.bottom>top+32);}};
  update();box.addEventListener('scroll',update,{passive:true});return()=>box.removeEventListener('scroll',update);
 },[enabled,key,boxEl]);// eslint-disable-line react-hooks/exhaustive-deps
}

/** Every tab of this window a favorite can own: the workspace on screen and the others (a favorite's tab follows you). */
const favoriteScope=(state:BrowserSnapshot)=>state.otherWorkspaceTabs?.length?[...state.tabs,...state.otherWorkspaceTabs]:state.tabs;
/** A favorite tile's click (sidebarApps.ts appClickPlan): the favorite's own tab opens, comes back, or returns to its address. It never changes the Space you are in:
 * a tab from another Space comes to this one (`here`, workspaces.ts bringTabHere). */
function openApp(event:MouseEvent<HTMLButtonElement>,app:SidebarApp,state:BrowserSnapshot,dispatch:Dispatch,profileId:string){
 const plan=appClickPlan(event,app,favoriteScope(state),state.activeTabId,profileId);
 if(plan.kind==='none')return;
 if(event.button===1||event.ctrlKey||event.metaKey||event.shiftKey)event.preventDefault();
 if(plan.kind==='open'){dispatch({type:'tab.new',url:app.url,browserProfileId:profileId,favoriteId:app.id});return;}
 if(plan.kind==='select'){dispatch({type:'tab.select',id:plan.tabId,here:true});return;}
 if(plan.kind==='adopt'){dispatch({type:'tab.favorite',id:plan.tabId,favoriteId:app.id});if(plan.select)dispatch({type:'tab.select',id:plan.tabId,here:true});return;}
 if(plan.kind==='home'){dispatch({type:'tab.navigate',url:app.url,tabId:plan.tabId});return;}
 if(plan.kind==='new-window'){const id='tab-'+crypto.randomUUID();dispatch({type:'tab.new',url:app.url,browserProfileId:profileId,background:true,id});dispatch({type:'tab.move-window',id});return;}
 dispatch({type:'tab.new',url:app.url,browserProfileId:profileId,background:true});
}
/** Ctrl+Tab (Settings > Tabs) is main's (desktop/tab-cycle.cjs, Beta 14 A11): main hears the key and does the switch itself, in the step the key arrives, however busy this view is.
 * This view is told only when the Recent tabs list is wanted (`tab-switcher-open`: "Recently used" and Ctrl still down after the delay, with the steps counted so far and main's newest
 * activation times, which the list reads from here) or the tab viewer is (mode "Tab viewer"), and when Ctrl was let go while the list was still on its way (`tab-switcher-release`:
 * the list's view reads the mark as it mounts, tabMru.ts). Main also needs the setting, the tabs that live only in their Favorites tile and the activation times kept here (below). */
const switcher={open:false};
function switcherKey(type:string,event:{start?:number;stamps?:unknown;viewer?:boolean;order?:string[]},state:BrowserSnapshot){
 if(type==='tab-switcher-release'){if(switcher.open)markSwitcherReleased();// the list was asked for and may not be on screen yet to hear this (tabMru.ts)
  switcher.open=false;return;}
 if(event.viewer||readCtrlTabMode()==='viewer'){void runtime.browserCommand({type:'ui',tabId:state.activeTabId,action:'open',kind:'tabs'});return;}
 adoptStamps(event.stamps);writeSwitcherStart(Number.isInteger(event.start)?event.start!:1,Array.isArray(event.order)?event.order:undefined);
 if(!switcher.open){switcher.open=true;void runtime.browserCommand({type:'ui',tabId:state.activeTabId,action:'open',kind:'switcher'});}
}

/** A tab dragged over the Favorites grid: where it would land. Tab drags are pointer drags (they must keep tracking
 * over the page for split view), so the grid learns about them here instead of through HTML drag events. */
let pinHint:{index:number;/** The page would make a new favorite: the tiles open a slot for it. */adding?:boolean}|null=null;const pinListeners=new Set<()=>void>();
function setPinHint(next:{index:number;adding?:boolean}|null){if(pinHint?.index===next?.index&&pinHint?.adding===next?.adding)return;pinHint=next;pinListeners.forEach(listener=>listener());}
const usePinHint=()=>useSyncExternalStore(listener=>{pinListeners.add(listener);return()=>{pinListeners.delete(listener);};},()=>pinHint);
/** True while a sidebar tab is being dragged: an empty Favorites area shows its drop target only then. */
/** The folder a carried group's chip shows: the closed folder in the group's own colour, solid (the header's drawing is lines that draw themselves in the header's state, so it is not copied; a solid shape reads on a chip). */
function groupFolderChip(header:HTMLElement):HTMLElement|undefined{
 const folder=header.querySelector<HTMLElement>('.sb-group-folder');if(!folder)return undefined;
 const mark=document.createElement('span'),svg=document.createElementNS('http://www.w3.org/2000/svg','svg'),path=document.createElementNS('http://www.w3.org/2000/svg','path');
 svg.setAttribute('viewBox','0 0 16 16');svg.setAttribute('width','16');svg.setAttribute('height','16');path.setAttribute('d',FOLDER_SILHOUETTE);path.setAttribute('fill','currentColor');svg.append(path);
 mark.style.color=getComputedStyle(folder).color;mark.append(svg);return mark;
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
 // With the Favorites panel open it covers the grid: the drop lands among the panel's tiles (every Favorite, in order), within what the panel shows.
 const panelGrid=document.querySelector<HTMLElement>('.acira-sidebar .sb-apps-panel-grid'),grid=panelGrid??document.querySelector<HTMLElement>('.acira-sidebar .sb-apps');if(!grid)return null;const box=(panelGrid?.parentElement??grid).getBoundingClientRect();
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

/** The tab menu's Remove from Favorites (Beta 14, the strip's tab menu in Top + sidebar): the favorite this tab is linked to goes, with the same Undo toast as the tile's own Remove. The tab stays; the effect below hands it back to the list as an ordinary tab. */
function unfavoriteTab(tabId:string,state:BrowserSnapshot,dispatch:Dispatch){
 const tab=favoriteScope(state).find(item=>item.id===tabId);if(!tab?.favoriteId)return;
 const owner=state.browserProfiles.find(item=>item.id===tab.browserProfileId),toast=removeSidebarAppWithUndo(tab.browserProfileId,!!owner?.private,tab.favoriteId);
 if(toast)dispatch(toast);
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
 // LAYOUT_MODES §5: tabs live in the sidebar only in the vertical layout (`vertical`); in the horizontal layout they are in the strip. Beta 14: the Shelf (Top + sidebar) is a sidebar beside the strip,
 // with no tab list in it. `exists` is the question "is there a sidebar to open, peek and size"; `vertical` stays "are the tabs in it" (runtime/shelf.ts).
 const vertical=layoutOf(state)==='vertical',exists=hasSidebar(state),shelf=shelfOn(state.settings),rail=railOn(state.settings),expanded=exists&&workspaceIsOpen(state.windowUi,current);
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
 const groups=sidebarGroups(state,profileId,listed);
 /* 14.1: the empty page a close can show (runtime/emptyPage.ts) is no tab of the profile's list or its count */const profileTabs=state.tabs.filter(tab=>tab.browserProfileId===profileId&&tab.blank!==true),listedProfileTabs=profileTabs.filter(listed);
 const active=profileTabs.find(tab=>tab.id===state.activeTabId);
 // Closed is fully hidden (bible 5.2). Resting on the window's left edge peeks it at full width (App's closed width
 // reads --sidebar-rail); it hides again when the pointer leaves. The toolbar toggle and Ctrl+Shift+E open it for good.
 // B14 AJ Mini sidebar (ported from the approved sample): closed is a 56px rail of the real sidebar (ui/miniRail.ts) when the setting says Mini; the hover peek stays for Hidden.
 // Open (floating or docked) is the NORMAL sidebar; only the rail has its own geometry (6px in, the taller Favorites band), and opening/closing animates between the two (miniRail.css).
 /* A Mac window in fullscreen keeps its chrome and its docked sidebar, so it keeps the Mini rail too (it was switched off here: a fullscreen window had no rail and no edge reveal). A website's own fullscreen covers the window with the page, over the interface. */const miniMode=exists&&!rail&&miniRailFor(state.settings,state.windowUi),mini=miniMode&&!expanded,miniDocked=miniMode&&expanded,miniPhase=useMiniPhase(),asideRef=useRef<HTMLElement>(null),miniSide=sidebarSideOf(state.settings);
 const miniW=mini&&collapsedFrom!==null&&(miniPhase!=='open'||performance.now()-collapsedAt<900)?collapsedFrom:(collapsedFrom=null,width);
 const peeking=useSidebarPeek()&&exists&&!expanded&&!mini,setPeeking=setSidebarPeek,shown=expanded||peeking||mini;
 useLayoutEffect(()=>{const root=document.documentElement;if(peeking&&!expanded)root.style.setProperty('--sidebar-rail',rail?`${RAIL_WIDTH}px`:`var(--sidebar-width,${width}px)`);else if(mini)root.style.setProperty('--sidebar-rail',`${MINI_RAIL}px`);else root.style.removeProperty('--sidebar-rail');},[peeking,expanded,width,rail,mini]);
 const wasDocked=useRef(miniDocked);
 /* Docking or undocking is a movement: the docked sidebar keeps the rail's transitions off only until it has landed (miniRail.css data-mini-moving). An insertion effect: it runs after this commit's DOM changes and BEFORE every layout effect of the commit, so no forced style recalculation can see the new class without the attribute (a layout effect came too late: the footer's and the dark icons' fades did not start on a dock from the rail). */
 const dockSeen=useRef(miniDocked);
 useInsertionEffect(()=>{if(dockSeen.current!==miniDocked){dockSeen.current=miniDocked;miniDockMove(asideRef.current);}},[miniDocked]);
 useLayoutEffect(()=>{miniEnable(mini,asideRef.current,width,wasDocked.current&&mini,miniDocked,miniSide);wasDocked.current=miniDocked;},[mini,width,miniDocked,miniSide]);
 useEffect(()=>()=>miniEnable(false,null,width),[]);// eslint-disable-line react-hooks/exhaustive-deps
 const [keepTop,setKeepTop]=useState(0);
 // The rail's Favorites band is 177px (column 11..171, then 19px before the New tab "+"); open is the normal sidebar. The rail adds the difference under the region (--mini-band-dy); the keep button is placed at the row's OPEN position and rides the same slide.
 const [bandDy,setBandDy]=useState(0),[favsH,setFavsH]=useState(160);
 // The active tab's line (rail only) follows every render (selection, folders, Favorites) and the list's scroll (miniRail.ts).
 // (rail only: nothing here runs for a docked Mini sidebar or any other layout)
 useLayoutEffect(()=>{if(asideRef.current&&(mini||asideRef.current.dataset.railInert)){if(mini){placeMiniLine(asideRef.current);markDarkIcons(asideRef.current,state.settings.appearance);}setRailInert(asideRef.current,mini&&miniPhase==='rail');}});
 useLayoutEffect(()=>{if(!mini)return;const region=asideRef.current?.querySelector<HTMLElement>('.sb-apps-region');const rows=asideRef.current?.querySelectorAll('.sb-mini-favs .sb-mini-fav').length??0,col=miniColumn(rows),dy=region?Math.max(0,miniBand(rows)+(region.dataset.bottom!==undefined?MINI_BOTTOM_AIR:0)-region.offsetHeight):0;if(dy!==bandDy)setBandDy(dy);if(col!==favsH)setFavsH(col);if(!mini)return;const row=asideRef.current?.querySelector<HTMLElement>('.sb-new-tab'),box=asideRef.current?.getBoundingClientRect(),margin=region?parseFloat(getComputedStyle(region).marginBottom)||0:0;setKeepTop(row&&box?Math.round(row.getBoundingClientRect().top-box.top-margin):12);/* the Shelf has no New tab row: the button stands near the top of the open sidebar */});
 useEffect(()=>{if(expanded||!exists)setPeeking(false);},[expanded,exists]);
 // The rail's open panel belongs to the rail: it goes when the Shelf stops being the rail or the sidebar closes.
 const railPanel=useRailPanel();
 useEffect(()=>{if(!rail||!expanded)setRailPanel(null);},[rail,expanded]);
 useEffect(()=>{recordActivation(state.activeTabId,state.tabs.map(tab=>tab.id));},[state.activeTabId]);// eslint-disable-line react-hooks/exhaustive-deps
 // A removed favorite (Remove, Delete, an import's Undo, another window) hands its tab back to the tab list as an ordinary tab.
 useEffect(()=>{const ids=new Set(favorites.apps.map(app=>app.id));for(const tab of favoriteScope(state))if(tab.favoriteId&&tab.browserProfileId===profileId&&!ids.has(tab.favoriteId)){noteReleasedTab(tab.favoriteId,tab.id);dispatch({type:'tab.favorite',id:tab.id,favoriteId:null});}},[favorites.apps,state.tabs,state.otherWorkspaceTabs,profileId]);// eslint-disable-line react-hooks/exhaustive-deps
 // Open/closed is one choice for every page (sidebarPatch). If an older writer flipped only one page kind's flag,
 // adopt what the current page shows so switching between websites and internal pages never flips the sidebar.
 useEffect(()=>{if(state.windowUi.workspaceOpen!==state.windowUi.webWorkspaceOpen)dispatch({type:'ui.update',patch:sidebarPatch(workspaceIsOpen(state.windowUi,current))});},[state.windowUi.workspaceOpen,state.windowUi.webWorkspaceOpen]);// eslint-disable-line react-hooks/exhaustive-deps
 useEffect(()=>()=>{document.documentElement.style.removeProperty('--sidebar-rail');},[]);
 const peek=useActiveReveal(state.activeTabId,listedProfileTabs,(expanded||peeking||mini)&&listTabs&&!prefs.folded.tabs,reduced,state.activeWorkspaceId);
 const boxKey=rail?'rail:'+(railPanel??''):'open';
 const bookmarksBelow=useBelowFold(peek.root,'[data-zone=bookmarks]',shown,boxKey,miniMode);
 useStuckHeaders(peek.root,shown,boxKey);
 // D191 part 5 (the team rule: a visible glitch found is fixed): when a split's members change (a pane closed, Unsplit, a drop) the rows go to the layout the commit gives them, at once. The FLIP played them across each other while the split card dissolved (two rows over each other by 5-12 px for about a second at his speed).
 const splitShape=JSON.stringify((state.windowUi.splitGroups??[]).map(group=>[group.id,group.tabIds])),lastSplitShape=useRef(splitShape);
 if(lastSplitShape.current!==splitShape){lastSplitShape.current=splitShape;skipNextFlip();}
 useFlip(peek.root,reduced,state.activeWorkspaceId);
 useSettledPress(peek.root);
 useCardGlide(peek.root,'.sb-tab[aria-current=true]:not([data-hidden])',reduced);
 useEdgeLight(peek.root,()=>reduced?0:springMs(),SPRING);
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
 // Main does Ctrl+Tab itself (tab-cycle.cjs): it is told the setting, the tabs the list leaves out (they live only in their Favorites tile) and, once, the activation times kept here.
 const unlistedKey=state.tabs.filter(tab=>!listed(tab)).map(tab=>tab.id).join(' '),stampsSent=useRef(false);
 useEffect(()=>{const send=()=>{const now=latest.current.state;/* 14.1: on the empty page a close can show (runtime/emptyPage.ts) nothing is said: a click's close draws it here before main has made it (main would refuse a tab it does not know yet), it is no stop of Ctrl+Tab, and leaving it changes the list, which says it then */if(now.tabs.find(tab=>tab.id===now.activeTabId)?.blank)return;void runtime.browserCommand({type:'switcher-config',tabId:now.activeTabId,mode:readCtrlTabMode(),show:readCtrlTabShow(),unlisted:unlistedKey?unlistedKey.split(' '):[],...(stampsSent.current?{}:{stamps:newestStamps()})});stampsSent.current=true;};send();return subscribeCtrlTabMode(send);},[unlistedKey]);
 useEffect(()=>{const off=runtime.subscribeBrowser?.(raw=>{
  const event=raw as unknown as {type:string;tabId?:string};// sidebar-* events are G's own, outside the shared BrowserEvent union
  const {state,dispatch,expanded}=latest.current;
  if(event.type==='tab-switcher-open'||event.type==='tab-switcher-release'){switcherKey(event.type,event as {start?:number;stamps?:unknown;viewer?:boolean;order?:string[]},state);return;}
  const asked=event.type==='sidebar-pin-app'?event.tabId:event.type==='ui'&&(event as {action?:string}).action==='favorite-tab'?(event as {targetTabId?:string}).targetTabId:undefined;
  if(event.type==='ui'&&(event as {action?:string}).action==='unfavorite-tab'){const target=(event as {targetTabId?:string}).targetTabId;if(typeof target==='string')unfavoriteTab(target,state,dispatch);return;}
  if(typeof asked!=='string')return;
  favoriteTab(asked,state,dispatch);
 });return()=>{off?.();};},[]);
 // In sidebar mode the toolbar under a current private or Tor tab takes the same 6% tint as B's strip-mode toolbar,
 // keyed on this attribute (set even while the sidebar is closed, since the toolbar is always there).
 const currentPrivacy=vertical&&current.privacy&&current.privacy!=='secured'?current.privacy:undefined;/* R3-38: a secured workspace's tabs wear no private wash (ui/tabPrivacy.ts) */
 const glowOn=!currentPrivacy&&!current.sleeping&&!current.risk;const activeGlow=rowGlowColour({url:current.url,iconColour:useSiteIconColor(current.url,current.favicon,glowOn,!!current.error),siteColor:currentSiteColor(current),accentGlow:useOwnPageAccent(),enabled:glowOn,error:!!current.error});/* Customize: the carried block wears the active tab's glow (the colour its own row has) */
 // Sections (Round 2, customisable): Favorites on top, then the movable ones in the order chosen, pinned tabs with
 // the tabs. Right-click on empty sidebar space, or Settings › Sidebar, opens Customize sidebar.
 const saved=sectionLayout(prefs,shelf),layout:SectionLayout={...saved,hidden:[...saved.hidden.filter(id=>id!=='favorites'),...(favorites.hidden?['favorites' as const]:[])]};
 const show=(id:SectionId)=>sectionShown(layout,id),[customizing,setCustomizing]=useState(false);
 /* Beta 14.0 (reported 20 Nov): asked for from the Mini rail, Customize sidebar opens the sidebar first (the rail's own expand) and comes in once the dock has landed (miniRail.ts afterMiniDock): the rail clips it to 56 px. */
 const customizeNow=useRef(()=>{});customizeNow.current=()=>{if(!miniRailShown(state)){setCustomizing(true);return;}dispatch({type:'ui.update',patch:sidebarPatch(true)});afterMiniDock(()=>setCustomizing(true));};
 useEffect(()=>{const open=()=>customizeNow.current();window.addEventListener(CUSTOMIZE_SIDEBAR_EVENT,open);return()=>window.removeEventListener(CUSTOMIZE_SIDEBAR_EVENT,open);},[]);
 // Favorites keeps one switch, the Favorites store's (Settings › Sidebar "Show Favorites" reads the same one).
 const changeLayout=(next:SectionLayout)=>{const off=next.hidden.includes('favorites');if(off!==favorites.hidden)setSidebarAppsHidden(profileId,privateMode,off);saveSections({...next,hidden:next.hidden.filter(id=>id!=='favorites')},profileId,privateMode,shelf);};
 // A section's right-click menu (drawn in the popup renderer) asks this window's sidebar to hide that section or to open Customize sidebar.
 const sectionsNow=useRef({layout,changeLayout,dispatch,profileId,privateMode,shelf});sectionsNow.current={layout,changeLayout,dispatch,profileId,privateMode,shelf};
 useEffect(()=>onSidebarRequest(sidebarWindowId(state),request=>{
  if(request.kind==='customize'){customizeNow.current();return;}
  if(request.kind==='edit-favorite'){window.dispatchEvent(new CustomEvent('acira-edit-favorite',{detail:request.appId}));return;}
  const now=sectionsNow.current;if(now.layout.hidden.includes(request.section))return;
  now.changeLayout(hideSection(now.layout,request.section));now.dispatch(sectionHiddenToast(now.profileId,now.privateMode,request.section,now.shelf));
 }),[state.windowId]);// eslint-disable-line react-hooks/exhaustive-deps
 const background=(event:MouseEvent<HTMLElement>)=>{const target=event.target as HTMLElement;if(target!==event.currentTarget&&!target.classList.contains('sb-sep')&&!target.classList.contains('sb-foot'))return;event.preventDefault();/* Right-click on empty space: a small menu with New workspace… (where the window has workspaces), Customize sidebar… and, since Beta 14, the Tabs layout as a row of icons. */openWorkspacePopup(state,'workspace-context',event,{mode:'sidebar'});};
 // Customize sidebar: what is drawn where (ui/customizeModel.ts arrangeOf): the two edges, the list between them, and what is turned off. Pinned tabs and Tabs are two blocks of the list; an empty Pinned tabs block draws nothing (and takes no separator).
 // A pinned extension's icon is drawn once: the sidebar's row only where the toolbar's copy is not on screen (ui/pinnedExtensionPlace.ts).
 const extPlace=pinnedExtensionPlace(state.settings,state.windowUi),sidePanelSites=sitesOf(state).length,arrangement=arrangeOf(layout,{shelf,favoritesPlace:favorites.place==='bottom'?'bottom':'top',sidePanel:sidePanelSites>0}),pinnedNow=pinnedTabsOf(state,listedProfileTabs);
 const blocks:{id:SectionId;lead:boolean}[]=[];
 for(const id of arrangement.middle)if(id!=='footer'&&(id==='tabs'?listTabs:id==='pinned'?listTabs&&pinnedNow.length>0:id==='extensions'?extPlace==='sidebar':true))blocks.push({id,lead:blocks.length>0});
 const openFolds:Record<string,boolean>={'bookmarks-open':true,'bookmarks-shelf-closed':false,'downloads-closed':false,'history-closed':false,'reading-closed':false};
 // `open`: every section drawn open whatever was folded (the rail's panel shows one section, so a folded header would be an empty panel).
 const block=({id,lead,open}:{id:SectionId;lead:boolean;open?:boolean})=>id==='tabs'?<SidebarTabList key={id} lead={lead}/>
  :id==='pinned'?<SidebarPinned key={id} lead={lead}/>
  :id==='extensions'?(extPlace==='sidebar'?<SidebarExtensions key={id} tab={current} place="list"/>:null)
  :id==='sidepanel'?<SidePanelIcons key={id} state={state} dispatch={dispatch} current={current} mini={mini} place="list"/>
  :id==='bookmarks'?<SidebarBookmarks key={id} state={state} dispatch={dispatch} profileId={profileId} privateMode={privateMode} folded={open?openFolds:prefs.folded} reduced={reduced} lead={lead} shelf={shelf}/>
  :id==='downloads'?<SidebarDownloads key={id} state={state} dispatch={dispatch} profileId={profileId} privateMode={privateMode} folded={open?openFolds:prefs.folded} reduced={reduced} lead={lead} navigate={navigate}/>
  :id==='history'?<SidebarHistory key={id} state={state} dispatch={dispatch} profileId={profileId} privateMode={privateMode} folded={open?openFolds:prefs.folded} reduced={reduced} lead={lead} navigate={navigate}/>
  :<SidebarReading key={id} state={state} dispatch={dispatch} current={current} profileId={profileId} privateMode={privateMode} folded={open?openFolds:prefs.folded} reduced={reduced} lead={lead}/>;
 // One block of an edge. The Favorites grid (with its separator) stands at either edge; the footer is the profile and the four small icons, the side panel sites their own row (they stand together at the bottom by default).
 // In the default shape (Favorites, then the pinned extensions' row, nothing else on the top edge) the row stays the first child of the sections wrapper, where it always was: the Favorites panel pushes it with the list (favorites-stack.css).
 const extInWrap=arrangement.top.at(-1)==='extensions'&&arrangement.top.at(-2)==='favorites';
 const edge=(id:BlockId,zone:'top'|'bottom'):ReactNode=>id==='favorites'?(zone==='top'?<Fragment key={id}><SidebarTop state={state} dispatch={dispatch} current={current} profileId={profileId} privateMode={privateMode}/>{favoritesSeparator(favorites.apps.length)&&<div className="sb-sep sb-sep-fav" role="separator"/>}</Fragment>:<div key={id} className="sb-favorites-bottom">{favoritesSeparator(favorites.apps.length)&&<div className="sb-sep" role="separator"/>}<SidebarTop state={state} dispatch={dispatch} current={current} profileId={profileId} privateMode={privateMode}/></div>)
  :id==='extensions'?(extPlace==='sidebar'?<SidebarExtensions key={id} tab={current} place={zone}/>:null)
  :id==='sidepanel'?<SidePanelIcons key={id} state={state} dispatch={dispatch} current={current} mini={mini} place={zone==='bottom'&&arrangement.bottom.at(-1)==='sidepanel'?'end':zone}/>
  :id==='footer'?<SidebarFooter key={id} state={state} dispatch={dispatch} current={current} navigate={navigate} edge={zone}/>:null;
 // The workspace row stands right above the footer's side panel row and footer (where it always was); with the icon row at the top it closes the bottom edge.
 const bottomNodes:ReactNode[]=arrangement.bottom.map(id=>edge(id,'bottom')),footerAt=arrangement.bottom.indexOf('footer'),workspaceAt=footerAt<0?bottomNodes.length:arrangement.bottom[footerAt-1]==='sidepanel'?footerAt-1:footerAt;
 bottomNodes.splice(workspaceAt,0,<WorkspaceRow key="workspaces" state={state} dispatch={dispatch} moveFocus={moveFocus}/>);
 /* 14.1: a click on empty sidebar space closes a side panel site that floats over the page (ui/sidebarClickAway.ts) */const clickAway=useSidebarClickAway();
 if(!shown)return <aside className="ed-rail acira-sidebar" aria-label={t("acirasidebar.sidebar")} aria-hidden="true" inert data-current-privacy={currentPrivacy} data-reduced-motion={reduced||undefined}><RootMirror name="rail-collapsed"/>{extPlace==='sidebar'&&<SidebarExtensionsWarm tab={current} tabs={state.tabs} width={state.settings.sidebarWidth}/>}</aside>;
 // Beta 14: the Shelf folded to its rail (runtime/shelf.ts, ShelfRail.tsx). One icon per section; a click opens that section's panel beside the rail. The panels are the open sidebar's own section components.
 if(rail){
  const icons:Record<RailSection,LucideIcon>={favorites:Star,bookmarks:Bookmark,reading:BookOpen,history:HistoryGlyph,downloads:Download};
  const names:Record<RailSection,string>={favorites:t("acirasidebar.favorites"),bookmarks:t("browsermenu.bookmarks"),reading:t("acirasidebar.readingList"),history:t("browsermenu.history"),downloads:t("browsermenu.downloads")};
  // Favorites are tiles in the rail (the brief's picture), not an icon: the icons are the library sections.
  const ids=blocks.map(item=>item.id).filter(isRailSection);
  const entries:RailEntry[]=ids.map(id=>({key:id,label:names[id],icon:<PreviewIcon icon={icons[id]} size={18} className="sb-rail-glyph"/>,open:railPanel===id,onClick:()=>toggleRailPanel(id)}));
  if(windowWorkspaces(state).length>1||profilesAsSpaces(state))entries.splice(0,0,{key:'workspaces',label:t("workspaces.switcher"),icon:<PreviewIcon icon={PanelsTopLeft} size={18} className="sb-rail-glyph"/>,popup:true,onClick:target=>openWorkspacePopup(state,'workspace-menu',target)});
  const panel=railPanel&&ids.includes(railPanel)?railPanel:null;
  const content=panel?<div ref={peek.root} className="sb-scroll sb-rail-scroll">{block({id:panel,lead:false,open:true})}</div>:null;
  const tiles=show('favorites')?<SidebarApps state={state} dispatch={dispatch} current={current} profileId={profileId} privateMode={privateMode} rail/>:null;
  return <aside className={`ed-rail acira-sidebar is-expanded is-rail${peeking&&!expanded?' is-peek':' is-shelf'}`} aria-label={t("acirasidebar.sidebar")} data-current-privacy={currentPrivacy} data-reduced-motion={reduced||undefined} data-rail-panel={panel||undefined} onPointerDown={clickAway.onPointerDown} onClick={clickAway.onClick}>
   <span className="st-glow-rail" aria-hidden="true" ref={railGlowRef0}/><span className="st-glow-rail" aria-hidden="true" ref={railGlowRef1}/><span className="st-glow-rail" aria-hidden="true" ref={railGlowRef2}/>
   <ShelfRail state={state} dispatch={dispatch} entries={entries} tiles={tiles} panelTitle={panel?names[panel]:undefined} panel={content} onClose={()=>setRailPanel(null)} onProfile={target=>popup(state,'profile',target)} profileName={profile?.private?'Private':profile?.name||'Personal'} privateMark={profile?.private?<span className="sb-foot-private" aria-hidden="true"><PrivateGlyph/></span>:undefined} moveFocus={moveFocus} sidePanelOff={arrangement.off.includes('sidepanel')}/>
   <ResizeHandle width={railColumnWidth(panel)} onChange={setWidth} side={sidebarSideOf(state.settings)} shelf={{rail:true,onSize:size=>dispatch({type:'settings.update',patch:shelfSizePatch(size)})}}/>
  <RootMirror name="rail" value={peeking&&!expanded?'expanded peek':'expanded shelf docked'}/></aside>;
 }
 return <><aside ref={asideRef} className={`ed-rail acira-sidebar is-expanded${peeking&&!expanded?' is-peek':shelf?' is-shelf':''}${miniMode?' is-mini':''}${miniDocked?' is-mini-docked':''}`} data-mini={miniDocked?'open':mini?miniPhase:undefined} style={miniMode?{'--mini-w':`${miniW}px`,'--mini-band-dy':`${bandDy}px`,'--mini-favs-h':`${favsH}px`} as CSSProperties:undefined} aria-label={t("acirasidebar.sidebar")} data-current-privacy={currentPrivacy} data-reduced-motion={reduced||undefined} data-addr-side={addressSide.block||undefined} data-addr-open={addressSide.open||undefined} onDragStartCapture={mini?(event:DragEvent<HTMLElement>)=>event.preventDefault():undefined/* Beta 14.0: no native drag starts in the Mini rail either (a Favorite's or a bookmark's own, a favicon picture) */} onPointerDown={clickAway.onPointerDown} onClick={clickAway.onClick}>
  {/* the site glow's left wash lives here so it travels with the sidebar (siteGlowEngine.ts railGlowRef); the same three layers stand in the aside in EVERY state (the rail too: translated back to the rail's edge, miniRail.css), so a dock or an undock never unmounts them */}<span className="st-glow-rail" aria-hidden="true" ref={railGlowRef0}/><span className="st-glow-rail" aria-hidden="true" ref={railGlowRef1}/><span className="st-glow-rail" aria-hidden="true" ref={railGlowRef2}/>{/* Ambient mode (ui/ambient.ts): the page's edge colours as light, inside the sidebar so it opens, slides and leaves with it */}{!mini&&<AmbientSideLayer/>}{state.settings.noelOn===true&&<NoelSnow/>}
  {/* Favorites sit at the top (the default) or at the bottom, above the workspace row and the footer (Settings > Tabs > Sidebar > Favorites). */}
  {customizing?<SidebarCustomize key={profileId+':'+(shelf?'shelf':'full')} layout={layout} onChange={changeLayout} onDone={()=>setCustomizing(false)} favoritesPlace={favorites.place==='bottom'?'bottom':'top'} onFavoritesPlace={place=>setSidebarAppsPlace(profileId,privateMode,place)} shelf={shelf} sidePanel={sidePanelSites>0} extensionsPlace={extPlace} glow={activeGlow} size={sizeOf(width)} previews={{favorites:favorites.apps.map(app=>({icon:app.icon,title:app.title})),pinned:pinnedNow.map(tab=>({favicon:tab.favicon,title:tab.title}))}}/>:<>
  {/* The top edge: Favorites, the pinned extensions' row, the icon row, the side panel sites, in the order Customize sidebar put them (the default: Favorites, then the extensions). With no Favorites there, the band that drags the window. */}
  {!arrangement.top.includes('favorites')&&<div className="sb-top-space" aria-hidden="true"/>}{arrangement.top.map(id=>id==='extensions'&&extInWrap?null:edge(id,'top'))}
  <div className="sb-sections-wrap">{extInWrap&&edge('extensions','top')}{!shelf&&<WorkspaceTitle state={state} count={profileTabs.length}/>}<div ref={peek.root} className="sb-scroll" onContextMenu={background}>
   <SidebarTabs state={state} dispatch={dispatch} tabs={listedProfileTabs} openCount={profileTabs.length} groups={groups} newTabsTop={!!prefs.newTabsTop} folders={prefs.folders??'mixed'} enabled={listTabs}>{blocks.map(block)}</SidebarTabs>
  </div>
  <EdgeThumb scroller={peek.root} region=".acira-sidebar"/>
  {/* Below the list, in flow, always in this order: the Bookmarks row (the header's own mark, label and chevron: it stands in for the header while the header is out of view), then the current tab's row. The two used to be the other way round, so the same Bookmarks label swapped places with the pill as the list scrolled, and the row had no mark (Beta 14, A4). */}
  {bookmarksBelow&&<button type="button" className="sb-jump sb-zone-toggle" data-sb-focus onClick={()=>peek.root.current?.querySelector<HTMLElement>('[data-zone=bookmarks]')?.scrollIntoView({block:'start',behavior:reduced?'auto':'smooth'})}><span className="sb-tab-icon sb-zone-mark" aria-hidden="true"><PreviewIcon icon={Bookmark} size={14}/></span><span className="sb-zone-label">{t("browsermenu.bookmarks")}</span><span className="sb-zone-chev sb-zone-chev-end" aria-hidden="true"><PreviewIcon icon={ChevronDown} size={10}/></span></button>}
  {peek.edge&&active&&<button type="button" className="sb-active-peek" data-edge={peek.edge} title={t("acirasidebar.showTheCurrentTab")} onClick={peek.reveal}><SiteIdentityIcon url={active.url} favicon={active.favicon} size={16}/><span className="sb-active-peek-title">{title(active)}</span><PreviewIcon icon={peek.edge==='above'?ArrowUp:ChevronDown} size={12}/></button>}
  </div>
  <SidebarMedia state={state} dispatch={dispatch}/>
  {bottomNodes}
  </>}
  {<ResizeHandle width={width} onChange={setWidth} onCollapse={from=>{collapsedFrom=from;collapsedAt=performance.now();dispatch({type:'ui.update',patch:sidebarPatch(false)});}} side={sidebarSideOf(state.settings)} shelf={shelf?{rail:false,onSize:size=>dispatch({type:'settings.update',patch:shelfSizePatch(size)})}:undefined}/>}
 {mini&&<span className="sb-mini-line" aria-hidden="true"/>}
  {mini&&hideToolbarOn(state.settings,effectiveView(state.settings,state.windowUi))&&<button type="button" className="sb-mini-expand" tabIndex={miniPhase==='rail'?0:-1} aria-label={t("app.expandSidebar")} title={controlTitle(t("app.expandSidebar"))} onClick={()=>dispatch({type:'ui.update',patch:sidebarPatch(true)})}><svg className="sb-mini-expand-ico" viewBox="0 0 16 16" aria-hidden="true"><rect x="2.25" y="2.75" width="11.5" height="10.5" rx="2.25"/><path d="M6.25 2.75v10.5"/></svg></button>}
  {mini&&<button type="button" className="sb-mini-keep" style={{top:keepTop}} tabIndex={miniPhase==='open'?0:-1} aria-label={t("acirasidebar.keepOpen")} title={`${t("acirasidebar.keepOpen")} · ${formatShortcut('Ctrl Shift E')}`} onClick={()=>dispatch({type:'ui.update',patch:sidebarPatch(true)})}><svg className="sb-mini-keep-ico" viewBox="0 0 16 16" aria-hidden="true"><rect x="2.25" y="2.75" width="11.5" height="10.5" rx="2.25"/><path d="M6.25 2.75v10.5"/></svg></button>}
 <RootMirror name="rail" value={(peeking&&!expanded?'expanded peek':shelf?'expanded shelf docked':'expanded docked')+(mini?' mini':'')+(miniDocked?' mini minidocked':'')}/></aside>{/* in Mini the site glow's left wash stands outside the rail's clip, behind the rail and the toolbar beside it alike (one surface) */}{mini&&<AmbientSideLayer className="sb-mini-amb"/>}{mini&&<div className="sb-mini-shade" data-mini={miniPhase} aria-hidden="true" style={{'--mini-w':`${width}px`} as CSSProperties}><div className="sb-mini-glass"/><RootMirror name="mini" value={miniPhase}/></div>}</>;
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
function SidebarFooter({state,dispatch,current,navigate,edge='bottom'}:{state:BrowserSnapshot;dispatch:Dispatch;current:TabSession;navigate:(page:string)=>void;/** Customize sidebar: the icon row stands at the top edge or the bottom one (the bottom is where it always was). */edge?:'top'|'bottom'}){
 const siteNoteList=useSiteNotifications(state.activeTabId),topBarHidden=hideToolbarOn(state.settings,effectiveView(state.settings,state.windowUi));
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
 return <><div className="sb-foot" data-edge={edge==='top'?'top':undefined}>
  <button type="button" className="sb-foot-profile" data-sb-focus data-popup-trigger aria-haspopup="dialog" aria-label={`${name}. Switch profile`} title={isPrivate?t("acirasidebar.privateWindowNothingFromThis"):t("app.switchProfile")} onKeyDown={moveFocus} onClick={event=>popup(state,'profile',event.currentTarget)}>
   {isPrivate?<span className="sb-foot-private" aria-hidden="true"><PrivateGlyph/></span>:state.settings.noelOn===true?<i className="noel-hatted"><ProfileAvatar profileId={profile?.id} name={name} color={profile?.color||'#6b7280'} avatar={profile?.avatar} picture={profile?.picture} size={22}/><NoelHat/></i>:<ProfileAvatar profileId={profile?.id} name={name} color={profile?.color||'#6b7280'} avatar={profile?.avatar} picture={profile?.picture} size={22}/>}<span className="sb-foot-name">{name}</span>{isPrivate?null:<ProfileDot profileId={profile?.id}/>}
  </button>
  <div className="sb-foot-icons">
   {place(t("browsermenu.bookmarks"),current.url==='acira://bookmarks',()=>navigate('bookmarks'),<LineIcon name="bookmark" size={16}/>)}
   <button type="button" className="sb-foot-icon" data-popup-trigger aria-haspopup="dialog" aria-label={`${active.length?t('dl.btnActive',{count:active.length}):fresh?t('dl.btnNew'):t('browsermenu.downloads')} · ${formatShortcut('Ctrl J')}`} title={`${active.length?t('dl.btnActive',{count:active.length}):fresh?t('dl.btnNew'):t('browsermenu.downloads')} · ${formatShortcut('Ctrl J')}`} aria-current={onDownloads?'page':undefined} onClick={openDownloads}>
    <DownloadsGlyph downloads={downloads} reducedMotion={state.settings.reducedMotion} idle={<><LineIcon name="downloads" size={16}/>{fresh?<i className="sb-foot-dot" aria-hidden="true"/>:null}</>}/>
   </button>
   {/* 14.3: with the toolbar hidden the website notifications' bell rides here, after Downloads, while the window's list holds a row (the footer's own dot for unread) */}
   {topBarHidden&&siteNoteList.holds&&<button type="button" className="sb-foot-icon sb-foot-notifications" data-popup-trigger aria-haspopup="dialog" aria-label={siteNoteList.unread?t('sitenotes.bellCount',{count:siteNoteList.unread}):t('sitenotes.bell')} title={t('sitenotes.title')} onClick={event=>popup(state,'notifications',event.currentTarget)}><BellIcon size={16}/>{siteNoteList.unread>0?<i className="sb-foot-dot" aria-hidden="true"/>:null}</button>}
   {place(`History · ${formatShortcut('Ctrl H')}`,current.url==='acira://history',()=>navigate('history'),<LineIcon name="history" size={16}/>)}
   {place(`Settings · ${formatShortcut('Ctrl ,')}`,current.url==='acira://settings',()=>navigate('settings'),<LineIcon name="settings" size={16}/>)}
   {state.settings.noelOn===true&&<NoelTree label={t('noelsettings.tree')} snowOff={state.settings.noelSnow==='off'} onMenu={event=>popup(state,'noel-context',event.currentTarget,undefined,event)}/>}
   {/* Beta 14: the optional camera button (Settings > Screenshot button > Sidebar bottom row); off by default. It opens the menu the shortcut opens. */}
   {state.settings.screenshotButton==='sidebar'&&<button type="button" className="sb-foot-icon sb-foot-screenshot" data-popup-trigger aria-haspopup="menu" aria-label={t('shortcutCmd.screenshot')} title={`${t('shortcutCmd.screenshot')} · ${formatShortcut('Ctrl Shift 7')}`} onClick={event=>void runtime.browserCommand(screenshotMenuCommand(state.activeTabId,event.currentTarget.getBoundingClientRect()))}><LineIcon name="camera" size={16}/></button>}
  </div>
 </div></>;
}

/** Drag the sidebar edge: it follows the pointer between Narrow and Wide and, on release, settles on the nearest of the three sizes (the Favorites grid reflows
 * at the two midpoints, so it shows where it will land). Arrows step to the next size, Home is Narrow, End is Wide, Enter or a double-click is Standard, and a
 * right-click (or the menu key) lists the three. The grip is on the sidebar's page-side edge, so the drag and the arrows mirror on the right (ui/sidebarLayout
 * draggedSidebarWidth, sidebarKeyWidth); the rubber band and the clamp do not care which side. */
/** F4: the width the sidebar had when a drag below Narrow closed it. The Mini closing morph is laid out at `--mini-w`; it starts from this width instead of the saved one, so the hand-over from the drag to the close is not a jump (the saved width is not touched). Cleared as soon as the rail is not closing or resting any more. */
let collapsedFrom:number|null=null,collapsedAt=0;
function ResizeHandle({width,onChange,onCollapse,side,shelf}:{width:number;onChange:(width:number)=>void;/** F4: the edge was let go more than 40px below Narrow: close the sidebar */onCollapse?:(from:number)=>void;side:SidebarSide;/** Beta 14, the Shelf: it has a fourth, smaller size (the rail), so the edge can go below Narrow and lands on the rail past RAIL_BREAK. `rail`: it is the rail now. */shelf?:{rail:boolean;onSize:(size:ShelfSize)=>void}}){
 const drag=useRef<{x:number;width:number;raw:number}|null>(null);
 // Release: ease from the rubber-banded edge to the size it is nearest, then hand back to the setting.
 const end=()=>{if(!drag.current)return;const raw=drag.current.raw;drag.current=null;
  if(shelf){const size=shelfSizeAt(raw);previewSidebarWidth(size==='rail'?RAIL_WIDTH:snapSidebarWidth(raw),false);shelf.onSize(size);}
  else if(onCollapse&&dragCollapses(raw)){/* the edge stays where the pointer left it (rubber-banded) and the sidebar closes from there: the preview is cleared once it has gone */const from=rubberBandWidth(raw,low);previewSidebarWidth(from,false);onCollapse(from);}
  else{const target=snapSidebarWidth(raw);previewSidebarWidth(target,false);onChange(target);}
  window.setTimeout(()=>{if(!drag.current)previewSidebarWidth(null);},450);};
 const key=(event:KeyboardEvent<HTMLDivElement>)=>{
  if(event.key==='ContextMenu'||event.shiftKey&&event.key==='F10'){event.preventDefault();const box=event.currentTarget.getBoundingClientRect();openBookmarkMenu(SIZE_REF,{x:box.left+box.width/2,y:box.top+box.height/2,width:2,height:2});return;}
  if(shelf){
   // The same keys over four sizes: an arrow steps (mirrored on the right), Home is the rail, End is Wide, Enter is Standard.
   const toward=event.key==='ArrowLeft'?-1:event.key==='ArrowRight'?1:0,now=shelf.rail?'rail' as const:sizeOf(width);
   const next:ShelfSize|null=toward?steppedShelfSize(now,(side==='right'?-toward:toward) as -1|1):event.key==='Home'?'rail':event.key==='End'?'wide':event.key==='Enter'?'standard':null;
   if(next===null)return;event.preventDefault();if(next!==now)shelf.onSize(next);return;
  }
  const next=sidebarKeyWidth(side,event.key,width);
  if(next===null)return;event.preventDefault();onChange(next);
 };
 const low=shelf?RAIL_WIDTH:SIDEBAR_WIDTH.min,now=shelf?.rail?t("sidebar.sizeRail"):t(SIZE_NAME_ID[sizeOf(width)]);
 return <div className="sb-resize" role="separator" aria-orientation="vertical" aria-label={t("acirasidebar.resizeSidebar")} aria-valuemin={low} aria-valuemax={SIDEBAR_WIDTH.max} aria-valuenow={width} aria-valuetext={now} tabIndex={0} title={t("acirasidebar.dragToResizeDoubleClick")}
  onPointerDown={(event:PointerEvent<HTMLDivElement>)=>{if(event.button!==0)return;event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);drag.current={x:event.clientX,width,raw:width};previewSidebarWidth(width);}}
  onPointerMove={event=>{if(!drag.current)return;const raw=draggedSidebarWidth(side,drag.current.width,drag.current.x,event.clientX);drag.current.raw=raw;previewSidebarWidth(rubberBandWidth(raw,low));}}
  onContextMenu={event=>{event.preventDefault();event.stopPropagation();openBookmarkMenu(SIZE_REF,{x:event.clientX,y:event.clientY,width:2,height:2});}}
  onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end} onDoubleClick={()=>shelf?shelf.onSize('standard'):onChange(SIDEBAR_WIDTH.initial)} onKeyDown={key}/>;
}

/** Pinned sites above everything else. Click returns to the app's tab, or opens it. */
/** `rail` (Beta 14): the Shelf's rail draws the Favorites as one column of tiles in its own 52px (the brief's picture, variant C): every Favorite is a tile (the column scrolls past the rail's height, no stack),
 * and what the open sidebar does around the grid (the pin tile, the drop ghost's row of three) is left out. The tiles themselves, their active border, dot, menus and keys are this component's. */
/** B14 Mini sidebar: the rail's Favorites, one scrollable column (miniRail.css). The wheel moves it one row (32px) per notch, smoothly, and
 * never reaches the tab list or opens the sidebar (miniRail.ts noteMiniWheel); a soft fade marks the cut edge where more are hidden. */
function MiniFavColumn({label,hidden,children}:{label:string;hidden:boolean;children:ReactNode}){
 const ref=useRef<HTMLDivElement>(null);
 const mark=()=>{const el=ref.current;if(!el)return;const more=[el.scrollTop>1?'above':'',el.scrollTop+el.clientHeight<el.scrollHeight-1?'below':''].filter(Boolean).join(' ');if(el.dataset.more!==more)el.dataset.more=more;};
 useLayoutEffect(mark);
 useEffect(()=>{const el=ref.current;if(!el)return;let state:FavWheelState|null=null;const wheel=(event:WheelEvent)=>{event.preventDefault();event.stopPropagation();noteMiniWheel();
  // D170: a notch moves one row; a touchpad's or a free wheel's stream of small deltas adds up, a row per 32 px of travel (ui/miniFavWheel.ts); the target is kept between events
  const next=favWheel(state,{deltaY:event.deltaY,deltaX:event.deltaX,deltaMode:event.deltaMode,wheelDeltaY:(event as WheelEvent&{wheelDeltaY?:number}).wheelDeltaY,now:event.timeStamp,scrollTop:el.scrollTop,max:el.scrollHeight-el.clientHeight,page:el.clientHeight});state=next.state;if(next.target!==null)el.scrollTo({top:next.target,behavior:'smooth'});};el.addEventListener('wheel',wheel,{passive:false});return()=>el.removeEventListener('wheel',wheel);},[]);
 return <div ref={ref} className="sb-mini-favs" role="group" aria-label={label} aria-hidden={hidden||undefined} inert={hidden||undefined} onScroll={mark}>{children}</div>;
}

function SidebarApps({state,dispatch,current,profileId,privateMode,rail=false}:{state:BrowserSnapshot;dispatch:Dispatch;current:TabSession;profileId:string;privateMode:boolean;rail?:boolean}){
 const {apps,hidden,seeded,limit:chosenLimit,place}=useSidebarApps(profileId,privateMode),[newTab]=useNewTabPreferences(profileId,privateMode);
 // E6: the extras stay open until the person folds them, per window and profile, in memory (favoritesPanelState.ts): this component is drawn again by a workspace switch, by Favorites moving between the top and the bottom and by a mode change, and the panel comes back as it was, with no opening motion (`settled`).
 const panelKey=favoritesPanelKey(sidebarWindowId(state),profileId);
 const [editing,setEditing]=useState<string|null>(null),[drop,setDrop]=useState<{index:number}|null>(null),[panel,setPanel]=useState<false|'open'|'closing'>(()=>favoritesPanelWanted(panelKey)?'open':false);
 const settled=useRef(favoritesPanelWanted(panelKey));
 // When the extras last opened from a press on the stack (performance.now): with 14, 17, 20 ... Favorites the panel's add tile sits exactly where the stack was, under the pointer; a double-click's second press must not fold the panel and open the editor (the open would read as a flip).
 const openedAt=useRef(-1e4);
 // Edit favorite asked for from a Favorite's menu (E10): hooks up here, before the early returns; the handler is set once the tiles are known (below)
 const editRef=useRef<(id:string)=>void>(()=>{});
 useEffect(()=>{const on=(event:Event)=>editRef.current(String((event as CustomEvent).detail||''));window.addEventListener('acira-edit-favorite',on);return()=>window.removeEventListener('acira-edit-favorite',on);},[]);
 const grid=useRef<HTMLDivElement>(null),stackRef=useRef<HTMLButtonElement>(null),pin=usePinHint(),hint=drop||pin,useMiniRailFavorites=useMiniRail()&&!rail,miniPhaseHere=useMiniPhase();
 useCardGlide(grid,'.sb-app:not(.sb-app-stack)[aria-current=page]',state.settings.reducedMotion);
 // R3-70: favorites tiles glide to their places when one is added, removed or moved (a new one settles in, a removed one fades out).
 useListMotion(grid,apps.map(app=>app.id).join(',')+':'+panel+':'+(hint?hint.index:'')+(pin?.adding?'+':''),{frequent:true});
 const siteIcon=useSiteIcons(state);
 // Called before the early returns below (hidden, no favorites, the drop target): a hook after them makes the first favorite, the last one removed and Hide
 // favorites change the number of hooks between renders (React error #310/#300, the interface reloads itself).
 const size=useSidebarSize(clampSidebarWidth(state.settings.sidebarWidth));
 // The Favorites stack (Beta 14, L1): the grid has `places` places; past that the last one is the stack tile holding the rest, and the one you are on, if it is folded, fronts it.
 const places=rail?Math.max(apps.length,1):placesBeforeStack(chosenLimit,size),tabOf=(app:SidebarApp)=>appTabFor(app,favoriteScope(state),profileId);
 const frontId=foldFavorites(apps,places).folded.find(app=>tabOf(app)?.id===state.activeTabId)?.id,fold=foldFavorites(apps,places,frontId);
 const {overflow,shown,folded,stacked}=fold,stackKey=overflow?stacked.slice(0,STACK_PLATES).map(app=>app.id).join(','):'';
 // The stack's layers sit on whole device pixels, so every step is identical on screen (favoritesStack.ts)
 useLayoutEffect(()=>watchStackSnap(stackRef.current),[stackKey]);
 // The first open of a launch used to stall (WebGL context, program link, first raster inside the click): the same work is done once at idle, never while a tab loads or the sidebar moves (favoritesDisperse.ts)
 const loadingNow=useRef(false);loadingNow.current=state.tabs.some(tab=>tab.loading);
 useEffect(()=>overflow&&!rail?warmFavoritesPanelWhenIdle(()=>loadingNow.current):undefined,[overflow,rail]);
 useLayoutEffect(()=>{markPanel(grid.current,overflow&&panel?panel:null,place==='bottom');},[panel,overflow,place]);
 // The active tile's ring takes its site's colour: each tile's own icon, read once on this computer (ui/siteIconColor.ts); a private window keeps the answers in memory.
 const colours=useIconColors(apps.map(app=>({key:app.id,site:appHost(app.url),src:app.icon||siteIdentity(app.url).icon||siteIcon(app.url)})),!privateMode);
 const iconOfApp=(app:SidebarApp)=>app.icon||siteIdentity(app.url).icon||siteIcon(app.url);
 // Each stacked icon sits on a plate in its own background colour, or a neutral one, worked out once per icon on this computer (ui/iconPlate.ts)
 const plates=useIconPlates(overflow?stacked.slice(0,STACK_PLATES).map(app=>({key:app.id,src:iconOfApp(app)})):[],!privateMode);
 // A panel with nothing to fold (a Favorite removed, a larger limit, the sidebar widened) is gone with the stack it grew from.
 useLayoutEffect(()=>{if(panel&&!overflow){setPanel(false);setFavoritesPanelWanted(panelKey,false);}},[panel,overflow]);
 // another profile of this window comes on screen: its own panel state (open or folded) replaces this one
 const shownKey=useRef(panelKey);
 useLayoutEffect(()=>{if(shownKey.current===panelKey)return;shownKey.current=panelKey;const want=favoritesPanelWanted(panelKey)&&overflow;settled.current=want;setPanel(want?'open':false);},[panelKey]);// eslint-disable-line react-hooks/exhaustive-deps
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
// No Favorites yet (27 Oct): nothing is drawn, so a fresh sidebar has no empty boxes above New tab. While a tab or a link is
 // dragged, a drop zone floats over the top of the list (the rows never move under the pointer) and says what a drop does; it fades in
 // with the drag. Ctrl+Shift+D, the bookmark star menu and Settings › Sidebar add a favorite without a drag.
 const top=favoritesTop({hidden,count:apps.length,editingNew:editing==='new',tabDrag:draggingTab,linkDrag:linkDragging,overZone:Boolean(drop||hint)});
 if(top==='idle')return null;
 if(top==='drop'){
  return <div className="sb-apps-region sb-apps-float"><div className="sb-apps sb-apps-ghost" role="group" aria-label={t("acirasidebar.favoritesEmpty")} style={{'--sb-cols':rail?1:3} as CSSProperties} data-dragging data-dropping={hint?'':undefined}
   onDragOver={event=>{if(!linkOver(event))return;event.preventDefault();event.dataTransfer.dropEffect=allowedDropEffect(event.dataTransfer.effectAllowed,'copy');setDrop(previous=>previous?previous:{index:0});}}
   onDragLeave={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node))setDrop(null);}}
   onDrop={event=>{if(!linkOver(event))return;event.preventDefault();setDrop(null);pinLink(event,0);}}>
   {(rail?[0]:[0,1,2]).map(index=><span key={index} className="sb-app sb-app-ghost" aria-hidden="true"/>)}
   <span className="sb-apps-ghost-hint" aria-hidden="true">{t("acirasidebar.dropToAddToFavorites")}</span>
  </div></div>;
 }
 const open=(event:MouseEvent<HTMLButtonElement>,app:SidebarApp)=>{
  openApp(event,app,state,dispatch,profileId);
 };
 // Up to `places` Favorites show as tiles (12 by default; Settings › Sidebar › Favorites); with more, the last place is the stack and a click on it opens the panel with all of them
 // (no "+N" tile and no fold arrow: the stack replaces them). The size sets the columns: 2, 3 or 4 across; Standard keeps 4 across for the counts where 3 leaves a ragged last row (Zen).
 const tiles=shown.length+(overflow?1:0),cols=rail?1:overflow?stackColumns(size):favoriteColumns(size,tiles),making=Boolean(pin?.adding)&&!overflow&&!drop;
 const closePanel=()=>{setFavoritesPanelWanted(panelKey,false);setPanel(previous=>previous==='open'?'closing':previous);};
 const pace=motionSpeed()==='fast'?.6:1,gridRows=Math.ceil(tiles/cols),rowsOfPanel=panelRows(places,cols,tiles),flyIds=stacked.slice(0,STACK_PLATES).map(app=>app.id);
 const focusTile=(id:string)=>requestAnimationFrame(()=>grid.current?.querySelector<HTMLElement>(`[data-app-id="${id}"]`)?.focus());
 // Edit favorite is a popover from the tile (A's panel spec); a private window's favorites live in this renderer only,
 // so there it stays the inline form.
 // the Favorite's menu (E10): the popup carries the window's tab, the Favorite travels through storage like the Edit popover's target
 const openMenu=(app:SidebarApp,tile:HTMLElement,pointer?:{clientX:number;clientY:number})=>{setFavoriteEditTarget({profileId,appId:app.id});popup(state,'favorite-context',tile,state.activeTabId,pointer);};
 const edit=(app:SidebarApp,tile:HTMLElement)=>{if(privateMode){setEditing(app.id);return;}setFavoriteEditTarget({profileId,appId:app.id});popup(state,'favorite-edit',tile);};
 // Edit favorite, asked for from the Favorite's menu (a popup in another renderer): the tile it hangs from is found here (a folded one hangs from the stack)
 editRef.current=id=>{const app=apps.find(item=>item.id===id),tile=grid.current?.parentElement?.querySelector<HTMLElement>(`.sb-apps-panel-grid>[data-app-id="${id}"],.sb-apps>[data-app-id="${id}"]`)||stackRef.current||grid.current;if(app&&tile)edit(app,tile);};
 const key=(event:KeyboardEvent<HTMLButtonElement>,app:SidebarApp,index:number)=>{
  if(event.key==='F2'){event.preventDefault();edit(app,event.currentTarget);return;}
  if(event.key==='ContextMenu'||event.shiftKey&&event.key==='F10'){event.preventDefault();if(privateMode)edit(app,event.currentTarget);else openMenu(app,event.currentTarget);return;}
  if(event.key==='Delete'){event.preventDefault();const toast=removeSidebarAppWithUndo(profileId,privateMode,app.id);if(toast)dispatch(toast);const next=apps[index+1]||apps[index-1];if(next)focusTile(next.id);return;}
  if(event.altKey&&(event.key==='ArrowLeft'||event.key==='ArrowRight')){event.preventDefault();moveSidebarApp(profileId,privateMode,app.id,index+(event.key==='ArrowLeft'?-1:1));focusTile(app.id);return;}
  if(event.key==='ArrowLeft'||event.key==='ArrowRight'){const list=event.currentTarget.parentElement,tiles=[...(list?.querySelectorAll<HTMLElement>(':scope>.sb-app')||[])],at=tiles.indexOf(event.currentTarget),next=tiles[at+(event.key==='ArrowLeft'?-1:1)];if(next){event.preventDefault();next.focus();}return;}
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
 const dragProps={
  onDragOver:(event:DragEvent<HTMLDivElement>)=>{if(!accepts(event))return;event.preventDefault();event.dataTransfer.dropEffect=allowedDropEffect(event.dataTransfer.effectAllowed,event.dataTransfer.types.includes(APP_TYPE)?'move':'link');const index=dropIndex(event);setDrop(previous=>previous?.index===index?previous:{index});},
  onDragLeave:(event:DragEvent<HTMLDivElement>)=>{if(!event.currentTarget.contains(event.relatedTarget as Node))setDrop(null);},onDrop,
 };
 // One tile, in the grid or in the panel (inside the panel the Favorites look exactly like normal Favorite tiles). The dot, the loading matrix and the selected look are the tile's own.
 const tileFor=(app:SidebarApp,index:number,inPanel=false)=>{const tab=appTabFor(app,favoriteScope(state),profileId),active=tab?.id===state.activeTabId;
  const away=active&&tab.url!==app.url,last=inPanel?apps.length-1:shown.length-1;
  return <button key={app.id} type="button" className="sb-app" data-app-id={app.id} data-morph={favoriteMorphing(app.id)?'':undefined} data-motion-skip={favoriteMorphing(app.id)?'':undefined} data-open={tab?'':undefined} data-sleeping={tab?.sleeping&&favoriteTabsOnlyInTile(state.settings)?'':undefined} data-site={colours[app.id]?'':undefined} style={colours[app.id]?{'--site-h':colours[app.id]!.h,'--site-c':colours[app.id]!.c} as CSSProperties:undefined} data-away={away||undefined} data-editing={editing===app.id||undefined} data-drop={making?undefined:hint?.index===index?'before':hint?.index===index+1&&index===last?'after':undefined} aria-current={active?'page':undefined} aria-label={app.title} title={away?t("acirasidebar.clickToGoBack",{host:appHost(app.url)||address(app.url)}):`${app.title} · ${address(app.url)}`} draggable
   tabIndex={!inPanel&&panel==='open'?-1:undefined}
   onClick={event=>open(event,app)} onAuxClick={event=>open(event,app)} onMouseDown={event=>{if(event.button===1)event.preventDefault();}}
   onContextMenu={event=>{event.preventDefault();if(privateMode)edit(app,event.currentTarget);else openMenu(app,event.currentTarget,event);}} onKeyDown={event=>key(event,app,index)}
   onDragStart={event=>{event.dataTransfer.setData(APP_TYPE,app.id);event.dataTransfer.effectAllowed='move';}} onDragEnd={()=>setDrop(null)}>
   <AppIcon app={app} tab={tab} stored={siteIcon(app.url)} reduced={state.settings.reducedMotion}/>
   {state.settings.noelOn===true&&<NoelFx kind="fav"/>}
  </button>;};
 const addTile=(inPanel=false)=><button type="button" className="sb-app sb-app-add" aria-label={t("acirasidebar.addAFavorite")} title={nameAndNote(t("acirasidebar.addToFavoritesDAdds", { shortcut: formatShortcut('Ctrl Shift D') }))} aria-expanded={editing==='new'} onClick={event=>{/* the second press of a double-click on the stack, or any press within 450 ms of the open, is not a choice of the add tile that came up under the pointer */if(inPanel&&(event.detail>1||performance.now()-openedAt.current<450))return;/* the one exception to E6: the inline editor opens under the grid, where an open panel would cover it (Favorites at the bottom) or hang its fold pill over its title */if(inPanel)closePanel();setEditing(editing==='new'?null:'new');}} onKeyDown={moveFocus}>{inPanel?<PreviewIcon icon={Plus} size={14} className="sb-app-add-ico"/>:<LineIcon name="pin" size={14} className="sb-app-add-ico"/>}</button>;
 const front=stacked[0],stackNames=stacked.slice(0,STACK_PLATES).map(app=>app.title).join(', ');
 return <div className="sb-apps-region" data-rail={rail||undefined} data-panel={overflow?panel||undefined:undefined} data-bottom={place==='bottom'||undefined} onContextMenu={event=>{if((event.target as HTMLElement).closest('.sb-app,.sb-app-editor,.sb-apps-panel'))return;event.preventDefault();openBookmarkMenu(zoneRef('favorites'),{x:event.clientX,y:event.clientY,width:2,height:2});}}>
  <div ref={grid} className="sb-apps" role="toolbar" aria-label={t("acirasidebar.favorites")} aria-hidden={panel==='open'||useMiniRailFavorites&&miniPhaseHere==='rail'?true:undefined} inert={useMiniRailFavorites&&miniPhaseHere==='rail'?true:undefined} style={{'--sb-cols':cols} as CSSProperties} data-dropping={hint?'':undefined} data-stacked={overflow?'':undefined} {...dragProps}>
   {(()=>{const list=shown.map((app,index)=>tileFor(app,index));
    // A tab over the grid that would make a favorite: the tiles make room, an empty slot opens where the copy will land (the split).
    if(making)list.splice(Math.min(pin!.index,shown.length),0,<span key="gap" className="sb-app sb-app-slot sb-app-gap" aria-hidden="true"/>);
    return list;})()}
   {overflow&&front?<button ref={stackRef} type="button" className="sb-app sb-app-stack" data-stack-count={folded.length} data-folded={folded.map(app=>app.id).join(' ')} aria-current={frontId?'page':undefined} aria-haspopup="true" aria-expanded={panel==='open'}
     data-site={frontId&&colours[front.id]?'':undefined} style={frontId&&colours[front.id]?{'--site-h':colours[front.id]!.h,'--site-c':colours[front.id]!.c} as CSSProperties:undefined}
     aria-label={t("acirasidebar.favoritesStackLabel",{count:folded.length})} title={folded.length>STACK_PLATES?t("acirasidebar.favoritesStackTip",{names:stackNames,count:folded.length-STACK_PLATES}):stackNames}
     tabIndex={panel==='open'?-1:undefined}
     onClick={event=>{/* the keyboard's click has no pointer ('' pointerType); a mouse, touch or pen press names its own. Only an event that says nothing falls back to `detail` (0 for a click made by the keyboard) */const kind=(event.nativeEvent as {pointerType?:string}).pointerType;event.currentTarget.dataset.opener=(typeof kind==='string'?kind==='':event.detail===0)?'key':'pointer';if(!panel){noteUse('favoritesStackOpens');settled.current=false;openedAt.current=performance.now();setFavoritesPanelWanted(panelKey,true);}setPanel(previous=>previous?previous:'open');}} onKeyDown={moveFocus}
     onDragOver={event=>{if(!event.dataTransfer.types.includes(APP_TYPE))return;event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect='move';event.currentTarget.setAttribute('data-drop-over','');}}
     onDragLeave={event=>event.currentTarget.removeAttribute('data-drop-over')}
     onDrop={event=>{event.currentTarget.removeAttribute('data-drop-over');const appId=event.dataTransfer.getData(APP_TYPE);if(!appId)return;event.preventDefault();event.stopPropagation();setDrop(null);moveSidebarApp(profileId,privateMode,appId,apps.length-1);}}>
     <span className="sb-stack" data-count={Math.min(STACK_PLATES,stacked.length)} aria-hidden="true">{stacked.slice(0,STACK_PLATES).map((app,depth)=>{const plate=plates[app.id];return <span key={app.id} className="sb-stack-i" data-depth={depth}>
      <span className="sb-plate" data-plate={plate?.kind||'neutral'} data-ink={plate?.ink} data-full={plate?.full?'':undefined} data-shape={plate?.shape} data-edge={plate?.edge?'':undefined} style={plate?.rgb?{'--plate':plate.rgb} as CSSProperties:undefined}><AppIcon app={app} tab={tabOf(app)} stored={siteIcon(app.url)} reduced still/></span></span>;})}</span>
    </button>
    // The pin tile only fills a gap in the last row (never starts a row of its own) and shows on hover or focus.
    :rail||making||tiles%cols===0&&!hint&&editing!=='new'?null:addTile()}
   {/* Drop slots appear only while a tab is dragged over the grid; at rest the grid ends at the add tile. */}
   {!overflow&&hint&&!making&&Array.from({length:(cols-(tiles+1)%cols)%cols},(_,index)=><button key={'slot-'+index} type="button" tabIndex={-1} className="sb-app sb-app-slot" aria-hidden="true" onClick={()=>setEditing('new')}/>)}
  </div>
  {overflow&&panel&&<FavoritesPanel phase={panel} settled={settled.current} rows={rowsOfPanel} cols={cols} bottom={place==='bottom'} startRow={Math.floor(shown.length/cols)} count={apps.length} stack={stackRef} grid={grid} flyIds={flyIds} pace={pace} reduced={state.settings.reducedMotion} label={t("acirasidebar.favorites")} foldLabel={t("acirasidebar.foldFavorites")}
   onClose={closePanel} onClosed={()=>setPanel(false)} dragProps={dragProps}>
   {apps.map((app,index)=>tileFor(app,index,true))}{addTile(true)}
  </FavoritesPanel>}
  {useMiniRailFavorites&&<MiniFavColumn label={t("acirasidebar.favorites")} hidden={miniPhaseHere!=='rail'}>{apps.map(app=>{const tab=appTabFor(app,favoriteScope(state),profileId),active=tab?.id===state.activeTabId;return <button key={app.id} type="button" tabIndex={-1} className="sb-mini-fav" aria-current={active?'page':undefined} aria-label={app.title} title={app.title} onClick={event=>open(event,app)}><AppIcon app={app} tab={tab} stored={siteIcon(app.url)} reduced={state.settings.reducedMotion}/></button>;})}</MiniFavColumn>}
  <AnimatePresence initial={false}>{editing&&<AppEditor key={editing} tabs={favoriteScope(state)} app={apps.find(app=>app.id===editing)} tab={editing==='new'?undefined:favoriteTabOf(favoriteScope(state),editing,profileId)} current={current} profileId={profileId} privateMode={privateMode} reduced={state.settings.reducedMotion} dispatch={dispatch} onDone={id=>{setEditing(null);if(id)focusTile(id);}}/>}</AnimatePresence>
 </div>;
}

/** Local images only: a saved data URL, a bundled site icon, an open tab's live favicon, M's favicon store (kept on
 * this computer while you were on the site), else the initial. */
function AppIcon({app,tab,stored,reduced=false,still=false}:{app:SidebarApp;tab?:TabSession;stored?:string;reduced?:boolean;/** The stack's plates never show the loading matrix: it is the tile's signal. */still?:boolean}){
 const live=tab&&appHost(tab.url)===appHost(app.url)?tab.favicon:'';
 // Favorites are tiles only by default (Beta 14, H): no row shows that the page is loading, so the tile does, as a row does (useLoadingSignal: after 300ms, so a quick load never flashes it).
 const loading=useLoadingSignal(!still&&!!tab&&tabShowsLoading(tab));
 // The Link preview marker (item 17): while a preview is open from this favorite's tab, a card with the preview's site icon slides out beside the icon.
 const marker=<PeekMarkerCard tabId={tab?.id} size={14} reduced={reduced}/>;
 if(loading)return <><span className="sb-app-loading" aria-hidden="true"><DotMatrix preset="loader" size={16} reducedMotion={reduced}/></span>{marker}</>;
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

/** The two blocks the tab controller (SidebarTabs) hands its parts to. Each is a direct child of the sidebar's scroll region, so the blocks between them (Bookmarks, History…) never matter to the drag. */
type TabsParts={pinned:ReactNode|null;list:ReactNode};
const TabsPartsContext=createContext<TabsParts|null>(null);
function SidebarPinned({lead}:{lead:boolean}){const parts=useContext(TabsPartsContext);return parts?.pinned?<>{lead&&<div className="sb-sep" role="separator" data-flip="sep:pinned"/>}{parts.pinned}</>:null;}
function SidebarTabList({lead}:{lead:boolean}){const parts=useContext(TabsPartsContext);return parts?<>{lead&&<div className="sb-sep" role="separator" data-flip="sep:tabs"/>}{parts.list}</>:null;}

/** Pinned tabs (their own zone, no close), then the Tabs zone: New tab first (last when "New tabs at the top" is off),
 * then groups and loose tabs in tab order (a group sits where its first tab is; groups are not hoisted). */
function SidebarTabs({state,dispatch,tabs,openCount,groups,newTabsTop,folders='mixed',enabled=true,children}:{state:BrowserSnapshot;dispatch:Dispatch;tabs:TabSession[];/** Every tab open in this profile, the Favorites' tabs that live only in their tile too (the New tab button says how many are open). */openCount?:number;groups:{group:TabGroup;members:TabSession[]}[];newTabsTop:boolean;/** Where the groups sit among the tabs (Settings > Sidebar > Tab groups). */folders?:SidebarFolders;/** Beta 14 Customize sidebar: the tab list is drawn (Sidebar layouts). The Shelf has no tab list: the controller stays mounted (so the sections around it never remount on a layout switch) and does nothing. */enabled?:boolean;/** The sidebar's sections: the Pinned tabs block and the Tabs block are among them (SidebarPinned, SidebarTabList), wherever the person put them. */children?:ReactNode}){
 // Arc/Dia (reported 24 Oct): newest tabs first, right under the New tab row. A tab that was just appended is shown
 // at the top at once (the model is reordered a moment later), so it never flashes at the bottom first; a reopened
 // tab keeps its own place.
 const known=useRef<Set<string>|null>(null),closedBefore=useRef<Set<string>>(new Set()),topHolds=useRef<Map<string,NewTabHold>>(new Map()),reduced=state.settings.reducedMotion;
 // Settings keep a favorite's tab only in its tile: dragging the tile onto the tab list takes the tab out of it, into the list. The favorite stays, its tile loses the dot.
 const tileOnly=favoriteTabsOnlyInTile(state.settings);
 const tileOver=(event:DragEvent<HTMLElement>)=>{if(tileOnly&&event.dataTransfer.types.includes(APP_TYPE)){event.preventDefault();event.dataTransfer.dropEffect='move';}};
 const tileDrop=(event:DragEvent<HTMLElement>)=>{const appId=tileOnly?event.dataTransfer.getData(APP_TYPE):'';if(!appId)return;event.preventDefault();const profile=state.tabs.find(tab=>tab.id===state.activeTabId)?.browserProfileId??'',tab=favoriteTabOf(favoriteScope(state),appId,profile);if(tab)dispatch({type:'tab.favorite',id:tab.id,favoriteId:null});};
 // Where each split shows (docs/launch/SPLIT_IN_GROUPS.md): its card, inside its home pane's group when it has one. Its panes
 // show only there (28 Oct: no mirrors); a pinned pane is listed in the card, not among the pinned tabs.
 const {paneOf}=splitPlacements(state.windowUi.splitGroups,state.tabs,state.tabGroups);
 const isPinned=(tab:TabSession)=>tab.pinned&&!groupForTab(state,tab)&&!paneOf.has(tab.id);
 // Pinned folders (runtime/pinnedFolders.ts): the tabs of a folder in the Pinned block are drawn there, with their folder.
 const inFolder=(tab:TabSession)=>inPinnedFolder(state,tab);
 const pinnedTabs=tabs.filter(isPinned),pinnedFolderTabs=tabs.filter(inFolder),restTabs=tabs.filter(tab=>!isPinned(tab)&&!inFolder(tab));
 const looseTabs=restTabs.filter(tab=>!groupForTab(state,tab)),previousIds=known.current;
  // `fresh` just arrived; `waiting` were moved a moment ago and the model has not caught up (newTabHold.ts: a state that arrives first must not draw the row at the bottom).
  const {fresh,waiting,appended}=newTabsAtTop(looseTabs,previousIds,closedBefore.current,tabs,topHolds.current,performance.now(),newTabsTop);
 useEffect(()=>{if(!enabled){known.current=null;topHolds.current.clear();return;}const previous=known.current;known.current=new Set(tabs.map(tab=>tab.id));closedBefore.current=new Set([...state.closedTabs,...(state.closedPrivateTabs??[])].map(tab=>tab.id));if(!previous||!newTabsTop){topHolds.current.clear();return;}if(!fresh.length)return;
  const oldTop=restTabs.find(tab=>previous.has(tab.id)&&!appended.includes(tab))?.id;if(!oldTop)return;
  for(const move of planMoves(topHolds.current,fresh,frontOf(waiting,oldTop),performance.now(),known.current))dispatch({type:'tab.drop',from:move.from,to:move.to,position:'before',groupId:null});
 },[tabs.map(tab=>tab.id).join(),newTabsTop,enabled]);// eslint-disable-line react-hooks/exhaustive-deps
 // Ctrl/Cmd held: the figure each row answers to (ui/tabNumbers.ts); null the rest of the time.
 const numbers=useTabNumbers(state);
 const list=useRef<HTMLDivElement>(null),pinned=useRef<HTMLDivElement>(null),[dragging,setDragging]=useState<string|null>(null),[hint,setHint]=useState<{id:string;position:'before'|'after';/** The line sits at the top level though its row is inside a folder (a tab leaving it at its end). */out?:boolean}|{group:string}|null>(null);
 const ordered=[...[...appended].reverse(),...restTabs.filter(tab=>!appended.includes(tab))];
 // Free splits are entries of their own; a split in a group is one of that group's rows (sidebarRows.ts).
 const {entries,groupRows,visibleTabs,folderCount,looseCount}=sidebarRows(state,ordered,groups,folders);
 const pinnedRows=sidebarRows(state,pinnedFolderTabs,groups,'mixed'),pinnedFolders=pinnedRows.entries.flatMap(entry=>entry.kind==='group'?[entry]:[]);
 const folderRowIds=new Set(pinnedRows.visibleTabs([]).map(tab=>tab.id)),visible=[...tabs.filter(tab=>isPinned(tab)||folderRowIds.has(tab.id)),...visibleTabs([])];
 // Beta 14 (section M): the folders' automatic colours, settled for all of them at once so neighbours do not look alike.
 const autoColors=useGroupAutoColors([...pinnedFolders,...entries].flatMap(entry=>entry.kind==='group'?[{group:entry.group,members:entry.members},...entry.inner]:[]));
 // Tab drags are pointer drags with capture: they keep tracking over the native page, which HTML drag-and-drop
 // cannot see. Inside the sidebar they reorder, pin over Favorites or save over Bookmarks; over the right of the page
 // they split view after the strip's 450ms dwell (src/ui/splitDrop.ts). In the sidebar a split can never arm.
 const latest=useRef({state,dispatch});latest.current={state,dispatch};
 const drag=useRef<{id:string;/** Which row: a linked tab has two (its group row, its card row). */key:string;/** Grabbed in a split's card (a pane row), not by a group row of the same tab. */card:boolean;x:number;y:number;pointer:number;moved:boolean;node:HTMLElement;off:()=>void;chip?:ReturnType<typeof carryChip>;rowPreview?:ReturnType<typeof carrySidebarRow>;release?:()=>void;full?:boolean;split?:SplitGroup;/** A whole tab group carried by its header: it goes to a workspace, or (Beta 14, AE) to a new place in the list: reordered, nested inside another group, taken out. */group?:TabGroup;carry?:GroupCarry;/** The group folded as it was lifted; it opens again where it lands. */ngReopen?:boolean}|null>(null),suppressClick=useRef(false);
 const hintFor=(action:BrowserAction|null)=>action?.type==='tab.drop'||action?.type==='split.separate'?action.to&&action.position?{id:action.to,position:action.position}:action.groupId?{group:action.groupId}:null:null;
 /** The drop under the pointer, tested in the list as it lies with the carried row's place closed and no room open (sidebarTabDrag.ts `reach`): what the person sees under the pointer is what is tested.
  *  Inside the slot that is open the last decision stands. */
 const lastDrop=useRef<BrowserAction|null|undefined>(undefined),lastPoint=useRef<{x:number;y:number}|null>(null);
 const listDrop=(preview:RowPreview|undefined,point:{x:number;y:number},id:string)=>{
  const {state}=latest.current,reach=preview?.reach(point);
  // Inside the slot that is open the last decision stands (or, at the start, the carried tab stays where it is); at a folder's end the slot's lower part takes the tab out.
  if(preview&&reach===null){const slot=preview.slot(),last=lastDrop.current===undefined?stayDrop(id,state.tabs,state.tabGroups):lastDrop.current,flip=slot?folderEndFlip(last,state.tabs,state.tabGroups,point.y,slot):null;return lastDrop.current=flip??last;}
  // Pinned tabs and Tabs are two blocks and every tab is tested over both (pinned folders, decision 4): a loose tab dropped among the pinned rows pins, a pinned one dropped among the list's rows unpins, either dropped on a folder joins it.
  const roots=[pinned.current,list.current].filter(Boolean);
  return lastDrop.current=roots.map(root=>tabDropAtPoint(root,point,id,state.tabs,state.tabGroups,true,undefined,preview?.closed,reach??point)).find(Boolean)??null;
 };
 /** The blue line, from the same place the slot and the room use (dropPlace): on the row the drop lands beside; for a tab leaving its folder, on the row next to the folder's edge at the top level. */
 const hintOf=(raw:BrowserAction|null,over:BrowserAction|null):{id:string;position:'before'|'after';out?:boolean}|{group:string}|null=>{
  const where=dropPlace(raw,latest.current.state.tabs,latest.current.state.tabGroups);
  if(!where||over?.type==='split.separate')return hintFor(over);
  if(where.kind==='join')return {group:where.group};
  if(where.anchor==='tab')return {id:where.id,position:where.position};
  if(where.position==='after')return {id:where.to,position:'after',out:true};
  const header=list.current?.querySelector<HTMLElement>(`.sb-group-header[data-group-header="${CSS.escape(where.id)}"]`),previous=header?.closest('.sb-group')?.previousElementSibling as HTMLElement|null|undefined;
  if(previous?.classList.contains('sb-tab')&&previous.dataset.tabId)return {id:previous.dataset.tabId,position:'after'};
  const last=previous?.classList.contains('sb-group')?[...previous.querySelectorAll<HTMLElement>('.sb-tab[data-tab-id]')].at(-1):undefined;
  return last?.dataset.tabId?{id:last.dataset.tabId,position:'after',out:true}:null;
 };
 const setHintIf=(next:ReturnType<typeof hintFor>)=>setHint(previous=>JSON.stringify(previous)===JSON.stringify(next)?previous:next);
 // A sidebar that hides mid-drag (a peeking one closes as soon as the pointer is over the page) unmounts this list, but a drag that has
 // moved is not the list's to end: its window listeners run to the release, the carried icon stays under the pointer and the split
 // picker takes the drop (reported 31 Oct: the icon vanished and the picker was stuck).
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
 /** A pane dragged out of its split card (reported 28 Oct: "drag a tab out of a split even if it is inside a group") leaves the
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
  *  row never moved (reported 30 Oct). */
 const besideCard=(action:BrowserAction|null):BrowserAction|null=>{
  if(action?.type!=='tab.drop'||!action.to)return action;
  const {state}=latest.current,split=state.windowUi.splitGroups?.find(group=>group.tabIds.includes(action.to!));
  if(!split||split.tabIds.includes(action.from))return action;
  const members=state.tabs.filter(tab=>split.tabIds.includes(tab.id)),anchor=action.position==='after'?members.at(-1):members[0];
  return anchor?{...action,to:anchor.id}:action;
 };
 const startDrag=(event:PointerEvent<HTMLElement>,tab:TabSession,split?:SplitGroup,card=false,rowId=tab.id,group?:TabGroup)=>{
  if(event.button!==0||(event.target as HTMLElement).closest('.sb-tab-close,.sb-tab-action,.sb-header-add'))return;
  // Beta 14.0 (reported 20 Nov): the Mini rail carries no drag: a press and a move on a rail icon lifts, ghosts and reorders nothing (a click still selects, the middle and right buttons keep their jobs).
  if(miniRailShown(latest.current.state))return;
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
    const groupId=current.group.id,reopen=()=>{if(current.ngReopen)latest.current.dispatch({type:'tab.group.update',id:groupId,keepActive:true,patch:{collapsed:false}});};
    markWorkspaceDrop(null);setHint(null);window.setTimeout(()=>{suppressClick.current=false;},0);
    if(target&&!refused){dispatch({type:'workspace.move-group',groupId,workspaceId:target});if(current.carry)current.carry.abort(reopen,()=>{setGroupCarryOverPage(false);setDragging(null);});else{reopen();setDragging(null);}return;}
    // Beta 14 (AE): dropped in the list, the chip settles into the gap where the rows opened a place (reordered, nested, taken out); Esc or a drop that changes nothing plays the pick-up back.
    if(current.carry){current.carry.land(commit&&inSidebar,action=>{holdFlip(true);dispatch(action);},reopen,()=>{holdFlip(false);setGroupCarryOverPage(false);setDragging(null);});return;}
    reopen();setGroupCarryOverPage(false);setDragging(null);return;
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
   else if(!adding)current.rowPreview?.end(destination?document.querySelector<HTMLElement>(`[data-ws="${CSS.escape(destination)}"]`):null,Boolean(destination||split||commit&&point&&inSidebar&&!bookmarkZone&&appsIndexAt(point)===null&&listDrop(current.rowPreview,listPoint(point),current.id)),Boolean(split));
   current.chip?.end(Boolean(split));
   if(!commit)cancelSplitDrag();
   if(split){/* D191: the rows go into the new split's card where the drop puts them; the FLIP played them over each other for half a second (Dark over Video over Heavy, one place) */skipNextFlip();dispatch(split);}
   else if(commit&&point&&workspaceDropAt(point))dispatch({type:'workspace.move-tabs',tabIds:[current.id],workspaceId:workspaceDropAt(point)!});/* R3-57: dropped on a workspace's icon */
   else if(commit&&point&&inSidebar){const at=appsIndexAt(point),owner=state.tabs.find(item=>item.id===current.id);
    if(at!==null&&owner){const profile=state.browserProfiles.find(item=>item.id===owner.browserProfileId);pinTab(owner,at,state,!!profile?.private,dispatch,adding?current.rowPreview:null);}
    else if(owner&&overBookmarks(point))saveToBookmarks(owner,state,dispatch,bookmarkBefore);
    else{const action=paneDrop(besideCard(lastDrop.current!==undefined&&lastPoint.current&&Math.hypot(point.x-lastPoint.current.x,point.y-lastPoint.current.y)<2?lastDrop.current:listDrop(current.rowPreview,listPoint(point),current.id)),current.id,current.card);if(action){skipNextFlip();dispatch(action);}}}
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
   limit:node=>{const tabs=[pinned.current,list.current].reduce<DOMRect|null>((box,part)=>{const rect=part?.getBoundingClientRect();return rect&&(!box||rect.bottom>box.bottom)?rect:box;},null);return {min:0,max:tabs?node.scrollTop+tabs.bottom-node.getBoundingClientRect().bottom:Infinity};},
   onStep:()=>{if(lastMove&&drag.current?.moved)move(lastMove);}});
  const move=(next:globalThis.PointerEvent)=>{
   const current=drag.current;if(!current||next.pointerId!==current.pointer)return;
   // An unmoved drag whose release never reached the window (a blur no longer ends it): the first move with no button down ends it, so a hover never carries a tab.
   if(!current.moved&&next.pointerType==='mouse'&&next.buttons===0){finish(false);return;}
   if(!current.moved){if(Math.hypot(next.clientX-current.x,next.clientY-current.y)<5)return;current.moved=true;suppressClick.current=true;if(!current.group)setTabDragActive(true);/* D191: the page's still is taken as the tab is lifted (the page is live under the sidebar), so it is in when the pointer reaches the page */if(!current.group&&!current.split)primeSplitStills(current.id);current.release=holdPointer(list.current,current.pointer);setDragging(current.split?'split:'+current.split.id:current.key);}
   const {state}=latest.current,point={x:next.clientX,y:next.clientY},edge=sidebarEdge(),inSidebar=!!list.current&&overSidebar(point.x,edge,side);
   lastMove=next;if(inSidebar)scrollEdge.update(point.y);else scrollEdge.stop();
   // A group goes one place: a workspace's icon. Its folder leaves the header as a chip at once (the edge is far off on the sidebar's own side), with its tab count.
   if(current.group&&inSidebar&&list.current&&!workspaceDropAt(point)){
    // Beta 14 (AE): inside the list a carried group is the sample's chip (groupCarry.ts) with its drop shown by a gap (the rows open a place) and the group it would nest into washed in its colour.
    const group=current.group;
    if(!current.carry){
     const wasOpen=!group.collapsed;current.ngReopen=wasOpen;
     // The group folds as it lifts (the current tab stays under its header); the carry measures the list once the fold is in the page.
     if(wasOpen)latest.current.dispatch({type:'tab.group.update',id:group.id,keepActive:true,patch:{collapsed:true}});
     // The page's stills are taken now, so they are in when the pointer reaches the page (the page yields to the chip with no gap).
     requestSplitStills([latest.current.state.activeTabId]);
     current.carry=carryGroupRow({block:current.node.closest<HTMLElement>('.sb-group')!,list:list.current,pinned:pinned.current,grab:{x:current.x,y:current.y},group,state,wasOpen,bounds:()=>document.querySelector('.acira-sidebar')?.getBoundingClientRect()});
    }
    current.chip?.end();current.chip=undefined;markWorkspaceDrop(null);
    current.carry.suspend(false);current.carry.free(false);setGroupCarryOverPage(false);current.carry.move(point);return;
   }
   // Over a workspace's icon (the workspace chip is drawn) or over the page the group has no drop in the list: the room closes, the chip rests (over the page) or gives way to the workspace chip.
   if(current.group&&current.carry){const over=!!list.current&&!!workspaceDropAt(point),page=!inSidebar&&!over;current.carry.suspend(true,over);current.carry.free(page);setGroupCarryOverPage(page);current.carry.move(point);
    // Not over a workspace's icon: the carry's chip is the only chip (the workspace chip is for the icons; over the page it would be drawn over the carry's).
    if(!over){current.chip?.end();current.chip=undefined;markWorkspaceDrop(null);return;}}
   if(current.group){const group=current.group;current.chip??=carryChip(current.node,'.sb-group-folder',{side,only:item=>!!item.node?.dataset.ws,icon:groupFolderChip(current.node),badge:String(groupMembers(state,group).length),color:getComputedStyle(current.node.querySelector('.sb-group-folder')??current.node).color});current.chip.move(point,stuck);markWorkspaceDrop(point,dropNote({kind:'group',id:group.id}));return;}
   // A split row stays a row: it never splits again over the page, pins or saves; it only moves (or goes to a workspace).
   if(current.split){current.chip??=carryChip(current.node,'.split-group-open>svg',{side});current.chip.move(point,workspaceDropAt(point)?stuck:edge);/* over a workspace's icon the chip forms and sticks to it, as a tab's does */markWorkspaceDrop(point,dropNote({kind:'tabs',ids:current.split.tabIds}));setHintIf(inSidebar?hintFor(splitMoveAt(listPoint(point),current.split)?.drop??null):null);return;}
   // Out of the sidebar the row travels as its icon chip, free in 2D, with one tab or many (R3-23).
   current.rowPreview??=carrySidebarRow(current.node,(current.node.closest('.sb-pinned')?pinned.current:list.current)!,{x:current.x,y:current.y},state.activeWorkspaceId,{also:current.node.closest('.sb-pinned')?list.current:pinned.current});
   moveSplitDrag(current.id,point,!inSidebar&&state.tabs.length>1);// B's snap layouts take a 3rd and 4th pane, as from the strip
   const at=inSidebar?appsIndexAt(point):null,saving=inSidebar&&at===null&&overBookmarks(point),owner=state.tabs.find(item=>item.id===current.id);
   const newBookmark=saving&&owner&&isWeb(owner)&&bookmarkControl(state,owner).available&&!state.bookmarkNodes.some(node=>node.browserProfileId===owner.browserProfileId&&node.url&&pageKey(node.url)===pageKey(owner.url)&&!!node.tor===(owner.privacy==='tor'));
   // Over Favorites with a page that is not a favorite yet: a copy will go up, so the tab stays as it is and the tiles make room (the split).
   const newFavorite=at!==null&&!!owner&&(isWeb(owner)||owner.url.startsWith('acira://'))&&planFavorite({profileId:owner.browserProfileId,privateMode:!!state.browserProfiles.find(item=>item.id===owner.browserProfileId)?.private,url:owner.url,tab:owner,tabs:favoriteScope(state)}).kind==='add';
   setPinHint(at===null?null:{index:at,adding:newFavorite});setBookmarkHint(Boolean(newBookmark));markWorkspaceDrop(point,dropNote({kind:'tabs',ids:[current.id]}));
   let raw=inSidebar&&at===null&&!saving?listDrop(current.rowPreview,listPoint(point),current.id):null,over=raw?paneDrop(besideCard(raw),current.id,current.card):null;lastPoint.current=point;
   // E8 (17 Nov): over Favorites the carried row is the icon chip (the row area counts the Favorites grid, so it stayed a pill there).
   const preview=current.rowPreview;
   current.full=carriedAsPill({overFavorites:at!==null,saving,inRowArea:()=>sidebarRowArea(point,current.node.closest<HTMLElement>('.acira-sidebar'),current.full??true,preview.bounds)});
   // A slot opens among the saved pages only for a page not saved yet (a drop there saves it; a saved one stays as it is).
   current.rowPreview.move(point,current.full,over,newBookmark?document.querySelector<HTMLElement>('.acira-sidebar [data-zone=bookmarks]'):null,newFavorite,dropPlace(raw,state.tabs,state.tabGroups));
   // The slot the decision opened is where the rows lie now: test the pointer against it once more, so what is shown is what a release here does.
   if(raw){const again=listDrop(current.rowPreview,listPoint(point),current.id);if(JSON.stringify(again)!==JSON.stringify(raw)){raw=again;over=raw?paneDrop(besideCard(raw),current.id,current.card):null;current.rowPreview.move(point,current.full,over,null,newFavorite,dropPlace(raw,state.tabs,state.tabGroups));}}
   // D38: one drop mark: the slot where the row will land; the blue line only where there is no room for a slot.
   {const mark=hintOf(raw,over);setHintIf(mark&&'id' in mark&&current.rowPreview.slot()?null:mark);}
   // A linked copy dragged out of its card can only leave the split (its tab keeps its place in its group), so no drop line is drawn for
   // it: the row says so instead ("Remove from split view" in place of its title) until it is over a drop that really lands somewhere else.
   current.node.closest('.sb-split-group')?.toggleAttribute('data-leaving',over?.type==='split.separate'&&!!state.windowUi.splitGroups?.some(group=>group.linked?.includes(current.id)));
  };
  const up=(next:globalThis.PointerEvent)=>{if(drag.current&&next.pointerId===drag.current.pointer)finish(true,{x:next.clientX,y:next.clientY});};
  const cancel=(next:globalThis.PointerEvent)=>{if(drag.current&&next.pointerId===drag.current.pointer)finish(false);};
  // E7 (17 Nov): a press-select hands the page its keyboard a few ms after the press (main waits for the release now, desktop/page-focus.cjs), and the window blur that came with it ended a drag that had not moved yet: a tab could not be dragged until it was selected. A blur ends a drag once it has moved.
  const blur=()=>{if(drag.current?.moved)finish(false);};
  const key=(next:globalThis.KeyboardEvent)=>{if(next.key==='Escape'&&drag.current?.moved){next.preventDefault();next.stopPropagation();finish(false);}};
  window.addEventListener('blur',blur);window.addEventListener('pointermove',move);window.addEventListener('pointerup',up);window.addEventListener('pointercancel',cancel);window.addEventListener('keydown',key,true);
  const off=()=>{scrollEdge.stop();window.removeEventListener('blur',blur);window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);window.removeEventListener('pointercancel',cancel);window.removeEventListener('keydown',key,true);};
  drag.current?.off();lastDrop.current=undefined;drag.current={id:tab.id,key:rowId,card,x:event.clientX,y:event.clientY,pointer:event.pointerId,moved:false,node:event.currentTarget,off,...(split?{split}:{}),...(group?{group}:{})};
 };
 // Motion is compositor-only (founder: the sidebar must never lag): rows never animate height. The scroll region's
 // FLIP pass (useFlip) slides rows that moved with transform, fades new rows in and fades a ghost of a closed row out.
 const moveBy=(tab:TabSession,direction:-1|1)=>{const at=visible.findIndex(item=>item.id===tab.id),target=visible[at+direction];if(!target)return;skipNextFlip();dispatch({type:'tab.drop',from:tab.id,to:target.id,position:direction<0?'before':'after',groupId:groupForTab(state,target)?.id??null});};
 // A linked tab (reported 28 Oct) has two rows: its own in the group (`link`: also in that split) and a copy in the split's card
 // (`copy`: × removes it from the split, a drag out only leaves the split). They share the tab id, so the copy has its own keys.
 const row=(tab:TabSession,options:{pinned?:boolean;hidden?:boolean;pane?:SplitGroup;link?:SplitGroup;copy?:boolean}={})=>{const rowKey=options.copy?'link:'+tab.id:tab.id;return <TabRow key={rowKey} tab={tab} state={state} dispatch={dispatch} pinned={options.pinned} hidden={options.hidden} pane={options.pane} link={options.link} copy={options.copy} number={options.copy||options.hidden?undefined:numbers?.figures.get(tab.id)} numberLeaving={numbers?.leaving||undefined} numberTyped={options.copy||options.hidden||!numbers||numbers.typed===null?undefined:(numbers.figures.get(tab.id)!==undefined&&tabNumberMatches(numbers.figures.get(tab.id)!,numbers.typed)?'match':'other')} dragging={dragging===rowKey} hint={!options.copy&&hint&&'id' in hint&&hint.id===tab.id?hint.position:undefined} hintOut={!options.copy&&!!hint&&'id' in hint&&hint.id===tab.id&&hint.out} onMove={direction=>moveBy(tab,direction)} onClose={()=>dispatch(options.copy?{type:'split.separate',tabId:tab.id}:{type:'tab.close',id:tab.id})} onPointerDown={event=>startDrag(event,tab,undefined,!!options.pane,rowKey)}/>;};
 // A split row and its panes; inside a group it is one of the group's members (indented, in the group's colour).
 const splitBlock=(split:SplitGroup,members:TabSession[],nestedIn?:TabGroup,hidden=false)=><SidebarSplit key={split.id} state={state} dispatch={dispatch} split={split} members={members} reduced={reduced} row={row} focusFrom={moveFocus} nestedIn={nestedIn} hidden={hidden} dragging={dragging==='split:'+split.id} onPointerDown={event=>{const anchor=state.tabs.find(tab=>split.tabIds.includes(tab.id));if(anchor&&(event.target as HTMLElement).closest('.split-group-parent'))startDrag(event,anchor,split);}} openMenu={(node,pointer)=>{const lead=members.find(tab=>tab.id===split.lastActiveTabId)||members[0];if(lead)popup(state,'split-context',node,lead.id,pointer);}}/>;
 // A tab of a pinned folder is drawn as a pinned row (its x puts it to sleep and it stays: runtime/pinnedClose.ts).
 const groupChildren=(group:TabGroup,members:TabSession[])=>groupRows(group,members).map(item=>item.kind==='tab'?row(item.tab,{hidden:item.hidden,link:item.link,pinned:groupPinned(state,group)}):splitBlock(item.split,item.members,group,item.hidden));
 // The open-tab count sits at the row's end (reported 25 Oct: kept, but not as a header of its own); Ctrl+T takes its
 // place on hover.
 const newTab=<button key="new-tab" className="sb-new-tab" data-flip="new-tab" data-sb-focus onContextMenu={event=>{event.preventDefault();event.stopPropagation();popup(state,'strip-context',event.currentTarget,undefined,event);}} aria-label={t("acirasidebar.newTabCountOpen", { count: openCount ?? tabs.length })} onKeyDown={moveFocus} onClick={()=>dispatch({type:'tab.new'})}><span className="sb-tab-icon"><PreviewIcon icon={Plus} size={14}/></span><span className="sb-new-label">{t("browsermenu.newTab")}</span><span className="sb-new-end" aria-hidden="true"><kbd>{formatShortcut('Ctrl T')}</kbd></span></button>;
 // Groups in an area of their own (item 14): a line is the area's edge, as it is for the zones (no header, founder 25 Oct).
 type GroupEntry=Extract<ReturnType<typeof sidebarRows>['entries'][number],{kind:'group'}>;
 const groupNode=(entry:GroupEntry,pinnedFolder=false)=><SidebarGroup key={entry.group.id} pinnedFolder={pinnedFolder} group={entry.group} members={entry.members} family={entry.inner.flatMap(item=>item.members)} state={state} dispatch={dispatch} showMembers auto={autoColors.get(entry.group.id)} joining={!!hint&&'group' in hint&&hint.group===entry.group.id} dragging={dragging==='group:'+entry.group.id} onPointerDown={event=>{const lead=[...entry.members,...entry.inner.flatMap(item=>item.members)].find(tab=>tab.id===entry.group.lastActiveTabId)||entry.members[0]||entry.inner[0]?.members[0];if(lead)startDrag(event,lead,undefined,false,'group:'+entry.group.id,entry.group);}}>{groupChildren(entry.group,entry.members)}{entry.inner.map(inner=>
    <SidebarGroup key={inner.group.id} nested folded={!!entry.group.collapsed} group={inner.group} members={inner.members} state={state} dispatch={dispatch} showMembers auto={autoColors.get(inner.group.id)} joining={!!hint&&'group' in hint&&hint.group===inner.group.id} dragging={dragging==='group:'+inner.group.id} onPointerDown={event=>{const lead=inner.members.find(tab=>tab.id===inner.group.lastActiveTabId)||inner.members[0];if(lead)startDrag(event,lead,undefined,false,'group:'+inner.group.id,inner.group);}}>{groupChildren(inner.group,inner.members)}</SidebarGroup>)}</SidebarGroup>;
 const listed:ReactNode[]=entries.map(entry=>entry.kind==='tab'?row(entry.tab):entry.kind==='split'?splitBlock(entry.split,entry.members):groupNode(entry));
 if(folders!=='mixed'&&folderCount>0&&looseCount>0)listed.splice(folders==='above'?folderCount:looseCount,0,<div key="sep-folders" className="sb-sep" role="separator" data-flip="sep:folders"/>);
    const body=[...(newTabsTop?[newTab]:[]),<LiveFolder key="live-folder" state={state} dispatch={dispatch} moveFocus={moveFocus}/>,...listed,...(newTabsTop?[]:[newTab])];
 if(!enabled)return <TabsPartsContext.Provider value={null}>{children}</TabsPartsContext.Provider>;
 // Two blocks of the sidebar's list (Customize sidebar): the pinned tabs, and the New tab row with the groups and loose tabs. They share this one controller (the drag, the hints, the keyboard), so a tab carried from one lands in the other's reach.
 const wrap={'data-dragging':dragging?'':undefined,onClickCapture:(event:MouseEvent<HTMLElement>)=>{if(suppressClick.current){event.preventDefault();event.stopPropagation();}}};
 const pinnedItems=[...pinnedTabs.map(tab=>({at:tabs.indexOf(tab),node:row(tab,{pinned:true})})),...pinnedFolders.map(entry=>({at:Math.min(...[...entry.members,...entry.inner.flatMap(item=>item.members)].map(tab=>tabs.indexOf(tab))),node:groupNode(entry,true)}))].sort((a,b)=>a.at-b.at);
 const pinnedBlock=pinnedItems.length>0?<div ref={pinned} className="sb-pinned sb-tabs" role="list" aria-label={t("acirasidebar.pinnedTabs")} {...wrap}>{pinnedItems.map(item=>item.node)}</div>:null;
 // No header (reported 25 Oct): the separator above is the zone's edge and New tab is its first row. One flat keyed list per zone, so a close never remounts the rows around it.
 const listBlock=<div ref={list} className="sb-tabs" {...wrap}><section className="sb-zone" data-zone="tabs" aria-label={t("acirasidebar.tabs")} onDragOver={tileOver} onDrop={tileDrop}><div className="sb-zone-body" role="list">{body}</div></section></div>;
 return <TabsPartsContext.Provider value={{pinned:pinnedBlock,list:listBlock}}>{children}</TabsPartsContext.Provider>;
}

/** FLIP for the scroll region (bible §3.9: premium and fast, drawn on the GPU with transform and opacity only). After
 * each render every [data-flip] row that moved settles from where it was on a critically damped spring (no overshoot);
 * rows that arrive rise 4px and scale up from 98% at their left edge, staggered 16ms (at most 64ms) so a zone unfolds
 * as one layered reveal; a row that leaves is drawn once more where it was and fades out with a slight shrink, on the
 * exit curve at about two-thirds of the enter time. Keyboard moves skip a pass (no motion on keyboard moves).
 * Positions are in content coordinates, so scrolling never animates; a sticky zone header is measured at its section. */
let flipSkip=false,flipHold=false;
const skipNextFlip=()=>{flipSkip=true;};
/** Beta 14 (AE, item24 sample): while a carried group lands, its drag owns the motion (the rows are already where the drop puts them). */
const holdFlip=(on:boolean)=>{flipHold=on;};
/** 1-(1+wt)e^(-wt), w=9.3, sampled 24 times: a critically damped spring that settles by t=1 with no overshoot. */
// The tab strip's spring (B 28bee146: stiffness 360, damping 38, critically damped), sampled for the compositor; the
// sidebar moves on the same feel and timing as the strip.
const SPRING=stripEase,springMs=()=>stripMs*frequentStretch(classScale(motionSpeed(),'S'));
// The fold's fade starts as fast as the unfold's does (R4-32): the old exit curve (.4,0,1,1) held the rows at full ink for the first
// third and then dropped them at once, which read as "stuck" and then "gone".
const EXIT='cubic-bezier(.16,1,.3,1)';
type FlipBox={el:HTMLElement;top:number;left:number;width:number;height:number;nested:boolean};
function useFlip(root:{current:HTMLDivElement|null},reduced:boolean,space:string){
 const last=useRef<Map<string,FlipBox>>(new Map()),baseline=useRef(0),ghosts=useRef(new Map<string,HTMLElement>()),slides=useRef(new Map<string,{anim:Animation;from:number}>()),shownSpace=useRef(space);
 // 14.3 Tab size (D152 follow-up): the rows' places are measured in the render that changes the setting, before App puts the size on the root; the list then changes its spacing by CSS alone and
 // the cache kept the old one, so the next change (a Mini collapse, a tab opening) slid every row from where it was at the OLD size (Large: 6 px per row, 190 px at the bottom of the list, in one frame).
 // The cache says which size it was measured at; a render under another size measures again and moves nothing.
 const measuredSize=useRef<string|null>(null);
 useLayoutEffect(()=>{
  const switched=shownSpace.current!==space;shownSpace.current=space;
  const box=root.current;if(!box){last.current=new Map();return;}
  // Layout positions (the offset chain inside the scroll box), which a running slide does not change. This runs on
  // every render, and pages loading re-render often: measured from painted rects, a row mid-slide read as moved and
  // its slide restarted or nudged (the "sometimes jerky").
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
  if(!last.current.size){flipSkip=false;if(!baseline.current)baseline.current=requestAnimationFrame(()=>{baseline.current=0;if(root.current===box&&!last.current.size){last.current=measure();measuredSize.current=document.documentElement.getAttribute('data-tab-size')||'';}});return;}
  const next=measure(),previous=last.current;last.current=next;
  const size=document.documentElement.getAttribute('data-tab-size')||'',sizeChanged=measuredSize.current!==null&&measuredSize.current!==size;measuredSize.current=size;
  if(sizeChanged)return;
  // Another workspace or profile's space came on screen: the list is replaced, not changed, and the switch's own slide carries it
  // (useWorkspaceSlide). Played as a change, the last space's rows faded out as pictures over the new ones while every new row dropped
  // into a slot (reported 3 Nov: "it glitches, then gets good"). The new list stands at once; nothing of the last one stays behind.
  if(switched){for(const anim of box.getAnimations({subtree:true}))if(anim.id==='sb-flip'||anim.id==='sb-arrive')anim.cancel();box.querySelectorAll(':scope>.sb-flip-ghosts').forEach(node=>node.remove());ghosts.current.clear();slides.current.clear();flipSkip=false;return;}
  // Speed Off (or reduced motion): a fold or an unfold is instant, nothing is left to fade.
  if(flipSkip||flipHold||reduced||!previous.size||!springMs()){flipSkip=false;return;}
  const arrivals:(FlipBox&{key:string})[]=[],moves:{key:string;el:HTMLElement;dy:number;from:number;was:number;top:number;height:number}[]=[];let slide=0;
  for(const [key,item] of next){
   const was=previous.get(key);
   if(!was){arrivals.push({...item,key});continue;}
   const dy=was.top-item.top;if(Math.abs(dy)<=.5||item.el.closest('[data-stuck]'))continue;
   slide=Math.max(slide,dy);
   // A row still sliding from the last change starts its new slide from where it is drawn now: no jump on a quick
   // second move.
   let drawn=0;for(const anim of item.el.getAnimations())if(anim.id==='sb-flip'){drawn=new DOMMatrixReadOnly(getComputedStyle(item.el).transform).m42;anim.cancel();}
   moves.push({key,el:item.el,dy,from:dy+drawn,was:was.top,top:item.top,height:item.height});
  }
  // Rows leaving (a fold, a closed tab): drawn once more where they were, as pictures (see below).
  // 14.1 (reported 21 Nov): a row that leaves while it still slides from the last change (a second close in quick succession) is drawn `off` px from its
  // layout place; its picture starts there, where it was on the last frame, not at the layout place (a picture a row away from its row, over its neighbour).
  // A slide's offset is read from its own animation: the element has gone, the animation and its progress have not.
  const offsetOf=(key:string)=>{const running=slides.current.get(key);return running?slideOffset({from:running.from,playState:running.anim.playState,progress:running.anim.effect?.getComputedTiming().progress}):0;};
  const leaving=[...previous].filter(([key])=>!next.has(key)).map(([key,was])=>({key,was,off:offsetOf(key)})).sort((a,b)=>a.was.top+a.off-(b.was.top+b.off));
  for(const key of [...slides.current.keys()])if(!next.has(key))slides.current.delete(key);
  // A fold (a section, a folder or a group closing; anything but one closed tab) is the unfold played back (foldMotion.ts): the
  // rows below wait until the lowest leaving row has faded, then glide up with the section's edge, in step with the fade.
  // Beta 14.0, a LAYOUT SWITCH that replaces the list's rows (Sidebar <-> Tabs on top + sidebar; listSwitchMotion.ts): never two lists at once. The rows only the old list has fade where they stand first,
  // the rows both have glide after them, each row only the new list has comes in once no gliding row is over its place. Only while a layout switch plays (the root says so) and rows leave in the same render
  // as rows arrive or move: a tab opening or closing, a fold, a workspace switch and Customize keep the motion below exactly as it was.
  const html=document.documentElement;
  const switching=(html.dataset.modeSwitch==='morph'||html.dataset.modeSwitch==='layout')&&leaving.length>0&&(arrivals.length>0||moves.length>0);
  const arriving=switching?[...arrivals].sort((a,b)=>a.top-b.top):[];
  const turns=switching?listSwitchPlan(moves.map(move=>({was:move.was,top:move.top,height:move.height})),arriving.map(item=>({top:item.top,height:item.height})),springMs(),springMs()/(stripMs||1)):null;
  const fold=!switching&&leaving.length&&(leaving.length>1||!leaving[0].was.el.matches('.sb-tab'))?foldPlan(leaving.map(({was})=>({top:was.top,height:was.height})),slide,springMs()):null;
  // Tabs opened or closed in a burst (reported 1 Nov: rows piling up over each other). Until 14.1 a change while the last slide still ran stood every row in its place
  // at once: no overlap, but the list jumped a row in one frame (reported 21 Nov: "the list jumps"). Now every slide carries on from where its row is drawn (`from`, above),
  // a leaving row's picture starts where that row was drawn (offsetOf) and its clip closes with the rows that follow it (below): continuous, and still nothing overlaps.
  for(const move of moves){
   const below=!!fold&&move.dy>0&&move.was>=fold.top+fold.span-.5;
   const timing={id:'sb-flip',duration:springMs(),easing:SPRING,...(turns?{delay:turns.wait,fill:'backwards' as const}:below?{delay:fold.wait,fill:'backwards' as const}:{})},keys=[{transform:`translateY(${move.from}px)`},{transform:'none'}];
   slides.current.set(move.key,{anim:move.el.animate(keys,timing),from:move.from});
   // A group's guide line (its `::before`, or the connecting line of a group that holds groups) is not a row of its own: it travels with the group's header, on the same
   // slide, so a group below one that opens or closes never shows its line at its final place before its rows arrive (Beta 14: "lines travel with their rows").
   if(move.el.classList.contains('sb-group-header')){
    const members=move.el.parentElement?.querySelector<HTMLElement>(':scope>.sb-group-members');
    if(members){
     for(const anim of members.getAnimations())if(anim.id==='sb-flip'&&anim.effect instanceof KeyframeEffect&&anim.effect.target===members)anim.cancel();
     members.animate(keys,{...timing,pseudoElement:'::before'});
     const connector=members.querySelector<HTMLElement>(':scope>.sb-group-rail:not(.fg-conn-copy)');
     if(connector){for(const anim of connector.getAnimations())if(anim.id==='sb-flip')anim.cancel();connector.animate(keys,timing);}
    }
   }
  }
  // A picture still leaving is dropped (its row is back): the section toggled again mid-fold, and the row rises from where its picture had faded to.
  const dropGhost=(key:string)=>{const g=ghosts.current.get(key);if(!g)return;ghosts.current.delete(key);const wrap=g.parentElement;g.getAnimations().forEach(animation=>{animation.onfinish=null;animation.oncancel=null;animation.cancel();});g.remove();if(wrap?.classList.contains('sb-flip-ghosts')&&!wrap.querySelector('.sb-flip-ghost'))wrap.remove();};
  arrivals.sort((a,b)=>a.top-b.top).forEach((item,index)=>{
   const gone=ghosts.current.get(item.key),from=gone?Number.parseFloat(getComputedStyle(gone).opacity)||0:0;if(gone)dropGhost(item.key);
   if(turns){item.el.animate([{opacity:from},{opacity:1}],{id:'sb-arrive',duration:Math.round(springMs()*SWITCH_ARRIVE_SHARE),delay:turns.arrive[arriving.indexOf(item)]??turns.wait,easing:SPRING,fill:'backwards'});return;}
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
   const top=leaving[0].was.top+leaving[0].off,span=Math.max(...leaving.map(item=>item.was.top+item.off+item.was.height))-top,spring=springMs(),life=turns?turns.leave:fold?fold.fade:Math.round(spring*.62),HEAD=8;
   // How far the clip closes: as far as the first row below the leaving ones travels (its `from`: one row's height when nothing was moving, more when it was still sliding down
   // from the last change), so the clip's bottom edge and that row's top stay together on every frame; nothing below moving up: the whole picture.
   const travel=clipTravel(leaving.map(item=>item.was),moves,slide,span);
   const wrap=document.createElement('div');wrap.className='sb-flip-ghosts';wrap.setAttribute('aria-hidden','true');wrap.inert=true;
   Object.assign(wrap.style,{position:'absolute',left:'0',right:'0',top:(top-HEAD)+'px',height:(span+HEAD)+'px',overflow:'hidden',pointerEvents:'none',zIndex:'1'});
   box.appendChild(wrap);
   let live=leaving.length;
   leaving.forEach(({key,was,off},at)=>{
    const nested=was.nested||!!was.el.closest('[data-nested]');
    const ghost=(was.el.isConnected?was.el.cloneNode(true):was.el) as HTMLElement;
    // A ghost is only a picture: nothing may find it as a row, a current item or a focus stop.
    // (In a layout switch the selected tab's row leaves with every other row, and no row of the new list is selected in its place: its picture keeps the selected look, so the plate fades with its text.
    // Without it the plate, the border and the close button were cut on the first frame and the bare title faded alone. Any other leaving row loses the mark as before: the selection has moved to a live row.)
    const selected=!!turns&&was.el.getAttribute('aria-current')==='true';
    for(const node of [ghost,...ghost.querySelectorAll<HTMLElement>('*')])for(const name of ['data-flip','data-tab-id','data-group-header','data-group-tab','aria-current','data-sb-focus','data-glide'])node.removeAttribute(name);
    if(selected)ghost.setAttribute('aria-current','true');
    ghost.setAttribute('aria-hidden','true');ghost.inert=true;ghost.classList.add('sb-flip-ghost');if(nested)ghost.setAttribute('data-nested','');
    // A group's header that leaves (an inner group going with its folded parent, Beta 14) is a picture of the header only: the folder's colour and the name's live on the group around it, so they are written onto the picture as they were drawn.
    if(was.el.isConnected&&was.el.matches('.sb-group-header')){const name=ghost.querySelector<HTMLElement>('.sb-group-name'),icon=ghost.querySelector<HTMLElement>('.sb-group-folder'),liveName=was.el.querySelector('.sb-group-name'),liveIcon=was.el.querySelector('.sb-group-folder');if(name&&liveName)name.style.color=getComputedStyle(liveName).color;if(icon&&liveIcon)icon.style.color=getComputedStyle(liveIcon).color;const live=getComputedStyle(was.el);Object.assign(ghost.style,{gap:live.columnGap,padding:live.padding,alignItems:'center',font:live.font,textAlign:'left'});}
    Object.assign(ghost.style,{position:'absolute',top:(was.top+off-top+HEAD)+'px',left:was.left+'px',width:was.width+'px',height:was.height+'px',margin:'0',display:'flex'});
    wrap.appendChild(ghost);railGhost(ghost);// B14 Mini: in the rail the copy of a folder's tab goes back onto the axis (no observer at rest)
    const shown=getComputedStyle(ghost),o=Number.parseFloat(shown.opacity),at0=shown.transform;
    ghost.getAnimations().forEach(animation=>animation.cancel());
    ghosts.current.set(key,ghost);
    const fade=ghost.animate([{opacity:Number.isFinite(o)?o:1,transform:at0&&at0!=='none'?at0:'none'},{opacity:0,transform:turns?(at0&&at0!=='none'?at0:'none'):'translateY(-4px) scale(.98)'}],turns?{duration:life,easing:EXIT,fill:'both'}:fold?{duration:life,delay:fold.delays[at],easing:SPRING,fill:'both'}:{duration:life,delay:Math.min(leaving.length-1-at,4)*16,easing:EXIT,fill:'both'});
    const end=()=>{if(ghosts.current.get(key)===ghost)ghosts.current.delete(key);ghost.remove();if(--live<=0)wrap.remove();};
    fade.onfinish=end;fade.oncancel=end;
   });
   if(!turns)wrap.animate([{clipPath:'inset(0 0 0 0)'},{clipPath:`inset(0 0 ${fold?fold.travel:travel}px 0)`}],{duration:spring,delay:fold?.wait??0,easing:SPRING,fill:'both'});
   // Backstop: whatever happens to the animations, nothing of the fold outlives it.
   window.setTimeout(()=>{for(const [key,g] of ghosts.current)if(g.parentElement===wrap||!g.isConnected)ghosts.current.delete(key);wrap.remove();},spring+(fold?.wait??0)+life+500);
  }
 });
}

/** Shared-element hand-off (bible §3.9): when the current item changes, its raised card glides from the old item to the
 * new one on the spring (transform only) instead of one card fading out and another fading in. The new item hides its
 * own card until the glide lands. Used for tab rows (scroll region) and Favorites tiles (the grid).
 * A linked tab (reported 28 Oct) is current in two rows at once, its group row and its copy in the split card: both rows
 * glide together on the same spring, each from its own previous place (a card new to its role starts where the single
 * card was, so one card becomes two), so the pair reads as one selection. */
function useCardGlide(root:{current:HTMLElement|null},selector:string,reduced:boolean){
 type Spot={el:HTMLElement;x:number;y:number;w:number;h:number};
 const last=useRef<Map<string,Spot>>(new Map()),flying=useRef<Map<string,{glide:HTMLElement;motion:Animation;superseded?:boolean}>>(new Map());
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
  const view=box.getBoundingClientRect(),finish=(node:HTMLElement)=>node.getAnimations({subtree:true}).forEach(animation=>{const effect=animation.effect as KeyframeEffect|null;/* the row's own transitions and its active-border ring's (a ::before): the ring of the row the card leaves is gone the frame the card, which carries the same ring, lifts off */if(animation instanceof CSSTransition&&effect?.target===node&&(!effect.pseudoElement||effect.pseudoElement==='::before'))animation.finish();});
  for(const [role,now] of spots){
   let was=before.get(role)??first;
   // A second click before the first glide lands (reported 28 Oct: "selecting more than one tab randomly"): two raised cards were
   // drawn at once, one still landing on the old row. The new glide starts where the flying card is and the old one goes.
   const prior=was&&was.el!==now.el?flying.current.get(role):undefined;
   if(prior){flying.current.delete(role);if(prior.glide.isConnected){const a=prior.glide.getBoundingClientRect(),b=box.getBoundingClientRect();was={...was!,x:a.left-b.left+box.scrollLeft-box.clientLeft,y:a.top-b.top+box.scrollTop-box.clientTop,w:a.width,h:a.height};}/* 14.1: this card is superseded, never landed: see land() */prior.superseded=true;prior.motion.cancel();}
   // When the current tab was closed there is nothing to hand off from: the next tab's own card slides up with its row
   // (reported: the highlight lingered on the row below before sliding up). 14.1 (reported 21 Nov): its look stands on the close's own frame. Its own transitions
   // (fill 120 ms, ring) used to fade it in while the closed row's picture had already lost the mark: 3 to 5 frames with no row selected, then an outline, then the fill.
   if(was&&was.el!==now.el&&now.h&&(!was.el.isConnected||was.el.classList.contains('sb-flip-ghost')))finish(now.el);
   if(reduced||!was||was.el===now.el||!now.h||!was.el.isConnected||was.el.classList.contains('sb-flip-ghost'))continue;
   // B14 Mini (round 5): in the rail the only active marker is the site-coloured line; the raised card must not fly (clipped to 56px it read as a ghost box sliding between icons).
   if(box.closest('.acira-sidebar.is-mini:not([data-mini=open])'))continue;// a closed row lives on only as useFlip's fading ghost
   if(was.y-box.scrollTop+was.h<0||was.y-box.scrollTop>view.height)continue;// the old card was out of sight: nothing to hand off
   const el=now.el,glide=document.createElement('div');glide.className='sb-glide';glide.setAttribute('aria-hidden','true');
   Object.assign(glide.style,{left:now.x+'px',top:now.y+'px',width:now.w+'px',height:now.h+'px',borderRadius:getComputedStyle(el).borderRadius});
   // A Favorites tile's card carries its site's ring colour (sidebar.css): it flies in the colour of the tile it leaves and arrives in the colour of the tile it lands on.
   const tile=el.classList.contains('sb-app'),ring=(node:HTMLElement)=>getComputedStyle(node).getPropertyValue('--sb-site').trim();
   // Site color Off (reported 17 Nov: "Off must mean off"): the card computes no colour at all, so none of it can show (sidebar.css gives the card the accent ring and no tint under Off).
   const off=document.documentElement.getAttribute('data-site-color')==='off';
   if(tile&&!off)glide.style.setProperty('--sb-site',ring(el));
   box.prepend(glide);el.setAttribute('data-glide','');const noelLetGo=tile?undefined:noelCarry(glide);/* Noël: the card carries the tab's snow as it glides */finish(el);if(was.el.isConnected)finish(was.el);
   // Tab glow (item 11): the raised card carries the ring and the glow in the site's colour, blending from the old tab's to the new one's on this same
   // animation (one curve, one clock); tab-glow.css draws them from --glow-c, a registered colour, so the browser interpolates it.
   const tones=off?null:glideColors(was.el.style.getPropertyValue('--site'),el.style.getPropertyValue('--site'));if(tones)glide.setAttribute('data-glow','');if(tile||tones)el.setAttribute('data-glide-ring','');/* the row's own ring is held finished under a card that carries one; under a card without a colour (a tab whose site colour is not known yet) it arrives by its own motion */
   const lift=`translate(${was.x-now.x}px,${was.y-now.y}px) scale(${was.w/now.w},${was.h/now.h})`;
   const motion=glide.animate([{transform:lift,...(tile&&!off?{'--sb-site':ring(was.el)}:{}),...(tones?{'--glow-c':tones[0]}:{})},{transform:'none',...(tones?{'--glow-c':tones[1]}:{})}],{duration:springMs(),easing:SPRING,fill:'forwards'/* the card keeps its last keyframe until it lands: a finished animation without a fill lets the card fall back to its base paint (no glow, no colour) for the frame before the finish event runs: the dip of G3 */});
   /* A tab opened a moment ago has no site colour for its first state update (a few ms): the card then flew from the old tab's colour to nothing, and the row, which has its colour by the time the card lands, showed its whole ring, glow and wash in one frame. When the colour arrives while the card flies, the card's colour carries on from what it shows now to the new tab's (a second animation on the colour alone, over what is left of the flight), so the card lands in the colour the row has. */
   let heading=tones?tones[1]:'',tint:Animation|undefined;
   const follow=tile||off?null:new MutationObserver(()=>{
    const site=el.style.getPropertyValue('--site').trim().toLowerCase();
    if(!glide.isConnected||!parseGlow(site)||site===heading)return;
    const effect=motion.effect as KeyframeEffect|null,left=effect?Number(effect.getComputedTiming().endTime)-Number(motion.currentTime??0):0;
    if(!effect||!(left>16))return;// the card is about to land: the row's own motion takes it from here
    heading=site;
    const shown=getComputedStyle(glide).getPropertyValue('--glow-c').trim()||site+'00';
    tint?.cancel();effect.setKeyframes([{transform:lift},{transform:'none'}]);glide.setAttribute('data-glow','');el.setAttribute('data-glide-ring','');
    tint=glide.animate([{'--glow-c':shown},{'--glow-c':site}],{duration:left,easing:SPRING,fill:'forwards'});
   });
   follow?.observe(el,{attributes:true,attributeFilter:['style']});
   const flight:{glide:HTMLElement;motion:Animation;superseded?:boolean}={glide,motion};
   const land=()=>{
    follow?.disconnect();
    /* The card's last paint (fill, glow, and the wash's colour) is handed to the row as its starting values, the card goes, the style is computed with transitions off (a forced recalculation: a rAF alone clears the inline `transition: none` before the next one, and the row's fill and glow then transitioned in from nothing: 7 to 20 levels down and back up, G3 of the 14 Nov pass), and only then do the row's own transitions run, from the card's look to its own: no step at the landing, and when the two are the same nothing moves. */
    // 14.1 (reported 21 Nov): a card superseded mid-flight (another tab chosen or opened before it landed: the new card flies on from where it is) never
    // lands. Handing its paint to the row it was flying to gave that row, no longer the current one, a selected plate that faded for 120 ms beside the new card.
    const card=glide.isConnected&&!flight.superseded?getComputedStyle(glide):null;
    el.style.transition='none';
    if(card){el.style.setProperty('background-color',card.backgroundColor,'important');el.style.setProperty('box-shadow',card.boxShadow,'important');const wash=card.getPropertyValue('--tg-wash-c').trim();if(wash)el.style.setProperty('--tg-wash-c',wash);}
    el.removeAttribute('data-glide');el.removeAttribute('data-glide-ring');noelLetGo?.();glide.remove();if(flying.current.get(role)?.glide===glide)flying.current.delete(role);
    void el.offsetWidth;
    requestAnimationFrame(()=>{el.style.transition='';for(const name of ['background-color','box-shadow','--tg-wash-c'])el.style.removeProperty(name);});
   };
   motion.onfinish=land;motion.oncancel=land;flying.current.set(role,flight);
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

function TabRow({tab,state,dispatch,pinned=false,hidden=false,pane,link,copy=false,number,numberTyped,numberLeaving,dragging,hint,hintOut=false,onMove,onClose,onPointerDown}:{tab:TabSession;state:BrowserSnapshot;dispatch:Dispatch;pinned?:boolean;hidden?:boolean;/** The split whose card lists this row (the one place a pane shows, 28 Oct). */pane?:SplitGroup;/** Linked copies (reported 28 Oct): `link` marks the tab's row in its group as also drawn in this loose split; `copy` marks the split card's row of such a tab (its × removes it from the split, its group colour and tooltip say where the tab lives). */link?:SplitGroup;copy?:boolean;/** The figure Ctrl/Cmd+number goes to this tab by, drawn at the row's end while the key is held. */number?:number;/** The figure is fading out (Ctrl/Cmd was let go): it stays for the fade, ui/tabNumbers.ts. */numberLeaving?:boolean;/** While a first digit waits for its second (Ctrl/Cmd+1, then 5 = tab 15): 'match' for the figures it can still lead to (10…19 for 1), 'other' for the rest. */numberTyped?:'match'|'other';dragging:boolean;hint?:'before'|'after';hintOut?:boolean;onMove:(direction:-1|1)=>void;onClose:()=>void;onPointerDown:(event:PointerEvent<HTMLDivElement>)=>void}){
 // D's private tabs and N's Tor tabs (TabSession.privacy; 'tor' is typed when N's tabs land).
 const active=tab.id===state.activeTabId,sound=tabSound(tab),name=title(tab),raw=tab.privacy as string|undefined,privacy:'private'|'tor'|undefined=raw==='private'||raw==='tor'?raw:undefined,privateTab=privacy==='private',torTab=privacy==='tor',markInIcon=!!privacy&&isNewTabState(tab.url);
 const loading=useLoadingSignal(tabShowsLoading(tab));
 // Tab glow (item 11): the site icon's colour, for a row that may wear it (not private, Tor, asleep, outlined for a risk, or a linked copy); the stylesheet (tab-glow.css) decides how much, from Settings › Site colour.
 const siteColor=rowGlowColour({url:tab.url,iconColour:useSiteIconColor(tab.url,tab.favicon,!privacy&&!tab.sleeping&&!tab.risk&&!copy&&!hidden,!!tab.error),siteColor:currentSiteColor(tab),accentGlow:useOwnPageAccent(),enabled:!privacy&&!tab.sleeping&&!tab.risk&&!copy&&!hidden,error:!!tab.error});   /* an Acira page (no icon colour of its own) takes the theme's accent, ui/ownPageGlow.ts */
 // Inline rename (R3 zen-extras): double-click the row, F2, or Rename tab in its menu; the field takes the button's place.
 const rowRef=useRef<HTMLDivElement>(null),[renaming,setRenaming]=useTabRename(rowRef),shown=shownTab(tab),cardMode=useTabHoverCardMode();
 // Beta 14 (B6): the row chooses its tab on the mouse press, as Chromium's tab strip does (ui/pressSelect.ts); the click that ends that press does nothing more.
 const pressMemo=useRef(createPressMemo()).current,choose=()=>{if(pane)selectStripTab(state,dispatch,tab.id,pane);else if(!active)dispatch({type:'tab.select',id:tab.id});};
 const pressChoose=(event:PointerEvent<HTMLDivElement>)=>{if(renaming||!selectsOnPress({button:event.button,pointerType:event.pointerType,ctrlKey:event.ctrlKey,metaKey:event.metaKey,shiftKey:event.shiftKey,altKey:event.altKey,onControl:!!(event.target as HTMLElement).closest('.sb-tab-close,.sb-tab-action,.sb-tab-editing,input'),tabId:tab.id,activeTabId:state.activeTabId,shownSplit:pane&&state.windowUi.split?.groupId===pane.id?null:state.windowUi.split?.tabIds})){pressMemo.clear();return;}pressMemo.chose(tab.id);choose();};
 const context=(node:HTMLElement,pointer?:{clientX:number;clientY:number})=>popup(state,'tab-context',node,tab.id,pointer);
 // A pane (reported 28 Oct): one click shows its split focused on it (Chrome, Arc, Zen); Open alone (the row's expand button,
 // Shift+Enter, the tab menu) shows it by itself while the split stays saved, and the same button, a click on the row or on the
 // card brings the split back. Only the current row reads as current; the card's line says its split is on screen.
 const solo=!!pane&&paneIsAlone(state,tab.id,pane),toggle=()=>{if(pane)toggleSolo(state,dispatch,tab.id,pane);};
 const soloName=solo?t('acirasidebar.showSplitView'):t('acirasidebar.openAlone');
 // A linked tab is two rows of one tab: both read as current together. The group row carries the split glyph ("Also in split view"),
 // the card row the group's colour and link glyph ("In group G") and a fainter title; the card row's × removes it from the split.
 const homeGroup=copy?groupForTab(state,tab):undefined,linkTip=copy?t("acirasidebar.linkedInGroup",{group:homeGroup?.name||t('acirasidebar.unnamedGroup')}):link?t("acirasidebar.linkedInSplit"):undefined;
 return <div className="sb-tab" ref={rowRef} role="listitem" data-flip={hidden?undefined:'t:'+tab.id+(copy?'~split':'')} data-tab-id={tab.id} data-num={number!==undefined&&!numberLeaving?'':undefined} data-link-role={copy?'split':link?'group':undefined} data-split-link={copy?homeGroup?.id||'':undefined} data-in-split={link?.id} style={copy&&homeGroup?{'--group-color':tabGroupColor(homeGroup.color)} as CSSProperties:siteColor?{'--site':siteColor} as CSSProperties:undefined} data-glow={siteColor?'':undefined} data-split-pane={pane?.id} data-solo={solo||undefined} onPointerEnter={event=>startTitleMarquee(event.currentTarget.querySelector<HTMLElement>('.sb-tab-title'))} onPointerLeave={event=>stopTitleMarquee(event.currentTarget.querySelector<HTMLElement>('.sb-tab-title'))} data-private={privateTab||undefined} data-tor={torTab||undefined} data-pinned={pinned||undefined} data-hidden={hidden||undefined} inert={hidden||undefined} aria-hidden={hidden||undefined} data-sleeping={tab.sleeping||undefined} data-capturing={tab.capturing?.length||undefined} data-risk={tab.risk?.kind} title={tab.risk?`${tab.risk.title}. ${tab.risk.detail}`:undefined} aria-current={active||undefined} data-dragging={dragging||undefined} data-drop={hint} data-drop-out={hint&&hintOut||undefined} onPointerDown={event=>{pressChoose(event);onPointerDown?.(event);}} onDragStart={event=>event.preventDefault()}
  onMouseDown={event=>{if(event.button===1)event.preventDefault();}} onAuxClick={event=>{if(event.button===1&&(!pinned||pinnedCloseOffered(tab,pinned))){event.preventDefault();onClose();}}}
  onContextMenu={event=>{event.preventDefault();event.stopPropagation();context(event.currentTarget,event);}}>
  {renaming?<div className="sb-tab-main sb-tab-editing"><span className="sb-tab-icon" data-loading={loading||undefined}>{loading?<DotMatrix preset="loader" size={14} reducedMotion={state.settings.reducedMotion}/>:markInIcon?<TabPrivacyMark privacy={privacy!} size={16} className="sb-tab-icon-mark"/>:<SiteIdentityIcon url={tab.url} favicon={tab.favicon} size={16} error={!!tab.error}/>}</span><TabNameInput tab={shown} dispatch={dispatch} onDone={()=>{setRenaming(null);requestAnimationFrame(()=>rowRef.current?.querySelector<HTMLElement>('.sb-tab-main')?.focus({preventScroll:true}));}}/></div>:
  <button className="sb-tab-main" data-sb-focus onDoubleClick={event=>{event.preventDefault();setRenaming('inline');}} aria-current={active?'page':undefined} aria-label={privacy||sound==='playing'||linkTip?`${name}${privacy?`, ${privacyNames[privacy].label}`:''}${sound==='playing'?`, ${t("tabsound.playing")}`:''}${linkTip?`, ${linkTip}`:''}`:undefined} title={cardAnswers(cardMode,tab)?undefined:`${name}${tab.customTitle?' · '+t("tabrename.renamedTip"):''}${privacy?' · '+privacyNames[privacy].tip:''}${tab.sleeping?' · '+t("tabsleep.tipSleeping"):''}${isWeb(tab)?'\n'+address(tab.url):''}`} onClick={()=>{if(pressMemo.spentBy(tab.id))return;choose();}}
   onKeyDown={event=>{
    if(event.key==='ContextMenu'||event.shiftKey&&event.key==='F10'){event.preventDefault();event.stopPropagation();context(event.currentTarget);return;}
    if(event.key==='Delete'&&pinned){event.preventDefault();/* Beta 14: the row stays (asleep), so the keyboard stays on it */if(pinnedCloseOffered(tab,pinned))onClose();return;}
    if(event.key==='Delete'){event.preventDefault();const root=event.currentTarget.closest('.acira-sidebar'),next=root?neighbourTabId(listedTabIds(root),tab.id):undefined;onClose();if(next)keepTabFocus(next,tabFocusEnvironment());return;}
    if(pane&&event.key==='Enter'&&event.shiftKey&&!event.ctrlKey&&!event.altKey&&!event.metaKey){event.preventDefault();toggle();return;}
    if(event.key==='F2'&&!event.altKey&&!event.ctrlKey&&!event.shiftKey){event.preventDefault();setRenaming('inline');return;}
    if(event.altKey&&event.shiftKey&&(event.key==='ArrowUp'||event.key==='ArrowDown')){event.preventDefault();onMove(event.key==='ArrowUp'?-1:1);keepTabFocus(tab.id,tabFocusEnvironment());return;}
    moveFocus(event);}}>
   <span className="sb-tab-icon" data-loading={loading||undefined}>{loading?<DotMatrix preset="loader" size={14} reducedMotion={state.settings.reducedMotion}/>:markInIcon?<TabPrivacyMark privacy={privacy!} size={16} className="sb-tab-icon-mark"/>:<SiteIdentityIcon url={tab.url} favicon={tab.favicon} size={16} error={!!tab.error}/>}</span><span className="sb-tab-title" dir="auto"><span className="sb-tab-title-text">{name}</span>{copy&&<span className="sb-tab-leave" aria-hidden="true">{t("acirasidebar.removeFromSplit")}</span>}</span>
   <PeekMarkerCard tabId={tab.id} size={12} reduced={state.settings.reducedMotion}/>{/* the Link preview marker (item 17): a card with the preview's site icon beside this icon while a preview is open from this tab */}
  </button>}
  {tab.capturing?.length ? <button className="sb-tab-action sb-tab-capture" data-persistent aria-label={t("acirasidebar.stopSharingYourAndWith", { and: tab.capturing.join(' and '), name: name })} title={t("app.usingYourAndClickTo", { and: tab.capturing.join(' and ') })} onClick={()=>void runtime.browserCommand({type:'stop-capture',tabId:tab.id})}><span aria-hidden="true"/></button> : null}
  {/* B's shared mark (the strip draws the same): F's mask for a private tab, N's onion for a Tor tab, in the mark colour;
      on the new-tab state it takes the icon's place instead. */}
  {privacy&&!markInIcon&&<TabPrivacyMark privacy={privacy} className="sb-tab-mark"/>}
  {linkTip&&!hidden&&<span className="sb-tab-link" data-role={copy?'group':'split'} title={linkTip} aria-hidden="true"><PreviewIcon icon={copy?Link2:Columns2} size={12}/></span>}
  {/* Open alone / Show split view (reported 28 Oct): on hover and on the current pane; kept while the pane is shown by itself. */}
  {pane&&!hidden&&<button type="button" className="sb-tab-action sb-tab-solo" data-persistent={solo||undefined} aria-label={`${soloName}: ${name}`} title={`${soloName} (${formatShortcut('Shift Enter')})`} onClick={toggle}><PreviewIcon icon={solo?Columns2:Maximize2} size={12}/></button>}
  {/* R4-30: a muted tab keeps its speaker-off button (one click unmutes); a tab playing sound shows the equaliser in the close slot (the x on hover or focus), or in its own slot when pinned. Mute is in the tab's menu. */}
  {sound==='muted'&&<button className="sb-tab-action" data-persistent aria-label={t("tabsound.unmuteName", { name })} aria-pressed={true} title={t("acirasidebar.unmute")} onClick={()=>dispatch({type:'tab.mute',id:tab.id,muted:false})}><PreviewIcon icon={VolumeX} size={12}/></button>}
  {sound==='playing'&&pinned&&!pinnedCloseOffered(tab,pinned)&&<span className="sb-tab-sound" aria-hidden="true"><TabSoundMeter reducedMotion={state.settings.reducedMotion}/></span>}
  {/* Beta 14: a pinned tab's x puts it to sleep and keeps its place (runtime/pinnedClose.ts); an asleep pinned tab has nothing to close, its menu removes it. */}
  {(!pinned||pinnedCloseOffered(tab,pinned))&&<button className="sb-tab-close" data-sound={sound==='playing'?'playing':undefined} aria-label={copy?`${t("acirasidebar.removeFromSplit")}: ${name}`:pinned?t("tabpin.sleepName",{name}):t("acirasidebar.closeName", { name: name })} title={copy?t("acirasidebar.removeFromSplit"):pinned?t("tabpin.sleepTip"):controlTitle('Close tab')} onClick={()=>{if(active&&state.settings.noelOn===true)dropSelectedSnow();onClose();}}><LineIcon name="x" size={14}/>{sound==='playing'&&<TabSoundMeter reducedMotion={state.settings.reducedMotion}/>}</button>}
  {number!==undefined&&<span className="sb-tab-number" data-typed={numberTyped} data-leaving={numberLeaving||undefined} aria-hidden="true">{number}</span>}
  {active&&!hidden&&!copy&&state.settings.noelOn===true&&<NoelFx kind="sel"/>}
 </div>;
}

/** A tab group, drawn as a folder (GroupFolderGlyph: one outline line that morphs between the closed and the open folder) in the group's color in the icon column, name at the text
 * edge, chevron on hover (always when collapsed), members one step in beside a rail in the group's color. Reuses the strip's inline rename. */
function SidebarGroup({pinnedFolder=false,group,members,family=[],nested=false,folded=false,state,dispatch,showMembers=false,auto,joining=false,dragging=false,onPointerDown,children}:{/** Beta 14, pinned folders: the folder is drawn in the Pinned block. */pinnedFolder?:boolean;group:TabGroup;members:TabSession[];/** Beta 14 (AE): the tabs of its inner groups (a parent). */family?:TabSession[];/** An inner group, drawn inside its parent's rows. */nested?:boolean;/** An inner group whose parent is folded: its header goes with the parent's rows. */folded?:boolean;state:BrowserSnapshot;dispatch:Dispatch;showMembers?:boolean;/** Beta 14: the automatic colour from the group's sites (hue and chroma); `null` when no site has a colour; absent for a group whose colour was picked or that no list colours (a split's nested view). */auto?:{h:number;c:number}|null;joining?:boolean;/** Carried by its header to a workspace. */dragging?:boolean;onPointerDown?:(event:PointerEvent<HTMLButtonElement>)=>void;children?:ReactNode}){
 const root=useRef<HTMLDivElement>(null),editor=useGroupRename(root),activeInside=members.some(tab=>tab.id===state.activeTabId)||family.some(tab=>tab.id===state.activeTabId),count=members.length+family.length;
 const lead=members.find(tab=>tab.id===group.lastActiveTabId)||members[0]||family[0];
 const context=(node:HTMLElement,pointer?:{clientX:number;clientY:number})=>popup(state,'group-context',node,lead.id,pointer);
 // Collapsing keeps the current tab where it is, visible under the header (Arc); the strip keeps Chrome's rule.
 const select=()=>{if(showMembers)dispatch({type:'tab.group.update',id:group.id,keepActive:true,patch:{collapsed:!group.collapsed}});else dispatch({type:'tab.select',id:lead.id});};
 // The hover "+" (R3-49): a new tab right after the group's last tab, joined to the group; a collapsed group opens so it shows.
 const addTab=()=>newTabInGroupActions(group,members.at(-1)?.id,lead.browserProfileId,'tab-'+crypto.randomUUID()).forEach(dispatch);
 // Beta 14 (section M): the folder's colour. Automatic takes the colour of its sites (`auto`, from useGroupAutoColors); when none of them has a colour, or the group has
 // no colour at all, the folder keeps the neutral look. A picked palette colour is used as it is. `data-tint` says which: the name is tinted only when there is a colour.
 const automatic=isAutoGroup(group)&&auto!==undefined,tint=automatic?(auto?'auto':undefined):group.color==='none'?undefined:'palette';
 const groupStyle={'--group-color':tabGroupColor(automatic?'none':group.color),...(automatic&&auto?{'--gc-h':String(auto.h),'--gc-c':String(auto.c)}:{})} as CSSProperties;
 useFolderRail(root,!!group.collapsed);
 // Beta 14 (AE): a group that holds groups draws its connecting line (nestRail.ts) from the layout, again whenever its rows or its inner groups' fold states change.
 useNestConnector(root,family.length>0,[group.collapsed?'c':'o',activeInside?'a':'',members.map(tab=>tab.id).join(),family.map(tab=>tab.id).join(),state.tabGroups.filter(item=>item.parentGroupId===group.id).map(item=>item.id+(item.collapsed?'c':'o')).join()].join('|'),springMs);
 return <div ref={root} className="ed-rail-tab-group sb-group" role={showMembers?'listitem':undefined} data-sidebar-group={showMembers?undefined:group.id} data-collapsed={group.collapsed||undefined} data-group-id={group.id} data-nested-group={nested||undefined} data-pinned-folder={pinnedFolder||undefined} data-has-inner={family.length>0||undefined} data-hidden={nested&&folded||undefined} data-all-asleep={count>0&&[...members,...family].every(member=>member.sleeping)||undefined} data-holds-active={activeInside||undefined} style={groupStyle} data-tint={tint} data-joining={joining||undefined} data-dragging={dragging||undefined} onContextMenu={event=>{event.preventDefault();event.stopPropagation();context(event.currentTarget,event);}}>
  {editor.editing?<GroupNameInput group={group} groups={state.tabGroups} onSave={name=>dispatch({type:'tab.group.update',id:group.id,patch:{name}})} onCancel={()=>{editor.stop();requestAnimationFrame(()=>root.current?.querySelector<HTMLElement>('.sb-group-header')?.focus());}}/>
   :<button type="button" className="ed-rail-tab-group-name sb-group-header" data-flip={"g:"+group.id} data-sb-focus data-group-header={showMembers?group.id:undefined} data-group-tab={showMembers?lead.id:undefined} aria-label={t("acirasidebar.groupCountTabs", { group: group.name||t('acirasidebar.unnamedGroup'), count })} aria-expanded={showMembers?!group.collapsed:undefined} title={t("acirasidebar.groupDoubleClickToRename", { group: group.name||t('acirasidebar.unnamedGroup') })} onClick={select} onDoubleClick={editor.start} onPointerDown={showMembers?onPointerDown:undefined}
    onKeyDown={event=>{if(event.key==='F2'){event.preventDefault();editor.start();return;}if(event.key==='ContextMenu'||event.shiftKey&&event.key==='F10'){event.preventDefault();context(event.currentTarget);return;}if(event.altKey&&event.shiftKey&&(event.key==='ArrowUp'||event.key==='ArrowDown')){const drop=groupKeyboardDrop(state.tabs,state.tabGroups,group.id,event.key);if(drop){event.preventDefault();dispatch(drop);}return;}if(event.altKey&&event.shiftKey&&(event.key==='ArrowRight'||event.key==='ArrowLeft')){/* Beta 14: Right nests the group into the one above it, Left takes it out */const nest=groupKeyboardNest(state.tabs,state.tabGroups,group.id,event.key);if(nest){event.preventDefault();dispatch(nest);}return;}moveFocus(event);}}>
    <span className="sb-tab-icon sb-group-folder" aria-hidden="true"><GroupFolderGlyph count={count} open={!group.collapsed||joining}/></span><span className="sb-group-name">{group.name||t('acirasidebar.unnamedGroup')}</span>{showMembers&&<PreviewIcon icon={ChevronDown} size={12} className="sb-group-chev"/>}</button>}
  {showMembers&&!editor.editing&&<button type="button" className="sb-header-add" aria-label={t("acirasidebar.newTabInGroup")} title={t("acirasidebar.newTabInGroup")} onClick={addTab}><PreviewIcon icon={Plus} size={14}/></button>}
  {showMembers&&<div className="ed-rail-group-members sb-group-members" role="list">{!nested&&<div className="sb-group-rail" aria-hidden="true"><svg className="ng-conn" focusable="false"><defs><linearGradient id={'ngg-'+group.id} gradientUnits="userSpaceOnUse" x1="0" x2="0" y1="0" y2="18"><stop offset="0" stopColor="currentColor" stopOpacity="0"/><stop offset=".1" stopColor="currentColor" stopOpacity="1"/><stop offset=".9" stopColor="currentColor" stopOpacity="1"/><stop offset="1" stopColor="currentColor" stopOpacity="1"/></linearGradient></defs><g className="ng-g"><path className="ng-trunk" stroke={`url(#ngg-${group.id})`}/><path className="ng-preview" stroke={`url(#ngg-${group.id})`}/><path className="ng-lifted" stroke={`url(#ngg-${group.id})`}/></g></svg></div>}{children}</div>}
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
 return <>{lead&&<div className="sb-sep" role="separator" data-flip="sep:downloads"/>}<Zone id="downloads" title={t("browsermenu.downloads")} folded={!!folded['downloads-closed']} toggleKey="downloads-closed" mark={<PreviewIcon icon={Download} size={14}/>} reduced={reduced} profileId={profileId} privateMode={privateMode} action={<span className="sb-zone-actions">{listButton(t('acirasidebar.allDownloads'),'Ctrl J',()=>navigate('downloads'))}</span>}>
  {items.length?items.map(item=><button key={item.id} type="button" className="sb-bookmark sb-download" data-flip={'d:'+item.id} data-sb-focus title={item.name} onKeyDown={moveFocus} onClick={()=>open(item)} onContextMenu={event=>{event.preventDefault();event.stopPropagation();if(item.url&&/^https?:/i.test(item.url))openBookmarkMenu(item.url,{x:event.clientX,y:event.clientY,width:2,height:2});}}>
   <span className="sb-tab-icon"><PreviewIcon icon={FileText} size={16}/></span><span className="sb-tab-title" dir="auto">{item.name}</span><small className="sb-row-note">{sidebarNote(item)}</small></button>)
   :[quietRow('downloads',t('dl.emptyTitle'))]}
 </Zone></>;
}
function SidebarHistory({state,dispatch,profileId,privateMode,folded,reduced,lead,navigate}:SectionProps&{navigate:(page:string)=>void}){
 const siteIcon=useSiteIcons(state),seen=new Set<string>(),items:HistoryVisit[]=[];
 for(const visit of [...state.browsingHistory].sort((a,b)=>Date.parse(b.time)-Date.parse(a.time))){
  if(items.length>=6)break;if((visit.browserProfileId||profileId)!==profileId||!/^https?:/i.test(visit.url))continue;
  const key=pageKey(visit.url);if(seen.has(key))continue;seen.add(key);items.push(visit);
 }
 const openTabs=new Map(state.tabs.filter(tab=>tab.browserProfileId===profileId&&isWeb(tab)).map(tab=>[pageKey(tab.url),tab]));
 const open=(event:MouseEvent<HTMLButtonElement>,url:string)=>{const tab=openTabs.get(pageKey(url));if(tab&&event.button===0&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey){dispatch({type:'tab.select',id:tab.id});return;}openPage(event,url,dispatch,navigateFromRow(state,dispatch));};
 return <>{lead&&<div className="sb-sep" role="separator" data-flip="sep:history"/>}<Zone id="history" title={t("browsermenu.history")} folded={!!folded['history-closed']} toggleKey="history-closed" mark={<PreviewIcon icon={HistoryGlyph} size={14}/>} reduced={reduced} profileId={profileId} privateMode={privateMode} action={<span className="sb-zone-actions">{listButton(t('acirasidebar.allHistory'),'Ctrl H',()=>navigate('history'))}</span>}>
  {items.length?items.map(visit=><button key={visit.id} type="button" className="sb-bookmark" data-flip={'h:'+visit.id} data-sb-focus title={`${visit.title||address(visit.url)}\n${address(visit.url)}`} onKeyDown={moveFocus} onClick={event=>open(event,visit.url)} onAuxClick={event=>open(event,visit.url)} onMouseDown={event=>{if(event.button===1)event.preventDefault();}} onContextMenu={event=>{event.preventDefault();event.stopPropagation();openBookmarkMenu(visit.url,{x:event.clientX,y:event.clientY,width:2,height:2});}}>
   <span className="sb-tab-icon"><SiteIdentityIcon url={visit.url} favicon={openTabs.get(pageKey(visit.url))?.favicon||siteIcon(visit.url)} size={16}/></span><span className="sb-tab-title" dir="auto">{visit.title||address(visit.url)}</span></button>)
   :[quietRow('history',privateMode?t('acirasidebar.historyPrivate'):t('history.emptyTitle'))]}
 </Zone></>;
}
function SidebarReading({state,dispatch,current,profileId,privateMode,folded,reduced,lead}:SectionProps&{current:TabSession}){
 const items=useReadingList(profileId,privateMode),siteIcon=useSiteIcons(state);
 const openTabs=new Map(state.tabs.filter(tab=>tab.browserProfileId===profileId&&isWeb(tab)).map(tab=>[pageKey(tab.url),tab]));
 const add=()=>{if(!isWeb(current)){dispatch({type:'toast',text:t("acirasidebar.onlyWebsitesCanGoIn"),tone:'info'});return;}
  dispatch({type:'toast',text:addToReadingList(profileId,privateMode,{url:current.url,title:current.title})?t("acirasidebar.addedToReadingList",{title:current.title||address(current.url)}):t("acirasidebar.alreadyInYourReadingList")});};
 const done=(url:string)=>{const gone=removeFromReadingList(profileId,privateMode,url);if(gone)dispatch({type:'toast',text:t("acirasidebar.markedAsRead",{title:gone.title})});return gone;};
 const open=(event:MouseEvent<HTMLButtonElement>,url:string)=>{const tab=openTabs.get(pageKey(url));if(tab&&event.button===0&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey){dispatch({type:'tab.select',id:tab.id});return;}openPage(event,url,dispatch,navigateFromRow(state,dispatch));};
 return <>{lead&&<div className="sb-sep" role="separator" data-flip="sep:reading"/>}<Zone id="reading" title={t("acirasidebar.readingList")} folded={!!folded['reading-closed']} toggleKey="reading-closed" mark={<PreviewIcon icon={BookOpen} size={14}/>} reduced={reduced} profileId={profileId} privateMode={privateMode}
  action={<span className="sb-zone-actions"><button type="button" className="sb-zone-action sb-zone-icon" aria-label={t("acirasidebar.addThisPageToThe")} title={t("acirasidebar.addThisPageToThe")} onClick={add}><PreviewIcon icon={Plus} size={14}/></button></span>}>
  {items.length?items.slice(0,8).map(item=><div key={item.url} className="sb-tab sb-reading" data-flip={'r:'+item.url} role="listitem">
   <button type="button" className="sb-tab-main" data-sb-focus title={`${item.title}\n${address(item.url)}`} onKeyDown={moveFocus} onClick={event=>open(event,item.url)} onAuxClick={event=>open(event,item.url)} onMouseDown={event=>{if(event.button===1)event.preventDefault();}} onContextMenu={event=>{event.preventDefault();event.stopPropagation();openBookmarkMenu(item.url,{x:event.clientX,y:event.clientY,width:2,height:2});}}>
    <span className="sb-tab-icon"><SiteIdentityIcon url={item.url} favicon={openTabs.get(pageKey(item.url))?.favicon||siteIcon(item.url)} size={16}/></span><span className="sb-tab-title" dir="auto">{item.title}</span></button>
   <button type="button" className="sb-tab-action sb-reading-done" aria-label={t("acirasidebar.markTitleAsRead", { title: item.title })} title={t("acirasidebar.markAsRead")} onClick={()=>done(item.url)}><PreviewIcon icon={Check} size={12}/></button>
  </div>):[quietRow('reading',t('acirasidebar.readingEmpty'))]}
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

/** Bookmarks, structured (reported 25 Oct): the zone is the root; under it the Bookmarks bar (the special folder), then
 * your folders, then loose bookmarks. Folders start closed and remember being opened; children step in 12px. The root
 * shows up to five loose bookmarks and an open folder up to eight items; the rest is one click away on the Bookmarks
 * page. Right-click (or Shift+F10) on any row, or on the zone, opens the shared bookmark menu; the zone's + makes a
 * folder. A bookmark open in a tab reads at full ink and a click goes to that tab (open-or-focus). */
function SidebarBookmarks({state,dispatch,profileId,privateMode,folded,reduced,lead,shelf=false}:{state:BrowserSnapshot;dispatch:Dispatch;profileId:string;privateMode:boolean;folded:Record<string,boolean>;reduced:boolean;lead:boolean;/** Beta 14: in the shelf Bookmarks starts open (it is what the shelf is for), with a remembered choice of its own. */shelf?:boolean}){
 const dropping=useBookmarkHint(),siteIcon=useSiteIcons(state),arrival=useBookmarkArrival(profileId);
 const [revealed,setRevealed]=useState<string|null>(null);useEffect(()=>{if(arrival)setRevealed(arrival.url);},[arrival]);
 // Drag to reorder (R3-52): HTML drag and drop like the Bookmarks bar and the Bookmarks page. Over a row's top or bottom edge
 // the line shows where the bookmark lands; over the middle of a folder it goes inside (a closed one opens after a moment).
 const [drag,setDrag]=useState<string|null>(null),[drop,setDrop]=useState<{id:string;where:DropWhere}|null>(null),dwell=useRef(0);
 useEffect(()=>()=>window.clearTimeout(dwell.current),[]);
 const nodes=state.bookmarkNodes.filter(node=>node.browserProfileId===profileId);
 if(privateMode&&!nodes.length)return null;
 const openTabs=new Map(state.tabs.filter(tab=>tab.browserProfileId===profileId&&isWeb(tab)&&!tab.privacy).map(tab=>[pageKey(tab.url),tab])),torTabs=new Map(state.tabs.filter(tab=>tab.browserProfileId===profileId&&isWeb(tab)&&tab.privacy==='tor').map(tab=>[pageKey(tab.url),tab]));
 const isOpen=(node:BookmarkNode)=>!!folded['bmo:'+node.id];
 const toggle=(node:BookmarkNode)=>toggleRailSection('bmo:'+node.id,profileId,privateMode);
 const library=()=>openWorkspacePage('bookmarks',state,dispatch);
 const open=(event:MouseEvent<HTMLButtonElement>,url:string,tor=false)=>{
  const tab=(tor?torTabs:openTabs).get(pageKey(url)),plain=event.button===0&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey;
  if(tab&&plain){dispatch({type:'tab.select',id:tab.id});return;}
  // A Tor bookmark always opens in a Tor tab, never in the ordinary tab on screen.
  if(tor){if(event.button===0||event.button===1)dispatch({type:'tab.new',url,privacy:'tor',background:!plain});return;}
  openPage(event,url,dispatch,navigateFromRow(state,dispatch));
 };
 const endDrag=()=>{window.clearTimeout(dwell.current);dwell.current=0;setDrag(null);setDrop(null);};
 const whereOver=(event:DragEvent<HTMLElement>,node:BookmarkNode):DropWhere=>{const box=event.currentTarget.getBoundingClientRect(),ratio=(event.clientY-box.top)/Math.max(1,box.height);return !node.url&&ratio>.3&&ratio<.7?'into':ratio<.5?'before':'after';};
 const dnd=(node:BookmarkNode)=>{
  if(privateMode)return {};
  return {
   draggable:!isBarFolder(node),'data-dragging':drag===node.id||undefined,'data-drop':drop?.id===node.id?drop.where:undefined,
   onDragStart:(event:DragEvent<HTMLElement>)=>{setDrag(node.id);event.dataTransfer.effectAllowed='copyMove';event.dataTransfer.setData('application/x-acira-bookmark',node.id);if(node.url)setBookmarkLinkData(event.dataTransfer,node.url,node.title||savedTitle(node.url,state));},
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
 const more=(key:string,level:number,label:string)=><BookmarkMoreRow key={key} level={level} label={label} extra={{'data-flip':'more:'+key,'data-sb-focus':true,onKeyDown:moveFocus,onClick:library}}/>;
 const page=(node:BookmarkNode,level:number)=>{const url=node.url!,tab=(node.tor?torTabs:openTabs).get(pageKey(url)),ref=bookmarkRef(node.id);
  return <BookmarkPageRow key={node.id} node={node} level={level} title={node.title||savedTitle(url,state)} icon={<SiteIdentityIcon url={url} favicon={tab?.favicon||siteIcon(url)||savedPageIdentity(url,state).favicon} size={16}/>}
   extra={{'data-bookmark-key':pageKey(url),'data-bookmark-arriving':arrival?.url===pageKey(url)||undefined,...dnd(node),'data-flip':'b:'+node.id,'data-sb-focus':true,'data-open':tab?'':undefined,'data-card-title':`${node.title||address(url)}${node.tor?' · '+privacyNames.tor.label:''}`,'data-card-host':address(url),'aria-label':node.title||address(url),onKeyDown:keys(ref),onClick:event=>{if(!node.tor)noteUse('bookmarksOpened');open(event,url,!!node.tor);},onAuxClick:event=>{if(event.button===1&&!node.tor)noteUse('bookmarksOpened');open(event,url,!!node.tor);},onMouseDown:event=>{if(event.button===1)event.preventDefault();},onContextMenu:event=>menuAt(event,ref)}}/>;};
 const folderHead=(node:BookmarkNode,level:number,expanded:boolean,bar:boolean)=>{const ref=bookmarkRef(node.id);
  return <BookmarkFolderRow key={node.id} level={level} expanded={expanded} bar={bar} title={folderTitle(node)||t('bm.untitled')}
   extra={{...dnd(node),'data-flip':'f:'+node.id,'data-sb-focus':true,title:bar?t("acirasidebar.bookmarksBarThePagesOn"):undefined,
   onKeyDown:keys(ref,event=>{if(event.key==='ArrowRight'&&!expanded||event.key==='ArrowLeft'&&expanded){event.preventDefault();toggle(node);return true;}return false;}),onClick:()=>toggle(node),onContextMenu:event=>menuAt(event,ref)}}/>;};
 // The rows come from the shared planner (ui/bookmarkTreeRows.ts), which the All Bookmarks pop-up uses too: the Bookmarks bar, then the folders, then loose pages;
 // the sidebar keeps its short lists (SIDEBAR_LIMITS: five loose pages, eight items in a folder, nothing under the second level) and their links to the Bookmarks page.
 const loose=kidsOf(nodes,null).filter(node=>node.url),looseShown=dropping?loose.length:Math.max(5,loose.findIndex(node=>node.url&&pageKey(node.url)===(arrival?.url||revealed))+1);
 const planned=treeRows(nodes,{isOpen,limits:SIDEBAR_LIMITS,looseShown,links:true});
 const landing=(dropping||arrival)&&!nodes.some(node=>node.url&&pageKey(node.url)===arrival?.url)?<div key="landing" className="sb-bookmark-landing" aria-hidden="true"/>:null;
 const body:ReactNode[]=nodes.length?planned.map(row=>row.kind==='folder'?folderHead(row.node,row.level,row.expanded,row.bar):row.kind==='page'?page(row.node,row.level):row.kind==='more'?more(row.key,row.level,row.label):null)
  :dropping||arrival?[landing]:[<div key="empty" className="sb-bookmarks-empty" data-flip="empty:bookmarks"><span className="sb-tab-icon"><PreviewIcon icon={Star} size={14}/></span><span>{t("acirasidebar.starAPageOrDrag")}</span></div>];
 const anchorOf=(event:MouseEvent<HTMLButtonElement>)=>{const box=event.currentTarget.getBoundingClientRect();return {x:box.left,y:box.top,width:box.width,height:box.height};};
 // Folded by default (reported 25 Oct): one "Bookmarks" row under the tabs, so saved pages never read as more tabs.
 return <>{lead&&<div className="sb-sep" role="separator" data-flip="sep:bookmarks"/>}<Zone id="bookmarks" title={t("browsermenu.bookmarks")} folded={(shelf?!!folded['bookmarks-shelf-closed']:!folded['bookmarks-open'])&&!dropping&&!arrival} toggleKey={shelf?"bookmarks-shelf-closed":"bookmarks-open"} mark={<PreviewIcon icon={Bookmark} size={14}/>} hint={dropping} reduced={reduced} profileId={profileId} privateMode={privateMode}
  onContextMenu={event=>menuAt(event,'node:root')}
  action={<span className="sb-zone-actions">
   {!privateMode&&<button type="button" className="sb-zone-action sb-zone-icon" aria-label={t("acirasidebar.newBookmarksFolder")} title={t("acirasidebar.newFolder")} onClick={event=>openBookmarkMenu('node:new:root',anchorOf(event))}><PreviewIcon icon={Plus} size={14}/></button>}
   <button type="button" className="sb-zone-action sb-zone-icon" data-popup-trigger aria-haspopup="dialog" aria-label={t("app.allBookmarks")} title={t("acirasidebar.allBookmarksO", { shortcut: formatShortcut('Ctrl Shift O') })} onClick={event=>popup(state,'bookmarks',event.currentTarget)}><svg className="sb-list-glyph" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 3h8M2 6h8M2 9h5"/></svg></button>
  </span>}>{body}</Zone></>;
}
