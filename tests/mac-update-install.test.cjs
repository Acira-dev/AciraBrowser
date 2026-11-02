'use strict';
// Install now on a Mac, as qa/mac-update-delivery.mjs runs it for real (signed copies, Squirrel.Mac, ShipIt), reduced to what can run anywhere:
// - a downloaded update is handed to Squirrel once. A later check (the 8-hour one, or Settings' Check for updates) used to hand it over again: Squirrel
//   answered with an error, the status became 'error' and the Update pill and Install now disappeared (rig run baseline1 on 2 Nov);
// - Install now starts the quit like any quit. Electron's quitAndInstall closes the windows before before-quit, so the last window used to ask
//   "Close Acira?" (askBeforeClosing is on by default) after the person had already chosen to restart, and the closing windows were not kept for the next start.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{EventEmitter}=require('node:events');
const {createAppUpdater}=require('../desktop/browser-services/app-updater.cjs');
const {createCloseGuard,QUIT_WINDOW_MS}=require('../desktop/close-guard.cjs');
const folder=t=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'acira-mac-install-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;};

function squirrel(){
 const native=new EventEmitter();native.checks=0;native.installs=0;
 native.checkForUpdates=async()=>{native.checks+=1;native.emit('checking-for-update');native.emit('update-available',{version:'0.1.0-beta.8'});native.emit('update-downloaded',{version:'0.1.0-beta.8',releaseNotes:'- Faster start'});};
 native.quitAndInstall=()=>{native.installs+=1;};native.setFeedURL=()=>{};
 return native;
}
const mac=(dir,native,extra={})=>createAppUpdater({app:{isPackaged:true,getVersion:()=>'0.1.0-beta.7',getPath:()=>dir},dir,platform:'darwin',env:{},macAvailability:()=>null,autoUpdater:native,schedule:()=>null,every:()=>null,...extra});

test('Mac: a downloaded update waiting for Install now is not checked for again, so Install now stays',async t=>{
 const native=squirrel(),updater=mac(folder(t),native);
 assert.equal((await updater.check()).status,'ready');assert.equal(native.checks,1);
 const again=await updater.check(); // the 8-hour check, or Settings' Check for updates
 assert.equal(native.checks,1,'Squirrel is not handed the update a second time');
 assert.equal(again.status,'ready');assert.equal(again.available,'0.1.0-beta.8');
 assert.equal((await updater.install()).installing,true);assert.equal(native.installs,1);
});

test('Mac: the scheduled checks skip a waiting update too',async t=>{
 const native=squirrel(),runs=[];
 const updater=mac(folder(t),native,{schedule:fn=>{runs.push(fn);return null;},every:fn=>{runs.push(fn);return null;}});
 updater.start();assert.equal(runs.length,2,'the first check and the 8-hour loop');
 runs[0]();await new Promise(resolve=>setImmediate(resolve));assert.equal(updater.status().status,'ready');
 runs[1]();runs[1]();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(native.checks,1);assert.equal(updater.status().status,'ready');
});

test('Windows keeps looking while an update waits: a newer one replaces it (NsisUpdater handles that)',async t=>{
 const native=squirrel(),updater=createAppUpdater({app:{isPackaged:true,getVersion:()=>'0.1.0-beta.7',getPath:()=>os.tmpdir()},dir:folder(t),platform:'win32',env:{},uninstallerPresent:()=>true,qaBuild:false,autoUpdater:native,schedule:()=>null,every:()=>null});
 await updater.check();await updater.check();assert.equal(native.checks,2);
});

