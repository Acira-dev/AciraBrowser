import {useEffect,useRef,useState,type CSSProperties} from 'react';
import {CARD_MARGIN,NO_NUMBER,type MemberRank} from './cardData';
import type {CardHandle} from './renderer/index';
import {followPointer} from '../../ui/pointerTilt';
import './member-card.css';

export interface MemberCardProps{
 rank:MemberRank;name:string;/** "Nov 2026" (formatSince) */since:string;/** four digits with leading zeros (formatCardNumber), or null while none is assigned */number:string|null;
 /** The card turns with the pointer (the shimmer). Off: a still card, drawn once. Reduce motion always means a still card. */interactive?:boolean;
 /** The card's width in CSS px (its height is 1.5 times that). Default 320. */width?:number;className?:string;
 /** Called once the card is drawn (the first picture is ready) or could not be (no WebGL). */onReady?:(ok:boolean)=>void;
 /** Receives the live card (its flat picture for sharing) once drawn, and null when it goes away. */onCard?:(card:CardHandle|null)=>void;
}
const reducedMotion=(element:Element|null)=>!!(typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches)||!!element?.closest('[data-reduced-motion="true"]');
const TAU_MS=90;

/** One member card (Beta 14): his scene drawn by ./renderer (three.js, loaded when the first card is shown). It turns a few degrees with the pointer while the light stays fixed in the room;
 * text stays flat. Until it is drawn the card's colour stands in for it, so nothing jumps. */
export function MemberCard({rank,name,since,number,interactive=false,width=320,className,onReady,onCard}:MemberCardProps){
 const host=useRef<HTMLSpanElement>(null),canvas=useRef<HTMLCanvasElement>(null);
 const [state,setState]=useState<'loading'|'ready'|'failed'>('loading');
 const callbacks=useRef({onReady,onCard});callbacks.current={onReady,onCard};
 const shown=number??NO_NUMBER;
 useEffect(()=>{
  const hostEl=host.current,canvasEl=canvas.current;if(!hostEl||!canvasEl)return;
  let dead=false,card:CardHandle|null=null,frame=0,last=0,observer:ResizeObserver|null=null;
  const cur={x:0,y:0},aim={x:0,y:0};let mod:typeof import('./renderer/index')|null=null;
  const dpr=()=>Math.min(2,window.devicePixelRatio||1);
  const fit=()=>{if(!card)return;const box=hostEl.getBoundingClientRect();if(!box.width)return;card.resize(box.width*CARD_MARGIN*dpr(),box.height*CARD_MARGIN*dpr());paint();};
  const paint=()=>{if(card&&mod)card.draw(mod.tiltPose(cur.x,cur.y),{margin:CARD_MARGIN});};
  const tick=(time:number)=>{
   frame=0;const dt=last?Math.min(64,time-last):16;last=time;const k=1-Math.exp(-dt/TAU_MS);
   cur.x+=(aim.x-cur.x)*k;cur.y+=(aim.y-cur.y)*k;
   const away=Math.abs(aim.x-cur.x)+Math.abs(aim.y-cur.y);if(away<.002){cur.x=aim.x;cur.y=aim.y;last=0;}
   paint();if(away>=.002)frame=requestAnimationFrame(tick);
  };
  const wake=()=>{if(!frame&&!document.hidden)frame=requestAnimationFrame(tick);};
  /* The pointer anywhere over the page aims the card (reported 17 Nov): measured from the card's centre in half-card widths and heights, as it always was over the card, and held at the card's own largest turn (+-1)
     beyond it. Leaving the window lets it ease back to rest. Reduced motion and Off keep the still card: no listener acts there. */
  const move=(x:number,y:number)=>{
   if(!card||reducedMotion(hostEl))return;const box=hostEl.getBoundingClientRect();
   aim.x=Math.max(-1,Math.min(1,((x-box.left)/box.width-.5)*2));aim.y=Math.max(-1,Math.min(1,((y-box.top)/box.height-.5)*2));wake();
  };
  const leave=()=>{aim.x=0;aim.y=0;wake();};
  let stopFollow:(()=>void)|null=null;
  void (async()=>{
   try{
    /* the popup paints and takes the keyboard first (its Escape works from the first frame); drawing the card keeps the thread busy for a while */
    await new Promise<void>(resolve=>{const timer=setTimeout(resolve,150);requestAnimationFrame(()=>requestAnimationFrame(()=>{clearTimeout(timer);resolve();}));});if(dead)return;
    mod=await import('./renderer/index');if(dead)return;
    const made=await mod.createMemberCard(canvasEl,{rank,name,since,number:shown});
    if(dead){made.dispose();return;}
    card=made;fit();observer=new ResizeObserver(fit);observer.observe(hostEl);
    if(interactive)stopFollow=followPointer({aim:move,rest:leave});
    setState('ready');callbacks.current.onReady?.(true);callbacks.current.onCard?.(card);
   }catch(error){if(dead)return;console.warn('member card',error);setState('failed');callbacks.current.onReady?.(false);}
  })();
  return()=>{dead=true;if(frame)cancelAnimationFrame(frame);observer?.disconnect();stopFollow?.();stopFollow=null;callbacks.current.onCard?.(null);card?.dispose();card=null;};
 },[rank,name,since,shown,interactive]);
 return <span ref={host} className={`mc${className?` ${className}`:''}`} data-rank={rank} data-state={state} style={{'--mc-w':`${width}px`} as CSSProperties} role="img" aria-label={`${name}, ${rank}, ${since}${number?`, ${number}`:''}`}>
  <span className="mc-still" aria-hidden="true"/><canvas key={`${rank}|${name}|${since}|${shown}|${interactive}`} ref={canvas} className="mc-canvas" aria-hidden="true"/>
 </span>;
}
