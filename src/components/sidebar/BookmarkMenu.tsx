import { useLayoutEffect,useRef,useState,type KeyboardEvent,type MouseEvent,type PointerEvent,type ReactNode } from 'react';
import type { BookmarkNode,BrowserAction,BrowserSnapshot } from '../../runtime/types';
import { SubmenuBack,type BrowserMenuIcon } from '../BrowserMenu';
import { ArrowUp,ArrowUpRight,ChevronRight,Folder,Globe2,Layers3,Link2,ListFilter,PanelTop,PenLine,Plus,PrivateWindow,Star,Trash2 } from '../AppIcons';
import { SiteIdentityIcon } from '../SiteIdentityIcon';
import { siteIdentity } from '../../runtime/sites';
import { TorGlyph } from '../../features/tor/TorChip';
import { BookmarkEditor } from '../../features/BookmarkEditor';
import { openTorBookmark } from '../../ui/bookmarkControl';
import { isTorSupported } from '../../ui/platform';
import { MenuFormFlyout } from '../MenuFormFlyout';
import { MenuNameForm } from '../MenuNameForm';
import { copyText } from '../../ui/pageActions';
import { openWorkspacePage } from '../../ui/workspaceView';
import { bookmarkRef,bookmarkStep,bookmarkTarget,branchOf,drillPath,folderChildren,folderPages,openAllActions,sortedByName } from '../../ui/bookmarkMenu';
import { folderTitle } from '../../ui/bookmarkFolderName';
import { SECTION_NAMES,sidebarWindowId,type SectionId } from '../../ui/sidebarSections';
import { SectionMenu,sectionActions } from './SectionActions';
import { SizeMenu } from './SizeMenu';

import { t } from '../../i18n';
type Row=(label:string,Icon:BrowserMenuIcon,action:()=>void,hint?:string)=>ReactNode;
const sep=(key:string)=><hr key={key} className="acira-menu-sep"/>;
/** The editor glyph family has an up arrow only; Move down turns it over. */
const ArrowDown:BrowserMenuIcon=({size})=><ArrowUp size={size} style={{transform:'rotate(180deg)'}}/>;

/** One bookmark menu for the sidebar, the bookmarks bar, History and the Bookmarks page (App's bookmark-context popup):
 * a page, a bookmark, a folder, the Bookmarks bar folder or the Bookmarks zone itself. Edits happen in place in the
 * popup (the bookmark editor, a name field), and every delete offers Undo. A private window only reads bookmarks. */
