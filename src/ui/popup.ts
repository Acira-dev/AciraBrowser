import {isTorSupported} from './platform';
import type { BrowserSnapshot,Rectangle,TabSession } from '../runtime/types';
import { groupForTab } from '../runtime/tabGroups';
import { menuHeight,menuRowHeight,readMenuLayout,platformMenuLayout } from './menuPrefs';
import { profilesAsSpaces,windowWorkspaces } from '../runtime/workspaces';
import { splitGroupMenu } from '../runtime/splitPlacement';
import { peekWorkspaceTarget } from './workspaceTargetStore';
import { updatePanelPhase } from './updatePhase';
import { currentLocale } from '../i18n';
import { PANEL_DOWNLOAD_ROWS,PANEL_DOWNLOAD_ROW_HEIGHT,profileDownloads } from './downloadActivity';
import type { LocaleCode } from '../i18n/locales';

/** The compact menus have one width per kind (260; the toolbar menu 300), which holds English's longest row (a label and its
 * shortcut) untruncated. A language whose longest row is longer gets the width that row measures (label, icon, shortcut, paddings,
 * plus a few px, rounded up to 10; 28 Oct, measured with qa/tab-group-menu-i18n.mjs and qa/context-menus-i18n.mjs, which print each
 * language's need and scan every menu for a cut row; tests/context-menu-width-locale.test.ts guards the table), so no row ends in
 * an ellipsis. English and the languages that fit have no entry. Kinds missing here (the group menu, bookmark menu) fit in all. */
export const MENU_WIDTHS:Record<string,Partial<Record<LocaleCode,number>>>={
 'tab-context':{es:270,fr:280,de:330,'zh-CN':270,ar:280,tr:310,ru:320},
 'strip-context':{es:270,fr:270,de:330,ja:310,'zh-CN':270,ar:280,tr:300,ru:310},
 'page-context':{de:270,es:350,fr:290,it:350,ja:300,ko:290,ru:310},
 'toolbar-context':{es:340,fr:320,de:340,'pt-BR':340,it:350,ja:310,ar:360,tr:350,ru:340},
 'split-context':{fr:280,ru:280},
 'workspace-context':{ru:270},
 // The workspace menu (280): its "Need other sign-ins for a site?" row and Russian "Next/Previous workspace" were cut (3 Nov, measured in the app).
 'workspace-menu':{es:360,fr:320,de:340,'pt-BR':300,ja:300,ar:300,tr:310,ru:300},
 // The Acira menu (340): Arabic "Tabs" shares its row with the Top / Sidebar switch and lost its last letters to an ellipsis (81px of 91; Turkish 76 of 82). The
 // Protection panel (320): the Japanese "Saved for this site in this profile." line needs 274px, the panel gave it 264 (German 266, Russian 285).
 'menu':{ar:360,tr:350},
 // More tools (340): French "Effacer les données de navigation…" beside its key (221px of 209 even with ⇧⌘⌫).
 'more-tools':{fr:360},
 'protection':{ja:330,de:330,ru:350},
};
export const localeMenuWidth=(kind:string,locale:LocaleCode=currentLocale())=>MENU_WIDTHS[kind]?.[locale]??0;

const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(max,value));
export interface PopupGeometry {bounds:Rectangle;anchor:Rectangle;origin:{x:number;y:number};contentHeight:number}
const compactKinds=new Set(['zoom','page-context','tab-context','group-context','split-context','strip-context','bookmark-context','toolbar-context','find','toolbar-overflow','workspace-context']);
// The palette lists at most ~13 rows (bible §5.4) and scrolls past that.
const paletteMax=514;
/** The content height a layout carries for a natural height: the clamp popupGeometry applies to estimates and measurements. */
export const popupContentHeight=(kind:string,natural:number)=>clamp(kind==='palette'?Math.min(natural,paletteMax):natural,compactKinds.has(kind)?36:80,12000);

