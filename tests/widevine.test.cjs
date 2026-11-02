const test=require('node:test'),assert=require('node:assert/strict');
const {prepareWidevine}=require('../desktop/browser-services/widevine.cjs');
test('stock and Windows runtimes keep their existing startup without component calls',async()=>{
 let called=false;
 await prepareWidevine({platform:'win32',components:{whenReady(){called=true;throw Error('Must not run');}}});
 assert.equal(called,false);
 assert.equal((await prepareWidevine({platform:'darwin'})).status,'unavailable');
});
test('a Mac ECS runtime waits for a real ready CDM and records its version',async()=>{
 let done=false;
 const result=await prepareWidevine({platform:'darwin',components:{whenReady:async()=>{done=true;},status:()=>({'cdm':{title:'Widevine Content Decryption Module',version:'4.10.3112.0'}})}});
 assert(done);assert.deepEqual(result,{status:'ready',version:'4.10.3112.0'});
});
test('offline component failures do not prevent ordinary browsing',async()=>{
 const logs=[];const result=await prepareWidevine({platform:'darwin',components:{whenReady:async()=>{throw Error('Offline');}},log:(...args)=>logs.push(args)});
 assert.equal(result.status,'unavailable');assert.equal(logs.length,1);
});
test('slow installation is bounded without claiming a ready module; late completion remains observed',async()=>{
 let finish;
 const result=await prepareWidevine({platform:'darwin',timeoutMs:5,components:{whenReady:()=>new Promise(r=>finish=r),status:()=>({cdm:{title:'Widevine Content Decryption Module',version:'4.10.3112.0'}})}});
 assert.equal(result.status,'installing');finish();await new Promise(r=>setImmediate(r));
 assert.equal(require('../desktop/browser-services/widevine.cjs').widevineStatus().status,'ready');
});
