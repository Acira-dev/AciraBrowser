// Real electron-updater + native Squirrel delivery between signed Mac beta versions. Signed QA
// copies keep the shipped application code, with a fixture entry point that
// isolates the profile/cache even after Squirrel relaunches without launch env.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {chromium} from 'playwright';
import {poll,sleep,httpFixture} from './d-harness.mjs';
import {launchPreparedNative} from './prepared-native.mjs';
const require=createRequire(import.meta.url),run=promisify(execFile),plist=require('plist'),{writeMacUpdateFeed}=require('../packaging/macos/update-feed.cjs'),{walk}=require('../packaging/macos/install-engine.cjs');
const old=path.resolve(process.argv[2]),next=JSON.parse(await fs.readFile(path.resolve(process.argv[3]),'utf8'));assert.equal(process.platform,'darwin');assert.equal(next.arch,process.arch);
const asar=require('@electron/asar');
async function packageInfo(bundle){const plain=path.join(bundle,'Contents/Resources/app/package.json');try{return JSON.parse(await fs.readFile(plain,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;asar.uncacheAll();return JSON.parse(asar.extractFile(path.join(bundle,'Contents/Resources/app.asar'),'package.json').toString());}}
async function expandedApp(bundle,output){const plain=path.join(bundle,'Contents/Resources/app');if(await fs.stat(plain).then(s=>s.isDirectory(),()=>false))return plain;await fs.mkdir(output,{recursive:true});asar.uncacheAll();asar.extractAll(path.join(bundle,'Contents/Resources/app.asar'),output);return output;}
const from=(await packageInfo(old)).version;
const id=String(Date.now()),root=path.resolve('.qa-profiles/mac-update-'+id),profile=path.join(root,'profile'),feed=path.join(root,'feed'),installed=path.join(root,'Applications/Acira Browser.app'),payload=path.join(root,'payload/Acira Browser.app'),out=path.resolve(process.env.MAC_UPDATE_OUT||'qa/artifacts/mac-update-'+id);
await Promise.all([fs.mkdir(profile,{recursive:true}),fs.mkdir(feed,{recursive:true}),fs.mkdir(out,{recursive:true})]);
const requests=[],report={passed:false,scope:'Real native updater with isolated signed QA identity/profile bootstrap; original application code unchanged, no mock updater, no public feed changes. Local update test does not qualify notarization or downloaded-file Gatekeeper.',from,to:next.version,commit:next.commit,root,checks:[],requests};let browser,cdp,restoredPage;
const fixture=await httpFixture(async(req,res)=>{requests.push(req.url);try{const name=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname).slice(1);assert(name&&path.basename(name)===name);const file=path.join(feed,name),stat=await fs.stat(file);res.setHeader('Content-Length',stat.size);res.setHeader('Content-Type',name.endsWith('.zip')?'application/zip':'application/yaml');createReadStream(file).pipe(res);}catch{res.writeHead(404);res.end();}});
const base='http://127.0.0.1:'+fixture.port+'/';
const executable=()=>path.join(installed,'Contents/MacOS/AciraBrowser');
const check=async(name,fn)=>{await fn();report.checks.push(name);console.log('PASS '+name);};
async function clone(source,target){
 await fs.mkdir(path.dirname(target),{recursive:true});await fs.cp(source,target,{recursive:true,verbatimSymlinks:true});
 const resources=path.join(target,'Contents/Resources/app'),archived=await fs.access(path.join(target,'Contents/Resources/app.asar')).then(()=>true,()=>false);if(archived)await expandedApp(target,resources);const pkgFile=path.join(resources,'package.json'),pkg=JSON.parse(await fs.readFile(pkgFile,'utf8'));pkg.main='qa-updater-entry.cjs';await fs.writeFile(pkgFile,JSON.stringify(pkg,null,2)+'\n');
 const entry=`'use strict';\nprocess.env.ACIRA_BROWSER_TEST_DATA=${JSON.stringify(profile)};\nprocess.env.ACIRA_BROWSER_TEST_HIDDEN='1';\nprocess.env.ACIRA_TEST_QUIET_NETWORK='1';\nprocess.env.ACIRA_UPDATE_TEST='1';\nprocess.env.ACIRA_UPDATE_FEED=${JSON.stringify(base)};\nrequire('node:os').homedir=()=>${JSON.stringify(path.join(root,'fixture-home'))};\nrequire('node:fs').mkdirSync(require('node:os').homedir(),{recursive:true});\nrequire('electron').app.commandLine.appendSwitch('remote-debugging-port','0');\nrequire('./desktop/main.cjs');\n`;
 await fs.writeFile(path.join(resources,'qa-updater-entry.cjs'),entry);
 const infoFile=path.join(target,'Contents/Info.plist'),info=plist.parse(await fs.readFile(infoFile,'utf8'));info.CFBundleIdentifier='computer.acira.qa.updater.'+id;info.CFBundleDisplayName='Acira update test';await fs.writeFile(infoFile,plist.build(info));
 if(archived)await require('../packaging/macos/widevine.cjs').sealAsar(target);
 const identity=next.signingIdentity;await run('/usr/bin/codesign',['--force','--sign',identity,'--options','runtime','--timestamp','--preserve-metadata=entitlements',target]);await run('/usr/bin/codesign',['--verify','--deep','--strict',target]);
 // Every shipped product-code file is identical; only the signed QA bootstrap and
 // package entry selector differ, and the native bundle identity is isolated.
 const targetFiles=await expandedApp(target,path.join(root,'expanded-target-'+path.basename(path.dirname(target)))),sourceFiles=await expandedApp(source,path.join(root,'expanded-source-'+path.basename(path.dirname(target))));
 for(const folder of ['desktop','dist'])assert.deepEqual(await walk(path.join(targetFiles,folder)),await walk(path.join(sourceFiles,folder)));
}
try{
 await clone(old,installed);await clone(next.appBundle,payload);
 const zip=path.join(feed,'AciraBrowser-'+next.version+'-mac-'+process.arch+'-update.zip');await run('/usr/bin/ditto',['--norsrc','--noextattr','-c','-k','--keepParent',payload,zip]);await writeMacUpdateFeed({output:feed,version:next.version,zip,arch:process.arch});
 const {BrowserDatabase}=require('../desktop/database.cjs'),{createInitialState,reduceBrowser}=require('../desktop/runtime.cjs');let initial=createInitialState();Object.assign(initial.settings,{onboardingComplete:true,askBeforeClosing:false,reducedMotion:true,language:'en',appearance:'dark'});initial=reduceBrowser(initial,{type:'tab.new',url:'acira://history'});initial=reduceBrowser(initial,{type:'workspace.create',name:'Preserved study workspace'});const db=new BrowserDatabase(path.join(profile,'browser.sqlite'));db.saveWindow('main',initial);db.close();await fs.writeFile(path.join(profile,'sentinel'),'keep existing profile');
 // Connect to Chromium directly. Packaged Electron can finish startup before the Node inspector handshake;
 // this exercises a normal signed launch and avoids changing any shipped main-process code for the driver.
 browser=await launchPreparedNative({executablePath:executable(),args:[],env:{...process.env,ACIRA_QA_RUN:'1',ACIRA_BROWSER_TEST_DATA:profile}},async options=>{
  const child=spawn(options.executablePath,options.args,{env:options.env,stdio:['ignore','ignore','pipe']});
  const errors=[];child.stderr.on('data',chunk=>{errors.push(String(chunk));if(errors.length>20)errors.shift();});
  let client,ui;
  try{
   const endpoint=await poll(async()=>{try{const [port]=(await fs.readFile(path.join(profile,'DevToolsActivePort'),'utf8')).trim().split('\n');return (await(await fetch('http://127.0.0.1:'+port+'/json/version')).json()).webSocketDebuggerUrl;}catch{return null;}},Boolean,'Signed app debugging endpoint',40000);
   client=await chromium.connectOverCDP(endpoint);
   const context=client.contexts()[0];ui=await poll(()=>context.pages().find(p=>p.url()==='acira-browser-ui://ui/index.html'),Boolean,'Signed browser UI',40000);
   await poll(()=>ui.evaluate(()=>Boolean(window.acira?.getSnapshot)),Boolean,'Signed browser bridge');
   return {ui,context,endpoint,state:()=>ui.evaluate(()=>window.acira.getSnapshot()),svc:r=>ui.evaluate(r=>window.acira.service(r),r),async close(){try{await ui.evaluate(()=>window.acira.windowControl('close'));}catch{}await client.close().catch(()=>{});if(child.exitCode===null){await sleep(500);if(child.exitCode===null)child.kill('SIGTERM');}}};
  }catch(error){await client?.close().catch(()=>{});if(child.exitCode===null)child.kill('SIGTERM');throw Error(error.message+'\n'+errors.join('').slice(-4000));}
 });
 await check('Installed signed beta supports the real Mac updater',async()=>{const value=(await browser.svc({type:'update.status'})).update;report.before=value;assert.equal(value.version,from);assert(value.supported,JSON.stringify(value));assert.equal(value.channel,'beta');});
 await check('Real local feed downloads the new beta and displays Update plus Restart to update',async()=>{
  await browser.svc({type:'update.check'});
  const value=await poll(async()=>(await browser.svc({type:'update.status'})).update,s=>['ready','error'].includes(s.status),'Native update download',120000);assert.equal(value.status,'ready',JSON.stringify(value));assert.equal(value.available,next.version);report.ready=value;
  await browser.ui.locator('[data-update-pill]').waitFor({state:'visible'});await browser.ui.getByRole('button',{name:'Acira menu',exact:true}).filter({visible:true}).click();const overlay=await poll(()=>browser.context.pages().find(p=>p.url().includes('view=overlay')),Boolean,'Menu overlay');await overlay.getByRole('button',{name:'Restart to update',exact:true}).waitFor({state:'visible'});await overlay.screenshot({path:path.join(out,'beta2-update-ready-menu.png')});await overlay.keyboard.press('Escape');await browser.ui.screenshot({path:path.join(out,'beta2-update-ready-pill.png')});
 });
 await check('Restart to update replaces the signed app and automatically relaunches the new beta',async()=>{
  await browser.ui.locator('[data-update-pill]').click({timeout:10000});
  await poll(async()=>(await packageInfo(installed)).version,v=>v===next.version,'Native Squirrel replaces beta2 bundle',120000);
  await poll(async()=>{try{const [port,endpoint]=(await fs.readFile(path.join(profile,'DevToolsActivePort'),'utf8')).trim().split('\n');const res=await fetch('http://127.0.0.1:'+port+'/json/version');const nextEndpoint=(await res.json()).webSocketDebuggerUrl||'ws://127.0.0.1:'+port+endpoint;return nextEndpoint!==browser.endpoint?nextEndpoint:null;}catch{return null;}},Boolean,'Updated browser relaunches with owned profile',60000).then(async endpoint=>{cdp=await chromium.connectOverCDP(endpoint);});
  restoredPage=await poll(()=>cdp.contexts().flatMap(c=>c.pages()).find(p=>p.url()==='acira-browser-ui://ui/index.html'),Boolean,'Updated browser UI',60000);
  const status=await poll(()=>restoredPage.evaluate(()=>window.acira.service({type:'update.status'})),v=>v?.update?.version===next.version,'Real restarted app version');report.after=status.update;await run('/usr/bin/codesign',['--verify','--deep','--strict',installed]);
 });
 await check('Existing tabs, workspace, settings and profile survive without uninstalling',async()=>{
  const state=await restoredPage.evaluate(()=>window.acira.getSnapshot());assert.equal(state.settings.onboardingComplete,true);assert.equal(state.settings.appearance,'dark');assert(state.workspaces.some(w=>w.name==='Preserved study workspace'));assert(state.tabs.some(t=>t.url==='acira://history'));assert.equal(await fs.readFile(path.join(profile,'sentinel'),'utf8'),'keep existing profile');await restoredPage.screenshot({path:path.join(out,'beta3-after-update.png')});report.preserved={tabs:state.tabs.map(t=>t.url),workspace:state.workspaces.map(w=>w.name),onboardingComplete:state.settings.onboardingComplete};
 });
 report.passed=true;
}catch(e){report.error=String(e.stack||e);process.exitCode=1;}
finally{
 if(restoredPage)try{await restoredPage.evaluate(()=>window.acira.windowControl('close'));}catch{}
 await cdp?.close().catch(()=>{});await browser?.close().catch(()=>{});await fixture.close();
 // Retire only this test's app icons; all source packages and evidence remain.
 for(const app of [installed,payload])try{await run('/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister',['-u',app]);await fs.rename(app,app.replace(/\.app$/,'.bundle'));}catch{}
 await fs.writeFile(path.join(out,'result.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:report.passed,checks:report.checks,error:report.error,out,root}));
}
