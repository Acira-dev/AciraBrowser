'use strict';
// Pause and resume of the update download (founder, 3 Nov 2026, option B). The updater runs Acira's own resumable download of the file electron-updater
// found, keeps a pause in updater.json (a relaunch starts paused and stays off the network until Resume), and hands only a whole, verified file to
// electron-updater. The last two tests run the real NsisUpdater and MacUpdater (Squirrel.Mac stood in for) against a local feed: they take Acira's file
// from their cache without downloading it again, and nothing partial ever reaches them, so nothing partial can install on quit.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),{createHash}=require('node:crypto'),{EventEmitter}=require('node:events');
const {createAppUpdater,updateFile}=require('../desktop/browser-services/app-updater.cjs');

const sha512=buf=>createHash('sha512').update(buf).digest('base64');
const blob=(seed,length=500000)=>Buffer.from(Array.from({length},(_,i)=>(i*seed+(i>>8))&255));
const files={exe:blob(3),arm:blob(5),x64:blob(7)};
const quiet={info(){},warn(){},error(){},debug(){}};
const until=async(what,ms=8000)=>{const end=Date.now()+ms;while(!what()){if(Date.now()>end)throw new Error('timed out waiting');await new Promise(resolve=>setTimeout(resolve,10));}};

/** The feed and its files over HTTP, like GitHub Releases: Range honoured, every request counted, sent in slow pieces (about 0.6 MB/s) so a pause lands
 *  mid-file even though the interface hears of progress only every 400 ms. */
async function feedServer(version='0.1.0-beta.9'){
 const requests=[],doc={version,releaseNotes:'- Pause the update download',releaseDate:'2026-11-03T00:00:00.000Z',files:[
  {url:'AciraBrowserSetup-0.1.0-beta.9.exe',sha512:sha512(files.exe),size:files.exe.length},
 ]},mac={...doc,files:[
  {url:'Acira-0.1.0-beta.9-arm64-mac.zip',sha512:sha512(files.arm),size:files.arm.length},
  {url:'Acira-0.1.0-beta.9-mac.zip',sha512:sha512(files.x64),size:files.x64.length},
 ]};
 const byName={'AciraBrowserSetup-0.1.0-beta.9.exe':files.exe,'Acira-0.1.0-beta.9-arm64-mac.zip':files.arm,'Acira-0.1.0-beta.9-mac.zip':files.x64};
 const server=http.createServer((req,res)=>{
  const name=decodeURIComponent(new URL(req.url,'http://x').pathname.slice(1));requests.push({name,range:req.headers.range||null});
  if(name==='beta.yml'||name==='beta-mac.yml'||name==='latest.yml'){res.setHeader('content-type','text/yaml');return res.end(JSON.stringify(name==='beta.yml'?doc:mac));}
  const file=byName[name];if(!file){res.statusCode=404;return res.end();}
  const match=/^bytes=(\d+)-$/.exec(req.headers.range||''),start=match?Number(match[1]):0;
  res.writeHead(match?206:200,{'content-length':file.length-start,etag:'"f1"','accept-ranges':'bytes',...(match?{'content-range':`bytes ${start}-${file.length-1}/${file.length}`}:{})});
  let at=start;const step=()=>{if(res.destroyed)return;const piece=file.subarray(at,at+30000);at+=piece.length;if(at>=file.length)return res.end(piece);res.write(piece);setTimeout(step,50);};step();
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 return {base:`http://127.0.0.1:${server.address().port}/`,requests,fileRequests:()=>requests.filter(r=>!r.name.endsWith('.yml')&&!r.name.endsWith('.blockmap')),blockMapRequests:()=>requests.filter(r=>r.name.endsWith('.blockmap')).map(r=>r.name),close:()=>new Promise(resolve=>{server.closeAllConnections?.();server.close(resolve);})};
}
/** A small electron-updater: finds the feed's version, describes its files (updateInfoAndProvider), has a download cache, and takes a cached file. */
function liteUpdater(feed,{root,platform='win32'}={}){
 const updater=new EventEmitter(),{DownloadedUpdateHelper}=require('electron-updater/out/DownloadedUpdateHelper'),helper=new DownloadedUpdateHelper(path.join(root,'cache'));
 updater.taken=[];updater.ownDownloads=0;
 updater.checkForUpdates=async()=>{
  updater.emit('checking-for-update');
  const doc=JSON.parse(await(await fetch(feed.base+(platform==='darwin'?'beta-mac.yml':'beta.yml'))).text());
  updater.updateInfoAndProvider={info:doc,provider:{resolveFiles:info=>info.files.map(file=>({url:new URL(file.url,feed.base),info:file}))}};
  updater.emit('update-available',doc);
 };
 updater.getOrCreateDownloadHelper=async()=>helper;
 updater.downloadUpdate=async()=>{
  for(const file of updater.updateInfoAndProvider.info.files){const cached=await helper.getValidCachedUpdateFile({info:file},quiet);if(cached){updater.taken.push(cached);updater.emit('update-downloaded',updater.updateInfoAndProvider.info);return [cached];}}
  updater.ownDownloads++;throw new Error('would download by itself');
 };
 updater.quitAndInstall=(...args)=>{updater.installed=args;};updater.setFeedURL=()=>{};
 return updater;
}
const made=[];test.after(()=>{for(const root of made)fs.rmSync(root,{recursive:true,force:true});}); // every throwaway folder goes when the file's tests end
const tmp=()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'acira-update-pause-'));made.push(root);return root;};
const make=(root,autoUpdater,extra={})=>createAppUpdater({app:{getVersion:()=>extra.version||'0.1.0-beta.8',isPackaged:true,getPath:()=>root},dir:root,platform:'win32',env:{},autoUpdater,uninstallerPresent:()=>true,qaBuild:false,schedule:()=>null,every:()=>null,fetch,...extra});

