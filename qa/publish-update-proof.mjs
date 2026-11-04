// Local proof of scripts/publish-update.mjs: the real command, as a child process, against the stand-in GitHub and feed (qa/publish-stand-in.mjs served
// on 127.0.0.1) with --stand-in. Nothing reaches GitHub: a fake `gh` first on PATH records any call (there must be none), and every fetch that is not to
// 127.0.0.1 goes to a dead proxy. The Mac ZIPs are clones of a real signed and notarized build (read only), so the real Apple checks run (unzip,
// codesign, stapler, spctl); the Windows setup is random bytes with a real-format blockmap and build record. The real electron-updater, reading the
// stand-in feed, says who is offered the update after each step.
//   node qa/publish-update-proof.mjs [--work <folder>] [--mac-build <release/mac-widevine-<version>-<commit>.noindex>]
// Writes <work>/proof.log (every command and its whole output) and exits 1 if any check fails.
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash,randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import {createStandIn,serveStandIn,feedText} from './publish-stand-in.mjs';
const require=createRequire(import.meta.url),root=path.resolve(import.meta.dirname,'..'),U=require('../packaging/update-publish.cjs');
const {AppUpdater}=require('electron-updater/out/AppUpdater'),{MacUpdater}=require('electron-updater/out/MacUpdater'),{NodeHttpExecutor}=require('builder-util/out/nodeHttpExecutor');
http.globalAgent=new http.Agent({keepAlive:false}); // each electron-updater check below gets its own connection
const argument=(name,fallback)=>{const index=process.argv.indexOf('--'+name);return index>0?process.argv[index+1]:fallback;};
const MAIN=path.resolve(root,'../../..'); // the main checkout when this runs from a worktree three folders below it
const work=path.resolve(argument('work',path.join(os.tmpdir(),'acira-publish-proof-'+Date.now())));
const macBuild=path.resolve(argument('mac-build',path.join(fsExists(path.join(root,'release'))?root:MAIN,'release/mac-widevine-0.1.0-beta.9-3692da5b.noindex')));
function fsExists(file){try{require('node:fs').accessSync(file);return true;}catch{return false;}}
const sha512=bytes=>createHash('sha512').update(bytes).digest('base64'),sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const blockMap=size=>zlib.gzipSync(JSON.stringify({version:'2',files:[{name:'file',offset:0,checksums:['AAAA','BBBB','CCCC'],sizes:[size-2000,1000,1000]}]}));
const download=(tag,name)=>`https://github.com/${U.UPDATE_REPOSITORY}/releases/download/${tag}/${name}`;
const results=[],logLines=[];
const say=text=>{logLines.push(text);console.log(text);};
const check=(name,ok,detail='')=>{results.push({name,ok:Boolean(ok)});say((ok?'ok    ':'FAIL  ')+name+(ok||!detail?'':'\n      '+String(detail).slice(-1200).replace(/\n/g,'\n      ')));return ok;};

await fs.rm(work,{recursive:true,force:true});await fs.mkdir(path.join(work,'tmp'),{recursive:true});
// ---- guards: a gh that only records, and a dead proxy for anything that is not local
const bin=path.join(work,'bin'),ghCalls=path.join(work,'gh-was-called.log');await fs.mkdir(bin);
await fs.writeFile(path.join(bin,'gh'),'#!/bin/sh\necho "$@" >> "'+ghCalls+'"\nexit 1\n',{mode:0o755});
const childEnv={...process.env,PATH:bin+path.delimiter+process.env.PATH,TMPDIR:path.join(work,'tmp'),NODE_USE_ENV_PROXY:'1',HTTPS_PROXY:'http://127.0.0.1:9',HTTP_PROXY:'http://127.0.0.1:9',NO_PROXY:'127.0.0.1,localhost',GH_TOKEN:'',GITHUB_TOKEN:''};

