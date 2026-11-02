// One command for a release that reaches everyone who already installed Acira. DRY RUN unless --publish is given: it checks everything, prints
// exactly what would be uploaded, writes the planned feed files to a review folder, and changes nothing remote. With --publish it creates the releases
// on Acira-dev/AciraBrowserUpdates, uploads, downloads every payload anonymously and compares its SHA-512, and only then commits the channel documents
// in feed/ (the files installed copies read). Any failure before that last step leaves the feed untouched, so nobody is offered an update that cannot download.
// Usage and rules: docs/launch/PUBLIC_UPDATES.md ("How to ship an update").
import fs from 'node:fs/promises';
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
const {writeMacUpdateFeed}=require('../packaging/macos/update-feed.cjs');
const BRANCH='main'; // the feed URL in every installed app names this branch
const MAC_ZIP=/^AciraBrowser-(.+)-mac-(arm64|x64)-update\.zip$/,MAC_DMG=/^AciraBrowser-(.+)-mac-(arm64|x64)\.dmg$/;
const WINDOWS_EXE='AciraBrowserSetup.exe';

export const HELP=`Usage: node scripts/publish-update.mjs --version <0.1.0-beta.7> [options]            (dry run: nothing is uploaded)
       node scripts/publish-update.mjs --version <0.1.0-beta.7> [options] --publish [--yes]

  --channel beta|stable      beta (default) for 0.1.0-beta.N; stable for plain versions (also reaches people on beta)
  --notes-file <file>        what's new, one bullet per line; or --notes "<text>"; --no-notes publishes without notes
  --mac-dir <folder>         release/mac-widevine-<version>-<commit>.noindex (default: found in release/ from --version)
  --mac-arm64-zip --mac-x64-zip --mac-arm64-dmg --mac-x64-dmg <file>      pick the Mac files yourself
  --windows-dir <folder>     the folder npm run build:windows wrote (AciraBrowserSetup.exe, its .blockmap, latest.yml); or --windows-exe <file>
  --windows-assume-updater   the Windows setup is known to carry resources/app-update.yml (otherwise the Windows feed is left alone)
  --windows-download-only    publish the Windows setup for download without a Windows feed entry
  --allow-single-arch        publish only one Mac architecture (the other keeps its old version)
  --review-dir <folder>      where the dry run writes the planned feed files (default release/update-review/<version>-<channel>)
  --rehearsal                dry run only, never with --publish: tolerate artifacts built as another version than --version (to try the tool on an old build)
  --commit <hex>             tag suffix when the artifacts carry no commit
  --no-wait                  do not wait for the feed CDN after publishing
`;

export function parseArguments(argv){
 const flags=new Set(['publish','rehearsal','yes','no-notes','allow-single-arch','windows-download-only','windows-assume-updater','no-wait','help']);
 const values=new Set(['version','channel','notes','notes-file','mac-dir','mac-arm64-zip','mac-x64-zip','mac-arm64-dmg','mac-x64-dmg','windows-dir','windows-exe','windows-blockmap','windows-latest-yml','review-dir','commit']);
 const options={};
 for(let index=0;index<argv.length;index++){
  const argument=argv[index];if(!argument.startsWith('--'))throw Error('Unexpected argument '+argument+'.\n\n'+HELP);
  const name=argument.slice(2);
  if(flags.has(name))options[name]=true;
  else if(values.has(name)){const value=argv[++index];if(value===undefined||value.startsWith('--'))throw Error('--'+name+' needs a value.');options[name]=value;}
  else throw Error('Unknown option '+argument+'.\n\n'+HELP);
 }
 return options;
}

