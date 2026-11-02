// Run only with coordinator's global native lease. All state and traffic are synthetic.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {startApp,httpFixture,poll,sleep} from './d-harness.mjs';

const startedAt=new Date().toISOString(),runId=`${startedAt.replace(/[:.]/g,'-')}-${randomUUID().slice(0,8)}`;
const root=path.resolve(`.qa-profiles/quick-protection-${runId}`),out=path.resolve('qa/artifacts/quick-protection-bookmark',runId);
await fs.mkdir(out,{recursive:true});
let adRequests=0;
let app,fx,url;
const results=[];
const report={schema:1,runId,status:'running',startedAt,target:{mode:process.env.D_APP_EXE?'packaged':'source',requestedExecutable:process.env.D_APP_EXE?path.resolve(process.env.D_APP_EXE):null,sourceMain:process.env.D_APP_EXE?null:path.resolve('desktop/main.cjs'),launches:[]},fixture:{root,url:null,traffic:'loopback HTTP only'},results,captures:[]};
const writeReport=()=>fs.writeFile(path.join(out,'result.json'),JSON.stringify(report,null,2));
const recordLaunch=async phase=>{report.target.launches.push({phase,...await app.main(({app})=>({executable:app.getPath('exe'),appPath:app.getAppPath(),version:app.getVersion(),electron:process.versions.electron,chrome:process.versions.chrome}))});await writeReport();};
await writeReport();
const overlay=()=>app.context.pages().filter(page=>page.url().includes('view=overlay')).at(-1); // the newest overlay page
const close=async()=>{const layout=await app.ui.evaluate(()=>window.acira.getBrowserLayout());if(layout?.overlay)await app.ui.evaluate(id=>window.acira.closeOverlay(id),layout.overlay.id);await sleep(300);};
const visible=selector=>app.ui.locator(selector).filter({visible:true}).first();
// The real native key route: a keyboard event the engine itself delivers to the interface view (Playwright's keyboard.press is a DevTools event, which never reaches the shortcut handler).
const nativeCtrlD=()=>app.main(({BaseWindow})=>{const wc=BaseWindow.getAllWindows()[0].contentView.children[0].webContents;wc.focus();for(const type of ['keyDown','keyUp'])wc.sendInputEvent({type,keyCode:'D',modifiers:['control']});});
const popup=async kind=>{await poll(async()=> (await app.ui.evaluate(()=>window.acira.getBrowserLayout()))?.overlay?.kind,value=>value===kind,kind);await poll(overlay,Boolean,'overlay');const content=overlay().locator(`.popup-content-${kind}`);await poll(()=>content.count(),count=>count>=1,'popup content');await sleep(350);
 // A popup that closed a moment ago may still be leaving (its exit animation); once that ends exactly one copy of the open popup may remain.
 await poll(()=>content.count(),count=>count===1,`one ${kind} dialog (the previous one left the page)`,4000);await content.waitFor();};
