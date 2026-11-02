'use strict';
// Synthetic cryptographic records for policy/IPC tests; never account evidence.
const {createHash,generateKeyPairSync}=require('node:crypto');
const {requestFor}=require('../../../desktop/browser-services/mac-passkey-policy.cjs');
const id='01234567-89ab-4cde-8fab-0123456789ab',challenge=Buffer.from('test challenge').toString('base64url');
const input=extra=>({id,operation:'get',challenge,...extra});
const request=extra=>requestFor('https://accounts.google.com/path',input(extra));
const credentialId=Buffer.from('test credential');
function encoded(value){
 const head=(major,size)=>size<24?Buffer.from([major*32+size]):size<256?Buffer.from([major*32+24,size]):Buffer.from([major*32+25,size>>8,size&255]);
 if(Buffer.isBuffer(value))return Buffer.concat([head(2,value.length),value]);
 if(typeof value==='string'){const bytes=Buffer.from(value);return Buffer.concat([head(3,bytes.length),bytes]);}
 if(typeof value==='number')return head(value<0?1:0,value<0?-1-value:value);
 if(value instanceof Map)return Buffer.concat([head(5,value.size),...[...value].flatMap(([key,item])=>[encoded(key),encoded(item)])]);
 throw Error('unsupported test CBOR');
}
function result(req,{flags=5,rpId=req.rpId,client={},operation=req.operation,attestationFormat='none',attestationStatement=new Map()}={}){
 const auth=Buffer.concat([createHash('sha256').update(rpId).digest(),Buffer.from([flags]),Buffer.alloc(4)]);
 const value={id:credentialId.toString('base64url'),clientDataJSON:Buffer.from(JSON.stringify({type:'webauthn.'+operation,challenge:req.challenge,origin:req.origin,crossOrigin:false,...client})).toString('base64url'),authenticatorData:auth.toString('base64url'),signature:Buffer.from('test signature').toString('base64url'),userHandle:null,attachment:'platform'};
 if(operation==='create'){
  const jwk=generateKeyPairSync('ec',{namedCurve:'prime256v1'}).publicKey.export({format:'jwk'});
  const key=new Map([[1,2],[3,-7],[-1,1],[-2,Buffer.from(jwk.x,'base64url')],[-3,Buffer.from(jwk.y,'base64url')]]);
  const length=Buffer.alloc(2);length.writeUInt16BE(credentialId.length);
  const data=Buffer.concat([auth.subarray(0,32),Buffer.from([flags|64]),Buffer.alloc(4),Buffer.alloc(16),length,credentialId,encoded(key)]);
  value.attestationObject=encoded(new Map([['fmt',attestationFormat],['attStmt',attestationStatement],['authData',data]])).toString('base64url');
 }
 return {ok:true,credential:value};
}
module.exports={input,request,result,credentialId};
