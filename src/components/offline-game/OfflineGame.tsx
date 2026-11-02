import { useEffect,useRef,useState,useSyncExternalStore } from 'react';
import './offline-game.css';import { t } from '../../i18n';

/** UF-026: a quiet game for the "No internet" page, drawn in Acira's dot-matrix language. Nothing moves until the
 * person presses Space; ↑/↓ (or W/S) steer a small ship between drifting dots; it pauses when the page is hidden or
 * loses focus; no network, no sound. Turned off in Settings › Accessibility › Offline game. */
const KEY='acira-offline-game',BEST='acira-offline-game-best',EVENT='acira-offline-game';
export const offlineGameEnabled=()=>{try{return localStorage.getItem(KEY)!=='off';}catch{return true;}};
export function setOfflineGameEnabled(on:boolean){try{localStorage.setItem(KEY,on?'on':'off');}catch{/* keeps the default */}window.dispatchEvent(new Event(EVENT));}
const subscribe=(listener:()=>void)=>{window.addEventListener(EVENT,listener);window.addEventListener('storage',listener);return()=>{window.removeEventListener(EVENT,listener);window.removeEventListener('storage',listener);};};
export const useOfflineGameEnabled=()=>useSyncExternalStore(subscribe,offlineGameEnabled);

const CELL=8,ROWS=13,SHIP=[[0,0],[0,1],[1,1],[2,1],[0,2]] as const,SHIP_COL=3;
type Phase='idle'|'playing'|'paused'|'over';
type Dot={col:number;row:number;size:1|2};
const readBest=()=>{try{return Number(localStorage.getItem(BEST))||0;}catch{return 0;}};
const typing=(target:EventTarget|null)=>target instanceof HTMLElement&&!!target.closest('input,textarea,select,button,a,summary,[contenteditable=true]');

