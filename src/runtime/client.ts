import { useEffect,useRef,useState } from 'react';
import { flushSync } from 'react-dom';
import { createInitialState,persistedSnapshot,reduceBrowser,restoreSnapshot,viewForFocus } from './core';
import { scopeToWorkspace,workspaceHasTabs } from './workspaces';
import { startWorkspaceTransition,workspaceSwitched } from '../ui/workspaceMotion';
import type { BrowserAction,BrowserEvent,BrowserLayout,BrowserRuntime,BrowserSnapshot } from './types';
import { undoImportBatches } from '../ui/importedFavorites';
import { restoreSidebarApp } from '../ui/sidebarApps';
import { appearanceChanged, startModeTransition } from '../ui/sharedMotion';
import { opensOrClosesSidebar,sidebarLayoutChanged } from '../ui/layoutMode';
import { chromeLayoutChanged } from '../ui/chromeLayout';
import { currentLocale,translateText } from '../i18n';
declare global{interface Window{acira?:BrowserRuntime;__acira?:{getState():BrowserSnapshot;dispatch(action:BrowserAction):void}}}
const native=window.acira;
let state=createInitialState();
if(!native)try{const saved=localStorage.getItem('acira-browser-v1');if(saved)state=restoreSnapshot(JSON.parse(saved));}catch{}
const listeners=new Set<(s:BrowserSnapshot)=>void>(),events=new Set<(e:BrowserEvent)=>void>(),layouts=new Set<(l:BrowserLayout)=>void>();
let layout:BrowserLayout={views:[],visible:true};
const preview:BrowserRuntime={
 async service(){throw new Error("Open Acira desktop to use browser services.");},
 async getSnapshot(){return state;},
 async dispatch(action){state=reduceBrowser(state,action);localStorage.setItem('acira-browser-v1',JSON.stringify(persistedSnapshot(state)));listeners.forEach(fn=>fn(state));},
 subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},
 async browserCommand(command){if(command.type==='ui')events.forEach(fn=>fn({...command,type:'ui'}));},
 async extensions(request){return {profileId:request.profileId,supported:false,supportNote:'Open Acira desktop to manage extensions.',extensions:[]};},
 setBrowserLayout(next){layout=next;layouts.forEach(fn=>fn(next));},async getBrowserLayout(){return layout;},
 subscribeBrowser(fn){events.add(fn);return()=>events.delete(fn);},subscribeLayout(fn){layouts.add(fn);return()=>layouts.delete(fn);},
 closeOverlay(){layout={...layout,overlay:undefined};layouts.forEach(fn=>fn(layout));},
 openWindow(){},windowControl(){},
 exportData(name,content){const href=URL.createObjectURL(new Blob([content],{type:'application/json'})),a=document.createElement('a');a.href=href;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(href),1000);}
};
export const runtime:BrowserRuntime=native||preview;
/** A mode switch's view transition captures the old frame one frame after it starts. Until its update has run, newer
 * snapshots wait, or the "old" picture would already show the new state and the switch would not move (G). */
let modeUpdatePending=false;
// A view transition runs its update on the next frame it renders. A window that renders none (covered, throttled, a stalled
// GPU) must still switch, and must not hold later snapshots: the update also runs after 150ms, once either way (G, Round 2).
const MODE_UPDATE_MS=150;
const modeSwitch=(update:()=>void,kind?:'appearance'|'layout'|'workspace')=>{let done=false;const run=()=>{if(done)return;done=true;modeUpdatePending=false;update();};modeUpdatePending=true;if(kind==='workspace')startWorkspaceTransition(run);else startModeTransition(run,kind);if(!done)setTimeout(run,MODE_UPDATE_MS);};
const OPTIMISTIC=new Set<string>(['tab.select','tab.new','tab.close','workspace.select','split.resize']);
/** The tab main most recently said is active. A snapshot is painted a frame later (a window that draws no frames, up to 100 ms), so a
 * key that arrives in between (Ctrl+T, then Ctrl+L and typing at once) is meant for this tab while the chrome still shows the last one. */
