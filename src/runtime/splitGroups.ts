import type { BrowserAction, BrowserSnapshot, ClosedSplit, TabSession, WindowUi } from './types';
import { defaultLayout, MAX_PANES, normalizeSplit, type SplitGroup } from './splitLayout';
import { applyTabGroupAction, groupForTab } from './tabGroups';
import en from '../i18n/en.json';

/** Saved splits belong to one window. Membership and dimensions survive visiting a different tab. */
export function normalizeSplitGroups(input: unknown, tabs: readonly Pick<TabSession,'id'>[]): SplitGroup[] {
  if (!Array.isArray(input)) return [];
  const openIds=tabs.map(tab=>tab.id), used=new Set<string>(), ids=new Set<string>(), groups:SplitGroup[]=[];
  for(const raw of input.slice(0,tabs.length)) {
    if(!raw||typeof raw!=='object'||typeof raw.id!=='string'||!/^split-[a-zA-Z0-9-]{1,100}$/.test(raw.id)||ids.has(raw.id)||!Array.isArray(raw.tabIds))continue;
    const kept=raw.tabIds.filter((id:unknown)=>typeof id==='string'&&openIds.includes(id)&&!used.has(id));
    const split=normalizeSplit(kept.length===raw.tabIds.length?raw:{...raw,tabIds:kept,layout:defaultLayout(kept.length),cols:undefined,rows:undefined},openIds,kept[0]);
    if(!split)continue;
    ids.add(raw.id);split.tabIds.forEach(id=>used.add(id));
    // Linked copies (a grouped tab drawn in a loose split too): only ids that are still panes; the home pane is never one.
    const linked=Array.isArray(raw.linked)?[...new Set<string>(raw.linked.filter((id:unknown):id is string=>typeof id==='string'&&split.tabIds.includes(id)))]:[];
    const own=split.tabIds.filter(id=>!linked.includes(id)),home=split.tabIds.includes(raw.home)&&!linked.includes(raw.home)?raw.home:own[0]??split.tabIds[0];
    groups.push({...split,groupId:raw.id,id:raw.id,collapsed:raw.collapsed===true,...(split.tabIds.includes(raw.lastActiveTabId)?{lastActiveTabId:raw.lastActiveTabId}:{}),...(typeof raw.name==='string'&&raw.name.trim()?{name:raw.name.trim().slice(0,SPLIT_NAME_MAX)}:{}),...(linked.length&&own.length?{linked}:{}),home});
  }
  return groups;
}

export const SPLIT_NAME_MAX=60;

/** Forget a saved split: its members stay exactly where they are in the strip, as ordinary tabs (their tab groups are untouched). */
export function dropSplitGroup(state:BrowserSnapshot,groupId:string):void {
  state.windowUi.splitGroups=(state.windowUi.splitGroups??[]).filter(group=>group.id!==groupId);
  if(state.windowUi.split?.groupId===groupId)state.windowUi.split=null;
}

/** Move a whole split into a tab group (or out of every group): its panes travel together, in tab order, next to each other,
 *  so the split then lives in that group (docs/launch/SPLIT_IN_GROUPS.md). `to`/`position` place the block beside a tab. */
function moveSplit(state:BrowserSnapshot,action:Extract<BrowserAction,{type:'split.move'}>):void {
  const split=state.windowUi.splitGroups?.find(group=>group.id===action.groupId);
  if(!split)return;
  const target=action.tabGroupId===null?null:state.tabGroups.find(group=>group.id===action.tabGroupId);
  if(target===undefined)return;
  const {to,position}=outsideSplit(state,split,action.to,action.position??'before');
  let previous:string|undefined;
  // A linked copy stays in its own group: moving the split moves only the panes whose home is the split.
  for(const member of state.tabs.filter(tab=>split.tabIds.includes(tab.id)&&!split.linked?.includes(tab.id))){
    const place=previous?{to:previous,position:'after' as const}:to?{to,position}:{};
    applyTabGroupAction(state,{type:'tab.drop',from:member.id,...place,groupId:target?.id??null});
    if(state.tabs.some(tab=>tab.id===member.id&&!tab.pinned))previous=member.id;
  }
}

