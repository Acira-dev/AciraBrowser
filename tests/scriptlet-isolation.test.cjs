'use strict';
// Reddit gets two json-prune scriptlets. Each script carries its own copy of the scriptlet helpers, and run bare in one page the second
// one replaced the global proxyApplyFn: the first script's Function.prototype.toString stand-in then called itself without end, and every
// fn.toString() on the page threw "Maximum call stack size exceeded" (Reddit's sidebar bundles never loaded). The preload now runs each
// script in its own function scope.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const {createFilterUpdates}=require('../desktop/browser-services/filter-updates.cjs');
const bundled=path.join(__dirname,'..','resources','filters'),filtersPath=fs.mkdtempSync(path.join(os.tmpdir(),'acira-scriptlet-filters-')),cachePath=fs.mkdtempSync(path.join(os.tmpdir(),'acira-scriptlet-cache-'));
for(const name of fs.readdirSync(bundled))if(name!=='engine.bin')fs.copyFileSync(path.join(bundled,name),path.join(filtersPath,name));
process.on('exit',()=>{for(const dir of [filtersPath,cachePath])try{fs.rmSync(dir,{recursive:true,force:true});}catch{}});

const href='https://www.reddit.com/r/programming/';
const query={url:href,hostname:'www.reddit.com',domain:'reddit.com',getBaseRules:false,getInjectionRules:true,getExtendedRules:false,getRulesFromHostname:true,getRulesFromDOM:false};
const redditScripts=()=>createFilterUpdates({filtersPath,cachePath}).getEngine().getCosmeticsFilters(query).scripts.filter(script=>script.includes('proxyApplyFn('));

/** What scriptlet-preload.cjs hands to webFrame.executeJavaScript for these scripts (the real file, with its electron, process and location stubbed). */
function executed(scripts){
 const sent=[],source=fs.readFileSync(path.join(__dirname,'..','desktop','browser-services','scriptlet-preload.cjs'),'utf8');
 const stub=id=>{assert.equal(id,'electron');return {ipcRenderer:{sendSync:(channel,url)=>{assert.equal(channel,'acira:scriptlets');assert.equal(url,href);return scripts;}},webFrame:{executeJavaScript:code=>{sent.push(code);return Promise.resolve();}}};};
 new vm.Script('(function(require,process,location){'+source+'\n})').runInThisContext()(stub,{isMainFrame:true},{href});
 return sent;
}
/** A fresh page world (the few browser globals the helpers read when they start) with the given scripts run in it, in order. */
const page=codes=>{const world=vm.createContext({Request:class{clone(){}},EventTarget:class{},XMLHttpRequest:class{},fetch(){},console:{log(){}},URL});world.self=world.window=world;for(const code of codes)vm.runInContext(code,world);return world;};
const probe='(()=>{try{return Function.prototype.toString.call(function a(){});}catch(error){return "THROW "+error.message;}})()';

test('two scriptlets that both wrap a built-in leave Function.prototype.toString working',()=>{
 const scripts=redditScripts();assert.ok(scripts.length>=2,'reddit.com has two or more scriptlets that use proxyApplyFn, found '+scripts.length);
 const sent=executed(scripts);assert.equal(sent.length,scripts.length,'every script is executed');
 const world=page(sent);
 assert.equal(vm.runInContext(probe,world),'function a(){}');
 assert.match(vm.runInContext('JSON.parse.toString()',world),/\[native code\]/,'a wrapped built-in still reports itself as native');
 assert.equal(vm.runInContext('JSON.stringify(JSON.parse(\'{"a":1}\'))',world),'{"a":1}','the wrapped JSON.parse still parses');
});

test('control: run bare, the same two scripts break toString (the failure this test guards)',()=>{
 const world=page(redditScripts());
 assert.match(vm.runInContext(probe,world),/THROW Maximum call stack size exceeded/);
});
