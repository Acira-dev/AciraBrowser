import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import{createRequire}from'node:module';
import{startApp,httpFixture,poll,sleep}from'./d-harness.mjs';
const require=createRequire(import.meta.url),stamp=Date.now(),root=path.resolve('.qa-profiles/compact-seamless-'+stamp),out=path.resolve('qa/artifacts/compact-seamless-'+stamp);
await fs.mkdir(root,{recursive:true});await fs.mkdir(out,{recursive:true});
const fixture=await httpFixture((req,res)=>{res.setHeader('Content-Type','text/html');res.end('<title>Frame review</title><style>body{margin:0;background:#e8e9ed}input{margin:80px}main{height:2000px}</style><input aria-label="Draft"><main></main><script>window.nonce=Math.random();window.resizes=0;onresize=()=>resizes++</script>');});
const url='http://127.0.0.1:'+fixture.port+'/',{BrowserDatabase}=require('../desktop/database.cjs'),{createInitialState,makeTab}=require('../desktop/runtime.cjs'),s=createInitialState();
s.tabs=Array.from({length:40},(_,i)=>makeTab('scroll-'+i,'Tab '+i,'acira://new',s.activeBrowserProfileId));s.tabs.push(makeTab('frame-web','Frame review',url,s.activeBrowserProfileId));s.activeTabId='scroll-0';
Object.assign(s.settings,{onboardingComplete:true,askBeforeClosing:false,verticalTabs:false,reducedMotion:false,animationSpeed:'fast',appearance:'light',compactTabTitles:true});Object.assign(s.windowUi,{view:'compact',workspaceOpen:false,webWorkspaceOpen:false});
const db=new BrowserDatabase(path.join(root,'browser.sqlite'));db.saveWindow('main',s);db.close();let app;
const report={passed:false,platform:process.platform,checks:[],errors:[]},check=async(name,fn)=>{const detail=await fn();report.checks.push({name,detail});console.log('PASS '+name);};
const edges=(top,side)=>app.cmd({type:'edge',tabId:(s.activeTabId='frame-web'),keys:{top,side}});
const shot=async name=>{const png=await app.main(async({webContents})=>(await webContents.getAllWebContents().find(w=>w.getURL()==='acira-browser-ui://ui/index.html').capturePage()).toPNG().toString('base64'));await fs.writeFile(path.join(out,name+'.png'),Buffer.from(png,'base64'));};
async function popupPage(selector){return poll(async()=>{for(const page of app.context.pages())if(await page.locator(selector).count())return page;},Boolean,'Popup '+selector);}
try{
 app=await startApp({root,skipSetup:false,main:path.resolve('qa/mac-interface-entry.cjs'),env:{ACIRA_QA_MAIN:path.resolve('desktop/main.cjs'),ACIRA_TEST_QUIET_NETWORK:'1'}});
 app.ui.setDefaultTimeout(8000);app.ui.on('pageerror',e=>report.errors.push(String(e)));
 await app.main(({BaseWindow,screen})=>{const w=BaseWindow.getAllWindows().find(w=>w.contentView.children.some(v=>v.webContents?.getURL()==='acira-browser-ui://ui/index.html'));w.setBounds({x:-17000,y:100,width:1280,height:850});w.showInactive();w.isFocused=()=>true;screen.getCursorScreenPoint=()=>{const b=w.getContentBounds();return{x:b.x+900,y:b.y+500};};});
 await check('Compact trackpad scroll follows every pixel without snapping back',async()=>{
  const node=app.ui.locator('.acira-compact-tabs-viewport:visible');await node.waitFor();await sleep(450);await node.evaluate(n=>n.scrollLeft=0);
  const box=await node.boundingBox(),cdp=await app.context.newCDPSession(app.ui),samples=[];
  for(let i=0;i<16;i++){await cdp.send('Input.dispatchMouseEvent',{type:'mouseWheel',x:box.x+box.width/2,y:box.y+box.height/2,deltaX:3,deltaY:0});await sleep(18);samples.push(await node.evaluate(n=>n.scrollLeft));}
  await cdp.detach();assert(samples.every((x,i)=>i===0||x>=samples[i-1]));assert(samples.at(-1)>=43&&samples.at(-1)<=49,JSON.stringify(samples));
  await sleep(350);assert(Math.abs(await node.evaluate(n=>n.scrollLeft)-samples.at(-1))<1,'No delayed pitch snap');
  const fine=await app.context.newCDPSession(app.ui),start=await node.evaluate(n=>n.scrollLeft);for(let i=0;i<16;i++){await fine.send('Input.dispatchMouseEvent',{type:'mouseWheel',x:box.x+box.width/2,y:box.y+box.height/2,deltaX:.25,deltaY:0});await sleep(18);}await fine.detach();const end=await node.evaluate(n=>n.scrollLeft);assert(Math.abs(end-start-4)<.6,'Fractional gestures retain their distance');return{samples,fractionalDistance:end-start};
 });
 await check('Compact arrow moves one whole tab; selecting the last tab reveals it fully',async()=>{
  const node=app.ui.locator('.acira-compact-tabs-viewport:visible');await node.evaluate(n=>n.scrollLeft=0);await sleep(100);
  const pitch=await app.ui.locator('.acira-compact-tabs:visible').evaluate(el=>Number(el.dataset.peekPitch)||(el.querySelector('.acira-compact-tab')?.getBoundingClientRect().width||38)+4);const next=app.ui.locator('.acira-compact-scroll.next:visible');await next.click();await sleep(500);const first=await node.evaluate(n=>n.scrollLeft);assert(first>0&&first<2*pitch,'The endpoint enters the favicon-center snap grid');await next.click();await sleep(500);const x=await node.evaluate(n=>n.scrollLeft);assert(Math.abs(x-first-pitch)<1,'One tab pitch between aligned positions: '+JSON.stringify({first,x,pitch}));
  await app.act({type:'tab.select',id:'scroll-39'});await sleep(650);const viewport=await node.boundingBox(),tab=await app.ui.locator('.acira-compact-tab[data-tab-id="scroll-39"]:visible').boundingBox();assert(tab.x>=viewport.x-1&&tab.x+tab.width<=viewport.x+viewport.width+1);return{first,x,pitch,step:x-first};
 });
 await check('The expanded top tab strip scrolls directly too',async()=>{
  await app.act({type:'ui.update',patch:{view:'full'}});const node=app.ui.locator('.tab-strip-viewport:visible');await node.waitFor();await sleep(450);await node.evaluate(n=>n.scrollLeft=0);const box=await node.boundingBox(),cdp=await app.context.newCDPSession(app.ui);
  for(let i=0;i<16;i++){await cdp.send('Input.dispatchMouseEvent',{type:'mouseWheel',x:box.x+box.width/2,y:box.y+box.height/2,deltaX:3,deltaY:0});await sleep(18);}await cdp.detach();const end=await node.evaluate(n=>n.scrollLeft);assert(end>=43&&end<=49);await sleep(350);assert(Math.abs(await node.evaluate(n=>n.scrollLeft)-end)<1,'No expanded-strip snap back');return end;
 });
 await app.act({type:'settings.update',patch:{verticalTabs:true}});await app.act({type:'ui.update',patch:{view:'seamless',workspaceOpen:false,webWorkspaceOpen:false}});
 await check('Internal new-tab content stays in place under the Seamless header and sidebar',async()=>{
  await sleep(650);const field=app.ui.locator('.nt-search:visible'),before=await field.boundingBox();
  await edges(true,true);await app.ui.locator('.acira-sidebar.is-peek').waitFor();await sleep(650);const after=await field.boundingBox();
  for(const key of ['x','y','width','height'])assert(Math.abs(before[key]-after[key])<1.5,'New-tab '+key+' stays in place: '+JSON.stringify({before,after}));
  await app.cmd({type:'edge',tabId:'scroll-39',keys:{top:false,side:false},dismiss:'side'});await app.cmd({type:'edge',tabId:'scroll-39',dismiss:'top'});await sleep(650);return{before,after};
 });
 await app.act({type:'tab.select',id:'frame-web'});const web=await app.waitWeb(url);await web.getByLabel('Draft').fill('Keep this draft');await sleep(650);
 const probe=()=>web.evaluate(()=>({width:innerWidth,height:innerHeight,nonce}));
 for(const appearance of ['light','dark'])await check(`Seamless ${appearance}: toolbar and sidebar keep the page viewport and joined design`,async()=>{
  await app.act({type:'settings.update',patch:{appearance}});await sleep(450);const before=await probe();
  await edges(true,false);await app.ui.locator('.browser-shell[data-seamless=shown]').waitFor();await sleep(650);assert.deepEqual(await probe(),before,'Top reveal does not resize the website');
  await edges(true,true);await app.ui.locator('.acira-sidebar.is-peek').waitFor();await sleep(650);assert.deepEqual(await probe(),before,'Sidebar reveal does not resize the website');
  const frame=await app.ui.evaluate(()=>{const rail=document.querySelector('.acira-sidebar'),shell=document.querySelector('.browser-shell'),card=document.querySelector('.page-area'),r=getComputedStyle(rail),t=getComputedStyle(shell);return{overlay:document.documentElement.dataset.sidebarOverlay,legacy:document.documentElement.dataset.edgeFloat,margin:r.margin,left:rail.getBoundingClientRect().left,radius:getComputedStyle(card).borderRadius,railImage:getComputedStyle(rail,'::after').backgroundImage,shellImage:t.backgroundImage,shellShadow:t.boxShadow};});
  assert(frame.overlay&&!frame.legacy);assert.equal(frame.margin,'0px');assert.equal(frame.left,0);assert.equal(frame.radius,'8px');assert.equal(frame.shellImage,'none');assert.equal(frame.shellShadow,'none');await shot('seamless-'+appearance);
  await app.cmd({type:'edge',tabId:'frame-web',keys:{top:false,side:false},dismiss:'side'});await app.cmd({type:'edge',tabId:'frame-web',dismiss:'top'});await sleep(750);assert.deepEqual(await probe(),before);assert.equal(await web.getByLabel('Draft').inputValue(),'Keep this draft');return frame;
 });
 await check('A custom sidebar colour also paints the joined header and native caption',async()=>{
  await app.act({type:'settings.update',patch:{appearance:'light',sidebarColor:'#07523d'}});await edges(true,true);await app.ui.locator('.acira-sidebar.is-peek').waitFor();await sleep(650);
  const colors=await app.ui.evaluate(async()=>{const rail=getComputedStyle(document.querySelector('.acira-sidebar')),bar=getComputedStyle(document.querySelector('.browser-toolbar')),rgb=getComputedStyle(document.querySelector('.app')).getPropertyValue('--sidebar-rgb').trim().split(/\s+/).map(Number),layout=await window.acira.getBrowserLayout();return{rail:rail.color,bar:bar.color,expected:'#'+rgb.map(n=>n.toString(16).padStart(2,'0')).join(''),caption:layout.captionColor};});
  assert.equal(colors.bar,colors.rail);assert.equal(colors.caption.toLowerCase(),colors.expected.toLowerCase());await shot('seamless-custom-sidebar');
  await app.cmd({type:'edge',tabId:'frame-web',keys:{top:false,side:false},dismiss:'side'});await app.cmd({type:'edge',tabId:'frame-web',dismiss:'top'});await sleep(650);await app.act({type:'settings.update',patch:{sidebarColor:undefined,appearance:'dark'}});return colors;
 });
 await check('Seamless sidebar toolbar button opens and closes on one click',async()=>{
  await edges(true,false);await app.ui.locator('.sidebar-toggle-control:visible').waitFor();await sleep(600);await app.ui.locator('.sidebar-toggle-control:visible').click();await poll(()=>app.ui.locator('.acira-sidebar:visible').count(),n=>n===1,'Sidebar opens');await sleep(650);
  await app.ui.locator('.sidebar-toggle-control:visible').click();await poll(()=>app.ui.locator('.acira-sidebar:visible').count(),n=>n===0,'Sidebar closes');assert.equal(await web.getByLabel('Draft').inputValue(),'Keep this draft');
 });
 await check('Seamless address field has its correct colour before hover',async()=>{
  const field=app.ui.locator('.browser-toolbar .address-bar:visible');await app.ui.mouse.move(950,500);const before=await field.evaluate(el=>getComputedStyle(el).backgroundColor);await field.hover();await sleep(200);const after=await field.evaluate(el=>getComputedStyle(el).backgroundColor);assert.equal(after,before);return{before,after};
 });
 for(const appearance of ['light','dark'])await check(`${appearance}: settings and menus use the same surface theme`,async()=>{
  await app.cmd({type:'edge',tabId:'frame-web',dismiss:'side'});await app.cmd({type:'edge',tabId:'frame-web',dismiss:'top'});await app.act({type:'settings.update',patch:{appearance}});await app.act({type:'ui.update',patch:{view:'full'}});await app.act({type:'tab.navigate',tabId:'scroll-0',url:'acira://settings'});await app.act({type:'tab.select',id:'scroll-0'});await app.ui.locator('.browser-settings').waitFor();await sleep(350);
  const tone=await app.ui.locator('.app').first().evaluate(el=>getComputedStyle(el).getPropertyValue('--surface-tone').trim());
  await app.ui.locator('.toolbar-menu-control:visible').click();const popup=await popupPage('.popup-content-menu');const menuTone=await popup.locator('.app').first().evaluate(el=>getComputedStyle(el).getPropertyValue('--surface-tone').trim());assert.equal(menuTone,tone);assert.equal(tone,appearance);await popup.keyboard.press('Escape');await app.act({type:'tab.select',id:'frame-web'});await sleep(450);await web.mouse.click(500,350,{button:'right'});const context=await popupPage('.popup-content-page-context');const contextTone=await context.locator('.app').first().evaluate(el=>getComputedStyle(el).getPropertyValue('--surface-tone').trim());assert.equal(contextTone,tone);await context.keyboard.press('Escape');return{settings:tone,menu:menuTone,context:contextTone};
 });
 assert.deepEqual(report.errors,[]);report.passed=true;
}catch(error){report.error=String(error.stack||error);process.exitCode=1;}finally{await app?.close();await fixture.close();await fs.writeFile(path.join(out,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,...report}));}
