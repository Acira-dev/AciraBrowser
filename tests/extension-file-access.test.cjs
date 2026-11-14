'use strict';
// "Allow access to file URLs" (Settings > Extensions), a Chrome switch per extension, off by default (desktop/browser-services/extension-file-access.cjs; the Chromium sources it
// ports are named there). A PDF viewer extension (PDF.js) reported on Windows: opening a local PDF said 'Click on "Allow access to file URLs" at chrome://extensions', and Acira's
// card had no such switch. The real-app proof with the real extension is in the report; these are the rules.
const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),os=require('node:os');
const {createExtensionManager,validateExtensionRequest,describe}=require('../desktop/browser-services/extension-manager.cjs');
const access=require('../desktop/browser-services/extension-file-access.cjs');
const ID='abcdefghijklmnopabcdefghijklmnop',OTHER='ponmlkjihgfedcbaponmlkjihgfedcba';
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');

test("which extensions get the switch: Chromium's wants_file_access (activeTab, a host pattern that reaches file:, a content script that does)",()=>{
 const yes=[
  {permissions:['activeTab']},
  {host_permissions:['<all_urls>']},
  {permissions:['storage','<all_urls>']},                  // MV2 style
  {host_permissions:['file:///*']},
  {host_permissions:['FILE:///c:/docs/*']},
  {optional_host_permissions:['<all_urls>']},
  {optional_permissions:['activeTab']},
  {content_scripts:[{matches:['https://a.test/*','file:///*'],js:['a.js']}]},
  {content_scripts:[{matches:['<all_urls>'],js:['a.js']}]}
 ];
 const no=[
  {},
  {permissions:['storage','tabs']},
  {host_permissions:['*://*/*']},                          // "*" narrows to http and https: it never reaches file: (url_pattern.cc SetScheme)
  {host_permissions:['https://*/*','http://example.com/*','ftp://x.test/*']},
  {content_scripts:[{matches:['*://*/*'],js:['a.js']}]},
  {content_scripts:[{matches:['https://*/*'],js:['a.js']}]},
  {permissions:'activeTab'},                                // not a list
  null
 ];
 for(const manifest of yes)assert.equal(access.wantsFileAccess(manifest),true,JSON.stringify(manifest));
 for(const manifest of no)assert.equal(access.wantsFileAccess(manifest),false,JSON.stringify(manifest));
 assert.equal(describe({id:ID,manifest:{manifest_version:3,name:'PDF',version:'1',host_permissions:['<all_urls>']}}).wantsFileAccess,true,'the card data says so');
 assert.equal(describe({id:ID,manifest:{manifest_version:3,name:'Plain',version:'1',permissions:['storage']}}).wantsFileAccess,false);
});

test('the pattern rule: <all_urls> and an explicit file: scheme reach file:, nothing else does',()=>{
 for(const pattern of ['<all_urls>','file:///*','file://*','file:///C:/Users/*','FILE:///x','file:/x'])assert.equal(access.patternMatchesFileScheme(pattern),true,pattern);
 for(const pattern of ['*://*/*','http://*/*','https://a.test/file://x','ftp://x/*','chrome://*/*','activeTab','storage','',null,undefined,'://x'])assert.equal(access.patternMatchesFileScheme(pattern),false,String(pattern));
});

test("util::AllowFileAccess: the person's choice, false until made; the list of ids is one profile's, switch on only",()=>{
 assert.equal(access.fileAccessOf(undefined),false);assert.equal(access.fileAccessOf({}),false);assert.equal(access.fileAccessOf({fileAccess:'yes'}),false);assert.equal(access.fileAccessOf({fileAccess:true}),true);
 const saved=[{id:ID,profileId:'p',fileAccess:true},{id:OTHER,profileId:'p'},{id:'x',profileId:'q',fileAccess:true}];
 assert.deepEqual(access.fileAccessIds(saved,'p'),[ID]);assert.deepEqual(access.fileAccessIds(saved,'q'),['x']);assert.deepEqual(access.fileAccessIds(saved,'none'),[]);
});

test('the request is validated: a boolean "allowed" and nothing else',()=>{
 const profiles=[{id:'p'}];
 assert.deepEqual(validateExtensionRequest({type:'fileAccess',profileId:'p',extensionId:ID,allowed:true},profiles),{type:'fileAccess',profileId:'p',extensionId:ID,allowed:true});
 assert.throws(()=>validateExtensionRequest({type:'fileAccess',profileId:'p',extensionId:ID},profiles),/file access choice/);
 assert.throws(()=>validateExtensionRequest({type:'fileAccess',profileId:'p',extensionId:ID,allowed:'yes'},profiles),/file access choice/);
 assert.throws(()=>validateExtensionRequest({type:'fileAccess',profileId:'p',extensionId:ID,allowed:true,extra:1},profiles),/Unexpected/);
 assert.throws(()=>validateExtensionRequest({type:'fileAccess',profileId:'p',extensionId:'nope',allowed:true},profiles),/identity/);
 assert.throws(()=>validateExtensionRequest({type:'fileAccess',profileId:'nobody',extensionId:ID,allowed:true},profiles),/Unknown browsing profile/);
});

