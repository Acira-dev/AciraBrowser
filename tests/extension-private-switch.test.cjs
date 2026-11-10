'use strict';
// "Allow in private tabs" (Settings › Extensions): off by default, asked once when turned on, remembered per extension, and what the manager does for a private
// session that runs the allowed extensions (attachPrivate / detachPrivate / leavePrivate). The real engine part is tests/private-extension-electron.test.cjs.
const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),os=require('node:os');
const {createExtensionManager,validateExtensionRequest,privateWantedFor}=require('../desktop/browser-services/extension-manager.cjs');
const sessions=require('../desktop/browser-services/private-extension-sessions.cjs');
const ID='abcdefghijklmnopabcdefghijklmnop',OTHER='ponmlkjihgfedcbaponmlkjihgfedcba';

function fixture({answer=1,entries}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'acira-ext-private-')),registryPath=path.join(dir,'extensions.json'),asked=[],loadedIn=[];
 const make=(id,name,version='1.0')=>{const folder=path.join(dir,'pkg',id);fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,'manifest.json'),JSON.stringify({manifest_version:3,name,version,permissions:['storage']}));return folder;};
 const list=entries||[{id:ID,profileId:'p',path:make(ID,'Vault'),name:'Vault',version:'1.0',permissions:['storage'],enabled:true,source:'Chrome Web Store'},{id:OTHER,profileId:'p',path:make(OTHER,'Other'),name:'Other',version:'1.0',permissions:['storage'],enabled:true,source:'Chrome Web Store'}];
 fs.writeFileSync(registryPath,JSON.stringify({version:2,entries:list}));
 const loaded=new Map();
 const api={getAllExtensions:()=>[...loaded.values()],loadExtension:async folder=>{const manifest=JSON.parse(fs.readFileSync(path.join(folder,'manifest.json'),'utf8')),id=folder.endsWith(OTHER)?OTHER:ID,extension={id,name:manifest.name,version:manifest.version,manifest};loaded.set(id,extension);return extension;},removeExtension:id=>{loaded.delete(id);}};
 const session={extensions:api,serviceWorkers:{getAllRunning:()=>({})}};
 const dialog={showMessageBox:async(win,options)=>{asked.push(options);return {response:answer};}};
 const manager=createExtensionManager({getSession:()=>session,getProfiles:()=>[{id:'p',name:'Personal',partition:'persist:p'}],getWindow:()=>null,dialog,registryPath,createRuntime:()=>({}),downloadPackage:async()=>{throw new Error('no network');}});
 const saved=()=>JSON.parse(fs.readFileSync(registryPath,'utf8')).entries;
 return {dir,registryPath,manager,asked,saved,loaded,api,session};
}
const fakePrivate=(dir,name='private-tab-1')=>{
 const folder=path.join(dir,'private-folder');fs.mkdirSync(folder,{recursive:true});
 const removed=[],loaded=new Map();
 const session={storagePath:folder,extensions:{getAllExtensions:()=>[...loaded.values()],loadExtension:async p=>{const manifest=JSON.parse(fs.readFileSync(path.join(p,'manifest.json'),'utf8')),id=p.endsWith(OTHER)?OTHER:ID,e={id,name:manifest.name,version:manifest.version,manifest};loaded.set(id,e);return e;},removeExtension:id=>{removed.push(id);loaded.delete(id);}},serviceWorkers:{getAllRunning:()=>({})}};
 return {folder,session,removed,loaded,profile:{id:name,name:'Private tab',partition:'persist:acira-private-ext-tab-x',private:true}};
};

test('the request is validated: a boolean "allowed" and nothing else',()=>{
 const profiles=[{id:'p'}];
 assert.deepEqual(validateExtensionRequest({type:'private',profileId:'p',extensionId:ID,allowed:true},profiles),{type:'private',profileId:'p',extensionId:ID,allowed:true});
 assert.throws(()=>validateExtensionRequest({type:'private',profileId:'p',extensionId:ID},profiles),/private browsing choice/);
 assert.throws(()=>validateExtensionRequest({type:'private',profileId:'p',extensionId:ID,allowed:'yes'},profiles),/private browsing choice/);
 assert.throws(()=>validateExtensionRequest({type:'private',profileId:'p',extensionId:ID,allowed:true,extra:1},profiles),/Unexpected/);
 assert.throws(()=>validateExtensionRequest({type:'private',profileId:'p',extensionId:'nope',allowed:true},profiles),/identity/);
 assert.throws(()=>validateExtensionRequest({type:'private',profileId:'nobody',extensionId:ID,allowed:true},profiles),/Unknown browsing profile/);
});

