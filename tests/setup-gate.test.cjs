'use strict';
// beta.11 (P1): on a first run Acira's own scheduled downloads (filter lists, phishing and malware lists, the reviewed-sites list, the update check) wait until
// setup is finished or skipped. browser-services/setup-gate.cjs is the gate; main.cjs holds and releases it; content-blocking.cjs and the updater start behind it.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createSetupGate,setupGate,setupDue,setupFinished}=require('../desktop/browser-services/setup-gate.cjs');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const folder=()=>fs.mkdtempSync(path.join(os.tmpdir(),'acira-setup-gate-'));
const onboarding=(dir,installation)=>{fs.mkdirSync(path.join(dir,'setup'),{recursive:true});fs.writeFileSync(path.join(dir,'setup','onboarding.json'),JSON.stringify({version:2,installation:{step:'welcome',complete:false,skipped:false,upgraded:false,...installation},profiles:{}}));};

test('the gate starts open, so nothing that uses it changes until main.cjs holds it',()=>{
 assert.equal(createSetupGate().isOpen,true);let ran=0;createSetupGate().after(()=>ran++);assert.equal(ran,1);
 assert.equal(setupGate.isOpen,true,'the shared gate is open until hold() (module defaults: tests, tools)');
});

test('a held gate queues jobs and release runs each once, in order; later jobs run at once; release twice is harmless; a failing job stops nobody',()=>{
 const gate=createSetupGate();gate.hold();const order=[];
 gate.after(()=>order.push('lists'));gate.after(()=>{throw new Error('one job fails');});gate.after(()=>order.push('update check'));
 assert.equal(gate.isOpen,false);assert.equal(gate.waiting,3);assert.deepEqual(order,[],'nothing runs while setup is on screen');
 gate.release();assert.deepEqual(order,['lists','update check']);assert.equal(gate.isOpen,true);assert.equal(gate.waiting,0);
 gate.release();assert.deepEqual(order,['lists','update check'],'each job ran once');
 gate.after(()=>order.push('late'));assert.deepEqual(order,['lists','update check','late'],'after release a job starts at once');
});

test('setup is due on a first run, and while setup\'s own file says it is neither finished, skipped nor an upgrade; never for an older install without that file',()=>{
 const empty=folder(),finished=folder(),skipped=folder(),running=folder(),upgraded=folder(),older=folder(),broken=folder();
 try{
  assert.equal(setupDue(empty),true,'no browser data at all: a first run');
  for(const dir of [finished,skipped,running,upgraded,older,broken])fs.writeFileSync(path.join(dir,'browser.sqlite'),'x');
  onboarding(finished,{complete:true});onboarding(skipped,{complete:true,skipped:true});onboarding(running,{step:'search'});onboarding(upgraded,{upgraded:true});
  fs.mkdirSync(path.join(broken,'setup'),{recursive:true});fs.writeFileSync(path.join(broken,'setup','onboarding.json'),'{not json');
  assert.equal(setupDue(finished),false);assert.equal(setupDue(skipped),false);assert.equal(setupDue(upgraded),false);assert.equal(setupDue(older),false,'an install that predates setup\'s file');
  assert.equal(setupDue(running),true,'closed at step 4: the next start is quiet again until setup ends');
  assert.equal(setupDue(broken),false,'a damaged file never holds the downloads');
  fs.writeFileSync(path.join(running,'browser-state.json'),'{}');assert.equal(setupDue(running),true,'either database file counts as existing data, the file still decides');
  // a browser database that exists but with no setup file is an older install, whatever else is there
  const sqliteOnly=folder();fs.writeFileSync(path.join(sqliteOnly,'browser-state.json'),'{}');assert.equal(setupDue(sqliteOnly),false);fs.rmSync(sqliteOnly,{recursive:true,force:true});
 }finally{for(const dir of [empty,finished,skipped,running,upgraded,older,broken])fs.rmSync(dir,{recursive:true,force:true});}
});

test('setup counts as finished when its own answer says complete (finish and skip both set it), not while it runs and not for an error',()=>{
 assert.equal(setupFinished({ok:true,progress:{complete:true,skipped:true}}),true,'Skip setup');
 assert.equal(setupFinished({ok:true,progress:{complete:true,skipped:false,pendingSetup:true}}),true,'a later profile\'s short setup does not hold the downloads');
 assert.equal(setupFinished({ok:true,progress:{complete:false,step:'privacy'}}),false);
 for(const bad of [null,undefined,{},{ok:false,progress:{complete:true}},{ok:true},{ok:true,progress:{}}])assert.equal(setupFinished(bad),false);
});

