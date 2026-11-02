// Reuse the native Mac installer for an explicitly unnotarized local beta.
// The notarized distribution workflow remains separate and unchanged.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {build} from 'esbuild';
const require=createRequire(import.meta.url),run=promisify(execFile),plist=require('plist');
const {walk,hashFile}=require('../packaging/macos/install-engine.cjs');
const {buildInstallerPage}=require('../packaging/macos/installer-page.cjs');
const {resealArguments,verifySigningDetails}=require('../packaging/macos/signing.cjs');
const inputs=['scripts/package-mac-beta.mjs','scripts/package-mac-beta-installer.mjs','packaging/macos/installer-main.cjs','packaging/macos/installer-preload.cjs','packaging/macos/installer-page.cjs','packaging/macos/install-engine.cjs','packaging/macos/running-app.cjs','packaging/macos/strings.cjs','packaging/installer/strings.json','docs/launch/concepts/installer-creation.html'];

export async function packageBetaInstaller({repo,browser,output,source,version,policy,archiveApplication=false}){
 const installer=path.join(output,'Install Acira.app'),resources=path.join(installer,'Contents/Resources');
 const packagingInputs=[];
 for(const file of inputs){
  const committed=(await run('git',['show',source.commit+':'+file],{cwd:repo,maxBuffer:32*1024*1024})).stdout;
  if(committed!==await fs.readFile(path.join(repo,file),'utf8'))throw Error('Installer source differs from committed input: '+file);
  packagingInputs.push({file,sha256:await hashFile(path.join(repo,file))});
 }
 // Keep the verified architecture-specific Electron framework signatures. The
 // browser payload goes in a manifest-verified archive, never a second launcher
 // beside the installer in the disk image.
 const omitted=new Set(['Contents/Resources/app','Contents/Resources/app.asar','Contents/Resources/app.asar.unpacked','Contents/Resources/tor','Contents/Resources/ACIRA-BUILD.json','Contents/Resources/app-update.yml','Contents/embedded.provisionprofile']);
 await fs.cp(browser,installer,{recursive:true,verbatimSymlinks:true,filter:file=>!omitted.has(path.relative(browser,file))});
 const infoFile=path.join(installer,'Contents/Info.plist'),info=plist.parse(await fs.readFile(infoFile,'utf8'));
 await fs.rename(path.join(installer,'Contents/MacOS',info.CFBundleExecutable),path.join(installer,'Contents/MacOS/AciraInstaller'));
 Object.assign(info,{CFBundleIdentifier:'computer.acira.installer',CFBundleName:'Acira Installer',CFBundleDisplayName:'Install Acira',CFBundleExecutable:'AciraInstaller'});
 for(const key of ['CFBundleURLTypes','CFBundleDocumentTypes','NSCameraUsageDescription','NSMicrophoneUsageDescription','ElectronAsarIntegrity'])delete info[key];
 await fs.writeFile(infoFile,plist.build(info));
 const application=path.join(resources,'app');await fs.mkdir(application);
 await build({entryPoints:[path.join(repo,'packaging/macos/installer-main.cjs')],outfile:path.join(application,'main.cjs'),bundle:true,platform:'node',format:'cjs',external:['electron','original-fs'],target:'node22'});
 await fs.copyFile(path.join(repo,'packaging/macos/installer-preload.cjs'),path.join(application,'installer-preload.cjs'));
 await fs.writeFile(path.join(application,'package.json'),JSON.stringify({name:'acira-installer',productName:'Acira Installer',version,main:'main.cjs'},null,2)+'\n');
 const scene=buildInstallerPage(await fs.readFile(path.join(repo,'docs/launch/concepts/installer-creation.html'),'utf8'));
 await fs.writeFile(path.join(application,'installer.html'),scene.html);await fs.writeFile(path.join(application,'installer-art.js'),scene.script);
 if(archiveApplication)await require('../packaging/macos/widevine.cjs').sealAsar(installer);
 const archive=path.join(resources,'payload.zip');
 await run('/usr/bin/ditto',['--norsrc','--noextattr','-c','-k','--keepParent',browser,archive],{maxBuffer:1024*1024});
 const payload={schema:1,appName:'Acira Browser.app',commit:source.commit,sourceDigest:source.sourceDigest,version,notarized:false,archiveSha256:await hashFile(archive),entries:await walk(browser)};
 await fs.writeFile(path.join(resources,'payload.json'),JSON.stringify(payload));
 await fs.writeFile(path.join(resources,'ACIRA-INSTALLER-BUILD.json'),JSON.stringify({version,commit:source.commit,sourceDigest:source.sourceDigest,arch:source.arch,distributionSigned:true,notarized:false,stapled:false,appleSubmission:null,packagingInputs},null,2)+'\n');
 for(const file of ['LICENSE','THIRD_PARTY_NOTICES.md'])await fs.copyFile(path.join(repo,file),path.join(resources,file));
 await run('/usr/bin/codesign',resealArguments(installer,policy));
 await run('/usr/bin/codesign',['--verify','--deep','--strict',installer]);
 const details=(await run('/usr/bin/codesign',['--display','--verbose=4',installer])).stderr;
 verifySigningDetails(details,policy);
 if(!details.includes('Identifier=computer.acira.installer\n'))throw Error('Installer signing identifier differs.');
 return {installer,payloadArchiveSha256:payload.archiveSha256,payloadFiles:payload.entries.length,packagingInputs,installerSignatureVerified:true,installerNotarized:false};
}
