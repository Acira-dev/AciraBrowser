'use strict';
// Official archive identity is checked before extraction. macOS then requires native
// signatures; retain both original and signed hashes without changing Tor's code.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{execFile}=require('node:child_process'),{promisify}=require('node:util');
const run=promisify(execFile),manifest=require('./tor-engine/tor-mac-version.json');
const NATIVE_FILES=['libevent-2.1.7.dylib','pluggable_transports/lyrebird','pluggable_transports/conjure-client','tor'],hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const spec=(arch=process.arch)=>manifest.platforms[arch]||null;
async function signNative(file){await run('/usr/bin/codesign',['--force','--sign','-','--timestamp=none','--identifier',path.basename(file)==='tor'?'org.torproject.tor':'org.torproject.libevent',file],{timeout:15000});await run('/usr/bin/codesign',['--verify','--strict',file],{timeout:10000});}
async function prepareMacTor({files,directory,arch=process.arch,version=manifest.torBrowserVersion,archiveSha256,sign=signNative,pinned=true}){
 const current=spec(arch);if(!current)throw Error('Unsupported Mac Tor architecture.');
 if(!/^[a-f0-9]{64}$/.test(archiveSha256||'')||!/^\d+(?:\.\d+){1,3}$/.test(version))throw Error('Invalid Mac Tor archive identity.');
 if(pinned&&archiveSha256!==current.archive.sha256)throw Error('The Mac Tor archive does not match the pinned release.');
 fs.mkdirSync(directory,{recursive:true});const sourceFiles={},signedFiles={};
 for(const name of NATIVE_FILES){const entry=current.files[name],bytes=files.get(entry.from);if(!bytes||bytes.length<10000||pinned&&hash(bytes)!==entry.sha256)throw Error('Invalid Mac Tor native file: '+name);sourceFiles[name]=hash(bytes);fs.mkdirSync(path.dirname(path.join(directory,name)),{recursive:true});fs.writeFileSync(path.join(directory,name),bytes,{mode:0o755});}
 for(const [name,entry]of Object.entries(current.files)){if(NATIVE_FILES.includes(name)||name==='tor.txt')continue;const bytes=files.get(entry.from);if(!bytes?.length||pinned&&hash(bytes)!==entry.sha256)throw Error('Invalid Mac Tor data file: '+name);fs.mkdirSync(path.dirname(path.join(directory,name)),{recursive:true});fs.writeFileSync(path.join(directory,name),bytes);}
 const license=files.get('docs/tor.txt');if(!license||!license.length)throw Error('The Mac Tor license is missing.');fs.writeFileSync(path.join(directory,'LICENSE.tor.txt'),license);
 for(const name of NATIVE_FILES){await sign(path.join(directory,name));signedFiles[name]=hash(fs.readFileSync(path.join(directory,name)));}
 const record={schema:1,platform:'darwin',arch,version,archiveSha256,sourceFiles,files:signedFiles,signing:'Verified official Tor Project archive; locally signed native code'};
 fs.writeFileSync(path.join(directory,'native-manifest.json'),JSON.stringify(record,null,2)+'\n');return record;
}
function readMacTor(file,{arch=process.arch,pinned=true}={}){
 try{const current=spec(arch);if(!current||path.basename(file)!=='tor')return null;const directory=path.dirname(file),meta=path.join(directory,'native-manifest.json'),st=fs.lstatSync(meta);if(!st.isFile()||st.isSymbolicLink()||st.size>32768)return null;const record=JSON.parse(fs.readFileSync(meta,'utf8'));
 if(record.schema!==1||record.platform!=='darwin'||record.arch!==arch||!/^\d+(?:\.\d+){1,3}$/.test(record.version)||!/^[a-f0-9]{64}$/.test(record.archiveSha256||''))return null;
 if(pinned&&(record.version!==manifest.torBrowserVersion||record.archiveSha256!==current.archive.sha256))return null;
 for(const name of NATIVE_FILES){if(!/^[a-f0-9]{64}$/.test(record.files?.[name]||''))return null;if(pinned&&record.sourceFiles?.[name]!==current.files[name].sha256)return null;const stat=fs.lstatSync(path.join(directory,name));if(!stat.isFile()||stat.isSymbolicLink()||hash(fs.readFileSync(path.join(directory,name)))!==record.files[name])return null;}
 return {file,sha256:record.files.tor,companions:{'libevent-2.1.7.dylib':record.files['libevent-2.1.7.dylib']},record};
 }catch{return null;}
}
module.exports={manifest,spec,prepareMacTor,readMacTor,signNative,NATIVE_FILES};
