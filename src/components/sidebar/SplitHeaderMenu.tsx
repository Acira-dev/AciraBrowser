import { useRef,useState,type ReactNode } from 'react';
import type { BrowserAction,BrowserSnapshot } from '../../runtime/types';
import { Check,ChevronLeft,ChevronRight,Columns2,Folder,PenLine,Plus,Unplug,X } from '../AppIcons';
import { splitGroupMenu } from '../../runtime/splitPlacement';
import { tabGroupColor } from '../../ui/theme';
import { MenuFormFlyout } from '../MenuFormFlyout';
import { MenuNameForm } from '../MenuNameForm';
import { useSectionFocus } from '../useSectionFocus';
import { MAX_PANES,SPLIT_LAYOUTS,layoutsFor,type SplitLayoutId } from '../../runtime/splitLayout';
import { changeLayoutActions } from './sidebarActions';
import '../TabGroups.css';
import { t,translateText } from '../../i18n';

/** The right-click menu of a split's header in the sidebar (R3-50; the split-context popup, opened on one of its tabs):
 * New tab in split, Change layout ›, Rename…, then Move to tab group › and Remove from group (docs/launch/SPLIT_IN_GROUPS.md:
 * the whole split moves), then Unsplit and Close split. The rows use the tab-group menu's look. Unsplit
 * puts the tabs back in the list as normal tabs, Close split closes them (the split work owns both actions and the Undo). */
export function SplitHeaderMenu({state,dispatch,tabId,close}:{state:BrowserSnapshot;dispatch:(action:BrowserAction)=>void;tabId:string;close:()=>void}){
 const group=state.windowUi.splitGroups?.find(item=>item.tabIds.includes(tabId));
 const [section,setSection]=useState<'layout'|'groups'|null>(null),menu=useRef<HTMLElement>(null);
 // Opening a section (Enter or ArrowRight on its row) moves focus to the section's first row; ArrowLeft / Escape / the back row return focus to the row that opened it (as in the tab group menu).
 useSectionFocus(menu,section,{layout:t("acirasidebar.splitChangeLayout"),groups:t("tabgroupcontrols.moveToTabGroup")});
 if(!group)return null;
 const id=group.id,layouts=layoutsFor(group.tabIds.length);
 // Split views in tab groups (docs/launch/SPLIT_IN_GROUPS.md): the whole split moves into a group, or out of every group.
 const {targets,grouped}=splitGroupMenu(state,group);
 const run=(action:BrowserAction)=>{dispatch(action);close();};
 const item=(label:string,action:()=>void,icon?:ReactNode,sub=false,danger=false)=><button type="button" className="menu-row group-menu-row" role="menuitem" data-danger={danger||undefined} aria-haspopup={sub?'menu':undefined} onClick={action} onKeyDown={event=>{if(sub&&event.key==='ArrowRight'){event.preventDefault();event.stopPropagation();action();}}}>{icon}<span>{label}</span>{sub&&<ChevronRight size={12}/>}</button>;
 const choose=(layout:SplitLayoutId)=>{changeLayoutActions(group,layout).forEach(dispatch);close();};
 return <section ref={menu} className="tab-group-controls" role="menu" aria-label={section==='layout'?t("acirasidebar.splitChangeLayout"):section==='groups'?t("tabgroupcontrols.moveToTabGroup"):t("acirasidebar.splitActions")} onKeyDown={event=>{if(section&&['ArrowLeft','Escape'].includes(event.key)){event.preventDefault();event.stopPropagation();setSection(null);}}}>
  {section==='layout'?<>{item(t("acirasidebar.splitChangeLayout"),()=>setSection(null),<ChevronLeft size={14}/>)}<hr/>
   {layouts.map(layout=>item(translateText(SPLIT_LAYOUTS[layout].label),()=>choose(layout),layout===group.layout?<Check size={15}/>:<span className="menu-icon" aria-hidden="true"/>))}</>
  :section==='groups'?<>{item(t("tabgroupcontrols.moveToTabGroup"),()=>setSection(null),<ChevronLeft size={14}/>)}<hr/>
   {targets.map(target=>item(target.name,()=>run({type:'split.move',groupId:id,tabGroupId:target.id}),<Folder size={15} style={{color:tabGroupColor(target.color)}}/>))}</>
  :<>
   {group.tabIds.length<MAX_PANES&&item(t("acirasidebar.newTabInSplit"),()=>run({type:'split.addTab',groupId:id}),<Plus size={15}/>)}
   {layouts.length>1&&item(t("acirasidebar.splitChangeLayout"),()=>setSection('layout'),<Columns2 size={15}/>,true)}
   <MenuFormFlyout title={t("bookmarkmenu.rename")} icon={<PenLine size={15}/>}>{dismiss=><MenuNameForm label={t("acirasidebar.splitName")} initial={group.name||t("browsermenu.splitView")} action={t("acirasidebar.splitRename")} cancel={dismiss} submit={name=>{dispatch({type:'split.rename',groupId:id,name});close();}}/>}</MenuFormFlyout>
   {(targets.length>0||grouped)&&<hr/>}
   {targets.length>0&&item(t("tabgroupcontrols.moveToTabGroup"),()=>setSection('groups'),<Folder size={15}/>,true)}
   {grouped&&item(t("acirasidebar.splitRemoveFromGroup"),()=>run({type:'split.move',groupId:id,tabGroupId:null}),<span className="menu-icon" aria-hidden="true"/>)}
   <hr/>
   {item(t("acirasidebar.splitUnsplit"),()=>run({type:'split.unsplit',groupId:id}),<Unplug size={15}/>)}
   {item(t("acirasidebar.splitClose"),()=>run({type:'split.close',groupId:id}),<X size={15}/>,false,true)}
  </>}
 </section>;
}
