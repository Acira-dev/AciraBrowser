import type { BrowserAction,BrowserSnapshot,TabGroup,TabGroupColor,TabSession } from './types';
import { groupPinned,tabIsPinned } from './pinnedFolders';
import { canNest,familyTabs,groupFolded,innerGroupsInOrder,innerGroupsOf,inFamily,ownTabs,parentGroupOf,settleNesting,topGroupOf } from './groupNesting';
export { groupPinned,tabIsPinned,inPinnedFolder } from './pinnedFolders';
export { canNest,familyTabs,groupFamily,groupFolded,inFamily,innerGroupsInOrder,innerGroupsOf,ownTabs,parentGroupOf,settleNesting,topGroupOf } from './groupNesting';

export const TAB_GROUP_COLORS: Record<TabGroupColor,string> = {none:'transparent',grey:'#8E8E93',blue:'#0088FF',red:'#FF383C',yellow:'#FFCC00',green:'#34C759',pink:'#FF2D55',purple:'#CB30E0',cyan:'#00C0E8',orange:'#FF8D28'};
const cleanName=(name:unknown)=>typeof name==='string'?name.trim().slice(0,64):'';
const validColor=(color:unknown):color is TabGroupColor=>typeof color==='string'&&Object.hasOwn(TAB_GROUP_COLORS,color);
/** Beta 14 (section M): does this folder take its colour from the sites inside it? `auto` says so when it is set. A group saved before Beta 14 has no
 *  `auto`: it is automatic when it still wears the colour every group was given by default ("none", or the blue the sidebar's New group used), and keeps
 *  its colour when the person picked another one, or when it stands for a put-away workspace (that colour is the workspace's). One rule, so the
 *  sidebar, the colour menu and the tests cannot disagree. */
