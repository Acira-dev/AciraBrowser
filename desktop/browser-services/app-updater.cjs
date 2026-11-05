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
//   - ignored, the update still installs when Acira quits (autoInstallOnAppQuit), unless the feed has pulled it since (see pullDownloaded; Windows also
//     asks at quit, see atQuit). A Mac's update is with Squirrel.Mac from the download on, which applies it at the next quit whatever the feed says later;
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
// A build can be pulled from the feed after this computer downloaded it (a halt: stagingPercentage 0; a rollback to an older build; this install no
// longer in a staged rollout). Windows asks the feed again while an update waits (READY_RECHECK), at Install now (waiting at most ASK_WITHIN for an
// answer), and when Acira quits with an update waiting and the last answer is older than FRESH_FOR (QUIT_ASK at most, see atQuit). Both platforms ask
// once more before a file becomes installable when the feed's last answer is older than FRESH_FOR (a long download, a pause). A check that gets no
// answer at all is given up after CHECK_WITHIN.
const READY_RECHECK=30*60*1000,ASK_WITHIN=8*1000,FRESH_FOR=5*60*1000,QUIT_ASK=1200,CHECK_WITHIN=60*1000;
const RESUMES=2; // a download that goes quiet or whose connection drops goes on at once from the byte it had, this many times, before it counts as failed
const count=value=>Number.isFinite(value)&&value>=0?Math.round(value):null;
const clean=value=>String(value?.message||value||'Update check failed.').replace(/\s+/g,' ').slice(0,200);
/** True when version a is lower than b in semver order, as electron-updater compares them (a release is above its pre-releases, numeric
 *  pre-release fields compare as numbers: beta.9 < beta.10); false when either is not a version. */