const exists=file=>fs.access(file).then(()=>true,()=>false);
const readJSON=async file=>JSON.parse(await fs.readFile(file,'utf8'));
const mb=bytes=>bytes>=1048576?(bytes/1048576).toFixed(1)+' MB':Math.max(1,Math.round(bytes/1024))+' KB';

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
const ghJson=async(gh,args,options)=>JSON.parse(await gh(args,options));
const notFound=error=>/HTTP 404|release not found|Not Found/i.test(String(error?.stderr||'')+String(error?.message||''));

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
   if(bytes!==size)throw Error('downloaded '+bytes+' bytes, expected '+size);
   if(actual!==sha512)throw Error('SHA-512 differs from the file that was uploaded');
   return true;
  }catch(error){last=error;if(attempt<delays.length)await sleep(delays[attempt]);}
 }
 throw Error('Anonymous download of '+url+' failed: '+last.message);
}

/** Finds the Mac build folders for a version: release/mac-widevine-<version>-<commit>.noindex/{arm64,x64}-*, each with its receipt. */
async function discoverMac({version,macDir,root}){
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
  const dir=dirs[0].dir,receipt=await readJSON(path.join(dir,'mac-widevine-package.json')).catch(()=>null),names=await fs.readdir(dir);
  result[arch]={dir,receipt,zip:names.filter(name=>MAC_ZIP.test(name)).map(name=>path.join(dir,name))[0]||null,dmg:names.filter(name=>MAC_DMG.test(name)).map(name=>path.join(dir,name))[0]||null};
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
  if(doc)evidence.push({source:name,version:doc.version,commit:doc.sourceCommit||doc.commit,updateConfig:doc.payload?.updateConfig||doc.updateConfig});
 }
 return {exe,blockmap:(await exists(blockmap))?blockmap:null,evidence};
}

