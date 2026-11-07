// scripts/release-publish.mjs end to end against the stand-in GitHub (qa/publish-stand-in.mjs): three fake builds of two releases, the private handoff releases, and the
// live GitHub feed at beta.10. No network, no gh, no Apple tools. What it proves is the ORDER and the REFUSALS: nothing is offered before every file it names is
// public and byte-checked; update.acirabrowser.com is written before the GitHub feed; the website changes last; and no live write happens without its receipts.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {main,analyze,parseArguments} from '../scripts/release-publish.mjs';
import {describeBuild} from '../scripts/handoff.mjs';
import {buildReceipt} from '../scripts/rehearsal-receipt.mjs';
import {createStandIn} from '../qa/publish-stand-in.mjs';
const require=createRequire(import.meta.url),U=require('../packaging/update-publish.cjs'),P=require('../packaging/release-publish.cjs');
const REPO='Acira-dev/AciraBrowserUpdates',BRIDGE='0.1.0-beta.11',NEXT='0.1.0-beta.12',OLD='0.1.0-beta.10';
const COMMIT={[BRIDGE]:'b'.repeat(40),[NEXT]:'c'.repeat(40)},C8=v=>COMMIT[v].slice(0,8);
const sha512=bytes=>createHash('sha512').update(bytes).digest('base64'),sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const blockMap=size=>zlib.gzipSync(JSON.stringify({version:'2',files:[{name:'file',offset:0,checksums:['AAAA','BBBB'],sizes:[size-100,100]}]}));
const download=(tag,name)=>`https://github.com/${REPO}/releases/download/${tag}/${name}`;

