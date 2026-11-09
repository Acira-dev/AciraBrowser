'use strict';
// declarativeNetRequest host (dnr-host.cjs) and the extension-side forwarding (extension-apis-renderer.cjs).
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{EventEmitter}=require('node:events');
const {attachDnrHost,dnrHostFor,hostAccessFor,redirectResponse}=require('../desktop/browser-services/dnr-host.cjs');
const {aciraExtraApis}=require('../desktop/browser-services/extension-apis-renderer.cjs');

const ID='c'.repeat(32);
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'acira-dnr-')),ext=path.join(root,'ext'),storage=path.join(root,'partition'),userData=path.join(root,'user');
 fs.mkdirSync(ext);fs.mkdirSync(storage);
 fs.writeFileSync(path.join(ext,'ads.json'),JSON.stringify([{id:1,action:{type:'block'},condition:{urlFilter:'||ads.example^'}}]));
 fs.writeFileSync(path.join(ext,'extra.json'),JSON.stringify([{id:1,action:{type:'block'},condition:{urlFilter:'||extra.example^'}}]));
 const manifest={manifest_version:3,permissions:['declarativeNetRequest'],host_permissions:['<all_urls>'],declarative_net_request:{rule_resources:[{id:'ads',enabled:true,path:'ads.json'},{id:'extra',enabled:false,path:'extra.json'}]}};
 const extension={id:ID,manifest,path:ext};
 const extensions=Object.assign(new EventEmitter(),{getAllExtensions:()=>[extension]});
 const handlers=new Map(),router={handlers,handle:(name,callback)=>handlers.set(name,{callback})};
 const session={extensions,storagePath:storage};
 return {root,ext,storage,userData,manifest,extension,session,router,handlers,cleanup:()=>fs.rmSync(root,{recursive:true,force:true})};
}
const script=url=>({url,method:'GET',resourceType:'script',referrer:'https://site.test/',id:1});

test('static rulesets load, enabled ones only; one host per session',async()=>{
 const f=fixture();
 try{
  const host=attachDnrHost({session:f.session,router:f.router,userData:f.userData,storeKey:'p1',getExtension:()=>f.extension});
  assert.equal(attachDnrHost({session:f.session,router:f.router,userData:f.userData}),host);
  assert.equal(dnrHostFor(f.session),host);
  await host.whenLoaded();
  assert.deepEqual(host.before(script('https://ads.example/a.js'),{tabId:3}),{cancel:true});
  assert.equal(host.before(script('https://extra.example/a.js'),{tabId:3}),null);
  assert.equal(host.before({...script('chrome-extension://x/a.js')},{tabId:3}),null,'non-web schemes are never matched');
  const timing=host.timings()[ID];assert.equal(timing.staticRules,1);
 }finally{f.cleanup();}
});

test('updates sent by the extension apply at once and persist per profile',async()=>{
 const f=fixture();
 try{
  const host=attachDnrHost({session:f.session,router:f.router,userData:f.userData,storeKey:'p1',getExtension:()=>f.extension});
  await host.whenLoaded();
  const sync=(kind,options)=>f.handlers.get('declarativeNetRequest.aciraSync').callback({extension:f.extension},kind,options);
  assert.deepEqual(await sync('dynamic',{addRules:[{id:5,action:{type:'block'},condition:{urlFilter:'||dyn.example^'}}]}),{__acira_value:true});
  assert.deepEqual(host.before(script('https://dyn.example/x.js'),{tabId:1}),{cancel:true});
  assert.deepEqual(await sync('enabled',{enableRulesetIds:['extra'],disableRulesetIds:['ads']}),{__acira_value:true});
  assert.deepEqual(host.before(script('https://extra.example/x.js'),{tabId:1}),{cancel:true});
  assert.equal(host.before(script('https://ads.example/x.js'),{tabId:1}),null);
  assert.deepEqual(await sync('session',{addRules:[{id:9,action:{type:'block'},condition:{urlFilter:'||tab.example^',tabIds:[2]}}]}),{__acira_value:true});
  assert.equal(host.before(script('https://tab.example/x.js'),{tabId:1}),null);
  assert.deepEqual(host.before(script('https://tab.example/x.js'),{tabId:2}),{cancel:true});
  assert.match((await sync('dynamic',{addRules:[{id:5,action:{type:'block'},condition:{urlFilter:'||again.example^'}}]})).__acira_error,/unique/);
  const matched=await f.handlers.get('declarativeNetRequest.getMatchedRules').callback({extension:f.extension},{tabId:2});
  assert.deepEqual(matched.rulesMatchedInfo.map(m=>m.rule),[{ruleId:9,rulesetId:'_session'}]);
  await new Promise(r=>setTimeout(r,700));
  const saved=JSON.parse(fs.readFileSync(path.join(f.userData,'extension-dnr','p1',ID+'.json'),'utf8'));
  assert.deepEqual(saved.enabledRulesets,['extra']);
  assert.equal(saved.dynamicRules,undefined,'Chromium stores dynamic rules itself');
 }finally{f.cleanup();}
});

