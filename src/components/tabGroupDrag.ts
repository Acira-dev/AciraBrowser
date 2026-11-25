import { canNest,familyTabs,groupForTab,innerGroupsInOrder,topGroupOf } from '../runtime/tabGroups';
import type { BrowserAction,TabGroup,TabSession } from '../runtime/types';
import { splitDropAt } from '../ui/splitDropTarget';

type Point={x:number;y:number};
export type TabDropIntent={groupId:string;track:HTMLElement;centerOffset:number;startPointer:number;start:number;end:number;edge:number;vertical:boolean};
/** Freeze the logical group boundary before live reordering moves its neighbors. */
export function captureTabDropIntent(root:HTMLElement|null,point:Point,from:string,tabs:TabSession[],groups:TabGroup[],vertical=false):TabDropIntent|null{
 const source=tabs.find(tab=>tab.id===from),group=source&&groupForTab({tabGroups:groups},source);if(!root||!group)return null;
 const nodes=[...root.querySelectorAll<HTMLElement>('[data-tab-id]')].filter(node=>!node.hasAttribute('inert'));
 const node=nodes.find(node=>node.dataset.tabId===from),track=(node?.offsetParent||node?.parentElement) as HTMLElement|null;if(!node||!track)return null;
 const members=nodes.filter(node=>(node.offsetParent||node.parentElement)===track&&tabs.some(tab=>tab.id===node.dataset.tabId&&groupForTab({tabGroups:groups},tab)?.id===group.id));
 const start=(node:HTMLElement)=>vertical?node.offsetTop:node.offsetLeft,size=(node:HTMLElement)=>vertical?node.offsetHeight:node.offsetWidth;
 const width=size(node),bounds=node.getBoundingClientRect(),trackBounds=track.getBoundingClientRect();if(width<=0||!members.length)return null;
 const first=Math.min(...members.map(start)),last=Math.max(...members.map(node=>start(node)+size(node)));
 if(!Number.isFinite(first)||!Number.isFinite(last))return null;
 return {groupId:group.id,track,startPointer:vertical?point.y-trackBounds.top:point.x-trackBounds.left,centerOffset:vertical?bounds.top+bounds.height/2-point.y:bounds.left+bounds.width/2-point.x,start:first,end:last,edge:Math.min(32,width*.25),vertical};
}
/** Keep deliberate pointer-edge exits while allowing a broad tab-center boundary. */
function capturedTabExit(intent:TabDropIntent,point:Point):'before'|'after'|null{
 const bounds=intent.track.getBoundingClientRect(),pointer=intent.vertical?point.y-bounds.top:point.x-bounds.left,center=pointer+intent.centerOffset,travel=pointer-intent.startPointer,edge=Math.min(16,intent.edge);
 if(center<=intent.start+intent.edge||travel< -12&&pointer<=intent.start+edge)return 'before';
 if(center>=intent.end-intent.edge||travel>12&&pointer>=intent.end-edge)return 'after';
 return null;
}
/** The top of a folder's header (as a share of its height) that is a place above the folder; the rest of the header drops onto the folder. */
const HEADER_EXIT=.4;
const contains=(bounds:DOMRect,point:Point)=>point.x>=bounds.left&&point.x<=bounds.right&&point.y>=bounds.top&&point.y<=bounds.bottom;
export function captureTabDrag(from:string,tabs:TabSession[],groups:TabGroup[]){
 const index=tabs.findIndex(tab=>tab.id===from),tab=tabs[index];if(!tab)return null;
 return {id:from,left:tabs[index-1]?.id,right:tabs[index+1]?.id,groupId:groupForTab({tabGroups:groups},tab)?.id||null,pinned:tab.pinned,profile:tab.browserProfileId};
}
/** Cancel projection reorders without overwriting concurrent group/profile edits. */
export function tabDragRollback(origin:ReturnType<typeof captureTabDrag>,tabs:TabSession[],groups:TabGroup[]):BrowserAction|null{
 if(!origin)return null;const index=tabs.findIndex(tab=>tab.id===origin.id),tab=tabs[index];
 if(!tab||tab.pinned!==origin.pinned||tab.browserProfileId!==origin.profile||(groupForTab({tabGroups:groups},tab)?.id||null)!==origin.groupId)return null;
 if(tabs[index-1]?.id===origin.left&&tabs[index+1]?.id===origin.right)return null;
 const right=tabs.find(tab=>tab.id===origin.right),left=tabs.find(tab=>tab.id===origin.left),target=right||left;if(!target)return null;
 return {type:'tab.drop',from:origin.id,to:target.id,groupId:origin.groupId,position:right?'before':'after'};
}
/** Live projection stays inside a contiguous profile/pin/group partition.
 * Equal ungrouped endpoints can still have an entire group between them. */