/** Recent palette commands live in this origin's storage (shared by the chrome and the overlay). */
const paletteRecent=()=>{try{const value=JSON.parse(localStorage.getItem('acira-palette-recent')||'[]');return Array.isArray(value)?Math.min(8,value.length):0;}catch{return 0;}};

/** A Tor window, or the active tab is a Tor tab: the menu carries "New Tor identity". Same rule as isTorWindow in features/tor/torClient. */
const inTorContext=(state:BrowserSnapshot)=>Boolean((state.browserProfiles.find(profile=>profile.id===state.activeBrowserProfileId) as {tor?:boolean}|undefined)?.tor)||state.tabs.find(tab=>tab.id===state.activeTabId)?.privacy==='tor';
/**
 * A popup's height before it renders, so its first frame opens at its final size (a fresh sheet also waits, bounded, for
 * its measured height). Every number is measured in the app on A's panel system (round 9): qa/b-popup-heights.mjs re-measures them all and writes tests/popup-heights.json, which npm test checks
 * these estimates against. Re-run it after changing a popup's rows, padding or content.
 */
/** R3-42: a submenu opened from the main menu starts with a header row (back chevron and title). More tools and Downloads
 * normally have none, so it adds one 32px row there; the other submenus already have a title bar that carries the chevron. */
export const submenuHeaderHeight=32;
/** The popup container's own padding and the panel's, above and below its rows. */
const panelChrome=12;
const profileOf=(state:BrowserSnapshot)=>state.tabs?.find(tab=>tab.id===state.activeTabId)?.browserProfileId||'';
/** The main menu's height: its rows from the person's layout (R3-43) plus, in a Tor tab or window (R3-61), the one extra row (New Tor identity) at the same row height. */
/** R4-16 + R4-19: the two Layout rows (View, Tabs) join the page group after Split view, Zoom or Find, at the same row height. */
/** View, Tabs and Sidebar mode. */
export const menuLayoutRows=(main:readonly string[])=>['split','zoom','find'].some(id=>main.includes(id))?3:0;
/** The Tor rows: New Tor identity, and on a website also New Tor circuit for this site (Tor Browser's pair). */
const torMenuRows=(state:BrowserSnapshot)=>{if(!inTorContext(state))return 0;const tab=state.tabs.find(item=>item.id===state.activeTabId);return tab?.contentKind==='web'&&/^https?:/i.test(tab.url||'')?2:1;};
/** "Report a problem…" under Settings, while this build can send reports and outside Tor (App.tsx reportSubjects). */
const reportMenuRows=(state:BrowserSnapshot)=>state.siteReports&&!inTorContext(state)?1:0;
const mainMenuHeight=(state:BrowserSnapshot,rowHeight=menuRowHeight)=>{const layout=platformMenuLayout(readMenuLayout(profileOf(state)));return menuHeight(layout,'main',rowHeight)+(menuLayoutRows(layout.main)+torMenuRows(state)+reportMenuRows(state))*rowHeight;};
/** The tab menu's 30px rows, counted the way App.tsx (tab-context) and TabGroupControls draw them. Always: reload, new tab, duplicate,
 *  rename, pin, move to new window, move to tab group, close, reopen (9). A website adds copy address and mute; a pane of a saved split
 *  adds Open alone and Remove from split view, another website (when the current tab is one) Split view; a grouped tab Remove from
 *  group; a window with workspaces Move to (not for a private or Tor tab); then close others / to the left / to the right when
 *  there is an unpinned tab there. Without the tab's id (a measured case) it counts a website in the middle of the strip. */
