'use strict';
// Updater safety (beta.10). What the person is offered must match what will install, whatever the feed does next:
//   - a downloaded update stays offered through the next check (the same version again, no news, offline), and a newer one replaces it only once it is
//     whole: a newer download that fails goes back to the one that waits. On Windows a check while "ready" no longer flickers (downloading -> ready, or
//     back to "available" with automatic download off);
//   - a build pulled from the feed (a halt: stagingPercentage 0, a rollback, or this install no longer in the rollout) is not installed: not on Install
//     now (Windows asks the feed first), not when Acira quits, and not handed over at all when the feed is asked again at the end of a long download;
//   - a staged rollout (stagingPercentage) is decided by electron-updater's own check, and Acira's download follows it (the real NsisUpdater and MacUpdater);
//   - Install now works again after electron-updater could not start the installer;
//   - a download that goes quiet does not hang: Acira's own resumes at once from the byte it had; electron-updater's own (the fallback) is given up;
//   - the check and the download leave by the profile's route (route), and an unconfirmed route sends nothing.
// The co-founder's line fixed most of these on the old design (a9f51eb9, d824abac, 36f2c825, 406fa2a1, 0a2e4407); this is the same intent on Acira's own
// resumable download. Every feed here is local (127.0.0.1).
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),{createHash}=require('node:crypto'),{EventEmitter}=require('node:events');
const {createAppUpdater,READY_RECHECK}=require('../desktop/browser-services/app-updater.cjs');

const sha512=buf=>createHash('sha512').update(buf).digest('base64');
const blob=(seed,length=300000)=>Buffer.from(Array.from({length},(_,i)=>(i*seed+(i>>8))&255));
const until=async(what,ms=8000)=>{const end=Date.now()+ms;while(!what()){if(Date.now()>end)throw new Error('timed out waiting');await new Promise(resolve=>setTimeout(resolve,10));}};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const made=[];test.after(()=>{for(const root of made)fs.rmSync(root,{recursive:true,force:true});});
const tmp=()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'acira-update-safety-'));made.push(root);return root;};

/** A release feed like Acira's on GitHub: beta.yml (Windows) and beta-mac.yml name the version's files in its own release folder. Between checks the test
 *  can move the version (a newer build, a rollback), set stagingPercentage (a staged rollout; 0 is a halt), take the host offline, make it hang, refuse a
 *  file (503), or let a file go quiet part-way (the connection stays open and sends nothing more). Range is honoured; every request is counted. */
