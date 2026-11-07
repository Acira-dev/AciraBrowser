'use strict';
// The pure rules of the one-command publish (packaging/release-publish.cjs) and the update site (packaging/update-site.cjs): what a handoff and a receipt must
// say, how the documents for each place are made, the order of writes, the frozen set, and the site that serves update.acirabrowser.com.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const P=require('../packaging/release-publish.cjs'),U=require('../packaging/update-publish.cjs'),S=require('../packaging/update-site.cjs'),T=require('../packaging/update-targets.cjs');

const HOST='https://update.acirabrowser.com/',GITHUB='https://raw.githubusercontent.com/Acira-dev/AciraBrowserUpdates/main/feed/';
const SHA='A'.repeat(86)+'==';
const doc=(version,extra={})=>({version,files:[{url:'https://github.com/Acira-dev/AciraBrowserUpdates/releases/download/v'+version+'-windows-abcdef12/AciraBrowserSetup.exe',sha512:SHA,size:1234}],releaseDate:'2026-11-06T00:00:00.000Z',...extra});
const feed=(file,document,platform='windows')=>({platform,file,text:U.serializeFeed(document),version:document.version,before:null,beforeText:''});

test('the order of writes: held uploads, then the rehearsal documents, then the tests, then the new host, then the GitHub feed, then the website; the freeze comes last', () => {
  const keys=P.STEPS.map(step=>step.key);
  assert.deepEqual(keys,['collect','verify','held','rehearsal','tests','host','bridge','real','unhold','soak','freeze','seal']);
  assert.ok(P.stepIndex('host')<P.stepIndex('bridge'),'update.acirabrowser.com is written before any beta.10 copy can be sent to the bridge release');
  assert.ok(P.stepIndex('bridge')<P.stepIndex('unhold'),'the website changes last');
  assert.deepEqual(P.STEPS.filter(step=>step.write).map(step=>step.key),['held','rehearsal','host','bridge','unhold','seal']);
  const state=P.emptyState({bridge:'0.1.0-beta.11',next:'0.1.0-beta.12'});
  assert.match(P.blockedBy(state,'host'),/collect/);
  for(const key of ['collect','verify','held','rehearsal'])state.done[key]=true;
  assert.equal(P.blockedBy(state,'host'),null,'the six receipts are read by go itself, not recorded beforehand');
  assert.match(P.blockedBy(state,'bridge'),/"host"/,'the GitHub feed waits for the new host');
  state.done.host=true;assert.equal(P.blockedBy(state,'bridge'),null);
  assert.match(P.blockedBy(state,'unhold'),/"bridge"/);
  assert.equal(P.nextStep(state).key,'tests','the next thing nobody has recorded is the tests');
  state.done.tests=true;assert.equal(P.nextStep(state).key,'bridge');
  assert.equal(P.stateName({bridge:'0.1.0-beta.11',next:'0.1.0-beta.12'}),'0.1.0-beta.11__0.1.0-beta.12.json');
});

