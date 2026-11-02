'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {requestFor,validateResult,cbor}=require('../desktop/browser-services/mac-passkey-policy.cjs');
const {input,request,result,credentialId}=require('./fixtures/passkey/records.cjs');
test('native origin is authoritative; RP IDs must be the website or a registrable parent',()=>{
 assert.equal(request({rpId:'google.com'}).origin,'https://accounts.google.com');
 assert.equal(request({origin:'https://attacker.example'}).origin,'https://accounts.google.com');
 assert.equal(request().rpId,'accounts.google.com');
 for(const rpId of ['com','github.io','google.com.attacker.example','evilgoogle.com','google.com:443','.google.com','google.com.','127.0.0.1'])assert.throws(()=>request({rpId}),{name:'SecurityError'});
 assert.throws(()=>requestFor('https://tenant.github.io',input({rpId:'github.io'})),{name:'SecurityError'});
 for(const url of ['http://accounts.google.com','file:///tmp/a','https://name:password@accounts.google.com','https://127.0.0.1'])assert.throws(()=>requestFor(url,input()),{name:'SecurityError'});
});
test('payloads and binary fields are bounded and canonical; registration requires valid account details',()=>{
 for(const challenge of ['', 'a','x='.repeat(200),'!','A'.repeat(20000)])assert.throws(()=>request({challenge}),{name:'TypeError'});
 for(const fields of [{credentials:Array(65).fill('YQ')},{userVerification:'none'},{timeout:-1},{id:'a'},{padding:'x'.repeat(128*1024)}])assert.throws(()=>request(fields),{name:'TypeError'});
 assert.equal(request({timeout:1e9}).timeout,120000);
 const create={operation:'create',user:{id:'YQ',name:'User',displayName:'User'}};
 assert.equal(request(create).user.id,'YQ');
 assert.throws(()=>request({...create,user:{...create.user,id:''}}),{name:'TypeError'});
 assert.throws(()=>request({...create,attestation:'direct'}),{name:'NotSupportedError'});
});
test('assertions must echo the exact challenge, origin and type and verify the RP and requested user verification',()=>{
 const req=request({rpId:'google.com',userVerification:'required'});
 assert.equal(validateResult(req,result(req)).id,credentialId.toString('base64url'));
 for(const client of [{origin:'https://google.com'},{challenge:'YQ'},{type:'webauthn.create'},{crossOrigin:true},{topOrigin:'https://evil.example'}])assert.throws(()=>validateResult(req,result(req,{client})),{name:'SecurityError'});
 for(const fields of [{rpId:'attacker.example'},{flags:1},{flags:4}])assert.throws(()=>validateResult(req,result(req,fields)),{name:'SecurityError'});
 assert.throws(()=>validateResult({...req,credentials:['YQ']},result(req)),{name:'SecurityError'});
 assert.throws(()=>validateResult(req,{ok:false,name:'InvalidStateError'}),{name:'InvalidStateError'});
});
test('registration returns the real attested public key and rejects substituted credential IDs and malformed CBOR',()=>{
 const req=request({operation:'create',user:{id:'YQ',name:'User',displayName:'User'}}),answer=result(req);
 const valid=validateResult(req,answer);assert.equal(valid.publicKeyAlgorithm,-7);assert.ok(Buffer.from(valid.publicKey,'base64url').length>32);
 for(const fields of [{attestationFormat:'packed'},{attestationStatement:new Map([['sig',Buffer.from('unexpected')]])}])assert.throws(()=>validateResult(req,result(req,fields)),/Unexpected passkey attestation/);
 assert.throws(()=>validateResult(req,{ok:true,credential:{...answer.credential,id:'YQ'}}),{name:'NotAllowedError'});
 for(const buffer of [Buffer.from([0xbf]),Buffer.from([0x5a,255,255,255,255]),Buffer.from([0xa2,1,2,1,3]),Buffer.alloc(0)])assert.throws(()=>cbor(buffer));
});
