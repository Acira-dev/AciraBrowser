import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {setTimeout as delay} from 'node:timers/promises';
const require=createRequire(import.meta.url),root=path.resolve(import.meta.dirname,'..');
const {BrowserDatabase}=require('../desktop/database.cjs');
assert.equal(process.platform,'darwin');
await fs.mkdir(path.join(root,'.qa-profiles'),{recursive:true});
const directory=await fs.mkdtemp(path.join(root,'.qa-profiles/mac-links-')),requests=[];
const readBuild=()=>fs.readFile(path.join(directory,'preview-build.json'),'utf8').then(JSON.parse).catch(()=>null);
const server=http.createServer(async(req,res)=>{const build=await readBuild();requests.push({url:req.url,secureReady:build?.events.some(e=>e.event==='secure-startup'&&e.ready===true)===true});res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Owned native startup fixture</title><p>Local startup check</p>');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`,cold=base+'/cold?one=1#kept',warm=base+'/warm?two=2#tail';
const env={...process.env,ACIRA_QA_RUN:'1',ACIRA_BROWSER_TEST_DATA:directory,ACIRA_BROWSER_TEST_HIDDEN:'1',ACIRA_PREVIEW_RECORD:'1',ACIRA_DEV:'0'};delete env.ELECTRON_RUN_AS_NODE;
const launch=url=>spawn(require('electron'),[path.join(root,'qa/mac-startup-links-fixture.cjs'),url],{cwd:root,env,stdio:['ignore','pipe','pipe']});
let child,output='',checks=0;
const poll=async(get,test,label)=>{for(let i=0;i<200;i++){const result=await get();if(test(result))return result;if(child?.exitCode!==null)throw Error('Fixture exited during '+label+': '+output);await delay(100);}throw Error('Timed out: '+label+'\n'+output);};
try{
 child=launch(cold);child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
 await poll(readBuild,b=>b?.events.some(e=>e.event==='renderer-loaded'&&e.view==='browser'),'actual main readiness');
 await poll(async()=>requests,r=>r.some(q=>q.url==='/cold?one=1'),'cold URL');
 assert.ok(requests.every(r=>r.secureReady));checks++;
 const first=await readBuild();assert.equal(first.pid,child.pid);checks++;
 child.kill('SIGUSR2');await poll(()=>fs.readFile(path.join(directory,'cancelled-quit.json'),'utf8').then(JSON.parse).catch(()=>null),Boolean,'cancelled Quit');checks++;
 for(let index=0;index<2;index++){
  const secondary=launch(warm);let secondaryOutput='';secondary.stderr.on('data',b=>secondaryOutput+=b);
  const result=await new Promise((resolve,reject)=>{secondary.once('error',reject);secondary.once('exit',code=>resolve(code));});
  assert.equal(result,0,secondaryOutput);checks++;
  await poll(async()=>requests,r=>r.filter(q=>q.url==='/warm?two=2').length>=index+1,'warm URL '+index);
 }
 assert.equal((await readBuild()).pid,first.pid,'Secondaries preserve primary diagnostics');checks++;
 const stopped=new Promise(resolve=>child.once('exit',code=>resolve(code)));child.kill('SIGTERM');
 assert.equal(await Promise.race([stopped,delay(10000).then(()=>{throw Error('Normal fixture shutdown timed out');})]),0,output);checks++;
 const database=new BrowserDatabase(path.join(directory,'browser.sqlite'));
 try{const state=database.readWindow('main');assert.equal(state.tabs.filter(tab=>tab.url===cold).length,1);checks++;assert.equal(state.tabs.filter(tab=>tab.url===warm).length,2);checks++;}finally{database.close();}
 assert.ok(requests.every(r=>r.secureReady));checks++;
 assert.equal(await fs.access(path.join(directory,'startup-links.bin')).then(()=>true,()=>false),false);checks++;
 console.log(JSON.stringify({passed:true,checks,requests,scope:'Actual main, own hidden macOS profile; cold URL, two second-instance events after cancelled Quit, exact queries/fragments in persisted tabs, secure readiness, primary diagnostics and normal shutdown. Windows bootstrap relaunch is not qualified here.'}));
}finally{
 if(child?.exitCode===null){const stopped=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGTERM');await Promise.race([stopped,delay(5000)]);if(child.exitCode===null)child.kill('SIGKILL');}
 await new Promise(resolve=>server.close(resolve));await fs.rm(directory,{recursive:true,force:true});
}