export function isAutoGroup(group:Pick<TabGroup,'color'|'auto'|'fromWorkspaceId'>):boolean{
 if(typeof group.auto==='boolean')return group.auto;
 if(group.fromWorkspaceId)return false;
 return group.color==='none'||group.color==='blue';
}
/** Private and Tor tabs take no group (nothing about them is kept); a secured workspace's tabs do: its groups are sealed with them (R3-38). */
const groupless=(tab:Pick<TabSession,'privacy'>)=>!!tab.privacy&&tab.privacy!=='secured';
const lastIndex=(tabs:TabSession[],matches:(tab:TabSession)=>boolean)=>{for(let i=tabs.length-1;i>=0;i--)if(matches(tabs[i]))return i;return -1;};
export function tabGroupNames(tabs:TabSession[],profile:string):string[]{return [...new Set(tabs.filter(tab=>tab.browserProfileId===profile&&tab.group).map(tab=>tab.group))].sort((a,b)=>a.localeCompare(b));}
export function tabGroupActions(tabs:TabSession[],request:{type:'assign'|'rename';tabId:string;name:string}|{type:'remove'|'ungroup';tabId:string},groups:TabGroup[]=[]):BrowserAction[]{
 const tab=tabs.find(tab=>tab.id===request.tabId);if(!tab)return [];
 const group=groupForTab({tabGroups:groups},tab);
 if(request.type==='remove')return tab.group?[{type:'tab.group.assign',tabIds:[tab.id],groupId:null}]:[];
 const name='name' in request?cleanName(request.name):'';
 if(request.type==='assign')return name&&name!==tab.group?[{type:'tab.group.create',tabId:tab.id,name}]:[];
 if(!tab.group||request.type==='rename'&&(!name||name===tab.group))return [];
 if(group)return request.type==='ungroup'?[{type:'tab.group.remove',id:group.id}]:[{type:'tab.group.update',id:group.id,patch:{name}}];
 return tabs.filter(item=>item.group===tab.group&&item.browserProfileId===tab.browserProfileId).map(item=>({type:'tab.update',id:item.id,patch:{group:name}}));
}
/** Groups are scoped to a profile and a workspace (R3-57): the same name in two workspaces is two groups. An absent `workspaceId` is the profile's first workspace. */
const inScope=(a:{browserProfileId:string;workspaceId?:string},b:{browserProfileId:string;workspaceId?:string})=>a.browserProfileId===b.browserProfileId&&(a.workspaceId??'')===(b.workspaceId??'');
export function groupForTab(state:Pick<BrowserSnapshot,'tabGroups'>,tab:Pick<TabSession,'group'|'browserProfileId'|'workspaceId'>):TabGroup|undefined {
 return state.tabGroups.find(group=>group.name===tab.group&&inScope(group,tab));
}
export function visibleGroupTabs(state:Pick<BrowserSnapshot,'tabs'|'tabGroups'|'activeTabId'>):TabSession[]{
 return state.tabs.filter(tab=>!groupFolded(state,groupForTab(state,tab))||tab.id===state.activeTabId);
}
/** Keep a disclosure target for every collapsed group, using its active member when necessary. */
export function groupStripTabs(tabs:TabSession[],groups:TabGroup[],activeId:string):TabSession[]{
 return tabs.filter(tab=>{const group=groupForTab({tabGroups:groups},tab);if(!group||!groupFolded({tabGroups:groups},group))return true;const representative=tabs.find(item=>item.id===activeId&&groupForTab({tabGroups:groups},item)?.id===group.id)||tabs.find(item=>groupForTab({tabGroups:groups},item)?.id===group.id);return representative?.id===tab.id;});
}
function newGroup(state:BrowserSnapshot,name:string,profile:string,color:TabGroupColor='none',workspaceId?:string):TabGroup {
 let id=`group-${state.revision}-${state.tabGroups.length}`;while(state.tabGroups.some(group=>group.id===id))id+='-new';
 const group:TabGroup={id,name,color,collapsed:false,browserProfileId:profile,...(workspaceId?{workspaceId}:{})};state.tabGroups.push(group);return group;
}
/** The marks of a group that stands for a put-away workspace while profiles are spaces (runtime/profileSpaces.ts), kept as they are. */
const fromWorkspaceMarks=(value:TabGroup):Partial<TabGroup>=>typeof value.fromWorkspaceId==='string'&&value.fromWorkspaceId?{fromWorkspaceId:value.fromWorkspaceId,...(typeof value.fromName==='string'?{fromName:value.fromName}:{}),...(typeof value.fromGroup==='string'?{fromGroup:value.fromGroup}:{})}:{};
/** Groups have stable IDs and remain profile-scoped. Legacy names are migrated without losing memberships. */
export function reconcileTabGroups(state:BrowserSnapshot):void {
 const ids=new Set<string>(),names=new Set<string>();
 state.tabGroups=(Array.isArray(state.tabGroups)?state.tabGroups:[]).flatMap(value=>{
  if(!value||typeof value!=='object'||typeof value.id!=='string'||!cleanName(value.name)||!state.browserProfiles.some(profile=>profile.id===value.browserProfileId))return [];
  const key=`${value.browserProfileId}\0${value.workspaceId??''}\0${cleanName(value.name)}`;if(ids.has(value.id)||names.has(key))return [];ids.add(value.id);names.add(key);
  return [{id:value.id,name:cleanName(value.name),color:validColor(value.color)?value.color:'none' as TabGroupColor,collapsed:value.collapsed===true,...(value.pinned===true?{pinned:true as const}:{}),...(typeof value.auto==='boolean'?{auto:value.auto}:{}),...(typeof value.parentGroupId==='string'&&value.parentGroupId?{parentGroupId:value.parentGroupId}:{}),browserProfileId:value.browserProfileId,...(typeof value.workspaceId==='string'&&value.workspaceId?{workspaceId:value.workspaceId}:{}),...fromWorkspaceMarks(value),...(typeof value.lastActiveTabId==='string'&&state.tabs.some(tab=>tab.id===value.lastActiveTabId&&!tab.pinned&&tab.group===value.name&&inScope(tab,value))?{lastActiveTabId:value.lastActiveTabId}:{})}];
 });
 settleNesting(state.tabGroups);
 for(const tab of [...state.tabs,...state.closedTabs]){
  tab.group=tab.pinned||groupless(tab)?'':cleanName(tab.group);
  // A closed tab of a workspace that was just deleted names no group of its own: the workspace's Undo brings the group back.
  if(tab.group&&!groupForTab(state,tab)&&(!tab.workspaceId||(state.workspaces??[]).some(workspace=>workspace.id===tab.workspaceId)))newGroup(state,tab.group,tab.browserProfileId,'none',tab.workspaceId);
 }
 // A group is one contiguous block, and a family (Beta 14, AE: a group and its inner groups) is one contiguous block too: the group's own tabs, then each inner group's
 // block in the order they stand. Preserve the order of members and each block's first position.
 // Pinned folders (runtime/pinnedFolders.ts): the list is units, a loose tab (pinned or not) or a family block, in the order they stand; the units of the pinned area (a pinned tab, a pinned folder's family) come first.
 const ordinary=state.tabs.filter(tab=>!tab.pinned),placed=new Set<string>(),units:{tabs:TabSession[];pinned:boolean}[]=[];
 for(const tab of state.tabs){if(placed.has(tab.id))continue;
  if(tab.pinned){placed.add(tab.id);units.push({tabs:[tab],pinned:true});continue;}
  const group=groupForTab(state,tab),top=group&&topGroupOf(state,group);let members:TabSession[];
  if(!group||!top)members=[tab];
  else{const inner=innerGroupsOf(state,top);members=ordinary.filter(item=>item.group===top.name&&inScope(item,top));
   if(inner.length){const blocks=inner.map(item=>ordinary.filter(member=>member.group===item.name&&inScope(member,item))).filter(block=>block.length).sort((a,b)=>ordinary.indexOf(a[0])-ordinary.indexOf(b[0]));for(const block of blocks)members.push(...block);}}
  for(const member of members)placed.add(member.id);
  units.push({tabs:members,pinned:!!top&&groupPinned(state,top)});}
 state.tabs=[...units.filter(unit=>unit.pinned).flatMap(unit=>unit.tabs),...units.filter(unit=>!unit.pinned).flatMap(unit=>unit.tabs)];
}
/** Open a group, and its parent: a tab shown in a folder inside a closed folder needs both open. */
export function openGroup(state:Pick<BrowserSnapshot,'tabGroups'>,group:TabGroup|undefined):void{if(!group)return;group.collapsed=false;const parent=parentGroupOf(state,group);if(parent)parent.collapsed=false;}
function assign(state:BrowserSnapshot,tabIds:string[],group:TabGroup|null){
 const selected=state.tabs.filter(tab=>tabIds.includes(tab.id)&&(!group||inScope(tab,group)&&!groupless(tab)));
 if(!selected.length)return;
 for(const tab of selected){tab.group=group?.name||'';if(group)tab.pinned=false;}
 if(group){openGroup(state,group);if(selected.some(tab=>tab.id===state.activeTabId))group.lastActiveTabId=state.activeTabId;const others=state.tabs.filter(tab=>!selected.includes(tab));const last=lastIndex(others,tab=>tab.group===group.name&&inScope(tab,group));if(last>=0){others.splice(last+1,0,...selected);state.tabs=others;}}
 reconcileTabGroups(state);
}
/** 14.1: the tab `tab.new` just made joins the group it names, in the same reduction (runtime/core.ts), with assign's rules: the same profile and workspace, no private or Tor tab,
 * the group (and its parent) opens, the tab follows the group's last tab. A group that is gone or out of scope leaves the tab where `tab.new` put it. */