/** A drop aimed at one of the split's own panes lands outside the split: beside its nearest other neighbour in tab order. */
export function outsideSplit(state:Pick<BrowserSnapshot,'tabs'>,split:Pick<SplitGroup,'tabIds'|'linked'>,to:string|undefined,position:'before'|'after'){
  // A linked copy sits in its own group, outside the split's place in the list: a drop on it is an ordinary drop.
  const own=split.tabIds.filter(id=>!split.linked?.includes(id));
  if(!to||!own.includes(to))return {to,position};
  const at=state.tabs.findIndex(tab=>tab.id===to),next=state.tabs.slice(at+1).find(tab=>!own.includes(tab.id)),prior=state.tabs.slice(0,at).reverse().find(tab=>!own.includes(tab.id));
  return next?{to:next.id,position:'before' as const}:prior?{to:prior.id,position:'after' as const}:{to:undefined,position};
}

/** One tab leaves its saved split (Remove from split view, a drag out of the card, a move of that tab alone). The split shrinks
 *  and re-tiles; one pane left ends it. The home pane leaving hands the home to the next pane in pane order. If the split is on
 *  screen it stays on screen without the tab, unless that tab is the current one: then the tab shows by itself. */
export function leaveSplit(state:BrowserSnapshot,splitId:string,tabId:string):void {
  const split=state.windowUi.splitGroups?.find(group=>group.id===splitId);
  if(!split||!split.tabIds.includes(tabId))return;
  const at=split.tabIds.indexOf(tabId),rest=split.tabIds.filter(id=>id!==tabId);
  if(rest.length<2){dropSplitGroup(state,split.id);return;}
  // The home pane is always one of the split's own panes, never a linked copy (its place is the group row).
  const linked=(split.linked??[]).filter(id=>rest.includes(id)),own=rest.filter(id=>!linked.includes(id));
  if(split.home===tabId)split.home=(own.length?own:rest)[Math.min(at,(own.length?own:rest).length-1)];
  if(linked.length&&own.length)split.linked=linked;else delete split.linked;
  if(split.lastActiveTabId===tabId)delete split.lastActiveTabId;
  split.tabIds=rest;split.layout=defaultLayout(rest.length)!;split.cols=[];split.rows=[];delete split.colRows;
  if(state.windowUi.split?.groupId===split.id)state.windowUi.split=state.activeTabId===tabId?null:normalizeSplit(split,state.tabs.map(tab=>tab.id),state.activeTabId);
}

const groupless=(tab:TabSession)=>!!tab.privacy&&tab.privacy!=='secured';
const groupIdOf=(state:Pick<BrowserSnapshot,'tabGroups'>,tab:TabSession|undefined)=>tab&&!tab.pinned?groupForTab(state,tab)?.id??null:null;

/** A tab dropped on a split outside every group while it is in a tab group becomes a linked copy (founder, 28 Oct): the same
 *  tab stays in its group and is also a pane of the split. A link holds while the tab is in a group other than the split's
 *  home group and the split has a pane of its own; otherwise (Remove from group, an ungrouped or closed group, a pin, the
 *  split moved into that very group, the last own pane left) it is an ordinary pane again and the usual rules apply. */
function mendLinks(state:BrowserSnapshot,split:SplitGroup):void {
  if(!split.linked?.length)return;
  const homeTab=state.tabs.find(tab=>tab.id===split.home),homeGroup=homeTab&&!split.linked.includes(homeTab.id)?groupIdOf(state,homeTab):null;
  const linked=split.linked.filter(id=>{const tab=state.tabs.find(item=>item.id===id),group=tab&&!groupless(tab)?groupIdOf(state,tab):null;return !!group&&group!==homeGroup&&split.tabIds.includes(id);});
  const own=split.tabIds.filter(id=>!linked.includes(id));
  if(linked.length&&own.length)split.linked=linked;else delete split.linked;
  if(split.home&&split.linked?.includes(split.home))split.home=own[0];
}

/** Tabs follow where their split lives (coordinator decision on the founder's simplification, 28 Oct: no mirrors, no linked
 *  rows). Every pane shares one tab group, so the split card is the one place its panes show (Chrome's split view keeps the
 *  same rule: both tabs of a split share their group):
 *  - a pane given another group on its own in this action (a tab menu group item, a keyboard move) takes its split along: the
 *    other panes follow it, so a split is never torn apart by a group change. Only Remove from split view or a drag out of the
 *    card (split.separate) takes one tab out;
 *  - any other pane outside the home pane's group (it just joined, or a session saved before this rule) moves next to the
 *    split's panes, into that group, or out of every group when the split is loose.
 *  Pinned, private and Tor panes take no group; the card still lists them. Runs after every action and on restore. */
