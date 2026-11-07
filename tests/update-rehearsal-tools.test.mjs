// The tools for the private tests and the handoff: the tester switch (scripts/update-tester.mjs), the local rehearsal feed (scripts/serve-update-rehearsal.mjs), the receipt
// (scripts/rehearsal-receipt.mjs) and the build record the Windows and Linux machines hand over (scripts/handoff.mjs). Everything runs in temp folders; no profile of
// anyone's is read or written, and nothing leaves this computer except to 127.0.0.1.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {tester,shareOf,pinnedId} from '../scripts/update-tester.mjs';
import {createRehearsalServer,rewrite} from '../scripts/serve-update-rehearsal.mjs';
import {buildReceipt} from '../scripts/rehearsal-receipt.mjs';
import {describeBuild} from '../scripts/handoff.mjs';
const require=createRequire(import.meta.url),P=require('../packaging/release-publish.cjs');
const temp=async t=>{const dir=await fs.mkdtemp(path.join(os.tmpdir(),'acira-rehearsal-tools-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir;};
const sha512=bytes=>createHash('sha512').update(bytes).digest('base64'),sha256=bytes=>createHash('sha256').update(bytes).digest('hex');

test('the tester switch: on and off edit only updater.json, pin puts the id in every staged share, and nothing happens while Acira is open on the profile', async t => {
  const dir=await temp(t);
  await assert.rejects(tester('on',null),/--profile/);
  await assert.rejects(tester('on',path.join(dir,'missing')),/not a folder/);
  await assert.rejects(tester('on',dir),/does not exist yet/,'a profile that has never run is not guessed at');
  await fs.writeFile(path.join(dir,'updater.json'),JSON.stringify({autoDownload:false,channel:'beta',lastRunVersion:'0.1.0-beta.10'}));
  assert.equal((await tester('status',dir)).testersFeed,false);
  await tester('on',dir);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir,'updater.json'),'utf8')),{autoDownload:false,channel:'beta',lastRunVersion:'0.1.0-beta.10',testersFeed:true},'the other settings are kept');
  assert.equal((await tester('status',dir)).testersFeed,true);
  await tester('off',dir);assert.equal(JSON.parse(await fs.readFile(path.join(dir,'updater.json'),'utf8')).testersFeed,undefined);
  // the share
  const id=pinnedId();assert.match(id,/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}00000000$/);assert.equal(shareOf(id),0);
  assert.ok(shareOf('ffffffff-ffff-4fff-8fff-ffffffffffff')>99.9);
  await tester('pin',dir);const pinned=(await tester('status',dir));assert.equal(pinned.share,0);
  // the id is the shape electron-updater accepts
  const {UUID}=require('builder-util-runtime');assert.ok(UUID.check((await fs.readFile(path.join(dir,'.updaterId'),'utf8')).trim()));
  // a profile in use
  await fs.symlink('somewhere-else-12345',path.join(dir,'SingletonLock'));
  await assert.rejects(tester('on',dir),/seems to be open/);await assert.rejects(tester('pin',dir),/seems to be open/);
  assert.equal((await tester('status',dir)).testersFeed,false,'status always works');
  await tester('on',dir,{force:true});
});

