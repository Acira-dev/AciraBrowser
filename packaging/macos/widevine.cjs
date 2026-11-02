'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),{createHash}=require('node:crypto'),{execFile}=require('node:child_process'),{promisify}=require('node:util');
const run=promisify(execFile),asar=require('@electron/asar'),plist=require('plist');
const {flipFuses,getCurrentFuseWire,FuseVersion,FuseV1Options:F}=require('@electron/fuses');
// Exact fuse set supported by free EVS. Leave newer fuses at upstream defaults.
const FUSES=Object.freeze({[F.RunAsNode]:false,[F.EnableCookieEncryption]:true,[F.EnableNodeOptionsEnvironmentVariable]:false,[F.EnableNodeCliInspectArguments]:false,[F.EnableEmbeddedAsarIntegrityValidation]:true,[F.OnlyLoadAppFromAsar]:true,[F.LoadBrowserProcessSpecificV8Snapshot]:false,[F.GrantFileProtocolExtraPrivileges]:true});
function isMachO(bytes){return ['cffaedfe','feedfacf','cafebabe','bebafeca','cafebabf','bfbafeca','cefaedfe','feedface'].includes(bytes.subarray(0,4).toString('hex'));}
async function signingTargets(application){
 const allowed=new Set([application]);
 async function visit(directory){
  for(const entry of await fs.readdir(directory,{withFileTypes:true})){
   const file=path.join(directory,entry.name);if(entry.isSymbolicLink())continue;
   if(entry.isDirectory()){if(/\.(?:app|framework|xpc|bundle)$/.test(entry.name))allowed.add(file);await visit(file);}
   else if(entry.isFile()){
    const handle=await fs.open(file,'r'),magic=Buffer.alloc(4);
    try{await handle.read(magic,0,4,0);}finally{await handle.close();}
    if(isMachO(magic))allowed.add(file);
   }
  }
 }
 await visit(application);return allowed;
}
async function sealAsar(application){
 const resources=path.join(application,'Contents/Resources'),source=path.join(resources,'app'),archive=path.join(resources,'app.asar');
 await asar.createPackageWithOptions(source,archive,{unpack:'**/*.node'});
 const header=asar.getRawHeader(archive).headerString;
 const integrity={'Resources/app.asar':{algorithm:'SHA256',hash:createHash('sha256').update(header).digest('hex')}};
 const file=path.join(application,'Contents/Info.plist'),info=plist.parse(await fs.readFile(file,'utf8'));
 info.ElectronAsarIntegrity=integrity;await fs.writeFile(file,plist.build(info));
 await fs.rm(source,{recursive:true});return integrity;
}
async function configureWidevineFuses(application){
 await flipFuses(application,{version:FuseVersion.V1,...FUSES});
 const wire=await getCurrentFuseWire(application);
 for(const [key,value]of Object.entries(FUSES))if(wire[key]!== (value?49:48))throw Error('Mac Widevine fuse configuration did not persist: '+key);
}
async function signWidevine(application,{python=process.env.ACIRA_EVS_PYTHON||'python3',env=process.env,verifyOnly=false}={}){
 if(!verifyOnly&&!env.EVS_CONFIG_FILE)throw Error('Mac Widevine packaging requires EVS_CONFIG_FILE pointing to an existing private EVS login. No credentials are created or copied by packaging.');
 const action=verifyOnly?'verify-pkg':'sign-pkg';
 const result=await run(python,['-m','castlabs_evs.vmp','--no-ask',action,...(verifyOnly?[]:['--streaming']), '--name-hint',path.basename(application,'.app'),path.dirname(application)],{env,maxBuffer:1024*1024,timeout:12*60*1000});
 // Only non-secret signature diagnostics are emitted; authentication remains in
 // the official client and never becomes a release input or shipped resource.
 return {action,diagnostic:result.stdout.trim()};
}
module.exports={FUSES,isMachO,signingTargets,sealAsar,configureWidevineFuses,signWidevine};
