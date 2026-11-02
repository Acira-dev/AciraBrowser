import {_electron} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import https from 'node:https';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {poll} from './native-helpers.mjs';
import {qualifiedElectron} from './release-runtime.mjs';

const run=Date.now(),data=path.resolve('.qa-profiles/release-cookie-policy-'+run),output=path.resolve('qa/artifacts/release-cookie-policy-'+run+'.json');
await fs.mkdir(data,{recursive:true});
await promisify(execFile)(process.env.OPENSSL_BIN||'C:/Program Files/Git/usr/bin/openssl.exe',['req','-x509','-newkey','rsa:2048','-keyout',path.join(data,'tls.key'),'-out',path.join(data,'tls.pem'),'-days','1','-nodes','-subj','/CN=Acira disposable cookie policy fixture'],{windowsHide:true});
let port,app;const report={schema:1,createdAt:new Date().toISOString(),checks:[],observations:[],limitations:['Playwright Electron loader changes Chromium feature switches, including disabling ThirdPartyStoragePartitioning. This legacy fixture is not an ordinary standalone engine verdict.','Engine capability experiment in an isolated hidden fixture, not a production cookie toggle or complete lifecycle guarantee.','Self-signed trust is restricted to two loopback-mapped fixture hostnames; no production certificate policy is changed.','Dedicated/service worker observations are separate from frame HTTP and document.cookie observations; unavailable worker APIs do not imply cookie enforcement.']};
const server=https.createServer({key:await fs.readFile(path.join(data,'tls.key')),cert:await fs.readFile(path.join(data,'tls.pem'))},(request,response)=>{
 const parsed=new URL(request.url,'https://fixture.invalid'),route=parsed.pathname;
 response.setHeader('Cache-Control','no-store');response.setHeader('Content-Type','text/html');
 if(route==='/seed'){response.setHeader('Set-Cookie','ordinary=fixture; Secure; SameSite=None; Path=/');response.end('<title>Seed</title>Fixture');return;}
 if(route==='/echo-worker'||route==='/echo-service-worker'){response.setHeader('Content-Type','text/plain');response.end(request.headers.cookie||'');return;}
 if(route==='/worker.js'){response.setHeader('Content-Type','application/javascript');response.end("fetch('/echo-worker',{credentials:'include',cache:'no-store'}).then(r=>r.text()).then(header=>postMessage({header})).catch(error=>postMessage({error:String(error)}))");return;}
 if(route==='/sw/service-worker.js'){response.setHeader('Content-Type','application/javascript');response.end("self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',event=>event.waitUntil(clients.claim()));self.addEventListener('message',event=>event.waitUntil(fetch('/echo-service-worker',{credentials:'include',cache:'no-store'}).then(r=>r.text()).then(header=>event.ports[0].postMessage({header})).catch(error=>event.ports[0].postMessage({error:String(error)}))))");return;}
 if(route==='/sw/embed'){
  response.setHeader('Set-Cookie',['newordinary=fixture; Secure; SameSite=None; Path=/','chips=fixture; Secure; SameSite=None; Partitioned; Path=/']);
  const phase=parsed.searchParams.get('phase')||'',script='/sw/service-worker.js'+(/fresh-registration|paused-registration/.test(phase)?'?revision='+encodeURIComponent(phase):'');
  response.end(`<script>(async()=>{const result={frameHeader:${JSON.stringify(request.headers.cookie||'')},documentCookie:document.cookie};result.dedicatedWorker=await new Promise(resolve=>{const worker=new Worker('/worker.js');const timer=setTimeout(()=>{worker.terminate();resolve({error:'timeout'})},8000);worker.onmessage=event=>{clearTimeout(timer);worker.terminate();resolve(event.data)};worker.onerror=event=>{clearTimeout(timer);resolve({error:event.message})}});try{const expected=new URL(${JSON.stringify(script)},location.href).href,registration=await navigator.serviceWorker.register(expected,{scope:'/sw/'}),deadline=Date.now()+8000;while(registration.active?.scriptURL!==expected||registration.active?.state!=='activated'){if(Date.now()>deadline)throw new Error('Distinct expected service-worker version did not activate');await new Promise(resolve=>setTimeout(resolve,25))}result.serviceWorker=await new Promise(resolve=>{const channel=new MessageChannel(),timer=setTimeout(()=>resolve({error:'timeout'}),8000);channel.port1.onmessage=event=>{clearTimeout(timer);resolve({...event.data,activatedScriptURL:registration.active.scriptURL})};registration.active.postMessage('probe',[channel.port2])})}catch(error){result.serviceWorker={error:String(error)}}parent.postMessage(result,'*')})()</script>`);return;
 }
 response.setHeader('Set-Cookie','login=fixture; Secure; SameSite=Lax; Path=/');response.end(`<title>Cookie policy fixture</title><h1>Cookie policy fixture</h1><script>window.result=null;onmessage=event=>{if(event.origin===${JSON.stringify('https://third.policy-b.test:')}+${JSON.stringify(String(port))})window.result=event.data}</script><iframe src="https://third.policy-b.test:${port}/sw/embed?phase=${encodeURIComponent(route)}"></iframe>`);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));port=server.address().port;
