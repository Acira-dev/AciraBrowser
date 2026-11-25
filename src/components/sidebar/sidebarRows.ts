import { groupFolded,groupForTab,inPinnedFolder,topGroupOf } from '../../runtime/tabGroups';
import { splitPlacements } from '../../runtime/splitPlacement';
import type { SplitGroup } from '../../runtime/splitLayout';
import type { BrowserSnapshot,TabGroup,TabSession } from '../../runtime/types';
import type { SidebarFolders } from '../../ui/railPrefs';

/** The sidebar's Tabs list as rows (docs/launch/SPLIT_IN_GROUPS.md). A split lives where its home pane lives: a free split is
 *  a top-level entry; a split whose home pane is in a group is one of that group's rows. The split card lists its panes and
 *  nothing else shows them (28 Oct: no mirrors, no linked rows; tabs follow where their split lives). */
/** A group's inner groups (Beta 14, AE: one level; runtime/groupNesting.ts), in the order they stand, each with its own tabs. */
export type SidebarInner={group:TabGroup;members:TabSession[]};
export type SidebarEntry={kind:'tab';tab:TabSession}|{kind:'group';group:TabGroup;members:TabSession[];/** Only a top-level group has them; absent or empty: an ordinary group. */inner:SidebarInner[]}|{kind:'split';split:SplitGroup;members:TabSession[]};
/** `link`: the loose split that also draws this grouped tab as a linked copy (founder, 28 Oct); the tab keeps its row in its group. */
export type SidebarGroupRow={kind:'tab';tab:TabSession;hidden:boolean;link?:SplitGroup}|{kind:'split';split:SplitGroup;members:TabSession[];hidden:boolean};

/** A stable partition for the folders area (beta.13, item 14): the groups keep their order among themselves, the loose tabs and free splits
 *  keep theirs; "mixed" leaves the list as the tabs were opened. */
export function foldersArea(entries:readonly SidebarEntry[],folders:SidebarFolders){
 if(folders==='mixed')return {entries:[...entries],folderCount:0,looseCount:entries.length};
 const groups=entries.filter(entry=>entry.kind==='group'),loose=entries.filter(entry=>entry.kind!=='group');
 return {entries:folders==='above'?[...groups,...loose]:[...loose,...groups],folderCount:groups.length,looseCount:loose.length};
}

/** The groups the list draws, each with the tabs of its own that are listed: a group with no tab of its own is still listed while an inner group of it has tabs (Beta 14, AE: its family is what is drawn). */
export function sidebarGroups(state:Pick<BrowserSnapshot,'tabs'|'tabGroups'>,profileId:string,listed:(tab:TabSession)=>boolean):{group:TabGroup;members:TabSession[]}[]{
 const all=state.tabGroups.filter(group=>group.browserProfileId===profileId).map(group=>({group,members:state.tabs.filter(tab=>listed(tab)&&groupForTab(state,tab)?.id===group.id)}));
 return all.filter(item=>item.members.length||all.some(other=>other.group.parentGroupId===item.group.id&&other.members.length));
}

export function sidebarRows(state:Pick<BrowserSnapshot,'tabs'|'tabGroups'|'windowUi'|'activeTabId'>,ordered:readonly TabSession[],groups:readonly {group:TabGroup;members:TabSession[]}[],folders:SidebarFolders='mixed'){
 const {paneOf,linkOf}=splitPlacements(state.windowUi.splitGroups,state.tabs,state.tabGroups);
 const listed:SidebarEntry[]=[],seen=new Set<string>();
 // Every pane of the split, in pane order.
 const panes=(split:SplitGroup)=>split.tabIds.flatMap(id=>state.tabs.find(item=>item.id===id)||[]);
 for(const tab of ordered){
  const placement=paneOf.get(tab.id);
  if(placement&&!placement.home){if(!seen.has(placement.split.id)){seen.add(placement.split.id);listed.push({kind:'split',split:placement.split,members:panes(placement.split)});}continue;}
  const home=placement?.home||groupForTab(state,tab);if(!home){listed.push({kind:'tab',tab});continue;}
  // An inner group is drawn inside its parent: the family stands where its first tab stands, as one entry of the parent (a parent with no tabs of its own too).
  const group=topGroupOf(state,home);
  if(seen.has(group.id))continue;seen.add(group.id);
  const item=groups.find(entry=>entry.group.id===group.id);
  const inner=groups.filter(entry=>entry.group.parentGroupId===group.id).map(entry=>({group:entry.group,members:entry.members,at:ordered.findIndex(member=>entry.members.some(item=>item.id===member.id))})).filter(entry=>entry.members.length).sort((a,b)=>a.at-b.at).map(({group,members})=>({group,members}));
  const own=item?.members??[];
  if(own.length||inner.length)listed.push({kind:'group',group:item?.group??group,members:own,inner});
 }
 const area=foldersArea(listed,folders),entries=area.entries;
 // A collapsed group still shows the current tab under its header (Arc); a split in it stays while it holds the current tab.
 const shownMember=(group:TabGroup,tab:TabSession)=>!groupFolded(state,group)||tab.id===state.activeTabId;
 const nestedHidden=(group:TabGroup,split:SplitGroup)=>group.collapsed&&!split.tabIds.includes(state.activeTabId);
 const groupRows=(group:TabGroup,members:readonly TabSession[]):SidebarGroupRow[]=>{const drawn=new Set<string>();return members.flatMap<SidebarGroupRow>(tab=>{
  const placement=paneOf.get(tab.id);if(!placement){const link=linkOf.get(tab.id)?.split;return [{kind:'tab',tab,hidden:!shownMember(group,tab),...(link?{link}:{})}];}
  // A pane is drawn by its card, wherever that card lives (a private pane of a grouped split has no group of its own).
  if(placement.home?.id!==group.id||drawn.has(placement.split.id))return [];drawn.add(placement.split.id);
  return [{kind:'split',split:placement.split,members:panes(placement.split),hidden:nestedHidden(group,placement.split)}];
 });};
 /** The rows the keyboard walks (Alt+Shift+arrows), top to bottom. */
 const visibleTabs=(pinned:readonly TabSession[])=>[...pinned,...entries.flatMap(entry=>entry.kind==='tab'?[entry.tab]:entry.kind==='split'?entry.split.collapsed?[]:entry.members:[{group:entry.group,members:entry.members},...entry.inner].flatMap(item=>groupRows(item.group,item.members).flatMap(row=>row.kind==='tab'?row.hidden?[]:[row.tab]:row.hidden||row.split.collapsed?[]:row.members)))];
 return {entries,groupRows,visibleTabs,paneOf,linkOf,folderCount:area.folderCount,looseCount:area.looseCount,folders};
}

/** What the Pinned block draws (Beta 14, pinned folders: runtime/pinnedFolders.ts): the pinned tabs that are not a pane of a split (a pinned pane is listed in its split's card) and the tabs of the pinned folders. */
export function pinnedTabsOf(state:Pick<BrowserSnapshot,'tabs'|'tabGroups'|'windowUi'>,tabs:readonly TabSession[]):TabSession[]{
 const {paneOf}=splitPlacements(state.windowUi.splitGroups,state.tabs,state.tabGroups);
 return tabs.filter(tab=>inPinnedFolder(state,tab)||tab.pinned&&!groupForTab(state,tab)&&!paneOf.has(tab.id));
}
