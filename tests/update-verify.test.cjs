'use strict';
// The checks that decide whether a Mac ZIP or DMG may reach installed copies (packaging/macos/update-verify.cjs) and the ZIP the Widevine packager now writes
// (packaging/macos/update-zip.cjs). The Apple tools are replaced by a scripted stand-in, so each failure is shown to be refused, on any host.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{createHash}=require('node:crypto');
const plist=require('plist');
const V=require('../packaging/macos/update-verify.cjs'),{createMacUpdateZip,updateZipName}=require('../packaging/macos/update-zip.cjs'),{DEFAULT_FEED_URL}=require('../packaging/update-feed.cjs');
const IDENTITY='Developer ID Application: Khaled Kaed Beyh (2MGLP3QV9X)';
const fail=(message)=>Object.assign(Error(message),{stderr:message});

/** A stand-in for ditto, codesign, stapler, spctl and lipo that "extracts" an app described by a scenario. */
function tools(scenario={}){
 const s={version:'0.1.0-beta.7',packageVersion:undefined,arch:'arm64',machine:'arm64',identity:IDENTITY,runtime:true,verify:true,staple:true,gatekeeper:'Notarized Developer ID',bundleId:'computer.acira.browser',feed:DEFAULT_FEED_URL,updateYml:true,top:['Acira Browser.app'],dmgSigned:true,...scenario};
 const calls=[];
 const run=async(file,args)=>{
  calls.push([path.basename(file),...args]);
  const tool=path.basename(file);
  if(tool==='ditto'&&args.includes('-c')){await fs.writeFile(args[args.length-1],'zip bytes');return {stdout:'',stderr:''};}
  if(tool==='ditto'&&args.includes('-x')){
   const target=args[args.length-1];
   for(const name of s.top){
    if(name!=='Acira Browser.app'){await fs.writeFile(path.join(target,name),'junk');continue;}
    const app=path.join(target,name),resources=path.join(app,'Contents/Resources');
    await fs.mkdir(path.join(app,'Contents/MacOS'),{recursive:true});await fs.mkdir(path.join(resources,'app'),{recursive:true});
    await fs.writeFile(path.join(app,'Contents/MacOS/AciraBrowser'),'binary');
    await fs.writeFile(path.join(app,'Contents/Info.plist'),plist.build({CFBundleIdentifier:s.bundleId,CFBundleExecutable:'AciraBrowser'}));
    await fs.writeFile(path.join(resources,'ACIRA-BUILD.json'),JSON.stringify({version:s.version,arch:s.arch,commit:'b62c4715130a8f17182dced8e94e7fc56425c4c7'}));
    await fs.writeFile(path.join(resources,'app/package.json'),JSON.stringify({version:s.packageVersion||s.version}));
    if(s.updateYml)await fs.writeFile(path.join(resources,'app-update.yml'),'provider: "generic"\nurl: "'+s.feed+'"\nupdaterCacheDirName: "acira-browser-updater"\n');
   }
   return {stdout:'',stderr:''};
  }
  if(tool==='codesign'&&args[0]==='--verify'){if(!s.verify)throw fail('a sealed resource is missing or invalid');return {stdout:'',stderr:''};}
  if(tool==='codesign'&&args[0]==='--display'){
   const dmg=args[args.length-1].endsWith('.dmg');
   return {stdout:'',stderr:'Executable=/x\nAuthority='+(dmg&&!s.dmgSigned?'Apple Development: someone':s.identity)+'\nAuthority=Developer ID Certification Authority\nAuthority=Apple Root CA\nTeamIdentifier='+s.identity.slice(-11,-1)+'\n'+(dmg?'':'CodeDirectory v=20500 size=450 flags=0x'+(s.runtime?'10000(runtime)':'0(none)')+' hashes=3+7 location=embedded\n')};
  }
  if(tool==='xcrun'){if(!s.staple)throw fail('Processing: x\nCloudKit query for x failed due to "Record not found".\nThe validate action failed!');return {stdout:'Processing: x\nThe validate action worked!\n',stderr:''};}
  if(tool==='spctl')return {stdout:'',stderr:args[args.length-1]+': accepted\nsource='+s.gatekeeper+'\n'};
  if(tool==='lipo')return {stdout:s.machine+'\n',stderr:''};
  throw Error('unexpected tool '+tool);
 };
 return {run,calls};
}
async function inFolder(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'acira-update-verify-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir;}
async function zipCheck(t,scenario,overrides={}){
 const dir=await inFolder(t),zip=path.join(dir,'x-update.zip');await fs.writeFile(zip,'zip');
 const {run}=tools(scenario);
 return V.inspectMacZip({zip,arch:'arm64',version:'0.1.0-beta.7',run,tmp:dir,...overrides});
}

test('a final, signed, notarized, stapled app with the right feed passes, and says what it proved',async t=>{
 const proof=await zipCheck(t,{});
 assert.deepEqual(proof,{zip:'x-update.zip',version:'0.1.0-beta.7',arch:'arm64',commit:'b62c4715130a8f17182dced8e94e7fc56425c4c7',identity:IDENTITY,team:'2MGLP3QV9X',hardenedRuntime:true,stapled:true,gatekeeper:'Notarized Developer ID',machine:'arm64',feedUrl:DEFAULT_FEED_URL});
});
test('the app is unzipped into a temporary folder that is removed afterwards, pass or fail',async t=>{
 const dir=await inFolder(t);
 for(const scenario of [{},{staple:false}]){const zip=path.join(dir,'z.zip');await fs.writeFile(zip,'zip');await V.inspectMacZip({zip,arch:'arm64',run:tools(scenario).run,tmp:dir}).catch(()=>{});assert.deepEqual(await fs.readdir(dir),['z.zip']);}
});
test('each way a ZIP could strand or harm installed copies is refused with its own reason',async t=>{
 const cases=[
  [{verify:false},/codesign --verify --deep --strict failed: .*sealed resource/],
  [{identity:'Developer ID Application: Someone Else (ABCDE12345)'},/Not signed by Developer ID Application: Khaled Kaed Beyh/],
  [{runtime:false},/hardened runtime/],
  [{staple:false},/notarization ticket is not stapled to the app/],
  [{gatekeeper:'Developer ID'},/not as "Notarized Developer ID"/],
  [{machine:'x86_64'},/built for x86_64, not arm64/],
  [{bundleId:'computer.acira.other'},/Unexpected bundle identity/],
  [{updateYml:false},/no Contents\/Resources\/app-update\.yml/],
  [{feed:'https://example.org/feed/'},/not the public feed/],
  [{version:'0.1.0-beta.6.local.4'},/carries version 0\.1\.0-beta\.6\.local\.4, not 0\.1\.0-beta\.7/],
  [{packageVersion:'0.1.0-beta.8'},/disagrees with itself/],
  [{arch:'x64'},/says the app is x64, not arm64/],
  [{top:['Acira Browser.app','__MACOSX']},/exactly "Acira Browser\.app"/],
  [{top:['Other.app']},/exactly "Acira Browser\.app"/],
 ];
 for(const [scenario,pattern] of cases)await assert.rejects(zipCheck(t,scenario),pattern,JSON.stringify(scenario));
});
test('a disk image must be signed by the Developer ID, stapled, and accepted by Gatekeeper as notarized',async t=>{
 const dir=await inFolder(t),dmg=path.join(dir,'AciraBrowser-0.1.0-beta.7-mac-arm64.dmg');
 assert.equal((await V.inspectMacDmg({dmg,run:tools().run})).gatekeeper,'Notarized Developer ID');
 await assert.rejects(V.inspectMacDmg({dmg,run:tools({verify:false}).run}),/signature is not valid/);
 await assert.rejects(V.inspectMacDmg({dmg,run:tools({dmgSigned:false}).run}),/not signed by Developer ID Application/);
 await assert.rejects(V.inspectMacDmg({dmg,run:tools({staple:false}).run}),/not stapled to the disk image/);
 await assert.rejects(V.inspectMacDmg({dmg,run:tools({gatekeeper:'Unnotarized Developer ID'}).run}),/does not accept the disk image as "Notarized Developer ID"/);
});
test('the packager writes the update ZIP of the final app, verifies it by opening it, and records its SHA-512 and size',async t=>{
 const dir=await inFolder(t),app=path.join(dir,'Acira Browser.app'),{run,calls}=tools();
 const update=await createMacUpdateZip({appBundle:app,output:dir,version:'0.1.0-beta.7',arch:'arm64',run});
 assert.equal(path.basename(update.zip),'AciraBrowser-0.1.0-beta.7-mac-arm64-update.zip');assert.equal(update.zip,path.join(dir,updateZipName('0.1.0-beta.7','arm64')));
 assert.deepEqual(calls[0],['ditto','--norsrc','--noextattr','-c','-k','--keepParent',app,update.zip],'the same ditto flags scripts/package-mac.mjs has always used');
 assert.equal(update.sha512,createHash('sha512').update('zip bytes').digest('base64'));assert.equal(update.size,'zip bytes'.length);
 assert.equal(update.channel,'beta');assert.equal(path.basename(update.feed),'beta-mac.yml');assert.equal(update.verified.stapled,true);
 assert.equal(JSON.parse(await fs.readFile(update.feed,'utf8')).files[0].sha512,update.sha512,'the feed fragment (writeMacUpdateFeed) agrees with the receipt');
 const verifiedAfterZipping=calls.findIndex(call=>call[0]==='ditto'&&call.includes('-x'));assert.ok(verifiedAfterZipping>0,'the ZIP is opened again after it is written');
 await assert.rejects(createMacUpdateZip({appBundle:app,output:dir,version:'0.1.0-beta.7',arch:'arm64',run:tools({staple:false}).run}),/not stapled/,'a ZIP that fails its own check is never reported');
});
