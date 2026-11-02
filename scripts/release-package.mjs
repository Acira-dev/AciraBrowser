import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {root,filesIn,sha} from './release-build.mjs';
import {applyWindowsResources} from './release-windows-resources.mjs';
import {verifyRuntimePolicy} from './release-runtime-policy.mjs';
const require=createRequire(import.meta.url);
const {windowsUpdateConfig,serializeUpdateConfig}=require('../packaging/windows-update-config.cjs');
const {loadReleaseTarget,repoSlug}=require('../packaging/release-target.cjs'),releaseSource=()=>{const slug=repoSlug(loadReleaseTarget());return slug?'https://github.com/'+slug:'the project release page';}; // packaging/release-target.json
export async function packageWindows(candidate){
  if(process.platform!=='win32'||process.arch!=='x64')throw new Error('This package path is only qualified on Windows x64');
  candidate=path.resolve(candidate);const identity=JSON.parse(await fs.readFile(path.join(candidate,'build-identity.json'),'utf8'));if(!identity.stable||identity.warnings.length)throw new Error('Candidate build must be stable and warning-free in native bundling');
  if(identity.committedSource!==true)throw new Error('Release packaging requires an immutable committed-source candidate; diagnostic builds remain QA evidence only');
  const artworkPolicy=JSON.parse(await fs.readFile(path.join(root,'packaging/artwork-policy.json'),'utf8'));
  for(const excluded of artworkPolicy.excluded)if(identity.source.some(item=>item.file===excluded.file||item.sha256===excluded.sha256)||identity.artifacts.some(item=>item.sha256===excluded.sha256||path.basename(item.file)===path.basename(excluded.file)))throw new Error('Unqualified inherited artwork is present in candidate source or artifacts');
  for(const item of identity.artifacts)if(sha(await fs.readFile(path.join(candidate,item.file)))!==item.sha256)throw new Error('Candidate artifact changed after build: '+item.file);
  const approvedArtifacts=new Set(identity.artifacts.map(item=>item.file));
  for(const file of await filesIn(candidate)){const relative=path.relative(candidate,file).replaceAll('\\','/');if(/^(?:desktop|dist|resources|node_modules)\//.test(relative)&&!approvedArtifacts.has(relative))throw new Error('Unlisted candidate product file: '+relative);}
  const artworkCatalog=JSON.parse(await fs.readFile(path.join(candidate,artworkPolicy.catalog),'utf8'));
  for(const painting of artworkCatalog.paintings){if(!/^\/artwork\/[a-zA-Z0-9-]+\.jpg$/.test(painting.src)||sha(await fs.readFile(path.join(candidate,'dist',painting.src.slice(1))))!==painting.sha256)throw new Error('Artwork catalog/file identity mismatch');}
  try{await fs.access(path.join(candidate,'WITHDRAWN.json'));throw new Error('Candidate build was withdrawn; use its corrected replacement');}catch(error){if(error.code!=='ENOENT')throw error;}
  const hasUiPreload=await fs.access(path.join(candidate,'desktop/ui-preload.cjs')).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error;});
  if(hasUiPreload&&!identity.sharedNativeSDK)throw new Error('Connected sandbox candidate requires the shared native extension SDK artifact');
  if(identity.sharedNativeSDK&&(identity.sharedNativeSDK.bundledEntry!=='node_modules/electron-chrome-extensions/index.cjs'||sha(await fs.readFile(path.join(candidate,identity.sharedNativeSDK.bundledEntry)))!==identity.sharedNativeSDK.entrySha256))throw new Error('Shared native extension SDK identity differs from the candidate');
  const withdrawals=JSON.parse(await fs.readFile(path.join(root,'docs/release/withdrawals.json'),'utf8'));if(withdrawals.candidates.some(item=>item.sourceDigest===identity.sourceDigest))throw new Error('Candidate was withdrawn; rebuild the local-only product before packaging');
  if(!/^\d+\.\d+\.\d+(?:-[a-zA-Z\d.-]+)?$/.test(identity.version)||!/^[a-f0-9]{64}$/.test(identity.sourceDigest))throw new Error('Invalid package identity');
  const runtime=path.join(path.dirname(require.resolve('electron/package.json')),'dist'),installedElectron=require('electron/package.json').version;if(installedElectron!==identity.electron)throw new Error('Installed runtime changed after candidate build; rebuild against the qualified pin');
  const runtimeQualification=verifyRuntimePolicy({policy:JSON.parse(await fs.readFile(path.join(root,'packaging/runtime-security.json'),'utf8')),version:installedElectron,executableSha256:sha(await fs.readFile(path.join(runtime,'electron.exe')))});
  const output=path.join(root,'release',`AciraBrowser-${identity.version}-win32-x64-${identity.sourceDigest.slice(0,8)}-unsigned`);
  try{await fs.access(output);throw new Error('Package already exists; do not overwrite release evidence');}catch(error){if(error.code!=='ENOENT')throw error;}
  await fs.cp(runtime,output,{recursive:true,filter:file=>!file.endsWith('default_app.asar')});
  await fs.rename(path.join(output,'electron.exe'),path.join(output,'AciraBrowser.exe'));
  try{await fs.rename(path.join(output,'electron_wer.dll'),path.join(output,'AciraBrowser_wer.dll'));}catch(error){if(error.code!=='ENOENT')throw error;}
  const appDir=path.join(output,'resources/app');await fs.mkdir(appDir,{recursive:true});
  for(const item of ['desktop','dist','resources','node_modules','package.json','page-zoom-levels.json']){try{await fs.cp(path.join(candidate,item),path.join(appDir,item),{recursive:true,errorOnExist:true});}catch(error){if(error.code!=='ENOENT')throw error;}}
  for(const item of ['LICENSE','THIRD_PARTY_NOTICES.md'])await fs.copyFile(path.join(identity.committedSource?candidate:root,item),path.join(appDir,item));
  await fs.copyFile(path.join(root,'packaging/acira-icon-512.png'),path.join(appDir,'dist/app-icon.png'));
  // Where the installed app looks for updates (electron-builder does not write this for a prepackaged folder; see packaging/windows-update-config.cjs).
  const updateConfig=windowsUpdateConfig();await fs.writeFile(path.join(output,'resources','app-update.yml'),serializeUpdateConfig(updateConfig));
  const windowsResources=await applyWindowsResources(path.join(output,'AciraBrowser.exe'),identity.version);
  const notices=path.join(appDir,'licenses');await fs.mkdir(notices,{recursive:true});
  await fs.copyFile(path.join(root,'packaging/LICENSE.NSIS.txt'),path.join(notices,'NSIS-COPYING.txt'));
  if(identity.committedSource){for(const file of await fs.readdir(path.join(candidate,'source-licenses')))await fs.copyFile(path.join(candidate,'source-licenses',file),path.join(notices,file));}
  else{try{await fs.copyFile(path.join(root,'src/features/onboarding/upstream/LICENSE'),path.join(notices,'helium-onboarding-GPL-3.0.txt'));}catch(error){if(error.code!=='ENOENT')throw error;}try{await fs.copyFile(path.join(root,'src/ui/LICENSE.iphone-solo.txt'),path.join(notices,'iphone-solo-MIT.txt'));}catch(error){if(error.code!=='ENOENT')throw error;}}
  const lockBytes=await fs.readFile(path.join(identity.committedSource?candidate:root,identity.committedSource?'package-lock.source.json':'package-lock.json'));if(sha(lockBytes)!==identity.lockSha256)throw new Error('Dependency lock changed after candidate build');const lock=JSON.parse(lockBytes.toString('utf8')),dependencies=[];
  for(const [relative,locked]of Object.entries(lock.packages||{})){
    if(!relative||locked.dev||!relative.startsWith('node_modules/'))continue;
    const dir=path.join(root,relative);let pkg;try{pkg=JSON.parse(await fs.readFile(path.join(dir,'package.json'),'utf8'));}catch{throw new Error('Missing locked production dependency: '+relative);}
    if(pkg.version!==locked.version)throw new Error('Installed dependency differs from lock: '+relative);
    const label=relative.replaceAll('/','__'),licenseFiles=(await fs.readdir(dir)).filter(file=>/^(?:licen[cs]e|copying|notice)(?:[.-]|$)/i.test(file));
    const records=[];for(const file of licenseFiles){const source=path.join(dir,file);if(!(await fs.stat(source)).isFile())continue;const bytes=await fs.readFile(source);const target=label+'__'+file;await fs.writeFile(path.join(notices,target),bytes);records.push({file:target,sha256:sha(bytes)});}
    dependencies.push({name:pkg.name,version:pkg.version,license:pkg.license,repository:pkg.repository,resolved:locked.resolved,integrity:locked.integrity,notices:records});
  }
  await fs.writeFile(path.join(notices,'dependencies.json'),JSON.stringify(dependencies,null,2)+'\n');
  const runtimeFiles=[];for(const file of await filesIn(runtime)){if(file.endsWith('default_app.asar'))continue;runtimeFiles.push({file:path.relative(runtime,file).replaceAll('\\','/'),sha256:sha(await fs.readFile(file))});}
  const packagingInputs=[];for(const file of ['scripts/release-build.mjs',...(identity.committedSource?['scripts/release-build-head.mjs']:[]),'scripts/release-shared-sdk.mjs','scripts/release-package.mjs','scripts/release-windows-resources.mjs','packaging/icon-provenance.json','packaging/acira-icon.ico','packaging/acira-icon-512.png','packaging/rcedit-tool.json','packaging/runtime-security.json','packaging/artwork-policy.json','packaging/LICENSE.NSIS.txt','scripts/release-runtime-policy.mjs','packaging/windows-update-config.cjs','packaging/release-target.json','LICENSE','THIRD_PARTY_NOTICES.md']){const captured=identity.committedSource&&['LICENSE','THIRD_PARTY_NOTICES.md'].includes(file);packagingInputs.push({file,source:captured?'captured-product':'packaging-tool',sha256:sha(await fs.readFile(path.join(captured?candidate:root,file)))});}
  const provenance={schema:1,createdAt:new Date().toISOString(),product:'Acira Browser',version:identity.version,commit:identity.commit,committedSource:identity.committedSource===true,sourceDigest:identity.sourceDigest,electron:identity.electron,platform:'win32',arch:'x64',lockSha256:identity.lockSha256,runtimeQualification,runtimeFiles,windowsResources,packagingInputs,dependencies:dependencies.map(({name,version,license})=>({name,version,license})),signing:'No Acira code signing; product resources are branded, executable remains unsigned.',update:'The installed (NSIS) app reads its update feed from resources/app-update.yml: '+updateConfig.url+'. Portable copies never update themselves. No signing identity is configured.',updateConfig:{file:'resources/app-update.yml',url:updateConfig.url},artwork:{policySha256:sha(await fs.readFile(path.join(root,'packaging/artwork-policy.json'))),catalogSha256:sha(await fs.readFile(path.join(candidate,artworkPolicy.catalog))),excluded:artworkPolicy.excluded,files:artworkCatalog.paintings.map(({id,src,sha256,rights,source,metadataURL})=>({id,src,sha256,rights,source,metadataURL}))},nativeQualification:'Pending standalone package launch/relaunch. Isolated source native evidence is separate.',limitations:['Unsigned portable candidate, not an installer. No macOS/Linux native acceptance. Artwork provenance is recorded for these exact catalog bytes; new assets require their own rights review.']};
  await fs.writeFile(path.join(output,'ACIRA-PROVENANCE.json'),JSON.stringify(provenance,null,2)+'\n');
  await fs.writeFile(path.join(output,'READ-ME.txt'),`Acira Browser ${identity.version}\n\nPortable Windows x64 candidate. Run AciraBrowser.exe directly.\nProfile: %APPDATA%\\AciraBrowser (never included in this package).\nNo Acira account or development server is required for local browsing.\nNo Acira signing identity, installer or verified automatic update service is configured.\nKeep the entire directory together. Do not copy profiles into it.\nSource: ${releaseSource()}\nSource digest: ${identity.sourceDigest}\nSee ACIRA-PROVENANCE.json and resources/app/THIRD_PARTY_NOTICES.md.\n`);
  // Private windows with Tor need tor.exe: fetch and verify the pinned Expert Bundle (pinned SHA-256 always, the Tor Browser Developers signature when gpg exists), then ship it as resources/tor.
  {const torSource=path.join(root,'desktop/browser-services/tor-engine/win-x64'),torManifest=JSON.parse(await fs.readFile(path.join(root,'desktop/browser-services/tor-engine/tor-version.json'),'utf8'));
   const hasGpg=spawnSync('gpg',['--version'],{stdio:'ignore'}).status===0;
   const fetched=spawnSync(process.execPath,[path.join(root,'scripts/fetch-tor.mjs'),...(hasGpg?['--require-signature']:[])],{stdio:'inherit'});if(fetched.status!==0)throw new Error('Could not fetch and verify the pinned Tor engine; a release without tor.exe would break private windows with Tor');
   const torTarget=path.join(output,'resources','tor');await fs.mkdir(torTarget,{recursive:true});
   // tor.exe + licence, then the bridge clients + licences (resources/tor/pluggable_transports/): each must match its pin.
   const torFiles={...torManifest.files,...(torManifest.pluggableTransports?.files||{})};
   for(const [name,entry] of Object.entries(torFiles)){const bytes=await fs.readFile(path.join(torSource,name));if(sha(bytes)!==entry.sha256)throw new Error('Pinned Tor file hash mismatch: '+name);await fs.mkdir(path.dirname(path.join(torTarget,name)),{recursive:true});await fs.writeFile(path.join(torTarget,name),bytes);}}
  const artifacts=[];for(const file of await filesIn(output))artifacts.push({file:path.relative(output,file).replaceAll('\\','/'),sha256:sha(await fs.readFile(file)),bytes:(await fs.stat(file)).size});
  if(artifacts.some(item=>artworkPolicy.excluded.some(excluded=>item.sha256===excluded.sha256||path.basename(item.file)===path.basename(excluded.file))))throw new Error('Unqualified inherited artwork entered the final portable package');
  await fs.writeFile(path.join(output,'FILES-SHA256.json'),JSON.stringify({sourceDigest:identity.sourceDigest,files:artifacts},null,2)+'\n');
  return {output,files:artifacts.length,bytes:artifacts.reduce((sum,file)=>sum+file.bytes,0),sourceDigest:identity.sourceDigest,notices:dependencies.length};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){if(!process.argv[2])throw new Error('Pass an isolated release candidate directory');console.log(JSON.stringify(await packageWindows(process.argv[2]),null,2));}
