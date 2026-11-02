// Mac-only signed Widevine beta. No Windows runtime, public feed, or Apple
// submission is changed. Credentials stay in the official EVS client.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {fetchMacWidevineRuntime} from './fetch-mac-widevine.mjs';
import {betaVersion} from './package-mac-beta.mjs';
import {packageBetaInstaller} from './package-mac-beta-installer.mjs';
const require=createRequire(import.meta.url),run=promisify(execFile),repo=path.resolve(import.meta.dirname,'..');
const plist=require('plist'),{signAsync}=require('@electron/osx-sign');
const {walk,hashFile}=require('../packaging/macos/install-engine.cjs');
const {signingPolicy,resealArguments,verifySigningDetails}=require('../packaging/macos/signing.cjs');
const {sealAsar,configureWidevineFuses,signWidevine,signingTargets}=require('../packaging/macos/widevine.cjs');
const {writeMacUpdateConfig}=require('../packaging/macos/update-feed.cjs');
const {macBuildVersion}=require('../packaging/macos/build-version.cjs');
const {readMacTor,NATIVE_FILES}=require('../desktop/browser-services/tor-mac.cjs');
const signer=require('../desktop/browser-services/mac-distribution-identity.cjs');
const {notarizationPolicy,notarizeBundle,notarize,stapleAndAssess,sealedNotarization,notarizationOutcome}=require('../packaging/macos/notarization.cjs');
const {createMacUpdateZip}=require('../packaging/macos/update-zip.cjs');
const {preparePasskeySigning,verifySignedPasskeys}=require('../packaging/macos/passkeys.cjs');
const read=async file=>JSON.parse(await fs.readFile(file,'utf8'));
export async function packageMacWidevine(candidate,{template,arch=process.arch,version,signingIdentity=process.env.ACIRA_MAC_SIGN_IDENTITY||`Developer ID Application: ${signer.name} (${signer.team})`,dmg=true,updateZip=true,notaryProfile=process.env.ACIRA_MAC_NOTARY_PROFILE,browserPasskeyProfile=process.env.ACIRA_MAC_BROWSER_PASSKEY_PROFILE}={}){
 if(process.platform!=='darwin')throw Error('Mac Widevine packaging requires macOS; Windows packaging is unchanged.');
 if(!['arm64','x64'].includes(arch))throw Error('Choose arm64 or x64 for the Mac Widevine runtime.');
 if(!process.env.EVS_CONFIG_FILE)throw Error('Set EVS_CONFIG_FILE to an existing private EVS login; no credential is created or shipped.');
 candidate=path.resolve(candidate);template=path.resolve(template);
 const source=await read(path.join(candidate,'build-identity.json'));
 version=betaVersion(source.version,version??source.version); // no version given: the committed package.json version, the same one the Windows build uses
 const head=(await run('git',['rev-parse','HEAD'],{cwd:repo})).stdout.trim();
 assert.equal(source.commit,head);assert(source.committedSource&&source.stable);assert.deepEqual(source.warnings,[]);
 assert.equal((await run('git',['status','--porcelain'],{cwd:repo})).stdout.trim(),'');
 for(const entry of source.artifacts)assert.equal(await hashFile(path.join(candidate,entry.file)),entry.sha256,entry.file);
 const policy=signingPolicy(signingIdentity,true),notary=notarizationPolicy(Boolean(notaryProfile),notaryProfile);
 await run('/usr/bin/codesign',['--verify','--deep','--strict',template]);
 verifySigningDetails((await run('/usr/bin/codesign',['--display','--verbose=4',template])).stderr,policy);
 const old=await read(path.join(template,'Contents/Resources/ACIRA-BUILD.json'));
 assert.equal(old.electron,source.electron);assert.equal(old.arch,arch);
 const runtime=await fetchMacWidevineRuntime({arch});assert.equal(runtime.electron,source.electron);
 const parent=path.join(repo,'release',`mac-widevine-${version}-${head.slice(0,8)}.noindex`);await fs.mkdir(parent,{recursive:true});
 const output=await fs.mkdtemp(path.join(parent,arch+'-')),appBundle=path.join(output,'Acira Browser.app');
 await fs.cp(template,appBundle,{recursive:true,verbatimSymlinks:true});
 const contents=path.join(appBundle,'Contents'),resources=path.join(contents,'Resources'),application=path.join(resources,'app');
 for(const name of ['app','app.asar','app.asar.unpacked','default_app.asar','tor'])await fs.rm(path.join(resources,name),{recursive:true,force:true});
 await fs.rm(path.join(contents,'Frameworks'),{recursive:true});
 await fs.cp(path.join(runtime.runtime,'Contents/Frameworks'),path.join(contents,'Frameworks'),{recursive:true,verbatimSymlinks:true});
 await fs.copyFile(path.join(runtime.runtime,'Contents/MacOS/Electron'),path.join(contents,'MacOS/AciraBrowser'));
 await fs.mkdir(application);
 for(const folder of ['desktop','dist','resources','node_modules','source-licenses'])try{await fs.cp(path.join(candidate,folder),path.join(application,folder),{recursive:true,verbatimSymlinks:true});}catch(error){if(error.code!=='ENOENT')throw error;}
 for(const file of ['package.json','page-zoom-levels.json','LICENSE','THIRD_PARTY_NOTICES.md'])await fs.copyFile(path.join(candidate,file),path.join(application,file));
 const pkg=await read(path.join(application,'package.json'));pkg.version=version;pkg.productName='Acira Browser';pkg.author={name:require('../packaging/electron-builder.json').extraMetadata.author.name};
 await fs.writeFile(path.join(application,'package.json'),JSON.stringify(pkg,null,2)+'\n');
 // Executable Tor components live outside ASAR, in the existing first-choice
 // resources directory. Their own signed manifest remains authoritative.
 const candidateTor=path.join(application,'resources/tor'),tor=path.join(resources,'tor');
 if(readMacTor(path.join(candidateTor,'tor'),{arch}))await fs.rename(candidateTor,tor);
 else{await fs.rm(candidateTor,{recursive:true,force:true});const from=await fs.access(path.join(template,'Contents/Resources/tor')).then(()=>path.join(template,'Contents/Resources/tor'),()=>path.join(template,'Contents/Resources/app/resources/tor'));await fs.cp(from,tor,{recursive:true});}
 assert(readMacTor(path.join(tor,'tor'),{arch}));
 const infoFile=path.join(contents,'Info.plist'),info=plist.parse(await fs.readFile(infoFile,'utf8'));
 assert.equal(info.CFBundleIdentifier,'computer.acira.browser');
 info.CFBundleVersion=macBuildVersion();info.CFBundleShortVersionString=version.split('-')[0];info.LSMinimumSystemVersion='13.0';
 await fs.writeFile(infoFile,plist.build(info));await require('../packaging/macos/icon.cjs').applyMacIcon(appBundle,repo);await writeMacUpdateConfig(resources);
 // Browser passkeys (docs/launch/ICLOUD_PASSKEYS.md) only with Apple's approved Developer ID provisioning profile: it is validated, embedded
 // here and its managed entitlement goes on the browser root alone. A profile the template carried never ships by itself.
 await fs.rm(path.join(contents,'embedded.provisionprofile'),{force:true});
 const passkeyWork=browserPasskeyProfile?await fs.mkdtemp(path.join(os.tmpdir(),'acira-widevine-passkeys-')):null;
 const passkeys=await preparePasskeySigning({application:appBundle,work:passkeyWork,profilePath:browserPasskeyProfile,policy});
 const build={version,commit:head,sourceDigest:source.sourceDigest,electron:source.electron,arch,minimumMacOS:'13.0',notarization:sealedNotarization(notary),iCloudPasskeysEnabled:Boolean(passkeys),widevine:{runtime:runtime.release,archiveSha256:runtime.archiveSha256,cdm:'Downloaded and updated by Google component updater; not bundled',productionVmpSigned:false}};
 await fs.writeFile(path.join(resources,'ACIRA-BUILD.json'),JSON.stringify(build,null,2)+'\n');
 const asarIntegrity=await sealAsar(appBundle);
 await configureWidevineFuses(appBundle);
 console.log('Signing production Widevine runtime ('+arch+')');
 const vmpBefore=await signWidevine(appBundle);console.log(vmpBefore.diagnostic);
 build.widevine.productionVmpSigned=true;await fs.writeFile(path.join(resources,'ACIRA-BUILD.json'),JSON.stringify(build,null,2)+'\n');
 const code=await signingTargets(appBundle);console.log('Signing '+code.size+' Mac code targets; data files remain resources.');
 await signAsync({app:appBundle,identity:policy.identity,identityValidation:true,platform:'darwin',type:'distribution',preAutoEntitlements:false,preEmbedProvisioningProfile:false,ignore:file=>!code.has(path.resolve(file)),optionsForFile:file=>({hardenedRuntime:true,entitlements:path.resolve(file)===appBundle?(passkeys?.entitlements||path.join(repo,'packaging/mac/entitlements.mac.plist')):path.join(repo,'packaging/mac/entitlements.mac.inherit.plist')})});
 const torMeta=await read(path.join(tor,'native-manifest.json'));for(const name of NATIVE_FILES)torMeta.files[name]=await hashFile(path.join(tor,name));
 await fs.writeFile(path.join(tor,'native-manifest.json'),JSON.stringify(torMeta,null,2)+'\n');
 await run('/usr/bin/codesign',resealArguments(appBundle,policy));
 await run('/usr/bin/codesign',['--verify','--deep','--strict',appBundle]);
 verifySigningDetails((await run('/usr/bin/codesign',['--display','--verbose=4',appBundle])).stderr,policy);
 if(passkeys){await verifySignedPasskeys(appBundle,passkeys);await fs.rm(passkeyWork,{recursive:true,force:true});}
 const vmpAfter=await signWidevine(appBundle,{verifyOnly:true});assert(readMacTor(path.join(tor,'tor'),{arch}));
 const expected=arch==='x64'?'x86_64':'arm64';assert.equal((await run('/usr/bin/lipo',['-archs',path.join(contents,'MacOS/AciraBrowser')])).stdout.trim(),expected);
 // Apple notarization only when ACIRA_MAC_NOTARY_PROFILE names existing notarytool credentials: the browser is notarized and stapled
 // before the installer archives it (after the VMP signature, which notarization leaves intact), then the installer and the disk image.
 const appleSubmission=notary.enabled?{}:null,notaryWork=notary.enabled?await fs.mkdtemp(path.join(os.tmpdir(),'acira-widevine-notary-')):null;
 if(notary.enabled){console.log('Notarizing the browser with Apple');appleSubmission.browser=await notarizeBundle({bundle:appBundle,work:notaryWork,policy:notary});await run('/usr/bin/codesign',['--verify','--deep','--strict',appBundle]);}
 // The update ZIP of this FINAL app (after VMP signing, Developer ID signing, notarization and stapling), for electron-updater/Squirrel.Mac. Only a notarized
 // app gets one: the ZIP is verified after it is written (signature, staple, Gatekeeper, version, feed), so the receipt describes a ZIP that was opened and checked.
 let update=null;
 if(updateZip&&notary.enabled){console.log('Zipping and verifying the update archive');update=await createMacUpdateZip({appBundle,output,version,arch});}
 else if(updateZip)console.log('No update ZIP: it needs a notarized app (set ACIRA_MAC_NOTARY_PROFILE).');
 const receipt={...build,signedCodeTargets:code.size,appBundle,output,candidate,distributionSigned:true,signingIdentity:policy.identity,cookieEncryption:true,asarIntegrity,vmpBefore,vmpAfter,automaticUpdateOffered:false,updateZip:update,browserPasskeys:passkeys?{capability:passkeys.capability,applicationIdentifier:passkeys.applicationIdentifier,requiresNewSignedBuild:true,realAccountAuthenticationVerified:false}:null,...notarizationOutcome(appleSubmission?.browser),appleSubmission,canonicalAppUntouched:true}; // measured after stapling: the receipt sits beside the app, so it can say what the sealed ACIRA-BUILD.json cannot
 if(dmg){
  const setup=await packageBetaInstaller({repo,browser:appBundle,output,source:{...source,arch},version,policy,archiveApplication:true,notarization:sealedNotarization(notary),payloadNotarized:notarizationOutcome(appleSubmission?.browser).stapled});Object.assign(receipt,setup);
  if(notary.enabled){console.log('Notarizing the installer with Apple');appleSubmission.installer=await notarizeBundle({bundle:setup.installer,work:notaryWork,policy:notary});const outcome=notarizationOutcome(appleSubmission.installer);receipt.installerNotarized=outcome.notarized;receipt.installerStapled=outcome.stapled;}
  const work=await fs.mkdtemp(path.join(os.tmpdir(),'acira-widevine-dmg-'));
  try{
   await fs.cp(setup.installer,path.join(work,'Install Acira.app'),{recursive:true,verbatimSymlinks:true});
   await fs.writeFile(path.join(work,'READ ME.txt'),`Acira Browser ${version}\n${arch==='arm64'?'Apple silicon':'Intel Mac'}; macOS 13 or later.\nOpen Install Acira.app. Installation progress reflects copying and verification.\nWidevine prepares automatically when online. Service subscriptions and device restrictions apply.\n${notary.enabled?'Developer ID signed and notarized by Apple.':'Developer ID signed beta; not notarized or stapled. macOS may warn or block it.'}\nYour browser profile remains stored separately.\n`);
   const diskImage=path.join(output,`AciraBrowser-${version}-mac-${arch}.dmg`);
   await run('/usr/bin/hdiutil',['create','-volname','Acira Setup','-srcfolder',work,'-format','UDZO',diskImage]);
   await run('/usr/bin/codesign',['--sign',policy.identity,'--timestamp',diskImage]);await run('/usr/bin/codesign',['--verify','--strict',diskImage]);await run('/usr/bin/hdiutil',['verify',diskImage]);
   if(notary.enabled){console.log('Notarizing the disk image with Apple');appleSubmission.diskImage={...await notarize({artifact:diskImage,policy:notary}),...await stapleAndAssess({artifact:diskImage})};}
   Object.assign(receipt,{diskImage,sha256:await hashFile(diskImage),bytes:(await fs.stat(diskImage)).size});
  }finally{await fs.rm(work,{recursive:true,force:true});}
 }
 receipt.packagingInputs=[];
 for(const file of ['scripts/package-mac-widevine.mjs','scripts/fetch-mac-widevine.mjs','packaging/macos/widevine.cjs','packaging/macos/passkeys.cjs','packaging/mac/entitlements.mac.plist','packaging/macos/widevine-runtime.json','packaging/macos/update-zip.cjs','packaging/macos/update-verify.cjs'])receipt.packagingInputs.push({file,sha256:await hashFile(path.join(repo,file))});
 await fs.writeFile(path.join(output,'mac-widevine-package.json'),JSON.stringify(receipt,null,2)+'\n');
 if(notaryWork)await fs.rm(notaryWork,{recursive:true,force:true});
 return receipt;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [candidate,template,arch,version]=process.argv.slice(2).filter(argument=>!argument.startsWith('--'));
 if(!candidate||!template||!arch)throw Error('Usage: node scripts/package-mac-widevine.mjs <committed-candidate> <signed-template.app> <arm64|x64> [version] [--no-dmg] [--no-update-zip]\nWithout a version the package.json version of the candidate is used (npm run version:next sets it); a local build may pass 0.1.0-beta.N.local.M.');
 console.log(JSON.stringify(await packageMacWidevine(candidate,{template,arch,version,dmg:!process.argv.includes('--no-dmg'),updateZip:!process.argv.includes('--no-update-zip')}),null,2));
}
