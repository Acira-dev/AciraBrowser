// --mirror-base (beta.13.2): the publisher names a second host for every file the feed hands out (files[].mirrors) and refuses to publish when that host's copy differs from the
// file being published, or is not there. Without the option nothing changes. Everything here is local: the stand-in for GitHub, and a stand-in mirror.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {parseArguments,checkMirrorBase,planUpdate,publishPlan,mirrorCheck,withMirrors,main} from '../scripts/publish-update.mjs';
import {createStandIn} from '../qa/publish-stand-in.mjs';
const require=createRequire(import.meta.url),U=require('../packaging/update-publish.cjs');
const COMMIT='b62c4715130a8f17182dced8e94e7fc56425c4c7',VERSION='0.1.0-beta.7',MIRROR='https://downloads.example.net/acira/';
const sha512=bytes=>createHash('sha512').update(bytes).digest('base64'),sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const blockMap=size=>zlib.gzipSync(JSON.stringify({version:'2',files:[{name:'file',offset:0,checksums:['AAAA','BBBB'],sizes:[size-100,100]}]}));

async function workspace(t){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'acira-publish-mirror-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const files={};
 for(const arch of ['arm64','x64']){
  await fs.mkdir(path.join(dir,arch));
  files[arch]={zip:path.join(dir,arch,`AciraBrowser-${VERSION}-mac-${arch}-update.zip`),dmg:path.join(dir,arch,`AciraBrowser-${VERSION}-mac-${arch}.dmg`),receipt:path.join(dir,arch,'mac-widevine-package.json')};
  const zip=Buffer.from('zip of the '+arch+' app'),dmg=Buffer.from('disk image for '+arch);
  await fs.writeFile(files[arch].zip,zip);await fs.writeFile(files[arch].dmg,dmg);
  await fs.writeFile(files[arch].receipt,JSON.stringify({version:VERSION,commit:COMMIT,arch,updateZip:{zip:files[arch].zip,arch,sha512:sha512(zip),size:zip.length},diskImage:files[arch].dmg,sha256:sha256(dmg),bytes:dmg.length}));
 }
 const notes=path.join(dir,'notes.md');await fs.writeFile(notes,'- Faster tabs\n');
 await fs.mkdir(path.join(dir,'win'));const exe=Buffer.alloc(1100000,7);exe.write('MZ');
 files.windows={exe:path.join(dir,'win/AciraBrowserSetup.exe'),blockmap:path.join(dir,'win/AciraBrowserSetup.exe.blockmap'),latest:path.join(dir,'win/latest.yml'),record:path.join(dir,'win/WINDOWS-BUILD-RESULT.json')};
 await fs.writeFile(files.windows.exe,exe);await fs.writeFile(files.windows.blockmap,blockMap(exe.length));
 await fs.writeFile(files.windows.latest,JSON.stringify({version:VERSION,files:[{url:'AciraBrowserSetup.exe',sha512:sha512(exe),size:exe.length}],path:'AciraBrowserSetup.exe',sha512:sha512(exe),releaseDate:'2026-11-02T00:00:00.000Z'}));
 await fs.writeFile(files.windows.record,JSON.stringify({version:VERSION,commit:COMMIT,installer:{file:'AciraBrowserSetup.exe',sha256:sha256(exe),bytes:exe.length}}));
 return {dir,files,notes};
}
const options=(w,extra={})=>({version:VERSION,channel:'beta','mac-arm64-zip':w.files.arm64.zip,'mac-x64-zip':w.files.x64.zip,'mac-arm64-dmg':w.files.arm64.dmg,'mac-x64-dmg':w.files.x64.dmg,'windows-dir':path.dirname(w.files.windows.exe),'notes-file':w.notes,...extra});
const depsFor=(w,github,over={})=>({
 root:w.dir,fetch:github.fetch,gh:github.gh,log:()=>{},now:()=>new Date('2026-11-02T04:00:00.000Z'),sleep:async()=>{},delays:[],compat:false,
 inspectMacZip:async({zip,arch})=>({zip:path.basename(zip),version:VERSION,arch,commit:COMMIT,identity:'Developer ID Application: Khaled Kaed Beyh (2MGLP3QV9X)',stapled:true,gatekeeper:'Notarized Developer ID'}),
 inspectMacDmg:async({dmg})=>({dmg:path.basename(dmg),stapled:true,gatekeeper:'Notarized Developer ID'}),
 inspectWindowsInstaller:async()=>({updateConfig:true,source:'test'}),...over});