export function canLiveReorder(from:string,to:string,tabs:TabSession[],groups:TabGroup[]):boolean{
 const start=tabs.findIndex(tab=>tab.id===from),end=tabs.findIndex(tab=>tab.id===to),source=tabs[start];if(!source||end<0)return false;
 const groupId=groupForTab({tabGroups:groups},source)?.id;
 return tabs.slice(Math.min(start,end),Math.max(start,end)+1).every(tab=>tab.pinned===source.pinned&&tab.browserProfileId===source.browserProfileId&&groupForTab({tabGroups:groups},tab)?.id===groupId);
}
/** Live Reorder owns placement inside one partition. Release only commits a
 * membership change; measuring a still-moving neighbor must not reorder twice. */
export function releaseTabDrag(drop:BrowserAction|null,origin:ReturnType<typeof captureTabDrag>,tabs:TabSession[],groups:TabGroup[]):BrowserAction|null{
 if(!drop)return tabDragRollback(origin,tabs,groups);
 if(drop.type!=='tab.drop'||drop.wholeGroup)return drop;
 const source=tabs.find(tab=>tab.id===drop.from),target=tabs.find(tab=>tab.id===drop.to);
 if(source&&(groupForTab({tabGroups:groups},source)?.id||null)===(drop.groupId||null)&&(!target||canLiveReorder(source.id,target.id,tabs,groups)))return null;
 return drop;
}
/** Use insertion boundaries for grouped drags, with a small allowance for pointer jitter. */
export function tabDropAtPoint(root:HTMLElement|null,point:Point,from:string,tabs:TabSession[],groups:TabGroup[],vertical=false,intent?:TabDropIntent|null,measure:(node:HTMLElement)=>DOMRect=node=>node.getBoundingClientRect(),reach?:Point):BrowserAction|null{
 const source=tabs.find(tab=>tab.id===from);if(!root||!source||!Number.isFinite(point.x)||!Number.isFinite(point.y))return null;
 // `reach` is the pointer in the layout `measure` reads (the sidebar's drag measures the list without the room it opened, so what the person sees and what is tested are one place; sidebarTabDrag.ts `reach`).
 // R3-79: the whole split (its chip, any member, the gap between two members) takes the tab at the slot under the pointer.
 const splitDrop=splitDropAt(root.ownerDocument,point,from,vertical);
 if(splitDrop)return {type:'split.group.add',id:splitDrop.groupId,tabId:from,index:splitDrop.index};
 const sidebar=root.ownerDocument?.elementFromPoint?.(point.x,point.y)?.closest<HTMLElement>('[data-sidebar-group]');
 if(sidebar){const group=groups.find(group=>group.id===sidebar.dataset.sidebarGroup);return group&&group.browserProfileId===source.browserProfileId?{type:'tab.drop',from,groupId:group.id}:null;}
 const sourceGroup=groupForTab({tabGroups:groups},source),bounds=measure(root);
 const captured=intent&&intent.groupId===sourceGroup?.id&&intent.vertical===vertical&&intent.track.isConnected?intent:null;
 const along=captured?96:0,across=captured?12:0;
 const detach=(position:'before'|'after'):BrowserAction=>{const peers=tabs.filter(tab=>tab.id!==from&&groupForTab({tabGroups:groups},tab)?.id===sourceGroup?.id),target=position==='before'?peers[0]:peers.at(-1);return {type:'tab.drop',from,...(target?{to:target.id,position}:{}),groupId:null};};
 // Pulling a grouped tab below the strip is an explicit detach, not a canceled reorder.
 // Keep a small dead zone for ordinary pointer jitter and leave far-away drops canceled.
 if(captured&&!vertical&&point.y>=bounds.bottom+16&&point.y<=bounds.bottom+160&&point.x>=bounds.left-96&&point.x<=bounds.right+96){
  const trackBounds=measure(captured.track);
  return detach(point.x-trackBounds.left<(captured.start+captured.end)/2?'before':'after');
 }
 // Overshooting either end of the strip along its own row is a placement at that end, not a cancel.
 // The tab is held in the strip, but the pointer keeps travelling; a grouped tab released there
 // leaves its group. Only drops far off the row (or below the detach band) still cancel.
 if(!vertical&&point.y>=bounds.top-24&&point.y<bounds.bottom+16&&(point.x>bounds.right||point.x<bounds.left)){
  const partition=tabs.filter(tab=>tab.id!==from&&tab.pinned===source.pinned&&tab.browserProfileId===source.browserProfileId),after=point.x>bounds.right,target=after?partition.at(-1):partition[0];
  return target?{type:'tab.drop',from,to:target.id,position:after?'after':'before',groupId:null}:sourceGroup?{type:'tab.drop',from,groupId:null}:null;
 }
 if(point.x<bounds.left-(vertical?across:along)||point.x>bounds.right+(vertical?across:along)||point.y<bounds.top-(vertical?along:across)||point.y>bounds.bottom+(vertical?along:across))return null;
 const aim=reach??point,hitPoint={x:Math.max(bounds.left,Math.min(bounds.right,aim.x)),y:Math.max(bounds.top,Math.min(bounds.bottom,aim.y))};
 const capsule=[...root.querySelectorAll<HTMLElement>('[data-group-tray]')].find(node=>node.dataset.groupTray&&!node.hasAttribute('inert')&&groups.some(group=>group.id===node.dataset.groupTray&&group.collapsed)&&contains(measure(node),hitPoint));
 if(capsule){const group=groups.find(group=>group.id===capsule.dataset.groupTray)!;return sourceGroup?.id===group.id?detach('before'):group.browserProfileId===source.browserProfileId?{type:'tab.drop',from,groupId:group.id}:null;}
 const headers=[...root.querySelectorAll<HTMLElement>('[data-group-header]')].filter(node=>node.dataset.groupHeader&&!node.hasAttribute('inert'));
 const groupHeader=headers.find(node=>contains(measure(node),hitPoint));
 if(groupHeader&&vertical){
  // The sidebar's folder header: its top is a place above the folder (the same as the row above it), the rest drops onto it. A folder's ends are real places, not the edge of a pixel.
  const group=groups.find(group=>group.id===groupHeader.dataset.groupHeader),box=measure(groupHeader);
  if(group&&group.browserProfileId===source.browserProfileId){
   const members=tabs.filter(tab=>tab.id!==from&&groupForTab({tabGroups:groups},tab)?.id===group.id),first=members[0];
   if(hitPoint.y<box.top+box.height*HEADER_EXIT)return first?{type:'tab.drop',from,to:first.id,position:'before',groupId:null}:{type:'tab.drop',from,groupId:null};
   if(sourceGroup?.id===group.id)return first?{type:'tab.drop',from,to:first.id,position:'before',groupId:group.id}:null;
   return members.length?{type:'tab.drop',from,groupId:group.id}:null;
  }
  return null;
 }
 if(groupHeader){const group=groups.find(group=>group.id===groupHeader.dataset.groupHeader);if(sourceGroup&&group?.id===sourceGroup.id)return detach('before');return group&&group.browserProfileId===source.browserProfileId&&tabs.some(tab=>groupForTab({tabGroups:groups},tab)?.id===group.id)?{type:'tab.drop',from,groupId:group.id}:null;}
 const collapsedHeaders=headers.filter(node=>groups.some(group=>group.id===node.dataset.groupHeader&&group.collapsed));
 const candidates=[...root.querySelectorAll<HTMLElement>('[data-tab-id]'),...collapsedHeaders].filter(node=>(node.dataset.tabId||node.dataset.groupTab)!==from&&!node.hasAttribute('inert'))
  .map(node=>({node,bounds:measure(node),tab:tabs.find(tab=>tab.id===(node.dataset.tabId||node.dataset.groupTab)),header:collapsedHeaders.includes(node)}))
  .filter(item=>!item.header||item.tab&&groupForTab({tabGroups:groups},item.tab)?.id===item.node.dataset.groupHeader)
  .filter(item=>item.tab&&item.bounds.width>0&&item.bounds.height>0)
  .sort((a,b)=>vertical?a.bounds.top-b.bounds.top:a.bounds.left-b.bounds.left);
 if(!candidates.length){
  if(captured){const exit=capturedTabExit(captured,point);return exit?detach(exit):null;}
  return sourceGroup?{type:'tab.drop',from,groupId:null}:null;
 }
 const axis=vertical?aim.y:aim.x,start=(bounds:DOMRect)=>vertical?bounds.top:bounds.left,end=(bounds:DOMRect)=>vertical?bounds.bottom:bounds.right;
 const distance=(bounds:DOMRect)=>Math.max(start(bounds)-axis,axis-end(bounds),0);
 const direct=candidates.find(item=>contains(item.bounds,hitPoint));
 // The grabbed point can be anywhere on a tab. Its center crossing a broad
 // boundary expresses an exit; shifting neighbors must not move that boundary.
 if(captured&&(!direct||groupForTab({tabGroups:groups},direct.tab!)?.id===sourceGroup?.id)){
  const exit=capturedTabExit(captured,point);if(exit)return detach(exit);
  const peers=candidates.filter(item=>groupForTab({tabGroups:groups},item.tab!)?.id===sourceGroup?.id);
  const target=direct||peers.reduce<typeof peers[number]|undefined>((best,item)=>!best||distance(item.bounds)<distance(best.bounds)?item:best,undefined);
  return {type:'tab.drop',from,...(target?{to:target.tab!.id,position:axis>(start(target.bounds)+end(target.bounds))/2?'after' as const:'before' as const}:{}),groupId:sourceGroup!.id};
 }
 const target=direct||candidates.reduce((best,item)=>distance(item.bounds)<distance(best.bounds)?item:best);
 const tab=target.tab!,group=groupForTab({tabGroups:groups},tab),position=axis>(start(target.bounds)+end(target.bounds))/2?'after':'before';
 // A collapsed disclosure is a real placement boundary, even without mounted
 // member tabs. Its direct hit above still joins; adjacent space stays outside.
 if(target.header||!group)return {type:'tab.drop',from,to:tab.id,groupId:null,position};
 // The existing label is an explicit join target, including a collapsed group.
 const header=[...target.node.querySelectorAll<HTMLElement>('[data-group-id]')].find(node=>node.dataset.groupId===group.id&&contains(measure(node),point));
 if(header)return {type:'tab.drop',from,groupId:group.id};
 const peers=candidates.filter(item=>groupForTab({tabGroups:groups},item.tab!)?.id===group.id),edge=Math.min(16,(end(target.bounds)-start(target.bounds))*(vertical?0:.18));
 const leadingHeader=headers.find(node=>node.dataset.groupHeader===group.id),leading=leadingHeader?measure(leadingHeader):undefined;
 const outside=target===peers[0]&&(leading?axis<start(leading):axis<=start(target.bounds)+edge)||target===peers.at(-1)&&axis>=end(target.bounds)-edge;
 return {type:'tab.drop',from,to:tab.id,groupId:outside?null:group.id,position};
}

