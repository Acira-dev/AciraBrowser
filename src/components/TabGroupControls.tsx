import { useEffect,useLayoutEffect,useRef,useState,type ReactNode } from 'react';
import { groupForTab,TAB_GROUP_COLORS } from '../runtime/tabGroups';
import type { BrowserAction,BrowserSnapshot,TabGroup,TabGroupColor,TabSession } from '../runtime/types';
import { tabGroupColor } from '../ui/theme';
import { Check,ChevronLeft,ChevronRight,Copy,Folder,Layers3,Plus,Slash } from './AppIcons';
import { WorkspaceGlyph,workspaceIcon } from './WorkspaceGlyph';
import { profilesAsSpaces, windowWorkspaces } from '../runtime/workspaces';
import { shownName } from '../features/workspaces/WorkspaceSwitcher';
import { openWorkspacePopupFromPopup } from '../ui/workspaceTarget';
import './TabGroups.css';
import { MenuFormFlyout } from './MenuFormFlyout';
import { newTabInGroupActions } from './sidebar/sidebarActions';

import { t,type MessageId } from '../i18n';
export function nextGroupName(state:Pick<BrowserSnapshot,'tabGroups'>,profile:string){let name=t('tabgroupcontrols.newGroup'),suffix=2;while(state.tabGroups.some(group=>group.browserProfileId===profile&&group.name===name))name=t('tabgroupcontrols.newGroupN',{number:suffix++});return name;}
/** The runtime client, loaded once the group menu is on screen, so creating a group needs no module wait. */
type Runtime=typeof import('../runtime/client')['runtime'];
let runtimeNow:Runtime|undefined;
const loadRuntime=()=>import('../runtime/client').then(module=>runtimeNow=module.runtime);
/** New groups open a shared name/color editor from both the menu and sidebar. R6: the create and the editor's open are sent
 * at once, in order, from the click (before the tab menu starts closing, which kept this page busy about 85 ms), so the
 * editor shows on the next frame of the window. */
export async function createInlineGroup(state:BrowserSnapshot,tabId?:string){
 const runtime=runtimeNow??await loadRuntime();
 let tab=state.tabs.find(tab=>tab.id===tabId);
 if(!tab){await runtime.dispatch({type:'tab.new',browserProfileId:state.activeBrowserProfileId});const next=await runtime.getSnapshot();tab=next.tabs.find(tab=>tab.id===next.activeTabId);state=next;}
 if(!tab)return;
 const created=runtime.dispatch({type:'tab.group.create',tabId:tab.id,name:nextGroupName(state,tab.browserProfileId),color:'blue'});
 const opened=runtime.browserCommand({type:'ui',tabId:tab.id,action:'open',kind:'group-context',targetTabId:tab.id});
 await Promise.all([created,opened]);
}
export function requestInlineRename(groupId:string){
 const nodes=[...document.querySelectorAll<HTMLElement>(`[data-group-header="${CSS.escape(groupId)}"], [data-sidebar-group="${CSS.escape(groupId)}"]`)];
 const node=nodes.find(node=>!node.closest('[inert]')&&node.getClientRects().length);
 // It bubbles: a sidebar group that shows its tabs listens on its whole block, not on the header row that carries the id (R6: Rename from its menu did nothing there).
 node?.dispatchEvent(new Event('acira-group-rename',{bubbles:true}));
}

