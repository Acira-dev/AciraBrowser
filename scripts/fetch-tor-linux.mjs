#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),require=createRequire(import.meta.url);
const native=require('../desktop/browser-services/tor-linux.cjs'),{verifyDetached}=require('../desktop/browser-services/tor-openpgp.cjs'),{untar}=require('../desktop/browser-services/tor-update.cjs');
const arch=process.arch,current=native.spec(arch),directory=path.join(root,'desktop/browser-services/tor-engine','linux-'+arch);
async function download(url){
 for(const candidate of [url,url.replace('https://dist.torproject.org/torbrowser/','https://archive.torproject.org/tor-package-archive/torbrowser/')]){
  const response=await fetch(candidate,{signal:AbortSignal.timeout(300000)});if(response.status===404)continue;if(!response.ok)throw Error('HTTP '+response.status);
  const bytes=Buffer.from(await response.arrayBuffer());if(bytes.length>90*1024*1024)throw Error('Tor archive exceeds the size bound.');return bytes;
 }throw Error('Pinned Linux Tor release is unavailable on official hosts.');
}
try{
 if(!current)throw Error('Unsupported Linux Tor architecture: '+arch);
 if(native.readLinuxTor(path.join(directory,'tor'))&&!process.argv.includes('--require-signature'))console.log('[tor-linux] Verified pinned Linux Tor files are current.');
 else{
  const archive=await download(current.archive.url),signature=await download(current.archive.url+'.asc');
  const digest=createHash('sha256').update(archive).digest('hex');
  if(digest!==current.archive.sha256||!verifyDetached(archive,signature))throw Error('Linux Tor archive hash or Tor Project signature did not match.');
  native.prepareLinuxTor({files:untar(gunzipSync(archive)),directory,arch,archiveSha256:digest});
  console.log('[tor-linux] Extracted signature-verified pinned Linux Tor bundle.');
 }
}catch(error){console.error('[tor-linux] '+error.message);if(!process.argv.includes('--soft'))process.exitCode=1;}