export function tabMenuRows(state:BrowserSnapshot,target?:{contentKind:string;id?:string;privacy?:string}):number{
  const web=!target||target.contentKind==='web',at=target?.id?state.tabs.findIndex(tab=>tab.id===target.id):-1;
  const pane=at>=0&&!!state.windowUi?.splitGroups?.some(split=>split.tabIds.includes(target!.id!)),current=state.tabs.find(tab=>tab.id===state.activeTabId);
  const unpinned=(list:readonly TabSession[])=>list.some(tab=>!tab.pinned)?1:0;
  const split=at<0?web?1:0:pane?2:web&&target!.id!==state.activeTabId&&current?.contentKind==='web'?1:0;
  const closes=at<0?web?3:2:unpinned(state.tabs.filter(tab=>tab.id!==target!.id))+unpinned(state.tabs.slice(0,at))+unpinned(state.tabs.slice(at+1));
  const grouped=target&&state.tabGroups?.length&&groupForTab(state,target as TabSession)?1:0,workspace=windowWorkspaces(state).length&&!target?.privacy?1:0;
  // A Tor tab on a website (or any website tab of a Tor window) adds New Tor circuit for this site.
    const torCircuit=target?.contentKind==='web'&&(target.privacy==='tor'||Boolean((state.browserProfiles.find(profile=>profile.id===state.activeBrowserProfileId) as {tor?:boolean}|undefined)?.tor))?1:0;
    return 9+(web?2:0)+split+closes+grouped+workspace+torCircuit;
}
export function popupNaturalHeight(kind:string,state:BrowserSnapshot,{recent=paletteRecent(),target,parent}:{recent?:number;target?:{contentKind:string};parent?:string}={}):number {
  return baseNaturalHeight(kind,state,{recent,target})+(parent==='menu'&&(kind==='more-tools'||kind==='downloads')?submenuHeaderHeight:0);
}
function baseNaturalHeight(kind:string,state:BrowserSnapshot,{recent,target}:{recent:number;target?:{contentKind:string;id?:string}}):number {
  const base=62,web=state.tabs.find(tab=>tab.id===state.activeTabId)?.contentKind==='web';
  // Header and search, then 32px rows that touch (bible 5.4b), then the footer.
  // Header 44 + search field 44 + rows; no footer (the New tab page has its own row). 190 measured for 3 tabs.
  // Comfortable (default): 52px two-line rows and the New tab footer (4px padding + 30px row); Compact: 32px rows, no footer.
  if(kind==='tabs')return state.settings?.tabViewerDensity==='compact'?94+Math.max(1,state.tabs.length)*32:128+Math.max(1,state.tabs.length)*52;
  if(kind==='switcher')return 12+Math.min(12,Math.max(1,state.tabs.length))*36+32;
  // Empty query: the other open tabs (up to 8) and recent commands (up to 4), each section a 28px label and 32px rows.
  // A lone tab with no recent commands lists every command instead, which reaches the cap.
  if(kind==='palette'){const others=Math.min(8,Math.max(0,state.tabs.length-1)),recents=Math.min(4,recent),sections=(others?28+others*32:0)+(recents?28+recents*32:0);return sections?Math.min(paletteMax,102+sections):paletteMax;}
  // 52px rows (title and address); websites add "Bookmark this page". No bookmarks: the empty note is one row tall.
  if(kind==='bookmarks')return (web?154:124)+state.bookmarks.length*52;
  if(kind==='context')return base+72+Math.max(1,state.tabs.length-1)*44+44;
  if(kind==='split')return base+Math.max(1,state.tabs.length-1)*44;
  // Profiles are 44px identity rows above one divider and two 30px actions (one profile measured at 125); outside a private window "Add profile…" is one more 30px row under the list.
  // R4-48: plus the Workspaces section (divider 9, its two-line head 46, a 30px row per workspace, New workspace… until eight) outside a private window.
  if(kind==='profile'){const own=state.browserProfiles.find(item=>item.id===state.activeBrowserProfileId),n=own&&!own.private?windowWorkspaces(state).length:0,between=own&&!own.private&&(state.browserProfiles.filter(item=>!item.private).length>=2||profilesAsSpaces(state));/* Open profiles: a divider (9), its name and the segmented control under the profiles (70) */return 81+Math.max(1,state.browserProfiles.length)*44+(own&&!own.private?30:0)+(between?79:0)+(n?9+46+n*30+(n<8?30:0):0);}
  // The downloads panel (extensions' panel system): up to five 44px rows (one 32px row says there are none), a divider and the 30px See all downloads row.
  if(kind==='downloads'){const rows=Math.min(PANEL_DOWNLOAD_ROWS,profileDownloads(state,state.activeBrowserProfileId||profileOf(state)).length);return panelChrome+(rows?rows*PANEL_DOWNLOAD_ROW_HEIGHT:32)+9+30;}
  // Recently closed (R3-39): the header, up to six 52px rows (title and site), a divider and the "Open Rewind" row; measured for the real list.
  if(kind==='recent-closed')return 83+6*52;
  // 17 rows of 30, four dividers of 9, the 4px container and 2px body inset each side (V02: fits without scrolling).
  // R3-43: counted from the person's layout (30px rows, 9px hairlines, 12px of padding); the default is the measured 588px. In a Tor tab or window (R3-61) one more row: New Tor identity.
  if(kind==='menu')return mainMenuHeight(state);
  // Ten 30px rows and two dividers (Ads and trackers, VPN joined the menu).
  if(kind==='more-tools')return menuHeight(platformMenuLayout(readMenuLayout(profileOf(state))),'more');
  // The toolbar's overflow (P09): the buttons a narrow row hides, 30px menu rows, no title bar; two at most today.
  if(kind==='toolbar-overflow')return 72;
  if(kind==='appearance')return 780;
  if(kind==='workspace-cover')return 520;
  // No extensions yet: the empty row and the two ways to add one.
  if(kind==='extensions')return 155;
  // Nine 30px rows on a website; an Acira page has no "Bookmark this page".
  if(kind==='toolbar-context')return web?392:362; // R3-68: the four Window views (and their two hairlines) replace the two toggles
  // Default composition: the twelve optional actions (VPN and Ads and trackers included) and the three built-in controls.
  if(kind==='customize-toolbar')return 696;
  if(kind==='vpn')return 460;
  if(kind==='protection')return web?240:120;
  // Site information, its protection facts and controls, and for websites the page actions (Reader, Print, Save, Install).
  // The site panel on a web page: 363 measured (27 Oct, qa/b-popup-heights.mjs), one 32px row more than the 331 it was.
  // A Tor site adds its circuit (label, this browser, guard, middle, exit, the site: 26 + 166) and New Tor circuit (32 + a 9px divider).
  if(kind==='security')return (web?363:97)+(web&&inTorContext(state)?233:0);
  // Tor chip panel: identity row, a two-line note, divider, two rows (the error note runs to three lines).
  // The panel's own note and rows (187) plus the Security level row and the Prefer .onion versions switch (32 each).
  if(kind==='tor')return 251;
  // Update ready (Install now, Later, Read more): 124 measured in English (31 Oct, rig qa/r6-updates-proof.mjs): the identity row, the two-line note, one row of buttons. A longer language wraps the note to three lines and is measured on open; Read more swaps the note for the release notes, up to 11 lines.
  // The download (option B, the dots in the toolbar open it; updatePanelPhase): the identity row with its ring, the line under it and What's new, 102 measured in English (3 Nov, the update-pause rig); a language that wraps the line is measured on open.
  if(kind==='update')return updatePanelPhase()==='ready'?124:102;
  // What's new after a restart (centred): the identity row, the notes (measured on open: they depend on the feed, and the popup waits for them, data-popup-pending) and the Close row. 222 is the case in tests/popup-heights.json (eight lines of notes, qa/r6-whatsnew-proof.mjs).
  if(kind==='whats-new')return 222;
  // A website's tab has more to offer (copy link, reload, site actions) than an Acira page's.
  // Rows of 30 plus 30 for the two dividers and padding. Always: reload, new tab to the right, duplicate, pin, move to new window, move to group, close, close others, reopen (9).
  // A website adds copy address, mute, split and the two bulk closes (14); an Acira page first in the strip adds only close to the right (10).
  // Rename tab (F2) is one more row: 10 always, 15 on a website, 11 on an Acira page first in the strip. Move to workspace adds a row once the window has another workspace.
  // R4-48: Move to workspace is offered whenever the window has workspaces (its list ends with New workspace…).
  // A pane of a saved split swaps Split view for Open alone (or Show split view) and Remove from split view: one row more. A tab in a
  // group adds Remove from group (28 Oct, measured with qa/split-press-after-join.mjs: a grouped pane's menu is 570, a loose tab's 510).
  // The bulk closes and Split view are counted for the tab itself (a first or last tab has no close-left or close-right row; the
  // current tab has no Split view): a loose web tab at the end of the strip measured 480, not 510 (28 Oct).
  if(kind==='tab-context')return 30+30*tabMenuRows(state,target);
  if(kind==='group-context')return 452;
  // Sidebar split header menu (R3-50): New tab in split, Change layout, Rename, a divider, Unsplit, Close split (171 measured).
  // Split in groups (docs/launch/SPLIT_IN_GROUPS.md): Move to tab group › and Remove from group add a divider (9) and a row each.
  if(kind==='split-context'){const split=target?.id?state.windowUi.splitGroups?.find(item=>item.tabIds.includes(target.id!)):undefined,menu=split?splitGroupMenu(state,split):null,rows=menu?Number(menu.targets.length>0)+Number(menu.grouped):0;return 171+(rows?9+30*rows:0);}
  if(kind==='group-preview')return 178;
  // Tab bar menu (strip blank space and the + button): new tab, private, Tor; the three windows; reopen closed tab.
  // In the sidebar's tab list the menu ends with a divider and the two section rows (Hide this section, Customize sidebar…): 9 + 2 x 30;
  // plus a divider and New workspace… (Add profile… with profiles as spaces) once the window has workspaces to add to: 39.
  if(kind==='strip-context'){const n=windowWorkspaces(state).length;return (isTorSupported()?240:180)+(state.settings?.verticalTabs?69:0)+((profilesAsSpaces(state)||n>0&&n<8)?39:0);}
  if(kind==='bookmark-context')return 300;
  if(kind==='bookmark-edit')return 317;
  if(kind==='favorite-edit')return 239;
  // Workspaces (R3-57, R4-48 wireframe 3): the container and the two-line scope head, a 44px two-line row per workspace, New workspace… (39, until
  // eight), Rename… and Icon and color…, Delete workspace, and the 44px way to Profiles with their dividers (406 measured with three, qa/b-popup-heights.mjs).
  // R3-38: a workspace other than the first adds its lock rows after a divider: Lock this workspace (two lines, 53 measured), Lock now + Stop locking (87); a locked one shows Unlock (30) in place of Rename…, Icon and color…, the divider and Delete (−69 in all; 397 measured with three, 27 Oct).
  const lockRows=(id?:string)=>{const list=windowWorkspaces(state),own=list.find(item=>item.id===id);return !own||list[0]?.id===own.id?0:!own.secured?53:own.unlocked?87:-69;};
  // Next / previous workspace (two 30px rows) join New workspace…'s group once there are two workspaces; at eight they keep that group's divider (9).
  if(kind==='workspace-menu'){const count=Math.max(1,windowWorkspaces(state).length),cycle=count>1?60+(count<8?0:9):0;return 235+count*44+(count<8?39:0)+cycle+lockRows(state.activeWorkspaceId);}
  // The sidebar's own menu (target mode 'sidebar'): New workspace… (Add profile…) with its divider (39) and Customize sidebar… (30), in 12px of padding (81 measured, 6 Nov); a workspace's menu gets New workspace… and its divider on top (39) until eight.
  if(kind==='workspace-context'){const target=peekWorkspaceTarget(),n=windowWorkspaces(state).length,canNew=profilesAsSpaces(state)||n>0&&n<8;if(target?.mode==='sidebar')return 42+(canNew?39:0);return 107+(canNew&&!profilesAsSpaces(state)?39:0)+lockRows(target&&'workspaceId' in target?target.workspaceId:undefined);}
  // The form: new has "Start with", its live line and the scope note (472 measured before R4-48, plus a second note line and the scope note), edit does not (384; new 634 measured with R3-38's Lock this workspace row).
  if(kind==='workspace-edit')return peekWorkspaceTarget()?.mode==='edit'?384:634;
  // One 40px row (critique round 6): glyph, input, count, previous, next, close.
  if(kind==='find')return 50;
  // One 32px row on the menu grid (bible §4 Zoom bubble) in the menu container: 44 measured.
  if(kind==='zoom')return 44;
  return 360;
}

