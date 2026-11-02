'use strict';
const fs=require('node:fs'),path=require('node:path');
/** Read installed identity metadata without loading an extension/runtime/worker or reading its storage. */
function installedExtensionOrigins({session,profileId,registryPath,installedIds=[]}){
 try{
  if(typeof profileId!=='string'||!profileId||profileId.length>200||typeof registryPath!=='string'||!path.isAbsolute(registryPath)||registryPath.startsWith('\\\\')||typeof session.extensions?.getAllExtensions!=='function')throw new Error('Native installation inventory is unavailable.');
  const valid=id=>typeof id==='string'&&/^[a-p]{32}$/.test(id);if(!Array.isArray(installedIds)||installedIds.length>1000||installedIds.some(id=>!valid(id)))throw new Error('Invalid in-memory installation inventory.');const ids=new Set(installedIds),loaded=session.extensions.getAllExtensions();if(!Array.isArray(loaded)||loaded.length>1000||loaded.some(extension=>!valid(extension.id)))throw new Error('Invalid loaded extension inventory.');for(const extension of loaded)ids.add(extension.id);
  let bytes=null,fd;try{fd=fs.openSync(registryPath,'r');const stat=fs.fstatSync(fd);if(!stat.isFile()||stat.size>2*1024*1024)throw new Error('Installation registry exceeds its bound.');const buffer=Buffer.alloc(stat.size+1),read=fs.readSync(fd,buffer,0,buffer.length,0);if(read!==stat.size)throw new Error('Installation registry changed during inspection.');bytes=buffer.subarray(0,read);}catch(error){if(error.code!=='ENOENT')throw error;}finally{if(fd!==undefined)fs.closeSync(fd);}
  if(bytes){const parsed=JSON.parse(bytes);if(!parsed||![1,2].includes(parsed.version)||!Array.isArray(parsed.entries)||parsed.entries.length>100||parsed.entries.some(entry=>!entry||!valid(entry.id)||typeof entry.profileId!=='string'||!entry.profileId||entry.profileId.length>200))throw new Error('Invalid installed extension registry.');for(const entry of parsed.entries)if(entry.profileId===profileId)ids.add(entry.id);}
  return {complete:true,profileId,origins:[...ids].map(id=>'chrome-extension://'+id)};
 }catch{return {complete:false,profileId,origins:[],error:'The installed extension inventory is unavailable or invalid. Cleanup must preserve pending recovery.'};}
}
module.exports={installedExtensionOrigins};
