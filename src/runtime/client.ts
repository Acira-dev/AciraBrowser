import {overlayHolds,settingsKeyOf} from '../ui/overlayHold';
import { useEffect,useRef,useState } from 'react';
import { flushSync } from 'react-dom';
import { createInitialState,effectiveView,hideToolbarOn,persistedSnapshot,reduceBrowser,restoreSnapshot,viewForFocus } from './core';
import { patchKeepingSidebarOpen } from './windowView';
import { scopeToWorkspace,workspaceHasTabs } from './workspaces';
import { isGroupFold } from './tabGroups';
import { startWorkspaceTransition,workspaceSwitched } from '../ui/workspaceMotion';
import type { BrowserAction,BrowserEvent,BrowserLayout,BrowserRuntime,BrowserSnapshot } from './types';
import { undoImportBatches } from '../ui/importedFavorites';
import { restoreSidebarApp } from '../ui/sidebarApps';
import { restoreHiddenSection } from '../ui/sidebarSections';
import { appearanceChanged, appearanceCrossfades, modeSwitchPlaying, startModeTransition, whenModeSwitchSettled } from '../ui/sharedMotion';
import { opensOrClosesSidebar,sidebarCloses,sidebarLayoutChanged } from '../ui/layoutMode';
import { miniDockSnapshot,noteMiniDock } from '../ui/miniDockDirection';
import { chromeLayoutChanged } from '../ui/chromeLayout';
import { alongTheTop,morphDirection,morphTargetOf,stripTurnHidden } from '../ui/sidebarMode';
import { REFIT_EVENT,noteMorphTarget,sidebarMorphDirection,sidebarMorphRunning,startSidebarMorph } from '../ui/sidebarMorph';
import { setRailPrefs } from '../ui/railPrefs';
import { currentLocale,saidAs,translateText } from '../i18n';
import { withMessageIds } from '../i18n/said';
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
// The update a mode switch is still holding for its view transition. A newer switch runs it first, so an older update never lands
// after a newer one: two clicks on the space pills within a frame (each switch is optimistic) showed the second space, then the
// first again when its transition's update ran, until main's snapshot came.
let heldModeUpdate:(()=>void)|null=null;
// A layout switch asked for while another transition plays (the sidebar sliding, a view changing) waits for it to land and then plays as a morph of its own, in the order asked: it never
// runs under the first one's layers (the layout would jump to its end while the page glides from where it is). Snapshots wait behind it (modeUpdatePending), as behind any held switch.
let queuedLayouts=0,layoutQueue:Promise<void>=Promise.resolve();
const startSwitch=(update:()=>void,kind?:'appearance'|'layout'|'workspace',slideHint?:()=>'out'|undefined)=>{heldModeUpdate?.();let done=false;const run=()=>{if(done)return;done=true;if(heldModeUpdate===run)heldModeUpdate=null;modeUpdatePending=queuedLayouts>0;const was=kind==='layout'?miniDockSnapshot():null;update();/* Beta 14.0, group C: the toolbar's fit (which buttons the row has room for, ui/toolbarOverflow.ts) runs a frame after a render, so the layout transition took its new pictures of an UNFITTED row: a button the stale marks hid got no picture of its own and then stood in the toolbar's plain picture, alone and ahead of its row (Home at 150 %, Hide the toolbar -> Tabs on top + sidebar: stepped frames, 19 Nov). The fit runs here, on what React just drew, as the morph does it. */if(kind==='layout')try{window.dispatchEvent(new Event(REFIT_EVENT));}catch{/* no window */}if(was!==null)noteMiniDock(was);};heldModeUpdate=run;modeUpdatePending=true;if(kind==='workspace')startWorkspaceTransition(run);else startModeTransition(run,kind,slideHint?.());if(!done)setTimeout(run,MODE_UPDATE_MS);};
const modeSwitch=(update:()=>void,kind?:'appearance'|'layout'|'workspace',slideHint?:()=>'out'|undefined)=>{
 if(kind==='layout'&&sidebarMorphRunning()&&startSidebarMorph(update,sidebarMorphDirection()))return;
 if(kind==='layout'&&(queuedLayouts>0||modeSwitchPlaying())){queuedLayouts++;modeUpdatePending=true;layoutQueue=layoutQueue.then(()=>whenModeSwitchSettled()).then(()=>{queuedLayouts--;startSwitch(update,'layout',slideHint);});return;}
 startSwitch(update,kind,slideHint);
};
/** Sidebar mode on or off, from one snapshot to the next: 'in' (tabs and the address bar in the sidebar), 'out', or (a morph already running takes any layout change) its own direction. */
/** Settings › Appearance › Layout › Hide the toolbar turned on or off (or something that changes whether it applies): the toolbar leaves or returns as a layout switch (one page layout, like Seamless's entry), not as the header's own spring under a heavy page. */
const toolbarHidesOrReturns=(previous:BrowserSnapshot,next:BrowserSnapshot)=>hideToolbarOn(previous.settings,effectiveView(previous.settings,previous.windowUi))!==hideToolbarOn(next.settings,effectiveView(next.settings,next.windowUi));
/* (Beta 14.0: the morph is told what the layout it goes to has, so the page's top edge can take the wait that pair needs before the new layout exists: sidebarMorph.ts noteMorphTarget.) */
const morphOf=(previous:BrowserSnapshot,next:BrowserSnapshot)=>{const direction=morphDirection(previous,next,sidebarMorphRunning(),sidebarLayoutChanged(previous,next)||chromeLayoutChanged(previous,next),sidebarMorphDirection());noteMorphTarget(direction?{...morphTargetOf(next),top:alongTheTop(previous,next)}:null);return direction;};
/** The profile's own tabs switch is drawn from the setting a round trip later; in a morph it goes in the same render, or the strip would be taken down before the sidebar is there. */
const syncRail=(next:BrowserSnapshot)=>{const tab=next.tabs.find(item=>item.id===next.activeTabId)||next.tabs[0];if(!tab)return;setRailPrefs({tabs:!!next.settings.verticalTabs},tab.browserProfileId,!!next.browserProfiles.find(profile=>profile.id===tab.browserProfileId)?.private);};
const OPTIMISTIC=new Set<string>(['tab.select','tab.new','tab.close','workspace.select','split.resize','sidebar.mode']);
// A group's fold or unfold (tab.group.update with only `collapsed`, isGroupFold) is optimistic too: the header's click draws it on its own frame instead of after main's answer.
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
  const flush=()=>{cancelAnimationFrame(frame);clearTimeout(timer);frame=0;if(modeUpdatePending&&pending){frame=requestAnimationFrame(flush);timer=setTimeout(flush,MODE_UPDATE_MS);return;}const next=pending;pending=null;if(!next)return;const stale=!!optimistic.current&&next.revision<optimistic.current.base+optimistic.current.count,morph=stale?null:morphOf(latest.current,next),turn=!stale&&stripTurnHidden(latest.current,next),applyNow=()=>{apply(next);if(morph||turn)syncRail(next);/* the profile's tabs switch goes in the same render, however the switch is played (the morph; the strip arriving or leaving with Hide the toolbar on, a layout transition: ui/sidebarMode.ts stripTurnHidden) */};if(appearanceCrossfades(shown,next))modeSwitch(()=>flushSync(applyNow));else if(workspaceSwitched(shown,next))modeSwitch(()=>flushSync(applyNow),'workspace');else if(morph&&startSidebarMorph(()=>flushSync(applyNow),morph)){/* played as Sidebar mode's morph */}else if(sidebarLayoutChanged(shown,next)||chromeLayoutChanged(shown,next)){const shownNow=latest.current;/* main confirming what an optimistic switch already put on screen is not another layout switch */if(sidebarLayoutChanged(shownNow,next)||chromeLayoutChanged(shownNow,next))modeSwitch(()=>flushSync(applyNow),'layout',()=>sidebarCloses(latest.current,next.windowUi,next.activeTabId,next.tabs)?'out' as const:undefined);else flushSync(applyNow);}else flushSync(applyNow);};
  // 14.4 battery (ui/overlayHold.ts): the popup layer keeps the newest state while it shows nothing and renders it with the layout of the popup that opens.
  let held:BrowserSnapshot|null=null,showing=true,heldKey='',layoutSeen=false;const applyLayer=(next:BrowserSnapshot)=>{held=null;heldKey=settingsKeyOf(next);apply(next);};
  const unLayout=batch?()=>{}:runtime.subscribeLayout(next=>{layoutSeen=true;showing=Boolean(next?.overlay);if(showing&&held)applyLayer(held);});
  const receive=(raw:BrowserSnapshot)=>{if(!raw)return;const next=complete(raw);if(batch)newestActiveTab=next.activeTabId??null;if(!batch){if(overlayHolds(showing,heldKey,next)){held=next;return;}return applyLayer(next);}
   // Native Cmd/Ctrl+T and tab shortcuts precede the next keystroke. Commit their
   // foreground owner now, like optimistic pointer actions, so input cannot land
   // on the old page/body while a requestAnimationFrame batch is waiting.
   const previous=latest.current;
   if(next.revision>=previous.revision&&(!pending||next.revision>=pending.revision)&&next.activeTabId!==previous.activeTabId&&next.activeBrowserProfileId===previous.activeBrowserProfileId&&!appearanceChanged(previous,next)&&!workspaceSwitched(previous,next)){
    cancelAnimationFrame(frame);clearTimeout(timer);frame=0;pending=null;flushSync(()=>apply(next));return;
   }
   if(!pending||next.revision>=pending.revision)pending=next;if(!frame){frame=requestAnimationFrame(flush);timer=setTimeout(flush,100);}};
  const unsubscribe=runtime.subscribe(receive);void runtime.getSnapshot().then(full=>batch?apply(complete(full)):applyLayer(complete(full)));if(!batch)void runtime.getBrowserLayout().then(next=>{if(!layoutSeen)showing=Boolean(next?.overlay);});return()=>{unsubscribe();unLayout();cancelAnimationFrame(frame);clearTimeout(timer);};},[]);
 /* 17 Nov: closing a tab is drawn at once (OPTIMISTIC), and for the LAST tab that means a replacement New Tab appears with the page gone. When the page has unsaved work main asks first ("Leave without saving?"): until the person answers
    nothing is closed, so the moment main says it is asking, what was drawn ahead of the answer is taken back and the page stays under the card (the real state is read again, as the 900 ms timer would). */
 useEffect(()=>{if(location.search.includes('view=overlay'))return;return runtime.subscribeBrowser(event=>{if(event.type!=='dialog'||event.op!=='show'||!optimistic.current)return;const wait=optimistic.current;clearTimeout(wait.timer);optimistic.current=null;void runtime.getSnapshot().then(real=>real&&setState(complete(real)));});},[]);
 const dispatch=(action:BrowserAction)=>{/* A toast written in the language on screen goes with its message id, so a language change shows it in the new one. */if(action.type==='toast')action=withMessageIds(action,saidAs);/* 13.5: Sidebar + address in Full holds its sidebar open: whatever would close it is taken out of the patch before anything is drawn or sent (an optimistic close would flash the sidebar shut), and a patch left with nothing is not an action at all. */if(action.type==='ui.update'){const patch=patchKeepingSidebarOpen(latest.current.settings,latest.current.windowUi,action.patch);if(patch!==action.patch){if(!Object.keys(patch).length)return;action={...action,patch};}}if(action.type==='import.undo'){void undoImportBatches(action.batchIds,batchId=>runtime.service({type:'imports.undo',batchId})).then(()=>runtime.dispatch(action.profileIds?.length?action:{type:'toast',text:'Import undone'})).catch(error=>runtime.dispatch({type:'toast',text:String(error?.message||error).slice(0,200),tone:'error'}));return;}
  // Undo of a removed favorite: it comes back with the live tab it had handed to the tab list, if that tab is still open and unclaimed.
  // Undo of Hide this section (ui/sidebarSections.ts): the section is shown again, from whichever view shows the toast.
  if(action.type==='sidebar.section.restore'){restoreHiddenSection(action.token);return;}
  if(action.type==='favorite.restore'){restoreSidebarApp(action.token,(appId,tabIds)=>{const tab=latest.current.tabs.find(tab=>tabIds.includes(tab.id)&&!tab.favoriteId);if(tab)dispatch({type:'tab.favorite',id:tab.id,favoriteId:appId});});return;}
  // Opening or closing the sidebar shows on the input frame (G, Round 2); main's snapshot confirms it a frame later.
  if(opensOrClosesSidebar(action)&&action.type==='ui.update'){const patch=action.patch,hint=()=>sidebarCloses(latest.current,{...latest.current.windowUi,...patch},latest.current.activeTabId)?'out' as const:undefined;modeSwitch(()=>flushSync(()=>setState(previous=>{const own=Object.hasOwn(patch,'view')?patch.view??undefined:Object.hasOwn(patch,'focusMode')?viewForFocus(previous.settings,previous.windowUi,patch.focusMode===true)??undefined:previous.windowUi.view;return {...previous,windowUi:{...previous.windowUi,...patch,view:own,focusMode:own==='focus'}};})),'layout',hint);}
  let sent=action,dispatched=false;
  // A workspace with no tab here gets a new one with a fresh id: only main may make that, so its switch is not optimistic.
  /* 17 Nov: the LAST tab's close is not drawn ahead of main: the reducer would make a replacement New Tab with an id main never has, drawn over a page that may refuse to close (unsaved work: main asks first, and the card stood over a New Tab for a moment, with the popup naming a tab main does not know). It waits the one round trip. */const lastTabClose=action.type==='tab.close'&&latest.current.tabs.length<=1;
  if(native&&!lastTabClose&&(OPTIMISTIC.has(action.type)||isGroupFold(latest.current,action))&&!location.search.includes('view=overlay')&&(action.type!=='workspace.select'||workspaceHasTabs(latest.current,action.id))){
   if(action.type==='tab.new'&&!action.id)sent={...action,id:'tab-'+crypto.randomUUID()};
   /* 13.7: the interface draws a tab switch itself, on this frame, before main answers: main must not show the page ahead of it (desktop/fast-switch.cjs, `optimistic`) */if(action.type==='tab.select')sent={...action,optimistic:true};
   // Main hears of the action before this frame is drawn, so a still it lays over the page area (a new tab page leaving) lands on the same frame.
   // Its answer is a later task, so it can never arrive before the optimistic state below is in place.
   void runtime.dispatch(sent).catch(error=>console.error('Browser action failed',error));dispatched=true;
   try{const base=latest.current,started=performance.now(),next=reduceBrowser(base,sent),reduced=performance.now();
    if(next!==base){const wait=optimistic.current;if(wait)clearTimeout(wait.timer);const count=(wait?.count??0)+1,baseRevision=wait?.base??base.revision,timer=setTimeout(()=>{optimistic.current=null;void runtime.getSnapshot().then(real=>real&&setState(complete(real)));},900);optimistic.current={base:baseRevision,count,timer};const shown={...next,revision:base.revision};latest.current=shown;if(workspaceSwitched(base,next))modeSwitch(()=>flushSync(()=>setState(shown)),'workspace');else{/* Sidebar mode plays on the press frame as its morph; main's snapshot, a moment later, finds nothing left to change */const direction=action.type==='sidebar.mode'?morphOf(base,next):null;if(!(direction&&startSidebarMorph(()=>flushSync(()=>{setState(shown);syncRail(next);}),direction))){const settle=()=>flushSync(()=>{setState(shown);if(action.type==='sidebar.mode')syncRail(next);});if((action.type==='sidebar.mode'&&(direction||sidebarLayoutChanged(base,next)))||(action.type==='settings.update'&&toolbarHidesOrReturns(base,next)))modeSwitch(settle,'layout');else settle();}}const rendered=performance.now();(window as unknown as {__optimistic?:object}).__optimistic={action:action.type,reduceMs:+(reduced-started).toFixed(2),renderMs:+(rendered-reduced).toFixed(2)};}
   }catch(error){console.warn('Optimistic update skipped',error);}
  }
  if(!dispatched)void runtime.dispatch(sent).catch(error=>console.error('Browser action failed',error));};
 if(import.meta.env.DEV||location.search.includes('qa=1'))window.__acira={getState:()=>snapshot,dispatch};
 // R3-57: a window with several workspaces shows the open one's tabs, groups and splits; actions still reach the whole state (workspaces.ts).
 return {state:scopeToWorkspace(snapshot),dispatch};
}
