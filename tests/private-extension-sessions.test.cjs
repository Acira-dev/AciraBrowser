'use strict';
// The temporary private sessions that "Allow in private tabs" needs (browser-services/private-extension-sessions.cjs): the engine loads no extension into a memory-only
// session, so such a session is kept in a folder of Acira's own data folder, emptied by the same verified retirement, deleted when that finishes and swept at every start.
const {test}=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),path=require('node:path'),fs=require('node:fs'),os=require('node:os');
const sessions=require('../desktop/browser-services/private-extension-sessions.cjs');
const {seedPrivateStore,fileFor}=require('../desktop/browser-services/extension-chrome-settings.cjs');
const main=fs.readFileSync(path.join(__dirname,'..','desktop','main.cjs'),'utf8');
const ID='abcdefghijklmnopabcdefghijklmnop',OTHER='ponmlkjihgfedcbaponmlkjihgfedcba';
const tmp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'acira-private-ext-test-'));
const touch=(file,text='x')=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,text);};

test('a temporary partition is persistent by name (that is what lets an extension load) and unmistakably Acira\'s own',()=>{
 const tab=sessions.newPartition('tab'),window=sessions.newPartition('window');
 assert.match(tab,/^persist:acira-private-ext-tab-[0-9a-f-]{36}$/);assert.match(window,/^persist:acira-private-ext-window-[0-9a-f-]{36}$/);assert.notEqual(tab,sessions.newPartition('tab'));
 for(const ok of [tab,window])assert.equal(sessions.isPartition(ok),true);
 for(const no of ['acira-private-tab-x','persist:acira-browser-personal','persist:acira-private-ext-tab-x/../../y','persist:acira-private-ext-tab-x\\y','',null,undefined,5])assert.equal(sessions.isPartition(no),false,String(no));
 assert.throws(()=>sessions.create('persist:acira-browser-personal',{electron:{session:{fromPartition:()=>({})}}}),/temporary private partition/);
});

test('Tor and secured workspaces are never given one, whatever the switch says',()=>{
 assert.equal(sessions.neverFor({tor:true}),true);assert.equal(sessions.neverFor({privacy:'tor'}),true);assert.equal(sessions.neverFor({privacy:'secured'}),true);
 assert.equal(sessions.neverFor({privacy:'private'}),false);assert.equal(sessions.neverFor({}),false);assert.equal(sessions.neverFor(),false);
});

test('create makes the session with its cache off and remembers it; a session of another kind is never mistaken for one',()=>{
 const calls=[],fake={isPersistent:()=>true,storagePath:'/x/Partitions/acira-private-ext-tab-1'},partition=sessions.newPartition('tab');
 const made=sessions.create(partition,{electron:{session:{fromPartition:(name,options)=>{calls.push([name,options]);return fake;}}}});
 assert.equal(made,fake);assert.deepEqual(calls,[[partition,{cache:false}]]);
 assert.equal(sessions.isTemporary(fake),true);assert.equal(sessions.sessionOf(partition),fake);assert.equal(sessions.folderOf(fake),'/x/Partitions/acira-private-ext-tab-1');
 const ordinary={isPersistent:()=>true},memory={isPersistent:()=>false};
 assert.equal(sessions.isTemporary(ordinary),false);assert.equal(sessions.persistent(ordinary),true,'an ordinary profile is still persistent');
 assert.equal(sessions.persistent(fake),false,'a temporary private session counts as the private, ephemeral kind');assert.equal(sessions.persistent(memory),false);
 assert.equal(sessions.isTemporary(null),false);assert.equal(sessions.folderOf({}),null);
});

test('removeFolder deletes only the temporary folder of a session, never anything else under the profile',()=>{
 const userData=tmp();
 try{
  const mine=path.join(userData,'Partitions','acira-private-ext-tab-aaaa'),personal=path.join(userData,'Partitions','acira-browser-personal'),outside=path.join(userData,'elsewhere','acira-private-ext-tab-bbbb');
  for(const folder of [mine,personal,outside])touch(path.join(folder,'Cookies'));
  assert.equal(sessions.removeFolder(userData,{storagePath:mine}),true);assert.equal(fs.existsSync(mine),false);
  assert.equal(sessions.removeFolder(userData,{storagePath:personal}),false,'an ordinary profile\'s folder');assert.equal(fs.existsSync(personal),true);
  assert.equal(sessions.removeFolder(userData,{storagePath:outside}),false,'a folder that merely has the name');assert.equal(fs.existsSync(outside),true);
  assert.equal(sessions.removeFolder(userData,{storagePath:path.join(userData,'Partitions')}),false,'not the whole Partitions folder');
  assert.equal(sessions.removeFolder(userData,{}),false);assert.equal(sessions.removeFolder(userData,null),false);
 }finally{fs.rmSync(userData,{recursive:true,force:true});}
});

