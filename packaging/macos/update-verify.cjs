'use strict';
// What "this Mac build is safe to hand to an installed Acira" means, checked on the bytes that would be uploaded. Used twice: by
// package-mac-widevine.mjs (right after it zips the final app) and by scripts/publish-update.mjs (again, on whatever ZIP and DMG it is given).
// Squirrel.Mac only installs code signed by the same identity as the running app, so a ZIP that fails any check here would download and then
// refuse to install on every user's Mac, or install something Gatekeeper refuses to open.
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{execFile}=require('node:child_process'),{promisify}=require('node:util');
const signer=require('../../desktop/browser-services/mac-distribution-identity.cjs');
const {signingPolicy,verifySigningDetails}=require('./signing.cjs');
const {DEFAULT_FEED_URL}=require('../update-feed.cjs');
const execute=promisify(execFile);
const IDENTITY='Developer ID Application: '+signer.name+' ('+signer.team+')';
const APP_NAME='Acira Browser.app',BUNDLE_ID='computer.acira.browser',EXECUTABLE='AciraBrowser';
const LIPO={arm64:'arm64',x64:'x86_64'};
const CODESIGN='/usr/bin/codesign',SPCTL='/usr/sbin/spctl',STAPLER=['/usr/bin/xcrun',['stapler','validate']],LIPO_TOOL='/usr/bin/lipo',DITTO='/usr/bin/ditto';
const text=result=>String(result?.stdout||'')+String(result?.stderr||'');
const readJSON=async file=>JSON.parse(await fs.readFile(file,'utf8'));
/** The version the app inside carries: ACIRA-BUILD.json (written by the packager) and package.json inside app.asar (or app/). Both must agree. */
async function embeddedVersions(app){
 const resources=path.join(app,'Contents/Resources'),build=await readJSON(path.join(resources,'ACIRA-BUILD.json'));
 let pkg;
 try{pkg=await readJSON(path.join(resources,'app/package.json'));}
 catch(error){if(error.code!=='ENOENT')throw error;const asar=require('@electron/asar');asar.uncacheAll();pkg=JSON.parse(asar.extractFile(path.join(resources,'app.asar'),'package.json').toString());asar.uncacheAll();}
 return {build:build.version,package:pkg.version,arch:build.arch,commit:build.commit};
}
/**
 * Verifies one extracted app. Throws an Error naming the first failed check; otherwise returns what was proven.
 * expect: {arch, version?, feedUrl?}. version is compared with both embedded version fields when given.
 */
