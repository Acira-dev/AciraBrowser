/*! @license MIT Copyright (c) 2026 Peter Lee. Optical response adaptation; full notice in LICENSE.iphone-solo.txt and distribution notices. */
/** One elapsed-time controller. Original Acira Formation supplies the timing/profile.
 * Offset blur/alpha response: peteropensource/iPhone-Solo, MIT, pinned2e708f72bbf5.
 * Source: peteropensource/iPhone-Solo at2e708f72bbf5. License: src/ui/LICENSE.iphone-solo.txt.
 */
export const formationProperties=['--sheet-progress','--foreground-progress','--formation-opacity','--formation-blur','--formation-scale','--material-mist-opacity','--material-mist-blur','--material-mist-scale',...Array.from({length:10},(_,i)=>`--formation-row-${i}`)];
export const clamp01=(x:number)=>Math.max(0,Math.min(1,x));
export function formationEase(x:number,curve:[number,number,number,number]=[.16,1,.3,1]){const[x1,y1,x2,y2]=curve;let t=clamp01(x);for(let i=0;i<8;i++){const a=1-t,v=3*x1*t*a*a+3*x2*t*t*a+t*t*t-x,d=3*x1*a*(1-3*t)+3*x2*t*(2-3*t)+3*t*t;if(Math.abs(v)<1e-6||!d)break;t=clamp01(t-v/d);}return 3*y1*t*(1-t)*(1-t)+3*y2*t*t*(1-t)+t*t*t;}
export type FormationPaint=Record<string,number>;
const mix=(a:number,b:number,p:number)=>a+(b-a)*p;
const mistSegment=(p:number,peak:number,from:number,middle:number,to:number)=>p<=peak?mix(from,middle,p/peak):mix(middle,to,(p-peak)/(1-peak));
export function formationFrames({start,closing,switching,reversing,duration,firstDelay,stagger,count,blur,enterScale,exitScale,exitBlur}:{start:FormationPaint;closing:boolean;switching:boolean;reversing:boolean;duration:number;firstDelay:number;stagger:number;count:number;blur:number;enterScale:number;exitScale:number;exitBlur:number}) {
 const fresh=!closing&&!reversing;
 const sceneChange=switching&&!reversing;
 const tail=fresh&&count?firstDelay+Math.min(count-1,9)*stagger:0,total=duration+tail;
 const continuing=fresh&&!sceneChange&&(start['--sheet-progress']??0)>0;
 const initial={...start};
 if(fresh){
  if(!continuing){initial['--material-mist-opacity']=0;initial['--material-mist-blur']=16;initial['--material-mist-scale']=1.045;}
  initial['--foreground-progress']=0;initial['--formation-opacity']=0;initial['--formation-blur']=blur;initial['--formation-scale']=enterScale;
  for(let i=0;i<10;i++)initial['--formation-row-'+i]=0;
 }
 if(sceneChange){initial['--sheet-progress']=1;initial['--material-mist-opacity']=0;initial['--material-mist-blur']=2;initial['--material-mist-scale']=1;}
 const mistStart={opacity:initial['--material-mist-opacity']??0,blur:initial['--material-mist-blur']??(closing?2:16),scale:initial['--material-mist-scale']??(closing?1:1.045)};
 // A new foreground scene can arrive before the material is formed. Continue
 // its remaining mist path from captured paint rather than replaying its peak.
 const mistPeak=closing?.35:continuing?(.32-(initial['--sheet-progress']??0))/Math.max(1e-9,1-(initial['--sheet-progress']??0)):.32;
 const curve:[number,number,number,number]=closing?[.4,0,.9,.6]:[.16,1,.3,1];
 const mistAt=(ease:number)=>{
  if(sceneChange)return{'--material-mist-opacity':0,'--material-mist-blur':2,'--material-mist-scale':1};
  if(continuing&&mistPeak<=0)return{'--material-mist-opacity':mix(mistStart.opacity,0,ease),'--material-mist-blur':mix(mistStart.blur,2,ease),'--material-mist-scale':mix(mistStart.scale,1,ease)};
  return{'--material-mist-opacity':mistSegment(ease,mistPeak,mistStart.opacity,closing?.75:.9,0),'--material-mist-blur':mistSegment(ease,mistPeak,mistStart.blur,closing?9:10,closing?16:2),'--material-mist-scale':mistSegment(ease,mistPeak,mistStart.scale,closing?1.015:1.02,closing?1.04:1)};
 };
 const frameAt=(time:number)=>{
  const t=clamp01(time/duration),ease=formationEase(t,curve),paint:FormationPaint={...mistAt(ease)};
  paint['--sheet-progress']=mix(initial['--sheet-progress']??0,closing?0:1,ease);
  paint['--foreground-progress']=mix(initial['--foreground-progress']??0,closing?0:1,ease);
  paint['--formation-blur']=mix(initial['--formation-blur']??blur,closing?exitBlur:0,ease);
  paint['--formation-scale']=mix(initial['--formation-scale']??enterScale,closing?exitScale:1,ease);
  paint['--formation-opacity']=mix(initial['--formation-opacity']??0,closing?0:1,closing?ease:formationEase(clamp01(time/(duration*.5)),[.2,.7,.2,1]));
  for(let i=0;i<10;i++){const key='--formation-row-'+i,p=fresh?formationEase(clamp01((time-firstDelay-i*stagger)/duration)):ease;paint[key]=closing?(initial[key]??1):mix(initial[key]??0,1,p);}
  return paint;
 };
 const serialize=(paint:FormationPaint)=>Object.fromEntries(Object.entries(paint).map(([key,value])=>[key,key==='--formation-blur'?value+'px':value]));
 const steps=Math.max(2,Math.ceil(total/12)),frames=Array.from({length:steps+1},(_,i)=>({offset:i/steps,...serialize(frameAt(total*i/steps))}));
 if(!sceneChange){
  const knots=[duration];
  if(mistPeak>0&&mistPeak<1){let lo=0,hi=1;for(let i=0;i<32;i++){const mid=(lo+hi)/2;if(formationEase(mid,curve)<mistPeak)lo=mid;else hi=mid;}knots.push((lo+hi)/2*duration);}
  for(const time of knots){const paint=frameAt(time);frames.push({offset:time/total,...Object.fromEntries(['--material-mist-opacity','--material-mist-blur','--material-mist-scale'].map(key=>[key,paint[key]]))});}
  frames.sort((a,b)=>a.offset-b.offset);
 }
 return{duration:total,frames,final:frameAt(total),serialize,at:frameAt};
}
