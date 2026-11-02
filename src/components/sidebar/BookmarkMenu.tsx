import { useState,type ReactNode } from 'react';
import type { BookmarkNode,BrowserAction,BrowserSnapshot } from '../../runtime/types';
import type { BrowserMenuIcon } from '../BrowserMenu';
import { ArrowUp,ArrowUpRight,Globe2,Layers3,Link2,ListFilter,PanelTop,PenLine,Plus,PrivateWindow,Star,Trash2 } from '../AppIcons';
import { TorGlyph } from '../../features/tor/TorChip';
import { BookmarkEditor } from '../../features/BookmarkEditor';
import { openTorBookmark } from '../../ui/bookmarkControl';
import { isTorSupported } from '../../ui/platform';
import { MenuFormFlyout } from '../MenuFormFlyout';
import { MenuNameForm } from '../MenuNameForm';
import { copyText } from '../../ui/pageActions';
import { openWorkspacePage } from '../../ui/workspaceView';
import { bookmarkStep,bookmarkTarget,branchOf,pagesIn,sortedByName } from '../../ui/bookmarkMenu';
import { folderTitle } from '../../ui/bookmarkFolderName';

import { t } from '../../i18n';
type Row=(label:string,Icon:BrowserMenuIcon,action:()=>void,hint?:string)=>ReactNode;
const sep=(key:string)=><hr key={key} className="acira-menu-sep"/>;
/** The editor glyph family has an up arrow only; Move down turns it over. */
const ArrowDown:BrowserMenuIcon=({size})=><ArrowUp size={size} style={{transform:'rotate(180deg)'}}/>;
/** Opening a whole folder stops at this many tabs, so one click can't bury the window. */
const OPEN_ALL_LIMIT=40;

/** One bookmark menu for the sidebar, the bookmarks bar, History and the Bookmarks page (App's bookmark-context popup):
 * a page, a bookmark, a folder, the Bookmarks bar folder or the Bookmarks zone itself. Edits happen in place in the
 * popup (the bookmark editor, a name field), and every delete offers Undo. A private window only reads bookmarks. */
export function BookmarkMenu({state,dispatch,target:ref,row,close,navigate}:{state:BrowserSnapshot;dispatch:(action:BrowserAction)=>void;target:string;row:Row;close:()=>void;navigate:(url:string)=>void}){
 const profileId=state.activeBrowserProfileId;
 const target=bookmarkTarget(ref,state.bookmarkNodes,profileId);
 const [view,setView]=useState<'menu'|'edit'|'new'>(target?.kind==='new'?'new':'menu');
 const editable=!state.browserProfiles.find(profile=>profile.id===profileId)?.private;
 if(!target)return <p className="bm-menu-note">{t("bookmarkmenu.thisBookmarkWasRemoved")}</p>;
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
 if(target.kind==='folder'){const {node,bar}=target,pages=pagesIn(node,state.bookmarkNodes),kids=state.bookmarkNodes.filter(item=>item.parentId===node.id).length;
  return <>
   {pages.length>0&&<>{row(t("bookmarkmenu.openAllCount", { count: pages.length }),Layers3,run(()=>{for(const url of pages.slice(0,OPEN_ALL_LIMIT))dispatch({type:'tab.new',url,background:true});if(pages.length>OPEN_ALL_LIMIT)dispatch({type:'toast',text:t("bookmarkmenu.openedFirst", { limit: OPEN_ALL_LIMIT, total: pages.length }),tone:'info'});}))}{sep('a')}</>}
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
 </>;
}

/** A name field in the menu's place: Enter saves, Escape cancels. Uses the bookmark editor's look. */
function NameForm({label,initial,action,submit,cancel}:{label:string;initial:string;action:string;submit:(name:string)=>void;cancel:()=>void}){
 return <div className="bm-edit bm-name-form"><MenuNameForm label={label} initial={initial} action={action} submit={submit} cancel={cancel}/></div>;
}
