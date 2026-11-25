/* Beta 14 section AG: the Ctrl+Tab viewer with page pictures. A port of the approved sample (the reference sample, round 4: B14R4Switcher.tsx, B14R3Switcher.tsx's glass
 * shapes, B14PictureSwitcher.tsx's Picture and look), logic and values as the sample has them (the sample's files are never imported). EXACT SAMPLE PARITY: what is the sample's stays the
 * sample's; the changes are only where the real app needs one, each named here:
 *   - the pictures come from main's tab-card store (usePictures), not from the QA driver's storage; a tab with none shows the sample's own stand-ins (the icon on a soft tile, never a blank box);
 *   - "n of N" and the private words are translated;
 *   - the viewer follows `index` from its parent, which also drives it in "Next tab" order (the tab the key already switched to);
 *   - the surface's attributes (data-r3, data-r3-leaving; the parent sets the second on the frame of the release) carry the arrival and leave animations the sample put on a :has() rule;
 *   - right-to-left (the brief: "must hold"): the row scrolls the other way and its edge fades swap sides; motion Off (the sample's notes: "the highlight jumps; arrival and leaving become an 80 ms fade") is in the stylesheet.
 * Two glass sections only: the page large with its name attached, and a slim dock holding only the row. The highlight is ALWAYS on the tab you are on: every step lights the new picture at
 * once (65 ms in) while the one just left fades (85 ms out); anything older snaps off, so at most two pictures are ever lit, and it never slides. The large page and its name follow every
 * step: a 120 ms cross-fade for a lone step, 70 ms when steps come quickly; a newer step first completes the fade in progress, so no half-faded page is ever stacked under another. */
import { useEffect,useLayoutEffect,useMemo,useRef,useState,type CSSProperties,type ReactNode } from 'react';
import type { BrowserSnapshot,TabSession } from '../../runtime/types';
import { runtime } from '../../runtime/client';
import { shownPrivacy } from '../../ui/tabPrivacy';
import { tabShowsLoading } from '../../ui/tabLoading';
import { useSiteIconColor } from '../../ui/siteIconColor';
import { DotMatrix } from '../DotMatrix';
import { SiteIdentityIcon } from '../SiteIdentityIcon';
import { TabSoundMeter } from '../TabSound';
import { MOTION,R4,firstVisible,legible,newPointerMemory,pointerMoved,r4Layout,rowFirst } from '../../ui/pictureSwitcher';
import { t } from '../../i18n';
import './picture-switcher.css';

const host=(url:string)=>{try{const parsed=new URL(url);return parsed.protocol==='acira:'?'Acira':parsed.hostname.replace(/^www\./,'');}catch{return '';}};
const titleOf=(tab:TabSession)=>tab.customTitle||(['acira://home','acira://new'].includes(tab.url)?t("browsermenu.newTab"):tab.title||tab.url);

/** What main keeps of a page (desktop/tab-card.cjs): the small picture the dock and the hover card use, and for the most recently used tabs a larger one for the page. */
export type TabPicture={small?:string;large?:string};
export type Look={small?:string;large?:string;state:'picture'|'sleeping'|'loading'|'private';audio:boolean;privacy?:'private'|'tor';color?:string};

/** The sample's lookOf, from the real tab and what main has. A tab asleep keeps its last picture, dimmed; a private or Tor tab never has one; a tab with no picture yet (never shown, loading,
 * nothing kept) shows its icon on a soft tile of its colour. */
export function lookOf(tab:TabSession,picture:TabPicture|undefined):Look{
 const privacy=shownPrivacy(tab),audio=!!tab.audible;
 if(privacy)return {state:'private',audio,privacy};
 const color=tab.siteColor,shown=picture?.small||picture?.large;
 if(!shown&&tabShowsLoading(tab))return {state:'loading',audio,color};
 if(tab.sleeping)return shown?{state:'sleeping',small:picture!.small,large:picture!.large,audio,color}:{state:'loading',audio,color};
 return shown?{state:'picture',small:picture!.small,large:picture!.large,audio,color}:{state:'loading',audio,color};
}

