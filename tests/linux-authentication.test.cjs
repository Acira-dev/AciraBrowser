'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {subject,createLinuxAuthentication,ACTION}=require('../desktop/passwords/linux-authentication.cjs');
test('PolicyKit subject binds PID, kernel start time and current UID',()=>{
 const fields=['S',...Array(18).fill('0'),'123456'];
 assert.equal(subject({pid:42,uid:1000,readFile:()=> '42 (name with spaces) '+fields.join(' ')}),'42,123456,1000');
 assert.throws(()=>subject({pid:42,uid:0}),/ordinary user/);
 assert.throws(()=>subject({pid:42,uid:1000,readFile:()=> 'corrupt'}),/identity/);
});
test('Linux gate uses pkcheck without a shell, password capture or cached authorization',async()=>{
 let call;const gate=createLinuxAuthentication({getSubject:()=> '42,123456,1000',run:(file,args,options,cb)=>{call={file,args,options};cb(null);}});
 assert.deepEqual(await gate.verify(),{ok:true,method:'linux-polkit'});
 assert.equal(call.file,'/usr/bin/pkcheck');assert.deepEqual(call.args,['--action-id',ACTION,'--process','42,123456,1000','--allow-user-interaction']);assert.equal(call.options.shell,undefined);
});
for(const [name,error,code]of [['cancelled',{code:1},'cancelled'],['unavailable',{code:2},'unavailable'],['missing',{code:'ENOENT'},'unavailable'],['timeout',{killed:true},'timeout'],['unknown',{code:99},'failed']])test('Linux verification fails closed on '+name,async()=>assert.deepEqual(await createLinuxAuthentication({getSubject:()=> '42,1,1000',run:(_f,_a,_o,cb)=>cb(error)}).verify(),{ok:false,code}));
test('a missing process identity never launches an authentication command',async()=>{
 let called=false;const result=await createLinuxAuthentication({getSubject:()=>{throw Error('gone');},run:()=>{called=true;}}).verify();assert.equal(result.ok,false);assert.equal(called,false);
});
