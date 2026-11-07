import type { BookmarkNode } from '../runtime/types';
import { bookmarkMenuEvent,type BookmarkMenuRequest } from './pageActions';

/** The Bookmarks bar is a top-level folder named "Bookmarks bar" (core's placeFolder); it can't be renamed or deleted. */
export const isBarFolder=(node:BookmarkNode)=>!node.url&&!node.parentId&&node.title.trim().toLowerCase()==='bookmarks bar';

/** What a bookmark menu was opened on. A menu ref is a page URL (the bar, History, the Bookmarks page) or `node:<id>`,
 * `node:root` (the Bookmarks zone itself) or `node:new:<parent id|root>` (straight to the "New folder" form). */
export type BookmarkTarget=
 |{kind:'bookmark';node:BookmarkNode}
 |{kind:'folder';node:BookmarkNode;bar:boolean}
 |{kind:'root'}
 |{kind:'new';parentId:string|null}
 |{kind:'page';url:string}
 /** A sidebar section's own menu (`node:zone-<section id>`; a menu ref travels to the popup as a node id, and main accepts only word characters, dots and dashes there): Hide this section, Customize sidebar… */
 |{kind:'zone';section:string};

export const bookmarkRef=(id:string)=>`node:${id}`;
/** A sidebar section's own menu: `zoneRef('history')`. */
export const ZONE_REF='node:zone-';
export const zoneRef=(section:string)=>ZONE_REF+section;

export function bookmarkTarget(ref:string,nodes:BookmarkNode[],profileId:string):BookmarkTarget|null{
 const mine=nodes.filter(node=>node.browserProfileId===profileId);
 if(ref==='node:root')return {kind:'root'};
 if(ref.startsWith(ZONE_REF))return {kind:'zone',section:ref.slice(ZONE_REF.length)};
 if(ref.startsWith('node:new:')){const id=ref.slice(9);return {kind:'new',parentId:id!=='root'&&mine.some(node=>node.id===id&&!node.url)?id:null};}
 if(ref.startsWith('node:')){const node=mine.find(item=>item.id===ref.slice(5));if(!node)return null;return node.url?{kind:'bookmark',node}:{kind:'folder',node,bar:isBarFolder(node)};}
 if(!ref)return null;
 const node=mine.find(item=>item.url===ref);
 return node?{kind:'bookmark',node}:{kind:'page',url:ref};
}

const childrenOf=(nodes:BookmarkNode[],parentId:string|null)=>nodes.filter(node=>(node.parentId??null)===parentId).sort((a,b)=>a.position-b.position);

/** The node and everything under it, in the shape bookmark.restore puts back. */
export function branchOf(node:BookmarkNode,nodes:BookmarkNode[]):BookmarkNode[]{
 const mine=nodes.filter(item=>item.browserProfileId===node.browserProfileId);
 const walk=(at:BookmarkNode,depth:number):BookmarkNode[]=>depth>32?[at]:[at,...childrenOf(mine,at.id).flatMap(child=>walk(child,depth+1))];
 return walk(node,0);
}

/** Every page in a folder, folders included, once each, in tree order. */
export function pagesIn(folder:BookmarkNode,nodes:BookmarkNode[]):string[]{
 return [...new Set(branchOf(folder,nodes).slice(1).filter(node=>node.url).map(node=>node.url!))];
}

/** "Sort by name": folders first, then pages, each A to Z the way people read them (numbers in order, case ignored). */
export function sortedByName(parentId:string|null,nodes:BookmarkNode[],profileId:string):BookmarkNode[]{
 const collator=new Intl.Collator(undefined,{numeric:true,sensitivity:'base'});
 const name=(node:BookmarkNode)=>node.title.trim()||node.url||'';
 return childrenOf(nodes.filter(node=>node.browserProfileId===profileId),parentId)
  .sort((a,b)=>(a.url?1:0)-(b.url?1:0)||(isBarFolder(a)?-1:isBarFolder(b)?1:0)||collator.compare(name(a),name(b)));
}

/** Opens the shared bookmark menu (App's bookmark-context popup) at the pointer or under a row. */
export function openBookmarkMenu(ref:string,anchor:{x:number;y:number;width:number;height:number}){
 window.dispatchEvent(new CustomEvent<BookmarkMenuRequest>(bookmarkMenuEvent,{detail:{url:ref,anchor}}));
}

/** The order a folder's children are shown in: at the root the Bookmarks bar, then the folders, then loose bookmarks (the
 * sidebar and the Bookmarks page read it that way); anywhere else by position. */
const rank=(node:BookmarkNode)=>isBarFolder(node)?0:node.url?2:1;
export function displayOrder(nodes:BookmarkNode[],profileId:string,parentId:string|null):BookmarkNode[]{
 return childrenOf(nodes.filter(node=>node.browserProfileId===profileId),parentId).sort(parentId===null?(a,b)=>rank(a)-rank(b)||a.position-b.position:(a,b)=>a.position-b.position);
}

/** Where a moved bookmark or folder lands, as bookmark.move takes it: the folder it goes into and its index among that
 * folder's children (counted without the moved node, in position order). */
export type BookmarkPlace={parentId:string|null;index:number};
export type DropWhere='before'|'after'|'into';

/** Dropping `movingId` before, after or into `targetId` (R3-52, the sidebar's drag to reorder). Null when it can't go there:
 * onto itself, a page as a parent, a folder into its own branch, the Bookmarks bar anywhere, or across the root's order
 * (the root always shows the bar, then folders, then bookmarks, so "before a folder" would not show where it was dropped). */
export function bookmarkPlace(nodes:BookmarkNode[],profileId:string,movingId:string,targetId:string,where:DropWhere):BookmarkPlace|null{
 const mine=nodes.filter(node=>node.browserProfileId===profileId),moving=mine.find(node=>node.id===movingId),target=mine.find(node=>node.id===targetId);
 if(!moving||!target||moving.id===target.id||isBarFolder(moving))return null;
 // Is `id` the folder or somewhere under it?
 const under=(folder:BookmarkNode,id:string|null)=>{for(let guard=0;id&&guard<64;guard++){if(id===folder.id)return true;id=mine.find(node=>node.id===id)?.parentId??null;}return false;};
 if(where==='into'){
  if(target.url||!moving.url&&under(moving,target.id))return null;
  return {parentId:target.id,index:childrenOf(mine,target.id).filter(node=>node.id!==moving.id).length};
 }
 const parentId=target.parentId??null;
 if(!moving.url&&under(moving,parentId)||parentId===null&&rank(moving)!==rank(target))return null;
 const siblings=childrenOf(mine,parentId).filter(node=>node.id!==moving.id);
 return {parentId,index:Math.max(0,siblings.findIndex(node=>node.id===target.id))+(where==='after'?1:0)};
}

/** Move up / Move down (and Alt+Shift+Arrow): one step among the siblings as they are shown. Null at either end. */
export function bookmarkStep(nodes:BookmarkNode[],profileId:string,id:string,direction:-1|1):BookmarkPlace|null{
 const node=nodes.find(item=>item.id===id&&item.browserProfileId===profileId);
 if(!node||isBarFolder(node))return null;
 const parentId=node.parentId??null,order=displayOrder(nodes,profileId,parentId).filter(item=>parentId!==null||rank(item)===rank(node));
 const neighbour=order[order.findIndex(item=>item.id===id)+direction];
 return neighbour?bookmarkPlace(nodes,profileId,id,neighbour.id,direction<0?'before':'after'):null;
}
