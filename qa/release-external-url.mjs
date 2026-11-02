import {completeLocalSetup} from './release-local-setup.mjs';
import {initializeReleaseProfile} from './release-initialize-profile.mjs';
import {_electron} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {poll} from './native-helpers.mjs';
const folder=path.resolve(process.argv[2]||''),executable=path.join(folder,'AciraBrowser.exe'),provenance=JSON.parse(await fs.readFile(path.join(folder,'ACIRA-PROVENANCE.json'),'utf8'));
const data=path.resolve('.qa-profiles','release-external-url-'+Date.now()),output=path.resolve('qa/artifacts','release-external-url-'+Date.now()+'.json');await fs.mkdir(data,{recursive:true});
const requests=[],server=http.createServer((request,response)=>{requests.push(request.url);response.setHeader('Content-Type','text/html');response.end('<!doctype html><title>External URL fixture</title><h1>'+request.url+'</h1>');});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
const env={...process.env,ACIRA_QA_RUN:'1',ACIRA_BROWSER_TEST_DATA:data,ACIRA_BROWSER_TEST_HIDDEN:'1',NODE_PATH:'',LOCALAPPDATA:path.join(data,'empty-source-profiles')};delete env.ELECTRON_RUN_AS_NODE;delete env.ACIRA_DEV;
const report={schema:1,createdAt:new Date().toISOString(),sourceDigest:provenance.sourceDigest,commit:provenance.commit,checks:[],limitations:['Actual packaged executable and disposable hidden profiles. No registry/default associations, user profile, visible app or OS chooser is used. Initialized-profile cold-start/second-instance HTTP delivery; fresh bootstrap URL transfer is separately checked by release-fresh-profile. installation and HTTPS/OS/private-only-window routing remain separate qualification.']};let app,ui;
async function observe(name,url,trigger){try{if(trigger)await trigger();await poll(async()=>{const snapshot=await ui.evaluate(()=>window.acira.getSnapshot());return snapshot.tabs.find(tab=>tab.url===url&&!tab.loading&&!tab.error);},Boolean,name,4500);assert.ok(requests.includes(new URL(url).pathname));report.checks.push({name,status:'PASS'});}catch(error){report.checks.push({name,status:'FAIL',error:String(error.message)});}}
try{
 report.profileInitialization=await initializeReleaseProfile({candidate:path.join(folder,'resources/app'),data,executablePath:executable,packaged:true});
 app=await _electron.launch({executablePath:executable,args:[base+'/cold-start'],env,cwd:process.env.TEMP||folder,timeout:30000});ui=await poll(async()=>app.context().pages().find(page=>page.url()==='acira-browser-ui://ui/index.html'),Boolean,'Packaged UI');await ui.waitForFunction(()=>Boolean(window.acira));await completeLocalSetup(ui);
 await observe('Cold executable launch opens the supplied HTTP URL',base+'/cold-start');
 await observe('Second executable launch delivers its HTTP URL to the running ordinary profile',base+'/second-instance',async()=>{await promisify(execFile)(executable,[base+'/second-instance'],{env,cwd:process.env.TEMP||folder,windowsHide:true,timeout:10000});});
 const before=(await ui.evaluate(()=>window.acira.getSnapshot())).tabs.map(tab=>tab.url);await promisify(execFile)(executable,['javascript:window.__untrusted_external_argument=true'],{env,cwd:process.env.TEMP||folder,windowsHide:true,timeout:10000});await new Promise(resolve=>setTimeout(resolve,200));const after=(await ui.evaluate(()=>window.acira.getSnapshot())).tabs.map(tab=>tab.url);assert.deepEqual(after,before);report.checks.push({name:'An unsupported JavaScript URL argument creates no navigation',status:'PASS'});
 assert.equal(await app.evaluate(({BaseWindow})=>BaseWindow.getAllWindows().some(window=>window.isVisible())),false);report.requests=requests;report.status=report.checks.every(check=>check.status==='PASS')?'PASS':'FAIL';if(report.status==='FAIL')process.exitCode=1;
}catch(error){report.status='FAIL';report.failure=String(error.stack||error);process.exitCode=1;}
finally{await app?.close();server.close();await fs.writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({...report,output},null,2));}
