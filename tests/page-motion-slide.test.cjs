'use strict';
// The sidebar opening or closing (G, Round 2; R6): main glides the page card on the chrome's spring and, when the card's size
// follows the chrome, resizes the site's viewport on every frame (the frosted matte that hid one atomic resize is gone), the far
// edge never moving. A change that is not on the chrome's curve is committed whole, at once.
const test=require('node:test'),assert=require('node:assert/strict');
const {placePageBounds}=require('../desktop/page-motion.cjs');

function run(start,target,motion){
 let now=0,queued=null;const sizes=[],xs=[],bounds=[];
 const view={bounds:{...start},getBounds(){return {...this.bounds};},setBounds(next){this.bounds={...next};bounds.push({...next});xs.push(next.x);sizes.push(`${next.width}x${next.height}`);},webContents:{isDestroyed:()=>false}};
 const clock={now:()=>now,later:fn=>{queued=fn;return 1;},cancel:()=>{queued=null;}};
 placePageBounds({view},target,true,clock,1000/60,motion);
 for(let i=0;i<200&&queued;i++){now+=1000/60;const fn=queued;queued=null;fn();}
 return {view,sizes:[...new Set(sizes)],xs,bounds,frames:xs.length};
}

for(const [name,start,target] of [
 ['open sidebar',{x:0,y:36,width:1280,height:764},{x:240,y:36,width:1034,height:758}],
 ['close sidebar',{x:240,y:36,width:1034,height:758},{x:0,y:36,width:1280,height:764}],
]) test(`${name}, slide: the viewport follows the spring a frame at a time`,()=>{
 const {view,sizes,frames,bounds}=run(start,target,'slide');
 assert.ok(frames>20,'one viewport per display frame');
 assert.deepEqual(view.bounds,target);
 assert.ok(sizes.length>10,'the site lays out at many sizes on the way, not once');
 const right=[start.x+start.width,target.x+target.width].sort((a,b)=>a-b);
 assert.ok(bounds.every(b=>b.x+b.width>=right[0]&&b.x+b.width<=right[1]),'the far edge only moves between its two resting places (the docked card keeps a 6px inset)');
 assert.ok(bounds.every(b=>b.x+b.width<=1280&&b.y+b.height<=800),'The full viewport stays inside the window on every frame');
 const widths=bounds.map(b=>b.width);
 assert.ok(widths.every((w,i)=>i===0||(target.width<start.width?w<=widths[i-1]:w>=widths[i-1])),'the width moves one way only');
});
for(const [name,start,target] of [
 ['open sidebar',{x:0,y:36,width:1280,height:764},{x:240,y:36,width:1034,height:758}],
 ['toolbar or split ratio',{x:0,y:36,width:1280,height:764},{x:0,y:80,width:600,height:720}],
]) test(`${name}, ordinary: commit the complete viewport once, with no clipped intermediate bounds`,()=>{
 const motion=undefined;
 const {view,sizes,frames,bounds}=run(start,target,motion);
 assert.deepEqual(sizes,[`${target.width}x${target.height}`]);
 assert.deepEqual(view.bounds,target);
 assert.equal(frames,1);
 assert.ok(bounds.every(b=>b.x+b.width<=1280&&b.y+b.height<=800),'The full viewport stays inside the window on every frame');
});
test('a slide under way takes a later placement as its new end instead of snapping ahead of the chrome',()=>{
 let now=0,queued=null;const xs=[];
 const view={bounds:{x:240,y:36,width:1034,height:758},getBounds(){return {...this.bounds};},setBounds(next){this.bounds={...next};xs.push(next.x);},webContents:{isDestroyed:()=>false}};
 const clock={now:()=>now,later:fn=>{queued=fn;return 1;},cancel:()=>{queued=null;}},entry={view};
 placePageBounds(entry,{x:0,y:36,width:1034,height:758},true,clock,1000/60,'slide');
 for(let i=0;i<6;i++){now+=1000/60;const fn=queued;queued=null;fn?.();}
 const mid=view.bounds.x;placePageBounds(entry,{x:0,y:32,width:1034,height:758},false,clock,1000/60);
 assert.equal(view.bounds.x,mid,'the page stays on its way');assert.equal(view.bounds.height,758,'The unchanged viewport remains stable');
 for(let i=0;i<200&&queued;i++){now+=1000/60;const fn=queued;queued=null;fn();}
 assert.deepEqual(view.bounds,{x:0,y:32,width:1034,height:758});
});
test('a floating reveal with unchanged viewport keeps its smooth translation',()=>{
 const {view,sizes,xs}=run({x:0,y:36,width:1280,height:764},{x:240,y:36,width:1280,height:764},'slide');
 assert.deepEqual(sizes,['1280x764']);assert.ok(xs.length>20);
 assert.deepEqual(view.bounds,{x:240,y:36,width:1280,height:764});
});