function fixture({manifest={host_permissions:['<all_urls>']},enabled=true,fileAccess}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'acira-ext-fileaccess-')),registryPath=path.join(dir,'extensions.json'),loads=[],removals=[];
 const make=(id,name)=>{const folder=path.join(dir,'pkg',id);fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,'manifest.json'),JSON.stringify({manifest_version:3,name,version:'1.0',...manifest}));return folder;};
 const entry=(id,name,extra={})=>({id,profileId:'p',path:make(id,name),name,version:'1.0',permissions:access.wantsFileAccess(manifest)?['<all_urls>']:['storage'],enabled,source:'Chrome Web Store',...extra});
 fs.writeFileSync(registryPath,JSON.stringify({version:2,entries:[entry(ID,'Viewer',fileAccess===undefined?{}:{fileAccess}),entry(OTHER,'Other')]}));
 const loaded=new Map();
 const api={getAllExtensions:()=>[...loaded.values()],loadExtension:async(folder,options)=>{loads.push({folder,options});const parsed=JSON.parse(fs.readFileSync(path.join(folder,'manifest.json'),'utf8')),id=folder.endsWith(OTHER)?OTHER:ID,extension={id,name:parsed.name,version:parsed.version,manifest:parsed};loaded.set(id,extension);return extension;},removeExtension:id=>{removals.push(id);loaded.delete(id);}};
 const session={extensions:api,serviceWorkers:{getAllRunning:()=>({})}};
 const manager=createExtensionManager({getSession:()=>session,getProfiles:()=>[{id:'p',name:'Personal',partition:'persist:p'}],getWindow:()=>null,dialog:{showMessageBox:async()=>({response:1})},registryPath,createRuntime:()=>({}),downloadPackage:async()=>{throw new Error('no network');}});
 const saved=()=>JSON.parse(fs.readFileSync(registryPath,'utf8')).entries;
 return {dir,manager,saved,loads,removals,loaded,api,session,registryPath};
}

test('off by default and shown only for an extension that wants it; turning it on stores it and reloads the extension with the engine flag; the same value changes nothing',async()=>{
 const f=fixture();
 try{
  await f.manager.restore();
  assert.deepEqual(f.loads.map(load=>load.options.allowFileAccess),[false,false],'every extension starts without it');
  let list=f.manager.list('p');
  assert.deepEqual(list.extensions.map(e=>[e.id,e.wantsFileAccess,e.fileAccessAllowed]),[[ID,true,false],[OTHER,true,false]]);
  f.loads.length=0;
  list=await f.manager.command({type:'fileAccess',profileId:'p',extensionId:ID,allowed:true});
  assert.deepEqual(list.extensions.map(e=>[e.id,e.fileAccessAllowed]),[[ID,true],[OTHER,false]],'only that extension');
  assert.equal(f.saved().find(e=>e.id===ID).fileAccess,true);assert.equal(f.saved().find(e=>e.id===OTHER).fileAccess,undefined);
  assert.deepEqual(f.removals,[ID],'it was unloaded ...');assert.deepEqual(f.loads.map(load=>[path.basename(load.folder),load.options.allowFileAccess]),[[ID,true]],'... and loaded with the flag on');
  f.loads.length=0;f.removals.length=0;
  await f.manager.command({type:'fileAccess',profileId:'p',extensionId:ID,allowed:true});
  assert.deepEqual([f.loads.length,f.removals.length],[0,0],'already on: nothing is reloaded (SetAllowFileAccess returns when the value is the same)');
  list=await f.manager.command({type:'fileAccess',profileId:'p',extensionId:ID,allowed:false});
  assert.equal(list.extensions.find(e=>e.id===ID).fileAccessAllowed,false);assert.equal(f.saved().find(e=>e.id===ID).fileAccess,undefined);
  assert.deepEqual(f.loads.map(load=>load.options.allowFileAccess),[false],'turned off: reloaded without the flag');
 }finally{fs.rmSync(f.dir,{recursive:true,force:true});}
});

test('no switch for an extension that never asks for file: (it is not shown); the request still validates and stores nothing odd',async()=>{
 const f=fixture({manifest:{permissions:['storage']}});
 try{
  await f.manager.restore();
  assert.deepEqual(f.manager.list('p').extensions.map(e=>e.wantsFileAccess),[false,false]);
 }finally{fs.rmSync(f.dir,{recursive:true,force:true});}
});

