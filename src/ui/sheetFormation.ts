/** One elapsed-time controller for the Acira Formation. Material and foreground share the plane's
 * opacity, blur and scale; rows resolve after it on the same clock. There is no mask: the sheet
 * condenses out of its own blur from the anchor and evaporates back toward it. */
import {designTokens} from './designSystem';
// Founder, 24 Oct: the premium Formation is the point. The plane condenses in 200ms (centred panels 220ms), rows follow
// on an uncompressed ~11ms stagger, and the exit is faster and softer (130ms, back toward the trigger).
export const formationRows=10,formationOpenMs=Math.max(200,designTokens.motion.vapor),formationDialogMs=formationOpenMs+20,formationExitMs=130;
export const formationProperties=['--formation-opacity','--formation-blur','--formation-scale','--formation-y',...Array.from({length:formationRows},(_,i)=>`--formation-row-${i}`)];
export const clamp01=(x:number)=>Math.max(0,Math.min(1,x));
export function formationEase(x:number,curve:[number,number,number,number]=[.16,1,.3,1]){const[x1,y1,x2,y2]=curve;let t=clamp01(x);for(let i=0;i<8;i++){const a=1-t,v=3*x1*t*a*a+3*x2*t*t*a+t*t*t-x,d=3*x1*a*(1-3*t)+3*x2*t*(2-3*t)+3*t*t;if(Math.abs(v)<1e-6||!d)break;t=clamp01(t-v/d);}return 3*y1*t*(1-t)*(1-t)+3*y2*t*t*(1-t)+t*t*t;}
export type FormationPaint=Record<string,number>;
const mix=(a:number,b:number,p:number)=>a+(b-a)*p;
const openCurve:[number,number,number,number]=[.23,1,.32,1],fadeCurve:[number,number,number,number]=[.2,.7,.2,1],closeCurve:[number,number,number,number]=[.2,0,0,1],closeFade:[number,number,number,number]=[.2,0,0,1];
/** Lengths are painted in px; a resting sheet has no blur and no offset. */
export const lengthProperty=(key:string)=>key==='--formation-blur'||key==='--formation-y';
export const restingFormation:FormationPaint=Object.fromEntries(formationProperties.map(key=>[key,lengthProperty(key)?0:1]));

/** `enterOpacity` and `rowStart` let a fresh sheet open with its content already readable (founder, 25 Oct: menus open
 * at once; the material settles around the content); both default to 0, the full condensation. */
export interface FormationOptions{start:FormationPaint;closing:boolean;switching:boolean;reversing:boolean;/** Material readiness can re-run a sheet already on screen. */continuing?:boolean;reduced?:boolean;duration:number;firstDelay:number;stagger:number;count:number;blur:number;enterScale:number;exitScale:number;exitBlur:number;rise?:number;exitRise?:number;enterOpacity?:number;rowStart?:number;/** The scale/blur/rise progress over elapsed ms (0 → 1) in place of the fixed ease: the tab viewer rides its spring token (tabViewerMotion.ts). */curve?:(ms:number)=>number}
/** `start` is the painted frame (fresh opens ignore it). Fresh opens condense from blur; reversals and
 * scene switches continue from what is on screen, so rapid toggles never jump. */
