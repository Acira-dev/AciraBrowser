import type { BrowserSnapshot,TabGroup,TabSession } from './types';

/** Beta 14, section AE: groups inside groups. ONE level only: a top-level group (a "parent") can hold tabs of its own and inner groups; an inner group
 *  holds only tabs. An inner group names its parent with `parentGroupId`; a top-level group has none. A family is a parent and its inner groups.
 *
 *  Tabs still name their group by name (`tab.group`), as ever, and the list `state.tabs` is the order on screen: a family is one contiguous block, the
 *  parent's own tabs first and then each inner group's tabs in the order they stand (runtime/tabGroups.ts `reconcileTabGroups` keeps it so). A parent with
 *  no tabs of its own is a parent all the same: its inner groups' block is the family.
 *
 *  Old profiles carry no `parentGroupId` anywhere, so every group is top-level and nothing here changes what they load as. 13.8 ignores the field (it
 *  keeps every group and every tab, each group as its own contiguous block), so a downgrade loses only the nesting. */

type Scoped={browserProfileId:string;workspaceId?:string};
export const sameScope=(a:Scoped,b:Scoped)=>a.browserProfileId===b.browserProfileId&&(a.workspaceId??'')===(b.workspaceId??'');

/** The parent of an inner group (never of a top-level one). */
export function parentGroupOf(state:Pick<BrowserSnapshot,'tabGroups'>,group:Pick<TabGroup,'parentGroupId'>|undefined):TabGroup|undefined{
 return group?.parentGroupId?state.tabGroups.find(item=>item.id===group.parentGroupId):undefined;
}
/** A group's inner groups, in the order of the group list (the order on screen is the order of their tabs: see `innerGroupsInOrder`). */
export function innerGroupsOf(state:Pick<BrowserSnapshot,'tabGroups'>,parent:Pick<TabGroup,'id'>):TabGroup[]{
 return state.tabGroups.filter(item=>item.parentGroupId===parent.id);
}
/** The top-level group a group belongs to: itself, or its parent. */
export function topGroupOf(state:Pick<BrowserSnapshot,'tabGroups'>,group:TabGroup):TabGroup{return parentGroupOf(state,group)??group;}
/** Is `group` the family of `top` (the group itself or one of its inner groups)? */
export const inFamily=(group:Pick<TabGroup,'id'|'parentGroupId'>|undefined,top:Pick<TabGroup,'id'>)=>!!group&&(group.id===top.id||group.parentGroupId===top.id);
/** Is the group folded away, by its own `collapsed` or because its parent is collapsed (collapsing a parent hides everything inside it)? */
export function groupFolded(state:Pick<BrowserSnapshot,'tabGroups'>,group:TabGroup|undefined):boolean{
 return !!group&&(group.collapsed||!!parentGroupOf(state,group)?.collapsed);
}
/** Can `group` stand inside `parent`? Same profile and workspace, the parent is a top-level group other than the group itself, the group holds no groups of
 *  its own (one level only), and neither stands for a put-away workspace (runtime/profileSpaces.ts). */
export function canNest(state:Pick<BrowserSnapshot,'tabGroups'>,group:TabGroup,parent:TabGroup):boolean{
 if(group.id===parent.id||parent.parentGroupId||!sameScope(group,parent))return false;
 if(group.fromWorkspaceId||parent.fromWorkspaceId)return false;
 return !state.tabGroups.some(item=>item.parentGroupId===group.id);
}
/** The tabs of a group (not its inner groups'), in list order. */
export const ownTabs=(state:Pick<BrowserSnapshot,'tabs'>,group:TabGroup)=>state.tabs.filter(tab=>tab.group===group.name&&!tab.pinned&&sameScope(tab,group));
/** The tabs of a group and of its inner groups: the whole family block for a top-level group, just the group's tabs for an inner one. */
export function familyTabs(state:Pick<BrowserSnapshot,'tabs'|'tabGroups'>,group:TabGroup):TabSession[]{
 const ids=new Set([group.id,...innerGroupsOf(state,group).map(item=>item.id)]);
 return state.tabs.filter(tab=>{if(tab.pinned||!tab.group)return false;const home=state.tabGroups.find(item=>item.name===tab.group&&sameScope(item,tab));return !!home&&ids.has(home.id);});
}
/** The inner groups of a parent in the order they stand on screen (by their first tab); a group with no tab yet comes last in list order. */
export function innerGroupsInOrder(state:Pick<BrowserSnapshot,'tabs'|'tabGroups'>,parent:TabGroup):TabGroup[]{
 const first=(group:TabGroup)=>{const index=state.tabs.findIndex(tab=>tab.group===group.name&&!tab.pinned&&sameScope(tab,group));return index<0?Infinity:index;};
 return innerGroupsOf(state,parent).map((group,order)=>({group,at:first(group),order})).sort((a,b)=>a.at-b.at||a.order-b.order).map(item=>item.group);
}
/** One rendered family: a top-level group, the rows of its own tabs and its inner groups in order. Used by the list the sidebar draws. */
export interface GroupFamily{group:TabGroup;own:TabSession[];inner:{group:TabGroup;members:TabSession[]}[]}
export function groupFamily(state:Pick<BrowserSnapshot,'tabs'|'tabGroups'>,group:TabGroup):GroupFamily{
 return {group,own:ownTabs(state,group),inner:innerGroupsInOrder(state,group).map(item=>({group:item,members:ownTabs(state,item)})).filter(item=>item.members.length>0)};
}

/** Settle the nesting of a group list that was just loaded or edited: a link survives only when the parent exists, stands in the same profile and workspace,
 *  is not the group itself and is itself top-level. A group whose parent is itself inside a group goes to the top level (the deeper one is the one that
 *  moves out, so a chain A > B > C keeps A > B and frees C); a cycle frees both. Nothing here removes a group or a tab. Mutates and returns `groups`. */
export function settleNesting<T extends Pick<TabGroup,'id'|'browserProfileId'|'workspaceId'|'fromWorkspaceId'|'parentGroupId'>>(groups:T[]):T[]{
 const byId=new Map(groups.map(group=>[group.id,group]));
 const linked=new Set<string>();
 for(const group of groups){
  const parent=group.parentGroupId?byId.get(group.parentGroupId):undefined;
  if(parent&&parent.id!==group.id&&sameScope(parent,group)&&!parent.fromWorkspaceId&&!group.fromWorkspaceId)linked.add(group.id);else delete group.parentGroupId;
 }
 const nested=new Set(linked);
 for(const group of groups){if(group.parentGroupId&&nested.has(group.parentGroupId)){delete group.parentGroupId;linked.delete(group.id);}}
 // Pinned folders (runtime/pinnedFolders.ts): only a top-level folder carries the flag; an inner one stands where its parent stands.
 for(const group of groups as (T&{pinned?:true})[])if(group.parentGroupId)delete group.pinned;
 return groups;
}