async function releaseFeed({version='0.1.0-beta.9',slow=false}={}){
 const feed={version,staging:undefined,offline:false,hang:false,bare:new Set(),fail:new Set(),quiet:null,requests:[],held:[]},builds=new Map();
 const build=v=>{if(!builds.has(v)){const seed=builds.size*2+3;builds.set(v,{exe:blob(seed),arm:blob(seed+20),x64:blob(seed+40)});}return builds.get(v);};
 const fileOf=name=>{const m=/^v([^/]+)\/(.+)$/.exec(name);if(!m)return null;const b=build(m[1]);return m[2]==='AciraBrowserSetup.exe'?b.exe:m[2]===`Acira-${m[1]}-arm64-mac.zip`?b.arm:m[2]===`Acira-${m[1]}-mac.zip`?b.x64:null;};
 const doc=mac=>{const v=feed.version,b=build(v),hash=buf=>({sha512:sha512(buf),...(feed.bare.has(v)?{}:{size:buf.length})});return {version:v,releaseDate:'2026-11-03T00:00:00.000Z',releaseNotes:`Notes for ${v}`,
  files:mac?[{url:`v${v}/Acira-${v}-arm64-mac.zip`,...hash(b.arm)},{url:`v${v}/Acira-${v}-mac.zip`,...hash(b.x64)}]:[{url:`v${v}/AciraBrowserSetup.exe`,...hash(b.exe)}],
  ...(feed.staging===undefined?{}:{stagingPercentage:feed.staging})};};
 const server=http.createServer((req,res)=>{
  const name=decodeURIComponent(new URL(req.url,'http://x').pathname.slice(1));feed.requests.push({name,range:req.headers.range||null});
  if(feed.offline)return req.socket.destroy();
  if(name==='beta.yml'||name==='beta-mac.yml'){if(feed.hang)return feed.held.push({res,mac:name==='beta-mac.yml'});res.setHeader('content-type','text/yaml');return res.end(JSON.stringify(doc(name==='beta-mac.yml')));}
  const file=fileOf(name);
  if(!file){res.statusCode=404;return res.end();}
  if(feed.fail.has(name)){res.statusCode=503;return res.end();}
  const match=/^bytes=(\d+)-$/.exec(req.headers.range||''),start=match?Number(match[1]):0;
  res.writeHead(match?206:200,{'content-length':file.length-start,etag:'"e1"','accept-ranges':'bytes',...(match?{'content-range':`bytes ${start}-${file.length-1}/${file.length}`}:{})});
  const quiet=feed.quiet?.name===name&&!feed.quiet.used?feed.quiet:null;if(quiet)quiet.used=true;
  let at=start;const step=()=>{
   if(res.destroyed)return;
   const piece=file.subarray(at,at+(slow?30000:file.length));
   if(quiet&&at+piece.length>=quiet.after){res.write(file.subarray(at,quiet.after));return;} // goes quiet: open, silent
   at+=piece.length;if(at>=file.length)return res.end(piece);res.write(piece);setTimeout(step,slow?50:0);
  };step();
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 return Object.assign(feed,{base:`http://127.0.0.1:${server.address().port}/`,build,
  answer:()=>{for(const held of feed.held.splice(0))held.res.end(JSON.stringify(doc(held.mac)));}, // a hung look answers late
  drop:()=>{for(const held of feed.held.splice(0))held.res.socket?.destroy();}, // a hung look fails late (socket hang up)
  setups:v=>feed.requests.filter(r=>r.name===`v${v}/AciraBrowserSetup.exe`).map(r=>r.range),
  looks:()=>feed.requests.filter(r=>r.name.endsWith('.yml')).length,
  close:()=>new Promise(resolve=>{server.closeAllConnections?.();server.close(resolve);})});
}
/** electron-updater's HTTP for Node (as electron-builder's own NodeHttpExecutor), so the real updaters' checks reach the local feed. */
function nodeExecutor(){const {HttpExecutor}=require('builder-util-runtime');return new (class extends HttpExecutor{createRequest(options,callback){return http.request(options,callback);}async download(url,destination){const response=await fetch(url.href);if(!response.ok)throw new Error('HTTP '+response.status);fs.writeFileSync(destination,Buffer.from(await response.arrayBuffer()));return destination;}})();}
function appAdapter(root,feed,quits,version){
 const config=path.join(root,'app-update.yml');fs.writeFileSync(config,`provider: generic\nurl: ${feed.base}\nupdaterCacheDirName: acira-browser-updater\n`);
 return {version,name:'Acira Browser',isPackaged:true,appUpdateConfigPath:config,userDataPath:root,baseCachePath:path.join(root,'Caches'),whenReady:()=>Promise.resolve(),quit(){},relaunch(){},onQuit(handler){quits.push(handler);}};
}
/** The real NsisUpdater. The installer it would start is recorded instead (spawnLog): the quit handler and Install now both end there. */
function realNsis(feed,root,{version='0.1.0-beta.8',quits=[]}={}){
 const {NsisUpdater}=require('electron-updater/out/NsisUpdater');
 const nsis=new NsisUpdater(null,appAdapter(root,feed,quits,version));
 nsis.httpExecutor=nodeExecutor();nsis._testOnlyOptions={platform:'win32'};nsis.logger=null;
 nsis.started=[];nsis.spawnLog=async(file,args)=>{nsis.started.push({file:path.basename(path.dirname(file))+'/'+path.basename(file),sha512:sha512(fs.readFileSync(file)),args});return true;};
 nsis.quits=quits;nsis.quitOnce=()=>{for(const handler of quits)handler(0);};
 return nsis;
}
/** The real MacUpdater, with Squirrel.Mac stood in for: it fetches the update from MacUpdater's local proxy the way Squirrel does. */
function realMac(t,feed,root,{version='0.1.0-beta.8'}={}){
 const native=new EventEmitter();native.got=[];native.restarts=0;
 native.setFeedURL=options=>{native.feed=options;};native.quitAndInstall=()=>{native.restarts++;};
 native.checkForUpdates=()=>{(async()=>{const answer=await(await fetch(native.feed.url,{headers:native.feed.headers})).json();const zip=Buffer.from(await(await fetch(answer.url)).arrayBuffer());native.got.push(sha512(zip));native.emit('update-downloaded');})().catch(()=>{native.failed=true;/* a test that ended closed the feed */});};
 const electronId=require.resolve('electron'),saved=require.cache[electronId];
 require.cache[electronId]={id:electronId,filename:electronId,loaded:true,exports:{autoUpdater:native}};
 t.after(()=>{if(saved)require.cache[electronId]=saved;else delete require.cache[electronId];});
 const {MacUpdater}=require('electron-updater/out/MacUpdater'),mac=new MacUpdater(null,appAdapter(root,feed,[],version));
 mac.httpExecutor=nodeExecutor();mac._testOnlyOptions={platform:'darwin'};mac.logger=null;t.after(()=>mac.closeServerIfExists());
 mac.native=native;return mac;
}
const make=(root,autoUpdater,extra={})=>createAppUpdater({app:{getVersion:()=>extra.version||'0.1.0-beta.8',isPackaged:true,getPath:()=>root},dir:root,platform:'win32',env:{},autoUpdater,uninstallerPresent:()=>true,qaBuild:false,macAvailability:()=>null,schedule:()=>null,every:()=>null,fetch,...extra});
const readyWith=async(updater,version)=>{await until(()=>updater.status().status==='ready'&&updater.status().available===version);};
const saved=root=>JSON.parse(fs.readFileSync(path.join(root,'updater.json'),'utf8'));
const pending=root=>{try{return fs.readdirSync(path.join(root,'Caches','acira-browser-updater','pending'));}catch{return [];}};
/** A staging id (electron-updater's .updaterId) whose place in the rollout is below (inside) or above (outside) the given share. */
function stagingId(inside,share){
 const {UUID}=require('builder-util-runtime');
 for(let i=0;;i++){const id=UUID.v5('acira-'+i,UUID.OID),place=UUID.parse(id).readUInt32BE(12)/0xffffffff;if(inside?place<share-.05:place>share+.05)return id;}
}

// --- A downloaded update stays offered ------------------------------------------------------------------------------------------------------------
for(const autoDownload of [true,false])test(`Windows: a check while an update is ready leaves it ready, with no flicker and nothing fetched (automatic download ${autoDownload?'on':'off'})`,async t=>{
 const feed=await releaseFeed(),root=tmp();t.after(feed.close);
 const nsis=realNsis(feed,root),seen=[],updater=make(root,nsis,{onChange:status=>seen.push(status.status)});
 if(!autoDownload){updater.setAutoDownload(false);await updater.check();await until(()=>updater.status().status==='available');await updater.download();}
 else await updater.check();
 await readyWith(updater,'0.1.0-beta.9');
 seen.length=0;const asked=feed.looks();
 await updater.check();await pause(120);
 assert.equal(feed.looks(),asked+1,'it did look');
 assert.deepEqual([...new Set(seen)].filter(s=>s!=='ready'),[],'no "checking", "downloading" or "available" while the same update waits');
 assert.equal(updater.status().status,'ready');assert.equal(updater.status().available,'0.1.0-beta.9');
 assert.deepEqual(feed.setups('0.1.0-beta.9'),[null],'downloaded once');
});

test('a downloaded update stays offered when the next check fails (offline), and Install now still installs it',async t=>{
 const feed=await releaseFeed(),root=tmp();t.after(feed.close);
 const nsis=realNsis(feed,root),updater=make(root,nsis,{askWithin:2000});
 await updater.check();await readyWith(updater,'0.1.0-beta.9');
 feed.offline=true;
 await updater.check();await pause(50);
 assert.equal(updater.status().status,'ready','the pill, the menu row and Install now stay');assert.equal(updater.status().error,null);
 const installs=[];nsis.quitAndInstall=(...args)=>installs.push(args);
 await updater.install();
 assert.deepEqual(installs,[[true,true]],'offline at Install now: it installs (the person is never kept on the old version by their network)');
});

test('a newer update whose download fails goes back to the one that waits, which still installs on Install now and on quit',async t=>{
 const feed=await releaseFeed(),root=tmp();t.after(feed.close);
 const nsis=realNsis(feed,root),updater=make(root,nsis);
 await updater.check();await readyWith(updater,'0.1.0-beta.9');
 feed.version='0.1.0-beta.10';feed.fail.add('v0.1.0-beta.10/AciraBrowserSetup.exe');
 await updater.check();
 await until(()=>feed.setups('0.1.0-beta.10').length>0);
 await readyWith(updater,'0.1.0-beta.9');
 assert.equal(updater.status().error,null);assert.equal(updater.status().progress,100);assert.match(updater.status().notes,/Notes for 0\.1\.0-beta\.9/,'its own notes again');
 nsis.quitOnce();
 assert.equal(nsis.started.length,1,'Acira quitting installs the update that was whole');assert.equal(nsis.started[0].sha512,sha512(feed.build('0.1.0-beta.9').exe));
});

// --- A pulled build is not installed --------------------------------------------------------------------------------------------------------------
test('Windows: a build halted after it was downloaded is not installed, not when Acira quits and not on Install now, and its notes go',async t=>{
 const feed=await releaseFeed(),root=tmp();t.after(feed.close);
 const nsis=realNsis(feed,root),updater=make(root,nsis);
 await updater.check();await readyWith(updater,'0.1.0-beta.9');
 assert.equal(saved(root).pending.version,'0.1.0-beta.9');
 feed.staging=0; // the publisher's halt
 await updater.check();
 await until(()=>updater.status().status==='current');
 await pause(50);
 nsis.quitOnce();
 assert.deepEqual(nsis.started,[],'quitting Acira does not run the pulled setup');
 assert.equal(nsis.autoInstallOnAppQuit,false);
 assert.deepEqual(pending(root),[],'electron-updater\'s copy of the pulled setup is gone');
 assert.equal(saved(root).pending,undefined,'and its notes are not shown after a restart');
 await assert.rejects(updater.install(),/No downloaded update/);
 // the halt is lifted: it downloads again, and installs on quit again
 feed.staging=undefined;
 await updater.check();await readyWith(updater,'0.1.0-beta.9');
 assert.equal(nsis.autoInstallOnAppQuit,true);
 nsis.quitOnce();assert.equal(nsis.started.length,1);
});

test('Windows: a rollback to an older build pulls the downloaded one at once; the older build is downloaded and offered instead',async t=>{
 const feed=await releaseFeed({version:'0.1.0-beta.10'}),root=tmp();t.after(feed.close);
 const nsis=realNsis(feed,root),updater=make(root,nsis);
 await updater.check();await readyWith(updater,'0.1.0-beta.10');
 feed.version='0.1.0-beta.9';
 let pulledAtOnce=null;nsis.once('update-available',()=>{pulledAtOnce=nsis.autoInstallOnAppQuit===false;});
 await updater.check();
 assert.equal(pulledAtOnce,true,'from the moment the feed answers, quitting does not install beta.10');
 await readyWith(updater,'0.1.0-beta.9');
 nsis.quitOnce();
 assert.equal(nsis.started.length,1);assert.equal(nsis.started[0].sha512,sha512(feed.build('0.1.0-beta.9').exe),'the build the feed offers now');
});

test('Windows: Install now asks the feed first: halted since the download, nothing installs; same build or a newer one, it installs; offline or slow, it installs',async t=>{
 const feed=await releaseFeed(),root=tmp();t.after(feed.close);
 const ready=async(extra={})=>{const nsis=realNsis(feed,root),updater=make(root,nsis,{askWithin:400,...extra});await updater.check();await readyWith(updater,feed.version);nsis.installs=[];nsis.quitAndInstall=(...args)=>nsis.installs.push(args);return {nsis,updater};};
 {const {nsis,updater}=await ready();feed.staging=0;const asked=feed.looks();
  await updater.install();
  assert.equal(feed.looks(),asked+1,'it asked');assert.deepEqual(nsis.installs,[],'a halted build is not installed');
  await until(()=>updater.status().status==='current');assert.equal(nsis.autoInstallOnAppQuit,false);
  feed.staging=undefined;}
 {const {nsis,updater}=await ready();await updater.install();assert.deepEqual(nsis.installs,[[true,true]],'still offered: installed');}
 {const {nsis,updater}=await ready();feed.version='0.1.0-beta.10';await updater.install();
  assert.deepEqual(nsis.installs,[[true,true]],'a newer one is out: the one that is whole installs now (the newer one is found after the restart)');
  assert.deepEqual(feed.setups('0.1.0-beta.10'),[],'and nothing more is downloaded on the way out');feed.version='0.1.0-beta.9';}
 {const {nsis,updater}=await ready();feed.offline=true;await updater.install();assert.deepEqual(nsis.installs,[[true,true]],'offline');feed.offline=false;}
 {const {nsis,updater}=await ready();feed.hang=true;const began=Date.now();await updater.install();assert.deepEqual(nsis.installs,[[true,true]],'no answer in time');assert.ok(Date.now()-began<3000);feed.hang=false;}
});

test('Windows: while an update waits, the feed is asked again every 30 minutes (and not otherwise)',async t=>{
 const feed=await releaseFeed(),root=tmp();t.after(feed.close);
 const timers=[],nsis=realNsis(feed,root),updater=make(root,nsis,{every:(run,ms)=>{timers.push({run,ms});return null;}});
 updater.start();
 const waiting=timers.find(timer=>timer.ms===READY_RECHECK);
 assert.equal(READY_RECHECK,30*60*1000);assert.ok(waiting,'a 30-minute round');
 waiting.run();await pause(50);assert.equal(feed.looks(),0,'nothing waits yet: no request');
 await updater.check();await readyWith(updater,'0.1.0-beta.9');
 const asked=feed.looks();feed.staging=0;
 waiting.run();await until(()=>updater.status().status==='current');
 assert.equal(feed.looks(),asked+1);nsis.quitOnce();assert.deepEqual(nsis.started,[]);
});

for(const platform of ['win32','darwin'])test(`${platform==='darwin'?'Mac':'Windows'}: after a long pause the feed is asked again before the file becomes installable; halted meanwhile, nothing is handed over`,async t=>{
 const feed=await releaseFeed({slow:true}),root=tmp();t.after(feed.close);
 const real=platform==='darwin'?realMac(t,feed,root):realNsis(feed,root);
 let updater,once=false;const paused=new Promise(resolve=>{updater=make(root,real,{platform,freshFor:0,onChange:status=>{if(!once&&status.status==='downloading'&&status.transferred>=90000&&status.pausable){once=true;resolve(updater.pause());}}});});
 await updater.check();await paused;
 feed.staging=0;const asked=feed.looks();
 updater.resume(); // same run: it goes on from the byte it had without looking first
 await until(()=>updater.status().status==='current');
 assert.equal(feed.looks(),asked+2,'asked at the end, then one fresh look to say what is offered now');
 if(platform==='darwin')assert.deepEqual(real.native.got,[],'Squirrel.Mac never got the halted update (it would apply it at the next quit)');
 else{real.quitOnce();assert.deepEqual(real.started,[]);}
 assert.deepEqual(pending(root),[],'nothing was handed to electron-updater');
 assert.equal(saved(root).download,undefined,'the bytes of a halted build are not kept');
 // not halted: the same answer lets it through
 feed.staging=undefined;await updater.check();
 await until(()=>updater.status().status==='ready');
 if(platform==='darwin')await until(()=>real.native.got.length===1);
});

// --- A staged rollout -----------------------------------------------------------------------------------------------------------------------------
for(const platform of ['win32','darwin'])test(`${platform==='darwin'?'Mac':'Windows'}, the real updater: a staged rollout downloads only inside its share, and a halt (0) stops everyone before a byte is fetched`,async t=>{
 const files=v=>feed.requests.filter(r=>r.name.startsWith(`v${v}/`)&&!r.name.endsWith('.blockmap')).length;
 const feed=await releaseFeed();t.after(feed.close);
 const run=async(id,staging)=>{
  const root=tmp();fs.writeFileSync(path.join(root,'.updaterId'),id);
  feed.staging=staging;feed.requests.length=0;
  const real=platform==='darwin'?realMac(t,feed,root):realNsis(feed,root),updater=make(root,real,{platform});
  await updater.check();await until(()=>['ready','current','error'].includes(updater.status().status));
  if(platform==='darwin'&&updater.status().status==='ready')await until(()=>real.native.got.length===1); // Squirrel.Mac took it
  return {status:updater.status().status,files:files('0.1.0-beta.9')};
 };
 assert.deepEqual(await run(stagingId(true,.5),50),{status:'ready',files:1},'inside the 50% share: downloaded');
 assert.deepEqual(await run(stagingId(false,.5),50),{status:'current',files:0},'outside it: not a byte');
 assert.deepEqual(await run(stagingId(true,.5),0),{status:'current',files:0},'halted: nobody downloads');
 assert.deepEqual(await run(stagingId(false,.5),100),{status:'ready',files:1},'100%: everyone');
});

test('a paused download whose build is halted is dropped when Resume looks after a relaunch (Windows and Mac)',async t=>{
 for(const platform of ['win32','darwin']){
  const feed=await releaseFeed({slow:true}),root=tmp();t.after(feed.close);
  const real=()=>platform==='darwin'?realMac(t,feed,root):realNsis(feed,root);
  let first;const paused=new Promise(resolve=>{first=make(root,real(),{platform,onChange:status=>{if(status.status==='downloading'&&status.transferred>=90000&&status.pausable)resolve(first.pause());}});});
  await first.check();await paused;await pause(50);
  const dir=saved(root).download.dir;
  feed.staging=0;
  const again=make(root,real(),{platform});assert.equal(again.status().status,'paused');
  again.resume();await until(()=>again.status().status==='current');
  assert.equal(fs.existsSync(path.join(dir,'update.part')),false,`${platform}: the halted build's bytes are gone`);
  assert.equal(feed.requests.filter(r=>r.range).length,0,`${platform}: not one more byte of it`);
 }
});

// --- Install now after a failed start -------------------------------------------------------------------------------------------------------------
test('Install now works again after electron-updater could not start the installer',async()=>{
 const fake=new EventEmitter(),root=tmp();let calls=0,whole=false;
 fake.checkForUpdates=async()=>{fake.emit('checking-for-update');fake.emit('update-available',{version:'1.1.0'});if(!whole){whole=true;fake.emit('update-downloaded',{version:'1.1.0'});}return null;};
 fake.quitAndInstall=()=>{calls++;if(calls===1)fake.emit('error',new Error('No update filepath provided, can\'t quit and install'));};
 fake.setFeedURL=()=>{};
 const updater=createAppUpdater({app:{getVersion:()=>'1.0.0',isPackaged:true,getPath:()=>root},dir:root,platform:'win32',env:{},autoUpdater:fake,uninstallerPresent:()=>true,qaBuild:false,schedule:()=>null,every:()=>null});
 await updater.check();assert.equal(updater.status().status,'ready');
 await updater.install();assert.equal(calls,1);
 assert.equal(updater.status().status,'error','the file was not there: nothing to install');
 whole=false;await updater.check();assert.equal(updater.status().status,'ready');
 await updater.install();assert.equal(calls,2,'a later Install now reaches electron-updater again');
});

// --- A download that goes quiet -------------------------------------------------------------------------------------------------------------------
test('Acira\'s download that goes quiet resumes at once from the byte it had, keeps every byte, and never shows an error',async t=>{
 const feed=await releaseFeed(),root=tmp();t.after(feed.close);
 feed.quiet={name:'v0.1.0-beta.9/AciraBrowserSetup.exe',after:100000};
 const seen=[],nsis=realNsis(feed,root),updater=make(root,nsis,{stall:300,onChange:status=>seen.push(status.status)});
 await updater.check();await readyWith(updater,'0.1.0-beta.9');
 assert.deepEqual(feed.setups('0.1.0-beta.9'),[null,'bytes=100000-'],'the second request asks only for the rest');
 assert.equal(seen.includes('error'),false,'no error on the way');
 assert.equal(sha512(fs.readFileSync(nsis.installerPath)),sha512(feed.build('0.1.0-beta.9').exe));
});

test('electron-updater\'s own download (the fallback) that goes quiet is given up, so the next check can start it again',async()=>{
 const fake=new EventEmitter(),root=tmp(),tokens=[];
 fake.checkForUpdates=async()=>{fake.emit('checking-for-update');fake.emit('update-available',{version:'1.1.0'});return null;}; // describes no file: electron-updater downloads by itself
 fake.downloadUpdate=token=>{tokens.push(token);fake.emit('download-progress',{percent:10,transferred:10,total:100});return new Promise((resolve,reject)=>{token?.onCancel?.(()=>reject(new Error('cancelled')));});};
 fake.quitAndInstall=()=>{};fake.setFeedURL=()=>{};
 const updater=createAppUpdater({app:{getVersion:()=>'1.0.0',isPackaged:true,getPath:()=>root},dir:root,platform:'win32',env:{},autoUpdater:fake,uninstallerPresent:()=>true,qaBuild:false,schedule:()=>null,every:()=>null,stall:200});
 await updater.check();assert.equal(updater.status().status,'downloading');
 await until(()=>updater.status().status==='error',3000);
 assert.equal(tokens[0]?.cancelled,true,'electron-updater\'s download was cancelled');
 await updater.check();assert.equal(tokens.length,2,'the next check starts it again');
});

// --- The profile's route --------------------------------------------------------------------------------------------------------------------------
test('the check and Acira\'s download wait for the profile\'s route; an unconfirmed route sends nothing',async t=>{
 const feed=await releaseFeed(),root=tmp();t.after(feed.close);
 const calls=[];let refuse=true;
 const route=async()=>{calls.push(feed.requests.map(r=>r.name));if(refuse)throw new Error('The connection settings are not confirmed yet, so Acira did not look for an update. It tries again later.');};
 const updater=make(root,realNsis(feed,root),{route});
 await updater.check();
 assert.equal(feed.requests.length,0,'nothing left by the system route');
 assert.equal(updater.status().status,'error');assert.match(updater.status().error,/not confirmed/);
 refuse=false;calls.length=0;
 await updater.check();await readyWith(updater,'0.1.0-beta.9');
 assert.deepEqual(calls[0],[],'set before the check');
 assert.deepEqual(calls[1],['beta.yml'],'and again before the download');
});

// --- The test-mode stand-in (the live rig's updater) on the Windows route ------------------------------------------------------------------------
test('the stand-in updater on the Windows route: no flicker while ready, and a halt pulls the waiting update (ACIRA_UPDATE_TEST_PLATFORM=win32)',async t=>{
 const setup=blob(9),doc={version:'0.1.0-beta.10',releaseNotes:'Local notes',files:[{url:'AciraBrowserSetup.exe',sha512:sha512(setup),size:setup.length}]},requests=[];
 const server=http.createServer((req,res)=>{
  requests.push(req.url);
  if(req.url.endsWith('latest.yml'))return res.end(JSON.stringify(doc));
  if(req.url.endsWith('.exe')){res.setHeader('content-length',setup.length);return res.end(setup);}
  res.statusCode=404;res.end();
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.closeAllConnections?.();server.close(resolve);}));
 const root=tmp(),seen=[];
 const updater=createAppUpdater({app:{getVersion:()=>'0.1.0-beta.9',isPackaged:false,getPath:()=>root},dir:root,env:{ACIRA_UPDATE_TEST:'1',ACIRA_UPDATE_STUB:'1',ACIRA_UPDATE_TEST_PLATFORM:'win32',ACIRA_UPDATE_FEED:`http://127.0.0.1:${server.address().port}/`},schedule:()=>null,every:()=>null,fetch,askWithin:2000,onChange:status=>seen.push(status.status)});
 await updater.check();await readyWith(updater,'0.1.0-beta.10');
 assert.equal(requests.filter(url=>url.endsWith('.exe')).length,1,'Acira\'s own download on the Windows route');
 seen.length=0;await updater.check();await pause(50);
 assert.deepEqual([...new Set(seen)].filter(s=>s!=='ready'),[],'no flicker');
 doc.stagingPercentage=0;
 const result=await updater.install();
 assert.notEqual(result.installing,true,'Install now asked first and did not install the halted build');
 await until(()=>updater.status().status==='current');
 let log=[];try{log=JSON.parse(fs.readFileSync(path.join(root,'update-stub-log.json'),'utf8'));}catch{}
 assert.equal(log.some(row=>row.event?.quitAndInstall),false,'no installer was started');
});

test('versions compare in semver order, as electron-updater compares them (checked against the semver package)',()=>{
 const {lowerThan}=require('../desktop/browser-services/app-updater.cjs'),semver=require('semver');
 const versions=['0.1.0-beta.1','0.1.0-beta.2','0.1.0-beta.9','0.1.0-beta.10','0.1.0-beta.11','0.1.0-alpha.3','0.1.0-beta','0.1.0-rc.1','0.1.0','0.1.1-beta.1','0.1.1','0.2.0','1.0.0','10.0.0','1.0.0-beta.2+abc','v0.1.0-beta.9'];
 for(const a of versions)for(const b of versions)assert.equal(lowerThan(a,b),semver.lt(a,b),`${a} < ${b}`);
 assert.equal(lowerThan('0.1.0-beta.9','not a version'),false);assert.equal(lowerThan(null,'0.1.0'),false);
});

// --- Review fixes: the update that waits is only pulled by its own halt, and stays installable while a newer one comes ------------------------------
for(const staging of [10,0])test(`Windows: a newer build this install is outside of (stagingPercentage ${staging}) leaves the waiting update offered and installable`,async t=>{
 const feed=await releaseFeed(),root=tmp();t.after(feed.close);
 fs.writeFileSync(path.join(root,'.updaterId'),stagingId(false,.1));
 const nsis=realNsis(feed,root),updater=make(root,nsis,{askWithin:2000});
 await updater.check();await readyWith(updater,'0.1.0-beta.9');
 feed.version='0.1.0-beta.10';feed.staging=staging;
 await updater.check();await pause(80); // the 30-minute round
 assert.equal(updater.status().status,'ready');assert.equal(updater.status().available,'0.1.0-beta.9');
 assert.equal(nsis.autoInstallOnAppQuit,true,'still installs on quit');assert.ok(pending(root).includes('AciraBrowserSetup.exe'),'electron-updater still has it');
 const installs=[];nsis.quitAndInstall=(...args)=>installs.push(args);
 await updater.install();
 assert.deepEqual(installs,[[true,true]],'Install now installs the waiting update');
});

test('Mac: a long download whose feed moved on to a newer build this install is outside of is still handed to Squirrel.Mac',async t=>{
 const feed=await releaseFeed({slow:true}),root=tmp();t.after(feed.close);
 fs.writeFileSync(path.join(root,'.updaterId'),stagingId(false,.1));
 const mac=realMac(t,feed,root);let updater,once=false;
 const paused=new Promise(resolve=>{updater=make(root,mac,{platform:'darwin',freshFor:0,onChange:status=>{if(!once&&status.status==='downloading'&&status.transferred>=90000&&status.pausable){once=true;resolve(updater.pause());}}});});
 await updater.check();await paused;
 feed.version='0.1.0-beta.10';feed.staging=10;
 updater.resume();
 await until(()=>mac.native.got.length===1);
 const arm=process.arch==='arm64'||require('../desktop/browser-services/app-updater.cjs').macArm64();
 assert.equal(mac.native.got[0],sha512(arm?feed.build('0.1.0-beta.9').arm:feed.build('0.1.0-beta.9').x64),'the waiting build, not dropped');
 assert.equal(updater.status().status,'ready');assert.equal(updater.status().available,'0.1.0-beta.9');
});

test('Windows, automatic download off: a newer version found while one is ready leaves Install now and the 30-minute round as they were',async t=>{
 const feed=await releaseFeed(),root=tmp();t.after(feed.close);
 const nsis=realNsis(feed,root),seen=[],updater=make(root,nsis,{onChange:status=>seen.push(status.status)});
 updater.setAutoDownload(false);await updater.check();await until(()=>updater.status().status==='available');await updater.download();
 await readyWith(updater,'0.1.0-beta.9');
 feed.version='0.1.0-beta.10';seen.length=0;
 await updater.check();await pause(80);
 assert.deepEqual([...new Set(seen)].filter(s=>s!=='ready'),[]);assert.equal(updater.status().available,'0.1.0-beta.9');
 assert.deepEqual(feed.setups('0.1.0-beta.10'),[],'nothing downloaded with automatic download off');
 const asked=feed.looks();await updater.check();assert.equal(feed.looks(),asked+1,'still looked at while it waits');
 const installs=[];nsis.quitAndInstall=(...args)=>installs.push(args);
 await updater.install();assert.deepEqual(installs,[[true,true]]);
});

test('Windows, automatic download on: a newer version downloads quietly while the whole one stays ready; Install now meanwhile installs the whole one',async t=>{
 const feed=await releaseFeed({slow:true}),root=tmp();t.after(feed.close);
 const nsis=realNsis(feed,root),seen=[],updater=make(root,nsis,{askWithin:2000,onChange:status=>seen.push(`${status.status}:${status.available}`)});
 await updater.check();await readyWith(updater,'0.1.0-beta.9');
 feed.version='0.1.0-beta.10';seen.length=0;
 await updater.check();
 await until(()=>feed.setups('0.1.0-beta.10').length===1);await pause(100);
 assert.deepEqual([...new Set(seen)],['ready:0.1.0-beta.9'],'the pill and Install now stay while the newer one downloads');
 const installs=[];nsis.quitAndInstall=(...args)=>installs.push(args);
 await updater.install();
 assert.deepEqual(installs,[[true,true]]);
 assert.equal(sha512(fs.readFileSync(nsis.installerPath)),sha512(feed.build('0.1.0-beta.9').exe),'the whole one installs');
 const at=feed.requests.length;await pause(300);
 assert.equal(feed.requests.length,at,'the newer download stopped for the restart');
});

test('Windows: a newer version that finishes in the background replaces the waiting one, and asks once more',async t=>{
 const feed=await releaseFeed({slow:true}),root=tmp();t.after(feed.close);
 const nsis=realNsis(feed,root),seen=[],updater=make(root,nsis,{onChange:status=>seen.push(`${status.status}:${status.available}`)});
 await updater.check();await readyWith(updater,'0.1.0-beta.9');updater.claimPrompt();
 feed.version='0.1.0-beta.10';seen.length=0;
 await updater.check();await readyWith(updater,'0.1.0-beta.10');
 assert.deepEqual([...new Set(seen)],['ready:0.1.0-beta.9','ready:0.1.0-beta.10'],'straight from one whole update to the next');
 assert.equal(updater.status().prompt,true,'the one question, for the new version');assert.match(updater.status().notes,/Notes for 0\.1\.0-beta\.10/);
 nsis.quitOnce();assert.equal(nsis.started.at(-1).sha512,sha512(feed.build('0.1.0-beta.10').exe));
});

test('Windows: while one waits, electron-updater never downloads a newer version by itself (it would empty its cache, the waiting setup included)',async t=>{
 const feed=await releaseFeed(),root=tmp();t.after(feed.close);
 const nsis=realNsis(feed,root),updater=make(root,nsis);
 await updater.check();await readyWith(updater,'0.1.0-beta.9');
 feed.version='0.1.0-beta.10';feed.bare.add('0.1.0-beta.10');feed.fail.add('v0.1.0-beta.10/AciraBrowserSetup.exe'); // no size: Acira's own download can't take it, electron-updater's would (and it fails)
 await updater.check();await pause(150);
 assert.equal(updater.status().status,'ready');assert.equal(updater.status().available,'0.1.0-beta.9');
 assert.ok(nsis.installerPath&&fs.existsSync(nsis.installerPath),'the waiting setup is still there');
 nsis.quitOnce();assert.equal(nsis.started.length,1);assert.equal(nsis.started[0].sha512,sha512(feed.build('0.1.0-beta.9').exe));
});

test('a look the feed answers too late (after the end-of-download ask gave up) starts no second download',async t=>{
 const feed=await releaseFeed(),root=tmp();t.after(feed.close);
 const nsis=realNsis(feed,root),seen=[],updater=make(root,nsis,{askWithin:150,freshFor:0,onChange:status=>{seen.push(status.status);if(status.status==='downloading')feed.hang=true;}}); // the end-of-download ask hangs
 const take=nsis.downloadUpdate.bind(nsis);let takes=0;
 nsis.downloadUpdate=async(...args)=>{takes++;if(takes===1){feed.hang=false;feed.answer();await pause(150);}return take(...args);}; // the late answer lands while the file is handed over
 await updater.check();
 await readyWith(updater,'0.1.0-beta.9');await pause(150);
 assert.equal(takes,1,'one hand-over: the late answer started no second download');
});

test('a look that fails too late (after Install now\'s ask gave up) leaves the waiting update offered, so a later halt still pulls it',async t=>{
 const feed=await releaseFeed(),root=tmp();t.after(feed.close);
 const nsis=realNsis(feed,root),seen=[],updater=make(root,nsis,{askWithin:150,onChange:status=>seen.push(status.status)});
 await updater.check();await readyWith(updater,'0.1.0-beta.9');
 feed.hang=true;const installs=[];nsis.quitAndInstall=(...args)=>installs.push(args);
 await updater.install();assert.deepEqual(installs,[[true,true]],'no answer in time: it installs');
 feed.hang=false;feed.drop();await pause(150); // the look fails late: socket hang up
 assert.equal(updater.status().status,'ready');assert.equal(updater.status().error,null);assert.equal(seen.includes('error'),false);
 feed.staging=0;await updater.check();await until(()=>updater.status().status==='current');
 nsis.quitOnce();assert.deepEqual(nsis.started,[],'the halt is still honoured');
});

test('electron-updater\'s own download leaves by the profile\'s route too',async()=>{
 const fake=new EventEmitter(),root=tmp(),order=[];
 fake.checkForUpdates=async()=>{order.push('check');fake.emit('checking-for-update');fake.emit('update-available',{version:'1.1.0'});return null;}; // no file description: electron-updater downloads by itself
 fake.downloadUpdate=async()=>{order.push('download');return [];};fake.quitAndInstall=()=>{};fake.setFeedURL=()=>{};
 const updater=createAppUpdater({app:{getVersion:()=>'1.0.0',isPackaged:true,getPath:()=>root},dir:root,platform:'win32',env:{},autoUpdater:fake,uninstallerPresent:()=>true,qaBuild:false,schedule:()=>null,every:()=>null,route:async()=>{order.push('route');}});
 await updater.check();await until(()=>order.includes('download'));
 assert.deepEqual(order,['route','check','route','download']);
});

// --- Round 2 (updates-2): Windows quitting, a Resume that can't connect, a check that never answers ------------------------------------------------------
// A clock the test moves: the feed's last answer is "more than 5 minutes old" without waiting 5 minutes.
const clock=()=>{const c={t:1_000_000,now:()=>c.t,later:ms=>{c.t+=ms;}};return c;};
const STALE=6*60*1000;
const {QUIT_ASK,CHECK_WITHIN}=require('../desktop/browser-services/app-updater.cjs');

// Install now on a Mac (as in round 1: no ask; MacUpdater restarts once Squirrel.Mac has the update). An Install now whose Squirrel step fails must not
// leave MacUpdater's listener behind, and an error while it saved the session must not go on to quitAndInstall.
test('Mac: an Install now whose Squirrel.Mac step fails leaves no listener behind, so a later hand-over does not restart Acira',async t=>{
 const feed=await releaseFeed(),root=tmp();t.after(feed.close);
 const mac=realMac(t,feed,root);
 // Squirrel.Mac has fetched the zip from MacUpdater's proxy but not finished unpacking and checking it when Install now comes
 mac.native.checkForUpdates=()=>{(async()=>{const answer=await(await fetch(mac.native.feed.url,{headers:mac.native.feed.headers})).json();await(await fetch(answer.url)).arrayBuffer();mac.native.fetched=true;})().catch(()=>{});};
 const updater=make(root,mac,{platform:'darwin',askWithin:2000});
 await updater.check();await readyWith(updater,'0.1.0-beta.9');await until(()=>mac.native.fetched===true);
 assert.equal((await updater.install()).installing,true);
 mac.native.emit('error',new Error('Squirrel could not check the update\'s signature'));
 await until(()=>updater.status().status==='error');
 mac.native.emit('update-downloaded'); // a later hand-over finishing (the next try, the next update)
 assert.equal(mac.native.restarts,0,'no restart nobody asked for');
});

for(const platform of ['win32','darwin'])test(`${platform==='darwin'?'Mac':'Windows'}: an error while Install now asked or saved the session ends that install: quitAndInstall is not called`,async()=>{
 // A Mac: Squirrel.Mac failing to stage the update right after "ready", reported while the session is saved. Windows: the same during the ask or the save.
 const fake=new EventEmitter(),root=tmp();let installs=0;
 fake.checkForUpdates=async()=>{fake.emit('checking-for-update');fake.emit('update-available',{version:'1.1.0'});fake.emit('update-downloaded',{version:'1.1.0'});return null;};
 fake.quitAndInstall=()=>{installs++;};fake.setFeedURL=()=>{};
 const updater=createAppUpdater({app:{getVersion:()=>'1.0.0',isPackaged:true,getPath:()=>root},dir:root,platform,env:{},autoUpdater:fake,uninstallerPresent:()=>true,qaBuild:false,macAvailability:()=>null,schedule:()=>null,every:()=>null,askWithin:200,
  beforeInstall:async()=>{fake.emit('error',new Error('Squirrel could not check the update\'s signature'));}});
 await updater.check();assert.equal(updater.status().status,'ready');
 const result=await updater.install();
 assert.equal(installs,0,'no quitAndInstall after the install ended in an error');assert.notEqual(result.installing,true);assert.equal(updater.status().status,'error');
 // a later Install now, once offered again, goes through
 await updater.check();assert.equal(updater.status().status,'ready');
 const again=createAppUpdater({app:{getVersion:()=>'1.0.0',isPackaged:true,getPath:()=>root},dir:root,platform,env:{},autoUpdater:fake,uninstallerPresent:()=>true,qaBuild:false,macAvailability:()=>null,schedule:()=>null,every:()=>null,askWithin:200});
 await again.check();assert.equal((await again.install()).installing,true);assert.equal(installs,1);
});

test('Windows: quitting with a waiting update whose build was halted since the last answer (over 5 minutes old) does not install it',async t=>{
 const feed=await releaseFeed(),root=tmp();t.after(feed.close);
 const c=clock(),nsis=realNsis(feed,root),updater=make(root,nsis,{now:c.now});
 await updater.check();await readyWith(updater,'0.1.0-beta.9');
 feed.staging=0;c.later(STALE);const asked=feed.looks(),began=Date.now();
 await updater.atQuit?.(); // main's will-quit step (absent before: quitting went straight to the setup)
 nsis.quitOnce();
 assert.deepEqual(nsis.started,[],'the halted setup does not run when Acira quits');assert.ok(Date.now()-began<QUIT_ASK,'within the quick ask');
 assert.equal(feed.looks(),asked+1,'asked once on the way out');assert.equal(nsis.autoInstallOnAppQuit,false);assert.deepEqual(pending(root),[]);
});

test('Windows: the quit check is capped and only asks when the last answer is old: fresh, offline or no answer in time, it installs as before',async t=>{
 const feed=await releaseFeed(),root=tmp();t.after(feed.close);
 const ready=async()=>{const own=tmp(),c=clock(),nsis=realNsis(feed,own),updater=make(own,nsis,{now:c.now});await updater.check();await readyWith(updater,'0.1.0-beta.9');return {c,nsis,updater};}; // each block is its own install: a quit that started an install records an attempt in updater.json (beta.14), and four in one folder would be four installs that did not take
 {const {nsis,updater}=await ready();feed.staging=0;const asked=feed.looks(); // halted a minute ago, the answer is fresh: not asked
  await updater.atQuit();assert.equal(feed.looks(),asked,'no request');nsis.quitOnce();assert.equal(nsis.started.length,1);feed.staging=undefined;}
 {const {c,nsis,updater}=await ready();feed.hang=true;c.later(STALE);const began=Date.now();
  await updater.atQuit();const took=Date.now()-began;
  assert.ok(took>=QUIT_ASK-50&&took<QUIT_ASK+500,`waited ${took} ms for an answer, no longer`);nsis.quitOnce();assert.equal(nsis.started.length,1,'no answer in time: it installs');feed.hang=false;feed.drop();}
 {const {c,nsis,updater}=await ready();feed.offline=true;c.later(STALE);
  await updater.atQuit();nsis.quitOnce();assert.equal(nsis.started.length,1,'offline: it installs');feed.offline=false;}
 {const {c,nsis,updater}=await ready();c.later(STALE);const asked=feed.looks();
  await updater.atQuit();assert.equal(feed.looks(),asked+1);nsis.quitOnce();assert.equal(nsis.started.length,1,'still offered: it installs');}
});

test('quitting with no update waiting asks nothing and does not wait (Mac and Windows), and Install now\'s own quit is left alone',async t=>{
 const feed=await releaseFeed(),root=tmp();t.after(feed.close);
 for(const platform of ['win32','darwin']){
  const real=platform==='darwin'?realMac(t,feed,root):realNsis(feed,root),updater=make(root,real,{platform});
  const asked=feed.looks(),began=Date.now();
  await updater.atQuit();assert.ok(Date.now()-began<20,'nothing waits: no delay');assert.equal(feed.looks(),asked);
 }
 const nsis=realNsis(feed,root),updater=make(root,nsis);await updater.check();await readyWith(updater,'0.1.0-beta.9');
 nsis.quitAndInstall=()=>{};await updater.install();const asked=feed.looks();
 await updater.atQuit();assert.equal(feed.looks(),asked,'Install now already asked; its quit is not held');
});

test('main waits for the update step beside the session flush when Acira quits',()=>{
 const main=fs.readFileSync(path.join(__dirname,'..','desktop','main.cjs'),'utf8');
 const flush=main.match(/createSessionShutdown\(\{beforeFlush:async\(\)=>\{([^\n]*?)\},getSessions:/);assert(flush,'the will-quit flush');
 assert.match(flush[1],/const update=appUpdater\?\.atQuit\(\);/,'started before the flush waits on anything');
 assert.match(flush[1],/await update;$/,'and waited for with it (the flush itself is capped at 5 seconds)');
});

// The stand-in updater (the live rig's) stands in for NsisUpdater's quit handler, and logs what would install.
async function standInFeed(t,{doc}){
 const zip=blob(11),server=http.createServer((req,res)=>{
  if(req.url.endsWith('latest.yml'))return res.end(JSON.stringify(doc()));
  if(req.url.endsWith('.zip')||req.url.endsWith('.exe')){res.setHeader('content-length',zip.length);return res.end(zip);}
  res.statusCode=404;res.end();
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.closeAllConnections?.();server.close(resolve);}));
 return {zip,url:`http://127.0.0.1:${server.address().port}/`};
}
const stubLog=root=>{try{return JSON.parse(fs.readFileSync(path.join(root,'update-stub-log.json'),'utf8')).map(row=>row.event);}catch{return [];}};
test('the stand-in updater (the Windows setup at quit): a build halted before the quit is not installed; one still offered is',async t=>{
 const platform='win32';
 let staging;const holder={};
 const feed=await standInFeed(t,{doc:()=>({version:'0.1.0-beta.11',releaseNotes:'Local notes',files:[{url:platform==='darwin'?'Acira-0.1.0-beta.11-arm64-mac.zip':'AciraBrowserSetup.exe',sha512:sha512(holder.zip),size:holder.zip.length}],...(staging===undefined?{}:{stagingPercentage:staging})})});
 holder.zip=feed.zip;
 const run=async halt=>{
  const root=tmp(),app=new EventEmitter();Object.assign(app,{getVersion:()=>'0.1.0-beta.10',isPackaged:false,getPath:()=>root});
  const updater=createAppUpdater({app,dir:root,platform:'darwin',macArm64:()=>true,env:{ACIRA_UPDATE_TEST:'1',ACIRA_UPDATE_STUB:'1',ACIRA_UPDATE_FEED:feed.url,ACIRA_UPDATE_TEST_FRESH_MS:'0',...(platform==='win32'?{ACIRA_UPDATE_TEST_PLATFORM:'win32'}:{})},schedule:()=>null,every:()=>null,fetch});
  staging=undefined;await updater.check();await readyWith(updater,'0.1.0-beta.11');
  if(halt)staging=0;
  await updater.atQuit();app.emit('quit');await pause(250);
  return stubLog(root);
 };
 const halted=await run(true),offered=await run(false);
 assert.equal(halted.some(row=>row.installOnQuit),false,'halted: the setup does not run at quit');
 assert.deepEqual(offered.filter(row=>row.installOnQuit).map(row=>row.installOnQuit),['0.1.0-beta.11'],'offered: it does');
});

// The newer download behind a waiting update has nothing on screen and no pause of its own (decided in updates-2: a pause would need a control in the
// Update ready panel). Install now and quitting stop it, its bytes stay for the next start, and the automatic-download switch keeps it from starting.
// It happens on Windows only: a Mac does not look while an update waits with Squirrel.Mac.

// --- A Resume that cannot connect ---------------------------------------------------------------------------------------------------------------------
for(const platform of ['win32','darwin'])test(`${platform==='darwin'?'Mac':'Windows'}: Resume while offline stays paused with its bytes and says the connection failed; the next Resume goes on`,async t=>{
 const feed=await releaseFeed({slow:true}),root=tmp();t.after(feed.close);
 const real=platform==='darwin'?realMac(t,feed,root):realNsis(feed,root),seen=[];let updater,once=false;
 const paused=new Promise(resolve=>{updater=make(root,real,{platform,onChange:status=>{seen.push(status.status);if(!once&&status.status==='downloading'&&status.transferred>=90000&&status.pausable){once=true;resolve(updater.pause());}}});});
 await updater.check();await paused;await pause(50);
 const before=updater.status();feed.offline=true;seen.length=0;
 updater.resume();
 await until(()=>updater.status().status!=='downloading');await pause(100);
 const after=updater.status();
 assert.equal(after.status,'paused','still paused: the panel stays open and the toolbar keeps its dots');
 assert.equal(seen.includes('error'),false,'never "error" on the way');
 assert.equal(after.pausable,true);assert.equal(after.progress,before.progress,'the same progress');assert.equal(after.transferred,before.transferred);
 assert.match(after.error,/fetch failed|socket|ECONNRESET|network|terminated/i,'the reason, for Settings\' technical note');
 assert.equal(saved(root).download.paused,true,'still paused after a relaunch');
 feed.offline=false;updater.resume();
 await readyWith(updater,'0.1.0-beta.9');assert.equal(updater.status().error,null);
 const last=feed.requests.filter(r=>r.name.startsWith('v0.1.0-beta.9/')).at(-1);assert.match(last.range||'',/^bytes=[1-9]\d*-$/,'it went on from the bytes it had');
});

test('after a relaunch, Resume while offline (the look fails) stays paused and says so; a halted build is still dropped at the next Resume',async t=>{
 const feed=await releaseFeed({slow:true}),root=tmp();t.after(feed.close);
 let first;const paused=new Promise(resolve=>{first=make(root,realNsis(feed,root),{onChange:status=>{if(status.status==='downloading'&&status.transferred>=90000&&status.pausable)resolve(first.pause());}});});
 await first.check();await paused;await pause(50);
 const seen=[],again=make(root,realNsis(feed,root),{onChange:status=>seen.push(status.status)});
 assert.equal(again.status().status,'paused');
 feed.offline=true;again.resume();
 await until(()=>again.status().status!=='downloading');
 assert.equal(again.status().status,'paused');assert.equal(seen.includes('error'),false);assert.ok(again.status().error);
 feed.offline=false;feed.staging=0;again.resume();
 await until(()=>again.status().status==='current');
});

// --- A check that never answers -----------------------------------------------------------------------------------------------------------------------
/** electron-updater's HTTP as it behaves on Electron's net: its timeout waits for a 'socket' event that never comes, so a request nobody answers hangs. */
const netExecutor=()=>{const executor=nodeExecutor();executor.addTimeOutHandler=()=>{};return executor;};
test('a check on a dead connection ends after the watchdog, and the next check really asks again (electron-updater forgets the hung one)',{timeout:20000},async t=>{
 const feed=await releaseFeed(),root=tmp();t.after(feed.close);
 const nsis=realNsis(feed,root);nsis.httpExecutor=netExecutor();
 const updater=make(root,nsis,{checkWithin:300});
 feed.hang=true;
 const looking=updater.check();await pause(50);assert.equal(updater.status().status,'checking');
 await looking;
 assert.equal(updater.status().status,'error','given up: the retries take over');assert.match(updater.status().error,/no answer/);
 feed.hang=false;const asked=feed.looks();
 await updater.check();await readyWith(updater,'0.1.0-beta.9');
 assert.equal(feed.looks(),asked+1,'a new request, not the hung one handed back');
 assert.equal(CHECK_WITHIN,60*1000);
});

test('a hung 30-minute look while an update waits ends too: a halt published afterwards is still seen',{timeout:20000},async t=>{
 const feed=await releaseFeed(),root=tmp();t.after(feed.close);
 const nsis=realNsis(feed,root);nsis.httpExecutor=netExecutor();
 const updater=make(root,nsis,{checkWithin:300,askWithin:200});
 await updater.check();await readyWith(updater,'0.1.0-beta.9');
 feed.hang=true;await updater.check();
 assert.equal(updater.status().status,'ready','a failed look leaves the waiting update offered');
 feed.hang=false;feed.staging=0;
 await updater.check();await until(()=>updater.status().status==='current');
 nsis.quitOnce();assert.deepEqual(nsis.started,[]);
});

test('Windows: a check the watchdog gave up that fails later (its connection closed, now or much later) leaves the waiting update offered',{timeout:20000},async t=>{
 const feed=await releaseFeed(),root=tmp();t.after(feed.close);
 const platform='win32',real=realNsis(feed,root);real.httpExecutor=netExecutor();
 let closer=()=>feed.drop(); // closeAllConnections aborts the hung request at once (seen as ERR_ABORTED in Acira's Electron)
 const seen=[],timers=[],updater=make(root,real,{platform,checkWithin:300,askWithin:200,closeConnections:()=>closer(),onChange:status=>seen.push(status.status),every:(run,ms)=>{timers.push({run,ms});return null;}});
 updater.start();const round=timers.find(timer=>timer.ms===READY_RECHECK);
 await updater.check();await readyWith(updater,'0.1.0-beta.9');
 feed.hang=true;seen.length=0;round.run(); // the 30-minute round on a dead connection
 await pause(800);
 assert.equal(updater.status().status,'ready','still offered: the pill and Install now stay');assert.equal(updater.status().error,null);assert.equal(seen.includes('error'),false);
 closer=()=>{};round.run(); // an HTTP/1.1 connection closeAllConnections does not reach: it fails later still
 await pause(600);feed.drop();await pause(200);
 assert.equal(updater.status().status,'ready');assert.equal(seen.includes('error'),false);
 feed.hang=false;feed.staging=0;round.run(); // and a halt is still honoured
 await until(()=>updater.status().status==='current');
 real.quitOnce();assert.deepEqual(real.started,[]);
});

test('Mac: the end-of-download ask that the watchdog gave up, failing after the update is with Squirrel.Mac, leaves it offered',{timeout:20000},async t=>{
 const feed=await releaseFeed({slow:true}),root=tmp();t.after(feed.close);
 const mac=realMac(t,feed,root);mac.httpExecutor=netExecutor();
 const seen=[];let updater;
 updater=make(root,mac,{platform:'darwin',freshFor:0,askWithin:150,checkWithin:600,closeConnections:()=>feed.drop(),onChange:status=>{seen.push(status.status);if(status.status==='downloading')feed.hang=true;}}); // the ask at the end of the download hangs
 await updater.check();
 await readyWith(updater,'0.1.0-beta.9');await until(()=>mac.native.got.length===1); // no answer in time: handed over, as before
 await pause(900); // the watchdog gives the ask up and closes its connection: electron-updater reports it as a failed check
 assert.equal(updater.status().status,'ready','still offered: the pill and Install now stay');assert.equal(seen.includes('error'),false);
});

test('Windows: a newer file being handed to electron-updater when Acira quits is left to finish: the quit does not ask and pull under it',async t=>{
 const feed=await releaseFeed(),root=tmp();t.after(feed.close);
 const c=clock(),nsis=realNsis(feed,root),updater=make(root,nsis,{now:c.now,quitAsk:200});
 await updater.check();await readyWith(updater,'0.1.0-beta.9');
 const take=nsis.downloadUpdate.bind(nsis);let release,handing=false;const slow=new Promise(resolve=>{release=resolve;});
 nsis.downloadUpdate=async(...args)=>{handing=true;await slow;return take(...args);};
 feed.version='0.1.0-beta.10';await updater.check();await until(()=>handing);
 c.later(STALE);const asked=feed.looks(),began=Date.now();
 await updater.atQuit();
 assert.ok(Date.now()-began<700);assert.equal(feed.looks(),asked,'no ask, no pull while electron-updater takes the newer file');
 release();await readyWith(updater,'0.1.0-beta.10');
});

test('a route that takes longer than the watchdog sends no check after the look was given up',async()=>{
 const fake=new EventEmitter(),root=tmp();let checks=0;
 fake.checkForUpdates=async()=>{checks++;fake.emit('checking-for-update');return null;};fake.setFeedURL=()=>{};
 const updater=createAppUpdater({app:{getVersion:()=>'1.0.0',isPackaged:true,getPath:()=>root},dir:root,platform:'win32',env:{},autoUpdater:fake,uninstallerPresent:()=>true,qaBuild:false,schedule:()=>null,every:()=>null,checkWithin:150,route:()=>new Promise(resolve=>setTimeout(resolve,400))});
 await updater.check();assert.equal(updater.status().status,'error');
 await pause(400);assert.equal(checks,0,'nothing left once the look had ended');
});

// --- The Windows signature check on Acira's own download --------------------------------------------------------------------------------------------
// electron-updater checks a setup's Authenticode signature (NsisUpdater.verifySignature) only when it downloads the file itself; the file Acira hands
// to its cache is taken as it is (executeDownload: done(false)). Once Acira's Windows builds are signed, a normal update had no check at all.
/** NsisUpdater.verifySignature stood in for: null (signed by the owner, or no publisher named) or a reason. Records the files it was asked about. */
const signature=(nsis,answer)=>{nsis.checked=[];nsis.verifySignature=async file=>{nsis.checked.push({name:path.basename(file),sha512:sha512(fs.readFileSync(file))});return typeof answer==='function'?answer(file):answer;};return nsis;};
test('Windows: Acira\'s own download is checked for the owner\'s signature before electron-updater takes it; signed, it installs',async t=>{
 const feed=await releaseFeed(),root=tmp();t.after(feed.close);
 const nsis=signature(realNsis(feed,root),null),updater=make(root,nsis);
 await updater.check();await readyWith(updater,'0.1.0-beta.9');
 assert.deepEqual(nsis.checked,[{name:'update.part',sha512:sha512(feed.build('0.1.0-beta.9').exe)}],'the whole, verified setup was checked, once, before the hand-over');
 nsis.quitOnce();assert.equal(nsis.started.length,1);
});

test('Windows: a setup not signed by the application owner never installs; its bytes go and it is not downloaded or retried again',async t=>{
 const feed=await releaseFeed(),root=tmp();t.after(feed.close);
 const scheduled=[],nsis=signature(realNsis(feed,root),'publisherNames: Acira; raw info: unsigned'),updater=make(root,nsis,{schedule:(run,ms)=>{scheduled.push(ms);return null;}});
 await updater.check();await until(()=>updater.status().status==='error');
 assert.match(updater.status().error,/not signed by the application owner: publisherNames: Acira/);
 assert.deepEqual(pending(root),[],'nothing in electron-updater\'s cache');assert.equal(saved(root).download,undefined,'the downloaded bytes are gone');
 nsis.quitOnce();assert.deepEqual(nsis.started,[],'no setup at quit');await assert.rejects(updater.install(),/No downloaded update/);
 assert.deepEqual(scheduled,[],'no retry: another try would get the same file');
 const files=feed.setups('0.1.0-beta.9').length;await updater.check();await pause(100);
 assert.equal(feed.setups('0.1.0-beta.9').length,files,'the 8-hour check does not download it again');assert.equal(updater.status().status,'error');
 // a fixed build (another file) downloads and installs as usual
 feed.version='0.1.0-beta.10';nsis.verifySignature=async()=>null;await updater.check();await readyWith(updater,'0.1.0-beta.10');
 nsis.quitOnce();assert.equal(nsis.started.length,1);
});

test('Windows: a setup an earlier run already handed to electron-updater is checked too, and refused it is removed from its cache',async t=>{
 const feed=await releaseFeed(),root=tmp();t.after(feed.close);
 const first=make(root,signature(realNsis(feed,root),null));await first.check();await readyWith(first,'0.1.0-beta.9');
 assert.ok(pending(root).includes('AciraBrowserSetup.exe'));
 const nsis=signature(realNsis(feed,root),'not signed'),again=make(root,nsis); // the next start, with a check that refuses it
 await again.check();await until(()=>again.status().status==='error');
 assert.deepEqual(nsis.checked.map(c=>c.name),['AciraBrowserSetup.exe'],'the copy in electron-updater\'s cache was checked');
 await until(()=>pending(root).length===0);nsis.quitOnce();assert.deepEqual(nsis.started,[]);
});

test('Windows: a newer setup behind a waiting update that is not signed by the owner leaves the waiting one offered, and is not fetched again',async t=>{
 const feed=await releaseFeed(),root=tmp();t.after(feed.close);
 const nsis=signature(realNsis(feed,root),file=>sha512(fs.readFileSync(file))===sha512(feed.build('0.1.0-beta.10').exe)?'not signed':null),updater=make(root,nsis);
 await updater.check();await readyWith(updater,'0.1.0-beta.9');
 feed.version='0.1.0-beta.10';await updater.check();await until(()=>nsis.checked.length===2);await pause(100);
 assert.equal(updater.status().status,'ready');assert.equal(updater.status().available,'0.1.0-beta.9');assert.equal(updater.status().error,null);
 const files=feed.setups('0.1.0-beta.10').length;await updater.check();await pause(100);assert.equal(feed.setups('0.1.0-beta.10').length,files);
 nsis.quitOnce();assert.equal(nsis.started.at(-1).sha512,sha512(feed.build('0.1.0-beta.9').exe),'the waiting, signed one installs');
});

// --- RELEASING.md -----------------------------------------------------------------------------------------------------------------------------------
test('RELEASING.md: a halt also changes the website\'s download link, and the halt section says what installed copies now do at quit',()=>{
 const doc=fs.readFileSync(path.join(__dirname,'..','docs','launch','RELEASING.md'),'utf8');
 const steps=doc.slice(doc.indexOf('**Something is wrong with the new version: halt it.**'),doc.indexOf('**One Mac architecture first'));
 assert.match(steps,/website's download link/);assert.match(steps,/last good version/);
 const people=doc.slice(doc.indexOf('## Staged rollout and halt, on people'),doc.indexOf('## Testing the publisher'));
 assert.doesNotMatch(people,/Quitting\s+before the next of those checks still installs it/);
 assert.doesNotMatch(people,/does not check again, so it installs at Install now or when Acira quits/);
 assert.match(people,/when it quits/);assert.doesNotMatch(people,/takes the staged copy back/);
 assert.match(people,/A halt reaches only the Macs that have not finished\s+downloading/);assert.match(people,/publish a fixed version\s+quickly/);
});
