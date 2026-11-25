import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {root,sha,filesIn} from './release-build.mjs';
import {verifySigned,preflightSigning,readSignRecords,certumThumbprint,publisherNames,signingMode} from './release-sign.mjs';
import {verifyRuntimePolicy} from './release-runtime-policy.mjs';
import {inspectInstallerPayload} from './release-installer-payload.mjs';
const require=createRequire(import.meta.url);
const {applySigning}=require('../packaging/signing-config.cjs');
export async function buildInstaller(folder,{verifyExistingConfig}={}){
 if(process.platform!=='win32'||process.arch!=='x64')throw new Error('Installer qualification is Windows x64 only');
 folder=path.resolve(folder);if(!folder.startsWith(path.join(root,'release')+path.sep))throw new Error('Use a generated portable package');
 const provenance=JSON.parse(await fs.readFile(path.join(folder,'ACIRA-PROVENANCE.json'),'utf8'));
 if(!provenance.committedSource)throw new Error('Installer requires an immutable committed-source product');
 // A Widevine build (packaging/windows-widevine.cjs): the rigs qualify its twin, and only the sealed, VMP-signed copy of the twin becomes an installer.
 if(provenance.widevine&&provenance.widevine.stage!=='sealed')throw new Error('This folder is the qualification twin of a Widevine build and has no VMP signature: build the installer from the sealed folder made from it.');
 // Signing (ACIRA_SIGN=certum; docs/launch/CODE_SIGNING.md): electron-builder signs the uninstaller and the setup itself while it builds (scripts/release-sign-hook.cjs), so the blockmap
 // and the SHA-512 in latest.yml describe the SIGNED setup. Without signing the setup must come out unsigned, as before.
 const mode=signingMode(process.env),signingOn=mode!=='none',names=publisherNames(process.env);
 if(signingOn&&mode!=='certum'&&mode!=='azure')throw new Error('The Windows installer path signs with ACIRA_SIGN=certum (or azure); '+mode+' is not wired here.');
 if(signingOn){preflightSigning(process.env);const pinned=provenance.updateConfig?.publisherName;if(!Array.isArray(pinned)||!pinned.length||!names.every(name=>pinned.includes(name)))throw new Error('Signing is on, but the portable package\'s resources/app-update.yml names no publisher ('+JSON.stringify(pinned||null)+'): the installed app could not check who signed its updates. Build the portable package again with ACIRA_PUBLISHER_NAME set.');}
 else if(provenance.updateConfig?.publisherName)throw new Error('The portable package names a publisher in resources/app-update.yml but signing is off: the installed app would refuse unsigned updates. Build again with the same signing settings.');
 const policy=JSON.parse(await fs.readFile(path.join(root,'packaging/runtime-security.json'),'utf8'));verifyRuntimePolicy({policy,version:provenance.electron,executableSha256:provenance.runtimeQualification?.upstreamExecutableSha256});
 for(const marker of ['WITHDRAWN.json','WITHDRAWN-RUNTIME.json'])try{await fs.access(path.join(folder,marker));throw new Error('Portable package is withdrawn');}catch(error){if(error.code!=='ENOENT')throw error;}
 const manifestBytes=await fs.readFile(path.join(folder,'FILES-SHA256.json')),manifest=JSON.parse(manifestBytes.toString('utf8')),manifestSha256=sha(manifestBytes),payloadPrefix=folder+path.sep;
 const verifyPayload=async()=>{for(const entry of manifest.files){const file=path.resolve(folder,entry.file);if(!file.startsWith(payloadPrefix)||sha(await fs.readFile(file))!==entry.sha256)throw new Error('Portable payload integrity mismatch: '+entry.file);}};await verifyPayload();
 const widevine=provenance.widevine?await require('../packaging/windows-widevine.cjs').verifySealedWidevine({sealed:folder,root,provenance}):null,qualifiedManifestSha256=widevine?widevine.twinManifestSha256:manifestSha256;
 let qualified;for(const file of (await fs.readdir(path.join(root,'qa/artifacts'))).filter(file=>/^release-package-\d+\.json$/.test(file)).sort().reverse()){const report=JSON.parse(await fs.readFile(path.join(root,'qa/artifacts',file),'utf8'));if(report.status==='PASS'&&report.sourceDigest===provenance.sourceDigest&&report.packageManifestSha256===qualifiedManifestSha256&&report.actual?.runtime?.electron===provenance.electron){qualified={file,sha256:sha(await fs.readFile(path.join(root,'qa/artifacts',file))),runtime:report.actual.runtime};break;}}
 if(!qualified)throw new Error('Run native packaged UI/runtime qualification against this exact payload manifest first');
 // N: the installer must carry a verified tor.exe (pinned SHA-256 + Tor Browser Developers signature); a release never ships without it.
 await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[path.join(root,'scripts/fetch-tor.mjs'),'--require-signature'],{stdio:'inherit'});child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error('Tor engine fetch/verification failed (scripts/fetch-tor.mjs --require-signature)')));});
 const builderFile=require.resolve('electron-builder/package.json'),builder=JSON.parse(await fs.readFile(builderFile,'utf8'));if(builder.version!=='26.15.3')throw new Error('Installer builder must match exact qualified26.15.3pin');
 const project=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));if(project.version!==provenance.version||project.build)throw new Error('Current root version/build overrides require a new reviewed installer configuration');
 const output=path.join(root,'release/installers',provenance.sourceDigest.slice(0,8)+(widevine?'-widevine':''));
 const {applyReleaseTarget}=require('../packaging/release-target.cjs'),config=applyReleaseTarget(JSON.parse(await fs.readFile(path.join(root,'packaging/electron-builder.json'),'utf8')));config.electronVersion=provenance.electron;config.directories.output=output;applySigning(config,process.env);
 let configFile;
 if(verifyExistingConfig){
  configFile=path.resolve(verifyExistingConfig);if(path.dirname(configFile)!==path.join(root,'qa/artifacts')||!/^release-installer-config-\d+\.json$/.test(path.basename(configFile)))throw new Error('Use the retained generated installer configuration');
  if(JSON.stringify(JSON.parse(await fs.readFile(configFile,'utf8')))!==JSON.stringify(config))throw new Error('Retained compiled installer configuration differs from current reviewed inputs');
 }else{
  try{const previous=await fs.readdir(output),intermediate='acira-browser-'+provenance.version+'-x64.nsis.7z';if(previous.some(file=>file!==intermediate))throw new Error('Installer output exists; preserve prior evidence');for(const file of previous){const target=path.resolve(output,file);if(path.dirname(target)!==output)throw new Error('Invalid generated intermediate path');await fs.unlink(target);}}catch(error){if(error.code!=='ENOENT')throw error;}
  configFile=path.join(root,'qa/artifacts','release-installer-config-'+Date.now()+'.json');await fs.writeFile(configFile,JSON.stringify(config,null,2)+'\n');
 }
 const environment={...process.env,CSC_IDENTITY_AUTO_DISCOVERY:'false',ELECTRON_BUILDER_CACHE:path.join(root,'.bootstrap/electron-builder'),ACIRA_BUILD_CACHE_RENAME_RETRY:'1',NODE_OPTIONS:'',DEBUG:''};for(const name of Object.keys(environment))if(/^(?:CSC_|WIN_CSC_)/.test(name)&&name!=='CSC_IDENTITY_AUTO_DISCOVERY'||['GH_TOKEN','GITHUB_TOKEN','GITHUB_RELEASE_TOKEN','NPM_TOKEN'].includes(name))delete environment[name];
 if(signingOn&&!environment.ACIRA_SIGN_RECORDS)environment.ACIRA_SIGN_RECORDS=path.join(root,'qa/artifacts','release-sign-records-'+Date.now()+'.jsonl'); // every signature of this build, appended by scripts/release-sign.mjs (also by the electron-builder child)
 if(!verifyExistingConfig){
  console.log('Compiling '+(signingOn?'signed ('+mode+')':'unsigned')+' per-user NSIS wrapper; product launch/default settings are not invoked.');
  const cli=path.resolve(path.dirname(builderFile),builder.bin['electron-builder']);await new Promise((resolve,reject)=>{const child=spawn(process.execPath,['--require',path.join(root,'scripts/release-build-cache-retry.cjs'),cli,'--win','nsis','--x64','--prepackaged',folder,'--config',configFile,'--publish','never'],{cwd:root,env:environment,windowsHide:true,stdio:['ignore','pipe','pipe']});child.stdout.on('data',bytes=>process.stdout.write(bytes));child.stderr.on('data',bytes=>process.stderr.write(bytes));child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error('Installer builder exited '+code)));});
 }
 await verifyPayload();
 const setup=(await filesIn(output)).filter(file=>/AciraBrowserSetup\.exe$/.test(file));if(setup.length!==1)throw new Error('Expected exactly one setup artifact');
 const signatureEnvironment={...process.env,PSModulePath:path.join(process.env.SystemRoot||'C:\\Windows','System32/WindowsPowerShell/v1.0/Modules'),ACIRA_INSTALLER_SIGNATURE_PATH:setup[0]};
 const signature=(await promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-Command',"$ErrorActionPreference = 'Stop'; $s = Get-AuthenticodeSignature -LiteralPath $env:ACIRA_INSTALLER_SIGNATURE_PATH; $s.Status.ToString()"],{env:signatureEnvironment,windowsHide:true})).stdout.trim();let signing=null;
 if(signingOn){
  if(signature!=='Valid')throw new Error('Signing was configured but the setup is not validly signed (Windows says '+signature+').');
  const records=readSignRecords(environment.ACIRA_SIGN_RECORDS);
  if(mode==='certum'){
   const final=verifySigned(setup[0],{env:process.env,names,thumbprint:certumThumbprint(process.env)}); // the file that exists now, checked once more
   if(!records.some(record=>/__uninstaller\.exe$/i.test(record.name)))throw new Error('Signing was configured but electron-builder signed no uninstaller (nothing in '+environment.ACIRA_SIGN_RECORDS+'): the setup would install an unsigned uninstaller.');
   signing={mode,publisherName:names,thumbprint:final.thumbprint,setup:final,files:records};
  }else signing={mode,publisherName:names,files:[]};
 }else if(signature!=='NotSigned')throw new Error('Installer is not the expected unsigned artifact: '+signature);
 const payload=await inspectInstallerPayload({installer:setup[0],folder,manifest,manifestBytes});
 // inspectInstallerPayload proved the setup embeds exactly the manifest's files, so this entry is in the setup: without it no installed copy could update itself.
 const updateEntry=manifest.files.find(entry=>entry.file==='resources/app-update.yml');if(!updateEntry||!provenance.updateConfig)throw new Error('The portable payload has no resources/app-update.yml: a setup built from it could never update itself. Rebuild the portable package with the current scripts/release-package.mjs.');
 const updateConfig={file:updateEntry.file,sha256:updateEntry.sha256,url:provenance.updateConfig.url,...(provenance.updateConfig.publisherName?{publisherName:provenance.updateConfig.publisherName}:{})};
 const inputs=[];for(const file of ['packaging/electron-builder.json','packaging/acira-installer.nsh','packaging/acira-icon.ico','packaging/LICENSE.NSIS.txt','LICENSE','scripts/release-installer.mjs','scripts/release-installer-payload.mjs','packaging/windows-update-config.cjs','scripts/release-build-cache-retry.cjs',...(widevine?['packaging/windows-widevine.cjs']:[])])inputs.push({file,sha256:sha(await fs.readFile(path.join(root,file)))});
 await fs.copyFile(path.join(root,'packaging/LICENSE.NSIS.txt'),path.join(output,'LICENSE.NSIS.txt'));
 const record={schema:1,createdAt:new Date().toISOString(),product:'Acira Browser',version:provenance.version,sourceCommit:provenance.commit,sourceDigest:provenance.sourceDigest,runtimeQualification:provenance.runtimeQualification,packagedNativeQualification:qualified,portableManifestSha256:manifestSha256,installer:{file:path.basename(setup[0]),sha256:sha(await fs.readFile(setup[0])),bytes:(await fs.stat(setup[0])).size,signature,...(signing?{signing}:{})},updateConfig,...(widevine?{widevine:{...provenance.widevine,twinQualification:qualified.file,comparison:widevine.comparison}}:{}),builder:{version:builder.version,lockSha256:sha(await fs.readFile(path.join(root,'package-lock.json'))),configurationSha256:sha(await fs.readFile(configFile)),recoveredExistingCompilation:!!verifyExistingConfig,inputs},payload,publish:'never',installation:'Not executed. Isolated installed upgrade/registration/uninstall remain pending.',limitations:[(signing?'Signed per-user installer ('+mode+'); no auto-run/default override/native':'Unsigned per-user installer; no auto-run/default override/signing/native')+' other-platform claim. It embeds resources/app-update.yml (the update feed); installing it over an older copy and updating through it have not been exercised by this build.','Payload extraction proves embedded product integrity; installation scripts and real Windows install/upgrade/uninstall behavior require separate qualification.']};await fs.writeFile(path.join(output,'ACIRA-INSTALLER-PROVENANCE.json'),JSON.stringify(record,null,2)+'\n');return {output,...record};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){if(!process.argv[2])throw new Error('Pass the qualified generated portable folder');if(process.argv[3]&&process.argv[3]!=='--verify-existing')throw new Error('Unknown installer operation');if(process.argv[3]&&!process.argv[4])throw new Error('Pass the retained generated configuration after --verify-existing');console.log(JSON.stringify(await buildInstaller(process.argv[2],{verifyExistingConfig:process.argv[4]}),null,2));}
