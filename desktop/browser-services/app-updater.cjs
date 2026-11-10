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
const feedRules=require('./update-feeds.cjs'),hosts=require('./update-hosts.cjs');
// Where it asks (beta.11 on, docs/launch/UPDATE_HOST.md): update.acirabrowser.com first, then the frozen GitHub feed when the first gives no usable answer
// (update-feeds.cjs has the rules). Pickup: 20 s after launch, then every 2 hours (up to 10 minutes later, so the installs do not ask together), again when the
// computer wakes or a window gets focus after 2 hours without an answer (nudge), and at the pace a document asks for with nextCheckSeconds (10 minutes to 24 hours).
// Update traffic says only "AciraUpdater" (no version, no system), and never sends the install's staging id: the share is decided on this computer.
const CHECK_DELAY=20*1000,CHECK_EVERY=2*60*60*1000,CHECK_JITTER=10*60*1000,HINT_MIN=10*60*1000,HINT_MAX=24*60*60*1000,NUDGE_QUIET=5*60*1000;
const UPDATE_USER_AGENT='AciraUpdater';
// A failed check or download (offline at start, a dropped connection) tries again 2, 10 and 30 minutes later and as soon as the network comes back or the
// Mac wakes (network-retry.cjs), instead of at the next regular round. Nothing new is shown: the status says 'error' as before until an attempt succeeds.
const CHANNELS=['stable','beta'];
const NOTES_MAX=6000,FLUSH_TIMEOUT=5000,PROGRESS_EVERY=400; /* the most release notes kept (a whole list, 1528 characters for beta.11, scrolls in the popup; this only stops a runaway feed). packaging/update-publish.cjs warns at the same number. */ // the interface hears about download progress at most this often (ms), and only when the percent moved
// A build can be pulled from the feed after this computer downloaded it (a halt: stagingPercentage 0; a rollback to an older build; this install no
// longer in a staged rollout). Windows asks the feed again while an update waits (READY_RECHECK), at Install now (waiting at most ASK_WITHIN for an
// answer), and when Acira quits with an update waiting and the last answer is older than FRESH_FOR (QUIT_ASK at most, see atQuit). Both platforms ask
// once more before a file becomes installable when the feed's last answer is older than FRESH_FOR (a long download, a pause). A check that gets no
// answer at all is given up after CHECK_WITHIN.
const READY_RECHECK=30*60*1000,ASK_WITHIN=8*1000,FRESH_FOR=5*60*1000,QUIT_ASK=1200,CHECK_WITHIN=60*1000;
const LEANS_FOR=30*60*1000; // an address of a file that worked is asked first for this long, for that file
const RESUMES=2; // a download that goes quiet or whose connection drops goes on at once from the byte it had, this many times, before it counts as failed
// Recovery (beta.14, item 14): nothing a person clicks, and no failure, may leave them unable to update.
// STUCK_AFTER: 'checking' or 'downloading' with no sign of life for this long starts again from a clean check; STALE_FOR_MANUAL: the same for a manual "Check for updates";
// INSTALL_WITHIN: Install now whose quit never came lets the person try again; PAUSE_LASTS: a pause older than this is dropped; DAMAGED_HOLD: a file that failed its
// SHA-512 twice is not fetched again for this long (a new hash in the feed starts at once); DISK_MARGIN: room kept beyond the file; HARD_FAILURES / ANY_FAILURES: after this many
// failures that are not just a bad connection (or in all) the last-resort download path is offered (status.lastResort). HOLD_BYPASS_EVERY: a person's own Check for
// updates (or Download) lifts a DAMAGED_HOLD once per this long for a file; the hold is the loop guard against fetching a bad file every round, a person is not a round.
const STUCK_AFTER=5*60*1000,STALE_FOR_MANUAL=20*1000,INSTALL_WITHIN=2*60*1000,PAUSE_LASTS=7*24*60*60*1000,DAMAGED_HOLD=6*60*60*1000,HOLD_BYPASS_EVERY=15*60*1000,DISK_MARGIN=64*1024*1024;
const HARD_FAILURES=2,ANY_FAILURES=5,DOWNLOAD_PAGE='https://acirabrowser.com/download/';
const count=value=>Number.isFinite(value)&&value>=0?Math.round(value):null;
const clean=value=>String(value?.message||value||'Update check failed.').replace(/\s+/g,' ').slice(0,200);
const {lowerThan}=feedRules;
/** A connection that went quiet or dropped, not a refusal, a wrong file or a damaged one: worth going on from the same byte at once. */
const dropped=error=>['ERR_UPDATE_STALLED','ERR_UPDATE_SHORT','ERR_UPDATE_FIRST_BYTE'].includes(error?.code)||!error?.code&&(error instanceof TypeError&&/fetch failed|terminated|network/i.test(error.message)||/net::ERR_(CONNECTION|NETWORK|INTERNET|TIMED_OUT|EMPTY_RESPONSE)/.test(String(error?.message||'')));
/** Worth going on at once from the same byte: dropped, and not already tried on every address of the file (a download with mirrors that failed on all of them goes to the retry ladder). */
const resumable=error=>!error?.exhausted&&dropped(error);
/** What kind of trouble an error is. 'offline' (no network, a quiet line), 'feeds' (no address gave a newer document), 'server' (a 5xx) and 'stuck' are expected on a bad day and
 *  count towards the last-resort path only in numbers (ANY_FAILURES); every other kind is a "hard" failure (HARD_FAILURES). */
