'use strict';
// Updates that always get through (beta.14, item 14). Whatever a person does and whatever fails, the next try
// completes: a pause is not for good, a manual check breaks a stuck state, an Install now whose quit never came can be pressed again, a bad file is thrown
// away and not fetched for ever, a full disk or a portal page fails early with plain words, repeated trouble offers the download page, and installs that did
// not take change what is tried next. One test per row of the map; every feed is local (127.0.0.1) and every clock is the test's own.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),{createHash}=require('node:crypto'),{EventEmitter}=require('node:events');
const {createAppUpdater,kindOf,friendly,PAUSE_LASTS,DAMAGED_HOLD,STUCK_AFTER,INSTALL_WITHIN,DOWNLOAD_PAGE}=require('../desktop/browser-services/app-updater.cjs');

const sha512=buf=>createHash('sha512').update(buf).digest('base64');
const blob=(seed,length=400000)=>Buffer.from(Array.from({length},(_,i)=>(i*seed+(i>>8))&255));
const FILE=blob(3),NAME='AciraBrowserSetup-0.1.0-beta.14.exe';
const quiet={info(){},warn(){},error(){},debug(){}};
const until=async(what,ms=8000)=>{const end=Date.now()+ms;while(!what()){if(Date.now()>end)throw new Error('timed out waiting');await new Promise(resolve=>setTimeout(resolve,10));}};
const made=[];test.after(()=>{for(const root of made)fs.rmSync(root,{recursive:true,force:true});});
const tmp=()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'acira-update-recovery-'));made.push(root);return root;};

