'use strict';
// The updater loads the whole uBlock Origin default set (compiled lists, not the include stub), refreshes lists and scriptlets with conditional requests,
// swaps the engine live and keeps the active one when anything fails. Fixtures only: no network.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto'),{ElectronBlocker}=require('@ghostery/adblocker-electron'),{createFilterUpdates,validateList,validateResources,preprocess,SOURCES,SCRIPTLET_SOURCE}=require('../desktop/browser-services/filter-updates.cjs');
const parse=t=>ElectronBlocker.parse(t,{loadNetworkFilters:true,loadCosmeticFilters:true,enableCompression:true});
const text=(source,rule)=>`! Title: ${source.match||source.title}\n`+'! reviewed fixture padding\n'.repeat(55)+rule+'\n';
const scriptlets=tag=>JSON.stringify({scriptlets:Array.from({length:60},(_,i)=>({name:'fixture-'+i+'.js',aliases:[],body:'function fixture'+i+'(){/* '+tag+' '+'x'.repeat(150)+' */}',dependencies:[]})),redirects:Array.from({length:25},(_,i)=>({name:'fixture-'+i+'.gif',aliases:[],body:'R0lGODlhAQABAIAAAP///////yH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==',contentType:'image/gif;base64'}))});
function fixture(extra={}){
 const root=path.resolve('.qa-profiles/services-unit/filter-full-'+randomUUID()),baseline=path.join(root,'baseline');fs.mkdirSync(baseline,{recursive:true});
 for(const s of SOURCES)fs.writeFileSync(path.join(baseline,s.id),s.hosts?'! Title: Peter Lowe\n'+'! reviewed fixture padding\n'.repeat(55)+'||old.example^\n':text(s,'||old.example^'));
 fs.writeFileSync(path.join(baseline,'resources.json'),scriptlets('bundled'));
 const state={mode:'new',etag:'"v1"',calls:[]};
 const download=async(url,session,validators={})=>{
  state.calls.push({url,validators});
  const source=SOURCES.find(s=>s.url===url||(s.mirrors||[]).includes(url));if(!source)throw new Error('unexpected download: '+url);
  if(state.mode==='offline'||(state.primaryDown&&SOURCES.some(s=>s.url===url)))throw new Error('offline');
  if(state.mode==='html')return {status:200,text:'<html>Bad source</html>'};
  if(validators.etag&&validators.etag===state.etag)return {status:304,text:'',etag:state.etag};
  const rule=state.mode==='new'?'||new.example^':'||next.example^';
  return {status:200,text:source.hosts?'! Title: Peter Lowe\n'+'! reviewed fixture padding\n'.repeat(55)+rule+'\n':text(source,rule),etag:state.etag,lastModified:'Sat, 01 Nov 2026 00:00:00 GMT'};
 };
 const options={filtersPath:baseline,cachePath:path.join(root,'cache'),download,engineFactory:parse,...extra};
 return {root,options,state,session:{isPersistent:()=>true}};
}
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

