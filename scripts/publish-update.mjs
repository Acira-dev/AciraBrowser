// One command for a release that reaches everyone who already installed Acira, and for steering it once it is out. DRY RUN unless --publish is given:
// it checks everything, prints exactly what would be uploaded and how each channel document would change (a line diff), writes the planned feed files to
// a review folder, and changes nothing remote. With --publish (and --yes, or the version typed at the prompt) it creates the releases on
// Acira-dev/AciraBrowserUpdates, uploads, downloads every payload anonymously and compares its SHA-512, and only then commits the channel documents in
// feed/ (the files installed copies read). Any failure before that last step leaves the feed untouched, so nobody is offered an update that cannot download.
// The live version can then be widened (--widen), halted (--halt), resumed (--resume-rollout), or given its missing Mac architecture (--add-arch).
// --stand-in http://127.0.0.1:<port> sends every GitHub and feed request to a local stand-in (qa/publish-stand-in.mjs) instead: no gh, nothing leaves the computer.
// Usage and rules: docs/launch/RELEASING.md (commands in order) and docs/launch/PUBLIC_UPDATES.md (the feed).
import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {Readable} from 'node:stream';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import readline from 'node:readline/promises';
const require=createRequire(import.meta.url),repo=path.resolve(import.meta.dirname,'..'),run=promisify(execFile);
const semver=require('semver');
const U=require('../packaging/update-publish.cjs');
const T=require('../packaging/update-targets.cjs'),HOSTS=require('../desktop/browser-services/update-hosts.cjs');
const DEFAULT_TARGETS=T.targets(); // legacy: the GitHub raw feed (folder feed/); current: update.acirabrowser.com (folder docs/). Without a target the tool works on legacy, as before beta.11.
const {writeMacUpdateFeed}=require('../packaging/macos/update-feed.cjs');
const COMPAT=require('../packaging/update-compat.cjs');
const BRANCH='main'; // the feed URL in every installed app names this branch (a target says its own: update-targets.cjs)
const MAC_ZIP=/^AciraBrowser-(.+)-mac-(arm64|x64)-update\.zip$/,MAC_DMG=/^AciraBrowser-(.+)-mac-(arm64|x64)\.dmg$/;
const WINDOWS_EXE='AciraBrowserSetup.exe',RECEIPT='mac-widevine-package.json';
const LINUX_IMAGE=/^AciraBrowser-(.+)-linux-x86_64\.AppImage$/,LINUX_SETUP='AciraBrowser-Linux-SetupFiles.zip';
const FEED_EDITS=['widen','halt','resume-rollout','pace'],MODES=[...FEED_EDITS,'add-arch'];
const FILE_OPTIONS=['mac-dir','mac-arm64-zip','mac-x64-zip','mac-arm64-dmg','mac-x64-dmg','windows-dir','windows-exe','windows-blockmap','windows-latest-yml','linux-dir'];

export const HELP=`Usage (each command is a dry run that changes nothing until you add --publish --yes):

  A new version
    node scripts/publish-update.mjs --version <0.1.0-beta.10> --notes-file notes.md [--windows-dir <folder>] [--rollout <percent>]
  The live version
    node scripts/publish-update.mjs --version <live version> --widen <percent>          offer it to more installs (100 = everyone)
    node scripts/publish-update.mjs --version <live version> --halt                     offer it to nobody from their next check on
    node scripts/publish-update.mjs --version <live version> --resume-rollout           offer a halted version again, at its old percentage
    node scripts/publish-update.mjs --version <live version> --add-arch [--mac-x64-zip <file>]   add the Mac architecture it lacks
    node scripts/publish-update.mjs --version <live version> --pace <seconds|clear> --target current   how soon beta.11 and later look again (600 to 86400; older builds ignore it)

  --publish [--yes]          act; without --yes it asks you to type the version
  --channel beta|stable      beta (default) for 0.1.0-beta.N; stable for plain versions (also reaches people on beta)
  --rollout <percent>        a new version reaches only this share of installs (default 100); with --resume-rollout, the share to resume at
  --platform mac|windows     with --widen/--halt/--resume-rollout: only that platform's documents (default: each one that offers --version)
  --notes-file <file>        what's new, one bullet per line; or --notes "<text>"; --no-notes publishes without notes
  --mac-dir <folder>         release/mac-widevine-<version>-<commit>.noindex (default: found in release/ from --version)
  --mac-arm64-zip --mac-x64-zip --mac-arm64-dmg --mac-x64-dmg <file>      exactly these Mac files, nothing found added (each beside its ${RECEIPT})
  --windows-dir <folder>     the folder npm run build:windows wrote (AciraBrowserSetup.exe, its .blockmap, latest.yml); or --windows-exe <file>
  --linux-dir <folder>       the folder the Linux machine handed over (the AppImage, AciraBrowser-Linux-SetupFiles.zip, HANDOFF.json)
  --target legacy|current    where the documents go: legacy (default) is the GitHub raw feed, current is update.acirabrowser.com (packaging/update-targets.cjs)
  --no-dmg                   do not upload the disk images found beside the Mac update ZIPs (the bridge release)
  --hold                     create the releases hidden from the website (a marker line in their body) until they are unheld (scripts/release-publish.mjs)
  --windows-assume-updater   the Windows setup is known to carry resources/app-update.yml (otherwise the Windows feed is left alone)
  --windows-download-only    publish the Windows setup for download without a Windows feed entry
  --allow-missing-blockmaps  emergency only: publish although the live setup's blockmap cannot be read (copies of it then download the whole setup)
  --allow-single-arch        publish only the arm64 Mac build now (Intel Macs see failed update checks until --add-arch adds x64)
  --review-dir <folder>      where the dry run writes the planned feed files (default release/update-review/<version>-<channel>)
  --rehearsal                dry run only, never with --publish: tolerate artifacts built as another version than --version (to try the tool on an old build)
  --commit <hex>             tag suffix when the artifacts carry no commit
  --no-wait                  do not wait for the feed CDN after publishing
  --mirror-base <url>        a second host for the files (an https folder address that is not GitHub or the update host): every file the feed hands out also gets
                             files[].mirrors = <url>/<release tag>/<file name>, so a copy of Acira whose first address is down or silent (the 8 Nov 2026 GitHub incident) fetches
                             it from there (beta.13.2 and later). The files must already be on that host, byte for byte: the dry run lists what to put where, and refuses if a copy
                             differs; --publish also refuses a copy that is not there. Only with a new version or --add-arch.
  --stand-in <url>           testing: a local stand-in for GitHub and the feed (http://127.0.0.1:<port>, qa/publish-stand-in.mjs); never gh, never github.com
`;

export function parseArguments(argv){
 const flags=new Set(['no-dmg','hold','publish','rehearsal','yes','no-notes','allow-single-arch','windows-download-only','windows-assume-updater','no-wait','help','halt','resume-rollout','add-arch','allow-missing-blockmaps']);
 const values=new Set(['pace','version','channel','notes','notes-file','mac-dir','mac-arm64-zip','mac-x64-zip','mac-arm64-dmg','mac-x64-dmg','windows-dir','windows-exe','windows-blockmap','windows-latest-yml','linux-dir','target','review-dir','commit','rollout','widen','platform','mirror-base','stand-in']);
 const options={};
 for(let index=0;index<argv.length;index++){
  const argument=argv[index];if(!argument.startsWith('--'))throw Error('Unexpected argument '+argument+'.\n\n'+HELP);
  const name=argument.slice(2);
  if(flags.has(name))options[name]=true;
  else if(values.has(name)){const value=argv[++index];if(value===undefined||value.startsWith('--'))throw Error('--'+name+' needs a value.');options[name]=value;}
  else throw Error('Unknown option '+argument+'.\n\n'+HELP);
 }
 if(options.target!==undefined&&!['legacy','current'].includes(options.target))throw Error('--target is legacy or current.');
 if(options['mirror-base']!==undefined){
  const other=MODES.find(name=>name!=='add-arch'&&options[name]!==undefined);
  if(other)throw Error('--mirror-base names the mirror copies of the files of a new version (or of --add-arch); --'+other+' changes the live documents only.');
  options['mirror-base']=checkMirrorBase(options['mirror-base']);
 }
 // combinations that would mean two different things
 const modes=MODES.filter(name=>options[name]!==undefined);
 if(modes.length>1)throw Error('Choose one of --'+modes.join(', --')+'.');
 if(options.widen!==undefined)U.parsePercent(options.widen,'--widen');
 if(options.rollout!==undefined){
  U.parsePercent(options.rollout,'--rollout');
  if(modes.length&&!options['resume-rollout'])throw Error('--rollout sets the share for a new version (or the one --resume-rollout resumes at); --widen raises the live one.');
 }
 if(options.platform!==undefined){
  if(!U.ALL_PLATFORMS.includes(options.platform))throw Error('--platform is mac, windows or linux.');
  if(!FEED_EDITS.some(name=>options[name]!==undefined))throw Error('--platform goes with --widen, --halt or --resume-rollout; a new version takes its platforms from the files you give.');
 }
 const edit=FEED_EDITS.find(name=>options[name]!==undefined);
 if(edit){const files=FILE_OPTIONS.filter(name=>options[name]!==undefined);if(files.length)throw Error('--'+edit+' changes the live channel documents only; it takes no files (--'+files.join(', --')+').');}
 if(modes.length&&options.rehearsal)throw Error('--rehearsal tries the tool on an old build; it does not go with --'+modes[0]+'.');
 const named=['mac-arm64-zip','mac-x64-zip','mac-arm64-dmg','mac-x64-dmg'].filter(name=>options[name]!==undefined);
 if(options['mac-dir']&&named.length)throw Error('Name the Mac files (--'+named.join(', --')+') or give a folder to search (--mac-dir), not both: named files are used exactly as given.');
 if(options['add-arch']&&(options['windows-dir']||options['windows-exe']))throw Error('--add-arch adds a Mac architecture; the Windows build has one (x64).');
 return options;
}

/** --mirror-base: a folder address on a host that is NOT GitHub (the point of a mirror is to survive its outage; the update host is GitHub Pages) and that a copy of Acira can fetch
 *  with no login: https (http only to this computer, for tests), no credentials, query or fragment. Resolves to the address with its trailing slash. */
export function checkMirrorBase(value){
 let url;try{url=new URL(String(value));}catch{throw Error('--mirror-base must be an address, like https://downloads.example.com/acira/ .');}
 const local=/^(?:localhost|127\.0\.0\.1|\[::1\])$/.test(url.hostname);
 if(url.protocol!=='https:'&&!(url.protocol==='http:'&&local))throw Error('--mirror-base must be an https address (http only on this computer, for tests).');
 if(url.username||url.password||url.search||url.hash)throw Error('--mirror-base is a plain folder address: no credentials, query or fragment.');
 const host=url.hostname.toLowerCase();
 if(/(^|\.)(?:github\.com|githubusercontent\.com|github\.io)$/.test(host)||host===new URL(HOSTS.HOST_URL).hostname)throw Error('--mirror-base is on GitHub (the update host is GitHub Pages): a mirror there goes down in the same outage as the first address. Use another host.');
 return url.href.endsWith('/')?url.href:url.href+'/';
}
const exists=file=>fs.access(file).then(()=>true,()=>false);
const readJSON=async file=>JSON.parse(await fs.readFile(file,'utf8'));
const mb=bytes=>bytes>=1048576?(bytes/1048576).toFixed(1)+' MB':Math.max(1,Math.round(bytes/1024))+' KB';
const receiptBeside=file=>readJSON(path.join(path.dirname(file),RECEIPT)).catch(()=>null); // the packager writes one per architecture folder

