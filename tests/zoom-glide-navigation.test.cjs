'use strict';
// 13.5: a website's zoom step is not glided while its main frame navigates, and a navigation that starts under a running glide lands it at once. A renderer crashed once (exit 11) with a
// dozen Emulation.setPageScaleFactor commands in flight while the page's second navigation was committing (no dump was kept). Real Electron, the real glide, a real page and a local server
// (tests/fixtures/zoom-glide-navigation/run.cjs); the unit tests (page-zoom-glide.test.cjs) run the same rules against a fake page.
const {test}=require('node:test'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process'),path=require('node:path'),fs=require('node:fs');
const electron=(()=>{try{const value=require('electron');return typeof value==='string'&&fs.existsSync(value)?value:null;}catch{return null;}})();
const fixture=path.join(__dirname,'fixtures','zoom-glide-navigation','run.cjs');
function once(){
 // macOS asks "quit unexpectedly while reopening windows" after a crashed run: ignore the saved state so a crash fails this test instead of hanging the next one
 const args=[fixture,...(process.platform==='darwin'?['-ApplePersistenceIgnoreState','YES']:[])];
 const run=spawnSync(electron,args,{encoding:'utf8',timeout:110000,killSignal:'SIGKILL',env:{...process.env,ELECTRON_RUN_AS_NODE:undefined,ELECTRON_ENABLE_LOGGING:'0'}});
 const line=(run.stdout||'').split(/\r?\n/).find(text=>text.startsWith('RESULT '));
 return {status:run.status,signal:run.signal,timedOut:run.error?.code==='ETIMEDOUT',result:line?JSON.parse(line.slice(7)):null,output:((run.stdout||'')+(run.stderr||'')).slice(0,800)};
}
let attempt=null;
if(electron){attempt=once();if(attempt.timedOut||attempt.result?.error==='timed out')attempt=once();/* a page that never finishes loading is not this bug: look once more */}
const skip=!electron?'electron binary not available':false;
const steps=()=>{assert.ok(attempt.result,attempt.output);assert.equal(attempt.result.error,undefined,attempt.result.error);assert.equal(attempt.signal,null,'the process was killed by '+attempt.signal);return attempt.result.steps;};
const named=(all,text)=>{const step=all.find(item=>item.name.startsWith(text));assert.ok(step,'no step "'+text+'" in '+JSON.stringify(all.map(item=>item.name)));return step;};

test('13.5: outside a navigation the glide is what it was (many page scale frames, the zoom lands, the scale ends at 1)',{skip},()=>{
 const all=steps(),base=named(all,'baseline glide');
 assert.equal(base.glided,true);assert.ok(base.frames>=8,`${base.frames} frames`);assert.equal(base.lastScale,1);assert.equal(base.zoom,110);assert.equal(base.gliding,false);assert.equal(named(all,'baseline reset').zoom,100);
 const again=named(all,'glide again after all of it');assert.equal(again.glided,true);assert.ok(again.frames>=2,`${again.frames} frames after every navigation case`);
});

test('13.5: a zoom step while the main frame navigates (slow load, redirect, script redirect after the first commit) is applied at once and sends no page scale command',{skip},()=>{
 const all=steps();assert.equal(attempt.result.sawStart,true,'the page reported its navigation starting (the event shape in this Electron)');
 assert.equal(attempt.result.guardSawStart,true,'the glide followed the navigation');
 const slow=named(all,'step during a slow navigation');assert.equal(slow.navigating,true);assert.equal(slow.guard,true);assert.equal(slow.glided,false);assert.equal(slow.frames,0);assert.equal(slow.zoomNow,90,'applied at once');
 const redirect=named(all,'steps during a redirect chain');assert.deepEqual(redirect.glided,[false,false]);assert.equal(redirect.frames,0);
 const challenge=named(all,'step during the second navigation of a challenge');assert.equal(challenge.glided,false);assert.equal(challenge.frames,0);assert.equal(challenge.events.filter(e=>e==='start').length,2,JSON.stringify(challenge.events));assert.ok(challenge.events.includes('navigate'),'the first navigation did commit before the second began');
 assert.equal(attempt.result.commandsWhileNavigating,1,'the only page scale command sent while a main frame was between start and commit is the landing of the running glide at the moment its navigation began (the scale back to 1)');
 assert.deepEqual(attempt.result.gone,[],'no renderer crash');
 for(const text of ['after it commits','after it commits (3)','after it commits (4)','after it commits (5)']){assert.equal(named(all,text).navigating,false,text);assert.equal(named(all,text).guard,false,text);}
});

test('13.5: a navigation that starts under a running glide lands it at once (the final zoom, the page scale back to 1)',{skip},()=>{
 const all=steps(),step=named(all,'glide, then a navigation starts');
 assert.equal(step.glided,true);assert.equal(step.wasGliding,true,'the glide was running when the navigation began');assert.equal(step.gliding,false,'and it is over');assert.equal(step.zoomNow,110,'the final zoom is applied now');assert.equal(step.lastScale,1);assert.equal(step.framesWhileNavigating,1,'one command after the navigation started: the scale back to 1');
});

test('13.5: the guard ends with the navigation: a hash change is not one, and a failed load, Stop and a 204 end it',{skip},()=>{
 const all=steps(),hash=named(all,'step after a hash change');assert.equal(hash.glided,true);assert.ok(hash.frames>=2);
 const failed=named(all,'failed load');assert.equal(failed.glidedDuring,false);assert.equal(attempt.result.failEnded,true,'a failed main-frame load ends the guard');
 assert.equal(attempt.result.stopEnded,true,'Stop ends it');assert.equal(attempt.result.noContentEnded,true,'a 204 ends it');
});
