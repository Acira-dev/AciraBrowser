// Actual-main network startup qualification without a UI driver or user profile.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {setTimeout as delay} from 'node:timers/promises';
const require=createRequire(import.meta.url),root=path.resolve(import.meta.dirname,'..');
await fs.mkdir(path.join(root,'.qa-profiles'),{recursive:true});
const directory=await fs.mkdtemp(path.join(root,'.qa-profiles/mac-network-'));
let checks=0;
try{
 for(const scenario of[{name:'on',gpc:true},{name:'off',gpc:false},{name:'corrupt',corrupt:true}]){
  const profile=path.join(directory,scenario.name);await fs.mkdir(profile);
  await fs.writeFile(path.join(profile,'native-network-preferences.json'),scenario.corrupt?'{}':JSON.stringify({version:1,choice:{gpc:scenario.gpc,dns:{mode:'system',servers:[]}}}));
  const requests=[],server=http.createServer((req,res)=>{
   requests.push({url:req.url,gpc:req.headers['sec-gpc']??null});res.setHeader('Cache-Control','no-store');
   if(req.url==='/worker.js'){res.setHeader('Content-Type','application/javascript');res.end('fetch("/signal-worker?enabled="+(navigator.globalPrivacyControl===true))');}
   else{res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Owned network startup</title><script>if(location.pathname==="/page"){fetch("/signal-page?enabled="+(navigator.globalPrivacyControl===true));new Worker("/worker.js")}</script>');}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const env={...process.env,ACIRA_QA_RUN:'1',ACIRA_BROWSER_TEST_DATA:profile,ACIRA_BROWSER_TEST_HIDDEN:'1',ACIRA_PREVIEW_RECORD:'1',ACIRA_DEV:'0'};delete env.ELECTRON_RUN_AS_NODE;
  const child=spawn(require('electron'),[path.join(root,'qa/mac-startup-fixture.cjs'),`http://127.0.0.1:${server.address().port}/page`],{cwd:root,env,stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);const exited=new Promise(resolve=>child.once('exit',code=>resolve(code)));
  const poll=async(get,test)=>{for(let i=0;i<250;i++){const value=await get();if(test(value))return value;if(child.exitCode!==null)throw Error('Native startup exited: '+output);await delay(50);}throw Error('Native startup timed out: '+output);};
  try{
   const record=await poll(()=>fs.readFile(path.join(profile,'preview-build.json'),'utf8').then(JSON.parse).catch(()=>null),r=>r?.events.some(e=>e.event==='renderer-loaded'&&e.view==='browser'));
   assert.ok(record.events.some(e=>e.event==='secure-startup'&&e.ready));checks++;assert.equal(record.pid,child.pid);checks++;
   if(scenario.corrupt){await delay(750);assert.equal(requests.length,0,'Corrupt preferences hold all controlled website/favicon HTTP');checks++;}
   else{
    await poll(async()=>requests,r=>r.some(q=>q.url.startsWith('/signal-page'))&&r.some(q=>q.url.startsWith('/signal-worker')));
    assert.ok(requests.some(r=>r.url==='/page'));checks++;
    assert.ok(requests.some(r=>r.url==='/signal-page?enabled='+scenario.gpc));checks++;
    assert.ok(requests.some(r=>r.url==='/signal-worker?enabled='+scenario.gpc));checks++;
    assert.ok(requests.every(r=>r.gpc===(scenario.gpc?'1':null)));checks++;
   }
   child.kill('SIGTERM');let deadline;try{assert.equal(await Promise.race([exited,new Promise((_,reject)=>{deadline=setTimeout(()=>reject(Error('Normal fixture close timed out')),10000);})]),0,output);checks++;}finally{clearTimeout(deadline);}
   console.log(JSON.stringify({scenario:scenario.name,passed:true,requests}));
  }finally{
   if(child.exitCode===null){child.kill('SIGTERM');const stopped=await Promise.race([exited,delay(5000).then(()=>false)]);if(stopped===false){child.kill('SIGKILL');await exited;}}
   server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  }
 }
 console.log(JSON.stringify({passed:true,checks,scope:'Actual main with fresh owned macOS profiles: native page/worker GPC API and HTTP headers on/off; corrupt preference holds HTTP while trusted renderer loads. Strict DNS provider transport, private-worker teardown and full IPC settings UI remain separate.'}));
}finally{await fs.rm(directory,{recursive:true,force:true});}
