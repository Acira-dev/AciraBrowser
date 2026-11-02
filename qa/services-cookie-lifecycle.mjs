import {_electron} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import https from 'node:https';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const data=path.resolve('.qa-profiles/services-cookie-lifecycle-'+Date.now());await fs.mkdir(data,{recursive:true});
const openssl=process.env.OPENSSL_BIN||(process.platform==='win32'?'C:/Program Files/Git/usr/bin/openssl.exe':'openssl');
await promisify(execFile)(openssl,['req','-x509','-newkey','rsa:2048','-keyout',path.join(data,'tls.key'),'-out',path.join(data,'tls.pem'),'-days','1','-nodes','-subj','/CN=Acira disposable cookie lifecycle fixture']);
let port,app;const report={observations:[],checks:[],correction:'Restriction is explicitly re-enabled, page reloaded and BOTH HTTP/DOM blocking asserted immediately before detach. Exception and real rendered DevTools phases are separate.'};
const server=https.createServer({key:await fs.readFile(path.join(data,'tls.key')),cert:await fs.readFile(path.join(data,'tls.pem'))},(q,r)=>{r.setHeader('Content-Type','text/html');r.setHeader('Cache-Control','no-store');if(q.url==='/seed'){r.setHeader('Set-Cookie','ordinary=seeded; Secure; SameSite=None; Path=/');r.end('<title>Seed</title>seed');return;}if(q.url==='/embed'){r.setHeader('Set-Cookie',['newordinary=embedded; Secure; SameSite=None; Path=/','chips=partitioned; Secure; SameSite=None; Partitioned; Path=/']);r.end(`<script>parent.postMessage({header:${JSON.stringify(q.headers.cookie||'')},script:document.cookie},'*')</script>`);return;}r.setHeader('Set-Cookie','login=firstparty; Secure; SameSite=Lax; Path=/');r.end(`<title>Cookie lifecycle fixture</title><h1 id="cookie-lifecycle-heading">Cookie lifecycle marker</h1><script>window.results=[];onmessage=e=>results.push(e.data)</script><iframe src="https://third.acira-b.test:${port}/embed"></iframe>`);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));port=server.address().port;
try{
 app=await _electron.launch({args:[path.resolve('qa/services-cookie-host.cjs'),'--host-resolver-rules=MAP *.acira-a.test 127.0.0.1, MAP *.acira-b.test 127.0.0.1'],env:{...process.env,ACIRA_SERVICES_DATA:data}});await app.firstWindow();
 const load=async(mode,seed=false)=>{const url=seed?`https://third.acira-b.test:${port}/seed`:`https://first.acira-a.test:${port}/${mode}`;await app.evaluate(async(_e,url)=>global.cookieFixture.wc.loadURL(url),url);if(seed)return;const page=app.context().pages().find(p=>p.url()===url);await page.waitForFunction(()=>window.results?.length>0);const entry={mode,thirdParty:await page.evaluate(()=>window.results[0]),firstParty:await page.evaluate(()=>document.cookie)};report.observations.push(entry);return entry;};
 const restrict=async value=>app.evaluate(async(_e,value)=>{const wc=global.cookieFixture.wc;if(!wc.debugger.isAttached())wc.debugger.attach('1.3');await wc.debugger.sendCommand('Network.enable');await wc.debugger.sendCommand('Network.setCookieControls',{enableThirdPartyCookieRestriction:value,disableThirdPartyCookieMetadata:true,disableThirdPartyCookieHeuristics:true});return {attached:wc.debugger.isAttached()};},value);
 const blocked=entry=>{assert.equal(/(?:^|;\s*)(?:ordinary|newordinary)=/.test(entry.thirdParty.header),false,entry.mode+' HTTP restriction');assert.equal(/(?:^|;\s*)(?:ordinary|newordinary)=/.test(entry.thirdParty.script),false,entry.mode+' DOM restriction');assert.match(entry.firstParty,/login=firstparty/);};
 await load('seed',true);const baseline=await load('baseline');assert.match(baseline.thirdParty.header,/ordinary=seeded/);assert.match(baseline.thirdParty.script,/ordinary=seeded/);
 await restrict(true);blocked(await load('restricted-initial'));report.checks.push('initial true restriction blocks HTTP and DOM ordinary cookies after reload; first-party retained');
 await restrict(false);const exception=await load('exception-only');assert.match(exception.thirdParty.header,/ordinary=seeded/);assert.match(exception.thirdParty.script,/ordinary=seeded/);report.checks.push('separate explicit false exception restores ordinary cookies after reload');
 await restrict(true);blocked(await load('restricted-immediately-before-detach'));report.checks.push('true restriction re-enabled and HTTP+DOM block asserted immediately before detach');
 await app.evaluate(()=>global.cookieFixture.wc.debugger.detach());report.detach=await load('after-restricted-detach');report.detachEnforcement={httpBlocked:!/(?:^|;\s*)(?:ordinary|newordinary)=/.test(report.detach.thirdParty.header),domBlocked:!/(?:^|;\s*)(?:ordinary|newordinary)=/.test(report.detach.thirdParty.script)};
 await restrict(true);blocked(await load('restricted-before-real-devtools'));
 report.devtoolsOpen=await app.evaluate(async({BrowserWindow})=>{const wc=global.cookieFixture.wc,tools=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});global.cookieFixture.tools=tools;global.cookieFixture.detachEvents=[];wc.debugger.on('detach',(_e,reason)=>global.cookieFixture.detachEvents.push(reason));wc.setDevToolsWebContents(tools.webContents);wc.openDevTools({activate:false});wc.inspectElement(30,20);return {id:tools.webContents.id};});
 // A rendered DevTools Elements tree, not isDevToolsOpened, establishes real frontend load.
 let devtoolsPage;const deadline=Date.now()+20000;while(Date.now()<deadline){for(const page of app.context().pages()){if(page.url().startsWith('devtools://')){devtoolsPage=page;break;}}if(devtoolsPage)break;await new Promise(r=>setTimeout(r,100));}
 if(!devtoolsPage)throw new Error('Real hidden DevTools frontend did not load');
 await devtoolsPage.locator('body').waitFor({state:'attached'});
 const inspectedNode=devtoolsPage.getByRole('treeitem').filter({hasText:'cookie-lifecycle-heading'}).first();await inspectedNode.waitFor({state:'attached',timeout:20000});
 report.devtoolsRendered={url:devtoolsPage.url(),elementsTreeNode:await inspectedNode.innerText()};assert.match(report.devtoolsRendered.elementsTreeNode,/cookie-lifecycle-heading/);report.checks.push('real hidden DevTools Elements tree renders the inspected page heading');
 report.debuggerAfterDevtools=await app.evaluate(()=>({attached:global.cookieFixture.wc.debugger.isAttached(),events:global.cookieFixture.detachEvents}));
 report.afterDevtoolsOpen=await load('after-real-devtools-open');
 try{await restrict(true);report.devtoolsRestrictCommand={supported:true};report.afterDevtoolsRestrict=await load('after-devtools-restrict-true');}catch(error){report.devtoolsRestrictCommand={supported:false,error:error.message};}
 report.runtime=await app.evaluate(()=>({electron:process.versions.electron,chromium:process.versions.chrome}));report.status='observed';
}catch(error){report.status='failed';report.error=error.stack;throw error;}
finally{await app?.close();server.close();await fs.mkdir(path.resolve('qa/artifacts'),{recursive:true});await fs.writeFile(path.resolve('qa/artifacts/services-cookie-lifecycle.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
