// scripts/publish-update.mjs end to end against a fake GitHub (no network, no gh, no Apple tools): what it refuses, what a dry run writes, and above all
// that the channel documents are committed LAST, only after every payload was published and downloaded back with the right hash.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {parseArguments,planUpdate,publishPlan,commitFeed,verifyDownload,inspectWindowsInstaller,main} from '../scripts/publish-update.mjs';
const require=createRequire(import.meta.url),U=require('../packaging/update-publish.cjs');
const REPO='Acira-dev/AciraBrowserUpdates',COMMIT='b62c4715130a8f17182dced8e94e7fc56425c4c7',VERSION='0.1.0-beta.7';
const sha512=bytes=>createHash('sha512').update(bytes).digest('base64');

/** In-memory GitHub: just the gh and anonymous-download behaviour the publisher uses, with failure switches. */
function fakeGitHub({feed={'beta-mac.yml':'0.1.0-beta.4','beta.yml':'0.0.0','latest-mac.yml':'0.0.0','latest.yml':'0.0.0'}}={}){
 const state={releases:new Map(),feed:Object.fromEntries(Object.entries(feed).map(([file,version])=>[file,JSON.stringify({version,files:[]})])),head:'head0',log:[],pendingTree:null,commits:0,failUpload:null,corrupt:null,moveMainDuringPublish:false,isPrivate:false};
 const notFound=message=>Object.assign(Error(message),{stderr:message});
 const find=args=>{const release=state.releases.get(args[2]);if(!release)throw notFound('release not found');return release;};
 const gh=async(args,{input}={})=>{
  state.log.push(args.slice(0,5).join(' '));
  const [command,...rest]=args;
  if(command==='release'){
   const [sub]=rest;
   if(sub==='view'){const release=find(args);return JSON.stringify({tagName:rest[1],isDraft:release.isDraft,assets:[...release.assets].map(([name,asset])=>({name,size:asset.size}))});}
   if(sub==='create'){const tag=rest[1];state.releases.set(tag,{isDraft:true,prerelease:rest.includes('--prerelease'),assets:new Map(),notes:await fs.readFile(rest[rest.indexOf('--notes-file')+1],'utf8')});return '';}
   if(sub==='upload'){const release=find(['release',...rest]),file=rest[2];const name=path.basename(file);/* like the real gh: the asset is named after the file */if(state.failUpload===name)throw notFound('upload failed: '+name);const bytes=await fs.readFile(file);release.assets.set(name,{size:bytes.length,bytes:state.corrupt===name?Buffer.from(bytes.map((byte,index)=>index===0?byte^0xff:byte)):bytes});return '';}
   if(sub==='edit'){const release=find(['release',...rest]);if(rest.includes('--draft=false'))release.isDraft=false;return '';}
  }
  if(command==='api'){
   const method=rest.includes('-X')?rest[rest.indexOf('-X')+1]:'GET',endpoint=rest.find(item=>item.startsWith('repos/'));
   if(endpoint===`repos/${REPO}`)return JSON.stringify({private:state.isPrivate,default_branch:'main',permissions:{push:true}});
   if(endpoint.startsWith(`repos/${REPO}/contents/feed/`)){const file=endpoint.split('/feed/')[1].split('?')[0];if(!state.feed[file])throw notFound('HTTP 404');return JSON.stringify({content:Buffer.from(state.feed[file]).toString('base64')});}
   if(endpoint.endsWith('/git/ref/heads/main'))return JSON.stringify({object:{sha:state.head}});
   if(/\/git\/commits\/[^/]+$/.test(endpoint)&&method==='GET')return JSON.stringify({tree:{sha:'tree-of-'+state.head}});
   if(endpoint.endsWith('/git/trees')){state.pendingTree=JSON.parse(input);return JSON.stringify({sha:'newtree'});}
   if(endpoint.endsWith('/git/commits')){state.commits++;state.commitBody=JSON.parse(input);return JSON.stringify({sha:'commit'+state.commits});}
   if(endpoint.endsWith('/git/refs/heads/main')){
    if(state.moveMainDuringPublish)throw notFound('Update is not a fast forward (HTTP 422)');
    assert.equal(JSON.parse(input).force,false,'the feed is never force-pushed');
    for(const entry of state.pendingTree.tree)state.feed[entry.path.replace(/^feed\//,'')]=entry.content;
    state.head='commit'+state.commits;state.log.push('FEED COMMITTED');return '{}';
   }
  }
  throw Error('fake gh: unexpected '+args.join(' '));
 };
 // anonymous reads: published releases only (a draft is invisible), and the public feed
 const fetch=async(url)=>{
  const download=/^https:\/\/github\.com\/Acira-dev\/AciraBrowserUpdates\/releases\/download\/([^/]+)\/(.+)$/.exec(url);
  if(download){const release=state.releases.get(download[1]),asset=release&&!release.isDraft&&release.assets.get(download[2]);state.log.push('DOWNLOAD '+download[2]);return asset?new Response(asset.bytes):new Response('not found',{status:404});}
  const raw=/^https:\/\/raw\.githubusercontent\.com\/Acira-dev\/AciraBrowserUpdates\/main\/feed\/(.+)$/.exec(url);
  if(raw)return state.feed[raw[1]]?new Response(state.feed[raw[1]]):new Response('',{status:404});
  throw Error('fake fetch: unexpected '+url);
 };
 return {state,gh,fetch};
}

async function workspace(t,{windows=false}={}){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'acira-publish-script-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const files={};
 for(const arch of ['arm64','x64']){
  await fs.mkdir(path.join(dir,arch));
  files[arch]={zip:path.join(dir,arch,`AciraBrowser-${VERSION}-mac-${arch}-update.zip`),dmg:path.join(dir,arch,`AciraBrowser-${VERSION}-mac-${arch}.dmg`)};
  await fs.writeFile(files[arch].zip,'zip of the '+arch+' app');await fs.writeFile(files[arch].dmg,'disk image for '+arch);
 }
 const notes=path.join(dir,'notes.md');await fs.writeFile(notes,'- Faster tabs\n- Sidebar fix\n');
 if(windows){
  await fs.mkdir(path.join(dir,'win'));const exe=Buffer.alloc(1100000,7);exe.write('MZ');
  files.windows={exe:path.join(dir,'win/AciraBrowserSetup.exe'),blockmap:path.join(dir,'win/AciraBrowserSetup.exe.blockmap'),latest:path.join(dir,'win/latest.yml')};
  await fs.writeFile(files.windows.exe,exe);await fs.writeFile(files.windows.blockmap,'blockmap');
  await fs.writeFile(files.windows.latest,JSON.stringify({version:VERSION,files:[{url:'AciraBrowserSetup.exe',sha512:sha512(exe),size:exe.length}],path:'AciraBrowserSetup.exe',sha512:sha512(exe),releaseDate:'2026-11-02T00:00:00.000Z'}));
  await fs.writeFile(path.join(dir,'win/WINDOWS-BUILD-RESULT.json'),JSON.stringify({version:VERSION,commit:COMMIT}));
 }
 return {dir,files,notes};
}
const macOptions=(w,extra={})=>({version:VERSION,channel:'beta','mac-arm64-zip':w.files.arm64.zip,'mac-x64-zip':w.files.x64.zip,'mac-arm64-dmg':w.files.arm64.dmg,'mac-x64-dmg':w.files.x64.dmg,'notes-file':w.notes,...extra});
const baseDeps=(w,github,over={})=>({
 root:w.dir,fetch:github.fetch,gh:github.gh,log:()=>{},now:()=>new Date('2026-11-02T04:00:00.000Z'),sleep:async()=>{},delays:[],
 inspectMacZip:async({zip,arch})=>({zip:path.basename(zip),version:VERSION,arch,commit:COMMIT,identity:'Developer ID Application: Khaled Kaed Beyh (2MGLP3QV9X)',stapled:true,gatekeeper:'Notarized Developer ID'}),
 inspectMacDmg:async({dmg})=>({dmg:path.basename(dmg),stapled:true,gatekeeper:'Notarized Developer ID'}),
 inspectWindowsInstaller:async()=>({updateConfig:true,source:'test'}),...over});

test('options: flags and values are told apart, unknown ones are refused',()=>{
 const options=parseArguments(['--version','0.1.0-beta.7','--publish','--channel','beta','--notes-file','n.md','--rehearsal']);
 assert.deepEqual(options,{version:'0.1.0-beta.7',publish:true,channel:'beta','notes-file':'n.md',rehearsal:true});
 assert.throws(()=>parseArguments(['--versoin','1']),/Unknown option/);assert.throws(()=>parseArguments(['--version']),/needs a value/);assert.throws(()=>parseArguments(['--version','--publish']),/needs a value/);assert.throws(()=>parseArguments(['stray']),/Unexpected argument/);
});
test('a good Mac release plans two payload archives, two disk images, checksums, and one channel document with absolute URLs and the real hashes',async t=>{
 const w=await workspace(t),github=fakeGitHub(),result=await planUpdate(macOptions(w),baseDeps(w,github));
 assert.deepEqual(result.problems,[]);assert.equal(result.ok,true);
 const [release]=result.plan.releases;assert.equal(result.plan.releases.length,1);
 assert.equal(release.tag,'v0.1.0-beta.7-mac-b62c4715');assert.equal(release.prerelease,true);
 assert.deepEqual(release.assets.map(asset=>asset.name).sort(),[`AciraBrowser-${VERSION}-mac-arm64-update.zip`,`AciraBrowser-${VERSION}-mac-arm64.dmg`,`AciraBrowser-${VERSION}-mac-x64-update.zip`,`AciraBrowser-${VERSION}-mac-x64.dmg`,'BUILD-INFO.json','SHA256SUMS.txt'].sort());
 assert.deepEqual(result.plan.feeds.map(feed=>feed.file),['beta-mac.yml']);
 const doc=JSON.parse(result.plan.feeds[0].text);assert.equal(doc.version,VERSION);
 for(const file of doc.files){const name=file.url.split('/').pop(),bytes=await fs.readFile(path.join(w.dir,name.includes('arm64')?'arm64':'x64',name));assert.equal(file.sha512,sha512(bytes));assert.equal(file.size,bytes.length);assert.ok(file.url.startsWith('https://github.com/'+REPO+'/releases/download/v0.1.0-beta.7-mac-b62c4715/'));}
 assert.match(doc.releaseNotes,/Faster tabs/);assert.equal(doc.releaseDate,'2026-11-02T04:00:00.000Z');
 const sums=release.assets.find(asset=>asset.name==='SHA256SUMS.txt').content;assert.match(sums,new RegExp(`${createHash('sha256').update('zip of the arm64 app').digest('hex')}  AciraBrowser-${VERSION}-mac-arm64-update\\.zip`));
 assert.match(release.body,/What's new/);
});
test('the dry run never calls gh: reading the public feed is the only network it does',async t=>{
 const w=await workspace(t),github=fakeGitHub();
 await planUpdate(macOptions(w),baseDeps(w,github,{gh:async()=>{throw Error('a dry run must not use gh');}}));
 assert.deepEqual(github.state.log.filter(line=>!line.startsWith('DOWNLOAD')),[]);assert.equal(github.state.releases.size,0);
});
test('refusals: not newer than the live feed or a shipped build, a local version, a version that does not match the files, a single architecture',async t=>{
 const w=await workspace(t);
 const feedAhead=fakeGitHub({feed:{'beta-mac.yml':'0.1.0-beta.9','beta.yml':'0.0.0'}});
 assert.match((await planUpdate(macOptions(w),baseDeps(w,feedAhead))).problems.join('\n'),/not newer than 0\.1\.0-beta\.9 \(the live feed beta-mac\.yml\)/);
 const github=fakeGitHub();
 for(const version of ['0.1.0-beta.6.local.4','0.1.0-beta.6','0.1.0-beta.5']){
  const result=await planUpdate(macOptions(w,{version}),baseDeps(w,github));assert.equal(result.ok,false,version);assert.match(result.problems.join('\n'),/not newer than|not a release version/,version);
 }
 assert.match((await planUpdate(macOptions(w,{version:'0.1.0-beta.8'}),baseDeps(w,github))).problems.join('\n'),/is version 0\.1\.0-beta\.7, not 0\.1\.0-beta\.8/,'file names must carry the release version');
 const wrongInside=await planUpdate(macOptions(w),baseDeps(w,github,{inspectMacZip:async()=>{throw Error('The app inside carries version 0.1.0-beta.6.local.4, not '+VERSION+'.');}}));
 assert.match(wrongInside.problems.join('\n'),/The app inside carries version 0\.1\.0-beta\.6\.local\.4/);
 const single=await planUpdate(macOptions(w,{'mac-x64-zip':undefined,'mac-x64-dmg':undefined}),baseDeps(w,github));
 assert.match(single.problems.join('\n'),/Only the arm64 Mac update ZIP/);
 assert.equal((await planUpdate(macOptions(w,{'mac-x64-zip':undefined,'mac-x64-dmg':undefined,'allow-single-arch':true}),baseDeps(w,github))).ok,true);
 const stable=await planUpdate(macOptions(w,{channel:'stable'}),baseDeps(w,github));assert.match(stable.problems.join('\n'),/use --channel beta/);
});
test('refusals: a ZIP or disk image that fails the signature, staple or Gatekeeper check stops everything',async t=>{
 const w=await workspace(t),github=fakeGitHub();
 const zip=await planUpdate(macOptions(w),baseDeps(w,github,{inspectMacZip:async({arch})=>{if(arch==='x64')throw Error('The notarization ticket is not stapled to the app');return {version:VERSION,arch,commit:COMMIT};}}));
 assert.equal(zip.ok,false);assert.match(zip.problems.join('\n'),/x64-update\.zip: The notarization ticket is not stapled/);
 const dmg=await planUpdate(macOptions(w),baseDeps(w,github,{inspectMacDmg:async()=>{throw Error('Gatekeeper rejects the disk image');}}));assert.match(dmg.problems.join('\n'),/dmg: Gatekeeper rejects/);
 const split=await planUpdate(macOptions(w),baseDeps(w,github,{inspectMacZip:async({arch})=>({version:VERSION,arch,commit:arch==='x64'?'a'.repeat(40):COMMIT})}));assert.match(split.problems.join('\n'),/different commits/);
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
 assert.match((await planUpdate(macOptions(w,{publish:true}),baseDeps(w,offline))).problems.join('\n'),/Could not read the live feed/);
});
test('Windows: a setup that carries its feed gets a beta.yml entry; one that cannot self-update is published for download only, never into the feed',async t=>{
 const w=await workspace(t,{windows:true}),github=fakeGitHub(),options={...macOptions(w),'windows-dir':path.dirname(w.files.windows.exe)};
 const good=await planUpdate(options,baseDeps(w,github));assert.deepEqual(good.problems,[]);
 assert.deepEqual(good.plan.releases.map(release=>release.tag),['v0.1.0-beta.7-mac-b62c4715','v0.1.0-beta.7-windows-b62c4715']);
 assert.deepEqual(good.plan.feeds.map(feed=>feed.file),['beta-mac.yml','beta.yml']);
 const windows=good.plan.releases[1];assert.deepEqual(windows.assets.map(asset=>asset.name).sort(),['AciraBrowserSetup.exe','AciraBrowserSetup.exe.blockmap','BUILD-INFO.json','SHA256SUMS.txt']);
 const feed=JSON.parse(good.plan.feeds[1].text);assert.equal(feed.files[0].url,`https://github.com/${REPO}/releases/download/v0.1.0-beta.7-windows-b62c4715/AciraBrowserSetup.exe`);
 assert.equal(feed.previousBlockMaps,undefined,'the live beta.yml names no setup yet: no earlier blockmaps');
 github.state.feed['beta.yml']=JSON.stringify({version:'0.1.0-beta.6',files:[{url:`https://github.com/${REPO}/releases/download/v0.1.0-beta.6-windows-aaaaaaaa/AciraBrowserSetup-0.1.0-beta.6.exe`,sha512:'x',size:1}]});
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
 await fs.rm(w.files.windows.latest);await fs.rm(path.join(path.dirname(w.files.windows.exe),'WINDOWS-BUILD-RESULT.json'));
 assert.match((await planUpdate(options,baseDeps(w,github))).problems.join('\n'),/Nothing says which version/);
});
test('Windows setup inspection: the build record decides when it exists, and a file that is not an executable is refused',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'acira-win-inspect-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const exe=path.join(dir,'AciraBrowserSetup.exe');await fs.writeFile(exe,'MZ....');
 assert.deepEqual(await inspectWindowsInstaller({exe,evidence:[{source:'ACIRA-INSTALLER-PROVENANCE.json',updateConfig:{url:U.RAW_FEED_BASE}}]}),{updateConfig:true,source:'ACIRA-INSTALLER-PROVENANCE.json'});
 assert.equal((await inspectWindowsInstaller({exe,evidence:[{source:'x',updateConfig:{url:'https://elsewhere.example/'}}]})).updateConfig,false);
 await fs.writeFile(exe,'PK....');await assert.rejects(inspectWindowsInstaller({exe,evidence:[]}),/not a Windows executable/);
});

async function plannedMac(t,over={}){
 const w=await workspace(t,over.windows?{windows:true}:{}),github=fakeGitHub(over.github),options=macOptions(w,over.windows?{'windows-dir':path.dirname(w.files.windows.exe)}:{});
 const result=await planUpdate({...options,publish:true},baseDeps(w,github));assert.deepEqual(result.problems,[]);
 return {w,github,result,deps:baseDeps(w,github,{gh:github.gh})};
}
test('publishing: releases are made public and downloaded back anonymously BEFORE the channel documents are committed, in one commit, and the documents then say the new version',async t=>{
 const {github,result,deps}=await plannedMac(t,{windows:true});
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
 assert.equal(JSON.parse(github.state.feed['beta-mac.yml']).version,VERSION);assert.equal(JSON.parse(github.state.feed['beta.yml']).version,VERSION);
 assert.equal(JSON.parse(github.state.feed['latest-mac.yml']).version,'0.0.0','the stable documents are not touched by a beta release');
 assert.deepEqual(github.state.pendingTree.tree.map(entry=>entry.path),['feed/beta-mac.yml','feed/beta.yml']);
 assert.match(github.state.commitBody.message,/Feed: Acira Browser 0\.1\.0-beta\.7 \(beta, mac \+ windows\)/);
});
test('safe stop: an upload that fails leaves the feed untouched and says how to clean up',async t=>{
 const {github,result,deps}=await plannedMac(t);github.state.failUpload=`AciraBrowser-${VERSION}-mac-x64-update.zip`;
 await assert.rejects(publishPlan({plan:result.plan,deps,options:{}}),error=>{
  assert.match(error.message,/upload failed/);assert.ok(error.recovery.some(line=>/NOT touched/.test(line)));assert.ok(error.recovery.some(line=>/gh release delete v0\.1\.0-beta\.7-mac-b62c4715/.test(line)));return true;
 });
 assert.ok(!github.state.log.includes('FEED COMMITTED'));assert.equal(JSON.parse(github.state.feed['beta-mac.yml']).version,'0.1.0-beta.4');
 assert.equal(github.state.releases.get('v0.1.0-beta.7-mac-b62c4715').isDraft,true,'a half-uploaded release stays a draft, invisible to the website');
});
test('safe stop: a payload that downloads differently from what was uploaded leaves the feed untouched',async t=>{
 const {github,result,deps}=await plannedMac(t);github.state.corrupt=`AciraBrowser-${VERSION}-mac-arm64-update.zip`;
 await assert.rejects(publishPlan({plan:result.plan,deps,options:{}}),/SHA-512 differs|bytes/);
 assert.ok(!github.state.log.includes('FEED COMMITTED'));assert.equal(JSON.parse(github.state.feed['beta-mac.yml']).version,'0.1.0-beta.4');
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
 assert.equal(JSON.parse(moved.github.state.feed['beta-mac.yml']).version,'0.1.0-beta.4');
});
test('resuming: running again reuses a release that is already there and uploads only what is missing',async t=>{
 const {github,result,deps}=await plannedMac(t);github.state.failUpload=`AciraBrowser-${VERSION}-mac-x64.dmg`;
 await assert.rejects(publishPlan({plan:result.plan,deps,options:{}}),/upload failed/);
 const uploadedBefore=[...github.state.releases.get('v0.1.0-beta.7-mac-b62c4715').assets.keys()];assert.ok(uploadedBefore.length>0&&uploadedBefore.length<6);
 github.state.failUpload=null;github.state.log.length=0;
 await publishPlan({plan:result.plan,deps,options:{}});
 const uploads=github.state.log.filter(line=>line.startsWith('release upload')).length;assert.equal(uploads,6-uploadedBefore.length,'only the missing files were uploaded');
 assert.equal(JSON.parse(github.state.feed['beta-mac.yml']).version,VERSION);
 // and running a third time after success is harmless apart from the feed check: the feed already offers this version, so it refuses to "update" it
 await assert.rejects(publishPlan({plan:result.plan,deps,options:{}}),/already offers 0\.1\.0-beta\.7/);
});
test('commitFeed builds one fast-forward commit on main from the current head',async()=>{
 const github=fakeGitHub();const sha=await commitFeed({gh:github.gh,repo:REPO,files:[{file:'beta-mac.yml',text:'{"version":"1"}\n'}],message:'m'});
 assert.equal(sha,'commit1');assert.equal(github.state.pendingTree.base_tree,'tree-of-head0');assert.equal(github.state.commitBody.parents[0],'head0');assert.equal(github.state.feed['beta-mac.yml'],'{"version":"1"}\n');
});
test('anonymous verification compares size and SHA-512 and retries a not-yet-served asset',async()=>{
 const bytes=Buffer.from('payload'),good={sha512:sha512(bytes),size:bytes.length};let calls=0;
 const flaky=async()=>{calls++;return calls<3?new Response('',{status:404}):new Response(bytes);};
 assert.equal(await verifyDownload({fetch:flaky,url:'https://x/a',...good,sleep:async()=>{},delays:[1,1,1]}),true);assert.equal(calls,3);
 await assert.rejects(verifyDownload({fetch:async()=>new Response(Buffer.from('other!!')),url:'https://x/a',...good,sleep:async()=>{},delays:[]}),/SHA-512 differs/);
 await assert.rejects(verifyDownload({fetch:async()=>new Response(Buffer.from('short')),url:'https://x/a',...good,sleep:async()=>{},delays:[]}),/downloaded 5 bytes/);
});
test('main(): a dry run prints the plan and writes the review folder; it refuses --publish without confirmation outside a terminal',async t=>{
 const w=await workspace(t),github=fakeGitHub(),review=path.join(w.dir,'review'),lines=[];
 const argv=['--version',VERSION,'--mac-arm64-zip',w.files.arm64.zip,'--mac-x64-zip',w.files.x64.zip,'--mac-arm64-dmg',w.files.arm64.dmg,'--mac-x64-dmg',w.files.x64.dmg,'--notes-file',w.notes,'--review-dir',review];
 const overrides={...baseDeps(w,github),log:line=>lines.push(line),gh:async()=>{throw Error('no gh in a dry run');}};
 assert.equal(await main(argv,overrides),0);
 const text=lines.join('\n');assert.match(text,/DRY RUN OK\. Nothing was uploaded or changed\./);assert.match(text,/release v0\.1\.0-beta\.7-mac-b62c4715/);assert.match(text,/feed\/beta-mac\.yml {2}-> {2}0\.1\.0-beta\.7/);
 assert.equal(JSON.parse(await fs.readFile(path.join(review,'feed/beta-mac.yml'),'utf8')).version,VERSION);assert.ok(await fs.stat(path.join(review,'PLAN.json')));
 const refused=[];assert.equal(await main(['--version','0.1.0-beta.6.local.4',...argv.slice(2)],{...overrides,log:line=>refused.push(line)}),1);assert.match(refused.join('\n'),/REFUSED\. Nothing was uploaded or changed\./);
 assert.equal(github.state.releases.size,0);
});
