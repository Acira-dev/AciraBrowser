'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createConnectionInfo,USE_ENGINE_RESULT}=require('../desktop/browser-services/connection-info.cjs');
const fakeSession=()=>{const s={installs:0,setCertificateVerifyProc(proc){s.installs++;s.proc=proc;}};return s;};
const connect=(session,request)=>{let answer;session.proc(request,value=>{answer=value;});return answer;};
const leaf={issuer:{organizations:["Let's Encrypt"],commonName:'YE2'},subject:{commonName:'*.example.com'},validStart:1791138891,validExpiry:1798914890};

test('records who vouches for a site and until when, and always hands the decision back to the engine',()=>{
  const info=createConnectionInfo(),session=fakeSession();info.attach(session);info.attach(session);
  assert.equal(session.installs,1,'attached once per session');
  assert.equal(connect(session,{hostname:'WWW.Example.com',verificationResult:'net::OK',certificate:leaf}),USE_ENGINE_RESULT);
  assert.equal(USE_ENGINE_RESULT,-3,'-3 means: use the engine\'s own result');
  assert.deepEqual(info.get(session,'www.example.com'),{verified:true,issuedBy:"Let's Encrypt",issuedTo:'*.example.com',validFrom:new Date(leaf.validStart*1000).toISOString(),validUntil:new Date(leaf.validExpiry*1000).toISOString()});
  assert.equal(info.get(session,'other.example'),null);
  assert.equal(info.get(fakeSession(),'www.example.com'),null,'another profile session sees nothing');
});

test('a failed verification is recorded as not verified and still goes to the engine',()=>{
  const info=createConnectionInfo(),session=fakeSession();info.attach(session);
  assert.equal(connect(session,{hostname:'expired.example',verificationResult:'net::ERR_CERT_DATE_INVALID',certificate:leaf}),USE_ENGINE_RESULT);
  assert.equal(info.get(session,'expired.example').verified,false);
});

test('odd or hostile input never throws, never changes the decision, and is cleaned',()=>{
  const info=createConnectionInfo(),session=fakeSession();info.attach(session);
  for(const request of [undefined,{},{hostname:'x.example'},{hostname:'',certificate:leaf},{hostname:'x.example',certificate:{issuer:5,subject:'no',validStart:'soon'}}])assert.equal(connect(session,request),USE_ENGINE_RESULT);
  const got=info.get(session,'x.example');assert.equal(got.issuedBy,'');assert.equal(got.validFrom,null);assert.equal(got.validUntil,null);
  connect(session,{hostname:'clean.example',verificationResult:'net::OK',certificate:{issuer:{organizations:['Evil\r\nCA\0'.repeat(80)]},subject:{commonName:'a'},validStart:1,validExpiry:2}});
  const clean=info.get(session,'clean.example');assert.ok(!/[\r\n\0]/.test(clean.issuedBy)&&clean.issuedBy.length<=200);
  assert.doesNotThrow(()=>info.attach(null));assert.doesNotThrow(()=>info.attach({}));
});

test('keeps the most recent 300 hosts per session',()=>{
  const info=createConnectionInfo(),session=fakeSession();info.attach(session);
  for(let i=0;i<305;i++)connect(session,{hostname:`h${i}.example`,verificationResult:'net::OK',certificate:leaf});
  assert.equal(info.get(session,'h0.example'),null);assert.ok(info.get(session,'h304.example'));assert.ok(info.get(session,'h5.example'));
});