test('off by default; turning it on asks once (Cancel is the default), Cancel keeps it off, Allow remembers it, turning it off asks nothing',async()=>{
 const f=fixture({answer:0});
 try{
  let list=f.manager.list('p');assert.deepEqual(list.extensions.map(e=>e.privateAllowed),[false,false],'off for every extension until the person allows it');
  let result=await f.manager.command({type:'private',profileId:'p',extensionId:ID,allowed:true});
  assert.equal(result.cancelled,true);assert.equal(f.asked.length,1);
  const question=f.asked[0];assert.equal(question.type,'warning');assert.equal(question.defaultId,0);assert.equal(question.cancelId,0);assert.equal(question.buttons.length,2);
  assert.match(question.message,/Vault/);assert.match(question.detail,/private/i);
  assert.equal(f.saved().find(e=>e.id===ID).allowPrivate,undefined,'Cancel changed nothing');
  f.asked.length=0;
  const allow=fixture({answer:1});
  try{
   result=await allow.manager.command({type:'private',profileId:'p',extensionId:ID,allowed:true});
   assert.equal(allow.asked.length,1);assert.deepEqual(result.extensions.map(e=>[e.id,e.privateAllowed]),[[ID,true],[OTHER,false]],'only that extension');
   assert.equal(allow.saved().find(e=>e.id===ID).allowPrivate,true);assert.equal(allow.saved().find(e=>e.id===OTHER).allowPrivate,undefined);
   await allow.manager.command({type:'private',profileId:'p',extensionId:ID,allowed:true});assert.equal(allow.asked.length,1,'already on: not asked again');
   result=await allow.manager.command({type:'private',profileId:'p',extensionId:ID,allowed:false});assert.equal(allow.asked.length,1,'turning it off asks nothing');
   assert.equal(result.extensions.find(e=>e.id===ID).privateAllowed,false);assert.equal(allow.saved().find(e=>e.id===ID).allowPrivate,undefined);
  }finally{fs.rmSync(allow.dir,{recursive:true,force:true});}
 }finally{fs.rmSync(f.dir,{recursive:true,force:true});}
});

test('the choice survives Reload, and an extension that is off is not wanted in private',async()=>{
 const f=fixture({answer:1});
 try{
  await f.manager.command({type:'private',profileId:'p',extensionId:ID,allowed:true});
  assert.equal(f.manager.privateWanted('p'),true);assert.equal(privateWantedFor(f.registryPath,'p'),true);assert.equal(privateWantedFor(f.registryPath,'someone-else'),false);
  await f.manager.command({type:'reload',profileId:'p',extensionId:ID});
  assert.equal(f.saved().find(e=>e.id===ID).allowPrivate,true,'a reload keeps the choice');
  await f.manager.command({type:'disable',profileId:'p',extensionId:ID});
  assert.equal(f.manager.privateWanted('p'),false,'turned off: nothing to run in private');assert.equal(privateWantedFor(f.registryPath,'p'),false);
  assert.equal(f.saved().find(e=>e.id===ID).allowPrivate,true,'the switch itself is kept for when it is turned on again');
 }finally{fs.rmSync(f.dir,{recursive:true,force:true});}
});

test('nothing is wanted until an extension is allowed: private sessions stay memory-only by default',()=>{
 const f=fixture();
 try{assert.equal(f.manager.privateWanted('p'),false);assert.equal(privateWantedFor(f.registryPath,'p'),false);assert.equal(privateWantedFor(path.join(f.dir,'missing.json'),'p'),false);assert.equal(privateWantedFor(f.registryPath,undefined),false);}
 finally{fs.rmSync(f.dir,{recursive:true,force:true});}
});

