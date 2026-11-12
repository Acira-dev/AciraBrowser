'use strict';
// A removed profile's extension runtime lets go of the app-wide events it followed, a window that goes from no website tab to one is observed
// once, and a page attached again is not observed twice. Real Electron (tests/fixtures/extension-runtime-leaks/run.cjs).
const {test}=require('node:test'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process'),path=require('node:path'),fs=require('node:fs');
const electron=(()=>{try{const value=require('electron');return typeof value==='string'&&fs.existsSync(value)?value:null;}catch{return null;}})();
let result=null,problem=null;
if(electron){
 const env={...process.env,ELECTRON_ENABLE_LOGGING:'0'};delete env.ELECTRON_RUN_AS_NODE;
 const run=spawnSync(electron,['--use-mock-keychain',path.join(__dirname,'fixtures','extension-runtime-leaks','run.cjs')],{encoding:'utf8',timeout:110000,env});
 const line=(run.stdout||'').split(/\r?\n/).find(text=>text.startsWith('RESULT '));
 if(line){result=JSON.parse(line.slice(7));if(result.data)try{fs.rmSync(result.data,{recursive:true,force:true});}catch{}}
 else problem=`no result (status ${run.status}, signal ${run.signal}): ${String(run.stderr||'').slice(-2000)}`;
}
const skip=!electron?'electron binary not available':false;

test('15 profiles made and removed leave the app-wide and shared-window listener counts where they started',{skip},()=>{
 assert.ok(result,problem);assert.equal(result.error,undefined,result.error);
 assert.ok(result.withOneMore.created>result.start.created&&result.withOneMore.lock>result.start.lock&&result.withOneMore.displayAdded>result.start.displayAdded,
  `a profile's runtime adds listeners while it lives (${JSON.stringify(result.withOneMore)} vs ${JSON.stringify(result.start)})`);
 assert.equal(result.disposed,15);
 assert.deepEqual(result.afterProfiles,result.start);
 assert.ok(result.sharedWindowWithOne.focus>result.sharedWindowStart.focus,'a profile\'s runtime observes the window its page shows in');
 assert.deepEqual(result.sharedWindowAfter,result.sharedWindowStart,'and lets go of it when the profile is removed');
 assert.deepEqual(result.extension,{loaded:1,workerRan:true,afterRemoval:{loaded:0,workerRunning:false}},'the removed profile\'s extension is unloaded and its worker stops');
 assert.equal(result.disposedTwice,false,'a runtime is disposed once');
 assert.equal(result.baseStillListed,true,'the profile that stays keeps its runtime');
});

test('a window that goes from no website tab to one, 30 times, is observed once',{skip},()=>{
 assert.ok(result,problem);assert.equal(result.error,undefined,result.error);
 assert.deepEqual(result.windowAfter30,result.windowAfterOne,`window listeners stay flat (${JSON.stringify(result.windowBefore)} before any tab)`);
 assert.equal(result.windowKnown,30,'the store lists the window again each time a tab is attached');
 assert.equal(result.windowCreated,1,'one windows.onCreated in 31 first tabs: the window never closed');
});

test('a page detached and attached again keeps its listener count and still comes back',{skip},()=>{
 assert.ok(result,problem);assert.equal(result.error,undefined,result.error);
 assert.equal(result.pageAfter30,result.pageBefore);
 assert.equal(result.tabAddedEvents,30,'later listeners (Acira\'s tabs and runtime packages) still hear every return');
 assert.equal(result.tabBack,true);
 assert.deepEqual(result.warnings,[]);
});

test('profile removal disposes the runtime, and the engine is adapted before any package listens',()=>{
 const main=fs.readFileSync(path.join(__dirname,'..','desktop','main.cjs'),'utf8');
 const at=main.indexOf('createProfileLifecycle({onRemoved:profile=>{'),hook=main.slice(at,main.indexOf(',controllers,',at));
 assert.ok(at>0&&hook.includes("disposeProfileRuntime(require('electron').session.fromPartition(profile.partition))"),hook);
 const manager=fs.readFileSync(path.join(__dirname,'..','desktop','browser-services','extension-manager.cjs'),'utf8');
 const adapt=manager.indexOf('observeOnce(runtime)'),packages=manager.indexOf("require('./extension-apis.cjs').installExtensionApis(runtime");
 assert.ok(adapt>0&&packages>adapt,'observeOnce runs before installExtensionApis adds its tab and window listeners');
});

// Soak, 11 Nov (13.7 tip): page-hang ended a heavy tab and its reload threw inside the engine's webNavigation listener ("Render frame was
// disposed before WebFrameMain could be accessed"), uncaught in main. Reload of a crashed tab and a new address on it took the same path.
test('a page whose renderer has gone reloads, or takes a new address, with no throw and nothing uncaught',{skip},()=>{
 assert.ok(result,problem);assert.equal(result.error,undefined,result.error);
 const {reload,address,uncaught}=result.crashedTab;
 assert.deepEqual(uncaught,[],'nothing uncaught in main');
 for(const [name,step,title] of [['reload',reload,'first'],['new address',address,'second']]){
  assert.equal(step.crashed,true,name+': the renderer had gone');assert.equal(step.threw,null,name+': no throw out of the call');
  assert.equal(step.loaded,true,name+': the page loads');assert.equal(step.title,title,name);assert.equal(step.crashedAfter,false,name);
 }
});

test('the engine\'s navigation listener skips only the disposed-frame error, keeps its place, and later listeners still hear the event',()=>{
 const {EventEmitter}=require('node:events'),{observeOnce}=require('../desktop/browser-services/extension-store-events.cjs');
 const engine=fs.readFileSync(require.resolve('electron-chrome-extensions').replace(/[^/\\]+$/,'index.js'),'utf8');
 assert.ok(engine.includes('tab.on("did-start-navigation", this.onBeforeNavigate.bind(this, tab));')&&engine.includes('var getFrameId = (frame) => frame === frame.top ? 0 : frame.frameTreeNodeId;'),'the engine still reads frame.top in its did-start-navigation listener (recheck this guard when it changes)');
 const store=new EventEmitter(),heard=[];
 store.on('tab-added',tab=>{tab.on('did-start-navigation',details=>{heard.push('engine:'+(details.frame===details.frame.top?0:1));});});
 assert.equal(observeOnce({ctx:{store}}),true);
 const tab=new EventEmitter();store.emit('tab-added',tab);tab.on('did-start-navigation',()=>heard.push('acira'));
 const live={get top(){return live;}},gone={get top(){throw new Error('Render frame was disposed before WebFrameMain could be accessed');}},broken={get top(){throw new Error('something else');}};
 tab.emit('did-start-navigation',{frame:live});
 assert.doesNotThrow(()=>tab.emit('did-start-navigation',{frame:gone}),'a navigation from a frame that has gone');
 assert.throws(()=>tab.emit('did-start-navigation',{frame:broken}),/something else/,'any other error still throws');
 assert.deepEqual(heard,['engine:0','acira','acira'],'the engine hears live frames first, as before; later listeners hear the gone-frame navigation');
 assert.equal(tab.listenerCount('did-start-navigation'),2);store.emit('tab-added',tab);assert.equal(tab.listenerCount('did-start-navigation'),2,'still observed once');
});
