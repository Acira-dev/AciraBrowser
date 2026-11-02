// A Developer ID signed, explicitly unnotarized Mac beta DMG. No Windows inputs
// are rewritten and no Apple submission or automatic-update offer is made.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {packageBetaInstaller} from './package-mac-beta-installer.mjs';

const repo=path.resolve(import.meta.dirname,'..'),require=createRequire(import.meta.url),run=promisify(execFile);
const plist=require('plist'),semver=require('semver');
const {getCurrentFuseWire,FuseV1Options}=require('@electron/fuses');
const {walk,hashFile}=require('../packaging/macos/install-engine.cjs');
const {signingPolicy,resealArguments,verifySigningDetails}=require('../packaging/macos/signing.cjs');
const {writeMacUpdateConfig}=require('../packaging/macos/update-feed.cjs');
const {macBuildVersion}=require('../packaging/macos/build-version.cjs');
const {NATIVE_FILES,readMacTor,spec}=require('../desktop/browser-services/tor-mac.cjs');
const signer=require('../desktop/browser-services/mac-distribution-identity.cjs');
const read=async file=>JSON.parse(await fs.readFile(file,'utf8'));
const machO=magic=>['cffaedfe','feedfacf','cafebabe','bebafeca','cafebabf','bfbafeca','cefaedfe','feedface'].includes(magic.toString('hex'));

export function betaVersion(sourceVersion,requested){
 if(!semver.valid(requested)||!semver.prerelease(requested)||semver.lt(requested,sourceVersion))throw Error('Choose the current or a newer Mac prerelease version; stable releases require the notarized distribution workflow.');
 return requested;
}