/** The feed and its file over HTTP. mode: 'good', 'corrupt' (the right size, other bytes), 'html' (a sign-in page with 200), 'slow' (pieces, for a pause), 'hang' (headers, then nothing). */
async function feedServer(version='0.1.0-beta.14'){
 const state={mode:'good',requests:[]},doc=()=>({version,releaseNotes:'- Safer updates',releaseDate:'2026-11-08T00:00:00.000Z',files:[{url:NAME,sha512:sha512(FILE),size:FILE.length}]});
 const server=http.createServer((req,res)=>{
  const name=decodeURIComponent(new URL(req.url,'http://x').pathname.slice(1));state.requests.push({name,range:req.headers.range||null});
  if(['beta.yml','latest.yml','beta-mac.yml','beta-linux.yml'].includes(name)){res.setHeader('content-type','text/yaml');return res.end(JSON.stringify(doc()));}
  if(name!==NAME){res.statusCode=404;return res.end();}
  if(state.mode==='silent')return; // the request is taken and never answered: not a header, not a byte (a host that times out)
  if(state.mode==='html'){res.writeHead(200,{'content-type':'text/html'});return res.end('<html>Sign in to the network</html>');}
  const match=/^bytes=(\d+)-$/.exec(req.headers.range||''),start=match?Number(match[1]):0;
  const bytes=state.mode==='corrupt'?Buffer.concat([Buffer.from([FILE[0]^255]),FILE.subarray(1)]):FILE;
  res.writeHead(match?206:200,{'content-length':bytes.length-start,etag:'"f"',...(match?{'content-range':`bytes ${start}-${bytes.length-1}/${bytes.length}`}:{})});
  if(state.mode==='hang'){res.write(bytes.subarray(start,start+1000));return;}
  if(state.mode!=='slow')return res.end(bytes.subarray(start));
  let at=start;const step=()=>{if(res.destroyed)return;const piece=bytes.subarray(at,at+25000);at+=piece.length;if(at>=bytes.length)return res.end(piece);res.write(piece);setTimeout(step,25);};step();
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 return Object.assign(state,{base:`http://127.0.0.1:${server.address().port}/`,files:()=>state.requests.filter(r=>r.name===NAME),close:()=>new Promise(resolve=>{server.closeAllConnections?.();server.close(resolve);})});
}
/** A small electron-updater: finds the feed's version, describes its files, has a download cache and takes a cached file. */
function liteUpdater(feed,{root}){
 const updater=new EventEmitter(),{DownloadedUpdateHelper}=require('electron-updater/out/DownloadedUpdateHelper'),helper=new DownloadedUpdateHelper(path.join(root,'cache'));
 updater.ownDownloads=0;updater.installs=[];
 updater.checkForUpdates=async()=>{
  updater.emit('checking-for-update');
  const doc=JSON.parse(await(await fetch(feed.base+'beta.yml')).text());
  updater.updateInfoAndProvider={info:doc,provider:{resolveFiles:info=>info.files.map(file=>({url:new URL(file.url,feed.base),info:file}))}};
  updater.emit('update-available',doc);
 };
 updater.getOrCreateDownloadHelper=async()=>helper;
 updater.downloadUpdate=async()=>{
  for(const file of updater.updateInfoAndProvider.info.files){const cached=await helper.getValidCachedUpdateFile({info:file},quiet);if(cached){updater.emit('update-downloaded',updater.updateInfoAndProvider.info);return [cached];}}
  updater.ownDownloads++;throw new Error('would download by itself');
 };
 updater.quitAndInstall=(...args)=>{updater.installs.push(args);};updater.setFeedURL=()=>{};
 return updater;
}
/** Timers and a clock the test owns: schedule collects, fire(delay) runs one, later(ms) moves the clock. */
function clock(){
 let at=1e12;const list=[];let next=1;
 return {now:()=>at,later:ms=>{at+=ms;},list,schedule:(fn,delay)=>{const t={id:next++,fn,delay};list.push(t);return t.id;},cancel:id=>{const i=list.findIndex(t=>t.id===id);if(i>=0)list.splice(i,1);},
  fire(match){const i=list.findIndex(t=>typeof match==='function'?match(t):t.delay===match);assert.ok(i>=0,'a timer is waiting');const [t]=list.splice(i,1);t.fn();return t;}};
}
const make=(root,autoUpdater,extra={})=>createAppUpdater({app:{getVersion:()=>extra.version||'0.1.0-beta.13',isPackaged:true,getPath:()=>root},dir:root,platform:'win32',env:{},autoUpdater,uninstallerPresent:()=>true,qaBuild:false,schedule:()=>null,every:()=>null,fetch,...extra});
const json=root=>JSON.parse(fs.readFileSync(path.join(root,'updater.json'),'utf8'));
const pendingOf=root=>path.join(root,'cache','pending');

test('1/5 a pause is not for good: a manual check resumes it, an automatic one leaves it, and a pause older than a week is dropped at the next start',async t=>{
 const feed=await feedServer(),root=tmp(),c=clock();t.after(feed.close);feed.mode='slow';
 let first,done=false;const paused=new Promise(resolve=>{first=make(root,liteUpdater(feed,{root}),{now:c.now,onChange:status=>{if(!done&&status.status==='downloading'&&status.transferred>=100000&&status.pausable){done=true;resolve(first.pause());}}});});
 await first.check();await paused;assert.equal(first.status().status,'paused');
 const asked=feed.requests.length;
 await first.check();assert.equal(first.status().status,'paused','an automatic check leaves a pause alone');assert.equal(feed.requests.length,asked,'and sends nothing');
 feed.mode='good';
 const after=await first.check({manual:true});
 assert.equal(after.status,'downloading','a person\'s own Check for updates resumes it');
 await until(()=>first.status().status==='ready');
 // a pause left for more than PAUSE_LASTS: the next start does not stay paused
 const second=tmp();feed.mode='slow';
 let again,done2=false;const stopped=new Promise(resolve=>{again=make(second,liteUpdater(feed,{root:second}),{now:c.now,onChange:status=>{if(!done2&&status.status==='downloading'&&status.transferred>=100000&&status.pausable){done2=true;resolve(again.pause());}}});});
 await again.check();await stopped;assert.equal(json(second).download.paused,true);assert.ok(json(second).download.pausedAt>0);
 feed.mode='good';c.later(PAUSE_LASTS-60000);
 assert.equal(make(second,liteUpdater(feed,{root:second}),{now:c.now}).status().status,'paused','six days and 23 hours: still the person\'s pause');
 c.later(120000);
 const relaunch=make(second,liteUpdater(feed,{root:second}),{now:c.now});
 assert.notEqual(relaunch.status().status,'paused','a week on, the pause is over');
 await relaunch.check();await until(()=>relaunch.status().status==='ready');
});

test('4 Later (a dismissed question) hides nothing: Install now still works and a newer version still replaces it',async t=>{
 const feed=await feedServer(),root=tmp();t.after(feed.close);
 const lite=liteUpdater(feed,{root}),updater=make(root,lite,{beforeInstall:async()=>{}});
 await updater.check();await until(()=>updater.status().status==='ready');
 assert.equal(updater.claimPrompt().claimed,true);assert.equal(updater.claimPrompt().claimed,false,'asked once');
 await updater.check();assert.equal(updater.status().status,'ready','a later look changes nothing on screen');
 await updater.install();assert.equal(lite.installs.length,1,'Later never took Install now away');
});

test('7 Install now whose quit never came: after a minute it can be pressed again, and the try is counted',async t=>{
 const feed=await feedServer(),root=tmp(),c=clock();t.after(feed.close);
 const lite=liteUpdater(feed,{root}),updater=make(root,lite,{now:c.now,guardSchedule:c.schedule,guardCancel:c.cancel,beforeInstall:async()=>{}});
 await updater.check();await until(()=>updater.status().status==='ready');
 await updater.install();assert.equal(lite.installs.length,1);
 assert.equal((await updater.install()).installing,true,'while it may still be quitting, a second press does nothing');assert.equal(lite.installs.length,1);
 c.fire(timer=>timer.delay===INSTALL_WITHIN);
 assert.equal(updater.status().status,'ready');assert.match(updater.status().error,/did not restart/);
 await updater.install();assert.equal(lite.installs.length,2,'pressed again: it reaches electron-updater again');
 assert.equal(json(root).attempt.n,2,'two tries recorded for this version');
});

test('41 stuck in "downloading" with no sign of life: after five minutes it starts again from a clean check, and a manual check breaks it sooner',async t=>{
 const feed=await feedServer(),root=tmp(),c=clock();t.after(feed.close);
 let calls=0,hang=true;const route=async()=>{calls++;if(calls>1&&hang)await new Promise(()=>{});}; // the look gets its route, the download's never comes
 const updater=make(root,liteUpdater(feed,{root}),{now:c.now,route,schedule:c.schedule,cancel:c.cancel,guardSchedule:c.schedule,guardCancel:c.cancel});
 await updater.check();assert.equal(updater.status().status,'downloading');
 c.later(STUCK_AFTER+1000);c.fire(timer=>timer.delay>=1000&&timer.delay<=STUCK_AFTER+1);
 assert.equal(updater.status().status,'error');assert.match(updater.status().error,/stopped without an answer/);
 hang=false;
 await updater.check();await until(()=>updater.status().status==='ready','the next check completes');
 // a manual check does not wait for the timer once the state has been quiet for 20 s
 const root2=tmp(),c2=clock();hang=true;calls=0;
 const second=make(root2,liteUpdater(feed,{root:root2}),{now:c2.now,route,schedule:c2.schedule,cancel:c2.cancel,guardSchedule:c2.schedule,guardCancel:c2.cancel});
 await second.check();assert.equal(second.status().status,'downloading');
 await second.check({manual:true});assert.equal(second.status().status,'downloading','at once: it has only just begun, so nothing is broken');
 c2.later(21000);hang=false;
 await second.check({manual:true});await until(()=>second.status().status==='ready');
});

test('17 a handed-over file that is damaged (right size, wrong bytes) is thrown away and Acira\'s own download takes over: electron-updater never downloads by itself',async t=>{
 const feed=await feedServer(),root=tmp();t.after(feed.close);
 const lite=liteUpdater(feed,{root}),pending=pendingOf(root);
 fs.mkdirSync(pending,{recursive:true});fs.writeFileSync(path.join(pending,NAME),Buffer.alloc(FILE.length,7));
 fs.writeFileSync(path.join(pending,'update-info.json'),JSON.stringify({fileName:NAME,sha512:sha512(FILE),isAdminRightsRequired:false}));
 const updater=make(root,lite);
 await updater.check();await until(()=>updater.status().status==='ready');
 assert.equal(lite.ownDownloads,0,'electron-updater did not download by itself');assert.equal(feed.files().length,1,'Acira fetched the file once, with its own download');
 assert.equal(sha512(fs.readFileSync(path.join(pending,NAME))),sha512(FILE),'and what is in the cache is the right file');
});

test('15/16 a file that fails its SHA-512 twice is held off for hours (no 200 MB every round), counts as trouble, and a fixed file is taken at once after the hold',async t=>{
 const feed=await feedServer(),root=tmp(),c=clock();t.after(feed.close);feed.mode='corrupt';
 const updater=make(root,liteUpdater(feed,{root}),{now:c.now,schedule:c.schedule,cancel:c.cancel,guardSchedule:c.schedule,guardCancel:c.cancel});
 await updater.check();await until(()=>updater.status().status==='error');
 assert.equal(feed.files().length,2,'once, and once more at once');
 assert.equal(updater.status().lastResort?.url,DOWNLOAD_PAGE,'two damaged downloads are enough for the download page');
 const seen=feed.files().length;
 await updater.check();assert.equal(feed.files().length,seen,'the next check fetches nothing');assert.match(updater.status().error,/downloaded twice/);
 feed.mode='good';c.later(DAMAGED_HOLD+60000);
 await updater.check();await until(()=>updater.status().status==='ready');
 assert.equal(updater.status().lastResort,null,'a success clears the download page');
});

test('22 a full disk fails before a byte is fetched, in plain words, and goes on when there is room',async t=>{
 const feed=await feedServer(),root=tmp();t.after(feed.close);
 let free=1000;const updater=make(root,liteUpdater(feed,{root}),{room:async()=>({bavail:free,bsize:1})});
 await updater.check();await until(()=>updater.status().status==='error');
 assert.match(updater.status().error,/not enough free space to download the update/);assert.equal(feed.files().length,0,'nothing was fetched');
 free=1e9;
 await updater.check();await until(()=>updater.status().status==='ready');
});

test('19 a sign-in page where the file should be is refused before a byte is kept; the next try completes',async t=>{
 const feed=await feedServer(),root=tmp();t.after(feed.close);feed.mode='html';
 const updater=make(root,liteUpdater(feed,{root}));
 await updater.check();await until(()=>updater.status().status==='error');
 assert.match(updater.status().error,/web page came back instead of the update/);
 const part=path.join(root,'cache','acira-partial','update.part');assert.equal(fs.existsSync(part)?fs.statSync(part).size:0,0,'nothing of the page was kept');
 feed.mode='good';await updater.check();await until(()=>updater.status().status==='ready');
});

test('27/29/30 errors a person can act on are told in plain words, and the proxy, clock and certificate kinds count as hard failures',()=>{
 const date=new Error('net::ERR_CERT_DATE_INVALID'),route=Object.assign(new Error('The connection settings are not confirmed yet'),{code:'ERR_UPDATE_ROUTE'});
 assert.equal(kindOf(date),'clock');assert.match(friendly(date),/date or time on this computer looks wrong/);
 assert.equal(kindOf(new Error('net::ERR_CERT_AUTHORITY_INVALID')),'tls');assert.equal(kindOf(new Error('net::ERR_PROXY_CONNECTION_FAILED')),'proxy');assert.equal(kindOf(new Error('net::ERR_TUNNEL_CONNECTION_FAILED')),'proxy');
 assert.equal(kindOf(route),'route');assert.match(friendly(route),/connection settings are not confirmed yet/);
 assert.equal(kindOf(new Error('net::ERR_INTERNET_DISCONNECTED')),'offline');assert.equal(kindOf(Object.assign(new Error('ENOSPC: no space left on device'),{code:'ENOSPC'})),'disk');
 assert.equal(kindOf(Object.assign(new Error('The update download failed (HTTP 404).'),{code:'ERR_UPDATE_HTTP'})),'missing');
 assert.equal(kindOf(Object.assign(new Error('The update download failed (HTTP 503).'),{code:'ERR_UPDATE_HTTP'})),'server');
 const feeds=Object.assign(new Error('net::ERR_CERT_DATE_INVALID (nothing newer was found on the older address either)'),{code:'ERR_UPDATE_FEEDS_UNAVAILABLE'});assert.equal(kindOf(feeds),'clock','both addresses failing for the clock is still the clock');
});

test('31 repeated trouble offers the download page: two hard failures or five in all, per platform and chip, gone with the first success',async t=>{
 const feed=await feedServer(),root=tmp(),c=clock();t.after(feed.close);
 const lite=liteUpdater(feed,{root});let broken=null;const original=lite.checkForUpdates;
 lite.checkForUpdates=async()=>{if(broken){lite.emit('checking-for-update');lite.emit('error',broken);throw broken;}return original();};
 const updater=make(root,lite,{now:c.now,schedule:c.schedule,cancel:c.cancel,guardSchedule:c.schedule,guardCancel:c.cancel});
 broken=new Error('net::ERR_INTERNET_DISCONNECTED');
 for(let i=0;i<4;i++){await updater.check();assert.equal(updater.status().lastResort,null,'offline four times: a bad connection, not a reason');}
 await updater.check();assert.deepEqual({...updater.status().lastResort,version:undefined},{url:DOWNLOAD_PAGE,platform:'windows',arch:'x64',version:undefined,kind:'offline'},'five in all');
 broken=null;await updater.check();await until(()=>updater.status().status==='ready');assert.equal(updater.status().lastResort,null);
 const root2=tmp(),second=make(root2,Object.assign(liteUpdater(feed,{root:root2}),{}),{now:c.now,schedule:c.schedule,cancel:c.cancel,guardSchedule:c.schedule,guardCancel:c.cancel,autoUpdater:undefined});
 const bad=liteUpdater(feed,{root:root2});bad.checkForUpdates=async()=>{bad.emit('checking-for-update');const error=Object.assign(new Error('The connection settings are not confirmed yet.'),{code:'ERR_UPDATE_ROUTE'});bad.emit('error',error);throw error;};
 const third=make(tmp(),bad,{now:c.now,schedule:c.schedule,cancel:c.cancel,guardSchedule:c.schedule,guardCancel:c.cancel});
 await third.check();assert.equal(third.status().lastResort,null);await third.check();assert.equal(third.status().lastResort?.kind,'route','a proxy that does not work: two failures');
 assert.ok(second);
});

test('35 an install that did not take: two misses drop the cached file and offer the download page, three switch the silent install at quit off; a new version starts clean',async t=>{
 const feed=await feedServer(),root=tmp();t.after(feed.close);
 const stale={autoDownload:true,channel:'beta',lastRunVersion:'0.1.0-beta.13',attempt:{from:'0.1.0-beta.13',to:'0.1.0-beta.14',n:1}};
 const open=(attempt,extra={})=>{fs.writeFileSync(path.join(root,'updater.json'),JSON.stringify({...stale,attempt}));return make(root,Object.assign(liteUpdater(feed,{root}),extra));};
 const one=open({from:'0.1.0-beta.13',to:'0.1.0-beta.14',n:1});assert.equal(one.status().lastResort,null,'one miss is not yet a reason');
 // two misses: the cached copy is cleared before the file is looked at again, so a fresh one comes
 const pending=pendingOf(root);fs.mkdirSync(pending,{recursive:true});fs.writeFileSync(path.join(pending,NAME),FILE);fs.writeFileSync(path.join(pending,'update-info.json'),JSON.stringify({fileName:NAME,sha512:sha512(FILE)}));
 const two=open({from:'0.1.0-beta.13',to:'0.1.0-beta.14',n:2});assert.equal(two.status().lastResort?.kind,'install');
 await two.check();await until(()=>two.status().status==='ready');assert.equal(feed.files().length,1,'the cached copy was not trusted: Acira fetched a fresh one');
 assert.equal(two.status().lastResort?.kind,'install','a success of the download does not hide it: the install is what keeps failing');
 // three: the quit no longer installs by itself
 const lite=Object.assign(liteUpdater(feed,{root}),{autoInstallOnAppQuit:true});fs.writeFileSync(path.join(root,'updater.json'),JSON.stringify({...stale,attempt:{from:'0.1.0-beta.13',to:'0.1.0-beta.14',n:3}}));
 const three=make(root,lite);const before=feed.files().length;await three.check();await until(()=>three.status().status==='ready');assert.equal(lite.autoInstallOnAppQuit,false,'Install now stays; the silent install at quit is off');assert.equal(three.status().lastResort?.kind,'install');assert.equal(feed.files().length,before,'and the file is not fetched again at every launch');
 // a launch on the new version (it took) or on another one forgets all of it
 fs.writeFileSync(path.join(root,'updater.json'),JSON.stringify({...stale,attempt:{from:'0.1.0-beta.13',to:'0.1.0-beta.14',n:3}}));
 const took=make(root,liteUpdater(feed,{root}),{version:'0.1.0-beta.14'});assert.equal(took.status().lastResort,null);assert.equal(json(root).attempt,undefined);
});

test('23 updater.json is written whole or not at all: no side file is left and the pause survives',async t=>{
 const feed=await feedServer(),root=tmp();t.after(feed.close);feed.mode='slow';
 let u;const paused=new Promise(resolve=>{u=make(root,liteUpdater(feed,{root}),{onChange:status=>{if(status.status==='downloading'&&status.transferred>=100000&&status.pausable)resolve(u.pause());}});});
 await u.check();await paused;
 assert.deepEqual(fs.readdirSync(root).filter(name=>name.includes('.tmp')),[],'the temporary file was renamed into place');
 assert.equal(json(root).download.paused,true);
});

test('32/33/34 a copy that cannot update itself (a Mac run from a disk image, a Windows portable copy, a Linux AppImage in a read-only folder) still learns of the new version and gets the download page; it never downloads or installs',async t=>{
 const feed=await feedServer();t.after(feed.close);
 const never=new EventEmitter();never.checkForUpdates=never.downloadUpdate=never.quitAndInstall=()=>{throw new Error('an updater that cannot update must not be used');};never.setFeedURL=()=>{};
 const cases=[
  {platform:'darwin',extra:{macAvailability:()=>'Install the distribution build in a writable Applications folder before using automatic updates.',macArm64:()=>true},want:{platform:'mac',arch:'arm64'}},
  {platform:'win32',extra:{uninstallerPresent:()=>false},want:{platform:'windows',arch:'x64'}},
  {platform:'linux',extra:{env:{APPIMAGE:'/readonly-folder/Acira.AppImage'},appImageCheck:()=>'Move the Acira AppImage to a folder you can write to to use automatic updates.'},want:{platform:'linux',arch:null}},
 ];
 for(const {platform,extra,want} of cases){
  const root=tmp(),updater=make(root,never,{platform,readConfig:()=>'url: '+feed.base+'\n',...extra});
  assert.equal(updater.status().status,'unsupported');assert.equal(updater.status().supported,false);assert.equal(updater.status().lastResort,null,platform+': nothing to say before it has looked');
  const seen=feed.files().length;
  const after=await updater.check();
  assert.equal(after.status,'unsupported','the status stays what it was: this copy cannot update itself');assert.equal(after.available,'0.1.0-beta.14');
  assert.deepEqual({platform:after.lastResort.platform,arch:after.lastResort.arch,url:after.lastResort.url,version:after.lastResort.version,kind:after.lastResort.kind},{...want,url:DOWNLOAD_PAGE,version:'0.1.0-beta.14',kind:'unsupported'},platform);
  assert.equal(feed.files().length,seen,platform+': not a byte of the update was fetched');
 }
 // a development run, a QA build, a test profile and a bundle whose signature cannot be verified stay silent
 for(const extra of [{app:{getVersion:()=>'0.1.0-beta.13',isPackaged:false,getPath:()=>os.tmpdir()}},{qaBuild:true},{env:{ACIRA_BROWSER_TEST_DATA:'/tmp/x'}},{macAvailability:()=>'The installed application signature could not be verified.'}]){
  const before=feed.requests.length,updater=make(tmp(),never,{platform:'darwin',macAvailability:()=>'Install the distribution build in a writable Applications folder before using automatic updates.',readConfig:()=>'url: '+feed.base+'\n',...extra});
  await updater.check();assert.equal(feed.requests.length,before,'silent');
 }
});

test('36 the same file failing twice at electron-updater / Squirrel.Mac: its cached copy goes, and the next try fetches a fresh one',async t=>{
 const feed=await feedServer(),root=tmp();t.after(feed.close);
 const lite=liteUpdater(feed,{root}),original=lite.downloadUpdate;let refuse=true;
 lite.downloadUpdate=async()=>{if(refuse)throw new Error('Squirrel.Mac could not stage the update');return original();};
 const updater=make(root,lite),pending=path.join(pendingOf(root),'update-info.json');
 await updater.check();await until(()=>updater.status().status==='error');assert.equal(fs.existsSync(pending),true,'one failure: the file stays (it was whole)');assert.equal(feed.files().length,1);
 await updater.check();await until(()=>feed.files().length>=1&&updater.status().status==='error');assert.equal(fs.existsSync(pending),false,'the same file failing again: its cached copy is gone');assert.equal(feed.files().length,1,'(it was not fetched again for this check: it was already whole)');
 refuse=false;await updater.check();await until(()=>updater.status().status==='ready');assert.equal(feed.files().length,2,'the next try fetched a fresh copy');
});

test('a stopped download says so: status.interrupted with its version and bytes, retry {failures, at} and cause (so the pill can stay and say "trying again")',async t=>{
 const feed=await feedServer(),root=tmp(),c=clock();t.after(feed.close);feed.mode='hang';
 const updater=make(root,liteUpdater(feed,{root}),{now:c.now,schedule:c.schedule,cancel:c.cancel,guardSchedule:c.schedule,guardCancel:c.cancel,stall:80});
 await updater.check();await until(()=>updater.status().status==='error',10000);
 const stopped=updater.status();
 assert.equal(stopped.interrupted,true);assert.equal(stopped.available,'0.1.0-beta.14');assert.ok(stopped.total>0&&stopped.transferred>=0);
 assert.deepEqual(stopped.retry,{failures:1,at:c.now()+2*60*1000},'the first rung of the ladder: 2 minutes');assert.equal(stopped.cause,'network');assert.equal(stopped.lastResort,null);
 feed.mode='good';c.fire(2*60*1000);await until(()=>updater.status().status==='ready');
 assert.equal(updater.status().interrupted,false);assert.deepEqual(updater.status().retry,{failures:0,at:null});assert.equal(updater.status().cause,null);
});

test('a download that got no byte at all (GitHub timing out, 8 Nov) is still a download that stopped: interrupted, with its retry time',async t=>{
 const feed=await feedServer(),root=tmp(),c=clock();t.after(feed.close);feed.mode='silent';
 const updater=make(root,liteUpdater(feed,{root}),{now:c.now,schedule:c.schedule,cancel:c.cancel,guardSchedule:c.schedule,guardCancel:c.cancel,stall:80});
 await updater.check();await until(()=>updater.status().status==='error',10000);
 const stopped=updater.status();
 assert.equal(stopped.transferred,0,'not a byte arrived');assert.equal(stopped.interrupted,true);assert.equal(stopped.cause,'network');assert.equal(stopped.retry.at,c.now()+2*60*1000);
 feed.mode='good';c.fire(2*60*1000);await until(()=>updater.status().status==='ready');assert.equal(updater.status().interrupted,false);
});

test('status.cause: the connection, a file that did not pass its check, anything else',async t=>{
 const feed=await feedServer(),root=tmp();t.after(feed.close);
 const causeAfter=async(mode,extra={})=>{const own=tmp(),updater=make(own,liteUpdater(feed,{root:own}),{stall:80,...extra});feed.mode=mode;await updater.check();await until(()=>updater.status().status==='error',10000);return updater.status();};
 assert.equal((await causeAfter('hang')).cause,'network','a download that went quiet');
 assert.equal((await causeAfter('html')).cause,'network','a sign-in page where the file should be');
 const damaged=await causeAfter('corrupt');assert.equal(damaged.cause,'file','a file that failed its SHA-512 twice');
 assert.equal((await causeAfter('good',{room:async()=>({bavail:1,bsize:1})})).cause,'other','a full disk');
});

test('10 the interface never decides: no listener, or one that throws, stops nothing',async t=>{
 const feed=await feedServer(),root=tmp();t.after(feed.close);
 const lite=liteUpdater(feed,{root}),updater=make(root,lite,{onChange:()=>{throw new Error('the window is gone');},beforeInstall:async()=>{}});
 await updater.check();await until(()=>updater.status().status==='ready');await updater.install();assert.equal(lite.installs.length,1);
});

test('main passes a person\'s check as a manual one, and the route\'s refusal carries its code',()=>{
 const main=fs.readFileSync(path.join(__dirname,'../desktop/main.cjs'),'utf8'),route=fs.readFileSync(path.join(__dirname,'../desktop/browser-services/update-route.cjs'),'utf8');
 assert.match(main,/request\.type==='update\.check'\?appUpdater\.check\(\{manual:true\}\)/);
 assert.equal((route.match(/code:'ERR_UPDATE_ROUTE'/g)||[]).length,2);
});
