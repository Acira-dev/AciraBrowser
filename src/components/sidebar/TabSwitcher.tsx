import { useEffect,useLayoutEffect,useMemo,useRef,useState } from 'react';
import { shownPrivacy } from '../../ui/tabPrivacy';
import { tabShowsLoading } from '../../ui/tabLoading';
import { DotMatrix } from '../DotMatrix';
import { SiteIdentityIcon } from '../SiteIdentityIcon';
import { runtime } from '../../runtime/client';
import type { BrowserAction,BrowserSnapshot } from '../../runtime/types';
import { mruOrder,readCtrlTabMode,readCtrlTabShow,readStamps,readSwitcherOpenedAt,readSwitcherOrder,readSwitcherStart,switcherIndex,switcherReleasedSince } from '../../ui/tabMru';
import { MOTION,newPointerMemory,pointerMoved } from '../../ui/pictureSwitcher';
import { PictureSwitcher } from './PictureSwitcher';
import './tab-switcher.css';

import { t } from '../../i18n';
const host=(url:string)=>{try{const parsed=new URL(url);return parsed.protocol==='acira:'?'Acira':parsed.hostname.replace(/^www\./,'');}catch{return '';}};
const name=(title:string,url:string)=>['acira://home','acira://new'].includes(url)?t("browsermenu.newTab"):title||url;

/** Ctrl+Tab switcher, shown in the popup overlay while Ctrl is held: recently used tabs, current first.
 * Tab / Shift+Tab (sent by main as `tab-switcher-key`), arrows and the mouse move the selection; releasing Ctrl
 * (`tab-switcher-release` or a keyup here), Enter or a click switches; Escape closes without switching. */
