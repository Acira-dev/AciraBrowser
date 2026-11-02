'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {validateAction}=require('../desktop/validation.cjs');
const {createInitialState,reduceBrowser}=require('../desktop/runtime.cjs');
const {createProfileLifecycle}=require('../desktop/profile-lifecycle.cjs');

const withWork=()=>reduceBrowser(createInitialState(),{type:'browser.profile.create',name:'Work'});
const workId=state=>state.browserProfiles.find(p=>p.name==='Work').id;

test('rename accepts 1-40 trimmed characters and an optional colour only',()=>{
 const s=withWork(),id=workId(s);
 assert.doesNotThrow(()=>validateAction({type:'browser.profile.rename',id,name:'  Client work  '},s));
 assert.doesNotThrow(()=>validateAction({type:'browser.profile.rename',id,name:'x'.repeat(40),color:'#336699'},s));
 for(const name of ['','   ','x'.repeat(41),7,null])assert.throws(()=>validateAction({type:'browser.profile.rename',id,name},s),/name|text/i,String(name));
 assert.throws(()=>validateAction({type:'browser.profile.rename',id,name:'ok',color:'red'},s),/colour|color/i);
 assert.throws(()=>validateAction({type:'browser.profile.rename',id:'missing',name:'ok'},s));
 assert.throws(()=>validateAction({type:'browser.profile.rename',id,name:'ok',partition:'persist:x'},s),/unsupported/i);
});

test('update takes a colour and/or an avatar (one emoji or initial, or null to clear)',()=>{
 const s=withWork(),id=workId(s);
 for(const avatar of ['W','w','7','\u{1F680}','\u{1F468}\u200D\u{1F4BB}','\u00C9','\u4E2D'])assert.doesNotThrow(()=>validateAction({type:'browser.profile.update',id,avatar},s),avatar);
 assert.doesNotThrow(()=>validateAction({type:'browser.profile.update',id,avatar:null},s));
 assert.doesNotThrow(()=>validateAction({type:'browser.profile.update',id,color:'#aabbcc',avatar:'W'},s));
 for(const avatar of ['','WW','C:\\x','../x','<b>','\u{1F680}\u{1F680}','.',' ',{},5])assert.throws(()=>validateAction({type:'browser.profile.update',id,avatar},s),/avatar/i,JSON.stringify(avatar));
 assert.throws(()=>validateAction({type:'browser.profile.update',id},s),/colour or an avatar/i);
 assert.throws(()=>validateAction({type:'browser.profile.update',id,color:'#abc'},s),/colour/i);
});

test('update changes the profile and keeps the avatar through save and restore',()=>{
 let s=withWork();const id=workId(s);
 s=reduceBrowser(s,{type:'browser.profile.update',id,color:'#336699',avatar:'W'});
 const profile=s.browserProfiles.find(p=>p.id===id);assert.deepEqual([profile.color,profile.avatar],['#336699','W']);
 const restored=require('../desktop/runtime.cjs').restoreSnapshot(JSON.parse(JSON.stringify(s)));
 assert.equal(restored.browserProfiles.find(p=>p.id===id).avatar,'W');
 s=reduceBrowser(s,{type:'browser.profile.update',id,avatar:null});assert.equal(s.browserProfiles.find(p=>p.id===id).avatar,undefined);
 assert.equal(reduceBrowser(s,{type:'browser.profile.update',id:'missing',color:'#112233'}),s,'unknown profile changes nothing');
});

const fakeController=(state,extra={})=>({privateMode:false,closing:false,state,ready:Promise.resolve(true),auxiliaries:new Map(),toastText:[],toast(text){this.toastText.push(text);},closePage:async()=>true,commitAction(action){this.state=reduceBrowser(this.state,action);},save(){},window:null,...extra});
const lifecycle=(controllers,extra={})=>createProfileLifecycle({controllers:new Set(controllers),database:{removeProfile(){}},electronSession:{fromPartition:()=>({clearStorageData:async()=>{},clearCache:async()=>{},clearAuthCache:async()=>{},clearHostResolverCache:()=>{},closeAllConnections:async()=>{},})},...extra});