export function TabGroupControls({state,tab,dispatch,scope='tab',close=()=>{}}:{state:BrowserSnapshot;tab:TabSession;dispatch:(action:BrowserAction)=>void;scope?:'tab'|'group';close?:()=>void}){
 const command=async(value:import('../runtime/types').BrowserCommand)=>{const {runtime}=await import('../runtime/client');return runtime.browserCommand(value);};
 const group=groupForTab(state,tab),[section,setSection]=useState<'groups'|'close'|'workspaces'|null>(null),own=windowWorkspaces(state),spaces=own.filter(item=>item.id!==state.activeWorkspaceId);
 const menu=useRef<HTMLElement>(null),previousSection=useRef<typeof section>(null);
 /** The rows that open a section, in the active language: the focus-restore below finds the row it came from by its text. */
 const labels={groups:t('tabgroupcontrols.moveToTabGroup'),close:t('tabgroupcontrols.closeGroup'),workspaces:t('workspaces.moveTo')};
 useEffect(()=>{if(!runtimeNow)void loadRuntime().catch(()=>{});},[]);
 useLayoutEffect(()=>{const previous=previousSection.current;previousSection.current=section;if(!section&&!previous)return;const nodes=[...menu.current?.querySelectorAll<HTMLButtonElement>('[role=menuitem]')||[]],target=section==='close'?nodes.at(-1):section?nodes[0]:nodes.find(node=>node.textContent?.trim()===labels[previous!]);target?.focus({preventScroll:true});},[section]);
 useLayoutEffect(()=>{const parent=menu.current?.parentElement;if(!parent||scope!=='tab')return;if(section==='groups'||section==='workspaces')parent.setAttribute('data-drilled','');else parent.removeAttribute('data-drilled');return()=>parent.removeAttribute('data-drilled');},[section,scope]);
 const members=state.tabs.filter(item=>groupForTab(state,item)?.id===group?.id);
 const available=state.tabGroups.filter(item=>item.browserProfileId===tab.browserProfileId&&item.id!==group?.id&&state.tabs.some(tab=>groupForTab(state,tab)?.id===item.id));
 const run=(action:BrowserAction)=>{dispatch(action);close();};
 const item=(label:string,action:()=>void,icon?:ReactNode,sub:boolean|'dialog'=false,danger=false)=><button type="button" className="menu-row group-menu-row" role="menuitem" data-danger={danger||undefined} aria-haspopup={sub==='dialog'?'dialog':sub?'menu':undefined} onClick={action} onKeyDown={event=>{if(sub===true&&event.key==='ArrowRight'){event.preventDefault();event.stopPropagation();action();}}}>{icon}<span>{label}</span>{sub===true&&<ChevronRight size={12}/>}</button>;
 const back=()=>item(scope==='group'?t('app.groupActions'):t('app.tabActions'),()=>setSection(null),<ChevronLeft size={14}/>);
 if(scope==='group'&&!group)return null;
 return <section ref={menu} className="tab-group-controls" role="menu" aria-label={section==='groups'?t("tabgroupcontrols.moveToTabGroup"):section==='workspaces'?t('workspaces.moveTo'):t("tabgroupcontrols.tabGroupActions")} onKeyDown={event=>{if(section&&['ArrowLeft','Escape'].includes(event.key)){event.preventDefault();event.stopPropagation();setSection(null);}}}>
  {section==='groups'?<>{back()}<hr/>{available.map(target=>item(target.name,()=>run({type:'tab.group.assign',tabIds:[tab.id],groupId:target.id}),<Copy size={15} style={{color:tabGroupColor(target.color)}}/>))}{available.length>0&&<hr/>}{/* R6: it opens the new group's editor (a dialog), so no 80ms pick blink before it (popupPick PICK_SKIP). */item(t('tabgroupcontrols.newTabGroup'),()=>{const created=createInlineGroup(state,tab.id);close();void created;},<Plus size={15}/>,'dialog')}</>:
  section==='workspaces'?<>{back()}<hr/>{spaces.map(target=>item(shownName(target),()=>run({type:'workspace.move-tabs',tabIds:[tab.id],workspaceId:target.id}),<WorkspaceGlyph icon={workspaceIcon(target)}/>))}{spaces.length>0&&own.length<8&&<hr/>}{own.length<8&&item(t('workspaces.new'),()=>{close();setTimeout(()=>openWorkspacePopupFromPopup(state,'workspace-edit',{mode:'new',start:'current',tabId:tab.id}),0);},<Plus size={15}/>)}</>:
  section==='close'?<>{item(t('tabgroupcontrols.closeTabsN',{count:members.length}),()=>{members.forEach(member=>dispatch({type:'tab.close',id:member.id}));close();},undefined,false,true)}{item(t('dialog.cancel'),()=>setSection(null))}</>:
  scope==='tab'?<>{/* Private and Tor tabs take no group (runtime/tabGroups.ts): the row was offered anyway, and "New tab group" opened an empty menu for a group that was never made. */(!tab.privacy||tab.privacy==='secured')&&item(labels.groups,()=>setSection('groups'),<Folder size={15}/>,true)}{group&&item(t('acirasidebar.splitRemoveFromGroup'),()=>run({type:'tab.group.assign',tabIds:[tab.id],groupId:null}))}{/* R4-48: always offered outside private windows, so Move to › New workspace… is a way in even with one workspace. */own.length>0&&!tab.privacy&&!profilesAsSpaces(state)&&item(t('workspaces.moveTo'),()=>setSection('workspaces'),<Layers3 size={15}/>,true)}</>:
  group&&<><MenuFormFlyout title={`${t('main.edit')} ${group.name}`}>{dismiss=><GroupEditor key={group.id} group={group} groups={state.tabGroups} dispatch={dispatch} close={dismiss}/>}</MenuFormFlyout><hr/>{item(t('acirasidebar.newTabInGroup'),()=>{/* The same actions as the header's "+": the tab is named and placed after the group's last tab by its own action, then joined. A plain new tab was appended at the end of the list first, and the sidebar (new tabs at the top) moved it out of the group again. */newTabInGroupActions(group,members.at(-1)?.id,tab.browserProfileId,'tab-'+crypto.randomUUID()).forEach(dispatch);close();},<Plus size={15}/>)}
   {item(t('tabgroupcontrols.copyLinks'),()=>{void navigator.clipboard.writeText(members.map(tab=>tab.url).join('\n')).then(close).catch(()=>dispatch({type:'toast',text:t("tabgroupcontrols.couldnTCopyTheLinks"),tone:'error'}));},<Copy size={15}/>)}<hr/>
   {item(t('acirasidebar.splitRename'),()=>{close();void command({type:'ui',tabId:tab.id,action:'rename-group',targetTabId:tab.id});})}
   {item(group.collapsed?t('tabgroupcontrols.expandGroup'):t('tabgroupcontrols.collapseGroup'),()=>run({type:'tab.group.update',id:group.id,patch:{collapsed:!group.collapsed}}))}
   <hr/>
   {item(t('tabgroupcontrols.ungroupTabs'),()=>run({type:'tab.group.remove',id:group.id}))}{item(labels.close,()=>setSection('close'))}

  </>}
 </section>;
}


