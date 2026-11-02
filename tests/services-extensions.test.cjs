'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createExtensionManager,validateExtensionRequest}=require('../desktop/extensions.cjs');
function fixture(){fs.mkdirSync(path.resolve('.qa-profiles/services-unit'),{recursive:true});const root=fs.mkdtempSync(path.resolve('.qa-profiles/services-unit/extensions-')),folder=path.join(root,'unpacked');fs.mkdirSync(folder);fs.writeFileSync(path.join(folder,'manifest.json'),JSON.stringify({name:'Fixture extension',version:'1.0',manifest_version:3,permissions:['storage'],action:{}}));const profiles=[{id:'A',name:'A',partition:'persist:fixtureA'},{id:'B',name:'B',partition:'persist:fixtureB'},{id:'private-one',name:'Private',partition:'private-one',private:true}],sessions=new Map(),calls=[];for(const profile of profiles){const loaded=[];sessions.set(profile.partition,{extensions:{getAllExtensions:()=>loaded,loadExtension:async directory=>{const manifest=JSON.parse(fs.readFileSync(path.join(directory,'manifest.json'))),extension={id:'a'.repeat(32),name:manifest.name,version:manifest.version,manifest};loaded.push(extension);return extension;},removeExtension:id=>{loaded.splice(loaded.findIndex(e=>e.id===id),1);}}});}const options={getSession:partition=>sessions.get(partition),getProfiles:()=>profiles,getWindow:()=>({}),dialog:{showOpenDialog:async()=>({filePaths:[folder]}),showMessageBox:async(_w,details)=>{calls.push(details);return {response:1};}},registryPath:path.join(root,'extensions.json'),createRuntime:()=>({addTab(){},removeTab(){},selectTab(){},getContextMenuItems:()=>[]})};return {options,calls,sessions,folder,root,manager:createExtensionManager(options)};}
test('local extension lifecycle reviews access, persists disable/pin state and separates profiles/private',async()=>{const f=fixture();let state=await f.manager.command({type:'load',profileId:'A'});assert.equal(state.extensions[0].enabled,true);assert.equal(f.calls.length,1);assert.deepEqual(state.extensions[0].permissions,['storage']);await f.manager.command({type:'pin',profileId:'A',extensionId:'a'.repeat(32),pinned:true});await f.manager.command({type:'disable',profileId:'A',extensionId:'a'.repeat(32)});const second=createExtensionManager(f.options);await second.restore();assert.equal(second.list('A').extensions[0].status,'disabled');assert.equal(second.list('B').extensions.length,0);assert.equal(second.list('private-one').supported,false);await f.manager.command({type:'enable',profileId:'A',extensionId:'a'.repeat(32)});assert.equal(f.manager.list('A').extensions[0].pinned,true);await assert.rejects(f.manager.command({type:'remove',profileId:'B',extensionId:'a'.repeat(32)}),/does not belong/);await f.manager.command({type:'remove',profileId:'A',extensionId:'a'.repeat(32)});assert.equal(f.manager.list('A').extensions.length,0);assert.equal(fs.existsSync(f.folder),true,'Uninstall never deletes a user-selected local source folder');});
test('extension requests cannot inject filesystem paths or ambiguous identities',()=>{assert.throws(()=>validateExtensionRequest({type:'load',profileId:'A',path:'C:/sensitive'},[{id:'A'}]),/Unexpected/);assert.throws(()=>validateExtensionRequest({type:'install',profileId:'A',extensionId:'../oops'},[{id:'A'}]),/identity/);assert.throws(()=>validateExtensionRequest({type:'pin',profileId:'A',extensionId:'a'.repeat(32),pinned:'yes'},[{id:'A'}]),/pin/);});

test('the profile session\'s extensions emitter allows the extension packages\' listeners without a leak warning, and loading, reloading and removing add none',async()=>{
 const {EventEmitter}=require('node:events'),{EXTENSION_EVENT_LISTENERS}=require('../desktop/extensions.cjs'),f=fixture(),session=f.sessions.get('persist:fixtureA');
 const emitter=Object.assign(new EventEmitter(),session.extensions);session.extensions=emitter;
 assert.equal(emitter.getMaxListeners(),10,'Node\'s default before the manager touches the session');
 await f.manager.command({type:'list',profileId:'A'});
 assert.equal(emitter.getMaxListeners(),EXTENSION_EVENT_LISTENERS,'raised once, when the profile\'s runtime is made');
 // The packages that listen for extension-unloaded in the real app (15 counted in the running app) add theirs at start.
 const warnings=[],onWarning=warning=>warnings.push(warning);process.on('warning',onWarning);
 for(let i=0;i<15;i++){emitter.on('extension-unloaded',()=>{});emitter.on('extension-loaded',()=>{});}
 const settled=emitter.listenerCount('extension-unloaded');
 for(let i=0;i<10;i++){
  const state=await f.manager.command({type:i%2?'load':'enable',profileId:'A',extensionId:'a'.repeat(32)}).catch(()=>null);
  const id=state?.extensions?.[0]?.id||'a'.repeat(32);
  await f.manager.command({type:'remove',profileId:'A',extensionId:id}).catch(()=>null);
 }
 await new Promise(resolve=>setImmediate(resolve));process.removeListener('warning',onWarning);
 assert.equal(emitter.listenerCount('extension-unloaded'),settled,'install and remove cycles add no listener');
 assert.deepEqual(warnings.filter(warning=>/MaxListeners/.test(warning.name)),[],'no warning for the steady count');
 for(let i=0;i<EXTENSION_EVENT_LISTENERS;i++)emitter.on('extension-unloaded',()=>{});
 assert.ok(emitter.listenerCount('extension-unloaded')>EXTENSION_EVENT_LISTENERS,'a real leak is still over the limit');
});
