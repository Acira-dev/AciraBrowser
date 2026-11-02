'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {createProfileCleanup}=require('../desktop/profile-cleanup.cjs');
function fixture({attach=async()=>({supported:true}),arm=()=>{},run,review}={}){
 const events=[],sessions=new Map(),controllers=[],contents=[],policies=new Map();let serviceOptions;
 const profile=id=>({id,name:id,partition:'persist:'+id}),choice=id=>policies.get(id)||{enabled:false,categories:[],keepOrigins:[]};
 const binding=createProfileCleanup({database:{},cookieRestore:{async attach(context){events.push('attach:'+context.profileId);return attach(context);}},permissions:{},getSession:partition=>{if(!sessions.has(partition))sessions.set(partition,{partition,blocked:false});return sessions.get(partition);},getPipeline:session=>({holdNetwork(){session.blocked=true;events.push('hold:'+session.partition);return()=>{session.blocked=false;events.push('release:'+session.partition);};}}),getControllers:()=>controllers,getAllContents:()=>contents,dialog:{showMessageBox:async(window,options)=>review?review(window,options):{response:1}},getWindow:()=>null,registryPath:'test-only',createInventory:()=>({storageOrigins:id=>({complete:true,profileId:id,origins:['chrome-extension://'+'a'.repeat(32)]})}),createService:options=>{serviceOptions=options;return {status:id=>({profileId:id,choice:choice(id),pending:false,running:false,networkBlocked:false,recoveryError:null}),set:async(id,value)=>{if(review){const answer=await options.dialog.showMessageBox(options.getWindow(id),{});if(answer.response!==1)return {cancelled:true};}policies.set(id,value);return {profileId:id,choice:value};},runPending:async options=>{events.push('run:'+options.phase);return run?run(options,serviceOptions):{completed:true,profiles:[]};},armAll(){events.push('arm');arm();}};}});
 return {binding,events,sessions,controllers,contents,policies,profile,options:()=>serviceOptions};
}
test('actual native network hold precedes async cookie recovery and releases only after durable arm',async()=>{
 let release;const f=fixture({attach:()=>new Promise(resolve=>release=()=>resolve({supported:true}))});const prepared=f.binding.prepare([f.profile('A')]);assert.equal(f.sessions.get('persist:A').blocked,true);assert.equal(f.binding.mayBrowse('A'),false);await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(f.events,['hold:persist:A','attach:A']);release();await prepared;assert.equal(f.binding.mayBrowse('A'),true);assert.equal(f.sessions.get('persist:A').blocked,false);assert.ok(f.events.indexOf('arm')<f.events.indexOf('release:persist:A'));
});
test('failed durable arm leaves native network held and trusted recovery status honest',async()=>{
 const f=fixture({arm(){throw Error('journal capacity');}});await f.binding.prepare([f.profile('A')]);assert.equal(f.binding.mayBrowse('A'),false);assert.equal(f.sessions.get('persist:A').blocked,true);assert.match(f.binding.gate('A').error,/journal capacity/);assert.equal(f.binding.status('A').networkBlocked,true);await assert.rejects(f.binding.set('A',{enabled:true,categories:['cookies'],keepOrigins:[]}),/journal capacity/);
});
test('native installation inventory and untracked extension/background documents participate in the barrier',async()=>{
 const f=fixture();await f.binding.prepare([f.profile('A')]);const options=f.options(),session=f.sessions.get('persist:A');assert.equal(options.hasLivePages('A'),false);f.contents.push({session,isDestroyed:()=>false,getURL:()=> 'chrome-extension://'+'a'.repeat(32)+'/background.html',getType:()=> 'backgroundPage'});assert.equal(options.hasLivePages('A'),true);assert.deepEqual(options.getProtectedOrigins(session,f.profile('A')),{complete:true,profileId:'A',origins:['chrome-extension://'+'a'.repeat(32)]});assert.throws(()=>f.binding.retry('A'),/Close website tabs/);
});
test('adding another native profile preserves an already browsing profile and its armed job',async()=>{
 let runs=0;const f=fixture({run:async()=>++runs===1?{completed:true,profiles:[]}:{completed:false,profiles:[{profileId:'A',completed:false,error:'live owner'},{profileId:'B',completed:true}]}});await f.binding.prepare([f.profile('A')]);f.policies.set('A',{enabled:true,categories:['cookies'],keepOrigins:[]});await f.binding.prepare([f.profile('A'),f.profile('B')]);assert.equal(f.binding.mayBrowse('A'),true);assert.equal(f.binding.mayBrowse('B'),true);assert.equal(f.sessions.get('persist:A').blocked,false);assert.equal(f.binding.gate('A').error,null);
});

test('native cleanup review belongs to its actual requesting window and closed owners cannot commit',async()=>{
 let finish,reviewed;const f=fixture({review:window=>{reviewed=window;return new Promise(resolve=>finish=resolve);}});await f.binding.prepare([f.profile('A')]);let destroyed=false;const window={isDestroyed:()=>destroyed};const saving=f.binding.set('A',{enabled:true,categories:['cookies'],keepOrigins:[]},window);assert.equal(reviewed,window);await assert.rejects(f.binding.set('A',{enabled:true,categories:['history'],keepOrigins:[]},{isDestroyed:()=>false}),/Another cleanup choice/);destroyed=true;finish({response:1});assert.deepEqual(await saving,{cancelled:true});assert.equal(f.policies.has('A'),false);
});

// Restored windows now call prepare concurrently while services become ready.
test('concurrent restored owners do not recover an already armed browsing profile again',async()=>{
 let unblock;const barrier=new Promise(resolve=>unblock=resolve);let runs=0;
 const f=fixture({run:async()=>{runs++;await barrier;return {completed:true,profiles:[]};}});
 const profiles=[f.profile('A'),f.profile('B')];
 const first=f.binding.prepare(profiles),second=f.binding.prepare(profiles);
 await new Promise(resolve=>setImmediate(resolve));unblock();await Promise.all([first,second]);
 assert.equal(runs,1,'One shared startup recovery, before either owner may browse');
 assert.equal(f.events.filter(e=>e==='arm').length,1);
 assert.equal(f.binding.mayBrowse('A'),true);assert.equal(f.binding.mayBrowse('B'),true);
 assert.equal(f.sessions.get('persist:A').blocked,false);assert.equal(f.sessions.get('persist:B').blocked,false);
});
