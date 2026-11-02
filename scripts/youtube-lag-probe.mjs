import {_electron} from 'playwright';
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';

// Opens YouTube from the address bar a few times in a hidden app on the built interface, and reports what is left on
// screen afterwards (overlay, native views) and how long the interface's main thread stalls while the page loads.
const require=createRequire(import.meta.url),root=process.cwd(),out=path.join(root,'qa/youtube-probe');
const {createInitialState,persistedSnapshot}=require('../desktop/runtime.cjs');
await fs.rm(out,{recursive:true,force:true});await fs.mkdir(out,{recursive:true});
const seed=createInitialState();seed.settings.aiEnabled=true;seed.settings.reducedMotion=false;seed.settings.interfaceScale=100;seed.settings.automaticCompact=false;
const profile=await fs.mkdtemp(path.join(out,'profile-'));
await fs.writeFile(path.join(profile,'demo-state.json'),JSON.stringify(persistedSnapshot(seed)));
const live=process.argv.includes('--live');
const {ACIRA_DEV,...env}=process.env;let app;const results=[];
try{
 app=await _electron.launch({executablePath:require('electron'),args:[path.join(root,'desktop/main.cjs')],env:{...env,...(live?{ACIRA_DEV:'1'}:{}),ACIRA_DEMO_TEST_HIDDEN:'1',ACIRA_DEMO_TEST_DATA:profile}});
 const ui=await app.firstWindow();ui.on('pageerror',e=>results.push({pageerror:e.message}));
 await ui.waitForFunction(()=>window.acira);await ui.waitForTimeout(1500);
 await app.evaluate(({BaseWindow})=>BaseWindow.getAllWindows()[0].setContentSize(1440,900));
 const views=()=>app.evaluate(({BaseWindow})=>BaseWindow.getAllWindows()[0].contentView.children.map(v=>{const b=v.getBounds();return {visible:v.getVisible?v.getVisible():null,w:b.width,h:b.height,url:v.webContents?.getURL?.().slice(0,40)||'(no contents)'};}));
 const stall=ms=>ui.evaluate(async ms=>{let worst=0,last=performance.now();const end=last+ms;while(performance.now()<end){await new Promise(r=>setTimeout(r,16));const now=performance.now();worst=Math.max(worst,now-last-16);last=now;}return Math.round(worst);},ms);
 for(let round=1;round<=5;round++){
  await ui.evaluate(()=>window.acira.dispatch({type:'tab.new'}));await ui.waitForTimeout(600);
  const field=ui.locator('.address-bar input').first();await field.click();await field.fill('');await field.type('youtube.com',{delay:40});
  await ui.waitForTimeout(350);const overlayWhileTyping=(await ui.evaluate(()=>window.acira.getBrowserLayout()))?.overlay?.kind||null;
  await field.press('Enter');
  const worst=await stall(4000);
  const layout=await ui.evaluate(()=>window.acira.getBrowserLayout());
  const shown=(await views()).filter(v=>v.visible!==false&&v.w>0&&v.h>0);
  const active=await ui.evaluate(async()=>{const s=await window.acira.getSnapshot();const t=s?.tabs.find(x=>x.id===s.activeTabId);return t?{url:t.url.slice(0,40),loading:t.loading}:null;});
  results.push({round,overlayWhileTyping,overlayAfter:layout?.overlay?.kind||null,worstStallMs:worst,visibleViews:shown,active});
  console.log(JSON.stringify(results.at(-1)));
 }
}finally{if(app)await app.close().catch(()=>{});await fs.writeFile(path.join(out,'report.json'),JSON.stringify(results,null,2));}
