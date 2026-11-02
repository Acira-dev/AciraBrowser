import {DotMatrix} from '../components/DotMatrix';
import { AnimatePresence,motion } from 'motion/react';
import { useEffect,useId,useLayoutEffect,useRef,useState,type CSSProperties,type FormEvent,type MouseEvent,type ReactNode } from 'react';
import { AddressField } from '../components/AddressField';
import { ArrowRight,ArrowUpRight,Bookmark,Eye,ChevronDown,Clock3,PanelsTopLeft,Plus,Search,Settings2,Star,X,type LucideIcon } from '../components/AppIcons';
import { BrandLogo } from '../components/BrandLogo';
import { EditorGlyph,type EditorIconName } from '../components/EditorGlyph';
import { Formation } from '../components/Formation';
import {GroupNameInput,useGroupRename} from '../components/TabGroupTray';
import { PreviewIcon } from '../components/PreviewIcon';
import { SiteIdentityIcon } from '../components/SiteIdentityIcon';
import { Spinner } from '../components/Spinner';
import { sidebarPatch,workspaceIsOpen } from '../runtime/browserChrome';
import { runtime } from '../runtime/client';
import { groupForTab } from '../runtime/tabGroups';
import type { BrowserAction,BrowserSnapshot,TabGroup,TabGroupColor,TabSession } from '../runtime/types';
import '../styles/sidebar-controls.css';
import { bookmarkContext,openPage,savedPageIdentity } from '../ui/pageActions';
import { toggleRailSection,useRailPrefs } from '../ui/railPrefs';
import { focusSidebarControl } from '../ui/sidebarFocus';
import { tabGroupColor } from '../ui/theme';
import { useBufferedDraft } from '../ui/useBufferedDraft';
import {useNewTabPreferences} from '../ui/newTabPreferences';
import '../styles/new-tab.css';
import { openWorkspacePage,selectWorkspaceView as selectView,useWorkspaceView } from '../ui/workspaceView';
import { BookmarksManager } from './BookmarksManager';
import { NewTabPage } from './newtab/NewTabPage';
import { TorNewTab } from './tor/TorNewTab';import { openSettings } from '../ui/settingsView';import { PrivateNewTab } from './newtab/PrivateNewTab';import { isPrivateNewTab } from './newtab/pages';import { isTorWindow, torDownloadsActive } from './tor/torClient';
import { t } from '../i18n';
type Dispatch = (action: BrowserAction) => void;
const title = (tab: TabSession) => ['acira://home', 'acira://new'].includes(tab.url) ? t("browsermenu.newTab") : tab.title;
const address = (url: string) => url.replace(/^https?:\/\//, '').replace(/\/$/, '');
const savedTitle = (url: string, state: BrowserSnapshot) => savedPageIdentity(url, state).title || address(url);
function popup(state: BrowserSnapshot, kind: string, target: HTMLElement,targetTabId?:string) {
    const { x, y, width, height } = target.getBoundingClientRect();
    void runtime.browserCommand({ type: 'ui', tabId: state.activeTabId, action: 'open', kind,...(targetTabId?{targetTabId}:{}), anchor: { x, y, width, height } });
}
function RailButton({ label, icon, current, onClick, badge, count, children, popupTrigger = false, text, glyph }: {
    glyph?: EditorIconName;
    text?: string;
    label: string;
    icon?: LucideIcon;
    current?: boolean;
    onClick: (target: HTMLButtonElement) => void;
    badge?: boolean;
    count?: number;
    children?: ReactNode;
    popupTrigger?: boolean;
}) {
    return <button className="ed-rail-button" aria-label={count ? `${label}, ${count} active` : label} aria-current={current ? 'page' : undefined} data-tooltip={label} data-popup-trigger={popupTrigger || undefined} onClick={event => onClick(event.currentTarget)}>
    {glyph ? <EditorGlyph name={glyph}/> : icon ? <PreviewIcon icon={icon} size={18}/> : children}<span className="ed-rail-label" aria-hidden="true">{text || label}</span>{count ? <span className="ed-rail-count" aria-hidden="true">{count}</span> : null}{badge && <span className="ed-rail-badge"/>}
  </button>;
}
export function ExperimentRail({ state, dispatch }: {
    state: BrowserSnapshot;
    dispatch: Dispatch;
}) {
    const view = useWorkspaceView(state.activeTabId);
    const current = state.tabs.find(tab => tab.id === state.activeTabId)!;
    const onStart = ['acira://new', 'acira://home'].includes(current.url);
    const expanded = workspaceIsOpen(state.windowUi, current);
    const toggle = () => {
        focusSidebarControl(!expanded);
        dispatch({ type: 'ui.update', patch: sidebarPatch(!expanded) });
    };
    const profile = state.browserProfiles.find(item => item.id === current.browserProfileId);
    const enabled = false;
    const navigate = (page: string) => openWorkspacePage(page, state, dispatch);
    const prefs = useRailPrefs(current.browserProfileId,profile?.private),[newTab]=useNewTabPreferences(current.browserProfileId,profile?.private), reduced = state.settings.reducedMotion;
    const groups = state.tabGroups.filter(group=>group.browserProfileId===current.browserProfileId).map(group => ({ group, members: state.tabs.filter(tab => groupForTab(state, tab)?.id === group.id) })).filter(item => item.members.length);
    // Finished and stopped agents stay one glance away; newest first, as runs are stored.
    const profileTabs = state.tabs.filter(tab => tab.browserProfileId === current.browserProfileId);
    const section = (id: string, label: string, body: ReactNode, extra?: {
        count?: number;
        action?: ReactNode;
    }) => <RailSection profileId={current.browserProfileId} privateMode={profile?.private} id={id} title={label} folded={!!prefs.folded[id]} reduced={reduced} count={extra?.count} action={extra?.action}>{body}</RailSection>;
    const groupDot = (color: TabGroupColor) => ({ background: color === 'none' ? 'rgb(var(--ink) / .3)' : tabGroupColor(color) });
    const tabRow = (tab: TabSession) => {
    
        return <div className="ed-rail-tab" key={tab.id} aria-current={tab.id === state.activeTabId || undefined} onContextMenu={event=>{event.preventDefault();event.stopPropagation();popup(state,'tab-context',event.currentTarget,tab.id);}} onKeyDown={event=>{if(event.key==='ContextMenu'||event.shiftKey&&event.key==='F10'){event.preventDefault();event.stopPropagation();popup(state,'tab-context',event.currentTarget,tab.id);}}}>
    <button title={`${title(tab)} · ${tab.url}`} onClick={() => dispatch({ type: 'tab.select', id: tab.id })}>{tab.loading && tab.contentKind === 'web' ? <DotMatrix preset="loader" size={14} reducedMotion={state.settings.reducedMotion}/> : <SiteIdentityIcon url={tab.url} favicon={tab.favicon} size={16}/>}<span>{title(tab)}</span></button>
    <button className="ed-icon" aria-label={t("app.closeTitle",{title:title(tab)})} onClick={() => dispatch({ type: 'tab.close', id: tab.id })}><PreviewIcon icon={X} size={13}/></button>
  </div>;
    };
    const openFavorite=(event:MouseEvent<HTMLButtonElement>,url:string)=>{if(![0,1].includes(event.button))return;event.preventDefault();if(event.button===1||event.ctrlKey||event.metaKey||event.shiftKey){dispatch({type:'tab.new',url,browserProfileId:current.browserProfileId,background:!event.shiftKey});return;}const existing=state.tabs.find(tab=>tab.browserProfileId===current.browserProfileId&&tab.url===url);dispatch(existing?{type:'tab.select',id:existing.id}:{type:'tab.new',url,browserProfileId:current.browserProfileId});};
    const openSaved = (event: MouseEvent<HTMLButtonElement>, url: string) => openPage(event, url, dispatch, next => dispatch({ type: 'tab.navigate', url: next }));
    return <aside className={`ed-rail ${expanded ? 'is-expanded' : ''}`} aria-label={t("frostworkspace.aciraNavigation")} aria-hidden={!expanded} inert={!expanded}>
    <div className="ed-rail-brand"><RailButton label={t("frostworkspace.aciraWorkspace")} onClick={() => selectView('home', state, dispatch)}><BrandLogo mark={!expanded}/></RailButton>{expanded && <><button className="ed-icon" aria-label={t("app.collapseSidebar")} onClick={toggle}><EditorGlyph name="collapse"/></button></>}</div>
    <nav aria-label={t("frostworkspace.workspaceNavigation")}>
      <RailButton label={t("frostworkspace.searchTabsAltT")} glyph="search" text="Search tabs" icon={Search} popupTrigger onClick={target => popup(state, 'tabs', target)}/>
      <RailButton label={t("frostworkspace.workspace")} glyph="workspace" icon={PanelsTopLeft} current={onStart && view === 'home'} onClick={() => selectView('home', state, dispatch)}/>
      <RailButton label={t("browsermenu.bookmarks")} glyph="bookmarks" icon={Bookmark} current={onStart && view === 'bookmarks'} onClick={() => selectView('bookmarks', state, dispatch)}/>
      <RailButton label={t("browsermenu.downloads")} glyph="Download" current={current.url==='acira://downloads'} onClick={()=>navigate('downloads')}/>
      <RailButton label={t("browsermenu.history")} glyph="history" icon={Clock3} current={current.url === 'acira://history'} onClick={() => navigate('history')}/>
      
    </nav>
    {newTab.shortcuts.some(item=>item.sidebar)&&<nav className="ed-rail-apps" aria-label={t("frostworkspace.favoriteApps")}>{newTab.shortcuts.filter(item=>item.sidebar).map(item=><button type="button" className="ed-rail-app" key={item.id} title={item.title+' · '+item.url} aria-label={item.title} aria-current={current.url===item.url?'page':undefined} onClick={event=>openFavorite(event,item.url)} onAuxClick={event=>openFavorite(event,item.url)}><SiteIdentityIcon url={item.url} favicon={savedPageIdentity(item.url,state).favicon} size={20}/><span className="ed-rail-app-label">{item.title}</span></button>)}</nav>}
    {/* Everything below folds per section, so the sidebar holds what you use and hides the rest. */}
    {expanded && <div className="ed-rail-sections">
      
      {prefs.tabs && section('tabs', 'Tabs', <>
        {profileTabs.filter(tab => !groupForTab(state, tab)).map(tabRow)}
        {groups.map(({group,members})=><SidebarGroup key={group.id} group={group} members={members} state={state} dispatch={dispatch} showMembers>{members.map(tabRow)}</SidebarGroup>)}
        <button className="ed-rail-new-tab" onClick={() => dispatch({ type: 'tab.new' })}><PreviewIcon icon={Plus} size={14}/><span>{t("browsermenu.newTab")}</span></button>
      </>, { count: profileTabs.length })}
      {section('saved', 'Bookmarks', <>
        {state.bookmarks.slice(0, 6).map(url => <button key={url} title={url} onClick={event => openSaved(event, url)} onAuxClick={event => openSaved(event, url)} onContextMenu={event => bookmarkContext(event, url, state)}><SiteIdentityIcon url={url} favicon={savedPageIdentity(url, state).favicon} size={16}/><span>{savedTitle(url, state)}</span></button>)}
        {!state.bookmarks.length && <p>{t("frostworkspace.pagesYouSaveAppearHere")}</p>}
      </>, { action: <button className="ed-icon" aria-label={t("frostworkspace.showAllBookmarks")} onClick={() => selectView('bookmarks', state, dispatch)}><PreviewIcon icon={ArrowUpRight}/></button> })}
      {!prefs.tabs && groups.length > 0 && section('groups','Tab groups',groups.map(({group,members})=><SidebarGroup key={group.id} group={group} members={members} state={state} dispatch={dispatch}/>),{count:groups.length})}
      
    </div>}
    <footer><RailButton label={t("browsermenu.settings")} glyph="settings" icon={Settings2} current={current.url === 'acira://settings'} onClick={() => navigate('settings')}/><RailButton label={t("app.switchProfile")} text={profile?.name || 'Personal'} popupTrigger onClick={target => popup(state, 'profile', target)}><span className="ed-profile-initial">{state.browserProfiles.find(profile => profile.id === current.browserProfileId)?.name[0] || 'P'}</span></RailButton></footer>
  </aside>;
}
/** Reuse the tab strip's validated inline name editor and persisted group state. */
function SidebarGroup({group,members,state,dispatch,showMembers=false,children}:{group:TabGroup;members:TabSession[];state:BrowserSnapshot;dispatch:Dispatch;showMembers?:boolean;children?:ReactNode}){
 const root=useRef<HTMLDivElement>(null),editor=useGroupRename(root),active=members.some(tab=>tab.id===state.activeTabId);
 const context=(node:HTMLElement)=>popup(state,'group-context',node,(members.find(tab=>tab.id===group.lastActiveTabId)||members[0]).id);
 const select=()=>{if(showMembers)dispatch({type:'tab.group.update',id:group.id,patch:{collapsed:!group.collapsed}});else dispatch({type:'tab.select',id:(members.find(tab=>tab.id===group.lastActiveTabId)||members[0]).id});};
 return <div ref={root} className="ed-rail-tab-group" data-sidebar-group={group.id} onContextMenu={event=>{event.preventDefault();context(event.currentTarget);}} onKeyDown={event=>{if(!editor.editing&&(event.key==='ContextMenu'||event.shiftKey&&event.key==='F10')){event.preventDefault();context(event.currentTarget);}}}>
  {editor.editing?<GroupNameInput group={group} groups={state.tabGroups} onSave={name=>dispatch({type:'tab.group.update',id:group.id,patch:{name}})} onCancel={editor.stop}/>:<button type="button" className="ed-rail-tab-group-name" aria-label={`${group.name}, ${members.length} tabs`} aria-current={active?'page':undefined} aria-expanded={showMembers?!group.collapsed:undefined} onClick={select} onDoubleClick={editor.start}><i className="ed-group-dot" style={{background:tabGroupColor(group.color)}}/><span>{group.name}</span><small>{members.length}</small>{showMembers&&<PreviewIcon icon={ChevronDown} size={12}/>}</button>}
  {showMembers&&<motion.div className="ed-rail-group-members" initial={false} animate={{height:group.collapsed?0:'auto',opacity:group.collapsed?0:1}} transition={{duration:state.settings.reducedMotion?0:.26,ease:[.16,1,.3,1]}} inert={group.collapsed||undefined} aria-hidden={group.collapsed||undefined}>{children}</motion.div>}
 </div>;
}
/** A sidebar section that folds away; the choice is remembered on this device. */
function RailSection({ id, title, folded, reduced, count, action, children,profileId,privateMode }: {
    profileId:string;privateMode?:boolean;
    id: string;
    title: string;
    folded: boolean;
    reduced: boolean;
    count?: number;
    action?: ReactNode;
    children: ReactNode;
}) {
    return <section className="ed-rail-section" aria-label={title} data-open={!folded}>
    <header><button type="button" className="ed-rail-section-toggle" aria-expanded={!folded} onClick={() => toggleRailSection(id,profileId,privateMode)}><PreviewIcon icon={ChevronDown} size={12}/><span>{title}</span>{count ? <small>{count}</small> : null}</button>{action}</header>
    <AnimatePresence initial={false}>{!folded && <motion.div className="ed-rail-section-body" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: reduced ? 0 : .26, ease: [.16, 1, .3, 1] }}>{children}</motion.div>}</AnimatePresence>
  </section>;
}
type Props = {
    state: BrowserSnapshot;
    dispatch: Dispatch;
    onNavigate: (url: string) => void;
    /** acira://bookmarks opens straight on the library. */
    view?: 'bookmarks';
};
function PageRow({ url, name, detail, favicon, onOpen, onContextMenu, compact = false }: {
    compact?: boolean;
    url: string;
    name: string;
    detail?: string;
    favicon?: string;
    onOpen: (event: MouseEvent<HTMLButtonElement>) => void;
    onContextMenu?: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
    return <button className={`ed-page-row ${compact ? 'ed-page-row-compact' : ''}`} title={`${name} · ${url}`} onClick={onOpen} onAuxClick={onOpen} onContextMenu={onContextMenu}><SiteIdentityIcon url={url} favicon={favicon} size={16}/><strong>{name}</strong><span>{detail || address(url)}</span><PreviewIcon icon={ArrowUpRight}/></button>;
}
export function GlassWorkspace({ state, dispatch, onNavigate, view: openOn }: Props) {
    const tab = state.tabs.find(item => item.id === state.activeTabId)!;
    const storedView = useWorkspaceView(tab.id), view = openOn ?? storedView;
    if (view === 'bookmarks') return <BookmarksManager state={state} dispatch={dispatch} onNavigate={onNavigate}/>;
    if (isTorWindow(state)) return <TorNewTab onNavigate={onNavigate} reducedMotion={state.settings.reducedMotion} downloading={torDownloadsActive(state)} onBridgeSettings={() => openSettings(state, dispatch, { section: 'Connection', setting: 'tor-bridges' })}/>;
    if (isPrivateNewTab(Boolean(state.browserProfiles.find(profile => profile.id === tab.browserProfileId)?.private), tab.privacy as string | undefined)) return <PrivateNewTab onNavigate={onNavigate} reducedMotion={state.settings.reducedMotion}/>;
    return <NewTabPage state={state} tab={tab} dispatch={dispatch} onNavigate={onNavigate}/>;
}

