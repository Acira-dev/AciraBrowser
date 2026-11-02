import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {_electron} from 'playwright';
import {qualifiedElectron} from './release-runtime.mjs';
import {initializeReleaseProfile} from './release-initialize-profile.mjs';
const candidate=path.resolve(process.argv[2]||''),identity=JSON.parse(await fs.readFile(path.join(candidate,'build-identity.json'),'utf8'));
assert.equal(identity.stable,true);
import {nativePage,poll} from './native-helpers.mjs';
import {startNativeCapture,stopNativeCapture} from './native-capture.mjs';
const require=createRequire(import.meta.url),{BrowserDatabase}=require(path.join(candidate,'desktop/database.cjs')),{createInitialState}=require(path.join(candidate,'desktop/runtime.cjs'));
const stamp=Date.now(),data=path.resolve('.qa-profiles/website-auth-'+stamp),out=path.resolve('qa/artifacts/release-website-auth-'+stamp);
await fs.mkdir(data,{recursive:true});await fs.mkdir(out,{recursive:true});
const db=new BrowserDatabase(path.join(data,'browser.sqlite'));db.saveWindow('main',createInitialState());db.close();
const attempts=[];
const server=http.createServer((request,response)=>{
 response.setHeader('Content-Type','text/html');
 if(request.url.startsWith('/protected')){
  attempts.push({path:request.url,authorized:request.headers.authorization==='Basic '+Buffer.from('fixture-user:fixture-password').toString('base64')});
  if(!attempts.at(-1).authorized){response.writeHead(401,{'WWW-Authenticate':'Basic realm="Controlled website"'});response.end('<title>Unauthorized</title><h1>Cancelled</h1>');return;}
 }
 response.end('<!doctype html><title>Controlled authentication</title><h1>Authorized fixture</h1>');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;let app,ui;
const report={commit:identity.commit,sourceDigest:identity.sourceDigest,checks:[],errors:[],source:{},qualification:'Actual immutable candidate main, trusted renderer form, real controlled 401, isolated initialized-key profile and hidden/unfocusable native window. No personal credentials.'};
for(const file of ['desktop/main.cjs','desktop/preload.cjs','desktop/website-auth.cjs','desktop/website-auth-integration.cjs','src/App.tsx','src/ui/websiteAuthClient.ts'])report.source[file]=identity.source.find(entry=>entry.file===file)?.sha256;
try{
 const runtime=await qualifiedElectron();assert.equal(identity.electron,runtime.qualification.version);report.profileInitialization=await initializeReleaseProfile({candidate,data,executablePath:runtime.executablePath});const env={...process.env,ACIRA_RELEASE_CANDIDATE:candidate,ACIRA_QA_RUN:'1',ACIRA_BROWSER_TEST_DATA:data,ACIRA_BROWSER_TEST_HIDDEN:'1'};delete env.ELECTRON_RUN_AS_NODE;delete env.ACIRA_DEV;app=await _electron.launch({executablePath:runtime.executablePath,args:[path.resolve('qa/release-hidden-entry.cjs')],env,timeout:30000});
 ui=await nativePage(app,'acira-browser-ui://ui/index.html');ui.on('pageerror',error=>report.errors.push(error.message));
 await app.evaluate(({BaseWindow})=>{const win=BaseWindow.getAllWindows()[0];win.setPosition(-20000,-20000);win.showInactive();assertHidden(win);function assertHidden(window){if(window.isFocused()||window.isFocusable())throw Error('Fixture must remain unfocusable');}});
 const act=action=>ui.evaluate(action=>window.acira.dispatch(action),action);
 const snapshot=()=>ui.evaluate(()=>window.acira.websiteAuth({type:'snapshot'}));
 const form=ui.getByRole('dialog',{name:'Sign in to this site'});
 await act({type:'tab.new',url:base+'/protected/first?retained=1#fragment'});await form.waitFor();
 const first=await snapshot();assert.equal(first.requests.length,1);assert.equal(first.requests[0].origin,base);assert.ok(!JSON.stringify(first).includes('retained'));assert.ok(await form.getByText('Controlled website').count());
 assert.equal(await ui.locator('.browser-root').getAttribute('inert'),'');
 const nativeVisible=await app.evaluate(({BaseWindow})=>BaseWindow.getAllWindows()[0].contentView.children.filter(view=>view.webContents&&!view.webContents.getURL().startsWith('acira-browser-ui://')).map(view=>view.getVisible()));assert.deepEqual(nativeVisible,[false]);
 await startNativeCapture(app,ui);await ui.waitForTimeout(100);const frame=(await stopNativeCapture(ui)).at(-1);assert.ok(frame);await fs.writeFile(path.join(out,'trusted-dialog-native.png'),Buffer.from(frame.image,'base64'));
 report.checks.push('Real 401 publishes bounded origin metadata, displays the trusted form, makes controls inert and hides the native website in an actual composed frame');
 const overlay=await nativePage(app,'acira-browser-ui://ui/index.html?view=overlay');
 assert.equal(await overlay.evaluate(async()=>{try{await window.acira.websiteAuth({type:'snapshot'});return false;}catch{return true;}}),true);
 assert.equal(await ui.evaluate(async()=>{try{await window.acira.websiteAuth({type:'snapshot',extra:true});return false;}catch{return true;}}),true);
 report.checks.push('Unrelated internal overlay and extra-field bridge envelopes are rejected');
 await form.getByLabel('Username',{exact:true}).fill('wrong');await form.getByLabel('Password',{exact:true}).fill('wrong');await form.getByRole('button',{name:'Sign in',exact:true}).click();
 await poll(snapshot,next=>next.requests.length===1&&next.requests[0].id!==first.requests[0].id,'Wrong credentials produce a new current request');
 await form.getByLabel('Username',{exact:true}).fill('fixture-user');await form.getByLabel('Password',{exact:true}).fill('fixture-password');await form.getByLabel('Password',{exact:true}).press('Enter');await form.waitFor({state:'hidden'});
 const website=app.context().pages().find(page=>page.url().startsWith(base));await website.getByRole('heading',{name:'Authorized fixture'}).waitFor();assert.equal(await website.evaluate(()=>typeof window.acira),'undefined');
 await poll(()=>ui.evaluate(()=>window.acira.getBrowserLayout()),value=>value.visible===true,'Native website restored after sign-in');
 report.checks.push('Wrong submission retries, correct form Enter authenticates the real page, clears the form, restores native website visibility and leaves the website without a privileged bridge');
 // A separate private session must not inherit the ordinary HTTP authentication cache.
 await ui.evaluate(()=>window.acira.openWindow('private'));await poll(()=>app.context().pages(),pages=>pages.filter(page=>page.url()==='acira-browser-ui://ui/index.html').length===2,'Private main chrome');
 const privateUi=app.context().pages().filter(page=>page.url()==='acira-browser-ui://ui/index.html').find(page=>page!==ui);assert.ok(privateUi);
 await privateUi.evaluate(url=>window.acira.dispatch({type:'tab.new',url}),base+'/protected/private');const privateForm=privateUi.getByRole('dialog',{name:'Sign in to this site'});await privateForm.waitFor();
 const privateState=await privateUi.evaluate(()=>window.acira.websiteAuth({type:'snapshot'}));assert.equal(privateState.requests[0].privateMode,true);assert.equal((await snapshot()).requests.length,0);
 assert.equal((await ui.evaluate(response=>window.acira.websiteAuth({type:'respond',response}),{id:privateState.requests[0].id,action:'submit',username:'fixture-user',password:'fixture-password'})).ok,false);
 await privateForm.getByLabel('Username',{exact:true}).press('Escape');await privateForm.waitFor({state:'hidden'});
 const stale=await privateUi.evaluate(response=>window.acira.websiteAuth({type:'respond',response}),{id:privateState.requests[0].id,action:'cancel'});assert.equal(stale.ok,false);
 report.checks.push('Private native session prompts independently; ordinary-window response cannot answer its ticket; Escape cancels and stale tickets are rejected');
 await privateUi.evaluate(url=>window.acira.dispatch({type:'tab.new',url}),base+'/protected/navigation');await privateForm.waitFor();
 await privateUi.evaluate(()=>window.acira.dispatch({type:'tab.new'}));await privateForm.waitFor({state:'hidden'});
 assert.equal((await privateUi.evaluate(()=>window.acira.websiteAuth({type:'snapshot'}))).requests.length,0);
 report.checks.push('Canonical tab selection reconciles and cancels a stale pending request immediately');
 const publicState=await ui.evaluate(()=>window.acira.getSnapshot());assert.ok(!JSON.stringify(publicState).includes('fixture-password'));assert.deepEqual(report.errors,[]);
 report.checks.push('General browser snapshots contain no submitted credentials; no renderer errors');report.pass=true;
}catch(error){report.pass=false;report.error=String(error.stack||error);throw error;}
finally{await fs.writeFile(path.join(out,'result.json'),JSON.stringify(report,null,2));try{await app?.close();}finally{await new Promise(resolve=>server.close(resolve));}console.log(JSON.stringify({out,...report}));}