async function review(t){
  const dir=await temp(t),tag10=`v0.1.0-beta.11-windows-bbbbbbbb`,tag12=`v0.1.0-beta.12-windows-cccccccc`;
  const bridgeDir=path.join(dir,'bridge'),nextDir=path.join(dir,'next');await fs.mkdir(bridgeDir);await fs.mkdir(nextDir);
  const setup=Buffer.from('0123456789'.repeat(100)),next=Buffer.from('abcdefghij'.repeat(100));
  await fs.writeFile(path.join(bridgeDir,'AciraBrowserSetup.exe'),setup);await fs.writeFile(path.join(nextDir,'AciraBrowserSetup.exe'),next);await fs.writeFile(path.join(nextDir,'AciraBrowserSetup.exe.blockmap'),'map');
  await fs.mkdir(path.join(dir,'rehearsal'),{recursive:true});await fs.mkdir(path.join(dir,'testers'),{recursive:true});
  const url=(tag,name)=>`https://github.com/Acira-dev/AciraBrowserUpdates/releases/download/${tag}/${name}`;
  await fs.writeFile(path.join(dir,'rehearsal/beta.yml'),JSON.stringify({version:'0.1.0-beta.11',files:[{url:url(tag10,'AciraBrowserSetup.exe'),sha512:sha512(setup),size:setup.length}],stagingPercentage:10}));
  await fs.writeFile(path.join(dir,'testers/beta.yml'),JSON.stringify({version:'0.1.0-beta.12',files:[{url:url(tag12,'AciraBrowserSetup.exe'),sha512:sha512(next),size:next.length}],previousBlockMaps:[{version:'0.1.0-beta.11',url:url(tag10,'AciraBrowserSetup.exe.blockmap')}]}));
  await fs.writeFile(path.join(dir,'PLAN.json'),JSON.stringify({bridge:'0.1.0-beta.11',next:'0.1.0-beta.12',releases:[{tag:tag10},{tag:tag12}]}));
  return {dir,bridgeDir,nextDir,tag10,tag12,setup,next};
}
test('the local rehearsal feed: the planned documents with the file addresses pointed at this computer, ranges honoured, every request logged', async t => {
  const r=await review(t),server=await createRehearsalServer({review:r.dir,hop:1,dirs:{bridge:r.bridgeDir}});t.after(()=>server.close());
  const doc=await (await fetch(server.origin+'/beta.yml')).json();
  assert.equal(doc.version,'0.1.0-beta.11');assert.equal(doc.files[0].url,`${server.origin}/files/${r.tag10}/AciraBrowserSetup.exe`);assert.equal(doc.stagingPercentage,undefined,'a test copy is always inside the share');
  const whole=await fetch(doc.files[0].url);assert.equal((await whole.arrayBuffer()).byteLength,r.setup.length);
  const part=await fetch(doc.files[0].url,{headers:{range:'bytes=10-19'}});assert.equal(part.status,206);assert.equal(part.headers.get('content-range'),`bytes 10-19/${r.setup.length}`);assert.equal(Buffer.from(await part.arrayBuffer()).toString(),'0123456789');
  assert.equal((await fetch(server.origin+`/files/${r.tag12}/AciraBrowserSetup.exe`)).status,404,'hop 1 does not have the next release\'s files');
  assert.equal((await fetch(server.origin+'/notes.txt')).status,404);
  assert.deepEqual(server.summary(),{documentFetched:true,fileBytesServed:r.setup.length+10});
  const hop2=await createRehearsalServer({review:r.dir,hop:2,dirs:{bridge:r.bridgeDir,next:r.nextDir}});t.after(()=>hop2.close());
  const two=await (await fetch(hop2.origin+'/beta.yml')).json();
  assert.equal(two.version,'0.1.0-beta.12');assert.equal(two.previousBlockMaps[0].url,`${hop2.origin}/files/${r.tag10}/AciraBrowserSetup.exe.blockmap`);
  assert.equal((await fetch(two.files[0].url)).status,200);
  assert.equal(rewrite(JSON.stringify({version:'1.0.0',files:[{url:'https://example.org/a.exe',sha512:'x',size:1}]}),'http://127.0.0.1:1').includes('example.org'),true,'addresses that are not GitHub releases are left alone');
});
test('the local rehearsal feed can fail the way the real one might: 503, 404, an HTML page, garbage, silence', async t => {
  const r=await review(t);
  for(const mode of ['503','404','html','garbage']){
    const server=await createRehearsalServer({review:r.dir,hop:1,dirs:{bridge:r.bridgeDir},mode});
    const response=await fetch(server.origin+'/beta.yml');
    if(mode==='503'||mode==='404')assert.equal(response.status,Number(mode));else assert.equal(response.status,200);
    const text=await response.text();if(mode==='html')assert.match(text,/<html|<!doctype/i);if(mode==='garbage')assert.doesNotMatch(text,/"version"/);
    assert.equal(server.summary().documentFetched,mode==='html'||mode==='garbage'?true:false);await server.close();
  }
  const hang=await createRehearsalServer({review:r.dir,hop:1,dirs:{bridge:r.bridgeDir},mode:'hang'});
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),150);
  await assert.rejects(fetch(hang.origin+'/beta.yml',{signal:controller.signal}));clearTimeout(timer);await hang.close();
});