export function settleSplitHomes(state:BrowserSnapshot,previous?:BrowserSnapshot):void {
  for(const split of state.windowUi.splitGroups??[]){
    mendLinks(state,split);
    const panes=split.tabIds.flatMap(id=>state.tabs.find(tab=>tab.id===id)||[]).filter(tab=>!groupless(tab)&&!tab.pinned&&!split.linked?.includes(tab.id));
    if(new Set(panes.map(tab=>groupIdOf(state,tab))).size<2)continue;
    const before=previous?.windowUi.splitGroups?.find(group=>group.id===split.id);
    const moved=(tab:TabSession)=>!!previous&&!!before?.tabIds.includes(tab.id)&&groupIdOf(previous,previous.tabs.find(item=>item.id===tab.id))!==groupIdOf(state,tab);
    const movers=panes.filter(moved),home=state.tabs.find(tab=>tab.id===split.home);
    const lead=movers.length&&movers.length<panes.length?movers[0]:home&&panes.includes(home)?home:panes[0];
    const target=groupIdOf(state,lead);
    for(const tab of panes){
      if(groupIdOf(state,tab)===target)continue;
      const beside=state.tabs.filter(item=>item.id!==tab.id&&panes.includes(item)&&groupIdOf(state,item)===target).at(-1);
      applyTabGroupAction(state,{type:'tab.drop',from:tab.id,...(beside?{to:beside.id,position:'after' as const}:{}),groupId:target});
    }
  }
}

export function applySavedSplitAction(state:BrowserSnapshot,action:BrowserAction):boolean {
  if(action.type==='split.move'){moveSplit(state,action);return true;}
  if(action.type==='split.rejoin'){rejoinReopened(state,action);return true;}
  if(action.type==='split.separate'){
    const split=state.windowUi.splitGroups?.find(group=>group.tabIds.includes(action.tabId));
    if(!split)return true;
    // A linked copy only leaves the split: its tab stays exactly where it is in its group (× on the split row, a drag out of the card).
    if(split.linked?.includes(action.tabId)){leaveSplit(state,split.id,action.tabId);return true;}
    const {to,position}=outsideSplit(state,split,action.to,action.position??'before');
    leaveSplit(state,split.id,action.tabId);
    if(to||Object.hasOwn(action,'groupId'))applyTabGroupAction(state,{type:'tab.drop',from:action.tabId,...(to?{to,position}:{}),...(Object.hasOwn(action,'groupId')?{groupId:action.groupId??null}:{})});
    return true;
  }
  if(action.type==='split.unsplit'||action.type==='split.rename') {
    const group=state.windowUi.splitGroups?.find(group=>group.id===action.groupId);
    if(!group)return true;
    if(action.type==='split.unsplit'){dropSplitGroup(state,group.id);return true;}
    const name=action.name.trim().slice(0,SPLIT_NAME_MAX);
    if(name)group.name=name;else delete group.name;
    return true;
  }
  if(!['split.group.select','split.group.toggle','split.group.add'].includes(action.type))return false;
  if(action.type!=='split.group.select'&&action.type!=='split.group.toggle'&&action.type!=='split.group.add')return false;
  const group=state.windowUi.splitGroups?.find(group=>group.id===action.id);
  if(!group)return true;
  if(action.type==='split.group.toggle'){group.collapsed=!group.collapsed;return true;}
  if(action.type==='split.group.add') {
    const member=state.tabs.find(tab=>tab.id===action.tabId),owner=state.tabs.find(tab=>tab.id===group.tabIds[0]);
    if(!member||!owner||member.browserProfileId!==owner.browserProfileId)return true;
    const added=action.wholeGroup&&member.group?state.tabs.filter(tab=>tab.group===member.group&&tab.browserProfileId===owner.browserProfileId).map(tab=>tab.id):[action.tabId];
    // R3-79: dropped between two members it lands at that slot (a member dragged inside its own split just moves there).
    const rest=group.tabIds.filter(id=>!added.includes(id)),at=action.index===undefined?rest.length:Math.max(0,Math.min(rest.length,action.index));
    const tabIds=[...new Set([...rest.slice(0,at),...added,...rest.slice(at)])];
    if(tabIds.length>MAX_PANES){state.toast={id:Date.now(),text:en['runtime.splitNeedsTwo'],i18n:{id:'runtime.splitNeedsTwo'},tone:'info'};return true;}
    // A tab of a tab group dropped on a split outside every group is linked, not moved: it stays in its group and is also a pane here.
    const homeTab=state.tabs.find(tab=>tab.id===group.home)||owner,looseSplit=!!homeTab&&!groupIdOf(state,homeTab);
    const fresh=looseSplit?added.filter(id=>{const tab=state.tabs.find(item=>item.id===id);return !!tab&&!group.tabIds.includes(id)&&!groupless(tab)&&!tab.pinned&&!!groupIdOf(state,tab);}):[];
    if(fresh.length)group.linked=[...new Set([...(group.linked??[]),...fresh])];
    if(tabIds.length!==group.tabIds.length){group.tabIds=tabIds;group.layout=defaultLayout(group.tabIds.length)!;group.cols=[];group.rows=[];delete group.colRows;}
    else if(tabIds.some((id,i)=>id!==group.tabIds[i]))group.tabIds=tabIds;
  }
  state.activeTabId=group.tabIds.includes(state.activeTabId)?state.activeTabId:group.lastActiveTabId||group.tabIds[0];
  group.lastActiveTabId=state.activeTabId;
  state.windowUi.split=normalizeSplit(group,state.tabs.map(tab=>tab.id),state.activeTabId);
  state.settings.zoom=state.tabs.find(tab=>tab.id===state.activeTabId)?.zoom||100;
  return true;
}