/** Where the carried tab stands now, as a drop: beside its neighbour in its own folder, or (a loose tab) beside the tab next to it. The decision while the pointer is over the slot that is open at its place. */
export function stayDrop(from:string,tabs:TabSession[],groups:TabGroup[]):BrowserAction|null{
 const source=tabs.find(tab=>tab.id===from);if(!source)return null;
 const group=groupForTab({tabGroups:groups},source),at=tabs.indexOf(source);
 if(group){
  const mates=tabs.filter(tab=>tab.id!==from&&groupForTab({tabGroups:groups},tab)?.id===group.id),before=mates.filter(tab=>tabs.indexOf(tab)<at).at(-1),after=mates.find(tab=>tabs.indexOf(tab)>at);
  return before?{type:'tab.drop',from,to:before.id,position:'after',groupId:group.id}:after?{type:'tab.drop',from,to:after.id,position:'before',groupId:group.id}:{type:'tab.drop',from,groupId:group.id};
 }
 const next=tabs[at+1],previous=tabs[at-1],near=next??previous;
 return near?{type:'tab.drop',from,to:near.id,position:next?'before':'after',groupId:null}:null;
}
/** At the end of a folder the slot opens one row tall, and a tab there can be the folder's last or the tab after the folder: the same place, two levels. The slot's upper part keeps the tab inside
 *  and its lower part takes it out, with a band between so the decision does not flicker; the pointer never has to cross a whole empty row to leave. `y` is the pointer, `slot` the open slot. */