test('pause keeps the bytes and is kept across a restart: the relaunch starts paused and off the network; Resume asks for the rest with Range',async t=>{
 const feed=await feedServer(),root=tmp();t.after(feed.close);
 let first;const paused=new Promise(resolve=>{first=make(root,liteUpdater(feed,{root}),{onChange:status=>{if(status.status==='downloading'&&status.transferred>=150000&&status.pausable)resolve(first.pause());}});});
 await first.check();
 const stopped=await paused;
 assert.equal(stopped.status,'paused');assert.equal(stopped.speed,null);
 await new Promise(resolve=>setTimeout(resolve,80));
 const saved=JSON.parse(fs.readFileSync(path.join(root,'updater.json'),'utf8')).download;
 assert.equal(saved.paused,true);assert.equal(saved.version,'0.1.0-beta.9');assert.equal(saved.from,'0.1.0-beta.8');assert.equal(saved.sha512,sha512(files.exe));
 assert.ok(path.basename(saved.dir)==='acira-partial'&&saved.dir.startsWith(path.join(root,'cache')),'the bytes are in electron-updater\'s cache folder');
 const kept=fs.statSync(path.join(saved.dir,'update.part')).size;assert.ok(kept>=150000&&kept<files.exe.length);
 assert.equal(fs.existsSync(path.join(root,'cache','pending')),false,'nothing partial reaches electron-updater');

 // the restart
 const asked=feed.requests.length,lite=liteUpdater(feed,{root}),second=make(root,lite);
 const restored=second.status();
 assert.equal(restored.status,'paused');assert.equal(restored.available,'0.1.0-beta.9');assert.equal(restored.transferred,kept);assert.equal(restored.total,files.exe.length);assert.equal(restored.pausable,true);
 assert.equal(restored.progress,Math.round(kept/files.exe.length*100));assert.match(restored.notes,/Pause the update download/,'What\'s new can be read while paused, after a relaunch too');
 await second.check();
 assert.equal(feed.requests.length,asked,'paused: the scheduled checks stay off the network');
 await assert.rejects(second.install(),/No downloaded update/,'a paused partial download never installs');
 const seen=[];const done=new Promise(resolve=>{lite.on('update-downloaded',resolve);});
 lite.on('checking-for-update',()=>seen.push(second.status().status));
 assert.equal(second.resume().status,'downloading');
 await done;await until(()=>second.status().status==='ready');
 assert.deepEqual(seen,['downloading'],'the look before resuming keeps the download on screen (no flash of "checking")');
 const ranges=feed.fileRequests().map(r=>r.range);
 assert.deepEqual(ranges,[null,`bytes=${kept}-`],'two requests in all: the start, then only the rest');
 assert.equal(lite.ownDownloads,0);assert.equal(sha512(fs.readFileSync(lite.taken[0])),sha512(files.exe),'electron-updater took the verified file from its cache');
 assert.equal(JSON.parse(fs.readFileSync(path.join(root,'updater.json'),'utf8')).download,undefined,'the finished download is no longer kept');
 await second.install();assert.deepEqual(lite.installed,[true,true],'now, and only now, Install now runs');
});

test('Resume in the same run goes on at once (no new look); a pause while it looks stays paused',async t=>{
 const feed=await feedServer(),root=tmp();t.after(feed.close);
 const lite=liteUpdater(feed,{root});let updater;
 const paused=new Promise(resolve=>{updater=make(root,lite,{onChange:status=>{if(status.status==='downloading'&&status.transferred>=100000&&status.pausable)resolve(updater.pause());}});});
 await updater.check();await paused;
 const looks=feed.requests.filter(r=>r.name.endsWith('.yml')).length;
 updater.resume();await until(()=>updater.status().status==='ready');
 assert.equal(feed.requests.filter(r=>r.name.endsWith('.yml')).length,looks,'this run still knew the file');
 // relaunch paused, Resume, and Pause again before the look answers: it stays paused
 const root2=tmp(),lite2=liteUpdater(feed,{root:root2});let other;
 const half=new Promise(resolve=>{other=make(root2,lite2,{onChange:status=>{if(status.status==='downloading'&&status.transferred>=100000&&status.pausable)resolve(other.pause());}});});
 await other.check();await half;
 const again=make(root2,liteUpdater(feed,{root:root2}));
 again.resume();assert.equal(again.pause().status,'paused');
 await new Promise(resolve=>setTimeout(resolve,150));
 assert.equal(again.status().status,'paused','the look that was under way does not start the download');
 assert.equal(JSON.parse(fs.readFileSync(path.join(root2,'updater.json'),'utf8')).download.paused,true);
});

