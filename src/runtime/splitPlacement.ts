import { groupForTab } from './tabGroups';
import type { BrowserSnapshot,TabGroup,TabSession } from './types';
import type { SplitGroup } from './splitLayout';

/** Where a split shows (docs/launch/SPLIT_IN_GROUPS.md). A split is its tab ids (pane order) and its home pane; a tab's group is its own.
 *  - anchor: the home pane (founder, 27 Oct: where the split was made; adding a pane never moves it; when it leaves, the next
 *    pane in pane order); home: the anchor's tab group (none when loose or pinned).
 *  - panes: every pane, in pane order. Tabs follow where their split lives (28 Oct: no mirrors, no linked rows): a tab that
 *    joins a split moves into the split's group, or out of every group (splitGroups.settleSplitHomes), so the split card is
 *    the one place its panes show. */
export type SplitPlacement={split:SplitGroup;anchorId:string;home?:TabGroup;panes:string[];/** Panes that are linked copies (founder, 28 Oct): their tab also stays in its own tab group, and shows there as well as in this split's card. Never the anchor. */linked:string[]};

const homeOf=(tab:TabSession,groups:readonly TabGroup[])=>tab.pinned?undefined:groupForTab({tabGroups:groups as TabGroup[]},tab);

export function splitPlacement(split:SplitGroup,tabs:readonly TabSession[],groups:readonly TabGroup[]):SplitPlacement|undefined{
 const members=new Map(tabs.filter(tab=>split.tabIds.includes(tab.id)).map(tab=>[tab.id,tab]));
 const copies=new Set(split.linked??[]),own=split.tabIds.filter(id=>members.has(id)&&!copies.has(id));
 const anchor=members.get(split.home??'')&&!copies.has(split.home!)?members.get(split.home!):members.get(own[0])||split.tabIds.map(id=>members.get(id)).find(Boolean);if(!anchor)return undefined;
 const home=homeOf(anchor,groups);
 return {split,anchorId:anchor.id,...(home?{home}:{}),panes:split.tabIds.filter(id=>members.has(id)),linked:own.length?split.tabIds.filter(id=>members.has(id)&&copies.has(id)&&id!==anchor.id):[]};
}

/** The split row menu's group rows: the groups the whole split can move into (this profile and workspace; not the group it
 *  already lives in), and whether it lives in a group (Remove from group). A private or Tor first tab takes no group. */
export function splitGroupMenu(state:Pick<BrowserSnapshot,'tabs'|'tabGroups'>,split:SplitGroup){
 const placement=splitPlacement(split,state.tabs,state.tabGroups),anchor=state.tabs.find(tab=>tab.id===placement?.anchorId);
 const grouped=!!placement?.home||state.tabs.some(tab=>split.tabIds.includes(tab.id)&&!placement?.linked.includes(tab.id)&&!!groupForTab(state,tab));
 const targets=anchor&&(!anchor.privacy||anchor.privacy==='secured')?state.tabGroups.filter(target=>target.browserProfileId===anchor.browserProfileId&&(target.workspaceId??'')===(anchor.workspaceId??'')&&target.id!==placement?.home?.id&&state.tabs.some(tab=>groupForTab(state,tab)?.id===target.id)):[];
 return {targets,grouped};
}

/** Every split's placement, keyed by split id, plus a lookup from a tab to the split whose card is the one place it shows
 *  (`paneOf`) and from a linked tab to the split that draws a copy of it besides its group row (`linkOf`). */
export function splitPlacements(splits:readonly SplitGroup[]|undefined,tabs:readonly TabSession[],groups:readonly TabGroup[]){
 const bySplit=new Map<string,SplitPlacement>(),paneOf=new Map<string,SplitPlacement>(),linkOf=new Map<string,SplitPlacement>();
 for(const split of splits??[]){const placement=splitPlacement(split,tabs,groups);if(!placement)continue;bySplit.set(split.id,placement);placement.panes.forEach(id=>(placement.linked.includes(id)?linkOf:paneOf).set(id,placement));}
 return {bySplit,paneOf,linkOf};
}

/** A pane shown by itself (founder, 28 Oct: "open that tab alone"): the current tab is a pane of a saved split that is not
 *  the one on screen. The split stays saved and its card stays where it is; one click on the card (or the pane's "Show split
 *  view") brings the arrangement back. Derived, nothing stored. */
export function soloSplit(state:Pick<BrowserSnapshot,'activeTabId'|'windowUi'>):SplitGroup|undefined{
 const split=state.windowUi.splitGroups?.find(group=>group.tabIds.includes(state.activeTabId));
 return split&&state.windowUi.split?.groupId!==split.id?split:undefined;
}
