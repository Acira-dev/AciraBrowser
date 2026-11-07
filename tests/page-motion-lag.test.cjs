'use strict';
// Sidebar mode's morph (docs: ui/sidebarMorphPlan.ts): the page's top and bottom edges (turning the mode on) or its left and right edges (turning it off) wait `lag` ms before they start on the
// same spring, so the page never covers the chrome that is still leaving the band it is about to rise into. The glide ends when the later pair has settled; with no lag nothing changes.
const test=require('node:test'),assert=require('node:assert/strict');
const {placePageBounds,springSettle}=require('../desktop/page-motion.cjs');

function rig(start){
 let now=0,queued=null;const bounds=[],times=[];
 const view={bounds:{...start},getBounds(){return {...this.bounds};},setBounds(next){this.bounds={...next};bounds.push({...next});times.push(now);},setBorderRadius(){},
  webContents:{isDestroyed:()=>false,enableDeviceEmulation(){},disableDeviceEmulation(){}}};
 const clock={now:()=>now,later:fn=>{queued=fn;return 1;},cancel:()=>{queued=null;}},entry={view};
 return {entry,clock,bounds,times,frames:(limit=400)=>{for(let i=0;i<limit&&queued;i++){now+=1000/120;const fn=queued;queued=null;fn();}}};
}
const spring={duration:.2,bounce:0};
const settle=Math.round(springSettle(spring)*1000);
// The tabs-on-top window going into Sidebar mode: the page's left edge 0 → 240, its top edge 72 → 6, 6 px of margin right and below.
const from={x:0,y:72,width:1200,height:718},to={x:240,y:6,width:954,height:778};
const run=(start,target,lag)=>{const r=rig(start);placePageBounds(r.entry,target,true,r.clock,1000/120,'slide',spring,8,true,1,lag);r.frames();return r;};

test('no lag: the glide is the one it was (all four edges on one clock, landing exactly)', () => {
 const plain=run(from,to,null),zero=run(from,to,{x:0,y:0});
 assert.deepEqual(zero.bounds,plain.bounds);
 assert.deepEqual(plain.bounds.at(-1),to);
});

test('turning the mode on: the top and bottom edges wait, the left edge starts at once, and the glide lands exactly when the later pair has settled', () => {
 const r=run(from,to,{y:180});
 const early=r.bounds.filter((_,i)=>r.times[i]<170);
 assert.ok(early.length>10);
 assert.ok(early.every(b=>b.y===from.y&&b.y+b.height===from.y+from.height),'top and bottom stay while they wait');
 assert.ok(early.some(b=>b.x>20),'the left edge is already travelling');
 assert.deepEqual(r.bounds.at(-1),to,'it lands on the target');
 const last=r.times.at(-1);
 assert.ok(last>=settle+180-20&&last<=settle+180+40,`it ends when the lagging pair has settled: ${last} ms (settle ${settle} + lag 180)`);
 const tops=r.bounds.map(b=>b.y);
 assert.ok(tops.every((y,i)=>i===0||y<=tops[i-1]),'the top edge only rises');
});

test('turning it off: the left and right edges wait, the top edge leads', () => {
 const r=run(to,from,{x:180});
 const early=r.bounds.filter((_,i)=>r.times[i]<170);
 assert.ok(early.every(b=>b.x===to.x&&b.x+b.width===to.x+to.width),'the left and right edges stay while they wait');
 assert.ok(early.some(b=>b.y>40),'the top edge is already travelling down');
 assert.deepEqual(r.bounds.at(-1),from);
});

test('a lag needs its own spring: on the sidebar\'s curve it is ignored, and absurd values are clamped', () => {
 const r=rig(from);placePageBounds(r.entry,to,true,r.clock,1000/120,'slide',undefined,8,true,1,{y:300});r.frames();
 const plain=rig(from);placePageBounds(plain.entry,to,true,plain.clock,1000/120,'slide',undefined,8,true,1,null);plain.frames();
 assert.deepEqual(r.bounds,plain.bounds);
 const big=run(from,to,{y:99999});
 assert.ok(big.times.at(-1)<=settle+600+40,'clamped to 600 ms');
});
