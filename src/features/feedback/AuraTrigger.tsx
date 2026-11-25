import {useEffect} from 'react';
import type {BrowserSnapshot} from '../../runtime/types';
import {effectiveView,hideToolbarOn} from '../../runtime/windowView';
import {feedbackCall,useFeedbackView} from '../../runtime/feedback';
import {auraRingRank,measureAuraAnchor} from '../../ui/auraAnchor';
import {auraWaitsForWindow} from '../../ui/auraRetry';

/** "#rrggbb" for a CSS colour string as the browser resolves it (rgb(), or color(srgb …) for a mixed colour), else ''. */
function hexOf(value:string):string{
 const match=/^(?:rgba?|color)\(\s*(?:srgb\s+)?([\d.\s,/%-]+)\)$/i.exec(value.trim());
 if(!match)return '';
 const parts=match[1].split(/[\s,/]+/).filter(Boolean).slice(0,3).map(Number);
 if(parts.length<3||parts.some(item=>!Number.isFinite(item)))return '';
 const scale=/^color\(/i.test(value.trim())?255:1;
 return '#'+parts.map(item=>Math.max(0,Math.min(255,Math.round(item*scale))).toString(16).padStart(2,'0')).join('');
}
/** The rank's ring colour, as the interface draws it: its own variable when set (the four colours are OPEN), else the accent. */
export function ringColor(rank:string|null):string{
 if(!rank)return '';
 try{
  const root=document.querySelector('.app')||document.documentElement,own=getComputedStyle(root).getPropertyValue('--acira-rank-ring-'+rank).trim();
  const probe=document.createElement('span');probe.style.color=own||'var(--accent)';(document.querySelector('.app')||document.body).append(probe);
  const color=hexOf(getComputedStyle(probe).color);probe.remove();return color;
 }catch{return '';}
}

/** What main needs to know about the profile picture, as the request carries it. `visible`: the picture is on screen now (a hidden toolbar has none: the remembered place stands in for it). */
export function followRequest(anchor:{visible:boolean;avatar:{x:number;y:number;width:number;height:number};toolbarBottom:number|null;scale:number;size:{width:number;height:number}}){
 return {type:'feedback.aura-follow' as const,visible:anchor.visible,anchor:anchor.visible?{avatar:anchor.avatar,toolbarBottom:anchor.toolbarBottom,scale:anchor.scale,size:anchor.size}:null};
}
const round=(value:number)=>Math.round(value*4)/4;
/** A string that changes when, and only when, the picture moves (a quarter of a DIP) or its toolbar comes or goes. */
const placeKey=(anchor:{visible:boolean;avatar:{x:number;y:number;width:number;height:number};size:{width:number;height:number}})=>anchor.visible?[1,round(anchor.avatar.x),round(anchor.avatar.y),round(anchor.avatar.width),anchor.size.width,anchor.size.height].join(','):'0';

/** Beta 14: when this profile is owed an aura (a new mark or rank), the window's interface measures where its profile picture is and asks main to play it. Main decides whether it may play
 * (focused, nothing open, not private, not sharing, …); when it may not, this asks again at the next chance (the window gaining focus, a few seconds on). It draws nothing itself.
 * While one plays it tells main, every frame, where the picture is and whether its toolbar is showing (Seamless's hidden toolbar has no picture): the toolbar revealed (or hidden again) ends the aura
 * with the same draw-back as every other ending, and the layer follows a picture that moves, so the draw-back always closes on the picture itself. */
export function AuraTrigger({state}:{state:BrowserSnapshot}){
 const isWindow=!new URLSearchParams(location.search).get('view');
 const view=useFeedbackView(isWindow?'aura':null),owed=isWindow?view.aura:null;
 const windowView=effectiveView(state.settings,state.windowUi),hideable=windowView==='seamless'||hideToolbarOn(state.settings,windowView)||state.settings.verticalTabs===true,scale=state.settings.interfaceScale;
 /* The place the picture will come back to is learned while the toolbar is showing, not only when an aura asks: a Seamless window whose toolbar has hidden since it opened still knows where its button is. */
 useEffect(()=>{
  if(!isWindow)return;
  const scaleNow=Number(scale)||100;let frame=0;
  const learn=()=>{frame=0;measureAuraAnchor(scaleNow);};
  const soon=()=>{if(!frame)frame=requestAnimationFrame(learn);};
  learn();
  const shell=document.querySelector('.browser-shell'),observer=typeof ResizeObserver==='function'&&shell?new ResizeObserver(soon):null;
  observer?.observe(shell as Element);window.addEventListener('resize',soon);
  return()=>{observer?.disconnect();window.removeEventListener('resize',soon);if(frame)cancelAnimationFrame(frame);};
 },[isWindow,scale,windowView,state.activeTabId]);
 useEffect(()=>{
  if(!owed)return;
  /* 14.4 (battery): `waiting` after main said no because the window is not active: no timed retries until main says it is (ui/auraRetry.ts) */
  let stopped=false,busy=false,waiting=false;
  const attempt=async()=>{
   if(stopped||busy||waiting||document.visibilityState!=='visible')return;
   /* The new-tab page shows this aura as a tip under its profile picture (newtab/AuraTip.tsx, the team's notes 17 Nov, A4): the layer stands down while that tip is up, and the tip tells main when it is done. */
   if(document.querySelector('.nt-aura-tip'))return;
   busy=true;
   let watch=0,last='';
   try{
    const anchor=measureAuraAnchor(Number(scale)||100);
    if(!anchor)return;
    const rank=owed.startsWith('rank:')?owed.slice(5):null,dark=document.querySelector('.app')?.getAttribute('data-theme')!=='light';
    // A window whose picture can be away (Seamless or a hidden toolbar, a sidebar that can float away or be closed) and has it away right now rests where the picture will come back; any other window always has it.
    const visible=anchor.visible||!hideable;
    last=placeKey(anchor);
    const follow=()=>{const now=measureAuraAnchor(Number(scale)||100);if(!now)return;const here={...now,visible:now.visible||!hideable},key=placeKey(here);if(key===last)return;last=key;void feedbackCall(followRequest(here)).catch(()=>{});};
    // The ring this aura closes as shows up on the picture (the interface heard the aura is done and drew it): tell main once it has been painted, so the layer's own identical ring over it fades only then.
    let ringTold=false;
    const ringCheck=()=>{if(ringTold||!rank||auraRingRank()!==rank)return;ringTold=true;requestAnimationFrame(()=>requestAnimationFrame(()=>{void feedbackCall({type:'feedback.aura-ring-up'}).catch(()=>{});}));};
    const tick=()=>{follow();ringCheck();};
    watch=window.setInterval(tick,16);
    const frame=()=>{tick();if(watch)raf=requestAnimationFrame(frame);};let raf=requestAnimationFrame(frame);
    const clear=()=>{if(watch){clearInterval(watch);watch=0;}cancelAnimationFrame(raf);};
    try{
     const answer=await feedbackCall({type:'feedback.aura-play',anchor:{avatar:anchor.avatar,toolbarBottom:anchor.toolbarBottom,scale:anchor.scale,size:anchor.size},color:ringColor(rank),appearance:dark?'dark':'light',seamless:hideable&&!visible,hideable,buttonVisible:visible});
     waiting=answer.played!==true&&auraWaitsForWindow(answer.reasons,document.documentElement.getAttribute('data-window-active'));
    }finally{clear();}
   }catch{/* main said no, or the window is closing: the next chance */}finally{busy=false;}
  };
  const first=setTimeout(()=>void attempt(),1800),timer=setInterval(()=>void attempt(),4000),focus=()=>{waiting=false;setTimeout(()=>void attempt(),600);};
  window.addEventListener('focus',focus);
  const activeWatch=typeof MutationObserver==='function'?new MutationObserver(()=>{if(waiting&&document.documentElement.getAttribute('data-window-active')!=='false')focus();}):null;
  activeWatch?.observe(document.documentElement,{attributes:true,attributeFilter:['data-window-active']});
  return()=>{stopped=true;clearTimeout(first);clearInterval(timer);window.removeEventListener('focus',focus);activeWatch?.disconnect();};
 },[owed,hideable,scale,state.activeTabId]);
 return null;
}