/** gh through the real CLI; input goes to stdin. Tests pass a fake with the same shape. */
export function ghCli(){
 return (args,{input}={})=>new Promise((resolve,reject)=>{
  const child=spawn('gh',args,{stdio:['pipe','pipe','pipe']});let out='',err='';
  child.stdout.on('data',chunk=>{out+=chunk;});child.stderr.on('data',chunk=>{err+=chunk;});
  child.on('error',error=>reject(Error('Cannot run gh ('+error.message+'). Install the GitHub CLI and run gh auth login.')));
  child.on('close',code=>code===0?resolve(out):reject(Object.assign(Error('gh '+args.slice(0,3).join(' ')+' failed: '+(err.trim()||out.trim()).slice(0,400)),{stderr:err,stdout:out,code})));
  child.stdin.end(input??'');
 });
}
/** The same gh and anonymous fetch, served by a local stand-in (qa/publish-stand-in.mjs). Only a loopback http address is accepted, gh is never run,
 *  and any URL that is not a release download or the public feed is refused, so a stand-in run cannot reach GitHub or anything else. */
export function standInTransport(address){
 let base;try{base=new URL(address);}catch{throw Error('--stand-in needs an address such as http://127.0.0.1:8123.');}
 if(base.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(base.hostname)||base.username||base.password)throw Error('--stand-in must be a local address (http://127.0.0.1:<port>): the stand-in never reaches GitHub.');
 const root=base.origin;
 const failed=(args,body)=>{let detail;try{detail=JSON.parse(body);}catch{detail={message:body};}return Object.assign(Error('gh '+args.slice(0,3).join(' ')+' failed: '+String(detail.message||'').slice(0,400)),{stderr:detail.stderr||detail.message||''});};
 const gh=async(args,{input}={})=>{
  if(args[0]==='release'&&args[1]==='upload'){ // gh names the asset after the file; its bytes go up as the request body
   const file=args[3],response=await fetch(root+'/upload/'+encodeURIComponent(args[2])+'/'+encodeURIComponent(path.basename(file)),{method:'PUT',body:Readable.toWeb(createReadStream(file)),duplex:'half'});
   const body=await response.text();if(!response.ok)throw failed(args,body);return body;
  }
  const response=await fetch(root+'/gh',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({args,input:input??''})}),body=await response.text();
  if(!response.ok)throw failed(args,body);return body;
 };
 const escape=text=>text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 const repos=[...new Set([U.UPDATE_REPOSITORY,DEFAULT_TARGETS.legacy.repo,DEFAULT_TARGETS.current.repo])];
 const download=new RegExp('^https://github\\.com/(?:'+repos.map(escape).join('|')+')/releases/download/([^/]+)/([^/?#]+)$'),raw=new RegExp('^'+escape(DEFAULT_TARGETS.legacy.publicBase)+'([^?#]+)$'),pages=new RegExp('^'+escape(HOSTS.HOST_URL)+'([^?#]+)$');
 const standInFetch=(url,init)=>{
  const href=String(url),release=download.exec(href),feed=raw.exec(href),page=pages.exec(href);
  if(release)return fetch(root+'/download/'+release[1]+'/'+release[2],init);
  if(feed)return fetch(root+'/raw/feed/'+feed[1],init);
  if(page)return fetch(root+'/pages/'+page[1],init);
  return Promise.reject(Error('stand-in run: '+href+' is neither a release download nor the feed, and nothing else is fetched.'));
 };
 return {gh,fetch:standInFetch,label:root,delays:[100,300,600]};
}
const ghJson=async(gh,args,options)=>JSON.parse(await gh(args,options));
export const notFound=error=>/HTTP 404|release not found|Not Found/i.test(String(error?.stderr||'')+String(error?.message||''));

/** Downloads a URL with no credentials and compares SHA-512 and size. Retries because a fresh release asset can take a moment to be served. */
export async function verifyDownload({fetch,url,sha512,size,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),delays=[2000,6000,15000]}){
 let last;
 for(let attempt=0;attempt<=delays.length;attempt++){
  try{
   const response=await fetch(url,{redirect:'follow'});
   if(!response.ok)throw Error('HTTP '+response.status);
   const hash=createHash('sha512');let bytes=0;
   for await(const chunk of response.body){hash.update(chunk);bytes+=chunk.length;}
   const actual=hash.digest('base64');
   if(bytes!==size)throw Object.assign(Error('downloaded '+bytes+' bytes, expected '+size),{mismatch:true});
   if(actual!==sha512)throw Object.assign(Error('SHA-512 differs from the file that was uploaded'),{mismatch:true});
   return true;
  }catch(error){last=error;if(attempt<delays.length)await sleep(delays[attempt]);}
 }
 // mismatch: the server has other bytes under that name (not a file that is missing or not served yet)
 throw Object.assign(Error('Anonymous download of '+url+' failed: '+last.message),{mismatch:Boolean(last.mismatch)});
}
/** A small file (a blockmap), downloaded anonymously, each try given `timeout` ms; a failed try (a 5xx, a dropped or stalled connection, a 404 the
 *  CDN has not caught up on) is tried again after each delay. */
export async function downloadSmall({fetch,url,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),delays=[1000,3000,8000],timeout=30000}){
 let last;
 for(let attempt=0;attempt<=delays.length;attempt++){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);timer.unref?.();
  try{
   const response=await fetch(url,{redirect:'follow',signal:controller.signal});
   if(!response.ok)throw Error('HTTP '+response.status);
   const bytes=Buffer.from(await response.arrayBuffer());
   if(!bytes.length||bytes.length>16*1024*1024)throw Error(bytes.length+' bytes');
   return bytes;
  }catch(error){last=controller.signal.aborted?Error('no answer within '+Math.round(timeout/1000)+' s'):error;if(attempt<delays.length)await sleep(delays[attempt]);}
  finally{clearTimeout(timer);}
 }
 throw Error(last.message+(delays.length?' ('+(delays.length+1)+' tries)':''));
}

/** A live channel document: {file, version, files, previousBlockMaps, doc, text}, {file, version:null} when there is none, or {file, error}.
 *  A dry run reads the public copy (raw.githubusercontent.com: no login, but up to 5 minutes old); --publish reads the feed repository itself through gh
 *  (the contents API), so what is published is planned from what is really live, and the feed commit checks it still is (checkCurrent). */
export async function readLive({deps,file,authoritative,target=DEFAULT_TARGETS.legacy}){
 if(!authoritative)return U.readLiveFeed({fetch:deps.fetch??globalThis.fetch,file,baseUrl:target.publicBase});
 try{
  const found=await ghJson(deps.gh,['api',`repos/${target.repo}/contents/${target.dir}/${file}?ref=${target.branch}`]),text=Buffer.from(found.content,'base64').toString('utf8'),doc=U.parseFeed(text);
  if(!doc||typeof doc.version!=='string')return {file,error:'not a channel document'};
  return {file,version:doc.version,files:doc.files||[],previousBlockMaps:Array.isArray(doc.previousBlockMaps)?doc.previousBlockMaps:[],doc,text};
 }catch(error){return notFound(error)?{file,version:null,files:[]}:{file,error:String(error?.message||error).slice(0,200)};}
}

/** Finds the Mac build folders for a version: release/mac-widevine-<version>-<commit>.noindex/{arm64,x64}-*, each with its receipt. */
export async function discoverMac({version,macDir,root}){
 let base=macDir&&path.resolve(macDir);
 if(!base){
  const parent=path.join(root,'release'),prefix='mac-widevine-'+version+'-',found=[];
  for(const name of await fs.readdir(parent).catch(()=>[]))if(name.startsWith(prefix)&&name.endsWith('.noindex'))found.push({name,at:(await fs.stat(path.join(parent,name))).mtimeMs});
  found.sort((a,b)=>b.at-a.at);if(found.length)base=path.join(parent,found[0].name);
 }
 const result={base,arm64:null,x64:null};
 if(!base||!(await exists(base)))return result;
 for(const arch of U.ARCHES){
  const dirs=[];for(const entry of await fs.readdir(base,{withFileTypes:true}))if(entry.isDirectory()&&entry.name.startsWith(arch+'-'))dirs.push({dir:path.join(base,entry.name),at:(await fs.stat(path.join(base,entry.name))).mtimeMs});
  dirs.sort((a,b)=>b.at-a.at);if(!dirs.length)continue;
  const dir=dirs[0].dir,names=await fs.readdir(dir);
  result[arch]={dir,zip:names.filter(name=>MAC_ZIP.test(name)).map(name=>path.join(dir,name))[0]||null,dmg:names.filter(name=>MAC_DMG.test(name)).map(name=>path.join(dir,name))[0]||null};
 }
 return result;
}
/** The Windows files electron-builder and build:windows leave in one folder, plus the evidence of which version they are. */
async function discoverWindows({windowsDir,windowsExe,windowsBlockmap,windowsLatestYml}){
 const exe=windowsExe?path.resolve(windowsExe):windowsDir?path.join(path.resolve(windowsDir),WINDOWS_EXE):null;
 if(!exe)return null;
 const dir=path.dirname(exe),sibling=name=>path.join(dir,name);
 const blockmap=windowsBlockmap?path.resolve(windowsBlockmap):sibling(path.basename(exe)+'.blockmap'),latest=windowsLatestYml?path.resolve(windowsLatestYml):sibling('latest.yml');
 const evidence=[];
 if(await exists(latest)){const doc=require('js-yaml').load(await fs.readFile(latest,'utf8'));evidence.push({source:'latest.yml',version:doc?.version,sha512:doc?.sha512||doc?.files?.[0]?.sha512,size:doc?.files?.[0]?.size,name:doc?.path||doc?.files?.[0]?.url});}
 for(const name of ['ACIRA-INSTALLER-PROVENANCE.json','WINDOWS-BUILD-RESULT.json']){
  const doc=await readJSON(sibling(name)).catch(()=>null);
  if(doc)evidence.push({source:name,version:doc.version,commit:doc.sourceCommit||doc.commit,updateConfig:doc.payload?.updateConfig||doc.updateConfig,sha256:doc.installer?.sha256,size:doc.installer?.bytes});
 }
 return {exe,blockmap:(await exists(blockmap))?blockmap:null,evidence};
}