/** Pulls a Windows setup apart far enough to say whether the installed app will find a feed. null = could not tell (no 7-Zip here). */
export async function inspectWindowsInstaller({exe,evidence=[]}){
 const header=Buffer.alloc(2),handle=await fs.open(exe,'r');try{await handle.read(header,0,2,0);}finally{await handle.close();}
 if(header.toString('latin1')!=='MZ')throw Error('That is not a Windows executable.');
 const recorded=evidence.find(item=>item.updateConfig);
 if(recorded)return {updateConfig:recorded.updateConfig.url===U.RAW_FEED_BASE||recorded.updateConfig===true,source:recorded.source};
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
 * Everything the dry run and the real run share. Resolves to {ok, problems, warnings, plan, report}.
 * deps: fetch, inspectMacZip, inspectMacDmg, inspectWindowsInstaller, log, now.
 */
export async function planUpdate(options,deps){
 const {log=()=>{},now=()=>new Date(),fetch=globalThis.fetch,root=repo}=deps;
 const problems=[],warnings=[],version=options.version,channel=options.channel||'beta',rehearsal=Boolean(options.rehearsal);
 const mismatch=message=>(rehearsal?warnings.push('REHEARSAL, would be an error: '+message):problems.push(message));
 if(rehearsal&&options.publish)throw Error('--rehearsal is for dry runs only and cannot be combined with --publish.');
 if(!version)throw Error('Say which version: --version 0.1.0-beta.7\n\n'+HELP);
 problems.push(...U.versionProblems(version,channel));
 const effective=version;
 // --- inputs ---
 const mac={arm64:{},x64:{}};let macBase=null;
 const explicit={arm64:{zip:options['mac-arm64-zip'],dmg:options['mac-arm64-dmg']},x64:{zip:options['mac-x64-zip'],dmg:options['mac-x64-dmg']}};
 const wantsMac=Object.values(explicit).some(item=>item.zip||item.dmg)||options['mac-dir']||!options['windows-dir']&&!options['windows-exe'];
 if(wantsMac){
  const found=await discoverMac({version,macDir:options['mac-dir'],root});macBase=found.base;
  for(const arch of U.ARCHES){
   const zip=explicit[arch].zip?path.resolve(explicit[arch].zip):found[arch]?.zip,dmg=explicit[arch].dmg?path.resolve(explicit[arch].dmg):found[arch]?.dmg;
   mac[arch]={zip,dmg,receipt:found[arch]?.receipt||null};
  }
 }
 const windows=await discoverWindows({windowsDir:options['windows-dir'],windowsExe:options['windows-exe'],windowsBlockmap:options['windows-blockmap'],windowsLatestYml:options['windows-latest-yml']});
 if(wantsMac){
  const present=U.ARCHES.filter(arch=>mac[arch].zip);
  if(!present.length)problems.push('No Mac update ZIP found. Build with scripts/package-mac-widevine.mjs (it now writes one per architecture), or pass --mac-arm64-zip and --mac-x64-zip.');
  else if(present.length<2&&!options['allow-single-arch'])problems.push('Only the '+present.join('/')+' Mac update ZIP was found. Without the other one those Macs would never update. Pass both, or --allow-single-arch if that is intended.');
  for(const arch of U.ARCHES)if(!mac[arch].zip&&mac[arch].dmg)problems.push('The '+arch+' DMG has no matching update ZIP.');
 }
 if(!wantsMac&&!windows)problems.push('Nothing to publish: no Mac files and no Windows setup.');
 // --- the version has to beat everything already out there ---
 const live=[];
 const platforms=[...(wantsMac?['mac']:[]),...(windows?['windows']:[])];
 for(const platform of platforms)for(const file of U.feedFiles(channel,platform)){
  const feed=await U.readLiveFeed({fetch,file});live.push({platform,...feed});
  if(feed.error){(options.publish?problems:warnings).push('Could not read the live feed '+file+' ('+feed.error+'), so "newer than the feed" was not checked.');}
 }
 const references=[...U.SHIPPED.map(item=>({label:item.what,version:item.version})),...live.filter(item=>item.version).map(item=>({label:'the live feed '+item.file,version:item.version}))];
 problems.push(...U.newerProblems(effective,references));
 // --- the Mac files ---
 const checks={mac:{},windows:null},assets={mac:[],windows:[]};
 const commits=new Set();
 for(const arch of U.ARCHES){
  const item=mac[arch];if(!item.zip&&!item.dmg)continue;
  if(item.zip){
   const name=path.basename(item.zip),match=MAC_ZIP.exec(name);
   if(!match||match[2]!==arch)problems.push(name+' is not named AciraBrowser-<version>-mac-'+arch+'-update.zip.');
   else if(match[1]!==effective)mismatch(name+' is version '+match[1]+', not '+effective+'.');
   if(!(await exists(item.zip))){problems.push(item.zip+' does not exist.');continue;}
   log('Checking the '+arch+' update ZIP (unzip, codesign, stapler, spctl)...');
   try{
    const proof=await deps.inspectMacZip({zip:item.zip,arch,version:rehearsal?undefined:effective});
    if(rehearsal&&proof.version!==effective)warnings.push('REHEARSAL, would be an error: the app inside '+name+' says '+proof.version+', not '+effective+'.');
    checks.mac[arch]={zip:proof};if(proof.commit)commits.add(proof.commit);
   }catch(error){problems.push(name+': '+error.message);}
   assets.mac.push({...await U.describeFile(item.zip),role:'update',arch});
  }
  if(item.dmg){
   const name=path.basename(item.dmg),match=MAC_DMG.exec(name);
   if(!match||match[2]!==arch)problems.push(name+' is not named AciraBrowser-<version>-mac-'+arch+'.dmg.');
   else if(match[1]!==effective)mismatch(name+' is version '+match[1]+', not '+effective+'.');
   if(item.receipt&&item.receipt.version!==match?.[1])mismatch(name+': its build receipt says version '+item.receipt.version+'.');
   if(!(await exists(item.dmg))){problems.push(item.dmg+' does not exist.');continue;}
   log('Checking the '+arch+' disk image...');
   try{checks.mac[arch]={...checks.mac[arch],dmg:await deps.inspectMacDmg({dmg:item.dmg})};}catch(error){problems.push(name+': '+error.message);}
   const described=await U.describeFile(item.dmg);
   if(item.receipt?.sha256&&item.receipt.sha256!==described.sha256)problems.push(name+' differs from the file its build receipt describes (SHA-256 mismatch).');
   assets.mac.push({...described,role:'installer',arch});
   if(item.receipt?.commit)commits.add(item.receipt.commit);
  }
 }
 if(commits.size>1)problems.push('The Mac files come from different commits ('+[...commits].map(commit=>commit.slice(0,8)).join(', ')+'). Rebuild both architectures from one commit.');
 const macCommit=[...commits][0]||options.commit||null;
 if(wantsMac&&assets.mac.length&&!macCommit)problems.push('No commit is known for the Mac files; pass --commit <hex>.');
 // --- the Windows files ---
 let windowsCommit=null,windowsFeedAllowed=false;
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
   if(!U.WINDOWS_VERSION.test(effective))warnings.push(effective+' does not match the Windows build rule ^0.1.N-beta.N$ (scripts/build-windows.mjs); that build would have refused it.');
   for(const item of windows.evidence)if(item.sha512&&item.sha512!==described.sha512||item.size&&item.size!==described.size)problems.push(item.source+' describes a different file than '+path.basename(exe)+' (SHA-512 or size differs). Was it rebuilt after latest.yml was written?');
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
   if(windows.blockmap)assets.windows.push({...await U.describeFile(windows.blockmap),role:'blockmap'});
   else warnings.push('No '+path.basename(exe)+'.blockmap: Windows users download the whole installer instead of just what changed.');
  }
 }
 // --- notes ---
 let notesText=options.notes;if(options['notes-file'])notesText=await fs.readFile(path.resolve(options['notes-file']),'utf8');
 const notes=U.releaseNotes(notesText);
 if(!notes.markdown){(options.publish&&!options['no-notes']?problems:warnings).push('No release notes. Installed copies show them in the "what\'s new" popup after the update. Pass --notes-file <file> (one bullet per line)'+(options.publish?' or --no-notes.':'.'));}
 if(notes.plain.length>U.NOTES_MAX)warnings.push('The notes are '+notes.plain.length+' characters; the app shows the first '+U.NOTES_MAX+'.');
 // --- the plan: releases and feed files ---
 const releaseDate=now().toISOString(),plan={version,channel,rehearsal,repo:U.UPDATE_REPOSITORY,releases:[],feeds:[],releaseDate};
 const finish=ok=>({ok:ok&&problems.length===0,problems,warnings,plan,checks,live,assets});
 if(problems.length)return finish(false);
 const staging=await fs.mkdtemp(path.join(os.tmpdir(),'acira-feed-staging-'));
 try{
  if(assets.mac.length){
   const tag=U.releaseTag({version,platform:'mac',commit:macCommit}),zips=assets.mac.filter(asset=>asset.role==='update'),releaseName='Acira Browser '+effective;
   const release={platform:'mac',tag,title:releaseName+' (Mac)',prerelease:channel==='beta',assets:assets.mac.map(asset=>({...asset,url:U.assetUrl(tag,asset.name)}))};
   // writeMacUpdateFeed (the packager's own writer) computes the hashes the feed carries; they must agree with the ones computed above.
   for(const zip of zips)await fs.link(zip.path,path.join(staging,zip.name)).catch(()=>fs.copyFile(zip.path,path.join(staging,zip.name),fs.constants.COPYFILE_FICLONE)); // a hard link (or clone) costs nothing; writeMacUpdateFeed wants the ZIPs in one folder
   const base=await writeMacUpdateFeed({output:staging,version:effective,releaseDate,artifacts:zips.map(zip=>({zip:path.join(staging,zip.name),arch:zip.arch}))});
   const baseText=await fs.readFile(base.file,'utf8'),baseDoc=JSON.parse(baseText);
   for(const file of baseDoc.files){const zip=zips.find(item=>item.name===file.url);if(!zip||zip.sha512!==file.sha512||zip.size!==file.size)throw Error('Internal check failed: writeMacUpdateFeed and the publisher disagree about '+file.url+'.');}
   const doc=U.finalizeMacFeed(baseText,{urlFor:name=>U.assetUrl(tag,name),releaseName,releaseNotes:notes.plain}),text=U.serializeFeed(doc);
   for(const file of U.feedFiles(channel,'mac'))plan.feeds.push({platform:'mac',file,text,version:effective});
   release.body=U.releaseBody({notes,platform:'mac'});
   plan.releases.push(release);
  }
  if(assets.windows.length){
   const tag=U.releaseTag({version,platform:'windows',commit:windowsCommit}),exe=assets.windows.find(asset=>asset.role==='installer'),releaseName='Acira Browser '+effective;
   const release={platform:'windows',tag,title:releaseName+' (Windows)',prerelease:channel==='beta',assets:assets.windows.map(asset=>({...asset,url:U.assetUrl(tag,asset.name)})),body:U.releaseBody({notes,platform:'windows'}),feedEntry:windowsFeedAllowed};
   if(windowsFeedAllowed){
    const doc=U.windowsFeed({version:effective,file:exe,url:U.assetUrl(tag,exe.name),releaseDate,releaseName,releaseNotes:notes.plain}),text=U.serializeFeed(doc);
    for(const file of U.feedFiles(channel,'windows'))plan.feeds.push({platform:'windows',file,text,version:effective});
   }
   plan.releases.push(release);
  }
  // Every release also carries its checksums and a record of what was checked.
  for(const release of plan.releases){
   const files=release.assets.slice(),sums={name:'SHA256SUMS.txt',content:U.checksumsText(files),role:'checksums'};
   const info={name:'BUILD-INFO.json',content:JSON.stringify(U.buildInfo({version:effective,channel,platform:release.platform,commit:release.platform==='mac'?macCommit:windowsCommit,assets:files,checks:release.platform==='mac'?checks.mac:checks.windows,builtAt:releaseDate}),null,2)+'\n',role:'info'};
   for(const generated of [sums,info]){generated.size=Buffer.byteLength(generated.content);generated.sha256=createHash('sha256').update(generated.content).digest('hex');generated.sha512=createHash('sha512').update(generated.content).digest('base64');generated.url=U.assetUrl(release.tag,generated.name);release.assets.push(generated);}
  }
  // Read every planned feed document back the way an installed app does, and check it points at the assets it should.
  for(const feed of plan.feeds){
   const {info,files}=U.readWithUpdater(feed.text,{file:feed.file});
   if(info.version!==effective)throw Error('Internal check failed: '+feed.file+' carries '+info.version+'.');
   const release=plan.releases.find(item=>item.platform===feed.platform);
   for(const file of files){
    const asset=release.assets.find(item=>item.url===file.url.href);
    if(!asset||asset.sha512!==file.info.sha512||asset.size!==file.info.size)throw Error('Internal check failed: '+feed.file+' names '+file.url.href+' which is not an uploaded asset with those hashes.');
   }
   if(feed.platform==='mac'){
    const {MacUpdater}=require('electron-updater/out/MacUpdater');
    for(const [isArm,arch] of [[true,'arm64'],[false,'x64']]){
     const chosen=MacUpdater.filterFilesForArch(files,isArm);
     if(U.ARCHES.filter(a=>assets.mac.some(asset=>asset.role==='update'&&asset.arch===a)).includes(arch)&&(chosen.length!==1||!chosen[0].url.href.includes('-'+arch+'-')))throw Error('Internal check failed: '+feed.file+' would not give '+arch+' Macs the '+arch+' archive.');
    }
   }
  }
 }finally{await fs.rm(staging,{recursive:true,force:true});}
 return finish(true);
}

