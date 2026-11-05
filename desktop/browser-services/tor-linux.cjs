'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const manifest=require('./tor-engine/tor-linux-version.json');
const NATIVE_FILES=['tor','libcrypto.so.3','libssl.so.3','libevent-2.1.so.7','pluggable_transports/lyrebird','pluggable_transports/conjure-client'];
const LIBRARIES=['libcrypto.so.3','libssl.so.3','libevent-2.1.so.7'];
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const spec=(arch=process.arch)=>manifest.platforms[arch]||null;
function elfForArch(bytes,arch){return arch==='x64'&&bytes.length>64&&bytes.subarray(0,4).equals(Buffer.from([0x7f,0x45,0x4c,0x46]))&&bytes[4]===2&&bytes[5]===1&&bytes.readUInt16LE(18)===62;}
function prepareLinuxTor({files,directory,arch=process.arch,version=manifest.torBrowserVersion,archiveSha256,pinned=true}){
 const current=spec(arch);if(!current)throw Error('Unsupported Linux Tor architecture.');
 if(!/^[a-f0-9]{64}$/.test(archiveSha256||'')||!/^\d+(?:\.\d+){1,3}$/.test(version))throw Error('Invalid Linux Tor archive identity.');
 if(pinned&&archiveSha256!==current.archive.sha256)throw Error('Linux Tor archive does not match the pinned signed release.');
 const digests={};fs.mkdirSync(directory,{recursive:true});
 for(const [name,entry]of Object.entries(current.files)){
  const bytes=files.get(entry.from);if(!bytes?.length||pinned&&hash(bytes)!==entry.sha256)throw Error('Invalid Linux Tor file: '+name);
  if(NATIVE_FILES.includes(name)&&!elfForArch(bytes,arch))throw Error('Wrong Linux Tor ELF architecture: '+name);
  const target=path.join(directory,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes,{mode:NATIVE_FILES.includes(name)?0o755:0o644});digests[name]=hash(bytes);
 }
 const record={schema:1,platform:'linux',arch,version,archiveSha256,files:digests};
 fs.writeFileSync(path.join(directory,'native-manifest.json'),JSON.stringify(record,null,2)+'\n');return record;
}
function readLinuxTor(file,{arch=process.arch,pinned=true}={}){
 try{
  const current=spec(arch);if(!current||path.basename(file)!=='tor')return null;
  const dir=path.dirname(file),meta=path.join(dir,'native-manifest.json'),st=fs.lstatSync(meta);if(!st.isFile()||st.isSymbolicLink()||st.size>32768)return null;
  const record=JSON.parse(fs.readFileSync(meta,'utf8'));
  if(record.schema!==1||record.platform!=='linux'||record.arch!==arch||!/^\d+(?:\.\d+){1,3}$/.test(record.version)||!/^[a-f0-9]{64}$/.test(record.archiveSha256||''))return null;
  if(pinned&&(record.version!==manifest.torBrowserVersion||record.archiveSha256!==current.archive.sha256))return null;
  for(const name of Object.keys(current.files)){
   const target=path.join(dir,name),stat=fs.lstatSync(target);if(!stat.isFile()||stat.isSymbolicLink())return null;
   const bytes=fs.readFileSync(target),digest=hash(bytes);
   if(digest!==record.files?.[name]||pinned&&digest!==current.files[name].sha256||NATIVE_FILES.includes(name)&&!elfForArch(bytes,arch))return null;
  }
  return {file,sha256:record.files.tor,companions:Object.fromEntries(LIBRARIES.map(name=>[name,record.files[name]])),record};
 }catch{return null;}
}
function nativeEnvironment(file,base=process.env){const env={...base,LD_LIBRARY_PATH:path.dirname(file)};delete env.LD_PRELOAD;return env;}
module.exports={manifest,spec,prepareLinuxTor,readLinuxTor,elfForArch,nativeEnvironment,NATIVE_FILES,LIBRARIES};
