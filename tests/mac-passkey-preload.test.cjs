'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const {requestFor,validateResult}=require('../desktop/browser-services/mac-passkey-policy.cjs');
const {result}=require('./fixtures/passkey/records.cjs');
const source=fs.readFileSync(path.join(__dirname,'../desktop/browser-services/mac-passkey-preload.cjs'),'utf8');
function page({ready=true,platform='darwin',main=true,start}={}){
 const requests=[],cancels=[],context=vm.createContext({AbortController,DOMException,structuredClone,crypto:webcrypto,atob,btoa,process:{platform,isMainFrame:main},location:{href:'https://accounts.google.com/'}});
 vm.runInContext(`var window=globalThis;class CredentialsContainer {get(){return Promise.resolve('native-get')}create(){return Promise.resolve('native-create')}}
 class PublicKeyCredential {static isUserVerifyingPlatformAuthenticatorAvailable(){return Promise.resolve(false)}static isConditionalMediationAvailable(){return Promise.resolve(true)}static getClientCapabilities(){return Promise.resolve({conditionalGet:true,conditionalCreate:true,hybridTransport:true})}}
 class AuthenticatorAssertionResponse {} class AuthenticatorAttestationResponse {}
 Object.assign(window,{CredentialsContainer,PublicKeyCredential,AuthenticatorAssertionResponse,AuthenticatorAttestationResponse});
 var navigator={credentials:new CredentialsContainer()};var before=[CredentialsContainer.prototype.get,CredentialsContainer.prototype.create,PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable];`,context);
 const ipcRenderer={sendSync:()=>ready,invoke:async(channel,value)=>{
  if(channel==='acira:mac-passkey-cancel'){cancels.push(value);return;}
  assert.equal(channel,'acira:mac-passkey-start');requests.push(value);
  if(start)return start(value);
  const req=requestFor('https://accounts.google.com/',value);
  return {ok:true,credential:validateResult(req,result(req))};
 }};
 context.require=()=>({ipcRenderer,contextBridge:{executeInMainWorld({func,args}){func(...args);}}});
 vm.runInContext(source,context);
 return {context,requests,cancels,run:code=>vm.runInContext(code,context)};
}
test('Mac preload is an exact no-op without approved signing and on other platforms or child frames',async()=>{
 for(const options of [{ready:false},{platform:'win32'},{platform:'linux'},{main:false}]){
  const p=page(options);assert.equal(p.run('CredentialsContainer.prototype.get===before[0]&&CredentialsContainer.prototype.create===before[1]&&PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable===before[2]'),true);
  assert.equal(await p.run('navigator.credentials.get({publicKey:{challenge:new Uint8Array([1])}})'),'native-get');assert.equal(p.requests.length,0);
 }
});
test('authorized Mac requests return WebAuthn-shaped assertion and registration results with the real binary data',async()=>{
 const p=page();
 const check=await p.run(`(async()=>{
  const assertion=await navigator.credentials.get({publicKey:{rpId:'google.com',challenge:new Uint8Array([1,2,3]),userVerification:'required'}});
  const created=await navigator.credentials.create({publicKey:{challenge:new Uint8Array([1]),rp:{id:'google.com',name:'Example'},user:{id:new Uint8Array([7]),name:'User',displayName:'User'},pubKeyCredParams:[{type:'public-key',alg:-7}]}});
  return {key:assertion instanceof PublicKeyCredential,response:assertion.response instanceof AuthenticatorAssertionResponse,rawId:assertion.rawId instanceof ArrayBuffer,signature:assertion.response.signature.byteLength,userHandle:assertion.response.userHandle,registration:created.response instanceof AuthenticatorAttestationResponse,algorithm:created.response.getPublicKeyAlgorithm(),publicKey:created.response.getPublicKey().byteLength,json:JSON.parse(JSON.stringify(assertion))};
 })()`);
 assert.equal(check.key,true);assert.equal(check.response,true);assert.equal(check.rawId,true);assert.ok(check.signature);assert.equal(check.userHandle,null);assert.equal(check.registration,true);assert.equal(check.algorithm,-7);assert.ok(check.publicKey>32);assert.equal(check.json.type,'public-key');assert.equal(p.requests.length,2);
});
test('BufferSource inputs from another same-origin realm keep their exact bytes',async()=>{
 const p=page();p.context.foreignChallenge=vm.runInNewContext('new Uint8Array([8,9,10]).buffer');
 await p.run('navigator.credentials.get({publicKey:{challenge:foreignChallenge}})');
 assert.equal(p.requests[0].challenge,Buffer.from([8,9,10]).toString('base64url'));
});
test('passkey capability answers advertise explicit native selection without claiming conditional autofill',async()=>{
 const p=page();assert.equal(await p.run('PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()'),true);assert.equal(await p.run('PublicKeyCredential.isConditionalMediationAvailable()'),false);
 const caps=await p.run('PublicKeyCredential.getClientCapabilities()');assert.equal(caps.passkeyPlatformAuthenticator,true);assert.equal(caps.conditionalGet,false);assert.equal(caps.conditionalCreate,false);assert.equal(caps.hybridTransport,true);
});
test('Google-style AppID requests use the platform RP ID and report that the legacy AppID was unused',async()=>{
 const p=page();
 const answer=await p.run(`navigator.credentials.get({publicKey:{challenge:new Uint8Array([1]),rpId:'google.com',extensions:{appid:'https://www.gstatic.com/securitykey/origins.json'}}}).then(value=>value.getClientExtensionResults())`);
 assert.equal(answer.appid,false);assert.equal(p.requests[0].rpId,'google.com');
});
test('passwords, hardware-only requests and unsupported extension requests stay on Chromium',async()=>{
 const p=page();for(const code of ['{password:true}','{publicKey:{allowCredentials:[{type:"public-key",id:new Uint8Array([1]),transports:["usb"]}]}}','{publicKey:{extensions:{prf:{}}}}'])assert.equal(await p.run('navigator.credentials.get('+code+')'),'native-get');
 assert.equal(await p.run('navigator.credentials.create({publicKey:{authenticatorSelection:{authenticatorAttachment:"cross-platform"}}})'),'native-create');assert.equal(p.requests.length,0);
});
test('abort before dispatch never starts native authentication; abort during a request cancels it and keeps the original reason',async()=>{
 const early=page();const pending=early.run(`var control=new AbortController();var pending=navigator.credentials.get({publicKey:{challenge:new Uint8Array([1])},signal:control.signal});control.abort('stop');pending`);
 await assert.rejects(pending,error=>error==='stop');assert.equal(early.requests.length,0);
 let finish;const p=page({start:()=>new Promise(resolve=>{finish=resolve;})});
 const request=p.run(`var control=new AbortController();var pending=navigator.credentials.get({publicKey:{challenge:new Uint8Array([1])},signal:control.signal});pending`);await Promise.resolve();
 p.run('control.abort("my reason")');await assert.rejects(request,error=>error==='my reason');assert.equal(p.cancels.length,1);finish({ok:false,name:'NotAllowedError'});
});
test('conditional autofill never opens a system modal and preserves abort semantics',async()=>{
 const p=page();const pending=p.run(`var control=new AbortController();var pending=navigator.credentials.get({mediation:'conditional',publicKey:{challenge:new Uint8Array([1])},signal:control.signal});pending`);
 p.run('control.abort()');await assert.rejects(pending,{name:'AbortError'});assert.equal(p.requests.length,0);
});
