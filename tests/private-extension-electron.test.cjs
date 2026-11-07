'use strict';
// "Allow in private tabs" on the real engine: an allowed extension of an ordinary profile runs inside a temporary private session, with its settings copied in one
// way; a memory-only private session gets nothing (and the engine still refuses to load an extension there); the temporary folder is deleted with the session.
const {test}=require('node:test'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process'),path=require('node:path'),fs=require('node:fs');
const electron=(()=>{try{const value=require('electron');return typeof value==='string'&&fs.existsSync(value)?value:null;}catch{return null;}})();

test('electron: an allowed extension runs in a temporary private session, its settings are copied in one way, the folder goes with the session',{skip:!electron&&'Electron is not installed'},()=>{
 const run=spawnSync(electron,['--use-mock-keychain',path.join(__dirname,'fixtures','private-extension','run.cjs')],{encoding:'utf8',timeout:120000,env:{...process.env,ELECTRON_RUN_AS_NODE:undefined,ELECTRON_ENABLE_LOGGING:'0',ACIRA_TEST_TMP:process.env.TMPDIR||undefined}});
 const line=String(run.stdout).split('\n').find(text=>text.startsWith('RESULT '));assert.ok(line,'runner output: '+String(run.stdout).slice(-800)+String(run.stderr).slice(-600));
 const result=JSON.parse(line.slice(7));
 // Windows holds live Chromium session files open. Verify the real next-start sweep after the fixture exits, rather than requiring POSIX unlink semantics.
 const sweep=spawnSync(electron,['--use-mock-keychain',path.join(__dirname,'fixtures','private-extension','run.cjs')],{encoding:'utf8',timeout:30000,env:{...process.env,ELECTRON_RUN_AS_NODE:undefined,ACIRA_PRIVATE_SWEEP_ROOT:result.root}});
 const sweptLine=String(sweep.stdout).split('\n').find(text=>text.startsWith('SWEEP '));assert.ok(sweptLine,'startup sweep completed: '+sweep.stderr);
 const swept=JSON.parse(sweptLine.slice(6));assert.deepEqual(swept.remaining,[],'no temporary private extension folder survives the next start');
 fs.rmSync(result.root,{recursive:true,force:true});
 assert.equal(result.wanted,true);
 assert.deepEqual(result.persistent,[true,false,true],'kept in a folder (so an extension can load), and read as the private, ephemeral kind');assert.equal(result.folderUnderPartitions,true);
 assert.deepEqual(result.attached.failed,[]);assert.equal(result.attached.loaded.length,1);
 assert.equal(result.inPrivate.ran,'ran','its content script runs on a page of the private session');
 assert.equal(result.inPrivate.setting,'from-ordinary','its settings were copied in before it started');
 assert.match(String(result.inPrivate.sw),/"ok":true/,'its service worker answers the content script');
 assert.deepEqual(result.inMemoryPrivate,{ran:null,setting:null,sw:null},'a memory-only private session runs nothing');
 assert.match(String(result.memoryLoadError),/temporary session/,'and the engine itself still refuses to load an extension there');
 assert.deepEqual(result.ordinaryAfter,{setting:'from-ordinary'},'what the extension stores in private never reaches the ordinary profile');
 assert.deepEqual(result.privateStorage,{setting:'from-ordinary',privateOnly:'yes'});
 assert.equal(result.runtimeFilesInFolder,true,'what its runtime keeps lives in the session\'s own folder');
 assert.equal(result.detached,true);assert.equal(result.loadedAfterDetach,0,'its extensions are unloaded when the private session ends');
 if(process.platform!=='win32'){assert.equal(result.removed,true);assert.equal(result.folderAfter,false,'the folder is deleted immediately where live-session unlink is supported');}assert.equal(result.ordinaryStillThere,1,'the ordinary profile keeps its extension');
});
