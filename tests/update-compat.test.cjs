'use strict';
// The check scripts/publish-update.mjs makes before it switches the feed (packaging/update-compat.cjs, beta.14 item 14): every older version still in use
// (beta.8 and later) reads the documents as they will be live and must be offered something newer, with files that are named the way its updater
// picks them, have a SHA-512 and a size, and are really there. A failure stops the publish. Everything here is a fake web: no network.
const test=require('node:test'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const {preflight,versionsInUse,GITHUB,HOST}=require('../packaging/update-compat.cjs');
const U=require('../packaging/update-publish.cjs');

const NEW='0.1.0-beta.14',sha512=buf=>createHash('sha512').update(buf).digest('base64');
const REPO='https://github.com/Acira-dev/AciraBrowserUpdates/releases/download/';
const bytesOf={};
/** A release file on the fake GitHub: its bytes are remembered under its URL. */
function file(tag,name,text){const data=Buffer.from(text||tag+name);bytesOf[REPO+tag+'/'+name]=data;return {url:REPO+tag+'/'+name,sha512:sha512(data),size:data.length};}
const docFor=(platform,version,tag)=>{
 const files=platform==='mac'?['arm64','x64'].map(arch=>file(tag,`AciraBrowser-${version}-mac-${arch}-update.zip`)):platform==='windows'?[file(tag,'AciraBrowserSetup.exe')]:[file(tag,`AciraBrowser-${version}-linux-x86_64.AppImage`)];
 return {version,files,path:files[0].url,sha512:files[0].sha512,releaseDate:'2026-11-08T00:00:00.000Z',...(platform==='windows'?{previousBlockMaps:[{version:'0.1.0-beta.13',url:file(tag,'old.blockmap','map').url}]}:{})};
};
const ALL=['mac','windows','linux'];
/** The web: the frozen GitHub feed (beta.11) and the host (what a publish plans), files by URL. */
function world({planned=ALL,mangle=()=>{},web={},ranged=true}={}){
 const docs={},feeds=[];
 for(const platform of ALL){
  const file_=U.feedFiles('beta',platform)[0];
  docs[GITHUB+file_]=JSON.stringify(docFor(platform,'0.1.0-beta.11','v0.1.0-beta.11-'+platform+'-aaaaaaaa'));
  docs[HOST+file_]=JSON.stringify(docFor(platform,'0.1.0-beta.13','v0.1.0-beta.13-'+platform+'-bbbbbbbb'));
  if(planned.includes(platform))feeds.push({platform,file:file_,text:JSON.stringify(docFor(platform,NEW,'v0.1.0-beta.14-'+platform+'-cccccccc'))});
 }
 const plan={version:NEW,mode:'release',target:{publicBase:HOST},feeds,releases:[]};
 mangle({docs,plan});
 const calls=[];
 const fetch=async(url,init={})=>{
  calls.push(url);
  if(web[url]===404)return new Response('',{status:404});
  if(docs[url]!==undefined)return new Response(docs[url],{status:200});
  const data=bytesOf[url];
  if(!data)return new Response('',{status:404});
  const range=init.headers?.range;
  if(range&&ranged)return new Response(data.subarray(0,1),{status:206,headers:{'content-range':`bytes 0-0/${data.length}`}});
  return new Response(data,{status:200,headers:{'content-length':String(data.length)}});
 };
 return {plan,fetch,docs,calls};
}
const run=(w,extra={})=>preflight({plan:w.plan,fetch:w.fetch,sleep:async()=>{},delays:[],...extra});

test('a fix release is checked against the betas before it: 0.1.0-beta.13.1 reaches beta.8 to beta.13 (a fix updates through the same feed paths as the beta it fixes)',()=>{
 const ids=version=>versionsInUse(version).map(item=>item.version);
 assert.deepEqual(ids('0.1.0-beta.13.1'),['0.1.0-beta.8','0.1.0-beta.9','0.1.0-beta.10','0.1.0-beta.11','0.1.0-beta.12','0.1.0-beta.13'],'13.1: beta.8 to beta.13, not itself');
 assert.deepEqual(ids('0.1.0-beta.13.2'),ids('0.1.0-beta.13.1'));
 assert.deepEqual(versionsInUse('0.1.0-beta.13.1').find(item=>item.version==='0.1.0-beta.13').reads,[HOST,GITHUB]);
 assert.deepEqual(ids('0.1.0-beta.13'),['0.1.0-beta.8','0.1.0-beta.9','0.1.0-beta.10','0.1.0-beta.11','0.1.0-beta.12'],'beta.13 itself: nothing newer than it is checked');
 assert.deepEqual(ids('0.1.0-beta.14'),ids('0.1.0-beta.13.1').concat([]),'beta.14 is checked against the same list');
});
test('the versions in use: beta.8 to beta.10 read only the GitHub feed (Linux from beta.10), beta.11 and later the host first',()=>{
 const list=versionsInUse(NEW);
 assert.deepEqual(list.map(item=>item.version),['0.1.0-beta.8','0.1.0-beta.9','0.1.0-beta.10','0.1.0-beta.11','0.1.0-beta.12','0.1.0-beta.13']);
 assert.deepEqual(list[0].reads,[GITHUB]);assert.deepEqual(list[0].platforms,['mac','windows']);assert.deepEqual(list[2].platforms,ALL);
 assert.deepEqual(list[3].reads,[HOST,GITHUB]);
 assert.deepEqual(versionsInUse('0.1.0-beta.11').map(item=>item.version),['0.1.0-beta.8','0.1.0-beta.9','0.1.0-beta.10'],'a version is never checked against itself or newer ones');
});

test('a good publish: every version in use reaches the new one on every platform, every file is there',async()=>{
 const w=world(),result=await run(w);
 assert.deepEqual(result.problems,[],result.problems.join('\n'));assert.equal(result.ok,true);
 assert.equal(result.paths.length,2*2+3+3*3,'beta.8, beta.9 (Mac, Windows), beta.10 (+Linux), beta.11 to beta.13 (all three)');
 const byVersion=version=>result.paths.filter(item=>item.version===version);
 assert.ok(byVersion('0.1.0-beta.9').every(item=>item.offers==='0.1.0-beta.11'&&item.reads.startsWith(GITHUB)),'the oldest read the frozen GitHub feed and are offered the bridge');
 assert.ok(byVersion('0.1.0-beta.12').every(item=>item.offers===NEW&&item.reads.startsWith(HOST)),'beta.11 and later read the host, which will offer the new version');
 assert.ok(result.probed>=8,'the files and the blockmap were asked for');
});

test('a document that names a file that is not there stops the publish (planned file, frozen file, and a blockmap)',async()=>{
 const planned=world();const winDoc=JSON.parse(planned.plan.feeds.find(feed=>feed.platform==='windows').text);delete bytesOf[winDoc.files[0].url];
 let result=await run(planned);
 assert.equal(result.ok,false);assert.match(result.problems.join('\n'),/AciraBrowserSetup\.exe is not there \(HTTP 404\)/);
 const frozen=world(),beta11=JSON.parse(frozen.docs[GITHUB+'beta-mac.yml']);delete bytesOf[beta11.files[1].url];
 result=await run(frozen);assert.match(result.problems.join('\n'),/0\.1\.0-beta\.8 on mac.*mac-x64-update\.zip is not there/s,'the oldest cannot reach the bridge (named once, at the first version that reads that document)');
 const map=world(),mapDoc=JSON.parse(map.plan.feeds.find(feed=>feed.platform==='windows').text);delete bytesOf[mapDoc.previousBlockMaps[0].url];
 result=await run(map);assert.match(result.problems.join('\n'),/the blockmap .*old\.blockmap is not there/);
});

test('a size or SHA-512 that is not the file\'s stops the publish',async()=>{
 const size=world({mangle:({plan})=>{const feed=plan.feeds.find(item=>item.platform==='linux'),doc=JSON.parse(feed.text);doc.files[0].size+=1;feed.text=JSON.stringify(doc);}});
 assert.match((await run(size)).problems.join('\n'),/AppImage is \d+ bytes there, the document says \d+/);
 const hash=world({mangle:({plan})=>{const feed=plan.feeds.find(item=>item.platform==='mac'),doc=JSON.parse(feed.text);doc.files[0].sha512='not a hash';feed.text=JSON.stringify(doc);}});
 assert.match((await run(hash)).problems.join('\n'),/no SHA-512 of the right shape/);
});

test('files named the way no updater can pick them stop the publish: a Mac ZIP without its architecture, two setups, no AppImage',async()=>{
 const mac=world({mangle:({plan})=>{const feed=plan.feeds.find(item=>item.platform==='mac'),doc=JSON.parse(feed.text);const odd=file('v0.1.0-beta.14-mac-cccccccc','AciraBrowser-update.zip');doc.files=[odd];feed.text=JSON.stringify(doc);}});
 assert.match((await run(mac)).problems.join('\n'),/not named AciraBrowser-<version>-mac-<arch>-update\.zip/);
 const win=world({mangle:({plan})=>{const feed=plan.feeds.find(item=>item.platform==='windows'),doc=JSON.parse(feed.text);doc.files.push(file('v0.1.0-beta.14-windows-cccccccc','Other.exe'));feed.text=JSON.stringify(doc);}});
 assert.match((await run(win)).problems.join('\n'),/expected exactly one setup \(\.exe\), the document names 2/);
 const none=world({mangle:({plan})=>{const feed=plan.feeds.find(item=>item.platform==='linux'),doc=JSON.parse(feed.text);doc.files=[];delete doc.path;delete doc.sha512;feed.text=JSON.stringify(doc);}});
 assert.match((await run(none)).problems.join('\n'),/cannot be read by electron-updater \(No files provided/);
});

test('an older version that cannot read its document, or is offered nothing newer, or is stranded by the frozen feed, stops the publish',async()=>{
 const gone=world({web:{[GITHUB+'beta.yml']:404},mangle:({docs})=>{delete docs[GITHUB+'beta.yml'];}});
 assert.match((await run(gone)).problems.join('\n'),/0\.1\.0-beta\.8 on windows: cannot read beta\.yml the way that version does/);
 const behind=world({mangle:({docs})=>{docs[GITHUB+'beta-mac.yml']=JSON.stringify(docFor('mac','0.1.0-beta.8','v0.1.0-beta.8-mac-dddddddd'));}});
 assert.match((await run(behind)).problems.join('\n'),/0\.1\.0-beta\.8 on mac: .* offers 0\.1\.0-beta\.8, not newer than itself/);
 const stuck=world({mangle:({docs})=>{docs[GITHUB+'beta-mac.yml']=JSON.stringify(docFor('mac','0.1.0-beta.10','v0.1.0-beta.10-mac-eeeeeeee'));}});
 assert.match((await run(stuck)).problems.join('\n'),/0\.1\.0-beta\.9 on mac: the GitHub feed offers 0\.1\.0-beta\.10, which does not read the host/,'a bridge that is not the host-reading beta.11 would stop them');
 const halted=world({mangle:({plan})=>{const feed=plan.feeds.find(item=>item.platform==='windows'),doc=JSON.parse(feed.text);doc.stagingPercentage=0;feed.text=JSON.stringify(doc);}});
 assert.match((await run(halted)).problems.join('\n'),/offers 0\.1\.0-beta\.14 to nobody \(halted\)/);
});

test('a planned host document the app cannot use falls back to GitHub exactly as the app does: beta.11 and later then see only the frozen version, which is not newer, and the publish stops',async()=>{
 const w=world({mangle:({plan})=>{plan.feeds.find(feed=>feed.platform==='mac').text='<html>not a channel document</html>';}});
 const result=await run(w);
 assert.match(result.problems.join('\n'),/0\.1\.0-beta\.12 on mac: cannot read beta-mac\.yml the way that version does/);
 assert.ok(!/0\.1\.0-beta\.9 on mac/.test(result.problems.join('\n')),'the oldest read only the frozen feed and are unaffected');
 const viaGitHub=world({mangle:({docs,plan})=>{plan.target={publicBase:GITHUB};delete docs[HOST+'beta-mac.yml'];}});
 assert.equal((await run(viaGitHub)).paths.some(item=>item.version==='0.1.0-beta.12'&&item.platform==='mac'),true,'a host that is down is covered when the GitHub feed carries the new version');
});

test('a host that ignores Range is a warning (downloads restart after a drop), not a stop; a dry run takes the files it will upload as there',async()=>{
 const w=world({ranged:false}),result=await run(w);
 assert.equal(result.ok,true);assert.match(result.warnings.join('\n'),/does not honour a Range request/);
 const dry=world();const doc=JSON.parse(dry.plan.feeds[0].text);const url=doc.files[0].url;delete bytesOf[url];
 dry.plan.releases=[{assets:[{url,size:doc.files[0].size}]}];
 assert.equal((await run(dry)).ok,false,'a real run needs the file to be there');
 assert.equal((await run(dry,{assumePlanned:true})).ok,true,'a dry run has not uploaded it yet');
});

test('a file host that never answers stops the publish with a reason instead of hanging it',async()=>{
 const w=world(),inner=w.fetch;
 w.fetch=(url,init)=>url.includes('/releases/download/v0.1.0-beta.14-windows')?new Promise((resolve,reject)=>init.signal.addEventListener('abort',()=>reject(Object.assign(Error('aborted'),{name:'AbortError'})))):inner(url,init);
 const result=await preflight({plan:w.plan,fetch:w.fetch,sleep:async()=>{},delays:[],timeout:30});
 assert.equal(result.ok,false);assert.match(result.problems.join('\n'),/AciraBrowserSetup\.exe is not there \(no answer within \d+ s\)/);
});

test('only the platforms this publish writes are checked, and a publish with no channel document checks nothing',async()=>{
 const w=world({planned:['mac']}),result=await run(w);
 assert.ok(result.paths.every(item=>item.platform==='mac'));assert.equal(result.paths.length,2+1+3);
 const none=await run(world({planned:[]}));assert.equal(none.ok,true);assert.equal(none.paths.length,0);
});

test('publish-update.mjs runs the check after the payloads are verified and before the feed commit, and a failure leaves the feed untouched',async()=>{
 const text=require('node:fs').readFileSync(require('node:path').join(__dirname,'../scripts/publish-update.mjs'),'utf8');
 const verified=text.indexOf('await Promise.all(workers);'),check=text.indexOf('await compatCheck({plan,deps,fetch,sleep,delays})'),commit=text.indexOf('state.feedCommit=await commitFeed(');
 assert.ok(verified>0&&verified<check&&check<commit,'verify payloads, then older versions, then the feed commit');
 const {compatCheck}=await import('../scripts/publish-update.mjs');
 const bad={ok:false,problems:['0.1.0-beta.9 on mac: nothing newer'],warnings:[],paths:[],probed:0};
 await assert.rejects(compatCheck({plan:{version:NEW},deps:{compat:async()=>bad}}),/Some older versions could not reach 0\.1\.0-beta\.14, so nothing was published to the feed:\n  - 0\.1\.0-beta\.9 on mac: nothing newer/);
 const good=await compatCheck({plan:{version:NEW},deps:{compat:async()=>({ok:true,problems:[],warnings:['w'],paths:[1],probed:1})}});assert.equal(good.paths.length,1);
});