export function TabSwitcher({state,dispatch,close,onNaturalHeight}:{state:BrowserSnapshot;dispatch:(action:BrowserAction)=>void;close:()=>void;onNaturalHeight?:(height:number)=>void}){
 // Beta 14: with pictures (Settings > Tabs > While switching, show) the list is the viewer: two glass sections, the page large with its name and a dock of small pictures (PictureSwitcher.tsx).
 const pictures=useMemo(()=>readCtrlTabShow()==='pictures',[]),mode=useMemo(readCtrlTabMode,[]);
 // The order is frozen when the switcher appears, so rows never move under the selection. Main decides it (the same tabs it steps through): the recently used order, or in "Next tab" the order of the list on screen.
 const tabs=useMemo(()=>{const byId=new Map(state.tabs.map(tab=>[tab.id,tab])),order=readSwitcherOrder();return (order&&order.length?order:mruOrder(state.tabs.map(tab=>tab.id),state.activeTabId,readStamps())).map(id=>byId.get(id)!).filter(Boolean);},[]);// eslint-disable-line react-hooks/exhaustive-deps
 const [index,setIndex]=useState(()=>mode==='next'?Math.max(0,tabs.findIndex(tab=>tab.id===state.activeTabId)):switcherIndex(tabs.length,0,readSwitcherStart()));
 const latest=useRef(index);latest.current=index;
 const done=useRef(false),root=useRef<HTMLDivElement>(null);
 const pointer=useRef(newPointerMemory());// a resting mouse's one move at the same spot is not a hover (ui/pictureSwitcher.ts pointerMoved)
 // "Next tab": every Tab press has switched already (main does it the moment the key arrives); the viewer only shows where you are, so it follows the current tab, and releasing Ctrl changes nothing.
 useEffect(()=>{if(mode!=='next')return;const at=tabs.findIndex(tab=>tab.id===state.activeTabId);if(at>=0&&at!==latest.current)setIndex(at);},[state.activeTabId]);// eslint-disable-line react-hooks/exhaustive-deps
 // With pictures the panel leaves with the exact reverse of its arrival (140 ms blur-and-fade) while the page switches at once underneath; the surface is closed when the reverse has played (the sample).
 // the reverse starts on the frame of the release: both attributes are set on the elements themselves, not through a render (the sample's data-leaving), so it starts no later than the sample's does
 const leave=()=>{if(!pictures){close();return;}root.current?.setAttribute('data-leaving','');root.current?.closest('.acira-popup-surface')?.setAttribute('data-r3-leaving','');window.setTimeout(close,MOTION.CLOSE_AFTER_MS);};
 // The names list closes first and then switches, so the tab change never meets a layout that still holds it (tests/tab-mru.test.ts); the viewer switches first and plays its reverse over the new page (the sample).
 // The listeners below are made once, so `state` in them is the first render's: the tab that was current when the switcher appeared. `live` is the current one now.
 const live=useRef(state.activeTabId);live.current=state.activeTabId;
 // `explicit` is a choice made in the switcher (Enter, a click); letting go of Ctrl is not one in "Next tab": main switched on every press, so the release changes nothing and sends nothing (G4: it used to send a switch to the tab the viewer showed, the current one again, or, behind a late echo, the one before it).
 // `quiet`: Ctrl went up before this view first appeared (the release was marked before it mounted): the choice is still made, but the surface is closed at once, with no arrival and no reverse of it to play (a viewer that opened AFTER Ctrl was up used to flash for a moment).
 const commit=(at=latest.current,explicit=true,quiet=false)=>{if(done.current)return;done.current=true;const tab=tabs[at];if(!pictures||quiet)close();if(tab&&tab.id!==live.current&&(explicit||mode!=='next'))dispatch({type:'tab.select',id:tab.id});if(pictures&&!quiet)leave();};
 const cancel=()=>{if(done.current)return;done.current=true;leave();};
 useEffect(()=>{const off=runtime.subscribeBrowser?.(raw=>{const event=raw as unknown as {type:string;direction?:number};
  if(event.type==='tab-switcher-key')setIndex(current=>switcherIndex(tabs.length,current,event.direction===-1?-1:1));
  else if(event.type==='tab-switcher-release')commit(undefined,false);});return()=>{off?.();};},[]);// eslint-disable-line react-hooks/exhaustive-deps
 // Control was let go while the switcher was still on its way (a tap let go before this view first appeared): nothing is left to wait for, and nothing is drawn.
 useEffect(()=>{if(switcherReleasedSince(readSwitcherOpenedAt()))commit(undefined,false,true);},[]);// eslint-disable-line react-hooks/exhaustive-deps
 useEffect(()=>{
  const up=(event:KeyboardEvent)=>{if(event.key==='Control'||event.key==='Meta')commit(undefined,false);};
  const down=(event:KeyboardEvent)=>{
   if(event.key==='Escape'){event.preventDefault();cancel();}
   else if(event.key==='Enter'){event.preventDefault();commit();}
   else if(event.key==='ArrowDown'||event.key==='ArrowUp'||pictures&&(event.key==='ArrowLeft'||event.key==='ArrowRight')){event.preventDefault();setIndex(current=>switcherIndex(tabs.length,current,event.key==='ArrowUp'||event.key==='ArrowLeft'?-1:1));}
  };
  window.addEventListener('keyup',up,true);window.addEventListener('keydown',down,true);
  return()=>{window.removeEventListener('keyup',up,true);window.removeEventListener('keydown',down,true);};
 },[]);// eslint-disable-line react-hooks/exhaustive-deps
 useLayoutEffect(()=>{const node=root.current;if(!node||!onNaturalHeight)return;const report=()=>onNaturalHeight(Math.ceil(node.scrollHeight));report();const observer=new ResizeObserver(report);observer.observe(node);return()=>observer.disconnect();},[]);// eslint-disable-line react-hooks/exhaustive-deps
 useEffect(()=>{if(!pictures)root.current?.querySelector<HTMLElement>(`[data-index="${index}"]`)?.scrollIntoView({block:'nearest'});},[index]);// eslint-disable-line react-hooks/exhaustive-deps
 if(pictures)return <div ref={root} className="tab-switcher sw" role="listbox" aria-label={t("tabswitcher.recentTabs")} tabIndex={-1}>
  <PictureSwitcher tabs={tabs} index={index} state={state} hover={at=>{if(latest.current!==at)setIndex(at);}} pick={at=>commit(at)}/>
 </div>;
 return <div ref={root} className="tab-switcher" role="listbox" aria-label={t("tabswitcher.recentTabs")} aria-activedescendant={tabs[index]?`switcher-${tabs[index].id}`:undefined} tabIndex={-1}>
  {tabs.map((tab,at)=><div key={tab.id} id={`switcher-${tab.id}`} role="option" aria-selected={at===index} data-index={at} className="tab-switcher-row" data-current={tab.id===state.activeTabId||undefined}
   onPointerMove={event=>{if(pointerMoved(pointer.current,event)&&latest.current!==at)setIndex(at);}} onClick={()=>commit(at)}>
   <span className="tab-switcher-icon">{tabShowsLoading(tab)?<DotMatrix preset="loader" size={14} reducedMotion={state.settings.reducedMotion}/>:<SiteIdentityIcon url={tab.url} favicon={tab.favicon} size={16} privacy={shownPrivacy(tab)} error={!!tab.error}/>}</span>
   <span className="tab-switcher-title">{tab.customTitle||name(tab.title,tab.url)}</span>
   <span className="tab-switcher-host">{tab.id===state.activeTabId?t("browsersettings.current"):host(tab.url)}</span>
  </div>)}
  <div className="tab-switcher-foot" aria-hidden="true">{t("tabswitcher.releaseCtrlToSwitchEsc")}</div>
 </div>;
}