export function BookmarkMenu({state,dispatch,target:ref,row,close,navigate}:{state:BrowserSnapshot;dispatch:(action:BrowserAction)=>void;target:string;row:Row;close:()=>void;navigate:(url:string)=>void}){
 const profileId=state.activeBrowserProfileId;
 const target=bookmarkTarget(ref,state.bookmarkNodes,profileId);
 const [view,setView]=useState<'menu'|'edit'|'new'>(target?.kind==='new'?'new':'menu');
 const editable=!state.browserProfiles.find(profile=>profile.id===profileId)?.private;
 if(!target)return <p className="bm-menu-note">{t("bookmarkmenu.thisBookmarkWasRemoved")}</p>;
 // The sidebar edge's menu: the three sizes (components/sidebar/SizeMenu.tsx).
 if(target.kind==='size')return <SizeMenu state={state} dispatch={dispatch} row={row} close={close}/>;
 // A section's own menu (Downloads, History, Reading list, Favorites): Hide this section and Customize sidebar…
 if(target.kind==='zone'){const section=target.section as SectionId;return section in SECTION_NAMES?<SectionMenu row={row} windowId={sidebarWindowId(state)} section={section} close={close}/>:null;}
 // A folder button on the bookmarks bar: the folder's pages and folders.
 if(target.kind==='contents')return <FolderContents state={state} dispatch={dispatch} folder={target.node} row={row} close={close} navigate={navigate}/>;
 const run=(action:()=>void)=>()=>{action();close();};
 const deleted=(text:string,gone:BookmarkNode[])=>dispatch({type:'toast',text,action:{label:t("toast.undo"),command:{type:'bookmark.restore',nodes:gone.map(node=>({...node}))}}});
 const sortHere=(parentId:string|null)=>sortedByName(parentId,state.bookmarkNodes,profileId).forEach((node,index)=>dispatch({type:'bookmark.move',id:node.id,parentId,index}));
 // Move up / Move down (R3-52, the keyboard way to reorder): for rows of the Bookmarks tree (sidebar, Bookmarks page), never the bar.
 const moves=(node:BookmarkNode)=>{
  if(!editable||!ref.startsWith('node:'))return null;
  const go=(direction:-1|1)=>{const place=bookmarkStep(state.bookmarkNodes,profileId,node.id,direction);return place?run(()=>dispatch({type:'bookmark.move',id:node.id,...place})):null;};
  const up=go(-1),down=go(1);
  return <>{up&&row(t("bookmarkmenu.moveUp"),ArrowUp,up)}{down&&row(t("bookmarkmenu.moveDown"),ArrowDown,down)}</>;
 };
 const parentForNew=target.kind==='new'?target.parentId:target.kind==='folder'?target.node.id:null;

 if(view==='edit'&&target.kind==='bookmark')return <BookmarkEditor state={state} url={target.node.url} tor={!!target.node.tor} dispatch={dispatch} close={close}/>;
 if(view==='new')return <NameForm label={t("acirasidebar.newFolder")} initial="New folder" action="Create" cancel={close}
  submit={title=>{dispatch({type:'bookmark.folder',title,parentId:parentForNew});close();}}/>;

 // A Tor bookmark opens in a Tor tab, here and in a new tab alike.
 const opens=(url:string,tor=false)=>[
  row(t("main.open"),Globe2,run(()=>tor?openTorBookmark(state,dispatch,url):navigate(url))),
  row(t("bookmarkmenu.openInNewTab"),Plus,run(()=>dispatch({type:'tab.new',url,background:true,...(tor?{privacy:'tor' as const}:{})}))),
  row(t("bookmarkmenu.openInPrivateTab"),PrivateWindow,run(()=>dispatch({type:'tab.new',url,privacy:'private'}))),
  ...(isTorSupported()&&!tor?[row(t("bookmarkmenu.openInTorTab"),TorGlyph,run(()=>dispatch({type:'tab.new',url,privacy:'tor'})))]:[]),
 ];
 const copy=(url:string)=>row(t("bookmarkmenu.copyLink"),Link2,run(()=>{void copyText(url).then(()=>dispatch({type:'toast',text:t("browsermenu.linkCopied"),tone:'status',icon:'check'}));}));

 if(target.kind==='page')return <>{opens(target.url)}{sep('a')}{copy(target.url)}{editable&&row(t("bookmarkmenu.addBookmark"),Star,run(()=>dispatch({type:'bookmark.toggle',url:target.url})))}</>;
 if(target.kind==='bookmark'){const {node}=target,url=node.url!;
  return <>{opens(url,!!node.tor)}{sep('a')}{editable&&row(t("bookmarkmenu.edit"),PenLine,()=>setView('edit'))}{copy(url)}{moves(node)}
   {editable&&<>{sep('b')}{row(t("app.removeBookmark"),Trash2,run(()=>{const gone=branchOf(node,state.bookmarkNodes);dispatch({type:'bookmark.remove',id:node.id});deleted(`Removed ${node.title||'bookmark'}`,gone);}))}</>}</>;}
 if(target.kind==='folder'){const {node,bar}=target,pages=folderPages(node,state.bookmarkNodes),kids=state.bookmarkNodes.filter(item=>item.parentId===node.id).length;
  return <>
   {pages.length>0&&<>{row(t("bookmarkmenu.openAllCount", { count: pages.length }),Layers3,run(()=>openAllActions(node,state.bookmarkNodes).forEach(dispatch)))}{sep('a')}</>}
   {editable&&<MenuFormFlyout title={t('bookmarkmenu.newFolder')}>{dismiss=><MenuNameForm label={t('bookmarkmenu.folderName')} action={t('searchEngines.add')} cancel={dismiss} submit={title=>{dispatch({type:'bookmark.folder',title,parentId:parentForNew});close();}}/>}</MenuFormFlyout>}
   {editable&&!bar&&<MenuFormFlyout title={t('bookmarkmenu.rename')}>{dismiss=><MenuNameForm label={t('bookmarkmenu.folderName')} initial={folderTitle(node)} action={t('bookmarkmenu.rename')} cancel={dismiss} submit={title=>{/* Other bookmarks shows its translated name: kept as it is, it is no rename */if(title!==folderTitle(node))dispatch({type:'bookmark.rename',id:node.id,title});close();}}/>}</MenuFormFlyout>}
   {editable&&kids>1&&row(t("bookmarkmenu.sortByName"),ListFilter,run(()=>sortHere(node.id)))}
   {moves(node)}
   {bar&&row(state.settings.bookmarksBar?t("bookmarkmenu.hideBookmarksBar"):t("bookmarkmenu.showBookmarksBar"),PanelTop,run(()=>dispatch({type:'settings.update',patch:{bookmarksBar:!state.settings.bookmarksBar}})))}
   {editable&&!bar&&<>{sep('b')}{row(t("bookmarkmenu.deleteFolder"),Trash2,run(()=>{const gone=branchOf(node,state.bookmarkNodes),inside=gone.filter(item=>item.url).length;dispatch({type:'bookmark.remove',id:node.id});deleted(`Deleted ${folderTitle(node)||'folder'}${inside?` and ${inside} ${inside===1?'bookmark':'bookmarks'}`:''}`,gone);}))}</>}
  </>;}
 return <>
  {editable&&<MenuFormFlyout title={t('bookmarkmenu.newFolder')}>{dismiss=><MenuNameForm label={t('bookmarkmenu.folderName')} action={t('searchEngines.add')} cancel={dismiss} submit={title=>{dispatch({type:'bookmark.folder',title,parentId:null});close();}}/>}</MenuFormFlyout>}
  {editable&&row(t("bookmarkmenu.sortByName"),ListFilter,run(()=>sortHere(null)))}
  {editable&&sep('a')}
  {row(t("bookmarkmenu.openBookmarks"),ArrowUpRight,run(()=>openWorkspacePage('bookmarks',state,dispatch)),'Ctrl Shift O')}
  {sep('c')}
  {sectionActions(row,sidebarWindowId(state),'bookmarks',close)}
 </>;
}

