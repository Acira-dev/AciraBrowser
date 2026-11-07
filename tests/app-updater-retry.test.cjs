'use strict';
// After an offline start the updater used to wait 8 hours for its next look (hunt-stability #5). A failed check or download now tries again 2, 10 and
// 30 minutes later, then on the 2-hour round; waking the Mac or the network coming back tries at once. The status shows nothing new.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{EventEmitter}=require('node:events');
const {createAppUpdater,CHECK_EVERY}=require('../desktop/browser-services/app-updater.cjs');
const {createNetworkWatch}=require('../desktop/browser-services/network-retry.cjs');
const MIN=60*1000;
const folder=()=>fs.mkdtempSync(path.join(os.tmpdir(),'acira-updater-retry-'));
function timers(){
 const list=[];let next=1;
 return {list,schedule:(fn,delay)=>{const t={id:next++,fn,delay};list.push(t);return t.id;},cancel:id=>{const i=list.findIndex(t=>t.id===id);if(i>=0)list.splice(i,1);},
  fire(delay){const i=list.findIndex(t=>t.delay===delay);assert.ok(i>=0,'a retry is waiting '+delay+' ms');const [t]=list.splice(i,1);t.fn();}};
}
// online decides whether a check works; `download` whether the download after it does (electron-updater: 'error' event and a rejected check)
function feed(net){
 const updater=new EventEmitter();updater.checks=0;
 updater.checkForUpdates=async()=>{
  updater.checks++;updater.emit('checking-for-update');
  if(!net.online){const error=new Error('net::ERR_INTERNET_DISCONNECTED');updater.emit('error',error);throw error;}
  if(!net.update){updater.emit('update-not-available',{});return null;}
  updater.emit('update-available',{version:'1.1.0'});
  if(net.download===false){updater.emit('error',new Error('net::ERR_CONNECTION_RESET'));return null;}
  updater.emit('update-downloaded',{version:'1.1.0',releaseNotes:''});return null;
 };
 updater.quitAndInstall=()=>{};updater.setFeedURL=()=>{};
 return updater;
}
const make=(extra)=>createAppUpdater({app:{getVersion:()=>'1.0.0',isPackaged:true,getPath:()=>os.tmpdir()},dir:folder(),platform:'win32',env:{},uninstallerPresent:()=>true,qaBuild:false,every:()=>null,...extra});
const settle=()=>new Promise(resolve=>setImmediate(resolve));

test('offline at start: tried again at 2, 10 and 30 minutes, then left to the regular round',async()=>{
 const net={online:false},t=timers(),autoUpdater=feed(net),changes=[];
 const updater=make({autoUpdater,schedule:t.schedule,cancel:t.cancel,onChange:s=>changes.push(s.status)});
 await updater.check();
 assert.equal(updater.status().status,'error');assert.equal(autoUpdater.checks,1);
 assert.deepEqual(t.list.map(x=>x.delay),[2*MIN],'one failure (an error event and a rejected check) is one rung');
 for(const delay of [2*MIN,10*MIN,30*MIN]){t.fire(delay);await settle();}
 assert.equal(autoUpdater.checks,4);assert.deepEqual(t.list,[],'after the ladder only the regular round is left');
 assert.equal(CHECK_EVERY,2*60*MIN);
 assert.ok(changes.every(s=>['checking','error'].includes(s)),'nothing new is shown: checking and error, as before');
});

test('back online before the next rung: the retry finds the update and the ladder ends',async()=>{
 const net={online:false,update:true},t=timers(),autoUpdater=feed(net);
 const updater=make({autoUpdater,schedule:t.schedule,cancel:t.cancel});
 await updater.check();net.online=true;t.fire(2*MIN);await settle();
 assert.equal(updater.status().status,'ready');assert.equal(updater.status().available,'1.1.0');assert.deepEqual(t.list,[]);
});

test('the network coming back or the Mac waking checks at once instead of waiting for the rung',async()=>{
 const net={online:false},t=timers(),power=new EventEmitter();let online=false,tick=null;
 const network=createNetworkWatch({powerMonitor:power,net:{isOnline:()=>online},every:fn=>{tick=fn;return {unref(){}};},stop:()=>{tick=null;}});
 let clock=1e12;const autoUpdater=feed(net),updater=make({autoUpdater,schedule:t.schedule,cancel:t.cancel,network,now:()=>clock});
 await updater.check();assert.equal(autoUpdater.checks,1);
 tick();assert.equal(autoUpdater.checks,1,'still offline');
 online=true;net.online=true;tick();await settle();
 assert.equal(autoUpdater.checks,2);assert.equal(updater.status().status,'current');assert.deepEqual(t.list,[],'the pending rung was replaced');
 // a later failure, then a wake
 net.online=false;await updater.check();assert.equal(updater.status().status,'error');
 clock+=60*1000;net.online=true;power.emit('resume');await settle();assert.equal(autoUpdater.checks,4);assert.equal(updater.status().status,'current');
 network.dispose();
});

test('a download that keeps failing climbs the ladder instead of restarting it on every "update available"',async()=>{
 const net={online:true,update:true,download:false},t=timers(),autoUpdater=feed(net);
 const updater=make({autoUpdater,schedule:t.schedule,cancel:t.cancel});
 await updater.check();assert.equal(updater.status().status,'error');assert.deepEqual(t.list.map(x=>x.delay),[2*MIN]);
 t.fire(2*MIN);await settle();assert.deepEqual(t.list.map(x=>x.delay),[10*MIN]);
 net.download=true;t.fire(10*MIN);await settle();
 assert.equal(updater.status().status,'ready');assert.deepEqual(t.list,[]);
});

test('a build that cannot update never schedules a retry',async()=>{
 const t=timers(),updater=createAppUpdater({app:{getVersion:()=>'1.0.0',isPackaged:false,getPath:()=>os.tmpdir()},dir:folder(),env:{},schedule:t.schedule,cancel:t.cancel,every:()=>null,qaBuild:false});
 await updater.check();assert.equal(updater.status().supported,false);assert.deepEqual(t.list,[]);
});

test('main hands the updater the shared wake and network watch',()=>{
 const main=fs.readFileSync(path.join(__dirname,'../desktop/main.cjs'),'utf8');
 assert.match(main,/createAppUpdater\(\{app,network:networkWatch\(\),/);
 assert.match(main,/createNetworkWatch\(\{powerMonitor:require\('electron'\)\.powerMonitor,net:require\('electron'\)\.net\}\)/);
});