/** A group colour's name in the active language (the workspace colours use the same names). */
const COLOR_NAMES:Record<TabGroupColor,MessageId>={none:'tabgroupcontrols.noColor',grey:'workspaces.colorGrey',blue:'workspaces.colorBlue',red:'workspaces.colorRed',yellow:'workspaces.colorYellow',green:'workspaces.colorGreen',pink:'workspaces.colorPink',purple:'workspaces.colorPurple',cyan:'workspaces.colorCyan',orange:'workspaces.colorOrange'};
const colorName=(color:TabGroupColor)=>t(COLOR_NAMES[color]);
/** Immediate color preview shares state with the sidebar without retinting trays. */
function GroupEditor({group,groups,dispatch,close}:{group:TabGroup;groups:TabGroup[];dispatch:(action:BrowserAction)=>void;close:()=>void}){
 const [name,setName]=useState(group.name),[invalid,setInvalid]=useState(false);
 const save=()=>{const value=name.trim();if(!value||groups.some(other=>other.id!==group.id&&other.browserProfileId===group.browserProfileId&&other.name===value)){setInvalid(true);return false;}setInvalid(false);if(value!==group.name)dispatch({type:'tab.group.update',id:group.id,patch:{name:value}});return true;};
 return <div className="menu-form-fields"><label>{t("tabgrouptray.groupName")}<input autoFocus aria-label={t("tabgrouptray.groupName")} aria-invalid={invalid||undefined} value={name} maxLength={64} onChange={event=>{setName(event.target.value);setInvalid(false);}} onBlur={save} onKeyDown={event=>{if(event.key==='Escape'){if(name!==group.name||invalid){event.preventDefault();event.stopPropagation();setName(group.name);setInvalid(false);}return;}event.stopPropagation();if(event.key==='Enter'){event.preventDefault();save();}}}/></label>{invalid&&<span className="group-name-error menu-form-error" role="alert">{t("tabgroupcontrols.chooseAUniqueNonemptyName")}</span>}<span className="group-color-label">{t("tabgroupcontrols.groupColor")}</span><div className="group-color-options" role="group" aria-label={t("tabgroupcontrols.groupColor")}>{Object.keys(TAB_GROUP_COLORS).map(key=><button key={key} type="button" className="group-color-swatch" aria-label={key==='none'?colorName('none'):t('tabgroupcontrols.colorLabel',{color:colorName(key as TabGroupColor)})} title={colorName(key as TabGroupColor)}aria-pressed={group.color===key} style={{color:tabGroupColor(key as TabGroupColor)}} onClick={()=>dispatch({type:'tab.group.update',id:group.id,patch:{color:key as TabGroupColor}})}>{key==='none'?<Slash size={16}/>:<span/>}{group.color===key&&key!=='none'&&<Check className="group-color-check" size={11}/>}</button>)}</div><div className="menu-form-actions"><button type="button" className="acira-button acira-button-primary" onClick={()=>{if(save())close();}}>{t('favoriteeditor.done')}</button></div></div>;
}