test('a paused download from another version is dropped with its bytes; a withdrawn update drops it too',async t=>{
 const feed=await feedServer();t.after(feed.close);
 const pausedIn=async root=>{let updater;const paused=new Promise(resolve=>{updater=make(root,liteUpdater(feed,{root}),{onChange:status=>{if(status.status==='downloading'&&status.transferred>=100000&&status.pausable)resolve(updater.pause());}});});
  await updater.check();await paused;await new Promise(resolve=>setTimeout(resolve,50));return JSON.parse(fs.readFileSync(path.join(root,'updater.json'),'utf8')).download.dir;};
 const root=tmp(),dir=await pausedIn(root);
 const installed=make(root,liteUpdater(feed,{root}),{version:'0.1.0-beta.9'});
 assert.equal(installed.status().status,'idle','the update is the running version now: nothing paused');
 assert.equal(fs.existsSync(path.join(dir,'update.part')),false,'and its bytes are gone');
 assert.equal(JSON.parse(fs.readFileSync(path.join(root,'updater.json'),'utf8')).download,undefined);
 const root2=tmp(),dir2=await pausedIn(root2),gone=new EventEmitter();
 gone.checkForUpdates=async()=>{gone.emit('checking-for-update');gone.emit('update-not-available',{version:'0.1.0-beta.8'});};gone.quitAndInstall=()=>{};gone.setFeedURL=()=>{};
 const later=make(root2,gone);later.resume();await until(()=>later.status().status==='current');
 assert.equal(fs.existsSync(path.join(dir2,'update.part')),false,'Resume found no update any more: the bytes go');
 assert.equal(JSON.parse(fs.readFileSync(path.join(root2,'updater.json'),'utf8')).download,undefined);
});

test('Resume whose look fails is an ordinary failure: the next try says "checking" and downloads only as the automatic setting says',async t=>{
 const feed=await feedServer(),root=tmp();t.after(feed.close);
 let first;const paused=new Promise(resolve=>{first=make(root,liteUpdater(feed,{root}),{onChange:status=>{if(status.status==='downloading'&&status.transferred>=100000&&status.pausable)resolve(first.pause());}});});
 await first.check();await paused;first.setAutoDownload(false);await new Promise(resolve=>setTimeout(resolve,50));
 // the relaunch, offline when Resume looks
 const lite=liteUpdater(feed,{root}),look=lite.checkForUpdates;let offline=true;
 lite.checkForUpdates=async()=>{if(!offline)return look();lite.emit('checking-for-update');const error=new Error('net::ERR_INTERNET_DISCONNECTED');lite.emit('error',error);throw error;};
 const seen=[],second=make(root,lite,{onChange:status=>seen.push(status.status)});
 assert.equal(second.status().status,'paused');
 second.resume();await until(()=>second.status().status==='error');
 offline=false;const files=feed.fileRequests().length;seen.length=0;
 await second.check();await new Promise(resolve=>setTimeout(resolve,100));
 assert.equal(seen[0],'checking','the next try says it is checking');
 assert.equal(second.status().status,'available','automatic download is off: it waits for Download');
 assert.equal(feed.fileRequests().length,files,'nothing was downloaded');
});

test('a channel change while paused ends the pause: the bytes were for the other channel\'s file, so they go, and Resume has nothing to continue',async t=>{
 const feed=await feedServer(),root=tmp();t.after(feed.close);
 let updater;const seen=[];
 const paused=new Promise(resolve=>{updater=make(root,liteUpdater(feed,{root}),{onChange:status=>{seen.push(status.status);if(status.status==='downloading'&&status.transferred>=100000&&status.pausable)resolve(updater.pause());}});});
 await updater.check();await paused;await new Promise(resolve=>setTimeout(resolve,50));
 const dir=JSON.parse(fs.readFileSync(path.join(root,'updater.json'),'utf8')).download.dir,asked=feed.requests.length;
 const after=updater.setChannel('stable');
 assert.deepEqual([after.status,after.available,after.progress,after.pausable,after.channel],['idle',null,null,false,'stable']);
 assert.equal(seen.at(-1),'idle','every window hears of it: the toolbar\'s paused dots go');
 assert.equal(updater.resume().status,'idle','nothing to resume');
 assert.equal(fs.existsSync(path.join(dir,'update.part')),false,'the other channel\'s bytes are gone');
 assert.equal(JSON.parse(fs.readFileSync(path.join(root,'updater.json'),'utf8')).download,undefined);
 const relaunched=make(root,liteUpdater(feed,{root})).status();
 assert.deepEqual([relaunched.status,relaunched.channel],['idle','stable'],'a relaunch is not paused either');
 assert.equal(feed.requests.length,asked,'nothing was fetched');
});

