'use strict';
const { t } = require('../browser-services/tx.cjs');
// Split view from the keyboard and from Alt+click, on the split actions of src/runtime/core.ts (layouts: src/runtime/splitLayout.ts).
// The left pane is always the current tab (same rule as dragging a tab into split, src/ui/splitDrop.ts).

/** Most recently used tab order per window, kept from committed actions (ids only, bounded). */
function createTabMru({limit=200}={}){
 const windows=new Map();
 return {
  note(windowId,previous,next){
   if(!next?.activeTabId||previous?.activeTabId===next.activeTabId&&previous?.tabs?.length===next.tabs?.length&&windows.has(windowId))return;
   const live=new Set((next.tabs||[]).map(t=>t.id)),list=(windows.get(windowId)||[]).filter(id=>id!==next.activeTabId&&live.has(id));
   list.unshift(next.activeTabId);windows.set(windowId,list.slice(0,limit));
  },
  order:windowId=>[...(windows.get(windowId)||[])],
  forget:windowId=>windows.delete(windowId),
 };
}
/** The other tab for a keyboard split: most recently used, else the neighbour on the right, else on the left. */
function partnerTab(state,recent=[]){
 const active=state.tabs.find(t=>t.id===state.activeTabId);if(!active)return null;
 const eligible=t=>t.id!==active.id&&t.browserProfileId===active.browserProfileId;
 for(const id of recent){const tab=state.tabs.find(t=>t.id===id);if(tab&&eligible(tab))return tab.id;}
 const index=state.tabs.indexOf(active);
 return (state.tabs.slice(index+1).find(eligible)||state.tabs.slice(0,index).reverse().find(eligible))?.id||null;
}
/** Mod+Shift+S: opens split with the current tab and the most recent other tab; closes it when already split. */
function toggleSplit(state,dispatch,recent){
 if(state.windowUi?.split){dispatch({type:'split.close'});return {split:false};}
 const other=partnerTab(state,recent);
 if(!other){dispatch({type:'toast',text:t('split.main.openAnother'),tone:'info'});return {split:false,reason:'no-partner'};}
 dispatch({type:'split.open',tabIds:[state.activeTabId,other]});return {split:true,tabIds:[state.activeTabId,other]};
}
/** Alt+click on a link: the link opens in a new tab beside its page and the two show side by side. When this page is already in a
 *  split with room (up to 4 panes), the link joins it as another pane instead. */
function splitLink(sourceId,url,state,dispatch){
 if(typeof url!=='string'||url.length>4096)return null;
 let parsed;try{parsed=new URL(url);}catch{return null;}
 if(!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password)return null;
 const source=state().tabs.find(t=>t.id===sourceId);if(!source)return null;
 const before=new Set(state().tabs.map(t=>t.id));
 dispatch({type:'tab.new',url:parsed.href,background:true,browserProfileId:source.browserProfileId,afterId:source.id,...(source.privacy?{privacy:source.privacy}:{})});
 const fresh=state().tabs.find(t=>!before.has(t.id));if(!fresh)return null;
 if(state().activeTabId!==source.id)dispatch({type:'tab.select',id:source.id});
 const split=state().windowUi?.split;
 if(split?.tabIds.includes(source.id)&&split.tabIds.length<4)dispatch({type:'split.add',tabId:fresh.id});else dispatch({type:'split.open',tabIds:[source.id,fresh.id]});
 return fresh.id;
}
/** Panes per layout (mirrors SPLIT_LAYOUTS in src/runtime/splitLayout.ts; tests keep the two in step). */
const LAYOUT_PANES={columns:2,rows:2,'three-columns':3,'three-rows':3,'top-two-bottom-one':3,'top-one-bottom-two':3,'left-one-right-two':3,'left-two-right-one':3,grid:4,'four-columns':4,'four-rows':4,'left-one-right-three':4,'left-three-right-one':4,'top-one-bottom-three':4,'top-three-bottom-one':4,'three-columns-split-left':4,'three-columns-split-middle':4,'three-columns-split-right':4,'three-rows-split-top':4,'three-rows-split-middle':4,'three-rows-split-bottom':4,'left-two-right-one-over-one':4,'left-one-right-two-over-one':4,'one-over-left-two-right-one':4,'one-over-left-one-right-two':4,'left-one-right-two-one':4,'left-one-right-one-two':4,'right-one-left-two-one':4,'right-one-left-one-two':4};
/** Up to `count` other tabs for new panes: most recently used first, then the neighbours; same profile, never the excluded ones. */
function partnersFor(state,recent,exclude,count){
 const active=state.tabs.find(t=>t.id===state.activeTabId),out=[];if(!active||count<=0)return out;
 const ok=t=>t&&!exclude.has(t.id)&&!out.includes(t.id)&&t.browserProfileId===active.browserProfileId;
 for(const id of recent){if(out.length>=count)break;const tab=state.tabs.find(t=>t.id===id);if(ok(tab))out.push(tab.id);}
 const index=state.tabs.indexOf(active);
 for(const tab of [...state.tabs.slice(index+1),...state.tabs.slice(0,index).reverse()]){if(out.length>=count)break;if(ok(tab))out.push(tab.id);}
 return out;
}
/** A layout shortcut: opens the split in that layout (current tab first, then recent tabs), or reshapes the one that's open —
 *  adding recent tabs as panes, or letting the last ones go (never the current tab), until the layout's pane count fits. */