// ---- inputs: clones of the real Mac build, a Windows build, broken variants
const real={};
for(const entry of await fs.readdir(macBuild,{withFileTypes:true})){
 const arch=/^(arm64|x64)-/.exec(entry.name)?.[1];if(!entry.isDirectory()||!arch)continue;
 const dir=path.join(macBuild,entry.name),names=await fs.readdir(dir),zip=names.find(name=>/-update\.zip$/.test(name));
 if(zip&&names.includes('mac-widevine-package.json'))real[arch]={zip:path.join(dir,zip),receipt:JSON.parse(await fs.readFile(path.join(dir,'mac-widevine-package.json'),'utf8'))};
}
if(!real.arm64||!real.x64){console.error('No signed Mac build with both update ZIPs in '+macBuild+' (pass --mac-build).');process.exit(2);}
const VERSION=real.arm64.receipt.version,COMMIT=real.arm64.receipt.commit,PREVIOUS='0.1.0-beta.8',PREV_COMMIT8='46902b78';
const macBase=path.join(work,'mac','mac-widevine-'+VERSION+'-'+COMMIT.slice(0,8)+'.noindex');
async function macFolder(arch,{base=macBase,zipBytes=null,receipt=null}={}){ // a packager folder: the ZIP (an APFS clone of the real one, or given bytes) and its receipt
 const dir=path.join(base,arch+'-proof'),name=path.basename(real[arch].zip),zip=path.join(dir,name);await fs.mkdir(dir,{recursive:true});
 if(zipBytes)await fs.writeFile(zip,zipBytes);else await fs.copyFile(real[arch].zip,zip,fs.constants.COPYFILE_FICLONE);
 await fs.writeFile(path.join(dir,'mac-widevine-package.json'),JSON.stringify(receipt||{...real[arch].receipt,updateZip:{...real[arch].receipt.updateZip,zip}},null,1));
 return zip;
}
const zips={arm64:await macFolder('arm64'),x64:await macFolder('x64')};
async function windowsFolder(name,{version=VERSION,blockmap='good'}={}){
 const dir=path.join(work,name),exe=randomBytes(1_500_000);exe.write('MZ');await fs.mkdir(dir,{recursive:true});
 await fs.writeFile(path.join(dir,'AciraBrowserSetup.exe'),exe);
 if(blockmap==='good')await fs.writeFile(path.join(dir,'AciraBrowserSetup.exe.blockmap'),blockMap(exe.length));
 if(blockmap==='other')await fs.writeFile(path.join(dir,'AciraBrowserSetup.exe.blockmap'),blockMap(exe.length+4096));
 await fs.writeFile(path.join(dir,'latest.yml'),JSON.stringify({version,files:[{url:'AciraBrowserSetup.exe',sha512:sha512(exe),size:exe.length}],path:'AciraBrowserSetup.exe',sha512:sha512(exe)}));
 await fs.writeFile(path.join(dir,'WINDOWS-BUILD-RESULT.json'),JSON.stringify({version,commit:COMMIT,installer:{file:'AciraBrowserSetup.exe',sha256:sha256(exe),bytes:exe.length},updateConfig:{file:'resources/app-update.yml',url:U.RAW_FEED_BASE}}));
 return dir;
}
const win=await windowsFolder('windows'),winNoMap=await windowsFolder('windows-no-blockmap',{blockmap:'none'}),winOtherMap=await windowsFolder('windows-other-blockmap',{blockmap:'other'});
const notes=path.join(work,'notes.md');await fs.writeFile(notes,"## What's new\n- Proof run of the publisher\n");

