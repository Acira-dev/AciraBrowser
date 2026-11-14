import {useLayoutEffect,useRef,useState,type DragEvent,type KeyboardEvent,type MouseEvent} from 'react';import type {BrowserAction,BrowserSnapshot,Rectangle} from '../runtime/types';import {SiteIdentityIcon} from './SiteIdentityIcon';import {ChevronRight,Folder} from './AppIcons';import {siteIdentity} from '../runtime/sites';import {barBookmarks,barDropLocation,barPlace} from '../features/libraryModel';import {droppedLink,hasLink} from '../ui/linkDrop';import '../styles/bookmarks-bar.css';
import { t } from '../i18n';
import { openTorBookmark } from '../ui/bookmarkControl';
import { bookmarkPlace,bookmarkRef,openAllActions } from '../ui/bookmarkMenu';
import { folderTitle } from '../ui/bookmarkFolderName';
import { TabPrivacyMark } from './TabPrivacyMark';
import { useListMotion } from '../ui/sharedMotion';
type Entry={id:string;parentId:string|null;url:string;title:string;tor:boolean;folder:boolean};
/** Where a drag over the bar would land: before entry `index` (or after the last shown), or INTO the folder at `index`. */
type Slot={index:number;on:boolean};
/** The bookmarks bar: the Bookmarks bar folder's pages and folders and the top-level pages (barBookmarks). A folder's button opens
 * its contents as a menu (onFolder; App's bookmark-context popup, BookmarkMenu's FolderContents); a second press closes it. */
