// Native live-document regression: isolated profile, owned local media, test authentication only.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {startApp,httpFixture,poll,sleep} from './d-harness.mjs';
const require=createRequire(import.meta.url),root=path.resolve('.qa-profiles/locked-resume-'+Date.now());
const out=path.resolve(process.env.ACIRA_RESUME_OUT||'qa/artifacts/locked-resume-'+Date.now());
await fs.mkdir(root,{recursive:true});await fs.mkdir(out,{recursive:true});
const report={passed:false,platform:process.platform,checks:[],ratios:[]};let app;
const wav=Buffer.alloc(44+22050*2*90);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(22050,24);wav.writeUInt32LE(44100,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
const requests=[];
const fixture=await httpFixture((req,res)=>{
 if(req.url==='/media.wav'){const range=/bytes=(\d+)-(\d*)/.exec(req.headers.range||'');const start=range?Number(range[1]):0,end=range&&range[2]?Number(range[2]):wav.length-1;res.writeHead(range?206:200,{'Content-Type':'audio/wav','Accept-Ranges':'bytes','Content-Length':end-start+1,...(range?{'Content-Range':`bytes ${start}-${end}/${wav.length}`}:{})});res.end(wav.subarray(start,end+1));return;}
 requests.push(req.url);res.setHeader('Content-Type','text/html');res.end(`<!doctype html><title>Owned resume fixture ${req.url}</title><style>body{margin:0;font:16px system-ui}header{padding:20px;background:#3e6b8c;color:white}.video{width:100%;aspect-ratio:16/9;background:#102e4b;display:grid;place-items:center;color:white}main{padding:30px;height:2500px}textarea{width:80%}@media(max-width:850px){header{background:#825b32}}</style><header>Responsive page fixture</header><div class="video">16:9 responsive content</div><main><button id="play">Play owned audio</button><audio src="/media.wav" loop></audio><textarea id="draft"></textarea></main><script>window.nonce=crypto.randomUUID();window.ticks=0;setInterval(()=>ticks++,50);window.resizes=[];addEventListener('resize',()=>resizes.push([innerWidth,innerHeight]));play.onclick=()=>document.querySelector('audio').play();</script>`);
});
const base='http://127.0.0.1:'+fixture.port;
const {BrowserDatabase}=require('../desktop/database.cjs'),{createInitialState}=require('../desktop/runtime.cjs');const initial=createInitialState();
Object.assign(initial.settings,{onboardingComplete:true,askBeforeClosing:false,verticalTabs:true,reducedMotion:false,animationSpeed:'fast'});Object.assign(initial.windowUi,{workspaceOpen:true,webWorkspaceOpen:true});
const db=new BrowserDatabase(path.join(root,'browser.sqlite'));db.saveWindow('main',initial);db.close();
const check=async(name,fn)=>{await fn();report.checks.push(name);console.log('PASS '+name);};
const secure=r=>app.ui.evaluate(r=>window.acira.secured(r),r);
const native=id=>app.main(({webContents,BaseWindow},id)=>{const wc=webContents.fromId(id);return {exists:!!wc&&!wc.isDestroyed(),debugger:wc?.debugger.isAttached(),views:BaseWindow.getAllWindows().flatMap(w=>w.contentView.children.filter(v=>v.webContents?.id===id).map(v=>({visible:v.getVisible(),bounds:v.getBounds()})))};},id);
try{
 app=await startApp({root,skipSetup:false,main:path.resolve('qa/mac-interface-entry.cjs'),env:{ACIRA_QA_MAIN:path.resolve('desktop/main.cjs'),ACIRA_TEST_QUIET_NETWORK:'1',ACIRA_PASSWORDS_TEST_GATE:'allow',ACIRA_PERF:'1'}});
 await poll(()=>app.ui.evaluate(()=>window.acira.getBrowserLayout()),l=>l?.visible===true,'Browsing ready',60000);
 await app.main(({BaseWindow})=>{const win=BaseWindow.getAllWindows()[0];win.setSize(1280,900);win.showInactive();});
 const home=(await app.state()).activeWorkspaceId;
 await app.act({type:'workspace.create',id:'workspace-11111111-1111-4111-8111-111111111111',name:'Resume'});
 assert.equal((await secure({type:'enable',id:'workspace-11111111-1111-4111-8111-111111111111'})).ok,true);
 await app.act({type:'tab.navigate',url:base+'/private-marker'});
 const p=await app.waitWeb(base+'/private-marker');await p.locator('#play').click();await p.locator('#draft').fill('Unsaved draft retained');
 await poll(()=>p.evaluate(()=>document.querySelector('audio').readyState),n=>n>=2,'Media ready');await p.evaluate(()=>{scrollTo(0,500);document.querySelector('audio').currentTime=13;});await poll(()=>p.evaluate(()=>document.querySelector('audio').currentTime),n=>n>=13,'Media seeks');
 const tabId=(await app.state()).activeTabId;await app.act({type:'tab.new',url:base+'/private-second',background:true});const second=await app.waitWeb(base+'/private-second');await second.waitForLoadState('load');const secondNonce=await second.evaluate(()=>nonce);
 const wcId=await app.main(({webContents},url)=>webContents.getAllWebContents().find(w=>w.getURL()===url).id,base+'/private-marker');
 const before=await p.evaluate(()=>({nonce,ticks,scroll:scrollY,time:document.querySelector('audio').currentTime}));
 await check('lock removes all page metadata and native routing while retaining its live document',async()=>{
  assert.equal((await secure({type:'lock',id:'workspace-11111111-1111-4111-8111-111111111111'})).ok,true);await sleep(400);
  const state=await app.state();assert.ok(!JSON.stringify(state).includes('private-marker'));assert.ok(!state.tabs.some(t=>t.id===tabId));
  const n=await native(wcId);assert.equal(n.exists,true);assert.deepEqual(n.views,[]);assert.equal(n.debugger,true);
  await assert.rejects(app.cmd({type:'snapshot',tabId}));await app.cmd({type:'focus',tabId});assert.deepEqual((await native(wcId)).views,[]);
 });
 await app.main(async({webContents},id)=>{await webContents.fromId(id).debugger.sendCommand('Runtime.evaluate',{expression:'document.querySelector("audio").currentTime=45;document.querySelector("audio").play().catch(()=>{})'});},wcId);report.lockedTicks=[];for(let i=0;i<3;i++){await sleep(500);report.lockedTicks.push(await app.main(async({webContents},id)=>(await webContents.fromId(id).debugger.sendCommand('Runtime.evaluate',{expression:'({ticks,paused:document.querySelector("audio").paused,time:document.querySelector("audio").currentTime,visibility:document.visibilityState})',returnByValue:true})).result.value,wcId));}
 await check('verified unlock preserves DOM, unsaved form, scroll, media time and WebContents identity',async()=>{
  assert.equal((await secure({type:'unlock',id:'workspace-11111111-1111-4111-8111-111111111111'})).ok,true);
  await poll(()=>native(wcId),n=>n.views.some(v=>v.visible),'Resumed native page');
  const after=await p.evaluate(()=>({nonce,ticks,scroll:scrollY,time:document.querySelector('audio').currentTime,paused:document.querySelector('audio').paused,draft:document.querySelector('#draft').value}));
  report.resume={before,after,wcId};console.log(JSON.stringify({before,after,lockedTicks:report.lockedTicks}));assert.equal(after.nonce,before.nonce);assert.equal(after.draft,'Unsaved draft retained');assert.equal(after.scroll,before.scroll);assert.ok(after.time>=before.time&&after.time<before.time+1);assert.equal(after.paused,false);assert.ok(report.lockedTicks.every(sample=>sample.paused),'media stays paused while locked');
  assert.equal(await second.evaluate(()=>nonce),secondNonce);assert.equal(requests.filter(u=>u==='/private-second').length,1);assert.equal(requests.filter(u=>u==='/private-marker').length,1);report.resume={before,after,wcId};
 });
 await check('leaving, returning and quickly locking again do not reload or strand the document',async()=>{
  for(let i=0;i<4;i++){
   await app.act({type:'workspace.select',id:home});await poll(()=>app.state(),s=>!s.workspaces.find(w=>w.id==='workspace-11111111-1111-4111-8111-111111111111').unlocked,'Auto lock');
   await app.act({type:'workspace.select',id:'workspace-11111111-1111-4111-8111-111111111111'});await secure({type:'unlock',id:'workspace-11111111-1111-4111-8111-111111111111'});
   await poll(()=>native(wcId),n=>n.views.some(v=>v.visible),'Visible after return');
  }
  assert.equal(await p.evaluate(()=>nonce),before.nonce);assert.equal(requests.filter(u=>u==='/private-marker').length,1);
 });
 await secure({type:'lock',id:'workspace-11111111-1111-4111-8111-111111111111'});await app.act({type:'workspace.select',id:home});
 await app.act({type:'tab.navigate',url:base+'/responsive'});const responsive=await app.waitWeb(base+'/responsive');await responsive.waitForLoadState('load');
 await check('all interface scales and chrome modes resize websites once without off-window clipping',async()=>{
  for(const scale of [80,100,125,150])for(const view of ['full','compact','focus']){
   await app.act({type:'settings.update',patch:{interfaceScale:scale}});await app.act({type:'ui.update',patch:{view,webWorkspaceOpen:false,workspaceOpen:false}});await sleep(650);
   for(const open of [true,false]){
    await responsive.evaluate(()=>{resizes=[];});const samples=app.main(async({BaseWindow,webContents},url)=>{const rows=[];for(let i=0;i<20;i++){const win=BaseWindow.getAllWindows()[0],view=win.contentView.children.find(v=>v.webContents?.getURL()===url);if(view&&view.getVisible())rows.push({bounds:view.getBounds(),size:win.getContentSize()});await new Promise(r=>setTimeout(r,20));}return rows;},base+'/responsive');await app.act({type:'ui.update',patch:{webWorkspaceOpen:open,workspaceOpen:open}});await sleep(600);const bounds=await samples;for(const row of bounds){assert.ok(row.bounds.x+row.bounds.width<=row.size[0]+1,JSON.stringify(row));assert.ok(row.bounds.y+row.bounds.height<=row.size[1]+1,JSON.stringify(row));}
    const geometry=await responsive.evaluate(()=>({events:resizes,viewport:[innerWidth,innerHeight],ratio:document.querySelector('.video').getBoundingClientRect().width/document.querySelector('.video').getBoundingClientRect().height}));
    assert.ok(geometry.events.length<=2,JSON.stringify({scale,view,open,...geometry}));assert.ok(Math.abs(geometry.ratio-16/9)<.01);
    report.ratios.push({scale,view,open,...geometry});
   }
  }
  await responsive.screenshot({path:path.join(out,'responsive-site.png')});
 });
 await app.act({type:'settings.update',patch:{interfaceScale:100}});
 await check('split orientation, ratio and website zoom keep both live pages intact',async()=>{
  const firstId=(await app.state()).activeTabId,firstNonce=await responsive.evaluate(()=>nonce);
  await app.act({type:'tab.new',url:base+'/split-second'});const secondId=(await app.state()).activeTabId,splitPage=await app.waitWeb(base+'/split-second');await splitPage.waitForLoadState('load');const splitNonce=await splitPage.evaluate(()=>nonce);
  await app.act({type:'split.open',tabIds:[firstId,secondId],layout:'columns'});
  for(const layout of ['rows','columns']){
   await app.act({type:'split.layout',layout});await sleep(650);
   await poll(()=>app.ui.evaluate(()=>window.acira.getBrowserLayout()),l=>l.views.length===2,'Two split views');
   await app.act({type:'split.resize',...(layout==='columns'?{cols:[.35,.65]}:{rows:[.4,.6]})});await sleep(350);
   await app.cmd({type:'zoom',tabId:firstId,zoom:125});await sleep(100);
   for(const page of [responsive,splitPage]){const geometry=await page.evaluate(()=>({ratio:document.querySelector('.video').getBoundingClientRect().width/document.querySelector('.video').getBoundingClientRect().height}));assert.ok(Math.abs(geometry.ratio-16/9)<.01);}
  }
  assert.equal(await responsive.evaluate(()=>nonce),firstNonce);assert.equal(await splitPage.evaluate(()=>nonce),splitNonce);await app.act({type:'split.close'});
 });
 await app.act({type:'workspace.create',id:'workspace-22222222-2222-4222-8222-222222222222',name:'Second'});await app.act({type:'tab.navigate',url:base+'/second'});await app.waitWeb(base+'/second');
 await check('rapid workspace switches leave only the selected native page visible, without captured ghost layers',async()=>{
  for(let i=0;i<18;i++){
   const id=i%2?home:'workspace-22222222-2222-4222-8222-222222222222';await app.act({type:'workspace.select',id});await sleep(i%3?35:200);
  }
  await sleep(500);const state=await app.state();
  const visible=await app.main(({BaseWindow})=>BaseWindow.getAllWindows().flatMap(w=>w.contentView.children.filter(v=>v.webContents&&v.getVisible()&&v.getBounds().x>=0).map(v=>v.webContents.getURL())));
  assert.ok(visible.includes(state.tabs.find(t=>t.id===state.activeTabId).url));const expected=(state.windowUi.split?.tabIds||[state.activeTabId]).map(id=>state.tabs.find(t=>t.id===id)?.url).filter(u=>u?.startsWith(base));assert.deepEqual(visible.filter(u=>u.startsWith(base)).sort(),expected.sort());assert.ok(!visible.some(u=>u==='data:text/html,<body>'));report.visibleAfterSwitch=visible;
 });
 await app.close();app=null;report.passed=true;
}finally{
 if(app){report.logs=app.logs.slice(-25);await app.close();}
 await fixture.close();await fs.writeFile(path.join(out,'result.json'),JSON.stringify(report,null,2)+'\n');
}
