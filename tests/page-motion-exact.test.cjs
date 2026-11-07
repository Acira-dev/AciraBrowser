'use strict';
// View switches (founder, 6 Nov 2026: "switching between window views glitches"). A held glide used to keep the larger of the page's two sizes and slide that view along: with a card that
// sits 6 px inside the window on its far side the view ran past the card and covered the frame strip, took its inset only in the last frame, and landed with a 4 px shortcut. The held
// glide now places the view on the card's exact rectangle on every frame (all four edges on the spring) and holds the page's layout through the viewport override, so the site lays
// out once (a widening at its start, a narrowing at its landing) and the view only shows more or less of it.
const test=require('node:test'),assert=require('node:assert/strict');
const {placePageBounds}=require('../desktop/page-motion.cjs');

function rig(start){
 let now=0,queued=null;const calls=[],bounds=[];
 const view={bounds:{...start},getBounds(){return {...this.bounds};},setBounds(next){this.bounds={...next};bounds.push({...next});calls.push(['bounds',{...next}]);},
  webContents:{isDestroyed:()=>false,enableDeviceEmulation(p){calls.push(['hold',p.viewSize.width,p.viewSize.height]);},disableDeviceEmulation(){calls.push(['release']);}}};
 const clock={now:()=>now,later:fn=>{queued=fn;return 1;},cancel:()=>{queued=null;}},entry={view};
 const frames=(limit=200)=>{for(let i=0;i<limit&&queued;i++){now+=1000/60;const fn=queued;queued=null;fn();}};
 return {view,entry,clock,calls,bounds,frames,tick:n=>{for(let i=0;i<n&&queued;i++){now+=1000/60;const fn=queued;queued=null;fn();}}};
}
const place=(r,target,{animated=true,spring,radius}={})=>placePageBounds(r.entry,target,animated,r.clock,1000/60,'slide',spring,radius,true);

// The docked sidebar, the card with its 6 px inset on the far side, and the toolbar rows that go (entering Seamless).
const open={start:{x:0,y:36,width:1274,height:748},target:{x:240,y:36,width:1034,height:748}};
const close={start:open.target,target:open.start};
const seamless={start:{x:0,y:36,width:1280,height:754},target:{x:6,y:6,width:1268,height:778}};
const compactOpen={start:{x:240,y:32,width:1034,height:752},target:{x:6,y:6,width:1268,height:778}};

for(const [name,c] of [['sidebar opens',open],['sidebar closes',close],['entering Seamless with the sidebar closed',seamless],['Compact with the sidebar open to Seamless',compactOpen]]) test(`${name}: the view is the card's own rectangle on every frame, never past its far edges`,()=>{
 const r=rig(c.start);place(r,c.target);r.frames();
 const lo=(a,b)=>Math.min(a,b),hi=(a,b)=>Math.max(a,b),right=[c.start.x+c.start.width,c.target.x+c.target.width],bottom=[c.start.y+c.start.height,c.target.y+c.target.height];
 assert.ok(r.bounds.length>8,'a viewport per display frame it moves in: '+r.bounds.length);
 for(const b of r.bounds){
  assert.ok(b.x+b.width>=lo(...right)&&b.x+b.width<=hi(...right),`right edge ${b.x+b.width} stays between ${right}`);
  assert.ok(b.y+b.height>=lo(...bottom)&&b.y+b.height<=hi(...bottom),`bottom edge ${b.y+b.height} stays between ${bottom}`);
 }
 assert.deepEqual(r.view.bounds,c.target);
});

test('the far edges meet the card\'s inset gradually, not in the last frame (entering Seamless)',()=>{
 const r=rig(seamless.start);place(r,seamless.target);r.frames();
 const right=r.bounds.map(b=>b.x+b.width);
 assert.ok(right.every((v,i)=>i===0||v<=right[i-1]),'the right edge only comes in');
 assert.ok(right.some(v=>v>1274&&v<1280),'it passes through the inset on the way');
 const steps=right.slice(1).map((v,i)=>right[i]-v);assert.ok(Math.max(...steps)<=4,'no frame takes the inset in one step: '+Math.max(...steps));
});

