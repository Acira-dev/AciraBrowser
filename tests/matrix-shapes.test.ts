import test from 'node:test';
import assert from 'node:assert/strict';
import {switchedOff,blend,layer,layerOrder,torConnecting,torConnected,torStopped,privateSweep,checkLights} from '../src/ui/matrixShapes';

const grid=(fn:(r:number,c:number)=>number,R:number,C=R)=>Array.from({length:R},(_,r)=>Array.from({length:C},(_,c)=>fn(r,c)));
const lit=(cells:number[][])=>cells.flat().filter(v=>v>0).length;

test('a seen chat is a matrix switched off: every dot dim and equal',()=>{
  const cells=grid((r,c)=>switchedOff(r,c),5).flat();
  assert.equal(new Set(cells).size,1);
  assert.ok(cells[0]>0&&cells[0]<.3);
});

test('changing state cross-fades the dots instead of cutting',()=>{
  assert.equal(blend(0,1,0),0);
  assert.equal(blend(0,1,1),1);
  const mid=blend(0,1,.5);
  assert.ok(mid>0&&mid<1);
  assert.ok(blend(0,1,.25)<mid&&mid<blend(0,1,.75),'monotonic');
  assert.equal(blend(-1,1,.5),blend(0,1,.5),'a dot outside the old shape fades in from dark');
});

test('classic grid only: every pattern keeps the whole square grid (no dot is ever left out to draw a picture)',()=>{
  for(const R of [5,7])for(const t of [0,.4,1.3,2.9])for(const fn of [
    (r:number,c:number)=>torConnecting(t,r,c,R,R,.4),(r:number,c:number)=>torConnected(t,r,c,R,R),
    (r:number,c:number)=>torStopped(t,r,c,R,R),(r:number,c:number)=>privateSweep(t,r,c,R,R),
  ])for(const v of grid(fn,R).flat())assert.ok(v===0||v===.5||v===1,`two intensities only, got ${v}`);
});

test('layer order runs from the centre out, clockwise from the top of each layer',()=>{
  const rank=layerOrder(5,5),at=(r:number,c:number)=>rank[r*5+c];
  assert.equal(at(2,2),0,'the centre first');
  assert.equal(at(1,2),1,'then the top of the first layer');
  assert.ok(at(1,3)<at(2,3)&&at(2,3)<at(3,3),'clockwise');
  assert.ok(Math.max(...grid((r,c)=>layer(r,c,5,5)<=1?at(r,c):-1,5).flat())<Math.min(...grid((r,c)=>layer(r,c,5,5)===2?at(r,c):99,5).flat()),'inner layers before the edge');
  assert.deepEqual([...rank].sort((a,b)=>a-b),Array.from({length:25},(_,i)=>i),'every dot has one place');
});

test('Tor connecting lights dots with real progress, never fewer as it rises',()=>{
  const at=(p:number)=>lit(grid((r,c)=>torConnecting(.1,r,c,7,7,p)>=1?1:0,7));
  assert.equal(at(0),1,'the centre is lit at once');
  assert.equal(at(1),49,'connected fills the grid');
  let last=0;for(const p of [0,.1,.25,.5,.75,.9,1]){const n=at(p);assert.ok(n>=last);last=n;}
});

test('Tor connected ripples one full layer outward over a half-lit grid; stopped keeps only the centre',()=>{
  const fronts=[0,.5,1,1.5,2].map(t=>grid((r,c)=>torConnected(t,r,c,7,7)===1?layer(r,c,7,7):-1,7).flat().filter(v=>v>=0));
  for(const f of fronts)assert.ok(new Set(f).size<=1,'the full lights are one layer');
  const order=fronts.filter(f=>f.length).map(f=>f[0]);
  assert.deepEqual(order,[...order].sort((a,b)=>a-b),'the full layer moves outward');
  assert.equal(lit(grid((r,c)=>torStopped(0,r,c,7,7),7)),1);
});

test('private is a diagonal sweep: the lit dots share one diagonal and the grid behind goes dark',()=>{
  const full=grid((r,c)=>privateSweep(1.2,r,c,7,7)===1?r+c:-1,7).flat().filter(v=>v>=0);
  assert.ok(full.length>0&&new Set(full).size===1,'one diagonal at full');
  assert.ok(lit(grid((r,c)=>privateSweep(1.2,r,c,7,7),7))<=14,'never more than the band and its trail');
});

test('Added is a check stroke lit on the whole classic grid: two intensities, one connected stroke, no dot removed',()=>{
  for(const R of [5,7]){
    const cells=grid((r,c)=>checkLights(r,c,R,R),R);
    for(const v of cells.flat())assert.ok(v===0||v===1,`dim or lit only, got ${v}`);
    const on=cells.flatMap((row,r)=>row.map((v,c)=>v?[r,c]:null)).filter(Boolean) as number[][];
    assert.ok(on.length>=5&&on.length<=7,'a check stroke, not a fill');
    const byCol=[...on].sort((a,b)=>a[1]-b[1]);
    for(let i=1;i<byCol.length;i++)assert.ok(byCol[i][1]-byCol[i-1][1]===1&&Math.abs(byCol[i][0]-byCol[i-1][0])===1,'each dot touches the next on the diagonal');
    assert.equal(byCol[0][1],0,'reaches the left edge');assert.equal(byCol.at(-1)![1],R-1,'and the right edge');
    const lowest=Math.max(...on.map(d=>d[0])),elbow=on.filter(d=>d[0]===lowest);assert.equal(elbow.length,1,'one elbow, the lowest dot');
    assert.ok(elbow[0][1]>0&&elbow[0][1]<R-1,'the elbow is inside the stroke, so it reads as a check and not a slash');
  }
  assert.equal(lit(grid((r,c)=>checkLights(r,c,4,5),4,5)),0,'a non-square grid rests dim');
});