test('Chromium writes again a little after the delete, so the folder is deleted again; the sweep at start and at quit takes whatever is left',async()=>{
 const userData=tmp();
 try{
  const folder=path.join(userData,'Partitions','acira-private-ext-tab-cccc');touch(path.join(folder,'Cookies'));
  sessions.removeSoon(userData,{storagePath:folder},{delays:[40,120]});assert.equal(fs.existsSync(folder),false,'deleted at once');
  touch(path.join(folder,'Network Persistent State'),'{"hosts":1}');assert.equal(fs.existsSync(folder),true,'the late write');
  await new Promise(resolve=>setTimeout(resolve,80));assert.equal(fs.existsSync(folder),false,'deleted again');
  touch(path.join(folder,'Network Persistent State'));await new Promise(resolve=>setTimeout(resolve,100));assert.equal(fs.existsSync(folder),false,'and once more');
  const keep=path.join(userData,'Partitions','acira-browser-personal'),b=path.join(userData,'Partitions','acira-private-ext-window-dddd'),c=path.join(userData,'Partitions','ACIRA-PRIVATE-EXT-tab-eeee');
  for(const f of [keep,b,c])touch(path.join(f,'Cookies'));
  assert.equal(sessions.sweep(userData),2);assert.equal(fs.existsSync(b)||fs.existsSync(c),false);assert.equal(fs.existsSync(keep),true,'the ordinary profile stays');
  assert.equal(sessions.sweep(path.join(userData,'missing')),0);
 }finally{fs.rmSync(userData,{recursive:true,force:true});}
});

test('the extension\'s own data is copied in one way: its settings and its IndexedDB, never a website\'s data, never the lock',()=>{
 const from=tmp(),to=tmp();
 try{
  touch(path.join(from,'Local Extension Settings',ID,'000003.log'),'options');touch(path.join(from,'Local Extension Settings',ID,'LOCK'),'held');
  touch(path.join(from,'Sync Extension Settings',ID,'000003.log'),'sync');
  touch(path.join(from,'IndexedDB',`chrome-extension_${ID}_0.indexeddb.leveldb`,'000003.log'),'selected profile');
  touch(path.join(from,'IndexedDB',`chrome-extension_${ID}_0.indexeddb.blob`,'1','00'),'blob');
  touch(path.join(from,'IndexedDB',`chrome-extension_${OTHER}_0.indexeddb.leveldb`,'000003.log'),'another extension');
  touch(path.join(from,'IndexedDB','https_example.com_0.indexeddb.leveldb','000003.log'),'a website');
  touch(path.join(from,'Local Storage','leveldb','000003.log'),'websites');touch(path.join(from,'Cookies'),'cookies');touch(path.join(from,'Local Extension Settings',OTHER,'000003.log'),'another');
  const copied=sessions.copySettings(from,to,ID);
  assert.deepEqual(copied.sort(),['IndexedDB/chrome-extension_'+ID+'_0.indexeddb.blob','IndexedDB/chrome-extension_'+ID+'_0.indexeddb.leveldb','Local Extension Settings/'+ID,'Sync Extension Settings/'+ID].sort());
  assert.equal(fs.readFileSync(path.join(to,'Local Extension Settings',ID,'000003.log'),'utf8'),'options');
  assert.equal(fs.existsSync(path.join(to,'Local Extension Settings',ID,'LOCK')),false,'a copy never carries the open database\'s lock');
  assert.equal(fs.readFileSync(path.join(to,'IndexedDB',`chrome-extension_${ID}_0.indexeddb.leveldb`,'000003.log'),'utf8'),'selected profile');
  for(const never of ['Local Storage','Cookies',path.join('IndexedDB','https_example.com_0.indexeddb.leveldb'),path.join('IndexedDB',`chrome-extension_${OTHER}_0.indexeddb.leveldb`),path.join('Local Extension Settings',OTHER)])assert.equal(fs.existsSync(path.join(to,never)),false,never);
  fs.writeFileSync(path.join(to,'Local Extension Settings',ID,'000003.log'),'changed in private');
  assert.equal(fs.readFileSync(path.join(from,'Local Extension Settings',ID,'000003.log'),'utf8'),'options','nothing goes back');
 }finally{fs.rmSync(from,{recursive:true,force:true});fs.rmSync(to,{recursive:true,force:true});}
});

