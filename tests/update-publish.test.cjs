'use strict';
// The rules behind scripts/publish-update.mjs: which versions may ship, how releases and files are named (the website depends on it), and that the
// channel documents it writes are read correctly by the real electron-updater (the same parser, version comparison and architecture choice the app uses).
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),http=require('node:http'),{createHash}=require('node:crypto');
const semver=require('semver');
const U=require('../packaging/update-publish.cjs');
const {writeMacUpdateFeed}=require('../packaging/macos/update-feed.cjs');
const {MacUpdater}=require('electron-updater/out/MacUpdater');
const {AppUpdater}=require('electron-updater/out/AppUpdater');
const {NodeHttpExecutor}=require('builder-util/out/nodeHttpExecutor');
const {findFile}=require('electron-updater/out/providers/Provider');

test('only plain release versions ship, on the channel that matches them',()=>{
 assert.deepEqual(U.versionProblems('0.1.0-beta.7','beta'),[]);
 assert.deepEqual(U.versionProblems('0.1.0','stable'),[]);
 assert.match(U.versionProblems('0.1.0-beta.6.local.4','beta')[0],/not a release version/,'a local build never goes to users');
 assert.match(U.versionProblems('0.1.0','beta')[0],/use --channel stable/);
 assert.match(U.versionProblems('0.1.0-beta.7','stable')[0],/use --channel beta/);
 assert.match(U.versionProblems('beta 7','beta')[0],/not a version/);
 assert.match(U.versionProblems('0.1.0-beta.7','nightly')[0],/beta or stable/);
});
test('a release has to beat both shipped builds and the live feed, not just one of them',()=>{
 const references=[...U.SHIPPED.map(item=>({label:item.what,version:item.version})),{label:'the live feed beta-mac.yml',version:'0.1.0-beta.4'}];
 assert.deepEqual(U.newerProblems('0.1.0-beta.7',references),[]);
 assert.equal(U.newerProblems('0.1.0-beta.6.local.4',references).length,1,'the shipped Mac build is the same version, not newer; it does sort above the shipped Windows beta.6');
 assert.match(U.newerProblems('0.1.0-beta.6.local.4',references).join(' '),/not newer than 0\.1\.0-beta\.6\.local\.4 \(the Mac build/);
 assert.equal(U.newerProblems('0.1.0-beta.6',references).length,2,'beta.6 is no upgrade for either shipped build');
 assert.equal(U.newerProblems('0.1.0-beta.5',references).length,2);
 assert.equal(U.newerProblems('0.1.0-beta.3',references).length,3,'and not even the live feed');
 assert.deepEqual(U.newerProblems('0.1.0-beta.7',[{label:'x',version:null}]),[],'nothing to compare is not a problem');
 assert.deepEqual(U.newerProblems('0.1.0-beta.7',[{label:'sentinel',version:'0.0.0'}]),[],'the 0.0.0 standby documents are below every release');
 assert.equal(semver.gt('0.1.0-beta.7','0.1.0-beta.6.local.4'),true);
 assert.equal(U.WINDOWS_VERSION.test('0.1.0-beta.7'),true);assert.equal(U.WINDOWS_VERSION.test('0.1.0-beta.6.local.4'),false);
});
test('which channel documents a release rewrites: stable also reaches people who follow beta',()=>{
 assert.deepEqual(U.feedFiles('beta','mac'),['beta-mac.yml']);assert.deepEqual(U.feedFiles('beta','windows'),['beta.yml']);
 assert.deepEqual(U.feedFiles('stable','mac'),['latest-mac.yml','beta-mac.yml']);assert.deepEqual(U.feedFiles('stable','windows'),['latest.yml','beta.yml']);
});
test('release tags keep the website working: platform and version are readable from the tag the way marketing/website/releases.js reads them',()=>{
 const commit='b62c4715130a8f17182dced8e94e7fc56425c4c7';
 const mac=U.releaseTag({version:'0.1.0-beta.7',platform:'mac',commit}),windows=U.releaseTag({version:'0.1.0-beta.7',platform:'windows',commit});
 assert.equal(mac,'v0.1.0-beta.7-mac-b62c4715');assert.equal(windows,'v0.1.0-beta.7-windows-b62c4715');
 // the website's own rules, copied: mac = /mac/i, windows = /windows/i, version = what comes before -mac or -windows
 for(const [tag,platform] of [[mac,'mac'],[windows,'windows']]){
  assert.equal(/mac/i.test(tag),platform==='mac');assert.equal(/windows/i.test(tag),platform==='windows');
  assert.equal(/^v?(.+?)-(?:mac|windows)/i.exec(tag)[1],'0.1.0-beta.7','both releases of a version share one label, so the download page lists them together');
 }
 assert.throws(()=>U.releaseTag({version:'0.1.0-beta.7',platform:'linux',commit}),/Unknown platform/);
 assert.throws(()=>U.releaseTag({version:'0.1.0-beta.7',platform:'mac',commit:'main'}),/commit/);
});
test('asset URLs are the exact public release URLs, and names GitHub would rewrite are refused',()=>{
 assert.equal(U.assetUrl('v0.1.0-beta.7-mac-b62c4715','AciraBrowser-0.1.0-beta.7-mac-arm64-update.zip'),'https://github.com/Acira-dev/AciraBrowserUpdates/releases/download/v0.1.0-beta.7-mac-b62c4715/AciraBrowser-0.1.0-beta.7-mac-arm64-update.zip');
 assert.throws(()=>U.assetUrl('v1','Acira Browser.zip'),/renamed by GitHub/);
 assert.throws(()=>U.assetUrl('v1','../x.zip'),/renamed by GitHub/);
});
test('release notes: bullets under "What\'s new" for the release page, plain bullets for the in-app popup',()=>{
 const wrapped=U.releaseNotes('Tabs resume faster\n- Sidebar fix\n* Another\n');
 assert.equal(wrapped.markdown,"## What's new\n- Tabs resume faster\n- Sidebar fix\n- Another\n");assert.equal(wrapped.plain,'- Tabs resume faster\n- Sidebar fix\n- Another');
 const own=U.releaseNotes("## What's new\n- One\n- Two\n\n## Known issues\n- Three\n");
 assert.equal(own.plain,'- One\n- Two','only the What\'s new bullets reach the popup');assert.match(own.markdown,/Known issues/,'the release page keeps the whole text');
 assert.deepEqual(U.releaseNotes('  \n'),{markdown:'',plain:''});
 // the website lists exactly the bullets under that heading
 const site=/^#{1,4}\s*What's new\s*$([\s\S]*?)(?=^#{1,4}\s|(?![\s\S]))/im.exec(wrapped.markdown);assert.equal(site[1].split('\n').filter(l=>/^[-*]\s+/.test(l.trim())).length,3);
});
test('checksums list every file with its SHA-256, sorted',()=>{
 assert.equal(U.checksumsText([{name:'b.zip',sha256:'22'},{name:'a.dmg',sha256:'11'},{name:'no-hash'}]),'11  a.dmg\n22  b.zip\n');
});

async function macFeedFixture(t,version='0.1.0-beta.7'){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'acira-publish-lib-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const artifacts=[];for(const arch of ['arm64','x64']){const zip=path.join(dir,`AciraBrowser-${version}-mac-${arch}-update.zip`);await fs.writeFile(zip,'zip bytes '+arch);artifacts.push({arch,zip});}
 const base=await writeMacUpdateFeed({output:dir,version,artifacts});
 return {dir,artifacts,baseText:await fs.readFile(base.file,'utf8'),base};
}
test('the Mac channel document: absolute release URLs, the real updater reads it and hands each architecture its own archive',async t=>{
 const {baseText}=await macFeedFixture(t),tag='v0.1.0-beta.7-mac-b62c4715';
 const doc=U.finalizeMacFeed(baseText,{urlFor:name=>U.assetUrl(tag,name),releaseName:'Acira Browser 0.1.0-beta.7',releaseNotes:'- Faster'}),text=U.serializeFeed(doc);
 const {info,files}=U.readWithUpdater(text,{file:'beta-mac.yml'});
 assert.equal(info.version,'0.1.0-beta.7');assert.equal(files.length,2);
 for(const file of files)assert.match(file.url.href,/^https:\/\/github\.com\/Acira-dev\/AciraBrowserUpdates\/releases\/download\/v0\.1\.0-beta\.7-mac-b62c4715\/AciraBrowser-0\.1\.0-beta\.7-mac-(arm64|x64)-update\.zip$/);
 const arm=MacUpdater.filterFilesForArch(files,true),intel=MacUpdater.filterFilesForArch(files,false);
 assert.equal(arm.length,1);assert.match(arm[0].url.href,/-arm64-update\.zip$/);assert.equal(intel.length,1);assert.match(intel[0].url.href,/-x64-update\.zip$/);
 assert.equal(doc.path,doc.files[0].url,'the legacy path names the first payload by its absolute URL');assert.equal(doc.sha512,doc.files[0].sha512);
 for(const file of doc.files){assert.match(file.sha512,/^[A-Za-z0-9+/]{86}==$/);assert.ok(file.size>0);}
 assert.deepEqual(Object.keys(doc),['version','files','path','sha512','releaseDate','minimumSystemVersion','releaseName','releaseNotes'],'the same layout the live beta-mac.yml already has');
 assert.equal(U.finalizeMacFeed(baseText,{urlFor:n=>n,releaseName:'x',releaseNotes:''}).releaseNotes,undefined,'no notes, no empty field');
});
test('the Windows channel document is a valid electron-updater document for the setup exe',async t=>{
 const file={name:'AciraBrowserSetup.exe',size:123456789,sha512:createHash('sha512').update('setup').digest('base64')},tag='v0.1.0-beta.7-windows-b62c4715';
 const doc=U.windowsFeed({version:'0.1.0-beta.7',file,url:U.assetUrl(tag,file.name),releaseDate:'2026-11-02T04:08:24.003Z',releaseName:'Acira Browser 0.1.0-beta.7',releaseNotes:'- Faster'});
 const {info,files}=U.readWithUpdater(U.serializeFeed(doc),{file:'beta.yml'});
 assert.equal(info.version,'0.1.0-beta.7');const exe=findFile(files,'exe');assert.equal(exe.url.href,doc.files[0].url);assert.equal(exe.info.sha512,file.sha512);assert.equal(exe.info.size,file.size);
 assert.equal(U.parseFeed(U.serializeFeed(doc)).version,'0.1.0-beta.7');
 assert.equal(U.parseFeed('version: 0.1.0-beta.7\nfiles: []\n').version,'0.1.0-beta.7','electron-builder\'s own YAML is read too');
});

test('the Windows document names where earlier setups\' blockmaps are, so an installed Acira downloads only what changed since its own setup',()=>{
 const rel=(tag,name)=>U.assetUrl(tag,name);
 const live=[{file:'beta.yml',version:'0.1.0-beta.8',files:[{url:rel('v0.1.0-beta.8-windows-530845ad','AciraBrowserSetup-0.1.0-beta.8.exe')}],previousBlockMaps:[{version:'0.1.0-beta.7',url:rel('v0.1.0-beta.7-windows-574941f2','AciraBrowserSetup-0.1.0-beta.7.exe.blockmap')},{version:'0.1.0-beta.8',url:'https://elsewhere/x.blockmap'},{version:'1',url:'http://plain/x.blockmap'}]}];
 const list=U.previousBlockMaps(live,{version:'0.1.0-beta.9'});
 assert.deepEqual(list,[{version:'0.1.0-beta.8',url:rel('v0.1.0-beta.8-windows-530845ad','AciraBrowserSetup-0.1.0-beta.8.exe.blockmap')},{version:'0.1.0-beta.7',url:rel('v0.1.0-beta.7-windows-574941f2','AciraBrowserSetup-0.1.0-beta.7.exe.blockmap')}],'the live setup first, then the ones it noted; one per version, HTTPS only');
 assert.deepEqual(U.previousBlockMaps(live,{version:'0.1.0-beta.8'}).map(item=>item.version),['0.1.0-beta.7'],'never the version being published');
 assert.equal(U.previousBlockMaps(Array.from({length:9},(_,i)=>({version:'0.1.'+i,files:[{url:'https://x/'+i+'.exe'}]})),{version:'9'}).length,6,'a few releases back, not the whole history');
 const file={name:'AciraBrowserSetup-0.1.0-beta.9.exe',size:5,sha512:createHash('sha512').update('setup').digest('base64')};
 const doc=U.windowsFeed({version:'0.1.0-beta.9',file,url:rel('v0.1.0-beta.9-windows-bbbbbbbb',file.name),releaseDate:'2026-11-03T00:00:00.000Z',releaseName:'Acira Browser 0.1.0-beta.9',previousBlockMaps:list});
 assert.deepEqual(U.readWithUpdater(U.serializeFeed(doc),{file:'beta.yml'}).info.previousBlockMaps,list,'electron-updater hands the field to the app as it is');
 assert.equal(U.windowsFeed({version:'1',file,url:'https://x/a.exe',releaseDate:'d',releaseName:'n'}).previousBlockMaps,undefined,'no earlier setups, no field');
});

// The real AppUpdater, the way the app configures it (beta channel for a pre-release version), against the documents this tool writes.
async function checkWith(t,{platform,installed,feedFile,feedText}){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'acira-publish-updater-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const requests=[],server=http.createServer((req,res)=>{const pathname=new URL(req.url,'http://localhost').pathname;requests.push(pathname);res.setHeader('content-type','text/yaml');if(pathname.endsWith('/'+feedFile)){res.end(feedText);}else{res.statusCode=404;res.end();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const appUpdateConfigPath=path.join(root,'app-update.yml');await fs.writeFile(appUpdateConfigPath,JSON.stringify({provider:'generic',url:'http://127.0.0.1:'+server.address().port+'/feed/'}));
 const updater=new AppUpdater(null,{isPackaged:true,version:installed,name:'Acira test fixture',userDataPath:root,baseCachePath:root,appUpdateConfigPath,whenReady:async()=>{}});
 updater.httpExecutor=new NodeHttpExecutor();updater._testOnlyOptions={platform};updater.channel='beta';updater.allowPrerelease=true;updater.allowDowngrade=false;updater.logger=null;updater.autoDownload=false;
 const result=await updater.checkForUpdates();return {result,requests};
}
test('an installed Mac build on the beta channel is offered the new version and nothing older; a copy that is up to date is offered nothing',{skip:process.platform!=='darwin'&&'the Mac feed carries minimumSystemVersion 22.0.0, which the updater compares with this host\'s OS release'},async t=>{
 const {baseText}=await macFeedFixture(t),text=U.serializeFeed(U.finalizeMacFeed(baseText,{urlFor:name=>U.assetUrl('v0.1.0-beta.7-mac-b62c4715',name),releaseName:'Acira Browser 0.1.0-beta.7',releaseNotes:'- Faster'}));
 for(const [installed,offered] of [['0.1.0-beta.6.local.4',true],['0.1.0-beta.4',true],['0.1.0-beta.7',false],['0.1.0-beta.8',false]]){
  const {result,requests}=await checkWith(t,{platform:'darwin',installed,feedFile:'beta-mac.yml',feedText:text});
  assert.equal(result.isUpdateAvailable,offered,installed);assert.deepEqual(requests,['/feed/beta-mac.yml']);if(offered)assert.equal(result.updateInfo.version,'0.1.0-beta.7');
 }
});
test('an installed Windows build on the beta channel reads beta.yml and is offered the new setup',async t=>{
 const file={name:'AciraBrowserSetup.exe',size:123456789,sha512:createHash('sha512').update('setup').digest('base64')};
 const text=U.serializeFeed(U.windowsFeed({version:'0.1.0-beta.7',file,url:U.assetUrl('v0.1.0-beta.7-windows-b62c4715',file.name),releaseDate:'2026-11-02T04:08:24.003Z',releaseName:'Acira Browser 0.1.0-beta.7'}));
 for(const [installed,offered] of [['0.1.0-beta.6',true],['0.1.0-beta.7',false]]){
  const {result,requests}=await checkWith(t,{platform:'win32',installed,feedFile:'beta.yml',feedText:text});
  assert.equal(result.isUpdateAvailable,offered,installed);assert.deepEqual(requests,['/feed/beta.yml']);
 }
});
