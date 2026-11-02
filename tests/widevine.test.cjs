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
 // after the bounded wait it is "not there yet" (a refused page is told why); the late install still flips it to ready
 const result=await prepareWidevine({platform:'darwin',timeoutMs:5,schedule:()=>null,cancel:()=>{},components:{whenReady:()=>new Promise(r=>finish=r),status:()=>({cdm:{title:'Widevine Content Decryption Module',version:'4.10.3112.0'}})}});
 assert.equal(result.status,'unavailable');finish();await new Promise(r=>setImmediate(r));
 assert.equal(require('../desktop/browser-services/widevine.cjs').widevineStatus().status,'ready');
});

// A first run or a missing CDM no longer holds the first window: main starts the install and only waits when the CDM is already on disk.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {installedOnDisk,widevineState,onWidevineChange}=require('../desktop/browser-services/widevine.cjs');
const CDM={title:'Widevine Content Decryption Module'};
test('only a CDM already installed in the profile is waited for at start',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'acira-cdm-'));
 assert.equal(installedOnDisk(dir),false,'first run');
 fs.mkdirSync(path.join(dir,'WidevineCdm'));assert.equal(installedOnDisk(dir),false,'an empty folder is not a CDM');
 fs.mkdirSync(path.join(dir,'WidevineCdm','4.10.3112.0'));assert.equal(installedOnDisk(dir),true);
 fs.rmSync(dir,{recursive:true,force:true});
});
test('started without waiting, the state says installing at once and ready when the CDM arrives',async()=>{
 let finish;const seen=[];const stop=onWidevineChange(state=>seen.push(state.status));
 let version=null;
 const pending=prepareWidevine({platform:'darwin',schedule:()=>null,cancel:()=>{},components:{whenReady:()=>new Promise(r=>finish=r),status:()=>({cdm:{...CDM,version}})}});
 assert.deepEqual(widevineState(),{status:'installing',version:null,expected:true},'nothing awaited: the window opens while it installs');
 version='4.10.3112.0';await new Promise(r=>setImmediate(r));finish();await pending;
 assert.deepEqual(widevineState(),{status:'ready',version:'4.10.3112.0',expected:true});
 assert.deepEqual(seen,['installing','ready']);stop();
});
test('after a failed install the status is read again on the retry ladder, because whenReady keeps its first failure even once the CDM is installed',async()=>{
 // Seen with the ECS runtime: offline at start, Chromium's own component updater installed the CDM 60 s later; whenReady() still rejected afterwards.
 const timers=[];let version=null;const seen=[];const stop=onWidevineChange(state=>seen.push(state.status));
 await prepareWidevine({platform:'darwin',schedule:(fn,delay)=>{timers.push({fn,delay});return timers.length;},cancel:()=>{},components:{whenReady:async()=>{throw Error('Failed to install required components');},status:()=>({cdm:{...CDM,version}})}});
 assert.equal(widevineState().status,'unavailable');assert.equal(widevineState().expected,true,'a CDM can still arrive');
 assert.deepEqual(timers.map(t=>t.delay),[2*60*1000]);
 timers.shift().fn();assert.equal(widevineState().status,'unavailable');assert.deepEqual(timers.map(t=>t.delay),[10*60*1000],'still missing: the next rung');
 version='4.10.3112.0';timers.shift().fn();
 assert.deepEqual(widevineState(),{status:'ready',version:'4.10.3112.0',expected:true});assert.deepEqual(timers,[],'found: no more looks');
 assert.deepEqual(seen,['installing','unavailable','ready']);stop();
});
test('a newer start replaces an older one: the older install cannot overwrite the state',async()=>{
 let first;
 const older=prepareWidevine({platform:'darwin',schedule:()=>null,cancel:()=>{},components:{whenReady:()=>new Promise(r=>first=r),status:()=>({})}});
 await prepareWidevine({platform:'darwin',schedule:()=>null,cancel:()=>{},components:{whenReady:async()=>{},status:()=>({cdm:{...CDM,version:'4.10.3112.0'}})}});
 await new Promise(r=>setImmediate(r));first();await older;
 assert.equal(widevineState().status,'ready');
});
test('main starts the install without waiting for it unless the CDM is already on disk, and hands the state to refused pages',()=>{
 const main=fs.readFileSync(path.join(__dirname,'../desktop/main.cjs'),'utf8');
 assert.doesNotMatch(main,/await require\('\.\/browser-services\/widevine\.cjs'\)\.prepareWidevine/,'a first run used to wait up to 20 s here before any window');
 assert.match(main,/const installing=widevine\.prepareWidevine\(\{[^}]*watch:networkWatch\(\)/);
 assert.match(main,/if\(widevine\.installedOnDisk\(app\.getPath\('userData'\)\)\)\{let timer;await Promise\.race\(\[installing,new Promise\(resolve=>\{timer=setTimeout\(resolve,2000\);\}\)\]\);/);
 assert.match(main,/widevine\.onWidevineChange\(cdm=>require\('\.\/browser-services\/protected-media\.cjs'\)\.cdmChanged\(cdm\)\)/);
 assert.match(main,/protected-media\.cjs'\)\.refused\(event\.sender,id,emitBrowser,require\('\.\/browser-services\/widevine\.cjs'\)\.widevineState\(\)\)/);
});
