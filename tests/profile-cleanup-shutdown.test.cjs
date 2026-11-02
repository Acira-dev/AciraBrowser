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
