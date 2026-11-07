// scripts/publish-update.mjs end to end against the stand-in GitHub (qa/publish-stand-in.mjs: no network, no gh, no Apple tools unless a test says so):
// what it refuses, what a dry run writes, that the channel documents are committed LAST, only after every payload was published and downloaded back with
// the right hash, and the steering of a live version: staged rollout, widening, halt, resume, and adding the Mac architecture it lacks.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {parseArguments,planUpdate,planFeedChange,publishPlan,commitFeed,verifyDownload,downloadSmall,inspectWindowsInstaller,standInTransport,haltEffects,main} from '../scripts/publish-update.mjs';
import {createStandIn,serveStandIn} from '../qa/publish-stand-in.mjs';
const require=createRequire(import.meta.url),U=require('../packaging/update-publish.cjs');
const REPO='Acira-dev/AciraBrowserUpdates',COMMIT='b62c4715130a8f17182dced8e94e7fc56425c4c7',VERSION='0.1.0-beta.7';
const sha512=bytes=>createHash('sha512').update(bytes).digest('base64'),sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const fakeGitHub=options=>createStandIn(options);
const download=(tag,name)=>`https://github.com/${REPO}/releases/download/${tag}/${name}`;
/** A blockmap as electron-builder writes it for a setup of `size` bytes. */
const blockMap=size=>zlib.gzipSync(JSON.stringify({version:'2',files:[{name:'file',offset:0,checksums:['AAAA','BBBB'],sizes:[size-100,100]}]}));

/** Build folders as the packagers leave them: per Mac architecture the update ZIP, the DMG and mac-widevine-package.json; for Windows the setup, its
 *  blockmap, latest.yml and the build record. */
async function workspace(t,{windows=false,arches=['arm64','x64'],commit=COMMIT,version=VERSION}={}){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'acira-publish-script-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const files={};
 for(const arch of arches){
  await fs.mkdir(path.join(dir,arch));
  files[arch]={zip:path.join(dir,arch,`AciraBrowser-${version}-mac-${arch}-update.zip`),dmg:path.join(dir,arch,`AciraBrowser-${version}-mac-${arch}.dmg`),receipt:path.join(dir,arch,'mac-widevine-package.json')};
  const zip=Buffer.from('zip of the '+arch+' app'),dmg=Buffer.from('disk image for '+arch);
  await fs.writeFile(files[arch].zip,zip);await fs.writeFile(files[arch].dmg,dmg);
  await fs.writeFile(files[arch].receipt,JSON.stringify({version,commit,arch,updateZip:{zip:files[arch].zip,arch,sha512:sha512(zip),size:zip.length},diskImage:files[arch].dmg,sha256:sha256(dmg),bytes:dmg.length}));
 }
 const notes=path.join(dir,'notes.md');await fs.writeFile(notes,'- Faster tabs\n- Sidebar fix\n');
 if(windows){
  await fs.mkdir(path.join(dir,'win'));const exe=Buffer.alloc(1100000,7);exe.write('MZ');
  files.windows={exe:path.join(dir,'win/AciraBrowserSetup.exe'),blockmap:path.join(dir,'win/AciraBrowserSetup.exe.blockmap'),latest:path.join(dir,'win/latest.yml'),record:path.join(dir,'win/WINDOWS-BUILD-RESULT.json')};
  await fs.writeFile(files.windows.exe,exe);await fs.writeFile(files.windows.blockmap,blockMap(exe.length));
  await fs.writeFile(files.windows.latest,JSON.stringify({version,files:[{url:'AciraBrowserSetup.exe',sha512:sha512(exe),size:exe.length}],path:'AciraBrowserSetup.exe',sha512:sha512(exe),releaseDate:'2026-11-02T00:00:00.000Z'}));
  await fs.writeFile(files.windows.record,JSON.stringify({version,commit,installer:{file:'AciraBrowserSetup.exe',sha256:sha256(exe),bytes:exe.length}}));
 }
 return {dir,files,notes};
}
const macOptions=(w,extra={})=>({version:VERSION,channel:'beta','mac-arm64-zip':w.files.arm64?.zip,'mac-x64-zip':w.files.x64?.zip,'mac-arm64-dmg':w.files.arm64?.dmg,'mac-x64-dmg':w.files.x64?.dmg,'notes-file':w.notes,...extra});
const winOptions=(w,extra={})=>({version:VERSION,channel:'beta','windows-dir':path.dirname(w.files.windows.exe),'notes-file':w.notes,...extra});
const baseDeps=(w,github,over={})=>({
 root:w.dir,fetch:github.fetch,gh:github.gh,log:()=>{},now:()=>new Date('2026-11-02T04:00:00.000Z'),sleep:async()=>{},delays:[],
 inspectMacZip:async({zip,arch})=>({zip:path.basename(zip),version:VERSION,arch,commit:COMMIT,identity:'Developer ID Application: Khaled Kaed Beyh (2MGLP3QV9X)',stapled:true,gatekeeper:'Notarized Developer ID'}),
 inspectMacDmg:async({dmg})=>({dmg:path.basename(dmg),stapled:true,gatekeeper:'Notarized Developer ID'}),
 inspectWindowsInstaller:async()=>({updateConfig:true,source:'test'}),...over});

/** A feed whose live documents offer `version` (Mac and Windows), with the published releases they point at, so every file downloads. */
function liveWorld({version=VERSION,commit8='b62c4715',mac={},windows={},channel='beta',extraFeed={}}={}){
 const macTag=`v${version}-mac-${commit8}`,winTag=`v${version}-windows-${commit8}`,bytes={};
 const macFiles=(mac.arches||['arm64','x64']).map(arch=>{const name=`AciraBrowser-${version}-mac-${arch}-update.zip`,data=Buffer.from('live '+arch+' zip of '+version);bytes[name]=data;return {url:download(macTag,name),sha512:sha512(data),size:data.length};});
 const setup=Buffer.alloc(1000,'live setup of '+version),setupMap=blockMap(setup.length);
 const macDoc={version,files:macFiles,path:macFiles[0].url,sha512:macFiles[0].sha512,releaseDate:'2026-11-01T10:00:00.000Z',minimumSystemVersion:'22.0.0',releaseName:'Acira Browser '+version,releaseNotes:'- Faster tabs',...mac.extra};
 const winDoc={version,files:[{url:download(winTag,'AciraBrowserSetup.exe'),sha512:sha512(setup),size:setup.length}],path:download(winTag,'AciraBrowserSetup.exe'),sha512:sha512(setup),releaseDate:'2026-11-01T10:00:00.000Z',releaseName:'Acira Browser '+version,releaseNotes:'- Faster tabs',...windows.extra};
 const files=U.feedFiles(channel,'mac').map(file=>[file,macDoc]).concat(U.feedFiles(channel,'windows').map(file=>[file,winDoc]));
 const github=createStandIn({feed:{'beta-mac.yml':'0.0.0','beta.yml':'0.0.0','latest-mac.yml':'0.0.0','latest.yml':'0.0.0',...Object.fromEntries(files),...extraFeed}});
 github.seedRelease(macTag,{assets:bytes});github.seedRelease(winTag,{assets:{'AciraBrowserSetup.exe':setup,'AciraBrowserSetup.exe.blockmap':setupMap}});
 return {github,macDoc,winDoc,macTag,winTag};
}
const feedDoc=(github,file)=>JSON.parse(github.state.feed[file]);
const editDeps=(github,over={})=>({fetch:github.fetch,gh:github.gh,log:()=>{},now:()=>new Date('2026-11-03T09:00:00.000Z'),sleep:async()=>{},delays:[],...over});