/** Kinds whose estimate above is measured for the state it is given; a remembered height would only be staler. */
export const measuredPopupKinds=['tabs','workspace-menu','switcher','palette','bookmarks','profile','menu','more-tools','extensions','downloads','toolbar-context','customize-toolbar','security','tab-context','strip-context','split-context','bookmark-edit','find','zoom','recent-closed','update','whats-new'];
/** The switcher's "Lock this workspace" row (a workspace other than the first, not locked yet) wraps when its words are longer
 *  than the menu (most languages, and "Windows Hello" on Windows), which no estimate knows: that switcher waits for its measured height. */
const lockThisRowShown=(state:BrowserSnapshot)=>{const list=windowWorkspaces(state),own=list.find(item=>item.id===state.activeWorkspaceId);return !!own&&list[0]?.id!==own.id&&!own.secured;};
export const popupEstimateMeasured=(kind:string,state:BrowserSnapshot)=>measuredPopupKinds.includes(kind)&&!(kind==='workspace-menu'&&lockThisRowShown(state));

/** The Acira menu at its 30px rows and at its dense 26px rows: 20 rows (17 + the three Layout rows: View, Tabs, Sidebar mode), four 9px dividers, 12px of container. */
export const menuFullHeight=678,menuDenseHeight=594;
/** F02 (M's sweep, 900×600): when the space below the menu button is shorter than the full menu, the menu takes its dense
 * rows and fits without scrolling. The chrome (geometry) and the overlay (rows) decide with this one rule, from the window
 * and the button, never from the content, so nothing oscillates. */