/** Save an edited active split, without changing normal tab-group membership. */
export function rememberSplit(state:BrowserSnapshot,previous:BrowserSnapshot,action:BrowserAction):void {
  const groups=state.windowUi.splitGroups??[], before=previous.windowUi.split;
  if(action.type==='split.remove'&&!state.windowUi.split&&before?.groupId)
    state.windowUi.splitGroups=groups.filter(group=>group.id!==before.groupId);
  const split=state.windowUi.split;
  if(!split)return;
  let group=groups.find(group=>group.id===split.groupId);
  if(!group) {
    group=groups.find(group=>group.tabIds.length===split.tabIds.length&&group.tabIds.every(id=>split.tabIds.includes(id)));
    if(!group&&action.type.startsWith('split.')&&before?.groupId)group=groups.find(group=>group.id===before.groupId);
    // A new split's home is its first pane (the tab it was made from); it never moves when panes are added.
    if(!group){group={...split,id:`split-${crypto.randomUUID()}`,collapsed:false,home:split.tabIds[0]};groups.push(group);}
  }
  split.groupId=group.id;
  if(!split.colRows)delete group.colRows;
  Object.assign(group,{...split,...(split.tabIds.includes(state.activeTabId)?{lastActiveTabId:state.activeTabId}:{})});
  // One visible parent owns each tab. Joining another split moves only its split membership.
  for(const other of groups)if(other!==group)other.tabIds=other.tabIds.filter(id=>!split.tabIds.includes(id));
  state.windowUi.splitGroups=normalizeSplitGroups(groups,state.tabs);
}

/** A pane that is closing remembers its split (a copy of it, its slot, whether it was on screen) for Undo. Called with the state before the tab leaves. */
export function closedSplitOf(state:BrowserSnapshot,tabId:string):ClosedSplit|undefined {
  const split=state.windowUi.splitGroups?.find(group=>group.tabIds.includes(tabId));
  return split?{split:structuredClone(split),slot:split.tabIds.indexOf(tabId),shown:state.windowUi.split?.groupId===split.id}:undefined;
}

/** Undo of a closed split pane (the toast, Ctrl+Shift+T, a batch): the tab is back in the strip; this puts it back into its split at its slot,
 *  re-linked when it was a linked copy, with the split's old layout when the panes are the same again. A split that ended when this pane
 *  closed (two panes) is made again with the panes that are still open. A split that was on screen is on screen again. */