test("Chromium's stored dynamic rules seed the matcher; extensions without the permission are never read",async()=>{
 const f=fixture();
 try{
  fs.mkdirSync(path.join(f.storage,'DNR Extension Rules',ID),{recursive:true});
  fs.writeFileSync(path.join(f.storage,'DNR Extension Rules',ID,'rules.json'),JSON.stringify([{id:1,action:{type:'block'},condition:{requestDomains:['native.example']}}]));
  const other={id:'d'.repeat(32),manifest:{permissions:['storage']},path:f.ext};
  f.session.extensions.getAllExtensions=()=>[f.extension,other];
  const host=attachDnrHost({session:f.session,router:f.router,userData:f.userData});
  await host.whenLoaded();
  assert.deepEqual(host.before(script('https://cdn.native.example/x.js'),{tabId:1}),{cancel:true});
  assert.deepEqual(Object.keys(host.timings()),[ID]);
  f.session.extensions.emit('extension-unloaded',{},f.extension);
  assert.equal(host.active,false);
  assert.equal(host.before(script('https://ads.example/x.js'),{tabId:1}),null);
 }finally{f.cleanup();}
});

test("Chromium's enabled-ruleset numbers (manifest order from 1) decide which static rulesets load",async()=>{
 const f=fixture();
 try{
  fs.writeFileSync(path.join(f.storage,'Preferences'),JSON.stringify({extensions:{settings:{[ID]:{dnr_enabled_ruleset_ids:[2]}}}}));
  const host=attachDnrHost({session:f.session,router:f.router,userData:f.userData});
  await host.whenLoaded();
  assert.deepEqual(host.before(script('https://extra.example/a.js'),{tabId:1}),{cancel:true});
  assert.equal(host.before(script('https://ads.example/a.js'),{tabId:1}),null);
 }finally{f.cleanup();}
});

test('host access for redirect and modifyHeaders follows the manifest patterns',()=>{
 const some=hostAccessFor({host_permissions:['*://*.example.com/*']});
 assert.equal(some('https://a.example.com/x'),true);
 assert.equal(some('https://example.org/x'),false);
 assert.equal(some('https://a.example.com/x','https://other.org'),false);
 assert.equal(hostAccessFor({permissions:['declarativeNetRequest']})('https://a.com/'),false);
 assert.equal(hostAccessFor({host_permissions:['<all_urls>']})('https://a.com/'),true);
});

test('the extension-side API forwards accepted updates and keeps Chrome\'s callback contract',async()=>{
 const calls=[];let failNext=false;
 const native={
  MAX_NUMBER_OF_REGEX_RULES:1000,
  updateDynamicRules(options,callback){calls.push(['native',options]);if(failNext){globalThis.chrome={runtime:{lastError:{message:'Rule with id 1 does not have a unique ID.'}}};callback();delete globalThis.chrome;}else callback();},
  getDynamicRules(callback){callback([]);}
 };
 const electron={invokeExtension:async(id,name,options,...args)=>{calls.push([name,...args]);return name==='declarativeNetRequest.getMatchedRules'?{__acira_value:{rulesMatchedInfo:[]}}:{__acira_value:true};}};
 const withLastError=(error,run)=>{globalThis.chrome={runtime:error?{lastError:{message:error}}:{}};try{return run();}finally{delete globalThis.chrome;}};
 class ExtensionEvent{constructor(name){this.name=name;}}
 const {definitions}=aciraExtraApis({electron,extensionId:ID,manifest:{manifest_version:3,permissions:['declarativeNetRequest']},ExtensionEvent,withLastError,userScriptsAllowed:false});
 const api=definitions.declarativeNetRequest.factory(native);
 assert.equal(api.MAX_NUMBER_OF_REGEX_RULES,1000);
 await api.updateDynamicRules({addRules:[{id:1}]});
 assert.deepEqual(calls.map(c=>c[0]),['native','declarativeNetRequest.aciraSync']);
 assert.deepEqual(calls[1].slice(1),['dynamic',{addRules:[{id:1}]}]);
 failNext=true;calls.length=0;
 const message=await new Promise(resolve=>api.updateDynamicRules({addRules:[{id:1}]},()=>resolve(globalThis.chrome?.runtime?.lastError?.message)));
 assert.match(message,/unique/);
 assert.deepEqual(calls.map(c=>c[0]),['native'],'a rejected update is not forwarded');
 assert.deepEqual(await api.getMatchedRules({}),{rulesMatchedInfo:[]});
 assert.equal(typeof api.getDynamicRules,'function');
 assert.equal(definitions.declarativeNetRequest.shouldInject(),true);
});