/** The review folder: planned feed files, notes, checksums and PLAN.json. No payload is copied into it. */
async function writeReview({plan,dir}){
 await fs.rm(dir,{recursive:true,force:true});
 await fs.mkdir(path.join(dir,'feed'),{recursive:true});
 for(const feed of plan.feeds)await fs.writeFile(path.join(dir,'feed',feed.file),feed.text);
 for(const release of plan.releases){
  const folder=path.join(dir,'release-'+release.platform);await fs.mkdir(folder,{recursive:true});
  await fs.writeFile(path.join(folder,'NOTES.md'),release.body);
  for(const asset of release.assets)if(asset.content!==undefined)await fs.writeFile(path.join(folder,asset.name),asset.content);
 }
 const slim={...plan,releases:plan.releases.map(release=>({...release,assets:release.assets.map(({name,size,sha256,sha512,url,role,arch})=>({name,size,sha256,sha512,url,role,arch}))})),feeds:plan.feeds.map(({platform,file,version})=>({platform,file,version}))};
 await fs.writeFile(path.join(dir,'PLAN.json'),JSON.stringify(slim,null,2)+'\n');
 return dir;
}

function describePlan(plan,{log,review}){
 log('\n'+(plan.rehearsal?'REHEARSAL of ':'')+'Acira Browser '+plan.version+' on the '+plan.channel+' channel -> '+plan.repo);
 for(const release of plan.releases){
  log('\n  release '+release.tag+'  ('+release.title+(release.prerelease?', pre-release':'')+')');
  for(const asset of release.assets)log('    upload  '+asset.name.padEnd(54)+mb(asset.size).padStart(10)+(asset.role?'   '+asset.role:''));
 }
 log('\n  channel documents, committed last, one commit to '+BRANCH+' of '+plan.repo+':');
 for(const feed of plan.feeds)log('    feed/'+feed.file+'  ->  '+feed.version);
 if(!plan.feeds.length)log('    (none)');
 if(review)log('\n  Review the planned feed files in '+review);
}

