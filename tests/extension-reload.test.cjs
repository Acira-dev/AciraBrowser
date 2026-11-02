'use strict';
// The extensions page's Reload must fully restart an MV3 extension: the worker that answers after a Reload runs the new code (the first Reload
// after Load used to leave the first worker running or unanswered), only one worker runs for it, and the next page load gets the new content script.
// Real Electron, isolated profile under .qa-profiles (tests/fixtures/extension-reload/run.cjs).
const {test}=require('node:test'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process'),path=require('node:path'),fs=require('node:fs');
const electron=(()=>{try{const value=require('electron');return typeof value==='string'&&fs.existsSync(value)?value:null;}catch{return null;}})();
let result=null,problem=null;
if(electron){const run=spawnSync(electron,[path.join(__dirname,'fixtures','extension-reload','run.cjs')],{encoding:'utf8',timeout:110000,env:{...process.env,ELECTRON_RUN_AS_NODE:undefined,ELECTRON_ENABLE_LOGGING:'0'}});const line=(run.stdout||'').split(/\r?\n/).find(text=>text.startsWith('RESULT '));if(line)result=JSON.parse(line.slice(7));else problem=((run.stdout||'')+(run.stderr||'')).slice(0,800)||'no result';}
const skip=!electron?'electron binary not available':false;

test('Reload restarts the worker with the new code and reapplies content scripts, every time',{skip},()=>{
 assert.ok(result,problem);assert.equal(result.error,undefined,result.error);
 const reloads=result.steps.filter(step=>step.step==='reload');
 assert.equal(reloads.length,5,'three rounds of Load > Reload, the first with three Reloads');
 const seen=new Set();
 for(const step of result.steps){
  if(step.step==='install'){for(const worker of step.running)seen.add(worker.version);continue;}
  const label=`reload to ${step.expect}`;
  assert.equal(step.page.content,step.expect,`${label}: the page got the new content script (${JSON.stringify(step.page)})`);
  assert.equal(step.page.error,null,`${label}: the content script reached the worker (${JSON.stringify(step.page)})`);
  assert.equal(step.page.worker?.build,step.expect,`${label}: the worker that answered runs the new code (${JSON.stringify(step.page)})`);
  assert.ok(step.running.length<=1,`${label}: one worker runs for the extension (${JSON.stringify(step.running)})`);
  for(const worker of step.running)assert.ok(!seen.has(worker.version),`${label}: no earlier worker is still running (${JSON.stringify(step.running)})`);
  for(const worker of step.running)seen.add(worker.version);
  assert.deepEqual(step.registry,[{id:result.id,enabled:true}]);
 }
});

test('the reload path waits for the old extension to unload and its worker to stop before loading again',()=>{
 const source=fs.readFileSync(path.join(__dirname,'..','desktop','browser-services','extension-manager.cjs'),'utf8');
 assert.match(source,/async function unloadFully\(/);
 assert.match(source,/if\(loaded\)await unloadFully\(session,api,loaded\.id[^)]*\);let extension;/,'Reload/Update/Enable unload fully before loading');
 assert.match(source,/await unloadFully\(session,api,loaded\.id[^)]*\);await api\.loadExtension\(found\.path/,'so does the user scripts switch, which restarts the extension');
 assert.doesNotMatch(source,/if\(loaded\)api\.removeExtension\(loaded\.id\);let extension/,'no load straight after removeExtension');
});