const file=(bytes,name)=>({sha256:require('node:crypto').createHash('sha256').update(bytes).digest('hex'),sha512:require('node:crypto').createHash('sha512').update(bytes).digest('base64'),size:bytes.length,name});
function handoffFixture(extra={},platform='windows'){
  const exe=Buffer.from('setup bytes'),map=Buffer.from('blockmap bytes'),a=file(exe,'AciraBrowserSetup.exe'),b=file(map,'AciraBrowserSetup.exe.blockmap');
  const files=new Map([[a.name,a],[b.name,b],['HANDOFF.json',{sha256:'x',sha512:'y',size:1}]]);
  const handoff={schema:1,platform,version:'0.1.0-beta.11',commit:'a'.repeat(40),files:[a,b].map(({name,size,sha256,sha512})=>({name,size,sha256,sha512})),updateConfig:{file:'resources/app-update.yml',url:HOST},signing:{authenticode:'valid',subject:'CN=Acira, Inc.',evs:true},...extra};
  return {handoff,files};
}
test('a handoff: the files are the ones the machine recorded, the commit is whole, and the update address inside is one of ours', () => {
  const {handoff,files}=handoffFixture({updateConfig:{file:'resources/app-update.yml',url:HOST,publisherName:'Acira, Inc.'}});
  assert.deepEqual(P.checkHandoff(handoff,{platform:'windows',version:'0.1.0-beta.11',files}),[]);
  assert.match(P.checkHandoff(null,{platform:'windows',version:'x',files})[0],/missing/);
  assert.match(P.checkHandoff({...handoff,version:'0.1.0-beta.10'},{platform:'windows',version:'0.1.0-beta.11',files}).join(),/is version 0.1.0-beta.10/);
  assert.match(P.checkHandoff({...handoff,commit:'abc123'},{platform:'windows',version:'0.1.0-beta.11',files}).join(),/full source commit/);
  const swapped=new Map(files);swapped.set('AciraBrowserSetup.exe',{...files.get('AciraBrowserSetup.exe'),sha512:'other'});
  assert.match(P.checkHandoff(handoff,{platform:'windows',version:'0.1.0-beta.11',files:swapped}).join(),/replaced or damaged after the build/);
  const extra=new Map(files);extra.set('Other.exe',{sha256:'1',sha512:'2',size:3});
  assert.match(P.checkHandoff(handoff,{platform:'windows',version:'0.1.0-beta.11',files:extra}).join(),/Other.exe is in the folder but not in HANDOFF.json/);
  const missing=new Map(files);missing.delete('AciraBrowserSetup.exe.blockmap');
  assert.match(P.checkHandoff(handoff,{platform:'windows',version:'0.1.0-beta.11',files:missing}).join(),/lists AciraBrowserSetup.exe.blockmap, which was not handed over/);
  assert.match(P.checkHandoff({...handoff,updateConfig:{url:'https://example.org/'}},{platform:'windows',version:'0.1.0-beta.11',files}).join(),/not one of ours/);
  assert.deepEqual(P.checkHandoff({...handoff,updateConfig:{url:GITHUB,publisherName:'x'}},{platform:'windows',version:'0.1.0-beta.11',files}),[],'a build that still asks GitHub first needs no signature for the new host');
});
test('the host rule: a Windows or Linux build that asks update.acirabrowser.com first must be signed (Windows) or the founder must accept it', () => {
  const unsigned=handoffFixture({signing:{authenticode:'unsigned',subject:null,evs:false}});
  const args={platform:'windows',version:'0.1.0-beta.11',files:unsigned.files};
  assert.match(P.checkHandoff(unsigned.handoff,args).join(),/not Authenticode-signed with its publisher named/);
  assert.deepEqual(P.checkHandoff(unsigned.handoff,{...args,acceptUnsignedHost:true}),[]);
  const signedNoName=handoffFixture({signing:{authenticode:'valid',subject:'CN=Acira',evs:true}});
  assert.match(P.checkHandoff(signedNoName.handoff,{...args,files:signedNoName.files}).join(),/publisher named in app-update.yml/,'a valid signature is not enough while app-update.yml does not name the publisher');
  const linux=handoffFixture({platform:'linux',updateConfig:{url:HOST+'linux/'}},'linux');
  assert.match(P.checkHandoff(linux.handoff,{platform:'linux',version:'0.1.0-beta.11',files:linux.files}).join(),/Linux has no signature check/);
  assert.deepEqual(P.checkHandoff(linux.handoff,{platform:'linux',version:'0.1.0-beta.11',files:linux.files,acceptUnsignedHost:true}),[]);
  const github=handoffFixture({platform:'linux',updateConfig:{url:GITHUB+'linux/'}},'linux');
  assert.deepEqual(P.checkHandoff(github.handoff,{platform:'linux',version:'0.1.0-beta.11',files:github.files}),[]);
});

