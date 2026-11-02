'use strict';
// Removing an extension asks first (Chrome does; one click removed it at once), says its data goes with it, and then deletes that data, as Chrome's
// uninstall does (Electron's removeExtension only unloads it: a password manager's local data stayed on disk and came back when it was added again).
const {test}=require('node:test'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process'),path=require('node:path'),fs=require('node:fs'),os=require('node:os'),{createHash}=require('node:crypto');
const {createExtensionManager}=require('../desktop/browser-services/extension-manager.cjs');
const electron=(()=>{try{const value=require('electron');return typeof value==='string'&&fs.existsSync(value)?value:null;}catch{return null;}})();
const ID='abcdefghijklmnopabcdefghijklmnop';

/** A manager over a fake profile session: one Web Store extension, loaded, its unpacked package in Acira's own folder. Records what happens, in order. */
function fixture({dialogAnswer=1,behaviour={clear:true,failed:[]}}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'acira-ext-remove-')),registryPath=path.join(dir,'extensions.json'),calls=[],asked=[];
 const pkg=path.join(dir,'extension-packages',createHash('sha256').update('p').digest('hex').slice(0,8),ID,'v1');fs.mkdirSync(pkg,{recursive:true});
 fs.writeFileSync(path.join(pkg,'manifest.json'),JSON.stringify({manifest_version:3,name:'Vault',version:'1.0',permissions:['storage']}));
 fs.writeFileSync(registryPath,JSON.stringify({version:2,entries:[{id:ID,profileId:'p',path:pkg,name:'Vault',version:'1.0',permissions:['storage'],enabled:true,source:'Chrome Web Store'}]}));
 let loaded=[{id:ID,name:'Vault',version:'1.0',manifest:{manifest_version:3,name:'Vault',version:'1.0',permissions:['storage']}}];
 const api={getAllExtensions:()=>loaded,loadExtension:async()=>{const again={id:ID,name:'Vault',version:'1.0',manifest:{manifest_version:3,name:'Vault',version:'1.0',permissions:['storage']}};loaded=[...loaded.filter(e=>e.id!==ID),again];return again;},removeExtension:id=>{calls.push('unload '+id);loaded=loaded.filter(e=>e.id!==id);}};
 const downloadPackage=async(id,folder)=>{fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,'manifest.json'),JSON.stringify({manifest_version:3,name:'Vault',version:'1.0',permissions:['storage']}));return {path:folder,source:'Chrome Web Store',packageHash:'h'+Date.now(),publisherVerified:true};};
 const session={extensions:api,serviceWorkers:{getAllRunning:()=>({})}};
 const extensionData={clearStorageAreas:async(s,id)=>{calls.push('clear chrome.storage '+id+(loaded.some(e=>e.id===id)?' (loaded)':''));return behaviour.clear;},deleteExtensionData:async(s,id)=>{calls.push('delete origin data '+id);return behaviour.failed;}};
 const dialog={showMessageBox:async(win,options)=>{asked.push(options);calls.push('asked');return {response:dialogAnswer};}};
 const manager=createExtensionManager({getSession:()=>session,getProfiles:()=>[{id:'p',name:'Personal',partition:'persist:p'}],getWindow:()=>null,dialog,registryPath,createRuntime:()=>({}),extensionData,downloadPackage});
 return {dir,pkg,registryPath,calls,asked,manager,behaviour,pending:()=>JSON.parse(fs.readFileSync(registryPath,'utf8')).pendingData||[]};
}

test('Remove empties chrome.storage while the extension runs, unloads it, then deletes its origin data and its unpacked package',async()=>{
 const f=fixture();
 try{
  const result=await f.manager.command({type:'remove',profileId:'p',extensionId:ID});
  assert.equal(result.error,undefined);assert.deepEqual(result.extensions,[]);
  assert.deepEqual(f.calls,['asked','clear chrome.storage '+ID+' (loaded)','unload '+ID,'delete origin data '+ID]);
  assert.equal(fs.existsSync(f.pkg),false,'the Web Store package Acira unpacked is gone');
  assert.deepEqual(JSON.parse(fs.readFileSync(f.registryPath,'utf8')).entries,[]);
 }finally{fs.rmSync(f.dir,{recursive:true,force:true});}
});

test('Remove asks first in Acira\'s dialog, Cancel is the default and keeps the extension, its data and its package',async()=>{
 const f=fixture({dialogAnswer:0});
 try{
  const result=await f.manager.command({type:'remove',profileId:'p',extensionId:ID});
  assert.equal(result.cancelled,true);assert.deepEqual(result.extensions.map(e=>[e.id,e.status]),[[ID,'loaded']]);
  assert.deepEqual(f.calls,['asked'],'nothing unloaded or deleted');assert.equal(fs.existsSync(f.pkg),true);
  assert.equal(JSON.parse(fs.readFileSync(f.registryPath,'utf8')).entries.length,1);
  const [options]=f.asked;
  assert.deepEqual({type:options.type,title:options.title,message:options.message,detail:options.detail,buttons:options.buttons,defaultId:options.defaultId,cancelId:options.cancelId},
   {type:'warning',title:'Remove extension',message:'Remove Vault from Acira?',detail:'The data it keeps in this profile is deleted with it, such as a password manager’s local data. This can’t be undone.',buttons:['Cancel','Remove'],defaultId:0,cancelId:0});
 }finally{fs.rmSync(f.dir,{recursive:true,force:true});}
});

