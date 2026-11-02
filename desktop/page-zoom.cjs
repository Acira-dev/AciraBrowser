const levels=require('../page-zoom-levels.json');
const nextPageZoom=(current,direction)=>direction>0?(levels.find(value=>value>Math.round(current))||500):([...levels].reverse().find(value=>value<Math.round(current))||25);
const nearestPageZoom=value=>levels.reduce((best,level)=>Math.abs(Math.log(level/value))<Math.abs(Math.log(best/value))?level:best);
/** Zoom for Acira's own pages (Settings, History...), which are drawn in the interface: there is no website page for Chromium to
 * magnify or step. Websites never come here (Chromium handles their wheel and pinch). A wheel notch is one preset step. A pinch
 * delivers many small pixel deltas worth 100 x ln(scale): keep the fractional target between events and show the nearest
 * preset, so the gesture is as long as the fingers moved and never lands between Chromium's steps. */
function wheelPageZoom(current,input,state,now=Date.now()){
 if(typeof input==='number')return [-1,1].includes(input)?nextPageZoom(current,input):null;
 if(!input||!Number.isFinite(input.deltaY)||!input.deltaY||Math.abs(input.deltaY)>10000||![0,1,2].includes(input.deltaMode))return null;
 const {deltaY,deltaMode}=input;
 if(deltaMode!==0||Math.abs(deltaY)>=40){state.at=-Infinity;return nextPageZoom(current,deltaY<0?1:-1);}
 if(now-(state.at??-Infinity)>250||state.last!==current)state.target=current;
 state.at=now;
 state.target=Math.max(25,Math.min(500,state.target*Math.exp(-deltaY/100)));
 const zoom=nearestPageZoom(state.target);
 state.last=zoom;
 return zoom===current?null:zoom;
}
/** Ctrl+wheel over a website on a Mac, as the page preload reports each wheel (deltaY, deltaMode): the same running total as Acira's own
 * pages, so a trackpad stream (about 60 small events a second, then momentum) steps as far as the fingers moved and a mouse notch is one
 * step. A notch that follows another within 16 ms is dropped (an injected wheel can report its tick twice). `state` belongs to one tab. */
function websiteWheelZoom(current,input,state,now=Date.now()){
 if(!input||typeof input!=='object'||!Number.isFinite(input.deltaY))return null;
 // A page is told pixel deltas in its own CSS pixels (the device's divided by the page zoom: a 120 notch reads 24 at 500%), so the fingers' own
 // distance, and what counts as a notch, would change with the zoom; the device's distance is what is summed.
 const deltaY=input.deltaMode===0?input.deltaY*current/100:input.deltaY,notch=input.deltaMode!==0||Math.abs(deltaY)>=40;
 if(notch&&now-(state.notchAt??-Infinity)<16)return null;
 const zoom=wheelPageZoom(current,{deltaY,deltaMode:input.deltaMode},state,now);
 if(zoom!==null&&notch)state.notchAt=now;
 return zoom;
}
module.exports={nextPageZoom,wheelPageZoom,websiteWheelZoom};
