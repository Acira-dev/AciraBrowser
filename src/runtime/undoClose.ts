import enMessages from '../i18n/en.json';import { format as formatMessage } from '../i18n/format';
import type { BrowserSnapshot,ClosedSplit,ClosedTabSession,HistoryVisit,TabSession } from './types';
import { rejoinSplit } from './splitGroups';import { HISTORY_LIMIT } from './sessionState';
/** Closes that land this close together (a group, "close others", a quick run of Ctrl+W) form one undoable batch. */
export const UNDO_BATCH_MS=1500;
const label=(count:number,group:string):{id:string;params?:Record<string,string|number>}=>group?{id:'runtime.groupClosed',params:{name:group}}:count===1?{id:'runtime.tabClosed'}:{id:'runtime.tabsClosed',params:{count}};
const words=(label:{id:string;params?:Record<string,string|number>})=>formatMessage('en',(enMessages as Record<string,string>)[label.id],label.params);
/** Called by the reducer right after `tab` moved into closedTabs. Raises (or extends) the "Tab closed · Undo" toast. */
export function noteClosedTab(s:BrowserSnapshot,tab:TabSession,wasActive:boolean,now=Date.now()):void {
 const closed=s.closedTabs[0] as ClosedTabSession|undefined;if(!closed||closed.id!==tab.id)return;
 const previous=s.toast?.action?.command,open=previous?.type==='tab.restore.batch'&&now-(s.toast?.at??0)<UNDO_BATCH_MS&&s.closedTabs.some(t=>t.closedBatch===previous.id&&(t.workspaceId??'')===(tab.workspaceId??''));// one batch never spans two workspaces (R3-57)
 const batch=open?previous.id:`close-${now}-${tab.id}`;closed.closedBatch=batch;if(wasActive)closed.closedActive=true;
 const members=s.closedTabs.filter(t=>t.closedBatch===batch),groups=new Set(members.map(t=>t.group));
 const group=groups.size===1&&tab.group&&members.length>1&&!s.tabs.some(t=>t.group===tab.group&&t.browserProfileId===tab.browserProfileId)?tab.group:'';
 const said=label(members.length,group);s.toast={id:now,at:now,text:words(said),i18n:said,action:{label:'Undo',labelId:'toast.undo',command:{type:'tab.restore.batch',id:batch}}};
}
/** Main raises this in a surviving window after another window of the same profile closed (id = the closed window). */
export function noteClosedWindow(s:BrowserSnapshot,windowId:string,count:number,now=Date.now()):void {
 const said=count>1?{id:'runtime.windowWithTabsClosed',params:{count}}:{id:'runtime.windowClosed'};s.toast={id:now,at:now,text:words(said),i18n:said,action:{label:'Undo',labelId:'toast.undo',command:{type:'window.reopen',id:windowId}}};
}
/** The Undo click itself: the toast goes away here; main reopens the window from its saved arrangement. */
export function takeClosedWindowToast(s:BrowserSnapshot,windowId:string):boolean {
 const command=s.toast?.action?.command;if(command?.type!=='window.reopen'||command.id!==windowId)return false;
 s.toast=null;return true;
}
/** Reopens every tab of one close batch at its old position, in its old group, with its old history. Most recent close first. */
export function restoreClosedBatch(s:BrowserSnapshot,batch:string,{activate=false}:{activate?:boolean}={}):boolean {
 const members=s.closedTabs.filter(t=>t.closedBatch===batch);if(!members.length)return false;
 s.closedTabs=s.closedTabs.filter(t=>t.closedBatch!==batch);let active='';
 for(const closed of members){const {closedIndex,closedBatch:_b,closedActive,closedLeftId:_l,closedRightId:_r,closedSplit:_s,closedRev:_v,risk:_risk,...tab}=closed;s.tabs.splice(Math.min(closedIndex??s.tabs.length,s.tabs.length),0,tab);if(closedActive)active=tab.id;}
 if(activate&&!active)active=members.at(-1)?.id??'';
 if(active)s.activeTabId=active;
 // A closed split pane goes back into its split at its slot (the most recent close first, so the panes come back in the order that rebuilds it).
 for(const closed of members)if(closed.closedSplit)rejoinSplit(s,closed.id,closed.closedSplit);
 if(s.toast?.action?.command.type==='tab.restore.batch'&&s.toast.action.command.id===batch)s.toast=null;
 return true;
}
/** Closed private tabs, Tor tabs and tabs of a private window are remembered here and nowhere else: in memory, in this window's state only, so Ctrl+Shift+T can reopen them
 *  as the same kind. Never in closedTabs (which is saved, listed in Rewind and read by the extension, import and cleanup code), never persisted, never given an Undo toast. A secured
 *  workspace's tabs are not kept: that workspace owns its sealed session. */