test('main.cjs: holds the gate at start only when setup is due (before the database exists), releases it from setup\'s own answers, never leaves it held when the answer cannot be read',()=>{
 const main=read('desktop/main.cjs');
 assert.match(main,/const \{setupGate,setupDue,setupFinished\}=require\('\.\/browser-services\/setup-gate\.cjs'\)/);
 const held=main.indexOf("if(setupDue(app.getPath('userData')))setupGate.hold();");
 assert.ok(held>0,'held at start');assert.ok(held<main.indexOf('showSplash();/* Widevine: an ECS runtime'),'read first thing, before the splash and the database');
 assert.ok(held<main.indexOf("openBrowserDatabase({create:"),'before the browser database is created');
 assert.match(main,/const syncOnboarding=r=>\{[^]*?if\(setupFinished\(r\)\)setupGate\.release\(\);return r;\};/,'every setup answer (start-up status, finish, skip) goes through syncOnboarding');
 assert.match(main,/if\(!setupService\)setupGate\.release\(\)/,'no setup service: nothing to wait for');
 assert.match(main,/const pending=setupPending\(syncOnboarding\(r\)\);if\(!pending\)setupGate\.release\(\);decide\(pending\);/,'an answer that is not "setup is running" releases it');
 assert.match(main,/\(\)=>\{setupGate\.release\(\);decide\(false\);\}/,'a status that cannot be read releases it');
 assert.match(main,/setupGate\.after\(\(\)=>appUpdater\.start\(\)\)/,'the update check starts behind the gate');
 assert.equal((main.match(/appUpdater\.start\(\)/g)||[]).length,1,'no other way to start the scheduled update check');
 assert.equal((main.match(/setupGate\.hold\(\)/g)||[]).length,1,'held in one place only');
});

test('content-blocking.cjs: the filter lists, the phishing and malware lists and the reviewed-sites list all start behind the gate, on their own schedule from the moment it opens',()=>{
 const blocking=read('desktop/content-blocking.cjs');
 assert.match(blocking,/const \{setupGate\}=require\('\.\/browser-services\/setup-gate\.cjs'\);/);
 const at=blocking.indexOf('setupGate.after(()=>{updates.startAutomatic(ordinarySession);');
 assert.ok(at>0);
 const block=blocking.slice(at,blocking.indexOf('pipeline.useBefore(debounceRequest)',at));
 assert.match(block,/threatLists\.maybeRefresh\(session\)/,'the threat lists (and through them the reviewed-sites list)');
 assert.match(block,/setTimeout\(run,30000\)[^]*setTimeout\(\(\)=>\{[^]*\},6000\)[^]*setInterval\(run,6\*60\*60\*1000\)/,'same timers as before');
 // nothing outside the gate starts a scheduled refresh
 const outside=blocking.slice(0,at)+blocking.slice(at+block.length);
 assert.equal(/startAutomatic\(/.test(outside),false,'no startAutomatic outside the gate');
 assert.equal(/threatLists\.maybeRefresh\(/.test(outside),false,'no scheduled threat-list refresh outside the gate');
 assert.equal(/allowlist[^;]{0,40}maybeRefresh/.test(outside),false,'the reviewed-sites list is refreshed only by the threat lists\' schedule (threat-lists.cjs maybeRefresh)');
});

test('nothing else in the main process starts a scheduled download by itself: the only callers of the scheduled jobs are the gated ones',()=>{
 const files=['desktop/main.cjs','desktop/content-blocking.cjs'];
 for(const file of files){const text=read(file);
  for(const call of ['updates.startAutomatic(','appUpdater.start(']){const n=(text.match(new RegExp(call.replace(/[().]/g,'\\$&'),'g'))||[]).length;if(n)assert.equal(n,1,file+' '+call);}
 }
 // the manual paths stay open (the person's own click is check({manual:true}), item 14): Settings > Updates "Check", Settings > Privacy "Update lists now" are the person's own actions
 assert.match(read('desktop/main.cjs'),/request\.type==='update\.check'\?appUpdater\.check\(\{manual:true\}\)/);
 assert.match(read('desktop/main.cjs'),/contentBlocking\.filterLists\.refresh\(ses\)/);
});