function lowerThan(a,b){
 const parse=value=>{const m=/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(String(value??'').trim());return m?{core:[+m[1],+m[2],+m[3]],pre:m[4]?m[4].split('.'):[]}:null;};
 const x=parse(a),y=parse(b);if(!x||!y)return false;
 for(let i=0;i<3;i++)if(x.core[i]!==y.core[i])return x.core[i]<y.core[i];
 if(!x.pre.length||!y.pre.length)return x.pre.length>0&&!y.pre.length;
 for(let i=0;i<Math.max(x.pre.length,y.pre.length);i++){
  const p=x.pre[i],q=y.pre[i];
  if(p===undefined)return true;if(q===undefined)return false;if(p===q)continue;
  const pn=/^\d+$/.test(p),qn=/^\d+$/.test(q);
  return pn&&qn?Number(p)<Number(q):pn!==qn?pn:p<q; // numeric fields sort below alphanumeric ones
 }
 return false;
}
/** A connection that went quiet or dropped, not a refusal, a wrong file or a damaged one: worth going on from the same byte at once. */
const dropped=error=>['ERR_UPDATE_STALLED','ERR_UPDATE_SHORT'].includes(error?.code)||!error?.code&&(error instanceof TypeError&&/fetch failed|terminated|network/i.test(error.message)||/net::ERR_(CONNECTION|NETWORK|INTERNET|TIMED_OUT|EMPTY_RESPONSE)/.test(String(error?.message||'')));
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
function createStubUpdater({env,dir,platform=process.platform,app=null}){
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
 // With a feed, NsisUpdater's quit handler is stood in for: the setup runs when Acira quits if autoInstallOnAppQuit is still on by then ('installOnQuit').
 let onQuit=false;
 const downloaded=info=>{
  stub.emit('update-downloaded',info);
  if(!stub.feed||platform==='darwin')return;
  if(!onQuit&&stub.autoInstallOnAppQuit&&typeof app?.once==='function'){onQuit=true;app.once('quit',()=>{if(!stub.quitAndInstallCalled&&stub.autoInstallOnAppQuit)stub.log({installOnQuit:found?.version});});}
 };
 async function fetchFile(){
  const base=stub.feed.replace(/\/*$/,'/'),file=found.files?.[0];
  if(!file)return;
  const response=await fetch(new URL(file.url,base)),total=Number(response.headers.get('content-length'))||Number(file.size)||0,reader=response.body.getReader(),began=Date.now();
  let transferred=0;
  for(;;){
   const {done,value}=await reader.read();if(done)break;
   transferred+=value.length;stub.emit('download-progress',{percent:total?transferred/total*100:0,transferred,total,bytesPerSecond:transferred/Math.max(.001,(Date.now()-began)/1000)});
  }
  downloaded({version:found.version,releaseNotes:found.releaseNotes});
 }
 async function fromFeed(){
  const base=stub.feed.replace(/\/*$/,'/'),info=await(await fetch(new URL('latest.yml',base))).json();
  // a halt (stagingPercentage 0) is "nothing for this install", as electron-updater's own check says it, so a live rig can rehearse a pulled build
  if(Number(info.stagingPercentage)===0){stub.emit('update-not-available',{version:info.version});return;}
  found=info;stub.updateInfoAndProvider={info,provider:{resolveFiles:doc=>(doc.files||[]).map(file=>({url:new URL(file.url,base),info:file}))}};
  stub.emit('update-available',{version:info.version,releaseNotes:info.releaseNotes,files:info.files});
  if(stub.autoDownload)await fetchFile();
 }
 stub.checkForUpdates=async()=>{
  const version=env.ACIRA_UPDATE_STUB_VERSION||'99.0.0';
  stub.emit('checking-for-update');
  // like electron-updater, the answer arrives before the check returns
  if(stub.feed){await fromFeed().catch(error=>stub.emit('error',error));return null;}
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
  if(cached){stub.log({cachedDownload:path.basename(cached)});downloaded({version:found.version,releaseNotes:found.releaseNotes,downloadedFile:cached});return [cached];}
  await fetchFile();return null;
 };
 stub.quitAndInstall=(silent,forceRun)=>{
  stub.quitAndInstallCalled=true;stub.log({quitAndInstall:{silent,forceRun}});
 };
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
  const {findFile}=require('electron-updater/out/providers/Provider'),extension=platform==='darwin'?'zip':platform==='linux'?'AppImage':'exe';
  let files=current.provider.resolveFiles(current.info);
  if(platform==='darwin')files=require('electron-updater/out/MacUpdater').MacUpdater.filterFilesForArch(files,arm64());
  const file=platform==='darwin'?findFile(files,'zip',['pkg','dmg']):findFile(files,platform==='linux'?'AppImage':'exe');
  const size=Number(file?.info?.size),sha512=file?.info?.sha512;
  if(!file?.url||typeof sha512!=='string'||!sha512||!Number.isSafeInteger(size)||size<=0)return null;
  const pathname=decodeURIComponent(file.url.pathname),name=pathname.toLowerCase().endsWith('.'+extension.toLowerCase())?path.basename(pathname):path.basename(String(file.info.url||''));
  if(!name)return null;
  return {version:String(current.info.version||''),url:file.url.href,sha512,size,name,isAdminRightsRequired:file.info.isAdminRightsRequired===true};
 }catch{return null;}
}
/** The network for Acira's own update download: electron-updater's own session (no cache; main points its proxy at the active profile's route before
 *  every check and download, see `route` and update-route.cjs), or plain fetch outside Electron. */
function updaterFetch(){
 try{const {session}=require('electron');const own=session.fromPartition('electron-updater',{cache:false});return (url,init)=>own.fetch(url,init);}catch{return globalThis.fetch;}
}
/** Closes every connection of electron-updater's own session (its check, and Acira's download, see updaterFetch); outside Electron, nothing. */
function closeUpdaterConnections(){try{const {session}=require('electron');void session.fromPartition('electron-updater',{cache:false}).closeAllConnections?.()?.catch?.(()=>{});}catch{}}
function hasInstalledWindowsUninstaller(directory,qa=false){const names=qa?['Uninstall Acira Browser QA.exe','Uninstall AciraBrowserQA.exe']:['Uninstall Acira Browser.exe','Uninstall AciraBrowser.exe'];return names.some(name=>fs.existsSync(path.join(directory,name)));}
function createAppUpdater({app,onChange=()=>{},beforeInstall=async()=>{},autoUpdater,dir=app.getPath('userData'),platform=process.platform,env=process.env,now=Date.now,schedule=setTimeout,cancel=clearTimeout,every=setInterval,network=null,uninstallerPresent=()=>hasInstalledWindowsUninstaller(path.dirname(process.execPath),qaBuild),qaBuild=require('../build-identity.cjs').qa,macAvailability=()=>require('./mac-app-update.cjs').macUpdateAvailability({app}),fetch:updateFetch=null,macArm64:arm64Mac=null,stall=fetched.STALL,askWithin=ASK_WITHIN,freshFor=FRESH_FOR,quitAsk=QUIT_ASK,checkWithin=CHECK_WITHIN,closeConnections=closeUpdaterConnections,route=null,updateSignature=null}){
 const file=path.join(dir,'updater.json');
 const testing=Boolean(env.ACIRA_UPDATE_TEST),stubbed=testing&&Boolean(env.ACIRA_UPDATE_STUB);
 if(stubbed&&env.ACIRA_UPDATE_TEST_PLATFORM==='win32')platform='win32'; // test-only: the stand-in updater takes the Windows route (setup, differential) on any computer
 if(testing&&/^\d+$/.test(String(env.ACIRA_UPDATE_TEST_FRESH_MS||'')))freshFor=Number(env.ACIRA_UPDATE_TEST_FRESH_MS); // test-only: a live rig need not wait 5 minutes for a stale answer
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
 const unsupported=stubbed?null:!app.isPackaged?'Updates apply to the installed app, not a development run.':qaBuild&&!env.ACIRA_UPDATE_TEST?'Updates are off in QA builds.':env.ACIRA_BROWSER_TEST_DATA&&!env.ACIRA_UPDATE_TEST?'Updates are off while running with a test profile.':platform==='darwin'?macAvailability():platform==='linux'?(env.APPIMAGE?null:'Automatic updates require the AppImage installation.'):platform!=='win32'?'Automatic updates are unavailable on this platform.':!installed?'This is a portable copy. Download new versions from the releases page.':null;
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
 // resumed: Resume was pressed and no new byte has come yet ({from}: the bytes counted at the first progress after it); a failure then goes back to
 // paused, saying the connection failed, instead of hiding the download. quitStep: what atQuit does for this quit (once). installHooks: the listeners
 // MacUpdater's quitAndInstall left on Squirrel.Mac for Install now, removed if that install fails (one left behind restarted Acira at a later hand-over).
 let resumed=null,quitStep=null,installHooks=null;
 // refused: the files (by SHA-512) found not signed by the application owner in this run, with why; never downloaded again in this run (see refuse).
 const refused=new Map();
 // background: the newer version downloaded quietly while a whole one is 'ready' (which stays offered until the newer one is whole). handing: the newer
 // file is being handed to electron-updater (Install now waits for it). looking: a check is under way (a failed look leaves a whole update offered).
 // asking: the feed is asked whether a version is still offered (ask()); its answer is not acted on the usual way. answeredAt: when the feed last
 // answered. watchdog: electron-updater's own download, given up when quiet.
 let background=null,handing=null,looking=false,asking=null,answeredAt=-Infinity,watchdog=null;
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
  updater=stubbed?createStubUpdater({env,dir,platform,app}):autoUpdater||require('electron-updater').autoUpdater;
  // A signed build's updates are checked for Acira's signature by Acira's own helper: electron-updater's own check would start a script host.
  if(platform==='win32'&&!stubbed&&'verifyUpdateCodeSignature' in updater)updater.verifyUpdateCodeSignature=updateSignature||require('../windows-helper.cjs').updateSignatureCheck({packaged:app?.isPackaged});
  // Acira downloads the file itself (startDownload: resumable, pausable); electron-updater finds updates, then takes the finished file from its cache.
  updater.autoDownload=false;updater.autoInstallOnAppQuit=true;updater.allowPrerelease=channel==='beta';updater.channel=channel==='beta'?'beta':'latest';updater.allowDowngrade=false; /* each release carries latest.yml (Stable) and beta.yml (Beta); setting a channel turns allowDowngrade on, so it is reset */ updater.logger=null;if(env.ACIRA_UPDATE_TEST&&env.ACIRA_UPDATE_FEED)updater.setFeedURL({provider:'generic',url:env.ACIRA_UPDATE_FEED});// test-only: points the installed build at a local feed
  // A whole update ('ready') stays what the person is offered while Acira looks again (Windows checks while it waits): the same version found again,
  // a failed look (offline) and the look itself change nothing on screen (no flicker to "downloading" or back to "available"). A newer version is
  // downloaded quietly behind it and replaces it only once whole; until then Install now and install-on-quit take the whole one. It is pulled
  // (pullDownloaded) only by the feed itself: that version halted or out of this install's rollout, or the feed back on an older build. A newer
  // build this install is not offered (outside its staged rollout, or halted) pulls nothing.
  // (paused: the person paused while this look was on its way; it stays paused)
  updater.on('checking-for-update',()=>{if(asking)return;failedRound=false;if(state.status==='ready'||state.status==='paused')return;if(!resuming)state.status='checking';state.error=null;changed();});
  // a found update counts as success only when nothing is downloaded automatically: a download that keeps failing must climb the ladder, not restart it
  updater.on('update-available',info=>{
   if(asking)return asking.finish(!info?.version||info.version===asking.version?'same':lowerThan(info.version,asking.version)?'pulled':'newer');
   answeredAt=now();
   if(state.status==='ready'){
    if(!info?.version||info.version===state.available){retry.succeeded();state.lastChecked=now();changed();return;} // the same update, already whole
    if(!lowerThan(info.version,state.available)){
     // newer: fetched behind the whole one with Acira's own download (automatic download on). Never with electron-updater's own: it empties its cache,
     // the setup that waits included, when its download fails. Off, or not describable, the newer one is found again after this one installs.
     state.lastChecked=now();changed();
     if(background===info.version)return;
     if(autoDownload&&updateFile(updater,{platform,arm64})){background=info.version;void startDownload();}else retry.succeeded();
     return;
    }
    pullDownloaded(); // an older build than the one downloaded: the feed went back (a rollback); the older one is offered the usual way below
   }
   if(info?.version&&info.version!==state.available){state.progress=null;state.transferred=state.total=state.speed=null;}
   state.available=info?.version||null;state.notes=notesText(info?.releaseNotes);shownPercent=-1;
   // paused while this look was under way: it stays paused
   const paused=state.status==='paused',go=!paused&&(autoDownload||resuming);resuming=false;
   state.status=paused?'paused':go?'downloading':'available';if(!go)retry.succeeded();changed();
   if(go)void startDownload();
  });
  // Nothing for this install. The feed's version says why: newer than the update that waits is a newer build this install is not offered (outside its
  // staged rollout, or halted), which leaves the waiting update as it is; the same version or older is that update halted, out of the rollout or
  // rolled back, so it is pulled. (Without a version, it is pulled: the safe side.)
  const supersededOnly=(info,version)=>Boolean(info?.version&&version&&lowerThan(version,info.version));
  updater.on('update-not-available',info=>{
   if(asking)return asking.finish(supersededOnly(info,asking.version)?'same':'pulled');
   answeredAt=now();retry.succeeded();resuming=false;resumed=null;disarm();stopBehind();
   if(held){fetched.discard(held.dir);held=null;try{persist();}catch{}}
   if(state.status==='ready'&&supersededOnly(info,state.available)){state.lastChecked=now();changed();return;}
   if(state.status==='ready')pullDownloaded();
   state.status='current';state.available=null;state.progress=state.transferred=state.total=state.speed=null;state.notes='';state.pausable=false;state.lastChecked=now();changed();
  });
  // electron-updater's own download, when it downloads by itself (see startDownload); each byte keeps its watchdog quiet
  updater.on('download-progress',progress=>{rearm();progressed({percent:progress?.percent,transferred:progress?.transferred,total:progress?.total,bytesPerSecond:progress?.bytesPerSecond});});
  updater.on('update-downloaded',info=>{
   disarm();background=null;resumed=null;updater.autoInstallOnAppQuit=true; // a pulled build had turned it off; this one the feed offers
   retry.succeeded();state.status='ready';state.available=info?.version||state.available;state.progress=100;state.speed=null;state.pausable=false;state.lastChecked=now();state.notes=notesText(info?.releaseNotes)||state.notes;
   if(held){held=null;try{persist();}catch{}}
   // keep the notes with the version, so the "Acira updated" note can show them after the restart
   if(state.available){pending={version:state.available,notes:state.notes};try{persist();}catch{}}
   changed();
  });
  // A check given up by the watchdog (lookUp) can still fail later, when its connection is closed or times out: electron-updater then reports it like
  // any failed check ("Cannot check for updates: …"). With no look of Acira's under way it belongs to that abandoned check and changes nothing: it used
  // to turn a waiting update into 'error' (the pill and Install now gone, and on Windows the quit's ask skipped).
  updater.on('error',(error,message)=>{if(asking)return asking.finish(null);if(!looking&&/^Cannot check for updates/.test(String(message||'')))return;fail(error);});
  return updater;
 }
 /** A failed look or download. A whole update stays offered when only a look failed (offline) or only the newer download behind it failed (its file
  *  is untouched until the newer one is handed over: background is cleared first). Install now can be clicked again (electron-updater could not start
  *  the installer, for example). A Resume that got no new byte (offline, the feed unreachable) is paused again with its bytes, and says the connection
  *  failed (error is set while paused): before, the panel closed under the pointer and the dots went, with no word. Anything else shows the error quietly. */
 function fail(error){
  // Ends an Install now under way: only a failure that leaves nothing ready does (a look failing beside a waiting update leaves Install now going).
  const endInstall=()=>{if(installing&&installHooks){for(const listener of installHooks.added)installHooks.native.removeListener('update-downloaded',listener);installHooks=null;}installing=false;};
  const back=resumed;resumed=null;resuming=false;disarm();
  if(state.status==='paused'){endInstall();return;} // a look that was under way when the person paused: paused stays paused
  state.speed=null;state.lastChecked=now();
  if(back&&state.status==='downloading'){
   endInstall();round++;job?.controller.abort();job=null;
   Object.assign(state,{status:'paused',pausable:true,error:clean(error)});if(held){held.paused=true;try{persist();}catch{}}
   changed();return; // off the network for updates again until the next Resume, as a pause is
  }
  const retryable=error?.code!=='ERR_UPDATER_INVALID_SIGNATURE'; // a setup not signed by the application owner: another try gets the same file
  if(state.status==='ready'&&(looking||background)){if(background){background=null;if(retryable)failed();}changed();return;}
  endInstall();state.status='error';state.error=clean(error);if(retryable)failed();changed();
 }
 /** Stops the newer download behind a whole update (its bytes stay, for a later start). */
 function stopBehind(){if(!background)return;background=null;round++;job?.controller.abort();job=null;}
 /** The feed no longer offers the downloaded update. electron-updater installs it when Acira quits while autoInstallOnAppQuit is on (that handler cannot
  *  wait for the network), so it is switched off and electron-updater's copy is deleted; a download the feed offers turns it on again. Its notes go
  *  too. (A Mac never gets here once Squirrel.Mac holds an update, which it applies at the next quit: the feed is asked before it is handed over.)
  *  Resolves when the copy is gone. */
 function pullDownloaded(){
  stopBehind();
  if(updater)updater.autoInstallOnAppQuit=false;
  if(pending){pending=null;try{persist();}catch{}}
  return cacheOf().then(where=>where?.helper.clear()).catch(()=>{});
 }
 /** Pulled at Install now or at the end of a download: nothing is offered until a fresh look says what the feed offers now. */
 function pulledNow(){
  pullDownloaded();
  Object.assign(state,{status:'idle',available:null,progress:null,transferred:null,total:null,speed:null,notes:'',pausable:false,error:null});changed();
  void look();
 }
 /** Asks the feed whether `version` is still offered, without acting on the answer the usual way (no download starts, nothing changes on screen):
  *  'same', 'newer' (a newer one is out; this one is not pulled), 'pulled' (nothing for this install, or an older build: a rollback), or null when
  *  there is no answer within askWithin (offline, slow, the route not confirmed): the caller goes on. */
 function ask(version){
  if(asking)return asking.version===version?asking.promise:Promise.resolve(null); // an ask about another version (the newer one behind) answers nothing here
  // The answer arrives during electron-updater's check. The caller has it when that check ends, or null after askWithin; either way the check stays
  // the ask's until it has ended: an answer or a failure arriving late is not taken for an ordinary look (which could turn 'ready' into 'error', or
  // start a second download during a hand-over), and electron-updater would hand any new check this same one meanwhile.
  let done,answer=null,replied=false;const promise=new Promise(resolve=>{done=resolve;});
  const reply=()=>{if(replied)return;replied=true;clearTimeout(timer);if(answer)answeredAt=now();done(answer);};
  const timer=setTimeout(reply,askWithin);timer.unref?.();
  const mine={version,promise,finish:value=>{answer??=value;}};asking=mine;
  Promise.resolve().then(lookUp).catch(()=>{}).then(()=>{if(asking===mine)asking=null;reply();});
  return promise;
 }
 /** One check of electron-updater's, by the profile's route (a route that is not confirmed sends nothing and rejects). electron-updater's own request
  *  timeout waits for a 'socket' event that Electron's net requests never emit, so on a dead connection its check never ended: 'checking' (or an ask)
  *  until Acira restarted, and every later check was handed that same check back. After checkWithin it is given up: electron-updater forgets it, so the
  *  next check asks again; its connections are closed when no download of Acira's shares them; and it counts as a failed look (the retries go on). */
 function lookUp(){
  return new Promise((resolve,reject)=>{
   let hung=null,gaveUp=false;
   const timer=setTimeout(()=>{
    gaveUp=true;
    if(hung&&updater.checkForUpdatesPromise===hung)updater.checkForUpdatesPromise=null; // electron-updater's cached check (it nulls it itself when it ends)
    if(!job)closeConnections();
    reject(Object.assign(new Error('The update check got no answer. It tries again later.'),{code:'ERR_UPDATE_CHECK_TIMEOUT'}));
   },checkWithin);timer.unref?.();
   Promise.resolve().then(async()=>{setup();if(route)await route();if(gaveUp)return null;/* the route took the whole time: no check after the look ended */hung=updater.checkForUpdates();return hung;}).then(resolve,reject).finally(()=>clearTimeout(timer));
  });
 }
 // electron-updater's own download (the fallback) has no inactivity limit: a connection that goes quiet would hold 'downloading', and skip every later
 // check, until Acira restarts. With no byte for `stall`, it is cancelled and counts as a failed download (the retries start it again).
 function disarm(){if(watchdog){clearTimeout(watchdog.timer);watchdog=null;}}
 function rearm(){
  if(!watchdog)return;
  const current=watchdog;clearTimeout(current.timer);
  current.timer=setTimeout(()=>{if(watchdog!==current)return;watchdog=null;try{current.token?.cancel();}catch{}fail(Object.assign(new Error('The update download stopped. It starts again at the next try.'),{code:'ERR_UPDATE_STALLED'}));},stall);current.timer.unref?.();
 }
 // Progress is real (bytes counted as they arrive); the interface hears of it when the percent moves, never faster than PROGRESS_EVERY.
 function progressed(progress){
  if(state.status==='paused'||state.status==='ready')return;
  const total=count(progress?.total),transferred=count(progress?.transferred);
  if(resumed){if(resumed.from===null)resumed.from=transferred??0;else if((transferred??0)>resumed.from)resumed=null;} // bytes are coming again: the Resume took
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
 // electron-updater downloads by itself, as it did before Acira's own download (the file could not be described: no pause, a stop starts again from zero),
 // by the profile's route and with the watchdog above. Never behind a whole update: a failed download of its own empties its cache, that update included.
 async function updaterDownloads(id){
  state.pausable=false;if(typeof updater.downloadUpdate!=='function')return;
  if(route){try{await route();}catch(error){if(id===round)fail(error);return;}if(id!==round)return;}
  let token;try{token=new (require('builder-util-runtime').CancellationToken)();}catch{token=undefined;} // electron-updater's own
  disarm();watchdog={token,timer:null};rearm();
  try{updater.downloadUpdate(token)?.catch?.(()=>{/* electron-updater reports it as 'error' */});}catch(error){fail(error);/* thrown before it started (a feed file it can't describe): no 'error' comes */}
 }
 /** Acira's own download of the file electron-updater found: resumable (update-download.cjs), checked against the feed's SHA-512, then handed to
  *  electron-updater's cache, from where its downloadUpdate() takes it ('update-downloaded'). A pause stops it where it is (round). */
 async function startDownload(){
  // behind: a newer version, fetched quietly while a whole one is 'ready' (nothing on screen changes, nothing to pause; Install now stops it)
  const id=++round,target=updateFile(updater,{platform,arm64}),behind=state.status==='ready';
  if(!target){if(behind)background=null;else void updaterDownloads(id);return;}
  if(refused.has(target.sha512)){ // found not signed by the application owner in this run: not downloaded again (a fix is another file)
   if(behind){background=null;return;}
   retry.succeeded();Object.assign(state,{status:'error',error:refused.get(target.sha512),speed:null,pausable:false,lastChecked:now()});changed();return;
  }
  if(held&&held.sha512!==target.sha512){fetched.discard(held.dir);held=null;} // the feed moved on: the old bytes go
  held={version:target.version||state.available||'',from:version,sha512:target.sha512,size:target.size,notes:behind?'':state.notes,paused:false,dir:held?.dir||null};
  if(!behind)state.pausable=true;
  const where=await cacheOf();
  if(id!==round)return;
  if(!where){held=null;try{persist();}catch{}if(behind)background=null;else void updaterDownloads(id);return;}
  held.dir=where.dir;try{persist();}catch{}
  try{
   // a launch that downloaded it whole and quit before electron-updater took it: nothing to download
   let give=null,file=null;
   if(!fetched.handedOver({pendingDir:where.pending,sha512:target.sha512,size:target.size})){
    if(route){await route();if(id!==round)return;} // the blockmaps and the file leave by the profile's route too
    const diff=platform==='win32'?await differential(target,where).catch(()=>null):null;
    if(id!==round)return;
    const controller=new AbortController();job={id,controller};
    net??=updaterFetch();
    const run=way=>fetched.download({url:target.url,sha512:target.sha512,size:target.size,dir:where.dir,plan:way?.plan||null,oldFile:way?.oldFile||null,headers:requestHeaders(),fetch:net,signal:controller.signal,now,stall,onProgress:progressed});
    // a download that goes quiet (no byte for `stall`) or whose connection drops goes on at once from the byte it had, a few times, before it fails
    const attempt=async way=>{for(let tries=0;;tries++){try{return await run(way);}catch(error){if(id!==round||tries>=RESUMES||!dropped(error))throw error;}}};
    let result;
    try{result=await attempt(diff?.plan?diff:null);}
    catch(error){
     // the differential could not finish (a changed run the server would not send as asked, an old setup that does not match its blockmap): the
     // whole setup, from the bytes already here (a damaged result was deleted, so then from the start)
     if(!diff?.plan||id!==round||!['ERR_UPDATE_RANGE','ERR_CHECKSUM_MISMATCH'].includes(error?.code))throw error;
     wholeFor=target.sha512;result=await attempt(null);
    }
    if(id!==round||result.paused)return;
    if(!behind){state.pausable=false;state.speed=null;changed();}
    // The last moment before the file becomes installable (Squirrel.Mac applies what it is handed at the next quit, whatever the feed says later): an
    // answer older than freshFor (a long download, a pause) is asked for again. Pulled meanwhile: the file goes. A newer one out: that one instead.
    if(now()-answeredAt>=freshFor){
     const answer=await ask(target.version);
     if(id!==round)return;
     // (behind a whole update, a pulled newer one only takes its own bytes; a fresh look says whether the whole one is pulled too)
     if(answer==='pulled'){round++;fetched.discard(where.dir);held=null;try{persist();}catch{}if(behind){background=null;void look();}else pulledNow();return;}
     if(answer==='newer'){round++;if(behind)background=null;else resuming=true;void look();return;}
    }
    file=result.file;
    give=()=>fetched.handOver({file:result.file,pendingDir:where.pending,name:target.name,sha512:target.sha512,isAdminRightsRequired:target.isAdminRightsRequired,blockMap:diff?.newRaw||null,helper:where.helper});
   }
   if(id!==round)return;
   // Windows: electron-updater checks a setup's Authenticode signature (verifySignature: the publisher named in app-update.yml; none named, as in
   // today's unsigned builds, passes) only when it downloads the file itself: a file Acira hands to its cache is taken as it is. So it is checked
   // here, before electron-updater takes it, the file this download made or the one an earlier run handed over. Refused, it never installs (refuse).
   try{await signedByOwner(file||pendingFile(where,target),target);}catch(error){if(id===round&&error?.code==='ERR_UPDATER_INVALID_SIGNATURE'){refuse(error,target,where,!file);return;}throw error;}
   if(id!==round)return;
   // From here the update that waits is replaced (electron-updater's cache is emptied for this one): Install now waits until electron-updater has it.
   background=null;
   let release;handing=new Promise(resolve=>{release=resolve;});
   try{
    if(give)await give();
    // A verified AppImage handed to the updater cache bypasses its download task, where it normally sets the executable bit.
    if(platform==='linux')await fs.promises.chmod(pendingFile(where,target),0o755);
    held=null;state.pausable=false;try{persist();}catch{}
    await updater.downloadUpdate(); // finds the file in its cache, checks its SHA-512 again, then 'update-downloaded'
   }finally{handing=null;release();}
  }catch(error){
   if(id!==round)return;
   // a damaged file was deleted: it starts again at once, once; after that the retries below
   if(error?.code==='ERR_CHECKSUM_MISMATCH'&&!mismatched){mismatched=true;void startDownload();return;}
   fail(error);
  }finally{if(job?.id===id)job=null;}
 }
 /** null when the setup is signed by the application owner (or the build names none: unsigned builds), as electron-updater's own download decides it;
  *  else the reason, thrown as electron-updater throws it. A failure to check at all is an ordinary failed download (tried again later). */
 async function signedByOwner(file,target){
  if(platform!=='win32'||typeof updater.verifySignature!=='function')return;
  const why=await updater.verifySignature(file);
  if(why!=null)throw Object.assign(new Error(`New version ${target.version} is not signed by the application owner: ${why}`),{code:'ERR_UPDATER_INVALID_SIGNATURE'});
 }
 /** The file an earlier run handed to electron-updater's cache (update-info.json names it). */
 const pendingFile=(where,target)=>{let name=target.name;try{const info=JSON.parse(fs.readFileSync(path.join(where.pending,'update-info.json'),'utf8'));if(typeof info.fileName==='string'&&path.basename(info.fileName)===info.fileName)name=info.fileName;}catch{}return path.join(where.pending,name);};
 /** A setup not signed by the application owner: it never installs. Its bytes go (Acira's partial download, or electron-updater's copy when an earlier
  *  run had handed it over), it is not downloaded again in this run, and nothing is retried (another try gets the same file; a fix is another file).
  *  The whole update that waits stays offered when only the newer one behind it is refused. */
 function refuse(error,target,where,fromPending){
  refused.set(target.sha512,clean(error));
  fetched.discard(where.dir);held=null;try{persist();}catch{}
  if(fromPending)void Promise.resolve().then(()=>where.helper.clear()).catch(()=>{});
  resumed=null;fail(error);
 }
 async function check(){
  if(unsupported)return status();
  if(asking)return status(); // Install now (or the end of a download) is asking the feed right now
  if(['checking','downloading','paused'].includes(state.status))return status(); // paused: off the network for updates until Resume
  // Mac, 'ready': a downloaded update waits for Install now. Checking again hands it to Squirrel.Mac a second time, which either fails (status 'error':
  // the pill and Install now disappear) or stages a second install under the first. The first check after the restart finds anything newer.
  if(platform==='darwin'&&state.status==='ready')return status();
  return look();
 }
 async function look(){
  failedRound=false;looking=true;
  // route: the check leaves by the active profile's route (its proxy); a route that is not confirmed sends nothing and counts as a failed look
  try{await lookUp();}catch(error){fail(error);}finally{looking=false;}
  return status();
 }
 // Settings' Download, when updates are not downloaded automatically
 async function download(){if(unsupported||state.status!=='available')return status();failedRound=false;state.status='downloading';state.error=null;changed();setup();void startDownload();return status();}
 /** Pause: the download stops where it is and keeps its bytes. The pause is kept in updater.json: a quit and relaunch starts paused, and nothing is
  *  looked for or downloaded until Resume. Only Acira's own download pauses (pausable); electron-updater's could only start again from zero. */
 function pause(){
  if(unsupported||state.status!=='downloading'||!state.pausable)return status();
  round++;job?.controller.abort();job=null;resuming=false;resumed=null;
  state.status='paused';state.speed=null;
  if(held){held.paused=true;try{persist();}catch{}}
  changed();return status();
 }
 /** Resume: on from the last byte. In the same run electron-updater still knows the file; after a relaunch it looks first (the feed may have moved
  *  on, and then the newer file is downloaded instead), keeping the download on screen while it looks. */
 function resume(){
  if(unsupported||state.status!=='paused')return status();
  if(held){held.paused=false;try{persist();}catch{}}
  state.status='downloading';state.error=null;shownPercent=-1;resumed={from:null};changed();
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
  const wasPaused=state.status==='paused';stopBehind();
  if(wasPaused){fetched.discard(held?.dir);held=null;Object.assign(state,{progress:null,transferred:null,total:null,speed:null,notes:'',pausable:false,error:null});}
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
   // A newer version downloading behind this one stops: this one installs now. One being handed over this very moment is waited for (it installs).
   if(handing)await handing;else stopBehind();
   if(state.status!=='ready')throw new Error('No downloaded update is waiting.');
   // Windows: the feed is asked once more, so a build pulled since it was downloaded is not installed. A newer one being out does not stop this one;
   // no answer in time (offline, slow) installs it, so the person is never kept on the old version by their network. A Mac is not asked here: its
   // update is already with Squirrel.Mac, which applies it at the next quit whatever the answer (it was asked before the hand-over instead).
   if(platform!=='darwin'&&await ask(state.available)==='pulled'){installing=false;pulledNow();return status();}
   let timer;
   // a failed or slow save must not trap the person in the old version: it is waited for, but only so long
   await Promise.race([Promise.resolve().then(beforeInstall),new Promise(resolve=>{timer=setTimeout(resolve,FLUSH_TIMEOUT);timer.unref?.();})]).catch(()=>{}).finally(()=>clearTimeout(timer));
   // An error while it asked or saved (Squirrel.Mac failing to stage it, a check failing on the way) ended this install (fail): it does not go on to
   // quitAndInstall, which would restart Acira later by itself once something reached Squirrel.
   if(!installing||state.status!=='ready')return status();
   setup().log?.('session-flushed');
   // Windows: silent (/S), so no setup window and none of its questions ("Update to X / Open / Cancel" is asked only when not silent), and
   // --force-run, so the setup opens Acira again when it is done. Squirrel.Mac ignores both arguments. MacUpdater waits for Squirrel.Mac with a listener
   // when Squirrel is still unpacking the update; it is noted, so a failed install takes it away again (see fail).
   const native=updater.nativeUpdater,before=typeof native?.listeners==='function'?new Set(native.listeners('update-downloaded')):null;
   updater.quitAndInstall(true,true);
   if(before){const added=native.listeners('update-downloaded').filter(listener=>!before.has(listener));installHooks=added.length?{native,added}:null;}
  }catch(error){installing=false;throw error;}
  return {...status(),installing:true};
 }
 const within=(promise,ms)=>new Promise(resolve=>{const timer=setTimeout(()=>resolve(null),ms);timer.unref?.();Promise.resolve(promise).then(value=>{clearTimeout(timer);resolve(value);},()=>{clearTimeout(timer);resolve(null);});});
 /** Acira is quitting (main waits for this in will-quit, beside the session flush). Nothing waits: it ends at once. An update that waits (not Install
  *  now's, which is on its way) is asked about once more when the feed's last answer is older than freshFor, for quitAsk at most (no answer in time: it
  *  installs, as at Install now), so a halt published since it was downloaded is honoured on the way out too: electron-updater's install-on-quit is
  *  switched off. A newer file being handed to electron-updater this very moment decides by itself. Windows only: a Mac's update is with Squirrel.Mac
  *  from the download on, which applies it at the next quit whatever the answer. */
 function atQuit(){
  if(quitStep)return quitStep;
  if(unsupported||installing||!updater||state.status!=='ready'||platform==='darwin')return Promise.resolve();
  quitStep=(async()=>{
   if(handing){await within(handing,quitAsk);if(handing)return;}else stopBehind(); // the newer download behind it stops here (its bytes stay)
   if(state.status!=='ready')return;
   if(now()-answeredAt>=freshFor&&await within(ask(state.available),quitAsk)==='pulled')await within(pullDownloaded(),quitAsk);
  })().catch(()=>{});
  return quitStep;
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
 // and while an update waits (Windows; a Mac's waits with Squirrel.Mac and is not looked at again), every READY_RECHECK, so a pulled build is dropped
 function start(){if(started||unsupported)return;started=true;const run=()=>{void check();};const first=schedule(run,stubbed?1500:CHECK_DELAY);first?.unref?.();const loop=every(run,CHECK_EVERY);loop?.unref?.();if(platform!=='darwin'){const again=every(()=>{if(state.status==='ready')void check();},READY_RECHECK);again?.unref?.();}}
 return {status,check,download,pause,resume,setAutoDownload,setChannel,install,claimPrompt,claimWelcome,start,whatsNewInfo,atQuit};
}
module.exports={createAppUpdater,createStubUpdater,notesText,updateFile,macArm64,lowerThan,CHECK_EVERY,CHECK_DELAY,CHANNELS,READY_RECHECK,QUIT_ASK,CHECK_WITHIN};