test('the default set is uBlock Origin\'s compiled lists plus EasyList, EasyPrivacy and Peter Lowe, each with mirrors',()=>{
 assert.deepEqual(SOURCES.map(s=>s.id),['easylist.txt','easyprivacy.txt','ubo-filters.txt','ubo-badware.txt','ubo-privacy.txt','unbreak.txt','ubo-quick-fixes.txt','plowe.txt']);
 for(const s of SOURCES.filter(s=>s.id.startsWith('ubo-')||s.id==='unbreak.txt'))assert.match(s.url,/\/filters\/[a-z-]+\.min\.txt$/,'the compiled file, never the include stub: '+s.id);
 for(const s of SOURCES.filter(s=>!s.hosts))assert.ok(s.mirrors.length>=2,s.id+' has mirrors');
 for(const s of SOURCES)assert.match(s.url,/^https:\/\//);
});
test('an include stub holds no rules and other browsers\' !#if blocks are dropped',()=>{
 const source=SOURCES.find(s=>s.id==='ubo-filters.txt'),stub='! Title: uBlock filters\n'+Array.from({length:10},(_,i)=>'!#include filters-'+i+'.txt').join('\n')+'\n'+'! reviewed fixture padding\n'.repeat(55);
 assert.equal(validateList(stub,source).text.split('\n').filter(l=>l&&!l.startsWith('!')).length,0,'nothing there to load: includes are not followed');
 const body='! Title: uBlock filters\n'+'! reviewed fixture padding\n'.repeat(55)+'||chromium.example^\n!#if env_firefox\n||firefox.example^\n!#else\n||other.example^\n!#endif\n!#if env_safari || ext_ubol\n||safari.example^\n!#endif\n!#if !cap_html_filtering\n||nohtml.example^\n!#endif\n!#if env_chromium && ext_ublock\n||both.example^\n!#endif\n';
 const kept=preprocess(body);for(const name of ['chromium','other','nohtml','both'])assert.ok(kept.includes('||'+name+'.example^'),name);for(const name of ['firefox','safari'])assert.ok(!kept.includes('||'+name+'.example^'),name);assert.ok(!/^!#/m.test(kept));
 assert.equal(validateList(kept,source).sha256,validateList(body,source).sha256,'preprocessing is idempotent');
});
test('a hosts-format list becomes network rules; text without hosts entries is refused',()=>{
 const source=SOURCES.find(s=>s.id==='plowe.txt'),hosts='# Blocklist\n127.0.0.1 localhost\n'+Array.from({length:700},(_,i)=>'127.0.0.1 ad'+i+'.tracker.example').join('\n')+'\n';
 const list=validateList(hosts,source);assert.ok(list.text.includes('||ad5.tracker.example^'));assert.ok(!list.text.includes('localhost'));assert.equal(validateList(list.text,source).sha256,list.sha256,'a stored list validates to itself');
 assert.throws(()=>validateList('# Blocklist\n'+'# nothing\n'.repeat(80),source),/Invalid/);
});
test('a mislabeled or shrunken scriptlet file is refused',()=>{
 assert.throws(()=>validateResources('{}'),/Invalid/);assert.throws(()=>validateResources('x'.repeat(20000)),/Invalid/);assert.throws(()=>validateResources(JSON.stringify({scriptlets:[],redirects:[]}).padEnd(20000,' ')),/Invalid/);
 assert.ok(validateResources(scriptlets('x')).sha256);
});
test('the first refresh is unconditional, an unchanged one downloads nothing and keeps the engine, validators survive a restart',async()=>{
 const f=fixture(),service=createFilterUpdates(f.options);const before=service.getEngine();
 await service.refresh(f.session);assert.ok(f.state.calls.every(c=>!c.validators.etag),'unconditional the first time');assert.notEqual(service.getEngine(),before,'swapped live');assert.equal(service.status().source,'updated');
 const engine=service.getEngine(),hashes=service.status().lists.map(v=>v.sha256);f.state.calls.length=0;await service.refresh(f.session);
 assert.equal(f.state.calls.length,SOURCES.length);assert.ok(f.state.calls.every(c=>c.validators.etag==='"v1"'),'every request is conditional');assert.equal(service.getEngine(),engine);assert.deepEqual(service.status().lists.map(v=>v.sha256),hashes);assert.ok(service.status().checkedAt);assert.equal(service.status().lastError,null);
 const restarted=createFilterUpdates(f.options);f.state.calls.length=0;await restarted.refresh(f.session);assert.ok(f.state.calls.every(c=>c.validators.etag==='"v1"'),'validators survive a restart');
});
test('when the first host is down a mirror answers',async()=>{
 const f=fixture(),service=createFilterUpdates(f.options);f.state.primaryDown=true;await service.refresh(f.session);
 assert.equal(service.status().source,'updated');assert.ok(f.state.calls.some(c=>SOURCES.some(s=>(s.mirrors||[]).includes(c.url))),'a mirror was asked');assert.match(service.status().lastError,/^1 of 8 .*offline/,'only Peter Lowe has no mirror, and the failure is reported');
});
test('one source failing still updates the others and says so; all failing keeps everything and rejects',async()=>{
 const f=fixture(),service=createFilterUpdates(f.options),base=f.options.download;
 const partial=createFilterUpdates({...f.options,download:async(url,...rest)=>{if(url.includes('easyprivacy')||SOURCES.find(s=>s.id==='easyprivacy.txt').mirrors.includes(url))throw new Error('host down');return base(url,...rest);}});
 const before=partial.getEngine(),oldPrivacy=partial.status().lists[1].sha256;await partial.refresh(f.session);assert.notEqual(partial.getEngine(),before);assert.equal(partial.status().lists[1].sha256,oldPrivacy,'the failed list stays as it was');assert.match(partial.status().lastError,/could not be updated/);
 f.state.mode='offline';const active=service.getEngine();await assert.rejects(service.refresh(f.session),/offline/);assert.equal(service.getEngine(),active);
});
test('scriptlet code is never downloaded: the scriptlets shipped with the build are used, a leftover cache file is deleted, the engine key follows them',async()=>{
 const f=fixture();fs.mkdirSync(f.options.cachePath,{recursive:true});const leftover=path.join(f.options.cachePath,'resources-cache.json');fs.writeFileSync(leftover,JSON.stringify({schema:1,sha256:'x',text:scriptlets('downloaded'),retrievedAt:Date.now()-1000}));
 const service=createFilterUpdates(f.options),bundled=service.status().scriptlets.sha256;assert.equal(service.status().scriptlets.source,'bundled');assert.equal(fs.existsSync(leftover),false,'a leftover downloaded copy is removed');
 await service.refresh(f.session);assert.ok(!f.state.calls.some(c=>c.url===SCRIPTLET_SOURCE.url||SCRIPTLET_SOURCE.mirrors.includes(c.url)),'no request for scriptlet code');assert.equal(service.status().scriptlets.sha256,bundled);assert.equal(service.status().source,'updated');
 const {engineCacheKey}=require('../desktop/browser-services/filter-updates.cjs');assert.notEqual(engineCacheKey(f.options.filtersPath,['a'],fs,'x'),engineCacheKey(f.options.filtersPath,['a'],fs,'y'),'the scriptlet hash is part of the engine key');
});
test('a ##+js rule from an updated list still fires with the shipped scriptlets',async()=>{
 const f=fixture();fs.copyFileSync(path.join(__dirname,'../resources/filters/resources.json'),path.join(f.options.filtersPath,'resources.json'));
 const rule='example.test##+js(set-constant, adBlockDetected, false)\n',base=f.options.download;
 const service=createFilterUpdates({...f.options,engineFactory:(listText,resourceText)=>{const engine=parse(listText);engine.updateResources(resourceText,'shipped');return engine;},download:async(url,...rest)=>{const reply=await base(url,...rest);return reply.status===200?{...reply,text:reply.text+rule}:reply;}});
 const query={url:'https://example.test/',hostname:'example.test',domain:'example.test',getBaseRules:false,getInjectionRules:true,getExtendedRules:false,getRulesFromHostname:true,getRulesFromDOM:false};
 assert.equal(service.getEngine().getCosmeticsFilters(query).scripts.length,0,'not in the shipped lists');
 await service.refresh(f.session);const scripts=service.getEngine().getCosmeticsFilters(query).scripts;assert.ok(scripts.length>0,'the rule from the update produces a script');assert.match(scripts.join('\n'),/setConstant/,'built from the shipped set-constant scriptlet');
});
test('the compile runs through the injected builder (the worker in the browser); a crashing builder keeps the active engine',async()=>{
 const f=fixture(),calls=[];const options={...f.options,engineFactory:parse,engineCache:true,buildEngine:async(textValue,resourcesValue)=>{calls.push([textValue.length,resourcesValue.length]);return parse(textValue).serialize();}};
 const service=createFilterUpdates(options);const before=service.getEngine();await service.refresh(f.session);assert.equal(calls.length,1);assert.ok(calls[0][0]>0&&calls[0][1]>0,'lists and scriptlets are handed to the builder');assert.notEqual(service.getEngine(),before);assert.ok(fs.existsSync(path.join(options.cachePath,'engine.bin')),'the built engine is cached');
 const crash=fixture(),broken=createFilterUpdates({...crash.options,engineCache:true,buildEngine:async()=>{throw new Error('worker crashed');}});const active=broken.getEngine();await assert.rejects(broken.refresh(crash.session),/worker crashed/);assert.equal(broken.getEngine(),active);assert.equal(broken.status().source,'bundled');
});
test('automatic checks: shortly after start, then every four hours, sooner after a failure, nothing when switched off or without an ordinary session',async()=>{
 const timers=[],setTimer=(fn,ms)=>{const timer={fn,ms,unref(){}};timers.push(timer);return timer;},last=()=>timers[timers.length-1];
 const f=fixture({setTimer}),service=createFilterUpdates(f.options);
 const stop=service.startAutomatic(()=>f.session,{first:1000,every:4*3600e3,retry:1800e3,random:()=>0.5});
 assert.equal(timers.length,1);assert.equal(last().ms,1000,'deferred, not at start');await last().fn();assert.equal(service.status().source,'updated','checked on the first tick');assert.equal(last().ms,4*3600e3,'then every four hours');stop();
 let clock=Date.now();const offline=fixture({setTimer,now:()=>clock});offline.state.mode='offline';const failing=createFilterUpdates(offline.options);failing.startAutomatic(()=>offline.session,{first:10,every:4*3600e3,retry:1800e3,random:()=>0.5});
 await last().fn();assert.equal(last().ms,1800e3,'30 minutes after a failure');clock+=1800e3;await last().fn();assert.equal(last().ms,3600e3,'a second failure backs off to an hour');clock+=3600e3;await last().fn();assert.equal(last().ms,7200e3,'then two hours, doubling up to the normal interval');
 const off=fixture({setTimer});const quiet=createFilterUpdates(off.options);quiet.setAutomatic(false);quiet.startAutomatic(()=>off.session,{first:10,random:()=>0.5});await last().fn();assert.equal(off.state.calls.length,0,'switched off: no request');
 const none=fixture({setTimer});createFilterUpdates(none.options).startAutomatic(()=>null,{first:10,retry:1800e3,random:()=>0.5});await last().fn();assert.equal(none.state.calls.length,0);assert.equal(last().ms,1800e3,'no ordinary session yet: ask again later');
 await wait(1);
});
test('private and non-persistent sessions never download',async()=>{
 const f=fixture(),service=createFilterUpdates(f.options);await assert.rejects(service.refresh({isPersistent:()=>false}),/ordinary persistent/);await assert.rejects(service.refresh(null),/ordinary persistent/);assert.equal(f.state.calls.length,0);
});
test('a profile cache from the older five-list set starts from the bundled lists without an error',()=>{
 const f=fixture();fs.mkdirSync(f.options.cachePath,{recursive:true});const old={schema:1,retrievedAt:Date.now()-1000,lists:SOURCES.slice(0,5).map(s=>({id:s.id,url:s.url,text:text(s,'||old.example^'),sha256:'x'}))};
 fs.writeFileSync(path.join(f.options.cachePath,'current.json'),JSON.stringify(old));fs.writeFileSync(path.join(f.options.cachePath,'previous.json'),JSON.stringify(old));
 const service=createFilterUpdates(f.options);assert.equal(service.status().source,'bundled');assert.equal(service.status().lastError,null);assert.equal(service.status().lists.length,SOURCES.length);
});
