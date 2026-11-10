'use strict';
// 13.5: zooming a page, or changing Acira's appearance, turned Always dark off until the page was reloaded. webContents.setVisualZoomLevelLimits (the old way to clear a pinch, and to
// enable pinch at page creation) and a change of the system colour scheme make Chromium push the page's web preferences again, which resets the Auto Dark Mode override that the page's
// debugger session holds. Real Electron, the real modules, a white page with no dark theme of its own, what the page SHOWS measured after each step (tests/fixtures/always-dark-zoom/run.cjs).
const {test}=require('node:test'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process'),path=require('node:path'),fs=require('node:fs');
const electron=(()=>{try{const value=require('electron');return typeof value==='string'&&fs.existsSync(value)?value:null;}catch{return null;}})();
const fixture=path.join(__dirname,'fixtures','always-dark-zoom','run.cjs');
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
const DARK=90,LIGHT=170; // a white page darkened by Auto Dark Mode shows about 33; undarkened about 244
const steps=()=>{assert.ok(attempt.result,attempt.output);assert.equal(attempt.result.error,undefined,attempt.result.error);assert.equal(attempt.signal,null,'the process was killed by '+attempt.signal);return attempt.result.steps;};

test('13.5: Always dark: every zoom step (glide, burst during a glide, instant, after a pinch) leaves the page dark',{skip},()=>{
 const all=steps(),zoom=all.filter(step=>/^(loaded|limits|zoom|reset|burst|instant)/.test(step.name));
 assert.equal(zoom.length,8,JSON.stringify(zoom.map(step=>step.name)));
 for(const step of zoom){assert.equal(step.session,true,`${step.name}: the session is still held`);assert.ok(step.luma<DARK,`${step.name}: the page is dark (luma ${step.luma}); 13.4 turned it light`);}
 assert.equal(attempt.result.scaleAfterClear,1,'a pinch magnification is cleared with the page scale');
});

test('13.5: Always dark: a change of Acira\'s appearance (the app\'s or the system\'s) leaves the page dark',{skip},()=>{
 const all=steps(),theme=all.filter(step=>/^Acira appearance/.test(step.name));
 assert.equal(theme.length,3);
 for(const step of theme)assert.ok(step.luma<DARK,`${step.name}: the page is dark (luma ${step.luma}); 13.4 turned it light`);
});

test('13.5: the cause, as a control: clearing a pinch the old way (visual zoom limits) really does turn the page light, and one reassert brings it back',{skip},()=>{
 const all=steps(),old=all.find(step=>/^CONTROL: webContents/.test(step.name)),back=all.find(step=>/^CONTROL: reassert/.test(step.name));
 assert.ok(old&&back);assert.equal(old.session,true,'the session was never lost: only the override was');
 assert.ok(old.luma>LIGHT,`the old clearing wipes the override (luma ${old.luma}). If this fails, Chromium stopped doing that: the workaround in page-zoom-glide.cjs can be revisited.`);
 assert.ok(back.luma<DARK,`reassert() tells the page again (luma ${back.luma})`);
});

test('13.5: a link preview gets its zoom limits when it is made; the tab path finds them there and applies nothing',{skip},()=>{
 steps();assert.equal(attempt.result.limitsAgain,false);
});
