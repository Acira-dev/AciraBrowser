/*! @license MIT Copyright (c) 2026 Peter Lee. Optical response adaptation; full notice in LICENSE.iphone-solo.txt and distribution notices. */
/** One elapsed-time controller. Original Acira Formation supplies the timing/profile.
 * Offset blur/alpha response: peteropensource/iPhone-Solo, MIT, pinned2e708f72bbf5.
 * Source: peteropensource/iPhone-Solo at2e708f72bbf5. License: src/ui/LICENSE.iphone-solo.txt.
 */
export const formationProperties=['--sheet-progress','--foreground-progress','--formation-opacity','--formation-blur','--formation-scale',...Array.from({length:10},(_,i)=>`--formation-row-${i}`)];
export const clamp01=(x:number)=>Math.max(0,Math.min(1,x));
export function formationEase(x:number,curve:[number,number,number,number]=[.16,1,.3,1]){const[x1,y1,x2,y2]=curve;let t=clamp01(x);for(let i=0;i<8;i++){const a=1-t,v=3*x1*t*a*a+3*x2*t*t*a+t*t*t-x,d=3*x1*a*(1-3*t)+3*x2*t*(2-3*t)+3*t*t;if(Math.abs(v)<1e-6||!d)break;t=clamp01(t-v/d);}return 3*y1*t*(1-t)*(1-t)+3*y2*t*t*(1-t)+t*t*t;}
export type FormationPaint=Record<string,number>;
const mix=(a:number,b:number,p:number)=>a+(b-a)*p;
export function formationFrames({start,closing,switching,reversing,duration,firstDelay,stagger,count,blur,enterScale,exitScale,exitBlur}:{start:FormationPaint;closing:boolean;switching:boolean;reversing:boolean;duration:number;firstDelay:number;stagger:number;count:number;blur:number;enterScale:number;exitScale:number;exitBlur:number}){
 const fresh=!closing&&!reversing,tail=fresh&&count?firstDelay+Math.min(count-1,9)*stagger:0,total=duration+tail;
 const initial={...start};if(fresh){initial['--foreground-progress']=0;initial['--formation-opacity']=0;initial['--formation-blur']=blur;initial['--formation-scale']=enterScale;for(let i=0;i<10;i++)initial[`--formation-row-${i}`]=0;}if(switching)initial['--sheet-progress']=1;
 const frameAt=(time:number)=>{const t=clamp01(time/duration),ease=formationEase(t,closing?[.4,0,.9,.6]:[.16,1,.3,1]),paint:FormationPaint={};paint['--sheet-progress']=mix(initial['--sheet-progress']??0,closing?0:1,ease);paint['--foreground-progress']=mix(initial['--foreground-progress']??0,closing?0:1,ease);paint['--formation-blur']=mix(initial['--formation-blur']??blur,closing?exitBlur:0,ease);paint['--formation-scale']=mix(initial['--formation-scale']??enterScale,closing?exitScale:1,ease);paint['--formation-opacity']=mix(initial['--formation-opacity']??0,closing?0:1,closing?ease:formationEase(clamp01(time/(duration*.5)),[.2,.7,.2,1]));for(let i=0;i<10;i++){const key=`--formation-row-${i}`,p=fresh?formationEase(clamp01((time-firstDelay-i*stagger)/duration)):ease;paint[key]=closing?(initial[key]??1):mix(initial[key]??0,1,p);}return paint;};
 const serialize=(paint:FormationPaint)=>Object.fromEntries(Object.entries(paint).map(([key,value])=>[key,key==='--formation-blur'?`${value}px`:value]));
 const steps=Math.max(2,Math.ceil(total/12)),frames=Array.from({length:steps+1},(_,i)=>({offset:i/steps,...serialize(frameAt(total*i/steps))}));return {duration:total,frames,final:frameAt(total),serialize,at:frameAt};
}