test('the file for this computer: arm64 or x64 zip on a Mac (as MacUpdater picks it), the setup on Windows; no SHA-512, no own download',()=>{
 const base=new URL('https://github.com/Acira-dev/AciraBrowserUpdates/releases/download/v0.1.0-beta.9-mac-abcdef12/');
 const info={version:'0.1.0-beta.9',files:[{url:'Acira-0.1.0-beta.9-arm64-mac.zip',sha512:'A',size:10},{url:'Acira-0.1.0-beta.9-mac.zip',sha512:'X',size:11},{url:'Acira-0.1.0-beta.9-arm64.dmg',sha512:'D',size:12}]};
 const updater={updateInfoAndProvider:{info,provider:{resolveFiles:doc=>require('electron-updater/out/providers/Provider').resolveFiles(doc,base)}}};
 const arm=updateFile(updater,{platform:'darwin',arm64:()=>true}),intel=updateFile(updater,{platform:'darwin',arm64:()=>false});
 assert.deepEqual([arm.name,arm.sha512,arm.size],['Acira-0.1.0-beta.9-arm64-mac.zip','A',10]);
 assert.deepEqual([intel.name,intel.sha512,intel.size],['Acira-0.1.0-beta.9-mac.zip','X',11],'an Intel Mac never gets the arm64 file');
 const {MacUpdater}=require('electron-updater/out/MacUpdater'),{findFile}=require('electron-updater/out/providers/Provider'),resolved=updater.updateInfoAndProvider.provider.resolveFiles(info);
 for(const isArm of [true,false])assert.equal(updateFile(updater,{platform:'darwin',arm64:()=>isArm}).url,findFile(MacUpdater.filterFilesForArch(resolved,isArm),'zip',['pkg','dmg']).url.href,'the same file electron-updater\'s MacUpdater downloads');
 const win={updateInfoAndProvider:{info:{version:'0.1.0-beta.9',files:[{url:'AciraBrowserSetup-0.1.0-beta.9.exe',sha512:'W',size:13}]},provider:{resolveFiles:doc=>require('electron-updater/out/providers/Provider').resolveFiles(doc,base)}}};
 assert.deepEqual(updateFile(win,{platform:'win32',arm64:()=>false}).name,'AciraBrowserSetup-0.1.0-beta.9.exe');
 const bare={updateInfoAndProvider:{info:{version:'1',files:[{url:'Setup.exe',size:13}]},provider:win.updateInfoAndProvider.provider}};
 assert.equal(updateFile(bare,{platform:'win32',arm64:()=>false}),null,'without a SHA-512 there is nothing to verify: electron-updater downloads by itself');
 assert.equal(updateFile({},{platform:'win32',arm64:()=>false}),null);
});

test('an updater that does not describe its files downloads by itself, as before: no pause offered',async()=>{
 const fake=new EventEmitter();let asked=0;
 fake.checkForUpdates=async()=>{fake.emit('checking-for-update');fake.emit('update-available',{version:'1.1.0'});fake.emit('download-progress',{percent:30,transferred:30,total:100});};
 fake.downloadUpdate=async()=>{asked++;};fake.quitAndInstall=()=>{};fake.setFeedURL=()=>{};
 const updater=make(tmp(),fake,{version:'1.0.0'});
 await updater.check();
 assert.equal(asked,1);assert.equal(updater.status().status,'downloading');assert.equal(updater.status().pausable,false);
 assert.equal(updater.pause().status,'downloading','nothing to pause: electron-updater could only start again from zero');
});

test('automatic download off: nothing downloads until Download, which is then Acira\'s own (pausable)',async t=>{
 const feed=await feedServer(),root=tmp();t.after(feed.close);
 const updater=make(root,liteUpdater(feed,{root}));updater.setAutoDownload(false);
 await updater.check();await new Promise(resolve=>setTimeout(resolve,50));
 assert.equal(updater.status().status,'available');assert.deepEqual(feed.fileRequests(),[]);
 const started=await updater.download();
 assert.equal(started.status,'downloading');
 await until(()=>updater.status().pausable&&updater.status().transferred>0);
 assert.equal(updater.pause().status,'paused');
});