const receipt=(over={})=>({schema:1,platform:'windows',hop:1,passed:true,from:{version:'0.1.0-beta.10'},to:{version:'0.1.0-beta.11',sha512:SHA},automatic:{documentFetched:true,fileBytesServed:11400000,installedVersion:'0.1.0-beta.11'},byEye:{noSetupWindow:true,reopenedWithinTwoMinutes:true,tabsBack:true,noSecurityOrAntivirusPrompt:true},...over});
const expectation={platform:'windows',hop:1,from:{version:'0.1.0-beta.10'},to:{version:'0.1.0-beta.11',sha512:SHA,size:229231924}};
test('a receipt: passed, the right versions, bound to the exact file, the app read the document and fetched the file, and every by-eye answer is yes', () => {
  assert.deepEqual(P.checkReceipt(receipt(),expectation),[]);
  assert.match(P.checkReceipt(null,expectation)[0],/no receipt/);
  assert.match(P.checkReceipt(receipt({passed:false}),expectation).join(),/did not pass/);
  assert.match(P.checkReceipt(receipt({to:{version:'0.1.0-beta.11',sha512:'rebuilt'}}),expectation).join(),/another file than the one being published/);
  assert.match(P.checkReceipt(receipt({from:{version:'0.1.0-beta.9'}}),expectation).join(),/started from 0.1.0-beta.9/);
  assert.match(P.checkReceipt(receipt({automatic:{documentFetched:false,fileBytesServed:0,installedVersion:'0.1.0-beta.11'}}),expectation).join(),/did not see the app read the document/);
  assert.match(P.checkReceipt(receipt({automatic:{documentFetched:true,fileBytesServed:5,installedVersion:'0.1.0-beta.10'}}),expectation).join(),/reports 0.1.0-beta.10/);
  assert.match(P.checkReceipt(receipt({byEye:{noSetupWindow:true,reopenedWithinTwoMinutes:true,tabsBack:true,noSecurityOrAntivirusPrompt:false}}),expectation).join(),/noSecurityOrAntivirusPrompt" was not confirmed/);
  assert.match(P.checkReceipt(receipt({platform:'linux'}),expectation).join(),/receipt is for linux/);
  const two={platform:'windows',hop:2,from:{version:'0.1.0-beta.11',sha512:'bridge'},to:{version:'0.1.0-beta.12',sha512:SHA,size:1}};
  assert.deepEqual(P.checkReceipt(receipt({hop:2,from:{version:'0.1.0-beta.11',sha512:'bridge'},to:{version:'0.1.0-beta.12',sha512:SHA}, automatic:{documentFetched:true,fileBytesServed:1,installedVersion:'0.1.0-beta.12'}}),two),[]);
  assert.match(P.checkReceipt(receipt({hop:2,from:{version:'0.1.0-beta.11',sha512:'another bridge build'},to:{version:'0.1.0-beta.12',sha512:SHA},automatic:{documentFetched:true,fileBytesServed:1,installedVersion:'0.1.0-beta.12'}}),two).join(),/another build than the one being published as the bridge/);
});

test('the documents for each place: the GitHub feed gets the bridge at 10% with no pace, the new host the next release at everyone with a pace, the test folders a copy at everyone', () => {
  const bridge=[feed('beta.yml',doc('0.1.0-beta.11',{stagingPercentage:50,halted:{at:'x',percentage:10},nextCheckSeconds:900}))];
  const legacy=JSON.parse(P.bridgeDocuments(bridge)[0].text);
  assert.equal(legacy.stagingPercentage,P.BRIDGE_ROLLOUT);assert.equal(legacy.nextCheckSeconds,undefined);assert.equal(legacy.halted,undefined);
  const rehearsal=P.underFolder(bridge,P.REHEARSAL_PATH)[0];
  assert.equal(rehearsal.file,'rehearsal/beta.yml');assert.equal(rehearsal.rewrite,true);assert.equal(JSON.parse(rehearsal.text).stagingPercentage,undefined,'a test copy is offered it at once');
  const next=[feed('linux/beta-linux.yml',doc('0.1.0-beta.12'),'linux')];
  const host=JSON.parse(P.hostDocuments(next)[0].text);
  assert.equal(host.nextCheckSeconds,P.NEXT_CHECK_SECONDS);assert.equal(host.stagingPercentage,undefined);
  assert.equal(P.underFolder(next,P.TESTERS_PATH)[0].file,'testers/linux/beta-linux.yml');
  assert.ok(P.sameOffer(host,doc('0.1.0-beta.12')),'only the pace and the share differ');
  assert.ok(!P.sameOffer(host,doc('0.1.0-beta.13')));
  // and every one of them is read by electron-updater the way an installed app reads it
  for(const text of [P.bridgeDocuments(bridge)[0].text,rehearsal.text,P.hostDocuments(next)[0].text])assert.ok(U.readWithUpdater(text,{file:'beta.yml'}).files.length>0);
});

test('the frozen set records the documents in their frozen form, every file they name and every blockmap they point at; a change or a missing file is a problem', () => {
  const frozen=feed('beta.yml',doc('0.1.0-beta.11',{stagingPercentage:10,previousBlockMaps:[{version:'0.1.0-beta.10',url:'https://github.com/x/y/releases/download/v0.1.0-beta.10-windows-aaaaaaaa/AciraBrowserSetup.exe.blockmap'}]}));
  const manifest=P.frozenManifest({documents:[{file:'beta.yml',text:frozen.text}],generatedAt:'2026-11-20T00:00:00.000Z'});
  assert.deepEqual(manifest.entries.map(entry=>entry.kind),['document','asset','blockmap']);
  const url=manifest.entries[1].url,block=manifest.entries[2].url;
  const live={documents:new Map([['beta.yml',U.serializeFeed(doc('0.1.0-beta.11',{previousBlockMaps:[{version:'0.1.0-beta.10',url:block}]}))]]),assets:new Map([[url,{ok:true,size:1234}],[block,{ok:true}]])};
  assert.deepEqual(P.checkFrozen(manifest,live),[],'the staging field is not part of the frozen form');
  live.assets.set(url,{ok:false});assert.match(P.checkFrozen(manifest,live).join(),/no longer answers/);
  live.assets.set(url,{ok:true,size:99});assert.match(P.checkFrozen(manifest,live).join(),/another size/);
  live.assets.set(url,{ok:true,size:1234});live.documents.set('beta.yml',U.serializeFeed(doc('0.1.0-beta.12')));assert.match(P.checkFrozen(manifest,live).join(),/has changed/);
  live.documents.delete('beta.yml');assert.match(P.checkFrozen(manifest,live).join(),/is missing/);
});

test('the next release must be the bridge release plus its version number', () => {
  assert.deepEqual(P.nextIsBridgePlusBump({changed:['package.json','package-lock.json'],versionOnly:true}),[]);
  assert.match(P.nextIsBridgePlusBump({changed:['package.json','desktop/main.cjs'],versionOnly:true})[0],/also changes desktop\/main.cjs/);
  assert.match(P.nextIsBridgePlusBump({changed:['package.json'],versionOnly:false})[0],/more than the version number/);
  assert.deepEqual(P.nextIsBridgePlusBump({changed:[],versionOnly:true}),[],'the same files (a rebuilt copy) is fine');
});

// --- the update site ---
const parse=text=>JSON.parse(text);
const site=(extra={})=>{const files=S.staticSite();for(const [name,text] of Object.entries(extra))if(text===null)files.delete(name);else files.set(name,Buffer.from(text));return files;};
test('the update site: the static files are right, the channel documents are checked, and anything else is refused', () => {
  assert.deepEqual(S.checkSite(S.staticSite(),{parse}),[]);
  assert.equal(S.staticSite().get('CNAME').toString().trim(),'update.acirabrowser.com');
  assert.equal(S.staticSite().get('latest.yml').length,119,'the same placeholder bytes as the GitHub feed');
  const good=U.serializeFeed(doc('0.1.0-beta.12'));
  assert.deepEqual(S.checkSite(site({'beta.yml':good,'testers/beta.yml':good,'rehearsal/linux/beta-linux.yml':good}),{parse}),[]);
  assert.match(S.checkSite(site({'AciraBrowserSetup.exe':'MZ'}),{parse}).join(),/does not belong on the update site/);
  assert.match(S.checkSite(site({CNAME:'example.com\n'}),{parse}).join(),/CNAME must say update.acirabrowser.com/);
  assert.match(S.checkSite(site({CNAME:null}),{parse}).join(),/CNAME is missing/);
  assert.match(S.checkSite(site({'.nojekyll':null}),{parse}).join(),/nojekyll is missing/);
  assert.match(S.checkSite(site({'latest.yml':null,'latest-mac.yml':null}),{parse}).join(),/latest.yml is missing/);
  assert.match(S.checkSite(site({'beta.yml':'{"version":"soon","files":[]}'}),{parse}).join(),/not a usable channel document/);
  assert.match(S.checkSite(site({'beta.yml':'<html>'}),{parse}).join(),/cannot be read/);
  assert.match(S.checkSite(site({'beta.yml':'{"version":"0.1.0-beta.12","files":[]}'}),{parse}).join(),/offers 0.1.0-beta.12 with no files/);
  assert.match(S.checkSite(site({'beta.yml':JSON.stringify({version:'0.1.0-beta.12',files:[{url:'http://insecure.example/x.exe',sha512:SHA,size:5}]})}),{parse}).join(),/not an https address/);
  assert.match(S.checkSite(site({'beta.yml':JSON.stringify({version:'0.1.0-beta.12',files:[{url:'https://github.com/x',sha512:'short',size:5}]})}),{parse}).join(),/no valid SHA-512/);
  assert.match(S.checkSite(site({'index.html':'<script src="https://cdn.example/x.js"></script>'}),{parse}).join(),/no scripts/);
  assert.match(S.checkSite(site({'404.html':'<a href="https://tracker.example/">x</a>'}),{parse}).join(),/links to https:\/\/tracker.example/);
});
test('the static site files: no scripts, no outside resources, a robots.txt that keeps the test folders out of search, and nothing that was not meant to be there', () => {
  const listed=[...S.staticSite().keys()].sort();
  assert.deepEqual(listed,['.nojekyll','404.html','CNAME','index.html','latest-mac.yml','latest.yml','linux/latest-linux.yml','robots.txt']);
  for(const name of ['index.html','404.html']){const html=S.staticSite().get(name).toString();assert.doesNotMatch(html,/<script|<iframe|analytics|@font-face|fonts\.|@import/i);}
  assert.match(S.staticSite().get('robots.txt').toString(),/Disallow: \/testers\//);
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'acira-site-'));
  try{const written=S.writeStatic(dir);assert.deepEqual(written.sort(),listed);assert.deepEqual([...S.listSite(dir).keys()].sort(),listed);assert.deepEqual(S.checkSite(S.listSite(dir),{parse}),[]);}
  finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('the targets: the GitHub feed is folder feed/, the new host is folder docs/, the handoff goes to the private source repository, and the repository for the next releases is one line in a file', () => {
  const t=T.targets();
  assert.equal(t.legacy.dir,'feed');assert.equal(t.legacy.publicBase,GITHUB);assert.equal(t.current.dir,'docs');assert.equal(t.current.publicBase,HOST);
  assert.equal(t.handoffRepo,'Acira-dev/AciraBrowser-dev');
  const file=path.join(os.tmpdir(),'acira-targets-'+process.pid+'.json');
  fs.writeFileSync(file,JSON.stringify({legacyRepo:'Acira-dev/AciraBrowserUpdates',currentRepo:'Acira-dev/AciraBrowserUpdatesNext',handoffRepo:'Acira-dev/AciraBrowser-dev'}));
  try{assert.equal(T.targets(T.loadConfig(file)).current.repo,'Acira-dev/AciraBrowserUpdatesNext');assert.equal(T.targets(T.loadConfig(file)).legacy.repo,'Acira-dev/AciraBrowserUpdates');}finally{fs.rmSync(file);}
  fs.writeFileSync(file,JSON.stringify({legacyRepo:'bad',currentRepo:'a/b',handoffRepo:'a/b'}));
  try{assert.throws(()=>T.loadConfig(file),/legacyRepo/);}finally{fs.rmSync(file);}
});