/** The Linux files the Linux machine handed over (scripts/handoff.mjs): the AppImage, the setup files, and HANDOFF.json that says what they are. */
async function discoverLinux({linuxDir}){
 if(!linuxDir)return null;
 const dir=path.resolve(linuxDir),names=await fs.readdir(dir).catch(()=>[]);
 const image=names.find(name=>LINUX_IMAGE.test(name)),setup=names.find(name=>name===LINUX_SETUP);
 return {dir,image:image?path.join(dir,image):null,setup:setup?path.join(dir,setup):null,handoff:await readJSON(path.join(dir,'HANDOFF.json')).catch(()=>null)};
}
/** What the Mac can check about a Linux AppImage it cannot open: the ELF header, and that the Linux machine's record of it (HANDOFF.json, hash-bound) says the update
 *  address inside it is one of ours. Resolves {updateConfig, feedUrl, source}; throws with the reason. */
export async function inspectLinuxBuild({image,handoff,described}){
 const handle=await fs.open(image,'r'),header=Buffer.alloc(4);try{await handle.read(header,0,4,0);}finally{await handle.close();}
 if(header.toString('hex')!=='7f454c46')throw Error('That is not an AppImage (no ELF header).');
 if(!handoff||handoff.platform!=='linux')throw Error('HANDOFF.json is missing or is not a Linux record.');
 const entry=(handoff.files||[]).find(file=>file.name===path.basename(image));
 if(!entry)throw Error('HANDOFF.json does not describe '+path.basename(image)+'.');
 if(entry.sha512!==described.sha512||entry.size!==described.size)throw Error('HANDOFF.json describes another file than '+path.basename(image)+' (SHA-512 or size differs): it was replaced after the Linux machine recorded it.');
 const url=handoff.updateConfig?.url;
 if(!U.ALLOWED_FEEDS.map(base=>base+'linux/').includes(url))throw Error('The update address inside the AppImage ('+url+') is not one of ours ('+U.ALLOWED_FEEDS.map(base=>base+'linux/').join(' or ')+').');
 return {updateConfig:true,feedUrl:url,source:'HANDOFF.json (bound to the AppImage\'s SHA-512)'};
}

/** Pulls a Windows setup apart far enough to say whether the installed app will find a feed. null = could not tell (no 7-Zip here). */
export async function inspectWindowsInstaller({exe,evidence=[]}){
 const header=Buffer.alloc(2),handle=await fs.open(exe,'r');try{await handle.read(header,0,2,0);}finally{await handle.close();}
 if(header.toString('latin1')!=='MZ')throw Error('That is not a Windows executable.');
 const recorded=evidence.find(item=>item.updateConfig);
 if(recorded)return {updateConfig:U.ALLOWED_FEEDS.includes(recorded.updateConfig.url)||recorded.updateConfig===true,source:recorded.source};
 for(const tool of ['7zz','7z','7za']){
  try{
   await run(tool,['-h'],{maxBuffer:1024*1024}).catch(error=>{if(error.code==='ENOENT')throw error;});
   const {findEmbedded7zArchive}=await import('./release-installer-payload.mjs'),bytes=await fs.readFile(exe),segment=findEmbedded7zArchive(bytes);
   const work=await fs.mkdtemp(path.join(os.tmpdir(),'acira-win-setup-'));
   try{
    const archive=path.join(work,'embedded.7z');await fs.writeFile(archive,bytes.subarray(segment.offset,segment.end));
    const listing=(await run(tool,['l','-slt',archive],{maxBuffer:64*1024*1024})).stdout;
    return {updateConfig:/^Path = resources[\\/]app-update\.yml$/m.test(listing),source:tool+' listing of the embedded product archive'};
   }finally{await fs.rm(work,{recursive:true,force:true});}
  }catch(error){if(error.code!=='ENOENT'&&!/Expected exactly one/.test(error.message))throw error;}
 }
 return {updateConfig:null,source:'no 7-Zip here and no build record'};
}

/**
 * A new version, or (--add-arch) the missing Mac architecture of the live one. Everything the dry run and the real run share.
 * Resolves to {ok, problems, warnings, plan, checks, live, assets}. deps: fetch, inspectMacZip, inspectMacDmg, inspectWindowsInstaller, log, now.
 */
