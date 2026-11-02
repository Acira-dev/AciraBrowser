// Exclusive native QA lease required. One owned disposable browser per invocation; CDP detaches during idle.
// node qa/d-lightweight.mjs <acira|chrome|helium> [--sites static|real] [--settle 25] [--idle 30]
// D_APP_EXE: qualified portable; D_BUILD_IDENTITY: optional build-identity.json. D_CHROME_EXE / D_HELIUM_EXE override discovery.
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import {spawn, execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash, randomUUID} from 'node:crypto';
import os from 'node:os';
import {REAL_SITES, cpuInterval, validatePages} from './lightweight-policy.mjs';
const exec=promisify(execFile),hash=data=>createHash('sha256').update(data).digest('hex');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const flag=(name,fallback)=>{const i=process.argv.indexOf('--'+name);return i<0?fallback:process.argv[i+1];};
const which=process.argv[2]||'acira',mode=flag('sites','real'),IDLE=Number(flag('idle',30)),SETTLE=Number(flag('settle',25));
if(!['acira','chrome','helium'].includes(which)||!['real','static'].includes(mode)||!Number.isFinite(IDLE)||IDLE<10||IDLE>90||!Number.isFinite(SETTLE)||SETTLE<5||SETTLE>60||Number(flag('tabs',10))!==10)throw new Error('Use supported browser, static|real, ten tabs, idle 10–90s and settle 5–60s');
const started=Date.now(),runCapMs=Math.max(240000,(IDLE+SETTLE)*1000+150000),workDeadline=started+runCapMs-20000;
const nonce=randomUUID(),stamp=new Date().toISOString().replace(/[:.]/g,'-');
const root=path.resolve('.qa-profiles',`d-lightweight-${which}-${nonce}`),output=path.resolve('.tmp-d/lightweight',`${which}-${mode}-${stamp}.json`),traceFile=output.replace(/\.json$/,'.startup.json');
const result={schema:2,browser:which,mode,when:new Date().toISOString(),runNonce:nonce,sites:[],status:'INVALID',host:{platform:process.platform,arch:process.arch,node:process.version,ramBytes:os.totalmem(),cpu:os.cpus()[0]?.model,logicalCpus:os.cpus().length},operatorContext:process.env.D_PERF_CONTEXT||'Not supplied; power/display/occlusion state unqualified',limits:{runCapMs,idleSeconds:IDLE,settleSeconds:SETTLE},limitations:[
 'Installed-product comparison; recorded engine versions can differ. Not an engine-controlled benchmark.',
 'Private working set is whole-tree memory; memory/tab is whole-tree memory divided by ten.',
 'First owned top-level window may be a splash; native window-show trace and bridge readiness are separate Acira-only measures.',
 'Inspect per-site public navigation/consent/challenge evidence before comparing runs; identical URLs do not guarantee identical content.',
 'Menu/tab exercise is Acira-only and CDP-attached; idle measurements have no attached CDP sessions.',
 'GPU percentage sums owned PID GPU Engine counters, not a normalized percentage of a whole physical GPU; unavailable counters are explicit metric gaps.',
]};
let executable,port,server,child,browser,ui,waiter,waiterDone,windowWait='',ownedRoot,spawnError,watchdog,aborting=false,cleanupDeadline=0,initialComparatorTargets=[];
const clients=new Set(),expectedTargets=[];
function remaining(cap=10000){const ms=Math.min(cap,(cleanupDeadline||workDeadline)-Date.now());if(ms<=0)throw new Error('Run deadline exceeded');return ms;}
async function ps(file,args=[],timeout=15000){const out=await exec('powershell',['-NoProfile','-File',file,...args],{timeout,maxBuffer:2*1024*1024,windowsHide:true});return out.stdout.trim();}
const owned=(action,timeout=6000)=>ps('qa/lightweight-owned.ps1',['-Action',action,'-Executable',executable,'-Nonce',nonce,'-Profile',root,'-Port',String(port)],timeout).then(JSON.parse);
async function inspect(){const value=await owned('inspect');if(value.roots.length>1)throw new Error('Multiple owned roots');return value.roots[0]||null;}
async function poll(fn,label,cap=25000){const until=Math.min(workDeadline,Date.now()+cap);let last;while(Date.now()<until){if(spawnError)throw spawnError;if(aborting)throw new Error('Run deadline exceeded');try{const value=await fn();if(value)return value;}catch(error){last=error;}await sleep(200);}throw new Error(label+' timed out'+(last?': '+last.message:''));}
async function endpoint(suffix='/json/list'){const response=await fetch(`http://127.0.0.1:${port}${suffix}`,{signal:AbortSignal.timeout(remaining(2500))});if(!response.ok)throw new Error('CDP HTTP '+response.status);return response.json();}
async function connect(url){
 const socket=new WebSocket(url),pending=new Map(),listeners=new Set();let seq=0,closed=false;
 const client={onEvent:fn=>listeners.add(fn),close(){closed=true;for(const entry of pending.values()){clearTimeout(entry.timer);entry.reject(new Error('CDP closed'));}pending.clear();socket.close();clients.delete(client);},send(method,params={},cap=10000){return new Promise((resolve,reject)=>{if(closed)return reject(new Error('CDP closed'));const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(new Error(method+' timeout'));},remaining(cap));pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});}};
 socket.onmessage=event=>{let message;try{message=JSON.parse(event.data);}catch{return;}if(message.id){const entry=pending.get(message.id);if(!entry)return;pending.delete(message.id);clearTimeout(entry.timer);message.error?entry.reject(new Error(message.error.message)):entry.resolve(message.result);}else for(const listener of listeners)listener(message);};
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{socket.close();reject(new Error('CDP connection timeout'));},remaining(5000));socket.onopen=()=>{clearTimeout(timer);resolve();};socket.onerror=()=>{clearTimeout(timer);reject(new Error('CDP socket error'));};});
 socket.onclose=()=>{closed=true;for(const entry of pending.values()){clearTimeout(entry.timer);entry.reject(new Error('CDP peer closed'));}pending.clear();clients.delete(client);};
 clients.add(client);return client;
}
async function evaluate(client,expression){const out=await client.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(out.exceptionDetails)throw new Error('Runtime evaluation failed: '+(out.exceptionDetails.text||''));return out.result?.value;}
async function sample(pid,gpu=0){const value=JSON.parse(await ps('qa/proc-sample.ps1',['-RootPid',String(pid),'-Gpu',String(gpu)],Math.max(15000,(gpu+10)*1000)));if(!value.pids||!Number.isFinite(value.cpuSeconds)||!Number.isFinite(value.privateMB))throw new Error('Empty/invalid owned process sample');if(value.types?.browser?.n!==1)throw new Error('Contaminated sample: expected one browser root');return value;}
async function closeClients(){for(const client of [...clients])client.close();ui=null;browser=null;await sleep(150);}
async function launchPage(requested,index){
 const staging=`http://127.0.0.1:${server.address().port}/stage-${index}`;let tabId;
 if(which==='acira'){tabId='tab-'+randomUUID();await evaluate(ui,`window.acira.dispatch(${JSON.stringify({type:'tab.new',id:tabId,url:staging})})`);}
 else await browser.send('Target.createTarget',{url:staging});
 const target=await poll(async()=>(await endpoint()).find(t=>t.type==='page'&&t.url===staging),'Staging website target',10000);
 const client=await connect(target.webSocketDebuggerUrl);await client.send('Page.enable');await client.send('Network.enable');
 const tree=await client.send('Page.getFrameTree'),frameId=tree.frameTree.frame.id;
 const evidence={requested,targetId:target.id,tabId,status:null,failedRequest:null,navigationError:null,mainDocumentResponses:[]};
 const documents=new Set();
 client.onEvent(message=>{const p=message.params||{};if(message.method==='Network.requestWillBeSent'&&p.type==='Document'&&p.frameId===frameId)documents.add(p.requestId);if(message.method==='Network.responseReceived'&&p.type==='Document'&&p.frameId===frameId){evidence.status=p.response.status;evidence.mainDocumentResponses.push({url:p.response.url,status:p.response.status,fromDiskCache:!!p.response.fromDiskCache});}if(message.method==='Network.loadingFailed'&&documents.has(p.requestId))evidence.failedRequest=p.errorText;});
 const nav=await client.send('Page.navigate',{url:requested});if(nav.errorText)evidence.navigationError=nav.errorText;
 expectedTargets.push({client,evidence});await sleep(150);
}
async function pageEvidence(item){
 const probe=await evaluate(item.client,`(()=>{const text=(document.body?.innerText||'').slice(0,6000),title=document.title;return {url:location.href,title,readyState:document.readyState,navigationStatus:performance.getEntriesByType('navigation')[0]?.responseStatus??null,interstitial:/^(?:chrome-error|chrome):/.test(location.href)||/^(?:just a moment|access denied|attention required|privacy error|this site can.t be reached|sign in to continue)/i.test(title)||/verify (?:you are|you're) human|checking your browser|unusual traffic from your computer/i.test(text),consentBanner:/(?:accept all cookies|reject all cookies|manage (?:your )?consent)/i.test(text)};})()`);
 Object.assign(item.evidence,probe);if(item.evidence.status===null&&probe.navigationStatus>0)item.evidence.status=probe.navigationStatus;
 if(which==='acira'){const tab=await evaluate(ui,`window.acira.getSnapshot().then(s=>s.tabs.find(t=>t.id===${JSON.stringify(item.evidence.tabId)})??null)`);item.evidence.nativeError=tab?.error||null;if(!tab)item.evidence.nativeError='Logical tab disappeared';}
 return item.evidence;
}
async function cleanup(){
 const receipt={};cleanupDeadline=Date.now()+20000;clearTimeout(watchdog);
 try{if(executable&&port){const live=await inspect();if(live){
  try{const version=await endpoint('/json/version');const closer=await connect(version.webSocketDebuggerUrl);await closer.send('Browser.close',{},2500);receipt.normalClose='CDP Browser.close';}catch(error){receipt.normalCloseError=error.message;await owned('close');receipt.windowCloseRequested=true;}
  for(let i=0;i<8&&Date.now()<cleanupDeadline-6000;i++){if(!await inspect())break;await sleep(250);}
  if(await inspect()){receipt.forcedOwnedFallback=await owned('stop');}
  receipt.rootRemaining=!!await inspect();
 }}}catch(error){receipt.error=error.message;}
 await closeClients();if(waiter?.exitCode===null)waiter.kill();if(waiterDone)await Promise.race([waiterDone,sleep(500)]);if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
 result.cleanup=receipt;if(receipt.error||receipt.rootRemaining||receipt.forcedOwnedFallback){result.status='INVALID';result.errors??=[];result.errors.push('Normal owned shutdown was not qualified; inspect cleanup receipt');}
}
try{
 await fs.mkdir(root,{recursive:true});await fs.mkdir(path.dirname(output),{recursive:true});
 if(which==='acira')executable=path.resolve(process.env.D_APP_EXE||'node_modules/electron/dist/electron.exe');
 else executable=await ps('qa/lightweight-executable.ps1',['-Browser',which,...(process.env[`D_${which.toUpperCase()}_EXE`]?['-Explicit',process.env[`D_${which.toUpperCase()}_EXE`]]:[])]);
 result.executable=JSON.parse(await ps('qa/lightweight-owned.ps1',['-Action','metadata','-Executable',executable],30000));
 result.harness=Object.fromEntries(await Promise.all(['qa/d-lightweight.mjs','qa/lightweight-policy.mjs','qa/lightweight-owned.ps1','qa/lightweight-executable.ps1','qa/proc-sample.ps1','qa/window-wait.ps1'].map(async file=>[file,hash(await fs.readFile(file))])));
 if(which==='acira'){
  result.productMode=process.env.D_APP_EXE?'standalone-package':'development';
  if(process.env.D_BUILD_IDENTITY){const file=path.resolve(process.env.D_BUILD_IDENTITY),bytes=await fs.readFile(file),identity=JSON.parse(bytes);result.buildIdentity={file,sha256:hash(bytes),sourceDigest:identity.sourceDigest,commit:identity.commit,electron:identity.electron,version:identity.version,stable:identity.stable};}
  if(!process.env.D_APP_EXE)result.source=Object.fromEntries(await Promise.all([process.env.D_MAIN||'desktop/main.cjs','desktop/runtime.cjs','desktop/ui-preload.cjs','desktop/tab-sleep.cjs','package.json'].map(async file=>[file,hash(await fs.readFile(file))])));
  else{
   const packageRoot=path.dirname(executable),manifestFile=path.join(packageRoot,'FILES-SHA256.json'),bytes=await fs.readFile(manifestFile),manifest=JSON.parse(bytes);
   if(!/^[a-f0-9]{64}$/.test(manifest.sourceDigest)||!Array.isArray(manifest.files))throw new Error('Portable package source identity missing');
   if(result.buildIdentity&&manifest.sourceDigest!==result.buildIdentity.sourceDigest)throw new Error('Package and candidate source identity differ');
   const critical=['AciraBrowser.exe','resources/app/desktop/main.cjs','resources/app/desktop/ui-preload.cjs','resources/app/dist/index.html','resources/app/package.json'];
   result.packageIdentity={sourceDigest:manifest.sourceDigest,manifestSha256:hash(bytes),critical:[]};
   for(const file of critical){const expected=manifest.files.find(item=>item.file===file),actual=hash(await fs.readFile(path.join(packageRoot,file)));if(!expected||actual!==expected.sha256)throw new Error('Portable critical artifact differs from its manifest: '+file);result.packageIdentity.critical.push({file,sha256:actual});}
  }
 }
 server=http.createServer((request,response)=>{response.setHeader('content-type','text/html');response.end(`<!doctype html><title>${request.url}</title><body style="font:16px sans-serif"><h1>${request.url}</h1><p>A static page.</p>`);});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const sites=mode==='static'?REAL_SITES.map((_,i)=>`http://127.0.0.1:${server.address().port}/page-${i+1}`):[...REAL_SITES];result.requestedSites=sites;
 const reserve=net.createServer();await new Promise(resolve=>reserve.listen(0,'127.0.0.1',resolve));port=reserve.address().port;await new Promise(resolve=>reserve.close(resolve));
 const launchMs=Date.now();result.launchEpochMs=launchMs;
 waiter=spawn('powershell',['-NoProfile','-File','qa/window-wait.ps1','-Needle',`--acira-perf-run=${nonce}`,'-Executable',executable,'-StartMs',String(launchMs),'-TimeoutSec','60'],{stdio:['ignore','pipe','ignore'],windowsHide:true});
 waiterDone=new Promise(resolve=>{waiter.on('close',resolve);waiter.on('error',resolve);});waiter.stdout.on('data',chunk=>{windowWait+=chunk;});
 const args=[...(which==='acira'&&!process.env.D_APP_EXE?[path.resolve(process.env.D_MAIN||'desktop/main.cjs')]:[]),`--user-data-dir=${root}`,`--acira-perf-run=${nonce}`,`--remote-debugging-port=${port}`,...(which==='acira'?[]:['--no-first-run','--no-default-browser-check','--disable-sync','about:blank'])];
 const env={...process.env};for(const key of ['ELECTRON_RUN_AS_NODE','ACIRA_DEV','ACIRA_PREVIEW_RECORD','ACIRA_MATERIAL','ACIRA_BROWSER_TEST_HIDDEN','ACIRA_TEST_SERVICES_DELAY_MS','ACIRA_STARTUP_PROFILE','ACIRA_STARTUP_REQUIRES','ACIRA_MEMORY_SAVER_FREEZE_MS','ACIRA_MEMORY_SAVER_IDLE_MS','ACIRA_MEMORY_SAVER_TICK_MS'])delete env[key];
 if(which==='acira')Object.assign(env,{ACIRA_QA_RUN:'1',ACIRA_BROWSER_TEST_DATA:root,ACIRA_PERF:'1',ACIRA_STARTUP_TRACE:traceFile});
 child=spawn(executable,args,{stdio:'ignore',env,windowsHide:false});child.on('error',error=>{spawnError=error;});
 watchdog=setTimeout(()=>{aborting=true;void owned('stop').catch(error=>{result.watchdogError=error.message;});},runCapMs-10000);watchdog.unref();
 ownedRoot=await poll(inspect,'Unique owned browser root',30000);result.initialRoot=ownedRoot;
 const version=await poll(()=>endpoint('/json/version'),'Owned browser CDP',30000);browser=await connect(version.webSocketDebuggerUrl);result.engine=await browser.send('Browser.getVersion');
 if(which==='acira'){
  const target=await poll(async()=>(await endpoint()).find(t=>t.type==='page'&&t.url==='acira-browser-ui://ui/index.html'),'Acira trusted UI',30000);ui=await connect(target.webSocketDebuggerUrl);
  await poll(()=>evaluate(ui,'Boolean(window.acira?.getSnapshot)'),'Acira trusted bridge',15000);result.bridgeReadyMs=Date.now()-launchMs;
  let clicked=false;await poll(async()=>{const state=await evaluate(ui,`(()=>{const button=document.querySelector('button.fr-skip:not(:disabled)');if(button){button.click();return 'clicked';}return document.querySelector('.fr-stage,.fr-prism')?'present':'absent';})()`);if(state==='clicked')clicked=true;return state==='absent'&&clicked;},'Explicit fresh setup dismissal',20000);
  await sleep(500);result.setupSceneAfterSkip=await evaluate(ui,`document.querySelectorAll('.fr-stage,.fr-prism').length`);if(result.setupSceneAfterSkip!==0)throw new Error('Welcome scene still present');result.usableShellAfterSkipMs=Date.now()-launchMs;
 }
 else initialComparatorTargets=(await endpoint()).filter(t=>t.type==='page');
 ownedRoot=await poll(inspect,'Post-bootstrap owned root',10000);result.measuredRoot=ownedRoot;
 for(let i=0;i<sites.length;i++)await launchPage(sites[i],i);
 if(which!=='acira')for(const target of initialComparatorTargets){if(target.url!=='about:blank')throw new Error('Unexpected comparator first-run document: '+target.url);await browser.send('Target.closeTarget',{targetId:target.id});}
 if(which==='acira')await evaluate(ui,`window.acira.dispatch({type:'tab.select',id:${JSON.stringify(expectedTargets[0].evidence.tabId)}})`);
 else await browser.send('Target.activateTarget',{targetId:expectedTargets[0].evidence.targetId});
 await sleep(SETTLE*1000);remaining();
 for(const item of expectedTargets)result.sites.push(await pageEvidence(item));validatePages(result.sites);
 if(which==='acira'&&await evaluate(ui,`document.querySelectorAll('.fr-stage,.fr-prism').length`)!==0)throw new Error('Welcome scene reappeared');
 const targets=await endpoint();if(expectedTargets.some(item=>!targets.some(t=>t.id===item.evidence.targetId)))throw new Error('Intended website target absent');
 if(which!=='acira'&&targets.filter(t=>t.type==='page').length!==10)throw new Error('Comparator has extra page targets');
 await closeClients();
 const live=await inspect();if(!live||live.pid!==ownedRoot.pid||live.created!==ownedRoot.created)throw new Error('Owned root changed before measurement');
 const before=await sample(live.pid);await sleep(IDLE*1000);const after=await sample(live.pid,10),cpu=cpuInterval(before,after);
 result.processes=after.pids;result.privateMB=after.privateMB;result.privateMBPerTab=+(after.privateMB/10).toFixed(1);result.idleCpuPctOfOneCore=cpu.percentOfOneCore;result.cpuIntervalSeconds=cpu.seconds;result.idleGpuPctAvg=after.gpuAvgPct;result.idleGpuPctMax=after.gpuMaxPct;
 result.metricGaps=[];if(after.gpuAvgPct===null||after.gpuMaxPct===null)result.metricGaps.push('Windows GPU Engine counters unavailable; no GPU comparison qualified');
 result.gpuSampleScope='ten 1s samples immediately after idle CPU endpoint; CPU timestamps exclude GPU wait';
 result.beforeSample=before;result.afterSample=after;result.byType=after.types;
 const base=new Map(before.procs.map(p=>[p.pid,p.cpu]));result.idleCpuByType={};for(const p of after.procs){if(!base.has(p.pid))continue;const percent=Math.max(0,p.cpu-base.get(p.pid))/cpu.seconds*100;result.idleCpuByType[p.type]=+((result.idleCpuByType[p.type]||0)+percent).toFixed(2);}
 if(which==='acira'){
  const target=(await endpoint()).find(t=>t.type==='page'&&t.url==='acira-browser-ui://ui/index.html');ui=await connect(target.webSocketDebuggerUrl);const pre=await sample(live.pid),useStarted=Date.now();
  const gpu=sample(live.pid,14).then(value=>({value}),error=>({error}));
  for(let i=0;i<12;i++){await evaluate(ui,`window.acira.getSnapshot().then(s=>window.acira.browserCommand({type:'ui',tabId:s.activeTabId,action:'open',kind:'menu'}))`);await sleep(500);const overlay=(await endpoint()).find(t=>/view=overlay/.test(t.url));if(!overlay)throw new Error('Menu overlay absent');const oc=await connect(overlay.webSocketDebuggerUrl);await evaluate(oc,'window.acira.getBrowserLayout().then(l=>window.acira.closeOverlay(l.overlay&&l.overlay.id))');oc.close();await sleep(400);}
  for(const item of expectedTargets){await evaluate(ui,`window.acira.dispatch({type:'tab.select',id:${JSON.stringify(item.evidence.tabId)}})`);await sleep(300);}
  const measured=await gpu;if(measured.error)throw measured.error;const post=await sample(live.pid);result.uiUse={menuCycles:12,tabVisits:10,seconds:(Date.now()-useStarted)/1000,cpu:cpuInterval(pre,post),gpuPctAvg:measured.value.gpuAvgPct,gpuPctMax:measured.value.gpuMaxPct};
 }
 await Promise.race([waiterDone,sleep(200)]);try{result.firstOwnedWindow=JSON.parse(windowWait.trim().split('\n').at(-1));}catch{result.firstOwnedWindow={firstWindowMs:null};}if(result.firstOwnedWindow.firstWindowMs===null)throw new Error('No visible owned top-level window observed');
 if(which==='acira'){try{const trace=JSON.parse(await fs.readFile(traceFile,'utf8'));result.nativeStartupTrace=trace;result.nativeBrowserWindowShowMs=trace.marks['window-show']==null?null:Math.round(trace.timeOrigin+trace.marks['window-show']-launchMs);if(!Number.isFinite(result.nativeBrowserWindowShowMs)||result.nativeBrowserWindowShowMs<0)result.metricGaps.push('Native browser-window-show timing unavailable');}catch(error){result.startupTraceError=error.message;result.metricGaps.push('Native browser-window-show timing unavailable');}}
 if(result.packageIdentity)for(const item of result.packageIdentity.critical)if(hash(await fs.readFile(path.join(path.dirname(executable),item.file)))!==item.sha256)throw new Error('Measured package changed during run: '+item.file);
 result.status='VALID';
}catch(error){result.errors=[error.stack||String(error)];process.exitCode=1;}
finally{await cleanup();result.elapsedSeconds=+((Date.now()-started)/1000).toFixed(1);await fs.mkdir(path.dirname(output),{recursive:true});await fs.writeFile(output,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({status:result.status,output,metricGaps:result.metricGaps||[],errors:result.errors||[],elapsedSeconds:result.elapsedSeconds}));if(result.status!=='VALID')process.exitCode=1;}