export function joinNewTab(state:BrowserSnapshot,tabId:string,groupId:string):void{const group=state.tabGroups.find(item=>item.id===groupId);if(group)assign(state,[tabId],group);}
/** A fold or unfold of a group that the interface may draw on the click's own frame (runtime/client.ts applies the same reducer at once and main's snapshot,
 * a round trip later, replaces it). Only the `collapsed` flag changes and the current tab stays where it is. A fold that would move the selection (the group of
 * the current tab collapsing without `keepActive`, as the strip does) can end with a new tab whose id only main makes, so that one waits for main. */
export function isGroupFold(state:Pick<BrowserSnapshot,'tabs'|'tabGroups'|'activeTabId'>,action:BrowserAction):boolean{
 if(action.type!=='tab.group.update')return false;
 const keys=Object.keys(action.patch);if(keys.length!==1||keys[0]!=='collapsed'||typeof action.patch.collapsed!=='boolean')return false;
 const group=state.tabGroups.find(item=>item.id===action.id);if(!group)return false;
 if(action.keepActive)return true;
 const active=state.tabs.find(tab=>tab.id===state.activeTabId),home=active&&groupForTab(state,active);
 if(!home)return true;
 // The current tab's folder is the one folding, or the folder it stands inside (a parent folds its inner groups with it).
 return inFamily(home,group)?!action.patch.collapsed:!groupFolded(state,home);
}
/** Pick the nearest visible page after the collapsing block, then before it. */
export function nextExpandedGroupTab(state:Pick<BrowserSnapshot,'tabs'|'tabGroups'>,groupId:string):TabSession|undefined {
 const members=state.tabs.map((tab,index)=>inFamily(groupForTab(state,tab),{id:groupId})?index:-1).filter(index=>index>=0);
 if(!members.length)return;
 // The next page is picked in the group's own workspace, never one that is not on screen.
 const owner=state.tabGroups.find(group=>group.id===groupId),visible=(tab:TabSession)=>{if(owner&&!inScope(tab,owner))return false;const group=groupForTab(state,tab);return !inFamily(group,{id:groupId})&&!groupFolded(state,group);};
 return state.tabs.slice(members.at(-1)!+1).find(visible)||state.tabs.slice(0,members[0]).reverse().find(visible);
}
/** Shared drag and menu operations. Cross-profile drops are rejected rather than moving website storage. */
export function applyTabGroupAction(state:BrowserSnapshot,action:BrowserAction):boolean {
 if(action.type==='tab.reorder'){
  const moving=state.tabs.find(tab=>tab.id===action.from),target=state.tabs.find(tab=>tab.id===action.to);
  if(!moving||!target||moving.id===target.id||moving.pinned!==target.pinned||!inScope(moving,target))return true;
  const source=groupForTab(state,moving),destination=groupForTab(state,target),position=state.tabs.indexOf(moving)<state.tabs.indexOf(target)?'after':'before';
  // Crossing a group edge removes membership instead of snapping back during reconciliation.
  return applyTabGroupAction(state,{type:'tab.drop',from:moving.id,to:target.id,groupId:source?.id===destination?.id?source?.id||null:null,position});
 }
 if(action.type==='tab.group.create'){
  const tab=state.tabs.find(tab=>tab.id===action.tabId),name=cleanName(action.name);if(!tab||groupless(tab)||!name)return true;
  const existing=state.tabGroups.find(group=>group.name===name&&inScope(group,tab));
  const wasPinned=tab.pinned,group=existing||newGroup(state,name,tab.browserProfileId,validColor(action.color)?action.color:'none',tab.workspaceId);
  if(!existing&&wasPinned)group.pinned=true; // Move to tab group > New tab group on a pinned tab makes a pinned folder
  if(validColor(action.color))group.color=action.color;
  // Beta 14: a colour given without `auto` is a pick; the sidebar's New group asks for `auto:true` and gets the colour from its sites.
  if(typeof action.auto==='boolean')group.auto=action.auto;else if(validColor(action.color))group.auto=false;
  assign(state,[tab.id],group);return true;
 }
 if(action.type==='tab.group.update'){
  const group=state.tabGroups.find(group=>group.id===action.id);if(!group)return true;
  if(action.patch.name!==undefined){const name=cleanName(action.patch.name);if(!name)return true;const duplicate=state.tabGroups.find(item=>item.id!==group.id&&item.name===name&&inScope(item,group));if(duplicate)return true;for(const tab of [...state.tabs,...state.closedTabs])if(tab.group===group.name&&inScope(tab,group))tab.group=name;group.name=name;}
  if(validColor(action.patch.color)){group.color=action.patch.color;if(typeof action.patch.auto!=='boolean')group.auto=false;} // picking a colour is leaving Automatic
  if(typeof action.patch.auto==='boolean')group.auto=action.patch.auto;
  // Pin or unpin a top-level folder (a folder that stands for a put-away workspace stays where it is); reconcile moves its block into or out of the pinned units.
  if(typeof action.patch.pinned==='boolean'){if(action.patch.pinned&&!group.parentGroupId&&!group.fromWorkspaceId)group.pinned=true;else delete group.pinned;reconcileTabGroups(state);}
  if(typeof action.patch.collapsed==='boolean'){group.collapsed=action.patch.collapsed;if(group.collapsed&&!action.keepActive){const active=state.tabs.find(tab=>tab.id===state.activeTabId);if(active&&inFamily(groupForTab(state,active),group)){const outside=nextExpandedGroupTab(state,group.id);if(outside)state.activeTabId=outside.id;}}}
  return true;
 }
 if(action.type==='tab.group.remove'){
  const group=state.tabGroups.find(group=>group.id===action.id);if(!group)return true;for(const tab of [...state.tabs,...state.closedTabs])if(groupForTab(state,tab)?.id===group.id)tab.group='';
  // Ungrouping a parent frees its inner groups to the top level (their tabs stay in them); it never dissolves a folder that was not asked for.
  for(const inner of innerGroupsOf(state,group))delete inner.parentGroupId;
  state.tabGroups=state.tabGroups.filter(item=>item.id!==group.id);reconcileTabGroups(state);return true;
 }
 if(action.type==='tab.group.assign'){
  const group=action.groupId===null?null:state.tabGroups.find(group=>group.id===action.groupId);if(group!==undefined)assign(state,action.tabIds,group);return true;
 }
 if(action.type==='tab.drop'){
  const moving=state.tabs.find(tab=>tab.id===action.from),target=state.tabs.find(tab=>tab.id===action.to);if(!moving||action.to&&!target||target?.id===moving.id)return true;
  if(action.wholeGroup){
   const source=groupForTab(state,moving),destination=target&&groupForTab(state,target);
   if(!source||moving.pinned||target?.pinned||target&&!inScope(target,source))return true;
   // Beta 14 (AE): `parentGroupId` names the group this one is to stand inside (null: the top level); absent, a top-level group stays where it is in the tree and
   // an inner group stays in its parent. A group is never dropped onto its own family.
   if(Object.hasOwn(action,'parentGroupId'))return moveGroup(state,source,action.parentGroupId??null,target?{tab:target,position:action.position??'before'}:null),true;
   if(destination&&topGroupOf(state,destination).id===topGroupOf(state,source).id&&!source.parentGroupId)return true;
   if(destination?.id===source.id)return true;
   // An inner group carried onto a tab outside its family leaves it; carried onto a sibling it reorders among its siblings.
   if(source.parentGroupId){const sibling=destination&&destination.parentGroupId===source.parentGroupId;return moveGroup(state,source,sibling?source.parentGroupId:null,target?{tab:target,position:action.position??'before'}:null),true;}
   return moveGroup(state,source,null,target?{tab:target,position:action.position??'before'}:null),true;
  }
  const group=Object.hasOwn(action,'groupId')?action.groupId===null?null:state.tabGroups.find(group=>group.id===action.groupId):target?groupForTab(state,target)||null:null;
  if(group===undefined||group&&!inScope(group,moving)||target&&!inScope(target,moving))return true;
  const targetGroup=target&&groupForTab(state,target);
  if(group&&targetGroup&&group.id!==targetGroup.id)return true;
  // Pinned folders (decision 4): a drop beside a pinned tab (or a pinned folder's tab, outside it) pins the tab; a drop beside a tab of the list unpins a pinned tab.
  const toPinned=!!target&&tabIsPinned(state,target),pinNow=!group&&toPinned&&!moving.pinned,unpinNow=!group&&!!target&&!toPinned&&!!moving.pinned;
  moving.group=group?.name||'';if(group){moving.pinned=false;openGroup(state,group);if(moving.id===state.activeTabId)group.lastActiveTabId=moving.id;}else if(pinNow)moving.pinned=true;else if(unpinNow)moving.pinned=false;
  state.tabs=state.tabs.filter(tab=>tab.id!==moving.id);
  if(target){const targets=!group&&targetGroup?state.tabs.filter(tab=>groupForTab(state,tab)?.id===targetGroup.id):[target];const index=state.tabs.indexOf(action.position==='after'?targets.at(-1)!:targets[0]);state.tabs.splice(index+(action.position==='after'?1:0),0,moving);}
  else {const last=group?lastIndex(state.tabs,tab=>groupForTab(state,tab)?.id===group.id):-1;state.tabs.splice(last>=0?last+1:state.tabs.length,0,moving);}
  reconcileTabGroups(state);return true;
 }
  if(action.type==='tab.group.move'){
  const group=state.tabGroups.find(item=>item.id===action.id);if(!group)return true;
  const anchor=action.to?state.tabGroups.find(item=>item.id===action.to):undefined,anchorTab=action.toTab?state.tabs.find(tab=>tab.id===action.toTab):undefined;
  if(typeof action.pinned==='boolean'&&!action.parentId&&!group.parentGroupId){if(action.pinned&&!group.fromWorkspaceId)group.pinned=true;else delete group.pinned;}
  moveGroup(state,group,action.parentId,anchor?{group:anchor,position:action.position??'before'}:anchorTab?{tab:anchorTab,position:action.position??'before'}:null);return true;
 }
 return false;
}
/** Beta 14 (AE): move a group to a new place in the tree. `parentId` is the group it is to stand inside, or null for the top level; the anchor, a sibling group or a tab, says
 *  where in that list it goes (before or after it); with no anchor it goes last in the parent, or (out of a group) right after the group it came from, or (top level) last.
 *  A top-level group that stays top-level takes its whole family with it; an inner group, or a group being nested, moves with just its own tabs. One level only: a group
 *  that holds groups is never nested, nothing nests inside an inner group, and a group never goes inside itself. Refused moves change nothing. Returns whether it moved. */