export async function planUpdate(options,deps){
 const {log=()=>{},now=()=>new Date(),fetch=globalThis.fetch,root=repo}=deps;
 const problems=[],warnings=[],version=options.version,channel=options.channel||'beta',rehearsal=Boolean(options.rehearsal),adding=Boolean(options['add-arch']);
 const target=deps.target||DEFAULT_TARGETS.legacy,assetUrl=(tag,name)=>U.assetUrl(tag,name,target.repo),hidden=Boolean(options.hold||deps.hidden);
 const mismatch=message=>(rehearsal?warnings.push('REHEARSAL, would be an error: '+message):problems.push(message));
 if(rehearsal&&options.publish)throw Error('--rehearsal is for dry runs only and cannot be combined with --publish.');
 if(!version)throw Error('Say which version: --version 0.1.0-beta.7\n\n'+HELP);
 problems.push(...U.versionProblems(version,channel));
 const effective=version,rollout=options.rollout!==undefined?U.parsePercent(options.rollout,'--rollout'):100;
 // --- inputs ---
 const mac={arm64:{},x64:{}};
 const explicit={arm64:{zip:options['mac-arm64-zip'],dmg:options['mac-arm64-dmg']},x64:{zip:options['mac-x64-zip'],dmg:options['mac-x64-dmg']}};
 const wantsMac=adding||Object.values(explicit).some(item=>item.zip||item.dmg)||options['mac-dir']||!options['windows-dir']&&!options['windows-exe']&&!options['linux-dir'];
 if(wantsMac){
  // explicit means explicit: named files are the whole Mac input; a folder (--mac-dir, else release/ by version) is searched only when none is named
  const named=Object.values(explicit).some(item=>item.zip||item.dmg),found=named?{}:await discoverMac({version,macDir:options['mac-dir'],root});
  for(const arch of U.ARCHES)mac[arch]=named?{zip:explicit[arch].zip&&path.resolve(explicit[arch].zip),dmg:explicit[arch].dmg&&path.resolve(explicit[arch].dmg)}:{zip:found[arch]?.zip,dmg:options['no-dmg']?undefined:found[arch]?.dmg}; // --no-dmg: the bridge release is never offered to new visitors, so its disk images are not uploaded
 }
 const windows=adding?null:await discoverWindows({windowsDir:options['windows-dir'],windowsExe:options['windows-exe'],windowsBlockmap:options['windows-blockmap'],windowsLatestYml:options['windows-latest-yml']});
 const linux=adding?null:await discoverLinux({linuxDir:options['linux-dir']});
 if(!wantsMac&&!windows&&!linux)problems.push('Nothing to publish: no Mac files, no Windows setup and no Linux AppImage.');
 // --- what is live now ---
 const live=[];
 const platforms=[...(wantsMac?['mac']:[]),...(windows?['windows']:[]),...(linux?['linux']:[])];
 for(const platform of platforms)for(const file of U.feedFiles(channel,platform)){
  const feed=await readLive({deps,file,authoritative:Boolean(options.publish),target});live.push({platform,...feed});
  if(feed.error){(options.publish||adding?problems:warnings).push('Could not read the live feed '+file+' ('+feed.error+'), so "'+(adding?'what is live':'newer than the feed')+'" was not checked.');}
 }
 // --add-arch: the live Mac version, and the architecture it lacks
 let addTo=null;
 if(adding){
  const own=live.find(item=>item.platform==='mac'&&item.file===U.feedFiles(channel,'mac')[0]);
  if(own&&!own.error&&own.version!==version)problems.push('--add-arch adds to the version the live feed offers: '+own.file+' '+(own.version?'offers '+own.version:'does not exist')+', not '+version+'.');
  else if(own?.version){
   const docs=live.filter(item=>item.platform==='mac'&&item.version===version),liveArches=(own.doc.files||[]).map(file=>U.macArchOf(file.url)),tag=U.tagOf(own.doc.files?.[0]?.url);
   const missing=U.ARCHES.filter(arch=>!liveArches.includes(arch));
   if(!tag||liveArches.includes(null))problems.push('The live '+own.file+' does not name '+version+'\'s Mac update ZIPs on a release; --add-arch cannot tell which release to add to.');
   else if(!missing.length)problems.push('The live '+version+' already offers both Mac architectures (arm64 and x64); nothing to add.');
   if(docs.some(item=>JSON.stringify(item.doc.files)!==JSON.stringify(own.doc.files)))problems.push('The live Mac documents for '+version+' ('+docs.map(item=>item.file).join(', ')+') name different files; fix the feed by hand first.');
   addTo={docs,tag,liveArches,missing,commit:tag?.split('-mac-')[1]||null};
   for(const arch of U.ARCHES)if(!missing.includes(arch)&&(mac[arch].zip||mac[arch].dmg)){warnings.push('The '+arch+' files found here are not uploaded: the live '+version+' already has '+arch+'.');mac[arch]={};}
  }
 }
 // --- the version has to beat everything already out there. --add-arch changes only the documents that offer its version, so it is compared with the
 //     builds people run and its own channel's document (a stable version is not "older" because beta moved on) ---
 const ownChannel=U.feedFiles(channel,'mac')[0];
 const references=[...U.SHIPPED.map(item=>({label:item.what,version:item.version})),...(deps.references||[]),...live.filter(item=>item.version&&!(adding&&(item.version===version||item.file!==ownChannel))).map(item=>({label:'the live feed '+item.file,version:item.version}))];
 problems.push(...U.newerProblems(effective,references));
 // --- an architecture missing: a Mac that is not handed its own build either sees failed checks (Intel) or installs the Intel build (Apple silicon) ---
 if(wantsMac&&!adding){
  const present=U.ARCHES.filter(arch=>mac[arch].zip);
  if(!present.length)problems.push('No Mac update ZIP found. Build with scripts/package-mac-widevine.mjs (it writes one per architecture), or pass --mac-arm64-zip and --mac-x64-zip.');
  else if(present.length<2){
   if(present[0]==='x64')problems.push('Only the x64 Mac update ZIP was found. A feed without arm64 hands Apple silicon Macs the Intel build (electron-updater falls back to the file without "arm64"). Publish both.');
   else if(!options['allow-single-arch'])problems.push('Only the arm64 Mac update ZIP was found. Without the x64 one Intel Macs could not update (their checks fail until it is added). Publish both, or pass --allow-single-arch and add x64 later with --add-arch.');
   else warnings.push('Only arm64 is published: Intel Macs see failed update checks until you run --add-arch with the x64 ZIP of the same commit.');
  }
 }
 if(adding&&addTo?.missing.length&&!addTo.missing.some(arch=>mac[arch].zip))problems.push('No '+addTo.missing.join('/')+' update ZIP to add. Pass --mac-'+addTo.missing[0]+'-zip <file> (from the same commit, '+addTo.commit+'), or --mac-dir.');
 for(const arch of U.ARCHES)if(!mac[arch].zip&&mac[arch].dmg)problems.push('The '+arch+' DMG has no matching update ZIP.');
 // --- the Mac files: named right, the bytes their build receipt describes, then signed, notarized, stapled and the right version inside ---
 const checks={mac:{},windows:null,linux:null},assets={mac:[],windows:[],linux:[]};
 const commits=new Set();
 for(const arch of U.ARCHES){
  const item=mac[arch];if(!item.zip&&!item.dmg)continue;
  if(item.zip){
   const name=path.basename(item.zip),match=MAC_ZIP.exec(name);
   if(!match||match[2]!==arch)problems.push(name+' is not named AciraBrowser-<version>-mac-'+arch+'-update.zip.');
   else if(match[1]!==effective)mismatch(name+' is version '+match[1]+', not '+effective+'.');
   if(!(await exists(item.zip))){problems.push(item.zip+' does not exist.');continue;}
   const described=await U.describeFile(item.zip),receipt=await receiptBeside(item.zip),record=receipt?.updateZip;
   let intact=true;
   if(!record)problems.push(name+': no build receipt beside it ('+RECEIPT+' with updateZip), so nothing says what this ZIP should be. Publish the folder scripts/package-mac-widevine.mjs wrote, as it is.'),intact=false;
   else{
    if(path.basename(String(record.zip||''))!==name)problems.push(name+': its build receipt describes '+path.basename(String(record.zip||'another file'))+'.'),intact=false;
    else if(record.sha512!==described.sha512||record.size!==described.size)problems.push(name+' is not the file its build receipt describes (SHA-512 or size differs: '+described.size+' bytes here, '+record.size+' recorded). It was replaced or damaged after the build; package it again.'),intact=false;
    if(receipt.arch&&receipt.arch!==arch)problems.push(name+': its build receipt is for '+receipt.arch+'.');
    if(receipt.version&&match&&receipt.version!==match[1])mismatch(name+': its build receipt says version '+receipt.version+'.');
    if(receipt.commit)commits.add(receipt.commit);
   }
   if(intact){
    log('Checking the '+arch+' update ZIP (unzip, codesign, stapler, spctl)...');
    try{
     const proof=await deps.inspectMacZip({zip:item.zip,arch,version:rehearsal?undefined:effective});
     if(rehearsal&&proof.version!==effective)warnings.push('REHEARSAL, would be an error: the app inside '+name+' says '+proof.version+', not '+effective+'.');
     checks.mac[arch]={zip:proof};if(proof.commit)commits.add(proof.commit);
    }catch(error){problems.push(name+': '+error.message);}
   }
   assets.mac.push({...described,role:'update',arch});
  }
  if(item.dmg){
   const name=path.basename(item.dmg),match=MAC_DMG.exec(name);
   if(!match||match[2]!==arch)problems.push(name+' is not named AciraBrowser-<version>-mac-'+arch+'.dmg.');
   else if(match[1]!==effective)mismatch(name+' is version '+match[1]+', not '+effective+'.');
   if(!(await exists(item.dmg))){problems.push(item.dmg+' does not exist.');continue;}
   const described=await U.describeFile(item.dmg),receipt=await receiptBeside(item.dmg);
   if(!receipt?.sha256)problems.push(name+': no build receipt beside it ('+RECEIPT+'), so nothing says what this disk image should be.');
   else{
    if(receipt.diskImage&&path.basename(String(receipt.diskImage))!==name)problems.push(name+': its build receipt describes '+path.basename(String(receipt.diskImage))+'.');
    else if(receipt.sha256!==described.sha256||(receipt.bytes!==undefined&&receipt.bytes!==described.size))problems.push(name+' differs from the file its build receipt describes (SHA-256 or size mismatch).');
    if(receipt.version!==match?.[1])mismatch(name+': its build receipt says version '+receipt.version+'.');
    if(receipt.commit)commits.add(receipt.commit);
   }
   log('Checking the '+arch+' disk image...');
   try{checks.mac[arch]={...checks.mac[arch],dmg:await deps.inspectMacDmg({dmg:item.dmg})};}catch(error){problems.push(name+': '+error.message);}
   assets.mac.push({...described,role:'installer',arch});
  }
 }
 if(commits.size>1)problems.push('The Mac files come from different commits ('+[...commits].map(commit=>commit.slice(0,8)).join(', ')+'). Rebuild both architectures from one commit.');
 const macCommit=[...commits][0]||options.commit||null;
 if(wantsMac&&assets.mac.length&&!macCommit)problems.push('No commit is known for the Mac files; pass --commit <hex>.');
 if(adding&&addTo?.commit&&macCommit&&!macCommit.startsWith(addTo.commit))problems.push('The '+addTo.missing.join('/')+' build is from commit '+macCommit.slice(0,8)+', but the live '+version+' is release '+addTo.tag+' (commit '+addTo.commit+'). Build it from that commit; one release never mixes commits.');
 // --- the Windows files ---
 let windowsCommit=null,windowsFeedAllowed=false,blockMaps=[];
 if(windows){
  const exe=windows.exe;
  if(!(await exists(exe)))problems.push(exe+' does not exist.');
  else{
   const described=await U.describeFile(exe);
   if(described.size<1048576)problems.push(path.basename(exe)+' is only '+described.size+' bytes: that is not the installer.');
   if(path.basename(exe)!==WINDOWS_EXE)problems.push('The Windows installer must be named '+WINDOWS_EXE+' (the name the feed and the website expect).');
   const versions=windows.evidence.filter(item=>item.version);
   if(!versions.length)problems.push('Nothing says which version '+path.basename(exe)+' is. Keep the latest.yml or ACIRA-INSTALLER-PROVENANCE.json that the Windows build wrote next to it.');
   for(const item of versions)if(item.version!==effective)mismatch(item.source+' says the Windows installer is version '+item.version+', not '+effective+'.');
   if(!U.WINDOWS_VERSION.test(effective))warnings.push(effective+' does not match the Windows build rule ^0.1.N-beta.N(.M)$ (scripts/build-windows.mjs); that build would have refused it.');
   for(const item of windows.evidence)if(item.sha512&&item.sha512!==described.sha512||item.sha256&&item.sha256!==described.sha256||item.size&&item.size!==described.size)problems.push(item.source+' describes a different file than '+path.basename(exe)+' (SHA-512, SHA-256 or size differs). Was it rebuilt or damaged after the build wrote that record?');
   windowsCommit=windows.evidence.find(item=>item.commit)?.commit||options.commit||null;
   if(!windowsCommit)problems.push('No commit is known for the Windows installer; pass --commit <hex>.');
   if(windowsCommit&&macCommit&&windowsCommit!==macCommit)warnings.push('The Windows installer ('+windowsCommit.slice(0,8)+') and the Mac files ('+macCommit.slice(0,8)+') come from different commits.');
   let inspected;try{inspected=await deps.inspectWindowsInstaller({exe,evidence:windows.evidence});}catch(error){problems.push(path.basename(exe)+': '+error.message);}
   if(inspected){
    checks.windows={unsigned:true,updateConfig:inspected.updateConfig,via:inspected.source};
    windowsFeedAllowed=!options['windows-download-only']&&(inspected.updateConfig===true||Boolean(options['windows-assume-updater']));
    if(inspected.updateConfig!==true&&!options['windows-assume-updater']){
     const why=inspected.updateConfig===false?'it does NOT contain resources/app-update.yml, so an installed copy would have no feed to read':'this check could not look inside it ('+inspected.source+')';
     if(!options['windows-download-only']&&options.publish)problems.push('Windows self-update is not proven for this setup: '+why+'. Publish it as a plain download with --windows-download-only (no Windows feed entry), rebuild it from a commit that ships app-update.yml, or pass --windows-assume-updater after checking with 7z.');
     else warnings.push('The Windows feed will NOT be updated: '+why+'.');
    }
    if(inspected.updateConfig===true&&options['windows-download-only'])warnings.push('The Windows feed is left alone because of --windows-download-only.');
   }
   assets.windows.push({...described,role:'installer'});
   // The setup's blockmap: what the next version's copies of this one download against. It has to be there and describe exactly this setup.
   if(!windows.blockmap)problems.push('No '+path.basename(exe)+'.blockmap beside the setup. Installed copies would download the whole setup (about 230 MB) instead of what changed, now and for the next version; npm run build:windows writes it, keep it with the setup.');
   else{
    // gh names an asset after its file, and installed copies look for the blockmap at the setup's address plus .blockmap
    if(path.basename(windows.blockmap)!==path.basename(exe)+'.blockmap')problems.push('The blockmap must be named '+path.basename(exe)+'.blockmap (installed copies look for it at the setup\'s address plus .blockmap), not '+path.basename(windows.blockmap)+'.');
    try{U.checkBlockMap(await fs.readFile(windows.blockmap),{size:described.size});}catch(error){problems.push(path.basename(windows.blockmap)+': '+error.message+'.');}
    assets.windows.push({...await U.describeFile(windows.blockmap),role:'blockmap'});
   }
   // previousBlockMaps: where the setups installed now keep their blockmaps. Each is downloaded (with retries) and read. An older entry that cannot be
   // is left out with a warning; the live setup's own entry never is without --allow-missing-blockmaps: the next release is planned from this
   // document, so an entry dropped once never comes back, and every copy on that version would download the whole setup from then on.
   if(windowsFeedAllowed){
    const liveWindows=[...(deps.priorWindows||[]),...live.filter(item=>item.platform==='windows'&&item.version)],sizes=new Map(),live_=new Set(),override=Boolean(options['allow-missing-blockmaps']),lost=[];
    for(const item of liveWindows){const setup=(item.files||[]).find(file=>/\.exe$/i.test(String(file?.url||'')));if(setup){live_.add(item.version);if(Number.isSafeInteger(setup.size))sizes.set(item.version,setup.size);}}
    for(const entry of U.previousBlockMaps(liveWindows,{version:effective})){
     try{const raw=await downloadSmall({fetch,url:entry.url,sleep:deps.sleep,delays:deps.delays});if(sizes.has(entry.version))U.checkBlockMap(raw,{size:sizes.get(entry.version)});else require('../desktop/browser-services/update-download.cjs').readBlockMap(raw);blockMaps.push(entry);}
     catch(error){
      const what=entry.version+' ('+entry.url+': '+error.message+')';
      if(live_.has(entry.version)&&!override){lost.push(entry.version);problems.push('The live setup\'s blockmap, '+what+', could not be downloaded and read. Without it every copy on '+entry.version+' would download the whole setup, now and for every later version (the next document is made from this one). Try again later, upload the blockmap to its release, or pass --allow-missing-blockmaps to publish without it.');}
      else warnings.push('previousBlockMaps leaves out '+what+'; copies of '+entry.version+' download the whole setup.');
     }
    }
    const named=liveWindows.filter(item=>(item.files||[]).some(file=>/\.exe$/i.test(String(file?.url||''))));
    if(named.length&&!blockMaps.length&&!lost.length){
     const message='The live '+named.map(item=>item.file+' ('+item.version+')').join(', ')+' names a setup, but no earlier setup\'s blockmap could be downloaded and read, so the new Windows document would have no previousBlockMaps and every installed Windows copy would download the whole setup.';
     if(override)warnings.push(message+' Published anyway (--allow-missing-blockmaps).');else problems.push(message+' Upload the live setup\'s .blockmap to its release and run again, or pass --allow-missing-blockmaps in an emergency.');
    }
   }
  }
 }
 // --- the Linux AppImage ---
 let linuxCommit=null,linuxFeedAllowed=false;
 if(linux){
  if(!linux.image)problems.push('No AciraBrowser-<version>-linux-x86_64.AppImage in '+linux.dir+'.');
  else{
   const name=path.basename(linux.image),match=LINUX_IMAGE.exec(name),described=await U.describeFile(linux.image);
   if(match[1]!==effective)mismatch(name+' is version '+match[1]+', not '+effective+'.');
   if(described.size<10*1048576)problems.push(name+' is only '+described.size+' bytes: that is not the AppImage.');
   if(linux.handoff?.version&&linux.handoff.version!==effective)mismatch('HANDOFF.json says the Linux build is version '+linux.handoff.version+', not '+effective+'.');
   linuxCommit=linux.handoff?.commit||options.commit||null;
   if(!linuxCommit)problems.push('No commit is known for the Linux AppImage (HANDOFF.json has none); pass --commit <hex>.');
   if(linuxCommit&&macCommit&&linuxCommit!==macCommit)warnings.push('The Linux AppImage ('+linuxCommit.slice(0,8)+') and the Mac files ('+macCommit.slice(0,8)+') come from different commits.');
   try{
    const inspect=deps.inspectLinuxBuild||inspectLinuxBuild,inspected=await inspect({image:linux.image,handoff:linux.handoff,described});
    checks.linux={unsigned:true,updateConfig:inspected.updateConfig,feedUrl:inspected.feedUrl,via:inspected.source};linuxFeedAllowed=inspected.updateConfig===true;
   }catch(error){problems.push(name+': '+error.message);}
   assets.linux=[{...described,role:'installer'}];
   if(linux.setup)assets.linux.push({...await U.describeFile(linux.setup),role:'setup'});
  }
 }
 // --- notes (--add-arch keeps the live notes) ---
 let notesText=options.notes;if(options['notes-file'])notesText=await fs.readFile(path.resolve(options['notes-file']),'utf8');
 const notes=U.releaseNotes(notesText);
 if(!notes.markdown&&!adding){(options.publish&&!options['no-notes']?problems:warnings).push('No release notes. Installed copies show them in the "what\'s new" popup after the update. Pass --notes-file <file> (one bullet per line)'+(options.publish?' or --no-notes.':'.'));}
 if(notes.plain.length>U.NOTES_MAX)warnings.push('The notes are '+notes.plain.length+' characters; the app shows the first '+U.NOTES_MAX+'.');
 else if(notes.plain.length>U.NOTES_OLD_MAX)warnings.push('The notes are '+notes.plain.length+' characters. Copies of Acira up to beta.11 show only the first '+U.NOTES_OLD_MAX+' of them in the update popup (and again after the restart); newer copies show the whole list.');
 // --- the plan: releases and feed files ---
 const releaseDate=now().toISOString(),plan={mode:adding?'add-arch':'release',version,channel,rehearsal,rollout,repo:target.repo,target,releases:[],feeds:[],verify:[],untouched:[],releaseDate};
 const finish=ok=>({ok:ok&&problems.length===0,problems,warnings,plan,checks,live,assets});
 if(problems.length)return finish(false);
 const liveOf=file=>live.find(item=>item.file===file&&item.version);
 const feedEntry=(platform,file,doc)=>({platform,file,text:U.serializeFeed(doc),version:effective,before:liveOf(file)?.doc||null,beforeText:liveOf(file)?.text||''});
 const staging=await fs.mkdtemp(path.join(os.tmpdir(),'acira-feed-staging-'));
 try{
  if(assets.mac.length){
   const tag=adding?addTo.tag:U.releaseTag({version,platform:'mac',commit:macCommit}),zips=assets.mac.filter(asset=>asset.role==='update'),releaseName='Acira Browser '+effective;
   const release={platform:'mac',tag,title:releaseName+' (Mac)',prerelease:channel==='beta',addTo:adding,arches:[...new Set(assets.mac.map(asset=>asset.arch))],assets:assets.mac.map(asset=>({...asset,url:assetUrl(tag,asset.name)}))};
   // writeMacUpdateFeed (the packager's own writer) computes the hashes the feed carries; they must agree with the ones computed above.
   for(const zip of zips)await fs.link(zip.path,path.join(staging,zip.name)).catch(()=>fs.copyFile(zip.path,path.join(staging,zip.name),fs.constants.COPYFILE_FICLONE)); // a hard link (or clone) costs nothing; writeMacUpdateFeed wants the ZIPs in one folder
   const base=await writeMacUpdateFeed({output:staging,version:effective,releaseDate,artifacts:zips.map(zip=>({zip:path.join(staging,zip.name),arch:zip.arch}))});
   const baseText=await fs.readFile(base.file,'utf8'),baseDoc=JSON.parse(baseText);
   for(const file of baseDoc.files){const zip=zips.find(item=>item.name===file.url);if(!zip||zip.sha512!==file.sha512||zip.size!==file.size)throw Error('Internal check failed: writeMacUpdateFeed and the publisher disagree about '+file.url+'.');}
   if(adding){
    // the live documents keep everything (date, notes, rollout); they gain the new architecture's file
    const added=baseDoc.files.map(file=>({...file,url:assetUrl(tag,file.url)}));
    for(const item of addTo.docs)plan.feeds.push({platform:'mac',file:item.file,text:U.serializeFeed(U.addMacFiles(item.doc,added)),version:effective,before:item.doc,beforeText:item.text});
   }else{
    const doc=U.withRollout(U.finalizeMacFeed(baseText,{urlFor:name=>assetUrl(tag,name),releaseName,releaseNotes:notes.plain}),rollout);
    for(const file of U.feedFiles(channel,'mac'))plan.feeds.push(feedEntry('mac',file,doc));
   }
   release.body=U.releaseBody({notes,platform:'mac',hidden});
   plan.releases.push(release);
  }
  if(assets.windows.length){
   const tag=U.releaseTag({version,platform:'windows',commit:windowsCommit}),exe=assets.windows.find(asset=>asset.role==='installer'),releaseName='Acira Browser '+effective;
   const release={platform:'windows',tag,title:releaseName+' (Windows)',prerelease:channel==='beta',assets:assets.windows.map(asset=>({...asset,url:assetUrl(tag,asset.name)})),body:U.releaseBody({notes,platform:'windows',hidden}),feedEntry:windowsFeedAllowed};
   if(windowsFeedAllowed){
    // previousBlockMaps: where the setups now installed keep their blockmaps, so they download only what changed (packaging/update-publish.cjs)
    const doc=U.withRollout(U.windowsFeed({version:effective,file:exe,url:assetUrl(tag,exe.name),releaseDate,releaseName,releaseNotes:notes.plain,previousBlockMaps:blockMaps}),rollout);
    for(const file of U.feedFiles(channel,'windows'))plan.feeds.push(feedEntry('windows',file,doc));
   }
   plan.releases.push(release);
  }
  if(assets.linux.length){
   const tag=U.releaseTag({version,platform:'linux',commit:linuxCommit}),image=assets.linux.find(asset=>asset.role==='installer'),releaseName='Acira Browser '+effective;
   const release={platform:'linux',tag,title:releaseName+' (Linux)',prerelease:channel==='beta',assets:assets.linux.map(asset=>({...asset,url:assetUrl(tag,asset.name)})),body:U.releaseBody({notes,platform:'linux',hidden}),feedEntry:linuxFeedAllowed};
   if(linuxFeedAllowed){
    const doc=U.withRollout(U.linuxFeed({version:effective,file:image,url:assetUrl(tag,image.name),releaseDate,releaseName,releaseNotes:notes.plain}),rollout);
    for(const file of U.feedFiles(channel,'linux'))plan.feeds.push(feedEntry('linux',file,doc));
   }
   plan.releases.push(release);
  }
  // Every release also carries its checksums and a record of what was checked; files added to a published release get their own (nothing is replaced).
  for(const release of plan.releases){
   const files=release.assets.slice(),suffix=release.addTo?'-'+release.arches.join('-'):'';
   const sums={name:'SHA256SUMS'+suffix+'.txt',content:U.checksumsText(files),role:'checksums'};
   const info={name:'BUILD-INFO'+suffix+'.json',content:JSON.stringify(U.buildInfo({version:effective,channel,platform:release.platform,commit:release.platform==='mac'?macCommit:release.platform==='linux'?linuxCommit:windowsCommit,assets:files,checks:release.platform==='mac'?checks.mac:release.platform==='linux'?checks.linux:checks.windows}),null,2)+'\n',role:'info'};
   for(const generated of [sums,info]){generated.size=Buffer.byteLength(generated.content);generated.sha256=createHash('sha256').update(generated.content).digest('hex');generated.sha512=createHash('sha512').update(generated.content).digest('base64');generated.url=assetUrl(release.tag,generated.name);release.assets.push(generated);}
  }
  // Read every planned feed document back the way an installed app does, and check it points at the assets it should (or, --add-arch, at the live files it keeps).
  if(options['mirror-base']){if(plan.feeds.length)withMirrors({plan,base:options['mirror-base']});else warnings.push('--mirror-base was given, but no channel document hands out a file in this run, so no mirror is named.');}
  for(const feed of plan.feeds)checkPlannedFeed(feed,plan);
 }finally{await fs.rm(staging,{recursive:true,force:true});}
 return finish(true);
}
/** Names the mirror copy of every file the planned documents hand out that this run puts on its releases: files[].mirrors = [<base><release tag>/<file name>]. Files a document keeps
 *  from before (--add-arch) are left as they are. A Windows setup's blockmap is listed too (the app asks for <setup>.blockmap beside whichever copy it fetches), as optional.
 *  Sets plan.mirror = {base, files:[{name, tag, url, path, sha512, size, optional}]}: what must be on the mirror. */