export function BookmarksBar({state,dispatch,onNavigate,onOverflow,onContext,onToolbarContext,onFolder,openFolder=null,overflowOpen=false}:{overflowOpen?:boolean;state:BrowserSnapshot;dispatch:(action:BrowserAction)=>void;onNavigate:(url:string)=>void;onOverflow:()=>void;onContext:(ref:string,anchor:Rectangle)=>void;onToolbarContext:(anchor:Rectangle)=>void;/** A folder's button was pressed: open its menu, or close it when it is the one open. */onFolder:(id:string,button:HTMLElement)=>void;/** The folder whose menu is open. */openFolder?:string|null}){
 const root=useRef<HTMLDivElement>(null),measure=useRef<HTMLDivElement>(null),[fit,setFit]=useState(0);
 const entries:Entry[]=barBookmarks(state.bookmarkNodes,state.activeBrowserProfileId).map(node=>node.url?{id:node.id,parentId:node.parentId??null,url:node.url,title:node.title||siteIdentity(node.url).label,tor:!!node.tor,folder:false}:{id:node.id,parentId:node.parentId??null,url:'',title:folderTitle(node)||t('bm.untitled'),tor:false,folder:true});
 const identity=JSON.stringify(entries),[drag,setDrag]=useState<string|null>(null),[slot,setSlot]=useState<Slot|null>(null);
 useLayoutEffect(()=>{const node=root.current,probe=measure.current;if(!node||!probe)return;const update=()=>{const style=getComputedStyle(node),available=node.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight),gap=parseFloat(style.columnGap)||4,widths=[...probe.querySelectorAll<HTMLElement>('[data-measure-bookmark]')].map(item=>item.getBoundingClientRect().width),total=widths.reduce((sum,width,index)=>sum+width+(index?gap:0),0);if(widths.length===entries.length&&total<=available+.5){setFit(entries.length);return;}const overflow=probe.querySelector<HTMLElement>('[data-measure-overflow]')?.getBoundingClientRect().width||34;let used=0,count=0;for(const width of widths){const next=used+width+(count?gap:0);if(next>available-overflow-gap+.5)break;used=next;count++;}setFit(count);};const observer=new ResizeObserver(update);observer.observe(node);observer.observe(probe);document.fonts.addEventListener('loadingdone',update);void document.fonts.ready.then(update);update();return()=>{observer.disconnect();document.fonts.removeEventListener('loadingdone',update);};},[identity]);
 // R3-70: bookmarks glide to their new places, a new one settles in and a removed one fades out where it was.
 useListMotion(root,identity+':'+fit);
 // Where a drop lands (Chromium's CalculateDropLocation, barDropLocation): before or after a page by its halves; before, into or after
 // a folder. Reordering and saving a dropped link both use it. The fading copy of a button that just left (useListMotion's ghost) is
 // not a place: counted, it moved every later drop one place off for the length of the fade.
 const slotAt=(x:number):Slot=>{const node=root.current,buttons=[...(node?.querySelectorAll<HTMLElement>(':scope > [data-bookmark]:not([data-motion-ghost])')??[])],rtl=!!node&&getComputedStyle(node).direction==='rtl';return barDropLocation(buttons.map(button=>{const box=button.getBoundingClientRect();return {lead:rtl?box.right:box.left,width:box.width,folder:button.hasAttribute('data-folder')};}),x,rtl);};
 const mine=()=>state.bookmarkNodes.filter(node=>node.browserProfileId===state.activeBrowserProfileId);
 // A drop into a folder: at its end (Chromium drops ON a folder at its child count). Never a folder into itself or its own branch.
 const into=(folder:string,moving?:string)=>moving?bookmarkPlace(state.bookmarkNodes,state.activeBrowserProfileId,moving,folder,'into'):{parentId:folder,index:mine().filter(node=>node.parentId===folder).length};
 const allowed=(at:Slot)=>!at.on||!!into(entries[at.index]?.id??'',drag??undefined);
 const finish=()=>{setDrag(null);setSlot(null);};
 const over=(event:DragEvent<HTMLElement>)=>{if(!drag&&!hasLink(event.dataTransfer))return;const at=slotAt(event.clientX);if(!allowed(at)){setSlot(null);return;}event.preventDefault();event.dataTransfer.dropEffect=drag?'move':'copy';setSlot(old=>old?.index===at.index&&old.on===at.on?old:at);};
 const drop=(event:DragEvent<HTMLElement>)=>{
  const at=slotAt(event.clientX),target=at.on?entries[at.index]:undefined;
  if(drag){const moving=mine().find(node=>node.id===drag),spot=target?into(target.id,drag):moving?barPlace(state.bookmarkNodes,state.activeBrowserProfileId,entries,at.index,moving):null;if(spot){event.preventDefault();dispatch({type:'bookmark.move',id:drag,parentId:spot.parentId,index:spot.index});}}
  else{const link=droppedLink(event.dataTransfer),spot=target?into(target.id):barPlace(state.bookmarkNodes,state.activeBrowserProfileId,entries,at.index);if(link&&spot){event.preventDefault();dispatch({type:'bookmark.add',url:link.url,title:link.title,...spot});}}
  finish();
 };
 const marker=(index:number)=>!slot?undefined:slot.on?(slot.index===index?'into':undefined):slot.index===index?'before':slot.index===index+1&&index===fit-1?'after':undefined;
 const anchorOf=(event:{clientX:number;clientY:number})=>({x:event.clientX,y:event.clientY,width:2,height:2});
 // A middle or Ctrl/Cmd press on a folder opens every page in it (its menu's Open all), as on Chromium's bar.
 const openAll=(id:string)=>{const folder=mine().find(node=>node.id===id);if(folder)openAllActions(folder,state.bookmarkNodes).forEach(dispatch);};
 const item=(entry:Entry,measuring=false,index=0)=>{
  const drags=measuring?{}:{draggable:true,'data-bookmark':'','data-bookmark-id':entry.id,'data-drop':marker(index),'data-dragging':drag===entry.id||undefined,onDragEnd:finish};
  if(entry.folder)return <button key={'folder:'+entry.id} type="button" className="bookmark-folder" data-folder="" data-measure-bookmark={measuring||undefined} {...drags} tabIndex={measuring?-1:undefined} title={entry.title}
   {...(measuring?{}:{'data-popup-trigger':'','aria-haspopup':'menu' as const,'aria-expanded':openFolder===entry.id,
    onDragStart:(event:DragEvent<HTMLButtonElement>)=>{setDrag(entry.id);event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('application/x-acira-bookmark',entry.id);},
    onClick:(event:MouseEvent<HTMLButtonElement>)=>{if(event.ctrlKey||event.metaKey)openAll(entry.id);else onFolder(entry.id,event.currentTarget);},
    onMouseDown:(event:MouseEvent)=>{if(event.button===1)event.preventDefault();},
    onAuxClick:(event:MouseEvent)=>{if(event.button===1){event.preventDefault();openAll(entry.id);}},
    onKeyDown:(event:KeyboardEvent<HTMLButtonElement>)=>{if(event.key==='ArrowDown'&&openFolder!==entry.id){event.preventDefault();onFolder(entry.id,event.currentTarget);}},
    onContextMenu:(event:MouseEvent)=>{event.preventDefault();onContext(bookmarkRef(entry.id),anchorOf(event));}})}>
   <Folder size={16}/><span>{entry.title}</span></button>;
  // A Tor bookmark opens in a Tor tab, however it is clicked.
  return <button key={(entry.tor?'tor:':'')+entry.url} data-tor={entry.tor||undefined} data-measure-bookmark={measuring||undefined} {...drags} onDragStart={measuring?undefined:event=>{setDrag(entry.id);event.dataTransfer.effectAllowed='copyMove';event.dataTransfer.setData('text/uri-list',entry.url);event.dataTransfer.setData('text/plain',entry.url);}} tabIndex={measuring?-1:undefined} title={entry.title} onClick={measuring?undefined:event=>entry.tor?openTorBookmark(state,dispatch,entry.url,event.ctrlKey||event.metaKey):event.ctrlKey||event.metaKey||event.shiftKey?dispatch({type:'tab.new',url:entry.url,background:!event.shiftKey}):onNavigate(entry.url)} onAuxClick={measuring?undefined:event=>{if(event.button===1){event.preventDefault();if(entry.tor)openTorBookmark(state,dispatch,entry.url,true);else dispatch({type:'tab.new',url:entry.url,background:true});}}} onContextMenu={measuring?undefined:event=>{event.preventDefault();onContext(entry.url,anchorOf(event));}}><SiteIdentityIcon url={entry.url} size={16}/><span>{entry.title}</span>{entry.tor&&<TabPrivacyMark privacy="tor" size={12} className="bookmark-tor-mark"/>}</button>;
 };
 return <div ref={root} className="bookmarks-bar" role="toolbar" aria-label={t("browsermenu.bookmarks")} onDragOver={over} onDragLeave={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node|null))setSlot(null);}} onDrop={drop} onContextMenu={event=>{if(!(event.target as HTMLElement).closest('button')){event.preventDefault();event.stopPropagation();onToolbarContext(anchorOf(event));}}}>{!entries.length&&<span className="bookmarks-bar-hint">{t("bookmarksbar.empty")}</span>}{entries.slice(0,fit).map((entry,index)=>item(entry,false,index))}{fit<entries.length&&<button data-popup-trigger className="bookmark-overflow" title={t("app.allBookmarks")} aria-label={t("app.allBookmarks")} aria-haspopup="dialog" aria-expanded={overflowOpen} onClick={onOverflow}><ChevronRight size={16}/></button>}<div ref={measure} className="bookmarks-measure" data-motion-skip="" aria-hidden="true" inert>{entries.slice(0,Math.max(512,Math.ceil(innerWidth/16)+1)).map(entry=>item(entry,true))}<button className="bookmark-overflow" data-measure-overflow tabIndex={-1}><ChevronRight size={16}/></button></div></div>;
}
