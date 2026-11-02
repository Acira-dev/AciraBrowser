'use strict';
// After a failed network job (update check, Widevine) Acira tries again 2, 10 and 30 minutes later, then only on the job's regular schedule; a wake or
// the network coming back tries again at once. The poll that notices the network is only running while something is failing.
const {test}=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {createRetry,createNetworkWatch,STEPS}=require('../desktop/browser-services/network-retry.cjs');
const MIN=60*1000;
function clock(){
 let time=0,next=1;const timers=new Map();
 return {
  now:()=>time,
  schedule:(fn,delay)=>{const id=next++;timers.set(id,{fn,at:time+delay,delay});return id;},
  cancel:id=>{timers.delete(id);},
  pending:()=>[...timers.values()].map(t=>t.delay),
  advance(ms){time+=ms;for(const [id,t] of [...timers])if(t.at<=time){timers.delete(id);t.fn();}},
 };
}

test('the ladder is 2, 10 and 30 minutes, then nothing more of its own',()=>{
 assert.deepEqual(STEPS,[2*MIN,10*MIN,30*MIN]);
 const c=clock();let runs=0;const retry=createRetry({run:()=>{runs++;},schedule:c.schedule,cancel:c.cancel,now:c.now});
 assert.equal(retry.failed(),2*MIN);assert.deepEqual(c.pending(),[2*MIN]);
 c.advance(2*MIN);assert.equal(runs,1);
 assert.equal(retry.failed(),10*MIN);c.advance(10*MIN);assert.equal(runs,2);
 assert.equal(retry.failed(),30*MIN);c.advance(30*MIN);assert.equal(runs,3);
 assert.equal(retry.failed(),null,'the regular schedule takes over');assert.deepEqual(c.pending(),[]);
 assert.equal(retry.failing,true,'still failing, so a wake or the network coming back still tries');
});

test('a success resets the ladder and cancels a pending retry',()=>{
 const c=clock();let runs=0;const retry=createRetry({run:()=>{runs++;},schedule:c.schedule,cancel:c.cancel,now:c.now});
 retry.failed();retry.failed();retry.succeeded();
 assert.deepEqual(c.pending(),[]);assert.equal(retry.failing,false);
 assert.equal(retry.failed(),2*MIN,'back at the first rung');c.advance(2*MIN);assert.equal(runs,1);
});

test('a nudge tries again at once, only while failing, and not twice within 30 seconds',()=>{
 const c=clock();let runs=0;const retry=createRetry({run:()=>{runs++;},schedule:c.schedule,cancel:c.cancel,now:c.now});
 assert.equal(retry.nudge(),false,'nothing failed: nothing to do');
 retry.failed();c.advance(1000);
 assert.equal(retry.nudge(),true);assert.equal(runs,1);assert.deepEqual(c.pending(),[],'the pending rung is replaced by the attempt');
 retry.failed();c.advance(10*1000);
 assert.equal(retry.nudge(),false,'a wake and the network often arrive together');assert.equal(runs,1);
 c.advance(30*1000);assert.equal(retry.nudge(),true);assert.equal(runs,2);
});

test('waking the Mac nudges every failing job, and only those',()=>{
 const power=new EventEmitter(),watch=createNetworkWatch({powerMonitor:power,net:null});
 const c=clock();const runs={a:0,b:0};
 const a=createRetry({run:()=>{runs.a++;},schedule:c.schedule,cancel:c.cancel,now:c.now,watch});
 createRetry({run:()=>{runs.b++;},schedule:c.schedule,cancel:c.cancel,now:c.now,watch});
 a.failed();c.advance(MIN);
 power.emit('resume');
 assert.deepEqual(runs,{a:1,b:0});
 watch.dispose();assert.equal(power.listenerCount('resume'),0);
});

test('the network coming back nudges a failing job; the poll runs only while one is failing',()=>{
 let online=false,intervals=0,stopped=0,tick=null;
 const watch=createNetworkWatch({net:{isOnline:()=>online},every:(fn)=>{intervals++;tick=fn;return {unref(){}};},stop:()=>{stopped++;tick=null;}});
 const c=clock();let runs=0;
 const retry=createRetry({run:()=>{runs++;},schedule:c.schedule,cancel:c.cancel,now:c.now,watch});
 assert.equal(intervals,0,'nothing polls while nothing failed');
 retry.failed();assert.equal(intervals,1);c.advance(MIN);
 tick();assert.equal(runs,0,'still offline');
 online=true;tick();assert.equal(runs,1,'back online: tried at once');
 retry.succeeded();tick();assert.equal(stopped,1,'nothing failing: the poll stops itself');
 retry.failed();assert.equal(intervals,2,'a new failure starts it again');
});