/** The page picture, or what stands in for it. Never a blank box: no picture = the site icon on a soft tile of its colour. */
function Picture({tab,look,size,state,src}:{tab:TabSession;look:Look;size:number;state:BrowserSnapshot;src?:string}){
 const tile={'--sw-tile':look.color||'rgb(var(--ink))'} as CSSProperties;
 return <span className="sw-pic" data-state={look.state} style={tile}>
  {src&&<img className="sw-pic-image" src={src} alt="" draggable={false}/>}
  {look.state==='loading'&&<span className="sw-pic-icon">{tabShowsLoading(tab)?<DotMatrix preset="loader" size={Math.round(size*.6)} reducedMotion={state.settings.reducedMotion}/>:<SiteIdentityIcon url={tab.url} favicon={tab.favicon} size={size} error={!!tab.error}/>}</span>}
  {look.state==='private'&&<span className="sw-pic-icon sw-private"><SiteIdentityIcon url={tab.url} favicon={tab.favicon} size={size} privacy={look.privacy} className="sw-private-icon"/><span className="sw-private-word">{look.privacy==='tor'?t("tabprivacymark.torTab"):t("pvt.title")}</span></span>}
  {look.state==='sleeping'&&<span className="sw-moon" aria-hidden="true"><svg viewBox="0 0 16 16" width="12" height="12"><path d="M10.6 2.2a6 6 0 1 0 3.2 9.4A5.2 5.2 0 0 1 10.6 2.2Z" fill="currentColor"/></svg></span>}
  {look.audio&&<span className="sw-audio"><TabSoundMeter reducedMotion={state.settings.reducedMotion}/></span>}
 </span>;
}

/** The site's colour: its brand colour when main has one, else the colour of its icon (as the sidebar's tab glow). */
function ColorProbe({tab,on}:{tab:TabSession;on:(id:string,color:string|undefined)=>void}){
 const icon=useSiteIconColor(tab.url,tab.favicon,!shownPrivacy(tab)&&!tab.error,!!tab.error);
 const color=tab.siteColor||icon;
 useLayoutEffect(()=>{on(tab.id,color);},[color]);// eslint-disable-line react-hooks/exhaustive-deps
 return null;
}

/** Masks the pop-up's glass to the shapes of the [data-r3-glass] elements (rounded rectangles), so the glass is only there. */
function useGlassShapes(root:React.RefObject<HTMLDivElement|null>,theme:string,deps:unknown[]){
 useLayoutEffect(()=>{
  const el=root.current,surface=el?.closest<HTMLElement>('.acira-popup-surface');if(!el||!surface)return;
  // The glass layer (.popup-sheet-material) is larger than the surface (24 px all round): the mask is drawn in its own box.
  // Painted rects are divided by the current scale, since the surface is scaled while it arrives.
  const apply=()=>{const mat=surface.querySelector<HTMLElement>('.popup-sheet-material');if(!mat)return;
   const m=mat.getBoundingClientRect(),k=m.width/(mat.offsetWidth||1)||1,W=mat.offsetWidth,H=mat.offsetHeight;
   const rects=[...el.querySelectorAll<HTMLElement>('[data-r3-glass]')].map(node=>{const r=node.getBoundingClientRect(),rad=parseFloat(getComputedStyle(node).borderTopLeftRadius)||0;
    return `<rect x='${((r.left-m.left)/k).toFixed(2)}' y='${((r.top-m.top)/k).toFixed(2)}' width='${node.offsetWidth}' height='${node.offsetHeight}' rx='${rad}'/>`;}).join('');
   const svg=`<svg xmlns='http://www.w3.org/2000/svg' width='${W}' height='${H}' viewBox='0 0 ${W} ${H}'>${rects}</svg>`;
   surface.style.setProperty('--r3-mask',`url("data:image/svg+xml,${encodeURIComponent(svg)}")`);surface.setAttribute('data-r3',theme);};
  apply();const observer=new ResizeObserver(apply);observer.observe(el);
  return()=>{observer.disconnect();surface.removeAttribute('data-r3');surface.removeAttribute('data-r3-leaving');surface.style.removeProperty('--r3-mask');};
 },deps);// eslint-disable-line react-hooks/exhaustive-deps
}

const {RUN_MS,SINGLE_FADE,RUN_FADE}=MOTION;
type Layer={key:number;at:number;dur:number;done?:boolean};