/** GitHub's stand-in plus a mirror: requests under MIRROR are answered from `held` (url -> bytes; a missing url is a 404), everything else by the stand-in. */
function world(){
 const github=createStandIn({}),held=new Map(),asked=[];
 const fetch=async(url,init)=>{
  if(String(url).startsWith(MIRROR)){asked.push(String(url));const bytes=held.get(String(url));return bytes?new Response(bytes,{status:200}):new Response('',{status:404});}
  return github.fetch(url,init);
 };
 return {github,held,asked,fetch};
}
/** Puts on the mirror exactly the files a plan says must be there (the founder's upload, done by hand). */
async function uploadAll(plan,held,{except=[],alter=[]}={}){
 for(const file of plan.mirror.files){
  if(except.includes(file.name))continue;
  let bytes=await fs.readFile(file.path);if(alter.includes(file.name)){bytes=Buffer.from(bytes);bytes[0]^=255;}
  held.set(file.url,bytes);
 }
}
const planned=async(t,{mirror=MIRROR}={})=>{
 const w=await workspace(t),state=world(),opts=options(w,mirror?{'mirror-base':mirror}:{});
 const result=await planUpdate({...opts,publish:true},depsFor(w,state.github,{fetch:state.fetch,gh:state.github.gh}));
 assert.deepEqual(result.problems,[]);
 return {w,...state,result,deps:depsFor(w,state.github,{fetch:state.fetch,gh:state.github.gh})};
};

test('--mirror-base: an https folder address on a host that is not GitHub or the update host; only with a new version or --add-arch',()=>{
 assert.equal(parseArguments(['--version','1','--mirror-base','https://downloads.example.net/acira'])['mirror-base'],MIRROR,'a trailing slash is added');
 assert.equal(checkMirrorBase('http://127.0.0.1:8123/m'),'http://127.0.0.1:8123/m/','plain http to this computer is fine for tests');
 for(const bad of ['http://downloads.example.net/','ftp://x/','nonsense','https://user:pass@downloads.example.net/','https://downloads.example.net/?token=1','https://downloads.example.net/#x',
  'https://github.com/Acira-dev/x/','https://raw.githubusercontent.com/Acira-dev/x/','https://acira-dev.github.io/x/','https://update.acirabrowser.com/mirror/'])
  assert.throws(()=>checkMirrorBase(bad),/--mirror-base/,bad);
 assert.throws(()=>checkMirrorBase('https://update.acirabrowser.com/'),/same outage/);
 assert.throws(()=>parseArguments(['--version','1','--widen','50','--mirror-base',MIRROR]),/changes the live documents only/);
 assert.throws(()=>parseArguments(['--version','1','--halt','--mirror-base',MIRROR]),/changes the live documents only/);
 assert.doesNotThrow(()=>parseArguments(['--version','1','--add-arch','--mirror-base',MIRROR]));
 assert.throws(()=>parseArguments(['--version','1','--mirror-base']),/needs a value/);
});

test('without --mirror-base the documents are exactly what they were: no mirrors key, no mirror in the plan',async t=>{
 const {result}=await planned(t,{mirror:null});
 assert.equal(result.plan.mirror,undefined);
 for(const feed of result.plan.feeds)assert.ok(!/mirrors/.test(feed.text),feed.file);
});

