'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{createProxySettings,proxyChoice,nativeProxy}=require('../desktop/browser-services/proxy-settings.cjs');
test('proxy settings accept bounded native HTTP/SOCKS5 and host bypass syntax without credentials/PAC/URL injection',()=>{
 assert.deepEqual(nativeProxy(proxyChoice({mode:'fixed_servers',server:{scheme:'socks5',host:'[::1]',port:1080},bypassHosts:['*.example.org','<local>','*.example.org']})),{mode:'fixed_servers',proxyRules:'socks5://[::1]:1080',proxyBypassRules:'*.example.org,<local>'});
 for(const value of [{mode:'pac_script',pacScript:'https://example.org/script'},{mode:'direct',proxyRules:'ignored'},{mode:'fixed_servers',server:{scheme:'http',host:'user:password@example.org',port:8080}},{mode:'fixed_servers',server:{scheme:'http',host:'example.org/path',port:8080}},{mode:'fixed_servers',server:{scheme:'http',host:'example.org',port:0}},{mode:'fixed_servers',server:{scheme:'http',host:'example.org',port:8080},bypassHosts:['*']}])assert.throws(()=>proxyChoice(value));
});
test('proxy cancel does not change native route, persistence merges fresh policy and failed writes restore prior native route',async()=>{
 const calls=[],session={setProxy:async value=>calls.push(['set',value]),closeAllConnections:async()=>calls.push(['close'])};let policy={blocking:false},response=0,fail=false;
 const service=createProxySettings({database:{policy:()=>policy,setPolicy:(_p,_s,value)=>{if(fail)throw new Error('disk failure');policy=value;}},getContext(){},getWindow(){},dialog:{showMessageBox:async()=>({response})}});
 await service.attach(session,'A');assert.equal(service.status(session).applied,true);const baseline=calls.length;assert.deepEqual(await service.set(session,{mode:'direct'}),{cancelled:true});assert.equal(calls.length,baseline);response=1;await service.set(session,{mode:'direct'});assert.equal(policy.blocking,false);assert.equal(policy.networkProxy.mode,'direct');fail=true;await assert.rejects(service.set(session,{mode:'system'}),/disk failure/);assert.equal(service.status(session).choice.mode,'direct');assert.deepEqual(calls.at(-2),['set',{mode:'direct'}]);
});
test('private proxy choices never inherit/persist ordinary policy; release and unknown sessions fail closed',async()=>{
 let reads=0,writes=0;const session={setProxy:async()=>{},closeAllConnections:async()=>{}},service=createProxySettings({database:{policy:()=>{reads++;return {networkProxy:{mode:'direct'}};},setPolicy:()=>writes++},getContext(){},getWindow(){},dialog:{showMessageBox:async()=>({response:1})}});
 await service.attach(session,'private-A',true);assert.equal(reads,0);assert.equal(service.status(session).choice.mode,'system');await service.set(session,{mode:'direct'});assert.equal(writes,0);service.release(session);assert.throws(()=>service.status(session));
});
test('concurrent attachment awaits the same native policy installation before any caller may navigate',async()=>{
 let finish;const barrier=new Promise(resolve=>finish=resolve),session={setProxy:()=>barrier,closeAllConnections:async()=>{}},service=createProxySettings({database:{policy:()=>null},getContext(){},getWindow(){},dialog:{}});let secondReady=false;
 const first=service.attach(session,'A'),second=service.attach(session,'A').then(()=>secondReady=true);await new Promise(resolve=>setImmediate(resolve));assert.equal(secondReady,false);assert.equal(service.status(session).applied,false);finish();await Promise.all([first,second]);assert.equal(service.status(session).applied,true);assert.equal(secondReady,true);
});
