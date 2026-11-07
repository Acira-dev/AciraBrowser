'use strict';
// Beta.11's updater inside createAppUpdater: which addresses it hands to electron-updater, how the testers opt-in is kept, the faster pickup (2 hours with
// jitter, a look on wake or focus, nextCheckSeconds) and the user agent. The fallback rules themselves are in update-feeds.test.cjs.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),{EventEmitter}=require('node:events');
const {createAppUpdater,CHECK_EVERY,CHECK_JITTER,CHECK_DELAY,NUDGE_QUIET,UPDATE_USER_AGENT}=require('../desktop/browser-services/app-updater.cjs');

const NEW='https://update.acirabrowser.com/',GITHUB='https://raw.githubusercontent.com/Acira-dev/AciraBrowserUpdates/main/feed/';
const MIN=60*1000;
const folder=()=>fs.mkdtempSync(path.join(os.tmpdir(),'acira-updater-pickup-'));
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const config=url=>`provider: "generic"\nurl: ${JSON.stringify(url)}\nupdaterCacheDirName: "acira-browser-updater"\n`;
/** A fake electron-updater: records setFeedURL; every check answers `reply` (an UpdateInfo-like object) or fails. */
function fake(reply){
  const updater=new EventEmitter();updater.feeds=[];updater.checks=0;
  updater.setFeedURL=options=>updater.feeds.push(options);
  updater.checkForUpdates=async()=>{
    updater.checks++;updater.emit('checking-for-update');
    if(!updater.reply)throw Object.assign(new Error('net::ERR_INTERNET_DISCONNECTED'),{});
    updater.emit('update-not-available',updater.reply);return null;
  };
  updater.reply=reply===undefined?{version:'0.1.0-beta.11'}:reply;updater.quitAndInstall=()=>{};
  return updater;
}
function timers(){
  const list=[];let next=1;
  return {list,schedule:(fn,delay)=>{const t={id:next++,fn,delay};list.push(t);return t.id;},cancel:id=>{const i=list.findIndex(t=>t.id===id);if(i>=0)list.splice(i,1);},
    last:()=>list.at(-1),fire(delay){const i=list.findIndex(t=>t.delay===delay);assert.ok(i>=0,'a timer waits '+delay+' ms: '+list.map(t=>t.delay));const [t]=list.splice(i,1);t.fn();}};
}
function make(extra={}){
  const dir=extra.dir||folder();
  const updater=createAppUpdater({app:{getVersion:()=>extra.version||'0.1.0-beta.11',isPackaged:true,getPath:()=>dir},dir,platform:extra.platform||'win32',env:{},uninstallerPresent:()=>true,qaBuild:false,every:()=>null,
    readConfig:()=>config(NEW),tidySession:()=>{},feedProvider:class Marker{},random:()=>0.5,...extra});
  return {updater,dir};
}

test('beta.11 hands electron-updater the new address first and the frozen GitHub feed second, and tells it what it already knows', async () => {
  const autoUpdater=fake(),{updater}=make({autoUpdater});
  await updater.check();
  assert.equal(autoUpdater.feeds.length,1);
  const [options]=autoUpdater.feeds;
  assert.equal(options.provider,'custom');assert.equal(typeof options.updateProvider,'function');
  assert.deepEqual(options.feeds,[{name:'primary',url:NEW},{name:'fallback',url:GITHUB}]);
  assert.equal(options.current,'0.1.0-beta.11');assert.equal(options.floor(),null,'nothing found yet: the floor is empty');
});

test('the floor is the update this computer already found or holds', async () => {
  const autoUpdater=fake({version:'0.1.0-beta.12',files:[]}),{updater}=make({autoUpdater});
  autoUpdater.checkForUpdates=async()=>{autoUpdater.emit('update-available',{version:'0.1.0-beta.12'});return null;};
  updater.setAutoDownload(false);await updater.check();
  assert.equal(autoUpdater.feeds[0].floor(),'0.1.0-beta.12');
});

test('Linux keeps its folder under both addresses; a build that names GitHub asks GitHub alone; a build with no app-update.yml keeps electron-updater\'s own default', async () => {
  const linux=fake(),a=make({autoUpdater:linux,platform:'linux',env:{APPIMAGE:'/x/Acira.AppImage'},readConfig:()=>config(NEW+'linux/')});
  await a.updater.check();assert.deepEqual(linux.feeds[0].feeds,[{name:'primary',url:NEW+'linux/'},{name:'fallback',url:GITHUB+'linux/'}]);
  const old=fake(),b=make({autoUpdater:old,readConfig:()=>config(GITHUB)});
  await b.updater.check();assert.deepEqual(old.feeds[0].feeds,[{name:'primary',url:GITHUB}]);
  const none=fake(),c=make({autoUpdater:none,readConfig:()=>{throw new Error('ENOENT');}});
  await c.updater.check();assert.deepEqual(none.feeds,[],'nothing to set: its own default stands');
});