const END_OUT=.6,END_IN=.4;
export function folderEndFlip(action:BrowserAction|null,tabs:TabSession[],groups:TabGroup[],y:number,slot:{top:number;height:number}):BrowserAction|null{
 const where=dropPlace(action,tabs,groups);if(!where||where.kind!=='edge'||action?.type!=='tab.drop'||where.position!=='after')return null;
 // Where the tab stands now stays (its own place is not a decision to leave); it leaves by the pointer going below its row.
 if(JSON.stringify(stayDrop(action.from,tabs,groups))===JSON.stringify(action))return null;
 const share=(y-slot.top)/Math.max(1,slot.height),to=tabs.find(tab=>tab.id===where.to),group=to&&groupForTab({tabGroups:groups},to);if(!group)return null;
 if(where.anchor==='tab'&&where.level==='in'){
  const last=tabs.filter(tab=>tab.id!==action.from&&groupForTab({tabGroups:groups},tab)?.id===group.id).at(-1);
  return last?.id===where.to&&share>=END_OUT?{...action,groupId:null}:null;
 }
 return where.anchor==='block'&&share<END_IN?{...action,groupId:group.id}:null;
}

/** Where a drop (see `tabDropAtPoint`) lands in the list, in terms of what the person sees: one description for the grey slot, the blue line and the room the rows open, so they can
 *  never disagree with each other or with the drop. `in`: at the level of the tab it is placed beside (inside its folder); `top`: at the top level, which for a tab that leaves its
 *  folder at the folder's first or last place is the edge of the whole folder. */
