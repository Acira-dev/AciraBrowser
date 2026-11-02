import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const require=createRequire(import.meta.url),semver=require('semver'),yaml=require('js-yaml');
const REPOSITORY='Acira-dev/AciraBrowserUpdates';
const FEED='https://raw.githubusercontent.com/'+REPOSITORY+'/main/feed/';
const hash=(file,algorithm='sha256',encoding='hex')=>createHash(algorithm).update(fs.readFileSync(file)).digest(encoding);
const read=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
const fail=message=>{throw Error(message);};
function checkVersion(version,channel,installedVersion){
 if(!semver.valid(version)||!semver.valid(installedVersion))fail('Use exact semantic versions.');
 if(!['beta','stable'].includes(channel))fail('Choose beta or stable explicitly.');
 if(channel==='stable'&&semver.prerelease(version))fail('A prerelease cannot be sent to Stable users.');
 if(!semver.gt(version,installedVersion))fail('The new version must exceed the installed baseline; a new SHA alone is not an update.');
}
export function stageWindowsUpdate(c){
 checkVersion(c.version,c.channel,c.installedVersion);
 if(!/^[a-f0-9]{40}$/.test(c.sourceCommit)||!/^[a-f0-9]{40}$/.test(c.upstreamSourceCommit))fail('Pin an exact source commit.');
 const record=read(c.provenance),proof=read(c.qualification),installerHash=hash(c.installer);
 if(record.version!==c.version||record.sourceCommit!==c.sourceCommit||record.installer.sha256!==installerHash||record.payload?.status!=='PASS')fail('Qualified installer provenance does not match.');
 for(const key of ['oldToNewPassed','profilePreserved','normalProfileUntouched'])if(proof[key]!==true)fail('Real isolated installed-update evidence required: '+key);
 if(proof.status!=='PASS'||proof.installerSha256!==installerHash||proof.version!==c.version||proof.previousVersion!==c.installedVersion||proof.sourceDigest!==record.sourceDigest)fail('Upgrade evidence belongs to a different build or version pair.');
 const config=yaml.load(fs.readFileSync(path.join(c.appResources,'app-update.yml'),'utf8'));
 if(config.provider!=='generic'||config.url.replace(/\/$/,'')!==FEED.replace(/\/$/,'')||config.updaterCacheDirName!=='acira-browser-updater')fail('Normal package must embed the public feed and normal updater cache.');
 const pkg=read(path.join(c.appResources,'app/package.json'));
 if(pkg.version!==c.version||pkg.aciraIdentity==='qa'||pkg.name!=='acira-browser')fail('Only the matching normal-identity package can be published.');
 if(fs.readFileSync(c.installer).subarray(0,2).toString()!=='MZ')fail('Expected a Windows EXE.');
 if(!fs.statSync(c.blockmap).size)fail('Installer blockmap missing.');
 const out=path.resolve(c.out);if(fs.existsSync(out))fail('Preserve existing release evidence; choose a fresh staging directory.');fs.mkdirSync(out,{recursive:true});
 const tag='v'+c.version+'-windows-'+c.sourceCommit.slice(0,8),name='AciraBrowserSetup-'+c.version+'.exe';
 if(c.sourceCommit!==c.upstreamSourceCommit&&!fs.statSync(c.sourcePatch).size)fail('Modified Windows source requires its exact public-base patch.');
 const files=[{name,source:c.installer},{name:name+'.blockmap',source:c.blockmap},{name:'WINDOWS-SOURCE.patch',source:c.sourcePatch}];
 for(const f of files){fs.copyFileSync(f.source,path.join(out,f.name));if(f.name==='WINDOWS-SOURCE.patch'&&!fs.statSync(path.join(out,f.name)).size)fs.writeFileSync(path.join(out,f.name),'# Exact public source: '+c.upstreamSourceCommit+'\n# No local Windows source changes.\n');delete f.source;f.sha256=hash(path.join(out,f.name));f.bytes=fs.statSync(path.join(out,f.name)).size;}
 const url='https://github.com/'+REPOSITORY+'/releases/download/'+tag+'/'+name,sha512=hash(c.installer,'sha512','base64');
 const manifest={version:c.version,files:[{url,sha512,size:files[0].bytes}],path:url,sha512,releaseDate:new Date().toISOString(),releaseNotes:c.notes||''};
 const manifestName=c.channel==='beta'?'beta.yml':'latest.yml';fs.writeFileSync(path.join(out,manifestName),yaml.dump(manifest,{lineWidth:-1}));
 const plan={schema:1,repository:REPOSITORY,sourceCommit:c.sourceCommit,upstreamSourceCommit:c.upstreamSourceCommit,sourceDigest:record.sourceDigest,version:c.version,installedVersion:c.installedVersion,channel:c.channel,tag,manifestName,manifestSha256:hash(path.join(out,manifestName)),qualificationSha256:hash(c.qualification),installerSignature:record.installer.signature,assets:files,published:false};
 fs.copyFileSync(c.qualification,path.join(out,'INSTALLED-UPDATE-QUALIFICATION.json'));fs.writeFileSync(path.join(out,'WINDOWS-UPDATE-PLAN.json'),JSON.stringify(plan,null,2)+'\n');return plan;
}
export function verifyWindowsUpdate(planFile){
 const p=read(planFile),root=path.dirname(path.resolve(planFile));checkVersion(p.version,p.channel,p.installedVersion);
 if(p.repository!==REPOSITORY||p.manifestName!==(p.channel==='beta'?'beta.yml':'latest.yml')||p.tag!=='v'+p.version+'-windows-'+p.sourceCommit.slice(0,8))fail('Invalid Windows-only publication target.');
 if(hash(path.join(root,p.manifestName))!==p.manifestSha256||hash(path.join(root,'INSTALLED-UPDATE-QUALIFICATION.json'))!==p.qualificationSha256)fail('Staged metadata or qualification changed.');
 for(const a of p.assets){if(path.basename(a.name)!==a.name||!(a.name==='WINDOWS-SOURCE.patch'||/^AciraBrowserSetup-[0-9A-Za-z.+-]+\.exe(?:\.blockmap)?$/.test(a.name)))fail('Unsafe asset name.');const file=path.join(root,a.name);if(fs.statSync(file).size!==a.bytes||hash(file)!==a.sha256)fail('Staged asset integrity mismatch.');}
 const proof=read(path.join(root,'INSTALLED-UPDATE-QUALIFICATION.json'));
 if(proof.status!=='PASS'||proof.version!==p.version||proof.previousVersion!==p.installedVersion||proof.sourceDigest!==p.sourceDigest||['oldToNewPassed','profilePreserved','normalProfileUntouched'].some(k=>proof[k]!==true))fail('Installed update evidence is not valid for this plan.');
 const m=yaml.load(fs.readFileSync(path.join(root,p.manifestName),'utf8')),exe=p.assets.find(a=>a.name.endsWith('.exe'));
 if(proof.installerSha256!==exe.sha256)fail('Upgrade proof installer hash differs.');
 if(m.version!==p.version||m.files.length!==1||m.files[0].url!=='https://github.com/'+REPOSITORY+'/releases/download/'+p.tag+'/'+exe.name||m.files[0].sha512!==hash(path.join(root,exe.name),'sha512','base64')||m.sha512!==m.files[0].sha512||m.path!==m.files[0].url||m.files[0].size!==exe.bytes)fail('Manifest does not describe the exact public installer.');return p;
}
function githubClient(){
 const cred=spawnSync('git',['credential','fill'],{input:'protocol=https\nhost=github.com\nusername=Acira-dev\n\n',encoding:'utf8',windowsHide:true,timeout:30000,env:{...process.env,GCM_INTERACTIVE:'Never',GIT_TERMINAL_PROMPT:'0'}}),token=cred.stdout?.split(/\r?\n/).find(l=>l.startsWith('password='))?.slice(9);if(!token)fail('Saved release authentication missing.');
 const api=(route,{method='GET',json,file}={})=>new Promise((resolve,reject)=>{const url=route.startsWith('https://')?route:'https://api.github.com/repos/'+REPOSITORY+'/'+route,body=json?JSON.stringify(json):null;const req=https.request(url,{method,headers:{Authorization:'Bearer '+token,'User-Agent':'Acira-Windows-update-release',Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',...(file?{'Content-Type':'application/octet-stream','Content-Length':fs.statSync(file).size}:body?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}:{})}},res=>{let b='';res.on('data',c=>b+=c);res.on('end',()=>{if(res.statusCode<200||res.statusCode>=300)return reject(Error('GitHub '+res.statusCode+': '+b.slice(0,250)));resolve(b?JSON.parse(b):null);});});req.on('error',reject);req.setTimeout(900000,()=>req.destroy(Error('Upload inactivity timeout')));if(file)fs.createReadStream(file).on('error',e=>req.destroy(e)).pipe(req);else req.end(body);});
 return api;
}
export async function publishWindowsUpdate(planFile,options={}){
 const p=verifyWindowsUpdate(planFile),root=path.dirname(path.resolve(planFile));
 if(read(path.join(root,'INSTALLED-UPDATE-QUALIFICATION.json')).fixtureOnly&&!options.api)fail('Synthetic test evidence cannot activate a real update feed.');
 if(!options.api){const source=await fetch('https://api.github.com/repos/Acira-dev/AciraBrowserNoAI/commits/'+p.upstreamSourceCommit,{headers:{'User-Agent':'Acira-Windows-update-source-check'}});if(!source.ok)fail('Public corresponding-source base is unavailable.');}
 const api=options.api||githubClient();
 const feedPath='contents/feed/'+p.manifestName+'?ref=main',before=await api(feedPath),old=yaml.load(Buffer.from(before.content,'base64').toString());
 if(!semver.valid(old.version)||!semver.gt(p.version,old.version))fail('Live channel already has this version or a newer release.');
 fs.writeFileSync(path.join(root,'FEED-BEFORE.json'),JSON.stringify({path:'feed/'+p.manifestName,sha:before.sha,content:before.content,version:old.version},null,2));
 const releases=await api('releases?per_page=100');let release=releases.find(r=>r.tag_name===p.tag);
 if(!release){const target=await api('commits/main');release=await api('releases',{method:'POST',json:{tag_name:p.tag,target_commitish:target.sha,name:'Acira Browser '+p.version+' — Windows',body:'Windows x64. Existing Creation installer. '+(p.installerSignature==='NotSigned'?'Unsigned Windows build.':'See installer signing evidence.')+' Compiled source '+p.sourceCommit+'. Corresponding source: https://github.com/Acira-dev/AciraBrowserNoAI/tree/'+p.upstreamSourceCommit+' plus WINDOWS-SOURCE.patch in this release.',draft:true,prerelease:p.channel==='beta',make_latest:'false'}});}
 const uploads=[...p.assets,{name:p.manifestName,sha256:p.manifestSha256,bytes:fs.statSync(path.join(root,p.manifestName)).size}];
 for(const a of uploads){let asset=(await api('releases/'+release.id+'/assets')).find(x=>x.name===a.name);if(!asset)asset=await api('https://uploads.github.com/repos/'+REPOSITORY+'/releases/'+release.id+'/assets?name='+encodeURIComponent(a.name),{method:'POST',file:path.join(root,a.name)});if(asset.state!=='uploaded'||asset.size!==a.bytes||asset.digest!=='sha256:'+a.sha256)fail('Remote asset hash/size mismatch: '+a.name);}
 release=await api('releases/'+release.id,{method:'PATCH',json:{draft:false,prerelease:p.channel==='beta',make_latest:'false'}});
 for(const a of uploads){const remote=release.assets.find(x=>x.name===a.name),r=await (options.head||((url)=>fetch(url,{method:'HEAD'})))(remote.browser_download_url);if(r.status!==200||Number(r.headers.get('content-length'))!==a.bytes)fail('Public asset unavailable; channel has not been activated.');}
 const current=await api(feedPath);if(current.sha!==before.sha)fail('Channel changed concurrently; review before retrying.');
 const activation=await api('contents/feed/'+p.manifestName,{method:'PUT',json:{message:'Windows '+p.channel+' update '+p.version,branch:'main',sha:before.sha,content:fs.readFileSync(path.join(root,p.manifestName)).toString('base64')}});
 const after=await api(feedPath);if(Buffer.from(after.content,'base64').toString()!==fs.readFileSync(path.join(root,p.manifestName),'utf8'))fail('Committed channel bytes mismatch.');
 const result={status:'PUBLISHED',version:p.version,channel:p.channel,release:release.html_url,feed:FEED+p.manifestName,feedCommit:activation.commit.sha,macChannelsChanged:false,otherWindowsChannelChanged:false,publishedAt:new Date().toISOString()};fs.writeFileSync(path.join(root,'PUBLICATION.json'),JSON.stringify(result,null,2)+'\n');return result;
}
export async function checkPublishedWindowsUpdate(planFile){
 const p=verifyWindowsUpdate(planFile),r=await fetch(FEED+p.manifestName,{headers:{'Cache-Control':'no-cache'}});
 if(!r.ok)fail('Anonymous feed HTTP '+r.status);const bytes=Buffer.from(await r.arrayBuffer()),actual=createHash('sha256').update(bytes).digest('hex');
 return {status:actual===p.manifestSha256?'LIVE':'WAITING_FOR_CDN_OR_DIFFERENT_RELEASE',expectedVersion:p.version,servedVersion:yaml.load(bytes.toString()).version,feed:FEED+p.manifestName,anonymous:true};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const [mode,file,...flags]=process.argv.slice(2);if(!file)fail('Usage: stage config.json | verify WINDOWS-UPDATE-PLAN.json | publish WINDOWS-UPDATE-PLAN.json --activate-windows-channel');
 if(mode==='stage')console.log(JSON.stringify(stageWindowsUpdate(read(file)),null,2));else if(mode==='verify')console.log(JSON.stringify({status:'VERIFIED',...verifyWindowsUpdate(file)},null,2));else if(mode==='status')console.log(JSON.stringify(await checkPublishedWindowsUpdate(file),null,2));else if(mode==='publish'&&flags.length===1&&flags[0]==='--activate-windows-channel')console.log(JSON.stringify(await publishWindowsUpdate(file),null,2));else fail('Publication requires the explicit --activate-windows-channel flag.');
}