test('copying never throws: no source, a bad id, the same folder, a folder that is not there',()=>{
 const base=tmp();
 try{
  assert.deepEqual(sessions.copySettings(null,base,ID),[]);assert.deepEqual(sessions.copySettings(base,null,ID),[]);assert.deepEqual(sessions.copySettings(base,base,ID),[]);
  assert.deepEqual(sessions.copySettings(base,path.join(base,'to'),'../../etc'),[]);assert.deepEqual(sessions.copySettings(path.join(base,'missing'),path.join(base,'to'),ID),[]);
 }finally{fs.rmSync(base,{recursive:true,force:true});}
});

test('what the allowed extensions hold in the settings store (a proxy) starts in the private session\'s own store, only theirs, one way',()=>{
 const from=tmp(),to=tmp();
 try{
  const file=fileFor(from,'profile-personal');fs.mkdirSync(path.dirname(file),{recursive:true});
  fs.writeFileSync(file,JSON.stringify({version:1,installed:{[ID]:5,[OTHER]:9},names:{[ID]:'Vault',[OTHER]:'Other'},prefs:{proxy:{[ID]:{regular:{mode:'fixed_servers'}},[OTHER]:{regular:{mode:'direct'}}},privacy:{[OTHER]:{regular:{x:1}}}}}));
  assert.equal(seedPrivateStore({userData:from,fromKey:'profile-personal',toUserData:to,toKey:'private-tab-1',extensionIds:[ID]}),true);
  const seeded=JSON.parse(fs.readFileSync(fileFor(to,'private-tab-1'),'utf8'));
  assert.deepEqual(seeded,{version:1,installed:{[ID]:5},names:{[ID]:'Vault'},prefs:{proxy:{[ID]:{regular:{mode:'fixed_servers'}}}}});
  assert.equal(seedPrivateStore({userData:from,fromKey:'nobody',toUserData:to,toKey:'private-tab-2',extensionIds:[ID]}),false,'no store yet: nothing to copy, no error');
 }finally{fs.rmSync(from,{recursive:true,force:true});fs.rmSync(to,{recursive:true,force:true});}
});

test('the verified retirement accepts a temporary private session as the folder kind it is, and refuses every other mismatch',()=>{
 const {createPrivateSessionRetirement}=require('../desktop/browser-services/private-session-retirement.cjs');
 const make=persistent=>{const events={},cookies=Object.assign(new EventEmitter(),{get:async()=>[],flushStore:async()=>{}}),serviceWorkers=Object.assign(new EventEmitter(),{getAllRunning:()=>({})});
  const session={isPersistent:()=>persistent,cookies,serviceWorkers,webRequest:{onBeforeRequest:(_f,h)=>events.before=h,onHeadersReceived:()=>{},onCompleted:()=>{},onErrorOccurred:()=>{}},closeAllConnections:async()=>{},clearStorageData:async()=>{},clearCache:async()=>{},clearAuthCache:async()=>{}};return session;};
 const pipelineFor=session=>({session,holdNetwork:()=>()=>{},sealNetwork:()=>{},networkStatus:()=>({retired:false}),hasActiveRequests:()=>false});
 const service=createPrivateSessionRetirement({getPipeline:context=>pipelineFor(context.session),hasLastOwner:()=>true,getAllContents:()=>[],quiesceOwners:async()=>{},createControlPage:async()=>{throw new Error('not needed');}});
 const context=(session,partition)=>({session,profileId:'private-tab-1',partition,ownerId:'tab-1',privateMode:true});
 const temp=make(true);sessions.create('persist:acira-private-ext-tab-ret',{electron:{session:{fromPartition:()=>temp}}});
 const ticket=service.begin(context(temp,'persist:acira-private-ext-tab-ret'));assert.equal(ticket.phase,'prepared');service.cancel(ticket);
 assert.throws(()=>service.begin(context(make(true),'persist:acira-browser-personal')),/ephemeral/,'an ordinary persistent session is still refused');
 assert.throws(()=>service.begin(context(make(true),'persist:acira-private-ext-tab-unregistered')),/ephemeral/,'a persistent session nobody registered as temporary is refused');
 const memory=make(false);assert.doesNotThrow(()=>service.cancel(service.begin(context(memory,'acira-private-tab-x'))),'a memory-only session is as before');
 assert.throws(()=>service.begin(context(memory,'persist:acira-private-ext-tab-ret')),/ephemeral/,'a memory session under a persist: name is refused');
 const lying=make(false);sessions.create('persist:acira-private-ext-tab-lying',{electron:{session:{fromPartition:()=>lying}}});
 assert.throws(()=>service.begin(context(lying,'persist:acira-private-ext-tab-lying')),/ephemeral/,'a registered temporary session must really be kept in a folder');
});