export function menuDense(viewportHeight:number,anchor?:Rectangle,full=menuFullHeight){const a=anchor||{x:0,y:48,width:36,height:36};return full>viewportHeight-a.y-a.height-20;}
/** The same rule for this profile's own menu: its height follows the rows it holds. */
export const menuDenseFor=(state:BrowserSnapshot,viewportHeight:number,anchor?:Rectangle)=>menuDense(viewportHeight,anchor,mainMenuHeight(state));

export function popupGeometry(kind:string,state:BrowserSnapshot,viewport:{width:number;height:number},source?:Rectangle,naturalHeight?:number,options:{lockedTop?:number;minTop?:number;target?:{contentKind:string};parent?:string;page?:Rectangle;/** Which edge of the popup meets the anchor: 'start' = its left edge at the anchor's x, 'end' = its right edge at the anchor's right. Overrides the kind's own rule (groupEditorPlacement). */align?:'start'|'end'}={}):PopupGeometry {
  if(kind==='suggestions'){
    const anchor=source||{x:120,y:44,width:Math.max(240,viewport.width-360),height:36};
    // The focused field wears a 2px ring at 1px offset, so its visible edge is 3px outside its box: the list is flush with the ring.
    const ring=3,width=Math.max(240,Math.min(anchor.width+ring*2,viewport.width-24)),x=clamp(anchor.x-ring,12,viewport.width-width-12);
    const y=clamp(anchor.y+anchor.height+6,12,viewport.height-72),contentHeight=naturalHeight||60,height=Math.min(contentHeight,viewport.height-y-12);
    return {bounds:{x:Math.round(x),y:Math.round(y),width:Math.round(width),height:Math.round(height)},anchor,origin:{x:.5,y:0},contentHeight};
  }
  // Profiles follow their control; only the tab viewers are window-centred.
  const centered=kind==='tabs'||kind==='switcher'||kind==='whats-new';
  // Menu/panel system (round 9): context menus 260 (the toolbar menu 300: its switch rows carry a shortcut), panels 320; the main menu and More tools 340, so the longest label, shortcut and the switch/chevron column
  // (Search tabs and commands, Ctrl+Shift+K) fit untruncated; search panels (tab viewer, palette) and lists keep theirs.
  const baseWidth=kind==='switcher'?520:kind==='whats-new'?400:['profile','security','protection','tor','extensions','appearance','downloads','favorite-edit','workspace-edit'].includes(kind)?320:kind==='workspace-menu'?280:kind==='workspace-context'?240:kind==='zoom'?280:kind==='workspace-cover'?480:centered?640:kind==='palette'?640:['context','bookmarks'].includes(kind)?420:kind==='split'?400:kind==='toolbar-context'?300:['page-context','tab-context','group-context','split-context','group-preview','strip-context','bookmark-context','bookmark-edit'].includes(kind)?260:kind==='menu'||kind==='more-tools'?340:kind==='customize-toolbar'?320:kind==='toolbar-overflow'?240:360;
  const desiredWidth=Math.max(baseWidth,localeMenuWidth(kind));
  const width=Math.max(240,Math.min(desiredWidth,viewport.width-24));
  const anchor=source||{x:viewport.width-60,y:48,width:36,height:36};
  // F02 (M, 900×600): a menu that can't drop its full height takes its dense rows (menuDense), sized for them at once.
  const natural=popupContentHeight(kind,naturalHeight||popupNaturalHeight(kind,state,{target:options.target,parent:options.parent}));
  const contentHeight=kind==='menu'&&menuDenseFor(state,viewport.height,anchor)?Math.min(natural,mainMenuHeight(state,26)):natural;
  const below=viewport.height-anchor.y-anchor.height-20,above=anchor.y-20;
  // A menu opened at the pointer (a right-click) sits 2px off it and flips up whenever it would not fit below.
  const point=anchor.width<=2&&anchor.height<=2,gap=point?2:8;
  const upwards=kind!=='zoom'&&below<(point?contentHeight:Math.min(contentHeight,280))&&above>below;
  const maxHeight=centered?viewport.height-120:Math.max(100,upwards?above:below);
  const height=Math.min(contentHeight,maxHeight,viewport.height-24);
  const leftAligned=options.align?options.align==='start':['tabs','page-context','tab-context','group-context','split-context','group-preview','strip-context','bookmark-context','favorite-edit','context','split','security','tor','toolbar-context','workspace-menu','workspace-context','workspace-edit'].includes(kind);
  // R3-40: the zoom control is a floating island centred over the page, just below the toolbar (never touching it), and grows
  // from the chip in the address bar that opened it (the surface morphs from the trigger to these bounds).
  const islandX=clamp((options.page?options.page.x+options.page.width/2:viewport.width/2)-width/2,12,viewport.width-width-12);
  const x=kind==='zoom'?islandX:centered||kind==='palette'?(viewport.width-width)/2:kind==='appearance'?clamp(anchor.x+anchor.width+12,12,viewport.width-width-12):clamp(leftAligned?anchor.x:anchor.x+anchor.width-width,12,viewport.width-width-12);
  // Same centring as main's measured pass (desktop/main.cjs acira:set-layout), so the two never disagree.
  const y=centered||kind==='palette'?clamp(options.lockedTop??Math.round(centered?(viewport.height-height)/2:viewport.height*.14),Math.max(12,options.minTop??60),Math.max(12,viewport.height-height-12)):clamp(kind==='zoom'?Math.max(options.minTop??0,anchor.y+anchor.height+gap):upwards?anchor.y-height-gap:anchor.y+anchor.height+gap,12,viewport.height-height-12);
  const origin=centered?{x:.5,y:.5}:{x:clamp((anchor.x+anchor.width/2-x)/width,0,1),y:upwards?1:0};
  return {bounds:{x:Math.round(x),y:Math.round(y),width:Math.round(width),height:Math.round(height)},anchor:centered?{x:Math.round(x+width*.035),y:Math.round(y+height*.035),width:Math.round(width*.93),height:Math.round(height*.93)}:anchor,origin,contentHeight};
}