/** A label stays a disclosure button; a drag never also toggles the group. */
export function TabGroupBadge({group,count,collapsed,onToggle,onMove,reducedMotion=false}:{group:TabGroup;reducedMotion?:boolean;count:number;collapsed?:boolean;standalone?:boolean;onToggle:(keyboard?:boolean)=>void;onMove?:(point:{x:number;y:number})=>void}){
 const gesture=useRef<{id:number;x:number;y:number;moved:boolean}|null>(null),suppressClick=useRef(false);
 return <button type="button" data-popup-trigger className={`tab-group-badge tab-group-label ${collapsed?'collapsed':''}`} aria-label={t(group.collapsed?'tabgroupcontrols.expandNamedGroup':'tabgroupcontrols.collapseNamedGroup',{group:group.name,count})} aria-expanded={!group.collapsed} data-group-id={group.id}
  onPointerDown={event=>{event.stopPropagation();suppressClick.current=false;if(event.button===0&&onMove){gesture.current={id:event.pointerId,x:event.clientX,y:event.clientY,moved:false};try{event.currentTarget.setPointerCapture(event.pointerId);}catch{/* Synthesized double-clicks may have no capturable pointer. */}}}}
  onPointerMove={event=>{const current=gesture.current;if(current?.id===event.pointerId&&Math.hypot(event.clientX-current.x,event.clientY-current.y)>=6)current.moved=true;}}
  onPointerUp={event=>{const current=gesture.current;if(current?.id!==event.pointerId)return;gesture.current=null;suppressClick.current=current.moved;if(current.moved)onMove?.({x:event.clientX,y:event.clientY});if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);}}
  onPointerCancel={()=>{gesture.current=null;suppressClick.current=true;}}
  onLostPointerCapture={()=>{if(gesture.current){gesture.current=null;suppressClick.current=true;}}}
  onClick={event=>{event.stopPropagation();const suppress=suppressClick.current;suppressClick.current=false;if(suppress&&event.detail>0)return;onToggle(event.detail===0);}}><span>{group.name}</span><small aria-hidden="true">{count}</small>{collapsed&&<ChevronRight size={11} aria-hidden="true"/>}</button>;
}