// Electron's onHeadersReceived takes {cancel}, {responseHeaders} and {statusLine}; it ignores `redirectURL` there (probed on Electron 44.9.3), so a redirect
// decided from the response is the way Chromium makes it: a 302 Found with a Location header (web_request_api_helpers.cc RedirectRequestAfterHeadersReceived).
test('response phase: the host answers onHeadersReceived with cancel, a 302 Location rewrite, or rewritten headers',async()=>{
 const f=fixture();
 try{
  fs.writeFileSync(path.join(f.ext,'late.json'),JSON.stringify([
   {id:1,priority:1,action:{type:'block'},condition:{urlFilter:'||blocked.example^',resourceTypes:['main_frame'],responseHeaders:[{header:'content-type',values:['application/pdf*']}]}},
   {id:2,priority:1,action:{type:'redirect',redirect:{url:'https://viewer.example/open'}},condition:{urlFilter:'||moved.example^',resourceTypes:['main_frame'],responseHeaders:[{header:'content-type',values:['application/pdf*']}]}},
   {id:3,priority:1,action:{type:'modifyHeaders',responseHeaders:[{header:'content-disposition',operation:'set',value:'attachment'}]},condition:{urlFilter:'||files.example^',resourceTypes:['main_frame'],responseHeaders:[{header:'content-type',values:['application/pdf*']}]}}
  ]));
  f.manifest.declarative_net_request.rule_resources.push({id:'late',enabled:true,path:'late.json'});
  const host=attachDnrHost({session:f.session,router:f.router,userData:f.userData,storeKey:'p1',getExtension:()=>f.extension});
  await host.whenLoaded();
  const page=(url,headers)=>({url,method:'GET',resourceType:'mainFrame',referrer:'',id:9,responseHeaders:headers});
  const pdf={'Content-Type':['application/pdf'],Location:['https://stale.example/'],location:['https://stale2.example/']},html={'Content-Type':['text/html']};
  assert.equal(host.before(page('https://blocked.example/a.pdf'),{tabId:3}),null,'nothing at the request phase');
  assert.deepEqual(host.headers(page('https://blocked.example/a.pdf',pdf),{tabId:3}),{cancel:true});
  assert.equal(host.headers(page('https://blocked.example/a.html',html),{tabId:3}),null);
  const moved=host.headers(page('https://moved.example/a.pdf',pdf),{tabId:3});
  assert.equal(moved.statusLine,'HTTP/1.1 302 Found');
  assert.deepEqual(moved.responseHeaders,{'Content-Type':['application/pdf'],Location:['https://viewer.example/open']},'every earlier Location is replaced');
  assert.equal(moved.redirectURL,undefined);
  assert.deepEqual(host.headers(page('https://files.example/a.pdf',{'Content-Type':['application/pdf']}),{tabId:3}),{responseHeaders:{'Content-Type':['application/pdf'],'content-disposition':['attachment']}});
  assert.equal(host.headers({...page('https://files.example/a.pdf',pdf),url:'chrome-extension://x/a.pdf'},{tabId:3}),null,'non-web schemes are never matched');
  assert.equal(host.headers({...page('https://files.example/a.pdf'),responseHeaders:undefined},{tabId:3}),null);
  assert.deepEqual(redirectResponse({Location:['a'],LOCATION:['b'],Age:['1']},'https://x.example/'),{responseHeaders:{Age:['1'],Location:['https://x.example/']},statusLine:'HTTP/1.1 302 Found'});
 }finally{f.cleanup();}
});

test('response phase: with no response-phase rule the host does nothing',async()=>{
 const f=fixture();
 try{
  const host=attachDnrHost({session:f.session,router:f.router,userData:f.userData,storeKey:'p1',getExtension:()=>f.extension});
  await host.whenLoaded();
  assert.equal(host.engine.hasResponseRules,false);
  assert.equal(host.headers({url:'https://ads.example/a.pdf',method:'GET',resourceType:'mainFrame',id:1,responseHeaders:{'Content-Type':['application/pdf']}},{tabId:3}),null);
 }finally{f.cleanup();}
});
