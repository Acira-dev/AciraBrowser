import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url),run=promisify(execFile),repo=path.resolve(import.meta.dirname,'..');
const plist=require('plist'),{signAsync}=require('@electron/osx-sign'),{build}=require('esbuild');
const {walk,hashFile}=require('../packaging/macos/install-engine.cjs'),{buildInstallerPage}=require('../packaging/macos/installer-page.cjs');
const {flipFuses,getCurrentFuseWire,FuseVersion,FuseV1Options}=require('@electron/fuses');
const {signingPolicy,signOptions,resealArguments,verifySigningDetails}=require('../packaging/macos/signing.cjs');
const {preparePasskeySigning}=require('../packaging/macos/passkeys.cjs');
const {notarizationPolicy,notarizeBundle,notarize,stapleAndAssess}=require('../packaging/macos/notarization.cjs');
const {writeMacUpdateConfig,writeMacUpdateFeed}=require('../packaging/macos/update-feed.cjs');
const {macBuildVersion}=require('../packaging/macos/build-version.cjs');
const readJSON=async file=>JSON.parse(await fs.readFile(file,'utf8'));
async function icon(work){const set=path.join(work,'Acira.iconset');await fs.mkdir(set);const source=path.join(repo,'packaging/acira-icon-512.png');for(const size of [16,32,128,256,512])for(const scale of [1,2]){const pixels=size*scale;if(pixels>1024)continue;await run('/usr/bin/sips',['-z',String(pixels),String(pixels),source,'--out',path.join(set,`icon_${size}x${size}${scale===2?'@2x':''}.png`)]);}const out=path.join(work,'Acira.icns');await run('/usr/bin/iconutil',['-c','icns','-o',out,set]);return out;}
async function bundle(runtime,destination,{name,id,executable,version,iconFile,copyright,browser=false}){
 await fs.cp(runtime,destination,{recursive:true,verbatimSymlinks:true,filter:file=>!file.endsWith('/default_app.asar')});const contents=path.join(destination,'Contents'),file=path.join(contents,'Info.plist'),info=plist.parse(await fs.readFile(file,'utf8'));
 await fs.rename(path.join(contents,'MacOS','Electron'),path.join(contents,'MacOS',executable));Object.assign(info,{CFBundleDisplayName:name,CFBundleName:name,CFBundleIdentifier:id,CFBundleExecutable:executable,CFBundleIconFile:'Acira.icns',CFBundleShortVersionString:version.split('-')[0],CFBundleVersion:macBuildVersion(),LSApplicationCategoryType:'public.app-category.productivity'});delete info.ElectronAsarIntegrity;
 if(browser){info.CFBundleURLTypes=[{CFBundleURLName:'Web URLs',CFBundleURLSchemes:['http','https'],CFBundleTypeRole:'Viewer'}];info.CFBundleDocumentTypes=[{CFBundleTypeName:'HTML document',CFBundleTypeExtensions:['html','htm','xhtml'],LSItemContentTypes:['public.html','public.xhtml'],CFBundleTypeRole:'Viewer',LSHandlerRank:'Alternate'}];info.NSCameraUsageDescription='Allow a website you choose to use the camera in Acira.';info.NSMicrophoneUsageDescription='Allow a website you choose to use the microphone in Acira.';}
 info.NSHumanReadableCopyright=copyright;
 await fs.writeFile(file,plist.build(info));await fs.copyFile(iconFile,path.join(contents,'Resources','Acira.icns'));
 if(browser){await flipFuses(destination,{version:FuseVersion.V1,[FuseV1Options.EnableCookieEncryption]:true});const wire=await getCurrentFuseWire(destination);if(wire[FuseV1Options.EnableCookieEncryption]!==49)throw Error('Browser cookie encryption fuse was not enabled.');}
 return path.join(contents,'Resources');
}
// Ad-hoc local builds have no Team ID for hardened library validation.
// Public Developer ID + hardened-runtime/notarization qualification is separate.
async function verifySign(application,policy){await run('/usr/bin/codesign',['--verify','--deep','--strict',application]);const details=await run('/usr/bin/codesign',['--display','--verbose=4',application]);verifySigningDetails(details.stderr,policy);}
async function sign(application,policy,options){await signAsync(signOptions(application,policy,options));await verifySign(application,policy);}
export async function packageMac(candidate,{dmg=true,signingIdentity=process.env.ACIRA_MAC_SIGN_IDENTITY||'-',distribution=false,notaryProfile=process.env.ACIRA_MAC_NOTARY_PROFILE,browserPasskeyProfile=process.env.ACIRA_MAC_BROWSER_PASSKEY_PROFILE}={}){
 const publisherConfig=await readJSON(path.join(repo,'packaging/electron-builder.json')),publisher=publisherConfig.extraMetadata?.author?.name,copyright=publisherConfig.copyright;
 if(typeof publisher!=='string'||!publisher.trim()||typeof copyright!=='string'||!copyright.trim())throw Error('Mac packaging requires the shared publisher and copyright metadata.');
 const signing=signingPolicy(signingIdentity,distribution);let passkeySigning=null;
 const notary=notarizationPolicy(signing.distribution,notaryProfile),notarization={browser:null,installer:null,diskImage:null};
 if(process.platform!=='darwin')throw Error('Build the Mac installer on macOS.');candidate=path.resolve(candidate);const identity=await readJSON(path.join(candidate,'build-identity.json'));
 const head=(await run('git',['rev-parse','HEAD'],{cwd:repo})).stdout.trim();if(identity.commit!==head||!identity.committedSource||!identity.stable||identity.warnings.length)throw Error('Use a stable, warning-free committed build of current HEAD.');if((await run('git',['status','--porcelain'],{cwd:repo})).stdout.trim())throw Error('Commit source changes before packaging.');
 for(const e of identity.artifacts)if(await hashFile(path.join(candidate,e.file))!==e.sha256)throw Error('Candidate changed: '+e.file);
 const electron=require('electron/package.json');if(electron.version!==identity.electron)throw Error('Runtime changed after the build.');
 const parent=path.join(repo,'release');await fs.mkdir(parent,{recursive:true});const output=await fs.mkdtemp(path.join(parent,`Acira-mac-${identity.version}-${process.arch}-${identity.sourceDigest.slice(0,8)}-`));
 const work=await fs.mkdtemp(path.join(os.tmpdir(),'acira-mac-build-')),runtime=path.join(path.dirname(require.resolve('electron/package.json')),'dist','Electron.app'),appBundle=path.join(output,'Acira Browser.app'),installer=path.join(output,'Install Acira.app'),iconFile=await icon(work);
 try{
  const resources=await bundle(runtime,appBundle,{name:'Acira Browser',id:'computer.acira.browser',executable:'AciraBrowser',version:identity.version,iconFile,copyright,browser:true}),application=path.join(resources,'app');await fs.mkdir(application);
  for(const file of ['desktop','dist','resources','node_modules','package.json','page-zoom-levels.json','LICENSE','THIRD_PARTY_NOTICES.md','source-licenses'])try{await fs.cp(path.join(candidate,file),path.join(application,file),{recursive:true,verbatimSymlinks:true});}catch(e){if(e.code!=='ENOENT')throw e;}
  const pkg=await readJSON(path.join(application,'package.json'));pkg.productName='Acira Browser';pkg.author={name:publisher};await fs.writeFile(path.join(application,'package.json'),JSON.stringify(pkg,null,2));await writeMacUpdateConfig(resources);passkeySigning=await preparePasskeySigning({application:appBundle,work,profilePath:browserPasskeyProfile,policy:signing});await sign(appBundle,signing,passkeySigning||undefined);
  // Native Tor must be signed for Apple Silicon. The signer may change its Mach-O
  // seal, so record those final hashes inside the outer app's own resource seal.
  const torRoot=path.join(application,'resources','tor'),torMeta=path.join(torRoot,'native-manifest.json');
  let nativeTor;try{nativeTor=await readJSON(torMeta);}catch(e){if(e.code!=='ENOENT')throw e;}
  if(nativeTor){for(const name of require('../desktop/browser-services/tor-mac.cjs').NATIVE_FILES)nativeTor.files[name]=await hashFile(path.join(torRoot,name));await fs.writeFile(torMeta,JSON.stringify(nativeTor,null,2)+'\n');await run('/usr/bin/codesign',resealArguments(appBundle,signing));await verifySign(appBundle,signing);}
  if((await getCurrentFuseWire(appBundle))[FuseV1Options.EnableCookieEncryption]!==49)throw Error('Signed browser cookie encryption fuse was not enabled.');
  // A custom installer must contain an already notarized and stapled payload.
  // The ticket is part of the final payload manifest, never added after hashing it.
  if(notary.enabled){notarization.browser=await notarizeBundle({bundle:appBundle,work,policy:notary});await verifySign(appBundle,signing);}
  const installerResources=await bundle(runtime,installer,{name:'Acira Installer',id:'computer.acira.installer',executable:'AciraInstaller',version:identity.version,iconFile,copyright}),installerSource=path.join(installerResources,'app');await fs.mkdir(installerSource);
  await build({entryPoints:[path.join(repo,'packaging/macos/installer-main.cjs')],outfile:path.join(installerSource,'main.cjs'),bundle:true,platform:'node',format:'cjs',external:['electron','original-fs'],target:'node22'});
  await fs.copyFile(path.join(repo,'packaging/macos/installer-preload.cjs'),path.join(installerSource,'installer-preload.cjs'));await fs.writeFile(path.join(installerSource,'package.json'),JSON.stringify({name:'acira-installer',productName:'Acira Installer',author:{name:publisher},version:identity.version,main:'main.cjs'}));
  const concept=(await run('git',['show',head+':docs/launch/concepts/installer-creation.html'],{cwd:repo,maxBuffer:32*1024*1024})).stdout,scene=buildInstallerPage(concept);await fs.writeFile(path.join(installerSource,'installer.html'),scene.html);await fs.writeFile(path.join(installerSource,'installer-art.js'),scene.script);
  const archive=path.join(installerResources,'payload.zip');await run('/usr/bin/ditto',['--norsrc','--noextattr','-c','-k','--keepParent',appBundle,archive],{maxBuffer:1024*1024});const entries=await walk(appBundle),payload={schema:1,appName:'Acira Browser.app',commit:head,sourceDigest:identity.sourceDigest,archiveSha256:await hashFile(archive),entries};await fs.writeFile(path.join(installerResources,'payload.json'),JSON.stringify(payload));
  await fs.copyFile(path.join(repo,'THIRD_PARTY_NOTICES.md'),path.join(installerResources,'THIRD_PARTY_NOTICES.md'));await fs.copyFile(path.join(repo,'LICENSE'),path.join(installerResources,'LICENSE'));await sign(installer,signing);
  if(notary.enabled){notarization.installer=await notarizeBundle({bundle:installer,work,policy:notary});await verifySign(installer,signing);}
  let diskImage=null;if(dmg){const imageRoot=path.join(work,'disk-image');await fs.mkdir(imageRoot);await fs.cp(installer,path.join(imageRoot,'Install Acira.app'),{recursive:true,verbatimSymlinks:true});diskImage=path.join(output,`Acira-${identity.version}-mac-${process.arch}-${signing.distribution?'setup':'local-setup'}.dmg`);await run('/usr/bin/hdiutil',['create','-volname','Acira Setup','-srcfolder',imageRoot,'-format','UDZO',diskImage],{maxBuffer:1024*1024});if(notary.enabled){await run('/usr/bin/codesign',['--sign',signing.identity,'--timestamp',diskImage]);const receipt=await notarize({artifact:diskImage,policy:notary});notarization.diskImage={...receipt,...await stapleAndAssess({artifact:diskImage})};}}
  let update=null;if(notary.enabled){const zip=path.join(output,`AciraBrowser-${identity.version}-mac-${process.arch}-update.zip`);await run('/usr/bin/ditto',['--norsrc','--noextattr','-c','-k','--keepParent',appBundle,zip],{maxBuffer:1024*1024});update=await writeMacUpdateFeed({output,version:identity.version,zip,arch:process.arch});}
  const manifest={schema:1,createdAt:new Date().toISOString(),commit:head,sourceDigest:identity.sourceDigest,electron:identity.electron,platform:'darwin',arch:process.arch,browserPasskeys:passkeySigning?{capability:passkeySigning.capability,applicationIdentifier:passkeySigning.applicationIdentifier,requiresNewSignedBuild:true,realAccountAuthenticationVerified:false}:null,publisher,copyright,appBundle,installer,diskImage,signing:signing.description,signingIdentity:signing.distribution?signing.identity:null,distributionSigned:signing.distribution,notarized:notary.enabled,notarization,update,profiles:'Installer never copies, clears or changes browser profile directories.',payloadArchiveSha256:payload.archiveSha256,payloadFiles:entries.length,cookieEncryption:true,appSignatureVerified:true,installerSignatureVerified:true,protocols:['http','https'],packagingInputs:[]};
  for(const file of ['scripts/package-mac.mjs','packaging/electron-builder.json','packaging/macos/install-engine.cjs','packaging/macos/running-app.cjs','packaging/macos/installer-main.cjs','packaging/macos/installer-preload.cjs','packaging/macos/installer-page.cjs','packaging/macos/strings.cjs','packaging/macos/signing.cjs','packaging/macos/passkeys.cjs','packaging/mac/entitlements.mac.plist','packaging/macos/notarization.cjs','packaging/macos/update-feed.cjs','packaging/update-feed.cjs','packaging/installer/strings.json','packaging/acira-icon-512.png','docs/launch/concepts/installer-creation.html'])manifest.packagingInputs.push({file,sha256:await hashFile(path.join(repo,file))});await fs.writeFile(path.join(output,'mac-package.json'),JSON.stringify(manifest,null,2));return manifest;
 }finally{await fs.rm(work,{recursive:true,force:true});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){if(!process.argv[2])throw Error('Pass a committed Mac candidate directory.');console.log(JSON.stringify(await packageMac(process.argv[2],{dmg:!process.argv.includes('--no-dmg'),distribution:process.argv.includes('--distribution')}),null,2));}