export function withMirrors({plan,base}){
 const mirror={base,files:[]},assets=new Map(plan.releases.flatMap(release=>release.assets.map(asset=>[asset.url,{release,asset}])));
 const mirrorUrl=(release,asset)=>base+encodeURIComponent(release.tag)+'/'+encodeURIComponent(asset.name);
 const add=(release,asset,optional=false)=>{const url=mirrorUrl(release,asset);if(!mirror.files.some(item=>item.url===url))mirror.files.push({name:asset.name,tag:release.tag,url,path:asset.path||null,sha512:asset.sha512,size:asset.size,optional});return url;};
 for(const feed of plan.feeds){
  const doc=U.parseFeed(feed.text);let changed=false;
  doc.files=(doc.files||[]).map(file=>{
   const hit=assets.get(file.url);if(!hit)return file;
   const url=add(hit.release,hit.asset),map=hit.release.assets.find(asset=>asset.name===hit.asset.name+'.blockmap');
   if(map)add(hit.release,map,true);
   changed=true;return {...file,mirrors:[...new Set([...(file.mirrors||[]),url])]};
  });
  if(changed)feed.text=U.serializeFeed(doc);
 }
 plan.mirror=mirror;return mirror;
}
/** Asks the mirror for every file it must hold and compares SHA-512 and size with the file this run publishes. Resolves {same, missing, differs} (lists of mirror files).
 *  strict (a real publish): a missing copy is as much a refusal as a different one, because the feed would name a file that is not there. */
