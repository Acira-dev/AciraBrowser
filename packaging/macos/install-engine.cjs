'use strict';
// The renderer selects actions, never paths. Installation touches only an owned staging
// directory and the selected application bundle; browser profiles are not part of it.
// Electron exposes .asar files as virtual directories through its patched fs.
// Payload verification must hash/copy the physical archive exactly as packaged.
const fs=(process.versions.electron?require('original-fs'):require('node:fs')).promises,path=require('node:path'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const AdmZip=require('adm-zip');
const APP='Acira Browser.app';
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const inside=(root,file)=>file.startsWith(path.resolve(root)+path.sep);
function cancelled(signal){if(signal?.aborted){const e=new Error('Installation cancelled.');e.name='AbortError';throw e;}}
function relative(value){return typeof value==='string'&&value.length>0&&!value.includes('\\')&&!value.includes('\0')&&!path.posix.isAbsolute(value)&&value.split('/').every(p=>p&&p!=='.'&&p!=='..');}
function validateManifest(value){
 if(value?.schema!==1||value.appName!==APP||!Array.isArray(value.entries)||!value.entries.length||value.entries.length>25000||!/^[a-f0-9]{64}$/.test(value.archiveSha256||''))throw Error('The installer payload is invalid.');
 const names=new Set();let bytes=0;
 for(const e of value.entries){if(!relative(e.path)||names.has(e.path)||!['file','directory','symlink'].includes(e.type))throw Error('The payload contains an invalid path.');names.add(e.path);
  if(e.type==='file'){if(!Number.isSafeInteger(e.size)||e.size<0||!/^[a-f0-9]{64}$/.test(e.sha256||''))throw Error('The payload contains an invalid file.');bytes+=e.size;}
  if(e.type==='symlink'){const target=path.posix.normalize(path.posix.join(path.posix.dirname(e.path),e.target||''));if(!e.target||path.posix.isAbsolute(e.target)||e.target.includes('\\')||target==='..'||target.startsWith('../'))throw Error('The payload contains an unsafe link.');}}
 if(bytes<=0||bytes>4*1024**3)throw Error('The payload size is invalid.');return {...value,totalBytes:bytes};
}
function validateArchive(bytes){
 const entries=new AdmZip(bytes).getEntries();if(entries.length>25000||entries.reduce((n,e)=>n+e.header.size,0)>4*1024**3)throw Error('The archive is too large.');
 for(const e of entries){
  const name=e.entryName.replace(/\/$/,'');if(name===APP)continue;
  if(!name.startsWith(APP+'/')||!relative(name))throw Error('The archive contains an unsafe path.');
  const mode=(e.header.fileAttr>>>16)&0xf000;
  if(mode===0xa000){const target=e.getData().toString('utf8'),resolved=path.posix.normalize(path.posix.join(path.posix.dirname(name),target));if(path.posix.isAbsolute(target)||target.includes('\\')||!resolved.startsWith(APP+'/'))throw Error('The archive contains an unsafe link.');}
  else if(mode&&![0x8000,0x4000].includes(mode))throw Error('The archive contains an unsupported file.');
 }
}
async function hashFile(file,onBytes,signal){const handle=await fs.open(file,'r');const hash=crypto.createHash('sha256'),buffer=Buffer.allocUnsafe(1024*1024);try{while(true){cancelled(signal);const {bytesRead}=await handle.read(buffer,0,buffer.length,null);if(!bytesRead)break;hash.update(buffer.subarray(0,bytesRead));onBytes?.(bytesRead);}}finally{await handle.close();}return hash.digest('hex');}
async function walk(root,base=root){let entries=[];for(const name of (await fs.readdir(base)).sort()){const file=path.join(base,name),stat=await fs.lstat(file),key=path.relative(root,file).split(path.sep).join('/');if(stat.isSymbolicLink())entries.push({path:key,type:'symlink',target:await fs.readlink(file)});else if(stat.isDirectory()){entries.push({path:key,type:'directory'});entries.push(...await walk(root,file));}else if(stat.isFile())entries.push({path:key,type:'file',size:stat.size,sha256:await hashFile(file)});else throw Error('Unsupported payload file.');}return entries;}
async function extract(archive,stage,signal){cancelled(signal);return new Promise((resolve,reject)=>{const child=spawn('/usr/bin/ditto',['-x','-k',archive,stage],{stdio:['ignore','ignore','pipe']});let error='';child.stderr.on('data',b=>{if(error.length<2048)error+=b;});const abort=()=>child.kill('SIGTERM');signal?.addEventListener('abort',abort,{once:true});child.once('error',reject);child.once('exit',code=>{signal?.removeEventListener('abort',abort);try{cancelled(signal);if(code!==0)throw Error('The application could not be copied. '+error);resolve();}catch(e){reject(e);}});});}
async function installApplication({archive,manifest,destination,onProgress=()=>{},signal,extractArchive=extract,verifySignature=async()=>{},ensureNotRunning=async()=>{}}){
 const spec=validateManifest(manifest);if(path.basename(destination)!==APP)throw Error('Invalid application destination.');
 await ensureNotRunning(destination);cancelled(signal);
 const parent=path.dirname(path.resolve(destination));await fs.mkdir(parent,{recursive:true});const stage=await fs.mkdtemp(path.join(parent,'.Acira-install-')),application=path.join(stage,APP);let backup=null,movedOld=false,committed=false,timer,scanning=false,last=0;
 const publish=(phase,progress,message)=>{last=Math.max(last,Math.min(phase==='done'?1:.999,progress));onProgress({phase,progress:last,message});};
 try{
  publish('checking',0,'Checking the installer…');const archiveStat=await fs.stat(archive);let read=0;
  if(await hashFile(archive,n=>{read+=n;publish('checking',.05*read/Math.max(1,archiveStat.size),'Checking the installer…');},signal)!==spec.archiveSha256)throw Error('The installer payload failed its integrity check.');
  validateArchive(await fs.readFile(archive));cancelled(signal);publish('installing',.05,'Copying Acira to Applications…');
  timer=setInterval(async()=>{if(scanning)return;scanning=true;try{let copied=0;for(const e of spec.entries)if(e.type==='file'){try{const s=await fs.lstat(path.join(application,e.path));if(s.isFile())copied+=Math.min(e.size,s.size);}catch{}}publish('installing',.05+.7*copied/spec.totalBytes,'Copying Acira to Applications…');}finally{scanning=false;}},150);timer.unref?.();
  await extractArchive(archive,stage,signal);clearInterval(timer);timer=null;while(scanning)await new Promise(r=>setTimeout(r,10));cancelled(signal);
  publish('verifying',.75,'Checking the installed application…');const actual=new Set();let verified=0;
  async function verifyDirectory(directory){for(const name of await fs.readdir(directory)){const file=path.join(directory,name),key=path.relative(application,file).split(path.sep).join('/');if(!inside(application,file))throw Error('Invalid installed path.');actual.add(key);const e=spec.entries.find(entry=>entry.path===key);if(!e)throw Error('The application contains an unexpected file.');const st=await fs.lstat(file);if(e.type==='directory'){if(!st.isDirectory()||st.isSymbolicLink())throw Error('The application directory is invalid.');await verifyDirectory(file);}else if(e.type==='symlink'){if(!st.isSymbolicLink()||await fs.readlink(file)!==e.target)throw Error('The application link is invalid.');}else{if(!st.isFile()||st.size!==e.size||await hashFile(file,n=>{verified+=n;publish('verifying',.75+.23*verified/spec.totalBytes,'Checking the installed application…');},signal)!==e.sha256)throw Error('The installed application failed its integrity check.');}cancelled(signal);}}
  await verifyDirectory(application);if(actual.size!==spec.entries.length)throw Error('Some application files are missing.');await verifySignature(application);cancelled(signal);
  await ensureNotRunning(destination);cancelled(signal);
  publish('committing',.99,'Finishing installation…');
  try{await fs.lstat(destination);backup=path.join(parent,'.Acira-previous-'+crypto.randomUUID()+'.app');await fs.rename(destination,backup);movedOld=true;}catch(e){if(e.code!=='ENOENT')throw e;}
  try{await fs.rename(application,destination);committed=true;}catch(e){if(movedOld)await fs.rename(backup,destination);throw e;}
  publish('done',1,'Acira is ready.');return {appPath:destination,backupPath:backup,files:actual.size,bytes:spec.totalBytes};
 }finally{clearInterval(timer);if(!committed&&movedOld){try{await fs.access(destination);}catch{await fs.rename(backup,destination);}}await fs.rm(stage,{recursive:true,force:true});}
}
module.exports={APP,validateManifest,validateArchive,hashFile,walk,installApplication,digest};
