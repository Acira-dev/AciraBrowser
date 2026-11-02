// Actual mounted search entry points; public domains are intercepted inside the
// disposable test browser. This verifies routing, not Google's ranking/content.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {startApp,poll} from './d-harness.mjs';
const candidate=process.argv[2]?path.resolve(process.argv[2]):process.cwd(),out=path.resolve(process.env.SEARCH_ROUTING_OUT||'qa/artifacts/mac-search-routing-'+Date.now());await fs.mkdir(out,{recursive:true});
const report={passed:false,candidate,checks:[],rendererErrors:[],scope:'Actual Mac main and mounted address/new-tab/command controls in a disposable profile. HTTPS website responses are owned intercepted fixtures; no public Google ranking/translation claim.'};let app;
const check=async(name,fn)=>{await fn();report.checks.push({name,result:'passed'});console.log('PASS '+name);};
const active=async()=>{const s=await app.state();return s.tabs.find(t=>t.id===s.activeTabId);};
const expectURL=async(text,origin='https://www.google.com')=>{const tab=await poll(active,t=>{try{const u=new URL(t.url);return u.origin===origin&&u.searchParams.get(origin.includes('google')?'q':'text')===text;}catch{return false;}},'Search destination');const u=new URL(tab.url);if(origin.includes('google')){assert.equal(u.searchParams.get('hl'),'en');assert.equal(u.searchParams.get('lr'),'lang_en');}return u;};
const address=()=>app.ui.getByRole('combobox',{name:'Address and search',exact:true});
try{
 app=await startApp({root:path.resolve('.qa-profiles/mac-search-routing-'+Date.now()),main:path.resolve('qa/mac-interface-entry.cjs'),env:{ACIRA_QA_MAIN:path.join(candidate,'desktop/main.cjs'),ACIRA_BROWSER_TEST_HIDDEN:'1'}});
 await app.context.route('https://**/*',route=>route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:'<!doctype html><title>Owned search fixture</title><h1>Owned search destination</h1>'}));
 app.context.on('page',p=>p.on('pageerror',e=>report.rendererErrors.push(e.message)));
 const engines=[{id:'google',name:'Google',keyword:'g',template:'https://www.google.com/search?q=%s&hl=en&lr=lang_en'},{id:'work',name:'Work search',keyword:'work',template:'https://search.fixture.test/find?text=%s&lang=de'}];
 await app.act({type:'settings.update',patch:{searchProviders:{defaultId:'google',engines},askBeforeClosing:false,reducedMotion:true}});
 await check('Address Enter preserves Google results language with suggestions disabled',async()=>{await app.act({type:'settings.update',patch:{addressSuggestions:false}});await address().fill('youtube');await address().press('Enter');await expectURL('youtube');});
 await check('Default native suggestion preserves Google results language and literal Unicode query',async()=>{await app.act({type:'settings.update',patch:{addressSuggestions:true}});await address().fill('café & tea');await address().press('Enter');await expectURL('café & tea');});
 await check('Alt+Enter opens a new tab using the same configured Google template',async()=>{const count=(await app.state()).tabs.length;await address().fill('youtube music');await address().press('Alt+Enter');await expectURL('youtube music');assert.equal((await app.state()).tabs.length,count+1);});
 await check('New-tab search uses the saved Google result language',async()=>{await app.act({type:'tab.new'});const field=app.ui.locator('.nt-search input');await field.fill('youtube videos');await field.press('Enter');await expectURL('youtube videos');});
 await check('Command search uses the saved Google result language',async()=>{await app.cmd({type:'ui',tabId:(await active()).id,action:'open',kind:'palette'});const overlay=await poll(()=>app.context.pages().find(p=>p.url()==='acira-browser-ui://ui/index.html?view=overlay'),Boolean,'Command popup');const field=overlay.getByRole('textbox',{name:'Search tabs, history and commands',exact:true});await field.fill('youtube tutorial');await field.press('Enter');await expectURL('youtube tutorial');});
 await check('Explicit Google URLs keep the chosen French language without added English filter',async()=>{const url='https://www.google.com/search?q=chats&hl=fr';await address().fill(url);await address().press('Enter');await poll(active,t=>t.url===url,'Explicit URL retained');});
 await check('Custom shortcut targets its configured engine rather than the legacy Google default',async()=>{await address().fill('!work café');await address().press('Enter');const u=await expectURL('café','https://search.fixture.test');assert.equal(u.searchParams.get('lang'),'de');});
 await check('A profile-specific custom provider is used by ordinary address Enter',async()=>{
  await app.act({type:'browser.profile.create',name:'Owned Work'});const s=await app.state(),work=s.browserProfiles.find(p=>p.name==='Owned Work');assert(work);
  await app.act({type:'browser.profile.settings',id:work.id,patch:{searchProviderId:'work'}});await app.act({type:'browser.profile.select',id:work.id});
  // Native profile selection opens that profile's own window. Do not keep
  // typing into the original profile's UI after requesting the switch.
  const ui=await poll(async()=>{for(const p of app.context.pages())if(p!==app.ui&&p.url()==='acira-browser-ui://ui/index.html')try{if((await p.evaluate(()=>window.acira.getSnapshot())).activeBrowserProfileId===work.id)return p;}catch{}},Boolean,'Work profile window');
  await ui.locator('.nt-workspace-profile').waitFor();const field=ui.getByRole('combobox',{name:'Address and search',exact:true});await field.fill('work notes');await field.press('Enter');
  const saved=await poll(()=>ui.evaluate(()=>window.acira.getSnapshot()),s=>s.tabs.some(t=>t.url==='https://search.fixture.test/find?text=work%20notes&lang=de'),'Work search route');assert.equal(saved.activeBrowserProfileId,work.id);
 });
 assert.deepEqual(report.rendererErrors,[]);report.passed=true;
}catch(e){report.error=String(e.stack||e);process.exitCode=1;}
finally{if(app){report.lastTab=await active().catch(()=>null);await app.ui.screenshot({path:path.join(out,'last-ui.png')}).catch(()=>{});}await app?.close();await fs.writeFile(path.join(out,'result.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));}
