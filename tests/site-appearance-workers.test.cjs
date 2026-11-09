'use strict';
// 13.4: "Always dark" killed the whole browser. In 13.3 desktop/site-appearance.cjs asked Chromium to attach the page's debugger session to everything the page starts
// (Target.setAutoAttach) and sent Target.detachFromTarget for every Web Worker; on any site that starts workers (Cloudflare's check page, YouTube, Maps, Twitter...) Electron's
// MAIN process died with a SIGSEGV (EXC_BAD_ACCESS at 0x50) a few seconds later. A unit test with a stand-in debugger cannot see that, so this one runs the real module in a real
// Electron against a page that keeps starting and ending workers (tests/fixtures/site-appearance-workers/run.cjs): the process must survive, the page must be told dark and so must
// its cross-site frame. Unfixed, the fixture's process is killed by SIGSEGV (no RESULT line, signal set).
const {test}=require('node:test'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process'),path=require('node:path'),fs=require('node:fs');
const electron=(()=>{try{const value=require('electron');return typeof value==='string'&&fs.existsSync(value)?value:null;}catch{return null;}})();
const fixture=path.join(__dirname,'fixtures','site-appearance-workers','run.cjs');
// Every configuration that holds a session: Always dark on either Acira, Dark on a light Acira, Light on a dark Acira (Dark on a dark Acira and Light on a light one hold none).
const CONFIGS=[{mode:'always-dark',acira:'light',dark:true},{mode:'dark',acira:'light',dark:true},{mode:'light',acira:'dark',dark:false}];
function once(config){
 // macOS asks "Electron quit unexpectedly while reopening windows" after a crashed run and waits for an answer: ignore the saved state so a crash fails this test instead of hanging the next one
 const args=[fixture,...(process.platform==='darwin'?['-ApplePersistenceIgnoreState','YES']:[])];
 const run=spawnSync(electron,args,{encoding:'utf8',timeout:100000,killSignal:'SIGKILL',env:{...process.env,ELECTRON_RUN_AS_NODE:undefined,ELECTRON_ENABLE_LOGGING:'0',WORKER_SECONDS:'7',WORKER_MODE:config.mode,WORKER_ACIRA:config.acira}});
 const line=(run.stdout||'').split(/\r?\n/).find(text=>text.startsWith('RESULT '));
 return {status:run.status,signal:run.signal,timedOut:run.error?.code==='ETIMEDOUT',result:line?JSON.parse(line.slice(7)):null,output:((run.stdout||'')+(run.stderr||'')).slice(0,600)};
}
const attempts=new Map();
if(electron)for(const config of CONFIGS){let attempt=once(config);if(attempt.timedOut||attempt.result?.error==='timed out')attempt=once(config);/* a page that never finishes loading is not this bug: look once more */attempts.set(config,attempt);}
const skip=!electron?'electron binary not available':false;

for(const config of CONFIGS){
 const label=`${config.mode} on a ${config.acira} Acira`;
 test(`13.4: ${label}: a page that keeps starting Web Workers does not kill the browser process`,{skip},()=>{
  const attempt=attempts.get(config);
  assert.equal(attempt.signal,null,`the browser process was killed by ${attempt.signal} (13.3: SIGSEGV after Target.detachFromTarget on a worker)`);
  assert.ok(attempt.result,'no result: '+attempt.output);assert.equal(attempt.result.error,undefined,attempt.result.error);assert.equal(attempt.status,0);
  assert.deepEqual(attempt.result.gone,[],'no renderer crashed either');assert.equal(attempt.result.alive,true);
 });
 test(`13.4: ${label}: the page and its cross-site frame are told ${config.dark?'dark':'light'}, and only frames are followed`,{skip},()=>{
  const {result}=attempts.get(config);assert.ok(result,attempts.get(config).output);
  assert.equal(result.state.session,true,'the page holds its debugger session');assert.equal(result.state.want.scheme,config.dark?'dark':'light');assert.equal(result.state.want.auto,config.mode==='always-dark');
  assert.equal(result.page,config.dark,'the page is told what the setting says, whatever Acira looks like');
  assert.equal(result.frames.length,1);assert.equal(result.frames[0].dark,config.dark,'the cross-site frame gets the same commands through the iframe-only auto-attach');
  assert.equal(result.state.frames,1,'one followed target: the frame, no worker');
 });
}

test('13.4: the source never detaches an auto-attached target, and asks for frames only',()=>{
 const source=fs.readFileSync(path.join(__dirname,'..','desktop','site-appearance.cjs'),'utf8').split(/\r?\n/).filter(line=>!/^\s*\/\//.test(line)).join('\n');
 assert.doesNotMatch(source,/detachFromTarget/,'Target.detachFromTarget on a worker session killed the browser process');
 assert.match(source,/filter:\s*\[\{type:\s*'iframe'\},\s*\{exclude:\s*true\}\]/,'auto-attach is limited to frames');
});