test('attachPrivate loads only the allowed, enabled extensions of that profile into the private session, as installed, with their settings copied in first',async()=>{
 const f=fixture({answer:1});
 try{
  await f.manager.command({type:'private',profileId:'p',extensionId:ID,allowed:true});
  const priv=fakePrivate(f.dir),fromStorage=path.join(f.dir,'ordinary-storage');
  fs.mkdirSync(path.join(fromStorage,'Local Extension Settings',ID),{recursive:true});fs.writeFileSync(path.join(fromStorage,'Local Extension Settings',ID,'000003.log'),'settings');
  fs.mkdirSync(path.join(fromStorage,'Local Storage','leveldb'),{recursive:true});fs.writeFileSync(path.join(fromStorage,'Local Storage','leveldb','000003.log'),'a website');
  const result=await f.manager.attachPrivate({session:priv.session,profile:priv.profile,sourceProfileId:'p',implementation:{},runtimeDir:path.join(priv.folder,'acira-runtime'),settingsFrom:fromStorage});
  assert.deepEqual(result,{loaded:[ID],failed:[]},'the other extension is not allowed, so it is not loaded');
  assert.deepEqual([...priv.loaded.keys()],[ID]);
  assert.equal(fs.readFileSync(path.join(priv.folder,'Local Extension Settings',ID,'000003.log'),'utf8'),'settings','the extension\'s own settings are there before it starts');
  assert.equal(fs.existsSync(path.join(priv.folder,'Local Storage')),false,'no website data is copied');
  const stateFile=path.join(priv.folder,'acira-runtime','extension-install-state',priv.profile.id+'.json');
  assert.deepEqual(JSON.parse(fs.readFileSync(stateFile,'utf8')).extensions,{[ID]:{version:'1.0'}},'recorded as installed, so it does not run its first-run page in every private tab');
  assert.equal(f.manager.isPrivateSession(priv.session),true);
  const again=await f.manager.attachPrivate({session:priv.session,profile:priv.profile,sourceProfileId:'p',implementation:{},runtimeDir:path.join(priv.folder,'acira-runtime')});
  assert.deepEqual(again,{loaded:[],failed:[]},'a session is attached once');
 }finally{fs.rmSync(f.dir,{recursive:true,force:true});}
});

test('attachPrivate refuses what must never run extensions: a Tor profile, a profile that is not private, a profile with nothing allowed',async()=>{
 const f=fixture({answer:1});
 try{
  await f.manager.command({type:'private',profileId:'p',extensionId:ID,allowed:true});
  const run=async(profile,source='p')=>{const priv=fakePrivate(f.dir,profile?.id||'x');return {result:await f.manager.attachPrivate({session:priv.session,profile,sourceProfileId:source,implementation:{},runtimeDir:path.join(priv.folder,'acira-runtime')}),priv};};
  const nothing={loaded:[],failed:[]};
  let r=await run({id:'private-tor',private:true,tor:true,partition:'p'});assert.deepEqual(r.result,nothing);assert.equal(r.priv.loaded.size,0);
  r=await run({id:'profile-personal',partition:'persist:p'});assert.deepEqual(r.result,nothing,'an ordinary profile is not a private session');
  r=await run({id:'private-x',private:true,partition:'persist:x'},'nobody');assert.deepEqual(r.result,nothing,'no extension of that profile is allowed');
  assert.equal(f.manager.isPrivateSession(r.priv.session),false);
 }finally{fs.rmSync(f.dir,{recursive:true,force:true});}
});

test('an extension that cannot start is reported by name and the others still load',async()=>{
 const f=fixture({answer:1});
 try{
  await f.manager.command({type:'private',profileId:'p',extensionId:ID,allowed:true});await f.manager.command({type:'private',profileId:'p',extensionId:OTHER,allowed:true});
  fs.rmSync(path.join(f.dir,'pkg',ID,'manifest.json'));
  const priv=fakePrivate(f.dir);
  const result=await f.manager.attachPrivate({session:priv.session,profile:priv.profile,sourceProfileId:'p',implementation:{},runtimeDir:path.join(priv.folder,'acira-runtime')});
  assert.deepEqual(result.loaded,[OTHER]);assert.equal(result.failed.length,1);assert.equal(result.failed[0].id,ID);assert.equal(result.failed[0].name,'Vault');
 }finally{fs.rmSync(f.dir,{recursive:true,force:true});}
});

test('turning the switch off, turning the extension off, or removing it takes it out of the open private sessions; detach ends the session\'s runtime',async()=>{
 const f=fixture({answer:1});
 try{
  await f.manager.command({type:'private',profileId:'p',extensionId:ID,allowed:true});
  const priv=fakePrivate(f.dir);
  await f.manager.attachPrivate({session:priv.session,profile:priv.profile,sourceProfileId:'p',implementation:{},runtimeDir:path.join(priv.folder,'acira-runtime')});
  assert.deepEqual([...priv.loaded.keys()],[ID]);
  await f.manager.command({type:'private',profileId:'p',extensionId:ID,allowed:false});assert.deepEqual(priv.removed,[ID],'the switch off');
  priv.loaded.set(ID,{id:ID});await f.manager.command({type:'private',profileId:'p',extensionId:ID,allowed:true});
  await f.manager.command({type:'disable',profileId:'p',extensionId:ID});assert.equal(priv.removed.filter(id=>id===ID).length,2,'the extension turned off');
  assert.equal(f.manager.detachPrivate(priv.session),true);assert.equal(f.manager.isPrivateSession(priv.session),false);assert.equal(f.manager.detachPrivate(priv.session),false,'detached once');
 }finally{fs.rmSync(f.dir,{recursive:true,force:true});}
});

