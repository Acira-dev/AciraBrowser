import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createReadStream,createWriteStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url),pin=require('../packaging/macos/widevine-runtime.json'),run=promisify(execFile);
const repo=path.resolve(import.meta.dirname,'..');
async function hash(file){const h=createHash('sha256');for await(const chunk of createReadStream(file))h.update(chunk);return h.digest('hex');}
export async function fetchMacWidevineRuntime({arch=process.arch,cache=path.join(repo,'release/runtime-cache/widevine')}={}){
 if(process.platform!=='darwin')throw Error('Widevine Mac runtime preparation requires macOS.');
 const spec=pin.platforms[arch];if(!spec)throw Error('Unsupported Mac Widevine architecture.');
 if(require('electron/package.json').version!==pin.electron)throw Error('Qualify and update the Mac Widevine pin when Electron changes.');
 await fs.mkdir(cache,{recursive:true});
 const archive=path.join(cache,`electron-${pin.release}-darwin-${arch}.zip`);
 try{await fs.access(archive);}catch(error){
  if(error.code!=='ENOENT')throw error;
  const name=`electron-v${pin.release}-darwin-${arch}.zip`,url=`https://github.com/${pin.repository}/releases/download/v${encodeURIComponent(pin.release)}/${encodeURIComponent(name)}`;
  const temporary=archive+'.download-'+process.pid;
  try{
   const response=await fetch(url,{signal:AbortSignal.timeout(240000)});if(!response.ok||!response.body)throw Error('Could not download the pinned ECS runtime: HTTP '+response.status);
   await pipeline(Readable.fromWeb(response.body),createWriteStream(temporary,{flags:'wx'}));
   if((await fs.stat(temporary)).size!==spec.bytes||await hash(temporary)!==spec.sha256)throw Error('The ECS runtime archive does not match its pinned release digest.');
   await fs.rename(temporary,archive);
  }finally{await fs.rm(temporary,{force:true});}
 }
 if((await fs.stat(archive)).size!==spec.bytes||await hash(archive)!==spec.sha256)throw Error('Cached ECS archive failed verification; preserve it for diagnosis and use a fresh cache.');
 // Always extract a verified archive into a new directory; never trust a
 // previously signed/mutated runtime or a mutable extraction receipt.
 const extracted=await fs.mkdtemp(path.join(cache,arch+'-'));
 await run('/usr/bin/ditto',['-x','-k',archive,extracted]);
 return {runtime:path.join(extracted,'Electron.app'),arch,electron:pin.electron,release:pin.release,archiveSha256:spec.sha256};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(await fetchMacWidevineRuntime({arch:process.argv[2]||process.arch}),null,2));