export async function mirrorCheck({plan,fetch=globalThis.fetch,sleep,delays=[],strict=false,log=()=>{}}){
 const result={same:[],missing:[],differs:[]};
 if(!plan.mirror)return result;
 for(const file of plan.mirror.files){
  try{await verifyDownload({fetch,url:file.url,sha512:file.sha512,size:file.size,sleep,delays});result.same.push(file);log('  mirror has '+file.name+' (identical)');}
  catch(error){(error.mismatch?result.differs:result.missing).push({...file,why:String(error.message||error)});}
 }
 const refused=[...result.differs.map(file=>file.url+' is NOT the file this release publishes ('+file.why.replace(/^Anonymous download of \S+ failed: /,'')+'). Replace it on the mirror, then run again.'),
  ...result.missing.filter(file=>strict&&!file.optional).map(file=>file.url+' is not on the mirror ('+file.why.replace(/^Anonymous download of \S+ failed: /,'')+'). Put '+(file.path?path.basename(file.path):file.name)+' there first, then run again.')];
 if(refused.length)throw Object.assign(Error('The mirror does not hold the files this release names, so nothing was published to the feed:\n  - '+refused.join('\n  - ')),{mirror:result});
 return result;
}

/** A planned channel document, read back with electron-updater's own parser: the right version, every file a planned asset (or a file the live document
 *  already named, when one is added), and on a Mac each architecture handed its own archive. */
function checkPlannedFeed(feed,plan){
 const {info,files}=U.readWithUpdater(feed.text,{file:feed.file});
 if(info.version!==plan.version)throw Error('Internal check failed: '+feed.file+' carries '+info.version+'.');
 const release=plan.releases.find(item=>item.platform===feed.platform),known=[...(release?.assets||[]),...(plan.mode==='release'?[]:feed.before?.files||[])];
 for(const file of files){
  const asset=known.find(item=>item.url===file.url.href);
  if(!asset||asset.sha512!==file.info.sha512||asset.size!==file.info.size)throw Error('Internal check failed: '+feed.file+' names '+file.url.href+' which is not an uploaded asset with those hashes.');
 }
 if(feed.platform==='mac'){
  const {MacUpdater}=require('electron-updater/out/MacUpdater'),offered=files.map(file=>U.macArchOf(file.url.href));
  for(const [isArm,arch] of [[true,'arm64'],[false,'x64']]){
   const chosen=MacUpdater.filterFilesForArch(files,isArm);
   if(offered.includes(arch)&&(chosen.length!==1||!chosen[0].url.href.includes('-'+arch+'-')))throw Error('Internal check failed: '+feed.file+' would not give '+arch+' Macs the '+arch+' archive.');
  }
 }
}

/**
 * --widen, --halt, --resume-rollout: a new version of each live channel document that offers --version, nothing else changed and nothing uploaded.
 * Resolves to {ok, problems, warnings, plan, live}. deps: fetch, now.
 */
export async function planFeedChange(options,deps){
 const {now=()=>new Date()}=deps;
 const problems=[],warnings=[],version=options.version,channel=options.channel||'beta';
 if(!version)throw Error('Say which live version: --version 0.1.0-beta.7\n\n'+HELP);
 problems.push(...U.versionProblems(version,channel));
 const mode=options.halt?'halt':options['resume-rollout']?'resume':options.pace!==undefined?'pace':'widen';
 const target=mode==='widen'?U.parsePercent(options.widen,'--widen'):mode==='pace'?null:options.rollout!==undefined?U.parsePercent(options.rollout,'--rollout'):null;
 const platforms=options.platform?[options.platform]:deps.withLinux?U.ALL_PLATFORMS:U.PLATFORMS,at=now().toISOString();
 const dest=deps.target||DEFAULT_TARGETS.legacy,plan={mode,version,channel,repo:dest.repo,target:dest,releases:[],feeds:[],verify:[],untouched:[],releaseDate:at};
 const live=[];
 for(const platform of platforms)for(const file of U.feedFiles(channel,platform)){
  live.push({platform,...await readLive({deps,file,authoritative:Boolean(options.publish),target:dest})});
 }
 const finish=()=>({ok:problems.length===0,problems,warnings,plan,live});
 // Only the documents that offer the version are needed: one that cannot be read stops the change only when no readable one offers it (a halt
 // should not wait for an unrelated document), and is otherwise named in a warning.
 const offering=live.filter(item=>item.version===version),unreadable=live.filter(item=>item.error);
 const narrow=options.platform?'':' --platform mac or --platform windows changes one platform only.',has=item=>item.version?'offers '+item.version:'does not exist';
 if(!offering.length){
  if(unreadable.length)problems.push('Could not read '+unreadable.map(item=>item.file+' ('+item.error+')').join(', ')+(live.length>unreadable.length?', and '+live.filter(item=>!item.error).map(item=>item.file+' '+has(item)).join(', '):'')+': no document that could be read offers '+version+'.'+narrow);
  else problems.push('The live feed does not offer '+version+': '+live.map(item=>item.file+' '+has(item)).join(', ')+'. --'+(mode==='resume'?'resume-rollout':mode)+' only changes the version that is live.'+narrow);
 }else for(const item of unreadable)warnings.push('Could not read the live feed '+item.file+' ('+item.error+'): it is left as it is. If it offers '+version+' too, run this again once it can be read.'+narrow);
 for(const item of live)if(!item.error&&item.version!==version)plan.untouched.push(dest.dir+'/'+item.file+' '+has(item)+': left alone');
 for(const item of offering){
  const {percentage,halted,before}=U.rolloutOf(item.doc);let doc=null;
  if(!Array.isArray(item.doc.files)||!item.doc.files.length){problems.push(item.file+' offers '+version+' with no files; nothing to change.');continue;}
  if(mode==='pace'){
   doc=options.pace==='clear'?(()=>{const next={...item.doc};delete next.nextCheckSeconds;return next;})():U.withNextCheck(item.doc,Number(options.pace));
  }else if(mode==='widen'){
   if(halted)problems.push(item.file+': '+version+' is halted. Resume it first (--resume-rollout), then widen.');
   else if(target<=percentage)problems.push(item.file+': '+version+' is already '+U.describeRollout(item.doc)+'; --widen only raises it'+(percentage===100?'.':' (a number above '+percentage+').'));
   else doc=U.withRollout(item.doc,target);
  }else if(mode==='halt'){
   if(halted)problems.push(item.file+': '+version+' is already halted.');
   else doc=U.haltDoc(item.doc,{at});
  }else if(!halted)problems.push(item.file+': '+version+' is not halted ('+U.describeRollout(item.doc)+'); nothing to resume.');
  else if(!(target??before))problems.push(item.file+': the halt did not record what share of installs '+version+' had; say it with --rollout <percent>.');
  else doc=U.withRollout(item.doc,target??before);
  if(!doc)continue;
  const feed={platform:item.platform,file:item.file,text:U.serializeFeed(doc),version,before:item.doc,beforeText:item.text};
  const {info}=U.readWithUpdater(feed.text,{file:feed.file});
  if(info.version!==version||JSON.stringify(info.files)!==JSON.stringify(U.readWithUpdater(item.text,{file:item.file}).info.files))throw Error('Internal check failed: '+feed.file+' would change more than who it reaches.');
  plan.feeds.push(feed);
 }
 // Widening and resuming send more people to the files: they are downloaded back and compared first, like a new version's.
 if(mode==='widen'||mode==='resume')for(const feed of plan.feeds)for(const file of feed.before.files)if(!plan.verify.some(item=>item.url===file.url))plan.verify.push({name:path.basename(new URL(file.url).pathname),url:file.url,sha512:file.sha512,size:file.size});
 return finish();
}

/** The review folder: planned feed files, notes, checksums and PLAN.json. No payload is copied into it. */
export async function writeReview({plan,dir}){
 await fs.rm(dir,{recursive:true,force:true});
 const folder0=plan.target?.dir||'feed';
 await fs.mkdir(path.join(dir,folder0),{recursive:true});
 for(const feed of plan.feeds){const out=path.join(dir,folder0,...feed.file.split('/'));await fs.mkdir(path.dirname(out),{recursive:true});await fs.writeFile(out,feed.text);}
 for(const release of plan.releases){
  const folder=path.join(dir,'release-'+release.platform);await fs.mkdir(folder,{recursive:true});
  await fs.writeFile(path.join(folder,'NOTES.md'),release.body);
  for(const asset of release.assets)if(asset.content!==undefined)await fs.writeFile(path.join(folder,asset.name),asset.content);
 }
if(plan.mirror)await fs.writeFile(path.join(dir,'MIRROR-FILES.txt'),'Put each file at its address (the same bytes; --publish checks every one of them by downloading it):\n\n'+plan.mirror.files.map(file=>(file.path||file.name)+'\n  -> '+file.url+(file.optional?'   (optional)':'')).join('\n')+'\n');
 const slim={...plan,releases:plan.releases.map(release=>({...release,assets:release.assets.map(({name,size,sha256,sha512,url,role,arch})=>({name,size,sha256,sha512,url,role,arch}))})),feeds:plan.feeds.map(({platform,file,version,before})=>({platform,file,version,before:before?{version:before.version,rollout:U.describeRollout(before)}:null}))};
 await fs.writeFile(path.join(dir,'PLAN.json'),JSON.stringify(slim,null,2)+'\n');
 return dir;
}

