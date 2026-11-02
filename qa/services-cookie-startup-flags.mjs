import {_electron} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import https from 'node:https';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

// Capability probe only. No production flags or cookie/header/DOM shims are added.
const data=path.resolve('.qa-profiles/services-cookie-startup-flags-'+Date.now());
await fs.mkdir(data,{recursive:true});
await promisify(execFile)(process.env.OPENSSL_BIN||(process.platform==='win32'?'C:/Program Files/Git/usr/bin/openssl.exe':'openssl'),['req','-x509','-newkey','rsa:2048','-keyout',path.join(data,'tls.key'),'-out',path.join(data,'tls.pem'),'-days','1','-nodes','-subj','/CN=Acira disposable startup flag fixture']);
let port,app;
const report={status:'running',observations:[],limitations:['Isolated native startup flag capability probe; not all-target/lifecycle or browser-wide cookie-policy approval. No user profile or provider used.']};
const server=https.createServer({key:await fs.readFile(path.join(data,'tls.key')),cert:await fs.readFile(path.join(data,'tls.pem'))},(q,r)=>{
 r.setHeader('Content-Type','text/html');r.setHeader('Cache-Control','no-store');
 if(q.url==='/seed'){r.setHeader('Set-Cookie',['ordinary=seeded; Secure; SameSite=None; Path=/','privatehttp=seeded; Secure; HttpOnly; SameSite=None; Path=/']);r.end('<title>Seed</title>seed');return;}
 if(q.url==='/embed'){r.setHeader('Set-Cookie',['newordinary=embedded; Secure; SameSite=None; Path=/','chips=partitioned; Secure; SameSite=None; Partitioned; Path=/']);r.end(`<script>parent.postMessage({header:${JSON.stringify(q.headers.cookie||'')},script:document.cookie},'*')</script>`);return;}
 r.setHeader('Set-Cookie','login=firstparty; Secure; SameSite=Lax; Path=/');r.end(`<title>Startup cookie flags</title><script>window.results=[];onmessage=e=>{if(e.origin===${JSON.stringify(`https://third.acira-b.test:${port}`)})results.push(e.data)}</script><iframe src="https://third.acira-b.test:${port}/embed"></iframe>`);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));port=server.address().port;
try{
 for(const [mode,flags] of [['baseline',[]],['chromium-phaseout-flag',['--test-third-party-cookie-phaseout']]]){
  const profile=path.join(data,mode);await fs.mkdir(profile,{recursive:true});
  try{
   app=await _electron.launch({args:[path.resolve('qa/services-cookie-host.cjs'),'--host-resolver-rules=MAP *.acira-a.test 127.0.0.1, MAP *.acira-b.test 127.0.0.1',...flags],env:{...process.env,ACIRA_SERVICES_DATA:profile}});await app.firstWindow();
   await app.evaluate(async(_e,url)=>global.cookieFixture.wc.loadURL(url),`https://third.acira-b.test:${port}/seed`);
   const url=`https://first.acira-a.test:${port}/observe`;await app.evaluate(async(_e,url)=>global.cookieFixture.wc.loadURL(url),url);
   const page=app.context().pages().find(page=>page.url()===url);assert.ok(page);
   await page.waitForFunction(()=>window.results?.length>0);
   const observed=await page.evaluate(()=>({thirdParty:window.results[0],firstParty:document.cookie}));
   const ordinary=/(?:^|;\s*)(?:ordinary|newordinary|privatehttp)=/;
   const entry={mode,flags,...observed,httpBlocked:!ordinary.test(observed.thirdParty.header),domBlocked:!ordinary.test(observed.thirdParty.script),debuggerAttached:await app.evaluate(()=>global.cookieFixture.wc.debugger.isAttached())};
   assert.match(entry.firstParty,/login=firstparty/);assert.match(entry.thirdParty.script,/chips=partitioned/);assert.equal(entry.debuggerAttached,false);
   if(mode==='baseline'){assert.match(entry.thirdParty.header,/ordinary=seeded/);assert.match(entry.thirdParty.script,/ordinary=seeded/);}
   report.observations.push(entry);report.runtime=await app.evaluate(()=>({electron:process.versions.electron,chromium:process.versions.chrome,node:process.versions.node}));
  }finally{await app?.close();app=null;}
 }
 report.status='observed';report.flagEnforces=report.observations[1].httpBlocked&&report.observations[1].domBlocked;
}catch(error){report.status='failed';report.error=error.stack;throw error;}
finally{await app?.close();await new Promise(resolve=>server.close(resolve));await fs.mkdir(path.resolve('qa/artifacts'),{recursive:true});await fs.writeFile(path.resolve('qa/artifacts/services-cookie-startup-flags.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
