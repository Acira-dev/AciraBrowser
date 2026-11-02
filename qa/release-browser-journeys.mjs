import {initializeReleaseProfile} from './release-initialize-profile.mjs';
import {qualifiedElectron} from './release-runtime.mjs';
import {_electron} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {poll,nativePage} from './native-helpers.mjs';
const root=process.cwd(),candidate=path.resolve(process.argv[2]||'qa/artifacts/release-baseline-001');
const identity=JSON.parse(await fs.readFile(path.join(candidate,'build-identity.json'),'utf8'));assert.equal(identity.stable,true);
const reportFile=path.join(candidate,'browser-journeys-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json');
const report={schema:1,createdAt:new Date().toISOString(),candidate:path.relative(root,candidate).replaceAll('\\','/'),commit:identity.commit,sourceDigest:identity.sourceDigest,runtime:{},checks:[],errors:[],limitations:['Local controlled fixtures establish browser mechanics, not consented real-provider OAuth/MFA or production account authentication. Popup visibility is forced hidden by a test bootstrap to preserve the desktop-input stop. No popup layout/focus acceptance is claimed.']};
const data=path.resolve('.qa-profiles','release-'+Date.now());await fs.mkdir(data,{recursive:true});
const server=http.createServer((req,res)=>{
  res.setHeader('Content-Type','text/html; charset=utf-8');
  if(req.url==='/login'){res.setHeader('Set-Cookie',['site_session=ordinary; HttpOnly; SameSite=Lax; Path=/','persistent_login=ordinary; HttpOnly; SameSite=Lax; Path=/; Max-Age=3600']);res.end('<script>opener.postMessage("authenticated", location.origin);window.close()</script>');return;}
  if(req.url.startsWith('/cookie')){res.end('<title>Cookie observation</title><pre id="cookies">'+(req.headers.cookie||'')+'</pre>');return;}
  if(req.url==='/missing'){res.statusCode=404;res.end('<title>Fixture not found</title><h1>404</h1>');return;}
  res.end('<!doctype html><title>Release fixture</title><h1>Ordinary website</h1><input id="draft"><input type="file" id="upload"><button id="popup" onclick="window.open(\'/login\',\'auth\',\'width=400,height=400\')">Sign in</button><a id="link" href="/cookie">Cookie</a><script>addEventListener("message",e=>{if(e.origin===location.origin&&e.data==="authenticated")document.querySelector("h1").textContent="Signed in"})</script>');
});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
let app,ui,expectedProfile,profileB,privatePartition;
const state=page=>page.evaluate(()=>window.acira.getSnapshot());
const dispatch=(page,action)=>page.evaluate(action=>window.acira.dispatch(action),action);
async function start(){
  const env={...process.env,ACIRA_RELEASE_CANDIDATE:candidate,ACIRA_QA_RUN:'1',ACIRA_BROWSER_TEST_DATA:data,ACIRA_BROWSER_TEST_HIDDEN:'1'};delete env.ELECTRON_RUN_AS_NODE;delete env.ACIRA_DEV;
  const selected=await qualifiedElectron();assert.equal(identity.electron,selected.qualification.version,'Rebuild candidate after runtime pin change');report.profileInitialization=await initializeReleaseProfile({candidate,data,executablePath:selected.executablePath});app=await _electron.launch({executablePath:selected.executablePath,args:[path.join(root,'qa/release-hidden-entry.cjs')],env,timeout:30000});
  app.process().stderr?.on('data',chunk=>{report.nativeStderr=(report.nativeStderr||'').slice(-12000)+chunk.toString();});
  ui=await poll(async()=>{for(const page of app.context().pages()){if(page.url()!=='acira-browser-ui://ui/index.html')continue;if(!expectedProfile)return page;try{if((await state(page)).activeBrowserProfileId===expectedProfile)return page;}catch{}}},Boolean,'Original regular-profile browser UI',15000);
  await ui.waitForFunction(()=>Boolean(window.acira));ui.setDefaultTimeout(8000);ui.on('pageerror',error=>report.errors.push(error.message));
  report.runtime=await app.evaluate(()=>({...process.versions}));
}
async function check(name,fn){const started=Date.now();try{const detail=await fn();report.checks.push({name,status:'PASS',durationMs:Date.now()-started,...(detail?{detail}:{})});}catch(error){report.checks.push({name,status:'FAIL',durationMs:Date.now()-started,error:String(error.stack||error)});throw error;}}
async function newTab(page,url){await dispatch(page,{type:'tab.new',url});const native=await nativePage(app,url);await native.waitForLoadState('domcontentloaded');return native;}
try{
  await start();expectedProfile=(await state(ui)).activeBrowserProfileId;
  await check('hidden standalone candidate and account-free first browser',async()=>{
    await ui.locator('#root > *').first().waitFor({state:'visible'});
    assert.equal(await app.evaluate(({BaseWindow})=>BaseWindow.getAllWindows().some(win=>win.isVisible())),false);
    assert.equal(await ui.getByText('Ask Acira',{exact:true}).count(),0);assert.ok((await state(ui)).tabs.length);
  });
  let page;
  await check('loopback address, real form typing and page privilege isolation',async()=>{
    page=await newTab(ui,base+'/');await page.locator('#draft').fill('fixture input');assert.equal(await page.locator('#draft').inputValue(),'fixture input');
    assert.deepEqual(await page.evaluate(()=>({acira:typeof window.acira,node:typeof require,process:typeof process})),{acira:'undefined',node:'undefined',process:'undefined'});
  });
  await check('auth popup opener and shared first-party website session',async()=>{
    await page.locator('#popup').click();await page.getByRole('heading',{name:'Signed in'}).waitFor();
    const observed=await newTab(ui,base+'/cookie');assert.match(await observed.locator('#cookies').innerText(),/site_session=ordinary/);
    assert.equal(await app.evaluate(({BaseWindow})=>BaseWindow.getAllWindows().some(win=>win.isVisible())),false);
  });
  await check('actual upload file input without native desktop picker',async()=>{
    page=await newTab(ui,base+'/?upload');const file=path.join(data,'fixture-upload.txt');await fs.writeFile(file,'isolated release fixture');await page.locator('#upload').setInputFiles(file);assert.equal(await page.locator('#upload').evaluate(el=>el.files[0].name),'fixture-upload.txt');
  });
  await check('profile-specific bookmark and website cookie isolation',async()=>{
    await dispatch(ui,{type:'bookmark.toggle',url:base+'/saved'});await dispatch(ui,{type:'browser.profile.create',name:'Isolated fixture'});profileB=(await state(ui)).browserProfiles.find(profile=>profile.id!==expectedProfile);assert.ok(profileB);
    await dispatch(ui,{type:'browser.profile.select',id:profileB.id});
    const second=await poll(async()=>{for(const p of app.context().pages()){if(p===ui||p.url()!=='acira-browser-ui://ui/index.html')continue;try{if((await state(p)).activeBrowserProfileId===profileB.id)return p;}catch{}}},Boolean,'Second profile UI');
    const secondPage=await newTab(second,base+'/cookie?profile-b');
    assert.equal(await secondPage.evaluate(()=>document.cookie.includes('site_session')),false);
    const sessionCookie=await app.evaluate(async({session},partition)=>session.fromPartition(partition).cookies.get({name:'site_session'}),profileB.partition);assert.equal(sessionCookie.length,0);
    assert.equal((await state(second)).bookmarks.includes(base+'/saved'),false);
    return {profileA:expectedProfile,profileB:profileB.id};
  });
  await check('private teardown erases cookies, seals the old partition and opens a fresh private store',async()=>{
    await ui.evaluate(()=>window.acira.openWindow('private'));
    const privateUI=await poll(async()=>{for(const p of app.context().pages()){if(p.url()!=='acira-browser-ui://ui/index.html')continue;try{if((await state(p)).browserProfiles[0]?.private)return p;}catch{}}},Boolean,'Private UI');
    const privateState=await state(privateUI);privatePartition=privateState.browserProfiles[0].partition;assert.equal(privatePartition.startsWith('persist:'),false);assert.equal(privateState.bookmarks.length,0);assert.equal(privateState.browsingHistory.length,0);
    const privatePage=await newTab(privateUI,base+'/?private-marker');await privatePage.evaluate(()=>{document.cookie='private_fixture=yes; Path=/';localStorage.setItem('private-fixture','yes');});
    await privateUI.evaluate(()=>window.acira.windowControl('close'));await poll(async()=>!app.context().pages().includes(privateUI),Boolean,'Private closed');
    await poll(()=>app.evaluate(async({session},partition)=>(await session.fromPartition(partition).cookies.get({})).length,privatePartition),value=>value===0,'Private cookies erased');
    const retiredProbe=await app.evaluate(async({WebContentsView},{partition,url})=>{const probe=new WebContentsView({webPreferences:{partition,contextIsolation:true,nodeIntegration:false,sandbox:true}});try{try{await probe.webContents.loadURL(url);return {blocked:false};}catch(error){return {blocked:error.code==='ERR_BLOCKED_BY_CLIENT'||String(error.message).includes('ERR_BLOCKED_BY_CLIENT'),code:error.code};}}finally{probe.webContents.close({waitForBeforeUnload:false});}},{partition:privatePartition,url:base+'/?private-storage-check'});assert.equal(retiredProbe.blocked,true,'A retired native private partition must remain network-sealed');
    await ui.evaluate(()=>window.acira.openWindow('private'));
    const freshPrivateUI=await poll(async()=>{for(const p of app.context().pages()){if(p.url()!=='acira-browser-ui://ui/index.html')continue;try{if((await state(p)).browserProfiles[0]?.private)return p;}catch{}}},Boolean,'New independent private UI');
    const freshProfile=(await state(freshPrivateUI)).browserProfiles[0];assert.notEqual(freshProfile.partition,privatePartition,'Never reopen a retired private partition');
    const freshPrivatePage=await newTab(freshPrivateUI,base+'/?fresh-private-store');assert.equal(await freshPrivatePage.evaluate(()=>localStorage.getItem('private-fixture')),null);assert.equal(await freshPrivatePage.evaluate(()=>document.cookie.includes('private_fixture=')),false);
    await freshPrivateUI.evaluate(()=>window.acira.windowControl('close'));await poll(async()=>!app.context().pages().includes(freshPrivateUI),Boolean,'Fresh private closed');
  });
  await check('session flush and graceful relaunch retain website login and normal tabs',async()=>{
    await newTab(ui,base+'/cookie?relaunch');await app.close();app=null;await start();
    report.relaunchProfile={expected:expectedProfile,actual:(await state(ui)).activeBrowserProfileId};assert.equal(report.relaunchProfile.actual,expectedProfile,'Cookie recovery must be observed in its original profile');const observed=await newTab(ui,base+'/cookie?after-relaunch');const cookieHeader=await observed.locator('#cookies').innerText();report.relaunchCookies={persistent:cookieHeader.includes('persistent_login=ordinary'),session:cookieHeader.includes('site_session=ordinary')};assert.equal(report.relaunchCookies.persistent,true,'Persistent website login cookie must survive relaunch');assert.equal(report.relaunchCookies.session,true,'Website session cookie must survive session restoration');
    const snapshot=await state(ui);assert.ok(snapshot.tabs.some(tab=>tab.url===base+'/cookie?relaunch'));assert.equal(snapshot.tabs.some(tab=>tab.url.includes('private-marker')),false);
  });
}catch(error){report.failure=String(error.stack||error);if(app)try{report.nativeContents=await app.evaluate(({webContents})=>webContents.getAllWebContents().map(wc=>({id:wc.id,url:wc.getURL(),loading:wc.isLoading()})));}catch{}process.exitCode=1;}
finally{
  await app?.close();server.close();
  report.status=report.failure?'FAIL':'PASS';report.finishedAt=new Date().toISOString();
  await fs.writeFile(reportFile,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({status:report.status,sourceDigest:report.sourceDigest,checks:report.checks.map(({name,status,error})=>({name,status,...(error?{error}: {})})),failure:report.failure,nativeStderr:report.nativeStderr,nativeContents:report.nativeContents,report:reportFile},null,2));
}