test('a receipt: automatic half from the feed server and the file, by-eye half from the answers; it names the exact SHA-512; one "no" fails it', async t => {
  const dir=await temp(t),setup=path.join(dir,'AciraBrowserSetup.exe');await fs.writeFile(setup,'the setup');
  const eye=Object.fromEntries(P.BY_EYE.windows.map(key=>[key,true])),served={summary:{documentFetched:true,fileBytesServed:512}};
  const ok=await buildReceipt({platform:'windows',hop:1,from:'0.1.0-beta.10',to:'0.1.0-beta.11',file:setup,served,answers:eye,installed:'0.1.0-beta.11',machine:'laptop',now:new Date('2026-11-07T00:00:00Z')});
  assert.equal(ok.passed,true);assert.equal(ok.to.sha512,sha512(Buffer.from('the setup')));assert.equal(ok.machine,'laptop');assert.equal(ok.schema,1);
  assert.deepEqual(P.checkReceipt(ok,{platform:'windows',hop:1,from:{version:'0.1.0-beta.10'},to:{version:'0.1.0-beta.11',sha512:sha512(Buffer.from('the setup'))}}),[],'the release tool accepts what this tool writes');
  assert.equal((await buildReceipt({platform:'windows',hop:1,from:'0.1.0-beta.10',to:'0.1.0-beta.11',file:setup,served,answers:{...eye,noSetupWindow:false},installed:'0.1.0-beta.11'})).passed,false);
  assert.equal((await buildReceipt({platform:'windows',hop:1,from:'0.1.0-beta.10',to:'0.1.0-beta.11',file:setup,served,answers:eye,installed:'0.1.0-beta.10'})).passed,false,'About still says the old version');
  assert.equal((await buildReceipt({platform:'windows',hop:1,from:'0.1.0-beta.10',to:'0.1.0-beta.11',file:setup,served:{summary:{documentFetched:true,fileBytesServed:0}},answers:eye,installed:'0.1.0-beta.11'})).passed,false,'the file never went out');
  assert.equal((await buildReceipt({platform:'windows',hop:1,from:'0.1.0-beta.10',to:'0.1.0-beta.11',file:setup,served,answers:{},installed:'0.1.0-beta.11'})).passed,false,'unanswered is not yes');
  // the Mac rig's result.json
  const rig={passed:true,checks:['Existing tabs, workspace, settings and profile survive without uninstalling'],after:{version:'0.1.0-beta.11'},rehearsal:{from:{version:'0.1.0-beta.10'},to:{version:'0.1.0-beta.11',sha512:'zipsha'},fileBytes:226000000,feedRequests:3,primary:'503',primaryRequests:1}};
  const mac=await buildReceipt({platform:'mac',hop:1,rigResult:rig,answers:{updatePopupAndNotesRead:true}});
  assert.equal(mac.passed,true);assert.equal(mac.byEye.tabsWorkspaceSettingsBack,true,'the rig checked it itself');assert.equal(mac.automatic.primary,'503');
  assert.equal((await buildReceipt({platform:'mac',hop:1,rigResult:rig,answers:{}})).passed,false,'the popup and notes are for the founder to confirm');
  assert.equal((await buildReceipt({platform:'mac',hop:1,rigResult:{...rig,passed:false},answers:{updatePopupAndNotesRead:true}})).passed,false);
  assert.equal((await buildReceipt({platform:'mac',hop:1,rigResult:{...rig,rehearsal:{...rig.rehearsal,to:{version:'0.1.0-beta.11',sha512:null}}},answers:{updatePopupAndNotesRead:true}})).to.sha512,null,'a rig run on a raised-version stand-in has no real build behind it, and the release tool refuses it');
});

test('the handoff record: version, full commit, every file\'s hashes, the update address inside the build, the signature it carries', async t => {
  const dir=await temp(t),exe=Buffer.alloc(2000,3);exe.write('MZ');
  await fs.writeFile(path.join(dir,'AciraBrowserSetup.exe'),exe);await fs.writeFile(path.join(dir,'AciraBrowserSetup.exe.blockmap'),'map');await fs.writeFile(path.join(dir,'unrelated.txt'),'not part of it');
  await fs.writeFile(path.join(dir,'latest.yml'),JSON.stringify({version:'0.1.0-beta.11',files:[{url:'AciraBrowserSetup.exe',sha512:sha512(exe),size:exe.length}]}));
  await fs.writeFile(path.join(dir,'WINDOWS-BUILD-RESULT.json'),JSON.stringify({version:'0.1.0-beta.11',commit:'d'.repeat(40),updateConfig:{file:'resources/app-update.yml',url:'https://update.acirabrowser.com/'}}));
  const win=await describeBuild({platform:'windows',dir,machine:'laptop',now:new Date('2026-11-07T00:00:00Z')});
  assert.equal(win.version,'0.1.0-beta.11');assert.equal(win.commit,'d'.repeat(40));assert.equal(win.updateConfig.url,'https://update.acirabrowser.com/');assert.equal(win.signing.authenticode,'unchecked');
  assert.deepEqual(win.files.map(file=>file.name),['AciraBrowserSetup.exe','AciraBrowserSetup.exe.blockmap','WINDOWS-BUILD-RESULT.json','latest.yml'],'only the build\'s own files, sorted');
  assert.equal(win.files[0].sha512,sha512(exe));assert.equal(win.files[0].sha256,sha256(exe));
  const linuxDir=await temp(t);await fs.writeFile(path.join(linuxDir,'AciraBrowser-0.1.0-beta.11-linux-x86_64.AppImage'),Buffer.from([0x7f,0x45,0x4c,0x46,1,2,3]));await fs.writeFile(path.join(linuxDir,'LINUX-BUILD-RESULT.json'),JSON.stringify({sourceCommit:'e'.repeat(40)}));
  const lin=await describeBuild({platform:'linux',dir:linuxDir,appUpdateYml:'provider: "generic"\nurl: "https://update.acirabrowser.com/linux/"\n'});
  assert.equal(lin.version,'0.1.0-beta.11');assert.equal(lin.commit,'e'.repeat(40));assert.equal(lin.updateConfig.url,'https://update.acirabrowser.com/linux/');
  assert.equal((await describeBuild({platform:'linux',dir:linuxDir})).updateConfig,null,'an AppImage whose address cannot be read is not handed over (handoff refuses a record without one)');
});