function useLayout(state,dispatch,recent,layout){
 const panes=LAYOUT_PANES[layout];if(!panes)return {ok:false,reason:'unknown-layout'};
 const split=state.windowUi?.split,current=split?[...split.tabIds]:[state.activeTabId];
 if(current.length<panes){
  const more=partnersFor(state,recent,new Set(current),panes-current.length);
  if(current.length+more.length<panes){const need=panes-current.length-more.length;dispatch({type:'toast',text:t('split.main.openMore',{need}),tone:'info'});return {ok:false,reason:'not-enough-tabs'};}
  if(!split){dispatch({type:'split.open',tabIds:[...current,...more],layout});return {ok:true,tabIds:[...current,...more]};}
  for(const [i,id] of more.entries())dispatch({type:'split.add',tabId:id,...(i===more.length-1?{layout}:{})});
  return {ok:true};
 }
 for(let i=current.length-1;i>=0&&current.length>panes;i--)if(current[i]!==state.activeTabId){dispatch({type:'split.remove',tabId:current[i]});current.splice(i,1);}
 dispatch({type:'split.layout',layout});return {ok:true};
}
/** Pane shortcuts: focus the next or previous pane (reading order, wrapping), swap the current pane with the next, close the current
 *  pane (its tab stays open), or leave split view. All of them do nothing outside a split. */
function paneCommand(state,dispatch,command){
 const split=state.windowUi?.split;if(!split)return {ok:false,reason:'no-split'};
 const ids=split.tabIds,at=Math.max(0,ids.indexOf(state.activeTabId)),step=command.direction===-1?-1:1,next=ids[(at+step+ids.length)%ids.length];
 if(command.action==='split-focus'){dispatch({type:'tab.select',id:next});return {ok:true,tabId:next};}
 if(command.action==='split-swap'){dispatch({type:'split.swap',a:ids[at],b:ids[(at+1)%ids.length]});return {ok:true};}
 if(command.action==='split-close-pane'){dispatch({type:'split.remove',tabId:ids[at]});return {ok:true};}
 if(command.action==='split-exit'){dispatch({type:'split.close'});return {ok:true};}
 return {ok:false,reason:'unknown'};
}
/** One entry for main's shortcut switch. */
function runSplitCommand(command,state,dispatch,recent=[]){return command?.action==='split-layout'?useLayout(state,dispatch,recent,command.layout):paneCommand(state,dispatch,command||{});}
module.exports={createTabMru,partnerTab,toggleSplit,splitLink,partnersFor,useLayout,paneCommand,runSplitCommand,LAYOUT_PANES};
/** One MRU for the process: windows are told apart by id. */
module.exports.mru=createTabMru();
