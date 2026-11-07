import type { BrowserAction,BrowserSnapshot,TabGroup,TabGroupColor,TabSession } from './types';

export const TAB_GROUP_COLORS: Record<TabGroupColor,string> = {none:'transparent',grey:'#8E8E93',blue:'#0088FF',red:'#FF383C',yellow:'#FFCC00',green:'#34C759',pink:'#FF2D55',purple:'#CB30E0',cyan:'#00C0E8',orange:'#FF8D28'};
const cleanName=(name:unknown)=>typeof name==='string'?name.trim().slice(0,64):'';
const validColor=(color:unknown):color is TabGroupColor=>typeof color==='string'&&Object.hasOwn(TAB_GROUP_COLORS,color);
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
 return state.tabs.filter(tab=>!groupForTab(state,tab)?.collapsed||tab.id===state.activeTabId);
}
/** Keep a disclosure target for every collapsed group, using its active member when necessary. */
export function groupStripTabs(tabs:TabSession[],groups:TabGroup[],activeId:string):TabSession[]{
 return tabs.filter(tab=>{const group=groupForTab({tabGroups:groups},tab);if(!group?.collapsed)return true;const representative=tabs.find(item=>item.id===activeId&&groupForTab({tabGroups:groups},item)?.id===group.id)||tabs.find(item=>groupForTab({tabGroups:groups},item)?.id===group.id);return representative?.id===tab.id;});
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
  return [{id:value.id,name:cleanName(value.name),color:validColor(value.color)?value.color:'none' as TabGroupColor,collapsed:value.collapsed===true,browserProfileId:value.browserProfileId,...(typeof value.workspaceId==='string'&&value.workspaceId?{workspaceId:value.workspaceId}:{}),...fromWorkspaceMarks(value),...(typeof value.lastActiveTabId==='string'&&state.tabs.some(tab=>tab.id===value.lastActiveTabId&&!tab.pinned&&tab.group===value.name&&inScope(tab,value))?{lastActiveTabId:value.lastActiveTabId}:{})}];
 });
 for(const tab of [...state.tabs,...state.closedTabs]){
  tab.group=tab.pinned||groupless(tab)?'':cleanName(tab.group);
  // A closed tab of a workspace that was just deleted names no group of its own: the workspace's Undo brings the group back.
  if(tab.group&&!groupForTab(state,tab)&&(!tab.workspaceId||(state.workspaces??[]).some(workspace=>workspace.id===tab.workspaceId)))newGroup(state,tab.group,tab.browserProfileId,'none',tab.workspaceId);
 }
 // A group is one contiguous block. Preserve the order of members and each block's first position.
 const pinned=state.tabs.filter(tab=>tab.pinned),ordinary=state.tabs.filter(tab=>!tab.pinned),placed=new Set<string>(),ordered:TabSession[]=[];
 for(const tab of ordinary){if(placed.has(tab.id))continue;const group=groupForTab(state,tab);const members=group?ordinary.filter(item=>item.group===group.name&&inScope(item,group)):[tab];for(const member of members){ordered.push(member);placed.add(member.id);}}
 state.tabs=[...pinned,...ordered];
}
function assign(state:BrowserSnapshot,tabIds:string[],group:TabGroup|null){
 const selected=state.tabs.filter(tab=>tabIds.includes(tab.id)&&(!group||inScope(tab,group)&&!groupless(tab)));
 if(!selected.length)return;
 for(const tab of selected){tab.group=group?.name||'';if(group)tab.pinned=false;}
 if(group){group.collapsed=false;if(selected.some(tab=>tab.id===state.activeTabId))group.lastActiveTabId=state.activeTabId;const others=state.tabs.filter(tab=>!selected.includes(tab));const last=lastIndex(others,tab=>tab.group===group.name&&inScope(tab,group));if(last>=0){others.splice(last+1,0,...selected);state.tabs=others;}}
 reconcileTabGroups(state);
}
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
 return home.id===group.id?!action.patch.collapsed:!home.collapsed;
}
/** Pick the nearest visible page after the collapsing block, then before it. */
export function nextExpandedGroupTab(state:Pick<BrowserSnapshot,'tabs'|'tabGroups'>,groupId:string):TabSession|undefined {
 const members=state.tabs.map((tab,index)=>groupForTab(state,tab)?.id===groupId?index:-1).filter(index=>index>=0);
 if(!members.length)return;
 // The next page is picked in the group's own workspace, never one that is not on screen.
 const owner=state.tabGroups.find(group=>group.id===groupId),visible=(tab:TabSession)=>{if(owner&&!inScope(tab,owner))return false;const group=groupForTab(state,tab);return group?.id!==groupId&&!group?.collapsed;};
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
  const group=existing||newGroup(state,name,tab.browserProfileId,validColor(action.color)?action.color:'none',tab.workspaceId);
  if(validColor(action.color))group.color=action.color;assign(state,[tab.id],group);return true;
 }
 if(action.type==='tab.group.update'){
  const group=state.tabGroups.find(group=>group.id===action.id);if(!group)return true;
  if(action.patch.name!==undefined){const name=cleanName(action.patch.name);if(!name)return true;const duplicate=state.tabGroups.find(item=>item.id!==group.id&&item.name===name&&inScope(item,group));if(duplicate)return true;for(const tab of [...state.tabs,...state.closedTabs])if(tab.group===group.name&&inScope(tab,group))tab.group=name;group.name=name;}
  if(validColor(action.patch.color))group.color=action.patch.color;
  if(typeof action.patch.collapsed==='boolean'){group.collapsed=action.patch.collapsed;if(group.collapsed&&!action.keepActive){const active=state.tabs.find(tab=>tab.id===state.activeTabId);if(active&&groupForTab(state,active)?.id===group.id){const outside=nextExpandedGroupTab(state,group.id);if(outside)state.activeTabId=outside.id;}}}
  return true;
 }
 if(action.type==='tab.group.remove'){
  const group=state.tabGroups.find(group=>group.id===action.id);if(!group)return true;for(const tab of [...state.tabs,...state.closedTabs])if(groupForTab(state,tab)?.id===group.id)tab.group='';state.tabGroups=state.tabGroups.filter(item=>item.id!==group.id);return true;
 }
 if(action.type==='tab.group.assign'){
  const group=action.groupId===null?null:state.tabGroups.find(group=>group.id===action.groupId);if(group!==undefined)assign(state,action.tabIds,group);return true;
 }
 if(action.type==='tab.drop'){
  const moving=state.tabs.find(tab=>tab.id===action.from),target=state.tabs.find(tab=>tab.id===action.to);if(!moving||action.to&&!target||target?.id===moving.id)return true;
  if(action.wholeGroup){
   const source=groupForTab(state,moving),destination=target&&groupForTab(state,target);
   if(!source||moving.pinned||target?.pinned||target&&!inScope(target,source)||destination?.id===source.id)return true;
   const members=state.tabs.filter(tab=>groupForTab(state,tab)?.id===source.id),others=state.tabs.filter(tab=>!members.includes(tab));
   let index=others.length;
   if(target){const targets=destination?others.filter(tab=>groupForTab(state,tab)?.id===destination.id):[target];index=others.indexOf(action.position==='after'?targets.at(-1)!:targets[0])+(action.position==='after'?1:0);}
   others.splice(index,0,...members);state.tabs=others;reconcileTabGroups(state);return true;
  }
  const group=Object.hasOwn(action,'groupId')?action.groupId===null?null:state.tabGroups.find(group=>group.id===action.groupId):target?groupForTab(state,target)||null:null;
  if(group===undefined||group&&!inScope(group,moving)||target&&!inScope(target,moving))return true;
  const targetGroup=target&&groupForTab(state,target);
  if(group&&targetGroup&&group.id!==targetGroup.id)return true;
  if(target?.pinned){if(!moving.pinned)return true;}else if(moving.pinned&&!group)return true;
  moving.group=group?.name||'';if(group){moving.pinned=false;group.collapsed=false;if(moving.id===state.activeTabId)group.lastActiveTabId=moving.id;}
  state.tabs=state.tabs.filter(tab=>tab.id!==moving.id);
  if(target){const targets=!group&&targetGroup?state.tabs.filter(tab=>groupForTab(state,tab)?.id===targetGroup.id):[target];const index=state.tabs.indexOf(action.position==='after'?targets.at(-1)!:targets[0]);state.tabs.splice(index+(action.position==='after'?1:0),0,moving);}
  else {const last=group?lastIndex(state.tabs,tab=>groupForTab(state,tab)?.id===group.id):-1;state.tabs.splice(last>=0?last+1:state.tabs.length,0,moving);}
  reconcileTabGroups(state);return true;
 }
 return false;
}