async function inspectMacApp({app,arch,version,feedUrl=DEFAULT_FEED_URL,run=execute}){
 if(!LIPO[arch])throw Error('Choose arm64 or x64.');
 const policy=signingPolicy(IDENTITY,true);
 await run(CODESIGN,['--verify','--deep','--strict','--verbose=2',app]).catch(error=>{throw Error('codesign --verify --deep --strict failed: '+(error.stderr||error.message).toString().trim().split('\n').pop());});
 const display=text(await run(CODESIGN,['--display','--verbose=4',app]));
 try{verifySigningDetails(display,policy);}catch(error){throw Error('Not signed by '+IDENTITY+' with the hardened runtime ('+error.message+')');}
 const stapled=text(await run(STAPLER[0],[...STAPLER[1],app]).catch(error=>{throw Error('The notarization ticket is not stapled to the app (stapler validate failed): '+(error.stderr||error.message).toString().trim().split('\n').pop());}));
 if(!/validate action worked/i.test(stapled))throw Error('stapler validate did not confirm the ticket: '+stapled.trim().slice(-120));
 const gatekeeper=text(await run(SPCTL,['--assess','--type','execute','--verbose=4',app]).catch(error=>{throw Error('Gatekeeper (spctl) rejects the app: '+(error.stderr||error.message).toString().trim().split('\n')[0]);}));
 if(!/source=Notarized Developer ID/.test(gatekeeper))throw Error('Gatekeeper accepts the app but not as "Notarized Developer ID": '+gatekeeper.trim().replace(/\s+/g,' ').slice(0,160));
 const machine=(await run(LIPO_TOOL,['-archs',path.join(app,'Contents/MacOS',EXECUTABLE)])).stdout.trim();
 if(machine!==LIPO[arch])throw Error('The app is built for '+machine+', not '+LIPO[arch]+' ('+arch+').');
 const plist=require('plist').parse(await fs.readFile(path.join(app,'Contents/Info.plist'),'utf8'));
 if(plist.CFBundleIdentifier!==BUNDLE_ID||plist.CFBundleExecutable!==EXECUTABLE)throw Error('Unexpected bundle identity '+plist.CFBundleIdentifier+' / '+plist.CFBundleExecutable+'; Squirrel would not treat it as the same app.');
 let config;
 try{config=require('js-yaml').load(await fs.readFile(path.join(app,'Contents/Resources/app-update.yml'),'utf8'));}
 catch{throw Error('The app has no Contents/Resources/app-update.yml: copies installed from it could never be updated again.');}
 if(config?.provider!=='generic'||config.url!==feedUrl)throw Error('app-update.yml points at '+config?.url+', not the public feed '+feedUrl+'; copies installed from it would be stranded.');
 const embedded=await embeddedVersions(app);
 if(embedded.build!==embedded.package)throw Error('The app disagrees with itself about its version: ACIRA-BUILD.json says '+embedded.build+', package.json says '+embedded.package+'.');
 if(embedded.arch!==arch)throw Error('ACIRA-BUILD.json says the app is '+embedded.arch+', not '+arch+'.');
 if(version&&embedded.build!==version)throw Error('The app inside carries version '+embedded.build+', not '+version+'.');
 return {version:embedded.build,arch,commit:embedded.commit,identity:policy.identity,team:policy.team,hardenedRuntime:true,stapled:true,gatekeeper:'Notarized Developer ID',machine,feedUrl:config.url};
}
/** Unzips a ZIP exactly as Squirrel would see it and verifies the single app inside. The temporary folder is removed afterwards. */
async function inspectMacZip({zip,arch,version,feedUrl,run=execute,tmp=os.tmpdir()}){
 const work=await fs.mkdtemp(path.join(tmp,'acira-update-zip-'));
 try{
  await run(DITTO,['-x','-k',zip,work],{maxBuffer:1024*1024});
  const top=(await fs.readdir(work)).sort();
  if(top.length!==1||top[0]!==APP_NAME)throw Error('The ZIP must contain exactly "'+APP_NAME+'" at its top level, not: '+top.join(', '));
  return {zip:path.basename(zip),...await inspectMacApp({app:path.join(work,APP_NAME),arch,version,feedUrl,run})};
 }finally{await fs.rm(work,{recursive:true,force:true});}
}
/** A DMG is what new users download: Developer ID signed, notarized and stapled so Gatekeeper opens it offline. */
async function inspectMacDmg({dmg,run=execute}){
 await run(CODESIGN,['--verify','--strict',dmg]).catch(error=>{throw Error('The disk image signature is not valid: '+(error.stderr||error.message).toString().trim().split('\n').pop());});
 const display=text(await run(CODESIGN,['--display','--verbose=4',dmg]));
 if(!display.includes('Authority='+IDENTITY+'\n')||!display.includes('TeamIdentifier='+signer.team+'\n'))throw Error('The disk image is not signed by '+IDENTITY+'.');
 const stapled=text(await run(STAPLER[0],[...STAPLER[1],dmg]).catch(error=>{throw Error('The notarization ticket is not stapled to the disk image: '+(error.stderr||error.message).toString().trim().split('\n').pop());}));
 if(!/validate action worked/i.test(stapled))throw Error('stapler validate did not confirm the disk image ticket.');
 const gatekeeper=text(await run(SPCTL,['--assess','--type','open','--context','context:primary-signature','--verbose=4',dmg]).catch(error=>{throw Error('Gatekeeper rejects the disk image: '+(error.stderr||error.message).toString().trim().split('\n')[0]);}));
 if(!/source=Notarized Developer ID/.test(gatekeeper))throw Error('Gatekeeper does not accept the disk image as "Notarized Developer ID".');
 return {dmg:path.basename(dmg),identity:IDENTITY,team:signer.team,stapled:true,gatekeeper:'Notarized Developer ID'};
}
module.exports={IDENTITY,APP_NAME,BUNDLE_ID,EXECUTABLE,LIPO,embeddedVersions,inspectMacApp,inspectMacZip,inspectMacDmg};
