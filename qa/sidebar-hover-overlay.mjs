// Real native website views and the production edge poller, with an injected
// pointer in this disposable process. Never moves the person's system cursor.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {startApp,httpFixture,poll,sleep} from './d-harness.mjs';
import {hoverSettings} from './sidebar-hover-profile.mjs';
const require=createRequire(import.meta.url),stamp=Date.now(),root=path.resolve('.qa-profiles/sidebar-overlay-'+stamp),out=path.resolve(process.env.SIDEBAR_OVERLAY_OUT||'qa/artifacts/sidebar-overlay-'+stamp);
await fs.mkdir(root,{recursive:true});await fs.mkdir(out,{recursive:true});
const report={passed:false,nativePlatform:process.platform,injectedPollerPointer:true,railPointerEvents:true,legs:['hidden','mini'],canonicalProfileUntouched:true,checks:[]};let app;
const fixture=await httpFixture((req,res)=>{res.setHeader('Content-Type','text/html');res.end('<title>Sidebar fixture '+req.url+'</title><style>body{min-height:4000px}</style><button onclick="this.textContent=\'Clicked\'">Page button</button><input aria-label="Draft"><script>window.probe={nonce:Math.random(),resizes:0};onresize=()=>probe.resizes++;</script>');});
const base='http://127.0.0.1:'+fixture.port,{BrowserDatabase}=require('../desktop/database.cjs'),{createInitialState,makeTab}=require('../desktop/runtime.cjs');
const initial=createInitialState(),profile=initial.activeBrowserProfileId;
initial.tabs=[makeTab('overlay-a','Fixture A',base+'/a',profile),makeTab('overlay-b','Fixture B',base+'/b',profile),makeTab('overlay-settings','Settings','acira://settings',profile)];initial.activeTabId='overlay-a';
Object.assign(initial.settings,hoverSettings('hidden'));
Object.assign(initial.windowUi,{workspaceOpen:false,webWorkspaceOpen:false});const db=new BrowserDatabase(path.join(root,'browser.sqlite'));db.saveWindow('main',initial);db.close();
const pointer=(x,y)=>app.main((_,point)=>{globalThis.__sidebarOverlayPointer=point;},[x,y]);
const peek=()=>app.ui.evaluate(()=>({shown:!!document.querySelector('.ed-rail.is-peek'),floating:document.documentElement.dataset.sidebarOverlay||document.documentElement.dataset.edgeFloat}));
const webBounds=()=>app.main(({BaseWindow},url)=>BaseWindow.getAllWindows().flatMap(w=>w.contentView.children).filter(v=>v.webContents?.getURL()===url&&v.getVisible()).map(v=>v.getBounds()),base+'/a');
const metrics=page=>page.evaluate(()=>({width:innerWidth,height:innerHeight,nonce:probe.nonce,resizes:probe.resizes}));
// The baseline every case compares against is taken with the page AT REST: a view or scale switch ends in a short spring (the page's box overshoots by a few px and its viewport takes 2-3 more resize events), which on a busy
// machine can still be running 750 ms later, and a baseline taken inside it fails the case for a move that the hover never made (seen 3 times in 6 runs on case 4, light focus 80%, on a quiet-enough Mac). Three equal reads 120 ms apart.
const atRest=async page=>{let last='',same=0;await poll(async()=>{const key=JSON.stringify([await webBounds(),await metrics(page)]);same=key===last?same+1:0;last=key;await sleep(120);return same>=3;},Boolean,'Page layout at rest',15000);};
const check=async(name,fn)=>{await fn();report.checks.push(name);console.log('PASS '+name);};
try{
 app=await startApp({root,skipSetup:false,main:path.resolve('qa/mac-interface-entry.cjs'),env:{ACIRA_QA_MAIN:path.resolve(process.argv[2]||'.','desktop/main.cjs'),ACIRA_TEST_QUIET_NETWORK:'1'}});app.ui.setDefaultTimeout(6000);
 await app.main(({BaseWindow,screen})=>{const w=BaseWindow.getAllWindows().find(w=>w.contentView.children.some(v=>v.webContents?.getURL()==='acira-browser-ui://ui/index.html'));w.setBounds({x:-17000,y:100,width:1440,height:820});w.showInactive();w.isFocused=()=>true;globalThis.__sidebarOverlayPointer=[700,400];screen.getCursorScreenPoint=()=>{const b=w.getContentBounds(),p=globalThis.__sidebarOverlayPointer;return{x:b.x+p[0],y:b.y+p[1]};};});
 const a=await app.waitWeb(base+'/a');await a.locator('input').fill('Keep my draft');await app.act({type:'tab.select',id:'overlay-b'});const b=await app.waitWeb(base+'/b');await b.locator('input').fill('Other draft');await app.act({type:'tab.select',id:'overlay-a'});
 for(const appearance of ['light','dark'])for(const view of ['compact','focus','full'])for(const scale of [80,100,150]){
  await check(appearance+' '+view+' '+scale+'%: overlay stays usable without resizing or reloading the website',async()=>{
   await pointer(700,400);await app.act({type:'ui.update',patch:{view,workspaceOpen:false,webWorkspaceOpen:false}});await app.act({type:'settings.update',patch:{interfaceScale:scale,appearance,sidebarClosed:'hidden'}});await sleep(750);
   await poll(webBounds,boxes=>boxes.length===1&&boxes[0].width>500,'Live page ready');await atRest(a);const before=await metrics(a),bounds=await webBounds();
   await pointer(1,300);await poll(peek,s=>s.shown&&['native','dom'].includes(s.floating),'Hover opens native overlay');
   const geometry=await app.ui.evaluate(()=>{const rail=document.querySelector('.ed-rail.is-peek'),r=rail.getBoundingClientRect(),shell=document.querySelector('.browser-shell'),s=shell.getBoundingClientRect(),cs=getComputedStyle(rail),rect=selector=>{const el=document.querySelector(selector),b=el?.getBoundingClientRect(),style=el&&getComputedStyle(el);return b?{x:b.x,y:b.y,width:b.width,height:b.height,position:style.position,background:style.backgroundColor}:null;};return{left:r.left,top:r.top,right:r.right,shellLeft:s.left,radius:cs.borderTopLeftRadius,margin:cs.marginLeft,corner:getComputedStyle(shell,'::after').content,sidebarBackground:cs.backgroundColor,shellBackground:getComputedStyle(shell).backgroundColor,sidebarFinish:cs.backgroundImage,shellFinish:getComputedStyle(shell).backgroundImage,toolbar:rect('.browser-toolbar'),address:rect('.address-bar'),navigation:rect('.navigation-controls')};});
   report.geometry??=[];report.geometry.push({appearance,view,scale,...geometry});
   assert.equal(geometry.left,0);assert.equal(geometry.top,0);assert.equal(geometry.radius,'0px');assert.equal(geometry.margin,'0px');assert(Math.abs(geometry.right-geometry.shellLeft)<=1,'Sidebar/header seam stays connected');
   assert(geometry.toolbar.x>=geometry.right-1,'Sidebar must not cover the toolbar');assert(geometry.address.x>=geometry.right-1,'Address field must stay beside the sidebar');
   await pointer(Math.round(geometry.right*scale/100)-18,380);await sleep(650);assert.equal((await peek()).shown,true,'Pointer can cross and use the whole sidebar');
   await pointer(700,12);await sleep(450);assert.equal((await peek()).shown,true,'The connected toolbar also keeps the sidebar open');await pointer(180*scale/100,380);
   assert.deepEqual(await webBounds(),bounds,'Native website bounds do not move');assert.deepEqual(await metrics(a),before,'No viewport resize or document reload');
   await app.ui.locator('.sb-tab[data-tab-id="overlay-b"] .sb-tab-main').click();await poll(()=>app.state(),s=>s.activeTabId==='overlay-b','Select another tab');await sleep(250);assert.equal((await peek()).shown,true);assert.equal((await app.state()).windowUi.webWorkspaceOpen,false);
   await app.ui.locator('.sb-tab[data-tab-id="overlay-a"] .sb-tab-main').click();await poll(()=>app.state(),s=>s.activeTabId==='overlay-a','Return to first tab');assert.equal(await a.locator('input').inputValue(),'Keep my draft');assert.equal((await metrics(a)).nonce,before.nonce);
   await pointer(700,400);await poll(peek,s=>!s.shown&&!s.floating,'Returning to the page hides overlay');assert.deepEqual(await webBounds(),bounds);assert.equal((await metrics(a)).width,before.width);
  });
 }
 await check('Switching to Settings and back retains the hover overlay and the selected page receives input',async()=>{
  await app.act({type:'ui.update',patch:{view:'compact'}});await app.act({type:'settings.update',patch:{interfaceScale:100,sidebarClosed:'hidden'}});await sleep(500);await pointer(1,300);await poll(peek,s=>s.shown,'Sidebar opens');await pointer(180,300);

  await app.ui.locator('.sb-tab[data-tab-id="overlay-settings"] .sb-tab-main').click();await poll(peek,s=>s.shown&&s.floating==='dom','Settings preserves overlay');
  await app.ui.locator('.sb-tab[data-tab-id="overlay-b"] .sb-tab-main').click();await poll(peek,s=>s.shown&&['native','dom'].includes(s.floating),'Website preserves overlay');
  await pointer(700,400);await poll(peek,s=>!s.shown&&!s.floating,'Page takes pointer back');await b.getByRole('button',{name:'Page button'}).click();assert.equal(await b.getByRole('button',{name:'Clicked'}).count(),1);assert.equal(await b.locator('input').inputValue(),'Other draft');
 });

 // Mini: the default of a new Beta 14 profile. The closed sidebar is the 56 px rail beside the page. Since 17 Nov 01:35 (the team; src/ui/miniRail.ts MINI_HOVER_FLOAT=false) the hover float is OFF: resting the pointer on the rail
 // opens nothing, and the sidebar opens only by its button, the shortcut or the menu (the dock). This leg holds the new rule: real pointer events on the rail (Playwright's mouse sends Input.dispatchMouseEvent to the interface's page, the events a
 // real pointer over the rail makes, in the interface's own CSS pixels) leave the page and the rail alone, and the same app action the sidebar button sends docks the sidebar beside the page and takes it back to the rail, with the page's document,
 // draft and tab switching intact. Main's edge poller has no side zone in Mini (edge-reveal.cjs enabledEdges: miniRail), so the injected screen pointer is not this leg's input.
 const rail=()=>app.ui.evaluate(()=>{const sb=document.querySelector('.acira-sidebar.is-mini'),r=sb?.getBoundingClientRect();return{mini:!!sb,phase:sb?.dataset.mini??null,left:r?.left??null,width:r?.width??null,floating:document.documentElement.dataset.sidebarOverlay||document.documentElement.dataset.edgeFloat||null};});
 const docked=()=>app.ui.evaluate(()=>!!document.querySelector('.acira-sidebar')?.classList.contains('is-mini-docked'));
 const dock=open=>app.act({type:'ui.update',patch:{workspaceOpen:open,webWorkspaceOpen:open}});
 const hand=(x,y,steps=6)=>app.ui.mouse.move(x,y,{steps});
 await app.act({type:'tab.select',id:'overlay-a'});await poll(()=>app.state(),s=>s.activeTabId==='overlay-a','Back on the first tab for the Mini leg');
 for(const appearance of ['light','dark'])for(const view of ['compact','focus','full'])for(const scale of [80,100,150]){
  await check('mini '+appearance+' '+view+' '+scale+'%: resting on the rail opens nothing; the sidebar button docks the sidebar beside the website and back into the rail without reloading it',async()=>{
   await pointer(700,400);await hand(700,400,1);await app.act({type:'ui.update',patch:{view,workspaceOpen:false,webWorkspaceOpen:false}});await app.act({type:'settings.update',patch:{interfaceScale:scale,appearance,sidebarClosed:'mini'}});await sleep(750);
   await poll(webBounds,boxes=>boxes.length===1&&boxes[0].width>500,'Live page ready');await poll(rail,r=>r.mini&&r.phase==='rail'&&!r.floating,'The closed sidebar is the rail');await atRest(a);const before=await metrics(a),bounds=await webBounds();
   await hand(500,300);await hand(28,300);await sleep(1500);
   const resting=await rail();report.geometry??=[];report.geometry.push({appearance,view,scale,closed:'mini',...resting});
   assert.equal(resting.phase,'rail','Resting on the rail opens nothing (the hover float is off)');assert(!resting.floating,'No floating sidebar while the pointer rests on the rail');
   assert.deepEqual(await webBounds(),bounds,'Native website bounds do not move');assert.deepEqual(await metrics(a),before,'No viewport resize or document reload');
   await hand(700,400);await sleep(300);
   await dock(true);await poll(docked,Boolean,'The sidebar button docks the sidebar',8000);await sleep(700);await poll(webBounds,boxes=>boxes.length===1&&boxes[0].width>300,'Live page beside the docked sidebar');
   assert.equal((await metrics(a)).nonce,before.nonce,'Docking does not reload the website');
   await app.ui.locator('.sb-tab[data-tab-id="overlay-b"] .sb-tab-main').click();await poll(()=>app.state(),s=>s.activeTabId==='overlay-b','Select another tab');await sleep(250);assert.equal(await docked(),true);
   await app.ui.locator('.sb-tab[data-tab-id="overlay-a"] .sb-tab-main').click();await poll(()=>app.state(),s=>s.activeTabId==='overlay-a','Return to first tab');assert.equal(await a.locator('input').inputValue(),'Keep my draft');assert.equal((await metrics(a)).nonce,before.nonce);
   await dock(false);await poll(rail,r=>r.mini&&r.phase==='rail'&&!r.floating,'Closing the dock returns to the rail',8000);await sleep(500);await atRest(a);assert.deepEqual(await webBounds(),bounds);assert.equal((await metrics(a)).width,before.width);
  });
 }
 await check('mini: switching to Settings and back keeps the docked sidebar and the selected page receives input',async()=>{
  await app.act({type:'ui.update',patch:{view:'compact'}});await app.act({type:'settings.update',patch:{interfaceScale:100,sidebarClosed:'mini'}});await sleep(500);await dock(true);await poll(docked,Boolean,'Sidebar docks',8000);await sleep(700);
  await app.ui.locator('.sb-tab[data-tab-id="overlay-settings"] .sb-tab-main').click();await poll(()=>app.state(),s=>s.activeTabId==='overlay-settings','Settings is selected');await sleep(250);assert.equal(await docked(),true,'Settings keeps the docked sidebar');
  await app.ui.locator('.sb-tab[data-tab-id="overlay-b"] .sb-tab-main').click();await poll(()=>app.state(),s=>s.activeTabId==='overlay-b','Website selected');await sleep(250);assert.equal(await docked(),true,'The website keeps the docked sidebar');
  await dock(false);await poll(rail,r=>r.mini&&r.phase==='rail'&&!r.floating,'Closing the dock returns to the rail',8000);await b.evaluate(()=>{document.querySelector('button').textContent='Page button';});await b.getByRole('button',{name:'Page button'}).click();assert.equal(await b.getByRole('button',{name:'Clicked'}).count(),1);assert.equal(await b.locator('input').inputValue(),'Other draft');
 });
 report.passed=true;
}catch(error){report.error=String(error.stack||error);process.exitCode=1;}
finally{await app?.close();await fixture.close();await fs.writeFile(path.join(out,'result.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));}