/** A folder of the bookmarks bar as a menu (Chromium's BookmarkMenuDelegate::BuildMenu): its pages and folders in order, a page
 * with its site icon, a folder with the folder glyph and the submenu chevron. A folder opens in place (the menus' drill-in, as Move to
 * tab group ›), with the back row on top; Right opens it, Left, Backspace and Esc go back a level. A page opens like the bar's own
 * buttons; Ctrl/Cmd or the middle button opens it in a background tab and leaves the menu open, and on a folder opens all of it
 * (Chromium's ShouldExecuteCommandWithoutClosingMenu). A right-click or the menu key shows that bookmark's own menu in place. The
 * rows follow the bookmarks live: one moved in or out while the menu is open appears or goes at once, and a folder opened in place
 * that moves elsewhere takes the menu back to the level that still holds it (drillPath). */
function FolderContents({state,dispatch,folder,row,close,navigate}:{state:BrowserSnapshot;dispatch:(action:BrowserAction)=>void;folder:BookmarkNode;row:Row;close:()=>void;navigate:(url:string)=>void}){
 const profileId=state.activeBrowserProfileId,nodes=state.bookmarkNodes;
 const [path,setPath]=useState<string[]>([]),[actions,setActions]=useState<string|null>(null);
 const menu=useRef<HTMLDivElement>(null),from=useRef<string|null>(null),moved=useRef(false),focusAt=useRef(-1),press=useRef<{id:string;ctrl:boolean;shift:boolean}|null>(null);
 const shown=drillPath(nodes,profileId,folder.id,path),here=nodes.find(node=>node.id===(shown.at(-1)??folder.id))??folder;
 const children=folderChildren(nodes,profileId,here.id),level=shown.join('/')+'|'+(actions??'');
 const rows=()=>[...menu.current?.querySelectorAll<HTMLElement>('.menu-row:not(:disabled),.popup-back')??[]];
 // A new level takes the keyboard to its first row (the folder it came from when going back); its list starts at the top.
 useLayoutEffect(()=>{
  const list=rows(),back=from.current&&list.find(item=>(item.dataset.bookmarkFolder??item.dataset.bookmarkRow)===from.current),first=list.find(item=>!item.matches('.popup-back'))??list[0];
  from.current=null;
  if(!moved.current)return;
  moved.current=false;
  const target=back||first;
  target?.focus({preventScroll:true});target?.scrollIntoView({block:'nearest'});
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[level]);
 // A row that goes while it has the keyboard (its bookmark moved or removed elsewhere) hands it to the row now in its place.
 useLayoutEffect(()=>{
  if(focusAt.current<0)return;const active=document.activeElement;
  if(active&&active!==document.body&&active.isConnected)return;
  const list=rows(),target=list[Math.min(focusAt.current,list.length-1)]??menu.current?.closest<HTMLElement>('.browser-popup');
  target?.focus({preventScroll:true});
 });
 const rtl=()=>!!menu.current&&getComputedStyle(menu.current).direction==='rtl';
 const drill=(id:string)=>{moved.current=true;setActions(null);setPath([...shown,id]);};
 const actionsFor=(id:string)=>{moved.current=true;setActions(id);};
 const up=()=>{moved.current=true;if(actions){from.current=actions;setActions(null);return true;}if(!shown.length)return false;from.current=shown.at(-1)!;setPath(shown.slice(0,-1));return true;};
 const keys=(node:BookmarkNode|null)=>(event:KeyboardEvent<HTMLElement>)=>{
  press.current=null;
  // Typing in a field (the bookmark editor shown in place) keeps its keys; Esc still goes back.
  const target=event.target as HTMLElement;
  if((target instanceof HTMLInputElement||target instanceof HTMLTextAreaElement||target.isContentEditable)&&event.key!=='Escape')return;
  const into=rtl()?'ArrowLeft':'ArrowRight',out=rtl()?'ArrowRight':'ArrowLeft';
  if(node&&(event.key==='ContextMenu'||event.shiftKey&&event.key==='F10')){event.preventDefault();event.stopPropagation();actionsFor(node.id);return;}
  if(node&&!node.url&&event.key===into){event.preventDefault();event.stopPropagation();drill(node.id);return;}
  if((event.key===out||event.key==='Backspace'||event.key==='Escape')&&(actions||shown.length)){event.preventDefault();event.stopPropagation();up();}
 };
 const openAll=(node:BookmarkNode)=>{openAllActions(node,nodes).forEach(dispatch);close();};
 // A page opens the way the bar's buttons open one; a background tab leaves the menu open for the next.
 const openPage=(node:BookmarkNode,ctrl:boolean,shift:boolean)=>{
  const url=node.url!,background=ctrl&&!shift;
  if(node.tor)openTorBookmark(state,dispatch,url,ctrl);
  else if(ctrl||shift)dispatch({type:'tab.new',url,background});
  else{navigate(url);return;}
  if(!background)close();
 };
 // The menu's pick blink replays a pointer click without its keys (SheetPopupSurface): the press keeps them.
 const pressed=(node:BookmarkNode)=>(event:PointerEvent)=>{press.current=event.button===0?{id:node.id,ctrl:event.ctrlKey||event.metaKey,shift:event.shiftKey}:null;};
 const clicked=(node:BookmarkNode)=>(event:MouseEvent)=>{
  const held=event.detail===0&&press.current?.id===node.id?press.current:null;press.current=null;
  const ctrl=held?held.ctrl:event.ctrlKey||event.metaKey,shift=held?held.shift:event.shiftKey;
  if(node.url)openPage(node,ctrl,shift);else if(ctrl)openAll(node);else drill(node.id);
 };
 const middle=(node:BookmarkNode)=>(event:MouseEvent)=>{if(event.button!==1)return;event.preventDefault();if(node.url)openPage(node,true,event.shiftKey);else openAll(node);};
 const name=(node:BookmarkNode)=>node.url?node.title||siteIdentity(node.url).label:folderTitle(node)||t('bm.untitled');
 const item=(node:BookmarkNode)=>node.url
  ?<button key={node.id} type="button" className="menu-row" role="menuitem" data-bookmark-row={node.id} title={name(node)} onPointerDown={pressed(node)} onClick={clicked(node)} onAuxClick={middle(node)} onMouseDown={event=>{if(event.button===1)event.preventDefault();}} onKeyDown={keys(node)} onContextMenu={event=>{event.preventDefault();actionsFor(node.id);}}>
    <SiteIdentityIcon url={node.url} size={16} privacy={node.tor?'tor':undefined}/><span dir="auto">{name(node)}</span></button>
  :<button key={node.id} type="button" className="menu-row menu-row-more" role="menuitem" aria-haspopup="menu" data-bookmark-folder={node.id} title={name(node)} onClick={clicked(node)} onAuxClick={middle(node)} onMouseDown={event=>{if(event.button===1)event.preventDefault();}} onKeyDown={keys(node)} onContextMenu={event=>{event.preventDefault();actionsFor(node.id);}}>
    <Folder size={16}/><span dir="auto">{name(node)}</span><ChevronRight size={14}/></button>;
 const shownActions=actions?nodes.find(node=>node.id===actions&&node.browserProfileId===profileId):undefined;
 return <div ref={menu} className="bm-folder-menu" role={shownActions?undefined:'menu'} aria-label={name(shownActions??here)} onKeyDown={keys(null)}
  onFocus={event=>{focusAt.current=rows().indexOf(event.target as HTMLElement);}}>
  {shownActions?<>
   <SubmenuBack title={name(shownActions)} onBack={up}/>{sep('back')}
   <BookmarkMenu state={state} dispatch={dispatch} target={bookmarkRef(shownActions.id)} row={row} close={close} navigate={navigate}/>
  </>:<>
   {shown.length>0&&<><SubmenuBack title={name(here)} onBack={up}/>{sep('back')}</>}
   {children.length?children.map(item):<button type="button" className="menu-row" role="menuitem" disabled><span>{t('bm.folderEmptyTitle')}</span></button>}
  </>}
 </div>;
}

/** A name field in the menu's place: Enter saves, Escape cancels. Uses the bookmark editor's look. */
function NameForm({label,initial,action,submit,cancel}:{label:string;initial:string;action:string;submit:(name:string)=>void;cancel:()=>void}){
 return <div className="bm-edit bm-name-form"><MenuNameForm label={label} initial={initial} action={action} submit={submit} cancel={cancel}/></div>;
}
