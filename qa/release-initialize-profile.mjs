import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {chromium} from 'playwright';
import {poll} from './native-helpers.mjs';

// Functional Playwright Electron fixtures cannot follow app.relaunch. Run the
// actual first-key startup and normal close before those initialized-profile
// tests. Fresh-credential crash acceptance uses release-fresh-profile instead.
export async function requiresReleaseProfileInitialization(candidate){
 if(await fs.access(path.join(candidate,'desktop/startup-gate.cjs')).then(()=>true,()=>false))return true;
 // Immutable products inline the gate into main.cjs instead of shipping its source module.
 const bundled=await fs.readFile(path.join(candidate,'desktop/main.cjs'),'utf8').catch(error=>{if(error.code==='ENOENT')return '';throw error;});
 return bundled.includes('startup-gate.cjs')&&/['"]secure-startup['"]/.test(bundled);
}
export async function initializeReleaseProfile({candidate,data,executablePath,packaged=false}){
 if(!await requiresReleaseProfileInitialization(candidate))return {required:false};
 if(await fs.access(path.join(data,'Local State')).then(()=>true,()=>false))return {required:true,alreadyInitialized:true};
 const nonce=randomUUID(),entry=path.resolve('qa/release-hidden-entry.cjs'),env={...process.env,ACIRA_RELEASE_CANDIDATE:candidate,ACIRA_QA_RUN:'1',ACIRA_BROWSER_TEST_DATA:data,ACIRA_BROWSER_TEST_HIDDEN:'1',ACIRA_PREVIEW_RECORD:'1',LOCALAPPDATA:path.join(data,'empty-import-sources')};delete env.NODE_OPTIONS;delete env.ELECTRON_RUN_AS_NODE;delete env.ACIRA_DEV;
 const initial=spawn(executablePath,['--remote-debugging-port=0',...(packaged?[]:[entry]),'--release-initialize-nonce='+nonce],{env,windowsHide:true,stdio:'ignore'});let browser,pid=initial.pid;
 const read=()=>fs.readFile(path.join(data,'preview-build.json'),'utf8').then(JSON.parse).catch(()=>null);
 try{
  const built=await poll(read,value=>value?.events.some(event=>event.event==='renderer-loaded'&&event.view==='browser')&&value.events.some(event=>event.event==='secure-startup'&&event.ready===true),'Actual initialization-only product startup',30000);pid=built.pid;
  const endpoint=await poll(async()=>{try{const [port,suffix]=(await fs.readFile(path.join(data,'DevToolsActivePort'),'utf8')).trim().split('\n'),value=await fetch('http://127.0.0.1:'+port+'/json/version').then(response=>response.json());return value.webSocketDebuggerUrl?.endsWith(suffix)?value.webSocketDebuggerUrl:null;}catch{return null;}},Boolean,'Owned initialization debugger endpoint');
  browser=await chromium.connectOverCDP(endpoint);const ui=await poll(async()=>browser.contexts()[0].pages().find(page=>page.url()==='acira-browser-ui://ui/index.html'),Boolean,'Initialization-only trusted UI');await ui.waitForFunction(()=>!!window.acira);try{await ui.evaluate(()=>window.acira.windowControl('close'));}catch{}
  await poll(async()=>{try{process.kill(pid,0);return false;}catch(error){if(error.code==='ESRCH')return true;throw error;}},Boolean,'Initialization-only normal native shutdown',10000);pid=null;
  return {required:true,actualProductStartup:true,packaged,initialPid:initial.pid,readyPid:built.pid,selfRelaunched:built.pid!==initial.pid,websiteCredentials:false,normalClose:true,scope:'QA initialization-only normal startup; subsequent functional fixture is initialized-profile evidence, never fresh-credential crash qualification.'};
 }finally{
  try{await browser?.close();}catch{}
  if(pid){const latest=await read();if(Number.isSafeInteger(latest?.pid)&&latest.pid>0)pid=latest.pid;if(!Number.isSafeInteger(pid)||pid<1)throw Error('Invalid owned initialization PID');const raw=(await promisify(execFile)('powershell',['-NoProfile','-Command',`Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" | Select-Object ProcessId,CommandLine,ExecutablePath | ConvertTo-Json -Compress`])).stdout.trim();if(raw){const actual=JSON.parse(raw);if(path.resolve(actual.ExecutablePath).toLowerCase()===path.resolve(executablePath).toLowerCase()&&actual.CommandLine.includes(nonce)&&(packaged||actual.CommandLine.includes('release-hidden-entry.cjs')))await promisify(execFile)('taskkill',['/PID',String(pid),'/T','/F']);else throw Error('Live initialization process identity does not match; no termination authorized');}}
 }
}