test('chrome.management.uninstall asked already: the manager does not ask a second time',async()=>{
 const f=fixture({dialogAnswer:0});
 try{await f.manager.command({type:'remove',profileId:'p',extensionId:ID},{confirmed:true});assert.equal(f.asked.length,0);assert.equal(f.calls.includes('unload '+ID),true);}
 finally{fs.rmSync(f.dir,{recursive:true,force:true});}
});

test('a deletion that fails partway still removes the extension; the leftovers are deleted at the next start, unless it was added again',async()=>{
 for(const failure of [{clear:true,failed:['origin']},{clear:false,failed:[]}]){
  const f=fixture({behaviour:{...failure}});
  try{
   const result=await f.manager.command({type:'remove',profileId:'p',extensionId:ID});
   assert.deepEqual(result.extensions,[],'removed anyway');assert.deepEqual(f.pending(),[{profileId:'p',id:ID}],'remembered on disk: '+JSON.stringify(failure));
   f.calls.length=0;f.behaviour.clear=true;f.behaviour.failed=[];
   await f.manager.restore();
   assert.deepEqual(f.calls,['delete origin data '+ID],'retried at the next start');assert.deepEqual(f.pending(),[]);
   await f.manager.restore();assert.deepEqual(f.calls,['delete origin data '+ID],'once done, not again');
  }finally{fs.rmSync(f.dir,{recursive:true,force:true});}
 }
 const f=fixture({behaviour:{clear:true,failed:['origin']}});
 try{
  await f.manager.command({type:'remove',profileId:'p',extensionId:ID});assert.equal(f.pending().length,1);
  const back=await f.manager.command({type:'install',profileId:'p',extensionId:ID});assert.equal(back.error,undefined);assert.deepEqual(back.extensions.map(e=>e.id),[ID],'added again before a restart');
  assert.deepEqual(f.pending(),[],'its new data is not queued for deletion');
  f.calls.length=0;await f.manager.restore();assert.equal(f.calls.includes('delete origin data '+ID),false,'nothing deleted at the next start');
 }finally{fs.rmSync(f.dir,{recursive:true,force:true});}
});

test('the data deleted is the extension\'s own only: its origin storage without cookies, its chrome.storage folders; other extensions and the profile\'s site data stay',async()=>{
 const {deleteExtensionData,ORIGIN_STORAGES}=require('../desktop/browser-services/extension-data.cjs');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'acira-ext-data-')),OTHER='ponmlkjihgfedcbaponmlkjihgfedcba',calls=[];
 try{
  for(const folder of ['Local Extension Settings','Sync Extension Settings'])for(const id of [ID,OTHER]){fs.mkdirSync(path.join(root,folder,id),{recursive:true});fs.writeFileSync(path.join(root,folder,id,'000003.log'),'x');}
  fs.mkdirSync(path.join(root,'Local Storage','leveldb'),{recursive:true});fs.writeFileSync(path.join(root,'Cookies'),'site cookies');
  const failed=await deleteExtensionData({storagePath:root,clearStorageData:async options=>{calls.push(options);}},ID);
  assert.deepEqual(failed,[]);assert.deepEqual(calls,[{origin:'chrome-extension://'+ID,storages:ORIGIN_STORAGES}]);assert.equal(ORIGIN_STORAGES.includes('cookies'),false);
  for(const storage of ['localstorage','indexdb','cachestorage','serviceworkers'])assert.ok(ORIGIN_STORAGES.includes(storage),storage);
  for(const folder of ['Local Extension Settings','Sync Extension Settings']){assert.equal(fs.existsSync(path.join(root,folder,ID)),false,folder);assert.equal(fs.existsSync(path.join(root,folder,OTHER)),true,'another extension keeps '+folder);}
  assert.equal(fs.readFileSync(path.join(root,'Cookies'),'utf8'),'site cookies');assert.ok(fs.existsSync(path.join(root,'Local Storage','leveldb')));
  assert.deepEqual(await deleteExtensionData({storagePath:root,clearStorageData:async()=>{throw new Error('busy');}},ID),['origin'],'a failure is reported, not thrown');
  assert.deepEqual(await deleteExtensionData({storagePath:root},'../../etc'),['identity']);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('electron: after Remove the extension\'s chrome.storage, localStorage and IndexedDB are gone, also when it is added again in the same run',{skip:!electron&&'Electron is not installed'},()=>{
 const run=spawnSync(electron,['--use-mock-keychain','--js-flags=--expose-gc',path.join(__dirname,'fixtures','extension-data','run.cjs')],{encoding:'utf8',timeout:120000,env:{...process.env,ELECTRON_RUN_AS_NODE:undefined,ELECTRON_ENABLE_LOGGING:'0'}});
 const line=String(run.stdout).split('\n').find(text=>text.startsWith('RESULT '));assert.ok(line,'runner output: '+String(run.stdout).slice(-600)+String(run.stderr).slice(-600));
 const result=JSON.parse(line.slice(7));fs.rmSync(result.root,{recursive:true,force:true});
 assert.equal(result.gc,true);assert.deepEqual(result.clears,[true,true,true,true,true],'the hidden page survives garbage collection (it failed at random in the app)');
 assert.deepEqual(result.control.afterReinstall,{storage:{vault:'secret'},localStorage:'kept',indexedDB:'kept'},'control: removeExtension alone keeps it all');
 assert.deepEqual(result.fixed.removed,{cleared:true,failed:[]});assert.equal(result.fixed.folderAfterRemove,false,'its chrome.storage folder is deleted');
 assert.deepEqual(result.fixed.afterReinstall,{storage:{},localStorage:null,indexedDB:null});
});
