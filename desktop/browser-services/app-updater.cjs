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
//   - Install now runs install(): the session is flushed first (beforeInstall), then electron-updater's quitAndInstall (the ordinary graceful quit);
//   - ignored, the update still installs when Acira quits (autoInstallOnAppQuit);
//   - the first launch on a new version shows its release notes (electron-updater handed them over; kept with the version that was downloaded) once, by itself,
//     in a popup centred in the window (claimWelcome; the interface asks a moment after the window is free). A version without notes gets only a quiet
//     "Acira updated to X" toast, never an empty popup. A fresh install, or the first run of a build that predates this, shows nothing.
// Test mode (ACIRA_UPDATE_TEST plus ACIRA_UPDATE_STUB): a stand-in updater downloads nothing and its quitAndInstall only writes a log line, so no
// installer ever runs; ACIRA_UPDATE_TEST_VERSION pretends the app is that version (to rehearse the "updated" note).
const fs=require('node:fs'),path=require('node:path'),{EventEmitter}=require('node:events'),{createRetry}=require('./network-retry.cjs');
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
 // With a local feed (ACIRA_UPDATE_FEED, handed over by setFeedURL; the channel document is JSON: version, releaseNotes, files[0].url and size) the stand-in
 // downloads the file for real over HTTP, so the progress the interface shows is genuine. Without one it fakes one step.
 let found=null;
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
  const info=await(await fetch(new URL('latest.yml',stub.feed.replace(/\/*$/,'/')))).json();
  found=info;stub.emit('update-available',{version:info.version});
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
 stub.downloadUpdate=async()=>{if(stub.feed&&found)await fetchFile();return null;};
 stub.quitAndInstall=(silent,forceRun)=>stub.log({quitAndInstall:{silent,forceRun}});
 stub.setFeedURL=config=>{stub.feed=typeof config?.url==='string'?config.url:null;};
 return stub;
}
function createAppUpdater({app,onChange=()=>{},beforeInstall=async()=>{},autoUpdater,dir=app.getPath('userData'),platform=process.platform,env=process.env,now=Date.now,schedule=setTimeout,cancel=clearTimeout,every=setInterval,network=null,uninstallerPresent=()=>fs.existsSync(path.join(path.dirname(process.execPath),'Uninstall AciraBrowser.exe')),qaBuild=require('../build-identity.cjs').qa,macAvailability=()=>require('./mac-app-update.cjs').macUpdateAvailability({app})}){
 const file=path.join(dir,'updater.json');
 const testing=Boolean(env.ACIRA_UPDATE_TEST),stubbed=testing&&Boolean(env.ACIRA_UPDATE_STUB);
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
 const persist=()=>{try{fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(file,JSON.stringify({autoDownload,channel,lastRunVersion:version,...(pending?{pending}:{})}),{mode:0o600});}catch{throw new Error('The update preference could not be saved.');}};
 if(lastRun!==version||(saved.pending&&!pending))try{persist();}catch{} // remember this version as the one that ran, so the note never shows for it again
 const installed=platform==='win32'&&app.isPackaged&&uninstallerPresent();
 // a QA build (its own identity, desktop/build-identity.cjs) never updates itself: the update would be the real Acira's installer
 const unsupported=stubbed?null:!app.isPackaged?'Updates apply to the installed app, not a development run.':qaBuild&&!env.ACIRA_UPDATE_TEST?'Updates are off in QA builds.':env.ACIRA_BROWSER_TEST_DATA&&!env.ACIRA_UPDATE_TEST?'Updates are off while running with a test profile.':platform==='darwin'?macAvailability():platform!=='win32'?'Automatic updates are unavailable on this platform.':!installed?'This is a portable copy. Download new versions from the releases page.':null;
 // transferred/total (bytes) and speed (bytes a second) describe the download in progress; notes are the downloaded version's plain-text release notes.
 const state={status:unsupported?'unsupported':'idle',version,available:null,progress:null,transferred:null,total:null,speed:null,notes:'',lastChecked:null,error:null};
 let updater=null,started=false,installing=false,promptedFor=null,welcomed=false,shownPercent=-1,shownAt=0,failedRound=false;
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
  updater.autoDownload=autoDownload;updater.autoInstallOnAppQuit=true;updater.allowPrerelease=channel==='beta';updater.channel=channel==='beta'?'beta':'latest';updater.allowDowngrade=false; /* each release carries latest.yml (Stable) and beta.yml (Beta); setting a channel turns allowDowngrade on, so it is reset */ updater.logger=null;if(env.ACIRA_UPDATE_TEST&&env.ACIRA_UPDATE_FEED)updater.setFeedURL({provider:'generic',url:env.ACIRA_UPDATE_FEED});// test-only: points the installed build at a local feed
  updater.on('checking-for-update',()=>{failedRound=false;state.status='checking';state.error=null;changed();});
  // a found update counts as success only when nothing is downloaded automatically: a download that keeps failing must climb the ladder, not restart it
  updater.on('update-available',info=>{if(info?.version&&info.version!==state.available){state.progress=null;state.transferred=state.total=state.speed=null;state.notes='';}state.available=info?.version||null;state.status=autoDownload?'downloading':'available';shownPercent=-1;if(!autoDownload)retry.succeeded();changed();});
  updater.on('update-not-available',()=>{retry.succeeded();state.status='current';state.available=null;state.progress=state.transferred=state.total=state.speed=null;state.notes='';state.lastChecked=now();changed();});
  // Progress is real (electron-updater counts the bytes); the interface hears of it when the percent moves, never faster than PROGRESS_EVERY.
  updater.on('download-progress',progress=>{
   state.status='downloading';state.progress=Math.max(0,Math.min(100,Math.round(progress?.percent||0)));
   state.transferred=count(progress?.transferred);state.total=count(progress?.total);state.speed=count(progress?.bytesPerSecond);
   const at=now();if(state.progress!==shownPercent&&(at-shownAt>=PROGRESS_EVERY||state.progress===100||shownPercent<0)){shownPercent=state.progress;shownAt=at;changed();}
  });
  updater.on('update-downloaded',info=>{
   retry.succeeded();state.status='ready';state.available=info?.version||state.available;state.progress=100;state.speed=null;state.lastChecked=now();state.notes=notesText(info?.releaseNotes);
   // keep the notes with the version, so the "Acira updated" note can show them after the restart
   if(state.available){pending={version:state.available,notes:state.notes};try{persist();}catch{}}
   changed();
  });
  updater.on('error',error=>{state.status='error';state.error=clean(error);state.lastChecked=now();failed();changed();});
  return updater;
 }
 async function check(){
  if(unsupported)return status();
  if(['checking','downloading'].includes(state.status))return status();
  // Mac, 'ready': a downloaded update waits for Install now. Checking again hands it to Squirrel.Mac a second time, which either fails (status 'error':
  // the pill and Install now disappear) or stages a second install under the first. The first check after the restart finds anything newer.
  if(platform==='darwin'&&state.status==='ready')return status();
  failedRound=false;
  try{setup();await updater.checkForUpdates();}catch(error){state.status='error';state.error=clean(error);state.lastChecked=now();failed();changed();}
  return status();
 }
 async function download(){if(unsupported||state.status!=='available')return status();failedRound=false;try{state.status='downloading';await setup().downloadUpdate();}catch(error){state.status='error';state.error=clean(error);failed();}return status();}
 function setAutoDownload(value){
  if(typeof value!=='boolean')throw new Error('Choose on or off.');
  autoDownload=value;persist();
  if(updater)updater.autoDownload=value;return status();
 }
 // Stable follows full releases only; Beta also follows pre-releases. Switching never downgrades (allowDowngrade is off).
 function setChannel(value){
  if(!CHANNELS.includes(value))throw new Error('Choose Stable or Beta.');
  channel=value;persist();if(['available','current','error'].includes(state.status)){state.available=null;state.status='idle';}
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
 return {status,check,download,setAutoDownload,setChannel,install,claimPrompt,claimWelcome,start,whatsNewInfo};
}
module.exports={createAppUpdater,createStubUpdater,notesText,CHECK_EVERY,CHECK_DELAY,CHANNELS};
