import { useEffect,useLayoutEffect,useMemo,useRef,useState } from 'react';
import { shownPrivacy } from '../../ui/tabPrivacy';
import { tabShowsLoading } from '../../ui/tabLoading';
import { DotMatrix } from '../DotMatrix';
import { SiteIdentityIcon } from '../SiteIdentityIcon';
import { runtime } from '../../runtime/client';
import type { BrowserAction,BrowserSnapshot } from '../../runtime/types';
import { mruOrder,readStamps,readSwitcherOpenedAt,readSwitcherStart,switcherIndex,switcherReleasedSince } from '../../ui/tabMru';
import './tab-switcher.css';

import { t } from '../../i18n';
const host=(url:string)=>{try{const parsed=new URL(url);return parsed.protocol==='acira:'?'Acira':parsed.hostname.replace(/^www\./,'');}catch{return '';}};
const name=(title:string,url:string)=>['acira://home','acira://new'].includes(url)?t("browsermenu.newTab"):title||url;

/** Ctrl+Tab switcher, shown in the popup overlay while Ctrl is held: recently used tabs, current first.
 * Tab / Shift+Tab (sent by main as `tab-switcher-key`), arrows and the mouse move the selection; releasing Ctrl
 * (`tab-switcher-release` or a keyup here), Enter or a click switches; Escape closes without switching. */
export function TabSwitcher({state,dispatch,close,onNaturalHeight}:{state:BrowserSnapshot;dispatch:(action:BrowserAction)=>void;close:()=>void;onNaturalHeight?:(height:number)=>void}){
 // The order is frozen when the switcher appears, so rows never move under the selection.
 const tabs=useMemo(()=>{const byId=new Map(state.tabs.map(tab=>[tab.id,tab]));return mruOrder(state.tabs.map(tab=>tab.id),state.activeTabId,readStamps()).map(id=>byId.get(id)!).filter(Boolean);},[]);// eslint-disable-line react-hooks/exhaustive-deps
 const [index,setIndex]=useState(()=>switcherIndex(tabs.length,0,readSwitcherStart()));
 const latest=useRef(index);latest.current=index;
 const done=useRef(false),root=useRef<HTMLDivElement>(null);
 const commit=(at=latest.current)=>{if(done.current)return;done.current=true;const tab=tabs[at];close();if(tab&&tab.id!==state.activeTabId)dispatch({type:'tab.select',id:tab.id});};
 const cancel=()=>{if(done.current)return;done.current=true;close();};
 useEffect(()=>{const off=runtime.subscribeBrowser?.(raw=>{const event=raw as unknown as {type:string;direction?:number};
  if(event.type==='tab-switcher-key')setIndex(current=>switcherIndex(tabs.length,current,event.direction===-1?-1:1));
  else if(event.type==='tab-switcher-release')commit();});return()=>{off?.();};},[]);// eslint-disable-line react-hooks/exhaustive-deps
 // Control was let go while the switcher was still on its way (a tap held about as long as the delay before it shows): nothing is left to wait for.
 useEffect(()=>{if(switcherReleasedSince(readSwitcherOpenedAt()))commit();},[]);// eslint-disable-line react-hooks/exhaustive-deps
 useEffect(()=>{
  const up=(event:KeyboardEvent)=>{if(event.key==='Control'||event.key==='Meta')commit();};
  const down=(event:KeyboardEvent)=>{
   if(event.key==='Escape'){event.preventDefault();cancel();}
   else if(event.key==='Enter'){event.preventDefault();commit();}
   else if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();setIndex(current=>switcherIndex(tabs.length,current,event.key==='ArrowUp'?-1:1));}
  };
  window.addEventListener('keyup',up,true);window.addEventListener('keydown',down,true);
  return()=>{window.removeEventListener('keyup',up,true);window.removeEventListener('keydown',down,true);};
 },[]);// eslint-disable-line react-hooks/exhaustive-deps
 useLayoutEffect(()=>{const node=root.current;if(!node||!onNaturalHeight)return;const report=()=>onNaturalHeight(Math.ceil(node.scrollHeight));report();const observer=new ResizeObserver(report);observer.observe(node);return()=>observer.disconnect();},[]);// eslint-disable-line react-hooks/exhaustive-deps
 useEffect(()=>{root.current?.querySelector<HTMLElement>(`[data-index="${index}"]`)?.scrollIntoView({block:'nearest'});},[index]);
 return <div ref={root} className="tab-switcher" role="listbox" aria-label={t("tabswitcher.recentTabs")} aria-activedescendant={tabs[index]?`switcher-${tabs[index].id}`:undefined} tabIndex={-1}>
  {tabs.map((tab,at)=><div key={tab.id} id={`switcher-${tab.id}`} role="option" aria-selected={at===index} data-index={at} className="tab-switcher-row" data-current={tab.id===state.activeTabId||undefined}
   onPointerMove={()=>{if(latest.current!==at)setIndex(at);}} onClick={()=>commit(at)}>
   <span className="tab-switcher-icon">{tabShowsLoading(tab)?<DotMatrix preset="loader" size={14} reducedMotion={state.settings.reducedMotion}/>:<SiteIdentityIcon url={tab.url} favicon={tab.favicon} size={16} privacy={shownPrivacy(tab)} error={!!tab.error}/>}</span>
   <span className="tab-switcher-title">{tab.customTitle||name(tab.title,tab.url)}</span>
   <span className="tab-switcher-host">{tab.id===state.activeTabId?t("browsersettings.current"):host(tab.url)}</span>
  </div>)}
  <div className="tab-switcher-foot" aria-hidden="true">{t("tabswitcher.releaseCtrlToSwitchEsc")}</div>
 </div>;
}