/** The preview's layers, driven straight from the index (no waiting). */
function useStage(index:number){
 const [layers,setLayers]=useState<Layer[]>([{key:0,at:index,dur:0,done:true}]);
 const seq=useRef(0),last=useRef(0);
 useLayoutEffect(()=>{
  if(layers[layers.length-1].at===index)return;
  const now=performance.now(),dur=now-last.current<RUN_MS?RUN_FADE:SINGLE_FADE;last.current=now;const key=++seq.current;
  // the layer that was fading in is finished at once (drawn fully) and becomes the one beneath; older ones go
  setLayers(list=>[{...list[list.length-1],done:true},{key,at:index,dur}]);
  const id=window.setTimeout(()=>setLayers(list=>list[list.length-1].key===key?[{...list[list.length-1],done:true}]:list),dur+30);
  return()=>window.clearTimeout(id);
 },[index]);// eslint-disable-line react-hooks/exhaustive-deps
 useLayoutEffect(()=>{last.current=performance.now()-RUN_MS;},[]);
 return layers;
}

/** The pictures main keeps for the tabs around the one on screen, asked for as the row moves (a window of tabs, never all of them), and the current tab's own, which main takes as the viewer
 * is asked for and sends when it lands. Nothing is ever captured for the viewer while the person steps (main decides). */
function usePictures(order:readonly string[],index:number,first:number,n:number,activeTabId:string){
 const [pictures,setPictures]=useState<Record<string,TabPicture>>({});
 const asked=useRef(new Set<string>());
 // the row's visible items, the lit one and a row's width more each way, so an item that scrolls in already has its picture (the entering item is part-way through the edge fade, never blank)
 const low=Math.max(0,Math.min(first,index)-n-1),high=Math.min(order.length-1,Math.max(first+n,index)+n+1);
 const wanted=order.slice(low,high+1).filter(id=>!asked.current.has(id));
 const key=wanted.join(' ');
 useEffect(()=>{
  if(!wanted.length)return;
  const ids=wanted.slice(0,16);ids.forEach(id=>asked.current.add(id));
  void Promise.resolve(runtime.browserCommand({type:'tab-pictures',tabId:activeTabId,ids})).then(answer=>{
   const got=(answer as {pictures?:Record<string,TabPicture>}|undefined)?.pictures;
   if(got)setPictures(prev=>({...prev,...got}));
  }).catch(()=>{ids.forEach(id=>asked.current.delete(id));});
 },[key]);// eslint-disable-line react-hooks/exhaustive-deps
 useEffect(()=>{const off=runtime.subscribeBrowser?.(raw=>{const event=raw as unknown as {type:string;tabId?:string;picture?:TabPicture};
  if(event.type==='tab-picture'&&event.tabId&&event.picture){const id=event.tabId,picture=event.picture;setPictures(prev=>({...prev,[id]:picture}));}});return()=>{off?.();};},[]);
 return pictures;
}