/** Where a right-click menu opens (R3-48): at the pointer. popupGeometry treats a 2px anchor as a point, so the menu sits 2px
 * off it, flips above it when it would not fit below, and is clamped inside the window with its 12px margin. */
export const pointerAnchor=(x:number,y:number):Rectangle=>({x:Math.max(0,Math.round(x)),y:Math.max(0,Math.round(y)),width:2,height:2});
/** A menu opened from the keyboard (Menu key, Shift+F10) or from a control has no pointer: it hangs under the row's text edge. */
export const rowAnchor=(box:{left:number;bottom:number;top:number;width:number}):Rectangle=>({x:Math.max(0,Math.round(box.left+36)),y:Math.max(0,Math.round(box.bottom-4)),width:2,height:2});
/** Popups that look their trigger up in the page on every layout (the account and extension buttons, a group's chip in the
 * tab strip) instead of using the anchor they were opened with. A group in the sidebar has no chip: its menu keeps the
 * anchor it was opened with, so it appears at the click and not at the toolbar's menu button (the old fallback). */
export const popupFollowsTrigger=(kind:string,hasStripChip:boolean)=>kind==='accounts'||kind==='extensions'||kind==='group-context'&&hasStripChip;

export type GroupEditorPlacement={anchor:Rectangle;align:'start'|'end';side:'below'|'right'|'left'};
/** Where a new group's menu (its name and colour editor) opens: next to the group, pointing at it, like Chrome's tab-group
 * editor (R6 founder bug: it opened at the toolbar's menu button, on the other side of the window, because it was placed
 * before the group's chip or header existed). In a tab strip it hangs under the group's chip, left edges together
 * (popupGeometry flips it above when there is no room below). In the sidebar it opens beside the header: on the right,
 * its top on the header's top (slid up only as far as it must to fit), on the left only when the right has no room, and
 * under the header when neither side has room. The beside anchor is a 2px point, so the measured pass in main
 * (desktop/popup-measure.cjs) keeps the same top: a point's popup sits 4px under it. `height` is the menu's content height. */