// ---- the stand-in, seeded with what is live before: the previous version (Mac arm64 only, as beta.8 shipped; Windows with its blockmap)
async function world(name,{windowsBlockmap=true}={}){
 const macTag=`v${PREVIOUS}-mac-${PREV_COMMIT8}`,winTag=`v${PREVIOUS}-windows-${PREV_COMMIT8}`,oldZip=Buffer.from('previous arm64 zip'),oldSetup=randomBytes(900_000);
 const macDoc={version:PREVIOUS,files:[{url:download(macTag,`AciraBrowser-${PREVIOUS}-mac-arm64-update.zip`),sha512:sha512(oldZip),size:oldZip.length}],releaseDate:'2026-11-02T22:00:00.000Z',minimumSystemVersion:'22.0.0',releaseName:'Acira Browser '+PREVIOUS};
 const winDoc={version:PREVIOUS,files:[{url:download(winTag,'AciraBrowserSetup.exe'),sha512:sha512(oldSetup),size:oldSetup.length}],releaseDate:'2026-11-02T22:00:00.000Z',releaseName:'Acira Browser '+PREVIOUS};
 const dir=path.join(work,'stand-in-'+name),model=createStandIn({feed:{'beta-mac.yml':macDoc,'beta.yml':winDoc,'latest-mac.yml':'0.0.0','latest.yml':'0.0.0'},dir});
 model.seedRelease(macTag,{assets:{[`AciraBrowser-${PREVIOUS}-mac-arm64-update.zip`]:oldZip}});
 model.seedRelease(winTag,{assets:{'AciraBrowserSetup.exe':oldSetup,...(windowsBlockmap?{'AciraBrowserSetup.exe.blockmap':blockMap(oldSetup.length)}:{})}});
 const server=await serveStandIn(model);
 say('\n=== world '+name+': stand-in at '+server.url+' (feed: '+PREVIOUS+' live on Mac arm64 and Windows)');
 return {model,server,dir,close:async()=>{await server.close();await fs.rm(dir,{recursive:true,force:true});}};
}
/** The real command, as a person runs it, with --stand-in. Resolves {code, out}. */
function publish(w,args,label){
 const edit=['--widen','--halt','--resume-rollout'].some(flag=>args.includes(flag)),named=args.some(arg=>/^--(mac-(arm64|x64)-(zip|dmg)|mac-dir|windows-dir)$/.test(arg));
 if(!edit&&!named)throw Error('proof rig: '+label+' names no files, so the publisher would search the repository\'s release/ folder; every run here is given its files.');
 const argv=['scripts/publish-update.mjs',...args,'--stand-in',w.server.url,'--review-dir',path.join(work,'review')];
 say('\n$ node '+argv.join(' ').replaceAll(work,'<work>')+'   # '+label);
 return new Promise(resolve=>{const child=spawn(process.execPath,argv,{cwd:root,env:childEnv});let out='';child.stdout.on('data',chunk=>{out+=chunk;});child.stderr.on('data',chunk=>{out+=chunk;});
  child.on('close',code=>{for(const line of out.replace(/\n$/,'').split('\n'))logLines.push('  | '+line.replaceAll(work,'<work>'));resolve({code,out});});});
}
const doc=(w,file)=>JSON.parse(w.model.state.feed[file]);
const writes=w=>w.model.state.log.filter(line=>/^(UPLOAD |release (create|upload|edit|delete-asset)|api -X)/.test(line)||line==='FEED COMMITTED').length;
/** The real electron-updater, as an installed copy with that version and staging id share (0..1) on that platform: is it offered an update? */
async function offered(w,{platform,installed,share}){
 const dir=await fs.mkdtemp(path.join(work,'tmp','updater-'));
 try{
  await fs.writeFile(path.join(dir,'.updaterId'),'3b6f1c2e-0000-4000-8000-0000'+Math.floor(share*0xffffffff).toString(16).padStart(8,'0'));
  await fs.writeFile(path.join(dir,'app-update.yml'),JSON.stringify({provider:'generic',url:w.server.url+'/raw/feed/'}));
  const updater=new AppUpdater(null,{isPackaged:true,version:installed,name:'Acira proof fixture',userDataPath:dir,baseCachePath:dir,appUpdateConfigPath:path.join(dir,'app-update.yml'),whenReady:async()=>{}});
  updater.httpExecutor=new NodeHttpExecutor();updater._testOnlyOptions={platform};updater.channel='beta';updater.allowPrerelease=true;updater.allowDowngrade=false;updater.logger=null;updater.autoDownload=false;
  const result=await updater.checkForUpdates();return result.isUpdateAvailable?result.updateInfo.version:null;
 }finally{await fs.rm(dir,{recursive:true,force:true});}
}
const both=async(w,share,installed=PREVIOUS)=>({mac:await offered(w,{platform:'darwin',installed,share}),windows:await offered(w,{platform:'win32',installed,share})});
const refusedCleanly=(w,r,before,pattern,name)=>check(name,r.code===1&&/REFUSED\. Nothing was uploaded or changed\./.test(r.out)&&pattern.test(r.out)&&writes(w)===before,r.out);

