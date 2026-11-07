// The Windows Widevine runtime: castlabs' Electron for Content Security (ECS) for win32-x64, the same release as the Mac one, pinned by
// SHA-256 and size (packaging/windows-widevine-runtime.json, taken from the GitHub release asset digest and castlabs' SHASUMS256.txt).
// Only `npm run build:windows:widevine` uses it (docs/launch/WINDOWS_WIDEVINE.md); the plain Windows build keeps stock Electron.
// The archive is about 160 MB. On a slow line it may be downloaded in a browser instead and put at the cache path printed below:
// it is checked against the pin either way, and a file that does not match is never used.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createReadStream,createWriteStream,mkdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url),PIN=require('../packaging/windows-widevine-runtime.json');
const repo=path.resolve(import.meta.dirname,'..'),MB=1024*1024;
export const archiveName=(arch,pin=PIN)=>`electron-v${pin.release}-win32-${arch}.zip`;
export const archiveUrl=(arch,pin=PIN)=>`https://github.com/${pin.repository}/releases/download/v${encodeURIComponent(pin.release)}/${encodeURIComponent(archiveName(arch,pin))}`;
export const cachedArchive=(cache,arch,pin=PIN)=>path.join(cache,`electron-${pin.release}-win32-${arch}.zip`);
async function hash(file){const h=createHash('sha256');for await(const chunk of createReadStream(file))h.update(chunk);return h.digest('hex');}
/** Streams `url` into `target` (created, never overwritten). Gives up after `stallMs` without a byte, not after a fixed total time: a slow line still finishes. */
async function download(url,target,{fetchImpl,stallMs,log}){
 const controller=new AbortController();let timer,got=0,told=0;
 const arm=()=>{clearTimeout(timer);timer=setTimeout(()=>controller.abort(Error(`no data for ${stallMs/1000} s`)),stallMs);};
 arm();
 try{
  const response=await fetchImpl(url,{signal:controller.signal});if(!response.ok||!response.body)throw Error('Could not download the pinned ECS runtime: HTTP '+response.status);
  const total=Number(response.headers?.get?.('content-length'))||0;
  const progress=new Transform({transform(chunk,_encoding,done){arm();got+=chunk.length;if(got-told>=16*MB){told=got;log(`  ${Math.round(got/MB)} MB${total?' of '+Math.round(total/MB)+' MB':''}`);}done(null,chunk);}});
  await pipeline(Readable.fromWeb(response.body),progress,createWriteStream(target,{flags:'wx'}));
 }finally{clearTimeout(timer);}
}
/** The ZIP's files into `target`. Every member must land inside `target` (the archive is pinned, so this is belt and braces). */
function extract(archive,target){
 const AdmZip=require('adm-zip'),root=path.resolve(target)+path.sep;
 for(const entry of new AdmZip(archive).getEntries()){
  const file=path.resolve(target,entry.entryName);
  if(!file.startsWith(root))throw Error('The ECS archive has a member outside its folder: '+entry.entryName);
  if(entry.isDirectory){mkdirSync(file,{recursive:true});continue;}
  mkdirSync(path.dirname(file),{recursive:true});writeFileSync(file,entry.getData(),{flag:'wx'});
 }
}
/** Downloads (or reuses a cached copy of) the pinned archive, checks its size and SHA-256, and extracts it into a new folder.
 *  Returns the extracted runtime folder (electron.exe and its files) with what the build records about it. */
export async function fetchWindowsWidevineRuntime({arch='x64',cache=path.join(repo,'release/runtime-cache/widevine'),platform=process.platform,pin=PIN,electron=require('electron/package.json').version,fetchImpl=fetch,stallMs=90000,log=console.log}={}){
 if(platform!=='win32')throw Error('The Windows Widevine runtime is prepared on Windows (npm run build:windows:widevine); the Mac one comes from scripts/fetch-mac-widevine.mjs.');
 const spec=pin.platforms[arch];if(!spec)throw Error('No Windows Widevine runtime is pinned for '+arch+'.');
 if(electron!==pin.electron)throw Error(`Electron is ${electron} but the Windows Widevine pin is for ${pin.electron}: qualify and update packaging/windows-widevine-runtime.json when Electron changes.`);
 await fs.mkdir(cache,{recursive:true});
 const archive=cachedArchive(cache,arch,pin);
 try{await fs.access(archive);log('Using the cached ECS runtime '+archive);}catch(error){
  if(error.code!=='ENOENT')throw error;
  const url=archiveUrl(arch,pin),temporary=archive+'.download-'+process.pid;
  log(`Downloading the ECS runtime (${Math.round(spec.bytes/MB)} MB) from ${url}\n  (or download it in a browser and save it as ${archive})`);
  try{
   await download(url,temporary,{fetchImpl,stallMs,log});
   if((await fs.stat(temporary)).size!==spec.bytes||await hash(temporary)!==spec.sha256)throw Error('The downloaded ECS runtime does not match its pinned release digest.');
   await fs.rename(temporary,archive);
  }finally{await fs.rm(temporary,{force:true});}
 }
 if((await fs.stat(archive)).size!==spec.bytes||await hash(archive)!==spec.sha256)throw Error(`The ECS runtime at ${archive} does not match its pinned size and SHA-256. Move it away and run the build again for a fresh download.`);
 // Always a new folder from the verified archive: never a runtime an earlier build extracted (and may have changed).
 const extracted=await fs.mkdtemp(path.join(cache,'win32-'+arch+'-'));
 try{
  extract(archive,extracted);
  const executable=path.join(extracted,'electron.exe'),version=(await fs.readFile(path.join(extracted,'version'),'utf8')).trim();
  if(version!==pin.release)throw Error(`The ECS archive says it is ${version}, not the pinned ${pin.release}.`);
  const developmentSignature=await fs.access(path.join(extracted,'electron.exe.sig')).then(()=>true,()=>false);
  return {runtime:extracted,arch,electron:pin.electron,release:pin.release,repository:pin.repository,archiveSha256:spec.sha256,executableSha256:await hash(executable),developmentSignature};
 }catch(error){await fs.rm(extracted,{recursive:true,force:true});throw error;}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(await fetchWindowsWidevineRuntime({arch:process.argv[2]||'x64'}),null,2));