/** Commits the channel documents to feed/ in one commit. Fast-forward only: if somebody else moved main in the meantime this fails and changes nothing. */
export async function commitFeed({gh,repo:slug,branch=BRANCH,files,message}){
 const ref=await ghJson(gh,['api',`repos/${slug}/git/ref/heads/${branch}`]),parent=ref.object.sha;
 const commit=await ghJson(gh,['api',`repos/${slug}/git/commits/${parent}`]);
 const tree=await ghJson(gh,['api','-X','POST',`repos/${slug}/git/trees`,'--input','-'],{input:JSON.stringify({base_tree:commit.tree.sha,tree:files.map(file=>({path:'feed/'+file.file,mode:'100644',type:'blob',content:file.text}))})});
 const created=await ghJson(gh,['api','-X','POST',`repos/${slug}/git/commits`,'--input','-'],{input:JSON.stringify({message,tree:tree.sha,parents:[parent]})});
 await gh(['api','-X','PATCH',`repos/${slug}/git/refs/heads/${branch}`,'--input','-'],{input:JSON.stringify({sha:created.sha,force:false})});
 return created.sha;
}

/** Creates (or completes) one release as a draft, uploads what is missing, publishes it, and returns once every asset is there. */
async function ensureRelease({gh,slug,release,log,workDir}){
 let existing=null;
 try{existing=await ghJson(gh,['release','view',release.tag,'--repo',slug,'--json','tagName,isDraft,assets']);}catch(error){if(!notFound(error))throw error;}
 if(existing&&!existing.isDraft){
  const names=new Set(existing.assets.map(asset=>asset.name));
  if(release.assets.every(asset=>names.has(asset.name)))log('  '+release.tag+' already exists with every file; continuing to verification.');
  else throw Error(release.tag+' is already published but is missing '+release.assets.filter(asset=>!names.has(asset.name)).map(asset=>asset.name).join(', ')+'. Delete it (gh release delete '+release.tag+' --repo '+slug+' --cleanup-tag) and run again.');
 }
 if(!existing){
  const notesFile=path.join(workDir,'notes-'+release.platform+'.md');await fs.writeFile(notesFile,release.body);
  await gh(['release','create',release.tag,'--repo',slug,'--draft',...(release.prerelease?['--prerelease']:[]),'--title',release.title,'--notes-file',notesFile]);
  log('  created draft '+release.tag);
 }
 const have=new Map(((await ghJson(gh,['release','view',release.tag,'--repo',slug,'--json','assets'])).assets||[]).map(asset=>[asset.name,asset.size]));
 for(const asset of release.assets){
  if(have.has(asset.name)){if(have.get(asset.name)!==asset.size)throw Error(asset.name+' is already attached to '+release.tag+' with a different size ('+have.get(asset.name)+' vs '+asset.size+'). Delete the release and run again.');continue;}
  let file=asset.path;
  // gh names an asset after its file, so a generated file keeps its plain name, in a folder per platform.
  if(asset.content!==undefined){const dir=path.join(workDir,release.platform);await fs.mkdir(dir,{recursive:true});file=path.join(dir,asset.name);await fs.writeFile(file,asset.content);}
  log('  uploading '+asset.name+(asset.size>1048576?' ('+mb(asset.size)+')':''));
  await gh(['release','upload',release.tag,file,'--repo',slug]);
 }
 const after=new Map(((await ghJson(gh,['release','view',release.tag,'--repo',slug,'--json','assets'])).assets||[]).map(asset=>[asset.name,asset.size]));
 for(const asset of release.assets)if(after.get(asset.name)!==asset.size)throw Error(asset.name+' is not attached to '+release.tag+' with the right size after uploading.');
 const state=await ghJson(gh,['release','view',release.tag,'--repo',slug,'--json','isDraft']);
 if(state.isDraft){await gh(['release','edit',release.tag,'--repo',slug,'--draft=false',...(release.prerelease?['--prerelease']:[])]);log('  published '+release.tag);}
}