export function rejoinSplit(state:BrowserSnapshot,tabId:string,memory:ClosedSplit):void {
  const open=state.tabs.map(tab=>tab.id);if(!open.includes(tabId))return;
  const groups=state.windowUi.splitGroups??(state.windowUi.splitGroups=[]);
  const saved=groups.find(group=>group.id===memory.split.id);
  const original=memory.split;
  const retile=(group:SplitGroup)=>{
    if(group.tabIds.length===original.tabIds.length&&group.tabIds.every((id,at)=>id===original.tabIds[at])){group.layout=original.layout;group.cols=[...(original.cols??[])];group.rows=[...(original.rows??[])];if(original.colRows)group.colRows=structuredClone(original.colRows);else delete group.colRows;}
    else{group.layout=defaultLayout(group.tabIds.length)!;group.cols=[];group.rows=[];delete group.colRows;}
  };
  let group=saved;
  if(saved){
    if(saved.tabIds.includes(tabId)||saved.tabIds.length>=MAX_PANES)return;
    saved.tabIds.splice(Math.min(memory.slot,saved.tabIds.length),0,tabId);retile(saved);
  }else{
    const taken=new Set(groups.flatMap(item=>item.tabIds));
    const ids=original.tabIds.filter(id=>id===tabId||open.includes(id)&&!taken.has(id));
    if(ids.length<2)return;
    group={...structuredClone(original),tabIds:ids};group.collapsed=false;retile(group);groups.push(group);
  }
  if(!group)return;
  const linked=(original.linked??[]).filter(id=>group!.tabIds.includes(id));
  if(linked.length)group.linked=[...new Set([...(group.linked??[]),...linked])];
  if(!group.tabIds.includes(group.home??''))group.home=group.tabIds.find(id=>!group!.linked?.includes(id))??group.tabIds[0];
  if(memory.shown||state.windowUi.split?.groupId===group.id){
    const active=group.tabIds.includes(state.activeTabId)?state.activeTabId:tabId;
    state.windowUi.split=normalizeSplit(group,open,active);
    if(state.windowUi.split)state.windowUi.split.groupId=group.id;
  }
}

/** Rewind's "Recently closed" reopen (main process; the closed-tab log keeps addresses, not ids): the tab is back as a new tab, its split partners
 *  have been matched to the tabs that are open now. When those partners are exactly the panes of one saved split (the rest of the split it left), or
 *  are not in any split (the split ended with the close), the tab goes back into the split at its slot, through the same path as Undo
 *  (`rejoinSplit`): the saved layout when the panes are the same again, linked again when it was a linked copy. Partners that sit in other splits now
 *  are left alone. It does not take the split on screen (a reopen is a background action) unless that split already is. */
function rejoinReopened(state:BrowserSnapshot,action:Extract<BrowserAction,{type:'split.rejoin'}>):void {
  const open=new Set(state.tabs.map(tab=>tab.id)),groups=state.windowUi.splitGroups??[];
  const partners=[...new Set(action.partners)].filter(id=>id!==action.tabId&&open.has(id));
  if(!open.has(action.tabId)||!partners.length||groups.some(group=>group.tabIds.includes(action.tabId)))return;
  const saved=groups.find(group=>group.tabIds.length===partners.length&&partners.every(id=>group.tabIds.includes(id)));
  if(!saved&&partners.some(id=>groups.some(group=>group.tabIds.includes(id))))return;
  const slot=Math.max(0,Math.min(partners.length,Math.trunc(action.slot)||0)),tabIds=[...partners.slice(0,slot),action.tabId,...partners.slice(slot)];
  if(tabIds.length>MAX_PANES)return;
  const id=saved?.id??`split-${crypto.randomUUID()}`,linked=(action.linked??[]).filter(item=>tabIds.includes(item));
  const original:SplitGroup={...(saved?structuredClone(saved):{cols:[],rows:[],collapsed:false}),id,groupId:id,tabIds,layout:action.layout??defaultLayout(tabIds.length)!,...(linked.length?{linked}:{})};
  rejoinSplit(state,action.tabId,{split:original,slot,shown:false});
}

/** Public persistence must not preserve even partial metadata about a split containing a private/Tor member. */
export function publicSplitUi(ui:WindowUi,tabs:readonly Pick<TabSession,'id'>[]):WindowUi {
  const open=new Set(tabs.map(tab=>tab.id));
  const groups=normalizeSplitGroups((ui.splitGroups||[]).filter(group=>group.tabIds.every(id=>open.has(id))),tabs);
  const split=ui.split?.tabIds.every(id=>open.has(id))?normalizeSplit(ui.split,[...open],ui.split.tabIds[0]):null;
  if(split?.groupId&&!groups.some(group=>group.id===split.groupId))delete split.groupId;
  return {...ui,zoomTargetTabId:ui.zoomTargetTabId&&open.has(ui.zoomTargetTabId)?ui.zoomTargetTabId:undefined,split,splitGroups:groups};
}