test('a damaged download is deleted and fetched once more at once; a second damaged one is an error, with nothing handed over',async t=>{
 const root=tmp(),wrong=Buffer.from(files.exe);wrong[10]^=1;let sent=0;
 const server=http.createServer((req,res)=>{if(req.url.includes('.yml'))return res.end(JSON.stringify({version:'0.1.0-beta.9',files:[{url:'Setup.exe',sha512:sha512(files.exe),size:files.exe.length}]}));if(req.url.endsWith('.blockmap')){res.statusCode=404;return res.end();}sent++;res.end(wrong);});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const lite=liteUpdater({base:`http://127.0.0.1:${server.address().port}/`},{root}),updater=make(root,lite);
 await updater.check();await until(()=>updater.status().status==='error');
 assert.equal(sent,2);assert.match(updater.status().error,/SHA-512/);
 assert.equal(fs.existsSync(path.join(root,'cache','pending')),false);assert.equal(lite.ownDownloads,0);
});

test('the test-mode stand-in (the live rig\'s updater) takes the file Acira chose for an Intel Mac from its cache, never the arm64 one',async t=>{
 const feed=await feedServer(),root=tmp();t.after(feed.close);
 const updater=createAppUpdater({app:{getVersion:()=>'0.1.0-beta.8',isPackaged:false,getPath:()=>root},dir:root,platform:'darwin',env:{ACIRA_UPDATE_TEST:'1',ACIRA_UPDATE_STUB:'1',ACIRA_UPDATE_FEED:feed.base},qaBuild:false,macArm64:()=>false,schedule:()=>null,every:()=>null,fetch});
 await updater.check();await until(()=>updater.status().status==='ready',15000);
 assert.deepEqual(feed.fileRequests().map(r=>r.name),['Acira-0.1.0-beta.9-mac.zip'],'one download, the x64 zip; the stand-in did not fetch the arm64 one');
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root,'update-stub-log.json'),'utf8')).map(row=>row.event),[{cachedDownload:'Acira-0.1.0-beta.9-mac.zip'}]);
});

// --- electron-updater itself ---------------------------------------------------------------------------------------------------------------
/** electron-updater's HTTP for Node (as electron-builder's own NodeHttpExecutor): the real check runs against the local feed, and a download of its own
 *  (none is expected: Acira downloads) reaches the feed like any other request, so a test can count it. */
function nodeExecutor(){const {HttpExecutor}=require('builder-util-runtime');return new (class extends HttpExecutor{createRequest(options,callback){return http.request(options,callback);}async download(url,destination){fs.writeFileSync(destination,Buffer.from(await(await fetch(url.href)).arrayBuffer()));return destination;}})();}
function appAdapter(root,feed,quits){
 const config=path.join(root,'app-update.yml');fs.writeFileSync(config,`provider: generic\nurl: ${feed.base}\nupdaterCacheDirName: acira-browser-updater\n`);
 return {version:'0.1.0-beta.8',name:'Acira Browser',isPackaged:true,appUpdateConfigPath:config,userDataPath:root,baseCachePath:path.join(root,'Caches'),whenReady:()=>Promise.resolve(),quit(){},relaunch(){},onQuit(handler){quits.push(handler);}};
}

test('Windows, the real NsisUpdater: it finds the update, Acira downloads it with a pause and a restart in between, and NsisUpdater takes it from its cache',async t=>{
 const feed=await feedServer(),root=tmp(),quits=[];t.after(feed.close);
 const {NsisUpdater}=require('electron-updater/out/NsisUpdater');
 const real=()=>{const nsis=new NsisUpdater(null,appAdapter(root,feed,quits));nsis.httpExecutor=nodeExecutor();nsis._testOnlyOptions={platform:'win32'};return nsis;};
 let first;const paused=new Promise(resolve=>{first=make(root,real(),{onChange:status=>{if(status.status==='downloading'&&status.transferred>=120000&&status.pausable)resolve(first.pause());}});});
 await first.check();await paused;await new Promise(resolve=>setTimeout(resolve,50));
 const nsis=real(),second=make(root,nsis);
 assert.equal(second.status().status,'paused');
 assert.equal(nsis.installerPath,null,'paused: NsisUpdater has no installer to run');assert.equal(quits.length,0,'and no install-on-quit is armed');
 const ready=new Promise(resolve=>nsis.once('update-downloaded',resolve));
 second.resume();await ready;await until(()=>second.status().status==='ready');
 assert.equal(path.dirname(nsis.installerPath),path.join(root,'Caches','acira-browser-updater','pending'));
 assert.equal(sha512(fs.readFileSync(nsis.installerPath)),sha512(files.exe));
 const exe=feed.fileRequests();assert.equal(exe.length,2,'Acira\'s two requests; NsisUpdater downloaded nothing');assert.match(exe[1].range,/^bytes=\d+-$/);
 assert.deepEqual(feed.blockMapRequests(),['AciraBrowserSetup-0.1.0-beta.9.exe.blockmap','AciraBrowserSetup-0.1.0-beta.9.exe.blockmap'],'it looked for the setup\'s blockmap (none published here, and no old setup in the cache): the whole setup, resumable');
 assert.equal(quits.length,1,'install-on-quit is armed only now, for the whole verified file');
});

