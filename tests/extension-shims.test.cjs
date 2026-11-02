'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const {applyStorageSyncShim,SHIM_NAME,SHIM_SOURCE}=require('../desktop/browser-services/extension-shims.cjs');

function pack(manifest){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'acira-shim-'));fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify(manifest));return dir;}
const read=dir=>JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'),'utf8'));

test('the sync shim goes first in isolated-world content scripts of a package that uses storage, once',()=>{
 const dir=pack({manifest_version:3,permissions:['storage'],content_scripts:[{matches:['<all_urls>'],js:['a.js','b.js']},{matches:['<all_urls>'],js:['main.js'],world:'MAIN'},{matches:['<all_urls>'],css:['x.css']}]});
 assert.equal(applyStorageSyncShim(dir),true);
 const manifest=read(dir);
 assert.deepEqual(manifest.content_scripts[0].js,[SHIM_NAME,'a.js','b.js']);
 assert.deepEqual(manifest.content_scripts[1].js,['main.js'],'main-world scripts are left alone');
 assert.equal(manifest.content_scripts[2].js,undefined);
 assert.ok(fs.existsSync(path.join(dir,SHIM_NAME)));
 assert.equal(applyStorageSyncShim(dir),false,'idempotent');
 assert.deepEqual(read(dir).content_scripts[0].js,[SHIM_NAME,'a.js','b.js']);
});

test('packages without the storage permission or content scripts are untouched',()=>{
 for(const manifest of [{manifest_version:3,permissions:['tabs'],content_scripts:[{matches:['<all_urls>'],js:['a.js']}]},{manifest_version:3,permissions:['storage']}]){
  const dir=pack(manifest);assert.equal(applyStorageSyncShim(dir),false);assert.deepEqual(read(dir),manifest);assert.ok(!fs.existsSync(path.join(dir,SHIM_NAME)));
 }
 assert.equal(applyStorageSyncShim(path.join(os.tmpdir(),'acira-shim-missing')),false);
});

test('a package shimmed by an older Acira gets the current script once (sync is now its own area, not storage.local)',()=>{
 const manifest={manifest_version:3,permissions:['storage'],content_scripts:[{matches:['<all_urls>'],js:['a.js']}]};
 const dir=pack(manifest);assert.equal(applyStorageSyncShim(dir),true);
 fs.writeFileSync(path.join(dir,SHIM_NAME),'// old shim: storage.sync -> storage.local');
 assert.equal(applyStorageSyncShim(dir),true,'the stale script is replaced');
 assert.equal(fs.readFileSync(path.join(dir,SHIM_NAME),'utf8'),SHIM_SOURCE);
 assert.deepEqual(read(dir).content_scripts[0].js,[SHIM_NAME,'a.js'],'the manifest is not changed again');
 assert.equal(applyStorageSyncShim(dir),false,'idempotent');
 assert.ok(SHIM_SOURCE.includes('__acira_sync__'),'the shim is generated from the sync core');
});
