const test=require('node:test'),assert=require('node:assert/strict');
const {createMacAuthentication}=require('../desktop/passwords/mac-authentication.cjs');
test('Mac device-owner authentication waits for the native result and only accepts explicit native success',async()=>{
 let accept,calls=0;
 const port=createMacAuthentication({load:()=>({authenticationAvailable:()=>true,authenticate:reason=>{calls++;assert.equal(reason,'Show a saved password in Acira');return new Promise(resolve=>accept=resolve)}})});
 let complete=false;const pending=port.verify('Show a saved password in Acira').then(result=>{complete=true;return result});await Promise.resolve();assert.equal(complete,false);assert.equal(calls,1);accept({ok:true,code:'verified'});assert.deepEqual(await pending,{ok:true,method:'device-owner'});
 for(const answer of [{ok:true},{ok:true,code:'cancelled'},{ok:false,code:'verified'},null,'verified'])assert.equal((await createMacAuthentication({load:()=>({authenticationAvailable:()=>true,authenticate:async()=>answer})}).verify('Reason')).ok,false);
});
test('Mac cancellation, unavailable native code, timeout and failure never grant access',async()=>{
 for(const code of ['cancelled','failed','timeout','unavailable'])assert.deepEqual(await createMacAuthentication({load:()=>({authenticationAvailable:()=>true,authenticate:async()=>({ok:false,code})})}).verify('Reason'),{ok:false,code});
 assert.equal((await createMacAuthentication({load:()=>{throw Error('missing module')}}).verify('Reason')).ok,false);
 let prompts=0;const port=createMacAuthentication({load:()=>({authenticationAvailable:()=>false,authenticate(){prompts++;}})});assert.equal((await port.verify('Reason')).code,'unavailable');assert.equal(prompts,0);
});
test('the compiled Mac bridge can probe account authentication and rejects invalid reasons without opening a prompt',t=>{
 if(process.platform!=='darwin')return t.skip('Mac native bridge');
 const bridge=require('../desktop/native/build/mac-material.node');
 assert.equal(typeof bridge.authenticationAvailable(),'boolean');
 for(const reason of ['',42,'x'.repeat(241),'Reason\nInjected','Reason\0Injected'])assert.throws(()=>bridge.authenticate(reason),/authentication reason/);
});
