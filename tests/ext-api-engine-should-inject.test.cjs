'use strict';
// The engine preload (electron-chrome-extensions) runs in every service worker of a profile, websites' included. Its i18n stand-in is for MV3
// extension contexts only (shouldInject); Acira's runtime built it anyway wherever chrome.i18n was missing, and in a website's worker (no
// manifest) that threw, so every worker start logged "Acira: chrome.i18n could not be built" to the page console.
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {rendererSource}=require('../desktop/browser-services/ext-api/index.cjs');

// The engine's own i18n definition (chrome-extension-api.preload.js, 4.9.0), as its table hands it to after().
const engineTable=manifest=>({i18n:{shouldInject:()=>manifest.manifest_version===3,factory:base=>{if(base.getMessage)return base;return {...base,getUILanguage:()=>'en-US',getMessage:name=>name};}}});

function contextFor(manifest){
 const errors=[];
 const sandbox={electron:{invokeExtension:async()=>undefined},extensionId:manifest.manifest_version?'abcdefghijklmnopabcdefghijklmnop':undefined,manifest,
  ExtensionEvent:class{constructor(name){this.name=name;}addListener(){}removeListener(){}},acira_withLastError:(_error,run)=>run(),
  console:{error:(...args)=>errors.push(args.map(String).join(' ')),warn(){},log(){}}};
 sandbox.globalThis=sandbox;vm.createContext(sandbox);
 const runtime=vm.runInContext(rendererSource({packages:[]}),sandbox);
 return {runtime,errors};
}

test('a website service worker (no manifest): the MV3-only i18n stand-in is not built and nothing is logged',()=>{
 const manifest={},{runtime,errors}=contextFor(manifest),chrome={};
 runtime.after(chrome,engineTable(manifest));
 assert.equal(chrome.i18n,undefined);
 assert.deepEqual(errors,[]);
});

test('an MV2 extension context missing chrome.i18n is left as the engine leaves it',()=>{
 const manifest={manifest_version:2,name:'x',version:'1'},{runtime,errors}=contextFor(manifest),chrome={};
 runtime.after(chrome,engineTable(manifest));
 assert.equal(chrome.i18n,undefined);
 assert.deepEqual(errors,[]);
});

test('an MV3 extension context keeps its native chrome.i18n untouched',()=>{
 const manifest={manifest_version:3,name:'x',version:'1'},{runtime,errors}=contextFor(manifest),native={getMessage:()=>'native'},chrome={i18n:native};
 runtime.after(chrome,engineTable(manifest));
 assert.equal(chrome.i18n.getMessage('a'),'native');
 assert.deepEqual(errors,[]);
});
