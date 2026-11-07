'use strict';
// ECS installs/updates Google's CDM itself. Credentials are build-time only;
// neither a signing account nor a bundled CDM is shipped to browser users.
// Start-up waits for it only when it is already installed (installedOnDisk; it answers in milliseconds then). A first run, or a profile whose CDM is
// missing, opens at once and the CDM installs in the background (about 6 s on a normal network; a black-holed one held the first window for 20 s).
// A protected page refused meanwhile is reloaded once the CDM is ready (protected-media.cjs, onWidevineChange).
// After a failed install Chromium's component updater tries again by itself, a minute after start and then every 5 hours; ECS has no way to hurry it,
// and components.whenReady() keeps answering with the first failure even after a later install succeeded. So the component's status is read again on
// the retry ladder (network-retry.cjs: 2, 10, 30 minutes) and when the computer wakes or the network comes back, and the CDM is noticed once it is there.
// ECS runs on Mac builds and on Windows Widevine builds (npm run build:windows:widevine). A stock runtime has no `components`, so a plain Windows
// build, and Linux, keep their startup unchanged and never expect a CDM.
const fs=require('node:fs'),path=require('node:path');
const {createRetry}=require('./network-retry.cjs');
const TITLE='Widevine Content Decryption Module',PLATFORMS=new Set(['darwin','win32']);
// expected: a CDM can still arrive (an ECS runtime on Mac or Windows); false where none ever will (a stock runtime, Linux).
let state={status:'unavailable',version:null,expected:false},follow=null,generation=0;
const listeners=new Set();
function componentState(components){
 let values=[];try{values=Object.values(components.status()||{});}catch{}
 const cdm=values.find(item=>item?.title===TITLE);
 return cdm?.version?{status:'ready',version:cdm.version}:{status:'unavailable',version:null};
}
function set(next){
 const changed=next.status!==state.status||next.version!==state.version;state={...next};
 if(changed)for(const listener of listeners)try{listener({...state});}catch{/* one listener cannot stop the others */}
}
/** True when a CDM was installed into this profile before (Chromium keeps it in <userData>/WidevineCdm/<version>/). */
function installedOnDisk(userData){try{return fs.readdirSync(path.join(userData,'WidevineCdm')).some(name=>/^\d+(\.\d+)+$/.test(name));}catch{return false;}}
/** Starts (or joins) the install. Resolves when the CDM is ready, the install failed, or `timeoutMs` passed; whoever needs it can wait for that or not. */
async function prepareWidevine({components,platform=process.platform,timeoutMs=20000,log=()=>{},watch=null,schedule,cancel}={}){
 // Only an ECS runtime has components; a stock runtime (the plain Windows build) returns at once, as before.
 if(!supported(platform,components))return {status:'unavailable',version:null};
 const round=++generation;follow?.dispose();follow=null;
 set({status:'installing',version:null,expected:true});
 const current=()=>round===generation;
 // Not there yet: say so (a refused page is told why) and keep looking on the retry ladder.
 const missing=()=>{
  if(!current()||state.status==='ready'||follow)return;
  set({status:'unavailable',version:null,expected:true});
  follow=createRetry({watch,schedule,cancel,run:()=>{if(!current())return;const now=componentState(components);if(now.status==='ready'){follow.succeeded();set({...now,expected:true});}else follow.failed();}});
  follow.failed();
 };
 let timer;
 const installation=Promise.resolve().then(()=>components.whenReady()).then(()=>{
  if(current()){const now=componentState(components);if(now.status==='ready'){follow?.succeeded();set({...now,expected:true});}else missing();}return widevineStatus();
 },error=>{if(current()){log('Protected playback component unavailable:',error?.message||'Download failed');missing();}return widevineStatus();});
 try{return await Promise.race([installation,new Promise(resolve=>{timer=setTimeout(()=>{missing();resolve(widevineStatus());},timeoutMs);timer.unref?.();})]);}
 finally{clearTimeout(timer);}
}
/** Whether this runtime can install Widevine: ECS (it has `components`) on Mac or Windows. */
function supported(platform,components){return PLATFORMS.has(platform)&&typeof components?.whenReady==='function';}
function widevineStatus(){return {status:state.status,version:state.version};}
/** The status with `expected` (whether a CDM can still arrive), for protected-media.cjs. */
function widevineState(){return {...state};}
/** Calls `listener` with the new state whenever the status or version changes. Returns a function that stops it. */
function onWidevineChange(listener){listeners.add(listener);return ()=>listeners.delete(listener);}
module.exports={prepareWidevine,widevineStatus,widevineState,onWidevineChange,installedOnDisk,supported};