/** The Mac folders (what package-mac-widevine.mjs leaves), the handoff releases (what the laptops upload), and a GitHub whose feed offers beta.10. */
async function world(t,{unsigned=true}={}){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'acira-release-publish-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const github=createStandIn(),made={};
 // the live beta.10 the new releases are planned from
 const oldSetup=Buffer.alloc(2000,'beta.10 setup'),oldMap=blockMap(oldSetup.length),oldMac={};
 for(const arch of ['arm64','x64']){oldMac[arch]=Buffer.from('beta.10 '+arch);}
 const macTag10=`v${OLD}-mac-11111111`,winTag10=`v${OLD}-windows-22222222`,linTag10=`v${OLD}-linux-33333333`;
 github.seedRelease(macTag10,{assets:{[`AciraBrowser-${OLD}-mac-arm64-update.zip`]:oldMac.arm64,[`AciraBrowser-${OLD}-mac-x64-update.zip`]:oldMac.x64}});
 github.seedRelease(winTag10,{assets:{'AciraBrowserSetup.exe':oldSetup,'AciraBrowserSetup.exe.blockmap':oldMap}});
 const macDoc={version:OLD,files:['arm64','x64'].map(arch=>({url:download(macTag10,`AciraBrowser-${OLD}-mac-${arch}-update.zip`),sha512:sha512(oldMac[arch]),size:oldMac[arch].length})),releaseDate:'2026-11-04T00:00:00.000Z'};
 macDoc.path=macDoc.files[0].url;macDoc.sha512=macDoc.files[0].sha512;
 const winDoc={version:OLD,files:[{url:download(winTag10,'AciraBrowserSetup.exe'),sha512:sha512(oldSetup),size:oldSetup.length}],path:download(winTag10,'AciraBrowserSetup.exe'),sha512:sha512(oldSetup),releaseDate:'2026-11-04T00:00:00.000Z'};
 const linDoc={version:OLD,files:[{url:download(linTag10,'a.AppImage'),sha512:'x'.repeat(86)+'==',size:5}],releaseDate:'2026-11-05T00:00:00.000Z'};
 Object.assign(github.state.feed,{'beta-mac.yml':JSON.stringify(macDoc,null,2)+'\n','beta.yml':JSON.stringify(winDoc,null,2)+'\n','linux/beta-linux.yml':JSON.stringify(linDoc,null,2)+'\n','latest-mac.yml':JSON.stringify({version:'0.0.0',files:[]}),'latest.yml':JSON.stringify({version:'0.0.0',files:[]}),'linux/latest-linux.yml':JSON.stringify({version:'0.0.0',files:[]})});
 for(const version of [BRIDGE,NEXT]){
  // Mac, as the packager leaves it
  const mac=path.join(root,'release',`mac-widevine-${version}-${C8(version)}.noindex`);made[version]={mac:{}};
  for(const arch of ['arm64','x64']){
   const dir=path.join(mac,`${arch}-AAAA`);await fs.mkdir(dir,{recursive:true});
   const zip=Buffer.from('update zip '+version+' '+arch),dmg=Buffer.from('disk image '+version+' '+arch);
   const zipFile=path.join(dir,`AciraBrowser-${version}-mac-${arch}-update.zip`),dmgFile=path.join(dir,`AciraBrowser-${version}-mac-${arch}.dmg`);
   await fs.writeFile(zipFile,zip);await fs.writeFile(dmgFile,dmg);
   await fs.writeFile(path.join(dir,'mac-widevine-package.json'),JSON.stringify({version,commit:COMMIT[version],arch,updateZip:{zip:zipFile,arch,sha512:sha512(zip),size:zip.length},diskImage:dmgFile,sha256:sha256(dmg),bytes:dmg.length}));
   made[version].mac[arch]={zip,dmg,sha512:sha512(zip)};
  }
  // Windows and Linux, as the laptops hand them over (built in a scratch folder, then seeded as a private release)
  for(const platform of ['windows','linux']){
   const dir=await fs.mkdtemp(path.join(os.tmpdir(),'acira-handoff-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
   if(platform==='windows'){
    const exe=Buffer.alloc(1100000,version===BRIDGE?7:9);exe.write('MZ');
    await fs.writeFile(path.join(dir,'AciraBrowserSetup.exe'),exe);await fs.writeFile(path.join(dir,'AciraBrowserSetup.exe.blockmap'),blockMap(exe.length));
    await fs.writeFile(path.join(dir,'latest.yml'),JSON.stringify({version,files:[{url:'AciraBrowserSetup.exe',sha512:sha512(exe),size:exe.length}],path:'AciraBrowserSetup.exe',sha512:sha512(exe)}));
    await fs.writeFile(path.join(dir,'WINDOWS-BUILD-RESULT.json'),JSON.stringify({version,commit:COMMIT[version],installer:{file:'AciraBrowserSetup.exe',sha256:sha256(exe),bytes:exe.length},updateConfig:{file:'resources/app-update.yml',url:'https://update.acirabrowser.com/'}}));
    made[version].windows={exe,sha512:sha512(exe)};
   }else{
    const image=Buffer.alloc(10.5*1048576,version===BRIDGE?5:6);image.set(Buffer.from([0x7f,0x45,0x4c,0x46]));
    await fs.writeFile(path.join(dir,`AciraBrowser-${version}-linux-x86_64.AppImage`),image);
    await fs.writeFile(path.join(dir,'AciraBrowser-Linux-SetupFiles.zip'),Buffer.from('setup files'));
    await fs.writeFile(path.join(dir,'LINUX-BUILD-RESULT.json'),JSON.stringify({version,sourceCommit:COMMIT[version]}));
    made[version].linux={image,sha512:sha512(image)};
   }
   const record=await describeBuild({platform,dir,commit:COMMIT[version],signing:platform==='windows'?{authenticode:unsigned?'unsigned':'valid',subject:unsigned?null:'CN=Acira, Inc.',evs:false}:null,appUpdateYml:platform==='linux'?'provider: "generic"\nurl: "https://update.acirabrowser.com/linux/"\n':null});
   await fs.writeFile(path.join(dir,'HANDOFF.json'),JSON.stringify(record,null,2)+'\n');
   const assets={};for(const name of await fs.readdir(dir))assets[name]=await fs.readFile(path.join(dir,name));
   github.seedRelease(`handoff-v${version}-${platform}-${C8(version)}`,{assets});
  }
 }
 await fs.writeFile(path.join(root,'bridge-notes.md'),'- A short step: Acira updates itself again in a few minutes.\n');await fs.writeFile(path.join(root,'next-notes.md'),'- Faster tabs\n- Sidebar fix\n');
 return {root,github,made};
}
const baseArgs=(w,over=[])=>['--bridge',BRIDGE,'--next',NEXT,'--bridge-notes-file',path.join(w.root,'bridge-notes.md'),'--next-notes-file',path.join(w.root,'next-notes.md'),'--accept-unsigned-host','--yes',...over];
const logger=()=>{const lines=[];const log=line=>lines.push(String(line));log.lines=lines;log.text=()=>lines.join('\n');return log;};
const deps=(w,over={})=>{
 const log=logger();
 return {deps:{root:w.root,gh:w.github.gh,fetch:w.github.fetch,log,sleep:async()=>{},delays:[],now:()=>new Date('2026-11-07T10:00:00.000Z'),
  inspectMacZip:async({zip,arch})=>{const version=/AciraBrowser-(.+)-mac-/.exec(path.basename(zip))[1];return {zip:path.basename(zip),version,arch,commit:COMMIT[version],identity:'Developer ID Application: Khaled Kaed Beyh (2MGLP3QV9X)',stapled:true,gatekeeper:'Notarized Developer ID'};},
  inspectMacDmg:async({dmg})=>({dmg:path.basename(dmg),stapled:true,gatekeeper:'Notarized Developer ID'}),
  git:async args=>args.includes('--name-only')?'package.json\npackage-lock.json\n':'--- a/package.json\n+++ b/package.json\n-  "version": "0.1.0-beta.11",\n+  "version": "0.1.0-beta.12",\n',...over},log};
};
const run=async(w,command,extra=[],over={})=>{const {deps:d,log}=deps(w,over);const code=await main([command,...baseArgs(w,extra)],d);return {code,log:log.text()};};
const feedDoc=(github,file)=>JSON.parse(github.state.feed[file]);
const docsDoc=(github,file)=>JSON.parse(github.state.docs[file]);
const index=(log,needle,from=0)=>{const i=log.findIndex((line,at)=>at>=from&&line.includes(needle));return i;};
/** The six receipts the private tests would leave, built with the real receipt maker from the files that are about to be published. */
async function receipts(w,{skip=[],realAddress=true}={}){
 const dir=path.join(w.root,'release/rehearsal',BRIDGE+'__'+NEXT);await fs.mkdir(dir,{recursive:true});
 const sha=(version,platform)=>platform==='mac'?w.made[version].mac.arm64.sha512:w.made[version][platform].sha512;
 const size=(version,platform)=>platform==='mac'?w.made[version].mac.arm64.zip.length:platform==='windows'?w.made[version].windows.exe.length:w.made[version].linux.image.length;
 const eye=Object.fromEntries(Object.values(P.BY_EYE).flat().map(key=>[key,true]));
 for(const platform of P.PLATFORMS)for(const hop of [1,2]){
  if(skip.includes(platform+hop))continue;
  const from=hop===1?OLD:BRIDGE,to=hop===1?BRIDGE:NEXT;
  const rigResult=platform==='mac'?{passed:true,checks:['Existing tabs, workspace, settings and profile survive without uninstalling'],after:{version:to},rehearsal:{from:{version:from,sha512:hop===2?sha(BRIDGE,'mac'):null},to:{version:to,sha512:sha(to,'mac')},fileBytes:size(to,'mac'),feedRequests:3,primary:'ok'}}:null;
  const feed=hop===2&&platform==='windows'&&!realAddress?'http://127.0.0.1:8080/':hop===2&&platform==='windows'?'https://update.acirabrowser.com/testers/':null;
  const receipt=await buildReceipt(platform==='mac'?{platform,hop,rigResult,answers:eye}:{platform,hop,feed,from,to,file:path.join(w.root,'release/handoff',to,platform,platform==='windows'?'AciraBrowserSetup.exe':`AciraBrowser-${to}-linux-x86_64.AppImage`),served:{summary:{documentFetched:true,fileBytesServed:1234}},answers:eye,installed:to});
  if(hop===2&&platform!=='mac')receipt.from.sha512=sha(BRIDGE,platform);
  await fs.writeFile(path.join(dir,`${platform}-hop${hop}.json`),JSON.stringify(receipt));
 }
}

test('options: commands and values are told apart, unknown ones are refused', () => {
  assert.deepEqual(parseArguments(['prepare','--bridge',BRIDGE,'--next',NEXT,'--publish','--which','next']),{command:'prepare',bridge:BRIDGE,next:NEXT,publish:true,which:'next'});
  assert.throws(()=>parseArguments(['prepare','--brige','x']),/Unknown option/);assert.throws(()=>parseArguments(['prepare','--bridge']),/needs a value/);
});

test('a dry run collects the handoffs, checks every build, plans every document, writes the review folder and uploads nothing', async t => {
  const w=await world(t),before=JSON.stringify(w.github.state.feed);
  const {code,log}=await run(w,'prepare');
  assert.equal(code,0,log);assert.match(log,/DRY RUN OK/);
  assert.equal(JSON.stringify(w.github.state.feed),before,'the GitHub feed is untouched');assert.deepEqual(w.github.state.docs,{},'the new host is untouched');
  assert.ok(!w.github.state.log.some(line=>/^UPLOAD v/.test(line)),'no release was created or uploaded to');
  const review=path.join(w.root,'release/update-review',BRIDGE+'__'+NEXT);
  for(const file of ['legacy/beta-mac.yml','legacy/beta.yml','legacy/linux/beta-linux.yml','host/beta-mac.yml','host/beta.yml','host/linux/beta-linux.yml','testers/testers/beta.yml','rehearsal/rehearsal/beta-mac.yml','PLAN.json'])await fs.access(path.join(review,file));
  const legacy=JSON.parse(await fs.readFile(path.join(review,'legacy/beta.yml'),'utf8'));
  assert.equal(legacy.version,BRIDGE);assert.equal(legacy.stagingPercentage,10);
  assert.deepEqual(legacy.previousBlockMaps.map(item=>item.version),[OLD],'the bridge release\'s Windows differential starts from beta.10');
  const host=JSON.parse(await fs.readFile(path.join(review,'host/beta.yml'),'utf8'));
  assert.equal(host.version,NEXT);assert.equal(host.nextCheckSeconds,900);
  assert.deepEqual(host.previousBlockMaps.map(item=>item.version),[BRIDGE,OLD],'the next release\'s differential starts from the bridge release, whose setup is not live yet');
  assert.ok(host.previousBlockMaps[0].url.includes(`v${BRIDGE}-windows-${C8(BRIDGE)}/AciraBrowserSetup.exe.blockmap`));
  // the bridge release carries no disk images; the next one does (the website offers it)
  const plan=JSON.parse(await fs.readFile(path.join(review,'PLAN.json'),'utf8')),names=version=>plan.releases.filter(r=>r.tag.startsWith('v'+version)).flatMap(r=>r.files.map(f=>f.name));
  assert.ok(!names(BRIDGE).some(name=>/\.dmg$/.test(name)));assert.ok(names(NEXT).some(name=>/mac-arm64\.dmg$/.test(name)));
  assert.ok(names(BRIDGE).includes(`AciraBrowser-${BRIDGE}-linux-x86_64.AppImage`));
});

test('refusals: a build that asks the new host first unsigned, a next release that is more than the bridge plus its version, a missing handoff, a handoff that was replaced', async t => {
  const w=await world(t);
  let {code,log}=await run(w,'prepare',[],{});
  const args=baseArgs(w).filter(arg=>arg!=='--accept-unsigned-host');
  const d1=deps(w);assert.equal(await main(['prepare',...args],d1.deps),1);assert.match(d1.log.text(),/not Authenticode-signed with its publisher named/);assert.match(d1.log.text(),/Linux has no signature check/);
  ({code,log}=await run(w,'prepare',[],{git:async args=>args.includes('--name-only')?'package.json\ndesktop/main.cjs\n':''}));
  assert.equal(code,1);assert.match(log,/also changes desktop\/main.cjs/);
  // a handoff replaced after the machine recorded it
  const dir=path.join(w.root,'release/handoff',BRIDGE,'windows');await fs.writeFile(path.join(dir,'AciraBrowserSetup.exe'),Buffer.alloc(1100000,1));
  ({code,log}=await run(w,'prepare'));assert.equal(code,1);assert.match(log,/replaced or damaged after the build/);
  // no handoff at all
  const w2=await world(t);for(const tag of [...w2.github.state.releases.keys()])if(tag.startsWith('handoff-v'+NEXT+'-linux'))w2.github.state.releases.delete(tag);
  ({code,log}=await run(w2,'prepare'));assert.equal(code,1);assert.match(log,/No handoff for the linux build of 0.1.0-beta.12/);
  assert.ok(!w2.github.state.log.some(line=>/^UPLOAD v/.test(line)));
});

test('prepare --publish: both releases go up hidden and are downloaded back, then the rehearsal and testers documents; the feeds are not touched', async t => {
  const w=await world(t),feedBefore=JSON.stringify(w.github.state.feed);
  const {code,log}=await run(w,'prepare',['--publish']);
  assert.equal(code,0,log);assert.match(log,/PREPARED/);
  assert.equal(JSON.stringify(w.github.state.feed),feedBefore,'the GitHub feed is not written by prepare');
  for(const version of [BRIDGE,NEXT])for(const platform of ['mac','windows','linux']){
   const release=w.github.state.releases.get(`v${version}-${platform}-${C8(version)}`);assert.ok(release,version+' '+platform+' release exists');
   assert.equal(release.isDraft,false);assert.ok(release.notes.startsWith(U.HIDDEN_MARKER),version+' '+platform+' is hidden from the website');
  }
  assert.deepEqual(Object.keys(w.github.state.docs).sort(),['rehearsal/beta-mac.yml','rehearsal/beta.yml','rehearsal/linux/beta-linux.yml','testers/beta-mac.yml','testers/beta.yml','testers/linux/beta-linux.yml']);
  assert.equal(docsDoc(w.github,'rehearsal/beta.yml').version,BRIDGE);assert.equal(docsDoc(w.github,'rehearsal/beta.yml').stagingPercentage,undefined);
  assert.equal(docsDoc(w.github,'testers/beta.yml').version,NEXT);
  // every file is downloaded back anonymously before the first document is written
  const log2=w.github.state.log,firstCommit=index(log2,'FEED COMMITTED'),lastDownload=log2.map((line,at)=>/^DOWNLOAD AciraBrowser/.test(line)?at:-1).filter(at=>at>=0).at(-1);
  assert.ok(lastDownload<firstCommit,'the documents are written after the last download check');
  const state=JSON.parse(await fs.readFile(path.join(w.root,'release/publish-state',P.stateName({bridge:BRIDGE,next:NEXT})),'utf8'));
  assert.deepEqual(Object.keys(state.done).sort(),['collect','held','rehearsal','verify']);
  // running it again resumes without writing anything twice
  const commits=w.github.state.commits;assert.equal((await run(w,'prepare',['--publish'])).code,0);assert.equal(w.github.state.commits,commits+1,'only the rehearsal documents are written again (same bytes), nothing else');
});

test('go: refused until every private test has a receipt for the exact files; then the new host is written first, the GitHub feed second, and the website not at all', async t => {
  const w=await world(t);
  await assert.rejects(run(w,'go',['--publish']),/not done yet/,'nothing is prepared yet');
  await run(w,'prepare',['--publish']);
  let result=await run(w,'go',['--publish']);
  assert.equal(result.code,1);assert.match(result.log,/The private tests are not all done/);
  for(const platform of P.PLATFORMS)for(const hop of [1,2])assert.match(result.log,new RegExp(platform+' hop '+hop+': no receipt'));
  assert.equal(w.github.state.docs['beta.yml'],undefined,'nothing live was written');
  await receipts(w,{skip:['windows2']});
  result=await run(w,'go',['--publish']);assert.equal(result.code,1);assert.match(result.log,/windows hop 2: no receipt/);assert.doesNotMatch(result.log,/mac hop 1/);
  assert.equal(feedDoc(w.github,'beta.yml').version,OLD,'the GitHub feed still offers beta.10');
  await receipts(w,{realAddress:false});
  result=await run(w,'go',['--publish']);assert.equal(result.code,1);assert.match(result.log,/No hop 2 test went through the real address https:\/\/update.acirabrowser.com\/testers\//);assert.equal(w.github.state.docs['beta.yml'],undefined);
  await receipts(w);
  const commitsBefore=w.github.state.history.length;
  result=await run(w,'go',['--publish']);assert.equal(result.code,0,result.log);assert.match(result.log,/W5/);assert.match(result.log,/W6/);
  const added=w.github.state.history.slice(commitsBefore);
  assert.equal(added.length,2,'two commits: the new host, then the GitHub feed');
  assert.match(added[0].message,/^Feed: Acira Browser 0.1.0-beta.12/);assert.ok(added[0].docs['beta.yml']&&JSON.parse(added[0].feed['beta.yml']).version===OLD,'at the first commit the GitHub feed still says beta.10');
  assert.equal(JSON.parse(added[0].docs['beta.yml']).version,NEXT);assert.equal(JSON.parse(added[0].docs['beta.yml']).nextCheckSeconds,900);
  assert.match(added[1].message,/^Feed: Acira Browser 0.1.0-beta.11/);assert.equal(JSON.parse(added[1].feed['beta.yml']).version,BRIDGE);assert.equal(JSON.parse(added[1].feed['beta.yml']).stagingPercentage,10);
  assert.equal(JSON.parse(added[1].feed['beta-mac.yml']).stagingPercentage,10);assert.equal(JSON.parse(added[1].feed['linux/beta-linux.yml']).version,BRIDGE);
  // every file a document names was public and byte-checked before that document was written
  const log=w.github.state.log,commits=log.map((line,at)=>line==='FEED COMMITTED'?at:-1).filter(at=>at>=0),lastOf=prefix=>log.map((line,at)=>line.startsWith(prefix)?at:-1).filter(at=>at>=0).at(-1);
  assert.ok(lastOf('DOWNLOAD AciraBrowser-0.1.0-beta.12')<commits.at(-2),'every beta.12 file was downloaded back before the new host was written');
  assert.ok(lastOf('DOWNLOAD AciraBrowser-0.1.0-beta.11')<commits.at(-1)&&lastOf('DOWNLOAD AciraBrowserSetup.exe')<commits.at(-1),'every beta.11 file was downloaded back before the GitHub feed was written');
  assert.ok(commits.at(-2)<commits.at(-1),'the new host is written before the GitHub feed');
  // the release dates of what was tested and what was written are the same
  assert.equal(docsDoc(w.github,'testers/beta.yml').releaseDate,docsDoc(w.github,'beta.yml').releaseDate);
  // the website is not changed: both releases are still hidden
  for(const platform of ['mac','windows','linux'])assert.ok(w.github.state.releases.get(`v${NEXT}-${platform}-${C8(NEXT)}`).notes.startsWith(U.HIDDEN_MARKER));
  // go again writes nothing twice
  const n=w.github.state.history.length;assert.equal((await run(w,'go',['--publish'])).code,0);assert.equal(w.github.state.history.length,n);
});

test('go refuses when the files changed after they were tested, and when a receipt names other bytes', async t => {
  const w=await world(t);await run(w,'prepare',['--publish']);await receipts(w);
  // a receipt that names bytes other than the ones being published (a rebuilt file was tested, or a receipt was copied from another run)
  const receiptFile=path.join(w.root,'release/rehearsal',BRIDGE+'__'+NEXT,'windows-hop1.json'),good=await fs.readFile(receiptFile,'utf8');
  await fs.writeFile(receiptFile,JSON.stringify({...JSON.parse(good),to:{version:BRIDGE,sha512:'a rebuilt setup'}}));
  let result=await run(w,'go',['--publish']);
  assert.equal(result.code,1);assert.match(result.log,/windows hop 1: it tested another file than the one being published/);assert.equal(w.github.state.docs['beta.yml'],undefined);
  await fs.writeFile(receiptFile,good);
  // the next release's Mac zip is rebuilt: the packager's receipt is consistent, but the tested hash is not the one being published
  const dir=path.join(w.root,'release',`mac-widevine-${NEXT}-${C8(NEXT)}.noindex`,'arm64-AAAA'),zipFile=path.join(dir,`AciraBrowser-${NEXT}-mac-arm64-update.zip`),zip=Buffer.from('a rebuilt zip');
  await fs.writeFile(zipFile,zip);await fs.writeFile(path.join(dir,'mac-widevine-package.json'),JSON.stringify({version:NEXT,commit:COMMIT[NEXT],arch:'arm64',updateZip:{zip:zipFile,arch:'arm64',sha512:sha512(zip),size:zip.length},diskImage:path.join(dir,`AciraBrowser-${NEXT}-mac-arm64.dmg`),sha256:sha256(Buffer.from('disk image '+NEXT+' arm64')),bytes:Buffer.from('disk image '+NEXT+' arm64').length}));
  result=await run(w,'go',['--publish']);
  assert.equal(result.code,1);assert.match(result.log,/The planned documents are not the ones that were tested/);
  assert.equal(w.github.state.docs['beta.yml'],undefined);assert.equal(feedDoc(w.github,'beta.yml').version,OLD);
});

test('after go: unhold makes only the next release visible; widen, halt, resume and pace steer each place; rollback-host is refused once the bridge is out', async t => {
  const w=await world(t);await run(w,'prepare',['--publish']);await receipts(w);await run(w,'go',['--publish']);
  const tag=platform=>w.github.state.releases.get(`v${NEXT}-${platform}-${C8(NEXT)}`);
  assert.match((await run(w,'unhold',['--publish'])).log,/DONE/);
  for(const platform of ['mac','windows','linux']){assert.ok(!tag(platform).notes.includes(U.HIDDEN_MARKER),'visible');assert.ok(w.github.state.releases.get(`v${BRIDGE}-${platform}-${C8(BRIDGE)}`).notes.startsWith(U.HIDDEN_MARKER),'the bridge stays hidden for good');}
  assert.match(tag('mac').notes,/Faster tabs/,'the notes survive');
  // staged rollout of the bridge on the GitHub feed
  assert.equal((await run(w,'widen',['--percent','50','--which','bridge','--publish'])).code,0);
  assert.equal(feedDoc(w.github,'beta.yml').stagingPercentage,50);assert.equal(feedDoc(w.github,'linux/beta-linux.yml').stagingPercentage,50,'Linux is steered with the others');
  assert.equal((await run(w,'halt',['--which','bridge','--publish'])).code,0);assert.equal(feedDoc(w.github,'beta-mac.yml').stagingPercentage,0);
  assert.equal((await run(w,'resume',['--which','bridge','--publish'])).code,0);assert.equal(feedDoc(w.github,'beta-mac.yml').stagingPercentage,50);
  assert.equal((await run(w,'widen',['--percent','100','--which','bridge','--publish'])).code,0);assert.equal(feedDoc(w.github,'beta.yml').stagingPercentage,undefined);
  // the pace of the new host
  assert.equal((await run(w,'pace',['--seconds','7200','--which','next','--publish'])).code,0);assert.equal(docsDoc(w.github,'beta.yml').nextCheckSeconds,7200);
  assert.equal((await run(w,'pace',['--seconds','clear','--which','next','--publish'])).code,0);assert.equal(docsDoc(w.github,'beta.yml').nextCheckSeconds,undefined);
  await assert.rejects(run(w,'pace',['--seconds','30','--which','next','--publish']),/whole number from 600 to 86400/,'a pace outside 10 minutes to 24 hours is refused');
  // a halt of the next release on the new host
  assert.equal((await run(w,'halt',['--which','next','--publish'])).code,0);assert.equal(docsDoc(w.github,'beta-mac.yml').stagingPercentage,0);
  await assert.rejects(run(w,'rollback-host',['--publish']),/GitHub feed already has/);
});

test('rollback-host: before the bridge release is out, the next release\'s documents are removed from the new host and nothing else changes', async t => {
  const w=await world(t);await run(w,'prepare',['--publish']);await receipts(w);await run(w,'go',['--publish']);
  const dir=path.join(w.root,'release/publish-state'),file=path.join(dir,P.stateName({bridge:BRIDGE,next:NEXT})),state=JSON.parse(await fs.readFile(file,'utf8'));
  state.done.bridge=false;await fs.writeFile(file,JSON.stringify(state));
  assert.ok(w.github.state.docs['beta.yml']);
  assert.equal((await run(w,'rollback-host',['--publish'])).code,0);
  assert.equal(w.github.state.docs['beta.yml'],undefined);assert.equal(w.github.state.docs['linux/beta-linux.yml'],undefined);
  assert.ok(w.github.state.docs['testers/beta.yml']&&w.github.state.docs['rehearsal/beta.yml'],'the test folders stay');
  assert.equal(feedDoc(w.github,'beta.yml').version,BRIDGE,'the GitHub feed is not touched by a host rollback');
});

test('freeze: only at 100%, it records the frozen set, and from then on the tool refuses to write the GitHub feed; check compares live with the record', async t => {
  const w=await world(t);await run(w,'prepare',['--publish']);await receipts(w);await run(w,'go',['--publish']);
  await assert.rejects(run(w,'freeze'),/Widen it to 100 first/);
  await run(w,'widen',['--percent','100','--which','bridge','--publish']);
  assert.equal((await run(w,'freeze')).code,0);
  const manifest=JSON.parse(await fs.readFile(path.join(w.root,'packaging/frozen-manifest.json'),'utf8'));
  assert.ok(manifest.entries.some(entry=>entry.kind==='document'&&entry.path==='feed/beta.yml'));
  assert.ok(manifest.entries.some(entry=>entry.kind==='asset'&&entry.url.includes(`v${BRIDGE}-linux`)));
  assert.ok(manifest.entries.some(entry=>entry.kind==='blockmap'&&entry.url.includes(OLD)),'beta.10\'s blockmap is frozen too');
  assert.equal((await run(w,'check')).code,0);
  const history=w.github.state.history.length;
  const refused=await run(w,'halt',['--which','bridge','--publish']);assert.match(refused.log,/GitHub feed is frozen/);assert.equal(w.github.state.history.length,history,'nothing was written');
  await assert.rejects(run(w,'prepare',['--publish']),/GitHub feed is frozen/);
  // something frozen is damaged
  w.github.state.releases.get(`v${BRIDGE}-linux-${C8(BRIDGE)}`).assets.delete(`AciraBrowser-${BRIDGE}-linux-x86_64.AppImage`);
  const bad=await run(w,'check');assert.equal(bad.code,1);assert.match(bad.log,/AppImage.*no longer answers/);
  w.github.state.feed['beta.yml']=JSON.stringify({...feedDoc(w.github,'beta.yml'),version:'0.1.0-beta.99'});
  assert.match((await run(w,'check')).log,/frozen document feed\/beta.yml has changed/);
});

test('seal is refused while the next releases live in the same repository as the GitHub feed (archiving it would stop the new host being written)', async t => {
  const w=await world(t);await run(w,'prepare',['--publish']);await receipts(w);await run(w,'go',['--publish']);await run(w,'widen',['--percent','100','--which','bridge','--publish']);await run(w,'freeze');
  await assert.rejects(run(w,'seal',['--publish']),/same repository/);
});

test('status says where the run stands', async t => {
  const w=await world(t);const {log}=await run(w,'status');assert.match(log,/\[ \] collect/);
  await run(w,'prepare',['--publish']);const after=(await run(w,'status')).log;assert.match(after,/\[x\] held/);assert.match(after,/Next: tests/);
});

test('site: the static files are committed to docs/ once, only when they differ, and never anything else', async t => {
  const w=await world(t);
  let result=await run(w,'site');assert.equal(result.code,0);assert.match(result.log,/DRY RUN OK/);assert.deepEqual(w.github.state.docs,{});
  const d=deps(w);assert.equal(await main(['site','--publish','--yes'],d.deps),0,d.log.text());
  assert.deepEqual(Object.keys(w.github.state.docs).sort(),['.nojekyll','404.html','CNAME','index.html','latest-mac.yml','latest.yml','linux/latest-linux.yml','robots.txt']);
  assert.equal(w.github.state.docs['CNAME'].trim(),'update.acirabrowser.com');assert.equal(w.github.state.docs['.nojekyll'],'');
  assert.equal(JSON.stringify(feedDoc(w.github,'beta.yml').version),JSON.stringify(OLD),'the GitHub feed is untouched');
  const commits=w.github.state.commits;
  const d2=deps(w);assert.equal(await main(['site','--publish','--yes'],d2.deps),0);assert.match(d2.log.text(),/already in/);assert.equal(w.github.state.commits,commits,'nothing to commit the second time');
  // and the whole site (static files plus a prepare) passes the site rules
  await run(w,'prepare',['--publish']);
  const {checkSite,SITE_DIR}=require('../packaging/update-site.cjs');
  const files=new Map(Object.entries(w.github.state.docs).map(([name,text])=>[name,Buffer.from(text)]));
  assert.deepEqual(checkSite(files,{parse:text=>JSON.parse(text)}),[]);
});
