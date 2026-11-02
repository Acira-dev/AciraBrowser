'use strict';
// Real Electron: an MV3 extension (service worker + content script) loaded through Acira's extension manager in an isolated
// profile, then its source edited and Reload pressed (the extensions page's command). After each Reload the worker that answers
// must be the new code, exactly one worker may run for the extension, and a page load must get the new content script.
// Prints one line: RESULT <json>. Run by tests/extension-reload.test.cjs (also: electron tests/fixtures/extension-reload/run.cjs).
const {app,BrowserWindow,session}=require('electron'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const root=path.resolve(__dirname,'..','..','..'),base=path.join(root,'.qa-profiles','extension-reload');fs.mkdirSync(base,{recursive:true});const data=fs.mkdtempSync(path.join(base,'run-'));
app.setPath('userData',data);app.setName('Acira extension reload qualification');
const {createExtensionManager}=require(path.join(root,'desktop','extensions.cjs'));
const folder=path.join(data,'unpacked');fs.mkdirSync(folder);
function write(build){
 fs.writeFileSync(path.join(folder,'manifest.json'),JSON.stringify({name:'Acira reload fixture',version:'1.0.0',manifest_version:3,host_permissions:['http://127.0.0.1/*'],background:{service_worker:'worker.js'},content_scripts:[{matches:['http://127.0.0.1/*'],js:['content.js'],run_at:'document_idle'}]}));
 fs.writeFileSync(path.join(folder,'worker.js'),`const BUILD=${JSON.stringify(build)},STARTED=Date.now()+Math.random();chrome.runtime.onMessage.addListener((message,_sender,reply)=>{if(message&&message.type==='who'){reply({build:BUILD,started:STARTED});}});`);
 fs.writeFileSync(path.join(folder,'content.js'),`const CONTENT=${JSON.stringify(build)};chrome.runtime.sendMessage({type:'who'},answer=>{const error=chrome.runtime.lastError&&chrome.runtime.lastError.message;const node=document.createElement('pre');node.id='ext-'+CONTENT;node.textContent=JSON.stringify({content:CONTENT,worker:answer||null,error:error||null});document.body.appendChild(node);});`);
}
const profiles=[{id:'A',name:'Fixture',partition:'persist:extension-reload'}];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const out={steps:[]};
const timer=setTimeout(()=>{console.log('RESULT '+JSON.stringify({...out,error:'timed out'}));app.exit(3);},100000);
app.whenReady().then(async()=>{
 const server=http.createServer((_q,r)=>{r.setHeader('content-type','text/html');r.end('<!doctype html><title>reload fixture</title><body><h1>page</h1></body>');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}/`;
 let window=null,manager=null;
 try{
  const ses=session.fromPartition(profiles[0].partition);
  window=new BrowserWindow({show:false,webPreferences:{partition:profiles[0].partition,sandbox:true,contextIsolation:true,nodeIntegration:false}});
  manager=createExtensionManager({getSession:p=>session.fromPartition(p),getProfiles:()=>profiles,getWindow:()=>window,registryPath:path.join(data,'extensions.json'),
   dialog:{showOpenDialog:async()=>({filePaths:[folder]}),showMessageBox:async()=>({response:1})},
   browser:{createTab:async()=>[window.webContents,window],selectTab:()=>{},removeTab:()=>{}}});
  manager.attachTab(window.webContents,window);manager.selectTab(window.webContents);
  const scopeOf=id=>`chrome-extension://${id}/`;
  const running=id=>Object.entries(ses.serviceWorkers.getAllRunning()).filter(([,info])=>String(info.scope).startsWith(scopeOf(id))).map(([version,info])=>({version:Number(version),script:info.scriptUrl}));
  // A page load and what its content script got back from the worker (bounded: 12 s).
  const visit=async build=>{await window.webContents.loadURL(url);for(let i=0;i<60;i++){const text=await window.webContents.executeJavaScript(`(document.getElementById(${JSON.stringify('ext-'+build)})||{}).textContent||''`).catch(()=>'');if(text)return JSON.parse(text);await sleep(200);}const any=await window.webContents.executeJavaScript(`[...document.querySelectorAll('pre')].map(n=>n.textContent).join('|')`).catch(()=>'');return {missing:build,seen:any};};
  // The first Reload is pressed straight after Load, before the first worker has answered anything (the usual order while editing an
  // extension: Load, change a file, Reload). That one used to leave the first worker running or unanswered (a third of the runs).
  // Three rounds of Load > Reload (the extension is removed between them), the first round with further Reloads, each straight
  // after the previous page load. EXT_RELOAD_MODE=settled waits for the first page and a pause instead.
  const settled=process.env.EXT_RELOAD_MODE==='settled';let n=0;
  for(const reloadsInRound of [3,1,1]){
   n++;write('v'+n);
   const loaded=await manager.command({type:'load',profileId:'A'});if(loaded.error)throw new Error('load: '+loaded.error);
   const id=loaded.extensions[0].id;out.id=id;
   if(settled){await visit('v'+n);await sleep(300);}
   out.steps.push({step:'install',expect:'v'+n,running:running(id)});
   for(let i=0;i<reloadsInRound;i++){
    n++;write('v'+n);
    const reloaded=await manager.command({type:'reload',profileId:'A',extensionId:id});if(reloaded.error)throw new Error('reload: '+reloaded.error);
    const page=await visit('v'+n);if(settled)await sleep(300);
    out.steps.push({step:'reload',expect:'v'+n,page,running:running(id),registry:reloaded.extensions.map(e=>({id:e.id,enabled:e.enabled}))});
   }
   const removed=await manager.command({type:'remove',profileId:'A',extensionId:id});if(removed.error)throw new Error('remove: '+removed.error);
  }
 }catch(error){out.error=String(error&&error.stack||error);}
 finally{clearTimeout(timer);console.log('RESULT '+JSON.stringify(out));server.close();try{window?.destroy();}catch{}app.exit(0);}
});
