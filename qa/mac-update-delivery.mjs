// Real electron-updater + native Squirrel delivery between signed Mac beta versions. Signed QA
// copies keep the shipped application code, with a fixture entry point that
// isolates the profile/cache even after Squirrel relaunches without launch env.
//   node qa/mac-update-delivery.mjs <old Acira Browser.app> <next build receipt.json>   the new build is a real build (its mac-widevine-package.json)
//   node qa/mac-update-delivery.mjs <old Acira Browser.app> --next-version 0.1.0-beta.7 the new build is the old one with its version raised (to rehearse before a build exists)
//   ... --app-code <candidate>    both copies run a committed candidate's desktop/ and dist/ (node scripts/release-build-mac-head.mjs qa/artifacts/release-committed-x)
//                                 inside the signed build, so a change to the update flow can be rehearsed before a signed build of it exists (report.appCode names the commit)
// Evidence: result.json also carries what the app did while it quit (quitTrace: app and native updater events, from the copy's own process) and what
// Squirrel's ShipIt was told and did (shipIt: launchAfterInstallation from ShipItState.plist, and whether its log shows the relaunch).
// The channel document the app reads is written by the same code scripts/publish-update.mjs uses (finalizeMacFeed), with local URLs in place of the release URLs.
// Isolation: MAC_UPDATE_ROOT moves everything (copies, profile, fixture home) out of the repository, and ACIRA_QA_ALLOWED_ROOT makes the rig abort unless that
// folder, and the profile the launched app reports as its userData, are really inside it. Nothing here touches ~/Applications, /Applications or the real profile.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {chromium} from 'playwright';
import {poll,sleep,httpFixture} from './d-harness.mjs';
import {launchPreparedNative} from './prepared-native.mjs';
const require=createRequire(import.meta.url),run=promisify(execFile),plist=require('plist'),{writeMacUpdateFeed}=require('../packaging/macos/update-feed.cjs'),{walk}=require('../packaging/macos/install-engine.cjs'),{finalizeMacFeed,serializeFeed,releaseNotes}=require('../packaging/update-publish.cjs');
// No Keychain prompt, ever: every copy this rig starts (the key preparer, the first launch, the copy Squirrel relaunches, a manual relaunch) runs with Chromium's mock keychain.
process.env.ACIRA_QA_MOCK_KEYCHAIN='1';
const given=path.resolve(process.argv[2]),raise=process.argv.indexOf('--next-version'),codeAt=process.argv.indexOf('--app-code');assert.equal(process.platform,'darwin');
const asar=require('@electron/asar');
async function packageInfo(bundle){const plain=path.join(bundle,'Contents/Resources/app/package.json');try{return JSON.parse(await fs.readFile(plain,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;asar.uncacheAll();return JSON.parse(asar.extractFile(path.join(bundle,'Contents/Resources/app.asar'),'package.json').toString());}}
async function expandedApp(bundle,output){const plain=path.join(bundle,'Contents/Resources/app');if(await fs.stat(plain).then(s=>s.isDirectory(),()=>false))return plain;await fs.mkdir(output,{recursive:true});asar.uncacheAll();asar.extractAll(path.join(bundle,'Contents/Resources/app.asar'),output);return output;}
const from=(await packageInfo(given)).version;
const SCALE=Number(process.env.MAC_UPDATE_TIMEOUT_SCALE||1); // a busy Mac starts the signed copies slowly
const id=String(Date.now()),root=path.resolve(process.env.MAC_UPDATE_ROOT||path.join('.qa-profiles','mac-update-'+id)),profile=path.join(root,'profile'),feed=path.join(root,'feed'),installed=path.join(path.resolve(process.env.MAC_UPDATE_APPS||root),'Applications-'+id+'/Acira Browser.app'),payload=path.join(root,'payload/Acira Browser.app'),out=path.resolve(process.env.MAC_UPDATE_OUT||'qa/artifacts/mac-update-'+id);
await Promise.all([fs.mkdir(profile,{recursive:true}),fs.mkdir(feed,{recursive:true}),fs.mkdir(out,{recursive:true})]);
// ShipIt waits for the running app by matching its bundle URL against the request's target with symlinks resolved; a copy started through a
// symlinked folder (a linked .qa-profiles, /tmp) never matches, so ShipIt installs under the running app at once and the relaunch is lost.
// MAC_UPDATE_APPS puts the installed copy on a real path when the rig root has to be linked.
await fs.mkdir(path.dirname(installed),{recursive:true});assert.equal(await fs.realpath(path.dirname(installed)),path.dirname(installed),'Aborting: the installed copy must sit on a path without symlinks (set MAC_UPDATE_APPS to a real folder).');
// The rig never runs outside the folder it was told it may use.
const trace=path.join(profile,'qa-quit-trace.jsonl'),shipItHome=path.join(os.userInfo().homedir,'Library/Caches/computer.acira.qa.updater.'+id+'.ShipIt'); // Squirrel keeps its request and log under the account's own Caches folder
const inside=async(folder,allowed)=>{const base=await fs.realpath(allowed),actual=await fs.realpath(folder);return actual===base||actual.startsWith(base+path.sep);};
const ALLOWED=process.env.ACIRA_QA_ALLOWED_ROOT;
if(ALLOWED){assert(await inside(root,ALLOWED),'Aborting: the rig folder '+root+' is not inside ACIRA_QA_ALLOWED_ROOT '+ALLOWED);assert(await inside(out,ALLOWED),'Aborting: the evidence folder is not inside ACIRA_QA_ALLOWED_ROOT.');}
// --app-code: the signed build with a committed candidate's application code (scripts/release-build-mac-head.mjs: the bundled desktop/ and the built dist/,
// exactly what package-mac-widevine.mjs packages) in place of its own. Runtime, node_modules, resources and version stay the signed build's.
async function withCode(source,candidate){
 const identity=JSON.parse(await fs.readFile(path.join(candidate,'build-identity.json'),'utf8'));assert(identity.committedSource&&identity.stable,'Use a committed, stable candidate (scripts/release-build-mac-head.mjs).');
 const target=path.join(root,'code-source/Acira Browser.app'),resources=path.join(target,'Contents/Resources'),expanded=path.join(resources,'app');
 await fs.mkdir(path.dirname(target),{recursive:true});await fs.cp(source,target,{recursive:true,verbatimSymlinks:true});
 asar.uncacheAll();asar.extractAll(path.join(resources,'app.asar'),expanded);asar.uncacheAll();await fs.rm(path.join(resources,'app.asar'));await fs.rm(path.join(resources,'app.asar.unpacked'),{recursive:true,force:true});
 for(const folder of ['desktop','dist']){await fs.rm(path.join(expanded,folder),{recursive:true,force:true});await fs.cp(path.join(candidate,folder),path.join(expanded,folder),{recursive:true});}
 await require('../packaging/macos/widevine.cjs').sealAsar(target);
 const {checkAsar}=require('./release-asar-loads.cjs'),known=new Set(checkAsar(path.join(source,'Contents/Resources/app.asar')).problems.map(p=>p.file+' '+p.request)); // the signed build's own (unresolvable-by-reading) references
 assert.deepEqual(checkAsar(path.join(resources,'app.asar')).problems.filter(p=>!known.has(p.file+' '+p.request)),[],'the candidate code does not load inside the signed build');
 return {bundle:target,commit:identity.commit,candidate};
}
const code=codeAt>=0?await withCode(given,path.resolve(process.argv[codeAt+1])):null,old=code?code.bundle:given;
// --next-version: the old build with only its version raised (package.json inside app.asar and ACIRA-BUILD.json), so the update can be rehearsed before a real new build exists.
async function raised(version){
 const target=path.join(root,'next-source/Acira Browser.app'),resources=path.join(target,'Contents/Resources'),expanded=path.join(resources,'app');
 await fs.mkdir(path.dirname(target),{recursive:true});await fs.cp(old,target,{recursive:true,verbatimSymlinks:true});
 asar.uncacheAll();asar.extractAll(path.join(resources,'app.asar'),expanded);asar.uncacheAll();await fs.rm(path.join(resources,'app.asar'));await fs.rm(path.join(resources,'app.asar.unpacked'),{recursive:true,force:true});
 for(const file of [path.join(expanded,'package.json'),path.join(resources,'ACIRA-BUILD.json')]){const doc=JSON.parse(await fs.readFile(file,'utf8'));doc.version=version;await fs.writeFile(file,JSON.stringify(doc,null,2)+'\n');}
 await require('../packaging/macos/widevine.cjs').sealAsar(target);
 const build=JSON.parse(await fs.readFile(path.join(resources,'ACIRA-BUILD.json'),'utf8')),signer=require('../desktop/browser-services/mac-distribution-identity.cjs');
 return {version,arch:build.arch,commit:build.commit,appBundle:target,signingIdentity:'Developer ID Application: '+signer.name+' ('+signer.team+')'};
}
const next=raise>=0?await raised(process.argv[raise+1]):JSON.parse(await fs.readFile(path.resolve(process.argv[3]),'utf8'));assert.equal(next.arch,process.arch);
const requests=[],report={appCode:code?{commit:code.commit,candidate:code.candidate}:'the signed build\'s own',passed:false,scope:'Real native updater with isolated signed QA identity/profile bootstrap; application code the signed build\'s own unless appCode names a committed candidate, no mock updater, no public feed changes. Local update test does not qualify notarization or downloaded-file Gatekeeper.',from,to:next.version,commit:next.commit,root,checks:[],requests};let browser,cdp,restoredPage,manual;
const fixture=await httpFixture(async(req,res)=>{requests.push(req.url);try{const name=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname).slice(1);assert(name&&path.basename(name)===name);const file=path.join(feed,name),stat=await fs.stat(file);res.setHeader('Content-Length',stat.size);res.setHeader('Content-Type',name.endsWith('.zip')?'application/zip':'application/yaml');createReadStream(file).pipe(res);}catch{res.writeHead(404);res.end();}});
const base='http://127.0.0.1:'+fixture.port+'/';
const executable=()=>path.join(installed,'Contents/MacOS/AciraBrowser');
const check=async(name,fn)=>{await fn();report.checks.push(name);console.log('PASS '+name);};
async function clone(source,target){
 await fs.mkdir(path.dirname(target),{recursive:true});await fs.cp(source,target,{recursive:true,verbatimSymlinks:true});
 const resources=path.join(target,'Contents/Resources/app'),archived=await fs.access(path.join(target,'Contents/Resources/app.asar')).then(()=>true,()=>false);if(archived)await expandedApp(target,resources);const pkgFile=path.join(resources,'package.json'),pkg=JSON.parse(await fs.readFile(pkgFile,'utf8'));pkg.main='qa-updater-entry.cjs';await fs.writeFile(pkgFile,JSON.stringify(pkg,null,2)+'\n');
 const entry=`'use strict';\nprocess.env.ACIRA_BROWSER_TEST_DATA=${JSON.stringify(profile)};\nprocess.env.ACIRA_BROWSER_TEST_HIDDEN='1';\nprocess.env.ACIRA_TEST_QUIET_NETWORK='1';\nprocess.env.ACIRA_UPDATE_TEST='1';\nprocess.env.ACIRA_UPDATE_FEED=${JSON.stringify(base)};\nrequire('node:os').homedir=()=>${JSON.stringify(path.join(root,'fixture-home'))};\nrequire('node:fs').mkdirSync(require('node:os').homedir(),{recursive:true});\nrequire('electron').app.commandLine.appendSwitch('remote-debugging-port','0');\nrequire('electron').app.commandLine.appendSwitch('use-mock-keychain');\nrequire('./desktop/main.cjs');\n{const trace=event=>{try{require('node:fs').appendFileSync(${JSON.stringify(trace)},JSON.stringify({event,at:Date.now(),pid:process.pid})+'\\n');}catch{}},{app,autoUpdater}=require('electron');trace('start');for(const name of ['before-quit','window-all-closed','will-quit','quit'])app.on(name,()=>trace('app:'+name));for(const name of ['update-downloaded','before-quit-for-update','error'])autoUpdater.on(name,()=>trace('updater:'+name));process.on('exit',()=>trace('exit'));}\nif(!require('node:path').resolve(require('electron').app.getPath('userData')).startsWith(${JSON.stringify(profile)})){console.error('Aborting: userData is not the rig profile');require('electron').app.exit(97);}\n`;
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
 const zip=path.join(feed,'AciraBrowser-'+next.version+'-mac-'+process.arch+'-update.zip');await run('/usr/bin/ditto',['--norsrc','--noextattr','-c','-k','--keepParent',payload,zip]);
 // The document the app reads: written by the publisher's own finalizeMacFeed (name and notes included), pointing at this rig's local server instead of GitHub.
 const written=await writeMacUpdateFeed({output:feed,version:next.version,zip,arch:process.arch}),notes=releaseNotes('- Update rehearsal: tabs and settings stay.\n- The update came from the publisher\'s feed document.');
 await fs.writeFile(written.file,serializeFeed(finalizeMacFeed(await fs.readFile(written.file,'utf8'),{urlFor:name=>base+name,releaseName:'Acira Browser '+next.version,releaseNotes:notes.plain})));report.notesSent=notes.plain;
 const {BrowserDatabase}=require('../desktop/database.cjs'),{createInitialState,reduceBrowser}=require('../desktop/runtime.cjs');let initial=createInitialState();Object.assign(initial.settings,{onboardingComplete:true,reducedMotion:true,language:'en',appearance:'dark'});/* askBeforeClosing keeps its default (on), as people have it: Install now must not stop at "Close Acira?" */initial=reduceBrowser(initial,{type:'tab.new',url:'acira://history'});initial=reduceBrowser(initial,{type:'workspace.create',name:'Preserved study workspace'});const db=new BrowserDatabase(path.join(profile,'browser.sqlite'));db.saveWindow('main',initial);db.close();await fs.writeFile(path.join(profile,'sentinel'),'keep existing profile');
 // Connect to Chromium directly. Packaged Electron can finish startup before the Node inspector handshake;
 // this exercises a normal signed launch and avoids changing any shipped main-process code for the driver.
 browser=await launchPreparedNative({executablePath:executable(),args:['--use-mock-keychain'],env:{...process.env,ACIRA_QA_RUN:'1',ACIRA_BROWSER_TEST_DATA:profile}},async options=>{
  const child=spawn(options.executablePath,options.args,{env:options.env,stdio:['ignore','ignore','pipe']});
  const errors=[];child.stderr.on('data',chunk=>{errors.push(String(chunk));if(errors.length>20)errors.shift();});
  let client,ui;
  try{
   const endpoint=await poll(async()=>{try{const [port]=(await fs.readFile(path.join(profile,'DevToolsActivePort'),'utf8')).trim().split('\n');return (await(await fetch('http://127.0.0.1:'+port+'/json/version')).json()).webSocketDebuggerUrl;}catch{return null;}},Boolean,'Signed app debugging endpoint',40000*SCALE);
   client=await chromium.connectOverCDP(endpoint);
   const context=client.contexts()[0];ui=await poll(()=>context.pages().find(p=>p.url()==='acira-browser-ui://ui/index.html'),Boolean,'Signed browser UI',40000*SCALE);
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
 await check('A check while the update waits leaves it with Squirrel (the 8-hour check, or Settings > Check for updates)',async()=>{
  // Squirrel.Mac must be handed the update once: a second hand-over answered with an error (status 'error': the pill and Install now gone) or staged a second install.
  await poll(async()=>{try{return (await fs.readFile(trace,'utf8')).includes('updater:update-downloaded');}catch{return false;}},Boolean,'Squirrel has the update',60000*SCALE);
  const after=(await browser.svc({type:'update.check'})).update;await sleep(6000*SCALE);const now=(await browser.svc({type:'update.status'})).update;
  const handed=(await fs.readFile(trace,'utf8')).split('\n').filter(line=>line.includes('updater:update-downloaded')||line.includes('updater:error')).length;
  report.recheck={statusAfterCheck:after.status,statusLater:now.status,squirrelEvents:handed};
  assert.equal(now.status,'ready',JSON.stringify(report.recheck));assert.equal(handed,1,'Squirrel was handed the update again: '+JSON.stringify(report.recheck));
 });
 await check('Restart to update replaces the signed app and automatically relaunches the new beta',async()=>{
  // electron-updater reports 'ready' when its own download is done; Squirrel then fetches the same file from a local proxy. MAC_UPDATE_SETTLE_MS waits before the click.
  await sleep(Number(process.env.MAC_UPDATE_SETTLE_MS||0));
  // What a person does: the Update pill opens the one question (Install now / Later / Read more, in the overlay page), and Install now restarts into the update.
  // (Until 31 Oct the pill itself restarted; since then a click on it only opens the popup, so clicking it alone installs nothing.)
  const popup=async()=>{for(const page of browser.context.pages())if(page.url().includes('view=overlay')&&await page.evaluate(()=>Boolean(document.querySelector('.update-popover'))).catch(()=>false))return page;return null;};
  if(!await popup())await browser.ui.locator('[data-update-pill]').click({timeout:10000});
  const ask=await poll(popup,Boolean,'Update popup with Install now',15000*SCALE);await ask.screenshot({path:path.join(out,'beta2-update-popup.png')});
  report.installClickedAt=Date.now();await ask.locator('.update-pop-actions .acira-button-primary').click({timeout:10000});
  await poll(async()=>(await packageInfo(installed)).version,v=>v===next.version,'Native Squirrel replaces beta2 bundle',120000);
  const relaunched=()=>poll(async()=>{try{const [port,endpoint]=(await fs.readFile(path.join(profile,'DevToolsActivePort'),'utf8')).trim().split('\n');const res=await fetch('http://127.0.0.1:'+port+'/json/version');const nextEndpoint=(await res.json()).webSocketDebuggerUrl||'ws://127.0.0.1:'+port+endpoint;return nextEndpoint!==browser.endpoint?nextEndpoint:null;}catch{return null;}},Boolean,'Updated browser relaunches with owned profile',60000*SCALE);
  // Squirrel's ShipIt is meant to start the new copy itself. MAC_UPDATE_ALLOW_MANUAL_RELAUNCH=1 keeps going when it does not (report.automaticRelaunch says so, loudly), to check the rest.
  report.automaticRelaunch=true;
  const endpoint=await relaunched().catch(async error=>{
   if(!process.env.MAC_UPDATE_ALLOW_MANUAL_RELAUNCH)throw error;
   report.automaticRelaunch=false;console.log('NOTE: ShipIt installed the update but did not relaunch Acira; starting the installed copy by hand to check the rest.');
   manual=spawn(executable(),['--use-mock-keychain'],{env:{...process.env,ACIRA_QA_RUN:'1',ACIRA_BROWSER_TEST_DATA:profile},stdio:'ignore'});
   return relaunched();
  });
  for(let attempt=0;;attempt++){try{cdp=await chromium.connectOverCDP(endpoint);break;}catch(error){if(attempt>=6)throw error;await sleep(2000);}} // the relaunched copy can drop the first connection while it is still starting
  restoredPage=await poll(()=>cdp.contexts().flatMap(c=>c.pages()).find(p=>p.url()==='acira-browser-ui://ui/index.html'),Boolean,'Updated browser UI',60000*SCALE);
  const status=await poll(()=>restoredPage.evaluate(()=>window.acira.service({type:'update.status'})),v=>v?.update?.version===next.version,'Real restarted app version');report.after=status.update;await run('/usr/bin/codesign',['--verify','--deep','--strict',installed]);
  assert.match(String(status.update.whatsNew?.notes),/Update rehearsal/,'the release notes of the feed document reached the restarted app');
 });
 await check('Existing tabs, workspace, settings and profile survive without uninstalling',async()=>{
  const state=await restoredPage.evaluate(()=>window.acira.getSnapshot());assert.equal(state.settings.onboardingComplete,true);assert.equal(state.settings.appearance,'dark');assert(state.workspaces.some(w=>w.name==='Preserved study workspace'));assert(state.tabs.some(t=>t.url==='acira://history'));assert.equal(await fs.readFile(path.join(profile,'sentinel'),'utf8'),'keep existing profile');await restoredPage.screenshot({path:path.join(out,'beta3-after-update.png')});report.preserved={tabs:state.tabs.map(t=>t.url),workspace:state.workspaces.map(w=>w.name),onboardingComplete:state.settings.onboardingComplete};
 });
 report.passed=true;
}catch(e){report.error=String(e.stack||e);process.exitCode=1;try{for(const page of browser?.context?.pages()||[])await page.screenshot({path:path.join(out,'failure-'+(page.url().includes('view=overlay')?'overlay':page.url().includes('ui/index.html')?'window':'page')+'.png'),timeout:5000}).catch(()=>{});}catch{}}
finally{
 if(restoredPage)try{await restoredPage.evaluate(()=>window.acira.windowControl('close'));}catch{}
 await cdp?.close().catch(()=>{});await browser?.close().catch(()=>{});if(manual&&manual.exitCode===null){await sleep(1500);if(manual.exitCode===null)manual.kill('SIGTERM');}await fixture.close();
 // Retire only this test's app icons; all source packages and evidence remain.
 for(const app of [installed,payload])try{await run('/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister',['-u',app]);await fs.rename(app,app.replace(/\.app$/,'.bundle'));}catch{}
 try{report.quitTrace=(await fs.readFile(trace,'utf8')).trim().split('\n').map(line=>JSON.parse(line));}catch{}
 try{const state=plist.parse((await run('/usr/bin/plutil',['-convert','xml1','-o','-',path.join(shipItHome,'ShipItState.plist')])).stdout),log=await fs.readFile(path.join(shipItHome,'ShipIt_stderr.log'),'utf8');await fs.writeFile(path.join(out,'ShipIt_stderr.log'),log);report.shipIt={requestWrittenAt:(await fs.stat(path.join(shipItHome,'ShipItState.plist'))).mtimeMs,launchAfterInstallation:state.launchAfterInstallation,installed:/Installation completed successfully/.test(log),relaunchRequested:/Launching new ShipIt/.test(log),relaunched:/Successfully launched application/.test(log)};}catch(error){report.shipIt={unreadable:String(error.message)};}
 const bundleId='computer.acira.qa.updater.'+id,library=path.join(os.userInfo().homedir,'Library');
 for(const folder of [shipItHome,path.join(library,'Caches',bundleId),path.join(library,'HTTPStorages',bundleId),path.join(library,'Preferences',bundleId+'.plist')])await fs.rm(folder,{recursive:true,force:true,maxRetries:5,retryDelay:500}).catch(error=>console.log('NOTE: '+folder+' is still in use ('+error.code+'); remove it after ShipIt finishes')); // this run's own Squirrel folders (ShipIt's, and its download cache: the bundle id is unique to the run); evidence copied above
 await fs.writeFile(path.join(out,'result.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:report.passed,checks:report.checks,error:report.error,out,root}));
}