test('with --mirror-base every file a document hands out names its copy: <base>/<release tag>/<file name>, the setup\'s blockmap is listed as optional, the rest of the document is unchanged',async t=>{
 const {result}=await planned(t);
 const plain=await planned(t,{mirror:null}),tagMac=`v${VERSION}-mac-b62c4715`,tagWin=`v${VERSION}-windows-b62c4715`;
 const mac=JSON.parse(result.plan.feeds.find(feed=>feed.file==='beta-mac.yml').text),win=JSON.parse(result.plan.feeds.find(feed=>feed.file==='beta.yml').text);
 assert.deepEqual(mac.files.map(file=>file.mirrors),[
  [MIRROR+tagMac+'/AciraBrowser-'+VERSION+'-mac-arm64-update.zip'],[MIRROR+tagMac+'/AciraBrowser-'+VERSION+'-mac-x64-update.zip']]);
 assert.deepEqual(win.files[0].mirrors,[MIRROR+tagWin+'/AciraBrowserSetup.exe']);
 const names=result.plan.mirror.files.map(file=>[file.name,file.optional]);
 assert.deepEqual(names,[[`AciraBrowser-${VERSION}-mac-arm64-update.zip`,false],[`AciraBrowser-${VERSION}-mac-x64-update.zip`,false],['AciraBrowserSetup.exe',false],['AciraBrowserSetup.exe.blockmap',true]]);
 // nothing else in the documents changed
 const strip=doc=>({...doc,files:doc.files.map(({mirrors,...rest})=>rest)});
 assert.deepEqual(strip(win),JSON.parse(plain.result.plan.feeds.find(feed=>feed.file==='beta.yml').text));
 assert.deepEqual(strip(mac),JSON.parse(plain.result.plan.feeds.find(feed=>feed.file==='beta-mac.yml').text));
 // and electron-updater, reading the document the way an installed copy does, still sees the file and keeps the mirror list on it
 const read=U.readWithUpdater(result.plan.feeds.find(feed=>feed.file==='beta.yml').text,{file:'beta.yml'});
 assert.deepEqual(read.files[0].info.mirrors,[MIRROR+tagWin+'/AciraBrowserSetup.exe']);
});

test('the mirror check: identical copies pass; a copy with other bytes refuses even in a dry run; one that is not there refuses a publish but only warns in a dry run; a missing optional blockmap never refuses',async t=>{
 const {result,held,fetch}=await planned(t),plan=result.plan;
 await uploadAll(plan,held);
 const ok=await mirrorCheck({plan,fetch,delays:[],strict:true});assert.equal(ok.same.length,4);
 // other bytes
 await uploadAll(plan,held,{alter:['AciraBrowserSetup.exe']});
 for(const strict of [false,true])await assert.rejects(mirrorCheck({plan,fetch,delays:[],strict}),error=>{
  assert.match(error.message,/does not hold the files/);assert.match(error.message,/AciraBrowserSetup\.exe is NOT the file this release publishes/);return true;
 });
 // not there
 await uploadAll(plan,held,{except:[`AciraBrowser-${VERSION}-mac-x64-update.zip`]});held.delete(plan.mirror.files.find(file=>file.name===`AciraBrowser-${VERSION}-mac-x64-update.zip`).url);
 const dry=await mirrorCheck({plan,fetch,delays:[],strict:false});assert.deepEqual(dry.missing.map(file=>file.name),[`AciraBrowser-${VERSION}-mac-x64-update.zip`]);
 await assert.rejects(mirrorCheck({plan,fetch,delays:[],strict:true}),/mac-x64-update\.zip is not on the mirror/);
 // only the optional blockmap missing: fine even for a publish
 await uploadAll(plan,held);held.delete(plan.mirror.files.find(file=>file.optional).url);
 const lenient=await mirrorCheck({plan,fetch,delays:[],strict:true});assert.equal(lenient.missing.length,1);assert.equal(lenient.missing[0].optional,true);
});

