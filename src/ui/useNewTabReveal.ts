import { useCallback,useEffect,useLayoutEffect,useRef,useState,type RefObject } from 'react';
import { runtime } from '../runtime/client';
import type { TabSession } from '../runtime/types';
import { documentIdentity } from './interactionPolicy';
import { releaseFocusClaim, takeFocusClaim } from './addressFocusClaim';

type CollapsedMode='focus'|'compact';
const COMPACT_RETURN_MS=1000;

/** Keyboard reveals remember the originating layout, including automatic Compact. */
export function useNewTabReveal({tabs,tab,focusMode,compactMode,compactEnabled,enabled,busy,reveal,addressRef,addressEditPending=false,autoSuspended=false,setReveal:publishReveal,setFocusMode:publishFocusMode,setEngagedTab:publishEngagedTab,overlayKind}:{
 tabs:TabSession[];tab:TabSession;focusMode:boolean;compactMode:boolean;compactEnabled:boolean;enabled:boolean;busy:boolean;reveal:boolean;
 addressRef:RefObject<HTMLInputElement|null>;addressEditPending?:boolean;autoSuspended?:boolean;setReveal:(value:boolean)=>void;setFocusMode:(value:boolean)=>void;setEngagedTab:(value:string|null)=>void;overlayKind:string|null;
}){
 const actions=useRef({publishReveal,publishFocusMode,publishEngagedTab});
 actions.current={publishReveal,publishFocusMode,publishEngagedTab};
 // Dispatch wrappers can change on every snapshot; they must not restart keyboard deadlines.
 const setReveal=useCallback((value:boolean)=>actions.current.publishReveal(value),[]);
 const setFocusMode=useCallback((value:boolean)=>actions.current.publishFocusMode(value),[]);
 const setEngagedTab=useCallback((value:string|null)=>actions.current.publishEngagedTab(value),[]);
 const [automaticCommit,setAutomaticCommit]=useState(0),[focusPulse,setFocusPulse]=useState(0);
 const documentKey=documentIdentity(tab.url);
 const collapsed:CollapsedMode|null=focusMode?'focus':compactMode?'compact':null;
 const current=useRef({tabId:tab.id,focusMode,compactEnabled,collapsed,overlayKind,busy,addressEditPending,autoSuspended});
 current.current={tabId:tab.id,focusMode,compactEnabled,collapsed,overlayKind,busy,addressEditPending,autoSuspended};
 const automaticTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),automaticHeld=useRef<string|null>(null);
 const automaticContext=useRef({id:tab.id,documentKey,enabled:compactEnabled&&enabled&&!autoSuspended});
 const holdAutomatic=()=>{automaticHeld.current=current.current.tabId;clearTimeout(automaticTimer.current);automaticTimer.current=undefined;};
 const releaseAutomatic=()=>{automaticHeld.current=null;setAutomaticCommit(value=>value+1);};
 const previous=useRef({ids:new Set(tabs.map(item=>item.id)),active:tab.id,collapsed});
 const temporary=useRef<string|null>(null),newTabMode=useRef<CollapsedMode|null>(null),pendingFocus=useRef<string|null>(null),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
 const clear=()=>{clearTimeout(timer.current);timer.current=undefined;};
 const pendingMode=useRef<CollapsedMode|null>(null);
 const cycling=useRef(false),cycleMode=useRef<CollapsedMode|null>(null),cycleTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
 const cancelCycle=()=>{cycling.current=false;cycleMode.current=null;clearTimeout(cycleTimer.current);cycleTimer.current=undefined;};
 const permitted=(mode:CollapsedMode|null)=>mode==='focus'?current.current.focusMode:mode==='compact'?current.current.compactEnabled&&!current.current.autoSuspended:false;
 const restore=(mode:CollapsedMode|null)=>{
  if(mode==='compact')setEngagedTab(current.current.tabId);
  addressRef.current?.blur();setReveal(false);
 };
 useEffect(()=>{
  if(!enabled)return;
  const finish=()=>{
   if(!cycling.current)return;
   if(!permitted(cycleMode.current)){cancelCycle();return;}
   // Automatic suggestions are not a deliberate review of a browser panel.
   if(current.current.busy||current.current.addressEditPending||current.current.overlayKind&&current.current.overlayKind!=='suggestions'){cycleTimer.current=setTimeout(finish,200);return;}
   const target=cycleMode.current;cancelCycle();restore(target);
  };
  const start=()=>{
   const target=cycleMode.current||newTabMode.current||current.current.collapsed;
   if(!target)return;
   clear();temporary.current=null;newTabMode.current=null;pendingMode.current=null;
   cycling.current=true;cycleMode.current=target;clearTimeout(cycleTimer.current);setReveal(true);
   cycleTimer.current=setTimeout(finish,COMPACT_RETURN_MS);
  };
  const rememberNewTab=()=>{const target=cycleMode.current||newTabMode.current||current.current.collapsed;cancelCycle();pendingMode.current=target;};
  const unsubscribe=runtime.subscribeBrowser(event=>{
   if(event.type!=='shortcut')return;
   if(event.command==='cycle-reveal')start();
   else if(event.command==='reveal')rememberNewTab();
   else if(['address','palette','escape'].includes(event.command)){pendingMode.current=null;pendingFocus.current=releaseFocusClaim();cancelCycle();}
  });
  const editing=(event:Event)=>{if(event.target===addressRef.current){pendingFocus.current=releaseFocusClaim();cancelCycle();}};
  const pointer=(event:PointerEvent)=>{
   if(!cycling.current||!(event.target instanceof Element)||!event.target.closest('.browser-shell'))return;
   if(event.target.closest('[data-layout-toggle]'))return;
   cancelCycle();setFocusMode(false);setEngagedTab(null);setReveal(false);
  };
  const keyboard=(event:KeyboardEvent)=>{
   if(window.acira||event.defaultPrevented)return;
   const mod=event.ctrlKey||event.metaKey,key=/^Key[A-Z]$/.test(event.code)?event.code.slice(3).toLowerCase():event.key.toLowerCase();
   if(mod&&!event.altKey&&key==='tab')start();
   else if(mod&&!event.altKey&&key==='t')rememberNewTab();
   else if(key==='escape'||mod&&!event.altKey&&(['l','e','k','t'].includes(key)||event.shiftKey&&key==='f'))cancelCycle();
  };
  // Capture runs before the preview's ordinary tab-cycle handler.
  window.addEventListener('keydown',keyboard,true);window.addEventListener('input',editing,true);window.addEventListener('pointerdown',pointer,true);
  return()=>{cancelCycle();unsubscribe();window.removeEventListener('keydown',keyboard,true);window.removeEventListener('input',editing,true);window.removeEventListener('pointerdown',pointer,true);};
 },[enabled,addressRef,setReveal,setFocusMode,setEngagedTab]);
 useEffect(()=>{
  if(cycling.current&&!permitted(cycleMode.current))cancelCycle();
 },[focusMode,compactEnabled,autoSuspended]);
 useLayoutEffect(()=>{
  const created=!previous.current.ids.has(tab.id),changed=previous.current.active!==tab.id,inherited=pendingMode.current||cycleMode.current||newTabMode.current||previous.current.collapsed;
  previous.current={ids:new Set(tabs.map(item=>item.id)),active:tab.id,collapsed};
  if(tab.url!=='acira://new'){temporary.current=null;newTabMode.current=null;pendingFocus.current=null;}
  if(!changed)return;
  clear();temporary.current=null;newTabMode.current=null;pendingMode.current=null;pendingFocus.current=null;
  if(enabled&&created&&tab.url==='acira://new'){
   const target=focusMode?'focus':inherited;
   cancelCycle();temporary.current=tab.id;newTabMode.current=target;pendingFocus.current=tab.id;holdAutomatic();if(focusMode)setFocusPulse(value=>value+1);else setReveal(true);
  }else if(focusMode&&!cycling.current){setReveal(false);addressRef.current?.blur();}
 },[tabs,tab.id,tab.url,focusMode,collapsed,enabled,addressRef,setReveal]);
 useLayoutEffect(()=>{
  const taken=takeFocusClaim(pendingFocus.current,tab.id,reveal||focusMode);
  pendingFocus.current=taken.claim;
  // A field the person is already in (Ctrl+L, typing) is never focused and selected again under their hands.
  if(taken.focus&&document.activeElement!==addressRef.current){
   addressRef.current?.focus({preventScroll:true});addressRef.current?.select();
  }
 },[reveal,focusPulse,focusMode,tab.id,addressRef]);
 useEffect(()=>{
  if(!enabled||temporary.current!==tab.id)return;
  // A fresh foreground blank tab owns its omnibox until the user acts. It has
  // no automatic collapse deadline and never transfers focus into page search.
  const stopTemporary=()=>{clear();temporary.current=null;newTabMode.current=null;pendingFocus.current=null;};
  const keyboard=(event:KeyboardEvent)=>{if(event.key==='Escape')stopTemporary();};
  const pointer=(event:PointerEvent)=>{
   if(!(event.target instanceof Element)||event.target.closest('.address-bar,.tab-strip-add,.acira-compact-new,.rail-brand,.sb-new-tab'))return;
   stopTemporary();
  };
  window.addEventListener('keydown',keyboard,true);window.addEventListener('pointerdown',pointer,true);
  return()=>{clear();window.removeEventListener('keydown',keyboard,true);window.removeEventListener('pointerdown',pointer,true);};
 },[tab.id,enabled,focusMode,compactEnabled,reveal,addressRef,setReveal,setFocusMode,setEngagedTab]);
 useEffect(()=>{
  const prior=automaticContext.current;
  automaticContext.current={id:tab.id,documentKey,enabled:compactEnabled&&enabled&&!autoSuspended};
  // Turning Automatic on for the tab in view is an explicit choice: it collapses at once (A, round 2: the first
  // compact<->normal switch waited this one-second return and read as a 1-2s lag); a page that settles keeps the return.
  const turnedOn=prior.id===tab.id&&prior.documentKey===documentKey&&!prior.enabled&&compactEnabled&&enabled&&!autoSuspended;
  if(prior.id!==tab.id||prior.documentKey!==documentKey||!prior.enabled&&compactEnabled&&enabled&&!autoSuspended)automaticHeld.current=null;
  clearTimeout(automaticTimer.current);
  const eligible=tab.contentKind==='web'||tab.url==='acira://new';
  if(!enabled||!compactEnabled||autoSuspended||!eligible||tab.loading||tab.error||automaticHeld.current===tab.id)return;
  const finish=()=>{
   if(current.current.tabId!==tab.id||automaticHeld.current===tab.id||current.current.focusMode)return;
   // Shortcut reveals own their one-second deadline; do not race them.
   if(cycling.current||temporary.current===tab.id)return;
   if(current.current.busy||current.current.addressEditPending||current.current.overlayKind&&current.current.overlayKind!=='suggestions'){
    automaticTimer.current=setTimeout(finish,200);return;
   }
   if(tab.url==='acira://new'&&document.activeElement===addressRef.current)return;
   restore('compact');
  };
  automaticTimer.current=setTimeout(finish,turnedOn?0:COMPACT_RETURN_MS);
  return()=>clearTimeout(automaticTimer.current);
 },[tab.id,documentKey,tab.loading,tab.error,enabled,compactEnabled,autoSuspended,automaticCommit,addressRef,setReveal,setEngagedTab]);
 useEffect(()=>{
  const unsubscribe=runtime.subscribeBrowser(event=>{if(event.type==='shortcut'&&['address','palette','escape'].includes(event.command))holdAutomatic();if(event.type==='ui'&&event.action==='address-commit')releaseAutomatic();});
  const edit=(event:Event)=>{if(event.target===addressRef.current)holdAutomatic();};
  const keyboard=(event:KeyboardEvent)=>{
   const key=event.key.toLowerCase(),mod=event.ctrlKey||event.metaKey;
   if(mod&&['l','e','k'].includes(key)||key==='escape'||event.target===addressRef.current&&!['control','meta','alt','shift'].includes(key)&&!(mod&&['t','tab'].includes(key)))holdAutomatic();
  };
  const pointer=(event:PointerEvent)=>{
   if(!(event.target instanceof Element)||!event.target.closest('.browser-shell'))return;
   if(event.target.closest('[role="tab"],.acira-compact-tab,.tab-strip-add,.acira-compact-new,.rail-brand,.sb-new-tab,.standard-tabs-scroll,.acira-compact-scroll,[data-layout-toggle]'))return;
   holdAutomatic();
  };
  window.addEventListener('input',edit,true);window.addEventListener('keydown',keyboard,true);window.addEventListener('pointerdown',pointer,true);
  return()=>{unsubscribe();window.removeEventListener('input',edit,true);window.removeEventListener('keydown',keyboard,true);window.removeEventListener('pointerdown',pointer,true);clearTimeout(automaticTimer.current);};
 },[addressRef]);
 return {holdAutomatic,releaseAutomatic};
}