/** Publishes the plan. The feed commit is the last remote write; every earlier failure leaves it untouched. */
export async function publishPlan({plan,deps,options}){
 const {gh,fetch=globalThis.fetch,log=()=>{},sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),delays}=deps,slug=plan.repo,state={releases:[],feedCommit:null};
 const work=await fs.mkdtemp(path.join(os.tmpdir(),'acira-publish-'));
 try{
  const info=await ghJson(gh,['api',`repos/${slug}`]);
  if(info.private!==false)throw Error(slug+' is not public: installed copies could not read the feed.');
  if(info.permissions&&info.permissions.push!==true)throw Error('The signed-in GitHub account cannot push to '+slug+'.');
  if(info.default_branch!==BRANCH)throw Error(slug+' has default branch '+info.default_branch+', but every installed app reads the feed from '+BRANCH+'.');
  // The authoritative feed (not the CDN copy, which can be minutes old): the version must still be higher right now.
  for(const feed of plan.feeds){
   let current=null;
   try{const file=await ghJson(gh,['api',`repos/${slug}/contents/feed/${feed.file}?ref=${BRANCH}`]);current=U.parseFeed(Buffer.from(file.content,'base64').toString('utf8'));}catch(error){if(!notFound(error))throw error;}
   if(current?.version&&!semver.gt(feed.version,current.version))throw Error('feed/'+feed.file+' already offers '+current.version+'; '+feed.version+' is not newer.');
  }
  // 1. payloads
  for(const release of plan.releases){log('\nRelease '+release.tag);state.releases.push(release.tag);await ensureRelease({gh,slug,release,log,workDir:work});}
  // 2. every payload, downloaded with no credentials, must be byte-for-byte what was uploaded
  log('\nDownloading every file anonymously and comparing SHA-512...');
  const queue=plan.releases.flatMap(release=>release.assets.map(asset=>({release,asset})));
  const workers=Array.from({length:2},async()=>{for(let next=queue.shift();next;next=queue.shift()){await verifyDownload({fetch,url:next.asset.url,sha512:next.asset.sha512,size:next.asset.size,sleep,delays});log('  verified '+next.asset.name);}});
  await Promise.all(workers);
  // 3. only now the channel documents
  if(!plan.feeds.length){log('\nNo channel document to update.');return state;}
  const message='Feed: Acira Browser '+plan.version+' ('+plan.channel+', '+plan.releases.map(release=>release.platform).join(' + ')+')\n\n'+plan.releases.map(release=>release.tag).join('\n');
  log('\nCommitting the channel documents ('+plan.feeds.map(feed=>feed.file).join(', ')+')...');
  state.feedCommit=await commitFeed({gh,repo:slug,files:plan.feeds,message});
  log('  committed '+state.feedCommit);
  return state;
 }catch(error){
  error.state=state;
  error.recovery=[
   'The channel documents in feed/ were '+(state.feedCommit?'COMMITTED before this failure':'NOT touched')+'.',
   ...state.releases.map(tag=>'Release '+tag+' may exist (a draft is invisible to everyone); to remove it: gh release delete '+tag+' --repo '+slug+' --cleanup-tag --yes'),
   'Running the same command again resumes: it reuses releases that exist and uploads only what is missing.',
  ];
  throw error;
 }finally{await fs.rm(work,{recursive:true,force:true});}
}

