// Manual Windows-only build. Reuses the existing portable/NSIS install flow.
// Nothing is uploaded, installed into a real profile, or published here.
// --widevine (npm run build:windows:widevine): protected video. castlabs' ECS runtime instead of stock Electron; every check below qualifies
// it as a twin, then a sealed copy is VMP-signed and becomes the installer (packaging/windows-widevine.cjs, docs/launch/WINDOWS_WIDEVINE.md).
// Without the flag nothing changes.
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
const root=path.resolve(import.meta.dirname,'..'),require=createRequire(import.meta.url);
if(process.platform!=='win32'||process.arch!=='x64')throw Error('Run this command on Windows x64 with Node.js 24; a Mac run cannot qualify the Windows installer.');
const pkg=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
if(!/^0\.1\.\d+-beta\.\d+$/.test(pkg.version))throw Error('Use the committed 0.1 Beta source version for this manual build.');
function run(exe,args,env={}){const result=spawnSync(exe,args,{cwd:root,stdio:'inherit',env:{...process.env,...env},windowsHide:true});if(result.error)throw result.error;if(result.status!==0)throw Error('Stopped at '+path.basename(exe)+' '+args.join(' ')+' (exit '+result.status+'). No installer was published.');}
const git=spawnSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'});if(git.status!==0||git.stdout.trim())throw Error('Pull committed main and keep the checkout clean before building.');
const head=spawnSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'});if(head.status!==0)throw Error('Unable to identify the source commit.');
const commit=head.stdout.trim(),candidate=path.join(root,'release','windows-'+pkg.version+'-'+commit.slice(0,8)+'-candidate');
// Widevine: the EVS login and client, and the pinned ECS runtime, before any long work, so a missing piece stops the build in its first minutes.
const widevine=process.argv.includes('--widevine'),sealing=widevine?require('../packaging/windows-widevine.cjs'):null;let evs=null,runtime=null;
if(widevine){evs=await sealing.preflight();console.log('Widevine build: EVS client '+evs.client+' ('+evs.python+'), login refreshed');runtime=await (await import('./fetch-windows-widevine.mjs')).fetchWindowsWidevineRuntime();}
const node=(file,...args)=>run(process.execPath,[path.join(root,file),...args]);
for(const script of ['build','test'])run(process.env.ComSpec||'cmd.exe',['/d','/s','/c','npm run '+script]);
node('qa/windows-browser-flows.mjs');node('qa/sidebar-hover-overlay.mjs');node('scripts/release-runtime-policy.mjs');node('scripts/release-build-head.mjs',candidate);
for(const file of ['qa/release-fresh-profile.mjs','qa/release-browser-journeys.mjs','qa/release-profile-settings.mjs'])node(file,candidate);
node('qa/release-profile-cleanup.mjs',candidate,'--committed-fixture');node('qa/release-profile-cleanup.mjs',candidate,'--committed-fixture','--worker');
node('qa/release-private-close.mjs',candidate);node('qa/release-private-close.mjs',candidate,'--last-window');
run(process.execPath,[path.join(root,'qa/accounts-private-worker-source.mjs')],{ACIRA_PRIVATE_WORKER_SOURCE:candidate});
const {packageWindows}=await import('./release-package.mjs'),portable=await packageWindows(candidate,{widevine:runtime});
if(runtime)await fs.rm(runtime.runtime,{recursive:true,force:true}); // the extracted copy; the verified archive stays in the cache
node('qa/release-fresh-profile.mjs',candidate,portable.output);
for(const file of ['qa/release-package-launch.mjs','qa/release-packaged-filtering.mjs','qa/release-external-url.mjs'])node(file,portable.output);
const reports=[];for(const name of await fs.readdir(path.join(root,'qa/artifacts'))){if(!/^release-package-\d+\.json$/.test(name))continue;const r=JSON.parse(await fs.readFile(path.join(root,'qa/artifacts',name),'utf8'));if(r.status==='PASS'&&r.sourceDigest===portable.sourceDigest)reports.push(name);}
const qualified=reports.sort().at(-1);if(!qualified)throw Error('The exact packaged Windows application did not pass native qualification.');
node('qa/release-profile-cleanup.mjs',portable.output,'--committed-fixture',qualified);node('qa/release-profile-cleanup.mjs',portable.output,'--committed-fixture',qualified,'--worker');
node('qa/release-private-close.mjs',portable.output,qualified);node('qa/release-private-close.mjs',portable.output,qualified,'--last-window');
for(const file of ['qa/accounts-private-worker.mjs','qa/release-session-cookie.mjs','qa/release-reader-assets.mjs'])node(file);
// Widevine: the folder qualified above is the twin. A sealed copy of it is VMP-signed and is the product. Its program refuses a debugger (the EVS
// fuse set), so the rigs above cannot drive it; check 1 of the release gate opens it the way a person does instead, on a throwaway profile.
let product=portable.output,sealed=null;
if(widevine){
 // Microsoft signing, once it exists: pass authenticode:file=>signFiles([file]) (scripts/release-sign.mjs) here. It runs before VMP, the order Windows needs.
 sealed=await sealing.sealWindowsWidevine(portable.output,{root,python:evs.python});product=sealed.output;
 run('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'qa/release-alive.ps1'),'-Exe',path.join(product,'AciraBrowser.exe'),'-Profile',path.join(root,'.qa-profiles','widevine-alive-'+Date.now())]);
}
// Retain the existing freshly compiled Creation helpers until the child installer build exits.
const {withInstallerHelpers}=await import('./release-helpers.mjs');
withInstallerHelpers({root,sign:()=>{},build:()=>node('scripts/release-installer.mjs',product)});
const installerDirectory=path.join(root,'release/installers',portable.sourceDigest.slice(0,8)+(widevine?'-widevine':''));
const installer={output:installerDirectory,...JSON.parse(await fs.readFile(path.join(installerDirectory,'ACIRA-INSTALLER-PROVENANCE.json'),'utf8'))};
const result={version:pkg.version,commit,portable:product,installerDirectory:installer.output,installer:installer.installer,published:false,updateConfig:installer.updateConfig,nativeWindowsChecksPassed:true,installedIntoRealProfile:false,widevineQualified:false,
 ...(sealed?{widevine:{runtime:sealed.widevine.runtime.release,archiveSha256:sealed.widevine.runtime.archiveSha256,twin:portable.output,productionVmpSigned:true,signature:sealed.widevine.vmp.signature,authenticode:sealed.widevine.authenticode,sealedOpensAndCloses:true,playbackVerified:false}}:{})};
await fs.writeFile(path.join(installer.output,'WINDOWS-BUILD-RESULT.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