export function formationFrames({start,closing,switching,reversing,continuing=false,reduced=false,duration,firstDelay,stagger,count,blur,enterScale,exitScale,exitBlur,rise=0,exitRise=0,enterOpacity=0,rowStart=0,curve}:FormationOptions) {
 const fresh=!closing&&!reversing&&!switching&&!continuing,rows=Math.min(formationRows,Math.max(0,count));
 const initial:FormationPaint={...restingFormation,...start};
 if(fresh){initial['--formation-opacity']=enterOpacity;initial['--formation-blur']=reduced?0:blur;initial['--formation-scale']=reduced?1:enterScale;initial['--formation-y']=reduced?0:rise;}
 if(fresh)for(let i=0;i<formationRows;i++)initial['--formation-row-'+i]=reduced?1:rowStart;
 if(switching&&!reversing)for(let i=0;i<formationRows;i++)initial['--formation-row-'+i]=reduced?1:0;
 // Rows follow the plane on their own short stagger (never compressed): the cascade is what reads as premium.
 const cascading=(fresh||switching&&!reversing)&&!reduced&&rows>0,spread=cascading&&rows>1?stagger:0;
 const rowDuration=duration*.7,cascade=cascading?firstDelay+(rows-1)*spread+rowDuration:0;
 const total=Math.max(duration,cascade);
 const target=closing?{opacity:0,blur:reduced?0:exitBlur,scale:reduced?1:exitScale,y:reduced?0:exitRise}:{opacity:1,blur:0,scale:1,y:0};
 const frameAt=(time:number)=>{
  // A zero-length plan (keyboard, reduced motion) is already at its end: it resolves to the target, never the start.
  const t=duration<=0?1:clamp01(time/duration),paint:FormationPaint={};
  const shape=reduced?t:curve&&duration>0?curve(Math.min(time,duration)):formationEase(t,closing?closeCurve:openCurve);
  // Opening: the glass is present early and soft; focus arrives on the slower blur/scale curve.
  const fade=reduced?t:closing?formationEase(t,closeFade):formationEase(duration<=0?1:clamp01(time/(duration*.45)),fadeCurve);
  paint['--formation-opacity']=mix(initial['--formation-opacity'],target.opacity,fade);
  paint['--formation-blur']=mix(initial['--formation-blur'],target.blur,shape);
  paint['--formation-scale']=mix(initial['--formation-scale'],target.scale,shape);
  paint['--formation-y']=mix(initial['--formation-y'],target.y,shape);
  for(let i=0;i<formationRows;i++){
   const key='--formation-row-'+i,from=initial[key];
   if(closing){paint[key]=from;continue;}
   const p=(fresh||switching&&!reversing)&&!reduced?formationEase(clamp01((time-firstDelay-Math.min(i,Math.max(0,rows-1))*spread)/rowDuration)):shape;
   paint[key]=mix(from,1,p);
  }
  return paint;
 };
 const serialize=(paint:FormationPaint)=>Object.fromEntries(Object.entries(paint).map(([key,value])=>[key,lengthProperty(key)?value+'px':String(value)]));
 const steps=Math.max(2,Math.ceil(total/12)),frames=Array.from({length:steps+1},(_,i)=>({offset:i/steps,...serialize(frameAt(total*i/steps))}));
 return{duration:total,frames,final:frameAt(total),serialize,at:frameAt};
}

/** Project the shared clock onto compositor properties. Registered custom
 * properties still run style work every frame, even when CSS uses them in a
 * transform. These keyframes animate the actual layers instead. */
// The approved signature condense (safety-c418), projected onto real layers: the scale progress p drives the glass
// (material) in from ~.68 while a pre-blurred mist (fixed 16px blur) shrinks and thins around it, so the frost is on
// screen from the input frame and thickens with the motion instead of switching on when it ends.
// glassFloor: keyboard and 100x/day panels (Alt+T, palette) open dense from the first frame - their material never reads as a
// lighter plate that darkens (founder, 26 Oct) - only the sheet's own short fade carries them in.
export function formationLayerPaint(paint:FormationPaint,glassFloor=0){
 const scale=paint['--formation-scale']??1,y=paint['--formation-y']??0;
 const p=clamp01((scale-.96)/.04),remaining=1-p,glass=Math.max(clamp01(glassFloor),clamp01(1.4*p-.2));
 return{
  plane:{opacity:paint['--formation-opacity']??1,transform:`translateY(${y}px) scale(${scale})`},
  material:{opacity:glass,transform:`scale(${.985+.015*glass})`},
  mist:{opacity:remaining*.9,transform:`scale(${1+remaining*.045})`},
 };
}
export function formationLayerFrames(plan:ReturnType<typeof formationFrames>,glassFloor=0){
 const steps=Math.max(2,Math.ceil(plan.duration/12));
 const frames=Array.from({length:steps+1},(_,i)=>({offset:i/steps,...formationLayerPaint(plan.at(plan.duration*i/steps),glassFloor)}));
 return{
  plane:frames.map(({offset,plane})=>({offset,...plane})),
  material:frames.map(({offset,material})=>({offset,...material})),
  mist:frames.map(({offset,mist})=>({offset,...mist})),
 };
}