test('the guards that read "persistent" treat a temporary private session as private: spelling, search providers, popup snapshots, storage durability',()=>{
 const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
 for(const file of ['desktop/browser-services/spellcheck-policy.cjs','desktop/browser-services/search-providers.cjs','desktop/popup-snapshot.cjs','desktop/storage-durability.cjs'])
  assert.ok(read(file).includes("private-extension-sessions.cjs').persistent("),file+' asks private-extension-sessions for persistence');
 assert.ok(!/[^.]\bsession\.isPersistent\(\)/.test(read('desktop/browser-services/spellcheck-policy.cjs').replace(/typeof session\?\.isPersistent/g,'')),'spellcheck-policy has no raw isPersistent() left');
});

test('main.cjs: a private tab gets one only when it is a plain private tab of a profile with an extension allowed, never Tor, never secured',()=>{
 assert.ok(main.includes("const source=tab.privacy==='private'&&!privateMode&&!torMode&&!privateTemporary.neverFor({tor:torMode,privacy:tab.privacy})&&extensionManager?.privateWanted(tab.browserProfileId)?tab.browserProfileId:null;"),'the one condition for a private tab');
 assert.ok(main.includes("partition:source?privateTemporary.newPartition('tab'):'acira-private-tab-'+randomUUID()"),'otherwise the memory-only partition, exactly as before');
 assert.ok(main.includes("extSource=torMode?null:"),'a Tor window never asks');
 assert.ok(main.includes("partition:withExtensions?privateTemporary.newPartition('window'):'acira-private-'+randomUUID()"),'a private window: a temporary session only when something is allowed');
 assert.ok(main.includes("require('./browser-services/extension-manager.cjs').privateWantedFor(path.join(app.getPath('userData'),'extensions.json'),extSource)"),'decided from the saved list, before the window has a manager');
 assert.ok(main.includes("entry.privateTab&&profile.extensionsFrom&&privateTemporary.isTemporary(wc.session)"),'extensions load before a private page loads (entry.ready), and only into a temporary session');
});

test('main.cjs: the extensions leave and the folder goes with the session: tab close, window close, retirement complete, start and quit',()=>{
 assert.ok(main.includes("if(privateTemporary.isTemporary(session))endPrivateExtensions(session);"),'a private tab that ends');
 assert.ok(main.includes("if(privateProfile.extensionsFrom){try{endPrivateExtensions("),'a private window that closes');
 assert.ok(main.includes("privateTemporary.removeSoon(app.getPath('userData'),own)"),'when the retirement completes');
 assert.ok(main.includes("try{privateTemporary.sweep(app.getPath('userData'));}catch{}/* a temporary private session of an earlier run"),'swept at start');
 assert.ok(main.includes("app.on('quit',()=>{quitting=true;try{privateTemporary.sweep(app.getPath('userData'));}catch{}"),'and at quit');
 assert.ok(main.includes("await startPrivateExtensions(state.browserProfiles[0]);\n attachReadyExtensionProfiles();"),'a private window loads them before its pages are allowed');
 const retire=main.slice(main.indexOf('function endPrivateExtensions'),main.indexOf('function retirePrivateTab'));
 assert.ok(/detachPrivate\(ses\)/.test(retire)&&/wc\.close\(/.test(retire),'unloaded, then every page of that session closed so the retirement can finish');
});

test('without a tab model (a private session) a tab id is its page id, so tabs.sendMessage reaches content scripts',async()=>{
 const tabs=require('../desktop/browser-services/ext-api/tabs.cjs');
 const handlers=new Map(),page={id:42,isDestroyed:()=>false};
 const api={store:()=>({impl:{},getTabById:id=>id===42?page:undefined}),log:()=>{},handle:(name,fn)=>handlers.set(name,fn)};
 assert.deepEqual(tabs.install(api),{});
 const pageId=handlers.get('acira.tabs.pageId');assert.equal(typeof pageId,'function');
 assert.equal(pageId({},42),42);assert.equal(pageId({},7),null,'an unknown tab');
 page.isDestroyed=()=>true;assert.equal(pageId({},42),null,'a closed page');
});