export function moveGroup(state:BrowserSnapshot,group:TabGroup,parentId:string|null,anchor:{group?:TabGroup;tab?:TabSession;position:'before'|'after'}|null):boolean{
 const parent=parentId?state.tabGroups.find(item=>item.id===parentId):null;
 if(parentId&&(!parent||!canNest(state,group,parent)))return false;
 if(anchor?.tab&&((anchor.tab.pinned&&!group.pinned&&!(parent&&parent.pinned))||!inScope(anchor.tab,group)))return false;
 if(anchor?.group&&!inScope(anchor.group,group))return false;
 const formerParent=parentGroupOf(state,group),wholeFamily=!parent&&!group.parentGroupId;
 const moving=wholeFamily?familyTabs(state,group):ownTabs(state,group),movingSet=new Set(moving.map(tab=>tab.id));
 // The anchor, as a group in the destination list (a tab stands for its group) or a loose tab.
 let anchorGroup=anchor?.group??(anchor?.tab?groupForTab(state,anchor.tab):undefined);
 if(anchorGroup&&anchorGroup.id===group.id)return false;
 if(anchorGroup&&parentGroupOf(state,anchorGroup)?.id===group.id)return false; // onto one of its own inner groups
 if(parent)group.parentGroupId=parent.id;else delete group.parentGroupId;
 const others=state.tabs.filter(tab=>!movingSet.has(tab.id));
 const block=(tabs:TabSession[])=>tabs.filter(tab=>!movingSet.has(tab.id));
 let index=-1;
 if(moving.length){
  if(parent){
   const inner=anchorGroup&&anchorGroup.parentGroupId===parent.id?anchorGroup:undefined,ownOfParent=block(ownTabs(state,parent)),family=block(familyTabs(state,parent));
   if(inner){const tabs=block(ownTabs(state,inner));if(tabs.length)index=others.indexOf(anchor!.position==='after'?tabs.at(-1)!:tabs[0])+(anchor!.position==='after'?1:0);}
   else if(anchorGroup?.id===parent.id||anchorGroup&&topGroupOf(state,anchorGroup).id===parent.id){index=ownOfParent.length?others.indexOf(ownOfParent.at(-1)!)+1:family.length?others.indexOf(family[0]):-1;}
   if(index<0&&family.length)index=others.indexOf(family.at(-1)!)+1;
  }else{
   const top=anchorGroup&&topGroupOf(state,anchorGroup),tabs=top?block(familyTabs(state,top)):anchor?.tab&&!anchorGroup?[anchor.tab]:[];
   if(tabs.length)index=others.indexOf(anchor!.position==='after'?tabs.at(-1)!:tabs[0])+(anchor!.position==='after'?1:0);
   else if(!anchor&&formerParent){const family=block(familyTabs(state,formerParent));if(family.length)index=others.indexOf(family.at(-1)!)+1;}
  }
  others.splice(index<0?others.length:index,0,...moving);state.tabs=others;
 }
 reconcileTabGroups(state);
 return true;
}