const openProtection=async()=>{const direct=visible('[data-protection-trigger]');if(await direct.count())await direct.click();else{await visible('[aria-label="More toolbar buttons"]').click();await poll(overlay,Boolean,'toolbar overflow');await sleep(350);await overlay().getByRole('button',{name:'Ads and trackers',exact:true}).click();}await popup('protection');};
const capture=async name=>{const data=await app.main(async({webContents})=>{const view=webContents.getAllWebContents().find(w=>w.getURL().includes('view=overlay'));return(await view.capturePage()).toPNG().toString('base64');});const file=path.join(out,name+'.png');await fs.writeFile(file,Buffer.from(data,'base64'));report.captures.push({name,path:file,layer:'native overlay webContents'});await writeReport();};
try{
 fx=await httpFixture((req,res)=>{if(req.url.startsWith('/ads/banners/')){adRequests++;res.setHeader('Content-Type','image/svg+xml');res.end('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>');return;}res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Bookmark fixture</title><h1>Local protection fixture</h1><img alt="" src="/ads/banners/fixture.svg">');});
 url=`http://127.0.0.1:${fx.port}/fixture`;report.fixture.url=url;await writeReport();
 app=await startApp({root,env:{ACIRA_BROWSER_TEST_HIDDEN:'0'}});
 await recordLaunch('initial');
 await app.main(({BaseWindow})=>{const win=BaseWindow.getAllWindows()[0];win.setBounds({x:20,y:20,width:1280,height:900});win.show();win.focus();});
 await app.act({type:'settings.update',patch:{language:'en',onboardingComplete:true,appearance:'light'}});
 assert.equal(await visible('.address-star').getAttribute('aria-disabled'),'true');
 assert.match(await visible('.address-star').getAttribute('title'),/Open a website/);
 const original=(await app.state()).bookmarkNodes.length;
 await visible('.address-star').evaluate(node=>node.click());
 assert.equal((await app.state()).bookmarkNodes.length,original);
 await app.act({type:'tab.navigate',url});await app.waitWeb(url);
 await poll(async()=>{const s=await app.state();return s.tabs.find(tab=>tab.id===s.activeTabId)?.loading;},v=>v===false,'fixture loaded');
 await visible('.address-star').click();await popup('bookmark-edit');
 await poll(()=>visible('.address-star').getAttribute('aria-pressed'),v=>v==='true','star selected');
 await overlay().locator('#bm-edit-name').fill('Persisted fixture bookmark');
 await overlay().locator('#bm-edit-name').press('Enter');await close();
 // Exercise the actual native key route after source-freeze alignment lands.
 const savedCount=(await app.state()).bookmarkNodes.filter(node=>node.url===url).length;
 await nativeCtrlD();await popup('bookmark-edit');
 assert.equal((await app.state()).bookmarkNodes.filter(node=>node.url===url).length,savedCount,'Ctrl+D on a saved page edits without removing or duplicating');
 assert.equal(await overlay().locator('#bm-edit-name').inputValue(),'Persisted fixture bookmark','editor receives the persisted record before it opens');
 await close();
 const profileId=(await app.state()).activeBrowserProfileId;
 await app.ui.evaluate(profile=>{localStorage.setItem('acira-toolbar-items:'+profile,JSON.stringify([{id:'protection',visible:true},{id:'vpn',visible:false},{id:'extensions',visible:false},{id:'profile',visible:true},{id:'focus',visible:true}]));window.dispatchEvent(new Event('acira-toolbar-items'));},profileId);
 await visible('[aria-label="Acira menu"]').click();await popup('menu');
 const menuHeight=(await app.ui.evaluate(()=>window.acira.getBrowserLayout())).overlay.contentHeight;
 await overlay().getByRole('button',{name:'Ads and trackers',exact:true}).click();await popup('protection');
 const control=()=>overlay().getByRole('switch',{name:'Block ads and trackers on this site'});
 await control().waitFor();await poll(()=>control().isEnabled(),Boolean,'blocker status');
 assert.equal(await control().getAttribute('aria-checked'),'true');
 assert.ok((await app.svc({type:'privacy.status',tabId:(await app.state()).activeTabId})).privacy.blocked>0,'local ad fixture counted');
 await control().click();await poll(()=>control().getAttribute('aria-checked'),v=>v==='false','blocking disabled');
 const tabId=(await app.state()).activeTabId;
 assert.equal((await app.svc({type:'privacy.status',tabId})).privacy.blocking,false);
 const before=adRequests;await close();await app.cmd({type:'reload',tabId});await poll(()=>adRequests,n=>n>before,'local ad request allowed');
 await visible('[data-protection-trigger]').click();await popup('protection');await poll(()=>control().isEnabled(),Boolean,'status after reload');
 await control().click();await poll(()=>control().getAttribute('aria-checked'),v=>v==='true','blocking enabled');
 assert.equal((await app.svc({type:'privacy.status',tabId})).privacy.blocking,true);
 results.push({check:'menu renderer to native site toggle and returned state',pass:true,menuHeight});
 for(const appearance of ['light','dark'])for(const interfaceScale of [100,150]){
  await close();await app.act({type:'settings.update',patch:{appearance,interfaceScale,verticalTabs:false,toolbarLayout:'expanded'}});await sleep(700);
  // At 150% the window is narrower in interface pixels and the toolbar moves the button into its overflow (More toolbar buttons).
  { const direct = visible('[data-protection-trigger]'); if (await direct.count()) await direct.click(); else { await visible('[aria-label="More toolbar buttons"]').click(); await poll(overlay, Boolean, 'toolbar overflow'); await sleep(350); await overlay().getByRole('button', {name: 'Ads and trackers', exact: true}).click(); } await popup('protection'); }
  await capture(`${appearance}-${interfaceScale}-protection`);
  const overflow=await overlay().locator('.popup-content-protection').evaluate(node=>[...node.querySelectorAll('.acira-menu-title')].some(item=>item.scrollWidth>item.clientWidth+1));
  assert.equal(overflow,false,`${appearance}/${interfaceScale} labels fit`);
 }
 for(const mode of ['compact','sidebar','narrow']){
  await close();await app.act({type:'settings.update',patch:{interfaceScale:100,verticalTabs:mode==='sidebar',toolbarLayout:mode==='compact'?'automatic':'expanded'}});
  await app.main(({BaseWindow},width)=>BaseWindow.getAllWindows()[0].setSize(width,800),mode==='narrow'||mode==='compact'?900:1280);await sleep(700);
  await visible('[aria-label="Acira menu"]').click();await popup('menu');await overlay().getByRole('button',{name:'Ads and trackers',exact:true}).click();await popup('protection');
  assert.equal(await control().isEnabled(),true);await capture(mode+'-protection');
 }
 await close();await app.act({type:'tab.new',privacy:'private',url});await app.waitWeb(url);
 await poll(()=>visible('.address-star').getAttribute('aria-disabled'),v=>v==='true','private bookmark unavailable');
 const privateId=(await app.state()).activeTabId;
 await poll(async()=>{const s=await app.state();return s.tabs.find(t=>t.id===privateId)?.loading;},v=>v===false,'private fixture loaded');
 await visible('[aria-label="Acira menu"]').click();await popup('menu');await overlay().getByRole('button',{name:'Ads and trackers',exact:true}).click();await popup('protection');
 assert.match(await overlay().locator('.protection-identity').innerText(),/private session only/);
 await poll(()=>control().isEnabled(),Boolean,'private blocker status');await control().click();
 await poll(()=>control().getAttribute('aria-checked'),v=>v==='false','private blocking disabled');
 assert.equal((await app.svc({type:'privacy.status',tabId})).privacy.blocking,true,'private exception cannot alter normal profile');
 await close();await app.act({type:'tab.close',id:privateId});await app.act({type:'tab.select',id:tabId});
 await openProtection();await poll(()=>control().isEnabled(),Boolean,'normal blocker status');await control().click();await poll(()=>control().getAttribute('aria-checked'),v=>v==='false','normal exception saved');
 await close();await app.close();app=null;
 app=await startApp({root,env:{ACIRA_BROWSER_TEST_HIDDEN:'0'}});
 await recordLaunch('restart');
 await app.act({type:'settings.update',patch:{verticalTabs:false,toolbarLayout:'expanded'}});
 await poll(async()=>{const s=await app.state();return s.bookmarkNodes.some(node=>node.url===url&&node.title==='Persisted fixture bookmark');},Boolean,'saved bookmark restored');
 await poll(()=>visible('.address-star').getAttribute('aria-pressed'),v=>v==='true','restored selected accent');
 await openProtection();await poll(()=>control().isEnabled(),Boolean,'restored site status');assert.equal(await control().getAttribute('aria-checked'),'false');await control().click();await close();
 await visible('.address-star').click();await popup('bookmark-edit');await overlay().getByRole('button',{name:'Remove',exact:true}).click();
 await poll(()=>visible('.address-star').getAttribute('aria-pressed'),v=>v==='false','removed selected accent');
 await close();await nativeCtrlD();await popup('bookmark-edit');
 assert.ok((await app.state()).bookmarkNodes.some(node=>node.url===url),'native Ctrl+D saves before opening editor');
 await overlay().locator('#bm-edit-name').waitFor();
 assert.equal(await overlay().locator('.bm-edit-note').count(),0,'native shortcut does not flash bookmark removed state');
 results.push({check:'bookmark renderer save/edit, restart, selected state and remove',pass:true});
 report.status='passed';
}catch(error){
 report.status='failed';report.failure={name:error?.name||'Error',message:String(error?.message||error),stack:String(error?.stack||'').slice(0,6000)};
 process.exitCode=1;
}finally{
 try{if(app)await app.close();}catch(error){report.cleanupError=String(error);report.status='failed';process.exitCode=1;}
 try{if(fx)await fx.close();}catch(error){report.fixtureCleanupError=String(error);report.status='failed';process.exitCode=1;}
 report.finishedAt=new Date().toISOString();report.adRequests=adRequests;await writeReport();
 console.log(JSON.stringify({runId,status:report.status,results,artifacts:out,result:path.join(out,'result.json'),...(report.failure?{failure:report.failure.message}:{})}));
}
