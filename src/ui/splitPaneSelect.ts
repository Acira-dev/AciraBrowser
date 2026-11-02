import { soloSplit } from '../runtime/splitPlacement';
import type { SplitGroup } from '../runtime/splitLayout';
import type { BrowserAction,BrowserSnapshot } from '../runtime/types';

/** Clicking a tab row or chip (sidebar, strip, compact strip). A pane of a split shows its split, focused on that pane (Chrome,
 *  Arc and Zen: a click on a split's tab shows the split); it also brings back a split whose pane was opened alone. */
export function selectStripTab(state:Pick<BrowserSnapshot,'activeTabId'|'windowUi'>,dispatch:(action:BrowserAction)=>void,tabId:string,split?:Pick<SplitGroup,'id'>):void {
 if(!split){dispatch({type:'tab.select',id:tabId});return;}
 const shown=state.windowUi.split?.groupId===split.id;
 if(!shown)dispatch({type:'split.group.select',id:split.id});
 if(!shown||state.activeTabId!==tabId)dispatch({type:'tab.select',id:tabId});
}

/** The pane is on screen by itself while its split stays saved (docs/launch/SPLIT_IN_GROUPS.md, "Open alone"). */
export const paneIsAlone=(state:Pick<BrowserSnapshot,'activeTabId'|'windowUi'>,tabId:string,split:Pick<SplitGroup,'id'>)=>state.activeTabId===tabId&&soloSplit(state)?.id===split.id;

/** Open alone ⇄ Show split view (the pane row's button, Shift+Enter, the tab menu). */
export function toggleSolo(state:Pick<BrowserSnapshot,'activeTabId'|'windowUi'>,dispatch:(action:BrowserAction)=>void,tabId:string,split:Pick<SplitGroup,'id'>):void {
 if(paneIsAlone(state,tabId,split))dispatch({type:'split.group.select',id:split.id});
 else dispatch({type:'tab.select',id:tabId,individual:true});
}

/** A pane chip or row dragged out of its split (founder, 28 Oct): a drop that would place it among tabs takes it out of the split
 *  there instead (split.separate, in the group of wherever it lands); a drop on its own split stays a pane reorder. */
export function paneDropAction(drop:BrowserAction|null,tabId:string,split?:Pick<SplitGroup,'id'>,linked=false):BrowserAction|null {
 if(!split||drop?.type!=='tab.drop')return null;
 // A linked copy (a group tab also drawn in a loose split) only leaves the split; its tab stays where it is in its group.
 if(linked)return {type:'split.separate',tabId};
 return {type:'split.separate',tabId,...(drop.to?{to:drop.to,position:drop.position??'before'}:{}),...(Object.hasOwn(drop,'groupId')?{groupId:drop.groupId??null}:{})};
}