test('Windows, the real NsisUpdater: a newer update found while one waits (Later) is downloaded once, by Acira; NsisUpdater takes it from its cache too',async t=>{
 // every release's setup has the same name (AciraBrowserSetup.exe), each in its own commit-tagged release folder, as on GitHub
 const builds={'0.1.0-beta.10':blob(11),'0.1.0-beta.11':blob(13)},folder=v=>`v${v}-windows-${v.slice(-2)}ab`,requests=[];let current='0.1.0-beta.10';
 const server=http.createServer((req,res)=>{
  const name=decodeURIComponent(new URL(req.url,'http://x').pathname.slice(1));requests.push({name,range:req.headers.range||null});
  if(name==='beta.yml')return res.end(JSON.stringify({version:current,files:[{url:`${folder(current)}/AciraBrowserSetup.exe`,sha512:sha512(builds[current]),size:builds[current].length}]}));
  const version=Object.keys(builds).find(v=>name===`${folder(v)}/AciraBrowserSetup.exe`);if(!version){res.statusCode=404;return res.end();}
  const file=builds[version],match=/^bytes=(\d+)-$/.exec(req.headers.range||''),start=match?Number(match[1]):0;
  res.writeHead(match?206:200,{'content-length':file.length-start,etag:`"${version}"`,...(match?{'content-range':`bytes ${start}-${file.length-1}/${file.length}`}:{})});res.end(file.subarray(start));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.closeAllConnections?.();server.close(resolve);}));
 const feed={base:`http://127.0.0.1:${server.address().port}/`},root=tmp(),quits=[];
 const {NsisUpdater}=require('electron-updater/out/NsisUpdater'),nsis=new NsisUpdater(null,appAdapter(root,feed,quits));
 nsis.httpExecutor=nodeExecutor();nsis._testOnlyOptions={platform:'win32'};nsis.logger=null;
 const updater=make(root,nsis,{version:'0.1.0-beta.9'}),setups=v=>requests.filter(r=>r.name===`${folder(v)}/AciraBrowserSetup.exe`).map(r=>r.range);
 await updater.check();await until(()=>updater.status().status==='ready'&&updater.status().available==='0.1.0-beta.10');
 updater.claimPrompt(); // Later: the update waits, and the next automatic check (every 8 hours) runs
 current='0.1.0-beta.11';
 await updater.check();await until(()=>updater.status().status==='ready'&&updater.status().available==='0.1.0-beta.11');
 await new Promise(resolve=>setTimeout(resolve,100)); // a second download would have started by now
 assert.deepEqual(setups('0.1.0-beta.11'),[null],'one download of the newer setup, Acira\'s; NsisUpdater did not fetch it again');
 assert.deepEqual(setups('0.1.0-beta.10'),[null]);
 assert.equal(sha512(fs.readFileSync(nsis.installerPath)),sha512(builds['0.1.0-beta.11']),'Install now runs the newer setup');
 assert.equal(updater.status().pausable,false);assert.equal(updater.status().error,null);
});

// --- Windows: only what changed since the installed setup ---------------------------------------------------------------------------------
const zlib=require('node:zlib');
const random=(length,seed)=>{const b=Buffer.alloc(length);let x=seed;for(let i=0;i<length;i++){x=(x*1103515245+12345)>>>0;b[i]=x>>>24;}return b;};
const blockMap=(buf,block=16384)=>{const checksums=[],sizes=[];for(let at=0;at<buf.length;at+=block){const piece=buf.subarray(at,at+block);checksums.push(createHash('sha256').update(piece).digest('base64'));sizes.push(piece.length);}return zlib.gzipSync(JSON.stringify({version:'2',files:[{name:'file',offset:0,checksums,sizes}]}));};
const winOld=random(1500000,7),winNew=(()=>{const b=Buffer.from(winOld);for(const [from,length] of [[100000,60000],[700000,200000],[1400000,100000]])for(let i=from;i<from+length;i++)b[i]^=0x5a;return b;})();
/** A Windows feed like Acira's on GitHub: beta.yml naming the setup in its commit-tagged release folder, the setup (one range at a time, multi-range
 *  refused with 501, slow), its blockmap, and the installed version's blockmap in another release folder (where electron-updater's guess never looks). */
