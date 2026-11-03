'use strict';
// Automatic updates for the installed (NSIS) Windows build, from the release target in packaging/release-target.json (GitHub Releases or
// an own server). The installed app learns that target from its app-update.yml (electron-builder writes it from the same file); nothing is hardcoded here.
// Integrity: the downloaded installer's SHA-512 must match the signed-by-nobody latest.yml published with the release,
// both fetched over HTTPS from the release target. Windows code-signature checks are skipped because the build carries no publisher signature (no
// publisherName is configured); see docs/launch/RELEASING.md for the trade-off.
//
// What the person sees (round 6, the founder's update design: automatic, quiet, then one question):
//   - checking and downloading are automatic (on by default; the Settings switch turns the download off). While it downloads, a small dot matrix beside the
//     Acira menu button fills with the real progress and its tooltip says what is happening (percent, size, speed, version). Nothing shows while there is no update;
//   - when the download is whole (status 'ready') the interface asks once, in a popup of its own: Install now, Later, Read more (the version's notes from the feed's
//     releaseNotes, plain text). claimPrompt() makes sure only one window asks, once per version. Later leaves the calm "Update" pill (and a "Restart to update" row at
//     the top of the Acira menu) as the quiet way back. The interface asks `update.status` and refreshes when main sends 'update-changed', see onChange;
//   - the download is Acira's own (update-download.cjs), so it can be paused (founder, 3 Nov 2026; option B): a click on the dots opens a panel whose
//     progress ring pauses and resumes it. A pause keeps the bytes already here, and so does a dropped connection or a quit: the rest is asked for with
//     an HTTP Range request. The paused state is kept in updater.json, so Acira starts paused (and stays off the network for updates) until Resume.
//     The finished file is checked against the feed's SHA-512, then handed to electron-updater's own cache, where downloadUpdate() finds it, checks it
//     again and goes on as before (Squirrel.Mac, or the NSIS installer). If electron-updater ever stops describing its files the way this expects,
//     it downloads by itself as it used to (not pausable). Nothing partial can install: only a whole, verified file reaches electron-updater;
//   - Install now runs install(): the session is flushed first (beforeInstall), then electron-updater's quitAndInstall (the ordinary graceful quit);
//   - ignored, the update still installs when Acira quits (autoInstallOnAppQuit);
//   - the first launch on a new version shows its release notes (electron-updater handed them over; kept with the version that was downloaded) once, by itself,
//     in a popup centred in the window (claimWelcome; the interface asks a moment after the window is free). A version without notes gets only a quiet
//     "Acira updated to X" toast, never an empty popup. A fresh install, or the first run of a build that predates this, shows nothing.
// Test mode (ACIRA_UPDATE_TEST plus ACIRA_UPDATE_STUB): a stand-in updater downloads nothing and its quitAndInstall only writes a log line, so no
// installer ever runs; ACIRA_UPDATE_TEST_VERSION pretends the app is that version (to rehearse the "updated" note); ACIRA_UPDATE_TEST_ARCH
// (arm64/x64) and ACIRA_UPDATE_TEST_PLATFORM=win32 choose the file and the route (a Mac's zip, or the Windows setup and its differential).
const fs=require('node:fs'),path=require('node:path'),{EventEmitter}=require('node:events'),{createRetry}=require('./network-retry.cjs'),fetched=require('./update-download.cjs');
const CHECK_DELAY=20*1000,CHECK_EVERY=8*60*60*1000; // every 8 hours, like Dia
// A failed check or download (offline at start, a dropped connection) tries again 2, 10 and 30 minutes later and as soon as the network comes back or the
// Mac wakes (network-retry.cjs), instead of 8 hours later. Nothing new is shown: the status says 'error' as before until an attempt succeeds.
const CHANNELS=['stable','beta'];
const NOTES_MAX=1000,FLUSH_TIMEOUT=5000,PROGRESS_EVERY=400; // the interface hears about download progress at most this often (ms), and only when the percent moved
const count=value=>Number.isFinite(value)&&value>=0?Math.round(value):null;
const clean=value=>String(value?.message||value||'Update check failed.').replace(/\s+/g,' ').slice(0,200);
/** electron-updater hands over release notes as HTML or Markdown text (GitHub's release body), or a list of {version,note}. Shown as plain text only. */
function notesText(raw){
 let text='';
 if(typeof raw==='string')text=raw;else if(Array.isArray(raw))text=raw.map(item=>typeof item==='string'?item:String(item?.note||'')).join('\n');
 text=text.replace(/!?\[([^\]\n]*)\]\([^)\n]*\)/g,'$1').replace(/<\s*br\s*\/?>/gi,'\n').replace(/<\/(?:p|div|h[1-6]|ul|ol)\s*>/gi,'\n').replace(/<li[^>]*>/gi,'• ').replace(/<\/li\s*>/gi,'\n').replace(/<[^>]*>/g,'')
  .replace(/&nbsp;/g,' ').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&amp;/g,'&')
  .replace(/^\s*[-*]\s+/gm,'• ').replace(/^#{1,6}\s*/gm,'').replace(/\*\*|__/g,'').replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
 return text.length>NOTES_MAX?text.slice(0,NOTES_MAX-1).trimEnd()+'…':text;
}
/** Test-only stand-in for electron-updater: finds a fake newer version, "downloads" it, and records quitAndInstall instead of running an installer. */
function createStubUpdater({env,dir}){
 const stub=new EventEmitter(),logFile=path.join(dir,'update-stub-log.json');
 stub.log=event=>{let rows=[];try{rows=JSON.parse(fs.readFileSync(logFile,'utf8'));}catch{}rows.push({event,at:Date.now()});try{fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(logFile,JSON.stringify(rows));}catch{}};
 // With a local feed (ACIRA_UPDATE_FEED, handed over by setFeedURL; the channel document is JSON: version, releaseNotes, files with url, size and sha512)
 // it describes its files the way electron-updater does (updateInfoAndProvider, resolveFiles, a download cache), so Acira's own resumable download runs
 // exactly as with the real updater, and downloadUpdate() takes the cached file with electron-updater's own DownloadedUpdateHelper. A feed without
 // SHA-512s, or a file not in the cache, is downloaded here for real over HTTP (no resume), so the progress the interface shows is genuine.
 // Without a feed it fakes one step.
 let found=null,helper=null;
 const quiet={info(){},warn(){},error(){},debug(){}};
 stub.getOrCreateDownloadHelper=async()=>{if(!helper){const {DownloadedUpdateHelper}=require('electron-updater/out/DownloadedUpdateHelper');helper=new DownloadedUpdateHelper(path.join(dir,'update-cache'));}return helper;};
 async function fetchFile(){
  const base=stub.feed.replace(/\/*$/,'/'),file=found.files?.[0];
  if(!file)return;
  const response=await fetch(new URL(file.url,base)),total=Number(response.headers.get('content-length'))||Number(file.size)||0,reader=response.body.getReader(),began=Date.now();
  let transferred=0;
  for(;;){
   const {done,value}=await reader.read();if(done)break;
   transferred+=value.length;stub.emit('download-progress',{percent:total?transferred/total*100:0,transferred,total,bytesPerSecond:transferred/Math.max(.001,(Date.now()-began)/1000)});
  }
  stub.emit('update-downloaded',{version:found.version,releaseNotes:found.releaseNotes});
 }
 async function fromFeed(){
  const base=stub.feed.replace(/\/*$/,'/'),info=await(await fetch(new URL('latest.yml',base))).json();
  found=info;stub.updateInfoAndProvider={info,provider:{resolveFiles:doc=>(doc.files||[]).map(file=>({url:new URL(file.url,base),info:file}))}};
  stub.emit('update-available',{version:info.version,releaseNotes:info.releaseNotes,files:info.files});
  if(stub.autoDownload)await fetchFile();
 }
 stub.checkForUpdates=async()=>{
  const version=env.ACIRA_UPDATE_STUB_VERSION||'99.0.0';
  stub.emit('checking-for-update');
  if(stub.feed){fromFeed().catch(error=>stub.emit('error',error));return null;}
  setTimeout(()=>{stub.emit('update-available',{version});stub.emit('download-progress',{percent:50});},50);
  setTimeout(()=>stub.emit('update-downloaded',{version,releaseNotes:env.ACIRA_UPDATE_STUB_NOTES??'<ul><li>A calmer, faster start-up.</li><li>Update notices that stay out of your way.</li></ul>'}),150);
  return null;
 };
 stub.downloadUpdate=async()=>{
  if(!stub.feed||!found)return null;
  // like electron-updater's executeDownload: a whole file that an earlier download left in the cache (update-info.json, SHA-512 checked) is used as it is.
  // The real updater asks about the one file it chose (by architecture); this stand-in asks about the feed's file the cache says it holds, since
  // DownloadedUpdateHelper empties the cache when asked about any other.
  const cache=await stub.getOrCreateDownloadHelper();
  let held=null;try{held=JSON.parse(fs.readFileSync(cache.getUpdateInfoFile(),'utf8'));}catch{}
  const file=(found.files||[]).find(item=>item.sha512&&item.sha512===held?.sha512);
  const cached=file?await cache.getValidCachedUpdateFile({info:file},quiet).catch(()=>null):null;
  if(cached){stub.log({cachedDownload:path.basename(cached)});stub.emit('update-downloaded',{version:found.version,releaseNotes:found.releaseNotes,downloadedFile:cached});return [cached];}
  await fetchFile();return null;
 };
 stub.quitAndInstall=(silent,forceRun)=>stub.log({quitAndInstall:{silent,forceRun}});
 stub.setFeedURL=config=>{stub.feed=typeof config?.url==='string'?config.url:null;};
 return stub;
}
/** Whether this Mac takes the arm64 files, decided as electron-updater's MacUpdater decides it: Apple silicon, or an x64 build under Rosetta. */
function macArm64({exec=require('node:child_process').execFileSync,arch=process.arch}={}){
 let rosetta=false,arm=false;
 try{rosetta=exec('sysctl',['sysctl.proc_translated'],{encoding:'utf8'}).includes('sysctl.proc_translated: 1');}catch{}
 try{arm=exec('uname',['-a'],{encoding:'utf8'}).includes('ARM');}catch{}
 return arm||arch==='arm64'||rosetta;
}
/** The one file of the found update this computer downloads, the way electron-updater picks it (MacUpdater: the zip for this Mac's architecture;
 *  NsisUpdater: the exe), with the name electron-updater gives it in its cache. Null when the updater does not describe its files this way, or the
 *  feed gives no SHA-512 and size for it: then electron-updater downloads by itself, as before. */
function updateFile(updater,{platform,arm64}){
 const current=updater?.updateInfoAndProvider;
 if(!current?.info||typeof current.provider?.resolveFiles!=='function')return null;
 try{
  const {findFile}=require('electron-updater/out/providers/Provider'),extension=platform==='darwin'?'zip':'exe';
  let files=current.provider.resolveFiles(current.info);
  if(platform==='darwin')files=require('electron-updater/out/MacUpdater').MacUpdater.filterFilesForArch(files,arm64());
  const file=platform==='darwin'?findFile(files,'zip',['pkg','dmg']):findFile(files,'exe');
  const size=Number(file?.info?.size),sha512=file?.info?.sha512;
  if(!file?.url||typeof sha512!=='string'||!sha512||!Number.isSafeInteger(size)||size<=0)return null;
  const pathname=decodeURIComponent(file.url.pathname),name=pathname.toLowerCase().endsWith('.'+extension)?path.basename(pathname):path.basename(String(file.info.url||''));
  if(!name)return null;
  return {version:String(current.info.version||''),url:file.url.href,sha512,size,name,isAdminRightsRequired:file.info.isAdminRightsRequired===true};
 }catch{return null;}
}
/** The network for Acira's own update download: electron-updater's own session (no cache, the system's proxy settings), or plain fetch outside Electron. */
function updaterFetch(){
 try{const {session}=require('electron');const own=session.fromPartition('electron-updater',{cache:false});return (url,init)=>own.fetch(url,init);}catch{return globalThis.fetch;}
}
function hasInstalledWindowsUninstaller(directory,qa=false){const names=qa?['Uninstall Acira Browser QA.exe','Uninstall AciraBrowserQA.exe']:['Uninstall Acira Browser.exe','Uninstall AciraBrowser.exe'];return names.some(name=>fs.existsSync(path.join(directory,name)));}
function createAppUpdater({app,onChange=()=>{},beforeInstall=async()=>{},autoUpdater,dir=app.getPath('userData'),platform=process.platform,env=process.env,now=Date.now,schedule=setTimeout,cancel=clearTimeout,every=setInterval,network=null,uninstallerPresent=()=>hasInstalledWindowsUninstaller(path.dirname(process.execPath),qaBuild),qaBuild=require('../build-identity.cjs').qa,macAvailability=()=>require('./mac-app-update.cjs').macUpdateAvailability({app}),fetch:updateFetch=null,macArm64:arm64Mac=null}){
 const file=path.join(dir,'updater.json');
 const testing=Boolean(env.ACIRA_UPDATE_TEST),stubbed=testing&&Boolean(env.ACIRA_UPDATE_STUB);
 if(stubbed&&env.ACIRA_UPDATE_TEST_PLATFORM==='win32')platform='win32'; // test-only: the stand-in updater takes the Windows route (setup, differential) on any computer
 const version=testing&&env.ACIRA_UPDATE_TEST_VERSION?String(env.ACIRA_UPDATE_TEST_VERSION):app.getVersion();
 let autoDownload=true,channel=/-/.test(String(version))?'beta':'stable'; // a pre-release build follows pre-releases until the person chooses Stable
 let saved={};try{saved=JSON.parse(fs.readFileSync(file,'utf8'));}catch{}
 autoDownload=saved.autoDownload!==false;if(CHANNELS.includes(saved.channel))channel=saved.channel;
 // The notes of the update that was downloaded last, kept with its version so they are still there after the restart that installs it.
 let pending=saved.pending&&typeof saved.pending.version==='string'?{version:saved.pending.version,notes:String(saved.pending.notes||'')}:null;
 // First launch on a new version: a note, once. A file without lastRunVersion (fresh install, or a build from before this existed) is not an update.
 const lastRun=typeof saved.lastRunVersion==='string'?saved.lastRunVersion:null;
 const whatsNew=lastRun&&lastRun!==version?{version,notes:pending?.version===version?pending.notes:''}:null;
 if(pending&&pending.version===version)pending=null; // spent: it described the version that is now running
 // Acira's own download of an update file, running or paused (its bytes are in <electron-updater's cache>/acira-partial, update-download.cjs). It belongs
 // to the version that started it: a launch on any other version (the update installed, or another build) drops it with its bytes.
 const heldFrom=raw=>raw&&typeof raw==='object'&&typeof raw.version==='string'&&typeof raw.sha512==='string'&&raw.sha512&&Number.isSafeInteger(raw.size)&&raw.size>0
  ?{version:raw.version,from:String(raw.from||''),sha512:raw.sha512,size:raw.size,notes:String(raw.notes||'').slice(0,NOTES_MAX),paused:raw.paused===true,dir:fetched.ownDir(raw.dir)?raw.dir:null}:null;
 let held=heldFrom(saved.download);
 if(held&&(held.from!==version||held.version===version)){fetched.discard(held.dir);held=null;}
 const persist=()=>{try{fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(file,JSON.stringify({autoDownload,channel,lastRunVersion:version,...(pending?{pending}:{}),...(held?{download:held}:{})}),{mode:0o600});}catch{throw new Error('The update preference could not be saved.');}};
 if(lastRun!==version||(saved.pending&&!pending)||(saved.download&&!held))try{persist();}catch{} // remember this version as the one that ran, so the note never shows for it again
 const installed=platform==='win32'&&app.isPackaged&&uninstallerPresent();
 // a QA build (its own identity, desktop/build-identity.cjs) never updates itself: the update would be the real Acira's installer
 const unsupported=stubbed?null:!app.isPackaged?'Updates apply to the installed app, not a development run.':qaBuild&&!env.ACIRA_UPDATE_TEST?'Updates are off in QA builds.':env.ACIRA_BROWSER_TEST_DATA&&!env.ACIRA_UPDATE_TEST?'Updates are off while running with a test profile.':platform==='darwin'?macAvailability():platform!=='win32'?'Automatic updates are unavailable on this platform.':!installed?'This is a portable copy. Download new versions from the releases page.':null;
 // transferred/total (bytes) and speed (bytes a second) describe the download in progress; notes are the found version's plain-text release notes (from the
 // feed, so they can be read while it downloads). pausable: Acira's own download is running (or paused), so the interface offers pause and resume.
 const state={status:unsupported?'unsupported':'idle',version,available:null,progress:null,transferred:null,total:null,speed:null,notes:'',lastChecked:null,error:null,pausable:false};
 const percentOf=(done,total)=>total?Math.max(0,Math.min(100,Math.round(done/total*100))):0;
 // Paused when Acira last quit: it starts paused, with the bytes it has, and looks for nothing until Resume.
 if(held?.paused&&!unsupported){const here=held.dir?fetched.progressOf(held.dir,held):{transferred:0,total:held.size};Object.assign(state,{status:'paused',available:held.version,total:here.total,transferred:here.transferred,progress:percentOf(here.transferred,here.total),notes:held.notes,pausable:true});}
 let updater=null,started=false,installing=false,promptedFor=null,welcomed=false,shownPercent=-1,shownAt=0,failedRound=false;
 // round: the download being run (a pause or a newer start makes every older one stop where it is); resuming: the person asked for this download
 // (Resume), so the look that has to come first (after a relaunch) keeps showing it as downloading and starts it whatever the automatic setting is.
 let round=0,job=null,resuming=false,mismatched=false,net=updateFetch,armMac=null;
 const arm64=()=>typeof arm64Mac==='function'?arm64Mac():testing&&env.ACIRA_UPDATE_TEST_ARCH?env.ACIRA_UPDATE_TEST_ARCH==='arm64':(armMac??=macArm64());
 const retry=createRetry({run:()=>{void check();},schedule,cancel,now,watch:network});
 // electron-updater both emits 'error' and rejects the check: one failure per attempt
 const failed=()=>{if(failedRound||unsupported)return;failedRound=true;retry.failed();};
 // The one question ("Install now / Later / Read more") is asked once for each downloaded version; Later never brings it back, the pill does.
 const wantsPrompt=()=>state.status==='ready'&&state.available!==null&&promptedFor!==state.available;
 // The first launch on a new version: its notes, shown once in a popup (only when the feed had notes; without them a quiet toast says it, see main announceUpdate).
 const wantsWelcome=()=>Boolean(whatsNew?.notes)&&!welcomed;
 const status=()=>({...state,autoDownload,channel,supported:!unsupported,reason:unsupported,prompt:wantsPrompt(),welcome:wantsWelcome(),whatsNew:whatsNew?{version:whatsNew.version,notes:whatsNew.notes}:null});
 const changed=()=>{try{onChange(status());}catch{/* the interface refreshes on its next look */}};
 function setup(){
  if(updater||unsupported)return updater;
  updater=stubbed?createStubUpdater({env,dir}):autoUpdater||require('electron-updater').autoUpdater;
  // Acira downloads the file itself (startDownload: resumable, pausable); electron-updater finds updates, then takes the finished file from its cache.
  updater.autoDownload=false;updater.autoInstallOnAppQuit=true;updater.allowPrerelease=channel==='beta';updater.channel=channel==='beta'?'beta':'latest';updater.allowDowngrade=false; /* each release carries latest.yml (Stable) and beta.yml (Beta); setting a channel turns allowDowngrade on, so it is reset */ updater.logger=null;if(env.ACIRA_UPDATE_TEST&&env.ACIRA_UPDATE_FEED)updater.setFeedURL({provider:'generic',url:env.ACIRA_UPDATE_FEED});// test-only: points the installed build at a local feed
  updater.on('checking-for-update',()=>{failedRound=false;if(!resuming)state.status='checking';state.error=null;changed();});
  // a found update counts as success only when nothing is downloaded automatically: a download that keeps failing must climb the ladder, not restart it
  updater.on('update-available',info=>{
   if(info?.version&&info.version!==state.available){state.progress=null;state.transferred=state.total=state.speed=null;}
   state.available=info?.version||null;state.notes=notesText(info?.releaseNotes);shownPercent=-1;
   // paused while this look was under way: it stays paused
   const paused=state.status==='paused',go=!paused&&(autoDownload||resuming);resuming=false;
   state.status=paused?'paused':go?'downloading':'available';if(!go)retry.succeeded();changed();
   if(go)void startDownload();
  });
  updater.on('update-not-available',()=>{retry.succeeded();resuming=false;if(held){fetched.discard(held.dir);held=null;try{persist();}catch{}}state.status='current';state.available=null;state.progress=state.transferred=state.total=state.speed=null;state.notes='';state.pausable=false;state.lastChecked=now();changed();});
  // electron-updater's own download, when it downloads by itself (see startDownload)
  updater.on('download-progress',progress=>progressed({percent:progress?.percent,transferred:progress?.transferred,total:progress?.total,bytesPerSecond:progress?.bytesPerSecond}));
  updater.on('update-downloaded',info=>{
   retry.succeeded();state.status='ready';state.available=info?.version||state.available;state.progress=100;state.speed=null;state.pausable=false;state.lastChecked=now();state.notes=notesText(info?.releaseNotes)||state.notes;
   if(held){held=null;try{persist();}catch{}}
   // keep the notes with the version, so the "Acira updated" note can show them after the restart
   if(state.available){pending={version:state.available,notes:state.notes};try{persist();}catch{}}
   changed();
  });
  updater.on('error',error=>{resuming=false;if(state.status==='paused')return;/* a look that was under way when the person paused: paused stays paused */state.status='error';state.error=clean(error);state.speed=null;state.lastChecked=now();failed();changed();});
  return updater;
 }
 // Progress is real (bytes counted as they arrive); the interface hears of it when the percent moves, never faster than PROGRESS_EVERY.
 function progressed(progress){
  if(state.status==='paused'||state.status==='ready')return;
  const total=count(progress?.total),transferred=count(progress?.transferred);
  state.status='downloading';state.progress=Math.max(0,Math.min(100,Math.round(Number.isFinite(progress?.percent)?progress.percent:total?transferred/total*100:0)));
  state.transferred=transferred;state.total=total;state.speed=count(progress?.bytesPerSecond);
  const at=now();if(state.progress!==shownPercent&&(at-shownAt>=PROGRESS_EVERY||state.progress===100||shownPercent<0)){shownPercent=state.progress;shownAt=at;changed();}
 }
 const cacheOf=async()=>{try{const helper=await updater.getOrCreateDownloadHelper?.();return helper?.cacheDir&&helper.cacheDirForPendingUpdate&&typeof helper.clear==='function'?{cache:helper.cacheDir,dir:path.join(helper.cacheDir,fetched.DIR_NAME),pending:helper.cacheDirForPendingUpdate,helper}:null;}catch{return null;}};
 const requestHeaders=()=>{try{const provider=updater.updateInfoAndProvider?.provider;return provider&&typeof updater.computeRequestHeaders==='function'?{...updater.computeRequestHeaders(provider)}:{accept:'*/*'};}catch{return {accept:'*/*'};}};
 // Windows: only what changed since the installed version's setup. The NSIS installer keeps a copy of itself in electron-updater's cache
 // (installer.exe), and the blockmap published with each setup says which of its blocks the new one shares. The installed version's blockmap is looked
 // for where electron-updater keeps it (current.blockmap, left by the download that brought this version, checked against installer.exe's size), then
 // in the feed's note of earlier versions' blockmaps (previousBlockMaps, written by the publisher), then where electron-updater guesses it (the new
 // file's URL with the version swapped, which misses Acira's commit-tagged releases). Any piece missing, or a plan that saves little, and the whole
 // setup downloads instead. electron-updater's own differential is not used: it asks for every changed range in one multi-range request, which
 // GitHub answers with 501, and a cancelled one starts again.
 let wholeFor=null,newMap=null; // the file whose differential could not finish in this run (the whole of it from now on); the new blockmap fetched in this run
 const blockMapUrl=url=>{const file=new URL(url);return new URL(file.pathname+'.blockmap',file).href;};
 async function fetchBlockMap(url){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);timer.unref?.();
  try{
   net??=updaterFetch();
   const response=await net(url,{headers:requestHeaders(),signal:controller.signal,redirect:'follow'});
   if(!response.ok)throw new Error('HTTP '+response.status);
   const raw=Buffer.from(await response.arrayBuffer());
   if(!raw.length||raw.length>fetched.MAP_MAX)throw new Error('Not a blockmap.');
   fetched.readBlockMap(raw);return raw;
  }finally{clearTimeout(timer);}
 }
 /** {plan, oldFile, newRaw} for a differential download, {newRaw} for the whole setup (its blockmap still goes into the cache for next time). */
 async function differential(target,where){
  const oldFile=path.join(where.cache,'installer.exe');
  let oldSize=0;try{oldSize=fs.statSync(oldFile).size;}catch{}
  const maps=oldSize?fetched.loadMaps(where.dir,{sha512:target.sha512,oldSize}):null;
  const newRaw=maps?.newRaw||(newMap?.sha512===target.sha512?newMap.raw:await fetchBlockMap(blockMapUrl(target.url)).catch(()=>null));
  if(newRaw)newMap={sha512:target.sha512,raw:newRaw};
  if(!oldSize||!newRaw||wholeFor===target.sha512)return {newRaw};
  let oldRaw=maps?.oldRaw||null;
  if(!oldRaw){
   const fits=raw=>{try{return Boolean(raw)&&fetched.blockMapSize(fetched.readBlockMap(raw))===oldSize;}catch{return false;}};
   const hint=[].concat(updater.updateInfoAndProvider?.info?.previousBlockMaps||[]).find(item=>item?.version===version&&typeof item.url==='string');
   const guess=()=>updater.updateInfoAndProvider.provider.getBlockMapFiles(new URL(target.url),version,target.version)[0].href;
   for(const look of [()=>fs.readFileSync(path.join(where.cache,'current.blockmap')),()=>hint&&fetchBlockMap(new URL(hint.url,updater.updateInfoAndProvider.provider.baseUrl||target.url).href),()=>fetchBlockMap(guess())]){
    const raw=await Promise.resolve().then(look).catch(()=>null);
    if(fits(raw)){oldRaw=raw;break;}
   }
   if(!oldRaw)return {newRaw};
   fetched.saveMaps(where.dir,{sha512:target.sha512,oldSize,newRaw,oldRaw});
  }
  try{
   const plan=fetched.diffPlan(fetched.readBlockMap(oldRaw),fetched.readBlockMap(newRaw),{size:target.size,oldSize});
   return fetched.downloaded(plan)<target.size*.8?{plan,oldFile,newRaw}:{newRaw}; // a plan that fetches most of the file anyway is not worth its copying
  }catch{return {newRaw};}
 }
 // electron-updater downloads by itself, as it did before Acira's own download (the file could not be described: no pause, a stop starts again from zero)
 const updaterDownloads=()=>{state.pausable=false;if(typeof updater.downloadUpdate==='function')updater.downloadUpdate().catch(()=>{/* electron-updater reports it as 'error' */});};
 /** Acira's own download of the file electron-updater found: resumable (update-download.cjs), checked against the feed's SHA-512, then handed to
  *  electron-updater's cache, from where its downloadUpdate() takes it ('update-downloaded'). A pause stops it where it is (round). */
 async function startDownload(){
  const id=++round,target=updateFile(updater,{platform,arm64});
  if(!target){updaterDownloads();return;}
  if(held&&held.sha512!==target.sha512){fetched.discard(held.dir);held=null;} // the feed moved on: the old bytes go
  held={version:target.version||state.available||'',from:version,sha512:target.sha512,size:target.size,notes:state.notes,paused:false,dir:held?.dir||null};
  state.pausable=true;
  const where=await cacheOf();
  if(id!==round)return;
  if(!where){held=null;try{persist();}catch{}updaterDownloads();return;}
  held.dir=where.dir;try{persist();}catch{}
  try{
   // a launch that downloaded it whole and quit before electron-updater took it: nothing to download
   if(!fetched.handedOver({pendingDir:where.pending,sha512:target.sha512,size:target.size})){
    const diff=platform==='win32'?await differential(target,where).catch(()=>null):null;
    if(id!==round)return;
    const controller=new AbortController();job={id,controller};
    net??=updaterFetch();
    const run=way=>fetched.download({url:target.url,sha512:target.sha512,size:target.size,dir:where.dir,plan:way?.plan||null,oldFile:way?.oldFile||null,headers:requestHeaders(),fetch:net,signal:controller.signal,now,onProgress:progressed});
    let result;
    try{result=await run(diff?.plan?diff:null);}
    catch(error){
     // the differential could not finish (a changed run the server would not send as asked, an old setup that does not match its blockmap): the
     // whole setup, from the bytes already here (a damaged result was deleted, so then from the start)
     if(!diff?.plan||id!==round||!['ERR_UPDATE_RANGE','ERR_CHECKSUM_MISMATCH'].includes(error?.code))throw error;
     wholeFor=target.sha512;result=await run(null);
    }
    if(id!==round||result.paused)return;
    state.pausable=false;state.speed=null;changed();
    await fetched.handOver({file:result.file,pendingDir:where.pending,name:target.name,sha512:target.sha512,isAdminRightsRequired:target.isAdminRightsRequired,blockMap:diff?.newRaw||null,helper:where.helper});
   }
   if(id!==round)return;
   held=null;state.pausable=false;try{persist();}catch{}
   await updater.downloadUpdate(); // finds the file in its cache, checks its SHA-512 again, then 'update-downloaded'
  }catch(error){
   if(id!==round)return;
   // a damaged file was deleted: it starts again at once, once; after that the retries below
   if(error?.code==='ERR_CHECKSUM_MISMATCH'&&!mismatched){mismatched=true;void startDownload();return;}
   state.status='error';state.error=clean(error);state.speed=null;state.lastChecked=now();failed();changed();
  }finally{if(job?.id===id)job=null;}
 }
 async function check(){
  if(unsupported)return status();
  if(['checking','downloading','paused'].includes(state.status))return status(); // paused: off the network for updates until Resume
  // Mac, 'ready': a downloaded update waits for Install now. Checking again hands it to Squirrel.Mac a second time, which either fails (status 'error':
  // the pill and Install now disappear) or stages a second install under the first. The first check after the restart finds anything newer.
  if(platform==='darwin'&&state.status==='ready')return status();
  return look();
 }
 async function look(){
  failedRound=false;
  try{setup();await updater.checkForUpdates();}catch(error){resuming=false;state.status='error';state.error=clean(error);state.lastChecked=now();failed();changed();}
  return status();
 }
 // Settings' Download, when updates are not downloaded automatically
 async function download(){if(unsupported||state.status!=='available')return status();failedRound=false;state.status='downloading';state.error=null;changed();setup();void startDownload();return status();}
 /** Pause: the download stops where it is and keeps its bytes. The pause is kept in updater.json: a quit and relaunch starts paused, and nothing is
  *  looked for or downloaded until Resume. Only Acira's own download pauses (pausable); electron-updater's could only start again from zero. */
 function pause(){
  if(unsupported||state.status!=='downloading'||!state.pausable)return status();
  round++;job?.controller.abort();job=null;resuming=false;
  state.status='paused';state.speed=null;
  if(held){held.paused=true;try{persist();}catch{}}
  changed();return status();
 }
 /** Resume: on from the last byte. In the same run electron-updater still knows the file; after a relaunch it looks first (the feed may have moved
  *  on, and then the newer file is downloaded instead), keeping the download on screen while it looks. */
 function resume(){
  if(unsupported||state.status!=='paused')return status();
  if(held){held.paused=false;try{persist();}catch{}}
  state.status='downloading';state.error=null;shownPercent=-1;changed();
  setup();
  if(updateFile(updater,{platform,arm64})?.sha512===held?.sha512&&held)void startDownload();
  else{resuming=true;void look();}
  return status();
 }
 function setAutoDownload(value){
  if(typeof value!=='boolean')throw new Error('Choose on or off.');
  autoDownload=value;persist();
  return status();
 }
 // Stable follows full releases only; Beta also follows pre-releases. Switching never downgrades (allowDowngrade is off).
 function setChannel(value){
  if(!CHANNELS.includes(value))throw new Error('Choose Stable or Beta.');
  // paused: the bytes are the other channel's file, so they go with the pause (Resume would go on with it); the next look finds this channel's
  const wasPaused=state.status==='paused';
  if(wasPaused){fetched.discard(held?.dir);held=null;Object.assign(state,{progress:null,transferred:null,total:null,speed:null,notes:'',pausable:false});}
  channel=value;persist();if(wasPaused||['available','current','error'].includes(state.status)){state.available=null;state.status='idle';}
  if(wasPaused)changed();
  if(updater){updater.allowPrerelease=channel==='beta';updater.channel=channel==='beta'?'beta':'latest';updater.allowDowngrade=false;}return status();
 }
 /** Restart to update: the open tabs and windows are saved first (beforeInstall: the same save a normal quit does), then quitAndInstall, which quits the ordinary graceful way. */
 async function install(){
  if(unsupported||state.status!=='ready')throw new Error('No downloaded update is waiting.');
  if(installing)return {...status(),installing:true};
  installing=true;
  try{
   let timer;
   // a failed or slow save must not trap the person in the old version: it is waited for, but only so long
   await Promise.race([Promise.resolve().then(beforeInstall),new Promise(resolve=>{timer=setTimeout(resolve,FLUSH_TIMEOUT);timer.unref?.();})]).catch(()=>{}).finally(()=>clearTimeout(timer));
   setup().log?.('session-flushed');
   // Windows: silent (/S), so no setup window and none of its questions ("Update to X / Open / Cancel" is asked only when not silent), and
   // --force-run, so the setup opens Acira again when it is done. Squirrel.Mac ignores both arguments.
   updater.quitAndInstall(true,true);
  }catch(error){installing=false;throw error;}
  return {...status(),installing:true};
 }
 /** Claims the one question for the downloaded version. The first window to ask gets `claimed: true` and shows it; every other window (and every later look) gets false, so it is never asked twice. */
 function claimPrompt(){
  if(unsupported||!wantsPrompt())return {...status(),claimed:false};
  promptedFor=state.available;changed();
  return {...status(),claimed:true};
 }
 /** Claims the "what's new" popup for this run. The first window to ask gets `claimed: true` and shows it; the version was recorded as having run when the
  *  app started, so no later launch has it, and this run never shows it twice. */
 function claimWelcome(){
  if(!wantsWelcome())return {...status(),claimed:false};
  welcomed=true;changed();
  return {...status(),claimed:true};
 }
 /** The note for the first launch on a new version (null when there is none). The version is already recorded as having run, so it is never offered again. */
 const whatsNewInfo=()=>whatsNew;
 function start(){if(started||unsupported)return;started=true;const run=()=>{void check();};const first=schedule(run,stubbed?1500:CHECK_DELAY);first?.unref?.();const loop=every(run,CHECK_EVERY);loop?.unref?.();}
 return {status,check,download,pause,resume,setAutoDownload,setChannel,install,claimPrompt,claimWelcome,start,whatsNewInfo};
}
module.exports={createAppUpdater,createStubUpdater,notesText,updateFile,macArm64,CHECK_EVERY,CHECK_DELAY,CHANNELS};