export function PictureSwitcher({tabs,index,state,hover,pick}:{tabs:TabSession[];index:number;state:BrowserSnapshot;hover:(at:number)=>void;pick:(at:number)=>void}){
 const dark=state.settings.appearance==='dark'||(state.settings.appearance!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches);
 const L=r4Layout(tabs.length,{width:window.innerWidth,height:window.innerHeight});
 const root=useRef<HTMLDivElement>(null),pointer=useRef(newPointerMemory());
 const [colors,setColors]=useState<Record<string,string|undefined>>({});
 const onColor=(id:string,color:string|undefined)=>setColors(prev=>prev[id]===color?prev:{...prev,[id]:color});
 const [first,setFirst]=useState(()=>firstVisible(index,L.n,tabs.length));
 const pictures=usePictures(useMemo(()=>tabs.map(tab=>tab.id),[tabs]),index,first,L.n,state.activeTabId);
 const looks=useMemo(()=>tabs.map(tab=>{const look=lookOf(tab,pictures[tab.id]);return look.state==='private'?look:{...look,color:colors[tab.id]||look.color};}),[tabs,colors,pictures]);
 const probes=tabs.map(tab=><ColorProbe key={'c'+tab.id} tab={tab} on={onColor}/>);
 useGlassShapes(root,dark?'dark':'light',[L.width,L.height,dark]);
 // the item just left (fading out); anything left before it has no state and snaps off
 const [left,setLeft]=useState<number|null>(null);
 const prev=useRef(index);
 useLayoutEffect(()=>{if(prev.current!==index){setLeft(prev.current);prev.current=index;}},[index]);
 const layers=useStage(index);
 // the row keeps the current picture fully in view with one neighbour showing ahead of it when there is one, so the item being scrolled in is never the current one
 useLayoutEffect(()=>{setFirst(f=>rowFirst(f,index,L.n,tabs.length));},[index,L.n]);// eslint-disable-line react-hooks/exhaustive-deps
 const step=R4.thumb[0]+R4.gap,more={s:first>0,e:first+L.n<tabs.length},rtl=document.documentElement.dir==='rtl';
 const dpr=window.devicePixelRatio||1;
 const icon=(tab:TabSession,size:number)=>tabShowsLoading(tab)?<DotMatrix preset="loader" size={size-2} reducedMotion={state.settings.reducedMotion}/>:<SiteIdentityIcon url={tab.url} favicon={tab.favicon} size={size} privacy={shownPrivacy(tab)} error={!!tab.error}/>;
 const site=(tab:TabSession)=>tab.id===state.activeTabId?t("browsersettings.current")+' · '+host(tab.url):host(tab.url);
 const layered=(cls:string,render:(tab:TabSession,look:Look,at:number)=>ReactNode)=>layers.map((layer,k)=>{const tab=tabs[layer.at],look=looks[layer.at];if(!tab||!look)return null;
  const top=k===layers.length-1;
  return <div key={layer.key} className={cls} data-top={(top&&!layer.done)||undefined} data-under={!top||undefined} style={{'--r4-dur':layer.dur+'ms'} as CSSProperties}>{render(tab,look,layer.at)}</div>;});
 return <div ref={root} className="r3 r4" data-take="r3a" data-theme={dark?'dark':'light'} style={{width:L.width,'--r4-hair':(1/dpr)+'px','--r4-line':(1/dpr)+'px'} as CSSProperties}>
  {probes}
  <section className="r3-glass r3-upper" data-r3-glass style={{width:L.upperW}}>
   <div className="r3-preview" style={{width:L.prevW,height:L.prevH}}>{layered('r3-layer r4-layer',(tab,look)=><Picture tab={tab} look={look} size={48} state={state} src={look.large||look.small}/>)}</div>
   <div className="r3-name-slot">{layered('r3-layer r4-layer r4-name-layer',(tab,_look,at)=><div className="r3-name">
    <span className="r3-name-icon">{icon(tab,20)}</span>
    <span className="r3-name-text"><span className="r3-title">{titleOf(tab)}</span><span className="r3-site">{site(tab)}</span></span>
    <span className="r3-count">{t("tabswitcher.nOfTotal",{n:at+1,total:tabs.length})}</span></div>)}</div>
  </section>
  <section className="r3-glass r3-lower r4-dock" data-r3-glass style={{width:L.lowerW}}>
   <div className="r3-row r4-row" style={{width:L.rowW}} data-more-s={(rtl?more.e:more.s)||undefined} data-more-e={(rtl?more.s:more.e)||undefined}>
    <div className="r3-track" style={{transform:`translateX(${(rtl?1:-1)*first*step}px)`,justifyContent:tabs.length<L.n?'center':undefined,width:tabs.length<L.n?'100%':undefined}}>
     {tabs.map((tab,at)=>{const look=looks[at],color=look.state==='private'?undefined:legible(look.color,dark);
      return <div key={tab.id} className="r3-item" role="option" aria-selected={at===index} aria-label={titleOf(tab)} data-index={at} onPointerMove={event=>{if(pointerMoved(pointer.current,event))hover(at);}} onClick={()=>pick(at)}
       style={{'--sw-c':color||'var(--accent,#6f8cff)'} as CSSProperties}>
       <span className="r3-thumb r4-thumb" data-on={at===index||undefined} data-leaving={(at===left&&at!==index)||undefined}>
        <span className="r4-halo" aria-hidden="true"/>
        <Picture tab={tab} look={look} size={24} state={state} src={look.small||look.large}/>
        <span className="r4-lines" aria-hidden="true"/>
       </span>
       <span className="r3-item-icon">{icon(tab,14)}</span>
      </div>;})}
    </div>
   </div>
  </section>
 </div>;
}