export const CLOSED_PRIVATE_LIMIT=50;
export function rememberClosedPrivate(s:BrowserSnapshot,tab:TabSession,index:number,memory?:ClosedSplit):void {
 if(tab.privacy==='secured')return;
 const kept=s.closedPrivateTabs??(s.closedPrivateTabs=[]);
 kept.unshift({...tab,closedIndex:index,closedRev:s.revision,...(memory?{closedSplit:memory}:{})});
 if(kept.length>CLOSED_PRIVATE_LIMIT)kept.length=CLOSED_PRIVATE_LIMIT;
}
/** A page deleted from history can't come back through Ctrl+Shift+T either: closed tabs (saved and in-memory private ones) of that profile still showing a deleted address
 *  are dropped, and their Undo toast follows. `wholeProfile` (all history of a profile cleared) drops every closed tab of it. `before` is the history as it was. */
export function forgetDeletedPages(s:BrowserSnapshot,before:readonly HistoryVisit[],wholeProfile?:string):boolean {
 if(!s.closedTabs.length&&!s.closedPrivateTabs?.length)return false;
 // A full history drops its oldest visits on its own (HISTORY_LIMIT): those were never deleted, so they forget nothing.
 const kept=new Set(s.browsingHistory.map(v=>v.id)),gone=new Set<string>(),trimmedBefore=s.browsingHistory.length>=HISTORY_LIMIT?s.browsingHistory.at(-1)?.time:undefined;
 for(const v of before)if(!kept.has(v.id)&&!(trimmedBefore!==undefined&&v.time<=trimmedBefore))gone.add(`${v.browserProfileId??s.activeBrowserProfileId}\n${v.url}`);
 if(!gone.size&&!wholeProfile)return false;
 const deleted=(t:ClosedTabSession)=>t.browserProfileId===wholeProfile||gone.has(`${t.browserProfileId}\n${t.url}`);
 const batches=new Set(s.closedTabs.filter(deleted).map(t=>t.closedBatch)),count=s.closedTabs.length+(s.closedPrivateTabs?.length??0);
 s.closedTabs=s.closedTabs.filter(t=>!deleted(t));
 if(s.closedPrivateTabs){s.closedPrivateTabs=s.closedPrivateTabs.filter(t=>!deleted(t));if(!s.closedPrivateTabs.length)delete s.closedPrivateTabs;}
 const command=s.toast?.action?.command;
 if(s.toast&&command?.type==='tab.restore.batch'&&batches.has(command.id)){const left=s.closedTabs.filter(t=>t.closedBatch===command.id).length;if(!left)s.toast=null;else{const said=label(left,'');s.toast={...s.toast,text:words(said),i18n:said};}}
 return s.closedTabs.length+(s.closedPrivateTabs?.length??0)!==count;
}
/** Reopen closed tab (Ctrl+Shift+T): exactly ONE tab, the newest close of any kind in this window, at its old position (and back in its split slot / group). A private or Tor tab comes back
 *  as the same kind. `inView` limits private tabs to the open workspace when the window has several. A batch comes back whole only from its Undo toast or Rewind (restoreClosedBatch). */
export function reopenLastClosedTab(s:BrowserSnapshot,inView?:(tab:ClosedTabSession)=>boolean):boolean {
 const profiles=new Set(s.browserProfiles.map(p=>p.id)),open=new Set(s.tabs.map(t=>t.id));
 if(s.closedPrivateTabs){s.closedPrivateTabs=s.closedPrivateTabs.filter(t=>profiles.has(t.browserProfileId)&&!open.has(t.id));if(!s.closedPrivateTabs.length)delete s.closedPrivateTabs;}
 // The profile on screen's own: with profiles as spaces a window's closed tabs are every space's, and Reopen closed tab in one space never
 // reopens another's (in a window of one profile they are all its own).
 const own=(t:ClosedTabSession)=>t.browserProfileId===s.activeBrowserProfileId,normalAt=s.closedTabs.findIndex(own);
 const normal=normalAt>=0?s.closedTabs[normalAt] as ClosedTabSession:undefined,hidden=s.closedPrivateTabs?.find(t=>own(t)&&(!inView||inView(t)));
 const fromPrivate=!!hidden&&(!normal||(hidden.closedRev??0)>(normal.closedRev??0)),closed=fromPrivate?hidden:normal;
 if(!closed)return false;
 if(fromPrivate){s.closedPrivateTabs=s.closedPrivateTabs!.filter(t=>t!==hidden);if(!s.closedPrivateTabs.length)delete s.closedPrivateTabs;}else s.closedTabs.splice(normalAt,1);
 // A page caution belongs to the page that was showing: the reopened tab is checked afresh.
 const {closedIndex,closedBatch,closedSplit,closedActive:_a,closedLeftId:_l,closedRightId:_r,closedRev:_v,risk:_risk,...tab}=closed;
 s.tabs.splice(Math.min(closedIndex??s.tabs.length,s.tabs.length),0,tab);s.activeTabId=tab.id;
 if(closedSplit)rejoinSplit(s,tab.id,closedSplit);
 // The batch's Undo toast now offers what is still closed (its count follows), and goes when nothing is.
 const command=s.toast?.action?.command;
 if(closedBatch&&s.toast&&command?.type==='tab.restore.batch'&&command.id===closedBatch){const left=s.closedTabs.filter(t=>t.closedBatch===closedBatch).length;if(!left)s.toast=null;else{const said=label(left,'');s.toast={...s.toast,text:words(said),i18n:said};}}
 return true;
}