export type DropPlace={kind:'join';group:string}|{kind:'edge';anchor:'tab'|'block';id:string;position:'before'|'after';level:'in'|'top';/** The tab the action names (the folder's first or last member for a block). */to:string};
/** `join`: dropped onto a folder's header, which takes it as its last tab: the header is ringed and no slot opens (the rows stay where they are, so the header stays under the pointer). */
export function dropPlace(action:BrowserAction|null,tabs:TabSession[],groups:TabGroup[]):DropPlace|null{
 if(action?.type!=='tab.drop'||action.wholeGroup)return null;
 if(!action.to)return action.groupId?{kind:'join',group:action.groupId}:null;
 const to=tabs.find(tab=>tab.id===action.to);if(!to)return null;
 const group=groupForTab({tabGroups:groups},to),position=action.position??'before';
 if(action.groupId&&group?.id!==action.groupId)return {kind:'join',group:action.groupId};
 if(!group||action.groupId===group.id)return {kind:'edge',anchor:'tab',id:to.id,position,level:group?'in':'top',to:to.id};
 const members=tabs.filter(tab=>tab.id!==action.from&&groupForTab({tabGroups:groups},tab)?.id===group.id);
 if(position==='before'&&members[0]?.id===to.id||position==='after'&&members.at(-1)?.id===to.id)return {kind:'edge',anchor:'block',id:group.id,position,level:'top',to:to.id};
 return {kind:'edge',anchor:'tab',id:to.id,position,level:'in',to:to.id};
}