test('main.cjs starts the quit when Install now begins (before-quit-for-update), exactly as before-quit does',()=>{
 const main=fs.readFileSync(path.join(__dirname,'..','desktop','main.cjs'),'utf8');
 const begin=main.match(/const beginQuit=\(\)=>\{([^\n]*)\};\n/);assert(begin,'one function for both');
 assert.match(begin[1],/^openWindows\.begin\(\);/,'the windows that close from here are part of the next start');
 assert.match(begin[1],/closeGuard\.noteQuit\(\);/,'no "Close Acira?" for a quit that was already decided');
 assert.match(begin[1],/for\(const controller of controllers\)controller\.save\(\);/);
 assert.match(main,/app\.on\('before-quit',beginQuit\);/);
 const hook=main.match(/require\('electron'\)\.autoUpdater\.on\('before-quit-for-update',\(\)=>\{([^\n]*)\}\);\n/);assert(hook);
 assert.match(hook[1],/process\.platform==='darwin'&&!updateQuit\)updateQuit=require\('\.\/browser-services\/update-quit\.cjs'\)\.createUpdateQuit\(\{quit:\(\)=>app\.quit\(\)\}\);beginQuit\(\);$/);
 assert.match(main,/require\('electron'\)\.autoUpdater\.on\('error',\(\)=>updateQuit\?\.failed\(\)\);/);
 // the last window: Acira quits by itself, except during a Mac update quit, where Squirrel ends the app after writing ShipIt's request
 assert.match(main,/if\(!\[\.\.\.controllers\]\.some\(c=>!c\.switchedAway\)&&!quitting\)updateQuit\?updateQuit\.lastWindowClosed\(\):app\.quit\(\);\}\);/,'windows left only behind one that stepped aside for another profile count as gone (close-guard)');
});

test('Mac update quit: the last window leaves the ending to Squirrel, with a way out when it fails or stalls',()=>{
 const {createUpdateQuit,FALLBACK_MS}=require('../desktop/browser-services/update-quit.cjs');
 const rig=()=>{const timers=[],quits=[];const q=createUpdateQuit({quit:()=>quits.push('quit'),setTimer:(fn,ms)=>{const t={fn,ms,cleared:false};timers.push(t);return t;},clearTimer:t=>{t.cleared=true;}});return {q,timers,quits};};
 // normal: Squirrel writes its request and ends the app; Acira never quits first
 let r=rig();r.q.lastWindowClosed();assert.deepEqual(r.quits,[]);assert.equal(r.timers.length,1);assert.equal(r.timers[0].ms,FALLBACK_MS);assert.equal(r.q.waiting,true);
 r.q.lastWindowClosed();assert.equal(r.timers.length,1,'armed once');
 // stalled: the way out quits the ordinary way (the update still installs, without reopening)
 r.timers[0].fn();assert.deepEqual(r.quits,['quit']);r.q.failed();assert.deepEqual(r.quits,['quit'],'once');
 // Squirrel fails after the windows are gone: quit now, and the way out is cleared
 r=rig();r.q.lastWindowClosed();r.q.failed();assert.deepEqual(r.quits,['quit']);assert.equal(r.timers[0].cleared,true);
 // Squirrel fails while the windows are still closing: quit as soon as the last one is gone
 r=rig();r.q.failed();assert.deepEqual(r.quits,[]);r.q.lastWindowClosed();assert.deepEqual(r.quits,['quit']);assert.equal(r.timers.length,0);
});

test('once the quit began, the last window closes without "Close Acira?", even with the setting on and several real tabs',async()=>{
 const clock={t:1000},asked=[];
 const controller={windowId:'main',privateMode:false,webApp:false,closing:false,window:{isDestroyed:()=>false,isFocused:()=>true},
  state:{settings:{askBeforeClosing:true},tabs:[{id:'t1',url:'acira://new'},{id:'t2',url:'acira://history'}]}, // the rig's profile: one real tab is enough
  unsavedTabs:async()=>[],approveLeave(){},commitAction(){},ask:async options=>{asked.push(options);return {response:1};}}; // 1 = Cancel
 const make=()=>createCloseGuard({getControllers:()=>[controller],say:key=>key,now:()=>clock.t});
 assert.equal(await make().confirmWindowClose(controller),false,'without the quit having begun (Install now before the fix) the last window asks, and Cancel keeps Acira open');
 assert.equal(asked.length,1);
 const guard=make();guard.noteQuit(); // what beginQuit does on before-quit-for-update
 assert.equal(await guard.confirmWindowClose(controller),true);assert.equal(asked.length,1,'not asked again');
 clock.t+=QUIT_WINDOW_MS+1;assert.equal(await guard.confirmWindowClose(controller),false,'the quit window is short: a later ordinary close asks again');
});
