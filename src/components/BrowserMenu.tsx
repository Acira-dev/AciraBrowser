import { Fragment,useEffect,useRef,useState,type ComponentType,type CSSProperties,type ReactNode } from 'react';
import { MenuToggle } from './MenuToggle';
import { ProtectionIcon } from './ProtectionIcon';
import { formatShortcut, isMac, isTorSupported } from '../ui/platform';
import { menuShortcut } from '../ui/shortcutKeys';
import {runtime} from '../runtime/client';
import { defaultMenuLayout,platformMenuLayout,menuSections,type MenuItemId,type MenuLayout } from '../ui/menuPrefs';
import { ChevronLeft,Code2,FocusRow,PanelLeft,SeamlessRow,Link2,Printer,Trash2,MoreHorizontal,ChevronRight,Columns2,Command,Download,History,Layers3,LayoutGrid,PanelTop,Plus,PrivateWindow,Search,Settings2,Star,Undo2 } from './AppIcons';
import { ExtensionsIcon } from './ToolbarIcon';
import { TorCircuitGlyph, TorGlyph } from '../features/tor/TorChip';
import { copyText } from '../ui/pageActions';
import type { BrowserAction,TabSession } from '../runtime/types';

import '../styles/submenu.css';import './Segmented.css';import '../styles/menu-layout.css';
import type { WindowView } from '../runtime/windowView';import { windowViewName } from '../ui/windowViewText';import { shortcutFor } from '../ui/shortcutKeys';
import { t } from '../i18n';
import { LockKeyhole } from './AppIcons';
import { restartToUpdate,useUpdateReady } from '../features/updates/useUpdateReady';
/** AI-free mode: one switch in the menu. On hides AI answers and AI buttons on websites; the choice is the profile's `aiContent` filter. */
const ShieldGlyph=({size=16}:{size?:number})=><svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true"><path d="M8 1.8 13 3.6v4.1c0 3-2 5.2-5 6.5-3-1.3-5-3.5-5-6.5V3.6z"/></svg>;
function AiFreeRow(){
  const [on,setOn]=useState<boolean|null>(null),busy=useRef(false);
  useEffect(()=>{let alive=true;const read=()=>runtime.service({type:'filters.profile-status'}).then(result=>{if(alive)setOn(!!result.filters?.aiContent);}).catch(()=>{});void read();const unsubscribe=runtime.subscribeBrowser?.(event=>{if(event.type==='filters-changed')void read();});return()=>{alive=false;unsubscribe?.();};},[]);
  // Flips at once (the switch's 140ms thumb) and the menu stays open; it reverts if the profile could not be updated.
  const toggle=()=>{if(on===null||busy.current)return;const next=!on;setOn(next);busy.current=true;void runtime.service({type:'filters.profile-set',patch:{aiContent:next}}).then(result=>setOn(!!result.filters?.aiContent)).catch(()=>setOn(!next)).finally(()=>{busy.current=false;});};
  return <MenuToggle icon={ShieldGlyph} label={t("browsermenu.aiFreeMode")} on={!!on} disabled={on===null} shortcut={formatShortcut('Ctrl Shift X')} onToggle={toggle}/>;
}

/** New Tor identity: the refresh arrow the Tor panel uses for the same action. */
const TorIdentityGlyph=({size=16}:{size?:number})=><svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M13 8a5 5 0 1 1-1.6-3.7"/><path d="M12.5 1.8v3h-3"/></svg>;
/** While an update is downloaded and waiting: "Restart to update" tops the menu (the same action as the toolbar pill). Nothing otherwise. */
const UpdateGlyph=({size=16}:{size?:number})=><svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 13V3.5M4 7.25 8 3.25l4 4"/></svg>;
function UpdateRow({row}:{row:MenuParts['row']}){
  const version=useUpdateReady();
  if(!version)return null;
  return <>{row(t("update.restartRow"),UpdateGlyph,()=>{void restartToUpdate();},undefined,t("update.pillTip",{version}))}<hr/></>;
}
export type BrowserMenuIcon = ComponentType<{size?:number}>;
/** One command of the "More tools" panel: power-user actions that have a key but are rarely reached by mouse. */
export interface BrowserMenuTool {label:string;Icon:BrowserMenuIcon;action:()=>void;hint?:string;disabled?:boolean}

