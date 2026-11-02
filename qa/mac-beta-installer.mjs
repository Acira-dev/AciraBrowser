// Actual signed DMG -> native installer -> verified installed bundle -> first run.
// All application replacements and browser data are isolated from the user's app.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createRequire} from 'node:module';
import {launchPreparedNative} from './prepared-native.mjs';
import {startApp,poll,sleep} from './d-harness.mjs';
const require=createRequire(import.meta.url),run=promisify(execFile),{walk}=require('../packaging/macos/install-engine.cjs');
const receipt=JSON.parse(await fs.readFile(path.resolve(process.argv[2]),'utf8'));
assert.equal(process.platform,'darwin');assert.equal(receipt.arch,process.arch,'Run each package on its actual architecture');assert.equal(receipt.installationMode,'native-setup');
const root=await fs.mkdtemp(path.join(os.tmpdir(),'acira-install-native-')),mount=path.join(root,'mounted'),profile=path.resolve('.qa-profiles/installer-'+Date.now()),out=path.resolve(process.env.INSTALLER_QA_OUT||'qa/artifacts/installer-'+Date.now());
await fs.mkdir(mount);await fs.mkdir(profile,{recursive:true});await fs.mkdir(out,{recursive:true});await fs.writeFile(path.join(profile,'profile-sentinel'),'Preserve this disposable profile, tabs and settings.');
const {BrowserDatabase}=require('../desktop/database.cjs'),{createInitialState,reduceBrowser}=require('../desktop/runtime.cjs');let initial=createInitialState();initial=reduceBrowser(initial,{type:'tab.new',url:'acira://history'});Object.assign(initial.settings,{onboardingComplete:false,askBeforeClosing:false});const db=new BrowserDatabase(path.join(profile,'browser.sqlite'));db.saveWindow('main',initial);db.close();
const report={passed:false,source:receipt.commit,arch:receipt.arch,diskImage:receipt.diskImage,testRoot:root,profile,checks:[],attempts:[]};let installer,browser,mounted=false,openedPid;
const check=async(name,fn)=>{await fn();report.checks.push(name);console.log('PASS '+name);};
const bundle=path.join(root,'Applications/Acira Browser.app');
const launch=()=>launchPreparedNative({executablePath:path.join(mount,'Install Acira.app/Contents/MacOS/AciraInstaller'),args:[],env:{...process.env,ACIRA_QA_RUN:'1',ACIRA_BROWSER_TEST_DATA:profile,ACIRA_BROWSER_TEST_HIDDEN:'1',ACIRA_INSTALLER_TEST_MODE:'1',ACIRA_INSTALLER_TEST_ROOT:root},timeout:40000});
try{
 await run('/usr/bin/hdiutil',['attach','-readonly','-nobrowse','-mountpoint',mount,receipt.diskImage]);mounted=true;
 await check('DMG contains the signed custom installer and payload, with no drag/drop browser shortcut',async()=>{assert.deepEqual((await fs.readdir(mount)).filter(n=>!n.startsWith('.')).sort(),['Install Acira.app','READ ME.txt']);await run('/usr/bin/codesign',['--verify','--deep','--strict',path.join(mount,'Install Acira.app')]);});
 for(const attempt of ['fresh-install','upgrade']){
  installer=await launch();await installer.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.setIgnoreMouseEvents(true)));const ui=await installer.firstWindow();await ui.waitForLoadState('domcontentloaded');await poll(()=>ui.evaluate(()=>!!window.aciraInstaller),Boolean,'Native installer bridge');
  await ui.evaluate(()=>{window.__actualProgress=[];window.aciraInstaller.subscribe(s=>window.__actualProgress.push({...s,at:performance.now()}));});
  await ui.getByRole('button',{name:'Install Acira',exact:true}).click();
  await poll(()=>ui.evaluate(()=>window.aciraInstaller.state()),s=>['installing','verifying'].includes(s.phase),'Actual copy/verification progress',60000);await ui.screenshot({path:path.join(out,attempt+'-progress.png')});
  const result=await poll(()=>ui.evaluate(()=>window.aciraInstaller.state()),s=>['done','error','cancelled'].includes(s.phase),'Real installation completes',180000);assert.equal(result.phase,'done',JSON.stringify(result));
  await ui.getByRole('button',{name:'Open Acira',exact:true}).waitFor({state:'visible',timeout:15000});await ui.screenshot({path:path.join(out,attempt+'-done.png')});
  const states=await ui.evaluate(()=>window.__actualProgress);assert(states.some(s=>s.phase==='installing')&&states.some(s=>s.phase==='verifying')&&states.some(s=>s.phase==='committing'));assert(states.every((s,i)=>i===0||s.progress>=states[i-1].progress));assert(states.filter(s=>s.phase!=='done').every(s=>s.progress<1));
  const installed=JSON.parse(await fs.readFile(path.join(root,'installer-data/last-install.json'),'utf8'));assert.equal(installed.commit,receipt.commit);assert.equal(!!installed.backupPath,attempt==='upgrade');if(installed.backupPath)assert.deepEqual(await walk(installed.backupPath),await walk(receipt.appBundle));
  assert.equal(await fs.readFile(path.join(profile,'profile-sentinel'),'utf8'),'Preserve this disposable profile, tabs and settings.');assert.deepEqual(await walk(bundle),await walk(receipt.appBundle));await run('/usr/bin/codesign',['--verify','--deep','--strict',bundle]);
  report.attempts.push({attempt,installed,states});console.log('PASS '+attempt+' reports real work, verifies the exact bundle and preserves the profile');
  if(attempt==='fresh-install'){await ui.getByRole('button',{name:'Close',exact:true}).click();await installer.close().catch(()=>{});installer=null;}else break;
 }
 await check('The installed browser opens first-run setup for a new profile',async()=>{
  process.env.D_APP_EXE=path.join(bundle,'Contents/MacOS/AciraBrowser');browser=await startApp({root:path.resolve('.qa-profiles/installer-new-user-'+Date.now()),skipSetup:false,env:{ACIRA_TEST_QUIET_NETWORK:'1'}});await browser.ui.locator('.setup-dialog').waitFor({state:'visible',timeout:60000});assert.equal((await browser.state()).settings.onboardingComplete,false);await browser.ui.screenshot({path:path.join(out,'installed-browser-setup.png')});await browser.close();browser=null;delete process.env.D_APP_EXE;
 });
 await check('Existing users retain their tabs without repeating setup',async()=>{process.env.D_APP_EXE=path.join(bundle,'Contents/MacOS/AciraBrowser');browser=await startApp({root:profile,skipSetup:false,env:{ACIRA_TEST_QUIET_NETWORK:'1'}});await poll(()=>browser.ui.evaluate(()=>window.acira.getBrowserLayout()),l=>l?.visible,'Existing profile opens browser');assert((await browser.state()).tabs.some(t=>t.url==='acira://history'));assert.equal(await browser.ui.locator('.setup-dialog').count(),0);await browser.close();browser=null;delete process.env.D_APP_EXE;});
 await check('Open Acira launches the installed executable after installation',async()=>{
  const ui=await installer.firstWindow();await ui.getByRole('button',{name:'Open Acira',exact:true}).click();
  openedPid=await poll(async()=>{const ps=(await run('/bin/ps',['-axo','pid=,command='])).stdout;const line=ps.split('\n').find(l=>l.trim().replace(/^\d+\s+/,'')===path.join(bundle,'Contents/MacOS/AciraBrowser'));return line?Number(line.trim().split(/\s+/)[0]):null;},Boolean,'Owned installed browser starts',30000);
  report.openedInstalledPid=openedPid;
 });
 report.passed=true;
}catch(e){report.error=String(e.stack||e);process.exitCode=1;}
finally{
 await browser?.close();try{await installer?.close();}catch{}
 // Only the exact child created by this test is closed; no installed user app is touched.
 if(openedPid)try{process.kill(openedPid,'SIGTERM');await sleep(500);}catch{}
 if(mounted)try{await run('/usr/bin/hdiutil',['detach',mount]);}catch(e){report.detachError=String(e);}
 // Preserve evidence while retiring test application launchers to avoid duplicates.
 for(const name of await fs.readdir(path.join(root,'Applications')).catch(()=>[]))if(name.endsWith('.app'))await fs.rename(path.join(root,'Applications',name),path.join(root,'Applications',name.replace(/\.app$/,'.bundle'))).catch(()=>{});
 await fs.writeFile(path.join(out,'result.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:report.passed,checks:report.checks,error:report.error,out,testRoot:root}));
}
