import {completeLocalSetup} from './release-local-setup.mjs';
import {initializeReleaseProfile} from './release-initialize-profile.mjs';
import {_electron} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import http from 'node:http';
import {poll,nativePage} from './native-helpers.mjs';
import {createHash} from 'node:crypto';
import {verifyRuntimePolicy} from '../scripts/release-runtime-policy.mjs';
const folder=path.resolve(process.argv[2]||''),executable=path.join(folder,'AciraBrowser.exe');
const provenance=JSON.parse(await fs.readFile(path.join(folder,'ACIRA-PROVENANCE.json'),'utf8'));
const output=path.resolve('qa/artifacts','release-package-'+Date.now()+'.json'),data=path.resolve('.qa-profiles','release-package-'+Date.now());await fs.mkdir(data,{recursive:true});
const report={schema:1,createdAt:new Date().toISOString(),sourceDigest:provenance.sourceDigest,executable:path.basename(executable),checks:[],limitations:['Hidden ordinary package launch through Playwright debugger; visible window geometry/default-browser registration, installer and updater remain unqualified. No Acira signature. Windows product resources are verified separately.']};
const server=http.createServer((_request,response)=>{response.setHeader('Content-Type','text/html');response.end('<!doctype html><title>Packaged browser fixture</title><h1>Packaged browsing works</h1><input id="draft">');});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let app;
try{
  const env={...process.env,ACIRA_QA_RUN:'1',ACIRA_BROWSER_TEST_DATA:data,ACIRA_BROWSER_TEST_HIDDEN:'1',NODE_PATH:'',LOCALAPPDATA:path.join(data,'empty-source-profiles')};delete env.ELECTRON_RUN_AS_NODE;delete env.ACIRA_DEV;
  report.profileInitialization=await initializeReleaseProfile({candidate:path.join(folder,'resources/app'),data,executablePath:executable,packaged:true});
  app=await _electron.launch({executablePath:executable,args:[],cwd:process.env.TEMP||folder,env,timeout:30000});
  const ui=await poll(async()=>app.context().pages().find(page=>page.url()==='acira-browser-ui://ui/index.html'),Boolean,'Packaged UI',15000);await ui.waitForFunction(()=>Boolean(window.acira));
  await ui.locator('#root > *').first().waitFor({state:'visible'});
  const fonts=await ui.evaluate(async()=>{await document.fonts.ready;return [...document.fonts].map(face=>({family:face.family,status:face.status}));});assert.ok(fonts.some(face=>face.status==='loaded'),'Actual packaged UI font must load from its bundled assets');report.fonts=fonts;
  await completeLocalSetup(ui);
  if(provenance.packagingInputs.some(input=>input.file==='scripts/release-shared-sdk.mjs')){
    const profile=await ui.evaluate(async()=>{const state=await window.acira.getSnapshot();return state.browserProfiles.find(profile=>profile.id===state.activeBrowserProfileId);});
    report.sharedNativeSDK=await app.evaluate(({app,session},partition)=>{const path=process.mainModule.require('node:path'),fs=process.mainModule.require('node:fs'),load=process.mainModule.require('node:module').createRequire(path.join(app.getAppPath(),'desktop/main.cjs')),file=load.resolve('electron-chrome-extensions');if(!file.startsWith(path.join(app.getAppPath(),'node_modules')+path.sep))throw new Error('SDK resolved outside packaged application');const sdk=load('electron-chrome-extensions');return {file:path.relative(app.getAppPath(),file),version:JSON.parse(fs.readFileSync(path.join(path.dirname(file),'package.json'),'utf8')).version,runtimeInitialized:!!sdk.ElectronChromeExtensions.fromSession(session.fromPartition(partition))};},profile.partition);
    assert.equal(report.sharedNativeSDK.version,'4.9.0');assert.equal(report.sharedNativeSDK.runtimeInitialized,true,'Canonical packaged SDK must see the initialized native profile runtime');
  }
  const actual=await app.evaluate(({app,BaseWindow})=>({packaged:app.isPackaged,version:app.getVersion(),runtime:{electron:process.versions.electron,chromium:process.versions.chrome,node:process.versions.node},appPath:app.getAppPath(),exe:process.execPath,visible:BaseWindow.getAllWindows().some(win=>win.isVisible()),cached:Object.keys(process.mainModule.require('node:module')._cache)}));
  assert.equal(actual.runtime.electron,provenance.electron,'Actual packaged runtime must match build provenance');const policy=JSON.parse(await fs.readFile(path.resolve('packaging/runtime-security.json'),'utf8'));verifyRuntimePolicy({policy,version:actual.runtime.electron,executableSha256:provenance.runtimeQualification?.upstreamExecutableSha256});const executableHash=createHash('sha256').update(await fs.readFile(executable)).digest('hex'),manifestBytes=await fs.readFile(path.join(folder,'FILES-SHA256.json')),manifest=JSON.parse(manifestBytes.toString('utf8'));assert.equal(executableHash,manifest.files.find(file=>file.file==='AciraBrowser.exe')?.sha256);report.brandedExecutableSha256=executableHash;report.packageManifestSha256=createHash('sha256').update(manifestBytes).digest('hex');
  assert.equal(actual.packaged,true);assert.equal(actual.version,provenance.version);assert.equal(actual.visible,false);assert.equal(path.resolve(actual.exe),executable);assert.equal(path.resolve(actual.appPath),path.join(folder,'resources/app'));
  const packagePrefix=path.resolve(folder).toLowerCase()+path.sep,external=actual.cached.filter(file=>path.isAbsolute(file)&&!path.resolve(file).toLowerCase().startsWith(packagePrefix)&&!file.includes('playwright-core'));assert.deepEqual(external,[],'No production dependency may be loaded from the source checkout');report.actual=actual;
  report.checks.push('Launches own resources/app with packaged version and no source dependency loads');
  const url='http://127.0.0.1:'+server.address().port+'/';await ui.evaluate(url=>window.acira.dispatch({type:'tab.new',url}),url);const page=await nativePage(app,url);await page.getByRole('heading',{name:'Packaged browsing works'}).waitFor();await page.locator('#draft').fill('packaged input');assert.equal(await page.locator('#draft').inputValue(),'packaged input');report.checks.push('Native packaged loopback navigation and typing');
  report.status='PASS';
}catch(error){report.status='FAIL';report.failure=String(error.stack||error);process.exitCode=1;}
finally{await app?.close();server.close();await fs.writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,checks:report.checks,failure:report.failure,output},null,2));}
