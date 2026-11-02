'use strict';
// "Add to Acira" on Chrome Web Store pages: which pages may ask, what the main process answers, and the bar itself drawn by the real preload in Electron.
const {test}=require('node:test'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process'),path=require('node:path'),fs=require('node:fs');
const {storeExtensionId,createStoreBar}=require('../desktop/browser-services/extension-store-bar.cjs'),compat=require('../desktop/browser-services/extension-compat.cjs');
const electron=(()=>{try{const value=require('electron');return typeof value==='string'&&fs.existsSync(value)?value:null;}catch{return null;}})();
const ID='nngceckbapebfimnlniiiahkandclblb';

test('only exact Chrome Web Store detail addresses name an extension',()=>{
 assert.equal(storeExtensionId(`https://chromewebstore.google.com/detail/bitwarden-password-manager/${ID}`),ID);
 assert.equal(storeExtensionId(`https://chromewebstore.google.com/detail/${ID}`),ID);
 assert.equal(storeExtensionId(`https://chromewebstore.google.com/detail/bitwarden/${ID}?hl=en&utm_source=x#reviews`),ID);
 assert.equal(storeExtensionId(`https://chrome.google.com/webstore/detail/bitwarden/${ID}`),ID);
 for(const bad of [`http://chromewebstore.google.com/detail/x/${ID}`,`https://chromewebstore.google.com.evil.test/detail/x/${ID}`,`https://evilchromewebstore.google.com/detail/x/${ID}`,`https://chromewebstore.google.com:8443/detail/x/${ID}`,`https://user@chromewebstore.google.com/detail/x/${ID}`,
  `https://chromewebstore.google.com/search/${ID}`,`https://chromewebstore.google.com/category/extensions`,'https://chromewebstore.google.com/detail/x/short',`https://chromewebstore.google.com/detail/x/${ID.toUpperCase()}`,`https://chromewebstore.google.com/detail/x/${ID}x`,
  `https://example.com/detail/x/${ID}`,`https://chrome.google.com/other/detail/x/${ID}`,'','not a url',null,undefined])assert.equal(storeExtensionId(bad),null,String(bad));
});

const frame={url:`https://chromewebstore.google.com/detail/bitwarden/${ID}`};
const wc={isDestroyed:()=>false,mainFrame:frame};
function bar(overrides={}){
 const calls=[];const manager={list:profile=>({supported:true,extensions:overrides.installed?[{id:ID,enabled:true}]:[]}),command:async request=>{calls.push(request);return overrides.result||{extensions:[{id:ID}]};}};
 return {calls,bar:createStoreBar({manager:overrides.manager||manager,compat:overrides.compat})};
}
const ask=(extra={})=>({wc,frame,id:ID,privateMode:false,profileId:'profile-personal',...extra});

test('status: available on the store page, reports installed and the tested compatibility',()=>{
 let {bar:b}=bar();assert.deepEqual(b.status(ask()),{available:true,installed:false,enabled:false,compat:null,reason:undefined});
 ({bar:b}=bar({installed:true,compat:id=>id===ID?{status:'works',note:'Popup and autofill load.'}:null}));
 const answer=b.status(ask());assert.equal(answer.installed,true);assert.equal(answer.compat.status,'works');
});
test('refuses subframes, mismatched IDs, private windows and missing profiles',()=>{
 const {bar:b,calls}=bar();
 for(const input of [ask({frame:{url:frame.url}}),ask({id:'a'.repeat(32)}),ask({id:'../'+ID}),ask({id:42}),ask({privateMode:true}),ask({profileId:''}),ask({profileId:undefined}),ask({wc:{...wc,isDestroyed:()=>true}}),ask({wc:null}),ask({frame:null}),
   {...ask(),frame:{url:'https://chromewebstore.google.com/search/x'},wc:{isDestroyed:()=>false,mainFrame:null}}]){
  assert.equal(b.status(input).available,false);
 }
 return Promise.all([ask({privateMode:true}),ask({id:'a'.repeat(32)}),ask({frame:{url:frame.url}})].map(async input=>{const result=await b.install(input);assert.equal(result.ok,false);assert.ok(result.error);})).then(()=>assert.equal(calls.length,0,'nothing was installed'));
});
test('a frame whose address names a different extension cannot install another one',async()=>{
 const other='a'.repeat(32),{bar:b,calls}=bar();
 const result=await b.install({wc:{isDestroyed:()=>false,mainFrame:frame},frame,id:other,privateMode:false,profileId:'profile-personal'});
 assert.equal(result.ok,false);assert.equal(calls.length,0);
});
test('install hands the ID and the tab\'s own profile to the existing installer and reports the outcome',async()=>{
 let {bar:b,calls}=bar();
 assert.deepEqual(await b.install(ask()),{ok:true,installed:true,upToDate:false});assert.deepEqual(calls,[{type:'install',profileId:'profile-personal',extensionId:ID}]);
 ({bar:b}=bar({result:{cancelled:true,extensions:[]}}));assert.deepEqual(await b.install(ask()),{ok:false,cancelled:true});
 ({bar:b}=bar({result:{error:'Extension store returned HTTP404.',extensions:[]}}));assert.deepEqual(await b.install(ask()),{ok:false,error:'Extension store returned HTTP404.'});
 ({bar:b}=bar({result:{extensions:[]}}));assert.equal((await b.install(ask())).ok,false);
 ({bar:b}=bar({manager:{list:()=>({supported:true,extensions:[]}),command:async()=>{throw new Error('boom');}}}));assert.deepEqual(await b.install(ask()),{ok:false,error:'boom'});
 ({bar:b}=bar({result:{upToDate:true,extensions:[{id:ID}]}}));assert.equal((await b.install(ask())).upToDate,true);
});
test('a manager that is not ready yet asks the page to retry; an unsupported profile does not',()=>{
 const starting=createStoreBar({manager:{list:()=>{throw new Error('not ready');},command:async()=>({})}}).status(ask());assert.deepEqual(starting,{available:false,retry:true,reason:'Extensions are still starting.'});

 const b=createStoreBar({manager:{list:()=>({supported:false,extensions:[]}),command:async()=>({})}});assert.equal(b.status(ask()).available,false);
 assert.equal(b.status(ask()).retry,undefined,'an unsupported profile is final');
});
test('compatibility data: only known statuses for valid IDs, never a guess',()=>{
 assert.equal(compat.lookup('a'.repeat(32)),null);assert.equal(compat.lookup('nope'),null);assert.equal(compat.lookup(undefined),null);
 const data=JSON.parse(fs.readFileSync(path.join(__dirname,'..','desktop','browser-services','extension-compat.json'),'utf8'));
 for(const [id,entry] of Object.entries(data.entries)){assert.match(id,/^[a-p]{32}$/);assert.ok(compat.STATUS.has(entry.status),id);assert.ok(typeof entry.note==='string'&&entry.note.length<=280,id);assert.deepEqual(Object.keys(compat.lookup(id)).sort(),['checked','engine','note','status']);}
});

let result=null,problem=null;
if(electron){
 const run=spawnSync(electron,[path.join(__dirname,'fixtures','store-bar','run.cjs')],{encoding:'utf8',timeout:120000,env:{...process.env,ELECTRON_RUN_AS_NODE:undefined,ELECTRON_ENABLE_LOGGING:'0'}});
 const line=(run.stdout||'').split(/\r?\n/).find(text=>text.startsWith('RESULT '));
 if(line)result=JSON.parse(line.slice(7));else problem=((run.stdout||'')+(run.stderr||'')).split(/\r?\n/).filter(text=>!/^\[\d+:/.test(text)).join('\n').slice(0,600)||'electron produced no result';
}
const skip=!electron?'electron binary not available':false;
test('preload bar: drawn on a detail page, hidden elsewhere, click installs and shows each outcome',{skip},()=>{
 assert.ok(result,problem);
 assert.equal(result.hiddenWhenUnavailable,true,'no bar when the main process says unavailable');
 assert.equal(result.hiddenOffDetail,true,'no bar on search or home pages');
 assert.equal(result.initial.visible,true);assert.match(result.initial.name,/^Bitwarden Password Manager$/);assert.equal(result.initial.button,'Add to Acira');assert.match(result.initial.note,/review its access first/);
 assert.deepEqual(result.invoked,[{channel:'acira:store-status',args:{id:ID}},{channel:'acira:store-install',args:{id:ID}}],'only the ID leaves the page');
 assert.equal(result.adding.button,'Adding…');assert.equal(result.adding.disabled,true);
 assert.equal(result.added.button,'Added to Acira');assert.equal(result.added.disabled,true);
 assert.equal(result.cancelled.button,'Add to Acira');assert.equal(result.cancelled.disabled,false);
 assert.equal(result.failed.button,'Try again');assert.match(result.failed.note,/HTTP404/);
 assert.equal(result.compat.note,'Tested in Acira: limited. No desktop unlock.');
 assert.equal(result.alreadyInstalled.button,'Added to Acira');
 assert.equal(result.navigatedAway,true,'single-page navigation to a non-detail page removes the bar');
 assert.equal(result.navigatedBack.visible,true,'and navigating to another detail page draws it again');
 assert.equal(result.reattached,true,'a page that rebuilds the document does not lose the bar');assert.equal(result.reattachedAfterRemove,true);
 assert.equal(result.startingHidden,true,'while the browser is still starting there is no bar');assert.equal(result.startingThenShown.visible,true,'the bar asks again and appears once extensions are ready');assert.equal(result.startingThenShown.button,'Add to Acira');assert.equal(result.statusCalls,2);
});
test('React Developer Tools stays "Tested: does not work": its panels appear only in the P9 rig\'s hosted DevTools, not with Acira\'s Developer Tools command',()=>{
 const react=compat.lookup('fmkadmapgofadopljbjfkapdkoienihi');assert.equal(react.status,'unsupported');assert.match(react.note,/Components and Profiler panels never appear/);
 const doc=fs.readFileSync(path.join(__dirname,'..','docs','launch','EXTENSION_COMPATIBILITY.md'),'utf8');
 assert.doesNotMatch(doc,/React DevTools panels — work/,'the 28 Oct note is corrected');assert.match(doc,/only inside the P9 test rig, not in Acira/);
});
