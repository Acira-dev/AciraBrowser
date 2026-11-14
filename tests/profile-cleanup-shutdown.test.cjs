'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const {createProfileCleanupShutdown}=require('../desktop/profile-cleanup-shutdown.cjs');
const event=()=>({prevented:0,preventDefault(){this.prevented++;}}),tick=()=>new Promise(resolve=>setImmediate(resolve));
test('accepted quit waits for selective cleanup once before ordinary native flush',async()=>{
 const order=[];let complete,handler;handler=createProfileCleanupShutdown({getCleanup:()=>({needsExit:()=>true,finish:()=>{order.push('cleanup');return new Promise(resolve=>complete=resolve);}}),shutdown:()=>order.push('flush'),quit:()=>handler(event()),onState:value=>order.push(value.phase)});const first=event(),again=event();handler(first);handler(again);assert.equal(first.prevented,1);assert.equal(again.prevented,1);assert.deepEqual(order,['waiting','cleanup']);complete({completed:true});await tick();assert.deepEqual(order,['waiting','cleanup','complete','flush']);
});
test('ordinary profiles with cleanup off keep the direct original shutdown path',()=>{
 let called=0;const supplied=event();createProfileCleanupShutdown({getCleanup:()=>({needsExit:()=>false}),shutdown:actual=>{assert.equal(actual,supplied);called++;},quit:()=>assert.fail('unexpected deferred quit')})(supplied);assert.equal(called,1);assert.equal(supplied.prevented,0);
});
test('timed-out deletion retains pending status and never races the custom native flush',async()=>{
 const states=[];let flushed=false,quit=false,handler;handler=createProfileCleanupShutdown({getCleanup:()=>({needsExit:()=>true,finish:()=>new Promise(()=>{})}),shutdown:()=>flushed=true,quit:()=>{quit=true;handler(event());},onState:state=>states.push(state),timeoutMs:5});handler(event());await new Promise(resolve=>setTimeout(resolve,20));assert.equal(quit,true);assert.equal(flushed,false);assert.deepEqual(states.at(-1),{phase:'pending',completed:false,flushSkipped:true});
});
test('the shutdown record names what each profile\'s cleanup said (error and failed category), and keeps its old shape when there is nothing to say',async()=>{
 const run=async result=>{const states=[];let handler;handler=createProfileCleanupShutdown({getCleanup:()=>({needsExit:()=>true,finish:async()=>result}),shutdown:()=>{},quit:()=>{handler(event());},onState:state=>states.push(state),timeoutMs:50});handler(event());await new Promise(resolve=>setTimeout(resolve,20));return states.at(-1);};
 const failed=await run({completed:false,profiles:[{profileId:'profile-a',completed:false,pending:true,error:'Native service workers are still active.',results:[{category:'storage',status:'failed',error:'Background activity changed during deletion; cleanup remains pending.'},{category:'cookies',status:'cleared'}]}]});
 assert.equal(failed.phase,'pending');assert.equal(failed.completed,false);assert.equal(failed.flushSkipped,false);
 assert.deepEqual(failed.profiles,[{profileId:'profile-a',completed:false,error:'Native service workers are still active.',results:[{category:'storage',status:'failed',error:'Background activity changed during deletion; cleanup remains pending.'},{category:'cookies',status:'cleared',error:undefined}]}]);
 const done=await run({completed:true,profiles:[{profileId:'profile-a',completed:true,results:[{category:'cookies',status:'cleared'}]}]});
 assert.equal(done.phase,'complete');assert.equal(done.completed,true);assert.equal(done.profiles[0].completed,true);
 assert.deepEqual(await run({completed:true}),{phase:'complete',completed:true,flushSkipped:false},'nothing to say: the old record, unchanged');
});