const TITLES={release:'',['add-arch']:'ADD THE MISSING MAC ARCHITECTURE to ',widen:'WIDEN ',halt:'HALT ',resume:'RESUME ',pace:'SET THE PACE OF '};
/** What a halt does to people, from desktop/browser-services/app-updater.cjs and electron-updater (docs/launch/RELEASING.md says the same). */
export const haltEffects=({version,percentage})=>[
 'What it does to people (the installed app: electron-updater offers a version only below its stagingPercentage, and Acira never downgrades):',
 '  - from each copy\'s next check (20 s after it starts, then every 8 hours) nobody is offered '+version+';',
 '  - copies that already installed '+version+' keep it. To move them, publish a higher version with the fix;',
 '  - a download already under way finishes and offers Install now. A Mac with a finished download does not check again, so it installs at Install now',
 '    or when Acira quits. On Windows the next check takes Install now away, but the finished setup still installs when Acira quits;',
 '  - a paused download stays paused: Resume finishes it in the same run, or after a restart asks the feed first and drops it;',
 '  - the releases stay up (the website still offers them to new installs). --resume-rollout offers '+version+' again'+(percentage&&percentage<100?' to '+percentage+'% of installs':'')+'.',
];
export function describePlan(plan,{log,review}){
 log('\n'+(plan.rehearsal?'REHEARSAL of ':'')+TITLES[plan.mode]+'Acira Browser '+plan.version+' on the '+plan.channel+' channel -> '+plan.repo);
 for(const release of plan.releases){
  log('\n  '+(release.addTo?'add to the published release ':'release ')+release.tag+'  ('+release.title+(release.prerelease?', pre-release':'')+')');
  for(const asset of release.assets)log('    upload  '+asset.name.padEnd(54)+mb(asset.size).padStart(10)+(asset.role?'   '+asset.role:''));
 }
 if(plan.verify.length)log('\n  first download back anonymously and compare SHA-512 and size: '+plan.verify.map(item=>item.name).join(', ')+' ('+mb(plan.verify.reduce((sum,item)=>sum+item.size,0))+')');
 log('\n  channel documents, '+(plan.releases.length||plan.verify.length?'committed last, ':'')+'one commit to '+BRANCH+' of '+plan.repo+':');
 // one line each for now and after (with the Mac architectures it hands out), then the diff with unchanged runs folded
 const summary=(doc,platform)=>{const arches=platform==='mac'?(doc.files||[]).map(file=>U.macArchOf(file.url)).filter(Boolean):[];return doc.version+(arches.length?' ('+arches.join(' + ')+')':'')+', '+U.describeRollout(doc);};
 for(const feed of plan.feeds){
  log('\n    '+(plan.target?.dir||'feed')+'/'+feed.file);
  log('      now:   '+(feed.before?summary(feed.before,feed.platform):'(no document yet)'));
  log('      after: '+summary(U.parseFeed(feed.text),feed.platform));
  for(const line of U.foldDiff(U.lineDiff(feed.beforeText,feed.text)))log('      '+line);
 }
 if(!plan.feeds.length)log('    (none)');
 if(plan.mirror){
  log('\n  mirror '+plan.mirror.base+' - these files must be there, byte for byte (the feed names them as files[].mirrors):');
  for(const file of plan.mirror.files)log('    '+(file.path?path.basename(file.path):file.name).padEnd(54)+' -> '+file.url+(file.optional?'  (optional: lets the setup download only what changed)':''));
 }
 for(const line of plan.untouched)log('    '+line);
 if(plan.mode==='halt')for(const line of haltEffects({version:plan.version,percentage:plan.feeds.map(feed=>U.rolloutOf(feed.before).percentage).find(Boolean)}))log('  '+line);
 if(review)log('\n  Review the planned feed files in '+review);
}

/** The channel document feed/<file> at a ref of the feed repository (not the CDN copy, which can be minutes old), or null when there is none. */
async function readFeedAt({gh,slug,file,ref,dir='feed'}){
 try{const found=await ghJson(gh,['api',`repos/${slug}/contents/${dir}/${file}?ref=${ref}`]);return U.parseFeed(Buffer.from(found.content,'base64').toString('utf8'));}
 catch(error){if(notFound(error))return null;throw error;}
}
/** The feed must still be what the plan was made from: a new version must still be newer, and every plan (a new version's previousBlockMaps come from
 *  the live Windows document; an edit changes one document) must find exactly the document it was made from. */
function checkCurrent(plan,current){
 for(const feed of plan.feeds){
  const doc=current[feed.file]??null;
  if(plan.mode==='release'&&!feed.rewrite&&doc?.version&&!semver.gt(feed.version,doc.version))throw Error((plan.target?.dir||'feed')+'/'+feed.file+' already offers '+doc.version+'; '+feed.version+' is not newer.');
  if(JSON.stringify(doc)!==JSON.stringify(feed.before??null))throw Error((plan.target?.dir||'feed')+'/'+feed.file+' is not what this plan was made from (it '+(doc?'offers '+doc.version+', '+U.describeRollout(doc):'does not exist')+(feed.before?'; the plan saw '+feed.before.version+', '+U.describeRollout(feed.before):'; the plan saw no document')+'). The public copy can be a few minutes old, or someone changed it: run the command again.');
 }
}

/** Commits the channel documents to feed/ in one commit. Fast-forward only: if somebody else moved main in the meantime this fails and changes nothing.
 *  check(docs) sees the documents as they are in the commit this one builds on, and can stop it. */
export async function commitFeed({gh,repo:slug,branch=BRANCH,files,message,check,dir='feed'}){
 const ref=await ghJson(gh,['api',`repos/${slug}/git/ref/heads/${branch}`]),parent=ref.object.sha;
 if(check){const docs={};for(const file of files)docs[file.file]=await readFeedAt({gh,slug,file:file.file,ref:parent,dir});check(docs);}
 const commit=await ghJson(gh,['api',`repos/${slug}/git/commits/${parent}`]);
 const tree=await ghJson(gh,['api','-X','POST',`repos/${slug}/git/trees`,'--input','-'],{input:JSON.stringify({base_tree:commit.tree.sha,tree:files.map(file=>file.text===null?{path:dir+'/'+file.file,mode:'100644',type:'blob',sha:null}:{path:dir+'/'+file.file,mode:'100644',type:'blob',content:file.text})})});
 const created=await ghJson(gh,['api','-X','POST',`repos/${slug}/git/commits`,'--input','-'],{input:JSON.stringify({message,tree:tree.sha,parents:[parent]})});
 await gh(['api','-X','PATCH',`repos/${slug}/git/refs/heads/${branch}`,'--input','-'],{input:JSON.stringify({sha:created.sha,force:false})});
 return created.sha;
}

const FEED_FILES=['latest-mac.yml','beta-mac.yml','latest.yml','beta.yml','linux/latest-linux.yml','linux/beta-linux.yml']; // every channel document the planning reads (none of them need to exist)
/** The local file to upload for an asset: the payload itself, or a generated file written under its plain name (gh names an asset after its file). */
async function assetFile({asset,release,workDir}){
 if(asset.content===undefined)return asset.path;
 const dir=path.join(workDir,release.platform);await fs.mkdir(dir,{recursive:true});
 const file=path.join(dir,asset.name);await fs.writeFile(file,asset.content);return file;
}
/** Puts the planned bytes in place of an asset that has others. Never one a live channel document names: installed copies download that one. */
async function replaceAsset({gh,slug,release,asset,workDir,referenced,log,why}){
 if(referenced.has(asset.url))throw Error(asset.name+' on '+release.tag+' '+why+', and a live channel document names it, so it is never replaced. Nothing was replaced and the feed was not changed.');
 log('  replacing '+asset.name+' on '+release.tag+' ('+why+')');
 await gh(['release','delete-asset',release.tag,asset.name,'--repo',slug,'--yes']);
 await gh(['release','upload',release.tag,await assetFile({asset,release,workDir}),'--repo',slug]);
}

/** Creates (or completes) one release as a draft, uploads what is missing, publishes it. A release that exists (an earlier run that stopped, or with
 *  release.addTo the live one, which must exist and be published) is completed: what it lacks is uploaded, a file of another size is replaced, and a
 *  file of the same size stays for the anonymous download that follows to check its bytes. A file a live channel document names is never replaced. */
async function ensureRelease({gh,slug,release,log,workDir,referenced}){
 let existing=null;
 try{existing=await ghJson(gh,['release','view',release.tag,'--repo',slug,'--json','tagName,isDraft,assets']);}catch(error){if(!notFound(error))throw error;}
 if(release.addTo&&(!existing||existing.isDraft))throw Error('The live feed names release '+release.tag+', but it '+(existing?'is a draft':'does not exist')+'. --add-arch adds to the published release the feed points at; check the feed.');
 if(existing){
  const names=new Set(existing.assets.map(asset=>asset.name)),missing=release.assets.filter(asset=>!names.has(asset.name)).map(asset=>asset.name);
  log('  '+release.tag+' exists'+(existing.isDraft?' (draft)':'')+(missing.length?'; adding '+missing.join(', '):' with every file')+'. Every file is checked by downloading it before the feed changes.');
 }else{
  const notesFile=path.join(workDir,'notes-'+release.platform+'.md');await fs.writeFile(notesFile,release.body);
  await gh(['release','create',release.tag,'--repo',slug,'--draft',...(release.prerelease?['--prerelease']:[]),'--title',release.title,'--notes-file',notesFile]);
  log('  created draft '+release.tag);
 }
 const have=new Map(((await ghJson(gh,['release','view',release.tag,'--repo',slug,'--json','assets'])).assets||[]).map(asset=>[asset.name,asset.size]));
 for(const asset of release.assets){
  if(have.has(asset.name)){if(have.get(asset.name)!==asset.size)await replaceAsset({gh,slug,release,asset,workDir,referenced,log,why:'is '+have.get(asset.name)+' bytes there, '+asset.size+' planned'});continue;}
  log('  uploading '+asset.name+(asset.size>1048576?' ('+mb(asset.size)+')':''));
  await gh(['release','upload',release.tag,await assetFile({asset,release,workDir}),'--repo',slug]);
 }
 const after=new Map(((await ghJson(gh,['release','view',release.tag,'--repo',slug,'--json','assets'])).assets||[]).map(asset=>[asset.name,asset.size]));
 for(const asset of release.assets)if(after.get(asset.name)!==asset.size)throw Error(asset.name+' is not attached to '+release.tag+' with the right size after uploading.');
 const state=await ghJson(gh,['release','view',release.tag,'--repo',slug,'--json','isDraft']);
 if(state.isDraft){await gh(['release','edit',release.tag,'--repo',slug,'--draft=false',...(release.prerelease?['--prerelease']:[])]);log('  published '+release.tag);}
}

/** Runs the older-versions check (packaging/update-compat.cjs); throws, naming every problem, when one version could not reach the new one. deps.compat replaces it in tests. */
export async function compatCheck({plan,deps={},fetch=deps.fetch??globalThis.fetch,sleep,delays,assumePlanned=false}){
 const result=await (deps.compat||COMPAT.preflight)({plan,fetch,sleep,delays,assumePlanned});
 if(!result.ok)throw Error('Some older versions could not reach '+plan.version+', so nothing was published to the feed:\n  - '+result.problems.join('\n  - ')+(result.warnings?.length?'\n  (also: '+result.warnings.join(' | ')+')':''));
 return result;
}