/** The Acira menu (critique rounds 2–3; V02, 25 Oct: it never scrolls at usual window heights): no header, 18 rows in
 * five groups — new tabs, new windows (each plain, private and Tor: one mask, one onion), this page, your library, the
 * browser — with the rarer rows (Your tabs, Search tabs and commands, Focus mode, Extensions) under More tools. Profiles, Appearance and Customize toolbar live in Settings; page actions (Reader, Print,
 * Save, Install as app) live in the site popover; Bookmark this tab sits at the top of Bookmarks.
 * R3-43: which rows sit here, in what order, is the person's choice (menuPrefs.ts, Settings › Appearance › Menu); this is
 * the default. */
export type MenuToolId='print'|'savePage'|'copyAddress'|'devtools'|'clearData';
export interface MenuParts {
  row:(label:string,Icon:BrowserMenuIcon,action:()=>void,hint?:string,tip?:string)=>ReactNode;
  newTab:()=>void;/** New window, private window, Tor window: opens it and closes the menu like every other row that leaves it. */openWindow?:(kind:'normal'|'private'|'tor')=>void;restore:()=>void;open:(kind:string)=>void;navigate:(url:string)=>void;find:()=>void;focus:()=>void;
  focusActive?:boolean;focusEnabled?:boolean;/** R3-68: Seamless is a second toggle beside Focus. */seamless?:()=>void;seamlessActive?:boolean;zoom:ReactNode;tools:Record<MenuToolId,BrowserMenuTool>;
  /** In a Tor tab or window (R3-61): a "New Tor identity" row joins the new-window group; it asks before it does anything. */
  torActive?:boolean;torIdentity?:()=>void;
  /** On a website in Tor: "New Tor circuit for this site" follows the identity row (Tor Browser's pair), on the Seamless view key in Tor. */
  torCircuit?:()=>void;torCircuitKey?:string;
  /** R4-16 + R4-19: the Layout rows (View: Full · Compact · Seamless, Tabs: Top · Sidebar), applied live to the same settings as
   * Settings › Window view and Make it yours. Absent (tests, the preview) means no rows. */
  view?:WindowView;setView?:(view:WindowView)=>void;sidebarTabs?:boolean;setSidebarTabs?:(side:boolean)=>void;
}
const tool=(item:BrowserMenuTool)=><button type="button" className="menu-row" disabled={item.disabled} onClick={item.action}><item.Icon size={16}/><span>{item.label}</span>{item.hint&&<kbd>{formatShortcut(item.hint)}</kbd>}</button>;
/** One node per menu row, so either list can draw any of them. */
function menuNodes(p:MenuParts):Record<MenuItemId,ReactNode>{
  const row=p.row;
  return {
    newTab:row(t("browsermenu.newTab"),Plus,p.newTab,'Ctrl T'),
    newPrivateTab:row(t("browsermenu.newPrivateTab"),PrivateWindow,()=>{void runtime.dispatch({type:'tab.new',privacy:'private'});}),
    newTorTab:row(t("browsermenu.newTorTab"),TorGlyph,()=>{void runtime.dispatch({type:'tab.new',privacy:'tor'});}),
    newWindow:row(t("browsermenu.newWindow"),PanelTop,()=>p.openWindow?p.openWindow('normal'):runtime.openWindow('normal'),'Ctrl N'),
    newPrivateWindow:row(t("browsermenu.newPrivateWindow"),PrivateWindow,()=>p.openWindow?p.openWindow('private'):runtime.openWindow('private'),'Ctrl Shift N'),
    newTorWindow:row(t("browsermenu.newTorWindow"),TorGlyph,()=>p.openWindow?p.openWindow('tor'):runtime.openWindow('tor'),isMac()?'Cmd Alt N':'Alt Shift N'),
    find:row(t("browsermenu.findInPage"),Search,p.find,'Ctrl F'),
    zoom:p.zoom,
    split:row(t("browsermenu.splitView"),Columns2,()=>p.open('split'),'Ctrl Shift S'),
    protection:<button type="button" className="menu-row menu-row-more" aria-haspopup="dialog" onClick={()=>p.open('protection')}><ProtectionIcon/><span>{t('protection.title')}</span><ChevronRight size={14} aria-hidden="true"/></button>,
    aiFree:<AiFreeRow/>,
    bookmarks:<button type="button" className="menu-row menu-row-more" aria-haspopup="dialog" onClick={()=>p.open('bookmarks')}><Star size={16}/><span>{t("browsermenu.bookmarks")}</span><kbd>{formatShortcut('Ctrl Shift O')}</kbd><ChevronRight size={14} aria-hidden="true"/></button>,
    history:row(t("browsermenu.history"),History,()=>p.navigate('acira://history'),'Ctrl H'),
    // Rewind's quick list (it replaced the "Reopen closed tab" row): a drill-in to the last closed tabs; Ctrl+Shift+T still reopens the latest.
    recentlyClosed:<button type="button" className="menu-row menu-row-more" aria-haspopup="dialog" title={t("browsermenu.reopenClosedTab")} onClick={()=>p.open('recent-closed')}><Undo2 size={16}/><span>{t("rewind.recentlyClosed")}</span><kbd>{menuShortcut(t("browsermenu.reopenClosedTab"),'Ctrl Shift T')}</kbd><ChevronRight size={14} aria-hidden="true"/></button>,
    rewind:row(t("browsermenu.rewind"),Layers3,()=>p.navigate('acira://rewind'),'Ctrl Shift H',t("shortcuthints.rewind")),
    downloads:row(t("browsermenu.downloads"),Download,()=>p.open('downloads'),'Ctrl J'),
    allTabs:row(t("browsermenu.allOpenTabs"),LayoutGrid,()=>p.open('tabs'),'Alt T'),
    commands:row(t("browsermenu.searchAndCommands"),Command,()=>p.open('palette'),'Ctrl Shift K'),
    print:tool(p.tools.print),savePage:tool(p.tools.savePage),copyAddress:tool(p.tools.copyAddress),devtools:tool(p.tools.devtools),clearData:tool(p.tools.clearData),
    focus:<MenuToggle icon={FocusRow} label={t("browsermenu.focusMode")} on={!!p.focusActive} disabled={p.focusEnabled===false} shortcut={formatShortcut('Ctrl Shift F')} onToggle={p.focus}/>,
    seamless:<MenuToggle icon={SeamlessRow} label={t("browsermenu.seamless")} on={!!p.seamlessActive} disabled={!p.seamless} shortcut={formatShortcut('Ctrl Shift L')} onToggle={p.seamless??(()=>{})}/>,
    extensions:row(t("browsermenu.extensions"),ExtensionsIcon,()=>p.open('extensions')),
    vpn:row(t('vpn.control.title'),LockKeyhole,()=>p.open('vpn')),
  };
}
/** Glyphs for the Layout rows (16px, 1.5 stroke, the menu's own line weight): one per choice, none shared with another row. */
const glyph=(d:ReactNode)=>({size=16}:{size?:number})=><svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true">{d}</svg>;
const ViewFullGlyph=glyph(<><rect x="2" y="2.75" width="12" height="10.5" rx="2"/><path d="M2 5.75h12M2 8.25h12"/></>);
const ViewCompactGlyph=glyph(<><rect x="2" y="2.75" width="12" height="10.5" rx="2"/><path d="M2 6h12"/></>);
const TabsTopGlyph=glyph(<><rect x="2" y="2.75" width="12" height="10.5" rx="2"/><path d="M2 6.25h12M6.5 2.75v3.5"/></>);
export const menuLayoutViews=['full','compact','seamless'] as const;
const viewGlyph:Record<(typeof menuLayoutViews)[number],BrowserMenuIcon>={full:ViewFullGlyph,compact:ViewCompactGlyph,seamless:SeamlessRow};
const viewShortcut:Record<(typeof menuLayoutViews)[number],[string,string]>={full:['view-full',''],compact:['compact-toolbar',''],seamless:['seamless-mode','Ctrl Shift L']};
/** One joined segmented control on the menu grid (the shared .acira-seg track and sliding thumb, sized for a 30px row). */
function MenuSegment<T extends string>({label,value,options}:{label:string;value:T|undefined;options:readonly {id:T;text?:string;tip:string;Icon:BrowserMenuIcon;choose:()=>void}[]}){
  const index=options.findIndex(option=>option.id===value);
  return <div className={`acira-seg menu-seg${options.some(option=>option.text)?' menu-seg-labelled':''}`} role="radiogroup" aria-label={label} data-empty={index<0||undefined} style={{'--seg-count':options.length,'--seg-index':Math.max(0,index)} as CSSProperties}>
    <span className="acira-seg-thumb" aria-hidden="true"/>
    {options.map(option=><button key={option.id} type="button" role="radio" aria-checked={option.id===value} aria-label={option.text?undefined:option.tip.split(' · ')[0]} title={option.tip} onClick={option.choose}><option.Icon size={16}/>{option.text&&<span>{option.text}</span>}</button>)}
  </div>;
}
/** R4-16 + R4-19: two short rows in the page group, no divider of their own; the menu stays open so the change is seen. */
function LayoutRows({view,setView,sidebarTabs,setSidebarTabs}:Required<Pick<MenuParts,'setView'|'setSidebarTabs'>>&{view?:WindowView;sidebarTabs:boolean}){
  const tip=(mode:(typeof menuLayoutViews)[number])=>{const [id,written]=viewShortcut[mode],key=shortcutFor(id,written||undefined);return key?`${windowViewName(mode)} · ${key}`:windowViewName(mode);};
  return <div className="menu-layout" role="group" aria-label={`${t("browsermenu.view")} · ${t("yours.tabs")}`}>
    <div className="menu-layout-row"><span>{t("browsermenu.view")}</span><MenuSegment label={t("browsermenu.view")} value={view} options={menuLayoutViews.map(mode=>({id:mode,tip:tip(mode),Icon:viewGlyph[mode],choose:()=>setView(mode)}))}/></div>
    <div className="menu-layout-row"><span>{t("yours.tabs")}</span><MenuSegment label={t("yours.tabs")} value={sidebarTabs?'side':'top'} options={[{id:'top',text:t("browsermenu.tabsTop"),tip:t("yours.tabsTop"),Icon:TabsTopGlyph,choose:()=>setSidebarTabs(false)},{id:'side',text:t("browsermenu.tabsSidebar"),tip:t("yours.tabsSide"),Icon:PanelLeft,choose:()=>setSidebarTabs(true)}] as const}/></div>
  </div>;
}
/** Where the Layout rows sit: after Split view (or Zoom, or Find) in the person's main list; nowhere when the page group is gone. */
export const menuLayoutAnchor=(ids:readonly MenuItemId[]):MenuItemId|undefined=>(['split','zoom','find'] as const).find(id=>ids.includes(id));
/** `extra` is a row that is not the person's to arrange (the Tor-only "New Tor identity"): it follows the row `after`, or the foot of the list. */
function MenuList({ids,nodes,extra,after,insert}:{ids:readonly MenuItemId[];nodes:Record<MenuItemId,ReactNode>;extra?:ReactNode;after?:MenuItemId;insert?:{after:MenuItemId;node:ReactNode}}){
  return <>{menuSections(ids).map((section,index)=><Fragment key={section[0]}>{index>0&&<hr/>}{section.map(id=><Fragment key={id}>{nodes[id]}{id===after&&extra}{id===insert?.after&&insert.node}</Fragment>)}</Fragment>)}{!after&&extra}</>;
}
export function BrowserMenu({layout=defaultMenuLayout,torActive=false,torIdentity,torCircuit,torCircuitKey,...parts}:MenuParts&{layout?:MenuLayout}) {
  layout=platformMenuLayout(layout);
  const nodes=menuNodes(parts),row=parts.row;
  // R3-61: the identity row sits with the new-window group (after New Tor window); with that row moved or hidden it closes the list. Popup height counts it in a Tor context (popup.ts).
  const identity=torActive&&torIdentity&&row(t("tornewtab.newTorIdentity"),TorIdentityGlyph,torIdentity,'Ctrl Shift U'),circuit=identity&&torCircuit&&row(t("tor.circuit.new"),TorCircuitGlyph,torCircuit,torCircuitKey),torRows=identity&&<>{identity}{circuit}</>;
  const anchor=menuLayoutAnchor(layout.main),layoutRows=anchor&&parts.setView&&parts.setSidebarTabs?{after:anchor,node:<LayoutRows view={parts.view} setView={parts.setView} sidebarTabs={!!parts.sidebarTabs} setSidebarTabs={parts.setSidebarTabs}/>}:undefined;
  return <>
    {import.meta.env.DEV&&<><div className="menu-preview-label">{t('menu.localPreview')}</div><button type="button" className="menu-row" onClick={()=>{const channel=new BroadcastChannel('acira-live-preview');channel.postMessage('refresh');channel.close();}}><UpdateGlyph size={16}/><span>{t('menu.refreshPreview')}</span></button><hr/></>}
    <UpdateRow row={row}/>
    <MenuList ids={layout.main} nodes={nodes} extra={torRows} after={identity&&layout.main.includes('newTorWindow')?'newTorWindow':undefined} insert={layoutRows}/>
    {layout.main.length>0&&<hr/>}
    {layout.more.length>0&&<button type="button" className="menu-row menu-row-more" aria-haspopup="menu" onClick={()=>parts.open('more-tools')}><MoreHorizontal size={16}/><span>{t("browsermenu.moreTools")}</span><ChevronRight size={14} aria-hidden="true"/></button>}
    {row(t("browsermenu.settings"),Settings2,()=>parts.navigate('acira://settings'),'Ctrl ,')}
  </>;
}

