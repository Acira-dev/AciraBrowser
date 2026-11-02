'use strict';
// Browser authority is supplied by the main process, never by the page's IPC data.
const {domainToASCII}=require('node:url');
const {isIP}=require('node:net');
const {parse}=require('tldts');
const {createHash,createPublicKey}=require('node:crypto');
function fail(name,message){throw Object.assign(new Error(message),{name});}
function bytes(value,max=1024,min=1){
 if(typeof value!=='string'||value.length>Math.ceil(max*4/3)+4||!/^[A-Za-z0-9_-]*$/.test(value))fail('TypeError','Invalid passkey data.');
 const out=Buffer.from(value,'base64url');
 if(out.length<min||out.length>max||out.toString('base64url')!==value)fail('TypeError','Invalid passkey data.');
 return out;
}
function text(value,max){if(typeof value!=='string'||!value||value.length>max||/[\u0000-\u001f]/.test(value))fail('TypeError','Invalid passkey account details.');return value;}
function requestFor(pageURL,input){
 let page;try{page=new URL(pageURL);}catch{fail('SecurityError','Passkeys need a secure website.');}
 if(page.protocol!=='https:'||page.username||page.password||isIP(page.hostname))fail('SecurityError','Passkeys need a secure website.');
 if(!input||typeof input!=='object'||!['get','create'].includes(input.operation)||!/^[a-f0-9-]{36}$/.test(input.id||''))fail('TypeError','Invalid passkey request.');
 let size;try{size=JSON.stringify(input).length;}catch{fail('TypeError','Invalid passkey request.');}
 if(size>128*1024)fail('TypeError','Passkey request is too large.');
 const host=page.hostname.toLowerCase(),raw=input.rpId===undefined?host:input.rpId;
 if(typeof raw!=='string'||raw.length>253||/[^a-zA-Z0-9.\-\u0080-\uffff]/.test(raw)||raw.startsWith('.')||raw.endsWith('.'))fail('SecurityError','Invalid passkey website.');
 const rpId=domainToASCII(raw).toLowerCase(),domain=parse(rpId,{allowPrivateDomains:true});
 if(!rpId||isIP(rpId)||(!domain.domain&&rpId!=='localhost')||(host!==rpId&&!host.endsWith('.'+rpId)))fail('SecurityError','The passkey belongs to another website.');
 const challenge=bytes(input.challenge).toString('base64url');
 const userVerification=input.userVerification??'preferred';
 if(!['required','preferred','discouraged'].includes(userVerification))fail('TypeError','Invalid verification preference.');
 const credentials=input.credentials??[];
 if(!Array.isArray(credentials)||credentials.length>64)fail('TypeError','Too many passkey credentials.');
 const list=credentials.map(value=>bytes(value).toString('base64url'));
 const timeout=input.timeout===undefined?60000:Number(input.timeout);
 if(!Number.isFinite(timeout)||timeout<0)fail('TypeError','Invalid passkey timeout.');
 const out={id:input.id,operation:input.operation,origin:page.origin,rpId,challenge,userVerification,credentials:list,timeout:Math.min(120000,Math.max(1000,timeout))};
 if(input.operation==='create'){
  if(input.attestation&&input.attestation!=='none')fail('NotSupportedError','This passkey provider supports anonymous attestation.');
  out.user={id:bytes(input.user?.id,64).toString('base64url'),name:text(input.user?.name,256),displayName:text(input.user?.displayName,256)};
 }
 return out;
}
// Bounded CBOR decoder for the authenticator's attestation object/COSE key.
// Indefinite lengths, tags and floats are unnecessary here and are refused.
function cbor(buffer){
 let at=0;
 function read(depth=0){
  if(depth>8||at>=buffer.length)fail('NotAllowedError','Invalid authenticator response.');
  const first=buffer[at++],major=first>>5,extra=first&31;
  let n=extra;
  if(extra>=24){const count=({24:1,25:2,26:4})[extra];if(!count||at+count>buffer.length)fail('NotAllowedError','Invalid authenticator response.');n=buffer.readUIntBE(at,count);at+=count;}
  if(major===0)return n;if(major===1)return -1-n;
  if(major===2||major===3){if(n>65536||at+n>buffer.length)fail('NotAllowedError','Invalid authenticator response.');const data=buffer.subarray(at,at+n);at+=n;return major===2?data:data.toString('utf8');}
  if(major===4||major===5){if(n>64)fail('NotAllowedError','Invalid authenticator response.');const value=major===4?[]:new Map();for(let i=0;i<n;i++){if(major===4)value.push(read(depth+1));else{const key=read(depth+1);if(value.has(key))fail('NotAllowedError','Invalid authenticator response.');value.set(key,read(depth+1));}}return value;}
  if(major===7&&extra>=20&&extra<=22)return [false,true,null][extra-20];
  fail('NotAllowedError','Invalid authenticator response.');
 }
 return {value:read(),length:at};
}
function validateResult(request,result){
 if(!result?.ok)fail(['AbortError','InvalidStateError','NotSupportedError'].includes(result?.name)?result.name:'NotAllowedError','The passkey request was cancelled or unavailable.');
 const value=result.credential;
 const rawId=bytes(value?.id),clientData=bytes(value?.clientDataJSON,8192);
 let client;try{client=JSON.parse(clientData.toString('utf8'));}catch{fail('NotAllowedError','Invalid authenticator response.');}
 if(client.type!=='webauthn.'+request.operation||client.origin!==request.origin||client.challenge!==request.challenge||client.crossOrigin===true||client.topOrigin)fail('SecurityError','The passkey response does not match this website.');
 let authData,publicKey;
 if(request.operation==='create'){
  const attestation=bytes(value.attestationObject,65536),decoded=cbor(attestation);
  if(decoded.length!==attestation.length||!(decoded.value instanceof Map))fail('NotAllowedError','Invalid authenticator response.');
  const statement=decoded.value.get('attStmt');
  if(decoded.value.get('fmt')!=='none'||!(statement instanceof Map)||statement.size)fail('NotAllowedError','Unexpected passkey attestation.');
  authData=decoded.value.get('authData');
 }else{
  authData=bytes(value.authenticatorData,65536);
  bytes(value.signature,8192);
  if(request.credentials.length&&!request.credentials.includes(value.id))fail('SecurityError','Unexpected passkey credential.');
  if(value.userHandle!==null&&value.userHandle!==undefined)bytes(value.userHandle,64,0);
 }
 if(!Buffer.isBuffer(authData)||authData.length<37||!authData.subarray(0,32).equals(createHash('sha256').update(request.rpId).digest())||!(authData[32]&1)||(request.userVerification==='required'&&!(authData[32]&4)))fail('SecurityError','The authenticator did not verify this request.');
 if(request.operation==='create'){
  if(!(authData[32]&64)||authData.length<55)fail('NotAllowedError','Invalid authenticator response.');
  const length=authData.readUInt16BE(53),end=55+length;
  if(end>=authData.length||!authData.subarray(55,end).equals(rawId))fail('NotAllowedError','Invalid authenticator response.');
  const key=cbor(authData.subarray(end)).value;
  if(!(key instanceof Map)||key.get(1)!==2||key.get(3)!==-7||key.get(-1)!==1||key.get(-2)?.length!==32||key.get(-3)?.length!==32)fail('NotSupportedError','Unsupported passkey algorithm.');
  publicKey=createPublicKey({key:{kty:'EC',crv:'P-256',x:key.get(-2).toString('base64url'),y:key.get(-3).toString('base64url')},format:'jwk'}).export({type:'spki',format:'der'}).toString('base64url');
 }
 return {...value,authenticatorData:authData.toString('base64url'),...(publicKey?{publicKey,publicKeyAlgorithm:-7}:{})};
}
module.exports={requestFor,validateResult,bytes,cbor};