test('the choice survives a restart (restore loads with it), a Reload and an update, and a failed load that rolls back keeps it',async()=>{
 const f=fixture({fileAccess:true});
 try{
  await f.manager.restore();
  assert.deepEqual(f.loads.map(load=>[path.basename(load.folder),load.options.allowFileAccess]),[[ID,true],[OTHER,false]],'at start: the saved choice, per extension');
  f.loads.length=0;
  await f.manager.command({type:'reload',profileId:'p',extensionId:ID});
  assert.equal(f.loads.at(-1).options.allowFileAccess,true,'Reload');assert.equal(f.saved().find(e=>e.id===ID).fileAccess,true,'still saved after the reload rewrote the entry');
  f.loads.length=0;
  await f.manager.command({type:'reload',profileId:'p',extensionId:OTHER});
  assert.equal(f.loads.at(-1).options.allowFileAccess,false,'another extension is not affected');
  // a reload that fails: the old copy comes back with its flag
  f.loads.length=0;const real=f.api.loadExtension;let calls=0;f.api.loadExtension=async(folder,options)=>{calls++;if(calls===1){f.loads.push({folder,options});throw new Error('broken manifest');}return real(folder,options);};
  const failed=await f.manager.command({type:'reload',profileId:'p',extensionId:ID});
  assert.match(String(failed.error),/broken manifest/);assert.deepEqual(f.loads.map(load=>load.options.allowFileAccess),[true,true],'the failed load and the rollback both carry the flag');
 }finally{fs.rmSync(f.dir,{recursive:true,force:true});}
});

test('a turned-off extension has nothing to reload: the choice is stored and it loads with the flag when it is turned on',async()=>{
 const f=fixture({enabled:false});
 try{
  await f.manager.restore();assert.deepEqual(f.loads,[],'turned off: not loaded');
  const list=await f.manager.command({type:'fileAccess',profileId:'p',extensionId:ID,allowed:true});
  assert.equal(list.extensions.find(e=>e.id===ID).fileAccessAllowed,true,'the card shows it');assert.equal(f.saved().find(e=>e.id===ID).fileAccess,true);assert.deepEqual(f.loads,[]);
  await f.manager.command({type:'enable',profileId:'p',extensionId:ID});
  assert.deepEqual(f.loads.map(load=>load.options.allowFileAccess),[true],'turned on: loaded with the flag');
 }finally{fs.rmSync(f.dir,{recursive:true,force:true});}
});

test('the worlds are told (the preload carries the ids whose switch is on) and every load site passes the flag (none is hard-wired to false)',()=>{
 const manager=read('desktop/browser-services/extension-manager.cjs');
 assert.equal((manager.match(/allowFileAccess:false/g)||[]).length,0,'no load passes a fixed false');
 assert.equal((manager.match(/allowFileAccess:fileAccess\.fileAccessOf\(/g)||[]).length,7,'restore, the user-scripts reload, the switch itself, a reload/update, its rollback, the private session copy and the private sessions that are open when the switch changes');
 assert.match(manager,/fileAccess:fileAccess\.fileAccessIds\(registry\.saved,profileId\),grants,incognito:/,'preloadOptions');
 assert.match(manager,/\.\.\.\(found\?\.fileAccess===true\?\{fileAccess:true\}:\{\}\),/,'a reload or update rewrites the entry and keeps the choice');
 const renderer=read('desktop/browser-services/ext-api/extension-renderer.cjs');
 assert.match(renderer,/isAllowedFileSchemeAccess: \(\) => Promise\.resolve\(acira\.fileAccess === true\)/);
});

test('the card: a switch for an extension that wants file access, no "cannot" sentence while it is on, and the text exists in every language',()=>{
 const card=read('src/components/ExtensionManager.tsx');
 assert.match(card,/extension\.wantsFileAccess&&<button type="button" className="btn" role="switch" aria-checked=\{extension\.fileAccessAllowed\?\?false\}[^>]*onClick=\{\(\)=>void request\(\{type:'fileAccess',profileId,extensionId:extension\.id,allowed:!extension\.fileAccessAllowed\}\)\}>/);
 assert.match(card,/extension\.fileAccessAllowed\?t\("extensionmanager\.itCanOpenFilesOn"\):t\("extensionmanager\.itCannotOpenFilesOn"\)/);
 assert.match(read('src/runtime/types.ts'),/type:'userScripts'\|'newTab'\|'private'\|'fileAccess'/);
 for(const language of ['en','ar','de','es','fr','hi','it','ja','ko','pt-BR','ru','tr','zh-CN']){
  const strings=JSON.parse(read(`src/i18n/${language}.json`));
  for(const key of ['extensionmanager.allowFileAccess','extensionmanager.fileAccessHint','extensionmanager.itCanOpenFilesOn'])assert.ok(typeof strings[key]==='string'&&strings[key].length>3,`${language} ${key}`);
  if(language!=='en')assert.notEqual(strings['extensionmanager.allowFileAccess'],JSON.parse(read('src/i18n/en.json'))['extensionmanager.allowFileAccess'],`${language} is translated`);
  assert.notEqual(strings['extensionmanager.itCanOpenFilesOn'],strings['extensionmanager.itCannotOpenFilesOn'],`${language}: "can" is not "cannot"`);
 }
});
