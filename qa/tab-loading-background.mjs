// Background tabs show the loading dot matrix in every tab layout (sidebar, horizontal strip, compact strip) while
// their page loads, and their favicon once it has loaded; the current tab stays where it is the whole time.
// Three tabs open in the background on a local server that answers after 3 s: two through "open in new tab"
// (tab.new background), one through a real Ctrl+click on a link in the current page (synthetic input to the page
// only: the OS cursor never moves). Then a background tab is reloaded. capturePage of the interface view at each step.
//   node qa/r4-slot-run.mjs qa/tab-loading-background.mjs
// Profile under .qa-profiles (a junction to C:\ae\r5\loading\profiles on the coordinator machine); evidence to
// ACIRA_QA_EVIDENCE or qa/artifacts/tab-loading-<time>.
import {launchPreparedNative} from './prepared-native.mjs';
import fs from 'node:fs/promises';import path from 'node:path';import http from 'node:http';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {poll,nativePage} from './native-helpers.mjs';
const require=createRequire(import.meta.url),{BrowserDatabase}=require('../desktop/database.cjs'),{createInitialState}=require('../desktop/runtime.cjs');
const stamp=Date.now(),data=path.resolve('.qa-profiles/tab-loading-'+stamp),out=path.resolve(process.env.ACIRA_QA_EVIDENCE||'qa/artifacts/tab-loading-'+stamp);
await fs.mkdir(data,{recursive:true});await fs.mkdir(out,{recursive:true});
const DELAY=3000,colors=['#d94f4f','#3f8f5a','#3d6fd6','#c08a1e'];
const server=http.createServer((req,res)=>{const url=new URL(req.url,'http://x');const icon=url.pathname.match(/^\/icon-(\d)\.svg$/);
 if(icon){res.writeHead(200,{'content-type':'image/svg+xml','cache-control':'no-store'});res.end(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" rx="3" fill="${colors[+icon[1]%colors.length]}"/></svg>`);return;}
 const page=url.pathname.match(/^\/(slow|home)\/?(\d)?$/);if(!page){res.writeHead(404);res.end();return;}
 const n=+(page[2]||0),body=`<!doctype html><title>${page[1]==='home'?'Home page':'Slow page '+n}</title><link rel="icon" href="/icon-${n}.svg"><body style="font:16px system-ui;margin:0;padding:24px"><h1>${page[1]==='home'?'Home':'Slow '+n}</h1><a id="link" href="/slow/3" style="display:inline-block;padding:20px 40px;background:#ddd">Slow 3</a></body>`;
 setTimeout(()=>{res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});res.end(body);},page[1]==='slow'?DELAY:0);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
const seed=createInitialState();seed.tabs[0]={...seed.tabs[0],url:origin+'/home/0',contentKind:'web',title:'Home page',history:[origin+'/home/0'],historyIndex:0};seed.settings={...seed.settings,verticalTabs:true,windowView:'full',reducedMotion:false};
const db=new BrowserDatabase(path.join(data,'browser.sqlite'));db.saveWindow('main',seed);db.close();
const report={origin,checks:[],captures:[],rows:{}};let app,ui;
const capture=async name=>{const file=path.join(out,name+'.png');const png=await app.evaluate(async({webContents})=>{const wc=webContents.getAllWebContents().find(item=>item.getURL()==='acira-browser-ui://ui/index.html');const image=await wc.capturePage();return image.toPNG().toString('base64');});await fs.writeFile(file,Buffer.from(png,'base64'));report.captures.push(file);return file;};
// The dots move, so one capture can land on a dim moment: a strip of 6 crops of the tab rows, 90 ms apart, while loading.
const frames=async name=>{const crops=await app.evaluate(async({webContents},vertical)=>{const wc=webContents.getAllWebContents().find(item=>item.getURL()==='acira-browser-ui://ui/index.html'),list=[];for(let i=0;i<6;i++){const image=await wc.capturePage(),{width,height}=image.getSize(),rect=vertical?{x:0,y:0,width:Math.round(width*.2),height:Math.round(height*.26)}:{x:0,y:0,width:Math.round(width*.8),height:Math.round(height*.1)};list.push(image.crop(rect).toPNG().toString('base64'));await new Promise(r=>setTimeout(r,90));}return list;},name==='sidebar');for(const [i,png] of crops.entries()){const file=path.join(out,`${name}-1-loading-frame${i+1}.png`);await fs.writeFile(file,Buffer.from(png,'base64'));report.captures.push(file);}};
// Which rows show the loading matrix and which show a site icon, read from the interface DOM per layout.
const rows=()=>ui.evaluate(()=>{const read=(row,title,icon)=>{const name=row.querySelector(title)?.textContent?.trim()||row.getAttribute('aria-label')||'';const box=row.querySelector(icon)||row;return {name,dots:!!box.querySelector('canvas.dot-matrix[data-preset="loader"],canvas.dot-matrix[data-preset="pulse"]')};};
 const sidebar=[...document.querySelectorAll('.sb-tab')].map(row=>read(row,'.sb-tab-title-text','.sb-tab-icon'));
 // The compact row and the horizontal strip are told apart by their own tab class; only rows on screen count.
 const compact=document.querySelector('.acira-compact-tabs')?.getBoundingClientRect().width>0;
 const strip=[...document.querySelectorAll(compact?'.acira-compact-tab[role="tab"]':'[role="tab"]:not(.acira-compact-tab)')].filter(row=>!row.closest('.sb-tab')&&row.getBoundingClientRect().width>0).map(row=>read(row,'.never',':scope'));
 return {compact,sidebar,strip,state:window.__qaState?{active:window.__qaState.activeTabId,tabs:window.__qaState.tabs.map(t=>({id:t.id,title:t.title,loading:t.loading,progress:t.progress,sleeping:!!t.sleeping}))}:null};});
const tabsState=()=>ui.evaluate(()=>window.__qaState);
const slowTabs=async()=>(await tabsState()).tabs.filter(t=>/\/slow\//.test(t.url));
try{
 app=await launchPreparedNative({args:[path.resolve('desktop/main.cjs')],env:{...process.env,ACIRA_QA_RUN:'1',ACIRA_BROWSER_TEST_DATA:data}});app.context().setDefaultTimeout(10000); ui=await nativePage(app,'acira-browser-ui://ui/index.html');await ui.waitForFunction(()=>Boolean(window.acira));
 // Off screen, never focused, ignoring the mouse: the founder's cursor and focus are left alone.
 await app.evaluate(({BaseWindow})=>{const w=BaseWindow.getAllWindows()[0];w.setFocusable(false);w.setIgnoreMouseEvents(true);w.setPosition(-20000,-20000);w.setSize(1200,760);w.showInactive();});
 await ui.evaluate(()=>{window.__qaState=null;window.__qaActive=[];window.acira.subscribe(state=>{if(state.activeTabId!==window.__qaState?.activeTabId)window.__qaActive.push({at:Math.round(performance.now()),id:state.activeTabId,tabs:state.tabs.map(t=>t.id.slice(0,8)+':'+t.url.slice(-6))});window.__qaState=state;});});
 await ui.evaluate(()=>window.acira.dispatch({type:'tick'})).catch(()=>{});
 await poll(async()=>(await tabsState())?.tabs?.[0]?.loading===false&&(await tabsState()).tabs[0].title==='Home page',Boolean,'home page loaded',20000);
 const homeId=(await tabsState()).activeTabId;
 for(const layout of [{name:'sidebar',patch:{verticalTabs:true,windowView:'full'}},{name:'horizontal',patch:{verticalTabs:false,windowView:'full'}},{name:'compact',patch:{verticalTabs:false,windowView:'compact'}}]){
  await ui.evaluate(patch=>window.acira.dispatch({type:'settings.update',patch}),layout.patch);await ui.waitForTimeout(700);
  // Close slow tabs from the previous layout, then open three in the background.
  for(const tab of await slowTabs())await ui.evaluate(id=>window.acira.dispatch({type:'tab.close',id}),tab.id);
  await ui.waitForTimeout(300);
  for(const n of [1,2])await ui.evaluate(({url,homeId})=>window.acira.dispatch({type:'tab.new',url,background:true,afterId:homeId}),{url:`${origin}/slow/${n}`,homeId});
  // A real Ctrl+click on the link in the current page: pointer moves and clicks go to the page's webContents only.
  // Aimed at the link's own centre once it is laid out; the hover must land (update-target-url) before the click, so at most 3 tries.
  for(let attempt=0;attempt<3&&(await slowTabs()).length<3;attempt++){
   await app.evaluate(async({webContents},home)=>{const wc=webContents.getAllWebContents().find(item=>item.getURL()===home);if(!wc)throw Error('home page contents not found');const box=await wc.executeJavaScript(`(()=>{const r=document.getElementById('link')?.getBoundingClientRect();return r&&r.width?{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}:null})()`);if(!box)return;wc.sendInputEvent({type:'mouseMove',x:box.x-4,y:box.y});await new Promise(r=>setTimeout(r,120));wc.sendInputEvent({type:'mouseMove',...box});await new Promise(r=>setTimeout(r,400));wc.sendInputEvent({type:'mouseDown',...box,button:'left',clickCount:1,modifiers:['control']});wc.sendInputEvent({type:'mouseUp',...box,button:'left',clickCount:1,modifiers:['control']});},origin+'/home/0');
   await poll(async()=>(await slowTabs()).length===3,Boolean,layout.name+': three background tabs',2000).catch(()=>{});
  }
  assert.equal((await slowTabs()).length,3,layout.name+': three background tabs');
  await ui.waitForTimeout(1300);
  const during=await rows();report.rows[layout.name+'-loading']=during;await capture(`${layout.name}-1-loading`);await frames(layout.name);
  const state=await tabsState();assert.equal(state.activeTabId,homeId,layout.name+': the current tab stayed current');
  const own=layout.name==='sidebar'?during.sidebar:during.strip,slowRows=own.filter(row=>/Slow|127\.0\.0\.1/.test(row.name));
  assert.equal(slowRows.length,3,layout.name+': three slow rows '+JSON.stringify(own));assert.ok(slowRows.every(row=>row.dots),layout.name+': dots on every loading row '+JSON.stringify(own));
  assert.ok(!own.find(row=>row.name==='Home page')?.dots,layout.name+': the loaded current tab shows its favicon');
  report.checks.push(layout.name+': dots on all three background loading rows, current tab unchanged');
  await poll(async()=>(await slowTabs()).every(t=>!t.loading&&/^Slow page/.test(t.title)),Boolean,layout.name+': background pages loaded',12000);
  await ui.waitForTimeout(700);const after=await rows();report.rows[layout.name+'-loaded']=after;await capture(`${layout.name}-2-loaded`);
  const afterOwn=(layout.name==='sidebar'?after.sidebar:after.strip).filter(row=>/Slow/.test(row.name));
  assert.equal(afterOwn.length,3,layout.name+': three loaded rows');assert.ok(afterOwn.every(row=>!row.dots),layout.name+': favicons back after loading '+JSON.stringify(afterOwn));
  report.checks.push(layout.name+': favicons back on all three after loading');
  if(layout.name==='sidebar'){
   // A reload of a background tab shows the dots again on that row only.
   const target=(await slowTabs())[0];await ui.evaluate(id=>window.acira.browserCommand({type:'reload',tabId:id}),target.id);await ui.waitForTimeout(1300);
   const reload=await rows();report.rows['sidebar-reload']=reload;await capture('sidebar-3-background-reload');
   const reloading=reload.sidebar.filter(row=>/Slow/.test(row.name));assert.equal(reloading.filter(row=>row.dots).length,1,'one reloading row '+JSON.stringify(reloading));
   await poll(async()=>(await slowTabs()).every(t=>!t.loading),Boolean,'background reload finished',12000);await ui.waitForTimeout(700);
   const settled=await rows();assert.ok(settled.sidebar.every(row=>!row.dots),'favicon back after reload');await capture('sidebar-4-reload-done');
   report.checks.push('sidebar: a background reload shows dots on that row, favicon after');
  }
 }
 report.status='passed';console.log(JSON.stringify({status:report.status,checks:report.checks,captures:report.captures},null,1));
}catch(error){report.status='failed';report.failure=error.message;try{report.rows.failure=await rows();await capture('failure');}catch{}console.error(error.message);process.exitCode=1;}
finally{try{report.activeChanges=await ui?.evaluate(()=>window.__qaActive);}catch{}await fs.writeFile(path.join(out,'result.json'),JSON.stringify(report,null,1));await app?.close().catch(()=>{});server.close();}