test('removing the last regular profile is refused with a reason and changes nothing',async()=>{
 const controller=fakeController(createInitialState());
 const result=await lifecycle([controller]).remove('profile-personal',controller);
 assert.deepEqual([result.ok,result.reason],[false,'last-profile']);
 assert.equal(controller.state.browserProfiles.length,1);assert.match(controller.toastText.join(' '),/at least one profile/i);
});

test('private profiles and unknown ids are refused',async()=>{
 const state=withWork();state.browserProfiles.push({id:'private-1',name:'Private',color:'#000000',partition:'private-1',private:true});
 const controller=fakeController(state);
 assert.deepEqual(await lifecycle([controller]).remove('private-1',controller),{ok:false,reason:'private'});
 assert.deepEqual(await lifecycle([controller]).remove('nope',controller),{ok:false,reason:'unknown'});
 assert.deepEqual(await lifecycle([fakeController(state,{privateMode:true})]).remove(workId(state),fakeController(state,{privateMode:true})),{ok:false,reason:'private'});
});

test('removal commits in every window, erases storage and the partition folder, and reports ok',async()=>{
 const state=withWork(),id=workId(state),partition=state.browserProfiles.find(p=>p.id===id).partition;
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'acira-partitions-'));const folder=path.join(root,partition.replace(/^persist:/,''));fs.mkdirSync(folder);fs.writeFileSync(path.join(folder,'Cookies'),'x');
 const cleared=[],a=fakeController(structuredClone(state)),b=fakeController(structuredClone(state));
 const result=await lifecycle([a,b],{partitionsRoot:root,electronSession:{fromPartition:p=>({clearStorageData:async()=>{cleared.push(['storage',p]);},clearCache:async()=>{cleared.push(['cache',p]);},clearAuthCache:async()=>{},clearHostResolverCache:()=>{},closeAllConnections:async()=>{}})}}).remove(id,a);
 assert.equal(result.ok,true);assert.deepEqual(result.failures,[]);
 assert.ok(a.state.browserProfiles.every(p=>p.id!==id)&&b.state.browserProfiles.every(p=>p.id!==id),'every window drops the profile');
 assert.ok(cleared.some(c=>c[0]==='storage'&&c[1]===partition)&&cleared.some(c=>c[0]==='cache'));
 assert.equal(fs.existsSync(folder),false,'partition folder removed');
 fs.rmSync(root,{recursive:true,force:true});
});

test('a page that refuses to close vetoes removal before anything is erased',async()=>{
 let state=withWork();const id=workId(state);state=reduceBrowser(state,{type:'tab.new',url:'https://a.test/',browserProfileId:id});
 let erased=false;const controller=fakeController(state,{closePage:async()=>false});
 const result=await lifecycle([controller],{database:{removeProfile(){erased=true;}}}).remove(id,controller);
 assert.deepEqual([result.ok,result.reason],[false,'vetoed']);assert.equal(erased,false);assert.ok(controller.state.browserProfiles.some(p=>p.id===id));
});

test('a folder the engine still holds is removed by the next start sweep',async()=>{
 const {sweepRemovedPartitions}=require('../desktop/profile-lifecycle.cjs');
 const userData=fs.mkdtempSync(path.join(os.tmpdir(),'acira-sweep-')),folder=path.join(userData,'Partitions','acira-profile-gone');
 fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,'Cookies'),'x');fs.mkdirSync(path.join(userData,'Partitions','acira-browser-personal'));
 fs.writeFileSync(path.join(userData,'removed-partitions.json'),JSON.stringify({partitions:['persist:acira-profile-gone','not-a-partition','persist:../escape']}));
 assert.deepEqual(sweepRemovedPartitions(userData),[]);
 assert.equal(fs.existsSync(folder),false);assert.equal(fs.existsSync(path.join(userData,'Partitions','acira-browser-personal')),true,'other profiles are never touched');
 assert.equal(fs.existsSync(path.join(userData,'removed-partitions.json')),false);
 fs.rmSync(userData,{recursive:true,force:true});
});
