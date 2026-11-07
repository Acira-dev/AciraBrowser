#!/usr/bin/env node
// The Windows laptop and the Linux machine hand their finished build to the Mac through a PRIVATE release of the private source repository. This records what the build is
// (HANDOFF.json: version, full commit, every file's hashes, the update address inside the build, the signature it carries) and, with --publish, uploads it.
// scripts/release-publish.mjs on the Mac downloads it, recomputes every hash and refuses anything that does not match. Nothing public is touched.
//   Windows:  npm run handoff:windows   (= node scripts/handoff.mjs windows --dir <installerDirectory that npm run build:windows printed>)
//   Linux:    npm run handoff:linux     (= node scripts/handoff.mjs linux   --dir release/linux-normal)
//   [--receipts <folder>]   the rehearsal-<platform>-hop<N>.json receipts of the private tests (scripts/rehearsal-receipt.mjs), uploaded with the build
//   [--commit <40 hex>]     the commit the build came from, when its own records do not say
//   [--publish]             upload to the private release handoff-v<version>-<platform>-<commit8> (Acira-dev account, the handoff repository in packaging/update-targets.json)
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url),run=promisify(execFile),U=require('../packaging/update-publish.cjs'),T=require('../packaging/update-targets.cjs');
const repo=path.resolve(import.meta.dirname,'..');
const KEEP={
 windows:name=>name==='AciraBrowserSetup.exe'||name==='AciraBrowserSetup.exe.blockmap'||name==='latest.yml'||/^(WINDOWS-BUILD-RESULT|ACIRA-INSTALLER-PROVENANCE)\.json$|^SHA256SUMS/.test(name),
 linux:name=>/^AciraBrowser-.+-linux-x86_64\.AppImage$/.test(name)||name==='AciraBrowser-Linux-SetupFiles.zip'||/^(LINUX-BUILD-RESULT|VALIDATION)\.json$|^SHA256SUMS/.test(name),
};
const readJSON=async file=>JSON.parse(await fs.readFile(file,'utf8'));

