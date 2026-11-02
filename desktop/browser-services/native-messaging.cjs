'use strict';
const {spawn}=require('node:child_process'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');

// Native messaging that behaves like Chrome (replaces the handlers electron-chrome-extensions registers):
//  - a missing, forbidden or dying host ends the call: sendNativeMessage gets its callback with chrome.runtime.lastError, a connectNative
//    port fires onDisconnect with lastError (the library left sendNativeMessage hanging forever and never reported an error);
//  - frames are counted in BYTES and read from a buffer, so non-ASCII text and replies split across or batched in chunks are correct;
//  - the host manifest is looked up under the Chrome, Chromium, Edge and Brave registry keys (HKCU, then HKLM) and in the profile folder;
//  - the host gets the extension origin and --parent-window, and .bat/.cmd hosts run through cmd.exe.
const NOT_FOUND='Specified native messaging host not found.',FORBIDDEN='Access to the specified native messaging host is forbidden.',EXITED='Native host has exited.',ERROR='Error when communicating with the native messaging host.',TOO_LARGE='Native host tried to send a message larger than 1048576 bytes.';
const MAX_FROM_HOST=1024*1024,HOST_NAME=/^[a-z0-9_]+(\.[a-z0-9_]+)*$/;
const VENDORS=['Google\\Chrome','Chromium','Microsoft\\Edge','BraveSoftware\\Brave-Browser'];

/** One frame: 4-byte little-endian byte length, then UTF-8 JSON. */
function encodeFrame(message){const body=Buffer.from(JSON.stringify(message),'utf8'),frame=Buffer.allocUnsafe(4+body.length);frame.writeUInt32LE(body.length,0);body.copy(frame,4);return frame;}

/** Buffers stdout chunks and yields whole messages; reports an error for a frame larger than the limit or invalid JSON. */
class FrameReader{
 constructor(onMessage,onError,limit=MAX_FROM_HOST){this.buffer=Buffer.alloc(0);this.onMessage=onMessage;this.onError=onError;this.limit=limit;this.failed=false;}
 push(chunk){
  if(this.failed)return;this.buffer=this.buffer.length?Buffer.concat([this.buffer,chunk]):chunk;
  while(this.buffer.length>=4){
   const length=this.buffer.readUInt32LE(0);
   if(length>this.limit){this.failed=true;this.onError(TOO_LARGE);return;}
   if(this.buffer.length<4+length)return;
   const body=this.buffer.subarray(4,4+length);this.buffer=this.buffer.subarray(4+length);
   let message;try{message=JSON.parse(body.toString('utf8'));}catch{this.failed=true;this.onError(ERROR);return;}
   this.onMessage(message);
  }
 }
}

function regQuery(key){
 return new Promise(resolve=>{
  if(process.platform!=='win32')return resolve(null);
  let output='';const child=spawn('reg',['query',key,'/ve'],{windowsHide:true});
  child.stdout.on('data',d=>{output+=d;});child.on('error',()=>resolve(null));
  child.on('close',code=>{if(code!==0)return resolve(null);const line=output.split(/\r?\n/).find(l=>/REG_SZ/i.test(l));if(!line)return resolve(null);resolve(line.split(/REG_SZ/i).pop().trim()||null);});
 });
}

/** Every place Chrome-compatible host manifests live for this name, in lookup order. */
async function manifestPaths(name,userData,{platform=process.platform,home=os.homedir(),libraryRoot='/Library'}={}){
 const paths=[];
 if(platform==='win32'){
  const keys=[];for(const hive of ['HKCU','HKLM'])for(const vendor of VENDORS)keys.push(`${hive}\\Software\\${vendor}\\NativeMessagingHosts\\${name}`);
  for(const value of await Promise.all(keys.map(regQuery)))if(value)paths.push(value);
 }else if(platform==='darwin'){
  for(const vendor of ['Google/Chrome','Google/ChromeForTesting','Chromium','Microsoft Edge','BraveSoftware/Brave-Browser'])paths.push(path.join(home,'Library','Application Support',vendor,'NativeMessagingHosts',name+'.json'));
  for(const vendor of ['Google/Chrome','Google/ChromeForTesting','Application Support/Chromium','Microsoft/Edge','Application Support/BraveSoftware/Brave-Browser'])paths.push(path.join(libraryRoot,vendor,'NativeMessagingHosts',name+'.json'));
 }
 if(userData)paths.push(path.join(userData,'NativeMessagingHosts',`${name}.json`));
 return paths;
}

/** The first valid manifest for this host, or null. Returns {config,file} or {error}. */
async function findHost(name,origin,userData,options={}){
 if(!HOST_NAME.test(String(name||'')))return {error:NOT_FOUND};
 let found=null;
 for(const file of await manifestPaths(name,userData,options)){
  let config;try{config=JSON.parse(fs.readFileSync(file,'utf8').replace(/^﻿/,''));}catch{continue;}
  if(!config||config.type!=='stdio'||config.name!==name||typeof config.path!=='string'||!Array.isArray(config.allowed_origins))continue;
  found={config,file};break;
 }
 if(!found)return {error:NOT_FOUND};
 if(!found.config.allowed_origins.includes(origin))return {error:FORBIDDEN};
 const platform=options.platform||process.platform;
 if(platform!=='win32'&&!path.isAbsolute(found.config.path))return {error:NOT_FOUND};
 const exe=path.isAbsolute(found.config.path)?found.config.path:path.resolve(path.dirname(found.file),found.config.path);
 try{if(!fs.statSync(exe).isFile())return {error:NOT_FOUND};if(platform!=='win32')fs.accessSync(exe,fs.constants.X_OK);}catch{return {error:NOT_FOUND};}
 return {exe};
}

function launch(exe,origin,windowHandle){
 const args=[origin];if(process.platform==='win32'&&windowHandle)args.push(`--parent-window=${windowHandle}`);
 if(process.platform==='win32'&&/\.(bat|cmd)$/i.test(exe)){
  const quoted=value=>`"${String(value).replace(/"/g,'""')}"`;
  return spawn(process.env.ComSpec||'cmd.exe',['/d','/s','/c',`"${[quoted(exe),...args.map(quoted)].join(' ')}"`],{shell:false,windowsHide:true,windowsVerbatimArguments:true,cwd:path.dirname(exe)});
 }
 return spawn(exe,args,{shell:false,windowsHide:true,cwd:path.dirname(exe)});
}

/** A running host process with framed read/write. onMessage(message), onEnd(reason) once. */
class HostProcess{
 constructor(exe,origin,windowHandle,onMessage,onEnd){
  this.ended=false;this.onEnd=onEnd;
  try{this.child=launch(exe,origin,windowHandle);}catch{this.finish(EXITED);return;}
  this.reader=new FrameReader(onMessage,reason=>this.finish(reason));
  this.child.stdout.on('data',chunk=>this.reader.push(chunk));
  this.child.stderr.on('data',()=>undefined);
  this.child.stdin.on('error',()=>undefined);
  this.child.on('error',()=>this.finish(NOT_FOUND));
  this.child.on('exit',()=>this.finish(EXITED));
 }
 send(message){if(this.ended)return false;try{this.child.stdin.write(encodeFrame(message));return true;}catch{this.finish(ERROR);return false;}}
 finish(reason){if(this.ended)return;this.ended=true;try{this.child?.kill();}catch{}this.onEnd(reason);}
 stop(){if(this.ended)return;this.ended=true;try{this.child?.kill();}catch{}}
}

/** Replaces runtime.connectNative / disconnectNative / sendNativeMessage on one electron-chrome-extensions runtime. */
function installNativeMessaging(runtime,{userData,getWindowHandle=()=>0,hostOptions={}}={}){
 const router=runtime?.ctx?.router;if(!(router?.handlers instanceof Map))return false;
 const ports=new Map();
 const replace=(name,callback)=>{const current=router.handlers.get(name);if(typeof current?.callback!=='function')return false;router.handlers.set(name,{...current,callback});return true;};
 const origin=extension=>`chrome-extension://${extension.id}/`;
 const ok=[
  replace('runtime.connectNative',async(event,connectionId,application)=>{
   const sender=event?.sender,channel=`crx-native-msg-${connectionId}`,fail=reason=>{try{if(sender&&!sender.isDestroyed?.())sender.send(`${channel}-disconnect`,reason);}catch{}};
   // The extension may post right away: listen first and hold messages until the host process exists.
   const state={queue:[],closed:false};ports.set(connectionId,state);
   const receive=(_event,message)=>{if(state.host)state.host.send(message);else state.queue.push(message);};
   try{sender.ipc.on(channel,receive);state.cleanup=()=>{try{sender.ipc.off(channel,receive);}catch{}};}catch{}
   const found=await findHost(application,origin(event.extension),userData,hostOptions);
   if(state.closed)return;
   if(found.error){if(state.cleanup)state.cleanup();ports.delete(connectionId);return fail(found.error);}
   state.host=new HostProcess(found.exe,origin(event.extension),getWindowHandle(),message=>{try{if(sender&&!sender.isDestroyed?.())sender.send(channel,message);}catch{}},reason=>{if(state.cleanup)state.cleanup();ports.delete(connectionId);fail(reason);});
   for(const message of state.queue.splice(0))state.host.send(message);
  }),
  replace('runtime.disconnectNative',(event,connectionId)=>{const state=ports.get(connectionId);if(!state)return;ports.delete(connectionId);state.closed=true;if(state.cleanup)state.cleanup();state.host?.stop();}),
  replace('runtime.sendNativeMessage',async(event,application,message)=>{
   const found=await findHost(application,origin(event.extension),userData,hostOptions);if(found.error)return {__acira_native_error:found.error};
   return new Promise(resolve=>{
    let done=false;const settle=value=>{if(done)return;done=true;resolve(value);};
    const host=new HostProcess(found.exe,origin(event.extension),getWindowHandle(),reply=>{settle(reply);host.stop();},reason=>settle({__acira_native_error:reason}));
    host.send(message);
   });
  })
 ];
 return ok.every(Boolean);
}

module.exports={installNativeMessaging,encodeFrame,FrameReader,findHost,NOT_FOUND,FORBIDDEN,EXITED,ERROR,TOO_LARGE,MAX_FROM_HOST};
