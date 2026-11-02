import { groupForTab } from '../runtime/tabGroups';
import type { TabGroup,TabSession } from '../runtime/types';
import type { SplitGroup } from '../runtime/splitLayout';
import { splitPlacements,type SplitPlacement } from '../runtime/splitPlacement';

/** `nested`: a split chip that sits inside a tab group (R3-27). It carries the group as `group` so spacing, the group's
 *  outline and drop targets treat it as one of the group's members, but it is not the group's header. */
export type TabStripEntry={key:string;tab:TabSession;group?:TabGroup;splitGroup?:SplitGroup;header:boolean;nested?:boolean;pinned:boolean;fixedWidth?:number;minWidth?:number;count:number;
 /** A linked copy (founder, 28 Oct): this chip is the split tray's second drawing of a tab that also keeps its chip in its group. Its key is `link:<split>:<tab>`; the tab's own chip is the one with `linkedIn`. `homeGroup`: the tab group the copy's tab lives in. */linked?:boolean;linkedIn?:SplitGroup;homeGroup?:TabGroup};

/** What a chip is called to Reorder, the drag surface and the DOM: the tab id, except a linked copy (its key, so a tab drawn twice has two names). */
export const stripValue=(entry:Pick<TabStripEntry,'key'|'tab'|'linked'>)=>entry.linked?entry.key:entry.tab.id;

/** The split chip's width: disclosure, glyph, "Split view" and the count; folded, the members' site icons take the count's place. */
const chipWidth=(split:Pick<SplitGroup,'collapsed'|'tabIds'|'name'>)=>Math.min(190,(split.collapsed?122+split.tabIds.length*17:134)+(split.name?Math.min(60,Math.ceil(split.name.length*5.5)):0));

/** A group keeps its own stable disclosure header; hidden pages never impersonate it. A split lives where its home pane
 *  lives (docs/launch/SPLIT_IN_GROUPS.md): inside that tab's group (chip then its panes, counted in the group's tally, hidden
 *  when it collapses) or on its own. Its panes show only there: tabs follow where their split lives (28 Oct, no linked tabs). */
export function tabStripEntries(tabs:readonly TabSession[],groups:TabGroup[],compact=false,splitGroups:readonly SplitGroup[]=[]):TabStripEntry[]{
 const ordered=[...tabs].sort((a,b)=>Number(b.pinned)-Number(a.pinned)),seen=new Set<string>(),counts=new Map<string,number>();
 const {paneOf,linkOf}=splitPlacements(splitGroups,tabs,groups),placed=new Set<string>();
 /** A split's chips: its own panes in pane order; a linked copy has a chip of its own besides the tab's chip in its group. */
 const paneEntries=(placement:SplitPlacement,group?:TabGroup,count?:number)=>placement.panes.flatMap(id=>tabs.find(tab=>tab.id===id)||[]).map<TabStripEntry>(member=>{
  const copy=placement.linked.includes(member.id);if(!copy)placed.add(member.id);
  return copy?{key:`link:${placement.split.id}:${member.id}`,tab:member,...(group?{group}:{}),splitGroup:placement.split,header:false,pinned:false,count:count??placement.panes.length,linked:true,homeGroup:groupForTab({tabGroups:groups},member)}:{key:member.id,tab:member,...(group?{group}:{}),splitGroup:placement.split,header:false,pinned:false,count:count??placement.panes.length};
 });
 for(const tab of ordered){const group=!tab.pinned&&groupForTab({tabGroups:groups},tab);if(group)counts.set(group.id,(counts.get(group.id)||0)+1);}
 const entries:TabStripEntry[]=[];
 for(const tab of ordered){
  if(placed.has(tab.id))continue;
  const placement=paneOf.get(tab.id),splitGroup=placement?.split,parent=placement?.home;
  if(placement&&splitGroup&&!parent){
   const members=paneEntries(placement);
   entries.push({key:`split:${splitGroup.id}`,tab:members[0].tab,splitGroup,header:true,pinned:false,fixedWidth:chipWidth(splitGroup),minWidth:92,count:members.length});
   if(!splitGroup.collapsed)entries.push(...members);
   continue;
  }
  const group=parent||(!tab.pinned?groupForTab({tabGroups:groups},tab):undefined),count=group?counts.get(group.id)??0:0;
  if(group&&!seen.has(group.id)){
   seen.add(group.id);
   // A collapsed group also shows its expand chevron, so it needs room beyond the name and count.
   const fixedWidth=Math.min(compact?160:196,Math.max(56,44+Math.ceil(group.name.length*8)+String(count).length*8+(group.collapsed?14:0)));
   entries.push({key:`group:${group.id}`,tab,group,header:true,pinned:false,fixedWidth,minWidth:Math.min(fixedWidth,Math.max(56,44+String(count).length*8+Math.min(Math.ceil(group.name.length*8),40)+4)),count});
  }
  if(group?.collapsed)continue;
  if(placement&&splitGroup&&parent){
   const members=paneEntries(placement,parent,count);
   entries.push({key:`split:${splitGroup.id}`,tab:members[0].tab,group:parent,splitGroup,header:true,nested:true,pinned:false,fixedWidth:chipWidth(splitGroup),minWidth:92,count:members.length});
   if(!splitGroup.collapsed)entries.push(...members);
   continue;
  }
  const link=linkOf.get(tab.id)?.split;
  entries.push({key:tab.id,tab,group,header:false,pinned:tab.pinned,count,...(link?{linkedIn:link}:{})});
 }
 return entries;
}

export function adjacentStripEntry(entries:readonly TabStripEntry[],key:string,direction:string):TabStripEntry|undefined {
 if(!entries.length)return;
 const index=entries.findIndex(entry=>entry.key===key),step=['ArrowLeft','ArrowUp'].includes(direction)?-1:1;
 return entries[direction==='Home'?0:direction==='End'?entries.length-1:(index+step+entries.length)%entries.length];
}

/** Rows grouped under their header. A nested split chip and its members belong to the tab group's block, so the group's
 *  surface and ownership span them; a standalone split is its own block. */
export function tabStripBlocks(entries:readonly TabStripEntry[]){
 const blocks:{key:string;header?:TabStripEntry;items:{entry:TabStripEntry;index:number}[]}[]=[];
 entries.forEach((entry,index)=>{
  if(entry.header&&!entry.nested)blocks.push({key:entry.key,header:entry,items:[{entry,index}]});
  else if(entry.group&&blocks.at(-1)?.header?.group?.id===entry.group.id||entry.splitGroup&&blocks.at(-1)?.header?.splitGroup?.id===entry.splitGroup.id)blocks.at(-1)!.items.push({entry,index});
  else blocks.push({key:entry.key,items:[{entry,index}]});
 });return blocks;
}