test('options: flags and values are told apart, unknown ones are refused',()=>{
 const options=parseArguments(['--version','0.1.0-beta.7','--publish','--channel','beta','--notes-file','n.md','--rehearsal']);
 assert.deepEqual(options,{version:'0.1.0-beta.7',publish:true,channel:'beta','notes-file':'n.md',rehearsal:true});
 assert.throws(()=>parseArguments(['--versoin','1']),/Unknown option/);assert.throws(()=>parseArguments(['--version']),/needs a value/);assert.throws(()=>parseArguments(['--version','--publish']),/needs a value/);assert.throws(()=>parseArguments(['stray']),/Unexpected argument/);
});
test('options: one way of changing the live version at a time, percentages from 1 to 100, and no files where none are used',()=>{
 assert.deepEqual(parseArguments(['--version',VERSION,'--widen','50','--platform','mac']),{version:VERSION,widen:'50',platform:'mac'});
 assert.deepEqual(parseArguments(['--version',VERSION,'--resume-rollout','--rollout','10']),{version:VERSION,'resume-rollout':true,rollout:'10'});
 assert.deepEqual(parseArguments(['--version',VERSION,'--rollout','20','--publish','--yes']),{version:VERSION,rollout:'20',publish:true,yes:true});
 assert.throws(()=>parseArguments(['--version',VERSION,'--halt','--widen','50']),/Choose one of --widen, --halt/);
 assert.throws(()=>parseArguments(['--version',VERSION,'--add-arch','--resume-rollout']),/Choose one of/);
 for(const value of ['0','101','12.5','-5','ten','050%'])assert.throws(()=>parseArguments(['--version',VERSION,'--widen',value]),/whole percentage from 1 to 100/,value),assert.throws(()=>parseArguments(['--version',VERSION,'--rollout',value]),/whole percentage/,value);
 assert.throws(()=>parseArguments(['--version',VERSION,'--widen','50','--rollout','20']),/--rollout sets the share for a new version/);
 assert.throws(()=>parseArguments(['--version',VERSION,'--halt','--rollout','20']),/--rollout sets the share/);
 assert.throws(()=>parseArguments(['--version',VERSION,'--add-arch','--rollout','20']),/--rollout sets the share/);
 assert.throws(()=>parseArguments(['--version',VERSION,'--halt','--platform','freebsd']),/mac, windows or linux/);
 assert.equal(parseArguments(['--version',VERSION,'--halt','--platform','linux']).platform,'linux');
 assert.throws(()=>parseArguments(['--version',VERSION,'--platform','mac']),/--platform goes with --widen, --halt or --resume-rollout/);
 assert.throws(()=>parseArguments(['--version',VERSION,'--halt','--mac-dir','x']),/takes no files \(--mac-dir\)/);
 assert.throws(()=>parseArguments(['--version',VERSION,'--widen','40','--windows-dir','x']),/takes no files/);
 assert.throws(()=>parseArguments(['--version',VERSION,'--add-arch','--windows-dir','x']),/the Windows build has one \(x64\)/);
 assert.throws(()=>parseArguments(['--version',VERSION,'--halt','--rehearsal']),/does not go with --halt/);
});
test('a good Mac release plans two payload archives, two disk images, checksums, and one channel document with absolute URLs and the real hashes',async t=>{
 const w=await workspace(t),github=fakeGitHub(),result=await planUpdate(macOptions(w),baseDeps(w,github));
 assert.deepEqual(result.problems,[]);assert.equal(result.ok,true);
 const [release]=result.plan.releases;assert.equal(result.plan.releases.length,1);
 assert.equal(release.tag,'v0.1.0-beta.7-mac-b62c4715');assert.equal(release.prerelease,true);
 assert.deepEqual(release.assets.map(asset=>asset.name).sort(),[`AciraBrowser-${VERSION}-mac-arm64-update.zip`,`AciraBrowser-${VERSION}-mac-arm64.dmg`,`AciraBrowser-${VERSION}-mac-x64-update.zip`,`AciraBrowser-${VERSION}-mac-x64.dmg`,'BUILD-INFO.json','SHA256SUMS.txt'].sort());
 assert.deepEqual(result.plan.feeds.map(feed=>feed.file),['beta-mac.yml']);
 const doc=JSON.parse(result.plan.feeds[0].text);assert.equal(doc.version,VERSION);assert.equal(doc.stagingPercentage,undefined,'without --rollout every install is offered it');
 for(const file of doc.files){const name=file.url.split('/').pop(),bytes=await fs.readFile(path.join(w.dir,name.includes('arm64')?'arm64':'x64',name));assert.equal(file.sha512,sha512(bytes));assert.equal(file.size,bytes.length);assert.ok(file.url.startsWith('https://github.com/'+REPO+'/releases/download/v0.1.0-beta.7-mac-b62c4715/'));}
 assert.match(doc.releaseNotes,/Faster tabs/);assert.equal(doc.releaseDate,'2026-11-02T04:00:00.000Z');
 const sums=release.assets.find(asset=>asset.name==='SHA256SUMS.txt').content;assert.match(sums,new RegExp(`${createHash('sha256').update('zip of the arm64 app').digest('hex')}  AciraBrowser-${VERSION}-mac-arm64-update\\.zip`));
 assert.match(release.body,/What's new/);
});
test('--rollout: the new Mac and Windows documents reach that share of installs; 100 is everyone (no field)',async t=>{
 const w=await workspace(t,{windows:true}),github=fakeGitHub();
 const staged=await planUpdate({...macOptions(w),'windows-dir':path.dirname(w.files.windows.exe),rollout:'20'},baseDeps(w,github));
 assert.deepEqual(staged.problems,[]);assert.deepEqual(staged.plan.feeds.map(feed=>[feed.file,JSON.parse(feed.text).stagingPercentage]),[['beta-mac.yml',20],['beta.yml',20]]);
 for(const feed of staged.plan.feeds)assert.equal(U.readWithUpdater(feed.text,{file:feed.file}).info.stagingPercentage,20,'electron-updater reads the share');
 const everyone=await planUpdate({...macOptions(w),rollout:'100'},baseDeps(w,github));assert.equal(JSON.parse(everyone.plan.feeds[0].text).stagingPercentage,undefined);
 const stable=await planUpdate({...macOptions(w,{version:'0.1.0'}),channel:'stable',rollout:'10',rehearsal:true},baseDeps(w,github));
 assert.deepEqual(stable.plan.feeds.map(feed=>[feed.file,JSON.parse(feed.text).stagingPercentage]),[['latest-mac.yml',10],['beta-mac.yml',10]],'a stable release is staged on both documents it writes');
});
test('the dry run never calls gh: reading the public feed is the only network it does',async t=>{
 const w=await workspace(t),github=fakeGitHub();
 await planUpdate(macOptions(w),baseDeps(w,github,{gh:async()=>{throw Error('a dry run must not use gh');}}));
 assert.deepEqual(github.state.log.filter(line=>!line.startsWith('DOWNLOAD')),[]);assert.equal(github.state.releases.size,0);
});
test('refusals: not newer than the live feed or a shipped build, a local version, a version that does not match the files',async t=>{
 const w=await workspace(t);
 const feedAhead=fakeGitHub({feed:{'beta-mac.yml':'0.1.0-beta.9','beta.yml':'0.0.0'}});
 assert.match((await planUpdate(macOptions(w),baseDeps(w,feedAhead))).problems.join('\n'),/not newer than 0\.1\.0-beta\.9 \(the live feed beta-mac\.yml\)/);
 const sameAsLive=fakeGitHub({feed:{'beta-mac.yml':VERSION,'beta.yml':'0.0.0'}});
 assert.match((await planUpdate(macOptions(w),baseDeps(w,sameAsLive))).problems.join('\n'),/0\.1\.0-beta\.7 is not newer than 0\.1\.0-beta\.7 \(the live feed beta-mac\.yml\)/,'the same version again is not an update (only --add-arch adds to it)');
 const github=fakeGitHub();
 for(const version of ['0.1.0-beta.6.local.4','0.1.0-beta.6','0.1.0-beta.5']){
  const result=await planUpdate(macOptions(w,{version}),baseDeps(w,github));assert.equal(result.ok,false,version);assert.match(result.problems.join('\n'),/not newer than|not a release version/,version);
 }
 assert.match((await planUpdate(macOptions(w,{version:'0.1.0-beta.8'}),baseDeps(w,github))).problems.join('\n'),/is version 0\.1\.0-beta\.7, not 0\.1\.0-beta\.8/,'file names must carry the release version');
 const wrongInside=await planUpdate(macOptions(w),baseDeps(w,github,{inspectMacZip:async()=>{throw Error('The app inside carries version 0.1.0-beta.6.local.4, not '+VERSION+'.');}}));
 assert.match(wrongInside.problems.join('\n'),/The app inside carries version 0\.1\.0-beta\.6\.local\.4/);
 const stable=await planUpdate(macOptions(w,{channel:'stable'}),baseDeps(w,github));assert.match(stable.problems.join('\n'),/use --channel beta/);
});
test('refusals: Windows not newer than its live feed',async t=>{
 const w=await workspace(t,{windows:true});
 const ahead=fakeGitHub({feed:{'beta-mac.yml':'0.0.0','beta.yml':'0.1.0-beta.8'}});
 const result=await planUpdate(winOptions(w),baseDeps(w,ahead));assert.equal(result.ok,false);
 assert.match(result.problems.join('\n'),/not newer than 0\.1\.0-beta\.8 \(the live feed beta\.yml\)/);
});
test('refusals: an architecture missing. arm64 alone needs --allow-single-arch (Intel Macs wait for --add-arch); x64 alone is never published',async t=>{
 const w=await workspace(t),github=fakeGitHub();
 const single=await planUpdate(macOptions(w,{'mac-x64-zip':undefined,'mac-x64-dmg':undefined}),baseDeps(w,github));
 assert.match(single.problems.join('\n'),/Only the arm64 Mac update ZIP was found.*--allow-single-arch.*--add-arch/);
 const allowed=await planUpdate(macOptions(w,{'mac-x64-zip':undefined,'mac-x64-dmg':undefined,'allow-single-arch':true}),baseDeps(w,github));
 assert.equal(allowed.ok,true);assert.match(allowed.warnings.join('\n'),/Intel Macs see failed update checks until you run --add-arch/);
 for(const extra of [{},{'allow-single-arch':true}]){
  const intelOnly=await planUpdate(macOptions(w,{'mac-arm64-zip':undefined,'mac-arm64-dmg':undefined,...extra}),baseDeps(w,github));
  assert.equal(intelOnly.ok,false);assert.match(intelOnly.problems.join('\n'),/hands Apple silicon Macs the Intel build/);
 }
 const none=await planUpdate(macOptions(w,{'mac-arm64-zip':undefined,'mac-arm64-dmg':undefined,'mac-x64-zip':undefined,'mac-x64-dmg':undefined,'mac-dir':path.join(w.dir,'nothing')}),baseDeps(w,github));
 assert.match(none.problems.join('\n'),/No Mac update ZIP found/);
 const dmgOnly=await planUpdate(macOptions(w,{'mac-x64-zip':undefined}),baseDeps(w,github));assert.match(dmgOnly.problems.join('\n'),/The x64 DMG has no matching update ZIP/);
});
test('refusals: a Mac file whose SHA-512 or size is not what its build receipt recorded, or that has no receipt, is never inspected or uploaded',async t=>{
 const w=await workspace(t),github=fakeGitHub(),inspected=[];
 const deps=baseDeps(w,github,{inspectMacZip:async({zip,arch})=>{inspected.push(arch);return {version:VERSION,arch,commit:COMMIT};}});
 await fs.writeFile(w.files.x64.zip,'zip of the x64 app, changed');
 const changed=await planUpdate(macOptions(w),deps);
 assert.equal(changed.ok,false);assert.match(changed.problems.join('\n'),/x64-update\.zip is not the file its build receipt describes \(SHA-512 or size differs/);assert.deepEqual(inspected,['arm64'],'a ZIP that is not the built one is not worth inspecting');
 await fs.writeFile(w.files.x64.zip,'zip of the x64 apq');// same size, other bytes
 assert.match((await planUpdate(macOptions(w),deps)).problems.join('\n'),/x64-update\.zip is not the file its build receipt describes/);
 await fs.writeFile(w.files.x64.zip,'zip of the x64 app');await fs.rm(w.files.x64.receipt);
 const noReceipt=await planUpdate(macOptions(w),deps);assert.match(noReceipt.problems.join('\n'),/x64-update\.zip: no build receipt beside it/);assert.match(noReceipt.problems.join('\n'),/x64\.dmg: no build receipt beside it/);
 const receipt=JSON.parse(await fs.readFile(w.files.arm64.receipt,'utf8'));
 await fs.writeFile(w.files.arm64.receipt,JSON.stringify({...receipt,updateZip:{...receipt.updateZip,zip:'/elsewhere/AciraBrowser-0.1.0-beta.7-mac-x64-update.zip'}}));
 assert.match((await planUpdate(macOptions(w,{'mac-x64-zip':undefined,'mac-x64-dmg':undefined,'allow-single-arch':true}),deps)).problems.join('\n'),/arm64-update\.zip: its build receipt describes AciraBrowser-0\.1\.0-beta\.7-mac-x64-update\.zip/);
 await fs.writeFile(w.files.arm64.receipt,JSON.stringify({...receipt,sha256:'0'.repeat(64)}));
 assert.match((await planUpdate(macOptions(w,{'mac-x64-zip':undefined,'mac-x64-dmg':undefined,'allow-single-arch':true}),deps)).problems.join('\n'),/arm64\.dmg differs from the file its build receipt describes/);
});
test('refusals: a ZIP or disk image that fails the signature, staple or Gatekeeper check stops everything',async t=>{
 const w=await workspace(t),github=fakeGitHub();
 const zip=await planUpdate(macOptions(w),baseDeps(w,github,{inspectMacZip:async({arch})=>{if(arch==='x64')throw Error('The notarization ticket is not stapled to the app');return {version:VERSION,arch,commit:COMMIT};}}));
 assert.equal(zip.ok,false);assert.match(zip.problems.join('\n'),/x64-update\.zip: The notarization ticket is not stapled/);
 const unsigned=await planUpdate(macOptions(w),baseDeps(w,github,{inspectMacZip:async()=>{throw Error('codesign --verify --deep --strict failed: code object is not signed at all');}}));assert.match(unsigned.problems.join('\n'),/arm64-update\.zip: codesign --verify --deep --strict failed: code object is not signed at all/);
 const dmg=await planUpdate(macOptions(w),baseDeps(w,github,{inspectMacDmg:async()=>{throw Error('Gatekeeper rejects the disk image');}}));assert.match(dmg.problems.join('\n'),/dmg: Gatekeeper rejects/);
 const split=await planUpdate(macOptions(w),baseDeps(w,github,{inspectMacZip:async({arch})=>({version:VERSION,arch,commit:arch==='x64'?'a'.repeat(40):COMMIT})}));assert.match(split.problems.join('\n'),/different commits/);
});
test('refusals: an unsigned ZIP is refused by the real check (unzip, codesign), not just by a stand-in',{skip:process.platform!=='darwin'&&'needs ditto and codesign'},async t=>{
 const w=await workspace(t),github=fakeGitHub(),app=path.join(w.dir,'build','Acira Browser.app');
 await fs.mkdir(path.join(app,'Contents/MacOS'),{recursive:true});await fs.writeFile(path.join(app,'Contents/MacOS/AciraBrowser'),'#!/bin/sh\n',{mode:0o755});
 await fs.writeFile(path.join(app,'Contents/Info.plist'),'<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>computer.acira.browser</string><key>CFBundleExecutable</key><string>AciraBrowser</string></dict></plist>');
 await promisify(execFile)('/usr/bin/ditto',['-c','-k','--keepParent',app,w.files.arm64.zip]);
 const bytes=await fs.readFile(w.files.arm64.zip),receipt=JSON.parse(await fs.readFile(w.files.arm64.receipt,'utf8'));
 await fs.writeFile(w.files.arm64.receipt,JSON.stringify({...receipt,updateZip:{...receipt.updateZip,sha512:sha512(bytes),size:bytes.length}}));
 const {inspectMacZip}=require('../packaging/macos/update-verify.cjs');
 const result=await planUpdate(macOptions(w),baseDeps(w,github,{inspectMacZip:options=>options.arch==='arm64'?inspectMacZip({...options,tmp:w.dir}):baseDeps(w,github).inspectMacZip(options)}));
 assert.equal(result.ok,false);assert.match(result.problems.join('\n'),/arm64-update\.zip: codesign --verify --deep --strict failed/);
});
test('a rehearsal tolerates artifacts built as another version, and can never be combined with --publish',async t=>{
 const w=await workspace(t),github=fakeGitHub(),built=async({zip,arch})=>({zip:path.basename(zip),version:'0.1.0-beta.6.local.4',arch,commit:COMMIT});
 const strict=await planUpdate(macOptions(w),baseDeps(w,github,{inspectMacZip:async({zip,arch,version})=>{const found=await built({zip,arch});if(version&&version!==found.version)throw Error('The app inside carries version '+found.version+', not '+version+'.');return found;}}));
 assert.equal(strict.ok,false,'without --rehearsal the embedded version must match');
 const rehearsal=await planUpdate(macOptions(w,{rehearsal:true}),baseDeps(w,github,{inspectMacZip:async({zip,arch,version})=>{const found=await built({zip,arch});if(version&&version!==found.version)throw Error('should not be asked for a version in a rehearsal');return found;}}));
 assert.equal(rehearsal.ok,true);assert.match(rehearsal.warnings.join('\n'),/REHEARSAL, would be an error: the app inside/);
 await assert.rejects(planUpdate(macOptions(w,{rehearsal:true,publish:true}),baseDeps(w,github)),/cannot be combined with --publish/);
 // but a rehearsal still cannot rehearse a version the feed would refuse
 assert.equal((await planUpdate(macOptions(w,{rehearsal:true,version:'0.1.0-beta.4'}),baseDeps(w,github))).ok,false);
});
test('publishing needs notes (or --no-notes) and a readable live feed; the dry run only warns',async t=>{
 const w=await workspace(t),github=fakeGitHub();
 const noNotes=macOptions(w,{'notes-file':undefined});
 assert.equal((await planUpdate(noNotes,baseDeps(w,github))).ok,true);assert.match((await planUpdate(noNotes,baseDeps(w,github))).warnings.join('\n'),/No release notes/);
 assert.match((await planUpdate({...noNotes,publish:true},baseDeps(w,github))).problems.join('\n'),/No release notes/);
 assert.equal((await planUpdate({...noNotes,publish:true,'no-notes':true},baseDeps(w,github))).ok,true);
 const offline={...github,fetch:async()=>{throw Error('offline');}};
 assert.equal((await planUpdate(macOptions(w),baseDeps(w,offline))).ok,true,'a dry run can be read offline');
 assert.equal((await planUpdate(macOptions(w,{publish:true}),baseDeps(w,offline))).ok,true,'a publish plans from the feed repository itself (gh), not the public copy');
 assert.match((await planUpdate(macOptions(w,{publish:true}),baseDeps(w,offline,{gh:async()=>{throw Error('gh: not logged in');}}))).problems.join('\n'),/Could not read the live feed beta-mac\.yml \(gh: not logged in\)/);
});
test('Windows: a setup that carries its feed gets a beta.yml entry; one that cannot self-update is published for download only, never into the feed',async t=>{
 const w=await workspace(t,{windows:true}),github=fakeGitHub(),options={...macOptions(w),'windows-dir':path.dirname(w.files.windows.exe)};
 const good=await planUpdate(options,baseDeps(w,github));assert.deepEqual(good.problems,[]);
 assert.deepEqual(good.plan.releases.map(release=>release.tag),['v0.1.0-beta.7-mac-b62c4715','v0.1.0-beta.7-windows-b62c4715']);
 assert.deepEqual(good.plan.feeds.map(feed=>feed.file),['beta-mac.yml','beta.yml']);
 const windows=good.plan.releases[1];assert.deepEqual(windows.assets.map(asset=>asset.name).sort(),['AciraBrowserSetup.exe','AciraBrowserSetup.exe.blockmap','BUILD-INFO.json','SHA256SUMS.txt']);
 const feed=JSON.parse(good.plan.feeds[1].text);assert.equal(feed.files[0].url,`https://github.com/${REPO}/releases/download/v0.1.0-beta.7-windows-b62c4715/AciraBrowserSetup.exe`);
 assert.equal(feed.previousBlockMaps,undefined,'the live beta.yml names no setup yet: no earlier blockmaps, and none needed');
 github.state.feed['beta.yml']=JSON.stringify({version:'0.1.0-beta.6',files:[{url:`https://github.com/${REPO}/releases/download/v0.1.0-beta.6-windows-aaaaaaaa/AciraBrowserSetup-0.1.0-beta.6.exe`,sha512:'x',size:1000}]});
 github.seedRelease('v0.1.0-beta.6-windows-aaaaaaaa',{assets:{'AciraBrowserSetup-0.1.0-beta.6.exe.blockmap':blockMap(1000)}});
 const noted=JSON.parse((await planUpdate(options,baseDeps(w,github))).plan.feeds[1].text);
 assert.deepEqual(noted.previousBlockMaps,[{version:'0.1.0-beta.6',url:`https://github.com/${REPO}/releases/download/v0.1.0-beta.6-windows-aaaaaaaa/AciraBrowserSetup-0.1.0-beta.6.exe.blockmap`}],'the live setup\'s blockmap, for copies of it that update (differential)');
 // the installer cannot be shown to carry app-update.yml
 for(const updateConfig of [false,null]){
  const result=await planUpdate(options,baseDeps(w,github,{inspectWindowsInstaller:async()=>({updateConfig,source:'test'})}));
  assert.deepEqual(result.plan.feeds.map(item=>item.file),['beta-mac.yml'],'the Windows feed is left alone in the dry run');assert.match(result.warnings.join('\n'),/Windows feed will NOT be updated/);
  assert.match((await planUpdate({...options,publish:true},baseDeps(w,github,{inspectWindowsInstaller:async()=>({updateConfig,source:'test'})}))).problems.join('\n'),/Windows self-update is not proven/);
  const downloadOnly=await planUpdate({...options,publish:true,'windows-download-only':true},baseDeps(w,github,{inspectWindowsInstaller:async()=>({updateConfig,source:'test'})}));
  assert.equal(downloadOnly.ok,true);assert.deepEqual(downloadOnly.plan.feeds.map(item=>item.file),['beta-mac.yml']);assert.equal(downloadOnly.plan.releases.length,2);
  const assumed=await planUpdate({...options,publish:true,'windows-assume-updater':true},baseDeps(w,github,{inspectWindowsInstaller:async()=>({updateConfig,source:'test'})}));
  assert.deepEqual(assumed.plan.feeds.map(item=>item.file),['beta-mac.yml','beta.yml']);
 }
 // evidence must agree with the file and the version
 await fs.writeFile(w.files.windows.latest,JSON.stringify({version:'0.1.0-beta.6',files:[{url:'AciraBrowserSetup.exe',sha512:'AAAA',size:5}]}));
 const stale=await planUpdate(options,baseDeps(w,github));assert.match(stale.problems.join('\n'),/says the Windows installer is version 0\.1\.0-beta\.6/);assert.match(stale.problems.join('\n'),/describes a different file/);
 await fs.rm(w.files.windows.latest);await fs.rm(w.files.windows.record);
 assert.match((await planUpdate(options,baseDeps(w,github))).problems.join('\n'),/Nothing says which version/);
});
test('refusals: a Windows setup whose build record names other bytes (SHA-256 or size)',async t=>{
 const w=await workspace(t,{windows:true}),github=fakeGitHub();
 await fs.writeFile(w.files.windows.record,JSON.stringify({version:VERSION,commit:COMMIT,installer:{file:'AciraBrowserSetup.exe',sha256:'0'.repeat(64),bytes:1100000}}));
 assert.match((await planUpdate(winOptions(w),baseDeps(w,github))).problems.join('\n'),/WINDOWS-BUILD-RESULT\.json describes a different file than AciraBrowserSetup\.exe/);
 const exe=await fs.readFile(w.files.windows.exe);
 await fs.writeFile(w.files.windows.record,JSON.stringify({version:VERSION,commit:COMMIT,installer:{file:'AciraBrowserSetup.exe',sha256:sha256(exe),bytes:exe.length+1}}));
 assert.match((await planUpdate(winOptions(w),baseDeps(w,github))).problems.join('\n'),/describes a different file/);
});
test('refusals: a Windows setup without its blockmap, or with one that belongs to another build, in the dry run as in a publish',async t=>{
 const w=await workspace(t,{windows:true}),github=fakeGitHub();
 for(const publish of [false,true]){
  await fs.rm(w.files.windows.blockmap);
  const missing=await planUpdate(winOptions(w,{publish}),baseDeps(w,github));assert.equal(missing.ok,false);assert.match(missing.problems.join('\n'),/No AciraBrowserSetup\.exe\.blockmap beside the setup/);
  await fs.writeFile(w.files.windows.blockmap,blockMap(999999));
  assert.match((await planUpdate(winOptions(w,{publish}),baseDeps(w,github))).problems.join('\n'),/AciraBrowserSetup\.exe\.blockmap: it describes a file of 999999 bytes, not this 1100000-byte setup/);
  await fs.writeFile(w.files.windows.blockmap,'not gzip');
  assert.match((await planUpdate(winOptions(w,{publish}),baseDeps(w,github))).problems.join('\n'),/blockmap: it is not a blockmap/);
  await fs.writeFile(w.files.windows.blockmap,blockMap(1100000));
 }
 assert.equal((await planUpdate(winOptions(w,{'windows-download-only':true}),baseDeps(w,github))).ok,true);
 await fs.rm(w.files.windows.blockmap);
 assert.match((await planUpdate(winOptions(w,{'windows-download-only':true}),baseDeps(w,github))).problems.join('\n'),/No AciraBrowserSetup\.exe\.blockmap/,'a download-only setup is held to the same rule: every Windows build ships with its blockmap');
});
test('refusals: a live Windows document names a setup, but none of the earlier blockmaps can be downloaded (no previousBlockMaps); one that can is enough',async t=>{
 const w=await workspace(t,{windows:true}),live=liveWorld({version:'0.1.0-beta.6',mac:{arches:['arm64','x64']}});
 live.github.state.releases.get(live.winTag).assets.delete('AciraBrowserSetup.exe.blockmap');
 const refused=await planUpdate(winOptions(w),baseDeps(w,live.github));
 assert.equal(refused.ok,false);assert.match(refused.problems.join('\n'),/The live setup's blockmap, 0\.1\.0-beta\.6 \(.*HTTP 404\), could not be downloaded and read.*--allow-missing-blockmaps/);
 live.github.state.releases.get(live.winTag).assets.set('AciraBrowserSetup.exe.blockmap',{size:5,bytes:Buffer.from('junk!')});
 assert.match((await planUpdate(winOptions(w),baseDeps(w,live.github))).problems.join('\n'),/The live setup's blockmap.*not a blockmap/,'a file that is not a blockmap does not count');
 const wrongSize=blockMap(5000);live.github.state.releases.get(live.winTag).assets.set('AciraBrowserSetup.exe.blockmap',{size:wrongSize.length,bytes:wrongSize});
 assert.match((await planUpdate(winOptions(w),baseDeps(w,live.github))).problems.join('\n'),/The live setup's blockmap.*describes a file of \d+ bytes, not this 1000-byte setup/,'nor one that describes another setup than the live one');
 // emergency: --allow-missing-blockmaps publishes without it, saying so; with nothing left at all that is said too
 const forced=await planUpdate(winOptions(w,{'allow-missing-blockmaps':true}),baseDeps(w,live.github));
 assert.deepEqual(forced.problems,[]);assert.match(forced.warnings.join('\n'),/previousBlockMaps leaves out 0\.1\.0-beta\.6/);assert.match(forced.warnings.join('\n'),/no previousBlockMaps.*Published anyway \(--allow-missing-blockmaps\)/);
 // an older entry the live document carried that cannot be read is left out with a warning; the live setup's own entry never is (above)
 const older=download('v0.1.0-beta.5-windows-cccccccc','AciraBrowserSetup-0.1.0-beta.5.exe.blockmap');
 live.github.state.feed['beta.yml']=JSON.stringify({...live.winDoc,previousBlockMaps:[{version:'0.1.0-beta.5',url:older}]});live.github.seedRelease('v0.1.0-beta.5-windows-cccccccc',{assets:{'AciraBrowserSetup-0.1.0-beta.5.exe.blockmap':blockMap(4000)}});
 const partial=await planUpdate(winOptions(w),baseDeps(w,live.github));
 assert.equal(partial.ok,false,'an older entry left does not excuse losing the live one');
 const kept=await planUpdate(winOptions(w,{'allow-missing-blockmaps':true}),baseDeps(w,live.github));
 assert.deepEqual(kept.problems,[]);assert.deepEqual(JSON.parse(kept.plan.feeds[0].text).previousBlockMaps,[{version:'0.1.0-beta.5',url:older}]);
 live.github.state.releases.get(live.winTag).assets.set('AciraBrowserSetup.exe.blockmap',{size:blockMap(1000).length,bytes:blockMap(1000)});
 assert.deepEqual(JSON.parse((await planUpdate(winOptions(w),baseDeps(w,live.github))).plan.feeds[0].text).previousBlockMaps.map(item=>item.version),['0.1.0-beta.6','0.1.0-beta.5']);
});
test('Windows setup inspection: the build record decides when it exists, and a file that is not an executable is refused',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'acira-win-inspect-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const exe=path.join(dir,'AciraBrowserSetup.exe');await fs.writeFile(exe,'MZ....');
 assert.deepEqual(await inspectWindowsInstaller({exe,evidence:[{source:'ACIRA-INSTALLER-PROVENANCE.json',updateConfig:{url:U.RAW_FEED_BASE}}]}),{updateConfig:true,source:'ACIRA-INSTALLER-PROVENANCE.json'});
 assert.equal((await inspectWindowsInstaller({exe,evidence:[{source:'x',updateConfig:{url:'https://elsewhere.example/'}}]})).updateConfig,false);
 await fs.writeFile(exe,'PK....');await assert.rejects(inspectWindowsInstaller({exe,evidence:[]}),/not a Windows executable/);
});

async function plannedMac(t,over={}){
 const w=await workspace(t,over.windows?{windows:true}:{}),github=fakeGitHub(over.github),options=macOptions(w,{...(over.windows?{'windows-dir':path.dirname(w.files.windows.exe)}:{}),...over.options});
 const result=await planUpdate({...options,publish:true},baseDeps(w,github));assert.deepEqual(result.problems,[]);
 return {w,github,result,deps:baseDeps(w,github,{gh:github.gh})};
}
test('publishing: releases are made public and downloaded back anonymously BEFORE the channel documents are committed, in one commit, and the documents then say the new version',async t=>{
 const {github,result,deps}=await plannedMac(t,{windows:true,options:{rollout:'25'}});
 const state=await publishPlan({plan:result.plan,deps,options:{}});
 const log=github.state.log,feedAt=log.indexOf('FEED COMMITTED');
 assert.ok(feedAt>0);
 assert.equal(log.filter(line=>line==='FEED COMMITTED').length,1,'one commit for all channel documents');
 const lastPayloadStep=Math.max(...log.map((line,index)=>line.startsWith('DOWNLOAD')||line.startsWith('release upload')||line.startsWith('release edit')?index:-1));
 assert.ok(lastPayloadStep<feedAt,'every upload, publication and anonymous download happened before the feed commit');
 const downloads=log.filter(line=>line.startsWith('DOWNLOAD')).map(line=>line.slice(9));
 for(const release of result.plan.releases)for(const asset of release.assets)assert.ok(downloads.includes(asset.name),asset.name+' was downloaded back');
 assert.ok(log.indexOf('release edit v0.1.0-beta.7-mac-b62c4715 --repo Acira-dev/AciraBrowserUpdates')<log.findIndex(line=>line.startsWith('DOWNLOAD')),'a draft is published before anything can be downloaded anonymously');
 assert.equal(state.feedCommit,'commit1');
 assert.deepEqual([...github.state.releases.values()].map(release=>release.isDraft),[false,false]);
 assert.equal(feedDoc(github,'beta-mac.yml').version,VERSION);assert.equal(feedDoc(github,'beta.yml').version,VERSION);
 assert.equal(feedDoc(github,'beta-mac.yml').stagingPercentage,25);assert.equal(feedDoc(github,'beta.yml').stagingPercentage,25);
 assert.equal(feedDoc(github,'latest-mac.yml').version,'0.0.0','the stable documents are not touched by a beta release');
 assert.deepEqual(github.state.pendingTree.tree.map(entry=>entry.path),['feed/beta-mac.yml','feed/beta.yml']);
 assert.match(github.state.commitBody.message,/Feed: Acira Browser 0\.1\.0-beta\.7 \(beta, mac \+ windows\)/);assert.match(github.state.commitBody.message,/feed\/beta\.yml: offered to 25% of installs/);
 assert.equal(github.state.downloadsWithCredentials,0,'the byte check downloads with no credentials, like an installed copy');
});
test('safe stop: an upload that fails leaves the feed untouched and says how to clean up',async t=>{
 const {github,result,deps}=await plannedMac(t);github.state.failUpload=`AciraBrowser-${VERSION}-mac-x64-update.zip`;
 await assert.rejects(publishPlan({plan:result.plan,deps,options:{}}),error=>{
  assert.match(error.message,/upload failed/);assert.ok(error.recovery.some(line=>/NOT touched/.test(line)));assert.ok(error.recovery.some(line=>/gh release delete v0\.1\.0-beta\.7-mac-b62c4715/.test(line)));return true;
 });
 assert.ok(!github.state.log.includes('FEED COMMITTED'));assert.equal(feedDoc(github,'beta-mac.yml').version,'0.1.0-beta.4');
 assert.equal(github.state.releases.get('v0.1.0-beta.7-mac-b62c4715').isDraft,true,'a half-uploaded release stays a draft, invisible to the website');
});
test('safe stop: a payload that downloads differently from what was uploaded leaves the feed untouched (Mac and Windows)',async t=>{
 for(const name of [`AciraBrowser-${VERSION}-mac-arm64-update.zip`,'AciraBrowserSetup.exe','AciraBrowserSetup.exe.blockmap']){
  const {github,result,deps}=await plannedMac(t,{windows:true});github.state.corrupt=name;
  await assert.rejects(publishPlan({plan:result.plan,deps,options:{}}),/SHA-512 differs|bytes/,name);
  assert.ok(!github.state.log.includes('FEED COMMITTED'),name);assert.equal(feedDoc(github,'beta-mac.yml').version,'0.1.0-beta.4');assert.equal(feedDoc(github,'beta.yml').version,'0.0.0');
 }
});
test('safe stop: a payload nobody can download anonymously (404) leaves the feed untouched',async t=>{
 const {github,result,deps}=await plannedMac(t);
 const hidden={...github,fetch:async url=>url.includes('/releases/download/')?new Response('',{status:404}):github.fetch(url)};
 await assert.rejects(publishPlan({plan:result.plan,deps:{...deps,fetch:hidden.fetch},options:{}}),/Anonymous download .* failed: HTTP 404/);
 assert.ok(!github.state.log.includes('FEED COMMITTED'));
});
test('safe stop: a private repository, a feed that moved ahead, or a branch that moved all stop before or at the very last step',async t=>{
 const priv=await plannedMac(t);priv.github.state.isPrivate=true;
 await assert.rejects(publishPlan({plan:priv.result.plan,deps:priv.deps,options:{}}),/is not public/);assert.equal(priv.github.state.releases.size,0,'nothing was created');
 const ahead=await plannedMac(t);ahead.github.state.feed['beta-mac.yml']=JSON.stringify({version:'0.1.0-beta.8',files:[]});
 await assert.rejects(publishPlan({plan:ahead.result.plan,deps:ahead.deps,options:{}}),/already offers 0\.1\.0-beta\.8/);assert.equal(ahead.github.state.releases.size,0,'caught by the authoritative check before any upload');
 const moved=await plannedMac(t);moved.github.state.moveMainDuringPublish=true;
 await assert.rejects(publishPlan({plan:moved.result.plan,deps:moved.deps,options:{}}),error=>{assert.match(error.message,/not a fast forward/);assert.ok(error.recovery.some(line=>/NOT touched/.test(line)));return true;});
 assert.equal(feedDoc(moved.github,'beta-mac.yml').version,'0.1.0-beta.4');
 // the feed moves while the payloads upload: the check on the commit the feed commit builds on catches it
 const late=await plannedMac(t),gh=late.github.gh;
 const sneaky=async(args,options)=>{if(args[0]==='api'&&String(args[1]).endsWith('/git/ref/heads/main'))late.github.state.feed['beta-mac.yml']=JSON.stringify({version:'0.1.0-beta.9',files:[]});return gh(args,options);};
 await assert.rejects(publishPlan({plan:late.result.plan,deps:{...late.deps,gh:sneaky},options:{}}),/already offers 0\.1\.0-beta\.9/);assert.ok(!late.github.state.log.includes('FEED COMMITTED'));
});
test('resuming: running again reuses a release that is already there and uploads only what is missing',async t=>{
 const {github,result,deps}=await plannedMac(t);github.state.failUpload=`AciraBrowser-${VERSION}-mac-x64.dmg`;
 await assert.rejects(publishPlan({plan:result.plan,deps,options:{}}),/upload failed/);
 const uploadedBefore=[...github.state.releases.get('v0.1.0-beta.7-mac-b62c4715').assets.keys()];assert.ok(uploadedBefore.length>0&&uploadedBefore.length<6);
 github.state.failUpload=null;github.state.log.length=0;
 await publishPlan({plan:result.plan,deps,options:{}});
 const uploads=github.state.log.filter(line=>line.startsWith('release upload')).length;assert.equal(uploads,6-uploadedBefore.length,'only the missing files were uploaded');
 assert.equal(feedDoc(github,'beta-mac.yml').version,VERSION);
 // and running a third time after success is harmless apart from the feed check: the feed already offers this version, so it refuses to "update" it
 await assert.rejects(publishPlan({plan:result.plan,deps,options:{}}),/already offers 0\.1\.0-beta\.7/);
});
test('commitFeed builds one fast-forward commit on main from the current head, and a check can stop it on what that head holds',async()=>{
 const github=fakeGitHub();const sha=await commitFeed({gh:github.gh,repo:REPO,files:[{file:'beta-mac.yml',text:'{"version":"1"}\n'}],message:'m'});
 assert.equal(sha,'commit1');assert.equal(github.state.pendingTree.base_tree,'tree-of-head0');assert.equal(github.state.commitBody.parents[0],'head0');assert.equal(github.state.feed['beta-mac.yml'],'{"version":"1"}\n');
 const seen=[];await assert.rejects(commitFeed({gh:github.gh,repo:REPO,files:[{file:'beta-mac.yml',text:'{"version":"2"}\n'}],message:'m',check:docs=>{seen.push(docs);throw Error('stop');}}),/stop/);
 assert.deepEqual(seen,[{'beta-mac.yml':{version:'1'}}]);assert.equal(github.state.feed['beta-mac.yml'],'{"version":"1"}\n');
});
test('anonymous verification compares size and SHA-512 and retries a not-yet-served asset',async()=>{
 const bytes=Buffer.from('payload'),good={sha512:sha512(bytes),size:bytes.length};let calls=0;
 const flaky=async()=>{calls++;return calls<3?new Response('',{status:404}):new Response(bytes);};
 assert.equal(await verifyDownload({fetch:flaky,url:'https://x/a',...good,sleep:async()=>{},delays:[1,1,1]}),true);assert.equal(calls,3);
 await assert.rejects(verifyDownload({fetch:async()=>new Response(Buffer.from('other!!')),url:'https://x/a',...good,sleep:async()=>{},delays:[]}),/SHA-512 differs/);
 await assert.rejects(verifyDownload({fetch:async()=>new Response(Buffer.from('short')),url:'https://x/a',...good,sleep:async()=>{},delays:[]}),/downloaded 5 bytes/);
});

// ---- the live version: widen, halt, resume
test('--widen raises the share of the live version on each document that offers it; nothing else in the document changes',async t=>{
 const {github,macDoc}=liveWorld({mac:{extra:{stagingPercentage:20}},windows:{extra:{stagingPercentage:20}}});
 const result=await planFeedChange({version:VERSION,widen:'50'},editDeps(github));
 assert.deepEqual(result.problems,[]);assert.equal(result.plan.mode,'widen');
 assert.deepEqual(result.plan.feeds.map(feed=>[feed.file,JSON.parse(feed.text).stagingPercentage]),[['beta-mac.yml',50],['beta.yml',50]]);
 const after=JSON.parse(result.plan.feeds[0].text);assert.deepEqual({...after,stagingPercentage:20},macDoc,'only stagingPercentage moved');
 assert.deepEqual(U.lineDiff(result.plan.feeds[0].beforeText,result.plan.feeds[0].text).filter(line=>!line.startsWith('  ')),['-   "stagingPercentage": 20','+   "stagingPercentage": 50']);
 assert.deepEqual(result.plan.verify.map(item=>item.name),[`AciraBrowser-${VERSION}-mac-arm64-update.zip`,`AciraBrowser-${VERSION}-mac-x64-update.zip`,'AciraBrowserSetup.exe'],'the files it sends more people to are downloaded back first');
 const everyone=await planFeedChange({version:VERSION,widen:'100',platform:'windows'},editDeps(github));
 assert.deepEqual(everyone.plan.feeds.map(feed=>feed.file),['beta.yml']);assert.equal('stagingPercentage' in JSON.parse(everyone.plan.feeds[0].text),false,'100% is everyone: the field goes');
});
test('--widen refuses to narrow, to widen a halted or already complete version, and to touch a version that is not live',async t=>{
 const staged=liveWorld({mac:{extra:{stagingPercentage:50}},windows:{extra:{stagingPercentage:50}}}).github;
 for(const value of ['50','30'])assert.match((await planFeedChange({version:VERSION,widen:value},editDeps(staged))).problems.join('\n'),/already offered to 50% of installs; --widen only raises it \(a number above 50\)/,value);
 const halted=liveWorld({mac:{extra:{stagingPercentage:0,halted:{at:'x',percentage:20}}}}).github;
 assert.match((await planFeedChange({version:VERSION,widen:'80',platform:'mac'},editDeps(halted))).problems.join('\n'),/is halted\. Resume it first \(--resume-rollout\), then widen/);
 const full=liveWorld().github;
 assert.match((await planFeedChange({version:VERSION,widen:'80'},editDeps(full))).problems.join('\n'),/already offered to every install; --widen only raises it\./);
 const newer=liveWorld({version:'0.1.0-beta.8'}).github;
 assert.match((await planFeedChange({version:VERSION,widen:'80'},editDeps(newer))).problems.join('\n'),/The live feed does not offer 0\.1\.0-beta\.7: beta-mac\.yml offers 0\.1\.0-beta\.8, beta\.yml offers 0\.1\.0-beta\.8/);
 const unreadable={...full,fetch:async()=>{throw Error('offline');}};
 assert.match((await planFeedChange({version:VERSION,widen:'80'},editDeps(full,{fetch:unreadable.fetch}))).problems.join('\n'),/Could not read beta-mac\.yml \(offline\), beta\.yml \(offline\): no document that could be read offers 0\.1\.0-beta\.7\. --platform mac or --platform windows changes one platform only\./);
});
test('--halt offers the live version to nobody (stagingPercentage 0) and records the share it had; it downloads nothing and refuses a second halt',async t=>{
 const {github}=liveWorld({mac:{extra:{stagingPercentage:20}}});
 const result=await planFeedChange({version:VERSION,halt:true},editDeps(github));
 assert.deepEqual(result.problems,[]);assert.deepEqual(result.plan.verify,[],'a halt is never held up by downloads');
 const [mac,windows]=result.plan.feeds.map(feed=>JSON.parse(feed.text));
 assert.equal(mac.stagingPercentage,0);assert.deepEqual(mac.halted,{at:'2026-11-03T09:00:00.000Z',percentage:20});
 assert.equal(windows.stagingPercentage,0);assert.deepEqual(windows.halted,{at:'2026-11-03T09:00:00.000Z',percentage:100});
 for(const feed of result.plan.feeds)assert.equal(U.readWithUpdater(feed.text,{file:feed.file}).info.stagingPercentage,0);
 await publishPlan({plan:result.plan,deps:editDeps(github),options:{}});
 assert.equal(github.state.log.filter(line=>line.startsWith('DOWNLOAD')).length,0);assert.equal(feedDoc(github,'beta-mac.yml').stagingPercentage,0);assert.equal(feedDoc(github,'beta.yml').stagingPercentage,0);
 assert.match(github.state.commitBody.message,/Feed: Acira Browser 0\.1\.0-beta\.7 \(beta, halted\)/);
 assert.match((await planFeedChange({version:VERSION,halt:true},editDeps(github))).problems.join('\n'),/beta-mac\.yml: 0\.1\.0-beta\.7 is already halted/);
 assert.match(haltEffects({version:VERSION,percentage:20}).join('\n'),/keep it[\s\S]*still installs when Acira quits[\s\S]*again to 20% of installs/);
});
test('--platform halts one platform only; a stable halt changes both documents that offer it and leaves a beta that moved on alone',async t=>{
 const {github}=liveWorld();
 const mac=await planFeedChange({version:VERSION,halt:true,platform:'mac'},editDeps(github));
 assert.deepEqual(mac.plan.feeds.map(feed=>feed.file),['beta-mac.yml']);
 const stable=liveWorld({version:'0.1.0',channel:'stable',extraFeed:{'beta-mac.yml':{version:'0.1.1-beta.1',files:[]}}}).github;
 const result=await planFeedChange({version:'0.1.0',channel:'stable',halt:true},editDeps(stable));
 assert.deepEqual(result.problems,[]);assert.deepEqual(result.plan.feeds.map(feed=>feed.file),['latest-mac.yml','latest.yml','beta.yml']);
 assert.deepEqual(result.plan.untouched,['feed/beta-mac.yml offers 0.1.1-beta.1: left alone']);
 assert.match((await planFeedChange({version:VERSION,halt:true,platform:'windows'},editDeps(liveWorld({windows:{extra:{}}}).github,{fetch:async url=>url.endsWith('beta.yml')&&!url.endsWith('-mac.yml')?new Response(JSON.stringify({version:'0.1.0-beta.6',files:[]})):new Response('',{status:404})}))).problems.join('\n'),/does not offer 0\.1\.0-beta\.7: beta\.yml offers 0\.1\.0-beta\.6/);
});
test('--resume-rollout puts a halted version back at the share it had (or --rollout); a version that is not halted has nothing to resume',async t=>{
 const {github}=liveWorld({mac:{extra:{stagingPercentage:0,halted:{at:'2026-11-03T08:00:00.000Z',percentage:20}}},windows:{extra:{stagingPercentage:0,halted:{at:'2026-11-03T08:00:00.000Z',percentage:100}}}});
 const result=await planFeedChange({version:VERSION,'resume-rollout':true},editDeps(github));
 assert.deepEqual(result.problems,[]);
 const [mac,windows]=result.plan.feeds.map(feed=>JSON.parse(feed.text));
 assert.equal(mac.stagingPercentage,20);assert.equal('halted' in mac,false);assert.equal('stagingPercentage' in windows,false);assert.equal('halted' in windows,false);
 assert.equal(result.plan.verify.length,3,'resuming sends people to the files again: they are downloaded back first');
 assert.equal(JSON.parse((await planFeedChange({version:VERSION,'resume-rollout':true,rollout:'5'},editDeps(github))).plan.feeds[0].text).stagingPercentage,5);
 const unknown=liveWorld({mac:{extra:{stagingPercentage:0}}}).github;
 assert.match((await planFeedChange({version:VERSION,'resume-rollout':true,platform:'mac'},editDeps(unknown))).problems.join('\n'),/did not record what share of installs 0\.1\.0-beta\.7 had; say it with --rollout/);
 assert.match((await planFeedChange({version:VERSION,'resume-rollout':true},editDeps(liveWorld().github))).problems.join('\n'),/is not halted \(offered to every install\); nothing to resume/);
});
test('a feed change commits only after the files it sends people to download back intact, and only onto the exact document it was planned from',async t=>{
 const world=liveWorld({mac:{extra:{stagingPercentage:20}},windows:{extra:{stagingPercentage:20}}}),{github}=world;
 const plan=(await planFeedChange({version:VERSION,widen:'60'},editDeps(github))).plan;
 const corrupt=github.state.releases.get(world.macTag).assets.get(`AciraBrowser-${VERSION}-mac-x64-update.zip`);corrupt.bytes=Buffer.from(corrupt.bytes);corrupt.bytes[0]^=1;
 await assert.rejects(publishPlan({plan,deps:editDeps(github),options:{}}),error=>{assert.match(error.message,/x64-update\.zip failed: SHA-512 differs/);assert.ok(error.recovery.some(line=>/NOT touched/.test(line)));return true;});
 assert.equal(feedDoc(github,'beta-mac.yml').stagingPercentage,20);corrupt.bytes[0]^=1;
 // the public copy the plan was made from is a few minutes old: the real document already says 40%
 github.state.feed['beta-mac.yml']=JSON.stringify({...world.macDoc,stagingPercentage:40},null,2)+'\n';
 await assert.rejects(publishPlan({plan,deps:editDeps(github),options:{}}),/feed\/beta-mac\.yml is not what this plan was made from \(it offers 0\.1\.0-beta\.7, offered to 40% of installs; the plan saw 0\.1\.0-beta\.7, offered to 20% of installs\)/);
 assert.ok(!github.state.log.includes('FEED COMMITTED'));
 const fresh=(await planFeedChange({version:VERSION,widen:'60'},editDeps(github))).plan;github.state.log.length=0;
 await publishPlan({plan:fresh,deps:editDeps(github),options:{}});
 const log=github.state.log;assert.ok(log.lastIndexOf(log.filter(line=>line.startsWith('DOWNLOAD')).at(-1))<log.indexOf('FEED COMMITTED'));
 assert.equal(feedDoc(github,'beta-mac.yml').stagingPercentage,60);assert.equal(feedDoc(github,'beta.yml').stagingPercentage,60);assert.match(github.state.commitBody.message,/\(beta, widened, offered to 60% of installs\)/);
});

// ---- --add-arch
async function addArchWorld(t,{liveArches=['arm64'],localArches=['x64'],commit=COMMIT,stagingPercentage}={}){
 const w=await workspace(t,{arches:localArches,commit}),world=liveWorld({mac:{arches:liveArches,extra:stagingPercentage===undefined?{}:{stagingPercentage}}});
 return {w,...world,options:{version:VERSION,'add-arch':true,'mac-x64-zip':w.files.x64?.zip,'mac-arm64-zip':w.files.arm64?.zip}};
}
test('--add-arch adds the missing architecture to the live version: its ZIP joins the published release, and the live documents gain one file and keep the rest',async t=>{
 const {w,github,macDoc,macTag,options}=await addArchWorld(t,{stagingPercentage:30});
 const result=await planUpdate(options,baseDeps(w,github));
 assert.deepEqual(result.problems,[]);assert.equal(result.plan.mode,'add-arch');
 const [release]=result.plan.releases;assert.equal(release.tag,macTag);assert.equal(release.addTo,true);
 assert.deepEqual(release.assets.map(asset=>asset.name),[`AciraBrowser-${VERSION}-mac-x64-update.zip`,'SHA256SUMS-x64.txt','BUILD-INFO-x64.json'],'nothing on the release is replaced');
 assert.deepEqual(result.plan.feeds.map(feed=>feed.file),['beta-mac.yml']);
 const doc=JSON.parse(result.plan.feeds[0].text);
 assert.deepEqual({...doc,files:doc.files.slice(0,1)},macDoc,'date, notes, rollout and the first file stay as they are');
 assert.equal(doc.stagingPercentage,30);assert.equal(doc.files[1].url,download(macTag,`AciraBrowser-${VERSION}-mac-x64-update.zip`));assert.equal(doc.files[1].sha512,sha512('zip of the x64 app'));
 const {MacUpdater}=require('electron-updater/out/MacUpdater'),{files}=U.readWithUpdater(result.plan.feeds[0].text,{file:'beta-mac.yml'});
 assert.match(MacUpdater.filterFilesForArch(files,true)[0].url.href,/arm64-update\.zip$/);assert.match(MacUpdater.filterFilesForArch(files,false)[0].url.href,/x64-update\.zip$/);
 // publish: into the published release, downloaded back, then the feed
 await publishPlan({plan:result.plan,deps:baseDeps(w,github),options:{}});
 const log=github.state.log;assert.ok(!log.some(line=>line.startsWith('release create')),'no new release');assert.ok(log.indexOf('DOWNLOAD '+`AciraBrowser-${VERSION}-mac-x64-update.zip`)<log.indexOf('FEED COMMITTED'));
 assert.equal(github.state.releases.get(macTag).isDraft,false);assert.ok(github.state.releases.get(macTag).assets.has(`AciraBrowser-${VERSION}-mac-arm64-update.zip`));
 assert.deepEqual(feedDoc(github,'beta-mac.yml').files.map(file=>U.macArchOf(file.url)),['arm64','x64']);assert.match(github.state.commitBody.message,/\(beta, add x64\)/);
});
test('main(): the --add-arch dry run says which architectures the live document hands out now and after',async t=>{
 const {w,github,options}=await addArchWorld(t,{stagingPercentage:30}),lines=[];
 assert.equal(await main(['--version',VERSION,'--add-arch','--mac-x64-zip',options['mac-x64-zip'],'--review-dir',path.join(w.dir,'review')],{...baseDeps(w,github),log:line=>lines.push(line)}),0);
 const text=lines.join('\n');
 assert.match(text,/ADD THE MISSING MAC ARCHITECTURE to Acira Browser 0\.1\.0-beta\.7/);assert.match(text,/add to the published release v0\.1\.0-beta\.7-mac-b62c4715/);
 assert.match(text,/now: {3}0\.1\.0-beta\.7 \(arm64\), offered to 30% of installs\n\s+after: 0\.1\.0-beta\.7 \(arm64 \+ x64\), offered to 30% of installs/);
 assert.match(text,/DRY RUN OK\. Nothing was uploaded or changed\. Run the same command with --publish --yes to add it\./);assert.equal(github.state.commits,0);
});
test('--add-arch: local files of an architecture that is already live are ignored; corrupted uploads and a missing release leave the feed alone',async t=>{
 const {w,github,macTag,options}=await addArchWorld(t,{localArches:['arm64','x64']});
 const result=await planUpdate(options,baseDeps(w,github));assert.deepEqual(result.problems,[]);
 assert.match(result.warnings.join('\n'),/The arm64 files found here are not uploaded: the live 0\.1\.0-beta\.7 already has arm64/);assert.ok(!result.plan.releases[0].assets.some(asset=>asset.arch==='arm64'));
 github.state.corrupt=`AciraBrowser-${VERSION}-mac-x64-update.zip`;
 await assert.rejects(publishPlan({plan:result.plan,deps:baseDeps(w,github),options:{}}),error=>{assert.match(error.message,/SHA-512 differs/);assert.ok(error.recovery.some(line=>/the release the live feed points at.*Do not delete that release/.test(line)));assert.ok(!error.recovery.some(line=>/gh release delete/.test(line)),'never advise deleting the live release');return true;});
 assert.equal(feedDoc(github,'beta-mac.yml').files.length,1);
 github.state.releases.delete(macTag);
 await assert.rejects(publishPlan({plan:result.plan,deps:baseDeps(w,github),options:{}}),/names release v0\.1\.0-beta\.7-mac-b62c4715, but it does not exist/);
});
test('--add-arch refuses: both architectures already live, another live version, a build from another commit, nothing to add, an unreadable feed',async t=>{
 const both=await addArchWorld(t,{liveArches:['arm64','x64']});
 assert.match((await planUpdate(both.options,baseDeps(both.w,both.github))).problems.join('\n'),/already offers both Mac architectures/);
 const other=await addArchWorld(t);
 assert.match((await planUpdate({...other.options,version:'0.1.0-beta.8'},baseDeps(other.w,other.github))).problems.join('\n'),/--add-arch adds to the version the live feed offers: beta-mac\.yml offers 0\.1\.0-beta\.7, not 0\.1\.0-beta\.8/);
 const commit=await addArchWorld(t,{commit:'c'.repeat(40)});
 const fromElsewhere=await planUpdate(commit.options,baseDeps(commit.w,commit.github,{inspectMacZip:async({arch})=>({version:VERSION,arch,commit:'c'.repeat(40)})}));
 assert.match(fromElsewhere.problems.join('\n'),/x64 build is from commit cccccccc, but the live 0\.1\.0-beta\.7 is release v0\.1\.0-beta\.7-mac-b62c4715 \(commit b62c4715\)/);
 const nothing=await addArchWorld(t,{localArches:['arm64']});
 assert.match((await planUpdate(nothing.options,baseDeps(nothing.w,nothing.github))).problems.join('\n'),/No x64 update ZIP to add/);
 const standby=await addArchWorld(t);standby.github.state.feed['beta-mac.yml']=JSON.stringify({version:'0.0.0',files:[]});
 assert.match((await planUpdate(standby.options,baseDeps(standby.w,standby.github))).problems.join('\n'),/offers 0\.0\.0, not 0\.1\.0-beta\.7/);
 assert.match((await planUpdate(standby.options,baseDeps(standby.w,standby.github,{fetch:async()=>{throw Error('offline');}}))).problems.join('\n'),/Could not read the live feed beta-mac\.yml/,'adding needs to know what is live, even in a dry run');
 const unsigned=await addArchWorld(t);
 assert.match((await planUpdate(unsigned.options,baseDeps(unsigned.w,unsigned.github,{inspectMacZip:async()=>{throw Error('Gatekeeper (spctl) rejects the app');}}))).problems.join('\n'),/x64-update\.zip: Gatekeeper \(spctl\) rejects the app/);
});

// ---- the command line
test('main(): a dry run prints the plan and writes the review folder; it refuses --publish without confirmation outside a terminal',async t=>{
 const w=await workspace(t),github=fakeGitHub(),review=path.join(w.dir,'review'),lines=[];
 const argv=['--version',VERSION,'--mac-arm64-zip',w.files.arm64.zip,'--mac-x64-zip',w.files.x64.zip,'--mac-arm64-dmg',w.files.arm64.dmg,'--mac-x64-dmg',w.files.x64.dmg,'--notes-file',w.notes,'--review-dir',review];
 const overrides={...baseDeps(w,github),log:line=>lines.push(line),gh:async()=>{throw Error('no gh in a dry run');}};
 assert.equal(await main([...argv,'--rollout','10'],overrides),0);
 const text=lines.join('\n');assert.match(text,/DRY RUN OK\. Nothing was uploaded or changed\. Run the same command with --publish --yes/);assert.match(text,/release v0\.1\.0-beta\.7-mac-b62c4715/);
 assert.match(text,/feed\/beta-mac\.yml\n\s+now: {3}0\.1\.0-beta\.4, offered to every install\n\s+after: 0\.1\.0-beta\.7 \(arm64 \+ x64\), offered to 10% of installs/);assert.match(text,/\+ {3}"stagingPercentage": 10/);assert.match(text,/- {3}"version": "0\.1\.0-beta\.4"|-\s+\{"version":"0\.1\.0-beta\.4"/);
 assert.equal(JSON.parse(await fs.readFile(path.join(review,'feed/beta-mac.yml'),'utf8')).version,VERSION);assert.ok(await fs.stat(path.join(review,'PLAN.json')));
 const refused=[];assert.equal(await main(['--version','0.1.0-beta.6.local.4',...argv.slice(2)],{...overrides,log:line=>refused.push(line)}),1);assert.match(refused.join('\n'),/REFUSED\. Nothing was uploaded or changed\./);
 assert.equal(github.state.releases.size,0);
 const stdin=process.stdin.isTTY;process.stdin.isTTY=false;t.after(()=>{process.stdin.isTTY=stdin;});
 await assert.rejects(main([...argv,'--publish'],{...overrides,gh:github.gh}),/asks for confirmation; run it in a terminal, or add --yes/);
 assert.equal(github.state.releases.size,0);
});
test('main(): --publish --yes acts, and the halt dry run prints the change and what it does to people without changing anything',async t=>{
 const w=await workspace(t),github=fakeGitHub(),lines=[],log=line=>lines.push(line);
 const argv=['--version',VERSION,'--mac-arm64-zip',w.files.arm64.zip,'--mac-x64-zip',w.files.x64.zip,'--notes-file',w.notes,'--review-dir',path.join(w.dir,'review'),'--rollout','20','--no-wait'];
 assert.equal(await main([...argv,'--publish','--yes'],{...baseDeps(w,github),log}),0);
 assert.match(lines.join('\n'),/PUBLISHED\./);assert.equal(feedDoc(github,'beta-mac.yml').stagingPercentage,20);
 lines.length=0;const commits=github.state.commits;
 assert.equal(await main(['--version',VERSION,'--halt','--review-dir',path.join(w.dir,'halt')],{...baseDeps(w,github),log}),0);
 const text=lines.join('\n');
 assert.match(text,/HALT Acira Browser 0\.1\.0-beta\.7 on the beta channel/);assert.match(text,/now: {3}0\.1\.0-beta\.7 \(arm64 \+ x64\), offered to 20% of installs\n\s+after: 0\.1\.0-beta\.7 \(arm64 \+ x64\), halted \(offered to nobody\)/);
 assert.match(text,/- {3}"stagingPercentage": 20/);assert.match(text,/\+ {3}"stagingPercentage": 0/);assert.match(text,/copies that already installed 0\.1\.0-beta\.7 keep it/);assert.match(text,/feed\/beta\.yml offers 0\.0\.0: left alone/);
 assert.equal(github.state.commits,commits,'the dry run changed nothing');
 lines.length=0;assert.equal(await main(['--version',VERSION,'--halt','--publish','--yes','--no-wait','--review-dir',path.join(w.dir,'halt')],{...baseDeps(w,github),log}),0);
 assert.match(lines.join('\n'),/DONE\. feed\/beta-mac\.yml: halted \(offered to nobody\)\./);assert.equal(feedDoc(github,'beta-mac.yml').stagingPercentage,0);
});
test('--stand-in: only a loopback address, gh is never run, and nothing but release downloads and the feed is fetched',async t=>{
 for(const address of ['https://127.0.0.1:1','http://example.org:8080','http://user:pw@127.0.0.1:9','not a url'])assert.throws(()=>standInTransport(address),/local address|needs an address/,address);
 const transport=standInTransport('http://127.0.0.1:9');
 await assert.rejects(transport.fetch('https://api.github.com/repos/x'),/neither a release download nor the feed/);
 await assert.rejects(transport.fetch('https://example.org/'),/nothing else is fetched/);
 // the whole command over HTTP against a served stand-in, with only the Apple checks replaced
 const w=await workspace(t,{windows:true}),model=createStandIn(),server=await serveStandIn(model);t.after(()=>server.close());
 const lines=[],argv=['--version',VERSION,'--mac-arm64-zip',w.files.arm64.zip,'--mac-x64-zip',w.files.x64.zip,'--windows-dir',path.dirname(w.files.windows.exe),'--notes-file',w.notes,'--review-dir',path.join(w.dir,'review'),'--stand-in',server.url,'--publish','--yes','--no-wait'];
 const {inspectMacZip,inspectMacDmg,inspectWindowsInstaller:inspectWin}=baseDeps(w,model);
 assert.equal(await main(argv,{log:line=>lines.push(line),root:w.dir,inspectMacZip,inspectMacDmg,inspectWindowsInstaller:inspectWin,sleep:async()=>{}}),0,lines.join('\n'));
 assert.match(lines.join('\n'),/STAND-IN: every GitHub and feed request goes to http:\/\/127\.0\.0\.1:\d+; nothing reaches GitHub/);
 assert.equal(JSON.parse(model.state.feed['beta-mac.yml']).version,VERSION);assert.equal(JSON.parse(model.state.feed['beta.yml']).version,VERSION);
 assert.equal(model.state.releases.get('v0.1.0-beta.7-windows-b62c4715').assets.get('AciraBrowserSetup.exe').size,1100000,'the setup went up as bytes over HTTP');
});

// ---- review fixes (3 Nov): reruns, previousBlockMaps, explicit files, stable --add-arch, the blockmap's name, halts and unreadable documents
test('fix 1: an --add-arch run that stopped after uploading resumes with a fresh plan: the damaged ZIP is replaced, BUILD-INFO matches, the live release is never deleted',async t=>{
 const {w,github,macTag,options}=await addArchWorld(t),zip=`AciraBrowser-${VERSION}-mac-x64-update.zip`;
 const first=await planUpdate({...options,publish:true},baseDeps(w,github,{now:()=>new Date('2026-11-03T10:00:00.000Z')}));assert.deepEqual(first.problems,[]);
 github.state.corrupt=zip;
 await assert.rejects(publishPlan({plan:first.plan,deps:baseDeps(w,github),options:{}}),error=>{assert.match(error.message,/SHA-512 differs/);assert.ok(!error.recovery.some(line=>/gh release delete/.test(line)));assert.ok(error.recovery.some(line=>/Do not delete that release/.test(line)));return true;});
 assert.equal(github.state.log.filter(line=>line.startsWith('release delete-asset')).length,1,'within the run, one replacement is tried');assert.equal(feedDoc(github,'beta-mac.yml').files.length,1);
 github.state.corrupt=null;github.state.log.length=0;
 const second=await planUpdate({...options,publish:true},baseDeps(w,github,{now:()=>new Date('2026-11-03T11:30:00.000Z')}));
 assert.equal(second.plan.releases[0].assets.find(asset=>asset.name==='BUILD-INFO-x64.json').content,first.plan.releases[0].assets.find(asset=>asset.name==='BUILD-INFO-x64.json').content,'BUILD-INFO depends on the inputs, not the clock');
 await publishPlan({plan:second.plan,deps:baseDeps(w,github),options:{}});
 assert.deepEqual(github.state.log.filter(line=>line.startsWith('release delete-asset')),[`release delete-asset ${macTag} ${zip} --repo`],'only the damaged ZIP is replaced, nothing the live document names');
 assert.ok(!github.state.log.some(line=>/release upload .*BUILD-INFO/.test(line)),'the BUILD-INFO already there is kept: same bytes');
 assert.deepEqual(feedDoc(github,'beta-mac.yml').files.map(file=>U.macArchOf(file.url)),['arm64','x64']);assert.ok(github.state.releases.get(macTag).assets.has(`AciraBrowser-${VERSION}-mac-arm64-update.zip`));
});
test('fix 1: a new release that stopped after publishing resumes with a fresh plan and uploads nothing again; a file of another size is replaced, not "delete the release"',async t=>{
 const {w,github,result,deps}=await plannedMac(t,{windows:true});
 await assert.rejects(publishPlan({plan:result.plan,deps:{...deps,fetch:async url=>url.includes('/releases/download/')?new Response('',{status:404}):github.fetch(url)},options:{}}),/HTTP 404/);
 github.state.log.length=0;
 const again=await planUpdate({...macOptions(w,{'windows-dir':path.dirname(w.files.windows.exe)}),publish:true},baseDeps(w,github,{now:()=>new Date('2026-11-02T09:59:00.000Z')}));
 for(const release of again.plan.releases)assert.doesNotMatch(release.assets.find(asset=>asset.name==='BUILD-INFO.json').content,/2026-11-02T/,'no time in BUILD-INFO');
 await publishPlan({plan:again.plan,deps,options:{}});
 assert.equal(github.state.log.filter(line=>/^release (upload|delete-asset)/.test(line)).length,0,'everything was there with the right bytes');assert.equal(feedDoc(github,'beta-mac.yml').version,VERSION);
 const other=await plannedMac(t);other.github.seedRelease('v0.1.0-beta.7-mac-b62c4715',{isDraft:true,assets:{'SHA256SUMS.txt':Buffer.from('left by an older run')}});
 await publishPlan({plan:other.result.plan,deps:other.deps,options:{}});
 assert.ok(other.github.state.log.includes('release delete-asset v0.1.0-beta.7-mac-b62c4715 SHA256SUMS.txt --repo'));assert.equal(feedDoc(other.github,'beta-mac.yml').version,VERSION);
});
test('fix 1: a file a live channel document names is never replaced, even when it downloads as other bytes',async t=>{
 const {github,result,deps}=await plannedMac(t),zip=result.plan.releases[0].assets.find(asset=>asset.name.endsWith('arm64-update.zip'));
 github.state.feed['latest-mac.yml']=JSON.stringify({version:'0.0.1',files:[{url:zip.url,sha512:zip.sha512,size:zip.size}]});github.state.corrupt=zip.name;
 await assert.rejects(publishPlan({plan:result.plan,deps,options:{}}),error=>{assert.match(error.message,/a live channel document names it, so it is never replaced/);assert.ok(error.recovery.some(line=>/Do not delete that release/.test(line)));return true;});
 assert.ok(!github.state.log.some(line=>line.startsWith('release delete-asset')));assert.ok(!github.state.log.includes('FEED COMMITTED'));
});
test('fix 2: blockmaps are downloaded with retries and a time limit',async()=>{
 let calls=0;const bytes=blockMap(1000);
 assert.deepEqual(await downloadSmall({fetch:async()=>++calls<3?new Response('',{status:503}):new Response(bytes),url:'https://x/a.blockmap',sleep:async()=>{},delays:[1,1,1]}),bytes);assert.equal(calls,3);
 const stalled=(url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted'))));
 await assert.rejects(downloadSmall({fetch:stalled,url:'https://x/a.blockmap',sleep:async()=>{},delays:[1],timeout:20}),/no answer within 0 s \(2 tries\)/);
 await assert.rejects(downloadSmall({fetch:async()=>new Response('',{status:502}),url:'https://x/a.blockmap',sleep:async()=>{},delays:[1,1]}),/HTTP 502 \(3 tries\)/);
});
test('fix 2: a passing 5xx on the live setup\'s blockmap does not lose it; a publish plans previousBlockMaps from the feed repository, and the commit requires that same document',async t=>{
 const w=await workspace(t,{windows:true}),live=liveWorld({version:'0.1.0-beta.6'});let failed=0;
 const flaky=async(url,init)=>url.endsWith('/AciraBrowserSetup.exe.blockmap')&&failed++<1?new Response('',{status:503}):live.github.fetch(url,init);
 const retried=await planUpdate(winOptions(w),baseDeps(w,live.github,{fetch:flaky,delays:[0]}));
 assert.deepEqual(retried.problems,[]);assert.deepEqual(retried.warnings.filter(text=>/previousBlockMaps/.test(text)),[]);assert.equal(JSON.parse(retried.plan.feeds[0].text).previousBlockMaps[0].version,'0.1.0-beta.6');
 // the public copy still shows the document before the live one (a release minutes ago): a dry run plans from it, a publish from the repository
 const stale=async(url,init)=>url.endsWith('/feed/beta.yml')?new Response(JSON.stringify({version:'0.0.0',files:[]})):live.github.fetch(url,init);
 const dry=await planUpdate(winOptions(w),baseDeps(w,live.github,{fetch:stale}));assert.equal(JSON.parse(dry.plan.feeds[0].text).previousBlockMaps,undefined);
 const real=await planUpdate(winOptions(w,{publish:true}),baseDeps(w,live.github,{fetch:stale}));assert.deepEqual(real.problems,[]);assert.equal(JSON.parse(real.plan.feeds[0].text).previousBlockMaps[0].version,'0.1.0-beta.6');
 await assert.rejects(publishPlan({plan:dry.plan,deps:baseDeps(w,live.github),options:{}}),/feed\/beta\.yml is not what this plan was made from \(it offers 0\.1\.0-beta\.6, offered to every install; the plan saw 0\.0\.0/);
 assert.equal(live.github.state.releases.has('v0.1.0-beta.7-windows-b62c4715'),false,'refused before any upload');
 await publishPlan({plan:real.plan,deps:baseDeps(w,live.github),options:{}});assert.equal(feedDoc(live.github,'beta.yml').previousBlockMaps[0].version,'0.1.0-beta.6');
});
test('fix 3: named Mac files are used exactly as given; a folder is searched only when no Mac file is named',async t=>{
 const w=await workspace(t),github=fakeGitHub(),found=path.join(w.dir,'release',`mac-widevine-${VERSION}-aaaaaaaa.noindex`);
 for(const arch of ['arm64','x64']){ // another build of the same version, where discovery looks (release/ under the root)
  const dir=path.join(found,arch+'-other');await fs.mkdir(dir,{recursive:true});const zip=Buffer.from('other '+arch),dmg=Buffer.from('other dmg '+arch);
  await fs.writeFile(path.join(dir,`AciraBrowser-${VERSION}-mac-${arch}-update.zip`),zip);await fs.writeFile(path.join(dir,`AciraBrowser-${VERSION}-mac-${arch}.dmg`),dmg);
  await fs.writeFile(path.join(dir,'mac-widevine-package.json'),JSON.stringify({version:VERSION,commit:'a'.repeat(40),arch,updateZip:{zip:path.join(dir,`AciraBrowser-${VERSION}-mac-${arch}-update.zip`),sha512:sha512(zip),size:zip.length},diskImage:path.join(dir,`AciraBrowser-${VERSION}-mac-${arch}.dmg`),sha256:sha256(dmg),bytes:dmg.length}));
 }
 const named=await planUpdate({version:VERSION,'mac-arm64-zip':w.files.arm64.zip,'mac-x64-zip':w.files.x64.zip,'notes-file':w.notes},baseDeps(w,github));
 assert.deepEqual(named.problems,[]);assert.deepEqual(named.assets.mac.map(asset=>asset.path),[w.files.arm64.zip,w.files.x64.zip],'no DMG and nothing of the other build was added');
 const one=await planUpdate({version:VERSION,'mac-arm64-zip':w.files.arm64.zip,'notes-file':w.notes},baseDeps(w,github));
 assert.match(one.problems.join('\n'),/Only the arm64 Mac update ZIP was found/,'the other architecture is not topped up from the folder');
 const searched=await planUpdate({version:VERSION,'notes-file':w.notes},baseDeps(w,github,{inspectMacZip:async({arch})=>({version:VERSION,arch,commit:'a'.repeat(40)})}));
 assert.deepEqual(searched.problems,[]);assert.deepEqual(searched.assets.mac.map(asset=>path.basename(path.dirname(asset.path))),['arm64-other','arm64-other','x64-other','x64-other'],'with nothing named, release/ is searched');
 assert.throws(()=>parseArguments(['--version',VERSION,'--mac-dir',found,'--mac-x64-zip',w.files.x64.zip]),/Name the Mac files \(--mac-x64-zip\) or give a folder to search \(--mac-dir\), not both/);
});
test('fix 4: --add-arch on stable compares with its own channel: a beta that moved on does not make the live stable version "not newer"',async t=>{
 const w=await workspace(t,{arches:['x64'],version:'0.1.0'}),world=liveWorld({version:'0.1.0',channel:'stable',mac:{arches:['arm64']},extraFeed:{'beta-mac.yml':{version:'0.1.1-beta.1',files:[]}}});
 const result=await planUpdate({version:'0.1.0',channel:'stable','add-arch':true,'mac-x64-zip':w.files.x64.zip},baseDeps(w,world.github));
 assert.deepEqual(result.problems,[]);assert.deepEqual(result.plan.feeds.map(feed=>feed.file),['latest-mac.yml'],'only the document that offers 0.1.0 changes');
 const normal=await planUpdate({version:'0.1.0',channel:'stable','mac-arm64-zip':w.files.x64.zip.replace('x64','arm64'),'mac-x64-zip':w.files.x64.zip,'allow-single-arch':true},baseDeps(w,world.github));
 assert.match(normal.problems.join('\n'),/not newer than 0\.1\.1-beta\.1 \(the live feed beta-mac\.yml\)/,'a new stable release still may not take beta-mac.yml backwards');
});
test('fix 5: a --windows-blockmap under another name is refused (installed copies look for <setup>.blockmap)',async t=>{
 const w=await workspace(t,{windows:true}),github=fakeGitHub(),renamed=path.join(path.dirname(w.files.windows.exe),'setup.blockmap');
 await fs.rename(w.files.windows.blockmap,renamed);
 const result=await planUpdate(winOptions(w,{'windows-blockmap':renamed}),baseDeps(w,github));
 assert.equal(result.ok,false);assert.match(result.problems.join('\n'),/The blockmap must be named AciraBrowserSetup\.exe\.blockmap .* not setup\.blockmap/);
 await fs.rename(renamed,w.files.windows.blockmap);assert.equal((await planUpdate(winOptions(w,{'windows-blockmap':w.files.windows.blockmap}),baseDeps(w,github))).ok,true);
});
test('fix 6: a halt is planned from the documents that offer the version: an unreadable unrelated one is named, not a reason to refuse; --publish plans from the feed repository',async t=>{
 const {github,macDoc}=liveWorld({mac:{extra:{stagingPercentage:20}}});
 const partly=async(url,init)=>url.endsWith('/feed/beta.yml')?new Response('',{status:500}):github.fetch(url,init);
 const result=await planFeedChange({version:VERSION,halt:true},editDeps(github,{fetch:partly}));
 assert.deepEqual(result.problems,[]);assert.deepEqual(result.plan.feeds.map(feed=>feed.file),['beta-mac.yml']);
 assert.match(result.warnings.join('\n'),/Could not read the live feed beta\.yml \(HTTP 500\): it is left as it is\. If it offers 0\.1\.0-beta\.7 too, run this again once it can be read\. --platform mac or --platform windows changes one platform only\./);
 // the public copy says 20% while the repository already says 50%: a publish plans (and records) from 50%
 github.state.feed['beta-mac.yml']=JSON.stringify({...macDoc,stagingPercentage:50},null,2)+'\n';
 const stale=async(url,init)=>url.endsWith('/feed/beta-mac.yml')?new Response(JSON.stringify({...macDoc,stagingPercentage:20})):github.fetch(url,init);
 const real=await planFeedChange({version:VERSION,halt:true,publish:true,platform:'mac'},editDeps(github,{fetch:stale}));
 assert.deepEqual(JSON.parse(real.plan.feeds[0].text).halted.percentage,50);
 await publishPlan({plan:real.plan,deps:editDeps(github),options:{}});assert.equal(feedDoc(github,'beta-mac.yml').stagingPercentage,0);assert.equal(feedDoc(github,'beta-mac.yml').halted.percentage,50);
 assert.match((await planFeedChange({version:VERSION,halt:true,publish:true},editDeps(github,{gh:async()=>{throw Error('gh: not logged in');}}))).problems.join('\n'),/Could not read beta-mac\.yml \(.*not logged in\).*--platform mac or --platform windows/);
});