let newestActiveTab:string|null=null;
export const newestActiveTabId=():string|null=>newestActiveTab;
// Main leaves the history list out of a broadcast when it has not changed since the last one it sent this window (20000 visits cost ~20 ms each way).
let knownHistory:BrowserSnapshot['browsingHistory']|undefined=native?.initialSnapshot?.browsingHistory;
/** Acira's own pages are stored with English titles (history and search stay stable); the interface shows them in the current language. */
const ownTitle=(tab:{url:string;title:string})=>tab.url.startsWith('acira://')?translateText(tab.title):tab.title;
const localizeTitles=(next:BrowserSnapshot):BrowserSnapshot=>{if(!next||!Array.isArray(next.tabs)||currentLocale()==='en')return next;let changed=false;const tabs=next.tabs.map(tab=>{const title=ownTitle(tab);if(title===tab.title)return tab;changed=true;return {...tab,title};});return changed?{...next,tabs}:next;};
const complete=(next:BrowserSnapshot):BrowserSnapshot=>{const patched=next as BrowserSnapshot&{__omitHistory?:boolean};if(patched&&patched.__omitHistory){delete patched.__omitHistory;if(knownHistory)patched.browsingHistory=knownHistory;}else if(next&&Array.isArray(next.browsingHistory))knownHistory=next.browsingHistory;return localizeTitles(next);};
export function useBrowser(){
 const [snapshot,setState]=useState(()=>localizeTitles(native?.initialSnapshot||state));
 // Optimistic actions: the interface applies the same reducer at once (the first frame already shows the new tab or the chosen one) and main's
 // authoritative snapshot, which carries a higher revision, replaces it. Snapshots older than the pending actions are ignored; if main never
 // answers (it refused the action) the interface re-reads the state after a moment.
 const latest=useRef(snapshot),optimistic=useRef<{base:number;count:number;timer:ReturnType<typeof setTimeout>}|null>(null);latest.current=snapshot;
 useEffect(()=>{let shown:BrowserSnapshot|null=null;const apply=(next:BrowserSnapshot)=>{if(!next)return;const wait=optimistic.current;if(wait){if(next.revision<wait.base+wait.count)return;clearTimeout(wait.timer);optimistic.current=null;}if(!shown||next.revision>=shown.revision||wait)shown=next;setState(previous=>next.revision>=previous.revision||wait?next:previous);};
  // Main broadcasts a full snapshot per change, often several per frame while pages load: render the newest once per
  // frame, before that frame paints. The overlay layer has no frames while hidden, so it applies each one at once.
  const batch=!location.search.includes('view=overlay');let pending:BrowserSnapshot|null=null,frame=0,timer:ReturnType<typeof setTimeout>|undefined;
  // A snapshot that changes the theme, finish, tint or glass crossfades in as one frame (A's mode transition).
  const flush=()=>{cancelAnimationFrame(frame);clearTimeout(timer);frame=0;if(modeUpdatePending&&pending){frame=requestAnimationFrame(flush);timer=setTimeout(flush,MODE_UPDATE_MS);return;}const next=pending;pending=null;if(!next)return;if(appearanceChanged(shown,next))modeSwitch(()=>flushSync(()=>apply(next)));else if(workspaceSwitched(shown,next))modeSwitch(()=>flushSync(()=>apply(next)),'workspace');else if(sidebarLayoutChanged(shown,next)||chromeLayoutChanged(shown,next))modeSwitch(()=>flushSync(()=>apply(next)),'layout');else flushSync(()=>apply(next));};
  const receive=(raw:BrowserSnapshot)=>{if(!raw)return;const next=complete(raw);if(batch)newestActiveTab=next.activeTabId??null;if(!batch)return apply(next);
   // Native Cmd/Ctrl+T and tab shortcuts precede the next keystroke. Commit their
   // foreground owner now, like optimistic pointer actions, so input cannot land
   // on the old page/body while a requestAnimationFrame batch is waiting.
   const previous=latest.current;
   if(next.revision>=previous.revision&&(!pending||next.revision>=pending.revision)&&next.activeTabId!==previous.activeTabId&&next.activeBrowserProfileId===previous.activeBrowserProfileId&&!appearanceChanged(previous,next)&&!workspaceSwitched(previous,next)){
    cancelAnimationFrame(frame);clearTimeout(timer);frame=0;pending=null;flushSync(()=>apply(next));return;
   }
   if(!pending||next.revision>=pending.revision)pending=next;if(!frame){frame=requestAnimationFrame(flush);timer=setTimeout(flush,100);}};
  const unsubscribe=runtime.subscribe(receive);void runtime.getSnapshot().then(full=>apply(complete(full)));return()=>{unsubscribe();cancelAnimationFrame(frame);clearTimeout(timer);};},[]);
 const dispatch=(action:BrowserAction)=>{if(action.type==='import.undo'){void undoImportBatches(action.batchIds,batchId=>runtime.service({type:'imports.undo',batchId})).then(()=>runtime.dispatch(action.profileIds?.length?action:{type:'toast',text:'Import undone'})).catch(error=>runtime.dispatch({type:'toast',text:String(error?.message||error).slice(0,200),tone:'error'}));return;}
  // Undo of a removed favorite: it comes back with the live tab it had handed to the tab list, if that tab is still open and unclaimed.
  if(action.type==='favorite.restore'){restoreSidebarApp(action.token,(appId,tabIds)=>{const tab=latest.current.tabs.find(tab=>tabIds.includes(tab.id)&&!tab.favoriteId);if(tab)dispatch({type:'tab.favorite',id:tab.id,favoriteId:appId});});return;}
  // Opening or closing the sidebar shows on the input frame (G, Round 2); main's snapshot confirms it a frame later.
  if(opensOrClosesSidebar(action)&&action.type==='ui.update'){const patch=action.patch;modeSwitch(()=>flushSync(()=>setState(previous=>{const own=Object.hasOwn(patch,'view')?patch.view??undefined:Object.hasOwn(patch,'focusMode')?viewForFocus(previous.settings,previous.windowUi,patch.focusMode===true)??undefined:previous.windowUi.view;return {...previous,windowUi:{...previous.windowUi,...patch,view:own,focusMode:own==='focus'}};})),'layout');}
  let sent=action,dispatched=false;
  // A workspace with no tab here gets a new one with a fresh id: only main may make that, so its switch is not optimistic.
  if(native&&OPTIMISTIC.has(action.type)&&!location.search.includes('view=overlay')&&(action.type!=='workspace.select'||workspaceHasTabs(latest.current,action.id))){
   if(action.type==='tab.new'&&!action.id)sent={...action,id:'tab-'+crypto.randomUUID()};
   // Main hears of the action before this frame is drawn, so a still it lays over the page area (a new tab page leaving) lands on the same frame.
   // Its answer is a later task, so it can never arrive before the optimistic state below is in place.
   void runtime.dispatch(sent).catch(error=>console.error('Browser action failed',error));dispatched=true;
   try{const base=latest.current,started=performance.now(),next=reduceBrowser(base,sent),reduced=performance.now();
    if(next!==base){const wait=optimistic.current;if(wait)clearTimeout(wait.timer);const count=(wait?.count??0)+1,baseRevision=wait?.base??base.revision,timer=setTimeout(()=>{optimistic.current=null;void runtime.getSnapshot().then(real=>real&&setState(complete(real)));},900);optimistic.current={base:baseRevision,count,timer};const shown={...next,revision:base.revision};latest.current=shown;if(workspaceSwitched(base,next))modeSwitch(()=>flushSync(()=>setState(shown)),'workspace');else flushSync(()=>setState(shown));const rendered=performance.now();(window as unknown as {__optimistic?:object}).__optimistic={action:action.type,reduceMs:+(reduced-started).toFixed(2),renderMs:+(rendered-reduced).toFixed(2)};}
   }catch(error){console.warn('Optimistic update skipped',error);}
  }
  if(!dispatched)void runtime.dispatch(sent).catch(error=>console.error('Browser action failed',error));};
 if(import.meta.env.DEV||location.search.includes('qa=1'))window.__acira={getState:()=>snapshot,dispatch};
 // R3-57: a window with several workspaces shows the open one's tabs, groups and splits; actions still reach the whole state (workspaces.ts).
 return {state:scopeToWorkspace(snapshot),dispatch};
}