/** Moving a label relocates its block; it never merges groups or changes membership. */
export function groupDropAtPoint(root:HTMLElement|null,point:Point,from:string,tabs:TabSession[],groups:TabGroup[],vertical=false):BrowserAction|null{
 const source=tabs.find(tab=>tab.id===from),group=source&&groupForTab({tabGroups:groups},source);if(!root||!group)return null;
 const splitDrop=splitDropAt(root.ownerDocument,point,from,vertical);
 if(splitDrop)return {type:'split.group.add',id:splitDrop.groupId,tabId:from,wholeGroup:true,index:splitDrop.index};
 // A top-level group moves with its whole family (Beta 14, AE: its inner groups), an inner group by itself.
 const members=new Set(familyTabs({tabs,tabGroups:groups},group).map(tab=>tab.id));
 if(tabs.every(tab=>members.has(tab.id))||!contains(root.getBoundingClientRect(),point))return null;
 const nodes=[...root.querySelectorAll<HTMLElement>('[data-tab-id],[data-group-header]')].filter(node=>!node.hasAttribute('inert'));
 const nodeTab=(node:HTMLElement)=>node.dataset.tabId||node.dataset.groupTab||'';
 const candidates=nodes.filter(node=>!members.has(nodeTab(node))&&tabs.some(tab=>tab.id===nodeTab(node)));
 const axis=vertical?point.y:point.x,start=(bounds:DOMRect)=>vertical?bounds.top:bounds.left,end=(bounds:DOMRect)=>vertical?bounds.bottom:bounds.right;
 const own=nodes.filter(node=>members.has(nodeTab(node))).map(node=>node.getBoundingClientRect()).filter(bounds=>bounds.width>0&&bounds.height>0);
 if(own.length&&axis>=Math.min(...own.map(start))&&axis<=Math.max(...own.map(end)))return null;
 // The top strip (Beta 14, AE): over another group's tray, away from its ends, the group goes INSIDE it (one level); over an inner group's tray it takes a place among that group's siblings.
 const nest=vertical?null:nestDropAt(root,point,from,group,tabs,groups);if(nest)return nest;
 const distance=(bounds:DOMRect)=>Math.max(start(bounds)-axis,axis-end(bounds),0);
 const measured=candidates.map(node=>({node,bounds:node.getBoundingClientRect()})).filter(item=>item.bounds.width>0&&item.bounds.height>0);
 if(!measured.length)return null;
 const target=measured.reduce((best,item)=>distance(item.bounds)<distance(best.bounds)?item:best);
 return {type:'tab.drop',from,to:nodeTab(target.node),wholeGroup:true,position:axis>(start(target.bounds)+end(target.bounds))/2?'after':'before'};
}

/** The strip's nesting drop: the group tray under the pointer, innermost first. The outer quarter (at most 28px) of a tray at either end is a place before or after it, not a nest. Null: no nesting here. */
export function nestDropAt(root:HTMLElement,point:Point,from:string,group:TabGroup,tabs:TabSession[],groups:TabGroup[]):BrowserAction|null{
 const trays=[...root.querySelectorAll<HTMLElement>('[data-group-tray]')].filter(node=>!node.hasAttribute('inert')).map(node=>({box:node.getBoundingClientRect(),target:groups.find(item=>item.id===node.dataset.groupTray)}))
  .filter(item=>item.target&&item.target.id!==group.id&&item.target.parentGroupId!==group.id&&item.box.width>0&&contains(item.box,point)).sort((a,b)=>a.box.width*a.box.height-b.box.width*b.box.height);
 const hit=trays[0];if(!hit)return null;
 const target=hit.target!,edge=Math.min(28,hit.box.width*.25);
 if(point.x<hit.box.left+edge||point.x>hit.box.right-edge)return null;
 if(target.parentGroupId){
  const parent=groups.find(item=>item.id===target.parentGroupId);if(!parent||!canNest({tabGroups:groups},group,parent))return null;
  const own=tabs.filter(tab=>groupForTab({tabGroups:groups},tab)?.id===target.id),before=point.x<(hit.box.left+hit.box.right)/2,anchor=before?own[0]:own.at(-1);
  return anchor?{type:'tab.drop',from,wholeGroup:true,parentGroupId:parent.id,to:anchor.id,position:before?'before':'after'}:null;
 }
 if(group.parentGroupId===target.id||!canNest({tabGroups:groups},group,target))return null;
 return {type:'tab.drop',from,wholeGroup:true,parentGroupId:target.id};
}