test('publishing: a mirror whose copy differs, or is missing, stops everything BEFORE a release is created or the feed is touched; with identical copies the committed documents carry the mirrors',async t=>{
 const first=await planned(t);
 await uploadAll(first.result.plan,first.held,{alter:[`AciraBrowser-${VERSION}-mac-arm64-update.zip`]});
 await assert.rejects(publishPlan({plan:first.result.plan,deps:first.deps,options:{}}),error=>/NOT the file this release publishes/.test(error.message)&&error.recovery.some(line=>/NOT touched/.test(line)));
 assert.equal(first.github.state.releases.size,0,'no release was created');assert.ok(!first.github.state.log.includes('FEED COMMITTED'));
 const second=await planned(t);
 await assert.rejects(publishPlan({plan:second.result.plan,deps:second.deps,options:{}}),/is not on the mirror/);
 assert.equal(second.github.state.releases.size,0);assert.ok(!second.github.state.log.includes('FEED COMMITTED'));
 const third=await planned(t);
 await uploadAll(third.result.plan,third.held);
 const state=await publishPlan({plan:third.result.plan,deps:third.deps,options:{}});
 assert.equal(state.feedCommit,'commit1');
 const live=JSON.parse(third.github.state.feed['beta.yml']);
 assert.deepEqual(live.files[0].mirrors,[MIRROR+`v${VERSION}-windows-b62c4715/AciraBrowserSetup.exe`]);
 assert.ok(third.asked.length>=4,'every mirror file was downloaded and compared');
});

test('main(): the dry run lists where each file goes, writes MIRROR-FILES.txt, says what is not on the mirror yet and still ends OK; a different copy refuses',async t=>{
 const w=await workspace(t),state=world(),lines=[],review=path.join(w.dir,'review');
 const argv=['--version',VERSION,'--mac-arm64-zip',w.files.arm64.zip,'--mac-x64-zip',w.files.x64.zip,'--windows-dir',path.dirname(w.files.windows.exe),'--notes-file',w.notes,'--review-dir',review,'--mirror-base',MIRROR];
 const overrides={...depsFor(w,state.github,{fetch:state.fetch}),log:line=>lines.push(line),gh:async()=>{throw Error('no gh in a dry run');}};
 assert.equal(await main(argv,overrides),0);
 const text=lines.join('\n');
 assert.match(text,/mirror https:\/\/downloads\.example\.net\/acira\/ - these files must be there/);
 assert.match(text,/AciraBrowserSetup\.exe\s+-> https:\/\/downloads\.example\.net\/acira\/v0\.1\.0-beta\.7-windows-b62c4715\/AciraBrowserSetup\.exe/);
 assert.match(text,/not on the mirror yet: .*AciraBrowserSetup\.exe/);assert.match(text,/DRY RUN OK/);
 const list=await fs.readFile(path.join(review,'MIRROR-FILES.txt'),'utf8');assert.match(list,/AciraBrowserSetup\.exe\n  -> https:\/\/downloads\.example\.net\//);
 // a copy of other bytes: refused, dry run included
 const plan=(await planUpdate({...options(w,{'mirror-base':MIRROR}),publish:false},overrides)).plan;await uploadAll(plan,state.held,{alter:['AciraBrowserSetup.exe']});
 lines.length=0;assert.equal(await main(argv,overrides),1);assert.match(lines.join('\n'),/REFUSED by the mirror check\. Nothing was uploaded or changed\./);
});

test('withMirrors leaves files a document keeps from before (--add-arch) alone, and a mirror in a document it already has is not repeated',()=>{
 const plan={releases:[{tag:'v1-mac-a',assets:[{url:'https://github.com/x/releases/download/v1-mac-a/F-x64.zip',name:'F-x64.zip',sha512:'S',size:3,path:'/tmp/F-x64.zip'}]}],
  feeds:[{text:U.serializeFeed({version:'1',files:[{url:'https://github.com/x/releases/download/v0-mac-a/F-arm64.zip',sha512:'T',size:2,mirrors:['https://other.example.net/F-arm64.zip']},{url:'https://github.com/x/releases/download/v1-mac-a/F-x64.zip',sha512:'S',size:3}]})}]};
 withMirrors({plan,base:MIRROR});withMirrors({plan,base:MIRROR});
 const doc=U.parseFeed(plan.feeds[0].text);
 assert.deepEqual(doc.files[0].mirrors,['https://other.example.net/F-arm64.zip'],'the file that was already live keeps what it had');
 assert.deepEqual(doc.files[1].mirrors,[MIRROR+'v1-mac-a/F-x64.zip'],'once');
 assert.equal(plan.mirror.files.length,1);
});