export function groupEditorPlacement(header:Rectangle,where:'strip'|'sidebar',viewport:{width:number;height:number},height:number,width=260):GroupEditorPlacement {
  const rect={x:Math.round(header.x),y:Math.round(header.y),width:Math.round(header.width),height:Math.round(header.height)};
  const below:GroupEditorPlacement={anchor:rect,align:'start',side:'below'};
  if(where==='strip')return below;
  const gap=8,margin=12,fits=width+gap+margin;
  // The top the menu takes beside the header; a point anchor 4px above it. 20 = popupGeometry's room rule under a point (2px point + 18).
  const top=Math.round(clamp(rect.y,margin,Math.max(margin,viewport.height-height-20))),y=Math.max(0,top-4);
  if(viewport.width-(rect.x+rect.width)>=fits)return {anchor:{x:rect.x+rect.width+gap,y,width:2,height:2},align:'start',side:'right'};
  if(rect.x>=fits)return {anchor:{x:rect.x-gap-2,y,width:2,height:2},align:'end',side:'left'};
  return below;
}

/** A bounded material reveal. Contents retain their own pixel geometry throughout. */
export function popupClip(origin:{x:number;y:number},width:number,height:number):string {
  const smallWidth=Math.min(38,width),smallHeight=Math.min(34,height);
  const left=clamp(origin.x*width-smallWidth/2,0,width-smallWidth);
  const top=clamp(origin.y*height-smallHeight/2,0,height-smallHeight);
  return `inset(${top}px ${width-left-smallWidth}px ${height-top-smallHeight}px ${left}px round 18px)`;
}