/** Keyboard group movement relocates the block, preserving profile and pins. A top-level group moves with its whole family (Beta 14, AE: its inner groups); an inner group
 *  moves among its siblings, one place at a time, and stays inside its parent. */
export function groupKeyboardDrop(tabs:TabSession[],groups:TabGroup[],groupId:string,key:string):BrowserAction|null{
 const group=groups.find(group=>group.id===groupId);if(!group)return null;
 if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(key))return null;
 const state={tabs,tabGroups:groups},backward=['ArrowLeft','ArrowUp','Home'].includes(key);
 if(group.parentGroupId){
  const parent=groups.find(item=>item.id===group.parentGroupId);if(!parent)return null;
  const siblings=innerGroupsInOrder(state,parent).filter(item=>familyTabs(state,item).length>0),at=siblings.findIndex(item=>item.id===group.id);
  const target=key==='Home'?siblings[0]:key==='End'?siblings.at(-1):siblings[at+(backward?-1:1)];
  return target&&target.id!==group.id?{type:'tab.group.move',id:group.id,parentId:parent.id,to:target.id,position:backward?'before':'after'}:null;
 }
 const members=familyTabs(state,group).filter(tab=>!tab.pinned);if(!members.length)return null;
 const others=tabs.filter(tab=>!tab.pinned&&tab.browserProfileId===group.browserProfileId&&!members.includes(tab));
 const first=tabs.indexOf(members[0]),last=tabs.indexOf(members.at(-1)!);
 const target=key==='Home'?others[0]:key==='End'?others.at(-1):backward?others.filter(tab=>tabs.indexOf(tab)<first).at(-1):others.find(tab=>tabs.indexOf(tab)>last);
 return target?{type:'tab.drop',from:members[0].id,to:target.id,wholeGroup:true,position:backward?'before':'after'}:null;
}

/** Nesting and un-nesting from the keyboard in the sidebar (Alt+Shift+Right / Left): Right puts the group inside the top-level group just above it in the list, Left takes an inner group out
 *  to the top level, right after the group it left. Nothing happens when the move is not allowed (one level only: runtime/groupNesting.ts). */
export function groupKeyboardNest(tabs:TabSession[],groups:TabGroup[],groupId:string,key:string):BrowserAction|null{
 const group=groups.find(item=>item.id===groupId);if(!group)return null;
 if(key==='ArrowLeft')return group.parentGroupId?{type:'tab.group.move',id:group.id,parentId:null}:null;
 if(key!=='ArrowRight'||group.parentGroupId)return null;
 const state={tabs,tabGroups:groups},mine=tabs.find(tab=>!tab.pinned&&groupForTab(state,tab)?.id===group.id)??tabs.find(tab=>!tab.pinned&&groupForTab(state,tab)&&topGroupOf(state,groupForTab(state,tab)!).id===group.id);
 if(!mine)return null;
 const above=tabs.slice(0,tabs.indexOf(mine)).reverse().map(tab=>groupForTab(state,tab)).find(item=>item&&topGroupOf(state,item).id!==group.id);
 const parent=above&&topGroupOf(state,above);
 return parent&&canNest(state,group,parent)?{type:'tab.group.move',id:group.id,parentId:parent.id}:null;
}