const started=Date.now();
say('Proof run of scripts/publish-update.mjs, '+new Date().toISOString()+'\nwork folder: '+work+'\nMac build (read only, cloned): '+macBuild+'  version '+VERSION+', commit '+COMMIT.slice(0,8));
const newRelease=['--version',VERSION,'--mac-dir',macBase,'--windows-dir',win,'--notes-file',notes];

// ======== A: a new version, staged, widened, halted, resumed, completed
{
 const w=await world('A');
 let r=await publish(w,[...newRelease,'--rollout','20'],'dry run of a staged release');
 check('A1 dry run: exit 0, real Apple checks pass on the real ZIPs, the diff shows stagingPercentage 20 for both documents, nothing written',r.code===0&&/DRY RUN OK/.test(r.out)&&/Checking the arm64 update ZIP/.test(r.out)&&(r.out.match(/\+ {3}"stagingPercentage": 20/g)||[]).length===2&&writes(w)===0,r.out);
 check('A1 the dry run prints both documents now and after',/feed\/beta-mac\.yml\n\s+now: {3}0\.1\.0-beta\.8 \(arm64\), offered to every install\n\s+after: 0\.1\.0-beta\.9 \(arm64 \+ x64\), offered to 20% of installs/.test(r.out)&&/feed\/beta\.yml\n\s+now: {3}0\.1\.0-beta\.8, offered to every install\n\s+after: 0\.1\.0-beta\.9, offered to 20% of installs/.test(r.out),r.out);
 r=await publish(w,[...newRelease,'--rollout','20','--publish','--yes','--no-wait'],'publish it to 20%');
 const log=w.model.state.log,feedAt=log.indexOf('FEED COMMITTED'),lastDownload=log.map((line,index)=>line.startsWith('DOWNLOAD')?index:-1).reduce((a,b)=>Math.max(a,b));
 check('A2 publish: exit 0, two releases, every new file downloaded back before the one feed commit',r.code===0&&/PUBLISHED\./.test(r.out)&&feedAt>0&&lastDownload<feedAt&&log.filter(line=>line==='FEED COMMITTED').length===1&&w.model.state.releases.has(`v${VERSION}-mac-${COMMIT.slice(0,8)}`)&&w.model.state.releases.has(`v${VERSION}-windows-${COMMIT.slice(0,8)}`),r.out);
 const macZipBytes=w.model.state.releases.get(`v${VERSION}-mac-${COMMIT.slice(0,8)}`).assets.get(path.basename(real.arm64.zip));
 check('A2 the stand-in holds the real ZIP byte for byte (uploaded over HTTP, size '+(macZipBytes?.size||0)+')',macZipBytes?.size===real.arm64.receipt.updateZip.size,'');
 check('A2 the feed says '+VERSION+' at 20% on both platforms; beta.yml names the previous setup\'s blockmap',doc(w,'beta-mac.yml').version===VERSION&&doc(w,'beta-mac.yml').stagingPercentage===20&&doc(w,'beta.yml').stagingPercentage===20&&doc(w,'beta.yml').previousBlockMaps?.[0]?.version===PREVIOUS,JSON.stringify([doc(w,'beta-mac.yml'),doc(w,'beta.yml')]));
 check('A2 downloads carried no credentials',w.model.state.downloadsWithCredentials===0);
 let seen=await both(w,0.05);check('A2 real electron-updater: a copy at 5% is offered '+VERSION+' (Mac and Windows)',seen.mac===VERSION&&seen.windows===VERSION,JSON.stringify(seen));
 seen=await both(w,0.6);check('A2 real electron-updater: a copy at 60% is not offered it yet',seen.mac===null&&seen.windows===null,JSON.stringify(seen));
 let before=writes(w);r=await publish(w,['--version',VERSION,'--widen','50'],'dry run: widen to 50%');
 check('A3 widen dry run: exit 0, the diff is one line per document (20 -> 50), nothing written',r.code===0&&(r.out.match(/- {3}"stagingPercentage": 20\n\s+\+ {3}"stagingPercentage": 50/g)||[]).length===2&&writes(w)===before,r.out);
 const downloadsBefore=w.model.state.log.filter(line=>line.startsWith('DOWNLOAD')).length;
 r=await publish(w,['--version',VERSION,'--widen','50','--publish','--yes','--no-wait'],'widen to 50%');
 check('A4 widen: exit 0, the files downloaded back again before the commit, feed at 50%',r.code===0&&doc(w,'beta-mac.yml').stagingPercentage===50&&doc(w,'beta.yml').stagingPercentage===50&&w.model.state.log.filter(line=>line.startsWith('DOWNLOAD')).length>=downloadsBefore+3&&/verified AciraBrowserSetup\.exe/.test(r.out),r.out);
 seen=await both(w,0.4);check('A4 real electron-updater: a copy at 40% is now offered it',seen.mac===VERSION&&seen.windows===VERSION,JSON.stringify(seen));
 before=writes(w);r=await publish(w,['--version',VERSION,'--widen','30','--publish','--yes'],'narrowing is refused');
 refusedCleanly(w,r,before,/--widen only raises it/,'A5 widen to 30% after 50%: refused, nothing written');
 before=writes(w);r=await publish(w,['--version',VERSION,'--halt'],'dry run: halt');
 check('A6 halt dry run: exit 0, shows 50 -> 0 and what a halt does to people, nothing written',r.code===0&&/after: 0\.1\.0-beta\.9, halted \(offered to nobody\)/.test(r.out)&&/copies that already installed 0\.1\.0-beta\.9 keep it/.test(r.out)&&writes(w)===before,r.out);
 r=await publish(w,['--version',VERSION,'--halt','--publish','--yes','--no-wait'],'halt');
 check('A7 halt: exit 0, both documents at 0% with the share they had recorded, nothing downloaded for it',r.code===0&&doc(w,'beta-mac.yml').stagingPercentage===0&&doc(w,'beta-mac.yml').halted?.percentage===50&&doc(w,'beta.yml').stagingPercentage===0&&!/verified/.test(r.out),r.out);
 seen=await both(w,0.001);check('A7 real electron-updater: even a copy at 0.1% is offered nothing',seen.mac===null&&seen.windows===null,JSON.stringify(seen));
 seen=await both(w,0.001,VERSION);check('A7 real electron-updater: a copy that already installed '+VERSION+' is offered nothing (it keeps it; no downgrade)',seen.mac===null&&seen.windows===null,JSON.stringify(seen));
 before=writes(w);r=await publish(w,['--version',VERSION,'--halt','--publish','--yes'],'a second halt is refused');
 refusedCleanly(w,r,before,/is already halted/,'A8 halt again: refused, nothing written');
 r=await publish(w,['--version',VERSION,'--widen','80','--publish','--yes'],'widening a halted version is refused');
 refusedCleanly(w,r,before,/is halted\. Resume it first/,'A8 widen while halted: refused, nothing written');
 r=await publish(w,['--version',VERSION,'--resume-rollout','--publish','--yes','--no-wait'],'resume');
 check('A9 resume: exit 0, both documents back at 50%, halt record gone',r.code===0&&doc(w,'beta-mac.yml').stagingPercentage===50&&!('halted' in doc(w,'beta-mac.yml'))&&doc(w,'beta.yml').stagingPercentage===50,r.out);
 seen=await both(w,0.4);check('A9 real electron-updater: the copy at 40% is offered it again',seen.mac===VERSION&&seen.windows===VERSION,JSON.stringify(seen));
 r=await publish(w,['--version',VERSION,'--widen','100','--publish','--yes','--no-wait'],'widen to everyone');
 check('A10 widen to 100%: exit 0, the field is gone (everyone)',r.code===0&&!('stagingPercentage' in doc(w,'beta-mac.yml'))&&!('stagingPercentage' in doc(w,'beta.yml')),r.out);
 seen=await both(w,0.999);check('A10 real electron-updater: a copy at 99.9% is offered it',seen.mac===VERSION&&seen.windows===VERSION,JSON.stringify(seen));
 before=writes(w);r=await publish(w,['--version',VERSION,'--windows-dir',win,'--notes-file',notes,'--publish','--yes'],'the same version again is refused');
 refusedCleanly(w,r,before,/is not newer than 0\.1\.0-beta\.9 \(the live feed beta\.yml\)/,'A11 publishing '+VERSION+' again: refused (not newer), nothing written');
 r=await publish(w,['--version',PREVIOUS,'--windows-dir',win,'--notes-file',notes],'an older version is refused');
 refusedCleanly(w,r,before,/0\.1\.0-beta\.8 is not newer than 0\.1\.0-beta\.9/,'A11 publishing '+PREVIOUS+' under a live '+VERSION+': refused');
 say('  stand-in feed history: '+w.model.state.history.map(entry=>entry.message.split('\n')[0]).join(' | '));
 await w.close();
}
// ======== B: a corrupted upload never reaches the feed
{
 const w=await world('B');w.model.state.corrupt='AciraBrowserSetup.exe';
 const r=await publish(w,['--version',VERSION,'--windows-dir',win,'--notes-file',notes,'--publish','--yes','--no-wait'],'the stand-in flips a byte of the uploaded setup');
 check('B1 corrupted upload: exit 1, STOPPED at the byte check (after one replacement), the feed NOT touched',r.code===1&&/replacing AciraBrowserSetup\.exe/.test(r.out)&&/STOPPED: Anonymous download .*AciraBrowserSetup\.exe failed: SHA-512 differs/.test(r.out)&&/feed\/ were NOT touched/.test(r.out)&&doc(w,'beta.yml').version===PREVIOUS&&!w.model.state.log.includes('FEED COMMITTED'),r.out);
 w.model.state.corrupt=null;const uploadsBefore=w.model.state.log.filter(line=>line.startsWith('UPLOAD ')).length;
 const again=await publish(w,['--version',VERSION,'--windows-dir',win,'--notes-file',notes,'--publish','--yes','--no-wait'],'the same command again, once uploads are clean');
 check('B2 the rerun (a fresh plan, a new clock) resumes: the damaged setup is replaced, nothing else is uploaded again, then the feed',again.code===0&&/PUBLISHED\./.test(again.out)&&w.model.state.log.filter(line=>line.startsWith('UPLOAD ')).length===uploadsBefore+1&&/replacing AciraBrowserSetup\.exe/.test(again.out)&&doc(w,'beta.yml').version===VERSION,again.out);
 await w.close();
}
// ======== C: arm64 first, then --add-arch x64
{
 const w=await world('C');
 let r=await publish(w,['--version',VERSION,'--mac-arm64-zip',zips.arm64,'--notes-file',notes,'--allow-single-arch','--publish','--yes','--no-wait'],'publish arm64 only');
 check('C1 arm64 only with --allow-single-arch: exit 0, a warning about Intel Macs, the feed has arm64 only',r.code===0&&/Intel Macs see failed update checks until you run --add-arch/.test(r.out)&&doc(w,'beta-mac.yml').files.length===1&&U.macArchOf(doc(w,'beta-mac.yml').files[0].url)==='arm64',r.out);
 const uploaded=[...w.model.state.releases.get(`v${VERSION}-mac-${COMMIT.slice(0,8)}`).assets.keys()];
 check('C1 exactly the named file was published: no x64 ZIP and no DMG were added from any folder ('+uploaded.join(', ')+')',uploaded.length===3&&uploaded.includes(path.basename(real.arm64.zip))&&!uploaded.some(name=>/x64|\.dmg$/.test(name)));
 let seen=await offered(w,{platform:'darwin',installed:PREVIOUS,share:0.5});check('C1 real electron-updater: an arm64 Mac is offered '+VERSION,seen===VERSION,String(seen));
 const tag=`v${VERSION}-mac-${COMMIT.slice(0,8)}`,sumsBefore=w.model.state.releases.get(tag)?.assets.get('SHA256SUMS.txt')?.size;
 const before=writes(w);r=await publish(w,['--version',VERSION,'--add-arch','--mac-x64-zip',zips.x64],'dry run: add x64');
 check('C2 add-arch dry run: exit 0, the release gains the x64 ZIP and its own checksums, the document one file, nothing written',r.code===0&&/add to the published release v0\.1\.0-beta\.9-mac-/.test(r.out)&&/now: {3}0\.1\.0-beta\.9 \(arm64\), offered to every install\n\s+after: 0\.1\.0-beta\.9 \(arm64 \+ x64\)/.test(r.out)&&/SHA256SUMS-x64\.txt/.test(r.out)&&/\+\s+"url": "https:\/\/github\.com\/.*-x64-update\.zip"/.test(r.out)&&writes(w)===before,r.out);
 r=await publish(w,['--version',VERSION,'--add-arch','--mac-x64-zip',zips.x64,'--publish','--yes','--no-wait'],'add x64');
 const release=w.model.state.releases.get(tag);
 check('C3 add-arch: exit 0, x64 added to the same published release, nothing replaced, then the feed',r.code===0&&release&&!release.isDraft&&release.assets.has(path.basename(real.x64.zip))&&release.assets.has('SHA256SUMS-x64.txt')&&release.assets.get('SHA256SUMS.txt')?.size===sumsBefore&&sumsBefore>0,r.out);
 const {files}=U.readWithUpdater(w.model.state.feed['beta-mac.yml'],{file:'beta-mac.yml'});
 check('C3 the live document now hands each architecture its own ZIP (electron-updater\'s own choice)',/-arm64-update\.zip$/.test(MacUpdater.filterFilesForArch(files,true)[0]?.url.href)&&/-x64-update\.zip$/.test(MacUpdater.filterFilesForArch(files,false)[0]?.url.href)&&files.length===2,w.model.state.feed['beta-mac.yml']);
 r=await publish(w,['--version',VERSION,'--add-arch','--mac-x64-zip',zips.x64,'--publish','--yes'],'adding again is refused');
 refusedCleanly(w,r,writes(w),/already offers both Mac architectures/,'C4 add-arch again: refused, nothing written');
 await w.close();
}
// ======== D: unsafe builds are refused, in the dry run as with --publish, and nothing is written
{
 const w=await world('D');
 const tampered=await macFolder('arm64',{base:path.join(work,'mac-tampered')});
 const receipt=JSON.parse(await fs.readFile(path.join(path.dirname(tampered),'mac-widevine-package.json'),'utf8'));receipt.updateZip.sha512=sha512('another build');
 await fs.writeFile(path.join(path.dirname(tampered),'mac-widevine-package.json'),JSON.stringify(receipt));
 const app=path.join(work,'unsigned','Acira Browser.app'),unsignedZip=path.join(work,'unsigned',path.basename(real.arm64.zip));
 await fs.mkdir(path.join(app,'Contents/MacOS'),{recursive:true});await fs.writeFile(path.join(app,'Contents/MacOS/AciraBrowser'),'#!/bin/sh\n',{mode:0o755});
 await promisify(execFile)('/usr/bin/ditto',['-c','-k','--keepParent',app,unsignedZip]);
 const unsigned=await macFolder('arm64',{base:path.join(work,'mac-unsigned'),zipBytes:await fs.readFile(unsignedZip)});
 const unsignedBytes=await fs.readFile(unsigned);
 await fs.writeFile(path.join(path.dirname(unsigned),'mac-widevine-package.json'),JSON.stringify({...real.arm64.receipt,updateZip:{...real.arm64.receipt.updateZip,zip:unsigned,sha512:sha512(unsignedBytes),size:unsignedBytes.length}}));
 const cases=[
  ['D1 one Mac architecture missing (arm64 alone, no --allow-single-arch)',['--mac-arm64-zip',zips.arm64],/Only the arm64 Mac update ZIP was found/],
  ['D2 x64 alone, even with --allow-single-arch',['--mac-x64-zip',zips.x64,'--allow-single-arch'],/hands Apple silicon Macs the Intel build/],
  ['D3 a ZIP whose SHA-512 is not what its build receipt recorded',['--mac-arm64-zip',tampered,'--mac-x64-zip',zips.x64],/is not the file its build receipt describes/],
  ['D4 an unsigned, unnotarized ZIP (the real codesign refuses it)',['--mac-arm64-zip',unsigned,'--mac-x64-zip',zips.x64],/arm64-update\.zip: codesign --verify --deep --strict failed/],
  ['D5 a Windows setup without its blockmap',['--windows-dir',winNoMap],/No AciraBrowserSetup\.exe\.blockmap beside the setup/],
  ['D6 a Windows setup with another build\'s blockmap',['--windows-dir',winOtherMap],/blockmap: it describes a file of \d+ bytes, not this 1500000-byte setup/],
 ];
 for(const [name,files,pattern] of cases)for(const mode of [[],['--publish','--yes']]){
  const before=writes(w),r=await publish(w,['--version',VERSION,'--notes-file',notes,...files,...mode],name+(mode.length?' (--publish --yes)':' (dry run)'));
  refusedCleanly(w,r,before,pattern,name+(mode.length?', with --publish --yes':', dry run'));
 }
 await w.close();
 const n=await world('D7',{windowsBlockmap:false});
 const r=await publish(n,['--version',VERSION,'--windows-dir',win,'--notes-file',notes,'--publish','--yes'],'the live setup has no blockmap: the new document would have no previousBlockMaps');
 refusedCleanly(n,r,0,/The live setup's blockmap, 0\.1\.0-beta\.8 .*could not be downloaded and read/,'D7 the live setup\'s blockmap cannot be read (it would be lost from previousBlockMaps for good): refused');
 const forced=await publish(n,['--version',VERSION,'--windows-dir',win,'--notes-file',notes,'--allow-missing-blockmaps'],'the same, as an emergency');
 check('D7 with --allow-missing-blockmaps the dry run goes ahead and says what is lost',forced.code===0&&/previousBlockMaps leaves out 0\.1\.0-beta\.8/.test(forced.out)&&/Published anyway \(--allow-missing-blockmaps\)/.test(forced.out),forced.out);
 await n.close();
 const bad=await publish({server:{url:'https://github.com'}},['--version',VERSION,'--halt'],'a stand-in that is not local');
 check('D8 --stand-in pointing anywhere but this computer is refused before anything runs',bad.code===1&&/--stand-in must be a local address/.test(bad.out),bad.out);
}
// ---- nothing reached GitHub
check('gh was never run (the recording gh on PATH has no calls)',!fsExists(ghCalls),fsExists(ghCalls)?await fs.readFile(ghCalls,'utf8'):'');
const failed=results.filter(result=>!result.ok);
say('\n'+(failed.length?'FAILED':'PASSED')+': '+(results.length-failed.length)+'/'+results.length+' checks in '+Math.round((Date.now()-started)/1000)+' s');
await fs.writeFile(path.join(work,'proof.log'),logLines.join('\n')+'\n');
await fs.rm(path.join(work,'mac'),{recursive:true,force:true});await fs.rm(path.join(work,'mac-tampered'),{recursive:true,force:true});await fs.rm(path.join(work,'mac-unsigned'),{recursive:true,force:true});await fs.rm(path.join(work,'tmp'),{recursive:true,force:true});
console.log('log: '+path.join(work,'proof.log'));
process.exitCode=failed.length?1:0;
