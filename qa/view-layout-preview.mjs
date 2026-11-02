// Exercise the actual native popup across live View/Tabs changes, plus caption
// clearance at each interface scale. Alternate OS CSS is renderer-only evidence.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {startApp,poll,sleep,httpFixture} from './d-harness.mjs';
const require=createRequire(import.meta.url),root=path.resolve('.qa-profiles/view-preview-'+Date.now()),out=path.resolve(process.env.VIEW_PREVIEW_OUT||'qa/artifacts/view-preview-'+Date.now());
await fs.mkdir(root,{recursive:true});await fs.mkdir(out,{recursive:true});
const {BrowserDatabase}=require('../desktop/database.cjs'),{createInitialState}=require('../desktop/runtime.cjs');const initial=createInitialState();Object.assign(initial.settings,{onboardingComplete:true,askBeforeClosing:false,reducedMotion:false,language:'en',verticalTabs:false});
const db=new BrowserDatabase(path.join(root,'browser.sqlite'));db.saveWindow('main',initial);db.close();
let app;const report={passed:false,nativePlatform:process.platform,checks:[],geometry:[]};
const fixture=await httpFixture((_q,r)=>{r.setHeader('Content-Type','text/html');r.end('<title>View preview fixture</title><h1>Owned layout preview page</h1>');});
const check=async(name,fn)=>{await fn();report.checks.push(name);console.log('PASS '+name);};
try{
 app=await startApp({root,skipSetup:false,main:path.resolve('qa/mac-interface-entry.cjs'),env:{ACIRA_QA_MAIN:path.resolve(process.argv[2]||'.','desktop/main.cjs'),ACIRA_TEST_QUIET_NETWORK:'1'}});
 await poll(()=>app.ui.evaluate(()=>window.acira.getBrowserLayout()),l=>l?.visible,'Browsing ready',60000);
 await app.act({type:'tab.navigate',url:'http://127.0.0.1:'+fixture.port+'/'});await app.waitWeb('http://127.0.0.1:'+fixture.port+'/');
 await app.ui.getByRole('button',{name:'Acira menu',exact:true}).filter({visible:true}).click();
 const layout=()=>app.ui.evaluate(()=>window.acira.getBrowserLayout());
 const first=await poll(layout,l=>l?.overlay?.kind==='menu','Native menu opened');
 const overlay=await poll(()=>app.context.pages().find(p=>p.url().includes('view=overlay')),Boolean,'Native overlay');
 await overlay.locator('.popup-content-menu').waitFor();await sleep(300);
 await check('One menu stays open through repeated Full, Compact, Seamless and tab-position previews',async()=>{
  for(const motion of [false,true]){
   await app.act({type:'settings.update',patch:{reducedMotion:motion}});
   for(const [label,value] of [['Compact','compact'],['Seamless','seamless'],['Full','full'],['Compact','compact'],['Full','full']]){
    await overlay.getByRole('radiogroup',{name:'View',exact:true}).getByRole('radio',{name:label,exact:true}).click();
    await poll(()=>app.state(),s=>s.settings.windowView===value,'View applied '+value);await sleep(650);
    assert.equal((await layout()).overlay?.id,first.overlay.id,'No close/reopen while previewing '+label);
    assert.equal(await overlay.getByRole('radiogroup',{name:'View',exact:true}).getByRole('radio',{name:label,exact:true}).getAttribute('aria-checked'),'true');
   }
   for(const label of ['Sidebar','Top','Sidebar']){
    await overlay.getByRole('radiogroup',{name:'Tabs',exact:true}).getByRole('radio',{name:label,exact:true}).click();await sleep(650);
    assert.equal((await layout()).overlay?.id,first.overlay.id,'Tabs preview retains menu');
   }
  }
  await overlay.screenshot({path:path.join(out,'view-menu-retained.png')});
 });
 await check('Escape still dismisses the retained popup',async()=>{await overlay.keyboard.press('Escape');await poll(layout,l=>!l?.overlay,'Escape closes popup');});
 // Exercise the toolbar context's four View choices, including Focus.
 await app.cmd({type:'ui',tabId:(await app.state()).activeTabId,action:'open',kind:'toolbar-context'});
 await poll(layout,l=>l?.overlay?.kind==='toolbar-context','Toolbar menu');const contextId=(await layout()).overlay.id;
 await check('Toolbar View choices including Focus retain their popup; outside click dismisses it',async()=>{
  for(const [label,value] of [['Compact','compact'],['Focus','focus'],['Seamless','seamless'],['Full','full']]){
   await overlay.locator('.popup-content-toolbar-context').getByRole('menuitemradio',{name:new RegExp('^'+label+'(?:$|\\s)')}).click();await poll(()=>app.state(),s=>s.settings.windowView===value,'Context view applied');await sleep(600);assert.equal((await layout()).overlay?.id,contextId);
  }
  await overlay.mouse.click(400,Math.min(800,(await overlay.evaluate(()=>innerHeight))-10));await poll(layout,l=>!l?.overlay,'Outside click closes menu');
 });
 for(const platform of ['darwin','win32'])for(const scale of [80,90,100,110,125,150])for(const verticalTabs of [false,true])for(const view of ['full','compact','focus']){
  await app.ui.evaluate(p=>document.documentElement.dataset.platform=p,platform);await app.act({type:'settings.update',patch:{interfaceScale:scale,verticalTabs,windowView:view,reducedMotion:true}});await app.act({type:'ui.update',patch:{workspaceOpen:false,webWorkspaceOpen:false}});await app.ui.mouse.move(600,400);await app.ui.locator('.address-bar input').blur();await sleep(300);
  const geometry=await app.ui.evaluate(()=>{const row=document.querySelector('.acira-persistent-toolbar'),shell=document.querySelector('.browser-shell'),controls=[...document.querySelectorAll('.acira-shell button,.acira-shell input')].filter(n=>{const b=n.getBoundingClientRect();return b.width>0&&b.height>0&&!n.closest('[hidden],[inert]')&&b.top<32&&getComputedStyle(n).visibility!=='hidden';}).map(n=>({name:n.getAttribute('aria-label'),...n.getBoundingClientRect().toJSON()}));return{padding:getComputedStyle(row).paddingLeft,layout:shell.dataset.layout,controls};});
  report.geometry.push({platform,scale,verticalTabs,view,...geometry});
  if(platform==='darwin')for(const control of geometry.controls)assert(control.x*scale/100>=85,JSON.stringify({platform,scale,verticalTabs,view,control,padding:geometry.padding}));
 }
 report.checks.push('72 closed-sidebar layout/scale cases measured; Mac controls clear native buttons, Windows renderer stays within shared layouts');
 await app.ui.evaluate(()=>document.documentElement.dataset.platform='darwin');await app.act({type:'settings.update',patch:{interfaceScale:100,verticalTabs:true,windowView:'compact'}});await app.ui.screenshot({path:path.join(out,'mac-compact-sidebar-closed.png')});report.passed=true;
}catch(e){report.error=String(e.stack||e);process.exitCode=1;}
finally{if(app)try{await app.ui.screenshot({path:path.join(out,'last.png')});}catch{}await app?.close();await fixture.close();await fs.writeFile(path.join(out,'result.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:report.passed,checks:report.checks,error:report.error,out}));}