/** More tools: what the Acira menu keeps one step away (finding tabs, Focus mode, Extensions), in the same rows and columns. */
export function MoreToolsMenu({layout=defaultMenuLayout,...parts}:MenuParts&{layout?:MenuLayout}) {
  layout=platformMenuLayout(layout);
  return <MenuList ids={layout.more} nodes={menuNodes(parts)}/>;
}

/** R3-42: the one way back from a submenu. A header row with a back chevron and the submenu's title; Left, Backspace and Esc
 * do the same (App's popup keyboard handler). The whole row is the button, so the title is a target too. */
export const submenuKinds:readonly string[]=['more-tools','bookmarks','protection','split','downloads','recent-closed'];
export function SubmenuBack({title,onBack}:{title:ReactNode;onBack:()=>void}){
  return <button type="button" className="popup-back" aria-label={t("app.backToMenu")} data-popup-back onClick={onBack}><ChevronLeft size={16} aria-hidden="true"/><strong>{title}</strong></button>;
}

/** The page commands in More tools. Each runs on the tab the menu was opened for and closes the menu. */
export function menuTools(tab:TabSession,close:()=>void,dispatch:(action:BrowserAction)=>unknown):Record<MenuToolId,BrowserMenuTool>{
  const page=/^(https?|file):/i.test(tab.url),run=(type:'print'|'save-page'|'devtools'|'clear-data')=>()=>{void runtime.browserCommand({type,tabId:tab.id});close();};
  return {
    print:{label:t("browsermenu.print"),Icon:Printer,action:run('print'),hint:'Ctrl P',disabled:!page},
    savePage:{label:t("browsermenu.savePageAs"),Icon:Download,action:run('save-page'),disabled:!page},
    copyAddress:{label:t("browsermenu.copyPageAddress"),Icon:Link2,hint:'Ctrl Shift C',disabled:!page,action:()=>{void copyText(tab.url).then(()=>dispatch({type:'toast',text:t("browsermenu.linkCopied")}),()=>dispatch({type:'toast',text:t("browsermenu.couldNotCopyTheLink"),tone:'error'}));close();}},
    devtools:{label:t("browsermenu.developerTools"),Icon:Code2,action:run('devtools'),hint:'F12',disabled:!page},
    clearData:{label:t("browsermenu.clearBrowsingData"),Icon:Trash2,action:run('clear-data'),hint:'Ctrl Shift Delete'},
  };
}
