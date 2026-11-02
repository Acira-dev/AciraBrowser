'use strict';
// The Mac update ZIP: the FINAL app (Widevine VMP signed, Developer ID signed, notarized, stapled) as Squirrel.Mac wants it, with the same
// ditto flags scripts/package-mac.mjs always used. The staple is a file inside the bundle, so zipping after stapling carries it. The ZIP
// is then opened again and the app inside is verified (macos/update-verify.cjs), so the receipt never describes a ZIP nobody checked.
const path=require('node:path'),{execFile}=require('node:child_process'),{promisify}=require('node:util');
const {writeMacUpdateFeed}=require('./update-feed.cjs');
const {inspectMacZip}=require('./update-verify.cjs');
const execute=promisify(execFile);
const updateZipName=(version,arch)=>`AciraBrowser-${version}-mac-${arch}-update.zip`;
async function createMacUpdateZip({appBundle,output,version,arch,run=execute,verify=true}){
 const zip=path.join(output,updateZipName(version,arch));
 await run('/usr/bin/ditto',['--norsrc','--noextattr','-c','-k','--keepParent',appBundle,zip],{maxBuffer:1024*1024});
 const verified=verify?await inspectMacZip({zip,arch,version,run}):null;
 // This architecture's feed fragment (relative URL; scripts/publish-update.mjs merges both architectures and makes the URLs absolute).
 const feed=await writeMacUpdateFeed({output,version,zip,arch});
 return {zip,feed:feed.file,channel:feed.channel,arch,sha512:feed.sha512,size:feed.size,verified};
}
module.exports={createMacUpdateZip,updateZipName};