export function OfflineGame({reducedMotion=false}:{reducedMotion?:boolean}){
 const enabled=useOfflineGameEnabled();
 const canvas=useRef<HTMLCanvasElement>(null),frame=useRef<HTMLDivElement>(null);
 const [phase,setPhase]=useState<Phase>('idle'),[score,setScore]=useState(0),[best,setBest]=useState(readBest);
 const game=useRef({row:6,dots:[] as Dot[],offset:0,speed:0,distance:0,spawn:0,last:0,cols:60,phase:'idle' as Phase});
 const raf=useRef(0);

 const draw=()=>{
  const node=canvas.current;if(!node)return;const ctx=node.getContext('2d');if(!ctx)return;
  const g=game.current,styles=getComputedStyle(node),ink=styles.getPropertyValue('--og-ink').trim()||'#888',accent=styles.getPropertyValue('--og-accent').trim()||'#3b6eea';
  const width=node.clientWidth,height=ROWS*CELL,ratio=window.devicePixelRatio||1;
  if(node.width!==Math.round(width*ratio)){node.width=Math.round(width*ratio);node.height=Math.round(height*ratio);}
  ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,width,height);g.cols=Math.floor(width/CELL);
  const dot=(col:number,row:number,color:string,alpha:number,r=1.4)=>{ctx.globalAlpha=alpha;ctx.fillStyle=color;ctx.beginPath();ctx.arc(col*CELL+CELL/2,row*CELL+CELL/2,r,0,Math.PI*2);ctx.fill();};
  // The resting field: a faint grid, the same 8px rhythm as the dot-matrix marks.
  for(let row=0;row<ROWS;row++)for(let col=0;col<g.cols;col++)dot(col,row,ink,.10,1);
  for(const item of g.dots){const x=item.col-g.offset;for(let dx=0;dx<item.size;dx++)for(let dy=0;dy<item.size;dy++)dot(x+dx,item.row+dy,ink,.72,1.7);}
  const crashed=g.phase==='over';
  for(const [dx,dy] of SHIP)dot(SHIP_COL+dx,g.row-1+dy,crashed?ink:accent,crashed?.45:1,1.9);
  ctx.globalAlpha=1;
 };
 const hits=()=>{const g=game.current;return g.dots.some(item=>SHIP.some(([dx,dy])=>{const col=SHIP_COL+dx,row=g.row-1+dy,x=Math.round(item.col-g.offset);return col>=x&&col<x+item.size&&row>=item.row&&row<item.row+item.size;}));};
 const tick=(time:number)=>{
  const g=game.current;if(g.phase!=='playing')return;
  const dt=Math.min(64,time-(g.last||time));g.last=time;
  g.speed=Math.min(reducedMotion?16:30,g.speed+dt*0.0006);g.offset+=g.speed*dt/1000;g.distance+=g.speed*dt/1000;
  g.spawn-=g.speed*dt/1000;
  if(g.spawn<=0){const size=Math.random()<.25?2:1;g.dots.push({col:g.offset+g.cols+1,row:Math.floor(Math.random()*(ROWS-size)),size});g.spawn=3+Math.random()*Math.max(2,9-g.speed/4);}
  g.dots=g.dots.filter(item=>item.col-g.offset>-3);
  setScore(Math.floor(g.distance/4));
  if(hits()){g.phase='over';setPhase('over');const final=Math.floor(g.distance/4);if(final>readBest()){try{localStorage.setItem(BEST,String(final));}catch{/* best stays in memory */}setBest(final);}draw();return;}
  draw();raf.current=requestAnimationFrame(tick);
 };
 const start=()=>{const g=game.current;Object.assign(g,{row:6,dots:[],offset:0,speed:reducedMotion?6:9,distance:0,spawn:6,last:0,phase:'playing'});setScore(0);setPhase('playing');frame.current?.focus({preventScroll:true});cancelAnimationFrame(raf.current);raf.current=requestAnimationFrame(tick);};
 const pause=()=>{const g=game.current;if(g.phase!=='playing')return;g.phase='paused';setPhase('paused');cancelAnimationFrame(raf.current);};
 const resume=()=>{const g=game.current;if(g.phase!=='paused')return;g.phase='playing';g.last=0;setPhase('playing');raf.current=requestAnimationFrame(tick);};

 useEffect(()=>{if(!enabled)return;draw();const resize=new ResizeObserver(()=>draw());if(canvas.current)resize.observe(canvas.current);return()=>resize.disconnect();},[enabled]);// eslint-disable-line react-hooks/exhaustive-deps
 useEffect(()=>{if(!enabled)return;
  const key=(event:KeyboardEvent)=>{
   const g=game.current,ours=frame.current?.contains(event.target as Node)||!typing(event.target);
   if(!ours||event.ctrlKey||event.metaKey||event.altKey)return;
   if(event.key===' '||event.code==='Space'){event.preventDefault();if(g.phase==='playing')pause();else if(g.phase==='paused')resume();else start();return;}
   if(g.phase!=='playing')return;
   if(['ArrowUp','w','W'].includes(event.key)){event.preventDefault();g.row=Math.max(1,g.row-1);draw();}
   else if(['ArrowDown','s','S'].includes(event.key)){event.preventDefault();g.row=Math.min(ROWS-2,g.row+1);draw();}
   else if(event.key==='Escape')pause();
  };
  const hidden=()=>{if(document.hidden)pause();};
  window.addEventListener('keydown',key);document.addEventListener('visibilitychange',hidden);window.addEventListener('blur',pause);
  return()=>{window.removeEventListener('keydown',key);document.removeEventListener('visibilitychange',hidden);window.removeEventListener('blur',pause);cancelAnimationFrame(raf.current);};
 },[enabled,reducedMotion]);// eslint-disable-line react-hooks/exhaustive-deps
 if(!enabled)return null;
 const status=phase==='idle'?'Space to play':phase==='paused'?'Paused · Space to resume':phase==='over'?`${score} · Space to play again`:`${score}`;
 return <section ref={frame} className="offline-game" tabIndex={0} aria-label={t("offlinegame.offlineGameStatusUpAnd", { status: status })} data-phase={phase} onPointerDown={()=>{if(game.current.phase!=='playing')start();}}>
  <canvas ref={canvas} className="offline-game-field" aria-hidden="true"/>
  <div className="offline-game-bar"><span>{status}</span>{best>0&&<span className="offline-game-best">{t("offlinegame.best", { score: best })}</span>}</div>
  <p className="sr-only" role="status" aria-live="polite">{phase==='over'?`Game over, ${score}.`:''}</p>
 </section>;
}