/** What the folder holds and what it says about itself. Pure over what it is handed, so tests can run it on a small fixture. */
export async function describeBuild({platform,dir,commit,machine=os.hostname(),now=new Date(),signing=null,appUpdateYml=null}){
 const names=(await fs.readdir(dir)).filter(KEEP[platform]).sort(),files=[];
 for(const name of names){const d=await U.describeFile(path.join(dir,name));files.push({name,size:d.size,sha256:d.sha256,sha512:d.sha512});}
 let version=null,record={},updateConfig=null;
 if(platform==='windows'){
  const latest=await readJSON(path.join(dir,'latest.yml')).catch(async()=>require('js-yaml').load(await fs.readFile(path.join(dir,'latest.yml'),'utf8')));
  version=latest?.version;
  for(const name of ['WINDOWS-BUILD-RESULT.json','ACIRA-INSTALLER-PROVENANCE.json'])record={...record,...await readJSON(path.join(dir,name)).catch(()=>({}))};
  const config=record.payload?.updateConfig||record.updateConfig;
  updateConfig=config&&typeof config==='object'?{file:config.file||'resources/app-update.yml',url:config.url,...(config.publisherName?{publisherName:config.publisherName}:{}),source:'the Windows build record'}:null;
 }else{
  const image=names.find(name=>/-linux-x86_64\.AppImage$/.test(name));
  version=/^AciraBrowser-(.+)-linux-x86_64\.AppImage$/.exec(image||'')?.[1]||null;
  record=await readJSON(path.join(dir,'LINUX-BUILD-RESULT.json')).catch(()=>({}));
  if(appUpdateYml){const url=/^url:\s*["']?([^"'\s]+)/m.exec(appUpdateYml)?.[1];updateConfig=url?{file:'resources/app-update.yml',url,source:'read from inside the AppImage'}:null;}
 }
 const full=commit||record.sourceCommit||record.commit||null;
 return {schema:1,platform,version,commit:full,arch:'x64',machine,createdAt:now.toISOString(),files,updateConfig,signing:signing||{authenticode:platform==='windows'?'unchecked':'none',subject:null,evs:false},qa:Boolean(record.qa)};
}
async function windowsSigning(dir){
 if(process.platform!=='win32')return {authenticode:'unchecked',subject:null,evs:false};
 const exe=path.join(dir,'AciraBrowserSetup.exe');
 try{
  const {stdout}=await run('powershell',['-NoProfile','-Command',`$s=Get-AuthenticodeSignature -LiteralPath '${exe.replace(/'/g,"''")}'; @{status=[string]$s.Status;subject=$(if($s.SignerCertificate){$s.SignerCertificate.Subject}else{$null})} | ConvertTo-Json -Compress`]);
  const result=JSON.parse(stdout);return {authenticode:result.status==='Valid'?'valid':result.status==='NotSigned'?'unsigned':'invalid',subject:result.subject,evs:await fs.access(path.join(dir,'AciraBrowser.exe.sig')).then(()=>true,()=>false)};
 }catch{return {authenticode:'unchecked',subject:null,evs:false};}
}
async function appImageUpdateYml(dir,image){
 // the AppImage can unpack one file of itself; the build folder's linux-unpacked is only a fallback and is said to be
 const work=await fs.mkdtemp(path.join(os.tmpdir(),'acira-appimage-'));
 try{
  await run(image,['--appimage-extract','resources/app-update.yml'],{cwd:work,timeout:120000});
  return await fs.readFile(path.join(work,'squashfs-root','resources','app-update.yml'),'utf8');
 }catch{return null;}finally{await fs.rm(work,{recursive:true,force:true});}
}
export async function handoff({platform,dir,commit,receipts,publish}){
 if(!KEEP[platform])throw Error('Use windows or linux.');
 const folder=path.resolve(dir);
 const full=commit||(await run('git',['rev-parse','HEAD'],{cwd:repo}).then(r=>r.stdout.trim(),()=>null));
 const names=await fs.readdir(folder);
 let signing=null,yml=null;
 if(platform==='windows')signing=await windowsSigning(folder);
 else{const image=names.find(name=>/-linux-x86_64\.AppImage$/.test(name));if(image)yml=await appImageUpdateYml(folder,path.join(folder,image));}
 const record=await describeBuild({platform,dir:folder,commit:full,signing,appUpdateYml:yml});
 if(!record.version)throw Error('Cannot tell which version this build is (no latest.yml / AppImage name in '+folder+').');
 if(!/^[0-9a-f]{40}$/.test(String(record.commit)))throw Error('Cannot tell which commit this build came from: pass --commit <40 hex>.');
 if(!record.updateConfig)throw Error('Cannot tell the update address inside the build'+(platform==='linux'?' (the AppImage would not unpack resources/app-update.yml here)':' (the build record has no updateConfig)')+'. A build whose update address is unknown is not handed over.');
 if(receipts)for(const name of await fs.readdir(path.resolve(receipts)))if(/^rehearsal-(windows|linux)-hop[12]\.json$/.test(name))await fs.copyFile(path.join(path.resolve(receipts),name),path.join(folder,name));
 await fs.writeFile(path.join(folder,'HANDOFF.json'),JSON.stringify(record,null,2)+'\n');
 const upload=(await fs.readdir(folder)).filter(name=>name==='HANDOFF.json'||KEEP[platform](name)||/^rehearsal-.+-hop[12]\.json$/.test(name));
 const tag=`handoff-v${record.version}-${platform}-${record.commit.slice(0,8)}`,slug=T.targets().handoffRepo;
 console.log(`${platform} ${record.version} from ${record.commit.slice(0,8)}: ${record.files.length} files recorded in HANDOFF.json; update address ${record.updateConfig.url}; ${platform==='windows'?'signature '+record.signing.authenticode:'unsigned'}.`);
 if(!publish){console.log('Not uploaded. Add --publish to upload '+upload.length+' files to the private release '+tag+' in '+slug+'.');return {record,tag,upload};}
 const gh=(args)=>run('gh',args,{maxBuffer:64*1024*1024});
 const who=JSON.parse((await gh(['api','user'])).stdout).login;
 if(who!=='Acira-dev')throw Error('gh is signed in as '+who+', not Acira-dev (gh auth switch).');
 const info=JSON.parse((await gh(['api','repos/'+slug])).stdout);
 if(info.private!==true)throw Error(slug+' is not private: a handoff holds unpublished builds.');
 await gh(['release','view',tag,'--repo',slug]).catch(()=>gh(['release','create',tag,'--repo',slug,'--title',`Handoff ${record.version} (${platform})`,'--notes','Private handoff of a finished build to the Mac (scripts/handoff.mjs). Not a public release.']));
 for(const name of upload){console.log('  uploading '+name);await gh(['release','upload',tag,path.join(folder,name),'--repo',slug,'--clobber']);}
 console.log('Uploaded to the private release '+tag+'. On the Mac: node scripts/release-publish.mjs prepare ...');
 return {record,tag,upload};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [platform,...rest]=process.argv.slice(2),value=name=>{const at=rest.indexOf('--'+name);return at>=0?rest[at+1]:undefined;};
 handoff({platform,dir:value('dir')||(platform==='linux'?'release/linux-normal':''),commit:value('commit'),receipts:value('receipts'),publish:rest.includes('--publish')}).catch(error=>{console.error(error.message);process.exitCode=1;});
}