test('the testers opt-in: updater.json "testersFeed": true points the build at the testers folder alone, survives every save, and has no switch in the app', async () => {
  const dir=folder();fs.writeFileSync(path.join(dir,'updater.json'),JSON.stringify({testersFeed:true,autoDownload:true,channel:'beta'}));
  const autoUpdater=fake(),{updater}=make({autoUpdater,dir});
  assert.equal(updater.status().testersFeed,true);
  await updater.check();assert.deepEqual(autoUpdater.feeds[0].feeds,[{name:'testers',url:NEW+'testers/'}]);
  updater.setAutoDownload(false);updater.setChannel('beta');
  const saved=JSON.parse(fs.readFileSync(path.join(dir,'updater.json'),'utf8'));
  assert.equal(saved.testersFeed,true,'a save keeps it (beta.10 would have dropped the key)');assert.equal(saved.autoDownload,false);
  const ordinary=make({autoUpdater:fake()});assert.equal(ordinary.updater.status().testersFeed,false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(ordinary.dir,'updater.json'),'utf8')).testersFeed,undefined,'an ordinary install never writes it');
  assert.equal(typeof updater.setTestersFeed,'undefined');
  const main=fs.readFileSync(path.join(__dirname,'..','desktop','main.cjs'),'utf8');
  assert.ok(!/testersFeed/.test(main),'main.cjs offers no way to set it');
});

test('test mode: a local feed, and a second one to rehearse the fallback; outside test mode the variables mean nothing', async () => {
  const a=fake(),m=make({autoUpdater:a,env:{ACIRA_UPDATE_TEST:'1',ACIRA_UPDATE_FEED:'http://127.0.0.1:8081/',ACIRA_UPDATE_FEED_FALLBACK:'http://127.0.0.1:8082/',ACIRA_UPDATE_TEST_PRIMARY_WITHIN_MS:'250'}});
  await m.updater.check();
  assert.deepEqual(a.feeds[0].feeds,[{name:'primary',url:'http://127.0.0.1:8081/'},{name:'fallback',url:'http://127.0.0.1:8082/'}]);assert.equal(a.feeds[0].primaryWithin,250);
  const b=fake(),n=make({autoUpdater:b,env:{ACIRA_UPDATE_FEED:'http://127.0.0.1:8081/',ACIRA_UPDATE_FEED_FALLBACK:'http://127.0.0.1:8082/'}});
  await n.updater.check();assert.deepEqual(b.feeds[0].feeds,[{name:'primary',url:NEW},{name:'fallback',url:GITHUB}],'a real run ignores them');assert.equal(b.feeds[0].primaryWithin,undefined);
});

test('the first look is 20 s after launch, then every 2 hours plus up to 10 minutes of jitter; a regular look re-arms itself', async () => {
  assert.equal(CHECK_EVERY,2*60*MIN);assert.equal(CHECK_JITTER,10*MIN);assert.equal(CHECK_DELAY,20*1000);
  const t=timers(),autoUpdater=fake(),{updater}=make({autoUpdater,schedule:t.schedule,cancel:t.cancel});
  updater.start();assert.deepEqual(t.list.map(x=>x.delay),[CHECK_DELAY]);
  t.fire(CHECK_DELAY);await settle();await settle();
  assert.equal(autoUpdater.checks,1);
  assert.deepEqual(t.list.map(x=>x.delay),[CHECK_EVERY+300000],'random()=0.5 gives half of the 10 minutes');
  t.fire(CHECK_EVERY+300000);await settle();await settle();
  assert.equal(autoUpdater.checks,2);assert.equal(t.list.length,1,'the next regular look is already waiting');
  // the jitter stays inside its bound whatever random says
  for (const [r,expected] of [[0,CHECK_EVERY],[0.999999,CHECK_EVERY+CHECK_JITTER-1]]) {
    const u=timers(),x=make({autoUpdater:fake(),schedule:u.schedule,cancel:u.cancel,random:()=>r});x.updater.start();u.fire(CHECK_DELAY);await settle();await settle();
    assert.ok(Math.abs(u.last().delay-expected)<=1,'random '+r+' -> '+u.last().delay);
  }
});

test('nextCheckSeconds: a document sets the pace between 10 minutes and 24 hours; absent or nonsense means the usual 2 hours', async () => {
  const cases=[[900,900*1000+90000],[5,10*MIN+60000],[86400*10,24*60*MIN+CHECK_JITTER/2],[undefined,CHECK_EVERY+300000],['soon',CHECK_EVERY+300000],[-30,CHECK_EVERY+300000],[0,CHECK_EVERY+300000]];
  for (const [hint,delay] of cases) {
    const t=timers(),autoUpdater=fake({version:'0.1.0-beta.11',...(hint===undefined?{}:{nextCheckSeconds:hint})}),{updater}=make({autoUpdater,schedule:t.schedule,cancel:t.cancel});
    updater.start();t.fire(CHECK_DELAY);await settle();await settle();
    assert.equal(t.list.length,1,'one regular look waits (the answer re-armed it)');assert.equal(t.last().delay,delay,'nextCheckSeconds '+hint);
  }
});

