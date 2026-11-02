import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),electronRoot=path.dirname(require.resolve('electron/package.json'));
const installedVersion=require('electron/package.json').version,versionArgument=process.argv.find(arg=>arg.startsWith('--version=')),version=versionArgument?.slice('--version='.length)||installedVersion,stageOnly=process.argv.includes('--stage-only');
if(!/^\d+\.\d+\.\d+$/.test(version))throw new Error('An exact stable Electron version is required.');
if(version!==installedVersion&&!stageOnly)throw new Error('A different runtime must be staged before installation.');
const platform=process.platform,arch=process.arch,filename=`electron-v${version}-${platform}-${arch}.zip`;
let expected;
if(version===installedVersion){const checksums=JSON.parse(await fsp.readFile(path.join(electronRoot,'checksums.json'),'utf8'));expected=checksums[filename];}
else{const response=await fetch(`https://github.com/electron/electron/releases/download/v${version}/SHASUMS256.txt`,{signal:AbortSignal.timeout(45000)});if(!response.ok)throw new Error('Official checksum download returned '+response.status);const checksums=await response.text();expected=checksums.split(/\r?\n/).map(line=>line.trim().split(/\s+\*?/)).find(fields=>fields[1]===filename)?.[0];}
if(!/^[a-f0-9]{64}$/.test(expected||''))throw new Error('No official checksum for this runtime.');
const output=path.resolve('.bootstrap',filename);await fsp.mkdir(path.dirname(output),{recursive:true});
console.log('Fetching verified Electron runtime',version,platform,arch);
// Resume the pinned archive after a connection stalls. Only verified bytes are
// extracted, and an HTTP server that ignores Range starts a fresh archive.
const digest=async file=>{const hash=createHash('sha256');for await(const chunk of fs.createReadStream(file))hash.update(chunk);return hash.digest('hex');};
let downloaded=fs.existsSync(output)&&await digest(output)===expected;
for(let attempt=1;attempt<=3&&!downloaded;attempt++){
 const controller=new AbortController();let idle=setTimeout(()=>controller.abort(),45000),file;
 const touch=()=>{clearTimeout(idle);idle=setTimeout(()=>controller.abort(),45000);};
 try{
  const offset=fs.existsSync(output)?fs.statSync(output).size:0;
  const response=await fetch(`https://github.com/electron/electron/releases/download/v${version}/${filename}`,{headers:offset?{Range:`bytes=${offset}-`}:{},signal:controller.signal});touch();
  if(!response.ok)throw new Error('Runtime download returned '+response.status);
  console.log('Archive response:',response.headers.get('content-range')||response.headers.get('content-length'));
  const resumed=response.status===206;
  if(resumed&&!response.headers.get('content-range')?.startsWith(`bytes ${offset}-`))throw new Error('Unexpected runtime range response');
  file=await fsp.open(output,resumed?'a':'w');let received=resumed?offset:0,last=0;
  for await(const chunk of response.body){touch();await file.write(chunk);received+=chunk.length;if(Date.now()-last>10000){last=Date.now();console.log(`Runtime archive: ${(received/1048576).toFixed(1)} MiB received`);}}
  downloaded=true;
 }catch(error){console.warn(`Download attempt ${attempt}: ${error.message}`);if(attempt===3)throw error;}
 finally{clearTimeout(idle);await file?.close();}
}
if(await digest(output)!==expected)throw new Error('Runtime checksum mismatch; archive retained for diagnosis.');
const destination=stageOnly?path.resolve('.bootstrap',`electron-v${version}-${platform}-${arch}`):path.join(electronRoot,'dist');
const {extract}=require('@electron-internal/extract-zip');await extract(output,{dir:destination});
const executable=platform==='win32'?'electron.exe':platform==='darwin'?'Electron.app/Contents/MacOS/Electron':'electron';
if(stageOnly){await fsp.writeFile(path.join(destination,'acira-runtime-verification.json'),JSON.stringify({version,platform,arch,archive:filename,sha256:expected,executable:path.join(destination,executable)},null,2));console.log('Staged verified runtime: '+destination);}
else{await fsp.writeFile(path.join(electronRoot,'path.txt'),executable);await fsp.unlink(output);console.log('Installed pinned runtime independently.');}
