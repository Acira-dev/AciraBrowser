'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {createSessionShutdown}=require('../desktop/session-durability.cjs');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const event=()=>({prevented:0,preventDefault(){this.prevented++;}});

test('zero-session startup waits for its configured asynchronous handoff exactly once under quit reentry',async()=>{
 let finish,calls=0,quits=0;const pending=new Promise(resolve=>finish=resolve);
 const handle=createSessionShutdown({getSessions:()=>[],beforeFlush:()=>{calls++;return pending;},quit:()=>{quits++;handle(event());}});
 const first=event(),again=event();handle(first);handle(again);await tick();
 assert.equal(first.prevented,1);assert.equal(again.prevented,1);assert.equal(calls,1);assert.equal(quits,0);
 finish();await tick();assert.equal(quits,1);handle(event());assert.equal(calls,1);assert.equal(quits,1);
});

test('a cancelled before-quit never runs the will-quit handoff; a later approved quit does',async()=>{
 const app=new EventEmitter();let calls=0,quits=0;
 app.on('will-quit',createSessionShutdown({getSessions:()=>[],beforeFlush:async()=>{calls++;},quit:()=>quits++}));
 const attempt=approved=>{const before=event();if(!approved)before.preventDefault();if(!before.prevented)app.emit('will-quit',event());};
 attempt(false);await tick();assert.equal(calls,0);assert.equal(quits,0);
 attempt(true);await tick();assert.equal(calls,1);assert.equal(quits,1);
});

test('zero-session handoff failure reports once and retains the existing bounded quit policy',async()=>{
 const errors=[];let quits=0;const handle=createSessionShutdown({getSessions:()=>[],beforeFlush:async()=>{throw Error('controlled failure');},quit:()=>quits++,onError:message=>errors.push(message)});
 const first=event();handle(first);await tick();assert.equal(first.prevented,1);assert.equal(quits,1);assert.deepEqual(errors,['Some website session data could not be flushed.']);handle(event());assert.equal(quits,1);
});

test('zero-session handoff timeout reports once and late completion cannot quit twice',async()=>{
 let expire,finish,quits=0,clears=0;const errors=[],pending=new Promise(resolve=>finish=resolve);
 const handle=createSessionShutdown({getSessions:()=>[],beforeFlush:()=>pending,quit:()=>quits++,onError:message=>errors.push(message),setTimer:fn=>{expire=fn;return 7;},clearTimer:id=>{assert.equal(id,7);clears++;}});
 handle(event());expire();await tick();assert.equal(quits,1);assert.equal(clears,1);assert.deepEqual(errors,['Website session flush timed out.']);finish();await tick();assert.equal(quits,1);
});

test('no sessions and no handoff preserves the immediate native quit path',()=>{
 let quits=0;const handle=createSessionShutdown({getSessions:()=>[],quit:()=>quits++}),first=event();handle(first);assert.equal(first.prevented,0);assert.equal(quits,0);
});