test('a look on wake or focus: only when the feed\'s last answer is older than 2 hours, never within 5 minutes of the last look, never while busy or before the first look', async () => {
  let clock=1e12;const t=timers(),autoUpdater=fake(),{updater}=make({autoUpdater,schedule:t.schedule,cancel:t.cancel,now:()=>clock});
  assert.equal(updater.nudge(),false,'not started');
  updater.start();assert.equal(updater.nudge(),false,'the first look (20 s after launch) has not happened: a focus at launch does not start one earlier');
  t.fire(CHECK_DELAY);await settle();await settle();assert.equal(autoUpdater.checks,1);
  clock+=CHECK_EVERY-MIN;assert.equal(updater.nudge(),false,'the answer is not 2 hours old');
  clock+=2*MIN;assert.equal(updater.nudge(),true,'now it is');await settle();await settle();assert.equal(autoUpdater.checks,2);
  assert.equal(updater.nudge(),false,'just looked');clock+=NUDGE_QUIET+1;assert.equal(updater.nudge(),false,'and the answer is fresh again');
  // a failing network does not turn every focus into a look
  autoUpdater.reply=null;clock+=CHECK_EVERY+1;assert.equal(updater.nudge(),true);await settle();await settle();assert.equal(updater.status().status,'error');
  clock+=1000;assert.equal(updater.nudge(),false,'within 5 minutes of the failed look');
  clock+=NUDGE_QUIET;autoUpdater.reply={version:'0.1.0-beta.11'};assert.equal(updater.nudge(),true,'later it looks again');await settle();await settle();assert.equal(updater.status().status,'current');
  // Squirrel.Mac holds a downloaded update: nothing looks again until it is installed
  const mac=make({autoUpdater:fake(),platform:'darwin',macAvailability:()=>null});mac.updater.start();assert.equal(mac.updater.nudge(),false);
});

test('main.cjs asks for a look when the computer wakes and when a window gets focus', () => {
  const main=fs.readFileSync(path.join(__dirname,'..','desktop','main.cjs'),'utf8');
  assert.match(main,/powerMonitor\.on\('resume',\(\)=>appUpdater\?\.nudge\(\)\)/);
  assert.match(main,/app\.on\('browser-window-focus',\(\)=>appUpdater\?\.nudge\(\)\)/);
});

test('update traffic says only "AciraUpdater": the session is told once, when the updater is set up', async () => {
  assert.equal(UPDATE_USER_AGENT,'AciraUpdater');
  let told=0;const {updater}=make({autoUpdater:fake(),tidySession:()=>{told++;}});
  await updater.check();await updater.check();assert.equal(told,1);
});

// --- the stand-in updater (rigs) follows the same rules with real HTTP ---
function feedServer(version,{status=200,body}={}){
  const server=http.createServer((req,res)=>{server.hits.push(req.url);res.statusCode=status;res.end(status===200?(body??JSON.stringify({version,files:[{url:'A.exe',sha512:'x',size:1}],releaseNotes:'- n'})):'no');});server.hits=[];
  return new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve({server,url:`http://127.0.0.1:${server.address().port}/`})));
}
const stubbed=(a,b,version='0.1.0-beta.11')=>{
  const dir=folder();
  const updater=createAppUpdater({app:{getVersion:()=>version,isPackaged:false,getPath:()=>dir},dir,env:{ACIRA_UPDATE_TEST:'1',ACIRA_UPDATE_STUB:'1',ACIRA_UPDATE_FEED:a,...(b?{ACIRA_UPDATE_FEED_FALLBACK:b}:{}),ACIRA_UPDATE_TEST_PRIMARY_WITHIN_MS:'400'},schedule:()=>null,every:()=>null,qaBuild:false,tidySession:()=>{}});
  updater.setAutoDownload(false);return updater;
};
test('rigs: the stand-in updater asks the first feed, goes to the second only when the first gives nothing usable, and ignores a second that is not newer', async () => {
  const dead=await feedServer('x',{status:503}),newer=await feedServer('0.1.0-beta.13'),same=await feedServer('0.1.0-beta.11'),good=await feedServer('0.1.0-beta.12');
  try {
    let updater=stubbed(good.url,newer.url);await updater.check();
    assert.equal(updater.status().available,'0.1.0-beta.12');assert.equal(newer.server.hits.length,0,'the fallback is not asked when the first answers');
    updater=stubbed(dead.url,newer.url);await updater.check();
    assert.equal(updater.status().available,'0.1.0-beta.13');assert.equal(updater.status().status,'available');assert.equal(newer.server.hits.length,1);
    updater=stubbed(dead.url,same.url);await updater.check();
    assert.equal(updater.status().status,'error','a fallback that is not newer is the same as being offline');assert.equal(updater.status().available,null);
    updater=stubbed(dead.url);await updater.check();assert.equal(updater.status().status,'error');
  } finally { for (const s of [dead,newer,same,good]) {s.server.closeAllConnections?.();s.server.close();} }
});