async function windowsFeed({hint=false}={}){
 const requests=[],setup='v0.1.0-beta.9-windows-bbbb/AciraBrowserSetup-0.1.0-beta.9.exe',oldMap='v0.1.0-beta.8-windows-aaaa/AciraBrowserSetup-0.1.0-beta.8.exe.blockmap';
 let sent=0,doc=null;
 const server=http.createServer((req,res)=>{
  const name=decodeURIComponent(new URL(req.url,'http://x').pathname.slice(1));requests.push({name,range:req.headers.range||null});
  if(name==='beta.yml'||name==='latest.yml')return res.end(JSON.stringify(doc));
  if(name===setup+'.blockmap')return res.end(blockMap(winNew));
  if(name===oldMap)return res.end(blockMap(winOld));
  if(name!==setup){res.statusCode=404;return res.end();}
  const range=req.headers.range||'';if(range.includes(',')){res.writeHead(501);return res.end();}
  const match=/^bytes=(\d+)-(\d*)$/.exec(range),start=match?Number(match[1]):0,end=match&&match[2]?Number(match[2]):winNew.length-1;
  res.writeHead(match?206:200,{'content-length':end-start+1,etag:'"w9"',...(match?{'content-range':`bytes ${start}-${end}/${winNew.length}`}:{})});
  let at=start;const step=()=>{if(res.destroyed)return;const piece=winNew.subarray(at,Math.min(end+1,at+20000));at+=piece.length;sent+=piece.length;if(at>end)return res.end(piece);res.write(piece);setTimeout(step,40);};step();
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base=`http://127.0.0.1:${server.address().port}/`;
 // the publisher writes absolute release URLs, the note of earlier blockmaps too
 doc={version:'0.1.0-beta.9',releaseNotes:'- Smaller updates',files:[{url:setup,sha512:sha512(winNew),size:winNew.length}],...(hint?{previousBlockMaps:[{version:'0.1.0-beta.8',url:base+oldMap}]}:{})};
 return {base,requests,sent:()=>sent,setupRequests:()=>requests.filter(r=>r.name===setup).map(r=>r.range),mapRequests:()=>requests.filter(r=>r.name.endsWith('.blockmap')).map(r=>r.name.split('/')[0]),close:()=>new Promise(resolve=>{server.closeAllConnections?.();server.close(resolve);})};
}
const changedBytes=()=>require('../desktop/browser-services/update-download.cjs').downloaded(require('../desktop/browser-services/update-download.cjs').diffPlan(JSON.parse(zlib.gunzipSync(blockMap(winOld))),JSON.parse(zlib.gunzipSync(blockMap(winNew))),{size:winNew.length,oldSize:winOld.length}));

test('Windows, the real NsisUpdater: only the changed blocks are fetched, with a pause and a restart in between; its cache gets the new blockmap for next time',async t=>{
 const feed=await windowsFeed(),root=tmp(),quits=[];t.after(feed.close);
 const cache=path.join(root,'Caches','acira-browser-updater');fs.mkdirSync(cache,{recursive:true});
 fs.writeFileSync(path.join(cache,'installer.exe'),winOld);fs.writeFileSync(path.join(cache,'current.blockmap'),blockMap(winOld)); // what the beta.8 setup and its own update left
 const {NsisUpdater}=require('electron-updater/out/NsisUpdater');
 const real=()=>{const nsis=new NsisUpdater(null,appAdapter(root,feed,quits));nsis.httpExecutor=nodeExecutor();nsis._testOnlyOptions={platform:'win32'};nsis.logger=null;return nsis;};
 const changed=changedBytes();assert.ok(changed>=360000&&changed<=420000,'the plan fetches about the changed bytes: '+changed);
 let first;const paused=new Promise(resolve=>{first=make(root,real(),{onChange:status=>{if(status.status==='downloading'&&status.transferred>=100000&&status.pausable)resolve(first.pause());}});});
 await first.check();const stopped=await paused;
 assert.equal(stopped.total,changed,'the interface counts the bytes to fetch ("150 of 390 KB"), not the setup');
 await new Promise(resolve=>setTimeout(resolve,80));
 const nsis=real(),second=make(root,nsis),restored=second.status();
 assert.equal(restored.status,'paused');assert.equal(restored.total,changed);assert.ok(restored.transferred>=100000&&restored.transferred<changed);
 const ready=new Promise(resolve=>nsis.once('update-downloaded',resolve));
 second.resume();await ready;await until(()=>second.status().status==='ready');
 assert.equal(sha512(fs.readFileSync(nsis.installerPath)),sha512(winNew),'NsisUpdater took exactly the new setup from its cache');
 const ranges=feed.setupRequests();
 assert.ok(ranges.every(range=>/^bytes=\d+-\d+$/.test(range)),'one closed range per request (GitHub refuses multi-range): '+ranges.join(' '));
 assert.ok(feed.sent()<=changed+40000,`about the changed bytes in all (${feed.sent()} for ${changed} changed, ${winNew.length} in the setup)`);
 assert.deepEqual(feed.mapRequests(),['v0.1.0-beta.9-windows-bbbb'],'the new blockmap once; the old one came from the cache, and the resume planned from what it kept');
 // electron-updater moves it right after it says the update is downloaded
 await until(()=>{try{return zlib.gunzipSync(fs.readFileSync(path.join(cache,'current.blockmap'))).equals(zlib.gunzipSync(blockMap(winNew)));}catch{return false;}},3000);
});

test('Windows: the installed version\'s blockmap from the feed\'s note when the cache has none; none anywhere, or a damaged old setup, and the whole setup comes, resumable',async t=>{
 const lite=(feed,root)=>{const updater=liteUpdater(feed,{root});const resolve=updater.checkForUpdates;updater.checkForUpdates=async()=>{await resolve();const provider=updater.updateInfoAndProvider.provider;provider.getBlockMapFiles=(...args)=>require('electron-updater/out/providers/Provider').Provider.prototype.getBlockMapFiles.apply(provider,args);};return updater;};
 const seeded=(old=winOld)=>{const root=tmp();fs.mkdirSync(path.join(root,'cache'),{recursive:true});fs.writeFileSync(path.join(root,'cache','installer.exe'),old);return root;};
 // the note in the feed
 const noted=await windowsFeed({hint:true});t.after(noted.close);
 let root=seeded(),updater=make(root,lite(noted,root));await updater.check();await until(()=>updater.status().status==='ready',15000);
 assert.deepEqual(noted.mapRequests(),['v0.1.0-beta.9-windows-bbbb','v0.1.0-beta.8-windows-aaaa'],'the new blockmap, then the installed version\'s from the release the feed names');
 assert.ok(noted.setupRequests().every(range=>/^bytes=\d+-\d+$/.test(range))&&noted.sent()<=changedBytes()+40000,'a differential download');
 // no note, no cache: electron-updater's guess (the version swapped in the release folder, the commit kept) is a 404, as on GitHub; the whole setup
 const bare=await windowsFeed();t.after(bare.close);
 root=seeded();updater=make(root,lite(bare,root));await updater.check();await until(()=>updater.status().status==='ready',15000);
 assert.deepEqual(bare.mapRequests(),['v0.1.0-beta.9-windows-bbbb','v0.1.0-beta.8-windows-bbbb'],'it looked where electron-updater guesses (the version swapped, the new commit kept: no such release) and found nothing');
 assert.deepEqual(bare.setupRequests(),[null],'one whole download');
 // an old setup that does not match its blockmap: the assembled file fails its SHA-512, and the whole setup follows at once
 const third=await windowsFeed({hint:true});t.after(third.close);
 const damaged=Buffer.from(winOld);damaged[500000]^=1;root=seeded(damaged);
 fs.writeFileSync(path.join(root,'cache','current.blockmap'),blockMap(winOld)); // the cache's blockmap is the right size, the file behind it is not
 updater=make(root,lite(third,root));await updater.check();await until(()=>updater.status().status==='ready',20000);
 assert.equal(third.setupRequests().at(-1),null,'the differential result was deleted; the whole setup from its first byte');
 assert.equal(updater.status().error,null);
});

test('Mac, the real MacUpdater: the zip for this Mac\'s architecture, taken from its cache and served to Squirrel.Mac whole',async t=>{
 const feed=await feedServer(),root=tmp(),quits=[];t.after(feed.close);
 // Squirrel.Mac stood in for: it fetches the update from MacUpdater's local proxy the way Squirrel does (feed URL with Basic auth, then the zip)
 const native=new EventEmitter();native.got=[];
 native.setFeedURL=options=>{native.feed=options;};
 native.checkForUpdates=async()=>{const answer=await(await fetch(native.feed.url,{headers:native.feed.headers})).json();const zip=Buffer.from(await(await fetch(answer.url)).arrayBuffer());native.got.push(sha512(zip));native.emit('update-downloaded');};
 const electronId=require.resolve('electron'),saved=require.cache[electronId];
 require.cache[electronId]={id:electronId,filename:electronId,loaded:true,exports:{autoUpdater:native}};
 t.after(()=>{if(saved)require.cache[electronId]=saved;else delete require.cache[electronId];});
 const {MacUpdater}=require('electron-updater/out/MacUpdater'),mac=new MacUpdater(null,appAdapter(root,feed,quits));
 mac.httpExecutor=nodeExecutor();mac._testOnlyOptions={platform:'darwin'};mac.logger=null;t.after(()=>mac.closeServerIfExists());
 const updater=createAppUpdater({app:{getVersion:()=>'0.1.0-beta.8',isPackaged:true,getPath:()=>root},dir:root,platform:'darwin',env:{},autoUpdater:mac,qaBuild:false,macAvailability:()=>null,schedule:()=>null,every:()=>null,fetch});
 const ready=new Promise(resolve=>mac.once('update-downloaded',resolve));
 await updater.check();await ready;await until(()=>native.got.length===1);
 const arm=process.arch==='arm64'||require('../desktop/browser-services/app-updater.cjs').macArm64(),expected=arm?files.arm:files.x64;
 assert.deepEqual(native.got,[sha512(expected)],'Squirrel.Mac received exactly the verified zip for this Mac');
 assert.deepEqual(feed.fileRequests().map(r=>r.name),[arm?'Acira-0.1.0-beta.9-arm64-mac.zip':'Acira-0.1.0-beta.9-mac.zip'],'one download, Acira\'s: MacUpdater found it in its cache');
 assert.equal(updater.status().status,'ready');
});
