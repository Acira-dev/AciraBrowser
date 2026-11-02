import type { CSSProperties,KeyboardEvent,MouseEvent,PointerEvent,ReactNode } from 'react';
import { Plus } from '../AppIcons';
import { PreviewIcon } from '../PreviewIcon';
import { SplitGroupHeader } from '../SplitGroupHeader';
import { MAX_PANES,type SplitGroup } from '../../runtime/splitLayout';
import type { BrowserAction,BrowserSnapshot,TabGroup,TabSession } from '../../runtime/types';
import { tabGroupColor } from '../../ui/theme';
import { t } from '../../i18n';

/** A saved split in the sidebar's Tabs list: its header row (the shared SplitGroupHeader, restyled as a sidebar row in
 * sidebar.css) with a hover "+" that adds a new tab to the split (R3-49), a right-click menu (R3-50, SplitHeaderMenu in
 * the split-context popup) and its panes underneath, the one place they show (no mirrors, 28 Oct). Panes are drawn by the
 * sidebar's own tab row, which adds Open alone / Show split view and dragging a pane out of the card.
 * Inside a tab group (`nestedIn`, docs/launch/SPLIT_IN_GROUPS.md) it is one of the group's members: indented one step,
 * its glyph and pane rail in the group's colour, hidden with the group unless it is the split on screen. */
export function SidebarSplit({state,dispatch,split,members,reduced,row,openMenu,focusFrom,nestedIn,hidden=false,dragging=false,onPointerDown}:{
 state:BrowserSnapshot;dispatch:(action:BrowserAction)=>void;split:SplitGroup;members:TabSession[];reduced:boolean;
 row:(tab:TabSession,options:{hidden?:boolean;pane:SplitGroup;copy?:boolean})=>ReactNode;
 /** Opens the split-context popup: at the pointer for a right-click, from the header's box for the keyboard. */
 openMenu:(node:HTMLElement,pointer?:{clientX:number;clientY:number})=>void;
 /** The sidebar's arrow-key walk, started from the button the key was pressed on. */
 focusFrom:(event:KeyboardEvent<HTMLElement>,from:HTMLElement)=>boolean;
 /** The tab group this split lives in. */
 nestedIn?:TabGroup;hidden?:boolean;dragging?:boolean;
 /** Dragging the header moves the whole split (all its panes). */
 onPointerDown?:(event:PointerEvent<HTMLDivElement>)=>void;
}){
 const temporary=members.some(tab=>tab.privacy)||state.browserProfiles.some(profile=>profile.id===state.activeBrowserProfileId&&profile.private);
 const header=(target:EventTarget|null)=>(target as HTMLElement|null)?.closest<HTMLElement>('.split-group-parent')||null;
 const menu=(event:MouseEvent<HTMLElement>)=>{const node=header(event.target);if(!node)return;event.preventDefault();event.stopPropagation();openMenu(node,event);};
 const keys=(event:KeyboardEvent<HTMLElement>)=>{
  const node=header(event.target);if(!node||event.target===event.currentTarget)return;
  if(event.key==='ContextMenu'||event.shiftKey&&event.key==='F10'){event.preventDefault();event.stopPropagation();openMenu(node);return;}
  // The header's two buttons take part in the sidebar's arrow-key walk like every other row.
  if((event.target as HTMLElement).hasAttribute('data-sb-focus'))focusFrom(event,event.target as HTMLElement);
 };
 const style=nestedIn?{'--split-tint':tabGroupColor(nestedIn.color)} as CSSProperties:undefined;
 return <div className="sb-split-group" data-split-container={split.id} data-nested={nestedIn?.id} data-hidden={hidden||undefined} inert={hidden||undefined} aria-hidden={hidden||undefined} data-dragging={dragging||undefined} style={style} onContextMenu={menu} onKeyDown={keys} onPointerDown={onPointerDown}>
  <SplitGroupHeader group={split} temporary={temporary} dispatch={dispatch} sidebar reducedMotion={reduced} active={state.windowUi.split?.groupId===split.id}/>
  {split.tabIds.length<MAX_PANES&&<button type="button" className="sb-header-add" aria-label={t("acirasidebar.newTabInSplit")} title={t("acirasidebar.newTabInSplit")} onClick={()=>dispatch({type:'split.addTab',groupId:split.id})}><PreviewIcon icon={Plus} size={14}/></button>}
  {members.map(tab=>{const gone=hidden||split.collapsed,copy=!!split.linked?.includes(tab.id);return <div key={copy?'link:'+tab.id:tab.id} data-split-child hidden={gone}>{row(tab,{hidden:gone,pane:split,copy})}</div>;})}
 </div>;
}