const SOFT_KINDS=new Set(['offline','feeds','server','stuck','other']);
/** The three causes the interface words for itself (status.cause): the connection (a page or a 404 where the file should be included), a file that did not pass its check (damaged, refused), anything else. */
const causeOf=kind=>['offline','feeds','server','stuck','proxy','route','tls','clock','portal','missing'].includes(kind)?'network':['damaged','signature'].includes(kind)?'file':'other';
function kindOf(error){
 const code=String(error?.code||''),text=String(error?.message||error||'');
 if(code==='ERR_UPDATER_INVALID_SIGNATURE')return 'signature';
 if(['ERR_CHECKSUM_MISMATCH','ERR_UPDATE_SIZE','ERR_UPDATE_DAMAGED'].includes(code))return 'damaged';
 if(code==='ERR_UPDATE_DISK'||code==='ENOSPC'||code==='EDQUOT'||/ENOSPC|no space left/i.test(text))return 'disk';
 if(code==='ERR_UPDATE_ROUTE')return 'route';
 if(code==='ERR_UPDATE_PORTAL')return 'portal';
 if(code==='ERR_UPDATE_INSTALL')return 'install';
 if(code==='ERR_UPDATE_STUCK')return 'stuck';
 if(/ERR_CERT_DATE_INVALID|CERT_HAS_EXPIRED|CERT_NOT_YET_VALID|certificate (?:has expired|is not yet valid)/i.test(text))return 'clock';
 if(/ERR_CERT_|ERR_SSL_|ERR_TLS|UNABLE_TO_VERIFY|SELF_SIGNED/i.test(text))return 'tls';
 if(/ERR_PROXY|ERR_TUNNEL|HTTP 407/.test(text))return 'proxy';
 if(code==='ERR_UPDATE_FEEDS_UNAVAILABLE')return 'feeds';
 if(code==='ERR_UPDATE_HTTP'&&/HTTP 4\d\d/.test(text)&&!/HTTP (?:408|429)/.test(text))return 'missing';
 if(['ERR_UPDATE_STALLED','ERR_UPDATE_SHORT','ERR_UPDATE_FIRST_BYTE','ERR_UPDATE_CHECK_TIMEOUT'].includes(code)||dropped(error)||/ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION|ERR_TIMED_OUT|ENOTFOUND|EAI_AGAIN|ECONN|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH/i.test(text))return 'offline';
 if(code==='ERR_UPDATE_HTTP'||/HTTP 5\d\d/.test(text))return 'server';
 return 'other';
}
const FRIENDLY={
 clock:'The date or time on this computer looks wrong, so the update server cannot be trusted yet. Set the clock, then try again.',
 tls:'A secure connection to the update server could not be made. A network that inspects traffic can cause this.',
 proxy:'Your proxy or VPN did not let the update through. Check its settings, or download Acira from acirabrowser.com.',
 portal:'A web page came back instead of the update (a sign-in page on this network?). Sign in to the network, then try again.',
};
/** The words shown for an error: a plain sentence for the kinds a person can do something about, else the error's own. */
const friendly=error=>FRIENDLY[kindOf(error)]||clean(error);
/** electron-updater hands over release notes as HTML or Markdown text (GitHub's release body), or a list of {version,note}. Shown as plain text only. */
function notesText(raw){
 let text='';
 if(typeof raw==='string')text=raw;else if(Array.isArray(raw))text=raw.map(item=>typeof item==='string'?item:String(item?.note||'')).join('\n');
 text=text.replace(/!?\[([^\]\n]*)\]\([^)\n]*\)/g,'$1').replace(/<\s*br\s*\/?>/gi,'\n').replace(/<\/(?:p|div|h[1-6]|ul|ol)\s*>/gi,'\n').replace(/<li[^>]*>/gi,'• ').replace(/<\/li\s*>/gi,'\n').replace(/<[^>]*>/g,'')
  .replace(/&nbsp;/g,' ').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&amp;/g,'&')
  .replace(/^\s*[-*]\s+/gm,'• ').replace(/^#{1,6}\s*/gm,'').replace(/\*\*|__/g,'').replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
 if(text.length<=NOTES_MAX)return text;
 // too long even for that: whole lines are kept (never half a bullet), and a line longer than the limit by itself is cut
 const cut=text.slice(0,NOTES_MAX-1),lines=cut.slice(0,cut.lastIndexOf('\n')).trimEnd();
 return (lines.length>NOTES_MAX/2?lines:cut.trimEnd())+'…';
}
/** Test-only stand-in for electron-updater: finds a fake newer version, "downloads" it, and records quitAndInstall instead of running an installer. */
function createStubUpdater({env,dir,platform=process.platform,app=null,version=null}){
 const stub=new EventEmitter(),logFile=path.join(dir,'update-stub-log.json'),running=version||(typeof app?.getVersion==='function'?app.getVersion():'0.0.0');
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
  const base=answer.base,file=found.files?.[0];
  if(!file)return;
  const response=await fetch(new URL(file.url,base)),total=Number(response.headers.get('content-length'))||Number(file.size)||0,reader=response.body.getReader(),began=Date.now();
  let transferred=0;
  for(;;){
   const {done,value}=await reader.read();if(done)break;
   transferred+=value.length;stub.emit('download-progress',{percent:total?transferred/total*100:0,transferred,total,bytesPerSecond:transferred/Math.max(.001,(Date.now()-began)/1000)});
  }
  downloaded({version:found.version,releaseNotes:found.releaseNotes});
 }
 let answer={base:null};
 // The same rules as the real provider (update-feeds.cjs): the first address, the next only when the first gives nothing usable, and a later address only counts when it offers something newer.
 async function fromFeed(){
  const feeds=stub.feeds||[{name:'primary',url:stub.feed}];
  const read=await feedRules.readChannel({feeds,channelFile:'latest.yml',current:running,floor:stub.floor,
   request:async url=>{const response=await fetch(url);if(!response.ok)throw Object.assign(new Error('HTTP '+response.status),{code:'ERR_UPDATE_HTTP'});return response.text();},
   parse:text=>JSON.parse(text),primaryWithin:stub.primaryWithin,fallbackWithin:stub.fallbackWithin});
  const info=read.info,base=new URL(read.feed.url.replace(/\/*$/,'/'));answer={base,feed:read.feed.name};
  // a halt (stagingPercentage 0) is "nothing for this install", as electron-updater's own check says it, so a live rig can rehearse a pulled build
  if(Number(info.stagingPercentage)===0){stub.emit('update-not-available',{version:info.version});return;}
  found=info;stub.updateInfoAndProvider={info,provider:{baseUrl:base,answeredBy:read.feed.name,resolveFiles:doc=>(doc.files||[]).map(file=>({url:new URL(file.url,base),info:file}))}};
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
 stub.setFeedURL=config=>{
  stub.feeds=Array.isArray(config?.feeds)?config.feeds.filter(feed=>typeof feed?.url==='string'):null;
  stub.floor=typeof config?.floor==='function'?config.floor:undefined;stub.primaryWithin=config?.primaryWithin;stub.fallbackWithin=config?.fallbackWithin;
  stub.feed=stub.feeds?.[0]?.url||(typeof config?.url==='string'?config.url:null);
 };
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
  return {version:String(current.info.version||''),url:file.url.href,mirrors:fetched.mirrorsOf(file.info.mirrors,file.url.href),sha512,size,name,isAdminRightsRequired:file.info.isAdminRightsRequired===true};
 }catch{return null;}
}
/** The network for Acira's own update download: electron-updater's own session (no cache; main points its proxy at the active profile's route before
 *  every check and download, see `route` and update-route.cjs), or plain fetch outside Electron. */
function updaterFetch(){
 try{const own=updaterSession();return (url,init)=>own.fetch(url,init);}catch{return globalThis.fetch;}
}
/** electron-updater's own session (the partition its checks and Acira's download both use), saying only "AciraUpdater": no version, no system. */
function updaterSession(){
 const {session}=require('electron'),own=session.fromPartition('electron-updater',{cache:false});
 try{own.setUserAgent(UPDATE_USER_AGENT);}catch{/* an older Electron: the default user agent stays */}
 return own;
}
/** Closes every connection of electron-updater's own session (its check, and Acira's download, see updaterFetch); outside Electron, nothing. */
function closeUpdaterConnections(){try{const {session}=require('electron');void session.fromPartition('electron-updater',{cache:false}).closeAllConnections?.()?.catch?.(()=>{});}catch{}}
/** Replacing an AppImage removes it and moves the new one in: both need its folder (and the file) to be writable. null when they are. */
function appImageProblem(file){try{fs.accessSync(path.dirname(file),fs.constants.W_OK);fs.accessSync(file,fs.constants.W_OK);return null;}catch(error){return error?.code==='ENOENT'?null:'Move the Acira AppImage to a folder you can write to to use automatic updates.';}} // (a path that is not there cannot be judged: left to electron-updater)
function hasInstalledWindowsUninstaller(directory,qa=false){const names=qa?['Uninstall Acira Browser QA.exe','Uninstall AciraBrowserQA.exe']:['Uninstall Acira Browser.exe','Uninstall AciraBrowser.exe'];return names.some(name=>fs.existsSync(path.join(directory,name)));}
function createAppUpdater({app,onChange=()=>{},beforeInstall=async()=>{},autoUpdater,dir=app.getPath('userData'),platform=process.platform,env=process.env,now=Date.now,schedule=setTimeout,cancel=clearTimeout,every=setInterval,network=null,uninstallerPresent=()=>hasInstalledWindowsUninstaller(path.dirname(process.execPath),qaBuild),qaBuild=require('../build-identity.cjs').qa,macAvailability=()=>require('./mac-app-update.cjs').macUpdateAvailability({app}),fetch:updateFetch=null,macArm64:arm64Mac=null,stall=fetched.STALL,askWithin=ASK_WITHIN,freshFor=FRESH_FOR,quitAsk=QUIT_ASK,checkWithin=CHECK_WITHIN,closeConnections=closeUpdaterConnections,route=null,updateSignature=null,random=Math.random,resources=process.resourcesPath,readConfig=null,tidySession=null,feedProvider=null,appImageCheck=appImageProblem,stuckAfter=STUCK_AFTER,staleFor=STALE_FOR_MANUAL,installWithin=INSTALL_WITHIN,pauseLasts=PAUSE_LASTS,damagedHold=DAMAGED_HOLD,holdBypassEvery=HOLD_BYPASS_EVERY,guardSchedule=setTimeout,guardCancel=clearTimeout,room=null,firstByte=fetched.FIRST_BYTE}){
 const file=path.join(dir,'updater.json');
 const testing=Boolean(env.ACIRA_UPDATE_TEST),stubbed=testing&&Boolean(env.ACIRA_UPDATE_STUB);
 if(stubbed&&env.ACIRA_UPDATE_TEST_PLATFORM==='win32')platform='win32'; // test-only: the stand-in updater takes the Windows route (setup, differential) on any computer
 if(testing&&/^\d+$/.test(String(env.ACIRA_UPDATE_TEST_FRESH_MS||'')))freshFor=Number(env.ACIRA_UPDATE_TEST_FRESH_MS); // test-only: a live rig need not wait 5 minutes for a stale answer
 const version=testing&&env.ACIRA_UPDATE_TEST_VERSION?String(env.ACIRA_UPDATE_TEST_VERSION):app.getVersion();
 let autoDownload=true,channel=/-/.test(String(version))?'beta':'stable'; // a pre-release build follows pre-releases until the person chooses Stable
 let saved={};try{saved=JSON.parse(fs.readFileSync(file,'utf8'));}catch{}
 autoDownload=saved.autoDownload!==false;if(CHANNELS.includes(saved.channel))channel=saved.channel;
 // The founder's own machines can be pointed at the testers folder of the new host (docs/launch/UPDATE_HOST.md): updater.json "testersFeed": true, set with
 // scripts/update-tester.mjs. There is no Settings control, and it only ever means https://update.acirabrowser.com/testers/ (never GitHub, never another address).
 const testersFeed=saved.testersFeed===true;
 // The notes of the update that was downloaded last, kept with its version so they are still there after the restart that installs it.
 let pending=saved.pending&&typeof saved.pending.version==='string'?{version:saved.pending.version,notes:String(saved.pending.notes||'')}:null;
 // First launch on a new version: a note, once. A file without lastRunVersion (fresh install, or a build from before this existed) is not an update.
 const lastRun=typeof saved.lastRunVersion==='string'?saved.lastRunVersion:null;
 const whatsNew=lastRun&&lastRun!==version?{version,notes:pending?.version===version?pending.notes:''}:null;
 if(pending&&pending.version===version)pending=null; // spent: it described the version that is now running
 // Acira's own download of an update file, running or paused (its bytes are in <electron-updater's cache>/acira-partial, update-download.cjs). It belongs
 // to the version that started it: a launch on any other version (the update installed, or another build) drops it with its bytes.
 const heldFrom=raw=>raw&&typeof raw==='object'&&typeof raw.version==='string'&&typeof raw.sha512==='string'&&raw.sha512&&Number.isSafeInteger(raw.size)&&raw.size>0
  ?{version:raw.version,from:String(raw.from||''),sha512:raw.sha512,size:raw.size,notes:String(raw.notes||'').slice(0,NOTES_MAX),paused:raw.paused===true,pausedAt:Number.isFinite(raw.pausedAt)?raw.pausedAt:null,dir:fetched.ownDir(raw.dir)?raw.dir:null}:null;
 let held=heldFrom(saved.download);
 if(held&&(held.from!==version||held.version===version)){fetched.discard(held.dir);held=null;}
 // A pause is for a while, not for good: it counts from the moment it was made, and one older than pauseLasts is dropped, so the download goes on by itself.
 if(held?.paused){if(held.pausedAt===null)held.pausedAt=now();else if(now()-held.pausedAt>pauseLasts)Object.assign(held,{paused:false,pausedAt:null});}
 // The trouble this version had in a row (kind, count, hard ones), and the installs that were started on this version and did not take (the version is still the old one).
 // Both belong to the version that wrote them and go with a launch on another. After two misses a fresh file is downloaded; after three the silent install at quit is off.
 let trouble=null;{const raw=saved.trouble;if(raw&&typeof raw==='object'&&raw.from===version&&Number.isInteger(raw.count)&&raw.count>0)trouble={from:version,count:raw.count,hard:Number.isInteger(raw.hard)?raw.hard:0,first:Number(raw.first)||now(),last:Number(raw.last)||now(),kind:String(raw.kind||'other'),version:typeof raw.version==='string'?raw.version:null};}
 let attempt=null,missed=0;{const raw=saved.attempt;if(raw&&typeof raw==='object'&&raw.from===version&&typeof raw.to==='string'&&raw.to!==version&&Number.isInteger(raw.n)&&raw.n>0){attempt={from:version,to:raw.to,n:raw.n};missed=raw.n;}}
 let freshen=missed===2; // (once: a fresh copy is fetched when the second install did not take, not at every launch after that)
 // written whole to a side file and renamed into place, so a crash while it is written never leaves a torn updater.json (which reads as empty: the pause and the held download forgotten)
 const persist=()=>{
  const data=JSON.stringify({autoDownload,channel,lastRunVersion:version,...(testersFeed?{testersFeed:true}:{}),...(pending?{pending}:{}),...(held?{download:held}:{}),...(trouble?{trouble}:{}),...(attempt?{attempt}:{})}),side=file+'.'+process.pid+'.tmp';
  try{fs.mkdirSync(dir,{recursive:true});}catch{/* the write below says so */}
  try{fs.writeFileSync(side,data,{mode:0o600});fs.renameSync(side,file);}
  catch{try{fs.rmSync(side,{force:true});}catch{}try{fs.writeFileSync(file,data,{mode:0o600});}catch{throw new Error('The update preference could not be saved.');}}
 };
 if(lastRun!==version||(saved.pending&&!pending)||(saved.download&&!held)||(saved.trouble&&!trouble)||(saved.attempt&&!attempt))try{persist();}catch{} // remember this version as the one that ran, so the note never shows for it again
 const installed=platform==='win32'&&app.isPackaged&&uninstallerPresent();
 // a QA build (its own identity, desktop/build-identity.cjs) never updates itself: the update would be the real Acira's installer
 const unsupported=stubbed?null:!app.isPackaged?'Updates apply to the installed app, not a development run.':qaBuild&&!env.ACIRA_UPDATE_TEST?'Updates are off in QA builds.':env.ACIRA_BROWSER_TEST_DATA&&!env.ACIRA_UPDATE_TEST?'Updates are off while running with a test profile.':platform==='darwin'?macAvailability():platform==='linux'?(env.APPIMAGE?appImageCheck(env.APPIMAGE):'Automatic updates require the AppImage installation.'):platform!=='win32'?'Automatic updates are unavailable on this platform.':!installed?'This is a portable copy. Download new versions from the releases page.':null;
 // transferred/total (bytes) and speed (bytes a second) describe the download in progress; notes are the found version's plain-text release notes (from the
 // feed, so they can be read while it downloads). pausable: Acira's own download is running (or paused), so the interface offers pause and resume.
 // A copy that cannot update itself but is an ordinary installed app (a Mac run from a disk image or Downloads, a read-only folder, a Windows portable copy, a Linux AppImage in a
 // folder it cannot write) still LOOKS, read-only and by the profile's route, so the person learns there is a newer version and is shown the download page (status.lastResort);
 // it never downloads or installs. Development runs, QA builds and test profiles stay silent.
 const checkOnly=Boolean(unsupported)&&app.isPackaged===true&&!qaBuild&&!env.ACIRA_BROWSER_TEST_DATA&&!stubbed&&/^(?:Install Acira before|Install the distribution build in a writable|This is a portable copy|Automatic updates require the AppImage|Move the Acira AppImage)/.test(unsupported); // (a bundle whose signature cannot be verified, or a build with no feed, is not an ordinary install: it stays silent)
 const state={status:unsupported?'unsupported':'idle',version,available:null,progress:null,transferred:null,total:null,speed:null,notes:'',lastChecked:null,error:null,pausable:false};
 const platformName=platform==='darwin'?'mac':platform==='win32'?'windows':'linux';
 const percentOf=(done,total)=>total?Math.max(0,Math.min(100,Math.round(done/total*100))):0;
 // Paused when Acira last quit: it starts paused, with the bytes it has, and looks for nothing until Resume.
 if(held?.paused&&!unsupported){const here=held.dir?fetched.progressOf(held.dir,held):{transferred:0,total:held.size};Object.assign(state,{status:'paused',available:held.version,total:here.total,transferred:here.transferred,progress:percentOf(here.transferred,here.total),notes:held.notes,pausable:true});}
 let updater=null,started=false,installing=false,promptedFor=null,welcomed=false,shownPercent=-1,shownAt=0,failedRound=false;
 // round: the download being run (a pause or a newer start makes every older one stop where it is); resuming: the person asked for this download
 // (Resume), so the look that has to come first (after a relaunch) keeps showing it as downloading and starts it whatever the automatic setting is.
 let round=0,job=null,resuming=false,net=updateFetch,armMac=null,aliveAt=now(),guardTimer=null,installTimer=null,retryAt=null; // retryAt: when the retry ladder tries again (ms since the epoch), or null
 // resumed: Resume was pressed and no new byte has come yet ({from}: the bytes counted at the first progress after it); a failure then goes back to
 // paused, saying the connection failed, instead of hiding the download. quitStep: what atQuit does for this quit (once). installHooks: the listeners
 // MacUpdater's quitAndInstall left on Squirrel.Mac for Install now, removed if that install fails (one left behind restarted Acira at a later hand-over).
 let resumed=null,quitStep=null,installHooks=null,attemptBefore=null,quitAsked=false; // quitAsked: quitAndInstall has been called for the Install now under way (a quit called off before that is not about it); attemptBefore: the install record as it was before Install now, put back when the quit is called off (installCancelled)
 // refused: the files (by SHA-512) found not signed by the application owner in this run, with why; never downloaded again in this run (see refuse).
 const refused=new Map();
 // damaged: how often a file (by SHA-512) failed its check in this run; holdOff: a file that failed twice, not fetched again until the time given; handoffFailures: the same file failing at electron-updater / Squirrel
 const holdOff=new Map(),damaged=new Map(),handoffFailures=new Map();
 // personAsked: a look or a download the person began (Check for updates, Download) is under way; startDownload reads it at once. bypassed: when a person's check last lifted a file's hold (by SHA-512).
 // lifting: files whose hold a person's press lifted and whose download is under way (the lift is spent only when that download comes back damaged: a connection that failed, a portal page or a pause spends nothing)
 let personAsked=false;const bypassed=new Map(),lifting=new Set();
 // Mirrors (update-download.cjs): the address of a file that worked last (kept for LEANS_FOR, so a pause or a retry does not wait again on one that was silent), and the addresses
 // that supplied the bytes of a file that failed its SHA-512 (skipped on the next try, unless that leaves none). In memory only: every launch asks the first address first.
 const leaning=new Map(),suspect=new Map();
 // background: the newer version downloaded quietly while a whole one is 'ready' (which stays offered until the newer one is whole). handing: the newer
 // file is being handed to electron-updater (Install now waits for it). looking: a check is under way (a failed look leaves a whole update offered).
 // asking: the feed is asked whether a version is still offered (ask()); its answer is not acted on the usual way. answeredAt: when the feed last
 // answered. watchdog: electron-updater's own download, given up when quiet.
 let background=null,handing=null,looking=false,asking=null,answeredAt=-Infinity,watchdog=null;
 // Pickup (see the top of this file): nextTimer is the pending regular check; hintMs the pace the last document asked for (nextCheckSeconds); lastLook when a look last began;
 // firstRan: the first check, 20 s after start, has happened (a wake or a focus before that does not start one earlier).
 let nextTimer=null,hintMs=null,lastLook=-Infinity,firstRan=false;
 const arm64=()=>typeof arm64Mac==='function'?arm64Mac():testing&&env.ACIRA_UPDATE_TEST_ARCH?env.ACIRA_UPDATE_TEST_ARCH==='arm64':(armMac??=macArm64());
 const retry=createRetry({run:()=>{void check();},schedule,cancel,now,watch:network});
 const alive=()=>{aliveAt=now();};
 // The last-resort path (status.lastResort): offered after HARD_FAILURES failures that are not just a bad connection, or ANY_FAILURES in all; any success or a new version clears it.
 const troubled=error=>{
  const kind=kindOf(error);
  trouble={from:version,count:(trouble?.count||0)+1,hard:(trouble?.hard||0)+(SOFT_KINDS.has(kind)?0:kind==='damaged'||kind==='signature'?2:1),first:trouble?.first??now(),last:now(),kind,version:state.available||trouble?.version||null};
  try{persist();}catch{}
 };
 const succeeded=()=>{retry.succeeded();retryAt=null;if(trouble){trouble=null;try{persist();}catch{}}};
 const lastResort=()=>{
  const newer=checkOnly&&state.available,repeated=Boolean(trouble)&&(trouble.hard>=HARD_FAILURES||trouble.count>=ANY_FAILURES),notTaking=missed>=2; // notTaking: two installs of this version did not take (a launch on it again); only a new version clears it
  if(!newer&&!repeated&&!notTaking)return null;
  let arch=null;if(platform==='darwin'){try{arch=arm64()?'arm64':'x64';}catch{/* unknown */}}else if(platform==='win32')arch='x64';
  return {url:DOWNLOAD_PAGE,platform:platformName,arch,version:state.available||trouble?.version||attempt?.to||null,kind:newer?'unsupported':repeated?trouble.kind:'install'};
 };
 // An install that was started (Install now, or the quit with an update waiting) is recorded; a launch on the same version afterwards counts it as a miss (above).
 const attemptStarted=to=>{if(!to||unsupported)return;attempt={from:version,to,n:(attempt&&attempt.to===to?attempt.n:0)+1};try{persist();}catch{}};
 // electron-updater both emits 'error' and rejects the check: one failure per attempt
 const failed=error=>{if(failedRound||unsupported)return;failedRound=true;troubled(error);const delay=retry.failed();retryAt=delay===null?null:now()+delay;};
 // The one question ("Install now / Later / Read more") is asked once for each downloaded version; Later never brings it back, the pill does.
 const wantsPrompt=()=>state.status==='ready'&&state.available!==null&&promptedFor!==state.available;
 // The first launch on a new version: its notes, shown once in a popup (only when the feed had notes; without them a quiet toast says it, see main announceUpdate).
 const wantsWelcome=()=>Boolean(whatsNew?.notes)&&!welcomed;
 const status=()=>({...state,autoDownload,channel,testersFeed,supported:!unsupported,reason:unsupported,lastResort:lastResort(),interrupted:state.status==='error'&&Boolean(state.available)&&(state.total!==null||held!==null)/* held: a download was begun; the 8 Nov incident got 0 bytes, so no progress had ever been reported */,cause:state.status==='error'&&trouble?causeOf(trouble.kind):null,retry:{failures:trouble?.count||0,at:retryAt},prompt:wantsPrompt(),welcome:wantsWelcome(),whatsNew:whatsNew?{version:whatsNew.version,notes:whatsNew.notes}:null});
 const changed=()=>{watch();try{onChange(status());}catch{/* the interface refreshes on its next look */}};
 // Something that is 'checking' or 'downloading' and shows no sign of life (a byte, a new state) for stuckAfter starts again from a clean check, whatever it was waiting for.
 function watch(){
  const busy=state.status==='checking'||state.status==='downloading';
  if(!busy){if(guardTimer!==null){guardCancel(guardTimer);guardTimer=null;}return;}
  if(guardTimer!==null)return;
  const wait=ms=>{guardTimer=guardSchedule(()=>{guardTimer=null;if(state.status!=='checking'&&state.status!=='downloading')return;const left=stuckAfter-(now()-aliveAt);if(left>0)return wait(left);unstick();},Math.max(1,ms));guardTimer?.unref?.();};
  wait(stuckAfter);
 }
 function unstick(){
  const error=Object.assign(new Error('The update stopped without an answer. Acira starts over.'),{code:'ERR_UPDATE_STUCK'});
  round++;job?.controller.abort();job=null;disarm();handing=null;resumed=null;looking=false;failedRound=false;
  if(asking){asking.finish(null);asking=null;}
  if(updater&&updater.checkForUpdatesPromise)updater.checkForUpdatesPromise=null;
  try{closeConnections();}catch{/* outside Electron */}
  fail(error);
 }
 /** Ends an Install now under way: the Squirrel.Mac hooks it left are removed, the latch released. */
 function endInstall(){
  if(installTimer!==null){guardCancel(installTimer);installTimer=null;}
  if(installing&&installHooks){for(const listener of installHooks.added)installHooks.native.removeListener('update-downloaded',listener);installHooks=null;}
  // electron-updater (Windows, Linux) ignores a second quitAndInstall while its own flag says one was made ("install call ignored"): without this the
  // next press of Install now got through Acira's latch and then did nothing there, and only the press after it worked.
  if(installing&&updater&&updater.quitAndInstallCalled===true)updater.quitAndInstallCalled=false;
  installing=false;quitAsked=false;
 }
 /** The quit that Install now began was refused or called off (Cancel on the "Leave this site?" or "Close Acira?" card, a page that stayed, a window that
  *  could not close; main tells it through restart.calledOff). The person changed their mind, so nothing failed: the latch is released at once and the
  *  press is not counted as an install that did not take. Install now works again, with nothing to wait for. Nothing under way: nothing happens. */
 function installCancelled(){
  if(!installing||!quitAsked)return false; // (still saving the session: some other close was called off, not this press)
  endInstall();
  attempt=attemptBefore;attemptBefore=null;try{persist();}catch{}
  changed();
  return true;
 }
 function setup(){
  if(updater||unsupported)return updater;
  updater=stubbed?createStubUpdater({env,dir,platform,app,version}):autoUpdater||require('electron-updater').autoUpdater;
  // A signed build's updates are checked for Acira's signature by Acira's own helper: electron-updater's own check would start a script host.
  if(platform==='win32'&&!stubbed&&'verifyUpdateCodeSignature' in updater)updater.verifyUpdateCodeSignature=updateSignature||require('../windows-helper.cjs').updateSignatureCheck({packaged:app?.isPackaged});
  // Acira downloads the file itself (startDownload: resumable, pausable); electron-updater finds updates, then takes the finished file from its cache.
  updater.autoDownload=false;updater.autoInstallOnAppQuit=missed<3;updater.allowPrerelease=channel==='beta';updater.channel=channel==='beta'?'beta':'latest';updater.allowDowngrade=false; /* each release carries latest.yml (Stable) and beta.yml (Beta); setting a channel turns allowDowngrade on, so it is reset */ updater.logger=null;
  if(!stubbed)tidyUpdateSession();
  chooseFeeds();
  // A whole update ('ready') stays what the person is offered while Acira looks again (Windows checks while it waits): the same version found again,
  // a failed look (offline) and the look itself change nothing on screen (no flicker to "downloading" or back to "available"). A newer version is
  // downloaded quietly behind it and replaces it only once whole; until then Install now and install-on-quit take the whole one. It is pulled
  // (pullDownloaded) only by the feed itself: that version halted or out of this install's rollout, or the feed back on an older build. A newer
  // build this install is not offered (outside its staged rollout, or halted) pulls nothing.
  // (paused: the person paused while this look was on its way; it stays paused)
  updater.on('checking-for-update',()=>{if(asking)return;alive();failedRound=false;if(state.status==='ready'||state.status==='paused')return;if(!resuming)state.status='checking';state.error=null;changed();});
  // a found update counts as success only when nothing is downloaded automatically: a download that keeps failing must climb the ladder, not restart it
  updater.on('update-available',info=>{
   if(asking)return asking.finish(!info?.version||info.version===asking.version?'same':lowerThan(info.version,asking.version)?'pulled':'newer');
   answeredAt=now();alive();noteHint(info);
   if(state.status==='ready'){
    if(!info?.version||info.version===state.available){succeeded();state.lastChecked=now();changed();return;} // the same update, already whole
    if(!lowerThan(info.version,state.available)){
     // newer: fetched behind the whole one with Acira's own download (automatic download on). Never with electron-updater's own: it empties its cache,
     // the setup that waits included, when its download fails. Off, or not describable, the newer one is found again after this one installs.
     state.lastChecked=now();changed();
     if(background===info.version)return;
     if(autoDownload&&updateFile(updater,{platform,arm64})){background=info.version;void startDownload();}else succeeded();
     return;
    }
    pullDownloaded(); // an older build than the one downloaded: the feed went back (a rollback); the older one is offered the usual way below
   }
   if(info?.version&&info.version!==state.available){state.progress=null;state.transferred=state.total=state.speed=null;}
   state.available=info?.version||null;state.notes=notesText(info?.releaseNotes);shownPercent=-1;
   // paused while this look was under way: it stays paused
   const paused=state.status==='paused',go=!paused&&(autoDownload||resuming);resuming=false;
   state.status=paused?'paused':go?'downloading':'available';if(!go)succeeded();changed();
   if(go)void startDownload();
  });
  // Nothing for this install. The feed's version says why: newer than the update that waits is a newer build this install is not offered (outside its
  // staged rollout, or halted), which leaves the waiting update as it is; the same version or older is that update halted, out of the rollout or
  // rolled back, so it is pulled. (Without a version, it is pulled: the safe side.)
  const supersededOnly=(info,version)=>Boolean(info?.version&&version&&lowerThan(version,info.version));
  updater.on('update-not-available',info=>{
   if(asking)return asking.finish(supersededOnly(info,asking.version)?'same':'pulled');
   answeredAt=now();noteHint(info);succeeded();resuming=false;resumed=null;disarm();stopBehind();
   if(held){fetched.discard(held.dir);held=null;try{persist();}catch{}}
   if(state.status==='ready'&&supersededOnly(info,state.available)){state.lastChecked=now();changed();return;}
   if(state.status==='ready')pullDownloaded();
   state.status='current';state.available=null;state.progress=state.transferred=state.total=state.speed=null;state.notes='';state.pausable=false;state.lastChecked=now();changed();
  });
  // electron-updater's own download, when it downloads by itself (see startDownload); each byte keeps its watchdog quiet
  updater.on('download-progress',progress=>{rearm();progressed({percent:progress?.percent,transferred:progress?.transferred,total:progress?.total,bytesPerSecond:progress?.bytesPerSecond});});
  updater.on('update-downloaded',info=>{
   disarm();background=null;resumed=null;damaged.clear();lifting.clear();updater.autoInstallOnAppQuit=missed<3; // a pulled build had turned it off; this one the feed offers (three installs that did not take switch the silent install at quit off: Install now stays)
   succeeded();state.status='ready';state.available=info?.version||state.available;state.progress=100;state.speed=null;state.pausable=false;state.lastChecked=now();state.notes=notesText(info?.releaseNotes)||state.notes;
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
 /** The addresses this build asks, in order (update-hosts.cjs): the one its app-update.yml names, then the frozen GitHub feed when that is the new host; only
  *  the testers folder when this computer opted in. Test mode (ACIRA_UPDATE_TEST) can name a local feed, and a second one to rehearse the fallback. */
 function feedList(){
  if(env.ACIRA_UPDATE_TEST&&env.ACIRA_UPDATE_FEED){
   const list=[{name:'primary',url:env.ACIRA_UPDATE_FEED}];
   if(env.ACIRA_UPDATE_FEED_FALLBACK)list.push({name:'fallback',url:env.ACIRA_UPDATE_FEED_FALLBACK});
   return list;
  }
  if(stubbed)return [];
  let text=null;
  try{text=readConfig?readConfig():fs.readFileSync(path.join(resources||'','app-update.yml'),'utf8');}catch{/* no app-update.yml: electron-updater's own default */}
  return hosts.feedsFor({primary:hosts.feedUrlFromConfig(text),testers:testersFeed});
 }
 /** Hands the list to electron-updater as one provider that applies the fallback rules (update-feeds.cjs). No list, or no setFeedURL: its own default. */
 function chooseFeeds(){
  const feeds=feedList();
  if(!feeds.length||typeof updater.setFeedURL!=='function')return;
  const within=raw=>{const value=Number(env.ACIRA_UPDATE_TEST&&raw);return Number.isFinite(value)&&value>0?value:undefined;}; // test-only: a rig need not wait 15 s for a silent first address
  let updateProvider=null;
  if(!stubbed){try{updateProvider=feedProvider||feedRules.createFeedProviderClass();}catch{return;}}
  // floor: what this computer already knows (an update found or downloaded): a later address only counts when it offers something newer than that
  updater.setFeedURL({provider:'custom',updateProvider,feeds,current:version,floor:()=>state.available,primaryWithin:within(env.ACIRA_UPDATE_TEST_PRIMARY_WITHIN_MS),fallbackWithin:within(env.ACIRA_UPDATE_TEST_FALLBACK_WITHIN_MS)});
 }
 /** Update traffic says only "AciraUpdater" (no version, no system). */
 function tidyUpdateSession(){try{if(tidySession)tidySession();else updaterSession();}catch{/* outside Electron */}}
 /** A failed look or download. A whole update stays offered when only a look failed (offline) or only the newer download behind it failed (its file
  *  is untouched until the newer one is handed over: background is cleared first). Install now can be clicked again (electron-updater could not start
  *  the installer, for example). A Resume that got no new byte (offline, the feed unreachable) is paused again with its bytes, and says the connection
  *  failed (error is set while paused): before, the panel closed under the pointer and the dots went, with no word. Anything else shows the error quietly. */
 function fail(error){
  // (endInstall, above, ends an Install now under way: only a failure that leaves nothing ready does; a look failing beside a waiting update leaves Install now going.)
  const back=resumed;resumed=null;resuming=false;disarm();
  if(state.status==='paused'){endInstall();return;} // a look that was under way when the person paused: paused stays paused
  state.speed=null;state.lastChecked=now();
  if(back&&state.status==='downloading'){
   endInstall();round++;job?.controller.abort();job=null;
   Object.assign(state,{status:'paused',pausable:true,error:friendly(error)});if(held){Object.assign(held,{paused:true,pausedAt:now()});try{persist();}catch{}}
   changed();return; // off the network for updates again until the next Resume, as a pause is
  }
  const retryable=error?.code!=='ERR_UPDATER_INVALID_SIGNATURE'; // a setup not signed by the application owner: another try gets the same file
  if(state.status==='ready'&&(looking||background)){if(background){background=null;if(retryable)failed(error);}changed();return;}
  endInstall();state.status='error';state.error=friendly(error);if(retryable)failed(error);changed();
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
  alive();
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
 async function fetchBlockMap(url,within=30000){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),within);timer.unref?.();
  try{
   net??=updaterFetch();
   const response=await net(url,{headers:requestHeaders(),signal:controller.signal,redirect:'follow'});
   if(!response.ok)throw new Error('HTTP '+response.status);
   const raw=Buffer.from(await response.arrayBuffer());
   if(!raw.length||raw.length>fetched.MAP_MAX)throw new Error('Not a blockmap.');
   fetched.readBlockMap(raw);return raw;
  }finally{clearTimeout(timer);}
 }
 /** The new setup's blockmap from the first address of the file that has it (its own, then its mirrors'); the mirror that answered is then asked for the file first. */
 async function newBlockMap(target){
  const addresses=[target.url,...(target.mirrors||[])];let last=null;
  for(let index=0;index<addresses.length;index++){
   try{const raw=await fetchBlockMap(blockMapUrl(addresses[index]),index<addresses.length-1?firstByte:30000);if(index>0)leaning.set(target.sha512,{url:addresses[index],at:now()});return raw;}catch(error){last=error;}
  }
  throw last;
 }
 /** {plan, oldFile, newRaw} for a differential download, {newRaw} for the whole setup (its blockmap still goes into the cache for next time). */
 async function differential(target,where){
  const oldFile=path.join(where.cache,'installer.exe');
  let oldSize=0;try{oldSize=fs.statSync(oldFile).size;}catch{}
  const maps=oldSize?fetched.loadMaps(where.dir,{sha512:target.sha512,oldSize}):null;
  const newRaw=maps?.newRaw||(newMap?.sha512===target.sha512?newMap.raw:await newBlockMap(target).catch(()=>null));
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
  alive();
  if(!target){if(behind)background=null;else void updaterDownloads(id);return;}
  if(refused.has(target.sha512)){ // found not signed by the application owner in this run: not downloaded again (a fix is another file)
   if(behind){background=null;return;}
   retry.succeeded();troubled(Object.assign(new Error(refused.get(target.sha512)),{code:'ERR_UPDATER_INVALID_SIGNATURE'}));Object.assign(state,{status:'error',error:refused.get(target.sha512),speed:null,pausable:false,lastChecked:now()});changed();return;
  }
  // a file that failed its SHA-512 twice is not fetched again for a while (each 2-hour round used to download 200 MB again); a new hash in the feed starts at once
  // (a person's own Check for updates, or Download, lifts the hold once in holdBypassEvery for that file: two bad copies from the CDN must not keep a good file away for hours when
  //  the person asks; the automatic rounds still wait, and a file that fails twice again is held again, out of reach of another press for holdBypassEvery)
  const hold=holdOff.get(target.sha512),asked=personAsked;
  if(hold&&hold.until>now()){
   const last=bypassed.get(target.sha512);
   if(asked&&!behind&&(last===undefined||now()-last>=holdBypassEvery))lifting.add(target.sha512);
   else{
    if(behind){background=null;return;}
    Object.assign(state,{status:'error',error:hold.message,speed:null,pausable:false,lastChecked:now()});troubled(Object.assign(new Error(hold.message),{code:'ERR_UPDATE_DAMAGED'}));changed();return;
   }
  }
  if(hold)holdOff.delete(target.sha512);
  if(held&&held.sha512!==target.sha512){fetched.discard(held.dir);held=null;} // the feed moved on: the old bytes go
  held={version:target.version||state.available||'',from:version,sha512:target.sha512,size:target.size,notes:behind?'':state.notes,paused:false,pausedAt:null,dir:held?.dir||null};
  if(!behind)state.pausable=true;
  const where=await cacheOf();
  if(id!==round)return;
  if(!where){held=null;try{persist();}catch{}if(behind)background=null;else void updaterDownloads(id);return;}
  held.dir=where.dir;try{persist();}catch{}
  let stage='download';
  try{
   // room for it: a full disk fails early with a plain sentence (the bytes already here stay for when there is space)
   const lack=await fetched.shortOfSpace(where.dir,{sha512:target.sha512,size:target.size,margin:DISK_MARGIN,statfs:room});
   if(id!==round)return;
   if(lack)throw Object.assign(new Error(`There is not enough free space to download the update: about ${Math.round(lack.need/1048576)} MB are needed and ${Math.round(lack.free/1048576)} MB are free.`),{code:'ERR_UPDATE_DISK'});
   // a launch that downloaded it whole and quit before electron-updater took it: nothing to download
   let give=null,file=null;
   if(freshen){freshen=false;await where.helper.clear().catch(()=>{});} // two installs of this file did not take: a fresh, verified copy
   let already=fetched.handedOver({pendingDir:where.pending,sha512:target.sha512,size:target.size});
   // electron-updater checks the file's hash itself and, finding it wrong, downloads by itself (no pause, no watchdog): Acira checks first and keeps the download its own
   if(already&&await fetched.hashFile(pendingFile(where,target)).then(hash=>hash!==target.sha512,()=>true)){await where.helper.clear().catch(()=>{});already=false;}
   if(!already){
    if(route){await route();if(id!==round)return;} // the blockmaps and the file leave by the profile's route too
    const diff=platform==='win32'?await differential(target,where).catch(()=>null):null;
    if(id!==round)return;
    const controller=new AbortController();job={id,controller};
    net??=updaterFetch();
    // the file's addresses: its own, then its mirrors (update-download.cjs); those that supplied a file that failed its hash go last of all, and the one that worked last goes first
    const addresses=[target.url,...(target.mirrors||[])],skip=suspect.get(target.sha512),usable=skip&&addresses.some(address=>!skip.has(address))?addresses.filter(address=>!skip.has(address)):addresses;
    const lean=leaning.get(target.sha512),first=lean&&now()-lean.at<LEANS_FOR?Math.max(0,usable.indexOf(lean.url)):0;
    const run=way=>fetched.download({url:usable[0],mirrors:usable.slice(1),first,firstByte,onSource:address=>leaning.set(target.sha512,{url:address,at:now()}),sha512:target.sha512,size:target.size,dir:where.dir,plan:way?.plan||null,oldFile:way?.oldFile||null,headers:requestHeaders(),fetch:net,signal:controller.signal,now,stall,onProgress:progressed});
    // a download that goes quiet (no byte for `stall`) or whose connection drops goes on at once from the byte it had, a few times, before it fails
    const attempt=async way=>{for(let tries=0;;tries++){try{return await run(way);}catch(error){if(id!==round||tries>=RESUMES||!resumable(error))throw error;}}};
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
    stage='handoff';
    await updater.downloadUpdate(); // finds the file in its cache, checks its SHA-512 again, then 'update-downloaded'
   }finally{handing=null;release();}
  }catch(error){
   if(id!==round)return;
   // a damaged file was deleted: it starts again at once, once; the second time it is held off for a while (holdOff), counted as trouble, and the retries below do not begin it again
   if(error?.code==='ERR_CHECKSUM_MISMATCH'){
    const times=(damaged.get(target.sha512)||0)+1;damaged.set(target.sha512,times);
    // (with mirrors: the addresses that supplied its bytes are tried last next time; the second failure is held off whatever the addresses)
    if(times===1&&target.mirrors?.length&&Array.isArray(error.sources)&&error.sources.length){suspect.set(target.sha512,new Set([...(suspect.get(target.sha512)||[]),...error.sources]));leaning.delete(target.sha512);}
    if(times===1){void startDownload();return;}
    suspect.delete(target.sha512);damaged.delete(target.sha512);holdOff.set(target.sha512,{until:now()+damagedHold,message:'The update was downloaded twice and did not match what the feed says. Acira tries again in a few hours.'});if(lifting.delete(target.sha512))bypassed.set(target.sha512,now());
   }
   // the same file failing again at the hand-over (Squirrel.Mac, electron-updater): the second time its cached copy goes, so the next try fetches a fresh one
   if(stage==='handoff'){const times=(handoffFailures.get(target.sha512)||0)+1;handoffFailures.set(target.sha512,times);if(times>=2){handoffFailures.delete(target.sha512);await where.helper.clear().catch(()=>{});}}
   if(error?.code!=='ERR_CHECKSUM_MISMATCH')lifting.delete(target.sha512);
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
 async function check({manual=false}={}){
  if(unsupported)return checkOnly?peek():status();
  // A person's own "Check for updates" breaks what is stuck (no sign of life for staleFor) and ends a pause; an automatic check leaves both alone (a pause, until it expires).
  if(manual&&['checking','downloading'].includes(state.status)&&now()-aliveAt>=staleFor)unstick();
  if(asking)return status(); // Install now (or the end of a download) is asking the feed right now
  if(state.status==='paused'){if(manual||held?.paused&&held.pausedAt!==null&&now()-held.pausedAt>pauseLasts)resume();return status();} // paused: off the network for updates until Resume, or until the pause has lasted pauseLasts
  if(['checking','downloading'].includes(state.status))return status();
  // Mac, 'ready': a downloaded update waits for Install now. Checking again hands it to Squirrel.Mac a second time, which either fails (status 'error':
  // the pill and Install now disappear) or stages a second install under the first. The first check after the restart finds anything newer.
  if(platform==='darwin'&&state.status==='ready')return status();
  return look(manual);
 }
 /** The read-only look of a copy that cannot update itself: the same addresses and rules (update-feeds.cjs), nothing downloaded, no retry ladder (the next round asks again). */
 async function peek(){
  if(looking)return status();
  looking=true;lastLook=now();
  try{
   const feeds=feedList();if(!feeds.length)return status();
   if(route)await route();
   net??=updaterFetch();
   const channelFile=(channel==='beta'?'beta':'latest')+(platform==='darwin'?'-mac':platform==='linux'?'-linux':'')+'.yml';
   const read=await feedRules.readChannel({feeds,channelFile,current:version,floor:()=>null,
    request:async url=>{const response=await net(url,{redirect:'follow'});if(!response.ok)throw Object.assign(new Error('HTTP '+response.status),{code:'ERR_UPDATE_HTTP'});return response.text();},
    parse:text=>{try{return JSON.parse(text);}catch{return require('js-yaml').load(text);}}});
   const info=read.info,offered=!(info.stagingPercentage!==undefined&&Number(info.stagingPercentage)<100)&&lowerThan(version,info.version);
   state.available=offered?info.version:null;state.notes=offered?notesText(info.releaseNotes):'';state.lastChecked=now();changed();
  }catch{/* offline, the route not confirmed, a bad document: nothing to say; the next round asks again */}
  finally{looking=false;}
  return status();
 }
 async function look(byPerson=false){
  failedRound=false;looking=true;lastLook=now();alive();retryAt=null;personAsked=byPerson;
  // route: the check leaves by the active profile's route (its proxy); a route that is not confirmed sends nothing and counts as a failed look
  try{await lookUp();}catch(error){fail(error);}finally{looking=false;personAsked=false;}
  return status();
 }
 // Settings' Download, when updates are not downloaded automatically
 async function download(){if(unsupported||state.status!=='available')return status();alive();failedRound=false;state.status='downloading';state.error=null;changed();setup();personAsked=true;void startDownload();personAsked=false;return status();}
 /** Pause: the download stops where it is and keeps its bytes. The pause is kept in updater.json: a quit and relaunch starts paused, and nothing is
  *  looked for or downloaded until Resume. Only Acira's own download pauses (pausable); electron-updater's could only start again from zero. */
 function pause(){
  if(unsupported||state.status!=='downloading'||!state.pausable)return status();
  round++;job?.controller.abort();job=null;resuming=false;resumed=null;
  state.status='paused';state.speed=null;
  if(held){Object.assign(held,{paused:true,pausedAt:now()});try{persist();}catch{}}
  changed();return status();
 }
 /** Resume: on from the last byte. In the same run electron-updater still knows the file; after a relaunch it looks first (the feed may have moved
  *  on, and then the newer file is downloaded instead), keeping the download on screen while it looks. */
 function resume(){
  if(unsupported||state.status!=='paused')return status();
  if(held){Object.assign(held,{paused:false,pausedAt:null});try{persist();}catch{}}
  alive();state.status='downloading';state.error=null;shownPercent=-1;resumed={from:null};changed();
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
   attemptBefore=attempt;quitAsked=true;attemptStarted(state.available);
   updater.quitAndInstall(true,true);
   if(before){const added=native.listeners('update-downloaded').filter(listener=>!before.has(listener));installHooks=added.length?{native,added}:null;}
   // Acira is still here installWithin later: the quit never came (the "Close Acira?" card was cancelled, a page held it, the installer did not start). The latch is released, so
   // Install now works again, and the try is counted.
   installTimer=guardSchedule(()=>{installTimer=null;if(!installing)return;endInstall();state.error='Acira did not restart to install the update. You can try Restart to update again.';troubled(Object.assign(new Error(state.error),{code:'ERR_UPDATE_INSTALL'}));changed();},installWithin);installTimer?.unref?.();
  }catch(error){installing=false;quitAsked=false;throw error;}
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
  if(!unsupported&&!installing&&state.status==='ready'&&platform==='darwin')attemptStarted(state.available); // a Mac's update is with Squirrel.Mac, which applies it as Acira quits
  if(unsupported||installing||!updater||state.status!=='ready'||platform==='darwin')return Promise.resolve();
  quitStep=(async()=>{
   if(handing){await within(handing,quitAsk);if(handing)return;}else stopBehind(); // the newer download behind it stops here (its bytes stay)
   if(state.status!=='ready')return;
   if(now()-answeredAt>=freshFor&&await within(ask(state.available),quitAsk)==='pulled')await within(pullDownloaded(),quitAsk);
   if(state.status==='ready'&&updater.autoInstallOnAppQuit)attemptStarted(state.available); // electron-updater's quit handler installs it now
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
 /** The next regular check: CHECK_EVERY (or the pace the last document asked for) plus up to CHECK_JITTER, so installs do not all ask in the same minute. */
 function armNext(){
  if(!started)return;
  if(nextTimer!==null&&nextTimer!==undefined){cancel(nextTimer);nextTimer=null;}
  const base=hintMs??CHECK_EVERY,delay=base+Math.floor(random()*Math.min(CHECK_JITTER,base*.2));
  nextTimer=schedule(()=>{nextTimer=null;void check();armNext();},delay);nextTimer?.unref?.();
 }
 /** A document may ask to be looked at again sooner or later: nextCheckSeconds, kept between 10 minutes and 24 hours; absent or invalid, the usual pace. */
 function noteHint(info){
  const seconds=Number(info?.nextCheckSeconds);
  hintMs=Number.isFinite(seconds)&&seconds>0?Math.min(HINT_MAX,Math.max(HINT_MIN,Math.round(seconds*1000))):null;
  armNext();
 }
 /** The computer woke or a window got focus: looks now when the feed's last answer is older than CHECK_EVERY (never within NUDGE_QUIET of the last look, never while busy). */
 function nudge(){
  if(unsupported&&!checkOnly||!started||!firstRan||asking)return false;
  if(['checking','downloading','paused'].includes(state.status))return false;
  const at=now();
  if(at-lastLook<NUDGE_QUIET||at-answeredAt<CHECK_EVERY)return false;
  void check();return true;
 }
 // and while an update waits (Windows; a Mac's waits with Squirrel.Mac and is not looked at again), every READY_RECHECK, so a pulled build is dropped
 function start(){if(started||unsupported&&!checkOnly)return;started=true;const first=schedule(()=>{firstRan=true;void check();armNext();},stubbed?1500:CHECK_DELAY);first?.unref?.();if(platform!=='darwin'){const again=every(()=>{if(state.status==='ready')void check();},READY_RECHECK);again?.unref?.();}}
 return {status,check,nudge,download,pause,resume,setAutoDownload,setChannel,install,installCancelled,claimPrompt,claimWelcome,start,whatsNewInfo,atQuit};
}
module.exports={createAppUpdater,createStubUpdater,kindOf,friendly,notesText,STUCK_AFTER,STALE_FOR_MANUAL,INSTALL_WITHIN,PAUSE_LASTS,DAMAGED_HOLD,HOLD_BYPASS_EVERY,DOWNLOAD_PAGE,NOTES_MAX,updateFile,macArm64,lowerThan,CHECK_EVERY,CHECK_JITTER,CHECK_DELAY,NUDGE_QUIET,UPDATE_USER_AGENT,CHANNELS,READY_RECHECK,QUIT_ASK,CHECK_WITHIN};