export async function packageMacBeta(candidate,{template,arch,version,signingIdentity=process.env.ACIRA_MAC_SIGN_IDENTITY||`Developer ID Application: ${signer.name} (${signer.team})`}={}){
 if(process.platform!=='darwin')throw Error('Build Mac beta DMGs on macOS.');
 if(!['arm64','x64'].includes(arch))throw Error('Choose the actual Mac runtime architecture.');
 candidate=path.resolve(candidate);template=path.resolve(template);
 const source=await read(path.join(candidate,'build-identity.json'));
 version=betaVersion(source.version,version);
 const head=(await run('git',['rev-parse','HEAD'],{cwd:repo})).stdout.trim();
 assert.equal(source.commit,head);assert(source.committedSource&&source.stable);assert.deepEqual(source.warnings,[]);
 assert.equal((await run('git',['status','--porcelain'],{cwd:repo})).stdout.trim(),'');
 for(const entry of source.artifacts)assert.equal(await hashFile(path.join(candidate,entry.file)),entry.sha256,entry.file);
 const policy=signingPolicy(signingIdentity,true);
 await run('/usr/bin/codesign',['--verify','--deep','--strict',template]);
 verifySigningDetails((await run('/usr/bin/codesign',['--display','--verbose=4',template])).stderr,policy);
 const oldBuild=await read(path.join(template,'Contents/Resources/ACIRA-BUILD.json'));
 assert.equal(oldBuild.electron,source.electron);assert.equal(oldBuild.arch,arch);
 const info=plist.parse(await fs.readFile(path.join(template,'Contents/Info.plist'),'utf8'));
 assert.equal(info.CFBundleIdentifier,'computer.acira.browser');
 const expectedArch=arch==='x64'?'x86_64':'arm64';
 assert.equal((await run('/usr/bin/lipo',['-archs',path.join(template,'Contents/MacOS/AciraBrowser')])).stdout.trim(),expectedArch);

 const parent=path.join(repo,'release',`mac-beta-${version}-${head.slice(0,8)}.noindex`);
 await fs.mkdir(parent,{recursive:true});
 const output=path.join(parent,arch);await fs.mkdir(output); // A previous package is never overwritten.
 const appBundle=path.join(output,'Acira Browser.app');
 await fs.cp(template,appBundle,{recursive:true,verbatimSymlinks:true});
 const resources=path.join(appBundle,'Contents/Resources'),application=path.join(resources,'app');
 await fs.rm(application,{recursive:true});await fs.mkdir(application);
 for(const folder of ['desktop','dist','resources','node_modules','source-licenses'])try{await fs.cp(path.join(candidate,folder),path.join(application,folder),{recursive:true,verbatimSymlinks:true});}catch(error){if(error.code!=='ENOENT')throw error;}
 for(const file of ['package.json','page-zoom-levels.json','LICENSE','THIRD_PARTY_NOTICES.md'])await fs.copyFile(path.join(candidate,file),path.join(application,file));
 const torDirectory=path.join(application,'resources/tor');
 if(!readMacTor(path.join(torDirectory,'tor'),{arch})){
  await fs.rm(torDirectory,{recursive:true});
  await fs.cp(path.join(template,'Contents/Resources/app/resources/tor'),torDirectory,{recursive:true});
 }
 assert(readMacTor(path.join(torDirectory,'tor'),{arch}));
 const torManifest=await read(path.join(torDirectory,'native-manifest.json'));
 assert.equal(torManifest.archiveSha256,spec(arch).archive.sha256);
 const pkg=await read(path.join(application,'package.json'));
 pkg.version=version;pkg.productName='Acira Browser';pkg.author={name:require('../packaging/electron-builder.json').extraMetadata.author.name};
 await fs.writeFile(path.join(application,'package.json'),JSON.stringify(pkg,null,2)+'\n');
 info.CFBundleVersion=macBuildVersion();info.CFBundleShortVersionString=semver.parse(version).version.split('-')[0];info.LSMinimumSystemVersion='13.0';
 await fs.writeFile(path.join(appBundle,'Contents/Info.plist'),plist.build(info));await require('../packaging/macos/icon.cjs').applyMacIcon(appBundle,repo);
 await writeMacUpdateConfig(resources);
 const publicBuild={version,bundleVersion:info.CFBundleVersion,sourceVersion:source.version,commit:head,sourceDigest:source.sourceDigest,electron:source.electron,arch,minimumMacOS:'13.0',notarized:false,stapled:false,iCloudPasskeysEnabled:false,updateFeed:require('../packaging/update-feed.cjs').DEFAULT_FEED_URL};
 await fs.writeFile(path.join(resources,'ACIRA-BUILD.json'),JSON.stringify(publicBuild,null,2)+'\n');
 assert.equal((await getCurrentFuseWire(appBundle))[FuseV1Options.EnableCookieEncryption],49);

 const signedNative=[];
 for(const entry of await walk(application)){
  if(entry.type!=='file'||entry.size<4)continue;
  const file=path.join(application,entry.path),handle=await fs.open(file,'r'),magic=Buffer.alloc(4);
  try{await handle.read(magic,0,4,0);}finally{await handle.close();}
  if(!machO(magic))continue;
  await run('/usr/bin/codesign',['--force','--sign',policy.identity,'--options','runtime','--timestamp',file]);
  await run('/usr/bin/codesign',['--verify','--strict',file]);signedNative.push(entry.path);
 }
 for(const name of NATIVE_FILES)torManifest.files[name]=await hashFile(path.join(torDirectory,name));
 await fs.writeFile(path.join(torDirectory,'native-manifest.json'),JSON.stringify(torManifest,null,2)+'\n');
 await run('/usr/bin/codesign',resealArguments(appBundle,policy));
 await run('/usr/bin/codesign',['--verify','--deep','--strict',appBundle]);
 verifySigningDetails((await run('/usr/bin/codesign',['--display','--verbose=4',appBundle])).stderr,policy);
 assert(readMacTor(path.join(torDirectory,'tor'),{arch}));
 let sourceFiles=0;
 for(const entry of source.artifacts){
  if(!/^(desktop|dist|resources|node_modules|source-licenses)\//.test(entry.file)&&!['page-zoom-levels.json','LICENSE','THIRD_PARTY_NOTICES.md'].includes(entry.file))continue;
  if(entry.file.endsWith('.node')||entry.file.startsWith('resources/tor/'))continue;
  assert.equal(await hashFile(path.join(application,entry.file)),entry.sha256,entry.file);sourceFiles++;
 }
 for(const entry of await walk(appBundle)){
  if(entry.type!=='file'||entry.size<4)continue;
  const file=path.join(appBundle,entry.path),handle=await fs.open(file,'r'),magic=Buffer.alloc(4);
  try{await handle.read(magic,0,4,0);}finally{await handle.close();}
  if(machO(magic))assert((await run('/usr/bin/lipo',['-archs',file])).stdout.trim().split(/\s+/).includes(expectedArch),entry.path);
 }

 const setup=await packageBetaInstaller({repo,browser:appBundle,output,source:{...source,arch},version,policy});
 const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'acira-mac-beta-'));let mounted=null;
 try{
  const image=path.join(temporary,'image');await fs.mkdir(image);
  await fs.cp(setup.installer,path.join(image,'Install Acira.app'),{recursive:true,verbatimSymlinks:true});
  await fs.writeFile(path.join(image,'READ ME.txt'),`Acira Browser ${version} (${head.slice(0,8)})\n\n${arch==='arm64'?'Apple silicon (M1 or newer)':'Intel Mac'}; macOS 13 or later.\nOpen Install Acira.app, choose Install Acira, then Open Acira when installation finishes.\nInstallation progress reflects real copying and verification. First-run setup opens afterward.\nQuit Acira normally before upgrading. Installation uses your personal Applications folder. Your browser profile is stored separately.\nDeveloper ID signed local beta; browser and installer are not notarized or stapled. macOS may warn or block opening them.\nThe app contains the public Mac update configuration; no new update is offered by this build process.\niCloud passkey authorization remains pending.\n`);
  const diskImage=path.join(output,`AciraBrowser-${version}-mac-${arch}.dmg`);
  await run('/usr/bin/hdiutil',['create','-volname','Acira Setup','-srcfolder',image,'-format','UDZO',diskImage],{maxBuffer:4*1024*1024});
  await run('/usr/bin/codesign',['--sign',policy.identity,'--timestamp',diskImage]);
  await run('/usr/bin/codesign',['--verify','--strict',diskImage]);await run('/usr/bin/hdiutil',['verify',diskImage]);
  mounted=path.join(temporary,'mounted');await fs.mkdir(mounted);
  await run('/usr/bin/hdiutil',['attach','-nobrowse','-readonly','-mountpoint',mounted,diskImage]);
  assert.deepEqual(await walk(path.join(mounted,'Install Acira.app')),await walk(setup.installer));
  assert.deepEqual((await fs.readdir(mounted)).filter(name=>!name.startsWith('.')).sort(),['Install Acira.app','READ ME.txt']);
  await run('/usr/bin/codesign',['--verify','--deep','--strict',path.join(mounted,'Install Acira.app')]);
  await run('/usr/bin/hdiutil',['detach',mounted]);mounted=null;
  const receipt={...publicBuild,...setup,installationMode:'native-setup',appBundle,diskImage,distributionSigned:true,signingIdentity:policy.identity,automaticUpdateOffered:false,appleSubmission:null,candidate,verifiedSourceFiles:sourceFiles,signedNative,bytes:(await fs.stat(diskImage)).size,sha256:await hashFile(diskImage),cookieEncryption:true,canonicalAppUntouched:true,passed:true,qualification:'Signed local beta browser and custom installer packaging/integrity checks; native install/upgrade and clean-device Gatekeeper qualification are separate.'};
  await fs.writeFile(path.join(output,'mac-beta-package.json'),JSON.stringify(receipt,null,2)+'\n');return receipt;
 }finally{
  if(mounted)try{await run('/usr/bin/hdiutil',['detach',mounted]);}catch{}
  await fs.rm(temporary,{recursive:true,force:true});
 }
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [candidate,template,arch,version]=process.argv.slice(2);
 if(!candidate||!template||!arch||!version)throw Error('Usage: node scripts/package-mac-beta.mjs <committed-candidate> <verified-signed-Mac-template.app> <arm64|x64> <new-beta-version>');
 const receipt=await packageMacBeta(candidate,{template,arch,version});
 console.log(JSON.stringify({arch,version,commit:receipt.commit,appBundle:receipt.appBundle,diskImage:receipt.diskImage,bytes:receipt.bytes,sha256:receipt.sha256,notarized:false,automaticUpdateOffered:false},null,2));
}