/** Publishes the plan. The feed commit is the last remote write; every earlier failure leaves it untouched. */
export async function publishPlan({plan,deps,options}){
 const {gh,fetch=globalThis.fetch,log=()=>{},sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),delays}=deps,slug=plan.repo,target=plan.target||DEFAULT_TARGETS.legacy,state={releases:[],feedCommit:null};
 const work=await fs.mkdtemp(path.join(os.tmpdir(),'acira-publish-'));
 try{
  const info=await ghJson(gh,['api',`repos/${slug}`]);
  if(info.private!==false)throw Error(slug+' is not public: installed copies could not read the feed.');
  if(info.permissions&&info.permissions.push!==true)throw Error('The signed-in GitHub account cannot push to '+slug+'.');
  if(info.default_branch!==target.branch)throw Error(slug+' has default branch '+info.default_branch+', but the documents are read from '+target.branch+'.');
  // The authoritative feed (not the CDN copy): checked before anything is uploaded, and again on the commit the feed commit builds on.
  const current={};for(const file of [...new Set([...FEED_FILES,...plan.feeds.map(feed=>feed.file)])])current[file]=await readFeedAt({gh,slug,file,ref:target.branch,dir:target.dir});
  checkCurrent(plan,current);
  // the mirror holds exactly the files this release names (they are local files, so this needs nothing from GitHub): before anything is uploaded or committed
  if(plan.mirror){log('\nChecking the mirror '+plan.mirror.base+'...');await mirrorCheck({plan,fetch,sleep,delays,strict:true,log});}
  // every file a live document names (its setups and ZIPs, and the blockmaps its previousBlockMaps point at): never replaced
  const referenced=new Set(Object.values(current).flatMap(doc=>[...(doc?.files||[]),...(doc?.previousBlockMaps||[])]).map(entry=>entry?.url).filter(Boolean));
  state.referenced=referenced;
  // 1. payloads
  for(const release of plan.releases){log('\nRelease '+release.tag);state.releases.push(release.tag);await ensureRelease({gh,slug,release,log,workDir:work,referenced});}
  // 2. every payload the documents will name, downloaded with no credentials, must be byte-for-byte what was planned. One of ours that comes back as
  //    other bytes (a damaged upload, or a file a stopped run left) is replaced once and checked again; files of the live documents never are.
  const queue=[...plan.releases.flatMap(release=>release.assets.map(asset=>({release,asset,name:asset.name,url:asset.url,sha512:asset.sha512,size:asset.size}))),...plan.verify];
  if(queue.length)log('\nDownloading every file anonymously and comparing SHA-512...');
  const check=next=>verifyDownload({fetch,url:next.url,sha512:next.sha512,size:next.size,sleep,delays});
  const workers=Array.from({length:2},async()=>{for(let next=queue.shift();next;next=queue.shift()){
   try{await check(next);}
   catch(error){if(!error.mismatch||!next.release)throw error;await replaceAsset({gh,slug,release:next.release,asset:next.asset,workDir:work,referenced,log,why:'it downloads as other bytes than planned'});await check(next);}
   log('  verified '+next.name);
  }});
  await Promise.all(workers);
  // 2b. every older version still in use (beta.8 and later) must be able to reach this one through the documents as they will be live, and no document may name a file
  //     that is not there (packaging/update-compat.cjs). A failure stops here: the feed is untouched.
  if(plan.feeds.length&&['release','add-arch'].includes(plan.mode)&&deps.compat!==false){
   log('\nChecking that every older version can reach '+plan.version+'...');
   const reach=await compatCheck({plan,deps,fetch,sleep,delays});
   for(const warning of reach.warnings)log('  ! '+warning);
   log('  '+reach.paths.length+' paths read the way each version reads them, '+reach.probed+' files asked for.');
  }
  // 3. only now the channel documents
  if(!plan.feeds.length){log('\nNo channel document to update.');return state;}
  const what={release:plan.releases.map(release=>release.platform).join(' + '),['add-arch']:'add '+plan.releases.flatMap(release=>release.arches||[]).join('+'),widen:'widened, '+U.describeRollout(U.parseFeed(plan.feeds[0].text)),halt:'halted',resume:'resumed, '+U.describeRollout(U.parseFeed(plan.feeds[0].text))}[plan.mode];
  const message='Feed: Acira Browser '+plan.version+' ('+plan.channel+', '+what+')\n\n'+[...plan.releases.map(release=>release.tag),...plan.feeds.map(feed=>target.dir+'/'+feed.file+': '+U.describeRollout(U.parseFeed(feed.text)))].join('\n');
  log('\nCommitting the channel documents ('+plan.feeds.map(feed=>feed.file).join(', ')+')...');
  state.feedCommit=await commitFeed({gh,repo:slug,branch:target.branch,dir:target.dir,files:plan.feeds,message,check:docs=>checkCurrent(plan,docs)});
  log('  committed '+state.feedCommit);
  return state;
 }catch(error){
  error.state=state;
  // Never advise deleting a release a live document names: every installed copy downloads from it (and the website offers its files).
  const named=tag=>[...(state.referenced||[])].some(url=>U.tagOf(url)===tag);
  error.recovery=[
   'The channel documents in feed/ were '+(state.feedCommit?'COMMITTED before this failure':'NOT touched')+'.',
   ...(state.feedCommit?[]:plan.releases.filter(release=>state.releases.includes(release.tag)).map(release=>release.addTo||named(release.tag)?'Files may have been added to '+release.tag+', the release the live feed points at. No channel document names them yet. Do not delete that release: installed copies download from it.':'Release '+release.tag+' may exist; no channel document names it. To drop it instead of resuming: gh release delete '+release.tag+' --repo '+slug+' --cleanup-tag --yes')),
   'Running the same command again resumes: it reuses what is there, checks every file by downloading it, and replaces only files no channel document names.',
  ];
  throw error;
 }finally{await fs.rm(work,{recursive:true,force:true});}
}

/** After the commit, waits until anyone can read the new documents from the public URL (raw.githubusercontent.com caches for a few minutes). */
export async function waitForFeed({plan,fetch,log,sleep,minutes=8}){
 const deadline=Date.now()+minutes*60000;let pending=plan.feeds.slice();
 while(pending.length&&Date.now()<deadline){
  const next=[];
  for(const feed of pending){const live=await U.readLiveFeed({fetch,file:feed.file,baseUrl:plan.target?.publicBase});if(live.text!==feed.text)next.push(feed);else log('  live: '+feed.file+' now offers '+feed.version+', '+U.describeRollout(live.doc));}
  pending=next;if(pending.length){log('  waiting for the public copy of '+pending.map(feed=>feed.file).join(', ')+' (GitHub caches it for up to 5 minutes)...');await sleep(20000);}
 }
 return pending.length===0;
}

export async function main(argv=process.argv.slice(2),overrides={}){
 const options=parseArguments(argv);
 if(options.help||!argv.length){console.log(HELP);return 0;}
 const log=overrides.log||console.log;
 const transport=options['stand-in']?standInTransport(options['stand-in']):null;
 const deps={log,fetch:globalThis.fetch,root:repo,now:()=>new Date(),...require('../packaging/macos/update-verify.cjs'),inspectWindowsInstaller,inspectLinuxBuild,gh:ghCli(),...(transport||{}),target:DEFAULT_TARGETS[options.target||'legacy'],withLinux:Boolean(options['linux-dir'])||options.target!==undefined,...overrides};
 if(transport)log('STAND-IN: every GitHub and feed request goes to '+transport.label+'; nothing reaches GitHub and gh is not used.');
 const editing=FEED_EDITS.some(name=>options[name]!==undefined);
 const result=editing?await planFeedChange(options,deps):await planUpdate(options,deps);
 if(result.problems.length||!result.ok){
  log('\nREFUSED. Nothing was uploaded or changed.\n');for(const problem of result.problems)log('  x '+problem);for(const warning of result.warnings)log('  ! '+warning);
  return 1;
 }
 const mode=result.plan.mode,verb={release:'release',['add-arch']:'add it',widen:'widen it',halt:'halt it',resume:'resume it',pace:'set the pace'}[mode];
 const review=await writeReview({plan:result.plan,dir:path.resolve(options['review-dir']||path.join(repo,'release/update-review',options.version+'-'+(options.channel||'beta')+(mode==='release'?'':'-'+mode)))});
 describePlan(result.plan,{log,review});
 for(const warning of result.warnings)log('  ! '+warning);
 if(result.plan.mirror){
  // the same check --publish makes, except that a file that is not there yet is only said (it is put there before --publish); a different one refuses
  try{
   const found=await mirrorCheck({plan:result.plan,fetch:deps.fetch,sleep:deps.sleep,delays:deps.mirrorDelays??[],strict:false,log});
   log('\nMirror '+result.plan.mirror.base+': '+found.same.length+' of '+result.plan.mirror.files.length+' files are there and identical.');
   for(const file of found.missing)log('  ! '+(file.optional?'(optional) ':'')+'not on the mirror yet: '+file.url+' ('+(file.path?path.basename(file.path):file.name)+'); put it there before --publish.');
  }catch(error){log('\nREFUSED by the mirror check. Nothing was uploaded or changed.\n\n  x '+error.message);return 1;}
 }
 if(['release','add-arch'].includes(mode)&&result.plan.feeds.length&&deps.compat!==false){
  // the same check the real run makes before it switches the feed; the files this run would upload are taken as there
  try{const reach=await compatCheck({plan:result.plan,deps,assumePlanned:true});for(const warning of reach.warnings)log('  ! '+warning);log('\nOlder versions: '+reach.paths.length+' update paths read the way each version reads them; every one reaches '+options.version+' (or the frozen feed\'s bridge) and every named file is there.');}
  catch(error){log('\nREFUSED by the older-versions check. Nothing was uploaded or changed.\n\n  x '+error.message);return 1;}
 }
 if(!options.publish){log('\nDRY RUN OK. Nothing was uploaded or changed. Run the same command with --publish --yes to '+verb+'.');return 0;}
 if(!options.yes){
  if(!process.stdin.isTTY)throw Error('--publish asks for confirmation; run it in a terminal, or add --yes.');
  const rl=readline.createInterface({input:process.stdin,output:process.stdout}),answer=await rl.question('\n'+(mode==='release'?'Publish':verb[0].toUpperCase()+verb.slice(1,verb.indexOf(' ')))+' version '+options.version+' on '+U.UPDATE_REPOSITORY+' now? Type the version to continue: ');rl.close();
  if(answer.trim()!==options.version){log('Nothing changed.');return 1;}
 }
 try{
  const state=await publishPlan({plan:result.plan,deps,options});
  if(state.feedCommit&&!options['no-wait']){const seen=await waitForFeed({plan:result.plan,fetch:deps.fetch,log,sleep:deps.sleep||(ms=>new Promise(resolve=>setTimeout(resolve,ms)))});log(seen?'\nThe public feed shows the change.':'\nCommitted, but the public copy has not refreshed yet; it will within minutes.');}
  log(mode==='release'||mode==='add-arch'?'\nPUBLISHED. Next: open one installed copy of the previous version and check that it updates (docs/launch/RELEASING.md, last step).':'\nDONE. '+result.plan.feeds.map(feed=>'feed/'+feed.file+': '+U.describeRollout(U.parseFeed(feed.text))).join('; ')+'.');
  return 0;
 }catch(error){
  log('\nSTOPPED: '+error.message);for(const line of error.recovery||[])log('  - '+line);
  return 1;
 }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 main().then(code=>{process.exitCode=code;},error=>{console.error(error.message);process.exitCode=1;});
}