/** After the commit, waits until anyone can read the new documents from the public URL (raw.githubusercontent.com caches for a few minutes). */
async function waitForFeed({plan,fetch,log,sleep,minutes=8}){
 const deadline=Date.now()+minutes*60000;let pending=plan.feeds.slice();
 while(pending.length&&Date.now()<deadline){
  const next=[];
  for(const feed of pending){const live=await U.readLiveFeed({fetch,file:feed.file});if(live.version!==feed.version)next.push(feed);else log('  live: '+feed.file+' now offers '+feed.version);}
  pending=next;if(pending.length){log('  waiting for the public copy of '+pending.map(feed=>feed.file).join(', ')+' (GitHub caches it for up to 5 minutes)...');await sleep(20000);}
 }
 return pending.length===0;
}

export async function main(argv=process.argv.slice(2),overrides={}){
 const options=parseArguments(argv);
 if(options.help||!argv.length){console.log(HELP);return 0;}
 const log=overrides.log||console.log;
 const deps={log,fetch:globalThis.fetch,root:repo,now:()=>new Date(),...require('../packaging/macos/update-verify.cjs'),inspectWindowsInstaller,gh:ghCli(),...overrides};
 const result=await planUpdate(options,deps);
 if(result.problems.length||!result.ok){
  log('\nREFUSED. Nothing was uploaded or changed.\n');for(const problem of result.problems)log('  x '+problem);for(const warning of result.warnings)log('  ! '+warning);
  return 1;
 }
 const review=await writeReview({plan:result.plan,dir:path.resolve(options['review-dir']||path.join(repo,'release/update-review',options.version+'-'+(options.channel||'beta')))});
 describePlan(result.plan,{log,review});
 for(const warning of result.warnings)log('  ! '+warning);
 if(!options.publish){log('\nDRY RUN OK. Nothing was uploaded or changed. Run the same command with --publish to release.');return 0;}
 if(!options.yes){
  if(!process.stdin.isTTY)throw Error('--publish asks for confirmation; run it in a terminal, or add --yes.');
  const rl=readline.createInterface({input:process.stdin,output:process.stdout}),answer=await rl.question('\nPublish version '+options.version+' to '+U.UPDATE_REPOSITORY+' now? Type the version to continue: ');rl.close();
  if(answer.trim()!==options.version){log('Not published.');return 1;}
 }
 try{
  const state=await publishPlan({plan:result.plan,deps,options});
  if(state.feedCommit&&!options['no-wait']){const seen=await waitForFeed({plan:result.plan,fetch:deps.fetch,log,sleep:deps.sleep||(ms=>new Promise(resolve=>setTimeout(resolve,ms)))});log(seen?'\nThe public feed offers '+options.version+'.':'\nCommitted, but the public copy has not refreshed yet; it will within minutes.');}
  log('\nPUBLISHED. Next: open one installed copy of the previous version and check that it updates (docs/launch/PUBLIC_UPDATES.md, last step).');
  return 0;
 }catch(error){
  log('\nSTOPPED: '+error.message);for(const line of error.recovery||[])log('  - '+line);
  return 1;
 }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 main().then(code=>{process.exitCode=code;},error=>{console.error(error.message);process.exitCode=1;});
}