test('the near edges end on the spring, not on a shortcut: no last-frame snap',()=>{
 const r=rig(compactOpen.start);place(r,compactOpen.target);r.frames();
 const xs=r.bounds.map(b=>b.x),steps=xs.slice(1).map((v,i)=>Math.abs(v-xs[i]));
 assert.ok(steps.at(-1)<=1&&Math.max(...steps.slice(-6))<=3,'the last frames settle in small steps: '+steps.slice(-6));
});

test('the layout is held once at the larger size and released after the view lands on the target',()=>{
 const r=rig(compactOpen.start);place(r,compactOpen.target);r.frames();
 const holds=r.calls.filter(c=>c[0]==='hold'),releases=r.calls.filter(c=>c[0]==='release');
 assert.deepEqual(holds,[['hold',1268,778]],'a widening lays out once, at its final size');
 assert.equal(releases.length,1);assert.equal(r.calls.at(-1)[0],'release','released last');
 const lastBounds=r.calls.findLast(c=>c[0]==='bounds')[1];assert.deepEqual(lastBounds,compactOpen.target,'after the view stands on the card');
 assert.equal(r.entry.layoutHold,null);
});

test('a narrowing keeps the page at its old layout until it lands (one layout, at the landing)',()=>{
 const r=rig(open.start);place(r,open.target);r.frames();
 assert.deepEqual(r.calls.filter(c=>c[0]==='hold'),[['hold',1274,748]]);
 assert.equal(r.calls.filter(c=>c[0]==='release').length,1);
 assert.ok(r.calls.indexOf(r.calls.find(c=>c[0]==='hold'))<r.calls.findIndex(c=>c[0]==='bounds'),'held before the first move');
});

test('a placement that is not a slide (a split, a resize by hand) takes the view back at once and lets the page lay out at its size',()=>{
 const r=rig(compactOpen.start);place(r,compactOpen.target);r.tick(5);
 assert.ok(r.entry.layoutHold,'held while it glides');
 placePageBounds(r.entry,{x:0,y:0,width:900,height:600},true,r.clock,1000/60);
 assert.deepEqual(r.view.bounds,{x:0,y:0,width:900,height:600});assert.equal(r.entry.layoutHold,null);assert.equal(r.calls.at(-1)[0],'release');
});

test('a slide interrupted by another keeps the layout it has and holds the larger of it and the new target',()=>{
 const r=rig(open.start);place(r,open.target);r.tick(8);
 const mid={...r.view.bounds};
 place(r,{x:6,y:6,width:1268,height:778});
 const hold=r.entry.layoutHold;
 assert.ok(hold.width>=1274&&hold.height>=778,'still at least the first slide\'s layout: '+JSON.stringify(hold));
 assert.deepEqual(r.view.bounds,mid,'the new glide starts from where the view stands');
 r.frames();assert.deepEqual(r.view.bounds,{x:6,y:6,width:1268,height:778});assert.equal(r.entry.layoutHold,null);
});

test('a retarget during the glide keeps the held layout large enough for the new end',()=>{
 const r=rig(open.start);place(r,open.target);r.tick(6);
 placePageBounds(r.entry,{x:240,y:36,width:1034,height:760},false,r.clock,1000/60);
 assert.ok(r.entry.layoutHold.height>=760);r.frames();assert.deepEqual(r.view.bounds,{x:240,y:36,width:1034,height:760});assert.equal(r.entry.layoutHold,null);
});

test('a view that cannot take the viewport override glides as before (its size held)',()=>{
 let now=0,queued=null;const bounds=[];
 const view={bounds:{...compactOpen.start},getBounds(){return {...this.bounds};},setBounds(next){this.bounds={...next};bounds.push({...next});},webContents:{isDestroyed:()=>false}};
 const clock={now:()=>now,later:fn=>{queued=fn;return 1;},cancel:()=>{queued=null;}};
 placePageBounds({view},compactOpen.target,true,clock,1000/60,'slide',undefined,undefined,true);
 for(let i=0;i<200&&queued;i++){now+=1000/60;const fn=queued;queued=null;fn();}
 assert.deepEqual(view.bounds,compactOpen.target);assert.ok(bounds.some(b=>b.width===1268),'the old held glide');
});