test('the toolbar target of a private session lists its extensions that have a button, the pinned ones of the profile first',async()=>{
 const f=fixture({answer:1});
 try{
  await f.manager.command({type:'private',profileId:'p',extensionId:ID,allowed:true});
  const priv=fakePrivate(f.dir);
  await f.manager.attachPrivate({session:priv.session,profile:priv.profile,sourceProfileId:'p',implementation:{},runtimeDir:path.join(priv.folder,'acira-runtime')});
  priv.loaded.get(ID).manifest.action={default_popup:'popup.html'};
  const wc={id:7,session:priv.session,isDestroyed:()=>false,getURL:()=>'https://example.com/'};
  const target=f.manager.privateTarget(wc);
  assert.deepEqual([target.supported,target.profileId,target.partition,target.webContentsId,target.actionIds,target.pinnedIds],[true,priv.profile.id,priv.profile.partition,7,[ID],[]]);
  assert.equal(f.manager.privateTarget({...wc,getURL:()=>'acira://settings'}),null,'only on a website');
  assert.equal(f.manager.privateTarget({...wc,session:{}}),null,'a page of any other session has no private target');
 }finally{fs.rmSync(f.dir,{recursive:true,force:true});}
});

test('a private window with no website yet (its New Tab page) has the same buttons, with no tab (-1): pinned ones of the profile, only what the private session runs, none for any other session',async()=>{
 const f=fixture({answer:1});
 try{
  await f.manager.command({type:'private',profileId:'p',extensionId:ID,allowed:true});
  const priv=fakePrivate(f.dir);
  assert.equal(f.manager.privateProfileTarget(priv.session),null,'a session that runs no extension (not attached) has none');
  await f.manager.attachPrivate({session:priv.session,profile:priv.profile,sourceProfileId:'p',implementation:{},runtimeDir:path.join(priv.folder,'acira-runtime')});
  priv.loaded.get(ID).manifest.action={default_popup:'popup.html'};
  let target=f.manager.privateProfileTarget(priv.session);
  assert.deepEqual([target.supported,target.profileId,target.partition,target.webContentsId,target.actionIds,target.pinnedIds],[true,priv.profile.id,priv.profile.partition,-1,[ID],[]]);
  await f.manager.command({type:'pin',profileId:'p',extensionId:ID,pinned:true});
  target=f.manager.privateProfileTarget(priv.session);
  assert.deepEqual([target.webContentsId,target.pinnedIds],[-1,[ID]],'pinned in the profile: pinned on the private New Tab page too');
  assert.equal(f.manager.privateProfileTarget({}),null,'any other session has none');
  assert.equal(f.manager.privateProfileTarget(null),null);
  f.manager.detachPrivate(priv.session);
  assert.equal(f.manager.privateProfileTarget(priv.session),null,'a session that has ended has none');
 }finally{fs.rmSync(f.dir,{recursive:true,force:true});}
});

test('turning "Allow in private tabs" off in one window reaches the private session another window has open (one list of private sessions for the whole app)',async()=>{
 const a=fixture({answer:1});
 try{
  await a.manager.command({type:'private',profileId:'p',extensionId:ID,allowed:true});
  const priv=fakePrivate(a.dir);
  // window A's manager attaches the private session of a private window
  await a.manager.attachPrivate({session:priv.session,profile:priv.profile,sourceProfileId:'p',implementation:{},runtimeDir:path.join(priv.folder,'acira-runtime')});
  assert.deepEqual([...priv.loaded.keys()],[ID]);
  // window B has a manager of its own on the same extensions file
  const dialog={showMessageBox:async()=>({response:1})};
  const b=createExtensionManager({getSession:()=>a.session,getProfiles:()=>[{id:'p',name:'Personal',partition:'persist:p'}],getWindow:()=>null,dialog,registryPath:a.registryPath,createRuntime:()=>({}),downloadPackage:async()=>{throw new Error('no network');}});
  assert.equal(b.isPrivateSession(priv.session),true,'it knows the private session of the other window');
  await b.command({type:'private',profileId:'p',extensionId:ID,allowed:false});
  assert.deepEqual(priv.removed,[ID],'the extension left the private session of the other window');
  a.manager.detachPrivate(priv.session);
 }finally{fs.rmSync(a.dir,{recursive:true,force:true});}
});
