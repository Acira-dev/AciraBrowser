export interface TooltipRect { left:number; right:number; top:number; bottom:number }
export type TooltipSide='below'|'above'|'right'|'left';
const EDGE=8,GAP=8,HEIGHT=24;

/** A sidebar label must fit the chrome beside a native page, as well as the viewport. */
export function tooltipWidthLimit(trigger:TooltipRect,page:TooltipRect|null,viewportWidth:number):number{
 const sidebar=page&&trigger.right<=page.left&&trigger.bottom>page.top&&trigger.top<page.bottom;
 return Math.max(0,Math.min(320,viewportWidth-2*EDGE,sidebar?page.left-2*EDGE:Infinity));
}
const overlaps=(a:TooltipRect,b:TooltipRect)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;

/** Use the painted chip's dimensions; never let a label cover the native page or window buttons. */
export function placeTooltip(trigger:TooltipRect,width:number,viewport:{width:number;height:number},page:TooltipRect|null,caption:TooltipRect,height=HEIGHT,beside=false):{side:TooltipSide;x:number;y:number}|null{
 const {width:vw,height:vh}=viewport,h=height;
 const cx=Math.min(vw-EDGE-width/2,Math.max(EDGE+width/2,(trigger.left+trigger.right)/2));
 const cy=Math.min(vh-EDGE-h/2,Math.max(EDGE+h/2,(trigger.top+trigger.bottom)/2));
 const options:[TooltipSide,number,number][]=[['below',cx,trigger.bottom+GAP+h/2],['above',cx,trigger.top-GAP-h/2],['right',trigger.right+GAP+width/2,cy],['left',trigger.left-GAP-width/2,cy]];
 // A sidebar row's tip opens beside it, toward the page, so it never covers the rows under it.
 if(beside){const toward=(trigger.left+trigger.right)/2>vw/2?'left':'right';options.sort((a,b)=>+(b[0]===toward)-+(a[0]===toward)||+(['right','left'].includes(b[0]))-+(['right','left'].includes(a[0])));}
 const choice=options.find(([,x,y])=>{
  const box={left:x-width/2,right:x+width/2,top:y-h/2,bottom:y+h/2};
  return box.left>=EDGE-.5&&box.right<=vw-EDGE+.5&&box.top>=EDGE-.5&&box.bottom<=vh-EDGE+.5&&(!page||!overlaps(box,page))&&!overlaps(box,caption);
 });
 return choice?{side:choice[0],x:choice[1],y:choice[2]}:null;
}