test('a page that cannot keep up is resized less often and still lands on the final size',()=>{
 const start={x:0,y:36,width:1280,height:764},target={x:240,y:36,width:1034,height:758};
 for(const [load,fewer] of [[undefined,false],[.2,false],[1,true]]){
  let now=0,queued=null,wait=0;const bounds=[];
  const view={bounds:{...start},getBounds(){return {...this.bounds};},setBounds(next){this.bounds={...next};bounds.push({...next});},webContents:{isDestroyed:()=>false}};
  const clock={now:()=>now,later:(fn,delay)=>{queued=fn;wait=delay;return 1;},cancel:()=>{queued=null;},busy:()=>load};
  placePageBounds({view},target,true,clock,1000/60,'slide');
  for(let i=0;i<800&&queued;i++){now+=wait;const fn=queued;queued=null;fn();}
  assert.deepEqual(view.bounds,target,'lands on the final size');
  if(fewer)assert.ok(bounds.length<22,'a busy page is moved about half as often: '+bounds.length);else assert.ok(bounds.length>20,'a page that keeps up is moved every frame: '+bounds.length);
 }
});

test('playing media does not throttle an unchanged viewport slide',()=>{
 const start={x:0,y:36,width:1280,height:764},target={...start,x:240};
 let now=0,queued=null,wait=0;const times=[],bounds=[];
 const view={bounds:{...start},getBounds(){return {...this.bounds};},setBounds(next){this.bounds={...next};bounds.push({...next});times.push(now);},webContents:{isDestroyed:()=>false}};
 const clock={now:()=>now,later:(fn,delay)=>{queued=fn;wait=delay;return 1;},cancel:()=>{queued=null;},busy:()=>1};
 placePageBounds({view},target,true,clock,1000/60,'slide');
 for(let i=0;i<800&&queued;i++){now+=wait;const fn=queued;queued=null;fn();}
 assert.deepEqual(view.bounds,target);
 assert(bounds.every(b=>b.width===start.width&&b.height===start.height),'The page viewport remains unchanged');
 // The spring eventually moves less than one pixel per frame; measure its moving section,
 // after the load checks that used to halve its cadence at180ms.
 const moving=times.filter(t=>t>=170&&t<=330);
 assert(moving.length>=8,'Busy media still moves on every display frame: '+moving.length);
 assert(moving.slice(1).every((t,i)=>t-moving[i]<20),'A translation must not inherit the30fps reflow throttle');
});

