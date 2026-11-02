import test from 'node:test';
import assert from 'node:assert/strict';
import {placeTooltip,tooltipWidthLimit,type TooltipRect} from '../src/ui/tooltipPlacement';
const viewport={width:1280,height:720},page={left:240,right:1274,top:36,bottom:714},mac={left:0,right:86,top:0,bottom:32};
const favorite={left:12,right:80,top:40,bottom:80};
const box=(p:{x:number;y:number},w:number)=>({left:p.x-w/2,right:p.x+w/2,top:p.y-12,bottom:p.y+12});
const intersects=(a:TooltipRect,b:TooltipRect)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
test('long sidebar addresses fit below the Favorite, away from both native page and Mac buttons',()=>{
 const width=tooltipWidthLimit(favorite,page,viewport.width);assert.equal(width,224);
 const p=placeTooltip(favorite,width,viewport,page,mac);assert(p);assert.equal(p.side,'below');const b=box(p,width);assert.equal(b.left,8);assert.equal(b.right,232);assert(!intersects(b,page));assert(!intersects(b,mac));
});
test('small sidebar and 150-percent interface geometry keep eight-pixel gutters',()=>{
 const scale=1.5,v={width:1280/scale,height:720/scale},native={left:0,right:86/scale,top:0,bottom:32/scale},content={left:240,right:v.width,top:36,bottom:v.height-6};
 const target={left:12,right:80,top:32/scale+8,bottom:32/scale+48};const w=tooltipWidthLimit(target,content,v.width),p=placeTooltip(target,w,v,content,native);assert(p);assert(!intersects(box(p,w),native));assert(!intersects(box(p,w),content));assert(box(p,w).bottom<=v.height-8);
});
test('viewport-constrained width is also used when no native page is present',()=>{
 const width=tooltipWidthLimit(favorite,null,180);assert.equal(width,164);const p=placeTooltip(favorite,width,{width:180,height:320},null,mac);assert(p);assert(box(p,width).left>=8);assert(box(p,width).right<=172);
});
test('a bottom-edge sidebar control places its title above, within the viewport',()=>{
 const target={left:12,right:40,top:678,bottom:706},w=tooltipWidthLimit(target,page,1280),p=placeTooltip(target,w,viewport,page,mac);assert(p);assert.equal(p.side,'above');assert(box(p,w).bottom<target.top);
});
test('toolbar titles avoid Windows caption controls without treating zero caption width as138',()=>{
 const target={left:1100,right:1128,top:4,bottom:32},caption={left:1142,right:1280,top:0,bottom:40};const p=placeTooltip(target,110,viewport,null,caption);assert(p);assert(!intersects(box(p,110),caption));
 const noCaption={left:1280,right:1280,top:0,bottom:40};const free=placeTooltip({left:1230,right:1258,top:4,bottom:32},80,viewport,null,noCaption);assert(free);assert(box(free,80).right<=1272);
});
test('fully covered or too-small chrome declines a custom tooltip for the native fallback',()=>{
 assert.equal(placeTooltip(favorite,224,viewport,{left:0,right:1280,top:0,bottom:720},mac),null);
 assert.equal(placeTooltip(favorite,164,{width:180,height:24},null,mac),null);
});