const ordinary=header=>/(?:^|;\s*)(?:ordinary|newordinary)=/.test(header||'');
async function load(phase,{seed=false}={}){
 const url=seed?`https://third.policy-b.test:${port}/seed`:`https://first.policy-a.test:${port}/${phase}`;
 await app.evaluate(async(_electron,url)=>globalThis.releaseCookiePolicy.wc.loadURL(url),url);if(seed)return;
 const result=await poll(()=>app.evaluate(()=>globalThis.releaseCookiePolicy.wc.executeJavaScript('window.result')),Boolean,'Frame and worker cookie result',25000);
 const firstParty=await app.evaluate(()=>globalThis.releaseCookiePolicy.wc.executeJavaScript('document.cookie'));
 const observation={phase,frameHttpBlocked:!ordinary(result.frameHeader),frameDomBlocked:!ordinary(result.documentCookie),firstPartyPreserved:/login=fixture/.test(firstParty),dedicatedWorker:{available:typeof result.dedicatedWorker?.header==='string',ordinaryBlocked:typeof result.dedicatedWorker?.header==='string'?!ordinary(result.dedicatedWorker.header):null,...result.dedicatedWorker},serviceWorker:{available:typeof result.serviceWorker?.header==='string',ordinaryBlocked:typeof result.serviceWorker?.header==='string'?!ordinary(result.serviceWorker.header):null,...result.serviceWorker},chipsInFrame:/chips=fixture/.test(result.documentCookie),debugger:await app.evaluate(()=>({attached:globalThis.releaseCookiePolicy.wc.debugger.isAttached(),detachEvents:globalThis.releaseCookiePolicy.detachEvents}))};
 report.observations.push(observation);return observation;
}
async function restrict(enabled){return app.evaluate(async(_electron,enabled)=>{const wc=globalThis.releaseCookiePolicy.wc;if(!wc.debugger.isAttached())wc.debugger.attach('1.3');await wc.debugger.sendCommand('Network.enable');await wc.debugger.sendCommand('Network.setCookieControls',{enableThirdPartyCookieRestriction:enabled,disableThirdPartyCookieMetadata:true,disableThirdPartyCookieHeuristics:true});},enabled);}
function assertFrameRestriction(result){assert.equal(result.frameHttpBlocked,true);assert.equal(result.frameDomBlocked,true);assert.equal(result.firstPartyPreserved,true);assert.equal(result.chipsInFrame,true);}
async function openOwnedBrowserProtocol(){
 const [portText,endpoint]=(await fs.readFile(path.join(data,'DevToolsActivePort'),'utf8')).trim().split(/\r?\n/);assert.match(portText,/^\d+$/);assert.match(endpoint,/^\/devtools\/browser\/[a-f\d-]+$/i);
 const socket=new WebSocket('ws://127.0.0.1:'+portText+endpoint),pending=new Map(),listeners=[];let sequence=0;
 await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
 socket.addEventListener('message',event=>{const message=JSON.parse(String(event.data));if(message.id&&pending.has(message.id)){const task=pending.get(message.id);pending.delete(message.id);clearTimeout(task.timer);message.error?task.reject(new Error(message.error.message)):task.resolve(message.result);return;}for(const listener of listeners)listener(message);});
 const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(new Error('Browser protocol timeout: '+method));},5000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});
 const sendChild=(sessionId,method,params={})=>send(method,params,sessionId);
 const targets=(await send('Target.getTargets')).targetInfos;assert.ok(targets.some(target=>target.url===`https://first.policy-a.test:${port}/worker-attach-fresh-registration`),'Browser endpoint must contain this exact owned fixture page');
 return {send,sendChild,onMessage:listener=>listeners.push(listener),close:()=>{for(const task of pending.values()){clearTimeout(task.timer);task.reject(new Error('Owned browser protocol closed'));}socket.close();}};
}
try{
 const runtime=await qualifiedElectron(),env={...process.env,ACIRA_RELEASE_POLICY_DATA:data};delete env.ELECTRON_RUN_AS_NODE;
 app=await _electron.launch({executablePath:runtime.executablePath,args:[path.resolve('qa/release-cookie-policy-host.cjs'),'--host-resolver-rules=MAP *.policy-a.test 127.0.0.1, MAP *.policy-b.test 127.0.0.1'],env,timeout:30000});
 await poll(()=>app.evaluate(()=>Boolean(globalThis.releaseCookiePolicy)),Boolean,'Hidden cookie policy host');report.runtime=await app.evaluate(()=>({electron:process.versions.electron,chromium:process.versions.chrome,node:process.versions.node}));assert.equal(report.runtime.electron,runtime.qualification.version);assert.equal(report.runtime.chromium,runtime.qualification.qualification.chromium);report.runtimeQualification=runtime.qualification;report.effectiveSwitches=await app.evaluate(({app})=>({enableFeatures:app.commandLine.getSwitchValue('enable-features'),disableFeatures:app.commandLine.getSwitchValue('disable-features')}));
 await load('seed',{seed:true});const baseline=await load('baseline');assert.equal(baseline.frameHttpBlocked,false);assert.equal(baseline.frameDomBlocked,false);assert.equal(baseline.dedicatedWorker.available,true);assert.equal(baseline.dedicatedWorker.ordinaryBlocked,false);report.checks.push('Positive baseline proves ordinary third-party frame HTTP/DOM and dedicated-worker requests are observable');
 await restrict(true);const restricted=await load('restricted-workers');assertFrameRestriction(restricted);report.checks.push('Selected patched runtime restricts frame HTTP/DOM, retains first-party login and CHIPS; worker outcomes measured independently');
 await app.evaluate(()=>globalThis.releaseCookiePolicy.wc.debugger.detach());const detached=await load('after-explicit-detach');report.checks.push('Explicit detach is measured only after a fresh asserted true frame restriction');
 await restrict(true);const beforeCrash=await load('restricted-before-crash');assertFrameRestriction(beforeCrash);
 await app.evaluate(()=>new Promise((resolve,reject)=>{const wc=globalThis.releaseCookiePolicy.wc,timer=setTimeout(()=>reject(new Error('Owned renderer crash did not arrive')),10000);wc.once('render-process-gone',(_event,details)=>{clearTimeout(timer);resolve(details.reason)});wc.forcefullyCrashRenderer();}));
 const recovered=await load('after-renderer-recovery');report.checks.push('Renderer recovery is measured after a fresh asserted restriction without silently reapplying policy');
 if(process.argv.includes('--probe-worker-attach')){
  report.workerAttachSetup=await app.evaluate(async(_electron,browserWorkerProbe)=>{
   const f=globalThis.releaseCookiePolicy,debuggerClient=f.wc.debugger,entries=[],tasks=new Set(),seen=new Set();f.workerAttachExperiment={entries};
   debuggerClient.on('message',(_event,method,params)=>{
    if(method!=='Target.attachedToTarget'||seen.has(params.sessionId))return;seen.add(params.sessionId);
    const entry={type:params.targetInfo.type,url:params.targetInfo.url,waitingForDebugger:params.waitingForDebugger,commands:[]};entries.push(entry);
    const send=async(method,parameters={})=>{try{await debuggerClient.sendCommand(method,parameters,params.sessionId);entry.commands.push({method,supported:true});return true;}catch(error){entry.commands.push({method,supported:false,error:error.message});return false;}};
    const task=(async()=>{try{await send('Network.enable');await send('Network.setCookieControls',{enableThirdPartyCookieRestriction:true,disableThirdPartyCookieMetadata:true,disableThirdPartyCookieHeuristics:true});if(['page','iframe'].includes(entry.type))await send('Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:true,flatten:true});}finally{if(!(browserWorkerProbe&&entry.type==='service_worker'))await send('Runtime.runIfWaitingForDebugger');}})();tasks.add(task);task.finally(()=>tasks.delete(task));
   });
   await debuggerClient.sendCommand('Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:true,flatten:true});
   const targets=(await debuggerClient.sendCommand('Target.getTargets')).targetInfos.filter(target=>target.type==='service_worker'&&target.url.startsWith('https://third.policy-b.test:'));
   const attachExisting=[];for(const target of targets)try{await debuggerClient.sendCommand('Target.attachToTarget',{targetId:target.targetId,flatten:true});attachExisting.push({type:target.type,attached:true});}catch(error){attachExisting.push({type:target.type,attached:false,error:error.message});}
   await Promise.all([...tasks]);return {existingServiceWorkers:attachExisting};
  },process.argv.includes('--probe-browser-targets'));
  const attached=await load('explicit-worker-target-experiment');report.workerAttachExperiment={observation:attached,targets:await app.evaluate(()=>globalThis.releaseCookiePolicy.workerAttachExperiment.entries)};
  report.checks.push('Optional explicit worker-target experiment records actual command support/resume and subsequent HTTP outcomes; it is not a production implementation');
  const cookieCount=await app.evaluate(async(_electron,origin)=>{const f=globalThis.releaseCookiePolicy;await f.wc.loadURL('about:blank');await f.wc.session.clearStorageData({origin,storages:['serviceworkers']});return (await f.wc.session.cookies.get({url:origin})).filter(cookie=>['ordinary','newordinary'].includes(cookie.name)).length;},`https://third.policy-b.test:${port}`);assert.equal(cookieCount,2,'Service-worker-only reset must preserve the ordinary-cookie positive control');
  const fresh=await load('worker-attach-fresh-registration');report.workerAttachFreshRegistration={observation:fresh,ordinaryCookiesPreserved:cookieCount,targets:await app.evaluate(()=>globalThis.releaseCookiePolicy.workerAttachExperiment.entries)};
  assert.match(fresh.serviceWorker.activatedScriptURL||'',/revision=%2Fworker-attach-fresh-registration$/);
  report.checks.push('Fresh service-worker registration is measured separately after clearing only disposable service-worker state and retaining both ordinary cookies');
  if(process.argv.includes('--probe-browser-targets')){
   const browser=app.context().browser();report.browserTargetCapability={browserAvailable:!!browser,sessionFactoryAvailable:typeof browser?.newBrowserCDPSession==='function'};
   const protocol=await openOwnedBrowserProtocol(),entries=[],tasks=new Set();
   try{
    report.browserTargetCapability.version=await protocol.send('Browser.getVersion');report.browserTargetCapability.transport='Native debugging endpoint read only from this disposable profile; exact owned fixture URL verified before mutations';
    protocol.onMessage(message=>{if(message.method!=='Target.attachedToTarget')return;const {sessionId,targetInfo,waitingForDebugger}=message.params,entry={type:targetInfo.type,url:targetInfo.url,waitingForDebugger,commands:[]};entries.push(entry);const send=async(method,params={})=>{try{await protocol.sendChild(sessionId,method,params);entry.commands.push({method,supported:true});}catch(error){entry.commands.push({method,supported:false,error:error.message});}};const task=(async()=>{try{await send('Network.enable');await send('Network.setCookieControls',{enableThirdPartyCookieRestriction:true,disableThirdPartyCookieMetadata:true,disableThirdPartyCookieHeuristics:true});}finally{await send('Runtime.runIfWaitingForDebugger');}})();tasks.add(task);task.finally(()=>tasks.delete(task));});
    await protocol.send('Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:true,flatten:true,filter:[{type:'service_worker',exclude:false},{exclude:true}]});await Promise.all([...tasks]);
    const preserved=await app.evaluate(async(_electron,origin)=>{const f=globalThis.releaseCookiePolicy;await f.wc.loadURL('about:blank');await f.wc.session.clearStorageData({origin,storages:['serviceworkers']});return (await f.wc.session.cookies.get({url:origin})).filter(cookie=>['ordinary','newordinary'].includes(cookie.name)).length;},`https://third.policy-b.test:${port}`);assert.equal(preserved,2);
    const result=await load('browser-worker-target-paused-registration');assert.match(result.serviceWorker.activatedScriptURL||'',/revision=%2Fbrowser-worker-target-paused-registration$/);await Promise.all([...tasks]);report.browserWorkerAttachExperiment={observation:result,ordinaryCookiesPreserved:preserved,targets:entries};report.checks.push('Optional browser-level service-worker startup attachment records distinct activated script, pause/commands/resume and native HTTP outcomes separately');
   }finally{await protocol.send('Target.setAutoAttach',{autoAttach:false,waitForDebuggerOnStart:false,flatten:true}).catch(()=>{});protocol.close();}
  }
 }
 assert.equal(await app.evaluate(({BaseWindow})=>BaseWindow.getAllWindows().some(window=>window.isVisible())),false);report.checks.push('Every fixture window remained hidden; no user profile, desktop input, production trust or privacy setting was changed');
 report.findings={restrictedDedicatedWorkerBlocked:restricted.dedicatedWorker.ordinaryBlocked,restrictedServiceWorkerBlocked:restricted.serviceWorker.ordinaryBlocked,detachRetainsFrameRestriction:detached.frameHttpBlocked&&detached.frameDomBlocked,rendererRecoveryRetainsFrameRestriction:recovered.frameHttpBlocked&&recovered.frameDomBlocked};report.status='OBSERVED';
}catch(error){report.status='FIXTURE_FAILED';report.failure=String(error.stack||error);process.exitCode=1;}
finally{await app?.close();server.close();await fs.mkdir(path.dirname(output),{recursive:true});await fs.writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({...report,output},null,2));}
