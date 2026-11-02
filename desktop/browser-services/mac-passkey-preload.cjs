'use strict';
// Only an authorized, signed Mac build enables this bridge. Without that gate,
// nothing in the page is changed. No credential/Keychain data is read here.
const {ipcRenderer,contextBridge}=require('electron');
function installPasskeys(start,cancel){
 const container=window.CredentialsContainer,key=window.PublicKeyCredential;
 if(!container||!key)return;
 const originalGet=container.prototype.get,originalCreate=container.prototype.create;
 const decode=value=>Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0)).buffer;
 const encode=value=>{
  // BufferSource may come from another same-origin JavaScript realm. Use the
  // native ArrayBuffer brand check rather than realm-specific instanceof.
  let array;
  if(ArrayBuffer.isView(value))array=new Uint8Array(value.buffer,value.byteOffset,value.byteLength);
  else{try{Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'byteLength').get.call(value);array=new Uint8Array(value);}catch{throw new TypeError('Invalid passkey data.');}}
  if(!array||array.byteLength>65536)throw new TypeError('Invalid passkey data.');
  let text='';for(const byte of array)text+=String.fromCharCode(byte);
  return btoa(text).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
 };
 function credential(value,operation,extensions){
  const assertion=operation==='get',response=Object.create((assertion?AuthenticatorAssertionResponse:AuthenticatorAttestationResponse).prototype);
  const fields=assertion?['clientDataJSON','authenticatorData','signature','userHandle']:['clientDataJSON','attestationObject'];
  for(const name of fields)Object.defineProperty(response,name,{enumerable:true,get:()=>value[name]==null?null:decode(value[name])});
  if(!assertion)Object.defineProperties(response,{
   getAuthenticatorData:{value:()=>decode(value.authenticatorData)},getPublicKey:{value:()=>decode(value.publicKey)},
   getPublicKeyAlgorithm:{value:()=>value.publicKeyAlgorithm},getTransports:{value:()=>[value.attachment==='cross-platform'?'hybrid':'internal']}
  });
  const result=Object.create(key.prototype);
  Object.defineProperties(result,{
   id:{enumerable:true,value:value.id},rawId:{enumerable:true,get:()=>decode(value.id)},type:{enumerable:true,value:'public-key'},
   response:{enumerable:true,value:response},authenticatorAttachment:{enumerable:true,value:value.attachment||'platform'},
   getClientExtensionResults:{value:()=>structuredClone(extensions)},
   toJSON:{value:()=>({id:value.id,rawId:value.id,type:'public-key',authenticatorAttachment:value.attachment||'platform',clientExtensionResults:structuredClone(extensions),response:{...Object.fromEntries(fields.map(name=>[name,value[name]??null])),...(!assertion?{transports:[value.attachment==='cross-platform'?'hybrid':'internal'],authenticatorData:value.authenticatorData,publicKey:value.publicKey,publicKeyAlgorithm:value.publicKeyAlgorithm}:{})}})}
  });
  return result;
 }
 const untilAborted=signal=>new Promise((_,reject)=>{if(signal?.aborted)reject(signal.reason);else signal?.addEventListener('abort',()=>reject(signal.reason),{once:true});});
 function run(operation,options){
  const pk=options.publicKey;
  if(options.signal?.aborted)return Promise.reject(options.signal.reason);
  if(options.mediation==='conditional')return operation==='get'?untilAborted(options.signal):Promise.reject(new DOMException('Automatic passkey creation is unavailable.','NotSupportedError'));
  let request,extensions={};
  try{
   request={id:crypto.randomUUID(),operation,challenge:encode(pk.challenge),rpId:operation==='create'?pk.rp?.id:pk.rpId,timeout:pk.timeout,userVerification:operation==='create'?pk.authenticatorSelection?.userVerification:pk.userVerification,credentials:(operation==='create'?pk.excludeCredentials:pk.allowCredentials)?.map(item=>{if(item.type!=='public-key')throw new TypeError('Invalid credential type.');return encode(item.id);})};
   // AppID is a legacy U2F alternative; this platform credential uses the real
   // RP ID, so it truthfully reports that AppID was not used. Apple platform
   // passkeys are discoverable credentials (credProps.rk).
   if(operation==='get'&&pk.extensions?.appid!==undefined){if(typeof pk.extensions.appid!=='string')throw new TypeError('Invalid AppID extension.');extensions.appid=false;}
   if(operation==='create'&&pk.extensions?.credProps===true)extensions.credProps={rk:true};
   if(operation==='create'){
    if(!pk.pubKeyCredParams?.some(item=>item.type==='public-key'&&item.alg===-7))throw new DOMException('This passkey provider requires ES256.','NotSupportedError');
    request.user={id:encode(pk.user?.id),name:pk.user?.name,displayName:pk.user?.displayName};request.attestation=pk.attestation;
   }
  }catch(error){return Promise.reject(error);}
  return new Promise((resolve,reject)=>{
   let finished=false;
   const finish=(fn,value)=>{if(finished)return;finished=true;options.signal?.removeEventListener('abort',abort);fn(value);};
   const abort=()=>{void cancel(request.id);finish(reject,options.signal.reason);};
   options.signal?.addEventListener('abort',abort,{once:true});
   Promise.resolve().then(()=>{if(finished)throw new DOMException('The request was aborted.','AbortError');return start(request);}).then(result=>{
    if(result?.ok){try{finish(resolve,credential(result.credential,operation,extensions));}catch{finish(reject,new DOMException('Invalid passkey response.','NotAllowedError'));}}
    else finish(reject,result?.name==='TypeError'?new TypeError(result.message):new DOMException(result?.message||'The passkey request could not be completed.',result?.name||'NotAllowedError'));
   },()=>finish(reject,new DOMException('The passkey request could not be completed.','NotAllowedError')));
  });
 }
 for(const [operation,original]of [['get',originalGet],['create',originalCreate]])Object.defineProperty(container.prototype,operation,{configurable:true,writable:true,value:new Proxy(original,{apply(target,self,args){
  const options=args[0],pk=options?.publicKey;
  // Leave passwords, unsupported extensions and explicit hardware-key creation
  // to Chromium. Never silently weaken a requested WebAuthn extension.
  const hardwareOnly=operation==='get'&&pk?.allowCredentials?.length&&pk.allowCredentials.every(item=>item.transports?.length&&item.transports.every(transport=>!['internal','hybrid'].includes(transport)));
  if(self!==navigator.credentials||!pk||hardwareOnly||Object.keys(pk.extensions||{}).some(name=>name!=='appid'&&name!=='credProps')||operation==='create'&&pk.authenticatorSelection?.authenticatorAttachment==='cross-platform')return Reflect.apply(target,self,args);
  return run(operation,options);
 }})});
 Object.defineProperty(key,'isUserVerifyingPlatformAuthenticatorAvailable',{configurable:true,writable:true,value:()=>Promise.resolve(true)});
 Object.defineProperty(key,'isConditionalMediationAvailable',{configurable:true,writable:true,value:()=>Promise.resolve(false)});
 const capabilities=key.getClientCapabilities;
 if(typeof capabilities==='function')Object.defineProperty(key,'getClientCapabilities',{configurable:true,writable:true,value:async()=>({...await capabilities.call(key),passkeyPlatformAuthenticator:true,conditionalGet:false,conditionalCreate:false})});
}
if(process.platform==='darwin'&&process.isMainFrame&&/^https:\/\//.test(location.href)){
 try{if(ipcRenderer.sendSync('acira:mac-passkey-ready')===true)contextBridge.executeInMainWorld({func:installPasskeys,args:[input=>ipcRenderer.invoke('acira:mac-passkey-start',input),id=>ipcRenderer.invoke('acira:mac-passkey-cancel',id)]});}catch{/* A closing frame or unavailable native integration. */}
}