// The docked sidebar in the normal view (smooth): the page glides at the display's rate with its size held, so a heavy site lays out once.
function glide(start,target,{smooth=true,load,stop,then}={}){
 let now=0,queued=null,wait=0;const bounds=[],times=[];
 const view={bounds:{...start},getBounds(){return {...this.bounds};},setBounds(next){this.bounds={...next};bounds.push({...next});times.push(now);},webContents:{isDestroyed:()=>false}};
 const clock={now:()=>now,later:(fn,delay)=>{queued=fn;wait=delay;return 1;},cancel:()=>{queued=null;},busy:()=>load},entry={view};
 placePageBounds(entry,target,true,clock,1000/60,'slide',undefined,undefined,smooth);
 for(let i=0;i<800&&queued;i++){
  if(stop&&i===stop){placePageBounds(entry,then,true,clock,1000/60,'slide',undefined,undefined,smooth);}
  now+=wait;const fn=queued;queued=null;fn();
 }
 return {view,bounds,times,sizes:[...new Set(bounds.map(b=>`${b.width}x${b.height}`))]};
}
for(const [name,start,target] of [
 ['open',{x:0,y:36,width:1272,height:722},{x:240,y:36,width:1026,height:716}],
 ['close',{x:240,y:36,width:1026,height:716},{x:0,y:36,width:1272,height:722}],
]) test(`${name} sidebar, smooth: the page glides every frame and lays out once`,()=>{
 const {view,bounds,sizes}=glide(start,target);
 assert.deepEqual(view.bounds,target,'lands exactly on the final size');
 assert.ok(sizes.length<=2,'the site sees its final size, and at most one other: '+sizes);
 assert.ok(bounds.length>15,'the page moves on many frames: '+bounds.length);
 const widest=Math.max(start.width,target.width);
 assert.ok(bounds.every(b=>b.width<=widest&&b.height<=Math.max(start.height,target.height)),'never larger than the larger of its two sizes');
 assert.ok(bounds.slice(0,-1).every(b=>b.width===widest),'the size is held while the page is on its way');
 const xs=bounds.map(b=>b.x);
 assert.ok(xs.every((x,i)=>i===0||(target.x>start.x?x>=xs[i-1]:x<=xs[i-1])),'the page only moves one way');
 assert.ok(bounds.every(b=>b.y===36),'the top edge stays put');
 if(name==='open')assert.ok(bounds.slice(0,-1).every(b=>b.x+b.width>=start.x+start.width-1),'a narrowing never bares a strip at the far edge while it moves');
});
test('smooth: a page that cannot keep up is not throttled, because it is not laid out',()=>{
 const start={x:240,y:36,width:1026,height:716},target={x:0,y:36,width:1272,height:722};
 const quiet=glide(start,target),busy=glide(start,target,{load:1});
 assert.equal(busy.bounds.length,quiet.bounds.length,'a busy renderer moves the page just as often');
 assert.deepEqual(busy.view.bounds,target);
});
for(const [name,start,target] of [
 ['entering Seamless (the toolbar rows go)',{x:0,y:36,width:1272,height:722},{x:6,y:6,width:1260,height:746}],
 ['leaving Seamless (the toolbar rows come)',{x:6,y:6,width:1260,height:746},{x:0,y:36,width:1272,height:722}],
 ['a toolbar dropping',{x:0,y:36,width:1272,height:722},{x:0,y:80,width:1272,height:678}],
]) test(`smooth: ${name}: the page glides every frame and lays out once`,()=>{
 const {view,bounds,sizes}=glide(start,target);
 assert.deepEqual(view.bounds,target,'lands exactly on the final size');
 assert.ok(sizes.length<=2,'the site sees its final size, and at most one other: '+sizes);
 assert.ok(bounds.length>8,'the page moves on a step for every pixel it covers, at the frame rate: '+bounds.length);
 const tall=Math.max(start.height,target.height),wide=Math.max(start.width,target.width);
 assert.ok(bounds.every(b=>b.height<=tall&&b.width<=wide),'never larger than the larger of its two sizes');
 assert.ok(bounds.slice(0,-1).every(b=>b.height===tall&&b.width===wide),'the size is held while the page is on its way');
 const ys=bounds.map(b=>b.y);
 assert.ok(ys.every((y,i)=>i===0||(target.y>start.y?y>=ys[i-1]:y<=ys[i-1])),'the page only moves one way');
});
test('smooth: only a move whose far edges stay put is held; an unsized view or a moving far edge is not',()=>{
 const split=glide({x:0,y:36,width:1272,height:722},{x:0,y:36,width:600,height:722});
 assert.ok(split.sizes.length>10,'a far edge that moves follows the spring: '+split.sizes.length);
 const off=glide({x:240,y:36,width:1026,height:716},{x:0,y:36,width:1272,height:722},{smooth:false});
 assert.ok(off.sizes.length>10,'Compact, Focus and a split keep the live resize: '+off.sizes.length);
 const same=glide({x:0,y:36,width:1272,height:722},{x:240,y:36,width:1272,height:722});
 assert.deepEqual(same.sizes,['1272x722'],'a move that keeps the size is only a translation');
});
test('smooth: reversing the sidebar half way still lands exactly',()=>{
 const open={x:240,y:36,width:1026,height:716},closed={x:0,y:36,width:1272,height:722};
 for(const stop of [3,8,14]){
  const {view}=glide(open,closed,{stop,then:open});
  assert.deepEqual(view.bounds,open,`reversed after ${stop} frames`);
 }
});
